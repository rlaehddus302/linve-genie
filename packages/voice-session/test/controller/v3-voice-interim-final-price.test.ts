// AC-V3-94 (R-17 8 중간·최종 가격 다름, D-V3-103 — 실방송 경성 63번 중간 "11만 원" → 최종 "만 원"):
// 같은 크롬 결과 안에서 같은 번호에 짝지은 확정 가격이 중간 글과 최종 글에서 다르면 그 결과로는 바로 등록·바로 고침을 하지 않는다.
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

describe('AC-V3-94 같은 결과의 중간·최종 가격이 다르면 묻는다 (D-V3-103)', () => {
  it('(1) 중간 글 "63번 11만 원"으로 110,000원 등록, 같은 결과의 최종 "63번 만 원" → 110,000원 그대로, 고칠까요 카드(10,000원, 까닭에 두 가격)', async () => {
    const h = await ready()
    const rec = FakeRecognition.last
    at(1_000)
    rec.interim('63번 황소개구리')
    at(1_300)
    rec.interim('63번 황소개구리 11만 원')
    await settle()
    at(1_500)
    await settle()
    expect(reg(h)).toEqual([[63, 110_000]])
    at(2_200)
    rec.final('63번 황소개구리 만 원')
    await settle()
    at(9_000)
    await settle()
    expect(reg(h)).toEqual([[63, 110_000]])
    expect(h.fixes).toEqual([])
    const list = asks(h)
    expect(list).toHaveLength(1)
    expect(list[0]?.changes).toEqual({ price: 10_000 })
    expect(list[0]?.note).toBe('듣는 중엔 110,000원, 마지막엔 10,000원으로 들렸어요.')
  })

  it('(1b) 한 결과에 번호 둘: 중간 "62번 3만 원 63번 11만 원"(둘 다 등록) → 최종 "62번 3만 원 63번 만 원" → 62번은 그대로, 63번만 묻기', async () => {
    const h = await ready()
    const rec = FakeRecognition.last
    at(1_000)
    rec.interim('62번 3만 원 63번 황소개구리 11만 원')
    await settle()
    at(1_500)
    await settle()
    expect(reg(h)).toEqual([
      [62, 30_000],
      [63, 110_000],
    ])
    at(2_200)
    rec.final('62번 3만 원 63번 황소개구리 만 원')
    await settle()
    at(9_000)
    await settle()
    expect(reg(h)).toEqual([
      [62, 30_000],
      [63, 110_000],
    ])
    expect(h.fixes).toEqual([])
    const list = asks(h)
    expect(list.map((item) => [item.no, item.changes, item.note])).toEqual([[63, { price: 10_000 }, '듣는 중엔 110,000원, 마지막엔 10,000원으로 들렸어요.']])
  })

  it('(2) 중간·최종 가격이 같으면("63번 11만 원" → "63번 11만 원 자") 등록 하나, 고침 0, 카드 0', async () => {
    const h = await ready()
    const rec = FakeRecognition.last
    at(1_000)
    rec.interim('63번 황소개구리 11만 원')
    await settle()
    at(1_500)
    rec.final('63번 황소개구리 11만 원 자')
    await settle()
    at(9_000)
    await settle()
    expect(reg(h)).toEqual([[63, 110_000]])
    expect(h.fixes).toEqual([])
    expect(asks(h)).toEqual([])
  })

  it('(3) 다른 크롬 결과에서 다른 가격이 들린 것은 이 규칙이 아니다 — 한 번 들림 문턱(R-22 4) 그대로', async () => {
    const h = await ready()
    const rec = FakeRecognition.last
    at(1_000)
    rec.final('63번 황소개구리 11만 원')
    await settle()
    at(3_000)
    rec.final('63번 만 원')
    await settle()
    at(9_000)
    await settle()
    expect(reg(h)).toEqual([[63, 110_000]])
    expect(h.fixes).toEqual([])
    const list = asks(h)
    expect(list).toHaveLength(1)
    expect(list[0]?.note).toBe('다른 가격이 한 번만 들려 저절로 고치지 않았어요.')
  })
})
