// 공개 방송 일정 페이지 `/s/<토큰>` (SPEC SCH-02·SCH-03, MESSAGE_RULES MR-6, KP1 AC-KP1-21·22). 서버가 그리는 HTML 한 장 — 스크립트 없음, 로그인 없음.
// - 보이는 것: 가게 이름·다가오는 일정·(있으면) 유튜브 채널 주소·알림 받기 양식·그만 받기 양식. 손님·판매 정보·연락처는 없다.
// - 머리글: no-store · noindex · no-referrer · 틀 금지 · nosniff · 스크립트 없는 CSP(form-action 'self'). 판매자 세션 쿠키는 그 가게 판매자인지만 본다(늘리지 않는다).
// - 모르는·꺼진·옛 토큰은 모두 같은 404 문서. 페이지 열기는 접속 주소마다 1분 60번을 넘으면 429 (RA-KP1-001 — 손님 여럿이 한 가게 주소를 함께 연다).
//   토큰 전체에는 큰 상한만(1분 3,000번 — GET·POST 합): 공격자 한 명이 가게 주소 전체를 막지 못하게 하면서 끝없는 요청은 막는다.
// - 알림 신청·그만 받기(POST): Origin이 앱 주소일 때만(formFromApp), 접속 주소마다 1분 10번을 넘으면 429. 접속 주소를 모르면 한 칸으로 함께 센다.
//   체크가 없거나 번호가 휴대폰 번호가 아니면 저장하지 않고 400(적은 번호를 다시 채우지 않는다). 저장하면 303으로 같은 페이지에 처리 결과 한 줄.
//   그만 받기는 번호가 있든 없든 같은 303·같은 문장(있는지 알려 주지 않는다).
// - 처리 결과 한 줄은 303 주소의 짧은 수명 서명 값(n)이 맞을 때만 보인다 — 주소 질의만 지어서는 보이지 않는다 (SA-KP1-003).
// - 그 가게 판매자(또는 보조자)의 유효한 세션 쿠키가 함께 오면 알림 신청 양식 대신 한 문장을 보이고, 신청 POST는 저장하지 않는다 (RA-KP1-006).
// - 번호는 응답·로그에 없다(이 파일은 로그를 쓰지 않는다). 문자를 보내지 않는다.
import { isValidDate, normalizePhone } from '@livejjim/core'
import type { Context, Hono } from 'hono'
import { connectionAddress } from '../api.ts'
import type { Db } from '../db/database.ts'
import { errorResponse } from '../errors.ts'
import { clientAddress, ipKey } from '../login-limit.ts'
import { MR_CONSENT_1 } from '../messaging/rules.ts'
import { escapeHtml, formFromApp, kstDateTimeWithDay, LinkRateLimiter, RECEIPT_PAGE_CSP, readCapped } from '../receipt-page.ts'
import { receiptTokenHash } from '../receipt-links.ts'
import { NoticeSigner } from '../notice-sign.ts'
import { SELLER_CANNOT_CONSENT, sellerSignedIn } from '../seller-here.ts'
import { readShop } from '../shop.ts'
import { kstDate, type Clock } from '../time.ts'
import { SCHEDULE_TOKEN_RE, type PublicSchedule, type ScheduleService } from './service.ts'

/** 페이지 열기 상한 (접속 주소마다 1분 60번, RA-KP1-001) */
export const SCHEDULE_PAGE_LIMIT = 60
/** 알림 신청·그만 받기 상한 (접속 주소마다 1분 10번, RA-KP1-001) */
export const ALERT_FORM_LIMIT = 10
/** 토큰 하나 전체 상한 (1분 3,000번 — GET·POST 합, RA-KP1-001) */
export const SCHEDULE_TOKEN_LIMIT = 3000
export const SCHEDULE_WINDOW_MS = 60_000
/** 양식 본문 상한 */
export const ALERT_FORM_MAX_BYTES = 2048

