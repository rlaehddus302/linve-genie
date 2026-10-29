// 빠른 입력칸 한 줄의 뜻 (PRD-01, D-084, 웹 lib/quick.ts와 같은 규칙).
// 읽기는 코어의 입력 읽기 함수(parseQuickInput — 번호·품종·가격 읽기, 판정이 아니다)에 그 방송 스냅샷의 price.unit·claim.maxNumber를 넣은 결과다.
// 앱 번들에는 코어 판정 엔진이 들어가지 않는다 — 입력 읽기 모듈(@livejjim/core/quick-input)만 가져온다(APP-01 AC3).
import { parseQuickInput, type QuickInputError } from '@livejjim/core/quick-input'
import type { Product } from '@livejjim/web/src/api/types.ts'
import { formatWon } from './words.ts'

export interface QuickSettings {
  readonly 'price.unit': 'WON' | 'THOUSAND' | 'TEN_THOUSAND' | 'AUTO'
  readonly 'claim.maxNumber': number
}

/** 방송 설정 스냅샷 → 빠른 입력 설정 (웹 quickSettings) */
export function quickSettings(settings: { readonly 'price.unit': string; readonly 'claim.maxNumber': number } | undefined): QuickSettings {
  const unit = settings?.['price.unit']
  return {
    'price.unit': unit === 'WON' || unit === 'TEN_THOUSAND' || unit === 'AUTO' ? unit : 'THOUSAND',
    'claim.maxNumber': settings?.['claim.maxNumber'] ?? 999,
  }
}

export type QuickDecision =
  | { readonly kind: 'none' }
  | { readonly kind: 'register'; readonly no: number; readonly name: string; readonly price: number }
  | { readonly kind: 'edit'; readonly product: Product; readonly no: number; readonly name: string; readonly price: number }
  | { readonly kind: 'open'; readonly product: Product }
  | { readonly kind: 'fix'; readonly error: Exclude<QuickInputError, 'EMPTY'>; readonly message: string }

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

/** 빠른 입력 한 줄 → 할 일 (D-084 가~라) */
export function decideQuickInput(text: string, settings: QuickSettings, findProduct: (no: number) => Product | undefined): QuickDecision {
  const parsed = parseQuickInput(text, settings)
  if ('error' in parsed) {
    if (parsed.error === 'EMPTY') return { kind: 'none' }
    const no = parsed.no ?? null
    if (parsed.error === 'PRICE_MISSING' && no !== null && (parsed.name ?? '') === '') {
      const product = findProduct(no)
      if (product !== undefined) return { kind: 'open', product }
    }
    return { kind: 'fix', error: parsed.error, message: quickErrorMessage(parsed.error, settings['claim.maxNumber']) }
  }
  const product = findProduct(parsed.no)
  if (product !== undefined) return { kind: 'edit', product, no: parsed.no, name: parsed.name, price: parsed.price }
  return { kind: 'register', no: parsed.no, name: parsed.name, price: parsed.price }
}

/** 빠른 입력칸 아래 그 방송의 가격 단위 한 줄 (FB1 D-FB1-01) */
export function unitLine(unit: QuickSettings['price.unit']): string {
  if (unit === 'WON') return '가격 단위: 원 — 10000은 10,000원, 2만은 20,000원'
  if (unit === 'TEN_THOUSAND') return '가격 단위: 만원 — 15는 150,000원, 5천은 5,000원'
  if (unit === 'AUTO') return '가격 단위: 자동 — 25는 250,000원, 180은 180,000원, 15000은 15,000원'
  return '가격 단위: 천원 — 10은 10,000원, 2만은 20,000원'
}

/** 친 줄이 새 상품 등록으로 읽히면 "등록하면: 15번 엘레강스 10,000원", 아니면 null */
export function registerPreview(text: string, settings: QuickSettings, findProduct: (no: number) => Product | undefined): string | null {
  const decision = decideQuickInput(text, settings, findProduct)
  if (decision.kind !== 'register') return null
  return `등록하면: ${String(decision.no)}번 ${decision.name === '' ? '' : `${decision.name} `}${formatWon(decision.price)}`
}

/** 같은 번호를 다시 쳤을 때의 물음 (AC-S05-13) */
export function editQuestion(no: number, closed: boolean): string {
  return closed ? `${String(no)}번은 판매 종료된 상품이에요. 새 값으로 고쳐서 다시 팔까요?` : `${String(no)}번이 이미 있어요. 고칠까요?`
}
