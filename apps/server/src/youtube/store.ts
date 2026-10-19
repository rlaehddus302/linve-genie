// 유튜브 연결 표의 질의 (방송 잇기·수집기·우리 메시지·알림). 모두 판매자 ID 조건을 건다(SYS-02).
// 워커가 판매자를 가리지 않고 할 일을 찾는 질의(수집할 것·요약할 것)는 그 행의 판매자 ID를 함께 돌려주고, 이어서 쓰는 질의는 그 판매자 ID를 건다.
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { broadcasts, scopes, youtubeCollectors, youtubeConnections, youtubeLinks, youtubeNotices, youtubeOwnMessages } from '../db/schema.ts'

// ── 방송 잇기 ────────────────────────────────────────────────────────────

export interface LinkRow {
  readonly id: string
  readonly sellerId: string
  readonly scopeId: string
  readonly broadcastId: string
  readonly videoId: string
  readonly liveChatId: string
  readonly channelId: string
  readonly linkedAt: Date
  readonly linkedBy: string | null
  readonly requestId: string | null
  readonly unlinkedAt: Date | null
  readonly chatEndedAt: Date | null
  readonly summaryAt: Date | null
}

const linkColumns = {
  id: youtubeLinks.id,
  sellerId: youtubeLinks.sellerId,
  scopeId: youtubeLinks.scopeId,
  broadcastId: youtubeLinks.broadcastId,
  videoId: youtubeLinks.videoId,
  liveChatId: youtubeLinks.liveChatId,
  channelId: youtubeLinks.channelId,
  linkedAt: youtubeLinks.linkedAt,
  linkedBy: youtubeLinks.linkedBy,
  requestId: youtubeLinks.requestId,
  unlinkedAt: youtubeLinks.unlinkedAt,
  chatEndedAt: youtubeLinks.chatEndedAt,
  summaryAt: youtubeLinks.summaryAt,
}

/** 그 방송에 지금 이어진 유튜브 방송 */
export async function activeLink(db: Db, sellerId: string, broadcastId: string): Promise<LinkRow | null> {
  const rows = await db
    .select(linkColumns)
    .from(youtubeLinks)
    .where(and(eq(youtubeLinks.sellerId, sellerId), eq(youtubeLinks.broadcastId, broadcastId), isNull(youtubeLinks.unlinkedAt)))
    .limit(1)
  return rows[0] ?? null
}

export async function linkById(db: Db, sellerId: string, linkId: string): Promise<LinkRow | null> {
  const rows = await db
    .select(linkColumns)
    .from(youtubeLinks)
    .where(and(eq(youtubeLinks.sellerId, sellerId), eq(youtubeLinks.id, linkId)))
    .limit(1)
  return rows[0] ?? null
}

/** 그 방송의 가장 최근 연결 (끊은 것 포함 — 발송함 행의 채팅 ID 등) */
export async function latestLink(db: Db, sellerId: string, broadcastId: string): Promise<LinkRow | null> {
  const rows = await db
    .select(linkColumns)
    .from(youtubeLinks)
    .where(and(eq(youtubeLinks.sellerId, sellerId), eq(youtubeLinks.broadcastId, broadcastId)))
    .orderBy(desc(youtubeLinks.linkedAt))
    .limit(1)
  return rows[0] ?? null
}

export async function linkByRequest(db: Db, sellerId: string, requestId: string): Promise<LinkRow | null> {
  const rows = await db
    .select(linkColumns)
    .from(youtubeLinks)
    .where(and(eq(youtubeLinks.sellerId, sellerId), eq(youtubeLinks.requestId, requestId)))
    .limit(1)
  return rows[0] ?? null
}

/** 그 영상이 이어진, 끝나지 않은 이 판매자의 라이브찜 방송 (끊지 않은 연결) */
export async function openLinksForVideo(db: Db, sellerId: string, videoIds: readonly string[]): Promise<{ videoId: string; broadcastId: string }[]> {
  if (videoIds.length === 0) return []
  return db
    .select({ videoId: youtubeLinks.videoId, broadcastId: youtubeLinks.broadcastId })
    .from(youtubeLinks)
    .innerJoin(broadcasts, and(eq(broadcasts.id, youtubeLinks.broadcastId), eq(broadcasts.sellerId, sellerId)))
    .where(and(eq(youtubeLinks.sellerId, sellerId), inArray(youtubeLinks.videoId, [...videoIds]), isNull(youtubeLinks.unlinkedAt), isNull(broadcasts.endedAt)))
}

