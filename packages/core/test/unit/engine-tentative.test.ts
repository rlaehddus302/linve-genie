// 확인 중(임시 등록) 상품 (R-2 "확인 중"·R-5·R-10·R-13, D-RETRO-80~82 — 2026-11-12 라이브 복기 A2·B2·C·G6).
// 지키는 성질: (a) 확인 중인 상품의 찜은 확정되지 않고 효과가 나오지 않는다 · (b) 확정하면 기다리던 찜이 도착 순서대로 확정 시점의 값으로 판정된다 ·
// (c) 확정하며 번호를 바꾸면 그 번호로 온 보류 찜이 판정된다 · (d) 거두면 그 번호의 보류 찜은 그대로 보류다 ·
// (e) 확인 중 칸은 적은 등록의 상품에만 들어간다(옛 로그 재생 결과 그대로) · (f) 적지 않은 등록은 바로 판매 중이다.
import {
  TENTATIVE_LIMITS,
  TENTATIVE_REASONS,
  applyEvent,
  checkEvent,
  checkInvariants,
  getProduct,
  listClaims,
  listEffects,
  listPending,
  listProducts,
  pendingCount,
  type EngineEvent,
  type EngineState,
  type TentativeInput,
} from '@livejjim/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { B1, T0, chat, play, register, sms, type EventInput } from './engine-helpers.ts'

const WORKER: TentativeInput = { by: 'WORKER', reasons: [TENTATIVE_REASONS.NUMBER_SINGLE_SOURCE] }
const tentative = (no: number, fields: Partial<{ name: string; price: number; stock: number; at: number; tentative: TentativeInput }> = {}): EventInput =>
  ({ type: 'product.register', b: 'b1', no, name: '빅뱅', price: 10000, tentative: WORKER, ...fields }) as EventInput
const confirm = (no: number, fields: Partial<{ to: number; name: string; price: number; at: number }> = {}): EventInput => ({ type: 'product.confirm', b: 'b1', no, ...fields }) as EventInput
const withdraw = (no: number): EventInput => ({ type: 'product.withdraw', b: 'b1', no }) as EventInput
const update = (no: number, fields: Partial<{ name: string; price: number }>): EventInput => ({ type: 'product.update', b: 'b1', no, ...fields })
const renumber = (from: number, to: number): EventInput => ({ type: 'product.renumber', b: 'b1', from, to })
const open = (no: number): EventInput => ({ type: 'product.open', b: 'b1', no })
const close = (no: number): EventInput => ({ type: 'product.close', b: 'b1', no })

/** 구매자 → 그 번호에서의 가장 최근 찜 [상태, 단가] */
const claimsAt = (state: EngineState, no: number): Record<string, [string, number | null]> =>
  Object.fromEntries(listClaims(state).filter((c) => c.no === no && c.product === `b1/${String(no)}`).map((c) => [c.buyer, [c.status, c.price]]))
/** 운영과 같은 설정: 등록 전 찜은 만료하지 않는다 (D-PEND-01) */
const KEEP = { 'claim.preOpenExpire': false } as const

describe('R-2 확인 중 — 임시 등록', () => {
  it('(a) 확인 중 상품은 공개 전이고, 그 번호의 찜은 보류로 남아 효과(라벨·감사)가 하나도 나오지 않는다', () => {
    const { state, emitted } = play([chat('A', '313'), tentative(313, { tentative: { by: 'WORKER', reasons: ['NUMBER_MISMATCH', 'PRICE_DISAGREE'], candidates: { no: [313, 318], price: [10000, 30000], name: ['빅뱅', '빅방'] } } }), chat('B', '313'), sms('s1', 313, '20:00')], KEEP)
    expect(getProduct(state, 'b1', 313)).toMatchObject({
      status: 'READY',
      name: '빅뱅',
      price: 10000,
      winners: [],
      waitlist: [],
      tentative: { by: 'WORKER', reasons: ['NUMBER_MISMATCH', 'PRICE_DISAGREE'], candidates: { no: [313, 318], price: [10000, 30000], name: ['빅뱅', '빅방'] }, at: T0 + 1000 },
    })
    expect(listPending(state)).toEqual([expect.objectContaining({ no: 313, buyers: ['A', 'B', 'sms:s1'] })])
    expect(pendingCount(state, 'b1', 313)).toBe(3)
    expect(pendingCount(state, 'b1', 999)).toBe(0)
    expect(emitted.flat()).toEqual([])
    expect(listEffects(state)).toEqual([])
    expect(checkInvariants(state)).toEqual([])
  })

  it('(f) 확인 중 칸을 적지 않은 등록은 지금 그대로 바로 판매 중이고, 상품 기록·조회에 확인 중 칸이 생기지 않는다 (e)', () => {
    const { state, emitted } = play([chat('A', '15'), register(15), register(16, { status: 'READY' })], KEEP)
    expect(getProduct(state, 'b1', 15)).toMatchObject({ status: 'SOLD', winners: ['A'] })
    expect(getProduct(state, 'b1', 15)).not.toHaveProperty('tentative')
    expect(getProduct(state, 'b1', 16)).not.toHaveProperty('tentative')
    expect(emitted[1]?.map((e) => e.kind)).toEqual(['PRINT_PRODUCT_LABEL', 'POST_THANKS'])
    expect(JSON.stringify(state)).not.toContain('tentative')
  })

  it('후보는 적지 않으면 빈 목록이고, 조회에는 닉네임·채팅 글이 실리지 않는다', () => {
    const { state } = play([tentative(7), chat('UC_SECRET', '7 주세요 비밀글', { nick: '비밀닉네임' })], { ...KEEP, 'claim.parseMode': 'LOOSE' })
    const info = getProduct(state, 'b1', 7)
    expect(info?.tentative).toEqual({ by: 'WORKER', reasons: ['NUMBER_SINGLE_SOURCE'], candidates: { no: [], price: [], name: [] }, seq: 1, at: T0 })
    expect(JSON.stringify(info?.tentative)).not.toMatch(/비밀|UC_SECRET/)
  })
})

