// MOB2 적대 시험 (test-domain) — AC-MOB2-34 · R-5 · D-MOB2-06
// 화면의 "보류 · 시간 지남" 판단(apps/web/src/lib/derive.ts)과 코어 R-5(공개 시각 T에 at ≥ T − W이면 판정, 더 오래되면 EXPIRED)가
// 같은 경계를 쓰는가. 화면은 엔진 조회 결과를 서버처럼 ISO로 바꾼 모양(withIsoTimes)을 받는다 — 서버 → 화면 길 그대로 흉내 낸다.
// 공개 길 셋: ① 없는 번호에 바로 등록(OPEN) ② READY로 등록한 뒤 product.open ③ 판매 중 상품을 보류 찜이 있는 번호로 번호 바꾸기.
// 화면 파일은 DOM 타입으로 검사하므로 경로를 값으로 불러온다(s05/quick-input-consistency.test.ts와 같은 까닭).
import {
  applyEvent,
  checkSettings,
  initEngine,
  listBroadcasts,
  listCancelRequests,
  listClaims,
  listEffects,
  listPending,
  listProducts,
  listSettlements,
  listBuyers,
  type EngineEvent,
  type EngineState,
} from '@livejjim/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { withIsoTimes } from '../../../apps/server/src/time.ts'

const DERIVE_MODULE = '../../../apps/web/src/lib/derive.ts'
const SCOPE_MODULE = '../../../apps/web/src/lib/scope-data.ts'

interface Derive {
  pendingWindowPassed(atMs: number, nowMs: number, windowSec: number): boolean
  isPendingTimedOut(data: unknown, claim: unknown, now: number): boolean
  alertCounts(data: unknown, now?: number): { pending: number }
  splitPending(data: unknown, now: number): { live: { no: number; claims: unknown[] }[]; timedOut: { no: number; claims: unknown[] }[] }
  nextPendingFlip(data: unknown, now: number): number | null
  claimWord(data: unknown, claim: unknown, now?: number): string
  PENDING_TIMED_OUT_WORD: string
}
interface ScopeModule {
  fromFull(view: unknown): { claims: ReadonlyMap<string, { id: string; status: string; at: string }> }
}

const load = async (): Promise<{ d: Derive; s: ScopeModule }> => ({
  d: (await import(/* @vite-ignore */ DERIVE_MODULE)) as Derive,
  s: (await import(/* @vite-ignore */ SCOPE_MODULE)) as ScopeModule,
})

const B = { id: 'b1', date: '2026-10-18', title: '1부' } as const
/** 2026-10-18 20:00:00 KST */
const T0 = Date.UTC(2026, 9, 18, 11, 0, 0)
/** 엔진이 받는 유효 시간들 (AC-MOB2-34의 W 목록에서 엔진 범위 int(0, 300) 안의 것 + 상한 300) */
const ENGINE_WINDOWS = [0, 1, 30, 45, 300] as const

type Path = 'register' | 'ready-open' | 'renumber'

/** 서버가 화면에 주는 범위 전체 조회 모양 (GET /api/days/:date — 조회 함수 결과 + ISO 시각) */
function fullView(state: EngineState): unknown {
  return withIsoTimes({
    date: B.date,
    rehearsal: false,
    seq: 0,
    attention: [],
    depositLinks: [],
    broadcasts: listBroadcasts(state),
    products: listProducts(state),
    claims: listClaims(state),
    pending: listPending(state),
    buyers: listBuyers(state),
    settlements: listSettlements(state),
    effects: listEffects(state),
    cancelRequests: listCancelRequests(state),
  })
}

interface Run {
  /** 공개 직전 상태 */
  readonly before: EngineState
  /** 공개 뒤 상태 */
  readonly after: EngineState
}

/**
 * 번호 31에 보류 찜들(at 목록, 시청자 각자)을 넣고 시각 T에 공개한다.
 * renumber 길은 번호 77에 판매 중 상품을 먼저 두고 T에 77 → 31로 바꾼다(R-5 — 판매 중 상품이 보류 찜이 있는 번호로 오면 그 순간 공개).
 */
