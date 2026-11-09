// 화면 낱말 (UX-01, D-088, APP-01 AC5 "웹의 같은 화면과 같은 낱말"). 엔진 영어 값은 이 표의 낱말로만 보인다.
// 웹 lib/words.ts와 같은 값이다 — 웹 모듈은 @livejjim/core 전체를 불러오므로 앱은 표를 따로 들고, 시험(test/words-sync.test.ts)이 두 표가 같은지 본다.
import type { ClaimReason, ClaimStatus, PaymentStatus, ProductStatus } from '@livejjim/core'
import { formatWon } from '@livejjim/core/format'

export { formatWon }

export const SERVICE_NAME = '라이브지니'

export const PRODUCT_STATUS_WORD: Readonly<Record<ProductStatus, string>> = {
  READY: '공개 전',
  OPEN: '판매 중',
  SOLD: '판매 완료',
  HOLD: '일시 중지',
  CLOSED: '판매 종료',
}

export const REJECT_REASON_WORD: Readonly<Record<ClaimReason, string>> = {
  BLOCKED: '차단',
  UNOPENED: '보류',
  NOT_ON_SALE: '판매 중 아님',
  SOLD_OUT: '품절',
  EXPIRED: '만료',
  WAITLIST_CLEARED: '대기 정리',
  BY_HOST: '무효',
  RENUMBERED: '번호 바뀜',
  OPTION_MISSING: '옵션 빠짐',
  STOCK_SHORT: '수량 부족',
}

const CLAIM_STATUS_WORD: Readonly<Record<Exclude<ClaimStatus, 'WAITLISTED' | 'REJECTED'>, string>> = {
  CONFIRMED: '1등',
  PENDING: '보류',
  CONFLICT: '충돌',
  CANCELLED: '취소됨',
  DUPLICATE: '중복',
}

/** 찜 상태 낱말: 1등 · 대기 n번 · 보류 · 충돌 · 취소됨 · 중복 · (거절 사유 낱말) */
export function claimStatusWord(status: ClaimStatus, reason: ClaimReason | null, waitPosition: number | null): string {
  if (status === 'WAITLISTED') return waitPosition === null ? '대기' : `대기 ${String(waitPosition)}번`
  if (status === 'REJECTED') return reason === null ? '무효' : REJECT_REASON_WORD[reason]
  return CLAIM_STATUS_WORD[status]
}

/** 알림 낱말 (D-088) */
export const ALERT_WORD = {
  conflict: '충돌',
  cancelRequest: '취소 요청',
  succession: '승계 결정 필요',
  pending: '보류 찜',
  attention: '확인 필요',
} as const

/** 라벨 상태 낱말 (D-088) */
export const LABEL_WORD = {
  waiting: '라벨 대기',
  printed: '라벨 출력됨',
  reprint: '재출력 필요',
} as const

/** 입금 상태 낱말 (D-092) */
export const PAYMENT_WORD: Readonly<Record<PaymentStatus, string>> = {
  UNPAID: '미입금',
  PARTIAL: '부분 입금',
  PAID: '입금 완료',
  OVERPAID: '과입금',
}

export function paymentWord(status: PaymentStatus, refundDue: number): string {
  return status === 'OVERPAID' ? `과입금(환불 필요 ${formatWon(refundDue)})` : PAYMENT_WORD[status]
}

/** 출력 알림 띠 낱말 (D-I1-08) */
export const PRINT_ALERT_WORD = { paused: '출력 멈춤', discard: '버릴 라벨' } as const

/** 출력 조치 낱말 (D-I1-08, 웹 lib/print-words.ts PRINT_ACTION) */
export const PRINT_ACTION = {
  reconnect: '다시 연결',
  restart: '다시 시작',
  start: '출력 시작',
  pause: '출력 멈추기',
  release: '출력 그만하기',
  print: '라벨 출력',
  reprint: '다시 출력',
  discarded: '버렸어요',
  thisDevice: '이 기기에서 출력',
} as const

/** 프린터 연결 상태 낱말 (packages/printer CONNECTION_STATE_NAMES와 같다) */
export const CONNECTION_STATE_WORD = {
  DISCONNECTED: '끊김',
  CONNECTING: '연결 중',
  CONNECTED: '연결됨',
  PRINTING: '출력 중',
} as const
export type ConnectionState = keyof typeof CONNECTION_STATE_WORD

