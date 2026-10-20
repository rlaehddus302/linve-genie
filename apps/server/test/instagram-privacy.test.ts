// N2 개인정보·보안 (AC-N2-60~62, DAT-06, NFR-06, D-N2-14): 로그·오류 응답·DB에 남기지 않는 것, 로그인 없이 닿는 새 경로, 시험은 실제 메타에 닿지 않는다.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { META_ENDPOINTS, instagramSettings } from '../src/instagram/config.ts'
import { MetaClient } from '../src/instagram/meta.ts'
import { formatLog } from '../src/log.ts'
import { blockedConnections } from './network-guard.ts'
import { callback, connectedShop, igWorld, linkLive, liveBroadcast, register, webhookTarget, type IgWorld } from './instagram-support.ts'
import { ORIGIN, client, rid } from './support.ts'

let ig: IgWorld | null = null
afterEach(async () => {
  await ig?.close()
  ig = null
})

async function dbTexts(w: IgWorld): Promise<string> {
  const pg = w.database.pglite
  if (pg === null) throw new Error('PGlite가 아니다')
  const tables = await pg.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = 'public'`)
  let all = ''
  for (const table of tables.rows) {
    const rows = await pg.query<{ t: string }>(`select row_to_json(x)::text as t from "${table.table_name}" x`)
    all += rows.rows.map((row) => row.t).join('\n')
  }
  return all
}

describe('AC-N2-60 로그·응답·저장에 남기지 않는 것', () => {
  it('연결·웹훅·DM·오류 주입 시나리오 전체의 로그에 본문·username·IGSID·댓글 ID·미디어 ID·토큰·비밀값·서명·웹훅 본문이 없다', async () => {
    ig = await igWorld()
    const w = ig
    const { seller, account } = await connectedShop(w, { username: 'leak.shop.zz', consent: true })
    const b = await liveBroadcast(w, seller)
    await register(w, seller, b, 15, '핑크프릴', 10000)
    const live = w.fake.startLive(account.id)
    await linkLive(w, seller, b, live)
    const target = webhookTarget(w)
    const secrets: string[] = ['leak.viewer.zz', '유출금지본문', '777000111222', '888000222333', live, account.id, w.fake.appSecret, w.fake.verifyToken]
    // 정상 댓글 + 형식 틀린 변경 + 연결되지 않은 계정 + 이어지지 않은 라이브
    const good = w.fake.comment({ accountId: account.id, liveId: live, igsid: '777000111222', username: 'leak.viewer.zz', text: '15 유출금지본문', id: '888000222333' })
    const body = w.fake.payload([
      { accountId: account.id, changes: [good, { value: { id: '', from: { id: '777000111222' }, media: { id: live }, text: '유출금지본문' } }] },
      { accountId: '999999999', changes: [good] },
    ])
    secrets.push(body, w.fake.sign(body))
    w.fake.fail('send', 'SERVER_ERROR')
    expect((await w.fake.deliver(target, body)).status).toBe(200)
    await w.server.instagram.dms.drain()
    w.clock.advance(2000)
    w.fake.fail('send', 'HANG')
    w.fake.fail('conversation', 'TOKEN_INVALID')
    await w.server.instagram.dms.drain()
    // 오류 응답: 401·400·413 (받은 본문이 되돌아오지 않는다)
    const errors = [
      await w.server.app.request('/webhooks/instagram', { method: 'POST', headers: { 'X-Hub-Signature-256': 'sha256=' + '0'.repeat(64) }, body }),
      await w.server.app.request('/webhooks/instagram', { method: 'POST', headers: { 'X-Hub-Signature-256': w.fake.sign('유출금지본문 not json') }, body: '유출금지본문 not json' }),
      await w.server.app.request('/webhooks/instagram', { method: 'POST', headers: { 'X-Hub-Signature-256': w.fake.sign(body) }, body: body + ' '.repeat(1024 * 1024) }),
      await w.server.app.request(`/webhooks/instagram?hub.mode=subscribe&hub.verify_token=유출금지본문&hub.challenge=777000111222`),
    ]
    expect(errors.map((response) => response.status)).toEqual([401, 400, 413, 403])
    for (const response of errors) {
      const text = await response.text()
      for (const secret of secrets) expect(text).not.toContain(secret)
    }
    const logText = w.logs.map((record) => `${formatLog(record)}\n${JSON.stringify(record)}`).join('\n')
    expect(w.logs.length).toBeGreaterThan(0)
    for (const secret of [...secrets, ...w.fake.issuedTokens]) expect(logText).not.toContain(secret)
  })

  it('웹훅 원문을 저장하지 않는다 — 다루지 않는 키의 표지 문자열이 DB 어느 표에도 없다', async () => {
    ig = await igWorld()
    const w = ig
    const { seller, account } = await connectedShop(w)
    const b = await liveBroadcast(w, seller)
    const live = w.fake.startLive(account.id)
    await linkLive(w, seller, b, live)
    const change = w.fake.comment({ accountId: account.id, liveId: live, igsid: '1', username: 'a', text: '정상 댓글' })
    const value = { ...(change.value as Record<string, unknown>), parent_id: 'MARKER-PARENT-7731', from: { id: '1', username: 'a', self_ig_scoped_id: 'MARKER-SCOPED-7732' } }
    const body = JSON.stringify({ object: 'instagram', marker: 'MARKER-TOP-7733', entry: [{ id: account.id, time: 1, uid: 'MARKER-UID-7734', changes: [{ field: 'live_comments', value }] }] })
    expect((await w.fake.deliver(webhookTarget(w), body)).status).toBe(200)
    const texts = await dbTexts(w)
    expect(texts).toContain('정상 댓글')
    for (const marker of ['MARKER-PARENT-7731', 'MARKER-SCOPED-7732', 'MARKER-TOP-7733', 'MARKER-UID-7734']) expect(texts).not.toContain(marker)
  })
})

describe('AC-N2-61 로그인 없이 닿는 새 경로', () => {
  it('웹훅(GET·POST)과 OAuth 돌아오는 주소 밖의 새 경로는 로그인 없이 401', async () => {
    ig = await igWorld()
    const w = ig
    const anonymous = client(w, null)
    const gets = ['/api/platforms', '/api/live', '/api/broadcasts/b1/live', '/api/instagram', '/api/instagram/lives', '/api/instagram/unlinked', '/api/instagram/dms?date=2026-10-19']
    for (const path of gets) expect((await anonymous.get(path)).status, path).toBe(401)
    const posts: [string, Record<string, unknown>][] = [
      ['/api/broadcasts/b1/live/wait', { requestId: rid('x'), platform: 'INSTAGRAM' }],
      ['/api/broadcasts/b1/live/link', { requestId: rid('x'), platform: 'INSTAGRAM', liveId: '1' }],
      ['/api/broadcasts/b1/live/unlink', { requestId: rid('x') }],
      ['/api/instagram/connect', {}],
      ['/api/instagram/disconnect', {}],
      ['/api/instagram/consent', { on: true }],
      ['/api/instagram/dms/1/resend', { requestId: rid('x') }],
    ]
    for (const [path, body] of posts) expect((await anonymous.post(path, body)).status, path).toBe(401)
    // 돌아오는 주소: 로그인 없이 닿지만 state로만 처리 (세션 없음 → STATE_INVALID로 화면에 돌려보낸다)
    expect(await callback(w, null, 'https://api.livejjim.test/api/instagram/callback?code=c&state=s')).toBe('STATE_INVALID')
    const back = await w.server.app.request('/api/instagram/callback?state=s')
    expect(back.headers.get('location')).toBe(`${ORIGIN}/?instagram=STATE_INVALID`)
    // 웹훅: 로그인 대신 확인 토큰·서명
    expect((await w.server.app.request('/webhooks/instagram?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1')).status).toBe(403)
    expect((await w.server.app.request('/webhooks/instagram', { method: 'POST', body: '{}' })).status).toBe(401)
  })
})

describe('AC-N2-62 시험은 실제 메타에 닿지 않는다', () => {
  it('메타 주소로 나가는 연결은 네트워크 가드가 막는다 (실제 어댑터에 메타 주소를 넣어도)', async () => {
    const meta = new MetaClient(instagramSettings({ appId: '1', appSecret: 's', verifyToken: 'v', redirectUri: 'https://a.test/cb', endpoints: META_ENDPOINTS }))
    const result = await meta.liveMedia({ login: 'FACEBOOK', accountId: '1', pageId: '2', tokens: { user: 'u', page: 'p', ig: null } })
    expect(result).toEqual({ ok: false, failure: 'RETRY' })
    expect(blockedConnections).toEqual(['graph.facebook.com'])
    blockedConnections.splice(0)
    await expect(fetch('https://graph.instagram.com/v24.0/me')).rejects.toThrow(/네트워크 가드/)
    expect(blockedConnections).toEqual(['graph.instagram.com'])
    blockedConnections.splice(0)
  })

  it('실제 어댑터는 설정의 주소로만 부른다 — 메타 주소는 설정 기본값(config.ts)에만 있다', () => {
    const root = new URL('../src/', import.meta.url)
    const files: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.ts')) files.push(full)
      }
    }
    walk(root.pathname)
    const withHosts = files.filter((file) => /graph\.facebook\.com|graph\.instagram\.com|www\.facebook\.com|api\.instagram\.com|www\.instagram\.com/.test(readFileSync(file, 'utf8')))
    expect(withHosts.map((file) => file.slice(root.pathname.length))).toEqual(['instagram/config.ts'])
  })

  it('가짜 메타 서버 시나리오는 127.0.0.1로만 간다', async () => {
    ig = await igWorld()
    const w = ig
    await connectedShop(w)
    expect(new URL(w.fake.url).hostname).toBe('127.0.0.1')
    expect(w.fake.calls.length).toBeGreaterThan(0)
    expect(blockedConnections).toEqual([])
    expect(new URL(ORIGIN).hostname).not.toBe('127.0.0.1')
  })
})
