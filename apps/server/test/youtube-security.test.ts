// AC-Y1-70 로그, AC-Y1-71 응답·격리·요청 보호, AC-Y1-72 바깥 호출 (DAT-06, NFR-06, SYS-02, D-073, D-074, D-Y13)
import { afterEach, describe, expect, it } from 'vitest'
import { readYoutubeSetting } from '../src/config.ts'
import { formatLog } from '../src/log.ts'
import { createServer } from '../src/server.ts'
import { generateMasterKey } from '../src/secrets.ts'
import { blockedRequests } from '../src/youtube/network-guard.ts'
import { addSeller, client, createBroadcast, expectOk, openTestDb, writeEvent } from './support.ts'
import { connectSeller, drive, linkedBroadcast, until, youtubeConfig, youtubeWorld, type YoutubeWorld } from './youtube-support.ts'

const worlds: YoutubeWorld[] = []
async function world(options: Parameters<typeof youtubeWorld>[0] = {}): Promise<YoutubeWorld> {
  const created = await youtubeWorld(options)
  worlds.push(created)
  return created
}
afterEach(async () => {
  for (const item of worlds.splice(0)) {
    item.server.close()
    await item.server.stop()
    await item.fake.close()
  }
})

describe('AC-Y1-70 로그', () => {
  it('토큰·code·state·클라이언트 비밀·채팅 본문·닉네임·감사 문구·응답 본문이 서버 로그에 없다 (연결·수집·게시·오류 흐름)', async () => {
    const w = await world()
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b, liveChatId } = await linkedBroadcast(w, connected, { settings: { 'print.autoOnConfirm': false } })
    await expectOk(writeEvent(w, connected.seller, { type: 'product.register', b: b.id, no: 15, name: '심은품종', price: 10000 }))
    w.server.youtube?.collectors.start()
    w.fake.fail('liveChatMessages.streamList', { status: 500 })
    w.fake.fail('liveChatMessages.streamList', { status: 400, reason: 'pageTokenInvalid' })
    w.fake.addMessage(liveChatId, { author: 'UCplant', name: '심은닉네임', text: '15', publishedAt: w.timer.now() + 1 })
    w.fake.addMessage(liveChatId, { author: 'UCplant2', name: '심은닉네임2', text: '심은본문 이야기', publishedAt: w.timer.now() + 1 })
    await until(w, async () => ((await client(w, connected.seller.cookie).get(`/api/broadcasts/${b.id}/youtube`)).body.collector as { recorded: number }).recorded === 2, { step: 500 })
    w.fake.fail('liveChatMessages.insert', { status: 503 })
    await drive(w, w.server.youtube?.outbox.runOnce() ?? Promise.resolve())
    await w.timer.advance(3000)
    await drive(w, w.server.youtube?.outbox.runOnce() ?? Promise.resolve())
    expect(w.fake.posted).toHaveLength(1)
    w.fake.fail('oauth.revoke', { status: 500 })
    await client(w, connected.seller.cookie).post('/api/youtube/connection/disconnect', {})
    const text = w.logs.map((record) => formatLog(record)).join('\n') + JSON.stringify(w.logs)
    expect(w.logs.length).toBeGreaterThan(0)
    for (const secret of [...w.fake.issuedTokens(), ...w.fake.issuedCodes(), w.fake.clientSecret, '심은닉네임', '심은본문', '심은품종', '구매 감사합니다', '핑크프릴']) expect(text).not.toContain(secret)
    // 남는 것은 종류·HTTP 상태·이유 코드·판매자
    expect(text).toMatch(/code=COLLECTOR_ERROR/)
    expect(text).toMatch(/status=500/)
    expect(text).toMatch(/reason=pageTokenInvalid/)
    expect(text).toContain(`seller=${connected.seller.sellerId}`)
  })
})

