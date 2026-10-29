// 연습 모드 휴대폰용 https 중계 (MOB1 — scripts/try/try.mjs가 불러 쓴다. scripts/try/phone-relay.mjs는 이것을 다시 내보낼 뿐이다) (pnpm try의 https://<와이파이 주소>:<포트+1>). 운영 기동에는 없다.
// - Origin 머리글: 휴대폰 https 주소(와 https://localhost:<포트+1>)에서 온 요청만 화면 주소(http://localhost:<포트>)로 바꿔 넘긴다.
// - 간편 로그인(L1): 돌려보내는 주소(Location)·승인 주소의 앞 http://localhost:<포트>를 휴대폰이 연 https 주소로 바꾼다.
//   돌아오는 주소 매개변수(redirect_uri)는 그대로 — 가짜 공급자에 등록한 값과 같아야 한다.
// - 유튜브 연결(MOB1 D-MOB1-06, AC-MOB1-07·08·09):
//   가짜 구글(기본): 연결 시작·자동 게시 동의·다시 보내기 응답의 authorizeUrl(가짜 구글 승인 주소)을 휴대폰 주소 아래 연습 전용 경로
//   /_try/google/o/oauth2/v2/auth?… 로 바꾼다. 이 경로는 가짜 구글(127.0.0.1:<가짜 포트>)의 승인 경로 하나로만 넘긴다(다른 경로·다른 곳은 404).
//   가짜 구글·서버가 돌려보내는 Location의 앞 http://localhost:<포트>는 위 규칙대로 휴대폰 주소로 바뀐다.
//   진짜 구글(--real-youtube): 휴대폰 주소에서 온 연결 시작은 넘기지 않고 409 TRY_PHONE_YOUTUBE. 동의·다시 보내기 응답에
//   승인 주소가 들어 있으면 그 응답 대신 같은 409를 돌려준다(구글 콘솔에 등록한 돌아오는 주소가 localhost라서).
//   경로는 글자 그대로가 아니라 relayPath(절대 주소·퍼센트·`.`·`..`·`#` 정리)로 읽고(TD-MOB1-001), 그와 별개로 경로와 상관없이
//   모든 JSON 응답의 맨 위 authorizeUrl을 검사한다(진짜 구글이면 409, 가짜 구글이면 휴대폰 주소로 바꾸기). 간편 로그인 시작만 뺀다.
//   진짜 구글이면 /api 아래 응답은 종류(content-type)와 상관없이 본다(실시간 알림 흐름만 빼고). 경로 판정은 relayPath(넓게)와
//   honoPath(안쪽 서버가 읽는 그대로) 둘 다 — 막는 판정은 둘 중 하나, 빼 주는 판정(간편 로그인)은 둘 다 맞아야.
// - 연습 전용 가짜 구글 경로는 redirect_uri가 정확히 http://localhost:<포트>/로 시작할 때만 넘기고 아니면 400(TD-MOB1-002).
//   위쪽 응답의 Location은 휴대폰 주소·http://localhost:<포트>/(안쪽 서버는 같은 곳 경로 `/…`도)로 시작할 때만 넘기고 아니면 400.
// - hop-by-hop 머리글(connection·keep-alive·transfer-encoding·upgrade·te·trailer·proxy-*·connection에 적힌 이름)은 양쪽 다 옮기지 않는다(TD-MOB1-003).
// 주소 바꾸기 규칙은 순수 함수(입력 글 → 바꾼 글)로 나눠 두고, 중계 처리기는 그것을 쓴다.
import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'

/** 휴대폰 주소 아래 가짜 구글 연습 전용 경로 앞부분 */
export const FAKE_GOOGLE_PREFIX = '/_try/google' as const
/** 가짜 구글에서 브라우저가 가는 경로는 승인 화면 하나뿐이다 */
export const FAKE_GOOGLE_AUTHORIZE_PATH = '/o/oauth2/v2/auth' as const
export const TRY_PHONE_YOUTUBE = 'TRY_PHONE_YOUTUBE' as const

/** 진짜 구글 모드에서 휴대폰으로 유튜브를 연결하려 할 때 (D-MOB1-06 글자 그대로) */
export function phoneYoutubeMessage(port: number): string {
  return `휴대폰에서는 유튜브를 연결할 수 없어요. 이 컴퓨터에서 http://localhost:${String(port)} 를 열어 먼저 연결해 주세요. 연결하면 휴대폰에서도 그대로 쓸 수 있어요.`
}

