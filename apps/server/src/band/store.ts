// 밴드 계정·연결 시작 표·글 연결·본 댓글 표·알림 저장 (BND1). 모든 쿼리에 판매자 ID 조건을 건다(SYS-02).
import { and, asc, desc, eq, gt, inArray, isNull, lte, ne, sql } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { accounts, bandAccounts, bandLinks, bandNotices, bandOauthStates, bandSeen, broadcasts, events, scopes, youtubeLinks } from '../db/schema.ts'

/** 복구·가져오기로 끝낸 연결의 까닭 (backup.ts가 쓴다) */
export const BAND_RESTORED_REASON = 'RESTORED'

export type BandAccountStatus = 'CONNECTED' | 'RECONNECT_NEEDED'
export type BandLinkState = 'READING' | 'RETRYING' | 'RECONNECT_NEEDED' | 'NO_ACCESS' | 'YOUTUBE_LINKED' | 'FINISHED'
export type BandFinishReason = 'UNLINKED' | 'ENDED' | 'ACCOUNT_CHANGED' | 'DISCONNECTED' | typeof BAND_RESTORED_REASON
/** 읽는 상태 (읽기를 돌린다) */
export const BAND_ACTIVE_STATES: readonly BandLinkState[] = Object.freeze(['READING', 'RETRYING'])

// ── 계정 ───────────────────────────────────────────────────────────────

export interface BandAccountRow {
  readonly sellerId: string
  readonly userKey: string
  readonly tokenEnc: string
  readonly expiresAt: Date | null
  readonly status: BandAccountStatus
  readonly profileName: string | null
  readonly connectedAt: Date
  readonly chosenBand: string | null
}

export async function findBandAccount(db: Db, sellerId: string): Promise<BandAccountRow | null> {
  const rows = await db
    .select({
      sellerId: bandAccounts.sellerId,
      userKey: bandAccounts.userKey,
      tokenEnc: bandAccounts.tokenEnc,
      expiresAt: bandAccounts.expiresAt,
      status: bandAccounts.status,
      profileName: bandAccounts.profileName,
      connectedAt: bandAccounts.connectedAt,
      chosenBand: bandAccounts.chosenBand,
    })
    .from(bandAccounts)
    .where(eq(bandAccounts.sellerId, sellerId))
    .limit(1)
  return (rows[0] as BandAccountRow | undefined) ?? null
}

export async function saveBandAccount(
  db: Db,
  row: { sellerId: string; userKey: string; tokenEnc: string; expiresAt: Date | null; profileName: string | null; chosenBand: string | null; now: Date },
): Promise<void> {
  const values = { userKey: row.userKey, tokenEnc: row.tokenEnc, expiresAt: row.expiresAt, status: 'CONNECTED', profileName: row.profileName, connectedAt: row.now, chosenBand: row.chosenBand, updatedAt: row.now }
  await db
    .insert(bandAccounts)
    .values({ sellerId: row.sellerId, ...values })
    .onConflictDoUpdate({ target: bandAccounts.sellerId, set: values })
}

export async function markBandAccountReconnect(db: Db, sellerId: string, now: Date): Promise<void> {
  await db.update(bandAccounts).set({ status: 'RECONNECT_NEEDED', updatedAt: now }).where(eq(bandAccounts.sellerId, sellerId))
}

export async function dropBandAccount(db: Db, sellerId: string): Promise<boolean> {
  const rows = await db.delete(bandAccounts).where(eq(bandAccounts.sellerId, sellerId)).returning({ id: bandAccounts.sellerId })
  return rows.length > 0
}

export async function setChosenBand(db: Db, sellerId: string, bandKey: string, now: Date): Promise<void> {
  await db.update(bandAccounts).set({ chosenBand: bandKey, updatedAt: now }).where(eq(bandAccounts.sellerId, sellerId))
}

// ── 연결 시작 표 ───────────────────────────────────────────────────────

export interface BandStateRow {
  readonly id: number
  readonly sellerId: string
  readonly accountId: string
  readonly sessionHash: string
  readonly expiresAt: Date
  readonly usedAt: Date | null
}

