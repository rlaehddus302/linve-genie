// 글 계산 (LABEL_RULES L-0 2, L-3, L-4) — 템플릿 + 라벨 데이터 → 항목마다 찍을 글, 포장 라벨의 쪽 나누기.
// 캔버스 없이 도는 순수 함수이고 라벨 골든(tests/golden/label/*.json)으로 고정한다. 그리기는 이 결과만 그린다.
import { formatWon } from '@livejjim/core'
import { checkPackingData, checkProductData, entryNo, entryQty, entryVariant, isOptionEntry, type LabelBuyer, type PackingLabelData, type ProductLabelData } from './data.ts'
import { LABEL_MESSAGES, type LabelError } from './errors.ts'
import { validateTemplate, type PackingItemId, type PackingTemplate, type ProductItemId, type ProductTemplate, type TemplateCheck } from './template.ts'
import { NO_NAME, NO_TITLE, SMS_BUYER, formatLabelDate, formatLabelPriceWithQty, formatLabelTime, formatPackingEntry, trimLabelText } from './text.ts'

/** 상품 라벨의 찍는 항목 값 (캡션·머리글 꾸밈 빼고, 다듬은 뒤). 찍지 않는 항목은 키가 없다 */
export type ProductItems = Partial<Record<ProductItemId, string>>

export interface ProductText {
  readonly kind: 'product'
  readonly template: ProductTemplate
  readonly items: ProductItems
}

/** 포장 라벨에서 모든 쪽에 같은 항목 */
export type PackingCommonId = Extract<PackingItemId, 'shop' | 'date' | 'buyer' | 'count' | 'subtotal'>
export type PackingCommon = Partial<Record<PackingCommonId, string>>

export interface PackingPage {
  /** `k/n` */
  readonly page: string
  /** 방송이 둘 이상일 때만 있다 */
  readonly broadcast?: string
  /** 옵션 없는 수량 1 항목은 정수 번호, 옵션 항목은 `{번호}[ {옵션 글}][ ×{수량}]` 글 (L-4, O3) */
  readonly numbers: readonly (number | string)[]
}

export interface PackingText {
  readonly kind: 'packing'
  readonly template: PackingTemplate
  readonly common: PackingCommon
  readonly pages: readonly PackingPage[]
}

export type TextResult<T> = { readonly ok: true; readonly text: T } | { readonly ok: false; readonly error: LabelError }

function templateOfKind<K extends 'product' | 'packing'>(value: unknown, kind: K): TemplateCheck<K extends 'product' ? ProductTemplate : PackingTemplate> {
  const checked = validateTemplate(value)
  if (!checked.ok) return checked
  if (checked.template.kind !== kind) {
    const message = kind === 'product' ? '상품 라벨 설정이 아니에요.' : '포장 라벨 설정이 아니에요.'
    return {
      ok: false,
      error: { code: 'INVALID_TEMPLATE', message: LABEL_MESSAGES.invalidTemplate, problems: [{ path: 'kind', message }] },
      warnings: checked.warnings,
    }
  }
  return checked as TemplateCheck<K extends 'product' ? ProductTemplate : PackingTemplate>
}

/** 구매자 값 (L-3): 유튜브 = 다듬은 닉네임(비면 `이름 없음`), 문자찜 = 언제나 `문자찜` */
export function buyerText(buyer: LabelBuyer): string {
  if (buyer.kind === 'sms') return SMS_BUYER
  const name = trimLabelText(buyer.name)
  return name === '' ? NO_NAME : name
}

/** 상품 라벨 글 (L-3). 템플릿을 먼저, 그다음 데이터를 검사한다 — 오류면 글을 만들지 않는다 */
export function computeProductText(template: unknown, data: unknown): TextResult<ProductText> {
  const checked = templateOfKind(template, 'product')
  if (!checked.ok) return checked
  const d = checkProductData(data)
  if (!d.ok) return d
  return { ok: true, text: productText(checked.template, d.data) }
}

