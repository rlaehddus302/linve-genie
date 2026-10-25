// 연습 모드 전용 "문자 자동 수신 시험" 받는 곳 (SMST, 실험 도구 — 제품 기능 아님).
// 사장님 휴대폰(아이폰 단축어 자동화·갤럭시 MacroDroid)이 받은 문자를 연습 서버로 저절로 보내는지 시험한다.
// - 판정·문자찜에 잇지 않는다. 받은 것은 메모리에만 최근 50건(연습 모드를 끄면 사라진다).
// - 보낸 사람 번호는 저장 전에 끝 4자리만 남긴다. 원문 번호·연락처 이름은 메모리·응답·로그 어디에도 남기지 않는다(절대 규칙 7).
//   이 파일은 로그를 쓰지 않는다.
// - 머리글 X-Try-Token(보기 화면은 ?t=)이 켤 때마다 새로 만든 토큰과 같을 때만 받는다.
// - 보기 화면의 모든 글은 이스케이프한다(본문·기기 이름은 믿을 수 없는 입력).
// - SMS2: 휴대폰이 받은 시각·늦은 정도, 일련번호("시험 3"), 겹쳐 온 문자 한 번, 기기별 요약(빠진 번호·늦게 온 번호·다음에 보낼 글),
//   처음부터 다시 세기(확인 화면 → POST, 토큰 그대로), 휴대폰 카드 화면 (D-SMS2-01~08).
import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

export const SMS_TEST_PATH = '/_try/sms-test'
export const SMS_TEST_LIMIT = 50
export const SMS_TEST_BODY_MAX = 200
export const SMS_TEST_DEVICE_MAX = 30
/** 요청 몸 상한 (바이트) — 본문 200자 시험에 넉넉한 크기 */
export const SMS_TEST_REQUEST_MAX = 16 * 1024

/** 휴대폰에서 손으로 옮겨 적기 쉬운 글자 (헷갈리는 i·l·o·0·1 뺌) */
const TOKEN_LETTERS = 'abcdefghjkmnpqrstuvwxyz23456789'

/** 켤 때마다 새로 만드는 시험 토큰 (예: abcd-efgh-jk23) */
export function makeSmsTestToken(): string {
  return Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => TOKEN_LETTERS[randomInt(TOKEN_LETTERS.length)]).join('')).join('-')
}

/** 보낸 사람이 어떤 모양으로 왔는지 (원문은 남기지 않는다) */
export type SenderKind = 'number' | 'name' | 'empty'

export interface SmsTestEntry {
  /** 몇 번째 줄인지 (1부터, 겹쳐 온 것은 올리지 않는다) */
  readonly seq: number
  /** 보낸 사람 번호 끝 4자리 (번호가 아니면 null) */
  readonly last4: string | null
  readonly senderKind: SenderKind
  readonly body: string
  readonly device: string
  /** 본문에서 읽은 일련번호 "시험 3" → 3 (없으면 null, D-SMS2-04) */
  readonly serial: number | null
  /** 같은 문자가 온 횟수 (처음 1, D-SMS2-05) */
  readonly count: number
  /** 휴대폰이 알려 준 받은 시각 (없거나 읽을 수 없으면 null, D-SMS2-02) */
  readonly phoneAt: Date | null
  /** 서버가 받은 시각 (겹쳐 온 것은 처음 온 것 그대로) */
  readonly serverAt: Date
}

/** 보낸 사람 글에서 끝 4자리만 남긴다. 숫자가 4개 미만이면(연락처 이름 등) 번호 없음으로 본다 */
export function maskSender(from: unknown): { last4: string | null; senderKind: SenderKind } {
  if (typeof from !== 'string' || from.trim() === '') return { last4: null, senderKind: 'empty' }
  const digits = from.replace(/[^0-9]/g, '')
  if (digits.length >= 4) return { last4: digits.slice(-4), senderKind: 'number' }
  return { last4: null, senderKind: 'name' }
}

/** 글자(코드 포인트) 기준으로 자른다 — 이모지 반쪽이 남지 않게 */
function cut(text: string, max: number): string {
  return Array.from(text).slice(0, max).join('')
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const KST_OFFSET_MS = 9 * HOUR_MS
const ISO_AT = /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:([Zz])|([+-])(\d{2}):?(\d{2}))?$/

