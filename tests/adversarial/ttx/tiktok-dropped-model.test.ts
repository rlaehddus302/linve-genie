// TTX 적대 시험 (test-domain): 확장이 버린 틱톡 댓글 수 회계 (AC-TTX-32, D-TTX-16·D-TTX-21).
// 확장은 대기열 넘침과 내 방송 화면을 떠나며 버린 "아직 보내지 않은" 댓글만 세어 다음 틱톡 상태의 dropped로 알린다.
// 409 거절·모양이 틀린 묶음(400)·다시 보내는 중(429·5xx·닿지 못함)·서버가 받은(200) 댓글은 세지 않는다.
// 날아가는 묶음(보냈고 답을 기다림)이 떠남·넘침으로 빠지면 답으로 정한다(D-TTX-21 (1)): 200·409·400 → 세지 않음, 429·5xx·닿지 못함 → 셈.
// 워커가 멈춰 답을 받지 못한 상태 알림·날아가던 떠난 묶음은 서버가 받았다고 본다(D-TTX-21 (2)) — 되살리지 않는다.
// 무작위 붙이기·응답·화면 떠남·상태 보내기(떼어 두기/받음/실패)·워커 다시 뜨기를 섞어,
//   (1) 서버가 받은 dropped 합 = 실제로 버려진 댓글 수 (다시 뜨기가 있어도 정확히 — 모형도 D-TTX-21 (2)대로 본다)
//   (2) 상태 하나에 싣는 수는 10,000 이하, 동시에 떼어 둔 상태끼리 같은 수를 두 번 싣지 않음
//   (3) 팝업 "놓친 틱톡 댓글" 수 = 넘쳐 잘린 보내지 않던 수 + 답이 429·5xx·닿지 못함인 날아가던 잘린 수 (D-TTX-21 (3), 화면 떠남·워커 멈춤은 넣지 않음)
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
  /** 팝업 "놓친 틱톡 댓글" 모형 (D-TTX-21 (3)): 넘쳐 잘린 보내지 않던 수 + 실패 답을 받은 날아가던 잘린 수. 화면 떠남은 넣지 않음 */
  let popup = 0
  /** 지금 날아가는 묶음 중 넘침으로 잘린 수 (답을 보고 정함) */
  let flyingTrimmed = 0

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
    if (r === '429' || r === '500' || r === 'net') popup += flyingTrimmed
    flyingTrimmed = 0
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
        const before = outbox.snapshot().items.map((held) => held.item.commentId)
        outbox.add(op.tab, 'seller_kim', items)
        const after = new Set(outbox.snapshot().items.map((held) => held.item.commentId))
        const flying = new Set(pending !== null && pending.gen === generation ? pending.items.map((it) => it.commentId) : [])
        for (const id of [...before, ...items.map((it) => it.commentId)]) {
          if (after.has(id)) continue
          if (flying.has(id)) flyingTrimmed += 1
          else popup += 1
        }
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
        // 워커가 멈춤: 날아가던 묶음·상태는 답이 없다. D-TTX-21 (2): 죽은 워커가 떼어 둔 상태와
        // 날아가던 묶음 중 대기열에서 이미 빠진(떠남·넘침) 댓글은 서버가 받았다고 본다 — 확장은 되살리지 않는다
        for (const r of reports) if (r.gen === generation) reportedToServer += r.report.count
        reports = []
        const saved = snapshot
        if (pending !== null && pending.gen === generation) {
          const kept = new Set(saved.items.map((held) => held.item.commentId))
          for (const it of pending.items) if (!kept.has(it.commentId) && !refused.has(it.commentId)) accepted.add(it.commentId)
        }
        generation += 1
        outbox = make(generation)
        outbox.restore(saved)
        // 워커가 멈춰 답을 받지 못한 날아가던 잘린 몫은 팝업 수에 넣지 않는다(D-TTX-21 (3))
        flyingTrimmed = 0
        break
      }
    }
    expect(outbox.dropped, `팝업 "놓친 틱톡 댓글" 수 ≠ 모형 (${op.kind}, 다시 뜨기 ${String(withRestart)})`).toBe(popup)
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
  expect(outbox.dropped, '끝까지 비운 뒤 팝업 수 ≠ 모형').toBe(popup)
  // 실제로 버려진 것 = 붙인 것 중 서버가 받지도(200) 거절하지도(409·400) 않은 것
  const reallyDropped = [...added].filter((id) => !accepted.has(id) && !refused.has(id)).length
  // 서버가 받은 댓글을 버린 수로 세지 않았는가 (세면 판매자가 붙여 넣어 같은 찜이 두 번 — D-TTX-16)
  const savedButCounted = reportedToServer - reallyDropped
  expect(reportedToServer, `버린 수 ${String(reallyDropped)} ≠ 알린 수 ${String(reportedToServer)} (차 ${String(savedButCounted)}, 다시 뜨기 ${String(withRestart)})`).toBe(reallyDropped)
}

