// TTX 적대 시험 (test-domain): 확장 틱톡 대기열(TikTokOutbox)을 무작위 응답 열로 흔든다 (AC-TTX-07·10, D-TTX-02·05·08).
// 가짜 서버·가짜 타이머로 붙이기·응답(기록·대기·429·500·닿지 못함·409·400·401)·화면 떠남·워커 다시 뜨기를 섞고 확인한다:
//  (1) 한 번에 한 묶음만 (2) 묶음은 50개 이하·한 화면 아이디 (3) 서버가 처음 받은 순서 = 붙인 순서
//  (4) 화면을 떠난 뒤 그 탭의 안 보낸 댓글은 다시 보내지 않음 (5) 일부러 버린 것 말고는 잃지 않음 (6) 401 뒤엔 보내지 않음.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
// 확장 소스는 ext-outbox.ts 경계로 불러온다 — 루트 typecheck가 확장의 DOM 소스를 끌어오지 않게 (SA-TTX-01)
import { loadOutbox, type Api, type ApiResult, type TikTokItem, type TikTokOutboxSnapshot, type Timers } from './ext-outbox.ts'

const { TT_BATCH_MAX, TT_HOLD_MAX, TikTokOutbox } = await loadOutbox()

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
  /** ms만큼 시계를 돌리며 때가 된 것을 차례로 부른다 */
  advance(ms: number): void {
    const end = this.now + ms
    for (;;) {
      let pick: [number, { at: number; fn: () => void }] | null = null
      for (const entry of this.#due) if (entry[1].at <= end && (pick === null || entry[1].at < pick[1].at)) pick = entry
      if (pick === null) break
      this.#due.delete(pick[0])
      this.now = Math.max(this.now, pick[1].at)
      pick[1].fn()
    }
    this.now = end
  }
}

type Reply = 'recorded' | 'standby' | '429' | '500' | 'net' | '409' | '400' | '401'

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
    case '401':
      return { status: 401, code: 'EXT_DISCONNECTED', message: 'x', body: null, retryAfterMs: null }
  }
}

type Op =
  | { readonly kind: 'add'; readonly tab: number; readonly n: number }
  | { readonly kind: 'tick'; readonly ms: number }
  | { readonly kind: 'reply'; readonly reply: Reply }
  | { readonly kind: 'leave'; readonly tab: number }
  | { readonly kind: 'restart' }

const arbOp: fc.Arbitrary<Op> = fc.oneof(
  { weight: 4, arbitrary: fc.record({ kind: fc.constant('add' as const), tab: fc.integer({ min: 1, max: 2 }), n: fc.integer({ min: 1, max: 70 }) }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('tick' as const), ms: fc.constantFrom(0, 300, 1000, 2500, 31_000) }) },
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant('reply' as const),
      reply: fc.oneof(
        { weight: 6, arbitrary: fc.constantFrom<Reply>('recorded', 'standby') },
        { weight: 3, arbitrary: fc.constantFrom<Reply>('429', '500', 'net') },
        { weight: 1, arbitrary: fc.constantFrom<Reply>('409', '400') },
        { weight: 1, arbitrary: fc.constant<Reply>('401') },
      ),
    }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('leave' as const), tab: fc.integer({ min: 1, max: 2 }) }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'restart' as const }) },
)

const flushMicrotasks = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

