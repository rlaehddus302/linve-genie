// 연습 모드 전용 "문자 자동 수신 시험" 받는 곳 (SMST, 실험 도구 — 제품 기능 아님).
// 사장님 휴대폰(아이폰 단축어 자동화·갤럭시 MacroDroid)이 받은 문자를 연습 서버로 저절로 보내는지 시험한다.
// - 판정·문자찜에 잇지 않는다. 받은 것은 메모리에만 최근 50건(연습 모드를 끄면 사라진다).
// - 보낸 사람 번호는 저장 전에 끝 4자리만 남긴다. 원문 번호·연락처 이름은 메모리·응답·로그 어디에도 남기지 않는다(절대 규칙 7).
//   이 파일은 로그를 쓰지 않는다.
// - 머리글 X-Try-Token(보기 화면은 ?t=)이 켤 때마다 새로 만든 토큰과 같을 때만 받는다.
// - 보기 화면의 모든 글은 이스케이프한다(본문·기기 이름은 믿을 수 없는 입력).
import { createHash, randomInt, timingSafeEqual } from 'node:crypto'

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
  /** 몇 번째로 받았는지 (1부터) */
  readonly seq: number
  /** 보낸 사람 번호 끝 4자리 (번호가 아니면 null) */
  readonly last4: string | null
  readonly senderKind: SenderKind
  readonly body: string
  readonly device: string
  /** 휴대폰이 알려 준 받은 시각 (없거나 읽을 수 없으면 null) */
  readonly phoneAt: Date | null
  /** 서버가 받은 시각 */
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

function parsePhoneAt(value: unknown): Date | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

/** 한국 시각 "10월 25일 14:03:05" */
function kst(date: Date): string {
  const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000)
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

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: TEXT_HEADERS })
}

function html(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      ...TEXT_HEADERS,
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
    },
  })
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
  const list: SmsTestEntry[] = []
  let seq = 0

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
    seq += 1
    const entry: SmsTestEntry = { seq, last4, senderKind, body, device, phoneAt: parsePhoneAt(record['receivedAt']), serverAt: now() }
    list.unshift(entry)
    if (list.length > SMS_TEST_LIMIT) list.length = SMS_TEST_LIMIT
    return json({ ok: true, seq, last4 }, 200)
  }

  function senderText(entry: SmsTestEntry): string {
    if (entry.senderKind === 'number') return `끝 ${entry.last4 ?? ''}`
    if (entry.senderKind === 'name') return '번호 대신 이름이 왔어요'
    return '보낸 사람 없음'
  }

  function delayText(entry: SmsTestEntry): string {
    if (entry.phoneAt === null) return '-'
    const seconds = Math.round((entry.serverAt.getTime() - entry.phoneAt.getTime()) / 1000)
    return `${String(seconds)}초`
  }

  function page(): string {
    const e = escapeHtml
    const rows = list
      .map(
        (entry) =>
          `<tr><td>${String(entry.seq)}</td><td>${entry.phoneAt === null ? '-' : e(kst(entry.phoneAt))}</td><td>${e(kst(entry.serverAt))}</td><td>${e(delayText(entry))}</td><td>${e(senderText(entry))}</td><td>${e(entry.device)}</td><td class="b">${e(entry.body)}</td></tr>`,
      )
      .join('\n')
    const table =
      list.length === 0
        ? '<p>아직 받은 문자가 없어요. 휴대폰으로 문자를 보내 보세요.</p>'
        : `<table>\n<tr><th>번호</th><th>휴대폰이 받은 시각</th><th>서버가 받은 시각</th><th>늦은 정도</th><th>보낸 사람</th><th>보낸 기기</th><th>내용</th></tr>\n${rows}\n</table>`
    return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="5">
<title>문자 자동 수신 시험</title>
<style>body{font-family:sans-serif;margin:16px;font-size:16px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:6px;text-align:left;vertical-align:top}.b{white-space:pre-wrap;word-break:break-all}</style>
</head>
<body>
<h1>문자 자동 수신 시험</h1>
<p>5초마다 새로 보여요. 최근 ${String(SMS_TEST_LIMIT)}건까지만 들고 있고, 연습 모드를 끄면 모두 사라져요.</p>
<p>보낸 사람 번호는 끝 4자리만 남겨요. 지금 ${String(list.length)}건.</p>
${table}
</body>
</html>
`
  }

  return {
    async handle(request) {
      const url = new URL(request.url)
      if (url.pathname !== SMS_TEST_PATH) return null
      if (request.method === 'POST') return receive(request)
      if (request.method === 'GET') {
        if (!sameToken(url.searchParams.get('t'), options.token)) return html('<!doctype html><html lang="ko"><meta charset="utf-8"><title>문자 자동 수신 시험</title><p>시험 토큰이 맞지 않아요. 터미널에 나온 주소를 그대로 여세요.</p></html>\n', 401)
        return html(page(), 200)
      }
      return json({ error: '없는 방법이에요.' }, 405)
    },
    entries: () => list.slice(),
  }
}
