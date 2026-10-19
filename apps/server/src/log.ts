// 서버 로그 (D-073, AC-S04-34, RA-S00-004).
// 로그에는 정해진 코드와 범위·seq·오류 종류만 남긴다. 요청 본문·전화번호·키·메모·닉네임·채팅 본문·제목·사유·아이디·비밀번호·
// 세션 값·비밀 키·오류 메시지(값이 들어 있을 수 있다)는 남기지 않는다. 그래서 기록 함수는 자유 문장을 받지 않는다.

export type LogLevel = 'info' | 'warn' | 'error'

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
  /** 판매자 ID (유튜브 워커 — 판매자 ID는 서버가 만든 값이다) */
  readonly seller?: string
  /** HTTP 상태 (유튜브 오류) */
  readonly status?: number
  /** 구글 오류 이유 코드 (quotaExceeded 같은 영문 코드만 — 형식이 다르면 남기지 않는다) */
  readonly reason?: string
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
  | 'OUTBOX_ERROR'
  | 'SEAL_FAILED'
  | 'SEALED'
  | 'WORKER_FAILED'

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
  OUTBOX_ERROR: '발송함 처리 중 오류가 생겼어요',
  SEAL_FAILED: '30일 지난 범위를 봉인하지 못해 다음에 다시 해요',
  SEALED: '30일 지난 범위를 봉인했어요',
  WORKER_FAILED: '유튜브 작업 중 오류가 생겼어요',
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
  if (record.seller !== undefined && /^[A-Za-z0-9_-]{1,80}$/.test(record.seller)) parts.push(`seller=${record.seller}`)
  if (record.status !== undefined) parts.push(`status=${String(record.status)}`)
  if (record.reason !== undefined && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(record.reason)) parts.push(`reason=${record.reason}`)
  if (record.errorKind !== undefined) parts.push(`kind=${record.errorKind}`)
  return `[server] ${MESSAGES[record.code]} (${parts.join(' ')})`
}

/** 기본 기록: 표준 오류 출력에 한 줄 */
export const stderrLog: LogSink = (record) => {
  process.stderr.write(`${formatLog(record)}\n`)
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
