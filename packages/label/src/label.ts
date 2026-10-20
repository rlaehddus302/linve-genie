// 한 번에: 글 계산 → 그리기 (L-0 2). 오류(INVALID_TEMPLATE·INVALID_DATA·DOES_NOT_FIT)면 글·그림을 만들지 않는다.
import { computePackingText, computeProductText, type PackingText, type ProductText } from './compute.ts'
import { renderPackingText, renderProductText, type LabelRenderEnv, type RenderResult, type RenderedLabel } from './render.ts'

/** 상품 라벨: 템플릿 + 라벨 데이터 → 1비트 그림 + 배치 결과 + 글 계산 결과 */
export function renderProductLabel(env: LabelRenderEnv, template: unknown, data: unknown): RenderResult<RenderedLabel & { readonly text: ProductText }> {
  const computed = computeProductText(template, data)
  if (!computed.ok) return computed
  const rendered = renderProductText(env, computed.text)
  if (!rendered.ok) return rendered
  return { ok: true, image: rendered.image, layout: rendered.layout, text: computed.text }
}

/** 포장 라벨: 쪽마다 1비트 그림 + 배치 결과 */
export function renderPackingLabels(
  env: LabelRenderEnv,
  template: unknown,
  data: unknown,
): RenderResult<{ readonly pages: readonly RenderedLabel[]; readonly text: PackingText }> {
  const computed = computePackingText(template, data)
  if (!computed.ok) return computed
  const rendered = renderPackingText(env, computed.text)
  if (!rendered.ok) return rendered
  return { ok: true, pages: rendered.pages, text: computed.text }
}
