// 손님 기록 보관 차례 (CRM1 D-CRM1-12, AC-CRM1-33). 30일 봉인 장부(youtube/seal.ts — 고치지 않는다)엔 끝난 찜·조치 사유가 없어,
// 봉인 뒤에도 노쇼 기록(취소 수·'입금 안 함')이 남도록 봉인 전에 손님 기록 쪽에서 따로 적어 둔다.
// - 언제: 서버 시작 때와 1시간마다. 봉인 안 된 실제 날짜 중 방송 날짜가 오늘(서버 시계의 KST 날짜)보다 앞선 것만,
//   그 범위 seq가 마지막으로 적은 seq와 다를 때만 그 날짜 행을 통째로 바꿔 적는다.
// - 봉인된 날짜: 그 날짜 줄을 frozen으로 두고 다시 쓰지도 지우지도 않는다(복구·가져오기 포함 — 표는 RESTORE_KEPT_TABLES).
//   쓰기는 봉인과 같은 범위 줄(writer.serial)·같은 범위 잠금 안에서 범위가 아직 봉인 전인지 보고 한다 — 봉인과 엇갈려 봉인 뒤에 쓰는 일이 없다.
// - 무엇: 그날 기록 묶음마다 뿌리 구매자 ID·표지가 있는 구성원(표지·그날 표시 이름)·취소 수·'입금 안 함' 찜 수(facts.ts archiveRowsOf).
//   품목·금액·입금은 적지 않는다(장부에 있다). 판정은 하지 않는다 — 손님 기록 재료(코어 조회 결과)를 옮겨 적을 뿐이다.
// - 노출: 손님 기록 셈(facts.ts mergeArchive)에만 쓴다. 로그엔 판매자 ID·날짜·개수·오류 종류만.
import { and, asc, eq, gt, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { customerArchiveDays, customerArchiveRows, scopeLockKey, scopes } from '../db/schema.ts'
import { errorKind, type LogSink } from '../log.ts'
import { kstDate } from '../time.ts'
import type { ScopeWriter } from '../writer.ts'
import type { Timer } from '../youtube/timer.ts'
import { archiveRowsOf, factsFor, type FactsDeps, type ScopeRow } from './facts.ts'

/** 보관 차례 간격 (1시간, D-CRM1-12) */
export const CUSTOMER_ARCHIVE_EVERY_MS = 60 * 60 * 1000

export interface ArchiverOptions {
  readonly db: Db
  readonly writer: ScopeWriter
  readonly timer: Timer
  readonly log: LogSink
  /** 손님 기록 재료를 세우는 데 쓰는 것 (CustomerService.factsDeps) */
  readonly facts: FactsDeps
}

/** 한 차례의 결과 (시험·운영 확인용 — 개수만) */
export interface ArchivePass {
  /** 새로 적은(바꿔 적은) 날짜 수 */
  readonly written: number
  /** 봉인을 보고 굳힌 날짜 수 */
  readonly frozen: number
  /** 실패한 날짜 수 (다음 차례에 다시) */
  readonly failed: number
}

export class CustomerArchiver {
  readonly #options: ArchiverOptions
  #loop: Promise<void> | null = null
  #stopped = false
  #wake = new AbortController()

  constructor(options: ArchiverOptions) {
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
        await this.#options.timer.sleep(CUSTOMER_ARCHIVE_EVERY_MS, this.#wake.signal)
      }
    })()
  }

  async stop(): Promise<void> {
    this.#stopped = true
    this.#wake.abort()
    await this.#loop
    this.#loop = null
  }

  /** 한 차례: 봉인된 날짜 줄을 굳히고, 때가 된 날짜를 적는다 (실패해도 다른 날짜는 계속) */
  async runOnce(): Promise<ArchivePass> {
    const { db, timer, log } = this.#options
    let written = 0
    let frozen = 0
    let failed = 0
    try {
      frozen = await this.#freezeSealed()
      const today = kstDate(timer.now())
      // 할 일 찾기 (판매자를 가리지 않는다 — 이어서 쓰는 질의는 그 행의 판매자 ID를 건다)
      const candidates = await db
        .select({ id: scopes.id, sellerId: scopes.sellerId, date: scopes.date, seq: scopes.seq, sealedAt: scopes.sealedAt })
        .from(scopes)
        .where(and(eq(scopes.rehearsal, false), gt(scopes.seq, 0), isNull(scopes.sealedAt), lt(scopes.date, today)))
        .orderBy(asc(scopes.sellerId), asc(scopes.date))
      const headers = await db.select({ sellerId: customerArchiveDays.sellerId, date: customerArchiveDays.date, seq: customerArchiveDays.seq, frozen: customerArchiveDays.frozen }).from(customerArchiveDays)
      const known = new Map(headers.map((row) => [JSON.stringify([row.sellerId, row.date]), row]))
      for (const scope of candidates) {
        const header = known.get(JSON.stringify([scope.sellerId, scope.date]))
        if (header !== undefined && (header.frozen || header.seq === scope.seq)) continue
        try {
          if (await this.archive(scope.sellerId, scope)) written += 1
        } catch (error) {
          failed += 1
          log({ level: 'error', code: 'CUSTOMER_ARCHIVE_FAILED', seller: scope.sellerId, date: scope.date, errorKind: errorKind(error) })
        }
      }
    } catch (error) {
      failed += 1
      log({ level: 'error', code: 'CUSTOMER_ARCHIVE_FAILED', errorKind: errorKind(error) })
    }
    if (written > 0) log({ level: 'info', code: 'CUSTOMER_ARCHIVED', count: written })
    return { written, frozen, failed }
  }

  /** 봉인된 날짜의 날짜 줄을 굳힌다 (그 뒤 복구로 봉인 전 범위가 돌아와도 다시 쓰지 않는다). 굳힌 수 */
  async #freezeSealed(): Promise<number> {
    const { db } = this.#options
    const sealed = await db
      .select({ sellerId: customerArchiveDays.sellerId, date: customerArchiveDays.date })
      .from(customerArchiveDays)
      .innerJoin(scopes, and(eq(scopes.sellerId, customerArchiveDays.sellerId), eq(scopes.date, customerArchiveDays.date), eq(scopes.rehearsal, false)))
      .where(and(eq(customerArchiveDays.frozen, false), isNotNull(scopes.sealedAt)))
    for (const row of sealed) {
      await db
        .update(customerArchiveDays)
        .set({ frozen: true })
        .where(and(eq(customerArchiveDays.sellerId, row.sellerId), eq(customerArchiveDays.date, row.date)))
    }
    return sealed.length
  }

  /**
   * 범위 하나의 보관 행을 통째로 바꿔 적는다. 적었으면 true.
   * 재료는 범위 줄 밖에서 세우고(재료 세우기가 범위 줄에서 상태를 읽는다), 쓰기는 범위 줄·범위 잠금 안에서 봉인 전인지 다시 보고 한다
   */
  async archive(sellerId: string, scope: ScopeRow): Promise<boolean> {
    const { db, writer, timer } = this.#options
    const facts = await factsFor(this.#options.facts, sellerId, scope)
    if (facts === null) return false
    const rows = archiveRowsOf(facts)
    return writer.serial(sellerId, scope.date, false, () =>
      db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${scopeLockKey(sellerId, scope.date, false)})`)
        const current = await tx
          .select({ id: scopes.id, sealedAt: scopes.sealedAt })
          .from(scopes)
          .where(and(eq(scopes.sellerId, sellerId), eq(scopes.date, scope.date), eq(scopes.rehearsal, false)))
          .limit(1)
        // 봉인됐거나 범위가 바뀌었으면(복구) 쓰지 않는다 — 봉인한 날짜의 행은 바꾸지 않는다
        if (current[0] === undefined || current[0].sealedAt !== null || current[0].id !== facts.scopeId) return false
        const header = await tx
          .select({ frozen: customerArchiveDays.frozen })
          .from(customerArchiveDays)
          .where(and(eq(customerArchiveDays.sellerId, sellerId), eq(customerArchiveDays.date, scope.date)))
          .limit(1)
        if (header[0]?.frozen === true) return false
        await tx.delete(customerArchiveRows).where(and(eq(customerArchiveRows.sellerId, sellerId), eq(customerArchiveRows.date, scope.date)))
        if (rows.length > 0) {
          await tx.insert(customerArchiveRows).values(
            rows.map((row) => ({ sellerId, date: scope.date, root: row.root, members: JSON.stringify(row.members), cancels: row.cancels, noPay: row.noPay })),
          )
        }
        const writtenAt = new Date(timer.now())
        await tx
          .insert(customerArchiveDays)
          .values({ sellerId, date: scope.date, seq: facts.seq, frozen: false, writtenAt })
          .onConflictDoUpdate({ target: [customerArchiveDays.sellerId, customerArchiveDays.date], set: { seq: facts.seq, writtenAt } })
        return true
      }),
    )
  }
}
