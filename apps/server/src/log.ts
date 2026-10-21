// 서버 로그 (D-073, AC-S04-34, RA-S00-004).
// 로그에는 정해진 코드와 범위·seq·오류 종류만 남긴다. 요청 본문·전화번호·키·메모·닉네임·채팅 본문·제목·사유·아이디·비밀번호·
// 세션 값·비밀 키·오류 메시지(값이 들어 있을 수 있다)는 남기지 않는다. 그래서 기록 함수는 자유 문장을 받지 않는다.

/** alert = 운영자가 할 일이 있는 경보 (AC-I3-82) — JSON 한 줄로 쓴다 */
export type LogLevel = 'info' | 'warn' | 'error' | 'alert'

/** 로그 한 줄. 값은 모두 서버가 정한 것(코드·범위 날짜·seq·오류 종류 이름)이다 */
export interface LogRecord {
  readonly level: LogLevel
  /** 무슨 일인지 (정해진 코드) */
  readonly code: LogCode
  /** 범위 날짜 YYYY-MM-DD */
  readonly date?: string
  readonly seq?: number
  /** 오류 종류 (생성자 이름만, 메시지 없음) */
  readonly errorKind?: string
  /** 개수 같은 숫자 */
  readonly count?: number
  /** 판매자 ID (유튜브 워커·판매자 백업 경보 — 판매자 ID는 서버가 만든 값이다. 판매자 이름·구매자 정보가 아니다) */
  readonly seller?: string
  /** HTTP 상태 (유튜브 오류) */
  readonly status?: number
  /** 구글 오류 이유 코드 (quotaExceeded 같은 영문 코드만 — 형식이 다르면 남기지 않는다) */
  readonly reason?: string
  /** 워커 이름 (경보 WORKER_FAILING — collector · outbox · sealer) */
  readonly worker?: 'collector' | 'outbox' | 'sealer'
  /** 같은 코드를 횟수 제한으로 남기지 않은 수 (틱톡 연결 객체 — 그 코드를 다음에 남길 때 함께, D-N2b-2-11 (마)) */
  readonly suppressed?: number
}

export type LogCode =
  | 'ENGINE_FAILED'
  | 'REPLAY_SKIPPED'
  | 'SAVE_FAILED'
  | 'SNAPSHOT_FAILED'
  | 'SNAPSHOT_UNUSABLE'
  | 'REQUEST_FAILED'
  | 'STATE_FORMAT'
  | 'STREAM_FAILED'
  | 'LOGIN_PRUNE_FAILED'
  | 'DRAFT_SKIPPED'
  // Y1 유튜브 (AC-Y1-70): 종류·HTTP 상태·구글 오류 이유·판매자·범위만 남긴다
  | 'YOUTUBE_CONNECT_FAILED'
  | 'YOUTUBE_REFRESH_FAILED'
  | 'YOUTUBE_RECONNECT_NEEDED'
  | 'YOUTUBE_REVOKE_FAILED'
  | 'YOUTUBE_API_FAILED'
  | 'COLLECTOR_ERROR'
  | 'COLLECTOR_STOPPED'
  | 'COLLECTOR_SAVE_FAILED'
  | 'OUTBOX_POST_FAILED'
  | 'OUTBOX_REPORT_FAILED'
  | 'OUTBOX_UNCONFIRMED'
  | 'OUTBOX_ERROR'
  | 'SEAL_FAILED'
  | 'SEALED'
  | 'WORKER_FAILED'
  // I3 운영 (AC-I3-82): 다시 시도를 다 쓴 감사, 구글 할당량 초과, 경보 코드
  | 'OUTBOX_GAVE_UP'
  | 'QUOTA_EXCEEDED'
  | 'WORKER_FAILING'
  | 'BACKUP_FAILED'
  | 'DB_UNAVAILABLE'
  | 'PRINT_NOTIFY_FAILED'
  | 'IG_META_FAILED'
  | 'IG_TOKEN_UNREADABLE'
  | 'IG_COMMENT_SKIPPED'
  | 'IG_DM_FAILED'
  | 'IG_REPORT_FAILED'
  // 틱톡 연결 모듈 (N2b-1, D-N2b-1-08): 정해진 코드·실패 종류·개수만. 댓글·닉네임·아이디·판매자 틱톡 아이디·오류 메시지·서명 키는 남기지 않는다
  | 'TIKTOK_BETA_INVALID'
  | 'TIKTOK_CONNECT_FAILED'
  | 'TIKTOK_DISCONNECTED'
  | 'TIKTOK_GAVE_UP'
  | 'TIKTOK_CONSENT_FAILED'
  | 'TIKTOK_LIBRARY_ERROR'
  | 'TIKTOK_LATE_CLOSED'
  | 'TIKTOK_RECORD_FAILED'
  | 'TIKTOK_STATUS_FAILED'
  | 'TIKTOK_EVENT_FAILED'
  | 'DOCUMENT_MISMATCH'
  | 'LABEL_INVALID'
  | 'BACKUP_DISABLED'
  | 'BACKUP_PRUNE_FAILED'
  | 'DOCUMENT_WORK_FAILED'
  // 틱톡 N2b-2 (D-N2b-2-05·06·11): 멈춘 연결, 라이브러리 환경 변수(변수 이름만 reason에), 댓글 기록 실패·기록하지 않음
  | 'TIKTOK_STALLED'
  | 'TIKTOK_LIBRARY_ENV'
  | 'TIKTOK_SAVE_FAILED'
  | 'TIKTOK_SKIPPED'
  | 'TIKTOK_RESUME_FAILED'
  // 인스타그램 설정 주소가 https가 아님 (D-N2b-2-10)
  | 'INSTAGRAM_CONFIG_INSECURE'
  | 'DEPOSIT_FETCH_FAILED'
  | 'DEPOSIT_SAVE_FAILED'
  | 'DEPOSIT_ROW_SAVE_RETRY'
  | 'DEPOSIT_ROW_SAVE_FAILED'
  | 'DEPOSIT_APPLY_FAILED'
  | 'DEPOSIT_NOTIFY_FAILED'

