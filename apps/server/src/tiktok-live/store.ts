// 틱톡 연결·동의·아이디·붙여넣기 요청 저장 (D-N2b-2-04·05·08). 모든 쿼리에 판매자 ID 조건을 건다(SYS-02).
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { accounts, broadcasts, chatRaw, events, pasteRequests, scopes, tiktokAccounts, tiktokConsents, tiktokLinks } from '../db/schema.ts'
import { syncOnVideoLink } from '../screen/catalog.ts'

// ── 아이디 ───────────────────────────────────────────────────────────────

export async function findTiktokId(db: Db, sellerId: string): Promise<string | null> {
  const rows = await db.select({ tiktokId: tiktokAccounts.tiktokId }).from(tiktokAccounts).where(eq(tiktokAccounts.sellerId, sellerId)).limit(1)
  return rows[0]?.tiktokId ?? null
}

export async function saveTiktokId(db: Db, sellerId: string, tiktokId: string, accountId: string, now: Date): Promise<void> {
  await db
    .insert(tiktokAccounts)
    .values({ sellerId, tiktokId, updatedAt: now, updatedBy: accountId })
    .onConflictDoUpdate({ target: tiktokAccounts.sellerId, set: { tiktokId, updatedAt: now, updatedBy: accountId } })
}

export async function deleteTiktokId(db: Db, sellerId: string): Promise<void> {
  await db.delete(tiktokAccounts).where(eq(tiktokAccounts.sellerId, sellerId))
}

// ── 동의 기록 ─────────────────────────────────────────────────────────────

export interface ConsentRow {
  readonly id: number
  readonly on: boolean
  readonly noticeVersion: string | null
  readonly at: Date
}

/** 그 판매자의 마지막 동의 기록 (없으면 null) */
export async function lastConsent(db: Db, sellerId: string): Promise<ConsentRow | null> {
  const rows = await db
    .select({ id: tiktokConsents.id, on: tiktokConsents.on, noticeVersion: tiktokConsents.noticeVersion, at: tiktokConsents.at })
    .from(tiktokConsents)
    .where(eq(tiktokConsents.sellerId, sellerId))
    .orderBy(desc(tiktokConsents.id))
    .limit(1)
  return rows[0] ?? null
}

export async function consentByRequest(db: Db, sellerId: string, requestId: string): Promise<ConsentRow | null> {
  const rows = await db
    .select({ id: tiktokConsents.id, on: tiktokConsents.on, noticeVersion: tiktokConsents.noticeVersion, at: tiktokConsents.at })
    .from(tiktokConsents)
    .where(and(eq(tiktokConsents.sellerId, sellerId), eq(tiktokConsents.requestId, requestId)))
    .limit(1)
  return rows[0] ?? null
}

export async function insertConsent(db: Db, row: { sellerId: string; accountId: string; on: boolean; noticeVersion: string | null; requestId: string; at: Date }): Promise<void> {
  await db.insert(tiktokConsents).values(row)
}

// ── 연결 ─────────────────────────────────────────────────────────────────

export interface TiktokLinkRow {
  readonly id: number
  readonly sellerId: string
  readonly broadcastId: string
  readonly scopeId: string
  readonly state: 'LINKED' | 'ENDED' | 'UNLINKED'
  readonly tiktokId: string
  readonly actorLoginId: string | null
  readonly linkedAt: Date
  readonly startedAt: Date
  readonly endedAt: Date | null
  readonly notRecorded: number
  readonly saveFailed: number
  readonly saveFailedSeen: number
  readonly skipped: number
  /** 확장 경로 (TTX, D-TTX-07·09): 기록 수 · 대기 수 · 마지막 확장 상태 (상태가 한 번도 없으면 extStatusAt null) */
  readonly extRecorded: number
  readonly extStandby: number
  readonly extStatusAt: Date | null
  readonly extScreen: string | null
  readonly extHidden: boolean
  readonly extRead: number
  readonly extUnread: number
  readonly extUnreadSince: Date | null
}

