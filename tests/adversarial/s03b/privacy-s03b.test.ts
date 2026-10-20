// S03b 적대 테스트 (test-domain): 전화번호 평문 제거(D-061)와 문자찜 재전송(D-067).
// - 엔진 sms 이벤트 형식: 규칙 문장(R-1)만 보고 만든 판정과 checkEvent·applyEvent를 대조한다.
// - 서버 흉내(테스트 키)로 바꿔 넣은 무작위 로그에서 상태·효과·ID·조회 결과로 번호가 새는지, 뒤 4자리로 잘못 잇는지 본다.
// - 같은 ref의 사본(내용을 바꾼 것 포함)을 첫 수신 뒤 아무 위치에 끼워도 결과가 같은지 본다(INV-3·INV-12).
import fc from 'fast-check'
import {
  applyEvent,
  buyerOfRef,
  checkEvent,
  getBuyer,
  initEngine,
  isInvalidEvent,
  listBuyers,
  listClaims,
  listEffects,
  listSmsRefs,
  normalizePhone,
  type EngineEvent,
  type EngineState,
  type SettingsOverride,
} from '@livejjim/core'
import { smsPhoneFields } from '@livejjim/core/golden'
import { describe, expect, it } from 'vitest'
import { B1, T0, chat, observe, play, reg, sms, type Ev } from './helpers.ts'

// ── sms 형식 (AC-S03b-01) ────────────────────────────────────────────────

const ABSENT = Symbol('absent')
const POOL: Record<string, readonly unknown[]> = {
  b: ['b1', 'b9', ''],
  ref: ['r1', 'a-b_C9', '7', 'x'.repeat(64), 'x'.repeat(65), '', 's 1', 's:1', '김영희', '010-1234-5678 ', 'r1\n', 5],
  no: [15, 0, 1.5, '15'],
  received: ['20:00', '20:00:59', '24:00', '8:01'],
  memo: [ABSENT, '', '길동', 7],
  buyer: [ABSENT, 'A', '', 3],
  phoneKey: [ABSENT, undefined, 'k'.repeat(16), 'K-_9'.repeat(32), 'k'.repeat(15), 'k'.repeat(129), '', '01012345678', '010-1234-5678', '+821012345678', 'abc=defghijklmnop', 'abc/defghijklmnop', 'abc defghijklmnop', '가나다라마바사아자차카타파하가나', 1234567890123456],
  phoneLast4: [ABSENT, undefined, '0000', '5678', '567', '56789', '５６７８', '12a4', 5678, '5678\n'],
  phone: [ABSENT, undefined, '010-1234-5678', null],
}

/** R-1 문장 그대로의 판정: 입력 오류인 필드 목록 (빈 목록 = 받는다) */
function specProblems(e: Record<string, unknown>): string[] {
  const out: string[] = []
  const str = (v: unknown): v is string => typeof v === 'string'
  if (!(str(e.b) && e.b === 'b1')) out.push('b')
  if (!(str(e.ref) && /^[A-Za-z0-9_-]{1,64}$/.test(e.ref) && !e.ref.includes('\n'))) out.push('ref')
  if (!(typeof e.no === 'number' && Number.isSafeInteger(e.no) && e.no >= 1)) out.push('no')
  if (!(str(e.received) && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(e.received))) out.push('received')
  if (e.memo !== undefined && !str(e.memo)) out.push('memo')
  if (e.buyer !== undefined && !(str(e.buyer) && e.buyer !== '')) out.push('buyer')
  if (e.phoneKey !== undefined && !(str(e.phoneKey) && /^[A-Za-z0-9_-]{16,128}$/.test(e.phoneKey) && !e.phoneKey.includes('\n'))) out.push('phoneKey')
  if (e.phoneLast4 !== undefined && !(str(e.phoneLast4) && /^[0-9]{4}$/.test(e.phoneLast4) && !e.phoneLast4.includes('\n'))) out.push('phoneLast4')
  if ((e.phoneKey === undefined) !== (e.phoneLast4 === undefined)) out.push(e.phoneKey === undefined ? 'phoneKey' : 'phoneLast4')
  if (Object.hasOwn(e, 'phone')) out.push('phone')
  return [...new Set(out)].sort()
}