export type LogSink = (record: LogRecord) => void

const MESSAGES: Readonly<Record<LogCode, string>> = {
  ENGINE_FAILED: '엔진이 처리하지 못한 입력을 실패로 표시하고 건너뛰었어요',
  REPLAY_SKIPPED: '다시 불러오는 중 처리하지 못한 입력을 건너뛰었어요',
  SAVE_FAILED: '저장하지 못했어요',
  SNAPSHOT_FAILED: '스냅샷을 저장하지 못했어요(기록은 저장됨)',
  SNAPSHOT_UNUSABLE: '저장된 스냅샷을 쓸 수 없어 처음부터 다시 불러왔어요',
  REQUEST_FAILED: '요청 처리 중 오류가 생겼어요',
  STATE_FORMAT: '상태 형식이 달라 다시 불러와요',
  STREAM_FAILED: '실시간 연결에 보내지 못했어요',
  LOGIN_PRUNE_FAILED: '로그인 시도 기록을 정리하지 못했어요(로그인은 계속함)',
  DRAFT_SKIPPED: '서버가 덧붙이는 입력(차단 이어받기)이 입력 검사를 통과하지 못해 기록하지 않았어요',
  YOUTUBE_CONNECT_FAILED: '유튜브 연결을 마치지 못했어요',
  YOUTUBE_REFRESH_FAILED: '유튜브 접근 토큰을 새로 고치지 못했어요',
  YOUTUBE_RECONNECT_NEEDED: '유튜브 연결을 다시 해야 해요',
  YOUTUBE_REVOKE_FAILED: '구글에 토큰 폐기를 요청하지 못했어요(연결은 끊음)',
  YOUTUBE_API_FAILED: '유튜브 호출이 실패했어요',
  COLLECTOR_ERROR: '채팅 수집 중 오류가 생겨 다시 연결해요',
  COLLECTOR_STOPPED: '채팅 수집을 멈췄어요',
  COLLECTOR_SAVE_FAILED: '받은 채팅을 저장하지 못해 이어받기 지점을 남기지 않았어요',
  OUTBOX_POST_FAILED: '감사 메시지를 게시하지 못했어요',
  OUTBOX_REPORT_FAILED: '게시 보고를 기록하지 못해 다시 할게요(다시 게시하지 않음)',
  OUTBOX_UNCONFIRMED: '감사가 올라갔는지 확인하지 못해 다시 게시하지 않았어요',
  OUTBOX_ERROR: '발송함 처리 중 오류가 생겼어요',
  SEAL_FAILED: '30일 지난 범위를 봉인하지 못해 다음에 다시 해요',
  SEALED: '30일 지난 범위를 봉인했어요',
  WORKER_FAILED: '유튜브 작업 중 오류가 생겼어요',
  OUTBOX_GAVE_UP: '감사 메시지를 여러 번 보내지 못해 그만두었어요',
  QUOTA_EXCEEDED: '구글이 유튜브 할당량 초과를 알렸어요',
  WORKER_FAILING: '워커가 연속으로 실패하고 있어요',
  BACKUP_FAILED: '백업하지 못했어요(운영 백업 명령은 종료 코드 1 · 판매자 자동 백업은 다음 확인 때 다시 해요)',
  DB_UNAVAILABLE: '데이터베이스에 닿지 않아요',
  PRINT_NOTIFY_FAILED: '출력 기록 알림을 보내지 못했어요(기록은 저장됨)',
  IG_META_FAILED: '인스타그램(메타) 요청이 실패했어요',
  IG_TOKEN_UNREADABLE: '인스타그램 토큰을 풀지 못해 연결을 다시 연결 필요로 바꿨어요',
  IG_COMMENT_SKIPPED: '형식이 틀린 인스타그램 댓글을 기록하지 않고 셌어요',
  IG_DM_FAILED: '인스타그램 DM 실행기에서 오류가 생겼어요(다음에 다시 해요)',
  IG_REPORT_FAILED: '인스타그램 DM 게시 보고를 기록하지 못했어요(다음에 다시 해요)',
  TIKTOK_BETA_INVALID: '틱톡 베타 스위치 값을 알아볼 수 없어 끔으로 봤어요',
  TIKTOK_CONNECT_FAILED: '틱톡 연결 시도가 실패했어요',
  TIKTOK_DISCONNECTED: '받던 틱톡 연결이 끊겼어요',
  TIKTOK_GAVE_UP: '틱톡 다시 연결을 멈췄어요',
  TIKTOK_CONSENT_FAILED: '틱톡 사용 동의를 확인하지 못해 끔으로 봤어요',
  TIKTOK_LIBRARY_ERROR: '틱톡 연결기가 오류를 알렸어요(연결은 그대로)',
  TIKTOK_LATE_CLOSED: '버린 틱톡 연결 시도가 늦게 이어져 바로 닫았어요',
  TIKTOK_RECORD_FAILED: '틱톡 댓글을 받는 쪽에서 오류가 났어요(연결은 계속함)',
  TIKTOK_STATUS_FAILED: '틱톡 연결 상태를 받는 쪽에서 오류가 났어요(연결은 계속함)',
  TIKTOK_EVENT_FAILED: '틱톡 이벤트를 처리하지 못해 건너뛰었어요(연결은 계속함)',
  DOCUMENT_MISMATCH: '확인서 금액이 정산 금액과 맞지 않아 문서를 만들지 않았어요',
  LABEL_INVALID: '포장 라벨 데이터가 형식 검사를 통과하지 못해 라벨을 만들지 않았어요',
  BACKUP_DISABLED: '백업 저장소가 정해지지 않아 자동 백업이 꺼져 있어요',
  BACKUP_PRUNE_FAILED: '오래된 백업을 지우지 못했어요(다음 확인 때 다시 해요)',
  DOCUMENT_WORK_FAILED: '파일 작업 워커가 일을 끝내지 못했어요(시간·메모리 상한·끊긴 요청 등 — 서버 판정은 그대로)',
  TIKTOK_STALLED: '받던 틱톡 연결에서 2분 동안 아무 자료가 오지 않아 끊긴 것으로 보고 다시 연결해요',
  TIKTOK_LIBRARY_ENV: '틱톡 연결기가 스스로 읽는 환경 변수가 있어 틱톡 베타를 끈 것으로 봤어요(그 변수를 지워 주세요)',
  TIKTOK_SAVE_FAILED: '틱톡 댓글을 기록하지 못했어요(연결은 계속함)',
  TIKTOK_SKIPPED: '틱톡 댓글이 입력 검사를 통과하지 못해 기록하지 않았어요(수만 셈)',
  TIKTOK_RESUME_FAILED: '서버를 다시 켠 뒤 틱톡 연결을 이어받지 못했어요',
  INSTAGRAM_CONFIG_INSECURE: '인스타그램 주소 설정이 https가 아니라 인스타그램 연동을 끈 것으로 봤어요',
  DEPOSIT_FETCH_FAILED: '입금 원천에서 받아 오지 못했어요(다음 주기에 다시 함)',
  DEPOSIT_SAVE_FAILED: '받은 입금을 저장하지 못했어요(다음 주기에 다시 함)',
  DEPOSIT_ROW_SAVE_RETRY: '받은 입금을 한 번에 저장하지 못해 한 줄씩 다시 저장해요',
  DEPOSIT_ROW_SAVE_FAILED: '받은 입금 한 줄을 저장하지 못해 그 줄만 건너뛰었어요',
  DEPOSIT_APPLY_FAILED: '입금 자동 확인을 적지 못해 확인 필요로 남겼어요',
  DEPOSIT_NOTIFY_FAILED: '입금 확인 알림을 보내지 못했어요(기록은 저장됨)',
}

