// 이벤트 하나를 처리하는 동안 쓰는 작업 사본 (AC-S02-02, AC-S03-05).
// - 넘겨받은 상태는 절대 바꾸지 않는다. 고칠 레코드는 처음 쓸 때 얕게 복사하고, 끝에 바뀐 레코드만 영속 맵에 넣어 새 상태를 만든다.
//   바뀐 것이 없으면 넘겨받은 상태를 그대로 돌려준다.
// - 커질 수 있는 모음(번호의 보류 찜·활성 표시, 구매자의 찜)은 레코드 안에서도 영속 맵이라 복사할 때 통째로 복사하지 않는다.
//   통째로 복사하는 배열은 설정으로 크기가 정해지는 것(확정 ≤ 재고, 대기 ≤ 대기 한도)과 작은 이력뿐이다.
// - 깊게 얼린 상태를 넘겨도 읽기만 하므로 예외가 나지 않는다.
import { emptyPMap, pdelete, pget, phas, pkeys, pset, type PMap } from './pmap.ts'
import type {
  BuyerRecord,
  ClaimRecord,
  EffectRecord,
  EngineEffect,
  EngineState,
  LedgerRecord,
  MessageRecord,
  PriceChange,
  ProductRecord,
  SettlementEntry,
  SlotRecord,
} from './types.ts'

export interface SlotDraft {
  key: string
  b: string
  no: number
  product: ProductRecord | null
  winners: string[]
  waitlist: string[]
  pending: PMap<true>
  active: PMap<string>
  awaiting: boolean
  conflict: string | null
  version: number
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

export interface ClaimDraft extends Omit<Mutable<ClaimRecord>, 'effects' | 'priceHistory'> {
  effects: string[]
  priceHistory: PriceChange[]
}

export interface BuyerDraft extends Omit<Mutable<BuyerRecord>, 'id' | 'n' | 'kind' | 'names' | 'children' | 'dates'> {
  readonly id: string
  readonly n: number
  readonly kind: BuyerRecord['kind']
  names: string[]
  children: string[]
  dates: string[]
}

export interface EffectDraft extends Omit<EffectRecord, 'status'> {
  status: EffectRecord['status']
}

export interface MessageDraft extends Omit<MessageRecord, 'converted'> {
  converted: number[]
}

export interface LedgerDraft extends Omit<LedgerRecord, 'entries'> {
  entries: SettlementEntry[]
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

/** 신뢰할 수 없는 문자열 키(`__proto__` 등)도 자기 속성으로만 읽는다 */
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

export function ledgerKey(buyer: string, date: string): string {
  return JSON.stringify([buyer, date])
}

/** 찜 ID `c{n}`의 생성 순서 */
export function claimNumber(id: string): number {
  return Number(id.slice(1))
}

/** 합치기 연결이 이보다 깊으면 고리(손상된 상태)로 본다 */
const MAX_DEPTH = 100_000

/** 작업 사본 표에서 꺼내고, 없으면 만들어 넣는다 (한 이벤트에서 같은 기록은 사본 하나) */
function draftIn<D>(table: Map<string, D>, key: string, make: () => D): D {
  let draft = table.get(key)
  if (draft === undefined) {
    draft = make()
    table.set(key, draft)
  }
  return draft
}

export class Draft {
  readonly base: EngineState
  private readonly slots = new Map<string, SlotDraft>()
  private readonly claims = new Map<string, ClaimDraft>()
  private readonly buyers = new Map<string, BuyerDraft>()
  private readonly effects = new Map<string, EffectDraft>()
  private readonly messages = new Map<string, MessageDraft>()
  private readonly ledger = new Map<string, LedgerDraft>()
  private readonly refs = new Map<string, string | null>()
  private readonly phoneKeys = new Map<string, string>()
  private readonly productKeys = new Map<string, string>()
  private readonly blockedChanges = new Map<string, boolean>()
  private readonly counters: { claims: number; effects: number; buyers: number; products: number }
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

  readSlot(key: string): SlotRecord | SlotDraft | undefined {
    return this.slots.get(key) ?? pget(this.base.slots, key)
  }

