// 발송함 실행기의 조회·변경 (AC-Y1-30, RA-S05-002, D-Y06).
// 실행기가 행을 고르고 바꾸는 질의는 모두 여기 있고, 모두 `rehearsal = false`를 조건에 고정한다 — 그 값을 바꾸는 매개변수가 없다.
// 실행기(outbox.ts)는 발송함 표를 이 파일의 함수로만 읽고 쓴다(test/youtube-outbox-guard.test.ts가 코드로 확인한다).
// 실행기는 감사(POST_THANKS)와 방송 후 요약 댓글(SUMMARY_COMMENT) 행만 다룬다. 라벨 행(PRINT_PRODUCT_LABEL·VOID_LABEL)은 건드리지 않는다(S08).
import { and, asc, eq, gte, inArray, isNull, lte, or, type SQL } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { outbox, scopes } from '../db/schema.ts'
import { SUMMARY_KIND } from './texts.ts'

/** 실행기가 다루는 행의 종류 */
const RUNNER_KINDS = ['POST_THANKS', SUMMARY_KIND]

/** 모든 실행기 질의의 공통 조건: 실제 범위의 행만, 감사·요약 댓글만 */
const REAL: SQL = and(eq(outbox.rehearsal, false), inArray(outbox.kind, RUNNER_KINDS)) as SQL

export interface RunnerRow {
  readonly id: number
  readonly sellerId: string
  readonly scopeId: string
  readonly date: string
  readonly effectId: string
  readonly kind: string
  readonly body: string
  readonly state: string | null
  readonly reason: string | null
  readonly target: string | null
  readonly broadcastId: string | null
  readonly groupId: string | null
  readonly attempts: number
  readonly nextAt: Date | null
  readonly deadlineAt: Date | null
  readonly postText: string | null
  readonly sentText: string | null
  readonly attemptAt: Date | null
  readonly confirmUntil: Date | null
  readonly remoteId: string | null
  readonly postedAt: Date | null
  readonly reported: boolean
  readonly manual: boolean
  readonly leaseOwner: string | null
  readonly leaseUntil: Date | null
  readonly createdAt: Date
}

const columns = {
  id: outbox.id,
  sellerId: outbox.sellerId,
  scopeId: outbox.scopeId,
  date: scopes.date,
  effectId: outbox.effectId,
  kind: outbox.kind,
  body: outbox.body,
  state: outbox.state,
  reason: outbox.reason,
  target: outbox.target,
  broadcastId: outbox.broadcastId,
  groupId: outbox.groupId,
  attempts: outbox.attempts,
  nextAt: outbox.nextAt,
  deadlineAt: outbox.deadlineAt,
  postText: outbox.postText,
  sentText: outbox.sentText,
  attemptAt: outbox.attemptAt,
  confirmUntil: outbox.confirmUntil,
  remoteId: outbox.remoteId,
  postedAt: outbox.postedAt,
  reported: outbox.reported,
  manual: outbox.manual,
  leaseOwner: outbox.leaseOwner,
  leaseUntil: outbox.leaseUntil,
  createdAt: outbox.createdAt,
}

const select = (db: Db) =>
  db
    .select(columns)
    .from(outbox)
    .innerJoin(scopes, and(eq(scopes.id, outbox.scopeId), eq(scopes.sellerId, outbox.sellerId), eq(scopes.rehearsal, false)))

/** 실행기가 아직 보지 않은 감사 행 (효과가 나온 순서) */
export function newThanksRows(db: Db, limit = 500): Promise<RunnerRow[]> {
  return select(db)
    .where(and(REAL, isNull(outbox.state), eq(outbox.kind, 'POST_THANKS')))
    .orderBy(asc(outbox.id))
    .limit(limit)
}

/** 기다리는 행 중 때가 된 것 (다음 시도 시각 ≤ 지금) */
export function dueRows(db: Db, now: Date, limit = 1000): Promise<RunnerRow[]> {
  return select(db)
    .where(and(REAL, eq(outbox.state, 'WAITING'), lte(outbox.nextAt, now)))
    .orderBy(asc(outbox.id))
    .limit(limit)
}

/** 보내는 중인 행 (타임아웃 확인·서버가 죽었다 살아난 뒤 확인) */
export function sendingRows(db: Db): Promise<RunnerRow[]> {
  return select(db)
    .where(and(REAL, eq(outbox.state, 'SENDING')))
    .orderBy(asc(outbox.id))
}

