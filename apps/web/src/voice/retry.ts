// 음성 연결 조각(transport.ts)을 다시 받을 주소 (AC-I4-12 "다시 켤 수 있다", TE-I4-002).
// 크롬은 받지 못한 동적 import 주소를 다시 받지 않는다(요청 0번). 그래서 다시 받을 때는 빌드가 넣어 준 조각 주소에 `?retry=N`을 붙인 새 주소로 받는다.
// SRV1 (D-APP-22): 옛 음성 패키지 로더(load.ts — `@livejjim/voice` 통째 동적 import, 부르는 곳 없음)는 없앴고 이 주소 만들기만 남았다.
import { VOICE_CHUNK_PLACEHOLDER } from './chunk.ts'

/** 빌드가 채운 음성 조각 주소 (채우지 않았으면 자리 글자 그대로) */
const VOICE_CHUNK: string = VOICE_CHUNK_PLACEHOLDER

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
