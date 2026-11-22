// 소리 듣기 (D-RETRO-70·71 → D-LISTEN-MIC-01, 사용자 지시 2026-11-23 "소리 듣기 없애. 그냥 무조건 폰 마이크로 듣는 걸로"):
// 듣는 곳은 늘 휴대폰 마이크다 — 라이브 소리는 고를 수 없다(옛 앱이 보내면 409, 남긴 값은 마이크 그대로).
// 서버가 방송 소리를 듣는 규칙(D-LV1-06 — 마이크가 켜지면 쉬고 꺼지면 돌아온다)은 그대로다.
import { once } from 'node:events'
import type { Server } from 'node:http'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { sellers } from '../src/db/schema.ts'
import { createNodeServer } from '../src/node-server.ts'
import type { AudioSink } from '../src/voice/stream-audio.ts'
import { addSeller, client, createBroadcast, newWorld, ORIGIN, waitFor, type TestServer } from './support.ts'

const TOKEN = 'test-worker-token-not-used-outside-tests'
const worlds: TestServer[] = []
const sockets: WebSocket[] = []
const servers: Server[] = []
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate()
  for (const world of worlds.splice(0)) { world.server.close(); await world.database.close() }
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

/** 손으로 조각을 넣는 가짜 소리 받기 */
class ManualFeed {
  readonly sinks: AudioSink[] = []
  open(_url: string, sink: AudioSink) { this.sinks.push(sink); return { close: () => { const i = this.sinks.indexOf(sink); if (i >= 0) this.sinks.splice(i, 1) } } }
  get sink(): AudioSink | undefined { return this.sinks[this.sinks.length - 1] }
}

async function setup(on = true) {
  const feed = new ManualFeed()
  const world = await newWorld({
    transcribeWorkerToken: TOKEN,
    streamAudio: { on, feed, locate: async () => ({ kind: 'ok' as const, url: 'https://manifest.googlevideo.com/x.m3u8' }), schedule: () => () => undefined },
  })
  worlds.push(world)
  return { world, feed }
}
const SOURCE = '/api/settings/listen-source'
const STREAM = '/api/settings/stream-audio'
const saved = async (world: TestServer, sellerId: string) =>
  (await world.database.db.select({ source: sellers.listenSource, stream: sellers.streamAudio }).from(sellers).where(eq(sellers.id, sellerId)))[0]

const REFUSED = { code: 'NOT_SUPPORTED', message: '이제 휴대폰 마이크로만 들어요. 앱을 업데이트해 주세요.' }

describe('D-LISTEN-MIC-01 듣는 곳은 늘 휴대폰 마이크 (옛 D-RETRO-70 고르기)', () => {
  it('처음에도 휴대폰 마이크. 라이브 소리를 고르면 받지 않고, 휴대폰 마이크는 그대로 받는다', async () => {
    const { world } = await setup()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    expect((await api.get(SOURCE)).body).toEqual({ source: 'mic', streamAvailable: true, streamEnabled: true })
    const refused = await api.put(SOURCE, { source: 'stream' })
    expect(refused.status).toBe(409)
    expect((refused.body as { error: unknown }).error).toEqual(REFUSED)
    expect((await api.get(SOURCE)).body).toEqual({ source: 'mic', streamAvailable: true, streamEnabled: true })
    expect((await api.put(SOURCE, { source: 'mic' })).body).toEqual({ source: 'mic', streamAvailable: true, streamEnabled: true })
    // 라이브 소리 듣기는 켜 둔다 — 마이크가 꺼지면 넘어갈 곳 (D-LV1-06)
    expect(await saved(world, seller.sellerId)).toEqual({ source: 'mic', stream: true })
  })

  it('예전에 라이브 소리를 골라 둔 판매자도 휴대폰 마이크로 읽힌다', async () => {
    const { world } = await setup()
    const seller = await addSeller(world)
    await world.database.db.update(sellers).set({ listenSource: 'stream' }).where(eq(sellers.id, seller.sellerId))
    expect((await client(world, seller.cookie).get(SOURCE)).body).toEqual({ source: 'mic', streamAvailable: true, streamEnabled: true })
  })

  it('둘 가운데 하나가 아니거나 다른 값이 섞이면 받지 않는다', async () => {
    const { world } = await setup()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    for (const body of [{}, { source: 'web' }, { source: true }, { source: null }, { source: 'mic', enabled: false }, { enabled: true }]) {
      const response = await api.put(SOURCE, body)
      expect(response.status).toBe(400)
      expect((response.body as { error: { code: string; message: string } }).error).toEqual({ code: 'INVALID_INPUT', message: '휴대폰 마이크와 라이브 소리 가운데 하나를 골라 주세요.' })
    }
    expect(await saved(world, seller.sellerId)).toEqual({ source: 'mic', stream: true })
  })

  it('로그인하지 않으면 읽지도 바꾸지도 못한다', async () => {
    const { world } = await setup()
    expect((await client(world, null).get(SOURCE)).status).toBe(401)
    expect((await client(world, null).put(SOURCE, { source: 'stream' })).status).toBe(401)
  })
})

