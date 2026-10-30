// AC-KP1-20~24·26 방송 일정·공개 일정 페이지·방송 알림 신청: 입력 검사, 10개 상한, 공개 주소(새로 만들기·끄기 404), 공개 페이지 머리글·이스케이프·속도 제한,
// 알림 신청·그만 받기(번호 암호화·같은 문장), 상태별 수, 정리 작업(기한 지난 번호·지난 일정), 바깥 연결 0번, 권한.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { alertConsents, alertSubscribers, scheduleItems } from '../src/db/schema.ts'
import { PHONE_NUMBER_MESSAGE } from '../src/messages.ts'
import { checkScheduleItem, checkSchedulePage, readChannelUrl, SCHEDULE_MESSAGES } from '../src/schedule/rules.ts'
import { SCHEDULE_TOKEN_LIMIT } from '../src/schedule/page.ts'
import { storedPhones } from '../src/schedule/service.ts'
import { sweepSchedule } from '../src/schedule/sweep.ts'
import { kst, putShop, SHOP } from './i2-support.ts'
import { addSeller, client, expectOk, fakeClock, login, newWorld, ORIGIN, type Seller, type TestServer } from './support.ts'

const NOW = kst('2026-10-31', '09:00:00')
const PHONE = '010-2345-6789'
const DIGITS = '01023456789'

async function world(): Promise<{ world: TestServer; seller: Seller }> {
  const w = await newWorld({ clock: fakeClock(NOW) })
  const seller = await addSeller(w)
  await expectOk(putShop(w, seller, SHOP))
  return { world: w, seller }
}

const item = (date: string, time: string, title = '토요일 특별 방송', intro = '') => ({ date, time, title, intro })

interface View {
  page: { enabled: boolean; url: string | null; channelUrl: string | null }
  items: { id: string; date: string; time: string; startsAt: string; title: string; intro: string }[]
  max: number
}

async function enable(w: TestServer, seller: Seller, channelUrl: string | null = null): Promise<string> {
  const view = (await expectOk(client(w, seller.cookie).put('/api/schedule/page', { enabled: true, channelUrl }))).body as unknown as View
  const url = view.page.url as string
  expect(url).toMatch(new RegExp(`^${ORIGIN}/s/[A-Za-z0-9_-]{43}$`))
  return url.slice(ORIGIN.length)
}

type Env = { incoming: { socket: { remoteAddress: string } } }
const fromIp = (ip: string): Env => ({ incoming: { socket: { remoteAddress: ip } } })

function postForm(w: TestServer, path: string, fields: Record<string, string | string[]>, options: { origin?: string | null; env?: Env } = {}): Promise<Response> {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(fields)) for (const one of Array.isArray(value) ? value : [value]) body.append(key, one)
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' }
  if (options.origin !== null) headers.Origin = options.origin ?? ORIGIN
  return Promise.resolve(w.server.app.request(path, { method: 'POST', headers, body: body.toString() }, options.env ?? fromIp('198.51.100.1')))
}

