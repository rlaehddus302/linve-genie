// YT-11 서버가 유튜브 채팅 읽기 (D-YT-SRV-01~10): 가짜 유튜브 웹 서버(127.0.0.1)에 실제 통신 방식(HTML·JSON POST)으로 붙는다.
// 구글 연결 없이 잇기·처음 잇는 채널 확인·거절, 수집(메시지 종류·잇기 전 거르기·지움/숨김 알림), 간격(timeoutMs 1~10초)·백오프(연결 오류·막힘),
// 끝 확인, 이어받기·지점 거절, 모르는 모양, 운영자 끄기(요청 0), 구글 연결 상태와 무관, 예정 방송, 최근 채널 찾기, 운영 상태 합계.
import { afterEach, describe, expect, it } from 'vitest'
import { FIRST_CHANNEL_CONFIRM_MESSAGE, RECENT_VIDEO_RECHECK_MS } from '../src/youtube/system.ts'
import { DESKTOP_USER_AGENT } from '../src/youtube/web-chat-source.ts'
import { addSeller, client, createBroadcast } from './support.ts'
import { approve, callback, type YoutubeWorld } from './youtube-support.ts'
import { chatEvents, collectorOfWorld, errorOf, pass, waitFor, webLinked, webWorld, type WebWorld } from './youtube-web-support.ts'

const OPS_TOKEN = 'ops-token-for-youtube-web-chat-tests-0123456789'
const SCREEN_TOKEN = 'screen-worker-token-0123456789abcdef'

const worlds: WebWorld[] = []
async function world(options: Parameters<typeof webWorld>[0] = {}): Promise<WebWorld> {
  const created = await webWorld(options)
  worlds.push(created)
  return created
}
afterEach(async () => {
  const closing = worlds.splice(0)
  for (const item of closing) {
    item.server.close()
    await item.server.stop()
  }
  for (const item of new Set(closing.map((w) => w.web))) await item.close()
  for (const item of closing) await item.google?.close()
})

const collector = (w: WebWorld, cookie: string, b: string) => collectorOfWorld(w, cookie, b)
const pollGaps = (w: WebWorld, from: number) => {
  const times = w.web.callTimes('poll').slice(from)
  return times.slice(1).map((at, i) => at - (times[i] as number))
}
/**
 * 부른 사이 간격이 기대값 이상, 기대값 + slack 미만인지 (시계를 조금씩 옮기는 동안 실제 HTTP가 돌아 도착 시각이 한두 걸음 늦을 수 있다 —
 * 더 일찍 부르는 일은 없어야 한다)
 */
const expectGaps = (gaps: readonly number[], expected: readonly number[], slack: number) => {
  expect(gaps.length, `간격 ${JSON.stringify(gaps)}`).toBeGreaterThanOrEqual(expected.length)
  expected.forEach((value, i) => {
    const gap = gaps[i] as number
    expect(gap, `${String(i)}번째 간격 ${JSON.stringify(gaps)}`).toBeGreaterThanOrEqual(value)
    expect(gap, `${String(i)}번째 간격 ${JSON.stringify(gaps)}`).toBeLessThan(value + slack)
  })
}

