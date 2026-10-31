import { once } from 'node:events'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { createNodeServer } from '../src/node-server.ts'
import { parseWatchPage } from '../src/youtube/web-chat.ts'
import { startMockWorker } from '../src/voice/mock-worker.ts'
import {
  FakeBroadcastAudio, MARKER_CHUNKS, PRACTICE_SPEECH, Rechunker, SILENT_CHUNK, markerChunk, readStreamAudioSwitch, recordFailure, retryDelayMs, safeHlsUrl,
  type AudioSink, type StreamLocation,
} from '../src/voice/stream-audio.ts'
import { generateMasterKey } from '../src/secrets.ts'
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