/** 게시됐는데 게시 보고를 아직 기록하지 못한 감사 행 */
export function unreportedRows(db: Db): Promise<RunnerRow[]> {
  return select(db)
    .where(and(REAL, eq(outbox.state, 'SENT'), eq(outbox.reported, false), eq(outbox.kind, 'POST_THANKS')))
    .orderBy(asc(outbox.id))
}

/** 같은 메시지로 함께 보내는 행 */
export function groupRows(db: Db, sellerId: string, groupId: string): Promise<RunnerRow[]> {
  return select(db)
    .where(and(REAL, eq(outbox.sellerId, sellerId), eq(outbox.groupId, groupId)))
    .orderBy(asc(outbox.id))
}

/** 판매자의 행 하나 (수동 재전송) */
export async function findRow(db: Db, sellerId: string, id: number): Promise<RunnerRow | null> {
  const rows = await select(db)
    .where(and(REAL, eq(outbox.sellerId, sellerId), eq(outbox.id, id)))
    .limit(1)
  return rows[0] ?? null
}

/** 이 요청 번호로 다시 보낸 행 */
export async function rowByResendRequest(db: Db, sellerId: string, requestId: string): Promise<RunnerRow | null> {
  const rows = await select(db)
    .where(and(REAL, eq(outbox.sellerId, sellerId), eq(outbox.resendRequestId, requestId)))
    .limit(1)
  return rows[0] ?? null
}

/** 날짜(실제 범위)의 행 목록 (발송함 조회, AC-Y1-39) */
export function scopeRows(db: Db, sellerId: string, scopeId: string): Promise<RunnerRow[]> {
  return select(db)
    .where(and(REAL, eq(outbox.sellerId, sellerId), eq(outbox.scopeId, scopeId)))
    .orderBy(asc(outbox.id))
}

/** 열린 묶음 창: 그 방송의 묶이기를 기다리는 실시간 채팅 감사가 있으면 그 창이 닫히는 시각 */
export async function openWindowAt(db: Db, sellerId: string, scopeId: string, broadcastId: string, at: Date): Promise<Date | null> {
  const rows = await db
    .select({ nextAt: outbox.nextAt })
    .from(outbox)
    .where(
      and(
        REAL,
        eq(outbox.sellerId, sellerId),
        eq(outbox.scopeId, scopeId),
        eq(outbox.broadcastId, broadcastId),
        eq(outbox.state, 'WAITING'),
        eq(outbox.target, 'LIVE_CHAT'),
        eq(outbox.reason, 'WINDOW'),
        isNull(outbox.groupId),
        gte(outbox.nextAt, at),
      ),
    )
    .orderBy(asc(outbox.nextAt))
    .limit(1)
  return rows[0]?.nextAt ?? null
}

export interface RowChange {
  readonly state?: string | null
  readonly reason?: string | null
  readonly target?: string | null
  readonly broadcastId?: string | null
  readonly groupId?: string | null
  readonly attempts?: number
  readonly nextAt?: Date | null
  readonly deadlineAt?: Date | null
  readonly postText?: string | null
  readonly sentText?: string | null
  readonly attemptAt?: Date | null
  readonly confirmUntil?: Date | null
  readonly remoteId?: string | null
  readonly postedAt?: Date | null
  readonly reported?: boolean
  readonly manual?: boolean
  readonly resendRequestId?: string | null
  readonly leaseOwner?: string | null
  readonly leaseUntil?: Date | null
}

/**
 * 행들을 바꾼다. expect를 주면 그 상태(와 묶음)인 행만 바꾼다 — 바꾼 행 ID를 돌려준다(실행기 둘이 같은 행을 잡지 않게, 한 문장으로)
 */
export async function updateRows(
  db: Db,
  sellerId: string,
  ids: readonly number[],
  change: RowChange,
  now: Date,
  expect?: { readonly state: string | null; readonly groupId?: string | null; readonly leaseOwner?: string },
): Promise<number[]> {
  if (ids.length === 0) return []
  const conditions: SQL[] = [REAL, eq(outbox.sellerId, sellerId), inArray(outbox.id, [...ids])]
  if (expect !== undefined) {
    conditions.push(expect.state === null ? isNull(outbox.state) : eq(outbox.state, expect.state))
    if (expect.groupId !== undefined) conditions.push(expect.groupId === null ? isNull(outbox.groupId) : eq(outbox.groupId, expect.groupId))
    if (expect.leaseOwner !== undefined) conditions.push(eq(outbox.leaseOwner, expect.leaseOwner))
  }
  const rows = await db
    .update(outbox)
    .set({ ...change, updatedAt: now })
    .where(and(...conditions))
    .returning({ id: outbox.id })
  return rows.map((row) => row.id)
}

