// 인스타그램·라이브 연결 저장소 (SYS-02). 모든 질의에 판매자 ID 조건을 건다(웹훅의 계정 ID → 판매자 찾기만 예외 — 그 결과로 판매자를 정한다).
// 트랜잭션 안에서는 트랜잭션 객체(tx)를 넘긴다.
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { accounts, broadcasts, events, igConnections, igDmRows, igDmSends, igOauthStates, liveLinkMoves, liveLinks, liveRequests, liveUnlinked, outbox, scopes } from '../db/schema.ts'

// ── 계정 연결 ────────────────────────────────────────────────────────────

export type ConnectionState = 'CONNECTED' | 'RECONNECT_NEEDED'

export interface ConnectionRow {
  readonly sellerId: string
  readonly login: string
  readonly accountId: string
  readonly username: string
  readonly accountType: string | null
  readonly pageId: string | null
  readonly tokensEnc: string
  readonly tokenObtainedAt: Date
  readonly tokenExpiresAt: Date | null
  readonly permComments: boolean
  readonly permMessages: boolean
  readonly status: string
  readonly consentAt: Date | null
  readonly consentBy: string | null
  readonly malformedCount: number
}

const connectionColumns = {
  sellerId: igConnections.sellerId,
  login: igConnections.login,
  accountId: igConnections.accountId,
  username: igConnections.username,
  accountType: igConnections.accountType,
  pageId: igConnections.pageId,
  tokensEnc: igConnections.tokensEnc,
  tokenObtainedAt: igConnections.tokenObtainedAt,
  tokenExpiresAt: igConnections.tokenExpiresAt,
  permComments: igConnections.permComments,
  permMessages: igConnections.permMessages,
  status: igConnections.status,
  consentAt: igConnections.consentAt,
  consentBy: igConnections.consentBy,
  malformedCount: igConnections.malformedCount,
}

export async function findConnection(db: Db, sellerId: string, forUpdate = false): Promise<ConnectionRow | null> {
  const query = db.select(connectionColumns).from(igConnections).where(eq(igConnections.sellerId, sellerId)).limit(1)
  const rows = forUpdate ? await query.for('update') : await query
  return rows[0] ?? null
}

/** 웹훅 entry[].id(계정 ID) → 그 계정을 연결한 판매자의 연결 (없으면 null) */
export async function connectionByAccount(db: Db, accountId: string): Promise<ConnectionRow | null> {
  const rows = await db.select(connectionColumns).from(igConnections).where(eq(igConnections.accountId, accountId)).limit(1)
  return rows[0] ?? null
}

/** 동의를 켠 로그인 계정의 아이디 */
export async function loginIdOf(db: Db, sellerId: string, accountId: string): Promise<string | null> {
  const rows = await db
    .select({ loginId: accounts.loginId })
    .from(accounts)
    .where(and(eq(accounts.sellerId, sellerId), eq(accounts.id, accountId)))
    .limit(1)
  return rows[0]?.loginId ?? null
}

export interface NewConnection {
  readonly sellerId: string
  readonly login: string
  readonly accountId: string
  readonly username: string
  readonly accountType: string | null
  readonly pageId: string | null
  readonly tokensEnc: string
  readonly tokenObtainedAt: Date
  readonly tokenExpiresAt: Date | null
  readonly permComments: boolean
  readonly permMessages: boolean
  readonly now: Date
}

export async function insertConnection(db: Db, row: NewConnection): Promise<void> {
  await db.insert(igConnections).values({
    sellerId: row.sellerId,
    login: row.login,
    accountId: row.accountId,
    username: row.username,
    accountType: row.accountType,
    pageId: row.pageId,
    tokensEnc: row.tokensEnc,
    tokenObtainedAt: row.tokenObtainedAt,
    tokenExpiresAt: row.tokenExpiresAt,
    permComments: row.permComments,
    permMessages: row.permMessages,
    status: 'CONNECTED',
    connectedAt: row.now,
    updatedAt: row.now,
  })
}

/** 같은 계정 다시 연결: 토큰·권한·상태만 바꾼다 (동의는 그대로) */
export async function refreshConnection(db: Db, row: NewConnection): Promise<void> {
  await db
    .update(igConnections)
    .set({
      login: row.login,
      username: row.username,
      accountType: row.accountType,
      pageId: row.pageId,
      tokensEnc: row.tokensEnc,
      tokenObtainedAt: row.tokenObtainedAt,
      tokenExpiresAt: row.tokenExpiresAt,
      permComments: row.permComments,
      permMessages: row.permMessages,
      status: 'CONNECTED',
      updatedAt: row.now,
    })
    .where(and(eq(igConnections.sellerId, row.sellerId), eq(igConnections.accountId, row.accountId)))
}

export async function updateTokens(db: Db, sellerId: string, tokensEnc: string, obtainedAt: Date, expiresAt: Date | null, now: Date): Promise<void> {
  await db.update(igConnections).set({ tokensEnc, tokenObtainedAt: obtainedAt, tokenExpiresAt: expiresAt, updatedAt: now }).where(eq(igConnections.sellerId, sellerId))
}

/** "다시 연결 필요"로 (연결됨이었을 때만). 바꿨으면 true */
export async function markReconnectNeeded(db: Db, sellerId: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(igConnections)
    .set({ status: 'RECONNECT_NEEDED', updatedAt: now })
    .where(and(eq(igConnections.sellerId, sellerId), eq(igConnections.status, 'CONNECTED')))
    .returning({ sellerId: igConnections.sellerId })
  return rows.length > 0
}

