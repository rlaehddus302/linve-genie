// @livejjim/server 프로그램 API. 테스트(단위·적대)는 여기서 가져와 포트 없이 요청한다.
// S04: PGlite로 DB를 열고(openPglite) createServer(...).app.request(...)로 /api를 부른다. 계정은 createSellerAccount로 만든다.
// S05: 리허설 범위·가짜 채팅 생성기(ChatGenerators·ChatMaker), 증분 조회, E2E 기동(startE2eServer·fillScope).
// S06: 상품 ID 조치 기록(productOwners), 범위별 보기 캐시(StateCache·newViewCaches), 생성기 판매자당 하나(GENERATOR_RECORDS_MAX), E2E 127.0.0.1(E2E_HOST).
// S06b: 합치기 미리 보기 조회(MergePreviewView), 문자찜 응답 buyer, 보기 캐시 상한(ViewCacheBudget — 판매자마다 4·서버 전체 32·10분).
// I1: 서버 출력 기록(PrintService·createAutoJobs·autoLabelEffects), 라벨 데이터(L-9), 운영 설정 조립(productionServerOptions — 시험 모드 신호 없음).
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
// N5 요금 (BILLING_RULES): 순수 함수 넷·운영 설정·결제 어댑터(포트원 V2)·시험 결제(가짜 결제 서버·가짜 발행기)·요금 서비스
export {
  DAY_MS,
  DAY_WINDOW_MS,
  FLAT_NOTICE_MS,
  FLAT_PERIOD_MS,
  GRANT_SOURCES,
  HOUR_MS,
  ORDER_STATES,
  PASS_KINDS,
  PAYMENT_ACTIONS,
  QUANTITY_KINDS,
  REFUND_PERIOD_MS,
  START_MODES,
  billingBanners,
  billingStatus,
  byCodeUnit,
  flatChain,
  isQuantityKind,
  judgePayment,
  maskBizno,
  parseBizno,
  splitVat,
  type Balances,
  type Banner,
  type BillingStatus,
  type BiznoResult,
  type ChainLink,
  type DayWindow,
  type FlatStatus,
  type GrantSource,
  type LedgerGrant,
  type LedgerUsage,
  type LookedUpPayment,
  type OrderState,
  type PassKind,
  type PaymentAction,
  type PaymentJudgeInput,
  type PaymentJudgement,
  type QuantityKind,
  type StartDecision,
  type StartMode,
  type StatusInput,
} from './billing/rules.ts'
export {
  DEFAULT_PRICE_TABLE,
  PLACEHOLDER_REFUSAL,
  PORTONE_REFUSAL,
  parsePriceTable,
  readBillingEnv,
  type BillingEnv,
  type PortOneSettings,
  type PriceItem,
  type PriceTable,
} from './billing/config.ts'
export {
  PAYMENT_ID_RE,
  PORTONE_API_BASE,
  PORTONE_TIMEOUT_MS,
  PortOneGateway,
  WEBHOOK_TOLERANCE_MS,
  checkWebhook,
  mapPortOnePayment,
  signWebhook,
  webhookKey,
  type CancelResult,
  type LookupResult,
  type PaymentGateway,
  type PortOneOptions,
} from './billing/portone.ts'
export { FakeIssuer, RECEIPT_KINDS, noneIssuer, type DocumentIssuer, type DocumentRecipient, type IssueRequest, type IssueResult, type ReceiptKind } from './billing/documents.ts'
export {
  FAKE_PORTONE_BASE,
  FakePortOne,
  TEST_API_SECRET,
  TEST_CHANNEL_KEY,
  TEST_STORE_ID,
  TEST_WEBHOOK_SECRET,
  signedWebhook,
  testBilling,
  type TestBillingOptions,
  type TestPayment,
} from './billing/fake.ts'
export {
  BILLING_LIST_MAX,
  BILLING_MESSAGES,
  BillingService,
  DISABLED_BILLING,
  REFUND_HOLD_MS,
  checkBusiness,
  checkOperatorGrant,
  grantedMessage,
  operatorGrant,
  stateMessage,
  type BannerView,
  type BillingSetup,
  type BillingStatusView,
  type BusinessView,
  type ConfirmView,
  type OrderCreated,
  type PaymentItem,
  type StartPreview,
  type UsageItem,
} from './billing/service.ts'
export { WEBHOOK_PATH } from './billing/api.ts'
