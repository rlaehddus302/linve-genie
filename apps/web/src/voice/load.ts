// 음성 패키지를 불러오는 유일한 곳 (AC-I4-04, VOC-05, D-I4-09).
// 콘솔은 "음성 켜기"를 누를 때만 이 함수를 부른다 — 첫 화면 조각에 음성 코드가 들어가지 않고, 누르기 전에는 음성 코드를 받지 않는다.
// 다른 파일은 음성 패키지의 타입만 쓴다(`import type`).
import type * as Voice from '@livejjim/voice'
import { VOICE_CHUNK_PLACEHOLDER } from './chunk.ts'

export type VoiceModule = typeof Voice

/** 빌드가 채운 음성 조각 주소 (채우지 않았으면 자리 글자 그대로) */
const VOICE_CHUNK: string = VOICE_CHUNK_PLACEHOLDER

let pending: Promise<VoiceModule> | null = null
/** 받지 못한 횟수 — 다시 받을 때마다 주소를 바꾼다 */
let failures = 0

/**
 * 음성 모듈. 한 번 받으면 다시 받지 않는다. 받지 못했으면 다음에 다시 받는다(dev-notes 정한 것 8).
 * 크롬은 받지 못한 모듈 주소를 실패로 기억해 같은 주소의 import를 다시 받지 않는다(요청 0번). 그래서 다시 받을 때는 빌드가 넣어 준 음성 조각 주소에
 * `?retry=N`을 붙인 새 주소로 받는다(TE-I4-002). 그 주소가 없으면(개발 서버·시험) 같은 import를 다시 부른다.
 */
export function loadVoice(): Promise<VoiceModule> {
  if (pending === null) {
    const again = failures > 0 ? retryAddress(failures) : null
    const loading = again === null ? import('@livejjim/voice') : (import(/* @vite-ignore */ again) as Promise<VoiceModule>)
    pending = loading.catch((error: unknown) => {
      failures++
      pending = null
      throw error
    })
  }
  return pending
}

/**
 * 다시 받을 음성 조각 주소: 조각 주소(base — 이 코드가 든 조각의 주소에서 푼다)에 `retry=N`을 붙인다. 조각 주소가 `.js` 파일이 아니면(빌드가 채우지 않음) null.
 * 다른 출처의 주소는 만들지 않는다(빌드가 넣는 값은 같은 폴더의 상대 주소다).
 */
export function retryAddress(attempt: number, chunk: string = VOICE_CHUNK, base: string = import.meta.url): string | null {
  let url: URL
  try {
    url = new URL(chunk, base)
  } catch {
    return null
  }
  if (url.origin !== new URL(base).origin || !url.pathname.endsWith('.js')) return null
  url.searchParams.set('retry', String(attempt))
  return url.href
}