export async function insertBandState(db: Db, row: { sellerId: string; accountId: string; sessionHash: string; stateHash: string; expiresAt: Date; now: Date }): Promise<void> {
  // 그 판매자의 지난 표는 지운다 (표가 끝없이 자라지 않게)
  await db.delete(bandOauthStates).where(and(eq(bandOauthStates.sellerId, row.sellerId), lte(bandOauthStates.expiresAt, row.now)))
  await db.insert(bandOauthStates).values({ sellerId: row.sellerId, accountId: row.accountId, sessionHash: row.sessionHash, stateHash: row.stateHash, expiresAt: row.expiresAt, createdAt: row.now })
}

/** 표 해시로 찾기 — 로그인 없이 닿는 돌아오기라 판매자를 모른다(찾은 뒤 세션 판매자와 맞댄다) */
export async function findBandState(db: Db, hash: string): Promise<BandStateRow | null> {
  const rows = await db
    .select({ id: bandOauthStates.id, sellerId: bandOauthStates.sellerId, accountId: bandOauthStates.accountId, sessionHash: bandOauthStates.sessionHash, expiresAt: bandOauthStates.expiresAt, usedAt: bandOauthStates.usedAt })
    .from(bandOauthStates)
    .where(eq(bandOauthStates.stateHash, hash))
    .limit(1)
  return rows[0] ?? null
}

/** 한 번 쓰기 — 처음일 때만 true */
export async function useBandState(db: Db, sellerId: string, id: number, now: Date): Promise<boolean> {
  const rows = await db
    .update(bandOauthStates)
    .set({ usedAt: now })
    .where(and(eq(bandOauthStates.sellerId, sellerId), eq(bandOauthStates.id, id), isNull(bandOauthStates.usedAt)))
    .returning({ id: bandOauthStates.id })
  return rows.length > 0
}

// ── 글 연결 ────────────────────────────────────────────────────────────

export interface BandLinkRow {
  readonly id: number
  readonly sellerId: string
  readonly broadcastId: string
  readonly date: string
  readonly state: BandLinkState
  readonly finishReason: BandFinishReason | null
  readonly bandKey: string
  readonly postKey: string
  readonly postLine: string
  readonly actorLoginId: string | null
  readonly linkedAt: Date
  readonly baseline: number
  readonly skipSeller: number
  readonly skipNoAuthor: number
  readonly skipBadKey: number
  readonly skipBadTime: number
  readonly skipNoText: number
  readonly skipTooLong: number
  readonly skipDuplicate: number
  readonly lastReadAt: Date | null
  readonly failures: number
  readonly retryAt: Date | null
  readonly rateLimited: boolean
  readonly noticesSeen: number
  readonly finishedAt: Date | null
}

const linkColumns = {
  id: bandLinks.id,
  sellerId: bandLinks.sellerId,
  broadcastId: bandLinks.broadcastId,
  date: bandLinks.date,
  state: bandLinks.state,
  finishReason: bandLinks.finishReason,
  bandKey: bandLinks.bandKey,
  postKey: bandLinks.postKey,
  postLine: bandLinks.postLine,
  actorLoginId: accounts.loginId,
  linkedAt: bandLinks.linkedAt,
  baseline: bandLinks.baseline,
  skipSeller: bandLinks.skipSeller,
  skipNoAuthor: bandLinks.skipNoAuthor,
  skipBadKey: bandLinks.skipBadKey,
  skipBadTime: bandLinks.skipBadTime,
  skipNoText: bandLinks.skipNoText,
  skipTooLong: bandLinks.skipTooLong,
  skipDuplicate: bandLinks.skipDuplicate,
  lastReadAt: bandLinks.lastReadAt,
  failures: bandLinks.failures,
  retryAt: bandLinks.retryAt,
  rateLimited: bandLinks.rateLimited,
  noticesSeen: bandLinks.noticesSeen,
  finishedAt: bandLinks.finishedAt,
}

const linkQuery = (db: Db) => db.select(linkColumns).from(bandLinks).leftJoin(accounts, eq(accounts.id, bandLinks.actorAccountId))
const asRow = (row: unknown): BandLinkRow => row as BandLinkRow

/** 회차의 마지막 밴드 글 연결 (어느 상태든) */
export async function latestBandLink(db: Db, sellerId: string, broadcastId: string): Promise<BandLinkRow | null> {
  const rows = await linkQuery(db)
    .where(and(eq(bandLinks.sellerId, sellerId), eq(bandLinks.broadcastId, broadcastId)))
    .orderBy(desc(bandLinks.id))
    .limit(1)
  return rows[0] === undefined ? null : asRow(rows[0])
}

