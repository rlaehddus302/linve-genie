// 저장소 계층 (SYS-02). 판매자 데이터를 읽고 쓰는 질의는 모두 여기 있고, 모두 판매자 ID 조건을 건다.
// (범위 ID로 찾는 질의도 판매자 ID를 함께 건다 — 범위 ID를 잘못 넘겨도 다른 판매자 행이 섞이지 않게.)
// 트랜잭션 안에서는 트랜잭션 객체(tx)를 넘긴다(PGlite는 연결이 하나라 트랜잭션 밖 객체를 쓰면 기다리다 멈춘다).
import { and, asc, desc, eq, gt, inArray, isNull, like, lt, lte, or, sql } from 'drizzle-orm'
import type { Db } from './db/database.ts'
import { accounts, broadcasts, chatRaw, events, loginLimits, outbox, scopes, sellers, sessions, snapshots } from './db/schema.ts'

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
}

/** 로그인 아이디로 계정 찾기 (로그인 전이라 판매자를 모른다 — 아이디는 전체에서 유일하다) */
export async function findAccountByLogin(db: Db, loginId: string): Promise<AccountRow | null> {
  const rows = await db
    .select({
      id: accounts.id,
      sellerId: accounts.sellerId,
      loginId: accounts.loginId,
      passwordHash: accounts.passwordHash,
    })
    .from(accounts)
    .where(eq(accounts.loginId, loginId))
    .limit(1)
  return rows[0] ?? null
}

// ── 로그인 시도 수 (판매자 데이터 아님 — 있는 아이디·없는 아이디를 같은 질의로 센다, D-074) ──────────

/**
 * 비밀번호를 확인하기 전에 시도 자리 하나를 원자적으로 잡는다 (한 문장 — 동시에 온 요청도 한 줄로 센다).
 * 잠겨 있으면 null. 잡았으면 그 시도의 번호(1부터, 확인 중인 시도 포함)를 돌려준다.
 * 잠금이 지난 행은 1부터 다시 센다. 번호가 limit에 닿으면 그 자리에서 lockUntil까지 잠근다(맞는 비밀번호였으면 releaseLoginAttempt가 푼다).
 */
export async function claimLoginAttempt(db: Db, key: string, now: Date, lockUntil: Date, limit: number): Promise<number | null> {
  const nowText = now.toISOString()
  const next = sql`CASE WHEN ${loginLimits.lockedUntil} IS NOT NULL THEN 1 ELSE ${loginLimits.failures} + 1 END`
  const rows = await db
    .insert(loginLimits)
    .values({ key, failures: 1, lockedUntil: limit <= 1 ? lockUntil : null, updatedAt: now })
    .onConflictDoUpdate({
      target: loginLimits.key,
      set: {
        failures: next,
        lockedUntil: sql`CASE WHEN ${next} >= ${limit} THEN ${lockUntil.toISOString()}::timestamptz ELSE NULL END`,
        updatedAt: now,
      },
      // 잠금 중이면 바꾸지 않는다(행이 돌아오지 않는다 → 잠김). 실패 수도 잠금이 풀린 뒤에야 1부터 다시 센다
      setWhere: sql`${loginLimits.lockedUntil} IS NULL OR ${loginLimits.lockedUntil} <= ${nowText}::timestamptz`,
    })
    .returning({ failures: loginLimits.failures })
  return rows[0]?.failures ?? null
}

/**
 * 맞는 비밀번호: 이 시도와 그 앞의 실패를 지운다. 이 시도 뒤에 잡힌(아직 확인 중인) 시도만 남는다 — 차례대로 왔다면 0.
 * 남은 수는 한도보다 작으므로(한도에 닿은 뒤로는 자리를 잡을 수 없다) 잠금도 푼다.
 */
export async function releaseLoginAttempt(db: Db, key: string, attempt: number): Promise<void> {
  const deleted = await db
    .delete(loginLimits)
    .where(and(eq(loginLimits.key, key), lte(loginLimits.failures, attempt)))
    .returning({ key: loginLimits.key })
  if (deleted.length > 0) return
  await db
    .update(loginLimits)
    .set({ failures: sql`GREATEST(${loginLimits.failures} - ${attempt}, 0)`, lockedUntil: null })
    .where(eq(loginLimits.key, key))
}