describe('AC2 서버 잇기 — 구글 연결 없이 주소만', () => {
  it('구글 OAuth 설정이 없는 서버에서 잇고 받는다: 처음 잇는 채널은 확인 줄(채널 이름), 확인하면 잇고, 같은 채널의 다음 회차는 바로 잇는다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const api = client(w, seller.cookie)
    // 구글 연결 화면은 503 (감사 게시용 — 설정 없음), 연결 상태는 읽기 길을 알린다
    expect((await api.post('/api/youtube/connection/start', {})).status).toBe(503)
    expect((await api.get('/api/youtube/connection')).body).toMatchObject({ connection: { status: 'NOT_CONNECTED' }, webChat: { on: true }, oauth: false })
    const video = w.web.addVideo({ channelTitle: '<b>구피네</b>' })
    const b1 = await createBroadcast(w, seller)
    const first = await api.post(`/api/broadcasts/${b1.id}/youtube`, { requestId: 'l1', video: `https://youtu.be/${video.videoId}` })
    expect(first.status).toBe(409)
    expect(first.body).toEqual({ channel: { id: video.channelId, title: '<b>구피네</b>' }, error: { code: 'INVITED_CONFIRM_NEEDED', message: FIRST_CHANNEL_CONFIRM_MESSAGE } })
    expect((await api.get(`/api/broadcasts/${b1.id}/youtube`)).body).toEqual({ link: null, collector: null })
    const linked = await api.post(`/api/broadcasts/${b1.id}/youtube`, { requestId: 'l2', video: video.videoId, confirmInvited: true })
    expect(linked.status, JSON.stringify(linked.body)).toBe(200)
    expect(linked.body).toMatchObject({ link: { videoId: video.videoId, broadcastChannelId: video.channelId, broadcastChannelTitle: '<b>구피네</b>' }, collector: { mode: 'WEB', status: 'STARTING' } })
    // 같은 채널의 다음 회차: 확인 없이
    const next = w.web.addVideo({ channelId: video.channelId, channelTitle: '구피네' })
    const b2 = await createBroadcast(w, seller, { date: '2026-10-20' })
    expect((await api.post(`/api/broadcasts/${b2.id}/youtube`, { requestId: 'l3', video: `https://www.youtube.com/live/${next.videoId}` })).status).toBe(200)
    // 공식 Data API를 부르지 않는다 (구글 설정 자체가 없다) — 유튜브 웹 요청만
    expect(w.web.calls('watch')).toBeGreaterThan(0)
  })

  it('거절: 로그인 없이 볼 수 없는 방송(비공개·멤버 전용·연령 제한), 끝남·라이브 아님·없음·채팅 꺼짐·전체 채팅 지점 없음, 막힘', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const api = client(w, seller.cookie)
    const b = await createBroadcast(w, seller)
    const tryLink = async (videoId: string) => {
      const response = await api.post(`/api/broadcasts/${b.id}/youtube`, { requestId: `r-${videoId}-${String(Math.random()).slice(2, 8)}`, video: videoId, confirmInvited: true })
      return [response.status, errorOf(response.body).code, errorOf(response.body).message]
    }
    for (const state of ['private', 'members', 'age'] as const) {
      expect(await tryLink(w.web.addVideo({ state }).videoId)).toEqual([409, 'YOUTUBE_NOT_PUBLIC', '로그인 없이 볼 수 있는 방송만 이을 수 있어요. 공개나 일부공개로 바꿔 주세요.'])
    }
    for (const state of ['ended', 'vod', 'missing', 'chatOff'] as const) {
      expect(await tryLink(w.web.addVideo({ state }).videoId)).toEqual([409, 'NO_LIVE_CHAT', '채팅을 받을 수 없는 방송이에요. 끝났거나 채팅이 꺼져 있어요.'])
    }
    const topOnly = w.web.addVideo()
    topOnly.topChatOnly = true
    expect((await tryLink(topOnly.videoId))[1]).toBe('NO_LIVE_CHAT')
    // 방송 페이지와 대신 확인(next, D-YT-SRV-19)이 둘 다 막힘 — 방송 페이지만 막힌 때는 아래 'D-YT-SRV-19' 시험
    w.web.fail('watch', { kind: 'bot' })
    w.web.fail('next', { kind: 'bot' })
    expect(await tryLink(w.web.addVideo().videoId)).toEqual([502, 'YOUTUBE_UNAVAILABLE', '유튜브에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.'])
    expect(w.logs.filter((log) => log.level !== 'alert' && log.code === 'YT_CHAT_BLOCKED')).toHaveLength(1)
    expect((await api.get(`/api/broadcasts/${b.id}/youtube`)).body).toEqual({ link: null, collector: null })
  })
})

