// 실제 시각순·역전·충돌·메시지 변환 (AC-S03-20~26).
import {
  applyEvent,
  compareRank,
  getProduct,
  isSameMinuteTie,
  listCancelRequests,
  listClaims,
  listEffects,
  listPending,
  rankKey,
  type EngineEvent,
  type EngineState,
  type RankMaterial,
  type SaleSettings,
} from '@livejjim/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { RECEIVED_TIME, T0, chat, kst, play, register, sms, type EventInput } from './engine-helpers.ts'

const MIN = 60_000
const status = (state: ReturnType<typeof play>['state'], buyer: string, no = 15) => listClaims(state).findLast((c) => c.currentBuyer === buyer && c.no === no)
const product = (state: ReturnType<typeof play>['state'], no = 15) => getProduct(state, 'b1', no)
const hostEvent = (type: string, no: number, buyer: string, extra: Record<string, unknown> = {}): EventInput => ({ type, b: 'b1', no, buyer, reason: '사유', ...extra }) as EventInput
const resolve = (decision: 'KEEP' | 'SWITCH', no = 15): EventInput => ({ type: 'host.resolveConflict', b: 'b1', no, decision })
const convert = (msg: string, no: number): EventInput => ({ type: 'host.convertMessage', b: 'b1', msg, no })

describe('AC-S03-20 정렬 키와 동률', () => {
  const ties = ['YOUTUBE', 'SMS', 'HOST'] as const
  const settingsOf = (tie: SaleSettings['contention.sameMinuteTieBreaker']) => ({ 'contention.policy': 'RECEIVED_TIME', 'contention.sameMinuteTieBreaker': tie }) as const
  const exact = (time: number, seq: number): RankMaterial => ({ time, minute: false, seq })
  const minute = (start: number, seq: number): RankMaterial => ({ time: start, minute: true, seq })

  it('키: 정확한 시각 (t, 1), 분 단위 SMS (m, 0), YOUTUBE·HOST (m+1분, 0)', () => {
    expect(rankKey(exact(1000, 3), 'HOST')).toEqual([1000, 1, 3])
    expect(rankKey(minute(MIN, 4), 'SMS')).toEqual([MIN, 0, 4])
    expect(rankKey(minute(MIN, 4), 'YOUTUBE')).toEqual([2 * MIN, 0, 4])
    expect(rankKey(minute(MIN, 4), 'HOST')).toEqual([2 * MIN, 0, 4])
  })

  it('분 단위 규칙의 세 경우와 같은 답: 구간 끝 이후면 문자, 구간 시작 전이면 정확한 시각, 구간 안이면 동률 설정대로', () => {
    const m = minute(10 * MIN, 9)
    for (const tie of ties) {
      const s = settingsOf(tie)
      expect(compareRank(m, exact(11 * MIN, 1), s), `${tie} 구간 끝 정각`).toBeLessThan(0)
      expect(compareRank(m, exact(11 * MIN + 1, 1), s)).toBeLessThan(0)
      expect(compareRank(m, exact(10 * MIN - 1, 99), s), `${tie} 구간 시작 1ms 전`).toBeGreaterThan(0)
      for (const t of [10 * MIN, 10 * MIN + 30_000, 11 * MIN - 1]) {
        expect(isSameMinuteTie(m, exact(t, 1))).toBe(true)
        expect(Math.sign(compareRank(m, exact(t, 1), s)), `${tie} 구간 안 ${String(t)}`).toBe(tie === 'SMS' ? -1 : 1)
      }
    }
    expect(isSameMinuteTie(m, exact(11 * MIN, 1))).toBe(false)
    expect(isSameMinuteTie(m, exact(10 * MIN - 1, 1))).toBe(false)
    expect(isSameMinuteTie(m, minute(10 * MIN, 1))).toBe(false)
    expect(isSameMinuteTie(exact(10 * MIN, 2), exact(10 * MIN, 1))).toBe(false)
  })

  it('분 단위끼리 같은 분이면 seq, 정확한 시각끼리 같으면 seq. 접수순이면 seq만 본다', () => {
    const s = settingsOf('HOST')
    expect(compareRank(minute(MIN, 2), minute(MIN, 1), s)).toBeGreaterThan(0)
    expect(compareRank(exact(5, 1), exact(5, 2), s)).toBeLessThan(0)
    expect(compareRank(exact(0, 9), exact(99 * MIN, 1), { 'contention.policy': 'ARRIVAL', 'contention.sameMinuteTieBreaker': 'HOST' })).toBeGreaterThan(0)
  })

  it('속성: 무작위 찜 집합에서 키 비교는 전순서 (반사·반대칭·추이·완전), 동률 처리 셋 모두', () => {
    const material = fc.record({ time: fc.integer({ min: 0, max: 5 }).map((n) => n * 20_000), minute: fc.boolean(), seq: fc.integer({ min: 1, max: 6 }) })
    fc.assert(
      fc.property(fc.constantFrom(...ties), fc.array(material, { minLength: 3, maxLength: 12 }), (tie, items) => {
        const s = settingsOf(tie)
        const cmp = (a: RankMaterial, b: RankMaterial): number => Math.sign(compareRank(a, b, s))
        for (const a of items) {
          expect(cmp(a, a)).toBe(0)
          for (const b of items) {
            expect(cmp(a, b) + cmp(b, a)).toBe(0)
            for (const c of items) if (cmp(a, b) <= 0 && cmp(b, c) <= 0) expect(cmp(a, c)).toBeLessThanOrEqual(0)
          }
        }
        // 정렬 결과가 입력 순서와 상관없다
        const sorted = [...items].sort((a, b) => compareRank(a, b, s) || a.seq - b.seq).map((x) => rankKey(x, tie).join(','))
        const reversed = [...items].reverse().sort((a, b) => compareRank(a, b, s) || a.seq - b.seq).map((x) => rankKey(x, tie).join(','))
        expect(reversed).toEqual(sorted)
      }),
      { numRuns: 300 },
    )
  })
})

