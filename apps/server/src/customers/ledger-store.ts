// 손님 장부 저장소 (KP1, CUSTOMER_RULES CR-1~CR-5). 모든 질의에 판매자 ID 조건을 건다 — 함수마다 sellerId를 첫 인자로 받는다.
// - 연락처 다섯 칸(받는 분·연락처·주소·상세 주소·우편번호 — 배송 메모 없음)은 JSON으로 묶어 서버 마스터 키 AES-GCM으로 암호화한다.
//   AAD = 판매자·줄 ID (다른 행으로 옮기면 풀리지 않는다 — parcel/store.ts sealAddress와 같은 방식). 풀리지 않으면 "없음"으로 본다.
// - 장부 쓰기(동의·합치기·지우기·코드)는 판매자마다 어드바이저리 락(ledgerLockKey)을 잡은 한 트랜잭션에서 한다.
//   범위 줄 안(배송지 저장 트랜잭션)에서도 부른다 — 락 순서는 늘 범위 락 → 장부 락이고, 장부 락을 잡은 쪽은 범위 락을 잡지 않는다(교착 없음).
// - 동의 기록은 덧붙이기만 한다. 연락처·표지·코드 글·토큰·구매자 ID를 동의 기록·로그에 넣지 않는다.
import { randomBytes } from 'node:crypto'
import { and, asc, eq, inArray, lte, ne, sql } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { ledgerCodes, ledgerConsents, ledgerLines, ledgerMarkers, ledgerSettings } from '../db/schema.ts'
import { SecretError, openText, sealText } from '../secrets.ts'
import { CR_CONSENT_1, DEFAULT_LEDGER_MONTHS, LEDGER_CONSENT_ITEMS, isLedgerMonths, type LedgerMonths } from './ledger-rules.ts'

export interface LedgerSettings {
  readonly months: LedgerMonths
  readonly consoleBadges: boolean
}

export const DEFAULT_LEDGER_SETTINGS: LedgerSettings = { months: DEFAULT_LEDGER_MONTHS, consoleBadges: true }

/** 장부 연락처 다섯 칸 (PC-2로 다듬은 값 — 배송 메모 없음) */
export interface LedgerContact {
  readonly name: string
  readonly phone: string
  readonly address: string
  readonly detail: string
  readonly zip: string
}

const CONTACT_FIELDS = ['name', 'phone', 'address', 'detail', 'zip'] as const

export interface LineRow {
  readonly id: string
  readonly contactEnc: string
  readonly consentDate: string
  readonly consentMonths: number
  readonly createdAt: Date
  readonly updatedAt: Date
}

export type ConsentType = 'AGREE' | 'WITHDRAW' | 'EXPIRE' | 'SELLER_DELETE'
export type ConsentReason = '표지 옮김' | '기간 지남' | '줄 합침'

/** 판매자마다 장부 쓰기를 차례로 (어드바이저리 락 키) */
export const ledgerLockKey = (sellerId: string) => sql`hashtextextended(${`ledger/${sellerId}`}, 0)`

