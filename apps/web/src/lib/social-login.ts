// 간편 로그인 (L1, SYS-01, D-L1-01~07, AC-L1-20~23): 공급자 이름·결과 문장·돌아온 주소 읽기.
// - 공급자는 카카오·네이버·구글·Apple 순서로만 보인다(Apple D-UX3-34). 서버가 켜진 공급자를 client-config의 loginProviders로 알린다.
// - 공급자에서 돌아오면 서버가 `/?login=<코드>&provider=<p>`(로그인 화면) 또는 `/settings?login=…`(설정)으로 보낸다.
//   코드·공급자는 정해진 값만 받고 정해진 문장만 보인다 — 주소의 글을 화면에 넣지 않는다(AC-L1-21).
//   보인 뒤에는 주소에서 두 값을 지운다(history.replaceState — 새로 고침해도 다시 나오지 않게).
import { isApiError } from '../api/client.ts'
import { kstDate } from './kst.ts'
import { SERVICE_NAME } from '../brand.ts'

export const LOGIN_PROVIDERS = ['kakao', 'naver', 'google', 'apple'] as const
export type LoginProvider = (typeof LOGIN_PROVIDERS)[number]

export const PROVIDER_NAMES: Readonly<Record<LoginProvider, string>> = { kakao: '카카오', naver: '네이버', google: '구글', apple: 'Apple' }

export function isLoginProvider(value: unknown): value is LoginProvider {
  return typeof value === 'string' && (LOGIN_PROVIDERS as readonly string[]).includes(value)
}

/** 켜진 공급자 목록 → 정해진 순서(카카오·네이버·구글·Apple)의 아는 공급자만 */
export function providersOf(value: unknown): LoginProvider[] {
  if (!Array.isArray(value)) return []
  return LOGIN_PROVIDERS.filter((provider) => value.includes(provider))
}

/** "카카오로 로그인" — 처음이든 아니든 같은 이름 (D-UX3-29, 사용자 지시 2026-11-05 "…로 로그인으로 전부 통일") */
export const continueLabel = (provider: LoginProvider): string => `${PROVIDER_NAMES[provider]}로 로그인`
/** "카카오로 이동하는 중…" */
export const movingLabel = (provider: LoginProvider): string => `${PROVIDER_NAMES[provider]}로 이동하는 중…`
/** 이동을 시작했는데 페이지가 떠나지 않았다 (FB1 D-FB1-08 (3)): "카카오로 가지 못했어요. 다시 눌러 주세요." */
export const stuckMessage = (provider: LoginProvider): string => `${PROVIDER_NAMES[provider]}로 가지 못했어요. 다시 눌러 주세요.`
/** 공급자 이름이 없을 때의 연결 이름 ("카카오 계정") */
export const accountLabel = (provider: LoginProvider): string => `${PROVIDER_NAMES[provider]} 계정`

/** 시작 요청이 서버 문장 없이 실패했을 때 */
export const START_FAILED = '지금 연결하지 못했어요. 잠시 뒤에 다시 해 주세요.'
export const RATE_LIMITED_MESSAGE = '로그인 시도가 너무 많아요. 10분 뒤에 다시 해 주세요.'

/** 로그인 화면에 보이는 결과 */
export const LOGIN_CODES = ['CANCELLED', 'EXPIRED', 'NOT_LINKED', 'SIGNUP', 'PROVIDER_ERROR', 'RATE_LIMITED', 'SESSION_GONE'] as const
/** 설정 "로그인 방법" 칸에 보이는 결과 */
export const SETTINGS_CODES = ['LINKED', 'LINKED_ELSEWHERE', 'ALREADY_LINKED', 'CANCELLED', 'EXPIRED', 'PROVIDER_ERROR'] as const
export type LoginResultCode = (typeof LOGIN_CODES)[number] | (typeof SETTINGS_CODES)[number]

export type ResultPlace = 'login' | 'settings'

export interface LoginResult {
  readonly code: LoginResultCode
  readonly provider: LoginProvider
}

export interface ResultMessage {
  readonly text: string
  /** 성공은 status, 그 밖은 alert */
  readonly tone: 'success' | 'error'
}

