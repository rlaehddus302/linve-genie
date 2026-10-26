// MOB2 적대 시험 (test-domain) — AC-MOB2-34 · R-5 · D-MOB2-06 · D-MOB2-15
// 화면의 "보류 · 시간 지남"은 이제 (지금 − 이 탭이 그 찜을 처음 받은 시각 seen)로 잰다(D-MOB2-15). 처음 받은 시각은 실제 들어온 때보다
// 늘 같거나 늦으므로(seen ≥ at, 같은 시계 위) 화면이 엔진보다 먼저 "시간 지남"이라 하면 안 된다 — 늦게 바뀌는 쪽만.
// 1) seen ≥ at 무작위: 시간 지남(seen, T, W) = 참 ⇒ T 공개에서 반드시 EXPIRED. seen = at이면 같음(참 ⇔ EXPIRED).
// 2) 휴대폰 시계 차이 Δ(±5분): 서버 시계 기준 at·T, 기기 시계 = 실제 + Δ. 탭이 실제로 받은 때 r ≥ at에 seen = r + Δ, 지금 = r_eval + Δ.
//    어떤 Δ에서도 시간 지남 ⇒ EXPIRED, 바로 받았으면(r = at) Δ와 상관없이 같음. (RA-MOB2-04 — at 기준이면 Δ=+90초에서 깨지던 것)
// 3) 실제 ClaimSeen.note: 처음 값 유지·새 찜만 그때 시각·범위(날짜·리허설)별 따로, seen 기록은 있는데 그 찜이 없으면 시간 지남 아님.
// 4) nextPendingFlip = 가장 이른 seen + W×1000 + 1, 그 1ms 앞은 보류.
// 화면 파일은 DOM 타입으로 검사하므로 경로를 값으로 불러온다(pending-window-property.test.ts와 같은 까닭).
import {
  applyEvent,
  initEngine,
  listBroadcasts,
  listBuyers,
  listCancelRequests,
  listClaims,
  listEffects,
  listPending,
  listProducts,
  listSettlements,
  type EngineEvent,
  type EngineState,
} from '@livejjim/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { withIsoTimes } from '../../../apps/server/src/time.ts'

const DERIVE_MODULE = '../../../apps/web/src/lib/derive.ts'
const SCOPE_MODULE = '../../../apps/web/src/lib/scope-data.ts'
const SEEN_MODULE = '../../../apps/web/src/lib/claim-seen.ts'

interface SeenAt {
  get(id: string): number | undefined
}
interface Data {
  readonly date: string
  readonly rehearsal: boolean
  readonly claims: ReadonlyMap<string, { id: string; status: string; at: string }>
  readonly seen?: SeenAt
}
interface Derive {
  isPendingTimedOut(data: unknown, claim: unknown, now: number): boolean
  alertCounts(data: unknown, now?: number): { pending: number }
  splitPending(data: unknown, now: number): { live: { no: number }[]; timedOut: { no: number }[] }
  nextPendingFlip(data: unknown, now: number): number | null
  claimWord(data: unknown, claim: unknown, now?: number): string
  pendingStart(data: unknown, claim: unknown): number | null
  PENDING_TIMED_OUT_WORD: string
}
interface ScopeModule {
  fromFull(view: unknown): Data
}
interface SeenModule {
  ClaimSeen: new () => { note<T extends Data>(data: T, now: number): T; view(scope: { date: string; rehearsal: boolean }): SeenAt }
}

const load = async (): Promise<{ d: Derive; s: ScopeModule; seen: SeenModule }> => ({
  d: (await import(/* @vite-ignore */ DERIVE_MODULE)) as Derive,
  s: (await import(/* @vite-ignore */ SCOPE_MODULE)) as ScopeModule,
  seen: (await import(/* @vite-ignore */ SEEN_MODULE)) as SeenModule,
})

const B = { id: 'b1', date: '2026-10-18', title: '1부' } as const
/** 2026-10-18 20:00:00 KST */
const T0 = Date.UTC(2026, 9, 18, 11, 0, 0)
const WINDOWS = [0, 1, 30, 45, 300] as const
type Path = 'register' | 'ready-open' | 'renumber'

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

