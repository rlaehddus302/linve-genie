// 감사 채팅 다른 길 세 가지 (D-YT-SEND-01~07) — 실제 유튜브·Nightbot 대신 127.0.0.1 가짜 받는 곳에만 보낸다(CLAUDE.md 절대 규칙 7).
// innertube(YouTube.js 내부 API)·browser(Playwright Chromium)·nightbot(공개 API) 각각: 게시됨·메시지 ID, 실패 종류(로그인·속도·거절·응답 없음·모름), 보내기 간격.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { CHAT_SEND_MESSAGES, readYoutubeChatSend } from '../src/config.ts'
import { BrowserChatSender } from '../src/youtube/chat-send/browser-sender.ts'
import { FAKE_BOT_COOKIE, FAKE_BROWSER_SID, FAKE_NIGHTBOT_TOKEN, FAKE_SEND_HOST, FakeChatSend } from '../src/youtube/chat-send/fake-chat-send.ts'
import { InnertubeChatSender, cookieHeaderFromState } from '../src/youtube/chat-send/innertube-sender.ts'
import { NightbotChatSender, nightbotTokenFromFile } from '../src/youtube/chat-send/nightbot-sender.ts'
import { ChatSendError, Pacer, chatSendRoute, type ChatSendTarget } from '../src/youtube/chat-send/sender.ts'
import { realTimer } from '../src/youtube/timer.ts'

const TEXT = '15번 핑크프릴 10,000원 홍길동님 구매 감사합니다'
const TARGET: ChatSendTarget = { videoId: 'VID00000001', channelId: 'UCseller000000000000000', liveChatId: 'chat_VID00000001' }
const BOT = 'UCbot0000000000000000000'
const timer = realTimer()

let fake: FakeChatSend
beforeAll(async () => {
  fake = await FakeChatSend.start()
})
afterAll(async () => {
  await fake.close()
})
afterEach(() => {
  fake.posts.length = 0
  fake.onPost = null
  fake.nightbotGapMs = 5000
})

async function failure(promise: Promise<unknown>): Promise<ChatSendError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(ChatSendError)
    return error as ChatSendError
  }
  throw new Error('실패해야 했다')
}

describe('Pacer 보내기 간격', () => {
  it('같은 길의 보내기는 차례로, 앞 보내기가 끝난 때부터 간격을 둔다', async () => {
    const pacer = new Pacer(timer, 120)
    const starts: number[] = []
    const t0 = Date.now()
    await Promise.all([1, 2, 3].map(() => pacer.run(async () => void starts.push(Date.now() - t0))))
    expect(starts).toHaveLength(3)
    expect((starts[1] ?? 0) - (starts[0] ?? 0)).toBeGreaterThanOrEqual(110)
    expect((starts[2] ?? 0) - (starts[1] ?? 0)).toBeGreaterThanOrEqual(110)
  })

  it('기다리는 동안 signal이 끊기면 보내지 않고 timeout', async () => {
    const pacer = new Pacer(timer, 10_000)
    await pacer.run(async () => {})
    let ran = false
    const error = await failure(pacer.run(async () => void (ran = true), AbortSignal.timeout(50)))
    expect(error.kind).toBe('timeout')
    expect(ran).toBe(false)
  })
})

describe('chatSendRoute 판매자 고르기', () => {
  it('고른 판매자만 다른 길·작성자, 나머지는 공식(null)', () => {
    const sender = new NightbotChatSender({ token: 't', authorChannelId: BOT, timer })
    const route = chatSendRoute(sender, ['s1'])
    expect(route.senderFor('s1')).toBe(sender)
    expect(route.senderFor('s2')).toBeNull()
    expect(route.authorsFor('s1')).toEqual([BOT])
    expect(route.authorsFor('s2')).toEqual([])
    expect(chatSendRoute(sender, '*').senderFor('anyone')).toBe(sender)
  })
})

