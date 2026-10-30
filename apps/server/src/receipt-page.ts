// 구매자 확인서 링크 화면 `/r/<토큰>` (RCP-02, SPEC §7 화면 14, N4b D-N4b-02).
// - 서버가 그리는 HTML 한 장이다: 스크립트 없음, 로그인 없음, 판매자 앱(index.html·/api)과 따로. 판매자 세션 쿠키가 와도 보지 않는다.
// - 열 때마다 그 날짜 그 구매자의 지금 확인서(확인서 데이터 그대로 — 만든 시각 = 연 시각). 그림(JPG)·PDF는 같은 링크 아래 파일이다.
//   `/r/<토큰>`(문서) · `/r/<토큰>/receipt.jpg`(그림 — 문서 안 <img>) · `/r/<토큰>/image.jpg`(그림 저장) · `/r/<토큰>/receipt.pdf`(PDF로 받기)
// - 열 수 없으면(모양 틀림·없음·기간 지남·끊김·합쳐짐·품목 없음) 모두 404와 같은 문서 한 장(바이트까지 같다 — 까닭을 드러내지 않는다).
// - 링크 하나에 1분(이동하는 창) 60번(문서·그림·PDF 합)을 넘으면 429. 셈은 메모리에 둔다 — 서버를 다시 켜면 처음부터다.
//   파일 만들기는 그 판매자의 파일 작업 한도를 함께 쓴다(바쁘면 503). 구매자가 연결을 끊으면 만들던 작업을 멈춘다.
// - 머리글: no-store · noindex · no-referrer · 틀 금지 · nosniff · 스크립트 없는 CSP. 미리 보기는 og:title "구매 내역 확인서" 하나뿐.
// - 로그에는 토큰·`/r/` 뒤 경로·구매자 이름·계좌를 남기지 않는다(이 파일은 로그를 쓰지 않는다 — 실패는 정해진 코드만).
// - T1 배송지 칸 (PARCEL_RULES PC-3·PC-8, D-T1-06·D-T1-12): 확인서 아래 "배송지" — 스크립트 없는 HTML 양식(POST `/r/<토큰>/address`, Origin이 앱 주소일 때만,
//   CSP `form-action 'self'`), 링크마다의 1분 60번에 함께 센다. 저장하면 303으로 같은 링크 — 그 쪽에는 "배송지를 받았어요" + 받는 분 이름 + 연락처 끝 4자리만.
//   틀리면 저장하지 않고 400으로 같은 쪽(적은 값은 그 응답에만 다시 채운다). 접수 뒤엔 양식 대신 "택배를 보냈어요"(택배사·송장번호·조회 상태·배송 조회 링크).
import { printedName, RECEIPT_TITLE, type ReceiptData } from '@livejjim/documents'
import type { Context, Hono } from 'hono'
import type { ClosingService } from './closing.ts'
import { errorResponse } from './errors.ts'
import { contentDisposition, documentFont } from './files.ts'
import { RECEIPT_TOKEN_RE, receiptTokenHash, type OpenedLink, type ReceiptLinkService } from './receipt-links.ts'
import { readShop, type ShopView } from './shop.ts'
import type { Clock } from './time.ts'
import type { Db } from './db/database.ts'
import { ADDRESS_ERROR_FIELD, ADDRESS_ERROR_MESSAGES, ADDRESS_FIELDS, ADDRESS_LIMITS, PARCEL_MESSAGES, type AddressErrorCode, type AddressField } from './parcel/rules.ts'
import type { LinkSection, ParcelService } from './parcel/service.ts'
import type { ScopeWriter } from './writer.ts'
import type { LedgerService, LinkLedgerView } from './customers/ledger.ts' // KP1
import { LEDGER_LINK_TEXT, consentFieldHtml, ledgerSectionHtml, type LedgerLinkNotice } from './customers/ledger-page.ts' // KP1
import { SELLER_CANNOT_CONSENT, sellerSignedIn } from './seller-here.ts' // KP1 RA-KP1-006
import { NoticeSigner } from './notice-sign.ts' // KP1 SA-KP1-003

