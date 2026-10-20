// AC-P2-10~12 제안 카드 데이터 모델 (VOC-04, D-204) · 음성 설정
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VOICE_SETTINGS,
  MAX_OPEN_CARDS,
  addCard,
  checkAutoConfirm,
  checkVoiceSettings,
  closeCard,
  confirmCard,
  createCard,
  describeCard,
  editCard,
  extractVoice,
  openCardCount,
  replaceCard,
  resolveVoiceSettings,
  touchCard,
  type SuggestionCard,
  type VoiceExtraction,
} from '../src/index.ts'

const T0 = Date.UTC(2026, 9, 18, 11, 0, 0)
const ON = { 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5 } as const
const HIGH: VoiceExtraction = { no: 15, name: '핑크프릴', price: 10000, confidence: 'HIGH' }
const LOW: VoiceExtraction = { no: 15, name: '핑크프릴', price: 10000, confidence: 'LOW' }

const card = (extraction: VoiceExtraction = HIGH, options: { id?: string; createdAt?: number; settings?: object } = {}): SuggestionCard => {
  const made = createCard({ id: options.id ?? 'c1', extraction, text: '15번 핑크프릴 만원', createdAt: options.createdAt ?? T0, settings: options.settings ?? ON })
  if (made === null) throw new Error('카드가 없다')
  return made
}

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    Object.freeze(value)
    for (const inner of Object.values(value)) deepFreeze(inner)
  }
  return value
}

describe('음성 설정 (D-204): 자동 확정 기본 꺼짐, 기다림 기본 5초(정수 3~30)', () => {
  it('기본값', () => {
    expect(DEFAULT_VOICE_SETTINGS).toEqual({ 'voice.autoConfirm': false, 'voice.autoConfirmSec': 5 })
    expect(resolveVoiceSettings()).toEqual(DEFAULT_VOICE_SETTINGS)
    expect(resolveVoiceSettings({ 'voice.autoConfirm': true })).toEqual({ 'voice.autoConfirm': true, 'voice.autoConfirmSec': 5 })
  })

  it('검사: 범위 밖·정수 아님·모르는 키·객체 아님을 문제로 돌려준다', () => {
    expect(checkVoiceSettings({})).toEqual([])
    expect(checkVoiceSettings({ 'voice.autoConfirm': true, 'voice.autoConfirmSec': 3 })).toEqual([])
    expect(checkVoiceSettings({ 'voice.autoConfirmSec': 30 })).toEqual([])
    for (const sec of [2, 31, 5.5, Number.NaN, '5', null]) {
      expect(checkVoiceSettings({ 'voice.autoConfirmSec': sec }).map((p) => p.key)).toEqual(['voice.autoConfirmSec'])
    }
    expect(checkVoiceSettings({ 'voice.autoConfirm': 'true' }).map((p) => p.key)).toEqual(['voice.autoConfirm'])
    expect(checkVoiceSettings({ 'voice.autoconfirm': true }).map((p) => p.key)).toEqual(['voice.autoconfirm'])
    for (const bad of [null, [], 'on', 5]) expect(checkVoiceSettings(bad)).toEqual([{ key: null, message: expect.any(String) }])
    // 문장에 영어 상태값·키 이름이 없다
    for (const problem of checkVoiceSettings({ 'voice.autoConfirmSec': 99, 'voice.autoConfirm': 1, x: 1 })) expect(problem.message).not.toMatch(/[A-Za-z]/)
  })

  it('검사를 통과하지 못한 값은 쓰지 않는다 — 잘못된 설정으로 자동 확정이 켜지거나 기다림이 줄지 않는다', () => {
    expect(resolveVoiceSettings({ 'voice.autoConfirm': 'yes', 'voice.autoConfirmSec': 0 })).toEqual(DEFAULT_VOICE_SETTINGS)
  })
})

