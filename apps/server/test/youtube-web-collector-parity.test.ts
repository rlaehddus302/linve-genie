// YT-11 서버 웹 읽기에서 옛 공식 읽기 수집 시험(youtube-collector·youtube-followup AC-Y1-94·inv1·multi-platform·security·i3-ops·quota·fake)이
// 지키던 뜻을 같은 강도로 (CH-26). 가짜 유튜브 웹 서버(127.0.0.1)에 실제 통신 방식(HTML·JSON POST)으로 붙는다.
// 숫자는 YT-11 AC3(timeoutMs 1~10초·실패 5·10·20·30초·막힘 30·60·120·300초·예정 30초)와 YT-03(끝낸 뒤 10분·잇기 전 거르기)를 따른다.
// 많은 채팅·죽였다 살리기는 youtube-web-collector-load.test.ts.
import { getProduct, listClaims, listProducts } from '@livejjim/core'
import { afterEach, describe, expect, it } from 'vitest'
import { formatLog } from '../src/log.ts'
import { collectorCandidates } from '../src/youtube/store.ts'
import { HttpWebTransport, WebChatSource } from '../src/youtube/web-chat-source.ts'
import { FakeYoutubeWeb } from '../src/youtube/fake-youtube-web.ts'
import { ManualTimer } from '../src/youtube/timer.ts'
import { addSeller, client, createBroadcast, expectOk, writeEvent, type Seller } from './support.ts'
import { approve, callback, drive, enableConsent, type YoutubeWorld } from './youtube-support.ts'
import { collectorOfWorld, pass, waitFor, webLinked, webWorld, type WebWorld } from './youtube-web-support.ts'

const worlds: WebWorld[] = []
async function world(options: Parameters<typeof webWorld>[0] = {}): Promise<WebWorld> {
  const created = await webWorld(options)
  worlds.push(created)
  return created
}
const fakes: FakeYoutubeWeb[] = []
afterEach(async () => {
  const closing = worlds.splice(0)
  for (const item of closing) {
    item.server.close()
    await item.server.stop()
  }
  for (const item of new Set([...closing.map((w) => w.web), ...fakes.splice(0)])) await item.close()
  for (const item of closing) await item.google?.close()
})

const collector = (w: WebWorld, cookie: string, b: string) => collectorOfWorld(w, cookie, b)
const youtubeOf = (w: WebWorld) => {
  const youtube = w.server.youtube
  if (youtube === null) throw new Error('유튜브가 없다')
  return youtube
}

async function chatIds(w: WebWorld): Promise<string[]> {
  const rows = await w.database.pglite?.query<{ id: string }>(`select chat_message_id as id from events where type = 'chat' order by seq`)
  return (rows?.rows ?? []).map((row) => row.id)
}

const gapsOf = (times: readonly number[]) => times.slice(1).map((at, i) => at - (times[i] as number))
/** 간격이 기대값 이상, 기대값 + slack 미만 (시계를 조금씩 옮기는 동안 실제 HTTP가 돌아 한두 걸음 늦을 수 있다 — 더 일찍 부르는 일은 없어야 한다) */
const expectGaps = (gaps: readonly number[], expected: readonly number[], slack: number) => {
  expect(gaps.length, `간격 ${JSON.stringify(gaps)}`).toBeGreaterThanOrEqual(expected.length)
  expected.forEach((value, i) => {
    expect(gaps[i], `${String(i)}번째 간격 ${JSON.stringify(gaps)}`).toBeGreaterThanOrEqual(value)
    expect(gaps[i], `${String(i)}번째 간격 ${JSON.stringify(gaps)}`).toBeLessThan(value + slack)
  })
}

/** 그 판매자에게 보낸 유튜브 알림(SSE)을 모은다 */
function watchYoutube(w: WebWorld): Record<string, unknown>[] {
  const seen: Record<string, unknown>[] = []
  const hub = w.server.hub
  const original = hub.publishYoutube.bind(hub)
  hub.publishYoutube = (sellerId: string, data: Readonly<Record<string, unknown>>) => {
    seen.push({ ...data })
    original(sellerId, data)
  }
  return seen
}

/** 구글 연결 (감사 게시용 — 선택). 연결한 채널 ID */
async function connectGoogle(w: WebWorld, seller: Seller, options: { consent?: boolean } = {}): Promise<string> {
  const google = w.google
  if (google === null) throw new Error('가짜 구글 없음')
  const account = google.addAccount()
  const channel = google.addChannel(account, '구피 가게')
  google.approval = { account, channel: channel.id }
  const yw = { ...w, fake: google } as unknown as YoutubeWorld
  const started = await client(w, seller.cookie).post('/api/youtube/connection/start', {})
  expect(started.status, JSON.stringify(started.body)).toBe(200)
  expect(await callback(yw, seller.cookie, await approve(started.body.authorizeUrl as string))).toBe('connected')
  if (options.consent === true) await enableConsent(yw, seller, 'LIVE_CHAT')
  return channel.id
}

describe('AC-Y1-21 메시지 → chat (웹 읽기)', () => {
  // 메시지 종류·이름 정리·주인 배지·게시 시각은 youtube-web-collector.test.ts "메시지 종류·이름 정리·주인 배지·잇기 전 거르기…"
  it('같은 메시지 ID가 다시 와도(다음 응답·지점 거절 뒤 다시 불러온 최근 동작) 한 번만. 기록은 조치자 collector·받은 경로 youtube·원문 따로', async () => {
    const w = await world()
    const { seller, b, video } = await webLinked(w)
    w.web.timeoutMs = 1000
    youtubeOf(w).collectors.start()
    const at = w.timer.now() + 1000
    w.web.addMessage(video.videoId, { id: 'd1', author: 'UCa', name: '가', text: '15', publishedAt: at })
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).recorded === 1)
    w.web.addMessage(video.videoId, { id: 'd1', author: 'UCa', name: '가', text: '15', publishedAt: at })
    w.web.addMessage(video.videoId, { id: 'd2', author: 'UCb', name: '나', text: '16', publishedAt: at })
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).recorded === 2)
    // 지점 거절 → 새 전체 채팅 지점(최근 동작부터 — d1·d1·d2가 다시 온다)
    w.web.fail('poll', { status: 400 })
    w.web.addMessage(video.videoId, { id: 'd3', author: 'UCc', name: '다', text: '17', publishedAt: w.timer.now() + 1 })
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).recorded === 3)
    await pass(w, 5000)
    expect(await chatIds(w)).toEqual(['d1', 'd2', 'd3'])
    expect(await collector(w, seller.cookie, b.id)).toMatchObject({ recorded: 3, gap: true })
    expect(w.web.pendingFaults('poll')).toBe(0)
    const rows = await w.database.pglite?.query<{ actor: string; chat_source: string; raw: boolean }>(`select actor, chat_source, raw from events where type = 'chat'`)
    expect(rows?.rows).toHaveLength(3)
    expect(rows?.rows.every((row) => row.actor === 'collector' && row.chat_source === 'youtube' && row.raw)).toBe(true)
  })
})

