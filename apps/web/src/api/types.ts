// 서버 응답 모양 (harness/sprints/S04·S05 dev-notes의 화면 계약). 조회 항목은 코어 조회 함수 결과이고 시각 필드(at·endedAt·rankTime)만 ISO 문자열이다.
import type { ParcelBrief } from './parcel-types.ts'
import type {
  BroadcastDetails,
  BuyerInfo,
  CancelRequestInfo,
  ClaimInfo,
  EffectInfo,
  PaymentStatus,
  PendingInfo,
  ProductInfo,
  ReviewInfo,
  ReviewReason,
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

export interface Me {
  readonly screenProducts?: boolean
  readonly seller: { readonly name: string }
  readonly loginId: string
  /** 문자로 확인한 휴대폰 번호(가린 것, D-UX3-30) */
  readonly phone?: string | null
  /** 번호를 먼저 확인해야 한다 (문자 인증이 켜진 서버의 번호 없는 판매자 계정) */
  readonly phoneRequired?: boolean
}

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
  readonly salesTotal?: number
  /** 만든 시각 (D-UX3-18 — 옛 서버는 없음) */
  readonly createdAt?: string | null
  /** 한 번이라도 이은 플랫폼 (D-UX3-18 — 옛 서버는 없음) */
  readonly platforms?: readonly ('youtube' | 'tiktok' | 'band')[]
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
  /** 옵션 방송 메시지의 상품 이름·별칭 언급 번호 (SRV1 약속 5 — 서버가 찾는다, 옛 서버면 없음) */
  readonly nameMentions?: readonly number[]
  readonly converted: readonly number[]
  readonly claims: readonly string[]
  readonly failed: boolean
  /** 옵션 방송의 메시지만: 그 메시지로 생긴 찜 (D-O2-12 "주문 21번 M ×2") — 번호 방송의 메시지에는 없다 */
  readonly optionOrders?: readonly ChatOptionOrder[]
  /** 옵션 방송의 메시지만: 그 메시지의 남은 확인 필요 항목 (지우거나 바로잡으면 null) */
  readonly review?: ChatReview | null
}

export interface ChatOptionOrder {
  readonly claim: string
  readonly no: number
  /** 옵션 글 (옵션 없는 상품이면 null) */
  readonly variant: string | null
  readonly qty: number
}

export interface ChatReview {
  readonly reason: ReviewReason
  readonly no: number | null
  readonly options: readonly (readonly [string, string])[] | null
  readonly qty: number | null
}

/** 확인 필요 항목 하나 (GET /api/reviews — O2 dev-notes "화면에게" 5) */
export interface ReviewItem extends IsoTimes<ReviewInfo> {
  readonly date: string
  readonly rehearsal: boolean
  readonly broadcastDate: string
  readonly broadcastTitle: string
  /** 지금의 구매자 표시 이름 (신뢰할 수 없는 글) */
  readonly buyerName: string
  /** 댓글 글(채팅) 또는 메모(문자찜) — 신뢰할 수 없는 글 */
  readonly text: string | null
  /** 문자찜의 받은 시각 글 */
  readonly received: string | null
  /** 문자찜의 전화번호 뒤 4자리 */
  readonly phoneLast4: string | null
  /** 제안 (A1 CMT-06, R-20 10 — 판정이 아니다). 없으면 null. 옛 서버는 키가 없다 */
  readonly suggestion?: ReviewSuggestion | null
  /** AI 제외 이유 (AIY1 D-AIY1-04): 유튜브에서 온 채팅 줄이면 'YOUTUBE_POLICY', 아니면 null. 옛 서버는 키가 없다 */
  readonly excluded?: 'YOUTUBE_POLICY' | null
}

/** 확인 필요 항목의 제안 (A1 dev-notes "화면·시험에게") — RULE = 비슷한 글자로 찾음, AI = AI가 읽음 */
export interface ReviewSuggestion {
  readonly no: number
  /** 옵션 상품이면 모든 항목 (항목 이름 → 선택지 label), 옵션 없는 상품이면 없음 */
  readonly options?: Readonly<Record<string, string>>
  readonly qty: number
  readonly source: 'RULE' | 'AI'
}

