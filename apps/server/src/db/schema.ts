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
})

/** 로그인 계정 (D-074). 비밀번호는 scrypt 해시만 둔다. 연속 실패·잠금은 login_limits에 둔다 */
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
    /** 기록 손상 확인용 요약값: SHA-256(범위·seq·종류·본문·실패 표시) (재생 검사 명령이 대조한다) */
    digest: text('digest').notNull(),
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
  },
  (t) => [unique('outbox_effect_uq').on(t.sellerId, t.scopeId, t.effectId), index('outbox_scope_seq_idx').on(t.scopeId, t.seq)],
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
})

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
 * 회차마다 끊지 않은 연결(WAITING·LINKED)은 하나뿐이다(부분 유일 인덱스). 잇기는 엔진 이벤트가 아니다 — 누가·언제는 여기 남는다(DAT-05)
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
    uniqueIndex('live_links_open_uq').on(t.sellerId, t.broadcastId).where(sql`state <> 'UNLINKED'`),
    index('live_links_broadcast_idx').on(t.sellerId, t.broadcastId),
    index('live_links_live_idx').on(t.sellerId, t.liveId),
  ],
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
  printQueues,
  printLabels,
  printJobs,
  printAttempts,
  labelTemplates,
  printRequests,
  igConnections,
  igOauthStates,
  liveLinks,
  liveUnlinked,
  liveRequests,
  igDmSends,
  igDmRows,
}

/** 범위 직렬 처리용 어드바이저리 락 키 (범위 = 판매자·날짜·리허설인지, 범위 행이 생기기 전에도 같은 키). 실제 범위는 S04와 같은 키 */
export const scopeLockKey = (sellerId: string, date: string, rehearsal: boolean) =>
  sql`hashtextextended(${rehearsal ? `${sellerId}/${date}/rehearsal` : `${sellerId}/${date}`}, 0)`