async function counts(w: TestServer, seller: Seller): Promise<{ pending: number; active: number; withdrawn: number }> {
  return (await expectOk(client(w, seller.cookie).get('/api/schedule/alerts'))).body as { pending: number; active: number; withdrawn: number }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SCH-01 일정 입력 검사 (순수 함수)', () => {
  it('제목 1~40자·소개 0~100자·날짜와 시각·지난 시각·제어 글자·휴대폰 번호 모양·모르는 칸', () => {
    const ok = checkScheduleItem(item('2026-11-07', '20:00', '  토요일 방송  ', ' 많이 오세요 '), NOW)
    expect(ok).toEqual({ ok: true, value: { date: '2026-11-07', time: '20:00', title: '토요일 방송', intro: '많이 오세요', startsAt: kst('2026-11-07', '20:00:00') } })
    const problem = (body: Record<string, unknown>) => {
      const checked = checkScheduleItem(body, NOW)
      return checked.ok ? null : checked.problems.map((entry) => [entry.field, entry.message])
    }
    expect(problem(item('2026-11-07', '20:00', '가'.repeat(40)))).toBeNull()
    expect(problem(item('2026-11-07', '20:00', '가'.repeat(41)))).toEqual([['title', SCHEDULE_MESSAGES.title]])
    expect(problem(item('2026-11-07', '20:00', '   '))).toEqual([['title', SCHEDULE_MESSAGES.title]])
    expect(problem(item('2026-11-07', '20:00', '방송', '가'.repeat(101)))).toEqual([['intro', SCHEDULE_MESSAGES.intro]])
    expect(problem(item('2026-11-07', '20:00', '방송', '가'.repeat(100)))).toBeNull()
    expect(problem(item('2026-11-07', '20:00', '문의 010-1234-5678'))).toEqual([['title', PHONE_NUMBER_MESSAGE]])
    expect(problem(item('2026-11-07', '20:00', '방송', '연락 01012345678'))).toEqual([['intro', PHONE_NUMBER_MESSAGE]])
    expect(problem(item('2026-11-07', '20:00', '방\u0007송'))).toEqual([['title', SCHEDULE_MESSAGES.unsafe]])
    expect(problem(item('2026-02-30', '20:00'))).toEqual([['date', SCHEDULE_MESSAGES.when]])
    expect(problem(item('2026-11-07', '24:00'))).toEqual([['time', SCHEDULE_MESSAGES.when]])
    expect(problem(item('2026-11-07', '8:00'))).toEqual([['time', SCHEDULE_MESSAGES.when]])
    expect(problem(item('2026-10-31', '08:59'))).toEqual([['time', SCHEDULE_MESSAGES.past]])
    expect(problem(item('2026-10-31', '09:00'))).toBeNull()
    expect(problem({ ...item('2026-11-07', '20:00'), title: 5 })).toEqual([['title', SCHEDULE_MESSAGES.title]])
    const unknown = checkScheduleItem({ ...item('2026-11-07', '20:00'), phone: PHONE }, NOW)
    expect(unknown).toEqual({ ok: false, unknown: true, problems: [{ field: 'phone', message: SCHEDULE_MESSAGES.unknown }] })
    expect(JSON.stringify(unknown)).not.toContain('2345')
  })

  it('채널 주소: https·youtube.com 호스트·200자 이하, 빈 글은 없음', () => {
    expect(readChannelUrl('https://www.youtube.com/@chorok')).toBe('https://www.youtube.com/@chorok')
    expect(readChannelUrl(' https://youtube.com/@초록다육 ')).toBe('https://youtube.com/@초록다육')
    expect(readChannelUrl('https://m.youtube.com/channel/UC123')).toBe('https://m.youtube.com/channel/UC123')
    expect(readChannelUrl('')).toBeNull()
    expect(readChannelUrl(null)).toBeNull()
    for (const bad of ['http://www.youtube.com/@a', 'https://youtube.com.evil.kr/@a', 'https://evil.kr/youtube.com', 'javascript:alert(1)', 'https://user@youtube.com/@a', `https://www.youtube.com/${'a'.repeat(190)}`, 5]) {
      expect(readChannelUrl(bad), String(bad)).toBeUndefined()
    }
    expect(checkSchedulePage({ enabled: true })).toEqual({ ok: false, unknown: false, problems: [{ field: 'channelUrl', message: SCHEDULE_MESSAGES.channel }] })
    expect(checkSchedulePage({ enabled: 'yes', channelUrl: null })).toMatchObject({ ok: false, problems: [{ field: 'enabled' }] })
    expect(checkSchedulePage({ enabled: false, channelUrl: null, extra: 1 })).toMatchObject({ ok: false, unknown: true })
  })
})