function run(path: Path, windowSec: number, ats: readonly number[], openAt: number, stock: number): Run {
  let state = initEngine({ broadcasts: [B], settings: { 'claim.preOpenWindowSec': windowSec } })
  let seq = 0
  const apply = (event: Record<string, unknown>): void => {
    state = applyEvent(state, { ...event, seq: ++seq } as unknown as EngineEvent).state
  }
  const first = Math.min(openAt, ...ats)
  if (path === 'ready-open') apply({ type: 'product.register', b: 'b1', no: 31, name: '핑크프릴', price: 10000, stock, status: 'READY', at: first - 1 })
  if (path === 'renumber') apply({ type: 'product.register', b: 'b1', no: 77, name: '핑크프릴', price: 10000, stock, at: first - 1 })
  // 보류 찜은 도착(seq) 차례로 넣는다 — at이 들쭉날쭉해도 된다(문자찜 받은 시각·채팅 at)
  ats.forEach((at, i) => apply({ type: 'chat', b: 'b1', id: `m${String(i)}`, ch: `c${String(i)}`, nick: `시청자${String(i)}`, text: '31', at }))
  const before = state
  if (path === 'register') apply({ type: 'product.register', b: 'b1', no: 31, name: '핑크프릴', price: 10000, stock, at: openAt })
  if (path === 'ready-open') apply({ type: 'product.open', b: 'b1', no: 31, at: openAt })
  if (path === 'renumber') apply({ type: 'product.renumber', b: 'b1', from: 77, to: 31, at: openAt })
  return { before, after: state }
}

