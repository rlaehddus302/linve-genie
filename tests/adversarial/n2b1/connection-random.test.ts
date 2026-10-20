// N2b-1 적대 테스트 (test-domain): 틱톡 연결 객체에 무작위 조작 열을 넣어 불변식을 검사한다 (AC-N2b-1-24·30·34·36·38).
// 조작: start·stop·시계 돌리기·붙잡기 켜고 끄기·다음 시도 실패 넣기·지금/이전 손잡이 성공·실패·끊김·방송 끝·댓글·error 이벤트·동의 바꾸기.
// 불변식 (조작마다, 약속 이어 붙이기를 다 돌린 뒤):
//  1. 가짜 웹캐스트에 동시에 열린 연결은 많아야 하나 (AC-N2b-1-34)
//  2. 열린 연결이 있으면 상태는 CONNECTED, CONNECTED면 열린 연결이 정확히 하나 (버린 연결이 열린 채 남지 않는다)
//  3. 문장은 표 그대로, nextAttemptAt은 RETRYING일 때만 (AC-N2b-1-30)
//  4. 멈춘 상태(IDLE·STOPPED·ENDED·OFF)에서는 남은 타이머가 없다
//  5. 상태 알림은 state·reason·failures·missed가 바뀔 때만 (AC-N2b-1-38)
//  6. 레코드의 댓글 ID는 겹치지 않고, stop() 뒤 start() 전에는 레코드가 가지 않는다 (AC-N2b-1-24·36)
//  7. failures ≤ 9, 처리되지 않은 거부·예외 0 (AC-N2b-1-35)
import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installOutboundGuard, TIKTOK_BLOCKED_DOMAINS } from '../../../apps/server/test/outbound-guard.ts'
import {
  checkTikTokTarget,
  createTikTokConnection,
  FakeTikTokClock,
  FakeWebcast,
  flushTikTokTasks,
  readTikTokSettings,
  tiktokStatusMessage,
  type TikTokCommentRecord,
  type TikTokConnectionStatus,
  type TikTokFailureKind,
} from '../../../apps/server/src/tiktok/index.ts'

const guard = installOutboundGuard('tiktok', TIKTOK_BLOCKED_DOMAINS)

const leaks: unknown[] = []
const onLeak = (error: unknown): void => {
  leaks.push(error)
}
beforeEach(() => {
  leaks.length = 0
  guard.reset()
  process.on('unhandledRejection', onLeak)
  process.on('uncaughtException', onLeak)
})
afterEach(() => {
  process.off('unhandledRejection', onLeak)
  process.off('uncaughtException', onLeak)
  expect(leaks).toEqual([])
  expect(guard.reset()).toEqual([])
})

const KINDS: TikTokFailureKind[] = ['NETWORK', 'NOT_LIVE', 'BLOCKED', 'SIGN_FAILED', 'USER_NOT_FOUND']

type Op =
  | { t: 'start' }
  | { t: 'stop' }
  | { t: 'advance'; ms: number }
  | { t: 'hold'; on: boolean }
  | { t: 'failNext'; kind: TikTokFailureKind }
  | { t: 'succeed'; back: number }
  | { t: 'fail'; back: number; kind: TikTokFailureKind }
  | { t: 'drop'; back: number }
  | { t: 'endStream'; back: number }
  | { t: 'chat'; back: number; repeat: boolean }
  | { t: 'error'; back: number }
  | { t: 'consent'; mode: 'allow' | 'deny' | 'hang' | 'throw' }

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { arbitrary: fc.constant<Op>({ t: 'start' }), weight: 4 },
  { arbitrary: fc.constant<Op>({ t: 'stop' }), weight: 1 },
  { arbitrary: fc.constantFrom(1, 4_999, 5_000, 10_000, 19_999, 20_000, 30_000, 60_000, 61_000, 300_000).map<Op>((ms) => ({ t: 'advance', ms })), weight: 5 },
  { arbitrary: fc.boolean().map<Op>((on) => ({ t: 'hold', on })), weight: 2 },
  { arbitrary: fc.constantFrom(...KINDS).map<Op>((kind) => ({ t: 'failNext', kind })), weight: 1 },
  { arbitrary: fc.nat(2).map<Op>((back) => ({ t: 'succeed', back })), weight: 3 },
  { arbitrary: fc.tuple(fc.nat(2), fc.constantFrom(...KINDS)).map<Op>(([back, kind]) => ({ t: 'fail', back, kind })), weight: 1 },
  { arbitrary: fc.nat(2).map<Op>((back) => ({ t: 'drop', back })), weight: 2 },
  { arbitrary: fc.nat(2).map<Op>((back) => ({ t: 'endStream', back })), weight: 1 },
  { arbitrary: fc.tuple(fc.nat(2), fc.boolean()).map<Op>(([back, repeat]) => ({ t: 'chat', back, repeat })), weight: 4 },
  { arbitrary: fc.nat(2).map<Op>((back) => ({ t: 'error', back })), weight: 1 },
  { arbitrary: fc.constantFrom('allow', 'deny', 'hang', 'throw').map<Op>((mode) => ({ t: 'consent', mode: mode as 'allow' })), weight: 1 },
)

