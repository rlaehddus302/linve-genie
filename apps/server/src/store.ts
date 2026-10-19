// 저장소 계층 (SYS-02). 판매자 데이터를 읽고 쓰는 질의는 모두 여기 있고, 모두 판매자 ID 조건을 건다.
// (범위 ID로 찾는 질의도 판매자 ID를 함께 건다 — 범위 ID를 잘못 넘겨도 다른 판매자 행이 섞이지 않게.)
// 트랜잭션 안에서는 트랜잭션 객체(tx)를 넘긴다(PGlite는 연결이 하나라 트랜잭션 밖 객체를 쓰면 기다리다 멈춘다).
import { and, asc, desc, eq, exists, gt, lt, sql } from 'drizzle-orm'
import type { Db } from './db/database.ts'
import { accounts, broadcasts, events, outbox, scopes, sellers, sessions, snapshots } from './db/schema.ts'

// ── 판매자·계정·세션 ─────────────────────────────────────────────────────

export interface SellerRow {
  readonly id: string
  readonly name: string
  readonly phoneKeyEnc: string
  readonly settings: string
}

export async function findSeller(db: Db, sellerId: string): Promise<SellerRow | null> {
  const rows = await db
    .select({ id: sellers.id, name: sellers.name, phoneKeyEnc: sellers.phoneKeyEnc, settings: sellers.settings })
    .from(sellers)
    .where(eq(sellers.id, sellerId))
    .limit(1)
  return rows[0] ?? null
}

export async function updateSellerSettings(db: Db, sellerId: string, settingsJson: string): Promise<void> {
  await db.update(sellers).set({ settings: settingsJson }).where(eq(sellers.id, sellerId))
}

export interface AccountRow {
  readonly id: string
  readonly sellerId: string
  readonly loginId: string
  readonly passwordHash: string
  readonly failedLogins: number
  readonly lockedUntil: Date | null
}

/** 로그인 아이디로 계정 찾기 (로그인 전이라 판매자를 모른다 — 아이디는 전체에서 유일하다) */
export async function findAccountByLogin(db: Db, loginId: string): Promise<AccountRow | null> {
  const rows = await db
    .select({
      id: accounts.id,
      sellerId: accounts.sellerId,
      loginId: accounts.loginId,
      passwordHash: accounts.passwordHash,
      failedLogins: accounts.failedLogins,
      lockedUntil: accounts.lockedUntil,
    })
    .from(accounts)
    .where(eq(accounts.loginId, loginId))
    .limit(1)
  return rows[0] ?? null
}

export async function setLoginFailures(db: Db, account: Pick<AccountRow, 'id' | 'sellerId'>, failedLogins: number, lockedUntil: Date | null): Promise<void> {
  await db
    .update(accounts)
    .set({ failedLogins, lockedUntil })
    .where(and(eq(accounts.id, account.id), eq(accounts.sellerId, account.sellerId)))
}

export interface SessionRow {
  readonly tokenHash: string
  readonly sellerId: string
  readonly accountId: string
  readonly expiresAt: Date
  readonly extendedAt: Date
  readonly loginId: string
  readonly sellerName: string
}

export async function insertSession(db: Db, row: { tokenHash: string; sellerId: string; accountId: string; now: Date; expiresAt: Date }): Promise<void> {
  await db.insert(sessions).values({
    tokenHash: row.tokenHash,
    sellerId: row.sellerId,
    accountId: row.accountId,
    createdAt: row.now,
    expiresAt: row.expiresAt,
    extendedAt: row.now,
  })
}

/** 만료되지 않은 세션 (계정·판매자 이름과 함께) */
export async function findSession(db: Db, tokenHashValue: string, now: Date): Promise<SessionRow | null> {
  const rows = await db
    .select({
      tokenHash: sessions.tokenHash,
      sellerId: sessions.sellerId,
      accountId: sessions.accountId,
      expiresAt: sessions.expiresAt,
      extendedAt: sessions.extendedAt,
      loginId: accounts.loginId,
      sellerName: sellers.name,
    })
    .from(sessions)
    .innerJoin(accounts, and(eq(accounts.id, sessions.accountId), eq(accounts.sellerId, sessions.sellerId)))
    .innerJoin(sellers, eq(sellers.id, sessions.sellerId))
    .where(and(eq(sessions.tokenHash, tokenHashValue), gt(sessions.expiresAt, now)))
    .limit(1)
  return rows[0] ?? null
}

export async function extendSession(db: Db, session: Pick<SessionRow, 'tokenHash' | 'sellerId'>, now: Date, expiresAt: Date): Promise<void> {
  await db
    .update(sessions)
    .set({ expiresAt, extendedAt: now })
    .where(and(eq(sessions.tokenHash, session.tokenHash), eq(sessions.sellerId, session.sellerId)))
}

export async function deleteSession(db: Db, session: Pick<SessionRow, 'tokenHash' | 'sellerId'>): Promise<void> {
  await db.delete(sessions).where(and(eq(sessions.tokenHash, session.tokenHash), eq(sessions.sellerId, session.sellerId)))
}