export async function insertLink(
  db: Db,
  row: { id: string; sellerId: string; scopeId: string; broadcastId: string; videoId: string; liveChatId: string; channelId: string; linkedBy: string; requestId: string | null; now: Date },
): Promise<void> {
  await db.insert(youtubeLinks).values({
    id: row.id,
    sellerId: row.sellerId,
    scopeId: row.scopeId,
    broadcastId: row.broadcastId,
    videoId: row.videoId,
    liveChatId: row.liveChatId,
    channelId: row.channelId,
    linkedAt: row.now,
    linkedBy: row.linkedBy,
    requestId: row.requestId,
  })
  await db.insert(youtubeCollectors).values({
    linkId: row.id,
    sellerId: row.sellerId,
    scopeId: row.scopeId,
    broadcastId: row.broadcastId,
    mode: 'STREAM',
    status: 'STARTING',
    updatedAt: row.now,
  })
}

export async function unlinkRow(db: Db, sellerId: string, linkId: string, by: string | null, now: Date): Promise<boolean> {
  const rows = await db
    .update(youtubeLinks)
    .set({ unlinkedAt: now, unlinkedBy: by })
    .where(and(eq(youtubeLinks.sellerId, sellerId), eq(youtubeLinks.id, linkId), isNull(youtubeLinks.unlinkedAt)))
    .returning({ id: youtubeLinks.id })
  return rows.length > 0
}

export async function markChatEnded(db: Db, sellerId: string, linkId: string, now: Date): Promise<void> {
  await db
    .update(youtubeLinks)
    .set({ chatEndedAt: now })
    .where(and(eq(youtubeLinks.sellerId, sellerId), eq(youtubeLinks.id, linkId), isNull(youtubeLinks.chatEndedAt)))
}

export interface SummaryCandidate {
  readonly link: LinkRow
  readonly date: string
  readonly endedAt: Date
}

/** 방송 후 요약을 만들 때가 된 연결: 끊지 않은 연결, 요약을 아직 만들지 않음, 실제 방송, 끝낸 지 delay 지남 */
export async function summaryCandidates(db: Db, endedBefore: Date): Promise<SummaryCandidate[]> {
  const rows = await db
    .select({ ...linkColumns, date: broadcasts.date, endedAt: broadcasts.endedAt })
    .from(youtubeLinks)
    .innerJoin(broadcasts, and(eq(broadcasts.id, youtubeLinks.broadcastId), eq(broadcasts.sellerId, youtubeLinks.sellerId)))
    .innerJoin(scopes, and(eq(scopes.id, broadcasts.scopeId), eq(scopes.sellerId, youtubeLinks.sellerId), eq(scopes.rehearsal, false), isNull(scopes.sealedAt)))
    .where(and(isNull(youtubeLinks.unlinkedAt), isNull(youtubeLinks.summaryAt), isNotNull(broadcasts.endedAt), lte(broadcasts.endedAt, endedBefore)))
  return rows.map(({ date, endedAt, ...link }) => ({ link, date, endedAt: endedAt as Date }))
}

export async function markSummaryDone(db: Db, sellerId: string, linkId: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(youtubeLinks)
    .set({ summaryAt: now })
    .where(and(eq(youtubeLinks.sellerId, sellerId), eq(youtubeLinks.id, linkId), isNull(youtubeLinks.summaryAt)))
    .returning({ id: youtubeLinks.id })
  return rows.length > 0
}

// ── 수집기 ───────────────────────────────────────────────────────────────

export interface CollectorRow {
  readonly linkId: string
  readonly sellerId: string
  readonly scopeId: string
  readonly broadcastId: string
  readonly pageToken: string | null
  readonly mode: string
  readonly status: string
  readonly reason: string | null
  readonly firstDone: boolean
  readonly gap: boolean
  readonly skippedBeforeLink: number
  readonly recorded: number
  readonly lastMessageAt: Date | null
  readonly resumeAt: Date | null
  readonly leaseOwner: string | null
  readonly leaseUntil: Date | null
}

const collectorColumns = {
  linkId: youtubeCollectors.linkId,
  sellerId: youtubeCollectors.sellerId,
  scopeId: youtubeCollectors.scopeId,
  broadcastId: youtubeCollectors.broadcastId,
  pageToken: youtubeCollectors.pageToken,
  mode: youtubeCollectors.mode,
  status: youtubeCollectors.status,
  reason: youtubeCollectors.reason,
  firstDone: youtubeCollectors.firstDone,
  gap: youtubeCollectors.gap,
  skippedBeforeLink: youtubeCollectors.skippedBeforeLink,
  recorded: youtubeCollectors.recorded,
  lastMessageAt: youtubeCollectors.lastMessageAt,
  resumeAt: youtubeCollectors.resumeAt,
  leaseOwner: youtubeCollectors.leaseOwner,
  leaseUntil: youtubeCollectors.leaseUntil,
}

