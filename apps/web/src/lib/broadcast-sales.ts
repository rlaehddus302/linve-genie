import { formatWon, saleSetSize } from '@livejjim/core/format'
import type { ScopeData } from './scope-data.ts'

export interface SaleLine {
  key: string
  no: number
  name: string
  variant: string | null
  qty: number
  amount: number | null
}
export interface BuyerOrder {
  id: string
  lines: SaleLine[]
  qty: number
  subtotal: number | null
}
export const salesMoney = (amount: number | null) => amount === null ? '금액 확인 필요' : formatWon(amount)
export const shippingFor = (subtotal: number) => subtotal >= 50000 ? 0 : 5000

function addLine(group: Map<string, SaleLine>, line: SaleLine) {
  const old = group.get(line.key)
  if (!old) group.set(line.key, { ...line })
  else {
    old.qty += line.qty
    old.amount = old.amount === null || line.amount === null ? null : old.amount + line.amount
  }
}
const sortedLines = (group: Map<string, SaleLine>) => [...group.values()].sort((a, b) => a.no - b.no)

export function broadcastSales(claims: ScopeData['claims'], products: ScopeData['products'], broadcast: string) {
  const grouped = new Map<string, SaleLine>()
  const byBuyer = new Map<string, Map<string, SaleLine>>()
  for (const claim of claims.values()) {
    if (claim.broadcast !== broadcast || claim.status !== 'CONFIRMED') continue
    const name = products.get(claim.product)?.name?.trim() || '상품명 미입력'
    const set = saleSetSize(name)
    const line = { key: claim.key ?? claim.product, no: claim.no, name: set ? `${String(set)}개 세트` : name,
      variant: claim.variant, qty: claim.qty * (set ?? 1), amount: claim.amount ?? null }
    const buyer = byBuyer.get(claim.currentBuyer) ?? new Map<string, SaleLine>()
    addLine(buyer, line)
    byBuyer.set(claim.currentBuyer, buyer)
    addLine(grouped, line)
  }
  const orders: BuyerOrder[] = []
  let total: number | null = 0
  let qty = 0
  for (const [id, items] of byBuyer) {
    const lines = sortedLines(items)
    const count = lines.reduce((n, line) => n + line.qty, 0)
    const subtotal = lines.reduce<number | null>((sum, line) => sum === null || line.amount === null ? null : sum + line.amount, 0)
    orders.push({ id, lines, qty: count, subtotal })
    qty += count
    total = total === null || subtotal === null ? null : total + subtotal
  }
  return { lines: sortedLines(grouped), orders, buyers: orders.length, qty, total }
}

export type StatementTab = 'buyers' | 'products'
export interface StatementRow { key: string; no: number | null; label: string; money: number | null; qty: number }
export function statementName(name: string): string {
  return name.replace(/(\S)\s*-[a-zA-Z0-9]+(?=\s*·|$)/u, '$1')
}

export function statementRows(sales: ReturnType<typeof broadcastSales>, tab: StatementTab, name: (id: string) => string): StatementRow[] {
  if (tab === 'products') return sales.lines.map(line => ({
    key: line.key, no: line.no, label: [line.name, line.variant].filter(Boolean).join(' '), money: line.amount, qty: line.qty,
  }))
  return sales.orders.map(order => ({ key: order.id, no: null, label: statementName(name(order.id)), money: order.subtotal, qty: order.qty }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ko') || a.key.localeCompare(b.key))
}
export const statementColumns = (tab: StatementTab) => tab === 'products' ? ['번호', '상품명', '판매 금액', '개수'] : ['구매자', '판매 금액', '개수']
