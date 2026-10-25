// TTX 적대 시험 (test-domain): 확장이 버린 틱톡 댓글 수 회계 (AC-TTX-32, D-TTX-16).
// 확장은 대기열 넘침과 내 방송 화면을 떠나며 버린 "아직 보내지 않은" 댓글만 세어 다음 틱톡 상태의 dropped로 알린다.
// 409 거절·모양이 틀린 묶음(400)·다시 보내는 중(429·5xx·닿지 못함)·서버가 받은(200) 댓글은 세지 않는다.
// 무작위 붙이기·응답·화면 떠남·상태 보내기(떼어 두기/받음/실패)·워커 다시 뜨기를 섞어,
//   (1) 서버가 받은 dropped 합 = 실제로 버려진 댓글 수 (다시 뜨기가 없으면 정확히, 있으면 적게 세지 않음)
//   (2) 상태 하나에 싣는 수는 10,000 이하, 동시에 떼어 둔 상태끼리 같은 수를 두 번 싣지 않음
// 을 본다. 가짜 서버·가짜 타이머 — 네트워크 없음.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { loadOutbox, type Api, type ApiResult, type TikTokDroppedReport, type TikTokItem, type TikTokOutboxSnapshot, type Timers } from './ext-outbox.ts'

const { TT_DROPPED_REPORT_MAX, TT_HOLD_MAX, TikTokOutbox } = await loadOutbox()

