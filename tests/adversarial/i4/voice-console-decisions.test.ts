// I4 적대 테스트 (test-domain): 콘솔 음성 화면의 순수 판단 (apps/web/src/lib/voice.ts — AC-I4-21·31·40, D-I4-03·05·06).
// Enter 대상·1초 판단(맨 앞이 바뀌는 순서, 시계가 거꾸로·같은 밀리초), 자동 확정 판단(창 열림·음성 꺼짐·번호 생김), 사전 모으기.
// 통과한 공격을 회귀로 남긴다. 화면 파일은 DOM 타입으로 검사하므로 경로를 값으로 불러온다(s05/console-store-race.test.ts와 같은 까닭).
import { DEFAULT_DICTIONARY, addCard, buildDictionary, checkAutoConfirm, createCard, extractVoice, normalizeDictionary, prepareDictionary, touchCard, type SuggestionCard, type VoiceSettings } from '@livejjim/voice'
import fc from 'fast-check'
import { beforeAll, describe, expect, it } from 'vitest'

const WEB_VOICE = '../../../apps/web/src/lib/voice.ts'

interface FrontMark {
  readonly id: string
  readonly since: number
}
interface WebVoice {
  frontCard(cards: readonly SuggestionCard[]): SuggestionCard | null
  nextFront(previous: FrontMark | null, cards: readonly SuggestionCard[], now: number): FrontMark | null
  enterReady(front: FrontMark | null, now: number): boolean
  decideVoiceEnter(input: {
    line: string
    cards: readonly SuggestionCard[]
    front: FrontMark | null
    now: number
    wide: boolean
    dialogOpen: boolean
    composing?: boolean
    editing: ReadonlySet<string>
  }): { kind: 'quick' } | { kind: 'register' | 'tooSoon'; card: SuggestionCard }
  decideAutoConfirm(
    input: { cards: readonly SuggestionCard[]; settings: VoiceSettings; now: number; existingNumbers: ReadonlySet<number>; voiceOn: boolean; dialogOpen: boolean },
    check: typeof checkAutoConfirm,
  ): { due: SuggestionCard | null; blocked: readonly SuggestionCard[]; cards: readonly SuggestionCard[]; deferred: boolean }
  autoSecondsLeft(autoConfirmAt: number, now: number): number
  pickHistoryDays(days: readonly { date: string; rehearsal?: boolean }[], current: { date: string; rehearsal: boolean }, limit?: number): string[]
  historyNames(current: readonly string[], past: readonly { date: string; names: readonly string[] }[], normalize: (names: readonly unknown[]) => string[], limit?: number): string[]
}

let web: WebVoice
beforeAll(async () => {
  web = (await import(/* @vite-ignore */ WEB_VOICE)) as WebVoice
})

const T0 = Date.UTC(2026, 9, 20, 1, 0, 0)
const AUTO: VoiceSettings = { 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5 }
let nextId = 1
function card(text: string, at: number, settings: VoiceSettings = AUTO): SuggestionCard {
  const extraction = extractVoice(text, { dictionary: prepareDictionary(buildDictionary([], DEFAULT_DICTIONARY)) })
  const made = createCard({ id: `v${String(nextId++)}`, extraction, text, createdAt: at, settings })
  if (made === null) throw new Error(`카드가 생겨야 한다: ${text}`)
  return made
}

