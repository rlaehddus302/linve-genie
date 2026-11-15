// 품종 후보 (D-VARIETY-01, 사용자 메모 2026-11-13 "자주 등록되는 품종이나 최근에 등록된 품종을 버튼으로 보여줘서 눌러서 빠르게 품종을 수정", 개선 계획 E1).
// 판매자 앱의 상품 수정·추가 창이 품종 칸 아래 한 줄 단추로 띄운다. 판정과 상관없는 읽기다 — 아무것도 기록하지 않는다.
// - recent: 그 방송에서 최근 등록한 상품의 품종, 최근 것부터(상품 ID 차례 — 등록 순), 겹치지 않게
// - frequent: 이 판매자의 최근 실제 방송 날짜(FREQUENT_DAYS개)와 지금 날짜 범위에서 많이 쓴 품종, 많은 것부터(같으면 최근에 쓴 것부터)
//   지난 날짜는 이벤트 기록의 상품 등록·고치기·확정에서 번호마다 마지막 품종을 센다(범위 상태를 다시 만들지 않는다). 지금 날짜는 범위 상태의 상품으로 센다.
//   품종과 옵션 말(색금·녹금 같은 무늬)이 섞여 있어도 지금은 저장된 이름 그대로 센다. 개수(D-PIECES-01)는 이름이 아니라 세지 않는다.
// 이름은 판매자가 적은 글 그대로다 — 화면은 글자로만 그린다. 닉네임·채팅 글은 없다.
import { listProducts, type EngineState } from '@livejjim/core'
import { and, asc, desc, eq, inArray, lt } from 'drizzle-orm'
import type { Db } from './db/database.ts'
import { events, scopes } from './db/schema.ts'

/** 최근 몇 날짜(실제 범위)를 셀까 */
export const FREQUENT_DAYS = 10
/** 단추로 보일 수 — 이번 방송 최근 · 자주 쓴 */
export const RECENT_MAX = 8
export const FREQUENT_MAX = 12
/** 후보로 내는 이름의 최대 글자 수 (품종 칸과 같다) */
const NAME_MAX = 40
const PRODUCT_TYPES = ['product.register', 'product.update', 'product.confirm']

export interface VarietySuggestions {
  /** 이 방송에서 최근 등록한 품종, 최근 것부터 */
  readonly recent: readonly string[]
  /** 이 판매자가 최근 방송들에서 많이 쓴 품종, 많은 것부터 */
  readonly frequent: readonly string[]
}

/** 후보로 쓸 수 있는 이름 (앞뒤 빈칸을 떼고, 비었거나 너무 길면 null) */
function usable(name: unknown): string | null {
  if (typeof name !== 'string') return null
  const trimmed = name.trim().replace(/\s+/gu, ' ')
  return trimmed === '' || [...trimmed].length > NAME_MAX ? null : trimmed
}

const idOrder = (id: string): number => Number(/^p(\d+)$/u.exec(id)?.[1] ?? 0)

/** 그 방송에서 최근 등록한 품종 (상품 ID가 큰 것부터 — 등록 순, 판매 종료한 상품 포함, 겹치지 않게) */
export function recentVarieties(state: EngineState, broadcast: string, max = RECENT_MAX): string[] {
  const out: string[] = []
  const products = listProducts(state)
    .filter((product) => product.broadcast === broadcast)
    .sort((a, b) => idOrder(b.id) - idOrder(a.id))
  for (const product of products) {
    const name = usable(product.name)
    if (name === null || out.includes(name)) continue
    out.push(name)
    if (out.length === max) break
  }
  return out
}

/** 이름 → [쓴 수, 마지막으로 쓴 차례(클수록 최근)] */
type Tally = Map<string, [number, number]>

function count(tally: Tally, name: string | null, order: number): void {
  if (name === null) return
  const was = tally.get(name)
  tally.set(name, was === undefined ? [1, order] : [was[0] + 1, Math.max(was[1], order)])
}

