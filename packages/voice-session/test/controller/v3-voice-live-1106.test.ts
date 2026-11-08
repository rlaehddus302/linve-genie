// 실방송 2026-11-06 (D-V3-123·125): 557번 → 57번 · '18번입니다 18만원'(291번의 가격) → 카드 · 앞 상품 가격 꼬리 + '얼마였죠' 뒤 153번 → 등록 안 함
// 실제 음성 모듈 + 가짜 인식 객체 + 가짜 시계.
import * as voiceModule from '@livejjim/voice'
import type { SuggestionCard, VoiceSettings } from '@livejjim/voice'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceController, type ExistingView, type VoiceHost } from '../../src/controller/controller.ts'

const T0 = Date.UTC(2026, 9, 26, 8, 48, 0)

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
  say(text: string, final = true): void {
    this.results.push({ isFinal: final, length: 1, 0: { transcript: text } })
    this.onresult?.({ resultIndex: this.results.length - 1, results: this.results })
    if (!final) this.results.pop()
  }
  static get last(): FakeRecognition {
    const last = FakeRecognition.all.at(-1)
    if (last === undefined) throw new Error('인식 객체가 없다')
    return last
  }
}

interface Harness {
  readonly voice: VoiceController
  readonly registered: { card: SuggestionCard; no: number; name: string; price: number; source: string }[]
  readonly fixes: { id: string; changes: { name?: string; price?: number } }[]
  readonly board: Map<number, ExistingView>
}

const NO_NAMES: readonly string[] = []

function harness(): Harness {
  const state = { registered: [] as Harness['registered'], fixes: [] as Harness['fixes'], board: new Map<number, ExistingView>() }
  const host: VoiceHost = {
    load: async () => voiceModule,
    now: () => Date.now(),
    maxNumber: () => 999,
    priceUnit: () => 'THOUSAND',
    deviceId: () => 'this-device',
    lastVoiceDevice: () => null,
    // 화면처럼 같은 목록을 돌려준다(ConsolePage useMemo) — 부를 때마다 새 목록이면 사전을 매번 다시 만든다(사전이 커져 300글자 시험이 5초를 넘음, D-V3-115)
    currentNames: () => NO_NAMES,
    products: () => new Map([...state.board].map(([no, item]) => [no, item.closed])),
    fetchHistory: async () => [],
    dialogOpen: () => false,
    readConsent: () => true,
    writeConsent: () => {},
    readSettings: () => null,
    writeSettings: (_settings: VoiceSettings) => {},
    register: (card, registration, source) => {
      state.registered.push({ card, ...registration, source })
    },
    focusQuick: () => {},
    fixRecent: async (id, changes) => {
      state.fixes.push({ id, changes })
      const item = [...state.board.values()].find((entry) => entry.key === id)
      return { kind: 'fixed', before: { ...(changes.price !== undefined ? { price: item?.price ?? 0 } : {}) } }
    },
    undoRecent: () => true,
    existingProduct: (no: number) => state.board.get(no) ?? null,
  }
  return Object.assign(state, { voice: new VoiceController(host) })
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}
const at = (ms: number): void => {
  vi.advanceTimersByTime(T0 + ms - Date.now())
}
const say = (text: string, final = true): void => FakeRecognition.last.say(text, final)
const reg = (h: Harness) => h.registered.map((item) => [item.no, item.price, item.name])

/** 콘솔이 등록을 마쳤다 (상품 보드에 생기고 음성에 알린다) */
function finishAll(h: Harness, claimCount = 0): void {
  for (const sent of h.registered) {
    const key = `b1:${String(sent.no)}`
    if (h.board.has(sent.no)) continue
    h.board.set(sent.no, { key, name: sent.name, price: sent.price, claimCount, closed: false, status: 'OPEN' })
    h.voice.noteVoiceRegistered({ id: key, no: sent.no, name: sent.name, price: sent.price })
  }
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

async function ready(): Promise<Harness> {
  vi.setSystemTime(T0 - 5000)
  const h = harness()
  await h.voice.turnOn()
  await settle()
  at(0)
  return h
}


const run = async (h: Harness, text: string, t: number): Promise<number> => {
  at(t)
  say(text)
  at(t + 2000)
  finishAll(h)
  await settle()
  return t + 2000
}

describe('실방송 2026-11-06', () => {
  it('57번 5만 원 뒤 "557번 녹금 요아이 5만원" — 557번을 새로 만들지 않는다 (겹친 자리 걷어 내기)', async () => {
    const h = await ready()
    let t = await run(h, '52번 30만원', 1000)
    t = await run(h, '54번 5만원', t + 20_000)
    t = await run(h, '56번 만원', t + 20_000)
    t = await run(h, '57번이구요 5만원', t + 20_000)
    await run(h, '557번 녹금 요아이 5만원', t + 3000)
    expect(reg(h).map(([no]) => no)).toEqual([52, 54, 56, 57])
  })

  it('280번대를 팔다 "18번입니다 18만원" — 바로 등록하지 않고 번호를 확인하는 카드로', async () => {
    const h = await ready()
    let t = await run(h, '281번 6만원', 1000)
    t = await run(h, '286번 50만원', t + 20_000)
    await run(h, '18번입니다 18만원', t + 20_000)
    expect(reg(h).map(([no]) => no)).toEqual([281, 286])
    const cards = [...h.voice.getSnapshot().cards.values()].map((card) => card.no)
    expect(cards).toContain(18)
  })

  it('10번대를 팔 때 "18번 18만원"은 그대로 바로 등록', async () => {
    const h = await ready()
    let t = await run(h, '15번 5만원', 1000)
    t = await run(h, '16번 5만원', t + 20_000)
    await run(h, '18번 18만원', t + 20_000)
    expect(reg(h).map(([no]) => no)).toEqual([15, 16, 18])
  })

  it('앞 상품 가격 꼬리 뒤 "얼마였죠" — 153번에 앞 가격을 붙이지 않는다', async () => {
    const h = await ready()
    const t = await run(h, '276 황소개구리금 뿌리까지 있고요 단수존요아이는 20만원', 1000)
    await run(h, '단수존요아이는 20만원 이거 아까 얼마였죠 사장님? 153번 찐독금이 되는 전개구리금입니다 이왕이', t + 20_000)
    expect(reg(h).filter(([no]) => no === 153)).toEqual([])
  })
})
