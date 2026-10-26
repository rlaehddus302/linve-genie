// MOB2 휴대폰 화면 남은 문제 — 화면 낱말·판단 함수·되돌리기 목록 (AC-MOB2-10~16·21·22·31·44·45, D-MOB2-04·05·06·07).
// 실제 코어로 이벤트를 적용한 범위 자료(engine.ts)로 조치 전·뒤를 견준다 — 판정은 엔진이 하고 화면은 읽기만 한다.
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../src/api/client.ts'
import type { DepositLinkView } from '../src/api/deposit-types.ts'
import type { WriteResult } from '../src/api/types.ts'
import { depositLinkWords, depositLabel, reasonWords, storedMemoWords } from '../src/lib/deposit-words.ts'
import {
  PENDING_TIMED_OUT_WORD,
  alertCounts,
  claimWord,
  isPendingTimedOut,
  nextPendingFlip,
  pendingWindowPassed,
  splitPending,
} from '../src/lib/derive.ts'
import { AUTO_RESEND_NOTE, RESENDING_WORD, RESENT_PREFIX, ResendBoard } from '../src/lib/resend-board.ts'
import type { ScopeData } from '../src/lib/scope-data.ts'
import { KEEP_OUTCOME_MS, UndoQueue, type Timer } from '../src/lib/undo-queue.ts'
import { captureVacated, vacatedLabel, vacatedLine } from '../src/lib/vacated.ts'
import { vacatedOutcome, type VacatedUnitView } from '../src/lib/words.ts'
import { T0, chat, dataOf, register, sms } from './engine.ts'
import { flush } from './support.ts'

// ── D-MOB2-05 개발 용어 ─────────────────────────────────────────────────

describe('입금 이름은 "입금 번호 n" (AC-MOB2-21, D-MOB2-05)', () => {
  it('depositLabel·같은 입금 문장·정산 기록 연결 세 모양', () => {
    expect(depositLabel(12)).toBe('입금 번호 12')
    expect(reasonWords('POSSIBLE_DUPLICATE', 7)).toBe('같은 입금이 두 번 들어왔을 수 있어요 (입금 번호 7도 같은 입금이에요)') // D-QL3R1-10 (3): 조사가 숫자에 따라 틀리지 않는 합친 문장
    const link = (patch: Partial<DepositLinkView> = {}): DepositLinkView => ({
      seq: 9,
      kind: 'payment',
      auto: true,
      reverted: false,
      deposit: { no: 12, name: '김영희', at: '2026-10-18T12:03:00.000Z', precision: 'minute', amount: 14000, source: '국민 1234', sourceKind: 'POPBILL' },
      ...patch,
    })
    expect(depositLinkWords(link())).toBe('자동 입금 확인 · 김영희 · 10/18 21:03 · 입금 번호 12')
    expect(depositLinkWords(link({ auto: false }))).toBe('입금 내역으로 확인 · 김영희 · 10/18 21:03 · 입금 번호 12')
    expect(depositLinkWords(link({ reverted: true }))).toBe('자동 입금 확인 · 김영희 · 10/18 21:03 · 입금 번호 12 · 되돌림')
    expect(depositLinkWords(link({ kind: 'refund' }))).toBe('입금 확인 되돌림 · 입금 번호 12')
  })

  it('저장된 메모·사유는 보일 때만, 정확히 "입금 #{숫자}"가 낱말 경계로 있을 때만 바꿔 읽는다 (AC-MOB2-22)', () => {
    const table: readonly [string, string][] = [
      ['자동 입금 확인 · 입금 #12', '자동 입금 확인 · 입금 번호 12'],
      ['입금 확인 되돌림 · 입금 #12', '입금 확인 되돌림 · 입금 번호 12'],
      ['입금 #3', '입금 번호 3'],
      ['입금 #3, 입금 #4', '입금 번호 3, 입금 번호 4'],
      ['(입금 #7)', '(입금 번호 7)'],
      // 판매자가 손으로 쓴 글 — 그대로
      ['#12 국민', '#12 국민'],
      ['입금#12', '입금#12'],
      ['입금 #12번', '입금 #12번'],
      ['입금 #12a', '입금 #12a'],
      ['재입금 #12', '재입금 #12'],
      ['입금 #', '입금 #'],
      ['입금  #12', '입금  #12'],
      ['', ''],
    ]
    for (const [stored, shown] of table) expect(storedMemoWords(stored), stored).toBe(shown)
  })
})

