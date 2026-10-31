// 데이터베이스 스키마 (AC-S04-20, D-069, D-072, D-073, D-074). 마이그레이션 SQL은 apps/server/drizzle/에 있다.
// - 판매자 데이터가 들어가는 모든 테이블에 판매자 ID(seller_id)가 있다(SYS-02). 판매자 테이블은 id가 판매자 ID다.
// - 이벤트 기록은 덧붙이기만 한다(고치거나 지우지 않는다, D-072). 엔진 이벤트는 JSON 문자열(body)로 둔다:
//   jsonb는 NUL 문자·짝 없는 서로게이트가 든 채팅 본문을 받지 않는데, JSON.stringify 결과 문자열은 그것들을 이스케이프한다.
// - 시각은 UTC(timestamptz, 엔진 at은 UTC 밀리초)로 둔다(NFR-07).
// - 전화번호 원문·정규화한 번호는 어디에도 두지 않는다. 판매자 전화번호 키는 마스터 키로 암호화한 값만 둔다(D-073).
// - 이 파일과 마이그레이션이 어긋나지 않는지는 test/schema.test.ts가 실제 DB 구조와 대조한다.
import { and, eq, sql, type SQL } from 'drizzle-orm'
import { bigint, bigserial, boolean, index, integer, pgTable, text, timestamp, unique, uniqueIndex } from 'drizzle-orm/pg-core'

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

/** 판매자(가게). 판매 규칙 설정 덮어쓰기와 암호화한 전화번호 키를 둔다 */
export const sellers = pgTable('sellers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** 판매자마다 무작위로 만든 32바이트 전화번호 키를 서버 마스터 키로 AES-256-GCM 암호화한 값 (D-073) */
  phoneKeyEnc: text('phone_key_enc').notNull(),
  /** 판매 규칙 설정 덮어쓰기(JSON 객체 문자열). 빠진 키는 DOMAIN_RULES 기본값 */
  settings: text('settings').notNull().default('{}'),
  createdAt: timestamptz('created_at').notNull(),
  /** 시작 마법사 상태 (UX-02, AC-I3-50): NEW 처음 · IN_PROGRESS 진행 중 · DONE 마침 · DISMISSED 닫음 */
  wizardStatus: text('wizard_status').notNull().default('NEW'),
  /** 진행 중인 단계 1~5 (IN_PROGRESS일 때만) */
  wizardStep: integer('wizard_step'),
  /**
   * 가게 설정 (I2 D-I2-02, 이벤트 로그 밖): 입금 계좌(은행·계좌번호·예금주 — 셋 다 있거나 셋 다 빈 값)·안내 문장의 JSON 객체 문자열.
   * 가게 이름은 name 칸이다(화면 위 가게 이름과 같은 값)
   */
  shop: text('shop').notNull().default('{}'),
})

/**
 * 로그인 계정 (D-074). 비밀번호는 scrypt 해시만 둔다. 연속 실패·잠금은 login_limits에 둔다.
 * 역할 (SYS-04, D-I3-11): SELLER 판매자 · ASSISTANT 보조자(판매자가 만든다 — 문자찜 입력만). 보조자를 지우면 행은 남기고 지운 시각만 적는다
 * (이벤트의 조치자가 이 행을 가리킨다, 같은 아이디를 다시 만들지 않는다). 지운 계정은 로그인·세션이 되지 않는다
 */
export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    loginId: text('login_id').notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamptz('created_at').notNull(),
    /** SELLER · ASSISTANT */
    role: text('role').notNull().default('SELLER'),
    /** 보조자 이름 (판매자가 적은 메모, 1~20자). 판매자 계정은 null */
    name: text('name'),
    /** 지운 시각 (보조자) */
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [unique('accounts_login_id_uq').on(t.loginId), index('accounts_seller_idx').on(t.sellerId)],
)

/**
 * 로그인 시도 수 (D-074 "같은 아이디로 연속 10번 틀리면 15분 동안 받지 않는다", SA-S04-001·002).
 * - 있는 아이디와 없는 아이디를 같은 표·같은 질의로 센다: 잠금 응답·서버 재시작·인스턴스·정리 어느 쪽으로도 아이디가 있는지 갈리지 않게.
 * - 판매자 데이터가 아니다(로그인 전이라 판매자를 모르고, 없는 아이디도 들어간다). 그래서 seller_id가 없다.
 * - 아이디 원문은 두지 않는다. key = HMAC-SHA256(마스터 키에서 나눈 키, 정규화한 아이디)의 base64url.
 * - failures는 비밀번호를 확인하기 전에 먼저 올린다(확인 중인 시도도 센다). 10에 닿으면 그 자리에서 locked_until을 건다.
 */
export const loginLimits = pgTable(
  'login_limits',
  {
    key: text('key').primaryKey(),
    /** 연속 실패 수 (확인 중인 시도 포함) */
    failures: integer('failures').notNull(),
    /** 이 시각까지 로그인을 받지 않는다 (지나면 다음 시도가 1부터 다시 센다) */
    lockedUntil: timestamptz('locked_until'),
    /** 마지막 시도 시각 (정리할 때 오래된 것부터) */
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [index('login_limits_updated_idx').on(t.updatedAt)],
)

/** 로그인 세션. 토큰 원문은 두지 않고 SHA-256 해시만 둔다 */
export const sessions = pgTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    createdAt: timestamptz('created_at').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    /** 마지막으로 만료 시각을 늘린 때 (쓰는 동안 연장) */
    extendedAt: timestamptz('extended_at').notNull(),
    /** 세션을 만든 방법 (L1, D-L1-03): PASSWORD 아이디·비밀번호 · GOOGLE · KAKAO · NAVER 간편 로그인. 간편 로그인을 끊으면 그 방법으로 만든 세션을 지운다 */
    method: text('method').notNull().default('PASSWORD'),
  },
  (t) => [index('sessions_account_idx').on(t.accountId), index('sessions_seller_idx').on(t.sellerId), index('sessions_method_idx').on(t.accountId, t.method)],
)

/**
 * 간편 로그인 연결 (L1, SYS-01·SYS-02, D-L1-02·D-L1-03·D-L1-05). 판매자 계정(SELLER) ↔ (공급자, 공급자 계정 ID).
 * - (공급자, 공급자 계정 ID)는 서버 전체에서 하나, 계정마다 공급자 하나까지 (DB 유일 제약).
 * - 공급자 토큰·인가 코드·이메일 원문·닉네임 원문 칸은 없다 — 화면에 보일 가린 이름(label, 빈 값 가능)만 둔다
 */
export const loginLinks = pgTable(
  'login_links',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    /** google · kakao · naver */
    provider: text('provider').notNull(),
    /** 공급자 계정 ID (구글 sub · 카카오 id · 네이버 response.id) — 로그·응답에 내지 않는다 */
    providerUserId: text('provider_user_id').notNull(),
    /** 가린 이름 (예: se***@gmail.com · 다*** · 빈 값) */
    label: text('label').notNull().default(''),
    linkedAt: timestamptz('linked_at').notNull(),
    lastLoginAt: timestamptz('last_login_at'),
  },
  (t) => [
    unique('login_links_provider_user_uq').on(t.provider, t.providerUserId),
    unique('login_links_account_provider_uq').on(t.accountId, t.provider),
    index('login_links_seller_idx').on(t.sellerId),
  ],
)

/**
 * 간편 로그인 승인 요청 (L1, D-L1-04). state·브라우저 쿠키 값은 해시만, PKCE 검증 값은 마스터 키로 암호화(구글·카카오만).
 * 로그인(LOGIN)은 로그인 전이라 판매자를 모른다 — seller_id·account_id·session_hash가 비어 있다. 연결(LINK)은 그 판매자 계정·세션에 묶인다.
 * 10분, 한 번만(used_at). 끝난 행은 시작할 때 정리한다
 */
export const loginStates = pgTable(
  'login_states',
  {
    stateHash: text('state_hash').primaryKey(),
    browserHash: text('browser_hash').notNull(),
    provider: text('provider').notNull(),
    /** LOGIN · LINK */
    purpose: text('purpose').notNull(),
    sellerId: text('seller_id').references(() => sellers.id),
    accountId: text('account_id').references(() => accounts.id),
    sessionHash: text('session_hash'),
    verifierEnc: text('verifier_enc'),
    createdAt: timestamptz('created_at').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    usedAt: timestamptz('used_at'),
  },
  (t) => [index('login_states_expires_idx').on(t.expiresAt)],
)

/** 엔진 범위 = (판매자, 방송 날짜, 리허설인지) (R-0 6, D-069, D-081) */
export const scopes = pgTable(
  'scopes',
  {
    id: text('id').primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    /** 방송 날짜 YYYY-MM-DD (KST) */
    date: text('date').notNull(),
    /** 리허설 범위인지 (D-081). 같은 날 실제 범위와 판정·정산·seq·이력·발송함이 따로다. 바뀌지 않는다 */
    rehearsal: boolean('rehearsal').notNull().default(false),
    /**
     * 그 범위의 마지막 이벤트 seq (D-085, AC-S05-60). 이벤트를 커밋하는 같은 트랜잭션에서 고친다(실패 표시 이벤트 포함).
     * SSE ready·범위 목록은 이 값을 읽는다(이벤트 표 집계 없음). 재생 검사 명령이 이벤트 기록의 마지막 seq와 대조한다
     */
    seq: integer('seq').notNull().default(0),
    createdAt: timestamptz('created_at').notNull(),
    /** 유튜브 수집기로 받은 채팅이 하나라도 있는 범위인지 (봉인 대상·봉인 예정 시각, AC-Y1-61·62) */
    youtubeChat: boolean('youtube_chat').notNull().default(false),
    /** 봉인한 시각 (AC-Y1-61). 봉인한 범위는 읽기만 된다 */
    sealedAt: timestamptz('sealed_at'),
    /** 봉인한 판매자 장부 — 형식에 매이지 않는 JSON (엔진 상태 형식과 상관없음) */
    ledger: text('ledger'),
    /** 장부 요약값 SHA-256 (재생 검사 명령이 대조한다) */
    ledgerDigest: text('ledger_digest'),
  },
  (t) => [unique('scopes_seller_date_rehearsal_uq').on(t.sellerId, t.date, t.rehearsal)],
)

/**
 * 방송 목록 (방송 ID → 범위). broadcast.start·broadcast.end 이벤트와 같은 트랜잭션에서 쓴다.
 * 방송 ID는 서버 전체에서 유일하다(기본 키 — 다른 표가 broadcasts(id)를 참조할 수 있다, RA-I2-002). 조회는 늘 판매자 ID와 함께 건다
 */
export const broadcasts = pgTable(
  'broadcasts',
  {
    id: text('id').primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    scopeId: text('scope_id')
      .notNull()
      .references(() => scopes.id),
    date: text('date').notNull(),
    title: text('title').notNull(),
    /** broadcast.start의 seq (그 날짜 안의 선언 순서) */
    startSeq: integer('start_seq').notNull(),
    endedAt: timestamptz('ended_at'),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [index('broadcasts_seller_idx').on(t.sellerId, t.date, t.startSeq)],
)

/**
 * 범위의 이벤트 기록 (DAT-02, D-072). 기록 전에 걸러 입력 오류·미구현은 여기 없다.
 * 유일 제약: (범위, seq), (판매자, 요청 번호), 채팅 (판매자, 방송, 메시지 ID), 문자찜 (판매자, ref) — 값이 null이면 걸리지 않는다
 */
export const events = pgTable(
  'events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    scopeId: text('scope_id')
      .notNull()
      .references(() => scopes.id),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    /** 엔진 이벤트 그대로(type·seq·at 포함)의 JSON 문자열 */
    body: text('body').notNull(),
    /** 엔진 이벤트의 at (서버 시계 UTC 밀리초, 범위 안에서 줄지 않는다) */
    at: bigint('at', { mode: 'number' }).notNull(),
    /** 서버 도착 시각 (UTC, DAT-05 "언제") */
    receivedAt: timestamptz('received_at').notNull(),
    /** 조치자 종류: account(로그인 계정) · server(서버) · collector(채팅 수집기) · deposit(입금 자동 확인, N3) (DAT-05 "누가") */
    actor: text('actor').notNull(),
    accountId: text('account_id').references(() => accounts.id),
    requestId: text('request_id'),
    chatBroadcast: text('chat_broadcast'),
    chatMessageId: text('chat_message_id'),
    smsRef: text('sms_ref'),
    /** 이 입력으로 엔진 상태가 바뀌었는지 */
    changed: boolean('changed').notNull(),
    /** 엔진이 처리하지 못한 입력 (상태는 그 전 그대로, 재생은 건너뛴다, AC-S04-24) */
    failed: boolean('failed').notNull().default(false),
    /** 기록 손상 확인용 요약값: SHA-256(범위·seq·종류·본문·실패 표시[·따로 둔 이름·본문]) (재생 검사 명령이 대조한다) */
    digest: text('digest').notNull(),
    /** 채팅이 어디서 왔는지 (Y1부터): youtube(유튜브 수집기) · rehearsal(리허설 생성기·시청자로 보내기) · other (AC-Y1-60) */
    chatSource: text('chat_source'),
    /** 본문(text)·이름(nick)을 chat_raw에 따로 두었는지 (Y1부터 기록하는 채팅, AC-Y1-60) */
    raw: boolean('raw').notNull().default(false),
  },
  (t) => [
    unique('events_scope_seq_uq').on(t.scopeId, t.seq),
    unique('events_request_uq').on(t.sellerId, t.requestId),
    unique('events_chat_uq').on(t.sellerId, t.chatBroadcast, t.chatMessageId),
    unique('events_sms_ref_uq').on(t.sellerId, t.smsRef),
    /** 채팅 이어 받기 (방송별 seq 뒤·앞, AC-S05-20) */
    index('events_chat_seq_idx').on(t.scopeId, t.chatBroadcast, t.seq),
    /** 인스타그램 댓글 ID는 판매자 안에서 어느 회차든 한 번만 (다시 배달된 댓글을 회차를 정하기 전에 거른다, AC-N2-33, N2 TD-N2-001) */
    index('events_ig_chat_idx').on(t.sellerId, t.chatMessageId).where(sql`chat_message_id LIKE 'ig:%'`),
    index('events_tt_chat_idx').on(t.sellerId, t.chatBroadcast).where(sql`chat_message_id LIKE 'tt:%'`),
  ],
)

