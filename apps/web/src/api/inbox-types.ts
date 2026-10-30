// 휴대폰 알림 받기 화면이 쓰는 서버 응답 모양 (SMS3 ORD-13·PAY-02, D-SMS3-04·12·14, D-DEP2-06, AC-SMS3-28~32).
// 서버 약속 v1(dev-server "SMS3 서버 API 약속") 그대로. 시각은 UTC ISO 문자열. 영어 값(종류·사유·은행 코드)은 화면에 내지 않는다.
//
//   GET  /api/inbox/settings                 → { inbox: InboxSettingsView }          (판매자만 — 보조자 403)
//   POST /api/inbox/token          {}         → { token, inbox }                      만들기·다시 만들기(옛 토큰 바로 무효). 토큰 원문은 이 응답에만
//   PUT  /api/inbox/settings  { enabled }     → { inbox }                             켜기·끄기 (토큰 없이 켜기 409 NO_TOKEN)
//   GET  /api/inbox/cards?b=<방송 ID>         → { cards: InboxCardView[] }            콘솔 "문자 확인" 칸 (받은 순서)
//   POST /api/inbox/cards/:id/insert  { requestId, no, qty?, options? }               확인 필요 → 문자찜 넣기
//   POST /api/inbox/cards/:id/approve { requestId }                                    취소 요청 승인 (찜 없으면 409 NO_CLAIM)
//   POST /api/inbox/cards/:id/ignore  {}                                               무시
//   GET  /api/deposits/alerts                 → { alerts: BankAlertView[] }           입금 확인 화면 "은행 알림" 줄
//   POST /api/deposits/alerts/:id/close {}    → { ok: true }                          "확인했어요"
//   SSE  `inbox` { kind: 'cards', b } | { kind: 'received', lastReceivedAt, lastDevice } | { kind: 'settings' }
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
}

/** 확인 필요 사유 (ORD-13 "화면 문구") */
export type InboxReviewReason = 'UNCLEAR' | 'NO_NUMBER' | 'OPTIONS' | 'NOT_ON_SALE'

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