describe('D-RETRO-71 웹 설정의 라이브 소리 스위치와 같은 값', () => {
  it('웹에서 라이브 소리를 끄고 켜도 듣는 곳은 휴대폰 마이크 그대로다', async () => {
    const { world } = await setup()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    expect((await api.put(STREAM, { enabled: false })).body).toEqual({ available: true, enabled: false })
    expect(await saved(world, seller.sellerId)).toEqual({ source: 'mic', stream: false })
    expect((await api.get(SOURCE)).body).toEqual({ source: 'mic', streamAvailable: true, streamEnabled: false })
    expect((await api.put(STREAM, { enabled: true })).body).toEqual({ available: true, enabled: true })
    expect((await api.get(SOURCE)).body).toEqual({ source: 'mic', streamAvailable: true, streamEnabled: true })
  })

  it('휴대폰 마이크를 고르는 것은 라이브 소리 스위치를 건드리지 않는다', async () => {
    const { world } = await setup()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    await api.put(STREAM, { enabled: false })
    expect((await api.put(SOURCE, { source: 'mic' })).body).toEqual({ source: 'mic', streamAvailable: true, streamEnabled: false })
    expect((await api.get(STREAM)).body).toEqual({ available: true, enabled: false })
  })

  it('이 서버에서 라이브 소리를 쓸 수 없어도 휴대폰 마이크로 읽힌다', async () => {
    const { world } = await setup(false)
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    expect((await api.get(SOURCE)).body).toEqual({ source: 'mic', streamAvailable: false, streamEnabled: true })
    const refused = await api.put(SOURCE, { source: 'stream' })
    expect(refused.status).toBe(409)
    expect((refused.body as { error: unknown }).error).toEqual(REFUSED)
    expect(await saved(world, seller.sellerId)).toEqual({ source: 'mic', stream: true })
  })
})

describe('D-LISTEN-MIC-01 서버가 듣는 규칙은 그대로 (D-LV1-06)', () => {
  class Peer {
    readonly ws: WebSocket
    readonly messages: Record<string, unknown>[] = []
    constructor(url: string, headers: Record<string, string>) {
      this.ws = new WebSocket(url, { headers })
      sockets.push(this.ws)
      this.ws.on('message', (data, binary) => { if (!binary) this.messages.push(JSON.parse(String(data)) as Record<string, unknown>) })
    }
    async open() { await once(this.ws, 'open'); return this }
    send(value: unknown) { this.ws.send(JSON.stringify(value)) }
  }
  const phase = async (world: TestServer, cookie: string, b: string) => ((await client(world, cookie).get(`/api/broadcasts/${b}/stream-audio`)).body as { phase: string }).phase

  for (const source of ['mic'] as const) {
    it('마이크가 꺼져 있으면 라이브 소리로 듣고, 마이크가 켜지면 쉬고, 꺼지면 돌아온다', async () => {
      const { world, feed } = await setup()
      const server = createNodeServer({ app: world.server.app })
      servers.push(server)
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('주소 없음')
      const url = `ws://127.0.0.1:${String(address.port)}`
      const seller = await addSeller(world)
      const b = await createBroadcast(world, seller)
      expect(((await client(world, seller.cookie).put(SOURCE, { source })).body as { source: string }).source).toBe(source)
      const worker = await new Peer(`${url}/api/voice/worker`, { Authorization: `Bearer ${TOKEN}` }).open()
      worker.send({ type: 'hello', maxStreams: 2 })
      await waitFor(() => world.server.voice.status().workers > 0)

      // 마이크가 꺼져 있다 — 방송 화면이 열리면(watch) 서버가 라이브 소리를 듣는다
      await client(world, seller.cookie).post(`/api/broadcasts/${b.id}/stream-audio/watch`, {})
      await waitFor(() => feed.sink !== undefined)
      feed.sink!.chunk(Buffer.alloc(3_200), Date.now())
      await waitFor(async () => (await phase(world, seller.cookie, b.id)) === 'listening')

      // 휴대폰 마이크가 켜지면 서버는 쉰다
      const mic = new Peer(`${url}/api/voice/stream?broadcastId=${encodeURIComponent(b.id)}&device=phonemic01`, { Origin: ORIGIN, Cookie: seller.cookie })
      await waitFor(() => mic.messages.some((message) => message.type === 'ready'))
      await waitFor(async () => (await phase(world, seller.cookie, b.id)) === 'mic')
      expect(feed.sinks).toEqual([])

      // 마이크가 꺼지면 라이브 소리로 돌아온다
      mic.ws.close()
      await waitFor(() => feed.sink !== undefined)
      feed.sink!.chunk(Buffer.alloc(3_200), Date.now())
      await waitFor(async () => (await phase(world, seller.cookie, b.id)) === 'listening')
      // 듣는 곳은 휴대폰 마이크 그대로
      expect(((await client(world, seller.cookie).get(SOURCE)).body as { source: string }).source).toBe(source)
    })
  }
})
