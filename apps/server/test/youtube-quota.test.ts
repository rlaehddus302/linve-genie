// AC-Y1-50~53 할당량 (YT-08, D-Y09): 호출 계량, 태평양 하루·예산, 묶음·멈춤 전환, 표시 API
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_COSTS, type ApiMethod } from '../src/youtube/google.ts'
import type { FakeMethod } from '../src/youtube/fake-google.ts'
import { client } from './support.ts'
import { connectSeller, linkedBroadcast, sibling, until, youtubeWorld, type YoutubeWorld } from './youtube-support.ts'

const worlds: YoutubeWorld[] = []
const extras: { server: { close(): void; stop(): Promise<void> } }[] = []
async function world(options: Parameters<typeof youtubeWorld>[0] = {}): Promise<YoutubeWorld> {
  const created = await youtubeWorld(options)
  worlds.push(created)
  return created
}
afterEach(async () => {
  for (const item of extras.splice(0)) {
    item.server.close()
    await item.server.stop()
  }
  for (const item of worlds.splice(0)) {
    item.server.close()
    await item.server.stop()
    await item.fake.close()
  }
})

interface QuotaView {
  day: string
  used: number
  remaining: number
  budget: number
  resetsAt: string
  mode: string
  methods: { method: string; calls: number; units: number }[]
}

async function quota(w: YoutubeWorld, cookie: string): Promise<QuotaView> {
  const response = await client(w, cookie).get('/api/youtube/quota')
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  return response.body.quota as QuotaView
}

const API_METHODS = Object.keys(DEFAULT_COSTS) as ApiMethod[]

describe('AC-Y1-50 호출 계량', () => {
  it('가짜 서버가 받은 호출 수 × 비용 = 계량 합계 (실패·타임아웃 호출도 센다, OAuth는 세지 않는다). 다시 시작해도 이어서 센다', async () => {
    const w = await world()
    const connected = await connectSeller(w, { publish: true })
    const { b, liveChatId } = await linkedBroadcast(w, connected, { settings: { 'print.autoOnConfirm': false, 'thanks.videoComment': 'PER_SALE' } })
    const api = client(w, connected.seller.cookie)
    w.fake.fail('liveBroadcasts.list', { status: 500 })
    expect((await api.get('/api/youtube/live-broadcasts')).status).toBe(502)
    await api.get('/api/youtube/live-broadcasts')
    expect((await api.post('/api/events', { requestId: 'p15', type: 'product.register', b: b.id, no: 15, name: '핑크프릴', price: 10000 })).status).toBe(200)
    w.server.youtube?.collectors.start()
    w.fake.addMessage(liveChatId, { author: 'UCa', name: '가', text: '15', publishedAt: w.timer.now() + 1 })
    await until(w, async () => ((await api.get(`/api/broadcasts/${b.id}/youtube`)).body.collector as { recorded: number }).recorded === 1, { step: 100 })
    w.fake.fail('liveChatMessages.insert', { status: 503 })
    await w.server.youtube?.outbox.runOnce()
    await w.timer.advance(3000)
    await w.server.youtube?.outbox.runOnce()
    await w.server.youtube?.collectors.stop()
    const view = await quota(w, connected.seller.cookie)
    let expected = 0
    for (const method of API_METHODS) {
      const calls = w.fake.calls(method as FakeMethod)
      expected += calls * DEFAULT_COSTS[method]
      const row = view.methods.find((item) => item.method === method)
      expect(row?.calls ?? 0, method).toBe(calls)
      expect(row?.units ?? 0, method).toBe(calls * DEFAULT_COSTS[method])
    }
    expect(view.used).toBe(expected)
    expect(w.fake.calls('oauth.token') + w.fake.calls('oauth.refresh')).toBeGreaterThan(0)
    expect(view.methods.some((item) => item.method.startsWith('oauth'))).toBe(false)
    // 다시 시작해도 이어서 센다
    const restarted = sibling(w, 'R')
    extras.push(restarted)
    expect((await quota(restarted, connected.seller.cookie)).used).toBe(expected)
  })
})

