// 판매자에게 그대로 보이는 밴드 문장 (BND1 수용 기준이 따옴표로 정한 것 — 화면이 글자 그대로 쓴다, UX-01·UX-03).
// 영문 상태값·개발 용어를 넣지 않는다(시험이 모든 문장을 검사한다). 프로그램이 읽는 값은 영문 코드로 따로 준다.
export const BAND_MESSAGES = Object.freeze({
  // 플랫폼 능력 (AC-BND1-02)
  NOT_CONFIGURED: '밴드 연동이 아직 준비되지 않았어요. 운영자에게 문의해 주세요.',
  RECEIVED_TIME: '밴드 댓글은 몇 초마다 읽어 와서 실제 시각순으로 판정할 수 없어요.',
  THANKS: '밴드에는 감사 글을 남기지 않아요.',
  // 계정 (AC-BND1-13·22)
  NOT_CONNECTED: '설정에서 밴드를 먼저 연결해 주세요.',
  RECONNECT_NEEDED: '밴드 연결이 풀렸어요. 설정에서 밴드를 다시 연결해 주세요.',
  // 밴드 목록 (AC-BND1-20)
  NO_BANDS: '가입한 밴드가 없어요. 밴드 앱에서 먼저 밴드를 만들어 주세요.',
  UNKNOWN_BAND: '목록에 없는 밴드예요. 밴드를 다시 골라 주세요.',
  MORE_LIMIT: '글은 다섯 쪽까지만 볼 수 있어요. 최근 글을 이어 주세요.',
  CURSOR_EXPIRED: '목록이 오래됐어요. 글 목록을 다시 불러와 주세요.',
  // 잇기 거절 (AC-BND1-22)
  REHEARSAL: '리허설 방송에는 라이브를 이을 수 없어요.',
  ENDED: '끝난 방송에는 라이브를 이을 수 없어요.',
  // alreadyLinkedMessage의 "라이브" 대신 "글" (밴드만 — 조사도 맞춘다)
  ALREADY_LINKED: '이 방송에는 이미 밴드 글이 이어져 있어요. 먼저 연결을 끊어 주세요.',
  RECEIVED_TIME_NOT_ALLOWED: "밴드 댓글은 실제 시각순으로 판정할 수 없어요. 판매 규칙을 '접수순'으로 바꾼 뒤 새 방송을 시작해 주세요.",
  BAND_IN_USE: '이미 다른 방송에 밴드 글이 이어져 있어요. 먼저 그 방송의 밴드 연결을 끊어 주세요.',
  YOUTUBE_LINKED: '유튜브 라이브를 이은 방송에는 아직 밴드 글을 이을 수 없어요.',
  NOT_MY_POST: '내가 쓴 글만 이을 수 있어요.',
  TOO_MANY_COMMENTS: '댓글이 1,000개 넘는 글은 이을 수 없어요. 새 글을 올려 이어 주세요.',
  NOT_LINKED: '이어진 밴드 글이 없어요.',
  // 잇기 중 밴드 일시 실패 (503 UNAVAILABLE — 연결 없음, D-BND1-19)
  LINK_UNAVAILABLE: '밴드 글을 읽지 못해 잇지 못했어요. 잠시 뒤 다시 눌러 주세요.',
  // 연결 상태 (AC-BND1-50)
  READING: '밴드 댓글을 읽고 있어요.',
  RETRYING: '밴드 댓글을 읽지 못해 다시 시도하고 있어요.',
  NO_ACCESS: '이 밴드 글을 읽을 수 없어요. 글이 지워졌거나 밴드 권한이 바뀌었을 수 있어요.',
  YOUTUBE_STOPPED: '유튜브 라이브를 이은 방송이라 밴드 댓글을 그만 받았어요.',
  // 끝낸 까닭 (AC-BND1-04·14·23·50)
  FINISHED_UNLINKED: '끊었어요.',
  FINISHED_ENDED: '방송을 끝내서 밴드 댓글을 그만 받았어요.',
  FINISHED_ACCOUNT_CHANGED: '다른 밴드 계정으로 바꿔서 밴드 글 연결을 끝냈어요.',
  FINISHED_DISCONNECTED: '밴드 연결을 끊어서 밴드 글 연결을 끝냈어요.',
  FINISHED_RESTORED: '복구해서 밴드 글 연결을 끝냈어요. 다시 이어 주세요.',
  // 알림 (AC-BND1-41)
  // 막다른 경우 (AC-BND1-30, D-BND1-16) — 닿는 읽기가 성공할 때까지 한 번만
  NOTICE_STUCK: '밴드 댓글이 너무 많이 한꺼번에 달려 차례대로 읽지 못하고 있어요. 밴드 글에서 직접 확인해 주세요.',
  NOTICE_ERASED: '밴드에서 지우거나 고친 댓글이 있었어요. 글은 보관 기간이 지나 지웠어요.',
  // 돌아오기 결과 (AC-BND1-12)
  CALLBACK_CONNECTED: '밴드를 연결했어요.',
  CALLBACK_DENIED: '밴드 연결을 취소했어요.',
  CALLBACK_EXPIRED: '연결 시간이 지났어요. 다시 해 주세요.',
  CALLBACK_SCOPE: '밴드 앱 권한이 모자라요. 운영자에게 문의해 주세요.',
  CALLBACK_FAILED: '밴드 연결에 실패했어요. 잠시 뒤 다시 해 주세요.',
})