/** 판매자의 끝나지 않은 밴드 글 연결 — 모든 회차를 통틀어 많아야 하나 */
export async function openBandLink(db: Db, sellerId: string): Promise<BandLinkRow | null> {
  const rows = await linkQuery(db)
    .where(and(eq(bandLinks.sellerId, sellerId), ne(bandLinks.state, 'FINISHED')))
    .limit(1)
  return rows[0] === undefined ? null : asRow(rows[0])
}

export async function findBandLink(db: Db, sellerId: string, linkId: number): Promise<BandLinkRow | null> {
  const rows = await linkQuery(db)
    .where(and(eq(bandLinks.sellerId, sellerId), eq(bandLinks.id, linkId)))
    .limit(1)
  return rows[0] === undefined ? null : asRow(rows[0])
}

export async function insertBandLink(
  db: Db,
  row: { sellerId: string; broadcastId: string; date: string; bandKey: string; postKey: string; postLine: string; actorAccountId: string; baseline: number; skipBadKey: number; now: Date },
): Promise<number> {
  const inserted = await db
    .insert(bandLinks)
    .values({
      sellerId: row.sellerId,
      broadcastId: row.broadcastId,
      date: row.date,
      state: 'READING',
      bandKey: row.bandKey,
      postKey: row.postKey,
      postLine: row.postLine,
      actorAccountId: row.actorAccountId,
      linkedAt: row.now,
      baseline: row.baseline,
      skipBadKey: row.skipBadKey,
      lastReadAt: row.now,
      createdAt: row.now,
    })
    .returning({ id: bandLinks.id })
  return inserted[0]?.id as number
}

/** 상태 바꾸기 (지금 상태가 from 중 하나일 때만) — 바뀌었으면 true */
export async function setBandLinkState(
  db: Db,
  sellerId: string,
  linkId: number,
  from: readonly BandLinkState[],
  patch: Partial<{ state: BandLinkState; failures: number; retryAt: Date | null; rateLimited: boolean; lastReadAt: Date }>,
): Promise<boolean> {
  const rows = await db
    .update(bandLinks)
    .set(patch)
    .where(and(eq(bandLinks.sellerId, sellerId), eq(bandLinks.id, linkId), inArray(bandLinks.state, [...from])))
    .returning({ id: bandLinks.id })
  return rows.length > 0
}

/** 판매자의 끝나지 않은 연결 중 from 상태를 to로 — 바뀐 연결 ID */
export async function moveSellerBandLinks(db: Db, sellerId: string, from: readonly BandLinkState[], to: BandLinkState, patch: Partial<{ retryAt: Date | null; failures: number; rateLimited: boolean }> = {}): Promise<number[]> {
  const rows = await db
    .update(bandLinks)
    .set({ state: to, ...patch })
    .where(and(eq(bandLinks.sellerId, sellerId), inArray(bandLinks.state, [...from])))
    .returning({ id: bandLinks.id })
  return rows.map((row) => row.id)
}

/** 끝내기: 판매자의 끝나지 않은 연결(회차를 주면 그 회차들의 것만)을 FINISHED로 — 끝낸 (연결 ID, 회차) */
export async function finishBandLinks(
  db: Db,
  sellerId: string,
  reason: BandFinishReason,
  now: Date,
  options: { readonly broadcastIds?: readonly string[]; readonly linkId?: number; readonly by?: string | null } = {},
): Promise<{ id: number; broadcastId: string }[]> {
  if (options.broadcastIds !== undefined && options.broadcastIds.length === 0) return []
  const rows = await db
    .update(bandLinks)
    .set({ state: 'FINISHED', finishReason: reason, finishedAt: now, finishedBy: options.by ?? null, retryAt: null })
    .where(
      and(
        eq(bandLinks.sellerId, sellerId),
        ne(bandLinks.state, 'FINISHED'),
        ...(options.broadcastIds === undefined ? [] : [inArray(bandLinks.broadcastId, [...options.broadcastIds])]),
        ...(options.linkId === undefined ? [] : [eq(bandLinks.id, options.linkId)]),
      ),
    )
    .returning({ id: bandLinks.id, broadcastId: bandLinks.broadcastId })
  return rows
}

export type BandSkipColumn = 'skipSeller' | 'skipNoAuthor' | 'skipBadTime' | 'skipNoText' | 'skipTooLong' | 'skipDuplicate'

