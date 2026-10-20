// 가짜 메타 서버 자체 시험 (AC-N2-70, D-N2-11): 실제 HTTP로 OAuth·토큰·계정·구독·live_media·개인 답장·대화 조회·서명한 웹훅·오류 주입·조작 주소.
import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { startE2eServer, type E2eServer } from '../src/e2e.ts'
import { FakeMeta } from '../src/instagram/fake-meta.ts'
import { MetaClient, type MetaConnection } from '../src/instagram/meta.ts'
import { FAST_COST } from './support.ts'

let fake: FakeMeta | null = null
let e2e: E2eServer | null = null
afterEach(async () => {
  await fake?.close()
  fake = null
  await e2e?.close()
  e2e = null
})

async function start(): Promise<FakeMeta> {
  fake = await FakeMeta.start({ now: () => Date.UTC(2026, 9, 19, 11, 0, 0) })
  return fake
}

async function grant(f: FakeMeta, login: 'FACEBOOK' | 'INSTAGRAM', scenario: Parameters<FakeMeta['setLogin']>[0]) {
  const meta = new MetaClient(f.settings({ redirectUri: 'https://a.test/cb', login, timeouts: { sendMs: 300, confirmMs: 300, requestMs: 1000 } }))
  f.setLogin(scenario)
  const location = new URL(await f.authorize(meta.authorizeUrl(login, 'state-1', false)))
  return { meta, location, result: location.searchParams.get('code') === null ? null : await meta.grant(login, location.searchParams.get('code') as string) }
}

