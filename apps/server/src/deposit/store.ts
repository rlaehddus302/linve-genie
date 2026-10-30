// 입금 확인 저장소 (N3, DP-1·DP-6, SYS-02). 입금 표를 읽고 쓰는 질의는 모두 여기 있고, 모두 판매자 ID 조건을 건다.
// 트랜잭션 안에서는 트랜잭션 객체(tx)를 넘긴다(PGlite는 연결이 하나라 트랜잭션 밖 객체를 쓰면 기다리다 멈춘다).
import { and, asc, count, desc, eq, gt, gte, inArray, lt, lte, sql } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { accounts, depositActions, depositCorpBindings, depositLinks, depositLockKey, depositNames, depositRequests, deposits, depositSources, scopes } from '../db/schema.ts'

export type DepositStatus = 'REVIEW' | 'AUTO_APPLIED' | 'APPLIED' | 'IGNORED'
export type SourceKind = 'POPBILL' | 'PASTE' | 'FAKE' | 'PHONE'
/** 휴대폰 알림 입금의 저장 때 표시 (SMS3 DP-9 9) */
export type PhoneFlag = 'UNTRUSTED_SOURCE' | 'BALANCE_GAP'
export type DepositPrecision = 'second' | 'minute'
export type DepositAction = 'RECEIVED' | 'AUTO' | 'CONFIRM' | 'IGNORE' | 'REOPEN' | 'REVERT'

export const DEPOSIT_STATUSES: readonly DepositStatus[] = ['REVIEW', 'AUTO_APPLIED', 'APPLIED', 'IGNORED']

// ── 원천 ─────────────────────────────────────────────────────────────────

export interface SourceRow {
  readonly id: string
  readonly sellerId: string
  readonly kind: SourceKind
  readonly label: string
  readonly enabled: boolean
  readonly intervalMin: number
  readonly accountEnc: string | null
  readonly lastFetchedAt: Date | null
  readonly lastError: string | null
  readonly lastErrorAt: Date | null
  readonly lastNew: number | null
  readonly createdAt: Date
}

const sourceColumns = {
  id: depositSources.id,
  sellerId: depositSources.sellerId,
  kind: depositSources.kind,
  label: depositSources.label,
  enabled: depositSources.enabled,
  intervalMin: depositSources.intervalMin,
  accountEnc: depositSources.accountEnc,
  lastFetchedAt: depositSources.lastFetchedAt,
  lastError: depositSources.lastError,
  lastErrorAt: depositSources.lastErrorAt,
  lastNew: depositSources.lastNew,
  createdAt: depositSources.createdAt,
}

export async function listSources(db: Db, sellerId: string): Promise<SourceRow[]> {
  const rows = await db.select(sourceColumns).from(depositSources).where(eq(depositSources.sellerId, sellerId)).orderBy(asc(depositSources.createdAt), asc(depositSources.id))
  return rows as SourceRow[]
}

export async function findSource(db: Db, sellerId: string, id: string): Promise<SourceRow | null> {
  const rows = await db
    .select(sourceColumns)
    .from(depositSources)
    .where(and(eq(depositSources.sellerId, sellerId), eq(depositSources.id, id)))
    .limit(1)
  return (rows[0] as SourceRow | undefined) ?? null
}

/** 켜진 받아 오기 원천 전부 (서버를 켤 때 주기를 건다 — 판매자마다 따로 처리한다) */
export async function enabledFetchSources(db: Db, kinds: readonly SourceKind[]): Promise<SourceRow[]> {
  if (kinds.length === 0) return []
  const rows = await db
    .select(sourceColumns)
    .from(depositSources)
    .where(and(eq(depositSources.enabled, true), inArray(depositSources.kind, [...kinds])))
  return rows as SourceRow[]
}

export async function insertSource(
  db: Db,
  row: { id: string; sellerId: string; kind: SourceKind; label: string; intervalMin: number; accountEnc: string | null; now: Date },
): Promise<void> {
  await db.insert(depositSources).values({
    id: row.id,
    sellerId: row.sellerId,
    kind: row.kind,
    label: row.label,
    intervalMin: row.intervalMin,
    accountEnc: row.accountEnc,
    createdAt: row.now,
    updatedAt: row.now,
  })
}

