// 휴대폰 알림 받기 저장소 (SMS3 ORD-13 C-02·C-06·C-07, D-SMS3-04·08·13). 모든 질의에 판매자 ID 조건을 건다(SYS-02) — 토큰 해시로 판매자를 찾는 한 곳만 판매자를 모른 채 묻는다.
// 본문·전화번호·토큰 원문은 어느 칸에도 두지 않는다: 토큰은 SHA-256 해시, 받은 id는 판매자와 묶은 해시, 같은 문자 표지는 마스터 키 HMAC,
// 문자 확인 카드의 본문·보낸 번호·보낸 이름은 판매자에 묶어 암호화한 sealed에만.
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { broadcasts, events, inboxCards, inboxSeen, inboxSettings, inboxSmsSeen, scopes } from '../db/schema.ts'

// ── 설정 ───────────────────────────────────────────────────────────────

export interface InboxSettingsRow {
  readonly sellerId: string
  readonly enabled: boolean
  readonly tokenHash: string | null
  readonly tokenCreatedAt: Date | null
  readonly lastReceivedAt: Date | null
  readonly lastDevice: string | null
}

const settingsColumns = {
  sellerId: inboxSettings.sellerId,
  enabled: inboxSettings.enabled,
  tokenHash: inboxSettings.tokenHash,
  tokenCreatedAt: inboxSettings.tokenCreatedAt,
  lastReceivedAt: inboxSettings.lastReceivedAt,
  lastDevice: inboxSettings.lastDevice,
}

export async function findSettings(db: Db, sellerId: string): Promise<InboxSettingsRow | null> {
  const rows = await db.select(settingsColumns).from(inboxSettings).where(eq(inboxSettings.sellerId, sellerId)).limit(1)
  return rows[0] ?? null
}

/** 토큰 해시 → 켜진 판매자 (없거나 꺼졌으면 null) */
export async function sellerOfToken(db: Db, tokenHash: string): Promise<string | null> {
  const rows = await db
    .select({ sellerId: inboxSettings.sellerId })
    .from(inboxSettings)
    .where(and(eq(inboxSettings.tokenHash, tokenHash), eq(inboxSettings.enabled, true)))
    .limit(1)
  return rows[0]?.sellerId ?? null
}

/** 토큰 만들기·다시 만들기: 해시를 바꾸고 켠다 (옛 해시는 사라진다 — 옛 토큰 바로 무효) */
export async function saveToken(db: Db, sellerId: string, tokenHash: string, now: Date): Promise<void> {
  await db
    .insert(inboxSettings)
    .values({ sellerId, enabled: true, tokenHash, tokenCreatedAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: inboxSettings.sellerId, set: { enabled: true, tokenHash, tokenCreatedAt: now, updatedAt: now } })
}

export async function setEnabled(db: Db, sellerId: string, enabled: boolean, now: Date): Promise<void> {
  await db.update(inboxSettings).set({ enabled, updatedAt: now }).where(eq(inboxSettings.sellerId, sellerId))
}

/** 마지막으로 받은 시각·기기 이름 */
export async function touchReceived(db: Db, sellerId: string, device: string, now: Date): Promise<void> {
  await db.update(inboxSettings).set({ lastReceivedAt: now, lastDevice: device }).where(eq(inboxSettings.sellerId, sellerId))
}

/** 휴대폰 알림 받기를 만든 판매자 (주기 정리 — 판매자를 모른 채 묻는 둘째 곳, 판매자 ID만 읽는다) */
export async function inboxSellerIds(db: Db): Promise<string[]> {
  const rows = await db.select({ sellerId: inboxSettings.sellerId }).from(inboxSettings).orderBy(asc(inboxSettings.sellerId))
  return rows.map((row) => row.sellerId)
}

// ── 받은 id (C-06 같은 id 24시간) ─────────────────────────────────────────

/** 그 id를 since 뒤에 받았는지 */
export async function seenSince(db: Db, sellerId: string, idHash: string, since: Date): Promise<boolean> {
  const rows = await db
    .select({ id: inboxSeen.id })
    .from(inboxSeen)
    .where(and(eq(inboxSeen.sellerId, sellerId), eq(inboxSeen.idHash, idHash), gte(inboxSeen.seenAt, since)))
    .limit(1)
  return rows.length > 0
}