describe('AC-S03-21 대기에 넣는 자리', () => {
  it('접수순의 새 찜은 맨 끝 (S02 동작 그대로), 대기 한도를 넘으면 그 찜 자신이 품절', () => {
    const { state } = play([register(15), chat('A', '15'), chat('B', '15'), chat('C', '15'), chat('D', '15')], { 'waitlist.max': 2 })
    expect(product(state)?.waitlist).toEqual(['B', 'C'])
    expect(status(state, 'D')).toMatchObject({ status: 'REJECTED', reason: 'SOLD_OUT' })
  })

  it('실제 시각순: 자기보다 앞서는 대기자 중 가장 뒤 바로 뒤, 같은 밀리초면 seq 순', () => {
    const { state } = play(
      [
        register(15, { at: kst(20) }),
        chat('A', '15', { at: kst(20, 0, 1) }),
        chat('B', '15', { at: kst(20, 0, 30) }),
        chat('C', '15', { at: kst(20, 0, 40) }),
        chat('D', '15', { at: kst(20, 0, 50), publishedAt: kst(20, 0, 30) }),
        sms('s1', 15, '20:00:35', { at: kst(20, 1) }),
      ],
      RECEIVED_TIME,
    )
    expect(product(state)?.waitlist).toEqual(['B', 'D', 'sms:s1', 'C'])
  })

  it('대기 한도 0: 넣은 찜 자신이 늘 품절 (역전으로 밀려난 1등도)', () => {
    const { state } = play([register(15, { at: kst(20) }), chat('A', '15', { at: kst(20, 0, 10) }), sms('s1', 15, '20:00:05', { at: kst(20, 0, 20) })], { ...RECEIVED_TIME, 'waitlist.max': 0 })
    expect(product(state)).toMatchObject({ winners: ['sms:s1'], waitlist: [] })
    expect(status(state, 'A')).toMatchObject({ status: 'REJECTED', reason: 'SOLD_OUT' })
  })
})