describe('AC3·AC4·AC9 수집', () => {
  it('메시지 종류·이름 정리·주인 배지·잇기 전 거르기, 지움·숨김 알림 — 요청은 고정 사용자 에이전트, 쿠키·로그인 없음', async () => {
    const w = await world()
    const video = w.web.addVideo()
    w.web.addMessage(video.videoId, { id: 'before', author: 'UCold', name: '먼저', text: '1', publishedAt: w.timer.now() - 60_000 })
    const { seller, b } = await webLinked(w, { video })
    w.server.youtube?.collectors.start()
    const at = w.timer.now() + 1000
    w.web.addMessage(video.videoId, { id: 'm1', author: 'UCa', name: '@핑크맘\n15번', text: '15', publishedAt: at })
    w.web.addMessage(video.videoId, { id: 'm2', author: 'UCb', name: '후원자', type: 'superChat', text: '16번 주세요', publishedAt: at })
    w.web.addMessage(video.videoId, { id: 'm3', author: 'UCc', name: '말없는후원', type: 'superChat', publishedAt: at })
    w.web.addMessage(video.videoId, { id: 'm4', author: 'UCd', name: '멤버', type: 'membership', text: '17', publishedAt: at })
    w.web.addMessage(video.videoId, { id: 'm5', author: 'UCe', name: '스티커', type: 'sticker', publishedAt: at })
    w.web.addMessage(video.videoId, { id: 'm6', author: 'UCmod', name: '운영자', text: '18', moderator: true, publishedAt: at })
    w.web.addMessage(video.videoId, { id: 'm7', author: video.channelId, name: '유튜버', text: '주인 글', owner: true, publishedAt: at })
    w.web.addMessage(video.videoId, { id: 'm8', author: 'UCf', name: '이모지', runs: [{ text: '19 ' }, { emoji: { emojiId: '😀', shortcuts: [':grinning:'] } }, { emoji: { emojiId: 'UCx/y', shortcuts: [':_cat:'], isCustomEmoji: true } }], publishedAt: at })
    w.web.addMessage(video.videoId, { id: 'm1', author: 'UCa', name: '핑크맘', text: '15', publishedAt: at, replace: true })
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).recorded === 6)
    const bodies = (await chatEvents(w)).map(({ seq: _seq, at: _at, ...rest }) => rest)
    expect(bodies).toEqual([
      { type: 'chat', b: b.id, id: 'm1', ch: 'UCa', nick: '핑크맘 15번', text: '15', publishedAt: at },
      { type: 'chat', b: b.id, id: 'm2', ch: 'UCb', nick: '후원자', text: '16번 주세요', publishedAt: at },
      { type: 'chat', b: b.id, id: 'm4', ch: 'UCd', nick: '멤버', text: '17', publishedAt: at },
      { type: 'chat', b: b.id, id: 'm6', ch: 'UCmod', nick: '운영자', text: '18', publishedAt: at },
      { type: 'chat', b: b.id, id: 'm7', ch: video.channelId, nick: '유튜버', text: '주인 글', owner: true, publishedAt: at },
      { type: 'chat', b: b.id, id: 'm8', ch: 'UCf', nick: '이모지', text: '19 😀:_cat:', publishedAt: at },
    ])
    expect(await collector(w, seller.cookie, b.id)).toMatchObject({ mode: 'WEB', status: 'LIVE', reason: null, skippedBeforeLink: 1, gap: false })
    const rows = await w.database.pglite?.query<{ actor: string; chat_source: string }>(`select actor, chat_source from events where type = 'chat'`)
    expect(rows?.rows.every((row) => row.actor === 'collector' && row.chat_source === 'youtube')).toBe(true)
    // 지움(기록한 메시지만)·한 작성자 글 모두 지움 → 알림 (판정은 그대로)
    w.web.deleteMessage(video.videoId, 'm2')
    w.web.deleteMessage(video.videoId, 'before')
    w.web.removeAuthor(video.videoId, 'UCmod')
    const api = client(w, seller.cookie)
    await waitFor(w, async () => ((await api.get(`/api/days/${b.date}/youtube-notices`)).body.notices as unknown[]).length === 2)
    const notices = (await api.get(`/api/days/${b.date}/youtube-notices`)).body.notices as Record<string, unknown>[]
    expect(notices.map((notice) => [notice.kind, notice.messageId, notice.channel, notice.banType])).toEqual(
      expect.arrayContaining([
        ['DELETED', 'm2', 'UCb', null],
        ['BANNED', null, 'UCmod', null],
      ]),
    )
    // 요청: 고정 데스크톱 브라우저 값, 쿠키·인증 머리글 없음. get_live_chat 클라이언트 값은 페이지가 알려 준 것
    expect(w.web.requestHeaders.every((headers) => headers['user-agent'] === DESKTOP_USER_AGENT && headers.cookie === undefined && headers.authorization === undefined)).toBe(true)
    expect(w.web.pollClients[0]).toMatchObject({ clientName: 'WEB', clientVersion: '2.20261029.01.00', hl: 'en' })
    expect(String(w.web.pollClients[0]?.visitorData)).toMatch(/^fake-visitor-/)
  })

  it('다음 부름 = 앞 응답을 받은 뒤 timeoutMs — 10초 넘으면 10초, 1초 미만이면 1초, 없으면 5초', async () => {
    const w = await world()
    const { seller, b } = await webLinked(w)
    w.server.youtube?.collectors.start()
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).status === 'LIVE')
    for (const [timeoutMs, expected] of [
      [30_000, 10_000],
      [200, 1000],
      [null, 5000],
      [3000, 3000],
    ] as const) {
      w.web.timeoutMs = timeoutMs
      await pass(w, 12_000) // 바뀐 값이 응답에 실릴 때까지
      const from = w.web.calls('poll')
      await pass(w, 40_000, 100)
      const gaps = pollGaps(w, from)
      expect(gaps.length).toBeGreaterThan(2)
      expectGaps(gaps, gaps.map(() => expected), 400)
    }
  })

  it('실패 뒤: 5xx는 5·10·20·30초, 막힘(429)은 바로 "막았어요" + 경보 한 번, 30·60·120초 — 받으면 경고를 내리고 처음으로', async () => {
    const w = await world()
    const { seller, b, video } = await webLinked(w)
    w.web.timeoutMs = 1000
    w.server.youtube?.collectors.start()
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).status === 'LIVE')
    w.web.fail('poll', { status: 503 }, 4)
    const from = w.web.calls('poll')
    await pass(w, 80_000, 500)
    expectGaps(pollGaps(w, from), [5000, 10_000, 20_000, 30_000], 1500)
    expect(await collector(w, seller.cookie, b.id)).toMatchObject({ status: 'LIVE', reason: null })
    // 막힘
    w.web.fail('poll', { status: 429 }, 3)
    const blockedFrom = w.web.calls('poll')
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).reason === 'BLOCKED', { step: 200 })
    expect(await collector(w, seller.cookie, b.id)).toMatchObject({
      status: 'RETRYING',
      reason: 'BLOCKED',
      reasonMessage: '유튜브가 채팅 읽기를 잠시 막았어요. 다시 될 때까지 주문은 손으로 넣어 주세요.',
    })
    await pass(w, 260_000, 1000)
    expectGaps(pollGaps(w, blockedFrom), [30_000, 60_000, 120_000], 3000)
    w.web.addMessage(video.videoId, { author: 'UCa', name: '가', text: '다시' })
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).recorded === 1)
    expect(await collector(w, seller.cookie, b.id)).toMatchObject({ status: 'LIVE', reason: null })
    expect(w.logs.filter((log) => log.level !== 'alert' && log.code === 'YT_CHAT_BLOCKED')).toHaveLength(1)
    // 경보 기록: 판매자 정보 없이 (10분에 한 번)
    expect(w.logs.some((log) => log.level === 'alert' && log.code === 'YT_CHAT_BLOCKED' && log.seller === undefined)).toBe(true)
  })

  it('연결 오류가 한 수집기에서 5번 이어지면 운영자 경보 YT_CHAT_NETWORK', async () => {
    const w = await world()
    const { seller, b } = await webLinked(w)
    w.server.youtube?.collectors.start()
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).status === 'LIVE')
    w.web.fail('poll', { kind: 'reset' }, 5)
    await pass(w, 120_000, 1000)
    expect(w.logs.filter((log) => log.level !== 'alert' && log.code === 'YT_CHAT_NETWORK')).toHaveLength(1)
    expect(w.logs.some((log) => log.level === 'alert' && log.code === 'YT_CHAT_NETWORK')).toBe(true)
    expect(await collector(w, seller.cookie, b.id)).toMatchObject({ status: 'LIVE' })
  })

  it('다음 지점이 없으면 공개 페이지로 확인해 끝났을 때만 채팅 끝남 — 아직 진행 중이면 모르는 모양(경고·경보) 뒤 새 전체 채팅 지점으로 다시', async () => {
    const w = await world()
    const { seller, b, video } = await webLinked(w)
    w.web.timeoutMs = 1000
    w.server.youtube?.collectors.start()
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).status === 'LIVE')
    // 형식이 바뀌어 다음 지점이 빠진 응답 (방송은 진행 중)
    w.web.raw(video.videoId, { responseContext: {}, continuationContents: { liveChatContinuation: { actions: [] } } })
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).reason === 'FORMAT', { step: 200 })
    expect(await collector(w, seller.cookie, b.id)).toMatchObject({ status: 'RETRYING', reasonMessage: '유튜브가 바뀌어 채팅을 자동으로 읽지 못하고 있어요. 주문은 손으로 넣어 주세요.', gap: true })
    expect(w.logs.filter((log) => log.level !== 'alert' && log.code === 'YT_CHAT_FORMAT')).toHaveLength(1)
    w.web.addMessage(video.videoId, { author: 'UCa', name: '가', text: '이어서' })
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).status === 'LIVE', { step: 500 })
    expect((await collector(w, seller.cookie, b.id)).recorded).toBe(1)
    // 진짜 끝
    video.state = 'ended'
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).status === 'CHAT_ENDED', { step: 500 })
    expect((await client(w, seller.cookie).get(`/api/broadcasts/${b.id}/youtube`)).body.link).toMatchObject({ chatEnded: true })
  })

  it('1분 동안 읽은 메시지 0개인데 모르는 종류만 오면 모르는 모양 — 메시지를 읽으면 경고를 내린다', async () => {
    const w = await world()
    const { seller, b, video } = await webLinked(w)
    w.web.timeoutMs = 5000
    w.server.youtube?.collectors.start()
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).status === 'LIVE')
    for (let i = 0; i < 14; i++) {
      w.web.addMessage(video.videoId, { author: 'UCa', name: '가', type: 'unknown', text: `${String(i)}` })
      await pass(w, 5000, 500)
    }
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).reason === 'FORMAT', { step: 500 })
    expect(w.logs.some((log) => log.code === 'YT_CHAT_UNKNOWN_ITEM' && log.reason === 'liveChatFutureThingRenderer')).toBe(true)
    w.web.addMessage(video.videoId, { author: 'UCb', name: '나', text: '15' })
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).status === 'LIVE', { step: 500 })
    expect((await collector(w, seller.cookie, b.id)).recorded).toBe(1)
  })

  it('이어받기: 다른 서버가 저장한 지점부터 — 누락·중복 없음. 지점 거절이면 새 전체 채팅 지점으로 + "끊긴 동안 일부"', async () => {
    const w = await world()
    const { seller, b, video } = await webLinked(w)
    w.web.timeoutMs = 1000
    w.server.youtube?.collectors.start()
    w.web.addMessage(video.videoId, { id: 'a1', author: 'UCa', name: '가', text: '1' })
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).recorded === 1)
    await w.server.youtube?.collectors.kill()
    w.web.addMessage(video.videoId, { id: 'a2', author: 'UCa', name: '가', text: '2' })
    const other = await world({ database: w.database, masterKey: w.masterKey, web: w.web, timer: w.timer, name: 'B' })
    const pagesBefore = w.web.calls('chatPage')
    other.server.youtube?.collectors.start()
    await waitFor(other, async () => (await collector(other, seller.cookie, b.id)).recorded === 2, { step: 1000 })
    expect((await chatEvents(other)).map((event) => event.id)).toEqual(['a1', 'a2'])
    expect(await collector(other, seller.cookie, b.id)).toMatchObject({ gap: false, status: 'LIVE' })
    // 새 서버는 채팅 페이지에서 호출 정보만 다시 받았다 (지점은 저장한 것)
    expect(w.web.calls('chatPage') - pagesBefore).toBe(1)
    // 지점 거절
    w.web.fail('poll', { status: 400 })
    w.web.addMessage(video.videoId, { id: 'a3', author: 'UCa', name: '가', text: '3' })
    await waitFor(other, async () => (await collector(other, seller.cookie, b.id)).recorded === 3, { step: 500 })
    expect(await collector(other, seller.cookie, b.id)).toMatchObject({ gap: true, gapMessage: '끊긴 동안의 채팅 일부를 받지 못했을 수 있어요.', status: 'LIVE' })
    expect((await chatEvents(other)).map((event) => event.id)).toEqual(['a1', 'a2', 'a3'])
  })

  it('예정 방송: 채팅을 부르지 않고 30초마다 공개 페이지로 상태만 — 시작한 뒤의 글부터 받는다', async () => {
    const w = await world()
    const video = w.web.addVideo({ state: 'upcoming', startedAt: w.timer.now() + 3_600_000 })
    const { seller, b } = await webLinked(w, { video })
    expect(await collector(w, seller.cookie, b.id)).toMatchObject({ status: 'STARTING', reason: 'NOT_STARTED' })
    w.server.youtube?.collectors.start()
    w.web.addMessage(video.videoId, { id: 'pre', author: 'UCa', name: '가', text: '미리' })
    const watchBefore = w.web.calls('watch')
    await pass(w, 95_000, 1000)
    expect(w.web.calls('poll')).toBe(0)
    expect(w.web.calls('watch') - watchBefore).toBe(3)
    video.state = 'live'
    video.startedAt = w.timer.now()
    await pass(w, 1000)
    w.web.addMessage(video.videoId, { id: 'post', author: 'UCa', name: '가', text: '15' })
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).recorded === 1, { step: 1000 })
    expect((await chatEvents(w)).map((event) => event.id)).toEqual(['post'])
  })
})