/** 발송함 (R-13, AC-S04-30): 엔진이 낸 효과마다 한 줄. 실행·재시도는 S08·S11. 리허설 범위의 행은 rehearsal = true — 실행기가 실행하지 않는다 (D-081) */
export const outbox = pgTable(
  'outbox',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    scopeId: text('scope_id')
      .notNull()
      .references(() => scopes.id),
    effectId: text('effect_id').notNull(),
    /** 효과를 낸 이벤트의 seq */
    seq: integer('seq').notNull(),
    kind: text('kind').notNull(),
    /** 엔진 효과 그대로의 JSON 문자열 */
    body: text('body').notNull(),
    /** 리허설 범위의 효과 (실행하지 않는다 — 유튜브 게시·라벨 자동 출력 없음, D-081) */
    rehearsal: boolean('rehearsal').notNull().default(false),
    createdAt: timestamptz('created_at').notNull(),
    // ── Y1 발송함 실행기 (AC-Y1-30~46). state가 null이면 실행기가 아직 보지 않았거나 다루지 않는 행(라벨·리허설) ──
    /** WAITING · SENDING · SENT · SKIPPED · FAILED */
    state: text('state'),
    /** 기다리는 이유(WINDOW·RETRY·RECONNECT·QUOTA) 또는 보내지 못한 이유(NO_CONSENT·NO_LINK·…) */
    reason: text('reason'),
    /** LIVE_CHAT · VIDEO_COMMENT · SUMMARY */
    target: text('target'),
    broadcastId: text('broadcast_id'),
    /** 한 메시지로 함께 게시하는 행들 (묶음) */
    groupId: text('group_id'),
    /** 실패한 시도 수 (다시 시도 간격·포기) */
    attempts: integer('attempts').notNull().default(0),
    nextAt: timestamptz('next_at'),
    /** 자동 게시 기한 (수동 재전송이면 null) */
    deadlineAt: timestamptz('deadline_at'),
    /** 게시할 글 (봉인하면 지운다) */
    postText: text('post_text'),
    /** 지금 시도에 실제로 보낸 글 (타임아웃 확인용) */
    sentText: text('sent_text'),
    /** 지금 시도를 시작한 시각 */
    attemptAt: timestamptz('attempt_at'),
    /** 타임아웃 확인을 이 시각까지 한다 */
    confirmUntil: timestamptz('confirm_until'),
    /** 확인 시간이 끝난 뒤의 조회(끝 조회)가 실패한 수 — 3번이면 확인하지 못함 (AC-Y1-96) */
    confirmTries: integer('confirm_tries').notNull().default(0),
    /** 게시된 유튜브 메시지·댓글 ID */
    remoteId: text('remote_id'),
    postedAt: timestamptz('posted_at'),
    /** 게시 보고(effect.thanksSent)를 기록했는지 */
    reported: boolean('reported').notNull().default(false),
    /** 판매자가 직접 다시 보낸 행 (동의·기한 없음) */
    manual: boolean('manual').notNull().default(false),
    resendRequestId: text('resend_request_id'),
    leaseOwner: text('lease_owner'),
    leaseUntil: timestamptz('lease_until'),
    updatedAt: timestamptz('updated_at'),
    // ── I3 발송함 정리 (AC-I3-36) ──
    /** 판매자가 "유튜브에 올라가 있어요"로 게시됨을 적은 계정 (그 행의 게시 보고 조치자) */
    confirmedBy: text('confirmed_by'),
    /** 게시됨 확인 요청 번호 (누른 행에만 — 같은 요청 번호는 한 번만) */
    confirmRequestId: text('confirm_request_id'),
    /** 알림에서 뺀 시각·계정 (상태·이유는 그대로, 다시 보내면 지운다) */
    dismissedAt: timestamptz('dismissed_at'),
    dismissedBy: text('dismissed_by'),
    /**
     * 복구·가져오기가 재생으로 다시 만든 효과 (I2 D-I2-11): 실행하지 않는다 — 지난 라벨·감사 메시지를 다시 내지 않는다.
     * 실행기(I1·Y1)의 실행 대상 조회는 rehearsal = false AND restored = false 행만 본다(executableOutboxRows)
     */
    restored: boolean('restored').notNull().default(false),
    /**
     * 게시 경로 (X1 D-X1-19): null = 공식 API(실행기), 'EXTENSION' = 크롬 확장에 맡긴 실시간 채팅 감사.
     * 확장에 맡긴 행은 공식 실행기가 집지 않고(보내기·확인 모두), 맡김이 끝나도 저절로 공식으로 넘기지 않는다(수동 재전송만 지운다)
     */
    via: text('via'),
  },
  (t) => [
    unique('outbox_effect_uq').on(t.sellerId, t.scopeId, t.effectId),
    index('outbox_scope_seq_idx').on(t.scopeId, t.seq),
    unique('outbox_resend_request_uq').on(t.sellerId, t.resendRequestId),
    unique('outbox_confirm_request_uq').on(t.sellerId, t.confirmRequestId),
    index('outbox_runner_idx').on(t.rehearsal, t.state, t.nextAt),
    index('outbox_group_idx').on(t.sellerId, t.groupId),
  ],
)

/** 범위 상태 스냅샷 (속도용, D-072). 형식 번호가 지금 코어와 다르면 쓰지 않고 처음부터 재생한다 */
export const snapshots = pgTable(
  'snapshots',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    scopeId: text('scope_id')
      .notNull()
      .references(() => scopes.id),
    seq: integer('seq').notNull(),
    format: integer('format').notNull(),
    /** 엔진 상태 JSON 문자열 */
    state: text('state').notNull(),
    /** 확인 필요 목록 JSON 문자열 */
    attention: text('attention').notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [unique('snapshots_scope_seq_uq').on(t.scopeId, t.seq)],
)

/** 채팅 본문·이름 (이벤트 기록 본문과 따로, AC-Y1-60). 봉인하면 지운다 */
export const chatRaw = pgTable(
  'chat_raw',
  {
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    scopeId: text('scope_id')
      .notNull()
      .references(() => scopes.id),
    seq: integer('seq').notNull(),
    nick: text('nick').notNull(),
    text: text('text').notNull(),
  },
  (t) => [unique('chat_raw_scope_seq_uq').on(t.scopeId, t.seq)],
)