describe('AC-S03-22·23 역전과 잠금', () => {
  const base = (extra: EventInput[], settings: Record<string, unknown> = {}) =>
    play([register(15, { at: kst(20) }), chat('A', '15', { at: kst(20, 0, 10) }), ...extra], { ...RECEIVED_TIME, ...settings })

  it('잠금 전이면 자동 역전: 미실행 효과는 취소되고(출력 전이라 폐기 없음) 1등은 대기 1순위', () => {
    const { state, emitted } = base([chat('B', '15', { at: kst(20, 0, 20) }), sms('s1', 15, '20:00:05', { at: kst(20, 0, 30) })])
    expect(product(state)).toMatchObject({ winners: ['sms:s1'], waitlist: ['A', 'B'], confirmVersion: 2 })
    expect(emitted.at(-1)?.map((e) => e.id)).toEqual(['c3:PRINT_PRODUCT_LABEL:-:2', 'c3:POST_THANKS:LIVE_CHAT:2'])
    expect(listEffects(state).filter((e) => e.claim === 'c1').map((e) => e.status)).toEqual(['CANCELLED', 'CANCELLED'])
  })

  it('입금 기록(묶음 받은 금액 > 0)이면 잠금 후 → 충돌. 환불로 0이 되면 풀려 다음 선순위 찜은 역전', () => {
    const pay = { type: 'settlement.payment', buyer: 'A', date: '2026-10-18', amount: 1000 } as EventInput
    const refund = { type: 'settlement.refund', buyer: 'A', date: '2026-10-18', amount: 1000, reason: '반환' } as EventInput
    const locked = base([pay, sms('s1', 15, '20:00:05', { at: kst(20, 0, 30) })])
    expect(product(locked.state)).toMatchObject({ winners: ['A'], conflict: true })
    expect(listClaims(locked.state)[0]?.locked).toBe(true)
    const unlocked = base([pay, refund, sms('s1', 15, '20:00:05', { at: kst(20, 0, 30) })])
    expect(product(unlocked.state)).toMatchObject({ winners: ['sms:s1'], waitlist: ['A'], conflict: false })
  })

  it('다른 날짜 묶음의 입금은 그 찜을 잠그지 않는다', () => {
    const { state } = base([{ type: 'settlement.payment', buyer: 'A', date: '2026-10-19', amount: 1000 } as EventInput, sms('s1', 15, '20:00:05', { at: kst(20, 0, 30) })])
    expect(product(state)).toMatchObject({ winners: ['sms:s1'], conflict: false })
  })

  it('직접 배정으로 새로 만든 찜은 R-7에서 늘 잠금 후, 시청자 자동 취소에서는 잠금 전 (S02 동작)', () => {
    const conflicted = play(
      [register(15, { at: kst(20) }), chat('A', '안녕', { at: kst(20, 0, 1) }), { type: 'host.assign', b: 'b1', no: 15, buyer: 'A', reason: '배정', at: kst(20, 0, 20) }, sms('s1', 15, '20:00:05', { at: kst(20, 0, 30) })],
      RECEIVED_TIME,
    )
    expect(product(conflicted.state)).toMatchObject({ winners: ['A'], conflict: true })
    const cancelled = play([register(15), chat('A', '안녕'), { type: 'host.assign', b: 'b1', no: 15, buyer: 'A', reason: '배정' }, chat('A', '15 취소')], { 'cancel.buyerChat': 'AUTO' })
    expect(status(cancelled.state, 'A')?.status).toBe('CANCELLED')
  })

  it('배정으로 대기에서 빠져 확정된 찜은 "새로 만든" 배정 찜이 아니다 — 원래 순위로 비교하고 잠금 전이면 역전된다', () => {
    const { state } = play(
      [
        register(15, { at: kst(20) }),
        chat('A', '15', { at: kst(20, 0, 10) }),
        chat('B', '15', { at: kst(20, 0, 20) }),
        { type: 'host.assign', b: 'b1', no: 15, buyer: 'B', reason: '교체', replace: 'A', replaceTo: 'CANCEL', at: kst(20, 0, 30) },
        sms('s1', 15, '20:00:15', { at: kst(20, 0, 40) }),
      ],
      RECEIVED_TIME,
    )
    expect(product(state)).toMatchObject({ winners: ['sms:s1'], waitlist: ['B'], conflict: false })
  })

  it('입금 기록이 있는 확정 찜의 시청자 채팅 취소(AUTO)는 요청이 된다', () => {
    const { state } = play([register(15), chat('A', '15'), { type: 'settlement.payment', buyer: 'A', date: '2026-10-18', amount: 5000 } as EventInput, chat('A', '15 취소')], { 'cancel.buyerChat': 'AUTO' })
    expect(product(state)?.winners).toEqual(['A'])
    expect(listCancelRequests(state).map((r) => r.buyer)).toEqual(['A'])
  })

  it('밀려난 1등이 차단 중이면 대기에 넣지 않고 차단 거절, 넘침 정리도 없다', () => {
    const { state } = base([chat('B', '15', { at: kst(20, 0, 11) }), { type: 'host.blockBuyer', buyer: 'A', reason: '장난' } as EventInput, sms('s1', 15, '20:00:05', { at: kst(20, 0, 30) })], { 'waitlist.max': 1 })
    expect(product(state)).toMatchObject({ winners: ['sms:s1'], waitlist: ['B'] })
    expect(status(state, 'A')).toMatchObject({ status: 'REJECTED', reason: 'BLOCKED' })
  })
})