/**
 * 시도 수 표 정리. 있는 아이디·없는 아이디를 가리지 않고 같은 규칙이다(정리로 아이디가 있는지 갈리지 않는다).
 * 1. 잠금이 지난 행·0인 행: 없는 것과 같다(다음 시도가 1부터 센다).
 * 2. 잠기지 않은 행이 keep개를 넘으면 마지막 시도가 오래된 것부터 지운다. 잠긴 행은 잠금이 끝날 때까지 지우지 않는다.
 * 지운 행 수를 돌려준다.
 */
export async function pruneLoginLimits(db: Db, now: Date, keep: number): Promise<number> {
  const nowText = now.toISOString()
  const spent = await db
    .delete(loginLimits)
    .where(sql`${loginLimits.lockedUntil} <= ${nowText}::timestamptz OR (${loginLimits.lockedUntil} IS NULL AND ${loginLimits.failures} <= 0)`)
    .returning({ key: loginLimits.key })
  const stale = db
    .select({ key: loginLimits.key })
    .from(loginLimits)
    .where(isNull(loginLimits.lockedUntil))
    .orderBy(desc(loginLimits.updatedAt), desc(loginLimits.key))
    .offset(keep)
  const old = await db.delete(loginLimits).where(inArray(loginLimits.key, stale)).returning({ key: loginLimits.key })
  return spent.length + old.length
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
// 범위 = (판매자, 날짜, 리허설인지) (D-069, D-081). 리허설을 적지 않은 조회는 실제 범위다.

export async function findScopeId(db: Db, sellerId: string, date: string, rehearsal = false): Promise<string | null> {
  const rows = await db
    .select({ id: scopes.id })
    .from(scopes)
    .where(and(eq(scopes.sellerId, sellerId), eq(scopes.date, date), eq(scopes.rehearsal, rehearsal)))
    .limit(1)
  return rows[0]?.id ?? null
}

/** 범위 행 (ID·지금 seq·봉인 시각) — 없으면 null */
export async function scopeRow(db: Db, sellerId: string, date: string, rehearsal = false): Promise<{ id: string; seq: number; sealedAt: Date | null } | null> {
  const rows = await db
    .select({ id: scopes.id, seq: scopes.seq, sealedAt: scopes.sealedAt })
    .from(scopes)
    .where(and(eq(scopes.sellerId, sellerId), eq(scopes.date, date), eq(scopes.rehearsal, rehearsal)))
    .limit(1)
  return rows[0] ?? null
}

/** 범위 행을 만든다 (이미 있으면 그대로). 범위 ID를 돌려준다 */
export async function ensureScope(db: Db, sellerId: string, date: string, rehearsal: boolean, newId: string, now: Date): Promise<string> {
  await db
    .insert(scopes)
    .values({ id: newId, sellerId, date, rehearsal, createdAt: now })
    .onConflictDoNothing({ target: [scopes.sellerId, scopes.date, scopes.rehearsal] })
  const id = await findScopeId(db, sellerId, date, rehearsal)
  if (id === null) throw new Error('범위를 만들지 못했다')
  return id
}

/** 범위의 지금 seq를 적는다 (이벤트를 커밋하는 같은 트랜잭션 안에서, AC-S05-60) */
export async function setScopeSeq(db: Db, sellerId: string, scopeId: string, seq: number): Promise<void> {
  await db
    .update(scopes)
    .set({ seq })
    .where(and(eq(scopes.sellerId, sellerId), eq(scopes.id, scopeId)))
}

/**
 * 그 날짜보다 이른 날짜 중 가장 늦은, 이벤트가 있는 **실제** 범위 (차단 이어받기, AC-S04-27).
 * 리허설 범위는 넘겨주지 않는다 (D-081, AC-S05-50)
 */
export async function previousScopeDate(db: Db, sellerId: string, date: string): Promise<string | null> {
  const rows = await db
    .select({ date: scopes.date })
    .from(scopes)
    .where(and(eq(scopes.sellerId, sellerId), eq(scopes.rehearsal, false), lt(scopes.date, date), gt(scopes.seq, 0)))
    .orderBy(desc(scopes.date))
    .limit(1)
  return rows[0]?.date ?? null
}

export interface ScopeSeqRow {
  readonly date: string
  readonly rehearsal: boolean
  readonly seq: number
}

/**
 * 판매자의 범위별 지금 seq (이벤트가 있는 범위만, 날짜·실제 먼저 순). 범위 행의 seq 칸을 읽는다 — 이벤트 표를 모으지 않는다 (AC-S05-60).
 * rehearsal을 주면 그쪽 범위만
 */
export async function scopeSeqs(db: Db, sellerId: string, rehearsal?: boolean): Promise<ScopeSeqRow[]> {
  return db
    .select({ date: scopes.date, rehearsal: scopes.rehearsal, seq: scopes.seq })
    .from(scopes)
    .where(and(eq(scopes.sellerId, sellerId), gt(scopes.seq, 0), rehearsal === undefined ? undefined : eq(scopes.rehearsal, rehearsal)))
    .orderBy(asc(scopes.date), asc(scopes.rehearsal))
}

/** 판매자의 범위별 봉인 정보 (범위 목록의 sealAt·sealed) */
export async function scopeSealRows(db: Db, sellerId: string): Promise<{ date: string; rehearsal: boolean; youtubeChat: boolean; sealedAt: Date | null }[]> {
  return db
    .select({ date: scopes.date, rehearsal: scopes.rehearsal, youtubeChat: scopes.youtubeChat, sealedAt: scopes.sealedAt })
    .from(scopes)
    .where(eq(scopes.sellerId, sellerId))
}

export interface BroadcastRow {
  readonly id: string
  readonly scopeId: string
  readonly date: string
  /** 그 방송의 범위가 리허설 범위인지 (방송을 만들 때 정하고 바뀌지 않는다, D-081) */
  readonly rehearsal: boolean
  readonly title: string
  readonly startSeq: number
  readonly endedAt: Date | null
}

const broadcastColumns = {
  id: broadcasts.id,
  scopeId: broadcasts.scopeId,
  date: broadcasts.date,
  rehearsal: scopes.rehearsal,
  title: broadcasts.title,
  startSeq: broadcasts.startSeq,
  endedAt: broadcasts.endedAt,
}

export async function findBroadcast(db: Db, sellerId: string, broadcastId: string): Promise<BroadcastRow | null> {
  const rows = await db
    .select(broadcastColumns)
    .from(broadcasts)
    .innerJoin(scopes, and(eq(scopes.id, broadcasts.scopeId), eq(scopes.sellerId, sellerId)))
    .where(and(eq(broadcasts.sellerId, sellerId), eq(broadcasts.id, broadcastId)))
    .limit(1)
  return rows[0] ?? null
}

export async function listBroadcastRows(db: Db, sellerId: string): Promise<BroadcastRow[]> {
  return db
    .select(broadcastColumns)
    .from(broadcasts)
    .innerJoin(scopes, and(eq(scopes.id, broadcasts.scopeId), eq(scopes.sellerId, sellerId)))
    .where(eq(broadcasts.sellerId, sellerId))
    .orderBy(asc(broadcasts.date), asc(scopes.rehearsal), asc(broadcasts.startSeq))
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

/** 따로 둔 채팅 본문·이름 (AC-Y1-60) — 이벤트와 같은 범위·seq, 같은 판매자 */
const rawJoin = and(eq(chatRaw.scopeId, events.scopeId), eq(chatRaw.seq, events.seq), eq(chatRaw.sellerId, events.sellerId))
const rawColumns = { rawNick: chatRaw.nick, rawText: chatRaw.text }

/**
 * 따로 둔 본문·이름을 이벤트 본문에 다시 합친다 (재생·조회는 Y1 전과 같은 모양을 본다). 따로 둔 값이 없으면(Y1 전 기록·봉인 뒤) 그대로
 */
export function mergeRaw(body: string, nick: string | null, text: string | null): string {
  if (nick === null || text === null) return body
  const event = JSON.parse(body) as Record<string, unknown>
  return JSON.stringify({ ...event, nick, text })
}

function withRaw<T extends { body: string; rawNick: string | null; rawText: string | null }>(row: T): Omit<T, 'rawNick' | 'rawText'> {
  const { rawNick, rawText, ...rest } = row
  return { ...rest, body: mergeRaw(row.body, rawNick, rawText) }
}

/** 범위의 seq 뒤 이벤트, seq 순 (채팅은 따로 둔 본문·이름을 합친 본문) */
export async function eventsAfter(db: Db, sellerId: string, scopeId: string, seq: number): Promise<EventRow[]> {
  const rows = await db
    .select({ ...eventColumns, ...rawColumns })
    .from(events)
    .leftJoin(chatRaw, rawJoin)
    .where(and(eq(events.sellerId, sellerId), eq(events.scopeId, scopeId), gt(events.seq, seq)))
    .orderBy(asc(events.seq))
  return rows.map(withRaw)
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
  readonly rehearsal: boolean
  readonly scopeId: string
}

/** 요청 번호로 기록한 이벤트 (처음 결과를 다시 돌려줄 때) */
export async function eventByRequestId(db: Db, sellerId: string, requestId: string): Promise<RequestRecord | null> {
  const rows = await db
    .select({ ...eventColumns, date: scopes.date, rehearsal: scopes.rehearsal, scopeId: events.scopeId })
    .from(events)
    .innerJoin(scopes, and(eq(scopes.id, events.scopeId), eq(scopes.sellerId, sellerId)))
    .where(and(eq(events.sellerId, sellerId), eq(events.requestId, requestId)))
    .limit(1)
  return rows[0] ?? null
}

/** 그 방송의 이 메시지 ID들 중 이미 기록된 것 (유튜브 수집기의 한 응답, 트랜잭션 안에서) */
export async function existingChatIds(db: Db, sellerId: string, broadcastId: string, messageIds: readonly string[]): Promise<Set<string>> {
  const found = new Set<string>()
  for (let start = 0; start < messageIds.length; start += 500) {
    const part = messageIds.slice(start, start + 500)
    const rows = await db
      .select({ id: events.chatMessageId })
      .from(events)
      .where(and(eq(events.sellerId, sellerId), eq(events.chatBroadcast, broadcastId), inArray(events.chatMessageId, [...part])))
    for (const row of rows) if (row.id !== null) found.add(row.id)
  }
  return found
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
  /** 채팅이 어디서 왔는지 (채팅만) */
  readonly chatSource: string | null
  /** 본문·이름을 chat_raw에 따로 두었는지 */
  readonly raw: boolean
}

export async function insertEvents(db: Db, rows: readonly NewEventRow[]): Promise<void> {
  for (let start = 0; start < rows.length; start += 1000) await db.insert(events).values(rows.slice(start, start + 1000))
}

export interface ChatRawRow {
  readonly sellerId: string
  readonly scopeId: string
  readonly seq: number
  readonly nick: string
  readonly text: string
}

/** 채팅 본문·이름 (이벤트와 같은 트랜잭션, AC-Y1-60) */
export async function insertChatRaw(db: Db, rows: readonly ChatRawRow[]): Promise<void> {
  for (let start = 0; start < rows.length; start += 1000) await db.insert(chatRaw).values(rows.slice(start, start + 1000))
}

/** 이 범위에 유튜브 수집기 채팅이 있다 (봉인 대상, AC-Y1-61) */
export async function markYoutubeChat(db: Db, sellerId: string, scopeId: string): Promise<void> {
  await db
    .update(scopes)
    .set({ youtubeChat: true })
    .where(and(eq(scopes.sellerId, sellerId), eq(scopes.id, scopeId), eq(scopes.youtubeChat, false)))
}

/** 범위를 봉인한 시각 (봉인하지 않았으면 null) */
export async function scopeSealedAt(db: Db, sellerId: string, scopeId: string): Promise<Date | null> {
  const rows = await db
    .select({ sealedAt: scopes.sealedAt })
    .from(scopes)
    .where(and(eq(scopes.sellerId, sellerId), eq(scopes.id, scopeId)))
    .limit(1)
  return rows[0]?.sealedAt ?? null
}

export interface SealInfo {
  readonly scopeId: string
  readonly youtubeChat: boolean
  readonly sealedAt: Date | null
  readonly ledger: string | null
  readonly ledgerDigest: string | null
}

/** 날짜로 고른 범위의 봉인 정보 (범위가 없으면 null) */
export async function scopeSealInfo(db: Db, sellerId: string, date: string, rehearsal: boolean): Promise<SealInfo | null> {
  const rows = await db
    .select({ scopeId: scopes.id, youtubeChat: scopes.youtubeChat, sealedAt: scopes.sealedAt, ledger: scopes.ledger, ledgerDigest: scopes.ledgerDigest })
    .from(scopes)
    .where(and(eq(scopes.sellerId, sellerId), eq(scopes.date, date), eq(scopes.rehearsal, rehearsal)))
    .limit(1)
  return rows[0] ?? null
}

export interface NewOutboxRow {
  readonly sellerId: string
  readonly scopeId: string
  readonly effectId: string
  readonly seq: number
  readonly kind: string
  readonly body: string
  /** 리허설 범위의 효과 (실행하지 않는다, D-081) */
  readonly rehearsal: boolean
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
  /** 엔진이 상태를 바꿨는지 (기록할 때의 결과) */
  readonly changed: boolean
  readonly failed: boolean
}

const historyColumns = {
  seq: events.seq,
  type: events.type,
  body: events.body,
  receivedAt: events.receivedAt,
  actor: events.actor,
  loginId: accounts.loginId,
  changed: events.changed,
  failed: events.failed,
}

/** 이력 조회: 범위의 이벤트, seq 순, after 뒤부터 limit개 (조치자 계정 아이디와 함께, 채팅은 따로 둔 본문·이름을 합친다) */
export async function historyRows(db: Db, sellerId: string, scopeId: string, after: number, limit: number): Promise<HistoryRow[]> {
  const rows = await db
    .select({ ...historyColumns, ...rawColumns })
    .from(events)
    .leftJoin(accounts, and(eq(accounts.id, events.accountId), eq(accounts.sellerId, sellerId)))
    .leftJoin(chatRaw, rawJoin)
    .where(and(eq(events.sellerId, sellerId), eq(events.scopeId, scopeId), gt(events.seq, after)))
    .orderBy(asc(events.seq))
    .limit(limit)
  return rows.map(withRaw)
}

/**
 * 상품 명령·방송자 조치(product.*·host.*)만, seq 순, after 뒤부터 limit개 — 상품별 조치 기록을 거를 때 차례로 읽는다 (AC-S05-35, AC-S06-70).
 * upTo를 주면 그 seq까지만(조회가 잡아 둔 범위 상태의 seq)
 */
export async function actionRows(db: Db, sellerId: string, scopeId: string, after: number, limit: number, upTo?: number): Promise<HistoryRow[]> {
  return db
    .select(historyColumns)
    .from(events)
    .leftJoin(accounts, and(eq(accounts.id, events.accountId), eq(accounts.sellerId, sellerId)))
    .where(
      and(
        eq(events.sellerId, sellerId),
        eq(events.scopeId, scopeId),
        gt(events.seq, after),
        ...(upTo === undefined ? [] : [lte(events.seq, upTo)]),
        or(like(events.type, 'product.%'), like(events.type, 'host.%')),
      ),
    )
    .orderBy(asc(events.seq))
    .limit(limit)
}

// ── 채팅 메시지 이어 받기 (AC-S05-20) ─────────────────────────────────────

export interface ChatRow {
  readonly seq: number
  readonly body: string
  readonly failed: boolean
}

/**
 * 범위의 채팅 이벤트 (방송을 주면 그 방송만). after를 주면 그 뒤 limit개(오름차순), before를 주면 그 앞의 가장 최근 limit개,
 * 둘 다 없으면 가장 최근 limit개 — 돌려주는 순서는 늘 seq 오름차순이다. limit보다 하나 더 읽어 더 있는지 알린다
 */
export async function chatRows(
  db: Db,
  sellerId: string,
  scopeId: string,
  options: { readonly b?: string; readonly after?: number; readonly before?: number; readonly limit: number },
): Promise<{ rows: ChatRow[]; more: boolean }> {
  const conditions = [eq(events.sellerId, sellerId), eq(events.scopeId, scopeId), eq(events.type, 'chat')]
  if (options.b !== undefined) conditions.push(eq(events.chatBroadcast, options.b))
  if (options.after !== undefined) conditions.push(gt(events.seq, options.after))
  if (options.before !== undefined) conditions.push(lt(events.seq, options.before))
  const ascending = options.after !== undefined
  const rows = await db
    .select({ seq: events.seq, body: events.body, failed: events.failed, ...rawColumns })
    .from(events)
    .leftJoin(chatRaw, rawJoin)
    .where(and(...conditions))
    .orderBy(ascending ? asc(events.seq) : desc(events.seq))
    .limit(options.limit + 1)
  const more = rows.length > options.limit
  const kept = rows.slice(0, options.limit).map(withRaw)
  return { rows: ascending ? kept : kept.reverse(), more }
}

/** 그 메시지들의 채팅 이벤트 (방송, 메시지 ID로 — 바뀐 메시지를 다시 보낼 때) */
export async function chatRowsByIds(db: Db, sellerId: string, scopeId: string, keys: readonly { readonly b: string; readonly id: string }[]): Promise<ChatRow[]> {
  if (keys.length === 0) return []
  const rows = await db
    .select({ seq: events.seq, body: events.body, failed: events.failed, ...rawColumns })
    .from(events)
    .leftJoin(chatRaw, rawJoin)
    .where(
      and(
        eq(events.sellerId, sellerId),
        eq(events.scopeId, scopeId),
        eq(events.type, 'chat'),
        or(...keys.map((key) => and(eq(events.chatBroadcast, key.b), eq(events.chatMessageId, key.id)))),
      ),
    )
    .orderBy(asc(events.seq))
  return rows.map(withRaw)
}
