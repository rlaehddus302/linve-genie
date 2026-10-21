// 틱톡 연결 상태·다시 연결 통합 시험 (N2b-1, AC-N2b-1-30~38, D-N2b-1-05). 가짜 웹캐스트·주입한 가짜 시계로 돈다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  TIKTOK_MISSED_MESSAGE,
  TIKTOK_STATUS_MESSAGES,
  TIKTOK_TARGET_MESSAGES,
  tiktokStatusMessage,
  type TikTokFailureKind,
  type TikTokRetryKind,
} from '../src/tiktok/index.ts'
import { brief, chatFields, freshId, iso, rig, SEC } from './tiktok-support.ts'

const HOUR = 3600

/** 처리되지 않은 거부·예외를 센다 (AC-N2b-1-35) */
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

const TABLE: Array<[string, string | null, string]> = [
  ['IDLE', null, '틱톡에 아직 연결하지 않았어요.'],
  ['CONNECTING', null, '틱톡에 연결하는 중이에요.'],
  ['CONNECTED', null, '틱톡 댓글을 받고 있어요.'],
  ['RETRYING', 'NETWORK', '틱톡 연결이 끊겨 다시 연결하는 중이에요.'],
  ['RETRYING', 'NOT_LIVE', '틱톡 방송이 아직 시작되지 않았어요. 잠시 뒤 다시 확인해요.'],
  ['RETRYING', 'BLOCKED', '틱톡이 연결을 막아 다시 시도하는 중이에요. 그동안 댓글을 직접 넣어 주세요.'],
  ['RETRYING', 'SIGN_FAILED', '틱톡 연결 준비에 실패해 다시 시도하는 중이에요. 그동안 댓글을 직접 넣어 주세요.'],
  ['STOPPED', 'USER_NOT_FOUND', '그런 틱톡 아이디를 찾지 못했어요. 아이디를 확인해 주세요.'],
  ['STOPPED', 'GAVE_UP', '틱톡에 다시 연결하지 못했어요. 다시 연결을 누르거나 댓글을 직접 넣어 주세요.'],
  ['STOPPED', 'BY_SELLER', '틱톡 연결을 끊었어요.'],
  ['ENDED', null, '틱톡 방송이 끝났어요.'],
  ['OFF', 'OPERATOR_OFF', '지금은 틱톡 연결을 쓸 수 없어요. 댓글을 직접 넣어 주세요.'],
  ['OFF', 'NO_CONSENT', '틱톡 연결이 꺼져 있어요. 안내를 읽고 동의하면 켤 수 있어요.'],
]

/** 모듈이 판매자에게 보이려고 내보내는 모든 문장 */
function allMessages(): string[] {
  const out: string[] = [TIKTOK_MISSED_MESSAGE, ...Object.values(TIKTOK_TARGET_MESSAGES)]
  for (const entry of Object.values(TIKTOK_STATUS_MESSAGES)) {
    if (typeof entry === 'string') out.push(entry)
    else out.push(...Object.values(entry))
  }
  return out
}

