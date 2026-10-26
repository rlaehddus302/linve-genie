// 밴드 플랫폼 공통·설정·주소 목록·운영 상태 (BND1, AC-BND1-01·02·03·04·10·60·62·63·64).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { createBackupBytes, restoredChatSource, restoreSeller } from '../src/backup.ts'
import { bandRequestUrl, BandRequestRefused, BAND_ALLOWED_PATHS } from '../src/band/endpoints.ts'
import { bandSettings, readBandConfig } from '../src/band/config.ts'
import { randomIds } from '../src/ids.ts'
import { platformOfKey, PLATFORMS, PLATFORM_NAMES } from '../src/platform.ts'
import { productionServerOptions } from '../src/production.ts'
import { generateMasterKey } from '../src/secrets.ts'
import { thanksRoute } from '../src/thanks-route.ts'
import { BAND_BLOCKED_DOMAINS } from './setup-band-guard.ts'
import { client, dumpAllTables, rid, writeEvent } from './support.ts'
import { bandSeller, bandView, bandWorld, guestComment, linkBand, realBroadcast, tick, type BandWorld } from './band-support.ts'

let w: BandWorld | null = null
afterEach(async () => {
  await w?.close()
  w = null
})
async function world(options: Parameters<typeof bandWorld>[0] = {}): Promise<BandWorld> {
  w = await bandWorld(options)
  return w
}

const BAND_SRC = fileURLToPath(new URL('../src/band/', import.meta.url))

describe('AC-BND1-01 플랫폼 값과 band: 접두어', () => {
  it('PLATFORMS에 BAND, 이름은 "밴드"', () => {
    expect(PLATFORMS).toContain('BAND')
    expect(PLATFORM_NAMES.BAND).toBe('밴드')
  })

  it.each([
    ['band:UKEY_A1', 'BAND'],
    ['band:', 'BAND'],
    ['bandUKEY', 'YOUTUBE'],
    ['BAND:UKEY', 'YOUTUBE'],
    ['ig:1', 'INSTAGRAM'],
    ['tt:1', 'TIKTOK'],
    ['sms:s1', null],
    ['UC_A', 'YOUTUBE'],
    ['sim_a1', 'YOUTUBE'],
  ])('%s → %s', (key, platform) => {
    expect(platformOfKey(key)).toBe(platform)
  })
})

describe('AC-BND1-02 플랫폼 능력 조회의 밴드', () => {
  it('설정이 있으면 ready, 실제 시각순·감사·영상 댓글은 아니오와 그 문장', async () => {
    const w = await world()
    const { seller } = await bandSeller(w)
    const platforms = (await client(w, seller.cookie).get('/api/platforms')).body.platforms as { platform: string }[]
    expect(platforms.map((p) => p.platform)).toEqual(['YOUTUBE', 'INSTAGRAM', 'TIKTOK', 'BAND'])
    expect(platforms[3]).toEqual({
      platform: 'BAND',
      ready: true,
      receivedTime: false,
      thanks: 'NONE',
      videoComment: false,
      reasons: { receivedTime: '밴드 댓글은 몇 초마다 읽어 와서 실제 시각순으로 판정할 수 없어요.', thanks: '밴드에는 감사 글을 남기지 않아요.', videoComment: '밴드에는 감사 글을 남기지 않아요.' },
    })
  })

  it('설정이 없으면 ready 아니오와 "준비되지 않았어요"', async () => {
    const w = await world({ notConfigured: true })
    const seller = (await import('./support.ts')).addSeller(w)
    const platforms = (await client(w, (await seller).cookie).get('/api/platforms')).body.platforms as { platform: string; ready: boolean; reasons: Record<string, string> }[]
    const band = platforms.find((p) => p.platform === 'BAND')
    expect(band?.ready).toBe(false)
    expect(band?.reasons.ready).toBe('밴드 연동이 아직 준비되지 않았어요. 운영자에게 문의해 주세요.')
  })
})