describe('AC-KP1-20 일정 적기 경로', () => {
  it('다가오는 일정은 시각 순, 11번째는 409, 고치기·지우기, 지난 일정은 빠진다', async () => {
    const { world: w, seller } = await world()
    const api = client(w, seller.cookie)
    const empty = await expectOk(api.get('/api/schedule'))
    expect(empty.headers.get('cache-control')).toContain('no-store')
    expect(empty.body).toEqual({ page: { enabled: false, url: null, channelUrl: null }, items: [], max: 10 })
    for (let day = 10; day >= 1; day -= 1) await expectOk(api.post('/api/schedule/items', item(`2026-11-${String(day).padStart(2, '0')}`, '20:00', `${String(day)}일 방송`)))
    const full = await api.post('/api/schedule/items', item('2026-11-20', '20:00'))
    expect(full.status).toBe(409)
    expect(full.body).toEqual({ error: { code: 'SCHEDULE_FULL', message: '다가오는 방송은 10개까지 적을 수 있어요.' } })
    const view = (await expectOk(api.get('/api/schedule'))).body as unknown as View
    expect(view.items.map((entry) => entry.date)).toEqual(Array.from({ length: 10 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`))
    expect(view.items[0]).toMatchObject({ time: '20:00', startsAt: new Date(kst('2026-11-01', '20:00:00')).toISOString(), title: '1일 방송', intro: '' })
    const first = view.items[0] as View['items'][number]
    const edited = (await expectOk(api.put(`/api/schedule/items/${first.id}`, item('2026-11-01', '21:30', '1일 밤 방송', '소개')))).body as unknown as View
    expect(edited.items[0]).toMatchObject({ id: first.id, time: '21:30', title: '1일 밤 방송', intro: '소개' })
    expect((await api.post('/api/schedule/items', item('2026-11-20', '20:00', '문의 010-1234-5678'))).body).toMatchObject({ error: { code: 'INVALID_INPUT', problems: [{ field: 'title', message: PHONE_NUMBER_MESSAGE }] } })
    const deleted = await api.raw(`/api/schedule/items/${first.id}`, { method: 'DELETE', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: '{}' })
    expect(deleted.status).toBe(200)
    const removed = (await deleted.json()) as View
    expect(removed.items).toHaveLength(9)
    // 하루가 지나 첫 일정이 지나면 목록에서 빠지고 자리가 생긴다
    w.clock.set(kst('2026-11-02', '21:00:00'))
    const later = (await expectOk(api.get('/api/schedule'))).body as unknown as View
    expect(later.items.map((entry) => entry.date)[0]).toBe('2026-11-03')
    await expectOk(api.post('/api/schedule/items', item('2026-11-20', '20:00')))
    // 지난 일정은 고칠 수 없다
    const old = (await w.database.db.select({ id: scheduleItems.id }).from(scheduleItems)).map((row) => row.id).filter((id) => !later.items.some((entry) => entry.id === id))
    expect(old.length).toBeGreaterThan(0)
    expect((await api.put(`/api/schedule/items/${old[0] as string}`, item('2026-11-25', '20:00'))).status).toBe(404)
  })

  it('AC-KP1-26 일정·알림 수 경로: 로그인 없음 401, 보조자 403, 다른 판매자 일정 404', async () => {
    const { world: w, seller } = await world()
    const view = (await expectOk(client(w, seller.cookie).post('/api/schedule/items', item('2026-11-07', '20:00')))).body as unknown as View
    const id = (view.items[0] as View['items'][number]).id
    const anonymous = client(w, null)
    for (const response of [await anonymous.get('/api/schedule'), await anonymous.get('/api/schedule/alerts'), await anonymous.post('/api/schedule/items', item('2026-11-08', '20:00'))]) expect(response.status).toBe(401)
    const created = await expectOk(client(w, seller.cookie).post('/api/assistants', { name: '엄마' }))
    const assistant = created.body as { assistant: { loginId: string }; password: string }
    const helper = client(w, await login(w, assistant.assistant.loginId, assistant.password))
    for (const response of [await helper.get('/api/schedule'), await helper.get('/api/schedule/alerts'), await helper.put('/api/schedule/page', { enabled: true, channelUrl: null }), await helper.post('/api/schedule/items', item('2026-11-08', '20:00'))]) {
      expect(response.status).toBe(403)
      expect((response.body.error as { code: string }).code).toBe('ASSISTANT_FORBIDDEN')
    }
    const other = client(w, (await addSeller(w)).cookie)
    expect((await other.put(`/api/schedule/items/${id}`, item('2026-11-08', '20:00'))).status).toBe(404)
    expect((await other.get('/api/schedule')).body).toMatchObject({ items: [] })
    expect((await expectOk(client(w, seller.cookie).get('/api/schedule'))).body).toMatchObject({ items: [{ id }] })
  })
})

describe('AC-KP1-21 공개 일정 페이지', () => {
  it('켜면 /s/<토큰>: 가게 이름·다가오는 일정(이스케이프)·채널 주소, 머리글, 스크립트 없음. 새로 만들면 옛 주소 404, 끄면 404', async () => {
    const { world: w, seller } = await world()
    const api = client(w, seller.cookie)
    await expectOk(api.post('/api/schedule/items', item('2026-11-07', '20:00', '<script>alert(1)</script> 특가', '"따옴표" & 소개')))
    await expectOk(api.post('/api/schedule/items', item('2026-10-31', '10:00', '곧 지날 방송')))
    const path = await enable(w, seller, 'https://www.youtube.com/@chorok')
    const response = await w.server.app.request(path)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    const csp = response.headers.get('content-security-policy') ?? ''
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("form-action 'self'")
    expect(csp).not.toContain('script-src')
    const html = await response.text()
    expect(html).toContain('<meta name="robots" content="noindex,nofollow">')
    expect(html).toContain('초록다육 방송 일정')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; 특가')
    expect(html).toContain('&quot;따옴표&quot; &amp; 소개')
    expect(html).not.toMatch(/<script/i)
    expect(html).toContain('2026-11-07 (토) 20:00')
    expect(html).toContain('href="https://www.youtube.com/@chorok" rel="noopener noreferrer"')
    expect(html).toContain('초록다육의 방송 알림(광고) 문자를 받을게요.')
    expect(html).toMatch(/<input type="checkbox" name="agree" value="on" required>/)
    expect(html).not.toMatch(/checked/)
    // 지난 일정은 빠진다
    expect(html).toContain('곧 지날 방송')
    w.clock.set(kst('2026-10-31', '10:01:00'))
    const afterStart = await (await w.server.app.request(path)).text()
    expect(afterStart).not.toContain('곧 지날 방송')
    // 새 주소: 옛 주소 404
    const renewed = (await expectOk(api.post('/api/schedule/page/renew', {}))).body as unknown as View
    const next = (renewed.page.url as string).slice(ORIGIN.length)
    expect(next).not.toBe(path)
    const gone = await w.server.app.request(path)
    expect(gone.status).toBe(404)
    expect(await gone.text()).toContain('이 주소는 열 수 없어요.')
    expect((await w.server.app.request(next)).status).toBe(200)
    // 끄면 404, 다시 켜면 새 주소
    const off = (await expectOk(api.put('/api/schedule/page', { enabled: false, channelUrl: null }))).body as unknown as View
    expect(off.page).toEqual({ enabled: false, url: null, channelUrl: null })
    expect((await w.server.app.request(next)).status).toBe(404)
    const again = await enable(w, seller)
    expect(again).not.toBe(next)
    expect((await w.server.app.request(again)).status).toBe(200)
    // 모양이 틀린 주소·다른 메서드
    expect((await w.server.app.request('/s/short')).status).toBe(404)
    expect((await w.server.app.request(again, { method: 'PUT' })).status).toBe(405)
  })

  it('일정이 없으면 한 줄, 접속 주소마다 1분 60번(61번째 429) — 다른 접속 주소는 그대로 열린다 (RA-KP1-001)', async () => {
    const { world: w, seller } = await world()
    const path = await enable(w, seller)
    const open = (ip: string) => w.server.app.request(path, {}, fromIp(ip))
    const first = await (await open('203.0.113.1')).text()
    expect(first).toContain('다가오는 방송이 아직 없어요.')
    for (let i = 1; i < 60; i += 1) expect((await open('203.0.113.1')).status).toBe(200)
    const limited = await open('203.0.113.1')
    expect(limited.status).toBe(429)
    expect(await limited.text()).toContain('잠시 뒤 다시 열어 주세요.')
    // 같은 가게 주소를 다른 손님(접속 주소)은 그대로 연다
    for (let i = 0; i < 5; i += 1) expect((await open(`198.51.100.${String(i + 10)}`)).status).toBe(200)
    w.clock.advance(60_001)
    expect((await open('203.0.113.1')).status).toBe(200)
  })

  it('토큰 하나 전체는 1분 3,000번 상한만 (여러 접속 주소의 합 — 3,001번째 429)', async () => {
    const { world: w } = await world()
    // 없는 토큰도 모양이 맞으면 같은 칸을 센다 (상한은 열기 전에 본다)
    const path = `/s/${'A'.repeat(43)}`
    for (let i = 0; i < SCHEDULE_TOKEN_LIMIT; i += 1) {
      const response = await w.server.app.request(path, {}, fromIp(`10.0.${String(Math.floor(i / 50))}.${String(i % 50)}`))
      if (response.status !== 404) throw new Error(`${String(i)}번째가 ${String(response.status)}`)
    }
    expect((await w.server.app.request(path, {}, fromIp('10.9.9.9'))).status).toBe(429)
  })
})

describe('AC-KP1-22 알림 받기 신청·그만 받기', () => {
  it('체크 없음·번호 틀림은 저장 안 함, 저장하면 AGREE(MR-CONSENT-1·SCHEDULE_PAGE)·PENDING, 번호는 암호문만', async () => {
    const { world: w, seller } = await world()
    const path = await enable(w, seller)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const noAgree = await postForm(w, `${path}/alert`, { phone: PHONE })
    expect(noAgree.status).toBe(400)
    const noAgreeHtml = await noAgree.text()
    expect(noAgreeHtml).toContain('알림 받기에 동의해 주세요.')
    expect(noAgreeHtml).not.toContain('2345')
    const badPhone = await postForm(w, `${path}/alert`, { phone: '02-123-4567', agree: 'on' })
    expect(badPhone.status).toBe(400)
    expect(await badPhone.text()).toContain('휴대폰 번호를 확인해 주세요.')
    expect((await postForm(w, `${path}/alert`, { phone: PHONE, agree: ['on', 'on'] })).status).toBe(400)
    expect((await postForm(w, `${path}/alert`, { phone: PHONE, agree: 'on' }, { origin: 'https://evil.example' })).status).toBe(403)
    expect((await postForm(w, `${path}/alert`, { phone: PHONE, agree: 'on' }, { origin: null })).status).toBe(403)
    expect(await w.database.db.select().from(alertSubscribers)).toEqual([])

    const saved = await postForm(w, `${path}/alert`, { phone: PHONE, agree: 'on' })
    expect(saved.status).toBe(303)
    expect(saved.headers.get('location')).toBe(`${path}?done=agree&on=2026-10-31`)
    expect(saved.headers.get('referrer-policy')).toBe('no-referrer')
    const done = await (await w.server.app.request(saved.headers.get('location') as string)).text()
    expect(done).toContain('초록다육 방송 알림을 신청했어요 (2026-10-31).')
    expect(done).not.toContain('2345')
    const subscribers = await w.database.db.select().from(alertSubscribers)
    expect(subscribers).toHaveLength(1)
    const row = subscribers[0] as (typeof subscribers)[number]
    expect(row.sellerId).toBe(seller.sellerId)
    expect(row.phoneEnc).toMatch(/^v1\./)
    for (const value of [row.phoneEnc, row.phoneKey, row.id]) {
      expect(value).not.toContain(DIGITS)
      expect(value).not.toContain('2345-6789')
    }
    const consents = await w.database.db.select().from(alertConsents)
    expect(consents.map((entry) => [entry.type, entry.wording, entry.route, entry.subscriberId])).toEqual([['AGREE', 'MR-CONSENT-1', 'SCHEDULE_PAGE', row.id]])
    expect(await counts(w, seller)).toEqual({ pending: 1, active: 0, withdrawn: 0 })
    // 같은 번호(모양이 달라도)를 다시 신청해도 한 사람
    expect((await postForm(w, `${path}/alert`, { phone: DIGITS, agree: 'on' })).status).toBe(303)
    expect(await w.database.db.select().from(alertSubscribers)).toHaveLength(1)
    expect(await counts(w, seller)).toEqual({ pending: 1, active: 0, withdrawn: 0 })
    // 번호는 로그에 없다, 바깥 연결 0번
    expect(JSON.stringify(w.logs)).not.toMatch(/2345|6789/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('그만 받기: 있으면 WITHDRAW + 번호·키를 바로 지움, 없는 번호도 같은 303·같은 문장, 번호 모양이 틀리면 400', async () => {
    const { world: w, seller } = await world()
    const path = await enable(w, seller)
    await postForm(w, `${path}/alert`, { phone: PHONE, agree: 'on' })
    const stop = await postForm(w, `${path}/stop`, { phone: PHONE })
    const unknown = await postForm(w, `${path}/stop`, { phone: '010-9999-0000' })
    expect(stop.status).toBe(303)
    expect(unknown.status).toBe(303)
    expect(stop.headers.get('location')).toBe(`${path}?done=stop&on=2026-10-31`)
    expect(unknown.headers.get('location')).toBe(stop.headers.get('location'))
    const html = await (await w.server.app.request(stop.headers.get('location') as string)).text()
    expect(html).toContain('초록다육 방송 알림을 그만 받아요 (2026-10-31).')
    expect(await storedPhones(w.database.db, seller.sellerId)).toBe(0)
    const rows = await w.database.db.select().from(alertSubscribers)
    expect(rows.map((row) => [row.phoneKey, row.phoneEnc])).toEqual([[null, null]])
    expect((await w.database.db.select().from(alertConsents)).map((entry) => entry.type)).toEqual(['AGREE', 'WITHDRAW'])
    expect(await counts(w, seller)).toEqual({ pending: 0, active: 0, withdrawn: 1 })
    expect((await postForm(w, `${path}/stop`, { phone: '1234' })).status).toBe(400)
    // 다시 신청하면 새 줄 (전 기록은 번호 없이 남는다)
    await postForm(w, `${path}/alert`, { phone: PHONE, agree: 'on' })
    expect(await counts(w, seller)).toEqual({ pending: 1, active: 0, withdrawn: 1 })
  })

  it('알림 신청은 접속 주소마다 1분 10번 — 손님 11명이 1분에 신청해도 모두 받는다 (RA-KP1-001)', async () => {
    const { world: w, seller } = await world()
    const path = await enable(w, seller)
    for (let i = 0; i < 11; i += 1) expect((await postForm(w, `${path}/alert`, { phone: `010-1000-${String(1000 + i)}`, agree: 'on' }, { env: fromIp(`203.0.113.${String(i + 1)}`) })).status).toBe(303)
    expect(await storedPhones(w.database.db, seller.sellerId)).toBe(11)
    // 한 접속 주소가 10번을 넘기면 그 주소만 막힌다 (다른 손님은 그대로)
    for (let i = 0; i < 10; i += 1) expect((await postForm(w, `${path}/stop`, { phone: `010-1000-${String(1000 + i)}` }, { env: fromIp('192.0.2.66') })).status).toBe(303)
    expect((await postForm(w, `${path}/alert`, { phone: '010-1000-2000', agree: 'on' }, { env: fromIp('192.0.2.66') })).status).toBe(429)
    expect((await postForm(w, `${path}/alert`, { phone: '010-1000-2001', agree: 'on' }, { env: fromIp('192.0.2.67') })).status).toBe(303)
    // 같은 접속 주소가 여러 가게 주소에 — 합쳐 센다
    const other = await addSeller(w)
    await expectOk(putShop(w, other, { ...SHOP, name: '다육이네' }))
    const otherPath = await enable(w, other)
    w.clock.advance(60_001)
    for (let i = 0; i < 5; i += 1) expect((await postForm(w, `${path}/alert`, { phone: `010-3000-${String(1000 + i)}`, agree: 'on' }, { env: fromIp('192.0.2.7') })).status).toBe(303)
    for (let i = 0; i < 5; i += 1) expect((await postForm(w, `${otherPath}/alert`, { phone: `010-3000-${String(2000 + i)}`, agree: 'on' }, { env: fromIp('192.0.2.7') })).status).toBe(303)
    expect((await postForm(w, `${otherPath}/alert`, { phone: '010-3000-3000', agree: 'on' }, { env: fromIp('192.0.2.7') })).status).toBe(429)
    expect((await postForm(w, `${otherPath}/alert`, { phone: '010-3000-3000', agree: 'on' }, { env: fromIp('192.0.2.8') })).status).toBe(303)
    // 판매자마다 따로 센다
    expect(await counts(w, other)).toEqual({ pending: 6, active: 0, withdrawn: 0 })
  })
})

describe('AC-KP1-24 정리 작업', () => {
  it('RA-KP1-004 고른 뒤 지우기 전에 같은 번호가 다시 신청하면 번호를 지우지 않는다 (알림 락 안에서 다시 판단)', async () => {
    const { world: w, seller } = await world()
    const path = await enable(w, seller)
    await postForm(w, `${path}/alert`, { phone: PHONE, agree: 'on' })
    const db = w.database.db
    const [row] = await db.select().from(alertSubscribers)
    const later = new Date(kst('2028-10-31', '00:00:00'))
    const original = db.transaction.bind(db)
    // 정리가 락을 잡기 바로 전에 손님이 다시 신청했다 (같은 신청 줄에 새 AGREE)
    vi.spyOn(db, 'transaction').mockImplementationOnce(async (task) => {
      await db.insert(alertConsents).values({ sellerId: seller.sellerId, subscriberId: row?.id as string, type: 'AGREE', wording: 'MR-CONSENT-1', route: 'SCHEDULE_PAGE', at: later })
      return original(task)
    })
    await sweepSchedule(db, later)
    expect(await storedPhones(db, seller.sellerId)).toBe(1)
    // 다시 신청이 없으면 그대로 지운다
    await sweepSchedule(db, new Date(kst('2030-11-01', '00:00:00')))
    expect(await storedPhones(db, seller.sellerId)).toBe(0)
  })

  it('기한(2년)이 되는 날 0시 KST 뒤 첫 정리에서 번호·키를 지우고, 지난 일정을 지운다. 수에서 빠진다', async () => {
    const { world: w, seller } = await world()
    const api = client(w, seller.cookie)
    await expectOk(api.post('/api/schedule/items', item('2026-11-07', '20:00')))
    const path = await enable(w, seller)
    await postForm(w, `${path}/alert`, { phone: PHONE, agree: 'on' })
    const db = w.database.db
    await sweepSchedule(db, new Date(kst('2028-10-30', '23:59:59')))
    expect(await storedPhones(db, seller.sellerId)).toBe(1)
    expect(await db.select().from(scheduleItems)).toEqual([])
    await sweepSchedule(db, new Date(kst('2028-10-31', '00:00:00')))
    expect(await storedPhones(db, seller.sellerId)).toBe(0)
    expect((await db.select().from(alertConsents)).map((entry) => entry.type)).toEqual(['AGREE'])
    w.clock.set(kst('2028-10-31', '00:00:01'))
    const fresh = { ...seller, cookie: await login(w, seller.loginId, seller.password) }
    expect(await counts(w, fresh)).toEqual({ pending: 0, active: 0, withdrawn: 0 })
  })
})