/** AI 제안 받기 결과 (POST /api/assist/suggest) */
export type AssistResult = 'DONE' | 'OFF' | 'UNAVAILABLE' | 'LIMIT' | 'FAILED' | 'BUSY'

export interface AssistSuggestResponse {
  readonly result: AssistResult
  readonly called: number
}

/** AI 제안 설정 (GET·PUT /api/assist/settings) */
export interface AssistSettings {
  /** 서버에 키가 있다 */
  readonly available: boolean
  readonly enabled: boolean
  readonly consentedAt: string | null
  readonly usedToday: number
  readonly dailyLimit: number
}

/** 확인 필요 조회 (GET /api/reviews[?broadcast=][&rehearsal=true]) */
export interface ReviewsView {
  readonly rehearsal: boolean
  readonly reviews: readonly ReviewItem[]
  readonly products: readonly Product[]
  readonly broadcasts: readonly BroadcastView[]
  readonly scopes: readonly ScopeSeq[]
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
  /** 옵션 글 (옵션 없는 찜이면 null — O3 D-O3-10). 없으면 null로 본다 */
  readonly variant?: string | null
  /** 수량 = 그 키의 확정 찜 수량 합 (O3). 없으면 1로 본다 */
  readonly qty?: number
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
  /** 포장 때 옵션 글 (O3 D-O3-14). 없으면 null로 본다 */
  readonly variant?: string | null
  /** 포장 때 수량 (O3 D-O3-14). 없으면 1로 본다 */
  readonly qty?: number
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
  /** 택배 줄 (T1 — 접수가 없거나 실패한 시도면 null) */
  readonly parcel?: ParcelBrief | null
}

