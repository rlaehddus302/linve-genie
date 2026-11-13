// 고쳐 다시 뽑기 (F3, D-RETRO-44): 출력 내역에서 번호·품종·가격을 고쳐 다시 인쇄할 때 고친 값을 상품에도 넣을 수 있다.
// 11월 12일 방송에서는 라벨에서 고친 값이 그 한 장에만 적용돼 라벨과 정산이 달라질 수 있었다.
// - 상품에 넣는 것은 품종과 가격뿐이다(product.update). 번호는 넣지 않는다 — 상품 번호를 바꾸면(번호 변경) 그 번호의 확정 찜이 모두 무효가 되고
//   고쳐 뽑으려던 라벨도 폐기된다(DOMAIN_RULES R-10). 닉네임은 상품 정보가 아니다. 둘 다 그 라벨 한 장에만 적용된다.
// - 가격은 묻지 않고 입금 전 찜에도 적용한다(applyTo UNPAID_CLAIMS): 라벨을 고쳐 뽑는 것은 그 손님에게 나갈 값이 틀렸다는 뜻이라,
//   새 찜부터만(NEW_ONLY) 바꾸면 바로 그 찜의 금액은 그대로 남아 라벨과 정산이 계속 다르다. 이미 입금된 찜은 엔진이 바꾸지 않는다(R-10) — 그때는 알린다.
//   엔진은 그 이벤트로 상품 가격이 실제로 바뀔 때만 찜 금액을 바꾼다. 상품 가격이 벌써 그 값이면(앞서 새 찜부터만 고쳐 둔 경우) 찜 금액은 그대로다 — 이것도 알린다.
// - 라벨의 가격은 찜 금액(단가 × 수량, 옵션 가격 차이 포함)이다. 수량이 여럿이거나 옵션이 있는 찜은 라벨 가격이 상품 가격과 달라 상품에 넣지 않는다.
// - 차례: 상품 수정 → 다시 인쇄(고친 값 그대로). 상품 수정이 실패하면 인쇄하지 않는다(판매자가 [이 라벨만]을 고를 수 있다). 요청 번호는 다시 눌러도 같다.
import type { ProductLabelData } from '@livejjim/label'
import type { LabelView } from '@livejjim/web/src/api/print-types.ts'
import type { WriteResult } from '@livejjim/web/src/api/types.ts'
import { get, post, withQuery, withRetry } from '../api/client.ts'

export type LabelEdits = { no?: number; name?: string; price?: number; nickname?: string }

export interface FixPlan {
  /** 상품에 넣을 값 (없으면 null — 묻지 않고 라벨만 뽑는다) */
  readonly product: { readonly name?: string; readonly price?: number } | null
  /** 가격을 고쳤지만 상품에는 넣지 않는다 (수량이 여럿이거나 옵션이 있는 찜) */
  readonly priceLabelOnly: boolean
  /** 번호나 닉네임을 고쳤다 (라벨 한 장에만) */
  readonly labelOnly: boolean
}

/** 고친 값 가운데 상품에 넣을 것과 라벨에만 둘 것을 나눈다 */
export function fixPlan(original: ProductLabelData, edits: LabelEdits): FixPlan {
  const single = (original.variant ?? null) === null && (original.qty ?? 1) === 1
  const product = { ...(edits.name === undefined ? {} : { name: edits.name }), ...(edits.price !== undefined && single ? { price: edits.price } : {}) }
  return {
    product: Object.keys(product).length === 0 ? null : product,
    priceLabelOnly: edits.price !== undefined && !single,
    labelOnly: edits.no !== undefined || edits.nickname !== undefined,
  }
}

type Command = (event: Readonly<Record<string, unknown>>, requestId?: string) => Promise<WriteResult>

/** 다시 인쇄 요청 (고친 값이 있으면 함께) — 같은 요청 번호면 한 번만 만든다 */
export async function reprintEdited(label: LabelView, edits: LabelEdits, requestId: string): Promise<void> {
  const body = { requestId, b: label.broadcast, claim: label.claim, version: label.version, ...(Object.keys(edits).length > 0 ? { edits } : {}) }
  await withRetry(() => post('/api/print/labels/reprint', body))
}

export interface FixOutcome {
  /** 상품이 실제로 바뀌었다 (이미 그 값이었으면 false) */
  readonly productChanged: boolean
  /** 가격을 고쳤는데 그 찜의 금액은 그대로다 (이미 입금됐거나 상품 가격이 벌써 그 값 — 라벨에만 새 가격) */
  readonly amountKept: boolean
}

/**
 * 상품도 고치고 다시 인쇄한다. 상품 수정(product.update — 가격이면 입금 전 찜에도)을 먼저 보내고, 받아들여지면 고친 값 그대로 다시 인쇄를 넣는다.
 * 가격을 고쳤으면 그 라벨의 지금 금액을 다시 읽어 찜 금액이 바뀌었는지 본다(읽지 못하면 모름 — 알리지 않는다)
 */
export async function fixProductAndReprint(input: {
  readonly command: Command
  readonly date: string
  readonly label: LabelView
  readonly original: ProductLabelData
  readonly edits: LabelEdits
  readonly product: NonNullable<FixPlan['product']>
  readonly ids: { readonly product: string; readonly print: string }
}): Promise<FixOutcome> {
  const { command, date, label, original, edits, product, ids } = input
  const written = await command({ type: 'product.update', b: label.broadcast, no: original.no, ...(product.name === undefined ? {} : { name: product.name }), ...(product.price === undefined ? {} : { price: product.price, applyTo: 'UNPAID_CLAIMS' }) }, ids.product)
  let amountKept = false
  if (product.price !== undefined && label.broadcast !== null) {
    try {
      const view = await get<{ labels: LabelView[] }>(withQuery('/api/print/labels', { date, historyBroadcast: label.broadcast }))
      const data = view.labels.find((item) => item.key === label.key)?.data
      amountKept = data !== null && data !== undefined && 'price' in data && data.price !== product.price
    } catch {
      amountKept = false
    }
  }
  await reprintEdited(label, edits, ids.print)
  return { productChanged: written.changed, amountKept }
}