  readClaim(id: string): ClaimRecord | ClaimDraft | undefined {
    return this.claims.get(id) ?? pget(this.base.claims, id)
  }

  readBuyer(id: string): BuyerRecord | BuyerDraft | undefined {
    return this.buyers.get(id) ?? pget(this.base.buyers, id)
  }

  readEffect(id: string): EffectRecord | undefined {
    return this.effects.get(id) ?? pget(this.base.effects, id)
  }

  readMessage(key: string): MessageRecord | MessageDraft | undefined {
    return this.messages.get(key) ?? pget(this.base.messages, key)
  }

  readLedger(buyer: string, date: string): LedgerRecord | LedgerDraft | undefined {
    const key = ledgerKey(buyer, date)
    return this.ledger.get(key) ?? pget(this.base.ledger, key)
  }

  /** 받은 ref면 그 문자찜이 정한 구매자(정하지 않았으면 null), 받지 않은 ref면 undefined */
  readRef(ref: string): string | null | undefined {
    return this.refs.has(ref) ? this.refs.get(ref) : pget(this.base.refs, ref)
  }

  /** 그 전화번호 키로 만든 문자 구매자 */
  readPhoneKey(key: string): string | undefined {
    return this.phoneKeys.get(key) ?? pget(this.base.phoneKeys, key)
  }

  isBlocked(buyer: string): boolean {
    return this.blockedChanges.get(buyer) ?? phas(this.base.blocked, buyer)
  }

  /** 지금의 구매자 = 합치기 연결을 끝까지 따라간 구매자 (모르는 구매자면 그 ID 그대로) */
  root(id: string): string {
    let current = id
    for (let depth = 0; depth < MAX_DEPTH; depth++) {
      const parent = this.readBuyer(current)?.parent ?? null
      if (parent === null) return current
      current = parent
    }
    throw new CorruptStateError(`구매자 ${id}의 합치기 연결이 고리다`)
  }

  /** 그 구매자와 그 아래에 합쳐진 구매자 전부 (자신 먼저, 합친 순서로 깊이 우선) */
  members(id: string): string[] {
    const out: string[] = []
    const stack = [id]
    while (stack.length > 0) {
      const current = stack.pop() as string
      out.push(current)
      if (out.length > MAX_DEPTH) throw new CorruptStateError(`구매자 ${id}의 합치기 연결이 고리다`)
      const children = this.readBuyer(current)?.children ?? []
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i] as string)
    }
    return out
  }

  /** 구매자 자신의 찜 ID, 생성 순서 */
  claimIdsOf(buyer: string): string[] {
    const record = this.readBuyer(buyer)
    return record === undefined ? [] : pkeys(record.claims).sort((a, b) => claimNumber(a) - claimNumber(b))
  }

  // ── 쓰기 (처음 쓸 때 복사) ──────────────────────────────────────────────

  /** 번호의 작업 사본. 없으면 상품 없는 빈 번호를 만든다 */
  slot(b: string, no: number): SlotDraft {
    const key = slotKey(b, no)
    return draftIn(this.slots, key, () => {
      const base = pget(this.base.slots, key)
      return base === undefined
        ? { key, b, no, product: null, winners: [], waitlist: [], pending: emptyPMap(), active: emptyPMap(), awaiting: false, conflict: null, version: 0 }
        : { ...base, winners: [...base.winners], waitlist: [...base.waitlist] }
    })
  }

  /** 있는 찜의 작업 사본 */
  claim(id: string): ClaimDraft {
    return draftIn(this.claims, id, () => {
      const base = pget(this.base.claims, id)
      if (base === undefined) throw new CorruptStateError(`찜 ${id}가 없다`)
      return { ...base, effects: [...base.effects], priceHistory: [...base.priceHistory] }
    })
  }

  newClaim(fields: Omit<ClaimDraft, 'id' | 'n'>): ClaimDraft {
    const n = ++this.counters.claims
    const created: ClaimDraft = { id: `c${String(n)}`, n, ...fields }
    this.claims.set(created.id, created)
    const owner = this.knownBuyer(fields.buyer)
    owner.claims = pset(owner.claims, created.id, true)
    return created
  }