describe('AC-N2b-1-30 상태와 문장', () => {
  it('상태·이유·문장 표 그대로 (표에 없는 조합은 없음)', () => {
    for (const [state, reason, message] of TABLE) expect(tiktokStatusMessage(state as never, reason), `${state}/${String(reason)}`).toBe(message)
    expect(allMessages()).toHaveLength(TABLE.length + 4)
    expect(tiktokStatusMessage('RETRYING', null)).toBeNull()
    expect(tiktokStatusMessage('IDLE', 'NETWORK')).toBeNull()
    expect(tiktokStatusMessage('OFF', 'toString')).toBeNull()
  })

  it('모든 문장에 영문 글자·숫자·기술 낱말이 없다', () => {
    const TECH = ['연결기', '서명', '웹소켓', '프로토콜', '서버', '쿠키', '세션', '토큰', '라이브러리', '네트워크', '예외', '타임아웃', '오류 코드', '아이피']
    for (const message of allMessages()) {
      expect(message, message).not.toMatch(/[A-Za-z]/)
      expect(message, message).not.toMatch(/[0-9０-９]/)
      for (const word of TECH) expect(message, `${message} ← ${word}`).not.toContain(word)
    }
    expect(TIKTOK_MISSED_MESSAGE).toBe('끊긴 동안의 틱톡 댓글은 받지 못했을 수 있어요. 틱톡 앱에서 확인해 주세요.')
  })

  it('새로 만든 연결 객체는 IDLE — 상태 조회의 칸', () => {
    const { conn, statuses } = rig()
    expect(conn.status()).toEqual({
      state: 'IDLE',
      reason: null,
      message: '틱톡에 아직 연결하지 않았어요.',
      failures: 0,
      nextAttemptAt: null,
      lastFailure: null,
      missed: false,
      counts: { received: 0, duplicates: 0, dropped: 0 },
    })
    expect(statuses).toEqual([])
  })

  it('연결 → CONNECTING → CONNECTED, 문장도 표 그대로', async () => {
    const r = rig()
    r.conn.start()
    expect(r.conn.status()).toMatchObject({ state: 'CONNECTING', reason: null, message: '틱톡에 연결하는 중이에요.' })
    await r.flush()
    expect(r.conn.status()).toMatchObject({ state: 'CONNECTED', reason: null, message: '틱톡 댓글을 받고 있어요.', nextAttemptAt: null })
  })
})

const SCHEDULE: Array<[number, number, number | null]> = [
  // [시도 시작 시각, 실패 뒤 failures, nextAttemptAt]
  [0, 1, 5],
  [5, 2, 15],
  [15, 3, 35],
  [35, 4, 75],
  [75, 5, 135],
  [135, 6, 195],
  [195, 7, 255],
  [255, 8, 315],
  [315, 9, null],
]

async function runSchedule(kind: TikTokRetryKind | ((attempt: number) => TikTokRetryKind)) {
  const kindAt = (attempt: number): TikTokRetryKind => (typeof kind === 'function' ? kind(attempt) : kind)
  const r = rig()
  for (let i = 1; i <= 20; i += 1) r.fake.failNext(kindAt(i))
  r.conn.start()
  await r.flush()
  for (const [index, [start, failures, next]] of SCHEDULE.entries()) {
    const attempt = index + 1
    if (attempt > 1) {
      await r.clock.advanceTo(start * SEC - 1)
      expect(r.fake.attempts, `시도 ${String(attempt)} 1ms 전`).toBe(attempt - 1)
      await r.at(start)
    }
    expect(r.fake.attempts, `시도 ${String(attempt)}`).toBe(attempt)
    const status = r.conn.status()
    if (attempt < 9) {
      expect(brief(status)).toEqual({ state: 'RETRYING', reason: kindAt(attempt), failures, nextAttemptAt: iso(next ?? 0) })
      expect(status.message).toBe(tiktokStatusMessage('RETRYING', kindAt(attempt)))
    } else {
      expect(brief(status)).toEqual({ state: 'STOPPED', reason: 'GAVE_UP', failures: 9, nextAttemptAt: null })
    }
    expect(status.lastFailure).toBe(kindAt(attempt))
    expect(status.missed).toBe(false)
  }
  await r.at(315 + HOUR)
  expect(r.fake.attempts).toBe(9)
  expect(r.clock.pendingTimers).toBe(0)
  return r
}