/** 붙여넣기 원천 (판매자마다 하나 — 없으면 만든다) */
export async function ensurePasteSource(db: Db, sellerId: string, newId: string, now: Date): Promise<SourceRow> {
  await db
    .insert(depositSources)
    .values({ id: newId, sellerId, kind: 'PASTE', label: '붙여넣기', intervalMin: 5, createdAt: now, updatedAt: now })
    .onConflictDoNothing({ target: depositSources.sellerId, where: sql`kind = 'PASTE'` })
  const rows = await db
    .select(sourceColumns)
    .from(depositSources)
    .where(and(eq(depositSources.sellerId, sellerId), eq(depositSources.kind, 'PASTE')))
    .limit(1)
  const row = rows[0] as SourceRow | undefined
  if (row === undefined) throw new Error('붙여넣기 원천을 만들지 못했다')
  return row
}

/** 휴대폰 알림 원천 (SMS3 D-DEP2-01 — 판매자마다 하나, 없으면 만든다. 받기 토큰을 처음 만들 때) */
export async function ensurePhoneSource(db: Db, sellerId: string, newId: string, now: Date): Promise<SourceRow> {
  await db
    .insert(depositSources)
    .values({ id: newId, sellerId, kind: 'PHONE', label: '휴대폰 알림', intervalMin: 5, createdAt: now, updatedAt: now })
    .onConflictDoNothing({ target: depositSources.sellerId, where: sql`kind = 'PHONE'` })
  const row = await findPhoneSource(db, sellerId)
  if (row === null) throw new Error('휴대폰 알림 원천을 만들지 못했다')
  return row
}

export async function findPhoneSource(db: Db, sellerId: string): Promise<SourceRow | null> {
  const rows = await db
    .select(sourceColumns)
    .from(depositSources)
    .where(and(eq(depositSources.sellerId, sellerId), eq(depositSources.kind, 'PHONE')))
    .limit(1)
  return (rows[0] as SourceRow | undefined) ?? null
}

export async function findPasteSource(db: Db, sellerId: string): Promise<SourceRow | null> {
  const rows = await db
    .select(sourceColumns)
    .from(depositSources)
    .where(and(eq(depositSources.sellerId, sellerId), eq(depositSources.kind, 'PASTE')))
    .limit(1)
  return (rows[0] as SourceRow | undefined) ?? null
}

export async function updateSource(
  db: Db,
  sellerId: string,
  id: string,
  patch: Partial<{ label: string; intervalMin: number; enabled: boolean; lastFetchedAt: Date; lastError: string | null; lastErrorAt: Date | null; lastNew: number }>,
  now: Date,
): Promise<void> {
  await db
    .update(depositSources)
    .set({ ...patch, updatedAt: now })
    .where(and(eq(depositSources.sellerId, sellerId), eq(depositSources.id, id)))
}

// ── 입금 ─────────────────────────────────────────────────────────────────

export interface DepositRow {
  readonly id: number
  readonly sellerId: string
  readonly no: number
  readonly sourceId: string
  readonly externalKey: string
  readonly at: Date
  readonly precision: DepositPrecision
  readonly amount: number
  readonly name: string
  readonly status: DepositStatus
  readonly turn: number
  readonly appliedDate: string | null
  readonly appliedBuyer: string | null
  readonly appliedSeq: number | null
  readonly receivedAt: Date
  readonly handledAt: Date | null
  /** 휴대폰 알림 입금의 저장 때 표시 (없으면 null) */
  readonly phoneFlag: PhoneFlag | null
}

const depositColumns = {
  id: deposits.id,
  sellerId: deposits.sellerId,
  no: deposits.no,
  sourceId: deposits.sourceId,
  externalKey: deposits.externalKey,
  at: deposits.at,
  precision: deposits.precision,
  amount: deposits.amount,
  name: deposits.name,
  status: deposits.status,
  turn: deposits.turn,
  appliedDate: deposits.appliedDate,
  appliedBuyer: deposits.appliedBuyer,
  appliedSeq: deposits.appliedSeq,
  receivedAt: deposits.receivedAt,
  handledAt: deposits.handledAt,
  phoneFlag: deposits.phoneFlag,
}

