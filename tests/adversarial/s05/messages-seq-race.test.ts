// S05 적대 테스트 (test-domain): 메시지 이어 받기(GET /days/:date/messages)가 돌려주는 seq와 실제로 담은 메시지의 경계.
// 계약(dev-notes, service.messages 주석): "조회가 본 범위 상태(seq)까지의 메시지만 준다" — 응답 seq까지의 메시지는 모두 담겨야
// 화면이 그 seq 뒤만 증분으로 받아도 빈틈이 없다(AC-S05-20·21·62, TD-S05-001 수정이 이 seq에 기댄다).
//
// service.messages는 범위 상태를 읽어 before=runtime.seq+1로 채팅 행을 조회한 뒤, 응답의 seq를 조회가 끝난 다음에 runtime.seq로 다시 읽는다.
// runtime은 쓰기와 같이 쓰는 객체라 그사이 들어온 채팅이 seq를 올려 둔다 — 응답 seq는 F인데 메시지는 M(<F)까지만 있다.
//
// 그 순간을 재현하려고 채팅 행 조회(store.chatRows)를 한 번 붙잡아, 그 사이에 채팅을 더 넣는다(실제로는 PGlite·Postgres 조회 시간 동안 채팅이 들어오는 순서).
import type { LivejjimServer } from '@livejjim/server'
import type * as StoreModule from '../../../apps/server/src/store.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { harness, startBroadcast, type Harness } from '../s04/helpers.ts'

const gate: { hook: (() => Promise<void>) | null } = { hook: null }

vi.mock('../../../apps/server/src/store.ts', async (importOriginal) => {
  const original = await importOriginal<typeof StoreModule>()
  return {
    ...original,
    chatRows: async (...args: Parameters<typeof original.chatRows>) => {
      const hook = gate.hook
      if (hook !== null) {
        gate.hook = null
        await hook()
      }
      return original.chatRows(...args)
    },
  }
})

const DAY = '2026-10-18'
const STORE_MODULE = '../../../apps/web/src/lib/console-store.ts'

interface StoreLike {
  start(): Promise<void>
  catchUp(): Promise<void>
  stop(): void
  getSnapshot(): { phase: string; messages: readonly { id: string; seq: number }[]; data: { seq: number } | null }
}
type StoreCtor = new (options: { broadcastId: string; openStream: (url: string) => unknown; timer: { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void } }) => StoreLike

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
  gate.hook = null
  store?.stop()
  store = null
  vi.unstubAllGlobals()
  await h?.close()
  h = null
})

interface MessagesBody {
  seq: number
  more: boolean
  messages: { id: string; seq: number }[]
}

async function allMessages(s: LivejjimServer, cookie: string, b: string): Promise<MessagesBody> {
  return (await (await s.app.request(`/api/days/${DAY}/messages?b=${b}&limit=500`, { headers: { Cookie: cookie } })).json()) as MessagesBody
}

describe('TD-S05-005 메시지 조회 응답의 seq가 담은 메시지보다 앞서 나간다 (AC-S05-20·21·62)', () => {
  it('채팅 행을 읽는 사이 채팅이 들어와도, 응답 seq까지의 그 방송 메시지는 응답에 모두 있다', async () => {
    h = await harness()
    const a = await h.account('mseq1')
    const s = h.server
    const b = await startBroadcast(s, a.cookie, DAY)
    for (let i = 0; i < 3; i++) await s.ingestChat(a.sellerId, { b, id: `early${String(i)}`, ch: 'UCe', nick: '손님', text: '안녕하세요' })

    gate.hook = async () => {
      for (let i = 0; i < 2; i++) await s.ingestChat(a.sellerId, { b, id: `mid${String(i)}`, ch: 'UCm', nick: '손님2', text: `15번 주세요 ${String(i)}` })
    }
    const res = (await (await s.app.request(`/api/days/${DAY}/messages?b=${b}&limit=100`, { headers: { Cookie: a.cookie } })).json()) as MessagesBody
    expect(gate.hook).toBeNull()

    const all = await allMessages(s, a.cookie, b)
    const upToSeq = all.messages.filter((m) => m.seq <= res.seq).map((m) => m.id)
    expect(res.more).toBe(false)
    // 응답 seq까지의 메시지 = 응답 메시지
    expect(res.messages.map((m) => m.id)).toEqual(upToSeq)
  }, 60_000)

  it('콘솔을 여는 중 메시지 조회가 채팅 행을 읽는 사이 채팅이 들어오면, 따라잡은 뒤에도 패널에서 그 채팅이 빠진다', async () => {
    h = await harness()
    const a = await h.account('mseq2')
    const s = h.server
    const b = await startBroadcast(s, a.cookie, DAY)
    for (let i = 0; i < 3; i++) await s.ingestChat(a.sellerId, { b, id: `early${String(i)}`, ch: 'UCe', nick: '손님', text: '안녕하세요' })

    let messagesServed!: () => void
    const messagesDone = new Promise<void>((resolve) => {
      messagesServed = resolve
    })
    // 메시지 조회의 채팅 행 읽기 사이에 채팅 3건
    gate.hook = async () => {
      for (let i = 0; i < 3; i++) await s.ingestChat(a.sellerId, { b, id: `mid${String(i)}`, ch: 'UCm', nick: '손님2', text: `15번 예뻐요 ${String(i)}` })
    }
    const fullPath = `/api/days/${DAY}?rehearsal=false`
    vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
      const path = String(input)
      // 전체 조회는 메시지 조회가 끝난 뒤에 응답한다(그 사이 채팅까지 본 seq)
      if (path === fullPath || path === `/api/days/${DAY}`) await messagesDone
      const headers = new Headers(init.headers)
      headers.set('Cookie', a.cookie)
      const response = await s.app.request(path, { ...init, headers })
      const body = await response.text()
      if (path.startsWith(`/api/days/${DAY}/messages`)) messagesServed()
      return new Response(body, { status: response.status, headers: response.headers })
    })

    const { ConsoleStore } = (await import(/* @vite-ignore */ STORE_MODULE)) as { ConsoleStore: StoreCtor }
    store = new ConsoleStore({ broadcastId: b, openStream: () => new SilentStream(), timer: noTimer })
    await store.start()
    await s.ingestChat(a.sellerId, { b, id: 'late0', ch: 'UCl', nick: '손님3', text: '배송은 언제 와요?' })
    await store.catchUp()

    const snapshot = store.getSnapshot()
    expect(snapshot.phase).toBe('ready')
    const all = await allMessages(s, a.cookie, b)
    expect(all.messages.map((m) => m.id)).toEqual(['early0', 'early1', 'early2', 'mid0', 'mid1', 'mid2', 'late0'])
    expect(snapshot.messages.map((m) => m.id)).toEqual(all.messages.map((m) => m.id))
  }, 60_000)
})