function productText(t: ProductTemplate, d: ProductLabelData): ProductText {
  const items: ProductItems = {}
  const shop = trimLabelText(t.shopName)
  if (t.items.shop.visible && shop !== '') items.shop = shop
  items.number = String(d.no)
  // 수량은 가격 자리, 옵션 글은 품종 자리 (O3, D-O3-02) — 템플릿에서 끈 항목이면 그 글도 없다
  if (t.items.price.visible) items.price = formatLabelPriceWithQty(d.price, t.priceStyle, d.qty ?? 1)
  if (t.items.date.visible) items.date = formatLabelDate(d.date, t.dateStyle)
  if (t.items.name.visible) items.name = nameWithVariant(d)
  items.buyer = buyerText(d.buyer)
  // 시간 칸은 켜졌고 데이터에 시각이 있을 때만 (D-LABEL-TIME-01) — 없으면 빈 칸, 오류가 아니다
  if (t.items.time.visible && d.time !== undefined) items.time = formatLabelTime(d.time, t.timeStyle)
  return { kind: 'product', template: t, items }
}

/** 품종 자리 (L-3): 다듬은 품종, 옵션 글이 있으면 `{품종} {옵션 글}`(품종이 비면 옵션 글만) */
function nameWithVariant(d: ProductLabelData): string {
  const name = trimLabelText(d.name)
  const variant = d.variant === undefined || d.variant === null ? '' : trimLabelText(d.variant)
  if (variant === '') return name
  return name === '' ? variant : `${name} ${variant}`
}

/** 포장 라벨 글과 쪽 나누기 (L-4) */
export function computePackingText(template: unknown, data: unknown): TextResult<PackingText> {
  const checked = templateOfKind(template, 'packing')
  if (!checked.ok) return checked
  const d = checkPackingData(data)
  if (!d.ok) return d
  return { ok: true, text: packingText(checked.template, d.data) }
}

function packingText(t: PackingTemplate, d: PackingLabelData): PackingText {
  const common: PackingCommon = {}
  const shop = trimLabelText(t.shopName)
  if (t.items.shop.visible && shop !== '') common.shop = shop
  if (t.items.date.visible) common.date = formatLabelDate(d.date)
  common.buyer = buyerText(d.buyer)
  // 상품 수 = 수량 합 (O3, D-O3-03) — 옵션 없는 수량 1 항목만이면 번호 개수
  const count = d.broadcasts.reduce((sum, b) => sum + b.numbers.reduce<number>((n, e) => n + entryQty(e), 0), 0)
  if (t.items.count.visible) common.count = String(count)
  if (t.items.subtotal.visible) common.subtotal = formatWon(d.subtotal)

  const many = d.broadcasts.length > 1
  const chunks: { broadcast?: string; numbers: (number | string)[] }[] = []
  for (const b of d.broadcasts) {
    // 번호 순, 같은 번호(변형)는 받은 순서 그대로 (Array.prototype.sort는 안정 정렬)
    const sorted = [...b.numbers].sort((x, y) => entryNo(x) - entryNo(y))
    const values = sorted.map((e) => (isOptionEntry(e) ? formatPackingEntry(entryNo(e), entryVariant(e), entryQty(e)) : entryNo(e)))
    // 옵션 항목이 하나라도 있는 방송은 쪽마다 perPage의 절반(내림, 적어도 1) (O3, D-O3-04)
    const perPage = sorted.some(isOptionEntry) ? Math.max(1, Math.floor(t.perPage / 2)) : t.perPage
    const title = trimLabelText(b.title)
    for (let i = 0; i < values.length; i += perPage) {
      const numbers = values.slice(i, i + perPage)
      chunks.push(many ? { broadcast: title === '' ? NO_TITLE : title, numbers } : { numbers })
    }
  }
  const pages = chunks.map((chunk, k) => ({ page: `${String(k + 1)}/${String(chunks.length)}`, ...chunk }))
  return { kind: 'packing', template: t, common, pages }
}