describe('R-2 확인 중 — 확정 (product.confirm)', () => {
  it('(b) 확정하면 기다리던 찜이 도착 순서대로, 확정하며 정한 값으로 판정되고 그때 효과가 나온다 (313번: 임시 1만 원 → 3만 원으로 확정)', () => {
    const { state, emitted } = play([chat('A', '313', { nick: '손님A' }), tentative(313, { stock: 1 }), chat('B', '313'), confirm(313, { price: 30000, name: '빅뱅금' })], KEEP)
    expect(getProduct(state, 'b1', 313)).toMatchObject({ status: 'SOLD', name: '빅뱅금', price: 30000, winners: ['A'], waitlist: ['B'], priceHistory: [{ from: 10000, to: 30000 }], nameHistory: [{ from: '빅뱅', to: '빅뱅금' }], confirmVersion: 1 })
    expect(getProduct(state, 'b1', 313)).not.toHaveProperty('tentative')
    expect(claimsAt(state, 313)).toEqual({ A: ['CONFIRMED', 30000], B: ['WAITLISTED', null] })
    expect(emitted.slice(0, 3).flat()).toEqual([])
    expect(emitted[3]).toEqual([
      expect.objectContaining({ kind: 'PRINT_PRODUCT_LABEL', buyer: 'A', product: 'b1/313' }),
      expect.objectContaining({ kind: 'POST_THANKS', buyer: 'A', text: '313번 빅뱅금 30,000원 손님A님 구매 감사합니다' }),
    ])
    expect(checkInvariants(state)).toEqual([])
  })

  it('값을 적지 않은 확정은 지금 값 그대로다 — 확인 중에 고친 값(product.update)이 들어간다', () => {
    const { state } = play([tentative(20), chat('A', '20'), update(20, { price: 25000 }), confirm(20)], KEEP)
    expect(getProduct(state, 'b1', 20)).toMatchObject({ status: 'SOLD', price: 25000, priceHistory: [{ from: 10000, to: 25000 }] })
    expect(getProduct(state, 'b1', 20)).not.toHaveProperty('tentative')
    expect(claimsAt(state, 20)).toEqual({ A: ['CONFIRMED', 25000] })
  })

  it('(c) 틀린 번호로 임시 등록됐다가 옳은 번호로 확정하면, 옳은 번호로 기다리던 찜이 도착 순서대로 살아난다. 틀린 번호의 보류 찜은 그 번호에 남는다', () => {
    const { state, emitted } = play([chat('A', '333'), tentative(334, { stock: 2 }), chat('B', '333'), chat('C', '334'), chat('D', '333'), confirm(334, { to: 333, price: 40000 })], KEEP)
    expect(getProduct(state, 'b1', 334)).toBeNull()
    expect(getProduct(state, 'b1', 333)).toMatchObject({ status: 'SOLD', price: 40000, winners: ['A', 'B'], waitlist: ['D'] })
    expect(claimsAt(state, 333)).toEqual({ A: ['CONFIRMED', 40000], B: ['CONFIRMED', 40000], D: ['WAITLISTED', null] })
    expect(listPending(state)).toEqual([expect.objectContaining({ no: 334, buyers: ['C'] })])
    expect(emitted[5]?.filter((e) => e.kind === 'POST_THANKS').map((e) => e.buyer)).toEqual(['A', 'B'])
    expect(checkInvariants(state)).toEqual([])
  })

  it('(c) 확정 전에 번호 변경(product.renumber)으로 옮겨도 확인 중 그대로이고, 확정할 때 새 번호의 보류 찜이 판정된다', () => {
    const { state, emitted } = play([chat('A', '333'), tentative(334), renumber(334, 333), chat('B', '333'), confirm(333)], KEEP)
    expect(emitted.slice(0, 4).flat()).toEqual([])
    expect(getProduct(state, 'b1', 333)).toMatchObject({ status: 'SOLD', winners: ['A'], waitlist: ['B'] })
  })

  it('최종 번호에 상품 기록이 이미 있으면(판매 종료 포함) 이벤트 전체가 아무 일도 없다 — 확인 중 그대로', () => {
    const { state } = play([tentative(334), register(333), register(335), close(335), chat('A', '334')], KEEP)
    for (const to of [333, 335]) {
      const result = applyEvent(state, { seq: 9, at: T0 + 9000, ...confirm(334, { to, price: 1 }) } as EngineEvent)
      expect(result.state, String(to)).toBe(state)
      expect(result.effects).toEqual([])
    }
  })

  it('확인 중이 아닌 상품·없는 번호의 확정과 거두기는 아무 일도 없다 (늦게 온 확정이 판매자가 확정한 값을 덮지 않는다)', () => {
    const { state } = play([tentative(1), confirm(1, { price: 30000 }), register(2), register(3, { status: 'READY' })], KEEP)
    for (const event of [confirm(1, { price: 10000, name: '다른 이름' }), confirm(1, { to: 9 }), confirm(2, { price: 1 }), confirm(3, { price: 1 }), confirm(99), withdraw(1), withdraw(2), withdraw(3), withdraw(99)]) {
      const result = applyEvent(state, { seq: 9, at: T0 + 9000, ...event } as EngineEvent)
      expect(result.state, JSON.stringify(event)).toBe(state)
      expect(result.effects).toEqual([])
    }
    expect(getProduct(state, 'b1', 1)).toMatchObject({ status: 'OPEN', price: 30000 })
  })

  it('확인 중 상품을 공개(product.open)하면 지금 값으로 확정한 것이다 — 표시가 사라지고 보류 찜이 판정된다', () => {
    const { state } = play([tentative(5), chat('A', '5'), open(5)], KEEP)
    expect(getProduct(state, 'b1', 5)).toMatchObject({ status: 'SOLD', winners: ['A'], price: 10000 })
    expect(getProduct(state, 'b1', 5)).not.toHaveProperty('tentative')
  })

  it('확정은 처음 판매 중인 상품을 공개한 것과 같은 판정을 낸다: 임시 등록 → 확정(번호·품종·금액) = 공개 전 등록 → 수정 → 번호 변경 → 공개', () => {
    const claims = [chat('A', '8', { id: 'x1' }), chat('B', '9', { id: 'x2' }), chat('C', '8', { id: 'x3' }), sms('s1', 8, '20:00'), chat('A', '8 취소', { id: 'x4' })]
    const viaConfirm = play([tentative(9, { stock: 2 }), ...claims, confirm(9, { to: 8, name: '창', price: 7000 })], KEEP).state
    const viaOpen = play([register(9, { name: '빅뱅', stock: 2, status: 'READY' }), ...claims, update(9, { name: '창', price: 7000 }), renumber(9, 8), open(8)], KEEP).state
    const judged = (state: EngineState) => listClaims(state).map(({ id, product, buyer, status, reason, price, confirmVersion }) => ({ id, product, buyer, status, reason, price, confirmVersion }))
    expect(judged(viaConfirm)).toEqual(judged(viaOpen))
    expect(listEffects(viaConfirm).map(({ id, kind, text, status }) => ({ id, kind, text, status }))).toEqual(listEffects(viaOpen).map(({ id, kind, text, status }) => ({ id, kind, text, status })))
    const { priceHistory: _p, nameHistory: _n, ...confirmed } = getProduct(viaConfirm, 'b1', 8) ?? { priceHistory: [], nameHistory: [] }
    const { priceHistory: _p2, nameHistory: _n2, ...opened } = getProduct(viaOpen, 'b1', 8) ?? { priceHistory: [], nameHistory: [] }
    expect(confirmed).toEqual(opened)
  })
})

