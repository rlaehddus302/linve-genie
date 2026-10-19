// S03 적대 테스트 (test-domain): 규칙 문장(DOMAIN_RULES v0.1.7)만 보고 따로 만든 참조 모델과 실제 엔진을 무작위 로그로 대조한다.
// - 범위: 기본 정책 ARRIVAL에서 S03 이벤트 전부 — 문자찜(구매자 정하기·표시 이름·ref 재전송), 상품 수정(원자성·UNPAID_CLAIMS·재고 늘림·재출력 필요),
//   번호 변경, 메시지 변환(ARRIVAL에서도 앞서면 충돌), 충돌 결정, 구매자 합치기·떼어 내기, 정산 기록 넷(입금 잠금 포함).
//   RECEIVED_TIME 정렬 키는 S03 속성 테스트·골든이 따로 본다.
// - S02 참조 모델(../s02/engine-model.test.ts)의 R-2·R-4·R-5·R-8·R-9·R-13 부분을 지금의 구매자(R-11)와 충돌(R-7)로 넓혔다.
// - 매 이벤트 뒤 상품·찜·효과·취소 요청·구매자·정산 묶음을 비교한다. 어긋나면 그 지점의 로그를 보여 준다.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  formatThanksText,
  initEngine,
  listBuyers,
  listCancelRequests,
  listClaims,
  listEffects,
  listProducts,
  listSettlements,
  parseChat,
  resolveSettings,
  type EngineState,
  type SettingsOverride,
} from '@livejjim/core'
import { apply, B1, T0, type Ev } from './helpers.ts'

type Status = 'CONFIRMED' | 'WAITLISTED' | 'PENDING' | 'CONFLICT' | 'REJECTED' | 'CANCELLED' | 'DUPLICATE'
type Origin = 'chat' | 'sms' | 'assign' | 'convert'
interface MProduct {
  id: string
  name: string
  price: number
  stock: number
  phase: 'READY' | 'SELLING' | 'HOLD' | 'CLOSED'
}
interface MClaim {
  id: string
  n: number
  /** 생긴 번호 */
  no: number
  pid: string | null
  buyer: string
  origin: Origin
  seq: number
  at: number
  /** 순위 재료 실제 시각 (분 단위 문자는 구간 시작) */
  time: number
  minute: boolean
  status: Status
  reason: string | null
  price: number | null
  version: number | null
  locked: boolean
  request: number | null
  reprint: boolean
}
interface MSlot {
  product: MProduct | null
  winners: MClaim[]
  waitlist: MClaim[]
  pending: MClaim[]
  conflict: MClaim | null
  awaiting: boolean
  version: number
}
interface MEffect {
  id: string
  kind: string
  claim: MClaim
  version: number
  no: number
  status: 'PENDING' | 'DONE' | 'CANCELLED'
  text: string | null
}
interface MBuyer {
  kind: 'youtube' | 'sms'
  display: string
  names: string[]
  phone: string | null
  parent: string | null
  children: string[]
}
interface MEntry {
  buyer: string
  date: string
  kind: 'shipping' | 'adjust' | 'payment' | 'refund'
  amount: number | null
  mode: string | null
  seq: number
}

const DATE = '2026-10-18'
const active = (s: Status): boolean => s === 'CONFIRMED' || s === 'WAITLISTED' || s === 'PENDING' || s === 'CONFLICT'
const drop = <T>(list: T[], item: T): void => {
  const i = list.indexOf(item)
  if (i >= 0) list.splice(i, 1)
}
const MINUTE = 60_000
const KST = 9 * 3_600_000
const DAY = 86_400_000

/** 문자 수신 시각의 날짜 (D-023): at의 KST 전날·당일·다음날 중 at에 가장 가까운 것(분 단위는 구간 시작), 같으면 늦은 날짜 */
function receivedAt(text: string, at: number): { time: number; minute: boolean } {
  const [h, m, sec] = text.split(':').map(Number) as [number, number, number | undefined]
  const clock = ((h * 60 + m) * 60 + (sec ?? 0)) * 1000
  const day = Math.floor((at + KST) / DAY)
  const options = [day - 1, day, day + 1].map((d) => d * DAY + clock - KST)
  let best = options[0] as number
  for (const t of options) if (Math.abs(t - at) <= Math.abs(best - at)) best = t
  return { time: best, minute: sec === undefined }
}

/** 규칙 문장대로의 휴대폰 번호 (R-11): 숫자만(전각 → 반각), 01로 시작하는 10~11자리 */
function phoneOf(text: string): string | null {
  const digits = [...text]
    .map((ch) => {
      const code = ch.codePointAt(0) as number
      if (code >= 0x30 && code <= 0x39) return ch
      if (code >= 0xff10 && code <= 0xff19) return String.fromCharCode(code - 0xff10 + 0x30)
      return ''
    })
    .join('')
  return /^01\d{8,9}$/.test(digits) ? digits : null
}

type Decision = 'none' | 'pending' | 'confirm' | 'waitlist' | 'contend' | { reject: string }

class Model {
  readonly set: ReturnType<typeof resolveSettings>
  slots = new Map<number, MSlot>()
  claims: MClaim[] = []
  effects: MEffect[] = []
  buyers = new Map<string, MBuyer>()
  phones = new Map<string, string>()
  refs = new Set<string>()
  blocked = new Set<string>()
  messages = new Map<string, { ch: string; seq: number; at: number; published: number; ignored: boolean; claimed: Set<number> }>()
  ledger: MEntry[] = []
  products = 0
  seq = 0
  at = 0