// ── D-MOB2-06 시간이 지난 보류 찜 ───────────────────────────────────────

/** 31번 보류 찜(t0 = T0 + 1초), 32번 보류 찜(t0 + 20초) — engine.ts는 이벤트마다 1초씩 뒤 */
function pendingData(window = 30): { data: ScopeData; t0: number; t32: number } {
  const events: Record<string, unknown>[] = [register(1, '자리', 1000), sms('r1', 31)]
  // 이벤트 19개를 더 넣어 32번 찜이 t0 + 20초에 들어오게
  for (let i = 0; i < 19; i++) events.push(chat(`m${String(i)}`, `UC_x${String(i)}`, `시청자${String(i)}`, '안녕하세요'))
  events.push(sms('r2', 32))
  const data = dataOf(events, { 'claim.preOpenWindowSec': window })
  return { data, t0: T0 + 1000, t32: T0 + 21000 }
}

describe('시간이 지난 보류 찜 (AC-MOB2-30·31·32, D-MOB2-06)', () => {
  it('판단 함수: 지금 − at > W×1000 (밀리초, 경계 정각은 아직 유효 — R-5 2)', () => {
    expect(pendingWindowPassed(0, 30_000, 30)).toBe(false)
    expect(pendingWindowPassed(0, 30_001, 30)).toBe(true)
    expect(pendingWindowPassed(0, 0, 0)).toBe(false)
    expect(pendingWindowPassed(0, 1, 0)).toBe(true)
    expect(pendingWindowPassed(5, 5, 45)).toBe(false)
    expect(pendingWindowPassed(1000, 601_000, 600)).toBe(false)
    expect(pendingWindowPassed(1000, 601_001, 600)).toBe(true)
  })

  it('알림 수는 지금 시각을 받아 시간이 지나지 않은 보류 찜만 센다 — 경계 정각·1ms 넘김', () => {
    const { data, t0, t32 } = pendingData()
    expect(alertCounts(data).pending).toBe(2)
    expect(alertCounts(data, t0 + 30_000).pending).toBe(2)
    expect(alertCounts(data, t0 + 30_001).pending).toBe(1)
    expect(alertCounts(data, t0 + 31_000).pending).toBe(1)
    expect(alertCounts(data, t32 + 30_000).pending).toBe(1)
    expect(alertCounts(data, t32 + 30_001).pending).toBe(0)
  })

  it('찜 낱말: "보류" → "보류 · 시간 지남" (지금 시각을 준 화면만), "만료"는 쓰지 않는다', () => {
    const { data, t0 } = pendingData()
    const claim = [...data.claims.values()].find((item) => item.no === 31)
    if (claim === undefined) throw new Error('31번 찜')
    expect(claimWord(data, claim)).toBe('보류')
    expect(claimWord(data, claim, t0 + 30_000)).toBe('보류')
    expect(claimWord(data, claim, t0 + 31_000)).toBe(PENDING_TIMED_OUT_WORD)
    expect(PENDING_TIMED_OUT_WORD).toBe('보류 · 시간 지남')
    expect(claimWord(data, claim, t0 + 31_000)).not.toContain('만료')
  })

  it('공개 전(READY) 상품의 보류 찜도 같은 규칙, 판매 중 상품의 찜은 아님', () => {
    const events = [{ type: 'product.register', b: 'b1', no: 31, name: '공개전', price: 1000, status: 'READY' }, sms('r1', 31)]
    const data = dataOf(events)
    const claim = [...data.claims.values()].find((item) => item.no === 31)
    if (claim === undefined) throw new Error('31번 찜')
    expect(claim.status).toBe('PENDING')
    const at = Date.parse(claim.at)
    expect(isPendingTimedOut(data, claim, at + 30_000)).toBe(false)
    expect(isPendingTimedOut(data, claim, at + 30_001)).toBe(true)
    expect(claimWord(data, claim, at + 30_001)).toBe('보류 · 시간 지남')
    const open = dataOf([register(31, '판매', 1000), chat('m1', 'UC_a', '홍길동', '31')])
    const won = [...open.claims.values()][0]
    if (won === undefined) throw new Error('찜')
    expect(isPendingTimedOut(open, won, Date.parse(won.at) + 999_999)).toBe(false)
  })

  it('보류 찜 창의 두 목록과 다음에 바뀌는 때', () => {
    const { data, t0, t32 } = pendingData()
    const at31 = splitPending(data, t0 + 31_000)
    expect(at31.live.map((group) => group.no)).toEqual([32])
    expect(at31.timedOut.map((group) => [group.no, group.claims.length])).toEqual([[31, 1]])
    const at51 = splitPending(data, t32 + 31_000)
    expect(at51.live).toEqual([])
    expect(at51.timedOut.map((group) => group.no)).toEqual([31, 32])
    expect(nextPendingFlip(data, t0)).toBe(t0 + 30_001)
    expect(nextPendingFlip(data, t0 + 30_001)).toBe(t32 + 30_001)
    expect(nextPendingFlip(data, t32 + 30_001)).toBeNull()
  })

  it('방송 설정의 유효 시간을 쓴다 (W = 0·45)', () => {
    const zero = pendingData(0)
    expect(alertCounts(zero.data, zero.t0).pending).toBe(2)
    expect(alertCounts(zero.data, zero.t0 + 1).pending).toBe(1)
    const long = pendingData(45)
    expect(alertCounts(long.data, long.t0 + 45_000).pending).toBe(2)
    expect(alertCounts(long.data, long.t0 + 45_001).pending).toBe(1)
  })
})