export async function findDeposit(db: Db, sellerId: string, no: number): Promise<DepositRow | null> {
  const rows = await db
    .select(depositColumns)
    .from(deposits)
    .where(and(eq(deposits.sellerId, sellerId), eq(deposits.no, no)))
    .limit(1)
  return (rows[0] as DepositRow | undefined) ?? null
}

export async function depositsByNos(db: Db, sellerId: string, nos: readonly number[]): Promise<DepositRow[]> {
  if (nos.length === 0) return []
  const rows = await db
    .select(depositColumns)
    .from(deposits)
    .where(and(eq(deposits.sellerId, sellerId), inArray(deposits.no, [...nos])))
    .orderBy(asc(deposits.no))
  return rows as DepositRow[]
}

/** 상태별 목록(상태 하나 이상): 입금 번호 내림차순, before(그 번호 앞)부터 limit개 (하나 더 읽어 더 있는지 알린다) */
export async function listDeposits(db: Db, sellerId: string, statuses: readonly DepositStatus[], before: number | null, limit: number): Promise<{ rows: DepositRow[]; more: boolean }> {
  const rows = (await db
    .select(depositColumns)
    .from(deposits)
    .where(and(eq(deposits.sellerId, sellerId), inArray(deposits.status, [...statuses]), before === null ? undefined : lt(deposits.no, before)))
    .orderBy(desc(deposits.no))
    .limit(limit + 1)) as DepositRow[]
  return { rows: rows.slice(0, limit), more: rows.length > limit }
}

export async function reviewCount(db: Db, sellerId: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(deposits)
    .where(and(eq(deposits.sellerId, sellerId), eq(deposits.status, 'REVIEW')))
  return Number(rows[0]?.n ?? 0)
}

/** 거래 시각이 [from, to) 안인 입금 (쌍둥이 찾기 — 입금 번호 순). maxNo를 주면 그 번호보다 작은 것만 */
export async function depositsBetween(db: Db, sellerId: string, from: Date, to: Date, maxNo: number | null): Promise<DepositRow[]> {
  const rows = await db
    .select(depositColumns)
    .from(deposits)
    .where(and(eq(deposits.sellerId, sellerId), gte(deposits.at, from), lt(deposits.at, to), maxNo === null ? undefined : lt(deposits.no, maxNo)))
    .orderBy(asc(deposits.no))
  return rows as DepositRow[]
}

/** 그 원천에 이미 있는 외부 키 */
export async function existingKeys(db: Db, sellerId: string, sourceId: string, keys: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>()
  for (let start = 0; start < keys.length; start += 500) {
    const part = keys.slice(start, start + 500)
    const rows = await db
      .select({ key: deposits.externalKey })
      .from(deposits)
      .where(and(eq(deposits.sellerId, sellerId), eq(deposits.sourceId, sourceId), inArray(deposits.externalKey, part)))
    for (const row of rows) out.add(row.key)
  }
  return out
}

