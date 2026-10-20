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
  /** 판매자 ID (백업 경보 — 판매자 이름·구매자 정보가 아니라 서버가 만든 ID) */
  readonly seller?: string
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
  | 'DOCUMENT_MISMATCH'
  | 'LABEL_INVALID'
  | 'BACKUP_DISABLED'
  | 'BACKUP_FAILED'
  | 'BACKUP_PRUNE_FAILED'
  | 'DOCUMENT_WORK_FAILED'

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
  DOCUMENT_MISMATCH: '확인서 금액이 정산 금액과 맞지 않아 문서를 만들지 않았어요',
  LABEL_INVALID: '포장 라벨 데이터가 형식 검사를 통과하지 못해 라벨을 만들지 않았어요',
  BACKUP_DISABLED: '백업 저장소가 정해지지 않아 자동 백업이 꺼져 있어요',
  BACKUP_FAILED: '판매자 백업을 만들지 못했어요(다음 확인 때 다시 해요)',
  BACKUP_PRUNE_FAILED: '오래된 백업을 지우지 못했어요(다음 확인 때 다시 해요)',
  DOCUMENT_WORK_FAILED: '파일 작업 워커가 일을 끝내지 못했어요(시간·메모리 상한·끊긴 요청 등 — 서버 판정은 그대로)',
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
  if (record.seller !== undefined) parts.push(`seller=${record.seller}`)
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