/** 건너뛴 수 더하기·키 없는 수(지금 읽은 목록의 수) 바꾸기 */
export async function bumpBandSkips(db: Db, sellerId: string, linkId: number, add: Partial<Record<BandSkipColumn, number>>, badKey: number | null): Promise<void> {
  const set: Record<string, unknown> = {}
  for (const [column, by] of Object.entries(add) as [BandSkipColumn, number][]) if (by > 0) set[column] = sql`${bandLinks[column]} + ${by}`
  if (badKey !== null) set['skipBadKey'] = badKey
  if (Object.keys(set).length === 0) return
  await db
    .update(bandLinks)
    .set(set)
    .where(and(eq(bandLinks.sellerId, sellerId), eq(bandLinks.id, linkId)))
}

/** 알림 확인 (D-N2b-2-16과 같은 방식): noticesSeen = max(지금, min(upTo, 마지막 알림 번호)) */
export async function markBandNoticesSeen(db: Db, sellerId: string, linkId: number, upTo: number): Promise<void> {
  const last = await db
    .select({ id: sql<number | null>`max(${bandNotices.id})` })
    .from(bandNotices)
    .where(and(eq(bandNotices.sellerId, sellerId), eq(bandNotices.linkId, linkId)))
  const max = Number(last[0]?.id ?? 0)
  const value = Math.min(upTo, max)
  await db
    .update(bandLinks)
    .set({ noticesSeen: sql`greatest(${bandLinks.noticesSeen}, ${value}::bigint)` })
    .where(and(eq(bandLinks.sellerId, sellerId), eq(bandLinks.id, linkId)))
}

/** 서버가 다시 켜질 때 이어 읽을 연결: 끝나지 않은 실제 회차의 READING·RETRYING */
export async function resumableBandLinks(db: Db): Promise<BandLinkRow[]> {
  const rows = await db
    .select(linkColumns)
    .from(bandLinks)
    .leftJoin(accounts, eq(accounts.id, bandLinks.actorAccountId))
    .innerJoin(broadcasts, and(eq(broadcasts.id, bandLinks.broadcastId), eq(broadcasts.sellerId, bandLinks.sellerId)))
    .innerJoin(scopes, and(eq(scopes.id, broadcasts.scopeId), eq(scopes.sellerId, bandLinks.sellerId), eq(scopes.rehearsal, false)))
    .where(and(inArray(bandLinks.state, [...BAND_ACTIVE_STATES]), isNull(broadcasts.endedAt)))
    .orderBy(asc(bandLinks.id))
  return rows.map(asRow)
}

/** 판매자의 from 상태 연결 (다시 연결 뒤 이어 읽기) */
export async function sellerBandLinksIn(db: Db, sellerId: string, states: readonly BandLinkState[]): Promise<BandLinkRow[]> {
  const rows = await linkQuery(db)
    .where(and(eq(bandLinks.sellerId, sellerId), inArray(bandLinks.state, [...states])))
    .orderBy(asc(bandLinks.id))
  return rows.map(asRow)
}

/** 운영 상태: 끝나지 않은 연결 수 (상태별, 판매자 정보 없이) */
export async function bandLinkCounts(db: Db): Promise<Record<string, number>> {
  const rows = await db
    .select({ state: bandLinks.state, n: sql<number>`count(*)::int` })
    .from(bandLinks)
    .where(ne(bandLinks.state, 'FINISHED'))
    .groupBy(bandLinks.state)
  const out: Record<string, number> = { READING: 0, RETRYING: 0, RECONNECT_NEEDED: 0, NO_ACCESS: 0, YOUTUBE_LINKED: 0 }
  for (const row of rows) out[row.state] = Number(row.n)
  return out
}

/** 그 회차에 유튜브 연결 기록이 있는지 (끊은 것 포함, D-BND1-12) */
export async function youtubeEverLinked(db: Db, sellerId: string, broadcastId: string): Promise<boolean> {
  const rows = await db
    .select({ id: youtubeLinks.id })
    .from(youtubeLinks)
    .where(and(eq(youtubeLinks.sellerId, sellerId), eq(youtubeLinks.broadcastId, broadcastId)))
    .limit(1)
  return rows.length > 0
}

/** 이 회차에 기록한 밴드 댓글 수 */
export async function bandChatCount(db: Db, sellerId: string, broadcastId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(events)
    .where(and(eq(events.sellerId, sellerId), eq(events.chatBroadcast, broadcastId), sql`${events.chatMessageId} LIKE 'band:%'`))
  return Number(rows[0]?.count ?? 0)
}