export async function lockLedger(tx: Db, sellerId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${ledgerLockKey(sellerId)})`)
}

/** 새 줄·코드 ID (무작위 32 hex) */
export const newLedgerId = (): string => randomBytes(16).toString('hex')

const contactAad = (sellerId: string, lineId: string) => `livejjim/customer-ledger/v1/${JSON.stringify([sellerId, lineId])}`

export function sealContact(masterKey: Buffer, sellerId: string, lineId: string, contact: LedgerContact): string {
  const ordered = Object.fromEntries(CONTACT_FIELDS.map((field) => [field, contact[field]]))
  return sealText(masterKey, contactAad(sellerId, lineId), JSON.stringify(ordered))
}

/** 암호문 → 연락처. 다른 행의 것·손상·모양이 틀리면 null */
export function openContact(masterKey: Buffer, sellerId: string, lineId: string, sealed: string): LedgerContact | null {
  let text: string
  try {
    text = openText(masterKey, contactAad(sellerId, lineId), sealed)
  } catch (error) {
    if (error instanceof SecretError) return null
    throw error
  }
  try {
    const value = JSON.parse(text) as Record<string, unknown>
    if (typeof value !== 'object' || value === null) return null
    for (const field of CONTACT_FIELDS) if (typeof value[field] !== 'string') return null
    return { name: value.name as string, phone: value.phone as string, address: value.address as string, detail: value.detail as string, zip: value.zip as string }
  } catch {
    return null
  }
}

// ── 설정 ───────────────────────────────────────────────────────────────

export async function readLedgerSettings(db: Db, sellerId: string): Promise<LedgerSettings> {
  const rows = await db.select().from(ledgerSettings).where(eq(ledgerSettings.sellerId, sellerId)).limit(1)
  const row = rows[0]
  if (row === undefined) return DEFAULT_LEDGER_SETTINGS
  return { months: isLedgerMonths(row.months) ? row.months : DEFAULT_LEDGER_MONTHS, consoleBadges: row.consoleBadges }
}

export async function writeLedgerSettings(db: Db, sellerId: string, value: LedgerSettings, now: Date): Promise<void> {
  const fields = { months: value.months, consoleBadges: value.consoleBadges, updatedAt: now }
  await db
    .insert(ledgerSettings)
    .values({ sellerId, ...fields })
    .onConflictDoUpdate({ target: ledgerSettings.sellerId, set: fields })
}

// ── 줄·표지 ────────────────────────────────────────────────────────────

const lineColumns = {
  id: ledgerLines.id,
  contactEnc: ledgerLines.contactEnc,
  consentDate: ledgerLines.consentDate,
  consentMonths: ledgerLines.consentMonths,
  createdAt: ledgerLines.createdAt,
  updatedAt: ledgerLines.updatedAt,
}

/** 표지 → 줄 ID (그 판매자의 것만) */
export async function lineIdsOfMarkers(db: Db, sellerId: string, markers: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const unique = [...new Set(markers)]
  if (unique.length === 0) return out
  const rows = await db
    .select({ marker: ledgerMarkers.marker, lineId: ledgerMarkers.lineId })
    .from(ledgerMarkers)
    .where(and(eq(ledgerMarkers.sellerId, sellerId), inArray(ledgerMarkers.marker, unique)))
  for (const row of rows) out.set(row.marker, row.lineId)
  return out
}

/** 표지들이 든 서로 다른 줄 (만든 순 — 가장 먼저 만든 것이 앞) */
export async function linesOfMarkers(db: Db, sellerId: string, markers: readonly string[]): Promise<LineRow[]> {
  const ids = [...new Set((await lineIdsOfMarkers(db, sellerId, markers)).values())]
  return linesByIds(db, sellerId, ids)
}

export async function linesByIds(db: Db, sellerId: string, ids: readonly string[]): Promise<LineRow[]> {
  if (ids.length === 0) return []
  return db
    .select(lineColumns)
    .from(ledgerLines)
    .where(and(eq(ledgerLines.sellerId, sellerId), inArray(ledgerLines.id, [...ids])))
    .orderBy(asc(ledgerLines.createdAt), asc(ledgerLines.id))
}

export async function lineById(db: Db, sellerId: string, id: string): Promise<LineRow | null> {
  return (await linesByIds(db, sellerId, [id]))[0] ?? null
}

/** 판매자의 모든 줄 (정리 작업) */
export async function allLines(db: Db, sellerId: string): Promise<LineRow[]> {
  return db.select(lineColumns).from(ledgerLines).where(eq(ledgerLines.sellerId, sellerId)).orderBy(asc(ledgerLines.createdAt), asc(ledgerLines.id))
}

/** 줄이 있는 판매자 (정리 작업) */
export async function sellersWithLines(db: Db): Promise<string[]> {
  const rows = await db.selectDistinct({ sellerId: ledgerLines.sellerId }).from(ledgerLines)
  return rows.map((row) => row.sellerId).sort()
}

export interface MarkerRow {
  readonly marker: string
  readonly lineId: string
  readonly source: 'CONSENT' | 'CODE'
  readonly labelPlatform: string | null
  readonly labelName: string | null
  readonly labelLast4: string | null
  readonly linkedAt: Date
}

/** 줄들의 표지 */
export async function markersOfLines(db: Db, sellerId: string, lineIds: readonly string[]): Promise<MarkerRow[]> {
  if (lineIds.length === 0) return []
  const rows = await db
    .select({
      marker: ledgerMarkers.marker,
      lineId: ledgerMarkers.lineId,
      source: ledgerMarkers.source,
      labelPlatform: ledgerMarkers.labelPlatform,
      labelName: ledgerMarkers.labelName,
      labelLast4: ledgerMarkers.labelLast4,
      linkedAt: ledgerMarkers.linkedAt,
    })
    .from(ledgerMarkers)
    .where(and(eq(ledgerMarkers.sellerId, sellerId), inArray(ledgerMarkers.lineId, [...new Set(lineIds)])))
    .orderBy(asc(ledgerMarkers.id))
  return rows.map((row) => ({ ...row, source: row.source === 'CODE' ? 'CODE' : 'CONSENT' }))
}

/** 동의 기록 한 줄 (덧붙이기만 — 연락처·표지 없음) */
export async function addConsent(
  tx: Db,
  input: { sellerId: string; lineId: string; type: ConsentType; months: number; route: 'RECEIPT_LINK' | null; orderDate: string | null; reason: ConsentReason | null; accountId: string | null; at: Date },
): Promise<void> {
  await tx.insert(ledgerConsents).values({
    sellerId: input.sellerId,
    lineId: input.lineId,
    type: input.type,
    items: LEDGER_CONSENT_ITEMS,
    wording: CR_CONSENT_1.id,
    months: input.months,
    route: input.route,
    orderDate: input.orderDate,
    reason: input.reason,
    accountId: input.accountId,
    at: input.at,
  })
}

/** 줄 지우기 (CR-3 "지운다"): 동의 기록 한 줄을 남기고 코드·표지·줄을 지운다. 줄이 없으면 false */
export async function deleteLine(
  tx: Db,
  sellerId: string,
  lineId: string,
  record: { type: ConsentType; reason: ConsentReason | null; accountId: string | null; route: 'RECEIPT_LINK' | null; orderDate: string | null; at: Date },
): Promise<boolean> {
  const line = await lineById(tx, sellerId, lineId)
  if (line === null) return false
  await addConsent(tx, { sellerId, lineId, months: line.consentMonths, ...record })
  await tx.delete(ledgerCodes).where(and(eq(ledgerCodes.sellerId, sellerId), eq(ledgerCodes.lineId, lineId)))
  await tx.delete(ledgerMarkers).where(and(eq(ledgerMarkers.sellerId, sellerId), eq(ledgerMarkers.lineId, lineId)))
  await tx.delete(ledgerLines).where(and(eq(ledgerLines.sellerId, sellerId), eq(ledgerLines.id, lineId)))
  return true
}

/** 표지가 하나도 남지 않은 줄이면 지운다 (CR-1·CR-3 — EXPIRE '표지 옮김') */
export async function dropIfEmpty(tx: Db, sellerId: string, lineId: string, at: Date): Promise<boolean> {
  const left = await tx
    .select({ id: ledgerMarkers.id })
    .from(ledgerMarkers)
    .where(and(eq(ledgerMarkers.sellerId, sellerId), eq(ledgerMarkers.lineId, lineId)))
    .limit(1)
  if (left.length > 0) return false
  return deleteLine(tx, sellerId, lineId, { type: 'EXPIRE', reason: '표지 옮김', accountId: null, route: null, orderDate: null, at })
}

/**
 * 동의 저장 (CR-2, AC-KP1-03): 표지 묶음 S와 겹치는 줄이 없으면 새 줄, 있으면 그 줄들을 가장 먼저 만든 줄 하나로 합친다(표지 ∪ S).
 * 연락처는 이번 다섯 칸, 동의 날짜·개월은 이번 것. 합쳐 없어진 줄은 EXPIRE '줄 합침'(가정). AGREE 한 줄. 같은 트랜잭션에서 부른다(장부 락을 잡는다).
 * 돌려주는 값 = 남은 줄 ID
 */
export async function consentInTx(
  tx: Db,
  masterKey: Buffer,
  input: { sellerId: string; date: string; markers: readonly string[]; contact: LedgerContact; months: LedgerMonths; now: Date; newId?: () => string },
): Promise<string> {
  const { sellerId, now } = input
  const markers = [...new Set(input.markers)]
  if (markers.length === 0) throw new Error('표지가 없다')
  await lockLedger(tx, sellerId)
  const lines = await linesOfMarkers(tx, sellerId, markers)
  let lineId: string
  if (lines.length === 0) {
    lineId = (input.newId ?? newLedgerId)()
    await tx.insert(ledgerLines).values({
      id: lineId,
      sellerId,
      contactEnc: sealContact(masterKey, sellerId, lineId, input.contact),
      consentDate: input.date,
      consentMonths: input.months,
      createdAt: now,
      updatedAt: now,
    })
  } else {
    const keep = lines[0] as LineRow
    lineId = keep.id
    for (const other of lines.slice(1)) {
      // 다른 줄의 표지를 남는 줄로 옮기고 코드는 버린다
      await tx
        .update(ledgerMarkers)
        .set({ lineId })
        .where(and(eq(ledgerMarkers.sellerId, sellerId), eq(ledgerMarkers.lineId, other.id)))
      await deleteLine(tx, sellerId, other.id, { type: 'EXPIRE', reason: '줄 합침', accountId: null, route: null, orderDate: null, at: now })
    }
    await tx
      .update(ledgerLines)
      .set({ contactEnc: sealContact(masterKey, sellerId, lineId, input.contact), consentDate: input.date, consentMonths: input.months, updatedAt: now })
      .where(and(eq(ledgerLines.sellerId, sellerId), eq(ledgerLines.id, lineId)))
  }
  await tx
    .insert(ledgerMarkers)
    .values(markers.map((marker) => ({ sellerId, marker, lineId, source: 'CONSENT', labelPlatform: null, labelName: null, labelLast4: null, linkedAt: now })))
    .onConflictDoNothing({ target: [ledgerMarkers.sellerId, ledgerMarkers.marker] })
  await addConsent(tx, { sellerId, lineId, type: 'AGREE', months: input.months, route: 'RECEIPT_LINK', orderDate: input.date, reason: null, accountId: null, at: now })
  return lineId
}

// ── 연결 코드 ───────────────────────────────────────────────────────────

export interface CodeRow {
  readonly id: string
  readonly lineId: string
  readonly code: string
  readonly createdAt: Date
  readonly expiresAt: Date
  readonly state: 'LIVE' | 'CLAIMED' | 'DONE'
  readonly claimedMarker: string | null
  readonly claimedPlatform: string | null
  readonly claimedName: string | null
  readonly claimedLast4: string | null
}

const codeColumns = {
  id: ledgerCodes.id,
  lineId: ledgerCodes.lineId,
  code: ledgerCodes.code,
  createdAt: ledgerCodes.createdAt,
  expiresAt: ledgerCodes.expiresAt,
  state: ledgerCodes.state,
  claimedMarker: ledgerCodes.claimedMarker,
  claimedPlatform: ledgerCodes.claimedPlatform,
  claimedName: ledgerCodes.claimedName,
  claimedLast4: ledgerCodes.claimedLast4,
}

const toCode = (row: { state: string } & Omit<CodeRow, 'state'>): CodeRow => ({ ...row, state: row.state === 'LIVE' || row.state === 'CLAIMED' ? row.state : 'DONE' })

/** 줄의 끝나지 않은 코드 (많아야 하나) */
export async function openCodeOfLine(db: Db, sellerId: string, lineId: string): Promise<CodeRow | null> {
  const rows = await db
    .select(codeColumns)
    .from(ledgerCodes)
    .where(and(eq(ledgerCodes.sellerId, sellerId), eq(ledgerCodes.lineId, lineId), ne(ledgerCodes.state, 'DONE')))
    .limit(1)
  return rows[0] === undefined ? null : toCode(rows[0])
}

/** 판매자의 LIVE 코드 (기한과 상관없이 — 겹치지 않게 고를 때·채팅에서 읽을 때) */
export async function liveCodes(db: Db, sellerId: string): Promise<CodeRow[]> {
  const rows = await db
    .select(codeColumns)
    .from(ledgerCodes)
    .where(and(eq(ledgerCodes.sellerId, sellerId), eq(ledgerCodes.state, 'LIVE')))
  return rows.map(toCode)
}

/** 줄의 끝나지 않은 코드를 끝낸다 */
export async function finishCodesOfLine(tx: Db, sellerId: string, lineId: string): Promise<void> {
  await tx
    .update(ledgerCodes)
    .set({ state: 'DONE' })
    .where(and(eq(ledgerCodes.sellerId, sellerId), eq(ledgerCodes.lineId, lineId), ne(ledgerCodes.state, 'DONE')))
}

export async function insertCode(tx: Db, input: { id: string; sellerId: string; lineId: string; code: string; now: Date; expiresAt: Date }): Promise<void> {
  await tx.insert(ledgerCodes).values({ id: input.id, sellerId: input.sellerId, lineId: input.lineId, code: input.code, createdAt: input.now, expiresAt: input.expiresAt, state: 'LIVE' })
}

/** 채팅이 코드를 썼다 — LIVE이고 기한 안일 때만 CLAIMED (조건부 UPDATE — 처음 맞은 채팅 하나만). 바꿨으면 true */
export async function claimCode(db: Db, input: { sellerId: string; id: string; marker: string; platform: string; name: string; last4: string; now: Date }): Promise<boolean> {
  const rows = await db
    .update(ledgerCodes)
    .set({ state: 'CLAIMED', claimedMarker: input.marker, claimedPlatform: input.platform, claimedName: input.name, claimedLast4: input.last4, claimedAt: input.now })
    .where(and(eq(ledgerCodes.sellerId, input.sellerId), eq(ledgerCodes.id, input.id), eq(ledgerCodes.state, 'LIVE'), sql`${ledgerCodes.expiresAt} > ${input.now}`))
    .returning({ id: ledgerCodes.id })
  return rows.length > 0
}

/** 기한이 지난 LIVE·CLAIMED 코드를 끝낸다 (정리 작업 — 모든 판매자). 끝낸 수 */
export async function finishExpiredCodes(db: Db, now: Date): Promise<number> {
  const rows = await db
    .update(ledgerCodes)
    .set({ state: 'DONE' })
    .where(and(inArray(ledgerCodes.state, ['LIVE', 'CLAIMED']), lte(ledgerCodes.expiresAt, now)))
    .returning({ id: ledgerCodes.id, sellerId: ledgerCodes.sellerId })
  return rows.length
}

/** 표지를 줄로 옮긴다 (CR-5 "네" — 다른 줄에 있었으면 빼고, 빈 줄은 지운다). CODE 이름표를 단다 */
export async function moveMarker(
  tx: Db,
  input: { sellerId: string; marker: string; lineId: string; platform: string | null; name: string | null; last4: string | null; now: Date },
): Promise<void> {
  const { sellerId, marker, lineId, now } = input
  const before = (await lineIdsOfMarkers(tx, sellerId, [marker])).get(marker) ?? null
  const label = { source: 'CODE', labelPlatform: input.platform, labelName: input.name, labelLast4: input.last4, linkedAt: now }
  if (before === null) {
    await tx.insert(ledgerMarkers).values({ sellerId, marker, lineId, ...label })
    return
  }
  await tx
    .update(ledgerMarkers)
    .set({ lineId, ...label })
    .where(and(eq(ledgerMarkers.sellerId, sellerId), eq(ledgerMarkers.marker, marker)))
  if (before !== lineId) await dropIfEmpty(tx, sellerId, before, now)
}
