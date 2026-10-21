// 구매자 확인서 링크 화면 `/r/<토큰>` (RCP-02, SPEC §7 화면 14, N4b D-N4b-02).
// - 서버가 그리는 HTML 한 장이다: 스크립트 없음, 로그인 없음, 판매자 앱(index.html·/api)과 따로. 판매자 세션 쿠키가 와도 보지 않는다.
// - 열 때마다 그 날짜 그 구매자의 지금 확인서(확인서 데이터 그대로 — 만든 시각 = 연 시각). 그림(JPG)·PDF는 같은 링크 아래 파일이다.
//   `/r/<토큰>`(문서) · `/r/<토큰>/receipt.jpg`(그림 — 문서 안 <img>) · `/r/<토큰>/image.jpg`(그림 저장) · `/r/<토큰>/receipt.pdf`(PDF로 받기)
// - 열 수 없으면(모양 틀림·없음·기간 지남·끊김·합쳐짐·품목 없음) 모두 404와 같은 문서 한 장(바이트까지 같다 — 까닭을 드러내지 않는다).
// - 링크 하나에 1분(이동하는 창) 60번(문서·그림·PDF 합)을 넘으면 429. 셈은 메모리에 둔다 — 서버를 다시 켜면 처음부터다.
//   파일 만들기는 그 판매자의 파일 작업 한도를 함께 쓴다(바쁘면 503). 구매자가 연결을 끊으면 만들던 작업을 멈춘다.
// - 머리글: no-store · noindex · no-referrer · 틀 금지 · nosniff · 스크립트 없는 CSP. 미리 보기는 og:title "구매 내역 확인서" 하나뿐.
// - 로그에는 토큰·`/r/` 뒤 경로·구매자 이름·계좌를 남기지 않는다(이 파일은 로그를 쓰지 않는다 — 실패는 정해진 코드만).
import { printedName, RECEIPT_TITLE, type ReceiptData } from '@livejjim/documents'
import type { Context, Hono } from 'hono'
import type { ClosingService } from './closing.ts'
import { errorResponse } from './errors.ts'
import { contentDisposition, documentFont } from './files.ts'
import { RECEIPT_TOKEN_RE, receiptTokenHash, type OpenedLink, type ReceiptLinkService } from './receipt-links.ts'
import { readShop, type ShopView } from './shop.ts'
import type { Clock } from './time.ts'
import type { Db } from './db/database.ts'

export const RECEIPT_PAGE_MESSAGES = {
  closed: '이 링크는 열 수 없어요. 판매자에게 새 링크를 받아 주세요.',
  later: '잠시 뒤 다시 열어 주세요.',
} as const

/** 링크 하나의 열기 상한 (1분에 60번 — 문서·그림·PDF 합) */
export const RECEIPT_PAGE_LIMIT = 60
export const RECEIPT_PAGE_WINDOW_MS = 60_000
/** 셈을 두는 링크 수 상한 (넘으면 오래된 것부터 버린다 — 메모리를 묶어 둔다) */
const LIMITER_MAX_KEYS = 10_000

/** 문서 답의 콘텐츠 보안 정책: 스크립트 없음(script-src를 두지 않는다 — default-src 'none'), 그림은 같은 출처만, 틀·폼·base 금지 */
export const RECEIPT_PAGE_CSP = ["default-src 'none'", "img-src 'self'", "style-src 'unsafe-inline'", "frame-ancestors 'none'", "form-action 'none'", "base-uri 'none'"].join('; ')

/** 링크 화면 답의 머리글 (문서·파일 모두) */
export const RECEIPT_PAGE_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': RECEIPT_PAGE_CSP,
}

/** HTML 글자 이스케이프 (판매자·구매자 글은 모두 이것을 거친다) */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => (char === '&' ? '&amp;' : char === '<' ? '&lt;' : char === '>' ? '&gt;' : char === '"' ? '&quot;' : '&#39;'))
}

/**
 * 링크마다 1분 이동 창 셈 (메모리). 넘은 요청은 세지 않는다 — 1분이 지나면 다시 열린다.
 * 키는 토큰의 해시다(토큰 원문을 메모리 표에도 두지 않는다)
 */
export class LinkRateLimiter {
  readonly #hits = new Map<string, number[]>()
  readonly #clock: Clock
  readonly #limit: number
  readonly #windowMs: number

  constructor(clock: Clock, limit = RECEIPT_PAGE_LIMIT, windowMs = RECEIPT_PAGE_WINDOW_MS) {
    this.#clock = clock
    this.#limit = limit
    this.#windowMs = windowMs
  }