describe('AC-I4-21 Enter 대상·1초 (D-I4-03)', () => {
  it('맨 앞이 바뀌는 순서: B가 확정되면 A는 그때부터 1초 — 두 번 Enter해도 A는 바로 등록되지 않는다', () => {
    const a = card('15번 핑크프릴 만오천 원', T0)
    const b = card('16번 라울 오천 원', T0 + 3000)
    let cards = addCard(addCard([], a), b)
    let front = web.nextFront(null, cards, T0 + 3000)
    expect(front).toEqual({ id: b.id, since: T0 + 3000 })
    const base = { line: '', wide: true, dialogOpen: false, editing: new Set<string>() }
    expect(web.decideVoiceEnter({ ...base, cards, front, now: T0 + 3999 }).kind).toBe('tooSoon')
    expect(web.decideVoiceEnter({ ...base, cards, front, now: T0 + 4000 })).toEqual({ kind: 'register', card: b })
    // B 확정 → A가 맨 앞 (A가 나온 지 4초가 지났어도 올라온 시각부터 1초)
    cards = cards.filter((item) => item.id !== b.id)
    front = web.nextFront(front, cards, T0 + 4000)
    expect(front).toEqual({ id: a.id, since: T0 + 4000 })
    expect(web.decideVoiceEnter({ ...base, cards, front, now: T0 + 4000 }).kind).toBe('tooSoon')
    expect(web.decideVoiceEnter({ ...base, cards, front, now: T0 + 5000 }).kind).toBe('register')
  })

  it('시계가 거꾸로 가거나 같은 밀리초면 아직이다 (나온 시각보다 앞서지 않는다)', () => {
    const a = card('15번 핑크프릴 만오천 원', T0)
    const front = web.nextFront(null, [a], T0 - 60_000)
    expect(front?.since).toBe(T0)
    expect(web.enterReady(front, T0)).toBe(false)
    expect(web.enterReady(front, T0 - 1)).toBe(false)
    expect(web.enterReady(front, Number.NaN)).toBe(false)
    expect(web.enterReady(front, T0 + 999)).toBe(false)
    expect(web.enterReady(front, T0 + 1000)).toBe(true)
  })

  it('속성: 등록은 빈 칸·조합 아님·창 없음·PC·맨 앞 고치기 칸 닫힘·맨 앞이 된 지 1초 이상일 때만, 그때 맨 앞 카드', () => {
    const a = card('15번 핑크프릴 만오천 원', T0)
    const b = card('16번 핑크프릴 만오천', T0 + 10) // D-V3-41: 번호 없는 결과는 카드가 아니므로 번호 있는 카드로
    const cards = addCard(addCard([], a), b)
    fc.assert(
      fc.property(
        fc.constantFrom('', ' ', '　', '15', '15 라울 10', 'ㄹ'),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        fc.integer({ min: -2000, max: 3000 }),
        (line, composing, dialogOpen, wide, editingFront, offset) => {
          const front = web.nextFront(null, cards, T0 + 10)
          const editing = new Set(editingFront ? [b.id] : [])
          const decision = web.decideVoiceEnter({ line, cards, front, now: T0 + 10 + offset, wide, dialogOpen, composing, editing })
          const cardSide = line.trim() === '' && !composing && !dialogOpen && wide && !editingFront
          if (!cardSide) expect(decision.kind).toBe('quick')
          else expect(decision).toEqual({ kind: offset >= 1000 ? 'register' : 'tooSoon', card: b })
        },
      ),
      { numRuns: 500, seed: 20261020 },
    )
  })
})

