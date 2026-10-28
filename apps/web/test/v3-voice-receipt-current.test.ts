// AC-V3-100 (k)·(l) (D-V3-116 (마)): 이번 방송 상품 이름이 영수증 거래명이면 판매 이력 자리에서도 적은 모양으로만 맞춘다.
// 지난 방송 판매 이력은 그대로(AC (j)). 실제 음성 모듈(기본 사전의 영수증 이름 창무지) + 가짜 인식 객체 + 가짜 시계. 만든 문장.
import type { PriceUnit } from '@livejjim/core'
import * as voiceModule from '@livejjim/voice'
import type { SuggestionCard, VoiceSettings } from '@livejjim/voice'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceController, type ExistingView, type RecentFixOutcome, type VoiceHost } from '../src/voice/controller.ts'

const T0 = Date.UTC(2026, 9, 28, 1, 0, 0)

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
  readonly written: unknown[]
  readonly fixes: { id: string; changes: { name?: string; price?: number } }[]
  /** 상품 보드 (번호 → 상품) */
  readonly board: Map<number, ExistingView>
  fixResult: RecentFixOutcome | null
  dialog: boolean
  readonly undone: string[]
  readonly moves: [number, number][]
  readonly fixOptions: unknown[]
  readonly archived: unknown[]
}

let namesCache: { board: Map<number, ExistingView>; key: string; names: string[] } | null = null
function namesOf(board: Map<number, ExistingView>): string[] {
  const key = [...board.values()].map((item) => item.name).join('|')
  if (namesCache !== null && namesCache.board === board && namesCache.key === key) return namesCache.names
  namesCache = { board, key, names: [...board.values()].map((item) => item.name) }
  return namesCache.names
}