describe('AC-BND1-03 감사 경로 — 밴드에 쓰지 않는다', () => {
  it('thanksRoute: band: 구매자는 보내지 않음, 밴드 연결 기록은 "다른 플랫폼"', () => {
    expect(thanksRoute('band:UKEY', { youtube: false, other: true })).toBe('SKIP_NOT_SUPPORTED')
    expect(thanksRoute('band:UKEY', { youtube: true, other: true })).toBe('SKIP_NOT_SUPPORTED')
    expect(thanksRoute('sms:s1', { youtube: false, other: true })).toBe('SKIP_NO_RECIPIENT')
    expect(thanksRoute('BAND:UKEY', { youtube: true, other: true })).toBe('YOUTUBE')
  })

  it('밴드만 이은 회차: 밴드 댓글 찜 확정 → SKIPPED(NOT_SUPPORTED), 문자찜 확정 → SKIPPED(NO_RECIPIENT), 밴드로 나간 쓰기 요청 0', async () => {
    const w = await world()
    const { seller, userKey, bandKey } = await bandSeller(w)
    const postKey = w.fake.addPost({ bandKey, authorUserKey: userKey })
    const b = await realBroadcast(w, seller)
    for (const no of [1, 2]) expect((await writeEvent(w, seller, { type: 'product.register', b, no, name: `상품${String(no)}`, price: 10_000, stock: 1, status: 'OPEN' })).status).toBe(200)
    expect((await linkBand(w, seller, b, bandKey, postKey)).status).toBe(200)
    guestComment(w, postKey, '1번 주세요', { userKey: 'UKEY_A' })
    await tick(w, 10_000)
    const sms = await writeEvent(w, seller, { type: 'sms', b, no: 2, received: '12:00', phone: '010-1234-5678', memo: '문자 손님' })
    expect(sms.status, sms.text).toBe(200)
    // 확정 (마감)
    for (const no of [1, 2]) expect((await writeEvent(w, seller, { type: 'product.close', b, no })).status).toBe(200)
    const rows = await w.database.pglite?.query<{ kind: string; state: string; reason: string | null; body: string }>(`select kind, state, reason, body from outbox where seller_id = $1 and kind = 'POST_THANKS' order by seq`, [seller.sellerId])
    const thanks = (rows?.rows ?? []).map((row) => ({ state: row.state, reason: row.reason, buyer: (JSON.parse(row.body) as { buyer: string }).buyer }))
    expect(thanks.find((row) => row.buyer === 'band:UKEY_A')).toMatchObject({ state: 'SKIPPED', reason: 'NOT_SUPPORTED' })
    expect(thanks.find((row) => row.buyer.startsWith('sms:'))).toMatchObject({ state: 'SKIPPED', reason: 'NO_RECIPIENT' })
    expect(thanks.filter((row) => row.state === 'NEW')).toEqual([])
    expect(w.fake.requests.every((request) => request.method === 'GET' && BAND_ALLOWED_PATHS.includes(request.path))).toBe(true)
  })
})

describe('AC-BND1-04 수집 출처·백업 복구', () => {
  it('밴드 chat의 기록 출처는 other, 복구 출처 되살리기도 band: → other', async () => {
    expect(restoredChatSource(false, 'band:POST:C1')).toBe('other')
    expect(restoredChatSource(true, 'band:POST:C1')).toBe('rehearsal')
    expect(restoredChatSource(false, 'BAND:POST:C1')).toBe('youtube')
    const w = await world()
    const { seller, userKey, bandKey } = await bandSeller(w)
    const postKey = w.fake.addPost({ bandKey, authorUserKey: userKey })
    const b = await realBroadcast(w, seller)
    expect((await linkBand(w, seller, b, bandKey, postKey)).status).toBe(200)
    guestComment(w, postKey, '안녕하세요')
    await tick(w, 10_000)
    const rows = await w.database.pglite?.query<{ chat_source: string }>(`select chat_source from events where seller_id = $1 and type = 'chat'`, [seller.sellerId])
    expect(rows?.rows).toEqual([{ chat_source: 'other' }])
  })

  it('백업 파일에 밴드 토큰·본 댓글 표가 없다. 복구하면 열린 밴드 글 연결이 FINISHED(복구) — 토큰은 남는다', async () => {
    const w = await world()
    const seller = await (await import('./support.ts')).addSeller(w)
    const userKey = w.fake.addUser('다육가게')
    const bandKey = w.fake.addBand({ name: '방', members: [userKey] })
    // 심은 토큰으로 연결 (가짜 서버가 이 토큰을 낸다)
    w.fake.nextToken = 'PLANTED-BAND-TOKEN'
    const { connectBand } = await import('./band-support.ts')
    w.fake.nextLogin({ decision: 'approve', userKey })
    expect(await connectBand(w, seller)).toBe('connected')
    const postKey = w.fake.addPost({ bandKey, authorUserKey: userKey })
    guestComment(w, postKey, '기준선 댓글')
    const b = await realBroadcast(w, seller)
    expect((await linkBand(w, seller, b, bandKey, postKey)).status).toBe(200)
    guestComment(w, postKey, '1번')
    await tick(w, 10_000)
    const bytes = await createBackupBytes(w.database.db, seller.sellerId, w.clock.now())
    const text = gunzipSync(bytes).toString('utf8')
    expect(text).not.toContain('PLANTED-BAND-TOKEN')
    expect(text.includes('band_seen') || text.includes('bandSeen')).toBe(false)
    const restored = await restoreSeller({ db: w.database.db, sellerId: seller.sellerId, bytes, replace: true, storage: { write: async () => ({ name: 'safety' }) } as never, clock: w.clock, ids: randomIds })
    expect(restored.ok, JSON.stringify(restored)).toBe(true)
    const view = await bandView(w, seller, b)
    expect(view).toMatchObject({ state: 'FINISHED', message: '복구해서 밴드 글 연결을 끝냈어요. 다시 이어 주세요.' })
    expect((await client(w, seller.cookie).get('/api/band')).body.band).toMatchObject({ status: 'CONNECTED' })
    // 복구 뒤 단 댓글은 들어오지 않는다
    const before = w.fake.calls('comments').length
    guestComment(w, postKey, '2번')
    await tick(w, 70_000)
    expect(w.fake.calls('comments').length).toBe(before)
  })
})

