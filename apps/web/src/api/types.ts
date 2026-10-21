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
import type { DepositLinkView } from './deposit-types.ts'

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

/** 계정 역할 (I3 — 판매자 계정·보조자 계정, SYS-04) */
export type Role = 'SELLER' | 'ASSISTANT'

export interface Me {
  readonly seller: { readonly name: string }
  readonly loginId: string
  /** 없으면 판매자 계정 (앞 버전 서버) */
  readonly role?: Role
  /** 보조자 계정일 때만 그 이름 */
  readonly assistant?: { readonly name: string } | null
}

/** 보조자 계정인가 */
export const isAssistant = (me: Pick<Me, 'role'>): boolean => me.role === 'ASSISTANT'

/** 범위 목록 한 줄 (GET /api/days) — 봉인 예정 시각(유튜브 채팅이 있는 실제 범위만)·봉인 여부 (Y1 계약 5) */
export interface DayRow {
  readonly date: string
  readonly rehearsal: boolean
  readonly seq: number
  readonly sealAt?: string | null
  readonly sealed?: boolean
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
  /** 30일이 지나 봉인한 날짜 (봉인한 장부 — 쓰기·증분 조회 없음, Y1 계약 5) */
  readonly sealed?: boolean
  readonly sealedAt?: string
  /** 그 범위 정산 기록의 입금 연결 (N3 AC-N3-32 — 서버는 늘 담는다, 리허설 범위는 []) */
  readonly depositLinks?: readonly DepositLinkView[]
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
  /** 정산 묶음이 바뀐 증분에만 그 범위의 입금 연결 전체 (N3 — 없으면 이전 값 그대로) */
  readonly depositLinks?: readonly DepositLinkView[]
}

export interface MessagesView {
  readonly date: string
  readonly rehearsal: boolean
  readonly seq: number
  readonly messages: readonly ChatMessage[]
  readonly more: boolean
  /** 봉인한 날짜: 채팅 내용을 지웠다 (서버 문장 sealedMessage) */
  readonly sealed?: boolean
  readonly sealedMessage?: string
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
  /** 상품 ID (번호를 바꿔도 그대로 — D-I2-19). 품목은 (상품 ID, 상품 키) 쌍으로 견준다. 없으면 상품 키만 */
  readonly id?: string
}