async function runModel(ops: readonly Op[]): Promise<void> {
  const timers = new FakeTimers()
  let order = 0
  /** 댓글 ID → 붙인 차례·탭 */
  const added = new Map<string, { order: number; tab: number }>()
  /** 서버가 처음 받은(200) 댓글 ID, 받은 순서 */
  const accepted: string[] = []
  const acceptedSet = new Set<string>()
  /** 일부러 버린 것 (409·400 묶음, 화면 떠남) */
  const discarded = new Set<string>()
  /** 화면을 떠난 뒤 다시 보내면 안 되는 것 */
  const forbidden = new Set<string>()
  let disconnected = false
  let generation = 0
  type Pending = { gen: number; items: TikTokItem[]; resolve: (r: ApiResult) => void }
  let pending = null as Pending | null
  let snapshot: TikTokOutboxSnapshot = { items: [], dropped: 0 }
  let overflowBefore = 0

  const make = (gen: number) => {
    const api: Api = {
      call: (_method, _path, body) => {
        // (6) 401 뒤에는 보내지 않는다
        expect(disconnected, '401 뒤에 보냄').toBe(false)
        // (1) 한 번에 한 묶음
        expect(pending === null || pending.gen !== gen, '앞 응답 전에 다음 묶음').toBe(true)
        const items = (body?.items ?? []) as TikTokItem[]
        // (2) 50개 이하
        expect(items.length).toBeGreaterThan(0)
        expect(items.length).toBeLessThanOrEqual(TT_BATCH_MAX)
        expect(typeof body?.pageId).toBe('string')
        // (4) 떠난 화면의 안 보낸 댓글은 다시 보내지 않는다
        for (const it of items) expect(forbidden.has(it.commentId), `떠난 뒤 다시 보냄 ${it.commentId}`).toBe(false)
        return new Promise<ApiResult>((resolve) => {
          pending = { gen, items, resolve }
        })
      },
    }
    // 죽은 워커의 타이머는 다시 불리지 않는다
    const genTimers: Timers = { set: (fn, ms) => timers.set(() => { if (gen === generation) fn() }, ms), clear: (h) => timers.clear(h) }
    return new TikTokOutbox(api, genTimers, (event) => {
      if (event.kind === 'disconnected') disconnected = true
    }, (s) => {
      if (gen === generation) snapshot = s
    })
  }
  let outbox = make(generation)

  const reply = async (r: Reply) => {
    const p = pending
    if (p === null) return
    pending = null
    if (p.gen !== generation) return // 죽은 워커의 요청 — 답이 오지 않는다
    if (r === 'recorded' || r === 'standby') {
      for (const it of p.items) if (!acceptedSet.has(it.commentId)) {
        acceptedSet.add(it.commentId)
        accepted.push(it.commentId)
      }
    }
    if (r === '409' || r === '400') for (const it of p.items) if (!acceptedSet.has(it.commentId)) discarded.add(it.commentId)
    p.resolve(result(r))
    await flushMicrotasks()
  }

  for (const op of ops) {
    if (disconnected) break
    switch (op.kind) {
      case 'add': {
        const items: TikTokItem[] = []
        for (let i = 0; i < op.n; i += 1) {
          order += 1
          const commentId = String(7_400_000_000_000_000_000n + BigInt(order))
          added.set(commentId, { order, tab: op.tab })
          items.push({ commentId, userId: '7101', uniqueId: 'v', nickname: 'n', text: '15' })
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
      case 'leave': {
        const flying: TikTokItem[] = pending?.items ?? []
        const inFlight = new Set(flying.map((it) => it.commentId))
        for (const held of outbox.snapshot().items) {
          if (held.tab !== op.tab) continue
          if (!inFlight.has(held.item.commentId)) discarded.add(held.item.commentId)
          // 지금 날아가는 묶음 말고는 다시 보내면 안 된다 (날아가는 것도 실패 뒤엔 다시 보내지 않는다)
          if (!acceptedSet.has(held.item.commentId)) forbidden.add(held.item.commentId)
        }
        outbox.dropTab(op.tab)
        break
      }
      case 'restart': {
        // 서비스 워커가 멈췄다 다시 뜸: 날아가던 요청은 답이 없고, session에 둔 것으로 이어 보낸다
        overflowBefore = Math.max(overflowBefore, outbox.dropped)
        generation += 1
        const saved = snapshot
        outbox = make(generation)
        outbox.restore(saved)
        break
      }
    }
  }
  if (disconnected) {
    expect(outbox.size).toBe(0)
    return
  }
  // 끝까지 모두 성공으로 답하며 비운다
  for (let i = 0; i < 400 && (outbox.size > 0 || pending !== null); i += 1) {
    if (pending !== null) await reply('recorded')
    timers.advance(31_000)
    await flushMicrotasks()
  }
  expect(outbox.size, '비우지 못함').toBe(0)
  // (3) 처음 받은 순서 = 붙인 순서
  const orders = accepted.map((id) => added.get(id)?.order ?? -1)
  for (let i = 1; i < orders.length; i += 1) expect(orders[i]!, `순서 뒤바뀜 ${String(orders[i - 1])} → ${String(orders[i])}`).toBeGreaterThan(orders[i - 1]!)
  // (5) 잃지 않음: 받음 + 일부러 버림 + 넘쳐 버림 = 붙인 수
  const overflow = Math.max(overflowBefore, outbox.dropped)
  const lost = [...added.keys()].filter((id) => !acceptedSet.has(id) && !discarded.has(id) && !forbidden.has(id))
  expect(lost.length, `잃은 댓글 ${String(lost.length)}개, 넘쳐 버림 ${String(overflow)}`).toBeLessThanOrEqual(overflow)
}

describe('TTX 적대 — 확장 틱톡 대기열 모형 대조', () => {
  it('TD-TTX-R20: 무작위 붙이기·응답·화면 떠남·워커 다시 뜨기 — 한 번에 한 묶음, 순서 그대로, 떠난 화면 댓글 다시 안 보냄, 잃지 않음', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(arbOp, { minLength: 1, maxLength: 60 }), async (ops) => {
        await runModel(ops)
      }),
      { numRuns: 300, seed: 20261026 },
    )
  })

  it('TD-TTX-001: 다시 보내기를 기다리는 동안 화면을 떠나 대기열이 비면 — 다시 내 방송으로 와서 붙은 댓글을 보내야 한다(영영 멈추지 않음)', async () => {
    // fast-check 축소 반례: add 1 → 1초 → 떠남 → 429 → 31초 → add 1  (429 대신 500·닿지 못함도 같다)
    for (const failure of ['429', '500', 'net'] as const) {
      const timers = new FakeTimers()
      const sent: string[] = []
      let resolveNext: ((r: ApiResult) => void) | null = null
      const api: Api = {
        call: (_m, _p, body) => {
          for (const it of (body?.items ?? []) as TikTokItem[]) sent.push(it.commentId)
          return new Promise((resolve) => {
            resolveNext = resolve
          })
        },
      }
      const outbox = new TikTokOutbox(api, timers, () => undefined)
      const comment = (commentId: string): TikTokItem => ({ commentId, userId: '7101', uniqueId: 'v', nickname: '', text: '15' })
      outbox.add(1, 'seller_kim', [comment('1')])
      timers.advance(1000)
      expect(sent, failure).toEqual(['1'])
      // 판매자가 잠깐 다른 틱톡 화면으로 감 (ttLeave) — 날아가던 묶음은 실패
      outbox.dropTab(1)
      ;(resolveNext as ((r: ApiResult) => void) | null)?.(result(failure))
      await flushMicrotasks()
      timers.advance(31_000)
      await flushMicrotasks()
      // 다시 내 방송 화면: 새 댓글이 붙는다
      outbox.add(1, 'seller_kim', [comment('2')])
      for (let i = 0; i < 5; i += 1) {
        timers.advance(31_000)
        await flushMicrotasks()
      }
      expect(sent, `${failure} 뒤 새 댓글을 보내지 않음 (대기 ${String(outbox.size)}개)`).toEqual(['1', '2'])
    }
  })

  it('TD-TTX-R21: 500개를 넘게 붙이면 오래된 것부터 버리고 센다 — 남은 것은 최근 500개, 순서 그대로', async () => {
    const timers = new FakeTimers()
    const sent: string[] = []
    let resolveNext: ((r: ApiResult) => void) | null = null
    const api: Api = {
      call: (_m, _p, body) => {
        for (const it of (body?.items ?? []) as TikTokItem[]) sent.push(it.commentId)
        return new Promise((resolve) => {
          resolveNext = resolve
        })
      },
    }
    const outbox = new TikTokOutbox(api, timers, () => undefined)
    // 첫 묶음이 답 없이 매달린 동안 700개가 더 붙는다
    outbox.add(1, 'seller_kim', [{ commentId: '1', userId: '7101', uniqueId: 'v', nickname: '', text: '15' }])
    timers.advance(1000)
    const later = Array.from({ length: 700 }, (_, i) => ({ commentId: String(1000 + i), userId: '7101', uniqueId: 'v', nickname: '', text: '15' }))
    outbox.add(1, 'seller_kim', later)
    expect(outbox.size).toBe(TT_HOLD_MAX)
    // 701개 중 201개가 잘림: 보내지 않던 200개(j)는 바로 팝업 수에, 날아가던 '1'(k)은 답을 보고 정한다(D-TTX-21 (3))
    expect(outbox.dropped, '날아가던 묶음을 답 전에 팝업 수에 셈').toBe(700 - TT_HOLD_MAX)
    const held = outbox.snapshot().items.map((h) => h.item.commentId)
    expect(held).toEqual(later.slice(-TT_HOLD_MAX).map((it) => it.commentId))
    ;(resolveNext as ((r: ApiResult) => void) | null)?.(result('recorded'))
    await flushMicrotasks()
    expect(outbox.dropped, '서버가 받은(200) 날아가던 댓글을 팝업 "놓친 댓글"에 셈').toBe(700 - TT_HOLD_MAX)
    for (let i = 0; i < 20; i += 1) {
      timers.advance(1000)
      await flushMicrotasks()
      ;(resolveNext as ((r: ApiResult) => void) | null)?.(result('recorded'))
      await flushMicrotasks()
    }
    expect(sent.slice(1)).toEqual(later.slice(-TT_HOLD_MAX).map((it) => it.commentId))
  })
})
