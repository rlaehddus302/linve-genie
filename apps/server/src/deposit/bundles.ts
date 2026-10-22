// 후보 묶음과 이름 후보 모으기 (DEPOSIT_RULES DP-4, D-N3-02·D-N3-03, AC-N3-21·23·33), 구매자 이름 표기 (BUY-01 "이름 표기", D-098).
// 값은 모두 코어 조회 함수(listSettlements·listBuyers·listClaims·getSettlement·applyEvent)의 결과다 — 정산·판정을 다시 계산하지 않는다.
// 범위 상태 하나의 조회 결과는 그 상태에 묶어 둔다(WeakMap — 상태가 버려지면 함께 사라진다).
import {
  applyEvent,
  getSettlement,
  listBuyers,
  listClaims,
  listSettlements,
  type BuyerInfo,
  type ClaimInfo,
  type EngineState,
  type PaymentStatus,
  type SettlementInfo,
} from '@livejjim/core'
import { kstTime } from '../time.ts'

/** 범위 상태 하나에서 읽은 것 */
interface StateFacts {
  readonly buyers: ReadonlyMap<string, BuyerInfo>
  readonly settlements: readonly SettlementInfo[]
  /** 지금의 구매자 → 확정 찜 at 중 가장 이른 것 (판매 시각) */
  readonly saleAt: ReadonlyMap<string, number>
  readonly claims: readonly ClaimInfo[]
  labels: ReadonlyMap<string, string> | null
}

const factsCache = new WeakMap<EngineState, StateFacts>()

function factsOf(state: EngineState): StateFacts {
  const cached = factsCache.get(state)
  if (cached !== undefined) return cached
  const buyers = new Map(listBuyers(state).map((buyer) => [buyer.id, buyer]))
  const claims = listClaims(state)
  const saleAt = new Map<string, number>()
  for (const claim of claims) {
    if (claim.status !== 'CONFIRMED') continue
    const seen = saleAt.get(claim.currentBuyer)
    if (seen === undefined || claim.at < seen) saleAt.set(claim.currentBuyer, claim.at)
  }
  const facts: StateFacts = { buyers, settlements: listSettlements(state), saleAt, claims, labels: null }
  factsCache.set(state, facts)
  return facts
}

/** 범위 상태와 그 seq·마지막 at (가정한 입금 기록으로 바뀔 입금 상태를 계산할 때 쓴다) */
export interface StateAt {
  readonly date: string
  readonly state: EngineState
  readonly seq: number
  readonly lastAt: number
}

/** 묶음 하나 (지금의 구매자, 날짜) */
export interface BundleFacts {
  /** 묶음 키 JSON.stringify([지금의 구매자, 날짜]) */
  readonly key: string
  readonly buyer: string
  readonly date: string
  /** 표시 이름 (BUY-01 이름 표기 — 그 날짜 범위의 규칙 그대로) */
  readonly label: string
  /** 지금의 구매자가 유튜브 구매자인지 */
  readonly youtube: boolean
  /** 지금의 구매자와 합쳐진 구매자 전부 */
  readonly members: readonly string[]
  /** 이름 후보 (정규화 전 글) — 기억한 입금자명 포함 */
  readonly names: readonly string[]
  readonly items: number
  readonly total: number
  readonly received: number
  readonly payment: PaymentStatus
  readonly refundDue: number
  /** 판매 시각 (품목이 없으면 null) */
  readonly saleAt: number | null
}

export const bundleKey = (buyer: string, date: string): string => JSON.stringify([buyer, date])

/** `문자찜(메모)` → 메모 (메모가 없는 `문자찜`이면 null) */
export function smsMemo(display: string): string | null {
  if (!display.startsWith('문자찜(') || !display.endsWith(')') || display.length <= '문자찜()'.length) return null
  return display.slice('문자찜('.length, -1)
}

/** 묶음 구성원(지금의 구매자 + 합쳐진 구매자 전부)의 이름 후보 (DP-4): 닉네임 이력 전부, 문자찜 메모, 유튜브 채널의 기억한 입금자명 */
export function nameCandidates(buyers: ReadonlyMap<string, BuyerInfo>, members: readonly string[], remembered: ReadonlyMap<string, readonly string[]>): string[] {
  const out: string[] = []
  for (const id of members) {
    const buyer = buyers.get(id)
    if (buyer === undefined) continue
    if (buyer.kind === 'youtube') {
      out.push(...buyer.nameHistory)
      out.push(...(remembered.get(id) ?? []))
    } else {
      for (const name of buyer.nameHistory) {
        const memo = smsMemo(name)
        if (memo !== null) out.push(memo)
      }
    }
  }
  return out
}

function settlementFacts(state: EngineState, facts: StateFacts, settlement: SettlementInfo, date: string, remembered: ReadonlyMap<string, readonly string[]>): BundleFacts {
  const root = facts.buyers.get(settlement.buyer)
  const members = root === undefined ? [settlement.buyer] : [root.id, ...root.merged]
  return {
    key: bundleKey(settlement.buyer, date),
    buyer: settlement.buyer,
    date,
    label: buyerLabel(state, settlement.buyer),
    youtube: root?.kind === 'youtube',
    members,
    names: nameCandidates(facts.buyers, members, remembered),
    items: settlement.items.length,
    total: settlement.total,
    received: settlement.received,
    payment: settlement.payment,
    refundDue: settlement.refundDue,
    saleAt: settlement.items.length > 0 ? (facts.saleAt.get(settlement.buyer) ?? null) : null,
  }
}

