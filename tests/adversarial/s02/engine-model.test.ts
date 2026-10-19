// S02 적대 테스트 (test-domain): 규칙 문장만 보고 따로 만든 참조 모델과 실제 엔진을 무작위 로그로 대조한다.
// - 참조 모델은 DOMAIN_RULES v0.1.6의 R-2·R-4·R-5·R-8·R-9·R-13 문장을 그대로 옮긴 것이고, 엔진 코드를 보고 만들지 않았다.
// - 매 이벤트 뒤 상품(상태·1등·대기·승계 표시·확정버전), 찜 전부(상태·사유·가격·확정버전·잠금·취소 요청), 효과 전부(ID·상태·문구),
//   취소 요청, 구매자 합계·표시 이름을 비교한다. 어긋나면 그 지점의 로그를 보여 준다.
// - 파서는 S01 parseChat을 그대로 쓴다(채팅 문법은 이 대조의 대상이 아니다).
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  InvalidEventError,
  formatThanksText,
  initEngine,
  listBuyers,
  listCancelRequests,
  listClaims,
  listEffects,
  listProducts,
  parseChat,
  resolveSettings,
  type EngineState,
  type SettingsOverride,
} from '@livejjim/core'
import { apply, B1, T0, type Ev } from './helpers.ts'

type Status = 'CONFIRMED' | 'WAITLISTED' | 'PENDING' | 'REJECTED' | 'CANCELLED'
interface MClaim {
  id: string
  no: number
  buyer: string
  status: Status
  reason: string | null
  price: number | null
  version: number | null
  locked: boolean
  request: number | null
  at: number
}
interface MProduct {
  name: string
  price: number
  stock: number
  phase: 'READY' | 'SELLING' | 'HOLD' | 'CLOSED'
}
interface MSlot {
  product: MProduct | null
  winners: MClaim[]
  waitlist: MClaim[]
  pending: MClaim[]
  awaiting: boolean
  version: number
}
interface MEffect {
  id: string
  kind: string
  claim: MClaim
  version: number
  status: 'PENDING' | 'DONE' | 'CANCELLED'
  text: string | null
}

const active = (s: Status): boolean => s === 'CONFIRMED' || s === 'WAITLISTED' || s === 'PENDING'
const drop = <T>(list: T[], item: T): void => {
  const i = list.indexOf(item)
  if (i >= 0) list.splice(i, 1)
}

/** DOMAIN_RULES 문장대로의 참조 모델 (방송 하나) */
class Model {
  readonly set: ReturnType<typeof resolveSettings>
  slots = new Map<number, MSlot>()
  claims: MClaim[] = []
  effects: MEffect[] = []
  buyers = new Map<string, { display: string }>()
  blocked = new Set<string>()
  messages = new Set<string>()
  seq = 0
  at = 0

  constructor(settings: SettingsOverride) {
    this.set = resolveSettings(settings)
  }

  slot(no: number): MSlot {
    let s = this.slots.get(no)
    if (!s) {
      s = { product: null, winners: [], waitlist: [], pending: [], awaiting: false, version: 0 }
      this.slots.set(no, s)
    }
    return s
  }

  activeOf(no: number, buyer: string): MClaim | undefined {
    return this.claims.find((c) => c.no === no && c.buyer === buyer && active(c.status))
  }

  // R-4 판정표 (4번 줄 먼저, D-038)
  decide(no: number, buyer: string, self?: MClaim): 'none' | 'pending' | 'confirm' | 'waitlist' | { reject: string } {
    const holder = this.activeOf(no, buyer)
    if (holder && holder !== self) return 'none'
    if (this.blocked.has(buyer)) return { reject: 'BLOCKED' }
    const s = this.slots.get(no)
    const p = s?.product ?? null
    if (!s || !p || p.phase === 'READY') return 'pending'
    if (p.phase !== 'SELLING') return { reject: 'NOT_ON_SALE' }
    const room = s.waitlist.length < this.set['waitlist.max']
    if (s.awaiting) return room ? 'waitlist' : { reject: 'SOLD_OUT' }
    if (s.winners.length < p.stock) return 'confirm'
    return room ? 'waitlist' : { reject: 'SOLD_OUT' }
  }

  place(c: MClaim, no: number, outcome: Exclude<ReturnType<Model['decide']>, 'none'>): void {
    const s = this.slot(no)
    if (outcome === 'pending') {
      Object.assign(c, { status: 'PENDING', reason: 'UNOPENED' })
      s.pending.push(c)
    } else if (outcome === 'waitlist') {
      Object.assign(c, { status: 'WAITLISTED', reason: null })
      s.waitlist.push(c)
    } else if (outcome === 'confirm') this.confirm(c, s)
    else Object.assign(c, { status: 'REJECTED', reason: outcome.reject })
  }