describe('① innertube — YouTube.js LiveChat.sendMessage', () => {
  const sender = (options: { cookie?: string; timeoutMs?: number } = {}) =>
    new InnertubeChatSender({ cookie: options.cookie ?? FAKE_BOT_COOKIE, authorChannelId: BOT, timer, fetch: fake.youtubeFetch, gapMs: 0, ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) })

  it('쿠키 인증으로 /live_chat/send_message 한 번 → 채팅 추가의 메시지 ID. 보내기 값에 영상·방송 채널 ID가 든다(getInfo 없음)', async () => {
    const before = fake.calls.innertube
    const result = await sender().send(TARGET, TEXT)
    expect(fake.calls.innertube - before).toBe(1)
    expect(fake.posts).toEqual([expect.objectContaining({ route: 'innertube', text: TEXT, videoId: TARGET.videoId, channelId: TARGET.channelId })])
    expect(result.messageId).toBe(fake.posts[0]?.id)
  })

  it('Playwright 로그인 상태 JSON → 유튜브 쿠키 머리글 (유튜브 쿠키만, 끝난 쿠키 뺌)', () => {
    const state = JSON.stringify({
      cookies: [
        { name: 'SAPISID', value: 'a', domain: '.youtube.com', expires: 2_000_000_000 },
        { name: 'SID', value: 'b', domain: '.youtube.com', expires: -1 },
        { name: 'OLD', value: 'c', domain: '.youtube.com', expires: 1000 },
        { name: 'G', value: 'd', domain: '.google.com', expires: -1 },
      ],
    })
    expect(cookieHeaderFromState(state, 1_800_000_000)).toBe('SAPISID=a; SID=b')
  })

  it('SAPISID 없는 쿠키는 만들 때 거절', () => {
    expect(() => new InnertubeChatSender({ cookie: 'SID=x', authorChannelId: BOT, timer })).toThrow()
  })

  it('추가 확인 요구(RunAttestationCommand)만 오면 게시됨으로 보지 않는다 → unverified', async () => {
    fake.failInnertube({ kind: 'attestation' })
    expect((await failure(sender().send(TARGET, TEXT))).kind).toBe('unverified')
  })

  const cases: [string, Parameters<FakeChatSend['failInnertube']>[0], string][] = [
    ['401', { status: 401 }, 'auth'],
    ['403', { status: 403 }, 'auth'],
    ['429', { status: 429 }, 'rate'],
    ['400', { status: 400 }, 'rejected'],
    ['503', { status: 503 }, 'server'],
    ['채팅 추가 없음', { kind: 'noActions' }, 'rejected'],
  ]
  for (const [label, fault, kind] of cases) {
    it(`${label} → ${kind}`, async () => {
      fake.failInnertube(fault)
      const error = await failure(sender().send(TARGET, TEXT))
      expect(error.kind).toBe(kind)
      expect(error.message).not.toContain('SAPISID')
    })
  }

  it('D-YT-SEND-12 서버(IP) 막힘(/sorry로 돌려보냄·HTML 429) → blocked (계정 속도 제한 rate와 다르다)', async () => {
    fake.failInnertube({ kind: 'blocked' })
    expect((await failure(sender().send(TARGET, TEXT))).kind).toBe('blocked')
    expect(fake.posts).toHaveLength(0)
  })

  it('응답 없음 → timeout (시간 제한)', async () => {
    fake.failInnertube({ kind: 'hang' })
    expect((await failure(sender({ timeoutMs: 300 }).send(TARGET, TEXT))).kind).toBe('timeout')
  })

  it('세션은 한 번 만들고 다시 쓴다 — 두 번째 보내기도 요청 하나', async () => {
    const one = sender()
    await one.send(TARGET, '하나')
    const before = fake.calls.innertube
    await one.send(TARGET, '둘')
    expect(fake.calls.innertube - before).toBe(1)
    expect(fake.posts.map((post) => post.text)).toEqual(['하나', '둘'])
  })
})

