// SMST: 연습 모드 전용 문자 자동 수신 시험 받는 곳 (/_try/sms-test). 포트를 열지 않고 handle(Request)로 부른다.
import { describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { createSmsTestBox, createSmsTestHttpServer, makeSmsTestToken, maskSender, SMS_TEST_BODY_MAX, SMS_TEST_LIMIT, SMS_TEST_PATH } from '../src/try/sms-test.ts'

const TOKEN = 'abcd-efgh-jk23'
const BASE = `https://192.168.0.10:7701${SMS_TEST_PATH}`
const RAW_PHONE = '010-9876-5432'

function post(body: unknown, token: string | null = TOKEN): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token !== null) headers['x-try-token'] = token
  return new Request(BASE, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) })
}

function get(token: string | null = TOKEN): Request {
  return new Request(token === null ? BASE : `${BASE}?t=${encodeURIComponent(token)}`)
}

async function mustHandle(box: ReturnType<typeof createSmsTestBox>, request: Request): Promise<Response> {
  const response = await box.handle(request)
  if (response === null) throw new Error('응답 없음')
  return response
}

describe('SMST 문자 자동 수신 시험', () => {
  it('토큰이 없거나 틀리면 401이고 아무것도 들고 있지 않다', async () => {
    const box = createSmsTestBox({ token: TOKEN })
    expect((await mustHandle(box, post({ from: RAW_PHONE, body: '5번' }, null))).status).toBe(401)
    expect((await mustHandle(box, post({ from: RAW_PHONE, body: '5번' }, 'wrong-token'))).status).toBe(401)
    expect((await mustHandle(box, get(null))).status).toBe(401)
    expect((await mustHandle(box, get('wrong'))).status).toBe(401)
    expect(box.entries()).toHaveLength(0)
  })

  it('다른 주소는 맡지 않는다', async () => {
    const box = createSmsTestBox({ token: TOKEN })
    expect(await box.handle(new Request('https://x/_try/chat'))).toBeNull()
  })

  it('번호는 끝 4자리만 남고, 원문 번호는 응답·메모리·화면 어디에도 없다', async () => {
    const box = createSmsTestBox({ token: TOKEN, now: () => new Date('2026-10-25T05:00:03Z') })
    const response = await mustHandle(box, post({ from: RAW_PHONE, body: '165번주세요', device: 'iPhone', receivedAt: '2026-10-25T05:00:00Z' }))
    expect(response.status).toBe(200)
    const answer = await response.text()
    expect(answer).toContain('5432')
    const entries = box.entries()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.last4).toBe('5432')
    expect(entries[0]?.senderKind).toBe('number')
    const page = await (await mustHandle(box, get())).text()
    expect(page).toContain('끝 5432')
    expect(page).toContain('165번주세요')
    expect(page).toContain('3초')
    for (const raw of ['010-9876-5432', '01098765432', '9876']) {
      expect(answer).not.toContain(raw)
      expect(JSON.stringify(entries)).not.toContain(raw)
      expect(page).not.toContain(raw)
    }
  })

  it('+82 국제 모양도 끝 4자리, 연락처 이름은 남기지 않는다', async () => {
    expect(maskSender('+82 10-1234-5678')).toEqual({ last4: '5678', senderKind: 'number' })
    expect(maskSender('김다육')).toEqual({ last4: null, senderKind: 'name' })
    expect(maskSender('')).toEqual({ last4: null, senderKind: 'empty' })
    expect(maskSender(undefined)).toEqual({ last4: null, senderKind: 'empty' })
    const box = createSmsTestBox({ token: TOKEN })
    await mustHandle(box, post({ from: '김다육', body: '찜' }))
    expect(JSON.stringify(box.entries())).not.toContain('김다육')
    expect(await (await mustHandle(box, get())).text()).not.toContain('김다육')
  })

  it('최근 50건만 들고 있다 (새것이 앞)', async () => {
    const box = createSmsTestBox({ token: TOKEN })
    for (let i = 0; i < SMS_TEST_LIMIT + 7; i++) await mustHandle(box, post({ from: `0101234${String(1000 + i)}`, body: `${String(i)}번` }))
    const entries = box.entries()
    expect(entries).toHaveLength(SMS_TEST_LIMIT)
    expect(entries[0]?.body).toBe(`${String(SMS_TEST_LIMIT + 6)}번`)
    expect(entries.at(-1)?.body).toBe('7번')
  })

  it('본문은 200자까지', async () => {
    const box = createSmsTestBox({ token: TOKEN })
    await mustHandle(box, post({ from: RAW_PHONE, body: '가'.repeat(500) }))
    expect(box.entries()[0]?.body).toBe('가'.repeat(SMS_TEST_BODY_MAX))
  })

  it('JSON이 아니면 400, 아무것도 들고 있지 않다', async () => {
    const box = createSmsTestBox({ token: TOKEN })
    expect((await mustHandle(box, post('from=1'))).status).toBe(400)
    expect(box.entries()).toHaveLength(0)
  })

  it('화면의 본문·기기 이름은 이스케이프한다', async () => {
    const box = createSmsTestBox({ token: TOKEN })
    await mustHandle(box, post({ from: RAW_PHONE, body: '<script>alert("x")</script>&\'', device: '<img src=x onerror=alert(1)>' }))
    const response = await mustHandle(box, get())
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'")
    const page = await response.text()
    expect(page).not.toContain('<script>')
    expect(page).not.toContain('<img')
    expect(page).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;')
    expect(page).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(page).toContain('http-equiv="refresh" content="5"')
  })

  it('토큰은 켤 때마다 새로 (12글자, 헷갈리는 글자 없음)', () => {
    const a = makeSmsTestToken()
    expect(a).toMatch(/^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/)
    expect(makeSmsTestToken()).not.toBe(a)
  })
})