describe('AC-N2b-1-31 다시 시도 시간표', () => {
  it('NETWORK: 5·10·20·40·60·60·60·60초, 9번째 실패에 STOPPED/GAVE_UP, 남은 타이머 없음', async () => {
    await runSchedule('NETWORK')
  })

  // N2b-2(D-N2b-2-11 (라), AC-N2b-2-43)가 NOT_LIVE를 이 시간표에서 뺐다 — 1분마다 60분, 연속 실패 수에 넣지 않음 (바꾼 기존 시험, dev-notes. 새 시간표는 tiktok-n2b2-connection.test.ts)
  for (const kind of ['BLOCKED', 'SIGN_FAILED'] as const) {
    it(`${kind}도 같은 시간표, reason만 그 종류`, async () => {
      await runSchedule(kind)
    })
  }

  it('종류가 섞여도 연속 실패 수는 이어서 센다', async () => {
    const kinds: TikTokRetryKind[] = ['NETWORK', 'BLOCKED', 'SIGN_FAILED']
    await runSchedule((attempt) => kinds[(attempt - 1) % kinds.length] ?? 'NETWORK')
  })

  it('같은 조작을 처음부터 두 번 돌리면 상태 알림 목록이 똑같다 (결정적)', async () => {
    const a = await runSchedule('NETWORK')
    const b = await runSchedule('NETWORK')
    expect(a.statuses.length).toBeGreaterThan(9)
    expect(b.statuses).toEqual(a.statuses)
  })
})

describe('AC-N2b-1-32 유지된 연결과 흔들리는 연결', () => {
  it('유지: 60초 유지되면 failures 0(상태 알림 하나), 그 뒤 끊기면 failures 1·nextAttemptAt 105', async () => {
    const r = rig()
    r.fake.failNext('NETWORK', 2)
    r.conn.start()
    await r.at(15)
    expect(r.fake.attempts).toBe(3)
    expect(brief(r.conn.status())).toEqual({ state: 'CONNECTED', reason: null, failures: 2, nextAttemptAt: null })
    await r.clock.advanceTo(75 * SEC - 1)
    expect(r.conn.status().failures).toBe(2)
    const before = r.statuses.length
    await r.at(75)
    expect(r.statuses.length).toBe(before + 1)
    expect(brief(r.statuses.at(-1) ?? r.conn.status())).toEqual({ state: 'CONNECTED', reason: null, failures: 0, nextAttemptAt: null })
    await r.at(100)
    r.fake.last?.drop()
    await r.flush()
    expect(brief(r.conn.status())).toEqual({ state: 'RETRYING', reason: 'NETWORK', failures: 1, nextAttemptAt: iso(105) })
  })

  it('흔들림: 30초 만에 끊기면 이어서 센다(failures 3, nextAttemptAt 65), 되풀이하면 9번째에 GAVE_UP', async () => {
    const r = rig()
    r.fake.failNext('NETWORK', 2)
    r.conn.start()
    await r.at(15)
    await r.at(45)
    r.fake.last?.drop()
    await r.flush()
    expect(brief(r.conn.status())).toEqual({ state: 'RETRYING', reason: 'NETWORK', failures: 3, nextAttemptAt: iso(65) })
    let guard = 0
    while (r.conn.status().state === 'RETRYING' && guard < 20) {
      guard += 1
      const next = Date.parse(r.conn.status().nextAttemptAt ?? '') / SEC
      await r.at(next)
      expect(r.conn.status().state).toBe('CONNECTED')
      await r.at(next + 30)
      r.fake.last?.drop()
      await r.flush()
    }
    expect(brief(r.conn.status())).toEqual({ state: 'STOPPED', reason: 'GAVE_UP', failures: 9, nextAttemptAt: null })
    expect(r.conn.status().lastFailure).toBe('NETWORK')
    const attempts = r.fake.attempts
    await r.at(HOUR * 3)
    expect(r.fake.attempts).toBe(attempts)
    expect(r.fake.maxOpen).toBe(1)
  })
})

