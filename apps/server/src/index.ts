// @livejjim/server 프로그램 API. 테스트(단위·적대)는 여기서 가져와 포트 없이 요청한다.
// S04: PGlite로 DB를 열고(openPglite) createServer(...).app.request(...)로 /api를 부른다. 계정은 createSellerAccount로 만든다.
// S05: 리허설 범위·가짜 채팅 생성기(ChatGenerators·ChatMaker), 증분 조회, E2E 기동(startE2eServer·fillScope).
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
  FAKE_CHANNEL_RE,
  INHERITED_BLOCK_REASON,
  MESSAGES_LIMIT_DEFAULT,
  MESSAGES_LIMIT_MAX,
  Service,
  VIEWER_NICK_MAX,
  VIEWER_TEXT_MAX,
  type ChangesView,
  type ChatIngestOutcome,
  type HistoryItem,
  type MessageItem,
  type MessagesView,
  type ScopeView,
} from './service.ts'
export { StreamHub, type GeneratorNotice, type ScopeSeq, type StreamNotice } from './hub.ts'
export { DEFAULT_CHANGES_WINDOW, FAILED_INPUT_MESSAGE, REPLAY_SKIPPED_MESSAGE, type AttentionItem, type EngineAdapter, type ScopeRuntime, type StatePoint } from './runtime.ts'
export { ScopeWriter, eventDigest, scopeKey, type Actor, type CommittedRecord, type WriteOutcome, type WriteResult, type WriterHooks } from './writer.ts'
// S05 리허설·증분 조회·E2E 기동
export {
  ChatGenerators,
  ChatMaker,
  GENERATOR_RATE_DEFAULT,
  GENERATOR_RATE_MAX,
  GENERATOR_RATE_MIN,
  GENERATOR_SEED_MAX,
  GENERATOR_TOTAL_DEFAULT,
  GENERATOR_TOTAL_MAX,
  GENERATOR_TOTAL_MIN,
  SeededRandom,
  generatorView,
  realTimer,
  type GeneratedChat,
  type GeneratorStatus,
  type GeneratorTimer,
  type GeneratorView,
  type MessageKind,
  type StopReason,
} from './generator.ts'
export { VIEW_LISTS, type ChangeSet, type FullView, type SettlementKey, type ViewList } from './views.ts'
export { E2E_ACCOUNT_FILE, fillScope, readE2eAccount, startE2eServer, type E2eAccount, type E2eOptions, type E2eServer, type FillOptions, type FillResult } from './e2e.ts'
export { generateMasterKey, phoneKeyOf, readMasterKey, DEFAULT_PASSWORD_COST, type PasswordCost } from './secrets.ts'
export { randomIds, type IdSource } from './ids.ts'
export { formatLog, stderrLog, type LogCode, type LogRecord, type LogSink } from './log.ts'
export { iso, kstDate, kstTime, systemClock, withIsoTimes, type Clock } from './time.ts'