describe('AC-I4-31 자동 확정 판단 (D-204, D-I4-05)', () => {
  const settingsOn = AUTO
  it('음성 꺼짐·창 열림에서는 등록하지 않고, 창이면 미룬다', () => {
    const c = card('15번 핑크프릴 만오천 원', T0)
    const input = { cards: [c], settings: settingsOn, now: T0 + 5000, existingNumbers: new Set<number>(), voiceOn: true, dialogOpen: false }
    expect(web.decideAutoConfirm(input, checkAutoConfirm).due).toEqual(c)
    expect(web.decideAutoConfirm({ ...input, now: T0 + 4999 }, checkAutoConfirm).due).toBeNull()
    expect(web.decideAutoConfirm({ ...input, voiceOn: false }, checkAutoConfirm)).toMatchObject({ due: null, deferred: false })
    expect(web.decideAutoConfirm({ ...input, dialogOpen: true }, checkAutoConfirm)).toMatchObject({ due: null, deferred: true })
  })

  it('그 순간 번호가 있으면 등록하지 않고 막힌 카드로 — 자동 확정이 꺼진다(그 뒤 번호가 사라져도 다시 켜지지 않는다)', () => {
    const c = card('15번 핑크프릴 만오천 원', T0)
    const blocked = web.decideAutoConfirm({ cards: [c], settings: settingsOn, now: T0 + 5000, existingNumbers: new Set([15]), voiceOn: true, dialogOpen: false }, checkAutoConfirm)
    expect(blocked.due).toBeNull()
    expect(blocked.blocked.map((item) => item.id)).toEqual([c.id])
    expect(blocked.cards[0]?.autoConfirmAt).toBeNull()
    const later = web.decideAutoConfirm({ cards: blocked.cards, settings: settingsOn, now: T0 + 9000, existingNumbers: new Set(), voiceOn: true, dialogOpen: false }, checkAutoConfirm)
    expect(later.due).toBeNull()
  })

  it('LOW·손댄 카드·설정을 끈 채 만든 카드(나중에 켜도)는 등록하지 않는다', () => {
    const low = card('16번 핑크푸릴 만원', T0)
    const touched = touchCard(card('17번 라울 오천 원', T0))
    const madeOff = card('18번 블루엘프 칠천 원', T0, { 'voice.autoConfirm': false, 'voice.autoConfirmSec': 5 })
    const result = web.decideAutoConfirm(
      { cards: [low, touched, madeOff], settings: settingsOn, now: T0 + 60_000, existingNumbers: new Set(), voiceOn: true, dialogOpen: false },
      checkAutoConfirm,
    )
    expect(low.confidence).toBe('LOW')
    expect(result).toMatchObject({ due: null, blocked: [], deferred: false })
  })

  it('남은 초: 만든 때 5, 4.001초 뒤 1, 넘어도 1 아래로 내려가지 않는다', () => {
    expect(web.autoSecondsLeft(T0 + 5000, T0)).toBe(5)
    expect(web.autoSecondsLeft(T0 + 5000, T0 + 1)).toBe(5)
    expect(web.autoSecondsLeft(T0 + 5000, T0 + 4001)).toBe(1)
    expect(web.autoSecondsLeft(T0 + 5000, T0 + 9000)).toBe(1)
  })
})

describe('AC-I4-40 판매 이력 사전 모으기 (D-I4-06)', () => {
  const real = Array.from({ length: 12 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}` }))

  it('지금 범위를 뺀 실제 범위 중 늦은 10개 — 리허설·형식 틀린 날짜·같은 날짜 한 번', () => {
    const days = [...real, { date: '2026-10-19', rehearsal: true }, { date: '2026-10-20' }, { date: '2026-10-12' }, { date: '20261013' }, { date: '2026-10-13 ' }]
    expect(web.pickHistoryDays(days, { date: '2026-10-20', rehearsal: false })).toEqual([
      '2026-10-12', '2026-10-11', '2026-10-10', '2026-10-09', '2026-10-08', '2026-10-07', '2026-10-06', '2026-10-05', '2026-10-04', '2026-10-03',
    ])
    // 지금 범위가 리허설이면 같은 날짜의 실제 범위는 다른 범위다
    expect(web.pickHistoryDays([...real, { date: '2026-10-20' }], { date: '2026-10-20', rehearsal: true })[0]).toBe('2026-10-20')
  })

  it('이름 순서: 지금 범위 → 늦은 날짜 → (기본 사전). 공백만 다른 이름은 앞의 것, 빈 이름 빠짐, 2,000개까지', () => {
    const names = web.historyNames(
      ['', '  ', '라울'],
      [
        { date: '2026-10-01', names: ['오래된품종', '핑크프릴'] },
        { date: '2026-10-09', names: ['핑크 프릴', '새품종'] },
      ],
      normalizeDictionary,
    )
    expect(names).toEqual(['라울', '핑크 프릴', '새품종', '오래된품종'])
    const dict = buildDictionary(names, DEFAULT_DICTIONARY)
    expect(dict.slice(0, 4)).toEqual(['라울', '핑크 프릴', '새품종', '오래된품종'])
    expect(dict).not.toContain('핑크프릴')
    const many = Array.from({ length: 2500 }, (_, i) => `품종${String(i)}`)
    const capped = web.historyNames([], [{ date: '2026-10-01', names: many }], normalizeDictionary)
    expect(capped).toHaveLength(2000)
    expect(capped[1999]).toBe('품종1999')
  })
})