/** 숫자 시각: 13자리 이상이면 밀리초, 10~12자리면 초 (D-SMS2-02 다) */
function numberAt(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null
  const digits = String(Math.trunc(value)).length
  if (digits >= 13) return Math.round(value)
  if (digits >= 10) return Math.round(value * 1000)
  return null
}

/** ISO 모양 시각. 오프셋이 없으면 한국 시각으로 본다(서버 시간대와 상관없이, D-SMS2-02 가·나) */
function isoAt(text: string): number | null {
  const m = ISO_AT.exec(text)
  if (m === null) return null
  const [, y, mo, d, h, mi, s, frac, z, sign, oh, om] = m
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  const hour = Number(h)
  const minute = Number(mi)
  const second = s === undefined ? 0 : Number(s)
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (day > daysInMonth) return null
  const ms = frac === undefined ? 0 : Number(frac.slice(0, 3).padEnd(3, '0'))
  let offsetMs = KST_OFFSET_MS
  if (z !== undefined) offsetMs = 0
  else if (sign !== undefined) {
    const offH = Number(oh)
    const offM = Number(om)
    if (offH > 23 || offM > 59) return null
    offsetMs = (sign === '-' ? -1 : 1) * (offH * HOUR_MS + offM * 60 * 1000)
  }
  const utc = Date.UTC(year, month - 1, day, hour, minute, second, ms) - offsetMs
  return Number.isFinite(utc) ? utc : null
}

/**
 * 휴대폰이 받은 시각 읽기 (D-SMS2-02). 읽을 수 없거나 서버 시각과 하루 넘게 차이 나면 null(화면 "-").
 */
export function parsePhoneAt(value: unknown, serverAt: Date): Date | null {
  let at: number | null = null
  if (typeof value === 'number') at = numberAt(value)
  else if (typeof value === 'string') {
    const text = value.trim()
    if (text.length > 64) return null
    at = /^\d+$/.test(text) ? numberAt(Number(text)) : isoAt(text)
  }
  if (at === null) return null
  if (Math.abs(serverAt.getTime() - at) > DAY_MS) return null
  return new Date(at)
}

/**
 * 시험 문자 일련번호 읽기 (D-SMS2-04): 처음 나오는 "시험" 바로 뒤(띄어쓰기 건너)의 아라비아 숫자 1~3자리, 1~999.
 * 그 밖은 모두 번호 없음(null). 본문은 이미 200자로 자른 것을 준다.
 */
export function readSerial(body: string): number | null {
  const at = body.indexOf('시험')
  if (at < 0) return null
  const m = /^\s*([0-9]{1,3})(?![0-9])/.exec(body.slice(at + 2))
  if (m === null) return null
  const n = Number(m[1])
  return n >= 1 && n <= 999 ? n : null
}

/** 줄마다 늦은 정도 (D-SMS2-03). delayMs = 서버 − 휴대폰 */
export function delayLabel(delayMs: number | null): string {
  if (delayMs === null) return '-'
  if (delayMs < -1000) return '시계 차이'
  if (delayMs < 1000) return '1초 안'
  return `${String(Math.floor((delayMs + 500) / 1000))}초`
}

