// D-V3-127 내 품종 장부: GET/PUT /api/voice/varieties, 받아쓰기 힌트(한글 수 보기 + 장부 이름), 흐름을 열 때 일꾼 open에 힌트가 실린다.
import { once } from 'node:events'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { createNodeServer } from '../src/node-server.ts'
import { HINT_CHAR_LIMIT, VARIETY_LIMIT, VARIETY_MESSAGES, VoiceVarieties, checkVarietyNames, composeHint } from '../src/voice/varieties.ts'
import { addSeller, client, createBroadcast, fakeClock, newWorld, ORIGIN, waitFor, type TestServer } from './support.ts'

const TOKEN = 'test-worker-token-not-used-outside-tests'
const worlds: TestServer[] = []
const sockets: WebSocket[] = []
const servers: Server[] = []
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate()
  for (const world of worlds.splice(0)) { world.server.close(); await world.database.close() }
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})
async function setup() {
  const world = await newWorld({ transcribeWorkerToken: TOKEN })
  worlds.push(world)
  return world
}
async function listen(world: TestServer) {
  const server = createNodeServer({ app: world.server.app })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('주소 없음')
  return `ws://127.0.0.1:${address.port}`
}
class Peer {
  readonly ws: WebSocket
  readonly messages: Record<string, unknown>[] = []
  constructor(url: string, headers: Record<string, string>) {
    this.ws = new WebSocket(url, { headers })
    sockets.push(this.ws)
    this.ws.on('error', () => {})
    this.ws.on('message', (data, binary) => { if (!binary) this.messages.push(JSON.parse(Buffer.from(data as Buffer).toString('utf8'))) })
  }
  async open() { await once(this.ws, 'open'); return this }
  async message(type: string) {
    await waitFor(() => this.messages.some((item) => item.type === type))
    return this.messages.splice(this.messages.findIndex((item) => item.type === type), 1)[0]!
  }
}

describe('D-V3-127 내 품종 장부', () => {
  it('이름 정리: 공백·같은 이름·빈 것은 정리하고, 전화번호·제어 글자·긴 이름·너무 많은 목록은 거절한다', () => {
    expect(checkVarietyNames([' 아사달금 ', '아사달 금', '킹나이트금', '', '  '])).toEqual({ names: ['아사달금', '킹나이트금'] })
    expect(checkVarietyNames(['SP녹금', 'sp 녹금'])).toEqual({ names: ['SP녹금'] })
    expect(checkVarietyNames('녹금')).toEqual({ error: VARIETY_MESSAGES.invalid })
    expect(checkVarietyNames([3])).toEqual({ error: VARIETY_MESSAGES.invalid })
    expect(checkVarietyNames(['01012345678'])).toEqual({ error: VARIETY_MESSAGES.invalid })
    expect(checkVarietyNames(['녹\u0007금'])).toEqual({ error: VARIETY_MESSAGES.invalid })
    expect(checkVarietyNames(['가'.repeat(41)])).toEqual({ error: VARIETY_MESSAGES.tooLong })
    expect(checkVarietyNames(Array.from({ length: VARIETY_LIMIT + 1 }, (_, i) => `품종${String(i)}`))).toEqual({ error: VARIETY_MESSAGES.tooMany })
  })
  it('힌트: 품종 이름만 — 장부 이름 → 최근 판 이름 차례로 같은 이름 없이 글자 한도 안에서 붙고, 이름이 없으면 빈 글(힌트 없음) (D-V3-132)', () => {
    expect(composeHint([])).toBe('')
    expect(composeHint(['아사달금', '킹나이트금'], ['킹 나이트금', '청개구리금'])).toBe('아사달금, 킹나이트금, 청개구리금.')
    const many = composeHint(Array.from({ length: 200 }, (_, i) => `품종이름${String(i)}`))
    expect(many.length).toBeLessThanOrEqual(HINT_CHAR_LIMIT + 2)
    expect(many.startsWith('품종이름0, 품종이름1')).toBe(true)
    // 한글 수 보기 문장은 넣지 않는다(D-V3-132: 효과 없이 되풀이만 늘림)
    expect(many.includes('번')).toBe(false)
  })
  it('GET·PUT: 계정마다 따로이고, 다시 켠 저장소에서도 읽히며, 틀린 목록은 400으로 저장하지 않는다', async () => {
    const w = await setup(), a = await addSeller(w), b = await addSeller(w)
    const api = client(w, a.cookie)
    expect((await api.get('/api/voice/varieties')).body).toEqual({ names: [], suggested: [] })
    expect((await api.put('/api/voice/varieties', { names: ['아사달금', ' 킹나이트금 ', '아사달금'] })).body).toEqual({ names: ['아사달금', '킹나이트금'] })
    expect((await api.get('/api/voice/varieties')).body).toMatchObject({ names: ['아사달금', '킹나이트금'] })
    expect((await client(w, b.cookie).get('/api/voice/varieties')).body).toEqual({ names: [], suggested: [] })
    expect((await client(w, null).get('/api/voice/varieties')).status).toBe(401)
    for (const body of [{ names: '녹금' }, { names: ['01012345678'] }, { names: ['녹금'], sellerId: b.sellerId }, {}]) {
      expect((await api.put('/api/voice/varieties', body)).status).toBe(400)
    }
    expect((await api.get('/api/voice/varieties')).body).toMatchObject({ names: ['아사달금', '킹나이트금'] })
    expect(await new VoiceVarieties(w.database.db, fakeClock()).read(a.sellerId)).toEqual(['아사달금', '킹나이트금'])
  })
  it('기기가 방송 흐름을 열면 일꾼 open에 그 판매자의 힌트(한글 수 보기 + 장부 이름)가 실린다 — 장부가 비어도 보기 문장은 간다', async () => {
    const w = await setup()
    const url = await listen(w)
    const a = await addSeller(w), ba = await createBroadcast(w, a)
    expect((await client(w, a.cookie).put('/api/voice/varieties', { names: ['아사달금', '킹나이트금'] })).status).toBe(200)
    expect((await client(w, a.cookie).get('/api/me')).status).toBe(200)
    const worker = await new Peer(`${url}/api/voice/worker`, { Authorization: `Bearer ${TOKEN}` }).open()
    worker.ws.send(JSON.stringify({ type: 'hello', maxStreams: 4 }))
    await waitFor(() => w.server.voice.status().workers > 0)
    const device = await new Peer(`${url}/api/voice/stream?broadcastId=${encodeURIComponent(ba.id)}&device=testdevice01`, { Cookie: a.cookie, Origin: ORIGIN }).open()
    await waitFor(() => device.messages.length > 0)
    expect(device.messages[0]).toEqual({ type: 'ready' })
    const open = await worker.message('open')
    expect(open).toMatchObject({ type: 'open', hint: '아사달금, 킹나이트금.' })
    // 장부를 바꾸면 다음 흐름부터 새 힌트
    await client(w, a.cookie).put('/api/voice/varieties', { names: ['순수'] })
    expect(w.server.voice.status().streams).toBe(1)
    device.ws.close()
    await waitFor(() => w.server.voice.status().streams === 0)
    const again = await new Peer(`${url}/api/voice/stream?broadcastId=${encodeURIComponent(ba.id)}&device=testdevice01`, { Cookie: a.cookie, Origin: ORIGIN }).open()
    await again.message('ready')
    expect(await worker.message('open')).toMatchObject({ hint: '순수.' })
  })
})
