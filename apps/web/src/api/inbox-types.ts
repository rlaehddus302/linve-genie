// 휴대폰 알림 받기 화면이 쓰는 서버 응답 모양 (SMS3 ORD-13·PAY-02, D-SMS3-04·12·14, D-DEP2-06, AC-SMS3-28~32).
// 서버 약속 v1(dev-server "SMS3 서버 API 약속") 그대로. 시각은 UTC ISO 문자열. 영어 값(종류·사유·은행 코드)은 화면에 내지 않는다.
//
//   GET  /api/inbox/settings                 → { inbox: InboxSettingsView }
//   POST /api/inbox/token          {}         → { token, inbox }                      만들기·다시 만들기(옛 토큰 바로 무효). 토큰 원문은 이 응답에만
//   PUT  /api/inbox/settings  { enabled }     → { inbox }                             켜기·끄기 (토큰 없이 켜기 409 NO_TOKEN)
//   GET  /api/inbox/cards?b=<방송 ID>         → { cards, inboxClaimIds, startedAt, staleBroadcast }   콘솔 "문자 확인" 칸 (받은 순서)
//   POST /api/inbox/stale/close {}            → { inbox }                             12시간 넘은 방송 알림 닫기 (판매자만)
//   POST /api/inbox/cards/:id/insert  { requestId, no, qty?, options? }               확인 필요 → 문자찜 넣기
//   POST /api/inbox/cards/:id/approve { requestId }                                    취소 요청 승인 (찜 없으면 409 NO_CLAIM)
//   POST /api/inbox/cards/:id/ignore  {}                                               무시
//   GET  /api/deposits/alerts                 → { alerts: BankAlertView[] }           입금 확인 화면 "은행 알림" 줄
//   POST /api/deposits/alerts/:id/close {}    → { ok: true }                          "확인했어요"
//   GET  /api/inbox/sms?b=<방송 ID>           → { messages: SmsFeedView[] }           앱 방송 화면 "채팅·문자" 탭의 최근 손님 문자 (최신이 앞, 서버 메모리 — D-UX4-12)
//   SSE  `inbox` { kind: 'cards', b } | { kind: 'received', lastReceivedAt, lastDevice } | { kind: 'settings' } | { kind: 'sms', b }
//   SSE  `deposit` { alerts: true } → 은행 알림 줄 다시 읽기 (입금 알림은 무엇이든 다시 읽는다)

/** 설정 "휴대폰 알림 받기" */
export interface InboxSettingsView {
  /** 켜짐 */
  readonly enabled: boolean
  /** 토큰을 만든 적이 있다 */
  readonly hasToken: boolean
  readonly tokenCreatedAt: string | null
  /** 마지막으로 무엇이든 받은 시각 (서버 도착) */
  readonly lastReceivedAt: string | null
  /** 마지막으로 보낸 기기 이름 (C-04 `device`, 1~30자 — 판매자가 붙인 글이라 이스케이프만) */
  readonly lastDevice: string | null
  /** 시작한 지 12시간 넘은(끝내지 않은) 방송 때문에 넣지 않은 손님 문자 (D-SMS3-29) — 없으면 null·빠짐(옛 서버). 그 방송을 끝내거나 닫으면 null */
  readonly staleBroadcast?: InboxStaleNotice | null
}

/** 12시간 넘은 방송 때문에 넣지 않은 손님 문자 (D-SMS3-29, 서버 약속 v4 StaleNotice) — 본문은 없다 */
export interface InboxStaleNotice {
  /** 끝내지 않은 그 실제 방송 ID */
  readonly b: string
  readonly startedAt: string | null
  /** 마지막으로 넣지 않은 손님 문자가 서버에 온 시각 */
  readonly lastAt: string | null
  /** 넣지 않은 손님 문자 수 */
  readonly count: number
  readonly message: string
}

/** 확인 필요 사유 (ORD-13 "화면 문구") — LATE 늦게 온 문자(D-SMS3-30), REJECTED 엔진이 바로 받지 않음(D-SMS3-31) */
export type InboxReviewReason = 'UNCLEAR' | 'NO_NUMBER' | 'OPTIONS' | 'NOT_ON_SALE' | 'LATE' | 'REJECTED' | 'PAUSED'

/** 콘솔 "문자 확인" 카드 하나 */
export interface InboxCardView {
  readonly id: string
  /** 방송 ID */
  readonly b: string
  /** REVIEW 확인 필요 · CANCEL 취소 요청 */
  readonly kind: 'REVIEW' | 'CANCEL'
  /** REVIEW만 (CANCEL은 null) */
  readonly why: InboxReviewReason | null
  /** 번호 단추 후보 (CANCEL은 [번호]) */
  readonly numbers: readonly number[]
  /** 읽은 이름 — 넣을 때 메모 */
  readonly memo: string | null
  /** 보낸 번호 뒤 4자리 (null이면 이름만 온 문자) */
  readonly last4: string | null
  /** 이름만 온 문자의 보낸 이름(연락처 이름) — 이스케이프 */
  readonly sender: string | null
  /** 본문 (1,000자까지) — 반드시 이스케이프 */
  readonly text: string
  /** 휴대폰이 받은 시각 */
  readonly receivedAt: string
  /** 사유 문구 (서버가 ORD-13 화면 문구로 준다 — 화면은 같은 표로 다시 만들고, 모르는 사유일 때만 이 글) */
  readonly message: string
  /** "승인" 단추를 보일지 (번호가 온 취소 요청만 true — D-SMS3-19) */
  readonly canApprove?: boolean
  /** 늦게 온 문자에서 나온 카드(어떤 사유든) — "넣기"의 받은 시각은 서버 도착 시각이다 (D-SMS3-30). receivedAt은 휴대폰이 받은 원래 시각 */
  readonly late?: boolean
  /** 서버에 온 시각 (ISO UTC) */
  readonly arrivedAt?: string
}

/** 입금 확인 화면 위 "은행 알림" 줄 (DP-9 9) */
export interface BankAlertView {
  readonly id: number
  /** CANCEL 입금 취소 · UNREADABLE 읽지 못함 */
  readonly kind: 'CANCEL' | 'UNREADABLE'
  /** 은행 코드 (화면에 내지 않는다) */
  readonly bank: string
  /** 은행 이름 "KB국민" */
  readonly bankName: string
  /** CANCEL만 */
  readonly amount: number | null
  readonly name: string | null
  /** 알림 글의 시각 (없으면 null) */
  readonly at: string | null
  readonly receivedAt: string
  /** DP-8 문구 (서버가 만든 것 — 화면은 같은 표로 다시 만들고, 모르는 종류일 때만 이 글) */
  readonly message: string
}

/** 방송에 온 손님 문자 한 통 (D-UX4-12) — 본문·보낸 이름은 손님이 쓴 글이라 글자로만 그린다 */
export interface SmsFeedView {
  readonly id: string
  /** 휴대폰이 받은 시각 */
  readonly at: string
  /** 보낸 휴대폰 끝 4자리 (휴대폰 번호가 아니면 null) */
  readonly last4: string | null
  /** 휴대폰 번호가 아닐 때 보낸 이름 */
  readonly sender: string | null
  readonly text: string
  /** 서버가 한 일 — claim 찜으로 넣음 · cancel 취소 요청 · review 확인 필요 · info 손님 정보 · none 찜 아님 · stale 오래된 방송이라 넣지 않음 */
  readonly result: 'claim' | 'cancel' | 'review' | 'info' | 'none' | 'stale'
  readonly numbers: readonly number[]
}
