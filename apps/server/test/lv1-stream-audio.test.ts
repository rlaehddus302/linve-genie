import { once } from 'node:events'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { createNodeServer } from '../src/node-server.ts'
import { parseWatchPage } from '../src/youtube/web-chat.ts'
import { startMockWorker } from '../src/voice/mock-worker.ts'
import {
  FakeBroadcastAudio, MARKER_CHUNKS, PRACTICE_SPEECH, Rechunker, SILENT_CHUNK, markerChunk, readStreamAudioSwitch, recordFailure, retryDelayMs, safeHlsUrl,
  locateFromPage, readYtDlpPath, ytDlpResolver, readMediaProxy, ffmpegArgs, type AudioUrlResult, type ExecFileRunner,
  ytDlpTiktokResolver, notLiveBackoff, safeTiktokMediaUrl, webStreamLocator, TIKTOK_NOT_LIVE_WAIT_MS, type TiktokAudioUrlResolver,
  type AudioSink, type StreamLocation,
} from '../src/voice/stream-audio.ts'
import { generateMasterKey } from '../src/secrets.ts'
import type { LogRecord } from '../src/log.ts'
import { eq } from 'drizzle-orm'
import { broadcasts } from '../src/db/schema.ts'
import { insertTiktokLink, unlinkTiktokLink } from '../src/tiktok-live/store.ts'
import { addSeller, client, createBroadcast, dumpAllTables, newWorld, openTestDb, ORIGIN, startServer, waitFor, type TestServer } from './support.ts'