/** 연습 모드 시작 안내(터미널)의 휴대폰 유튜브 한 줄 (AC-MOB1-08) */
export function phoneYoutubeNotice(realYoutube: boolean): string {
  return realYoutube ? '실제 유튜브 연결은 이 컴퓨터에서 먼저 해 주세요.' : '휴대폰에서도 유튜브 연결을 해 볼 수 있어요.'
}

/**
 * 글이 정확히 `${from}/`로 시작하면 그 앞부분을 `to`로 바꾼다. 그 밖(`${from}@…`·`${from}.evil`·다른 포트·중간에 든 것)은 그대로.
 * from·to는 끝에 /가 없는 출처(origin)다.
 */
export function swapOrigin(text: string, from: string, to: string): string {
  if (typeof text !== 'string') return text
  return text.startsWith(`${from}/`) ? `${to}${text.slice(from.length)}` : text
}

/**
 * 가짜 구글 승인 주소 → 휴대폰 주소 아래 연습 전용 경로. 정확히 `${googleOrigin}/o/oauth2/v2/auth`로 시작하고 그 뒤가 `?`·`#`·끝일 때만.
 * redirect_uri 등 매개변수는 글자 그대로 둔다.
 */
export function relayAuthorizeUrl(text: string, googleOrigin: string, here: string): string {
  if (typeof text !== 'string') return text
  const head = `${googleOrigin}${FAKE_GOOGLE_AUTHORIZE_PATH}`
  if (!text.startsWith(head)) return text
  const rest = text.slice(head.length)
  if (rest !== '' && !rest.startsWith('?') && !rest.startsWith('#')) return text
  return `${here}${FAKE_GOOGLE_PREFIX}${FAKE_GOOGLE_AUTHORIZE_PATH}${rest}`
}

/**
 * 연습 전용 가짜 구글 경로(요청 줄의 대상) → 가짜 구글로 넘길 경로(`/o/oauth2/v2/auth?…`). 넘기지 않을 것이면 null.
 * 대상은 글자 그대로 비교한다: 정확히 `/_try/google/o/oauth2/v2/auth` 뒤에 끝 또는 `?`. `..`·`//`·`%2F`·`@`·절대 주소는 모두 null.
 * 넘기는 곳은 이 함수가 정하지 않는다 — 중계 처리기가 늘 가짜 구글 주소 하나로만 보낸다.
 */
export function fakeGoogleTarget(target: string): string | null {
  if (typeof target !== 'string') return null
  const head = `${FAKE_GOOGLE_PREFIX}${FAKE_GOOGLE_AUTHORIZE_PATH}`
  if (!target.startsWith(head)) return null
  const rest = target.slice(head.length)
  if (rest !== '' && !rest.startsWith('?')) return null
  // 매개변수 안의 글은 가짜 구글이 읽는 값일 뿐 경로가 아니다. 줄바꿈·공백 같은 요청 줄 깨뜨리기만 막는다
  for (const ch of rest) {
    const code = ch.codePointAt(0) ?? 0
    if (code <= 0x20 || code === 0x7f || /\s/.test(ch)) return null
  }
  return `${FAKE_GOOGLE_AUTHORIZE_PATH}${rest}`
}

/**
 * 연습 전용 가짜 구글 경로의 `redirect_uri` 검사 (TD-MOB1-002·RA-MOB1-02, D-MOB1-17 (6)).
 * 매개변수가 없으면 true(가짜 구글이 등록 값과 맞춰 본다). 있으면 모든 값이(퍼센트를 푼 뒤) 정확히 `${appOrigin}/`로 시작하고
 * 그 주소의 출처가 appOrigin일 때만 true — `https://아무곳/`·`${appOrigin}@evil/`·`${appOrigin}.evil/`·다른 포트는 false.
 */
export function fakeGoogleRedirectOk(target: string, appOrigin: string): boolean {
  if (typeof target !== 'string' || typeof appOrigin !== 'string') return false
  const at = target.indexOf('?')
  if (at < 0) return true
  let values: string[]
  try {
    values = new URLSearchParams(target.slice(at + 1).split('#')[0] ?? '').getAll('redirect_uri')
  } catch {
    return false
  }
  for (const value of values) {
    if (!value.startsWith(`${appOrigin}/`)) return false
    try {
      if (new URL(value).origin !== appOrigin) return false
    } catch {
      return false
    }
  }
  return true
}

/** 퍼센트 글자 풀기 — 깨진 퍼센트(%zz·%E0 하나만 등)가 있어도 풀 수 있는 것은 푼다 */
function decodePercent(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text.replace(/%([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex as string, 16)))
  }
}