  constructor(settings: SettingsOverride) {
    this.set = resolveSettings(settings)
  }

  // ── 판정 순위 (R-6) ──

  /** R-6 문장 그대로: ARRIVAL은 seq. RECEIVED_TIME은 실제 시각, 분 단위 문자는 구간으로 비교(동률은 sameMinuteTieBreaker), 같으면 seq */
  ahead(a: MClaim, b: MClaim): boolean {
    const bySeq = a.seq < b.seq || (a.seq === b.seq && a.n < b.n)
    if (this.set['contention.policy'] !== 'RECEIVED_TIME') return bySeq
    if (a.minute === b.minute) return a.time !== b.time ? a.time < b.time : bySeq
    const [mm, exact] = a.minute ? [a, b] : [b, a]
    let minuteFirst: boolean
    if (exact.time >= mm.time + MINUTE) minuteFirst = true
    else if (exact.time < mm.time) minuteFirst = false
    else minuteFirst = this.set['contention.sameMinuteTieBreaker'] === 'SMS'
    return a.minute ? minuteFirst : !minuteFirst
  }

  tie(a: MClaim, b: MClaim): boolean {
    if (a.minute === b.minute) return false
    const [mm, exact] = a.minute ? [a, b] : [b, a]
    return mm.time <= exact.time && exact.time < mm.time + MINUTE
  }

  // ── 구매자 (R-11) ──

  root(id: string): string {
    let cur = id
    for (;;) {
      const parent = this.buyers.get(cur)?.parent ?? null
      if (parent === null) return cur
      cur = parent
    }
  }

  members(id: string): string[] {
    const b = this.buyers.get(id)
    return [id, ...(b?.children ?? []).flatMap((c) => this.members(c))]
  }

  received(root: string, date: string): number {
    const members = new Set(this.members(root))
    return this.ledger.filter((e) => members.has(e.buyer) && e.date === date).reduce((s, e) => s + (e.kind === 'payment' ? (e.amount as number) : e.kind === 'refund' ? -(e.amount as number) : 0), 0)
  }

  /** 잠금 (R-7 3): 확정 찜에 출력·게시 보고나 host.confirm, 또는 묶음 받은 금액 > 0 */
  isLocked(c: MClaim): boolean {
    return c.status === 'CONFIRMED' && (c.locked || this.received(this.root(c.buyer), DATE) > 0)
  }

  slot(no: number): MSlot {
    let s = this.slots.get(no)
    if (!s) {
      s = { product: null, winners: [], waitlist: [], pending: [], conflict: null, awaiting: false, version: 0 }
      this.slots.set(no, s)
    }
    return s
  }

  /** 그 번호에서 지금의 구매자의 활성 찜 */
  activeOf(no: number, buyer: string): MClaim | undefined {
    const r = this.root(buyer)
    const s = this.slots.get(no)
    if (!s) return undefined
    return [...s.winners, ...s.waitlist, ...s.pending, ...(s.conflict ? [s.conflict] : [])].find((c) => this.root(c.buyer) === r)
  }

  attach(c: MClaim, no: number): void {
    const p = this.slots.get(no)?.product
    if (c.pid === null && p) c.pid = p.id
  }

  // ── R-4 판정표 ──

  decide(no: number, buyer: string, self?: MClaim): Decision {
    const holder = this.activeOf(no, buyer)
    if (holder && holder !== self) return 'none'
    if (this.blocked.has(buyer)) return { reject: 'BLOCKED' }
    const s = this.slots.get(no)
    const p = s?.product ?? null
    if (!s || !p || p.phase === 'READY') return 'pending'
    if (p.phase !== 'SELLING') return { reject: 'NOT_ON_SALE' }
    if (s.awaiting) return 'waitlist'
    if (s.winners.length < p.stock) return 'confirm'
    return 'contend'
  }

  trim(s: MSlot, no: number): void {
    while (s.waitlist.length > Math.max(0, this.set['waitlist.max'])) this.end(s.waitlist.pop() as MClaim, no, 'REJECTED', 'SOLD_OUT')
  }

  /** 대기에 넣는 자리 (R-4): 자기보다 앞서는 대기자 중 가장 뒤 바로 뒤, 없으면 1순위. 넘치면 맨 끝 품절 */
  queue(c: MClaim, s: MSlot, no: number): void {
    let at = 0
    for (let i = s.waitlist.length - 1; i >= 0; i--) {
      if (this.ahead(s.waitlist[i] as MClaim, c)) {
        at = i + 1
        break
      }
    }
    this.attach(c, no)
    Object.assign(c, { status: 'WAITLISTED', reason: null })
    s.waitlist.splice(at, 0, c)
    this.trim(s, no)
  }

  /** 밀려난 1등: 대기 1순위(차단 중이면 BLOCKED), 넘치면 맨 끝 품절 */
  displace(c: MClaim, s: MSlot, no: number): void {
    if (this.blocked.has(c.buyer)) {
      this.end(c, no, 'REJECTED', 'BLOCKED')
      return
    }
    Object.assign(c, { status: 'WAITLISTED', reason: null })
    s.waitlist.unshift(c)
    this.trim(s, no)
  }

  lastWinner(s: MSlot): MClaim {
    return s.winners.reduce((last, c) => (this.ahead(last, c) ? c : last))
  }

