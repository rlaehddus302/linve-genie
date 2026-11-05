// D-UX3-30 휴대폰 번호로 같은 사람 묶기: 처음 온 소셜 계정은 문자 인증 뒤에만 계정이 생기고,
// 이미 있는 번호면 그 계정으로 새로 로그인해야 이 소셜 계정이 그 계정에 이어진다.
import { createHash, createHmac, randomBytes } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, describe, expect, it } from 'vitest'
import { codeText, maskedMobile, normalizeMobile, readSmsEnv, sensSender, sensSignature, smsBytes, type SmsSender } from '../src/social/phone.ts'
import { ORIGIN, addSeller, client } from './support.ts'
import { approve, cookieValue, newSocialWorld, openCallback, runFlow, type SocialWorld } from './l1-support.ts'

/** 보낸 문자를 모아 두는 발송기 (시험에서 인증번호를 읽는다) */
class RecordingSms implements SmsSender {
  readonly sent: { to: string; text: string }[] = []
  fail = false
  async send(to: string, text: string): Promise<void> {
    if (this.fail) throw new Error('down')
    this.sent.push({ to, text })
  }
  lastCode(): string {
    const text = this.sent.at(-1)?.text ?? ''
    const match = /인증번호 (\d{6})/.exec(text)
    if (match === null) throw new Error('인증번호 문자가 없다')
    return match[1] as string
  }
}

const worlds: SocialWorld[] = []
afterAll(async () => {
  for (const world of worlds) await world.fake.close()
})
const world = async (sms: RecordingSms | null = new RecordingSms()) => {
  const made = await newSocialWorld({ sms })
  worlds.push(made)
  return { w: made, sms: sms as RecordingSms }
}
/** 오류 본문 { error: { code, message } } */
const errorOf = (response: { readonly body: Record<string, unknown> }) => response.body.error as { readonly code: string; readonly message: string }
const pgOf = (w: SocialWorld) => w.database.pglite as PGlite
const count = async (w: SocialWorld, table: string) => (await pgOf(w).query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0]?.n ?? 0

const verifierPair = () => {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier, 'ascii').digest('base64url') }
}

async function appTicket(w: SocialWorld, provider: 'kakao' | 'naver' | 'google', user: string, challenge: string): Promise<string> {
  const started = await w.server.app.request(`/api/auth/app/start?provider=${provider}&challenge=${challenge}`)
  const browser = cookieValue(started.headers, '__Host-lj_oauth') as string
  const back = await openCallback(w, approve(w.fake, started.headers.get('location') as string, user), { browser })
  return new URL(back.headers.get('location') as string).searchParams.get('ticket') as string
}

/** 웹: 새 공급자 계정으로 들어와 가입 표 쿠키를 받는다 */
async function webSignupCookie(w: SocialWorld, provider: 'kakao' | 'naver' | 'google', user: string): Promise<string> {
  const flow = await runFlow(w, provider, user)
  expect(flow.result.login).toBe('SIGNUP')
  return `__Host-lj_signup=${cookieValue(flow.response.headers, '__Host-lj_signup') as string}`
}

/** 웹: 번호를 넣고 받은 인증번호로 확인한다 */
async function verifyPhone(w: SocialWorld, sms: RecordingSms, cookie: string, phone: string) {
  const sent = await client(w, cookie).post('/api/auth/signup/phone', { phone })
  expect(sent.status, sent.text).toBe(200)
  return client(w, cookie).post('/api/auth/signup/phone/verify', { code: sms.lastCode() })
}