describe('AC-Y1-20 대체 경로 → 웹 읽기의 같은 뜻', () => {
  // 옛 "streamList 404면 폴링으로·pollingIntervalMillis보다 자주 부르지 않는다" → 웹에는 대체 방식이 없다. 같은 뜻(부르는 간격 하한·응답 없을 때 다시)은
  // youtube-web-collector.test.ts "다음 부름 = 앞 응답을 받은 뒤 timeoutMs…"와 아래 시험
  it('응답 없음(멈춘 연결)은 15초에 실패로 끊고 5초 뒤 다시 — 그동안 다른 채팅 요청 없음(한 번에 하나), 받은 뒤 채팅은 빠짐 없이', async () => {
    const w = await world()
    const { seller, b, video } = await webLinked(w)
    w.web.timeoutMs = 1000
    youtubeOf(w).collectors.start()
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).status === 'LIVE')
    w.web.fail('poll', { kind: 'hang' })
    w.web.addMessage(video.videoId, { id: 'h1', author: 'UCa', name: '가', text: '안녕' })
    const from = w.web.calls('poll')
    await pass(w, 30_000, 250)
    const times = w.web.callTimes('poll').slice(from)
    // 멈춘 요청 → 15초 → 실패(다시 연결하는 중) → 5초 → 다시
    expectGaps(gapsOf(times), [15_000 + 5000], 1500)
    expect(w.web.maxInflightPolls).toBe(1)
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).recorded === 1)
    expect(await chatIds(w)).toEqual(['h1'])
    expect(await collector(w, seller.cookie, b.id)).toMatchObject({ status: 'LIVE', reason: null, gap: false })
  })
})

describe('AC-I3-24 조용한 채팅 — 응답을 받으면 채팅을 받는 중 (웹 읽기)', () => {
  it('채팅이 하나도 없는 라이브: 빈 응답이어도 LIVE("채팅을 받는 중") + collector 알림, 받은 채팅 0개. 연결이 끊겨 다시 연결하는 중 → 다시 받으면(여전히 조용) LIVE', async () => {
    const w = await world()
    const { seller, b, video } = await webLinked(w)
    w.web.timeoutMs = 1000
    const seen = watchYoutube(w)
    youtubeOf(w).collectors.start()
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).status === 'LIVE')
    expect(await collector(w, seller.cookie, b.id)).toMatchObject({ status: 'LIVE', statusMessage: '채팅을 받는 중', reason: null, recorded: 0, lastMessageAt: null, mode: 'WEB' })
    expect(seen.filter((data) => data.kind === 'collector').at(-1)).toMatchObject({ broadcast: b.id, collector: { status: 'LIVE', statusMessage: '채팅을 받는 중', recorded: 0 } })
    // 연결이 끊긴다 (3번) → 다시 연결하는 중 → 다시 받으면 채팅을 받는 중
    w.web.fail('poll', { kind: 'reset' }, 3)
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).status === 'RETRYING', { step: 200 })
    expect(await collector(w, seller.cookie, b.id)).toMatchObject({ status: 'RETRYING', statusMessage: '다시 연결하는 중', reason: null })
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).status === 'LIVE', { step: 1000, max: 80 })
    expect(seen.filter((data) => data.kind === 'collector').map((data) => (data.collector as { status: string }).status).slice(-2)).toEqual(['RETRYING', 'LIVE'])
    expect(await collector(w, seller.cookie, b.id)).toMatchObject({ status: 'LIVE', recorded: 0 })
    // 시청자 채팅이 오면 받은 수가 는다
    w.web.addMessage(video.videoId, { author: 'UCa', name: '가', text: '안녕하세요', publishedAt: w.timer.now() + 1 })
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).recorded === 1, { step: 250 })
    expect(await collector(w, seller.cookie, b.id)).toMatchObject({ status: 'LIVE', recorded: 1 })
    await youtubeOf(w).collectors.stop()
  })

  it('예정 방송이 시작되면(시작 뒤 채팅이 아직 없어도) 그 확인 바퀴에서 채팅을 불러 LIVE', async () => {
    const w = await world()
    const video = w.web.addVideo({ state: 'upcoming', startedAt: w.timer.now() + 3_600_000 })
    const { seller, b } = await webLinked(w, { video })
    youtubeOf(w).collectors.start()
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).reason === 'NOT_STARTED')
    video.state = 'live'
    video.startedAt = w.timer.now()
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).status === 'LIVE', { step: 1000, max: 60 })
    expect(await collector(w, seller.cookie, b.id)).toMatchObject({ status: 'LIVE', statusMessage: '채팅을 받는 중', reason: null, reasonMessage: null, recorded: 0 })
    await youtubeOf(w).collectors.stop()
  })
})

