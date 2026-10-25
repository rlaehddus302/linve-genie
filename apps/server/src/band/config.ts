// 밴드 연동 설정 (D-BND1-13, AC-BND1-10). 서버 시작 때 한 번 읽는다.
// 환경변수(비밀값 *): LIVEJJIM_BAND_CLIENT_ID, LIVEJJIM_BAND_CLIENT_SECRET*, LIVEJJIM_BAND_REDIRECT_URI,
//   주소 덮어쓰기 LIVEJJIM_BAND_AUTH_URL·LIVEJJIM_BAND_API_URL(시험·스테이징용 — 기본 https://auth.band.us·https://openapi.band.us).
// - 필수 셋 중 하나라도 비면 밴드는 NOT_CONFIGURED이고 서버는 정상으로 시작한다.
// - 세 주소는 https://만(내 컴퓨터 시험 주소 http://localhost·127.0.0.1·[::1]은 포트가 있어도 허용). 틀리면 설정 없음 + 로그 코드 BAND_CONFIG_INVALID(값 없이).
// - 실제 밴드는 이 변수가 있을 때만 부른다. 오류 문장·로그에 값을 넣지 않는다.

export const BAND_AUTH_URL = 'https://auth.band.us'
export const BAND_API_URL = 'https://openapi.band.us'

/** 바깥 요청 하나의 시간 제한 (D-BND1-08 — 10초 안에 답이 없으면 실패) */
export const BAND_REQUEST_TIMEOUT_MS = 10_000

export interface BandSettings {
  readonly clientId: string
  /** 비밀값 */
  readonly clientSecret: string
  /** 밴드 승인 뒤 돌아오는 이 서버의 공개 주소 (끝에 / 없이). 실제 돌아오는 주소 = 이 주소 + /<한 번 쓰는 표> */
  readonly redirectUri: string
  /** 끝에 / 없이 */
  readonly authUrl: string
  readonly apiUrl: string
  readonly timeoutMs: number
}

export type BandConfigResult = { readonly settings: BandSettings | null; readonly warning?: 'BAND_CONFIG_INVALID' }

const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]'])

/** https 주소이거나 내 컴퓨터 시험 주소(http://localhost·127.0.0.1·[::1], 포트 있어도)인가 */
export function secureBandUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return false
  if (url.protocol === 'https:') return url.hostname !== ''
  return url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)
}

const trimSlash = (value: string): string => value.replace(/\/+$/, '')

/** 환경변수로 밴드 설정을 읽는다 (없으면 settings null — 서버는 정상으로 시작한다) */
export function readBandConfig(env: Readonly<Record<string, string | undefined>>): BandConfigResult {
  const get = (name: string) => env[name]?.trim() ?? ''
  const clientId = get('LIVEJJIM_BAND_CLIENT_ID')
  const clientSecret = get('LIVEJJIM_BAND_CLIENT_SECRET')
  const redirectUri = get('LIVEJJIM_BAND_REDIRECT_URI')
  if (clientId === '' || clientSecret === '' || redirectUri === '') return { settings: null }
  const authUrl = get('LIVEJJIM_BAND_AUTH_URL') || BAND_AUTH_URL
  const apiUrl = get('LIVEJJIM_BAND_API_URL') || BAND_API_URL
  if (![redirectUri, authUrl, apiUrl].every(secureBandUrl)) return { settings: null, warning: 'BAND_CONFIG_INVALID' }
  return { settings: { clientId, clientSecret, redirectUri: trimSlash(redirectUri), authUrl: trimSlash(authUrl), apiUrl: trimSlash(apiUrl), timeoutMs: BAND_REQUEST_TIMEOUT_MS } }
}

/** 시험·E2E용: 값으로 설정을 만든다 (빠진 것은 기본값) */
export function bandSettings(input: Partial<BandSettings> & Pick<BandSettings, 'clientId' | 'clientSecret' | 'redirectUri'>): BandSettings {
  return { authUrl: BAND_AUTH_URL, apiUrl: BAND_API_URL, timeoutMs: BAND_REQUEST_TIMEOUT_MS, ...input, redirectUri: trimSlash(input.redirectUri) }
}
