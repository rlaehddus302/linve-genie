// 실방송 경성다육 재생 시험 (R-17 8 6 기다리는 번호, D-V3-67): 기다리는 번호는 끝난 조각(최종·굳은 글)의 번호 없는 원 가격만 받는다.
// 중간 결과 끝의 "… 5만 원"은 바로 뒤에 "그러니까 29번 5만 원"이 이어질 수 있고, 크롬이 한 결과를 둘로 갈라
// 뒤 결과에 "3만 원"만 남겨도(앞 결과 "… 자 24번") 번호 없는 가격처럼 보인다 — 그때 기다리던 번호가 받으면 남의 가격으로 등록된다.
// 실제 음성 모듈 + 가짜 인식 객체 + 가짜 시계. 시험 문장은 번호·품종·가격만으로 다시 썼다.
import * as voiceModule from '@livejjim/voice'
import type { SuggestionCard, VoiceSettings } from '@livejjim/voice'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceController, type ExistingView, type VoiceHost } from '../../src/controller/controller.ts'

const T0 = Date.UTC(2026, 9, 25, 7, 30, 0)

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
  /** 최종으로 굳은 결과 수 (그 뒤는 중간 결과) */
  done = 0
  constructor() {
    FakeRecognition.all.push(this)
  }
  start(): void {}
  stop(): void {}
  abort(): void {}
  /** 아직 굳지 않은 결과들을 이 글들로 바꿔 낸다 (크롬처럼 중간 결과가 여럿일 수 있다) */
  interim(...texts: string[]): void {
    this.results = [...this.results.slice(0, this.done), ...texts.map((text) => ({ isFinal: false, length: 1, 0: { transcript: text } }))]
    this.onresult?.({ resultIndex: this.done, results: this.results })
  }
  /** 굳지 않은 첫 결과를 최종으로 낸다 */
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
    },
    focusQuick: () => {},
    fixRecent: async (id, changes) => {
      state.fixes.push({ id, changes })
      return { kind: 'fixed', before: {} }
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
const reg = (h: Harness) => h.registered.map((item) => [item.no, item.price])
/** 열린 "N번 가격을 못 들었어요" 카드 번호 */
const missedCards = (h: Harness) => h.voice.getSnapshot().cards.filter((card) => card.status === 'OPEN' && card.price === null).map((card) => card.no)

/** 한 결과의 중간 글을 낱말마다 120ms씩 늘린다 — 마지막 낱말을 낸 시각을 돌려준다 */
function grow(text: string, from: number): number {
  const words = text.split(' ')
  let t = from
  for (let i = 1; i <= words.length; i++) {
    t = from + (i - 1) * 120
    at(t)
    FakeRecognition.last.interim(words.slice(0, i).join(' '))
  }
  return t
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
  FakeRecognition.last.onaudiostart?.()
  return h
}

/** 가격 없이 "19번"만 든 조각 → 19번이 기다리는 번호 (상품 없음) */
async function waitFor(h: Harness, no: number): Promise<void> {
  FakeRecognition.last.final(`자 ${String(no)}번 올라왔죠`)
  at(4_000)
  await settle()
  expect(h.registered).toEqual([])
}

describe('R-17 8 6 기다리는 번호는 중간 결과의 가격으로 받지 않는다 (실방송 경성다육 19번·30번)', () => {
  it('중간 결과 "… 얘는 5만 원" 뒤에 "그러니까 29번 5만 원"이 이어지면 → 29번만 50,000원, 19번은 가격 못 들은 번호 카드', async () => {
    const h = await ready()
    await waitFor(h, 19)
    const sentence = '풀잎사랑 얘는 좀 큰 사이즈고 커팅 얘는 5만 원 그러니까 29번 5만 원 요거는 첫 번째'
    const last = grow(sentence, 10_000)
    at(last + 800)
    FakeRecognition.last.final(sentence)
    at(last + 8_000)
    await settle()
    expect(reg(h)).toEqual([[29, 50_000]])
    expect(missedCards(h)).toEqual([19])
  })

  it('크롬이 한 결과를 둘로 가름: 앞 "… 자 24번" · 뒤 "3만 원" → 24번만 30,000원, 기다리던 30번은 카드', async () => {
    const h = await ready()
    await waitFor(h, 30)
    const rec = FakeRecognition.last
    at(10_000)
    rec.interim('요거 세 번째 보내게 드릴게요 자')
    at(10_200)
    rec.interim('요거 세 번째 보내게 드릴게요 자', '24번')
    at(10_300)
    rec.interim('요거 세 번째 보내게 드릴게요 자', '24번 3만 원')
    at(10_500)
    rec.interim('요거 세 번째 보내게 드릴게요 자 24번', '3만 원')
    at(11_200)
    rec.final('요거 세 번째 보내게 드릴게요 자 24번 3만 원')
    at(18_000)
    await settle()
    expect(reg(h)).toEqual([[24, 30_000]])
    expect(missedCards(h)).toEqual([30])
  })

  it('그대로인 것: 끝난 조각(최종)의 번호 없는 원 가격은 기다리던 번호가 이어 받는다 → 19번 50,000원', async () => {
    const h = await ready()
    await waitFor(h, 19)
    const sentence = '풀잎사랑 얘는 좀 큰 사이즈고 커팅 얘는 5만 원'
    const last = grow(sentence, 10_000)
    at(last + 800)
    FakeRecognition.last.final(sentence)
    at(last + 8_000)
    await settle()
    expect(reg(h)).toEqual([[19, 50_000]])
    expect(missedCards(h)).toEqual([])
  })
})
