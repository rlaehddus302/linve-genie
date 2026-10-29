// @vitest-environment node
// 실제 HTTP/WS 서버·PGlite에 앱 코드를 잇는다. 네이티브 캡처와 쿠키 저장소만 플랫폼 경계에서 흉내 낸다.
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { createAudioCapture, type NativeAudioModuleLike, type NativeFrameEvent, type WebSocketLike } from '@livejjim/mobile-audio'
import { addSeller, newWorld, ORIGIN } from '../../server/test/support.ts'
import { createNodeServer } from '../../server/src/node-server.ts'
import { configureApi, apiConfig } from '../src/api/config.ts'
import { get, post } from '../src/api/client.ts'
import { bitmapFailure, fetchJobBitmap, fetchTestBitmap } from '../src/api/labels.ts'
import { LiveNativeAudio } from '../src/native/live-audio.ts'
import { VoiceSession } from '../src/lib/voice-session.ts'
import { createVoiceEffects } from '../src/lib/voice-effects.ts'
import { configureVoiceStorage } from '../src/lib/voice-preferences.ts'
import type { FullView } from '@livejjim/web/src/api/types.ts'
import type { EventEmitter } from 'node:events'

interface NodeSocket extends WebSocketLike, EventEmitter { terminate(): void }
const requireServer = createRequire(new URL('../../server/package.json', import.meta.url))
const Ws = requireServer('ws').WebSocket as new (url: string, options: { headers: Record<string, string> }) => NodeSocket
const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); vi.unstubAllEnvs() })
async function until(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const end = Date.now() + 8000
  while (!await predicate()) { if (Date.now() > end) throw new Error('서버 흐름 결과를 받지 못했다'); await new Promise((resolve) => setTimeout(resolve, 20)) }
}
it('앱 로그인 쿠키+Origin → 네이티브 PCM → 서버 전체 읽기 → 앱 효과 HTTP → 실제 상품 DB·서버 라벨', async () => {
  const world = await newWorld({ transcribeWorkerToken: 'mobile-integration-local-worker', clock: { now: () => Date.now(), set: () => undefined, advance: () => undefined } })
  cleanups.push(async () => { world.server.close(); await world.database.close() })
  const seller = await addSeller(world)
  const server = createNodeServer({ app: world.server.app })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('주소가 없다')
  const base = `http://127.0.0.1:${address.port}`
  const wsBase = base.replace(/^http/, 'ws')
  let cookie = ''
  const writes: { origin: string | null; credentials: RequestCredentials | undefined }[] = []
  vi.stubEnv('EXPO_PUBLIC_APP_ORIGIN', ORIGIN)
  configureApi({ baseUrl: base, newId: randomUUID, fetch: async (url, init) => {
    const headers = new Headers(init?.headers)
    if (cookie) headers.set('Cookie', cookie)
    if (init?.method === 'POST') writes.push({ origin: headers.get('Origin'), credentials: init.credentials })
    const response = await fetch(url, { ...init, headers })
    const set = response.headers.get('set-cookie')
    if (set) cookie = set.split(';')[0] ?? ''
    return response
  } })
  const me = await post<{ seller: { id: string } }>('/api/login', { loginId: seller.loginId, password: seller.password })
  expect(me).toBeTruthy(); expect(cookie).toMatch(/^lj_session=/)
  expect(await get('/api/me')).toMatchObject(me)
  const { broadcast } = await post<{ broadcast: { id: string; date: string; rehearsal: boolean } }>('/api/broadcasts', { requestId: randomUUID(), title: '앱 서버 통합', rehearsal: true })
  const worker = new Ws(`${wsBase}/api/voice/worker`, { headers: { Authorization: 'Bearer mobile-integration-local-worker' } })
  cleanups.push(() => worker.terminate())
  await once(worker, 'open')
  const workerFrames: Buffer[] = []
  worker.on('message', (raw: Buffer, binary: boolean) => { if (binary) workerFrames.push(Buffer.from(raw)) })
  worker.send(JSON.stringify({ type: 'hello', maxStreams: 1 }))
  await until(() => world.server.voice.status().workers === 1)
  let emitFrame: ((frame: NativeFrameEvent) => void) | undefined
  const native = {
    start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined),
    getPermission: async () => ({ status: 'granted', granted: true, canAskAgain: true }), requestPermission: async () => ({ status: 'granted', granted: true, canAskAgain: true }),
    addListener: (event: string, cb: unknown) => { if (event === 'frame') emitFrame = cb as (frame: NativeFrameEvent) => void; return { remove() {} } },
  } as NativeAudioModuleLike
  const capture = createAudioCapture(native)
  const sockets: NodeSocket[] = []
  const audio = new LiveNativeAudio(() => capture, (url, headers) => { const socket = new Ws(url, { headers: { ...headers, Cookie: cookie } }); sockets.push(socket); return socket })
  const seen: unknown[] = []
  audio.onSession((message) => { if ((message as { type: string }).type !== 'voice.state') seen.push(message) })
  cleanups.push(() => { for (const socket of sockets) socket.terminate() })
  configureVoiceStorage({ getItem: async () => null, setItem: async () => undefined })
  const session = new VoiceSession({ audio, deviceId: 'mobiletest01', register: async () => undefined, undoRegister: async () => undefined, effect: createVoiceEffects(async () => broadcast) })
  cleanups.push(async () => { await session.turnOff(); session.dispose() })
  await session.turnOn(broadcast.id, '앱 서버 통합'); await session.acceptConsent()
  await until(() => session.getView().remote?.phase === 'on')
  emitFrame?.({ pcm: new Uint8Array(3200), capturedAtMs: Date.now() - 300 })
  await until(() => workerFrames.length > 0)
  expect(workerFrames[0]!.byteLength).toBe(3204)
  worker.send(JSON.stringify({ type: 'result', stream: workerFrames[0]!.readUInt32BE(0), text: '15번 2만 원', startMs: 0, endMs: 100, procMs: 1 }))
  let data: FullView | undefined
  try { await until(async () => { data = await get<FullView>(`/api/days/${broadcast.date}?rehearsal=true`); return data.products.some((product) => product.no === 15) }) } catch { throw new Error(JSON.stringify({ state: session.getView().state, problem: session.getView().problem, cards: session.getView().remote?.cards, notes: [...(session.getView().remote?.notes ?? [])], heard: session.getView().heard, seen })) }
  expect(data!.products.filter((product) => product.no === 15)).toHaveLength(1)
  expect(data!.products.find((product) => product.no === 15)).toMatchObject({ price: 20000 })
  expect(writes.every((call) => call.origin === ORIGIN && call.credentials === 'include')).toBe(true)
  session.setInstant(false)
  await until(() => session.getView().remote?.instant === false)
  worker.send(JSON.stringify({ type: 'result', stream: workerFrames[0]!.readUInt32BE(0), text: '16번 3만 원', startMs: 100, endMs: 200, procMs: 1 }))
  await until(() => session.getView().remote?.cards.some((card) => card.no === 16) === true)
  const card = session.getView().remote!.cards.find((item) => item.no === 16)!
  await session.turnOff()
  expect(session.getView().remote!.cards.some((item) => item.id === card.id)).toBe(true)
  session.command('openForm', [card.id])
  await until(() => session.getView().remote?.forms.has(card.id) === true)
  expect(native.start).toHaveBeenCalledTimes(1)
  expect(session.getView().on).toBe(false)
  session.command('editForm', [card.id, { price: '4만' }])
  session.command('submitForm', [card.id])
  await until(async () => (await get<FullView>(`/api/days/${broadcast.date}?rehearsal=true`)).products.some((item) => item.no === 16 && item.price === 40000))
  // OFF 중 수동 처리가 끝나면 제어용 연결도 닫고, 마이크는 다시 켜지 않는다.
  await until(() => sockets[1]?.readyState === 3)
  expect(native.start).toHaveBeenCalledTimes(1)
  await session.turnOn(broadcast.id, '앱 서버 통합')
  await until(() => session.getView().remote?.phase === 'on')
  expect(native.start).toHaveBeenCalledTimes(2)
  expect((await get<FullView>(`/api/days/${broadcast.date}?rehearsal=true`)).products.filter((item) => item.no === 16)).toHaveLength(1)
  const bitmap = await fetchTestBitmap()
  expect(bitmap.data.some((pixel) => pixel !== 0)).toBe(true)
  await session.turnOff()
  const { broadcast: live } = await post<{ broadcast: { id: string } }>('/api/broadcasts', { requestId: randomUUID(), title: '라벨 서버 통합' })
  await post('/api/events', { requestId: randomUUID(), type: 'product.register', b: live.id, no: 16, name: '핑크프릴', price: 20000 })
  await world.server.ingestChat(seller.sellerId, { b: live.id, id: 'mobile-label-chat', ch: 'mobile-viewer', nick: '손님', text: '16' })
  await post('/api/print/device', { deviceId: 'mobiletest01', name: '시험 휴대폰' })
  await post('/api/print/restart', {})
  const { job } = await post<{ job: { id: string; attempt: string } | null }>('/api/print/claim', { deviceId: 'mobiletest01' })
  expect(job).not.toBeNull()
  const actual = await fetchJobBitmap(job!, 'mobiletest01')
  expect(actual.data.some((pixel) => pixel !== 0)).toBe(true)
  const realFetch = apiConfig().fetch
  configureApi({ fetch: async (url, init) => url.includes('/bitmap?') ? new Response(JSON.stringify({ width: 8, height: 1, data: 'broken' }), { status: 200 }) : realFetch(url, init) })
  let imageError: unknown
  try { await fetchJobBitmap(job!, 'mobiletest01') } catch (error) { imageError = error }
  configureApi({ fetch: realFetch })
  const failure = bitmapFailure(imageError)
  expect(failure.code).toBe('INVALID_IMAGE')
  expect(await post('/api/print/result', { deviceId: 'mobiletest01', attempt: job!.attempt, ok: false, error: { code: failure.code } })).toMatchObject({ recorded: true })
  cookie = '' 
  await expect(get('/api/me')).rejects.toMatchObject({ status: 401 })
}, 20000)
