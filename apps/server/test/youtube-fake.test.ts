// AC-Y1-80 가짜 구글·유튜브 서버 자체 시험, AC-Y1-81 E2E 서버와 함께 띄우기 (D-Y13)
import { createHash, randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { startE2eServer, type E2eServer } from '../src/e2e.ts'
import { FakeGoogle } from '../src/youtube/fake-google.ts'
import { JsonObjectSplitter } from '../src/youtube/google.ts'
import { FAST_COST } from './support.ts'

const fakes: FakeGoogle[] = []
afterEach(async () => {
  for (const fake of fakes.splice(0)) await fake.close()
})

async function start(): Promise<FakeGoogle> {
  const fake = await FakeGoogle.start()
  fakes.push(fake)
  return fake
}

const pkce = () => {
  const verifier = randomBytes(48).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier, 'ascii').digest('base64url') }
}

async function authorize(fake: FakeGoogle, challenge: string, scope = 'https://www.googleapis.com/auth/youtube.readonly'): Promise<URL> {
  const url = new URL(fake.endpoints().authUrl)
  url.searchParams.set('client_id', fake.clientId)
  url.searchParams.set('redirect_uri', 'https://app.test/cb')
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', scope)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('state', 'st')
  const response = await fetch(url, { redirect: 'manual' })
  expect(response.status).toBe(302)
  return new URL(response.headers.get('location') ?? '')
}

async function token(fake: FakeGoogle, form: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(fake.endpoints().tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: fake.clientId, client_secret: fake.clientSecret, ...form }).toString() })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