describe('R-5 확인 중 상품의 보류 찜 유효 시간', () => {
  it('유효 시간은 임시 등록 시각에서 잰다: 확정이 늦어도 임시 등록 30초 전부터 온 찜은 판정하고, 그보다 오래된 찜만 만료한다', () => {
    // 기본 설정(claim.preOpenExpire 예, 30초). A는 임시 등록 40초 전, B는 30초 전(경계 포함), C는 임시 등록 뒤
    const { state } = play([
      chat('A', '50', { at: T0 }),
      chat('B', '50', { at: T0 + 10_000 }),
      tentative(50, { stock: 3, at: T0 + 40_000 }),
      chat('C', '50', { at: T0 + 100_000 }),
      confirm(50, { at: T0 + 300_000 }),
    ])
    expect(claimsAt(state, 50)).toEqual({ A: ['REJECTED', null], B: ['CONFIRMED', 10000], C: ['CONFIRMED', 10000] })
    expect(listClaims(state).find((c) => c.buyer === 'A')?.reason).toBe('EXPIRED')
  })

  it('공개(product.open)로 확정해도 같다. 확인 중이 아닌 공개 전 상품은 지금처럼 공개 시각에서 잰다', () => {
    const viaOpen = play([chat('B', '50', { at: T0 + 10_000 }), tentative(50, { at: T0 + 40_000 }), { ...open(50), at: T0 + 300_000 }]).state
    expect(claimsAt(viaOpen, 50)).toEqual({ B: ['CONFIRMED', 10000] })
    const plain = play([chat('B', '50', { at: T0 + 10_000 }), register(50, { status: 'READY', at: T0 + 40_000 }), { ...open(50), at: T0 + 300_000 }]).state
    expect(listClaims(plain).find((c) => c.buyer === 'B')).toMatchObject({ status: 'REJECTED', reason: 'EXPIRED' })
  })
})