export interface PackingList {
  readonly date: string
  readonly seq: number
  readonly entries: readonly PackingEntry[]
  /** 30일이 지나 봉인한 날짜에만 `true` — 봉인 안 한 날짜엔 칸이 없다 (D-PL1-04, AC-PL1A-18) */
  readonly sealed?: true
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
  /**
   * 품목: price = 단가, variant = 옵션 글(없으면 null), qty = 수량, amount = 찜 금액(코어 값 그대로 — 없으면 null, 화면은 금액 칸을 비운다, D-O4-06)
   */
  readonly items: readonly { readonly title: string; readonly no: number; readonly name: string; readonly price: number; readonly variant: string | null; readonly qty: number; readonly amount: number | null }[]
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

/** 서버가 방송 주소만으로 유튜브 채팅을 읽는가 (YT-11) — on=false면 운영자가 끔(D-YT-SRV-07) */
export interface YoutubeWebChat {
  readonly on: boolean
}

/**
 * GET /api/youtube/connection 응답 (YT-SRV dev-notes). webChat이 있으면 구글 연결 없이 잇기 칸을 연다(없거나 null이면 옛 공식 읽기).
 * oauth=false면 구글 연결(감사 채팅용)을 쓸 수 없는 서버 — 연결 버튼 대신 안내. 옛 서버는 두 칸이 없다
 */
export interface YoutubeConnectionResponse {
  readonly connection: YoutubeConnection
  readonly webChat?: YoutubeWebChat | null
  readonly oauth?: boolean
  /** 실시간 채팅 감사를 라이브지니 봇이 대신 올리는 판매자 (D-YT-SEND-18) — 없으면 false(옛 서버) */
  readonly botThanks?: boolean
}

/** 내 라이브 목록 한 줄 */
export interface LiveBroadcastItem {
  readonly videoId: string
  readonly title: string
  readonly status: 'LIVE' | 'UPCOMING'
  readonly scheduledStartTime: string | null
  readonly actualStartTime: string | null
  /** 이미 이어진 이 판매자의 회차 ID */
  readonly linkedBroadcast: string | null
  /** 방송 채널 (서버 잇기의 최근 채널 찾기 — "{채널 이름} · {방송 제목}", 바깥 글이라 글자로만, YT-11) */
  readonly channelId?: string
  readonly channelTitle?: string | null
}

export type CollectorStatus = 'STARTING' | 'LIVE' | 'RETRYING' | 'STOPPED' | 'FINISHED' | 'CHAT_ENDED'

/** 수집 상태 (문장은 서버 것을 그대로 보인다 — 받는 방식 mode는 보이지 않는다) */
export interface CollectorView {
  readonly status: CollectorStatus
  readonly statusMessage: string
  readonly reason: string | null
  readonly reasonMessage: string | null
  /** STREAM · POLL(옛 공식 읽기) · WEB(서버가 읽음, YT-11) — 화면에 보이지 않는다 */
  readonly mode: string
  readonly lastMessageAt: string | null
  readonly recorded: number
  readonly skippedBeforeLink: number
  readonly gap: boolean
  readonly gapMessage: string | null
  readonly restartable: boolean
}

/** 방송 잇기 상태 (GET·POST /api/broadcasts/:id/youtube) */
/** 이은 유튜브 방송 (YT-02). channelId = 글 올리는 계정(잇는 때 연결돼 있던 사장님 채널) */
export interface LinkRecordView {
  readonly videoId: string
  readonly channelId: string
  readonly linkedAt: string
  readonly chatEnded: boolean
  /** 방송 채널(영상의 채널, INV1 D-PHN-17). 없거나 비면 글 올리는 계정과 같다(옛 기록, D-INV1-01) */
  readonly broadcastChannelId?: string | null
  /** 방송 채널 이름 — 바깥 글이라 글자로만 보인다(D-INV1-03) */
  readonly broadcastChannelTitle?: string | null
  /** 이을 때 읽은 방송 제목 — 바깥 글이라 글자로만. 옛 기록은 없거나 null (D-UX4-119) */
  readonly broadcastTitle?: string | null
  /** 서버 판단: 초대 방송인가(방송 채널 ≠ 글 올리는 계정) */
  readonly invited?: boolean
}

export interface LinkView {
  readonly link: LinkRecordView | null
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
  /** 크롬 확장에 맡긴 행 (X1 YT-10 AC13) — 공식 연결로는 올리지 않는다 */
  readonly viaExtension?: boolean
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

// ── 시작 마법사 (I3 dev-notes "화면에게" 2·4) ──────────────────────

export type WizardStatus = 'NEW' | 'IN_PROGRESS' | 'DONE' | 'DISMISSED'

export interface WizardState {
  readonly status: WizardStatus
  readonly step: number | null
}

// ── 영수증 보내기·구매자 공유 링크 (N4b dev-notes "dev-server" API) ──────────

/** 링크 상태: 없음·있음(쓸 수 있음)·기간 지남·끊김 */
export type ReceiptLinkStatus = 'NONE' | 'ACTIVE' | 'EXPIRED' | 'REVOKED'

/** 링크 한 줄 — 시각은 ISO(UTC), 주소는 쓸 수 있을 때만 */
export interface ReceiptLink {
  readonly buyer: string
  readonly status: ReceiptLinkStatus
  readonly url: string | null
  readonly expiresAt: string | null
  readonly revokedAt: string | null
}

/** 구매자 줄 (GET /api/days/:date/receipt-buyers) — 품목 있는 묶음, 일괄 순서 */
export interface ReceiptBuyerRow {
  readonly buyer: string
  /** 확인서에 찍힌 이름 */
  readonly name: string
  readonly phoneLast4: string | null
  readonly itemCount: number
  readonly total: number
  readonly payment: PaymentStatus
  readonly received: number
  readonly remaining: number
  /** 리허설 범위면 null */
  readonly link: ReceiptLink | null
  /** 영수증 문자 (D-REAL-03): 아는 번호 끝 4자리·마지막으로 보낸 시각. 문자 칸이 없는 서버·리허설이면 null(옛 서버는 없음) */
  readonly sms?: ReceiptSmsState | null
}

/** 영수증 문자 상태 한 줄 (D-REAL-03) */
export interface ReceiptSmsState {
  readonly last4: string | null
  readonly sentAt: string | null
}

export interface ReceiptBuyers {
  readonly date: string
  readonly rehearsal: boolean
  /** 서버가 문자를 보낼 수 있나 (D-REAL-03 — 옛 서버는 없음) */
  readonly smsReady?: boolean
  readonly buyers: readonly ReceiptBuyerRow[]
}

// ── 여러 플랫폼·인스타그램·틱톡 (harness/sprints/N2/dev-notes.md "화면에게", N2b-2 dev-notes "화면에게") ──────

export type PlatformName = 'YOUTUBE' | 'INSTAGRAM' | 'TIKTOK' | 'BAND'

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
  /** 판매자가 "확인했어요"로 본 저장 실패 수 (D-N2b-2-16, 처음 0) — 알림은 saveFailed > saveFailedSeen일 때만 */
  readonly saveFailedSeen: number
  /** 입력 검사에 걸려 기록하지 않은 댓글 수 (D-N2b-2-17, 운영 확인용 — 화면에 보이지 않는다) */
  readonly skipped: number
  /** 서명 서비스 하루 한도에 가깝거나 넘었을 때의 쉬운 문장 (CH-20) — 없거나 null이면 보이지 않는다 */
  readonly signNotice?: string | null
}

/**
 * 크롬 확장으로 받는 틱톡 (TTX D-TTX-09) — 연결 보기의 `extension`. 화면에는 `route`·`warning` 글자만 쓰고 `state`는 보이지 않는다.
 * `state` NONE = 이 회차에 확장 상태가 한 번도 없음(받는 길 줄 없이 지금 화면 그대로).
 */
export interface TikTokExtensionView {
  readonly state: 'NONE' | 'RECEIVING' | 'STANDBY' | 'STALE' | 'HIDDEN' | 'UNREADABLE' | 'ELSEWHERE'
  /** "확장으로 받는 중" — 이 동안 직접 연결 막힘·멈춤·끊긴 동안 빠짐 때문의 붙여넣기 알림 띠를 띄우지 않는다 */
  readonly active: boolean
  /** 받는 길 한 줄 (서버 문장 그대로) — 없으면 null */
  readonly route: string | null
  /** 확장 경고 문장 (서버 문장 그대로) — 없으면 null */
  readonly warning: string | null
  /**
   * 직접 연결이 막혔고(BLOCKED·SIGN_FAILED 다시 시도·멈춤) 확장을 이었지만 이 회차 확장 상태가 없을 때의 안내 한 줄
   * (D-TTX-17, 서버 문장 그대로 — 경고가 아니다). 없으면 null, 예전 서버면 없음
   */
  readonly hint?: string | null
  readonly screen: 'OWN' | 'OTHER' | 'ELSEWHERE' | null
  readonly hidden: boolean
  readonly statusAt: string | null
  readonly recorded: number
  readonly standby: number
  readonly unread: number
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
  /** 크롬 확장 쪽 (TTX) — 연결이 없으면 null, 예전 서버면 없음 */
  readonly extension?: TikTokExtensionView | null
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

// ── 네이버 밴드 글 댓글 (BND1 — harness/sprints/BND1/dev-notes.md "화면에게") ─────────────────────

/** 판매자의 밴드 계정 (GET /api/band) — 토큰·작성자 구분 값은 없다 */
export interface BandAccount {
  readonly status: 'NOT_CONFIGURED' | 'NOT_CONNECTED' | 'CONNECTED' | 'RECONNECT_NEEDED'
  /** 연결됨이 아니면 그 문장 (연결됨이면 null) */
  readonly message: string | null
  readonly profileName: string | null
  readonly connectedAt: string | null
  /** 기억한 밴드 */
  readonly chosenBand: string | null
}

/** 밴드 알림 한 줄 (지운·고친 댓글·늦게 읽음·막다른 경우) */
export interface BandNotice {
  readonly id: number
  readonly kind: 'DELETED' | 'EDITED' | 'LATE' | 'STUCK'
  readonly message: string
  readonly at: string
  readonly seen: boolean
}

export type BandLinkState = 'NONE' | 'READING' | 'RETRYING' | 'RECONNECT_NEEDED' | 'NO_ACCESS' | 'YOUTUBE_LINKED' | 'FINISHED'

/** 회차의 밴드 글 연결 (GET /api/broadcasts/:id/band 의 link) */
export interface BandLinkView {
  readonly broadcast: string
  readonly platform: 'BAND'
  readonly state: BandLinkState
  /** 상태 문장 (NONE이면 null) */
  readonly message: string | null
  /** 지금 새로 이을 수 있는지와 막는 까닭 */
  readonly canLink: boolean
  readonly blockCode: string | null
  readonly blockMessage: string | null
  readonly linkedAt: string | null
  readonly actor: { readonly kind: string; readonly loginId: string | null } | null
  readonly post: { readonly bandKey: string; readonly postKey: string; readonly firstLine: string } | null
  /** 마지막으로 읽은 때 (성공한 읽기) */
  readonly lastReadAt: string | null
  readonly received: number
  readonly baseline: number
  readonly baselineMessage: string | null
  readonly skipped: Readonly<Record<string, number>>
  readonly skipMessages: readonly string[]
  readonly failures: number
  readonly retryAt: string | null
  readonly rateLimited: boolean
  readonly finishReason: string | null
  readonly notices: {
    readonly items: readonly BandNotice[]
    readonly total: number
    readonly seenUpTo: number
    /** 확인하지 않은 알림 수 — 종류와 상관없이 (알림 띠, D-BND1-17) */
    readonly unseen: number
    /** 확인하지 않은 지운·고친 댓글 알림 수 (화면은 쓰지 않는다 — 알림 띠는 unseen) */
    readonly unseenEdits: number
  }
}

/** 가입한 밴드 한 줄 (GET /api/band/bands) */
export interface BandItem {
  readonly bandKey: string
  readonly name: string
  readonly memberCount: number | null
}

/** 내 글 한 줄 (GET /api/band/posts) */
export interface BandPostItem {
  readonly postKey: string
  readonly createdAt: string | null
  readonly firstLine: string
  readonly commentCount: number | null
}

export interface BandPostsPage {
  readonly posts: readonly BandPostItem[]
  readonly page: number
  readonly more: boolean
  readonly cursor: string | null
}

/** SSE `band` 알림 */
export type BandEvent = { readonly kind: 'ACCOUNT'; readonly band: BandAccount } | { readonly kind: 'LINK'; readonly broadcast: string; readonly link: BandLinkView }

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

// ── 크롬 확장 (X1 YT-10) ─────────────────────────────────────────────

/** 확장 상태 (영어 값은 화면에 보이지 않는다 — message를 쓴다) */
export type ExtensionState = 'NONE' | 'RECEIVING' | 'STALE' | 'HIDDEN' | 'UNREADABLE'

/** GET /api/extension · SSE `extension` */
export interface ExtensionView {
  readonly connected: boolean
  readonly connectedAt: string | null
  readonly lastUsedAt: string | null
  readonly state: ExtensionState
  readonly message: string | null
  /** 경고 상태면 "주문은 손으로 넣어 주세요" */
  readonly manual: string | null
  readonly broadcasts: readonly string[]
  readonly statusAt: string | null
  readonly lastChatAt: string | null
  readonly dropped: number
  /** 확장으로 감사 채팅 올리기 (X1 YT-10 AC11~AC17) */
  readonly thanks?: ExtensionThanksView
}

/** 확장 감사 올리기 경고 — kind(영어)는 보이지 않고 message를 쓴다 */
export interface ExtensionThanksWarning {
  readonly broadcast: string
  readonly kind: 'PAUSED' | 'OWNER'
  readonly message: string
}

export interface ExtensionThanksView {
  readonly enabled: boolean
  readonly enabledAt: string | null
  readonly warnings: readonly ExtensionThanksWarning[]
}

/** POST /api/extension/code · /renew */
export interface ExtensionCode {
  readonly code: string
  readonly expiresAt: string
}
