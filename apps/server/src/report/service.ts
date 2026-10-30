// 방송 리포트 (SPEC RPT-01~RPT-08, KP1 — D-KP1-09~D-KP1-14, AC-KP1-17·18). 판정은 하지 않는다 — 코어 조회 결과를 옮겨 담아 순수 함수(rules.ts)로 센다.
// - 리포트 하나 = 실제 날짜 하나(그 범위의 모든 회차). 리허설 범위는 읽지 않는다. 저장하지 않고 볼 때마다 지금 엔진 값으로 센다(입금이 늘면 받은 돈이 바로 는다).
// - 돈·손님은 정산 화면과 같은 코어 정산 묶음(listSettlements — 그 날짜)에서: 판매 금액 = 상품 합계, 받은 돈 = 받은 금액(배송비 포함), 최종 = 합계.
//   수량 = 지금 확정인 찜 수량 합(판매대장 행과 같은 찜).
// - 봉인 날짜(30일, D-PL1-04): 봉인 장부로 다시 세운 상태 — 돈·손님·품종만. 찜 시각·공개 시각이 없어 시간대·몰린 상품은 null.
// - 손님 이름·연락처·표지는 응답에 없다(숫자만). 엔진 이벤트·발송함을 쓰지 않는다.
import { listBroadcasts, listClaims, listProducts, listSettlements, type ClaimInfo, type EngineState, type ProductInfo } from '@livejjim/core'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { events } from '../db/schema.ts'
import { factsFor, realScopes, type DayFacts, type FactsDeps } from '../customers/facts.ts'
import type { LogSink } from '../log.ts'
import { readSealed } from '../sealed-state.ts'
import { iso } from '../time.ts'
import type { ScopeWriter } from '../writer.ts'
import {
  reportBuckets,
  reportCompare,
  reportRush,
  reportSummary,
  reportVarieties,
  type BucketRow,
  type CompareLast,
  type CompareRecent,
  type ReportSummary,
  type RushProductInput,
  type RushRow,
  type SummaryBundleInput,
  type VarietyRow,
} from './rules.ts'

/** 몰린 상품은 많아야 다섯 (RPT-07) */
export const REPORT_RUSH_MAX = 5

export interface ReportView {
  readonly date: string
  /** 그날 끝나지 않은 실제 회차가 있다 ("방송 중이라 숫자가 바뀌고 있어요") */
  readonly live: boolean
  /** 30일 봉인 날짜 — buckets·rush는 null */
  readonly sealed: boolean
  readonly summary: ReportSummary
  readonly compare: { readonly last: CompareLast | null; readonly recent: CompareRecent | null }
  readonly rush: ReportRushRow[] | null
  readonly varieties: VarietyRow[]
  readonly buckets: BucketRow[] | null
}

/** 몰린 상품 한 줄 + 회차 이름 (D-KP1-37: 그날 실제 회차가 둘 이상일 때만 채운다 — 회차 이름은 판매자가 적은 글 그대로, 화면이 이스케이프한다) */
export type ReportRushRow = RushRow & { readonly scopeName?: string }

export type ReportOutcome = { readonly kind: 'ok'; readonly view: ReportView } | { readonly kind: 'not_found' } | { readonly kind: 'unreadable' }

export interface ReportDeps {
  readonly db: Db
  readonly writer: ScopeWriter
  readonly log: LogSink
  /** 손님 기록 날짜 재료 (표지 — CustomerService.factsDeps()와 같은 캐시) */
  readonly facts: FactsDeps
}

/** 그날 묶음 구성원의 표지 (겹치면 하나) */
function keysOf(facts: DayFacts | null, root: string): string[] {
  if (facts === null) return []
  const ids = facts.bundles.get(root)?.members ?? [root]
  const out = new Set<string>()
  for (const id of ids) {
    const marker = facts.buyers.get(id)?.marker ?? null
    if (marker !== null) out.add(marker)
  }
  return [...out]
}