/** 저절로 다시 잇는 동안 (웹 print-words autoReconnectingMessage와 같다, L-11 8) — n = 기다리거나 하는 중인 시도의 차례 */
export const autoReconnectingMessage = (attempt: number, total: number): string => `프린터에 다시 잇고 있어요. (${String(attempt)}/${String(total)})`
/** 저절로 다시 잇기가 그친 뒤 (웹 AUTO_RECONNECT_GAVE_UP과 같다) */
export const AUTO_RECONNECT_GAVE_UP = "저절로 다시 잇지 못했어요. 아래를 해 본 뒤 '다시 연결'을 눌러 주세요."
/** 시험용 프린터 연결 단추 (웹 LabelsPage와 같은 낱말, L-11 15) */
export const TEST_PRINTER_METHOD = '시험용 프린터 — 실제로 출력되지 않아요'

export const NO_STATION_SHORT = '라벨이 안 나가요 · 프린터를 연결해 주세요'

/** 서버에 닿지 못했을 때 (웹과 같은 문장) */
export const NETWORK_MESSAGE = '서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.'
export const SESSION_EXPIRED_MESSAGE = '로그인이 풀렸어요. 다시 로그인해 주세요.'
/** 앱을 켤 때 서버에 닿지 못함 — 로그인이 풀린 것이 아닐 수 있다 (APP2) */
export const OFFLINE_AT_START_MESSAGE = '서버에 연결하지 못했어요. 로그인이 풀린 건 아니에요. 연결되면 저절로 들어가요.'
export const LOGIN_FAILED_HINT = '아이디·비밀번호를 잊었으면 운영자에게 물어봐 주세요.'
/** 로그인 첫 화면 맨 아래 고객센터 (D-UX3-32). 번호는 임시 — 사용자 지시 2026-11-06 "번호는 나중에 바꿀거임 일단 임시로 070-1234-5678" */
export const SUPPORT_PHONE = '070-1234-5678'
export const SUPPORT_EMAIL = 'help@livegenie.kr'

/** 실시간 연결 문장 (웹 LiveNotices와 같은 뜻) */
export const LIVE_RECONNECTING = '다시 연결하는 중…'
export const LIVE_STALE = '최신으로 맞추지 못했어요. 다시 시도하는 중이에요.'
export const RETRY_NOW = '지금 다시 불러오기'

/** 콘솔 */
export const CURRENT_PRODUCT = '현재 상품'
// D-UX4-31: "직접 넣기" 시트 대신 상품 탭 오른쪽 아래 (+) 단추
export const NO_PRODUCTS_YET = '아직 올린 상품이 없어요. 말하거나 오른쪽 아래 + 단추로 올려 주세요.'
export const QUICK_SEND = '보내기'
export const ALERTS_NONE = '알림 없음'
export const NO_FOCUS_WORDS = '지금 상품 없음 — 상품 이름을 쓴 댓글만 받아요'
export const UNDO = '되돌리기'
export const UNDONE_REGISTER = '등록을 되돌렸어요(판매 종료).'
export const OPEN_IN_WEB = '웹으로 열기'

/** 음성 (VOC-06, D-APP-05·08) */
export const VOICE_ON = '음성 켜기'
export const VOICE_OFF = '음성 끄기'
export const VOICE_LISTENING = '음성 듣는 중'
export const VOICE_RECONNECTING = '다시 잇는 중'
export const VOICE_STOPPED_TITLE = '듣기 멈춤'
export const VOICE_STOPPED_BODY = '받아쓰기 서버에 연결하지 못했어요. 상품은 + 단추로 넣어 주세요.'
/** 지난번 마이크를 켜다가 앱이 꺼졌을 때 — 저절로 다시 켜지 않고 알린다 */
export const MIC_START_CUT_MESSAGE = '지난번에 마이크를 켜다가 앱이 꺼졌어요. + 단추로 상품 넣기는 그대로 쓸 수 있어요. 음성이 필요하면 [듣기 시작]을 눌러 주세요. 또 꺼지면 휴대폰을 껐다 켜 주세요.'
export const VOICE_RETRY = '다시 켜기'
export const VOICE_SENT_LINE = '음성은 라이브지니 받아쓰기 서버로 보내져요.'
export const VOICE_CONSENT_LINES: readonly string[] = [
  '음성 듣기를 켜면 이 기기 마이크 소리를 라이브지니 받아쓰기 서버로 보내 글로 바꿔요. 소리는 저장하지 않아요.',
  '와이파이에서 쓰세요. 휴대폰 데이터로는 1시간에 약 120MB를 써요.',
  '방송 동안 충전기를 꽂아 두세요.',
]
export const VOICE_HEARD_TITLE = '지금 들리는 말'
export const VOICE_HEARD_EMPTY = '말하면 여기에 보여요'
export const VOICE_HEARING = '듣는 중…'
export const VOICE_LATE_NOTE = '늦게 들린 말이라 바로 등록하지 않았어요. 맞으면 등록을 눌러 주세요.'
export const VOICE_CARD_REGISTER = '등록'
export const VOICE_CARD_DISMISS = '아니요'
export const VOICE_INSTANT_LABEL = '번호와 가격이 들리면 바로 등록'
export const VOICE_OTHER_DEVICE = '음성은 다른 기기에서 듣는 중이에요.'
export const VOICE_SELLER_ONLY = '음성은 판매자 계정에서만 켤 수 있어요.'

