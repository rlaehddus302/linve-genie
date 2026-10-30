// 빠른 입력칸 한 줄의 할 일 (PRD-01, PRD-03 AC3, R-16, D-084, AC-S05-10~13).
// SRV1 (D-APP-23·24): 친 줄·고치기 칸을 번호·품종·가격으로 읽고 할 일(등록·"고칠까요?"·자세히·고치기 칸)을 정하는 일은 서버가 한다
// (서버 읽기 입구 kind `quick`·`fix`, lib/read.ts). 이 파일은 서버가 읽은 결과를 화면의 상품(번호로 찾기)에 잇고, 보이는 문장을 만든다 — 글을 읽지 않는다.
import type { QuickInputError, SaleSettings } from '@livejjim/core'
import type { Product } from '../api/types.ts'
import type { QuickRead } from './read.ts'

/** 고치기 칸의 커서 (AC-S05-11 표) */
export type FixField = 'no' | 'name' | 'price'

export type QuickDecision =
  /** 빈 줄: 아무 일도 없다 */
  | { readonly kind: 'none' }
  /** 그 번호의 상품이 없다: 등록 */
  | { readonly kind: 'register'; readonly no: number; readonly name: string; readonly price: number }
  /** 그 번호의 상품 기록이 있다: "고칠까요?" */
  | { readonly kind: 'edit'; readonly product: Product; readonly no: number; readonly name: string; readonly price: number }
  /** 번호만 쳤고 그 상품이 있다: 상품 자세히 */
  | { readonly kind: 'open'; readonly product: Product }
  /** 오류: 등록하지 않고 고치기 칸을 연다 */
  | {
      readonly kind: 'fix'
      readonly error: Exclude<QuickInputError, 'EMPTY'>
      readonly no: number | null
      readonly name: string | null
      readonly focus: FixField
      readonly message: string
      /** 번호 칸에 그대로 둘 글자 (범위 밖 번호 — 친 첫 토큰, AC-S06-65) */
      readonly noText?: string
      /** 가격 칸에 채울 글자 (번호 오류 때 나머지에서 읽은 가격, AC-S06-65) */
      readonly priceText?: string
    }

/**
 * 판매자가 친 원문 칸 (SRV1 약속 2): 빠른 입력 한 줄(`text`) 또는 고치기 칸의 번호·가격 칸(`noText`·`priceText`).
 * 쓰기 본문에는 번호·가격 숫자 대신 이 원문을 보낸다 — 서버가 미리 보기와 같은 함수로 다시 읽어 기록한다.
 */
export type TypedFields = { readonly text: string } | { readonly noText: string; readonly priceText: string }

/** 쓰기 본문의 상품 칸 (원문 그대로). 고치기 칸은 품종 칸(name)도 함께 — 품종은 읽을 것이 없는 글이다 */
export function typedBody(typed: TypedFields, name: string): Record<string, string> {
  return 'text' in typed ? { text: typed.text } : { noText: typed.noText, name, priceText: typed.priceText }
}

/**
 * 서버가 읽은 결과 → 할 일 (D-084 가~라). 서버는 그 방송의 상품으로 등록·"고칠까요?"·자세히를 정했다 — 화면은 그 번호의 상품을 찾아 잇는다.
 * 화면이 아직 그 상품을 받지 못했으면(다른 기기가 막 등록) "고칠까요?"는 등록으로 보낸다 — 서버가 다시 읽어 "이미 있어요"(409)로 돌려준다.
 */
export function decisionOf(read: QuickRead, findProduct: (no: number) => Product | undefined): QuickDecision {
  switch (read.decision) {
    case 'none':
      return { kind: 'none' }
    case 'register':
    case 'edit': {
      if (read.no === null || read.price === null) return { kind: 'none' }
      const name = read.name ?? ''
      const product = read.decision === 'edit' ? findProduct(read.no) : undefined
      if (product !== undefined) return { kind: 'edit', product, no: read.no, name, price: read.price }
      return { kind: 'register', no: read.no, name, price: read.price }
    }
    case 'open': {
      const product = read.no === null ? undefined : findProduct(read.no)
      return product === undefined ? { kind: 'none' } : { kind: 'open', product }
    }
    case 'fix': {
      const error = read.error ?? 'NUMBER_MISSING'
      const focus: FixField = read.focus ?? (error === 'PRICE_MISSING' || error === 'PRICE_TOO_LOW' ? 'price' : 'no')
      return {
        kind: 'fix',
        error,
        no: read.no,
        name: read.name,
        focus,
        message: read.message ?? '',
        ...(read.noText === null ? {} : { noText: read.noText }),
        ...(read.priceText === null ? {} : { priceText: read.priceText }),
      }
    }
  }
}

/**
 * "고칠까요?"에서 바뀐 칸 (품종·가격, 개수 칸이 1이 아니면 개수도 — 바뀐 것만). 친 줄에 품종이 없으면(`15 12000`) 품종은 그대로 둔다 —
 * 가격만 고치려던 줄이 품종을 지우지 않게.
 */
export function changedFields(product: Product, name: string, price: number, stock?: number): { name?: string; price?: number; stock?: number } {
  return {
    ...(name !== '' && name !== product.name ? { name } : {}),
    ...(price !== product.price ? { price } : {}),
    // 개수 칸(옵션 없는 상품만, AC-ORD11-08): 칸이 1이면 넘기지 않는다 — 재고는 그대로
    ...(stock !== undefined && !product.hasOptions && stock !== product.stock ? { stock } : {}),
  }
}

/** 같은 번호를 다시 쳤을 때의 물음 (AC-S05-13): 판매 종료된 상품이면 다시 팔지를 묻는다 */
export function editQuestion(no: number, closed: boolean): string {
  return closed ? `${String(no)}번은 판매 종료된 상품이에요. 새 값으로 고쳐서 다시 팔까요?` : `${String(no)}번이 이미 있어요. 고칠까요?`
}

// ── 가격 단위 한 줄 (FB1 D-FB1-01, AC-FB1-02·03) ─────────────
// "등록하면: …" 미리 보기와 고치기 칸 "= …원"은 서버가 읽은 답(read.preview)이다 — Enter로 보내면 서버가 같은 함수로 다시 읽는다.

/** 빠른 입력칸 아래 그 방송의 가격 단위 한 줄 */
export function unitLine(unit: SaleSettings['price.unit']): string {
  // 모르는 값은 없다(코어 checkSettings가 스냅샷을 거른다) — 그래도 천원으로 추측해 보이지 않게 셋을 따로 (SA-FB1-02)
  if (unit === 'WON') return '가격 단위: 원 — 10000은 10,000원, 2만은 20,000원'
  if (unit === 'TEN_THOUSAND') return '가격 단위: 만원 — 15는 150,000원, 5천은 5,000원'
  // D-V3-70: 두 자리 이하는 만원, 세 자리는 천원, 1000 이상은 원 그대로
  if (unit === 'AUTO') return '가격 단위: 자동 — 25는 250,000원, 180은 180,000원, 15000은 15,000원'
  return '가격 단위: 천원 — 10은 10,000원, 2만은 20,000원'
}