describe('sms 형식: 규칙 문장대로의 판정 = checkEvent = applyEvent 입력 오류 (AC-S03b-01)', () => {
  it('무작위 필드 조합', () => {
    const state = play([reg(15), chat('A', '안녕')]).state
    const pick = (field: string) => fc.constantFrom(...(POOL[field] as unknown[]))
    fc.assert(
      fc.property(fc.record(Object.fromEntries(Object.keys(POOL).map((f) => [f, pick(f)]))), (raw) => {
        const event: Record<string, unknown> = { type: 'sms', seq: 9, at: T0 }
        for (const [k, v] of Object.entries(raw)) if (v !== ABSENT) event[k] = v
        const want = specProblems(event)
        const got = [...new Set(checkEvent(state, event).map((p) => p.field as string))].sort()
        expect(got, JSON.stringify(event)).toEqual(want)
        let error: unknown = null
        try {
          applyEvent(state, event as unknown as EngineEvent)
        } catch (e) {
          error = e
        }
        expect(isInvalidEvent(error), JSON.stringify(event)).toBe(want.length > 0)
      }),
      { numRuns: 3000, seed: 20261019 },
    )
  })

  it('입력 오류 메시지·문제 목록에 phone·phoneKey 값이 나오지 않는다', () => {
    const state = initEngine({ broadcasts: [B1], settings: {} })
    const KEY = smsPhoneFields('010-5555-7777').phoneKey as string
    for (const event of [
      { type: 'sms', b: 'b1', ref: 'r1', no: 15, received: '20:00', phone: '010-5555-7777' },
      { type: 'sms', b: 'b1', ref: 'r1', no: 15, received: '20:00', phoneKey: KEY },
      { type: 'sms', b: 'b1', ref: '01055557777!', no: 15, received: '20:00', phoneKey: '01055557777', phoneLast4: '7777' },
    ]) {
      let error: unknown
      try {
        applyEvent(state, { seq: 1, at: T0, ...event } as unknown as EngineEvent)
      } catch (e) {
        error = e
      }
      expect(isInvalidEvent(error)).toBe(true)
      const text = JSON.stringify([(error as Error).message, (error as { problems: unknown }).problems, checkEvent(state, { seq: 1, at: T0, ...event })])
      for (const secret of ['010-5555-7777', '01055557777', KEY]) expect(text).not.toContain(secret)
    }
  })
})

// ── 상태·효과·조회에 번호 없음, 키로 잇기 (AC-S03b-02·03) ────────────────

/** 같은 사람의 여러 형식, 뒤 4자리만 같은 다른 사람, 휴대폰 번호 모양이 아닌 것 */
const PEOPLE = [
  ['010-2468-7351', '01024687351', '010 2468 7351', '０１０２４６８７３５１', '(010)2468-7351'],
  ['010-9753-7351', '01097537351'], // 뒤 4자리만 같음
  ['011-864-2093', '0118642093'], // 10자리
  ['+82 10-1357-8642', '7351', '2468-7351'], // 모양 아님 → 전화번호 없음
] as const
const RAW_NUMBERS = PEOPLE.flat()
const NORMALIZED = [...new Set(RAW_NUMBERS.map((r) => normalizePhone(r)).filter((n): n is string => n !== null))]

type Op = { k: number; a: number; b: number; c: number }
const opArb = fc.record({ k: fc.nat(11), a: fc.nat(99), b: fc.nat(99), c: fc.nat(99) })

/** 문자찜 중심의 무작위 이벤트 (서버 흉내로 바꿔 넣는다) */
function makeEvent(op: Op, i: number, known: readonly string[]): { event: Ev; raw: string | null } {
  const who = (n: number): string => (known.length === 0 ? 'A' : (known[n % known.length] as string))
  const no = 1 + (op.a % 3)
  switch (op.k) {
    case 0:
      return { event: reg(no, { stock: 1 + (op.b % 2) }), raw: null }
    case 1:
    case 2:
      return { event: chat(['A', 'B', 'C'][op.b % 3] as string, ['1', '2', '3', '안녕', '1 취소', '2번 예뻐요'][op.c % 6] as string, { id: `m${String(i)}` }), raw: null }
    case 3:
    case 4:
    case 5: {
      const person = PEOPLE[op.b % PEOPLE.length] as readonly string[]
      const raw = person[op.c % person.length] as string
      const f: Record<string, unknown> = { phone: raw }
      if (op.c % 5 === 0) f.memo = ['길동', '박순자 이모'][op.a % 2]
      if (op.c % 7 === 0) f.buyer = who(op.a)
      return { event: sms(`r${String(op.b % 9)}`, no, '20:00', f), raw }
    }
    case 6:
      return { event: { type: 'buyer.merge', from: who(op.a), into: who(op.b), reason: '같은 사람' }, raw: null }
    case 7:
      return { event: { type: 'buyer.unmerge', from: who(op.a), reason: '다른 사람' }, raw: null }
    case 8:
      return { event: { type: op.c % 2 === 0 ? 'host.cancel' : 'host.reject', b: 'b1', no, buyer: who(op.b), reason: '사유' }, raw: null }
    case 9:
      return { event: { type: 'host.blockBuyer', buyer: who(op.b), reason: '사유' }, raw: null }
    case 10:
      return { event: { type: 'product.renumber', b: 'b1', from: no, to: 1 + (op.b % 4) }, raw: null }
    default:
      return { event: { type: 'host.convertMessage', b: 'b1', msg: `m${String(op.b % (i + 1))}`, no }, raw: null }
  }
}

