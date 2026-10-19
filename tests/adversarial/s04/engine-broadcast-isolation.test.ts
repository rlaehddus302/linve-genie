// S04 적대 테스트 (test-domain): 방송마다 설정 스냅샷 (AC-S04-01·02·04, D-070).
// 같은 범위에 설정이 다른 두 방송을 섞어 쓴 로그와, 방송 하나의 이벤트만 따로 돌린 로그가 그 방송의 판정(상품·찜·보류 찜·효과)을 똑같이 내는지 본다.
// 방송 사이에 번지는 것이 있으면(설정을 엉뚱한 방송에서 읽음, 공유 기록에 방송 구분이 빠짐) 두 결과가 갈린다.
// 구매자 단위 이벤트(차단·합치기·입금)·닉네임 변경·같은 전화번호는 방송 사이에 원래 공유되는 것이라 넣지 않는다(닉네임은 채널마다 고정).
// 중간에 broadcast.end를 끼워도(AC-S04-04) 판정이 같아야 한다.
import fc from 'fast-check'
import {
  applyEvent,
  checkInvariants,
  initEngine,
  listClaims,
  listEffects,
  listPending,
  listProducts,
  type EngineEvent,
  type EngineState,
  type SettingsOverride,
} from '@livejjim/core'
import { smsPhoneFields } from '@livejjim/core/golden'
import { describe, expect, it } from 'vitest'

const T0 = Date.UTC(2026, 9, 18, 11, 0, 0) // 20:00 KST
const DATE = '2026-10-18'
const CH = ['A', 'B', 'C', 'D'] as const
const NO = [1, 2] as const
/** 방송마다 다른 번호 (같은 번호는 방송 사이에 같은 문자 구매자로 이어지는 것이 정상이라 — R-11) */
const PHONES = { b1: ['010-1111-2222', '010-3333-4444'], b2: ['010-5555-6666', '010-7777-8888'] } as const

const settingsArb: fc.Arbitrary<SettingsOverride> = fc.record({
  'claim.parseMode': fc.constantFrom('STRICT', 'LOOSE'),
  'claim.preOpenWindowSec': fc.constantFrom(0, 5, 300),
  'waitlist.max': fc.integer({ min: 0, max: 2 }),
  'cancel.succession': fc.constantFrom('AUTO', 'ASK', 'REOPEN'),
  'cancel.buyerChat': fc.constantFrom('OFF', 'REQUEST', 'AUTO'),
  'contention.policy': fc.constantFrom('ARRIVAL', 'RECEIVED_TIME'),
  'contention.sameMinuteTieBreaker': fc.constantFrom('YOUTUBE', 'SMS', 'HOST'),
  'print.autoOnConfirm': fc.boolean(),
  'thanks.liveChat': fc.boolean(),
  'thanks.videoComment': fc.constantFrom('OFF', 'PER_SALE'),
}) as fc.Arbitrary<SettingsOverride>

type Raw = { k: number; b: 0 | 1; no: number; ch: number; t: number; x: number }
const rawArb: fc.Arbitrary<Raw> = fc.record({
  k: fc.integer({ min: 0, max: 99 }),
  b: fc.constantFrom(0 as const, 1 as const),
  no: fc.constantFrom(...NO),
  ch: fc.integer({ min: 0, max: 3 }),
  t: fc.integer({ min: 0, max: 9 }),
  x: fc.nat(),
})

const TEXTS = ['1', '2', '1 취소', '2 취소', '1 2', '1번이요', '일번', '안녕', '1 취소할게요', '2번 사려다 취소']

