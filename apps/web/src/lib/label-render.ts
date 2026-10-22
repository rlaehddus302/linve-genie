// 라벨 그리기·내보내기 (LABEL_RULES L-0·L-6, LBL-03·LBL-07, D-I1-07). 미리 보기·출력·PNG·PDF가 같은 렌더러의 같은 1비트 그림을 쓴다.
// 렌더 환경(글꼴)은 주입한다 — 브라우저는 lib/label-env.ts, 시험은 Node 캔버스. 이 파일은 DOM을 쓰지 않는다(파일 저장·공유는 lib/label-files.ts).
// 파일 이름에는 날짜·번호·쪽·순번만 넣는다(구매자 이름·메모·전화번호 없음, L-11 16).
import {
  LABEL_MESSAGES,
  computePackingText,
  createA4Pdf,
  createLabelPdf,
  defaultTemplate,
  doesNotFitMessage,
  encodeLabelPng,
  renderPackingLabels,
  renderPackingPage,
  renderProductLabel,
  renderTestLabel,
  validateTemplate,
  type LabelBitmap,
  type LabelError,
  type LabelRenderEnv,
  type LabelSizeId,
  type LabelTemplate,
  type PackingLabelData,
  type PackingTemplate,
  type ProductLabelData,
  type ProductTemplate,
  type TemplateProblem,
} from '@livejjim/label'
import type { ClaimedJob, LabelData } from '../api/print-types.ts'

export type RenderOutcome = { readonly ok: true; readonly image: LabelBitmap } | { readonly ok: false; readonly error: LabelError }
export type PagesOutcome = { readonly ok: true; readonly images: readonly LabelBitmap[] } | { readonly ok: false; readonly error: LabelError }

export function renderProduct(env: LabelRenderEnv, template: unknown, data: ProductLabelData): RenderOutcome {
  const result = renderProductLabel(env, template, data)
  return result.ok ? { ok: true, image: result.image } : result
}

export function renderPacking(env: LabelRenderEnv, template: unknown, data: PackingLabelData): PagesOutcome {
  const result = renderPackingLabels(env, template, data)
  return result.ok ? { ok: true, images: result.pages.map((page) => page.image) } : result
}

const missingPage = (): LabelError => ({ code: 'INVALID_DATA', message: `${LABEL_MESSAGES.invalidDataPrefix}${LABEL_MESSAGES.labelData}` })

/** 출력 기기가 받은 작업의 그림 (포장은 요청 때의 한 장 번호 수로 그린 그 쪽) */
export function renderJob(env: LabelRenderEnv, job: Pick<ClaimedJob, 'kind' | 'template' | 'data' | 'page'>): RenderOutcome {
  if (job.kind === 'product') return renderProduct(env, job.template, job.data as ProductLabelData)
  const pages = renderPacking(env, job.template, job.data as PackingLabelData)
  if (!pages.ok) return pages
  const image = pages.images[(job.page ?? 1) - 1]
  return image === undefined ? { ok: false, error: missingPage() } : { ok: true, image }
}

export function renderTest(env: LabelRenderEnv, input: { shopName: string; date: string; size: LabelSizeId }): RenderOutcome {
  const result = renderTestLabel(env, input)
  return result.ok ? { ok: true, image: result.image } : result
}

/** 라벨 오류의 화면 문장 (DOES_NOT_FIT은 어느 항목인지) */
export function labelErrorMessage(error: Pick<LabelError, 'code' | 'message' | 'item'>): string {
  if (error.code === 'DOES_NOT_FIT' && error.item !== undefined) return doesNotFitMessage(error.item)
  return error.message
}

// ── 견본·최악값 (AC-I1-25·26) ─────────────────────────────────────────────

