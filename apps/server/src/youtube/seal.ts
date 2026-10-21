// 유튜브 원문 30일 봉인 (AC-Y1-60~62, DAT-06, D-012, D-078, D-Y11).
// - 대상: 실제 범위 중 유튜브 수집기로 받은 채팅이 하나라도 있는 범위. 때: 그 범위 날짜 + 30일의 0시(KST). 서버 시작 때와 1시간마다 돈다.
// - 한 트랜잭션(그 범위의 락)으로: (1) 끝나지 않은 발송함 행 → FAILED(SEALED), 모든 행의 게시 문구 지움 (2) 판매자 장부를 형식에 매이지 않는 JSON으로 저장
//   (3) 따로 둔 채팅 본문·이름, 그 범위의 스냅샷, 삭제·차단 알림, 수집 이어받기 지점, 우리 메시지 기록을 지움 (4) 봉인 표시와 장부 요약값(SHA-256).
// - 산 적도 정산 기록도 없는 시청자의 이름은 장부에 없다. 채팅이 아닌 이벤트(방송·상품·문자찜·조치·정산·게시 보고)는 그대로 남는다.
// - 다시 해도 같은 결과(이미 봉인한 범위는 건너뛴다). 중간에 죽으면 트랜잭션이 되돌려 아무것도 바뀌지 않고 다음 실행에서 다시 한다.
import {
  applyEvent,
  getProduct,
  listBroadcasts,
  listBuyers,
  listClaims,
  listProducts,
  listSettlements,
  parseChat,
  getBroadcast,
  type EngineEvent,
  type EngineState,
} from '@livejjim/core'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { chatRaw, outbox, scopeLockKey, scopes, snapshots, youtubeCollectors, youtubeNotices, youtubeOwnMessages } from '../db/schema.ts'
import { errorKind, type LogSink } from '../log.ts'
import { emptyState } from '../runtime.ts'
import { sha256Hex } from '../secrets.ts'
import { eventsAfter } from '../store.ts'
import { iso, withIsoTimes } from '../time.ts'
import type { ScopeWriter } from '../writer.ts'
import { kstMidnightAfter, type Timer } from './timer.ts'

/** 봉인까지 날 수 (AC-Y1-61) */
export const SEAL_AFTER_DAYS = 30
/** 봉인 작업 간격 */
export const SEAL_EVERY_MS = 60 * 60 * 1000
export const LEDGER_FORMAT = 'livejjim-ledger/1'
/** 봉인한 날짜의 채팅 목록 문장 (AC-Y1-62) */
export const SEALED_CHAT_MESSAGE = '30일이 지나 채팅 내용을 지웠어요.'

/** 그 날짜(KST)의 봉인 시각 (UTC 밀리초) */
export function sealAtOf(date: string): number {
  return kstMidnightAfter(date, SEAL_AFTER_DAYS)
}

export interface Ledger {
  readonly format: typeof LEDGER_FORMAT
  readonly date: string
  readonly sealedAt: string
  readonly broadcasts: readonly { id: string; date: string; title: string; endedAt: string | null }[]
  readonly products: readonly Record<string, unknown>[]
  readonly sales: readonly Record<string, unknown>[]
  readonly buyers: readonly Record<string, unknown>[]
  readonly settlements: readonly Record<string, unknown>[]
}