describe('AC-Y1-51 하루 경계와 예산', () => {
  it('태평양 자정에 0부터 다시 센다. 남은 양 = min(예산 − 판매자 사용, 한도 − 프로젝트 사용)', async () => {
    const v = await world({ start: Date.parse('2026-10-20T06:59:00Z') })
    const config = { ...v.config, quota: { limit: 1000, sellerBudget: 300 } }
    const server = sibling(v, 'Q', { youtube: config })
    extras.push(server)
    const a = await connectSeller(server)
    const b = await connectSeller(server)
    const meter = server.server.youtube?.quota
    if (meter === undefined) throw new Error('유튜브가 없다')
    for (let i = 0; i < 10; i++) await meter.count(a.seller.sellerId, 'liveChatMessages.insert')
    for (let i = 0; i < 40; i++) await meter.count(b.seller.sellerId, 'liveChatMessages.insert')
    // a: 예산 300 − (200 + 연결 1) = 99, 프로젝트 1000 − (201 + 801) = −2 → 0
    expect((await quota(server, a.seller.cookie)).remaining).toBe(0)
    const viewA = await quota(server, a.seller.cookie)
    expect(viewA).toMatchObject({ day: '2026-10-19', used: 201, budget: 300, resetsAt: '2026-10-20T07:00:00.000Z', mode: 'PAUSED' })
    // 다른 판매자의 사용량·프로젝트 전체 사용량 숫자는 보이지 않는다
    expect(JSON.stringify(viewA)).not.toContain('801')
    expect(JSON.stringify(viewA)).not.toContain('1002')
    await v.timer.set(Date.parse('2026-10-20T07:00:00Z'))
    expect(await quota(server, a.seller.cookie)).toMatchObject({ day: '2026-10-20', used: 0, remaining: 300, mode: 'NORMAL', methods: [] })
  })
})

describe('AC-Y1-52 묶음·멈춤 전환', () => {
  it('남은 양 < 예산의 20%면 BATCH, < 5%면 PAUSED (경계 바로 위·아래). 모드가 바뀌면 SSE. 자정에 다시 계산', async () => {
    const v = await world({ start: Date.parse('2026-10-20T06:00:00Z') })
    const server = sibling(v, 'Q', { youtube: { ...v.config, quota: { limit: 100_000, sellerBudget: 1000 } } })
    extras.push(server)
    const connected = await connectSeller(server)
    const meter = server.server.youtube?.quota
    if (meter === undefined) throw new Error('유튜브가 없다')
    const id = connected.seller.sellerId
    const response = await client(server, connected.seller.cookie).raw('/api/stream', {})
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    let text = ''
    const pump = (async () => {
      for (;;) {
        const chunk = await reader?.read()
        if (chunk === undefined || chunk.done) break
        text += decoder.decode(chunk.value)
      }
    })()
    // 연결에 1 단위를 썼다. 남은 양 201 → NORMAL, 199 → BATCH
    for (let i = 0; i < 798; i++) await meter.count(id, 'channels.list')
    expect(await meter.remaining(id)).toBe(201)
    expect(await meter.mode(id)).toBe('NORMAL')
    await meter.count(id, 'channels.list')
    await meter.count(id, 'channels.list')
    expect(await meter.remaining(id)).toBe(199)
    expect(await meter.mode(id)).toBe('BATCH')
    // 남은 양 50 → BATCH, 49 → PAUSED
    for (let i = 0; i < 149; i++) await meter.count(id, 'channels.list')
    expect(await meter.remaining(id)).toBe(50)
    expect(await meter.mode(id)).toBe('BATCH')
    await meter.count(id, 'channels.list')
    expect(await meter.mode(id)).toBe('PAUSED')
    // 자정에 다시 계산
    await v.timer.set(Date.parse('2026-10-20T07:00:01Z'))
    expect(await meter.mode(id)).toBe('NORMAL')
    await meter.recheck([id])
    await new Promise((resolve) => setTimeout(resolve, 20))
    await reader?.cancel()
    await pump
    expect(text).toContain('"kind":"quota","mode":"BATCH"')
    expect(text).toContain('"kind":"quota","mode":"PAUSED"')
    expect(text).toContain('"kind":"quota","mode":"NORMAL"')
  })

  it('PAUSED에서도 채팅 수집은 계속하고 게시는 하지 않는다', async () => {
    const w = await world()
    const connected = await connectSeller(w, { publish: 'LIVE_CHAT' })
    const { b, liveChatId } = await linkedBroadcast(w, connected, { settings: { 'print.autoOnConfirm': false } })
    await w.server.youtube?.quota.markExceeded(connected.seller.sellerId)
    expect((await client(w, connected.seller.cookie).post('/api/events', { requestId: 'p15', type: 'product.register', b: b.id, no: 15, name: '핑크프릴', price: 10000 })).status).toBe(200)
    w.server.youtube?.collectors.start()
    w.fake.addMessage(liveChatId, { author: 'UCa', name: '가', text: '15', publishedAt: w.timer.now() + 1 })
    await until(w, async () => ((await client(w, connected.seller.cookie).get(`/api/broadcasts/${b.id}/youtube`)).body.collector as { recorded: number }).recorded === 1, { step: 100 })
    await w.server.youtube?.outbox.runOnce()
    await w.timer.advance(61_000)
    await w.server.youtube?.outbox.runOnce()
    expect(w.fake.posted).toEqual([])
    const rows = (await client(w, connected.seller.cookie).get(`/api/days/${b.date}/outbox`)).body.rows as { state: string; reason: string }[]
    expect(rows[0]).toMatchObject({ state: 'WAITING', reason: 'QUOTA' })
  })
})
