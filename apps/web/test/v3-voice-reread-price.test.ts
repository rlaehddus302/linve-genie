// 맞게 등록한 가격을 뒤에 틀린 값으로 고치던 두 길 (실방송 재생 BROKEN_BY_FIX — 경성 45번·63번):
// (가) 가격만 고쳐 말함(R-22 5, D-V3-84 (ㄱ) "마지막 음성 새 등록 뒤"): 등록보다 **먼저** 한 말(앞 덩어리 글)을 덩어리 끝에서 다시 읽어 방금 등록한 상품을 고치지 않는다.
// (나) 가격 고침 문턱(R-22 4 (나), D-V3-83 "같은 조각을 다시 읽은 것은 한 번"): 한 크롬 결과 안에서 크롬이 중간 글을 고쳐 써 조각 자리가 옮겨져도
//      판매자가 한 번 말한 다른 가격은 한 번 들음이다 — 바로 고치지 않고 묻는다. 다른 크롬 결과에서 다시 말하면 그때는 바로 고친다.
// 실제 음성 모듈 + 가짜 인식 객체 + 가짜 시계. 말은 지어낸 문장이다.
import * as voiceModule from '@livejjim/voice'
import type { SuggestionCard, VoiceSettings } from '@livejjim/voice'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceController, type ExistingView, type VoiceHost } from '../src/voice/controller.ts'

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
  /** 아직 최종이 아닌 자리들 (크롬은 한 결과를 여러 자리로 갈라 내기도 한다) */
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
    maxNumber: () => 999,
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
      const key = `b1:${String(registration.no)}`
      state.board.set(registration.no, { key, name: registration.name, price: registration.price, claimCount: 0, closed: false, status: 'OPEN' })
      queueMicrotask(() => voice.noteVoiceRegistered({ id: key, no: registration.no, name: registration.name, price: registration.price }))
    },
    focusQuick: () => {},
    fixRecent: async (id, changes) => {
      state.fixes.push({ id, changes })
      const no = Number(id.split(':')[1])
      const item = state.board.get(no)
      if (item !== undefined) state.board.set(no, { ...item, ...(changes.price === undefined ? {} : { price: changes.price }), ...(changes.name === undefined ? {} : { name: changes.name }) })
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
const prices = (h: Harness) => h.fixes.map((item) => item.changes.price)
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

describe('(가) 가격만 고쳐 말함은 등록 뒤에 한 말만 (D-V3-84 ㄱ)', () => {
  it('앞 덩어리 "… 다시 한 번 보시고요 … 아까 8만 원 드렸는데"(번호 없음) 뒤 "45번 7만 원" 등록 → 다음 결과가 앞 덩어리를 끊어도 45번 70,000원 그대로, 바로 고침 0', async () => {
    const h = await ready()
    const rec = FakeRecognition.last
    at(1_000)
    rec.final('이 아이는 잎 끝이 살짝 마른 게 보여요 다시 한 번 보시고요 값을 좀 내릴게요 아까 8만 원 드렸는데')
    await settle()
    at(1_500)
    rec.interim('자 이 아이 7만 원 자 45번 7만 원')
    await settle()
    at(3_000)
    await settle()
    expect(reg(h)).toEqual([[45, 70_000]])
    // 이 최종 결과가 "번호 다름"으로 앞 덩어리(번호 없는 글)를 끊는다 — 그 덩어리 끝에서 앞 글을 다시 읽는다
    rec.final('자 이 아이 7만 원 자 45번 7만 원')
    await settle()
    at(12_000)
    await settle()
    expect(reg(h)).toEqual([[45, 70_000]])
    expect(h.fixes).toEqual([])
    expect(h.board.get(45)?.price).toBe(70_000)
  })

  it('등록 뒤에 한 "아니 8만 원"(번호 없음, 정정 낱말)은 지금처럼 바로 고침 80,000원', async () => {
    const h = await ready()
    const rec = FakeRecognition.last
    at(1_000)
    rec.final('자 45번 7만 원')
    await settle()
    at(2_000)
    await settle()
    expect(reg(h)).toEqual([[45, 70_000]])
    at(4_000)
    rec.final('아니 8만 원')
    await settle()
    at(12_000)
    await settle()
    expect(prices(h)).toEqual([80_000])
  })
})

describe('(나) 한 크롬 결과를 고쳐 쓴 같은 말은 한 번 들음 (D-V3-83 나)', () => {
  it('110,000원 등록 뒤 다음 결과 "63번 … 만 원"이 두 자리로 갈렸다가 한 자리로 합쳐져도 바로 고침 0, 고칠까요 카드(10,000원)', async () => {
    const h = await ready()
    const rec = FakeRecognition.last
    at(1_000)
    rec.final('이 아이는 잘라 심어도 돼요 황소개구리 11만 원 갈게요 63번 황소개구리 11만 원')
    await settle()
    at(2_000)
    await settle()
    expect(reg(h)).toEqual([[63, 110_000]])
    // 다음 결과: 앞 낱말이 1초 넘게 그대로(굳은 글) → 크롬이 뒤를 다른 자리로 갈라 냄 → 다시 한 자리로 합침 → 최종
    at(3_000)
    rec.interim('자 63번 황소개구리')
    await settle()
    at(4_300)
    await settle()
    rec.interim('자 63번 황소개구리', '만')
    await settle()
    at(4_320)
    rec.interim('자 63번 황소개구리', '만 원')
    await settle()
    at(4_900)
    rec.interim('자 63번 황소개구리 만 원')
    await settle()
    at(5_100)
    rec.interim('자 63번 황소개구리 만 원 갈게요')
    await settle()
    at(7_000)
    rec.final('자 63번 황소개구리 만 원 갈게요 고맙습니다')
    await settle()
    at(15_000)
    await settle()
    expect(reg(h)).toEqual([[63, 110_000]])
    expect(h.fixes).toEqual([])
    expect(h.board.get(63)?.price).toBe(110_000)
    const list = asks(h)
    expect(list.map((item) => [item.no, item.changes])).toEqual([[63, { price: 10_000 }]])
  })

  it('다른 크롬 결과에서 같은 새 가격을 다시 말하면(같은 덩어리) 지금처럼 두 번 들음 → 바로 고침', async () => {
    const h = await ready()
    const rec = FakeRecognition.last
    at(1_000)
    rec.final('자 64번 라울 80만 원')
    await settle()
    at(2_000)
    await settle()
    expect(reg(h)).toEqual([[64, 800_000]])
    at(3_000)
    rec.interim('64번 2만 원')
    await settle()
    at(3_500)
    rec.final('64번 2만 원')
    await settle()
    expect(h.fixes).toEqual([])
    expect(asks(h).map((item) => [item.no, item.changes])).toEqual([[64, { price: 20_000 }]])
    at(5_000)
    rec.interim('자 64번 2만 원')
    await settle()
    at(5_500)
    rec.final('자 64번 2만 원 드려요')
    await settle()
    at(15_000)
    await settle()
    expect(prices(h)).toEqual([20_000])
  })

  it('한 결과 안에서 그 번호·같은 새 가격을 정말 두 번 말하면("63번 만 원 … 63번 만 원") 지금처럼 바로 고침', async () => {
    const h = await ready()
    const rec = FakeRecognition.last
    at(1_000)
    rec.final('자 63번 황소개구리 11만 원')
    await settle()
    at(2_000)
    await settle()
    expect(reg(h)).toEqual([[63, 110_000]])
    at(3_000)
    rec.interim('63번 만 원 드릴게요')
    await settle()
    at(3_600)
    rec.interim('63번 만 원 드릴게요 자 63번 만 원')
    await settle()
    at(5_000)
    rec.final('63번 만 원 드릴게요 자 63번 만 원 드려요')
    await settle()
    at(15_000)
    await settle()
    expect(prices(h)).toEqual([10_000])
  })
})
