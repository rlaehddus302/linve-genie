// 음성 화면 판단 순수 함수 (AC-I4-21·31·40, D-I4-03·05·06). 음성 함수(checkAutoConfirm·normalizeDictionary)는 실제 음성 패키지 것을 넘긴다.
import {
  DEFAULT_VOICE_SETTINGS,
  checkAutoConfirm,
  checkVoiceSettings,
  createCard,
  normalizeDictionary,
  type SuggestionCard,
  type VoiceExtraction,
  type VoiceSettings,
} from '@livejjim/voice'
import { describe, expect, it } from 'vitest'
import {
  ENTER_READY_MS,
  HEARD_LIMIT,
  autoSecondsLeft,
  cardLine,
  decideAutoConfirm,
  decideVoiceEnter,
  enterBadgeCard,
  enterReady,
  frontCard,
  historyNames,
  nextFront,
  nextWake,
  parseSecondsText,
  pickHistoryDays,
  pushHeard,
  showsAutoCountdown,
  type FrontMark,
  type VoiceEnterInput,
} from '../src/lib/voice.ts'

const T = 1_700_000_000_000
const HIGH: VoiceExtraction = { no: 15, name: '핑크프릴', price: 15000, confidence: 'HIGH' }
const AUTO: VoiceSettings = { 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5 }

function card(id: string, createdAt: number, extraction: Partial<VoiceExtraction> = {}, settings: Partial<VoiceSettings> = AUTO): SuggestionCard {
  const made = createCard({ id, extraction: { ...HIGH, ...extraction }, text: `${id} 문장`, createdAt, settings })
  if (made === null) throw new Error('카드를 만들 결과가 아니다')
  return made
}

function enterInput(patch: Partial<VoiceEnterInput>): VoiceEnterInput {
  const a = card('a', T)
  return { line: '', cards: [a], front: { id: 'a', since: T }, now: T + ENTER_READY_MS, wide: true, dialogOpen: false, editing: new Set(), ...patch }
}