// ── 본 댓글 표 ─────────────────────────────────────────────────────────

const CHUNK = 500

/** 이 연결에서 이미 본 키 (keys 중) */
export async function seenBandKeys(db: Db, sellerId: string, linkId: number, keys: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>()
  const unique = [...new Set(keys)]
  for (let start = 0; start < unique.length; start += CHUNK) {
    const rows = await db
      .select({ key: bandSeen.commentKey })
      .from(bandSeen)
      .where(and(eq(bandSeen.sellerId, sellerId), eq(bandSeen.linkId, linkId), inArray(bandSeen.commentKey, unique.slice(start, start + CHUNK))))
    for (const row of rows) out.add(row.key)
  }
  return out
}

export interface BandSeenInput {
  readonly commentKey: string
  readonly kind: 'BASELINE' | 'RECORDED' | 'SKIPPED'
  readonly textHash?: string | null
  readonly nick?: string | null
  readonly text?: string | null
}

/** 본 댓글 적기 (이미 있으면 그대로) */
export async function insertBandSeen(db: Db, sellerId: string, linkId: number, rows: readonly BandSeenInput[], now: Date): Promise<void> {
  for (let start = 0; start < rows.length; start += CHUNK) {
    const chunk = rows.slice(start, start + CHUNK)
    await db
      .insert(bandSeen)
      .values(chunk.map((row) => ({ sellerId, linkId, commentKey: row.commentKey, kind: row.kind, textHash: row.textHash ?? null, nick: row.nick ?? null, text: row.text ?? null, createdAt: now })))
      .onConflictDoNothing({ target: [bandSeen.linkId, bandSeen.commentKey] })
  }
}

export interface BandRecordedRow {
  readonly id: number
  readonly commentKey: string
  readonly textHash: string | null
  readonly nick: string | null
  readonly text: string | null
  readonly deletedNoticed: boolean
  readonly editedHash: string | null
}

/** 이 연결에서 기록한 댓글 */
export async function recordedBandSeen(db: Db, sellerId: string, linkId: number): Promise<BandRecordedRow[]> {
  return db
    .select({ id: bandSeen.id, commentKey: bandSeen.commentKey, textHash: bandSeen.textHash, nick: bandSeen.nick, text: bandSeen.text, deletedNoticed: bandSeen.deletedNoticed, editedHash: bandSeen.editedHash })
    .from(bandSeen)
    .where(and(eq(bandSeen.sellerId, sellerId), eq(bandSeen.linkId, linkId), eq(bandSeen.kind, 'RECORDED')))
    .orderBy(asc(bandSeen.id))
}

export async function markBandSeen(db: Db, sellerId: string, id: number, patch: Partial<{ deletedNoticed: boolean; editedHash: string }>): Promise<void> {
  await db
    .update(bandSeen)
    .set(patch)
    .where(and(eq(bandSeen.sellerId, sellerId), eq(bandSeen.id, id)))
}

// ── 알림 ───────────────────────────────────────────────────────────────

export type BandNoticeKind = 'DELETED' | 'EDITED' | 'LATE' | 'STUCK'

export interface BandNoticeRow {
  readonly id: number
  readonly kind: BandNoticeKind
  readonly nick: string | null
  readonly beforeText: string | null
  readonly afterText: string | null
  readonly minutes: number | null
  readonly count: number | null
  readonly erased: boolean
  readonly createdAt: Date
}

export async function insertBandNotice(
  db: Db,
  row: { sellerId: string; linkId: number; kind: BandNoticeKind; nick?: string | null; beforeText?: string | null; afterText?: string | null; minutes?: number; count?: number; now: Date },
): Promise<number> {
  const inserted = await db
    .insert(bandNotices)
    .values({
      sellerId: row.sellerId,
      linkId: row.linkId,
      kind: row.kind,
      nick: row.nick ?? null,
      beforeText: row.beforeText ?? null,
      afterText: row.afterText ?? null,
      minutes: row.minutes ?? null,
      count: row.count ?? null,
      createdAt: row.now,
    })
    .returning({ id: bandNotices.id })
  return inserted[0]?.id as number
}