describe('AC-Y1-24 끊김·오류·다시 시작 (웹 읽기)', () => {
  // 5xx·막힘 간격 처음 넷은 youtube-web-collector.test.ts "실패 뒤: 5xx는 5·10·20·30초…", 지점 거절은 "이어받기: … 지점 거절이면…"
  it('5xx가 이어지면 5·10·20·30초 그 뒤 30초씩, 받으면 처음으로(다음 부름은 timeoutMs)', async () => {
    const w = await world()
    const { seller, b, video } = await webLinked(w)
    w.web.timeoutMs = 1000
    youtubeOf(w).collectors.start()
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).status === 'LIVE')
    w.web.fail('poll', { status: 500 }, 6)
    const from = w.web.calls('poll')
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).status === 'RETRYING', { step: 100 })
    expect(await collector(w, seller.cookie, b.id)).toMatchObject({ status: 'RETRYING', statusMessage: '다시 연결하는 중' })
    await pass(w, 160_000, 500)
    const gaps = gapsOf(w.web.callTimes('poll').slice(from))
    expectGaps(gaps, [5000, 10_000, 20_000, 30_000, 30_000, 30_000], 1500)
    // 받은 뒤: 1초(timeoutMs)마다 — 실패 간격이 남지 않는다
    expectGaps(gaps.slice(6, 12), [1000, 1000, 1000, 1000, 1000, 1000], 600)
    w.web.addMessage(video.videoId, { author: 'UCa', name: '가', text: '1' })
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).recorded === 1)
    expect(await collector(w, seller.cookie, b.id)).toMatchObject({ status: 'LIVE', statusMessage: '채팅을 받는 중', reason: null })
  }, 60_000)

  it('막힘이 이어지면 30·60·120·300초 그 뒤 300초씩 (막힌 동안 경보는 한 번)', async () => {
    const w = await world()
    const { seller, b } = await webLinked(w)
    w.web.timeoutMs = 1000
    youtubeOf(w).collectors.start()
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).status === 'LIVE')
    w.web.fail('poll', { status: 429 }, 6)
    const from = w.web.calls('poll')
    await pass(w, 1_150_000, 2000)
    expectGaps(gapsOf(w.web.callTimes('poll').slice(from)), [30_000, 60_000, 120_000, 300_000, 300_000], 4000)
    expect(w.logs.filter((log) => log.level !== 'alert' && log.code === 'YT_CHAT_BLOCKED')).toHaveLength(1)
  }, 90_000)

  it('채팅 끝남·꺼짐·로그인 없이 볼 수 없게 됨·없음은 멈추고 문장을 준다. 끝남이 아닌 것은 다시 시작할 수 있다(같은 지점부터 — 끊긴 동안 일부 표시 없음)', async () => {
    // 옛 "권한 없음(forbidden)"은 웹에 없다 — 로그인 없이 볼 수 없게 바뀐 방송(비공개·멤버 전용·연령 제한)이 같은 자리(채팅을 찾을 수 없어요, 다시 시작 가능)
    const cases: [string, 'ended' | 'chatOff' | 'private' | 'members' | 'age' | 'missing', string, string, boolean, string | null][] = [
      ['끝남', 'ended', 'CHAT_ENDED', '유튜브 채팅이 끝났어요.', false, null],
      ['꺼짐', 'chatOff', 'STOPPED', '채팅이 꺼져 있어요.', true, 'CHAT_DISABLED'],
      ['비공개로 바뀜', 'private', 'STOPPED', '채팅을 찾을 수 없어요.', true, 'CHAT_NOT_FOUND'],
      ['멤버 전용으로 바뀜', 'members', 'STOPPED', '채팅을 찾을 수 없어요.', true, 'CHAT_NOT_FOUND'],
      ['연령 제한으로 바뀜', 'age', 'STOPPED', '채팅을 찾을 수 없어요.', true, 'CHAT_NOT_FOUND'],
      ['없음', 'missing', 'STOPPED', '채팅을 찾을 수 없어요.', true, 'CHAT_NOT_FOUND'],
    ]
    for (const [label, state, status, message, restartable, reason] of cases) {
      const w = await world()
      const { seller, b, video } = await webLinked(w)
      w.web.timeoutMs = 1000
      youtubeOf(w).collectors.start()
      w.web.addMessage(video.videoId, { id: 'm0', author: 'UCa', name: '가', text: '처음', publishedAt: w.timer.now() + 1 })
      await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).recorded === 1)
      video.state = state
      await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).status === status, { step: 200 })
      expect(await collector(w, seller.cookie, b.id), label).toMatchObject({ status, statusMessage: message, restartable, reason })
      const api = client(w, seller.cookie)
      if (!restartable) {
        const restart = await api.post(`/api/broadcasts/${b.id}/youtube/collector/restart`, {})
        expect(restart.body, label).toMatchObject({ error: { code: 'COLLECTOR_NOT_RESTARTABLE' } })
        // 유튜브 라이브가 끝나면 라이브찜 회차도 판매자가 끝낼 때와 같은 길로 저절로 끝낸다 (D-LIVE-AUTOEND — 전에는 끝내지 않았다)
        expect(((await api.get(`/api/days/${b.date}`)).body.broadcasts as { ended: boolean }[])[0]?.ended, label).toBe(true)
        continue
      }
      // 저절로 이어받지 않는 멈춤 → 운영자 경보 (AC-I3-82 몫)
      expect(w.logs.some((log) => log.level === 'alert' && log.code === 'COLLECTOR_STOPPED' && log.seller === seller.sellerId), label).toBe(true)
      // 멈춘 동안 부르지 않는다
      const polls = w.web.calls('poll')
      await pass(w, 30_000, 1000)
      expect(w.web.calls('poll'), label).toBe(polls)
      expect(await collector(w, seller.cookie, b.id), label).toMatchObject({ status, reason })
      video.state = 'live'
      const restart = await api.post(`/api/broadcasts/${b.id}/youtube/collector/restart`, {})
      expect(restart.status, label).toBe(200)
      w.web.addMessage(video.videoId, { id: 'm1', author: 'UCb', name: '나', text: '다시', publishedAt: w.timer.now() + 1 })
      await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).recorded === 2, { step: 1000 })
      expect(await chatIds(w), label).toEqual(['m0', 'm1'])
      expect(await collector(w, seller.cookie, b.id), label).toMatchObject({ status: 'LIVE', gap: false })
    }
  }, 120_000)

  it('옛 "할당량 초과면 멈춤" → 웹 읽기는 할당량을 쓰지 않는다: 오늘 할당량을 다 써서 게시가 멈춘(PAUSED) 판매자도 채팅은 받고, 읽기 호출은 계량 0 (AC-Y1-50·52 몫)', async () => {
    const w = await world({ google: true })
    const google = w.google
    if (google === null) throw new Error('가짜 구글 없음')
    const seller = await addSeller(w)
    await connectGoogle(w, seller)
    await youtubeOf(w).quota.markExceeded(seller.sellerId)
    const api = client(w, seller.cookie)
    expect(((await api.get('/api/youtube/quota')).body.quota as { mode: string }).mode).toBe('PAUSED')
    const { b, video } = await webLinked(w, { seller })
    youtubeOf(w).collectors.start()
    w.web.addMessage(video.videoId, { author: 'UCa', name: '가', text: '15', publishedAt: w.timer.now() + 1 })
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).recorded === 1)
    await pass(w, 30_000, 1000)
    expect(await collector(w, seller.cookie, b.id)).toMatchObject({ status: 'LIVE', reason: null, restartable: false })
    for (const method of ['videos.list', 'liveChatMessages.list', 'liveChatMessages.streamList', 'liveBroadcasts.list'] as const) expect(google.calls(method), method).toBe(0)
    const quota = (await api.get('/api/youtube/quota')).body.quota as { methods: { method: string; units: number }[] }
    const reading = quota.methods.filter((method) => ['videos.list', 'liveChatMessages.list', 'liveChatMessages.streamList', 'liveBroadcasts.list'].includes(method.method))
    expect(reading.reduce((sum, method) => sum + method.units, 0)).toBe(0)
  })
})