describe('TTX 적대 — 확장이 버린 댓글 수 회계 (AC-TTX-32, D-TTX-16)', () => {
  it('TD-TTX-R30: 무작위 붙이기·응답·화면 떠남·상태 떼어 두기/받음/실패 — 서버가 받은 dropped 합 = 실제로 버려진 댓글 수, 상태 하나에 10,000 이하, 팝업 "놓친 틱톡 댓글" 수 = 모형 (SA-TTX-05, D-TTX-21 (3))', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(arbOp(false), { minLength: 1, maxLength: 50 }), async (ops) => {
        await runModel(ops, false)
      }),
      { numRuns: 300, seed: 20261026 },
    )
  })

  it('TD-TTX-R31: 워커 다시 뜨기를 섞어도 알린 수 = 실제로 버린 수 — 아직 떼어 두지 않은 수는 잃지 않고, 알리던 수·날아가던 떠난 묶음은 두 번 세지 않음, 팝업 수에 멈춘 워커의 날아가던 잘린 몫을 넣지 않음 (D-TTX-21 (2)(3))', async () => {
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

  it('TD-TTX-R33: 넘침이 10,000을 넘으면 상태마다 10,000씩 나눠 싣는다 · 동시에 떼어 둔 두 상태가 같은 수를 싣지 않음 · 실패한 것은 다음에 더함 · 잘린 날아가는 묶음은 답이 실패일 때만 셈 · 끊기 뒤 늦은 답은 되살리지 않음', async () => {
    const timers = new FakeTimers()
    let resolveNext: ((r: ApiResult) => void) | null = null
    let calls = 0
    const api: Api = {
      call: () =>
        new Promise<ApiResult>((resolve) => {
          calls += 1
          resolveNext = resolve
        }),
    }
    let saved: TikTokOutboxSnapshot = { items: [], dropped: 0 }
    const outbox = new TikTokOutbox(api, timers, () => undefined, (snap) => (saved = snap))
    let id = 0
    const batch = (n: number) => Array.from({ length: n }, () => comment(String(++id)))
    outbox.add(1, 'seller_kim', batch(1))
    timers.advance(1000)
    expect(calls, '첫 묶음을 보내지 않음').toBe(1)
    // 첫 묶음(1개)이 답을 기다리는 동안 뒤가 쌓여 넘친다 → 맨 앞에서 잘리는 1개는 날아가는 묶음이라 지금 세지 않는다(D-TTX-21 (1))
    for (let i = 0; i < 22; i += 1) outbox.add(1, 'seller_kim', batch(500))
    const overflow = 22 * 500 - TT_HOLD_MAX
    expect(overflow).toBeGreaterThan(TT_DROPPED_REPORT_MAX)
    expect(outbox.size).toBe(TT_HOLD_MAX)
    expect(outbox.unreported, '날아가는 묶음을 잘린 자리에서 셈').toBe(overflow)
    // D-TTX-21 (3): 팝업 수도 보내지 않던 몫(j = overflow)만 바로 센다 — 날아가던 1개(k)는 답이 실패일 때만
    expect(outbox.dropped, '팝업 "놓친 틱톡 댓글"에 날아가던 묶음을 답 전에 셈(200이면 붙여 넣어 이중 찜)').toBe(overflow)
    const first = outbox.takeDropped()
    const second = outbox.takeDropped()
    const third = outbox.takeDropped()
    expect(first.count).toBe(TT_DROPPED_REPORT_MAX)
    expect(second.count).toBe(overflow - TT_DROPPED_REPORT_MAX)
    expect(third.count).toBe(0)
    expect(outbox.unreported, '떼어 둔 것도 보관 수에 든다').toBe(overflow)
    expect(saved.unreported ?? 0, '세션 저장소에 알리는 중인 수를 둠 — 워커가 다시 뜨면 두 번 셈(D-TTX-21 (2))').toBe(0)
    outbox.settleDropped(second, false)
    expect(saved.unreported ?? 0, '살아 있는 워커가 받은 실패는 세션 저장소에도 되돌림').toBe(second.count)
    outbox.settleDropped(first, true)
    expect(outbox.unreported).toBe(overflow - TT_DROPPED_REPORT_MAX)
    // 잘린 날아가던 묶음의 답이 5xx → 다시 보내지 않으므로 그때 1개를 센다
    ;(resolveNext as ((r: ApiResult) => void) | null)?.(result('500'))
    await flushMicrotasks()
    expect(outbox.unreported, '잘린 날아가던 묶음이 실패했는데 세지 않음(잃은 댓글을 판매자가 모름)').toBe(overflow - TT_DROPPED_REPORT_MAX + 1)
    expect(saved.unreported ?? 0).toBe(overflow - TT_DROPPED_REPORT_MAX + 1)
    expect(outbox.dropped, '실패 답이면 팝업 수에 날아가던 몫 k=1을 더함 (j + k)').toBe(overflow + 1)
    expect(saved.dropped, '세션 저장소의 팝업 수도 j + k').toBe(overflow + 1)
    const again = outbox.takeDropped()
    expect(again.count).toBe(overflow - TT_DROPPED_REPORT_MAX + 1)
    outbox.stop()
    outbox.settleDropped(again, false)
    expect(outbox.unreported, '끊은 뒤 늦은 실패 답이 수를 되살림').toBe(0)
  })

  it('TD-TTX-R34: 날아가는 묶음이 떠남·넘침으로 빠지면 다시 보내지 않고 답으로 정한다 — 200·409·400은 0, 429·5xx·닿지 못함은 1 (AC-TTX-32 (8))', async () => {
    const replies: readonly [Reply, number][] = [
      ['recorded', 0],
      ['standby', 0],
      ['409', 0],
      ['400', 0],
      ['429', 1],
      ['500', 1],
      ['net', 1],
    ]
    for (const how of ['leave', 'overflow'] as const) {
      for (const [reply, expected] of replies) {
        const label = `${how}·${reply}`
        const timers = new FakeTimers()
        let resolveNext: ((r: ApiResult) => void) | null = null
        const sent: string[][] = []
        const api: Api = {
          call: (_m, _p, body) =>
            new Promise<ApiResult>((resolve) => {
              sent.push(((body?.items ?? []) as TikTokItem[]).map((it) => it.commentId))
              resolveNext = resolve
            }),
        }
        const outbox = new TikTokOutbox(api, timers, () => undefined)
        outbox.add(1, 'seller_kim', [comment('a')])
        timers.advance(1000)
        expect(sent, label).toEqual([['a']])
        if (how === 'leave') outbox.dropTab(1)
        else outbox.add(2, 'seller_kim', Array.from({ length: TT_HOLD_MAX }, (_, i) => comment(`b${String(i)}`)))
        expect(outbox.unreported, `${label}: 답이 오기 전에 셈`).toBe(0)
        ;(resolveNext as ((r: ApiResult) => void) | null)?.(result(reply))
        await flushMicrotasks()
        expect(outbox.unreported, label).toBe(expected)
        const report = outbox.takeDropped()
        expect(report.count, label).toBe(expected)
        outbox.settleDropped(report, true)
        // 다시 보내기·이어 보내기를 모두 흘려 보내도 'a'는 다시 가지 않는다 (서버가 받으면 이미 센 1개와 겹쳐 이중 찜)
        for (let i = 0; i < 40; i += 1) {
          ;(resolveNext as ((r: ApiResult) => void) | null)?.(result('recorded'))
          resolveNext = null
          timers.advance(31_000)
          await flushMicrotasks()
        }
        expect(sent.slice(1).flat().includes('a'), `${label}: 빠진 날아가던 묶음을 다시 보냄`).toBe(false)
        expect(outbox.size, label).toBe(0)
        expect(outbox.unreported, `${label}: 뒤 댓글이 저장됐는데 수가 늘어남`).toBe(0)
      }
    }
  })

  it('TD-TTX-R35: 날아가는 묶음 일부만 떠남 → 떠난 몫만 실패 때 세고, 남은 몫은 다시 보내 한 번 저장 (AC-TTX-32 (8)·(5))', async () => {
    for (const reply of ['recorded', '409', '500', 'net', '429'] as const) {
      const timers = new FakeTimers()
      let resolveNext: ((r: ApiResult) => void) | null = null
      const sent: string[][] = []
      const api: Api = {
        call: (_m, _p, body) =>
          new Promise<ApiResult>((resolve) => {
            sent.push(((body?.items ?? []) as TikTokItem[]).map((it) => it.commentId))
            resolveNext = resolve
          }),
      }
      const outbox = new TikTokOutbox(api, timers, () => undefined)
      outbox.add(1, 'seller_kim', [comment('t1-a'), comment('t1-b')])
      outbox.add(2, 'seller_kim', [comment('t2-a')])
      timers.advance(1000)
      expect(sent, reply).toEqual([['t1-a', 't1-b', 't2-a']])
      outbox.dropTab(1)
      ;(resolveNext as ((r: ApiResult) => void) | null)?.(result(reply))
      await flushMicrotasks()
      const failed = reply === '500' || reply === 'net' || reply === '429'
      expect(outbox.unreported, reply).toBe(failed ? 2 : 0)
      expect(outbox.size, reply).toBe(failed ? 1 : 0)
      if (failed) {
        timers.advance(31_000)
        await flushMicrotasks()
        expect(sent[1], `${reply}: 남은 몫만 다시 보내야 함`).toEqual(['t2-a'])
      }
    }
  })

  it('TD-TTX-R36: 워커 다시 뜨기 — 알리던 수·날아가던 떠난 묶음은 되살리지 않고, 떼어 두지 않은 수는 되살린다 (AC-TTX-32 (9))', async () => {
    const timers = new FakeTimers()
    const api: Api = { call: () => new Promise<ApiResult>(() => undefined) } // 죽은 워커의 답은 오지 않는다
    let saved: TikTokOutboxSnapshot = { items: [], dropped: 0 }
    const dead = new TikTokOutbox(api, timers, () => undefined, (snap) => (saved = snap))
    dead.add(1, 'seller_kim', [comment('fly')])
    timers.advance(1000) // 'fly' 날아감
    dead.add(2, 'seller_kim', [comment('x1'), comment('x2'), comment('x3')])
    dead.dropTab(2) // 아직 보내지 않은 3개 → 셈
    const report = dead.takeDropped() // 3개를 알리는 중에 워커가 멈춤
    expect(report.count).toBe(3)
    dead.add(2, 'seller_kim', [comment('y1'), comment('y2')])
    dead.dropTab(2) // 떼어 두지 않은 2개
    dead.dropTab(1) // 날아가던 'fly'가 떠남 — 답을 영영 모름
    expect(saved.items).toEqual([])
    const next = new TikTokOutbox({ call: () => new Promise<ApiResult>(() => undefined) }, new FakeTimers(), () => undefined)
    next.restore(saved)
    expect(next.unreported, '알리던 3개를 되살리거나(두 번 셈) 날아가던 1개를 셈, 또는 떼어 두지 않은 2개를 잃음').toBe(2)
    expect(next.takeDropped().count).toBe(2)
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
