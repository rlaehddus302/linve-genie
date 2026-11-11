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

/**
 * 옛 앱 주소 (LIVEJJIM_OLD_APP_ORIGINS, 쉼표로 여럿 — D-OPS-DOMAIN): 도메인을 옮기는 동안 옛 주소로 깔린 앱·웹의 Origin도 받는다.
 * 돌아오는 주소·링크는 늘 새 주소(LIVEJJIM_APP_ORIGIN)로 만든다. 형식이 틀린 값은 기동하지 않는다
 */
export function readOldAppOrigins(env: Readonly<Record<string, string | undefined>>): { readonly ok: true; readonly origins: readonly string[] } | { readonly ok: false; readonly message: string } {
  const origins = (env['LIVEJJIM_OLD_APP_ORIGINS'] ?? '').split(',').map((value) => value.trim()).filter((value) => value !== '')
  if (origins.some((value) => !/^https?:\/\/[^/\s]+$/.test(value))) return { ok: false, message: '옛 앱 주소(LIVEJJIM_OLD_APP_ORIGINS)는 https://example.com 처럼 경로 없이 쉼표로 나눠 적어 주세요.' }
  return { ok: true, origins }
}

/** 상태를 바꾸는 요청·마이크 흐름의 Origin 검사: 새 앱 주소 또는 옛 앱 주소 중 하나와 정확히 같을 때만 */
export function originAllowed(origin: string | undefined, appOrigin: string, oldAppOrigins: readonly string[] = []): boolean {
  return origin !== undefined && (origin === appOrigin || oldAppOrigins.includes(origin))
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

/** 내 컴퓨터 시험 주소 (http://localhost·127.0.0.1·[::1]) */
export function isLocalHttp(url: URL): boolean {
  return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
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
    // 돌아오는 주소·화면 주소만 내 컴퓨터 시험의 http://localhost를 받는다 (앱 주소 규칙과 같다, D-YT-SEND-16). 구글 주소는 늘 https
    const local = (url === redirectUri || url === returnUrl) && isLocalHttp(parsed)
    if (parsed.protocol !== 'https:' && !local) return { ok: false, message: '유튜브 연동 주소는 https://로만 적을 수 있어요.' }
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
  /** 유튜브 웹 읽기를 보낼 집 회선 프록시 (D-YT-SRV-21) — 없으면 null */
  readonly proxy?: string | null
  /** 알아볼 수 없는 값(켬으로 봄) — 값은 담지 않는다 */
  readonly warning: 'YT_WEB_CHAT_INVALID' | null
}

/** 서버 시작 때 한 번 읽는다. 없음·빈 값·`on`은 켬, `off`만 끔, 그 밖의 값은 켬 + 경고 */
export function readYoutubeWebChat(env: Readonly<Record<string, string | undefined>>, mediaProxy: string | null = null): YoutubeWebChatSetting {
  const value = (env['LIVEJJIM_YT_WEB_CHAT'] ?? '').trim().toLowerCase()
  if (value === 'off') return { on: false, warning: null }
  const proxy = readYoutubeWebProxy(env, mediaProxy)
  return { on: true, warning: value === '' || value === 'on' ? null : 'YT_WEB_CHAT_INVALID', ...(proxy === null ? {} : { proxy }) }
}

/**
 * 유튜브 웹 읽기(방송·채팅 페이지, 채팅)를 집 회선 프록시로 보낼지 (D-YT-SRV-21): 데이터센터 IP는 유튜브 봇 확인에 막히므로
 * 방송 소리와 같은 출구(LIVEJJIM_YT_MEDIA_PROXY — 이미 허용 모양만 받은 값)를 쓴다. `LIVEJJIM_YT_WEB_PROXY=off`일 때만 쓰지 않는다
 */
export function readYoutubeWebProxy(env: Readonly<Record<string, string | undefined>>, mediaProxy: string | null): string | null {
  if ((env['LIVEJJIM_YT_WEB_PROXY'] ?? '').trim().toLowerCase() === 'off') return null
  return mediaProxy
}

/** 실시간 채팅 감사 다른 길 설정 (D-YT-SEND-08). 값(쿠키·토큰)은 파일에만 두고 여기에는 파일 위치만 */
export interface YoutubeChatSendEnv {
  /** official-bot: 봇 계정의 공식 Data API가 기본 길(D-YT-SEND-20 — 비공식 계정 없이, official 필수) */
  readonly route: 'innertube' | 'browser' | 'nightbot' | 'official-bot'
  /** 이 길을 쓸 판매자 ID (또는 모두 '*') */
  readonly sellers: readonly string[] | '*'
  /**
   * 봇 계정 하나: 작성자 채널 ID(UC…)와 로그인 파일(innertube: 쿠키 머리글 글 또는 Playwright 로그인 상태 JSON · browser: 로그인 상태 JSON · nightbot: 접근 토큰).
   * 계정 목록 파일(accountsFile)을 쓰면 null
   */
  readonly single: { readonly authorChannelId: string; readonly secretFile: string } | null
  /** 봇 계정 여럿 (D-YT-SEND-12): JSON [{"channelId":"UC…","secretFile":"/경로"}] 파일. innertube·browser만 */
  readonly accountsFile: string | null
  /** browser: Chromium 실행 파일 (없으면 Playwright가 설치한 것) */
  readonly chromiumPath: string | null
  /**
   * 봇 계정의 공식 API (D-YT-SEND-13 넘김·D-YT-SEND-20 기본 길): 봇 채널 ID. 그 계정의 구글 연결은 운영자 명령(youtube-bot)으로
   * 로그인 없는 시스템 판매자에 잇는다(D-YT-SEND-21)
   */
  readonly official: { readonly channelId: string } | null
}

export type YoutubeChatSendSetting = { readonly ok: true; readonly send: YoutubeChatSendEnv | null } | { readonly ok: false; readonly message: string }

export const CHAT_SEND_MESSAGES = {
  ROUTE: '감사 채팅 길(LIVEJJIM_YT_SEND_ROUTE)은 official·innertube·browser·nightbot 중 하나로 적어 주세요.',
  SELLERS: '감사 채팅 다른 길을 쓸 판매자(LIVEJJIM_YT_SEND_SELLERS)를 쉼표로 나눠 적어 주세요(모두면 *).',
  CHANNEL: '감사 채팅을 올리는 채널 ID(LIVEJJIM_YT_SEND_CHANNEL_ID)를 UC로 시작하는 24자로 적어 주세요.',
  SECRET: '감사 채팅 로그인 파일(LIVEJJIM_YT_SEND_SECRET_FILE) 위치를 적어 주세요.',
  ACCOUNTS: '봇 계정 하나(LIVEJJIM_YT_SEND_CHANNEL_ID·SECRET_FILE)와 계정 목록 파일(LIVEJJIM_YT_SEND_ACCOUNTS_FILE) 중 하나만 적어 주세요. 계정 목록은 innertube·browser만 돼요.',
  OFFICIAL_BOT: '공식 API 봇(official-bot)에는 봇 채널 ID(LIVEJJIM_YT_SEND_OFFICIAL_CHANNEL_ID, UC로 시작하는 24자)만 적어 주세요(봇 계정 로그인 파일은 쓰지 않아요).',
  OFFICIAL: '공식 API 넘김의 봇 채널 ID(LIVEJJIM_YT_SEND_OFFICIAL_CHANNEL_ID)는 UC로 시작하는 24자로 적어 주세요.',
} as const

/**
 * 감사 채팅 다른 길 (D-YT-SEND-08). LIVEJJIM_YT_SEND_ROUTE가 없거나 official이면 공식 Data API만(기본).
 * 다른 길이면 판매자 목록·작성자 채널·로그인 파일이 모두 있어야 한다 — 하나라도 없으면 시작하지 않는다(작성자를 모르면 수집기가 우리 감사를 찜으로 읽을 수 있다)
 */
export function readYoutubeChatSend(env: Readonly<Record<string, string | undefined>>): YoutubeChatSendSetting {
  const get = (key: string) => env[key]?.trim() ?? ''
  const route = get('LIVEJJIM_YT_SEND_ROUTE').toLowerCase()
  if (route === '' || route === 'official') return { ok: true, send: null }
  if (route !== 'innertube' && route !== 'browser' && route !== 'nightbot' && route !== 'official-bot') return { ok: false, message: CHAT_SEND_MESSAGES.ROUTE }
  const rawSellers = get('LIVEJJIM_YT_SEND_SELLERS')
  const sellers = rawSellers === '*' ? '*' : rawSellers.split(',').map((item) => item.trim()).filter((item) => item !== '')
  if (sellers !== '*' && sellers.length === 0) return { ok: false, message: CHAT_SEND_MESSAGES.SELLERS }
  const channelRe = /^UC[A-Za-z0-9_-]{22}$/
  // 공식 API 봇 (D-YT-SEND-20·21): 봇 계정의 구글 연결로만 — 비공식 계정 칸은 비워야 한다
  if (route === 'official-bot') {
    const channel = get('LIVEJJIM_YT_SEND_OFFICIAL_CHANNEL_ID')
    const unofficial = ['LIVEJJIM_YT_SEND_ACCOUNTS_FILE', 'LIVEJJIM_YT_SEND_CHANNEL_ID', 'LIVEJJIM_YT_SEND_SECRET_FILE'].some((key) => get(key) !== '')
    if (!channelRe.test(channel) || unofficial) return { ok: false, message: CHAT_SEND_MESSAGES.OFFICIAL_BOT }
    return { ok: true, send: { route, sellers, single: null, accountsFile: null, chromiumPath: null, official: { channelId: channel } } }
  }
  const accountsFile = get('LIVEJJIM_YT_SEND_ACCOUNTS_FILE')
  const authorChannelId = get('LIVEJJIM_YT_SEND_CHANNEL_ID')
  const secretFile = get('LIVEJJIM_YT_SEND_SECRET_FILE')
  let single: YoutubeChatSendEnv['single'] = null
  if (accountsFile !== '') {
    if (authorChannelId !== '' || secretFile !== '' || route === 'nightbot') return { ok: false, message: CHAT_SEND_MESSAGES.ACCOUNTS }
  } else {
    if (!channelRe.test(authorChannelId)) return { ok: false, message: CHAT_SEND_MESSAGES.CHANNEL }
    if (secretFile === '') return { ok: false, message: CHAT_SEND_MESSAGES.SECRET }
    single = { authorChannelId, secretFile }
  }
  const officialChannel = get('LIVEJJIM_YT_SEND_OFFICIAL_CHANNEL_ID')
  if (officialChannel !== '' && !channelRe.test(officialChannel)) return { ok: false, message: CHAT_SEND_MESSAGES.OFFICIAL }
  const chromium = get('LIVEJJIM_YT_SEND_CHROMIUM')
  return {
    ok: true,
    send: {
      route,
      sellers,
      single,
      accountsFile: accountsFile === '' ? null : accountsFile,
      chromiumPath: chromium === '' ? null : chromium,
      official: officialChannel === '' ? null : { channelId: officialChannel },
    },
  }
}

// ── 틱톡 감사 채팅 (D-TT-SEND-07) ────────────────────────────────────────

export const TT_SEND_MESSAGES = {
  SELLERS: '틱톡 감사 채팅을 쓸 판매자(LIVEJJIM_TT_SEND_SELLERS)를 쉼표로 나눠 적어 주세요(모두면 *).',
  STATE: '틱톡 봇 계정 로그인 파일(LIVEJJIM_TT_SEND_STATE_FILE) 위치를 적어 주세요. pnpm --filter @livejjim/server tiktok-bot login 으로 만들어요.',
  BOT_IDS: '틱톡 봇 계정 숫자 사용자 ID(LIVEJJIM_TT_SEND_BOT_USER_IDS)는 숫자만 쉼표로 나눠 적어 주세요.',
} as const

export interface TiktokChatSendEnv {
  readonly sellers: readonly string[] | '*'
  /** Playwright 로그인 상태 JSON (봇 틱톡 계정) */
  readonly stateFile: string
  /** 봇 계정의 숫자 사용자 ID — 채팅에 뜬 봇 글을 찜으로 읽지 않게 (선택, 없으면 보낸 글로만 거른다) */
  readonly botUserIds: readonly string[]
  readonly chromiumPath: string | null
  readonly headless: boolean
}

/**
 * 틱톡 감사 채팅 (D-TT-SEND-07). LIVEJJIM_TT_SEND_SELLERS가 비면 꺼짐(기본 — 틱톡에 아무것도 올리지 않는다).
 * 켜면 로그인 파일 위치가 있어야 한다. 파일 내용은 읽지 않는다(시작할 때 서버가 있는지만 본다)
 */
export function readTiktokChatSend(env: Readonly<Record<string, string | undefined>>): { readonly ok: true; readonly send: TiktokChatSendEnv | null } | { readonly ok: false; readonly message: string } {
  const get = (key: string) => env[key]?.trim() ?? ''
  const rawSellers = get('LIVEJJIM_TT_SEND_SELLERS')
  if (rawSellers === '') return { ok: true, send: null }
  const sellers = rawSellers === '*' ? '*' : rawSellers.split(',').map((item) => item.trim()).filter((item) => item !== '')
  if (sellers !== '*' && sellers.length === 0) return { ok: false, message: TT_SEND_MESSAGES.SELLERS }
  const stateFile = get('LIVEJJIM_TT_SEND_STATE_FILE')
  if (stateFile === '') return { ok: false, message: TT_SEND_MESSAGES.STATE }
  const rawIds = get('LIVEJJIM_TT_SEND_BOT_USER_IDS')
  const botUserIds = rawIds === '' ? [] : rawIds.split(',').map((item) => item.trim()).filter((item) => item !== '')
  if (botUserIds.some((id) => !/^[1-9][0-9]{0,31}$/.test(id))) return { ok: false, message: TT_SEND_MESSAGES.BOT_IDS }
  const chromium = get('LIVEJJIM_TT_SEND_CHROMIUM')
  return { ok: true, send: { sellers, stateFile, botUserIds, chromiumPath: chromium === '' ? null : chromium, headless: get('LIVEJJIM_TT_SEND_HEADLESS') === '1' } }
}

/**
 * 운영자 문자 알림 휴대폰 (LIVEJJIM_OPS_ALERT_PHONE, D-YT-SEND-22): 010으로 시작하는 휴대폰 번호(하이픈 허용). 비면 끔, 모양이 틀리면 끄고 invalid.
 * 번호는 문장·로그에 넣지 않는다
 */
export function readOpsAlertPhone(env: Readonly<Record<string, string | undefined>>): { readonly phone: string | null; readonly invalid: boolean } {
  const raw = (env['LIVEJJIM_OPS_ALERT_PHONE'] ?? '').trim().replace(/-/g, '')
  if (raw === '') return { phone: null, invalid: false }
  return /^01[016789][0-9]{7,8}$/.test(raw) ? { phone: raw, invalid: false } : { phone: null, invalid: true }
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