describe('AC-N2b-1-33 다시 시도하지 않는 경우', () => {
  it('없는 아이디: 첫 시도에서 STOPPED/USER_NOT_FOUND, 1시간 뒤에도 시도 1', async () => {
    const r = rig({ account: 'MISSING' })
    r.conn.start()
    await r.flush()
    expect(r.conn.status()).toMatchObject({ state: 'STOPPED', reason: 'USER_NOT_FOUND', lastFailure: 'USER_NOT_FOUND', nextAttemptAt: null, message: '그런 틱톡 아이디를 찾지 못했어요. 아이디를 확인해 주세요.' })
    await r.at(HOUR)
    expect(r.fake.attempts).toBe(1)
    expect(r.clock.pendingTimers).toBe(0)
  })

  it('받는 중 방송이 끝나면 ENDED, 다시 시도하지 않는다', async () => {
    const r = rig()
    r.conn.start()
    await r.at(10)
    r.fake.last?.endStream()
    await r.flush()
    expect(r.conn.status()).toMatchObject({ state: 'ENDED', reason: null, nextAttemptAt: null, message: '틱톡 방송이 끝났어요.' })
    await r.at(HOUR)
    expect(r.fake.attempts).toBe(1)
    expect(r.clock.pendingTimers).toBe(0)
    expect(r.fake.openCount).toBe(0)
  })
})

describe('AC-N2b-1-34 연결 시간 초과·연결은 하나', () => {
  it('답하지 않으면 20초에 RETRYING/NETWORK(nextAttemptAt 25), t=22의 늦은 성공은 바로 닫고 댓글은 레코드가 되지 않는다', async () => {
    const r = rig()
    r.fake.hold()
    r.conn.start()
    await r.clock.advanceTo(20 * SEC - 1)
    expect(r.conn.status().state).toBe('CONNECTING')
    await r.at(20)
    expect(brief(r.conn.status())).toEqual({ state: 'RETRYING', reason: 'NETWORK', failures: 1, nextAttemptAt: iso(25) })
    const late = r.fake.last
    await r.at(22)
    late?.succeed()
    await r.flush()
    expect(late?.closed).toBe(true)
    expect(late?.disconnectCalls).toBeGreaterThanOrEqual(1)
    expect(r.conn.status().state).toBe('RETRYING')
    late?.chat(chatFields(freshId()))
    expect(r.records).toEqual([])
    expect(r.fake.openCount).toBe(0)
    r.fake.hold(false)
    await r.at(25)
    expect(r.fake.attempts).toBe(2)
    expect(r.conn.status().state).toBe('CONNECTED')
    expect(r.fake.maxOpen).toBe(1)
  })

  it('어떤 순서에서도 동시에 열린 연결은 많아야 하나 (시간 초과 뒤 다시 연결된 다음의 늦은 성공·start 두 번·stop 중 성공)', async () => {
    const r = rig()
    r.fake.hold()
    r.conn.start()
    r.conn.start()
    await r.flush()
    expect(r.fake.attempts).toBe(1)
    await r.at(20)
    r.fake.hold(false)
    await r.at(25)
    expect(r.conn.status().state).toBe('CONNECTED')
    r.fake.handles[0]?.succeed()
    await r.flush()
    expect(r.fake.maxOpen).toBe(1)
    expect(r.conn.status().state).toBe('CONNECTED')
    r.conn.stop()
    r.fake.hold()
    r.conn.start()
    await r.flush()
    const pending = r.fake.last
    r.conn.stop()
    pending?.succeed()
    await r.flush()
    expect(r.conn.status()).toMatchObject({ state: 'STOPPED', reason: 'BY_SELLER' })
    expect(pending?.closed).toBe(true)
    expect(r.fake.openCount).toBe(0)
    expect(r.fake.maxOpen).toBe(1)
  })
})