describe('R-2 확인 중 — 거두기 (product.withdraw)·판매 종료', () => {
  it('(d) 거두면 상품 기록이 없어지고 그 번호의 보류 찜은 그대로 보류다. 같은 번호를 다시 등록하면 그 찜이 도착 순서대로 판정된다', () => {
    const before = play([chat('A', '40'), tentative(40), chat('B', '40'), withdraw(40)], KEEP)
    expect(getProduct(before.state, 'b1', 40)).toBeNull()
    expect(listProducts(before.state)).toEqual([])
    expect(listPending(before.state)).toEqual([expect.objectContaining({ no: 40, buyers: ['A', 'B'] })])
    expect(before.emitted.flat()).toEqual([])
    expect(checkInvariants(before.state)).toEqual([])
    // 거둔 번호에 온 새 찜도 보류다 (없는 번호와 같다 — R-4 2번 줄)
    const { state, emitted } = play([chat('A', '40'), tentative(40), chat('B', '40'), withdraw(40), chat('C', '40'), register(40, { name: '진짜', price: 50000, stock: 2 })], KEEP)
    expect(getProduct(state, 'b1', 40)).toMatchObject({ status: 'SOLD', name: '진짜', price: 50000, winners: ['A', 'B'], waitlist: ['C'], confirmVersion: 2 })
    expect(emitted[5]?.filter((e) => e.kind === 'POST_THANKS').map((e) => e.text)).toEqual(['40번 진짜 50,000원 A님 구매 감사합니다', '40번 진짜 50,000원 B님 구매 감사합니다'])
    // 새 상품은 새 상품 ID를 받는다
    expect(getProduct(state, 'b1', 40)?.id).toBe('p2')
    expect(checkInvariants(state)).toEqual([])
  })

  it('거둔 뒤 다시 임시 등록할 수도 있다', () => {
    const { state } = play([tentative(40), withdraw(40), tentative(40, { price: 20000 }), chat('A', '40'), confirm(40)], KEEP)
    expect(getProduct(state, 'b1', 40)).toMatchObject({ status: 'SOLD', price: 20000, winners: ['A'] })
  })

  it('확인 중 상품을 판매 종료(product.close)하면 지금 규칙 그대로다(R-2): 보류 찜은 REJECTED(NOT_ON_SALE), 확인 중 표시는 사라진다', () => {
    const { state } = play([chat('A', '41'), tentative(41), close(41)], KEEP)
    expect(getProduct(state, 'b1', 41)).toMatchObject({ status: 'CLOSED' })
    expect(getProduct(state, 'b1', 41)).not.toHaveProperty('tentative')
    expect(listClaims(state)[0]).toMatchObject({ status: 'REJECTED', reason: 'NOT_ON_SALE' })
    // 다시 열면 평소의 공개다
    const reopened = play([chat('A', '41'), tentative(41), close(41), open(41), chat('B', '41')], KEEP).state
    expect(getProduct(reopened, 'b1', 41)).toMatchObject({ status: 'SOLD', winners: ['B'] })
  })

  it('같은 번호의 다시 등록은 확인 중이어도 아무 일도 없다 (R-2 — 확정은 product.confirm·product.open으로만)', () => {
    const { state } = play([tentative(42), chat('A', '42')], KEEP)
    for (const event of [register(42, { price: 30000 }), tentative(42, { price: 30000 })]) {
      expect(applyEvent(state, { seq: 9, at: T0 + 9000, ...event } as EngineEvent).state).toBe(state)
    }
  })
})