describe('AC-BND1-10 설정 읽기', () => {
  const base = { LIVEJJIM_BAND_CLIENT_ID: 'id', LIVEJJIM_BAND_CLIENT_SECRET: 'secret', LIVEJJIM_BAND_REDIRECT_URI: 'https://app.example.com/api/band/callback' }
  it('셋 중 하나라도 비면 설정 없음 (경고 없이)', () => {
    for (const name of Object.keys(base)) expect(readBandConfig({ ...base, [name]: '  ' })).toEqual({ settings: null })
    expect(readBandConfig(base).settings).toMatchObject({ clientId: 'id', authUrl: 'https://auth.band.us', apiUrl: 'https://openapi.band.us', redirectUri: 'https://app.example.com/api/band/callback', timeoutMs: 10_000 })
  })

  it.each([
    ['http://shop.example', false],
    ['http://localhost:4000', true],
    ['http://127.0.0.1:4000/x', true],
    ['http://[::1]:4000', true],
    ['ftp://x', false],
    ['https://x.example/band', true],
    ['주소 아님', false],
  ])('주소 %s → 준비됨 %s', (url, ready) => {
    for (const name of ['LIVEJJIM_BAND_REDIRECT_URI', 'LIVEJJIM_BAND_AUTH_URL', 'LIVEJJIM_BAND_API_URL']) {
      const result = readBandConfig({ ...base, [name]: url })
      expect(result.settings !== null, name).toBe(ready)
      if (!ready) expect(result).toEqual({ settings: null, warning: 'BAND_CONFIG_INVALID' })
    }
  })

  it('운영 기동: 경고 코드만 남기고(값 없이) 서버는 시작한다', () => {
    const env = { LIVEJJIM_MASTER_KEY: generateMasterKey(), LIVEJJIM_APP_ORIGIN: 'https://app.example.com', ...base, LIVEJJIM_BAND_API_URL: 'http://shop.example' }
    const built = productionServerOptions(env, { db: null as never })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.options.band).toEqual({ settings: null })
    expect(built.options.startupWarnings).toContain('BAND_CONFIG_INVALID')
    const ready = productionServerOptions({ ...env, LIVEJJIM_BAND_API_URL: '' }, { db: null as never })
    expect(ready.ok && ready.options.band?.settings?.apiUrl).toBe('https://openapi.band.us')
  })
})