export async function setConsent(db: Db, sellerId: string, consentAt: Date | null, consentBy: string | null, now: Date): Promise<void> {
  await db.update(igConnections).set({ consentAt, consentBy, updatedAt: now }).where(eq(igConnections.sellerId, sellerId))
}

export async function deleteConnection(db: Db, sellerId: string): Promise<boolean> {
  const rows = await db.delete(igConnections).where(eq(igConnections.sellerId, sellerId)).returning({ sellerId: igConnections.sellerId })
  return rows.length > 0
}

export async function bumpSellerMalformed(db: Db, sellerId: string): Promise<void> {
  await db
    .update(igConnections)
    .set({ malformedCount: sql`${igConnections.malformedCount} + 1` })
    .where(eq(igConnections.sellerId, sellerId))
}

// ── OAuth state ──────────────────────────────────────────────────────────

export interface StateRow {
  readonly id: number
  readonly sellerId: string
  readonly accountId: string
  readonly sessionHash: string
  readonly purpose: string
  readonly login: string
  readonly expiresAt: Date
  readonly usedAt: Date | null
}

export async function insertState(
  db: Db,
  row: { sellerId: string; accountId: string; sessionHash: string; stateHash: string; purpose: string; login: string; expiresAt: Date; now: Date },
): Promise<void> {
  // 그 판매자의 지난 state는 지운다 (표가 끝없이 자라지 않게)
  await db.delete(igOauthStates).where(and(eq(igOauthStates.sellerId, row.sellerId), lte(igOauthStates.expiresAt, row.now)))
  await db.insert(igOauthStates).values({
    sellerId: row.sellerId,
    accountId: row.accountId,
    sessionHash: row.sessionHash,
    stateHash: row.stateHash,
    purpose: row.purpose,
    login: row.login,
    expiresAt: row.expiresAt,
    createdAt: row.now,
  })
}

export async function findState(db: Db, hash: string): Promise<StateRow | null> {
  const rows = await db
    .select({
      id: igOauthStates.id,
      sellerId: igOauthStates.sellerId,
      accountId: igOauthStates.accountId,
      sessionHash: igOauthStates.sessionHash,
      purpose: igOauthStates.purpose,
      login: igOauthStates.login,
      expiresAt: igOauthStates.expiresAt,
      usedAt: igOauthStates.usedAt,
    })
    .from(igOauthStates)
    .where(eq(igOauthStates.stateHash, hash))
    .limit(1)
  return rows[0] ?? null
}

/** state를 한 번만 쓴다 (원자적으로) — 처음 쓰면 true */
export async function useState(db: Db, sellerId: string, id: number, now: Date): Promise<boolean> {
  const rows = await db
    .update(igOauthStates)
    .set({ usedAt: now })
    .where(and(eq(igOauthStates.sellerId, sellerId), eq(igOauthStates.id, id), isNull(igOauthStates.usedAt)))
    .returning({ id: igOauthStates.id })
  return rows.length > 0
}

// ── 라이브 연결 ──────────────────────────────────────────────────────────

export interface LinkRow {
  readonly id: number
  readonly broadcastId: string
  readonly platform: string
  readonly state: string
  readonly liveId: string | null
  readonly accountId: string | null
  readonly actor: string
  readonly actorLoginId: string | null
  readonly linkedAt: Date
  readonly unlinkedAt: Date | null
  readonly lateCount: number
  readonly malformedCount: number
  /** 그 회차가 끝났는지 (broadcast.end 기록됨) */
  readonly ended: boolean
  readonly rehearsal: boolean
  readonly date: string
  readonly scopeId: string
}

const linkColumns = {
  id: liveLinks.id,
  broadcastId: liveLinks.broadcastId,
  platform: liveLinks.platform,
  state: liveLinks.state,
  liveId: liveLinks.liveId,
  accountId: liveLinks.accountId,
  actor: liveLinks.actor,
  actorLoginId: accounts.loginId,
  linkedAt: liveLinks.linkedAt,
  unlinkedAt: liveLinks.unlinkedAt,
  lateCount: liveLinks.lateCount,
  malformedCount: liveLinks.malformedCount,
  ended: sql<boolean>`${broadcasts.endedAt} IS NOT NULL`,
  rehearsal: scopes.rehearsal,
  date: broadcasts.date,
  scopeId: broadcasts.scopeId,
}

function linkQuery(db: Db, sellerId: string) {
  return db
    .select(linkColumns)
    .from(liveLinks)
    .innerJoin(broadcasts, and(eq(broadcasts.id, liveLinks.broadcastId), eq(broadcasts.sellerId, sellerId)))
    .innerJoin(scopes, and(eq(scopes.id, broadcasts.scopeId), eq(scopes.sellerId, sellerId)))
    .leftJoin(accounts, and(eq(accounts.id, liveLinks.actorAccountId), eq(accounts.sellerId, sellerId)))
}

/** 회차의 가장 최근 연결 기록 (없으면 null) */
export async function latestLink(db: Db, sellerId: string, broadcastId: string): Promise<LinkRow | null> {
  const rows = await linkQuery(db, sellerId)
    .where(and(eq(liveLinks.sellerId, sellerId), eq(liveLinks.broadcastId, broadcastId)))
    .orderBy(desc(liveLinks.id))
    .limit(1)
  return rows[0] ?? null
}