/** 확정 시각: 찜이 상품의 확정 목록에 들어간 이벤트의 at (다시 확정되면 그때) */
function confirmTimes(rows: readonly { body: string; failed: boolean }[]): { state: EngineState; times: Map<string, number> } {
  let state = emptyState()
  const lastWinners = new Map<string, Set<string>>()
  const times = new Map<string, number>()
  for (const row of rows) {
    if (row.failed) continue
    let event: Record<string, unknown>
    try {
      event = JSON.parse(row.body) as Record<string, unknown>
      state = applyEvent(state, event as unknown as EngineEvent).state
    } catch {
      continue
    }
    const at = typeof event.at === 'number' ? event.at : 0
    const b = typeof event.b === 'string' ? event.b : null
    const numbers: number[] = []
    let all = false
    if (b !== null && typeof event.no === 'number') numbers.push(event.no)
    if (b !== null && typeof event.to === 'number') numbers.push(event.to)
    if (event.type === 'chat' && b !== null && typeof event.text === 'string') {
      const settings = getBroadcast(state, b)?.settings
      if (settings !== undefined) {
        const parsed = parseChat(event.text, settings)
        numbers.push(...parsed.claims, ...parsed.cancels)
      }
    }
    if (b === null || ['host.blockBuyer', 'host.unblockBuyer', 'buyer.merge', 'buyer.unmerge', 'broadcast.end'].includes(String(event.type))) all = true
    const products = all ? listProducts(state) : numbers.flatMap((no) => (b === null ? [] : [getProduct(state, b, no)])).filter((item) => item !== null)
    for (const product of products) {
      if (product === null) continue
      const winners = new Set(product.winnerClaims)
      const before = lastWinners.get(product.id) ?? new Set<string>()
      for (const claim of winners) if (!before.has(claim)) times.set(claim, at)
      lastWinners.set(product.id, winners)
    }
  }
  return { state, times }
}

/** 판매자 장부 (형식에 매이지 않는 기록 — 엔진 상태 형식과 상관없다) */
export function buildLedger(date: string, state: EngineState, times: ReadonlyMap<string, number>, sealedAt: number): Ledger {
  const confirmed = listClaims(state).filter((claim) => claim.status === 'CONFIRMED')
  const buyers = listBuyers(state)
  const byId = new Map(buyers.map((buyer) => [buyer.id, buyer]))
  const settlements = listSettlements(state)
  const keep = new Set<string>()
  for (const buyer of buyers) if (buyer.items.length > 0) keep.add(buyer.id)
  for (const claim of confirmed) keep.add(claim.buyer)
  for (const settlement of settlements) {
    if (settlement.items.length > 0) keep.add(settlement.buyer)
    for (const record of settlement.records) keep.add(record.buyer)
  }
  return {
    format: LEDGER_FORMAT,
    date,
    sealedAt: iso(sealedAt),
    broadcasts: listBroadcasts(state).map((broadcast) => ({ id: broadcast.id, date: broadcast.date, title: broadcast.title, endedAt: broadcast.endedAt === null ? null : iso(broadcast.endedAt) })),
    products: listProducts(state).map((product) => ({
      id: product.id,
      key: product.key,
      broadcast: product.broadcast,
      no: product.no,
      name: product.name,
      price: product.price,
      stock: product.stock,
      status: product.status,
      winners: product.winners,
      priceHistory: product.priceHistory.map((change) => ({ from: change.from, to: change.to, at: iso(change.at) })),
    })),
    sales: confirmed.map((claim) => ({
      id: claim.id,
      product: claim.product,
      productId: claim.productId,
      broadcast: claim.broadcast,
      no: claim.no,
      buyer: claim.buyer,
      currentBuyer: claim.currentBuyer,
      buyerName: byId.get(claim.buyer)?.display ?? '',
      price: claim.price,
      confirmVersion: claim.confirmVersion,
      confirmedAt: times.has(claim.id) ? iso(times.get(claim.id) as number) : null,
      origin: claim.origin,
    })),
    buyers: buyers
      .filter((buyer) => keep.has(buyer.id))
      .map((buyer) => ({ id: buyer.id, kind: buyer.kind, display: buyer.display, phoneLast4: buyer.phoneLast4, mergedInto: buyer.mergedInto, current: buyer.current, items: buyer.items, subtotal: buyer.subtotal })),
    settlements: settlements.map((settlement) => withIsoTimes(settlement) as unknown as Record<string, unknown>),
  }
}

