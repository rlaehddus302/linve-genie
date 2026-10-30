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

export const REHEARSAL_NO_LABELS = '리허설 방송은 라벨을 출력하지 않아요.'
export const NO_STATION_SHORT = '라벨이 안 나가요 · 프린터를 연결해 주세요'

/** 서버에 닿지 못했을 때 (웹과 같은 문장) */
export const NETWORK_MESSAGE = '서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.'
export const SESSION_EXPIRED_MESSAGE = '로그인이 풀렸어요. 다시 로그인해 주세요.'
/** 앱을 켤 때 서버에 닿지 못함 — 로그인이 풀린 것이 아닐 수 있다 (APP2) */
export const OFFLINE_AT_START_MESSAGE = '서버에 연결하지 못해 로그인을 확인하지 못했어요. 인터넷 연결을 확인하고 다시 확인을 눌러 주세요.'
export const LOGIN_FAILED_HINT = '아이디·비밀번호를 잊었으면 운영자에게 물어봐 주세요.'
export const LOGIN_ACCOUNT_NOTE = '계정은 운영자가 만들어 드려요. 아이디·비밀번호를 잊었으면 운영자에게 물어봐 주세요.'

/** 실시간 연결 문장 (웹 LiveNotices와 같은 뜻) */
export const LIVE_RECONNECTING = '다시 연결하는 중…'
export const LIVE_STALE = '최신으로 맞추지 못했어요. 다시 시도하는 중이에요.'
export const RETRY_NOW = '지금 다시 불러오기'

/** 콘솔 */
export const CURRENT_PRODUCT = '현재 상품'
export const NO_PRODUCTS_YET = '아직 등록한 상품이 없어요. 빠른 입력칸에 "15 핑크프릴 10000"처럼 적어 주세요.'
export const QUICK_PLACEHOLDER = '15 핑크프릴 10000'
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
export const VOICE_STOPPED_BODY = '받아쓰기 서버에 연결하지 못했어요. 상품은 빠른 입력으로 넣어 주세요.'
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

/** 자리를 비운 동안 (APP-04) */
export function awayLine(counts: { readonly labels: number; readonly claims: number; readonly voice: number }): string | null {
  const parts: string[] = []
  if (counts.labels > 0) parts.push(`라벨 ${String(counts.labels)}장`)
  if (counts.claims > 0) parts.push(`찜 ${String(counts.claims)}건`)
  if (counts.voice > 0) parts.push(`음성 ${String(counts.voice)}개`)
  return parts.length === 0 ? null : `자리를 비운 동안 ${parts.join('·')}`
}