/** 지난 날짜들의 이벤트 기록에서 번호마다 마지막 품종 → 날짜 차례가 order인 셈 */
export async function pastTally(db: Db, sellerId: string, before: string, days = FREQUENT_DAYS): Promise<{ readonly tally: Tally }> {
  const recent = await db
    .select({ id: scopes.id, date: scopes.date })
    .from(scopes)
    .where(and(eq(scopes.sellerId, sellerId), eq(scopes.rehearsal, false), lt(scopes.date, before)))
    .orderBy(desc(scopes.date))
    .limit(days)
  const tally: Tally = new Map()
  if (recent.length === 0) return { tally }
  const order = new Map(recent.map((row, i) => [row.id, recent.length - i]))
  const rows = await db
    .select({ scopeId: events.scopeId, body: events.body })
    .from(events)
    .where(and(eq(events.sellerId, sellerId), inArray(events.scopeId, recent.map((row) => row.id)), inArray(events.type, PRODUCT_TYPES), eq(events.changed, true), eq(events.failed, false)))
    .orderBy(asc(events.scopeId), asc(events.seq))
  // (범위, 방송, 번호) → 마지막 품종 (확정은 옮긴 번호 to로)
  const last = new Map<string, { readonly scope: string; readonly name: string }>()
  for (const row of rows) {
    let body: Record<string, unknown>
    try {
      body = JSON.parse(row.body) as Record<string, unknown>
    } catch {
      continue
    }
    const name = usable(body['name'])
    if (name === null || typeof body['b'] !== 'string') continue
    const no = body['type'] === 'product.confirm' && typeof body['to'] === 'number' ? body['to'] : body['no']
    if (typeof no !== 'number') continue
    last.set(`${row.scopeId}/${body['b']}/${String(no)}`, { scope: row.scopeId, name })
  }
  for (const { scope, name } of last.values()) count(tally, name, order.get(scope) ?? 0)
  return { tally }
}

/** 많이 쓴 이름부터 (같으면 최근에 쓴 것, 그다음 글자 차례) */
export function rankTally(tally: Tally, max = FREQUENT_MAX): string[] {
  return [...tally.entries()]
    .sort(([an, [ac, ao]], [bn, [bc, bo]]) => bc - ac || bo - ao || (an < bn ? -1 : an > bn ? 1 : 0))
    .slice(0, max)
    .map(([name]) => name)
}

/** 지난 날짜의 셈을 다시 읽는 간격 — 지난 방송은 거의 바뀌지 않는다 */
export const PAST_TALLY_TTL_MS = 10 * 60_000

/**
 * 판매자마다 지난 날짜의 셈을 잠깐(PAST_TALLY_TTL_MS) 둔다 — 수정창을 열 때마다 이벤트 기록을 다시 읽지 않게.
 * 보는 날짜가 바뀌거나 시간이 지나면 다시 센다. 지금 날짜는 늘 범위 상태(메모리)로 센다
 */
export class VarietyCache {
  readonly #entries = new Map<string, { readonly before: string; readonly at: number; readonly tally: Tally }>()
  readonly #max: number
  readonly #now: () => number

  constructor(options: { readonly max?: number; readonly now?: () => number } = {}) {
    this.#max = options.max ?? 500
    this.#now = options.now ?? Date.now
  }

  async suggestions(db: Db, sellerId: string, date: string, state: EngineState | null, broadcast: string): Promise<VarietySuggestions> {
    const cached = this.#entries.get(sellerId)
    const now = this.#now()
    let tally: Tally
    if (cached !== undefined && cached.before === date && now - cached.at < PAST_TALLY_TTL_MS) tally = cached.tally
    else {
      tally = (await pastTally(db, sellerId, date)).tally
      if (this.#entries.size >= this.#max) this.#entries.clear()
      this.#entries.set(sellerId, { before: date, at: now, tally })
    }
    const all = new Map(tally)
    // 지금 날짜(모든 방송)의 상품은 범위 상태로 센다 — 가장 최근 차례
    if (state !== null) for (const product of listProducts(state)) count(all, usable(product.name), FREQUENT_DAYS + 1)
    return { recent: state === null ? [] : recentVarieties(state, broadcast), frequent: rankTally(all) }
  }
}