class FakeTimers implements Timers {
  now = 0
  #next = 1
  readonly #due = new Map<number, { at: number; fn: () => void }>()
  set(fn: () => void, ms: number): unknown {
    const id = this.#next++
    this.#due.set(id, { at: this.now + Math.max(0, ms), fn })
    return id
  }
  clear(handle: unknown): void {
    this.#due.delete(handle as number)
  }
  advance(ms: number): void {
    const end = this.now + ms
    for (;;) {
      let pick: [number, { at: number; fn: () => void }] | null = null
      for (const entry of this.#due) if (entry[1].at <= end && (pick === null || entry[1].at < pick[1].at)) pick = entry
      if (pick === null) break
      this.#due.delete(pick[0])
      this.now = pick[1].at
      pick[1].fn()
    }
    this.now = end
  }
}

type Reply = 'recorded' | 'standby' | '429' | '500' | 'net' | '409' | '400'

const result = (reply: Reply): ApiResult => {
  switch (reply) {
    case 'recorded':
    case 'standby':
      return { status: 200, code: null, message: null, body: { result: reply }, retryAfterMs: null }
    case '429':
      return { status: 429, code: 'EXT_RATE_LIMITED', message: 'x', body: null, retryAfterMs: 1000 }
    case '500':
      return { status: 500, code: 'SAVE_FAILED', message: 'x', body: null, retryAfterMs: null }
    case 'net':
      return { status: 0, code: 'NETWORK', message: 'x', body: null, retryAfterMs: null }
    case '409':
      return { status: 409, code: 'NOT_LINKED', message: 'x', body: null, retryAfterMs: null }
    case '400':
      return { status: 400, code: 'INVALID_INPUT', message: 'x', body: null, retryAfterMs: null }
  }
}

const flushMicrotasks = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

const comment = (commentId: string): TikTokItem => ({ commentId, userId: '7101', uniqueId: 'v', nickname: '', text: '15' })

type Op =
  | { readonly kind: 'add'; readonly tab: number; readonly n: number }
  | { readonly kind: 'tick'; readonly ms: number }
  | { readonly kind: 'reply'; readonly reply: Reply }
  | { readonly kind: 'leave'; readonly tab: number }
  | { readonly kind: 'report' }
  | { readonly kind: 'settle'; readonly accepted: boolean }
  | { readonly kind: 'restart' }

const arbOp = (withRestart: boolean): fc.Arbitrary<Op> =>
  fc.oneof(
    { weight: 4, arbitrary: fc.record({ kind: fc.constant('add' as const), tab: fc.integer({ min: 1, max: 2 }), n: fc.integer({ min: 1, max: 260 }) }) },
    { weight: 3, arbitrary: fc.record({ kind: fc.constant('tick' as const), ms: fc.constantFrom(0, 1000, 31_000) }) },
    { weight: 4, arbitrary: fc.record({ kind: fc.constant('reply' as const), reply: fc.constantFrom<Reply>('recorded', 'standby', '429', '500', 'net', '409', '400') }) },
    { weight: 2, arbitrary: fc.record({ kind: fc.constant('leave' as const), tab: fc.integer({ min: 1, max: 2 }) }) },
    { weight: 2, arbitrary: fc.constant({ kind: 'report' as const }) },
    { weight: 2, arbitrary: fc.record({ kind: fc.constant('settle' as const), accepted: fc.boolean() }) },
    { weight: withRestart ? 1 : 0, arbitrary: fc.constant({ kind: 'restart' as const }) },
  )

async function runModel(ops: readonly Op[], withRestart: boolean): Promise<void> {
  const timers = new FakeTimers()
  let order = 0
  const added = new Set<string>()
  /** 서버가 받은(200) 댓글 */
  const accepted = new Set<string>()
  /** 서버가 받지 않겠다고 한(409·400) 댓글 — 세지 않는다 */
  const refused = new Set<string>()
  let generation = 0
  type Pending = { gen: number; items: TikTokItem[]; resolve: (r: ApiResult) => void }
  let pending = null as Pending | null
  let snapshot: TikTokOutboxSnapshot = { items: [], dropped: 0 }
  /** 떼어 둔 상태 (아직 답 없음) */
  let reports: { gen: number; report: TikTokDroppedReport }[] = []
  /** 서버가 받은 dropped 합 */
  let reportedToServer = 0

  const make = (gen: number) => {
    const api: Api = {
      call: (_method, _path, body) =>
        new Promise<ApiResult>((resolve) => {
          pending = { gen, items: (body?.items ?? []) as TikTokItem[], resolve }
        }),
    }
    const genTimers: Timers = { set: (fn, ms) => timers.set(() => { if (gen === generation) fn() }, ms), clear: (h) => timers.clear(h) }
    return new TikTokOutbox(api, genTimers, () => undefined, (s) => {
      if (gen === generation) snapshot = s
    })
  }
  let outbox = make(generation)

  const reply = async (r: Reply) => {
    const p = pending
    if (p === null) return
    pending = null
    if (p.gen !== generation) return
    if (r === 'recorded' || r === 'standby') for (const it of p.items) accepted.add(it.commentId)
    if (r === '409' || r === '400') for (const it of p.items) if (!accepted.has(it.commentId)) refused.add(it.commentId)
    p.resolve(result(r))
    await flushMicrotasks()
  }
  const take = () => {
    const report = outbox.takeDropped()
    // (2) 상태 하나에 10,000까지
    expect(report.count).toBeGreaterThanOrEqual(0)
    expect(report.count).toBeLessThanOrEqual(TT_DROPPED_REPORT_MAX)
    reports.push({ gen: generation, report })
  }
  const settle = (ok: boolean) => {
    const next = reports.shift()
    if (next === undefined) return
    if (next.gen !== generation) return // 죽은 워커의 상태 — 답을 받지 못한다 (서버가 받았는지 모름)
    if (ok) reportedToServer += next.report.count
    outbox.settleDropped(next.report, ok)
  }

  for (const op of ops) {
    switch (op.kind) {
      case 'add': {
        const items: TikTokItem[] = []
        for (let i = 0; i < op.n; i += 1) {
          order += 1
          const id = String(7_400_000_000_000_000_000n + BigInt(order))
          added.add(id)
          items.push(comment(id))
        }
        outbox.add(op.tab, 'seller_kim', items)
        break
      }
      case 'tick':
        timers.advance(op.ms)
        await flushMicrotasks()
        break
      case 'reply':
        await reply(op.reply)
        break
      case 'leave':
        outbox.dropTab(op.tab)
        break
      case 'report':
        take()
        break
      case 'settle':
        settle(op.accepted)
        break
      case 'restart': {
        // 워커가 멈춤: 날아가던 묶음·상태는 답이 없다. 죽은 워커가 떼어 둔 상태를 서버가 받았을 수도 있다 → 그만큼 많이 셀 수 있다
        for (const r of reports) if (r.gen === generation) reportedToServer += r.report.count
        reports = []
        generation += 1
        const saved = snapshot
        outbox = make(generation)
        outbox.restore(saved)
        break
      }
    }
  }
  // 끝: 모두 받음으로 답하며 비우고, 떼어 둔 상태를 실패로 돌린 뒤 남은 수를 모두 알린다
  for (let i = 0; i < 400 && (outbox.size > 0 || pending !== null); i += 1) {
    if (pending !== null) await reply('recorded')
    timers.advance(31_000)
    await flushMicrotasks()
  }
  expect(outbox.size, '비우지 못함').toBe(0)
  while (reports.length > 0) settle(false)
  for (let i = 0; i < 10 && outbox.unreported > 0; i += 1) {
    take()
    settle(true)
  }
  expect(outbox.unreported).toBe(0)
  // 실제로 버려진 것 = 붙인 것 중 서버가 받지도(200) 거절하지도(409·400) 않은 것
  const reallyDropped = [...added].filter((id) => !accepted.has(id) && !refused.has(id)).length
  // 서버가 받은 댓글을 버린 수로 세지 않았는가 (세면 판매자가 붙여 넣어 같은 찜이 두 번 — D-TTX-16)
  const savedButCounted = reportedToServer - reallyDropped
  if (withRestart) expect(reportedToServer, `버린 ${String(reallyDropped)}개보다 적게 알림`).toBeGreaterThanOrEqual(reallyDropped)
  else expect(reportedToServer, `버린 수 ${String(reallyDropped)} ≠ 알린 수 ${String(reportedToServer)} (차 ${String(savedButCounted)})`).toBe(reallyDropped)
}

describe('TTX 적대 — 확장이 버린 댓글 수 회계 (AC-TTX-32, D-TTX-16)', () => {
  it('TD-TTX-R30: 무작위 붙이기·응답·화면 떠남·상태 떼어 두기/받음/실패 — 서버가 받은 dropped 합 = 실제로 버려진 댓글 수, 상태 하나에 10,000 이하', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(arbOp(false), { minLength: 1, maxLength: 50 }), async (ops) => {
        await runModel(ops, false)
      }),
      { numRuns: 300, seed: 20261026 },
    )
  })

  it('TD-TTX-R31: 워커 다시 뜨기를 섞어도 적게 세지 않는다 (보관한 수를 잃지 않음)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(arbOp(true), { minLength: 1, maxLength: 50 }), async (ops) => {
        await runModel(ops, true)
      }),
      { numRuns: 200, seed: 20261027 },
    )
  })

  it('TD-TTX-R32: 409·400·429·500·닿지 못함 묶음은 버린 수로 세지 않는다 (같은 댓글 하나씩)', async () => {
    for (const reply of ['409', '400', '429', '500', 'net'] as const) {
      const timers = new FakeTimers()
      let resolveNext: ((r: ApiResult) => void) | null = null
      const api: Api = { call: () => new Promise((resolve) => (resolveNext = resolve)) }
      const outbox = new TikTokOutbox(api, timers, () => undefined)
      outbox.add(1, 'seller_kim', [comment('1')])
      timers.advance(1000)
      ;(resolveNext as ((r: ApiResult) => void) | null)?.(result(reply))
      await flushMicrotasks()
      expect(outbox.unreported, reply).toBe(0)
      expect(outbox.takeDropped().count, reply).toBe(0)
    }
  })

  it('TD-TTX-R33: 넘침이 10,000을 넘으면 상태마다 10,000씩 나눠 싣는다 · 동시에 떼어 둔 두 상태가 같은 수를 싣지 않음 · 실패한 것은 다음에 더함 · 끊기 뒤 늦은 답은 되살리지 않음', async () => {
    const timers = new FakeTimers()
    const api: Api = { call: () => new Promise<ApiResult>(() => undefined) } // 첫 묶음이 영영 매달림 → 뒤는 쌓여 넘친다
    const outbox = new TikTokOutbox(api, timers, () => undefined)
    let id = 0
    const batch = (n: number) => Array.from({ length: n }, () => comment(String(++id)))
    outbox.add(1, 'seller_kim', batch(1))
    timers.advance(1000)
    for (let i = 0; i < 21; i += 1) outbox.add(1, 'seller_kim', batch(500))
    const overflow = 1 + 21 * 500 - TT_HOLD_MAX
    expect(outbox.size).toBe(TT_HOLD_MAX)
    expect(outbox.unreported).toBe(overflow)
    const first = outbox.takeDropped()
    const second = outbox.takeDropped()
    const third = outbox.takeDropped()
    expect(first.count).toBe(TT_DROPPED_REPORT_MAX)
    expect(second.count).toBe(overflow - TT_DROPPED_REPORT_MAX)
    expect(third.count).toBe(0)
    expect(outbox.unreported, '떼어 둔 것도 보관 수에 든다').toBe(overflow)
    outbox.settleDropped(second, false)
    outbox.settleDropped(first, true)
    expect(outbox.unreported).toBe(overflow - TT_DROPPED_REPORT_MAX)
    const again = outbox.takeDropped()
    expect(again.count).toBe(overflow - TT_DROPPED_REPORT_MAX)
    outbox.stop()
    outbox.settleDropped(again, false)
    expect(outbox.unreported, '끊은 뒤 늦은 실패 답이 수를 되살림').toBe(0)
  })

  it('TD-TTX-003: 묶음이 날아가는 동안 화면을 떠났고 그 묶음을 서버가 받았으면(200) 버린 수로 세지 않는다 — 세면 판매자가 붙여 넣어 같은 찜이 두 번', async () => {
    // fast-check 축소 반례: add 1 → 1초(보냄) → 떠남 → 200
    for (const reply of ['recorded', 'standby'] as const) {
      const timers = new FakeTimers()
      let resolveNext: ((r: ApiResult) => void) | null = null
      const api: Api = { call: () => new Promise((resolve) => (resolveNext = resolve)) }
      const outbox = new TikTokOutbox(api, timers, () => undefined)
      outbox.add(1, 'seller_kim', [comment('1')])
      timers.advance(1000)
      expect(resolveNext, '보내지 않음').not.toBeNull()
      outbox.dropTab(1)
      ;(resolveNext as ((r: ApiResult) => void) | null)?.(result(reply))
      await flushMicrotasks()
      expect(outbox.takeDropped().count, `${reply}: 서버가 저장한 댓글을 버린 수로 셈`).toBe(0)
    }
    // 같은 계열: 날아가는 묶음이 넘침으로 대기열 앞에서 잘려도, 그 묶음을 서버가 받았으면 세지 않는다
    const timers = new FakeTimers()
    let resolveNext: ((r: ApiResult) => void) | null = null
    const api: Api = { call: () => new Promise((resolve) => (resolveNext = resolve)) }
    const outbox = new TikTokOutbox(api, timers, () => undefined)
    outbox.add(1, 'seller_kim', [comment('a')])
    timers.advance(1000)
    outbox.add(1, 'seller_kim', Array.from({ length: TT_HOLD_MAX }, (_, i) => comment(String(i))))
    ;(resolveNext as ((r: ApiResult) => void) | null)?.(result('recorded'))
    await flushMicrotasks()
    expect(outbox.takeDropped().count, '넘침: 서버가 저장한 날아가던 댓글을 버린 수로 셈').toBe(0)
  })
})
