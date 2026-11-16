import { formatWon, productTitle, saleSetSize } from '@livejjim/core/format'
import type { ScopeData } from './scope-data.ts'

export interface SaleLine {
  key: string
  no: number
  name: string
  variant: string | null
  qty: number
  amount: number | null
  /** 합친 라이브(D-MERGE-LIVE-01)에서 몇 차의 상품인지 ("1차") — 한 라이브 정산서면 없다. 번호는 라이브마다 다시 쓰여 같은 12번이 둘일 수 있다 */
  round?: string
}
/** 합친 라이브의 차례 이름: 그날 시작 순서로 "1차" · "2차" … */
export const roundWord = (index: number): string => `${String(index + 1)}차`
/** 번호 글: "12번" · 합친 라이브면 "1차 12번" */
export const lineNoWord = (line: { readonly no: number; readonly round?: string | undefined }): string => (line.round ? `${line.round} ${String(line.no)}번` : `${String(line.no)}번`)
export interface BuyerOrder {
  id: string
  lines: SaleLine[]
  qty: number
  subtotal: number | null
}
export const salesMoney = (amount: number | null) => amount === null ? '금액 확인 필요' : formatWon(amount)
/** 정산서 배송비 규칙 (D-RETRO-60): 받을지 · 금액 · 얼마 이상 무료. 금액은 정수 원 */
export interface StatementShipping {
  readonly charge: boolean
  readonly fee: number
  /** 상품 합계가 이 금액 이상이면 무료. 없으면 null */
  readonly freeFrom: number | null
}
/** 정산 정보 (GET·PUT /api/statement-info) — 빈 칸은 "" */
export interface StatementInfo {
  readonly bank: string
  readonly accountNumber: string
  readonly accountHolder: string
  readonly phone: string
  readonly hostName: string
  readonly shipping: StatementShipping
  /** 판매자가 한 번이라도 저장했나 — 거짓이면 처음 한 번 묻는다 */
  readonly decided: boolean
}
/** 정하지 않은 판매자의 배송비 (사용자 결정 2026-11-13): 5만 원 미만 5,000원, 5만 원 이상 무료 */
export const STATEMENT_SHIPPING_DEFAULT: StatementShipping = Object.freeze({ charge: true, fee: 5000, freeFrom: 50000 })

/** 상품 합계(정수 원)에 붙는 배송비(정수 원). 받지 않으면 0, 무료 기준 이상이면 0 */
export function statementShipping(subtotal: number, rule: StatementShipping = STATEMENT_SHIPPING_DEFAULT): number {
  if (!rule.charge) return 0
  return rule.freeFrom !== null && subtotal >= rule.freeFrom ? 0 : rule.fee
}
/** 기본 규칙의 배송비 (5만 원 미만 5,000원) */
export const shippingFor = (subtotal: number) => statementShipping(subtotal)

/** 정산서 한 장의 배송비와 합계. 금액을 모르는 줄이 있으면 둘 다 null. charged: 배송비 줄을 넣나(받지 않는 설정이면 줄 자체가 없다) */
export function statementTotals(subtotal: number | null, rule: StatementShipping): { readonly charged: boolean; readonly shipping: number | null; readonly total: number | null } {
  if (subtotal === null) return { charged: rule.charge, shipping: null, total: null }
  const shipping = statementShipping(subtotal, rule)
  return { charged: rule.charge, shipping, total: subtotal + shipping }
}
/** 정산서 계좌 줄 "은행 계좌번호 예금주" — 셋 다 있을 때만 */
export function statementAccount(info: Pick<StatementInfo, 'bank' | 'accountNumber' | 'accountHolder'> | null): string | null {
  if (info === null) return null
  const parts = [info.bank.trim(), info.accountNumber.trim(), info.accountHolder.trim()]
  return parts.every(part => part !== '') ? parts.join(' ') : null
}
/** 방송을 끝냈을 때 정산 정보를 다시 물을까: 한 번도 정하지 않았거나 계좌·전화번호가 비어 있다 */
export function statementInfoMissing(info: StatementInfo): boolean {
  return !info.decided || statementAccount(info) === null || info.phone.trim() === ''
}

