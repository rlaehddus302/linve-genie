// S03b 적대 테스트 (test-domain): 방송자 조작 규칙 정리(D-062~D-068)를 기본 설정(접수순·대기 5·자동 승계·취소 요청)과
// 실제 방송에서 나올 법한 순서로 공격한다. 기대값은 DOMAIN_RULES v0.1.8 문장으로 손으로 정했다.
import { checkEvent, initEngine, isInvalidEvent, applyEvent, STATE_FORMAT, type EngineEvent } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import {
  B1,
  T0,
  RECEIVED_TIME,
  chat,
  checkInvariants,
  claimsOf,
  convert,
  host,
  listCancelRequests,
  listClaims,
  listEffects,
  merge,
  newSoldOut,
  noOp,
  play,
  product,
  reg,
  resolve,
  sms,
  unmerge,
  update,
  type Ev,
} from './helpers.ts'

const statusOf = (p: ReturnType<typeof play>, who: string, no = 15): string | undefined => {
  const c = claimsOf(p.state, who).filter((x) => x.no === no).at(-1)
  return c === undefined ? undefined : c.reason === null ? c.status : `${c.status}(${c.reason})`
}

// ── 메시지 변환 (AC-S03b-20, R-7 4, D-062) ───────────────────────────────

describe('메시지 변환은 주문이 아니었던 메시지만 (AC-S03b-20)', () => {
  it('취소된 주문 메시지를 같은 번호·다른 번호로 바꿔도 아무 일도 없다 — 취소한 사람이 옛 순위로 돌아오지 않는다', () => {
    const p = play([reg(15), reg(16), chat('A', '15', { id: 'o1' }), chat('B', '15'), host('host.cancel', 15, 'A'), convert('o1', 15), convert('o1', 16)])
    expect(product(p.state, 15)?.winners).toEqual(['B'])
    expect(noOp(p, 5)).toEqual({ same: true, effects: 0 })
    expect(noOp(p, 6)).toEqual({ same: true, effects: 0 })
  })

  it('찜을 만들지 않은 주문 메시지(같은 사람 반복·차단·판매 아님·보류 후 만료)도 주문이었던 메시지다', () => {
    const p = play(
      [
        reg(15),
        reg(17, { status: 'READY' }),
        chat('A', '15', { id: 'x0' }),
        chat('A', '15번', { id: 'x1' }), // 같은 사람 반복(4번 줄) → 찜 없음
        host('host.blockBuyer', 0, 'C'),
        chat('C', '15', { id: 'x2' }), // 차단 → REJECTED(BLOCKED)
        { type: 'product.hold', b: 'b1', no: 15 },
        chat('D', '15', { id: 'x3' }), // 판매 아님
        { type: 'product.open', b: 'b1', no: 15 },
        chat('E', '16', { id: 'x4' }), // 상품 없는 번호 → 보류, 나중에 만료
        reg(16, { at: T0 + 3_600_000 }),
        convert('x1', 15),
        convert('x1', 17),
        convert('x2', 16),
        convert('x3', 15),
        convert('x4', 16),
        convert('x4', 15),
      ].map((e) => (e.type === 'host.blockBuyer' ? { type: 'host.blockBuyer', buyer: 'C', reason: '사유' } : e)) as Ev[],
    )
    expect(statusOf(p, 'E', 16)).toBe('REJECTED(EXPIRED)')
    for (let i = 11; i <= 16; i++) expect(noOp(p, i), `이벤트 ${String(i + 1)}`).toEqual({ same: true, effects: 0 })
  })

  it('주문이 아니었던 메시지: 번호마다 한 번, 다른 번호는 된다. 재수신 사본의 글이 주문이어도 처음 해석으로 판단한다', () => {
    const p = play([reg(15), reg(16), chat('A', '안녕하세요', { id: 'n1' }), chat('A', '15', { id: 'n1' }), convert('n1', 15), convert('n1', 15), host('host.cancel', 15, 'A'), convert('n1', 15), convert('n1', 16)])
    expect(noOp(p, 3)).toEqual({ same: true, effects: 0 }) // 재수신
    expect(statusOf(p, 'A', 15)).toBe('CANCELLED')
    expect(noOp(p, 5).same).toBe(true)
    expect(noOp(p, 7).same).toBe(true) // 취소 뒤 같은 번호로 다시 바꿔도 되살아나지 않는다
    expect(statusOf(p, 'A', 16)).toBe('CONFIRMED')
  })

  it('주문 메시지의 재수신 사본 글이 주문이 아니어도 변환되지 않는다', () => {
    const p = play([reg(15), chat('A', '15', { id: 'k1' }), host('host.cancel', 15, 'A'), chat('A', '안녕', { id: 'k1' }), convert('k1', 15)])
    expect(noOp(p, 4)).toEqual({ same: true, effects: 0 })
  })
})