describe('AC-S03-24 충돌', () => {
  const locked = (extra: EventInput[], settings: Record<string, unknown> = {}) =>
    play(
      [register(15, { at: kst(20) }), chat('A', '15', { at: kst(20, 0, 10) }), { type: 'host.confirm', b: 'b1', no: 15, buyer: 'A', at: kst(20, 0, 11) } as EventInput, sms('s1', 15, '20:00:05', { at: kst(20, 0, 20) }), ...extra],
      { ...RECEIVED_TIME, ...settings },
    )

  it('충돌 찜은 효과를 내지 않고 활성 찜이다: 같은 구매자의 새 찜 없음, 충돌 중에 온 더 앞선 찜은 대기 자리', () => {
    const { state, emitted } = locked([sms('s2', 15, '20:00:06', { at: kst(20, 0, 30), buyer: 'sms:s1' }), sms('s3', 15, '20:00:01', { at: kst(20, 0, 31) })])
    expect(emitted[3]).toEqual([])
    expect(listClaims(state).map((c) => [c.buyer, c.status])).toEqual([
      ['A', 'CONFIRMED'],
      ['sms:s1', 'CONFLICT'],
      ['sms:s3', 'WAITLISTED'],
    ])
    expect(product(state)).toMatchObject({ conflict: true, conflictClaim: 'c2', conflictBuyer: 'sms:s1', waitlist: ['sms:s3'] })
  })

  it.each([
    ['방송자 취소', hostEvent('host.cancel', 15, 'sms:s1'), 'CANCELLED', null],
    ['방송자 무효', hostEvent('host.reject', 15, 'sms:s1'), 'REJECTED', 'BY_HOST'],
    ['차단', { type: 'host.blockBuyer', buyer: 'sms:s1', reason: '장난' } as EventInput, 'REJECTED', 'BLOCKED'],
    ['번호 변경', { type: 'product.renumber', b: 'b1', from: 15, to: 51 } as EventInput, 'REJECTED', 'RENUMBERED'],
  ] as const)('%s로 끝나면 충돌 표시가 사라지고 1등은 그대로 (번호 변경은 1등도 끝난다)', (_name, event, wantStatus, reason) => {
    const { state } = locked([event])
    const c = listClaims(state).find((x) => x.buyer === 'sms:s1')
    expect([c?.status, c?.reason]).toEqual([wantStatus, reason])
    const now = getProduct(state, 'b1', event.type === 'product.renumber' ? 51 : 15)
    expect(now?.conflict).toBe(false)
    if (event.type !== 'product.renumber') expect(now?.winners).toEqual(['A'])
  })

  // S03에서는 합친 문자 구매자(sms:s1)의 충돌 찜을 채널 C의 채팅으로 취소했다. D-063(시청자 채팅 취소는 그 채널 자신의 찜에만)으로 교체 (AC-S03b-21·93)
  it('시청자 취소: 그 채널 자신의 충돌 찜(C를 지정한 문자찜)엔 잠금이 없어 AUTO면 바로 취소, REQUEST면 요청을 거쳐 승인으로 취소', () => {
    const own = (settings: Record<string, unknown>, extra: EventInput[]) =>
      play(
        [
          register(15, { at: kst(20) }),
          chat('A', '15', { at: kst(20, 0, 10) }),
          { type: 'host.confirm', b: 'b1', no: 15, buyer: 'A', at: kst(20, 0, 11) } as EventInput,
          chat('C', '안녕', { at: kst(20, 0, 12) }),
          sms('s1', 15, '20:00:05', { at: kst(20, 0, 20), buyer: 'C' }),
          chat('C', '15 취소', { at: kst(20, 0, 40) }),
          ...extra,
        ],
        { ...RECEIVED_TIME, ...settings },
      )
    expect(product(own({}, []).state)?.conflictBuyer).toBe('C')
    const auto = own({ 'cancel.buyerChat': 'AUTO' }, [])
    expect(status(auto.state, 'C')?.status).toBe('CANCELLED')
    expect(product(auto.state)).toMatchObject({ winners: ['A'], conflict: false })
    const request = own({}, [])
    expect(listCancelRequests(request.state).map((r) => [r.buyer, r.currentBuyer])).toEqual([['C', 'C']])
    const approved = own({}, [{ type: 'host.approveCancel', b: 'b1', no: 15, buyer: 'C' } as EventInput])
    expect(status(approved.state, 'C')?.status).toBe('CANCELLED')
    expect(product(approved.state)?.conflict).toBe(false)
  })

  it('시청자 취소: 채널에 합친 문자 구매자의 충돌 찜은 AUTO·REQUEST 모두 무시한다 — 방송자 조치는 지금의 구매자로 찾는다 (D-063)', () => {
    const merged = (settings: Record<string, unknown>, extra: EventInput[]) =>
      locked([chat('C', '안녕', { at: kst(20, 0, 30) }), { type: 'buyer.merge', from: 'C', into: 'sms:s1', reason: '같은 사람' } as EventInput, chat('C', '15 취소', { at: kst(20, 0, 40) }), ...extra], settings)
    for (const settings of [{ 'cancel.buyerChat': 'AUTO' }, {}]) {
      const { states, emitted } = merged(settings, [])
      const [before, after] = [states[6], states[7]] as [EngineState, EngineState]
      // 채팅은 받은 메시지로 기록될 뿐, 찜·요청·상품은 그대로이고 효과도 없다
      expect(listClaims(after)).toEqual(listClaims(before))
      expect(listCancelRequests(after)).toEqual([])
      expect(product(after)).toEqual(product(before))
      expect(emitted[6]).toEqual([])
    }
    const byHost = merged({}, [hostEvent('host.cancel', 15, 'C')])
    expect(status(byHost.state, 'sms:s1')?.status).toBe('CANCELLED')
    expect(product(byHost.state)?.conflict).toBe(false)
  })

  it.each([
    ['방송자 취소', hostEvent('host.cancel', 15, 'A')],
    ['방송자 무효', hostEvent('host.reject', 15, 'A')],
  ])('1등이 %s되면 충돌이 먼저 풀려 순위대로 대기에 들어간 뒤 자동 승계', (_name, event) => {
    const { state } = locked([chat('B', '15', { at: kst(20, 0, 21), publishedAt: kst(20, 0, 2) }), event])
    // B(02)는 충돌 중이라 대기 [B]. 1등이 빠지면 s1(05)이 B(02) 뒤로 → [B, s1] → B 확정
    expect(product(state)).toMatchObject({ winners: ['B'], waitlist: ['sms:s1'], conflict: false })
  })

  it('충돌 중 1등의 시청자 자동 취소(잠금 후라 요청) → 승인하면 충돌이 먼저 풀린다. ASK면 승계 결정 필요, REOPEN이면 대기 정리', () => {
    const ask = locked([chat('A', '15 취소', { at: kst(20, 0, 30) }), { type: 'host.approveCancel', b: 'b1', no: 15, buyer: 'A' } as EventInput], { 'cancel.buyerChat': 'AUTO', 'cancel.succession': 'ASK' })
    expect(product(ask.state)).toMatchObject({ winners: [], waitlist: ['sms:s1'], awaitingSuccession: true, conflict: false })
    const reopen = locked([hostEvent('host.cancel', 15, 'A')], { 'cancel.succession': 'REOPEN' })
    expect(product(reopen.state)).toMatchObject({ winners: [], waitlist: [], conflict: false })
    expect(status(reopen.state, 'sms:s1')).toMatchObject({ status: 'REJECTED', reason: 'WAITLIST_CLEARED' })
  })

  it('KEEP: 순위대로 대기 자리, 넘치면 맨 끝 품절. SWITCH: 재고 2면 순위가 가장 뒤인 1등이 대기 1순위', () => {
    const keep = locked([chat('B', '15', { at: kst(20, 0, 21) }), resolve('KEEP')], { 'waitlist.max': 1 })
    expect(product(keep.state)).toMatchObject({ winners: ['A'], waitlist: ['sms:s1'] })
    expect(status(keep.state, 'B')).toMatchObject({ status: 'REJECTED', reason: 'SOLD_OUT' })
    const two = play(
      [
        register(15, { stock: 2, at: kst(20) }),
        chat('A', '15', { at: kst(20, 0, 10) }),
        chat('B', '15', { at: kst(20, 0, 20) }),
        { type: 'host.confirm', b: 'b1', no: 15, buyer: 'B', at: kst(20, 0, 21) } as EventInput,
        sms('s1', 15, '20:00:15', { at: kst(20, 0, 30) }),
        resolve('SWITCH'),
      ],
      RECEIVED_TIME,
    )
    expect(product(two.state)).toMatchObject({ winners: ['A', 'sms:s1'], waitlist: ['B'], conflict: false, confirmVersion: 3 })
  })

  it('SWITCH로 밀려날 1등이 차단 중이면 차단 거절, 출력된 라벨은 폐기', () => {
    const { state } = play(
      [
        register(15, { at: kst(20) }),
        chat('A', '15', { at: kst(20, 0, 10) }),
        { type: 'effect.labelPrinted', effectId: 'c1:PRINT_PRODUCT_LABEL:-:1', at: kst(20, 0, 11) } as EventInput,
        sms('s1', 15, '20:00:05', { at: kst(20, 0, 20) }),
        { type: 'host.blockBuyer', buyer: 'A', reason: '장난' } as EventInput,
        resolve('SWITCH'),
      ],
      RECEIVED_TIME,
    )
    expect(product(state)).toMatchObject({ winners: ['sms:s1'], waitlist: [] })
    expect(status(state, 'A')).toMatchObject({ status: 'REJECTED', reason: 'BLOCKED' })
    expect(listEffects(state).filter((e) => e.kind === 'VOID_LABEL').map((e) => [e.buyer, e.confirmVersion])).toEqual([['A', 1]])
  })

  it('충돌이 없는 상품·없는 상품의 결정은 아무 일도 없다 (같은 상태 객체)', () => {
    const { state } = play([register(15), chat('A', '15')], RECEIVED_TIME)
    for (const event of [resolve('KEEP'), resolve('SWITCH'), resolve('KEEP', 99)]) {
      const result = applyEvent(state, { seq: 9, at: T0 + 9000, ...event } as EngineEvent)
      expect(result.state).toBe(state)
    }
  })

  it('HOST 동률이 1등 자리를 다투면 잠금과 상관없이 충돌 (늦게 온 쪽이 정확한 시각이어도)', () => {
    const { state } = play([register(15, { at: kst(20) }), sms('s1', 15, '20:00', { at: kst(20, 0, 50) }), chat('A', '15', { at: kst(20, 1), publishedAt: kst(20, 0, 20) })], RECEIVED_TIME)
    expect(product(state)).toMatchObject({ winners: ['sms:s1'], conflict: true, conflictBuyer: 'A' })
  })

  it('YOUTUBE·SMS 동률은 키대로 자동 판정 (충돌 없음)', () => {
    for (const [tie, winner] of [
      ['YOUTUBE', 'A'],
      ['SMS', 'sms:s1'],
    ] as const) {
      const { state } = play([register(15, { at: kst(20) }), sms('s1', 15, '20:00', { at: kst(20, 0, 50) }), chat('A', '15', { at: kst(20, 1), publishedAt: kst(20, 0, 20) })], {
        ...RECEIVED_TIME,
        'contention.sameMinuteTieBreaker': tie,
      })
      expect(product(state)).toMatchObject({ winners: [winner], conflict: false })
    }
  })
})

