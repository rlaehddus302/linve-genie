// 인스타그램 연동 설정 (D-N2-06·D-N2-11, AC-N2-10·17).
// 환경변수(비밀값 표시 *): LIVEJJIM_IG_APP_ID, LIVEJJIM_IG_APP_SECRET*, LIVEJJIM_IG_VERIFY_TOKEN*, LIVEJJIM_IG_REDIRECT_URI,
//   LIVEJJIM_IG_LOGIN(FACEBOOK 기본 · INSTAGRAM), LIVEJJIM_IG_SCOPES(쉼표 목록 — 없으면 로그인 방식의 기본 권한),
//   LIVEJJIM_IG_RETURN_PATH(연결을 마친 뒤 화면 주소의 경로, 기본 '/'), 주소 덮어쓰기 LIVEJJIM_IG_GRAPH_URL·LIVEJJIM_IG_IG_GRAPH_URL·
//   LIVEJJIM_IG_FB_DIALOG_URL·LIVEJJIM_IG_IG_AUTHORIZE_URL·LIVEJJIM_IG_IG_TOKEN_URL(시험·스테이징용 — 기본은 메타 주소).
// - 앱 ID·앱 시크릿·확인 토큰·돌아오는 주소 중 하나라도 없으면 "설정 없음"이다: 인스타그램 기능은 NOT_CONFIGURED, 웹훅은 503.
// - 메타 API의 권한 이름·주소·오류 코드는 2026-10 메타 문서 기준의 기본값이다 — 메타가 이름을 바꿔도 판정·기록 규칙은 그대로다.
// - 오류 문장에 환경변수 값을 넣지 않는다. 비밀값은 어떤 응답·로그에도 나가지 않는다.

export type InstagramLogin = 'FACEBOOK' | 'INSTAGRAM'

/** 메타 주소 (끝에 / 없이) */
export interface InstagramEndpoints {
  /** 페이스북 그래프 API (버전 포함) */
  readonly graph: string
  /** 인스타그램 그래프 API (버전 포함, 인스타그램 로그인) */
  readonly igGraph: string
  /** 페이스북 로그인 승인 창 */
  readonly fbDialog: string
  /** 인스타그램 로그인 승인 창 */
  readonly igAuthorize: string
  /** 인스타그램 로그인 code → 짧은 토큰 */
  readonly igToken: string
}

export const META_ENDPOINTS: InstagramEndpoints = {
  graph: 'https://graph.facebook.com/v24.0',
  igGraph: 'https://graph.instagram.com/v24.0',
  fbDialog: 'https://www.facebook.com/v24.0/dialog/oauth',
  igAuthorize: 'https://www.instagram.com/oauth/authorize',
  igToken: 'https://api.instagram.com/oauth/access_token',
}

/** 로그인 방식마다 연결 때 한 번에 받는 권한 기본값 (댓글·메시지 함께 — D-N2-06) */
export const DEFAULT_SCOPES: Readonly<Record<InstagramLogin, readonly string[]>> = {
  FACEBOOK: ['instagram_basic', 'instagram_manage_comments', 'instagram_manage_messages', 'pages_show_list', 'pages_read_engagement', 'pages_manage_metadata'],
  INSTAGRAM: ['instagram_business_basic', 'instagram_business_manage_comments', 'instagram_business_manage_messages'],
}

/** 받은 권한 판단: 댓글 읽기·메시지 권한 이름 (로그인 방식 둘 모두) */
export const PERMISSION_NAMES = {
  comments: ['instagram_manage_comments', 'instagram_business_manage_comments'],
  messages: ['instagram_manage_messages', 'instagram_business_manage_messages'],
} as const

/** 웹훅 구독 필드 기본값 */
export const DEFAULT_SUBSCRIBED_FIELDS: readonly string[] = ['live_comments']

/** 시간 제한 (밀리초) — 보내기 10초(D-N2-10), 대화 조회 30초, 그 밖 호출 10초 */
export interface InstagramTimeouts {
  readonly requestMs: number
  readonly sendMs: number
  readonly confirmMs: number
}

export const DEFAULT_TIMEOUTS: InstagramTimeouts = { requestMs: 10_000, sendMs: 10_000, confirmMs: 30_000 }

export interface InstagramSettings {
  readonly appId: string
  /** 비밀값 */
  readonly appSecret: string
  /** 비밀값 (웹훅 확인 요청) */
  readonly verifyToken: string
  /** 메타 승인 뒤 돌아오는 주소 (설정에 고정한 하나 — 이 서버의 GET /api/instagram/callback 공개 주소) */
  readonly redirectUri: string
  /** 연결을 마친 뒤 화면 주소의 경로 (앱 주소 + 이 경로 + ?instagram=<결과 코드>) */
  readonly returnPath: string
  readonly login: InstagramLogin
  readonly scopes: Readonly<Record<InstagramLogin, readonly string[]>>
  readonly subscribedFields: readonly string[]
  readonly endpoints: InstagramEndpoints
  readonly timeouts: InstagramTimeouts
}