describe('SMST 같은 와이파이 http 받는 곳 (문자 시험만)', () => {
  async function open() {
    const box = createSmsTestBox({ token: TOKEN })
    const server = createSmsTestHttpServer(box)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
    const close = () => new Promise<void>((resolve) => server.close(() => resolve()))
    return { box, base, close }
  }

  it('다른 주소는 모두 404 — 앱·로그인·다른 연습 경로로 닿지 않는다', async () => {
    const { base, close } = await open()
    try {
      for (const path of ['/', '/api/auth/login', '/_try/chat', '/_try/sms-test/x', '/_try/sms-testx']) {
        expect((await fetch(`${base}${path}`)).status).toBe(404)
      }
      expect((await fetch(`${base}/api/auth/login`, { method: 'POST', body: '{}' })).status).toBe(404)
      expect((await fetch(`${base}${SMS_TEST_PATH}`, { method: 'PUT', body: '{}' })).status).toBe(404)
    } finally {
      await close()
    }
  })

  it('토큰이 없으면 401이고 아무것도 들고 있지 않다', async () => {
    const { box, base, close } = await open()
    try {
      const posted = await fetch(`${base}${SMS_TEST_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: RAW_PHONE, body: '5번' }) })
      expect(posted.status).toBe(401)
      expect((await fetch(`${base}${SMS_TEST_PATH}`)).status).toBe(401)
      expect(box.entries()).toHaveLength(0)
    } finally {
      await close()
    }
  })

  it('토큰이 맞으면 받고, 끝 4자리만 남고, 보기 화면은 이스케이프한다', async () => {
    const { box, base, close } = await open()
    try {
      const posted = await fetch(`${base}${SMS_TEST_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-try-token': TOKEN },
        body: JSON.stringify({ from: RAW_PHONE, body: '<b>5번</b>', device: 'iPhone' }),
      })
      expect(posted.status).toBe(200)
      const answer = await posted.text()
      expect(answer).toContain('5432')
      expect(answer).not.toContain('9876')
      expect(box.entries()).toHaveLength(1)
      const page = await (await fetch(`${base}${SMS_TEST_PATH}?t=${encodeURIComponent(TOKEN)}`)).text()
      expect(page).toContain('&lt;b&gt;5번&lt;/b&gt;')
      expect(page).not.toContain('<b>5번')
      expect(page).not.toContain('9876')
    } finally {
      await close()
    }
  })
})
