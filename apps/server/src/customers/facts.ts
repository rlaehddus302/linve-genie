// 손님 기록의 날짜별 재료 (CRM1 D-CRM1-02·D-CRM1-03·D-CRM1-04·D-CRM1-11). 판정은 하지 않는다 — 코어 조회 결과(구매자·찜 상태·정산 묶음)를 옮겨 담는다.
// - 날짜 하나 = 판매자의 실제 범위 하나. 리허설 범위는 읽지 않는다.
// - 표지 (D-CRM1-02, 지난 구매 D-I2-08과 같은 규칙): 채팅 구매자(유튜브·인스타그램 `ig:`·틱톡 `tt:`)는 구매자 키 그대로 `c:<키>`,
//   휴대폰 번호가 있는 문자 구매자는 그 구매자를 만든 문자찜의 전화번호 키 `p:<키>`(그 범위의 문자찜 이벤트 본문에서 — 응답·화면·로그에 내지 않는다).
//   전화번호 없는 문자 구매자는 표지가 없다.
// - 묶음 = 그날 지금의 구매자(root)의 정산 묶음. items = 확정 찜 수량 합, subtotal = 코어 정산 상품 합계, payment = 코어 입금 상태,
//   cancels = 1등(확정)이었던 적이 있고(가격 스냅샷이 있다) 지금 취소·무효(방송자)인 찜 수,
//   noPay = 그중 방송자 조치(취소·무효·교체 취소)의 사유가 '입금 안 함'으로 끝난 찜 수.
//   사유는 엔진 상태에 없어 그 범위의 이벤트 기록을 코어 applyEvent로 다시 적용해 어느 확정 찜이 그 조치로 끝났는지 본다(사유 후보 이벤트가 있는 범위만).
// - 봉인 날짜(30일, D-PL1-04)는 봉인 장부로 다시 세운 상태로 센다(D-CRM1-02). 장부에는 끝난 찜·조치 사유가 없어 그 날짜의 cancels·noPay는 0이다.
//   장부를 읽을 수 없으면 그 날짜를 빼고 오류 로그(코드·날짜만)를 남긴다.
// - 캐시 (D-CRM1-11): (판매자, 범위 ID, 범위 seq, 봉인 여부)가 같으면 그 날짜의 재료를 다시 쓴다. 판매자·범위가 키에 들어 있어 섞이지 않는다.
import { applyEvent, currentBuyerOf, getBuyer, getSettlement, listBuyers, listClaims, type EngineEvent, type EngineState } from '@livejjim/core'
import { and, asc, eq, gt, inArray } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { events, scopes } from '../db/schema.ts'
import type { LogSink } from '../log.ts'
import { platformOfKey, type Platform } from '../platform.ts'
import { emptyState } from '../runtime.ts'
import { readSealed } from '../sealed-state.ts'
import { eventsAfter } from '../store.ts'
import type { ScopeWriter } from '../writer.ts'
import { isNoPayReason, type SummaryBundle } from './summary.ts'

const SMS_PREFIX = 'sms:'

/** 그날 구매자 하나 */
export interface DayBuyer {
  readonly id: string
  /** 지금의 구매자 */
  readonly root: string
  /** 채팅 구매자의 플랫폼, 문자 구매자는 null */
  readonly platform: Platform | null
  readonly display: string
  readonly nameHistory: readonly string[]
  readonly phoneLast4: string | null
  readonly blocked: boolean
  /** 표지 (`c:<키>` · `p:<전화번호 키>`), 없으면 null */
  readonly marker: string | null
}

/** 그날 묶음 하나 (지금의 구매자마다) */
export interface DayBundle extends SummaryBundle {
  /** 지금의 구매자의 표시 이름 */
  readonly name: string
  /** 묶음 구성원 (root와 그 아래 합쳐진 구매자, 합친 순서) */
  readonly members: readonly string[]
  /** 기록 묶음인지 (D-CRM1-03: 품목이 있거나, 입금 기록이 있거나, 1등이었다가 끝난 찜이 있다) */
  readonly record: boolean
}

export interface DayFacts {
  readonly date: string
  readonly scopeId: string
  readonly buyers: ReadonlyMap<string, DayBuyer>
  readonly bundles: ReadonlyMap<string, DayBundle>
  /** 표지 → 그날 그 표지의 구매자 ID */
  readonly markers: ReadonlyMap<string, string>
}

/** 사유 후보 이벤트: 방송자 취소·무효, 교체 취소(직접 배정 replaceTo=CANCEL) */
const ACTION_TYPES = ['host.cancel', 'host.reject', 'host.assign'] as const