describe('맨 앞 카드와 1초 (AC-I4-21, D-I4-03)', () => {
  it('맨 앞 = 새 것이 앞인 목록의 첫 열린 카드', () => {
    const a = card('a', T)
    const b = card('b', T + 10)
    expect(frontCard([b, a])?.id).toBe('b')
    expect(frontCard([{ ...b, status: 'CONFIRMED' }, a])?.id).toBe('a')
    expect(frontCard([])).toBeNull()
  })

  it('맨 앞이 그대로면 처음 시각 그대로, 바뀌면(새 카드·앞 카드가 빠짐) 그 시각부터', () => {
    const a = card('a', T)
    const b = card('b', T + 300)
    const first = nextFront(null, [a], T)
    expect(first).toEqual({ id: 'a', since: T })
    expect(nextFront(first, [a], T + 5000)).toBe(first)
    const second = nextFront(first, [b, a], T + 300)
    expect(second).toEqual({ id: 'b', since: T + 300 })
    // B가 등록되어 A가 다시 맨 앞: 올라온 시각부터
    expect(nextFront(second, [a], T + 2000)).toEqual({ id: 'a', since: T + 2000 })
    expect(nextFront(second, [], T + 2000)).toBeNull()
  })

  it('나온 시각과 올라온 시각 중 늦은 것 — 시계가 거꾸로 가도 나온 시각보다 앞서지 않는다', () => {
    const b = card('b', T + 5000)
    expect(nextFront(null, [b], T)).toEqual({ id: 'b', since: T + 5000 })
    expect(nextFront(null, [b], Number.NaN)).toEqual({ id: 'b', since: T + 5000 })
  })

  it('1초가 지나야 준비 (같은 밀리초·999ms·시계가 거꾸로·NaN은 아직)', () => {
    const front: FrontMark = { id: 'a', since: T }
    expect(enterReady(front, T)).toBe(false)
    expect(enterReady(front, T + 999)).toBe(false)
    expect(enterReady(front, T + 1000)).toBe(true)
    expect(enterReady(front, T - 5000)).toBe(false)
    expect(enterReady(front, Number.NaN)).toBe(false)
    expect(enterReady(null, T + 5000)).toBe(false)
  })

  it('빈 칸·PC·창 없음·고치기 칸 닫힘·1초 지남 → 맨 앞 카드 등록', () => {
    expect(decideVoiceEnter(enterInput({}))).toMatchObject({ kind: 'register', card: { id: 'a' } })
    // 공백만 있는 칸도 빈 칸
    expect(decideVoiceEnter(enterInput({ line: '  　 ' }))).toMatchObject({ kind: 'register' })
  })

  it('1초 안 → tooSoon (등록 없음)', () => {
    expect(decideVoiceEnter(enterInput({ now: T + 999 }))).toMatchObject({ kind: 'tooSoon', card: { id: 'a' } })
    // 맨 앞 표시가 다른 카드(아직 맞추지 않음)면 아직
    expect(decideVoiceEnter(enterInput({ front: { id: 'x', since: T - 10_000 } }))).toMatchObject({ kind: 'tooSoon' })
    expect(decideVoiceEnter(enterInput({ front: null }))).toMatchObject({ kind: 'tooSoon' })
  })

  it('글자가 있는 칸·글자 조합 중·창이 열림·휴대폰 폭·맨 앞 카드의 고치기 칸·카드 없음 → 빠른 입력 그대로', () => {
    expect(decideVoiceEnter(enterInput({ line: '15' }))).toEqual({ kind: 'quick' })
    expect(decideVoiceEnter(enterInput({ composing: true }))).toEqual({ kind: 'quick' })
    expect(decideVoiceEnter(enterInput({ dialogOpen: true }))).toEqual({ kind: 'quick' })
    expect(decideVoiceEnter(enterInput({ wide: false }))).toEqual({ kind: 'quick' })
    expect(decideVoiceEnter(enterInput({ editing: new Set(['a']) }))).toEqual({ kind: 'quick' })
    expect(decideVoiceEnter(enterInput({ cards: [] }))).toEqual({ kind: 'quick' })
  })

  it('"Enter 등록" 표시는 지금 Enter가 등록할 카드에만', () => {
    expect(enterBadgeCard(enterInput({}))).toBe('a')
    expect(enterBadgeCard(enterInput({ now: T + 500 }))).toBeNull()
    expect(enterBadgeCard(enterInput({ wide: false }))).toBeNull()
    expect(enterBadgeCard(enterInput({ line: '1' }))).toBeNull()
  })
})