/** 구글 연결 (AC-Y1-01~06·31). 토큰은 서버 마스터 키로 암호화한 값만. 채널 하나는 판매자 하나에만 */
export const youtubeConnections = pgTable(
  'youtube_connections',
  {
    sellerId: text('seller_id')
      .primaryKey()
      .references(() => sellers.id),
    channelId: text('channel_id').notNull(),
    channelTitle: text('channel_title').notNull(),
    /** CONNECTED · RECONNECT_NEEDED (연결 안 됨은 행이 없다) */
    status: text('status').notNull(),
    /** 게시 권한(youtube.force-ssl)을 받았는지 */
    canPublish: boolean('can_publish').notNull().default(false),
    refreshEnc: text('refresh_enc'),
    accessEnc: text('access_enc'),
    accessExpiresAt: timestamptz('access_expires_at'),
    consentLiveChatAt: timestamptz('consent_live_chat_at'),
    consentLiveChatBy: text('consent_live_chat_by'),
    consentVideoCommentAt: timestamptz('consent_video_comment_at'),
    consentVideoCommentBy: text('consent_video_comment_by'),
    connectedAt: timestamptz('connected_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [unique('youtube_connections_channel_uq').on(t.channelId)],
)

/** 구글 승인 요청 (state는 해시만, 검증 값은 암호화) — 10분, 한 번만 (AC-Y1-01·02) */
export const youtubeOauthStates = pgTable(
  'youtube_oauth_states',
  {
    stateHash: text('state_hash').primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    sessionHash: text('session_hash').notNull(),
    accountId: text('account_id').notNull(),
    verifierEnc: text('verifier_enc').notNull(),
    /** connect(연결) · publish(게시 권한 추가) */
    purpose: text('purpose').notNull(),
    /** publish일 때 켜려던 동의 대상 (LIVE_CHAT · VIDEO_COMMENT) */
    target: text('target'),
    createdAt: timestamptz('created_at').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    usedAt: timestamptz('used_at'),
  },
  (t) => [index('youtube_oauth_states_seller_idx').on(t.sellerId, t.expiresAt)],
)

/** 라이브찜 방송 ↔ 유튜브 방송 (AC-Y1-12·13). 잇기는 엔진 이벤트가 아니다 — 누가·언제 이었는지 여기 남긴다 */
export const youtubeLinks = pgTable(
  'youtube_links',
  {
    id: text('id').primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    scopeId: text('scope_id')
      .notNull()
      .references(() => scopes.id),
    broadcastId: text('broadcast_id').notNull(),
    videoId: text('video_id').notNull(),
    liveChatId: text('live_chat_id').notNull(),
    /** 이을 때 연결돼 있던 채널 = 글 올리는 계정 (감사 채팅·영상 댓글은 이 채널의 토큰으로, D-PHN-19·20) */
    channelId: text('channel_id').notNull(),
    /** 방송 채널 = 붙여 넣은 영상의 채널(snippet.channelId). 비면(INV1 전 기록) 글 올리는 계정과 같다 (D-PHN-17, D-INV1-01) */
    broadcastChannelId: text('broadcast_channel_id'),
    /** 방송 채널 이름(snippet.channelTitle) — 바깥 글, 화면은 글자로만 (D-INV1-03) */
    broadcastChannelTitle: text('broadcast_channel_title'),
    linkedAt: timestamptz('linked_at').notNull(),
    /** 유튜브 방송의 실제 시작 시각. null이면 예정(시작 전) — 수집기는 채팅을 부르지 않고 상태만 본다 (AC-Y1-94) */
    startedAt: timestamptz('started_at'),
    linkedBy: text('linked_by'),
    requestId: text('request_id'),
    unlinkedAt: timestamptz('unlinked_at'),
    unlinkedBy: text('unlinked_by'),
    /** 유튜브 채팅이 끝난 시각 (liveChatEnded·offlineAt) */
    chatEndedAt: timestamptz('chat_ended_at'),
    /** 방송 후 요약 댓글을 만든 시각 (AC-Y1-46) */
    summaryAt: timestamptz('summary_at'),
  },
  (t) => [
    unique('youtube_links_request_uq').on(t.sellerId, t.requestId),
    uniqueIndex('youtube_links_active_uq')
      .on(t.sellerId, t.broadcastId)
      .where(sql`${t.unlinkedAt} is null`),
    index('youtube_links_video_idx').on(t.sellerId, t.videoId),
  ],
)

/** 수집기 (AC-Y1-20~28): 이은 것마다 하나. 이어받기 지점·방식·상태, 서버 전체에서 하나만 돌게 하는 임대 */
export const youtubeCollectors = pgTable(
  'youtube_collectors',
  {
    linkId: text('link_id').primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    scopeId: text('scope_id')
      .notNull()
      .references(() => scopes.id),
    broadcastId: text('broadcast_id').notNull(),
    /** 마지막으로 기록을 마친 응답의 nextPageToken */
    pageToken: text('page_token'),
    /** STREAM · POLL */
    mode: text('mode').notNull(),
    /** STARTING · LIVE · RETRYING · STOPPED · FINISHED · CHAT_ENDED */
    status: text('status').notNull(),
    reason: text('reason'),
    /** 지점 없이 받은 첫 응답을 처리했는지 (잇기 전 채팅 거르기, AC-Y1-25) */
    firstDone: boolean('first_done').notNull().default(false),
    /** 일부를 받지 못했을 수 있다 (지점 거절) */
    gap: boolean('gap').notNull().default(false),
    skippedBeforeLink: integer('skipped_before_link').notNull().default(0),
    recorded: integer('recorded').notNull().default(0),
    lastMessageAt: timestamptz('last_message_at'),
    /** 할당량 초과로 멈췄을 때 저절로 이어받는 시각. 예정 방송을 기다릴 때(STARTING·NOT_STARTED)는 다음 상태 확인 시각 */
    resumeAt: timestamptz('resume_at'),
    leaseOwner: text('lease_owner'),
    leaseUntil: timestamptz('lease_until'),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [index('youtube_collectors_seller_idx').on(t.sellerId, t.status)],
)

/** 우리 채널이 쓴 메시지 (게시 확인, AC-Y1-26·36). 봉인하면 지운다 */
export const youtubeOwnMessages = pgTable(
  'youtube_own_messages',
  {
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    scopeId: text('scope_id')
      .notNull()
      .references(() => scopes.id),
    liveChatId: text('live_chat_id').notNull(),
    messageId: text('message_id').notNull(),
    text: text('text').notNull(),
    publishedAt: timestamptz('published_at').notNull(),
  },
  (t) => [unique('youtube_own_messages_uq').on(t.sellerId, t.messageId), index('youtube_own_messages_chat_idx').on(t.sellerId, t.liveChatId, t.publishedAt)],
)

/** 지운 메시지·유튜브 차단 알림 (AC-Y1-27). 엔진 입력이 아니다. 봉인하면 지운다 */
export const youtubeNotices = pgTable(
  'youtube_notices',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    scopeId: text('scope_id')
      .notNull()
      .references(() => scopes.id),
    broadcastId: text('broadcast_id').notNull(),
    /** DELETED · BANNED */
    kind: text('kind').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    messageId: text('message_id'),
    channelId: text('channel_id').notNull(),
    nick: text('nick').notNull(),
    wasOrder: boolean('was_order').notNull().default(false),
    wasCancel: boolean('was_cancel').notNull().default(false),
    /** PERMANENT · TEMPORARY */
    banType: text('ban_type'),
    banSeconds: integer('ban_seconds'),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [unique('youtube_notices_dedupe_uq').on(t.sellerId, t.dedupeKey), index('youtube_notices_scope_idx').on(t.sellerId, t.scopeId, t.id)],
)

/** 할당량 계량 (AC-Y1-50~53): 판매자·태평양 날짜·호출 종류마다 횟수·단위 */
export const youtubeQuota = pgTable(
  'youtube_quota',
  {
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    /** 태평양 시간 날짜 YYYY-MM-DD */
    day: text('day').notNull(),
    method: text('method').notNull(),
    calls: integer('calls').notNull().default(0),
    units: integer('units').notNull().default(0),
  },
  (t) => [unique('youtube_quota_uq').on(t.sellerId, t.day, t.method), index('youtube_quota_day_idx').on(t.day)],
)

// ── 출력 기록 (I1, LABEL_RULES L-11, D-I1-01~D-I1-10) ─────────────────────
// 발송함(outbox) 표는 바꾸지 않는다 — 자동 출력 작업은 발송함 행과 같은 트랜잭션에서 이 표들에 따로 쓴다.
// 실제 범위만 쓴다(리허설 범위에는 출력 기록이 없다, L-11 14). 기록은 지우지 않는다(작업 기록을 지우는 API가 없다).

/**
 * 출력 대기열 (판매자마다 한 줄, L-11 4·8·10). 출력 기기·멈춤·순서 번호를 둔다.
 * 출력 기록을 바꾸는 트랜잭션은 모두 이 줄을 먼저 잠근다(FOR UPDATE) — 판매자마다 한 줄로 처리하고 잠금 순서가 늘 같다
 */
export const printQueues = pgTable('print_queues', {
  sellerId: text('seller_id')
    .primaryKey()
    .references(() => sellers.id),
  /** 지금 출력 기기의 기기 ID (화면이 만든 무작위 값). 없으면 null */
  deviceId: text('device_id'),
  /** 출력 기기 이름 (다듬은 뒤 1~20자, 판매자가 정함) */
  deviceName: text('device_name'),
  /** 출력 기기가 알린 프린터 연결 여부 */
  printerConnected: boolean('printer_connected').notNull().default(false),
  /**
   * 출력 기기가 알린 프린터 프로필 ID (PRN2, L-11 10·16, D-PRN2-07). 켠 프로필 표(L-7·L-12)에 있는 값만 — 모르거나 끊겼으면 null.
   * 프린터 기기 ID·이름·주소는 두지 않는다
   */
  printerProfileId: text('printer_profile_id'),
  /** 출력 그만하기를 눌렀고 출력 중인 장의 결과를 기다리는 중 */
  releasing: boolean('releasing').notNull().default(false),
  /** 멈춘 까닭: DISCONNECTED · PRINTER_ERROR · SELLER · LABEL_ERROR (멈추지 않았으면 null) */
  paused: text('paused'),
  /** 새로 출력 기기를 정할 때 쌓인 라벨이 있어 판매자 멈춤으로 시작했다("출력 시작") */
  backlog: boolean('backlog').notNull().default(false),
  /** 대기 맨 끝에 넣을 다음 순서 번호 */
  nextOrder: bigint('next_order', { mode: 'number' }).notNull().default(1),
  /** 대기 맨 앞에 넣을 다음 순서 번호 (줄어든다) */
  frontOrder: bigint('front_order', { mode: 'number' }).notNull().default(0),
  /** 출력 기록이 바뀔 때마다 1씩 는다 (실시간 알림의 순서·빠짐 확인) */
  rev: bigint('rev', { mode: 'number' }).notNull().default(0),
  updatedAt: timestamptz('updated_at').notNull(),
  /**
   * 라벨 기능 켬/끔 (N4a, SPEC RCP-01, L-13 1·D-N4a-01). 기본 켬 — 줄이 없어도 켬. 판매 규칙 설정이 아니다(방송 스냅샷·엔진 입력에 들어가지 않는다).
   * 이 줄을 잠근(lockQueue) 트랜잭션 안에서 읽고 바꾼다: 이벤트 기록의 효과 → 작업, 출력 요청 거절, 켜기·끄기가 같은 잠금으로 한 줄씩 처리된다
   */
  labelsEnabled: boolean('labels_enabled').notNull().default(true),
})

/**
 * 라벨 기능 켬/끔을 바꾼 기록 (N4a, L-13 2). 값이 실제로 바뀔 때마다 한 줄(바뀐 값·시각 UTC·바꾼 계정), 켬/끔을 바꾼 트랜잭션 안에서.
 * 지우지 않는다(지우는 API가 없다). 다른 판매자의 기록은 보이지 않는다(판매자 조건)
 */
export const labelSwitches = pgTable(
  'label_switches',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    /** 바뀐 값 (true = 켬) */
    enabled: boolean('enabled').notNull(),
    /** 바꾼 계정 */
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    changedAt: timestamptz('changed_at').notNull(),
  },
  (t) => [index('label_switches_seller_idx').on(t.sellerId, t.id)],
)

/**
 * 라벨 키 (L-8, L-9, L-11). 상품 = (찜, 확정버전) — key `<찜>@<확정버전>`, 포장 = (포장, 지금의 구매자, 날짜) — key `packing:<구매자>`.
 * 상품 라벨의 구매자는 라벨 키의 첫 작업 때 정해 고정한다(L-9). 폐기는 라벨 키 단위이고 되돌리지 않는다(L-8 4)
 */
export const printLabels = pgTable(
  'print_labels',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    scopeId: text('scope_id')
      .notNull()
      .references(() => scopes.id),
    /** 범위 날짜 YYYY-MM-DD (실제 범위만) */
    date: text('date').notNull(),
    key: text('key').notNull(),
    /** product · packing */
    kind: text('kind').notNull(),
    /** 상품: 찜 ID·확정버전·처음 작업 때의 방송·번호 */
    claim: text('claim'),
    version: integer('version'),
    broadcast: text('broadcast'),
    no: integer('no'),
    /** 포장: 요청 때의 지금의 구매자 ID */
    buyerId: text('buyer_id'),
    /** 라벨의 구매자 (L-3 buyer JSON — 유튜브 닉네임 또는 문자찜. 메모·전화번호 없음) */
    buyer: text('buyer').notNull(),
    /** 자동 출력 효과 ID (그 라벨 키의 PRINT_PRODUCT_LABEL — 엔진 출력 보고에 쓴다) */
    effectId: text('effect_id'),
    voidedAt: timestamptz('voided_at'),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [unique('print_labels_key_uq').on(t.sellerId, t.scopeId, t.key), index('print_labels_scope_idx').on(t.sellerId, t.scopeId, t.kind)],
)

/**
 * 출력 작업 (L-8 작업 + L-11 1). 작업 ID(job_id)는 자동 출력이면 효과 ID, 아니면 서버가 만든 값 — 범위 안에서 유일.
 * 상태: WAITING 대기 · PRINTING 출력 중 · DONE 출력함 · CANCELLED 출력 안 함. 폐기(voided)는 상태와 따로 붙는다.
 * 판매자마다 출력 중 작업은 많아야 하나다(부분 유일 인덱스)
 */
export const printJobs = pgTable(
  'print_jobs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    scopeId: text('scope_id')
      .notNull()
      .references(() => scopes.id),
    labelId: bigint('label_id', { mode: 'number' })
      .notNull()
      .references(() => printLabels.id),
    date: text('date').notNull(),
    jobId: text('job_id').notNull(),
    /** product · packing */
    kind: text('kind').notNull(),
    /** 만든 까닭: auto 자동 · manual 손으로 · reprint 다시 출력 · packing 포장 */
    reason: text('reason').notNull(),
    status: text('status').notNull(),
    voided: boolean('voided').notNull().default(false),
    /** 포장 라벨: 요청 때 정한 라벨 데이터 JSON (L-4 칸만). 상품 라벨은 null — 출력 기기가 받을 때 만든다(L-9) */
    data: text('data'),
    /** 포장 라벨의 쪽(1부터)·쪽 수·요청 때의 한 장 번호 수 */
    page: integer('page'),
    pages: integer('pages'),
    perPage: integer('per_page'),
    /** 대기 순서 (작을수록 앞). 맨 앞으로 되돌릴 때는 대기열의 front_order를 쓴다 */
    queueOrder: bigint('queue_order', { mode: 'number' }).notNull(),
    /** 실패한 시도 수 */
    attempts: integer('attempts').notNull().default(0),
    /** 마지막 오류 코드 (L-7·라벨 오류 코드, DOES_NOT_FIT이면 `DOES_NOT_FIT:<항목>`) */
    lastError: text('last_error'),
    /** 출력함이 된 시각·기기 이름·찍은 데이터의 내용 키·찍은 데이터 */
    printedAt: timestamptz('printed_at'),
    deviceName: text('device_name'),
    contentKey: text('content_key'),
    printedData: text('printed_data'),
    /** 버릴 라벨 확인 ("버렸어요") — 누른 계정·시각 */
    discardedAt: timestamptz('discarded_at'),
    discardedBy: text('discarded_by'),
    /** 손으로·다시 출력·포장 작업을 요청한 계정 */
    requestedBy: text('requested_by'),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [
    unique('print_jobs_job_uq').on(t.sellerId, t.scopeId, t.jobId),
    index('print_jobs_queue_idx').on(t.sellerId, t.status, t.queueOrder),
    index('print_jobs_label_idx').on(t.labelId),
    uniqueIndex('print_jobs_one_printing_uq').on(t.sellerId).where(sql`status = 'PRINTING'`),
  ],
)

/** 출력 시도 (L-11 6): 출력 기기가 작업을 받을 때마다 한 줄. 결과는 그 시도의 표(token)로만 받는다 */
export const printAttempts = pgTable(
  'print_attempts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    jobRef: bigint('job_ref', { mode: 'number' })
      .notNull()
      .references(() => printJobs.id),
    token: text('token').notNull(),
    deviceId: text('device_id').notNull(),
    deviceName: text('device_name').notNull(),
    /** 이 시도에 준 라벨 데이터 JSON (L-3·L-4 칸만) */
    data: text('data').notNull(),
    /** 받기 시점의 템플릿 — 앱도 웹에 준 것과 같은 점을 출력한다(APP-03). */
    template: text('template'),
    contentKey: text('content_key').notNull(),
    /** DONE 또는 오류 코드 (결과가 아직 없으면 null) */
    result: text('result'),
    startedAt: timestamptz('started_at').notNull(),
    endedAt: timestamptz('ended_at'),
  },
  (t) => [unique('print_attempts_token_uq').on(t.sellerId, t.token), index('print_attempts_job_idx').on(t.jobRef)],
)

/** 라벨 템플릿 (L-11 13): 판매자마다 상품·포장 한 벌씩. 저장한 적이 없으면 50×30 기본 템플릿 */
export const labelTemplates = pgTable(
  'label_templates',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    /** product · packing */
    kind: text('kind').notNull(),
    /** 검사를 통과한 템플릿 JSON (templateToJson) */
    body: text('body').notNull(),
    /** 저장할 때마다 1씩 는다 (다른 기기가 먼저 바꿨는지 확인) */
    version: integer('version').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [unique('label_templates_kind_uq').on(t.sellerId, t.kind)],
)

/** 출력 요청 번호 (손으로 출력·다시 출력·포장 라벨 — 같은 요청 번호면 같은 결과, 작업이 두 번 생기지 않는다) */
export const printRequests = pgTable(
  'print_requests',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    requestId: text('request_id').notNull(),
    /** 처음 결과 JSON (만든 작업의 범위 날짜·작업 ID) */
    result: text('result').notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [unique('print_requests_uq').on(t.sellerId, t.requestId)],
)

// ── 플랫폼 라이브 연결·인스타그램 (N2, PLT-01·PLT-03, D-N2-01~D-N2-15) ──────────────
// 발송함(outbox) 표는 바꾸지 않는다 — 인스타그램 DM 발송 기록은 이 표들에 따로 쓴다(I1 출력 기록과 같은 방식, D-N2-01).
// 토큰은 서버 마스터 키로 암호화한 값만 둔다(D-073, D-N2-06). OAuth state는 해시만 둔다. 웹훅 원문은 어디에도 두지 않는다(D-N2-07).

/**
 * 인스타그램 계정 연결 (판매자마다 하나, 계정 하나는 판매자 하나에만 — D-N2-06). 끊으면 행을 지운다(토큰·DM 동의 함께).
 * 상태: CONNECTED 연결됨 · RECONNECT_NEEDED 다시 연결 필요 (행이 없으면 NOT_CONNECTED)
 */
export const igConnections = pgTable(
  'ig_connections',
  {
    sellerId: text('seller_id')
      .primaryKey()
      .references(() => sellers.id),
    /** 로그인 방식: FACEBOOK · INSTAGRAM */
    login: text('login').notNull(),
    /** 인스타그램 프로페셔널 계정 ID (웹훅 entry[].id) */
    accountId: text('account_id').notNull(),
    username: text('username').notNull(),
    /** 계정 종류: BUSINESS · CREATOR (메타가 알려 주지 않으면 null) */
    accountType: text('account_type'),
    /** 페이스북 로그인: 계정이 붙은 페이지 ID */
    pageId: text('page_id'),
    /** 토큰 묶음(사용자·페이지·인스타 토큰 JSON)을 서버 마스터 키로 AES-256-GCM 암호화한 값 */
    tokensEnc: text('tokens_enc').notNull(),
    /** 지금 토큰을 받은 시각·만료 시각(인스타그램 로그인의 긴 토큰만, 페이스북 로그인 페이지 토큰은 null) */
    tokenObtainedAt: timestamptz('token_obtained_at').notNull(),
    tokenExpiresAt: timestamptz('token_expires_at'),
    /** 받은 권한: 댓글 읽기·메시지 */
    permComments: boolean('perm_comments').notNull(),
    permMessages: boolean('perm_messages').notNull(),
    status: text('status').notNull(),
    /** DM 자동 발송 동의 (기본 꺼짐 — null). 켠 시각·켠 로그인 계정 */
    consentAt: timestamptz('consent_at'),
    consentBy: text('consent_by').references(() => accounts.id),
    /** 형식 틀린 댓글 수 (판매자 단위, AC-N2-35) */
    malformedCount: integer('malformed_count').notNull().default(0),
    connectedAt: timestamptz('connected_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [unique('ig_connections_account_uq').on(t.accountId)],
)

/** OAuth state (그 로그인 세션에 묶임, 해시만, 10분·한 번 — AC-N2-10). purpose: CONNECT 연결·다시 연결 · MESSAGES DM 동의를 켜려고 메시지 권한을 다시 요청 */
export const igOauthStates = pgTable(
  'ig_oauth_states',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    sessionHash: text('session_hash').notNull(),
    stateHash: text('state_hash').notNull(),
    purpose: text('purpose').notNull(),
    login: text('login').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    usedAt: timestamptz('used_at'),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [unique('ig_oauth_states_state_uq').on(t.stateHash), index('ig_oauth_states_seller_idx').on(t.sellerId)],
)

/**
 * 회차의 라이브 연결 기록 (PLT-03, D-N2-08). 상태: WAITING 기다리는 중 · LINKED 이어짐 · UNLINKED 끊음.
 * 회차·플랫폼마다 끊지 않은 연결(WAITING·LINKED)은 하나뿐이다(부분 유일 인덱스 — N2b-2부터 플랫폼마다, D-N2b-2-01). 지금은 인스타그램만 이 표를 쓴다. 잇기는 엔진 이벤트가 아니다 — 누가·언제는 여기 남는다(DAT-05)
 */
export const liveLinks = pgTable(
  'live_links',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    broadcastId: text('broadcast_id')
      .notNull()
      .references(() => broadcasts.id),
    /** YOUTUBE · INSTAGRAM · TIKTOK (지금은 INSTAGRAM만 쓴다) */
    platform: text('platform').notNull(),
    state: text('state').notNull(),
    /** 이은 라이브 ID (인스타그램 미디어 ID — LINKED일 때) */
    liveId: text('live_id'),
    /** 이은(기다리기로 정한) 때 연결돼 있던 인스타그램 계정 ID */
    accountId: text('account_id'),
    /** 조치자: account(판매자 계정) · server(저절로 잇기) */
    actor: text('actor').notNull(),
    actorAccountId: text('actor_account_id').references(() => accounts.id),
    linkedAt: timestamptz('linked_at').notNull(),
    unlinkedAt: timestamptz('unlinked_at'),
    unlinkedBy: text('unlinked_by').references(() => accounts.id),
    /** 늦게 받은 댓글 수·형식 틀린 댓글 수 (AC-N2-36·37) */
    lateCount: integer('late_count').notNull().default(0),
    malformedCount: integer('malformed_count').notNull().default(0),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [
    // 회차·플랫폼마다 끊지 않은 연결 하나 (동시 송출, D-N2b-2-01)
    uniqueIndex('live_links_open_uq').on(t.sellerId, t.broadcastId, t.platform).where(sql`state <> 'UNLINKED'`),
    index('live_links_broadcast_idx').on(t.sellerId, t.broadcastId),
    index('live_links_live_idx').on(t.sellerId, t.liveId),
  ],
)

/**
 * 저절로 이은 연결을 같은 계정의 새 라이브로 옮긴 기록 (AC-N2-25, D-N2-16). 옮기기는 끊기가 아니다 — 연결 행(live_links)은 그대로 두고
 * 라이브 ID·이은 시각만 바꾸며, 이전 라이브 ID·옮긴 시각·조치자(서버)는 여기에 남는다. "이어진 적이 있는 라이브"는 live_links.live_id와 이 표의 두 라이브 ID다.
 */
export const liveLinkMoves = pgTable(
  'live_link_moves',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    linkId: bigint('link_id', { mode: 'number' })
      .notNull()
      .references(() => liveLinks.id),
    broadcastId: text('broadcast_id')
      .notNull()
      .references(() => broadcasts.id),
    platform: text('platform').notNull(),
    /** 옮기기 전 라이브 ID · 옮긴 라이브 ID */
    fromLiveId: text('from_live_id').notNull(),
    toLiveId: text('to_live_id').notNull(),
    /** 옮길 때의 인스타그램 계정 ID (옮기기 전과 같은 계정이어야 옮긴다) */
    accountId: text('account_id').notNull(),
    /** 조치자: server (판매자가 손으로 이은 연결은 옮기지 않는다) */
    actor: text('actor').notNull(),
    /** 옮기기 전까지 이 방송에 기록한 인스타그램 댓글 수 (알림 LIVE_MOVED의 N) */
    commentsBefore: integer('comments_before').notNull(),
    movedAt: timestamptz('moved_at').notNull(),
  },
  (t) => [index('live_link_moves_from_idx').on(t.sellerId, t.fromLiveId), index('live_link_moves_to_idx').on(t.sellerId, t.toLiveId)],
)

/** 이어지지 않은 라이브의 댓글 수 (라이브마다 수·처음·마지막 받은 시각만 — 본문·이름·IGSID·댓글 ID 없음, AC-N2-24) */
export const liveUnlinked = pgTable(
  'live_unlinked',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    platform: text('platform').notNull(),
    liveId: text('live_id').notNull(),
    count: integer('count').notNull(),
    firstAt: timestamptz('first_at').notNull(),
    lastAt: timestamptz('last_at').notNull(),
  },
  (t) => [unique('live_unlinked_uq').on(t.sellerId, t.platform, t.liveId)],
)

/** 라이브 잇기·DM 수동 재전송 요청 번호 (같은 요청 번호면 처음 결과 — 두 번 하지 않는다) */
export const liveRequests = pgTable(
  'live_requests',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    requestId: text('request_id').notNull(),
    /** 처음 응답 JSON (상태 코드·본문) */
    result: text('result').notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [unique('live_requests_uq').on(t.sellerId, t.requestId)],
)

/**
 * 인스타그램 DM 발송 하나 (댓글 하나에 DM 하나 — D-N2-09). 댓글마다 진행 중인 발송(PENDING·SENDING·CONFIRMING)은 하나뿐이다(부분 유일 인덱스).
 * 상태: PENDING 다음 시도 기다림 · SENDING 보내는 중(임대) · CONFIRMING 타임아웃 뒤 대화 조회로 확인하는 중 · SENT · FAILED · UNCONFIRMED
 */
export const igDmSends = pgTable(
  'ig_dm_sends',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    scopeId: text('scope_id')
      .notNull()
      .references(() => scopes.id),
    date: text('date').notNull(),
    broadcastId: text('broadcast_id').notNull(),
    /** 받는 댓글 (`ig:` 메시지 ID) */
    comment: text('comment').notNull(),
    /** 댓글 쓴 사람의 IGSID (타임아웃 뒤 대화 조회) */
    igsid: text('igsid').notNull(),
    /** 마지막 시도에 실제로 보낸 글 (타임아웃 확인은 이 글로 한다) */
    text: text('text'),
    state: text('state').notNull(),
    reason: text('reason'),
    /** 실패한 시도 수 (다시 시도 2·4·8·16·32초, 최대 5번) */
    attempts: integer('attempts').notNull().default(0),
    nextAt: timestamptz('next_at'),
    /** 보내는 중·확인 중 임대 (서버가 죽으면 지난 뒤 확인부터) */
    leaseUntil: timestamptz('lease_until'),
    /** 마지막 시도를 시작한 시각 */
    startedAt: timestamptz('started_at'),
    /** 판매자가 직접 다시 보냄 (동의·기한 없이) */
    manual: boolean('manual').notNull().default(false),
    metaMessageId: text('meta_message_id'),
    sentAt: timestamptz('sent_at'),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('ig_dm_sends_active_uq').on(t.sellerId, t.scopeId, t.comment).where(sql`state IN ('PENDING', 'SENDING', 'CONFIRMING')`),
    index('ig_dm_sends_state_idx').on(t.state, t.nextAt),
  ],
)

