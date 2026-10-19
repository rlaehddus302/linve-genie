// AC-S04-60 실시간 푸시 — 연결 순서 (RA-S04-003·SA-S04-005)
// 연결을 먼저 등록한 뒤 범위별 seq를 읽는다. 읽는 동안 커밋된 변경을 놓치지 않고, ready에 이미 들어 있는 변경은 두 번 보내지 않는다.
import { afterEach, describe, expect, it } from 'vitest'
import { StreamHub, type ScopeSeq, type StreamNotice } from '../src/hub.ts'
import { sseReader } from './support.ts'

const hubs: StreamHub[] = []
const readers: ReturnType<typeof sseReader>[] = []

afterEach(async () => {
  for (const reader of readers.splice(0)) await reader.cancel().catch(() => {})
  for (const hub of hubs.splice(0)) hub.closeAll()
})

function newHub(): StreamHub {
  const hub = new StreamHub({ heartbeatMs: 30_000, sessionAlive: () => Promise.resolve(true) })
  hubs.push(hub)
  return hub
}

/** 범위별 seq 읽기를 시험이 원하는 때에 끝낸다 */
function deferredScopes() {
  let resolve: (scopes: readonly ScopeSeq[]) => void = () => {}
  let reject: (error: unknown) => void = () => {}
  let started = false
  const promise = new Promise<readonly ScopeSeq[]>((res, rej) => {
    resolve = res
    reject = rej
  })
  return {
    read: () => {
      started = true
      return promise
    },
    get started() {
      return started
    },
    resolve: (scopes: readonly ScopeSeq[]) => resolve(scopes),
    reject: (error: unknown) => reject(error),
  }
}

function read(response: Response) {
  const reader = sseReader(response)
  readers.push(reader)
  return reader
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
const changes = (reader: ReturnType<typeof sseReader>) => reader.events.filter((event) => event.event === 'change').map((event) => ({ id: event.id, ...(JSON.parse(event.data) as StreamNotice) }))
const notice = (date: string, seq: number, type = 'chat', rehearsal = false): StreamNotice => ({ date, rehearsal, seq, type })

describe('SSE 연결 순서 (RA-S04-003·SA-S04-005)', () => {
  it('seq를 읽는 동안 커밋된 변경도 ready 뒤에 보낸다 — ready에 이미 들어 있는 변경(그 날짜 seq 이하)은 거른다', async () => {
    const hub = newHub()
    const scopes = deferredScopes()
    const opening = hub.open('s1', 'h1', scopes.read)
    expect(scopes.started).toBe(true)
    expect(hub.pendingSize).toBe(1)
    // 읽는 동안: 10/18 seq 5는 읽기에 반영된 커밋, 6·7은 읽기 뒤 커밋, 10/19는 읽는 동안 새로 생긴 범위
    hub.publish('s1', [notice('2026-10-18', 5)])
    hub.publish('s1', [notice('2026-10-18', 6), notice('2026-10-19', 1, 'broadcast.start')])
    hub.publish('s2', [notice('2026-10-18', 9)]) // 다른 판매자
    scopes.resolve([{ date: '2026-10-18', rehearsal: false, seq: 5 }])
    const reader = read(await opening)
    expect(hub.pendingSize).toBe(0)
    expect(hub.size).toBe(1)
    hub.publish('s1', [notice('2026-10-18', 7)])
    await reader.until(() => changes(reader).length >= 3)
    await settle()
    expect(reader.events[0]).toMatchObject({ event: 'ready', id: null })
    expect(JSON.parse(reader.events[0]?.data ?? '{}')).toEqual({ scopes: [{ date: '2026-10-18', rehearsal: false, seq: 5 }] })
    expect(changes(reader)).toEqual([
      { id: '1', date: '2026-10-18', rehearsal: false, seq: 6, type: 'chat' },
      { id: '2', date: '2026-10-19', rehearsal: false, seq: 1, type: 'broadcast.start' },
      { id: '3', date: '2026-10-18', rehearsal: false, seq: 7, type: 'chat' },
    ])
  })

  it('연결 뒤 늦게 도착한 알림이라도 ready seq 이하면 보내지 않는다 (같은 변경이 ready와 change로 두 번 오지 않는다)', async () => {
    const hub = newHub()
    const reader = read(await hub.open('s1', 'h1', () => Promise.resolve([{ date: '2026-10-18', rehearsal: false, seq: 12 }])))
    // 커밋 → seq 읽기(12가 보임) → 연결 → 그 커밋의 알림이 이제 도착
    hub.publish('s1', [notice('2026-10-18', 11), notice('2026-10-18', 12)])
    hub.publish('s1', [notice('2026-10-18', 13)])
    await reader.until(() => changes(reader).length >= 1)
    await settle()
    expect(changes(reader)).toEqual([{ id: '1', date: '2026-10-18', rehearsal: false, seq: 13, type: 'chat' }])
  })

  it('예전 순서(seq를 먼저 읽고 등록)였다면 놓쳤을 변경: 읽기와 등록 사이 커밋을 받는다', async () => {
    const hub = newHub()
    // 읽기 함수 안에서(= 읽은 직후, 응답을 만들기 전) 커밋 알림이 온다
    const response = await hub.open('s1', 'h1', () => {
      const scopes = [{ date: '2026-10-18', rehearsal: false, seq: 3 }]
      queueMicrotask(() => hub.publish('s1', [notice('2026-10-18', 4, 'product.register')]))
      return Promise.resolve(scopes)
    })
    const reader = read(response)
    await reader.until(() => changes(reader).length >= 1)
    expect(changes(reader)).toEqual([{ id: '1', date: '2026-10-18', rehearsal: false, seq: 4, type: 'product.register' }])
  })

  it('seq 읽기가 실패하면 등록을 지우고 오류를 그대로 던진다 (모아 둔 알림도 버린다)', async () => {
    const hub = newHub()
    const scopes = deferredScopes()
    const opening = hub.open('s1', 'h1', scopes.read)
    hub.publish('s1', [notice('2026-10-18', 1)])
    scopes.reject(new Error('DB 고장'))
    await expect(opening).rejects.toThrow('DB 고장')
    expect(hub.pendingSize).toBe(0)
    expect(hub.size).toBe(0)
  })

  it('seq를 읽는 동안 로그아웃·종료되면 ready 없이 닫힌 응답이고 등록되지 않는다 (다른 세션은 그대로)', async () => {
    const hub = newHub()
    const mine = deferredScopes()
    const theirs = deferredScopes()
    const openingMine = hub.open('s1', 'h1', mine.read)
    const openingTheirs = hub.open('s1', 'h2', theirs.read)
    hub.closeSession('h1')
    mine.resolve([])
    theirs.resolve([])
    const closed = read(await openingMine)
    const open = read(await openingTheirs)
    await closed.until(() => closed.closed)
    expect(closed.events).toEqual([])
    await open.until(() => open.events.length >= 1)
    expect(open.closed).toBe(false)
    expect(hub.size).toBe(1)

    const late = deferredScopes()
    const openingLate = hub.open('s1', 'h3', late.read)
    hub.closeAll()
    late.resolve([])
    const lateReader = read(await openingLate)
    await lateReader.until(() => lateReader.closed)
    expect(lateReader.events).toEqual([])
    expect(hub.size).toBe(0)
    expect(hub.pendingSize).toBe(0)
  })
})