export const SCHEDULE_PAGE_MESSAGES = {
  closed: '이 주소는 열 수 없어요.',
  later: '잠시 뒤 다시 열어 주세요.',
  forbidden: '다른 곳에서 보낸 양식이라 받지 않았어요. 주소를 다시 열어 그 화면에서 보내 주세요.',
  empty: '다가오는 방송이 아직 없어요.',
  needAgree: '알림 받기에 동의해 주세요.',
  badPhone: '휴대폰 번호(010으로 시작하는 11자리)를 적어 주세요.',
  /** 아직 문자를 보내지 않는다 (D-KP1-20) */
  notYet: '아직 문자를 보내지 않아요. 보내기는 준비 중이에요.',
  badForm: '입력한 내용을 확인해 주세요.',
  agreed: (shop: string, date: string) => `${shop} 방송 알림을 신청했어요 (${date}).`,
  stopped: (shop: string, date: string) => `${shop} 방송 알림을 그만 받아요 (${date}).`,
} as const

/** 가게 이름이 비었을 때 (가정) */
const NO_SHOP_NAME = '이 가게'

export const SCHEDULE_PAGE_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': RECEIPT_PAGE_CSP,
}

const STYLE = [
  ':root{color-scheme:light}',
  '*{box-sizing:border-box}',
  'body{margin:0;background:#f4f5f2;color:#1d1f1c;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif;font-size:18px;line-height:1.6;word-break:keep-all;overflow-wrap:anywhere}',
  'main{max-width:560px;margin:0 auto;padding:20px 16px 40px}',
  'h1{font-size:26px;margin:0 0 8px}',
  'h2{font-size:20px;margin:24px 0 8px}',
  'p{margin:0 0 8px}',
  '.muted{color:#4f554c}',
  '.card{background:#fff;border:1px solid #d9dcd5;border-radius:12px;padding:16px;margin:12px 0}',
  'ul{list-style:none;margin:0;padding:0}',
  '.when{font-weight:700}',
  '.notice{background:#e8f3ea;border:1px solid #9cc7a4;border-radius:8px;padding:12px;margin:12px 0}',
  '.alert{background:#fdecea;border:1px solid #f1b3ad;border-radius:8px;padding:12px;color:#7a1a14;margin:12px 0}',
  'form{display:grid;gap:6px}',
  'label{font-weight:600;margin-top:8px}',
  'input[type=tel]{width:100%;min-height:52px;padding:10px 12px;border:1px solid #9aa196;border-radius:8px;font-size:18px;background:#fff;color:#1d1f1c}',
  '.check{display:flex;gap:10px;align-items:flex-start;font-weight:400;min-height:52px}',
  '.check input{width:32px;height:32px;min-height:32px;margin:2px 0 0;flex:none}',
  'button{min-height:56px;margin-top:12px;border-radius:10px;border:1px solid #2f6b3a;background:#2f6b3a;color:#fff;font-size:18px;font-weight:700}',
  'button.plain{background:#fff;color:#2f6b3a}',
  'a{color:#2f6b3a}',
].join('')

function head(title: string): string {
  return [
    '<!doctype html>',
    '<html lang="ko">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex,nofollow">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${STYLE}</style>`,
    '</head>',
  ].join('\n')
}

function messagePage(message: string): string {
  return `${head('방송 일정')}\n<body>\n<main>\n<h1>방송 일정</h1>\n<p>${escapeHtml(message)}</p>\n</main>\n</body>\n</html>\n`
}

const CLOSED_PAGE = messagePage(SCHEDULE_PAGE_MESSAGES.closed)
const LATER_PAGE = messagePage(SCHEDULE_PAGE_MESSAGES.later)
const FORBIDDEN_PAGE = messagePage(SCHEDULE_PAGE_MESSAGES.forbidden)

