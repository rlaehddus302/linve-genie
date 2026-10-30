// AC-V3-93 (R-17 8 7, D-V3-102 — 실방송 경성 159→59): 앞 크롬 결과 끝 수와 이어질 수 있는 새 결과 첫 'N번'은
// 바로 등록·바로 고치지 않고 묻는다 (없는 번호 → 이은 번호 제안 카드, 있는 번호 → 다른 화분일 수 있음 카드).
// 실제 음성 모듈 + 가짜 인식 객체 + 가짜 시계.
import * as voiceModule from '@livejjim/voice'
import type { SuggestionCard, VoiceSettings } from '@livejjim/voice'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceController, type ExistingView, type VoiceHost } from '../../src/controller/controller.ts'

const T0 = Date.UTC(2026, 9, 25, 8, 50, 0)

interface FakeResult {
  isFinal: boolean
  length: number
  0: { transcript: string }
}

class FakeRecognition {
  static readonly all: FakeRecognition[] = []
  lang = ''
  continuous = false
  interimResults = false
  onresult: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onend: (() => void) | null = null
  onaudiostart: (() => void) | null = null
  results: FakeResult[] = []
  done = 0
  constructor() {
    FakeRecognition.all.push(this)
  }
  start(): void {}
  stop(): void {}
  abort(): void {}
  interim(...texts: string[]): void {
    this.results = [...this.results.slice(0, this.done), ...texts.map((text) => ({ isFinal: false, length: 1, 0: { transcript: text } }))]
    this.onresult?.({ resultIndex: this.done, results: this.results })
  }
  final(text: string): void {
    this.results = [...this.results.slice(0, this.done), { isFinal: true, length: 1, 0: { transcript: text } }]
    this.onresult?.({ resultIndex: this.done, results: this.results })
    this.done = this.results.length
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

function harness(): Harness {
  const state = { registered: [] as Harness['registered'], fixes: [] as Harness['fixes'], board: new Map<number, ExistingView>() }
  const host: VoiceHost = {
    load: async () => voiceModule,
    now: () => Date.now(),
    maxNumber: () => 300,
    priceUnit: () => 'THOUSAND',
    deviceId: () => 'this-device',
    lastVoiceDevice: () => null,
    currentNames: () => [],
    products: () => new Map([...state.board].map(([no, item]) => [no, item.closed])),
    fetchHistory: async () => [],
    dialogOpen: () => false,
    readConsent: () => true,
    writeConsent: () => {},
    readSettings: () => null,
    writeSettings: (_settings: VoiceSettings) => {},
    register: (card, registration, source) => {
      state.registered.push({ card, ...registration, source })
      // 콘솔이 등록을 마침 (상품 보드에 생기고 음성에 알린다)
      const key = `b1:${String(registration.no)}`
      state.board.set(registration.no, { key, name: registration.name, price: registration.price, claimCount: 0, closed: false, status: 'OPEN' })
      queueMicrotask(() => voice.noteVoiceRegistered({ id: key, no: registration.no, name: registration.name, price: registration.price }))
    },
    focusQuick: () => {},
    fixRecent: async (id, changes) => {
      state.fixes.push({ id, changes })
      return { kind: 'fixed', before: {} }
    },
    undoRecent: () => true,
    existingProduct: (no: number) => state.board.get(no) ?? null,
  }
  const voice = new VoiceController(host)
  return Object.assign(state, { voice })
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}
const at = (ms: number): void => {
  vi.advanceTimersByTime(T0 + ms - Date.now())
}
const reg = (h: Harness) => h.registered.map((item) => [item.no, item.price])
const asks = (h: Harness) => h.voice.getSnapshot().offers.filter((item) => item.stage === 'ask')

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
  FakeRecognition.last.onaudiostart?.()
  return h
}

const openCards = (h: Harness) => h.voice.getSnapshot().cards.filter((card) => card.status === 'OPEN').map((card) => [card.no, card.price])

describe('AC-V3-93 앞 결과와 이어질 수 있는 번호는 묻는다 (D-V3-102)', () => {
  it('(1) 결과 "자 이 아이 3만 원 159"가 끝나고 1초 뒤 새 결과 "59번 3만 원" → 등록 0, 제안 카드(159번, 30,000원, 안내)', async () => {
    const h = await ready()
    const rec = FakeRecognition.last
    at(1_000)
    rec.final('자 이 아이 3만 원 159')
    await settle()
    at(2_000)
    rec.interim('59번 3만 원')
    at(2_600)
    rec.final('59번 3만 원')
    await settle()
    at(10_000)
    await settle()
    expect(reg(h)).toEqual([])
    expect(openCards(h)).toEqual([[159, 30_000]])
    const card = h.voice.getSnapshot().cards.find((item) => item.no === 159)
    expect(card === undefined ? null : h.voice.getSnapshot().notes.get(card.id)).toBe('59번으로 들렸어요. 159번이 맞는지 확인해 주세요')
  })

  it('(5) 앞 결과 끝이 가격 줄 "3만 원"이면 해당 없음 → "59번 3만 원" 바로 등록', async () => {
    const h = await ready()
    const rec = FakeRecognition.last
    at(1_000)
    rec.final('자 이 아이 3만 원')
    await settle()
    at(2_000)
    rec.final('59번 3만 원')
    await settle()
    at(10_000)
    await settle()
    expect(reg(h)).toEqual([[59, 30_000]])
  })

  it('(6) 앞 결과가 끝난 지 10,001ms 뒤면 해당 없음 → 바로 등록', async () => {
    const h = await ready()
    const rec = FakeRecognition.last
    at(1_000)
    rec.final('자 이 아이 3만 원 159')
    await settle()
    at(11_001)
    rec.final('59번 3만 원')
    await settle()
    at(20_000)
    await settle()
    expect(reg(h)).toEqual([[59, 30_000]])
  })

  it('(8) 59번이 이미 있고 앞 결과 끝 "159" → 59번 고치지 않고 다른 화분일 수 있음 카드', async () => {
    const h = await ready()
    h.board.set(59, { key: 'b1:59', name: '', price: 120_000, claimCount: 0, closed: false, status: 'OPEN' })
    const rec = FakeRecognition.last
    at(1_000)
    rec.final('자 이 아이 3만 원 159')
    await settle()
    at(2_000)
    rec.final('59번 3만 원')
    await settle()
    at(10_000)
    await settle()
    expect(reg(h)).toEqual([])
    expect(h.fixes).toEqual([])
    const list = asks(h)
    expect(list.map((item) => [item.no, item.changes, item.maybeOther])).toEqual([[59, { price: 30_000 }, true]])
  })

  it('(10) 앞 결과로 159번 30,000원이 이미 등록됐고 새 결과 "59번 3만 원" → 아무것도 하지 않음', async () => {
    const h = await ready()
    const rec = FakeRecognition.last
    at(1_000)
    rec.final('159번 3만 원 159')
    await settle()
    at(2_000)
    expect(reg(h)).toEqual([[159, 30_000]])
    rec.final('59번 3만 원')
    await settle()
    at(10_000)
    await settle()
    expect(reg(h)).toEqual([[159, 30_000]])
    expect(openCards(h)).toEqual([])
    expect(asks(h)).toEqual([])
  })
})

describe('AC-V3-96 앞 결과 끝이 번호 표시여도 ⓐ (D-V3-107)', () => {
  it('(1) 결과 "자 이 아이 159번" 뒤 1초에 "59번 3만 원" → 등록 0, 제안 카드(159번, 30,000원)', async () => {
    const h = await ready()
    const rec = FakeRecognition.last
    at(1_000)
    rec.final('자 이 아이 159번')
    await settle()
    at(2_000)
    rec.final('59번 3만 원')
    await settle()
    at(70_000)
    await settle()
    expect(reg(h)).toEqual([])
    expect(openCards(h)).toContainEqual([159, 30_000])
    expect(openCards(h).some(([no]) => no === 59)).toBe(false)
  })

  it('(3) "23번" 뒤 "1번 2만 원" → 해당 없음, 1번 바로 등록', async () => {
    const h = await ready()
    const rec = FakeRecognition.last
    at(1_000)
    rec.final('자 요거 23번')
    await settle()
    at(2_000)
    rec.final('1번 2만 원')
    await settle()
    at(10_000)
    await settle()
    expect(reg(h)).toEqual([[1, 20_000]])
  })

  it('(5) 159번 30,000원이 이미 있고 "자 이 아이 159번" 뒤 "59번 3만 원" → 아무것도 안 함', async () => {
    const h = await ready()
    h.board.set(159, { key: 'b1:159', name: '', price: 30_000, claimCount: 0, closed: false, status: 'OPEN' })
    const rec = FakeRecognition.last
    at(1_000)
    rec.final('자 이 아이 159번')
    await settle()
    at(2_000)
    rec.final('59번 3만 원')
    await settle()
    at(10_000)
    await settle()
    expect(reg(h)).toEqual([])
    expect(openCards(h)).toEqual([])
    expect(asks(h)).toEqual([])
  })

  it('글 끝 "원까지"로 기다리는 조각(새 등록만 바로 하는 길)도 같다: "자 이 아이 159번" 뒤 중간 "59번 3만 원까지" → 등록 0, 159번 카드', async () => {
    const h = await ready()
    const rec = FakeRecognition.last
    at(1_000)
    rec.final('자 이 아이 159번')
    await settle()
    at(2_000)
    rec.interim('59번 3만 원까지')
    await settle()
    at(2_300)
    await settle()
    expect(reg(h)).toEqual([])
    expect(openCards(h)).toContainEqual([159, 30_000])
  })

  it('크롬이 한 결과를 여러 자리로 갈라 낸 뒤 자리 "2번인데"는 새 결과 처음이 아니다 — 앞 결과 끝 "30"과 잇지 않는다 (실방송 경성 2번)', async () => {
    const h = await ready()
    const rec = FakeRecognition.last
    at(1_000)
    rec.final('아까 30 자')
    await settle()
    at(2_000)
    rec.interim('32만 원까지가 봅니다 요거')
    at(2_200)
    rec.interim('32만 원까지가 봅니다 요거', '2번인데')
    await settle()
    at(3_000)
    rec.final('32만 원까지가 봅니다 요거 2번인데 자 2번 자 32만 원까지')
    await settle()
    at(10_000)
    await settle()
    expect(h.voice.getSnapshot().log.some((entry) => (entry.reason ?? '').includes('302번'))).toBe(false)
    expect(openCards(h).some(([no]) => no === 302)).toBe(false)
  })
})