const TOKEN = 'test-worker-token-not-used-outside-tests'
const worlds: TestServer[] = []
const sockets: WebSocket[] = []
const servers: Server[] = []
const cleanups: (() => void)[] = []
afterEach(async () => {
  for (const run of cleanups.splice(0)) run()
  for (const socket of sockets.splice(0)) socket.terminate()
  for (const world of worlds.splice(0)) { world.server.close(); await world.database.close() }
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

/** 손으로 조각을 넣는 가짜 소리 받기 */
class ManualFeed {
  readonly sinks: AudioSink[] = []
  opened = 0
  open(_url: string, sink: AudioSink) { this.opened++; this.sinks.push(sink); return { close: () => { const i = this.sinks.indexOf(sink); if (i >= 0) this.sinks.splice(i, 1) } } }
  get sink(): AudioSink | undefined { return this.sinks[this.sinks.length - 1] }
}
/** 손으로 돌리는 다시 잇기 타이머 */
class ManualSchedule {
  readonly jobs: { run: () => void; ms: number; live: boolean }[] = []
  schedule = (run: () => void, ms: number) => { const job = { run, ms, live: true }; this.jobs.push(job); return () => { job.live = false } }
  /** 멈춤 확인만 */
  runStall(): number { const due = this.jobs.filter((job) => job.live && job.ms === 2_500); for (const job of due) { job.live = false; job.run() } return due.length }
  /** 5초 쓸기 말고 다시 잇기 타이머만 */
  runRetries(): number[] {
    const due = this.jobs.filter((job) => job.live && job.ms !== 5_000 && job.ms !== 2_500)
    for (const job of due) { job.live = false; job.run() }
    return due.map((job) => job.ms)
  }
}

class Peer {
  readonly ws: WebSocket
  readonly messages: { binary: boolean; body: unknown; bytes: Buffer }[] = []
  constructor(url: string, headers: Record<string, string>) {
    this.ws = new WebSocket(url, { headers })
    sockets.push(this.ws)
    this.ws.on('error', () => {})
    this.ws.on('message', (data, binary) => {
      const bytes = Buffer.from(data as Buffer)
      this.messages.push({ binary, bytes, body: binary ? null : JSON.parse(bytes.toString('utf8')) })
    })
  }
  async open() { await once(this.ws, 'open'); return this }
  send(value: unknown) { this.ws.send(JSON.stringify(value)) }
  async matching(predicate: (value: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
    const ok = (item: typeof this.messages[number]) => !item.binary && predicate(item.body as Record<string, unknown>)
    await waitFor(() => this.messages.some(ok), 8_000).catch(() => { throw new Error(JSON.stringify(this.messages.map((m) => m.body)).slice(0, 3000)) })
    return this.messages.splice(this.messages.findIndex(ok), 1)[0]!.body as Record<string, unknown>
  }
  async message(type: string) {
    const match = (item: typeof this.messages[number]) => !item.binary && (item.body as { type: string }).type === type
    await waitFor(() => this.messages.some(match))
    return this.messages.splice(this.messages.findIndex(match), 1)[0]!.body as Record<string, unknown>
  }
}

async function setup(options: { on?: boolean; location?: () => StreamLocation } = {}) {
  const feed = new ManualFeed()
  const timer = new ManualSchedule()
  let location: () => StreamLocation = options.location ?? (() => ({ kind: 'ok', url: 'https://manifest.googlevideo.com/x.m3u8' }))
  const world = await newWorld({
    transcribeWorkerToken: TOKEN,
    streamAudio: { on: options.on ?? true, feed, locate: async () => location(), schedule: timer.schedule },
  })
  worlds.push(world)
  const server = createNodeServer({ app: world.server.app })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('주소 없음')
  return { world, feed, timer, url: `ws://127.0.0.1:${address.port}`, setLocation: (next: () => StreamLocation) => { location = next } }
}
async function worker(url: string, world: TestServer, capacity = 4) {
  const peer = await new Peer(`${url}/api/voice/worker`, { Authorization: `Bearer ${TOKEN}` }).open()
  peer.send({ type: 'hello', maxStreams: capacity })
  await waitFor(() => world.server.voice.status().workers > 0)
  return peer
}
const device = (url: string, cookie: string, b: string, id: string, capture = true) =>
  new Peer(`${url}/api/voice/stream?broadcastId=${encodeURIComponent(b)}&device=${id}${capture ? '' : '&capture=false'}`, { Origin: ORIGIN, Cookie: cookie })
const phase = async (world: TestServer, cookie: string, b: string) => (await client(world, cookie).get(`/api/broadcasts/${b}/stream-audio`)).body as { phase: string; lagMs?: number }
const watch = async (world: TestServer, cookie: string, b: string) => (await client(world, cookie).post(`/api/broadcasts/${b}/stream-audio/watch`, {})).body as { phase: string }

describe('LV1 방송 소리 부품', () => {
  it('3,200바이트 조각으로 자르고, 다시 잇기는 1·2·4·8초, 60초 안 여섯 번째 끊김에 멈춘다', () => {
    const out: Buffer[] = []
    const chunker = new Rechunker()
    chunker.push(Buffer.alloc(5_000, 1), (c) => out.push(c))
    chunker.push(Buffer.alloc(1_400, 2), (c) => out.push(c))
    expect(out.map((c) => c.length)).toEqual([3_200, 3_200])
    expect([1, 2, 3, 4, 5, 9].map(retryDelayMs)).toEqual([1_000, 2_000, 4_000, 8_000, 8_000, 8_000])
    const times: number[] = []
    expect([0, 1, 2, 3, 4].map((s) => recordFailure(times, s * 1_000).stop)).toEqual([false, false, false, false, false])
    expect(recordFailure(times, 59_000).stop).toBe(true)
    const spaced: number[] = []
    expect([0, 20, 40, 60, 80, 100].map((s) => recordFailure(spaced, s * 1_000).stop).includes(true)).toBe(false)
  })
  it('운영자 스위치·HLS 주소 검사·방송 페이지의 HLS 주소', () => {
    expect(readStreamAudioSwitch({})).toBe(true)
    expect(readStreamAudioSwitch({ LIVEJJIM_STREAM_AUDIO: ' OFF ' })).toBe(false)
    expect(safeHlsUrl('https://manifest.googlevideo.com/a.m3u8')).not.toBeNull()
    for (const bad of ['http://manifest.googlevideo.com/a', 'https://evil.test/a.m3u8', 'file:///etc/passwd', null]) expect(safeHlsUrl(bad)).toBeNull()
    const html = `<script>var ytInitialPlayerResponse = ${JSON.stringify({ playabilityStatus: { status: 'OK' }, streamingData: { hlsManifestUrl: 'https://manifest.googlevideo.com/v.m3u8' }, videoDetails: { videoId: 'v', channelId: 'UCx', isLive: true } })};</script>`
    expect(parseWatchPage(html).hlsUrl).toBe('https://manifest.googlevideo.com/v.m3u8')
  })
  it('모의 일꾼은 표지 소리에만 정해진 글을 돌려준다', async () => {
    const { world, url } = await setup()
    const w = startMockWorker({ url: `${url}/api/voice/worker`, token: TOKEN })
    cleanups.push(() => w.close())
    await waitFor(() => world.server.voice.status().workers === 1)
    const results: unknown[] = []
    const stream = world.server.voice.openExternal((r) => results.push(r), () => {})
    if (typeof stream === 'string') throw new Error(stream)
    for (let i = 0; i < 20; i++) stream.send(Buffer.alloc(3_200, i))
    for (let i = 0; i < MARKER_CHUNKS; i++) stream.send(markerChunk(i))
    stream.send(SILENT_CHUNK)
    await waitFor(() => results.length === 1)
    expect(results[0]).toEqual({ text: PRACTICE_SPEECH, startMs: 2_000, endMs: 3_000 })
    stream.close()
  })
})

describe('LV1 방송 소리로 듣기 (서버)', () => {
  it('콘솔이 열려 있을 때만 열고, 일꾼에 3,200바이트 PCM을 보내며, 글은 그 방송 콘솔로만 간다. 소리·글은 DB·로그에 없다', async () => {
    const { world, feed, url } = await setup()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const w = await worker(url, world)
    expect(await phase(world, seller.cookie, b.id)).toEqual({ phase: 'idle' })
    expect(feed.opened).toBe(0)
    expect((await client(world, seller.cookie).get('/api/settings/stream-audio')).body).toEqual({ available: true, enabled: true })
    await watch(world, seller.cookie, b.id)
    await waitFor(() => feed.sink !== undefined)
    const consoleFlow = device(url, seller.cookie, b.id, 'consolepc01', false)
    await consoleFlow.message('ready')
    const pcm = Buffer.alloc(3_200, 0x11)
    feed.sink!.chunk(pcm, Date.now())
    const open = await w.message('open')
    await waitFor(() => w.messages.some((m) => m.binary))
    const frame = w.messages.find((m) => m.binary)!.bytes
    expect(frame.length).toBe(4 + 3_200)
    expect(frame.readUInt32BE(0)).toBe(open.stream)
    expect(frame.subarray(4)).toEqual(pcm)
    expect((await phase(world, seller.cookie, b.id)).phase).toBe('listening')
    w.send({ type: 'result', stream: open.stream, text: '십오번 이만원', startMs: 0, endMs: 100, procMs: 40 })
    expect(await consoleFlow.message('result')).toMatchObject({ type: 'result', text: '십오번 이만원', startMs: 0, endMs: 100 })
    expect(await dumpAllTables(world.database)).not.toContain('십오번 이만원')
    expect(JSON.stringify(world.logs)).not.toContain('십오번 이만원')
  })
  it('D-LIVETEST-03 방송 소리가 늦게 도착하면 기준을 옮겨, 받아쓴 말의 시각이 도착 시각보다 뒤처지지 않는다', async () => {
    const { world, feed, url } = await setup()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const w = await worker(url, world)
    await watch(world, seller.cookie, b.id)
    await waitFor(() => feed.sink !== undefined)
    const consoleFlow = device(url, seller.cookie, b.id, 'consolepc02', false)
    await consoleFlow.message('ready')
    feed.sink!.chunk(Buffer.alloc(3_200), world.clock.now())
    const open = await w.message('open')
    w.send({ type: 'result', stream: open.stream, text: '첫 말', startMs: 0, endMs: 100, procMs: 40 })
    expect(await consoleFlow.message('result')).toMatchObject({ text: '첫 말', startMs: 0, endMs: 100 })
    // 소리가 5초 멈췄다가 다음 100ms 조각이 도착 — 그 조각의 말은 도착 시각(첫 말 + 5초 + 100ms) 기준
    world.clock.advance(5_000)
    feed.sink!.chunk(Buffer.alloc(3_200), world.clock.now())
    await waitFor(() => w.messages.filter((m) => m.binary).length >= 2)
    w.send({ type: 'result', stream: open.stream, text: '둘째 말', startMs: 100, endMs: 200, procMs: 40 })
    expect(await consoleFlow.message('result')).toMatchObject({ text: '둘째 말', startMs: 5_000, endMs: 5_100 })
  })
  it('AC-LV1-13 29초 늦음은 알림 없음, 30초를 넘으면 late', async () => {
    const { world, feed, url } = await setup()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await worker(url, world)
    await watch(world, seller.cookie, b.id)
    await waitFor(() => feed.sink !== undefined)
    feed.sink!.chunk(Buffer.alloc(3_200), world.clock.now() - 29_000)
    expect(await phase(world, seller.cookie, b.id)).toEqual({ phase: 'listening', lagMs: 29_000, late: false })
    feed.sink!.chunk(Buffer.alloc(3_200), world.clock.now() - 30_001)
    expect(await phase(world, seller.cookie, b.id)).toMatchObject({ phase: 'listening', late: true })
  })
  it('RA-LV1-01 조각 시각을 모르면 늦음을 숨기고, 조각이 8초 안 오면 끊김으로 다시 잇는다', async () => {
    const { world, feed, timer, url } = await setup()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await worker(url, world)
    await watch(world, seller.cookie, b.id)
    await waitFor(() => feed.sink !== undefined)
    feed.sink!.chunk(Buffer.alloc(3_200))
    expect(await phase(world, seller.cookie, b.id)).toEqual({ phase: 'listening' })
    world.clock.advance(7_000)
    expect(timer.runStall()).toBe(1)
    expect((await phase(world, seller.cookie, b.id)).phase).toBe('listening')
    world.clock.advance(1_000)
    expect(timer.runStall()).toBe(1)
    expect((await phase(world, seller.cookie, b.id)).phase).toBe('reconnecting')
    expect(feed.sinks).toEqual([])
    expect(timer.runRetries()).toEqual([1_000])
    await waitFor(() => feed.sink !== undefined)
  })
  it('RA-LV1-03 끝남·멈춤·못 받음인 흐름은 다른 방송 watch가 오면 바로 바꾼다', async () => {
    const { world, feed, url, setLocation } = await setup({ location: () => ({ kind: 'unsupported' }) })
    const seller = await addSeller(world)
    const b1 = await createBroadcast(world, seller)
    await worker(url, world)
    await watch(world, seller.cookie, b1.id)
    await waitFor(async () => (await phase(world, seller.cookie, b1.id)).phase === 'unsupported')
    const b2 = await createBroadcast(world, seller, { title: '둘째' })
    setLocation(() => ({ kind: 'ok', url: 'https://manifest.googlevideo.com/x' }))
    await watch(world, seller.cookie, b2.id)
    await waitFor(() => feed.sink !== undefined)
    expect((await phase(world, seller.cookie, b1.id)).phase).toBe('idle')
  })
  it('RA-LV1-04 일꾼 연결이 닫힌 뒤 바깥 흐름을 닫아도 close를 보내지 않고 오류가 없다', async () => {
    const { world, url } = await setup()
    const w = await worker(url, world)
    const lost: number[] = []
    const stream = world.server.voice.openExternal(() => {}, () => lost.push(1))
    if (typeof stream === 'string') throw new Error(stream)
    await w.message('open')
    w.ws.close()
    await waitFor(() => lost.length === 1)
    expect(stream.send(Buffer.alloc(3_200))).toBe(false)
    expect(() => stream.close()).not.toThrow()
    expect(w.messages.filter((m) => !m.binary && (m.body as { type: string }).type === 'close')).toEqual([])
  })
  it('늦은 조각은 lagMs로 알린다', async () => {
    const { world, feed, url } = await setup()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await worker(url, world)
    await watch(world, seller.cookie, b.id)
    await waitFor(() => feed.sink !== undefined)
    feed.sink!.chunk(Buffer.alloc(3_200), world.clock.now() - 25_000)
    const view = await phase(world, seller.cookie, b.id)
    expect(view.phase).toBe('listening')
    expect(view.lagMs).toBeGreaterThan(20_000)
  })
  it('마이크를 켜면 방송 소리 흐름이 닫히고(mic), 끄면 돌아온다 — 한 번에 흐름 하나', async () => {
    const { world, feed, url } = await setup()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const w = await worker(url, world, 1)
    await watch(world, seller.cookie, b.id)
    await waitFor(() => feed.sink !== undefined)
    feed.sink!.chunk(Buffer.alloc(3_200), Date.now())
    const first = await w.message('open')
    const mic = device(url, seller.cookie, b.id, 'phonemic01')
    await waitFor(() => mic.messages.length > 0)
    expect(mic.messages.map((m) => m.body)).toContainEqual({ type: 'ready' })
    expect(await w.message('close')).toEqual({ type: 'close', stream: first.stream })
    expect(feed.sinks).toEqual([])
    expect((await phase(world, seller.cookie, b.id)).phase).toBe('mic')
    expect(world.server.voice.status().streams).toBe(1)
    mic.ws.close()
    await waitFor(() => feed.sink !== undefined)
    feed.sink!.chunk(Buffer.alloc(3_200), Date.now())
    expect((await w.message('open')).stream).not.toBe(first.stream)
    expect((await phase(world, seller.cookie, b.id)).phase).toBe('listening')
  })
  it('끊기면 다시 잇는 중, 60초 안 여섯 번째 끊김에 멈추고 다시 켜기로 다시 연다. 끊긴 동안 소리는 버린다', async () => {
    const { world, feed, timer, url } = await setup()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await worker(url, world)
    await watch(world, seller.cookie, b.id)
    const delays: number[] = []
    for (let i = 0; i < 5; i++) {
      await waitFor(() => feed.sink !== undefined)
      const sink = feed.sink!
      sink.fail()
      expect(feed.sinks).toEqual([])
      expect((await phase(world, seller.cookie, b.id)).phase).toBe('reconnecting')
      sink.chunk(Buffer.alloc(3_200), Date.now())
      delays.push(...timer.runRetries())
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 8_000])
    await waitFor(() => feed.sink !== undefined)
    feed.sink!.fail()
    expect((await phase(world, seller.cookie, b.id)).phase).toBe('stopped')
    expect(timer.runRetries()).toEqual([])
    expect((await client(world, seller.cookie).post(`/api/broadcasts/${b.id}/stream-audio/restart`, {})).status).toBe(200)
    await waitFor(() => feed.sink !== undefined)
    expect(feed.opened).toBe(7)
  })
  it('소리를 받을 수 없는 방송·방송 끝·이은 링크 없음', async () => {
    const { world, feed, url, setLocation } = await setup({ location: () => ({ kind: 'unsupported' }) })
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await worker(url, world)
    await watch(world, seller.cookie, b.id)
    await waitFor(async () => (await phase(world, seller.cookie, b.id)).phase === 'unsupported')
    expect(feed.opened).toBe(0)
    setLocation(() => ({ kind: 'ok', url: 'https://manifest.googlevideo.com/x' }))
    await client(world, seller.cookie).post(`/api/broadcasts/${b.id}/stream-audio/restart`, {})
    await waitFor(() => feed.sink !== undefined)
    await client(world, seller.cookie).post(`/api/broadcasts/${b.id}/end`, { requestId: 'end-1' })
    await waitFor(() => feed.sinks.length === 0)
    expect((await phase(world, seller.cookie, b.id)).phase).toBe('ended')
  })
  it('운영자 끔이면 hidden·설정 칸 없음(available false), 판매자 설정 끔이면 소리를 열지 않는다', async () => {
    const off = await setup({ on: false })
    const s1 = await addSeller(off.world)
    const b1 = await createBroadcast(off.world, s1)
    expect(await watch(off.world, s1.cookie, b1.id)).toEqual({ phase: 'hidden' })
    expect((await client(off.world, s1.cookie).get('/api/settings/stream-audio')).body).toEqual({ available: false, enabled: true })
    expect(off.feed.opened).toBe(0)
    const on = await setup()
    const s2 = await addSeller(on.world)
    const b2 = await createBroadcast(on.world, s2)
    expect((await client(on.world, s2.cookie).put('/api/settings/stream-audio', { enabled: false })).body).toEqual({ available: true, enabled: false })
    expect((await client(on.world, s2.cookie).put('/api/settings/stream-audio', { enabled: 'no' })).status).toBe(400)
    expect(await watch(on.world, s2.cookie, b2.id)).toEqual({ phase: 'off' })
    expect(on.feed.opened).toBe(0)
    const other = await addSeller(on.world)
    expect((await client(on.world, other.cookie).get(`/api/broadcasts/${b2.id}/stream-audio`)).status).toBe(404)
  })
  it('연습: 가짜 방송 소리 + 모의 일꾼으로 버튼 없이 "15번 핑크프릴 이만 원"이 그 방송 콘솔에 온다', async () => {
    const database = await openTestDb()
    const fake = new FakeBroadcastAudio(database.db)
    const live = startServer(database, generateMasterKey(), { transcribeWorkerToken: TOKEN, streamAudio: { on: true, feed: fake, locate: async () => ({ kind: 'ok', url: 'fake:live' }) } })
    worlds.push(live)
    const server = createNodeServer({ app: live.server.app })
    servers.push(server)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('주소 없음')
    const url = `ws://127.0.0.1:${address.port}`
    const w = startMockWorker({ url: `${url}/api/voice/worker`, token: TOKEN })
    cleanups.push(() => w.close())
    await waitFor(() => live.server.voice.status().workers === 1)
    const seller = await addSeller(live)
    const b = await createBroadcast(live, seller)
    const consoleFlow = device(url, seller.cookie, b.id, 'consolepc01', false)
    await consoleFlow.message('ready')
    consoleFlow.send({ type: 'voice.session', op: 'hello', context: { now: live.clock.now(), dialogOpen: false, smsAutoAllowed: true, consent: true } })
    await watch(live, seller.cookie, b.id)
    expect(await consoleFlow.message('result')).toMatchObject({ type: 'result', text: PRACTICE_SPEECH })
    // 늦은 글로 빠지지 않고 바로 등록 효과가 온다 — 15번 핑크프릴 20,000원 (AC-LV1-01)
    const effect = await consoleFlow.matching((value) => value.type === 'voice.effect' && value.method === 'register')
    expect(JSON.stringify(effect.args)).toContain('"no":15')
    expect(JSON.stringify(effect.args)).toContain('"price":20000')
    expect(JSON.stringify(effect.args)).toContain('핑크프릴')
    expect((await phase(live, seller.cookie, b.id)).phase).toBe('listening')
    expect(await dumpAllTables(live.database)).not.toContain(PRACTICE_SPEECH)
  })
  it('가짜 방송 소리: 이은 링크가 없으면 none, 끊기·되살리기·못 받는 방송', async () => {
    const { world } = await setup()
    const fake = new FakeBroadcastAudio(world.database.db)
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    expect(await fake.locate(seller.sellerId, b.id)).toEqual({ kind: 'none' })
  })
})

describe('D-LV1-11 페이지에 HLS가 없으면 yt-dlp로 소리 주소', () => {
  const ID = 'abcDEF_-123'
  const HLS = 'https://manifest.googlevideo.com/api/manifest/hls_playlist/a/index.m3u8'
  const livePage = (hlsUrl?: string) => ({ page: async (videoId: string) => ({ state: 'LIVE' as const, videoId, channelId: 'UCx', channelTitle: null, title: null, startedAt: null, ...(hlsUrl === undefined ? {} : { hlsUrl }) }) })

  it('yt-dlp는 셸 없이 인자 배열·60초 제한으로 부르고 출력 첫 줄을 쓴다. 없음·시간 넘김·봇 확인 막힘·실패·이상한 출력은 종류만', async () => {
    const calls: { file: string; args: readonly string[]; options: Parameters<ExecFileRunner>[2] }[] = []
    let reply: Parameters<Parameters<ExecFileRunner>[3]> = [null, `${HLS}\nhttps://second.googlevideo.com/b\n`, '']
    const run: ExecFileRunner = (file, args, options, callback) => { calls.push({ file, args, options }); queueMicrotask(() => callback(...reply)) }
    const resolve = ytDlpResolver('/opt/yt-dlp', run)
    expect(await resolve(ID)).toEqual({ kind: 'ok', url: HLS })
    expect(calls[0]!.file).toBe('/opt/yt-dlp')
    expect(calls[0]!.args).toEqual(['--ignore-config', '--no-playlist', '--no-warnings', '-g', '-f', 'bestaudio/best', '--', `https://www.youtube.com/watch?v=${ID}`])
    expect(calls[0]!.options).toMatchObject({ timeout: 60_000, shell: false })
    const fail = (fields: { code?: unknown; killed?: boolean }) => Object.assign(new Error('x'), fields)
    reply = [fail({ code: 'ENOENT' }), '', '']
    expect(await resolve(ID)).toEqual({ kind: 'missing' })
    reply = [fail({ killed: true }), '', '']
    expect(await resolve(ID)).toEqual({ kind: 'timeout' })
    reply = [fail({ code: 1 }), '', "ERROR: [youtube] abc: Sign in to confirm you're not a bot."]
    expect(await resolve(ID)).toEqual({ kind: 'blocked' })
    reply = [fail({ code: 1 }), '', 'ERROR: something else']
    expect(await resolve(ID)).toEqual({ kind: 'failed' })
    reply = [null, 'https://evil.test/a.m3u8\n', '']
    expect(await resolve(ID)).toEqual({ kind: 'bad_output' })
    const before = calls.length
    for (const bad of ['short', 'abcDEF_-123; rm', '--exec=abcde']) expect(await resolve(bad)).toEqual({ kind: 'failed' })
    expect(calls.length).toBe(before)
    expect(readYtDlpPath({})).toBe('yt-dlp')
    expect(readYtDlpPath({ LIVEJJIM_YTDLP_PATH: ' /usr/local/bin/yt-dlp ' })).toBe('/usr/local/bin/yt-dlp')
  })

  it('페이지에 HLS가 있으면 yt-dlp를 부르지 않고, 없으면 yt-dlp 주소. 실패는 종류만 로그에 남기고 대비 안내(못 받음)로', async () => {
    let asked = 0
    let next: AudioUrlResult = { kind: 'ok', url: HLS }
    const resolve = async (videoId: string) => { asked++; expect(videoId).toBe(ID); return next }
    const logs: LogRecord[] = []
    expect(await locateFromPage(livePage('https://manifest.googlevideo.com/page.m3u8'), ID, { resolve })).toEqual({ kind: 'ok', url: 'https://manifest.googlevideo.com/page.m3u8' })
    expect(asked).toBe(0)
    expect(await locateFromPage(livePage(), ID, { resolve })).toEqual({ kind: 'ok', url: HLS })
    expect(asked).toBe(1)
    expect(await locateFromPage(livePage(), ID, { resolve: null })).toEqual({ kind: 'unsupported' })
    for (const kind of ['missing', 'blocked', 'failed', 'bad_output'] as const) {
      next = { kind }
      expect(await locateFromPage(livePage(), ID, { resolve, log: (r) => logs.push(r), sellerId: 's1' })).toEqual({ kind: 'unsupported' })
    }
    next = { kind: 'timeout' }
    expect(await locateFromPage(livePage(), ID, { resolve, log: (r) => logs.push(r), sellerId: 's1' })).toEqual({ kind: 'retry' })
    expect(logs.map((l) => l.reason)).toEqual(['MISSING', 'BLOCKED', 'FAILED', 'BAD_OUTPUT', 'TIMEOUT'])
    expect(logs.every((l) => l.code === 'STREAM_AUDIO_YTDLP_FAILED' && l.seller === 's1')).toBe(true)
    expect(JSON.stringify(logs)).not.toContain(ID)
  })

  it('D-LIVETEST-12 방송 페이지가 봇 확인으로 막히면(데이터센터 IP) 페이지를 다시 보지 않고 yt-dlp(집 회선 프록시)로 묻는다. yt-dlp가 없으면 잠시 뒤 다시', async () => {
    let asked = 0
    const resolve = async (videoId: string): Promise<AudioUrlResult> => { asked++; expect(videoId).toBe(ID); return { kind: 'ok', url: HLS } }
    const blockedPage = { page: async (videoId: string) => ({ state: 'BLOCKED' as const, videoId, channelId: null, channelTitle: null, title: null, startedAt: null }) }
    expect(await locateFromPage(blockedPage, ID, { resolve })).toEqual({ kind: 'ok', url: HLS })
    expect(asked).toBe(1)
    expect(await locateFromPage(blockedPage, ID, { resolve: null })).toEqual({ kind: 'retry' })
    expect(await locateFromPage(blockedPage, ID, { resolve: async () => ({ kind: 'proxy_down' }) })).toEqual({ kind: 'unsupported' })
  })

  it('yt-dlp 주소로 소리를 열고, 끊기면(주소 만료) 다시 yt-dlp를 불러 새 주소로 이어 받는다. yt-dlp가 막히면 대비 안내', async () => {
    const urls: string[] = []
    const sinks: AudioSink[] = []
    const feed = { open: (url: string, sink: AudioSink) => { urls.push(url); sinks.push(sink); return { close: () => {} } } }
    const timer = new ManualSchedule()
    let n = 0
    let next: () => AudioUrlResult = () => ({ kind: 'ok', url: `https://manifest.googlevideo.com/hls_playlist/expire/${++n}/index.m3u8` })
    const world = await newWorld({
      transcribeWorkerToken: TOKEN,
      streamAudio: { on: true, feed, locate: () => locateFromPage(livePage(), ID, { resolve: async () => next() }), schedule: timer.schedule },
    })
    worlds.push(world)
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    await watch(world, seller.cookie, b.id)
    await waitFor(() => urls.length === 1)
    expect(urls[0]).toBe('https://manifest.googlevideo.com/hls_playlist/expire/1/index.m3u8')
    sinks[0]!.fail()
    expect((await phase(world, seller.cookie, b.id)).phase).toBe('reconnecting')
    expect(timer.runRetries()).toEqual([1_000])
    await waitFor(() => urls.length === 2)
    expect(urls[1]).toBe('https://manifest.googlevideo.com/hls_playlist/expire/2/index.m3u8')
    next = () => ({ kind: 'blocked' })
    sinks[1]!.fail()
    expect(timer.runRetries()).toEqual([2_000])
    await waitFor(async () => (await phase(world, seller.cookie, b.id)).phase === 'unsupported')
    expect(urls.length).toBe(2)
    expect(world.logs.some((l) => l.code === 'STREAM_AUDIO_UNSUPPORTED')).toBe(true)
  })
})

describe('D-LV1-13 집 회선 프록시 (yt-dlp·ffmpeg 같은 출구)', () => {
  const ID = 'abcDEF_-123'
  const HLS = 'https://manifest.googlevideo.com/api/manifest/hls_playlist/a/index.m3u8'
  const livePage = () => ({ page: async (videoId: string) => ({ state: 'LIVE' as const, videoId, channelId: 'UCx', channelTitle: null, title: null, startedAt: null }) })

  it('프록시 값은 이 기계 안 터널 끝(http://127.0.0.1·localhost·host.docker.internal:<포트>)만 받고, 그 밖은 거절', () => {
    expect(readMediaProxy({})).toEqual({ kind: 'none' })
    expect(readMediaProxy({ LIVEJJIM_YT_MEDIA_PROXY: '  ' })).toEqual({ kind: 'none' })
    expect(readMediaProxy({ LIVEJJIM_YT_MEDIA_PROXY: ' http://127.0.0.1:18888 ' })).toEqual({ kind: 'ok', url: 'http://127.0.0.1:18888' })
    expect(readMediaProxy({ LIVEJJIM_YT_MEDIA_PROXY: 'http://localhost:8888/' })).toEqual({ kind: 'ok', url: 'http://localhost:8888' })
    expect(readMediaProxy({ LIVEJJIM_YT_MEDIA_PROXY: 'http://host.docker.internal:18888' })).toEqual({ kind: 'ok', url: 'http://host.docker.internal:18888' })
    for (const bad of [
      'http://10.0.0.5:8888', 'http://proxy.example.com:8080', 'https://127.0.0.1:18888', 'socks5://127.0.0.1:1080',
      'http://user:pw@127.0.0.1:18888', 'http://127.0.0.1', 'http://127.0.0.1:18888/x', 'http://127.0.0.1:18888?a=1',
      'http://127.0.0.2:18888', 'http://[::1]:18888', 'http://127.0.0.1.evil.test:18888', '127.0.0.1:18888', 'not a url',
    ]) expect(readMediaProxy({ LIVEJJIM_YT_MEDIA_PROXY: bad }), bad).toEqual({ kind: 'rejected' })
  })

  it('프록시가 있으면 yt-dlp에 --proxy, ffmpeg에 -http_proxy와 허용 목록 httpproxy(평문 http는 여전히 뺌). 없으면 지금과 같다', async () => {
    const calls: (readonly string[])[] = []
    const run: ExecFileRunner = (_file, args, _options, callback) => { calls.push(args); queueMicrotask(() => callback(null, `${HLS}\n`, '')) }
    expect(await ytDlpResolver('yt-dlp', run, 'http://127.0.0.1:18888')(ID)).toEqual({ kind: 'ok', url: HLS })
    expect(calls[0]).toEqual(['--ignore-config', '--no-playlist', '--no-warnings', '--proxy', 'http://127.0.0.1:18888', '-g', '-f', 'bestaudio/best', '--', `https://www.youtube.com/watch?v=${ID}`])
    await ytDlpResolver('yt-dlp', run)(ID)
    expect(calls[1]).not.toContain('--proxy')
    const withProxy = ffmpegArgs(HLS, 'http://127.0.0.1:18888')
    expect(withProxy.slice(withProxy.indexOf('-http_proxy'), withProxy.indexOf('-http_proxy') + 2)).toEqual(['-http_proxy', 'http://127.0.0.1:18888'])
    expect(withProxy.indexOf('-http_proxy')).toBeLessThan(withProxy.indexOf('-i'))
    expect(withProxy[withProxy.indexOf('-protocol_whitelist') + 1]).toBe('https,tls,tcp,crypto,hls,httpproxy')
    const direct = ffmpegArgs(HLS)
    expect(direct).not.toContain('-http_proxy')
    expect(direct[direct.indexOf('-protocol_whitelist') + 1]).toBe('https,tls,tcp,crypto,hls')
    expect(direct[direct.indexOf('-i') + 1]).toBe(HLS)
  })

  it('프록시에 닿지 못하면(연결 거부·터널 거절) BLOCKED가 아닌 PROXY_DOWN — 운영자 경보 한 줄, 판매자는 휴대폰 마이크 안내(못 받음)', async () => {
    let stderr = ''
    const run: ExecFileRunner = (_file, _args, _options, callback) => queueMicrotask(() => callback(Object.assign(new Error('x'), { code: 1 }), '', stderr))
    const proxied = ytDlpResolver('yt-dlp', run, 'http://127.0.0.1:18888')
    stderr = `ERROR: [youtube] ${ID}: Unable to download API page: ('Unable to connect to proxy', NewConnectionError("[Errno 111] Connection refused")) (caused by ProxyError(...))`
    expect(await proxied(ID)).toEqual({ kind: 'proxy_down' })
    stderr = 'ERROR: Tunnel connection failed: 403 Filtered'
    expect(await proxied(ID)).toEqual({ kind: 'proxy_down' })
    // 터널은 살아 있는데 집 쪽 tinyproxy가 꺼짐: 받자마자 끊긴다
    stderr = `ERROR: [youtube] ${ID}: Unable to download API page: ('Connection aborted.', ConnectionResetError(54, 'Connection reset by peer'))`
    expect(await proxied(ID)).toEqual({ kind: 'proxy_down' })
    stderr = "ERROR: [youtube] abc: Sign in to confirm you're not a bot."
    expect(await proxied(ID)).toEqual({ kind: 'blocked' })
    // 프록시를 쓰지 않으면 같은 글이 있어도 프록시 끊김으로 보지 않는다
    stderr = 'ERROR: Unable to connect to proxy'
    expect(await ytDlpResolver('yt-dlp', run)(ID)).toEqual({ kind: 'failed' })

    const logs: LogRecord[] = []
    const location = await locateFromPage(livePage(), ID, { resolve: async () => ({ kind: 'proxy_down' }), log: (r) => logs.push(r), sellerId: 's1' })
    expect(location).toEqual({ kind: 'unsupported' })
    expect(logs).toEqual([{ level: 'alert', code: 'STREAM_AUDIO_PROXY_DOWN', seller: 's1' }])
  })

  it('허용하지 않는 프록시 값은 쓰지 않고 시작 기록 한 줄(값은 남기지 않음), 서버는 그대로 뜬다', async () => {
    const feed = { open: (_url: string, sink: AudioSink) => { queueMicrotask(() => sink.fail()); return { close: () => {} } } }
    const world = await newWorld({ transcribeWorkerToken: TOKEN, streamAudio: { on: true, feed, mediaProxy: readMediaProxy({ LIVEJJIM_YT_MEDIA_PROXY: 'http://proxy.example.com:8080' }) } })
    worlds.push(world)
    expect(world.logs.filter((l) => l.code === 'STREAM_AUDIO_PROXY_IGNORED')).toEqual([{ level: 'warn', code: 'STREAM_AUDIO_PROXY_IGNORED' }])
    expect(JSON.stringify(world.logs)).not.toContain('proxy.example.com')
  })
})

describe('D-UX3-16 틱톡 라이브 소리 (yt-dlp, 프록시 없이)', () => {
  const TT = 'https://pull-hls-f16-va01.tiktokcdn.com/stage/stream-1_ld/index.m3u8?expire=1'
  it('틱톡 아이디만 넘겨 HLS를 먼저 고르고, 라이브 아님·이상한 출력·틀린 아이디는 종류만. 프록시를 붙이지 않는다', async () => {
    const calls: (readonly string[])[] = []
    let reply: Parameters<Parameters<ExecFileRunner>[3]> = [null, `${TT}\n`, '']
    const run: ExecFileRunner = (_file, args, _options, callback) => { calls.push(args); queueMicrotask(() => callback(...reply)) }
    const resolve = ytDlpTiktokResolver('yt-dlp', run)
    expect(await resolve('my.shop_1')).toEqual({ kind: 'ok', url: TT })
    expect(calls[0]).toEqual(['--ignore-config', '--no-playlist', '--no-warnings', '-g', '-f', 'bestaudio[protocol^=m3u8]/best[protocol^=m3u8]/bestaudio/best', '--', 'https://www.tiktok.com/@my.shop_1/live'])
    reply = [Object.assign(new Error('x'), { code: 1 }), '', 'ERROR: [tiktok:live] my.shop_1: The channel is not currently live']
    expect(await resolve('my.shop_1')).toEqual({ kind: 'not_live' })
    reply = [null, 'https://evil.test/a.m3u8\n', '']
    expect(await resolve('my.shop_1')).toEqual({ kind: 'bad_output' })
    const before = calls.length
    expect(await resolve('@x y')).toEqual({ kind: 'failed' })
    expect(await resolve('--exec=rm')).toEqual({ kind: 'failed' })
    expect(calls.length).toBe(before)
    expect(safeTiktokMediaUrl('http://pull-f5.tiktokcdn.com/a.flv')).toBeNull()
    expect(safeTiktokMediaUrl('https://pull-f5-tt03.fcdn.eu.tiktokcdn-eu.com/a.flv')).not.toBeNull()
    expect(safeTiktokMediaUrl('https://tiktokcdn.com.evil.test/a.flv')).toBeNull()
  })
  it('라이브 시작 전에는 같은 아이디를 15초 동안 다시 묻지 않는다', async () => {
    let now = 1_000_000
    let asked = 0
    let live = false
    const inner: TiktokAudioUrlResolver = async () => { asked++; return live ? { kind: 'ok', url: TT } : { kind: 'not_live' } }
    const resolve = notLiveBackoff(inner, () => now)
    expect(await resolve('a')).toEqual({ kind: 'not_live' })
    now += 3_000
    expect(await resolve('a')).toEqual({ kind: 'not_live' })
    expect(asked).toBe(1)
    live = true
    now += TIKTOK_NOT_LIVE_WAIT_MS
    expect(await resolve('a')).toEqual({ kind: 'ok', url: TT })
    expect(asked).toBe(2)
  })
  it('ffmpeg: HLS가 아닌 틱톡 주소(flv)에는 HLS 전용 옵션을 주지 않는다', () => {
    expect(ffmpegArgs(TT)).toContain('-live_start_index')
    const flv = ffmpegArgs('https://pull-flv-l1-va01.tiktokcdn.com/stage/stream-1.flv')
    expect(flv).not.toContain('-live_start_index')
    expect(flv.slice(flv.indexOf('-i'))[1]).toBe('https://pull-flv-l1-va01.tiktokcdn.com/stage/stream-1.flv')
  })
  it('유튜브를 잇지 않은 회차에 틱톡이 이어져 있으면 그 계정 소리. 라이브 전은 기다림, 끊으면 없음', async () => {
    const world = await newWorld({})
    worlds.push(world)
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const asked: string[] = []
    let reply: AudioUrlResult = { kind: 'not_live' }
    const tiktok: TiktokAudioUrlResolver = async (id) => { asked.push(id); return reply }
    const logs: LogRecord[] = []
    const locate = webStreamLocator(world.database.db, null, { tiktok, log: (r) => logs.push(r) })
    expect(await locate(seller.sellerId, b.id)).toEqual({ kind: 'none' })
    expect(asked).toEqual([])
    const [row] = await world.database.db.select({ scopeId: broadcasts.scopeId }).from(broadcasts).where(eq(broadcasts.id, b.id))
    const linkId = await insertTiktokLink(world.database.db, { sellerId: seller.sellerId, broadcastId: b.id, scopeId: row!.scopeId, tiktokId: 'my.shop', actorAccountId: seller.accountId, now: new Date() })
    expect(await locate(seller.sellerId, b.id)).toEqual({ kind: 'none' })
    expect(asked).toEqual(['my.shop'])
    reply = { kind: 'ok', url: TT }
    expect(await locate(seller.sellerId, b.id)).toEqual({ kind: 'ok', url: TT })
    reply = { kind: 'timeout' }
    expect(await locate(seller.sellerId, b.id)).toEqual({ kind: 'retry' })
    reply = { kind: 'failed' }
    expect(await locate(seller.sellerId, b.id)).toEqual({ kind: 'unsupported' })
    expect(logs.at(-1)).toMatchObject({ code: 'STREAM_AUDIO_YTDLP_FAILED', reason: 'TIKTOK_FAILED' })
    expect(JSON.stringify(logs)).not.toContain('my.shop')
    expect(await webStreamLocator(world.database.db, null, {})(seller.sellerId, b.id)).toEqual({ kind: 'unsupported' })
    await unlinkTiktokLink(world.database.db, seller.sellerId, linkId, seller.accountId, new Date())
    asked.length = 0
    expect(await locate(seller.sellerId, b.id)).toEqual({ kind: 'none' })
    expect(asked).toEqual([])
  })
})
