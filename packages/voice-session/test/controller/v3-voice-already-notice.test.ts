// 이미 있는 번호 알림 (D-VOICE-EXISTS-01, 사용자 2026-11-17 "12번 상품을 다시 말했을 때 아무 피드백 없이 무시하는게 … 인식을 못해서 등록이 안 된건지
// 아니면 이미 있어서 등록 안 된건지"): 들은 번호가 이미 있어 새로 등록하지 않으면 스냅샷 already에 남는다 — 휴대폰 화면이 잠깐 띄운다.
// 방금 이 기기가 음성으로 등록한 번호의 되풀이(같은 덩어리·10초 안)는 알리지 않는다. 실제 음성 모듈 + 가짜 인식 객체 + 가짜 시계.
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

const already = (h: Harness) => h.voice.getSnapshot().already
const earlier = (h: Harness, no: number, price: number): void => {
  h.board.set(no, { key: `b1:${String(no)}`, name: '녹금', price, claimCount: 0, closed: false, status: 'OPEN' })
}

describe('이미 있는 번호 알림 (D-VOICE-EXISTS-01)', () => {
  it('예전에 등록한 12번을 같은 가격으로 다시 말함 → 등록 0, 알림 12번(값 같음)', async () => {
    const h = await ready()
    earlier(h, 12, 30_000)
    at(1_000)
    FakeRecognition.last.final('12번 3만 원')
    await settle()
    at(10_000)
    await settle()
    expect(reg(h)).toEqual([])
    expect(h.fixes).toEqual([])
    expect(already(h)).toMatchObject({ no: 12, differs: false })
  })

  it('예전에 등록한 12번을 다른 가격으로 한 번 말함 → 고침 0, 알림 12번(값 다름)', async () => {
    const h = await ready()
    earlier(h, 12, 30_000)
    at(1_000)
    FakeRecognition.last.final('12번 5만 원')
    await settle()
    at(10_000)
    await settle()
    expect(reg(h)).toEqual([])
    expect(h.fixes).toEqual([])
    expect(already(h)).toMatchObject({ no: 12, differs: true })
  })

  it('방금 음성으로 등록한 12번의 되풀이(10초 안) → 알림 없음', async () => {
    const h = await ready()
    const rec = FakeRecognition.last
    at(1_000)
    rec.final('12번 3만 원')
    await settle()
    at(4_000)
    rec.final('12번 3만 원이요')
    await settle()
    at(10_000)
    await settle()
    expect(reg(h)).toEqual([[12, 30_000]])
    expect(already(h)).toBeNull()
  })

  it('음성으로 등록하고 한참 뒤 같은 12번을 다시 말함 → 알림, 같은 번호는 10초 안에 한 번만', async () => {
    const h = await ready()
    const rec = FakeRecognition.last
    at(1_000)
    rec.final('12번 3만 원')
    await settle()
    at(30_000)
    rec.final('12번 3만 원')
    await settle()
    at(33_000)
    await settle()
    expect(reg(h)).toEqual([[12, 30_000]])
    const first = already(h)
    expect(first).toMatchObject({ no: 12, differs: false })
    at(35_000)
    rec.final('12번 3만 원')
    await settle()
    at(38_000)
    await settle()
    expect(already(h)).toEqual(first)
  })
})
