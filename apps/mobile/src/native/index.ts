// 앱 시작 시 실제 네이티브 모듈을 연결한다. 시험만 명시적으로 가짜를 주입한다.
import { type NativeAudio } from './audio.ts'
import { type NativeBlePrinter } from './ble.ts'
import type { WebSession } from '@livejjim/mobile-websession'
import { shareFile, shareLabelImage, type ShareFile, type ShareLabelImage } from './share.ts'
import { deviceSms, type NativeSms } from './sms.ts'

let audio: NativeAudio | null = null
let ble: NativeBlePrinter | null = null
let share: ShareLabelImage = shareLabelImage
let file: ShareFile = shareFile
let sms: NativeSms = deviceSms
/** 앱 안 웹 화면 세션 지키기 (EP1 D-EP1-17) — undefined면 처음 부를 때 네이티브 모듈을 찾는다(없으면 null) */
let webSession: WebSession | null | undefined

export function nativeShare(): ShareLabelImage {
  return share
}

export function nativeShareFile(): ShareFile {
  return file
}

/** 판매자 휴대폰 문자 앱 (D-REAL-05) */
export function nativeSms(): NativeSms {
  return sms
}

export function nativeAudio(): NativeAudio {
  if (audio === null) throw new Error('네이티브 음성 모듈을 초기화하지 않았어요')
  return audio
}

export function nativeBle(): NativeBlePrinter {
  if (ble === null) throw new Error('네이티브 프린터 모듈을 초기화하지 않았어요')
  return ble
}

/** 앱 안 웹 화면 세션 지키기 (아이폰 네이티브 — 안드로이드·시험은 null). 네이티브 모듈은 부를 때 불러온다(시험이 expo 모듈을 끌어오지 않게) */
export async function nativeWebSession(): Promise<WebSession | null> {
  if (webSession === undefined) {
    try {
      webSession = (await import('@livejjim/mobile-websession/native')).getWebSession()
    } catch {
      webSession = null
    }
  }
  return webSession
}

/** 시험·개발: 다른 구현을 끼운다 */
export function setNativeModules(modules: { readonly audio?: NativeAudio; readonly ble?: NativeBlePrinter; readonly share?: ShareLabelImage; readonly shareFile?: ShareFile; readonly sms?: NativeSms; readonly webSession?: WebSession | null }): void {
  if (modules.webSession !== undefined) webSession = modules.webSession
  if (modules.audio !== undefined) audio = modules.audio
  if (modules.ble !== undefined) ble = modules.ble
  if (modules.share !== undefined) share = modules.share
  if (modules.shareFile !== undefined) file = modules.shareFile
  if (modules.sms !== undefined) sms = modules.sms
}