  place(c: MClaim, no: number, d: Exclude<Decision, 'none'>): void {
    const s = this.slot(no)
    if (d === 'pending') {
      Object.assign(c, { status: 'PENDING', reason: 'UNOPENED' })
      s.pending.push(c)
    } else if (d === 'waitlist') this.queue(c, s, no)
    else if (d === 'confirm') this.confirm(c, s, no)
    else if (d === 'contend') {
      // R-7: 충돌 중이 아니면 순위가 가장 뒤인 확정 찜 w와 비교 (ARRIVAL에서는 메시지 변환만)
      const received = this.set['contention.policy'] === 'RECEIVED_TIME'
      if (s.conflict === null && (received || c.origin === 'convert')) {
        const w = this.lastWinner(s)
        const hostTie = received && this.set['contention.sameMinuteTieBreaker'] === 'HOST' && this.tie(c, w)
        const first = this.ahead(c, w)
        if (hostTie || (first && (c.origin === 'convert' || w.origin === 'assign' || this.isLocked(w)))) {
          this.attach(c, no)
          Object.assign(c, { status: 'CONFLICT', reason: null })
          s.conflict = c
          return
        }
        if (first) {
          this.unconfirm(w, s)
          this.confirm(c, s, no)
          this.displace(w, s, no)
          return
        }
      }
      this.queue(c, s, no)
    } else {
      this.attach(c, no)
      Object.assign(c, { status: 'REJECTED', reason: d.reject })
    }
  }

  emit(c: MClaim, kind: string, target: string | null, version: number, text: string | null, no: number): void {
    this.effects.push({ id: `${c.id}:${kind}:${target ?? '-'}:${String(version)}`, kind, claim: c, version, no, status: 'PENDING', text })
  }

  thanksName(c: MClaim): string {
    if (c.origin === 'sms') return '문자찜'
    const b = this.buyers.get(c.buyer) as MBuyer
    return b.kind === 'sms' ? '문자찜' : b.display
  }

  confirm(c: MClaim, s: MSlot, no: number): void {
    const p = s.product as MProduct
    s.version += 1
    this.attach(c, no)
    Object.assign(c, { status: 'CONFIRMED', reason: null, price: p.price, version: s.version, locked: false, reprint: false })
    s.winners.push(c)
    const text = formatThanksText({ no, name: p.name, price: p.price, buyerName: this.thanksName(c) })
    if (this.set['print.autoOnConfirm']) this.emit(c, 'PRINT_PRODUCT_LABEL', null, s.version, null, no)
    if (this.set['thanks.liveChat']) this.emit(c, 'POST_THANKS', 'LIVE_CHAT', s.version, text, no)
    if (this.set['thanks.videoComment'] === 'PER_SALE') this.emit(c, 'POST_THANKS', 'VIDEO_COMMENT', s.version, text, no)
  }

  printed(c: MClaim): boolean {
    return this.effects.some((e) => e.claim === c && e.kind === 'PRINT_PRODUCT_LABEL' && e.version === c.version && e.status === 'DONE')
  }

  unconfirm(c: MClaim, s: MSlot): void {
    for (const e of this.effects.filter((x) => x.claim === c && x.version === c.version && x.kind !== 'VOID_LABEL')) {
      if (e.status === 'PENDING') e.status = 'CANCELLED'
      else if (e.status === 'DONE' && e.kind === 'PRINT_PRODUCT_LABEL') this.emit(c, 'VOID_LABEL', null, e.version, null, e.no)
    }
    drop(s.winners, c)
    c.locked = false
    c.reprint = false
  }

  end(c: MClaim, no: number, status: 'REJECTED' | 'CANCELLED' | 'DUPLICATE', reason: string | null): void {
    this.attach(c, no)
    Object.assign(c, { status, reason, request: null })
  }

  detach(c: MClaim, s: MSlot): void {
    if (c.status === 'WAITLISTED') drop(s.waitlist, c)
    else if (c.status === 'PENDING') drop(s.pending, c)
    else if (c.status === 'CONFLICT' && s.conflict === c) s.conflict = null
  }

  settle(s: MSlot): void {
    if (s.awaiting && (s.waitlist.length === 0 || s.product === null || s.winners.length >= s.product.stock)) s.awaiting = false
  }

  clear(s: MSlot, no: number): void {
    for (const c of s.waitlist) this.end(c, no, 'REJECTED', 'WAITLIST_CLEARED')
    s.waitlist = []
    s.awaiting = false
  }

  /** 충돌이 먼저 풀린다 (R-7 7): c를 대기 자리에 */
  unconflict(s: MSlot, no: number): void {
    const c = s.conflict
    if (!c) return
    s.conflict = null
    this.queue(c, s, no)
  }

  release(c: MClaim, no: number, status: 'REJECTED' | 'CANCELLED', reason: string | null): void {
    const s = this.slot(no)
    const was = c.status
    if (was === 'CONFIRMED') this.unconfirm(c, s)
    else this.detach(c, s)
    this.end(c, no, status, reason)
    if (was === 'CONFIRMED' && s.product) {
      this.unconflict(s, no)
      if (s.waitlist.length > 0) {
        const mode = this.set['cancel.succession']
        if (mode === 'REOPEN') this.clear(s, no)
        else if (mode === 'ASK') s.awaiting = true
        else this.confirm(s.waitlist.shift() as MClaim, s, no)
      }
    }
    this.settle(s)
  }

