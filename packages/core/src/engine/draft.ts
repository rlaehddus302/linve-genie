// 이벤트 하나를 처리하는 동안 쓰는 작업 사본 (AC-S02-02).
// - 넘겨받은 상태는 절대 바꾸지 않는다. 고칠 레코드는 처음 쓸 때 얕게 복사하고(배열·기록은 새로),
//   끝에 바뀐 레코드만 영속 맵에 넣어 새 상태를 만든다. 바뀐 것이 없으면 넘겨받은 상태를 그대로 돌려준다.
// - 깊게 얼린 상태를 넘겨도 읽기만 하므로 예외가 나지 않는다.
import { pdelete, pget, phas, pset } from './pmap.ts'
import type { BuyerRecord, ClaimRecord, EffectRecord, EngineEffect, EngineState, ProductRecord, SlotRecord } from './types.ts'

export interface SlotDraft {
  key: string
  b: string
  no: number
  product: ProductRecord | null
  winners: string[]
  waitlist: string[]
  pending: string[]
  active: Record<string, string>
  awaiting: boolean
  version: number
}

export interface ClaimDraft extends Omit<ClaimRecord, 'status' | 'reason' | 'price' | 'version' | 'locked' | 'request' | 'effects'> {
  status: ClaimRecord['status']
  reason: ClaimRecord['reason']
  price: ClaimRecord['price']
  version: ClaimRecord['version']
  locked: boolean
  request: number | null
  effects: string[]
}

export interface BuyerDraft extends Omit<BuyerRecord, 'display' | 'names' | 'claims' | 'subtotal'> {
  display: string
  names: string[]
  claims: string[]
  subtotal: number
}

export interface EffectDraft extends Omit<EffectRecord, 'status'> {
  status: EffectRecord['status']
}

/**
 * 상태가 손상되었다(서로 가리키는 기록이 없다). 엔진이 만든 상태에서는 생기지 않는다.
 * 저장된 스냅샷이 망가졌을 때 조용히 틀린 판정을 이어 가지 않고 멈추게 한다(S04 재생 무결성 검사).
 */
export class CorruptStateError extends Error {
  constructor(what: string) {
    super(`판정 엔진 상태가 손상되었다: ${what}`)
    this.name = 'CorruptStateError'
  }
}

/** 신뢰할 수 없는 문자열 키(`__proto__` 등)도 자기 속성으로만 읽고 쓴다 */
export function ownGet<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

export function ownSet<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, { value, writable: true, enumerable: true, configurable: true })
}

export function slotKey(b: string, no: number): string {
  return `${b}/${String(no)}`
}

export function messageKey(b: string, id: string): string {
  return JSON.stringify([b, id])
}

export class Draft {
  readonly base: EngineState
  private readonly slots = new Map<string, SlotDraft>()
  private readonly claims = new Map<string, ClaimDraft>()
  private readonly buyers = new Map<string, BuyerDraft>()
  private readonly effects = new Map<string, EffectDraft>()
  private readonly messages: string[] = []
  private readonly blockedChanges = new Map<string, boolean>()
  private readonly counters: { claims: number; effects: number; buyers: number }
  readonly emitted: EngineEffect[] = []
  /** 처리 중인 이벤트의 seq·at */
  readonly seq: number
  readonly at: number

  constructor(base: EngineState, event: { readonly seq: number; readonly at: number }) {
    this.base = base
    this.counters = { ...base.counters }
    this.seq = event.seq
    this.at = event.at
  }

  get settings(): EngineState['settings'] {
    return this.base.settings
  }

  // ── 읽기 (복사 없음) ────────────────────────────────────────────────────

  readSlot(key: string): SlotRecord | undefined {
    return this.slots.get(key) ?? pget(this.base.slots, key)
  }

  readClaim(id: string): ClaimRecord | undefined {
    return this.claims.get(id) ?? pget(this.base.claims, id)
  }

  readBuyer(id: string): BuyerRecord | undefined {
    return this.buyers.get(id) ?? pget(this.base.buyers, id)
  }

  readEffect(id: string): EffectRecord | undefined {
    return this.effects.get(id) ?? pget(this.base.effects, id)
  }

  hasMessage(key: string): boolean {
    return this.messages.includes(key) || phas(this.base.messages, key)
  }

  isBlocked(buyer: string): boolean {
    return this.blockedChanges.get(buyer) ?? phas(this.base.blocked, buyer)
  }

  // ── 쓰기 (처음 쓸 때 복사) ──────────────────────────────────────────────