/**
 * 인스타그램 DM 행 (인스타그램 회차의 실제 범위 발송함 POST_THANKS 행마다 하나 — 그 효과가 기록되는 같은 트랜잭션에서 만든다).
 * 상태: WAITING(이유 RETRY·RECONNECT·PREVIOUS) · SENDING(CONFIRM) · SENT · SKIPPED(CANCELLED·NO_RECIPIENT·NOT_SUPPORTED) · FAILED(이유)
 */
export const igDmRows = pgTable(
  'ig_dm_rows',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    scopeId: text('scope_id')
      .notNull()
      .references(() => scopes.id),
    date: text('date').notNull(),
    outboxId: bigint('outbox_id', { mode: 'number' })
      .notNull()
      .references(() => outbox.id),
    effectId: text('effect_id').notNull(),
    /** 효과를 낸 이벤트의 seq와 그 이벤트 안 효과 순서 (DM 줄 순서) */
    seq: integer('seq').notNull(),
    ord: integer('ord').notNull(),
    broadcastId: text('broadcast_id').notNull(),
    /** 효과의 상품 키·구매자 자신 */
    product: text('product').notNull(),
    buyer: text('buyer').notNull(),
    /** 받는 댓글 (`ig:` 메시지 ID). 받는 댓글이 없으면 null */
    comment: text('comment'),
    /** DM 한 줄 (효과 문구 정리 — AC-N2-44) */
    line: text('line').notNull(),
    status: text('status').notNull(),
    reason: text('reason'),
    attempts: integer('attempts').notNull().default(0),
    nextAt: timestamptz('next_at'),
    /** 자동 발송 기한 (행이 생긴 뒤 10분, 수동 재전송이면 null) */
    deadlineAt: timestamptz('deadline_at'),
    sendId: bigint('send_id', { mode: 'number' }).references(() => igDmSends.id),
    sentAt: timestamptz('sent_at'),
    metaMessageId: text('meta_message_id'),
    /** effect.thanksSent를 기록했는지 */
    reported: boolean('reported').notNull().default(false),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [
    unique('ig_dm_rows_outbox_uq').on(t.sellerId, t.outboxId),
    index('ig_dm_rows_status_idx').on(t.status, t.sellerId),
    index('ig_dm_rows_comment_idx').on(t.sellerId, t.scopeId, t.comment),
  ],
)

/**
 * 회차의 틱톡 연결 (PLT-02, D-N2b-2-05). 상태: LINKED 이어짐 · ENDED 회차를 끝내 기록을 마침(보기는 남는다) · UNLINKED 끊음.
 * 판매자의 이어진(LINKED) 틱톡 연결은 모든 회차를 통틀어 하나다(부분 유일 인덱스 — 판매자 아이디가 하나라서). 잇기는 엔진 이벤트가 아니다 — 누가·언제는 여기 남는다(DAT-05).
 * 틱톡 아이디는 공개값이지만 로그·오류에 쓰지 않는다
 */
export const tiktokLinks = pgTable(
  'tiktok_links',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    broadcastId: text('broadcast_id')
      .notNull()
      .references(() => broadcasts.id),
    scopeId: text('scope_id')
      .notNull()
      .references(() => scopes.id),
    state: text('state').notNull(),
    /** 이을 때의 틱톡 아이디 (판매자 설정에서 — 이어진 동안은 바꿀 수 없다) */
    tiktokId: text('tiktok_id').notNull(),
    actorAccountId: text('actor_account_id').references(() => accounts.id),
    linkedAt: timestamptz('linked_at').notNull(),
    /** 마지막으로 연결을 시작한 시각 (잇기·다시 연결 — 다시 연결은 30초에 한 번) */
    startedAt: timestamptz('started_at').notNull(),
    endedAt: timestamptz('ended_at'),
    unlinkedAt: timestamptz('unlinked_at'),
    unlinkedBy: text('unlinked_by').references(() => accounts.id),
    /** 이어진 동안이 아니라 기록하지 않은 댓글 수 · 저장하지 못한 댓글 수 */
    notRecorded: integer('not_recorded').notNull().default(0),
    saveFailed: integer('save_failed').notNull().default(0),
    /** 판매자가 "확인했어요"로 본 저장 실패 수 (D-N2b-2-16) — 알림은 saveFailed > saveFailedSeen일 때만 */
    saveFailedSeen: integer('save_failed_seen').notNull().default(0),
    /** 엔진 입력 검사에 걸려 기록하지 않은 댓글 수 (D-N2b-2-17) — notRecorded와 따로 */
    skipped: integer('skipped').notNull().default(0),
    /**
     * 크롬 확장으로 받은 틱톡 (TTX, D-TTX-07·09): 확장 경로로 기록한 댓글 수 · 직접 연결이 받는 중이라 기록하지 않고 대기로 센 댓글 수,
     * 마지막 확장 상태(10초마다 — 받은 시각·화면 OWN/OTHER/ELSEWHERE·탭 뒤로 감·읽은 수·읽지 못한 수·읽지 못함만 이어진 첫 시각).
     * 상태가 한 번도 오지 않았으면 ext_status_at이 없다. 끊기(확장 연결 끊기)면 상태 칸을 비운다
     */
    extRecorded: integer('ext_recorded').notNull().default(0),
    extStandby: integer('ext_standby').notNull().default(0),
    extStatusAt: timestamptz('ext_status_at'),
    extScreen: text('ext_screen'),
    extHidden: boolean('ext_hidden').notNull().default(false),
    extRead: integer('ext_read').notNull().default(0),
    extUnread: integer('ext_unread').notNull().default(0),
    extUnreadSince: timestamptz('ext_unread_since'),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('tiktok_links_open_uq').on(t.sellerId, t.broadcastId).where(sql`state = 'LINKED'`),
    uniqueIndex('tiktok_links_seller_uq').on(t.sellerId).where(sql`state = 'LINKED'`),
    index('tiktok_links_broadcast_idx').on(t.sellerId, t.broadcastId),
  ],
)

/** 틱톡 사용 동의 기록 (D-904, D-N2b-2-04, DAT-05). 켬·끔을 한 줄씩 쌓는다(고치거나 지우지 않는다) — 지금 상태 = 그 판매자의 마지막 줄 */
export const tiktokConsents = pgTable(
  'tiktok_consents',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    on: boolean('on').notNull(),
    /** 켤 때 읽은 위험 고지 판 (끌 때는 null) */
    noticeVersion: text('notice_version'),
    requestId: text('request_id').notNull(),
    at: timestamptz('at').notNull(),
  },
  (t) => [unique('tiktok_consents_request_uq').on(t.sellerId, t.requestId), index('tiktok_consents_seller_idx').on(t.sellerId, t.id)],
)

/** 판매자의 틱톡 아이디 하나 (checkTikTokTarget으로 해석한 값) */
export const tiktokAccounts = pgTable('tiktok_accounts', {
  sellerId: text('seller_id')
    .primaryKey()
    .references(() => sellers.id),
  tiktokId: text('tiktok_id').notNull(),
  updatedAt: timestamptz('updated_at').notNull(),
  updatedBy: text('updated_by').references(() => accounts.id),
})

/**
 * 판매자의 밴드 계정 연결 하나 (BND1, D-BND1-11). 토큰은 서버 마스터 키로 암호화한 값만 둔다(평문 없음, DAT-06). refresh_token은 두지 않는다.
 * 상태: CONNECTED · RECONNECT_NEEDED(10401·만료 — 다시 연결하면 같은 user_key일 때 이어 읽음). 끊으면 행을 지운다
 */
export const bandAccounts = pgTable('band_accounts', {
  sellerId: text('seller_id')
    .primaryKey()
    .references(() => sellers.id),
  /** 밴드가 준 판매자 user_key (판매자 댓글·내 글 판단) */
  userKey: text('user_key').notNull(),
  tokenEnc: text('token_enc').notNull(),
  /** 토큰이 끝나는 시각 (expires_in이 없으면 null) */
  expiresAt: timestamptz('expires_at'),
  status: text('status').notNull(),
  profileName: text('profile_name'),
  connectedAt: timestamptz('connected_at').notNull(),
  /** 판매자가 마지막에 고른 밴드 키 (다음에 먼저 고른다) */
  chosenBand: text('chosen_band'),
  updatedAt: timestamptz('updated_at').notNull(),
})

/** 밴드 연결 시작의 한 번 쓰는 표 (D-BND1-11): 돌아오는 주소 경로에 붙는다. 원문은 두지 않고 해시만. 10분·한 번·그 로그인 세션 */
export const bandOauthStates = pgTable(
  'band_oauth_states',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    sessionHash: text('session_hash').notNull(),
    stateHash: text('state_hash').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    usedAt: timestamptz('used_at'),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [unique('band_oauth_states_state_uq').on(t.stateHash), index('band_oauth_states_seller_idx').on(t.sellerId)],
)

/**
 * 회차에 이은 밴드 글 하나 (BND1, D-BND1-07·10·12). 상태: READING · RETRYING · RECONNECT_NEEDED · NO_ACCESS · YOUTUBE_LINKED · FINISHED(finish_reason).
 * 끝나지 않은(FINISHED가 아닌) 연결은 회차마다 하나, 판매자마다 하나(부분 유일 인덱스). 잇기·끊기는 엔진 이벤트가 아니다 — 누가·언제는 여기 남는다(DAT-05).
 * 회차·범위를 외래 키로 잇지 않는다 — 복구·가져오기가 범위를 다시 만들어도 이 행은 남고 FINISHED(RESTORED)가 된다(D-BND1-14)
 */
