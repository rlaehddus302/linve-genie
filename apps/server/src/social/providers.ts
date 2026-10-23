// 간편 로그인 공급자 (L1, SYS-01, D-L1-04·D-L1-05·D-L1-07): 구글·카카오·네이버 OAuth 2.0 인가 코드 흐름의 어댑터.
// - 공급자 주소(승인·토큰·사용자 정보)는 여기 고정값(https)이다. 운영 시작(환경 변수)에는 주소를 바꾸는 설정이 없다 —
//   주소 바꾸기는 시험·연습 기동이 ServerOptions.socialLogin.endpoints로만 한다(가짜 OAuth 서버, http는 allowInsecure일 때만).
// - 묻는 권한: 구글 `openid email`(유튜브 권한 없음 — D-L1-05), 카카오 추가 권한 없음(scope 없음), 네이버 회원 ID(scope 없음).
// - PKCE S256은 구글·카카오만, 네이버는 state만(늘 보낸다).
// - 토큰 교환·사용자 정보 조회는 각각 10초 제한. 받은 토큰은 이 요청 안에서만 쓰고 버린다(어디에도 두지 않는다).
// - 오류에는 단계(교환·사용자 정보)·HTTP 상태·종류만 담는다 — 공급자가 보낸 글·토큰·코드는 담지 않는다.

export type ProviderId = 'google' | 'kakao' | 'naver'
/** 화면·client-config 순서 (D-L1-06): 카카오·네이버·구글 */
export const PROVIDER_ORDER: readonly ProviderId[] = ['kakao', 'naver', 'google']
export const PROVIDER_NAMES: Readonly<Record<ProviderId, string>> = { google: '구글', kakao: '카카오', naver: '네이버' }
/** 세션을 만든 방법 칸의 값 */
export const PROVIDER_METHOD = { google: 'GOOGLE', kakao: 'KAKAO', naver: 'NAVER' } as const

export const isProviderId = (value: unknown): value is ProviderId => value === 'google' || value === 'kakao' || value === 'naver'

export interface ProviderEndpoints {
  readonly authUrl: string
  readonly tokenUrl: string
  readonly userInfoUrl: string
}

/** 실제 공급자 주소 (고정값) */
export const PROVIDER_ENDPOINTS: Readonly<Record<ProviderId, ProviderEndpoints>> = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
  },
  kakao: {
    authUrl: 'https://kauth.kakao.com/oauth/authorize',
    tokenUrl: 'https://kauth.kakao.com/oauth/token',
    userInfoUrl: 'https://kapi.kakao.com/v2/user/me',
  },
  naver: {
    authUrl: 'https://nid.naver.com/oauth2.0/authorize',
    tokenUrl: 'https://nid.naver.com/oauth2.0/token',
    userInfoUrl: 'https://openapi.naver.com/v1/nid/me',
  },
}

/** PKCE를 쓰는 공급자 */
export const USES_PKCE: Readonly<Record<ProviderId, boolean>> = { google: true, kakao: true, naver: false }
/** 공급자 화면에서 "취소"를 누르면 돌아오는 error 값 */
export const CANCEL_ERRORS: Readonly<Record<ProviderId, readonly string[]>> = { google: ['access_denied'], kakao: ['access_denied'], naver: ['access_denied'] }
/** 구글 로그인 권한 (유튜브 권한 없음) */
export const GOOGLE_LOGIN_SCOPE = 'openid email'
/** 공급자 호출 하나의 시간 제한 */
export const PROVIDER_TIMEOUT_MS = 10_000
/** 공급자 응답 본문 상한 */
const RESPONSE_LIMIT_BYTES = 64 * 1024

export interface ProviderClient {
  readonly clientId: string
  /** 카카오는 없을 수 있다 (카카오 앱에서 클라이언트 시크릿을 켰을 때만) */
  readonly clientSecret: string | null
}

export type SocialProviders = Partial<Record<ProviderId, ProviderClient>>

/** 시험·연습 기동만: 공급자 주소 바꾸기·http 허용·HTTP 함수·시간 제한 */
export interface SocialLoginSetup {
  readonly providers: SocialProviders
  readonly endpoints?: Partial<Record<ProviderId, ProviderEndpoints>>
  /** http:// 공급자 주소를 받는다 (가짜 OAuth 서버 — 시험·연습만) */
  readonly allowInsecure?: boolean
  readonly fetch?: typeof fetch
  /** 공급자 호출 하나의 시간 제한 (기본 10초 — 시험만 줄인다) */
  readonly timeoutMs?: number
}

// ── 운영 설정 읽기 (AC-L1-01) ─────────────────────────────────────────

