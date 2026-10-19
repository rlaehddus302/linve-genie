// 빠른 입력칸 한 줄의 뜻 (PRD-01, PRD-03 AC3, R-16, D-084, AC-S05-10~13).
// 해석은 코어 parseQuickInput·parseAmount에 그 방송 스냅샷의 price.unit·claim.maxNumber를 넣은 결과다(화면이 따로 해석하지 않는다).
import { DEFAULT_SETTINGS, parseAmount, parseQuickInput, type QuickInputError, type SaleSettings } from '@livejjim/core'
import type { Product } from '../api/types.ts'

export interface QuickSettings {
  readonly 'price.unit': SaleSettings['price.unit']
  readonly 'claim.maxNumber': number
}

export function quickSettings(settings: SaleSettings): QuickSettings {
  return { 'price.unit': settings['price.unit'], 'claim.maxNumber': settings['claim.maxNumber'] }
}

/** 방송 설정을 아직 모를 때 (코어 기본값) */
const DEFAULT_QUICK: QuickSettings = quickSettings(DEFAULT_SETTINGS)

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
    }

/** 오류 문장 (AC-S05-11 표 그대로) */
export function quickErrorMessage(error: Exclude<QuickInputError, 'EMPTY'>, maxNumber: number): string {
  switch (error) {
    case 'PRICE_MISSING':
      return '가격을 알아보지 못했어요. 가격 칸에 적어 주세요.'
    case 'PRICE_TOO_LOW':
      return '가격이 100원보다 적어요. 가격을 확인해 주세요.'
    case 'NUMBER_MISSING':
      return '맨 앞에 상품 번호를 적어 주세요. 예: 15 핑크프릴 10000'
    case 'NUMBER_INVALID':
      return `번호는 1부터 ${String(maxNumber)}까지예요. 번호를 확인해 주세요.`
  }
}

function focusOf(error: Exclude<QuickInputError, 'EMPTY'>): FixField {
  return error === 'PRICE_MISSING' || error === 'PRICE_TOO_LOW' ? 'price' : 'no'
}

function fix(error: Exclude<QuickInputError, 'EMPTY'>, settings: QuickSettings, no: number | null, name: string | null): QuickDecision {
  return { kind: 'fix', error, no, name, focus: focusOf(error), message: quickErrorMessage(error, settings['claim.maxNumber']) }
}

/** 빠른 입력 한 줄 → 할 일 (D-084 가~라) */
export function decideQuickInput(text: string, settings: QuickSettings, findProduct: (no: number) => Product | undefined): QuickDecision {
  const parsed = parseQuickInput(text, settings)
  if ('error' in parsed) {
    if (parsed.error === 'EMPTY') return { kind: 'none' }
    const no = parsed.no ?? null
    const name = parsed.name ?? null
    // (다) 번호만 쳤고 그 번호의 상품이 있으면 그 상품 자세히
    if (parsed.error === 'PRICE_MISSING' && no !== null && (name ?? '') === '') {
      const product = findProduct(no)
      if (product !== undefined) return { kind: 'open', product }
    }
    return fix(parsed.error, settings, no, name)
  }
  const product = findProduct(parsed.no)
  if (product !== undefined) return { kind: 'edit', product, no: parsed.no, name: parsed.name, price: parsed.price }
  return { kind: 'register', no: parsed.no, name: parsed.name, price: parsed.price }
}

/**
 * 번호 칸 글자 → 번호 (코어 parseQuickInput이 줄의 첫 토큰을 읽는 것과 같다 — 전각 숫자·"15번"·"15 번").
 * 번호 하나만 적힌 칸이면 그 번호, 비면 'empty', 번호 하나가 아니거나 범위 밖이면 null.
 */
function readNumberField(text: string, settings: QuickSettings): number | 'empty' | null {
  const parsed = parseQuickInput(text, settings)
  if (!('error' in parsed)) return null
  if (parsed.error === 'EMPTY') return 'empty'
  // 번호 뒤에 아무것도 없을 때만 (번호 칸에 품종·가격이 섞이면 번호로 보지 않는다)
  return parsed.error === 'PRICE_MISSING' && parsed.no !== undefined && parsed.name === '' ? parsed.no : null
}

/** 고치기 칸(번호·품종·가격) → 할 일. 번호는 빠른 입력과 같은 번호 해석, 가격은 같은 금액 해석(코어 parseQuickInput·parseAmount) */
export function decideFixForm(
  input: { readonly no: string; readonly name: string; readonly price: string },
  settings: QuickSettings,
  findProduct: (no: number) => Product | undefined,
): QuickDecision {
  const name = input.name.trim()
  const no = readNumberField(input.no, settings)
  if (no === 'empty') return fix('NUMBER_MISSING', settings, null, name)
  if (no === null) return fix('NUMBER_INVALID', settings, null, name)
  const price = parseAmount(input.price, settings)
  if (price === null) return fix('PRICE_MISSING', settings, no, name)
  if (price < 100) return fix('PRICE_TOO_LOW', settings, no, name)
  const product = findProduct(no)
  if (product !== undefined) return { kind: 'edit', product, no, name, price }
  return { kind: 'register', no, name, price }
}

/**
 * 치는 동안 첫 토큰의 번호 (번호 찾기 미리 보기, PRD-03 AC3). 코어 parseQuickInput이 그 줄에서 읽은 번호다
 * (성공·가격 오류 모두 번호가 있다). 번호를 읽지 못한 줄이면 null.
 */
export function previewNumber(text: string, settings: QuickSettings = DEFAULT_QUICK): number | null {
  const parsed = parseQuickInput(text, settings)
  return parsed.no ?? null
}

/**
 * "고칠까요?"에서 바뀐 칸 (품종·가격만, 바뀐 것만). 친 줄에 품종이 없으면(`15 12000`) 품종은 그대로 둔다 —
 * 가격만 고치려던 줄이 품종을 지우지 않게.
 */
export function changedFields(product: Product, name: string, price: number): { name?: string; price?: number } {
  return {
    ...(name !== '' && name !== product.name ? { name } : {}),
    ...(price !== product.price ? { price } : {}),
  }
}