/** 번호 31에 보류 찜들(at 목록)을 넣고 openAt에 공개한다 (pending-window-property.test.ts와 같은 세 길) */
function run(path: Path, windowSec: number, ats: readonly number[], openAt: number, stock: number): { before: EngineState; after: EngineState } {
  let state = initEngine({ broadcasts: [B], settings: { 'claim.preOpenWindowSec': windowSec } })
  let seq = 0
  const apply = (event: Record<string, unknown>): void => {
    state = applyEvent(state, { ...event, seq: ++seq } as unknown as EngineEvent).state
  }
  const first = Math.min(openAt, ...ats)
  if (path === 'ready-open') apply({ type: 'product.register', b: 'b1', no: 31, name: '핑크프릴', price: 10000, stock, status: 'READY', at: first - 1 })
  if (path === 'renumber') apply({ type: 'product.register', b: 'b1', no: 77, name: '핑크프릴', price: 10000, stock, at: first - 1 })
  ats.forEach((at, i) => apply({ type: 'chat', b: 'b1', id: `m${String(i)}`, ch: `c${String(i)}`, nick: `시청자${String(i)}`, text: '31', at }))
  const before = state
  if (path === 'register') apply({ type: 'product.register', b: 'b1', no: 31, name: '핑크프릴', price: 10000, stock, at: openAt })
  if (path === 'ready-open') apply({ type: 'product.open', b: 'b1', no: 31, at: openAt })
  if (path === 'renumber') apply({ type: 'product.renumber', b: 'b1', from: 77, to: 31, at: openAt })
  return { before, after: state }
}

/** 화면 자료에 처음 받은 시각 기록을 붙인다 (저장소가 하는 일 — 값은 시험이 정한다) */
function withSeen(data: Data, seenOf: ReadonlyMap<string, number>): Data {
  return { ...data, seen: { get: (id: string) => seenOf.get(id) } }
}

interface Check {
  readonly path: Path
  readonly w: number
  readonly openAt: number
  /** 찜 id → [at(서버 시계), seen(기기 시계), 지금(기기 시계)] */
  readonly rows: ReadonlyMap<string, readonly [number, number, number]>
}

const label = (c: Check, id: string): string => {
  const [at, seen, now] = c.rows.get(id) ?? [0, 0, 0]
  return `${c.path} W=${String(c.w)} at=T${String(at - c.openAt)} seen=at+${String(seen - at)} now=seen+${String(now - seen)}`
}

