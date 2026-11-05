// 저장소 계층 (SYS-02). 판매자 데이터를 읽고 쓰는 질의는 모두 여기 있고, 모두 판매자 ID 조건을 건다.
// (범위 ID로 찾는 질의도 판매자 ID를 함께 건다 — 범위 ID를 잘못 넘겨도 다른 판매자 행이 섞이지 않게.)
// 트랜잭션 안에서는 트랜잭션 객체(tx)를 넘긴다(PGlite는 연결이 하나라 트랜잭션 밖 객체를 쓰면 기다리다 멈춘다).
import { and, asc, desc, eq, gt, inArray, isNull, like, lt, lte, or, sql } from 'drizzle-orm'
import type { Db } from './db/database.ts'
import { accounts, bandLinks, broadcasts, chatRaw, events, loginLimits, outbox, scopes, sellers, sessions, snapshots, tiktokLinks, youtubeLinks } from './db/schema.ts'

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

/**
 * 로그인 아이디로 계정 찾기 (로그인 전이라 판매자를 모른다 — 아이디는 전체에서 유일하다). 지운 보조자는 없는 아이디와 같다 (AC-I3-62)
 */
export async function findAccountByLogin(db: Db, loginId: string): Promise<AccountRow | null> {
  const rows = await db
    .select({
      id: accounts.id,
      sellerId: accounts.sellerId,
      loginId: accounts.loginId,
      passwordHash: accounts.passwordHash,
    })
    .from(accounts)
    // 판매자 계정만 — 옛 보조자 계정은 로그인하지 못한다 (D-UX3-32, 보조자 기능을 없앰)
    .where(and(eq(accounts.loginId, loginId), eq(accounts.role, 'SELLER'), isNull(accounts.deletedAt)))
    .limit(1)
  return rows[0] ?? null
}

/** 그 아이디의 계정이 있는지 (지운 계정 포함 — 같은 아이디를 다시 만들지 않는다) */
export async function loginIdTaken(db: Db, loginId: string): Promise<boolean> {
  const rows = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.loginId, loginId)).limit(1)
  return rows.length > 0
}

/** 판매자 행을 잠근다 (같은 판매자의 보조자 만들기를 하나씩 — 5명 한도) */
export async function lockSeller(db: Db, sellerId: string): Promise<boolean> {
  const rows = await db.select({ id: sellers.id }).from(sellers).where(eq(sellers.id, sellerId)).for('update')
  return rows.length > 0
}

// ── 가게 이름·시작 마법사 (AC-I3-47·50) ────────────────────────────────────

export async function updateSellerName(db: Db, sellerId: string, name: string): Promise<boolean> {
  const rows = await db.update(sellers).set({ name }).where(eq(sellers.id, sellerId)).returning({ id: sellers.id })
  return rows.length > 0
}

export interface WizardRow {
  readonly status: string
  readonly step: number | null
}

export async function findWizard(db: Db, sellerId: string): Promise<WizardRow | null> {
  const rows = await db.select({ status: sellers.wizardStatus, step: sellers.wizardStep }).from(sellers).where(eq(sellers.id, sellerId)).limit(1)
  return rows[0] ?? null
}

export async function updateWizard(db: Db, sellerId: string, wizard: WizardRow): Promise<boolean> {
  const rows = await db.update(sellers).set({ wizardStatus: wizard.status, wizardStep: wizard.step }).where(eq(sellers.id, sellerId)).returning({ id: sellers.id })
  return rows.length > 0
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
  /** 세션을 만든 때 (D-UX3-30: 가입 중 번호 확인 뒤 새로 로그인했는지 본다) */
  readonly createdAt: Date
  /** 문자로 확인한 휴대폰 번호(가린 것). 없으면 null (D-UX3-30) */
  readonly phoneLabel: string | null
}

/** 세션을 만든 방법 (L1, D-L1-03) */
export type SessionMethod = 'PASSWORD' | 'GOOGLE' | 'KAKAO' | 'NAVER'

