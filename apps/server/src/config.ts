// 서버 설정 (AC-S00-07, AC-S00-42, AC-S04-20). 환경변수: PORT, DATABASE_URL 또는 LIVEJJIM_PGLITE_DIR, LIVEJJIM_MASTER_KEY, LIVEJJIM_APP_ORIGIN, LIVEJJIM_BACKUP_DIR(I2).
// 오류 메시지에 환경변수 값을 넣지 않는다(기동 로그에 값을 찍지 않는다).

export const DEFAULT_PORT = 3000

export type PortSetting =
  | { readonly ok: true; readonly port: number; readonly fromEnv: boolean }
  | { readonly ok: false; readonly message: string }

/** PORT가 없거나 빈 문자열이면 기본값. 있으면 1~65535 사이의 10진 정수여야 한다. */
export function readPort(env: Readonly<Record<string, string | undefined>>): PortSetting {
  const raw = env['PORT']
  if (raw === undefined || raw === '') return { ok: true, port: DEFAULT_PORT, fromEnv: false }
  const port = /^[0-9]{1,5}$/.test(raw) ? Number(raw) : Number.NaN
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, message: 'PORT는 1부터 65535 사이의 정수여야 해요.' }
  }
  return { ok: true, port, fromEnv: true }
}

// ── S04: DB·마스터 키·앱 주소 (AC-S04-20·32·41) ─────────────────────────────

export type DatabaseSetting =
  | { readonly ok: true; readonly kind: 'postgres'; readonly url: string }
  | { readonly ok: true; readonly kind: 'pglite'; readonly dir: string }
  | { readonly ok: false; readonly message: string }

/**
 * DB 연결 설정. 운영은 DATABASE_URL(PostgreSQL)이 필수다. 개발용 파일 PGlite는 LIVEJJIM_PGLITE_DIR로 명시적으로 고를 때만 쓴다.
 * 둘 다 없으면 시작하지 않는다 — 메모리 DB로 조용히 바꾸지 않는다(재시작하면 판매 기록이 사라진다). 값은 문장에 넣지 않는다.
 */
