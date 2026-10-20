// 서버 응답 모양 (harness/sprints/S04·S05 dev-notes의 화면 계약). 조회 항목은 코어 조회 함수 결과이고 시각 필드(at·endedAt·rankTime)만 ISO 문자열이다.
import type {
  BroadcastDetails,
  BuyerInfo,
  CancelRequestInfo,
  ClaimInfo,
  EffectInfo,
  PaymentStatus,
  PendingInfo,
  ProductInfo,
  SettlementInfo,
} from '@livejjim/core'

type TimeKey = 'at' | 'endedAt' | 'rankTime'

/** 코어 조회 결과의 시각 필드(UTC 밀리초)를 ISO 문자열로 바꾼 모양 (서버 withIsoTimes와 같다) */
export type IsoTimes<T> = T extends readonly (infer U)[]
  ? readonly IsoTimes<U>[]
  : T extends object
    ? { readonly [K in keyof T]: K extends TimeKey ? (null extends T[K] ? string | null : string) : IsoTimes<T[K]> }
    : T

export type BroadcastView = IsoTimes<BroadcastDetails>
export type Product = IsoTimes<ProductInfo>
export type Claim = IsoTimes<ClaimInfo>
export type PendingSlot = IsoTimes<PendingInfo>
export type Buyer = IsoTimes<BuyerInfo>
export type Settlement = IsoTimes<SettlementInfo>
export type Effect = IsoTimes<EffectInfo>
export type CancelRequest = IsoTimes<CancelRequestInfo>

export interface Attention {
  readonly seq: number
  readonly message: string
}

/** 오류 본문의 문제 하나 */
export interface ApiProblem {
  readonly field: string | null
  readonly message: string
  readonly hint?: string
}

export interface Me {
  readonly seller: { readonly name: string }
  readonly loginId: string
}

/** 방송 목록 항목 (GET /api/broadcasts) */
export interface BroadcastItem {
  readonly id: string
  readonly date: string
  readonly title: string
  readonly rehearsal: boolean
  readonly ended: boolean
  readonly endedAt: string | null
}

/** 쓰기 결과 (모든 쓰기 공통) */
export interface WriteResult {
  readonly date: string
  readonly rehearsal: boolean
  readonly seq: number
  readonly type: string
  readonly changed: boolean
  readonly effects: readonly string[]
  readonly broadcast?: { readonly id: string; readonly date: string; readonly title: string; readonly rehearsal: boolean }
  readonly message?: { readonly id: string; readonly channel: string }
  /** 문자찜 응답만: 정규화한 번호의 뒤 4자리 (번호가 없거나 휴대폰 번호 모양이 아니면 null) */
  readonly phoneLast4?: string | null
  /**
   * 문자찜 응답만: 그 문자찜이 정한 구매자 자신의 ID (코어 buyerOfRef — 지금의 구매자가 아니다). 정하지 못했으면 null.
   * 같은 요청 번호의 재전송도 같은 값 (AC-S06b-11, D-099)
   */
  readonly buyer?: string | null
}

/** 범위 조회의 목록 이름 (증분 조회가 같은 이름으로 덮는다) */
export const VIEW_LISTS = ['broadcasts', 'products', 'claims', 'pending', 'buyers', 'settlements', 'effects', 'cancelRequests'] as const
export type ViewList = (typeof VIEW_LISTS)[number]

export interface ViewItems {
  readonly broadcasts: readonly BroadcastView[]
  readonly products: readonly Product[]
  readonly claims: readonly Claim[]
  readonly pending: readonly PendingSlot[]
  readonly buyers: readonly Buyer[]
  readonly settlements: readonly Settlement[]
  readonly effects: readonly Effect[]
  readonly cancelRequests: readonly CancelRequest[]
}

/** 범위 전체 조회 (GET /api/days/:date) */
export interface FullView extends ViewItems {
  readonly date: string
  readonly rehearsal: boolean
  readonly seq: number
  readonly attention: readonly Attention[]
}

/** 채팅 메시지 한 건 (메시지 조회·증분 조회) */
export interface ChatMessage {
  readonly id: string
  readonly broadcast: string
  readonly channel: string
  readonly nick: string
  readonly text: string
  readonly owner: boolean
  readonly seq: number
  readonly at: string
  readonly publishedAt: string
  readonly ignored: boolean
  readonly order: boolean
  readonly cancel: boolean
  readonly orders: readonly number[]
  readonly cancels: readonly number[]
  readonly mentions: readonly number[]
  readonly converted: readonly number[]
  readonly claims: readonly string[]
  readonly failed: boolean
}

/** 증분 조회 (GET /api/days/:date/changes?since=N) */
export interface Changes extends ViewItems {
  readonly date: string
  readonly rehearsal: boolean
  readonly since: number
  readonly seq: number
  readonly attention: readonly Attention[]
  readonly removed: {
    readonly broadcasts: readonly string[]
    readonly products: readonly string[]
    readonly claims: readonly string[]
    readonly pending: readonly string[]
    readonly buyers: readonly string[]
    readonly settlements: readonly { readonly buyer: string; readonly date: string }[]
    readonly effects: readonly string[]
    readonly cancelRequests: readonly string[]
  }
  readonly messages: readonly ChatMessage[]
  readonly messagesMore: boolean
}

export interface MessagesView {
  readonly date: string
  readonly rehearsal: boolean
  readonly seq: number
  readonly messages: readonly ChatMessage[]
  readonly more: boolean
}

