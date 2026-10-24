// 연습 모드 휴대폰용 https 중계 (pnpm try의 https://<와이파이 주소>:<포트+1>). 운영 기동에는 없다.
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
// 주소 바꾸기 규칙은 순수 함수(입력 글 → 바꾼 글)로 나눠 두고, 중계 처리기는 그것을 쓴다.
import { request as httpRequest } from 'node:http'

/** 휴대폰 주소 아래 가짜 구글 연습 전용 경로 앞부분 */
export const FAKE_GOOGLE_PREFIX = '/_try/google'
/** 가짜 구글에서 브라우저가 가는 경로는 승인 화면 하나뿐이다 */
export const FAKE_GOOGLE_AUTHORIZE_PATH = '/o/oauth2/v2/auth'
export const TRY_PHONE_YOUTUBE = 'TRY_PHONE_YOUTUBE'

/** 진짜 구글 모드에서 휴대폰으로 유튜브를 연결하려 할 때 (D-MOB1-06 글자 그대로) */
export function phoneYoutubeMessage(port) {
  return `휴대폰에서는 유튜브를 연결할 수 없어요. 이 컴퓨터에서 http://localhost:${String(port)} 를 열어 먼저 연결해 주세요. 연결하면 휴대폰에서도 그대로 쓸 수 있어요.`
}

/** 연습 모드 시작 안내(터미널)의 휴대폰 유튜브 한 줄 (AC-MOB1-08) */
export function phoneYoutubeNotice(realYoutube) {
  return realYoutube ? '실제 유튜브 연결은 이 컴퓨터에서 먼저 해 주세요.' : '휴대폰에서도 유튜브 연결을 해 볼 수 있어요.'
}

/**
 * 글이 정확히 `${from}/`로 시작하면 그 앞부분을 `to`로 바꾼다. 그 밖(`${from}@…`·`${from}.evil`·다른 포트·중간에 든 것)은 그대로.
 * from·to는 끝에 /가 없는 출처(origin)다.
 */
export function swapOrigin(text, from, to) {
  if (typeof text !== 'string') return text
  return text.startsWith(`${from}/`) ? `${to}${text.slice(from.length)}` : text
}

/**
 * 가짜 구글 승인 주소 → 휴대폰 주소 아래 연습 전용 경로. 정확히 `${googleOrigin}/o/oauth2/v2/auth`로 시작하고 그 뒤가 `?`·`#`·끝일 때만.
 * redirect_uri 등 매개변수는 글자 그대로 둔다.
 */
