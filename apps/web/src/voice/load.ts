// 음성 패키지를 불러오는 유일한 곳 (AC-I4-04, VOC-05, D-I4-09).
// 콘솔은 "음성 켜기"를 누를 때만 이 함수를 부른다 — 첫 화면 조각에 음성 코드가 들어가지 않고, 누르기 전에는 음성 코드를 받지 않는다.
// 다른 파일은 음성 패키지의 타입만 쓴다(`import type`).
import type * as Voice from '@livejjim/voice'

export type VoiceModule = typeof Voice

let pending: Promise<VoiceModule> | null = null

/** 음성 모듈 (한 번 받으면 다시 받지 않는다. 받지 못했으면 다음에 다시 시도한다) */
export function loadVoice(): Promise<VoiceModule> {
  if (pending === null) {
    pending = import('@livejjim/voice').catch((error: unknown) => {
      pending = null
      throw error
    })
  }
  return pending
}