/** 이력 한 줄 (GET /api/days/:date/history) */
export interface HistoryItem {
  readonly seq: number
  readonly type: string
  readonly at: string
  readonly receivedAt: string
  readonly actor: { readonly kind: string; readonly loginId: string | null }
  readonly reason: string | null
  readonly fields: Readonly<Record<string, unknown>>
  readonly failed: boolean
}

/** 리허설 가짜 채팅 생성기 상태 */
export interface GeneratorStatus {
  readonly b?: string
  readonly running: boolean
  readonly sent: number
  readonly total: number
  readonly perSecond: number
  readonly seed: number | null
  readonly duplicates: number
  readonly failed: number
  readonly stopReason: 'completed' | 'stopped' | 'ended' | 'shutdown' | null
}

/** SSE 알림 */
export interface ScopeSeq {
  readonly date: string
  readonly rehearsal: boolean
  readonly seq: number
}

// ── I2 정산 마무리 (harness/sprints/I2/dev-notes.md "API") ─────────────────

/** 가게 설정 (GET·PUT /api/shop — 빈 칸은 "") */
export interface Shop {
  readonly name: string
  readonly bank: string
  readonly accountNumber: string
  readonly accountHolder: string
  readonly accountNote: string
}

/** 포장·배송 상태 말 다섯 (화면에 그대로) */
export const PACKING_WORDS = ['포장 대기', '포장 완료', '포장 다시 확인', '배송 완료', '배송 뒤 바뀜'] as const
export type PackingWord = (typeof PACKING_WORDS)[number]

/** 포장 목록의 품목 하나 */
export interface PackingItem {
  /** 상품 키 `<방송 ID>/<번호>` */
  readonly key: string
  readonly broadcast: string
  /** 방송 제목 */
  readonly title: string
  readonly no: number
  /** 품종 (빈 품종은 "") */
  readonly name: string
  readonly price: number
}

export interface PackingRemoved {
  readonly key: string
  readonly broadcast: string
  readonly title: string
  readonly no: number
}

/** 포장 목록 한 줄 = 묶음 (GET /api/days/:date/packing) */
export interface PackingEntry {
  /** 지금의 구매자 ID */
  readonly buyer: string
  readonly name: string
  readonly phoneLast4: string | null
  readonly payment: PaymentStatus
  /** 지금 품목 (방송 선언 순 → 번호 순) */
  readonly items: readonly PackingItem[]
  readonly status: PackingWord
  readonly invoice: string | null
  /** 포장 다시 확인·배송 뒤 바뀜: 새로 담을 것 */
  readonly add: readonly PackingItem[]
  /** 포장 다시 확인·배송 뒤 바뀜: 뺄 것 */
  readonly remove: readonly PackingRemoved[]
}

export interface PackingList {
  readonly date: string
  readonly seq: number
  readonly entries: readonly PackingEntry[]
}

export type PackingAction = 'pack' | 'unpack' | 'ship' | 'unship'

/** 포장 명령 응답 (POST /api/days/:date/packing) */
export interface PackingResult {
  readonly date: string
  readonly entry: PackingEntry
  readonly recorded: boolean
}

/** 포장 라벨 데이터 (GET /api/days/:date/packing-label) — 화면은 쪽 수만 쓴다 */
export interface PackingLabelView {
  readonly date: string
  readonly buyer: string
  readonly pages: number
}

/** 지난 구매 항목 (GET /api/days/:date/past) */
export interface PastItem {
  readonly date: string
  /** 그날 그 묶음의 지금의 구매자 ID (정산 자세히로) */
  readonly buyer: string
  readonly broadcasts: readonly string[]
  readonly name: string
  readonly phoneLast4: string | null
  readonly items: readonly { readonly title: string; readonly no: number; readonly name: string; readonly price: number }[]
  readonly subtotal: number
  readonly shipping: number
  readonly adjustments: number
  readonly total: number
  readonly payment: PaymentStatus
  readonly received: number
  readonly refundDue: number
  readonly packing: PackingWord
  readonly invoice: string | null
  readonly reasons: readonly string[]
}

export interface PastView {
  readonly date: string
  readonly buyer: string
  readonly items: readonly PastItem[]
  readonly more: boolean
  readonly next: string | null
}

/** 상품 목록 가져오기 줄 문제 (R-18) */
export const IMPORT_ROW_ERRORS = ['CELLS', 'NUMBER_INVALID', 'DUPLICATE', 'EXISTS', 'NAME_PHONE', 'PRICE_MISSING', 'PRICE_INVALID', 'PRICE_TOO_LOW'] as const
export type ImportRowError = (typeof IMPORT_ROW_ERRORS)[number]

export type ImportPreviewRow =
  | { readonly line: number; readonly no: number; readonly name: string; readonly price: number; readonly text: string }
  | { readonly line: number; readonly error: ImportRowError; readonly text: string }

/** 상품 목록 가져오기 미리 보기 (POST /api/broadcasts/:id/import/preview) */
export interface ImportPreview {
  readonly broadcast: string
  readonly unit: string
  readonly maxNumber: number
  readonly error: 'EMPTY' | 'TOO_MANY' | null
  readonly header: number | null
  readonly headerCells: readonly string[] | null
  readonly rows: readonly ImportPreviewRow[]
  readonly register: number
  readonly problems: number
}

/** 백업 상태 (GET /api/backups) */
export interface BackupStatus {
  readonly enabled: boolean
  readonly retentionDays: number
  /** 마지막 자동 백업 (UTC ISO, 없으면 null) */
  readonly lastSuccessAt: string | null
  readonly backups: readonly { readonly createdAt: string; readonly size: number }[]
}