  emit(c: MClaim, kind: string, target: string | null, version: number, text: string | null): void {
    this.effects.push({ id: `${c.id}:${kind}:${target ?? '-'}:${String(version)}`, kind, claim: c, version, status: 'PENDING', text })
  }

  // R-4·R-13: 확정 → 확정버전 +1, 가격 스냅샷, 효과
  confirm(c: MClaim, s: MSlot): void {
    const p = s.product as MProduct
    s.version += 1
    Object.assign(c, { status: 'CONFIRMED', reason: null, price: p.price, version: s.version, locked: false })
    s.winners.push(c)
    const text = formatThanksText({ no: c.no, name: p.name, price: p.price, buyerName: this.buyers.get(c.buyer)?.display ?? '' })
    if (this.set['print.autoOnConfirm']) this.emit(c, 'PRINT_PRODUCT_LABEL', null, s.version, null)
    if (this.set['thanks.liveChat']) this.emit(c, 'POST_THANKS', 'LIVE_CHAT', s.version, text)
    if (this.set['thanks.videoComment'] === 'PER_SALE') this.emit(c, 'POST_THANKS', 'VIDEO_COMMENT', s.version, text)
  }

  // R-13 "확정이 풀릴 때"
  unconfirm(c: MClaim, s: MSlot): void {
    for (const e of this.effects.filter((x) => x.claim === c && x.version === c.version && x.kind !== 'VOID_LABEL')) {
      if (e.status === 'PENDING') e.status = 'CANCELLED'
      else if (e.status === 'DONE' && e.kind === 'PRINT_PRODUCT_LABEL') this.emit(c, 'VOID_LABEL', null, e.version, null)
    }
    drop(s.winners, c)
    c.locked = false
  }

  end(c: MClaim, status: 'REJECTED' | 'CANCELLED', reason: string | null): void {
    Object.assign(c, { status, reason, request: null })
  }

  settle(s: MSlot): void {
    if (s.awaiting && (s.waitlist.length === 0 || (s.product !== null && s.winners.length >= s.product.stock))) s.awaiting = false
  }

  clear(s: MSlot): void {
    for (const c of s.waitlist) this.end(c, 'REJECTED', 'WAITLIST_CLEARED')
    s.waitlist = []
    s.awaiting = false
  }

  // R-8 방송자 취소·무효와 같은 처리
  release(c: MClaim, status: 'REJECTED' | 'CANCELLED', reason: string | null): void {
    const s = this.slot(c.no)
    const was = c.status
    if (was === 'CONFIRMED') this.unconfirm(c, s)
    else if (was === 'WAITLISTED') drop(s.waitlist, c)
    else drop(s.pending, c)
    this.end(c, status, reason)
    if (was === 'CONFIRMED' && s.waitlist.length > 0) {
      const mode = this.set['cancel.succession']
      if (mode === 'REOPEN') this.clear(s)
      else if (mode === 'ASK') s.awaiting = true
      else this.confirm(s.waitlist.shift() as MClaim, s)
    }
    this.settle(s)
  }

  // R-5
  openPending(s: MSlot, no: number): void {
    const start = this.at - this.set['claim.preOpenWindowSec'] * 1000
    const list = s.pending
    s.pending = []
    for (const c of list) {
      if (c.at < start) {
        this.end(c, 'REJECTED', 'EXPIRED')
        continue
      }
      const o = this.decide(no, c.buyer, c)
      if (o === 'none' || o === 'pending') throw new Error('model: impossible')
      this.place(c, no, o)
    }
  }

  newClaim(no: number, buyer: string): MClaim {
    const c: MClaim = { id: `c${String(this.claims.length + 1)}`, no, buyer, status: 'PENDING', reason: null, price: null, version: null, locked: false, request: null, at: this.at }
    this.claims.push(c)
    return c
  }

