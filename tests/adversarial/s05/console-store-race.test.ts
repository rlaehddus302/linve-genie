// S05 적대 테스트 (test-domain): 화면 자료층(ConsoleStore)을 실제 서버(PGlite)에 붙여, 채팅이 흐르는 중에 콘솔을 여는 순서를 공격한다.
// AC-S05-21 "콘솔에 그 방송의 채팅이 오래된 것 위·새것 아래로 보인다" · AC-S05-62 "다시 붙으면 놓친 변경을 증분으로 받는다".
//
// ConsoleStore.#loadAll은 범위 전체 조회와 최근 메시지 조회를 동시에 보낸다. 메시지 조회가 먼저 끝나고(범위 seq M)
// 그사이 채팅이 더 들어온 뒤 전체 조회가 끝나면(범위 seq F > M), 화면이 아는 seq는 F가 되고 증분 조회는 since=F로만 간다 —
// (M, F] 사이의 채팅은 다시 받을 길이 없다("이전 메시지 보기"는 가장 오래된 메시지 앞만 받는다).
//
// 화면 파일은 DOM 타입으로 검사하므로(루트 tsconfig는 Node 타입) 타입 검사를 거치지 않게 경로를 값으로 불러온다.
import type { LivejjimServer } from '@livejjim/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { harness, startBroadcast, type Harness } from '../s04/helpers.ts'

const DAY = '2026-10-18'
const STORE_MODULE = '../../../apps/web/src/lib/console-store.ts'

interface StoreLike {
  start(): Promise<void>
  catchUp(): Promise<void>
  stop(): void
  getSnapshot(): { phase: string; messages: readonly { id: string; seq: number }[]; data: { seq: number } | null }
}
type StoreCtor = new (options: { broadcastId: string; openStream: (url: string) => unknown; timer: { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void } }) => StoreLike

/** 이벤트를 하나도 내지 않는 SSE (알림은 시험이 catchUp으로 대신한다) */
class SilentStream {
  readonly readyState = 1
  onopen: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  addEventListener(): void {}
  close(): void {}
}

const noTimer = { set: () => undefined, clear: () => undefined }

let h: Harness | null = null
let store: StoreLike | null = null
afterEach(async () => {
  store?.stop()
  store = null
  vi.unstubAllGlobals()
  await h?.close()
  h = null
})

/** 화면의 fetch(같은 출처 /api)를 프로세스 안 서버로 보낸다. hold(path)가 promise를 주면 그 뒤에 응답한다 */
function routeFetch(server: () => LivejjimServer, cookie: string, hold: (path: string) => Promise<void> | null, served: (path: string) => void): void {
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const path = String(input)
    const wait = hold(path)
    if (wait !== null) await wait
    const headers = new Headers(init.headers)
    headers.set('Cookie', cookie)
    const response = await server().app.request(path, { ...init, headers })
    const body = await response.text()
    served(path)
    return new Response(body, { status: response.status, headers: response.headers })
  })
}

describe('TD-S05-001 콘솔을 여는 중에 들어온 채팅이 채팅 패널에서 빠진다 (AC-S05-21·62)', () => {
  it('메시지 조회가 먼저 끝나고 그사이 채팅 3건이 들어온 뒤 전체 조회가 끝나도, 따라잡은 뒤 패널에는 그 방송의 채팅이 모두 있다', async () => {
    h = await harness()
    const a = await h.account('race1')
    const s = h.server
    const b = await startBroadcast(s, a.cookie, DAY)
    for (let i = 0; i < 3; i++) await s.ingestChat(a.sellerId, { b, id: `early${String(i)}`, ch: 'UCe', nick: '손님', text: '안녕하세요' })

    let messagesServed!: () => void
    const messagesDone = new Promise<void>((resolve) => {
      messagesServed = resolve
    })
    const fullPath = `/api/days/${DAY}`
    routeFetch(
      () => s,
      a.cookie,
      (path) => {
        // 전체 조회: 메시지 조회가 끝난 뒤, 채팅 3건이 더 들어온 다음에 응답한다
        if (path === fullPath) {
          return messagesDone.then(async () => {
            for (let i = 0; i < 3; i++) await s.ingestChat(a.sellerId, { b, id: `mid${String(i)}`, ch: 'UCm', nick: '손님2', text: `15번 예뻐요 ${String(i)}` })
          })
        }
        return null
      },
      (path) => {
        if (path.startsWith(`/api/days/${DAY}/messages`)) messagesServed()
      },
    )

    const { ConsoleStore } = (await import(/* @vite-ignore */ STORE_MODULE)) as { ConsoleStore: StoreCtor }
    store = new ConsoleStore({ broadcastId: b, openStream: () => new SilentStream(), timer: noTimer })
    await store.start()
    // 그 뒤 채팅 1건 + 알림 → 증분 따라잡기
    await s.ingestChat(a.sellerId, { b, id: 'late0', ch: 'UCl', nick: '손님3', text: '배송은 언제 와요?' })
    await store.catchUp()

    const snapshot = store.getSnapshot()
    expect(snapshot.phase).toBe('ready')
    const server = await (await s.app.request(`/api/days/${DAY}/messages?b=${b}&limit=500`, { headers: { Cookie: a.cookie } })).json() as { messages: { id: string }[] }
    expect(server.messages.map((m) => m.id)).toEqual(['early0', 'early1', 'early2', 'mid0', 'mid1', 'mid2', 'late0'])
    // 화면 패널 = 서버의 그 방송 채팅 (빈틈 없이)
    expect(snapshot.messages.map((m) => m.id)).toEqual(server.messages.map((m) => m.id))
  }, 60_000)
})