  openPending(s: MSlot, no: number): void {
    const start = this.at - this.set['claim.preOpenWindowSec'] * 1000
    const list = [...s.pending].sort((a, b) => (this.ahead(a, b) ? -1 : 1))
    s.pending = []
    for (const c of list) {
      if (c.at < start) {
        this.end(c, no, 'REJECTED', 'EXPIRED')
        continue
      }
      const d = this.decide(no, c.buyer, c)
      if (d === 'none' || d === 'pending') throw new Error('model: impossible')
      this.place(c, no, d)
    }
  }

  newClaim(no: number, buyer: string, origin: Origin, seq: number, at: number, time = at, minute = false): MClaim {
    const n = this.claims.length + 1
    const c: MClaim = { id: `c${String(n)}`, n, no, pid: null, buyer, origin, seq, at, time, minute, status: 'PENDING', reason: null, price: null, version: null, locked: false, request: null, reprint: false }
    this.claims.push(c)
    return c
  }

  /** 새 찜 (같은 사람 반복이면 null) */
  make(no: number, buyer: string, origin: Origin, seq: number, at: number, time = at, minute = false): MClaim | null {
    const d = this.decide(no, buyer)
    if (d === 'none') return null
    const c = this.newClaim(no, buyer, origin, seq, at, time, minute)
    this.place(c, no, d)
    return c
  }

  newBuyer(id: string, kind: 'youtube' | 'sms', display: string, phone: string | null): void {
    this.buyers.set(id, { kind, display, names: [display], phone, parent: null, children: [] })
  }

  rename(id: string, display: string): void {
    const b = this.buyers.get(id) as MBuyer
    if (b.display === display) return
    b.display = display
    b.names.push(display)
  }

  // ── 이벤트 ──