export async function collectorOf(db: Db, sellerId: string, linkId: string): Promise<CollectorRow | null> {
  const rows = await db
    .select(collectorColumns)
    .from(youtubeCollectors)
    .where(and(eq(youtubeCollectors.sellerId, sellerId), eq(youtubeCollectors.linkId, linkId)))
    .limit(1)
  return rows[0] ?? null
}

/** 그 판매자의 수집기 전부 (상태 알림·멈춤) */
export function sellerCollectors(db: Db, sellerId: string): Promise<CollectorRow[]> {
  return db.select(collectorColumns).from(youtubeCollectors).where(eq(youtubeCollectors.sellerId, sellerId))
}

/** 돌 수 있는 수집기 후보: 끊지 않은 연결, 끝나지 않은 상태, 임대가 비었거나 지났거나 내 것 */
export async function collectorCandidates(db: Db, owner: string, now: Date): Promise<CollectorRow[]> {
  return db
    .select(collectorColumns)
    .from(youtubeCollectors)
    .innerJoin(youtubeLinks, and(eq(youtubeLinks.id, youtubeCollectors.linkId), eq(youtubeLinks.sellerId, youtubeCollectors.sellerId), isNull(youtubeLinks.unlinkedAt)))
    .where(
      and(
        inArray(youtubeCollectors.status, ['STARTING', 'LIVE', 'RETRYING', 'STOPPED']),
        or(isNull(youtubeCollectors.leaseUntil), lt(youtubeCollectors.leaseUntil, now), eq(youtubeCollectors.leaseOwner, owner)),
      ),
    )
    .orderBy(asc(youtubeCollectors.updatedAt))
}

/** 임대 잡기 (한 문장 — 둘이 동시에 잡아도 하나만 행을 돌려받는다) */
export async function acquireLease(db: Db, sellerId: string, linkId: string, owner: string, now: Date, until: Date): Promise<boolean> {
  const rows = await db
    .update(youtubeCollectors)
    .set({ leaseOwner: owner, leaseUntil: until })
    .where(
      and(
        eq(youtubeCollectors.sellerId, sellerId),
        eq(youtubeCollectors.linkId, linkId),
        or(isNull(youtubeCollectors.leaseUntil), lt(youtubeCollectors.leaseUntil, now), eq(youtubeCollectors.leaseOwner, owner)),
      ),
    )
    .returning({ linkId: youtubeCollectors.linkId })
  return rows.length > 0
}

/** 임대 늘리기 (내 것일 때만). 잃었으면 false */
export async function renewLease(db: Db, sellerId: string, linkId: string, owner: string, until: Date): Promise<boolean> {
  const rows = await db
    .update(youtubeCollectors)
    .set({ leaseUntil: until })
    .where(and(eq(youtubeCollectors.sellerId, sellerId), eq(youtubeCollectors.linkId, linkId), eq(youtubeCollectors.leaseOwner, owner)))
    .returning({ linkId: youtubeCollectors.linkId })
  return rows.length > 0
}

export async function releaseLease(db: Db, sellerId: string, linkId: string, owner: string): Promise<void> {
  await db
    .update(youtubeCollectors)
    .set({ leaseOwner: null, leaseUntil: null })
    .where(and(eq(youtubeCollectors.sellerId, sellerId), eq(youtubeCollectors.linkId, linkId), eq(youtubeCollectors.leaseOwner, owner)))
}

export interface CollectorChange {
  readonly pageToken?: string | null
  readonly mode?: string
  readonly status?: string
  readonly reason?: string | null
  readonly firstDone?: boolean
  readonly gap?: boolean
  readonly resumeAt?: Date | null
  readonly lastMessageAt?: Date | null
}

/**
 * 수집기 상태를 바꾼다. owner를 주면 그 임대를 가진 때만(다른 서버가 이어받았으면 바꾸지 않는다). 더할 수(addRecorded·addSkipped)는 칸에 더한다.
 * 바뀌었으면 true
 */
export async function updateCollector(
  db: Db,
  sellerId: string,
  linkId: string,
  change: CollectorChange & { readonly addRecorded?: number; readonly addSkipped?: number },
  now: Date,
  owner?: string,
): Promise<boolean> {
  const { addRecorded, addSkipped, ...rest } = change
  const rows = await db
    .update(youtubeCollectors)
    .set({
      ...rest,
      ...(addRecorded === undefined || addRecorded === 0 ? {} : { recorded: sql`${youtubeCollectors.recorded} + ${addRecorded}` }),
      ...(addSkipped === undefined || addSkipped === 0 ? {} : { skippedBeforeLink: sql`${youtubeCollectors.skippedBeforeLink} + ${addSkipped}` }),
      updatedAt: now,
    })
    .where(and(eq(youtubeCollectors.sellerId, sellerId), eq(youtubeCollectors.linkId, linkId), ...(owner === undefined ? [] : [eq(youtubeCollectors.leaseOwner, owner)])))
    .returning({ linkId: youtubeCollectors.linkId })
  return rows.length > 0
}