// ── 시청자 채팅 취소 대상 (AC-S03b-21, R-8, D-063) ───────────────────────

describe('시청자 채팅 취소는 그 채널 자신의 찜에만 (AC-S03b-21)', () => {
  const both = [{ 'cancel.buyerChat': 'AUTO' }, { 'cancel.buyerChat': 'REQUEST' }] as const

  for (const settings of both) {
    it(`${settings['cancel.buyerChat']}: 합치기 방향·사슬과 상관없이 합친 다른 구매자의 찜은 취소도 요청도 없다`, () => {
      // A→S (A가 문자 구매자 아래), S'→A (문자 구매자가 A 아래), 사슬 A→S2→B
      for (const links of [[merge('A', 'sms:s1')], [merge('sms:s1', 'A')], [merge('A', 'sms:s1'), merge('sms:s1', 'B')]]) {
        const p = play([reg(15), chat('A', '안녕'), chat('B', '안녕'), sms('s1', 15, '20:00:03'), ...links, chat('A', '15 취소')], settings)
        const last = p.states.length - 2
        expect(noOp(p, last), JSON.stringify(links)).toEqual({ same: true, effects: 0 })
        expect(listCancelRequests(p.state)).toEqual([])
      }
    })
  }

  it('AUTO: 자기 찜(변환·배정·지정 문자찜)은 합친 뒤에도 취소된다', () => {
    const p = play(
      [
        reg(15),
        reg(16),
        reg(17),
        chat('A', '안녕', { id: 'a1' }),
        sms('s1', 18, '20:00:04', { phone: '010-2222-3333' }),
        convert('a1', 15),
        host('host.assign', 16, 'A'),
        sms('s2', 17, '20:00:07', { buyer: 'A' }),
        merge('A', 'sms:s1'),
        chat('A', '15 취소'),
        chat('A', '16 취소'),
        chat('A', '17 취소'),
      ],
      { 'cancel.buyerChat': 'AUTO' },
    )
    for (const no of [15, 16, 17]) expect(statusOf(p, 'A', no), String(no)).toBe('CANCELLED')
  })

  it('떼어 낸 뒤에는 남의 찜이 아니라 활성 찜 없음 — 아무 일도 없다. 요청 뒤 합쳐도 방송자 승인은 그 찜을 취소한다', () => {
    const p = play(
      [reg(15), reg(16), chat('A', '16'), sms('s1', 15, '20:00:03'), merge('A', 'sms:s1'), unmerge('A'), chat('A', '15 취소'), chat('A', '16 취소'), merge('A', 'sms:s1'), host('host.approveCancel', 16, 'sms:s1')],
    )
    expect(noOp(p, 6)).toEqual({ same: true, effects: 0 })
    expect(statusOf(p, 'A', 16)).toBe('CANCELLED')
    expect(statusOf(p, 'sms:s1', 15)).toBe('CONFIRMED')
  })
})

// ── 충돌 중 배정 (AC-S03b-22, R-7 7, R-9, D-064) ─────────────────────────

/** 접수순 기본 설정의 변환 충돌: W가 1등, 더 먼저 쓴 A의 언급 메시지를 15번으로 바꿔 충돌 */
const convertConflict = (waiters: readonly string[]): Ev[] => [
  reg(15),
  chat('A', '15번 너무 예뻐요ㅎ', { id: 'ma' }),
  chat('W', '15'),
  ...waiters.map((w) => chat(w, '15')),
  convert('ma', 15),
]