describe('자동 확정 판단 (AC-I4-31, D-204, D-I4-05) — P2 checkAutoConfirm', () => {
  const base = (patch: Partial<Parameters<typeof decideAutoConfirm>[0]>) => ({
    cards: [card('a', T)],
    settings: AUTO,
    now: T + 5000,
    existingNumbers: new Set<number>(),
    voiceOn: true,
    dialogOpen: false,
    ...patch,
  })

  it('만든 시각 + 5초에 등록 (4.9초엔 아직)', () => {
    expect(decideAutoConfirm(base({ now: T + 4900 }), checkAutoConfirm).due).toBeNull()
    expect(decideAutoConfirm(base({}), checkAutoConfirm).due?.id).toBe('a')
  })

  it('LOW·설정을 끈 채 만든 카드·손댄 카드·설정이 지금 꺼짐 → 없음', () => {
    expect(decideAutoConfirm(base({ cards: [card('a', T, { confidence: 'LOW' })] }), checkAutoConfirm).due).toBeNull()
    expect(decideAutoConfirm(base({ cards: [card('a', T, {}, DEFAULT_VOICE_SETTINGS)] }), checkAutoConfirm).due).toBeNull()
    expect(decideAutoConfirm(base({ cards: [{ ...card('a', T), touched: true }] }), checkAutoConfirm).due).toBeNull()
    expect(decideAutoConfirm(base({ settings: DEFAULT_VOICE_SETTINGS }), checkAutoConfirm).due).toBeNull()
  })

  it('음성을 끈 뒤 → 아무것도 하지 않는다', () => {
    expect(decideAutoConfirm(base({ voiceOn: false, now: T + 60_000 }), checkAutoConfirm)).toMatchObject({ due: null, blocked: [], deferred: false })
  })

  it('창이 열린 동안 → 미룸(deferred), 창이 닫히면 다시 봐서 기다림이 지났으면 바로', () => {
    const open = decideAutoConfirm(base({ dialogOpen: true, now: T + 9000 }), checkAutoConfirm)
    expect(open).toMatchObject({ due: null, deferred: true })
    expect(decideAutoConfirm(base({ now: T + 9000 }), checkAutoConfirm).due?.id).toBe('a')
    // 기다림 전이면 창이 열려도 미룬 것이 없다
    expect(decideAutoConfirm(base({ dialogOpen: true, now: T + 100 }), checkAutoConfirm).deferred).toBe(false)
  })

  it('그 순간 그 번호가 있으면 등록하지 않고 그 카드의 자동 확정을 끈다 (blocked)', () => {
    const result = decideAutoConfirm(base({ existingNumbers: new Set([15]) }), checkAutoConfirm)
    expect(result.due).toBeNull()
    expect(result.blocked.map((item) => item.id)).toEqual(['a'])
    expect(result.cards[0]?.autoConfirmAt).toBeNull()
    // 그 뒤 번호가 사라져도 다시 켜지지 않는다
    expect(decideAutoConfirm(base({ cards: result.cards, now: T + 20_000 }), checkAutoConfirm).due).toBeNull()
  })

  it('기다림 전에 번호가 생겨도 그 순간이 오기 전엔 건드리지 않는다', () => {
    const result = decideAutoConfirm(base({ now: T + 1000, existingNumbers: new Set([15]) }), checkAutoConfirm)
    expect(result).toMatchObject({ due: null, blocked: [] })
  })

  it('여럿이 지났으면 기다림이 가장 먼저 끝난 하나', () => {
    const a = card('a', T)
    const b = card('b', T + 100, { no: 16 })
    expect(decideAutoConfirm(base({ cards: [b, a], now: T + 6000 }), checkAutoConfirm).due?.id).toBe('a')
  })

  it('남은 초: 1초마다 줄고 1 아래로 내려가지 않는다, 표시 조건', () => {
    expect(autoSecondsLeft(T + 5000, T)).toBe(5)
    expect(autoSecondsLeft(T + 5000, T + 1)).toBe(5)
    expect(autoSecondsLeft(T + 5000, T + 1000)).toBe(4)
    expect(autoSecondsLeft(T + 5000, T + 4999)).toBe(1)
    expect(autoSecondsLeft(T + 5000, T + 9000)).toBe(1)
    const a = card('a', T)
    expect(showsAutoCountdown(a, AUTO, true)).toBe(true)
    expect(showsAutoCountdown(a, AUTO, false)).toBe(false)
    expect(showsAutoCountdown(a, DEFAULT_VOICE_SETTINGS, true)).toBe(false)
    expect(showsAutoCountdown({ ...a, touched: true }, AUTO, true)).toBe(false)
    expect(showsAutoCountdown(card('l', T, { confidence: 'LOW' }), AUTO, true)).toBe(false)
  })

  it('다음에 볼 때: "Enter 등록"·자동 확정·남은 초가 바뀌는 때 중 가장 이른 것', () => {
    const a = card('a', T)
    expect(nextWake([a], { id: 'a', since: T }, T)).toBe(ENTER_READY_MS)
    expect(nextWake([a], { id: 'a', since: T }, T + 1000)).toBe(1000)
    expect(nextWake([a], { id: 'a', since: T }, T + 1500)).toBe(500)
    expect(nextWake([a], { id: 'a', since: T }, T + 4200)).toBe(800)
    expect(nextWake([a], { id: 'a', since: T }, T + 5000)).toBeNull()
    expect(nextWake([], null, T)).toBeNull()
  })
})