describe('AC-P2-10 카드 만들기·확정·고치기·닫기', () => {
  it('번호가 있거나 품종·가격이 둘 다 있을 때만 카드', () => {
    const make = (text: string): SuggestionCard | null =>
      createCard({ id: 'c', extraction: extractVoice(text, { dictionary: ['핑크프릴'] }), text, createdAt: T0 })
    expect(make('안녕하세요')).toBe(null)
    expect(make('만원')).toBe(null)
    expect(make('핑크프릴')).toBe(null)
    expect(make('15번')).not.toBe(null)
    expect(make('핑크프릴 만원')).not.toBe(null)
  })

  it('카드는 번호·품종·가격·신뢰도·원래 문장·만든 시각·상태·손댐·자동 확정 시각을 가진다 — JSON으로 옮길 수 있는 값만', () => {
    const made = card()
    expect(made).toEqual({ id: 'c1', no: 15, name: '핑크프릴', price: 10000, confidence: 'HIGH', text: '15번 핑크프릴 만원', createdAt: T0, status: 'OPEN', touched: false, autoConfirmAt: T0 + 5000 })
    expect(JSON.parse(JSON.stringify(made))).toEqual(made)
  })

  it('자동 확정 시각: 설정 켬 ∧ HIGH일 때만 (기본 설정·LOW → 없음)', () => {
    expect(card(HIGH, { settings: {} }).autoConfirmAt).toBe(null)
    expect(card(LOW).autoConfirmAt).toBe(null)
    expect(card(HIGH, { settings: { ...ON, 'voice.autoConfirmSec': 10 } }).autoConfirmAt).toBe(T0 + 10_000)
  })

  it('만들기 입력이 틀리면 예외 (부르는 쪽 실수)', () => {
    expect(() => createCard({ id: '', extraction: HIGH, text: '', createdAt: T0 })).toThrow(TypeError)
    expect(() => createCard({ id: 'c', extraction: HIGH, text: '', createdAt: Number.NaN })).toThrow(TypeError)
  })

  it('확정: 번호·가격이 있으면 등록할 { no, name, price }, 품종이 없으면 "" (품종 미입력)', () => {
    const result = confirmCard(card(), { existingNumbers: [1, 2] })
    expect(result).toEqual({ ok: true, card: { ...card(), status: 'CONFIRMED', autoConfirmAt: null }, registration: { no: 15, name: '핑크프릴', price: 10000 } })
    const noName = confirmCard(card({ ...HIGH, name: null, confidence: 'LOW' }), { existingNumbers: [] })
    expect(noName.ok && noName.registration).toEqual({ no: 15, name: '', price: 10000 })
  })

  it('확정할 수 없는 이유는 각각 다르다: 번호 없음·가격 없음·이미 있는 번호(고칠까요?)·범위 밖·열린 카드 아님', () => {
    const reasons = [
      confirmCard(card({ ...LOW, no: null }), { existingNumbers: [] }),
      confirmCard(card({ ...LOW, price: null }), { existingNumbers: [] }),
      confirmCard(card(), { existingNumbers: [15] }),
      confirmCard(card(), { existingNumbers: new Set([15]) }),
      confirmCard(card(), { existingNumbers: [], maxNumber: 10 }),
      confirmCard(closeCard(card()), { existingNumbers: [] }),
    ]
    expect(reasons.map((r) => (r.ok ? 'ok' : r.reason))).toEqual(['NUMBER_MISSING', 'PRICE_MISSING', 'NUMBER_EXISTS', 'NUMBER_EXISTS', 'NUMBER_OUT_OF_RANGE', 'NOT_OPEN'])
    const exists = reasons[2]
    expect(exists?.ok === false && exists.message).toBe('15번이 이미 있어요. 고칠까요?')
    // 이미 있는 번호면 등록하지 않고 카드는 열린 채로
    expect(exists?.card.status).toBe('OPEN')
    for (const r of reasons) if (!r.ok) expect(r.message).not.toMatch(/[A-Za-z]/)
  })

  it('고치기: 바꾸면 손댐·자동 확정 꺼짐, 형식이 틀린 번호·가격은 받지 않는다', () => {
    const edited = editCard(card(), { no: 16, name: '  라울 ', price: 5000 })
    expect(edited).toEqual({ ok: true, card: { ...card(), no: 16, name: '라울', price: 5000, touched: true, autoConfirmAt: null } })
    expect(editCard(card(), { name: '' })).toMatchObject({ ok: true, card: { name: null, touched: true } })
    expect(editCard(card(), { no: null, price: null })).toMatchObject({ ok: true, card: { no: null, price: null } })
    const bad = [
      editCard(card(), { no: 0 }),
      editCard(card(), { no: 1000 }),
      editCard(card(), { no: 15.5 }),
      editCard(card(), { no: '16' as unknown as number }),
      editCard(card(), { no: 51 }, { maxNumber: 50 }),
      editCard(card(), { price: 99 }),
      editCard(card(), { price: 1000.5 }),
      editCard(card(), { price: -100 }),
      editCard(card(), { name: 3 as unknown as string }),
      editCard(closeCard(card()), { no: 16 }),
    ]
    expect(bad.map((r) => (r.ok ? 'ok' : r.reason))).toEqual([
      'NUMBER_INVALID',
      'NUMBER_INVALID',
      'NUMBER_INVALID',
      'NUMBER_INVALID',
      'NUMBER_INVALID',
      'PRICE_INVALID',
      'PRICE_INVALID',
      'PRICE_INVALID',
      'NAME_INVALID',
      'NOT_OPEN',
    ])
    // 틀린 값이면 카드는 그대로(손대지 않음)
    for (const r of bad) expect(r.card.touched).toBe(false)
  })

  it('닫기: 상태 닫힘, 등록 없음', () => {
    const closed = closeCard(card())
    expect(closed).toMatchObject({ status: 'CLOSED', autoConfirmAt: null })
    expect(confirmCard(closed, { existingNumbers: [] }).ok).toBe(false)
    expect(closeCard(closed)).toEqual(closed)
  })

  it('모든 함수는 넘긴 카드·목록을 바꾸지 않는다', () => {
    const frozen = deepFreeze(card())
    const list = deepFreeze([card(HIGH, { id: 'a' }), card(HIGH, { id: 'b' })])
    expect(() => {
      confirmCard(frozen, { existingNumbers: deepFreeze([1]) })
      editCard(frozen, { no: 3 })
      closeCard(frozen)
      touchCard(frozen)
      checkAutoConfirm(frozen, { settings: ON, now: T0 + 9999, existingNumbers: deepFreeze([15]) })
      addCard(list, frozen)
      replaceCard(list, frozen)
    }).not.toThrow()
  })

  it('카드 문장', () => {
    expect(describeCard(card())).toBe('15번 핑크프릴 10,000원 — 등록할까요?')
    expect(describeCard(card({ no: 15, name: null, price: null, confidence: 'LOW' }))).toBe('15번 품종 미입력 가격 없음 — 등록할까요?')
  })
})