describe('AC-Y1-71 응답·격리·요청 보호', () => {
  it('새 API는 모두 세션이 필요하다 (401)', async () => {
    const w = await world()
    const api = client(w, null)
    for (const path of ['/api/youtube/connection', '/api/youtube/live-broadcasts', '/api/youtube/quota', '/api/broadcasts/x/youtube', '/api/days/2026-10-19/outbox', '/api/days/2026-10-19/youtube-notices']) {
      expect((await api.get(path)).status, path).toBe(401)
    }
    for (const path of ['/api/youtube/connection/start', '/api/youtube/connection/disconnect', '/api/youtube/parse-video', '/api/broadcasts/x/youtube', '/api/broadcasts/x/youtube/unlink', '/api/outbox/1/resend']) {
      expect((await api.post(path, {})).status, path).toBe(401)
    }
  })

  it('다른 판매자의 회차·발송함 행·알림·연결·할당량은 404이거나 보이지 않는다. SSE는 그 판매자의 것만', async () => {
    const w = await world()
    const a = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b } = await linkedBroadcast(w, a, { settings: { 'print.autoOnConfirm': false } })
    const other = await connectSeller(w)
    const mine = client(w, a.seller.cookie)
    const theirs = client(w, other.seller.cookie)
    // B의 SSE
    const response = await theirs.raw('/api/stream', {})
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    let seen = ''
    const pump = (async () => {
      for (;;) {
        const chunk = await reader?.read()
        if (chunk === undefined || chunk.done) break
        seen += decoder.decode(chunk.value)
      }
    })()
    await expectOk(writeEvent(w, a.seller, { type: 'product.register', b: b.id, no: 15, name: '핑크프릴', price: 10000 }))
    await w.server.ingestChat(a.seller.sellerId, { b: b.id, id: 'c1', ch: 'UCa', nick: '가', text: '15' })
    await w.server.youtube?.outbox.runOnce()
    const rowId = ((await mine.get(`/api/days/${b.date}/outbox`)).body.rows as { id: number }[])[0]?.id
    expect((await theirs.get(`/api/broadcasts/${b.id}/youtube`)).status).toBe(404)
    expect((await theirs.post(`/api/broadcasts/${b.id}/youtube`, { requestId: 'x', video: 'dQw4w9WgXcQ' })).status).toBe(404)
    expect((await theirs.post(`/api/broadcasts/${b.id}/youtube/unlink`, {})).status).toBe(404)
    expect((await theirs.post(`/api/outbox/${String(rowId)}/resend`, { requestId: 'y' })).status).toBe(404)
    expect((await theirs.get(`/api/days/${b.date}/outbox`)).body.rows).toEqual([])
    expect((await theirs.get('/api/youtube/connection')).body.connection).toMatchObject({ channel: { id: other.channel.id } })
    expect(((await theirs.get('/api/youtube/quota')).body.quota as { used: number }).used).toBe(1)
    await new Promise((resolve) => setTimeout(resolve, 20))
    await reader?.cancel()
    await pump
    expect(seen).not.toContain('"kind":"outbox"')
    expect(seen).not.toContain(b.id)
  })

  it('상태를 바꾸는 요청은 Origin·JSON만, 모르는 필드는 거절, 개인 데이터 응답은 no-store', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    const b = await createBroadcast(w, connected.seller)
    const api = client(w, connected.seller.cookie)
    expect((await api.post(`/api/broadcasts/${b.id}/youtube`, { requestId: 'z', video: 'dQw4w9WgXcQ', extra: 1 })).status).toBe(400)
    expect((await api.post('/api/youtube/connection/disconnect', { force: true })).status).toBe(400)
    expect((await api.post(`/api/broadcasts/${b.id}/youtube/collector/restart`, { now: true })).status).toBe(400)
    const evil = await w.server.app.request('/api/youtube/connection/disconnect', { method: 'POST', headers: { Cookie: connected.seller.cookie, Origin: 'https://evil.test', 'Content-Type': 'application/json' }, body: '{}' })
    expect(evil.status).toBe(403)
    for (const path of ['/api/youtube/connection', '/api/youtube/quota', `/api/broadcasts/${b.id}/youtube`, `/api/days/${b.date}/outbox`]) {
      expect((await api.get(path)).headers.get('cache-control'), path).toBe('no-store')
    }
  })
})

