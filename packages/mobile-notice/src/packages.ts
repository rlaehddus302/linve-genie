// 알림을 열어 볼 앱 (안드로이드, SPEC ORD-13 C-01·C-03, D-SMS3-02·11). 아래에 들지 않는 앱의 알림은 내용을 열지 않고 바로 버린다.
// - 문자: 휴대폰의 **기본 문자 앱**(Telephony.Sms.getDefaultSmsPackage — 권한 없이 읽힌다) 알림만. 기본 문자 앱을 알 수 없을 때만
//   흔한 문자 앱 두 개(SMS_PACKAGES)로 대신한다. 문자 수신 권한(READ_SMS·RECEIVE_SMS)은 쓰지 않는다.
// - 앱 알림: 서버가 준 filters.bankApps의 앱만. 목록을 받기 전에는 앱 알림을 읽지 않는다(문자만).
// - 개인 대화가 섞이는 메신저(BLOCKED_PACKAGES)는 목록에 있어도 읽지 않는다(기기 쪽 안전 장치).
import type { InboxChannel } from './contract.ts'
import type { NoticeFilters } from './rules.ts'

/** 기본 문자 앱을 알 수 없을 때 대신 보는 문자 앱 — 삼성 메시지·구글 메시지 */
export const SMS_PACKAGES = Object.freeze(['com.samsung.android.messaging', 'com.google.android.apps.messaging'] as const)

/** 목록에 있어도 읽지 않는 앱 — 개인 대화가 통째로 섞여 서버에 갈 수 있다 */
export const BLOCKED_PACKAGES = Object.freeze([
  'com.kakao.talk',
  'jp.naver.line.android',
  'org.telegram.messenger',
  'com.whatsapp',
  'com.facebook.orca',
  'com.instagram.android',
  'com.discord',
  'com.nhn.android.band',
] as const)

/** 문자로 볼 앱들: 기본 문자 앱이 있으면 그것 하나, 모르면 SMS_PACKAGES */
export function smsPackagesFor(defaultSmsPackage: string | null): readonly string[] {
  return defaultSmsPackage !== null && defaultSmsPackage !== '' ? [defaultSmsPackage] : SMS_PACKAGES
}

/** 패키지 이름만 보고 정한다: 문자(SMS) · 은행 앱 알림(APP) · 열지 않음(null) */
export function channelForPackage(packageName: string, defaultSmsPackage: string | null, filters: NoticeFilters | null): InboxChannel | null {
  if ((BLOCKED_PACKAGES as readonly string[]).includes(packageName)) return null
  if (smsPackagesFor(defaultSmsPackage).includes(packageName)) return 'SMS'
  if (filters !== null && filters.bankApps.includes(packageName)) return 'APP'
  return null
}
