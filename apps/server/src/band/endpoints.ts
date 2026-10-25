// 밴드 모듈이 부를 수 있는 주소 — 읽기 일곱 개뿐 (D-BND1-01, AC-BND1-60). 이 표가 유일한 주소 목록이다.
// 모두 GET이다. 밴드에 글·댓글을 쓰거나 지우는 주소는 이 모듈에 없다. 표에 없는 이름·GET이 아닌 방식은 보내기 전에 오류다.
import type { BandSettings } from './config.ts'

export const BAND_REQUESTS = Object.freeze({
  /** 승인 창 (브라우저 이동 — 서버가 부르지 않는다) */
  authorize: Object.freeze({ host: 'auth', path: '/oauth2/authorize' }),
  /** code → 토큰 */
  token: Object.freeze({ host: 'auth', path: '/oauth2/token' }),
  profile: Object.freeze({ host: 'api', path: '/v2/profile' }),
  bands: Object.freeze({ host: 'api', path: '/v2.1/bands' }),
  posts: Object.freeze({ host: 'api', path: '/v2/band/posts' }),
  post: Object.freeze({ host: 'api', path: '/v2.1/band/post' }),
  comments: Object.freeze({ host: 'api', path: '/v2/band/post/comments' }),
} as const)

export type BandOp = keyof typeof BAND_REQUESTS

/** 부를 수 있는 (방식, 경로) — 가짜 밴드 서버·시험이 받은 요청을 이것과 맞댄다 */
export const BAND_ALLOWED_PATHS: readonly string[] = Object.freeze(Object.values(BAND_REQUESTS).map((entry) => entry.path))

export class BandRequestRefused extends Error {
  constructor() {
    super('밴드 주소 목록에 없는 요청')
    this.name = 'BandRequestRefused'
  }
}

/** 이름이 표에 있는가 (프로토타입 이름은 아니다) */
export function isBandOp(value: unknown): value is BandOp {
  return typeof value === 'string' && Object.hasOwn(BAND_REQUESTS, value)
}

/**
 * 표의 이름 → 주소. 방식은 GET만 받는다. 질의 값은 주소 부호화해서 붙인다.
 * 주소는 토큰을 실을 수 있어 로그·오류에 쓰지 않는다(D-BND1-14)
 */
export function bandRequestUrl(settings: BandSettings, op: string, method: string, query: Readonly<Record<string, string>>): URL {
  if (method !== 'GET' || !isBandOp(op)) throw new BandRequestRefused()
  const entry = BAND_REQUESTS[op]
  const url = new URL(`${entry.host === 'auth' ? settings.authUrl : settings.apiUrl}${entry.path}`)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  return url
}