// ── 범위·방송 ────────────────────────────────────────────────────────────

export async function findScopeId(db: Db, sellerId: string, date: string): Promise<string | null> {
  const rows = await db
    .select({ id: scopes.id })
    .from(scopes)
    .where(and(eq(scopes.sellerId, sellerId), eq(scopes.date, date)))
    .limit(1)
  return rows[0]?.id ?? null
}

/** 범위 행을 만든다 (이미 있으면 그대로). 범위 ID를 돌려준다 */
export async function ensureScope(db: Db, sellerId: string, date: string, newId: string, now: Date): Promise<string> {
  await db.insert(scopes).values({ id: newId, sellerId, date, createdAt: now }).onConflictDoNothing({ target: [scopes.sellerId, scopes.date] })
  const id = await findScopeId(db, sellerId, date)
  if (id === null) throw new Error('범위를 만들지 못했다')
  return id
}

/** 그 날짜보다 이른 날짜 중 가장 늦은, 이벤트가 있는 범위 (차단 이어받기, AC-S04-27) */
export async function previousScopeDate(db: Db, sellerId: string, date: string): Promise<string | null> {
  const rows = await db
    .select({ date: scopes.date })
    .from(scopes)
    .where(
      and(
        eq(scopes.sellerId, sellerId),
        lt(scopes.date, date),
        exists(
          db
            .select({ one: sql`1` })
            .from(events)
            .where(and(eq(events.scopeId, scopes.id), eq(events.sellerId, sellerId))),
        ),
      ),
    )
    .orderBy(desc(scopes.date))
    .limit(1)
  return rows[0]?.date ?? null
}

/** 판매자의 범위별 지금 seq (이벤트가 있는 범위만, 날짜 순) */
export async function scopeSeqs(db: Db, sellerId: string): Promise<{ date: string; seq: number }[]> {
  const rows = await db
    .select({ date: scopes.date, seq: sql<number>`max(${events.seq})`.mapWith(Number) })
    .from(scopes)
    .innerJoin(events, and(eq(events.scopeId, scopes.id), eq(events.sellerId, sellerId)))
    .where(eq(scopes.sellerId, sellerId))
    .groupBy(scopes.date)
    .orderBy(asc(scopes.date))
  return rows
}

export interface BroadcastRow {
  readonly id: string
  readonly scopeId: string
  readonly date: string
  readonly title: string
  readonly startSeq: number
  readonly endedAt: Date | null
}

const broadcastColumns = {
  id: broadcasts.id,
  scopeId: broadcasts.scopeId,
  date: broadcasts.date,
  title: broadcasts.title,
  startSeq: broadcasts.startSeq,
  endedAt: broadcasts.endedAt,
}

export async function findBroadcast(db: Db, sellerId: string, broadcastId: string): Promise<BroadcastRow | null> {
  const rows = await db
    .select(broadcastColumns)
    .from(broadcasts)
    .where(and(eq(broadcasts.sellerId, sellerId), eq(broadcasts.id, broadcastId)))
    .limit(1)
  return rows[0] ?? null
}

export async function listBroadcastRows(db: Db, sellerId: string): Promise<BroadcastRow[]> {
  return db.select(broadcastColumns).from(broadcasts).where(eq(broadcasts.sellerId, sellerId)).orderBy(asc(broadcasts.date), asc(broadcasts.startSeq))
}

export async function insertBroadcast(
  db: Db,
  row: { id: string; sellerId: string; scopeId: string; date: string; title: string; startSeq: number; now: Date },
): Promise<void> {
  await db.insert(broadcasts).values({
    id: row.id,
    sellerId: row.sellerId,
    scopeId: row.scopeId,
    date: row.date,
    title: row.title,
    startSeq: row.startSeq,
    createdAt: row.now,
  })
}

export async function markBroadcastEnded(db: Db, sellerId: string, broadcastId: string, endedAt: Date): Promise<void> {
  await db
    .update(broadcasts)
    .set({ endedAt })
    .where(and(eq(broadcasts.sellerId, sellerId), eq(broadcasts.id, broadcastId)))
}

// ── 이벤트·발송함·스냅샷 ─────────────────────────────────────────────────

export interface EventRow {
  readonly seq: number
  readonly type: string
  readonly body: string
  readonly at: number
  readonly changed: boolean
  readonly failed: boolean
}

const eventColumns = { seq: events.seq, type: events.type, body: events.body, at: events.at, changed: events.changed, failed: events.failed }

/** 범위의 seq 뒤 이벤트, seq 순 */
export async function eventsAfter(db: Db, sellerId: string, scopeId: string, seq: number): Promise<EventRow[]> {
  return db
    .select(eventColumns)
    .from(events)
    .where(and(eq(events.sellerId, sellerId), eq(events.scopeId, scopeId), gt(events.seq, seq)))
    .orderBy(asc(events.seq))
}

/** 범위의 그 seq 이벤트 (없으면 null) */
export async function eventAtSeq(db: Db, sellerId: string, scopeId: string, seq: number): Promise<EventRow | null> {
  const rows = await db
    .select(eventColumns)
    .from(events)
    .where(and(eq(events.sellerId, sellerId), eq(events.scopeId, scopeId), eq(events.seq, seq)))
    .limit(1)
  return rows[0] ?? null
}

