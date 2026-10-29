// Expo 네이티브 모듈 묶기 — 이름 LivejjimAudio (expo-module.config.json·Kotlin·Swift와 같은 이름).
// 이 파일만 expo-modules-core를 부른다. 시험·Node에서는 불러오지 않는다(네이티브가 없으면 requireNativeModule이 예외).
import { requireNativeModule, requireOptionalNativeModule } from 'expo-modules-core'
import { createAudioCapture } from './capture.ts'
import type { AudioCapture, NativeAudioModuleLike } from './types.ts'

export const NATIVE_MODULE_NAME = 'LivejjimAudio'

/** 네이티브 모듈이 이 빌드에 들어 있는가 (시뮬레이터·웹에서는 없을 수 있다 — 없으면 음성 없이 빠른 입력만) */
export function isNativeAudioAvailable(): boolean {
  try {
    return requireOptionalNativeModule<NativeAudioModuleLike>(NATIVE_MODULE_NAME) !== null
  } catch {
    return false
  }
}

let shared: AudioCapture | undefined

/** 앱 전체가 나눠 쓰는 마이크 소리 잡기 하나 */
export function getAudioCapture(): AudioCapture {
  shared ??= createAudioCapture(requireNativeModule<NativeAudioModuleLike>(NATIVE_MODULE_NAME))
  return shared
}