export function readDatabaseSetting(env: Readonly<Record<string, string | undefined>>): DatabaseSetting {
  const url = env['DATABASE_URL']?.trim() ?? ''
  const dir = env['LIVEJJIM_PGLITE_DIR']?.trim() ?? ''
  if (url !== '' && dir !== '') return { ok: false, message: 'DATABASE_URL과 LIVEJJIM_PGLITE_DIR 중 하나만 적어 주세요.' }
  if (url !== '') {
    if (!/^postgres(?:ql)?:\/\//.test(url)) return { ok: false, message: 'DATABASE_URL은 postgres://로 시작해야 해요.' }
    return { ok: true, kind: 'postgres', url }
  }
  if (dir !== '') return { ok: true, kind: 'pglite', dir }
  return {
    ok: false,
    message: '데이터베이스 연결 설정이 없어요. 운영은 DATABASE_URL을, 개발용 파일 데이터베이스는 LIVEJJIM_PGLITE_DIR을 적어 주세요.',
  }
}

export type OriginSetting = { readonly ok: true; readonly origin: string } | { readonly ok: false; readonly message: string }

/** 화면 앱 주소 (상태를 바꾸는 요청의 Origin 검사). 경로 없는 http(s) 주소만 받는다 */
export function readAppOrigin(env: Readonly<Record<string, string | undefined>>): OriginSetting {
  const origin = env['LIVEJJIM_APP_ORIGIN']?.trim() ?? ''
  if (origin === '') return { ok: false, message: '화면 앱 주소(LIVEJJIM_APP_ORIGIN)가 없어요.' }
  if (!/^https?:\/\/[^/\s]+$/.test(origin)) return { ok: false, message: '화면 앱 주소(LIVEJJIM_APP_ORIGIN)는 https://example.com 처럼 경로 없이 적어 주세요.' }
  return { ok: true, origin }
}

// ── Y1: 유튜브 연동 (AC-Y1-72, D-Y02·D-Y13) ───────────────────────────────

export interface YoutubeEnvSetting {
  readonly clientId: string
  readonly clientSecret: string
  readonly redirectUri: string
  readonly returnUrl: string
  readonly endpoints: { readonly authUrl: string; readonly tokenUrl: string; readonly revokeUrl: string; readonly apiBase: string }
  readonly quota: { readonly limit?: number; readonly sellerBudget?: number }
}

export type YoutubeSetting = { readonly ok: true; readonly youtube: YoutubeEnvSetting | null } | { readonly ok: false; readonly message: string }

/**
 * 유튜브 연동 설정. LIVEJJIM_GOOGLE_CLIENT_ID가 없으면 연동하지 않는다(그 서버의 유튜브 API는 503).
 * 있으면 비밀·돌아오는 주소가 필요하고, 모든 바깥 주소는 https://만 받는다(아니면 시작하지 않는다). 값은 문장에 넣지 않는다
 */
export function readYoutubeSetting(env: Readonly<Record<string, string | undefined>>, appOrigin: string): YoutubeSetting {
  const get = (key: string) => env[key]?.trim() ?? ''
  const clientId = get('LIVEJJIM_GOOGLE_CLIENT_ID')
  if (clientId === '') return { ok: true, youtube: null }
  const clientSecret = get('LIVEJJIM_GOOGLE_CLIENT_SECRET')
  const redirectUri = get('LIVEJJIM_GOOGLE_REDIRECT_URI')
  if (clientSecret === '' || redirectUri === '') return { ok: false, message: '유튜브 연동에는 LIVEJJIM_GOOGLE_CLIENT_SECRET과 LIVEJJIM_GOOGLE_REDIRECT_URI가 필요해요.' }
  const returnUrl = get('LIVEJJIM_YOUTUBE_RETURN_URL') || `${appOrigin}/settings/youtube`
  const endpoints = {
    authUrl: get('LIVEJJIM_GOOGLE_AUTH_URL') || 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: get('LIVEJJIM_GOOGLE_TOKEN_URL') || 'https://oauth2.googleapis.com/token',
    revokeUrl: get('LIVEJJIM_GOOGLE_REVOKE_URL') || 'https://oauth2.googleapis.com/revoke',
    apiBase: get('LIVEJJIM_YOUTUBE_API_URL') || 'https://www.googleapis.com/youtube/v3',
  }
  for (const url of [redirectUri, returnUrl, ...Object.values(endpoints)]) {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { ok: false, message: '유튜브 연동 주소 설정을 확인해 주세요.' }
    }
    if (parsed.protocol !== 'https:') return { ok: false, message: '유튜브 연동 주소는 https://로만 적을 수 있어요.' }
  }
  const number = (key: string): number | undefined | null => {
    const raw = get(key)
    if (raw === '') return undefined
    return /^\d{1,9}$/.test(raw) && Number(raw) > 0 ? Number(raw) : null
  }
  const limit = number('LIVEJJIM_YOUTUBE_QUOTA_LIMIT')
  const sellerBudget = number('LIVEJJIM_YOUTUBE_SELLER_BUDGET')
  if (limit === null || sellerBudget === null) return { ok: false, message: '유튜브 할당량 설정은 1 이상의 정수로 적어 주세요.' }
  return {
    ok: true,
    youtube: {
      clientId,
      clientSecret,
      redirectUri,
      returnUrl,
      endpoints,
      quota: { ...(limit === undefined ? {} : { limit }), ...(sellerBudget === undefined ? {} : { sellerBudget }) },
    },
  }
}

/** 서버가 유튜브 채팅 읽기 (YT-11 AC6, D-YT-SRV-07) 운영자 스위치 */
export interface YoutubeWebChatSetting {
  /** `LIVEJJIM_YT_WEB_CHAT`이 다듬고 소문자로 `off`일 때만 false */
  readonly on: boolean
  /** 알아볼 수 없는 값(켬으로 봄) — 값은 담지 않는다 */
  readonly warning: 'YT_WEB_CHAT_INVALID' | null
}