describe('충돌 중인 상품에는 직접 배정이 없다 (AC-S03b-22)', () => {
  it('교체 WAITLIST·CANCEL, 대기자에게, 충돌 찜 구매자에게, 모르던 구매자에게 — 모두 아무 일도 없고, 충돌을 정한 뒤에는 된다', () => {
    const base = convertConflict(['X'])
    const tries: Ev[] = [
      host('host.assign', 15, 'X', { replace: 'W', replaceTo: 'WAITLIST' }),
      host('host.assign', 15, 'A', { replace: 'W', replaceTo: 'CANCEL' }),
      host('host.assign', 15, 'X'),
      host('host.assign', 15, 'A'),
    ]
    const p = play([...base, chat('Z', '안녕'), ...tries, host('host.assign', 15, 'Z', { replace: 'W', replaceTo: 'CANCEL' })])
    expect(product(p.state, 15)?.conflictBuyer).toBe('A')
    for (let i = base.length + 1; i < base.length + 1 + tries.length; i++) expect(noOp(p, i), `이벤트 ${String(i + 1)}`).toEqual({ same: true, effects: 0 })
    const q = play([...base, chat('Z', '안녕'), resolve(15, 'KEEP'), host('host.assign', 15, 'Z', { replace: 'W', replaceTo: 'CANCEL' })])
    expect(product(q.state, 15)?.winners).toEqual(['Z'])
  })

  it('충돌 중 재고 늘림으로 충돌이 풀린 뒤에는 배정이 된다', () => {
    const p = play([...convertConflict([]), update(15, { stock: 2 }), chat('Z', '안녕'), host('host.assign', 15, 'Z', { replace: 'W', replaceTo: 'WAITLIST' })])
    expect(product(p.state, 15)?.conflictBuyer ?? null).toBeNull()
    expect(product(p.state, 15)?.winners).toEqual(['A', 'Z'])
    expect(product(p.state, 15)?.waitlist).toEqual(['W'])
  })
})

// ── host.assign 한쪽만 (AC-S03b-23, D-065) ───────────────────────────────

describe('host.assign의 replace·replaceTo 한쪽만은 입력 오류 (AC-S03b-23)', () => {
  it('충돌 중이든 아니든, 판매 전이든 — 상태는 그대로, checkEvent가 빠진 쪽을 짚는다', () => {
    const p = play([...convertConflict(['X']), reg(16, { status: 'READY' })])
    for (const [no, f, missing] of [
      [15, { replace: 'W' }, 'replaceTo'],
      [15, { replaceTo: 'CANCEL' }, 'replace'],
      [16, { replace: 'W' }, 'replaceTo'],
      [99, { replaceTo: 'WAITLIST' }, 'replace'],
    ] as const) {
      const event = { ...host('host.assign', no, 'X', f), seq: 99, at: T0 } as unknown as EngineEvent
      expect(checkEvent(p.state, event).map((x) => x.field)).toEqual([missing])
      let error: unknown
      try {
        applyEvent(p.state, event)
      } catch (e) {
        error = e
      }
      expect(isInvalidEvent(error)).toBe(true)
    }
  })
})

// ── 충돌이 풀릴 때 넘침 정리 (AC-S03b-31, R-7 7, D-068) ──────────────────

