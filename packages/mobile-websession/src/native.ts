// Expo 네이티브 모듈 묶기 — 이름 LivejjimWebSession (expo-module.config.json·Swift와 같은 이름).
// 이 파일만 expo-modules-core를 부른다. 모듈이 없는 빌드(안드로이드·Expo Go·웹·시험)에서는 null — 화면은 세션 지키기 없이 그대로 돈다.
import { requireOptionalNativeModule } from 'expo-modules-core'
import { NATIVE_MODULE_NAME, type WebSession } from './index.ts'

export function getWebSession(): WebSession | null {
  try {
    return requireOptionalNativeModule<WebSession>(NATIVE_MODULE_NAME)
  } catch {
    return null
  }
}