function harness(options: { settings?: unknown; noBoard?: boolean; priceUnit?: PriceUnit; lastDevice?: Map<number, string>; renumberResult?: 'claimed'; past?: { date: string; names: string[] }[] } = {}): Harness {
  const state = {
    registered: [] as Harness['registered'],
    written: [] as unknown[],
    fixes: [] as Harness['fixes'],
    board: new Map<number, ExistingView>(),
    fixResult: null as RecentFixOutcome | null,
    dialog: false,
    undone: [] as string[],
    moves: [] as [number, number][],
    fixOptions: [] as unknown[],
    archived: [] as unknown[],
  }
  const host: VoiceHost = {
    load: async () => voiceModule,
    now: () => Date.now(),
    maxNumber: () => 999,
    priceUnit: () => options.priceUnit ?? 'WON',
    deviceId: () => 'this-device',
    lastVoiceDevice: (no) => options.lastDevice?.get(no) ?? null,
    // 화면처럼: 상품 보드가 바뀔 때만 새 목록 (ConsolePage useMemo)
    currentNames: () => namesOf(state.board),
    products: () => new Map([...state.board].map(([no, product]) => [no, product.closed])),
    fetchHistory: async () => options.past ?? [],
    dialogOpen: () => state.dialog,
    readConsent: () => true,
    writeConsent: () => {},
    readSettings: () => options.settings ?? null,
    writeSettings: (settings: VoiceSettings) => {
      state.written.push(settings)
    },
    register: (card, registration, source) => {
      state.registered.push({ card, ...registration, source })
    },
    focusQuick: () => {},
    fixRecent: async (id, changes, options) => {
      state.fixes.push({ id, changes })
      state.fixOptions.push(options ?? {})
      const product = [...state.board.values()].find((item) => item.key === id)
      return state.fixResult ?? { kind: 'fixed', before: { ...(changes.price !== undefined ? { price: product?.price ?? 0 } : {}), ...(changes.name !== undefined ? { name: product?.name ?? '' } : {}) } }
    },
    archiveChunk: (chunk) => {
      state.archived.push(chunk)
    },
    renumber: async (from, to) => {
      state.moves.push([from, to])
      if (options.renumberResult === 'claimed') return 'claimed'
      const item = state.board.get(from)
      if (item === undefined) return false
      state.board.delete(from)
      state.board.set(to, { ...item, key: `b1:${String(to)}` })
      return true
    },
    undoRecent: (id) => {
      state.undone.push(id)
      return true
    },
    ...(options.noBoard === true ? {} : { existingProduct: (no: number) => state.board.get(no) ?? null }),
  }
  const voice = new VoiceController(host)
  return Object.assign(state, { voice }) as unknown as Harness
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

const at = (ms: number): void => {
  vi.advanceTimersByTime(T0 + ms - Date.now())
}
const say = (text: string, final = true): void => FakeRecognition.last.say(text, final)
const reg = (h: Harness) => h.registered.map((item) => ({ no: item.no, name: item.name, price: item.price, source: item.source }))
const product = (no: number, name: string, price: number, claimCount = 0): ExistingView => ({ key: `b1:${String(no)}`, name, price, claimCount, closed: false })

beforeEach(() => {
  vi.useFakeTimers({ now: T0 - 5000 })
  FakeRecognition.all.length = 0
  vi.stubGlobal('SpeechRecognition', FakeRecognition)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function ready(options: Parameters<typeof harness>[0] = {}): Promise<Harness> {
  vi.setSystemTime(T0 - 5000)
  const h = harness(options)
  await h.voice.turnOn()
  await settle()
  at(0)
  return h
}

const asks = (h: Harness) => h.voice.getSnapshot().offers.filter((offer) => offer.stage === 'ask')

/** 콘솔이 등록을 마쳤다 (상품 보드에 생기고 음성에 알린다) */
function finish(h: Harness, index: number): void {
  const sent = h.registered[index]
  if (sent === undefined) throw new Error('보낸 등록이 없다')
  const key = `b1:${String(sent.no)}`
  h.board.set(sent.no, { key, name: sent.name, price: sent.price, claimCount: 0, closed: false, status: 'OPEN' })
  h.voice.noteVoiceRegistered({ id: key, no: sent.no, name: sent.name, price: sent.price })
}
const named = (h: Harness) => reg(h).map((item) => [item.no, item.name, item.price])

describe('AC-V3-100 (k)·(l) 이번 방송 상품 이름과 영수증 거래명 (D-V3-116 (마))', () => {
  it('(k) "15번 창무지 5만 원"으로 등록된 뒤 "16번 창무치"·"18번 근무지" → 품종 빈 칸, "19번 창무지" → 창무지', async () => {
    const h = await ready()
    say('15번 창무지 5만 원')
    at(3000)
    finish(h, 0)
    expect(named(h)).toEqual([[15, '창무지', 50_000]])
    say('16번 창무치 5만 원')
    at(6000)
    say('18번 근무지 5만 원')
    at(9000)
    say('19번 창무지 5만 원')
    at(12000)
    expect(named(h)).toEqual([
      [15, '창무지', 50_000],
      [16, '', 50_000],
      [18, '', 50_000],
      [19, '창무지', 50_000],
    ])
  })

  it('(k) 손으로 이번 방송에 등록한 창무지도 같다 · 17번 삼광색금이 있고 "17번 창무치 5만 원" → 17번 품종 그대로', async () => {
    const h = await ready()
    h.board.set(15, product(15, '창무지', 50_000))
    h.board.set(17, product(17, '삼광색금', 50_000))
    say('16번 창무치 5만 원')
    at(3000)
    say('17번 창무치 5만 원')
    at(6000)
    await settle()
    expect(named(h)).toEqual([[16, '', 50_000]])
    expect(h.fixes).toEqual([])
    expect(asks(h)).toEqual([])
  })

  it('(j) 지난 방송 판매 이력에 창무지가 있으면 지금 그대로 "16번 창무치 5만 원" → 창무지', async () => {
    const h = await ready({ past: [{ date: '2026-10-20', names: ['창무지'] }] })
    h.board.set(15, product(15, '창무지', 50_000))
    say('16번 창무치 5만 원')
    at(3000)
    expect(named(h)).toEqual([[16, '창무지', 50_000]])
  })

  it('(l) 영수증 거래명이 아닌 이번 방송 이름은 지금처럼 0.8 후보 — "16번 몽블랑코 5만 원" → 몽블랑크', async () => {
    const h = await ready()
    h.board.set(15, product(15, '몽블랑크', 50_000))
    say('16번 몽블랑코 5만 원')
    at(3000)
    expect(named(h)).toEqual([[16, '몽블랑크', 50_000]])
  })
})