const linkColumns = {
  id: tiktokLinks.id,
  sellerId: tiktokLinks.sellerId,
  broadcastId: tiktokLinks.broadcastId,
  scopeId: tiktokLinks.scopeId,
  state: tiktokLinks.state,
  tiktokId: tiktokLinks.tiktokId,
  actorLoginId: accounts.loginId,
  linkedAt: tiktokLinks.linkedAt,
  startedAt: tiktokLinks.startedAt,
  endedAt: tiktokLinks.endedAt,
  notRecorded: tiktokLinks.notRecorded,
  saveFailed: tiktokLinks.saveFailed,
  saveFailedSeen: tiktokLinks.saveFailedSeen,
  skipped: tiktokLinks.skipped,
  extRecorded: tiktokLinks.extRecorded,
  extStandby: tiktokLinks.extStandby,
  extStatusAt: tiktokLinks.extStatusAt,
  extScreen: tiktokLinks.extScreen,
  extHidden: tiktokLinks.extHidden,
  extRead: tiktokLinks.extRead,
  extUnread: tiktokLinks.extUnread,
  extUnreadSince: tiktokLinks.extUnreadSince,
}

const linkQuery = (db: Db) => db.select(linkColumns).from(tiktokLinks).leftJoin(accounts, eq(accounts.id, tiktokLinks.actorAccountId))
const asRow = (row: Omit<TiktokLinkRow, 'state'> & { state: string }): TiktokLinkRow => row as TiktokLinkRow

/** 회차의 마지막 틱톡 연결 기록 (어느 상태든, 없으면 null) */
export async function latestTiktokLink(db: Db, sellerId: string, broadcastId: string): Promise<TiktokLinkRow | null> {
  const rows = await linkQuery(db)
    .where(and(eq(tiktokLinks.sellerId, sellerId), eq(tiktokLinks.broadcastId, broadcastId)))
    .orderBy(desc(tiktokLinks.id))
    .limit(1)
  return rows[0] === undefined ? null : asRow(rows[0])
}

/** 판매자의 이어진(LINKED) 틱톡 연결 — 모든 회차를 통틀어 많아야 하나 */
export async function sellerOpenTiktokLink(db: Db, sellerId: string): Promise<TiktokLinkRow | null> {
  const rows = await linkQuery(db)
    .where(and(eq(tiktokLinks.sellerId, sellerId), eq(tiktokLinks.state, 'LINKED')))
    .limit(1)
  return rows[0] === undefined ? null : asRow(rows[0])
}

export async function findTiktokLink(db: Db, sellerId: string, linkId: number): Promise<TiktokLinkRow | null> {
  const rows = await linkQuery(db)
    .where(and(eq(tiktokLinks.sellerId, sellerId), eq(tiktokLinks.id, linkId)))
    .limit(1)
  return rows[0] === undefined ? null : asRow(rows[0])
}

/** 그 회차에 틱톡 연결 기록이 있는지 (끊은 것 포함) */
export async function tiktokEverLinked(db: Db, sellerId: string, broadcastId: string): Promise<boolean> {
  const rows = await db
    .select({ id: tiktokLinks.id })
    .from(tiktokLinks)
    .where(and(eq(tiktokLinks.sellerId, sellerId), eq(tiktokLinks.broadcastId, broadcastId)))
    .limit(1)
  return rows.length > 0
}

/** 최근 연결한 틱톡 계정 한 곳 (D-RECENT-TT-01) */
export interface RecentTiktokRow {
  /** 틱톡 아이디 (@ 없이, 해석을 거친 것 — [a-z0-9._]) */
  readonly tiktokId: string
  /** 그 아이디를 가장 최근에 이은 때 */
  readonly linkedAt: Date
  /** 지금 그 아이디로 이어진(LINKED) 회차 — 없으면 null (판매자마다 많아야 하나) */
  readonly linkedBroadcast: string | null
  /** 프로필 사진을 물을 회차 (그 회차의 마지막 틱톡 연결이 이 아이디인 것 중 가장 최근) — 없으면 null */
  readonly photoBroadcast: string | null
}

