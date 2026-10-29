// 네이티브 모듈 고르기. 실제 모듈(packages/mobile-audio·packages/mobile-ble, dev-device)이 들어오면 여기서 바꿔 끼운다 —
// 화면·저장소는 이 파일의 함수만 부른다. TODO(APP2 device): 실제 모듈이 준비되면 가짜 대신 잇는다.
import { FakeNativeAudio, type NativeAudio } from './audio.ts'
import { FakeBlePrinter, type NativeBlePrinter } from './ble.ts'

let audio: NativeAudio | null = null
let ble: NativeBlePrinter | null = null

export function nativeAudio(): NativeAudio {
  audio ??= new FakeNativeAudio()
  return audio
}

export function nativeBle(): NativeBlePrinter {
  ble ??= new FakeBlePrinter()
  return ble
}

/** 시험·개발: 다른 구현을 끼운다 */
export function setNativeModules(modules: { readonly audio?: NativeAudio; readonly ble?: NativeBlePrinter }): void {
  if (modules.audio !== undefined) audio = modules.audio
  if (modules.ble !== undefined) ble = modules.ble
}

/** 지금 쓰는 마이크 모듈이 가짜인가 (화면의 "시험: 말 흉내" 단추) */
export function isFakeAudio(): boolean {
  return nativeAudio() instanceof FakeNativeAudio
}
