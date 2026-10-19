// @vitest-environment node
// 서비스 워커 (AC-S06-51, D-093): 그 빌드의 앱 껍데기만 저장하고 /api/(SSE 포함)·다른 출처·GET 아닌 요청은 가로채지 않는다.
// 페이지 이동은 네트워크 먼저, 끊기면 저장한 index.html. 새 버전은 SKIP_WAITING 메시지에만 바뀐다.
// 브라우저 서비스 워커 대신 가짜 범위(self)에 serviceWorkerMain을 붙여 사건을 보낸다. 만든 /sw.js 글자도 node:vm으로 실제로 돌려 본다.
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { serviceWorkerMain, serviceWorkerSource, type ShellManifest, type SwCache, type SwScope } from '../pwa/service-worker.ts'

const ORIGIN = 'http://localhost:5173'
const SHELL: ShellManifest = { version: 'v1', files: ['/index.html', '/assets/index-abc.js', '/assets/index-abc.css', '/manifest.webmanifest', '/icons/icon-192.png'] }

class FakeCache implements SwCache {
  readonly store = new Map<string, Response>()
  async addAll(requests: string[]): Promise<void> {
    for (const url of requests) this.store.set(new URL(url, ORIGIN).pathname, new Response(`저장한 ${url}`))
  }
  /** 브라우저 Cache처럼: Vary를 무시하라고 하지 않으면 crossorigin(Origin 머리) 요청은 저장한 것과 맞지 않는다 */
  async match(request: Request | string, options: { ignoreVary?: boolean } = {}): Promise<Response | undefined> {
    const url = typeof request === 'string' ? new URL(request, ORIGIN) : new URL(request.url)
    if (options.ignoreVary !== true && typeof request !== 'string') return undefined
    return this.store.get(url.pathname)?.clone()
  }
}