/** 앞선 날짜 하나의 비교 숫자와 품목 있는 묶음의 표지 (손님 기록 재료 — 봉인 날짜는 장부로) */
function pastOf(facts: DayFacts): { numbers: { date: string; sales: number; qty: number; buyers: number }; markers: string[] } {
  let sales = 0
  let qty = 0
  let buyers = 0
  const markers: string[] = []
  for (const bundle of facts.bundles.values()) {
    sales += bundle.subtotal
    qty += bundle.items
    if (bundle.items < 1) continue
    buyers += 1
    markers.push(...keysOf(facts, bundle.buyer))
  }
  return { numbers: { date: facts.date, sales, qty, buyers }, markers }
}

/** 지금 확정인 찜 (상품의 1등 — 옵션 상품은 모든 변형의 1등) */
function confirmedClaims(state: EngineState): { claim: ClaimInfo; product: ProductInfo }[] {
  const claims = new Map(listClaims(state).map((claim) => [claim.id, claim]))
  const out: { claim: ClaimInfo; product: ProductInfo }[] = []
  for (const product of listProducts(state)) {
    const ids = product.hasOptions ? product.variants.flatMap((variant) => variant.winnerClaims) : product.winnerClaims
    for (const id of ids) {
      const claim = claims.get(id)
      if (claim !== undefined && claim.status === 'CONFIRMED') out.push({ claim, product })
    }
  }
  return out
}

/** 찜 금액 (코어 값 그대로 — 확정 찜은 amount가 있다. 없으면 단가 스냅샷 × 수량) */
const amountOf = (claim: ClaimInfo): number => claim.amount ?? (claim.price ?? 0) * claim.qty

/** 이벤트 본문에서 읽는 칸 */
interface ProductEventBody {
  readonly b?: unknown
  readonly no?: unknown
  readonly from?: unknown
  readonly to?: unknown
  readonly status?: unknown
  readonly at?: unknown
}

const slotKey = (b: string, no: number) => JSON.stringify([b, no])

export class ReportService {
  readonly #deps: ReportDeps

  constructor(deps: ReportDeps) {
    this.#deps = deps
  }