/**
 * 요청 줄의 대상 → 판정용 경로 (TD-MOB1-001). 안쪽 서버(Hono)보다 넓게 같은 경로로 읽는다(넓게 읽으면 더 많이 막을 뿐이다).
 * - 절대 주소(`http://…/api/…`)면 그 주소의 경로, `?`·`#` 뒤는 뗀다
 * - 퍼센트 글자를 풀고(두 번 인코딩까지), `\`는 `/`, 빈 칸(`//`)·`.`은 지우고 `..`은 한 칸 위로
 * - 대소문자·끝 `/`는 가리지 않는다(소문자, 끝 `/` 없음)
 */
export function relayPath(target: string): string {
  if (typeof target !== 'string') return '/'
  let path
  try {
    const url = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target) ? new URL(target) : new URL(`http://relay.invalid${target.startsWith('/') ? '' : '/'}${target}`)
    path = url.pathname
  } catch {
    path = target.split(/[?#]/)[0] ?? ''
  }
  for (let round = 0; round < 4; round += 1) {
    const decoded = decodePercent(path)
    if (decoded === path) break
    path = decoded
  }
  const segments: string[] = []
  for (const segment of path.replaceAll('\\', '/').split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  return `/${segments.join('/')}`.toLowerCase()
}

/** 절대 주소(`http://`·`https://`로 시작)인가 — 안쪽 서버(@hono/node-server)가 절대 주소로 읽는 것과 같은 조건 */
const ABSOLUTE = /^https?:\/\//i

/**
 * 안쪽 서버(@hono/node-server + Hono)가 읽는 경로 그대로 (TD-MOB1-001).
 * 절대 주소면 그 주소의 pathname, 아니면 `http://<호스트><대상>`의 pathname(`.`·`..`·`%2e` 정리, `#`·`?` 뒤 뗌, `\`는 `/`),
 * 그 뒤 decodeURI처럼 퍼센트를 푼다(`%2F`·`%3F`·`%23` 같은 예약 글자는 그대로). 읽을 수 없으면 null.
 */
export function honoPath(target: string): string | null {
  if (typeof target !== 'string') return null
  let pathname: string
  try {
    pathname = ABSOLUTE.test(target) && !target.startsWith('/') ? new URL(target).pathname : new URL(`http://relay.invalid${target}`).pathname
  } catch {
    return null
  }
  try {
    return decodeURI(pathname)
  } catch {
    return pathname.replace(/%[0-9a-fA-F]{2}/g, (hex) => {
      try {
        return decodeURI(hex)
      } catch {
        return hex
      }
    })
  }
}

/** 두 읽기(relayPath·honoPath) 가운데 하나라도 /api 아래인가 */
function apiPath(target: string): boolean {
  const loose = relayPath(target)
  const strict = honoPath(target)
  return loose === '/api' || loose.startsWith('/api/') || (strict !== null && (strict === '/api' || strict.startsWith('/api/')))
}

/** 한 연결 구간에만 쓰는 머리글 — 중계가 옮기지 않는다 (TD-MOB1-003·RA-MOB1-03) */
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'trailers'])

/** 머리글 묶음에서 hop-by-hop 머리글(위 목록·proxy-*·connection 값에 적힌 이름)을 뺀 새 묶음 */
export function withoutHopByHop<T extends Record<string, unknown>>(headers: T): Record<string, Exclude<T[keyof T], undefined>> {
  const named = new Set<string>()
  const connection = headers?.connection
  for (const value of Array.isArray(connection) ? connection : [connection]) {
    if (typeof value !== 'string') continue
    for (const name of value.split(',')) {
      const trimmed = name.trim().toLowerCase()
      if (trimmed !== '') named.add(trimmed)
    }
  }
  const out: Record<string, Exclude<T[keyof T], undefined>> = {}
  for (const [name, value] of Object.entries(headers ?? {}) as [string, T[keyof T]][]) {
    const lower = name.toLowerCase()
    if (HOP_BY_HOP.has(lower) || lower.startsWith('proxy-') || named.has(lower)) continue
    if (value === undefined) continue
    out[name] = value as Exclude<T[keyof T], undefined>
  }
  return out
}

/**
 * 중계가 넘겨도 되는 돌려보내는 주소(Location)인가 (TD-MOB1-002). 휴대폰 주소 바꾸기(swapOrigin) 뒤의 값으로 본다.
 * 휴대폰 주소(`${here}/`, 알려진 휴대폰 주소일 때만)·`${appOrigin}/`로 시작하는 것만. allowRelative면 같은 곳의 경로(`/…`, `//`·`/\` 제외)도.
 */
