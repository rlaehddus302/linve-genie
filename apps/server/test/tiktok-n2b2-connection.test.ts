// 틱톡 연결 모듈 보강 — N2b-1에서 넘어온 것 (N2b-2, AC-N2b-2-40~45, D-N2b-2-11). 가짜 웹캐스트·바꿔 끼운 라이브러리 생성자·주입한 가짜 시계로 돈다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LogRecord } from '../src/log.ts'
import {
  classifyWebcastFailure,
  createTikTokAttemptLimiter,
  fakeLibraryError,
  fakeNoRoomError,
  FakeTikTokClock,
  FakeWebcast,
  libraryWebcast,
  TIKTOK_STALL_MS,
  type LibraryConnectionConstructor,
  type TikTokClock,
} from '../src/tiktok/index.ts'
import { brief, chatFields, freshId, iso, rig, SEC } from './tiktok-support.ts'

const leaks: unknown[] = []
const onLeak = (error: unknown): void => {
  leaks.push(error)
}
beforeEach(() => {
  leaks.length = 0
  process.on('unhandledRejection', onLeak)
  process.on('uncaughtException', onLeak)
})
afterEach(() => {
  process.off('unhandledRejection', onLeak)
  process.off('uncaughtException', onLeak)
  expect(leaks).toEqual([])
})