  /**
   * 그 범위에서 상품(방송·번호 자리)이 처음 판매 중이 된 시각 (UTC 밀리초) — 등록(상태를 READY로 적지 않음)·공개 이벤트의 at.
   * 번호 바꾸기는 자리를 따라 옮긴다. 엔진이 거절한(failed) 이벤트는 보지 않는다
   */
  async #openedTimes(sellerId: string, scopeId: string): Promise<Map<string, number>> {
    const rows = await this.#deps.db
      .select({ type: events.type, body: events.body })
      .from(events)
      .where(and(eq(events.sellerId, sellerId), eq(events.scopeId, scopeId), eq(events.failed, false), inArray(events.type, ['product.register', 'product.open', 'product.renumber'])))
      .orderBy(asc(events.seq))
    const opened = new Map<string, number>()
    for (const row of rows) {
      let body: ProductEventBody
      try {
        body = JSON.parse(row.body) as ProductEventBody
      } catch {
        continue
      }
      if (typeof body.b !== 'string') continue
      if (row.type === 'product.renumber') {
        if (typeof body.from !== 'number' || typeof body.to !== 'number') continue
        const from = slotKey(body.b, body.from)
        const at = opened.get(from)
        opened.delete(from)
        if (at !== undefined) opened.set(slotKey(body.b, body.to), at)
        continue
      }
      if (typeof body.no !== 'number' || typeof body.at !== 'number') continue
      if (row.type === 'product.register' && body.status === 'READY') continue
      const key = slotKey(body.b, body.no)
      if (!opened.has(key)) opened.set(key, body.at)
    }
    return opened
  }

  /** 몰린 상품 재료: 옵션 없는 상품마다 처음 공개 시각과 붙은 찜(채팅·문자찜·메시지 변환 — 지금 상태와 상관없이) */
  async #rushInput(sellerId: string, scopeId: string, state: EngineState): Promise<RushProductInput[]> {
    const opened = await this.#openedTimes(sellerId, scopeId)
    const titles = new Map(listBroadcasts(state).map((broadcast) => [broadcast.id, broadcast.title]))
    const claims = listClaims(state).filter((claim) => claim.origin !== 'assign')
    const out: RushProductInput[] = []
    for (const product of listProducts(state)) {
      if (product.hasOptions) continue
      const at = opened.get(slotKey(product.broadcast, product.no))
      const own = claims.filter((claim) => claim.productId === product.id || (claim.productId === null && claim.product === product.key))
      out.push({
        b: titles.get(product.broadcast) ?? '',
        no: product.no,
        name: product.name,
        stock: product.stock,
        opened: at === undefined ? null : iso(at),
        claims: own.map((claim) => ({ time: iso(claim.rankTime), buyer: claim.currentBuyer })),
      })
    }
    return out
  }

  /** 실제 날짜 하나의 리포트. 그 판매자의 실제 범위가 없으면 not_found, 봉인 장부를 읽을 수 없으면 unreadable */
  async report(sellerId: string, date: string): Promise<ReportOutcome> {
    const { db, writer, log } = this.#deps
    const scopes = await realScopes(db, sellerId)
    const at = scopes.findIndex((scope) => scope.date === date)
    const scope = scopes[at]
    if (scope === undefined) return { kind: 'not_found' }

    // 이 날짜의 상태: 봉인 날짜는 봉인 장부, 아니면 지금 상태 (공용 캐시를 밀어내지 않는 읽기)
    const sealedRead = await readSealed(db, sellerId, date)
    let state: EngineState
    if (sealedRead.sealed) {
      if (sealedRead.state === null) {
        log({ level: 'error', code: 'LEDGER_UNREADABLE', date })
        return { kind: 'unreadable' }
      }
      state = sealedRead.state
    } else {
      const runtime = await writer.readDetached(sellerId, date, false)
      if (runtime.scopeId !== scope.id) return { kind: 'not_found' }
      state = runtime.state
    }
    const sealed = sealedRead.sealed

    // 앞선 실제 날짜들 (늦은 순): 비교 숫자와 품목 있는 묶음의 표지
    const earlier = new Set<string>()
    const past: { date: string; sales: number; qty: number; buyers: number }[] = []
    for (const before of scopes.slice(0, at)) {
      const facts = await factsFor(this.#deps.facts, sellerId, before)
      if (facts === null) continue
      const { numbers, markers } = pastOf(facts)
      past.unshift(numbers)
      for (const marker of markers) earlier.add(marker)
    }

    // 이 날짜의 정산 묶음 (정산 화면과 같은 코어 값)
    const today = await factsFor(this.#deps.facts, sellerId, scope)
    const confirmed = confirmedClaims(state)
    const qtyByBuyer = new Map<string, number>()
    for (const { claim } of confirmed) qtyByBuyer.set(claim.currentBuyer, (qtyByBuyer.get(claim.currentBuyer) ?? 0) + claim.qty)
    const bundles: SummaryBundleInput[] = listSettlements(state)
      .filter((settlement) => settlement.date === date)
      .map((settlement) => ({
        buyer: settlement.buyer,
        keys: keysOf(today, settlement.buyer),
        items: qtyByBuyer.get(settlement.buyer) ?? 0,
        subtotal: settlement.subtotal,
        final: settlement.total,
        received: settlement.received,
      }))
    const summary = reportSummary({ bundles, earlier: [...earlier] })
    const compare = reportCompare({ current: { sales: summary.sales, qty: summary.qty, buyers: summary.buyers }, past })
    const varieties = reportVarieties({ sales: confirmed.map(({ claim, product }) => ({ name: product.name, qty: claim.qty, amount: amountOf(claim) })) })
    const buckets = sealed ? null : reportBuckets({ claims: confirmed.map(({ claim }) => ({ time: iso(claim.rankTime), qty: claim.qty, amount: amountOf(claim) })) })
    const rushRows = sealed ? null : reportRush({ products: await this.#rushInput(sellerId, scope.id, state) }).slice(0, REPORT_RUSH_MAX)
    // D-KP1-37: 회차가 둘 이상인 날은 줄 번호가 겹칠 수 있어 회차 이름(b = 회차 제목)을 함께 준다
    const manySessions = listBroadcasts(state).length >= 2
    const rush: ReportRushRow[] | null = rushRows === null ? null : rushRows.map((row) => (manySessions ? { ...row, scopeName: row.b } : row))
    const live = !sealed && listBroadcasts(state).some((broadcast) => !broadcast.ended)
    return { kind: 'ok', view: { date, live, sealed, summary, compare, rush, varieties, buckets } }
  }
}