describe('AC6 운영자 끄기, AC9 구글 연결과 무관, AC5 운영 상태', () => {
  it('끄면 유튜브에 아무 요청도 하지 않는다: 새 잇기·찾기 거절, 이은 회차 수집은 멈춤(OPERATOR_OFF)', async () => {
    const w = await world()
    const { seller, b } = await webLinked(w)
    const off = await world({ database: w.database, masterKey: w.masterKey, web: w.web, timer: w.timer, name: 'OFF', on: false })
    const before = w.web.calls()
    off.server.youtube?.collectors.start()
    await waitFor(off, async () => (await collector(off, seller.cookie, b.id)).status === 'STOPPED', { step: 1000 })
    expect(await collector(off, seller.cookie, b.id)).toMatchObject({ reason: 'OPERATOR_OFF', reasonMessage: '지금은 유튜브 채팅을 자동으로 받지 않아요. 주문은 손으로 넣어 주세요.', restartable: false })
    const api = client(off, seller.cookie)
    const b2 = await createBroadcast(off, seller, { date: '2026-10-21' })
    const refused = await api.post(`/api/broadcasts/${b2.id}/youtube`, { requestId: 'off-1', video: w.web.addVideo().videoId, confirmInvited: true })
    expect([refused.status, errorOf(refused.body).code, errorOf(refused.body).message]).toEqual([409, 'YOUTUBE_WEB_CHAT_OFF', '지금은 유튜브 채팅을 자동으로 받지 않아요. 주문은 손으로 넣어 주세요.'])
    expect(errorOf((await api.get('/api/youtube/live-broadcasts')).body).code).toBe('YOUTUBE_WEB_CHAT_OFF')
    expect((await api.get('/api/youtube/connection')).body.webChat).toEqual({ on: false })
    await pass(off, 60_000, 1000)
    expect(w.web.calls()).toBe(before)
  })

  it('구글 연결이 끊겨도 받는다 — 읽기에 공식 Data API를 부르지 않는다', async () => {
    const w = await world({ google: true })
    const google = w.google
    if (google === null) throw new Error('가짜 구글 없음')
    const seller = await addSeller(w)
    // 구글 연결 (감사 게시용 — 선택)
    const account = google.addAccount()
    const channel = google.addChannel(account, '사장님 채널')
    google.approval = { account, channel: channel.id }
    const api = client(w, seller.cookie)
    const started = await api.post('/api/youtube/connection/start', {})
    expect(await callback(w as unknown as YoutubeWorld, seller.cookie, await approve(started.body.authorizeUrl as string))).toBe('connected')
    const { b, video } = await webLinked(w, { seller })
    w.server.youtube?.collectors.start()
    w.web.addMessage(video.videoId, { author: 'UCa', name: '가', text: '1' })
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).recorded === 1)
    expect((await api.post('/api/youtube/connection/disconnect', {})).status).toBe(200)
    w.web.addMessage(video.videoId, { author: 'UCb', name: '나', text: '2' })
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).recorded === 2, { step: 500 })
    expect(await collector(w, seller.cookie, b.id)).toMatchObject({ status: 'LIVE', reason: null })
    for (const method of ['videos.list', 'liveChatMessages.list', 'liveChatMessages.streamList', 'liveBroadcasts.list'] as const) expect(google.calls(method)).toBe(0)
  })

  it('최근 채널 찾기: 최근 이은 채널의 지금 방송을 "{채널 이름} · {제목}"으로, 확인 없이 한 번에 잇기 · 운영 상태 합계', async () => {
    const w = await world({ overrides: { opsToken: OPS_TOKEN } })
    const { seller, video } = await webLinked(w)
    const api = client(w, seller.cookie)
    const now = w.web.addVideo({ channelId: video.channelId, channelTitle: '초대 채널', title: '오늘 방송' })
    video.state = 'ended'
    const found = await api.get('/api/youtube/live-broadcasts')
    expect(found.status).toBe(200)
    expect(found.body.broadcasts).toEqual([{ videoId: now.videoId, title: '오늘 방송', status: 'LIVE', scheduledStartTime: null, actualStartTime: new Date(now.startedAt).toISOString(), channelId: video.channelId, channelTitle: '초대 채널', linkedBroadcast: null }])
    const b2 = await createBroadcast(w, seller, { date: '2026-10-22' })
    expect((await api.post(`/api/broadcasts/${b2.id}/youtube`, { requestId: 'recent-1', video: now.videoId })).status).toBe(200)
    w.server.youtube?.collectors.start()
    await waitFor(w, async () => (await collector(w, seller.cookie, b2.id)).status === 'LIVE')
    const ops = await w.server.app.request('/ops/status', { headers: { Authorization: `Bearer ${OPS_TOKEN}` } })
    const body = (await ops.json()) as { youtubeWebChat: Record<string, unknown> }
    expect(body.youtubeWebChat).toMatchObject({ operator: 'on', receiving: 1, blocked: 0, format: 0 })
    expect(body.youtubeWebChat.requestsPerMinute).toEqual(expect.any(Number))
    expect(JSON.stringify(body.youtubeWebChat)).not.toContain(seller.sellerId)
  })
})