/** 판매자의 끊지 않은 연결(WAITING·LINKED) 전부 */
export async function openLinks(db: Db, sellerId: string): Promise<LinkRow[]> {
  return linkQuery(db, sellerId)
    .where(and(eq(liveLinks.sellerId, sellerId), or(eq(liveLinks.state, 'WAITING'), eq(liveLinks.state, 'LINKED'))))
    .orderBy(asc(liveLinks.id))
}

/** 그 라이브에 이어진(LINKED), 끝나지 않은 회차의 연결 */
export async function linkedToLive(db: Db, sellerId: string, liveId: string): Promise<LinkRow[]> {
  return linkQuery(db, sellerId)
    .where(and(eq(liveLinks.sellerId, sellerId), eq(liveLinks.state, 'LINKED'), eq(liveLinks.liveId, liveId), isNull(broadcasts.endedAt)))
    .orderBy(asc(liveLinks.id))
}

/** 판매자의 기다리는(WAITING), 끝나지 않은 실제 회차의 연결 */
export async function waitingLinks(db: Db, sellerId: string): Promise<LinkRow[]> {
  return linkQuery(db, sellerId)
    .where(and(eq(liveLinks.sellerId, sellerId), eq(liveLinks.state, 'WAITING'), isNull(broadcasts.endedAt), eq(scopes.rehearsal, false)))
    .orderBy(asc(liveLinks.id))
}

export async function insertLink(
  db: Db,
  row: {
    sellerId: string
    broadcastId: string
    platform: string
    state: 'WAITING' | 'LINKED'
    liveId: string | null
    accountId: string | null
    actorAccountId: string | null
    now: Date
  },
): Promise<number> {
  const rows = await db
    .insert(liveLinks)
    .values({
      sellerId: row.sellerId,
      broadcastId: row.broadcastId,
      platform: row.platform,
      state: row.state,
      liveId: row.liveId,
      accountId: row.accountId,
      actor: row.actorAccountId === null ? 'server' : 'account',
      actorAccountId: row.actorAccountId,
      linkedAt: row.now,
      createdAt: row.now,
    })
    .returning({ id: liveLinks.id })
  return (rows[0] as { id: number }).id
}

/** 기다리던 연결을 저절로 잇는다 (WAITING일 때만 — 조치자 서버). 바꿨으면 true */
export async function autoLink(db: Db, sellerId: string, linkId: number, liveId: string, accountId: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(liveLinks)
    .set({ state: 'LINKED', liveId, accountId, actor: 'server', actorAccountId: null, linkedAt: now })
    .where(and(eq(liveLinks.sellerId, sellerId), eq(liveLinks.id, linkId), eq(liveLinks.state, 'WAITING')))
    .returning({ id: liveLinks.id })
  return rows.length > 0
}

export async function unlinkLink(db: Db, sellerId: string, linkId: number, accountId: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(liveLinks)
    .set({ state: 'UNLINKED', unlinkedAt: now, unlinkedBy: accountId })
    .where(and(eq(liveLinks.sellerId, sellerId), eq(liveLinks.id, linkId), or(eq(liveLinks.state, 'WAITING'), eq(liveLinks.state, 'LINKED'))))
    .returning({ id: liveLinks.id })
  return rows.length > 0
}

/**
 * 이 판매자의 어느 회차에든(끊은 연결·끝난 회차·옮기기 전 라이브 포함) 이어진 적이 있는 라이브인지 (AC-N2-25 — 옛 라이브로 되돌아가거나 이미 쓴 라이브로 옮기지 않는다)
 */
export async function liveEverLinked(db: Db, sellerId: string, liveId: string): Promise<boolean> {
  const linked = await db
    .select({ id: liveLinks.id })
    .from(liveLinks)
    .where(and(eq(liveLinks.sellerId, sellerId), eq(liveLinks.liveId, liveId)))
    .limit(1)
  if (linked.length > 0) return true
  const moved = await db
    .select({ id: liveLinkMoves.id })
    .from(liveLinkMoves)
    .where(and(eq(liveLinkMoves.sellerId, sellerId), or(eq(liveLinkMoves.fromLiveId, liveId), eq(liveLinkMoves.toLiveId, liveId))))
    .limit(1)
  return moved.length > 0
}

/**
 * 새 라이브로 옮길 수 있는 연결 (AC-N2-25 Given): 끝나지 않은 실제 회차의, 서버가 저절로 이었거나 옮긴(조치자 서버) 인스타그램 `LINKED` 연결로
 * 같은 인스타 계정의 그 라이브가 아닌 라이브에 이어진 것
 */
export async function movableLinks(db: Db, sellerId: string, accountId: string, exceptLiveId: string): Promise<LinkRow[]> {
  return linkQuery(db, sellerId)
    .where(
      and(
        eq(liveLinks.sellerId, sellerId),
        eq(liveLinks.platform, 'INSTAGRAM'),
        eq(liveLinks.state, 'LINKED'),
        eq(liveLinks.actor, 'server'),
        eq(liveLinks.accountId, accountId),
        ne(liveLinks.liveId, exceptLiveId),
        isNull(broadcasts.endedAt),
        eq(scopes.rehearsal, false),
      ),
    )
    .orderBy(asc(liveLinks.id))
}

