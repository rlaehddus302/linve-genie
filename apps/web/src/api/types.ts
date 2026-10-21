// 서버 응답 모양 (harness/sprints/S04·S05 dev-notes의 화면 계약). 조회 항목은 코어 조회 함수 결과이고 시각 필드(at·endedAt·rankTime)만 ISO 문자열이다.
import type {
  BroadcastDetails,
  BuyerInfo,
  CancelRequestInfo,
  ClaimInfo,
  EffectInfo,
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

// ── 여러 플랫폼·인스타그램·틱톡 (harness/sprints/N2/dev-notes.md "화면에게", N2b-2 dev-notes "화면에게") ──────

export type PlatformName = 'YOUTUBE' | 'INSTAGRAM' | 'TIKTOK'

/** 플랫폼 능력 (GET /api/platforms) — 쓸 수 없는 것마다 서버 문장 */
export interface PlatformCapability {
  readonly platform: PlatformName
  readonly ready: boolean
  readonly receivedTime: boolean
  readonly thanks: string
  readonly videoComment: boolean
  readonly reasons: { readonly ready?: string; readonly receivedTime?: string; readonly thanks?: string; readonly videoComment?: string }
}

/** 인스타그램 수집 상태 */
export interface InstagramCollection {
  readonly platform: PlatformName
  readonly state: 'WAITING' | 'LIVE' | 'FINISHED' | 'STOPPED'
  readonly message: string
  readonly liveId: string | null
  readonly lastCommentAt: string | null
  readonly comments: number
  readonly late: number
  readonly malformed: number
}

/** 인스타그램 연결의 마지막 옮기기 */
export interface InstagramMoved {
  readonly fromLiveId: string
  readonly movedAt: string
  readonly comments: number
  readonly message: string
}

/** 회차의 인스타그램 연결 (GET /api/broadcasts/:id/live 의 link) */
export interface InstagramLinkView {
  readonly broadcast: string
  readonly platform: PlatformName | null
  readonly state: 'NONE' | 'WAITING' | 'LINKED'
  readonly liveId: string | null
  readonly linkedAt: string | null
  readonly actor: { readonly kind: string; readonly loginId: string | null } | null
  readonly accountId: string | null
  readonly collection: InstagramCollection | null
  readonly moved: InstagramMoved | null
}

/** 회차의 끊지 않은 연결 하나 (플랫폼마다) */
export interface PlatformLinkItem {
  readonly broadcast: string
  readonly platform: PlatformName | null
  readonly state: string
}

/** GET /api/broadcasts/:id/live */
export interface BroadcastLive {
  readonly link: InstagramLinkView
  readonly links: readonly PlatformLinkItem[]
}

/** 인스타그램 계정 연결 (토큰·만료 시각은 없다) */
export interface InstagramConnection {
  readonly configured: boolean
  readonly status: 'NOT_CONNECTED' | 'CONNECTED' | 'RECONNECT_NEEDED'
  readonly login: string | null
  readonly account: { readonly id: string; readonly username: string; readonly type: string | null } | null
  readonly permissions: { readonly comments: boolean; readonly messages: boolean }
  readonly consent: { readonly on: boolean; readonly by: string | null; readonly at: string | null }
}

/** 내 인스타그램 라이브 한 줄 (GET /api/instagram/lives) */
export interface InstagramLive {
  readonly id: string
  readonly startedAt: string | null
  /** 이미 이어진 이 판매자의 끝나지 않은 회차 */
  readonly broadcast: string | null
}

/** 감사 DM 한 줄 (보내지 못한 수만 센다) */
export interface InstagramDmRow {
  readonly id: number
  readonly broadcast: string | null
  readonly status: 'WAITING' | 'SENDING' | 'SENT' | 'SKIPPED' | 'FAILED'
  readonly reason: string | null
}

/** SSE `instagram` 알림 */
export type InstagramEvent =
  | { readonly kind: 'CONNECTION'; readonly connection: InstagramConnection }
  | { readonly kind: 'LINK' | 'COLLECTION'; readonly broadcast: string; readonly link: InstagramLinkView }
  | { readonly kind: 'NOTICE'; readonly code: string; readonly message: string; readonly broadcast?: string; readonly liveId?: string; readonly count?: number }
  | { readonly kind: 'DM'; readonly date: string; readonly rows: readonly InstagramDmRow[] }

/** 틱톡 수집 상태 (연결 모듈 상태 + 이 회차에 기록한 수) */
export interface TikTokCollection {
  /** IDLE·CONNECTING·CONNECTED·RETRYING·STOPPED·ENDED·OFF, 회차를 끝냈으면 FINISHED */
  readonly state: string
  readonly reason: string | null
  readonly message: string
  readonly failures: number
  readonly nextAttemptAt: string | null
  readonly missed: boolean
  readonly missedMessage: string | null
  readonly comments: number
  readonly lastCommentAt: string | null
  readonly notRecorded: number
  readonly saveFailed: number
}

/** 회차의 틱톡 연결 (GET /api/broadcasts/:id/tiktok) */
export interface TikTokLinkView {
  readonly broadcast: string
  readonly platform: 'TIKTOK'
  readonly state: 'NONE' | 'LINKED'
  readonly linkedAt: string | null
  readonly actor: { readonly kind: string; readonly loginId: string | null } | null
  readonly tiktokId: string | null
  readonly collection: TikTokCollection | null
}

/** 틱톡 위험 고지 (판은 화면에 보이지 않는 값) */
export interface TikTokNotice {
  readonly version: string
  readonly title: string
  readonly lines: readonly string[]
  readonly checkbox: string
  readonly button: string
}

/** 설정의 "틱톡 라이브(베타)" (GET /api/tiktok) */
export interface TikTokSettings {
  readonly operator: boolean
  readonly operatorMessage: string | null
  readonly notice: TikTokNotice
  readonly consent: { readonly on: boolean; readonly at: string; readonly version: string | null } | null
  readonly tiktokId: string | null
}

/** SSE `tiktok` 알림 */
export interface TikTokEvent {
  readonly kind: 'LINK'
  readonly broadcast: string
  readonly link: TikTokLinkView
}

/** 붙여넣기 줄 결과 */
export interface PasteRowView {
  readonly line: number
  readonly nickname?: string
  readonly text?: string
  readonly result: string
  readonly numbers: readonly number[]
  readonly message: string
  /** 같은 닉네임의 활성 찜이 이미 있어 기본으로 넣지 않는 번호 (D-N2b-2-14, 겹친 줄만) */
  readonly overlaps?: readonly number[]
  /** "{번호}번은 같은 닉네임의 찜이 이미 있어 넣지 않아요." (overlaps가 있을 때만) */
  readonly overlapMessage?: string
}

export interface PasteGroupView {
  readonly nickname: string
  readonly lines: readonly number[]
  readonly claims: number
  readonly message: string | null
}

/** 붙여넣기 미리 보기 (넣기는 added가 더해진다) */
export interface PastePlanView {
  readonly rows: readonly PasteRowView[]
  readonly groups: readonly PasteGroupView[]
  readonly total: number
  readonly added?: number
}