export interface RequestRecord extends EventRow {
  readonly date: string
  readonly scopeId: string
}

/** 요청 번호로 기록한 이벤트 (처음 결과를 다시 돌려줄 때) */
export async function eventByRequestId(db: Db, sellerId: string, requestId: string): Promise<RequestRecord | null> {
  const rows = await db
    .select({ ...eventColumns, date: scopes.date, scopeId: events.scopeId })
    .from(events)
    .innerJoin(scopes, and(eq(scopes.id, events.scopeId), eq(scopes.sellerId, sellerId)))
    .where(and(eq(events.sellerId, sellerId), eq(events.requestId, requestId)))
    .limit(1)
  return rows[0] ?? null
}

export async function chatEventSeq(db: Db, sellerId: string, broadcastId: string, messageId: string): Promise<number | null> {
  const rows = await db
    .select({ seq: events.seq })
    .from(events)
    .where(and(eq(events.sellerId, sellerId), eq(events.chatBroadcast, broadcastId), eq(events.chatMessageId, messageId)))
    .limit(1)
  return rows[0]?.seq ?? null
}

/** 그 seq의 이벤트가 낸 효과 ID, 나온 순서 */
export async function effectIdsAt(db: Db, sellerId: string, scopeId: string, seq: number): Promise<string[]> {
  const rows = await db
    .select({ effectId: outbox.effectId })
    .from(outbox)
    .where(and(eq(outbox.sellerId, sellerId), eq(outbox.scopeId, scopeId), eq(outbox.seq, seq)))
    .orderBy(asc(outbox.id))
  return rows.map((row) => row.effectId)
}

export interface NewEventRow {
  readonly sellerId: string
  readonly scopeId: string
  readonly seq: number
  readonly type: string
  readonly body: string
  readonly at: number
  readonly receivedAt: Date
  readonly actor: 'account' | 'server' | 'collector'
  readonly accountId: string | null
  readonly requestId: string | null
  readonly chatBroadcast: string | null
  readonly chatMessageId: string | null
  readonly smsRef: string | null
  readonly changed: boolean
  readonly failed: boolean
  readonly digest: string
}

export async function insertEvents(db: Db, rows: readonly NewEventRow[]): Promise<void> {
  if (rows.length > 0) await db.insert(events).values([...rows])
}

export interface NewOutboxRow {
  readonly sellerId: string
  readonly scopeId: string
  readonly effectId: string
  readonly seq: number
  readonly kind: string
  readonly body: string
  readonly createdAt: Date
}

export async function insertOutbox(db: Db, rows: readonly NewOutboxRow[]): Promise<void> {
  if (rows.length > 0) await db.insert(outbox).values([...rows])
}

export interface SnapshotRow {
  readonly seq: number
  readonly format: number
  readonly state: string
  readonly attention: string
}

/** 형식이 같은 마지막 스냅샷 */
export async function latestSnapshot(db: Db, sellerId: string, scopeId: string, format: number): Promise<SnapshotRow | null> {
  const rows = await db
    .select({ seq: snapshots.seq, format: snapshots.format, state: snapshots.state, attention: snapshots.attention })
    .from(snapshots)
    .where(and(eq(snapshots.sellerId, sellerId), eq(snapshots.scopeId, scopeId), eq(snapshots.format, format)))
    .orderBy(desc(snapshots.seq))
    .limit(1)
  return rows[0] ?? null
}

export async function insertSnapshot(
  db: Db,
  row: { sellerId: string; scopeId: string; seq: number; format: number; state: string; attention: string; now: Date },
): Promise<void> {
  await db
    .insert(snapshots)
    .values({
      sellerId: row.sellerId,
      scopeId: row.scopeId,
      seq: row.seq,
      format: row.format,
      state: row.state,
      attention: row.attention,
      createdAt: row.now,
    })
    .onConflictDoNothing({ target: [snapshots.scopeId, snapshots.seq] })
}

export interface HistoryRow {
  readonly seq: number
  readonly type: string
  readonly body: string
  readonly receivedAt: Date
  readonly actor: string
  readonly loginId: string | null
  readonly failed: boolean
}

/** 이력 조회: 범위의 이벤트, seq 순, after 뒤부터 limit개 (조치자 계정 아이디와 함께) */
export async function historyRows(db: Db, sellerId: string, scopeId: string, after: number, limit: number): Promise<HistoryRow[]> {
  return db
    .select({
      seq: events.seq,
      type: events.type,
      body: events.body,
      receivedAt: events.receivedAt,
      actor: events.actor,
      loginId: accounts.loginId,
      failed: events.failed,
    })
    .from(events)
    .leftJoin(accounts, and(eq(accounts.id, events.accountId), eq(accounts.sellerId, sellerId)))
    .where(and(eq(events.sellerId, sellerId), eq(events.scopeId, scopeId), gt(events.seq, after)))
    .orderBy(asc(events.seq))
    .limit(limit)
}