/**
 * 이 판매자에게 그 회차 말고 끝나지 않은 실제 회차(리허설 아님)가 있는지 — 라이브 연결이 없거나(기다리기도 잇기도 하지 않은 회차),
 * 플랫폼이 무엇이든 센다 (AC-N2-25 옮기지 않음: 새 라이브가 어느 회차의 라이브인지 모호하다, SA-N2-004·TD-N2-003)
 */
export async function otherOpenBroadcast(db: Db, sellerId: string, exceptBroadcastId: string): Promise<boolean> {
  const rows = await db
    .select({ id: broadcasts.id })
    .from(broadcasts)
    .innerJoin(scopes, and(eq(scopes.id, broadcasts.scopeId), eq(scopes.sellerId, sellerId)))
    .where(and(eq(broadcasts.sellerId, sellerId), ne(broadcasts.id, exceptBroadcastId), isNull(broadcasts.endedAt), eq(scopes.rehearsal, false)))
    .limit(1)
  return rows.length > 0
}

/** 연결을 새 라이브로 옮긴다 (그 연결이 아직 그 라이브에 서버가 이은 LINKED일 때만 — 조치자 서버, 이은 시각 = 옮긴 시각). 옮긴 기록도 남긴다. 옮겼으면 true */
export async function moveLink(
  db: Db,
  row: { sellerId: string; linkId: number; broadcastId: string; fromLiveId: string; toLiveId: string; accountId: string; commentsBefore: number; now: Date },
): Promise<boolean> {
  const updated = await db
    .update(liveLinks)
    .set({ liveId: row.toLiveId, accountId: row.accountId, actor: 'server', actorAccountId: null, linkedAt: row.now })
    .where(
      and(
        eq(liveLinks.sellerId, row.sellerId),
        eq(liveLinks.id, row.linkId),
        eq(liveLinks.state, 'LINKED'),
        eq(liveLinks.actor, 'server'),
        eq(liveLinks.liveId, row.fromLiveId),
        eq(liveLinks.accountId, row.accountId),
      ),
    )
    .returning({ id: liveLinks.id })
  if (updated.length === 0) return false
  await db.insert(liveLinkMoves).values({
    sellerId: row.sellerId,
    linkId: row.linkId,
    broadcastId: row.broadcastId,
    platform: 'INSTAGRAM',
    fromLiveId: row.fromLiveId,
    toLiveId: row.toLiveId,
    accountId: row.accountId,
    actor: 'server',
    commentsBefore: row.commentsBefore,
    movedAt: row.now,
  })
  return true
}

/** 그 연결의 마지막 옮기기 (AC-N2-03·25, D-N2-17 — 연결 조회 moved). 옮긴 적이 없으면 null. 연결마다 따로라 끊은 뒤 다시 이은 연결에는 이전 연결의 옮기기가 없다 */
export async function lastMove(db: Db, sellerId: string, linkId: number): Promise<{ fromLiveId: string; movedAt: Date; comments: number } | null> {
  const rows = await db
    .select({ fromLiveId: liveLinkMoves.fromLiveId, movedAt: liveLinkMoves.movedAt, comments: liveLinkMoves.commentsBefore })
    .from(liveLinkMoves)
    .where(and(eq(liveLinkMoves.sellerId, sellerId), eq(liveLinkMoves.linkId, linkId)))
    .orderBy(desc(liveLinkMoves.id))
    .limit(1)
  return rows[0] ?? null
}

export async function bumpLinkCounter(db: Db, sellerId: string, linkId: number, counter: 'late' | 'malformed'): Promise<void> {
  const set = counter === 'late' ? { lateCount: sql`${liveLinks.lateCount} + 1` } : { malformedCount: sql`${liveLinks.malformedCount} + 1` }
  await db
    .update(liveLinks)
    .set(set)
    .where(and(eq(liveLinks.sellerId, sellerId), eq(liveLinks.id, linkId)))
}