export interface PackingRemoved {
  readonly key: string
  readonly broadcast: string
  readonly title: string
  readonly no: number
  /** 그 상품의 품종 (D-I2-19 — 같은 번호가 "새로 담을 것"에도 있으면 번호 뒤에 붙인다) */
  readonly name?: string
  /** 포장 때 상품 ID (이 결정 전 기록은 null) */
  readonly id?: string | null
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
export const IMPORT_ROW_ERRORS = ['CELLS', 'NUMBER_INVALID', 'DUPLICATE', 'EXISTS', 'NAME_CONTROL', 'NAME_PHONE', 'PRICE_MISSING', 'PRICE_INVALID', 'PRICE_TOO_LOW'] as const
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

// ── 유튜브 (harness/sprints/Y1/dev-notes.md "화면(I3)에게", I3 dev-notes "화면에게") ──────

export type ConnectionStatus = 'NOT_CONNECTED' | 'CONNECTED' | 'RECONNECT_NEEDED'

export interface ConsentState {
  readonly enabled: boolean
  /** 켠 때 (UTC ISO) */
  readonly at: string | null
}

/** 구글 연결 (토큰·만료 시각은 없다) */
export interface YoutubeConnection {
  readonly status: ConnectionStatus
  readonly channel: { readonly id: string; readonly title: string } | null
  readonly permissions: { readonly read: boolean; readonly publish: boolean }
  readonly consent: { readonly liveChat: ConsentState; readonly videoComment: ConsentState }
}

export type ConsentTarget = 'LIVE_CHAT' | 'VIDEO_COMMENT'

/** 내 라이브 목록 한 줄 */
export interface LiveBroadcastItem {
  readonly videoId: string
  readonly title: string
  readonly status: 'LIVE' | 'UPCOMING'
  readonly scheduledStartTime: string | null
  readonly actualStartTime: string | null
  /** 이미 이어진 이 판매자의 회차 ID */
  readonly linkedBroadcast: string | null
}

export type CollectorStatus = 'STARTING' | 'LIVE' | 'RETRYING' | 'STOPPED' | 'FINISHED' | 'CHAT_ENDED'

/** 수집 상태 (문장은 서버 것을 그대로 보인다 — 받는 방식 mode는 보이지 않는다) */
export interface CollectorView {
  readonly status: CollectorStatus
  readonly statusMessage: string
  readonly reason: string | null
  readonly reasonMessage: string | null
  readonly mode: string
  readonly lastMessageAt: string | null
  readonly recorded: number
  readonly skippedBeforeLink: number
  readonly gap: boolean
  readonly gapMessage: string | null
  readonly restartable: boolean
}

/** 방송 잇기 상태 (GET·POST /api/broadcasts/:id/youtube) */
export interface LinkView {
  readonly link: { readonly videoId: string; readonly channelId: string; readonly linkedAt: string; readonly chatEnded: boolean } | null
  readonly collector: CollectorView | null
}

export type OutboxTarget = 'LIVE_CHAT' | 'VIDEO_COMMENT' | 'SUMMARY'
export type OutboxState = 'WAITING' | 'SENDING' | 'SENT' | 'SKIPPED' | 'FAILED'

/** 감사 메시지 발송함 한 줄 */
export interface OutboxRow {
  readonly id: number
  readonly target: OutboxTarget
  readonly broadcast: string | null
  /** 효과가 나온 때의 상품 키 */
  readonly product: string | null
  /** 찜의 구매자 자신 */
  readonly buyer: string | null
  readonly text: string
  readonly state: OutboxState
  readonly stateMessage: string
  readonly reason: string | null
  readonly reasonMessage: string | null
  readonly attempts: number
  readonly nextAt: string | null
  readonly postedAt: string | null
  readonly messageId: string | null
  readonly manual: boolean
  /** 같은 메시지로 함께 보낸(보낼) 다른 행 */
  readonly groupWith: readonly number[]
  /** 판매자가 "유튜브에 올라가 있어요"로 적은 행 (I3) */
  readonly confirmedBySeller?: boolean
  /** 알림에서 뺀 행 (I3) */
  readonly dismissed?: boolean
  readonly dismissedAt?: string | null
}

/** 지운 메시지·유튜브 차단 알림 */
export interface YoutubeNotice {
  readonly id: number
  readonly kind: 'DELETED' | 'BANNED'
  readonly broadcast: string | null
  readonly messageId: string | null
  readonly channel: string
  readonly nick: string
  readonly wasOrder: boolean
  readonly wasCancel: boolean
  readonly banType: 'PERMANENT' | 'TEMPORARY' | null
  readonly banSeconds: number | null
  readonly at: string
  readonly message: string
}

export type QuotaMode = 'NORMAL' | 'BATCH' | 'PAUSED'

/** 유튜브 사용량 (그 판매자 것만 — 호출 종류별 숫자·태평양 날짜는 보이지 않는다) */
export interface QuotaView {
  readonly day: string
  readonly used: number
  readonly remaining: number
  readonly budget: number
  readonly resetsAt: string
  readonly mode: QuotaMode
}

/** SSE `youtube` 알림 (data.kind로 나눈다) */
export type YoutubeEvent =
  | { readonly kind: 'connection'; readonly connection: YoutubeConnection }
  | { readonly kind: 'collector'; readonly broadcast: string; readonly date: string; readonly collector: CollectorView | null }
  | { readonly kind: 'outbox'; readonly date: string; readonly ids?: readonly number[]; readonly summary?: string }
  | { readonly kind: 'quota'; readonly mode: QuotaMode }
  | { readonly kind: 'notice'; readonly date: string; readonly notice: YoutubeNotice }
  | { readonly kind: 'sealed'; readonly date: string }

// ── 시작 마법사·보조자 (I3 dev-notes "화면에게" 2·4) ──────────────────────

export type WizardStatus = 'NEW' | 'IN_PROGRESS' | 'DONE' | 'DISMISSED'

export interface WizardState {
  readonly status: WizardStatus
  readonly step: number | null
}

export interface AssistantItem {
  readonly id: string
  readonly name: string
  readonly loginId: string
  readonly createdAt: string
}