export async function insertSession(db: Db, row: { tokenHash: string; sellerId: string; accountId: string; now: Date; expiresAt: Date; method?: SessionMethod }): Promise<void> {
  await db.insert(sessions).values({
    tokenHash: row.tokenHash,
    sellerId: row.sellerId,
    accountId: row.accountId,
    createdAt: row.now,
    expiresAt: row.expiresAt,
    extendedAt: row.now,
    method: row.method ?? 'PASSWORD',
  })
}

/** 만료되지 않은 세션 (계정·판매자 이름과 함께). 지운 계정·옛 보조자 계정의 세션은 없는 것과 같다 (AC-I3-62, D-UX3-32) */
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
      createdAt: sessions.createdAt,
      phoneLabel: accounts.phoneLabel,
    })
    .from(sessions)
    .innerJoin(accounts, and(eq(accounts.id, sessions.accountId), eq(accounts.sellerId, sessions.sellerId), eq(accounts.role, 'SELLER'), isNull(accounts.deletedAt)))
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
  /** 방송 화면에 처음 들어온 때 — null이면 만드는 중이라 목록에 보이지 않는다 (D-UX3-25) */
  readonly openedAt: Date | null
}

const broadcastColumns = {
  id: broadcasts.id,
  scopeId: broadcasts.scopeId,
  date: broadcasts.date,
  rehearsal: scopes.rehearsal,
  title: broadcasts.title,
  startSeq: broadcasts.startSeq,
  endedAt: broadcasts.endedAt,
  openedAt: broadcasts.openedAt,
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

/** 방송 목록 덧붙임 (D-UX3-18): 방송마다 만든 시각과, 한 번이라도 이은 플랫폼(유튜브·틱톡·밴드 — 끊은 것 포함) */
export type BroadcastPlatform = 'youtube' | 'tiktok' | 'band'
export async function broadcastListExtras(db: Db, sellerId: string): Promise<{ createdAt: Map<string, Date>; platforms: Map<string, BroadcastPlatform[]> }> {
  const [made, youtube, tiktok, band] = await Promise.all([
    db.select({ id: broadcasts.id, createdAt: broadcasts.createdAt }).from(broadcasts).where(eq(broadcasts.sellerId, sellerId)),
    db.selectDistinct({ id: youtubeLinks.broadcastId }).from(youtubeLinks).where(eq(youtubeLinks.sellerId, sellerId)),
    db.selectDistinct({ id: tiktokLinks.broadcastId }).from(tiktokLinks).where(eq(tiktokLinks.sellerId, sellerId)),
    db.selectDistinct({ id: bandLinks.broadcastId }).from(bandLinks).where(eq(bandLinks.sellerId, sellerId)),
  ])
  const platforms = new Map<string, BroadcastPlatform[]>()
  const add = (rows: readonly { id: string }[], platform: BroadcastPlatform) => {
    for (const row of rows) platforms.set(row.id, [...(platforms.get(row.id) ?? []), platform])
  }
  add(youtube, 'youtube')
  add(tiktok, 'tiktok')
  add(band, 'band')
  return { createdAt: new Map(made.map((row) => [row.id, row.createdAt])), platforms }
}

export async function insertBroadcast(
  db: Db,
  row: { id: string; sellerId: string; scopeId: string; date: string; title: string; startSeq: number; now: Date; draft?: boolean },
): Promise<void> {
  await db.insert(broadcasts).values({
    id: row.id,
    sellerId: row.sellerId,
    scopeId: row.scopeId,
    date: row.date,
    title: row.title,
    startSeq: row.startSeq,
    createdAt: row.now,
    // 앱 새 방송 단계에서 만든 방송은 방송 화면에 들어올 때까지 목록에서 숨긴다 (D-UX3-25)
    openedAt: row.draft === true ? null : row.now,
  })
}

/** 방송 화면에 들어왔다 — 처음 한 번만 적는다. 그 판매자의 방송이 아니면 false (D-UX3-25) */
export async function markBroadcastOpened(db: Db, sellerId: string, broadcastId: string, now: Date): Promise<boolean> {
  const found = await db.select({ openedAt: broadcasts.openedAt }).from(broadcasts).where(and(eq(broadcasts.sellerId, sellerId), eq(broadcasts.id, broadcastId))).limit(1)
  const row = found[0]
  if (row === undefined) return false
  if (row.openedAt === null) {
    await db
      .update(broadcasts)
      .set({ openedAt: now })
      .where(and(eq(broadcasts.sellerId, sellerId), eq(broadcasts.id, broadcastId), isNull(broadcasts.openedAt)))
  }
  return true
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

/** 범위의 (after, upto] 이벤트 중 앞에서 limit개, seq 순 (채팅은 따로 둔 본문·이름을 합친 본문) — 긴 기록을 나눠 읽을 때 */
export async function eventsBetween(db: Db, sellerId: string, scopeId: string, after: number, upto: number, limit: number): Promise<EventRow[]> {
  const rows = await db
    .select({ ...eventColumns, ...rawColumns })
    .from(events)
    .leftJoin(chatRaw, rawJoin)
    .where(and(eq(events.sellerId, sellerId), eq(events.scopeId, scopeId), gt(events.seq, after), lte(events.seq, upto)))
    .orderBy(asc(events.seq))
    .limit(limit)
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
  readonly actor: 'account' | 'server' | 'collector' | 'deposit'
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

/** 형식이 같고 seq가 before보다 작은 마지막 스냅샷 */
export async function snapshotBefore(db: Db, sellerId: string, scopeId: string, format: number, before: number): Promise<SnapshotRow | null> {
  const rows = await db
    .select({ seq: snapshots.seq, format: snapshots.format, state: snapshots.state, attention: snapshots.attention })
    .from(snapshots)
    .where(and(eq(snapshots.sellerId, sellerId), eq(snapshots.scopeId, scopeId), eq(snapshots.format, format), lt(snapshots.seq, before)))
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

// ── 확인 필요 목록 (O2, D-O2-14) ───────────────────────────────────────────

/**
 * 상품명·옵션도 받는 방송(시작 이벤트의 설정 스냅샷 claim.parseMode=OPTIONS)이 있는 범위 (날짜·리허설인지), 날짜·실제 먼저 순.
 * 확인 필요 항목은 옵션 방송에만 생긴다(R-20 7) — 확인 필요 목록은 이 범위들만 읽는다. rehearsal을 주면 그쪽 범위만
 */
//
// 읽기 비용 (RA-O2-01): 판매자의 이벤트 전체를 훑지 않는다. 방송 표(broadcasts_seller_idx: 판매자·날짜·start_seq)로 방송을 고르고,
// 그 방송의 시작 이벤트 한 줄만 (범위, seq) 유일 색인으로 집어 설정 스냅샷을 읽는다 — 비용은 판매자의 방송 수에 비례한다(채팅 수와 무관).
// 봉인·지난 날짜도 범위에 남긴다 — 남은 확인 필요 항목을 목록에서 숨기지 않는다(판매자 안전).
export async function optionScopes(db: Db, sellerId: string, rehearsal?: boolean): Promise<{ date: string; rehearsal: boolean; scopeId: string }[]> {
  const rows = await db
    .select({ body: events.body, date: scopes.date, rehearsal: scopes.rehearsal, scopeId: broadcasts.scopeId })
    .from(broadcasts)
    .innerJoin(scopes, and(eq(scopes.id, broadcasts.scopeId), eq(scopes.sellerId, sellerId)))
    .innerJoin(events, and(eq(events.scopeId, broadcasts.scopeId), eq(events.seq, broadcasts.startSeq), eq(events.sellerId, sellerId)))
    .where(and(eq(broadcasts.sellerId, sellerId), eq(events.type, 'broadcast.start'), eq(events.changed, true), rehearsal === undefined ? undefined : eq(scopes.rehearsal, rehearsal)))
    .orderBy(asc(scopes.date), asc(scopes.rehearsal), asc(broadcasts.startSeq))
  const out = new Map<string, { date: string; rehearsal: boolean; scopeId: string }>()
  for (const row of rows) {
    let mode: unknown
    try {
      const settings = (JSON.parse(row.body) as { settings?: Record<string, unknown> }).settings
      mode = settings?.['claim.parseMode']
    } catch {
      mode = undefined
    }
    if (mode === 'OPTIONS' && !out.has(row.scopeId)) out.set(row.scopeId, { date: row.date, rehearsal: row.rehearsal, scopeId: row.scopeId })
  }
  return [...out.values()]
}

/** 범위의 그 seq들의 이벤트 본문 (채팅은 따로 둔 본문·이름을 합친 본문) — 확인 필요 항목의 출처 입력(댓글·문자찜)을 읽는다 */
export async function eventBodiesAt(db: Db, sellerId: string, scopeId: string, seqs: readonly number[]): Promise<Map<number, Record<string, unknown>>> {
  const out = new Map<number, Record<string, unknown>>()
  if (seqs.length === 0) return out
  const rows = await db
    .select({ seq: events.seq, body: events.body, ...rawColumns })
    .from(events)
    .leftJoin(chatRaw, rawJoin)
    .where(and(eq(events.sellerId, sellerId), eq(events.scopeId, scopeId), inArray(events.seq, [...seqs])))
  for (const row of rows.map(withRaw)) out.set(row.seq, JSON.parse(row.body) as Record<string, unknown>)
  return out
}

/**
 * 범위 안 그 seq들의 채팅 출처(events.chat_source — 기록할 때 서버가 정한 값, AIY1 D-AIY1-02). 없거나 빈 값은 null. 판매자 ID 조건을 건다
 */
export async function chatSourcesAt(db: Db, sellerId: string, scopeId: string, seqs: readonly number[]): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>()
  if (seqs.length === 0) return out
  const rows = await db
    .select({ seq: events.seq, source: events.chatSource })
    .from(events)
    .where(and(eq(events.sellerId, sellerId), eq(events.scopeId, scopeId), inArray(events.seq, [...seqs])))
  for (const row of rows) out.set(row.seq, row.source === null || row.source === '' ? null : row.source)
  return out
}

/**
 * 한 회차에 since 뒤에 받은 그 경로의 채팅 (X1 D-X1-06 다른 경로 중복 판단): 메시지 ID·작성자 채널·게시 시각·본문.
 * 본문은 chat_raw에 있다(봉인 전). 판매자 ID 조건을 건다
 */
export async function recentChatsOfSource(
  db: Db,
  sellerId: string,
  broadcastId: string,
  source: string,
  since: Date,
): Promise<{ id: string; ch: string | null; publishedAt: number | null; text: string | null; receivedAt: number }[]> {
  const rows = await db
    .select({ id: events.chatMessageId, body: events.body, text: chatRaw.text, receivedAt: events.receivedAt })
    .from(events)
    .leftJoin(chatRaw, and(eq(chatRaw.sellerId, events.sellerId), eq(chatRaw.scopeId, events.scopeId), eq(chatRaw.seq, events.seq)))
    .where(and(eq(events.sellerId, sellerId), eq(events.chatBroadcast, broadcastId), eq(events.chatSource, source), gt(events.receivedAt, since)))
  return rows.flatMap((row) => {
    if (row.id === null) return []
    let body: Record<string, unknown>
    try {
      body = JSON.parse(row.body) as Record<string, unknown>
    } catch {
      body = {}
    }
    return [{ id: row.id, ch: typeof body.ch === 'string' ? body.ch : null, publishedAt: typeof body.publishedAt === 'number' ? body.publishedAt : null, text: row.text, receivedAt: row.receivedAt.getTime() }]
  })
}