describe('서버 흉내 로그: 상태·효과·ID·조회에 번호 없음, 키로만 잇는다 (AC-S03b-02·03)', () => {
  it('매 이벤트 뒤', () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 5, maxLength: 60 }), (ops) => {
        let state = initEngine({ broadcasts: [B1], settings: {} })
        /** 처음 그 번호(정규화)로 구매자를 만든 문자찜의 구매자 */
        const owner = new Map<string, string>()
        const seen = new Set<string>()
        ops.forEach((op, i) => {
          const { event, raw } = makeEvent(op, i, listBuyers(state).map((b) => b.id))
          state = applyEvent(state, { seq: i + 1, at: T0 + i * 1000, ...event } as unknown as EngineEvent).state
          const json = JSON.stringify(state)
          for (const n of NORMALIZED) expect(json, `이벤트 ${String(i + 1)}`).not.toContain(n)
          for (const r of RAW_NUMBERS) if (r.length >= 8) expect(json).not.toContain(r)
          const keys = NORMALIZED.map((n) => smsPhoneFields(n).phoneKey as string)
          const published = JSON.stringify([listEffects(state), listClaims(state).map((c) => [c.id, c.buyer, c.currentBuyer]), listBuyers(state).map((b) => b.id)])
          for (const secret of [...keys, ...NORMALIZED, '박순자', '길동']) expect(published).not.toContain(secret)
          const views = JSON.stringify([listBuyers(state), listClaims(state), listSmsRefs(state)])
          for (const secret of [...keys, ...NORMALIZED]) expect(views).not.toContain(secret)
          // 키로 잇기 (R-11 2): 지정 구매자 없이 처음 받은 ref면 같은 번호의 첫 문자 구매자, 처음 보는 번호면 새 구매자(뒤 4자리 = 그 번호의 것)
          if (event.type === 'sms' && !seen.has(event.ref as string)) {
            const ref = event.ref as string
            seen.add(ref)
            const n = raw === null ? null : normalizePhone(raw)
            if (event.buyer === undefined && n !== null) {
              const got = buyerOfRef(state, ref)
              const first = owner.get(n)
              if (first === undefined) {
                expect(got, `이벤트 ${String(i + 1)}`).toBe(`sms:${ref}`)
                owner.set(n, got as string)
                expect(getBuyer(state, got as string)?.phoneLast4).toBe(n.slice(-4))
              } else expect(got, `이벤트 ${String(i + 1)}`).toBe(first)
            }
          }
        })
        // 서로 다른 번호는 서로 다른 구매자
        expect(new Set(owner.values()).size).toBe(owner.size)
      }),
      { numRuns: 300, seed: 61 },
    )
  }, 60_000)

  it('필드 이름 변형(Phone·PHONE·phoneNumber·tel·중첩)은 엔진이 쓰지 않고 상태에 남지 않는다', () => {
    let state = initEngine({ broadcasts: [B1], settings: {} })
    const variants = [{ Phone: '010-2468-7351' }, { PHONE: '01024687351' }, { phoneNumber: '01024687351' }, { tel: '01024687351' }, { contact: { phone: '01024687351' } }, { meta: ['010-2468-7351'] }]
    variants.forEach((v, i) => {
      const event = { type: 'sms', b: 'b1', ref: `v${String(i)}`, no: 15, received: '20:00', ...v }
      try {
        state = applyEvent(state, { seq: i + 1, at: T0 + i, ...event } as unknown as EngineEvent).state
      } catch (e) {
        expect(isInvalidEvent(e)).toBe(true)
      }
    })
    const json = JSON.stringify(state)
    expect(json).not.toContain('01024687351')
    expect(json).not.toContain('2468-7351')
    // 번호를 엔진이 모르므로 서로 이어지지 않는다
    expect(new Set(listSmsRefs(state).map((r) => r.buyer)).size).toBe(listSmsRefs(state).length)
  })
})

// ── 재전송 사본 (AC-S03b-10, INV-3·INV-12, D-067) ────────────────────────