function addLine(group: Map<string, SaleLine>, line: SaleLine) {
  const old = group.get(line.key)
  if (!old) group.set(line.key, { ...line })
  else {
    old.qty += line.qty
    old.amount = old.amount === null || line.amount === null ? null : old.amount + line.amount
  }
}
/** 줄 순서: 라이브 차례(합친 라이브) → 번호 */
const sortedLines = (group: Map<string, SaleLine>, rank: (line: SaleLine) => number) => [...group.values()].sort((a, b) => rank(a) - rank(b) || a.no - b.no)

/**
 * 라이브 정산서의 확정 판매 — 구매자별 주문과 상품별 줄. broadcast가 목록이면 합친 라이브(D-MERGE-LIVE-01): 그 라이브들의 확정 찜을 모두 담고,
 * 같은 날 라이브는 한 엔진 범위라(D-069) 같은 손님은 같은 구매자로 한 주문에 모인다. 상품 줄은 라이브마다 따로 두고(상품 키가 라이브마다 다르다) "1차" · "2차"를 단다
 */
export function broadcastSales(claims: ScopeData['claims'], products: ScopeData['products'], broadcast: string | readonly string[]) {
  const members: readonly string[] = typeof broadcast === 'string' ? [broadcast] : broadcast
  const merged = members.length > 1
  const order = new Map(members.map((id, index) => [id, index]))
  const ranks = new Map<string, number>()
  const rank = (line: SaleLine) => ranks.get(line.key) ?? 0
  const grouped = new Map<string, SaleLine>()
  const byBuyer = new Map<string, Map<string, SaleLine>>()
  for (const claim of claims.values()) {
    const at = order.get(claim.broadcast)
    if (at === undefined || claim.status !== 'CONFIRMED') continue
    const product = products.get(claim.product)
    const name = product?.name?.trim() || '상품명 미입력'
    const set = saleSetSize(name)
    // 한 번호에 묶어 파는 개수 (D-PIECES-01): 품종 옆에 "3개", 판매 수량은 낱개로 센다(세트 이름과 같게)
    const pieces = product?.pieces ?? 1
    const line: SaleLine = { key: claim.key ?? claim.product, no: claim.no, name: set ? `${String(set)}개 세트` : productTitle(name, pieces),
      variant: claim.variant, qty: claim.qty * (set ?? pieces), amount: claim.amount ?? null, ...(merged ? { round: roundWord(at) } : {}) }
    ranks.set(line.key, at)
    const buyer = byBuyer.get(claim.currentBuyer) ?? new Map<string, SaleLine>()
    addLine(buyer, line)
    byBuyer.set(claim.currentBuyer, buyer)
    addLine(grouped, line)
  }
  const orders: BuyerOrder[] = []
  let total: number | null = 0
  let qty = 0
  for (const [id, items] of byBuyer) {
    const lines = sortedLines(items, rank)
    const count = lines.reduce((n, line) => n + line.qty, 0)
    const subtotal = lines.reduce<number | null>((sum, line) => sum === null || line.amount === null ? null : sum + line.amount, 0)
    orders.push({ id, lines, qty: count, subtotal })
    qty += count
    total = total === null || subtotal === null ? null : total + subtotal
  }
  return { lines: sortedLines(grouped, rank), orders, buyers: orders.length, qty, total }
}

export type StatementTab = 'buyers' | 'products'
export interface StatementRow { key: string; no: number | null; label: string; money: number | null; qty: number; /** 합친 라이브의 차례 ("1차") */ round?: string }
export function statementName(name: string): string {
  return name.replace(/(\S)\s*-[a-zA-Z0-9]+(?=\s*·|$)/u, '$1')
}

export function statementRows(sales: ReturnType<typeof broadcastSales>, tab: StatementTab, name: (id: string) => string): StatementRow[] {
  if (tab === 'products') return sales.lines.map(line => ({
    key: line.key, no: line.no, label: [line.name, line.variant].filter(Boolean).join(' '), money: line.amount, qty: line.qty, ...(line.round ? { round: line.round } : {}),
  }))
  return sales.orders.map(order => ({ key: order.id, no: null, label: statementName(name(order.id)), money: order.subtotal, qty: order.qty }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ko') || a.key.localeCompare(b.key))
}
export const statementColumns = (tab: StatementTab) => tab === 'products' ? ['번호', '상품명', '판매 금액', '개수'] : ['구매자', '판매 금액', '개수']