describe('AC-P2-11 자동 확정 조건', () => {
  const due = (target: SuggestionCard, now: number, existingNumbers: number[] = [], settings: object = ON): boolean =>
    checkAutoConfirm(target, { settings, now, existingNumbers }).due

  it('경계: 기다림 5초면 만든 시각 + 4,999ms 거짓, + 5,000ms 참', () => {
    expect(due(card(), T0 + 4999)).toBe(false)
    expect(due(card(), T0 + 5000)).toBe(true)
    expect(due(card(), T0 + 60_000)).toBe(true)
  })

  it('설정 끔·LOW·손댐·닫힘·확정된 카드는 거짓', () => {
    expect(due(card(), T0 + 5000, [], {})).toBe(false)
    expect(due(card(), T0 + 5000, [], { 'voice.autoConfirm': false })).toBe(false)
    expect(due(card(LOW), T0 + 5000)).toBe(false)
    expect(due(touchCard(card()), T0 + 5000)).toBe(false)
    const edited = editCard(card(), { no: 15 })
    expect(edited.ok && due(edited.card, T0 + 5000)).toBe(false)
    expect(due(closeCard(card()), T0 + 5000)).toBe(false)
    const confirmed = confirmCard(card(), { existingNumbers: [] })
    expect(due(confirmed.card, T0 + 5000)).toBe(false)
  })

  it('번호가 이미 있으면 거짓이고 그 카드의 자동 확정이 꺼진다 — 그 뒤 번호가 사라져도 다시 켜지지 않는다', () => {
    const first = checkAutoConfirm(card(), { settings: ON, now: T0 + 1000, existingNumbers: [15] })
    expect(first).toEqual({ due: false, card: { ...card(), autoConfirmAt: null } })
    expect(due(first.card, T0 + 5000, [])).toBe(false)
  })

  it('설정을 끈 상태로 만든 카드는 나중에 설정을 켜도 자동 확정 시각이 없다', () => {
    const made = card(HIGH, { settings: {} })
    expect(due(made, T0 + 60_000, [], ON)).toBe(false)
  })

  it('속성: 설정 끔이면 어떤 순서로도 참이 되지 않는다, LOW 카드는 참이 되지 않는다', () => {
    const step = fc.oneof(
      fc.record({ kind: fc.constant('check' as const), dt: fc.integer({ min: 0, max: 20_000 }), exists: fc.boolean() }),
      fc.record({ kind: fc.constant('edit' as const), no: fc.integer({ min: 1, max: 30 }) }),
      fc.record({ kind: fc.constant('touch' as const) }),
    )
    fc.assert(
      fc.property(fc.boolean(), fc.constantFrom<'HIGH' | 'LOW'>('HIGH', 'LOW'), fc.array(step, { maxLength: 12 }), (createdOn, confidence, steps) => {
        let current = card({ ...HIGH, confidence }, { settings: createdOn ? ON : {} })
        for (const s of steps) {
          if (s.kind === 'check') {
            const off = checkAutoConfirm(current, { settings: { 'voice.autoConfirm': false }, now: T0 + s.dt, existingNumbers: s.exists ? [current.no ?? 0] : [] })
            expect(off.due).toBe(false)
            const on = checkAutoConfirm(current, { settings: ON, now: T0 + s.dt, existingNumbers: s.exists ? [current.no ?? 0] : [] })
            if (confidence === 'LOW' || !createdOn) expect(on.due).toBe(false)
            current = on.card
          } else if (s.kind === 'edit') {
            const edited = editCard(current, { no: s.no })
            if (edited.ok) current = edited.card
          } else current = touchCard(current)
          if (current.touched) expect(checkAutoConfirm(current, { settings: ON, now: T0 + 1e9, existingNumbers: [] }).due).toBe(false)
        }
      }),
      { numRuns: 300 },
    )
  })
})