describe('AC-Y1-25 잇기 전 채팅·끝낸 뒤 채팅 (웹 읽기)', () => {
  it('20:00 잇고 첫 응답의 19:59:50·20:00:05 → 20:00:05만. 20:30 끝내고 20:29:58·20:30:01 도착 → 20:29:58만. 20:40 뒤 멈춘다(유튜브 요청 0)', async () => {
    const w = await world({ timer: new ManualTimer(Date.parse('2026-10-19T11:00:00Z')) }) // 20:00:00 KST
    const seller = await addSeller(w)
    const video = w.web.addVideo({ startedAt: Date.parse('2026-10-19T10:30:00Z') })
    w.web.addMessage(video.videoId, { id: 'early', author: 'UCa', name: '가', text: '15', publishedAt: Date.parse('2026-10-19T10:59:50.000Z') })
    w.web.addMessage(video.videoId, { id: 'ok1', author: 'UCb', name: '나', text: '안녕', publishedAt: Date.parse('2026-10-19T11:00:05.000Z') })
    const { b } = await webLinked(w, { seller, video })
    expect(b.date).toBe('2026-10-19')
    youtubeOf(w).collectors.start()
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).recorded === 1, { step: 100 })
    expect(await collector(w, seller.cookie, b.id)).toMatchObject({ recorded: 1, skippedBeforeLink: 1 })
    expect(await chatIds(w)).toEqual(['ok1'])
    // 20:30:00 끝낸다
    await w.timer.set(Date.parse('2026-10-19T11:30:00Z'))
    expect((await client(w, seller.cookie).post(`/api/broadcasts/${b.id}/end`, { requestId: 'end-25' })).status).toBe(200)
    await w.timer.set(Date.parse('2026-10-19T11:30:20Z'))
    w.web.addMessage(video.videoId, { id: 'late-ok', author: 'UCc', name: '다', text: '늦게 도착', publishedAt: Date.parse('2026-10-19T11:29:58.000Z') })
    w.web.addMessage(video.videoId, { id: 'after-end', author: 'UCd', name: '라', text: '15', publishedAt: Date.parse('2026-10-19T11:30:01.000Z') })
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).recorded === 2, { step: 500 })
    await pass(w, 10_000, 500)
    expect(await chatIds(w)).toEqual(['ok1', 'late-ok'])
    // 20:40:00 뒤 멈춘다 — 가짜 유튜브 웹 서버 호출이 더 없다
    await w.timer.set(Date.parse('2026-10-19T11:40:01Z'))
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).status === 'FINISHED', { step: 100, max: 400 })
    expect(await collector(w, seller.cookie, b.id)).toMatchObject({ status: 'FINISHED', statusMessage: '방송을 끝내 수집을 마쳤어요.' })
    const calls = w.web.calls()
    await pass(w, 100_000, 10_000)
    expect(w.web.calls()).toBe(calls)
  })
})

describe('AC-Y1-26 우리가 게시한 감사는 기록하지 않는다 (웹 읽기)', () => {
  it('구글 연결·게시 동의 + LOOSE·방송자 무시 끔: 17번(800원) 판매 → 감사 시도 → 웹 채팅에 돌아온 우리 글(연결한 채널)은 찜이 되지 않는다. 손으로 쓴 판매자 채팅은 owner', async () => {
    const w = await world({ google: true })
    const seller = await addSeller(w)
    const channelId = await connectGoogle(w, seller, { consent: true })
    const patched = await client(w, seller.cookie).patch('/api/settings', { settings: { 'claim.parseMode': 'LOOSE', 'claim.ignoreOwner': false } })
    expect(patched.status, JSON.stringify(patched.body)).toBe(200)
    const video = w.web.addVideo({ channelId, channelTitle: '구피 가게' })
    // 감사 쓰기는 공식 API(D-YT-SRV-13 (가)) — 첫 감사 직전에 videos.list로 채팅 ID를 받는다(D-YT-SRV-15). 가짜 구글에도 같은 영상
    w.google?.addBroadcast(channelId, { videoId: video.videoId })
    const { b } = await webLinked(w, { seller, video })
    await expectOk(writeEvent(w, seller, { type: 'product.register', b: b.id, no: 17, name: '미니마', price: 800 }))
    await expectOk(writeEvent(w, seller, { type: 'product.register', b: b.id, no: 18, name: '라울', price: 900, stock: 2 }))
    const youtube = youtubeOf(w)
    youtube.collectors.start()
    w.web.addMessage(video.videoId, { author: 'UCyounghee', name: '이영희', text: '17', publishedAt: w.timer.now() + 1 })
    await waitFor(w, async () => (await chatIds(w)).length === 1)
    const yw = w as unknown as YoutubeWorld
    await drive(yw, youtube.outbox.runOnce())
    await drive(yw, youtube.outbox.runOnce())
    const thanks = '17번 미니마 800원 이영희님 구매 감사합니다'
    const rows = (await client(w, seller.cookie).get(`/api/days/${b.date}/outbox`)).body.rows as { text: string; attempts: number }[]
    expect(rows.map((row) => row.text)).toEqual([thanks])
    // 우리 글이 채팅으로 돌아왔다 (연결한 채널 = 방송 채널이라 주인 배지) — 기록하지 않는다
    w.web.addMessage(video.videoId, { id: 'ours', author: channelId, name: '구피 가게', text: thanks, owner: true, publishedAt: w.timer.now() + 1 })
    await waitFor(w, async () => (await w.database.pglite?.query<{ n: number }>(`select count(*)::int as n from youtube_own_messages`))?.rows[0]?.n === 1)
    await pass(w, 10_000, 500)
    const day = (await client(w, seller.cookie).get(`/api/days/${b.date}`)).body
    expect((day.claims as unknown[]).length).toBe(1)
    expect(await chatIds(w)).toHaveLength(1)
    // 판매자가 손으로 쓴 18 → owner로 기록, 방송자 무시를 꺼서 판매자 찜이 된다(R-4 — 설정대로)
    w.web.addMessage(video.videoId, { id: 'hand', author: channelId, name: '구피 가게', text: '18', owner: true, publishedAt: w.timer.now() + 1 })
    await waitFor(w, async () => (await chatIds(w)).length === 2)
    const state = (await w.server.writer.read(seller.sellerId, b.date)).state
    expect(getProduct(state, b.id, 17)?.winners).toEqual(['UCyounghee'])
    expect(listClaims(state).filter((claim) => claim.no === 17)).toHaveLength(1)
    expect(getProduct(state, b.id, 18)?.winners).toEqual([channelId])
    const owned = await w.database.pglite?.query<{ id: string }>(`select chat_message_id as id from events where type = 'chat' and chat_message_id = 'ours'`)
    expect(owned?.rows).toEqual([])
  })

  it('초대 방송(구글 연결 없음): 방송 채널 주인의 "15번 2만원"은 방송자 글(방송자 무시 — 찜 0), 시청자 "15"는 찜 1 (AC-INV1-08 몫)', async () => {
    const w = await world()
    const seller = await addSeller(w)
    expect((await client(w, seller.cookie).patch('/api/settings', { settings: { 'claim.ignoreOwner': true } })).status).toBe(200)
    const video = w.web.addVideo({ channelTitle: '유튜버 B' })
    const { b } = await webLinked(w, { seller, video })
    await expectOk(writeEvent(w, seller, { type: 'product.register', b: b.id, no: 15, name: '핑크프릴', price: 20_000 }))
    youtubeOf(w).collectors.start()
    w.web.addMessage(video.videoId, { id: 'owner1', author: video.channelId, name: '유튜버 B', text: '15번 2만원', owner: true, publishedAt: w.timer.now() + 1 })
    w.web.addMessage(video.videoId, { id: 'viewer1', author: 'UCviewer1', name: '시청자', text: '15', publishedAt: w.timer.now() + 2 })
    await waitFor(w, async () => (await chatIds(w)).length === 2)
    const state = (await w.server.writer.read(seller.sellerId, b.date)).state
    expect(listClaims(state).map((claim) => claim.buyer)).toEqual(['UCviewer1'])
    expect(getProduct(state, b.id, 15)?.winners).toEqual(['UCviewer1'])
  })
})

