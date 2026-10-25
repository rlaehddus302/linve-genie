// V3 적대 시험 (test-domain, R-22 recent, D-V3-57·59): "고쳐 말함"의 경계 — 60초, 그 사이 다른 번호 음성 등록.
// 실제 음성 모듈 + 실제 콘솔 음성 컨트롤러 + 가짜 인식 객체 + 가짜 시계. 화면 파일은 DOM 타입이라 경로를 값으로 불러온다(i4/voice-controller-auto.test.ts와 같은 까닭).
// 노리는 것: 60초가 지난 같은 번호를 찜 있는 상품에 덮어씀, 사이에 다른 번호를 등록했는데 덮어씀, 다른 번호를 고친 것만으로 고쳐 말함이 끊김.
import * as voiceModule from '@livejjim/voice'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const CONTROLLER_MODULE = '../../../apps/web/src/voice/controller.ts'
const T0 = Date.UTC(2026, 9, 25, 1, 0, 0)

class FakeRecognition {
  static readonly all: FakeRecognition[] = []
  lang = ''
  continuous = false
  interimResults = false
  onresult: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onend: (() => void) | null = null
  results: { isFinal: boolean; length: number; 0: { transcript: string } }[] = []
  constructor() {
    FakeRecognition.all.push(this)
  }
  start(): void {}
  stop(): void {}
  abort(): void {}
  say(text: string): void {
    this.results.push({ isFinal: true, length: 1, 0: { transcript: text } })
    this.onresult?.({ resultIndex: this.results.length - 1, results: this.results })
  }
}

interface View {
  key: string
  name: string
  price: number
  claimCount: number
  closed: boolean
  status?: string
}
interface Controller {
  turnOn(): Promise<void>
  noteVoiceRegistered(entry: { id: string; no: number; name: string; price: number }): void
  getSnapshot(): { offers: readonly { message: string; stage: string; maybeOther?: boolean }[] }
}

async function harness() {
  const { VoiceController } = (await import(/* @vite-ignore */ CONTROLLER_MODULE)) as { VoiceController: new (host: unknown) => Controller }
  const board = new Map<number, View>()
  const registered: { no: number; name: string; price: number }[] = []
  const fixes: { id: string; changes: { price?: number; name?: string } }[] = []
  const host = {
    load: async () => voiceModule,
    now: () => Date.now(),
    maxNumber: () => 999,
    priceUnit: () => 'WON',
    currentNames: () => [],
    products: () => new Map([...board].map(([no, p]) => [no, p.closed])),
    fetchHistory: async () => [],
    dialogOpen: () => false,
    readConsent: () => true,
    writeConsent: () => {},
    readSettings: () => null,
    writeSettings: () => {},
    register: (_card: unknown, registration: { no: number; name: string; price: number }) => {
      registered.push(registration)
    },
    focusQuick: () => {},
    fixRecent: async (id: string, changes: { price?: number; name?: string }) => {
      fixes.push({ id, changes })
      const p = [...board.values()].find((item) => item.key === id)
      return { kind: 'fixed', before: changes.price !== undefined ? { price: p?.price ?? 0 } : {} }
    },
    undoRecent: () => true,
    existingProduct: (no: number) => board.get(no) ?? null,
  }
  const voice = new VoiceController(host)
  await voice.turnOn()
  for (let i = 0; i < 5; i++) await Promise.resolve()
  const recognition = FakeRecognition.all.at(-1) as FakeRecognition
  /** 바로 등록된 것을 보드에 올리고(찜 claims개) 컨트롤러에 알린다 — 화면이 등록 응답을 받은 때 */
  const land = (claims: number): void => {
    const sent = registered.at(-1)
    if (sent === undefined) throw new Error('등록이 없다')
    const key = `b1:${String(sent.no)}`
    board.set(sent.no, { key, name: sent.name, price: sent.price, claimCount: 0, closed: false, status: 'OPEN' })
    voice.noteVoiceRegistered({ id: key, no: sent.no, name: sent.name, price: sent.price })
    board.set(sent.no, { key, name: sent.name, price: sent.price, claimCount: claims, closed: false, status: 'OPEN' })
  }
  return { voice, board, registered, fixes, land, say: (text: string) => recognition.say(text) }
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}
const at = async (ms: number): Promise<void> => {
  vi.advanceTimersByTime(T0 + ms - Date.now())
  await settle()
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 - 5000 })
  FakeRecognition.all.length = 0
  vi.stubGlobal('SpeechRecognition', FakeRecognition)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('R-22 recent 경계 (D-V3-59)', () => {
  it('65번을 음성으로 등록한 지 59.9초 → 찜이 있어도 고쳐 말함 → 바로 고침', async () => {
    const h = await harness()
    await at(0)
    h.say('65번 3만 원')
    await at(2000)
    h.land(2)
    await at(59_900)
    h.say('65번 5만 원')
    await settle()
    expect(h.fixes).toEqual([{ id: 'b1:65', changes: { price: 50_000 } }])
  })

  it('65번을 등록한 지 60초를 넘음 → 찜 있음 → 덮어쓰지 않고 MAYBE_OTHER 카드', async () => {
    const h = await harness()
    await at(0)
    h.say('65번 3만 원')
    await at(2000)
    h.land(2)
    await at(62_100)
    h.say('65번 5만 원')
    await settle()
    expect(h.fixes).toEqual([])
    expect(h.voice.getSnapshot().offers[0]?.maybeOther).toBe(true)
  })

  it('65번 등록 뒤 61번을 음성으로 등록 → 60초 안이어도 고쳐 말함 아님 → 찜 있는 65번은 덮어쓰지 않음', async () => {
    const h = await harness()
    await at(0)
    h.say('65번 3만 원')
    await at(2000)
    h.land(2)
    h.say('61번 2만 원')
    await at(4000)
    h.land(0)
    await at(6000)
    h.say('65번 5만 원')
    await settle()
    expect(h.registered.map((r) => r.no)).toEqual([65, 61])
    expect(h.fixes).toEqual([])
    expect(h.voice.getSnapshot().offers[0]?.maybeOther).toBe(true)
  })

  // TD-V3-005: R-22 recent는 "그 사이 이 콘솔이 다른 번호를 음성으로 **등록**하지 않았으면" 참이다. 다른 번호를 음성으로 **고친** 것은 끊지 않는다.
  // 구현(controller.ts #recentVoice)은 마지막으로 등록·고친 번호 하나만 보아, 61번을 고친 뒤 65번을 고쳐 말하면 고쳐 말함이 아니게 된다.
  it('TD-V3-005: 65번 등록 뒤 이미 있던 61번(찜 0)을 음성으로 고침 → 65번은 여전히 고쳐 말함 → 찜이 있어도 바로 고침', async () => {
    const h = await harness()
    h.board.set(61, { key: 'b1:61', name: '라울', price: 10_000, claimCount: 0, closed: false, status: 'OPEN' })
    await at(0)
    h.say('65번 3만 원')
    await at(2000)
    h.land(2)
    h.say('61번 2만 원')
    await at(4000)
    expect(h.fixes).toEqual([{ id: 'b1:61', changes: { price: 20_000 } }])
    await at(6000)
    h.say('65번 5만 원')
    await settle()
    expect(h.registered.map((r) => r.no)).toEqual([65])
    expect(h.fixes).toEqual([
      { id: 'b1:61', changes: { price: 20_000 } },
      { id: 'b1:65', changes: { price: 50_000 } },
    ])
  })
})