describe('AC-P2-12 열린 카드 3장', () => {
  const at = (id: string, minutes: number, extraction: VoiceExtraction = HIGH): SuggestionCard => card(extraction, { id, createdAt: T0 + minutes * 60_000 })

  it('새 카드가 맨 앞, 넘치면 손대지 않은 가장 오래된 열린 카드를 닫는다', () => {
    let cards: SuggestionCard[] = []
    for (const id of ['a', 'b', 'c']) cards = addCard(cards, at(id, cards.length))
    expect(cards.map((c) => c.id)).toEqual(['c', 'b', 'a'])
    cards = addCard(cards, at('d', 3))
    expect(cards.map((c) => `${c.id}:${c.status}`)).toEqual(['d:OPEN', 'c:OPEN', 'b:OPEN', 'a:CLOSED'])
    expect(openCardCount(cards)).toBe(MAX_OPEN_CARDS)
  })

  it('손댄 카드는 닫지 않는다 — 그다음 오래된 손대지 않은 카드를 닫는다', () => {
    let cards = [at('c', 2), touchCard(at('b', 1)), touchCard(at('a', 0))]
    cards = addCard(cards, at('d', 3))
    expect(cards.map((c) => `${c.id}:${c.status}`)).toEqual(['d:OPEN', 'c:CLOSED', 'b:OPEN', 'a:OPEN'])
  })

  it('모두 손댔으면 4장 이상도 된다 (방금 넣은 카드도 닫지 않는다)', () => {
    let cards = [touchCard(at('c', 2)), touchCard(at('b', 1)), touchCard(at('a', 0))]
    cards = addCard(cards, at('d', 3))
    expect(openCardCount(cards)).toBe(4)
    cards = addCard(cards, at('e', 4))
    expect(cards.map((c) => `${c.id}:${c.status}`)).toEqual(['e:OPEN', 'd:CLOSED', 'c:OPEN', 'b:OPEN', 'a:OPEN'])
  })

  it('확정·닫힌 카드는 세지 않는다', () => {
    const confirmed = confirmCard(at('x', 0), { existingNumbers: [] }).card
    let cards = [closeCard(at('y', 1)), confirmed, at('c', 2), at('b', 1)]
    cards = addCard(cards, at('d', 3))
    expect(openCardCount(cards)).toBe(3)
    expect(cards.every((c) => c.status !== 'CLOSED' || c.id === 'y')).toBe(true)
  })

  it('replaceCard는 같은 ID의 카드만 바꾼다', () => {
    const cards = [at('a', 0), at('b', 1)]
    const replaced = replaceCard(cards, closeCard(at('b', 1)))
    expect(replaced.map((c) => c.status)).toEqual(['OPEN', 'CLOSED'])
    expect(cards.map((c) => c.status)).toEqual(['OPEN', 'OPEN'])
  })
})