export function locationAllowed(location: unknown, { here, known, appOrigin, allowRelative }: { readonly here: string; readonly known: boolean; readonly appOrigin: string; readonly allowRelative: boolean }): boolean {
  if (typeof location !== 'string') return false
  if (known && location.startsWith(`${here}/`)) return true
  if (location.startsWith(`${appOrigin}/`)) return true
  if (allowRelative && location.startsWith('/') && !location.startsWith('//') && !location.startsWith('/\\')) return true
  return false
}

/** 간편 로그인 시작(L1) — 응답의 authorizeUrl은 로그인 공급자 주소다(유튜브 아님) */
export function loginRoute(method: string | undefined, target: string): boolean {
  if (method !== 'POST') return false
  // 넓게 읽은 경로(relayPath)와 안쪽 서버가 읽는 경로(honoPath)가 둘 다 로그인 시작일 때만 — 빼 주는 쪽이라 좁게 본다
  const path = relayPath(target)
  const strict = honoPath(target)
  return (path === '/api/auth/start' || path === '/api/auth/link') && (strict === '/api/auth/start' || strict === '/api/auth/link')
}

/** 응답에 승인 주소(authorizeUrl)가 올 수 있는 요청인가 — 연결 시작·자동 게시 동의·다시 보내기. 경로는 relayPath로 읽는다 */
export function authorizeRoute(method: string | undefined, target: string): 'start' | 'consent' | 'resend' | null {
  if (typeof target !== 'string') return null
  // 넓게 읽은 경로(relayPath)와 안쪽 서버가 읽는 경로(honoPath) 가운데 하나라도 맞으면 — 막는 쪽이라 넓게 본다
  const strict = honoPath(target)
  for (const path of strict === null ? [relayPath(target)] : [relayPath(target), strict]) {
    if (method === 'POST' && path === '/api/youtube/connection/start') return 'start'
    if (method === 'PUT' && path === '/api/youtube/consent') return 'consent'
    if (method === 'POST' && /^\/api\/outbox\/\d{1,15}\/resend$/.test(path)) return 'resend'
  }
  return null
}

/**
 * 응답 본문(JSON 글)의 맨 위 authorizeUrl을 바꾼다. JSON이 아니거나 authorizeUrl이 없으면 그대로.
 * 결과: { text, authorizeUrl } — authorizeUrl은 바꾸기 전 값(없으면 null).
 */
export function rewriteAuthorizeBody(text: string, change: (url: string) => string): { text: string; authorizeUrl: string | null } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { text, authorizeUrl: null }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || typeof (parsed as { authorizeUrl?: unknown }).authorizeUrl !== 'string') return { text, authorizeUrl: null }
  const before = (parsed as { authorizeUrl: string }).authorizeUrl
  const after = change(before)
  if (after === before) return { text, authorizeUrl: before }
  return { text: JSON.stringify({ ...parsed, authorizeUrl: after }), authorizeUrl: before }
}

/** 409 TRY_PHONE_YOUTUBE 본문 (서버 오류 모양과 같다) */
export function phoneYoutubeBody(port: number): string {
  return JSON.stringify({ error: { code: TRY_PHONE_YOUTUBE, message: phoneYoutubeMessage(port) } })
}

export interface PhoneRelayOptions {
  /** 안쪽 서버 포트 (127.0.0.1) */
  readonly port: number
  /** http://localhost:<포트> */
  readonly appOrigin: string
  /** 휴대폰 https 주소들과 https://localhost:<포트+1> */
  readonly httpsOrigins: Iterable<string>
  /** 가짜 구글(127.0.0.1) — 진짜 구글 모드면 null */
  readonly fakeGoogle: { readonly port: number } | null
  readonly realYoutube: boolean
  readonly innerHost?: string
}