export const bandLinks = pgTable(
  'band_links',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    broadcastId: text('broadcast_id').notNull(),
    /** 회차의 범위 날짜 (KST) */
    date: text('date').notNull(),
    state: text('state').notNull(),
    /** FINISHED의 까닭: UNLINKED · ENDED · ACCOUNT_CHANGED · DISCONNECTED · RESTORED */
    finishReason: text('finish_reason'),
    bandKey: text('band_key').notNull(),
    postKey: text('post_key').notNull(),
    /** 글 첫 줄 (D-BND1-04로 바꾼 본문의 첫 줄 40자) */
    postLine: text('post_line').notNull(),
    actorAccountId: text('actor_account_id').references(() => accounts.id),
    linkedAt: timestamptz('linked_at').notNull(),
    /** 이을 때 이미 달려 있던 댓글 수 (기준선) */
    baseline: integer('baseline').notNull().default(0),
    /** 넣지 못한 댓글 수 (사유별) — BAD_COMMENT_KEY는 마지막 전체 읽기에 있던 수 */
    skipSeller: integer('skip_seller').notNull().default(0),
    skipNoAuthor: integer('skip_no_author').notNull().default(0),
    skipBadKey: integer('skip_bad_key').notNull().default(0),
    skipBadTime: integer('skip_bad_time').notNull().default(0),
    skipNoText: integer('skip_no_text').notNull().default(0),
    skipTooLong: integer('skip_too_long').notNull().default(0),
    skipDuplicate: integer('skip_duplicate').notNull().default(0),
    /** 마지막으로 읽은(성공한) 시각 */
    lastReadAt: timestamptz('last_read_at'),
    /** 이어서 실패한 수 · 다음 읽기 시각 · 호출 한도로 쉬는지 */
    failures: integer('failures').notNull().default(0),
    retryAt: timestamptz('retry_at'),
    rateLimited: boolean('rate_limited').notNull().default(false),
    /** 판매자가 "확인했어요"로 본 마지막 알림 번호 */
    noticesSeen: bigint('notices_seen', { mode: 'number' }).notNull().default(0),
    finishedAt: timestamptz('finished_at'),
    finishedBy: text('finished_by').references(() => accounts.id),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('band_links_open_uq').on(t.sellerId, t.broadcastId).where(sql`state <> 'FINISHED'`),
    uniqueIndex('band_links_seller_uq').on(t.sellerId).where(sql`state <> 'FINISHED'`),
    index('band_links_broadcast_idx').on(t.sellerId, t.broadcastId),
  ],
)

/**
 * 본 댓글 표 (D-BND1-07): 연결마다 (댓글 키)는 한 번 — 기준선·기록한 것·건너뛴 것 모두. 다음 읽기에서 다시 보지 않는다.
 * 기록한 댓글만 처음 글·닉네임·바꾼 본문의 해시를 둔다(지운·고친 댓글 알림, D-BND1-09). 글·닉네임은 채팅 원문과 같은 보관 규칙으로 지운다(D-BND1-14)
 */
export const bandSeen = pgTable(
  'band_seen',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    linkId: bigint('link_id', { mode: 'number' })
      .notNull()
      .references(() => bandLinks.id),
    commentKey: text('comment_key').notNull(),
    /** BASELINE · RECORDED · SKIPPED */
    kind: text('kind').notNull(),
    textHash: text('text_hash'),
    nick: text('nick'),
    text: text('text'),
    /** 지운 댓글 알림을 냈는지 · 알린 고친 본문의 해시들(공백으로 나눔, 상한 없이 모두 — TD-BND1-001, D-BND1-18) */
    deletedNoticed: boolean('deleted_noticed').notNull().default(false),
    editedHash: text('edited_hash'),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [unique('band_seen_uq').on(t.linkId, t.commentKey), index('band_seen_seller_idx').on(t.sellerId, t.linkId)],
)

/**
 * 밴드 글 연결의 알림 (D-BND1-09·10): DELETED 지운 댓글 · EDITED 고친 댓글 · LATE 오래 못 읽다가 다시 읽음 · STUCK 막다른 경우(차례대로 읽지 못함, AC-BND1-30). 번호 순으로 쌓는다.
 * 손님 글·닉네임은 보관 기간이 지나면 지운다(erased — 문장이 바뀐다)
 */
export const bandNotices = pgTable(
  'band_notices',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    linkId: bigint('link_id', { mode: 'number' })
      .notNull()
      .references(() => bandLinks.id),
    kind: text('kind').notNull(),
    nick: text('nick'),
    beforeText: text('before_text'),
    afterText: text('after_text'),
    /** LATE: 지난 분 · 넣은 댓글 수 */
    minutes: integer('minutes'),
    count: integer('count'),
    erased: boolean('erased').notNull().default(false),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [index('band_notices_link_idx').on(t.sellerId, t.linkId, t.id)],
)

/** 댓글 붙여넣기 넣기 요청 (D-N2b-2-08): 같은 요청 번호는 같은 글일 때만 처음 응답을 돌려준다 — 글은 두지 않고 요약값만 */
export const pasteRequests = pgTable(
  'paste_requests',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    requestId: text('request_id').notNull(),
    broadcastId: text('broadcast_id').notNull(),
    /** (회차, 글)의 요약값 */
    digest: text('digest').notNull(),
    /** 처음 응답 JSON */
    result: text('result').notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [unique('paste_requests_uq').on(t.sellerId, t.requestId)],
)

/**
 * 포장·배송 기록 (STL-08, I2 D-I2-05): 엔진 이벤트가 아니라 서버가 덧붙이기만 하는 기록이다(고치거나 지우지 않는다 — 복구 명령만 예외, D-I2-11).
 * (판매자, 실제 범위 날짜, 그때 지금의 구매자 ID)마다 차례로 읽어 상태를 계산한다. 리허설 범위에는 쓰지 않는다
 */
export const packingRecords = pgTable(
  'packing_records',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    scopeId: text('scope_id')
      .notNull()
      .references(() => scopes.id),
    /** 묶음 날짜 YYYY-MM-DD (실제 범위) */
    date: text('date').notNull(),
    /** 기록할 때의 지금의 구매자 ID (그 ID의 묶음에만 보인다) */
    buyer: text('buyer').notNull(),
    /** PACKED(포장 완료) · UNPACKED(포장 취소) · SHIPPED(배송 완료) · UNSHIPPED(배송 취소) */
    kind: text('kind').notNull(),
    /** 포장 완료의 담은 품목 = 상품 키(`<방송 ID>/<번호>`) 목록 JSON (다른 종류는 null) */
    items: text('items'),
    /** 배송 완료의 송장번호(숫자만, 없으면 null) */
    invoice: text('invoice'),
    /** 누가 (로그인 계정 — 가져온 기록의 계정이 이 서버에 없으면 null) */
    accountId: text('account_id').references(() => accounts.id),
    requestId: text('request_id'),
    /** 언제 (서버 도착 시각 UTC) */
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [unique('packing_request_uq').on(t.sellerId, t.requestId), index('packing_scope_idx').on(t.sellerId, t.scopeId, t.id)],
)

/**
 * 구매자 확인서 공유 링크 (RCP-02, N4b D-N4b-01·06): `<앱 주소>/r/<토큰>` 하나마다 한 행. 토큰 원문은 두지 않는다 —
 * 찾기용 SHA-256 해시(token_hash, base64url)와 판매자 키에서 나눈 키로 암호화한 토큰(token_enc — 판매자가 같은 링크를 다시 복사할 때만 푼다)뿐이다.
 * (판매자, 실제 범위 날짜, 구매자 ID)마다 쓸 수 있는(끊기지 않고 기간 안) 링크는 하나다 — 서버가 (판매자, 날짜) 락 안에서 지킨다.
 * 지우지 않는다(끊기만) — 복구·가져오기(D-I2-11)만 그 판매자의 행을 모두 지운다(D-N4b-06). 백업 파일에는 넣지 않는다
 */
export const receiptLinks = pgTable(
  'receipt_links',
  {
    id: text('id').primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    /** 실제 범위 날짜 YYYY-MM-DD */
    date: text('date').notNull(),
    /** 만들 때의 지금의 구매자 ID (열 때 그 구매자가 지금의 구매자이고 품목이 있을 때만 보인다) */
    buyer: text('buyer').notNull(),
    tokenHash: text('token_hash').notNull(),
    tokenEnc: text('token_enc').notNull(),
    createdAt: timestamptz('created_at').notNull(),
    createdBy: text('created_by').references(() => accounts.id),
    /** 끝나는 시각 = 만든 시각 + 14×24시간 (이 시각부터 열리지 않는다) */
    expiresAt: timestamptz('expires_at').notNull(),
    revokedAt: timestamptz('revoked_at'),
    revokedBy: text('revoked_by').references(() => accounts.id),
  },
  (t) => [unique('receipt_links_token_uq').on(t.tokenHash), index('receipt_links_buyer_idx').on(t.sellerId, t.date, t.buyer, t.createdAt)],
)

/**
 * 공유 링크 요청 번호 (N4b — 만들기·전부 만들기·끊기의 멱등): 같은 요청 번호면 처음 답을 다시 만든다. result는 처음 답의 모양(JSON — 토큰 원문 없음, 링크 ID만)
 */
export const receiptLinkRequests = pgTable(
  'receipt_link_requests',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    requestId: text('request_id').notNull(),
    date: text('date').notNull(),
    /** CREATE · CREATE_ALL · REVOKE */
    kind: text('kind').notNull(),
    result: text('result').notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [unique('receipt_link_requests_uq').on(t.sellerId, t.requestId)],
)

// ── 요금 (N5, BILLING_RULES BL-0~BL-8, D-N5-01~D-N5-14) ─────────────────────
// 엔진 밖 서버 원장이다(BL-0 2). 이벤트·발송함·스냅샷·출력 작업 표는 바꾸지 않는다.
// 이용권(billing_grants)·회수(billing_revocations)·쓴 기록(billing_usage)·이용 방식(billing_modes)은 덧붙이기만 한다(BL-0 4, BL-INV-5 —
// 서버 소스에 이 표들의 UPDATE·DELETE가 없다). 결제 주문·증빙 요청은 상태 칸만 바뀐다.

/** 이용권 부여 (BL-1). 결제 이용권은 결제 ID마다 하나(BL-INV-1 — payment_id 유일). 부여 시각 = 기록 시각 */
export const billingGrants = pgTable(
  'billing_grants',
  {
    id: text('id').primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    /** FLAT_30D · DAYS · ORDERS · LABELS */
    kind: text('kind').notNull(),
    /** 정량만 1~100,000 (정액은 null) */
    quantity: integer('quantity'),
    /** PAYMENT · OPERATOR */
    source: text('source').notNull(),
    /** PAYMENT: 결제 ID */
    paymentId: text('payment_id'),
    /** OPERATOR: 사유 (휴대폰 번호 검사를 통과한 1~200자) */
    reason: text('reason'),
    at: timestamptz('at').notNull(),
  },
  (t) => [unique('billing_grants_payment_uq').on(t.paymentId), index('billing_grants_seller_idx').on(t.sellerId, t.at)],
)

/** 이용권 회수 (BL-7 환불). 이용권마다 많아야 하나. 지우거나 고치지 않는다 */
export const billingRevocations = pgTable(
  'billing_revocations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    grantId: text('grant_id')
      .notNull()
      .references(() => billingGrants.id),
    /** REFUND (지금은 이것 하나) */
    reason: text('reason').notNull(),
    at: timestamptz('at').notNull(),
  },
  (t) => [unique('billing_revocations_grant_uq').on(t.grantId), index('billing_revocations_seller_idx').on(t.sellerId)],
)

/**
 * 쓴 기록 (BL-5). 멱등 키: DAYS `DAYS:<방송 ID>` · ORDERS `ORDERS:<범위 날짜>:<상품 ID>` · LABELS `LABELS:<범위 날짜>:<작업 ID>`.
 * (판매자, 키)가 유일하다 — 같은 일은 한 번만 적는다. 돌려주지 않는다
 */
export const billingUsage = pgTable(
  'billing_usage',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    /** DAYS · ORDERS · LABELS */
    kind: text('kind').notNull(),
    key: text('key').notNull(),
    at: timestamptz('at').notNull(),
    /** 쓴 방송 (DAYS: 시작한 방송, ORDERS: 상품의 방송, LABELS: 라벨의 방송) */
    broadcastId: text('broadcast_id'),
    /** 범위 날짜 (실제 범위) */
    date: text('date'),
    /** ORDERS: 상품 ID·그때 번호 / LABELS: 라벨의 번호 */
    productId: text('product_id'),
    productNo: integer('product_no'),
    /** LABELS: 작업 ID */
    jobId: text('job_id'),
  },
  (t) => [unique('billing_usage_key_uq').on(t.sellerId, t.key), index('billing_usage_seller_idx').on(t.sellerId, t.kind, t.at)],
)

/** 방송의 이용 방식 (BL-4). 새 실제 방송 시작과 같은 트랜잭션에서 한 번 정하고 바뀌지 않는다. 이용 방식이 없는 방송(리허설·요금 기능 꺼짐·N5 전)은 행이 없다 */
export const billingModes = pgTable(
  'billing_modes',
  {
    /** 방송 ID — 방송 표를 외래 키로 잇지 않는다: 복구(I2)가 방송·범위 행을 지우고 다시 만들어도 이 원장 행은 남는다(덧붙이기만, BL-0 4) */
    broadcastId: text('broadcast_id').primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    /** 시작할 때의 범위 ID (기록용 — 복구가 범위를 다시 만들면 바뀌므로 그 범위의 방송은 방송 표의 범위로 찾는다) */
    scopeId: text('scope_id').notNull(),
    /** FLAT · DAY · ORDERS */
    mode: text('mode').notNull(),
    /** 이 시작이 방송 일 1을 썼는지 (BL-4 1.3) */
    usedDay: boolean('used_day').notNull(),
    at: timestamptz('at').notNull(),
  },
  (t) => [index('billing_modes_scope_idx').on(t.sellerId, t.scopeId)],
)

/**
 * 결제 주문 (BL-6). 결제 ID = 서버가 만든 무작위 값. 금액 = 만들 때의 요금 표 가격 스냅샷.
 * 상태: PENDING · FAILED · GRANTED · MISMATCH_CANCELLED · NEEDS_REVIEW · REFUNDED.
 * refund_hold_until = 환불 중 표시: 있으면 그 이용권을 쓰지 않는다(시간이 지나도 저절로 풀리지 않는다 — 결제 조회로 취소됐으면 환불함, 그대로면 풀기, RA-N5-01).
 * 값은 결제 취소를 맡은 환불 요청의 기한이고, 지나면 다른 요청(결제 내역·웹훅·다시 환불)이 결제 조회로 맞춘다
 */
export const billingOrders = pgTable(
  'billing_orders',
  {
    paymentId: text('payment_id').primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    requestId: text('request_id').notNull(),
    itemId: text('item_id').notNull(),
    itemName: text('item_name').notNull(),
    kind: text('kind').notNull(),
    quantity: integer('quantity'),
    amount: integer('amount').notNull(),
    /** CARD · TRANSFER (만들 때 고른 수단) */
    method: text('method').notNull(),
    state: text('state').notNull(),
    /** 결제 조회가 알려 준 수단 (부여 때) */
    paidMethod: text('paid_method'),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
    grantedAt: timestamptz('granted_at'),
    refundHoldUntil: timestamptz('refund_hold_until'),
    refundedAt: timestamptz('refunded_at'),
  },
  (t) => [unique('billing_orders_request_uq').on(t.sellerId, t.requestId), index('billing_orders_seller_idx').on(t.sellerId, t.createdAt)],
)