describe('AC-Y1-80 가짜 구글·유튜브 서버', () => {
  it('127.0.0.1에서 뜬다. OAuth: 바로 돌려보내기·거절·PKCE 검사·새로 고침·폐기', async () => {
    const fake = await start()
    expect(new URL(fake.url).hostname).toBe('127.0.0.1')
    const account = fake.addAccount()
    const channel = fake.addChannel(account, '채널')
    fake.approval = { account, channel: channel.id }
    const { verifier, challenge } = pkce()
    const back = await authorize(fake, challenge)
    expect(back.searchParams.get('state')).toBe('st')
    const code = back.searchParams.get('code') ?? ''
    // 검증 값이 틀리면 invalid_grant, 그 code는 다시 쓸 수 없다
    expect(await token(fake, { grant_type: 'authorization_code', code, code_verifier: pkce().verifier, redirect_uri: 'https://app.test/cb' })).toMatchObject({ status: 400, body: { error: 'invalid_grant' } })
    const second = await authorize(fake, challenge)
    const issued = await token(fake, { grant_type: 'authorization_code', code: second.searchParams.get('code') ?? '', code_verifier: verifier, redirect_uri: 'https://app.test/cb' })
    expect(issued).toMatchObject({ status: 200, body: { token_type: 'Bearer', expires_in: 3600, scope: 'https://www.googleapis.com/auth/youtube.readonly' } })
    const refreshed = await token(fake, { grant_type: 'refresh_token', refresh_token: issued.body.refresh_token as string })
    expect(refreshed.status).toBe(200)
    // 채널 확인
    const mine = await fetch(`${fake.endpoints().apiBase}/channels?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${refreshed.body.access_token as string}` } })
    expect(await mine.json()).toMatchObject({ items: [{ id: channel.id, snippet: { title: '채널' } }] })
    // 폐기 → 새로 고침 invalid_grant
    await fetch(`${fake.endpoints().revokeUrl}?token=${issued.body.refresh_token as string}`, { method: 'POST' })
    expect(await token(fake, { grant_type: 'refresh_token', refresh_token: issued.body.refresh_token as string })).toMatchObject({ status: 400, body: { error: 'invalid_grant' } })
    // 거절
    fake.approval = { deny: true }
    expect((await authorize(fake, challenge)).searchParams.get('error')).toBe('access_denied')
  })

  it('Data API: 방송·영상·채팅 목록·게시(작성자 = 우리 채널로 다시 나옴)·댓글, 오류 넣기, 호출 수', async () => {
    const fake = await start()
    const account = fake.addAccount()
    const channel = fake.addChannel(account, '채널')
    fake.approval = { account, channel: channel.id }
    const { verifier, challenge } = pkce()
    const back = await authorize(fake, challenge, 'https://www.googleapis.com/auth/youtube.force-ssl')
    const access = (await token(fake, { grant_type: 'authorization_code', code: back.searchParams.get('code') ?? '', code_verifier: verifier, redirect_uri: 'https://app.test/cb' })).body.access_token as string
    const call = async (path: string, init: RequestInit = {}) => {
      const response = await fetch(`${fake.endpoints().apiBase}${path}`, { ...init, headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' } })
      return { status: response.status, body: (await response.json()) as Record<string, unknown> }
    }
    const live = fake.addBroadcast(channel.id, { status: 'live', title: '방송' })
    fake.addBroadcast(channel.id, { status: 'upcoming' })
    expect((await call('/liveBroadcasts?part=snippet,status&mine=true')).body.items).toHaveLength(2)
    expect((await call(`/videos?part=snippet,liveStreamingDetails&id=${live.videoId}`)).body).toMatchObject({ items: [{ id: live.videoId, snippet: { channelId: channel.id, liveBroadcastContent: 'live' }, liveStreamingDetails: { activeLiveChatId: live.liveChatId } }] })
    fake.addMessage(live.liveChatId as string, { author: 'UCv', name: '시청자', text: '15' })
    fake.addMessage(live.liveChatId as string, { author: 'UCs', name: '후원', type: 'superChatEvent', userComment: '감사해요' })
    const posted = await call('/liveChat/messages?part=snippet', { method: 'POST', body: JSON.stringify({ snippet: { liveChatId: live.liveChatId, type: 'textMessageEvent', textMessageDetails: { messageText: '감사합니다' } } }) })
    expect(posted.status).toBe(200)
    const list = await call(`/liveChat/messages?liveChatId=${live.liveChatId as string}&part=snippet,authorDetails`)
    expect(list.body).toMatchObject({ pollingIntervalMillis: 1000, nextPageToken: 'p3' })
    const items = list.body.items as { snippet: Record<string, unknown>; authorDetails: Record<string, unknown> }[]
    expect(items.map((item) => item.snippet.type)).toEqual(['textMessageEvent', 'superChatEvent', 'textMessageEvent'])
    expect(items[1]?.snippet.superChatDetails).toMatchObject({ userComment: '감사해요' })
    expect(items[2]?.authorDetails).toMatchObject({ channelId: channel.id, isChatOwner: true })
    // 댓글
    expect((await call('/commentThreads?part=snippet', { method: 'POST', body: JSON.stringify({ snippet: { videoId: live.videoId, topLevelComment: { snippet: { textOriginal: '댓글' } } } }) })).status).toBe(200)
    expect((await call(`/commentThreads?part=snippet&videoId=${live.videoId}`)).body.items).toHaveLength(1)
    // 오류 넣기: 할당량 초과·지점 거절
    fake.fail('liveChatMessages.list', { status: 403, reason: 'quotaExceeded' })
    expect(await call(`/liveChat/messages?liveChatId=${live.liveChatId as string}`)).toMatchObject({ status: 403, body: { error: { errors: [{ reason: 'quotaExceeded' }] } } })
    expect(await call(`/liveChat/messages?liveChatId=${live.liveChatId as string}&pageToken=zz`)).toMatchObject({ status: 400, body: { error: { errors: [{ reason: 'pageTokenInvalid' }] } } })
    // 채팅 끝내기: offlineAt, 그 뒤 liveChatEnded
    fake.endChat(live.liveChatId as string)
    expect((await call(`/liveChat/messages?liveChatId=${live.liveChatId as string}&pageToken=p3`)).body).toHaveProperty('offlineAt')
    expect(await call(`/liveChat/messages?liveChatId=${live.liveChatId as string}&pageToken=p3`)).toMatchObject({ status: 403, body: { error: { errors: [{ reason: 'liveChatEnded' }] } } })
    expect(fake.calls('liveChatMessages.list')).toBe(5)
    expect(fake.calls('liveChatMessages.insert')).toBe(1)
  })

  it('RA-I3-001·AC-I3-24: 지점 없는 요청은 실제 API처럼 최근 메시지(backlogSize개)부터 — 다음 쪽은 그 뒤로만. 스트림은 연결하면 첫 응답 묶음(새 메시지가 없으면 빈 묶음)을 바로 쓴다', async () => {
    const fake = await start()
    const account = fake.addAccount()
    const channel = fake.addChannel(account, '채널')
    fake.approval = { account, channel: channel.id }
    const { verifier, challenge } = pkce()
    const back = await authorize(fake, challenge)
    const access = (await token(fake, { grant_type: 'authorization_code', code: back.searchParams.get('code') ?? '', code_verifier: verifier, redirect_uri: 'https://app.test/cb' })).body.access_token as string
    const headers = { Authorization: `Bearer ${access}` }
    const live = fake.addBroadcast(channel.id, { status: 'live' })
    const liveChatId = live.liveChatId as string
    // 스트림: 메시지가 없어도 연결하자마자 빈 첫 응답, 메시지가 오면 다음 응답
    const controller = new AbortController()
    const stream = await fetch(`${fake.endpoints().apiBase}/liveChat/messages/stream?liveChatId=${liveChatId}&part=snippet`, { headers, signal: controller.signal })
    expect(stream.status).toBe(200)
    const reader = (stream.body as ReadableStream<Uint8Array>).getReader()
    const splitter = new JsonObjectSplitter()
    const decoder = new TextDecoder()
    const nextObject = async (): Promise<Record<string, unknown>> => {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) throw new Error('스트림이 끝났다')
        const [object] = splitter.push(decoder.decode(chunk.value, { stream: true }))
        if (object !== undefined) return object
      }
    }
    expect(await nextObject()).toMatchObject({ kind: 'youtube#liveChatMessageListResponse', nextPageToken: 'p0', items: [] })
    fake.addMessage(liveChatId, { author: 'UCv', name: '시청자', text: '15' })
    expect(await nextObject()).toMatchObject({ nextPageToken: 'p1', items: [{ snippet: { textMessageDetails: { messageText: '15' } } }] })
    controller.abort()
    // 목록: 지점 없이 부르면 최근 backlogSize개부터
    fake.backlogSize = 5
    for (let i = 0; i < 9; i++) fake.addMessage(liveChatId, { author: `UC${String(i)}`, name: `시청자${String(i)}`, text: `채팅 ${String(i)}` })
    const list = async (query: string) => (await (await fetch(`${fake.endpoints().apiBase}/liveChat/messages?liveChatId=${liveChatId}&part=snippet${query}`, { headers })).json()) as { items: { snippet: { textMessageDetails: { messageText: string } } }[]; nextPageToken: string }
    const first = await list('')
    expect(first.items.map((item) => item.snippet.textMessageDetails.messageText)).toEqual(['채팅 4', '채팅 5', '채팅 6', '채팅 7', '채팅 8'])
    expect(first.nextPageToken).toBe('p10')
    // 지점이 있으면 그 자리부터 (앞부분도 지점으로는 읽힌다)
    expect((await list('&pageToken=p1')).items).toHaveLength(9)
  })

  it('다른 프로세스용 조작 경로 (/_fake/*)', async () => {
    const fake = await start()
    const post = async (path: string, body: unknown) => (await fetch(`${fake.url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json() as Promise<Record<string, unknown>>
    const channel = await post('/_fake/channels', { title: '조작 채널' })
    const broadcast = await post('/_fake/broadcasts', { channelId: channel.id, status: 'live' })
    const message = await post('/_fake/messages', { liveChatId: broadcast.liveChatId, author: 'UCa', name: '가', text: '15' })
    await post('/_fake/delete', { liveChatId: broadcast.liveChatId, messageId: message.id })
    await post('/_fake/ban', { liveChatId: broadcast.liveChatId, channelId: 'UCa', name: '가' })
    await post('/_fake/fail', { method: 'liveChatMessages.insert', fault: { status: 500 } })
    const state = (await (await fetch(`${fake.url}/_fake/state?liveChatId=${String(broadcast.liveChatId)}`)).json()) as { messages: { type: string }[] }
    expect(state.messages.map((item) => item.type)).toEqual(['textMessageEvent', 'messageDeletedEvent', 'userBannedEvent'])
  })
})

describe('AC-Y1-81 E2E 서버와 가짜 유튜브', () => {
  let e2e: E2eServer | null = null
  afterEach(async () => {
    await e2e?.close()
    e2e = null
  })

  it('설정 하나로 가짜 구글·유튜브 서버와 함께 뜨고, 연결 → 잇기 → 시청자 채팅 → 판정 → 감사 게시를 실제 HTTP로 돌릴 수 있다', async () => {
    // 옛 공식 읽기 길(chat: 'official'): E2E 서버 기본은 이제 웹 읽기(YT-11)인데, 웹 잇기는 공식 채팅 ID를 비워 두어 감사 insert가 올라가지 않는다
    // (YT-SRV dev-notes 2번, D-YT-SRV-13 대기). 웹 읽기 E2E 흐름은 fake-web-bridge.test.ts
    e2e = await startE2eServer({ youtube: { port: 0, pollingIntervalMillis: 200, chat: 'official' }, passwordCost: FAST_COST, appOrigin: 'http://localhost:5999' })
    const fake = e2e.fakeGoogle
    if (fake === null) throw new Error('가짜 유튜브가 없다')
    expect(new URL(fake.url).hostname).toBe('127.0.0.1')
    const opened = await e2e.listen(0)
    const base = `http://${opened.host}:${String(opened.port)}`
    const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { Origin: 'http://localhost:5999', 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: e2e.account.loginId, password: e2e.account.password }) })
    const cookie = /lj_session=[^;]+/.exec(login.headers.get('set-cookie') ?? '')?.[0] ?? ''
    const api = async (path: string, method = 'GET', body?: unknown) => {
      const response = await fetch(`${base}${path}`, { method, redirect: 'manual', headers: { Cookie: cookie, Origin: 'http://localhost:5999', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      return { status: response.status, headers: response.headers, body: response.status === 302 ? {} : ((await response.json()) as Record<string, unknown>) }
    }
    // 가짜 쪽 준비 (다른 프로세스처럼 HTTP로)
    const control = async (path: string, body: unknown) => (await fetch(`${fake.url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json() as Promise<Record<string, unknown>>
    const channel = await control('/_fake/channels', { title: '시험 채널' })
    await control('/_fake/approval', { channel: channel.id, account: channel.account })
    // 연결 (읽기) → 게시 동의 (게시 권한)
    const started = await api('/api/youtube/connection/start', 'POST', {})
    const back = await fetch(started.body.authorizeUrl as string, { redirect: 'manual' })
    const callback = new URL(back.headers.get('location') ?? '')
    expect(callback.origin).toBe('http://localhost:5999')
    const done = await api(`${callback.pathname}${callback.search}`)
    expect(done.headers.get('location')).toBe('http://localhost:5999/settings/youtube?youtube=connected')
    const consent = await api('/api/youtube/consent', 'PUT', { target: 'LIVE_CHAT', enabled: true })
    const publishBack = new URL((await fetch(consent.body.authorizeUrl as string, { redirect: 'manual' })).headers.get('location') ?? '')
    await api(`${publishBack.pathname}${publishBack.search}`)
    expect((await api('/api/youtube/connection')).body.connection).toMatchObject({ status: 'CONNECTED', consent: { liveChat: { enabled: true } } })
    // 방송 잇기 → 상품 → 시청자 채팅 → 1등 → 감사 게시
    const broadcast = await control('/_fake/broadcasts', { channelId: channel.id, status: 'live' })
    const created = await api('/api/broadcasts', 'POST', { requestId: 'e2e-b' })
    const b = (created.body.broadcast as { id: string; date: string }).id
    expect((await api(`/api/broadcasts/${b}/youtube`, 'POST', { requestId: 'e2e-link', video: broadcast.videoId })).status).toBe(200)
    expect((await api('/api/events', 'POST', { requestId: 'e2e-p', type: 'product.register', b, no: 15, name: '핑크프릴', price: 10000 })).status).toBe(200)
    await control('/_fake/messages', { liveChatId: broadcast.liveChatId, author: 'UCviewer', name: '홍길동', text: '15', publishedAt: new Date(Date.now() + 1000).toISOString() })
    for (let i = 0; i < 200; i++) {
      const state = (await (await fetch(`${fake.url}/_fake/state`)).json()) as { posted: { text: string }[] }
      if (state.posted.length > 0) {
        expect(state.posted.map((post) => post.text)).toEqual(['15번 핑크프릴 10,000원 홍길동님 구매 감사합니다'])
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error('감사가 게시되지 않았다')
  }, 30_000)
})