describe('② browser — Playwright Chromium 팝아웃 채팅', () => {
  let dir: string
  let statePath: string
  const signedIn = (path: string) =>
    writeFile(path, JSON.stringify({ cookies: [{ name: 'SID', value: FAKE_BROWSER_SID, domain: FAKE_SEND_HOST, path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [] }))
  const senders: BrowserChatSender[] = []
  const sender = (path = statePath, confirmMs = 1500) => {
    const created = new BrowserChatSender({ headless: true, storageStatePath: path, authorChannelId: BOT, timer, baseUrl: fake.url, allowedHosts: [FAKE_SEND_HOST], gapMs: 0, confirmMs, timeoutMs: 5000 })
    senders.push(created)
    return created
  }
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'livejjim-browser-send-'))
    statePath = join(dir, 'state.json')
    await signedIn(statePath)
  })
  afterEach(async () => {
    for (const item of senders.splice(0)) await item.close()
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('입력 칸에 넣고 보내기 → 새로 뜬 같은 글의 요소 id가 메시지 ID, 로그인 상태 파일을 다시 적는다', async () => {
    const result = await sender().send(TARGET, TEXT)
    expect(fake.posts).toEqual([expect.objectContaining({ route: 'browser', text: TEXT, videoId: TARGET.videoId })])
    expect(result.messageId).toBe(fake.posts[0]?.id)
    const state = JSON.parse(await readFile(statePath, 'utf8')) as { cookies: { name: string }[] }
    expect(state.cookies.map((cookie) => cookie.name)).toContain('SID')
  })

  it('이미 있던 같은 글(앞 시청자가 복사)은 확인으로 쓰지 않는다 — 새로 뜬 것만', async () => {
    fake.seed('VIDSEED0001', { id: 'old-same', name: '시청자', text: TEXT })
    const result = await sender().send({ ...TARGET, videoId: 'VIDSEED0001' }, TEXT)
    expect(result.messageId).not.toBe('old-same')
    expect(result.messageId).toBe(fake.posts[0]?.id)
  })

  it('같은 방송은 페이지를 다시 열지 않는다', async () => {
    const one = sender()
    await one.send(TARGET, '하나')
    const before = fake.calls.browserPage
    await one.send(TARGET, '둘')
    expect(fake.calls.browserPage).toBe(before)
    expect(fake.posts.map((post) => post.text)).toEqual(['하나', '둘'])
  })

  it('로그인 상태가 없으면 입력 칸 대신 로그인 링크 → auth, 아무것도 올리지 않는다', async () => {
    const empty = join(dir, 'empty.json')
    await writeFile(empty, JSON.stringify({ cookies: [], origins: [] }))
    const error = await failure(new BrowserChatSender({ headless: true, storageStatePath: empty, authorChannelId: BOT, timer, baseUrl: fake.url, allowedHosts: [FAKE_SEND_HOST], gapMs: 0, timeoutMs: 1500 }).send(TARGET, TEXT).finally(() => undefined))
    expect(error.kind).toBe('auth')
    expect(fake.posts).toHaveLength(0)
  })

  it('화면에 임시 id(COCp…)로만 뜨고 진짜 메시지 ID로 바뀌지 않으면 게시됨이지만 메시지 ID는 없음(임시 id를 쓰지 않는다)', async () => {
    fake.failBrowser({ kind: 'tempOnly' })
    const result = await sender().send(TARGET, TEXT)
    expect(result.messageId).toBeNull()
    expect(fake.posts).toHaveLength(1)
  })

  it('보냈는데 화면에 안 뜨면 unverified — 다시 넣지 않는다(게시 1번)', async () => {
    fake.failBrowser({ kind: 'drop' })
    const error = await failure(sender(statePath, 600).send(TARGET, TEXT))
    expect(error.kind).toBe('unverified')
    expect(fake.posts).toHaveLength(1)
  })

  it('허락한 호스트 밖으로 가는 브라우저 요청은 막는다 (실제 유튜브로 나가지 않음)', async () => {
    const blocked = new BrowserChatSender({ headless: true, storageStatePath: statePath, authorChannelId: BOT, timer, baseUrl: 'https://www.youtube.com', allowedHosts: [FAKE_SEND_HOST], gapMs: 0, timeoutMs: 1500 })
    senders.push(blocked)
    expect((await failure(blocked.send(TARGET, TEXT))).kind).toBe('network')
  })
})