describe('AC-MOB2-34 (D-MOB2-15) 처음 받은 시각으로 잰 화면 판단은 엔진보다 먼저 "시간 지남"이라 하지 않는다', () => {
  it('속성: seen ≥ at, 지금 ≤ T(공개 전 화면) — 시간 지남이면 T 공개에서 반드시 EXPIRED, seen = at이고 지금 = T면 같음 (세 공개 길, 시드 고정)', async () => {
    const { d, s } = await load()
    fc.assert(
      fc.property(
        fc.constantFrom<Path>('register', 'ready-open', 'renumber'),
        fc.constantFrom(...WINDOWS),
        fc.array(
          fc.record({
            offset: fc.oneof(fc.integer({ min: -2_000, max: 2_000 }), fc.integer({ min: -400_000, max: 0 })),
            // 처음 받은 때의 늦음: 0(바로)·짧은 늦음·새로고침(아주 늦게)
            lag: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 3_000 }), fc.integer({ min: 0, max: 400_000 })),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        fc.integer({ min: 0, max: 5_000 }),
        fc.integer({ min: 1, max: 3 }),
        (path, w, rows, early, stock) => {
          const openAt = T0 + 1_000_000
          const ats = rows.map((r) => Math.min(openAt - w * 1000 + r.offset, openAt))
          const { before, after } = run(path, w, ats, openAt, stock)
          const base = s.fromFull(fullView(before))
          const claims = [...base.claims.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
          // id ↔ at 짝: 화면 자료에서 바로 읽는다
          const seenOf = new Map<string, number>()
          const engineIds = listClaims(before).map((c) => c.id)
          engineIds.forEach((id, i) => {
            const at = Date.parse(base.claims.get(id)?.at ?? '')
            seenOf.set(id, Math.min(at + (rows[i]?.lag ?? 0), openAt))
          })
          const data = withSeen(base, seenOf)
          const now = openAt - early
          const afterById = new Map(listClaims(after).map((c) => [c.id, c]))
          const check: Check = { path, w, openAt, rows: new Map(claims.map((c) => [c.id, [Date.parse(c.at), seenOf.get(c.id) ?? 0, now] as const])) }
          let live = 0
          for (const claim of claims) {
            const timedOut = d.isPendingTimedOut(data, claim, now)
            const result = afterById.get(claim.id)
            const expired = result?.status === 'REJECTED' && result.reason === 'EXPIRED'
            if (timedOut) expect(expired, `화면이 먼저 시간 지남 — ${label(check, claim.id)} → ${String(result?.status)}/${String(result?.reason)}`).toBe(true)
            // 늦게 바뀌는 쪽만: seen = at이고 지금 = T면 정확히 같다
            if (seenOf.get(claim.id) === Date.parse(claim.at) && now === openAt) expect(timedOut, label(check, claim.id)).toBe(expired)
            if (!timedOut) live++
            const word = d.claimWord(data, claim, now)
            expect(word === d.PENDING_TIMED_OUT_WORD, label(check, claim.id)).toBe(timedOut)
          }
          if (path !== 'ready-open') {
            expect(d.alertCounts(data, now).pending).toBe(live)
            const split = d.splitPending(data, now)
            expect(split.live.map((g) => g.no)).toEqual(live === 0 ? [] : [31])
            expect(split.timedOut.map((g) => g.no)).toEqual(live === 0 ? [31] : [])
          }
        },
      ),
      { seed: 2026_1026, numRuns: 400 },
    )
  })

  it('속성 (RA-MOB2-04): 휴대폰 시계가 서버보다 Δ(−5분~+5분) 어긋나도 시간 지남 ⇒ EXPIRED, 바로 받았으면 Δ와 상관없이 같음', async () => {
    const { d, s } = await load()
    fc.assert(
      fc.property(
        fc.constantFrom<Path>('register', 'ready-open', 'renumber'),
        fc.constantFrom(...WINDOWS),
        fc.oneof(fc.constantFrom(-300_000, -90_000, -1, 0, 1, 90_000, 300_000), fc.integer({ min: -300_000, max: 300_000 })),
        fc.oneof(fc.integer({ min: -2_000, max: 2_000 }), fc.integer({ min: -400_000, max: 0 })),
        fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 400_000 })),
        (path, w, skew, offset, lag) => {
          const openAt = T0 + 1_000_000
          const at = Math.min(openAt - w * 1000 + offset, openAt)
          const { before, after } = run(path, w, [at], openAt, 1)
          const base = s.fromFull(fullView(before))
          const [claim] = [...base.claims.values()]
          if (claim === undefined) throw new Error('찜이 없다')
          // 실제 시각 r(서버 시계와 같음)에 받음, 기기 시계는 r + skew
          const received = Math.min(at + lag, openAt)
          const data = withSeen(base, new Map([[claim.id, received + skew]]))
          const nowDevice = openAt + skew
          const timedOut = d.isPendingTimedOut(data, claim, nowDevice)
          const [result] = listClaims(after)
          const expired = result?.status === 'REJECTED' && result.reason === 'EXPIRED'
          const why = `${path} W=${String(w)} Δ=${String(skew)} at=T${String(at - openAt)} lag=${String(received - at)}`
          if (timedOut) expect(expired, `화면이 먼저 시간 지남 — ${why}`).toBe(true)
          if (received === at) expect(timedOut, why).toBe(expired)
        },
      ),
      { seed: 15, numRuns: 1500 },
    )
  })

  it('고정 사례 (AC-MOB2-35 시작 조건): 기기 시계 +90초, W=30, 막 들어온 찜 — 받자마자 "보류", 그 탭 시계로 30초 정각은 보류, 30초 + 1ms에 시간 지남', async () => {
    const { d, s } = await load()
    const at = T0
    const { before } = run('register', 30, [at], T0 + 10_000_000, 1)
    const base = s.fromFull(fullView(before))
    const [claim] = [...base.claims.values()]
    const seenDevice = at + 90_000
    const data = withSeen(base, new Map([[claim?.id ?? '', seenDevice]]))
    expect(d.isPendingTimedOut(data, claim, seenDevice)).toBe(false)
    expect(d.claimWord(data, claim, seenDevice)).not.toBe(d.PENDING_TIMED_OUT_WORD)
    expect(d.alertCounts(data, seenDevice).pending).toBe(1)
    expect(d.isPendingTimedOut(data, claim, seenDevice + 30_000)).toBe(false)
    expect(d.isPendingTimedOut(data, claim, seenDevice + 30_001)).toBe(true)
    expect(d.claimWord(data, claim, seenDevice + 30_001)).toBe(d.PENDING_TIMED_OUT_WORD)
    expect(d.alertCounts(data, seenDevice + 30_001).pending).toBe(0)
    expect(d.nextPendingFlip(data, seenDevice)).toBe(seenDevice + 30_001)
  })

  it('seen 기록은 있는데 그 찜이 없으면 시간 지남이 아니다 (아무리 오래돼도) — 다음 바뀜 시각에도 넣지 않는다', async () => {
    const { d, s } = await load()
    const { before } = run('register', 0, [T0], T0 + 10_000_000, 1)
    const data = withSeen(s.fromFull(fullView(before)), new Map())
    const [claim] = [...data.claims.values()]
    const farFuture = T0 + 24 * 3600_000
    expect(d.pendingStart(data, claim)).toBeNull()
    expect(d.isPendingTimedOut(data, claim, farFuture)).toBe(false)
    expect(d.claimWord(data, claim, farFuture)).not.toBe(d.PENDING_TIMED_OUT_WORD)
    expect(d.alertCounts(data, farFuture).pending).toBe(1)
    expect(d.nextPendingFlip(data, T0)).toBeNull()
    // seen이 없는 자료(저장소를 거치지 않음)는 지금처럼 at으로 잰다
    const bare = s.fromFull(fullView(before))
    expect(d.pendingStart(bare, claim)).toBe(T0)
    expect(d.isPendingTimedOut(bare, claim, T0 + 1)).toBe(true)
  })

  it('속성: nextPendingFlip = 아직 안 바뀐 것 중 가장 이른 seen + W×1000 + 1, 그 1ms 앞은 보류·그때는 시간 지남', async () => {
    const { d, s } = await load()
    fc.assert(
      fc.property(
        fc.constantFrom(...WINDOWS),
        fc.array(fc.record({ offset: fc.integer({ min: 0, max: 100_000 }), lag: fc.integer({ min: 0, max: 200_000 }) }), { minLength: 1, maxLength: 4 }),
        fc.integer({ min: 0, max: 400_000 }),
        (w, rows, sinceT0) => {
          const ats = rows.map((r) => T0 + r.offset)
          const { before } = run('register', w, ats, T0 + 10_000_000, 1)
          const base = s.fromFull(fullView(before))
          const ids = listClaims(before).map((c) => c.id)
          const seenOf = new Map(ids.map((id, i) => [id, Date.parse(base.claims.get(id)?.at ?? '') + (rows[i]?.lag ?? 0)]))
          const data = withSeen(base, seenOf)
          const now = T0 + sinceT0
          const flips = [...seenOf.values()].map((v) => v + w * 1000 + 1).filter((f) => f > now)
          const flip = d.nextPendingFlip(data, now)
          expect(flip).toBe(flips.length === 0 ? null : Math.min(...flips))
          if (flip === null) return
          for (const id of ids) {
            if ((seenOf.get(id) ?? 0) + w * 1000 + 1 !== flip) continue
            const claim = data.claims.get(id)
            expect(d.isPendingTimedOut(data, claim, flip - 1)).toBe(false)
            expect(d.isPendingTimedOut(data, claim, flip)).toBe(true)
          }
        },
      ),
      { seed: 3415, numRuns: 300 },
    )
  })
})