/** 손으로 부르는 SSE: 시험이 ready를 보내고, 끊김(닫힘)을 흉내 낸다. generator 알림은 보내지 않는다(끊긴 사이) */
class ManualStream {
  static all: ManualStream[] = []
  readyState = 0
  onopen: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  readonly listeners = new Map<string, ((event: { data: string }) => void)[]>()
  constructor() {
    ManualStream.all.push(this)
  }
  addEventListener(type: string, listener: (event: { data: string }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  emit(type: string, data: unknown): void {
    this.readyState = 1
    for (const listener of this.listeners.get(type) ?? []) listener({ data: JSON.stringify(data) })
  }
  drop(): void {
    this.readyState = 2
    this.onerror?.({})
  }
  close(): void {
    this.readyState = 2
  }
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve))
}

describe('TD-S05-002 끊긴 사이에 멈춘 리허설 생성기가 다시 붙은 뒤에도 "실행 중"으로 남는다 (AC-S05-54·62)', () => {
  it('생성기가 도는 중에 연결이 끊기고 그사이 다 보내 멈추면, 다시 붙은 뒤 조작판 상태는 멈춤(다 보냈어요)이다', async () => {
    const jobs: (() => void)[] = []
    const timer = { schedule: (_ms: number, fn: () => void) => (jobs.push(fn), () => undefined) }
    h = await harness({ generatorTimer: timer })
    const a = await h.account('race2')
    const s = h.server
    const created = await (
      await s.app.request('/api/broadcasts', {
        method: 'POST',
        headers: { Cookie: a.cookie, Origin: 'https://app.test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: 'rh1', date: DAY, rehearsal: true }),
      })
    ).json() as { broadcast: { id: string } }
    const b = created.broadcast.id
    const start = await s.app.request(`/api/broadcasts/${b}/rehearsal/generator/start`, {
      method: 'POST',
      headers: { Cookie: a.cookie, Origin: 'https://app.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ total: 2, perSecond: 1, seed: 7 }),
    })
    expect(start.status).toBe(200)

    routeFetch(() => s, a.cookie, () => null, () => undefined)
    const reconnects: (() => void)[] = []
    const storeTimer = { set: (fn: () => void) => (reconnects.push(fn), reconnects.length), clear: () => undefined }
    ManualStream.all = []
    const { ConsoleStore } = (await import(/* @vite-ignore */ STORE_MODULE)) as { ConsoleStore: StoreCtor }
    store = new ConsoleStore({ broadcastId: b, openStream: () => new ManualStream(), timer: storeTimer })
    await store.start()
    await settle()
    const generatorOf = () => (store?.getSnapshot() as unknown as { generator: { running: boolean; sent: number; stopReason: string | null } | null }).generator
    expect(generatorOf()?.running).toBe(true)

    // 연결이 아주 끊긴다(브라우저가 다시 붙지 않는 닫힘) — 그사이 생성기가 2건을 다 보내고 멈춘다
    ;(ManualStream.all.at(-1) as ManualStream).drop()
    while (jobs.length > 0) {
      ;(jobs.shift() as () => void)()
      await settle()
    }
    const server = await (await s.app.request(`/api/broadcasts/${b}/rehearsal/generator`, { headers: { Cookie: a.cookie } })).json() as { generator: { running: boolean; stopReason: string } }
    expect(server.generator).toMatchObject({ running: false, stopReason: 'completed' })

    // 다시 붙는다: 세션 확인 → 새 연결 → ready
    while (reconnects.length > 0) {
      ;(reconnects.shift() as () => void)()
      await settle()
    }
    const days = await (await s.app.request('/api/days?rehearsal=true', { headers: { Cookie: a.cookie } })).json() as { days: unknown[] }
    ;(ManualStream.all.at(-1) as ManualStream).emit('ready', { scopes: days.days })
    await settle()
    expect(store.getSnapshot().data?.seq).toBe((days.days[0] as { seq: number }).seq)
    expect(generatorOf()).toMatchObject({ running: false, stopReason: 'completed', sent: 2 })
  }, 60_000)
})
