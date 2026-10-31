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
  /** 찜 ID (엔진이 만든 `c<번호>` — 찜 금액이 없는 확정 찜, D-O3-15. 닉네임·금액은 남기지 않는다) */
  readonly claim?: string
  /** 같은 코드를 횟수 제한으로 남기지 않은 수 (틱톡 연결 객체 — 그 코드를 다음에 남길 때 함께, D-N2b-2-11 (마)) */
  readonly suppressed?: number
  /** 간편 로그인 공급자 이름 (L1 — google · kakao · naver만. 공급자 계정 ID·이메일·코드·토큰은 남기지 않는다) */
  readonly provider?: 'google' | 'kakao' | 'naver'
}

export type LogCode =
  | 'TRANSCRIBE_NO_WORKER'
  | 'ENGINE_FAILED'
  | 'REPLAY_SKIPPED'
  | 'SAVE_FAILED'
  | 'SNAPSHOT_FAILED'
  | 'SNAPSHOT_UNUSABLE'
  | 'REQUEST_FAILED'
  | 'STATE_FORMAT'
  | 'STREAM_FAILED'
  // QS1 D-QS1-04: 실시간 연결을 한도로 닫음 — 판매자 ID와 까닭(reason: BUFFER_FULL · SELLER_LIMIT)만
  | 'STREAM_CLOSED'
  | 'LOGIN_PRUNE_FAILED'
  | 'DRAFT_SKIPPED'
  // X1 크롬 확장 (YT-10 AC9): 종류·판매자만 — 토큰·닉네임·본문은 남기지 않는다
  | 'EXT_SAVE_FAILED'
  | 'EXT_POST_PAUSED'
  | 'EXT_NOTIFY_FAILED'
  | 'TTX_SAVE_FAILED'
  | 'TTX_COUNT_FAILED'
  | 'TTX_CLEAR_FAILED'
  | 'TTX_EXT_DROPPED'
  | 'TTX_REFRESH_FAILED'
  | 'TTX_RESUME_FAILED'
  // Y1 유튜브 (AC-Y1-70): 종류·HTTP 상태·구글 오류 이유·판매자·범위만 남긴다
  | 'YOUTUBE_CONNECT_FAILED'
  | 'YOUTUBE_REFRESH_FAILED'
  | 'YOUTUBE_RECONNECT_NEEDED'
  | 'YOUTUBE_REVOKE_FAILED'
  | 'YOUTUBE_API_FAILED'
  | 'COLLECTOR_ERROR'
  | 'COLLECTOR_STOPPED'
  | 'COLLECTOR_SAVE_FAILED'
  // YT-11 서버 웹 읽기 (D-YT-SRV-06·07·12): 막힘·모르는 모양·연결 오류 경보 재료(판매자 정보 없음), 모르는 종류 이름·수, 끄기 스위치 값 경고(값 없음)
  | 'YT_CHAT_BLOCKED'
  | 'YT_CHAT_FORMAT'
  | 'YT_CHAT_NETWORK'
  | 'YT_CHAT_UNKNOWN_ITEM'
  | 'YT_WEB_CHAT_INVALID'
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
  | 'TIKTOK_SIGN_NEAR_LIMIT'
  | 'TIKTOK_SIGN_OVER_LIMIT'
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
  // O3 감사 (D-O3-15): 확정 찜에 찜 금액이 없어 요약 댓글·라벨·포장·봉인 장부를 만들지 않음 — 찜 ID만
  | 'AMOUNT_MISSING'
  // PL1A (D-PL1-04): 30일 봉인 날짜의 장부를 읽지 못해 문서를 만들지 않음 — 코드·날짜만 (장부 글·구매자 이름 없음)
  | 'LEDGER_UNREADABLE'
  // CRM1 손님 기록 보관 (D-CRM1-12): 판매자 ID·날짜·개수·오류 종류만 (표지·이름·숫자 내용은 남기지 않는다)
  | 'CUSTOMER_ARCHIVED'
  | 'CUSTOMER_ARCHIVE_FAILED'
  | 'CUSTOMER_ARCHIVE_UNREADABLE'
  // N5 요금 (결제 ID·사업자 정보·조회 원문·비밀값은 남기지 않는다)
  | 'BILLING_FAILED'
  | 'PAYMENT_LOOKUP_FAILED'
  | 'PAYMENT_CANCEL_FAILED'
  | 'PAYMENT_REVIEW'
  | 'DOCUMENT_FAILED'
  // 틱톡 N2b-2 (D-N2b-2-05·06·11): 멈춘 연결, 라이브러리 환경 변수(변수 이름만 reason에), 댓글 기록 실패·기록하지 않음
  | 'TIKTOK_STALLED'
  | 'TIKTOK_LIBRARY_ENV'
  | 'TIKTOK_SAVE_FAILED'
  | 'TIKTOK_SKIPPED'
  | 'TIKTOK_RESUME_FAILED'
  // 인스타그램 설정 주소가 https가 아님 (D-N2b-2-10)
  | 'INSTAGRAM_CONFIG_INSECURE'
  // BND1 밴드 (D-BND1-14): 정해진 코드·(요청 이름_결과 코드)·HTTP 상태·판매자 ID·개수만. 토큰·코드·주소·user_key·밴드/글 키·손님 이름·댓글은 남기지 않는다
  | 'BAND_CONFIG_INVALID'
  | 'BAND_API_FAILED'
  | 'BAND_CONNECT_FAILED'
  | 'BAND_TOKEN_UNREADABLE'
  | 'BAND_RECONNECT_NEEDED'
  | 'BAND_YOUTUBE_LINKED'
  | 'BAND_READ_FAILED'
  | 'BAND_PAGING_LOOP'
  | 'BAND_PAGING_LIMIT'
  | 'BAND_FAST_UNREACHED'
  | 'BAND_STUCK'
  | 'BAND_ENDED_STOPPED'
  | 'BAND_RECORD_REJECTED'
  | 'BAND_RETRY_STATE_FAILED'
  | 'BAND_SAVE_FAILED'
  | 'BAND_SKIPPED'
  | 'BAND_RESUME_FAILED'
  | 'BAND_ERASE_FAILED'
  | 'DEPOSIT_FETCH_FAILED'
  | 'DEPOSIT_SAVE_FAILED'
  | 'DEPOSIT_ROW_SAVE_RETRY'
  | 'DEPOSIT_ROW_SAVE_FAILED'
  | 'DEPOSIT_APPLY_FAILED'
  | 'DEPOSIT_NOTIFY_FAILED'
  // T1 택배 (PARCEL_RULES PC-3 "로그 금지"): 택배사 코드(reason)·HTTP 상태·개수·판매자 ID·날짜만. 받는 분·연락처·주소·메모·택배사 원래 응답·송장번호는 남기지 않는다
  | 'PARCEL_BOOK_UNKNOWN'
  | 'PARCEL_BOOK_RESUMED'
  | 'PARCEL_CANCEL_UNKNOWN'
  | 'PARCEL_TRACK_FAILED'
  | 'PARCEL_JOB_FAILED'
  | 'PARCEL_ADDRESSES_SWEPT'
  | 'PARCEL_CARRIER_NOT_READY'
  // L1 간편 로그인 (D-L1-04): 공급자 이름·결과 코드(reason)·오류 종류·HTTP 상태만
  | 'SOCIAL_LOGIN'
  // A1 AI 제안 (D-A1-06): 정해진 코드·판매자 ID·HTTP 상태·개수만. 키·댓글 글(원문·가린 것)·요청·응답 본문·모델이 돌려준 글은 남기지 않는다
  | 'ASSIST_HTTP_ERROR'
  | 'ASSIST_TIMEOUT'
  | 'ASSIST_NETWORK'
  | 'ASSIST_FAILED'
  | 'ASSIST_NO_SUGGESTION'
  // AIY1 (D-AIY1-06): 유튜브 줄을 AI로 보내지 않고 뺀 개수만. 글·닉네임·채널·메시지 ID는 남기지 않는다
  | 'ASSIST_EXCLUDED'
  // V3 음성 등록·고침 기록 (R-25, D-V3-65): 판매자·범위 날짜·줄 수만. 들은 말·품종·닉네임은 남기지 않는다
  | 'VOICE_LOG_FAILED'
  // KP1 손님 장부 (CR-8): 판매자·개수·오류 종류만. 연락처·표지·코드 글·채팅 본문은 남기지 않는다
  | 'LEDGER_CODE_FAILED'
  | 'LEDGER_SWEEP_FAILED'
  | 'LEDGER_SWEPT'
  | 'LEDGER_SWEEP_SKIPPED' // KP1 RA-KP1-002