// ── I4 ─────────────────────────────────────────────────────────────────────

describe('AC-I4-02 열린 카드 3장 예외 (D-I4-02, SPEC VOC-04) — 새 카드·손댄 카드는 닫지 않는다', () => {
  const at = (id: string, minutes: number): SuggestionCard => card(HIGH, { id, createdAt: T0 + minutes * 60_000 })
  const touchedOpen = (cards: readonly SuggestionCard[]): number => cards.filter((c) => c.status === 'OPEN' && c.touched).length

  it('손댄 카드 3장 + 새 카드 → 4장, 이어서 새 카드 → 4장이고 앞의 손대지 않은 새 카드가 닫힌다', () => {
    let cards = [touchCard(at('c', 2)), touchCard(at('b', 1)), touchCard(at('a', 0))]
    cards = addCard(cards, at('d', 3))
    expect(cards.map((c) => `${c.id}:${c.status}`)).toEqual(['d:OPEN', 'c:OPEN', 'b:OPEN', 'a:OPEN'])
    expect(openCardCount(cards)).toBe(4)
    cards = addCard(cards, at('e', 4))
    expect(cards.map((c) => `${c.id}:${c.status}`)).toEqual(['e:OPEN', 'd:CLOSED', 'c:OPEN', 'b:OPEN', 'a:OPEN'])
    expect(openCardCount(cards)).toBe(4)
    // 상한: max(3, 손댄 열린 카드 수 + 1)
    expect(openCardCount(cards)).toBeLessThanOrEqual(Math.max(MAX_OPEN_CARDS, touchedOpen(cards) + 1))
  })

  it('손댄 카드는 가장 오래되어도 닫히지 않고, 손대지 않은 카드는 오래된 것부터 닫힌다', () => {
    let cards = [at('c', 2), at('b', 1), touchCard(at('a', 0))]
    cards = addCard(cards, at('d', 3))
    expect(cards.map((c) => `${c.id}:${c.status}`)).toEqual(['d:OPEN', 'c:OPEN', 'b:CLOSED', 'a:OPEN'])
    cards = addCard(cards, at('e', 4))
    expect(cards.map((c) => `${c.id}:${c.status}`)).toEqual(['e:OPEN', 'd:OPEN', 'c:CLOSED', 'b:CLOSED', 'a:OPEN'])
  })

  it('addCard 함수 설명이 D-I4-02를 가리킨다', async () => {
    const { readFile } = await import('node:fs/promises')
    const source = await readFile(new URL('../src/card.ts', import.meta.url), 'utf8')
    const doc = source.slice(0, source.indexOf('export function addCard'))
    expect(doc.slice(doc.lastIndexOf('/**'))).toContain('D-I4-02')
  })

  type Op =
    | { readonly kind: 'add'; readonly extraction: VoiceExtraction }
    | { readonly kind: 'touch' | 'confirm' | 'close' | 'edit'; readonly pick: number }

  const extraction = fc.constantFrom<VoiceExtraction>(HIGH, LOW, { no: null, name: '라울', price: 5000, confidence: 'LOW' }, { no: 7, name: null, price: null, confidence: 'LOW' })
  const op: fc.Arbitrary<Op> = fc.oneof(
    { weight: 3, arbitrary: extraction.map((value): Op => ({ kind: 'add', extraction: value })) },
    fc.record({ kind: fc.constantFrom('touch', 'confirm', 'close', 'edit'), pick: fc.nat({ max: 20 }) }) as fc.Arbitrary<Op>,
  )

  it('속성: 만들기·손대기·고치기·확정·닫기·넣기를 임의 순서로 → 열린 카드 ≤ max(3, 손댄 열린 카드 + 1), 손댄 카드는 넣기로 닫히지 않음, 넣은 카드는 열림', () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 40 }), fc.boolean(), (ops, autoOn) => {
        let cards: SuggestionCard[] = []
        let made = 0
        for (const step of ops) {
          if (step.kind === 'add') {
            const next = createCard({ id: `k${String(made)}`, extraction: step.extraction, text: '문장', createdAt: T0 + made * 1000, settings: autoOn ? ON : {} })
            made++
            if (next === null) continue
            const before = cards
            cards = addCard(cards, next)
            // 넣은 카드는 맨 앞이고 열려 있다
            expect(cards[0]).toEqual(next)
            expect(cards[0]?.status).toBe('OPEN')
            expect(cards.length).toBe(before.length + 1)
            // 손댄 열린 카드는 넣기로 닫히지 않는다, 닫힌 카드는 손대지 않은 열린 카드였다
            before.forEach((old, i) => {
              const now = cards[i + 1] as SuggestionCard
              expect(now.id).toBe(old.id)
              if (old.status === 'OPEN' && old.touched) expect(now.status).toBe('OPEN')
              if (old.status !== 'OPEN') expect(now).toEqual(old)
              if (now.status !== old.status) expect(old.touched).toBe(false)
            })
            // 닫은 것은 3장을 넘을 때만 — 넣은 뒤 열린 카드가 3장 이하면 넘치지 않았다는 뜻이고, 넘쳤다면 손대지 않은 카드가 남지 않는다(새 카드 빼고)
            const open = cards.filter((c) => c.status === 'OPEN')
            if (open.length > MAX_OPEN_CARDS) expect(open.slice(1).every((c) => c.touched)).toBe(true)
          } else {
            const target = cards[step.pick % Math.max(cards.length, 1)]
            if (target === undefined) continue
            const changed =
              step.kind === 'touch'
                ? touchCard(target)
                : step.kind === 'close'
                  ? closeCard(target)
                  : step.kind === 'edit'
                    ? editCard(target, { name: '라울' }).card
                    : confirmCard(target, { existingNumbers: [] }).card
            cards = replaceCard(cards, changed)
          }
          expect(openCardCount(cards)).toBeLessThanOrEqual(Math.max(MAX_OPEN_CARDS, touchedOpen(cards) + 1))
        }
      }),
      { numRuns: 400 },
    )
  })
})