describe('옵션 방송의 확인 중 상품', () => {
  const OPTIONS = { ...KEEP, 'claim.parseMode': 'OPTIONS' } as const
  const sizes = [{ name: '크기', choices: [{ label: 'S' }, { label: 'M', price: 1000 }] }]
  it('변형을 고른 보류 찜도 확정할 때 그 변형으로 판정되고, 거두면 변형 보류 찜으로 남는다', () => {
    const product = { ...tentative(21, { name: '티셔츠', price: 5000 }), options: sizes } as EventInput
    const confirmed = play([product, chat('A', '21 M'), chat('B', '21 S'), confirm(21, { price: 6000 })], OPTIONS).state
    expect(listClaims(confirmed).map((c) => [c.buyer, c.status, c.variant, c.price])).toEqual([['A', 'CONFIRMED', 'M', 7000], ['B', 'CONFIRMED', 'S', 6000]])
    expect(checkInvariants(confirmed)).toEqual([])
    const withdrawn = play([product, chat('A', '21 M'), withdraw(21)], OPTIONS).state
    expect(getProduct(withdrawn, 'b1', 21)).toBeNull()
    expect(listClaims(withdrawn)).toEqual([expect.objectContaining({ buyer: 'A', status: 'PENDING', variant: 'M' })])
    expect(checkInvariants(withdrawn)).toEqual([])
  })

  it('확정하며 정하는 금액도 변형 단가가 0원 아래로 내려가면 입력 오류다', () => {
    const cheaper = [{ name: '크기', choices: [{ label: 'S', price: -3000 }, { label: 'M' }] }]
    const { state } = play([{ ...tentative(21, { price: 5000 }), options: cheaper } as EventInput], OPTIONS)
    expect(checkEvent(state, { seq: 2, at: T0, ...confirm(21, { price: 1000 }) })).toEqual([expect.objectContaining({ field: 'price' })])
    expect(checkEvent(state, { seq: 2, at: T0, ...confirm(21, { price: 3000 }) })).toEqual([])
  })
})

