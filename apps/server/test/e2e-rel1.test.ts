import { once } from 'node:events'
import { expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import { E2E_MOCK_WORKER_STREAMS, E2eClock, startE2eServer } from '../src/e2e.ts'
import { startMockWorker } from '../src/voice/mock-worker.ts'
import { FAST_COST } from './support.ts'

const ORIGIN = 'http://localhost:5173'

it('E2E 서버 시계는 /_e2e/clock로 정하고 되돌리며, 서버 앱에는 그 경로가 없다', async () => {
  const e2e = await startE2eServer({ appOrigin: ORIGIN, passwordCost: FAST_COST, initialBackup: false, parcel: false })
  try {
    const { port } = await e2e.listen(0)
    const base = `http://127.0.0.1:${String(port)}`
    const post = (body: unknown) => fetch(`${base}/_e2e/clock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const set = await post({ at: '2026-03-01T01:02:03.000Z' })
    expect(set.status).toBe(200)
    const body = await set.json() as { now: string }
    expect(Math.abs(Date.parse(body.now) - Date.parse('2026-03-01T01:02:03.000Z'))).toBeLessThan(2_000)
    const read = await (await fetch(`${base}/_e2e/clock`)).json() as { now: string }
    expect(Math.abs(Date.parse(read.now) - Date.parse('2026-03-01T01:02:03.000Z'))).toBeLessThan(5_000)
    expect((await post({ at: Date.parse('2026-04-01T00:00:00Z') })).status).toBe(200)
    expect((await post({ at: '아무거나' })).status).toBe(400)
    expect((await post({})).status).toBe(400)
    const reset = await (await post({ reset: true })).json() as { now: string; offsetMs: number }
    expect(reset.offsetMs).toBe(0)
    expect(Math.abs(Date.parse(reset.now) - Date.now())).toBeLessThan(2_000)
    expect((await e2e.server.app.request('/_e2e/clock', { method: 'POST', body: '{}' })).status).toBe(404)
  } finally {
    await e2e.close()
  }
})

it('E2eClock은 정한 시각부터 실제 시계와 같이 흐른다', () => {
  const clock = new E2eClock()
  clock.set(Date.parse('2026-01-01T00:00:00Z'))
  expect(Math.abs(clock.now() - Date.parse('2026-01-01T00:00:00Z'))).toBeLessThan(100)
  clock.reset()
  expect(Math.abs(clock.now() - Date.now())).toBeLessThan(100)
})

it('모의 일꾼은 기본 흐름 1, E2E 값을 주면 그만큼 알린다', async () => {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await once(wss, 'listening')
  const address = wss.address()
  if (typeof address !== 'object' || address === null) throw new Error('주소')
  const hellos: number[] = []
  wss.on('connection', (ws) => ws.on('message', (data) => hellos.push((JSON.parse(String(data)) as { maxStreams: number }).maxStreams)))
  const url = `ws://127.0.0.1:${String(address.port)}`
  const a = startMockWorker({ url, token: 't' })
  const b = startMockWorker({ url, token: 't', maxStreams: E2E_MOCK_WORKER_STREAMS })
  try {
    await expect.poll(() => [...hellos].sort((x, y) => x - y)).toEqual([1, 64])
  } finally {
    a.close(); b.close()
    await new Promise<void>((resolve) => wss.close(() => resolve()))
  }
})
