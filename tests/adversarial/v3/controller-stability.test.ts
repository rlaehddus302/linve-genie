// V3 적대 시험 (test-domain, AC-V3-60 (d) — D-V3-79, 사례 R97·R98): "확정은 그 순간의 글 기준" — 등록된 pick은 뒤 말로 바뀌거나 사라지지 않는다.
// 실제 음성 모듈 + 실제 콘솔 음성 컨트롤러 + 가짜 인식 객체(중간 결과 → 최종) + 가짜 시계. 화면 파일은 DOM 타입이라 경로를 값으로 불러온다.
// 노리는 것: 중간 결과에서 등록한 뒤 최종 글에서 pick이 사라져 등록을 되돌림·같은 번호를 다시 씀·두 번째 등록, 같은 조각을 다시 읽어 고치기가 나감.
import * as voiceModule from '@livejjim/voice'
import fc from 'fast-check'
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
  /** 중간 결과(final false)는 그 자리를 다음 결과가 바꾼다 — 크롬과 같이 마지막 결과 칸 하나를 다시 쓴다 */
  say(text: string, final: boolean): void {
    const last = this.results.at(-1)
    if (last !== undefined && !last.isFinal) this.results.pop()
    this.results.push({ isFinal: final, length: 1, 0: { transcript: text } })
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
}

async function harness(priceUnit: 'WON' | 'THOUSAND' = 'THOUSAND') {
  const { VoiceController } = (await import(/* @vite-ignore */ CONTROLLER_MODULE)) as { VoiceController: new (host: unknown) => Controller }
  const board = new Map<number, View>()
  const registered: { no: number; name: string; price: number }[] = []
  const fixes: { id: string; changes: { price?: number; name?: string } }[] = []
  const undone: string[] = []
  let voice: Controller | null = null
  const host = {
    load: async () => voiceModule,
    now: () => Date.now(),
    maxNumber: () => 999,
    priceUnit: () => priceUnit,
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
      // 등록 응답이 바로 온 것처럼 보드에 올리고 알린다
      const key = `b1:${String(registration.no)}`
      board.set(registration.no, { key, name: registration.name, price: registration.price, claimCount: 0, closed: false, status: 'OPEN' })
      queueMicrotask(() => voice?.noteVoiceRegistered({ id: key, no: registration.no, name: registration.name, price: registration.price }))
    },
    focusQuick: () => {},
    fixRecent: async (id: string, changes: { price?: number; name?: string }) => {
      fixes.push({ id, changes })
      const entry = [...board.entries()].find(([, p]) => p.key === id)
      if (entry !== undefined) board.set(entry[0], { ...entry[1], ...changes })
      return { kind: 'fixed', before: {} }
    },
    renumber: async () => false,
    undoRecent: (key: string) => {
      undone.push(key)
      return true
    },
    existingProduct: (no: number) => board.get(no) ?? null,
  }
  voice = new VoiceController(host)
  await voice.turnOn()
  await settle()
  const recognition = FakeRecognition.all.at(-1) as FakeRecognition
  return { registered, fixes, undone, recognition }
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}
const advance = async (ms: number): Promise<void> => {
  vi.advanceTimersByTime(ms)
  await settle()
}

/** 낱말 하나씩 중간 결과(200ms 간격) → 마지막에 같은 글을 최종으로 → 조용한 시간이 지나 덩어리 끝 */
async function speak(h: Awaited<ReturnType<typeof harness>>, text: string): Promise<void> {
  const tokens = text.split(' ')
  for (let k = 1; k <= tokens.length; k++) {
    h.recognition.say(tokens.slice(0, k).join(' '), false)
    await advance(200)
  }
  h.recognition.say(text, true)
  await advance(3000)
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 })
  FakeRecognition.all.length = 0
  vi.stubGlobal('SpeechRecognition', FakeRecognition)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('AC-V3-60 (d) 등록된 pick은 뒤 말로 취소되지 않는다 (D-V3-79)', () => {
  it('R97: 중간 "15번 라울 60 자"에 등록 → 최종 "… 자 뿌리 다 살아 있어요" — 쓰기 하나 그대로, 되돌림·고침·두 번째 쓰기 없음', async () => {
    const h = await harness()
    for (const t of ['15번', '15번 라울', '15번 라울 60', '15번 라울 60 자']) {
      h.recognition.say(t, false)
      await advance(200)
    }
    expect(h.registered).toEqual([{ no: 15, name: '라울', price: 60_000 }])
    for (const t of ['15번 라울 60 자 뿌리', '15번 라울 60 자 뿌리 다 살아 있어요']) {
      h.recognition.say(t, false)
      await advance(200)
    }
    h.recognition.say('15번 라울 60 자 뿌리 다 살아 있어요', true)
    await advance(3000)
    expect(h.registered).toEqual([{ no: 15, name: '라울', price: 60_000 }])
    expect(h.fixes).toEqual([])
    expect(h.undone).toEqual([])
  })

  it('R98: R97 뒤 같은 덩어리 "15번 7만 원" → 고침 하나(70,000원), 등록은 그대로 하나', async () => {
    const h = await harness()
    await speak(h, '15번 라울 60 자 뿌리 다 살아 있어요 15번 7만 원')
    expect(h.registered).toEqual([{ no: 15, name: '라울', price: 60_000 }])
    expect(h.fixes.map((f) => f.changes)).toEqual([{ price: 70_000 }])
    expect(h.undone).toEqual([])
  })

  const VOCAB = [
    '15번', '16번', '108번', '라울', '삼광색금', '60', '180', '25만', '원', '만원', '7만', '원까지', '자', '요', '이거', '그대로', '갑니다', '뿌리', '다', '살아', '있어요',
    '9cm에', '3강', '170', '이번', '예쁘게', '1', '5번',
  ] as const

  it('성질: 낱말 하나씩 말한 덩어리에서 (번호마다 N번이 한 번뿐이면) 등록은 번호마다 많아야 하나이고, 되돌림·고침 쓰기는 하나도 없다', async () => {
    let total = 0
    await fc.assert(
      fc.asyncProperty(fc.array(fc.constantFrom(...VOCAB), { minLength: 2, maxLength: 12 }), async (parts) => {
        const markers = parts.filter((p) => /번$/.test(p))
        fc.pre(new Set(markers).size === markers.length)
        vi.setSystemTime(T0)
        FakeRecognition.all.length = 0
        const h = await harness()
        await speak(h, parts.join(' '))
        const where = parts.join(' ')
        const nos = h.registered.map((r) => r.no)
        total += nos.length
        expect(new Set(nos).size, `${where}: 같은 번호 두 번 등록 ${JSON.stringify(h.registered)}`).toBe(nos.length)
        expect(h.undone, `${where}: 되돌림`).toEqual([])
        expect(h.fixes, `${where}: 같은 조각을 다시 읽어 고침`).toEqual([])
      }),
      { numRuns: 120 },
    )
    expect(total, '등록이 한 번도 일어나지 않은 공격').toBeGreaterThan(10)
  })
})
