// 앱 시작 시 실제 네이티브 모듈을 연결한다. 시험만 명시적으로 가짜를 주입한다.
import { type NativeAudio } from './audio.ts'
import { type NativeBlePrinter } from './ble.ts'
import { shareLabelImage, type ShareLabelImage } from './share.ts'

let audio: NativeAudio | null = null
let ble: NativeBlePrinter | null = null
let share: ShareLabelImage = shareLabelImage

export function nativeShare(): ShareLabelImage {
  return share
}

export function nativeAudio(): NativeAudio {
  if (audio === null) throw new Error('네이티브 음성 모듈을 초기화하지 않았어요')
  return audio
}

export function nativeBle(): NativeBlePrinter {
  if (ble === null) throw new Error('네이티브 프린터 모듈을 초기화하지 않았어요')
  return ble
}

/** 시험·개발: 다른 구현을 끼운다 */
export function setNativeModules(modules: { readonly audio?: NativeAudio; readonly ble?: NativeBlePrinter; readonly share?: ShareLabelImage }): void {
  if (modules.audio !== undefined) audio = modules.audio
  if (modules.ble !== undefined) ble = modules.ble
  if (modules.share !== undefined) share = modules.share
}
