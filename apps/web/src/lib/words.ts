// 화면 낱말 (UX-01, D-088, AC-S05-70). 엔진 영어 값은 이 표의 낱말로만 보인다.
import type { ClaimOrigin, ClaimReason, ClaimStatus, ProductStatus } from '@livejjim/core'

export const PRODUCT_STATUS_WORD: Readonly<Record<ProductStatus, string>> = {
  READY: '공개 전',
  OPEN: '판매 중',
  SOLD: '판매 완료',
  HOLD: '일시 중지',
  CLOSED: '판매 종료',
}

export const REJECT_REASON_WORD: Readonly<Record<ClaimReason, string>> = {
  BLOCKED: '차단',
  // 보류 찜의 사유(상품이 아직 공개되지 않음) — 거절에는 쓰이지 않는다
  UNOPENED: '보류',
  NOT_ON_SALE: '판매 중 아님',
  SOLD_OUT: '품절',
  EXPIRED: '만료',
  WAITLIST_CLEARED: '대기 정리',
  BY_HOST: '무효',
  RENUMBERED: '번호 바뀜',
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

export const ORIGIN_WORD: Readonly<Record<ClaimOrigin, string>> = {
  chat: '채팅',
  sms: '문자찜',
  assign: '직접 배정',
  convert: '메시지 변환',
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

/** 채팅 표시 낱말 (D-088) */
export const CHAT_WORD = {
  order: '주문',
  cancel: '취소',
  mention: '언급',
  owner: '방송자',
} as const

/** 조치자 낱말: 로그인 아이디 · 서버 · 수집기 */
export function actorWord(actor: { readonly kind: string; readonly loginId: string | null }): string {
  if (actor.kind === 'account') return actor.loginId ?? '판매자'
  if (actor.kind === 'collector') return '수집기'
  return '서버'
}

/** 조치 기록의 조치 낱말 (AC-S05-35) */
export function actionWord(type: string, fields: Readonly<Record<string, unknown>>): string {
  switch (type) {
    case 'product.register':
      return '등록'
    case 'product.open':
      return '판매 시작'
    case 'product.hold':
      return '일시 중지'
    case 'product.close':
      return '판매 종료'
    case 'product.update':
      return '고치기'
    case 'product.renumber':
      return '번호 변경'
    case 'host.cancel':
      return '취소'
    case 'host.reject':
      return '무효'
    case 'host.promote':
      return '1등으로'
    case 'host.confirm':
      return '확인(잠금)'
    case 'host.approveCancel':
      return '취소 승인'
    case 'host.dismissCancel':
      return '요청 무시'
    case 'host.assign':
      return typeof fields.replace === 'string' ? '직접 배정(교체)' : '직접 배정'
    case 'host.reopen':
      return '다시 판매(대기자 정리)'
    case 'host.resolveConflict':
      return fields.decision === 'SWITCH' ? '충돌 결정: 바꾸기' : '충돌 결정: 그대로 유지'
    case 'host.convertMessage':
      return '메시지를 찜으로'
    case 'host.blockBuyer':
      return '차단'
    case 'host.unblockBuyer':
      return '차단 풀기'
    default:
      return '조치'
  }
}

/** 생성기가 멈춘 까닭 */
export function stopReasonWord(reason: 'completed' | 'stopped' | 'ended' | 'shutdown' | null): string {
  switch (reason) {
    case 'completed':
      return '다 보냈어요'
    case 'stopped':
      return '멈췄어요'
    case 'ended':
      return '방송을 끝내서 멈췄어요'
    case 'shutdown':
      return '서버가 다시 시작해서 멈췄어요'
    default:
      return '멈춤'
  }
}

/** 빠른 사유 (AC-S05-34) */
export const QUICK_REASONS: readonly string[] = ['시청자 요청', '장난 찜', '번호 착오', '입금 안 함']