describe('R-1 확인 중 칸·확정·거두기의 입력 검사', () => {
  const state = play([]).state
  const base = { seq: 1, at: T0, type: 'product.register', b: 'b1', no: 1, name: '', price: 0 }
  const problemsOf = (value: unknown, extra: Record<string, unknown> = {}) => checkEvent(state, { ...base, ...extra, tentative: value }).map((p) => p.field)

  it('모양이 맞는 확인 중 칸은 받는다 (아는 낱말이 아니어도 모양이 맞으면 받는다)', () => {
    expect(problemsOf(WORKER)).toEqual([])
    expect(problemsOf({ by: 'SYNC', reasons: ['OTHER_ACCOUNT', 'PENDING_CLAIMS'], candidates: {} })).toEqual([])
    expect(problemsOf({ by: 'WORKER', reasons: ['SOMETHING_NEW_2'], candidates: { no: [1, 2, 3, 4], price: [0, 30000], name: ['가', '나'] } }, { status: 'READY' })).toEqual([])
    expect(Object.values(TENTATIVE_REASONS).every((word) => problemsOf({ by: 'WORKER', reasons: [word] }).length === 0)).toBe(true)
  })

  it('모양이 틀리면 입력 오류다: 누가·까닭·후보의 종류·개수·겹침, 바로 판매 중(OPEN)과 함께 쓰기', () => {
    const many = Array.from({ length: TENTATIVE_LIMITS.candidates + 1 }, (_, i) => i + 1)
    const cases: [unknown, string][] = [
      [null, 'tentative'],
      [[], 'tentative'],
      [{ reasons: ['A'] }, 'tentative.by'],
      [{ by: 'SELLER', reasons: ['A'] }, 'tentative.by'],
      [{ by: 'WORKER' }, 'tentative.reasons'],
      [{ by: 'WORKER', reasons: [] }, 'tentative.reasons'],
      [{ by: 'WORKER', reasons: ['소문자'] }, 'tentative.reasons'],
      [{ by: 'WORKER', reasons: ['a'] }, 'tentative.reasons'],
      [{ by: 'WORKER', reasons: ['A', 'A'] }, 'tentative.reasons'],
      [{ by: 'WORKER', reasons: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] }, 'tentative.reasons'],
      [{ by: 'WORKER', reasons: ['A'.repeat(33)] }, 'tentative.reasons'],
      [{ by: 'WORKER', reasons: ['A'], nick: '손님' }, 'tentative.nick'],
      [{ by: 'WORKER', reasons: ['A'], candidates: [] }, 'tentative.candidates'],
      [{ by: 'WORKER', reasons: ['A'], candidates: { photo: 'x' } }, 'tentative.candidates.photo'],
      [{ by: 'WORKER', reasons: ['A'], candidates: { no: many } }, 'tentative.candidates.no'],
      [{ by: 'WORKER', reasons: ['A'], candidates: { no: [0] } }, 'tentative.candidates.no'],
      [{ by: 'WORKER', reasons: ['A'], candidates: { no: [3, 3] } }, 'tentative.candidates.no'],
      [{ by: 'WORKER', reasons: ['A'], candidates: { price: [1.5] } }, 'tentative.candidates.price'],
      [{ by: 'WORKER', reasons: ['A'], candidates: { price: [-1] } }, 'tentative.candidates.price'],
      [{ by: 'WORKER', reasons: ['A'], candidates: { name: [''] } }, 'tentative.candidates.name'],
      [{ by: 'WORKER', reasons: ['A'], candidates: { name: ['가'.repeat(TENTATIVE_LIMITS.name + 1)] } }, 'tentative.candidates.name'],
      [{ by: 'WORKER', reasons: ['A'], candidates: { name: [3] } }, 'tentative.candidates.name'],
    ]
    for (const [value, field] of cases) expect(problemsOf(value), JSON.stringify(value)).toEqual([field])
    expect(problemsOf(WORKER, { status: 'OPEN' })).toEqual(['status'])
    expect(() => applyEvent(state, { ...base, tentative: { by: 'SELLER', reasons: ['A'] } } as never)).toThrow()
  })

  it('품종 후보·확정 품종은 글 칸이다 — 휴대폰 번호는 기록 전 검사에서만 걸린다 (D-079)', () => {
    const withPhone = { ...base, tentative: { by: 'WORKER', reasons: ['A'], candidates: { name: ['010-1234-5678'] } } }
    expect(checkEvent(state, withPhone)).toEqual([expect.objectContaining({ field: 'tentative.candidates.name', code: 'PHONE_NUMBER' })])
    expect(() => applyEvent(state, withPhone as never)).not.toThrow()
    const made = play([tentative(1)]).state
    expect(checkEvent(made, { seq: 2, at: T0, type: 'product.confirm', b: 'b1', no: 1, name: '010 1234 5678' })).toEqual([expect.objectContaining({ field: 'name', code: 'PHONE_NUMBER' })])
  })

  it('확정·거두기: 번호·금액 형식, 표에 없는 필드, 선언하지 않은 방송', () => {
    const fields = (event: Record<string, unknown>) => checkEvent(state, { seq: 1, at: T0, ...event }).map((p) => p.field)
    expect(fields({ type: 'product.confirm', b: 'b1', no: 1, to: 2, name: '', price: 0 })).toEqual([])
    expect(fields({ type: 'product.withdraw', b: 'b1', no: 1 })).toEqual([])
    expect(fields({ type: 'product.confirm', b: 'b1', no: 0 })).toEqual(['no'])
    expect(fields({ type: 'product.confirm', b: 'b1', no: 1, to: 0, price: -1, name: 3 })).toEqual(['to', 'name', 'price'])
    expect(fields({ type: 'product.confirm', b: 'b1', no: 1, stock: 2 })).toEqual(['stock'])
    expect(fields({ type: 'product.withdraw', b: 'b1', no: 1, reason: 'x' })).toEqual(['reason'])
    expect(fields({ type: 'product.withdraw', b: 'nope', no: 1 })).toEqual(['b'])
  })
})

// ── 성질 시험 ────────────────────────────────────────────────────────────

type Step =
  | { readonly kind: 'tentative' | 'register' | 'ready' | 'withdraw' | 'open' | 'close' | 'hold'; readonly no: number }
  | { readonly kind: 'confirm'; readonly no: number; readonly to: number | null; readonly price: number | null }
  | { readonly kind: 'renumber'; readonly no: number; readonly to: number }
  | { readonly kind: 'update'; readonly no: number; readonly price: number }
  | { readonly kind: 'chat'; readonly no: number; readonly ch: number; readonly cancel: boolean }
  | { readonly kind: 'sms'; readonly no: number }
  | { readonly kind: 'block'; readonly ch: number }