function fakeScope(network: (request: Request) => Promise<Response>) {
  const listeners = new Map<string, (event: never) => void>()
  const caches = new Map<string, FakeCache>()
  let skipped = 0
  const scope: SwScope = {
    location: { origin: ORIGIN },
    caches: {
      open: async (name) => {
        const cache = caches.get(name) ?? new FakeCache()
        caches.set(name, cache)
        return cache
      },
      keys: async () => [...caches.keys()],
      delete: async (name) => caches.delete(name),
    },
    fetch: network,
    skipWaiting: async () => {
      skipped++
    },
    addEventListener: (type, listener) => listeners.set(type, listener),
  }
  const dispatch = async (type: string, event: object): Promise<void> => {
    const listener = listeners.get(type)
    if (listener === undefined) throw new Error(`${type} 처리기가 없다`)
    listener(event as never)
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return { scope, caches, dispatch, skipped: () => skipped, listeners }
}

/** fetch 사건 하나: 가로챘으면 그 응답, 아니면 null (브라우저가 그대로 보낸다) */
async function fetchEvent(dispatch: (type: string, event: object) => Promise<void>, url: string, init: { method?: string; mode?: string } = {}): Promise<Response | null> {
  let responded: Promise<Response> | Response | null = null
  const request = { url, method: init.method ?? 'GET', mode: init.mode ?? 'cors' } as unknown as Request
  await dispatch('fetch', { request, respondWith: (response: Promise<Response> | Response) => (responded = response) })
  return responded === null ? null : await responded
}

async function installed(network: (request: Request) => Promise<Response> = async () => new Response('네트워크')) {
  const sw = fakeScope(network)
  serviceWorkerMain(sw.scope, SHELL)
  const waits: Promise<unknown>[] = []
  await sw.dispatch('install', { waitUntil: (promise: Promise<unknown>) => waits.push(promise) })
  await Promise.all(waits)
  return sw
}

describe('서비스 워커', () => {
  it('설치하면 그 빌드의 앱 껍데기만 저장한다 (판매 데이터·/api/는 없다)', async () => {
    const sw = await installed()
    expect([...sw.caches.keys()]).toEqual(['livejjim-shell-v1'])
    const stored = [...(sw.caches.get('livejjim-shell-v1')?.store.keys() ?? [])].sort()
    expect(stored).toEqual([...SHELL.files].sort())
    expect(stored.some((path) => path.startsWith('/api'))).toBe(false)
  })

  it('/api/(SSE 포함)·다른 출처·GET이 아닌 요청은 가로채지 않는다', async () => {
    let network = 0
    const sw = await installed(async () => {
      network++
      return new Response('네트워크')
    })
    for (const url of [`${ORIGIN}/api/me`, `${ORIGIN}/api/stream`, `${ORIGIN}/api/days/2026-10-19?rehearsal=true`, `${ORIGIN}/api`, 'https://cdn.example.com/assets/index-abc.js']) {
      expect(await fetchEvent(sw.dispatch, url), url).toBeNull()
    }
    expect(await fetchEvent(sw.dispatch, `${ORIGIN}/api/events`, { method: 'POST' })).toBeNull()
    expect(await fetchEvent(sw.dispatch, `${ORIGIN}/assets/index-abc.js`, { method: 'POST' })).toBeNull()
    // 껍데기 목록에 없는 같은 출처 파일도 그대로
    expect(await fetchEvent(sw.dispatch, `${ORIGIN}/favicon.ico`)).toBeNull()
    expect(network).toBe(0)
  })

  it('껍데기 파일은 저장한 것 먼저 — crossorigin 요청(Vary: Origin)이어도 주소로 찾아 끊겨도 뜬다', async () => {
    let online = true
    let network = 0
    const sw = await installed(async () => {
      network++
      if (!online) throw new TypeError('Failed to fetch')
      return new Response('네트워크')
    })
    expect(await (await fetchEvent(sw.dispatch, `${ORIGIN}/assets/index-abc.js`))?.text()).toBe('저장한 /assets/index-abc.js')
    online = false
    expect(await (await fetchEvent(sw.dispatch, `${ORIGIN}/assets/index-abc.css`))?.text()).toBe('저장한 /assets/index-abc.css')
    expect(network).toBe(0)
  })

  it('페이지 이동은 네트워크 먼저, 끊겼을 때만 저장한 index.html', async () => {
    let online = true
    const sw = await installed(async () => {
      if (!online) throw new TypeError('Failed to fetch')
      return new Response('새 화면')
    })
    expect(await (await fetchEvent(sw.dispatch, `${ORIGIN}/buyers?date=2026-10-19`, { mode: 'navigate' }))?.text()).toBe('새 화면')
    online = false
    expect(await (await fetchEvent(sw.dispatch, `${ORIGIN}/sms`, { mode: 'navigate' }))?.text()).toBe('저장한 /index.html')
  })

  it('새 버전으로 켜지면 옛 껍데기 저장소를 지우고, 화면이 보낸 SKIP_WAITING에만 기다리지 않고 바뀐다', async () => {
    const sw = fakeScope(async () => new Response('네트워크'))
    await sw.scope.caches.open('livejjim-shell-old')
    await sw.scope.caches.open('다른-저장소')
    serviceWorkerMain(sw.scope, SHELL)
    const waits: Promise<unknown>[] = []
    await sw.dispatch('activate', { waitUntil: (promise: Promise<unknown>) => waits.push(promise) })
    await Promise.all(waits)
    expect([...sw.caches.keys()].sort()).toEqual(['다른-저장소'])
    await sw.dispatch('message', { data: { type: '다른 것' } })
    expect(sw.skipped()).toBe(0)
    await sw.dispatch('message', { data: { type: 'SKIP_WAITING' } })
    expect(sw.skipped()).toBe(1)
  })

  it('/sw.js 글자: 껍데기 목록을 담고, 실제로 돌리면 네 사건 처리기를 붙인다 (clients.claim·skipWaiting을 저절로 부르지 않는다)', () => {
    const source = serviceWorkerSource(SHELL)
    expect(source).toContain(JSON.stringify({ version: 'v1', files: SHELL.files }))
    expect(source).not.toMatch(/clients\.claim/)
    const types: string[] = []
    const self = { location: { origin: ORIGIN }, caches: {}, fetch: () => Promise.reject(new Error('쓰지 않음')), skipWaiting: () => Promise.reject(new Error('저절로 부르면 안 된다')), addEventListener: (type: string) => types.push(type) }
    runInNewContext(source, { self, URL, Response, Set, Promise })
    expect(types.sort()).toEqual(['activate', 'fetch', 'install', 'message'])
  })
})
