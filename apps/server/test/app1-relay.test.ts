import { once } from 'node:events'
import { createServer as createHttpServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { createNodeServer } from '../src/node-server.ts'
import { workerTokenMatches } from '../src/voice/relay.ts'
import { createPhoneVoiceUpgrade } from '../src/try/phone-relay.ts'
import { addSeller, client, createBroadcast, dumpAllTables, newWorld, ORIGIN, waitFor, type TestServer } from './support.ts'

const TOKEN = 'test-worker-token-not-used-outside-tests'
const worlds: TestServer[] = []
const sockets: WebSocket[] = []
const servers: Server[] = []
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate()
  for (const world of worlds.splice(0)) { world.server.close(); await world.database.close() }
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})
async function setup(token: string | undefined = TOKEN) {
  const world = await newWorld({ ...(token === undefined ? {} : { transcribeWorkerToken: token }), opsToken: 'operations-test-token-32-characters' })
  worlds.push(world)
  const server = createNodeServer({ app: world.server.app })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('주소 없음')
  return { world, url: `ws://127.0.0.1:${address.port}` }
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
  async message(type: string) {
    await waitFor(() => this.messages.some((item) => !item.binary && (item.body as {type: string}).type === type))
    const index = this.messages.findIndex((item) => !item.binary && (item.body as {type: string}).type === type)
    return this.messages.splice(index, 1)[0]!.body
  }
  send(value: unknown) { this.ws.send(JSON.stringify(value)) }
  async matching(predicate: (value: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
    const matches = (item: typeof this.messages[number]) => !item.binary && predicate(item.body as Record<string, unknown>)
    await waitFor(() => this.messages.some(matches))
    return this.messages.splice(this.messages.findIndex(matches), 1)[0]!.body as Record<string, unknown>
  }
}
async function worker(url: string, world: TestServer, capacity = 4) {
  const peer = await new Peer(`${url}/api/voice/worker`, { Authorization: `Bearer ${TOKEN}` }).open()
  peer.send({ type: 'hello', maxStreams: capacity })
  await waitFor(() => world.server.voice.status().workers > 0)
  return peer
}
function device(url: string, cookie: string, b: string, id = 'testdevice01') {
  return new Peer(`${url}/api/voice/stream?broadcastId=${encodeURIComponent(b)}&device=${id}`, { Origin: ORIGIN, Cookie: cookie })
}

describe('APP1 받아쓰기 서버 실제 WebSocket', () => {
  it('상수 길이 해시 비교로 일꾼 토큰 없음·길이 다름·잘못된 값을 거절한다', async () => {
    expect(workerTokenMatches(TOKEN, TOKEN)).toBe(true)
    for (const value of [undefined, '', 'bad', `${TOKEN}x`]) expect(workerTokenMatches(TOKEN, value)).toBe(false)
    expect(workerTokenMatches(undefined, '')).toBe(false)
    const { url } = await setup()
    const peer = new Peer(`${url}/api/voice/worker`, { Authorization: 'Bearer wrong' })
    const [, response] = await once(peer.ws, 'unexpected-response')
    expect(response.statusCode).toBe(401)
    response.resume()
    peer.ws.terminate()
  })
  it('출처는 업그레이드 403, 세션 없음은 AUTH, 남의 방송·끝난 방송은 ENDED', async () => {
    const { world, url } = await setup()
    const seller = await addSeller(world)
    const other = await addSeller(world)
    const b = await createBroadcast(world, seller)
    const origins: Record<string, string>[] = [{}, { Origin: 'https://evil.test' }]
    for (const headers of origins) {
      const peer = new Peer(`${url}/api/voice/stream?broadcastId=${b.id}&device=abcdefgh`, headers)
      const [, response] = await once(peer.ws, 'unexpected-response')
      expect(response.statusCode).toBe(403)
      response.resume(); peer.ws.terminate()
    }
    expect(await device(url, '', b.id).message('closing')).toEqual({ type: 'closing', reason: 'AUTH' })
    expect(await device(url, other.cookie, b.id).message('closing')).toEqual({ type: 'closing', reason: 'ENDED' })
    await client(world, seller.cookie).post(`/api/broadcasts/${b.id}/end`, { requestId: 'end-1' })
    expect(await device(url, seller.cookie, b.id).message('closing')).toEqual({ type: 'closing', reason: 'ENDED' })
  })
  it('일꾼 없음·자리 없음은 명시 거절, 다른 기기가 기존 흐름을 빼앗지 않는다', async () => {
    const { world, url } = await setup()
    const a = await addSeller(world), b = await addSeller(world)
    const ba = await createBroadcast(world, a), bb = await createBroadcast(world, b)
    expect(await device(url, a.cookie, ba.id).message('closing')).toEqual({ type: 'closing', reason: 'NO_WORKER' })
    await worker(url, world, 1)
    const first = device(url, a.cookie, ba.id)
    expect(await first.message('ready')).toEqual({ type: 'ready' })
    expect(await device(url, a.cookie, ba.id, 'otherdev1').message('closing')).toEqual({ type: 'closing', reason: 'OTHER_DEVICE' })
    expect(await device(url, b.cookie, bb.id).message('closing')).toEqual({ type: 'closing', reason: 'BUSY' })
    const again = device(url, a.cookie, ba.id)
    expect(await again.message('ready')).toEqual({ type: 'ready' })
    await waitFor(() => first.ws.readyState === WebSocket.CLOSED)
    expect(world.server.voice.status()).toMatchObject({ workers: 1, streams: 1 })
  })
  it('PCM에 흐름 번호를 붙이고 결과는 해당 기기에만 돌린다. 소리·글은 DB·로그에 없다', async () => {
    const { world, url } = await setup()
    const w = await worker(url, world)
    const a = await addSeller(world), b = await addSeller(world)
    const ba = await createBroadcast(world, a), bb = await createBroadcast(world, b)
    const first = device(url, a.cookie, ba.id), second = device(url, b.cookie, bb.id)
    await first.message('ready'); await second.message('ready')
    const opens = [await w.message('open'), await w.message('open')] as {stream:number}[]
    const pcm = Buffer.alloc(3_200, 0x4a)
    first.ws.send(pcm)
    await waitFor(() => w.messages.some((message) => message.binary))
    const frame = w.messages.find((message) => message.binary)!.bytes
    expect(frame.subarray(4)).toEqual(pcm)
    const stream = frame.readUInt32BE(0)
    expect(opens.map((x) => x.stream)).toContain(stream)
    w.send({ type: 'result', stream, text: '십오번 이만원', startMs: 0, endMs: 100, procMs: 50 })
    expect(await first.message('result')).toEqual({ type: 'result', text: '십오번 이만원', startMs: 0, endMs: 100 })
    expect(second.messages).toEqual([])
    expect(await dumpAllTables(world.database)).not.toContain('십오번 이만원')
    expect(JSON.stringify(world.logs)).not.toContain('십오번 이만원')
    const before = world.server.voice.status().p95Ms
    for (const bad of [{ text: 'x'.repeat(2001) }, { startMs: -1 }, { startMs: 101 }, { text: 12 }]) {
      w.send({ type: 'result', stream, text: '잘못된 글', startMs: 0, endMs: 100, procMs: 500, ...bad })
    }
    // 유효 결과를 장벽으로 사용해 앞선 틀이 모두 처리됐음을 확인한다.
    w.send({ type: 'result', stream, text: '다음 글', startMs: 100, endMs: 200, procMs: 50 })
    expect(await first.message('result')).toMatchObject({ text: '다음 글' })
    expect(first.messages).toEqual([])
    expect(world.server.voice.status().p95Ms).toBe(before)
  })
  it('과다 입력 RATE, 일꾼 끊김 WORKER_LOST, 로그아웃 AUTH를 바로 알린다', async () => {
    const { world, url } = await setup()
    const w = await worker(url, world)
    const seller = await addSeller(world), b = await createBroadcast(world, seller)
    const first = device(url, seller.cookie, b.id)
    await first.message('ready')
    first.ws.send(Buffer.alloc(65_537))
    expect(await first.message('closing')).toMatchObject({ reason: 'RATE' })
    const second = device(url, seller.cookie, b.id)
    await second.message('ready')
    w.ws.close()
    expect(await second.message('closing')).toMatchObject({ reason: 'WORKER_LOST' })
    await worker(url, world)
    const third = device(url, seller.cookie, b.id)
    await third.message('ready')
    await client(world, seller.cookie).post('/api/logout', {})
    expect(await third.message('closing')).toMatchObject({ reason: 'AUTH' })
  })
  it('현재 방송 종료는 흐름을 닫고 p95는 최근 10분만 센다', async () => {
    const { world, url } = await setup()
    const w = await worker(url, world)
    const seller = await addSeller(world), b = await createBroadcast(world, seller)
    const first = device(url, seller.cookie, b.id)
    await first.message('ready')
    const { stream } = await w.message('open') as {stream:number}
    w.send({ type: 'result', stream, text: '옛 글', startMs: 0, endMs: 10, procMs: 9_999 })
    await first.message('result')
    world.clock.advance(660_000)
    for (let i = 1; i <= 20; i++) w.send({ type: 'result', stream, text: `글 ${i}`, startMs: i, endMs: i + 1, procMs: i * 100 })
    await waitFor(() => first.messages.length === 20)
    expect(world.server.voice.status()).toEqual({ workers: 1, streams: 1, p95Ms: 1900 })
    const ops = await world.server.app.request('/ops/status', { headers: { Authorization: 'Bearer operations-test-token-32-characters' } })
    expect(await ops.json()).toMatchObject({ transcribe: { workers: 1, streams: 1, p95Ms: 1900 } })
    const response = await client(world, seller.cookie).post(`/api/broadcasts/${b.id}/end`, { requestId: 'end-broadcast-2' })
    expect(response.status).toBe(200)
    expect(await first.message('closing')).toEqual({ type: 'closing', reason: 'ENDED' })
  })
  it('남은 자리가 많은 일꾼을 고르고 초당 32,000바이트 열 번은 허용한다', async () => {
    const { world, url } = await setup()
    const small = await worker(url, world, 1), large = await worker(url, world, 3)
    const seller = await addSeller(world), b = await createBroadcast(world, seller)
    const first = device(url, seller.cookie, b.id)
    await first.message('ready')
    await large.message('open')
    for (let i = 0; i < 10; i++) {
      first.ws.send(Buffer.alloc(32_000, i))
      await waitFor(() => large.messages.filter((message) => message.binary).length === i + 1)
      world.clock.advance(1_000)
    }
    expect(small.messages).toEqual([])
    expect(first.ws.readyState).toBe(WebSocket.OPEN)
    first.ws.close()
    expect(await large.message('close')).toMatchObject({ stream: 1 })
  })
  // D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 기대 "보조자 403"을 뺐다 (음성·별칭 403). 인증 만료로 닫는 확인은 그대로
  it('인증이 만료되면 흐름을 닫는다', async () => {
    const { world, url } = await setup()
    const seller = await addSeller(world), b = await createBroadcast(world, seller)
    const stream = new Peer(`${url}/api/voice/stream?broadcastId=${b.id}&device=chromedev1&mode=chrome`, { Origin: ORIGIN, Cookie: seller.cookie })
    await stream.message('ready')
    await world.database.pglite!.exec('delete from sessions')
    await world.server.voice.check()
    expect(await stream.message('closing')).toMatchObject({ reason: 'AUTH' })
  })
  it('30초 동안 핑 답이 없는 일꾼과 흐름을 정리한다', async () => {
    const { world, url } = await setup()
    const w = await worker(url, world)
    const seller = await addSeller(world), b = await createBroadcast(world, seller)
    const stream = device(url, seller.cookie, b.id)
    await stream.message('ready')
    world.clock.advance(30_000)
    await world.server.voice.check()
    await waitFor(() => w.ws.readyState === WebSocket.CLOSED && stream.ws.readyState === WebSocket.CLOSED)
    expect(world.server.voice.status()).toMatchObject({ workers: 0, streams: 0 })
    expect(world.logs.filter((item) => item.code === 'TRANSCRIBE_NO_WORKER')).toEqual([{ level: 'alert', code: 'TRANSCRIBE_NO_WORKER', count: 1 }])
  })
  it('일꾼 없는 경보는 10분에 한 번만 남기며 값·판매자 정보를 넣지 않는다', async () => {
    const { world, url } = await setup()
    const seller = await addSeller(world), b = await createBroadcast(world, seller)
    for (let i = 0; i < 3; i++) await device(url, seller.cookie, b.id).message('closing')
    expect(world.logs.filter((item) => item.code === 'TRANSCRIBE_NO_WORKER')).toEqual([{ level: 'alert', code: 'TRANSCRIBE_NO_WORKER', count: 1 }])
    world.clock.advance(600_000)
    await device(url, seller.cookie, b.id).message('closing')
    expect(world.logs.filter((item) => item.code === 'TRANSCRIBE_NO_WORKER')).toEqual([
      { level: 'alert', code: 'TRANSCRIBE_NO_WORKER', count: 1 }, { level: 'alert', code: 'TRANSCRIBE_NO_WORKER', count: 3 },
    ])
  })
  it('휴대폰 중계는 음성 기기 경로의 출처만 바꾸고 일꾼·임의 경로는 막는다', async () => {
    const { world, url } = await setup()
    const seller = await addSeller(world), b = await createBroadcast(world, seller)
    const phoneOrigin = 'https://phone.livejjim.test'
    const relay = createHttpServer()
    servers.push(relay)
    relay.on('upgrade', createPhoneVoiceUpgrade({ port: Number(new URL(url).port), appOrigin: ORIGIN, httpsOrigins: [phoneOrigin], fakeGoogle: null, realYoutube: false }))
    relay.listen(0, '127.0.0.1')
    await once(relay, 'listening')
    const port = (relay.address() as {port:number}).port
    const first = new Peer(`ws://127.0.0.1:${port}/api/voice/stream?broadcastId=${b.id}&device=phonedev1&mode=chrome`, { Origin: phoneOrigin, Cookie: seller.cookie })
    expect(await first.message('ready')).toEqual({ type: 'ready' })
    for (const path of ['/api/voice/worker', '/api/x']) {
      const peer = new Peer(`ws://127.0.0.1:${port}${path}`, { Origin: phoneOrigin, Authorization: `Bearer ${TOKEN}` })
      const [, response] = await once(peer.ws, 'unexpected-response')
      expect(response.statusCode).toBe(403)
      response.resume(); peer.ws.terminate()
    }
  })
})

describe('APP1b 서버 읽기 실제 WebSocket', () => {
  it('깨진 JSON·미지원 명령·잘못된 인자·16KiB 초과 제어 글은 RATE로 닫는다', async () => {
    const { world, url } = await setup()
    const seller = await addSeller(world), b = await createBroadcast(world, seller)
    for (const payload of [
      '{broken',
      JSON.stringify({ type: 'voice.session', op: 'unknown' }),
      JSON.stringify({ type: 'voice.session', op: 'command', method: 'constructor', args: [] }),
      JSON.stringify({ type: 'voice.session', op: 'command', method: 'setInstant', args: ['true'] }),
      'x'.repeat(16_385),
    ]) {
      const stream = new Peer(`${url}/api/voice/stream?broadcastId=${b.id}&device=chromedev1&mode=chrome`, { Origin: ORIGIN, Cookie: seller.cookie })
      await stream.message('ready')
      stream.ws.send(payload)
      expect(await stream.message('closing')).toEqual({ type: 'closing', reason: 'RATE' })
    }
    expect((await client(world, seller.cookie).get('/api/me')).status).toBe(200)
    expect(world.server.voice.status().streams).toBe(0)
  })
  // SRV1 (D-APP-22·D-APP-25 (2), APP-05 AC5 대체 — AC-SRV1-12): 옛 테스트 "크롬 최종 글도 서버 읽기를 거쳐 등록 효과가 된다"는 스펙이 없앤 길이다.
  // 새 기대: 기기가 보낸 받아쓴 글은 거절(UNSUPPORTED)되고 효과·상품·이벤트가 0. 보존한 단언: 글이 DB·로그에 남지 않음, 손 등록은 그대로 된다.
  it.each(['mode=chrome', 'capture=false'])('AC-SRV1-12 받아쓴 글(chromeResult)은 거절되고 아무것도 쓰지 않는다 — 조작 전용 연결(%s)은 일꾼 없이 열린다', async (param) => {
    const { world, url } = await setup()
    const seller = await addSeller(world), b = await createBroadcast(world, seller)
    const eventsBefore = (await world.server.writer.read(seller.sellerId, b.date)).seq
    // 받아쓰기 일꾼이 없어도 조작 전용 연결은 열린다 (D-APP1b-08)
    const stream = new Peer(`${url}/api/voice/stream?broadcastId=${b.id}&device=controldev1&${param}`, { Origin: ORIGIN, Cookie: seller.cookie })
    await stream.message('ready')
    stream.send({ type: 'voice.session', op: 'hello', context: { now: world.clock.now(), dialogOpen: false, smsAutoAllowed: true, consent: true } })
    await stream.matching((value) => value.type === 'voice.state' && (value.snapshot as {phase: string}).phase === 'on')
    stream.send({ type: 'voice.session', op: 'chromeResult', result: { text: '15번 2만 원', final: true } })
    expect(await stream.matching((value) => value.type === 'voice.error')).toEqual({ type: 'voice.error', code: 'UNSUPPORTED', message: '받아쓴 글은 받지 않아요. 음성은 라이브지니 받아쓰기로 들어요. 상품은 빠른 입력으로 넣어 주세요.' })
    // 카드 손 조작(설정 바꾸기)은 그대로 — 연결이 살아 있고 효과가 온다
    stream.send({ type: 'voice.session', op: 'command', method: 'setInstant', args: [false] })
    await stream.matching((value) => value.type === 'voice.effect' && value.method === 'writeSettings')
    world.clock.advance(5_000)
    stream.send({ type: 'voice.session', op: 'command', method: 'refresh', args: [] })
    await stream.matching((value) => value.type === 'voice.state')
    expect(stream.messages.some((item) => !item.binary && (item.body as {type: string; method?: string}).type === 'voice.effect' && ['register', 'writeSms', 'fixRecent'].includes(String((item.body as {method?: string}).method)))).toBe(false)
    const after = await world.server.writer.read(seller.sellerId, b.date)
    expect(after.state.products.size).toBe(0)
    expect(after.seq).toBe(eventsBefore)
    expect(await dumpAllTables(world.database)).not.toContain('15번 2만 원')
    expect(JSON.stringify(world.logs)).not.toContain('15번 2만 원')
    // 손 등록은 그대로 된다
    const saved = await client(world, seller.cookie).post('/api/events', { requestId: 'srv1-hand-register', type: 'product.register', b: b.id, no: 15, name: '', price: 20_000 })
    expect(saved.status, saved.text).toBe(200)
    stream.ws.close()
    await waitFor(() => world.server.voice.status().streams === 0)
  })
  it('일꾼 결과를 기존 읽기 세션에 넣고 계정의 배운 품종을 쓴다', async () => {
    const { world, url } = await setup()
    const seller = await addSeller(world), b = await createBroadcast(world, seller)
    expect((await client(world, seller.cookie).post('/api/voice/aliases', { aliases: [{ heard: '선버스', name: '선버스트', usedAt: 1 }] })).status).toBe(200)
    const w = await worker(url, world), stream = device(url, seller.cookie, b.id)
    await stream.message('ready')
    const { stream: id } = await w.message('open') as {stream:number}
    stream.send({ type: 'voice.session', op: 'hello', context: { now: world.clock.now(), dialogOpen: false, smsAutoAllowed: true, consent: true } })
    await stream.matching((value) => value.type === 'voice.state' && (value.snapshot as {phase: string}).phase === 'on')
    stream.send({ type: 'voice.session', op: 'capture', at: world.clock.now() - 1000 })
    w.send({ type: 'result', stream: id, text: '15번 선버스 2만 원', startMs: 0, endMs: 1000, procMs: 20 })
    const effect = await stream.matching((value) => value.type === 'voice.effect' && value.method === 'register')
    expect(effect.args).toMatchObject([{}, { no: 15, name: '선버스트', price: 20_000 }, 'instant', { source: 'voice', device: 'testdevice01' }])
    expect(effect.spokenEndAt).toBe(world.clock.now())
    // 서버 읽기를 거친 글은 쓰기 전에는 DB·로그에 남지 않는다 (옛 크롬 시험에서 옮긴 단언, APP-05 AC7)
    expect((await world.server.writer.read(seller.sellerId, b.date)).state.products.size).toBe(0)
    expect(await dumpAllTables(world.database)).not.toContain('15번 선버스 2만 원')
    expect(JSON.stringify(world.logs)).not.toContain('15번 선버스 2만 원')
  })
})
