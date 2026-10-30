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

export function isNativeNoticeAvailable(): boolean {
  return getNoticeIntake() !== null
}