describe('AC-N2b-2-40 조용히 멈춘 연결 (120초)', () => {
  it('마지막 자료(연결된 순간 포함)에서 119,999ms에는 CONNECTED, 120,000ms에 닫고 RETRYING/NETWORK·missed·failures 1, 다음 시도 5초 뒤', async () => {
    const r = rig()
    r.conn.start()
    await r.flush()
    expect(r.conn.status().state).toBe('CONNECTED')
    const handle = r.fake.last
    await r.clock.advanceTo(TIKTOK_STALL_MS - 1)
    expect(r.conn.status().state).toBe('CONNECTED')
    expect(handle?.closed).toBe(false)
    await r.clock.advanceTo(TIKTOK_STALL_MS)
    expect(brief(r.conn.status())).toEqual({ state: 'RETRYING', reason: 'NETWORK', failures: 1, nextAttemptAt: iso(125) })
    expect(r.conn.status().missed).toBe(true)
    expect(handle?.closedByClient).toBe(true)
    expect(r.logs.map((l) => l.code)).toContain('TIKTOK_STALLED')
    // 닫은 연결로 늦게 온 댓글은 레코드가 되지 않는다
    handle?.chat(chatFields(freshId()))
    await r.at(125)
    expect(r.records).toEqual([])
    expect(r.fake.attempts).toBe(2)
    expect(r.conn.status()).toMatchObject({ state: 'CONNECTED', missed: true })
  })

  it('댓글이 아닌 자료가 100초마다 오면 10분 동안 끊지 않는다', async () => {
    const r = rig()
    r.conn.start()
    await r.flush()
    for (let t = 100; t <= 600; t += 100) {
      await r.at(t)
      r.fake.last?.emit('member', { user: { uniqueId: 'someone' } })
    }
    await r.at(600 + 119)
    expect(r.conn.status()).toMatchObject({ state: 'CONNECTED', missed: false })
    expect(r.fake.attempts).toBe(1)
    await r.at(600 + 120)
    expect(r.conn.status()).toMatchObject({ state: 'RETRYING', reason: 'NETWORK' })
  })

  it('댓글도 자료다 — 받는 중 댓글이 오면 시계를 되돌린다', async () => {
    const r = rig()
    r.conn.start()
    await r.flush()
    await r.at(100)
    r.fake.last?.chat(chatFields(freshId()))
    await r.at(219)
    expect(r.conn.status().state).toBe('CONNECTED')
    await r.at(220)
    expect(r.conn.status().state).toBe('RETRYING')
  })

  it('실제 감싸개: 라이브러리의 websocketData(받은 모든 자료)가 시계를 되돌린다 — 라이브러리 생성자를 바꿔 끼움', async () => {
    const clock = new FakeTikTokClock(0)
    const libs: { emit(event: string, ...args: unknown[]): void }[] = []
    class Lib {
      #listeners = new Map<string, ((...args: unknown[]) => void)[]>()
      constructor() {
        libs.push(this)
      }
      connect() {
        return Promise.resolve({ isConnected: true })
      }
      disconnect() {
        return Promise.resolve()
      }
      on(event: string, listener: (...args: unknown[]) => void) {
        this.#listeners.set(event, [...(this.#listeners.get(event) ?? []), listener])
        return this
      }
      emit(event: string, ...args: unknown[]) {
        for (const l of this.#listeners.get(event) ?? []) l(...args)
      }
    }
    const r = rig({ clock, webcast: libraryWebcast({ Connection: Lib as unknown as LibraryConnectionConstructor, clock }) })
    r.conn.start()
    await r.flush()
    expect(r.conn.status().state).toBe('CONNECTED')
    await r.at(110)
    libs[0]?.emit('websocketData', new Uint8Array([1]))
    await r.at(229)
    expect(r.conn.status().state).toBe('CONNECTED')
    await r.at(230)
    expect(r.conn.status().state).toBe('RETRYING')
  })
})

/** connect()가 delayMs 뒤에 성공하는 가짜 라이브러리 (열린 연결 수·끊기 호출을 센다) */
function slowLibrary(clock: TikTokClock, delayMs: number) {
  const counts = { open: 0, maxOpen: 0 }
  const instances: SlowLib[] = []
  class SlowLib {
    state: 'idle' | 'pending' | 'open' | 'closed' = 'idle'
    disconnects: number[] = []
    #listeners = new Map<string, ((...args: unknown[]) => void)[]>()
    constructor() {
      instances.push(this)
    }
    connect() {
      this.state = 'pending'
      return new Promise((resolve) => {
        clock.setTimer(delayMs, () => {
          this.state = 'open'
          counts.open += 1
          counts.maxOpen = Math.max(counts.maxOpen, counts.open)
          resolve({ isConnected: true })
        })
      })
    }
    disconnect() {
      this.disconnects.push(clock.now())
      if (this.state === 'open') {
        this.state = 'closed'
        counts.open -= 1
      }
      return Promise.resolve()
    }
    on(event: string, listener: (...args: unknown[]) => void) {
      this.#listeners.set(event, [...(this.#listeners.get(event) ?? []), listener])
      return this
    }
    emit(event: string, ...args: unknown[]) {
      for (const l of this.#listeners.get(event) ?? []) l(...args)
    }
  }
  return { Lib: SlowLib as unknown as LibraryConnectionConstructor, instances, counts }
}

describe('AC-N2b-2-41 버린 시도의 늦은 연결', () => {
  it('connect()가 25초 뒤 성공 → 20초에 RETRYING/NETWORK, 25초에 그 클라이언트 끊기 1번, 그 뒤 그 클라이언트 댓글은 레코드 0, 열린 연결은 많아야 하나', async () => {
    const clock = new FakeTikTokClock(0)
    const slow = slowLibrary(clock, 25 * SEC)
    const r = rig({ clock, webcast: libraryWebcast({ Connection: slow.Lib, clock }) })
    r.conn.start()
    await r.at(20)
    expect(brief(r.conn.status())).toEqual({ state: 'RETRYING', reason: 'NETWORK', failures: 1, nextAttemptAt: iso(25) })
    const first = slow.instances[0]
    const before = first?.disconnects.filter((at) => at >= 25 * SEC).length
    expect(before).toBe(0)
    await r.at(25)
    expect(first?.disconnects.filter((at) => at === 25 * SEC)).toHaveLength(1)
    expect(first?.state).toBe('closed')
    first?.emit('chat', { common: { msgId: freshId() }, user: { userId: '7101', uniqueId: 'a', nickname: 'a' }, comment: '15' })
    await r.at(200)
    expect(r.records).toEqual([])
    expect(slow.counts.maxOpen).toBeLessThanOrEqual(1)
  })

  it('stop() 뒤 늦게 열린 연결도 바로 닫고, 다시 start()해도 열린 연결은 하나', async () => {
    const clock = new FakeTikTokClock(0)
    const slow = slowLibrary(clock, 15 * SEC)
    const r = rig({ clock, webcast: libraryWebcast({ Connection: slow.Lib, clock }) })
    r.conn.start()
    await r.at(5)
    r.conn.stop()
    r.conn.start()
    await r.at(60)
    expect(slow.counts.maxOpen).toBe(1)
    expect(slow.counts.open).toBe(1)
    expect(r.conn.status().state).toBe('CONNECTED')
    expect(slow.instances[0]?.state).toBe('closed')
  })
})

describe('AC-N2b-2-42 서버 전체 연결 시도 한도 (60초에 30번)', () => {
  it('판매자 31명이 t=0에 시작 → 시도 30(t=0), 59,999ms에도 30, 31번째는 t=60,000ms', async () => {
    const clock = new FakeTikTokClock(0)
    const fake = new FakeWebcast()
    const limiter = createTikTokAttemptLimiter()
    const rigs = Array.from({ length: 31 }, (_, i) => {
      const id = `seller_${String(i).padStart(2, '0')}`
      fake.account(id, 'LIVE')
      return rig({ clock, fake, target: id, sellerId: `s${String(i)}`, extra: { limiter } })
    })
    for (const r of rigs) r.conn.start()
    await clock.advanceTo(0)
    expect(fake.attempts).toBe(30)
    const waiting = rigs.filter((r) => r.conn.status().state === 'CONNECTING')
    expect(waiting).toHaveLength(1)
    expect(waiting[0]?.conn.status().failures).toBe(0)
    await clock.advanceTo(60 * SEC - 1)
    expect(fake.attempts).toBe(30)
    await clock.advanceTo(60 * SEC)
    expect(fake.attempts).toBe(31)
    expect(rigs.every((r) => r.conn.status().state === 'CONNECTED')).toBe(true)
  })

  it('다시 시도도 같은 한도를 탄다 — 미룬 시도는 실패로 세지 않고 RETRYING의 nextAttemptAt이 미룬 시각', async () => {
    const clock = new FakeTikTokClock(0)
    const fake = new FakeWebcast().account('seller_a', 'LIVE').account('seller_b', 'LIVE')
    const limiter = createTikTokAttemptLimiter(2, 60 * SEC)
    const a = rig({ clock, fake, target: 'seller_a', sellerId: 'a', extra: { limiter } })
    const b = rig({ clock, fake, target: 'seller_b', sellerId: 'b', extra: { limiter } })
    a.conn.start()
    await clock.advanceTo(0)
    fake.failNext('NETWORK')
    b.conn.start()
    await clock.advanceTo(0)
    expect(brief(b.conn.status())).toEqual({ state: 'RETRYING', reason: 'NETWORK', failures: 1, nextAttemptAt: iso(5) })
    await clock.advanceTo(5 * SEC)
    expect(brief(b.conn.status())).toEqual({ state: 'RETRYING', reason: 'NETWORK', failures: 1, nextAttemptAt: iso(60) })
    expect(fake.attempts).toBe(2)
    await clock.advanceTo(60 * SEC)
    expect(fake.attempts).toBe(3)
    expect(b.conn.status()).toMatchObject({ state: 'CONNECTED', failures: 1 })
  })
})

describe('AC-N2b-2-43 방송 전 기다리기 (1분마다 60분)', () => {
  it('시도 1~60은 RETRYING/NOT_LIVE·failures 0·다음 +60초, 시도 61(3,600초)에 STOPPED/GAVE_UP(lastFailure NOT_LIVE), 그 뒤 1시간 더 돌려도 61', async () => {
    const r = rig({ account: 'OFFLINE' })
    r.conn.start()
    await r.flush()
    for (let attempt = 1; attempt <= 61; attempt += 1) {
      const at = 60 * (attempt - 1)
      await r.at(at)
      expect(r.fake.attempts).toBe(attempt)
      const status = r.conn.status()
      if (attempt <= 60) {
        expect(brief(status)).toEqual({ state: 'RETRYING', reason: 'NOT_LIVE', failures: 0, nextAttemptAt: iso(at + 60) })
      } else {
        expect(brief(status)).toEqual({ state: 'STOPPED', reason: 'GAVE_UP', failures: 0, nextAttemptAt: null })
        expect(status.lastFailure).toBe('NOT_LIVE')
      }
    }
    await r.at(3600 + 3600)
    expect(r.fake.attempts).toBe(61)
    expect(r.clock.pendingTimers).toBe(0)
  })

  it('t=600에 방송을 켜면 다음 시도(t=660)에 CONNECTED', async () => {
    const r = rig({ account: 'OFFLINE' })
    r.conn.start()
    await r.at(600)
    r.fake.account('seller_kim', 'LIVE')
    await r.at(659)
    expect(r.conn.status().state).toBe('RETRYING')
    await r.at(660)
    expect(r.conn.status()).toMatchObject({ state: 'CONNECTED', failures: 0 })
  })

  it('섞임: NETWORK(1, 5) → NOT_LIVE(1, 65) → NETWORK(2, 75) → NOT_LIVE(2, 135), NOT_LIVE 기간은 t=75부터 새로 센다', async () => {
    const r = rig({ account: 'OFFLINE' })
    r.fake.failNext('NETWORK')
    r.conn.start()
    await r.flush()
    expect(brief(r.conn.status())).toEqual({ state: 'RETRYING', reason: 'NETWORK', failures: 1, nextAttemptAt: iso(5) })
    await r.at(5)
    expect(brief(r.conn.status())).toEqual({ state: 'RETRYING', reason: 'NOT_LIVE', failures: 1, nextAttemptAt: iso(65) })
    r.fake.failNext('NETWORK')
    await r.at(65)
    expect(brief(r.conn.status())).toEqual({ state: 'RETRYING', reason: 'NETWORK', failures: 2, nextAttemptAt: iso(75) })
    await r.at(75)
    expect(brief(r.conn.status())).toEqual({ state: 'RETRYING', reason: 'NOT_LIVE', failures: 2, nextAttemptAt: iso(135) })
    // 60분은 t=75부터: 75 + 3,600 = 3,675초 시도에 멈춘다
    await r.at(75 + 3600 - 60)
    expect(r.conn.status().state).toBe('RETRYING')
    await r.at(75 + 3600)
    expect(r.conn.status()).toMatchObject({ state: 'STOPPED', reason: 'GAVE_UP', failures: 2, lastFailure: 'NOT_LIVE' })
  })

  it('NETWORK·BLOCKED·SIGN_FAILED는 9번 한도 그대로 (NOT_LIVE는 세지 않는다)', async () => {
    const r = rig()
    r.fake.failNext('BLOCKED', 9)
    r.conn.start()
    await r.at(400)
    expect(r.conn.status()).toMatchObject({ state: 'STOPPED', reason: 'GAVE_UP', failures: 9, lastFailure: 'BLOCKED' })
  })
})

describe('AC-N2b-2-44 로그 횟수 제한 (같은 코드 60초에 5번)', () => {
  it('받는 중 error 20번(0~10초) → TIKTOK_LIBRARY_ERROR 5줄, 61초의 다음 줄에 넘친 수 15. 다른 판매자는 따로 센다', async () => {
    const a = rig()
    const b = rig({ sellerId: 'seller-2', fake: a.fake, clock: a.clock })
    a.conn.start()
    b.conn.start()
    await a.flush()
    const handles = a.fake.handles
    for (let i = 0; i < 20; i += 1) {
      await a.clock.advanceTo((i * 10 * SEC) / 20)
      handles[0]?.emit('error', { info: 'x', exception: new Error('planted-error-text') })
    }
    handles[1]?.emit('error', { info: 'x', exception: new Error('x') })
    const errorsOf = (logs: LogRecord[]) => logs.filter((l) => l.code === 'TIKTOK_LIBRARY_ERROR')
    expect(errorsOf(a.logs)).toHaveLength(5)
    expect(errorsOf(a.logs).every((l) => l.suppressed === undefined)).toBe(true)
    expect(errorsOf(b.logs)).toHaveLength(1)
    await a.clock.advanceTo(61 * SEC)
    handles[0]?.chat(chatFields(freshId()))
    handles[0]?.emit('error', { info: 'x', exception: new Error('x') })
    expect(errorsOf(a.logs)).toHaveLength(6)
    expect(errorsOf(a.logs).at(-1)?.suppressed).toBe(15)
    expect(JSON.stringify(a.logs)).not.toContain('planted-error-text')
  })
})

describe('AC-N2b-2-45 방 ID를 얻지 못함 = 방송 전', () => {
  it('세 방법 모두 방 ID 없음 → NOT_LIVE', () => {
    expect(classifyWebcastFailure(fakeNoRoomError())).toBe('NOT_LIVE')
  })

  it('하나라도 다른 오류가 섞이면 그 판단을 하지 않는다 — 없는 사용자·막힘·네트워크는 그대로', () => {
    expect(classifyWebcastFailure(fakeLibraryError('USER_NOT_FOUND'))).toBe('USER_NOT_FOUND')
    expect(classifyWebcastFailure(fakeLibraryError('BLOCKED'))).toBe('BLOCKED')
    expect(classifyWebcastFailure(fakeLibraryError('NETWORK'))).toBe('NETWORK')
    class FetchIsLiveError extends Error {
      readonly errors: unknown[]
      constructor(errors: unknown[]) {
        super('Failed to retrieve Room ID from all sources.')
        this.errors = errors
      }
    }
    const two = new FetchIsLiveError([new Error('Failed to extract Room ID from HTML.'), new Error('Failed to extract Room ID from API.')])
    expect(classifyWebcastFailure(two)).toBe('NETWORK')
    const permission = new FetchIsLiveError([
      new Error('Failed to extract Room ID from HTML.'),
      new Error('Failed to extract Room ID from API.'),
      new Error("Failed to retrieve Room ID from Euler Stream, which was made as a last resort due to the previous methods failing. This happened due to a >>lack of permission<<"),
    ])
    expect(classifyWebcastFailure(permission)).toBe('NETWORK')
    const repeated = new FetchIsLiveError([new Error('Failed to extract Room ID from HTML.'), new Error('Failed to extract Room ID from HTML.'), new Error('Failed to extract Room ID from Euler.')])
    expect(classifyWebcastFailure(repeated)).toBe('NETWORK')
  })

  it('연결 객체: 방 ID 없음 실패는 RETRYING/NOT_LIVE, failures 0, 1분 뒤', async () => {
    const r = rig({
      webcast: () => ({
        connect: () => Promise.reject(fakeNoRoomError()),
        disconnect: () => undefined,
        on: () => undefined,
      }),
    })
    r.conn.start()
    await r.flush()
    expect(brief(r.conn.status())).toEqual({ state: 'RETRYING', reason: 'NOT_LIVE', failures: 0, nextAttemptAt: iso(60) })
  })
})