export async function markSeen(db: Db, sellerId: string, idHash: string, now: Date): Promise<void> {
  await db.insert(inboxSeen).values({ sellerId, idHash, seenAt: now }).onConflictDoUpdate({ target: [inboxSeen.sellerId, inboxSeen.idHash], set: { seenAt: now } })
}

// ── 같은 문자 표지 (C-06 보낸 곳·본문 같고 60초 안) ──────────────────────────

export async function smsSeenNear(db: Db, sellerId: string, sig: string, from: Date, to: Date): Promise<boolean> {
  const rows = await db
    .select({ id: inboxSmsSeen.id })
    .from(inboxSmsSeen)
    .where(and(eq(inboxSmsSeen.sellerId, sellerId), eq(inboxSmsSeen.sig, sig), gte(inboxSmsSeen.receivedAt, from), lte(inboxSmsSeen.receivedAt, to)))
    .limit(1)
  return rows.length > 0
}

export async function insertSmsSeen(db: Db, sellerId: string, sig: string, receivedAt: Date, now: Date): Promise<void> {
  await db.insert(inboxSmsSeen).values({ sellerId, sig, receivedAt, createdAt: now })
}

/** 24시간 지난 받은 id·같은 문자 표지 지우기 */
export async function pruneSeen(db: Db, sellerId: string, before: Date): Promise<void> {
  await db.delete(inboxSeen).where(and(eq(inboxSeen.sellerId, sellerId), lt(inboxSeen.seenAt, before)))
  await db.delete(inboxSmsSeen).where(and(eq(inboxSmsSeen.sellerId, sellerId), lt(inboxSmsSeen.createdAt, before)))
}

// ── 방송 창 (D-SMS3-07) ─────────────────────────────────────────────────

export interface WindowBroadcast {
  readonly id: string
  readonly date: string
  readonly endedAt: Date | null
}

/**
 * 손님 문자를 받을 방송: 끝나지 않은 실제 방송 중 가장 최근 것, 없으면 endedAfter 뒤에 끝난 실제 방송 중 가장 최근에 끝난 것. 리허설은 보지 않는다
 */
export async function windowBroadcast(db: Db, sellerId: string, endedAfter: Date): Promise<WindowBroadcast | null> {
  const rows = await db
    .select({ id: broadcasts.id, date: broadcasts.date, endedAt: broadcasts.endedAt })
    .from(broadcasts)
    .innerJoin(scopes, and(eq(scopes.id, broadcasts.scopeId), eq(scopes.sellerId, sellerId)))
    .where(and(eq(broadcasts.sellerId, sellerId), eq(scopes.rehearsal, false), or(isNull(broadcasts.endedAt), gte(broadcasts.endedAt, endedAfter))))
    .orderBy(desc(broadcasts.createdAt), desc(broadcasts.date), desc(broadcasts.startSeq))
    .limit(50)
  const open = rows.find((row) => row.endedAt === null)
  if (open !== undefined) return open
  const ended = rows.filter((row) => row.endedAt !== null).sort((a, b) => (b.endedAt as Date).getTime() - (a.endedAt as Date).getTime())
  return ended[0] ?? null
}

/** 그 실제 방송 (카드 처리 — 판매자의 방송인지) */
export async function realBroadcast(db: Db, sellerId: string, broadcastId: string): Promise<WindowBroadcast | null> {
  const rows = await db
    .select({ id: broadcasts.id, date: broadcasts.date, endedAt: broadcasts.endedAt })
    .from(broadcasts)
    .innerJoin(scopes, and(eq(scopes.id, broadcasts.scopeId), eq(scopes.sellerId, sellerId)))
    .where(and(eq(broadcasts.sellerId, sellerId), eq(broadcasts.id, broadcastId), eq(scopes.rehearsal, false)))
    .limit(1)
  return rows[0] ?? null
}

/** 그 실제 방송의 시작 시각(방송 행을 만든 시각)과 날짜 — 받기 멈춤 알림용 */
export async function broadcastStart(db: Db, sellerId: string, broadcastId: string): Promise<{ date: string; startedAt: Date; rehearsal: boolean } | null> {
  const rows = await db
    .select({ date: broadcasts.date, startedAt: broadcasts.createdAt, rehearsal: scopes.rehearsal })
    .from(broadcasts)
    .innerJoin(scopes, and(eq(scopes.id, broadcasts.scopeId), eq(scopes.sellerId, sellerId)))
    .where(and(eq(broadcasts.sellerId, sellerId), eq(broadcasts.id, broadcastId)))
    .limit(1)
  return rows[0] ?? null
}