export const SOCIAL_ENV = {
  google: { id: 'LIVEJJIM_LOGIN_GOOGLE_CLIENT_ID', secret: 'LIVEJJIM_LOGIN_GOOGLE_CLIENT_SECRET' },
  kakao: { id: 'LIVEJJIM_LOGIN_KAKAO_REST_API_KEY', secret: 'LIVEJJIM_LOGIN_KAKAO_CLIENT_SECRET' },
  naver: { id: 'LIVEJJIM_LOGIN_NAVER_CLIENT_ID', secret: 'LIVEJJIM_LOGIN_NAVER_CLIENT_SECRET' },
} as const

export const halfConfiguredMessage = (provider: ProviderId): string => `${PROVIDER_NAMES[provider]} 로그인 설정이 반만 적혀 있어요. 둘 다 적거나 둘 다 지워 주세요.`

export type SocialEnvResult = { readonly ok: true; readonly providers: SocialProviders } | { readonly ok: false; readonly message: string }

/**
 * 환경 변수의 간편 로그인 설정. 필요한 값이 모두 있는 공급자만 켜고, 아무것도 없으면 끈다.
 * 일부만 있으면 시작하지 않는다(구글·네이버: ID·비밀값 둘 다 / 카카오: REST API 키 필수, 시크릿 선택 — 시크릿만 있으면 멈춤). 값은 문장에 넣지 않는다.
 * 주소를 바꾸는 환경 변수는 없다(운영은 고정 주소)
 */
export function readSocialLoginEnv(env: Readonly<Record<string, string | undefined>>): SocialEnvResult {
  const get = (key: string) => env[key]?.trim() ?? ''
  const providers: { -readonly [K in ProviderId]?: ProviderClient } = {}
  for (const provider of ['google', 'kakao', 'naver'] as const) {
    const id = get(SOCIAL_ENV[provider].id)
    const secret = get(SOCIAL_ENV[provider].secret)
    if (id === '' && secret === '') continue
    if (provider === 'kakao') {
      if (id === '') return { ok: false, message: halfConfiguredMessage(provider) }
      providers[provider] = { clientId: id, clientSecret: secret === '' ? null : secret }
      continue
    }
    if (id === '' || secret === '') return { ok: false, message: halfConfiguredMessage(provider) }
    providers[provider] = { clientId: id, clientSecret: secret }
  }
  return { ok: true, providers }
}

/** 설정 확인 (서버 만들 때): 공급자 주소는 https만(시험·연습의 allowInsecure면 http도). 문제가 있으면 문장 */
export function checkSocialSetup(setup: SocialLoginSetup): string | null {
  for (const provider of enabledProviders(setup)) {
    const client = setup.providers[provider] as ProviderClient
    if (client.clientId.trim() === '' || (provider !== 'kakao' && (client.clientSecret ?? '').trim() === '')) return halfConfiguredMessage(provider)
    const endpoints = endpointsOf(setup, provider)
    for (const url of [endpoints.authUrl, endpoints.tokenUrl, endpoints.userInfoUrl]) {
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        return '간편 로그인 공급자 주소 설정을 확인해 주세요.'
      }
      if (parsed.protocol !== 'https:' && !(setup.allowInsecure === true && parsed.protocol === 'http:')) return '간편 로그인 공급자 주소는 https://로만 적을 수 있어요.'
    }
  }
  return null
}

/** 켜진 공급자 (카카오·네이버·구글 순) */
export function enabledProviders(setup: SocialLoginSetup | null | undefined): ProviderId[] {
  if (setup === null || setup === undefined) return []
  return PROVIDER_ORDER.filter((provider) => setup.providers[provider] !== undefined)
}

export function endpointsOf(setup: SocialLoginSetup, provider: ProviderId): ProviderEndpoints {
  return setup.endpoints?.[provider] ?? PROVIDER_ENDPOINTS[provider]
}

// ── 승인 주소 (AC-L1-03) ──────────────────────────────────────────────

export interface AuthorizeInput {
  readonly provider: ProviderId
  readonly clientId: string
  readonly redirectUri: string
  readonly state: string
  /** PKCE S256 challenge (구글·카카오) */
  readonly challenge: string | null
}

export function authorizeUrl(endpoints: ProviderEndpoints, input: AuthorizeInput): string {
  const url = new URL(endpoints.authUrl)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('state', input.state)
  if (input.provider === 'google') {
    url.searchParams.set('scope', GOOGLE_LOGIN_SCOPE)
    url.searchParams.set('prompt', 'select_account')
  }
  if (input.challenge !== null) {
    url.searchParams.set('code_challenge', input.challenge)
    url.searchParams.set('code_challenge_method', 'S256')
  }
  return url.toString()
}

// ── 코드 교환·사용자 정보 (AC-L1-04 6) ───────────────────────────────

export type ProviderStep = 'token' | 'userinfo'