/**
 * 판매자가 실제 회차에 이은 적 있는 틱톡 아이디, 최근 이은 순서 (D-RECENT-TT-01 — 유튜브 linkedChannels와 같은 셈: 끊은·끝난 연결도 센다).
 * 리허설에는 잇지 않으므로 모든 연결이 실제 회차다. 바깥에 묻지 않는다(라이브인지는 모른다)
 */
export async function recentTiktokAccounts(db: Db, sellerId: string, limit: number): Promise<RecentTiktokRow[]> {
  const rows = await db
    .select({ id: tiktokLinks.id, broadcastId: tiktokLinks.broadcastId, tiktokId: tiktokLinks.tiktokId, state: tiktokLinks.state, linkedAt: tiktokLinks.linkedAt })
    .from(tiktokLinks)
    .where(eq(tiktokLinks.sellerId, sellerId))
    .orderBy(desc(tiktokLinks.linkedAt), desc(tiktokLinks.id))
  // 회차마다 마지막 연결의 아이디 (회차의 틱톡 사진 경로가 보는 것 — latestTiktokLink와 같은 차례)
  const lastOfBroadcast = new Map<string, { id: number; tiktokId: string }>()
  for (const row of rows) {
    const before = lastOfBroadcast.get(row.broadcastId)
    if (before === undefined || row.id > before.id) lastOfBroadcast.set(row.broadcastId, { id: row.id, tiktokId: row.tiktokId })
  }
  const out: RecentTiktokRow[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (row.tiktokId === '' || seen.has(row.tiktokId)) continue
    seen.add(row.tiktokId)
    const mine = rows.filter((other) => other.tiktokId === row.tiktokId)
    out.push({
      tiktokId: row.tiktokId,
      linkedAt: row.linkedAt,
      linkedBroadcast: mine.find((other) => other.state === 'LINKED')?.broadcastId ?? null,
      photoBroadcast: mine.find((other) => lastOfBroadcast.get(other.broadcastId)?.tiktokId === row.tiktokId)?.broadcastId ?? null,
    })
    if (out.length >= limit) break
  }
  return out
}

export async function insertTiktokLink(
  db: Db,
  row: { sellerId: string; broadcastId: string; scopeId: string; tiktokId: string; actorAccountId: string; now: Date },
): Promise<number> {
  const inserted = await db
    .insert(tiktokLinks)
    .values({
      sellerId: row.sellerId,
      broadcastId: row.broadcastId,
      scopeId: row.scopeId,
      state: 'LINKED',
      tiktokId: row.tiktokId,
      actorAccountId: row.actorAccountId,
      linkedAt: row.now,
      startedAt: row.now,
      createdAt: row.now,
    })
    .returning({ id: tiktokLinks.id })
  // 같은 틱톡 라이브에 이은 다른 계정과 상품을 처음 맞추기 (D-SYNC2-01 — 유튜브 insertLink와 같은 표시, 라이브 열쇠 `@아이디`)
  await syncOnVideoLink(db, `@${row.tiktokId}`)
  return inserted[0]?.id as number
}

export async function unlinkTiktokLink(db: Db, sellerId: string, linkId: number, accountId: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(tiktokLinks)
    .set({ state: 'UNLINKED', unlinkedAt: now, unlinkedBy: accountId })
    .where(and(eq(tiktokLinks.sellerId, sellerId), eq(tiktokLinks.id, linkId), inArray(tiktokLinks.state, ['LINKED', 'ENDED'])))
    .returning({ id: tiktokLinks.id })
  return rows.length > 0
}

/** 다시 연결: 마지막으로 시작한 시각을 지금으로 (판매자마다 30초에 한 번 — 30초가 지났을 때만 바꾼다) */
export async function markStarted(db: Db, sellerId: string, linkId: number, now: Date, notBefore: Date): Promise<boolean> {
  const rows = await db
    .update(tiktokLinks)
    .set({ startedAt: now })
    .where(and(eq(tiktokLinks.sellerId, sellerId), eq(tiktokLinks.id, linkId), eq(tiktokLinks.state, 'LINKED'), sql`${tiktokLinks.startedAt} <= ${notBefore}`))
    .returning({ id: tiktokLinks.id })
  return rows.length > 0
}

