// 증빙 발행기 어댑터 (BILLING_RULES BL-8 3~5, D-N5-11, AC-N5-38, PAY2 D-PAY-10). 셋 중 하나를 운영 설정으로 고른다.
// - 포트원 현금영수증: cash-receipt.ts (운영 설정 LIVEJJIM_RECEIPT_ISSUER=portone일 때만 — 금액 칸 세무 확인 뒤).
// - 시험 모드: 가짜 발행기 — 바로 "발행됨" + `TEST-`로 시작하는 승인 번호, 취소하면 "취소됨".
// - 운영 기본: "없음" — 외부로 아무것도 보내지 않는다. 요청은 "발행 대기"로 남고(운영자가 billing-list로 보고 손으로 발행), 취소는 "취소 요청"으로 남는다.
// - 발행기 실패는 "발행 실패"로 남고 결제·이용권은 그대로다.
import { randomBytes } from 'node:crypto'

export type ReceiptKind = 'TAX_INVOICE' | 'CASH_RECEIPT'
/** 저장된 기록에 있을 수 있는 종류 (옛 `TAX_INVOICE` 기록은 그 낱말 그대로 보인다 — BL-8 6) */
export const RECEIPT_KINDS: readonly ReceiptKind[] = ['TAX_INVOICE', 'CASH_RECEIPT']
/**
 * 지금 발행하는 계좌이체 증빙 (BL-8 1·3·6, D-PL1-07): 운영 사업자가 간이과세자라 현금영수증(지출증빙) 하나다.
 * 사업자 정보 조회·새 증빙 요청·운영자 계정 명령이 모두 이 값을 쓴다(저장된 옛 `TAX_INVOICE`도 현금영수증으로 읽는다).
 */
export const ISSUED_RECEIPT_KIND = 'CASH_RECEIPT' as const satisfies ReceiptKind

/** 받는 쪽 (발행할 때의 사업자 정보) */
export interface DocumentRecipient {
  /** `123-45-67890` */
  readonly businessNumber: string
  readonly name: string
  readonly ceo: string
  readonly email: string | null
}

export interface IssueRequest {
  readonly paymentId: string
  readonly kind: ReceiptKind
  readonly amount: number
  readonly supply: number
  readonly vat: number
  readonly recipient: DocumentRecipient
  /** 결제 주문 이름 (포트원 현금영수증 발급의 orderName) */
  readonly orderName?: string
  /** 그 증빙 요청(발급)·취소 요청에서 만든 멱등 키 (BL-6 10) */
  readonly idempotencyKey?: string
}

export type IssueResult = { readonly status: 'ISSUED'; readonly approval: string } | { readonly status: 'PENDING' } | { readonly status: 'FAILED' }
export type DocumentCancelResult = { readonly cancel: 'CANCELLED' } | { readonly cancel: 'REQUESTED' } | { readonly cancel: 'FAILED' }

/** 증빙 발행기 (가짜 · 없음 · 포트원 현금영수증) */
export interface DocumentIssuer {
  issue(request: IssueRequest): Promise<IssueResult>
  cancel(request: IssueRequest & { readonly approval: string | null }): Promise<DocumentCancelResult>
}

/** 운영 기본 "없음": 외부로 보내지 않고 발행 대기·취소 요청으로 둔다 */
export const noneIssuer: DocumentIssuer = {
  issue: () => Promise.resolve({ status: 'PENDING' }),
  cancel: () => Promise.resolve({ cancel: 'REQUESTED' }),
}

/** 시험 모드 가짜 발행기 (fail = 다음 발행을 실패로) */
export class FakeIssuer implements DocumentIssuer {
  fail = false
  readonly issued: IssueRequest[] = []
  readonly cancelled: string[] = []

  issue(request: IssueRequest): Promise<IssueResult> {
    if (this.fail) return Promise.resolve({ status: 'FAILED' })
    this.issued.push(request)
    return Promise.resolve({ status: 'ISSUED', approval: `TEST-${randomBytes(6).toString('hex').toUpperCase()}` })
  }

  cancel(request: IssueRequest & { readonly approval: string | null }): Promise<DocumentCancelResult> {
    if (this.fail) return Promise.resolve({ cancel: 'FAILED' })
    this.cancelled.push(request.paymentId)
    return Promise.resolve({ cancel: 'CANCELLED' })
  }
}