/** 공급자 호출 실패 (단계·HTTP 상태·종류만 — 받은 글은 없다) */
export class ProviderError extends Error {
  readonly step: ProviderStep
  readonly status: number | null
  readonly kind: 'http' | 'timeout' | 'network' | 'shape' | 'invalid_grant'
  constructor(step: ProviderStep, kind: ProviderError['kind'], status: number | null = null) {
    super(`provider ${step} ${kind}`)
    this.name = 'ProviderError'
    this.step = step
    this.kind = kind
    this.status = status
  }
}

export interface ProviderProfile {
  /** 공급자 계정 ID */
  readonly id: string
  readonly email: string | null
  readonly nickname: string | null
}

/** 공급자 계정 ID 모양: 영문·숫자·`.`·`_`·`-`·`~` 1~255자 (구글 sub·카카오 회원 번호·네이버 ID) */
const PROVIDER_USER_ID_RE = /^[A-Za-z0-9._~-]{1,255}$/

export interface ExchangeInput {
  readonly provider: ProviderId
  readonly client: ProviderClient
  readonly endpoints: ProviderEndpoints
  readonly redirectUri: string
  readonly code: string
  readonly verifier: string | null
  readonly state: string
  readonly fetch: typeof fetch
  readonly timeoutMs: number
}

async function readLimited(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (reader === undefined) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > RESPONSE_LIMIT_BYTES) {
      await reader.cancel().catch(() => {})
      throw new Error('too large')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function call(step: ProviderStep, input: ExchangeInput, url: string, init: RequestInit): Promise<Record<string, unknown>> {
  let response: Response
  const signal = AbortSignal.timeout(input.timeoutMs)
  try {
    response = await input.fetch(url, { ...init, signal, redirect: 'error' })
  } catch {
    throw new ProviderError(step, signal.aborted ? 'timeout' : 'network')
  }
  let text: string
  try {
    text = await readLimited(response)
  } catch {
    throw new ProviderError(step, signal.aborted ? 'timeout' : 'shape', response.status)
  }
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = null
  }
  const record = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  if (record !== null && record.error === 'invalid_grant') throw new ProviderError(step, 'invalid_grant', response.status)
  if (!response.ok) throw new ProviderError(step, 'http', response.status)
  if (record === null) throw new ProviderError(step, 'shape', response.status)
  return record
}

/** 코드를 토큰으로 바꾸고(같은 돌아오는 주소·검증 값) 사용자 정보를 읽는다. 토큰은 돌려주지 않는다 */
export async function fetchProfile(input: ExchangeInput): Promise<ProviderProfile> {
  const form = new URLSearchParams()
  form.set('grant_type', 'authorization_code')
  form.set('client_id', input.client.clientId)
  if (input.client.clientSecret !== null) form.set('client_secret', input.client.clientSecret)
  form.set('redirect_uri', input.redirectUri)
  form.set('code', input.code)
  if (input.verifier !== null) form.set('code_verifier', input.verifier)
  if (input.provider === 'naver') form.set('state', input.state)
  const token = await call('token', input, input.endpoints.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8', Accept: 'application/json' },
    body: form.toString(),
  })
  // 네이버는 실패도 200으로 { error } — 토큰이 없으면 실패
  const accessToken = token.access_token
  if (typeof accessToken !== 'string' || accessToken === '' || accessToken.length > 4096) throw new ProviderError('token', 'shape')
  const info = await call('userinfo', input, input.endpoints.userInfoUrl, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } })
  const profile = parseProfile(input.provider, info)
  if (profile === null) throw new ProviderError('userinfo', 'shape')
  return profile
}

const optionalText = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null)

/** 공급자마다 사용자 정보 모양 (구글 userinfo sub·email · 카카오 /v2/user/me id·kakao_account.email·profile.nickname · 네이버 /v1/nid/me response.id·email·nickname) */
export function parseProfile(provider: ProviderId, body: Readonly<Record<string, unknown>>): ProviderProfile | null {
  const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {})
  let id: unknown
  let email: unknown
  let nickname: unknown = null
  if (provider === 'google') {
    id = body.sub
    email = body.email
  } else if (provider === 'kakao') {
    id = typeof body.id === 'number' && Number.isSafeInteger(body.id) && body.id >= 0 ? String(body.id) : body.id
    const account = record(body.kakao_account)
    email = account.email
    nickname = record(account.profile).nickname ?? record(body.properties).nickname
  } else {
    if (body.resultcode !== undefined && body.resultcode !== '00') return null
    const response = record(body.response)
    id = response.id
    email = response.email
    nickname = response.nickname
  }
  if (typeof id !== 'string' || !PROVIDER_USER_ID_RE.test(id)) return null
  return { id, email: optionalText(email), nickname: optionalText(nickname) }
}