describe('D-UX3-30 번호', () => {
  it('정규화·가린 번호', () => {
    expect(normalizeMobile('010-1234-5678')).toBe('01012345678')
    expect(normalizeMobile('+82 10 1234 5678')).toBe('01012345678')
    expect(normalizeMobile('0101234567')).toBe('0101234567')
    expect(normalizeMobile('02-123-4567')).toBeNull()
    expect(normalizeMobile('010-12')).toBeNull()
    expect(normalizeMobile(1012345678)).toBeNull()
    expect(maskedMobile('01012345678')).toBe('010-****-5678')
  })

  // D-REAL-07로 바뀐 기대: 옛 "솔라피 send-many 주소·HMAC-SHA256 hex 서명·키 셋" → 새 "SENS v2 주소·base64 서명 머리 셋·키 넷"
  it('SENS: 공식 서명 v2, 발송 주소·본문(80바이트 넘으면 장문), 접수 실패면 던진다. 설정은 넷 다 있거나 넷 다 없어야', async () => {
    const path = '/sms/v2/services/ncp:sms:kr:1:svc/messages'
    const expected = createHmac('sha256', 'secret').update(`POST ${path}\n1762300000000\nkey`).digest('base64')
    expect(sensSignature('secret', 'POST', path, '1762300000000', 'key')).toBe(expected)
    const calls: { url: string; init: RequestInit }[] = []
    let reply: unknown = { requestId: 'r', statusCode: '202', statusName: 'success' }
    let status = 202
    const fetchStub = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify(reply), { status, headers: { 'Content-Type': 'application/json' } })
    }) as unknown as typeof fetch
    const sender = sensSender({ accessKey: 'k', secretKey: 's', serviceId: 'ncp:sms:kr:1:svc', from: '0212345678', fetch: fetchStub })
    await sender.send('01012345678', '본문')
    expect(calls[0]?.url).toBe('https://sens.apigw.ntruss.com/sms/v2/services/ncp%3Asms%3Akr%3A1%3Asvc/messages')
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({ type: 'SMS', contentType: 'COMM', countryCode: '82', from: '0212345678', content: '본문', messages: [{ to: '01012345678' }] })
    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers['x-ncp-iam-access-key']).toBe('k')
    expect(headers['x-ncp-apigw-timestamp']).toMatch(/^\d{13}$/)
    expect(headers['x-ncp-apigw-signature-v2']).toBe(sensSignature('s', 'POST', '/sms/v2/services/ncp%3Asms%3Akr%3A1%3Asvc/messages', headers['x-ncp-apigw-timestamp'] ?? '', 'k'))
    // 인증번호 글은 단문(80바이트)에 들어간다
    expect(smsBytes(codeText('123456'))).toBeLessThanOrEqual(80)
    await sender.send('01012345678', '가'.repeat(41))
    expect(JSON.parse(calls[1]?.init.body as string).type).toBe('LMS')
    reply = { statusCode: '202', statusName: 'fail' }
    await expect(sender.send('01012345678', '본문')).rejects.toThrow()
    status = 401
    reply = { error: { errorCode: '200' } }
    await expect(sender.send('01012345678', '본문')).rejects.toThrow()

    expect(readSmsEnv({})).toEqual({ ok: true, setup: null })
    expect(readSmsEnv({ LIVEJJIM_SMS_NCP_ACCESS_KEY: 'k' }).ok).toBe(false)
    expect(readSmsEnv({ LIVEJJIM_SMS_NCP_ACCESS_KEY: 'k', LIVEJJIM_SMS_NCP_SECRET_KEY: 's', LIVEJJIM_SMS_FROM: '02-1234-5678' }).ok).toBe(false)
    expect(readSmsEnv({ LIVEJJIM_SMS_NCP_ACCESS_KEY: 'k', LIVEJJIM_SMS_NCP_SECRET_KEY: 's', LIVEJJIM_SMS_SENS_SERVICE_ID: 'ncp:sms:kr:1:svc', LIVEJJIM_SMS_FROM: '02-1234-5678' })).toEqual({
      ok: true,
      setup: { accessKey: 'k', secretKey: 's', serviceId: 'ncp:sms:kr:1:svc', from: '0212345678' },
    })
  })
})