/** 결과 코드 → 화면 문장 (acceptance "결과 문장" 표 그대로) */
export function resultMessage({ code, provider }: LoginResult): ResultMessage {
  const p = PROVIDER_NAMES[provider]
  switch (code) {
    case 'CANCELLED':
      return { tone: 'error', text: `${p} 로그인을 취소했어요. 다시 하려면 버튼을 눌러 주세요.` }
    case 'EXPIRED':
      return { tone: 'error', text: '로그인 요청이 오래됐거나 다른 창에서 시작한 요청이에요. 처음부터 다시 해 주세요.' }
    case 'SIGNUP':
      return { tone: 'success', text: `${p} 계정으로 ${SERVICE_NAME}를 처음 시작해요.` }
    case 'NOT_LINKED':
      return { tone: 'error', text: `이 ${p} 계정에 연결된 ${SERVICE_NAME} 계정이 없어요. 아이디로 로그인한 뒤 설정 → 로그인 방법에서 ${p} 계정을 연결해 주세요.` }
    case 'PROVIDER_ERROR':
      return { tone: 'error', text: `${p}에서 로그인을 마치지 못했어요. 잠시 뒤에 다시 해 주세요.` }
    case 'RATE_LIMITED':
      return { tone: 'error', text: RATE_LIMITED_MESSAGE }
    case 'SESSION_GONE':
      return { tone: 'error', text: '로그인이 풀려 연결하지 못했어요. 다시 로그인한 뒤 연결해 주세요.' }
    case 'LINKED':
      return { tone: 'success', text: `${p} 계정을 연결했어요. 다음부터 "${p}로 로그인" 단추로 들어올 수 있어요.` }
    case 'LINKED_ELSEWHERE':
      return { tone: 'error', text: `이 ${p} 계정은 이미 다른 ${SERVICE_NAME} 계정에 연결돼 있어요. 다른 ${p} 계정으로 해 주세요.` }
    case 'ALREADY_LINKED':
      return { tone: 'error', text: `이미 연결한 ${p} 계정이 있어요. 바꾸려면 먼저 연결을 끊어 주세요.` }
  }
}

/** "카카오 연결을 끊었어요." */
export const unlinkedMessage = (provider: LoginProvider): string => `${PROVIDER_NAMES[provider]} 연결을 끊었어요.`

/** 끊기 확인 창 문장 */
export const unlinkQuestion = (provider: LoginProvider): string => {
  const p = PROVIDER_NAMES[provider]
  return `${p} 연결을 끊을까요? 끊으면 ${p}로 로그인할 수 없고, ${p}로 로그인해 둔 다른 기기는 로그아웃돼요. 아이디 로그인은 그대로예요.`
}

/**
 * 주소의 결과 읽기: 그 화면에서 보이는 코드이고 공급자를 알 때만. 그 밖(모르는 코드·공급자·이상한 글)은 null.
 * 로그인 화면은 경로가 `/`일 때만(설정에서 돌아온 결과는 로그인한 뒤 설정 화면이 보인다).
 */
export function parseLoginResult(pathname: string, search: string, place: ResultPlace): LoginResult | null {
  const path = pathname.replace(/\/+$/, '')
  if (place === 'login' ? path !== '' : path !== '/settings') return null
  const params = new URLSearchParams(search)
  const code = params.get('login')
  const provider = params.get('provider')
  const codes: readonly string[] = place === 'login' ? LOGIN_CODES : SETTINGS_CODES
  if (code === null || !codes.includes(code) || !isLoginProvider(provider)) return null
  return { code: code as LoginResultCode, provider }
}

/** 주소에 돌아온 결과 매개변수가 있는가 */
export function hasLoginParams(search: string): boolean {
  const params = new URLSearchParams(search)
  return params.has('login') || params.has('provider')
}

/** 주소에서 `login`·`provider`를 지운다 (기록을 늘리지 않고, 다른 값·history.state는 그대로) */
export function stripLoginParams(): void {
  const { pathname, search, hash } = window.location
  if (!hasLoginParams(search)) return
  const params = new URLSearchParams(search)
  params.delete('login')
  params.delete('provider')
  const query = params.toString()
  window.history.replaceState(window.history.state, '', `${pathname}${query === '' ? '' : `?${query}`}${hash}`)
}

/** 서버가 준 승인 주소: http(s)만 (다른 모양이면 null — 이동하지 않는다) */
export function safeAuthorizeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value, window.location.href)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

/** 시작 요청 실패 문장: 서버 문장이 있으면 그것, 없으면(네트워크·본문 없음) 정한 문장 */
export function startErrorMessage(error: unknown): string {
  if (!isApiError(error) || error.network || error.code === 'UNKNOWN' || error.code === 'NOT_JSON') return START_FAILED
  return error.message
}

/**
 * 로그인 전 화면 설정: 켜진 공급자. 세션 없이 부른다 — 공급자가 없는 서버는 401이고(L1 전과 같다) 그때는 버튼이 없다.
 * 공용 client(get)를 쓰지 않는다 — 401이 "로그인이 풀렸어요"로 바뀌지 않게.
 */
export async function fetchLoginProviders(signal?: AbortSignal): Promise<LoginProvider[]> {
  try {
    const response = await fetch('/api/client-config', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      ...(signal === undefined ? {} : { signal }),
    })
    if (!response.ok) return []
    const body = (await response.json()) as unknown
    return typeof body === 'object' && body !== null ? providersOf((body as { loginProviders?: unknown }).loginProviders) : []
  } catch {
    return []
  }
}