  apply(e: Record<string, unknown>, seq: number, at: number): void {
    this.seq = seq
    this.at = at
    const no = e.no as number
    const buyer = e.buyer as string
    switch (e.type) {
      case 'product.register': {
        if (this.slots.get(no)?.product) return
        const s = this.slot(no)
        s.product = { id: `p${String(++this.products)}`, name: e.name as string, price: e.price as number, stock: (e.stock as number | undefined) ?? 1, phase: e.status === 'READY' ? 'READY' : 'SELLING' }
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
        for (const c of [...s.pending].sort((a, b) => a.n - b.n)) this.end(c, no, 'REJECTED', 'NOT_ON_SALE')
        s.pending = []
        return
      }
      case 'product.update': {
        const s = this.slots.get(no)
        const p = s?.product
        if (!s || !p) return
        const name = e.name !== undefined && e.name !== p.name ? (e.name as string) : undefined
        const price = e.price !== undefined && e.price !== p.price ? (e.price as number) : undefined
        const stock = e.stock !== undefined && e.stock !== p.stock ? (e.stock as number) : undefined
        if (stock !== undefined && stock < s.winners.length) return
        if (name === undefined && price === undefined && stock === undefined) return
        if (name !== undefined) p.name = name
        if (price !== undefined) p.price = price
        for (const c of s.winners) {
          const reprice = price !== undefined && e.applyTo === 'UNPAID_CLAIMS' && c.price !== price && this.received(this.root(c.buyer), DATE) === 0
          if (reprice) c.price = price
          if ((reprice || name !== undefined) && this.printed(c)) c.reprint = true
        }
        if (stock !== undefined) {
          const added = stock - p.stock
          p.stock = stock
          if (added > 0) {
            this.unconflict(s, no)
            for (let i = 0; i < added && s.waitlist.length > 0; i++) this.confirm(s.waitlist.shift() as MClaim, s, no)
          }
        }
        this.settle(s)
        return
      }
      case 'product.renumber': {
        const from = e.from as number
        const to = e.to as number
        const a = this.slots.get(from)
        if (from === to || !a?.product || this.slots.get(to)?.product) return
        for (const c of [...a.winners]) {
          this.unconfirm(c, a)
          this.end(c, from, 'REJECTED', 'RENUMBERED')
        }
        for (const c of a.waitlist) this.end(c, from, 'REJECTED', 'RENUMBERED')
        a.waitlist = []
        if (a.conflict) this.end(a.conflict, from, 'REJECTED', 'RENUMBERED')
        a.conflict = null
        a.awaiting = false
        const b = this.slot(to)
        b.product = a.product
        b.version = a.version
        a.product = null
        a.version = 0
        if (b.product.phase === 'SELLING') this.openPending(b, to)
        return
      }
      case 'chat': {
        const id = e.id as string
        if (this.messages.has(id)) return
        const ch = e.ch as string
        const ignored = e.owner === true && this.set['claim.ignoreOwner']
        const published = (e.publishedAt as number | undefined) ?? at
        const message = { ch, seq, at, published, ignored, claimed: new Set<number>() }
        this.messages.set(id, message)
        if (ignored) return
        const nick = e.nick as string
        if (!this.buyers.has(ch)) this.newBuyer(ch, 'youtube', nick, null)
        else this.rename(ch, nick)
        const parsed = parseChat(e.text as string, this.set)
        for (const n of parsed.claims) if (this.make(n, ch, 'chat', seq, at, published)) message.claimed.add(n)
        for (const n of parsed.cancels) {
          const mode = this.set['cancel.buyerChat']
          if (mode === 'OFF') continue
          const c = this.activeOf(n, ch)
          if (!c) continue
          if (mode === 'AUTO' && !this.isLocked(c)) this.release(c, n, 'CANCELLED', null)
          else if (c.request === null) c.request = seq
        }
        return
      }
      case 'sms': {
        const ref = e.ref as string
        if (this.refs.has(ref)) return
        const memo = typeof e.memo === 'string' ? e.memo.trim() : ''
        const display = memo === '' ? null : `문자찜(${memo})`
        let who: string
        if (buyer !== undefined) {
          if (!this.buyers.has(buyer)) return
          who = buyer
        } else {
          const phone = typeof e.phone === 'string' ? phoneOf(e.phone) : null
          const linked = phone === null ? undefined : this.phones.get(phone)
          if (linked !== undefined) who = linked
          else {
            who = `sms:${ref}`
            this.newBuyer(who, 'sms', display ?? '문자찜', phone)
            if (phone !== null) this.phones.set(phone, who)
          }
        }
        this.refs.add(ref)
        if (display !== null && this.buyers.get(who)?.kind === 'sms') this.rename(who, display)
        const r = receivedAt(e.received as string, at)
        this.make(no, who, 'sms', seq, at, r.time, r.minute)
        return
      }
      case 'host.cancel':
      case 'host.reject': {
        const c = this.activeOf(no, buyer)
        if (c) this.release(c, no, e.type === 'host.reject' ? 'REJECTED' : 'CANCELLED', e.type === 'host.reject' ? 'BY_HOST' : null)
        return
      }
      case 'host.promote': {
        const s = this.slots.get(no)
        const c = this.activeOf(no, buyer)
        if (!s?.product || c?.status !== 'WAITLISTED' || s.winners.length >= s.product.stock) return
        drop(s.waitlist, c)
        this.confirm(c, s, no)
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
        else this.release(c, no, 'CANCELLED', null)
        return
      }
      case 'host.reopen': {
        const s = this.slots.get(no)
        if (s?.awaiting) this.clear(s, no)
        return
      }
      case 'host.assign': {
        const s = this.slots.get(no)
        const p = s?.product
        if (!s || !p || p.phase !== 'SELLING' || !this.buyers.has(buyer)) return
        const replace = e.replace as string | undefined
        const to = e.replaceTo as string | undefined
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
        } else c = this.newClaim(no, buyer, 'assign', seq, at)
        if (target) {
          this.unconfirm(target, s)
          if (to === 'CANCEL') this.end(target, no, 'CANCELLED', null)
        }
        this.confirm(c, s, no)
        if (target && to === 'WAITLIST') this.displace(target, s, no)
        this.trim(s, no)
        this.settle(s)
        return
      }
      case 'host.resolveConflict': {
        const s = this.slots.get(no)
        if (!s?.conflict) return
        if (e.decision === 'KEEP') this.unconflict(s, no)
        else {
          const c = s.conflict
          s.conflict = null
          const w = this.lastWinner(s)
          this.unconfirm(w, s)
          this.confirm(c, s, no)
          this.displace(w, s, no)
        }
        this.settle(s)
        return
      }
      case 'host.convertMessage': {
        const m = this.messages.get(e.msg as string)
        if (!m || m.ignored || m.claimed.has(no)) return
        if (this.make(no, m.ch, 'convert', m.seq, m.at, m.published)) m.claimed.add(no)
        return
      }
      case 'host.blockBuyer': {
        if (this.blocked.has(buyer)) return
        this.blocked.add(buyer)
        for (const c of this.claims.filter((x) => x.buyer === buyer && (x.status === 'WAITLISTED' || x.status === 'PENDING' || x.status === 'CONFLICT'))) {
          const cur = this.currentNo(c)
          const s = this.slot(cur)
          this.detach(c, s)
          this.end(c, cur, 'REJECTED', 'BLOCKED')
          this.settle(s)
        }
        return
      }
      case 'host.unblockBuyer':
        this.blocked.delete(buyer)
        return
      case 'buyer.merge': {
        const from = e.from as string
        const into = e.into as string
        const fb = this.buyers.get(from)
        if (!fb || !this.buyers.has(into) || from === into || fb.parent !== null || this.root(into) === from) return
        const target = this.root(into)
        const pairs: [MClaim, MClaim, number][] = []
        for (const [n, s] of this.slots) {
          const all = [...s.winners, ...s.waitlist, ...s.pending, ...(s.conflict ? [s.conflict] : [])]
          const mine = all.find((c) => this.root(c.buyer) === from)
          const theirs = all.find((c) => this.root(c.buyer) === target)
          if (mine && theirs) {
            if (mine.status === 'CONFIRMED' && theirs.status === 'CONFIRMED') return
            pairs.push([mine, theirs, n])
          }
        }
        fb.parent = into
        ;(this.buyers.get(into) as MBuyer).children.push(from)
        const rank: Record<string, number> = { CONFIRMED: 0, CONFLICT: 1, WAITLISTED: 2, PENDING: 3 }
        for (const [a, b, n] of pairs) {
          const s = this.slot(n)
          const ra = rank[a.status] as number
          const rb = rank[b.status] as number
          let keepA: boolean
          if (ra !== rb) keepA = ra < rb
          else if (a.status === 'WAITLISTED') keepA = s.waitlist.indexOf(a) < s.waitlist.indexOf(b)
          else keepA = this.ahead(a, b)
          const gone = keepA ? b : a
          this.detach(gone, s)
          Object.assign(gone, { status: 'DUPLICATE', reason: null, request: null })
          this.settle(s)
        }
        return
      }
      case 'buyer.unmerge': {
        const from = e.from as string
        const fb = this.buyers.get(from)
        if (!fb || fb.parent === null) return
        const whole = new Set(this.members(this.root(from)))
        const part = new Set(this.members(from))
        const dates = new Set(this.ledger.filter((x) => whole.has(x.buyer)).map((x) => x.date))
        const sum = (who: Set<string>, date: string): number =>
          this.ledger.filter((x) => who.has(x.buyer) && x.date === date).reduce((t, x) => t + (x.kind === 'payment' ? (x.amount as number) : x.kind === 'refund' ? -(x.amount as number) : 0), 0)
        for (const date of dates) {
          const split = sum(part, date)
          if (split < 0 || sum(whole, date) - split < 0) return
        }
        const parent = this.buyers.get(fb.parent) as MBuyer
        drop(parent.children, from)
        fb.parent = null
        return
      }
      case 'settlement.shippingOverride':
      case 'settlement.adjust':
      case 'settlement.payment':
      case 'settlement.refund': {
        if (!this.buyers.has(buyer)) return
        const kind = (e.type as string).slice('settlement.'.length)
        const amount = (e.amount as number | undefined) ?? null
        if (kind === 'refund' && this.received(this.root(buyer), e.date as string) < (amount as number)) return
        this.ledger.push({ buyer, date: e.date as string, kind: kind === 'shippingOverride' ? 'shipping' : (kind as MEntry['kind']), amount, mode: (e.mode as string | undefined) ?? null, seq })
        return
      }
      case 'effect.labelPrinted':
      case 'effect.thanksSent': {
        const kind = e.type === 'effect.labelPrinted' ? 'PRINT_PRODUCT_LABEL' : 'POST_THANKS'
        const ef = this.effects.find((x) => x.id === e.effectId)
        if (!ef || ef.kind !== kind || ef.status === 'DONE') return
        const was = ef.status
        ef.status = 'DONE'
        if (was === 'PENDING') {
          if (ef.claim.status === 'CONFIRMED' && ef.claim.version === ef.version) ef.claim.locked = true
        } else if (kind === 'PRINT_PRODUCT_LABEL') this.emit(ef.claim, 'VOID_LABEL', null, ef.version, null, ef.no)
        return
      }
    }
  }

  /** 찜의 지금 번호: 상품에 붙은 찜은 그 상품의 지금 번호, 아니면 생긴 번호 */
  currentNo(c: MClaim): number {
    if (c.pid !== null) for (const [n, s] of this.slots) if (s.product?.id === c.pid) return n
    return c.no
  }

  view(): unknown {
    const products = [...this.slots.entries()]
      .filter(([, s]) => s.product !== null)
      .sort(([a], [b]) => a - b)
      .map(([no, s]) => {
        const p = s.product as MProduct
        return {
          no,
          name: p.name,
          price: p.price,
          stock: p.stock,
          status: p.phase !== 'SELLING' ? p.phase : s.winners.length >= p.stock ? 'SOLD' : 'OPEN',
          winners: s.winners.map((c) => this.root(c.buyer)),
          waitlist: s.waitlist.map((c) => this.root(c.buyer)),
          awaiting: s.awaiting,
          conflict: s.conflict === null ? null : this.root(s.conflict.buyer),
          version: s.version,
        }
      })
    const claims = this.claims.map((c) => [
      c.id,
      this.currentNo(c),
      c.buyer,
      this.root(c.buyer),
      c.origin,
      c.status,
      c.reason,
      c.price,
      c.version,
      this.isLocked(c),
      c.request !== null && active(c.status),
      c.status === 'CONFIRMED' && c.reprint,
    ])
    const effects = this.effects.map((x) => [x.id, x.status, x.text, `b1/${String(x.no)}`])
    const requests = this.claims
      .filter((c) => c.request !== null && active(c.status))
      .sort((a, b) => (a.request as number) - (b.request as number))
      .map((c) => [this.currentNo(c), c.buyer])
    const buyers = [...this.buyers.entries()].map(([id, b]) => {
      const members = new Set(this.members(id))
      return [id, b.kind, b.display, b.names, this.root(id), this.claims.filter((c) => members.has(c.buyer) && c.status === 'CONFIRMED').reduce((sum, c) => sum + (c.price ?? 0), 0), b.phone === null ? null : b.phone.slice(-4)]
    })
    // 정산 묶음 (R-12): 품목이나 기록이 있는 (지금의 구매자, 날짜)
    const keys = new Set<string>()
    for (const c of this.claims) if (c.status === 'CONFIRMED') keys.add(JSON.stringify([this.root(c.buyer), DATE]))
    for (const x of this.ledger) keys.add(JSON.stringify([this.root(x.buyer), x.date]))
    const settlements = [...keys]
      .map((key) => {
        const [root, date] = JSON.parse(key) as [string, string]
        const members = new Set(this.members(root))
        const items = date === DATE ? this.claims.filter((c) => c.status === 'CONFIRMED' && members.has(c.buyer)) : []
        const subtotal = items.reduce((s, c) => s + (c.price as number), 0)
        const entries = this.ledger.filter((x) => members.has(x.buyer) && x.date === date)
        const ship = entries.filter((x) => x.kind === 'shipping').at(-1)
        const override = ship === undefined || ship.mode === 'DEFAULT' ? null : ship
        const threshold = this.set['shipping.freeThreshold']
        let shipping = this.set['shipping.baseFee']
        if (items.length === 0 || override?.mode === 'PICKUP' || override?.mode === 'COMBINED') shipping = 0
        else if (override?.mode === 'FIXED') shipping = override.amount as number
        else if (threshold !== null && subtotal >= threshold) shipping = 0
        const adjustments = items.length === 0 ? 0 : entries.filter((x) => x.kind === 'adjust').reduce((s, x) => s + (x.amount as number), 0)
        const total = items.length === 0 ? 0 : Math.max(0, subtotal + shipping + adjustments)
        const received = this.received(root, date)
        const payment = received === 0 ? 'UNPAID' : received < total ? 'PARTIAL' : received === total ? 'PAID' : 'OVERPAID'
        return [root, date, items.length, subtotal, shipping, adjustments, total, received, payment === 'OVERPAID' ? received - total : 0, payment]
      })
      .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1))
    return { products, claims, effects, requests, buyers, settlements }
  }
}

