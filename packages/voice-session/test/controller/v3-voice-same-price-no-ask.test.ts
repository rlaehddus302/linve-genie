// 값이 같은 묻기 카드 없음 (D-V3-83·103·109, 실방송 재생 "333번을 고칠까요? 가격 330,000원 → 330,000원"): 들은 가격이 지금 상품 가격과 같으면
// 바꿀 것이 없으니 카드도 쓰기도 없다. 중간 글 가격만 달랐던 경우(D-V3-103)도 최종 글이 지금 가격과 같으면 이미 맞게 등록된 것이다.
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

const offers = (h: Harness) => h.voice.getSnapshot().offers
/** 모든 카드 문장에 "A원 → A원" 같은 값 바꿈이 없어야 한다 */
const noSameArrow = (h: Harness): void => {
  for (const item of offers(h)) expect(item.message).not.toMatch(/(?<![\d,])([\d,]+원) → \1/)
}

describe('값이 같으면 고칠까요 카드 없음 (D-V3-83·103)', () => {
  it('(1) 333번 330,000원 등록 뒤 다른 결과: 중간 "333번 3만 원" → 최종 "333번 33만 원" → 카드 0, 고침 0', async () => {
    const h = await ready()
    const rec = FakeRecognition.last
    at(1_000)
    rec.final('333번 33만 원')
    await settle()
    at(9_000)
    await settle()
    expect(reg(h)).toEqual([[333, 330_000]])
    at(12_000)
    rec.interim('333번 3만 원')
    await settle()
    at(12_400)
    rec.final('333번 33만 원')
    await settle()
    at(30_000)
    await settle()
    expect(reg(h)).toEqual([[333, 330_000]])
    expect(h.fixes).toEqual([])
    expect(asks(h)).toEqual([])
    noSameArrow(h)
  })

  it('(2) 같은 결과 안: 중간 "341번 20만 원"으로 등록, 이어 중간 "341번 2만 원" → 최종 "341번 20만 원" → 등록 하나, 카드 0', async () => {
    const h = await ready()
    const rec = FakeRecognition.last
    at(1_000)
    rec.interim('341번 20만 원')
    await settle()
    at(1_500)
    await settle()
    at(1_800)
    rec.interim('341번 2만 원')
    await settle()
    at(2_200)
    rec.final('341번 20만 원')
    await settle()
    at(20_000)
    await settle()
    expect(reg(h)).toEqual([[341, 200_000]])
    expect(h.fixes).toEqual([])
    expect(asks(h)).toEqual([])
    noSameArrow(h)
  })

  it('(3) 같은 번호를 같은 가격으로 여러 번 다시 말함(다른 결과마다) → 카드 0, 고침 0', async () => {
    const h = await ready()
    const rec = FakeRecognition.last
    at(1_000)
    rec.final('333번 33만 원')
    await settle()
    at(5_000)
    rec.final('333번 33만 원이에요')
    await settle()
    at(12_000)
    rec.final('333번 33만 원')
    await settle()
    at(30_000)
    await settle()
    expect(reg(h)).toEqual([[333, 330_000]])
    expect(h.fixes).toEqual([])
    expect(asks(h)).toEqual([])
    noSameArrow(h)
  })

  it('(4) 등록 응답 전: 중간 "333번 33만 원"으로 보내는 중, 중간 "333번 3만 원" → 최종 "333번 33만 원" → 카드 0', async () => {
    const h = await ready()
    const rec = FakeRecognition.last
    at(1_000)
    rec.interim('333번 33만 원')
    await settle()
    at(1_500)
    rec.interim('333번 3만 원')
    rec.final('333번 33만 원')
    await settle()
    at(20_000)
    await settle()
    expect(reg(h)).toEqual([[333, 330_000]])
    expect(h.fixes).toEqual([])
    expect(asks(h)).toEqual([])
    noSameArrow(h)
  })

  it('(5) 대조: 등록 330,000원 뒤 중간 "333번 33만 원" → 최종 "333번 3만 원"이면 묻기 카드 하나(30,000원)', async () => {
    const h = await ready()
    const rec = FakeRecognition.last
    at(1_000)
    rec.final('333번 33만 원')
    await settle()
    at(12_000)
    rec.interim('333번 33만 원')
    await settle()
    at(12_400)
    rec.final('333번 3만 원')
    await settle()
    at(30_000)
    await settle()
    expect(reg(h)).toEqual([[333, 330_000]])
    expect(h.fixes).toEqual([])
    const list = asks(h)
    expect(list.map((item) => [item.no, item.changes, item.message])).toEqual([[333, { price: 30_000 }, '333번을 고칠까요? 가격 330,000원 → 30,000원']])
    noSameArrow(h)
  })
})