describe('AC-Y1-27 지운 메시지·한 작성자 글 모두 지움 알림 (웹 읽기)', () => {
  it('기록된 메시지가 지워지면 알림(주문이었는지), 기록되지 않은 메시지는 아무 일 없음, 작성자 글 모두 지움 알림(이름 정리). 엔진은 그대로, 같은 알림은 하나, 다른 판매자는 못 본다', async () => {
    const w = await world()
    const { seller, b, video } = await webLinked(w)
    w.web.timeoutMs = 1000
    await expectOk(writeEvent(w, seller, { type: 'product.register', b: b.id, no: 15, name: '핑크프릴', price: 10000 }))
    youtubeOf(w).collectors.start()
    w.web.addMessage(video.videoId, { id: 'order1', author: 'UCa', name: '@가.나', text: '15', publishedAt: w.timer.now() + 1 })
    await waitFor(w, async () => (await chatIds(w)).length === 1)
    const api = client(w, seller.cookie)
    const notices = async () => (await api.get(`/api/days/${b.date}/youtube-notices`)).body.notices as Record<string, unknown>[]
    const seqBefore = (await w.server.writer.read(seller.sellerId, b.date)).seq
    w.web.deleteMessage(video.videoId, 'order1')
    w.web.deleteMessage(video.videoId, 'never-recorded')
    await waitFor(w, async () => (await notices()).length === 1)
    await pass(w, 5000)
    expect((await w.server.writer.read(seller.sellerId, b.date)).seq).toBe(seqBefore)
    // 한 작성자 글 모두 지움 — 같은 응답의 그 작성자 글에서 이름을 정리해 쓴다
    w.web.addMessage(video.videoId, { id: 'bad1', author: 'UCbad', name: 'bad\nguy', text: '안녕', publishedAt: w.timer.now() + 1 })
    w.web.removeAuthor(video.videoId, 'UCbad')
    await waitFor(w, async () => (await notices()).length === 2)
    // 같은 지움이 또 와도 하나
    w.web.deleteMessage(video.videoId, 'order1')
    await pass(w, 5000)
    expect((await notices()).map(({ id: _id, at: _at, ...rest }) => rest)).toEqual([
      { kind: 'DELETED', broadcast: b.id, messageId: 'order1', channel: 'UCa', nick: '가·나', wasOrder: true, wasCancel: false, banType: null, banSeconds: null, message: '시청자가 메시지를 지웠어요. 그 메시지로 생긴 찜은 그대로예요.' },
      { kind: 'BANNED', broadcast: b.id, messageId: null, channel: 'UCbad', nick: 'bad guy', wasOrder: false, wasCancel: false, banType: null, banSeconds: null, message: '유튜브에서 차단된 시청자예요. 라이브지니에서도 막으려면 차단해 주세요.' },
    ])
    expect(getProduct((await w.server.writer.read(seller.sellerId, b.date)).state, b.id, 15)?.winners).toEqual(['UCa'])
    const other = await addSeller(w)
    expect((await client(w, other.cookie).get(`/api/days/${b.date}/youtube-notices`)).body.notices).toEqual([])
  })
})

describe('AC-Y1-28 서버 전체에서 하나 (웹 읽기)', () => {
  it('수집 관리자 둘이 같은 DB에 떠도 회차마다 채팅 요청은 한 번에 하나·기록 중복 0. 하나가 죽으면 다른 하나가 30초 안에 이어받는다', async () => {
    const w = await world()
    const { seller, b, video } = await webLinked(w)
    w.web.timeoutMs = 1000
    const second = await world({ database: w.database, masterKey: w.masterKey, web: w.web, timer: w.timer, name: 'B' })
    const a = youtubeOf(w).collectors
    const bm = youtubeOf(second).collectors
    a.start()
    bm.start()
    for (let i = 0; i < 30; i++) w.web.addMessage(video.videoId, { author: `UC${String(i)}`, name: `n${String(i)}`, text: '안녕', publishedAt: w.timer.now() + 1 })
    await waitFor(w, async () => (await chatIds(w)).length === 30, { step: 1000 })
    await pass(w, 10_000, 500)
    expect(a.running.length + bm.running.length).toBe(1)
    expect(w.web.maxInflightPolls).toBe(1)
    expect(Math.min(...gapsOf(w.web.callTimes('poll')))).toBeGreaterThanOrEqual(1000)
    const holder = a.running.length === 1 ? a : bm
    const other = holder === a ? bm : a
    await holder.kill()
    const killedAt = w.timer.now()
    for (let i = 0; i < 30; i++) w.web.addMessage(video.videoId, { author: `UCx${String(i)}`, name: `m${String(i)}`, text: '반가워요', publishedAt: w.timer.now() + 1 })
    await waitFor(w, async () => (await chatIds(w)).length === 60, { step: 1000 })
    expect(other.running.length).toBe(1)
    expect(w.timer.now() - killedAt).toBeLessThanOrEqual(30_000)
    const ids = await chatIds(w)
    expect(new Set(ids).size).toBe(60)
    expect(await collector(w, seller.cookie, b.id)).toMatchObject({ status: 'LIVE', mode: 'WEB', recorded: 60, lastMessageAt: expect.any(String) })
  })
})