function engineView(state: EngineState): unknown {
  return {
    products: listProducts(state).map((p) => ({
      no: p.no,
      name: p.name,
      price: p.price,
      stock: p.stock,
      status: p.status,
      winners: p.winners,
      waitlist: p.waitlist,
      awaiting: p.awaitingSuccession,
      conflict: p.conflictBuyer,
      version: p.confirmVersion,
    })),
    claims: listClaims(state).map((c) => [c.id, c.no, c.buyer, c.currentBuyer, c.origin, c.status, c.reason, c.price, c.confirmVersion, c.locked, c.cancelRequested, c.reprintNeeded]),
    effects: listEffects(state).map((x) => [x.id, x.status, x.text, x.product]),
    requests: listCancelRequests(state).map((r) => [Number(r.product.split('/')[1]), r.buyer]),
    buyers: listBuyers(state).map((b) => [b.id, b.kind, b.display, b.nameHistory, b.current, b.subtotal, b.phoneLast4]),
    settlements: listSettlements(state)
      .map((s) => [s.buyer, s.date, s.items.length, s.subtotal, s.shipping, s.adjustments, s.total, s.received, s.refundDue, s.payment])
      .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)),
  }
}

// ── 무작위 로그 ──────────────────────────────────────────────────────────

const CH = ['A', 'B', 'C', 'D', 'OWNER'] as const
const NO = [1, 2, 3] as const
const PHONES = ['010-1234-5678', '01012345678', '０１０ ９９９９ ８８８８', '5678', '+82 10-1234-5678', '010-9999-8888'] as const
const MEMOS = ['길동', '  ', '이모'] as const