describe('AC-N2b-1-35 오류는 새지 않는다 · 연결된 뒤의 error 이벤트', () => {
  it('연결된 뒤의 error 이벤트는 상태를 바꾸지 않고 로그 코드만', async () => {
    const r = rig()
    r.conn.start()
    await r.flush()
    const notices = r.statuses.length
    r.fake.last?.emit('error', { info: 'WebSocket Error', exception: new Error('boom') })
    await r.flush()
    expect(r.conn.status().state).toBe('CONNECTED')
    expect(r.statuses.length).toBe(notices)
    expect(r.logs.map((l) => l.code)).toContain('TIKTOK_LIBRARY_ERROR')
  })

  it('클라이언트를 만들다·연결하다 예외를 던지거나 오류가 아닌 값으로 거부해도 NETWORK로 끝난다', async () => {
    const throwing = rig({
      webcast: () => {
        throw new Error('constructor failed')
      },
    })
    throwing.conn.start()
    await throwing.flush()
    expect(throwing.conn.status()).toMatchObject({ state: 'RETRYING', reason: 'NETWORK' })
    for (const value of ['Websocket not responding', undefined, null, 42, { weird: true }]) {
      const r = rig({ webcast: () => ({ connect: () => Promise.reject(value), disconnect: () => undefined, on: () => undefined }) })
      r.conn.start()
      await r.flush()
      expect(r.conn.status(), String(value)).toMatchObject({ state: 'RETRYING', reason: 'NETWORK' })
    }
    const syncThrow = rig({
      webcast: () => ({
        connect: () => {
          throw new Error('sync')
        },
        disconnect: () => {
          throw new Error('disconnect also throws')
        },
        on: () => undefined,
      }),
    })
    syncThrow.conn.start()
    await syncThrow.flush()
    expect(syncThrow.conn.status()).toMatchObject({ state: 'RETRYING', reason: 'NETWORK' })
    syncThrow.conn.stop()
  })
})

describe('AC-N2b-1-36 start()·stop()', () => {
  async function inState(state: 'IDLE' | 'RETRYING' | 'STOPPED' | 'ENDED' | 'OFF') {
    const r = rig({ consent: async () => true })
    if (state === 'RETRYING') {
      r.fake.failNext('NETWORK', 2)
      r.conn.start()
      await r.at(5)
    } else if (state === 'STOPPED') {
      r.conn.start()
      await r.flush()
      r.conn.stop()
    } else if (state === 'ENDED') {
      r.conn.start()
      await r.flush()
      r.fake.last?.endStream()
      await r.flush()
    } else if (state === 'OFF') {
      let allow = false
      const off = rig({ consent: async () => allow })
      off.conn.start()
      await off.flush()
      expect(off.conn.status().state).toBe('OFF')
      allow = true
      return off
    }
    expect(r.conn.status().state).toBe(state)
    return r
  }

  for (const state of ['IDLE', 'RETRYING', 'STOPPED', 'ENDED', 'OFF'] as const) {
    it(`${state}에서 start() → 연속 실패 0으로 바로 연결 시도`, async () => {
      const r = await inState(state)
      const attempts = r.fake.attempts
      r.conn.start()
      expect(r.conn.status()).toMatchObject({ state: 'CONNECTING', failures: 0, nextAttemptAt: null, lastFailure: null })
      await r.flush()
      expect(r.fake.attempts).toBe(attempts + 1)
      expect(r.conn.status().state).toBe('CONNECTED')
    })
  }

  it('CONNECTING·CONNECTED에서 start()는 아무 일도 없다 (같은 순간 두 번 → 시도 하나)', async () => {
    const r = rig()
    r.conn.start()
    const notices = r.statuses.length
    r.conn.start()
    expect(r.statuses.length).toBe(notices)
    await r.flush()
    expect(r.fake.attempts).toBe(1)
    r.conn.start()
    await r.flush()
    expect(r.fake.attempts).toBe(1)
    expect(r.consentCalls).toHaveLength(1)
  })

  it('stop(): 어느 상태에서든 STOPPED/BY_SELLER, 남은 타이머 없음, 열린 연결을 닫는다, 그 뒤 댓글은 레코드 0', async () => {
    const r = rig()
    r.conn.stop()
    expect(r.conn.status()).toMatchObject({ state: 'STOPPED', reason: 'BY_SELLER', message: '틱톡 연결을 끊었어요.' })
    r.conn.start()
    await r.flush()
    const open = r.fake.last
    r.conn.stop()
    expect(r.conn.status()).toMatchObject({ state: 'STOPPED', reason: 'BY_SELLER', nextAttemptAt: null })
    expect(open?.closed).toBe(true)
    open?.chat(chatFields(freshId()))
    expect(r.records).toEqual([])
    r.fake.failNext('NETWORK')
    r.conn.start()
    await r.flush()
    expect(r.conn.status().state).toBe('RETRYING')
    r.conn.stop()
    await r.at(HOUR)
    expect(r.fake.attempts).toBe(2)
    expect(r.clock.pendingTimers).toBe(0)
    const notices = r.statuses.length
    r.conn.stop()
    expect(r.statuses.length).toBe(notices)
  })
})