/** 판매자 입금 처리 잠금 (트랜잭션 안 — 번호 붙이기) */
export async function lockSellerDeposits(tx: Db, sellerId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${depositLockKey(sellerId)})`)
}

export async function maxDepositNo(db: Db, sellerId: string): Promise<number> {
  const rows = await db
    .select({ no: sql<number | null>`max(${deposits.no})` })
    .from(deposits)
    .where(eq(deposits.sellerId, sellerId))
  return Number(rows[0]?.no ?? 0)
}

export interface NewDeposit {
  readonly no: number
  readonly sourceId: string
  readonly externalKey: string
  readonly at: Date
  readonly precision: DepositPrecision
  readonly amount: number
  readonly name: string
  /** 휴대폰 알림 입금의 저장 때 표시 (SMS3 — 없으면 null) */
  readonly phoneFlag?: PhoneFlag | null
}

/** 새 입금 넣기 (같은 외부 키가 있으면 넣지 않는다 — 넣은 행의 id·번호를 돌려준다) */
export async function insertDeposits(tx: Db, sellerId: string, rows: readonly NewDeposit[], now: Date): Promise<{ id: number; no: number }[]> {
  const out: { id: number; no: number }[] = []
  for (let start = 0; start < rows.length; start += 200) {
    const part = rows.slice(start, start + 200)
    const inserted = await tx
      .insert(deposits)
      .values(part.map((row) => ({ sellerId, ...row, status: 'REVIEW', receivedAt: now })))
      .onConflictDoNothing({ target: [deposits.sellerId, deposits.sourceId, deposits.externalKey] })
      .returning({ id: deposits.id, no: deposits.no })
    out.push(...inserted)
  }
  return out
}

/**
 * 입금 상태를 바꾼다 — 지금 상태·차례가 기대한 값일 때만(다른 처리가 먼저 바꿨으면 0행). 바꾼 행 수를 돌려준다
 */
export async function setDepositState(
  tx: Db,
  sellerId: string,
  no: number,
  expect: { readonly status: DepositStatus; readonly turn: number },
  patch: { status: DepositStatus; turn?: number; appliedDate: string | null; appliedBuyer: string | null; appliedSeq: number | null; handledAt: Date },
): Promise<number> {
  const rows = await tx
    .update(deposits)
    .set(patch)
    .where(and(eq(deposits.sellerId, sellerId), eq(deposits.no, no), eq(deposits.status, expect.status), eq(deposits.turn, expect.turn)))
    .returning({ id: deposits.id })
  return rows.length
}

// ── 연결·처리 기록 ─────────────────────────────────────────────────────────

export interface NewLink {
  readonly depositId: number
  readonly scopeId: string
  readonly date: string
  readonly seq: number
  readonly kind: 'payment' | 'refund'
  readonly turn: number
  readonly buyer: string
  readonly auto: boolean
}

export async function insertLink(tx: Db, sellerId: string, link: NewLink, now: Date): Promise<void> {
  await tx.insert(depositLinks).values({ sellerId, ...link, createdAt: now })
}

export interface LinkRow extends NewLink {
  readonly no: number
  readonly name: string
  readonly at: Date
  readonly precision: DepositPrecision
  readonly amount: number
  readonly sourceKind: SourceKind
  readonly sourceLabel: string
}

/** 그 날짜 실제 범위의 입금 연결 (seq 순) — 범위 표와 이어 한 번에 읽는다 */
export async function linksOfScope(db: Db, sellerId: string, date: string): Promise<LinkRow[]> {
  const rows = await db
    .select({
      depositId: depositLinks.depositId,
      scopeId: depositLinks.scopeId,
      date: depositLinks.date,
      seq: depositLinks.seq,
      kind: depositLinks.kind,
      turn: depositLinks.turn,
      buyer: depositLinks.buyer,
      auto: depositLinks.auto,
      no: deposits.no,
      name: deposits.name,
      at: deposits.at,
      precision: deposits.precision,
      amount: deposits.amount,
      sourceKind: depositSources.kind,
      sourceLabel: depositSources.label,
    })
    .from(depositLinks)
    .innerJoin(scopes, and(eq(scopes.id, depositLinks.scopeId), eq(scopes.sellerId, sellerId), eq(scopes.date, date), eq(scopes.rehearsal, false)))
    .innerJoin(deposits, and(eq(deposits.id, depositLinks.depositId), eq(deposits.sellerId, sellerId)))
    .innerJoin(depositSources, and(eq(depositSources.id, deposits.sourceId), eq(depositSources.sellerId, sellerId)))
    .where(eq(depositLinks.sellerId, sellerId))
    .orderBy(asc(depositLinks.seq))
  return rows as LinkRow[]
}

/** 구매자(채널)마다 입금 확인으로 적은 가장 늦은 묶음 날짜 — 기억한 입금자명의 구매자 표시 이름을 찾을 날짜 (RA-N3-003) */
export async function latestLinkDates(db: Db, sellerId: string, buyers: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (buyers.length === 0) return out
  const rows = await db
    .select({ buyer: depositLinks.buyer, date: sql<string>`max(${depositLinks.date})` })
    .from(depositLinks)
    .where(and(eq(depositLinks.sellerId, sellerId), inArray(depositLinks.buyer, [...buyers])))
    .groupBy(depositLinks.buyer)
  for (const row of rows) if (typeof row.date === 'string') out.set(row.buyer, row.date)
  return out
}

/** 입금 하나의 연결 전부 (적은 순서) */
export async function linksOfDeposit(db: Db, sellerId: string, depositId: number): Promise<NewLink[]> {
  const rows = await db
    .select({
      depositId: depositLinks.depositId,
      scopeId: depositLinks.scopeId,
      date: depositLinks.date,
      seq: depositLinks.seq,
      kind: depositLinks.kind,
      turn: depositLinks.turn,
      buyer: depositLinks.buyer,
      auto: depositLinks.auto,
    })
    .from(depositLinks)
    .where(and(eq(depositLinks.sellerId, sellerId), eq(depositLinks.depositId, depositId)))
    .orderBy(asc(depositLinks.id))
  return rows as NewLink[]
}

export interface NewAction {
  readonly depositId: number
  readonly action: DepositAction
  readonly accountId: string | null
  readonly date?: string | null
  readonly buyer?: string | null
  readonly scopeId?: string | null
  readonly seq?: number | null
}

export async function insertActions(tx: Db, sellerId: string, actions: readonly NewAction[], now: Date): Promise<void> {
  for (let start = 0; start < actions.length; start += 200) {
    const part = actions.slice(start, start + 200)
    if (part.length === 0) continue
    await tx.insert(depositActions).values(
      part.map((action) => ({
        sellerId,
        depositId: action.depositId,
        action: action.action,
        actor: action.accountId === null ? 'auto' : 'account',
        accountId: action.accountId,
        date: action.date ?? null,
        buyer: action.buyer ?? null,
        scopeId: action.scopeId ?? null,
        seq: action.seq ?? null,
        at: now,
      })),
    )
  }
}

export interface ActionRow {
  readonly action: DepositAction
  /** account(로그인 계정) · auto(입금 자동 확인) · server(복구가 입금 상태를 다시 만든 엔진 기록에 맞춤 — I2 합치기) */
  readonly actor: 'account' | 'auto' | 'server'
  readonly loginId: string | null
  readonly date: string | null
  readonly buyer: string | null
  readonly seq: number | null
  readonly at: Date
}

/** 입금 하나의 처리 기록 (시간 순서) */
export async function actionsOfDeposit(db: Db, sellerId: string, depositId: number): Promise<ActionRow[]> {
  const rows = await db
    .select({
      action: depositActions.action,
      actor: depositActions.actor,
      loginId: accounts.loginId,
      date: depositActions.date,
      buyer: depositActions.buyer,
      seq: depositActions.seq,
      at: depositActions.at,
    })
    .from(depositActions)
    .leftJoin(accounts, and(eq(accounts.id, depositActions.accountId), eq(accounts.sellerId, sellerId)))
    .where(and(eq(depositActions.sellerId, sellerId), eq(depositActions.depositId, depositId)))
    .orderBy(asc(depositActions.at), asc(depositActions.id))
  return rows as ActionRow[]
}

// ── 기억한 입금자명 ──────────────────────────────────────────────────────

export interface NameRow {
  readonly id: number
  readonly channel: string
  readonly norm: string
  readonly name: string
  readonly createdAt: Date
}

export async function listNames(db: Db, sellerId: string): Promise<NameRow[]> {
  return db
    .select({ id: depositNames.id, channel: depositNames.channel, norm: depositNames.norm, name: depositNames.name, createdAt: depositNames.createdAt })
    .from(depositNames)
    .where(eq(depositNames.sellerId, sellerId))
    .orderBy(asc(depositNames.id))
}

export async function insertName(tx: Db, sellerId: string, row: { channel: string; norm: string; name: string }, now: Date): Promise<void> {
  await tx
    .insert(depositNames)
    .values({ sellerId, ...row, createdAt: now })
    .onConflictDoNothing({ target: [depositNames.sellerId, depositNames.channel, depositNames.norm] })
}

export async function deleteName(db: Db, sellerId: string, id: number): Promise<boolean> {
  const rows = await db
    .delete(depositNames)
    .where(and(eq(depositNames.sellerId, sellerId), eq(depositNames.id, id)))
    .returning({ id: depositNames.id })
  return rows.length > 0
}

// ── 요청 번호 ────────────────────────────────────────────────────────────

export interface StoredResult {
  readonly status: number
  readonly body: Readonly<Record<string, unknown>>
}

export async function findRequest(db: Db, sellerId: string, requestId: string): Promise<StoredResult | null> {
  const rows = await db
    .select({ result: depositRequests.result })
    .from(depositRequests)
    .where(and(eq(depositRequests.sellerId, sellerId), eq(depositRequests.requestId, requestId)))
    .limit(1)
  const text = rows[0]?.result
  return text === undefined ? null : (JSON.parse(text) as StoredResult)
}

/** 처음 결과를 남긴다 (이미 있으면 그대로 — 남겼는지 돌려준다) */
export async function insertRequest(tx: Db, sellerId: string, requestId: string, result: StoredResult, now: Date): Promise<boolean> {
  const rows = await tx
    .insert(depositRequests)
    .values({ sellerId, requestId, result: JSON.stringify(result), createdAt: now })
    .onConflictDoNothing({ target: [depositRequests.sellerId, depositRequests.requestId] })
    .returning({ id: depositRequests.id })
  return rows.length > 0
}

// ── 판매자에게 묶인 팝빌 사업자번호 (RA-N3-001) ─────────────────────────────

/** 그 판매자에게 묶인 사업자번호 키 (없으면 null) */
export async function corpKeyOfSeller(db: Db, sellerId: string): Promise<string | null> {
  const rows = await db.select({ corpKey: depositCorpBindings.corpKey }).from(depositCorpBindings).where(eq(depositCorpBindings.sellerId, sellerId)).limit(1)
  return rows[0]?.corpKey ?? null
}

/** 그 사업자번호 키가 묶인 판매자 (없으면 null) */
export async function sellerOfCorpKey(db: Db, corpKey: string): Promise<string | null> {
  const rows = await db.select({ sellerId: depositCorpBindings.sellerId }).from(depositCorpBindings).where(eq(depositCorpBindings.corpKey, corpKey)).limit(1)
  return rows[0]?.sellerId ?? null
}

/** 판매자에게 사업자번호 키를 묶는다 (판매자마다 하나, 키마다 한 판매자 — 이미 있으면 그대로). 묶은 뒤 그 판매자의 키가 이 키인지 */
export async function bindCorpKey(db: Db, sellerId: string, corpKey: string, now: Date): Promise<boolean> {
  await db.insert(depositCorpBindings).values({ sellerId, corpKey, createdAt: now }).onConflictDoNothing()
  return (await corpKeyOfSeller(db, sellerId)) === corpKey
}

/** 판매자에게 묶인 사업자번호를 푼다 (운영자 명령만 — 판매자 API는 없다). 풀었는지 */
export async function unbindCorp(db: Db, sellerId: string): Promise<boolean> {
  const rows = await db.delete(depositCorpBindings).where(eq(depositCorpBindings.sellerId, sellerId)).returning({ sellerId: depositCorpBindings.sellerId })
  return rows.length > 0
}

// ── 범위 ─────────────────────────────────────────────────────────────────

/** 실제 범위(리허설 아님) 중 이벤트가 있는 날짜, [from, to] (날짜 순). from·to가 null이면 그쪽 끝 없음 */
export async function realScopeDates(db: Db, sellerId: string, from: string | null, to: string | null): Promise<string[]> {
  const rows = await db
    .select({ date: scopes.date })
    .from(scopes)
    .where(
      and(
        eq(scopes.sellerId, sellerId),
        eq(scopes.rehearsal, false),
        gt(scopes.seq, 0),
        from === null ? undefined : gte(scopes.date, from),
        to === null ? undefined : lte(scopes.date, to),
      ),
    )
    .orderBy(asc(scopes.date))
  return rows.map((row) => row.date)
}

/** 실제 범위의 ID (없으면 null) */
export async function realScopeId(db: Db, sellerId: string, date: string): Promise<string | null> {
  const rows = await db
    .select({ id: scopes.id })
    .from(scopes)
    .where(and(eq(scopes.sellerId, sellerId), eq(scopes.date, date), eq(scopes.rehearsal, false), gt(scopes.seq, 0)))
    .limit(1)
  return rows[0]?.id ?? null
}