// ── D-MOB2-04 1등 자리를 비운 조치의 결과 한 줄 ─────────────────────────

const cancel = (no: number, buyer: string, extra: Record<string, unknown> = {}) => ({ type: 'host.cancel', b: 'b1', no, buyer, reason: '시청자 요청', ...extra })

/** 조치 전 자료 → 1등 찜을 잡고, 조치를 적용한 자료로 결과 문장 */
function outcomeAfter(events: Record<string, unknown>[], action: Record<string, unknown>, winnerBuyer: string, settings: Record<string, unknown> = {}): string | null {
  const before = dataOf(events, settings)
  const claim = [...before.claims.values()].find((item) => item.currentBuyer === winnerBuyer && item.status === 'CONFIRMED')
  if (claim === undefined) throw new Error('1등 찜')
  const captured = captureVacated(before, action, [claim.id])
  if (captured === null) return null
  return vacatedLine(captured, dataOf([...events, action], settings))?.text ?? null
}

const base = (stock = 1) => [
  register(15, '핑크프릴', 10000),
  ...(stock === 1 ? [] : [{ type: 'product.update', b: 'b1', no: 15, stock }]),
  chat('m1', 'UC_hack', '<b>해커</b>', '15'),
  chat('m2', 'UC_kim', '김철수', '15'),
  chat('m3', 'UC_park', '박영희', '15'),
]

