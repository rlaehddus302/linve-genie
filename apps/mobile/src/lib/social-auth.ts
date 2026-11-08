// 앱 안 간편 로그인 (D-UX3-28 — 사용자 지시 2026-11-05 "앱에서 바로 소셜로그인이 안 되고 웹으로 넘어감").
// 웹으로 넘기지 않고 앱 위에 뜨는 로그인 창(아이폰 ASWebAuthenticationSession·안드로이드 Custom Tabs — expo-web-browser openAuthSessionAsync)으로
// GET /api/auth/app/start?provider&challenge를 연다. 공급자에서 돌아오면 서버가 `livejjim://auth?ticket=…`(또는 `?login=<결과>`)로 보내 창이 닫힌다.
// 앱은 그 표와 처음에 만든 검증 값으로 POST /api/auth/app/finish를 불러 세션 쿠키를 받는다(LOGGED_IN), 처음 계정이면 SIGNUP — 판 없이 바로 POST /api/auth/signup (D-UX3-29).
// 기기 기능(로그인 창·무작위 값·SHA-256·저장소)은 app/_layout.tsx가 끼운다 — 시험은 가짜.
import { LOGIN_PROVIDERS, isLoginProvider, signupPhoneNextOf, type LastLogin, type LoginProvider, type SignupPhoneNext } from '@livejjim/web/src/lib/social-login.ts'
import { post } from '../api/client.ts'
import { absoluteUrl, apiConfig } from '../api/config.ts'

export const APP_RETURN = 'livejjim://auth'

export interface SocialNative {
  /** 앱 안 로그인 창을 열고, 돌아온 주소(닫으면 null) */
  readonly openAuthSession: (url: string, returnUrl: string) => Promise<string | null>
  /** 무작위 32바이트 → base64url */
  readonly randomVerifier: () => string
  /** SHA-256 → base64url */
  readonly sha256: (text: string) => Promise<string>
  readonly storage: { readonly getItem: (key: string) => Promise<string | null>; readonly setItem: (key: string, value: string) => Promise<void> }
}

let native: SocialNative | null = null

export function setSocialNative(next: SocialNative | null): void {
  native = next
}

/** base64 → base64url (= 없음) */
export const toBase64Url = (base64: string): string => base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** 켜진 공급자 (로그인 전 — 401은 "로그인 풀림"으로 바꾸지 않게 공용 get을 쓰지 않는다) */
export async function fetchAppLoginProviders(): Promise<LoginProvider[]> {
  try {
    const response = await apiConfig().fetch(absoluteUrl('/api/client-config'), { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } })
    if (!response.ok) return []
    const body = (await response.json()) as { loginProviders?: unknown }
    return Array.isArray(body.loginProviders) ? LOGIN_PROVIDERS.filter((p) => (body.loginProviders as unknown[]).includes(p)) : []
  } catch {
    return []
  }
}

/** 앱 로그인 한 번의 결과 */
export type AppSocialOutcome =
  | { readonly kind: 'logged_in' }
  /** 처음 계정. phoneRequired면 문자 인증부터 (D-UX3-30) */
  | { readonly kind: 'signup'; readonly provider: LoginProvider; readonly ticket: string; readonly verifier: string; readonly phoneRequired: boolean }
  | { readonly kind: 'result'; readonly code: string; readonly provider: LoginProvider }
  | { readonly kind: 'closed' }
  | { readonly kind: 'failed'; readonly message: string }

export const APP_LOGIN_FAILED = '로그인을 마치지 못했어요. 다시 해 주세요.'

/** 로그인 창을 열고 돌아온 표를 서버에 낸다 */
export async function appSocialLogin(provider: LoginProvider): Promise<AppSocialOutcome> {
  if (native === null) return { kind: 'failed', message: APP_LOGIN_FAILED }
  const verifier = native.randomVerifier()
  const challenge = await native.sha256(verifier)
  const back = await native.openAuthSession(absoluteUrl(`/api/auth/app/start?provider=${provider}&challenge=${challenge}`), APP_RETURN)
  if (back === null) return { kind: 'closed' }
  let url: URL
  try {
    url = new URL(back)
  } catch {
    return { kind: 'failed', message: APP_LOGIN_FAILED }
  }
  const returned = url.searchParams.get('provider')
  const from = isLoginProvider(returned) ? returned : provider
  const code = url.searchParams.get('login')
  if (code !== null) return { kind: 'result', code, provider: from }
  const ticket = url.searchParams.get('ticket')
  if (ticket === null) return { kind: 'failed', message: APP_LOGIN_FAILED }
  const done = await post<{ result?: unknown; phoneRequired?: unknown }>('/api/auth/app/finish', { ticket, verifier })
  if (done.result === 'SIGNUP') return { kind: 'signup', provider: from, ticket, verifier, phoneRequired: done.phoneRequired === true }
  return { kind: 'logged_in' }
}

/** 처음 계정이면 바로 가입 (D-UX3-29 — 단추 아래 안내를 보고 누른 것이 동의) */
export async function appSignup(ticket: string, verifier: string): Promise<void> {
  await post('/api/auth/signup', { agree: true, ticket, verifier })
}

// ── 휴대폰 번호 (D-UX3-30) ───────────────────────────────────────────
// 가입 표·검증 값과 함께 번호를 확인한다. 있는 번호면 그 계정으로 다시 로그인한 뒤 appSignupLink로 잇는다

/** 가입 중 인증번호 받기 → 가린 번호 */
export async function appSignupPhoneSend(ticket: string, verifier: string, phone: string): Promise<string> {
  const sent = await post<{ phone?: unknown }>('/api/auth/signup/phone', { phone, ticket, verifier })
  return typeof sent.phone === 'string' ? sent.phone : phone
}

/** 가입 중 인증번호 확인 → 새 번호(SIGNUP)인지 있는 번호(LOGIN_EXISTING)인지 */
export async function appSignupPhoneVerify(ticket: string, verifier: string, code: string): Promise<SignupPhoneNext> {
  const next = signupPhoneNextOf(await post('/api/auth/signup/phone/verify', { code, ticket, verifier }))
  if (next === null) throw new Error('알 수 없는 답')
  return next
}

/** 방금 로그인한 기존 계정에 가입 표의 간편 로그인을 잇는다 */
export async function appSignupLink(ticket: string, verifier: string): Promise<void> {
  await post('/api/auth/signup/link', { ticket, verifier })
}

/** 로그인한 계정의 번호 등록: 인증번호 받기 → 가린 번호 */
export async function accountPhoneSend(phone: string): Promise<string> {
  const sent = await post<{ phone?: unknown }>('/api/auth/phone', { phone })
  return typeof sent.phone === 'string' ? sent.phone : phone
}

export async function accountPhoneVerify(code: string): Promise<void> {
  await post('/api/auth/phone/verify', { code })
}

// ── 최근 로그인 (그 기기) ──────────────────────────────────────────────
const LAST_KEY = 'livejjim:last-login'

export async function readAppLastLogin(): Promise<LastLogin | null> {
  try {
    const value = native === null ? null : await native.storage.getItem(LAST_KEY)
    return value === 'id' || isLoginProvider(value) ? value : null
  } catch {
    return null
  }
}

export async function rememberAppLastLogin(method: LastLogin): Promise<void> {
  try {
    await native?.storage.setItem(LAST_KEY, method)
  } catch {
    // 표시만 없다
  }
}