type Raw = { kind: string; a: number; b: number; c: number; d: number }
const rawArb: fc.Arbitrary<Raw> = fc.record({
  kind: fc.constantFrom(
    ...(['register', 'cmd', 'chat', 'chat', 'chat', 'chat', 'chat', 'sms', 'sms', 'sms', 'host', 'host', 'host', 'assign', 'block', 'report', 'report', 'update', 'update', 'renumber', 'convert', 'convert', 'resolve', 'merge', 'merge', 'unmerge', 'ledger', 'ledger'] as const),
  ),
  a: fc.nat(1000),
  b: fc.nat(1000),
  c: fc.nat(1000),
  d: fc.nat(1000),
})

const settingsArb: fc.Arbitrary<SettingsOverride> = fc.record({
  'contention.policy': fc.constantFrom('ARRIVAL', 'ARRIVAL', 'RECEIVED_TIME'),
  'contention.sameMinuteTieBreaker': fc.constantFrom('YOUTUBE', 'SMS', 'HOST'),
  'waitlist.max': fc.integer({ min: 0, max: 3 }),
  'cancel.succession': fc.constantFrom('AUTO', 'AUTO', 'ASK', 'REOPEN'),
  'cancel.buyerChat': fc.constantFrom('OFF', 'REQUEST', 'AUTO'),
  'claim.preOpenWindowSec': fc.integer({ min: 0, max: 4 }),
  'claim.ignoreOwner': fc.boolean(),
  'print.autoOnConfirm': fc.boolean(),
  'thanks.liveChat': fc.boolean(),
  'thanks.videoComment': fc.constantFrom('OFF', 'PER_SALE'),
  'shipping.freeThreshold': fc.constantFrom(null, 15000),
})