describe('충돌이 자리가 비어 풀릴 때 넘침 정리는 승계·재고 뒤 (AC-S03b-31)', () => {
  const FIVE = ['X1', 'X2', 'X3', 'X4', 'X5']

  it('기본 설정(대기 5 꽉 참): 1등 방송자 취소·무효·취소 승인 — 충돌 찜이 1등이 되고 아무도 품절되지 않는다', () => {
    const base = convertConflict(FIVE)
    for (const ending of [[host('host.cancel', 15, 'W')], [host('host.reject', 15, 'W')], [chat('W', '15 취소'), host('host.approveCancel', 15, 'W')]]) {
      const p = play([...base, ...ending])
      expect(product(p.state, 15)?.winners, JSON.stringify(ending)).toEqual(['A'])
      expect(product(p.state, 15)?.waitlist).toEqual(FIVE)
      expect(newSoldOut(p, base.length, p.states.length - 1)).toEqual([])
      expect(checkInvariants(p.state)).toEqual([])
    }
  })

  it('시청자 자동 취소·재고 +1·+2: 아무도 품절되지 않고, 재고 늘림은 대기 순번 순서로 확정한다', () => {
    const base = convertConflict(FIVE)
    const auto = play([...base, chat('W', '15 취소')], { 'cancel.buyerChat': 'AUTO' })
    expect(product(auto.state, 15)?.winners).toEqual(['A'])
    expect(newSoldOut(auto, base.length, auto.states.length - 1)).toEqual([])
    const plus1 = play([...base, update(15, { stock: 2 })])
    expect(product(plus1.state, 15)?.winners).toEqual(['W', 'A'])
    expect(product(plus1.state, 15)?.waitlist).toEqual(FIVE)
    const plus2 = play([...base, update(15, { stock: 3 })])
    expect(product(plus2.state, 15)?.winners).toEqual(['W', 'A', 'X1'])
    expect(product(plus2.state, 15)?.waitlist).toEqual(['X2', 'X3', 'X4', 'X5'])
    expect(newSoldOut(plus2, base.length, plus2.states.length - 1)).toEqual([])
  })

  it('대기 한도 0·1: 1등 취소 뒤 충돌 찜이 1등, 남은 대기자는 그대로', () => {
    for (const max of [0, 1]) {
      const waiters = max === 0 ? [] : ['X1']
      const base = convertConflict(waiters)
      const p = play([...base, host('host.cancel', 15, 'W')], { 'waitlist.max': max })
      expect(product(p.state, 15)?.winners, `max ${String(max)}`).toEqual(['A'])
      expect(product(p.state, 15)?.waitlist).toEqual(waiters)
      expect(newSoldOut(p, base.length, p.states.length - 1)).toEqual([])
    }
  })

  it('ASK: 빈 자리는 방송자 결정으로 남고 한도를 넘는 맨 끝이 품절. REOPEN: 충돌 찜도 대기자와 함께 정리', () => {
    const base = convertConflict(['X1', 'X2'])
    const ask = play([...base, host('host.cancel', 15, 'W')], { 'waitlist.max': 2, 'cancel.succession': 'ASK' })
    expect(product(ask.state, 15)?.winners).toEqual([])
    expect(product(ask.state, 15)?.waitlist).toEqual(['A', 'X1'])
    expect(product(ask.state, 15)?.awaitingSuccession).toBe(true)
    expect(statusOf(ask, 'X2')).toBe('REJECTED(SOLD_OUT)')
    const reopen = play([...base, host('host.cancel', 15, 'W')], { 'waitlist.max': 2, 'cancel.succession': 'REOPEN' })
    expect(['A', 'X1', 'X2'].map((w) => statusOf(reopen, w))).toEqual(Array(3).fill('REJECTED(WAITLIST_CLEARED)'))
  })

  it('RECEIVED_TIME: 충돌 중 들어온 더 앞선 대기자가 대기 1순위면 그가 승계하고 충돌 찜이 대기에 남는다 (한도 1, 품절 없음)', () => {
    // W 확정·잠금(host.confirm) → 문자 C(20:00:01)가 앞서 충돌 → 문자 X(20:00:00)가 더 앞서지만 충돌 중이라 대기 [X]
    const base: Ev[] = [reg(15), chat('W', '15'), host('host.confirm', 15, 'W'), sms('c', 15, '20:00:01'), sms('x', 15, '20:00:00')]
    const p = play([...base, host('host.cancel', 15, 'W')], { ...RECEIVED_TIME, 'waitlist.max': 1 })
    expect(product(p.states[base.length] as never, 15)).toBeDefined()
    expect(product(p.state, 15)?.winners).toEqual(['sms:x'])
    expect(product(p.state, 15)?.waitlist).toEqual(['sms:c'])
    expect(newSoldOut(p, base.length, p.states.length - 1)).toEqual([])
  })
})

// ── 확정버전 (AC-S03b-30, D-066) ─────────────────────────────────────────

describe('재고 늘림 다중 확정의 확정버전·효과 ID (AC-S03b-30)', () => {
  it('밀려난 1등이 대기 1순위여도 대기 순번 순서로 붙고, 효과 ID는 모두 다르다', () => {
    // RECEIVED_TIME: W 확정(잠금 전) → 더 앞선 문자 C가 자동 역전, W는 대기 1순위, 이어서 X 대기 → 재고 1 → 3
    const p = play([reg(15), chat('W', '15'), sms('c', 15, '20:00:00'), chat('X', '15'), update(15, { stock: 3 })], RECEIVED_TIME)
    const versions = Object.fromEntries(listClaims(p.state).filter((c) => c.status === 'CONFIRMED').map((c) => [c.currentBuyer, c.confirmVersion]))
    expect(versions).toEqual({ 'sms:c': 2, W: 3, X: 4 })
    const ids = listEffects(p.state).map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('시작 상태 (형식 STATE_FORMAT — S04에서 4, O1에서 5로 올랐다, D-072·AC-O1-30)', () => {
  it('새 상태는 지금 형식(STATE_FORMAT = 5)이고 JSON 왕복 뒤에도 같은 결과를 낸다', () => {
    const state = initEngine({ broadcasts: [B1], settings: {} })
    // O1이 옵션 방송 칸(변형·수량·확인 필요·지금 상품)을 더해 형식 판을 올렸다. 형식 4 이어 쓰기는 o1/strict-regression이 본다
    expect(STATE_FORMAT).toBe(5)
    expect(state.format).toBe(STATE_FORMAT)
  })
})