/** 회차를 끝냈다: 그 회차의 이어진 연결을 ENDED로 (같은 트랜잭션에서 — broadcast.end와 함께) */
export async function endTiktokLinks(db: Db, sellerId: string, broadcastIds: readonly string[], now: Date): Promise<number[]> {
  if (broadcastIds.length === 0) return []
  const rows = await db
    .update(tiktokLinks)
    .set({ state: 'ENDED', endedAt: now })
    .where(and(eq(tiktokLinks.sellerId, sellerId), inArray(tiktokLinks.broadcastId, [...broadcastIds]), eq(tiktokLinks.state, 'LINKED')))
    .returning({ id: tiktokLinks.id })
  return rows.map((row) => row.id)
}

export type TiktokCounter = 'notRecorded' | 'saveFailed' | 'skipped'

export async function bumpTiktokCounter(db: Db, sellerId: string, linkId: number, counter: TiktokCounter, by: number): Promise<void> {
  if (by <= 0) return
  const set =
    counter === 'notRecorded'
      ? { notRecorded: sql`${tiktokLinks.notRecorded} + ${by}` }
      : counter === 'saveFailed'
        ? { saveFailed: sql`${tiktokLinks.saveFailed} + ${by}` }
        : { skipped: sql`${tiktokLinks.skipped} + ${by}` }
  await db
    .update(tiktokLinks)
    .set(set)
    .where(and(eq(tiktokLinks.sellerId, sellerId), eq(tiktokLinks.id, linkId)))
}

// ── 크롬 확장 경로 (TTX) ────────────────────────────────────────────────────

export type TiktokExtCounter = 'extRecorded' | 'extStandby'

/** 확장 경로의 기록 수·대기 수를 더한다 (그 판매자의 그 연결만) */
export async function bumpTiktokExtCounter(db: Db, sellerId: string, linkId: number, counter: TiktokExtCounter, by: number): Promise<void> {
  if (by <= 0) return
  const set = counter === 'extRecorded' ? { extRecorded: sql`least(${tiktokLinks.extRecorded}::bigint + ${by}, 2147483647)::int` } : { extStandby: sql`least(${tiktokLinks.extStandby}::bigint + ${by}, 2147483647)::int` }
  await db
    .update(tiktokLinks)
    .set(set)
    .where(and(eq(tiktokLinks.sellerId, sellerId), eq(tiktokLinks.id, linkId)))
}

/**
 * 확장이 버린 틱톡 댓글 수를 그 판매자의 이어진(LINKED) 그 연결의 저장 실패 수에 더한다 (D-TTX-16).
 * 다른 판매자의 연결·끝난 연결은 바꾸지 않는다. 더했으면 true
 */
export async function addTiktokExtDropped(db: Db, sellerId: string, linkId: number, by: number): Promise<boolean> {
  if (!Number.isSafeInteger(by) || by <= 0) return false
  const rows = await db
    .update(tiktokLinks)
    .set({ saveFailed: sql`least(${tiktokLinks.saveFailed}::bigint + ${by}, 2147483647)::int` })
    .where(and(eq(tiktokLinks.sellerId, sellerId), eq(tiktokLinks.id, linkId), eq(tiktokLinks.state, 'LINKED')))
    .returning({ id: tiktokLinks.id })
  return rows.length > 0
}

/** 서버가 다시 켜질 때 확장 상태 예약을 다시 걸 연결: 이어진(LINKED) 연결 중 확장 상태가 있는 것 (RA-TTX-03) */
export async function linkedTiktokExtStatuses(db: Db): Promise<TiktokLinkRow[]> {
  const rows = await linkQuery(db)
    .where(and(eq(tiktokLinks.state, 'LINKED'), isNotNull(tiktokLinks.extStatusAt)))
    .orderBy(asc(tiktokLinks.id))
  return rows.map(asRow)
}