describe('AC-Y1-13·25·28 서버가 둘일 때 다른 서버에서 한 조작 (웹 읽기)', () => {
  it('수집기가 A에서 도는데 B가 회차를 끝내면: 채팅이 조용해도 A가 알아채 끝낸 뒤 10분에 멈춘다(그 뒤 유튜브 요청 0)', async () => {
    const w = await world()
    const { seller, b, video } = await webLinked(w)
    youtubeOf(w).collectors.start()
    w.web.addMessage(video.videoId, { id: 'before', author: 'UCa', name: '가', text: '안녕', publishedAt: w.timer.now() + 1 })
    await waitFor(w, async () => (await chatIds(w)).length === 1)
    const other = await world({ database: w.database, masterKey: w.masterKey, web: w.web, timer: w.timer, name: 'B' })
    expect((await client(other, seller.cookie).post(`/api/broadcasts/${b.id}/end`, { requestId: 'end-b' })).status).toBe(200)
    const endedAt = w.timer.now()
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).status === 'FINISHED', { step: 10_000, max: 200 })
    expect(w.timer.now() - endedAt).toBeGreaterThanOrEqual(10 * 60 * 1000)
    expect(w.timer.now() - endedAt).toBeLessThanOrEqual(10 * 60 * 1000 + 30_000)
    expect(await chatIds(w)).toEqual(['before'])
    const calls = w.web.calls()
    await pass(w, 60_000, 1000)
    expect(w.web.calls()).toBe(calls)
  })

  it('수집기가 A에서 도는데 B가 회차의 유튜브 연결을 끊으면: A가 멈추고(그 뒤 채팅 요청 0) 끊은 뒤 채팅은 그 회차에 기록되지 않는다', async () => {
    const w = await world()
    const { seller, b, video } = await webLinked(w)
    w.web.timeoutMs = 1000
    const a = youtubeOf(w).collectors
    a.start()
    w.web.addMessage(video.videoId, { id: 'before', author: 'UCa', name: '가', text: '안녕', publishedAt: w.timer.now() + 1 })
    await waitFor(w, async () => (await chatIds(w)).length === 1)
    const other = await world({ database: w.database, masterKey: w.masterKey, web: w.web, timer: w.timer, name: 'B' })
    expect((await client(other, seller.cookie).post(`/api/broadcasts/${b.id}/youtube/unlink`, {})).status).toBe(200)
    await pass(w, 1000)
    w.web.addMessage(video.videoId, { id: 'after', author: 'UCb', name: '나', text: '15', publishedAt: w.timer.now() })
    await waitFor(w, () => a.running.length === 0, { step: 1000, max: 200 })
    expect(await chatIds(w)).toEqual(['before'])
    const polls = w.web.calls('poll')
    await pass(w, 60_000, 1000)
    expect(w.web.calls('poll')).toBe(polls)
    expect(await chatIds(w)).toEqual(['before'])
  })

  it('기록 직전 범위 락 안에서도 거른다: 끝낸 뒤 게시된 메시지·끊은 연결의 묶음은 기록하지 않는다 (구글 연결 없는 웹 잇기 회차)', async () => {
    const w = await world()
    const { seller, b } = await webLinked(w)
    const service = w.server.service
    expect((await client(w, seller.cookie).post(`/api/broadcasts/${b.id}/end`, { requestId: 'end-tx' })).status).toBe(200)
    const endedAt = w.timer.now()
    const outcome = await service.ingestYoutubeBatch(seller.sellerId, b.id, [
      { id: 'm-before', ch: 'UCa', nick: '가', text: '안녕', publishedAt: endedAt - 1 },
      { id: 'm-after', ch: 'UCb', nick: '나', text: '15', publishedAt: endedAt + 1 },
    ])
    expect(outcome).toEqual({ status: 'ok', recorded: 1 })
    expect(await chatIds(w)).toEqual(['m-before'])
    expect(await service.ingestYoutubeBatch(seller.sellerId, b.id, [{ id: 'm-guard', ch: 'UCc', nick: '다', text: '안녕', publishedAt: endedAt - 1 }], () => Promise.resolve(false))).toEqual({ status: 'unlinked' })
    expect(await chatIds(w)).toEqual(['m-before'])
  })
})

describe('AC-Y1-12·28 수집 후보 (웹 읽기)', () => {
  it('봉인·끊음·손으로 다시 시작해야 하는 멈춤·끝은 후보에서 빠지고 다시 시작하면 돌아온다. 막힘·모르는 모양·운영자 끄기는 후보(저절로 이어받음)', async () => {
    const w = await world()
    const { seller, b } = await webLinked(w)
    const db = w.database.db
    const candidates = async () => (await collectorCandidates(db, 'A', new Date(w.timer.now()))).length
    const setStatus = (status: string, reason: string | null) => w.database.pglite?.query(`update youtube_collectors set status = $1, reason = $2, lease_owner = null, lease_until = null`, [status, reason])
    expect((await w.database.pglite?.query<{ mode: string }>(`select mode from youtube_collectors`))?.rows).toEqual([{ mode: 'WEB' }])
    expect(await candidates()).toBe(1)
    for (const reason of ['SEALED', 'CHAT_DISABLED', 'FORBIDDEN', 'CHAT_NOT_FOUND', 'UNLINKED']) {
      await setStatus('STOPPED', reason)
      expect(await candidates(), reason).toBe(0)
    }
    for (const status of ['FINISHED', 'CHAT_ENDED']) {
      await setStatus(status, null)
      expect(await candidates(), status).toBe(0)
    }
    for (const [status, reason] of [
      ['RETRYING', 'BLOCKED'],
      ['RETRYING', 'FORMAT'],
      ['STOPPED', 'OPERATOR_OFF'],
    ] as const) {
      await setStatus(status, reason)
      expect(await candidates(), reason).toBe(1)
    }
    await setStatus('STOPPED', 'CHAT_DISABLED')
    expect(await candidates()).toBe(0)
    expect((await client(w, seller.cookie).post(`/api/broadcasts/${b.id}/youtube/collector/restart`, {})).status).toBe(200)
    expect(await candidates()).toBe(1)
  })

  it('운영자가 끈 서버에서 멈춘 수집(OPERATOR_OFF)은 켠 서버가 저절로 이어받는다 — 저장한 지점부터, 끈 동안 온 채팅도 빠짐·중복 없이', async () => {
    const w = await world()
    const { seller, b, video } = await webLinked(w)
    w.web.timeoutMs = 1000
    youtubeOf(w).collectors.start()
    w.web.addMessage(video.videoId, { id: 'a1', author: 'UCa', name: '가', text: '1', publishedAt: w.timer.now() + 1 })
    await waitFor(w, async () => (await chatIds(w)).length === 1)
    await youtubeOf(w).collectors.kill()
    await pass(w, 25_000, 1000) // 임대가 지난다
    const off = await world({ database: w.database, masterKey: w.masterKey, web: w.web, timer: w.timer, name: 'OFF', on: false })
    youtubeOf(off).collectors.start()
    await waitFor(off, async () => (await collector(off, seller.cookie, b.id)).reason === 'OPERATOR_OFF', { step: 1000 })
    w.web.addMessage(video.videoId, { id: 'a2', author: 'UCb', name: '나', text: '2', publishedAt: w.timer.now() + 1 })
    await youtubeOf(off).collectors.stop()
    const on = await world({ database: w.database, masterKey: w.masterKey, web: w.web, timer: w.timer, name: 'ON' })
    youtubeOf(on).collectors.start()
    await waitFor(on, async () => (await chatIds(on)).length === 2, { step: 1000 })
    expect(await chatIds(on)).toEqual(['a1', 'a2'])
    expect(await collector(on, seller.cookie, b.id)).toMatchObject({ status: 'LIVE', reason: null, gap: false })
  })
})