/** 로그인 방법 목록 (GET /api/auth/methods) */
export interface LoginMethodItem {
  readonly provider: LoginProvider
  readonly enabled: boolean
  readonly linked: boolean
  readonly label: string
  readonly linkedAt: string | null
}

export interface LoginMethods {
  readonly loginId: string
  readonly providers: readonly LoginMethodItem[]
  /** 문자로 확인한 휴대폰 번호(가린 것, D-UX3-30) — 없으면 null */
  readonly phone?: string | null
}

/** 서버 응답 → 목록 (모르는 공급자·모양이 틀린 줄은 버리고, 카카오·네이버·구글 순) */
export function methodsOf(value: unknown): LoginMethods {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const raw = Array.isArray(record.providers) ? (record.providers as unknown[]) : []
  const items: LoginMethodItem[] = []
  for (const provider of LOGIN_PROVIDERS) {
    const found = raw.find((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && (item as { provider?: unknown }).provider === provider)
    if (found === undefined) continue
    items.push({
      provider,
      enabled: found.enabled === true,
      linked: found.linked === true,
      label: typeof found.label === 'string' ? found.label : '',
      linkedAt: typeof found.linkedAt === 'string' ? found.linkedAt : null,
    })
  }
  return { loginId: typeof record.loginId === 'string' ? record.loginId : '', providers: items, phone: typeof record.phone === 'string' ? record.phone : null }
}

/** 연결한 날짜 (KST) `2026. 10. 22.` — 읽을 수 없으면 빈 글 */
export function linkedDate(value: string | null): string {
  if (value === null) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(kstDate(value))
  return m === null ? '' : `${m[1] ?? ''}. ${String(Number(m[2]))}. ${String(Number(m[3]))}.`
}

// ── 가입 (D-UX3-28) ─────────────────────────────────────────────────

// 동의 판은 없앴다 (D-UX3-29, 사용자 지시 2026-11-05 "저런 화면이 필수임?"): 간편 로그인 단추 아래 한 줄 안내(+ 이용약관·개인정보처리방침 링크)를 보고
// 단추를 누른 것으로 동의를 받고, 처음 계정이면 돌아오자마자 가입한다(서버는 그대로 agree:true와 동의 시각을 남긴다).
/** 간편 로그인 단추 아래 안내 (웹·앱 같은 문장) */
export const SOCIAL_TERMS_NOTE = `처음이면 바로 ${SERVICE_NAME} 계정이 만들어져요. 계속하면 만 14세 이상이며 이용약관과 개인정보처리방침에 동의한 것으로 봐요.`
/** 처음 계정을 만드는 동안 */
export const SIGNUP_MAKING = '계정을 만들고 있어요…'

// ── 최근 로그인 (D-UX3-28 — 사용자 지시 "최근 로그인도") ─────────────────
// 그 기기(브라우저)에서 마지막으로 로그인에 성공한 방법. 공급자 단추를 누르면 "누른 것"으로 적어 두고, 로그인된 화면이 열리면 "마지막"으로 옮긴다.

export type LastLogin = LoginProvider | 'id'
const LAST_KEY = 'livejjim:last-login'
const PENDING_KEY = 'livejjim:last-login-pending'

const isLastLogin = (value: unknown): value is LastLogin => value === 'id' || isLoginProvider(value)

export function readLastLogin(): LastLogin | null {
  try {
    const value = window.localStorage.getItem(LAST_KEY)
    return isLastLogin(value) ? value : null
  } catch {
    return null
  }
}

export function rememberLastLogin(method: LastLogin): void {
  try {
    window.localStorage.setItem(LAST_KEY, method)
    window.localStorage.removeItem(PENDING_KEY)
  } catch {
    // 저장할 수 없는 브라우저 — 표시만 없다
  }
}

/** 공급자 단추를 눌렀다 (돌아와 로그인되면 commitPendingLogin이 옮긴다) */
export function markPendingLogin(provider: LoginProvider): void {
  try {
    window.localStorage.setItem(PENDING_KEY, provider)
  } catch {
    // 표시만 없다
  }
}

/** 로그인된 화면이 열렸다: 누른 공급자가 있으면 그것을 마지막으로 */
export function commitPendingLogin(): void {
  try {
    const pending = window.localStorage.getItem(PENDING_KEY)
    if (isLoginProvider(pending)) rememberLastLogin(pending)
  } catch {
    // 표시만 없다
  }
}

/** 로그인되지 않고 로그인 화면으로 돌아왔다(취소·실패) — 누른 것을 지운다 */
export function dropPendingLogin(): void {
  try {
    window.localStorage.removeItem(PENDING_KEY)
  } catch {
    // 표시만 없다
  }
}

export const RECENT_LOGIN = '최근 로그인'

// ── 휴대폰 번호로 같은 사람 묶기 (D-UX3-30) ─────────────────────────────
// 처음 온 간편 로그인은 문자 인증을 해야 계정이 생긴다. 이미 있는 번호면 그 계정으로 다시 로그인해야 이어진다.
export const PHONE_TITLE = '휴대폰 번호를 확인할게요'
export const PHONE_BODY = '같은 사람이면 카카오·네이버·구글 어느 것으로 들어와도 한 계정으로 이어져요.'
export const ACCOUNT_PHONE_TITLE = '휴대폰 번호를 확인해 주세요'
export const ACCOUNT_PHONE_BODY = '번호를 한 번 확인해 두면 어느 간편 로그인으로 들어와도 이 계정으로 이어져요.'
export const PHONE_FIELD = '휴대폰 번호'
export const PHONE_PLACEHOLDER = '010-0000-0000'
export const PHONE_SEND = '인증번호 받기'
export const CODE_FIELD = '인증번호 6자리'
export const CODE_RESEND = '다시 받기'
export const CODE_CONFIRM = '확인'
export const PHONE_CHANGE = '번호 바꾸기'
export const START_OVER = '처음으로'
export const LOGOUT_LABEL = '로그아웃'
export const codeSentMessage = (phone: string): string => `${phone} 번호로 인증번호를 보냈어요.`
export const EXISTING_TITLE = '이미 가입한 계정이 있어요'
/** 있는 번호: 그 계정의 간편 로그인으로 다시 로그인하면 지금 공급자가 이어진다 */
export function existingBody(phone: string, providers: readonly LoginProvider[], next: LoginProvider): string {
  if (providers.length === 0) return `${phone} 번호로 가입한 계정이에요. 아이디로 로그인한 뒤 설정 → 로그인 방법에서 ${PROVIDER_NAMES[next]} 로그인을 연결해 주세요.`
  const names = providers.map((provider) => PROVIDER_NAMES[provider]).join('·')
  return `${phone} 번호로 가입한 계정이에요. ${names}로 로그인하면 ${PROVIDER_NAMES[next]}도 함께 이어져요.`
}
export const EXISTING_LOST = '예전 로그인 방법을 쓸 수 없으면 운영자에게 문의해 주세요.'
export const NOT_THAT_ACCOUNT = '이 번호로 가입한 계정에 연결된 계정이 아니에요. 위 단추로 다시 로그인해 주세요.'
export const linkedNow = (provider: LoginProvider): string => `${PROVIDER_NAMES[provider]}도 이 계정에 이었어요.`

/** 가입 중 인증번호 확인 결과 (POST /api/auth/signup/phone/verify) */
export type SignupPhoneNext =
  | { readonly next: 'SIGNUP'; readonly phone: string }
  | { readonly next: 'LOGIN_EXISTING'; readonly phone: string; readonly providers: readonly LoginProvider[]; readonly password: boolean }

export function signupPhoneNextOf(value: unknown): SignupPhoneNext | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const phone = typeof record.phone === 'string' ? record.phone : ''
  if (record.next === 'SIGNUP') return { next: 'SIGNUP', phone }
  if (record.next === 'LOGIN_EXISTING') return { next: 'LOGIN_EXISTING', phone, providers: providersOf(record.providers), password: record.password === true }
  return null
}