const NOS = [1, 2, 3] as const
const noArb = fc.constantFrom(...NOS)
const priceArb = fc.constantFrom(0, 5000, 30000)
const stepArb: fc.Arbitrary<Step> = fc.oneof(
  { weight: 4, arbitrary: fc.record({ kind: fc.constant('tentative' as const), no: noArb }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constantFrom('register' as const, 'ready' as const, 'hold' as const, 'close' as const), no: noArb }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constantFrom('withdraw' as const, 'open' as const), no: noArb }) },
  { weight: 4, arbitrary: fc.record({ kind: fc.constant('confirm' as const), no: noArb, to: fc.option(noArb, { nil: null }), price: fc.option(priceArb, { nil: null }) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('renumber' as const), no: noArb, to: noArb }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('update' as const), no: noArb, price: priceArb }) },
  { weight: 10, arbitrary: fc.record({ kind: fc.constant('chat' as const), no: noArb, ch: fc.nat(4), cancel: fc.constant(false) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('chat' as const), no: noArb, ch: fc.nat(4), cancel: fc.constant(true) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('sms' as const), no: noArb }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('block' as const), ch: fc.nat(4) }) },
)

function eventOf(step: Step, i: number): EventInput {
  switch (step.kind) {
    case 'tentative':
      return tentative(step.no, { stock: 1 + (i % 2), tentative: { by: i % 2 === 0 ? 'WORKER' : 'SYNC', reasons: ['NUMBER_MISMATCH'], candidates: { no: [step.no, step.no + 5] } } })
    case 'register':
      return register(step.no, { stock: 1 + (i % 2) })
    case 'ready':
      return register(step.no, { status: 'READY' })
    case 'withdraw':
      return withdraw(step.no)
    case 'open':
      return open(step.no)
    case 'close':
      return close(step.no)
    case 'hold':
      return { type: 'product.hold', b: 'b1', no: step.no }
    case 'confirm':
      return confirm(step.no, { ...(step.to === null ? {} : { to: step.to }), ...(step.price === null ? {} : { price: step.price }) })
    case 'renumber':
      return renumber(step.no, step.to)
    case 'update':
      return update(step.no, { price: step.price })
    case 'chat':
      return chat(`UC_${String(step.ch)}`, step.cancel ? `${String(step.no)} 취소` : String(step.no), { id: `p${String(i)}` })
    case 'sms':
      return sms(`r${String(i)}`, step.no, '20:00')
    case 'block':
      return { type: 'host.blockBuyer', buyer: `UC_${String(step.ch)}`, reason: '사유' } as EventInput
  }
}

const settingsArb = fc.record({
  'claim.preOpenExpire': fc.boolean(),
  'claim.preOpenWindowSec': fc.constantFrom(0, 2, 30),
  'waitlist.max': fc.constantFrom(0, 1, 5),
  'cancel.buyerChat': fc.constantFrom('OFF' as const, 'REQUEST' as const, 'AUTO' as const),
  'cancel.succession': fc.constantFrom('AUTO' as const, 'ASK' as const, 'REOPEN' as const),
  'thanks.followEdits': fc.boolean(),
})