describe('AC-Y1-94 수집 호출 간격·예정 방송 (웹 읽기)', () => {
  // (가) 폴링 간격 하한 → youtube-web-collector.test.ts "다음 부름 = … 1초 미만이면 1초…". (나) 스트림 다시 열기 간격 → 옛 길 전용, 같은 뜻은 그 시험과
  // youtube-web-collector-load.test.ts의 빠짐·중복 없는 기록. (다) 실패 간격 → 위 "5xx가 이어지면 5·10·20·30초 그 뒤 30초씩"
  it('(라) 예정 방송: 10분 동안 채팅 요청 0, 상태 확인(공개 페이지) ≤ 21번(STARTING·NOT_STARTED) → 시작하면 30초 안에 수집, 실제 시작 전 채팅은 기록 0(건너뜀에 셈). (마) 기다리는 중 서버를 다시 시작해도 채팅 요청 0', async () => {
    const w = await world()
    const video = w.web.addVideo({ state: 'upcoming', startedAt: w.timer.now() + 3_600_000 })
    const { seller, b } = await webLinked(w, { video })
    const t0 = w.timer.now()
    youtubeOf(w).collectors.start()
    w.web.addMessage(video.videoId, { id: 'wait1', author: 'UCa', name: '가', text: '15', publishedAt: t0 + 60_000 })
    await pass(w, 5 * 60 * 1000, 5000)
    expect(await collector(w, seller.cookie, b.id)).toMatchObject({ status: 'STARTING', reason: 'NOT_STARTED', reasonMessage: '유튜브 방송이 시작되면 채팅을 받아요.' })
    // (마) 서버를 다시 시작한다 (A가 죽고 B가 이어받는다)
    await youtubeOf(w).collectors.kill()
    const revived = await world({ database: w.database, masterKey: w.masterKey, web: w.web, timer: w.timer, name: 'B' })
    youtubeOf(revived).collectors.start()
    const left = t0 + 10 * 60 * 1000 - w.timer.now()
    await pass(w, left, 5000)
    expect(w.timer.now() - t0).toBe(10 * 60 * 1000)
    expect(w.web.calls('poll') + w.web.calls('chatPage')).toBe(0)
    const checks = w.web.callTimes('watch').filter((at) => at > t0)
    expect(checks.length).toBeGreaterThanOrEqual(15)
    expect(checks.length).toBeLessThanOrEqual(21)
    expect(await collector(w, seller.cookie, b.id)).toMatchObject({ status: 'STARTING', reason: 'NOT_STARTED' })
    // 방송 시작 (실제 시작 시각 S)
    const S = w.timer.now()
    video.state = 'live'
    video.startedAt = S
    // 이 뒤에 가짜 서버가 받은 상태 확인은 시작을 본다
    const mark = w.web.calls('watch')
    w.web.addMessage(video.videoId, { id: 'pre', author: 'UCb', name: '나', text: '16', publishedAt: S - 500 })
    w.web.addMessage(video.videoId, { id: 'post1', author: 'UCc', name: '다', text: '안녕', publishedAt: S + 500 })
    await waitFor(w, async () => (await chatIds(w)).length >= 1, { step: 250, max: 240 })
    const startCheck = w.web.callTimes('watch')[mark] ?? Number.POSITIVE_INFINITY
    const firstPoll = w.web.callTimes('poll')[0] ?? Number.POSITIVE_INFINITY
    expect(startCheck - S).toBeLessThanOrEqual(30_000 + 2000)
    expect(firstPoll - startCheck).toBeLessThan(5000)
    w.web.addMessage(video.videoId, { id: 'post2', author: 'UCd', name: '라', text: '반가워요', publishedAt: w.timer.now() + 1 })
    await waitFor(w, async () => (await chatIds(w)).length >= 2, { step: 1000, max: 60 })
    expect(await chatIds(w)).toEqual(['post1', 'post2'])
    expect(await collector(w, seller.cookie, b.id)).toMatchObject({ status: 'LIVE', skippedBeforeLink: 2 })
    await youtubeOf(revived).collectors.stop()
  }, 60_000)

  it('예정이던 방송이 이미 끝났으면 CHAT_ENDED, 영상이 없어졌으면 "채팅을 찾을 수 없어요." — 둘 다 채팅 요청 0', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const upcoming = w.web.addVideo({ state: 'upcoming', startedAt: w.timer.now() + 3_600_000 })
    const { b } = await webLinked(w, { seller, video: upcoming })
    youtubeOf(w).collectors.start()
    upcoming.state = 'ended'
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).status === 'CHAT_ENDED', { step: 5000, max: 40 })
    await youtubeOf(w).collectors.stop()
    const gone = w.web.addVideo({ channelId: upcoming.channelId, state: 'upcoming', startedAt: w.timer.now() + 3_600_000 })
    const b2 = await createBroadcast(w, seller, { date: '2026-10-20' })
    expect((await client(w, seller.cookie).post(`/api/broadcasts/${b2.id}/youtube`, { requestId: 'up-3', video: gone.videoId })).status).toBe(200)
    gone.state = 'missing'
    youtubeOf(w).collectors.start()
    await waitFor(w, async () => (await collector(w, seller.cookie, b2.id)).status === 'STOPPED', { step: 5000, max: 40 })
    expect(await collector(w, seller.cookie, b2.id)).toMatchObject({ status: 'STOPPED', reason: 'CHAT_NOT_FOUND', statusMessage: '채팅을 찾을 수 없어요.' })
    expect(w.web.calls('poll') + w.web.calls('chatPage')).toBe(0)
    await youtubeOf(w).collectors.stop()
  }, 60_000)
})