/** 범위 상태의 묶음 중 품목이나 받은 금액이 있는 것 (확정·묶음 찾기 대상 — DP-6). 맞추기 후보는 그중 품목이 있는 것 */
export function bundlesOf(at: StateAt, remembered: ReadonlyMap<string, readonly string[]>): BundleFacts[] {
  const facts = factsOf(at.state)
  return facts.settlements
    .filter((settlement) => settlement.date === at.date && (settlement.items.length > 0 || settlement.received !== 0))
    .map((settlement) => settlementFacts(at.state, facts, settlement, at.date, remembered))
}

/** 묶음 하나 (지금의 구매자로 푼다). 그 범위에 없거나 품목도 받은 금액도 없으면 null */
export function bundleOf(at: StateAt, buyer: string, remembered: ReadonlyMap<string, readonly string[]>): BundleFacts | null {
  const facts = factsOf(at.state)
  const settlement = getSettlement(at.state, buyer, at.date)
  if (!facts.buyers.has(settlement.buyer) || (settlement.items.length === 0 && settlement.received === 0)) return null
  return settlementFacts(at.state, facts, settlement, at.date, remembered)
}

export interface PaymentPreview {
  readonly payment: PaymentStatus
  readonly received: number
  readonly refundDue: number
}

/** 이 묶음에 금액만큼 입금을 적으면 바뀔 입금 상태 — 가정한 settlement.payment를 코어로 적용해 읽는다(상태는 바꾸지 않는다) */
export function previewPayment(at: StateAt, buyer: string, amount: number): PaymentPreview | null {
  try {
    const next = applyEvent(at.state, { type: 'settlement.payment', buyer, date: at.date, amount, seq: at.seq + 1, at: at.lastAt })
    const settlement = getSettlement(next.state, buyer, at.date)
    return { payment: settlement.payment, received: settlement.received, refundDue: settlement.refundDue }
  } catch {
    return null
  }
}

// ── 구매자 이름 표기 (BUY-01 AC2, D-098 — 화면 lib/derive.ts buyerLabels와 같은 규칙) ─────────

const NAME_JOIN = ' · '

/** 화면에서 같은 글자로 보이는지 견줄 모양 (호환 글자를 맞추고, 보이지 않는 글자를 빼고, 공백 여러 칸을 한 칸으로) */
function sameLook(label: string): string {
  return label
    .normalize('NFKC')
    .replace(/[\p{Cf}\u115F\u1160\u3164\uFFA0]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

function labelsOf(facts: StateFacts): ReadonlyMap<string, string> {
  if (facts.labels !== null) return facts.labels
  const counts = new Map<string, number>()
  for (const buyer of facts.buyers.values()) if (buyer.mergedInto === null) counts.set(buyer.display, (counts.get(buyer.display) ?? 0) + 1)
  const tagged = (buyer: BuyerInfo) => (counts.get(buyer.display) ?? 0) >= 2
  // 전화번호 없는 문자 구매자: 그 구매자 자신을 만든 문자찜(가장 앞 seq)의 받은 시각
  const firstSms = new Map<string, ClaimInfo>()
  for (const claim of facts.claims) {
    if (claim.origin !== 'sms') continue
    const seen = firstSms.get(claim.buyer)
    if (seen === undefined || claim.seq < seen.seq) firstSms.set(claim.buyer, claim)
  }
  const tagOf = (buyer: BuyerInfo): string => {
    if (buyer.kind === 'youtube') return `끝 ${buyer.id.slice(-4)}`
    if (buyer.phoneLast4 !== null) return `뒤 4자리 ${buyer.phoneLast4}`
    const claim = firstSms.get(buyer.id)
    if (claim === undefined) return '문자'
    const time = kstTime(claim.rankTime)
    return `문자 ${claim.rankMinute ? time.slice(0, 5) : time}`
  }
  const labels = new Map<string, string>()
  const taken = new Set<string>()
  const nextNo = new Map<string, number>()
  for (const buyer of facts.buyers.values()) {
    const base = tagged(buyer) ? `${buyer.display}${NAME_JOIN}${tagOf(buyer)}` : buyer.display
    const baseLook = sameLook(base)
    let label = base
    if (taken.has(baseLook)) {
      let n = nextNo.get(baseLook) ?? 2
      while (taken.has(sameLook(`${base}${NAME_JOIN}${String(n)}`))) n++
      nextNo.set(baseLook, n + 1)
      label = `${base}${NAME_JOIN}${String(n)}`
    }
    taken.add(sameLook(label))
    labels.set(buyer.id, label)
  }
  facts.labels = labels
  return labels
}

/** 그 범위의 구매자 이름 표기 (모르는 구매자면 "알 수 없는 구매자") */
export function buyerLabel(state: EngineState, buyer: string): string {
  return labelsOf(factsOf(state)).get(buyer) ?? '알 수 없는 구매자'
}

/** 그 범위의 구매자 (조회 결과) */
export function buyerInfoOf(state: EngineState, buyer: string): BuyerInfo | null {
  return factsOf(state).buyers.get(buyer) ?? null
}

/** 그 범위의 구매자 전부 (처음 기록된 순서) */
export function buyersOf(state: EngineState): readonly BuyerInfo[] {
  return [...factsOf(state).buyers.values()]
}
