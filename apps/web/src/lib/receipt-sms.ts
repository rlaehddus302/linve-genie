// 영수증 문자 문구 (D-REAL-03 → D-REAL-05: 판매자 휴대폰 문자 앱으로 판매자 번호에서 보낸다) — 앱 ReceiptsScreen이 쓴다.
import type { ReceiptSmsState } from '../api/types.ts'
import { kstHm, kstMonthDayWeekday } from './kst.ts'

export const SMS_SEND = '문자 보내기'
export const SMS_SEND_ALL = '번호 아는 손님 모두 문자 보내기'
export const SMS_PHONE_LABEL = '손님 휴대폰 번호'
export const SMS_PHONE_HELP = '010으로 시작하는 번호를 적어 주세요. 다음에도 이 번호로 보내요.'
export const SMS_SENT = '확인서 문자를 보냈어요.'
export const SMS_NOTE = '내 휴대폰 문자 앱에 손님 번호와 확인서 링크를 채워 열어요. 보내기만 누르면 내 번호로 가요.'
export const SMS_OPEN = '문자 앱 열기'
export const SMS_UNAVAILABLE = '이 기기에서는 문자를 보낼 수 없어요. 링크 보내기로 보내 주세요.'
export const SMS_ALL_NOTE = '손님마다 문자 앱이 차례로 열려요. 보내기를 누르면 다음 손님이 바로 열리고, 닫으면 거기서 멈춰요.'

/** 줄 아래 한 줄: 보낸 적 있으면 보낸 때, 아니면 보낼 번호 끝자리, 모르면 번호를 넣어 보낼 수 있다는 말 */
export function smsWords(sms: ReceiptSmsState | null | undefined): string | null {
  if (sms === null || sms === undefined) return null
  if (sms.sentAt !== null) return `문자 보냄 · ${kstMonthDayWeekday(sms.sentAt)} ${kstHm(sms.sentAt)}`
  if (sms.last4 !== null) return `문자 보낼 번호 끝자리 ${sms.last4}`
  return '휴대폰 번호를 넣으면 문자로 보낼 수 있어요'
}

export const smsAllQuestion = (n: number): string => `${String(n)}명에게 차례로 확인서 문자를 보낼까요?`

/** 모두 보내기 중 한 줄 */
export const smsProgress = (index: number, total: number, name: string): string => `${String(index)}/${String(total)} · ${name}님 문자 앱을 여는 중`

/** 모두 보내기 결과 한 줄: 끝까지 갔거나, 닫은(못 연) 손님에서 멈춤 */
export function smsAllResult(sent: number, stoppedAt: string | null): string {
  if (stoppedAt === null) return `${String(sent)}명에게 문자를 보냈어요.`
  return `${String(sent)}명에게 보내고 ${stoppedAt}님에서 멈췄어요. 다시 누르면 이어서 보내요.`
}

/** 모두 보내기 대상: 번호를 알고 아직 보내지 않은 손님 */
export const smsTargets = <T extends { readonly buyer: string; readonly sms?: ReceiptSmsState | null }>(rows: readonly T[]): T[] => rows.filter((row) => row.sms?.last4 != null && row.sms.sentAt === null)