/** 서버 시작 때 한 번 읽는다. 없음·빈 값·`on`은 켬, `off`만 끔, 그 밖의 값은 켬 + 경고 */
export function readYoutubeWebChat(env: Readonly<Record<string, string | undefined>>): YoutubeWebChatSetting {
  const value = (env['LIVEJJIM_YT_WEB_CHAT'] ?? '').trim().toLowerCase()
  if (value === 'off') return { on: false, warning: null }
  return { on: true, warning: value === '' || value === 'on' ? null : 'YT_WEB_CHAT_INVALID' }
}

// ── I3: 배포·운영 (SYS-05, D-I3-12·13·16, AC-I3-72) ─────────────────────────

export const HTTPS_ORIGIN_MESSAGE = '화면 앱 주소는 https://로 적어 주세요(내 컴퓨터 시험은 http://localhost만).'
export const OPS_TOKEN_MESSAGE = '운영 토큰(LIVEJJIM_OPS_TOKEN)은 32자 이상으로 적어 주세요.'
export const TRUSTED_PROXIES_MESSAGE = '믿는 프록시 수(LIVEJJIM_TRUSTED_PROXIES)는 0부터 5까지의 정수로 적어 주세요.'
export const WEB_DIR_MESSAGE = '화면 폴더(LIVEJJIM_WEB_DIR)에 index.html이 없어요. 화면을 빌드한 폴더를 적어 주세요.'
export const OPS_TOKEN_MIN = 32

/** 운영 시작의 앱 주소: https만 (내 컴퓨터 시험은 http://localhost·http://127.0.0.1과 그 포트) — 보안 쿠키가 실리지 않는 http 운영을 막는다 */
export function isProductionOrigin(origin: string): boolean {
  if (origin.startsWith('https://')) return true
  return /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/.test(origin)
}

export interface DeploySetting {
  /** 운영 토큰 (없으면 null — /ops/status는 404) */
  readonly opsToken: string | null
  /** 믿는 앞단 프록시 수 (0~5) */
  readonly trustedProxies: number
  /** 화면 빌드 폴더 (없으면 null — 화면을 내지 않는다) */
  readonly webDir: string | null
}

export type DeploySettingResult = ({ readonly ok: true } & DeploySetting) | { readonly ok: false; readonly message: string }

/**
 * 운영 시작 검사 (AC-I3-72): 앱 주소 https · 운영 토큰 32자 이상(있으면) · 믿는 프록시 수 0~5 정수 · 화면 폴더에 index.html(있으면).
 * webDirProblem은 폴더 확인 함수(파일 시스템 — 시험에서 바꾼다). 값은 문장에 넣지 않는다
 */
export function readDeploySetting(
  env: Readonly<Record<string, string | undefined>>,
  appOrigin: string,
  webDirProblem: (dir: string) => string | null,
): DeploySettingResult {
  if (!isProductionOrigin(appOrigin)) return { ok: false, message: HTTPS_ORIGIN_MESSAGE }
  const token = env['LIVEJJIM_OPS_TOKEN']?.trim() ?? ''
  if (token !== '' && token.length < OPS_TOKEN_MIN) return { ok: false, message: OPS_TOKEN_MESSAGE }
  const proxiesRaw = env['LIVEJJIM_TRUSTED_PROXIES']?.trim() ?? ''
  if (proxiesRaw !== '' && !/^[0-5]$/.test(proxiesRaw)) return { ok: false, message: TRUSTED_PROXIES_MESSAGE }
  const webDir = env['LIVEJJIM_WEB_DIR']?.trim() ?? ''
  if (webDir !== '' && webDirProblem(webDir) !== null) return { ok: false, message: WEB_DIR_MESSAGE }
  return { ok: true, opsToken: token === '' ? null : token, trustedProxies: proxiesRaw === '' ? 0 : Number(proxiesRaw), webDir: webDir === '' ? null : webDir }
}

// ── I2: 백업 저장소 (D-I2-10) ───────────────────────────────────────────

/** 백업 폴더 (LIVEJJIM_BACKUP_DIR). 없으면 null — 자동 백업이 꺼진다(시작 경보, 판매는 그대로). 값은 출력하지 않는다 */
export function readBackupDir(env: Readonly<Record<string, string | undefined>>): string | null {
  const dir = env['LIVEJJIM_BACKUP_DIR']?.trim() ?? ''
  return dir === '' ? null : dir
}
