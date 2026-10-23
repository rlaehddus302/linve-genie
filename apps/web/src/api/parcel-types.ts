// 택배 자동 접수 API 모양 (T1, PARCEL_RULES PC-1~PC-8 — 서버 계약은 harness/sprints/T1/dev-notes.md "[server] API").
// 영어 값(state·reason·payment·address·shipping)은 화면에 그대로 내지 않는다 — 서버가 준 문장(message)·조회 낱말(status)·포장 상태 말(packing)을 쓴다.
import type { PaymentStatus } from '@livejjim/core'

export type CarrierCode = 'FAKE' | 'EPOST'
export type BoxKind = '극소' | '소' | '중' | '대'
export type ParcelState = 'PENDING' | 'UNKNOWN' | 'BOOKED' | 'FAILED' | 'CANCELLED'

/** 묶음의 택배 줄 (정산 묶음·포장 모드·택배 화면) */
export interface ParcelBrief {
  readonly state: ParcelState
  readonly carrier: CarrierCode
  readonly carrierName: string
  readonly invoice: string | null
  /** 4자리마다 `-` (`9000-0000-0001`) */
  readonly invoiceText: string | null
  /** 조회 낱말 (접수됨·집하·배송 중·도착·접수 취소됨 — 접수 전이면 null) */
  readonly status: string | null
  /** 마지막 확인 시각 (UTC ISO) */
  readonly checkedAt: string | null
  readonly trackUrl: string | null
  readonly reason: string | null
  /** 상태 문장 (실패 사유·모름·기다림 — 없으면 null) */
  readonly message: string | null
  readonly box: BoxKind
  readonly qty: number
  readonly bookedAt: string | null
  /** 접수 취소를 보낼 수 있는지 (접수됐고 집하 전) */
  readonly cancellable: boolean
}

/** 택배 화면의 묶음 한 줄 */
export interface ParcelRow {
  readonly buyer: string
  /** 구매자 표시 이름 (BUY-01) */
  readonly name: string
  readonly phoneLast4: string | null
  readonly itemCount: number
  /** 물품 N개의 N */
  readonly qty: number
  readonly total: number
  readonly payment: PaymentStatus
  /** 포장 상태 말 (STL-08) */
  readonly packing: string
  readonly shipping: 'NONE' | 'FIXED' | 'PICKUP' | 'COMBINED'
  readonly address: 'NONE' | 'UNCONFIRMED' | 'CONFIRMED'
  readonly ready: boolean
  readonly reason: string | null
  /** 빠지는 이유의 화면 문장 */
  readonly message: string | null
  readonly box: BoxKind
  readonly parcel: ParcelBrief | null
}

export interface ParcelDay {
  readonly date: string
  readonly seq: number
  readonly blocked: { readonly code: 'NO_SENDER' | 'NO_CARRIER'; readonly message: string } | null
  readonly carrier: { readonly code: CarrierCode; readonly name: string } | null
  readonly box: BoxKind
  readonly ready: readonly ParcelRow[]
  readonly excluded: readonly ParcelRow[]
  readonly booked: readonly ParcelRow[]
}

export interface ParcelDays {
  readonly dates: readonly { readonly date: string; readonly ready: number; readonly booked: number }[]
  readonly selected: string | null
}

/** 배송지 여섯 칸 */
export interface AddressFields {
  readonly name: string
  readonly phone: string
  readonly address: string
  readonly detail: string
  readonly zip: string
  readonly memo: string
}

export interface AddressView extends AddressFields {
  readonly source: 'BUYER' | 'SELLER'
  readonly confirmed: boolean
  /** 고친 시각 (UTC ISO — 배송지 확인 요청에 그대로 보낸다) */
  readonly updatedAt: string
}

export interface BundleView {
  readonly date: string
  readonly buyer: string
  readonly address: AddressView | null
  /** 살아 있는 접수가 있어 고칠 수 없다 */
  readonly locked: boolean
  /** 보관 기간(날짜 + 30일)이 지났다 */
  readonly expired: boolean
  readonly row: ParcelRow
}

export type BookResult =
  | { readonly buyer: string; readonly ok: true; readonly invoice: string; readonly invoiceText: string }
  | { readonly buyer: string; readonly ok: false; readonly reason: string; readonly message: string }

export interface BookResponse {
  readonly date: string
  readonly results: readonly BookResult[]
}

export interface ParcelSender {
  readonly name: string
  readonly phone: string
  readonly address: string
  readonly detail: string
  readonly zip: string
}

export interface ParcelSettings {
  readonly carrier: CarrierCode | null
  readonly carriers: readonly { readonly code: CarrierCode; readonly name: string; readonly available: boolean; readonly note: string | null }[]
  readonly customerNoLast4: string | null
  readonly sender: ParcelSender | null
  /** 보내는 사람 이름 기본값 (가게 이름) */
  readonly shopName: string
  readonly box: BoxKind
  readonly boxes: readonly BoxKind[]
}
