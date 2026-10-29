import { once } from 'node:events'
import { expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { startE2eServer } from '../src/e2e.ts'
import { FAST_COST } from './support.ts'

const ORIGIN = 'http://localhost:5173'

it('시험 이력 hold는 진행 중인 실제 읽기만 기다리게 하며 해제하면 날짜 조회까지 완료한다', async () => {
  const e2e = await startE2eServer({ appOrigin: ORIGIN, passwordCost: FAST_COST, initialBackup: false, parcel: false, fill: { date: '2026-10-29', products: 1, chats: 0 } })
  let socket: WebSocket | null = null
  try {
    const { port } = await e2e.listen(0)
    const base = `http://127.0.0.1:${port}`
    const post = (path: string, body: unknown, cookie = '') => fetch(`${base}${path}`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) })
    const history = () => fetch(`${base}/_e2e/voice/history?loginId=${e2e.account.loginId}`).then((response) => response.json()) as Promise<Record<string, unknown>>
    const control = (body: Record<string, unknown>) => post('/_e2e/voice/history', { loginId: e2e.account.loginId, ...body })
    expect(await history()).toMatchObject({ hold: false, held: 0, pending: 0, completed: 0, calls: [] })
    expect((await control({ hold: 'true' })).status).toBe(400)
    expect((await e2e.server.app.request('/_e2e/voice/history')).status).toBe(404)
    const login = await post('/api/login', { loginId: e2e.account.loginId, password: e2e.account.password })
    const cookie = /lj_session=[^;]+/.exec(login.headers.get('set-cookie') ?? '')?.[0] ?? ''
    expect(login.status).toBe(200)
    const made = await post('/api/broadcasts', { requestId: 'held-history-broadcast', date: '2026-10-30' }, cookie)
    expect(made.status).toBe(200)
    const { broadcast } = await made.json() as { broadcast: { id: string } }
    expect((await control({ hold: true })).status).toBe(200)
    const messages: { type: string }[] = []
    socket = new WebSocket(`${base.replace('http:', 'ws:')}/api/voice/stream?broadcastId=${broadcast.id}&device=historytest1&mode=chrome`, { headers: { Origin: ORIGIN, Cookie: cookie } })
    socket.on('message', (bytes) => messages.push(JSON.parse(String(bytes)) as { type: string }))
    await once(socket, 'open')
    await expect.poll(() => messages.some((message) => message.type === 'ready')).toBe(true)
    socket.send(JSON.stringify({ type: 'voice.session', op: 'hello', context: { now: Date.now(), dialogOpen: false, smsAutoAllowed: true, consent: true } }))
    await expect.poll(history).toMatchObject({ hold: true, held: 1, pending: 1, completed: 0, calls: [null] })
    // 다른 제어값 변경은 진행 중인 대기를 잃거나 풀지 않는다.
    expect((await control({ delayMs: 0 })).status).toBe(200)
    expect(await history()).toMatchObject({ hold: true, held: 1, pending: 1, completed: 0 })
    expect((await control({ hold: false })).status).toBe(200)
    await expect.poll(history).toMatchObject({ hold: false, held: 0, pending: 0, completed: 2, calls: [null, '2026-10-29'] })
  } finally {
    if (socket !== null) { socket.terminate(); await once(socket, 'close') }
    await e2e.close()
  }
})
