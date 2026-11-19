// 감사 채팅 정정 줄의 조회·변경 (D-RETRO-105, DOMAIN_RULES R-13 "게시 뒤 감사 정정"). 정정 실행기(thanks-fix.ts)는 이 표를 이 파일의 함수로만 읽고 쓴다.
// 줄은 실제 범위의 이미 올라간 감사에서만 생긴다(발송함 질의가 rehearsal = false·restored = false로 고른 행에서) — 리허설·복구 범위에는 줄이 없다.
import { and, asc, eq, gte, isNull, lte, or } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { scopes, thanksFixes } from '../db/schema.ts'

export type FixState = 'WAITING' | 'WORKING' | 'DONE' | 'SKIPPED' | 'FAILED'

export interface FixRow {
  readonly id: number
  readonly sellerId: string
  readonly scopeId: string
  readonly date: string
  readonly broadcastId: string
  readonly source: string
  readonly effectIds: string
  readonly oldTexts: string
  readonly oldMessage: string | null
  readonly oldRemoteIds: string
  readonly state: FixState
  readonly reason: string | null
  readonly deleted: boolean | null
  readonly sentTexts: string
  readonly newRemoteIds: string
  readonly newTexts: string
  readonly attempts: number
  readonly nextAt: Date | null
  readonly leaseOwner: string | null
  readonly leaseUntil: Date | null
  readonly attemptAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly doneAt: Date | null
  /** 판매자가 앱에서 손으로 한 줄 (D-THANKSFIX-01) */
  readonly manual: boolean
  /** 손으로 고쳐 다시 올릴 글 (지우기만이면 null) */
  readonly manualText: string | null
}

const columns = {
  id: thanksFixes.id,
  sellerId: thanksFixes.sellerId,
  scopeId: thanksFixes.scopeId,
  date: scopes.date,
  broadcastId: thanksFixes.broadcastId,
  source: thanksFixes.source,
  effectIds: thanksFixes.effectIds,
  oldTexts: thanksFixes.oldTexts,
  oldMessage: thanksFixes.oldMessage,
  oldRemoteIds: thanksFixes.oldRemoteIds,
  state: thanksFixes.state,
  reason: thanksFixes.reason,
  deleted: thanksFixes.deleted,
  sentTexts: thanksFixes.sentTexts,
  newRemoteIds: thanksFixes.newRemoteIds,
  newTexts: thanksFixes.newTexts,
  attempts: thanksFixes.attempts,
  nextAt: thanksFixes.nextAt,
  leaseOwner: thanksFixes.leaseOwner,
  leaseUntil: thanksFixes.leaseUntil,
  attemptAt: thanksFixes.attemptAt,
  createdAt: thanksFixes.createdAt,
  updatedAt: thanksFixes.updatedAt,
  doneAt: thanksFixes.doneAt,
  manual: thanksFixes.manual,
  manualText: thanksFixes.manualText,
}

const select = (db: Db) =>
  db
    .select(columns)
    .from(thanksFixes)
    .innerJoin(scopes, and(eq(scopes.id, thanksFixes.scopeId), eq(scopes.sellerId, thanksFixes.sellerId), eq(scopes.rehearsal, false)))

const asRow = (row: Omit<FixRow, 'state'> & { state: string }): FixRow => row as FixRow

/** since 뒤에 생겼거나 마친 정정 줄 (고칠 글 찾기 — 앞 정정이 올린 글과 이미 정정한 글) */
export async function recentFixes(db: Db, since: Date): Promise<FixRow[]> {
  const rows = await select(db)
    .where(or(gte(thanksFixes.createdAt, since), gte(thanksFixes.doneAt, since)))
    .orderBy(asc(thanksFixes.id))
  return rows.map(asRow)
}

/** 때가 된 기다리는 줄 */
export async function dueFixes(db: Db, now: Date, limit = 200): Promise<FixRow[]> {
  const rows = await select(db)
    .where(and(eq(thanksFixes.state, 'WAITING'), lte(thanksFixes.nextAt, now)))
    .orderBy(asc(thanksFixes.id))
    .limit(limit)
  return rows.map(asRow)
}

/** 임대가 지난 하는 중 줄 (서버가 하던 중에 멈춤) */
export async function staleFixes(db: Db, now: Date): Promise<FixRow[]> {
  const rows = await select(db)
    .where(and(eq(thanksFixes.state, 'WORKING'), lte(thanksFixes.leaseUntil, now)))
    .orderBy(asc(thanksFixes.id))
  return rows.map(asRow)
}

export async function findFix(db: Db, sellerId: string, id: number): Promise<FixRow | null> {
  const rows = await select(db)
    .where(and(eq(thanksFixes.sellerId, sellerId), eq(thanksFixes.id, id)))
    .limit(1)
  const row = rows[0]
  return row === undefined ? null : asRow(row)
}