/** 호출 한도로 쉼 (AC-BND1-53) — N = 남은 초(올림) */
export const bandRateMessage = (seconds: number): string => `밴드가 잠시 쉬어 달라고 해서 ${String(seconds)}초 뒤에 다시 읽어요.`
/** 기준선 (AC-BND1-22) — N = 0이면 문장 없음 */
export const bandBaselineMessage = (count: number): string | null => (count > 0 ? `이을 때 이미 달려 있던 댓글 ${String(count)}개는 넣지 않았어요.` : null)
/** 넣지 못한 댓글 (AC-BND1-35) */
export const bandNoAuthorMessage = (count: number): string => `작성자를 알 수 없는 밴드 댓글 ${String(count)}개는 넣지 못했어요. 밴드에서 직접 확인해 주세요.`
export const bandTooLongMessage = (count: number): string => `너무 긴 밴드 댓글 ${String(count)}개는 넣지 못했어요. 밴드에서 직접 확인해 주세요.`
/** 지운 댓글·고친 댓글 (AC-BND1-40) — 글은 앞 60자(넘으면 …) */
export const bandDeletedMessage = (nick: string, text: string): string => `밴드에서 지운 댓글이에요 — ${nick}: '${text}'. 찜은 그대로예요. 취소하려면 찜에서 직접 취소해 주세요.`
export const bandEditedMessage = (nick: string, before: string, after: string): string => `밴드에서 고친 댓글이에요 — ${nick}: '${before}' → '${after}'. 찜은 처음 글대로예요.`
/** 오래 못 읽다가 다시 읽음 (AC-BND1-54) */
export const bandLateMessage = (minutes: number, count: number): string =>
  `밴드 댓글을 ${String(minutes)}분 동안 읽지 못했어요. 그 사이 달린 댓글 ${String(count)}개를 지금 넣었어요. 찜 순서는 지금 넣은 차례예요.`

/** 돌아오기 결과 코드 → 문장 (화면은 ?band=<코드>를 받아 이 표대로) */
export const BAND_CALLBACK_RESULTS = Object.freeze({
  connected: BAND_MESSAGES.CALLBACK_CONNECTED,
  denied: BAND_MESSAGES.CALLBACK_DENIED,
  expired: BAND_MESSAGES.CALLBACK_EXPIRED,
  scope: BAND_MESSAGES.CALLBACK_SCOPE,
  failed: BAND_MESSAGES.CALLBACK_FAILED,
})
export type BandCallbackResult = keyof typeof BAND_CALLBACK_RESULTS
