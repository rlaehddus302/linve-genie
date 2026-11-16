// 엔진 상태 → 라벨 데이터 (LABEL_RULES L-9, L-10, D-I1-04·D-I1-10). 판정은 하지 않는다 — 코어 조회 함수의 결과만 읽는다.
// - 상품 라벨: no·name = 그 찜이 속한 상품의 지금 번호·품종(개수가 2 이상이면 "채홍 3개", D-PIECES-01), price = 그 찜의 가격 스냅샷, date = 그 방송의 날짜(범위 날짜),
//   buyer = 그 라벨 키에 고정된 구매자(라벨 키의 첫 작업 때 정한다).
// - 상품 라벨의 구매자 규칙(첫 작업 때): 문자찜으로 생긴 찜이거나 찜의 구매자 자신이 문자 구매자면 { kind: 'sms' },
//   아니면 { kind: 'youtube', name: 찜의 구매자 자신의 지금 표시 이름 } — 합친 상대의 이름이 아니다.
//   판매자가 "닉네임으로 보이기"로 넣은 문자찜(named, D-CLAIMADD-03)은 문자찜으로 생긴 찜이어도 구매자가 채팅 손님이면 그 닉네임이다.
// - 포장 라벨: (지금의 구매자, 날짜) 정산 묶음 — 그날 방송 선언 순서대로 1등 상품 번호, 코어 정산의 상품 합계, 지금의 구매자 표시 이름.
// - 옵션 방송 (O3, D-O3-01·03): 상품 라벨 price = 찜 금액, variant = 옵션 글(있을 때만), qty = 수량(2 이상일 때만).
//   포장 라벨은 변형마다 항목(같은 변형은 수량을 더함), 옵션 없는 수량 1은 정수 번호 그대로.
// - 찜 금액은 코어 ClaimInfo.amount만 (O3 감사 D-O3-15): 확정 찜에 없으면 단가 × 수량·가격 스냅샷으로 채우지 않고 그 데이터를 만들지 않는다
//   (상품 라벨 = null + 알림, 포장 라벨 항목 = MissingAmountError, 포장 라벨 데이터 = null + 알림).
// - 데이터에는 L-3·L-4 칸만 있다(메모·전화번호·뒤 4자리·채널 ID 없음). 만든 데이터는 checkProductData·checkPackingData로 확인한다.
import {
  currentBuyerOf,
  getBroadcast,
  getBuyer,
  getProduct,
  getSettlement,
  listBroadcasts,
  listClaims,
  type ClaimInfo,
  type EngineState,
} from '@livejjim/core'
import { claimAmount, MissingAmountError } from './amount.ts'
import { displayNickname, productTitle } from '@livejjim/core/format'
import { checkPackingData, checkProductData, labelContentKey, type LabelBuyer, type PackingEntry, type PackingLabelData, type ProductLabelData } from '@livejjim/label'

/** 찜 ID → 코어 조회 결과 (상태 하나에 한 번 만든다 — 범위 실행 상태의 보기 캐시에 둔다) */
export type ClaimIndex = ReadonlyMap<string, ClaimInfo>

export function buildClaimIndex(state: EngineState): ClaimIndex {
  const map = new Map<string, ClaimInfo>()
  for (const claim of listClaims(state)) map.set(claim.id, claim)
  return map
}

/**
 * 상품 라벨의 구매자 (L-9, D-I1-04) — 라벨 키의 첫 작업을 만드는 순간의 상태로 정한다.
 * origin = 그 찜이 생긴 경로, buyer = 찜의 구매자 자신 (합친 결과가 아니다)
 */
export function productLabelBuyer(state: EngineState, claim: { readonly origin: string; readonly buyer: string; readonly named?: boolean }): LabelBuyer {
  if (claim.origin === 'sms' && claim.named !== true) return { kind: 'sms' }
  const buyer = getBuyer(state, claim.buyer)
  if (buyer === null || buyer.kind === 'sms') return { kind: 'sms' }
  return { kind: 'youtube', name: buyer.display }
}

/** 지금의 구매자의 라벨 구매자 (포장 라벨, L-9) — 문자 구매자면 { kind: 'sms' } (`문자찜(메모)`는 쓰지 않는다) */
export function currentLabelBuyer(state: EngineState, root: string): LabelBuyer {
  const buyer = getBuyer(state, root)
  if (buyer === null || buyer.kind === 'sms') return { kind: 'sms' }
  return { kind: 'youtube', name: buyer.display }
}

/** 찜이 지금 그 확정버전의 1등인지 (CONFIRMED이고 확정버전이 같다) */
export function isWinnerOf(claims: ClaimIndex, claim: string, version: number): ClaimInfo | null {
  const info = claims.get(claim)
  return info !== undefined && info.status === 'CONFIRMED' && info.confirmVersion === version ? info : null
}

/**
 * 상품 라벨 데이터 (L-9) — 지금 상태로 만든다. 그 찜이 그 확정버전의 1등이 아니면 null.
 * date = 그 방송의 날짜. 결과는 checkProductData를 통과한다(통과하지 못하면 null)
 */
