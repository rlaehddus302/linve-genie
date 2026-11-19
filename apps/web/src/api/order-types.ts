// 주문 탭 목록·주문 상세 (D-UX4-125, 사용자 지시 2026-11-11 "주문 탭 수정 사항 … 사진1처럼 주문 목록 … 사진2처럼 상세 내역").
// 서버 GET /api/orders(날짜를 넘어 최근 주문부터)와 GET /api/days/:date/order?buyer=(주문 한 건 상세)가 이 모양을 돌려준다. 앱이 같이 쓴다.
import type { PaymentStatus } from '@livejjim/core'

/** 손님이 찜한 곳 — SMS는 문자 찜(전화번호로 이어지는 손님) */
export type OrderPlatform = 'YOUTUBE' | 'INSTAGRAM' | 'TIKTOK' | 'BAND' | 'SMS'

/** 주문 목록 한 줄 = 그날 구매자 묶음 하나 (품목이 있는 것만) */
export interface OrderRow {
  /** YYYY-MM-DD (판매 날짜, KST) */
  readonly date: string
  /** 그날 묶음 구매자 키 (상세 ?buyer= 에 그대로) */
  readonly buyer: string
  /** 성함 = 배송지 받는 분 이름. 아직 모르면 null */
  readonly name: string | null
  /** 닉네임 = 채팅 이름(문자 손님은 화면에 보이던 이름 그대로) */
  readonly nickname: string
  /** 모르면 null */
  readonly platform: OrderPlatform | null
  /** 최종 금액(원, 배송비·할인 포함) */
  readonly total: number
  /** 총 상품 개수(수량 합) */
  readonly itemCount: number
  /** 그날 이 손님의 첫 예약 시각 (UTC ISO) — 같은 날짜 안의 줄 순서(늦은 것 먼저) */
  readonly firstClaimAt: string | null
  /** 아직 모르는 손님 정보 (D-UX4-126 — 목록에 빨간 "성함 · 휴대폰 번호 · 주소 모름"). 이 순서로, 다 알면 빈 목록 */
  readonly missing: readonly OrderInfoField[]
  /** 받은 금액(원, D-ORDPAY-01 — 목록 줄 입금 체크) */
  readonly received: number
  /** 입금 상태 (PAID·OVERPAID면 목록에 체크) */
  readonly payment: PaymentStatus
  /** 봉인 날짜(30일 지남) — 목록에서 입금 체크를 적을 수 없다 */
  readonly sealed: boolean
}

/** 손님 정보 칸 (주문 상세 위 세 줄 · 정보 입력 화면 단계) */
export type OrderInfoField = 'name' | 'phone' | 'address'

export interface OrdersView {
  /** 서버 KST 오늘 */
  readonly today: string
  /** 최근 날짜부터, 같은 날짜 안에서는 첫 예약이 늦은 손님부터. 리허설은 없다 */
  readonly orders: readonly OrderRow[]
  readonly more: boolean
  /** 다음 쪽 ?before= 값 (이 날짜보다 앞선 날짜들). 없으면 null */
  readonly next: string | null
}

/** 상세의 상품 한 줄 */
export interface OrderItem {
  /** 상품 번호 (방송 안 번호) */
  readonly no: number
  readonly name: string
  /** 한 개 가격(원) */
  readonly price: number
  readonly qty: number
  /** 이 찜의 방송 ID — [상품 빼기]가 방송자 취소(host.cancel b·no·buyer)로 가리킨다 (D-PASS-01) */
  readonly b: string
  /** 고른 옵션 `[항목 이름, label]` (옵션 없는 찜은 null) */
  readonly options: readonly (readonly [string, string])[] | null
}

/** 이 손님의 다른 날짜 거래 한 줄 */
export interface OrderHistoryLine {
  readonly date: string
  readonly buyer: string
  readonly total: number
  readonly itemCount: number
  /** 그날 상세를 열 수 있나 (봉인 보관 행만 남은 날은 false) */
  readonly openable: boolean
}

export type OrderShippingMode = 'DEFAULT' | 'PICKUP' | 'COMBINED' | 'FIXED'

export interface OrderDetailView {
  readonly date: string
  readonly buyer: string
  readonly name: string | null
  readonly nickname: string
  readonly platform: OrderPlatform | null
  /** 휴대폰 번호 전체 (배송지 번호 → 문자 손님 번호 순). 모르면 null. 판매자 화면에만 — 로그 금지 */
  readonly phone: string | null
  /** 배송지 (모르면 null) */
  readonly address: { readonly address: string; readonly detail: string; readonly zip: string } | null
  readonly items: readonly OrderItem[]
  /** 예약일시 = 그날 이 손님의 첫 예약 시각 (UTC ISO) */
  readonly claimedAt: string | null
  readonly itemCount: number
  readonly subtotal: number
  readonly shipping: number
  /** 그날 배송비 규칙 (그날 첫 방송의 설정 스냅샷, DOMAIN_RULES 설정 스냅샷) */
  readonly shippingRule: { readonly baseFee: number; readonly freeThreshold: number | null; readonly mode: OrderShippingMode }
  /** 할인·추가 합 (할인은 음수) */
  readonly adjustments: number
  readonly total: number
  readonly received: number
  readonly refundDue: number
  readonly payment: PaymentStatus
  /** 이 손님의 다른 날짜 거래 (이 날짜는 빼고 최근 것부터, 최대 20줄). 다른 날과 이어지지 않는 손님(번호 없는 문자 손님)은 count 0 */
  readonly history: { readonly count: number; readonly total: number; readonly lines: readonly OrderHistoryLine[] }
}
