// D-UX3-28 간편 로그인으로 바로 가입(약관 동의 뒤)·앱 안 간편 로그인(앱 표 + 검증 값).
import { createHash, randomBytes } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, describe, expect, it } from 'vitest'
import { ORIGIN, addSeller, client } from './support.ts'
import { approve, cookieValue, newSocialWorld, openCallback, runFlow, type SocialWorld } from './l1-support.ts'

const worlds: SocialWorld[] = []
afterAll(async () => {
  for (const world of worlds) await world.fake.close()
})
const world = async () => {
  const made = await newSocialWorld()
  worlds.push(made)
  return made
}
const pgOf = (w: SocialWorld) => w.database.pglite as PGlite
const count = async (w: SocialWorld, table: string) => (await pgOf(w).query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0]?.n ?? 0

const verifierPair = () => {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier, 'ascii').digest('base64url') }
}

/** 앱 안 로그인 창: 시작 주소 → 가짜 승인 → 돌아오는 주소. 창의 쿠키는 앱과 따로다 */
async function appFlow(w: SocialWorld, provider: 'kakao' | 'naver' | 'google', user: string | null, challenge: string) {
  const started = await w.server.app.request(`/api/auth/app/start?provider=${provider}&challenge=${challenge}`)
  expect(started.status).toBe(302)
  const browser = cookieValue(started.headers, '__Host-lj_oauth') as string
  expect(browser).not.toBeNull()
  const location = approve(w.fake, started.headers.get('location') as string, user)
  const back = await openCallback(w, location, { browser })
  expect(back.status).toBe(302)
  // 앱 안 로그인 창에는 세션을 주지 않는다
  expect(cookieValue(back.headers, 'lj_session')).toBeNull()
  return new URL(back.headers.get('location') as string)
}

describe('D-UX3-28 간편 로그인으로 가입', () => {
  it('웹: 연결 안 된 카카오 계정 → 가입 표 쿠키 → 동의하면 새 판매자(내 가게·lg- 아이디·비밀번호 없음)와 연결·세션이 생기고, 다음부터는 바로 로그인된다', async () => {
    const w = await world()
    const user = w.fake.addUser('kakao', { nickname: '다육이네' })
    const flow = await runFlow(w, 'kakao', user.id)
    expect(flow.result.location).toBe(`${ORIGIN}/?login=SIGNUP&provider=kakao`)
    const ticket = cookieValue(flow.response.headers, '__Host-lj_signup') as string
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const cookie = `__Host-lj_signup=${ticket}`
    // 동의하지 않으면 400, 아무것도 만들지 않는다
    expect((await client(w, cookie).post('/api/auth/signup', {})).status).toBe(400)
    expect((await client(w, cookie).post('/api/auth/signup', { agree: false })).status).toBe(400)
    expect(await count(w, 'sellers')).toBe(0)
    const made = await client(w, cookie).post('/api/auth/signup', { agree: true })
    expect(made.status, made.text).toBe(200)
    // D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 역할(role) 칸을 없애 옛 기대 role: 'SELLER'를 뺐다
    expect(made.body).toMatchObject({ seller: { name: '내 가게' } })
    expect(made.body).not.toHaveProperty('role')
    expect(made.body.loginId as string).toMatch(/^lg-[a-z2-9]{8}$/)
    const session = cookieValue(made.headers, 'lj_session') as string
    expect(cookieValue(made.headers, '__Host-lj_signup')).toBe('')
    expect((await client(w, `lj_session=${session}`).get('/api/me')).status).toBe(200)
    const rows = (await pgOf(w).query<{ password_hash: string; terms_agreed_at: Date | null; method: string }>(
      `select a.password_hash, a.terms_agreed_at, s.method from accounts a join sessions s on s.account_id = a.id`,
    )).rows
    expect(rows).toHaveLength(1)
    expect(rows[0]?.password_hash).toBe('')
    expect(rows[0]?.terms_agreed_at).not.toBeNull()
    expect(rows[0]?.method).toBe('KAKAO')
    // 같은 표는 한 번만
    expect((await client(w, cookie).post('/api/auth/signup', { agree: true })).status).toBe(410)
    expect(await count(w, 'sellers')).toBe(1)
    // 다음부터는 같은 카카오 계정으로 바로 로그인
    const again = await runFlow(w, 'kakao', user.id)
    expect(again.result.location).toBe(`${ORIGIN}/`)
    expect(again.session).not.toBeNull()
    expect(await count(w, 'sellers')).toBe(1)
    // 비밀번호가 없으니 마지막 간편 로그인은 끊을 수 없다
    const unlink = await client(w, `lj_session=${session}`).post('/api/auth/unlink', { provider: 'kakao' })
    expect(unlink.status).toBe(409)
  })

  it('웹: 30분이 지난 가입 표·모르는 표는 410이고 아무것도 만들지 않는다. 같은 공급자 계정이 두 탭에서 가입해도 계정은 하나', async () => {
    const w = await world()
    const user = w.fake.addUser('naver')
    const first = cookieValue((await runFlow(w, 'naver', user.id)).response.headers, '__Host-lj_signup') as string
    const second = cookieValue((await runFlow(w, 'naver', user.id)).response.headers, '__Host-lj_signup') as string
    expect((await client(w, `__Host-lj_signup=${'A'.repeat(43)}`).post('/api/auth/signup', { agree: true })).status).toBe(410)
    expect((await client(w, `__Host-lj_signup=${first}`).post('/api/auth/signup', { agree: true })).status).toBe(200)
    const other = await client(w, `__Host-lj_signup=${second}`).post('/api/auth/signup', { agree: true })
    expect(other.status).toBe(200)
    expect(await count(w, 'sellers')).toBe(1)
    const late = cookieValue((await runFlow(w, 'google', w.fake.addUser('google').id)).response.headers, '__Host-lj_signup') as string
    // D-UX3-30: 가입 표는 30분 (전: 10분 — 문자 인증·기존 계정 로그인까지 마칠 시간)
    w.clock.advance(30 * 60 * 1000)
    expect((await client(w, `__Host-lj_signup=${late}`).post('/api/auth/signup', { agree: true })).status).toBe(410)
    expect(await count(w, 'sellers')).toBe(1)
  })
})

