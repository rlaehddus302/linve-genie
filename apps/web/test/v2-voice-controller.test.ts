// V2 음성 컨트롤러 (AC-V2-09·13~30, D-V2-03~10) — 실제 음성 모듈 + 가짜 인식 객체 + 가짜 시계.
// 사례 S1~S21은 harness/sprints/V2/acceptance.md 표 그대로 (시각은 첫 최종 결과 = 0ms).
import * as voiceModule from '@livejjim/voice'
import type { LearnedAlias, SuggestionCard, VoiceSettings } from '@livejjim/voice'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OFFER_FIXED, VoiceController, type RecentFixOutcome, type VoiceHost } from '../src/voice/controller.ts'

const T0 = Date.UTC(2026, 9, 24, 1, 0, 0)

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
  learned: readonly LearnedAlias[] | null
  readonly fixes: { id: string; changes: { name?: string; price?: number } }[]
  readonly undone: string[]
  fixResult: RecentFixOutcome | null
  undoResult: boolean
}

function harness(options: { settings?: unknown; learned?: unknown } = {}): Harness {
  const state = {
    registered: [] as Harness['registered'],
    written: [] as unknown[],
    learned: (options.learned ?? null) as readonly LearnedAlias[] | null,
    fixes: [] as Harness['fixes'],
    undone: [] as string[],
    fixResult: null as RecentFixOutcome | null,
    undoResult: true,
  }
  const host: VoiceHost = {
    load: async () => voiceModule,
    now: () => Date.now(),
    maxNumber: () => 999,
    currentNames: () => [],
    products: () => new Map(),
    fetchHistory: async () => [],
    dialogOpen: () => false,
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
    readLearned: () => state.learned,
    writeLearned: (list) => {
      state.learned = list
    },
    fixRecent: async (id, changes) => {
      state.fixes.push({ id, changes })
      return state.fixResult ?? { kind: 'fixed', before: { ...(changes.price !== undefined ? { price: 15000 } : {}) } }
    },
    undoRecent: (id) => {
      state.undone.push(id)
      return state.undoResult
    },
  }
  const voice = new VoiceController(host)
  return Object.assign(state, { voice }) as unknown as Harness
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

async function on(h: Harness): Promise<void> {
  await h.voice.turnOn()
  await settle()
}

/** 시각 at(첫 결과 기준 ms)까지 시계를 넘긴다 */
const at = (ms: number): void => {
  vi.advanceTimersByTime(T0 + ms - Date.now())
}
const say = (text: string, final = true): void => FakeRecognition.last.say(text, final)
const view = (card: SuggestionCard | undefined) => (card === undefined ? undefined : { no: card.no, name: card.name, price: card.price })
const cards = (h: Harness) => h.voice.getSnapshot().cards
const AUTO = { 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5 }

beforeEach(() => {
  // 켜기(모듈·이력 받기)는 첫 결과 전에 끝난다: 시계는 T0 - 5000에서 시작해 켠 뒤 T0으로 맞춘다
  vi.useFakeTimers({ now: T0 - 5000 })
  FakeRecognition.all.length = 0
  vi.stubGlobal('SpeechRecognition', FakeRecognition)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function ready(options: Parameters<typeof harness>[0] = {}): Promise<Harness> {
  // 한 시험에서 여러 번 켜면(새로 고침) 시계를 켜기 전으로 돌린다
  vi.setSystemTime(T0 - 5000)
  const h = harness(options)
  await on(h)
  at(0)
  return h
}

describe('이어 붙이기 (AC-V2-14·17, D-V2-03)', () => {
  it('S1: 결과 하나 → 조용한 시간 1800ms 뒤 카드 15번 · 핑크문 · 15,000원 HIGH (그 전엔 카드 없음)', async () => {
    const h = await ready()
    say('15번 핑크 문 만오천원')
    at(1799)
    expect(cards(h)).toEqual([])
    expect(h.voice.getSnapshot().hearing).toEqual({ collected: '15번 핑크 문 만오천원', interim: '' })
    at(1800)
    expect(view(cards(h)[0])).toEqual({ no: 15, name: '핑크문', price: 15000 })
    expect(cards(h)[0]?.confidence).toBe('HIGH')
    expect(h.voice.getSnapshot().hearing).toBeNull()
    expect(h.voice.getSnapshot().readout?.text).toBe('15번 · 핑크문 · 15,000원')
    // 결과 한 줄은 4초
    at(1800 + 3999)
    expect(h.voice.getSnapshot().readout).not.toBeNull()
    at(1800 + 4000)
    expect(h.voice.getSnapshot().readout).toBeNull()
  })

  it('S2: "십오번"(0)·"엘레강스"(1200)·"이만원"(2500) → 4300에 카드 정확히 1장, 4300 전엔 없음', async () => {
    const h = await ready()
    say('십오번')
    at(1200)
    say('엘레강스')
    at(2500)
    say('이만원')
    at(4299)
    expect(cards(h)).toEqual([])
    at(4300)
    expect(cards(h).map(view)).toEqual([{ no: 15, name: '엘레강스', price: 20000 }])
  })

  it('S16: 다른 번호가 오면 붙이기 전에 끊는다 — 카드 둘', async () => {
    const h = await ready()
    say('26번 엘레강스 만원')
    at(1000)
    say('27번 라울 이만원')
    expect(cards(h).map(view)).toEqual([{ no: 26, name: '엘레강스', price: 10000 }])
    at(2800)
    expect(cards(h).map(view)).toEqual([
      { no: 27, name: '라울', price: 20000 },
      { no: 26, name: '엘레강스', price: 10000 },
    ])
  })

  it('S17: 중간 결과도 조용한 시간을 다시 센다 — 4800에 카드 하나, 중간 결과는 "들은 말" 칸에 따로', async () => {
    const h = await ready()
    say('28번 핑크', false)
    expect(h.voice.getSnapshot().hearing).toEqual({ collected: '', interim: '28번 핑크' })
    at(1500)
    say('28번 핑크문 만', false)
    at(3000)
    say('28번 핑크문 만원')
    at(4799)
    expect(cards(h)).toEqual([])
    at(4800)
    expect(cards(h).map(view)).toEqual([{ no: 28, name: '핑크문', price: 10000 }])
  })

  it('조용한 시간 3.0초면 S2의 카드가 5500에 생긴다, 그 기기 설정에 저장 (AC-V2-16)', async () => {
    const h = await ready()
    h.voice.setQuietSeconds('3.0')
    expect(h.voice.getSnapshot()).toMatchObject({ quietMs: 3000, quietProblem: null })
    expect(h.written.at(-1)).toEqual({ 'voice.autoConfirm': false, 'voice.autoConfirmSec': 5, 'voice.quietMs': 3000 })
    say('십오번')
    at(1200)
    say('엘레강스')
    at(2500)
    say('이만원')
    at(5499)
    expect(cards(h)).toEqual([])
    at(5500)
    expect(cards(h)).toHaveLength(1)
    // 자동 확정 설정을 바꿔도 조용한 시간이 남는다
    h.voice.setAutoConfirm(true)
    expect(h.written.at(-1)).toEqual({ 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5, 'voice.quietMs': 3000 })
  })

  it('조용한 시간 칸: 범위 밖·0.1초 단위가 아니면 문장, 값은 그대로', async () => {
    const h = await ready()
    for (const text of ['0.9', '4.1', '1.85', '', 'abc']) {
      h.voice.setQuietSeconds(text)
      expect(h.voice.getSnapshot().quietMs).toBe(1800)
      expect(h.voice.getSnapshot().quietProblem).toBe('말이 끝났다고 볼 때까지는 1.0초부터 4.0초까지 0.1초 단위로 정해 주세요')
    }
    h.voice.setQuietSeconds('1.0')
    expect(h.voice.getSnapshot()).toMatchObject({ quietMs: 1000, quietProblem: null })
  })

  it('저장값이 범위 밖이면 1.8초로 읽는다, 맞으면 그 값 (D-V2-09)', async () => {
    for (const [stored, ms] of [
      [{ 'voice.quietMs': 900 }, 1800],
      [{ 'voice.quietMs': 4100 }, 1800],
      [{ 'voice.quietMs': '2000' }, 1800],
      [{ 'voice.quietMs': 2500 }, 2500],
    ] as const) {
      const h = harness({ settings: stored })
      await on(h)
      expect(h.voice.getSnapshot()).toMatchObject({ quietMs: ms, quietText: (ms / 1000).toFixed(1) })
      h.voice.dispose()
    }
  })

  it('S21: 문자찜 결과는 모은 글을 먼저 덩어리로 내보낸다 (1000에 29번 카드)', async () => {
    const h = await ready()
    say('29번 핑크문 만원')
    at(1000)
    say('165번 문자찜 끝자리 1234')
    expect(cards(h).map(view)).toEqual([{ no: 29, name: '핑크문', price: 10000 }])
    expect(h.voice.getSnapshot().log.map((entry) => entry.action)).toEqual(['sms', 'create'])
  })

  it('음성을 끄면 모으던 글은 카드가 되되 자동 확정되지 않는다 (AC-V2-15)', async () => {
    const h = await ready({ settings: AUTO })
    say('15번 핑크문 만오천원')
    at(500)
    h.voice.turnOff()
    expect(view(cards(h)[0])).toEqual({ no: 15, name: '핑크문', price: 15000 })
    expect(cards(h)[0]?.autoConfirmAt).toBeNull()
    at(60_000)
    expect(h.registered).toEqual([])
  })

  it('끝에서 넘긴 중간 결과가 든 덩어리 카드는 자동 확정되지 않는다 (AC-V2-15)', async () => {
    const h = await ready({ settings: AUTO })
    say('15번 핑크문 만오천원', false)
    FakeRecognition.last.onend?.()
    expect(cards(h)[0]).toMatchObject({ no: 15, flushedAtEnd: true, autoConfirmAt: null })
  })
})

describe('이어 채우기·정정 (AC-V2-18~27, D-V2-04~06)', () => {
  // D-V3-41: 번호만 있는 카드의 안내는 "가격을 말하면 바로 등록돼요" (음성 패키지 ASK_NAME_PRICE)
  it('S3: 1800에 카드 15번 + "가격을 말하면 바로 등록돼요", 5800에 같은 카드가 엘레강스 · 20,000원 (카드 1장)', async () => {
    const h = await ready()
    say('십오번')
    at(1800)
    const id = cards(h)[0]?.id as string
    expect(view(cards(h)[0])).toEqual({ no: 15, name: null, price: null })
    expect(h.voice.cardInfo(id)?.ask).toBe('가격을 말하면 바로 등록돼요')
    at(4000)
    say('엘레강스 이만원')
    at(5800)
    expect(cards(h).map(view)).toEqual([{ no: 15, name: '엘레강스', price: 20000 }])
    expect(cards(h)[0]?.id).toBe(id)
    expect(h.voice.cardInfo(id)?.ask).toBeNull()
    expect(h.voice.getSnapshot().log[0]?.action).toBe('fill')
  })

  it('S4: 덩어리 안 정정 — 처음부터 18,000원 한 장', async () => {
    const h = await ready()
    say('15번 핑크문 만오천원')
    at(1000)
    say('만오천 말고 만팔천')
    at(2800)
    expect(cards(h).map(view)).toEqual([{ no: 15, name: '핑크문', price: 18000 }])
  })

  it('S5·AC-V2-24: 자동 확정 켬 — 말하는 동안 남은 초가 줄지 않고, "아니 만팔천"이면 고쳐지고 등록되지 않는다', async () => {
    const h = await ready({ settings: AUTO })
    say('15번 핑크 문 만오천원')
    at(1800)
    const id = cards(h)[0]?.id as string
    expect(cards(h)[0]?.autoConfirmAt).toBe(T0 + 1800 + 5000)
    at(3000)
    say('아니', false)
    expect(h.voice.getSnapshot().paused.get(id)).toBe(3800)
    at(4500)
    say('아니 만팔천')
    expect(h.voice.getSnapshot().paused.get(id)).toBe(3800)
    at(6300)
    expect(view(cards(h)[0])).toEqual({ no: 15, name: '핑크문', price: 18000 })
    expect(h.voice.getSnapshot().notes.get(id)).toBe('고쳤어요: 가격 15,000원 → 18,000원')
    expect(cards(h)[0]).toMatchObject({ touched: true, autoConfirmAt: null })
    at(60_000)
    expect(h.registered).toEqual([])
  })

  it('S18·AC-V2-24: 정정이 아닌 말이면 덩어리 처리 뒤 남은 초부터 다시 센다, 카드는 그대로·기록 "번호와 가격이 안 들렸어요"', async () => {
    const h = await ready({ settings: AUTO })
    say('15번 핑크 문 만오천원')
    at(1800)
    at(3000)
    say('아니 이거 너무 예쁘죠')
    at(4799)
    expect(h.registered).toEqual([])
    at(4800)
    // 남은 3800ms부터 다시: 4800 + 3800 = 8600
    expect(cards(h)[0]?.autoConfirmAt).toBe(T0 + 8600)
    expect(view(cards(h)[0])).toEqual({ no: 15, name: '핑크문', price: 15000 })
    expect(h.voice.getSnapshot().log[0]).toMatchObject({ action: 'discard', reason: '번호와 가격이 안 들렸어요' })
    expect(h.voice.getSnapshot().readout?.text).toBe('번호와 가격이 안 들렸어요')
    at(8599)
    expect(h.registered).toEqual([])
    at(8600)
    expect(h.registered.map((item) => [item.no, item.source])).toEqual([[15, 'auto']])
  })

  it('S11: 덩어리 안 취소 → 카드 없음, 기록 "버림"', async () => {
    const h = await ready()
    say('21번 핑크문 만원')
    at(900)
    say('취소')
    at(2700)
    expect(cards(h)).toEqual([])
    expect(h.voice.getSnapshot().log[0]?.action).toBe('discard')
  })

  it('S12: 열린 카드에 "취소" → 맨 앞 카드 닫힘, 등록 없음', async () => {
    const h = await ready()
    say('15번 핑크 문 만오천원')
    at(3000)
    say('취소')
    at(4800)
    expect(cards(h)).toEqual([])
    expect(h.registered).toEqual([])
    expect(h.voice.getSnapshot().log[0]?.action).toBe('close')
  })

  it('S19·AC-V2-26: 40초 전 음성 등록 + "만오천 말고 만팔천" → 고칠까요 카드, [고치기]면 고치고 10초 [되돌리기]', async () => {
    const h = await ready()
    h.voice.noteVoiceRegistered({ id: 'p15', no: 15, name: '핑크문', price: 15000 })
    at(40_000)
    say('만오천 말고 만팔천')
    at(41_800)
    const offer = h.voice.getSnapshot().offers[0]
    expect(offer).toMatchObject({ kind: 'offer', message: '방금 등록한 15번 핑크문을 18,000원으로 고칠까요?', stage: 'ask' })
    expect(h.fixes).toEqual([])
    await h.voice.fixOffer(offer?.id as string)
    expect(h.fixes).toEqual([{ id: 'p15', changes: { price: 18000 } }])
    expect(h.voice.getSnapshot().offers[0]).toMatchObject({ stage: 'fixed', message: OFFER_FIXED, before: { price: 15000 } })
    await h.voice.revertOffer(offer?.id as string)
    expect(h.fixes.at(-1)).toEqual({ id: 'p15', changes: { price: 15000 } })
    expect(h.voice.getSnapshot().offers).toEqual([])
  })

  it('S19: [그대로 두기]면 아무것도 고치지 않는다, 고친 뒤 10초가 지나면 [되돌리기]가 사라진다', async () => {
    const h = await ready()
    h.voice.noteVoiceRegistered({ id: 'p15', no: 15, name: '핑크문', price: 15000 })
    at(40_000)
    say('만오천 말고 만팔천')
    at(41_800)
    h.voice.dismissOffer(h.voice.getSnapshot().offers[0]?.id as string)
    expect(h.voice.getSnapshot().offers).toEqual([])
    expect(h.fixes).toEqual([])
    say('아니 만칠천')
    at(43_600)
    const id = h.voice.getSnapshot().offers[0]?.id as string
    await h.voice.fixOffer(id)
    at(43_600 + 9_999)
    expect(h.voice.getSnapshot().offers).toHaveLength(1)
    at(43_600 + 10_000)
    expect(h.voice.getSnapshot().offers).toEqual([])
  })

  it('S20: 70초 전 등록이면 아무것도 안 바꾸고 기록 "고칠 카드가 없어요"', async () => {
    const h = await ready()
    h.voice.noteVoiceRegistered({ id: 'p15', no: 15, name: '핑크문', price: 15000 })
    at(70_000)
    say('만오천 말고 만팔천')
    at(71_800)
    expect(h.voice.getSnapshot().offers).toEqual([])
    expect(cards(h)).toEqual([])
    expect(h.voice.getSnapshot().log[0]).toMatchObject({ action: 'discard', reason: '고칠 카드가 없어요' })
  })

  it('AC-V2-27: 등록 뒤 "아니 16번" → 번호 안내만, "취소" → 5초 안이면 되돌릴까요, 지나면 시간이 지났어요', async () => {
    const h = await ready()
    h.voice.noteVoiceRegistered({ id: 'p15', no: 15, name: '핑크문', price: 15000 })
    say('아니 16번')
    at(1800)
    expect(h.voice.getSnapshot().offers[0]).toMatchObject({ kind: 'number', message: '번호는 상품 목록에서 고쳐 주세요' })
    expect(cards(h)).toEqual([])
    h.voice.dismissOffer(h.voice.getSnapshot().offers[0]?.id as string)

    h.voice.dispose()
    const fresh = await ready()
    fresh.voice.noteVoiceRegistered({ id: 'p15', no: 15, name: '핑크문', price: 15000 })
    at(3000)
    say('취소')
    at(4800)
    const undo = fresh.voice.getSnapshot().offers[0]
    expect(undo).toMatchObject({ kind: 'undo', message: '방금 등록한 15번 핑크문을 되돌릴까요?' })
    expect(fresh.undone).toEqual([])
    fresh.voice.undoOffer(undo?.id as string)
    expect(fresh.undone).toEqual(['p15'])

    fresh.voice.dispose()
    const late = await ready()
    late.voice.noteVoiceRegistered({ id: 'p15', no: 15, name: '핑크문', price: 15000 })
    at(6000)
    say('취소')
    at(7800)
    expect(late.voice.getSnapshot().offers[0]).toMatchObject({ kind: 'late', message: '되돌릴 시간이 지났어요. 상품 목록에서 고쳐 주세요.' })
    expect(late.undone).toEqual([])
  })
})

describe('품종 후보·배운 별칭 (AC-V2-07·09, D-V2-01·10)', () => {
  it('S9: 품종 빈칸 + 후보 "선버스트" 77점, 누르면 품종이 되고 손댄 카드, 그 말을 배운다(그 기기 저장)', async () => {
    const h = await ready()
    say('19번 선버스 팔천원')
    at(1800)
    const card = cards(h)[0] as SuggestionCard
    expect(view(card)).toEqual({ no: 19, name: null, price: 8000 })
    expect(h.voice.cardInfo(card.id)?.candidates[0]).toMatchObject({ name: '선버스트', score: 77 })
    h.voice.chooseCandidate(card.id, '선버스트')
    expect(cards(h)[0]).toMatchObject({ name: '선버스트', touched: true })
    expect(h.voice.cardInfo(card.id)?.candidates).toEqual([])
    expect(h.learned?.map((item) => [item.heard, item.name])).toEqual([['선버스', '선버스트']])
    expect(h.voice.getSnapshot().learnedCount).toBe(1)
  })

  it('AC-V2-09: 배운 별칭은 다음 콘솔(새로 고침)에서도 쓰인다 — "30번 선버스 팔천원" → 선버스트 HIGH', async () => {
    const first = await ready()
    say('19번 선버스 팔천원')
    at(1800)
    first.voice.chooseCandidate(cards(first)[0]?.id as string, '선버스트')
    const saved = first.learned
    first.voice.dispose()
    const next = await ready({ learned: saved })
    say('30번 선버스 팔천원')
    at(1800)
    expect(view(cards(next)[0])).toEqual({ no: 30, name: '선버스트', price: 8000 })
    expect(cards(next)[0]?.confidence).toBe('HIGH')
  })

  it('S8: "라운"은 사전 별칭이라 라울 HIGH(D-V2-12), 등록해도 사전에 있는 말은 배우지 않는다(D-V2-17)', async () => {
    const h = await ready()
    say('18번 라운 만이천원')
    at(1800)
    const card = cards(h)[0] as SuggestionCard
    expect(card).toMatchObject({ name: '라울', confidence: 'HIGH' })
    h.voice.confirm(card.id, 'click')
    expect(h.registered.map((item) => [item.no, item.name])).toEqual([[18, '라울']])
    expect(h.learned ?? []).toEqual([])
  })

  it('S10: 사전 밖 말은 품종 빈칸 카드, 후보 없음, 등록은 품종 미입력', async () => {
    const h = await ready()
    say('20번 음 그거 오천원')
    at(1800)
    const card = cards(h)[0] as SuggestionCard
    expect(view(card)).toEqual({ no: 20, name: null, price: 5000 })
    expect(h.voice.cardInfo(card.id)?.candidates).toEqual([])
    h.voice.confirm(card.id, 'click')
    expect(h.registered.map((item) => [item.no, item.name, item.price])).toEqual([[20, '', 5000]])
    expect(h.learned).toBeNull()
  })

  it('[배운 품종 이름 지우기]', async () => {
    const h = await ready({ learned: [{ heard: '선버스', name: '선버스트', usedAt: 1 }] })
    expect(h.voice.getSnapshot().learnedCount).toBe(1)
    h.voice.clearLearned()
    expect(h.learned).toEqual([])
    expect(h.voice.getSnapshot().learnedCount).toBe(0)
  })
})

describe('음성 기록 (AC-V2-28~30, D-V2-08)', () => {
  it('S2·S9·S18 뒤 새것부터 3개 — 시각·들은 말·읽은 것("선버스트 77점")·한 일·버린 까닭', async () => {
    const h = await ready()
    say('십오번')
    at(1200)
    say('엘레강스')
    at(2500)
    say('이만원')
    at(10_000)
    say('19번 선버스 팔천원')
    at(20_000)
    say('아니 이거 너무 예쁘죠')
    at(30_000)
    const lines = h.voice.logLines()
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatchObject({ pieces: ['아니 이거 너무 예쁘죠'], action: '버림', reason: '번호와 가격이 안 들렸어요' })
    expect(lines[1]).toMatchObject({ pieces: ['19번 선버스 팔천원'], read: '19번 · 품종 ? · 8,000원', candidates: '선버스트 77점', action: '카드 만듦', reason: null })
    expect(lines[2]).toMatchObject({ pieces: ['십오번', '엘레강스', '이만원'], read: '15번 · 엘레강스 · 20,000원', action: '카드 만듦' })
    expect(lines[2]?.time).toMatch(/^\d\d:\d\d:\d\d$/)
  })

  it('덩어리 51개면 50개(가장 오래된 것이 빠짐), [기록 지우기]면 0개', async () => {
    const h = await ready()
    for (let i = 0; i < 51; i++) {
      say(`잡담 ${String(i)}`)
      at((i + 1) * 2000)
    }
    const log = h.voice.getSnapshot().log
    expect(log).toHaveLength(50)
    expect(log[0]?.pieces[0]?.text).toBe('잡담 50')
    expect(log.at(-1)?.pieces[0]?.text).toBe('잡담 1')
    h.voice.clearLog()
    expect(h.voice.getSnapshot().log).toEqual([])
  })

  it('받아쓴 글은 저장소로 가지 않는다 — 설정·배운 별칭 저장값에 문장이 없다, 콘솔 출력도 없다', async () => {
    const logSpy = vi.spyOn(console, 'log')
    const infoSpy = vi.spyOn(console, 'info')
    const warnSpy = vi.spyOn(console, 'warn')
    const h = await ready()
    h.voice.setQuietSeconds('2.0')
    say('십오번 엘레강스 이만원')
    at(3000)
    say('165번 문자찜 끝자리 1234')
    at(6000)
    const stored = JSON.stringify([h.written, h.learned])
    expect(stored).not.toContain('엘레강스 이만원')
    expect(stored).not.toContain('1234')
    for (const spy of [logSpy, infoSpy, warnSpy]) expect(JSON.stringify(spy.mock.calls)).not.toContain('엘레강스')
  })
})