/** 휴대폰용 https 서버의 요청 처리기. */
export function createPhoneRelay(options: PhoneRelayOptions): (req: IncomingMessage, res: ServerResponse) => void {
  const { port, appOrigin, fakeGoogle, realYoutube } = options
  const innerHost = options.innerHost ?? '127.0.0.1'
  const origins = new Set(options.httpsOrigins)
  const googleOrigin = fakeGoogle === null ? null : `http://127.0.0.1:${String(fakeGoogle.port)}`

  const send = (res: ServerResponse, status: number, headers: Record<string, string | string[]>, body: string): void => {
    const bytes = Buffer.from(body, 'utf8')
    res.writeHead(status, { ...headers, 'content-length': String(bytes.length) })
    res.end(bytes)
  }
  const refuse = (res: ServerResponse): void => send(res, 409, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, phoneYoutubeBody(port))
  const notFound = (res: ServerResponse): void => send(res, 404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }, '없는 주소예요.')
  const badRequest = (res: ServerResponse): void => send(res, 400, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }, '갈 수 없는 주소예요.')

  return (req: IncomingMessage, res: ServerResponse): void => {
    const here = `https://${String(req.headers.host ?? '')}`
    const known = origins.has(here)
    const swap = known ? (text: string): string => swapOrigin(text, appOrigin, here) : (text: string): string => text
    const target = req.url ?? '/'
    /** 위쪽 응답 머리글 → 휴대폰에 줄 머리글. hop-by-hop은 빼고, Location은 바꾼 뒤 허락된 것만. 허락 안 되면 null */
    const answerHeaders = (answer: IncomingMessage, allowRelative: boolean): Record<string, string | string[]> | null => {
      const out: Record<string, string | string[]> = withoutHopByHop(answer.headers as Record<string, string | string[] | undefined>)
      if (out.location !== undefined) {
        const location = swap((Array.isArray(out.location) ? out.location[0] : out.location) ?? '')
        if (!locationAllowed(location, { here, known, appOrigin, allowRelative })) return null
        out.location = location
      }
      return out
    }

    // 가짜 구글 연습 전용 경로 — 가짜 구글 승인 경로 하나로만, 가짜 구글 주소로만 넘긴다
    if (target === FAKE_GOOGLE_PREFIX || target.startsWith(`${FAKE_GOOGLE_PREFIX}/`) || target.startsWith(`${FAKE_GOOGLE_PREFIX}?`)) {
      const path = fakeGoogleTarget(target)
      req.resume()
      if (googleOrigin === null || fakeGoogle === null || !known || req.method !== 'GET' || path === null) return notFound(res)
      // redirect_uri가 이 컴퓨터 화면 주소가 아니면 가짜 구글로 넘기지 않는다 — 열린 돌려보내기 없음 (TD-MOB1-002)
      if (!fakeGoogleRedirectOk(path, appOrigin)) return badRequest(res)
      const upstream = httpRequest(
        { host: '127.0.0.1', port: fakeGoogle.port, method: 'GET', path, headers: { host: `127.0.0.1:${String(fakeGoogle.port)}`, accept: req.headers.accept ?? '*/*' } },
        (answer) => {
          const out = answerHeaders(answer, false)
          if (out === null) {
            answer.resume()
            return badRequest(res)
          }
          res.writeHead(answer.statusCode ?? 502, out)
          answer.pipe(res)
        },
      )
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502)
        res.end()
      })
      upstream.end()
      res.on('close', () => upstream.destroy())
      return
    }

    const route = authorizeRoute(req.method, target)
    // 진짜 구글: 휴대폰에서 온 연결 시작은 안쪽 서버로도 넘기지 않는다
    if (realYoutube && route === 'start') {
      req.resume()
      return refuse(res)
    }

    const headers: IncomingHttpHeaders = withoutHopByHop(req.headers as Record<string, string | string[] | undefined>)
    // 본문 길이가 없는 덩어리 본문은 그대로 덩어리로 넘긴다(옮기지 않은 transfer-encoding 대신 Node가 다시 붙인다)
    if (headers['content-length'] === undefined && req.headers['transfer-encoding'] !== undefined) headers['transfer-encoding'] = 'chunked'
    if (typeof headers.origin === 'string' && origins.has(headers.origin)) headers.origin = appOrigin
    // 응답 본문을 늘 읽을 수 있게 압축은 받지 않는다(아래 승인 주소 검사가 압축된 본문을 지나치지 않게)
    delete headers['accept-encoding']
    const login = loginRoute(req.method, target)
    const underApi = apiPath(target)
    const upstream = httpRequest({ host: innerHost, port, method: req.method, path: target, headers }, (answer) => {
      const out = answerHeaders(answer, true)
      if (out === null) {
        answer.resume()
        return badRequest(res)
      }
      const loginRewrite = login && known
      const type = String(out['content-type'] ?? '')
      const isJson = /^application\/json\b/i.test(type)
      const isStream = /^text\/event-stream\b/i.test(type)
      // 승인 주소 검사는 경로와 상관없이 모든 JSON 응답에 한다(경로 모양을 바꿔 들어와도 지나치지 않게, TD-MOB1-001).
      // 진짜 구글이면 /api 아래 응답은 종류와 상관없이 본다(실시간 알림 흐름만 빼고) — 이중 안전
      const youtubeCheck = (realYoutube && underApi && !isStream) || ((route !== null || isJson) && (realYoutube || (known && googleOrigin !== null)))
      if (loginRewrite || youtubeCheck) {
        const encoding = String(out['content-encoding'] ?? 'identity').trim().toLowerCase()
        const chunks: Buffer[] = []
        answer.on('data', (chunk: Buffer) => chunks.push(chunk))
        answer.on('end', () => {
          // 압축된 본문은 읽을 수 없다 — 진짜 구글이면 넘기지 않는다
          const encoded = encoding !== 'identity' && encoding !== ''
          if (realYoutube && youtubeCheck && !login && encoded) return refuse(res)
          if (encoded) {
            // 가짜 구글 모드에서 압축된 본문은 바꾸지 않고 그대로 (글자로 풀면 깨진다)
            res.writeHead(answer.statusCode ?? 502, out)
            return res.end(Buffer.concat(chunks))
          }
          let text = Buffer.concat(chunks).toString('utf8')
          delete out['content-length']
          if (loginRewrite) text = text.replaceAll(`"${appOrigin}/_try/oauth/`, `"${here}/_try/oauth/`)
          if (youtubeCheck) {
            if (realYoutube) {
              // 승인 주소가 든 응답은 구글로 가게 하지 않는다 — 간편 로그인 시작(로그인 공급자 주소)만 빼고
              if (!login && rewriteAuthorizeBody(text, (url) => url).authorizeUrl !== null) return refuse(res)
            } else {
              text = rewriteAuthorizeBody(text, (url) => (googleOrigin === null ? url : relayAuthorizeUrl(url, googleOrigin, here))).text
            }
          }
          send(res, answer.statusCode ?? 502, out, text)
        })
        return
      }
      res.writeHead(answer.statusCode ?? 502, out)
      answer.pipe(res)
    })
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502)
      res.end()
    })
    req.pipe(upstream)
    res.on('close', () => upstream.destroy())
  }
}