describe('AC-N2b-1-37 끊김 안내 (missed)', () => {
  it('받던 연결이 끊기면 true, 다시 연결에 성공해도 true, start()를 부르면 false', async () => {
    const r = rig()
    r.conn.start()
    await r.at(10)
    expect(r.conn.status().missed).toBe(false)
    r.fake.last?.drop()
    await r.flush()
    expect(r.conn.status()).toMatchObject({ state: 'RETRYING', missed: true })
    await r.at(15)
    expect(r.conn.status()).toMatchObject({ state: 'CONNECTED', missed: true })
    r.conn.stop()
    expect(r.conn.status().missed).toBe(true)
    r.conn.start()
    expect(r.conn.status().missed).toBe(false)
  })

  it('한 번도 CONNECTED가 되지 않은 실패(방송 전·막힘)에서는 false', async () => {
    for (const kind of ['NOT_LIVE', 'BLOCKED', 'NETWORK', 'SIGN_FAILED', 'USER_NOT_FOUND'] as TikTokFailureKind[]) {
      const r = rig()
      r.fake.failNext(kind)
      r.conn.start()
      await r.flush()
      expect(r.conn.status().missed, kind).toBe(false)
    }
  })

  it('판매자가 stop()으로 끊으면 켜지지 않는다', async () => {
    const r = rig()
    r.conn.start()
    await r.flush()
    r.conn.stop()
    await r.flush()
    expect(r.conn.status().missed).toBe(false)
  })
})

describe('AC-N2b-1-38 상태 알림', () => {
  it('state·reason·failures·missed가 바뀔 때마다 정확히 한 번, 댓글마다는 부르지 않는다', async () => {
    const r = rig()
    r.fake.failNext('BLOCKED')
    r.conn.start()
    await r.at(5)
    await r.flush()
    for (let i = 0; i < 20; i += 1) r.fake.last?.chat(chatFields(freshId()))
    r.fake.last?.drop()
    await r.flush()
    const keys = r.statuses.map((s) => `${s.state}|${String(s.reason)}|${String(s.failures)}|${String(s.missed)}`)
    expect(keys).toEqual(['CONNECTING|null|0|false', 'RETRYING|BLOCKED|1|false', 'CONNECTING|null|1|false', 'CONNECTED|null|1|false', 'RETRYING|NETWORK|2|true'])
    for (let i = 1; i < keys.length; i += 1) expect(keys[i]).not.toBe(keys[i - 1])
    expect(r.records).toHaveLength(20)
    expect(r.conn.status().counts.received).toBe(20)
  })

  it('상태 알림 콜백이 예외를 던져도(동기·비동기) 연결·다시 시도·댓글 흐름은 그대로', async () => {
    let flip = false
    const r = rig({
      onStatus: () => {
        flip = !flip
        if (flip) throw new Error('sync boom')
        return Promise.reject(new Error('async boom'))
      },
    })
    r.fake.failNext('NETWORK')
    r.conn.start()
    await r.flush()
    expect(r.conn.status().state).toBe('RETRYING')
    await r.at(5)
    expect(r.conn.status().state).toBe('CONNECTED')
    r.fake.last?.chat(chatFields(freshId()))
    expect(r.records).toHaveLength(1)
    await r.flush()
    expect(r.logs.filter((l) => l.code === 'TIKTOK_STATUS_FAILED').length).toBeGreaterThanOrEqual(3)
  })
})