describe('AC-S03-25 공개 순간 보류 찜', () => {
  it('정렬 키 순서로 하나씩 판정: 게시 시각이 빠른 늦은 도착이 1등, 재고 2면 순서대로 둘, 유효 시간은 at', () => {
    const { state } = play(
      [
        register(15, { status: 'READY', stock: 2, at: kst(20) }),
        chat('A', '15', { at: kst(20, 0, 10) }),
        chat('B', '15', { at: kst(20, 0, 20), publishedAt: kst(20, 0, 1) }),
        sms('s1', 15, '19:59:00', { at: kst(20, 0, 25) }),
        chat('C', '15', { at: kst(20, 0, 26), publishedAt: kst(20, 0, 5) }),
        { type: 'product.open', b: 'b1', no: 15, at: kst(20, 0, 50) } as EventInput,
      ],
      RECEIVED_TIME,
    )
    // 순서: s1(19:59:00) → B(00:01) → C(00:05) → A(00:10). A의 at 20:00:10 < 20:00:20 → 만료
    expect(product(state)).toMatchObject({ winners: ['sms:s1', 'B'], waitlist: ['C'] })
    expect(status(state, 'A')).toMatchObject({ status: 'REJECTED', reason: 'EXPIRED' })
  })

  it('보류 목록은 판정 순위 순으로 보인다 (접수순이면 seq — 변환 찜은 원래 메시지 순위)', () => {
    const { state } = play([chat('A', '15번이용', { id: 'm1' }), chat('B', '15'), convert('m1', 15)])
    expect(listPending(state).map((p) => p.buyers)).toEqual([['A', 'B']])
  })
})