  apply(e: Ev & Record<string, never>, seq: number, at: number): void {
    this.seq = seq
    this.at = at
    const no = e.no as unknown as number
    const buyer = e.buyer as unknown as string
    switch (e.type) {
      case 'product.register': {
        if (this.slots.get(no)?.product) return
        const s = this.slot(no)
        s.product = { name: e.name as unknown as string, price: e.price as unknown as number, stock: (e.stock as unknown as number | undefined) ?? 1, phase: e.status === 'READY' ? 'READY' : 'SELLING' }
        if (s.product.phase === 'SELLING') this.openPending(s, no)
        return
      }
      case 'product.open': {
        const s = this.slots.get(no)
        if (!s?.product || s.product.phase === 'SELLING') return
        s.product.phase = 'SELLING'
        this.openPending(s, no)
        return
      }
      case 'product.hold': {
        const p = this.slots.get(no)?.product
        if (p?.phase === 'SELLING') p.phase = 'HOLD'
        return
      }
      case 'product.close': {
        const s = this.slots.get(no)
        if (!s?.product || s.product.phase === 'CLOSED' || s.winners.length > 0 || s.waitlist.length > 0) return
        s.product.phase = 'CLOSED'
        for (const c of s.pending) this.end(c, 'REJECTED', 'NOT_ON_SALE')
        s.pending = []
        return
      }
      case 'chat': {
        const id = e.id as unknown as string
        if (this.messages.has(id)) return
        this.messages.add(id)
        const ch = e.ch as unknown as string
        const nick = e.nick as unknown as string
        const b = this.buyers.get(ch)
        if (!b) this.buyers.set(ch, { display: nick })
        else b.display = nick
        const parsed = parseChat(e.text as unknown as string, this.set)
        for (const n of parsed.claims) {
          const o = this.decide(n, ch)
          if (o === 'none') continue
          const c = this.newClaim(n, ch)
          this.place(c, n, o)
        }
        for (const n of parsed.cancels) {
          const mode = this.set['cancel.buyerChat']
          if (mode === 'OFF') continue
          const c = this.activeOf(n, ch)
          if (!c) continue
          if (mode === 'AUTO' && !(c.status === 'CONFIRMED' && c.locked)) this.release(c, 'CANCELLED', null)
          else if (c.request === null) c.request = seq
        }
        return
      }
      case 'host.cancel':
      case 'host.reject': {
        const c = this.activeOf(no, buyer)
        if (c) this.release(c, e.type === 'host.reject' ? 'REJECTED' : 'CANCELLED', e.type === 'host.reject' ? 'BY_HOST' : null)
        return
      }
      case 'host.promote': {
        const s = this.slots.get(no)
        const c = this.activeOf(no, buyer)
        if (!s?.product || c?.status !== 'WAITLISTED' || s.winners.length >= s.product.stock) return
        drop(s.waitlist, c)
        this.confirm(c, s)
        this.settle(s)
        return
      }
      case 'host.confirm': {
        const c = this.activeOf(no, buyer)
        if (c?.status === 'CONFIRMED') c.locked = true
        return
      }
      case 'host.approveCancel':
      case 'host.dismissCancel': {
        const c = this.activeOf(no, buyer)
        if (!c || c.request === null) return
        if (e.type === 'host.dismissCancel') c.request = null
        else this.release(c, 'CANCELLED', null)
        return
      }
      case 'host.reopen': {
        const s = this.slots.get(no)
        if (s?.awaiting) this.clear(s)
        return
      }
      case 'host.assign': {
        const s = this.slots.get(no)
        const p = s?.product
        if (!s || !p || p.phase !== 'SELLING' || !this.buyers.has(buyer)) return
        const replace = e.replace as unknown as string | undefined
        const to = e.replaceTo as unknown as string | undefined
        if ((replace === undefined) !== (to === undefined)) return
        const own = this.activeOf(no, buyer)
        if (own && own.status !== 'WAITLISTED') return
        let target: MClaim | undefined
        if (replace !== undefined) {
          target = this.activeOf(no, replace)
          if (target?.status !== 'CONFIRMED') return
        } else if (s.winners.length >= p.stock) return
        let c: MClaim
        if (own) {
          drop(s.waitlist, own)
          c = own
        } else c = this.newClaim(no, buyer)
        if (target) {
          this.unconfirm(target, s)
          if (to === 'CANCEL') this.end(target, 'CANCELLED', null)
          else if (this.blocked.has(target.buyer)) this.end(target, 'REJECTED', 'BLOCKED')
          else {
            Object.assign(target, { status: 'WAITLISTED', reason: null })
            s.waitlist.unshift(target)
          }
        }
        this.confirm(c, s)
        while (s.waitlist.length > this.set['waitlist.max']) this.end(s.waitlist.pop() as MClaim, 'REJECTED', 'SOLD_OUT')
        this.settle(s)
        return
      }
      case 'host.blockBuyer': {
        if (this.blocked.has(buyer)) return
        this.blocked.add(buyer)
        for (const c of this.claims.filter((x) => x.buyer === buyer && (x.status === 'WAITLISTED' || x.status === 'PENDING'))) {
          const s = this.slot(c.no)
          drop(c.status === 'WAITLISTED' ? s.waitlist : s.pending, c)
          this.end(c, 'REJECTED', 'BLOCKED')
          this.settle(s)
        }
        return
      }
      case 'host.unblockBuyer':
        this.blocked.delete(buyer)
        return
      case 'effect.labelPrinted':
      case 'effect.thanksSent': {
        const kind = e.type === 'effect.labelPrinted' ? 'PRINT_PRODUCT_LABEL' : 'POST_THANKS'
        const ef = this.effects.find((x) => x.id === (e.effectId as unknown as string))
        if (!ef || ef.kind !== kind || ef.status === 'DONE') return
        const was = ef.status
        ef.status = 'DONE'
        if (was === 'PENDING') {
          if (ef.claim.status === 'CONFIRMED' && ef.claim.version === ef.version) ef.claim.locked = true
        } else if (kind === 'PRINT_PRODUCT_LABEL') this.emit(ef.claim, 'VOID_LABEL', null, ef.version, null)
        return
      }
    }
  }

