// @livejjim/server 프로그램 API. 테스트(단위·적대)는 여기서 가져와 포트 없이 요청한다.
// S04: PGlite로 DB를 열고(openPglite) createServer(...).app.request(...)로 /api를 부른다. 계정은 createSellerAccount로 만든다.
// S05: 리허설 범위·가짜 채팅 생성기(ChatGenerators·ChatMaker), 증분 조회, E2E 기동(startE2eServer·fillScope).
// S06: 상품 ID 조치 기록(productOwners), 범위별 보기 캐시(StateCache·newViewCaches), 생성기 판매자당 하나(GENERATOR_RECORDS_MAX), E2E 127.0.0.1(E2E_HOST).
// Y1: 유튜브 연동 — 가짜 구글·유튜브 서버(FakeGoogle), 주입 시계(ManualTimer), 글 다루기(이름 정리·묶음·주소 읽기·요약), 할당량·태평양 날짜,
//     시험의 구글 주소 막기(installGoogleBlock), 봉인(Sealer). 서버 조립은 createServer({ youtube, timer, instanceName, … }).
// S06b: 합치기 미리 보기 조회(MergePreviewView), 문자찜 응답 buyer, 보기 캐시 상한(ViewCacheBudget — 판매자마다 4·서버 전체 32·10분).
// I1: 서버 출력 기록(PrintService·createAutoJobs·autoLabelEffects), 라벨 데이터(L-9), 운영 설정 조립(productionServerOptions — 시험 모드 신호 없음).
// N2: 플랫폼 공통 연결(platform·live-links), 인스타그램 묶음(설정·메타 어댑터·가짜 메타 서버·DM 실행기·글 정리).
export { createApp, defaultLogError, type AppOptions, type ErrorLogger } from './app.ts'
export { DEFAULT_PORT, readAppOrigin, readDatabaseSetting, readPort, type DatabaseSetting, type OriginSetting, type PortSetting } from './config.ts'
export {
  apiError,
  describeError,
  errorResponse,
  JSON_CONTENT_TYPE,
  type DescribedError,
  type ErrorBody,
  type ErrorCode,
  type FieldProblem,
} from './errors.ts'
export { clientErrorStatus, createNodeServer, handleClientError, rawErrorResponse, type NodeServerOptions } from './node-server.ts'
// S04 저장소·API·실시간
export { MIGRATIONS_FOLDER, openPglite, openPostgres, type Database, type Db, type OpenOptions } from './db/database.ts'
export * as tables from './db/schema.ts'
export { createServer, masterKeyBuffer, DEFAULT_HEARTBEAT_MS, HOST_ACTION_DELAY_MS, MAX_SNAPSHOT_EVERY, type LivejjimServer, type ServerOptions } from './server.ts'
export { createSellerAccount, LOGIN_ID_RE, normalizeLoginId, type CreateAccountOptions, type CreateAccountResult, type NewAccountInput } from './accounts.ts'
export {
  CLEAR_SESSION_COOKIE,
  LOCK_AFTER_FAILURES,
  LOCK_MS,
  SESSION_COOKIE,
  SESSION_EXTEND_AFTER_MS,
  SESSION_TTL_MS,
  type LoginOutcome,
} from './auth.ts'
export { API_EVENTS, CHAT_FIELDS, REQUEST_ID_RE, type ApiEventSpec } from './api-fields.ts'
export { BODY_LIMIT_BYTES, type ApiDeps } from './api.ts'
export { checkReplay, formatCheck, canonicalJson, type CheckFilter, type CheckPart, type ScopeCheck } from './check-replay.ts'
export {
  CHANGES_MESSAGES_LIMIT,
  FAKE_CHANNEL_RE,
  INHERITED_BLOCK_REASON,
  MERGE_PREVIEW_ID_MAX,
  MESSAGES_LIMIT_DEFAULT,
  MESSAGES_LIMIT_MAX,
  Service,
  VIEWER_NICK_MAX,
  VIEWER_TEXT_MAX,
  type ChangesView,
  type ChatIngestOutcome,
  type HistoryItem,
  type MergePreviewView,
  type ProductFilter,
  type ProductIdFilter,
  type MessageItem,
  type MessagesView,
  type ScopeView,
} from './service.ts'
export { StreamHub, type GeneratorNotice, type ScopeSeq, type StreamNotice } from './hub.ts'
export { DEFAULT_CHANGES_WINDOW, FAILED_INPUT_MESSAGE, REPLAY_SKIPPED_MESSAGE, type AttentionItem, type EngineAdapter, type ScopeRuntime, type StatePoint } from './runtime.ts'
export {
  ScopeWriter,
  WriteAbort,
  eventDigest,
  scopeKey,
  type Actor,
  type CommittedRecord,
  type TxHook,
  type TxHookContext,
  type WriteOutcome,
  type WriteResult,
  type WriterHooks,
} from './writer.ts'
// S05 리허설·증분 조회·E2E 기동
export {
  ChatGenerators,
  ChatMaker,
  GENERATOR_RATE_DEFAULT,
  GENERATOR_RATE_MAX,
  GENERATOR_RATE_MIN,
  GENERATOR_RECORDS_MAX,
  GENERATOR_SEED_MAX,
  GENERATOR_TOTAL_DEFAULT,
  GENERATOR_TOTAL_MAX,
  GENERATOR_TOTAL_MIN,
  SeededRandom,
  generatorView,
  realTimer,
  type GeneratedChat,
  type GeneratorStart,
  type GeneratorStatus,
  type GeneratorTimer,
  type GeneratorView,
  type MessageKind,
  type StopReason,
} from './generator.ts'
export {
  CLAIM_INDEX_CACHE_MAX,
  claimIndex,
  MESSAGE_LOOKUP_CACHE_MAX,
  VIEW_INDEX_CACHE_MAX,
  VIEW_LISTS,
  clearViewCaches,
  newViewCaches,
  type ChangeSet,
  type FullView,
  type SettlementKey,
  type ViewCaches,
  type ViewList,
} from './views.ts'
export { StateCache } from './state-cache.ts'
export {
  VIEW_CACHE_IDLE_MS,
  VIEW_CACHE_SCOPES_MAX,
  VIEW_CACHE_SCOPES_PER_SELLER,
  ViewCacheBudget,
  type ViewCacheBudgetOptions,
  type ViewScope,
} from './view-budget.ts'
export { productOwners, type ActionRow, type CurrentProduct } from './product-history.ts'
export { E2E_ACCOUNT_FILE, E2E_HOST, fillScope, readE2eAccount, startE2eServer, type E2eAccount, type E2eOptions, type E2eServer, type FillOptions, type FillResult } from './e2e.ts'
export { generateMasterKey, phoneKeyOf, readMasterKey, DEFAULT_PASSWORD_COST, type PasswordCost } from './secrets.ts'
export { randomIds, type IdSource } from './ids.ts'
export { formatLog, stderrLog, type LogCode, type LogRecord, type LogSink } from './log.ts'
export { iso, kstDate, kstTime, systemClock, withIsoTimes, type Clock } from './time.ts'
// Y1 유튜브 연동
export { readYoutubeSetting, type YoutubeEnvSetting, type YoutubeSetting } from './config.ts'
export { FakeGoogle, FAKE_HOST, type FakeApproval, type FakeBroadcast, type FakeChannel, type FakeChatMessage, type FakeComment, type FakeFault, type FakeMethod, type FakeOptions } from './youtube/fake-google.ts'
export { ManualTimer, kstMidnightAfter, nextPacificMidnight, pacificDay, pacificOffset, realTimer as realWorkerTimer, settle, type Timer } from './youtube/timer.ts'
export {
  COMMENT_MAX,
  EMPTY_NICK,
  LIVE_CHAT_MAX,
  NICK_MAX,
  SUMMARY_HEADER,
  SUMMARY_KIND,
  THANKS_SUFFIX,
  batchMessages,
  charCount,
  cleanPostText,
  commentText,
  liveChatText,
  parseVideoId,
  sanitizeNick,
  summaryComments,
  truncate,
  type BatchItem,
  type BatchMessage,
  type SummaryLine,
} from './youtube/texts.ts'
export { DEFAULT_COSTS, GOOGLE_ENDPOINTS, GoogleClient, GoogleError, JsonObjectSplitter, POST_TIMEOUT_MS, PUBLISH_SCOPE, READ_SCOPE, REQUEST_TIMEOUT_MS, type ApiMethod, type GoogleEndpoints, type TokenSet } from './youtube/google.ts'
export { DEFAULT_QUOTA, QUOTA_EXCEEDED_MARK, QUOTA_SWEEP_MS, QuotaMeter, modeOf, type QuotaMode, type QuotaSettings, type QuotaView } from './youtube/quota.ts'
export {
  CALLBACK_MESSAGES,
  CONSENT_TARGETS,
  NOT_CONNECTED_MESSAGE,
  RECONNECT_MESSAGE,
  REFRESH_BEFORE_MS,
  STATE_TTL_MS,
  YoutubeAccessError,
  YoutubeConnections,
  type CallbackResult,
  type ConnectionStatus,
  type ConnectionView,
  type ConsentTarget,
} from './youtube/connect.ts'
export {
  AFTER_END_MS,
  COLLECTOR_REASON_MESSAGES,
  COLLECTOR_STATUS_MESSAGES,
  CollectorManager,
  FAILURE_BACKOFF_MS,
  GAP_MESSAGE,
  MIN_CALL_GAP_MS,
  NOTICE_MESSAGES,
  STREAM_REOPEN_MS,
  UPCOMING_CHECK_MS,
  collectorView,
  noticeView,
  type CollectorHooks,
  type CollectorReason,
  type CollectorStatus,
  type CollectorView,
  type NoticeView,
} from './youtube/collector.ts'
export {
  BATCH_MODE_WINDOW_SEC,
  COMMENT_DEADLINE_MS,
  CONFIRM_SLACK_MS,
  CONFIRM_WINDOW_MS,
  LIVE_CHAT_DEADLINE_MS,
  MAX_CONFIRM_TRIES,
  MAX_RETRIES,
  OUTBOX_REASON_MESSAGES,
  OUTBOX_STATE_MESSAGES,
  OutboxRunner,
  RESEND_MESSAGES,
  SENDING_LEASE_MS,
  SUMMARY_DELAY_MS,
  outboxRowView,
  summaryLines,
  type OutboxHooks,
  type OutboxReason,
  type OutboxRowView,
  type OutboxState,
  type OutboxTarget,
} from './youtube/outbox.ts'
export { LEDGER_FORMAT, SEAL_AFTER_DAYS, SEAL_EVERY_MS, SEALED_CHAT_MESSAGE, Sealer, buildLedger, sealAtOf, sealedView, type Ledger } from './youtube/seal.ts'
export { LINK_MESSAGES, YoutubeSystem, checkYoutubeConfig, type LinkCode, type LinkHooks, type LinkView, type LiveBroadcastItem, type YoutubeConfig } from './youtube/system.ts'
export { CALLBACK_PATH } from './youtube/routes.ts'
export { BlockedRequestError, GOOGLE_HOST_RE, blockedRequests, installGoogleBlock } from './youtube/network-guard.ts'
export { SEALED_MESSAGE, splitChatRaw, type ChatSource } from './writer.ts'
export { mergeRaw } from './store.ts'
export { type ChatBatchOutcome, type CollectedChat } from './service.ts'
// I1 출력 기록
export {
  DEVICE_ID_RE,
  DEVICE_NAME_MAX,
  LABEL_ERROR_CODES,
  PAUSE_MESSAGES,
  PRINTER_ERROR_CODES,
  PRINT_MESSAGES,
  PrintService,
  SHOP_NAME_MAX,
  TEMPLATE_MAX_BYTES,
  cleanDeviceName,
  isKnownErrorCode,
  jobWord,
  pauseForError,
  type ActionOutcome,
  type ClaimOutcome,
  type ClaimedJob,
  type JobView,
  type LabelRef,
  type LabelState,
  type LabelView,
  type PrintOptions,
  type QueueSummary,
  type ResultInput,
} from './print.ts'
export {
  autoLabelEffects,
  createAutoJobs,
  lockQueue,
  readQueue,
  type JobReason,
  type JobRow,
  type JobStatus,
  type LabelEffectBody,
  type LabelEffectRow,
  type LabelRow,
  type PauseReason,
  type QueueRow,
} from './print-store.ts'
export { buildClaimIndex, contentKeyOf, currentLabelBuyer, isWinnerOf, packingLabelData, productLabelBuyer, productLabelData, type ClaimIndex } from './label-data.ts'
export { productionServerOptions, type ProductionOptions } from './production.ts'
// N2 플랫폼 공통 연결·인스타그램
export {
  INSTAGRAM_PREFIX,
  PLATFORM_KEY_MAX,
  PLATFORM_MESSAGES,
  PLATFORMS,
  SMS_PREFIX,
  TIKTOK_PREFIX,
  isPlatform,
  platformCapabilities,
  platformOfKey,
  prefixedKey,
  type LiveItem,
  type LiveSource,
  type Platform,
  type PlatformCapability,
  type ThanksMode,
  type ThanksSendResult,
  type ThanksSender,
} from './platform.ts'
export { COLLECTION_MESSAGES, LINK_MESSAGES as LIVE_LINK_MESSAGES, LiveLinks, MOVE_GAP_MS, MOVE_SETTLE_MS, type CollectionView, type LinkOutcome, type LinkView as LiveLinkView, type MoveBlockReason, type MovedView } from './live-links.ts'
export { DEFAULT_SCOPES, DEFAULT_TIMEOUTS, META_ENDPOINTS, instagramSettings, readInstagramConfig, type InstagramEndpoints, type InstagramLogin, type InstagramSettings, type InstagramTimeouts } from './instagram/config.ts'
export { CALLBACK_MESSAGES as IG_CALLBACK_MESSAGES, InstagramConnections, type CallbackCode, type ConnectionView as IgConnectionView } from './instagram/connection.ts'
export { DM_DEADLINE_MS, DM_REASON_MESSAGES, MAX_RETRIES as IG_MAX_RETRIES, RESEND_MESSAGES as IG_RESEND_MESSAGES, RETRY_DELAYS_S, SEND_LEASE_MS, InstagramDms, type DmReason, type DmRowView, type DmStatus } from './instagram/dm.ts'
export { FakeMeta, type FakeAccount, type FakeAccountType, type FakeChange, type FakeDm, type FakeEntry, type FakeFault as FakeMetaFault, type FakeLoginScenario, type FakeOp, type WebhookTarget } from './instagram/fake-meta.ts'
export { ERROR_TABLE, MetaClient, classifyMetaError, type MetaFailure } from './instagram/meta.ts'
export { LIVE_MOVED_MESSAGE, LIVE_NOT_MOVED_MESSAGES, liveMovedMessage, NOTICE_MESSAGES as IG_NOTICE_MESSAGES, type LiveNotMovedReason, type LiveTimer } from './instagram/notices.ts'
export { DM_LINE_MAX, DM_LINES_MAX, FALLBACK_NICK, USERNAME_RE, dmLine, dmText, instagramNick } from './instagram/text.ts'
export { LATE_AFTER_MS, WEBHOOK_BODY_LIMIT } from './instagram/webhook.ts'
// 합치기(N2 + Y1): 유튜브(Y1)와 이름이 겹치는 인스타그램·라이브 연결 내보내기는 IG_·Live·FakeMeta 이름으로 낸다
export type { InstagramModule } from './instagram/index.ts'