export interface SealerOptions {
  readonly db: Db
  readonly writer: ScopeWriter
  readonly timer: Timer
  readonly log: LogSink
  /** 봉인했다 (SSE) */
  readonly onSealed: (sellerId: string, date: string) => void
  readonly hooks?: { readonly beforeCommit?: () => void | Promise<void> }
  /** 바퀴마다 성공·실패 (워커 건강, AC-I3-82) */
  readonly onPass?: (ok: boolean) => void
}

export class Sealer {
  readonly #options: SealerOptions
  #loop: Promise<void> | null = null
  #stopped = false
  #wake = new AbortController()

  constructor(options: SealerOptions) {
    this.#options = options
  }

  /** 서버 시작 때 한 번, 그 뒤 1시간마다 */
  start(): void {
    if (this.#loop !== null) return
    this.#stopped = false
    this.#loop = (async () => {
      while (!this.#stopped) {
        await this.runOnce()
        if (this.#stopped) break
        this.#wake = new AbortController()
        await this.#options.timer.sleep(SEAL_EVERY_MS, this.#wake.signal)
      }
    })()
  }

  async stop(): Promise<void> {
    this.#stopped = true
    this.#wake.abort()
    await this.#loop
    this.#loop = null
  }

  /** 때가 된 범위를 모두 봉인한다. 봉인한 수 */
  async runOnce(): Promise<number> {
    const { db, timer, log } = this.#options
    const now = timer.now()
    let failed = false
    let sealed = 0
    try {
      // 봉인 대상 후보 (판매자를 가리지 않고 할 일을 찾는다 — 이어서 쓰는 질의는 그 행의 판매자 ID를 건다)
      const candidates = await db
        .select({ id: scopes.id, sellerId: scopes.sellerId, date: scopes.date })
        .from(scopes)
        .where(and(eq(scopes.rehearsal, false), eq(scopes.youtubeChat, true), isNull(scopes.sealedAt)))
      for (const scope of candidates) {
        if (sealAtOf(scope.date) > now) continue
        try {
          if (await this.seal(scope.sellerId, scope.id, scope.date)) sealed += 1
        } catch (error) {
          failed = true
          log({ level: 'error', code: 'SEAL_FAILED', seller: scope.sellerId, date: scope.date, errorKind: errorKind(error) })
        }
      }
    } catch (error) {
      failed = true
      log({ level: 'error', code: 'SEAL_FAILED', errorKind: errorKind(error) })
    }
    this.#options.onPass?.(!failed)
    return sealed
  }