  view(): unknown {
    const products = [...this.slots.entries()]
      .filter(([, s]) => s.product !== null)
      .sort(([a], [b]) => a - b)
      .map(([no, s]) => {
        const p = s.product as MProduct
        return {
          no,
          status: p.phase !== 'SELLING' ? p.phase : s.winners.length >= p.stock ? 'SOLD' : 'OPEN',
          winners: s.winners.map((c) => c.buyer),
          waitlist: s.waitlist.map((c) => c.buyer),
          awaiting: s.awaiting,
          version: s.version,
        }
      })
    const claims = this.claims.map((c) => [c.id, c.no, c.buyer, c.status, c.reason, c.price, c.version, c.status === 'CONFIRMED' && c.locked, c.request !== null && active(c.status)])
    const effects = this.effects.map((x) => [x.id, x.status, x.text])
    const requests = this.claims
      .filter((c) => c.request !== null && active(c.status))
      .sort((a, b) => (a.request as number) - (b.request as number))
      .map((c) => [c.no, c.buyer])
    const buyers = [...this.buyers.entries()].map(([id, b]) => [
      id,
      b.display,
      this.claims.filter((c) => c.buyer === id && c.status === 'CONFIRMED').reduce((sum, c) => sum + (c.price ?? 0), 0),
    ])
    return { products, claims, effects, requests, buyers }
  }
}

function engineView(state: EngineState): unknown {
  return {
    products: listProducts(state).map((p) => ({ no: p.no, status: p.status, winners: p.winners, waitlist: p.waitlist, awaiting: p.awaitingSuccession, version: p.confirmVersion })),
    claims: listClaims(state).map((c) => [c.id, c.no, c.buyer, c.status, c.reason, c.price, c.confirmVersion, c.locked, c.cancelRequested]),
    effects: listEffects(state).map((x) => [x.id, x.status, x.text]),
    requests: listCancelRequests(state).map((r) => [Number(r.product.split('/')[1]), r.buyer]),
    buyers: listBuyers(state).map((b) => [b.id, b.display, b.subtotal]),
  }
}

const BUY = ['A', 'B', 'C', 'D', 'E', 'F'] as const
const NO = [1, 2] as const

type Raw = Ev & { pick?: number; again?: boolean }

const rawArb: fc.Arbitrary<Raw> = fc.oneof(
  { weight: 2, arbitrary: fc.record({ type: fc.constant('product.register'), no: fc.constantFrom(...NO), stock: fc.integer({ min: 1, max: 3 }), status: fc.constantFrom('OPEN', 'READY'), price: fc.constantFrom(0, 8000, 15000) }) },
  { weight: 2, arbitrary: fc.record({ type: fc.constantFrom('product.open', 'product.hold', 'product.close'), no: fc.constantFrom(...NO) }) },
  {
    weight: 9,
    arbitrary: fc.record({
      type: fc.constant('chat'),
      ch: fc.constantFrom(...BUY),
      nick: fc.constantFrom('하나', '둘'),
      text: fc.constantFrom('1', '2', '1 취소', '2 취소', '1 2', '안녕', '2번 1번'),
      again: fc.boolean(),
      pick: fc.nat(),
    }),
  },
  {
    weight: 6,
    arbitrary: fc.record({
      type: fc.constantFrom('host.cancel', 'host.reject', 'host.promote', 'host.confirm', 'host.approveCancel', 'host.dismissCancel', 'host.reopen'),
      no: fc.constantFrom(...NO),
      buyer: fc.constantFrom(...BUY),
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      type: fc.constant('host.assign'),
      no: fc.constantFrom(...NO),
      buyer: fc.constantFrom(...BUY),
      replace: fc.option(fc.constantFrom(...BUY), { nil: undefined }),
      replaceTo: fc.option(fc.constantFrom('WAITLIST', 'CANCEL'), { nil: undefined }),
    }),
  },
  { weight: 2, arbitrary: fc.record({ type: fc.constantFrom('host.blockBuyer', 'host.unblockBuyer'), buyer: fc.constantFrom(...BUY) }) },
  { weight: 4, arbitrary: fc.record({ type: fc.constantFrom('effect.labelPrinted', 'effect.thanksSent'), pick: fc.nat() }) },
)