export type InstagramConfigResult = { readonly ok: true; readonly settings: InstagramSettings | null } | { readonly ok: false; readonly message: string }

const URL_RE = /^https?:\/\/[^\s]+$/

/**
 * 환경변수로 인스타그램 설정을 읽는다. 필수 넷 중 하나라도 없으면 settings = null(설정 없음 — 서버는 정상으로 시작한다).
 * 값이 있는데 형식이 틀리면(로그인 방식·주소) 오류 문장 — 값은 넣지 않는다
 */
export function readInstagramConfig(env: Readonly<Record<string, string | undefined>>): InstagramConfigResult {
  const get = (name: string) => env[name]?.trim() ?? ''
  const appId = get('LIVEJJIM_IG_APP_ID')
  const appSecret = get('LIVEJJIM_IG_APP_SECRET')
  const verifyToken = get('LIVEJJIM_IG_VERIFY_TOKEN')
  const redirectUri = get('LIVEJJIM_IG_REDIRECT_URI')
  if (appId === '' || appSecret === '' || verifyToken === '' || redirectUri === '') return { ok: true, settings: null }
  if (!URL_RE.test(redirectUri)) return { ok: false, message: '인스타그램 돌아오는 주소(LIVEJJIM_IG_REDIRECT_URI)는 https://로 시작하는 주소여야 해요.' }
  const loginRaw = get('LIVEJJIM_IG_LOGIN')
  if (loginRaw !== '' && loginRaw !== 'FACEBOOK' && loginRaw !== 'INSTAGRAM') return { ok: false, message: '인스타그램 로그인 방식(LIVEJJIM_IG_LOGIN)은 FACEBOOK 또는 INSTAGRAM이에요.' }
  const login: InstagramLogin = loginRaw === 'INSTAGRAM' ? 'INSTAGRAM' : 'FACEBOOK'
  const scopesRaw = get('LIVEJJIM_IG_SCOPES')
  const scopes = scopesRaw === '' ? DEFAULT_SCOPES : { ...DEFAULT_SCOPES, [login]: scopesRaw.split(',').map((scope) => scope.trim()).filter((scope) => scope !== '') }
  const returnPath = get('LIVEJJIM_IG_RETURN_PATH') || '/'
  if (!returnPath.startsWith('/') || returnPath.startsWith('//')) return { ok: false, message: '인스타그램 연결 뒤 화면 경로(LIVEJJIM_IG_RETURN_PATH)는 /로 시작해야 해요.' }
  const endpoint = (name: string, fallback: string): string | null => {
    const value = get(name)
    if (value === '') return fallback
    return URL_RE.test(value) ? value.replace(/\/+$/, '') : null
  }
  const endpoints = {
    graph: endpoint('LIVEJJIM_IG_GRAPH_URL', META_ENDPOINTS.graph),
    igGraph: endpoint('LIVEJJIM_IG_IG_GRAPH_URL', META_ENDPOINTS.igGraph),
    fbDialog: endpoint('LIVEJJIM_IG_FB_DIALOG_URL', META_ENDPOINTS.fbDialog),
    igAuthorize: endpoint('LIVEJJIM_IG_IG_AUTHORIZE_URL', META_ENDPOINTS.igAuthorize),
    igToken: endpoint('LIVEJJIM_IG_IG_TOKEN_URL', META_ENDPOINTS.igToken),
  }
  if (Object.values(endpoints).some((value) => value === null)) return { ok: false, message: '인스타그램 메타 주소 설정(LIVEJJIM_IG_*_URL)은 http(s):// 주소여야 해요.' }
  return {
    ok: true,
    settings: {
      appId,
      appSecret,
      verifyToken,
      redirectUri,
      returnPath,
      login,
      scopes,
      subscribedFields: DEFAULT_SUBSCRIBED_FIELDS,
      endpoints: endpoints as unknown as InstagramEndpoints,
      timeouts: DEFAULT_TIMEOUTS,
    },
  }
}

/** 시험·E2E용: 필수 값과 주소로 설정을 만든다 (빠진 것은 기본값) */
export function instagramSettings(input: Partial<InstagramSettings> & Pick<InstagramSettings, 'appId' | 'appSecret' | 'verifyToken' | 'redirectUri'>): InstagramSettings {
  return {
    returnPath: '/',
    login: 'FACEBOOK',
    scopes: DEFAULT_SCOPES,
    subscribedFields: DEFAULT_SUBSCRIBED_FIELDS,
    endpoints: META_ENDPOINTS,
    timeouts: DEFAULT_TIMEOUTS,
    ...input,
  }
}
