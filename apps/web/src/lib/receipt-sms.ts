// 영수증 문자 문구 (D-REAL-03) — 앱 ReceiptsScreen·웹 ReceiptsPage가 같이 쓴다.
import type { ReceiptSmsState } from '../api/types.ts'
import { kstHm, kstMonthDayWeekday } from './kst.ts'

export const SMS_SEND = '문자 보내기'
export const SMS_SEND_ALL = '번호 아는 손님 모두 문자 보내기'
export const SMS_PHONE_LABEL = '손님 휴대폰 번호'
export const SMS_PHONE_HELP = '010으로 시작하는 번호를 적어 주세요. 다음에도 이 번호로 보내요.'
export const SMS_SENT = '확인서 문자를 보냈어요.'
export const SMS_NOTE = '확인서 링크를 문자로 보내요. 손님은 로그인 없이 14일 동안 열어 볼 수 있어요.'

/** 줄 아래 한 줄: 보낸 적 있으면 보낸 때, 아니면 보낼 번호 끝자리, 모르면 번호를 넣어 보낼 수 있다는 말 */
export function smsWords(sms: ReceiptSmsState | null | undefined): string | null {
  if (sms === null || sms === undefined) return null
  if (sms.sentAt !== null) return `문자 보냄 · ${kstMonthDayWeekday(sms.sentAt)} ${kstHm(sms.sentAt)}`
  if (sms.last4 !== null) return `문자 보낼 번호 끝자리 ${sms.last4}`
  return '휴대폰 번호를 넣으면 문자로 보낼 수 있어요'
}

export const smsConfirmQuestion = (name: string, last4: string): string => `${name}님(끝자리 ${last4})에게 확인서 문자를 보낼까요?`
export const smsAllQuestion = (n: number): string => `${String(n)}명에게 확인서 문자를 보낼까요?`

/** 모두 보내기 결과 한 줄 */
export function smsAllResult(sent: number, failed: number): string {
  if (failed === 0) return `${String(sent)}명에게 문자를 보냈어요.`
  return `${String(sent)}명에게 보냈고, ${String(failed)}명은 보내지 못했어요. 그 손님은 줄에서 다시 눌러 주세요.`
}

/** 모두 보내기 대상: 번호를 알고 아직 보내지 않은 손님 */
export const smsTargets = <T extends { readonly buyer: string; readonly sms?: ReceiptSmsState | null }>(rows: readonly T[]): T[] => rows.filter((row) => row.sms?.last4 != null && row.sms.sentAt === null)