export const RECEIPT_PAGE_MESSAGES = {
  closed: '이 링크는 열 수 없어요. 판매자에게 새 링크를 받아 주세요.',
  later: '잠시 뒤 다시 열어 주세요.',
  forbidden: '다른 곳에서 보낸 양식이라 받지 않았어요. 받은 링크를 다시 열어 그 화면에서 보내 주세요. 그래도 안 되면 판매자에게 알려 주세요.',
  badForm: '입력한 내용을 확인해 주세요.',
} as const

/** 배송지 양식 본문 상한 (여섯 칸 — 칸마다 상한의 몇 배를 넉넉히) */
export const ADDRESS_FORM_MAX_BYTES = 16 * 1024

/** 링크 하나의 열기 상한 (1분에 60번 — 문서·그림·PDF 합) */
export const RECEIPT_PAGE_LIMIT = 60
export const RECEIPT_PAGE_WINDOW_MS = 60_000
/** 셈을 두는 링크 수 상한 (넘으면 오래된 것부터 버린다 — 메모리를 묶어 둔다) */
const LIMITER_MAX_KEYS = 10_000

/** 문서 답의 콘텐츠 보안 정책: 스크립트 없음(script-src를 두지 않는다 — default-src 'none'), 그림은 같은 출처만, 틀·base 금지, 양식은 같은 출처로만(T1 배송지 양식 — D-T1-06) */
export const RECEIPT_PAGE_CSP = ["default-src 'none'", "img-src 'self'", "style-src 'unsafe-inline'", "frame-ancestors 'none'", "form-action 'self'", "base-uri 'none'"].join('; ')

/**
 * 배송지 양식이 이 앱의 링크 화면에서 왔는지 (CSRF 막기, PC-3 "Origin이 앱 주소일 때만").
 * 링크 화면은 `Referrer-Policy: no-referrer`(D-N4b-02)라 브라우저가 같은 출처 양식 POST에도 `Origin: null`을 보낸다(Fetch 규약 —
 * 크롬·파이어폭스·사파리). 그래서 `Origin: null`은 브라우저만 붙이는(페이지가 바꿀 수 없는) `Sec-Fetch-Site: same-origin`이 함께 올 때만
 * 앱 주소와 같다고 본다. 다른 출처·틀(sandbox)·data: 문서에서 보낸 `null`은 `cross-site`/`same-site`/`none`이라 받지 않는다 (TE-T1-003)
 */
export function formFromApp(origin: string | undefined, fetchSite: string | undefined, appOrigin: string | undefined): boolean {
  if (appOrigin === undefined || origin === undefined) return false
  if (origin === appOrigin) return true
  return origin === 'null' && fetchSite === 'same-origin'
}

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
  'form{display:grid;gap:4px}',
  'label{font-weight:600;margin-top:12px}',
  'input{width:100%;min-height:48px;padding:10px 12px;border:1px solid #9aa196;border-radius:8px;font-size:17px;background:#fff;color:#1d1f1c}',
  'input[aria-invalid="true"]{border-color:#b3261e;border-width:2px}',
  '.error{color:#b3261e;font-size:16px;margin:2px 0 0}',
  '.alert{background:#fdecea;border:1px solid #f1b3ad;border-radius:8px;padding:10px 12px;color:#7a1a14}',
  'form .button{margin-top:16px;width:100%}',
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
const FORBIDDEN_PAGE = new TextEncoder().encode(messagePage(RECEIPT_PAGE_MESSAGES.forbidden))
const BAD_FORM_PAGE = new TextEncoder().encode(messagePage(RECEIPT_PAGE_MESSAGES.badForm))