/** 판매자 샘플 라벨 (194번 · 왕비뇌신금 · 8,000원 · 26.10.08 · 우주천사) */
export const SAMPLE_PRODUCT: ProductLabelData = { no: 194, name: '왕비뇌신금', price: 8000, date: '2026-10-08', buyer: { kind: 'youtube', name: '우주천사' } }
/** 가장 넓은 날짜: 2000~2099의 모든 YY.MM.DD 중 내장 글꼴로 가장 넓은 `04.04.04` (L-11 13, D-STB-01) */
export const WIDEST_DATE = '2004-04-04'
/** 가장 긴 값 (번호 9999 · 가격 99,999,999원 · 날짜 04.04.04 · 긴 품종·닉네임) */
export const LONGEST_PRODUCT: ProductLabelData = {
  no: 9999,
  // 음성 기본 사전의 표지 낱말('블루엘프')은 넣지 않는다 — 첫 화면 JS에 음성 사전이 없는지 그 낱말로 확인한다(AC-I4-10)
  name: '아주 긴 이름의 다육식물 품종명 핑크프릴 왕비뇌신금 금황환 미니마 라즈베리아이스',
  price: 99_999_999,
  date: WIDEST_DATE,
  buyer: { kind: 'youtube', name: '다육이사랑하는우주천사님반가워요길고긴닉네임' },
}
export const SAMPLE_PACKING: PackingLabelData = {
  date: '2026-10-08',
  buyer: { kind: 'youtube', name: '우주천사' },
  broadcasts: [{ title: '1부', numbers: [3, 15, 194] }],
  subtotal: 31_000,
}

/** 가장 긴 포장 값: 네 자리 번호 998개 + 다른 방송 1개 = 상품 999개, 상품 합계 99,999,999원 */
export function longestPacking(): PackingLabelData {
  return {
    date: WIDEST_DATE,
    buyer: { kind: 'youtube', name: '다육이사랑하는우주천사님반가워요길고긴닉네임' },
    broadcasts: [
      { title: '아주 긴 방송 제목 다육이 금요일 밤 라이브 특별 할인전', numbers: Array.from({ length: 998 }, (_, i) => 9999 - i) },
      { title: '2부', numbers: [9999] },
    ],
    subtotal: 99_999_999,
  }
}

/** 견본 데이터로 미리 보기 (가장 긴 값이면 포장은 첫 쪽·마지막 쪽) */
export function renderSample(env: LabelRenderEnv, template: LabelTemplate, longest: boolean): PagesOutcome {
  if (template.kind === 'product') {
    const result = renderProduct(env, template, longest ? LONGEST_PRODUCT : SAMPLE_PRODUCT)
    return result.ok ? { ok: true, images: [result.image] } : result
  }
  if (!longest) return renderPacking(env, template, SAMPLE_PACKING)
  return renderPackingEnds(env, template, longestPacking())
}

/** 포장 라벨의 첫 쪽과 마지막 쪽만 그린다 (쪽이 수백이어도 빠르게 — 가운데 쪽은 첫 쪽과 같은 길이다) */
function renderPackingEnds(env: LabelRenderEnv, template: PackingTemplate, data: PackingLabelData): PagesOutcome {
  const text = computePackingText(template, data)
  if (!text.ok) return text
  const pages = text.text.pages
  const picks = pages.length <= 2 ? pages : [pages[0], pages.at(-1)]
  const images: LabelBitmap[] = []
  for (const page of picks) {
    if (page === undefined) continue
    const rendered = renderPackingPage(env, text.text, page)
    if (!rendered.ok) return rendered
    images.push(rendered.image)
  }
  return { ok: true, images }
}

/** 저장 전 검사 결과 (AC-I1-26) */
export type TemplateCheckResult =
  | { readonly ok: true; readonly template: LabelTemplate; readonly warnings: readonly TemplateProblem[] }
  | { readonly ok: false; readonly problems: readonly TemplateProblem[]; readonly warnings: readonly TemplateProblem[] }
  | { readonly ok: false; readonly doesNotFit: string; readonly item: string | undefined; readonly warnings: readonly TemplateProblem[] }