describe('D-UX4-187 최근 연결한 채널 5곳', () => {
  // 사용자 2026-11-16 "최근 연결한 채널 라이브 보여주는거 젤 최근 1개만 보여주는걸로 되어있는걸로 보이는데, 최근 5군데 채널 다 보여주도록 해. 맨위가 젤 최근으로."
  it('최근 이은 채널 5곳을 최근 것부터 알린다 — 라이브가 없는 채널도 videoId null로, 여섯째 채널은 찾지 않는다', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const videos = []
    for (let i = 0; i < 6; i++) {
      const linked = await webLinked(w, { seller, video: w.web.addVideo({ channelTitle: `채널${String(i + 1)}` }), date: `2026-10-${String(10 + i)}` })
      videos.push(linked.video)
      await pass(w, 60_000, 60_000)
    }
    // 채널2·채널4는 지금 라이브가 없다
    videos[1]!.state = 'ended'
    videos[3]!.state = 'ended'
    const before = w.web.calls('channelLive')
    const found = await client(w, seller.cookie).get('/api/youtube/live-broadcasts')
    expect(found.status).toBe(200)
    const channels = found.body.channels as { channelId: string; channelTitle: string | null; videoId: string | null }[]
    expect(channels.map((row) => row.channelTitle)).toEqual(['채널6', '채널5', '채널4', '채널3', '채널2'])
    expect(channels.map((row) => row.videoId)).toEqual([videos[5]!.videoId, videos[4]!.videoId, null, videos[2]!.videoId, null])
    // 라이브 줄(broadcasts)은 옛 모양 그대로 — 라이브인 채널만
    expect((found.body.broadcasts as { videoId: string }[]).map((row) => row.videoId)).toEqual([videos[5]!.videoId, videos[4]!.videoId, videos[2]!.videoId])
    // 채널마다 한 번씩만 (여섯째는 부르지 않는다)
    expect(w.web.calls('channelLive') - before).toBe(5)
  })
})