export function productLabelData(
  state: EngineState,
  claims: ClaimIndex,
  label: { readonly claim: string; readonly version: number; readonly buyer: LabelBuyer },
  onMissingAmount?: (claimId: string) => void,
): ProductLabelData | null {
  const info = isWinnerOf(claims, label.claim, label.version)
  if (info === null) return null
  // 가격 = 찜 금액(단가 스냅샷 × 수량, ClaimInfo.amount — 옵션 없는 수량 1 찜은 가격 스냅샷 그대로). 없으면 만들지 않는다 (D-O3-15)
  const price = claimAmount(info)
  if (price === null) {
    onMissingAmount?.(info.id)
    return null
  }
  const product = getProduct(state, info.broadcast, info.no)
  const broadcast = getBroadcast(state, info.broadcast)
  if (product === null || broadcast === null) return null
  // 옵션 글은 있을 때만, 수량은 2 이상일 때만 (L-9 O3, D-O3-01)
  const data = {
    no: info.no,
    // 품종 옆에 개수 ("채홍 3개", D-PIECES-01) — 개수 1이면 품종 그대로
    name: productTitle(product.name, product.pieces),
    price,
    ...(info.variant === null ? {} : { variant: info.variant }),
    ...(info.qty >= 2 ? { qty: info.qty } : {}),
    date: broadcast.date,
    buyer: label.buyer,
  }
  const checked = checkProductData(data)
  return checked.ok ? checked.data : null
}

/**
 * 포장 라벨의 방송 항목 (L-9, L-4, O3 D-O3-03) — 지금의 구매자 root의 그 날짜 확정 찜(합친 구매자 포함)을 방송 선언 순서로.
 * 한 방송 안은 번호 순, 같은 번호는 상품의 변형 순서(항목 순서·선택지 순서). 같은 (번호, 옵션 글)의 찜은 수량을 더한 한 항목.
 * 옵션 없는 수량 1 항목은 정수 번호(O3 전과 같은 값), 아니면 `{ no, variant?, qty? }`.
 * 묶음의 확정 찜 중 찜 금액이 없는 것이 있으면 MissingAmountError — 그 묶음의 포장 라벨을 만들지 않는다 (D-O3-15)
 */
export function packingBroadcasts(state: EngineState, root: string, date: string, claims: Iterable<ClaimInfo> = listClaims(state)): { title: string; numbers: PackingEntry[] }[] {
  const broadcasts = listBroadcasts(state).filter((broadcast) => broadcast.date === date)
  const order = new Map(broadcasts.map((broadcast, i) => [broadcast.id, i]))
  const groups = new Map<string, { b: string; no: number; variant: string | null; qty: number; rank: number }>()
  const variantRank = new Map<string, Map<string, number>>()
  const rankOf = (claim: ClaimInfo): number => {
    if (claim.variant === null) return -1
    let ranks = variantRank.get(claim.product)
    if (ranks === undefined) {
      ranks = new Map((getProduct(state, claim.broadcast, claim.no)?.variants ?? []).map((variant, i) => [variant.text, i]))
      variantRank.set(claim.product, ranks)
    }
    return ranks.get(claim.variant) ?? Number.MAX_SAFE_INTEGER
  }
  for (const claim of claims) {
    if (claim.status !== 'CONFIRMED' || claim.currentBuyer !== root || !order.has(claim.broadcast)) continue
    if (claimAmount(claim) === null) throw new MissingAmountError(claim.id)
    const key = JSON.stringify([claim.broadcast, claim.no, claim.variant])
    const group = groups.get(key)
    if (group === undefined) groups.set(key, { b: claim.broadcast, no: claim.no, variant: claim.variant, qty: claim.qty, rank: rankOf(claim) })
    else group.qty += claim.qty
  }
  const sorted = [...groups.values()].sort((x, y) => (order.get(x.b) as number) - (order.get(y.b) as number) || x.no - y.no || x.rank - y.rank || ((x.variant ?? '') < (y.variant ?? '') ? -1 : 1))
  const out: { title: string; numbers: PackingEntry[] }[] = []
  let last: string | null = null
  for (const group of sorted) {
    if (group.b !== last) {
      out.push({ title: (getBroadcast(state, group.b) as { title: string }).title, numbers: [] })
      last = group.b
    }
    const entry: PackingEntry =
      group.variant === null && group.qty === 1 ? group.no : { no: group.no, ...(group.variant === null ? {} : { variant: group.variant }), ...(group.qty === 1 ? {} : { qty: group.qty }) }
    ;(out[out.length - 1] as { numbers: PackingEntry[] }).numbers.push(entry)
  }
  return out
}

/**
 * 포장 라벨 데이터 (L-9, L-4) — (지금의 구매자, 날짜) 정산 묶음. 1등 상품이 없으면 null.
 * 묶음에 찜 금액이 없는 확정 찜이 있으면 null — onMissingAmount로 그 찜 ID를 알린다 (D-O3-15)
 */
export function packingLabelData(state: EngineState, buyerId: string, date: string, onMissingAmount?: (claimId: string) => void): { readonly root: string; readonly data: PackingLabelData } | null {
  const root = currentBuyerOf(state, buyerId)
  if (root === null) return null
  const settlement = getSettlement(state, root, date)
  if (settlement.items.length === 0) return null
  let broadcasts: { title: string; numbers: PackingEntry[] }[]
  try {
    broadcasts = packingBroadcasts(state, root, date)
  } catch (error) {
    if (!(error instanceof MissingAmountError)) throw error
    onMissingAmount?.(error.claimId)
    return null
  }
  const data = { date, buyer: currentLabelBuyer(state, root), broadcasts, subtotal: settlement.subtotal }
  const checked = checkPackingData(data)
  return checked.ok ? { root, data: checked.data } : null
}

/** 내용 키 (L-10). 만들 수 없는 데이터면 null */
export function contentKeyOf(kind: 'product' | 'packing', data: unknown): string | null {
  const result = labelContentKey(kind, data)
  return result.ok ? result.key : null
}

export function withDisplayNickname<T extends ProductLabelData | PackingLabelData>(data: T, hideSuffix: boolean): T {
  if (!hideSuffix || data.buyer.kind !== 'youtube') return data
  return { ...data, buyer: { ...data.buyer, name: displayNickname(data.buyer.name, true) } }
}