/** APP1: 휴대폰 HTTPS의 음성 경로 하나만 안쪽 서버로 넘긴다. 일꾼·임의 경로는 넘기지 않는다. */
export function createPhoneVoiceUpgrade(options: PhoneRelayOptions): (req: IncomingMessage, socket: Duplex, head: Buffer) => void {
  const origins = new Set(options.httpsOrigins)
  return (req, socket, head) => {
    const target = req.url ?? ''
    const origin = req.headers.origin
    if (!target.startsWith('/api/voice/stream?') || origin === undefined || !origins.has(origin)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      return
    }
    const headers: Record<string, string> = { connection: 'Upgrade', upgrade: 'websocket', origin: options.appOrigin }
    for (const name of ['cookie', 'sec-websocket-key', 'sec-websocket-version', 'sec-websocket-protocol']) {
      const value = req.headers[name]
      if (typeof value === 'string') headers[name] = value
    }
    const upstream = httpRequest({ hostname: options.innerHost ?? '127.0.0.1', port: options.port, path: target, method: 'GET', headers })
    upstream.on('upgrade', (response, inner, innerHead) => {
      inner.setTimeout(0)
      const lines = ['HTTP/1.1 101 Switching Protocols', 'Connection: Upgrade', 'Upgrade: websocket']
      for (const name of ['sec-websocket-accept', 'sec-websocket-protocol']) {
        const value = response.headers[name]
        if (typeof value === 'string') lines.push(`${name}: ${value}`)
      }
      socket.write(`${lines.join('\r\n')}\r\n\r\n`)
      if (innerHead.length) socket.write(innerHead)
      if (head.length) inner.write(head)
      inner.on('error', () => socket.destroy())
      socket.on('error', () => inner.destroy())
      inner.on('close', () => socket.destroy())
      socket.on('close', () => inner.destroy())
      socket.pipe(inner).pipe(socket)
    })
    upstream.on('response', (response) => {
      response.resume()
      socket.end(`HTTP/1.1 ${response.statusCode === 401 ? 401 : 403} Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
    })
    upstream.on('error', () => socket.destroy())
    upstream.setTimeout(10_000, () => upstream.destroy())
    socket.on('close', () => upstream.destroy())
    upstream.end()
  }
}