describe('AC-S03-26 메시지 변환', () => {
  const setup: EventInput[] = [
    register(15),
    chat('A', '15번이용ㅎ', { id: 'm1' }),
    chat('O', '15', { id: 'm2', owner: true }),
    chat('B', '15', { id: 'm3' }),
  ]

  it('모르는 메시지·무시한 방송자 메시지·이미 그 번호의 찜을 만든 메시지·다른 방송의 같은 메시지 ID는 아무 일도 없다', () => {
    const { state } = play(setup, {}, [
      { id: 'b1', date: '2026-10-18', title: '1부' },
      { id: 'b2', date: '2026-10-18', title: '2부' },
    ])
    for (const event of [convert('m9', 15), convert('m2', 15), convert('m3', 15), { type: 'host.convertMessage', b: 'b2', msg: 'm1', no: 15 } as EventInput]) {
      const result = applyEvent(state, { seq: 20, at: T0 + 20_000, ...event } as EngineEvent)
      expect(result.state, JSON.stringify(event)).toBe(state)
    }
  })

  it('방송자 메시지 무시를 끄면 방송자 메시지도 변환할 수 있다', () => {
    const { state } = play([register(16), chat('O', '안녕', { id: 'm1', owner: true }), convert('m1', 16)], { 'claim.ignoreOwner': false })
    expect(getProduct(state, 'b1', 16)?.winners).toEqual(['O'])
  })

  it('접수순이어도 원래 순위로: 앞서면 잠금과 상관없이 충돌, 두 번 누르면 아무 일도 없음, 이름은 그 채널 닉네임', () => {
    const { state } = play([...setup, convert('m1', 15), convert('m1', 15), resolve('SWITCH')])
    expect(product(state)).toMatchObject({ winners: ['A'], waitlist: ['B'], conflict: false })
    expect(listClaims(state).map((c) => [c.buyer, c.origin, c.seq])).toEqual([
      ['B', 'chat', 4],
      ['A', 'convert', 2],
    ])
    expect(listEffects(state).find((e) => e.buyer === 'A' && e.kind === 'POST_THANKS')?.text).toBe('15번 핑크프릴 10,000원 A님 구매 감사합니다')
  })

  it('취소된 찜을 만든 메시지는 다시 변환해도 되살아나지 않는다', () => {
    const { state } = play([...setup, chat('C', '15', { id: 'm4' }), hostEvent('host.cancel', 15, 'B'), convert('m3', 15)])
    expect(product(state)).toMatchObject({ winners: ['C'], waitlist: [] })
    expect(listClaims(state)).toHaveLength(2)
  })

  it('빈 자리가 있으면 확정, 메시지에 없는 번호도 되고, 차단된 채널은 차단 거절, 상품이 없으면 원래 at으로 보류', () => {
    const { state } = play([register(16), register(17), chat('A', '십육번', { id: 'm1', at: kst(20, 0, 1) }), chat('X', '안녕', { id: 'm2' }), { type: 'host.blockBuyer', buyer: 'X', reason: 'r' } as EventInput, convert('m1', 16), convert('m2', 17), convert('m1', 30)])
    expect(listClaims(state).map((c) => [c.buyer, c.no, c.status, c.reason, c.at])).toEqual([
      ['A', 16, 'CONFIRMED', null, kst(20, 0, 1)],
      ['X', 17, 'REJECTED', 'BLOCKED', T0 + 3000],
      ['A', 30, 'PENDING', 'UNOPENED', kst(20, 0, 1)],
    ])
  })

  it('뒤 순위면 대기 자리(자기보다 앞서는 대기자 바로 뒤)', () => {
    const { state } = play([register(15), chat('A', '15'), chat('B', '안녕', { id: 'mb' }), chat('C', '15'), convert('mb', 15)])
    expect(product(state)?.waitlist).toEqual(['B', 'C'])
  })
})