/**
 * 템플릿 검사 + 최악값으로 그려 보기. 검사 오류면 문제 목록, 최악값이 들어가지 않으면 그 항목의 문장.
 * 상품: 번호 9999, 가격 99,999,999원·99,999 천원, 날짜 04.04.04. 포장: 네 자리 번호 한 장 번호 수만큼 + 상품 합계 99,999,999원 + 상품 999개 + 날짜 04.04.04.
 * 라벨 설정 화면을 열 때 저장된 설정에도 같은 검사를 돌려 경고한다(L-11 13)
 */
export function checkTemplate(env: LabelRenderEnv, value: LabelTemplate): TemplateCheckResult {
  const checked = validateTemplate(value)
  if (!checked.ok) return { ok: false, problems: checked.error.problems ?? [], warnings: checked.warnings }
  const template = checked.template
  const fail = (error: LabelError): TemplateCheckResult => ({ ok: false, doesNotFit: labelErrorMessage(error), item: error.item, warnings: checked.warnings })
  if (template.kind === 'product') {
    for (const price of [99_999_999, 99_999_000]) {
      const result = renderProductLabel(env, template, { ...LONGEST_PRODUCT, price })
      if (!result.ok) return fail(result.error)
    }
  } else {
    const result = renderPackingEnds(env, template, longestPacking())
    if (!result.ok) return fail(result.error)
  }
  return { ok: true, template, warnings: checked.warnings }
}

// ── 내보내기 (AC-I1-40~42) ────────────────────────────────────────────────

/** 상품 라벨 PNG 이름 `라벨-2026-10-18-15번.png` */
export const productPngName = (date: string, no: number): string => `라벨-${date}-${String(no)}번.png`
/** 상품 라벨 PDF 이름 `라벨-2026-10-18-15번.pdf` */
export const productPdfName = (date: string, no: number): string => `라벨-${date}-${String(no)}번.pdf`
/** 포장 라벨 PNG 이름 (쪽마다) `포장라벨-2026-10-18-1쪽.png` */
export const packingPngName = (date: string, page: number): string => `포장라벨-${date}-${String(page)}쪽.png`
/** 포장 라벨 PDF 이름 `포장라벨-2026-10-18.pdf` */
export const packingPdfName = (date: string): string => `포장라벨-${date}.pdf`
/** 방송 1등 라벨 A4 이름 `라벨-2026-10-18-1-A4.pdf` (방송 제목은 넣지 않는다) */
export const broadcastA4Name = (date: string, order: number): string => `라벨-${date}-${String(order)}-A4.pdf`
/** 대기 라벨 A4 이름 `라벨-대기-2026-10-20-A4.pdf` */
export const waitingA4Name = (today: string): string => `라벨-대기-${today}-A4.pdf`

export type BytesOutcome = { readonly ok: true; readonly bytes: Uint8Array } | { readonly ok: false; readonly message: string }

export function pngBytes(image: LabelBitmap): BytesOutcome {
  const result = encodeLabelPng(image)
  return result.ok ? { ok: true, bytes: result.bytes } : { ok: false, message: result.error.message }
}

export function labelPdfBytes(images: readonly LabelBitmap[]): BytesOutcome {
  const result = createLabelPdf(images)
  return result.ok ? { ok: true, bytes: result.bytes } : { ok: false, message: result.error.message }
}

export function a4PdfBytes(images: readonly LabelBitmap[]): BytesOutcome {
  const result = createA4Pdf(images)
  return result.ok ? { ok: true, bytes: result.bytes } : { ok: false, message: result.error.message }
}

/** 지금 템플릿 (서버에서 받기 전이면 기본 템플릿) */
export function productTemplateOf(stored: ProductTemplate | undefined): ProductTemplate {
  return stored ?? defaultTemplate('product')
}

export function packingTemplateOf(stored: PackingTemplate | undefined): PackingTemplate {
  return stored ?? defaultTemplate('packing')
}

/** 라벨 데이터의 종류 */
export const isPackingData = (data: LabelData): data is PackingLabelData => 'broadcasts' in data