describe('AC-BND1-60 부르는 주소는 읽기 일곱 개뿐', () => {
  const settings = bandSettings({ clientId: 'c', clientSecret: 's', redirectUri: 'https://app.example.com/api/band/callback' })
  it('주소 목록은 한 곳 — GET 일곱 개, 그 밖의 이름·방식은 보내기 전에 오류', () => {
    expect([...BAND_ALLOWED_PATHS].sort()).toEqual(['/oauth2/authorize', '/oauth2/token', '/v2.1/band/post', '/v2.1/bands', '/v2/band/post/comments', '/v2/band/posts', '/v2/profile'].sort())
    expect(bandRequestUrl(settings, 'comments', 'GET', { a: '1' }).toString()).toBe('https://openapi.band.us/v2/band/post/comments?a=1')
    expect(bandRequestUrl(settings, 'token', 'GET', {}).toString()).toBe('https://auth.band.us/oauth2/token')
    for (const method of ['POST', 'DELETE', 'PUT', 'get']) expect(() => bandRequestUrl(settings, 'comments', method, {})).toThrow(BandRequestRefused)
    for (const op of ['comment', 'toString', '__proto__', 'constructor', 'remove']) expect(() => bandRequestUrl(settings, op, 'GET', {})).toThrow(BandRequestRefused)
  })

  it('코드 검사: band/**에 쓰기·지우기 주소, 댓글 쓰기 경로, POST·DELETE 요청이 없다', () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry)
        if (statSync(path).isDirectory()) walk(path)
        else if (path.endsWith('.ts')) files.push(path)
      }
    }
    walk(BAND_SRC)
    expect(files.length).toBeGreaterThanOrEqual(8)
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      expect(text, file).not.toMatch(/write|remove|create_comment|\/comment['"`]|\/create['"`/]/)
      expect(text, file).not.toMatch(/['"`](POST|DELETE|PUT|PATCH)['"`]/)
      expect(text, file).not.toMatch(/method:\s*['"`](?!GET)/)
    }
  })

  it('흐름 전체에서 가짜 밴드 서버가 받은 요청은 모두 일곱 가운데 하나이고 GET', async () => {
    const w = await world()
    const { seller, userKey, bandKey } = await bandSeller(w)
    const postKey = w.fake.addPost({ bandKey, authorUserKey: userKey })
    const api = client(w, seller.cookie)
    expect((await api.get('/api/band/bands')).status).toBe(200)
    expect((await api.get(`/api/band/posts?band=${bandKey}`)).status).toBe(200)
    const b = await realBroadcast(w, seller)
    expect((await linkBand(w, seller, b, bandKey, postKey)).status).toBe(200)
    guestComment(w, postKey, '1번')
    await tick(w, 70_000)
    expect((await api.post(`/api/broadcasts/${b}/band/unlink`, { requestId: rid('u') })).status).toBe(200)
    expect((await api.post('/api/band/disconnect', { requestId: rid('d') })).status).toBe(200)
    expect(w.fake.requests.length).toBeGreaterThan(5)
    for (const request of w.fake.requests) {
      expect(request.method).toBe('GET')
      expect(BAND_ALLOWED_PATHS).toContain(request.path)
    }
  })
})

describe('AC-BND1-62·63 시험 전용 경로·바깥 연결 막기', () => {
  it('운영 서버 시작 경로(가짜 없음)에는 /_e2e/band/*가 없다', async () => {
    const w = await world()
    for (const path of ['/_e2e/band/comment', '/_e2e/band/requests', '/_e2e/band/fail']) {
      const response = await w.server.app.request(path, { method: path.endsWith('requests') ? 'GET' : 'POST' })
      expect(response.status, path).toBe(404)
    }
  })

  it('서버 시험은 band.us로 나가는 연결을 막는다 (준비 파일 — 시도하면 그 파일이 실패)', async () => {
    expect(BAND_BLOCKED_DOMAINS).toEqual(['band.us'])
    await expect(fetch('https://openapi.band.us/v2/profile')).rejects.toThrow()
    // 막은 시도는 이 파일의 끝에서 실패로 세지 않게 지운다 (준비 파일의 reset)
    const { installOutboundGuard } = await import('./outbound-guard.ts')
    const guard = installOutboundGuard('band', BAND_BLOCKED_DOMAINS)
    expect(guard.reset().length).toBeGreaterThan(0)
  })
})

describe('AC-BND1-64 운영 상태', () => {
  it('/ops/status에 상태별 밴드 글 연결 수와 앱 전체 호출 한도 쉼 — 판매자 정보 없이', async () => {
    const token = 'x'.repeat(40)
    const w = await world({ overrides: { opsToken: token } })
    const { seller, userKey, bandKey } = await bandSeller(w)
    const postKey = w.fake.addPost({ bandKey, authorUserKey: userKey })
    const b = await realBroadcast(w, seller)
    expect((await linkBand(w, seller, b, bandKey, postKey)).status).toBe(200)
    w.fake.fail('comments', { resultCode: 1001 })
    await tick(w, 10_000)
    const response = await w.server.app.request('/ops/status', { headers: { Authorization: `Bearer ${token}` } })
    const status = (await response.json()) as { band: { links: Record<string, number>; appPause: { active: boolean; remainingSeconds: number } } }
    expect(status.band.links).toEqual({ READING: 0, RETRYING: 1, RECONNECT_NEEDED: 0, NO_ACCESS: 0, YOUTUBE_LINKED: 0 })
    expect(status.band.appPause).toEqual({ active: true, remainingSeconds: 60 })
    const text = JSON.stringify(status)
    for (const secret of [seller.sellerId, bandKey, postKey, userKey, '다육']) expect(text).not.toContain(secret)
  })
})

describe('AC-BND1-13 토큰 저장', () => {
  it('DB 전체 덤프에 평문 토큰이 없다', async () => {
    const w = await world()
    const seller = await (await import('./support.ts')).addSeller(w)
    const userKey = w.fake.addUser('가게')
    w.fake.addBand({ name: '방', members: [userKey] })
    w.fake.nextToken = 'PLANTED-BAND-TOKEN'
    const { connectBand } = await import('./band-support.ts')
    w.fake.nextLogin({ decision: 'approve', userKey })
    expect(await connectBand(w, seller)).toBe('connected')
    expect(await dumpAllTables(w.database)).not.toContain('PLANTED-BAND-TOKEN')
  })
})
