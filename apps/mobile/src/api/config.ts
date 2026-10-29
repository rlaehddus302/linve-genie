// 서버 주소와 가져오기 함수 (APP-01 AC2: 받아쓰기 서버 주소·토큰 같은 비밀은 여기에도, 앱 어디에도 없다 — 라이브지니 서버 주소 하나뿐).
// 주소는 빌드 때 EXPO_PUBLIC_SERVER_URL(eas.json의 profile마다)로 넣고, 없으면 개발 서버(localhost:3000)다.
// 시험·개발은 configureApi로 fetch와 주소를 바꿔 넣는다.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface ApiConfig {
  /** 라이브지니 서버 주소 (끝에 '/' 없음) */
  baseUrl: string
  /** 가져오기 함수 (앱은 expo/fetch — 스트리밍 응답이 된다, 시험은 가짜) */
  fetch: FetchLike
  /** 요청 번호 만들기 (앱은 expo-crypto randomUUID) */
  newId: () => string
}

const DEFAULT_SERVER_URL = 'http://localhost:3000'

function fallbackId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID !== undefined) return c.randomUUID()
  // randomUUID가 없는 환경(일부 시험 환경): 시각 + 난수 — 서버 형식(영문·숫자·'-' 1~64자)에 맞는다
  return `m-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffffff).toString(36)}`
}

function readEnvUrl(): string {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  const raw = env?.['EXPO_PUBLIC_SERVER_URL']
  return raw === undefined || raw.trim() === '' ? DEFAULT_SERVER_URL : raw.trim().replace(/\/+$/, '')
}

const config: ApiConfig = {
  baseUrl: readEnvUrl(),
  fetch: (input, init) => globalThis.fetch(input, init),
  newId: fallbackId,
}

export function configureApi(patch: Partial<ApiConfig>): void {
  Object.assign(config, patch)
}

export function apiConfig(): Readonly<ApiConfig> {
  return config
}

/** `/api/...` 경로 → 절대 주소 */
export function absoluteUrl(path: string): string {
  return path.startsWith('http://') || path.startsWith('https://') ? path : `${config.baseUrl}${path}`
}

/** 앱 안 "웹으로 열기"가 여는 웹 화면 주소 (같은 서버 — 로그인 쿠키는 기기 브라우저의 것이라 다시 로그인할 수 있다) */
export function webUrl(path: string): string {
  return absoluteUrl(path)
}
