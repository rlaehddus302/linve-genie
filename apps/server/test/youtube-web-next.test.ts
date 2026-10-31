// D-YT-SRV-19 방송 페이지가 막히면 next로 대신 확인 — 데이터센터 IP(AWS ap-northeast-2, 2026-11-01 측정)에서 방송 페이지·player는 봇 확인으로 막히고
// 채팅 페이지·get_live_chat·next는 된다. 로그인·우회 없음.
// 녹화본(test/fixtures/youtube-web/next-*.json): 2026-11-01 맥 미니(집 인터넷)에서 공개 영상 넷(Lofi Girl 진행 중 라이브·끝난 라이브, 일반 영상, 없는 영상 ID)에
// 실제로 부른 next 응답에서 읽는 경로만 남기고 나머지(시청자 댓글·이름·추천 영상·추적 값)를 지웠다. 채팅 지점은 CONT-N으로 바꿨다.
// 예정 라이브는 그날 찾지 못해 진행 중 녹화본을 본뜬 모양으로 시험한다.
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { FAKE_WEB_CLIENT_VERSION } from '../src/youtube/fake-youtube-web.ts'
import { ManualTimer } from '../src/youtube/timer.ts'
import { parseInnertubeConfig, parseNextResponse } from '../src/youtube/web-chat.ts'
import { NEXT_FALLBACK_CLIENT, WebChatSource, type WebRequest, type WebResponse } from '../src/youtube/web-chat-source.ts'
import { addSeller, client, createBroadcast, T0 } from './support.ts'
import { chatEvents, collectorOfWorld, errorOf, pass, waitFor, webLinked, webWorld, type WebWorld } from './youtube-web-support.ts'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/youtube-web/${name}`, import.meta.url), 'utf8')
const json = (name: string) => JSON.parse(fixture(name)) as Record<string, unknown>
const LOFI = 'UCSJ4gkVC6NrvII8umztf0Ow'

/** 녹화본의 주 정보 칸을 바꾼 본뜬 응답 */
function withPrimary(base: Record<string, unknown>, change: (primary: Record<string, unknown>) => void, two?: (value: Record<string, unknown>) => void): Record<string, unknown> {
  const copy = structuredClone(base)
  const twoColumn = (copy.contents as Record<string, Record<string, unknown>>).twoColumnWatchNextResults as Record<string, unknown>
  const items = ((twoColumn.results as Record<string, Record<string, unknown>>).results as Record<string, unknown>).contents as Record<string, unknown>[]
  change(items.find((item) => 'videoPrimaryInfoRenderer' in item)?.videoPrimaryInfoRenderer as Record<string, unknown>)
  two?.(twoColumn)
  return copy
}

describe('parseNextResponse (실제 응답 녹화본)', () => {
  it('진행 중 라이브 → LIVE: 영상 ID·방송 채널·제목, 시작 시각은 날짜까지라 null', () => {
    expect(parseNextResponse(json('next-live.json'))).toEqual({ state: 'LIVE', videoId: '0sfDth4lMLc', channelId: LOFI, channelTitle: 'Lofi Girl', title: '24/7 halloween ambience 🎃 spooky lofi to get chills to', startedAt: null })
  })

  it('끝난 라이브 → ENDED, 일반 영상 → NOT_LIVE, 없는 영상 → NOT_FOUND', () => {
    expect(parseNextResponse(json('next-ended.json'))).toMatchObject({ state: 'ENDED', videoId: '5qap5aO4i9A', channelId: LOFI, startedAt: null })
    expect(parseNextResponse(json('next-video.json'))).toMatchObject({ state: 'NOT_LIVE', videoId: 'dQw4w9WgXcQ', channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw', startedAt: null })
    expect(parseNextResponse(json('next-notfound.json'))).toEqual({ state: 'NOT_FOUND', videoId: null, channelId: null, channelTitle: null, title: null, startedAt: null })
  })

  it('본뜬 모양: 예정(Scheduled for)·채팅 꺼짐·다시 보기 칸', () => {
    const live = json('next-live.json')
    const upcoming = withPrimary(live, (primary) => {
      primary.viewCount = { videoViewCountRenderer: { viewCount: { simpleText: '3 waiting' }, originalViewCount: '0' } }
      primary.dateText = { simpleText: 'Scheduled for Nov 2, 2026' }
    })
    expect(parseNextResponse(upcoming)).toMatchObject({ state: 'UPCOMING', channelId: LOFI, startedAt: null })
    expect(parseNextResponse(withPrimary(live, () => {}, (two) => delete two.conversationBar)).state).toBe('CHAT_DISABLED')
    expect(parseNextResponse(withPrimary(live, () => {}, (two) => ((two.conversationBar as Record<string, Record<string, unknown>>).liveChatRenderer as Record<string, unknown>).isReplay = true)).state).toBe('ENDED')
  })

  it('모르는 모양: 진행 중 표시 없이 진행 중 날짜 글, 채팅 칸은 있는데 라이브 표시 없음, 채널·영상 ID 없음, 날짜 글 없음, 객체 아님 — 봇 확인 알림은 막힘', () => {
    const live = json('next-live.json')
    const noLiveFlag = withPrimary(live, (primary) => {
      primary.viewCount = { videoViewCountRenderer: { viewCount: { simpleText: '1 view' } } }
    })
    expect(parseNextResponse(noLiveFlag).state).toBe('UNKNOWN_SHAPE')
    expect(parseNextResponse(withPrimary(noLiveFlag, (primary) => (primary.dateText = { simpleText: 'Oct 20, 2026' }))).state).toBe('UNKNOWN_SHAPE')
    expect(parseNextResponse(withPrimary(json('next-video.json'), (primary) => delete primary.dateText)).state).toBe('UNKNOWN_SHAPE')
    const noOwner = structuredClone(live) as { contents: { twoColumnWatchNextResults: { results: { results: { contents: Record<string, unknown>[] } } } } }
    noOwner.contents.twoColumnWatchNextResults.results.results.contents.splice(1, 1)
    expect(parseNextResponse(noOwner).state).toBe('UNKNOWN_SHAPE')
    const noVideo = structuredClone(live)
    delete noVideo.currentVideoEndpoint
    expect(parseNextResponse(noVideo).state).toBe('UNKNOWN_SHAPE')
    expect(parseNextResponse([]).state).toBe('UNKNOWN_SHAPE')
    expect(parseNextResponse({ responseContext: {} }).state).toBe('UNKNOWN_SHAPE')
    expect(parseNextResponse({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you’re not a bot' } }).state).toBe('BLOCKED')
  })

  it('ytcfg 호출 정보: 채팅 페이지 녹화본과 같은 값', () => {
    expect(parseInnertubeConfig(fixture('chat-page.html'))).toEqual({ apiKey: 'fake-key', clientName: 'WEB', clientVersion: '2.20261029.01.00', visitorData: 'fake-visitor' })
    expect(parseInnertubeConfig('<html></html>')).toBeNull()
  })
})

describe('WebChatSource.pageOrNext (요청 흉내)', () => {
  const blockedWatch = (cfg: string) => `<html>${cfg}<script>var ytInitialPlayerResponse = {"playabilityStatus":{"status":"LOGIN_REQUIRED","reason":"Sign in to confirm you’re not a bot"}};</script></html>`
  const CFG = '<script>ytcfg.set({"INNERTUBE_API_KEY":"watch-key","INNERTUBE_CLIENT_NAME":"WEB","INNERTUBE_CLIENT_VERSION":"2.20261101.00.00","VISITOR_DATA":"watch-visitor"});</script>'
  function source(answer: (request: WebRequest) => WebResponse) {
    const requests: WebRequest[] = []
    const web = new WebChatSource({ timer: new ManualTimer(T0), transport: { request: (request) => (requests.push(request), Promise.resolve(answer(request))) } })
    return { web, requests }
  }
  const ok = (text: string): WebResponse => ({ status: 200, url: 'https://www.youtube.com/x', text })
  const bodyOf = (request: WebRequest | undefined) => JSON.parse(request?.body ?? '{}') as { context: { client: Record<string, unknown> }; videoId: string }

  it('막힌 방송 페이지의 ytcfg로 next를 부른다 (채팅 페이지를 따로 부르지 않음), 막히지 않았으면 next를 부르지 않는다', async () => {
    const { web, requests } = source((request) => (request.path.startsWith('/watch') ? ok(blockedWatch(CFG)) : ok(fixture('next-live.json'))))
    expect(await web.pageOrNext('0sfDth4lMLc')).toMatchObject({ state: 'LIVE', channelId: LOFI, startedAt: null })
    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual(['GET /watch?v=0sfDth4lMLc&hl=en', 'POST /youtubei/v1/next?prettyPrint=false&key=watch-key'])
    expect(bodyOf(requests[1])).toEqual({ context: { client: { clientName: 'WEB', clientVersion: '2.20261101.00.00', hl: 'en', visitorData: 'watch-visitor' } }, videoId: '0sfDth4lMLc' })
    const plain = source(() => ok('<html><script>var ytInitialPlayerResponse = {"playabilityStatus":{"status":"ERROR"}};</script></html>'))
    expect((await plain.web.pageOrNext('0sfDth4lMLc')).state).toBe('NOT_FOUND')
    expect(plain.requests).toHaveLength(1)
  })

  it('넘겨받은 호출 정보가 먼저, ytcfg가 하나도 없으면 채팅 페이지 → 그것도 없으면 기본값', async () => {
    const known = { apiKey: null, clientName: 'WEB', clientVersion: '2.known', visitorData: null }
    const a = source((request) => (request.path.startsWith('/watch') ? ok(blockedWatch(CFG)) : ok(fixture('next-live.json'))))
    await a.web.pageOrNext('0sfDth4lMLc', undefined, known)
    expect(bodyOf(a.requests[1]).context.client).toEqual({ clientName: 'WEB', clientVersion: '2.known', hl: 'en' })
    const b = source((request) => (request.path.startsWith('/watch') ? ok(blockedWatch('')) : request.path.startsWith('/live_chat') ? ok(fixture('chat-page.html')) : ok(fixture('next-live.json'))))
    await b.web.pageOrNext('0sfDth4lMLc')
    expect(b.requests.map((request) => request.path.split('?')[0])).toEqual(['/watch', '/live_chat', '/youtubei/v1/next'])
    expect(bodyOf(b.requests[2]).context.client).toMatchObject({ clientVersion: '2.20261029.01.00', visitorData: 'fake-visitor' })
    const c = source((request) => (request.path.startsWith('/watch') ? ok(blockedWatch('')) : request.path.startsWith('/live_chat') ? { status: 429, url: 'https://www.youtube.com/x', text: '' } : ok(fixture('next-live.json'))))
    expect((await c.web.pageOrNext('0sfDth4lMLc')).state).toBe('LIVE')
    expect(bodyOf(c.requests[2]).context.client).toEqual({ clientName: NEXT_FALLBACK_CLIENT.clientName, clientVersion: NEXT_FALLBACK_CLIENT.clientVersion, hl: 'en' })
  })

  it('next도 막힘(봇 화면·429)·HTTP 오류면 방송 페이지의 BLOCKED 그대로, 모르는 모양·다른 영상 ID면 UNKNOWN_SHAPE', async () => {
    const watchOr = (next: WebResponse) => (request: WebRequest) => (request.path.startsWith('/watch') ? ok(blockedWatch(CFG)) : next)
    expect((await source(watchOr(ok('<html>Sign in to confirm you’re not a bot</html>'))).web.pageOrNext('0sfDth4lMLc')).state).toBe('BLOCKED')
    expect((await source(watchOr({ status: 429, url: 'https://www.youtube.com/x', text: '' })).web.pageOrNext('0sfDth4lMLc')).state).toBe('BLOCKED')
    expect((await source(watchOr({ status: 500, url: 'https://www.youtube.com/x', text: '' })).web.pageOrNext('0sfDth4lMLc')).state).toBe('BLOCKED')
    expect((await source(watchOr(ok('<html>new layout</html>'))).web.pageOrNext('0sfDth4lMLc')).state).toBe('UNKNOWN_SHAPE')
    expect((await source(watchOr(ok('{"responseContext":{}}'))).web.pageOrNext('0sfDth4lMLc')).state).toBe('UNKNOWN_SHAPE')
    expect((await source(watchOr(ok(fixture('next-live.json')))).web.pageOrNext('otherVideo1')).state).toBe('UNKNOWN_SHAPE')
  })
})

describe('가짜 유튜브 웹 "방송 페이지만 막힘" 모드 — 잇기·수집·끝 확인·예정 시작', () => {
  const worlds: WebWorld[] = []
  async function world(): Promise<WebWorld> {
    const created = await webWorld()
    created.web.watchBlocked = true
    worlds.push(created)
    return created
  }
  afterEach(async () => {
    for (const item of worlds.splice(0)) {
      item.server.close()
      await item.server.stop()
      await item.web.close()
    }
  })
  const blockedAlerts = (w: WebWorld) => w.logs.filter((log) => log.code === 'YT_CHAT_BLOCKED')

  it('진행 중 방송: next로 확인해 잇고(잇는 시각 기준으로 잇기 전 글 거름), 받고, 끝나면 next로 확인해 채팅 끝남 — 막힘 경보 없음', async () => {
    const w = await world()
    const video = w.web.addVideo({ channelTitle: '구피네', startedAt: w.timer.now() - 3_600_000 })
    w.web.addMessage(video.videoId, { id: 'before', author: 'UCold', name: '먼저', text: '1', publishedAt: w.timer.now() - 60_000 })
    const { seller, b } = await webLinked(w, { video })
    const link = (await client(w, seller.cookie).get(`/api/broadcasts/${b.id}/youtube`)).body.link as Record<string, unknown>
    expect(link).toMatchObject({ videoId: video.videoId, broadcastChannelId: video.channelId, broadcastChannelTitle: '구피네' })
    // next에 시작 시각이 없어 잇는 시각을 시작으로 (방송 페이지의 실제 시작 1시간 전이 아니라)
    const started = await w.database.pglite?.query<{ started_at: Date | string }>(`select started_at from youtube_links where video_id = $1`, [video.videoId])
    expect(new Date(started?.rows[0]?.started_at ?? Number.NaN).getTime()).toBe(Date.parse(String(link.linkedAt)))
    expect(w.web.calls('next')).toBeGreaterThanOrEqual(1)
    // 막힌 방송 페이지의 ytcfg 값(페이지가 알려 준 값)으로 불렀다
    expect(w.web.nextClients[0]).toMatchObject({ clientName: 'WEB', clientVersion: FAKE_WEB_CLIENT_VERSION, hl: 'en' })
    w.server.youtube?.collectors.start()
    w.web.addMessage(video.videoId, { id: 'm1', author: 'UCa', name: '가', text: '15', publishedAt: w.timer.now() + 1000 })
    await waitFor(w, async () => (await collectorOfWorld(w, seller.cookie, b.id)).recorded === 1)
    expect(await collectorOfWorld(w, seller.cookie, b.id)).toMatchObject({ mode: 'WEB', status: 'LIVE', skippedBeforeLink: 1 })
    expect((await chatEvents(w)).map((event) => event.id)).toEqual(['m1'])
    const nextBefore = w.web.calls('next')
    video.state = 'ended'
    await waitFor(w, async () => (await collectorOfWorld(w, seller.cookie, b.id)).status === 'CHAT_ENDED', { step: 500 })
    expect(w.web.calls('next')).toBeGreaterThan(nextBefore)
    expect(blockedAlerts(w)).toEqual([])
  })

  it('예정 방송: 30초마다 next로 상태만 보고, 시작을 보면 그 뒤 글부터 받는다', async () => {
    const w = await world()
    const video = w.web.addVideo({ state: 'upcoming', startedAt: w.timer.now() + 3_600_000 })
    const { seller, b } = await webLinked(w, { video })
    expect(await collectorOfWorld(w, seller.cookie, b.id)).toMatchObject({ status: 'STARTING', reason: 'NOT_STARTED' })
    w.server.youtube?.collectors.start()
    w.web.addMessage(video.videoId, { id: 'pre', author: 'UCa', name: '가', text: '미리' })
    const nextBefore = w.web.calls('next')
    await pass(w, 95_000, 1000)
    expect(w.web.calls('poll')).toBe(0)
    expect(w.web.calls('next') - nextBefore).toBe(3)
    video.state = 'live'
    video.startedAt = w.timer.now()
    await waitFor(w, () => w.web.calls('poll') > 0, { step: 1000 })
    w.web.addMessage(video.videoId, { id: 'post', author: 'UCa', name: '가', text: '15', publishedAt: w.timer.now() + 1 })
    await waitFor(w, async () => (await collectorOfWorld(w, seller.cookie, b.id)).recorded === 1, { step: 1000 })
    expect((await chatEvents(w)).map((event) => event.id)).toEqual(['post'])
    expect(blockedAlerts(w)).toEqual([])
  })

  it('거절은 next 상태로: 끝남·라이브 아님·없음은 채팅 없음, next도 막히면 지금처럼 막힘, next 모양이 바뀌면 모르는 모양 경보', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const api = client(w, seller.cookie)
    const bc = await createBroadcast(w, seller)
    const tryLink = async (videoId: string) => {
      const response = await api.post(`/api/broadcasts/${bc.id}/youtube`, { requestId: `r-${videoId}-${String(Math.random()).slice(2, 8)}`, video: videoId, confirmInvited: true })
      return [response.status, errorOf(response.body).code]
    }
    for (const state of ['ended', 'vod', 'missing'] as const) expect(await tryLink(w.web.addVideo({ state }).videoId)).toEqual([409, 'NO_LIVE_CHAT'])
    w.web.fail('next', { kind: 'bot' })
    expect(await tryLink(w.web.addVideo().videoId)).toEqual([502, 'YOUTUBE_UNAVAILABLE'])
    expect(w.logs.filter((log) => log.level !== 'alert' && log.code === 'YT_CHAT_BLOCKED')).toHaveLength(1)
    w.web.fail('next', { kind: 'shape' })
    expect(await tryLink(w.web.addVideo().videoId)).toEqual([502, 'YOUTUBE_UNAVAILABLE'])
    expect(w.logs.filter((log) => log.level !== 'alert' && log.code === 'YT_CHAT_FORMAT')).toHaveLength(1)
    expect((await api.get(`/api/broadcasts/${bc.id}/youtube`)).body).toEqual({ link: null, collector: null })
  })
})