describe('AC-Y1-72 바깥 호출', () => {
  it('운영 설정은 https만 받는다 (아니면 서버가 시작하지 않는다)', async () => {
    const database = await openTestDb()
    const config = { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://app.test/api/youtube/oauth/callback', returnUrl: 'https://app.test/settings/youtube' }
    expect(() => createServer({ database, masterKey: generateMasterKey(), appOrigin: 'https://app.test', youtube: { ...config, endpoints: { authUrl: 'http://127.0.0.1:1/a', tokenUrl: 'https://x.test/t', revokeUrl: 'https://x.test/r', apiBase: 'https://x.test/y' } } })).toThrow(
      '구글·유튜브 주소는 https://로만 적을 수 있어요.',
    )
    expect(() => createServer({ database, masterKey: generateMasterKey(), appOrigin: 'https://app.test', youtube: { ...config, redirectUri: 'http://app.test/cb' } })).toThrow()
    expect(() => createServer({ database, masterKey: generateMasterKey(), appOrigin: 'https://app.test', youtube: config })).not.toThrow()
    // 환경 변수 읽기
    expect(readYoutubeSetting({}, 'https://app.test')).toEqual({ ok: true, youtube: null })
    const ok = readYoutubeSetting({ LIVEJJIM_GOOGLE_CLIENT_ID: 'id', LIVEJJIM_GOOGLE_CLIENT_SECRET: 's3cr3t', LIVEJJIM_GOOGLE_REDIRECT_URI: 'https://app.test/api/youtube/oauth/callback' }, 'https://app.test')
    expect(ok).toMatchObject({ ok: true, youtube: { returnUrl: 'https://app.test/settings/youtube', endpoints: { tokenUrl: 'https://oauth2.googleapis.com/token' } } })
    const bad = readYoutubeSetting({ LIVEJJIM_GOOGLE_CLIENT_ID: 'id', LIVEJJIM_GOOGLE_CLIENT_SECRET: 's3cr3t', LIVEJJIM_GOOGLE_REDIRECT_URI: 'https://app.test/cb', LIVEJJIM_YOUTUBE_API_URL: 'http://evil.test' }, 'https://app.test')
    expect(bad).toEqual({ ok: false, message: '유튜브 연동 주소는 https://로만 적을 수 있어요.' })
    expect(JSON.stringify(bad)).not.toContain('s3cr3t')
    expect(readYoutubeSetting({ LIVEJJIM_GOOGLE_CLIENT_ID: 'id' }, 'https://app.test').ok).toBe(false)
    // D-YT-SEND-16: 내 컴퓨터 시험은 돌아오는 주소·화면 주소만 http://localhost — 구글 주소·다른 http 주소는 그대로 거절
    const local = readYoutubeSetting({ LIVEJJIM_GOOGLE_CLIENT_ID: 'id', LIVEJJIM_GOOGLE_CLIENT_SECRET: 's3cr3t', LIVEJJIM_GOOGLE_REDIRECT_URI: 'http://localhost:7800/api/youtube/oauth/callback' }, 'http://localhost:7800')
    expect(local).toMatchObject({ ok: true, youtube: { redirectUri: 'http://localhost:7800/api/youtube/oauth/callback', returnUrl: 'http://localhost:7800/settings/youtube' } })
    expect(readYoutubeSetting({ LIVEJJIM_GOOGLE_CLIENT_ID: 'id', LIVEJJIM_GOOGLE_CLIENT_SECRET: 's3cr3t', LIVEJJIM_GOOGLE_REDIRECT_URI: 'http://localhost:7800/cb', LIVEJJIM_GOOGLE_TOKEN_URL: 'http://localhost:9/token' }, 'http://localhost:7800').ok).toBe(false)
    expect(readYoutubeSetting({ LIVEJJIM_GOOGLE_CLIENT_ID: 'id', LIVEJJIM_GOOGLE_CLIENT_SECRET: 's3cr3t', LIVEJJIM_GOOGLE_REDIRECT_URI: 'http://app.test/cb' }, 'https://app.test').ok).toBe(false)
    expect(() => createServer({ database, masterKey: generateMasterKey(), appOrigin: 'http://localhost:7800', youtube: { ...config, redirectUri: 'http://localhost:7800/api/youtube/oauth/callback', returnUrl: 'http://localhost:7800/settings/youtube' } })).not.toThrow()
    await database.close()
  })

  it('요청-응답 호출에는 시간 제한(15초)이 있다 — 응답이 없으면 기다리다 끝난다', async () => {
    const w = await world()
    const connected = await connectSeller(w)
    w.fake.fail('liveBroadcasts.list', { kind: 'hang' })
    const started = w.timer.now()
    const response = await drive(w, client(w, connected.seller.cookie).get('/api/youtube/live-broadcasts'), 1000)
    expect(response.status).toBe(502)
    expect(response.body).toMatchObject({ error: { code: 'YOUTUBE_UNAVAILABLE' } })
    expect(w.timer.now() - started).toBeGreaterThanOrEqual(15_000)
  })

  it('시험은 구글 주소로 나가는 요청을 막는다', async () => {
    const before = blockedRequests.count
    await expect(fetch('https://www.googleapis.com/youtube/v3/channels')).rejects.toThrow('시험에서 실제 구글 주소로 요청하려 했다')
    await expect(fetch('https://accounts.google.com/o/oauth2/v2/auth')).rejects.toThrow()
    await expect(fetch(new URL('https://youtube.com/watch?v=x'))).rejects.toThrow()
    expect(blockedRequests.count - before).toBe(3)
    // 이 시험이 일부러 만든 요청은 파일 끝 검사에서 뺀다
    blockedRequests.count = before
    // 기본 설정(구글 주소)으로 만든 서버의 유튜브 호출도 막힌다
    const database = await openTestDb()
    const masterKey = generateMasterKey()
    const fakeless = createServer({ database, masterKey, appOrigin: 'https://app.livejjim.test', youtube: { clientId: 'id', clientSecret: 's', redirectUri: 'https://api.test/cb', returnUrl: 'https://app.test/settings/youtube' } })
    await expect(fakeless.youtube?.google.refresh('rt')).rejects.toMatchObject({ kind: 'network' })
    expect(blockedRequests.count - before).toBe(1)
    blockedRequests.count = before
    await database.close()
    void youtubeConfig
    void addSeller
  })
})