/** 배송지 칸의 그릴 거리 (T1): 링크 쪽 상태 + (양식이면) 그 응답에만 다시 채울 값·칸 오류·위 문장 */
export interface ParcelPagePart {
  readonly section: LinkSection
  /** 다시 적기(?edit=1) — 저장한 배송지가 있어도 빈 양식 */
  readonly edit?: boolean
  readonly values?: Readonly<Partial<Record<AddressField, string>>>
  readonly errors?: readonly AddressErrorCode[]
  /** 양식 위 한 문장 (잠금·형식 오류 등) */
  readonly alert?: string
  /** KP1 동의 칸 (CR-2 — 양식이 보일 때만 그린다). null·없음이면 칸 없음 */
  readonly consent?: { readonly shop: string; readonly monthsWord: string } | null
  /** 틀려서 다시 그릴 때 손님이 고른 그대로 (처음엔 늘 빈 칸) */
  readonly keep?: boolean
  /** KP1 RA-KP1-006: 그 가게 판매자 세션이 함께 왔다 — 동의 칸 대신 한 문장 */
  readonly consentBlocked?: boolean
}

const FIELD_LABELS: Readonly<Record<AddressField, string>> = {
  name: '받는 분',
  phone: '연락처',
  address: '주소',
  detail: '상세 주소',
  zip: '우편번호(몰라도 돼요)',
  memo: '배송 메모',
}
const FIELD_ATTRS: Readonly<Record<AddressField, string>> = {
  name: `autocomplete="name" maxlength="${String(ADDRESS_LIMITS.name * 2)}"`,
  phone: 'type="tel" inputmode="tel" autocomplete="tel" maxlength="40"',
  address: `autocomplete="street-address" maxlength="${String(ADDRESS_LIMITS.address * 2)}"`,
  detail: `maxlength="${String(ADDRESS_LIMITS.detail * 2)}"`,
  zip: 'inputmode="numeric" autocomplete="postal-code" maxlength="10"',
  memo: `maxlength="${String(ADDRESS_LIMITS.memo * 2)}"`,
}

/** 배송지 칸 HTML (글자는 모두 이스케이프 — 받은 값을 다시 채울 때도) */
export function parcelSectionHtml(part: ParcelPagePart, base: string, kstTime: (ms: number) => string): string {
  const e = escapeHtml
  const section = part.edit === true && (part.section.kind === 'saved' || part.section.kind === 'ledger') ? ({ kind: 'form' } as const) : part.section
  const alert = part.alert === undefined ? '' : `<p class="alert" role="alert">${e(part.alert)}</p>`
  switch (section.kind) {
    case 'booked':
      return [
        '<section class="card" id="parcel">',
        '<h2>택배를 보냈어요</h2>',
        alert,
        '<dl>',
        `<dt>택배사</dt><dd>${e(section.carrierName)}</dd>`,
        `<dt>송장번호</dt><dd>${e(section.invoiceText)}</dd>`,
        `<dt>배송 상태</dt><dd>${e(section.status)}</dd>`,
        section.checkedAt === null ? '' : `<dt>마지막 확인</dt><dd>${e(kstTime(section.checkedAt))}</dd>`,
        '</dl>',
        section.trackUrl === null ? '' : `<div class="actions"><a class="button" href="${e(section.trackUrl)}" target="_blank" rel="noopener noreferrer">배송 조회</a></div>`,
        '</section>',
      ]
        .filter((line) => line !== '')
        .join('\n')
    case 'preparing':
      return ['<section class="card" id="address">', '<h2>배송지</h2>', alert, `<p>${e(PARCEL_MESSAGES.buyerPreparing)}</p>`, '</section>'].filter((line) => line !== '').join('\n')
    case 'pickup':
    case 'combined':
    case 'closed': {
      const text = section.kind === 'pickup' ? PARCEL_MESSAGES.pickupLink : section.kind === 'combined' ? PARCEL_MESSAGES.combinedLink : PARCEL_MESSAGES.addressClosed
      return ['<section class="card" id="address">', '<h2>배송지</h2>', alert, `<p>${e(text)}</p>`, '</section>'].filter((line) => line !== '').join('\n')
    }
    case 'saved':
      return [
        '<section class="card" id="address">',
        '<h2>배송지</h2>',
        alert,
        '<p>배송지를 받았어요</p>',
        `<p>받는 분 ${e(section.name)} · 연락처 끝 ${e(section.last4)}</p>`,
        `<div class="actions"><a class="button" href="${base}?edit=1#address">다시 적기</a></div>`,
        '</section>',
      ]
        .filter((line) => line !== '')
        .join('\n')
    case 'ledger':
      // KP1: 손님 장부의 지난번 배송지 (가린 이름·끝 4자리만 — CR-4)
      return [
        '<section class="card" id="address">',
        '<h2>배송지</h2>',
        alert,
        `<p>${e(LEDGER_LINK_TEXT.prefill(section.name, section.last4))}</p>`,
        `<div class="actions"><a class="button" href="${base}?edit=1#address">다시 적기</a></div>`,
        '</section>',
      ]
        .filter((line) => line !== '')
        .join('\n')
    case 'form': {
      const errors = new Map<AddressField, AddressErrorCode>()
      for (const code of part.errors ?? []) if (!errors.has(ADDRESS_ERROR_FIELD[code])) errors.set(ADDRESS_ERROR_FIELD[code], code)
      const fields = ADDRESS_FIELDS.map((field) => {
        const code = errors.get(field)
        const value = part.values?.[field] ?? ''
        return [
          `<label for="f-${field}">${FIELD_LABELS[field]}</label>`,
          `<input id="f-${field}" name="${field}" ${FIELD_ATTRS[field]} value="${e(value)}"${code === undefined ? '' : ` aria-invalid="true" aria-describedby="e-${field}"`}>`,
          code === undefined ? '' : `<p class="error" id="e-${field}" data-code="${code}">${e(ADDRESS_ERROR_MESSAGES[code])}</p>`,
        ]
          .filter((line) => line !== '')
          .join('\n')
      })
      return [
        '<section class="card" id="address">',
        '<h2>배송지</h2>',
        alert,
        `<p class="muted">${e(PARCEL_MESSAGES.linkNotice)}</p>`,
        `<form method="post" action="${base}/address">`,
        ...fields,
        part.consentBlocked === true ? `<p class="muted">${e(SELLER_CANNOT_CONSENT)}</p>` : part.consent === undefined || part.consent === null ? '' : consentFieldHtml(part.consent, part.keep === true),
        '<button class="button primary" type="submit">배송지 보내기</button>',
        '</form>',
        '</section>',
      ]
        .filter((line) => line !== '')
        .join('\n')
    }
  }
}