function htmlResponse(status: number, body: string): Response {
  const headers = new Headers(SCHEDULE_PAGE_HEADERS)
  headers.set('Content-Type', 'text/html; charset=utf-8')
  return new Response(body, { status, headers })
}

export interface SchedulePagePart {
  /** 위 한 줄 — 처리 결과(notice) 또는 양식 오류(alert) */
  readonly notice?: string
  readonly alert?: string
  /** 그 가게 판매자 세션이 함께 왔다 — 알림 신청 양식 대신 한 문장 (RA-KP1-006) */
  readonly sellerHere?: boolean
  /** 틀려서 다시 그릴 때 손님이 적은 번호 (응답 HTML에만 — 저장·로그 없음) */
  readonly phone?: string
  readonly phoneFor?: 'alert' | 'stop'
}

/** 공개 일정 페이지 HTML (가게 이름·일정·채널 주소는 모두 이스케이프) */
export function schedulePageHtml(shop: string, data: PublicSchedule, path: string, part: SchedulePagePart = {}): string {
  const lines: string[] = [head(`${shop} 방송 일정`), '<body>', '<main>', `<h1>${escapeHtml(shop)} 방송 일정</h1>`]
  if (part.notice !== undefined) lines.push(`<p class="notice" role="status">${escapeHtml(part.notice)}</p>`)
  if (part.alert !== undefined) lines.push(`<p class="alert" role="alert">${escapeHtml(part.alert)}</p>`)
  lines.push('<h2>다가오는 방송</h2>')
  if (data.items.length === 0) lines.push(`<p class="muted">${SCHEDULE_PAGE_MESSAGES.empty}</p>`)
  else {
    lines.push('<ul>')
    for (const item of data.items) {
      lines.push('<li class="card">')
      lines.push(`<p class="when">${escapeHtml(kstDateTimeWithDay(Date.parse(item.startsAt)))}</p>`)
      lines.push(`<p>${escapeHtml(item.title)}</p>`)
      if (item.intro !== '') lines.push(`<p class="muted">${escapeHtml(item.intro)}</p>`)
      lines.push('</li>')
    }
    lines.push('</ul>')
  }
  if (data.channelUrl !== null) {
    // SCH-02 "채널 주소": 주소 글자도 보인다 (손님이 옮겨 적거나 확인할 수 있게)
    lines.push(`<p>유튜브 채널 <a href="${escapeHtml(data.channelUrl)}" rel="noopener noreferrer" target="_blank">${escapeHtml(data.channelUrl)}</a></p>`)
  }
  lines.push('<h2>방송 알림 받기</h2>')
  if (part.sellerHere === true) lines.push(`<p class="card muted">${escapeHtml(SELLER_CANNOT_CONSENT)}</p>`)
  else {
    lines.push(`<form method="post" action="${escapeHtml(path)}/alert" class="card">`)
    lines.push('<label for="alert-phone">휴대폰 번호</label>')
    // 빈칸·동의 검사는 서버가 한다 (브라우저 말풍선 대신 서버 문장, UX-KP1-011)
    lines.push(`<input id="alert-phone" type="tel" name="phone" inputmode="tel" autocomplete="tel" maxlength="20"${part.phoneFor === 'alert' ? ` value="${escapeHtml(part.phone ?? '')}"` : ''}>`)
    lines.push(`<label class="check"><input type="checkbox" name="agree" value="on"><span>${escapeHtml(MR_CONSENT_1.body(shop))}</span></label>`)
    lines.push(`<p class="muted">${SCHEDULE_PAGE_MESSAGES.notYet}</p>`)
    lines.push('<button type="submit">알림 받기</button>')
    lines.push('</form>')
  }
  lines.push('<h2>알림 그만 받기</h2>')
  lines.push(`<form method="post" action="${escapeHtml(path)}/stop" class="card">`)
  lines.push('<label for="stop-phone">휴대폰 번호</label>')
  lines.push(`<input id="stop-phone" type="tel" name="phone" inputmode="tel" autocomplete="tel" maxlength="20"${part.phoneFor === 'stop' ? ` value="${escapeHtml(part.phone ?? '')}"` : ''}>`)
  lines.push('<button type="submit" class="plain">그만 받기</button>')
  lines.push('</form>')
  lines.push('</main>', '</body>', '</html>', '')
  return lines.join('\n')
}