  /** 번호의 작업 사본. 없으면 상품 없는 빈 번호를 만든다 */
  slot(b: string, no: number): SlotDraft {
    const key = slotKey(b, no)
    const draft = this.slots.get(key)
    if (draft !== undefined) return draft
    const base = pget(this.base.slots, key)
    const created: SlotDraft =
      base === undefined
        ? { key, b, no, product: null, winners: [], waitlist: [], pending: [], active: {}, awaiting: false, version: 0 }
        : { ...base, winners: [...base.winners], waitlist: [...base.waitlist], pending: [...base.pending], active: { ...base.active } }
    this.slots.set(key, created)
    return created
  }

  /** 있는 찜의 작업 사본 */
  claim(id: string): ClaimDraft {
    const draft = this.claims.get(id)
    if (draft !== undefined) return draft
    const base = pget(this.base.claims, id)
    if (base === undefined) throw new CorruptStateError(`찜 ${id}가 없다`)
    const created: ClaimDraft = { ...base, effects: [...base.effects] }
    this.claims.set(id, created)
    return created
  }

  newClaim(fields: Omit<ClaimDraft, 'id' | 'n'>): ClaimDraft {
    const n = ++this.counters.claims
    const created: ClaimDraft = { id: `c${String(n)}`, n, ...fields }
    this.claims.set(created.id, created)
    this.knownBuyer(fields.buyer).claims.push(created.id)
    return created
  }

  /** 있는 구매자의 작업 사본 (모르는 구매자면 undefined) */
  buyer(id: string): BuyerDraft | undefined {
    const draft = this.buyers.get(id)
    if (draft !== undefined) return draft
    const base = pget(this.base.buyers, id)
    if (base === undefined) return undefined
    const created: BuyerDraft = { ...base, names: [...base.names], claims: [...base.claims] }
    this.buyers.set(id, created)
    return created
  }

  /** 기록이 있어야 하는 구매자(찜의 주인)의 작업 사본 */
  knownBuyer(id: string): BuyerDraft {
    const draft = this.buyer(id)
    if (draft === undefined) throw new CorruptStateError(`구매자 ${id}가 없다`)
    return draft
  }

  newBuyer(id: string, nick: string): BuyerDraft {
    const created: BuyerDraft = { id, n: ++this.counters.buyers, display: nick, names: [nick], claims: [], subtotal: 0 }
    this.buyers.set(id, created)
    return created
  }

  /** 읽은 효과의 작업 사본 (readEffect로 찾은 기록을 넘긴다) */
  effect(record: EffectRecord): EffectDraft {
    const draft = this.effects.get(record.id)
    if (draft !== undefined) return draft
    const created: EffectDraft = { ...record }
    this.effects.set(record.id, created)
    return created
  }

  newEffect(fields: Omit<EffectDraft, 'n'>): EffectDraft {
    const created: EffectDraft = { ...fields, n: ++this.counters.effects }
    this.effects.set(created.id, created)
    this.emitted.push({
      id: created.id,
      kind: created.kind,
      target: created.target,
      claim: created.claim,
      product: created.key,
      broadcast: created.b,
      no: created.no,
      buyer: created.buyer,
      text: created.text,
      confirmVersion: created.version,
    })
    return created
  }

  addMessage(key: string): void {
    this.messages.push(key)
  }

  setBlocked(buyer: string, blocked: boolean): void {
    this.blockedChanges.set(buyer, blocked)
  }

  // ── 반영 ────────────────────────────────────────────────────────────────

  commit(): { state: EngineState; effects: EngineEffect[] } {
    const base = this.base
    const changed = this.slots.size + this.claims.size + this.buyers.size + this.effects.size + this.messages.length + this.blockedChanges.size > 0
    if (!changed) return { state: base, effects: [] }
    let { slots, claims, buyers, effects, messages, blocked } = base
    for (const [key, value] of this.slots) slots = pset(slots, key, value)
    for (const [key, value] of this.claims) claims = pset(claims, key, value)
    for (const [key, value] of this.buyers) buyers = pset(buyers, key, value)
    for (const [key, value] of this.effects) effects = pset(effects, key, value)
    for (const key of this.messages) messages = pset(messages, key, true)
    for (const [key, value] of this.blockedChanges) blocked = value ? pset(blocked, key, true) : pdelete(blocked, key)
    return {
      state: { ...base, counters: { ...this.counters }, messages, buyers, blocked, slots, claims, effects },
      effects: this.emitted,
    }
  }
}