describe('1등 자리를 비운 조치의 결과 문장 (AC-MOB2-10~15, D-MOB2-04)', () => {
  it('ⓐ 새 1등 (AUTO) — 취소·무효·취소 승인 모두', () => {
    expect(outcomeAfter(base(), cancel(15, 'UC_hack'), 'UC_hack')).toBe('15번 새 1등: 김철수')
    expect(outcomeAfter(base(), { type: 'host.reject', b: 'b1', no: 15, buyer: 'UC_hack', reason: '장난 찜' }, 'UC_hack')).toBe('15번 새 1등: 김철수')
    const asked = [...base(), chat('m4', 'UC_hack', '<b>해커</b>', '15 취소')]
    expect(outcomeAfter(asked, { type: 'host.approveCancel', b: 'b1', no: 15, buyer: 'UC_hack' }, 'UC_hack')).toBe('15번 새 1등: 김철수')
  })

  it('ⓓ 대기 없음 — 상태 낱말은 그 상품의 지금 상태(판매 중·일시 중지)', () => {
    const lone = [register(15, '핑크프릴', 10000), chat('m1', 'UC_hack', '<b>해커</b>', '15')]
    expect(outcomeAfter(lone, cancel(15, 'UC_hack'), 'UC_hack')).toBe('15번 1등 자리가 비었어요 · 대기 없음 · 판매 중')
    const held = [...lone, { type: 'product.hold', b: 'b1', no: 15 }]
    expect(outcomeAfter(held, cancel(15, 'UC_hack'), 'UC_hack')).toBe('15번 1등 자리가 비었어요 · 대기 없음 · 일시 중지')
  })

  it('ⓑ 승계 결정 필요 (ASK) · ⓒ 대기를 비움 (REOPEN)', () => {
    expect(outcomeAfter(base(), cancel(15, 'UC_hack'), 'UC_hack', { 'cancel.succession': 'ASK' })).toBe('15번 1등 자리가 비었어요 · 대기 2명 — 누구를 1등으로 할지 골라 주세요')
    expect(outcomeAfter(base(), cancel(15, 'UC_hack'), 'UC_hack', { 'cancel.succession': 'REOPEN' })).toBe('15번 1등 자리가 비었어요 · 대기를 비웠어요 · 판매 중')
  })

  it('재고 2: 비운 자리 기준 — 대기가 있으면 새 1등, 없으면 대기 없음(다른 1등은 그대로)', () => {
    expect(outcomeAfter(base(2), cancel(15, 'UC_hack'), 'UC_hack')).toBe('15번 새 1등: 박영희')
    const two = [register(15, '핑크프릴', 10000), { type: 'product.update', b: 'b1', no: 15, stock: 2 }, chat('m1', 'UC_hack', '<b>해커</b>', '15'), chat('m2', 'UC_kim', '김철수', '15')]
    expect(outcomeAfter(two, cancel(15, 'UC_hack'), 'UC_hack')).toBe('15번 1등 자리가 비었어요 · 대기 없음 · 판매 중')
  })

  it('이름은 글자 그대로(이스케이프는 React) — 10글자 넘어도 자르지 않는다', () => {
    const events = [register(15, '핑크프릴', 10000), chat('m1', 'UC_kim', '김철수', '15'), chat('m2', 'UC_hack', '<b>해커</b>', '15')]
    expect(outcomeAfter(events, cancel(15, 'UC_kim'), 'UC_kim')).toBe('15번 새 1등: <b>해커</b>')
    const long = [register(15, '핑크프릴', 10000), chat('m1', 'UC_kim', '김철수', '15'), chat('m2', 'UC_long', '다육이사랑하는엄마예요오오', '15')]
    expect(outcomeAfter(long, cancel(15, 'UC_kim'), 'UC_kim')).toBe('15번 새 1등: 다육이사랑하는엄마예요오오')
  })

  it('옵션 상품: 번호 뒤에 그 찜의 변형 글 ("15번 빨강 새 1등: …")', () => {
    const color = { name: '색상', choices: [{ label: '빨강' }, { label: '파랑' }] }
    const options = { 'claim.parseMode': 'OPTIONS', 'contention.policy': 'ARRIVAL' }
    const events = [
      { type: 'product.register', b: 'b1', no: 15, name: '화분', price: 5000, options: [color], stocks: { 빨강: 1, 파랑: 1 } },
      chat('m1', 'UC_hack', '<b>해커</b>', '화분 빨강'),
      chat('m2', 'UC_kim', '김철수', '화분 빨강'),
    ]
    expect(outcomeAfter(events, cancel(15, 'UC_hack', { options: { 색상: '빨강' } }), 'UC_hack', options)).toBe('15번 빨강 새 1등: 김철수')
    expect(vacatedLabel({ no: 15, variant: '빨강' })).toBe('15번 빨강')
    expect(vacatedLabel({ no: 15, variant: null })).toBe('15번')
  })

  it('문장 함수: 새 1등 둘, 대기 n, 상태 낱말 다섯, 충돌이 풀려 1등이 된 찜', () => {
    const unit = (winners: string[], waitlist: string[] = [], ask = false): VacatedUnitView => ({ winnerClaims: winners, waitlistClaims: waitlist, awaitingSuccession: ask })
    const names: Record<string, string> = { c1: '<b>해커</b>', c2: '김철수', c3: '박영희', c9: '충돌손님' }
    const nameOfClaim = (id: string) => names[id] ?? '알 수 없는 구매자'
    const make = (before: VacatedUnitView, after: VacatedUnitView, afterStatus: 'READY' | 'OPEN' | 'SOLD' | 'HOLD' | 'CLOSED' = 'OPEN', waitlistCleared = false) =>
      vacatedOutcome({ label: '15번', before, after, afterStatus, waitlistCleared, nameOfClaim })
    expect(make(unit(['c1', 'c4']), unit(['c4', 'c2', 'c3'])).text).toBe('15번 새 1등: 김철수, 박영희')
    expect(make(unit(['c1']), unit([], ['c2', 'c3', 'c5'], true)).text).toBe('15번 1등 자리가 비었어요 · 대기 3명 — 누구를 1등으로 할지 골라 주세요')
    expect(make(unit(['c1'], ['c2']), unit([]), 'OPEN', true).text).toBe('15번 1등 자리가 비었어요 · 대기를 비웠어요 · 판매 중')
    const words = { READY: '공개 전', OPEN: '판매 중', SOLD: '판매 완료', HOLD: '일시 중지', CLOSED: '판매 종료' } as const
    for (const [status, word] of Object.entries(words) as [keyof typeof words, string][]) {
      expect(make(unit(['c1']), unit([]), status).text).toBe(`15번 1등 자리가 비었어요 · 대기 없음 · ${word}`)
    }
    // R-7 7: 충돌 찜이 풀려 1등이 되면 새 1등
    expect(make(unit(['c1']), unit(['c9'])).kind).toBe('winner')
    expect(make(unit(['c1']), unit(['c9'])).text).toBe('15번 새 1등: 충돌손님')
  })

  it('결과 줄이 없는 경우: 대기·보류 찜 조치, 찜 여럿, 다른 조치', () => {
    const before = dataOf(base())
    const waiting = [...before.claims.values()].find((item) => item.status === 'WAITLISTED')
    const winner = [...before.claims.values()].find((item) => item.status === 'CONFIRMED')
    if (waiting === undefined || winner === undefined) throw new Error('찜')
    expect(captureVacated(before, cancel(15, waiting.currentBuyer), [waiting.id])).toBeNull()
    expect(captureVacated(before, cancel(15, winner.currentBuyer), [winner.id, waiting.id])).toBeNull()
    expect(captureVacated(before, { type: 'host.promote', b: 'b1', no: 15, buyer: waiting.currentBuyer, reason: 'x' }, [winner.id])).toBeNull()
    expect(captureVacated(null, cancel(15, winner.currentBuyer), [winner.id])).toBeNull()
    const pending = dataOf([sms('r1', 31)])
    const held = [...pending.claims.values()][0]
    if (held === undefined) throw new Error('보류 찜')
    expect(captureVacated(pending, cancel(31, held.currentBuyer), [held.id])).toBeNull()
    // 아직 1등이면(따라잡지 못함) 줄 없음
    const captured = captureVacated(before, cancel(15, winner.currentBuyer), [winner.id])
    if (captured === null) throw new Error('잡음')
    expect(vacatedLine(captured, before)).toBeNull()
  })
})