/** 사업자 정보 (BL-8 1·2). 번호·상호·대표자·이메일은 마스터 키로 암호화한 JSON 하나로 둔다. 가린 번호 `123-45-*****`와 증빙 종류만 평문 */
export const billingBusiness = pgTable('billing_business', {
  sellerId: text('seller_id')
    .primaryKey()
    .references(() => sellers.id),
  sealed: text('sealed').notNull(),
  masked: text('masked').notNull(),
  /** TAX_INVOICE · CASH_RECEIPT */
  receiptKind: text('receipt_kind').notNull(),
  updatedAt: timestamptz('updated_at').notNull(),
})

/** 증빙 요청 (BL-8 3~5): 계좌이체로 부여된 결제마다 하나. 받는 쪽은 그때의 사업자 정보(암호화). 취소 요청은 같은 줄의 cancel 칸 */
export const billingDocuments = pgTable(
  'billing_documents',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    paymentId: text('payment_id')
      .notNull()
      .references(() => billingOrders.paymentId),
    /** TAX_INVOICE · CASH_RECEIPT */
    kind: text('kind').notNull(),
    recipientSealed: text('recipient_sealed').notNull(),
    amount: integer('amount').notNull(),
    supply: integer('supply').notNull(),
    vat: integer('vat').notNull(),
    /** PENDING 발행 대기 · ISSUED 발행됨 · FAILED 발행 실패 */
    status: text('status').notNull(),
    approval: text('approval'),
    /** 취소: null · REQUESTED 취소 요청 · CANCELLED 취소됨 · FAILED */
    cancel: text('cancel'),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [unique('billing_documents_payment_uq').on(t.paymentId), index('billing_documents_seller_idx').on(t.sellerId)],
)

/** 요금 요청 번호 (환불·사업자 정보 — 같은 요청 번호면 처음 결과) */
export const billingRequests = pgTable(
  'billing_requests',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    requestId: text('request_id').notNull(),
    kind: text('kind').notNull(),
    result: text('result').notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [unique('billing_requests_uq').on(t.sellerId, t.requestId)],
)

// ── 입금 확인 (N3, DEPOSIT_RULES DP-1·DP-6, D-N3-05·D-N3-06·D-N3-09·D-N3-10) ─────────────
// 이벤트·발송함·스냅샷·출력 표는 바꾸지 않는다 — 입금 내역은 엔진 밖 이 표들에 둔다(DP-0 3). 모든 표에 판매자 ID가 있다(SYS-02).
// 계좌 비밀번호·빠른조회 아이디/비밀번호·생년월일을 두는 칸은 없다(받지 않는다, D-N3-09). 입금·처리 기록·원천을 지우는 API는 없다.

/**
 * 입금 원천 (DP-1): 계좌조회 POPBILL · 붙여넣기 PASTE(판매자마다 하나, 서버가 둔다) · 가짜 FAKE(시험 모드에서만).
 * 계좌조회의 사업자번호·은행·계좌번호는 account_enc에 서버 마스터 키로 암호화해 둔다(판매자·원천에 묶음 — 다른 행으로 옮기면 풀리지 않는다, D-073 방식)
 */
export const depositSources = pgTable(
  'deposit_sources',
  {
    id: text('id').primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    /** POPBILL · PASTE · FAKE */
    kind: text('kind').notNull(),
    /** 표시 이름 (예: "국민 1234", "붙여넣기") */
    label: text('label').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    /** 받아 오기 주기 (분, 1~5 — 계좌조회·가짜) */
    intervalMin: integer('interval_min').notNull().default(5),
    /** 계좌조회: 사업자번호·은행·계좌번호 JSON을 AES-256-GCM으로 암호화한 값 (그 밖의 원천은 null) */
    accountEnc: text('account_enc'),
    /** 마지막으로 받아 온 시각 (성공) */
    lastFetchedAt: timestamptz('last_fetched_at'),
    /** 마지막 오류 문장 (쉬운 한국어 한 문장 — 기술 상세 없음). 성공하면 지운다(읽지 못한 내역이 있으면 그 문장) */
    lastError: text('last_error'),
    lastErrorAt: timestamptz('last_error_at'),
    /** 마지막 받아 오기의 새 입금 수 */
    lastNew: integer('last_new'),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [index('deposit_sources_seller_idx').on(t.sellerId), uniqueIndex('deposit_sources_paste_uq').on(t.sellerId).where(sql`kind = 'PASTE'`)],
)

/**
 * 입금 (DP-1). 입금 번호 no는 판매자마다 1부터 이어서 센다(다시 켜도 같은 번호를 두 번 쓰지 않는다).
 * 같은 입금은 한 번: (판매자, 원천, 외부 키) 유일 제약(DP-INV-4). 외부 키 = 팝빌 tid · 붙여넣기 줄 키의 해시 · 시험이 준 키.
 * 상태: REVIEW 확인 필요 · AUTO_APPLIED 자동 확인됨 · APPLIED 확인함 · IGNORED 무시함 (DP-6).
 * 입금자명은 받은 글자 그대로(앞뒤 공백 뺌, 40자까지) — 이벤트 로그에는 넣지 않는다(DP-INV-5). 잔액·적요는 두지 않는다
 */
export const deposits = pgTable(
  'deposits',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    no: integer('no').notNull(),
    sourceId: text('source_id')
      .notNull()
      .references(() => depositSources.id),
    externalKey: text('external_key').notNull(),
    /** 거래 시각 (UTC — 분까지만 있으면 그 분의 0초) */
    at: timestamptz('at').notNull(),
    /** second · minute */
    precision: text('precision').notNull(),
    amount: integer('amount').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull(),
    /** 반영 차례 (엔진 요청 번호 dep-<번호>-pay-<차례>·dep-<번호>-rev-<차례>의 차례 — 반영할 때마다 1씩 는다) */
    turn: integer('turn').notNull().default(0),
    /** 지금 반영 중인 묶음 (자동 확인됨·확인함일 때만): 날짜·입금 기록의 구매자·그 범위 seq */
    appliedDate: text('applied_date'),
    appliedBuyer: text('applied_buyer'),
    appliedSeq: integer('applied_seq'),
    /** 저장한 시각 (서버 시계) */
    receivedAt: timestamptz('received_at').notNull(),
    /** 마지막 처리 시각 (자동 확인·확정·무시·다시 확인 필요로·되돌리기) */
    handledAt: timestamptz('handled_at'),
  },
  (t) => [
    unique('deposits_no_uq').on(t.sellerId, t.no),
    unique('deposits_external_uq').on(t.sellerId, t.sourceId, t.externalKey),
    index('deposits_status_idx').on(t.sellerId, t.status, t.no),
    index('deposits_at_idx').on(t.sellerId, t.at),
  ],
)

/** 입금과 엔진 기록의 연결 (범위, seq) — 입금 확인이 적은 입금 기록(payment)과 되돌림 기록(refund). 메모 글을 읽어 잇지 않는다(DP-0 3) */
export const depositLinks = pgTable(
  'deposit_links',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    depositId: bigint('deposit_id', { mode: 'number' })
      .notNull()
      .references(() => deposits.id),
    scopeId: text('scope_id')
      .notNull()
      .references(() => scopes.id),
    date: text('date').notNull(),
    seq: integer('seq').notNull(),
    /** payment · refund */
    kind: text('kind').notNull(),
    /** 반영 차례 (되돌림은 되돌린 반영의 차례) */
    turn: integer('turn').notNull(),
    /** 기록의 구매자 (구매자 자신) */
    buyer: text('buyer').notNull(),
    /** 자동 확인으로 적은 입금인지 */
    auto: boolean('auto').notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [unique('deposit_links_seq_uq').on(t.sellerId, t.scopeId, t.seq), index('deposit_links_deposit_idx').on(t.depositId)],
)

/** 입금 처리 기록 (DAT-05, DP-6): 받음·자동 확인·확정·무시·다시 확인 필요로·되돌리기마다 누가·언제·무엇을. 지우는 API가 없다 */
export const depositActions = pgTable(
  'deposit_actions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    depositId: bigint('deposit_id', { mode: 'number' })
      .notNull()
      .references(() => deposits.id),
    /** RECEIVED · AUTO · CONFIRM · IGNORE · REOPEN · REVERT */
    action: text('action').notNull(),
    /** account(로그인 계정) · auto(입금 자동 확인) · server(복구가 입금 상태를 다시 만든 엔진 기록에 맞춤) */
    actor: text('actor').notNull(),
    accountId: text('account_id').references(() => accounts.id),
    /** 묶음 날짜·구매자, 엔진 기록 범위·seq (해당할 때만) */
    date: text('date'),
    buyer: text('buyer'),
    scopeId: text('scope_id').references(() => scopes.id),
    seq: integer('seq'),
    /** 서버 시각 (UTC) */
    at: timestamptz('at').notNull(),
  },
  (t) => [index('deposit_actions_deposit_idx').on(t.depositId, t.id)],
)

/** 기억한 입금자명 (DP-4 3, DP-6, D-N3-03): 유튜브 구매자(채널)에만. 같은 (채널, 정규화 이름)은 한 번만. 판매자가 지울 수 있다 */
export const depositNames = pgTable(
  'deposit_names',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    channel: text('channel').notNull(),
    /** DP-3 정규화한 이름 */
    norm: text('norm').notNull(),
    /** 받은 글자 그대로 */
    name: text('name').notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [unique('deposit_names_uq').on(t.sellerId, t.channel, t.norm)],
)

/**
 * 판매자에게 묶인 팝빌 사업자번호 (RA-N3-001, DP-1 "비밀값", SYS-02). 서버는 연동 키 하나로 모든 판매자를 대신해 팝빌을 부르므로
 * 사업자번호가 그 판매자의 것인지 서버가 지킨다: 판매자마다 하나, 사업자번호마다 한 판매자. 평문은 두지 않는다 —
 * corp_key = HMAC(마스터 키에서 나눈 키, 사업자번호) (판매자 사이의 같은 값만 알아본다, 되돌릴 수 없다)
 */
export const depositCorpBindings = pgTable(
  'deposit_corp_bindings',
  {
    sellerId: text('seller_id')
      .primaryKey()
      .references(() => sellers.id),
    corpKey: text('corp_key').notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [unique('deposit_corp_bindings_corp_uq').on(t.corpKey)],
)

/** 입금 확인 화면 요청 번호 (붙여넣기 넣기·확정·무시·다시 확인 필요로·되돌리기·한꺼번에 — 같은 요청 번호면 처음 결과, DP-6) */
export const depositRequests = pgTable(
  'deposit_requests',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    requestId: text('request_id').notNull(),
    /** 처음 결과 JSON ({ status, body }) */
    result: text('result').notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [unique('deposit_requests_uq').on(t.sellerId, t.requestId)],
)

/**
 * 택배 배송지 (T1 PARCEL_RULES PC-3, D-T1-04·D-T1-07): 묶음(판매자, 실제 범위 날짜, 구매자 ID)마다 많아야 하나.
 * 여섯 칸(받는 분·연락처·주소·상세 주소·우편번호·배송 메모)은 하나로 묶어 서버 마스터 키로 AES-256-GCM 암호화한 값(sealed)만 둔다 —
 * 판매자·날짜·구매자 ID를 함께 묶어(AAD) 다른 행으로 옮기면 풀리지 않는다(D-073 방식). 따로 두는 것은 출처·확인 여부·확인한 계정·고친 시각·고친 계정뿐이다.
 * 고치면 덮어쓴다(이전 내용은 남기지 않는다). 날짜 + 30일의 0시(KST)에 지운다. 복구·가져오기는 그 판매자의 행을 모두 지운다(백업 파일에 없다)
 */
export const parcelAddresses = pgTable(
  'parcel_addresses',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    /** 묶음 날짜 YYYY-MM-DD (실제 범위) */
    date: text('date').notNull(),
    /** 지금의 구매자 ID */
    buyer: text('buyer').notNull(),
    /** 여섯 칸 JSON의 암호문 (`v1.iv.data.tag`) */
    sealed: text('sealed').notNull(),
    /** BUYER(구매자 링크) · SELLER(판매자 화면) */
    source: text('source').notNull(),
    /** 판매자가 확인했는지 (판매자가 적거나 고친 것은 그 자리에서 확인함) */
    confirmed: boolean('confirmed').notNull(),
    confirmedBy: text('confirmed_by').references(() => accounts.id),
    /** 고친 시각 (UTC) */
    updatedAt: timestamptz('updated_at').notNull(),
    /** 고친 계정 (구매자가 적었으면 null) */
    updatedBy: text('updated_by').references(() => accounts.id),
  },
  (t) => [unique('parcel_addresses_uq').on(t.sellerId, t.date, t.buyer), index('parcel_addresses_date_idx').on(t.date)],
)

/**
 * 택배 접수 시도 (T1 PC-5, D-T1-11): 묶음마다 덧붙여 가는 시도들. 한 묶음에 살아 있는(PENDING·UNKNOWN·BOOKED) 시도는 많아야 하나 — DB 고유 색인(parcels_live_uq, PC-INV-1).
 * request_key = 서버가 무작위로 만든 택배사 멱등 키(전화번호·이름을 담지 않는다). 택배사 원래 응답 글은 두지 않는다(사유는 ADDRESS·REJECTED·UNAVAILABLE 셋).
 * 배송지 원문이 없다. 복구·가져오기는 그대로 둔다(같은 묶음을 다시 접수하지 않게 — 복구한 포장 기록이 접수 전이어도 "이미 접수했어요"가 남는다)
 */