/** 그 방송의 정정 줄 전부 (시험·조회) */
export async function broadcastFixes(db: Db, sellerId: string, broadcastId: string): Promise<FixRow[]> {
  const rows = await select(db)
    .where(and(eq(thanksFixes.sellerId, sellerId), eq(thanksFixes.broadcastId, broadcastId)))
    .orderBy(asc(thanksFixes.id))
  return rows.map(asRow)
}

export interface NewFix {
  readonly sellerId: string
  readonly scopeId: string
  readonly broadcastId: string
  readonly source: string
  readonly effectIds: readonly string[]
  readonly oldTexts: readonly string[]
  readonly oldMessage: string | null
  readonly oldRemoteIds: readonly (string | null)[]
  /** 지금 정한 고친 문구 `[효과 ID, 문구][]` (기다리는 동안 바뀌면 다시 늦춘다) */
  readonly newTexts: string
  readonly nextAt: Date
  readonly now: Date
}

/** 정정 줄을 새로 (그 글에 이미 줄이 있으면 아무 일도 없다 — 글 하나에 줄 하나). 만들었으면 true */
export async function insertFix(db: Db, fix: NewFix): Promise<boolean> {
  const rows = await db
    .insert(thanksFixes)
    .values({
      sellerId: fix.sellerId,
      scopeId: fix.scopeId,
      broadcastId: fix.broadcastId,
      source: fix.source,
      effectIds: JSON.stringify(fix.effectIds),
      oldTexts: JSON.stringify(fix.oldTexts),
      oldMessage: fix.oldMessage,
      oldRemoteIds: JSON.stringify(fix.oldRemoteIds),
      newTexts: fix.newTexts,
      state: 'WAITING',
      nextAt: fix.nextAt,
      createdAt: fix.now,
      updatedAt: fix.now,
    })
    .onConflictDoNothing()
    .returning({ id: thanksFixes.id })
  return rows.length > 0
}

/** 손으로 하는 줄 (D-THANKSFIX-01): 판매자가 고른 글 하나를 지우거나(text null) 고친 글로 다시 올린다. 바로 할 차례로 넣는다 */
export async function insertManualFix(db: Db, fix: Omit<NewFix, 'newTexts' | 'nextAt'> & { readonly text: string | null }): Promise<number> {
  const rows = await db
    .insert(thanksFixes)
    .values({
      sellerId: fix.sellerId,
      scopeId: fix.scopeId,
      broadcastId: fix.broadcastId,
      source: fix.source,
      effectIds: JSON.stringify(fix.effectIds),
      oldTexts: JSON.stringify(fix.oldTexts),
      oldMessage: fix.oldMessage,
      oldRemoteIds: JSON.stringify(fix.oldRemoteIds),
      newTexts: '[]',
      state: 'WAITING',
      nextAt: fix.now,
      createdAt: fix.now,
      updatedAt: fix.now,
      manual: true,
      manualText: fix.text,
    })
    .returning({ id: thanksFixes.id })
  return rows[0]?.id ?? 0
}

export interface FixChange {
  readonly state?: FixState
  readonly reason?: string | null
  readonly deleted?: boolean | null
  readonly sentTexts?: string
  readonly newRemoteIds?: string
  readonly newTexts?: string
  readonly attempts?: number
  readonly nextAt?: Date | null
  readonly leaseOwner?: string | null
  readonly leaseUntil?: Date | null
  readonly attemptAt?: Date | null
  readonly doneAt?: Date | null
}

/** 줄을 바꾼다. expect 상태(와 임대 주인)인 줄만 — 바꿨으면 true (실행기 둘이 같은 줄을 잡지 않게, 한 문장으로) */
export async function updateFix(db: Db, sellerId: string, id: number, change: FixChange, now: Date, expect: { readonly state: FixState; readonly leaseOwner?: string }): Promise<boolean> {
  const conditions = [eq(thanksFixes.sellerId, sellerId), eq(thanksFixes.id, id), eq(thanksFixes.state, expect.state)]
  if (expect.leaseOwner !== undefined) conditions.push(eq(thanksFixes.leaseOwner, expect.leaseOwner))
  const rows = await db
    .update(thanksFixes)
    .set({ ...change, updatedAt: now })
    .where(and(...conditions))
    .returning({ id: thanksFixes.id })
  return rows.length > 0
}

/** 아무것도 하지 않은 줄을 지운다 (지우기 전·올리기 전, 값이 올린 그대로로 돌아왔을 때만 부른다). expect 상태(와 임대 주인)인 줄만 */
export async function deleteFix(db: Db, sellerId: string, id: number, expect: { readonly state: FixState; readonly leaseOwner?: string }): Promise<boolean> {
  const conditions = [eq(thanksFixes.sellerId, sellerId), eq(thanksFixes.id, id), eq(thanksFixes.state, expect.state), isNull(thanksFixes.deleted)]
  if (expect.leaseOwner !== undefined) conditions.push(eq(thanksFixes.leaseOwner, expect.leaseOwner))
  const rows = await db.delete(thanksFixes).where(and(...conditions)).returning({ id: thanksFixes.id })
  return rows.length > 0
}