/** 회차에 기록한 인스타그램 댓글 수·마지막으로 받은 시각 (이벤트 기록의 `ig:` 채팅). exceptMessageId가 있으면 그 댓글은 빼고 센다 */
export async function liveChatStats(db: Db, sellerId: string, scopeId: string, broadcastId: string, exceptMessageId?: string): Promise<{ count: number; lastAt: Date | null }> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int`, lastAt: sql<Date | null>`max(${events.receivedAt})` })
    .from(events)
    .where(
      and(
        eq(events.sellerId, sellerId),
        eq(events.scopeId, scopeId),
        eq(events.type, 'chat'),
        eq(events.chatBroadcast, broadcastId),
        sql`${events.chatMessageId} LIKE 'ig:%'`,
        exceptMessageId === undefined ? undefined : ne(events.chatMessageId, exceptMessageId),
      ),
    )
  const row = rows[0]
  const lastAt = row?.lastAt ?? null
  return { count: row?.count ?? 0, lastAt: lastAt === null ? null : new Date(lastAt) }
}

/**
 * 이 판매자가 그 `ig:` 댓글을 이미 기록했는지 — 어느 회차·날짜든 (AC-N2-33 "다른 요청으로 다시 배달돼도 두 번째는 아무 일도 없다").
 * 기존 유일 제약 events_chat_uq는 회차 단위라, 회차를 정하기(저절로 잇기·이어지지 않은 수 세기) 전에 이것으로 거른다 (TD-N2-001).
 * 부분 인덱스 events_ig_chat_idx를 타도록 같은 조건(LIKE 'ig:%')을 함께 건다.
 */
export async function igChatRecorded(db: Db, sellerId: string, messageId: string): Promise<boolean> {
  const rows = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.sellerId, sellerId), eq(events.chatMessageId, messageId), sql`chat_message_id LIKE 'ig:%'`))
    .limit(1)
  return rows.length > 0
}

/** 이어지지 않은 라이브의 댓글 하나를 센다. 센 뒤의 수를 돌려준다 */
export async function countUnlinked(db: Db, sellerId: string, platform: string, liveId: string, now: Date): Promise<number> {
  const rows = await db
    .insert(liveUnlinked)
    .values({ sellerId, platform, liveId, count: 1, firstAt: now, lastAt: now })
    .onConflictDoUpdate({ target: [liveUnlinked.sellerId, liveUnlinked.platform, liveUnlinked.liveId], set: { count: sql`${liveUnlinked.count} + 1`, lastAt: now } })
    .returning({ count: liveUnlinked.count })
  return rows[0]?.count ?? 1
}

export async function unlinkedCounts(db: Db, sellerId: string): Promise<{ platform: string; liveId: string; count: number; firstAt: Date; lastAt: Date }[]> {
  return db
    .select({ platform: liveUnlinked.platform, liveId: liveUnlinked.liveId, count: liveUnlinked.count, firstAt: liveUnlinked.firstAt, lastAt: liveUnlinked.lastAt })
    .from(liveUnlinked)
    .where(eq(liveUnlinked.sellerId, sellerId))
    .orderBy(asc(liveUnlinked.firstAt), asc(liveUnlinked.id))
}

// ── 요청 번호 ────────────────────────────────────────────────────────────

export async function findRequest(db: Db, sellerId: string, requestId: string): Promise<string | null> {
  const rows = await db
    .select({ result: liveRequests.result })
    .from(liveRequests)
    .where(and(eq(liveRequests.sellerId, sellerId), eq(liveRequests.requestId, requestId)))
    .limit(1)
  return rows[0]?.result ?? null
}

export async function insertRequest(db: Db, sellerId: string, requestId: string, result: string, now: Date): Promise<void> {
  await db.insert(liveRequests).values({ sellerId, requestId, result, createdAt: now })
}

// ── DM ───────────────────────────────────────────────────────────────────

export interface DmRow {
  readonly id: number
  readonly sellerId: string
  readonly scopeId: string
  readonly date: string
  readonly effectId: string
  readonly seq: number
  readonly ord: number
  readonly broadcastId: string
  readonly product: string
  readonly buyer: string
  readonly comment: string | null
  readonly line: string
  readonly status: string
  readonly reason: string | null
  readonly attempts: number
  readonly nextAt: Date | null
  readonly deadlineAt: Date | null
  readonly sendId: number | null
  readonly sentAt: Date | null
  readonly metaMessageId: string | null
  readonly reported: boolean
  readonly createdAt: Date
}

const dmColumns = {
  id: igDmRows.id,
  sellerId: igDmRows.sellerId,
  scopeId: igDmRows.scopeId,
  date: igDmRows.date,
  effectId: igDmRows.effectId,
  seq: igDmRows.seq,
  ord: igDmRows.ord,
  broadcastId: igDmRows.broadcastId,
  product: igDmRows.product,
  buyer: igDmRows.buyer,
  comment: igDmRows.comment,
  line: igDmRows.line,
  status: igDmRows.status,
  reason: igDmRows.reason,
  attempts: igDmRows.attempts,
  nextAt: igDmRows.nextAt,
  deadlineAt: igDmRows.deadlineAt,
  sendId: igDmRows.sendId,
  sentAt: igDmRows.sentAt,
  metaMessageId: igDmRows.metaMessageId,
  reported: igDmRows.reported,
  createdAt: igDmRows.createdAt,
}

export interface NewDmRow {
  readonly sellerId: string
  readonly scopeId: string
  readonly date: string
  readonly outboxId: number
  readonly effectId: string
  readonly seq: number
  readonly ord: number
  readonly broadcastId: string
  readonly product: string
  readonly buyer: string
  readonly comment: string | null
  readonly line: string
  readonly status: string
  readonly reason: string | null
  readonly deadlineAt: Date | null
  readonly now: Date
}

export async function insertDmRows(db: Db, rows: readonly NewDmRow[]): Promise<number[]> {
  if (rows.length === 0) return []
  const inserted = await db
    .insert(igDmRows)
    .values(
      rows.map((row) => ({
        sellerId: row.sellerId,
        scopeId: row.scopeId,
        date: row.date,
        outboxId: row.outboxId,
        effectId: row.effectId,
        seq: row.seq,
        ord: row.ord,
        broadcastId: row.broadcastId,
        product: row.product,
        buyer: row.buyer,
        comment: row.comment,
        line: row.line,
        status: row.status,
        reason: row.reason,
        deadlineAt: row.deadlineAt,
        createdAt: row.now,
        updatedAt: row.now,
      })),
    )
    .returning({ id: igDmRows.id })
  return inserted.map((row) => row.id)
}

/** 발송함 행 ID (그 범위의 효과 ID들 — 같은 트랜잭션에서 방금 넣은 것) */
export async function outboxIds(db: Db, sellerId: string, scopeId: string, effectIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (effectIds.length === 0) return out
  const rows = await db
    .select({ id: outbox.id, effectId: outbox.effectId })
    .from(outbox)
    .where(and(eq(outbox.sellerId, sellerId), eq(outbox.scopeId, scopeId), inArray(outbox.effectId, [...effectIds])))
  for (const row of rows) out.set(row.effectId, row.id)
  return out
}

/** 범위의 그 seq 채팅 이벤트의 방송·메시지 ID·채널 키 (찜을 만든 메시지 — 순위 재료 seq가 그 메시지의 seq, R-6) */
export async function chatAtSeq(db: Db, sellerId: string, scopeId: string, seq: number): Promise<{ b: string; id: string; ch: string } | null> {
  const rows = await db
    .select({ b: events.chatBroadcast, id: events.chatMessageId, body: events.body })
    .from(events)
    .where(and(eq(events.sellerId, sellerId), eq(events.scopeId, scopeId), eq(events.seq, seq), eq(events.type, 'chat')))
    .limit(1)
  const row = rows[0]
  if (row === undefined || row.b === null || row.id === null) return null
  const ch = (JSON.parse(row.body) as { ch?: unknown }).ch
  return typeof ch === 'string' ? { b: row.b, id: row.id, ch } : null
}

/** 그 방송·메시지 ID 채팅 이벤트의 채널 키 */
export async function chatChannel(db: Db, sellerId: string, broadcastId: string, messageId: string): Promise<string | null> {
  const rows = await db
    .select({ body: events.body })
    .from(events)
    .where(and(eq(events.sellerId, sellerId), eq(events.chatBroadcast, broadcastId), eq(events.chatMessageId, messageId)))
    .limit(1)
  const row = rows[0]
  if (row === undefined) return null
  const ch = (JSON.parse(row.body) as { ch?: unknown }).ch
  return typeof ch === 'string' ? ch : null
}

export interface DmGroup {
  readonly sellerId: string
  readonly scopeId: string
  readonly date: string
  readonly broadcastId: string
  readonly comment: string
}

/**
 * 실행기가 집는 댓글 묶음 (AC-N2-40): 발송함 행이 실제 범위(rehearsal = false — 조건에 고정, 바꾸는 매개변수 없음)이고 복구로 다시 만든 행이 아닌(restored = false, D-I2-14) POST_THANKS이고
 * (DM 행은 인스타그램 회차의 POST_THANKS 행에만 생긴다) 기다리는(WAITING) 행이 있으며, 그 댓글의 진행 중 발송이 보내는 중·확인 중이 아니고
 * 다시 시도 시각이 되었으며, "다시 연결 필요"로 기다리는 행은 연결됨일 때만
 */
export async function dueDmGroups(db: Db, now: Date, limit: number): Promise<DmGroup[]> {
  const nowText = now.toISOString()
  const rows = await db
    .selectDistinct({ sellerId: igDmRows.sellerId, scopeId: igDmRows.scopeId, date: igDmRows.date, broadcastId: igDmRows.broadcastId, comment: igDmRows.comment })
    .from(igDmRows)
    .innerJoin(outbox, and(eq(outbox.id, igDmRows.outboxId), eq(outbox.sellerId, igDmRows.sellerId), eq(outbox.rehearsal, false), eq(outbox.restored, false), eq(outbox.kind, 'POST_THANKS')))
    .where(
      and(
        eq(igDmRows.status, 'WAITING'),
        isNotNull(igDmRows.comment),
        sql`NOT EXISTS (SELECT 1 FROM ${igDmSends} s WHERE s.seller_id = ${igDmRows.sellerId} AND s.scope_id = ${igDmRows.scopeId} AND s.comment = ${igDmRows.comment}
          AND (s.state IN ('SENDING', 'CONFIRMING') OR (s.state = 'PENDING' AND s.next_at IS NOT NULL AND s.next_at > ${nowText}::timestamptz)))`,
        sql`(${igDmRows.reason} IS DISTINCT FROM 'RECONNECT' OR EXISTS (SELECT 1 FROM ${igConnections} c WHERE c.seller_id = ${igDmRows.sellerId} AND c.status = 'CONNECTED'))`,
      ),
    )
    .limit(limit)
  return rows.filter((row): row is DmGroup => row.comment !== null)
}

/** 기한이 지난 기다리는 행 → FAILED(EXPIRED). 바꾼 행 (판매자·날짜·ID) */
export async function expireDmRows(db: Db, now: Date): Promise<{ id: number; sellerId: string; date: string }[]> {
  return db
    .update(igDmRows)
    .set({ status: 'FAILED', reason: 'EXPIRED', nextAt: null, updatedAt: now })
    .where(and(eq(igDmRows.status, 'WAITING'), isNotNull(igDmRows.deadlineAt), lte(igDmRows.deadlineAt, now)))
    .returning({ id: igDmRows.id, sellerId: igDmRows.sellerId, date: igDmRows.date })
}

/** 기다리는 행이 하나도 없는 다음 시도 대기 발송 → FAILED */
export async function closeEmptySends(db: Db, now: Date): Promise<void> {
  await db
    .update(igDmSends)
    .set({ state: 'FAILED', reason: sql`COALESCE(${igDmSends.reason}, 'EXPIRED')`, nextAt: null, updatedAt: now })
    .where(
      and(
        eq(igDmSends.state, 'PENDING'),
        sql`NOT EXISTS (SELECT 1 FROM ${igDmRows} r WHERE r.seller_id = ${igDmSends.sellerId} AND r.scope_id = ${igDmSends.scopeId} AND r.comment = ${igDmSends.comment} AND r.status = 'WAITING')`,
      ),
    )
}

export interface SendRow {
  readonly id: number
  readonly sellerId: string
  readonly scopeId: string
  readonly date: string
  readonly broadcastId: string
  readonly comment: string
  readonly igsid: string
  readonly text: string | null
  readonly state: string
  readonly attempts: number
  readonly nextAt: Date | null
  readonly leaseUntil: Date | null
  readonly startedAt: Date | null
  readonly manual: boolean
}

const sendColumns = {
  id: igDmSends.id,
  sellerId: igDmSends.sellerId,
  scopeId: igDmSends.scopeId,
  date: igDmSends.date,
  broadcastId: igDmSends.broadcastId,
  comment: igDmSends.comment,
  igsid: igDmSends.igsid,
  text: igDmSends.text,
  state: igDmSends.state,
  attempts: igDmSends.attempts,
  nextAt: igDmSends.nextAt,
  leaseUntil: igDmSends.leaseUntil,
  startedAt: igDmSends.startedAt,
  manual: igDmSends.manual,
}

/** 임대가 지난 보내는 중·확인 중 발송 (서버가 죽었다 살아남 — 확인부터) */
export async function leaseExpiredSends(db: Db, now: Date, limit: number): Promise<SendRow[]> {
  return db
    .select(sendColumns)
    .from(igDmSends)
    .where(and(or(eq(igDmSends.state, 'SENDING'), eq(igDmSends.state, 'CONFIRMING')), lte(igDmSends.leaseUntil, now)))
    .orderBy(asc(igDmSends.id))
    .limit(limit)
}

/** 임대를 잡는다 (임대가 지났을 때만 — 실행기 둘이 같은 발송을 확인하지 않게). 잡았으면 true */
export async function takeExpiredLease(db: Db, sellerId: string, sendId: number, now: Date, until: Date): Promise<boolean> {
  const rows = await db
    .update(igDmSends)
    .set({ state: 'CONFIRMING', leaseUntil: until, updatedAt: now })
    .where(and(eq(igDmSends.sellerId, sellerId), eq(igDmSends.id, sendId), or(eq(igDmSends.state, 'SENDING'), eq(igDmSends.state, 'CONFIRMING')), lte(igDmSends.leaseUntil, now)))
    .returning({ id: igDmSends.id })
  return rows.length > 0
}

export async function activeSend(db: Db, group: Pick<DmGroup, 'sellerId' | 'scopeId' | 'comment'>): Promise<SendRow | null> {
  const rows = await db
    .select(sendColumns)
    .from(igDmSends)
    .where(
      and(
        eq(igDmSends.sellerId, group.sellerId),
        eq(igDmSends.scopeId, group.scopeId),
        eq(igDmSends.comment, group.comment),
        inArray(igDmSends.state, ['PENDING', 'SENDING', 'CONFIRMING']),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

export async function findSend(db: Db, sellerId: string, sendId: number): Promise<SendRow | null> {
  const rows = await db
    .select(sendColumns)
    .from(igDmSends)
    .where(and(eq(igDmSends.sellerId, sellerId), eq(igDmSends.id, sendId)))
    .limit(1)
  return rows[0] ?? null
}

export async function insertSend(
  db: Db,
  row: { sellerId: string; scopeId: string; date: string; broadcastId: string; comment: string; igsid: string; manual: boolean; now: Date },
): Promise<number> {
  const rows = await db
    .insert(igDmSends)
    .values({
      sellerId: row.sellerId,
      scopeId: row.scopeId,
      date: row.date,
      broadcastId: row.broadcastId,
      comment: row.comment,
      igsid: row.igsid,
      state: 'PENDING',
      manual: row.manual,
      createdAt: row.now,
      updatedAt: row.now,
    })
    .returning({ id: igDmSends.id })
  return (rows[0] as { id: number }).id
}

export async function updateSend(
  db: Db,
  sellerId: string,
  sendId: number,
  patch: Partial<{
    state: string
    reason: string | null
    text: string | null
    attempts: number
    nextAt: Date | null
    leaseUntil: Date | null
    startedAt: Date | null
    metaMessageId: string | null
    sentAt: Date | null
    igsid: string
  }>,
  now: Date,
): Promise<void> {
  await db
    .update(igDmSends)
    .set({ ...patch, updatedAt: now })
    .where(and(eq(igDmSends.sellerId, sellerId), eq(igDmSends.id, sendId)))
}

/** 판매자의 기다리는 발송 (PENDING) → FAILED (동의 끄기·끊기·연결 끊기). manual을 주면 그 종류만 */
export async function failPendingSends(db: Db, sellerId: string, reason: string, now: Date, filter: { readonly manual?: boolean; readonly broadcastId?: string } = {}): Promise<void> {
  await db
    .update(igDmSends)
    .set({ state: 'FAILED', reason, nextAt: null, updatedAt: now })
    .where(
      and(
        eq(igDmSends.sellerId, sellerId),
        eq(igDmSends.state, 'PENDING'),
        ...(filter.manual === undefined ? [] : [eq(igDmSends.manual, filter.manual)]),
        ...(filter.broadcastId === undefined ? [] : [eq(igDmSends.broadcastId, filter.broadcastId)]),
      ),
    )
}

/** 댓글의 기다리는 행 (seq·효과 순서) */
export async function waitingRowsOf(db: Db, group: Pick<DmGroup, 'sellerId' | 'scopeId' | 'comment'>): Promise<DmRow[]> {
  return db
    .select(dmColumns)
    .from(igDmRows)
    .where(and(eq(igDmRows.sellerId, group.sellerId), eq(igDmRows.scopeId, group.scopeId), eq(igDmRows.comment, group.comment), eq(igDmRows.status, 'WAITING')))
    .orderBy(asc(igDmRows.seq), asc(igDmRows.ord), asc(igDmRows.id))
}

/** 댓글의 모든 행 */
export async function rowsOfComment(db: Db, group: Pick<DmGroup, 'sellerId' | 'scopeId' | 'comment'>): Promise<DmRow[]> {
  return db
    .select(dmColumns)
    .from(igDmRows)
    .where(and(eq(igDmRows.sellerId, group.sellerId), eq(igDmRows.scopeId, group.scopeId), eq(igDmRows.comment, group.comment)))
    .orderBy(asc(igDmRows.seq), asc(igDmRows.ord), asc(igDmRows.id))
}

export async function rowsOfSend(db: Db, sellerId: string, sendId: number): Promise<DmRow[]> {
  return db
    .select(dmColumns)
    .from(igDmRows)
    .where(and(eq(igDmRows.sellerId, sellerId), eq(igDmRows.sendId, sendId)))
    .orderBy(asc(igDmRows.seq), asc(igDmRows.ord), asc(igDmRows.id))
}

export async function findDmRow(db: Db, sellerId: string, rowId: number): Promise<DmRow | null> {
  const rows = await db
    .select(dmColumns)
    .from(igDmRows)
    .where(and(eq(igDmRows.sellerId, sellerId), eq(igDmRows.id, rowId)))
    .limit(1)
  return rows[0] ?? null
}

export async function dmRowsByIds(db: Db, sellerId: string, ids: readonly number[]): Promise<DmRow[]> {
  if (ids.length === 0) return []
  return db
    .select(dmColumns)
    .from(igDmRows)
    .where(and(eq(igDmRows.sellerId, sellerId), inArray(igDmRows.id, [...ids])))
    .orderBy(asc(igDmRows.id))
}

/** 날짜(실제 범위)의 DM 행 — 리허설 범위는 행이 없다(만들지 않는다). 실제 범위만 본다 */
export async function dmRowsOfDate(db: Db, sellerId: string, date: string): Promise<DmRow[]> {
  return db
    .select(dmColumns)
    .from(igDmRows)
    .innerJoin(scopes, and(eq(scopes.id, igDmRows.scopeId), eq(scopes.sellerId, sellerId), eq(scopes.rehearsal, false)))
    .where(and(eq(igDmRows.sellerId, sellerId), eq(igDmRows.date, date)))
    .orderBy(asc(igDmRows.seq), asc(igDmRows.ord), asc(igDmRows.id))
}

export async function updateDmRows(
  db: Db,
  sellerId: string,
  ids: readonly number[],
  patch: Partial<{
    status: string
    reason: string | null
    attempts: number
    nextAt: Date | null
    deadlineAt: Date | null
    sendId: number | null
    sentAt: Date | null
    metaMessageId: string | null
    reported: boolean
  }>,
  now: Date,
): Promise<void> {
  if (ids.length === 0) return
  await db
    .update(igDmRows)
    .set({ ...patch, updatedAt: now })
    .where(and(eq(igDmRows.sellerId, sellerId), inArray(igDmRows.id, [...ids])))
}

/** 판매자의 기다리는 행 → FAILED(이유). 수동 재전송 행(기한 없음)을 뺄 수 있다. 바꾼 행 (ID·날짜) */
export async function failWaitingRows(
  db: Db,
  sellerId: string,
  reason: string,
  now: Date,
  filter: { readonly keepManual?: boolean; readonly broadcastId?: string } = {},
): Promise<{ id: number; date: string }[]> {
  return db
    .update(igDmRows)
    .set({ status: 'FAILED', reason, nextAt: null, updatedAt: now })
    .where(
      and(
        eq(igDmRows.sellerId, sellerId),
        eq(igDmRows.status, 'WAITING'),
        ...(filter.keepManual === true ? [isNotNull(igDmRows.deadlineAt)] : []),
        ...(filter.broadcastId === undefined ? [] : [eq(igDmRows.broadcastId, filter.broadcastId)]),
      ),
    )
    .returning({ id: igDmRows.id, date: igDmRows.date })
}

/** 보냈고 아직 게시 보고를 기록하지 않은 행 */
export async function unreportedRows(db: Db, limit: number): Promise<DmRow[]> {
  return db
    .select(dmColumns)
    .from(igDmRows)
    .where(and(eq(igDmRows.status, 'SENT'), eq(igDmRows.reported, false)))
    .orderBy(asc(igDmRows.id))
    .limit(limit)
}