export const parcels = pgTable(
  'parcels',
  {
    id: text('id').primaryKey(),
    /** 적은 차례 (같은 시각에 적힌 시도도 차례가 정해진다 — 가장 나중 시도) */
    no: bigserial('no', { mode: 'number' }).notNull(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    date: text('date').notNull(),
    buyer: text('buyer').notNull(),
    /** FAKE(가짜 택배사 — 시험 모드) · EPOST · CJ · HANJIN · LOGEN · LOTTE (자동 접수 어댑터가 있는 택배사만 — OTHER는 오지 않는다, FB1 D-FB1-04) */
    carrier: text('carrier').notNull(),
    requestKey: text('request_key').notNull(),
    /** PENDING · UNKNOWN · BOOKED · FAILED · CANCELLED */
    state: text('state').notNull(),
    /** FAILED의 사유 ADDRESS · REJECTED, UNKNOWN이면 UNAVAILABLE */
    reason: text('reason'),
    /** 송장번호 (숫자 8~20자리, BOOKED·CANCELLED) */
    invoice: text('invoice'),
    /** 택배 크기 = 세 변의 합 코드 60·80·100·120·160 (FB1 D-FB1-05 — 옛 극소·소·중·대는 0019가 옮겼다) */
    box: text('box').notNull(),
    /** 물품 수 (그 묶음 품목 수량 합 — 접수할 때) */
    qty: integer('qty').notNull(),
    /** 조회 상태 ACCEPTED · PICKED_UP · IN_TRANSIT · DELIVERED (BOOKED 뒤) */
    track: text('track'),
    /** 마지막 확인 시각 */
    trackedAt: timestamptz('tracked_at'),
    createdAt: timestamptz('created_at').notNull(),
    createdBy: text('created_by').references(() => accounts.id),
    /** 상태를 바꾼 시각 (2분 넘은 PENDING은 UNKNOWN으로 본다) */
    updatedAt: timestamptz('updated_at').notNull(),
    bookedAt: timestamptz('booked_at'),
    cancelledAt: timestamptz('cancelled_at'),
    cancelledBy: text('cancelled_by').references(() => accounts.id),
  },
  (t) => [
    unique('parcels_request_key_uq').on(t.sellerId, t.requestKey),
    uniqueIndex('parcels_live_uq').on(t.sellerId, t.date, t.buyer).where(sql`state in ('PENDING', 'UNKNOWN', 'BOOKED')`),
    index('parcels_bundle_idx').on(t.sellerId, t.date, t.buyer, t.no),
    index('parcels_track_idx').on(t.state, t.bookedAt),
  ],
)

/**
 * 택배 화면 요청 번호 (T1 PC-5 "한 번에 접수"): 같은 화면 요청 번호면 택배사에 새로 보내지 않고 처음 결과를 돌려준다.
 * targets = 고른 구매자 ID 목록 JSON, result = 처음 결과 JSON(송장번호·이유만 — 배송지 원문 없음, 끝나기 전에는 null). 복구·가져오기는 지운다
 */
export const parcelRequests = pgTable(
  'parcel_requests',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    requestId: text('request_id').notNull(),
    date: text('date').notNull(),
    /** BOOK · CANCEL · ADDRESS · CONFIRM · DELETE */
    kind: text('kind').notNull(),
    targets: text('targets').notNull(),
    result: text('result'),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [unique('parcel_requests_uq').on(t.sellerId, t.requestId)],
)

/**
 * 설정 "택배" (T1 PC-6, D-T1-09): 택배사·택배사 고객 번호(암호화)·보내는 사람(PC-2 칸 — 메모 없음, 암호화)·기본 상자 크기. 판매자마다 한 줄.
 * 복구·가져오기는 그대로 둔다(판매자 설정 — 백업 파일에 없다)
 */
export const parcelSettings = pgTable('parcel_settings', {
  sellerId: text('seller_id')
    .primaryKey()
    .references(() => sellers.id),
  /** 쓰는 택배사 FAKE · EPOST · CJ · HANJIN · LOGEN · LOTTE · OTHER (고르지 않았으면 null — FB1 D-FB1-04) */
  carrier: text('carrier'),
  /** 직접 입력(OTHER) 택배사 이름 (다듬은 1~20자, 그 밖엔 null — FB1 D-FB1-04) */
  carrierName: text('carrier_name'),
  /** 택배사 고객 번호 암호문 (없으면 null) */
  customerEnc: text('customer_enc'),
  /** 보내는 사람 다섯 칸 JSON 암호문 (없으면 null) */
  senderEnc: text('sender_enc'),
  /** 기본 택배 크기 코드 (FB1 D-FB1-05) */
  box: text('box').notNull().default('80'),
  updatedAt: timestamptz('updated_at').notNull(),
})

/**
 * 크롬 확장 연결 코드 (X1 YT-10 AC4, D-X1-07): 판매자가 설정에서 받는 8자리 일회용 코드. 코드는 해시로만 둔다. 10분, 한 번만
 */
export const extCodes = pgTable(
  'ext_codes',
  {
    codeHash: text('code_hash').primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    accountId: text('account_id').notNull(),
    createdAt: timestamptz('created_at').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    usedAt: timestamptz('used_at'),
  },
  (t) => [index('ext_codes_seller_idx').on(t.sellerId)],
)

/**
 * 크롬 확장 토큰 (X1 YT-10 AC4, D-X1-08): 해시로만 둔다. 판매자마다 끊지 않은 토큰은 하나(부분 고유 색인).
 * 끊기·다시 만들기·30일 쓰지 않음으로 끊는다(revoked_reason: DISCONNECTED · RENEWED · IDLE)
 */
export const extTokens = pgTable(
  'ext_tokens',
  {
    id: text('id').primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamptz('created_at').notNull(),
    createdBy: text('created_by').notNull(),
    lastUsedAt: timestamptz('last_used_at').notNull(),
    revokedAt: timestamptz('revoked_at'),
    revokedReason: text('revoked_reason'),
  },
  (t) => [
    unique('ext_tokens_hash_uq').on(t.tokenHash),
    uniqueIndex('ext_tokens_active_uq')
      .on(t.sellerId)
      .where(sql`${t.revokedAt} is null`),
  ],
)

/**
 * 확장 채팅 ↔ 라이브찜 회차 (X1 YT-10 AC6, D-X1-10): 영상 ID로 자동(AUTO — YT-02 연결) 또는 팝업에서 고름(PICK).
 * 끊지 않은 것 중 영상 하나 = 회차 하나 (부분 고유 색인 둘)
 */
export const extBindings = pgTable(
  'ext_bindings',
  {
    id: text('id').primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    tokenId: text('token_id').notNull(),
    videoId: text('video_id').notNull(),
    broadcastId: text('broadcast_id').notNull(),
    how: text('how').notNull(),
    linkedAt: timestamptz('linked_at').notNull(),
    unboundAt: timestamptz('unbound_at'),
  },
  (t) => [
    uniqueIndex('ext_bindings_video_uq')
      .on(t.sellerId, t.videoId)
      .where(sql`${t.unboundAt} is null`),
    uniqueIndex('ext_bindings_broadcast_uq')
      .on(t.sellerId, t.broadcastId)
      .where(sql`${t.unboundAt} is null`),
  ],
)

/**
 * 확장 상태 (X1 YT-10 AC7, D-X1-11): 판매자마다 마지막 상태 하나 — 받은 시각, 탭이 뒤로 갔는지, 읽은·읽지 못한 수,
 * 읽지 못함만 이어진 첫 시각, 마지막으로 채팅을 받은 시각. 채팅 내용·닉네임은 없다
 */
export const extStatus = pgTable('ext_status', {
  sellerId: text('seller_id')
    .primaryKey()
    .references(() => sellers.id),
  tokenId: text('token_id').notNull(),
  videoId: text('video_id'),
  statusAt: timestamptz('status_at').notNull(),
  hidden: boolean('hidden').notNull(),
  readCount: integer('read_count').notNull(),
  unreadCount: integer('unread_count').notNull(),
  dropped: integer('dropped').notNull(),
  unreadSince: timestamptz('unread_since'),
  lastChatAt: timestamptz('last_chat_at'),
})

/**
 * 확장으로 감사 채팅 올리기 스위치 (X1 YT-10 AC11, D-X1-17·18): 판매자마다 하나. 기본 꺼짐(행 없음 또는 enabled_at null).
 * 켠 시각 이후에 생긴 감사만 확장에 맡긴다(다음 감사부터)
 */
export const extPostSettings = pgTable('ext_post_settings', {
  sellerId: text('seller_id')
    .primaryKey()
    .references(() => sellers.id),
  enabledAt: timestamptz('enabled_at'),
  enabledBy: text('enabled_by'),
  updatedAt: timestamptz('updated_at').notNull(),
})

/**
 * 확장 감사 올리기의 회차별 상태 (X1 YT-10 AC12·AC14·AC17, D-X1-20·21·24): 연달아 실패한 수·멈춘 시각, 로그인 계정이 방송 채널 주인이
 * 아니라고 본 시각, 확인한 주인 채널 ID(자기 글을 채팅 기록에서 뺀다), 마지막으로 맡긴·끝난 시각(글 사이 3초). 채팅 내용은 없다
 */
export const extPostLanes = pgTable(
  'ext_post_lanes',
  {
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    broadcastId: text('broadcast_id').notNull(),
    fails: integer('fails').notNull().default(0),
    pausedAt: timestamptz('paused_at'),
    ownerProblemAt: timestamptz('owner_problem_at'),
    ownerChannelId: text('owner_channel_id'),
    lastTakenAt: timestamptz('last_taken_at'),
    lastDoneAt: timestamptz('last_done_at'),
  },
  (t) => [unique('ext_post_lanes_uq').on(t.sellerId, t.broadcastId)],
)

// ── AI 확인 필요 제안 (A1, SPEC CMT-06, R-20 10, D-A1-03·D-A1-04·D-A1-06) ─────────────
// 제안은 판정이 아니다 — 이 표들은 엔진 이벤트와 상관없다. 댓글 원문·가린 글·요청·응답 본문은 어느 표에도 두지 않는다.

/** 판매자의 AI 제안 설정 (판매자마다 한 줄, 없으면 꺼짐). 켤 때마다 동의를 받고 그 시각을 둔다(끄면 지운다) */
export const assistSettings = pgTable('assist_settings', {
  sellerId: text('seller_id')
    .primaryKey()
    .references(() => sellers.id),
  enabled: boolean('enabled').notNull().default(false),
  /** 지금 켠 때의 동의 시각 (꺼져 있으면 null) */
  consentedAt: timestamptz('consented_at'),
  updatedAt: timestamptz('updated_at').notNull(),
})

/**
 * AI 제안 캐시 (D-A1-03): (판매자, 범위, 방송, 가린 글의 해시, 읽은 번호) → 제안 JSON 또는 null(제안 없음). 해시는 마스터 키에서 나눈 키의 HMAC-SHA256 —
 * 짧은 글이라도 DB만으로 되돌릴 수 없다. 읽은 번호가 없으면 0
 */
export const assistCache = pgTable(
  'assist_cache',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    /** 범위 날짜 YYYY-MM-DD */
    scopeDate: text('scope_date').notNull(),
    rehearsal: boolean('rehearsal').notNull(),
    broadcastId: text('broadcast_id').notNull(),
    textHash: text('text_hash').notNull(),
    no: integer('no').notNull(),
    /** 검사를 통과한 제안 { no, options?, qty } JSON, 제안 없음이면 null */
    suggestion: text('suggestion'),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [unique('assist_cache_uq').on(t.sellerId, t.scopeDate, t.rehearsal, t.broadcastId, t.textHash, t.no)],
)

/**
 * AI 호출 기록 (D-A1-04 — 보낸 요청 하나 = 한 줄, 실패 포함). 하루 상한은 이 표의 KST 날짜 줄 수로 센다.
 * 부르기 전에 넣고(ok = null) 끝나면 결과·토큰을 적는다. 토큰은 응답의 사용량 그대로(없으면 0)
 */
export const assistCalls = pgTable(
  'assist_calls',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    /** KST 날짜 YYYY-MM-DD */
    day: text('day').notNull(),
    /** 보낸 항목 수 */
    items: integer('items').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    /** 성공(모델이 답함) true · 실패 false · 진행 중 null */
    ok: boolean('ok'),
    /** 실패 코드 (HTTP·TIMEOUT·NETWORK) 또는 null */
    failure: text('failure'),
    createdAt: timestamptz('created_at').notNull(),
    finishedAt: timestamptz('finished_at'),
  },
  (t) => [index('assist_calls_day_idx').on(t.day, t.sellerId)],
)

// ── 손님 기록·메모 (CRM1, SPEC BUY-06·BUY-07, D-CRM1-05·D-CRM1-08) ─────────────
// 엔진 이벤트와 상관없다(판정·금액을 바꾸지 않는다). 백업 파일에 넣지 않고 복구·가져오기는 그대로 둔다(판매자 설정·메모 — RESTORE_KEPT_TABLES).

/** 설정 "손님 관리" (판매자마다 한 줄, 없으면 기본값 3번·100,000원·3일). 바꾼 기록은 남기지 않는다(마지막 값만) */
export const customerSettings = pgTable('customer_settings', {
  sellerId: text('seller_id')
    .primaryKey()
    .references(() => sellers.id),
  /** 단골 횟수 2~99 */
  regularCount: integer('regular_count').notNull(),
  /** 단골 금액 1,000~100,000,000원, null = 금액 기준 안 씀 */
  regularAmount: integer('regular_amount'),
  /** 입금 기다리는 날 1~30 */
  waitDays: integer('wait_days').notNull(),
  updatedAt: timestamptz('updated_at').notNull(),
})

/**
 * 손님 메모 (D-CRM1-08): 표지(채팅 구매자 키 `c:<키>` · 전화번호 키 `p:<키>`)마다 덧붙이기만 한다 — 화면엔 마지막 줄만(빈 글 = 지움).
 * 글은 서버 로그에 남기지 않는다
 */
export const customerMemos = pgTable(
  'customer_memos',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    marker: text('marker').notNull(),
    /** 다듬은 글 0~200글자 (빈 글 = 지움) */
    text: text('text').notNull(),
    accountId: text('account_id').references(() => accounts.id),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [index('customer_memos_marker_idx').on(t.sellerId, t.marker, t.id)],
)

/**
 * 손님 기록 보관 (D-CRM1-12, AC-CRM1-33): 30일 봉인 장부엔 끝난 찜·조치 사유가 없어, 봉인 전에 손님 기록용 숫자를 따로 남긴다.
 * 날짜 줄: 실제 날짜마다 한 줄 — 마지막으로 적은 범위 seq, 봉인을 본 뒤엔 frozen(그 뒤 차례·복구로 바꾸지 않는다).
 * 범위가 아니라 날짜로 잇는다(복구가 범위를 새 ID로 다시 만들어도 같다 — 범위를 참조하지 않아 RESTORE_KEPT_TABLES에 둔다).
 * 백업 파일·구매자에게 가는 것·로그에 넣지 않는다(D-CRM1-10)
 */
export const customerArchiveDays = pgTable(
  'customer_archive_days',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    /** 방송 날짜 (KST, YYYY-MM-DD) */
    date: text('date').notNull(),
    /** 이 seq까지 본 범위 상태로 적었다 */
    seq: integer('seq').notNull(),
    /** 봉인을 봤다 — 다시 쓰지도 지우지도 않는다 */
    frozen: boolean('frozen').notNull(),
    writtenAt: timestamptz('written_at').notNull(),
  },
  (t) => [unique('customer_archive_days_seller_date_uq').on(t.sellerId, t.date)],
)

/**
 * 손님 기록 보관 행 (D-CRM1-12): 그날 기록 묶음마다 한 행 — 묶음 뿌리 구매자 ID, 표지가 있는 구성원(구매자 ID·표지·그날 표시 이름·끝자리), 취소 수, '입금 안 함' 찜 수.
 * 품목·금액·입금은 적지 않는다(장부에 있다). 표지(전화번호 키)는 서버 안에서만
 */