  /** 범위 하나를 봉인한다 (이미 봉인했으면 false) */
  async seal(sellerId: string, scopeId: string, date: string): Promise<boolean> {
    const { db, writer, timer, log } = this.#options
    const result = await writer.serial(sellerId, date, false, async () => {
      const done = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${scopeLockKey(sellerId, date, false)})`)
        const rows = await tx
          .select({ sealedAt: scopes.sealedAt })
          .from(scopes)
          .where(and(eq(scopes.sellerId, sellerId), eq(scopes.id, scopeId)))
          .limit(1)
        if (rows[0] === undefined || rows[0].sealedAt !== null) return false
        const now = timer.now()
        // 장부 재료: 로그 전체를 처음부터 재생 (따로 둔 본문·이름을 합쳐서) — 확정 시각도 함께
        const events = await eventsAfter(tx, sellerId, scopeId, 0)
        const { state, times } = confirmTimes(events)
        const ledger = JSON.stringify(buildLedger(date, state, times, now))
        // (1) 발송함: 끝나지 않은 감사·요약 행은 보내지 못함(봉인), 모든 행의 게시 문구를 지운다(효과 본문의 문구 포함)
        await tx
          .update(outbox)
          .set({ state: 'FAILED', reason: 'SEALED', nextAt: null, leaseOwner: null, leaseUntil: null, updatedAt: new Date(now) })
          .where(
            and(
              eq(outbox.sellerId, sellerId),
              eq(outbox.scopeId, scopeId),
              eq(outbox.rehearsal, false),
              // 복구로 다시 만든 행은 실행하지 않는 행이라 상태를 붙이지 않는다 (D-I2-11) — 게시 문구는 아래에서 모든 행을 지운다
              eq(outbox.restored, false),
              inArray(outbox.kind, ['POST_THANKS', 'SUMMARY_COMMENT']),
              sql`(${outbox.state} is null or ${outbox.state} in ('WAITING', 'SENDING'))`,
            ),
          )
        const outboxRows = await tx
          .select({ id: outbox.id, body: outbox.body })
          .from(outbox)
          .where(and(eq(outbox.sellerId, sellerId), eq(outbox.scopeId, scopeId)))
        for (const row of outboxRows) {
          let body = row.body
          try {
            const parsed = JSON.parse(row.body) as Record<string, unknown>
            if (typeof parsed.text === 'string') body = JSON.stringify({ ...parsed, text: null })
          } catch {
            body = '{}'
          }
          await tx
            .update(outbox)
            .set({ body, postText: null, sentText: null })
            .where(and(eq(outbox.sellerId, sellerId), eq(outbox.id, row.id)))
        }
        // (3) 따로 둔 채팅 본문·이름, 스냅샷, 삭제·차단 알림, 수집 이어받기 지점, 우리 메시지 기록
        await tx.delete(chatRaw).where(and(eq(chatRaw.sellerId, sellerId), eq(chatRaw.scopeId, scopeId)))
        await tx.delete(snapshots).where(and(eq(snapshots.sellerId, sellerId), eq(snapshots.scopeId, scopeId)))
        await tx.delete(youtubeNotices).where(and(eq(youtubeNotices.sellerId, sellerId), eq(youtubeNotices.scopeId, scopeId)))
        await tx.delete(youtubeOwnMessages).where(and(eq(youtubeOwnMessages.sellerId, sellerId), eq(youtubeOwnMessages.scopeId, scopeId)))
        await tx
          .update(youtubeCollectors)
          .set({ pageToken: null, status: 'STOPPED', reason: 'SEALED', leaseOwner: null, leaseUntil: null, updatedAt: new Date(now) })
          .where(and(eq(youtubeCollectors.sellerId, sellerId), eq(youtubeCollectors.scopeId, scopeId)))
        // (4) 봉인 표시와 장부
        await tx
          .update(scopes)
          .set({ sealedAt: new Date(now), ledger, ledgerDigest: sha256Hex(ledger) })
          .where(and(eq(scopes.sellerId, sellerId), eq(scopes.id, scopeId)))
        await this.#options.hooks?.beforeCommit?.()
        return true
      })
      if (done) writer.forget(sellerId, date, false)
      return done
    })
    if (result) {
      log({ level: 'info', code: 'SEALED', seller: sellerId, date })
      this.#options.onSealed(sellerId, date)
    }
    return result
  }
}

/** 봉인한 범위의 조회 (AC-Y1-62): 범위 조회와 같은 모양 + 봉인 표시. 장부를 읽을 수 없으면 null */
export function sealedView(date: string, seq: number, ledgerText: string | null): Record<string, unknown> | null {
  if (ledgerText === null) return null
  let ledger: Ledger
  try {
    ledger = JSON.parse(ledgerText) as Ledger
  } catch {
    return null
  }
  return {
    date,
    rehearsal: false,
    seq,
    sealed: true,
    sealedAt: ledger.sealedAt,
    broadcasts: ledger.broadcasts.map((broadcast) => ({ ...broadcast, ended: broadcast.endedAt !== null })),
    products: ledger.products,
    claims: ledger.sales.map((sale) => ({ ...sale, status: 'CONFIRMED' })),
    pending: [],
    buyers: ledger.buyers,
    settlements: ledger.settlements,
    effects: [],
    cancelRequests: [],
    attention: [],
  }
}