/** 확인서 문서 (글자는 모두 이스케이프). parcel이 있으면 확인서 아래에 배송지 칸 (T1) */
export function receiptPageHtml(opened: Pick<OpenedLink, 'receipt' | 'expiresAt'>, shop: ShopView, base: string, parcel?: ParcelPagePart, ledger?: string): string {
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
    parcel === undefined ? '' : parcelSectionHtml(parcel, base, kstDateTimeWithDay),
    ledger ?? '',
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
  /** 택배 배송지 칸 (T1). 없으면 칸·양식이 없다 */
  readonly parcels?: ParcelService
  /** 앱 주소 (양식 POST의 Origin 검사) */
  readonly appOrigin?: string
  /** 범위 상태 읽기 (배송지 칸 — 직접 수령·합배송) */
  readonly writer?: ScopeWriter
  /** KP1 손님 장부 (동의 칸·장부 칸·연결 코드). 없으면 칸이 없다 */
  readonly ledger?: LedgerService
}

type PageFile = 'receipt.jpg' | 'image.jpg' | 'receipt.pdf'
const PATH_RE = /^\/r\/([A-Za-z0-9_-]{43})(?:\/(receipt\.jpg|image\.jpg|receipt\.pdf))?$/
const ADDRESS_PATH_RE = /^\/r\/([A-Za-z0-9_-]{43})\/address$/
/** KP1 장부 양식 (지우기·코드 받기·코드 확인) */
const LEDGER_PATH_RE = /^\/r\/([A-Za-z0-9_-]{43})\/ledger\/(delete|code|link)$/
/** 장부 양식 본문 상한 (answer 한 칸뿐) */
const LEDGER_FORM_MAX_BYTES = 1024
const LEDGER_NOTICE_QUERY: Readonly<Record<string, LedgerLinkNotice>> = { deleted: 'deleted', linked: 'linked', unlinked: 'unlinked', refused: 'refused', unavailable: 'unavailable' }

