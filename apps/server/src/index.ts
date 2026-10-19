// @livejjim/server 프로그램 API. 테스트(단위·적대)는 여기서 가져와 포트 없이 요청한다.
// S04: PGlite로 DB를 열고(openPglite) createServer(...).app.request(...)로 /api를 부른다. 계정은 createSellerAccount로 만든다.
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
export { createServer, masterKeyBuffer, DEFAULT_HEARTBEAT_MS, MAX_SNAPSHOT_EVERY, type LivejjimServer, type ServerOptions } from './server.ts'
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
export { INHERITED_BLOCK_REASON, Service, type ChatIngestOutcome, type HistoryItem, type ScopeView } from './service.ts'
export { StreamHub, type StreamNotice } from './hub.ts'
export { FAILED_INPUT_MESSAGE, REPLAY_SKIPPED_MESSAGE, type AttentionItem, type EngineAdapter, type ScopeRuntime } from './runtime.ts'
export { ScopeWriter, eventDigest, type Actor, type CommittedRecord, type WriteOutcome, type WriteResult, type WriterHooks } from './writer.ts'
export { generateMasterKey, phoneKeyOf, readMasterKey, DEFAULT_PASSWORD_COST, type PasswordCost } from './secrets.ts'
export { randomIds, type IdSource } from './ids.ts'
export { formatLog, stderrLog, type LogCode, type LogRecord, type LogSink } from './log.ts'
export { iso, kstDate, kstTime, systemClock, withIsoTimes, type Clock } from './time.ts'