describe('확인 중 상품의 성질 (무작위 이벤트 열)', () => {
  it('(a) 확인 중인 상품에는 확정·대기 찜이 없고, 확인 중인 번호에서는 효과가 나오지 않는다. 불변식은 매 이벤트 뒤에 성립한다', () => {
    fc.assert(
      fc.property(fc.array(stepArb, { maxLength: 40 }), settingsArb, (steps, settings) => {
        const { states, emitted } = play(steps.map(eventOf), settings)
        states.slice(1).forEach((state, i) => {
          expect(checkInvariants(state), `${String(i)}번째 뒤`).toEqual([])
          const products = listProducts(state)
          for (const product of products) {
            if (product.tentative === undefined) continue
            expect(product.status).toBe('READY')
            expect([product.winners, product.waitlist, product.conflict]).toEqual([[], [], false])
          }
          // 이 이벤트로 나온 효과는 모두 지금 확인 중이 아닌 상품의 것이다
          const waiting = new Set(products.filter((p) => p.tentative !== undefined).map((p) => p.key))
          for (const effect of emitted[i] ?? []) expect(waiting.has(effect.product), `${String(i)}번째: ${effect.id}`).toBe(false)
          // 확정 찜은 확인 중인 상품에 없다
          const confirmedOn = listClaims(state).filter((c) => c.status === 'CONFIRMED' || c.status === 'WAITLISTED').map((c) => c.product)
          for (const key of confirmedOn) expect(waiting.has(key)).toBe(false)
        })
      }),
      { numRuns: 300 },
    )
  })

  it('(b) 확정으로 확정된 찜의 단가는 확정한 순간의 상품 가격이고, 확정 순서는 판정 순위(도착 순서)다', () => {
    fc.assert(
      fc.property(fc.array(stepArb, { maxLength: 30 }), noArb, fc.option(priceArb, { nil: null }), (steps, no, price) => {
        const before = play(steps.map(eventOf), KEEP)
        const product = getProduct(before.state, 'b1', no)
        fc.pre(product?.tentative !== undefined)
        const waiting = listPending(before.state).find((p) => p.no === no)?.claims ?? []
        const result = applyEvent(before.state, { seq: steps.length + 1, at: T0 + 100_000, ...confirm(no, price === null ? {} : { price }) } as EngineEvent)
        const after = getProduct(result.state, 'b1', no)
        const final = price ?? product?.price
        expect(after?.price).toBe(final)
        expect(after).not.toHaveProperty('tentative')
        expect(listPending(result.state).find((p) => p.no === no)).toBeUndefined()
        const judged = listClaims(result.state).filter((c) => waiting.includes(c.id))
        // 기다리던 찜 가운데 확정된 것은 앞에서부터(도착 순서) 재고만큼이고 단가는 확정 시점 가격
        const winners = judged.filter((c) => c.status === 'CONFIRMED')
        expect(winners.map((c) => c.id)).toEqual(waiting.slice(0, winners.length))
        for (const claim of winners) expect(claim.price).toBe(final)
        expect(winners.length).toBe(Math.min(waiting.length, product?.stock ?? 0))
        expect(checkInvariants(result.state)).toEqual([])
      }),
      { numRuns: 300 },
    )
  })

  it('(d) 거두기는 그 번호의 보류 찜을 하나도 끝내지 않고 효과도 내지 않는다', () => {
    fc.assert(
      fc.property(fc.array(stepArb, { maxLength: 30 }), noArb, (steps, no) => {
        const before = play(steps.map(eventOf), KEEP)
        fc.pre(getProduct(before.state, 'b1', no)?.tentative !== undefined)
        const result = applyEvent(before.state, { seq: steps.length + 1, at: T0 + 100_000, ...withdraw(no) } as EngineEvent)
        expect(result.effects).toEqual([])
        expect(getProduct(result.state, 'b1', no)).toBeNull()
        expect(listClaims(result.state)).toEqual(listClaims(before.state))
        expect(listPending(result.state)).toEqual(listPending(before.state))
        expect(checkInvariants(result.state)).toEqual([])
      }),
      { numRuns: 300 },
    )
  })

  it('(e) 확인 중 등록이 없는 이벤트 열의 상태에는 확인 중 칸이 없고, 확정·거두기는 그런 상태를 바꾸지 않는다', () => {
    fc.assert(
      fc.property(fc.array(stepArb.filter((step) => step.kind !== 'tentative'), { maxLength: 30 }), (steps) => {
        const events = steps.map(eventOf)
        const { state } = play(events, KEEP)
        expect(JSON.stringify(state)).not.toContain('tentative')
        // 확정·거두기를 뺀 열과 결과가 같다 (seq만 다르다 — 판정 결과로 견준다)
        const without = play(events.filter((event) => event.type !== 'product.confirm' && event.type !== 'product.withdraw'), KEEP).state
        const judged = (s: EngineState) => listClaims(s).map(({ product, buyer, status, reason, price }) => ({ product, buyer, status, reason, price }))
        expect(judged(state)).toEqual(judged(without))
        expect(listProducts(state).map(({ key, status, price, winners }) => ({ key, status, price, winners }))).toEqual(listProducts(without).map(({ key, status, price, winners }) => ({ key, status, price, winners })))
      }),
      { numRuns: 200 },
    )
  })
})

describe('방송 선언과 확인 중', () => {
  it('확인 중 표시는 방송마다 따로다 — 다른 방송의 같은 번호에 번지지 않는다', () => {
    const B2 = { id: 'b2', date: '2026-10-18', title: '2부' }
    const { state } = play([tentative(1), { ...register(1), b: 'b2' } as EventInput, chat('A', '1'), chat('A', '1', { b: 'b2' })], KEEP, [B1, B2])
    expect(getProduct(state, 'b1', 1)?.tentative).toBeDefined()
    expect(getProduct(state, 'b2', 1)).toMatchObject({ status: 'SOLD', winners: ['A'] })
    expect(getProduct(state, 'b2', 1)).not.toHaveProperty('tentative')
  })
})
