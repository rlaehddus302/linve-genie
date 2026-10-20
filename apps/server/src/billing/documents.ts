// 증빙 발행기 어댑터 (BILLING_RULES BL-8 3~5, D-N5-11, AC-N5-38). 팝빌 실제 어댑터를 끼울 자리다(실제 네트워크 코드는 없다).
// - 시험 모드: 가짜 발행기 — 바로 "발행됨" + `TEST-`로 시작하는 승인 번호, 취소하면 "취소됨".
// - 운영 기본: "없음" — 외부로 아무것도 보내지 않는다. 요청은 "발행 대기"로 남고(운영자가 billing-list로 보고 손으로 발행), 취소는 "취소 요청"으로 남는다.
// - 발행기 실패는 "발행 실패"로 남고 결제·이용권은 그대로다.
import { randomBytes } from 'node:crypto'

export type ReceiptKind = 'TAX_INVOICE' | 'CASH_RECEIPT'
export const RECEIPT_KINDS: readonly ReceiptKind[] = ['TAX_INVOICE', 'CASH_RECEIPT']

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
}

export type IssueResult = { readonly status: 'ISSUED'; readonly approval: string } | { readonly status: 'PENDING' } | { readonly status: 'FAILED' }
export type DocumentCancelResult = { readonly cancel: 'CANCELLED' } | { readonly cancel: 'REQUESTED' } | { readonly cancel: 'FAILED' }

/** 증빙 발행기 (팝빌 자리) */
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