describe('D-UX3-30 가입은 문자 인증 뒤', () => {
  it('웹: 인증 전 가입은 409, 틀린 번호는 남은 횟수, 맞으면 새 번호로 가입하고 계정에 가린 번호가 붙는다', async () => {
    const { w, sms } = await world()
    const cookie = await webSignupCookie(w, 'kakao', w.fake.addUser('kakao').id)
    expect((await client(w, cookie).post('/api/auth/signup', { agree: true })).status).toBe(409)
    expect((await client(w, cookie).post('/api/auth/signup/phone', { phone: '02-1234-5678' })).status).toBe(400)
    const sent = await client(w, cookie).post('/api/auth/signup/phone', { phone: '010-1234-5678' })
    expect(sent.body).toEqual({ phone: '010-****-5678' })
    expect(sms.sent).toHaveLength(1)
    expect(sms.sent[0]?.to).toBe('01012345678')
    // 60초 안에 다시 받기는 막는다
    expect((await client(w, cookie).post('/api/auth/signup/phone', { phone: '010-1234-5678' })).status).toBe(429)
    const wrong = await client(w, cookie).post('/api/auth/signup/phone/verify', { code: sms.lastCode() === '000000' ? '111111' : '000000' })
    expect(wrong.status).toBe(400)
    expect(errorOf(wrong).message).toBe('인증번호가 맞지 않아요. 4번 더 넣을 수 있어요.')
    const ok = await client(w, cookie).post('/api/auth/signup/phone/verify', { code: sms.lastCode() })
    expect(ok.body).toEqual({ next: 'SIGNUP', phone: '010-****-5678' })
    const made = await client(w, cookie).post('/api/auth/signup', { agree: true })
    expect(made.status, made.text).toBe(200)
    const session = `lj_session=${cookieValue(made.headers, 'lj_session') as string}`
    expect((await client(w, session).get('/api/me')).body).toMatchObject({ phone: '010-****-5678', phoneRequired: false })
    // 원문 번호는 어디에도 두지 않는다
    const row = (await pgOf(w).query<{ phone_hash: string; phone_label: string }>('select phone_hash, phone_label from accounts')).rows[0]
    expect(row?.phone_label).toBe('010-****-5678')
    expect(row?.phone_hash).not.toContain('01012345678')
  })

  it('3분이 지나거나 5번 틀리면 인증번호를 다시 받아야 한다. 문자를 못 보내면 502', async () => {
    const { w, sms } = await world()
    const cookie = await webSignupCookie(w, 'naver', w.fake.addUser('naver').id)
    await client(w, cookie).post('/api/auth/signup/phone', { phone: '01022223333' })
    w.clock.advance(3 * 60 * 1000 + 1)
    expect(errorOf(await client(w, cookie).post('/api/auth/signup/phone/verify', { code: sms.lastCode() })).code).toBe('CODE_EXPIRED')
    await client(w, cookie).post('/api/auth/signup/phone', { phone: '01022223333' })
    const right = sms.lastCode()
    const bad = right === '000000' ? '111111' : '000000'
    for (let i = 0; i < 5; i++) await client(w, cookie).post('/api/auth/signup/phone/verify', { code: bad })
    expect((await client(w, cookie).post('/api/auth/signup/phone/verify', { code: right })).status).toBe(410)
    w.clock.advance(61 * 1000)
    sms.fail = true
    expect((await client(w, cookie).post('/api/auth/signup/phone', { phone: '01022223333' })).status).toBe(502)
    expect(await count(w, 'sellers')).toBe(0)
  })

  it('문자 발송이 설정되지 않은 서버는 전처럼 바로 가입한다 (번호 경로는 404)', async () => {
    const { w } = await world(null)
    const cookie = await webSignupCookie(w, 'kakao', w.fake.addUser('kakao').id)
    expect((await client(w, cookie).post('/api/auth/signup/phone', { phone: '01012345678' })).status).toBe(404)
    const made = await client(w, cookie).post('/api/auth/signup', { agree: true })
    expect(made.status).toBe(200)
    const session = `lj_session=${cookieValue(made.headers, 'lj_session') as string}`
    expect((await client(w, session).get('/api/me')).body).toMatchObject({ phone: null, phoneRequired: false })
  })
})