export type LogSink = (record: LogRecord) => void

const MESSAGES: Readonly<Record<LogCode, string>> = {
  TRANSCRIBE_NO_WORKER: '받아쓰기 서버가 연결되어 있지 않아요',
  ENGINE_FAILED: '엔진이 처리하지 못한 입력을 실패로 표시하고 건너뛰었어요',
  REPLAY_SKIPPED: '다시 불러오는 중 처리하지 못한 입력을 건너뛰었어요',
  SAVE_FAILED: '저장하지 못했어요',
  SNAPSHOT_FAILED: '스냅샷을 저장하지 못했어요(기록은 저장됨)',
  SNAPSHOT_UNUSABLE: '저장된 스냅샷을 쓸 수 없어 처음부터 다시 불러왔어요',
  REQUEST_FAILED: '요청 처리 중 오류가 생겼어요',
  STATE_FORMAT: '상태 형식이 달라 다시 불러와요',
  STREAM_FAILED: '실시간 연결에 보내지 못했어요',
  STREAM_CLOSED: '실시간 연결을 한도로 닫았어요(브라우저가 다시 연결해요)',
  LOGIN_PRUNE_FAILED: '로그인 시도 기록을 정리하지 못했어요(로그인은 계속함)',
  DRAFT_SKIPPED: '서버가 덧붙이는 입력(차단 이어받기)이 입력 검사를 통과하지 못해 기록하지 않았어요',
  EXT_SAVE_FAILED: '확장에서 받은 채팅을 저장하지 못했어요(확장이 다시 보내요)',
  EXT_POST_PAUSED: '확장 감사 올리기가 연달아 실패해 그 회차에서 멈췄어요',
  EXT_NOTIFY_FAILED: '확장 상태를 화면에 알리지 못했어요',
  TTX_SAVE_FAILED: '확장에서 받은 틱톡 댓글을 저장하지 못했어요(확장이 다시 보내요)',
  TTX_COUNT_FAILED: '확장 틱톡 댓글은 기록했지만 수를 세지 못했어요',
  TTX_CLEAR_FAILED: '확장 연결을 끊은 뒤 틱톡 확장 상태를 비우지 못했어요',
  TTX_EXT_DROPPED: '확장이 틱톡 댓글을 버렸다고 알려 와 저장하지 못한 수에 더했어요',
  TTX_REFRESH_FAILED: '확장 연결이 바뀐 뒤 틱톡 칸을 다시 알리지 못했어요',
  TTX_RESUME_FAILED: '서버가 다시 켜진 뒤 틱톡 확장 상태 확인을 다시 걸지 못했어요',
  YOUTUBE_CONNECT_FAILED: '유튜브 연결을 마치지 못했어요',
  YOUTUBE_REFRESH_FAILED: '유튜브 접근 토큰을 새로 고치지 못했어요',
  YOUTUBE_RECONNECT_NEEDED: '유튜브 연결을 다시 해야 해요',
  YOUTUBE_REVOKE_FAILED: '구글에 토큰 폐기를 요청하지 못했어요(연결은 끊음)',
  YOUTUBE_API_FAILED: '유튜브 호출이 실패했어요',
  COLLECTOR_ERROR: '채팅 수집 중 오류가 생겨 다시 연결해요',
  COLLECTOR_STOPPED: '채팅 수집을 멈췄어요',
  COLLECTOR_SAVE_FAILED: '받은 채팅을 저장하지 못해 이어받기 지점을 남기지 않았어요',
  YT_CHAT_BLOCKED: '유튜브가 서버의 채팅 읽기를 막았어요(429·403·봇 확인)',
  YT_CHAT_FORMAT: '유튜브 채팅 응답 모양을 알아볼 수 없어요(읽기를 고쳐야 해요)',
  YT_CHAT_NETWORK: '유튜브 채팅 읽기가 연결 오류로 다섯 번 이어 실패했어요',
  YT_CHAT_UNKNOWN_ITEM: '유튜브 채팅에 모르는 항목 종류가 있어 버렸어요(이름·수만 남김)',
  YT_WEB_CHAT_INVALID: '유튜브 채팅 읽기 스위치 값을 알아볼 수 없어 켬으로 봤어요',
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
  TIKTOK_SIGN_NEAR_LIMIT: '틱톡 서명 서비스 하루 한도에 가까워졌어요(수만 기록)',
  TIKTOK_SIGN_OVER_LIMIT: '틱톡 서명 서비스 하루 한도를 넘었어요(연결은 막지 않음)',
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
  AMOUNT_MISSING: '확정 찜에 찜 금액이 없어 그 결과(요약 댓글·라벨·포장·봉인 장부)를 만들지 않았어요',
  LEDGER_UNREADABLE: '30일이 지나 봉인한 날짜의 장부를 읽지 못해 그 날짜의 문서를 만들지 않았어요(지난 구매에서는 그 날짜만 뺌)',
  CUSTOMER_ARCHIVED: '봉인 전 손님 기록(취소 수·입금 안 함)을 보관했어요',
  CUSTOMER_ARCHIVE_FAILED: '봉인 전 손님 기록을 보관하지 못했어요(다음 차례에 다시 해요)',
  CUSTOMER_ARCHIVE_UNREADABLE: '봉인 날짜의 손님 기록 보관 행을 읽지 못해 그 행만 뺐어요(장부 숫자는 그대로)',
  DOCUMENT_WORK_FAILED: '파일 작업 워커가 일을 끝내지 못했어요(시간·메모리 상한·끊긴 요청 등 — 서버 판정은 그대로)',
  BILLING_FAILED: '요금 정보를 읽지 못했어요',
  PAYMENT_LOOKUP_FAILED: '결제를 조회하지 못했어요(주문은 그대로)',
  PAYMENT_CANCEL_FAILED: '결제를 취소하지 못했어요',
  PAYMENT_REVIEW: '결제 완료였던 주문을 결제 조회로 맞추지 못해 확인 필요로 올렸어요(운영자 목록)',
  DOCUMENT_FAILED: '증빙을 발행·취소하지 못했어요(결제·이용권은 그대로)',
  TIKTOK_STALLED: '받던 틱톡 연결에서 2분 동안 아무 자료가 오지 않아 끊긴 것으로 보고 다시 연결해요',
  TIKTOK_LIBRARY_ENV: '틱톡 연결기가 스스로 읽는 환경 변수가 있어 틱톡 베타를 끈 것으로 봤어요(그 변수를 지워 주세요)',
  TIKTOK_SAVE_FAILED: '틱톡 댓글을 기록하지 못했어요(연결은 계속함)',
  TIKTOK_SKIPPED: '틱톡 댓글이 입력 검사를 통과하지 못해 기록하지 않았어요(수만 셈)',
  TIKTOK_RESUME_FAILED: '서버를 다시 켠 뒤 틱톡 연결을 이어받지 못했어요',
  INSTAGRAM_CONFIG_INSECURE: '인스타그램 주소 설정이 https가 아니라 인스타그램 연동을 끈 것으로 봤어요',
  BAND_CONFIG_INVALID: '밴드 주소 설정이 https가 아니거나 형식이 틀려 밴드 연동을 끈 것으로 봤어요',
  BAND_API_FAILED: '밴드 요청이 실패했어요',
  BAND_CONNECT_FAILED: '밴드 계정 연결을 마치지 못했어요',
  BAND_TOKEN_UNREADABLE: '밴드 토큰을 풀지 못해 연결을 다시 연결 필요로 바꿨어요',
  BAND_RECONNECT_NEEDED: '밴드 연결이 풀려 그 판매자의 밴드 읽기를 멈췄어요',
  BAND_YOUTUBE_LINKED: '유튜브를 이은 회차라 밴드 읽기를 멈췄어요',
  BAND_READ_FAILED: '밴드 댓글 읽기 중 오류가 생겨 다시 시도해요',
  BAND_PAGING_LOOP: '밴드 쪽 넘기기가 같은 쪽을 다시 가리켜 그 읽기를 끝냈어요',
  BAND_PAGING_LIMIT: '밴드 쪽 넘기기가 쪽 수 상한에 닿아 그 읽기를 끝냈어요',
  BAND_FAST_UNREACHED: '밴드 빠른 읽기가 본 댓글까지 닿지 못해 기록하지 않았어요',
  BAND_STUCK: '밴드 댓글이 한꺼번에 너무 많이 달려 차례대로 읽지 못하고 있어요',
  BAND_ENDED_STOPPED: '끝난 방송에 남은 밴드 글 연결을 끝냈어요',
  BAND_RECORD_REJECTED: '밴드 댓글 기록이 거절되어 다시 시도해요',
  BAND_RETRY_STATE_FAILED: '밴드 다시 시도 상태를 저장하지 못했어요(다음 읽기는 예약함)',
  BAND_SAVE_FAILED: '밴드 댓글을 기록하지 못해 다시 시도해요',
  BAND_SKIPPED: '입력 검사를 통과하지 못한 밴드 댓글을 기록하지 않았어요',
  BAND_RESUME_FAILED: '서버를 다시 켤 때 밴드 읽기를 이어받지 못했어요',
  BAND_ERASE_FAILED: '보관 기간이 지난 밴드 알림 글을 지우지 못했어요(다음에 다시 해요)',
  DEPOSIT_FETCH_FAILED: '입금 원천에서 받아 오지 못했어요(다음 주기에 다시 함)',
  DEPOSIT_SAVE_FAILED: '받은 입금을 저장하지 못했어요(다음 주기에 다시 함)',
  DEPOSIT_ROW_SAVE_RETRY: '받은 입금을 한 번에 저장하지 못해 한 줄씩 다시 저장해요',
  DEPOSIT_ROW_SAVE_FAILED: '받은 입금 한 줄을 저장하지 못해 그 줄만 건너뛰었어요',
  DEPOSIT_APPLY_FAILED: '입금 자동 확인을 적지 못해 확인 필요로 남겼어요',
  DEPOSIT_NOTIFY_FAILED: '입금 확인 알림을 보내지 못했어요(기록은 저장됨)',
  PARCEL_BOOK_UNKNOWN: '택배사 접수 답을 받지 못해 접수됐는지 모름으로 남겼어요(같은 요청 번호로 다시 확인해요)',
  PARCEL_BOOK_RESUMED: '결과 없이 멈춘 택배 접수 요청을 같은 요청 번호로 이어받았어요(두 번 접수되지 않아요)',
  PARCEL_CANCEL_UNKNOWN: '택배사 접수 취소 답을 받지 못했어요(접수는 그대로)',
  PARCEL_TRACK_FAILED: '택배 배송 조회가 실패했어요(마지막 상태 그대로, 다음 주기에 다시 해요)',
  PARCEL_JOB_FAILED: '택배 작업(조회·배송지 정리) 중 오류가 생겼어요(다음 주기에 다시 해요)',
  PARCEL_ADDRESSES_SWEPT: '보관 기간(주문 날짜 + 30일)이 지난 배송지를 지웠어요',
  PARCEL_CARRIER_NOT_READY: '우체국 택배 연동 키가 있지만 실제 택배사 연결은 아직 없어 쓰지 않았어요(가짜 택배사는 시험 모드에서만)',
  SOCIAL_LOGIN: '간편 로그인 결과',
  ASSIST_HTTP_ERROR: 'AI 제안 요청이 오류로 끝났어요(규칙 제안은 그대로)',
  ASSIST_TIMEOUT: 'AI 제안 요청이 15초 안에 끝나지 않았어요(규칙 제안은 그대로)',
  ASSIST_NETWORK: 'AI 제안 요청을 보내지 못했어요(규칙 제안은 그대로)',
  ASSIST_FAILED: 'AI 제안을 처리하다 오류가 생겼어요(규칙 제안은 그대로)',
  ASSIST_NO_SUGGESTION: 'AI 답에서 검사를 통과하지 못한 항목을 제안 없음으로 두었어요',
  ASSIST_EXCLUDED: '유튜브 채팅은 AI에 보내지 않고 규칙 제안만 두었어요',
  VOICE_LOG_FAILED: '음성 기록의 실패 줄을 남기지 못했어요(상품 명령은 기록되지 않음)',
  // KP1
  LEDGER_CODE_FAILED: '채팅에서 손님 장부 연결 코드를 읽지 못했어요(기록·판정은 그대로)',
  LEDGER_SWEEP_FAILED: '손님 장부 정리 중 오류가 생겼어요(다음 주기에 다시 해요)',
  LEDGER_SWEPT: '보관 기간이 지난 손님 장부 줄과 끝난 연결 코드를 정리했어요',
  LEDGER_SWEEP_SKIPPED: '읽지 못한 지난 장부가 있어 이 판매자의 손님 장부는 이번에 지우지 않았어요(다음 주기에 다시 봐요)', // KP1 RA-KP1-002
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
  if (record.provider !== undefined && PROVIDERS.has(record.provider)) parts.push(`provider=${record.provider}`)
  if (record.status !== undefined) parts.push(`status=${String(record.status)}`)
  if (record.reason !== undefined && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(record.reason)) parts.push(`reason=${record.reason}`)
  if (record.claim !== undefined && CLAIM_RE.test(record.claim)) parts.push(`claim=${record.claim}`)
  if (record.errorKind !== undefined) parts.push(`kind=${record.errorKind}`)
  return `[server] ${MESSAGES[record.code]} (${parts.join(' ')})`
}

const CLAIM_RE = /^c[0-9]{1,15}$/
const PROVIDERS = new Set(['google', 'kakao', 'naver'])
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
