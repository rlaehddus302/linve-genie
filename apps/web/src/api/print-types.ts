// 출력 기록 응답 모양 (I1 — harness/sprints/I1/dev-notes.md "dev-server > 바뀐 계약" 3·4). 시각은 UTC ISO 문자열이다.
import type { LabelBuyer, LabelTemplate, PackingLabelData, PackingTemplate, ProductLabelData, ProductTemplate } from '@livejjim/label'

export type PauseReason = 'DISCONNECTED' | 'PRINTER_ERROR' | 'SELLER' | 'LABEL_ERROR'

export interface PrintDevice {
  readonly id: string
  readonly name: string
  /** 그 기기의 실시간 연결이 열려 있음 */
  readonly live: boolean
  /** 그 기기가 알린 프린터 연결 여부 */
  readonly printerConnected: boolean
  /** 출력 그만하기 — 출력 중인 장이 끝나기를 기다림 */
  readonly releasing: boolean
}

export interface QueueSummary {
  /** 판매자의 출력 기록 판 (바뀔 때마다 는다) */
  readonly rev: number
  readonly device: PrintDevice | null
  readonly pause: { readonly reason: PauseReason; readonly message: string; readonly backlog: boolean } | null
  readonly waiting: number
  readonly printing: number
  /** 버릴 라벨 장 수 */
  readonly discard: number
}

export interface LabelRef {
  /** 상품 `<찜>@<확정버전>`, 포장 `packing:<구매자>` */
  readonly key: string
  readonly claim: string | null
  readonly version: number | null
  readonly broadcast: string | null
  readonly no: number | null
  readonly buyerId: string | null
  readonly buyer: LabelBuyer
}

export type JobStatus = 'WAITING' | 'PRINTING' | 'DONE' | 'CANCELLED'
export type JobReason = 'auto' | 'manual' | 'reprint' | 'packing'
export type LabelData = ProductLabelData | PackingLabelData

export interface JobView {
  readonly id: string
  readonly date: string
  readonly kind: 'product' | 'packing'
  readonly reason: JobReason
  readonly status: JobStatus
  /** 화면 낱말 (작업 대기 · 출력 중 · 출력함 · 출력 안 함 · 폐기 · 폐기 — 버려 주세요) */
  readonly word: string
  readonly voided: boolean
  readonly discard: boolean
  readonly discardedAt: string | null
  readonly attempts: number
  readonly lastError: { readonly code: string; readonly item: string | null } | null
  readonly label: LabelRef
  readonly page: number | null
  readonly pages: number | null
  readonly data: LabelData | null
  readonly device: string | null
  readonly printedAt: string | null
  readonly createdAt: string
}

export type LabelState = 'NONE' | 'WAITING' | 'PRINTING' | 'PRINTED' | 'REPRINT_NEEDED' | 'NOT_PRINTED' | 'VOIDED'

export interface LabelView extends LabelRef {
  readonly date: string
  readonly kind: 'product' | 'packing'
  readonly state: LabelState
  /** 화면 낱말 (라벨 대기 · 출력 중 · 라벨 출력됨 · 재출력 필요 · 출력 안 함 · 폐기 · 폐기 — 버려 주세요, 작업이 없으면 빈 글) */
  readonly word: string
  readonly voided: boolean
  readonly discard: number
  readonly reprintNeeded: boolean
  readonly printed: number
  readonly history: readonly { readonly at: string; readonly device: string }[]
  readonly winner: boolean
  readonly data: LabelData | null
  readonly canPrint: boolean
  readonly canReprint: boolean
}

export interface ClaimedJob {
  readonly id: string
  readonly date: string
  readonly kind: 'product' | 'packing'
  readonly reason: string
  readonly attempt: string
  readonly data: LabelData
  readonly template: LabelTemplate
  readonly page: number | null
  readonly pages: number | null
  readonly label: LabelRef
}

export interface PrintOverview {
  readonly queue: QueueSummary
  /** 출력 중 먼저, 대기 순서대로 */
  readonly jobs: readonly JobView[]
  /** 버릴 라벨 */
  readonly discard: readonly JobView[]
}

/** 실시간 print 알림 */
export type PrintNotice =
  | { readonly rev: number; readonly queue: QueueSummary; readonly jobs: readonly JobView[]; readonly labels: readonly LabelView[] }
  | { readonly template: { readonly kind: 'product' | 'packing'; readonly version: number } }

export interface StoredTemplate<T extends LabelTemplate = LabelTemplate> {
  readonly template: T
  readonly version: number
}

export interface Templates {
  readonly product: StoredTemplate<ProductTemplate>
  readonly packing: StoredTemplate<PackingTemplate>
}

export interface PackingView {
  readonly date: string
  /** 지금의 구매자 */
  readonly buyer: string
  readonly data: PackingLabelData | null
  readonly label: LabelView
}

export interface ClientConfig {
  readonly hostActionDelayMs: number
  readonly testPrinter: boolean
}