describe('D-UX3-28 앱 안 간편 로그인', () => {
  it('처음 계정: 앱으로 표가 돌아오고, 검증 값이 맞아야 SIGNUP → 동의하면 앱에 세션 쿠키. 다음 로그인은 LOGGED_IN, 표는 한 번만', async () => {
    const w = await world()
    const user = w.fake.addUser('google', { email: 'seller@example.com' })
    const { verifier, challenge } = verifierPair()
    const back = await appFlow(w, 'google', user.id, challenge)
    expect(`${back.protocol}//${back.host}`).toBe('livejjim://auth')
    expect(back.searchParams.get('provider')).toBe('google')
    const ticket = back.searchParams.get('ticket') as string
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const app = client(w, null)
    // 검증 값이 다르면(다른 앱이 주소를 가로챔) 410
    expect((await app.post('/api/auth/app/finish', { ticket, verifier: verifierPair().verifier })).status).toBe(410)
    expect((await app.post('/api/auth/signup', { agree: true, ticket, verifier: verifierPair().verifier })).status).toBe(410)
    const finish = await app.post('/api/auth/app/finish', { ticket, verifier })
    // D-UX3-30: 문자 인증을 하는지 함께 알린다 (전: { result, provider }) — 이 서버는 문자 발송이 없어 false
    expect(finish.body).toEqual({ result: 'SIGNUP', provider: 'google', phoneRequired: false })
    expect(cookieValue(finish.headers, 'lj_session')).toBeNull()
    const made = await app.post('/api/auth/signup', { agree: true, ticket, verifier })
    expect(made.status, made.text).toBe(200)
    expect(cookieValue(made.headers, 'lj_session')).not.toBeNull()
    expect(await count(w, 'sellers')).toBe(1)

    const next = verifierPair()
    const loginBack = await appFlow(w, 'google', user.id, next.challenge)
    const loginTicket = loginBack.searchParams.get('ticket') as string
    const done = await app.post('/api/auth/app/finish', { ticket: loginTicket, verifier: next.verifier })
    expect(done.status).toBe(200)
    // D-UX3-32: 옛 기대 me.role 'SELLER'를 뺐다
    expect(done.body).toMatchObject({ result: 'LOGGED_IN', me: { seller: { name: '내 가게' } } })
    const token = cookieValue(done.headers, 'lj_session') as string
    expect((await client(w, `lj_session=${token}`).get('/api/me')).status).toBe(200)
    expect((await app.post('/api/auth/app/finish', { ticket: loginTicket, verifier: next.verifier })).status).toBe(410)
  })

  it('이미 연결한 판매자: 앱 로그인이 그 계정으로 들어가고 새 계정을 만들지 않는다. 취소하면 앱으로 CANCELLED, 틀린 challenge는 404', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const user = w.fake.addUser('kakao')
    expect((await runFlow(w, 'kakao', user.id, { session: seller.cookie })).result.login).toBe('LINKED')
    const { verifier, challenge } = verifierPair()
    const back = await appFlow(w, 'kakao', user.id, challenge)
    const done = await client(w, null).post('/api/auth/app/finish', { ticket: back.searchParams.get('ticket'), verifier })
    expect(done.body).toMatchObject({ result: 'LOGGED_IN', me: { loginId: seller.loginId } })
    expect(await count(w, 'sellers')).toBe(1)

    const cancelled = await appFlow(w, 'kakao', null, verifierPair().challenge)
    expect(cancelled.href).toBe('livejjim://auth?login=CANCELLED&provider=kakao')
    expect((await w.server.app.request('/api/auth/app/start?provider=kakao&challenge=short')).status).toBe(404)
    expect((await w.server.app.request(`/api/auth/app/start?provider=nope&challenge=${challenge}`)).status).toBe(404)
  })
})
