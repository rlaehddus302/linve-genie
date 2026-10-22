// 판매 줄과 "상품 n개" (D-O4-09·D-O4-10). 화면마다 따로 세거나 적지 않게 여기 하나로 모은다.
// - 판매 줄: `{번호}번[ {품종}][ {옵션 글}][ {수량}개]` — 품종은 그 줄이 품종을 보일 때만, 수량은 2 이상일 때만, `×`·`·`로 가르지 않는다.
//   채팅 패널 안의 판정 표시(`주문 21번 M ×2`, D-O2-12)는 판매 줄이 아니다 — 여기 함수를 쓰지 않는다.
// - "상품 n개": 어디서나 확정 찜 수량의 합. 포장 모드 "a/b 담음"만 줄 수(D-O4-04).
import type { Buyer, Claim } from '../api/types.ts'
import { settlementKey, type ScopeData } from './scope-data.ts'

/** 수량 (없으면 1 — O3 전 응답) */
const qtyOf = (line: { readonly qty?: number | null }): number => line.qty ?? 1

/** "상품 n개"의 n = 수량 합 (D-O4-09). 모든 화면이 이 셈을 쓴다 */
export function quantitySum(lines: readonly { readonly qty?: number | null }[]): number {
  return lines.reduce((sum, line) => sum + qtyOf(line), 0)
}

/** 품종 뒤 옵션 글·수량: " M", " L 2개", 수량만 " 3개", 옵션 없는 수량 1이면 빈 글 */
export function saleOptionWords(line: { readonly variant?: string | null; readonly qty?: number | null }): string {
  const text = line.variant?.trim() ?? ''
  const qty = qtyOf(line)
  return `${text === '' ? '' : ` ${text}`}${qty > 1 ? ` ${String(qty)}개` : ''}`
}

/** 판매 줄 `21번 반바지 L 2개` / 품종을 보이지 않는 줄 `21번 L 2개` (name 없음) / 다육 `7번 핑크프릴` */
export function saleLine(line: { readonly no: number; readonly name?: string | null; readonly variant?: string | null; readonly qty?: number | null }): string {
  const name = line.name === undefined || line.name === null || line.name === '' ? '' : ` ${line.name}`
  return `${String(line.no)}번${name}${saleOptionWords(line)}`
}

const confirmed = (data: Pick<ScopeData, 'claims'>, keep: (claim: Claim) => boolean): Claim[] => {
  const out: Claim[] = []
  for (const claim of data.claims.values()) if (claim.status === 'CONFIRMED' && keep(claim)) out.push(claim)
  return out
}

/** 구매자 목록·자세히·합칠 구매자 찾기의 "상품 n개" — 그 구매자 자신과 합쳐진 구매자 전부의 확정 찜 수량 합 (BuyerInfo.items와 같은 범위) */
export function buyerQuantity(data: Pick<ScopeData, 'claims'>, buyer: Pick<Buyer, 'id' | 'merged'>): number {
  const own = new Set([buyer.id, ...buyer.merged])
  return quantitySum(confirmed(data, (claim) => own.has(claim.buyer)))
}

/** 정산 묶음마다 "상품 n개" (STL-03) — 열쇠 = settlementKey(지금의 구매자, 방송 날짜) */
export function settlementQuantities(data: Pick<ScopeData, 'claims' | 'broadcasts' | 'date'>): Map<string, number> {
  const groups = new Map<string, Claim[]>()
  for (const claim of confirmed(data, () => true)) {
    const key = settlementKey({ buyer: claim.currentBuyer, date: data.broadcasts.get(claim.broadcast)?.date ?? data.date })
    groups.set(key, [...(groups.get(key) ?? []), claim])
  }
  return new Map([...groups].map(([key, claims]) => [key, quantitySum(claims)]))
}