/**
 * 기다리는 행을 보내지 못함으로 (동의 끔·연결 끊기·방송 연결 끊기). targets·broadcast로 고른다. 바꾼 행 (범위 ID와 함께)
 */
export async function failWaiting(
  db: Db,
  sellerId: string,
  filter: { readonly targets?: readonly string[]; readonly broadcastId?: string; readonly manual?: boolean },
  reason: string,
  now: Date,
): Promise<{ id: number; scopeId: string }[]> {
  // 아직 실행기가 보지 않은 행(state null)은 실행기가 처음 볼 때 지금 동의·연결을 다시 본다
  const conditions: SQL[] = [REAL, eq(outbox.sellerId, sellerId), eq(outbox.state, 'WAITING')]
  if (filter.targets !== undefined) conditions.push(inArray(outbox.target, [...filter.targets]))
  if (filter.broadcastId !== undefined) conditions.push(eq(outbox.broadcastId, filter.broadcastId))
  if (filter.manual !== undefined) conditions.push(eq(outbox.manual, filter.manual))
  const rows = await db
    .update(outbox)
    .set({ state: 'FAILED', reason, nextAt: null, leaseOwner: null, leaseUntil: null, updatedAt: now })
    .where(and(...conditions))
    .returning({ id: outbox.id, scopeId: outbox.scopeId })
  return rows
}

/** 범위 ID → 날짜 (알림에 날짜를 붙인다) */
export async function scopeDates(db: Db, sellerId: string, scopeIds: readonly string[]): Promise<Map<string, string>> {
  if (scopeIds.length === 0) return new Map()
  const rows = await db
    .select({ id: scopes.id, date: scopes.date })
    .from(scopes)
    .where(and(eq(scopes.sellerId, sellerId), inArray(scopes.id, [...new Set(scopeIds)])))
  return new Map(rows.map((row) => [row.id, row.date]))
}

/** 우리가 보내려 한 글인지 (AC-Y1-26): 그 방송의 실시간 채팅 감사 중 게시 응답의 메시지 ID이거나, 10분 안에 보내려 한 글과 같은 것 */
export async function isOurPost(db: Db, sellerId: string, broadcastId: string, messageId: string, text: string, since: Date): Promise<boolean> {
  const rows = await db
    .select({ id: outbox.id })
    .from(outbox)
    .where(
      and(
        REAL,
        eq(outbox.sellerId, sellerId),
        eq(outbox.broadcastId, broadcastId),
        eq(outbox.target, 'LIVE_CHAT'),
        or(eq(outbox.remoteId, messageId), and(eq(outbox.sentText, text), gte(outbox.attemptAt, since))),
      ),
    )
    .limit(1)
  return rows.length > 0
}

export interface NewSummaryRow {
  readonly sellerId: string
  readonly scopeId: string
  readonly effectId: string
  readonly seq: number
  readonly body: string
  readonly broadcastId: string
  readonly text: string
  readonly state: 'WAITING' | 'FAILED'
  readonly reason: string | null
  readonly now: Date
  readonly deadlineAt: Date
}

/** 방송 후 요약 댓글 행 (같은 효과 ID면 아무 일도 없다 — 같은 회차에 두 번 만들지 않는다) */
export async function insertSummaryRows(db: Db, rows: readonly NewSummaryRow[]): Promise<void> {
  if (rows.length === 0) return
  await db
    .insert(outbox)
    .values(
      rows.map((row) => ({
        sellerId: row.sellerId,
        scopeId: row.scopeId,
        effectId: row.effectId,
        seq: row.seq,
        kind: SUMMARY_KIND,
        body: row.body,
        rehearsal: false,
        createdAt: row.now,
        state: row.state,
        reason: row.reason,
        target: 'SUMMARY',
        broadcastId: row.broadcastId,
        nextAt: row.state === 'WAITING' ? row.now : null,
        deadlineAt: row.deadlineAt,
        postText: row.text,
        updatedAt: row.now,
      })),
    )
    .onConflictDoNothing({ target: [outbox.sellerId, outbox.scopeId, outbox.effectId] })
}