export interface TiktokExtStatus {
  readonly statusAt: Date
  readonly screen: string
  readonly hidden: boolean
  readonly read: number
  readonly unread: number
  readonly unreadSince: Date | null
}

/** 마지막 확장 상태를 그 연결(이어진 것만)에 쓴다. 이어진 연결이 아니면 false */
export async function writeTiktokExtStatus(db: Db, sellerId: string, linkId: number, status: TiktokExtStatus): Promise<boolean> {
  const rows = await db
    .update(tiktokLinks)
    .set({ extStatusAt: status.statusAt, extScreen: status.screen, extHidden: status.hidden, extRead: status.read, extUnread: status.unread, extUnreadSince: status.unreadSince })
    .where(and(eq(tiktokLinks.sellerId, sellerId), eq(tiktokLinks.id, linkId), eq(tiktokLinks.state, 'LINKED')))
    .returning({ id: tiktokLinks.id })
  return rows.length > 0
}

/** 확장 연결을 끊었다: 그 판매자의 이어진 연결의 확장 상태를 비운다 (기록 수·대기 수는 둔다). 비운 연결의 회차 */
export async function clearTiktokExtStatus(db: Db, sellerId: string): Promise<string[]> {
  const rows = await db
    .update(tiktokLinks)
    .set({ extStatusAt: null, extScreen: null, extHidden: false, extRead: 0, extUnread: 0, extUnreadSince: null })
    .where(and(eq(tiktokLinks.sellerId, sellerId), eq(tiktokLinks.state, 'LINKED'), sql`${tiktokLinks.extStatusAt} is not null`))
    .returning({ broadcastId: tiktokLinks.broadcastId })
  return rows.map((row) => row.broadcastId)
}

/**
 * 저장 실패 확인 (D-N2b-2-16): 그 회차의 이어진(LINKED) 연결의 saveFailedSeen = max(지금, min(upTo, saveFailed)).
 * 한 문장으로 바꿔 동시에 늘어나는 saveFailed와 겹쳐도 확인 수가 실패 수를 넘지 않고 줄지 않는다(같은 요청 두 번 = 같은 결과).
 * 이어진 연결이 없으면 null
 */
export async function markSaveFailedSeen(db: Db, sellerId: string, broadcastId: string, upTo: number): Promise<number | null> {
  const rows = await db
    .update(tiktokLinks)
    .set({ saveFailedSeen: sql`greatest(${tiktokLinks.saveFailedSeen}, least(${upTo}::int, ${tiktokLinks.saveFailed}))` })
    .where(and(eq(tiktokLinks.sellerId, sellerId), eq(tiktokLinks.broadcastId, broadcastId), eq(tiktokLinks.state, 'LINKED')))
    .returning({ id: tiktokLinks.id })
  return rows[0]?.id ?? null
}

/** 서버가 다시 켜질 때 이어받을 연결: 끝나지 않은 실제 회차의 이어진 틱톡 연결 */
export async function resumableTiktokLinks(db: Db): Promise<TiktokLinkRow[]> {
  const rows = await db
    .select(linkColumns)
    .from(tiktokLinks)
    .leftJoin(accounts, eq(accounts.id, tiktokLinks.actorAccountId))
    .innerJoin(broadcasts, and(eq(broadcasts.id, tiktokLinks.broadcastId), eq(broadcasts.sellerId, tiktokLinks.sellerId)))
    .innerJoin(scopes, and(eq(scopes.id, broadcasts.scopeId), eq(scopes.sellerId, tiktokLinks.sellerId), eq(scopes.rehearsal, false)))
    .where(and(eq(tiktokLinks.state, 'LINKED'), isNull(broadcasts.endedAt)))
    .orderBy(asc(tiktokLinks.id))
  return rows.map(asRow)
}