describe('판매 이력 사전 (AC-I4-40, D-I4-06, R-17 5)', () => {
  it('지금 범위를 뺀 실제 범위 중 날짜가 가장 늦은 10개 (늦은 날짜 먼저, 리허설·틀린 날짜·같은 날짜 빼기)', () => {
    const days = Array.from({ length: 12 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, rehearsal: false }))
    const picked = pickHistoryDays([...days, { date: '2026-10-01', rehearsal: true }, { date: 'x', rehearsal: false }, { date: '2026-09-12' }], { date: '2026-10-20', rehearsal: false })
    expect(picked).toEqual(['2026-09-12', '2026-09-11', '2026-09-10', '2026-09-09', '2026-09-08', '2026-09-07', '2026-09-06', '2026-09-05', '2026-09-04', '2026-09-03'])
    // 지금 범위(실제)는 뺀다
    expect(pickHistoryDays(days, { date: '2026-09-12', rehearsal: false })[0]).toBe('2026-09-11')
    // 지금 범위가 리허설이면 같은 날짜의 실제 범위는 다른 범위다
    expect(pickHistoryDays(days, { date: '2026-09-12', rehearsal: true })[0]).toBe('2026-09-12')
  })

  it('이름 순서: 지금 범위 → 늦은 날짜 → (기본 사전은 부르는 쪽), 공백만 다른 이름은 앞의 것, 빈 이름 빠짐', () => {
    const names = historyNames(
      ['', '새품종'],
      [
        { date: '2026-09-01', names: ['오래된품종'] },
        { date: '2026-09-05', names: ['핑크 프릴', '새 품종'] },
      ],
      normalizeDictionary,
    )
    expect(names).toEqual(['새품종', '핑크 프릴', '오래된품종'])
  })

  it('정리 뒤 2,000개까지', () => {
    const many = Array.from({ length: 2500 }, (_, i) => `품종${String(i)}`)
    const names = historyNames(['지금품종'], [{ date: '2026-09-01', names: many }], normalizeDictionary)
    expect(names).toHaveLength(2000)
    expect(names[0]).toBe('지금품종')
    expect(names.at(-1)).toBe('품종1998')
  })
})

describe('그 밖', () => {
  it('카드 등록 줄은 빠른 입력 한 줄 모양', () => {
    expect(cardLine(15, '핑크프릴', 15000)).toBe('15 핑크프릴 15,000원')
    expect(cardLine(15, '', 10000)).toBe('15 10,000원')
  })

  it('들린 말 기록은 새 것이 앞, 20개', () => {
    let list = pushHeard([], { id: 1, text: '하나' })
    for (let i = 2; i <= 25; i++) list = pushHeard(list, { id: i, text: String(i) })
    expect(list).toHaveLength(HEARD_LIMIT)
    expect(list[0]?.id).toBe(25)
    expect(list.at(-1)?.id).toBe(6)
  })

  it('기다리는 시간 칸 글자: 정수·소수 글자만 수, 그 밖은 NaN — checkVoiceSettings가 받지 않는다', () => {
    expect(parseSecondsText(' 10 ')).toBe(10)
    expect(parseSecondsText('4.5')).toBe(4.5)
    for (const text of ['', 'abc', '1e1', '５', '3초']) expect(parseSecondsText(text)).toBeNaN()
    // D-V3-16·SA-V3-009: 음성 패키지는 옛 키(voice.autoConfirmSec)를 더 검사하지 않는다 — 범위는 컨트롤러(setSeconds)가 본다
    expect(checkVoiceSettings({ 'voice.autoConfirmSec': parseSecondsText('2') })).toEqual([])
    expect(checkVoiceSettings({ 'voice.autoConfirmSec': parseSecondsText('30') })).toEqual([])
  })
})