/** 방송 중 화면 (D-UX2-03): 아래 고정 버튼 두 개와 머리 아래 도움 한 줄 */
/** 방송 메뉴의 휴대폰 마이크 켜기·끄기 (D-UX3-73 — 아래 고정 단추에서 옮김) */
export const LISTEN_START = '휴대폰 마이크로 듣기'
export const LISTEN_STOP = '휴대폰 마이크 끄기'
export const LISTEN_HELP = '“15번 핑크프릴 만 이천원”처럼 말하면 자동으로 올라가요'
export const LISTEN_OFF_HELP = '듣기를 켜면 말로 상품을 올릴 수 있어요'
/** 머리 오른쪽 음성 상태 (점 + 글) */
export const LISTEN_STATE = { on: '듣는 중', starting: '켜는 중', reconnecting: '다시 잇는 중', stopped: '듣기 멈춤', off: '듣기 꺼짐' } as const

/** 자리를 비운 동안 (APP-04) */
export function awayLine(counts: { readonly labels: number; readonly claims: number; readonly voice: number }): string | null {
  const parts: string[] = []
  if (counts.labels > 0) parts.push(`라벨 ${String(counts.labels)}장`)
  if (counts.claims > 0) parts.push(`찜 ${String(counts.claims)}건`)
  if (counts.voice > 0) parts.push(`음성 ${String(counts.voice)}개`)
  return parts.length === 0 ? null : `자리를 비운 동안 ${parts.join('·')}`
}
/** 블루투스를 쓸 수 없는 기기에서 프린터 연결을 눌렀을 때 (웹의 "이 브라우저에서는…" 대신) */
export const APP_PRINTER_UNSUPPORTED = '이 휴대폰에서는 블루투스를 쓸 수 없어 프린터에 연결할 수 없어요. 블루투스가 되는 휴대폰에서 연결하거나, 컴퓨터 화면에서 라벨을 출력해 주세요.'
// 프린터를 '기본·실험'으로 나눠 보이지 않는다 (D-UX3-19, 사용자 지시 2026-11-03 "기본 프린터, 실험 프린터 그런게 어딨어") — 옛 "실험" 꼬리표·"(실험)"·실험 안내는 없앴다.
// 아직 확인이 덜 된 기종은 그 연결에서 테스트 인쇄 "예" 전까지 출력하지 않는 규칙(D-PRN2-10)은 그대로이고, 문장은 까닭 없이 할 일만 말한다.
/** 테스트 인쇄 "예" 전에는 "이 기기에서 출력"이 없다 (옛 문장 '실험 중인 프린터는 테스트 인쇄를…' — D-UX3-19) */
export const EXPERIMENTAL_WAIT_TEST = '이 프린터는 테스트 인쇄를 하고 "예"를 누른 뒤에 이 기기에서 출력할 수 있어요.'
/** 이미 출력 기기인 기기에 새 프린터를 이었다: 테스트 "예" 전에는 받지 않는다 (D-PRN2-10 · 옛 문장 '실험 중인 프린터라…' — D-UX3-19) */
export const EXPERIMENTAL_PAUSED = '새로 이은 프린터라 출력을 잠시 멈췄어요. 테스트 인쇄를 하고 "예"를 누르면 다시 출력해요.'
/** 출력 기기 칸 — 테스트 "예" 전 (D-PRN2-10 · 옛 문장 '실험 중인 프린터는…' — D-UX3-19) */
export const EXPERIMENTAL_WAIT_TEST_MINE = '이 프린터는 테스트 인쇄를 하고 "예"를 누른 뒤에 라벨을 찍어요.'
/** 출력 기기에서 실험 기종의 테스트 "예"를 누른 뒤 (D-PRN2-10, 웹과 같은 문장) */
export const EXPERIMENTAL_RESUMED = '좋아요. 멈췄던 출력을 이어서 해요.'
/** "예" 뒤 다른 까닭으로 다시 멈췄을 때 — "이어서 해요"를 지난 일로 (UX-PRN2-006, 웹과 같은 문장) */
export const TEST_CONFIRMED_PAST = '테스트 인쇄가 잘 나온 것을 확인했어요.'
