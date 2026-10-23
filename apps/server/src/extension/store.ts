// 크롬 확장 저장소 (X1 YT-10, D-X1-07·08·10·11). 모든 질의에 판매자 ID 조건을 건다(토큰 해시로 찾는 것만 예외 — 찾은 행의 판매자로 이어 간다).
// 코드·토큰은 해시로만 둔다. 채팅 내용·닉네임은 여기 없다.
import { and, eq, isNull, lt } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { extBindings, extCodes, extStatus, extTokens } from '../db/schema.ts'

export type RevokeReason = 'DISCONNECTED' | 'RENEWED' | 'IDLE'

export interface TokenRow {
  readonly id: string
  readonly sellerId: string
  readonly createdAt: Date
  readonly lastUsedAt: Date
  readonly revokedAt: Date | null
}

export interface BindingRow {
  readonly id: string
  readonly videoId: string
  readonly broadcastId: string
  readonly how: string
  readonly linkedAt: Date
}

export interface StatusRow {
  readonly tokenId: string
  readonly videoId: string | null
  readonly statusAt: Date
  readonly hidden: boolean
  readonly readCount: number
  readonly unreadCount: number
  readonly dropped: number
  readonly unreadSince: Date | null
  readonly lastChatAt: Date | null
}

const tokenColumns = { id: extTokens.id, sellerId: extTokens.sellerId, createdAt: extTokens.createdAt, lastUsedAt: extTokens.lastUsedAt, revokedAt: extTokens.revokedAt }
const bindingColumns = { id: extBindings.id, videoId: extBindings.videoId, broadcastId: extBindings.broadcastId, how: extBindings.how, linkedAt: extBindings.linkedAt }

// ── 연결 코드 ──────────────────────────────────────────────────────────────

/** 판매자의 아직 쓰지 않은 코드를 지우고(새 코드 하나만 살아 있게) 새 코드를 넣는다 */
export async function replaceCode(db: Db, row: { codeHash: string; sellerId: string; accountId: string; now: Date; expiresAt: Date }): Promise<void> {
  await db.delete(extCodes).where(and(eq(extCodes.sellerId, row.sellerId), isNull(extCodes.usedAt)))
  await db.insert(extCodes).values({ codeHash: row.codeHash, sellerId: row.sellerId, accountId: row.accountId, createdAt: row.now, expiresAt: row.expiresAt })
}

/** 코드를 쓴다: 살아 있는(쓰지 않았고 기한 안) 코드면 쓴 것으로 표시하고 판매자를 돌려준다. 아니면 null */
export async function useCode(db: Db, codeHash: string, now: Date): Promise<{ sellerId: string; accountId: string } | null> {
  const rows = await db
    .update(extCodes)
    .set({ usedAt: now })
    .where(and(eq(extCodes.codeHash, codeHash), isNull(extCodes.usedAt)))
    .returning({ sellerId: extCodes.sellerId, accountId: extCodes.accountId, expiresAt: extCodes.expiresAt })
  const row = rows[0]
  if (row === undefined || row.expiresAt.getTime() <= now.getTime()) return null
  return { sellerId: row.sellerId, accountId: row.accountId }
}

// ── 토큰 ──────────────────────────────────────────────────────────────────

export async function activeToken(db: Db, sellerId: string): Promise<TokenRow | null> {
  const rows = await db
    .select(tokenColumns)
    .from(extTokens)
    .where(and(eq(extTokens.sellerId, sellerId), isNull(extTokens.revokedAt)))
    .limit(1)
  return rows[0] ?? null
}

export async function tokenByHash(db: Db, tokenHash: string): Promise<TokenRow | null> {
  const rows = await db.select(tokenColumns).from(extTokens).where(eq(extTokens.tokenHash, tokenHash)).limit(1)
  return rows[0] ?? null
}

/** 판매자의 살아 있는 토큰을 끊는다 (끊은 토큰 ID — 없으면 null) */
export async function revokeActive(db: Db, sellerId: string, reason: RevokeReason, now: Date): Promise<string | null> {
  const rows = await db
    .update(extTokens)
    .set({ revokedAt: now, revokedReason: reason })
    .where(and(eq(extTokens.sellerId, sellerId), isNull(extTokens.revokedAt)))
    .returning({ id: extTokens.id })
  return rows[0]?.id ?? null
}