  /** 기록이 있어야 하는 구매자(찜의 주인 등)의 작업 사본. 없으면 손상된 상태 */
  knownBuyer(id: string): BuyerDraft {
    return draftIn(this.buyers, id, () => {
      const base = pget(this.base.buyers, id)
      if (base === undefined) throw new CorruptStateError(`구매자 ${id}가 없다`)
      return { ...base, names: [...base.names], children: [...base.children], dates: [...base.dates] }
    })
  }

  newBuyer(id: string, kind: BuyerRecord['kind'], display: string, phoneLast4: string | null): BuyerDraft {
    const created: BuyerDraft = {
      id,
      n: ++this.counters.buyers,
      kind,
      display,
      names: [display],
      phoneLast4,
      parent: null,
      children: [],
      claims: emptyPMap(),
      dates: [],
      subtotal: 0,
    }
    this.buyers.set(id, created)
    return created
  }

  /** 읽은 효과의 작업 사본 (readEffect로 찾은 기록을 넘긴다) */
  effect(record: EffectRecord): EffectDraft {
    return draftIn(this.effects, record.id, () => ({ ...record }))
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

  /** 받은 메시지의 작업 사본 (readMessage로 있는 것을 확인한 메시지) */
  message(key: string): MessageDraft {
    return draftIn(this.messages, key, () => {
      const base = pget(this.base.messages, key) as MessageRecord
      return { ...base, converted: [...base.converted] }
    })
  }

  newMessage(key: string, fields: MessageDraft): void {
    this.messages.set(key, fields)
  }

  /** (구매자 자신, 날짜) 정산 기록의 작업 사본. 없으면 만든다 */
  ledgerOf(buyer: string, date: string): LedgerDraft {
    const key = ledgerKey(buyer, date)
    return draftIn(this.ledger, key, () => {
      const base = pget(this.base.ledger, key)
      return base === undefined ? { buyer, date, entries: [] } : { ...base, entries: [...base.entries] }
    })
  }

  setRef(ref: string, buyer: string | null): void {
    this.refs.set(ref, buyer)
  }

  setPhoneKey(key: string, buyer: string): void {
    this.phoneKeys.set(key, buyer)
  }

  newProductId(): string {
    return `p${String(++this.counters.products)}`
  }

  setProductKey(pid: string, key: string): void {
    this.productKeys.set(pid, key)
  }

  setBlocked(buyer: string, blocked: boolean): void {
    this.blockedChanges.set(buyer, blocked)
  }

  // ── 반영 ────────────────────────────────────────────────────────────────

  commit(): { state: EngineState; effects: EngineEffect[] } {
    const base = this.base
    const tables = [this.slots, this.claims, this.buyers, this.effects, this.messages, this.ledger, this.refs, this.phoneKeys, this.productKeys, this.blockedChanges]
    if (tables.every((table) => table.size === 0)) return { state: base, effects: [] }
    const put = <V>(map: PMap<V>, changes: ReadonlyMap<string, V>): PMap<V> => {
      let out = map
      for (const [key, value] of changes) out = pset(out, key, value)
      return out
    }
    let blocked = base.blocked
    for (const [key, value] of this.blockedChanges) blocked = value ? pset(blocked, key, true) : pdelete(blocked, key)
    return {
      state: {
        ...base,
        counters: { ...this.counters },
        messages: put<MessageRecord>(base.messages, this.messages),
        refs: put(base.refs, this.refs),
        phoneKeys: put(base.phoneKeys, this.phoneKeys),
        buyers: put<BuyerRecord>(base.buyers, this.buyers),
        blocked,
        slots: put<SlotRecord>(base.slots, this.slots),
        products: put(base.products, this.productKeys),
        claims: put<ClaimRecord>(base.claims, this.claims),
        effects: put<EffectRecord>(base.effects, this.effects),
        ledger: put<LedgerRecord>(base.ledger, this.ledger),
      },
      effects: this.emitted,
    }
  }
}