const settingsArb: fc.Arbitrary<SettingsOverride> = fc.record({
  'waitlist.max': fc.integer({ min: 0, max: 4 }),
  'cancel.succession': fc.constantFrom('AUTO', 'ASK', 'REOPEN'),
  'cancel.buyerChat': fc.constantFrom('OFF', 'REQUEST', 'AUTO'),
  'claim.preOpenWindowSec': fc.integer({ min: 0, max: 4 }),
  'print.autoOnConfirm': fc.boolean(),
  'thanks.liveChat': fc.boolean(),
  'thanks.videoComment': fc.constantFrom('OFF', 'PER_SALE', 'SUMMARY'),
})

/** 무작위 원료를 실제 이벤트로: 채팅 재수신은 앞선 메시지 ID를 고르고, 효과 보고는 모델의 효과 중 하나를 고른다 */
function materialize(raw: Raw, model: Model, sent: readonly string[], i: number): Ev {
  const { pick, again, ...rest } = raw
  if (raw.type === 'chat') {
    const id = again === true && sent.length > 0 ? (sent[(pick ?? 0) % sent.length] as string) : `m${String(i)}`
    return { ...rest, b: 'b1', id }
  }
  if (raw.type === 'effect.labelPrinted' || raw.type === 'effect.thanksSent') {
    const kind = raw.type === 'effect.labelPrinted' ? 'PRINT_PRODUCT_LABEL' : 'POST_THANKS'
    const mine = model.effects.filter((x) => x.kind === kind)
    return { type: raw.type, effectId: mine.length === 0 ? 'none' : (mine[(pick ?? 0) % mine.length] as MEffect).id }
  }
  if (raw.type === 'product.register') return { ...rest, b: 'b1', name: '핑크프릴' }
  if (raw.type.startsWith('product.')) return { ...rest, b: 'b1' }
  if (raw.type.startsWith('host.') && raw.type !== 'host.blockBuyer' && raw.type !== 'host.unblockBuyer') return { ...rest, b: 'b1', reason: '사유' }
  return { ...rest, reason: '사유' }
}

describe('S02 참조 모델 대조', () => {
  it('규칙 문장대로의 모델과 엔진이 매 이벤트 뒤 같은 상품·찜·효과·요청·구매자를 보여 준다', () => {
    fc.assert(
      fc.property(settingsArb, fc.array(rawArb, { minLength: 5, maxLength: 120, size: 'max' }), (settings, raws) => {
        let state = initEngine({ broadcasts: [B1], settings })
        const model = new Model(settings)
        const sent: string[] = []
        const log: Ev[] = []
        raws.forEach((raw, i) => {
          const event = materialize(raw, model, sent, i)
          if (event.type === 'chat') sent.push(event.id as string)
          log.push(event)
          const at = T0 + i * 1000
          // S03b (D-065): replace·replaceTo 한쪽만은 입력 오류 — 상태는 그대로이고 모델도 아무 일도 없다
          if (event.type === 'host.assign' && (event.replace === undefined) !== (event.replaceTo === undefined)) {
            const before = state
            expect(() => apply(state, event, i + 1, at), JSON.stringify(event)).toThrow(InvalidEventError)
            expect(state).toBe(before)
            return
          }
          state = apply(state, event, i + 1, at).state
          model.apply(event as Ev & Record<string, never>, i + 1, at)
          expect(engineView(state), `이벤트 ${String(i + 1)}: ${JSON.stringify(event)}\n설정 ${JSON.stringify(settings)}\n로그 ${JSON.stringify(log)}`).toEqual(model.view())
        })
      }),
      { numRuns: 200, seed: 20261019 },
    )
  }, 30_000)
})
