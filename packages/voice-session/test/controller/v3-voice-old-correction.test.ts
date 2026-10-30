// AC-V3-92 (R-22 4 (가), D-V3-101·106 — 실방송 경성 1번 몇 시간 뒤 "1번 … 퍼플이 아니에요 … 퍼플 2만 원까지"):
// 오래전 상품(이 콘솔이 방금 등록·고친 번호가 아님)은 품종이 함께 바뀌면 정정 낱말로 바로 고치지 않는다. 가격만이면 그대로 바로.
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
    currentNames: () => ['청사과', '퍼플', '라울'],
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

const old = (h: Harness, name: string): void => {
  h.board.set(1, { key: 'b1:1', name, price: 330_000, claimCount: 0, closed: false, status: 'OPEN' })
}
const ONCE = '다른 가격이 한 번만 들려 저절로 고치지 않았어요.'

describe('AC-V3-92 오래전 상품은 품종이 함께 바뀌면 정정 낱말로 바로 고치지 않는다 (D-V3-106)', () => {
  it('(1) "1번 퍼플이 아니에요 퍼플 2만 원까지" 한 번 → 1번 그대로, 고칠까요 카드(20,000원·퍼플, 까닭 한 번 들림)', async () => {
    const h = await ready()
    old(h, '청사과')
    FakeRecognition.last.final('1번 퍼플이 아니에요 퍼플 2만 원까지')
    await settle()
    at(8_000)
    await settle()
    expect(h.fixes).toEqual([])
    const list = asks(h)
    expect(list.map((item) => [item.no, item.changes, item.note])).toEqual([[1, { price: 20_000, name: '퍼플' }, ONCE]])
  })

  it('(2) 그 뒤 60초 안 다른 조각에서 "1번 퍼플 2만 원"을 또 들으면 바로 고침', async () => {
    const h = await ready()
    old(h, '청사과')
    FakeRecognition.last.final('1번 퍼플이 아니에요 퍼플 2만 원까지')
    await settle()
    at(8_000)
    await settle()
    FakeRecognition.last.final('1번 퍼플 2만 원')
    await settle()
    at(16_000)
    await settle()
    expect(h.fixes).toEqual([{ id: 'b1:1', changes: { price: 20_000, name: '퍼플' } }])
  })

  it('(3) 가격만 "1번 아니 2만 원" → 지금처럼 바로 20,000원', async () => {
    const h = await ready()
    old(h, '청사과')
    FakeRecognition.last.final('1번 아니 2만 원')
    await settle()
    at(8_000)
    await settle()
    expect(h.fixes).toEqual([{ id: 'b1:1', changes: { price: 20_000 } }])
  })

  // 'N번 … 아니 가격' 길(TD-V3-013)은 가격만 고친다 — 카드도 가격 칸만
  it('(5) 품종이 빈 오래전 상품에 "1번 라울 아니 2만 원" → 품종 채우기도 품종이라 카드', async () => {
    const h = await ready()
    old(h, '')
    FakeRecognition.last.final('1번 라울 아니 2만 원')
    await settle()
    at(8_000)
    await settle()
    expect(h.fixes).toEqual([])
    expect(asks(h).map((item) => [item.no, item.changes, item.note])).toEqual([[1, { price: 20_000 }, ONCE]])
  })

  it('(4) 고쳐 말함(이 콘솔이 음성으로 등록한 지 30초) "1번 퍼플이 아니에요 퍼플 2만 원" → 지금처럼 바로 고침', async () => {
    const h = await ready()
    FakeRecognition.last.final('1번 청사과 33만 원')
    await settle()
    at(6_000)
    await settle()
    expect(reg(h)).toEqual([[1, 330_000]])
    at(30_000)
    FakeRecognition.last.final('1번 퍼플이 아니에요 퍼플 2만 원')
    await settle()
    at(38_000)
    await settle()
    expect(h.fixes).toEqual([{ id: 'b1:1', changes: { price: 20_000, name: '퍼플' } }])
  })
})