function noPayCandidate(type: string, body: string): boolean {
  try {
    const event = JSON.parse(body) as { reason?: unknown; replaceTo?: unknown }
    if (type === 'host.assign' && event.replaceTo !== 'CANCEL') return false
    return isNoPayReason(event.reason)
  } catch {
    return false
  }
}

const isEnded = (status: string, reason: string | null) => status === 'CANCELLED' || (status === 'REJECTED' && reason === 'BY_HOST')

/** 그 범위에서 '입금 안 함' 조치로 끝난 확정 찜 ID (이벤트 기록을 처음부터 다시 적용하며, 후보 이벤트 앞뒤의 찜 상태를 비교한다) */
async function noPayClaims(db: Db, sellerId: string, scopeId: string, upto: number, log: LogSink, date: string): Promise<{ key: string; ids: ReadonlySet<string> }> {
  const rows = await db
    .select({ seq: events.seq, type: events.type, body: events.body })
    .from(events)
    .where(and(eq(events.sellerId, sellerId), eq(events.scopeId, scopeId), eq(events.failed, false), inArray(events.type, [...ACTION_TYPES]), gt(events.seq, 0)))
    .orderBy(asc(events.seq))
  const candidates = new Set(rows.filter((row) => row.seq <= upto && noPayCandidate(row.type, row.body)).map((row) => row.seq))
  const last = Math.max(0, ...candidates)
  const key = `${scopeId}|${String(last)}`
  if (candidates.size === 0) return { key, ids: new Set() }
  const cached = noPayCache.get(key)
  if (cached !== undefined) return { key, ids: cached }
  const ids = new Set<string>()
  let state: EngineState = emptyState()
  for (const row of await eventsAfter(db, sellerId, scopeId, 0)) {
    if (row.seq > last) break
    if (row.failed) continue
    const before = candidates.has(row.seq) ? new Set(listClaims(state).filter((claim) => claim.status === 'CONFIRMED').map((claim) => claim.id)) : null
    try {
      state = applyEvent(state, JSON.parse(row.body) as EngineEvent).state
    } catch {
      // 재생이 건너뛴 입력과 같다 (runtime.ts replayRow) — 코드·날짜·seq만
      log({ level: 'warn', code: 'REPLAY_SKIPPED', date, seq: row.seq })
      continue
    }
    if (before === null) continue
    for (const claim of listClaims(state)) if (before.has(claim.id) && isEnded(claim.status, claim.reason)) ids.add(claim.id)
  }
  remember(noPayCache, key, ids, NO_PAY_CACHE_MAX)
  return { key, ids }
}

/** 그 범위의 문자찜 ref → 전화번호 키 (문자찜 이벤트 본문의 phoneKey) */
async function phoneKeys(db: Db, sellerId: string, scopeId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ ref: events.smsRef, body: events.body })
    .from(events)
    .where(and(eq(events.sellerId, sellerId), eq(events.scopeId, scopeId), eq(events.type, 'sms')))
  const out = new Map<string, string>()
  for (const row of rows) {
    if (row.ref === null) continue
    try {
      const key = (JSON.parse(row.body) as { phoneKey?: unknown }).phoneKey
      if (typeof key === 'string' && key !== '') out.set(row.ref, key)
    } catch {
      // 읽을 수 없는 본문은 표지 없음
    }
  }
  return out
}

/** 범위 상태 하나 → 그날 재료 (판정 없음 — 코어 조회 결과만) */
export function factsOf(date: string, scopeId: string, state: EngineState, keys: ReadonlyMap<string, string>, ended: ReadonlySet<string>): DayFacts {
  const buyers = new Map<string, DayBuyer>()
  const markers = new Map<string, string>()
  for (const buyer of listBuyers(state)) {
    let marker: string | null = null
    if (buyer.kind === 'youtube') marker = `c:${buyer.id}`
    else if (buyer.phoneLast4 !== null && buyer.id.startsWith(SMS_PREFIX)) {
      const key = keys.get(buyer.id.slice(SMS_PREFIX.length))
      if (key !== undefined) marker = `p:${key}`
    }
    const root = currentBuyerOf(state, buyer.id) ?? buyer.id
    buyers.set(buyer.id, {
      id: buyer.id,
      root,
      platform: buyer.kind === 'youtube' ? platformOfKey(buyer.id) : null,
      display: buyer.display,
      nameHistory: buyer.nameHistory,
      phoneLast4: buyer.phoneLast4,
      blocked: buyer.blocked,
      marker,
    })
    if (marker !== null && !markers.has(marker)) markers.set(marker, buyer.id)
  }
  const counts = new Map<string, { items: number; cancels: number; noPay: number }>()
  for (const claim of listClaims(state)) {
    const entry = counts.get(claim.currentBuyer) ?? { items: 0, cancels: 0, noPay: 0 }
    if (claim.status === 'CONFIRMED') entry.items += claim.qty
    else if (claim.price !== null && isEnded(claim.status, claim.reason)) {
      entry.cancels += 1
      if (ended.has(claim.id)) entry.noPay += 1
    }
    counts.set(claim.currentBuyer, entry)
  }
  const bundles = new Map<string, DayBundle>()
  for (const buyer of buyers.values()) {
    if (buyer.root !== buyer.id) continue
    const settlement = getSettlement(state, buyer.id, date)
    const count = counts.get(buyer.id) ?? { items: 0, cancels: 0, noPay: 0 }
    const paid = settlement.records.some((record) => record.kind === 'payment' || record.kind === 'refund')
    const info = getBuyer(state, buyer.id)
    bundles.set(buyer.id, {
      date,
      buyer: buyer.id,
      items: count.items,
      subtotal: settlement.subtotal,
      payment: settlement.payment,
      cancels: count.cancels,
      noPay: count.noPay,
      name: buyer.display,
      members: [buyer.id, ...(info?.merged ?? [])],
      record: count.items > 0 || paid || count.cancels > 0,
    })
  }
  return { date, scopeId, buyers, bundles, markers }
}