  /** 이번 요청을 받을 수 있으면 세고 true, 넘었으면 false */
  take(key: string): boolean {
    const now = this.#clock.now()
    const recent = (this.#hits.get(key) ?? []).filter((at) => at > now - this.#windowMs)
    if (recent.length >= this.#limit) {
      this.#hits.set(key, recent)
      return false
    }
    recent.push(now)
    // 최근에 쓴 키를 뒤로 (오래된 키부터 버린다)
    this.#hits.delete(key)
    this.#hits.set(key, recent)
    while (this.#hits.size > LIMITER_MAX_KEYS) {
      const oldest = this.#hits.keys().next().value
      if (oldest === undefined) break
      this.#hits.delete(oldest)
    }
    return true
  }

  get size(): number {
    return this.#hits.size
  }
}

const STYLE = [
  ':root{color-scheme:light}',
  '*{box-sizing:border-box}',
  'body{margin:0;background:#f4f5f2;color:#1d1f1c;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif;font-size:17px;line-height:1.6;word-break:keep-all;overflow-wrap:anywhere}',
  'main{max-width:560px;margin:0 auto;padding:20px 16px 40px}',
  'h1{font-size:24px;margin:0 0 4px}',
  'h2{font-size:18px;margin:24px 0 8px}',
  'p{margin:0 0 8px}',
  '.muted{color:#4f554c}',
  '.card{background:#fff;border:1px solid #d9dcd5;border-radius:12px;padding:16px;margin:16px 0}',
  'img{display:block;width:100%;height:auto;border:1px solid #d9dcd5;border-radius:8px;background:#fff}',
  'dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:6px 16px}',
  'dt{color:#4f554c}',
  'dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}',
  '.total{font-weight:700}',
  'ul{margin:0;padding-left:20px}',
  '.account{font-size:19px;font-weight:700;user-select:all;-webkit-user-select:all}',
  '.actions{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0}',
  '.button{display:inline-flex;align-items:center;justify-content:center;min-height:48px;min-width:44px;padding:10px 18px;border-radius:10px;border:1px solid #2f6b3a;color:#2f6b3a;background:#fff;font-size:17px;font-weight:600;text-decoration:none}',
  '.button.primary{background:#2f6b3a;color:#fff}',
  '.notice{font-size:16px;color:#4f554c;border-top:1px solid #d9dcd5;padding-top:12px;margin-top:24px}',
].join('')

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const
const pad2 = (n: number) => String(n).padStart(2, '0')

/** KST `YYYY-MM-DD (요일) HH:MM` */
export function kstDateTimeWithDay(ms: number): string {
  const kst = new Date(ms + 9 * 60 * 60 * 1000)
  return `${String(kst.getUTCFullYear())}-${pad2(kst.getUTCMonth() + 1)}-${pad2(kst.getUTCDate())} (${WEEKDAYS[kst.getUTCDay()] as string}) ${pad2(kst.getUTCHours())}:${pad2(kst.getUTCMinutes())}`
}

const PAYMENT_WORDS: Readonly<Record<ReceiptData['payment'], string>> = { UNPAID: '미입금', PARTIAL: '부분 입금', PAID: '입금 완료', OVERPAID: '과입금' }

/** 문서 머리 (제목·미리 보기는 늘 "구매 내역 확인서" — 이름·금액·그림을 미리 보기에 내지 않는다) */
function head(): string {
  return [
    '<!doctype html>',
    '<html lang="ko">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex, nofollow">',
    `<meta property="og:title" content="${RECEIPT_TITLE}">`,
    `<title>${RECEIPT_TITLE}</title>`,
    `<style>${STYLE}</style>`,
    '</head>',
  ].join('\n')
}

/** 한 문장 문서 (열 수 없음·잠시 뒤) */
function messagePage(message: string): string {
  return `${head()}\n<body>\n<main>\n<h1>${RECEIPT_TITLE}</h1>\n<p>${escapeHtml(message)}</p>\n</main>\n</body>\n</html>\n`
}

const CLOSED_PAGE = new TextEncoder().encode(messagePage(RECEIPT_PAGE_MESSAGES.closed))
const LATER_PAGE = new TextEncoder().encode(messagePage(RECEIPT_PAGE_MESSAGES.later))

/** 확인서 문서 (글자는 모두 이스케이프) */
export function receiptPageHtml(opened: Pick<OpenedLink, 'receipt' | 'expiresAt'>, shop: ShopView, base: string): string {
  const { receipt } = opened
  const font = documentFont()
  const e = escapeHtml
  const name = printedName(receipt.buyerName, (text) => font.sanitize(text))
  const rows = receipt.rows.filter((row) => row.key !== 'paid')
  const lines = receipt.lines.map((line) => `<li>${e(line.session)} ${String(line.no)}번 ${e(line.name)} · ${e(line.priceText)}</li>`)
  const hasAccount = shop.accountNumber.trim() !== ''
  const account = [shop.bank, shop.accountNumber, shop.accountHolder].map((part) => part.trim()).filter((part) => part !== '').join(' ')
  const parts = [
    head(),
    '<body>',
    '<main>',
    `<h1>${RECEIPT_TITLE}</h1>`,
    receipt.shopName === null ? '' : `<p class="muted">${e(receipt.shopName)}</p>`,
    `<p>${e(name)}${receipt.phoneLast4 === null ? '' : ` (끝자리 ${e(receipt.phoneLast4)})`}님의 구매 내역이에요.</p>`,
    `<p class="muted">주문 날짜 ${e(receipt.orderDate)}</p>`,
    `<img src="${base}/receipt.jpg" alt="구매 내역 확인서 그림">`,
    '<div class="actions">',
    `<a class="button primary" href="${base}/receipt.pdf" download>PDF로 받기</a>`,
    `<a class="button" href="${base}/image.jpg" download>그림 저장</a>`,
    '</div>',
    '<section class="card">',
    '<h2>결제 금액</h2>',
    '<dl>',
    ...rows.map((row) => `<dt${row.key === 'total' ? ' class="total"' : ''}>${e(row.label)}</dt><dd${row.key === 'total' ? ' class="total"' : ''}>${e(row.text)}</dd>`),
    `<dt>입금 상태</dt><dd>${PAYMENT_WORDS[receipt.payment]}</dd>`,
    '</dl>',
    '</section>',
    '<section class="card">',
    `<h2>상품 ${String(receipt.itemCount)}개</h2>`,
    `<ul>${lines.join('')}</ul>`,
    '</section>',
    hasAccount
      ? ['<section class="card">', '<h2>입금 계좌</h2>', `<p class="account">${e(account)}</p>`, shop.accountNote.trim() === '' ? '' : `<p class="muted">${e(shop.accountNote.trim())}</p>`, '</section>'].join('\n')
      : '',
    `<p>이 링크는 ${kstDateTimeWithDay(opened.expiresAt)}까지 열 수 있어요.</p>`,
    `<p class="notice">${e(receipt.notice)}</p>`,
    '</main>',
    '</body>',
    '</html>',
    '',
  ]
  return parts.filter((part) => part !== '').join('\n') + '\n'
}

export interface ReceiptPageDeps {
  readonly db: Db
  readonly links: ReceiptLinkService
  readonly closing: ClosingService
  readonly clock: Clock
}

type PageFile = 'receipt.jpg' | 'image.jpg' | 'receipt.pdf'
const PATH_RE = /^\/r\/([A-Za-z0-9_-]{43})(?:\/(receipt\.jpg|image\.jpg|receipt\.pdf))?$/

function htmlResponse(status: number, body: Uint8Array | string): Response {
  const headers = new Headers(RECEIPT_PAGE_HEADERS)
  headers.set('Content-Type', 'text/html; charset=utf-8')
  return new Response(body, { status, headers })
}

/** `/r`·`/r/*` 경로를 앱에 단다 (화면 문서 index.html보다 먼저 — 운영 서버·E2E 서버 둘 다 이 앱을 쓴다) */
export function registerReceiptPage(app: Hono, deps: ReceiptPageDeps): void {
  const limiter = new LinkRateLimiter(deps.clock)
  const closed = () => htmlResponse(404, CLOSED_PAGE)
  const later = (status: 429 | 503) => htmlResponse(status, LATER_PAGE)

  const handle = async (c: Context): Promise<Response> => {
    const match = PATH_RE.exec(c.req.path)
    if (match === null) return closed()
    const token = match[1] as string
    const file = (match[2] ?? null) as PageFile | null
    if (!RECEIPT_TOKEN_RE.test(token)) return closed()
    if (!limiter.take(receiptTokenHash(token))) return later(429)
    const opened = await deps.links.open(token)
    if (opened === null) return closed()
    if (file === null) {
      const shop = await readShop(deps.db, opened.sellerId)
      return htmlResponse(200, receiptPageHtml(opened, shop, `/r/${token}`))
    }
    const kind = file === 'receipt.pdf' ? 'pdf' : 'jpg'
    const rendered = await deps.closing.renderReceiptFile(opened.sellerId, opened.date, false, opened.receipt, opened.createdAt, kind, c.req.raw.signal)
    if (rendered.kind === 'error') return rendered.error.status === 429 || rendered.error.status === 500 ? later(503) : closed()
    if (rendered.kind !== 'ok') return closed()
    const { bytes, type, fileName, fallback } = rendered.value
    const headers = new Headers(RECEIPT_PAGE_HEADERS)
    headers.set('Content-Type', type)
    const disposition = contentDisposition(fileName, fallback)
    headers.set('Content-Disposition', file === 'receipt.jpg' ? disposition.replace(/^attachment/, 'inline') : disposition)
    headers.set('Content-Length', String(bytes.byteLength))
    return new Response(bytes, { status: 200, headers })
  }

  app.on(['GET', 'HEAD'], '/r', handle)
  app.on(['GET', 'HEAD'], '/r/*', handle)
  // 상태를 바꾸는 일은 없다 — 다른 메서드는 405
  const notAllowed = () => {
    const response = errorResponse(405, { Allow: 'GET, HEAD' })
    for (const [name, value] of Object.entries(RECEIPT_PAGE_HEADERS)) response.headers.set(name, value)
    return response
  }
  app.all('/r', notAllowed)
  app.all('/r/*', notAllowed)
}