/** 이 토큰이 아직 살아 있고 마지막 사용이 before보다 이르면 30일 쓰지 않음으로 끊는다 */
export async function revokeIdle(db: Db, sellerId: string, tokenId: string, before: Date, now: Date): Promise<void> {
  await db
    .update(extTokens)
    .set({ revokedAt: now, revokedReason: 'IDLE' })
    .where(and(eq(extTokens.sellerId, sellerId), eq(extTokens.id, tokenId), isNull(extTokens.revokedAt), lt(extTokens.lastUsedAt, before)))
}

export async function insertToken(db: Db, row: { id: string; sellerId: string; tokenHash: string; createdBy: string; now: Date }): Promise<void> {
  await db.insert(extTokens).values({ id: row.id, sellerId: row.sellerId, tokenHash: row.tokenHash, createdAt: row.now, createdBy: row.createdBy, lastUsedAt: row.now })
}

export async function touchToken(db: Db, sellerId: string, tokenId: string, now: Date): Promise<void> {
  await db
    .update(extTokens)
    .set({ lastUsedAt: now })
    .where(and(eq(extTokens.sellerId, sellerId), eq(extTokens.id, tokenId), isNull(extTokens.revokedAt)))
}

// ── 회차 잇기 ──────────────────────────────────────────────────────────────

export async function bindingOfVideo(db: Db, sellerId: string, videoId: string): Promise<BindingRow | null> {
  const rows = await db
    .select(bindingColumns)
    .from(extBindings)
    .where(and(eq(extBindings.sellerId, sellerId), eq(extBindings.videoId, videoId), isNull(extBindings.unboundAt)))
    .limit(1)
  return rows[0] ?? null
}

export async function bindingOfBroadcast(db: Db, sellerId: string, broadcastId: string): Promise<BindingRow | null> {
  const rows = await db
    .select(bindingColumns)
    .from(extBindings)
    .where(and(eq(extBindings.sellerId, sellerId), eq(extBindings.broadcastId, broadcastId), isNull(extBindings.unboundAt)))
    .limit(1)
  return rows[0] ?? null
}

export async function activeBindings(db: Db, sellerId: string): Promise<BindingRow[]> {
  return db
    .select(bindingColumns)
    .from(extBindings)
    .where(and(eq(extBindings.sellerId, sellerId), isNull(extBindings.unboundAt)))
}

export async function unbind(db: Db, sellerId: string, bindingId: string, now: Date): Promise<void> {
  await db
    .update(extBindings)
    .set({ unboundAt: now })
    .where(and(eq(extBindings.sellerId, sellerId), eq(extBindings.id, bindingId), isNull(extBindings.unboundAt)))
}

export async function insertBinding(db: Db, row: { id: string; sellerId: string; tokenId: string; videoId: string; broadcastId: string; how: 'AUTO' | 'PICK'; linkedAt: Date }): Promise<void> {
  await db.insert(extBindings).values(row)
}

export async function bindingById(db: Db, sellerId: string, bindingId: string): Promise<BindingRow | null> {
  const rows = await db
    .select(bindingColumns)
    .from(extBindings)
    .where(and(eq(extBindings.sellerId, sellerId), eq(extBindings.id, bindingId), isNull(extBindings.unboundAt)))
    .limit(1)
  return rows[0] ?? null
}

// ── 상태 ──────────────────────────────────────────────────────────────────

export async function readStatus(db: Db, sellerId: string): Promise<StatusRow | null> {
  const rows = await db
    .select({
      tokenId: extStatus.tokenId,
      videoId: extStatus.videoId,
      statusAt: extStatus.statusAt,
      hidden: extStatus.hidden,
      readCount: extStatus.readCount,
      unreadCount: extStatus.unreadCount,
      dropped: extStatus.dropped,
      unreadSince: extStatus.unreadSince,
      lastChatAt: extStatus.lastChatAt,
    })
    .from(extStatus)
    .where(eq(extStatus.sellerId, sellerId))
    .limit(1)
  return rows[0] ?? null
}

export async function writeStatus(db: Db, sellerId: string, row: StatusRow): Promise<void> {
  await db
    .insert(extStatus)
    .values({ sellerId, ...row })
    .onConflictDoUpdate({ target: extStatus.sellerId, set: { ...row } })
}

export async function markChatReceived(db: Db, sellerId: string, now: Date): Promise<void> {
  await db.update(extStatus).set({ lastChatAt: now, unreadSince: null }).where(eq(extStatus.sellerId, sellerId))
}

export async function clearStatus(db: Db, sellerId: string): Promise<void> {
  await db.delete(extStatus).where(eq(extStatus.sellerId, sellerId))
}