describe('D-RECENT-YT-02 끊은 뒤 다시 잇는 라이브', () => {
  // 판매자 2026-11-23 "라이브 연결 했다가 끊고 나서 다시 라이브 링크 넣는 화면 오면 해당 라이브가 진행 중인데도 최근 연결한 채널에 지금 라이브가 없다고 뜬다"
  it('채널 라이브 주소가 봇 확인으로 막혀도(또는 일부 공개라 안 보여도) 방금 끊은 라이브가 지금 라이브면 최근 채널에 보인다', async () => {
    const w = await world()
    const { seller, b, video } = await webLinked(w)
    const api = client(w, seller.cookie)
    expect((await api.post(`/api/broadcasts/${b.id}/youtube/unlink`, {})).status).toBe(200)
    w.web.fail('channelLive', { kind: 'bot' })
    const found = await api.get('/api/youtube/live-broadcasts')
    expect(found.status).toBe(200)
    expect((found.body.channels as { videoId: string | null }[]).map((row) => row.videoId)).toEqual([video.videoId])
    expect((found.body.broadcasts as { videoId: string; status: string; linkedBroadcast: string | null }[]).map((row) => [row.videoId, row.status, row.linkedBroadcast])).toEqual([[video.videoId, 'LIVE', null]])
    // 429로 막혀도 같다
    w.web.fail('channelLive', { status: 429 })
    expect(((await api.get('/api/youtube/live-broadcasts')).body.channels as { videoId: string | null }[]).map((row) => row.videoId)).toEqual([video.videoId])
  })

  it('그 영상이 끝났거나, 이은 지 하루가 지났으면 다시 보지 않고 "라이브 아님" 그대로', async () => {
    const w = await world()
    const { seller, video } = await webLinked(w)
    const api = client(w, seller.cookie)
    video.state = 'ended'
    w.web.fail('channelLive', { kind: 'bot' })
    expect(((await api.get('/api/youtube/live-broadcasts')).body.channels as { videoId: string | null }[]).map((row) => row.videoId)).toEqual([null])
    video.state = 'live'
    await pass(w, RECENT_VIDEO_RECHECK_MS + 60_000, 60 * 60_000)
    w.web.fail('channelLive', { kind: 'bot' })
    const watch = w.web.calls('watch')
    expect(((await api.get('/api/youtube/live-broadcasts')).body.channels as { videoId: string | null }[]).map((row) => row.videoId)).toEqual([null])
    expect(w.web.calls('watch')).toBe(watch)
  })
})