// ── 되돌리기 목록: 결과 한 줄·연결이 돌아오면 다시 보내기 ─────────────────

class ManualTimer implements Timer {
  now = 0
  #next = 1
  readonly #tasks = new Map<number, { at: number; fn: () => void }>()
  set(fn: () => void, ms: number): unknown {
    const id = this.#next++
    this.#tasks.set(id, { at: this.now + ms, fn })
    return id
  }
  clear(handle: unknown): void {
    this.#tasks.delete(handle as number)
  }
  advance(ms: number): void {
    const end = this.now + ms
    for (;;) {
      const due = [...this.#tasks.entries()].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
      if (due === undefined) break
      this.#tasks.delete(due[0])
      this.now = due[1].at
      due[1].fn()
    }
    this.now = end
  }
}

const written = (changed = true, seq = 1): WriteResult => ({ date: '2026-10-19', rehearsal: false, seq, type: 'host.cancel', changed, effects: [] })
const networkError = () => new ApiError({ status: 0, code: 'NETWORK', message: '인터넷 연결을 확인해 주세요.', network: true })

function setup() {
  const timer = new ManualTimer()
  let n = 0
  const queue = new UndoQueue({ timer, now: () => timer.now, delayMs: 5000, requestId: () => `req-${String(++n)}`, retry: { sleep: async () => {}, delays: [] } })
  return { timer, queue }
}

describe('1등 자리를 비운 조치의 결과 한 줄 (AC-MOB2-10·16, D-MOB2-04)', () => {
  it('따라잡는 동안은 "보내는 중", 그 뒤 결과 줄 10초 — "보냈어요"는 비치지 않는다, "확인"이면 바로 닫힘', async () => {
    const { timer, queue } = setup()
    let release: (() => void) | undefined
    const outcome = vi.fn(
      () =>
        new Promise<{ text: string; tone: 'success' }>((resolve) => {
          release = () => resolve({ text: '15번 새 1등: 김철수', tone: 'success' })
        }),
    )
    queue.add({ label: '15번 해커 취소', send: async () => written(), outcome })
    timer.advance(5000)
    await flush()
    expect(queue.getSnapshot()[0]?.kind === 'action' && queue.getSnapshot()[0]?.status).toBe('sending')
    release?.()
    await flush()
    const item = queue.getSnapshot()[0]
    expect(item?.kind === 'action' ? [item.status, item.outcome?.text] : null).toEqual(['outcome', '15번 새 1등: 김철수'])
    expect(KEEP_OUTCOME_MS).toBe(10000)
    timer.advance(9999)
    expect(queue.getSnapshot()).toHaveLength(1)
    timer.advance(1)
    expect(queue.getSnapshot()).toHaveLength(0)

    queue.add({ label: '16번 취소', send: async () => written(), outcome: async () => ({ text: '16번 새 1등: 박영희', tone: 'success' }) })
    timer.advance(5000)
    await flush()
    const shown = queue.getSnapshot()[0]
    if (shown === undefined) throw new Error('항목')
    queue.dismiss(shown.id)
    expect(queue.getSnapshot()).toHaveLength(0)
  })

  it('결과가 null이거나 적용되지 않았으면 지금 그대로 ("보냈어요" 4초 / 적용되지 않았어요)', async () => {
    const { timer, queue } = setup()
    queue.add({ label: '15번 대기 취소', send: async () => written(), outcome: async () => null })
    queue.add({ label: '16번 취소', send: async () => written(false), outcome: async () => ({ text: '안 보여야 함', tone: 'success' }) })
    timer.advance(5000)
    await flush()
    expect(queue.getSnapshot().map((item) => (item.kind === 'action' ? item.status : ''))).toEqual(['done', 'notApplied'])
  })
})

describe('연결이 돌아오면 다시 보내기 (AC-MOB2-41·44·45, D-MOB2-07)', () => {
  it('retryable 실패만 누른 차례대로 같은 요청 번호로 한 번 — 500·입력 거절·닫은 것·되돌린 것은 보내지 않는다', async () => {
    const { timer, queue } = setup()
    const sent: string[] = []
    const failing = new Set(['a', 'b', 'c', 'd'])
    const errors: Record<string, ApiError> = {
      a: networkError(),
      b: new ApiError({ status: 500, code: 'INTERNAL_ERROR', message: '서버 문제' }),
      c: new ApiError({ status: 503, code: 'SAVE_FAILED', message: '저장 실패' }),
      d: new ApiError({ status: 400, code: 'INVALID', message: '사유', problems: [{ field: 'reason', message: '사유를 적어 주세요.' }] }),
    }
    const make = (name: string) => async (requestId: string) => {
      sent.push(`${name}:${requestId}`)
      if (failing.has(name)) throw errors[name]
      return written()
    }
    for (const name of ['a', 'b', 'c', 'd', 'e']) queue.add({ label: name, send: make(name) })
    const undone = queue.getSnapshot().at(-1)
    if (undone === undefined) throw new Error('항목')
    queue.undo(undone.id)
    timer.advance(5000)
    await flush(10)
    expect(sent).toEqual(['a:req-1', 'b:req-2', 'c:req-3', 'd:req-4'])
    // a·c는 연결이 돌아오면 저절로, 줄에는 안내
    failing.clear()
    // c를 판매자가 "확인"으로 닫았으면 보내지 않는다
    const c = queue.getSnapshot().find((item) => item.kind === 'action' && item.label === 'c')
    if (c === undefined) throw new Error('c')
    queue.dismiss(c.id)
    sent.length = 0
    const count = await queue.resendRetryable()
    expect(count).toBe(1)
    expect(sent).toEqual(['a:req-1'])
    const a = queue.getSnapshot().find((item) => item.kind === 'action' && item.label === 'a')
    expect(a?.kind === 'action' ? [a.status, a.auto] : null).toEqual(['done', true])
    // 500·입력 거절은 그대로 실패
    expect(queue.getSnapshot().filter((item) => item.kind === 'action' && item.status === 'failed').map((item) => (item.kind === 'action' ? item.label : ''))).toEqual(['b', 'd'])
  })

  it('또 실패하면 실패 줄로 남고 다음 회복 때 한 번 더 — 짧게 두 번 와도 겹쳐 보내지 않는다', async () => {
    const { timer, queue } = setup()
    let fail = true
    let calls = 0
    let release: (() => void) | undefined
    queue.add({
      label: '15번 취소',
      send: async () => {
        calls++
        if (fail) throw networkError()
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return written()
      },
    })
    timer.advance(5000)
    await flush()
    expect(calls).toBe(1)
    await queue.resendRetryable()
    expect(calls).toBe(2)
    const again = queue.getSnapshot()[0]
    expect(again?.kind === 'action' ? [again.status, again.error?.retryable] : null).toEqual(['failed', true])
    fail = false
    const first = queue.resendRetryable()
    const second = queue.resendRetryable()
    await flush()
    expect(calls).toBe(3)
    release?.()
    await first
    await second
    expect(calls).toBe(3)
    expect(queue.getSnapshot()[0]?.kind === 'action' && queue.getSnapshot()[0]?.status).toBe('done')
  })

  it('문장 상수', () => {
    expect(AUTO_RESEND_NOTE).toBe("연결이 돌아오면 저절로 다시 보내요. 바로 보내려면 '다시 보내기'를 눌러도 돼요.") // MOB2 D-MOB2-16 (2)
    expect(RESENT_PREFIX).toBe('연결이 돌아와 보냈어요: ')
    expect(RESENDING_WORD).toBe('다시 보내는 중…')
  })

  it('ResendBoard: 등록 → 상품 관리 명령 → 방송자 조치 → 문자찜, 종류마다 올린 차례, 하나씩, 겹치지 않음, 내린 것은 보내지 않음', async () => {
    const board = new ResendBoard()
    const log: string[] = []
    const step = (name: string) => async () => {
      log.push(`${name} 시작`)
      await Promise.resolve()
      log.push(`${name} 끝`)
    }
    board.add('sms', 'sms', step('문자찜'))
    board.add('c1', 'command', step('일시 중지'))
    board.add('r15', 'register', step('15 등록'))
    board.add('r16', 'register', step('16 등록'))
    board.add('r17', 'register', step('17 등록'))
    board.remove('r17')
    const off = board.addHost(step('방송자 조치'))
    const first = board.flush()
    const second = board.flush()
    await first
    await second
    // 보내는 중에 온 두 번째 회복은 겹쳐 보내지 않고, 첫 차례가 끝난 뒤 남은 것으로 한 번 더 돈다(TD-MOB2-001).
    // 올린 항목은 이미 보내 내려갔으므로 다시 가지 않고, 방송자 조치 목록만 한 번 더 묻는다(그 목록은 다시 실패한 것만 보낸다)
    expect(log).toEqual([
      '15 등록 시작', '15 등록 끝', '16 등록 시작', '16 등록 끝', '일시 중지 시작', '일시 중지 끝', '방송자 조치 시작', '방송자 조치 끝', '문자찜 시작', '문자찜 끝',
      '방송자 조치 시작', '방송자 조치 끝',
    ])
    expect(board.size).toBe(0)
    // 한 번 보냈으면 내려간다 — 다음 회복 때는 다시 올라온 것만
    log.length = 0
    off()
    await board.flush()
    expect(log).toEqual([])
  })

  it('ResendBoard: 보내는 중 다시 실패해 올라온 항목은 그 회복에 또 보내지 않는다', async () => {
    const board = new ResendBoard()
    let calls = 0
    const run = async () => {
      calls++
      board.add('r15', 'register', run)
    }
    board.add('r15', 'register', run)
    await board.flush()
    expect(calls).toBe(1)
    expect(board.has('r15')).toBe(true)
    await board.flush()
    expect(calls).toBe(2)
  })

  it('ResendBoard: 보내는 중에 또 끊겼다 이어지면, 그 사이 다시 실패한 항목을 그 차례가 끝난 뒤 한 번 더 — 동시에 하나 (TD-MOB2-001, AC-MOB2-45)', async () => {
    const board = new ResendBoard()
    let online = false
    let inFlight = 0
    const log: string[] = []
    let release: (() => void) | undefined
    const r15 = async () => {
      inFlight++
      expect(inFlight).toBe(1)
      log.push(online ? '15 성공' : '15 실패')
      inFlight--
      if (!online) board.add('r15', 'register', r15)
    }
    board.add('r15', 'register', r15)
    board.add('sms', 'sms', async () => {
      inFlight++
      expect(inFlight).toBe(1)
      log.push('문자찜')
      await new Promise<void>((resolve) => {
        release = resolve
      })
      inFlight--
    })
    const first = board.flush() // 회복 #1 — 곧바로 또 끊겨 15 실패
    await flush()
    expect(log).toEqual(['15 실패', '문자찜'])
    online = true
    const second = board.flush() // 회복 #2 — 문자찜 응답을 기다리는 중
    await second
    expect(log).toEqual(['15 실패', '문자찜']) // 겹쳐 보내지 않는다
    release?.()
    await first
    expect(log).toEqual(['15 실패', '문자찜', '15 성공'])
    expect(board.has('r15')).toBe(false)
    expect(board.running).toBe(false)
    // 회복이 겹치지 않았으면 다시 실패한 항목은 다음 회복까지 기다린다(위 시험 그대로)
  })

  it('ResendBoard: 보내는 중에 회복이 여러 번 와도 한 번만 더 돈다', async () => {
    const board = new ResendBoard()
    let passes = 0
    let release: (() => void) | undefined
    board.addHost(async () => {
      passes++
      if (passes === 1)
        await new Promise<void>((resolve) => {
          release = resolve
        })
    })
    const first = board.flush()
    await flush()
    void board.flush()
    void board.flush()
    void board.flush()
    release?.()
    await first
    expect(passes).toBe(2)
  })
})