/** 그 범위에서 휴대폰 알림으로 넣은 문자찜(ref가 ibx_로 시작)의 seq — 코어 listClaims의 seq와 맞춰 찜 ID를 찾는다 */
export async function inboxSmsSeqs(db: Db, sellerId: string, date: string): Promise<Set<number>> {
  const rows = await db
    .select({ seq: events.seq })
    .from(events)
    .innerJoin(scopes, and(eq(scopes.id, events.scopeId), eq(scopes.sellerId, sellerId)))
    .where(and(eq(events.sellerId, sellerId), eq(scopes.date, date), eq(scopes.rehearsal, false), eq(events.type, 'sms'), sql`${events.smsRef} like 'ibx\_%'`))
  return new Set(rows.map((row) => row.seq))
}

/** 그 범위에서 이 전화번호 키로 넣은 문자찜의 ref (취소 승인 — 그 번호의 문자 구매자를 코어 buyerOfRef로 찾는다) */
export async function smsRefsOfPhoneKey(db: Db, sellerId: string, date: string, phoneKey: string): Promise<string[]> {
  const needle = JSON.stringify({ phoneKey }).slice(1, -1)
  const rows = await db
    .select({ ref: events.smsRef })
    .from(events)
    .innerJoin(scopes, and(eq(scopes.id, events.scopeId), eq(scopes.sellerId, sellerId)))
    .where(and(eq(events.sellerId, sellerId), eq(scopes.date, date), eq(scopes.rehearsal, false), eq(events.type, 'sms'), sql`strpos(${events.body}, ${needle}) > 0`))
    .orderBy(asc(events.seq))
    .limit(20)
  return rows.flatMap((row) => (row.ref === null ? [] : [row.ref]))
}

// ── 문자 확인 카드 ───────────────────────────────────────────────────────

export type CardKind = 'REVIEW' | 'CANCEL'
export type CardWhy = 'UNCLEAR' | 'NO_NUMBER' | 'OPTIONS' | 'NOT_ON_SALE'
/** OPEN 처리 전 · BUSY 넣기·승인 처리 중(한 요청만 잡는다) · DONE 넣기·승인 · IGNORED 무시 */
export type CardStatus = 'OPEN' | 'BUSY' | 'DONE' | 'IGNORED'

export interface CardRow {
  readonly id: string
  readonly sellerId: string
  readonly broadcastId: string
  readonly kind: CardKind
  readonly why: CardWhy | null
  readonly numbers: string
  readonly memo: string | null
  readonly last4: string | null
  readonly sealed: string | null
  readonly receivedAt: Date
  readonly status: CardStatus
  readonly createdAt: Date
}

const cardColumns = {
  id: inboxCards.id,
  sellerId: inboxCards.sellerId,
  broadcastId: inboxCards.broadcastId,
  kind: inboxCards.kind,
  why: inboxCards.why,
  numbers: inboxCards.numbers,
  memo: inboxCards.memo,
  last4: inboxCards.last4,
  sealed: inboxCards.sealed,
  receivedAt: inboxCards.receivedAt,
  status: inboxCards.status,
  createdAt: inboxCards.createdAt,
}

export async function insertCard(
  db: Db,
  row: { id: string; sellerId: string; broadcastId: string; kind: CardKind; why: CardWhy | null; numbers: readonly number[]; memo: string | null; last4: string | null; sealed: string; receivedAt: Date; now: Date },
): Promise<void> {
  await db.insert(inboxCards).values({
    id: row.id,
    sellerId: row.sellerId,
    broadcastId: row.broadcastId,
    kind: row.kind,
    why: row.why,
    numbers: JSON.stringify(row.numbers),
    memo: row.memo,
    last4: row.last4,
    sealed: row.sealed,
    receivedAt: row.receivedAt,
    status: 'OPEN',
    createdAt: row.now,
  })
}

/** 그 방송의 처리 안 한 카드 (받은 순서 — 오래된 것 먼저). 처리 중(BUSY)인 카드도 보인다 — 처리가 실패하면 OPEN으로 돌아오고, 성공하면 사라진다 */
export async function openCards(db: Db, sellerId: string, broadcastId: string): Promise<CardRow[]> {
  const rows = await db
    .select(cardColumns)
    .from(inboxCards)
    .where(and(eq(inboxCards.sellerId, sellerId), eq(inboxCards.broadcastId, broadcastId), inArray(inboxCards.status, ['OPEN', 'BUSY'])))
    .orderBy(asc(inboxCards.receivedAt), asc(inboxCards.seq))
    .limit(500)
  return rows as CardRow[]
}