/** 글 사이(태그 밖)에 넣을 글 — 따옴표는 그대로 둔다 */
function text(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

/** 한국 시각 "10월 25일 14:03:05" */
function kst(date: Date): string {
  const shifted = new Date(date.getTime() + KST_OFFSET_MS)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${String(shifted.getUTCMonth() + 1)}월 ${String(shifted.getUTCDate())}일 ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`
}

function sameToken(given: string | null, token: string): boolean {
  if (given === null) return false
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(token).digest()
  return timingSafeEqual(a, b)
}

const TEXT_HEADERS = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }
const CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'"

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: TEXT_HEADERS })
}

function html(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      ...TEXT_HEADERS,
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': CSP,
    },
  })
}

const STYLE =
  'body{font-family:sans-serif;font-size:1.125rem;line-height:1.5;margin:0;padding:16px;overflow-wrap:anywhere;word-break:keep-all}' +
  'main{max-width:720px;margin:0 auto}' +
  'h1{font-size:1.5rem;margin:0 0 12px}h2{font-size:1.25rem;margin:20px 0 8px}h3{font-size:1.125rem;margin:0 0 6px}' +
  'p{margin:4px 0}ol{margin:4px 0;padding-left:1.5em}' +
  '.group,.card{border:1px solid #bbb;border-radius:8px;padding:12px;margin:0 0 12px}' +
  '.top{font-weight:bold}.b{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-all;margin-top:8px}' +
  '.btn{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;min-height:48px;padding:8px 16px;margin:4px 0;border:2px solid #333;border-radius:8px;background:#fff;color:#000;font:inherit;text-decoration:none;max-width:100%}' +
  '.danger{background:#b00020;color:#fff;border-color:#b00020}form{margin:0}'

function pageShell(inner: string, refresh: boolean): string {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${refresh ? '<meta http-equiv="refresh" content="5">\n' : ''}<title>문자 자동 수신 시험</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>문자 자동 수신 시험</h1>
${inner}
</main>
</body>
</html>
`
}

/** 앞 20개를 쉼표로, 나머지는 개수 */
function listNumbers(numbers: readonly number[]): string {
  const shown = numbers.slice(0, 20).map(String).join(', ')
  return numbers.length > 20 ? `${shown} 외 ${String(numbers.length - 20)}개` : shown
}

interface MutableEntry {
  seq: number
  last4: string | null
  senderKind: SenderKind
  body: string
  device: string
  serial: number | null
  count: number
  phoneAt: Date | null
  serverAt: Date
  /** 겹침 비교 열쇠: 기기·보낸 사람 종류·끝 4자리·내용 (원문 번호·이름은 들어가지 않는다) */
  key: string
}

function delayOf(entry: MutableEntry): number | null {
  return entry.phoneAt === null ? null : entry.serverAt.getTime() - entry.phoneAt.getTime()
}

/** 기기 하나의 요약 문장들 (D-SMS2-06). arrived는 서버가 받은 차례(오래된 것부터) */
export function summarizeDevice(arrived: readonly Pick<SmsTestEntry, 'serial' | 'count' | 'phoneAt' | 'serverAt'>[]): string[] {
  const lines: string[] = []
  const extra = arrived.reduce((sum, e) => sum + e.count, 0) - arrived.length
  lines.push(extra === 0 ? '겹쳐 온 것: 없음' : `겹쳐 온 것: ${String(extra)}번 (한 번으로 셌어요)`)

  let measured = 0
  let sumMs = 0
  let maxMs = 0
  let clockOff = 0
  let noTime = 0
  for (const e of arrived) {
    if (e.phoneAt === null) {
      noTime += 1
      continue
    }
    const d = e.serverAt.getTime() - e.phoneAt.getTime()
    if (d < -1000) {
      clockOff += 1
      continue
    }
    const v = Math.max(d, 0)
    measured += 1
    sumMs += v
    if (v > maxMs) maxMs = v
  }
  if (measured === 0) lines.push('늦은 정도: 휴대폰이 받은 시각이 오지 않아 잴 수 없어요.')
  else {
    let average = '1초 안'
    if (sumMs >= 1000 * measured) {
      const tenths = Math.floor((sumMs + 50 * measured) / (100 * measured))
      average = `${String(Math.floor(tenths / 10))}.${String(tenths % 10)}초`
    }
    lines.push(`늦은 정도: 평균 ${average} · 가장 늦은 것 ${delayLabel(maxMs)} (${String(measured)}건으로 쟀어요)`)
  }
  if (clockOff > 0) lines.push(`휴대폰 시계가 맞지 않아 뺀 것 ${String(clockOff)}건`)
  if (noTime > 0) lines.push(`휴대폰이 받은 시각 없이 온 것 ${String(noTime)}건`)

  const order: number[] = []
  const seen = new Set<number>()
  let withoutSerial = 0
  for (const e of arrived) {
    if (e.serial === null) {
      withoutSerial += 1
      continue
    }
    if (seen.has(e.serial)) continue
    seen.add(e.serial)
    order.push(e.serial)
  }
  const max = order.reduce((m, n) => Math.max(m, n), 0)
  if (order.length === 0) lines.push("'시험 1'처럼 번호를 붙여 보내면 빠진 문자와 순서도 볼 수 있어요.")
  else {
    const missing: number[] = []
    for (let n = 1; n <= max; n++) if (!seen.has(n)) missing.push(n)
    lines.push(missing.length === 0 ? `시험 1~${String(max)}: 빠진 번호 없어요` : `시험 1~${String(max)}: 빠진 번호 ${listNumbers(missing)}`)
    const late: number[] = []
    let highest = 0
    for (const n of order) {
      if (n < highest) late.push(n)
      else highest = n
    }
    lines.push(late.length === 0 ? '순서: 보낸 차례대로 왔어요' : `순서: 늦게 온 번호 ${listNumbers(late)}`)
    if (withoutSerial > 0) lines.push(`번호 없는 문자 ${String(withoutSerial)}건`)
    lines.push(`'시험 ${String(max)}' 뒤에 보낸 문자가 안 왔는지는 이 화면이 알 수 없어요. 마지막으로 보낸 번호와 비교해 보세요.`)
  }
  lines.push(max >= 999 ? "번호를 999까지 다 썼어요. '처음부터 다시 세기'를 누르세요." : `다음에 보낼 글: 시험 ${String(max + 1)}`)
  return lines
}

export interface SmsTestBoxOptions {
  readonly token: string
  /** 시계 (시험에서 바꾼다) */
  readonly now?: () => Date
}

export interface SmsTestBox {
  /** /_try/sms-test 요청 처리 (그 밖의 주소는 null) */
  handle(request: Request): Promise<Response | null>
  /** 지금 들고 있는 것 (새것이 앞) */
  entries(): readonly SmsTestEntry[]
}

export function createSmsTestBox(options: SmsTestBoxOptions): SmsTestBox {
  const now = options.now ?? (() => new Date())
  /** 새것이 앞 */
  const list: MutableEntry[] = []
  let seq = 0
  /** 50건이 넘어 오래된 줄이 밀려났는지 (다시 세기로 지운다) */
  let dropped = false

  const viewHref = `${SMS_TEST_PATH}?t=${encodeURIComponent(options.token)}`

  async function receive(request: Request): Promise<Response> {
    if (!sameToken(request.headers.get('x-try-token'), options.token)) return json({ error: '시험 토큰이 맞지 않아요.' }, 401)
    const length = Number(request.headers.get('content-length') ?? '0')
    if (length > SMS_TEST_REQUEST_MAX) return json({ error: '너무 길어요.' }, 413)
    const text = await request.text()
    if (Buffer.byteLength(text, 'utf8') > SMS_TEST_REQUEST_MAX) return json({ error: '너무 길어요.' }, 413)
    let input: unknown
    try {
      input = JSON.parse(text)
    } catch {
      return json({ error: 'JSON 모양으로 보내 주세요.' }, 400)
    }
    if (typeof input !== 'object' || input === null || Array.isArray(input)) return json({ error: 'JSON 모양으로 보내 주세요.' }, 400)
    const record = input as Record<string, unknown>
    const { last4, senderKind } = maskSender(record['from'])
    const body = typeof record['body'] === 'string' ? cut(record['body'], SMS_TEST_BODY_MAX) : ''
    const device = typeof record['device'] === 'string' && record['device'].trim() !== '' ? cut(record['device'].trim(), SMS_TEST_DEVICE_MAX) : '알 수 없음'
    const serial = readSerial(body)
    const key = JSON.stringify([device, senderKind, last4, body])
    const same = list.find((entry) => entry.key === key)
    if (same !== undefined) {
      same.count += 1
      return json({ ok: true, seq: same.seq, last4, serial, duplicate: true }, 200)
    }
    const serverAt = now()
    seq += 1
    list.unshift({ seq, last4, senderKind, body, device, serial, count: 1, phoneAt: parsePhoneAt(record['receivedAt'], serverAt), serverAt, key })
    if (list.length > SMS_TEST_LIMIT) {
      list.length = SMS_TEST_LIMIT
      dropped = true
    }
    return json({ ok: true, seq, last4, serial, duplicate: false }, 200)
  }

  function senderText(entry: MutableEntry): string {
    if (entry.senderKind === 'number') return `보낸 사람 끝 ${entry.last4 ?? ''}`
    if (entry.senderKind === 'name') return '번호 대신 이름이 왔어요'
    return '보낸 사람 없음'
  }

  function summary(): string {
    const e = escapeHtml
    const parts: string[] = ['<section>', '<h2>요약</h2>']
    if (list.length === 0) {
      parts.push("<p>아직 받은 문자가 없어요. 다른 휴대폰에서 사장님 번호로 '시험 1'을 보내 보세요.</p>")
      parts.push('<p>다음에 보낼 글: 시험 1</p>')
    } else {
      const groups = new Map<string, MutableEntry[]>()
      for (const entry of list.slice().reverse()) {
        const group = groups.get(entry.device)
        if (group === undefined) groups.set(entry.device, [entry])
        else group.push(entry)
      }
      for (const [device, arrived] of groups) {
        parts.push('<div class="group">')
        parts.push(`<h3>${e(device)} — 받은 문자 ${String(arrived.length)}건</h3>`)
        // 요약 문장에는 받은 글이 들어가지 않는다(숫자·고정 문장뿐) — 그래도 이스케이프해 둔다(따옴표는 글 그대로 보이게 남김)
        for (const line of summarizeDevice(arrived)) parts.push(`<p>${text(line)}</p>`)
        parts.push('</div>')
      }
    }
    if (dropped) parts.push("<p>50건이 넘어 오래된 문자는 지워졌어요. 빠진 번호가 틀릴 수 있으니 '처음부터 다시 세기'를 누르고 다시 시험하세요.</p>")
    parts.push(`<p>최근 ${String(SMS_TEST_LIMIT)}건 안에서만 세요. 연습 모드를 끄면 모두 사라져요.</p>`)
    parts.push('</section>')
    return parts.join('\n')
  }

  function card(entry: MutableEntry): string {
    const e = escapeHtml
    const head = `${String(entry.seq)}번째 · ${entry.serial === null ? '번호 없음' : `시험 ${String(entry.serial)}`}`
    const lines = [
      `<div class="card">`,
      `<p class="top"><span>${head}</span> · <span>늦은 정도 ${delayLabel(delayOf(entry))}</span></p>`,
      `<p>휴대폰이 받은 시각 ${entry.phoneAt === null ? '-' : kst(entry.phoneAt)}</p>`,
      `<p>서버가 받은 시각 ${kst(entry.serverAt)}</p>`,
      `<p>${e(senderText(entry))}</p>`,
      `<p>기기 ${e(entry.device)}</p>`,
    ]
    if (entry.count > 1) lines.push(`<p>${String(entry.count)}번 왔어요 (한 번으로 셌어요)</p>`)
    lines.push(`<div class="b">${e(entry.body)}</div>`, '</div>')
    return lines.join('\n')
  }

  function page(): string {
    const e = escapeHtml
    const guide = [
      '<section>',
      '<h2>시험 순서</h2>',
      '<ol>',
      "<li>다른 휴대폰에서 사장님 번호로 '시험 1', '시험 2', '시험 3'… 차례로 보내세요.</li>",
      "<li>기기마다 '다음에 보낼 글'을 보고 보내면 돼요.</li>",
      '<li>다 보냈으면 이 화면을 사진으로 찍어 두세요.</li>',
      '</ol>',
      '</section>',
    ].join('\n')
    const reset = `<p><a class="btn" href="${e(`${viewHref}&do=reset-ask`)}">처음부터 다시 세기</a></p>`
    const cards = list.length === 0 ? '' : `<section>\n<h2>받은 문자 (새것이 위)</h2>\n${list.map(card).join('\n')}\n</section>`
    const note = `<p>5초마다 새로 보여요. 보낸 사람 번호는 끝 4자리만 남겨요. 지금 ${String(list.length)}건.</p>`
    return pageShell([note, summary(), guide, reset, cards].filter((part) => part !== '').join('\n'), true)
  }

  function askPage(): string {
    const e = escapeHtml
    return pageShell(
      [
        `<p>받은 시험 문자 ${String(list.length)}건을 지우고 처음부터 셀까요? 지우면 되돌릴 수 없어요. 결과 사진을 먼저 찍어 두세요.</p>`,
        `<form method="post" action="${e(`${viewHref}&do=reset`)}"><button class="btn danger" type="submit">네, 지우고 처음부터 셀게요</button></form>`,
        `<p><a class="btn" href="${e(viewHref)}">아니요, 돌아갈게요</a></p>`,
      ].join('\n'),
      false,
    )
  }

  const badTokenPage = () =>
    html('<!doctype html><html lang="ko"><meta charset="utf-8"><title>문자 자동 수신 시험</title><p>시험 토큰이 맞지 않아요. 터미널에 나온 주소를 그대로 여세요.</p></html>\n', 401)

  return {
    async handle(request) {
      const url = new URL(request.url)
      if (url.pathname !== SMS_TEST_PATH) return null
      const action = url.searchParams.get('do')
      if (request.method === 'POST') {
        if (action === null) return receive(request)
        if (action !== 'reset') return json({ error: '없는 방법이에요.' }, 400)
        // 지우기는 주소의 t로만 (머리글 토큰으로는 지우지 않는다, D-SMS2-07)
        if (!sameToken(url.searchParams.get('t'), options.token)) return json({ error: '시험 토큰이 맞지 않아요.' }, 401)
        list.length = 0
        seq = 0
        dropped = false
        return new Response(null, { status: 303, headers: { ...TEXT_HEADERS, location: viewHref } })
      }
      if (request.method === 'GET') {
        if (!sameToken(url.searchParams.get('t'), options.token)) return badTokenPage()
        if (action === 'reset-ask') return html(askPage(), 200)
        return html(page(), 200)
      }
      return json({ error: '없는 방법이에요.' }, 405)
    },
    entries: () =>
      list.map(({ seq: s, last4, senderKind, body, device, serial, count, phoneAt, serverAt }) => ({ seq: s, last4, senderKind, body, device, serial, count, phoneAt, serverAt })),
  }
}

/**
 * 같은 와이파이용 http 받는 곳 (SMST) — 단축어·MacroDroid가 자체 서명 https를 거절할 때 쓴다.
 * /_try/sms-test(POST·GET)만 응답하고 나머지 모든 주소는 404. 토큰 검사·끝 4자리·50건·이스케이프는 같은 상자(box)가 한다.
 * 연습 서버 안쪽으로 넘기지 않는다(앱·로그인·다른 연습 경로는 이 포트로 닿지 않는다).
 */
export function createSmsTestHttpServer(box: SmsTestBox): Server {
  const notFound = (res: ServerResponse) => {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    res.end('없는 주소예요.')
  }
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://sms-test.local')
      if (url.pathname !== SMS_TEST_PATH || (req.method !== 'POST' && req.method !== 'GET')) {
        req.resume()
        notFound(res)
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      let tooBig = false
      for await (const chunk of req as AsyncIterable<Buffer>) {
        size += chunk.length
        if (size > SMS_TEST_REQUEST_MAX) {
          tooBig = true
          break
        }
        chunks.push(chunk)
      }
      if (tooBig) {
        res.writeHead(413, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', connection: 'close' })
        res.end(JSON.stringify({ error: '너무 길어요.' }))
        return
      }
      const headers = new Headers()
      const token = req.headers['x-try-token']
      if (typeof token === 'string') headers.set('x-try-token', token)
      const request = new Request(url, req.method === 'POST' ? { method: 'POST', headers, body: Buffer.concat(chunks) } : { method: 'GET', headers })
      const response = await box.handle(request)
      if (response === null) {
        notFound(res)
        return
      }
      const out: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        out[key] = value
      })
      const body = Buffer.from(await response.arrayBuffer())
      res.writeHead(response.status, { ...out, 'content-length': String(body.length) })
      res.end(body)
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
  })
}
