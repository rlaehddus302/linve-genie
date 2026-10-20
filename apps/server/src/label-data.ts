// 엔진 상태 → 라벨 데이터 (LABEL_RULES L-9, L-10, D-I1-04·D-I1-10). 판정은 하지 않는다 — 코어 조회 함수의 결과만 읽는다.
// - 상품 라벨: no·name = 그 찜이 속한 상품의 지금 번호·품종, price = 그 찜의 가격 스냅샷, date = 그 방송의 날짜(범위 날짜),
//   buyer = 그 라벨 키에 고정된 구매자(라벨 키의 첫 작업 때 정한다).
// - 상품 라벨의 구매자 규칙(첫 작업 때): 문자찜으로 생긴 찜이거나 찜의 구매자 자신이 문자 구매자면 { kind: 'sms' },
//   아니면 { kind: 'youtube', name: 찜의 구매자 자신의 지금 표시 이름 } — 합친 상대의 이름이 아니다.
// - 포장 라벨: (지금의 구매자, 날짜) 정산 묶음 — 그날 방송 선언 순서대로 1등 상품 번호, 코어 정산의 상품 합계, 지금의 구매자 표시 이름.
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
import { checkPackingData, checkProductData, labelContentKey, type LabelBuyer, type PackingLabelData, type ProductLabelData } from '@livejjim/label'

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
export function productLabelBuyer(state: EngineState, claim: { readonly origin: string; readonly buyer: string }): LabelBuyer {
  if (claim.origin === 'sms') return { kind: 'sms' }
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
export function productLabelData(state: EngineState, claims: ClaimIndex, label: { readonly claim: string; readonly version: number; readonly buyer: LabelBuyer }): ProductLabelData | null {
  const info = isWinnerOf(claims, label.claim, label.version)
  if (info === null) return null
  const product = getProduct(state, info.broadcast, info.no)
  const broadcast = getBroadcast(state, info.broadcast)
  if (product === null || broadcast === null) return null
  const data = { no: info.no, name: product.name, price: info.price ?? product.price, date: broadcast.date, buyer: label.buyer }
  const checked = checkProductData(data)
  return checked.ok ? checked.data : null
}

/** 포장 라벨 데이터 (L-9, L-4) — (지금의 구매자, 날짜) 정산 묶음. 1등 상품이 없으면 null */
export function packingLabelData(state: EngineState, buyerId: string, date: string): { readonly root: string; readonly data: PackingLabelData } | null {
  const root = currentBuyerOf(state, buyerId)
  if (root === null) return null
  const settlement = getSettlement(state, root, date)
  if (settlement.items.length === 0) return null
  const numbers = new Map<string, number[]>()
  for (const key of settlement.items) {
    const split = key.lastIndexOf('/')
    const b = key.slice(0, split)
    const no = Number(key.slice(split + 1))
    const list = numbers.get(b)
    if (list === undefined) numbers.set(b, [no])
    else list.push(no)
  }
  const broadcasts = listBroadcasts(state)
    .filter((broadcast) => broadcast.date === date && numbers.has(broadcast.id))
    .map((broadcast) => ({ title: broadcast.title, numbers: [...(numbers.get(broadcast.id) as number[])].sort((a, b) => a - b) }))
  const data = { date, buyer: currentLabelBuyer(state, root), broadcasts, subtotal: settlement.subtotal }
  const checked = checkPackingData(data)
  return checked.ok ? { root, data: checked.data } : null
}

/** 내용 키 (L-10). 만들 수 없는 데이터면 null */
export function contentKeyOf(kind: 'product' | 'packing', data: unknown): string | null {
  const result = labelContentKey(kind, data)
  return result.ok ? result.key : null
}