describe('D-YT-MOVE-01 다른 방송에 이어진 유튜브 라이브 옮기기', () => {
  // 사용자 2026-11-23 "왜 이미 다른 방송에 이어진 유튜브 방송이라고 뜨지?" — 끝나지 않은 다른 회차에 같은 영상이 이어져 있으면 VIDEO_IN_USE, [옮기기]면 그 회차를 끊고 잇는다
  it('move 없이는 VIDEO_IN_USE 그대로, move: true면 앞 회차 연결을 끊고 이 회차에 잇는다 — 그 밖의 값은 거절', async () => {
    const w = await world()
    const { seller, b, video } = await webLinked(w)
    const api = client(w, seller.cookie)
    const b2 = await createBroadcast(w, seller, { date: '2026-10-22' })
    const refused = await api.post(`/api/broadcasts/${b2.id}/youtube`, { requestId: 'move-1', video: video.videoId })
    expect([refused.status, errorOf(refused.body).code, errorOf(refused.body).message]).toEqual([409, 'VIDEO_IN_USE', '이미 다른 방송에 이어진 유튜브 방송이에요.'])
    expect((await api.get(`/api/broadcasts/${b.id}/youtube`)).body.link).not.toBeNull()
    expect((await api.post(`/api/broadcasts/${b2.id}/youtube`, { requestId: 'move-2', video: video.videoId, move: 'yes' })).status).toBe(400)
    const moved = await api.post(`/api/broadcasts/${b2.id}/youtube`, { requestId: 'move-3', video: video.videoId, move: true })
    expect(moved.status).toBe(200)
    expect(moved.body).toMatchObject({ link: { videoId: video.videoId } })
    expect((await api.get(`/api/broadcasts/${b.id}/youtube`)).body.link).toBeNull()
    expect(w.logs.some((record) => record.code === 'YT_LINK_MOVED')).toBe(true)
  })
})

