// 크롬 확장 저장소 (X1 YT-10, D-X1-07·08·10·11). 모든 질의에 판매자 ID 조건을 건다(토큰 해시로 찾는 것만 예외 — 찾은 행의 판매자로 이어 간다).
// 코드·토큰은 해시로만 둔다. 채팅 내용·닉네임은 여기 없다.
import { and, eq, isNull, lt, sql } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { broadcasts, extBindings, extCodes, extPostLanes, extPostSettings, extStatus, extTokens, scopes, youtubeConnections } from '../db/schema.ts'

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

/**
 * 끝나지 않은 회차에 이어진 살아 있는 묶음 (한 번의 조회 — RA-V3-010: 보고마다 묶음 수만큼 방송을 따로 찾지 않는다).
 * 방송·범위 모두 그 판매자 것만 (findBroadcast와 같은 조건)
 */
export async function liveBindings(db: Db, sellerId: string): Promise<BindingRow[]> {
  return db
    .select(bindingColumns)
    .from(extBindings)
    .innerJoin(broadcasts, and(eq(broadcasts.sellerId, sellerId), eq(broadcasts.id, extBindings.broadcastId)))
    .innerJoin(scopes, and(eq(scopes.id, broadcasts.scopeId), eq(scopes.sellerId, sellerId)))
    .where(and(eq(extBindings.sellerId, sellerId), isNull(extBindings.unboundAt), isNull(broadcasts.endedAt)))
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

// ── 감사 올리기 (X1 YT-10 AC11~AC17) ─────────────────────────────────────

/** 확장으로 감사 올리기를 켠 시각 (꺼져 있으면 null) */
export async function postEnabledAt(db: Db, sellerId: string): Promise<Date | null> {
  const rows = await db.select({ enabledAt: extPostSettings.enabledAt }).from(extPostSettings).where(eq(extPostSettings.sellerId, sellerId)).limit(1)
  return rows[0]?.enabledAt ?? null
}

/** 켜기는 꺼져 있을 때만 시각·계정을 적는다(이미 켠 것을 다시 켜도 그대로), 끄면 지운다 */
export async function writePostEnabled(db: Db, sellerId: string, enabled: boolean, accountId: string, now: Date): Promise<void> {
  await db
    .insert(extPostSettings)
    .values({ sellerId, enabledAt: enabled ? now : null, enabledBy: enabled ? accountId : null, updatedAt: now })
    .onConflictDoUpdate({
      target: extPostSettings.sellerId,
      set: enabled
        ? { enabledAt: sql`coalesce(${extPostSettings.enabledAt}, ${now.toISOString()}::timestamptz)`, enabledBy: sql`coalesce(${extPostSettings.enabledBy}, ${accountId})`, updatedAt: now }
        : { enabledAt: null, enabledBy: null, updatedAt: now },
    })
}

export interface LaneRow {
  readonly broadcastId: string
  readonly fails: number
  readonly pausedAt: Date | null
  readonly ownerProblemAt: Date | null
  readonly ownerChannelId: string | null
  readonly lastTakenAt: Date | null
  readonly lastDoneAt: Date | null
}

const laneColumns = {
  broadcastId: extPostLanes.broadcastId,
  fails: extPostLanes.fails,
  pausedAt: extPostLanes.pausedAt,
  ownerProblemAt: extPostLanes.ownerProblemAt,
  ownerChannelId: extPostLanes.ownerChannelId,
  lastTakenAt: extPostLanes.lastTakenAt,
  lastDoneAt: extPostLanes.lastDoneAt,
}

export async function readLane(db: Db, sellerId: string, broadcastId: string): Promise<LaneRow | null> {
  const rows = await db
    .select(laneColumns)
    .from(extPostLanes)
    .where(and(eq(extPostLanes.sellerId, sellerId), eq(extPostLanes.broadcastId, broadcastId)))
    .limit(1)
  return rows[0] ?? null
}

export async function lanesOf(db: Db, sellerId: string): Promise<LaneRow[]> {
  return db.select(laneColumns).from(extPostLanes).where(eq(extPostLanes.sellerId, sellerId))
}

export type LaneChange = Partial<Omit<LaneRow, 'broadcastId'>>

export async function writeLane(db: Db, sellerId: string, broadcastId: string, change: LaneChange): Promise<void> {
  await db
    .insert(extPostLanes)
    .values({ sellerId, broadcastId, ...change })
    .onConflictDoUpdate({ target: [extPostLanes.sellerId, extPostLanes.broadcastId], set: { ...change } })
}

/** 실패 한 번 더 (한 문장으로). 늘어난 수 */
export async function addLaneFail(db: Db, sellerId: string, broadcastId: string, now: Date, max: number): Promise<number> {
  const rows = await db
    .insert(extPostLanes)
    .values({ sellerId, broadcastId, fails: 1, lastDoneAt: now, pausedAt: max <= 1 ? now : null })
    .onConflictDoUpdate({
      target: [extPostLanes.sellerId, extPostLanes.broadcastId],
      set: {
        fails: sql`${extPostLanes.fails} + 1`,
        lastDoneAt: now,
        pausedAt: sql`case when ${extPostLanes.fails} + 1 >= ${max} then coalesce(${extPostLanes.pausedAt}, ${now.toISOString()}::timestamptz) else ${extPostLanes.pausedAt} end`,
      },
    })
    .returning({ fails: extPostLanes.fails })
  return rows[0]?.fails ?? 0
}

/** 유튜브 연결의 채널·실시간 채팅 게시 동의 시각 (없으면 null) */
export async function youtubeChannelOf(db: Db, sellerId: string): Promise<{ channelId: string; consentLiveChatAt: Date | null } | null> {
  const rows = await db
    .select({ channelId: youtubeConnections.channelId, consentLiveChatAt: youtubeConnections.consentLiveChatAt })
    .from(youtubeConnections)
    .where(eq(youtubeConnections.sellerId, sellerId))
    .limit(1)
  return rows[0] ?? null
}