describe('③ nightbot — POST /1/channel/send', () => {
  const sender = (options: { token?: string; gapMs?: number; timeoutMs?: number } = {}) =>
    new NightbotChatSender({ token: options.token ?? FAKE_NIGHTBOT_TOKEN, authorChannelId: BOT, timer, baseUrl: fake.url, gapMs: options.gapMs ?? 0, ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) })

  it('Bearer 토큰·chatId(공식 채팅 ID)로 보낸다 — 메시지 ID는 모른다', async () => {
    const result = await sender().send(TARGET, TEXT)
    expect(result).toEqual({ messageId: null })
    expect(fake.posts).toEqual([expect.objectContaining({ route: 'nightbot', text: TEXT, chatId: TARGET.liveChatId })])
  })

  it('채팅 ID가 비면 보내지 않는다(모든 채팅방에 올라가지 않게) → rejected', async () => {
    const before = fake.calls.nightbot
    expect((await failure(sender().send({ ...TARGET, liveChatId: '' }, TEXT))).kind).toBe('rejected')
    expect(fake.calls.nightbot).toBe(before)
  })

  it('채팅 ID 없이 보내기는 allowAllChats일 때만 (본문에 chatId를 넣지 않는다)', async () => {
    fake.nightbotGapMs = 0
    const all = new NightbotChatSender({ token: FAKE_NIGHTBOT_TOKEN, authorChannelId: BOT, timer, baseUrl: fake.url, gapMs: 0, allowAllChats: true })
    await all.send({ ...TARGET, liveChatId: '' }, TEXT)
    expect(fake.posts).toEqual([expect.objectContaining({ route: 'nightbot', chatId: null })])
  })

  it('토큰 파일: 글 그대로 또는 nightbot-login이 적은 JSON', () => {
    expect(nightbotTokenFromFile(' abc \n')).toBe('abc')
    expect(nightbotTokenFromFile(JSON.stringify({ accessToken: 'tok', refreshToken: 'r' }))).toBe('tok')
  })

  it('틀린 토큰 → auth (토큰은 오류에 없다)', async () => {
    const error = await failure(sender({ token: 'wrong-token' }).send(TARGET, TEXT))
    expect(error.kind).toBe('auth')
    expect(error.message).not.toContain('wrong-token')
  })

  it('간격 없이 연달아 보내면 Nightbot이 429 → rate. 간격을 지키면 둘 다 올라간다', async () => {
    fake.nightbotGapMs = 300
    // 앞 시험의 보내기가 가짜 Nightbot 간격 안에 있지 않게
    await new Promise((resolve) => setTimeout(resolve, 350))
    const fast = sender()
    await fast.send(TARGET, '하나')
    expect((await failure(fast.send(TARGET, '둘'))).kind).toBe('rate')
    await new Promise((resolve) => setTimeout(resolve, 350))
    const paced = sender({ gapMs: 350 })
    await paced.send(TARGET, '셋')
    await paced.send(TARGET, '넷')
    expect(fake.posts.map((post) => post.text)).toEqual(['하나', '셋', '넷'])
  })

  it('500 → server, 응답 없음 → timeout', async () => {
    fake.failNightbot({ status: 500 })
    expect((await failure(sender().send(TARGET, TEXT))).kind).toBe('server')
    fake.failNightbot({ kind: 'hang' })
    expect((await failure(sender({ timeoutMs: 300 }).send(TARGET, TEXT))).kind).toBe('timeout')
  })
})

describe('D-YT-SEND-08 설정 (LIVEJJIM_YT_SEND_*)', () => {
  const full = { LIVEJJIM_YT_SEND_ROUTE: 'innertube', LIVEJJIM_YT_SEND_SELLERS: 's1, s2', LIVEJJIM_YT_SEND_CHANNEL_ID: BOT, LIVEJJIM_YT_SEND_SECRET_FILE: '/run/secrets/yt-cookie' }

  it('없거나 official이면 공식만 (기본)', () => {
    expect(readYoutubeChatSend({})).toEqual({ ok: true, send: null })
    expect(readYoutubeChatSend({ LIVEJJIM_YT_SEND_ROUTE: 'official' })).toEqual({ ok: true, send: null })
  })

  // 설정 모양은 D-YT-SEND-12(계정 목록)·13(공식 넘김)으로 바뀌었다 — 계정 하나는 single
  it('다른 길: 판매자 목록·작성자 채널·로그인 파일', () => {
    expect(readYoutubeChatSend(full)).toEqual({
      ok: true,
      send: { route: 'innertube', sellers: ['s1', 's2'], single: { authorChannelId: BOT, secretFile: '/run/secrets/yt-cookie' }, accountsFile: null, chromiumPath: null, official: null },
    })
    expect(readYoutubeChatSend({ ...full, LIVEJJIM_YT_SEND_ROUTE: 'Browser', LIVEJJIM_YT_SEND_SELLERS: '*' })).toMatchObject({ ok: true, send: { route: 'browser', sellers: '*' } })
  })

  it('하나라도 없거나 틀리면 시작하지 않는다 — 문장에 값을 넣지 않는다', () => {
    expect(readYoutubeChatSend({ ...full, LIVEJJIM_YT_SEND_ROUTE: 'telegram' })).toEqual({ ok: false, message: CHAT_SEND_MESSAGES.ROUTE })
    expect(readYoutubeChatSend({ ...full, LIVEJJIM_YT_SEND_SELLERS: ' , ' })).toEqual({ ok: false, message: CHAT_SEND_MESSAGES.SELLERS })
    expect(readYoutubeChatSend({ ...full, LIVEJJIM_YT_SEND_CHANNEL_ID: 'Nightbot' })).toEqual({ ok: false, message: CHAT_SEND_MESSAGES.CHANNEL })
    expect(readYoutubeChatSend({ ...full, LIVEJJIM_YT_SEND_SECRET_FILE: '' })).toEqual({ ok: false, message: CHAT_SEND_MESSAGES.SECRET })
  })
})