// 웹: 있는 번호의 계정으로 다시 로그인하러 공급자에 다녀온다 — 돌아와 로그인되면 가입 표 쿠키로 잇는다 (D-UX3-30)
const PENDING_LINK_KEY = 'livejjim:pending-link'
const LOGIN_FLASH_KEY = 'livejjim:login-flash'

export function markPendingLink(): void {
  try {
    window.sessionStorage.setItem(PENDING_LINK_KEY, '1')
  } catch {
    // 잇기만 못 한다 — 설정 → 로그인 방법에서 다시 연결할 수 있다
  }
}

/** 잇기를 기다리는지 (읽으면 지운다) */
export function takePendingLink(): boolean {
  try {
    const pending = window.sessionStorage.getItem(PENDING_LINK_KEY) === '1'
    window.sessionStorage.removeItem(PENDING_LINK_KEY)
    return pending
  } catch {
    return false
  }
}

/** 로그인 화면에 한 번 보일 문장 (다른 계정으로 들어가 로그아웃한 뒤) */
export function setLoginFlash(text: string): void {
  try {
    window.sessionStorage.setItem(LOGIN_FLASH_KEY, text)
  } catch {
    // 문장만 없다
  }
}

export function takeLoginFlash(): string | null {
  try {
    const text = window.sessionStorage.getItem(LOGIN_FLASH_KEY)
    window.sessionStorage.removeItem(LOGIN_FLASH_KEY)
    return text
  } catch {
    return null
  }
}
