// 빌드 스위치 읽기 (app.config.js의 extra). 값이 없으면(시험·옛 빌드) 켜진 것으로 본다 — 명시적으로 'off'일 때만 숨긴다.
import Constants from 'expo-constants'

/** 휴대폰 알림 받기(문자찜·입금 알림 읽기)가 이 빌드에 들어 있나 (LIVEGENIE_NOTICE) */
export function phoneNoticeBuilt(): boolean {
  const extra = Constants.expoConfig?.extra as { readonly noticeIntake?: unknown } | undefined
  return extra?.noticeIntake !== 'off'
}

/** 문자 직접 받기(문자 저장소 읽기·새 문자 수신, SMS4)가 이 빌드에 들어 있나 (LIVEGENIE_SMS) — 명시적으로 'on'일 때만 (기본 off, Play SMS 권한 정책) */
export function phoneSmsBuilt(): boolean {
  const extra = Constants.expoConfig?.extra as { readonly smsIntake?: unknown } | undefined
  return extra?.smsIntake === 'on'
}