/** 오류 종류 이름만 꺼낸다 (메시지·스택은 버린다) */
export function errorKind(error: unknown): string {
  if (error instanceof Error) return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name) ? error.name : 'Error'
  return typeof error
}

/** 한 줄 문장으로 만든다: `[server] <설명> (code=… date=… seq=… kind=…)` */
export function formatLog(record: LogRecord): string {
  const parts = [`code=${record.code}`]
  if (record.date !== undefined) parts.push(`date=${record.date}`)
  if (record.seq !== undefined) parts.push(`seq=${String(record.seq)}`)
  if (record.count !== undefined) parts.push(`count=${String(record.count)}`)
  if (record.suppressed !== undefined) parts.push(`suppressed=${String(record.suppressed)}`)
  if (record.seller !== undefined && /^[A-Za-z0-9_-]{1,80}$/.test(record.seller)) parts.push(`seller=${record.seller}`)
  if (record.status !== undefined) parts.push(`status=${String(record.status)}`)
  if (record.reason !== undefined && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(record.reason)) parts.push(`reason=${record.reason}`)
  if (record.errorKind !== undefined) parts.push(`kind=${record.errorKind}`)
  return `[server] ${MESSAGES[record.code]} (${parts.join(' ')})`
}

const SELLER_RE = /^[A-Za-z0-9_-]{1,80}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const WORKERS = new Set(['collector', 'outbox', 'sealer'])

/**
 * 경보 한 줄 (AC-I3-82): `{"level":"alert","code":…,"count":…,"seller"?,"date"?,"worker"?}` — 정해진 코드·셈·서버가 만든 판매자 ID·범위 날짜·워커 이름만.
 * 모양이 다른 값은 넣지 않는다
 */
export function formatAlert(record: LogRecord): string {
  const out: Record<string, unknown> = { level: 'alert', code: record.code, count: record.count ?? 1 }
  if (record.seller !== undefined && SELLER_RE.test(record.seller)) out.seller = record.seller
  if (record.date !== undefined && DATE_RE.test(record.date)) out.date = record.date
  if (record.worker !== undefined && WORKERS.has(record.worker)) out.worker = record.worker
  return JSON.stringify(out)
}

/** 기본 기록: 표준 오류 출력에 한 줄 (경보는 JSON 한 줄) */
export const stderrLog: LogSink = (record) => {
  process.stderr.write(`${record.level === 'alert' ? formatAlert(record) : formatLog(record)}\n`)
}

/** 기록하다 실패해도 처리는 계속한다 */
export function safeSink(sink: LogSink): LogSink {
  return (record) => {
    try {
      sink(record)
    } catch {
      // 기록 실패는 무시한다
    }
  }
}