export const customerArchiveRows = pgTable(
  'customer_archive_rows',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    date: text('date').notNull(),
    /** 그날 지금의 구매자 (묶음 뿌리) */
    root: text('root').notNull(),
    /** JSON 목록 [{ id, marker, display, phoneLast4 }] — 표지가 있는 구성원만 */
    members: text('members').notNull(),
    cancels: integer('cancels').notNull(),
    noPay: integer('no_pay').notNull(),
  },
  (t) => [index('customer_archive_rows_date_idx').on(t.sellerId, t.date)],
)

/**
 * 음성 등록·고침 기록 (V3 R-25, D-V3-65, AC-V3-70): 음성(화면이 기록 칸을 실어 보낸 상품 등록·고치기·번호 바꾸기·판매 종료)과
 * 일어난 일을 한 줄씩 남긴다(출처 voice — 판매자 채팅 읽기는 D-V3-68로 없앰). 판정 엔진 이벤트와 별개인 서버 기록이고, 같은 기록 트랜잭션에서 상품 명령(이벤트)보다 먼저 넣는다.
 * (판매자, 요청 번호, 한 일) 하나에 한 줄 — 같은 요청을 다시 보내도 늘지 않는다. 들은 말은 가린 한 줄(300글자까지, 제어 문자 없음)만.
 * 전·후 값은 JSON 객체 글({ no?, name?, price? }) 또는 null
 */
export const voiceLog = pgTable(
  'voice_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    /** 그 쓰기의 요청 번호 */
    requestId: text('request_id').notNull(),
    /** REGISTER · PRICE · NAME · RENUMBER · UNDO */
    kind: text('kind').notNull(),
    at: timestamptz('at').notNull(),
    /** 범위 날짜 (방송 날짜, KST) */
    date: text('date').notNull(),
    rehearsal: boolean('rehearsal').notNull(),
    broadcastId: text('broadcast_id').notNull(),
    /** 엔진 상품 ID (번호를 바꿔도 그대로). 등록이 실패해 상품이 없으면 null */
    productId: text('product_id'),
    /** 상품 번호 (옮기기·옮기기 되돌리기면 전 번호) */
    no: integer('no').notNull(),
    /** 옮긴 번호 (옮기기만) */
    toNo: integer('to_no'),
    before: text('before'),
    after: text('after'),
    /** voice (출처 칸은 다른 출처가 생길 때를 위해 둔다) */
    source: text('source').notNull(),
    /** account · server */
    actor: text('actor').notNull(),
    accountId: text('account_id'),
    /** 화면이 보낸 기기 표시 (없으면 null) */
    device: text('device'),
    /** 그때 그 상품의 살아 있는 찜 수 (확정·대기·보류·충돌) */
    claims: integer('claims').notNull(),
    /** 들은 말 (가린 한 줄) */
    heard: text('heard').notNull(),
    big: boolean('big').notNull(),
    withClaims: boolean('with_claims').notNull(),
    undone: boolean('undone').notNull().default(false),
    /** 되돌리기 줄이면 되돌린 쓰기의 요청 번호 */
    undoOf: text('undo_of'),
    /** 상품에 반영되지 않음 (명령이 거절·저장 실패로 기록되지 않았거나, 실패로 기록됐거나, 엔진이 바꾼 것이 없음) */
    failed: boolean('failed').notNull(),
  },
  (t) => [unique('voice_log_uq').on(t.sellerId, t.requestId, t.kind), index('voice_log_date_idx').on(t.sellerId, t.date, t.at), index('voice_log_broadcast_idx').on(t.sellerId, t.broadcastId, t.at)],
)

/** APP1b: 계정에 명시적으로 배운 품종 별칭만 둔다(인식 원문·세션은 저장하지 않음). */
export const voiceAliases = pgTable('voice_aliases', {
  sellerId: text('seller_id').primaryKey().references(() => sellers.id),
  aliases: text('aliases').notNull().default('[]'),
})

// KP1 손님 장부 (CUSTOMER_RULES CR-1~CR-6, 마이그레이션 0031). 모두 판매자 ID 조건으로만 읽는다. 백업 파일에 없고 복구·가져오기가 지우지 않는다(RESTORE_KEPT_TABLES).
/** 설정 "손님 관리"의 장부 칸 (판매자마다 한 줄, 없으면 12개월·손님 표시 켬) */
export const ledgerSettings = pgTable('ledger_settings', {
  sellerId: text('seller_id')
    .primaryKey()
    .references(() => sellers.id),
  /** 6 · 12 · 24 · 36 */
  months: integer('months').notNull(),
  /** null = 판매자가 아직 정하지 않음 (UX-KP1-006, 마이그레이션 0033) */
  consoleBadges: boolean('console_badges'),
  updatedAt: timestamptz('updated_at').notNull(),
})

/** 장부 줄 (CR-1): 연락처 다섯 칸 JSON의 암호문(판매자·줄 ID를 AAD로 묶음)·가장 최근 동의 묶음 날짜·그 문구 개월. 이전 연락처는 남기지 않는다 */
export const ledgerLines = pgTable(
  'ledger_lines',
  {
    id: text('id').primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    contactEnc: text('contact_enc').notNull(),
    consentDate: text('consent_date').notNull(),
    consentMonths: integer('consent_months').notNull(),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [index('ledger_lines_seller_idx').on(t.sellerId)],
)

/** 장부 줄의 표지 (한 표지는 한 줄에만 — CR-1). 표지는 서버 안에서만 쓴다. CODE로 이은 표지는 화면 이름표(플랫폼·이름·끝 4자리)를 함께 둔다 */
export const ledgerMarkers = pgTable(
  'ledger_markers',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    marker: text('marker').notNull(),
    lineId: text('line_id')
      .notNull()
      .references(() => ledgerLines.id),
    /** CONSENT · CODE */
    source: text('source').notNull(),
    labelPlatform: text('label_platform'),
    labelName: text('label_name'),
    labelLast4: text('label_last4'),
    linkedAt: timestamptz('linked_at').notNull(),
  },
  (t) => [unique('ledger_markers_uq').on(t.sellerId, t.marker), index('ledger_markers_line_idx').on(t.sellerId, t.lineId)],
)

/** 동의 기록 (CR-2 — 덧붙이기만, 줄을 지워도 남는다). 연락처·표지·토큰·구매자 ID가 없다 */
export const ledgerConsents = pgTable(
  'ledger_consents',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    /** 줄 ID (외래 키 없음 — 줄이 지워져도 남는다) */
    lineId: text('line_id').notNull(),
    /** AGREE · WITHDRAW · EXPIRE · SELLER_DELETE */
    type: text('type').notNull(),
    items: text('items').notNull(),
    wording: text('wording').notNull(),
    months: integer('months').notNull(),
    /** RECEIPT_LINK 또는 null */
    route: text('route'),
    orderDate: text('order_date'),
    /** '표지 옮김' · '기간 지남' · '줄 합침' */
    reason: text('reason'),
    /** SELLER_DELETE를 한 계정 */
    accountId: text('account_id').references(() => accounts.id),
    at: timestamptz('at').notNull(),
  },
  (t) => [index('ledger_consents_line_idx').on(t.sellerId, t.lineId, t.id)],
)

/** 연결 코드 (CR-5): 줄마다 살아 있는 것 많아야 하나, 판매자 안에서 살아 있는 코드 글은 겹치지 않는다. 코드 글은 로그에 남기지 않는다 */
export const ledgerCodes = pgTable(
  'ledger_codes',
  {
    id: text('id').primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    lineId: text('line_id')
      .notNull()
      .references(() => ledgerLines.id),
    code: text('code').notNull(),
    createdAt: timestamptz('created_at').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    /** LIVE · CLAIMED · DONE */
    state: text('state').notNull(),
    claimedMarker: text('claimed_marker'),
    claimedPlatform: text('claimed_platform'),
    claimedName: text('claimed_name'),
    claimedLast4: text('claimed_last4'),
    claimedAt: timestamptz('claimed_at'),
  },
  (t) => [
    uniqueIndex('ledger_codes_live_uq').on(t.sellerId, t.code).where(sql`state = 'LIVE'`),
    uniqueIndex('ledger_codes_line_uq').on(t.sellerId, t.lineId).where(sql`state <> 'DONE'`),
  ],
)

/** 손님 엑셀 받은 기록 (CR-6 — 누가·언제·연락처 열을 넣었는지만, 파일 내용 없음) */
export const customerExports = pgTable(
  'customer_exports',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    contact: boolean('contact').notNull(),
    at: timestamptz('at').notNull(),
  },
  (t) => [index('customer_exports_seller_idx').on(t.sellerId, t.id)],
)

// KP1 일정 (SPEC SCH-01~SCH-03, MESSAGE_RULES MR-6, 마이그레이션 0032). 모두 판매자 ID 조건으로만 읽는다. 백업 파일에 없고 복구·가져오기가 지우지 않는다(RESTORE_KEPT_TABLES).
/**
 * 공개 일정 페이지 (SCH-02): 판매자마다 한 줄. 토큰은 SHA-256 base64url(token_hash)로 찾고, 판매자 화면 주소용 원문은 판매자·용도로 묶은 암호문(token_enc)만.
 * 끄거나 다시 만들면 토큰 칸을 바꾼다(옛 주소 404)
 */
export const schedulePages = pgTable(
  'schedule_pages',
  {
    sellerId: text('seller_id')
      .primaryKey()
      .references(() => sellers.id),
    enabled: boolean('enabled').notNull(),
    tokenHash: text('token_hash'),
    tokenEnc: text('token_enc'),
    /** 유튜브 채널 주소 (없으면 null) */
    channelUrl: text('channel_url'),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [unique('schedule_pages_token_uq').on(t.tokenHash)],
)

/** 방송 일정 (SCH-01): 시작 시각(UTC)·제목·소개. 개인정보 없음. 지난 일정은 정리 작업이 지운다 */
export const scheduleItems = pgTable(
  'schedule_items',
  {
    id: text('id').primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    startsAt: timestamptz('starts_at').notNull(),
    title: text('title').notNull(),
    intro: text('intro').notNull(),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [index('schedule_items_seller_starts_idx').on(t.sellerId, t.startsAt)],
)

/**
 * 방송 알림 신청 번호 (MR-6): 판매자 안에서 번호마다 한 줄. 원문은 판매자·용도로 묶은 암호문, 찾기는 전화번호 키.
 * 그만 받기·기한 지남이면 두 칸을 바로 null로(줄과 동의 기록은 번호 없이 남는다)
 */
export const alertSubscribers = pgTable(
  'alert_subscribers',
  {
    id: text('id').primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    phoneKey: text('phone_key'),
    phoneEnc: text('phone_enc'),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [uniqueIndex('alert_subscribers_phone_uq').on(t.sellerId, t.phoneKey).where(sql`phone_key IS NOT NULL`)],
)

/** 방송 알림 수신 동의 기록 (MR-6): 덧붙이기만. AGREE · VERIFY · WITHDRAW · NOTICE. 번호 없음 */
export const alertConsents = pgTable(
  'alert_consents',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sellerId: text('seller_id')
      .notNull()
      .references(() => sellers.id),
    subscriberId: text('subscriber_id')
      .notNull()
      .references(() => alertSubscribers.id),
    type: text('type').notNull(),
    /** 'MR-CONSENT-1' (AGREE만) */
    wording: text('wording'),
    /** 'SCHEDULE_PAGE' (AGREE만) */
    route: text('route'),
    at: timestamptz('at').notNull(),
  },
  (t) => [index('alert_consents_subscriber_idx').on(t.sellerId, t.subscriberId, t.id)],
)

export const schema = {
  voiceAliases,
  sellers,
  accounts,
  loginLimits,
  sessions,
  loginLinks,
  loginStates,
  scopes,
  broadcasts,
  events,
  outbox,
  snapshots,
  chatRaw,
  youtubeConnections,
  youtubeOauthStates,
  youtubeLinks,
  youtubeCollectors,
  youtubeOwnMessages,
  youtubeNotices,
  youtubeQuota,
  printQueues,
  printLabels,
  printJobs,
  printAttempts,
  labelTemplates,
  printRequests,
  igConnections,
  igOauthStates,
  liveLinks,
  liveLinkMoves,
  liveUnlinked,
  liveRequests,
  igDmSends,
  igDmRows,
  tiktokLinks,
  tiktokConsents,
  tiktokAccounts,
  pasteRequests,
  bandAccounts,
  bandOauthStates,
  bandLinks,
  bandSeen,
  bandNotices,
  labelSwitches,
  packingRecords,
  billingGrants,
  billingRevocations,
  billingUsage,
  billingModes,
  billingOrders,
  billingBusiness,
  billingDocuments,
  billingRequests,
  receiptLinks,
  receiptLinkRequests,
  depositSources,
  deposits,
  depositLinks,
  depositActions,
  depositNames,
  depositCorpBindings,
  depositRequests,
  parcelAddresses,
  parcels,
  parcelRequests,
  parcelSettings,
  extCodes,
  extTokens,
  extBindings,
  extStatus,
  extPostSettings,
  extPostLanes,
  assistSettings,
  assistCache,
  assistCalls,
  customerSettings,
  customerMemos,
  customerArchiveDays,
  customerArchiveRows,
  voiceLog,
  // KP1 손님 장부
  ledgerSettings,
  ledgerLines,
  ledgerMarkers,
  ledgerConsents,
  ledgerCodes,
  customerExports,
  // KP1 일정
  schedulePages,
  scheduleItems,
  alertSubscribers,
  alertConsents,
}

/**
 * 발송함 실행 대상 조건 (R-13, D-081, D-I2-11 — RA-I2-001): 실제 범위의 행이고 복구·가져오기가 다시 만든 행이 아니다.
 * 발송함 행을 골라 실행하는 질의(라벨 출력·감사 메시지 게시 등 실행기)는 모두 이 조건을 건다 —
 * test/i2-restore-contract.test.ts가 apps/server/src의 발송함 질의를 훑어 rehearsal 조건을 거는 곳이 restored 조건도 거는지 확인한다
 */
export const executableOutbox = and(eq(outbox.rehearsal, false), eq(outbox.restored, false)) as SQL

/** 요금 직렬 처리용 어드바이저리 락 키 (판매자마다 하나 — 새 실제 방송 시작·환불·부여·결제 확인·쓰기를 차례로, BL-4 3·BL-7 4) */
export const billingLockKey = (sellerId: string) => sql`hashtextextended(${`billing/${sellerId}`}, 0)`

/** 범위 직렬 처리용 어드바이저리 락 키 (범위 = 판매자·날짜·리허설인지, 범위 행이 생기기 전에도 같은 키). 실제 범위는 S04와 같은 키 */
export const scopeLockKey = (sellerId: string, date: string, rehearsal: boolean) =>
  sql`hashtextextended(${rehearsal ? `${sellerId}/${date}/rehearsal` : `${sellerId}/${date}`}, 0)`

/** 판매자 입금 처리 직렬화용 어드바이저리 락 키 (입금 저장·번호 붙이기 — 여러 인스턴스에서도 번호가 겹치지 않게, DP-7) */
export const depositLockKey = (sellerId: string) => sql`hashtextextended(${`${sellerId}/deposits`}, 0)`