/** 막다른 경우 알림(STUCK)이 since(마지막으로 끝까지 닿은 읽기) 뒤에 이미 있는지 — 닿는 읽기가 성공할 때까지 한 번만 (AC-BND1-30) */
export async function bandStuckNoticed(db: Db, sellerId: string, linkId: number, since: Date | null): Promise<boolean> {
  const rows = await db
    .select({ id: bandNotices.id })
    .from(bandNotices)
    .where(and(eq(bandNotices.sellerId, sellerId), eq(bandNotices.linkId, linkId), eq(bandNotices.kind, 'STUCK'), ...(since === null ? [] : [gt(bandNotices.createdAt, since)])))
    .limit(1)
  return rows.length > 0
}

/** 최근 알림 (새것 먼저) · 전체 수 · 확인하지 않은 수(번호가 seen보다 큰 것 — 종류별) */
export async function bandNoticeSummary(
  db: Db,
  sellerId: string,
  linkId: number,
  seen: number,
  limit: number,
): Promise<{ items: BandNoticeRow[]; total: number; unseen: number; unseenEdits: number }> {
  const items = (await db
    .select({ id: bandNotices.id, kind: bandNotices.kind, nick: bandNotices.nick, beforeText: bandNotices.beforeText, afterText: bandNotices.afterText, minutes: bandNotices.minutes, count: bandNotices.count, erased: bandNotices.erased, createdAt: bandNotices.createdAt })
    .from(bandNotices)
    .where(and(eq(bandNotices.sellerId, sellerId), eq(bandNotices.linkId, linkId)))
    .orderBy(desc(bandNotices.id))
    .limit(limit)) as BandNoticeRow[]
  const counts = await db
    .select({
      total: sql<number>`count(*)::int`,
      unseen: sql<number>`count(*) filter (where ${bandNotices.id} > ${seen})::int`,
      unseenEdits: sql<number>`count(*) filter (where ${bandNotices.id} > ${seen} and ${bandNotices.kind} in ('DELETED', 'EDITED'))::int`,
    })
    .from(bandNotices)
    .where(and(eq(bandNotices.sellerId, sellerId), eq(bandNotices.linkId, linkId)))
  const row = counts[0]
  return { items, total: Number(row?.total ?? 0), unseen: Number(row?.unseen ?? 0), unseenEdits: Number(row?.unseenEdits ?? 0) }
}

/**
 * 보관 기간이 지난 손님 글 지우기 (D-BND1-14, D-LND1-11과 같은 규칙): 범위가 봉인됐거나 그 범위 날짜가 cutoffDate 이하인 연결의
 * 알림 닉네임·글과 본 댓글 표의 처음 글·닉네임을 지운다(cutoffDate = 오늘 KST − 30일, 그 날짜까지 포함). 지운 알림 수
 */
export async function eraseOldBandTexts(db: Db, cutoffDate: string): Promise<number> {
  const sealedLinks = db
    .select({ id: bandLinks.id })
    .from(bandLinks)
    .where(
      sql`${bandLinks.date} <= ${cutoffDate} or exists (select 1 from ${scopes} where ${scopes.sellerId} = ${bandLinks.sellerId} and ${scopes.date} = ${bandLinks.date} and ${scopes.rehearsal} = false and ${scopes.sealedAt} is not null)`,
    )
  const erased = await db
    .update(bandNotices)
    .set({ erased: true, nick: null, beforeText: null, afterText: null })
    .where(and(inArray(bandNotices.linkId, sealedLinks), inArray(bandNotices.kind, ['DELETED', 'EDITED']), eq(bandNotices.erased, false)))
    .returning({ id: bandNotices.id })
  await db
    .update(bandSeen)
    .set({ nick: null, text: null })
    .where(and(inArray(bandSeen.linkId, sealedLinks), sql`(${bandSeen.nick} is not null or ${bandSeen.text} is not null)`))
  return erased.length
}

/** 보관 기간 판단 (보기용 — 지우기 작업이 아직 돌지 않았어도 보이지 않게) */
export async function bandLinkTextsExpired(db: Db, sellerId: string, date: string, cutoffDate: string): Promise<boolean> {
  if (date <= cutoffDate) return true
  const rows = await db
    .select({ id: scopes.id })
    .from(scopes)
    .where(and(eq(scopes.sellerId, sellerId), eq(scopes.date, date), eq(scopes.rehearsal, false), sql`${scopes.sealedAt} is not null`))
    .limit(1)
  return rows.length > 0
}