// ── 캐시 ─────────────────────────────────────────────────────────────────

/** 날짜 재료 캐시 크기 (판매자 여럿 × 날짜 수백 — 넘으면 오래 안 쓴 것부터 버린다) */
export const FACTS_CACHE_MAX = 4000
const NO_PAY_CACHE_MAX = 1000
const factsCache = new Map<string, DayFacts>()
const noPayCache = new Map<string, ReadonlySet<string>>()
let factsBuilds = 0

function remember<V>(cache: Map<string, V>, key: string, value: V, max: number): void {
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > max) cache.delete(cache.keys().next().value as string)
}

/** 시험용: 날짜 재료를 새로 만든 횟수 (캐시를 쓰는지 본다) */
export function factsBuildCount(): number {
  return factsBuilds
}

export interface FactsDeps {
  readonly db: Db
  readonly writer: ScopeWriter
  readonly log: LogSink
}

interface ScopeRow {
  readonly id: string
  readonly date: string
  readonly seq: number
  readonly sealedAt: Date | null
}

/** 판매자의 실제 범위 (이벤트가 있는 것만, 날짜 순) */
export async function realScopes(db: Db, sellerId: string): Promise<ScopeRow[]> {
  const rows = await db
    .select({ id: scopes.id, date: scopes.date, seq: scopes.seq, sealedAt: scopes.sealedAt })
    .from(scopes)
    .where(and(eq(scopes.sellerId, sellerId), eq(scopes.rehearsal, false), gt(scopes.seq, 0)))
    .orderBy(asc(scopes.date))
  return rows
}

/** 범위 하나의 재료 (캐시). 봉인 장부를 읽을 수 없으면 null */
async function factsFor(deps: FactsDeps, sellerId: string, scope: ScopeRow): Promise<DayFacts | null> {
  const sealed = scope.sealedAt !== null
  const key = JSON.stringify([sellerId, scope.id, scope.seq, sealed])
  const hit = factsCache.get(key)
  if (hit !== undefined) {
    remember(factsCache, key, hit, FACTS_CACHE_MAX)
    return hit
  }
  let state: EngineState
  let ended: ReadonlySet<string> = new Set()
  if (sealed) {
    const read = await readSealed(deps.db, sellerId, scope.date)
    if (!read.sealed || read.state === null) {
      deps.log({ level: 'error', code: 'LEDGER_UNREADABLE', date: scope.date })
      return null
    }
    state = read.state
  } else {
    const runtime = await deps.writer.readDetached(sellerId, scope.date, false)
    if (runtime.scopeId !== scope.id) return null
    state = runtime.state
    ended = (await noPayClaims(deps.db, sellerId, scope.id, runtime.seq, deps.log, scope.date)).ids
  }
  const facts = factsOf(scope.date, scope.id, state, await phoneKeys(deps.db, sellerId, scope.id), ended)
  factsBuilds += 1
  remember(factsCache, key, facts, FACTS_CACHE_MAX)
  return facts
}

/** 판매자의 모든 실제 날짜 재료 (날짜 순) */
export async function allFacts(deps: FactsDeps, sellerId: string): Promise<DayFacts[]> {
  const out: DayFacts[] = []
  for (const scope of await realScopes(deps.db, sellerId)) {
    const facts = await factsFor(deps, sellerId, scope)
    if (facts !== null) out.push(facts)
  }
  return out
}
