// 소리 듣기 고르기 (D-RETRO-70·71): 판매자가 고른 듣는 곳(휴대폰 마이크 · 라이브 소리)을 서버에 남긴다.
// 서버가 방송 소리를 듣는 규칙(D-LV1-06 — 마이크가 켜지면 쉬고 꺼지면 돌아온다)은 고른 값과 상관없이 그대로다.
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

describe('D-RETRO-70 소리 듣기 고르기 (서버 설정)', () => {
  it('처음에는 휴대폰 마이크. 라이브 소리를 고르면 남고, 다시 휴대폰 마이크로 돌릴 수 있다', async () => {
    const { world } = await setup()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    expect((await api.get(SOURCE)).body).toEqual({ source: 'mic', streamAvailable: true, streamEnabled: true })
    expect((await api.put(SOURCE, { source: 'stream' })).body).toEqual({ source: 'stream', streamAvailable: true, streamEnabled: true })
    expect((await api.get(SOURCE)).body).toEqual({ source: 'stream', streamAvailable: true, streamEnabled: true })
    expect(await saved(world, seller.sellerId)).toEqual({ source: 'stream', stream: true })
    expect((await api.put(SOURCE, { source: 'mic' })).body).toEqual({ source: 'mic', streamAvailable: true, streamEnabled: true })
    // 휴대폰 마이크로 돌려도 라이브 소리 듣기는 켜 둔다 — 마이크가 꺼지면 넘어갈 곳
    expect(await saved(world, seller.sellerId)).toEqual({ source: 'mic', stream: true })
  })

  it('판매자마다 따로 남는다', async () => {
    const { world } = await setup()
    const one = await addSeller(world)
    const two = await addSeller(world)
    await client(world, one.cookie).put(SOURCE, { source: 'stream' })
    expect(((await client(world, one.cookie).get(SOURCE)).body as { source: string }).source).toBe('stream')
    expect(((await client(world, two.cookie).get(SOURCE)).body as { source: string }).source).toBe('mic')
  })

  it('둘 가운데 하나가 아니거나 다른 값이 섞이면 받지 않고, 남긴 값은 그대로다', async () => {
    const { world } = await setup()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    await api.put(SOURCE, { source: 'stream' })
    for (const body of [{}, { source: 'web' }, { source: true }, { source: null }, { source: 'mic', enabled: false }, { enabled: true }]) {
      const response = await api.put(SOURCE, body)
      expect(response.status).toBe(400)
      expect((response.body as { error: { code: string; message: string } }).error).toEqual({ code: 'INVALID_INPUT', message: '휴대폰 마이크와 라이브 소리 가운데 하나를 골라 주세요.' })
    }
    expect(await saved(world, seller.sellerId)).toEqual({ source: 'stream', stream: true })
  })

  it('로그인하지 않으면 읽지도 바꾸지도 못한다', async () => {
    const { world } = await setup()
    expect((await client(world, null).get(SOURCE)).status).toBe(401)
    expect((await client(world, null).put(SOURCE, { source: 'stream' })).status).toBe(401)
  })
})

describe('D-RETRO-71 웹 설정의 라이브 소리 스위치와 같은 값', () => {
  it('라이브 소리가 꺼져 있을 때 라이브 소리를 고르면 스위치도 같이 켜진다', async () => {
    const { world } = await setup()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    expect((await api.put(STREAM, { enabled: false })).body).toEqual({ available: true, enabled: false })
    expect((await api.get(SOURCE)).body).toEqual({ source: 'mic', streamAvailable: true, streamEnabled: false })
    expect((await api.put(SOURCE, { source: 'stream' })).body).toEqual({ source: 'stream', streamAvailable: true, streamEnabled: true })
    expect((await api.get(STREAM)).body).toEqual({ available: true, enabled: true })
  })

  it('웹에서 라이브 소리를 끄면 고른 값도 휴대폰 마이크로 돌아가고, 다시 켜도 휴대폰 마이크 그대로다', async () => {
    const { world } = await setup()
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    await api.put(SOURCE, { source: 'stream' })
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

  it('이 서버에서 라이브 소리를 쓸 수 없으면 라이브 소리를 고를 수 없고, 휴대폰 마이크로 읽힌다', async () => {
    const { world } = await setup(false)
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    expect((await api.get(SOURCE)).body).toEqual({ source: 'mic', streamAvailable: false, streamEnabled: true })
    const refused = await api.put(SOURCE, { source: 'stream' })
    expect(refused.status).toBe(409)
    expect((refused.body as { error: { code: string; message: string } }).error).toEqual({ code: 'NOT_SUPPORTED', message: '지금은 라이브 소리로 들을 수 없어요. 휴대폰 마이크를 골라 주세요.' })
    expect(await saved(world, seller.sellerId)).toEqual({ source: 'mic', stream: true })
    // 예전에 라이브 소리를 골라 둔 판매자도 쓸 수 없는 동안에는 휴대폰 마이크로 읽힌다
    await world.database.db.update(sellers).set({ listenSource: 'stream' }).where(eq(sellers.id, seller.sellerId))
    expect((await api.get(SOURCE)).body).toEqual({ source: 'mic', streamAvailable: false, streamEnabled: true })
  })
})

describe('D-RETRO-70 고른 값과 상관없이 서버가 듣는 규칙은 그대로 (D-LV1-06)', () => {
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

  for (const source of ['mic', 'stream'] as const) {
    it(`${source === 'mic' ? '휴대폰 마이크' : '라이브 소리'}를 골랐을 때: 마이크가 꺼져 있으면 라이브 소리로 듣고, 마이크가 켜지면 쉬고, 꺼지면 돌아온다`, async () => {
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
      // 듣는 동안에도 고른 값은 남아 있다
      expect(((await client(world, seller.cookie).get(SOURCE)).body as { source: string }).source).toBe(source)
    })
  }
})