describe('D-DRAFT-01 만들다 그만둔 회차', () => {
  // 2026-11-23: 새 라이브 만들기에서 링크까지 이은 뒤 그만둔 회차(방송 화면에 들어온 적 없음)가 목록에 안 보인 채 연결을 붙잡아
  // 배포 문지기가 "방송 중"으로 보고 배포를 막았고, 같은 라이브를 다른 회차에 이으면 VIDEO_IN_USE였다
  it('그만둔 회차는 "지금 볼 라이브"에 들지 않고, 같은 영상을 다른 회차에 이으면 묻지 않고 그 회차를 놓아준다 — 열린 회차는 그대로 VIDEO_IN_USE', async () => {
    const w = await world({ overrides: { screenWorkerToken: SCREEN_TOKEN } })
    const seller = await addSeller(w)
    const api = client(w, seller.cookie)
    const video = w.web.addVideo()
    const draft = await api.post('/api/broadcasts', { requestId: 'draft-1', date: '2026-10-22', title: '만들다 그만둔', draft: true })
    expect(draft.status).toBe(200)
    const draftId = (draft.body.broadcast as { id: string }).id
    expect((await api.post(`/api/broadcasts/${draftId}/youtube`, { requestId: 'draft-l1', video: video.videoId, confirmInvited: true })).status).toBe(200)
    const live = async () => (await (await w.server.app.request('/internal/screen/live', { headers: { Authorization: `Bearer ${SCREEN_TOKEN}` } })).json()) as { videos: { videoId: string }[] }
    expect((await live()).videos).toEqual([])
    const b2 = await createBroadcast(w, seller, { date: '2026-10-22' })
    const linked = await api.post(`/api/broadcasts/${b2.id}/youtube`, { requestId: 'draft-l2', video: video.videoId, confirmInvited: true })
    expect(linked.status).toBe(200)
    expect((await api.get(`/api/broadcasts/${draftId}/youtube`)).body.link).toBeNull()
    expect((await live()).videos.map((row) => row.videoId)).toEqual([video.videoId])
    // 열린 회차가 붙잡고 있으면 묻는다(옮기기는 판매자가 누를 때만)
    const b3 = await createBroadcast(w, seller, { date: '2026-10-22' })
    expect(errorOf((await api.post(`/api/broadcasts/${b3.id}/youtube`, { requestId: 'draft-l3', video: video.videoId, confirmInvited: true })).body).code).toBe('VIDEO_IN_USE')
  })
})

describe('D-YT-SRV-20 한 방송은 유튜브에서 한 번만 읽는다', () => {
  it('두 판매자 계정이 같은 영상을 이으면 채팅 요청은 한 수집기 만큼만 가고, 두 계정 모두 같은 채팅을 각자 기록한다', async () => {
    const w = await world()
    const first = await webLinked(w)
    const second = await webLinked(w, { video: first.video })
    w.web.timeoutMs = 1000
    w.server.youtube?.collectors.start()
    await waitFor(w, async () => (await collector(w, first.seller.cookie, first.b.id)).status === 'LIVE' && (await collector(w, second.seller.cookie, second.b.id)).status === 'LIVE')
    await pass(w, 5000)
    const from = w.web.calls('poll')
    for (let i = 0; i < 5; i++) w.web.addMessage(first.video.videoId, { id: `s${String(i)}`, author: 'UCa', name: '가', text: String(10 + i), publishedAt: w.timer.now() + i })
    await pass(w, 20_000)
    const polls = w.web.calls('poll') - from
    // 1초마다 부르는 수집기 하나면 20번 남짓 — 따로 읽으면 40번 남짓
    expect(polls).toBeGreaterThan(10)
    expect(polls).toBeLessThanOrEqual(26)
    await waitFor(w, async () => (await collector(w, first.seller.cookie, first.b.id)).recorded === 5 && (await collector(w, second.seller.cookie, second.b.id)).recorded === 5)
    expect(w.web.maxInflightPolls).toBe(1)
  })

  it('계정이 하나면 지금과 같다 — 같은 지점을 다시 부르면 유튜브에 새로 묻는다', async () => {
    const w = await world()
    const { seller, b, video } = await webLinked(w)
    w.web.timeoutMs = 1000
    w.server.youtube?.collectors.start()
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).status === 'LIVE')
    w.web.fail('poll', { status: 500 })
    w.web.addMessage(video.videoId, { id: 'one', author: 'UCa', name: '가', text: '7' })
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).recorded === 1, { step: 500 })
    expect(w.web.pendingFaults('poll')).toBe(0)
  })
})

