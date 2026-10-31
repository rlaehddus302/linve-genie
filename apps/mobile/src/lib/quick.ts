// 빠른 입력칸 한 줄의 할 일 (PRD-01, D-084, 웹 lib/quick.ts와 같은 규칙).
// SRV1 (D-APP-23·24, AC-SRV1-05): 앱은 줄을 읽지 않는다 — 서버 읽기 입구가 읽은 결과(lib/read.ts)와 그 방송 상품 목록(번호로 찾기)으로
// 할 일만 정한다. 앱 번들에 입력 읽기 모듈(@livejjim/core/quick-input)이 들어가지 않는다.
import type { Product } from '@livejjim/web/src/api/types.ts'
import type { QuickReading } from './read.ts'

export type PriceUnit = 'WON' | 'THOUSAND' | 'TEN_THOUSAND' | 'AUTO'

/** 방송 설정 스냅샷의 가격 단위 (모르는 값이면 천원 — 웹 단위 줄과 같은 기본) */
export function priceUnitOf(settings: { readonly 'price.unit': string } | undefined): PriceUnit {
  const unit = settings?.['price.unit']
  return unit === 'WON' || unit === 'TEN_THOUSAND' || unit === 'AUTO' ? unit : 'THOUSAND'
}

export type QuickDecision =
  | { readonly kind: 'none' }
  | { readonly kind: 'register'; readonly no: number; readonly name: string; readonly price: number }
  | { readonly kind: 'edit'; readonly product: Product; readonly no: number; readonly name: string; readonly price: number }
  | { readonly kind: 'open'; readonly product: Product }
  | { readonly kind: 'fix'; readonly message: string }

/** 서버가 읽은 빠른 입력 한 줄 → 할 일 (D-084 가~라 — 서버가 정한 할 일을 화면 상품에 잇는다) */
export function decideQuick(reading: QuickReading, findProduct: (no: number) => Product | undefined): QuickDecision {
  switch (reading.decision) {
    case 'none':
      return { kind: 'none' }
    case 'fix':
      return { kind: 'fix', message: reading.message ?? '' }
    case 'open': {
      const product = reading.no === null ? undefined : findProduct(reading.no)
      return product === undefined ? { kind: 'none' } : { kind: 'open', product }
    }
    case 'register':
    case 'edit': {
      if (reading.no === null || reading.price === null) return { kind: 'none' }
      const name = reading.name ?? ''
      const product = reading.decision === 'edit' ? findProduct(reading.no) : undefined
      if (product !== undefined) return { kind: 'edit', product, no: reading.no, name, price: reading.price }
      return { kind: 'register', no: reading.no, name, price: reading.price }
    }
  }
}

/** 빠른 입력칸 아래 그 방송의 가격 단위 한 줄 (FB1 D-FB1-01) */
export function unitLine(unit: PriceUnit): string {
  if (unit === 'WON') return '가격 단위: 원 — 10000은 10,000원, 2만은 20,000원'
  if (unit === 'TEN_THOUSAND') return '가격 단위: 만원 — 15는 150,000원, 5천은 5,000원'
  if (unit === 'AUTO') return '가격 단위: 자동 — 25는 250,000원, 180은 180,000원, 15000은 15,000원'
  return '가격 단위: 천원 — 10은 10,000원, 2만은 20,000원'
}

/**
 * 빠른 입력칸 예시 (D-UX2-07): 아래 단위 줄과 같은 단위로 적은 예. 천원 단위에서 "10000"도 10,000원이지만(1000 이상은 원 그대로, R-14),
 * 예시가 원 단위처럼 보이면 사장님이 단위를 헷갈린다 — 예시는 그 방송 단위의 대표 꼴로만.
 */
export function quickPlaceholder(unit: PriceUnit): string {
  if (unit === 'WON') return '15 핑크프릴 10000'
  if (unit === 'TEN_THOUSAND') return '15 핑크프릴 2'
  if (unit === 'AUTO') return '15 핑크프릴 180'
  return '15 핑크프릴 10'
}

/** 서버가 새 상품 등록으로 읽은 줄이면 "등록하면: 15번 엘레강스 10,000원"(서버 글), 아니면(답 없음 포함) null */
export function registerPreview(reading: QuickReading | null): string | null {
  return reading?.preview ?? null
}

/** 같은 번호를 다시 쳤을 때의 물음 (AC-S05-13) */
export function editQuestion(no: number, closed: boolean): string {
  return closed ? `${String(no)}번은 판매 종료된 상품이에요. 새 값으로 고쳐서 다시 팔까요?` : `${String(no)}번이 이미 있어요. 고칠까요?`
}