const pad = (n: number): string => String(n).padStart(2, '0')
/** at에서 offset만큼 떨어진 KST 시각 문자열 */
function clockOf(ms: number, seconds: boolean): string {
  const t = (((ms + KST) % DAY) + DAY) % DAY
  const h = Math.floor(t / 3_600_000)
  const m = Math.floor((t % 3_600_000) / 60_000)
  const sec = Math.floor((t % 60_000) / 1000)
  return seconds ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(h)}:${pad(m)}`
}

function materialize(raw: Raw, model: Model, sent: readonly string[], i: number): Ev {
  const { a, b, c, d } = raw
  const known = [...model.buyers.keys()]
  const who = (n: number): string => (known.length === 0 || n % 7 === 6 ? 'ZZ' : (known[n % known.length] as string))
  const no = NO[a % NO.length] as number
  switch (raw.kind) {
    case 'register':
      return { type: 'product.register', b: 'b1', no, name: '핑크프릴', price: [0, 8000, 10000][b % 3] as number, stock: 1 + (c % 3), status: d % 3 === 0 ? 'READY' : 'OPEN' }
    case 'cmd':
      return { type: ['product.open', 'product.hold', 'product.close'][b % 3] as string, b: 'b1', no }
    case 'chat': {
      const again = d % 5 === 0 && sent.length > 0
      const ch = CH[b % CH.length] as string
      return { type: 'chat', b: 'b1', id: again ? (sent[c % sent.length] as string) : `m${String(i)}`, ch, nick: ['하나', '둘'][c % 2] as string, text: ['1', '2', '3', '1 취소', '2 취소', '1 2', '안녕', '십오번이요'][a % 8] as string, owner: ch === 'OWNER', publishedAt: T0 + i * 1000 - (d % 7) * 9000 }
    }
    case 'sms': {
      const f: Record<string, unknown> = { type: 'sms', b: 'b1', ref: `r${String(b % 12)}`, no, received: clockOf(T0 + i * 1000 - (a % 13) * 7000, c % 3 === 0) }
      if (c % 4 !== 0) f.phone = PHONES[c % PHONES.length]
      if (d % 4 !== 0) f.memo = MEMOS[d % MEMOS.length]
      if (d % 5 === 0) f.buyer = who(c)
      return f as Ev
    }
    case 'host':
      return { type: ['host.cancel', 'host.cancel', 'host.reject', 'host.promote', 'host.confirm', 'host.approveCancel', 'host.dismissCancel', 'host.reopen'][b % 8] as string, b: 'b1', no, buyer: who(c), reason: '사유' }
    case 'assign': {
      const f: Record<string, unknown> = { type: 'host.assign', b: 'b1', no, buyer: who(b), reason: '사유' }
      if (c % 2 === 0) {
        const winner = model.slots.get(no)?.winners[d % 3]
        f.replace = winner === undefined ? who(d) : winner.buyer
        f.replaceTo = d % 2 === 0 ? 'WAITLIST' : 'CANCEL'
      }
      return f as Ev
    }
    case 'block':
      return { type: b % 3 === 0 ? 'host.unblockBuyer' : 'host.blockBuyer', buyer: who(c), reason: '사유' }
    case 'report': {
      const kind = b % 2 === 0 ? 'PRINT_PRODUCT_LABEL' : 'POST_THANKS'
      const mine = model.effects.filter((x) => x.kind === kind)
      return { type: kind === 'PRINT_PRODUCT_LABEL' ? 'effect.labelPrinted' : 'effect.thanksSent', effectId: mine.length === 0 ? 'none' : (mine[c % mine.length] as MEffect).id }
    }
    case 'update': {
      const f: Record<string, unknown> = { type: 'product.update', b: 'b1', no }
      if (b % 3 !== 0) f.price = [0, 8000, 12000][c % 3]
      if (b % 3 !== 1) f.stock = 1 + (d % 4)
      if (c % 4 === 0) f.name = ['핑크프릴', '라울'][d % 2]
      if (d % 2 === 0) f.applyTo = 'UNPAID_CLAIMS'
      return f as Ev
    }
    case 'renumber':
      return { type: 'product.renumber', b: 'b1', from: 1 + (b % 4), to: 1 + (c % 4) }
    case 'convert':
      return { type: 'host.convertMessage', b: 'b1', msg: sent.length === 0 ? 'none' : (sent[b % sent.length] as string), no }
    case 'resolve':
      return { type: 'host.resolveConflict', b: 'b1', no, decision: b % 2 === 0 ? 'KEEP' : 'SWITCH' }
    case 'merge':
      return { type: 'buyer.merge', from: who(b), into: who(c), reason: '같은 사람' }
    case 'unmerge':
      return { type: 'buyer.unmerge', from: who(b), reason: '다른 사람' }
    default: {
      const date = d % 4 === 0 ? '2026-10-19' : DATE
      const buyer = who(b)
      const amount = [1000, 4000, 10000, 14000][c % 4] as number
      switch (a % 4) {
        case 0:
          return { type: 'settlement.payment', buyer, date, amount }
        case 1:
          return { type: 'settlement.refund', buyer, date, amount, reason: '환불' }
        case 2:
          return { type: 'settlement.adjust', buyer, date, amount: -amount, reason: '할인' }
        default: {
          const mode = ['PICKUP', 'COMBINED', 'FIXED', 'DEFAULT'][c % 4] as string
          return { type: 'settlement.shippingOverride', buyer, date, mode, ...(mode === 'FIXED' ? { amount: 3000 } : {}) }
        }
      }
    }
  }
}

function run(settings: SettingsOverride, raws: readonly Raw[]): void {
  let state = initEngine({ broadcasts: [B1], settings })
  const model = new Model(settings)
  const sent: string[] = []
  const log: Ev[] = []
  raws.forEach((raw, i) => {
    const event = materialize(raw, model, sent, i)
    if (event.type === 'chat') sent.push(event.id as string)
    log.push(event)
    const at = T0 + i * 1000
    state = apply(state, event, i + 1, at).state
    model.apply(event, i + 1, at)
    expect(engineView(state), `이벤트 ${String(i + 1)}: ${JSON.stringify(event)}\n설정 ${JSON.stringify(settings)}\n로그 ${JSON.stringify(log)}`).toEqual(model.view())
  })
}

describe('S03 참조 모델 대조 (ARRIVAL)', () => {
  it('규칙 문장대로의 모델과 엔진이 매 이벤트 뒤 같은 상품·찜·효과·요청·구매자·정산을 보여 준다', () => {
    fc.assert(
      fc.property(settingsArb, fc.array(rawArb, { minLength: 5, maxLength: 120, size: 'max' }), (settings, raws) => {
        run(settings, raws)
      }),
      { numRuns: 300, seed: 20261020 },
    )
  }, 60_000)
})