function htmlResponse(status: number, body: Uint8Array | string): Response {
  const headers = new Headers(RECEIPT_PAGE_HEADERS)
  headers.set('Content-Type', 'text/html; charset=utf-8')
  return new Response(typeof body === 'string' ? body : new Uint8Array(body), { status, headers })
}

/** 본문을 최대 `max` 바이트까지만 읽는다. 넘으면 그 자리에서 읽기를 취소하고 null (읽다 끊겨도 null) */
export async function readCapped(body: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array | null> {
  if (body === null) return new Uint8Array(0)
  const reader = body.getReader()
  const parts: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > max) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      parts.push(value)
    }
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.byteLength
  }
  return out
}

/** `/r`·`/r/*` 경로를 앱에 단다 (화면 문서 index.html보다 먼저 — 운영 서버·E2E 서버 둘 다 이 앱을 쓴다) */
export function registerReceiptPage(app: Hono, deps: ReceiptPageDeps): void {
  const limiter = new LinkRateLimiter(deps.clock)
  /** KP1 장부 결과 한 줄 서명 (SA-KP1-003) */
  const ledgerNotices = new NoticeSigner(deps.clock)
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
      const part = await parcelPart(opened)
      const ledgerQuery = c.req.query('ledger')
      // KP1 SA-KP1-003: 결과 한 줄은 서명 값(n)이 맞을 때만 — 주소 질의만 지어서는 보이지 않는다
      const asked = ledgerQuery === undefined ? null : (LEDGER_NOTICE_QUERY[ledgerQuery] ?? null)
      const notice = asked !== null && ledgerNotices.check(receiptTokenHash(token), asked, c.req.query('n')) ? asked : null
      const ledger = await ledgerPart(opened, `/r/${token}`, { confirmDelete: ledgerQuery === 'delete', notice })
      const consent = await consentFor(c, opened, ledger.consent)
      return htmlResponse(200, receiptPageHtml(opened, shop, `/r/${token}`, part === null ? undefined : { ...part, edit: c.req.query('edit') === '1', ...consent }, ledger.html))
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
    return new Response(new Uint8Array(bytes), { status: 200, headers })
  }

  /** 그 링크 쪽의 배송지 칸 (택배 기능이 없으면 null) */
  const parcelPart = async (opened: OpenedLink): Promise<{ section: LinkSection } | null> => {
    if (deps.parcels === undefined || deps.writer === undefined) return null
    const runtime = await deps.writer.read(opened.sellerId, opened.date, false)
    return { section: await deps.parcels.linkSection(opened.sellerId, opened.date, opened.buyer, runtime.state) }
  }

  /** KP1 그 링크의 장부 거리: 동의 칸(양식에 넣는다)·장부 칸 HTML. 장부 기능이 없거나 링크 묶음에 표지가 없으면 둘 다 없다 */
  const ledgerPart = async (opened: OpenedLink, base: string, options: { confirmDelete: boolean; notice: LedgerLinkNotice | null }): Promise<{ consent: LinkLedgerView['consent']; html: string }> => {
    if (deps.ledger === undefined) return { consent: null, html: '' }
    const view = await deps.ledger.linkView(opened.sellerId, opened.date, opened.buyer)
    // "지웠어요"는 장부 칸이 정말 없을 때만, "이었어요·잇지 않았어요"는 장부 칸이 있을 때만 (SA-KP1-003)
    const notice = options.notice === 'deleted' ? (view.line === null ? 'deleted' : null) : options.notice === 'linked' || options.notice === 'unlinked' ? (view.line === null ? null : options.notice) : options.notice
    return { consent: view.consent, html: ledgerSectionHtml(view.line, base, { ...options, notice, kstTime: kstDateTimeWithDay }) }
  }

  /** KP1 RA-KP1-006: 동의 칸 — 그 가게 판매자 세션이 함께 오면 칸 대신 한 문장 (동의 칸을 보일 때만 세션을 본다) */
  const consentFor = async (c: Context, opened: OpenedLink, consent: LinkLedgerView['consent']): Promise<{ consent: LinkLedgerView['consent']; consentBlocked: boolean }> => {
    if (consent === null) return { consent, consentBlocked: false }
    if (await sellerSignedIn(c, deps.db, deps.clock, opened.sellerId)) return { consent: null, consentBlocked: true }
    return { consent, consentBlocked: false }
  }

  /** KP1 장부 양식 (POST /r/<토큰>/ledger/delete|code|link): Origin → 링크 한도 → 형식·크기 → 링크 열기 → 장부 동작 → 303 (#ledger) */
  const handleLedger = async (c: Context): Promise<Response> => {
    const match = LEDGER_PATH_RE.exec(c.req.path)
    if (match === null || deps.ledger === undefined) return closed()
    const token = match[1] as string
    const kind = match[2] as 'delete' | 'code' | 'link'
    if (!formFromApp(c.req.header('origin'), c.req.header('sec-fetch-site'), deps.appOrigin)) return htmlResponse(403, FORBIDDEN_PAGE)
    if (!limiter.take(receiptTokenHash(token))) return later(429)
    const type = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase()
    const declared = Number(c.req.header('content-length') ?? '0')
    if (type !== 'application/x-www-form-urlencoded' || !Number.isFinite(declared) || declared > LEDGER_FORM_MAX_BYTES) return htmlResponse(400, BAD_FORM_PAGE)
    const bytes = await readCapped(c.req.raw.body, LEDGER_FORM_MAX_BYTES)
    if (bytes === null) return htmlResponse(400, BAD_FORM_PAGE)
    const form = new URLSearchParams(new TextDecoder().decode(bytes))
    let action: Parameters<LedgerService['linkAction']>[3]
    if (kind === 'link') {
      const answers = form.getAll('answer')
      if (answers.length !== 1 || (answers[0] !== 'yes' && answers[0] !== 'no')) return htmlResponse(400, BAD_FORM_PAGE)
      action = { kind: 'answer', yes: answers[0] === 'yes' }
    } else action = { kind }
    const opened = await deps.links.open(token)
    if (opened === null) return closed()
    const result = await deps.ledger.linkAction(opened.sellerId, opened.date, opened.buyer, action)
    if (result === 'full') {
      const shop = await readShop(deps.db, opened.sellerId)
      const part = await parcelPart(opened)
      const ledger = await ledgerPart(opened, `/r/${token}`, { confirmDelete: false, notice: 'full' })
      return htmlResponse(409, receiptPageHtml(opened, shop, `/r/${token}`, part === null ? undefined : { ...part, ...(await consentFor(c, opened, ledger.consent)) }, ledger.html))
    }
    // KP1: 'none'(조건이 그사이 깨짐)은 "지금은 여기서 할 수 없어요" 한 줄 (D-KP1-39), 'refused'는 "이 계정은 이을 수 없어요" (RA-KP1-007)
    const done = result === 'deleted' || result === 'linked' || result === 'unlinked' || result === 'refused' ? result : result === 'none' ? 'unavailable' : null
    const query = done === null ? '' : `?ledger=${done}&n=${ledgerNotices.sign(receiptTokenHash(token), done)}`
    const headers = new Headers(RECEIPT_PAGE_HEADERS)
    headers.set('Location', `/r/${token}${query}#ledger`)
    return new Response(null, { status: 303, headers })
  }

  /** 배송지 양식 보내기 (T1 AC-T1-11·12): Origin(또는 null + Sec-Fetch-Site: same-origin) → 링크마다 한도 → 형식·크기 → 링크 열기 → 저장(303) · 틀림(400) · 거절(409) */
  const handleAddress = async (c: Context): Promise<Response> => {
    const match = ADDRESS_PATH_RE.exec(c.req.path)
    if (match === null || deps.parcels === undefined) return closed()
    const token = match[1] as string
    if (!formFromApp(c.req.header('origin'), c.req.header('sec-fetch-site'), deps.appOrigin)) return htmlResponse(403, FORBIDDEN_PAGE)
    if (!limiter.take(receiptTokenHash(token))) return later(429)
    const type = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase()
    const declared = Number(c.req.header('content-length') ?? '0')
    if (type !== 'application/x-www-form-urlencoded' || !Number.isFinite(declared) || declared > ADDRESS_FORM_MAX_BYTES) return htmlResponse(400, BAD_FORM_PAGE)
    // 길이를 밝히지 않은(chunked) 본문도 한도를 넘는 순간 읽기를 멈춘다 — 끝까지 모아 두지 않는다
    const bytes = await readCapped(c.req.raw.body, ADDRESS_FORM_MAX_BYTES)
    if (bytes === null) return htmlResponse(400, BAD_FORM_PAGE)
    const opened = await deps.links.open(token)
    if (opened === null) return closed()
    const form = new URLSearchParams(new TextDecoder().decode(bytes))
    // KP1 동의 칸 (CR-2): keep은 없거나 'on' 하나 — 그 밖은 받지 않는다
    const keeps = form.getAll('keep')
    if (keeps.length > 1 || (keeps.length === 1 && keeps[0] !== 'on')) return htmlResponse(400, BAD_FORM_PAGE)
    // KP1 RA-KP1-006: 그 가게 판매자 세션이 함께 오면 동의는 받지 않는다(배송지는 그대로 저장 — PC-3)
    const keep = keeps.length === 1 && !(deps.ledger !== undefined && (await sellerSignedIn(c, deps.db, deps.clock, opened.sellerId)))
    const values: Partial<Record<AddressField, string>> = {}
    let complete = true
    for (const field of ADDRESS_FIELDS) {
      const all = form.getAll(field)
      if (all.length !== 1) complete = false
      else values[field] = all[0] as string
    }
    const saved = await deps.parcels.saveFromLink(opened.sellerId, opened.date, opened.buyer, complete ? (values as Record<AddressField, string>) : null, keep)
    if (saved.kind === 'saved') {
      const headers = new Headers(RECEIPT_PAGE_HEADERS)
      headers.set('Location', `/r/${token}`)
      return new Response(null, { status: 303, headers })
    }
    const shop = await readShop(deps.db, opened.sellerId)
    const part = await parcelPart(opened)
    const section = part?.section ?? ({ kind: 'form' } as const)
    const ledger = await ledgerPart(opened, `/r/${token}`, { confirmDelete: false, notice: null })
    if (saved.kind === 'invalid') {
      // 적은 값은 이 응답에만 다시 채운다(저장하지 않는다)
      const page: ParcelPagePart = { section: { kind: 'form' }, values, errors: saved.errors, ...(await consentFor(c, opened, ledger.consent)), keep, ...(saved.errors.length === 0 ? { alert: RECEIPT_PAGE_MESSAGES.badForm } : {}) }
      return htmlResponse(
        400,
        receiptPageHtml(opened, shop, `/r/${token}`, section.kind === 'form' || section.kind === 'saved' || section.kind === 'ledger' ? page : { section, alert: RECEIPT_PAGE_MESSAGES.badForm }, ledger.html),
      )
    }
    return htmlResponse(409, receiptPageHtml(opened, shop, `/r/${token}`, { section, alert: saved.message }, ledger.html))
  }

  app.on(['GET', 'HEAD'], '/r', handle)
  app.on(['GET', 'HEAD'], '/r/*', handle)
  app.post('/r/*', async (c, next) => (ADDRESS_PATH_RE.test(c.req.path) ? handleAddress(c) : next()))
  // KP1 장부 양식 (지우기·코드 받기·코드 확인 — CR-3·CR-5)
  app.post('/r/*', async (c, next) => (LEDGER_PATH_RE.test(c.req.path) ? handleLedger(c) : next()))
  // 배송지 양식(POST /r/<토큰>/address) 밖에는 상태를 바꾸는 일이 없다 — 다른 메서드는 405
  const notAllowed = () => {
    const response = errorResponse(405, { Allow: 'GET, HEAD' })
    for (const [name, value] of Object.entries(RECEIPT_PAGE_HEADERS)) response.headers.set(name, value)
    return response
  }
  app.all('/r', notAllowed)
  app.all('/r/*', notAllowed)
}
