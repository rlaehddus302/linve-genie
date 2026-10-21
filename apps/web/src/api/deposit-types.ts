// 입금 확인 응답 모양 (N3 — harness/sprints/N3/dev-notes.md "dev-server > 화면(dev-web)에게 — 바뀐 계약"). 시각은 UTC ISO 문자열이다.
// 영어 값(상태·사유·원천 종류)은 화면에 내지 않는다 — lib/deposit-words.ts의 낱말로만 보인다(DP-8, AC-N3-50).
import type { PaymentStatus } from '@livejjim/core'

export type DepositStatus = 'REVIEW' | 'AUTO_APPLIED' | 'APPLIED' | 'IGNORED'
export type SourceKind = 'POPBILL' | 'PASTE' | 'FAKE'
export type DepositPrecision = 'second' | 'minute'
export type ReviewReason = 'POSSIBLE_DUPLICATE' | 'SAME_NAME' | 'MULTIPLE' | 'NAME_MISMATCH' | 'AMOUNT_MISMATCH' | 'NO_MATCH' | 'ONE_MATCH'

/** 묶음 하나 (제안·묶음 찾기·확정 창) */
export interface BundleView {
  readonly date: string
  /** 지금의 구매자 ID */
  readonly buyer: string
  /** 그 날짜 범위의 이름 표기 (BUY-01) */
  readonly name: string
  readonly total: number
  readonly received: number
  readonly remaining: number
  readonly payment: PaymentStatus
  readonly refundDue: number
  /** 이 입금을 확정하면 바뀔 입금 상태 (서버가 코어로 계산) */
  readonly after: { readonly payment: PaymentStatus; readonly received: number; readonly refundDue: number } | null
  /** 입금 시각이 이 묶음의 판매보다 먼저 */
  readonly beforeSale: boolean
  /** 확정할 때 입금자명을 기억할 수 있다 (유튜브 구매자 · 이름 후보에 아직 없음) */
  readonly canRemember: boolean
}

export interface AppliedBundle {
  readonly date: string
  readonly buyer: string
  readonly buyerName: string
  readonly seq: number
  readonly auto: boolean
}

export interface DepositReview {
  readonly reason: ReviewReason
  readonly twin: number | null
  readonly suggestions: readonly BundleView[]
  readonly preselect: { readonly date: string; readonly buyer: string } | null
}

export interface DepositView {
  readonly no: number
  readonly source: { readonly id: string; readonly kind: SourceKind; readonly label: string }
  readonly at: string
  readonly precision: DepositPrecision
  readonly amount: number
  readonly name: string
  readonly status: DepositStatus
  readonly applied: AppliedBundle | null
  readonly receivedAt: string
  readonly handledAt: string | null
  /** 확인 필요만 — 볼 때 다시 계산 */
  readonly review?: DepositReview
}

export type DepositActionKind = 'RECEIVED' | 'AUTO' | 'CONFIRM' | 'IGNORE' | 'REOPEN' | 'REVERT'

export interface DepositActionView {
  readonly action: DepositActionKind | string
  readonly actor: { readonly kind: 'account' | 'auto' | string; readonly loginId: string | null }
  readonly at: string
  readonly date: string | null
  readonly buyer: string | null
  readonly buyerName: string | null
  readonly seq: number | null
}

export interface DepositDetail extends DepositView {
  readonly actions: readonly DepositActionView[]
}

export interface DepositList {
  readonly deposits: readonly DepositView[]
  readonly more: boolean
  readonly review: number
}

/** 처리 결과 (확정·무시·다시 확인 필요로·되돌리기) */
export interface DepositActionResult {
  readonly deposit: {
    readonly no: number
    readonly status: DepositStatus
    readonly applied: { readonly date: string; readonly buyer: string; readonly buyerName: string; readonly seq: number; readonly beforeSale?: boolean } | null
  }
  readonly refund?: { readonly date: string; readonly seq: number }
}

export type BulkItemResult =
  | { readonly no: number | null; readonly ok: true; readonly deposit: DepositActionResult['deposit'] }
  | { readonly no: number | null; readonly ok: false; readonly status: number; readonly error: { readonly code: string; readonly message: string } }

export interface BulkResult {
  readonly results: readonly BulkItemResult[]
}

export type PasteRowState = 'NEW' | 'EXISTING' | 'OLD' | 'FUTURE'
export type UnreadableWhy = 'BAD_AMOUNT' | 'BAD_TIME'

export interface PastePreview {
  readonly rows: readonly {
    readonly line: number
    /** KST +09:00 */
    readonly at: string
    readonly precision: DepositPrecision
    readonly amount: number
    readonly name: string
    readonly balance: number | null
    readonly state: PasteRowState
  }[]
  readonly skipped: readonly { readonly line: number; readonly why: 'NOT_DEPOSIT' }[]
  readonly unreadable: readonly { readonly line: number; readonly why: UnreadableWhy }[]
}

export interface PasteSummary {
  readonly read: number
  readonly skipped: number
  readonly unreadable: readonly { readonly line: number; readonly why: UnreadableWhy }[]
  readonly new: number
  readonly existing: number
  readonly old: number
  readonly future: number
  readonly auto: number
  readonly review: number
}

export interface SourceView {
  readonly id: string
  readonly kind: SourceKind
  readonly label: string
  readonly enabled: boolean
  readonly intervalMin: number
  /** 계좌조회: 팝빌 은행 코드 */
  readonly bank: string | null
  readonly accountLast4: string | null
  readonly lastFetchedAt: string | null
  readonly lastError: string | null
  readonly lastErrorAt: string | null
  readonly lastNew: number | null
  readonly fetching: boolean
  /** 받아 오기가 있는 원천 (붙여넣기는 없다) */
  readonly fetchable: boolean
}

export interface SourcesView {
  readonly sources: readonly SourceView[]
  /** 팝빌 연동 키가 있는 서버 */
  readonly popbill: boolean
  /** 시험 모드 (가짜 원천) */
  readonly testMode: boolean
}

export interface RememberedName {
  readonly id: number
  readonly name: string
  readonly buyerName: string
  readonly createdAt: string
}

/** 정산 조회의 입금 연결 (AC-N3-32) — 정산 기록의 seq에 붙는다 */
export interface DepositLinkView {
  readonly seq: number
  readonly kind: 'payment' | 'refund'
  readonly auto: boolean
  /** 입금 기록이면: 그 뒤 되돌렸는지 */
  readonly reverted: boolean
  readonly deposit: {
    readonly no: number
    readonly name: string
    readonly at: string
    readonly precision: DepositPrecision
    readonly amount: number
    readonly source: string
    readonly sourceKind: SourceKind
  }
}

/** 실시간 `deposit` 알림 (입금자명은 담지 않는다) */
export interface DepositNotice {
  readonly deposits: readonly number[]
  readonly review: number
  readonly sources: readonly string[]
}