describe('AC9 도착 시각 판정 (AC-N2b-2-03 몫)', () => {
  it('게시 시각이 더 이르나 늦게 도착한 웹 채팅 "15번"은 먼저 도착한 "15" 뒤 — 1등은 먼저 도착, 웹 채팅은 대기 1순위', async () => {
    const w = await world()
    const { seller, b, video } = await webLinked(w)
    w.web.timeoutMs = 1000
    await expectOk(writeEvent(w, seller, { type: 'product.register', b: b.id, no: 15, name: '핑크프릴', price: 10_000 }))
    youtubeOf(w).collectors.start()
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).status === 'LIVE')
    await pass(w, 10_000)
    const published = w.timer.now() - 5000
    expect((await w.server.ingestChat(seller.sellerId, { b: b.id, id: 'first', ch: 'UCfirst', nick: '먼저', text: '15', publishedAt: w.timer.now() })).status).toBe('recorded')
    w.web.addMessage(video.videoId, { id: 'yt1', author: 'UCyoutubeBuyer', name: '유튜브손님', text: '15번', publishedAt: published })
    await waitFor(w, async () => listClaims((await w.server.writer.read(seller.sellerId, b.date)).state).length === 2)
    const state = (await w.server.writer.read(seller.sellerId, b.date)).state
    const claims = listClaims(state)
    const product = listProducts(state).find((p) => p.no === 15)
    const buyerOf = (id: string | undefined) => claims.find((c) => c.id === id)?.buyer
    expect(buyerOf(product?.winnerClaims[0])).toBe('UCfirst')
    expect(buyerOf(product?.waitlistClaims[0])).toBe('UCyoutubeBuyer')
  })
})

describe('AC10·AC-Y1-70 로그 (웹 읽기)', () => {
  it('채팅 본문·닉네임·작성자/방송 채널 ID·지점 값·익명 방문 값·키·방송 제목이 서버 로그에 없다 (수집·지점 거절·5xx·막힘·모르는 종류 흐름)', async () => {
    const w = await world()
    const seller = await addSeller(w)
    const video = w.web.addVideo({ channelTitle: '심은채널이름', title: '심은방송제목' })
    const { b } = await webLinked(w, { seller, video })
    w.web.timeoutMs = 1000
    await expectOk(writeEvent(w, seller, { type: 'product.register', b: b.id, no: 15, name: '심은품종', price: 10000 }))
    youtubeOf(w).collectors.start()
    w.web.fail('poll', { status: 500 })
    w.web.fail('poll', { status: 400 })
    w.web.addMessage(video.videoId, { author: 'UCplantedViewer000000001', name: '심은닉네임', text: '15', publishedAt: w.timer.now() + 1 })
    w.web.addMessage(video.videoId, { author: 'UCplantedViewer000000002', name: '심은닉네임2', text: '심은본문 이야기', publishedAt: w.timer.now() + 1 })
    w.web.addMessage(video.videoId, { author: 'UCplantedViewer000000003', name: '심은닉네임3', type: 'unknown', text: '심은모르는글', publishedAt: w.timer.now() + 1 })
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).recorded === 2, { step: 500 })
    w.web.fail('poll', { status: 429 })
    w.web.addMessage(video.videoId, { author: 'UCplantedViewer000000004', name: '심은닉네임4', text: '심은본문 둘', publishedAt: w.timer.now() + 1 })
    await waitFor(w, async () => (await collector(w, seller.cookie, b.id)).recorded === 3, { step: 1000 })
    const text = w.logs.map((record) => formatLog(record)).join('\n') + JSON.stringify(w.logs)
    expect(w.logs.length).toBeGreaterThan(0)
    const visitors = w.web.pollClients.map((c) => String(c.visitorData))
    expect(w.web.continuations.length).toBeGreaterThan(2)
    for (const secret of [...w.web.continuations, ...visitors, 'fake-web-key', '심은닉네임', '심은본문', '심은모르는글', '심은품종', '심은채널이름', '심은방송제목', 'UCplantedViewer', video.channelId]) {
      expect(text, secret).not.toContain(secret)
    }
    // 남는 것은 실패 종류·HTTP 상태·모르는 종류 이름·판매자
    expect(text).toMatch(/code=COLLECTOR_ERROR/)
    expect(text).toMatch(/status=500/)
    expect(text).toContain('YoutubeWeb_REJECTED')
    expect(text).toContain('YoutubeWeb_BLOCKED')
    expect(text).toContain('liveChatFutureThingRenderer')
    expect(text).toContain(`seller=${seller.sellerId}`)
  })
})

describe('AC-Y1-80·RA-I3-001 가짜 유튜브 웹 서버', () => {
  it('첫 지점(전체 채팅 다시 불러오기)은 실제처럼 최근 동작(backlogSize개)부터 — 다음 지점은 그 뒤로만, 새 글이 없으면 빈 묶음과 다음 지점', async () => {
    const timer = new ManualTimer(Date.UTC(2026, 9, 19, 3, 0, 0))
    const fake = await FakeYoutubeWeb.start({ now: () => timer.now() })
    fakes.push(fake)
    const video = fake.addVideo()
    for (let i = 0; i < 100; i++) fake.addMessage(video.videoId, { id: `old${String(i).padStart(3, '0')}`, author: `UC${String(i)}`, name: `시청자${String(i)}`, text: `채팅 ${String(i)}` })
    const source = new WebChatSource({ transport: new HttpWebTransport({ timer, baseUrl: fake.url }), timer })
    const page = await source.chatPage(video.videoId)
    expect(page.state).toBe('OK')
    if (page.session === null || page.continuation === null) throw new Error('채팅 페이지에 지점이 없다')
    const first = await source.poll(page.session, page.continuation)
    if (first.kind !== 'ok' || first.next === null) throw new Error('첫 응답이 없다')
    expect(first.chats.map((chat) => chat.id)).toEqual(Array.from({ length: 80 }, (_, i) => `old${String(i + 20).padStart(3, '0')}`))
    fake.addMessage(video.videoId, { id: 'new1', author: 'UCn', name: '새', text: '15' })
    const second = await source.poll(page.session, first.next)
    if (second.kind !== 'ok' || second.next === null) throw new Error('둘째 응답이 없다')
    expect(second.chats.map((chat) => chat.id)).toEqual(['new1'])
    const quiet = await source.poll(page.session, second.next)
    expect(quiet).toMatchObject({ kind: 'ok', chats: [], timeoutMs: 5000 })
    expect(quiet.kind === 'ok' && quiet.next !== null).toBe(true)
    // 묶음 중간 끊기 → 받는 쪽은 연결 오류, 넣은 오류는 그 한 번만
    fake.fail('poll', { kind: 'cut' })
    await expect(source.poll(page.session, second.next)).rejects.toMatchObject({ kind: 'NETWORK' })
    expect(fake.pendingFaults('poll')).toBe(0)
    expect((await source.poll(page.session, second.next)).kind).toBe('ok')
  })
})