export async function findCard(db: Db, sellerId: string, id: string): Promise<CardRow | null> {
  const rows = await db
    .select(cardColumns)
    .from(inboxCards)
    .where(and(eq(inboxCards.sellerId, sellerId), eq(inboxCards.id, id)))
    .limit(1)
  return (rows[0] as CardRow | undefined) ?? null
}

/** 처리 중으로 둔 카드가 이 시간 넘게 그대로면(서버가 처리 도중 멈춤) 다시 잡을 수 있다 */
export const CARD_BUSY_STALE_MS = 2 * 60_000

/**
 * 카드 잡기 (넣기·승인 — 판매자·보조자 동시 처리에서 한 요청만): 처리 안 한 카드(또는 오래 멈춘 처리 중 카드)를 조건부 UPDATE로 처리 중(BUSY)으로.
 * 바뀐 행이 정확히 1일 때만 true — 그 요청만 엔진에 기록한다
 */
export async function claimCard(db: Db, sellerId: string, id: string, now: Date): Promise<boolean> {
  const stale = new Date(now.getTime() - CARD_BUSY_STALE_MS)
  const rows = await db
    .update(inboxCards)
    .set({ status: 'BUSY', handledAt: now })
    .where(
      and(
        eq(inboxCards.sellerId, sellerId),
        eq(inboxCards.id, id),
        or(eq(inboxCards.status, 'OPEN'), and(eq(inboxCards.status, 'BUSY'), or(isNull(inboxCards.handledAt), lt(inboxCards.handledAt, stale)))),
      ),
    )
    .returning({ id: inboxCards.id })
  return rows.length === 1
}

/** 잡은 카드 놓기 (기록이 거절·실패 — 카드는 처리 안 한 채로 남는다) */
export async function releaseCard(db: Db, sellerId: string, id: string, claimedAt: Date): Promise<void> {
  await db
    .update(inboxCards)
    .set({ status: 'OPEN', handledAt: null })
    .where(and(eq(inboxCards.sellerId, sellerId), eq(inboxCards.id, id), eq(inboxCards.status, 'BUSY'), eq(inboxCards.handledAt, claimedAt)))
}

/**
 * 카드 처리 (넣기·승인 DONE · 무시 IGNORED): 본문·읽은 이름(memo)·뒤 4자리를 바로 지운다(평문 개인정보를 남기지 않는다, RA-SMS3-003). from 상태(무시는 OPEN, 넣기·승인은 잡은 BUSY)일 때만 바꾼다
 */
export async function finishCard(db: Db, sellerId: string, id: string, status: 'DONE' | 'IGNORED', now: Date, from: 'OPEN' | 'BUSY' = 'OPEN'): Promise<boolean> {
  const rows = await db
    .update(inboxCards)
    .set({ status, sealed: null, memo: null, last4: null, handledAt: now })
    .where(and(eq(inboxCards.sellerId, sellerId), eq(inboxCards.id, id), eq(inboxCards.status, from)))
    .returning({ id: inboxCards.id })
  return rows.length === 1
}

/**
 * 카드 지우기 (C-07): 그 방송이 끝나고 24시간이 지나면 카드 행을 상태와 상관없이 모두 지운다(처리한 카드의 본문·이름은 처리할 때 이미 지웠다).
 * endedBefore = 지금 − 24시간. 지운 카드의 방송 ID 목록을 돌려준다
 */
export async function purgeCards(db: Db, sellerId: string, endedBefore: Date): Promise<string[]> {
  const ended = await db
    .select({ id: broadcasts.id })
    .from(broadcasts)
    .where(and(eq(broadcasts.sellerId, sellerId), isNotNull(broadcasts.endedAt), lt(broadcasts.endedAt, endedBefore)))
  if (ended.length === 0) return []
  const ids = ended.map((row) => row.id)
  const removed: string[] = []
  for (let start = 0; start < ids.length; start += 200) {
    const part = ids.slice(start, start + 200)
    const rows = await db
      .delete(inboxCards)
      .where(and(eq(inboxCards.sellerId, sellerId), inArray(inboxCards.broadcastId, part)))
      .returning({ b: inboxCards.broadcastId })
    removed.push(...rows.map((row) => row.b))
  }
  return [...new Set(removed)]
}
