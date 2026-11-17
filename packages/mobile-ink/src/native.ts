// Expo 네이티브 모듈 묶기 — 이름 LivejjimInk (expo-module.config.json·Swift·Kotlin과 같은 이름).
// 이 파일만 expo-modules-core를 부른다. 모듈이 없는 빌드(이 모듈 전 앱·Expo Go·웹·시험)에서는 null — [손글씨] 단추를 숨긴다.
import { requireOptionalNativeModule } from 'expo-modules-core'
import { NATIVE_MODULE_NAME, type InkNative } from './index.ts'

export function getInk(): InkNative | null {
  try {
    return requireOptionalNativeModule<InkNative>(NATIVE_MODULE_NAME)
  } catch {
    return null
  }
}