describe('D-MOB2-15 ClaimSeen — 이 탭이 처음 받은 시각 기록', () => {
  it('처음 받은 시각은 그대로, 나중 자료(전체 다시 받기·증분처럼 새 목록)에 처음 들어온 찜만 그때 시각 — 판단도 그 시각으로', async () => {
    const { d, s, seen } = await load()
    const record = new seen.ClaimSeen()
    // 찜 둘(at = T0, T0 + 1초), 그 뒤 하나 더(T0 + 50초)
    const two = run('register', 30, [T0, T0 + 1_000], T0 + 10_000_000, 1).before
    const three = run('register', 30, [T0, T0 + 1_000, T0 + 50_000], T0 + 10_000_000, 1).before
    const first = record.note(s.fromFull(fullView(two)), T0 + 5_000)
    const ids = [...first.claims.keys()]
    for (const id of ids) expect(first.seen?.get(id)).toBe(T0 + 5_000)
    // 같은 목록을 다시 넘기면 아무것도 바꾸지 않는다
    expect(record.note(first, T0 + 9_999).seen?.get(ids[0] ?? '')).toBe(T0 + 5_000)
    const later = record.note(s.fromFull(fullView(three)), T0 + 60_000)
    const newId = [...later.claims.keys()].find((id) => !ids.includes(id)) ?? ''
    for (const id of ids) expect(later.seen?.get(id), '같은 찜이 다시 와도 처음 것').toBe(T0 + 5_000)
    expect(later.seen?.get(newId)).toBe(T0 + 60_000)
    // 처음 받은 때(5초)부터 W=30: 35초 정각까지 보류, 35초 + 1ms에 시간 지남 — at(0초)부터 재지 않는다
    const old = later.claims.get(ids[0] ?? '')
    expect(d.isPendingTimedOut(later, old, T0 + 35_000)).toBe(false)
    expect(d.isPendingTimedOut(later, old, T0 + 35_001)).toBe(true)
    // 새 찜은 60초 + 30초까지 보류
    const fresh = later.claims.get(newId)
    expect(d.isPendingTimedOut(later, fresh, T0 + 90_000)).toBe(false)
    expect(d.isPendingTimedOut(later, fresh, T0 + 90_001)).toBe(true)
    expect(d.nextPendingFlip(later, T0 + 60_000)).toBe(T0 + 90_001)
  })

  it('새 기록(새로고침한 탭)은 다시 잰다, 날짜·리허설이 다른 범위는 같은 찜 ID라도 따로', async () => {
    const { s, seen } = await load()
    const view = s.fromFull(fullView(run('register', 30, [T0], T0 + 10_000_000, 1).before))
    const [id] = [...view.claims.keys()]
    const tab1 = new seen.ClaimSeen()
    tab1.note(view, T0 + 1_000)
    const reloaded = new seen.ClaimSeen().note(view, T0 + 500_000)
    expect(reloaded.seen?.get(id ?? '')).toBe(T0 + 500_000)
    const rehearsal = tab1.note({ ...view, rehearsal: true, claims: new Map(view.claims) }, T0 + 7_000)
    expect(rehearsal.seen?.get(id ?? '')).toBe(T0 + 7_000)
    const otherDay = tab1.note({ ...view, date: '2026-10-19', claims: new Map(view.claims) }, T0 + 8_000)
    expect(otherDay.seen?.get(id ?? '')).toBe(T0 + 8_000)
    expect(tab1.view(view).get(id ?? '')).toBe(T0 + 1_000)
  })

  it('속성: 기록을 붙인 자료로 잰 판단은 seen ≥ at이 성립하는 한(받은 시각 ≥ at) 엔진보다 먼저 시간 지남이 아니다 — 실제 note 길', async () => {
    const { d, s, seen } = await load()
    fc.assert(
      fc.property(
        fc.constantFrom(...WINDOWS),
        fc.array(fc.integer({ min: -400_000, max: 0 }), { minLength: 1, maxLength: 5 }),
        fc.integer({ min: 0, max: 10_000 }),
        (w, offsets, noteLag) => {
          const openAt = T0 + 1_000_000
          const ats = offsets.map((o) => openAt + o)
          const { before, after } = run('register', w, ats, openAt, 2)
          // 탭은 마지막 찜이 들어온 뒤 한 번에 받음(새로고침과 같은 꼴) — 받은 시각은 모든 at 이상
          const noteAt = Math.min(Math.max(...ats) + noteLag, openAt)
          const data = new seen.ClaimSeen().note(s.fromFull(fullView(before)), noteAt)
          const afterById = new Map(listClaims(after).map((c) => [c.id, c]))
          for (const claim of data.claims.values()) {
            if (!d.isPendingTimedOut(data, claim, openAt)) continue
            const result = afterById.get(claim.id)
            expect(result?.reason, `W=${String(w)} at=T${String(Date.parse(claim.at) - openAt)} noteAt=T${String(noteAt - openAt)}`).toBe('EXPIRED')
          }
        },
      ),
      { seed: 3416, numRuns: 300 },
    )
  })
})
