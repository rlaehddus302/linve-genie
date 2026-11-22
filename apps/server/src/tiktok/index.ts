// 틱톡 라이브 베타 ① 연결 모듈 (N2b-1, PLT-02, D-904, D-N2b-1-01~08). 읽기 전용 — 틱톡에 무엇을 보내는 조작은 없다.
// 입력 = 틱톡 아이디(또는 방송 주소), 출력 = 공통 댓글 레코드(콜백). 서버 시작·API·DB에 잇는 것은 N2b-2 몫이다.
// 계약(N2b-2에게): harness/sprints/N2b-1/dev-notes.md "N2b-2에게".
export { systemTikTokClock, type TikTokClock } from './clock.ts'
export { avatarDataUrl, fetchTikTokAvatar, imageType, isTikTokAvatarUrl, tiktokAvatarUrl, TIKTOK_AVATAR_MAX_BYTES, TIKTOK_AVATAR_TIMEOUT_MS, type TikTokAvatarFetch } from './avatar.ts'
export { fetchTikTokProfile, parseTikTokProfile, TIKTOK_PROFILE_NAME_MAX, TIKTOK_PROFILE_TIMEOUT_MS, type TikTokProfile, type TikTokProfileFetch } from './profile.ts'
export {
  chatEventFields,
  createCommentFilter,
  createExtensionCommentFilter,
  decimalId,
  int64Value,
  TIKTOK_COMMENT_MEMORY,
  TIKTOK_NICKNAME_MAX,
  TIKTOK_TEXT_MAX,
  type TikTokCommentCounts,
  type TikTokCommentFilter,
  type TikTokCommentOutcome,
  type TikTokCommentRecord,
  type TikTokDropCode,
  type TikTokExtensionDropCode,
  type TikTokExtensionFilter,
  type TikTokExtensionItem,
  type TikTokExtensionOutcome,
  type TikTokRawComment,
} from './comment.ts'
export {
  createTikTokConnection,
  tiktokConnectionMemorySize,
  TIKTOK_CONNECT_TIMEOUT_MS,
  TIKTOK_CONSENT_TIMEOUT_MS,
  TIKTOK_GIVE_UP_AFTER,
  TIKTOK_LOG_PER_WINDOW,
  TIKTOK_LOG_WINDOW_MS,
  TIKTOK_NOT_LIVE_GIVE_UP_MS,
  TIKTOK_NOT_LIVE_RETRY_MS,
  TIKTOK_STALL_MS,
  TIKTOK_RETRY_DELAYS_MS,
  TIKTOK_STABLE_MS,
  type TikTokConnection,
  type TikTokConnectionOptions,
  type TikTokConnectionStatus,
  type TikTokReason,
} from './connection.ts'
export { denyAllTikTokConsent, type TikTokConsentCheck } from './consent.ts'
export {
  FakeTikTokClock,
  FakeWebcast,
  FakeWebcastHandle,
  fakeChatEvent,
  fakeLibraryError,
  fakeNoRoomError,
  flushTikTokTasks,
  type FakeAccountState,
  type FakeChatFields,
  type FakeHandleState,
} from './fake.ts'
export { classifyWebcastFailure, TIKTOK_FAILURE_KINDS, type TikTokFailureKind, type TikTokRetryKind } from './failure.ts'
export {
  createTikTokAttemptLimiter,
  TIKTOK_ATTEMPT_WINDOW_MS,
  TIKTOK_ATTEMPTS_PER_WINDOW,
  UNLIMITED_TIKTOK_ATTEMPTS,
  type TikTokAttemptLimiter,
} from './limiter.ts'
export { libraryWebcast, TIKTOK_LINGER_WAIT_MS, type LibraryConnectionConstructor, type LibraryConnectionLike, type LibraryWebcastOptions } from './library.ts'
export {
  TIKTOK_MISSED_MESSAGE,
  TIKTOK_STATES,
  TIKTOK_STATUS_MESSAGES,
  tiktokStatusMessage,
  type TikTokOffReason,
  type TikTokState,
  type TikTokStopReason,
} from './messages.ts'
export {
  libraryOptions,
  readTikTokSettings,
  TIKTOK_LIBRARY_OPTION_KEYS,
  TIKTOK_SETTINGS_OFF,
  TikTokSignKey,
  type TikTokLibraryOptions,
  type TikTokSettings,
  type TikTokSettingsWarning,
} from './settings.ts'
export {
  asciiLower,
  checkTikTokTarget,
  isTikTokTarget,
  parseTikTokTarget,
  TIKTOK_TARGET_INPUT_MAX,
  TIKTOK_TARGET_MESSAGES,
  type TikTokTarget,
  type TikTokTargetCheck,
  type TikTokTargetError,
  type TikTokTargetParse,
} from './target.ts'
export { WEBCAST_EVENTS, type WebcastClient, type WebcastFactory } from './webcast.ts'
export {
  createTikTokSignMeter,
  readTikTokSignLimit,
  TIKTOK_SIGN_DAILY_LIMIT_DEFAULT,
  TIKTOK_SIGN_MESSAGES,
  TIKTOK_SIGN_NEAR_RATIO,
  TIKTOK_SIGN_WINDOW_MS,
  type TikTokSignLevel,
  type TikTokSignMeter,
} from './sign-usage.ts'
export { fetchShortLinkResolver, SHORT_LINK_HOPS, SHORT_LINK_TIMEOUT_MS, type ShortLinkResolver } from './short-link.ts'
