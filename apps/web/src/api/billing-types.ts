// 요금 API 응답 모양 (N5 — harness/sprints/N5/dev-notes.md "dev-server 바뀐 계약" 1~12). 시각은 UTC ISO 문자열이고 화면이 KST로 보인다.
// 영어 값(종류·상태·수단)은 화면에 그대로 보이지 않는다 — lib/billing-words.ts의 낱말로만 보인다(UX-01, BL-9 3).

/** 이용권 종류 (BL-1) */
export type PassKind = 'FLAT_30D' | 'DAYS' | 'ORDERS' | 'LABELS'
/** 정량 이용권 종류 */
export type QuantityKind = Exclude<PassKind, 'FLAT_30D'>
/** 방송의 이용 방식 (BL-4) */
export type StartMode = 'FLAT' | 'DAY' | 'ORDERS'
/** 결제 수단 (BL-6 2) */
export type PayMethod = 'CARD' | 'TRANSFER'
/** 결제 주문 상태 */
export type OrderState = 'PENDING' | 'FAILED' | 'GRANTED' | 'MISMATCH_CANCELLED' | 'NEEDS_REVIEW' | 'REFUNDED'
/** 결제 확인 판단 결과 */
export type ConfirmResult = 'GRANT' | 'WAIT' | 'FAIL' | 'CANCEL_MISMATCH' | 'REVIEW' | 'NONE' | 'LOOKUP_FAILED'
/** 계좌이체 증빙 종류 (BL-8 1) */
export type ReceiptKind = 'TAX_INVOICE' | 'CASH_RECEIPT'

/** /api/client-config의 요금 항목 (AC-N5-11·40) */
export type BillingConfig =
  | { readonly enabled: false; readonly testPayment: false }
  | { readonly enabled: true; readonly testPayment: true }
  | { readonly enabled: true; readonly testPayment: false; readonly storeId: string; readonly channelKey: string }

/** "지금 시작하면" 미리 보기 (BL-4 6, BL-9 2) */
export type StartPreview =
  | { readonly allowed: false; readonly reason: 'NO_PASS' }
  | {
      readonly allowed: true
      readonly mode: StartMode
      readonly useDay: boolean
      readonly flatUntil: string | null
      readonly windowUntil: string | null
      readonly days: { readonly before: number; readonly after: number } | null
      readonly orders: number | null
    }

/** 알림 띠 (BL-9 1) — 문장은 화면이 만든다 */
export type Banner =
  | { readonly kind: 'FLAT_REMAINING'; readonly days: number; readonly until: string }
  | { readonly kind: 'FLAT_ENDED'; readonly at: string }
  | { readonly kind: 'NO_PASS' }
  | { readonly kind: 'ORDERS_OVER'; readonly count: number }
  | { readonly kind: 'LABELS_OVER'; readonly count: number }

/** 요금 표 항목 (판매 중인 것만) */
export interface PriceItem {
  readonly id: string
  readonly name: string
  readonly kind: PassKind
  readonly quantity: number | null
  /** 원, 부가세 포함 */
  readonly price: number
}

/** 사업자 정보 (번호는 가린 값만 온다) */
export interface BusinessView {
  readonly masked: string
  readonly name: string | null
  readonly ceo: string | null
  readonly email: string | null
  readonly receiptKind: ReceiptKind
  /** 상호·대표자까지 있다 — 아니면 결제 주문을 만들지 않는다 */
  readonly complete: boolean
}

/** 요금 상태 GET /api/billing (AC-N5-13) */
export interface BillingStatus {
  readonly now: string
  readonly flat: {
    readonly active: boolean
    /** 이용 중이면 이어진 마지막 끝 ("…까지") */
    readonly until: string | null
    /** 이용 중이 아니고 사슬이 있으면 마지막 끝 ("끝남 (…)") */
    readonly endedAt: string | null
    readonly chain: readonly { readonly grant: string; readonly from: string; readonly until: string }[]
  }
  /** 잔량 (음수 = 초과) */
  readonly balances: Readonly<Record<QuantityKind, number>>
  /** 열린 방송 일 24시간 창 */
  readonly window: { readonly from: string; readonly until: string } | null
  readonly start: StartPreview
  readonly banners: readonly Banner[]
  readonly items: readonly PriceItem[]
  readonly business: BusinessView | null
  readonly testPayment: boolean
}

/** 결제 주문 POST /api/billing/orders 응답 (AC-N5-30) */
export interface OrderCreated {
  readonly paymentId: string
  readonly orderName: string
  readonly amount: number
  readonly currency: 'KRW'
  readonly method: PayMethod
  readonly itemId: string
  readonly kind: PassKind
  readonly quantity: number | null
  readonly testPayment: boolean
  /** 운영 결제 창 공개 값 (시험이면 null) */
  readonly storeId: string | null
  readonly channelKey: string | null
}

/** 결제 확인 POST /api/billing/orders/:paymentId/confirm 응답 (AC-N5-31) */
export interface ConfirmView {
  readonly paymentId: string
  readonly result: ConfirmResult
  readonly state: OrderState
  /** BL-9 4 문장 (서버가 정한 그대로 보인다) */
  readonly message: string
  readonly itemName: string
  readonly amount: number
}

/** 환불 POST /api/billing/orders/:paymentId/refund 응답 (AC-N5-36) */
export interface RefundView {
  readonly paymentId: string
  readonly state: 'REFUNDED'
  readonly message: string
}

/** 증빙 (계좌이체만) */
export interface DocumentView {
  readonly kind: ReceiptKind
  readonly status: 'PENDING' | 'ISSUED' | 'FAILED'
  readonly approval: string | null
  readonly cancel: 'REQUESTED' | 'CANCELLED' | 'FAILED' | null
}

/** 결제 내역 항목 (AC-N5-54) */
export type PaymentItem =
  | {
      readonly type: 'order'
      readonly paymentId: string
      readonly itemId: string
      readonly itemName: string
      readonly kind: PassKind
      readonly quantity: number | null
      readonly amount: number
      readonly method: PayMethod
      readonly paidMethod: string | null
      readonly state: OrderState
      readonly createdAt: string
      readonly grantedAt: string | null
      readonly refundedAt: string | null
      /** 그 순간 7일 환불할 수 있는지 (서버 판단 — "환불" 버튼) */
      readonly refundable: boolean
      /** 환불을 처리하는 중 */
      readonly refunding: boolean
      readonly document: DocumentView | null
    }
  | {
      readonly type: 'operator'
      readonly grantId: string
      readonly kind: PassKind
      readonly quantity: number | null
      readonly reason: string
      readonly at: string
      readonly revoked: boolean
    }

export type OrderItem = Extract<PaymentItem, { readonly type: 'order' }>

/** 쓴 내역 항목 (AC-N5-55) */
export interface UsageItem {
  readonly id: number
  readonly kind: QuantityKind
  readonly at: string
  readonly broadcast: { readonly id: string; readonly title: string; readonly date: string } | null
  /** 주문 건: 지금 번호 · 라벨 장: 라벨의 번호 */
  readonly productNo: number | null
  /** 주문 건: 지금 품종 */
  readonly productName: string | null
  /** 방송 일: 24시간 창 끝 */
  readonly windowUntil: string | null
}

/** 이어 받는 목록 */
export interface ListPage<T> {
  readonly items: readonly T[]
  readonly next: string | null
}