const RESTING = new Set(['IDLE', 'STOPPED', 'ENDED', 'OFF'])
const key = (s: TikTokConnectionStatus): string => `${s.state}|${String(s.reason)}|${String(s.failures)}|${String(s.missed)}`

async function run(ops: readonly Op[]): Promise<void> {
  const fake = new FakeWebcast().account('seller_kim', 'LIVE')
  const clock = new FakeTikTokClock(0)
  const records: TikTokCommentRecord[] = []
  const statuses: TikTokConnectionStatus[] = []
  let consentMode: 'allow' | 'deny' | 'hang' | 'throw' = 'allow'
  const checked = checkTikTokTarget('@seller_kim')
  if (!checked.ok) throw new Error('준비')
  const conn = createTikTokConnection({
    sellerId: 'seller-1',
    target: checked.target,
    webcast: fake.factory,
    onRecord: (r) => records.push(r),
    onStatus: (s) => statuses.push(s),
    settings: readTikTokSettings({ LIVEJJIM_TIKTOK_BETA: 'on' }),
    consent: () => {
      if (consentMode === 'throw') throw new Error('db down')
      if (consentMode === 'hang') return new Promise<boolean>(() => undefined)
      return Promise.resolve(consentMode === 'allow')
    },
    clock,
    log: () => undefined,
  })
  let n = 7_400_000_000_000_000_000n
  const sent: string[] = []
  let stoppedSinceStart = false
  const pick = (back: number) => {
    const hs = fake.handles
    return hs[hs.length - 1 - back]
  }
  const trace: string[] = []
  for (const op of ops) {
    trace.push(JSON.stringify(op))
    const recordsBefore = records.length
    switch (op.t) {
      case 'start':
        conn.start()
        stoppedSinceStart = false
        break
      case 'stop':
        conn.stop()
        stoppedSinceStart = true
        break
      case 'advance':
        await clock.advance(op.ms)
        break
      case 'hold':
        fake.hold(op.on)
        break
      case 'failNext':
        fake.failNext(op.kind)
        break
      case 'succeed':
        pick(op.back)?.succeed()
        break
      case 'fail':
        pick(op.back)?.fail(op.kind)
        break
      case 'drop':
        pick(op.back)?.drop()
        break
      case 'endStream':
        pick(op.back)?.endStream()
        break
      case 'chat': {
        let id: string
        if (op.repeat && sent.length > 0) id = sent[sent.length - 1] as string
        else {
          n += 1n
          id = n.toString()
          sent.push(id)
        }
        const fresh = !records.some((r) => r.commentId === id)
        const handle = pick(op.back)
        // 지금 열린 연결로 온 새 댓글은 빠짐없이 레코드가 된다 (조용히 잃지 않는다)
        const live = handle !== undefined && handle.state === 'open' && conn.status().state === 'CONNECTED'
        handle?.chat({ msgId: id, userId: '7101000000000000001', uniqueId: 'buyer_a', nickname: '홍길동', comment: '15' })
        expect(records.length - recordsBefore, `댓글 하나 → 레코드 수: ${trace.join(' → ')}`).toBe(live && fresh ? 1 : 0)
        break
      }
      case 'error':
        pick(op.back)?.emit('error', { info: 'x', exception: new Error('x') })
        break
      case 'consent':
        consentMode = op.mode
        break
    }
    await flushTikTokTasks()
    const s = conn.status()
    const where = trace.join(' → ')
    expect(fake.maxOpen, `동시에 열린 연결 ≤ 1: ${where}`).toBeLessThanOrEqual(1)
    if (fake.openCount > 0) expect(s.state, `열린 연결이 있으면 CONNECTED: ${where}`).toBe('CONNECTED')
    if (s.state === 'CONNECTED') expect(fake.openCount, `CONNECTED면 열린 연결 하나: ${where}`).toBe(1)
    expect(s.message, where).toBe(tiktokStatusMessage(s.state, s.reason))
    expect(s.nextAttemptAt !== null, `nextAttemptAt은 RETRYING일 때만: ${where}`).toBe(s.state === 'RETRYING')
    if (RESTING.has(s.state)) expect(clock.pendingTimers, `멈춘 상태(${s.state})에 남은 타이머: ${where}`).toBe(0)
    expect(s.failures, where).toBeLessThanOrEqual(9)
    if (stoppedSinceStart) expect(records.length, `stop() 뒤 레코드: ${where}`).toBe(recordsBefore)
  }
  for (let i = 1; i < statuses.length; i += 1) {
    expect(key(statuses[i] as TikTokConnectionStatus), `바뀌지 않은 상태 알림 #${String(i)}: ${trace.join(' → ')}`).not.toBe(key(statuses[i - 1] as TikTokConnectionStatus))
  }
  const ids = records.map((r) => r.commentId)
  expect(new Set(ids).size, `댓글 ID 두 번: ${trace.join(' → ')}`).toBe(ids.length)
}

describe('N2b-1 연결 객체 무작위 조작 — 불변식 (회귀)', () => {
  it('무작위 조작 열 500개에서 연결 하나·문장 표·남은 타이머 없음·알림은 바뀔 때만·레코드 겹침·빠짐 없음', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 5, maxLength: 60, size: 'large' }), async (ops) => {
        await run(ops)
      }),
      { numRuns: 500, seed: 20261020 },
    )
  })
})