export interface SchedulePageDeps {
  readonly db: Db
  readonly schedule: ScheduleService
  readonly clock: Clock
  /** 화면 앱 주소 (양식 Origin 검사) */
  readonly appOrigin: string
  /** 믿는 앞단 프록시 수 (접속 주소 셈) */
  readonly trustedProxies?: number
}

const PAGE_RE = /^\/s\/([^/]+)$/
const FORM_RE = /^\/s\/([^/]+)\/(alert|stop)$/

/** `/s`·`/s/*` 경로를 앱에 단다 (화면 문서 index.html보다 먼저) */
export function registerSchedulePage(app: Hono, deps: SchedulePageDeps): void {
  const tokenLimiter = new LinkRateLimiter(deps.clock, SCHEDULE_TOKEN_LIMIT, SCHEDULE_WINDOW_MS)
  const pageLimiter = new LinkRateLimiter(deps.clock, SCHEDULE_PAGE_LIMIT, SCHEDULE_WINDOW_MS)
  const formLimiter = new LinkRateLimiter(deps.clock, ALERT_FORM_LIMIT, SCHEDULE_WINDOW_MS)
  /** 접속 주소 칸 (모르면 한 칸 — 기존 공개 경로와 같은 clientAddress) */
  const addressOf = (c: Context) => {
    const address = clientAddress(connectionAddress(c), c.req.header('x-forwarded-for'), deps.trustedProxies ?? 0)
    // RA-KP1-101: IPv6는 /64 한 칸으로 묶는다 (기존 ipKey 관례, D-I3-12)
    return `ip:${(address === null ? null : ipKey(address)) ?? '?'}`
  }
  const notices = new NoticeSigner(deps.clock)
  const closed = () => htmlResponse(404, CLOSED_PAGE)
  const later = () => htmlResponse(429, LATER_PAGE)
  const shopName = async (sellerId: string) => {
    const name = (await readShop(deps.db, sellerId)).name.trim()
    return name === '' ? NO_SHOP_NAME : name
  }

  const handlePage = async (c: Context): Promise<Response> => {
    const match = PAGE_RE.exec(c.req.path)
    const token = match?.[1] ?? ''
    if (!SCHEDULE_TOKEN_RE.test(token)) return closed()
    // 접속 주소 칸을 먼저 센다 — 넘은 요청은 토큰 전체 칸을 쓰지 않는다
    if (!pageLimiter.take(addressOf(c)) || !tokenLimiter.take(receiptTokenHash(token))) return later()
    const data = await deps.schedule.openPage(token)
    if (data === null) return closed()
    const shop = await shopName(data.sellerId)
    const done = c.req.query('done')
    const on = c.req.query('on')
    let notice: string | undefined
    // 결과 한 줄은 서명 값이 맞을 때만 (SA-KP1-003)
    if (on !== undefined && isValidDate(on) && (done === 'agree' || done === 'stop') && notices.check(receiptTokenHash(token), `${done}|${on}`, c.req.query('n'))) {
      notice = done === 'agree' ? SCHEDULE_PAGE_MESSAGES.agreed(shop, on) : SCHEDULE_PAGE_MESSAGES.stopped(shop, on)
    }
    const sellerHere = await sellerSignedIn(c, deps.db, deps.clock, data.sellerId)
    return htmlResponse(200, schedulePageHtml(shop, data, `/s/${token}`, { ...(notice === undefined ? {} : { notice }), sellerHere }))
  }

  const handleForm = async (c: Context): Promise<Response> => {
    const match = FORM_RE.exec(c.req.path)
    const token = match?.[1] ?? ''
    const action = match?.[2] as 'alert' | 'stop' | undefined
    if (action === undefined || !SCHEDULE_TOKEN_RE.test(token)) return closed()
    if (!formFromApp(c.req.header('origin'), c.req.header('sec-fetch-site'), deps.appOrigin)) return htmlResponse(403, FORBIDDEN_PAGE)
    // RA-KP1-104: 알림 신청 칸은 (접속 주소, 토큰) — 가게끼리 칸을 함께 쓰지 않는다
    if (!formLimiter.take(`${addressOf(c)}|${receiptTokenHash(token)}`) || !tokenLimiter.take(receiptTokenHash(token))) return later()
    const data = await deps.schedule.openPage(token)
    if (data === null) return closed()
    const shop = await shopName(data.sellerId)
    const path = `/s/${token}`
    const sellerHere = action === 'alert' && (await sellerSignedIn(c, deps.db, deps.clock, data.sellerId))
    const bad = (message: string, phone?: string) =>
      htmlResponse(400, schedulePageHtml(shop, data, path, { alert: message, sellerHere, ...(phone === undefined ? {} : { phone: phone.slice(0, 20), phoneFor: action }) }))
    // RA-KP1-006: 판매자 로그인 화면에서 낸 알림 신청은 저장하지 않는다 (본문도 읽지 않는다)
    if (sellerHere) return bad(SELLER_CANNOT_CONSENT)
    const type = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase()
    const declared = Number(c.req.header('content-length') ?? '0')
    if (type !== 'application/x-www-form-urlencoded' || !Number.isFinite(declared) || declared > ALERT_FORM_MAX_BYTES) return bad(SCHEDULE_PAGE_MESSAGES.badForm)
    const bytes = await readCapped(c.req.raw.body, ALERT_FORM_MAX_BYTES)
    if (bytes === null) return bad(SCHEDULE_PAGE_MESSAGES.badForm)
    const form = new URLSearchParams(new TextDecoder().decode(bytes))
    const phones = form.getAll('phone')
    if (action === 'alert') {
      const agree = form.getAll('agree')
      if (agree.length > 1 || (agree.length === 1 && agree[0] !== 'on')) return bad(SCHEDULE_PAGE_MESSAGES.badForm)
      if (agree.length === 0) return bad(SCHEDULE_PAGE_MESSAGES.needAgree, phones[0])
    }
    const normalized = phones.length === 1 ? normalizePhone(phones[0] as string) : null
    if (normalized === null) return bad(SCHEDULE_PAGE_MESSAGES.badPhone, phones[0])
    const at = action === 'alert' ? await deps.schedule.subscribe(data.sellerId, normalized) : await deps.schedule.unsubscribe(data.sellerId, normalized)
    const headers = new Headers(SCHEDULE_PAGE_HEADERS)
    const done = action === 'alert' ? 'agree' : 'stop'
    const on = kstDate(at)
    headers.set('Location', `${path}?done=${done}&on=${on}&n=${notices.sign(receiptTokenHash(token), `${done}|${on}`)}`)
    return new Response(null, { status: 303, headers })
  }

  app.on(['GET', 'HEAD'], '/s', () => closed())
  app.on(['GET', 'HEAD'], '/s/*', (c) => (PAGE_RE.test(c.req.path) ? handlePage(c) : closed()))
  app.post('/s/*', async (c, next) => (FORM_RE.test(c.req.path) ? handleForm(c) : next()))
  const notAllowed = () => {
    const response = errorResponse(405, { Allow: 'GET, HEAD' })
    for (const [name, value] of Object.entries(SCHEDULE_PAGE_HEADERS)) response.headers.set(name, value)
    return response
  }
  app.all('/s', notAllowed)
  app.all('/s/*', notAllowed)
}