describe('AC-N2-70 가짜 메타 서버', () => {
  it('OAuth: 허락·거절·권한 빼기·계정 0/1/2개 (페이스북 로그인)', async () => {
    const f = await start()
    const a = f.addAccount({ username: 'a.shop' })
    const b = f.addAccount({ username: 'b.shop', type: 'MEDIA_CREATOR' })
    const denied = await grant(f, 'FACEBOOK', { decision: 'deny', accounts: [a.id] })
    expect(denied.location.searchParams.get('error')).toBe('access_denied')
    expect(denied.location.searchParams.get('state')).toBe('state-1')
    expect((await grant(f, 'FACEBOOK', { accounts: [] })).result).toMatchObject({ ok: true, value: { accounts: [] } })
    expect((await grant(f, 'FACEBOOK', { accounts: [a.id, b.id] })).result).toMatchObject({ ok: true, value: { accounts: [{ id: a.id }, { id: b.id, type: 'CREATOR' }] } })
    const partial = await grant(f, 'FACEBOOK', { accounts: [a.id], declined: ['instagram_manage_messages'] })
    expect(partial.result).toMatchObject({ ok: true, value: { accounts: [{ id: a.id, username: 'a.shop', pageId: a.pageId }], permissions: { comments: true, messages: false } } })
    // 같은 code는 한 번만
    expect(await partial.meta.grant('FACEBOOK', partial.location.searchParams.get('code') as string)).toEqual({ ok: false, failure: 'REJECTED' })
  })

  it('인스타그램 로그인: 짧은 토큰 → 긴 토큰 → 계정 정보, 새로 고침', async () => {
    const f = await start()
    const a = f.addAccount({ username: 'ig.shop' })
    const { meta, result } = await grant(f, 'INSTAGRAM', { accounts: [a.id] })
    if (result === null || !result.ok) throw new Error('승인 실패')
    expect(result.value).toMatchObject({ login: 'INSTAGRAM', accounts: [{ id: a.id, username: 'ig.shop', type: 'BUSINESS' }], permissions: { comments: true, messages: true }, expiresIn: 5_184_000 })
    const refreshed = await meta.refresh(result.value.igToken as string)
    expect(refreshed).toMatchObject({ ok: true, value: { expiresIn: 5_184_000 } })
    expect(f.count('refresh')).toBe(1)
  })

  it('구독·해제·철회 기록, live_media 만들기·끝내기, 개인 답장(두 번째는 이미 답장, 끝난 라이브는 라이브 끝남), 대화 조회', async () => {
    const f = await start()
    const a = f.addAccount({ username: 'a.shop' })
    const { meta, result } = await grant(f, 'FACEBOOK', { accounts: [a.id] })
    if (result === null || !result.ok) throw new Error('승인 실패')
    const conn: MetaConnection = { login: 'FACEBOOK', accountId: a.id, pageId: a.pageId, tokens: { user: result.value.userToken, page: result.value.accounts[0]?.pageToken ?? null, ig: null } }
    expect(await meta.subscribe(conn)).toEqual({ ok: true, value: null })
    expect(f.subscriptions).toEqual([{ node: a.pageId, fields: 'live_comments' }])
    const live = f.startLive(a.id)
    expect(await meta.liveMedia(conn)).toEqual({ ok: true, value: [{ id: live, startedAt: Date.UTC(2026, 9, 19, 11, 0, 0) }] })
    const c1 = f.comment({ accountId: a.id, liveId: live, igsid: '42', username: 'v', text: '15' })
    const id = (c1.value as { id: string }).id
    const sent = await meta.privateReply(conn, id, '감사합니다')
    expect(sent.ok).toBe(true)
    expect(await meta.privateReply(conn, id, '또')).toEqual({ ok: false, failure: 'ONE_REPLY' })
    expect(f.dms).toEqual([{ messageId: sent.ok ? sent.value : '', accountId: a.id, commentId: id, igsid: '42', text: '감사합니다', at: Date.UTC(2026, 9, 19, 11, 0, 0) }])
    expect(await meta.conversation(conn, '42')).toEqual({ ok: true, value: [{ id: sent.ok ? sent.value : '', text: '감사합니다', fromId: a.id, createdAt: Date.UTC(2026, 9, 19, 11, 0, 0) }] })
    const c2 = f.comment({ accountId: a.id, liveId: live, igsid: '43', username: 'w', text: '28' })
    f.endLive(live)
    expect(await meta.liveMedia(conn)).toEqual({ ok: true, value: [] })
    expect(await meta.privateReply(conn, (c2.value as { id: string }).id, '늦음')).toEqual({ ok: false, failure: 'LIVE_ENDED' })
    expect(await meta.unsubscribe(conn)).toEqual({ ok: true, value: null })
    expect(await meta.revoke(conn)).toEqual({ ok: true, value: null })
    expect(f.unsubscriptions).toEqual([a.pageId])
    expect(f.revocations).toEqual([a.id])
  })

  it('오류 주입: 5xx·429·속도 제한·토큰 무효·권한 없음·응답 없음·연결 끊기·지연·조회 실패', async () => {
    const f = await start()
    const a = f.addAccount({ username: 'a.shop' })
    const { meta, result } = await grant(f, 'FACEBOOK', { accounts: [a.id] })
    if (result === null || !result.ok) throw new Error('승인 실패')
    const conn: MetaConnection = { login: 'FACEBOOK', accountId: a.id, pageId: a.pageId, tokens: { user: result.value.userToken, page: result.value.accounts[0]?.pageToken ?? null, ig: null } }
    const live = f.startLive(a.id)
    const reply = () => meta.privateReply(conn, (f.comment({ accountId: a.id, liveId: live, igsid: '1', username: 'v', text: 't' }).value as { id: string }).id, '글')
    for (const [fault, failure] of [
      ['SERVER_ERROR', 'RETRY'],
      ['TOO_MANY', 'RETRY'],
      ['RATE_LIMIT', 'RETRY'],
      ['TOKEN_INVALID', 'TOKEN_INVALID'],
      ['NO_PERMISSION', 'NO_PERMISSION'],
      ['HANG', 'TIMEOUT'],
      ['DROP', 'TIMEOUT'],
    ] as const) {
      f.fail('send', fault)
      expect(await reply(), fault).toEqual({ ok: false, failure })
    }
    expect(f.dms).toEqual([])
    f.fail('send', 'HANG_AFTER')
    expect(await reply()).toEqual({ ok: false, failure: 'TIMEOUT' })
    expect(f.dms).toHaveLength(1)
    f.fail('send', { delayMs: 50 })
    expect((await reply()).ok).toBe(true)
    f.fail('conversation', 'SERVER_ERROR')
    expect(await meta.conversation(conn, '1')).toEqual({ ok: false, failure: 'RETRY' })
    f.fail('conversation', 'HANG')
    expect(await meta.conversation(conn, '1')).toEqual({ ok: false, failure: 'TIMEOUT' })
    f.invalidateTokens(a.id)
    expect(await meta.liveMedia(conn)).toEqual({ ok: false, failure: 'TOKEN_INVALID' })
    expect(f.count('send')).toBe(9)
  })

  it('서명한 웹훅: 묶음·늦은 entry.time·틀린 서명·두 계정 섞기 본문을 만든다', async () => {
    const f = await start()
    const a = f.addAccount({ username: 'a.shop' })
    const b = f.addAccount({ username: 'b.shop' })
    const body = f.payload([
      { accountId: a.id, time: 100, changes: [f.comment({ accountId: a.id, liveId: 'L1', igsid: '1', username: 'u', text: 'x' })] },
      { accountId: b.id, changes: [{ field: 'comments', value: {} }] },
    ])
    const parsed = JSON.parse(body) as { object: string; entry: { id: string; time: number; changes: { field: string }[] }[] }
    expect(parsed.object).toBe('instagram')
    expect(parsed.entry.map((entry) => [entry.id, entry.time, entry.changes[0]?.field])).toEqual([
      [a.id, 100, 'live_comments'],
      [b.id, Math.floor(Date.UTC(2026, 9, 19, 11, 0, 0) / 1000), 'comments'],
    ])
    expect(f.sign(body)).toBe(`sha256=${createHmac('sha256', f.appSecret).update(body).digest('hex')}`)
    const seen: Record<string, string>[] = []
    await f.deliver(async (_body, headers) => {
      seen.push({ ...headers })
      return new Response(null)
    }, body, { signature: null })
    expect(seen[0]?.['X-Hub-Signature-256']).toBeUndefined()
  })

  it('E2E 서버와 함께 띄우고 조작 주소로 계정·로그인·라이브·댓글 웹훅·상태를 다룬다', async () => {
    e2e = await startE2eServer({ instagram: true, passwordCost: FAST_COST, appOrigin: 'http://localhost:5173' })
    const fakeMeta = e2e.fakeMeta
    if (fakeMeta === null) throw new Error('가짜 메타 서버가 없다')
    const opened = await e2e.listen(0)
    expect(fakeMeta.webhookUrl).toBe(`http://127.0.0.1:${String(opened.port)}/webhooks/instagram`)
    const control = async (path: string, body?: unknown) => {
      const response = await fetch(`${fakeMeta.url}${path}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })
      return (await response.json()) as Record<string, unknown>
    }
    const account = (await control('/_fake/accounts', { username: 'e2e.shop' })).account as { id: string }
    expect(await control('/_fake/login', { accounts: [account.id] })).toEqual({ ok: true })
    const liveId = (await control('/_fake/live', { accountId: account.id })).liveId as string
    // 연결되지 않은 계정의 댓글도 서명이 맞으면 200(기록 없음)
    const sent = await control('/_fake/comments', { accountId: account.id, liveId, comments: [{ igsid: '1', username: 'v', text: '15' }] })
    expect(sent.status).toBe(200)
    expect(await control(`/_fake/live/${liveId}/end`, {})).toEqual({ ok: true })
    const state = await control('/_fake/state')
    expect(state.accounts).toEqual([expect.objectContaining({ id: account.id, username: 'e2e.shop' })])
    // 서버 인스타그램 설정이 가짜 서버 주소다 (화면 경로로 돌아온다)
    expect(e2e.server.instagram.settings?.redirectUri).toBe('http://localhost:5173/api/instagram/callback')
    expect(e2e.server.instagram.settings?.endpoints.graph.startsWith(fakeMeta.url)).toBe(true)
  })
})