describe('AC-MOB2-34 화면의 "시간 지남"과 코어 R-5의 경계가 같다', () => {
  it('엔진이 받는 W 범위 확인 — 0·1·30·45·300은 받고 600은 거절(설정표 int(0, 300))', () => {
    for (const w of ENGINE_WINDOWS) expect(checkSettings({ 'claim.preOpenWindowSec': w }), String(w)).toEqual([])
    expect(checkSettings({ 'claim.preOpenWindowSec': 600 }).length).toBeGreaterThan(0)
  })

  it('순수 함수 대조: pendingWindowPassed(at, T, W) = (at < T − W×1000) — W 0·1·30·45·300(설정 범위 0~300, D-MOB2-11), 무작위 밀리초 (시드 고정)', async () => {
    const { d } = await load()
    fc.assert(
      fc.property(fc.constantFrom(...ENGINE_WINDOWS), fc.integer({ min: -2_000_000, max: 2_000_000 }), fc.integer({ min: 0, max: 4_000_000_000 }), (w, delta, base) => {
        const at = T0 + base
        const t = at + delta
        // 코어 openPending: start = T − W×1000, claim.at < start → EXPIRED
        const coreExpired = at < t - w * 1000
        expect(d.pendingWindowPassed(at, t, w)).toBe(coreExpired)
      }),
      { seed: 20261026, numRuns: 3000 },
    )
  })

  it('엔진 대조(속성): 공개 직전 화면이 "시간 지남"이면 그 시각 공개에서 반드시 EXPIRED, 아니면 반드시 판정(EXPIRED 아님) — 세 공개 길', async () => {
    const { d, s } = await load()
    fc.assert(
      fc.property(
        fc.constantFrom<Path>('register', 'ready-open', 'renumber'),
        fc.constantFrom(...ENGINE_WINDOWS),
        // 공개 시각 기준 앞뒤 밀리초: 경계 근처(±2초)와 먼 값을 섞는다
        fc.array(fc.oneof(fc.integer({ min: -2_000, max: 2_000 }), fc.integer({ min: -400_000, max: 0 })), { minLength: 1, maxLength: 6 }),
        fc.integer({ min: 1, max: 3 }),
        (path, w, offsets, stock) => {
          const openAt = T0 + 1_000_000
          // 보류 찜은 공개 전 도착(at ≤ T) — 공개 뒤 at은 보류 찜이 아니다
          const ats = offsets.map((o) => openAt - w * 1000 + o).map((at) => Math.min(at, openAt))
          const { before, after } = run(path, w, ats, openAt, stock)
          const data = s.fromFull(fullView(before)) as never
          const beforeClaims = listClaims(before)
          expect(beforeClaims.every((c) => c.status === 'PENDING')).toBe(true)
          const afterById = new Map(listClaims(after).map((c) => [c.id, c]))
          let live = 0
          for (const claim of beforeClaims) {
            const shown = (s.fromFull(fullView(before)) as unknown as { claims: ReadonlyMap<string, unknown> }).claims.get(claim.id)
            expect(shown, claim.id).toBeDefined()
            const timedOut = d.isPendingTimedOut(data, shown, openAt)
            const result = afterById.get(claim.id)
            const expired = result?.status === 'REJECTED' && result.reason === 'EXPIRED'
            expect(timedOut, `${path} W=${String(w)} at=T${String(claim.at - openAt)}ms → ${String(result?.status)}/${String(result?.reason)}`).toBe(expired)
            expect(result?.status, '공개 뒤에도 보류로 남으면 안 된다').not.toBe('PENDING')
            if (!timedOut) live++
            // 낱말: 시간 지남이면 "보류 · 시간 지남", 아니면 그 말이 아니다
            const word = d.claimWord(data, shown, openAt)
            if (timedOut) expect(word).toBe(d.PENDING_TIMED_OUT_WORD)
            else expect(word).not.toBe(d.PENDING_TIMED_OUT_WORD)
          }
          // 알림 띠 수·보류 찜 창(상품이 없는 번호의 묶음 — register·renumber 길)도 같은 판단
          if (path !== 'ready-open') {
            expect(d.alertCounts(data, openAt).pending).toBe(live)
            const split = d.splitPending(data, openAt)
            if (live === 0) {
              expect(split.live).toEqual([])
              expect(split.timedOut.map((g) => g.no)).toEqual([31])
            } else {
              expect(split.live.map((g) => g.no)).toEqual([31])
              expect(split.timedOut).toEqual([])
            }
          }
        },
      ),
      { seed: 34, numRuns: 400 },
    )
  })

  it('nextPendingFlip은 화면 판단이 거짓 → 참으로 바뀌는 첫 밀리초다 (그 1ms 앞은 아직 보류, 그때는 시간 지남)', async () => {
    const { d, s } = await load()
    fc.assert(
      fc.property(fc.constantFrom(...ENGINE_WINDOWS), fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 1, maxLength: 4 }), (w, offsets) => {
        const ats = offsets.map((o) => T0 + o)
        const { before } = run('register', w, ats, T0 + 10_000_000, 1)
        const data = s.fromFull(fullView(before)) as never
        const now = T0
        const flip = d.nextPendingFlip(data, now)
        const earliest = Math.min(...ats.filter((at) => at + w * 1000 + 1 > now).map((at) => at + w * 1000 + 1))
        expect(flip).toBe(Number.isFinite(earliest) ? earliest : null)
        if (flip === null) return
        const claims = [...(s.fromFull(fullView(before)) as unknown as { claims: ReadonlyMap<string, { at: string }> }).claims.values()]
        const firstFlipping = claims.filter((c) => Date.parse(c.at) + w * 1000 + 1 === flip)
        for (const c of firstFlipping) {
          expect(d.isPendingTimedOut(data, c, flip - 1)).toBe(false)
          expect(d.isPendingTimedOut(data, c, flip)).toBe(true)
        }
      }),
      { seed: 341, numRuns: 200 },
    )
  })

  describe('경계 사례 (고정)', () => {
    const cases: { name: string; w: number; offset: number; expired: boolean }[] = [
      { name: 'W=0 같은 밀리초 — 판정', w: 0, offset: 0, expired: false },
      { name: 'W=0 1ms 앞 — 만료', w: 0, offset: -1, expired: true },
      { name: 'W=30 정확히 30초 앞(경계 정각) — 판정', w: 30, offset: -30_000, expired: false },
      { name: 'W=30 30초 + 1ms 앞 — 만료', w: 30, offset: -30_001, expired: true },
      { name: 'W=1 999ms 앞 — 판정', w: 1, offset: -999, expired: false },
      { name: 'W=45 45초 + 1ms 앞 — 만료', w: 45, offset: -45_001, expired: true },
      { name: 'W=300 300초 정각 — 판정', w: 300, offset: -300_000, expired: false },
    ]
    for (const path of ['register', 'ready-open', 'renumber'] as const) {
      for (const c of cases) {
        it(`${path}: ${c.name}`, async () => {
          const { d, s } = await load()
          const openAt = T0 + 1_000_000
          const { before, after } = run(path, c.w, [openAt + c.offset], openAt, 1)
          const data = s.fromFull(fullView(before)) as never
          const [claim] = listClaims(before)
          const shown = (s.fromFull(fullView(before)) as unknown as { claims: ReadonlyMap<string, unknown> }).claims.get(claim?.id ?? '')
          expect(d.isPendingTimedOut(data, shown, openAt)).toBe(c.expired)
          const [result] = listClaims(after)
          expect(result?.reason === 'EXPIRED').toBe(c.expired)
          if (!c.expired) expect(result?.status).toBe('CONFIRMED')
        })
      }
    }
  })
})