/** 지금 연결 (수집기·발송함이 채널을 확인한다) */
export async function connectionChannel(db: Db, sellerId: string): Promise<{ channelId: string; status: string; canPublish: boolean } | null> {
  const rows = await db
    .select({ channelId: youtubeConnections.channelId, status: youtubeConnections.status, canPublish: youtubeConnections.canPublish })
    .from(youtubeConnections)
    .where(eq(youtubeConnections.sellerId, sellerId))
    .limit(1)
  return rows[0] ?? null
}

// ── 우리 채널이 쓴 메시지 (게시 확인) ──────────────────────────────────────

export async function insertOwnMessage(db: Db, row: { sellerId: string; scopeId: string; liveChatId: string; messageId: string; text: string; publishedAt: Date }): Promise<void> {
  await db.insert(youtubeOwnMessages).values(row).onConflictDoNothing({ target: [youtubeOwnMessages.sellerId, youtubeOwnMessages.messageId] })
}

/** 그 채팅에 since 뒤에 우리 채널이 쓴, 글이 같은 메시지 */
export async function findOwnMessage(db: Db, sellerId: string, liveChatId: string, text: string, since: Date): Promise<string | null> {
  const rows = await db
    .select({ messageId: youtubeOwnMessages.messageId })
    .from(youtubeOwnMessages)
    .where(and(eq(youtubeOwnMessages.sellerId, sellerId), eq(youtubeOwnMessages.liveChatId, liveChatId), eq(youtubeOwnMessages.text, text), gte(youtubeOwnMessages.publishedAt, since)))
    .orderBy(asc(youtubeOwnMessages.publishedAt))
    .limit(1)
  return rows[0]?.messageId ?? null
}

// ── 지운 메시지·차단 알림 ──────────────────────────────────────────────────

export interface NoticeRow {
  readonly id: number
  readonly broadcastId: string
  readonly kind: string
  readonly messageId: string | null
  readonly channelId: string
  readonly nick: string
  readonly wasOrder: boolean
  readonly wasCancel: boolean
  readonly banType: string | null
  readonly banSeconds: number | null
  readonly createdAt: Date
}

/** 알림 하나 (같은 삭제·차단이면 아무 일도 없다). 새로 남겼으면 그 행 */
export async function insertNotice(
  db: Db,
  row: {
    sellerId: string
    scopeId: string
    broadcastId: string
    kind: 'DELETED' | 'BANNED'
    dedupeKey: string
    messageId: string | null
    channelId: string
    nick: string
    wasOrder: boolean
    wasCancel: boolean
    banType: string | null
    banSeconds: number | null
    now: Date
  },
): Promise<NoticeRow | null> {
  const { now, ...values } = row
  const rows = await db
    .insert(youtubeNotices)
    .values({ ...values, createdAt: now })
    .onConflictDoNothing({ target: [youtubeNotices.sellerId, youtubeNotices.dedupeKey] })
    .returning({
      id: youtubeNotices.id,
      broadcastId: youtubeNotices.broadcastId,
      kind: youtubeNotices.kind,
      messageId: youtubeNotices.messageId,
      channelId: youtubeNotices.channelId,
      nick: youtubeNotices.nick,
      wasOrder: youtubeNotices.wasOrder,
      wasCancel: youtubeNotices.wasCancel,
      banType: youtubeNotices.banType,
      banSeconds: youtubeNotices.banSeconds,
      createdAt: youtubeNotices.createdAt,
    })
  return rows[0] ?? null
}

export function scopeNotices(db: Db, sellerId: string, scopeId: string): Promise<NoticeRow[]> {
  return db
    .select({
      id: youtubeNotices.id,
      broadcastId: youtubeNotices.broadcastId,
      kind: youtubeNotices.kind,
      messageId: youtubeNotices.messageId,
      channelId: youtubeNotices.channelId,
      nick: youtubeNotices.nick,
      wasOrder: youtubeNotices.wasOrder,
      wasCancel: youtubeNotices.wasCancel,
      banType: youtubeNotices.banType,
      banSeconds: youtubeNotices.banSeconds,
      createdAt: youtubeNotices.createdAt,
    })
    .from(youtubeNotices)
    .where(and(eq(youtubeNotices.sellerId, sellerId), eq(youtubeNotices.scopeId, scopeId)))
    .orderBy(asc(youtubeNotices.id))
}
