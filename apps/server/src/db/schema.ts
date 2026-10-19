// 데이터베이스 스키마 (AC-S04-20, D-069, D-072, D-073, D-074). 마이그레이션 SQL은 apps/server/drizzle/에 있다.
// - 판매자 데이터가 들어가는 모든 테이블에 판매자 ID(seller_id)가 있다(SYS-02). 판매자 테이블은 id가 판매자 ID다.
// - 이벤트 기록은 덧붙이기만 한다(고치거나 지우지 않는다, D-072). 엔진 이벤트는 JSON 문자열(body)로 둔다:
//   jsonb는 NUL 문자·짝 없는 서로게이트가 든 채팅 본문을 받지 않는데, JSON.stringify 결과 문자열은 그것들을 이스케이프한다.
// - 시각은 UTC(timestamptz, 엔진 at은 UTC 밀리초)로 둔다(NFR-07).
// - 전화번호 원문·정규화한 번호는 어디에도 두지 않는다. 판매자 전화번호 키는 마스터 키로 암호화한 값만 둔다(D-073).
// - 이 파일과 마이그레이션이 어긋나지 않는지는 test/schema.test.ts가 실제 DB 구조와 대조한다.
import { sql } from 'drizzle-orm'
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
  },
  (t) => [index('sessions_account_idx').on(t.accountId), index('sessions_seller_idx').on(t.sellerId)],
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

/** 방송 목록 (방송 ID → 범위). broadcast.start·broadcast.end 이벤트와 같은 트랜잭션에서 쓴다 */
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
    /** 조치자 종류: account(로그인 계정) · server(서버) · collector(채팅 수집기) (DAT-05 "누가") */
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
    /** 이을 때 연결돼 있던 채널 */
    channelId: text('channel_id').notNull(),
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

export const schema = {
  sellers,
  accounts,
  loginLimits,
  sessions,
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
}

/** 범위 직렬 처리용 어드바이저리 락 키 (범위 = 판매자·날짜·리허설인지, 범위 행이 생기기 전에도 같은 키). 실제 범위는 S04와 같은 키 */
export const scopeLockKey = (sellerId: string, date: string, rehearsal: boolean) =>
  sql`hashtextextended(${rehearsal ? `${sellerId}/${date}/rehearsal` : `${sellerId}/${date}`}, 0)`