export function relayAuthorizeUrl(text, googleOrigin, here) {
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
export function fakeGoogleTarget(target) {
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

/** 퍼센트 글자 풀기 — 깨진 퍼센트(%zz·%E0 하나만 등)가 있어도 풀 수 있는 것은 푼다 */
function decodePercent(text) {
  try {
    return decodeURIComponent(text)
  } catch {
    return text.replace(/%([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
  }
}

/**
 * 요청 줄의 대상 → 판정용 경로 (TD-MOB1-001). 안쪽 서버(Hono)보다 넓게 같은 경로로 읽는다(넓게 읽으면 더 많이 막을 뿐이다).
 * - 절대 주소(`http://…/api/…`)면 그 주소의 경로, `?`·`#` 뒤는 뗀다
 * - 퍼센트 글자를 풀고(두 번 인코딩까지), `\`는 `/`, 빈 칸(`//`)·`.`은 지우고 `..`은 한 칸 위로
 * - 대소문자·끝 `/`는 가리지 않는다(소문자, 끝 `/` 없음)
 */
export function relayPath(target) {
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
  const segments = []
  for (const segment of path.replaceAll('\\', '/').split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') segments.pop()
    else segments.push(segment)
  }
  return `/${segments.join('/')}`.toLowerCase()
}

/** 간편 로그인 시작(L1) — 응답의 authorizeUrl은 로그인 공급자 주소다(유튜브 아님) */
export function loginRoute(method, target) {
  if (method !== 'POST') return false
  const path = relayPath(target)
  return path === '/api/auth/start' || path === '/api/auth/link'
}

/** 응답에 승인 주소(authorizeUrl)가 올 수 있는 요청인가 — 연결 시작·자동 게시 동의·다시 보내기. 경로는 relayPath로 읽는다 */
export function authorizeRoute(method, target) {
  if (typeof target !== 'string') return null
  const path = relayPath(target)
  if (method === 'POST' && path === '/api/youtube/connection/start') return 'start'
  if (method === 'PUT' && path === '/api/youtube/consent') return 'consent'
  if (method === 'POST' && /^\/api\/outbox\/\d{1,15}\/resend$/.test(path)) return 'resend'
  return null
}

/**
 * 응답 본문(JSON 글)의 맨 위 authorizeUrl을 바꾼다. JSON이 아니거나 authorizeUrl이 없으면 그대로.
 * 결과: { text, authorizeUrl } — authorizeUrl은 바꾸기 전 값(없으면 null).
 */
export function rewriteAuthorizeBody(text, change) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { text, authorizeUrl: null }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.authorizeUrl !== 'string') return { text, authorizeUrl: null }
  const before = parsed.authorizeUrl
  const after = change(before)
  if (after === before) return { text, authorizeUrl: before }
  return { text: JSON.stringify({ ...parsed, authorizeUrl: after }), authorizeUrl: before }
}

/** 409 TRY_PHONE_YOUTUBE 본문 (서버 오류 모양과 같다) */
export function phoneYoutubeBody(port) {
  return JSON.stringify({ error: { code: TRY_PHONE_YOUTUBE, message: phoneYoutubeMessage(port) } })
}

/**
 * 휴대폰용 https 서버의 요청 처리기.
 * @param {{
 *   port: number,                 // 안쪽 서버 포트 (127.0.0.1)
 *   appOrigin: string,            // http://localhost:<포트>
 *   httpsOrigins: Iterable<string>, // 휴대폰 https 주소들과 https://localhost:<포트+1>
 *   fakeGoogle: { port: number } | null, // 가짜 구글(127.0.0.1) — 진짜 구글 모드면 null
 *   realYoutube: boolean,
 *   innerHost?: string,
 * }} options
 */
export function createPhoneRelay(options) {
  const { port, appOrigin, fakeGoogle, realYoutube } = options
  const innerHost = options.innerHost ?? '127.0.0.1'
  const origins = new Set(options.httpsOrigins)
  const googleOrigin = fakeGoogle === null ? null : `http://127.0.0.1:${String(fakeGoogle.port)}`

  const send = (res, status, headers, body) => {
    const bytes = Buffer.from(body, 'utf8')
    res.writeHead(status, { ...headers, 'content-length': String(bytes.length) })
    res.end(bytes)
  }
  const refuse = (res) => send(res, 409, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, phoneYoutubeBody(port))
  const notFound = (res) => send(res, 404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }, '없는 주소예요.')

  return (req, res) => {
    const here = `https://${String(req.headers.host ?? '')}`
    const known = origins.has(here)
    const swap = known ? (text) => swapOrigin(text, appOrigin, here) : (text) => text
    const target = req.url ?? '/'

    // 가짜 구글 연습 전용 경로 — 가짜 구글 승인 경로 하나로만, 가짜 구글 주소로만 넘긴다
    if (target === FAKE_GOOGLE_PREFIX || target.startsWith(`${FAKE_GOOGLE_PREFIX}/`) || target.startsWith(`${FAKE_GOOGLE_PREFIX}?`)) {
      const path = fakeGoogleTarget(target)
      if (googleOrigin === null || !known || req.method !== 'GET' || path === null) {
        req.resume()
        return notFound(res)
      }
      req.resume()
      const upstream = httpRequest(
        { host: '127.0.0.1', port: fakeGoogle.port, method: 'GET', path, headers: { host: `127.0.0.1:${String(fakeGoogle.port)}`, accept: req.headers.accept ?? '*/*' } },
        (answer) => {
          const out = { ...answer.headers }
          if (typeof out.location === 'string') out.location = swap(out.location)
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

    const headers = { ...req.headers }
    if (typeof headers.origin === 'string' && origins.has(headers.origin)) headers.origin = appOrigin
    // 응답 본문을 늘 읽을 수 있게 압축은 받지 않는다(아래 승인 주소 검사가 압축된 본문을 지나치지 않게)
    delete headers['accept-encoding']
    const login = loginRoute(req.method, target)
    const upstream = httpRequest({ host: innerHost, port, method: req.method, path: target, headers }, (answer) => {
      const out = { ...answer.headers }
      if (typeof out.location === 'string') out.location = swap(out.location)
      const loginRewrite = login && known
      const isJson = /^application\/json\b/i.test(String(out['content-type'] ?? ''))
      // 승인 주소 검사는 경로와 상관없이 모든 JSON 응답에 한다(경로 모양을 바꿔 들어와도 지나치지 않게, TD-MOB1-001)
      const youtubeCheck = (route !== null || isJson) && (realYoutube || (known && googleOrigin !== null))
      if (loginRewrite || youtubeCheck) {
        const chunks = []
        answer.on('data', (chunk) => chunks.push(chunk))
        answer.on('end', () => {
          let text = Buffer.concat(chunks).toString('utf8')
          delete out['content-length']
          if (loginRewrite) text = text.replaceAll(`"${appOrigin}/_try/oauth/`, `"${here}/_try/oauth/`)
          if (youtubeCheck) {
            if (realYoutube) {
              // 승인 주소가 든 응답은 구글로 가게 하지 않는다 — 간편 로그인 시작(로그인 공급자 주소)만 빼고
              if (!login && rewriteAuthorizeBody(text, (url) => url).authorizeUrl !== null) return refuse(res)
            } else {
              text = rewriteAuthorizeBody(text, (url) => relayAuthorizeUrl(url, googleOrigin, here)).text
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
