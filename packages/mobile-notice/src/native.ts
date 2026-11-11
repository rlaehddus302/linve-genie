// Expo 네이티브 모듈 묶기 — 이름 LivejjimNotice (expo-module.config.json·Kotlin·Swift와 같은 이름).
// 이 파일만 expo-modules-core를 부른다. 시험·Node에서는 불러오지 않는다.
// 모듈이 없는 빌드(Expo Go·웹)에서는 null — 화면이 안내를 보이고 가짜 성공으로 바꾸지 않는다(가짜는 './fake'를 명시적으로 넣을 때만).
import { requireOptionalNativeModule } from 'expo-modules-core'
import { createNoticeIntake } from './notice.ts'
import type { NativeNoticeModuleLike, NoticeIntake } from './types.ts'

export const NATIVE_MODULE_NAME = 'LivejjimNotice'

let shared: NoticeIntake | null | undefined

/** 이 빌드에 네이티브 모듈이 있으면 앱 전체가 나눠 쓰는 받기 하나, 없으면 null */
export function getNoticeIntake(): NoticeIntake | null {
  if (shared !== undefined) return shared
  let native: NativeNoticeModuleLike | null
  try {
    native = requireOptionalNativeModule<NativeNoticeModuleLike>(NATIVE_MODULE_NAME)
  } catch {
    native = null
  }
  shared = native === null ? null : createNoticeIntake(native)
  return shared
}

/**
 * 연락처 접근 묻기 (아이폰, D-SMS-CONTACT) — 연락처에 저장한 손님이라 단축어가 이름만 넘긴 문자를 그 손님 휴대폰 번호로 바꾸는 데만 쓴다.
 * 처음이면 시스템 창이 뜨고, 이미 정했으면 묻지 않는다. 모듈이 없거나 옛 모듈이면 'unavailable'
 */
export async function requestNoticeContacts(): Promise<string> {
  try {
    const native = requireOptionalNativeModule<NativeNoticeModuleLike>(NATIVE_MODULE_NAME)
    if (native === null || typeof native.requestContacts !== 'function') return 'unavailable'
    return await native.requestContacts()
  } catch {
    return 'unavailable'
  }
}

export function isNativeNoticeAvailable(): boolean {
  return getNoticeIntake() !== null
}