describe('같은 ref의 사본은 언제 와도 아무것도 바꾸지 않는다 (AC-S03b-10·92)', () => {
  /** seq·at을 고정해 돌린다 (사본을 끼워도 나머지 이벤트의 seq·at이 그대로) */
  function run(events: readonly (Ev & { seq: number; at: number })[], settings: SettingsOverride): EngineState {
    let state = initEngine({ broadcasts: [B1], settings })
    for (const e of events) state = applyEvent(state, e as unknown as EngineEvent).state
    return state
  }

  it('모르는 지정 구매자 → 알려짐 → 사본(내용 그대로·번호·키·메모·지정 구매자를 바꿈), 합치기·차단·떼어 내기 앞뒤', () => {
    const base: Ev[] = [
      reg(15),
      reg(16),
      sms('s1', 15, '20:00:02', { buyer: 'A', memo: '첫' }), // A를 모름 → ref만 기록
      chat('A', '안녕'),
      sms('s2', 16, '20:00:04', { phone: '010-2468-7351' }),
      chat('B', '15'),
      { type: 'buyer.merge', from: 'A', into: 'sms:s2', reason: '같은 사람' },
      { type: 'host.blockBuyer', buyer: 'A', reason: '사유' },
      { type: 'buyer.unmerge', from: 'A', reason: '다른 사람' },
      chat('C', '16'),
    ]
    const copies: Ev[] = [
      sms('s1', 15, '20:00:02', { buyer: 'A', memo: '첫' }),
      sms('s1', 16, '20:00:09', { phone: '010-2468-7351', memo: '바꿈' }),
      sms('s1', 15, '19:00', {}),
      sms('s2', 15, '20:00:01', { buyer: 'B' }),
      sms('s2', 16, '20:00:04', { phone: '010-9753-7351' }),
    ]
    for (const settings of [{}, { 'contention.policy': 'RECEIVED_TIME' }, { 'cancel.succession': 'ASK', 'waitlist.max': 0 }] as SettingsOverride[]) {
      const timed = base.map((e, i) => ({ ...e, seq: (i + 1) * 10, at: T0 + (i + 1) * 10_000 }))
      const want = JSON.stringify(observe(run(timed, settings)))
      for (const copy of copies) {
        const firstAt = base.findIndex((e) => e.type === 'sms' && e.ref === copy.ref)
        for (let j = firstAt + 1; j <= base.length; j++) {
          const withCopy = [...timed.slice(0, j), { ...copy, seq: j * 10 + 5, at: T0 + j * 10_000 + 5_000 }, ...timed.slice(j)]
          expect(JSON.stringify(observe(run(withCopy, settings))), `${JSON.stringify(settings)} ${JSON.stringify(copy)} @${String(j)}`).toBe(want)
        }
      }
      const final = run(timed, settings)
      expect(buyerOfRef(final, 's1')).toBeNull()
      expect(listSmsRefs(final).map((r) => r.ref)).not.toContain('s1')
    }
  })

  it('무작위 로그에 아무 문자찜의 사본(내용을 바꾼 것)을 첫 수신 뒤 아무 위치에 끼워도 결과가 같다', () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 5, maxLength: 40 }), fc.nat(1000), fc.nat(1000), fc.nat(99), (ops, pickSms, pickAt, mut) => {
        // 원래 로그 (알려진 구매자는 원래 로그 기준으로 정한다)
        let state = initEngine({ broadcasts: [B1], settings: {} })
        const events: (Ev & { seq: number; at: number })[] = []
        ops.forEach((op, i) => {
          const { event } = makeEvent(op, i, listBuyers(state).map((b) => b.id))
          const timed = { ...event, seq: (i + 1) * 10, at: T0 + (i + 1) * 10_000 }
          state = applyEvent(state, timed as unknown as EngineEvent).state
          events.push(timed)
        })
        const smsAt = events.map((e, i) => (e.type === 'sms' ? i : -1)).filter((i) => i >= 0)
        if (smsAt.length === 0) return
        const first = smsAt[pickSms % smsAt.length] as number
        const original = events[first] as Ev
        if (events.findIndex((e) => e.type === 'sms' && e.ref === original.ref) !== first) return
        const j = first + 1 + (pickAt % (events.length - first))
        const mutated: Ev = { ...sms(original.ref as string, 1 + (mut % 3), '20:00', mut % 2 === 0 ? { phone: RAW_NUMBERS[mut % RAW_NUMBERS.length] } : { buyer: ['A', 'B', 'C', 'Z'][mut % 4] }), b: 'b1' }
        const copy = mut % 3 === 0 ? original : mutated
        const withCopy = [...events.slice(0, j), { ...copy, seq: j * 10 + 5, at: T0 + j * 10_000 + 5_000 }, ...events.slice(j)]
        expect(JSON.stringify(observe(run(withCopy, {})))).toBe(JSON.stringify(observe(run(events, {}))))
      }),
      { numRuns: 400, seed: 67 },
    )
  })
})
