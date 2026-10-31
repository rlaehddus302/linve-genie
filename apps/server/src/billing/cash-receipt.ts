// 포트원 현금영수증 발행기 (BILLING_RULES BL-8 5, D-PAY-10, AC-PAY2-10·11). 운영 설정 LIVEJJIM_RECEIPT_ISSUER=portone일 때만 쓴다(운영 기본은 "없음").
// 포트원 V2 현금영수증 API (PG 채널 토스페이먼츠):
// - 결제 건 현금영수증 조회: GET {base}/payments/{결제 ID}/cash-receipt?storeId={상점 ID} → 200 CashReceipt { status: ISSUED·CANCELLED·ISSUE_FAILED, storeId, paymentId, type: PERSONAL(소득공제)·CORPORATE(지출증빙), issueNumber, … }
//   · 404 { type: CASH_RECEIPT_NOT_FOUND } = 없음.
// - 현금영수증 발급: POST {base}/cash-receipts 본문 { storeId, paymentId, channelKey, type: CORPORATE, orderName, currency: KRW, amount: { total }, customer: { identityNumber } }
//   → 200 { cashReceipt: { issueNumber, … } }. 머리말 Idempotency-Key = 그 증빙 요청의 키. 60초.
// - 현금영수증 취소: POST {base}/payments/{결제 ID}/cash-receipt/cancel 본문 { storeId } → 200. 머리말 Idempotency-Key = 그 취소 요청의 키. 60초.
// 판단 (애매하면 발급하지 않는다 — 한 거래에 현금영수증 두 장보다 낫다):
// - 발급: 먼저 조회 → 없음이면 지출증빙 발급 / 지출증빙으로 발급됨이면 그 승인 번호로 "발행됨" / 그 밖(소득공제·취소됨·발급 실패·모르는 상태·다른 결제·다른 상점·빈 본문·조회 실패)은 "발행 실패".
// - 취소: 먼저 조회 → 취소됨이면 "취소됨" / 발급됨이면 취소 요청 → 성공 "취소됨" / 그 밖(실패·시간 초과·조회 실패)은 "취소 요청"(운영자 목록).
// 금액 칸: 합계(total)만 보낸다 — 공급가액·세액 칸은 세무 확인 대기(BL-8 5 6).
// 사업자등록번호는 발급 요청 본문에만 들어간다. 로그·오류·응답에 넣지 않는다(이 파일은 로그를 남기지 않는다).
import type { DocumentCancelResult, DocumentIssuer, IssueRequest, IssueResult } from './documents.ts'
import { PAYMENT_ID_RE, field, isObject, portOneConnection, portOneRequest, type PortOneConnection, type PortOneOptions } from './portone.ts'

export interface PortOneCashReceiptOptions extends PortOneOptions {
  /** 발급 요청의 채널 키 (토스페이먼츠 채널) */
  readonly channelKey: string
}

/** 조회 결과 */
export type CashReceiptLookup =
  | { readonly kind: 'none' }
  | { readonly kind: 'proof'; readonly issueNumber: string }
  | { readonly kind: 'cancelled' }
  /** 소득공제로 발급됨 등 지출증빙이 아닌 발급 */
  | { readonly kind: 'issued_other' }
  /** 모르는 상태·형식이 이상함·다른 결제·다른 상점·조회 실패 */
  | { readonly kind: 'unknown' }

const ISSUE_NUMBER_RE = /^[A-Za-z0-9-]{1,64}$/

/** 조회 응답 본문 → 판단 (우리 상점·결제의 것만 믿는다) */
export function readCashReceipt(body: unknown, storeId: string, paymentId: string): CashReceiptLookup {
  if (!isObject(body)) return { kind: 'unknown' }
  if (field(body, 'storeId') !== storeId || field(body, 'paymentId') !== paymentId) return { kind: 'unknown' }
  const status = field(body, 'status')
  if (status === 'CANCELLED') return { kind: 'cancelled' }
  if (status !== 'ISSUED') return { kind: 'unknown' }
  const type = field(body, 'type')
  if (type === 'CORPORATE') {
    const issueNumber = field(body, 'issueNumber')
    return typeof issueNumber === 'string' && ISSUE_NUMBER_RE.test(issueNumber) ? { kind: 'proof', issueNumber } : { kind: 'unknown' }
  }
  if (type === 'PERSONAL') return { kind: 'issued_other' }
  return { kind: 'unknown' }
}