/** 이 회차에 기록한 틱톡 댓글 수·마지막으로 기록한 시각 */
export async function tiktokChatStats(db: Db, sellerId: string, broadcastId: string): Promise<{ count: number; lastAt: Date | null }> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int`, lastAt: sql<Date | null>`max(${events.receivedAt})` })
    .from(events)
    .where(and(eq(events.sellerId, sellerId), eq(events.chatBroadcast, broadcastId), sql`${events.chatMessageId} LIKE 'tt:%'`))
  const row = rows[0]
  const lastAt = row?.lastAt ?? null
  return { count: row?.count ?? 0, lastAt: lastAt === null ? null : new Date(lastAt) }
}

/** 운영 상태: 이어진·끝낸 틱톡 연결 수 (판매자 정보 없이) */
export async function tiktokLinkCounts(db: Db): Promise<Record<string, number>> {
  const rows = await db
    .select({ state: tiktokLinks.state, n: sql<number>`count(*)::int` })
    .from(tiktokLinks)
    .where(eq(tiktokLinks.state, 'LINKED'))
    .groupBy(tiktokLinks.state)
  const out: Record<string, number> = {}
  for (const row of rows) out[row.state] = Number(row.n)
  return out
}

// ── 붙여넣기 요청 ───────────────────────────────────────────────────────────

export async function findPasteRequest(db: Db, sellerId: string, requestId: string): Promise<{ broadcastId: string; digest: string; result: string } | null> {
  const rows = await db
    .select({ broadcastId: pasteRequests.broadcastId, digest: pasteRequests.digest, result: pasteRequests.result })
    .from(pasteRequests)
    .where(and(eq(pasteRequests.sellerId, sellerId), eq(pasteRequests.requestId, requestId)))
    .limit(1)
  return rows[0] ?? null
}

export async function insertPasteRequest(db: Db, row: { sellerId: string; requestId: string; broadcastId: string; digest: string; result: string; now: Date }): Promise<void> {
  await db.insert(pasteRequests).values({ sellerId: row.sellerId, requestId: row.requestId, broadcastId: row.broadcastId, digest: row.digest, result: row.result, createdAt: row.now })
}

// ── 붙여넣기 겹침 (D-N2b-2-14, AC-N2b-2-54) ─────────────────────────────

/**
 * 찜을 만든 입력의 이름: 그 범위(판매자·날짜·실제/리허설)에서 seq가 주어진 것 중 채팅이면 댓글 단 사람 닉네임(따로 둔 이름 — 없으면 본문),
 * 문자찜이면 메모. 정리하지 않은 값 그대로 돌려준다(정리는 부르는 쪽). 다른 종류·이름 없는 입력은 넣지 않는다. 봉인으로 이름을 지운 채팅은 없음
 */
export async function inputNamesBySeq(db: Db, sellerId: string, date: string, rehearsal: boolean, seqs: readonly number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  if (seqs.length === 0) return out
  const unique = [...new Set(seqs)]
  for (let start = 0; start < unique.length; start += 500) {
    const rows = await db
      .select({ seq: events.seq, type: events.type, body: events.body, raw: events.raw, rawNick: chatRaw.nick })
      .from(events)
      .innerJoin(scopes, and(eq(scopes.id, events.scopeId), eq(scopes.sellerId, events.sellerId)))
      .leftJoin(chatRaw, and(eq(chatRaw.scopeId, events.scopeId), eq(chatRaw.seq, events.seq), eq(chatRaw.sellerId, events.sellerId)))
      .where(
        and(
          eq(events.sellerId, sellerId),
          eq(scopes.date, date),
          eq(scopes.rehearsal, rehearsal),
          inArray(events.seq, unique.slice(start, start + 500)),
          inArray(events.type, ['chat', 'sms']),
          eq(events.failed, false),
        ),
      )
    for (const row of rows) {
      const name = row.type === 'chat' ? (row.raw ? row.rawNick : nameField(row.body, 'nick')) : nameField(row.body, 'memo')
      if (typeof name === 'string') out.set(row.seq, name)
    }
  }
  return out
}

function nameField(body: string, key: 'nick' | 'memo'): string | null {
  try {
    const value = (JSON.parse(body) as Record<string, unknown>)[key]
    return typeof value === 'string' ? value : null
  } catch {
    return null
  }
}