describe('D-UX3-30 이미 있는 번호면 그 계정에 잇기', () => {
  it('웹: 카카오로 가입한 사람이 구글로 오면 새 계정을 만들지 않고, 카카오로 다시 로그인한 뒤 구글이 이어진다', async () => {
    const { w, sms } = await world()
    const kakao = w.fake.addUser('kakao')
    const first = await webSignupCookie(w, 'kakao', kakao.id)
    await verifyPhone(w, sms, first, '010-5555-6666')
    expect((await client(w, first).post('/api/auth/signup', { agree: true })).status).toBe(200)
    const oldSession = (await runFlow(w, 'kakao', kakao.id)).session as string
    w.clock.advance(61 * 1000)

    const google = w.fake.addUser('google')
    const second = await webSignupCookie(w, 'google', google.id)
    const verified = await verifyPhone(w, sms, second, '01055556666')
    expect(verified.body).toEqual({ next: 'LOGIN_EXISTING', phone: '010-****-6666', providers: ['kakao'], password: false })
    // 그 번호의 계정이 있으면 새로 만들지 않는다
    expect((await client(w, second).post('/api/auth/signup', { agree: true })).status).toBe(409)
    // 번호 확인 전에 열려 있던 세션으로는 잇지 않는다
    w.clock.advance(1000)
    expect(errorOf(await client(w, `${oldSession}; ${second}`).post('/api/auth/signup/link', {})).code).toBe('LINK_MISMATCH')
    // 카카오로 새로 로그인한 세션이면 잇는다
    const relogin = await runFlow(w, 'kakao', kakao.id)
    const linked = await client(w, `${relogin.session as string}; ${second}`).post('/api/auth/signup/link', {})
    expect(linked.status, linked.text).toBe(200)
    expect(linked.body.provider).toBe('google')
    expect(cookieValue(linked.headers, '__Host-lj_signup')).toBe('')
    // 이제 구글로 바로 그 계정에 들어온다
    const byGoogle = await runFlow(w, 'google', google.id)
    expect(byGoogle.result.location).toBe(`${ORIGIN}/`)
    expect(await count(w, 'sellers')).toBe(1)
    expect(await count(w, 'login_links')).toBe(2)
  })

  it('다른 계정으로 로그인해서는 잇지 못한다', async () => {
    const { w, sms } = await world()
    const kakao = w.fake.addUser('kakao')
    const first = await webSignupCookie(w, 'kakao', kakao.id)
    await verifyPhone(w, sms, first, '01077778888')
    await client(w, first).post('/api/auth/signup', { agree: true })
    const stranger = await addSeller(w)
    const second = await webSignupCookie(w, 'naver', w.fake.addUser('naver').id)
    w.clock.advance(61 * 1000)
    await verifyPhone(w, sms, second, '01077778888')
    const fresh = await client(w, null).post('/api/login', { loginId: stranger.loginId, password: stranger.password })
    const session = `lj_session=${cookieValue(fresh.headers, 'lj_session') as string}`
    expect(errorOf(await client(w, `${session}; ${second}`).post('/api/auth/signup/link', {})).code).toBe('LINK_MISMATCH')
    expect(await count(w, 'login_links')).toBe(1)
  })

  it('앱: 구글 가입 표 → 번호 확인 → 기존 네이버로 앱 로그인 → 표·검증 값으로 잇기', async () => {
    const { w, sms } = await world()
    const naver = w.fake.addUser('naver')
    const a = verifierPair()
    const t1 = await appTicket(w, 'naver', naver.id, a.challenge)
    const app = client(w, null)
    expect((await app.post('/api/auth/app/finish', { ticket: t1, verifier: a.verifier })).body).toEqual({ result: 'SIGNUP', provider: 'naver', phoneRequired: true })
    await app.post('/api/auth/signup/phone', { phone: '01090001000', ticket: t1, verifier: a.verifier })
    expect((await app.post('/api/auth/signup/phone/verify', { code: sms.lastCode(), ticket: t1, verifier: a.verifier })).body.next).toBe('SIGNUP')
    expect((await app.post('/api/auth/signup', { agree: true, ticket: t1, verifier: a.verifier })).status).toBe(200)
    w.clock.advance(61 * 1000)

    const google = w.fake.addUser('google')
    const b = verifierPair()
    const t2 = await appTicket(w, 'google', google.id, b.challenge)
    await app.post('/api/auth/signup/phone', { phone: '010-9000-1000', ticket: t2, verifier: b.verifier })
    expect((await app.post('/api/auth/signup/phone/verify', { code: sms.lastCode(), ticket: t2, verifier: b.verifier })).body).toMatchObject({ next: 'LOGIN_EXISTING', providers: ['naver'] })
    w.clock.advance(1000)
    const c = verifierPair()
    const t3 = await appTicket(w, 'naver', naver.id, c.challenge)
    const logged = await app.post('/api/auth/app/finish', { ticket: t3, verifier: c.verifier })
    expect(logged.body.result).toBe('LOGGED_IN')
    const session = `lj_session=${cookieValue(logged.headers, 'lj_session') as string}`
    // 다른 검증 값이면 잇지 못한다
    expect((await client(w, session).post('/api/auth/signup/link', { ticket: t2, verifier: c.verifier })).status).toBe(410)
    const linked = await client(w, session).post('/api/auth/signup/link', { ticket: t2, verifier: b.verifier })
    expect(linked.status, linked.text).toBe(200)
    expect((linked.body.methods as { providers: { provider: string; linked: boolean }[] }).providers.filter((p) => p.linked).map((p) => p.provider)).toEqual(['naver', 'google'])
    expect(await count(w, 'sellers')).toBe(1)
  })
})

describe('D-UX3-30 번호가 없는 기존 계정', () => {
  it('내 정보가 번호 확인을 요구하고, 확인하면 번호가 붙는다. 다른 계정의 번호는 받지 않는다', async () => {
    const { w, sms } = await world()
    const seller = await addSeller(w)
    expect((await client(w, seller.cookie).get('/api/me')).body).toMatchObject({ phone: null, phoneRequired: true })
    expect((await client(w, seller.cookie).post('/api/auth/phone', { phone: '01011112222' })).status).toBe(200)
    const saved = await client(w, seller.cookie).post('/api/auth/phone/verify', { code: sms.lastCode() })
    expect(saved.body).toEqual({ phone: '010-****-2222' })
    expect((await client(w, seller.cookie).get('/api/me')).body).toMatchObject({ phone: '010-****-2222', phoneRequired: false })
    expect((await client(w, seller.cookie).get('/api/auth/methods')).body.phone).toBe('010-****-2222')

    const other = await addSeller(w)
    await client(w, other.cookie).post('/api/auth/phone', { phone: '010-1111-2222' })
    const taken = await client(w, other.cookie).post('/api/auth/phone/verify', { code: sms.lastCode() })
    expect(taken.status).toBe(409)
    expect(errorOf(taken).code).toBe('PHONE_TAKEN')
    expect((await client(w, other.cookie).get('/api/me')).body).toMatchObject({ phone: null })
  })
})