/** 사업자등록번호 → 숫자 10자리 (아니면 null) */
const identityOf = (businessNumber: string): string | null => {
  const digits = businessNumber.replace(/[\s-]/g, '')
  return /^\d{10}$/.test(digits) ? digits : null
}

export class PortOneCashReceiptIssuer implements DocumentIssuer {
  readonly #connection: PortOneConnection
  readonly #channelKey: string

  constructor(options: PortOneCashReceiptOptions) {
    this.#connection = portOneConnection(options)
    this.#channelKey = options.channelKey
  }

  /** 그 결제의 현금영수증 조회 (10초) */
  async lookup(paymentId: string): Promise<CashReceiptLookup> {
    if (!PAYMENT_ID_RE.test(paymentId)) return { kind: 'unknown' }
    const result = await portOneRequest(this.#connection, `/payments/${encodeURIComponent(paymentId)}/cash-receipt?storeId=${encodeURIComponent(this.#connection.storeId)}`, { method: 'GET', mutate: false })
    if (result === null) return { kind: 'unknown' }
    if (result.status === 404 && isObject(result.body) && field(result.body, 'type') === 'CASH_RECEIPT_NOT_FOUND') return { kind: 'none' }
    if (result.status !== 200) return { kind: 'unknown' }
    return readCashReceipt(result.body, this.#connection.storeId, paymentId)
  }

  async issue(request: IssueRequest): Promise<IssueResult> {
    const identityNumber = identityOf(request.recipient.businessNumber)
    if (identityNumber === null || request.idempotencyKey === undefined || request.orderName === undefined) return { status: 'FAILED' }
    const found = await this.lookup(request.paymentId)
    if (found.kind === 'proof') return { status: 'ISSUED', approval: found.issueNumber }
    if (found.kind !== 'none') return { status: 'FAILED' }
    const result = await portOneRequest(this.#connection, '/cash-receipts', {
      method: 'POST',
      body: {
        storeId: this.#connection.storeId,
        paymentId: request.paymentId,
        channelKey: this.#channelKey,
        type: 'CORPORATE',
        orderName: request.orderName,
        currency: 'KRW',
        amount: { total: request.amount },
        customer: { identityNumber },
      },
      idempotencyKey: request.idempotencyKey,
      mutate: true,
    })
    if (result === null || result.status !== 200 || !isObject(result.body)) return { status: 'FAILED' }
    const receipt = field(result.body, 'cashReceipt')
    const issueNumber = isObject(receipt) ? field(receipt, 'issueNumber') : undefined
    return typeof issueNumber === 'string' && ISSUE_NUMBER_RE.test(issueNumber) ? { status: 'ISSUED', approval: issueNumber } : { status: 'FAILED' }
  }

  async cancel(request: IssueRequest & { readonly approval: string | null }): Promise<DocumentCancelResult> {
    const found = await this.lookup(request.paymentId)
    if (found.kind === 'cancelled') return { cancel: 'CANCELLED' }
    if (found.kind !== 'proof' && found.kind !== 'issued_other') return { cancel: 'REQUESTED' }
    if (request.idempotencyKey === undefined) return { cancel: 'REQUESTED' }
    const result = await portOneRequest(this.#connection, `/payments/${encodeURIComponent(request.paymentId)}/cash-receipt/cancel`, {
      method: 'POST',
      body: { storeId: this.#connection.storeId },
      idempotencyKey: request.idempotencyKey,
      mutate: true,
    })
    return result !== null && result.status === 200 ? { cancel: 'CANCELLED' } : { cancel: 'REQUESTED' }
  }
}