/** 원료 → 엔진 필드(seq·at 제외). 방송 ID는 b1·b2 */
function materialize(raw: Raw, i: number, sent: Map<string, string[]>): Record<string, unknown> | null {
  const b = raw.b === 0 ? 'b1' : 'b2'
  const no = raw.no
  const ch = CH[raw.ch] as string
  const k = raw.k
  if (k < 10) return { type: 'product.register', b, no, name: `품종${String(no)}`, price: 1000 * no, stock: 1 + (raw.x % 2), status: raw.t % 3 === 0 ? 'READY' : 'OPEN' }
  if (k < 16) return { type: ['product.open', 'product.hold', 'product.close'][raw.t % 3] as string, b, no }
  if (k < 50) {
    const id = `m${String(i)}`
    const list = sent.get(b) ?? []
    list.push(id)
    sent.set(b, list)
    return { type: 'chat', b, id, ch, nick: ch, text: TEXTS[raw.x % TEXTS.length] as string, publishedAt: T0 + i * 1000 - raw.t * 7000 }
  }
  if (k < 60) {
    const sec = Math.max(0, i - raw.t * 3)
    const received = `20:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`
    return { type: 'sms', b, ref: `r${String(i)}`, no, received, ...(raw.x % 3 === 0 ? {} : smsPhoneFields(PHONES[b][raw.x % 2] as string)) }
  }
  if (k < 85) {
    const type = ['host.cancel', 'host.reject', 'host.promote', 'host.confirm', 'host.approveCancel', 'host.dismissCancel', 'host.cancel'][raw.t % 7] as string
    return { type, b, no, buyer: ch, reason: '사유' }
  }
  if (k < 88) return { type: 'host.reopen', b, no, reason: '사유' }
  if (k < 92) {
    const list = sent.get(b) ?? []
    if (list.length === 0) return null
    return { type: 'host.convertMessage', b, msg: list[raw.x % list.length] as string, no }
  }
  if (k < 95) return { type: 'product.update', b, no, stock: 1 + (raw.x % 3) }
  if (k < 97) return { type: 'host.resolveConflict', b, no, decision: raw.t % 2 === 0 ? 'KEEP' : 'SWITCH' }
  return { type: 'broadcast.end', b }
}

function run(start: readonly Record<string, unknown>[], events: readonly { seq: number; at: number; fields: Record<string, unknown> }[]): EngineState {
  let state = initEngine({ broadcasts: [], settings: {} })
  let seq = 0
  for (const s of start) state = applyEvent(state, { ...s, seq: ++seq, at: T0 } as unknown as EngineEvent).state
  for (const e of events) state = applyEvent(state, { ...e.fields, seq: e.seq, at: e.at } as unknown as EngineEvent).state
  return state
}

/** 그 방송의 판정 (찜 ID·효과 ID는 로그 전체 번호라 빼고, 구매자·순서로 본다) */
function view(state: EngineState, b: string): unknown {
  const claims = listClaims(state).filter((c) => c.broadcast === b)
  const idToKey = new Map(claims.map((c) => [c.id, `${c.buyer}@${String(c.seq)}`]))
  const key = (id: string | null) => (id === null ? null : (idToKey.get(id) ?? '?'))
  return {
    products: listProducts(state)
      .filter((p) => p.broadcast === b)
      .map((p) => ({
        no: p.no,
        status: p.status,
        stock: p.stock,
        winners: p.winnerClaims.map(key),
        waitlist: p.waitlistClaims.map(key),
        awaitingSuccession: p.awaitingSuccession,
        conflict: key(p.conflictClaim),
        confirmVersion: p.confirmVersion,
      })),
    claims: claims.map((c) => [key(c.id), c.no, c.status, c.reason, c.origin, c.price, c.confirmVersion, c.locked, c.cancelRequested]),
    pending: listPending(state)
      .filter((p) => p.broadcast === b)
      .map((p) => [p.no, p.claims.map(key)]),
    effects: listEffects(state)
      .filter((e) => e.product.startsWith(`${b}/`))
      .map((e) => [e.kind, e.target, key(e.claim), e.product, e.text, e.confirmVersion, e.status])
      .map((x) => JSON.stringify(x))
      .sort(),
  }
}

describe('방송마다 설정 스냅샷 — 섞인 로그 = 방송별로 나눈 로그 (AC-S04-02·04)', () => {
  it('설정이 다른 두 방송을 섞어도 각 방송의 판정은 그 방송만 따로 돌린 것과 같다', () => {
    fc.assert(
      fc.property(settingsArb, settingsArb, fc.array(rawArb, { minLength: 10, maxLength: 120 }), (s1, s2, raws) => {
        const sent = new Map<string, string[]>()
        const events: { seq: number; at: number; fields: Record<string, unknown> }[] = []
        raws.forEach((raw, i) => {
          const fields = materialize(raw, i, sent)
          if (fields !== null) events.push({ seq: i + 10, at: T0 + i * 1000, fields })
        })
        const starts = [
          { type: 'broadcast.start', b: 'b1', date: DATE, title: '1부', settings: s1 },
          { type: 'broadcast.start', b: 'b2', date: DATE, title: '2부', settings: s2 },
        ]
        const mixed = run(starts, events)
        expect(checkInvariants(mixed)).toEqual([])
        for (const [index, b] of (['b1', 'b2'] as const).entries()) {
          const alone = run([starts[index] as Record<string, unknown>], events.filter((e) => e.fields.b === b))
          expect(view(mixed, b), `${b}\n설정 ${JSON.stringify([s1, s2])}\n로그 ${JSON.stringify(events)}`).toEqual(view(alone, b))
        }
      }),
      { numRuns: 300, seed: 20261019 },
    )
  }, 60_000)
})
