// 택배 기록 저장소 (PARCEL_RULES PC-3·PC-5·PC-6). 모든 질의에 판매자 ID 조건을 건다(정리·조회 작업의 후보 찾기만 판매자를 가리지 않고, 이어서 쓰는 질의는 그 행의 판매자 ID를 건다).
// - 배송지 여섯 칸은 하나로 묶어 서버 마스터 키로 AES-256-GCM 암호화한다 — AAD = 판매자·날짜·구매자 ID(다른 행으로 옮기면 풀리지 않고 "배송지 없음"으로 본다, D-073 방식).
// - 보내는 사람·택배사 고객 번호도 판매자 ID를 묶어 암호화한다. 원문·암호문 모두 로그에 남기지 않는다.
import { randomBytes, randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm'
import type { Db } from '../db/database.ts'
import { parcelAddresses, parcelRequests, parcelSettings, parcels } from '../db/schema.ts'
import { SecretError, openText, sealText } from '../secrets.ts'
import { CARRIER_CODES, OTHER_CARRIER, isSettingsCarrier, type CarrierCode, type ParcelSender, type SettingsCarrier } from './carrier.ts'
import {
  ADDRESS_FIELDS,
  DEFAULT_BOX,
  LIVE_STATES,
  PARCEL_STATES,
  SENDER_FIELDS,
  TRACK_CODES,
  effectiveState,
  readAddress,
  readAddressInput,
  readSender,
  storedBox,
  type AddressState,
  type BoxKind,
  type FailureReason,
  type ParcelAddress,
  type ParcelState,
  type TrackCode,
} from './rules.ts'

// ── 배송지 ───────────────────────────────────────────────────────────────

const addressAad = (sellerId: string, date: string, buyer: string) => `livejjim/parcel-address/v1/${JSON.stringify([sellerId, date, buyer])}`

export function sealAddress(masterKey: Buffer, sellerId: string, date: string, buyer: string, address: ParcelAddress): string {
  const ordered = Object.fromEntries(ADDRESS_FIELDS.map((field) => [field, address[field]]))
  return sealText(masterKey, addressAad(sellerId, date, buyer), JSON.stringify(ordered))
}

/** 암호문 → 배송지. 다른 행의 것·손상·모양이 틀리면 null (배송지 없음으로 본다) */
export function openAddress(masterKey: Buffer, sellerId: string, date: string, buyer: string, sealed: string): ParcelAddress | null {
  let text: string
  try {
    text = openText(masterKey, addressAad(sellerId, date, buyer), sealed)
  } catch (error) {
    if (error instanceof SecretError) return null
    throw error
  }
  try {
    const input = readAddressInput(JSON.parse(text))
    if (input === null) return null
    const read = readAddress(input)
    return 'ok' in read ? read.ok : null
  } catch {
    return null
  }
}

/** LEDGER: 판매자가 [배송지 확인]으로 장부(지난 주문에 손님이 적은) 배송지를 옮겨 저장 (UX-KP1-004) */
export type AddressSource = 'BUYER' | 'SELLER' | 'LEDGER'

export interface AddressRow {
  readonly id: number
  readonly date: string
  readonly buyer: string
  readonly sealed: string
  readonly source: AddressSource
  readonly confirmed: boolean
  readonly confirmedBy: string | null
  readonly updatedAt: Date
  readonly updatedBy: string | null
}

const addressColumns = {
  id: parcelAddresses.id,
  date: parcelAddresses.date,
  buyer: parcelAddresses.buyer,
  sealed: parcelAddresses.sealed,
  source: parcelAddresses.source,
  confirmed: parcelAddresses.confirmed,
  confirmedBy: parcelAddresses.confirmedBy,
  updatedAt: parcelAddresses.updatedAt,
  updatedBy: parcelAddresses.updatedBy,
}

const toAddressRow = (row: { id: number; date: string; buyer: string; sealed: string; source: string; confirmed: boolean; confirmedBy: string | null; updatedAt: Date; updatedBy: string | null }): AddressRow => ({
  ...row,
  source: row.source === 'SELLER' ? 'SELLER' : row.source === 'LEDGER' ? 'LEDGER' : 'BUYER',
})

export async function addressRow(db: Db, sellerId: string, date: string, buyer: string): Promise<AddressRow | null> {
  const rows = await db
    .select(addressColumns)
    .from(parcelAddresses)
    .where(and(eq(parcelAddresses.sellerId, sellerId), eq(parcelAddresses.date, date), eq(parcelAddresses.buyer, buyer)))
    .limit(1)
  return rows[0] === undefined ? null : toAddressRow(rows[0])
}

export async function addressRowsOf(db: Db, sellerId: string, date: string): Promise<Map<string, AddressRow>> {
  const rows = await db.select(addressColumns).from(parcelAddresses).where(and(eq(parcelAddresses.sellerId, sellerId), eq(parcelAddresses.date, date)))
  return new Map(rows.map((row) => [row.buyer, toAddressRow(row)]))
}

/** 배송지 하나를 덮어쓴다 (이전 내용은 남기지 않는다) */
export async function putAddress(
  tx: Db,
  masterKey: Buffer,
  input: { sellerId: string; date: string; buyer: string; address: ParcelAddress; source: AddressSource; accountId: string | null; confirmed: boolean; now: Date },
): Promise<void> {
  const values = {
    sealed: sealAddress(masterKey, input.sellerId, input.date, input.buyer, input.address),
    source: input.source,
    confirmed: input.confirmed,
    confirmedBy: input.confirmed ? input.accountId : null,
    updatedAt: input.now,
    updatedBy: input.accountId,
  }
  await tx
    .insert(parcelAddresses)
    .values({ sellerId: input.sellerId, date: input.date, buyer: input.buyer, ...values })
    .onConflictDoUpdate({ target: [parcelAddresses.sellerId, parcelAddresses.date, parcelAddresses.buyer], set: values })
}

export async function confirmAddress(tx: Db, sellerId: string, date: string, buyer: string, accountId: string): Promise<void> {
  await tx
    .update(parcelAddresses)
    .set({ confirmed: true, confirmedBy: accountId })
    .where(and(eq(parcelAddresses.sellerId, sellerId), eq(parcelAddresses.date, date), eq(parcelAddresses.buyer, buyer)))
}

export async function deleteAddress(tx: Db, sellerId: string, date: string, buyer: string): Promise<void> {
  await tx.delete(parcelAddresses).where(and(eq(parcelAddresses.sellerId, sellerId), eq(parcelAddresses.date, date), eq(parcelAddresses.buyer, buyer)))
}

/**
 * 합치기 (PC-3 "합치기·떼어 내기", D-T1-07): 그 날짜 구매자 X(from)를 Y(into)에 합친 기록과 같은 트랜잭션에서.
 * X에게 배송지가 있으면 — Y에게 없으면 X의 것을 Y로 옮기고(Y의 키로 다시 암호화), 있으면 Y의 것을 둔다. 어느 쪽이든 Y의 배송지는 "확인 전", X의 배송지는 지운다
 */
export async function mergeAddress(tx: Db, masterKey: Buffer, sellerId: string, date: string, from: string, into: string, now: Date): Promise<void> {
  if (from === into) return
  const source = await addressRow(tx, sellerId, date, from)
  if (source === null) return
  const target = await addressRow(tx, sellerId, date, into)
  if (target === null) {
    const opened = openAddress(masterKey, sellerId, date, from, source.sealed)
    if (opened !== null) await putAddress(tx, masterKey, { sellerId, date, buyer: into, address: opened, source: source.source, accountId: null, confirmed: false, now })
  } else {
    await tx
      .update(parcelAddresses)
      .set({ confirmed: false, confirmedBy: null })
      .where(and(eq(parcelAddresses.sellerId, sellerId), eq(parcelAddresses.date, date), eq(parcelAddresses.buyer, into)))
  }
  await deleteAddress(tx, sellerId, date, from)
}

/** 보관 기간이 끝난 배송지를 지운다 (PC-3 "보관" — 날짜 + 30일의 0시 KST. lastDate = 지울 마지막 날짜). 지운 수 */
export async function sweepAddresses(db: Db, lastDate: string): Promise<number> {
  const deleted = await db.delete(parcelAddresses).where(lte(parcelAddresses.date, lastDate)).returning({ id: parcelAddresses.id })
  return deleted.length
}

// ── 접수 시도 ────────────────────────────────────────────────────────────

export interface AttemptRow {
  readonly id: string
  readonly date: string
  readonly buyer: string
  readonly carrier: CarrierCode
  readonly requestKey: string
  readonly state: ParcelState
  readonly reason: FailureReason | null
  readonly invoice: string | null
  readonly box: BoxKind
  readonly qty: number
  readonly track: TrackCode | null
  readonly trackedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly bookedAt: Date | null
  readonly cancelledAt: Date | null
}

type RawAttempt = typeof parcels.$inferSelect

const toAttempt = (row: RawAttempt): AttemptRow => ({
  id: row.id,
  date: row.date,
  buyer: row.buyer,
  carrier: (CARRIER_CODES as readonly string[]).includes(row.carrier) ? (row.carrier as CarrierCode) : 'FAKE',
  requestKey: row.requestKey,
  state: (PARCEL_STATES as readonly string[]).includes(row.state) ? (row.state as ParcelState) : 'UNKNOWN',
  reason: row.reason === 'ADDRESS' || row.reason === 'REJECTED' || row.reason === 'UNAVAILABLE' ? row.reason : null,
  invoice: row.invoice,
  box: storedBox(row.box),
  qty: row.qty,
  track: (TRACK_CODES as readonly string[]).includes(row.track ?? '') ? (row.track as TrackCode) : null,
  trackedAt: row.trackedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  bookedAt: row.bookedAt,
  cancelledAt: row.cancelledAt,
})

/** 그 날짜 구매자마다 가장 나중 시도 */
export async function latestAttempts(db: Db, sellerId: string, date: string): Promise<Map<string, AttemptRow>> {
  const rows = await db
    .select()
    .from(parcels)
    .where(and(eq(parcels.sellerId, sellerId), eq(parcels.date, date)))
    .orderBy(asc(parcels.no))
  const out = new Map<string, AttemptRow>()
  // 살아 있는 시도가 있으면 그것(많아야 하나), 없으면 가장 나중 것
  for (const raw of rows) {
    const row = toAttempt(raw)
    const known = out.get(row.buyer)
    if (known === undefined || !LIVE_STATES.includes(known.state) || LIVE_STATES.includes(row.state)) out.set(row.buyer, row)
  }
  return out
}

export async function latestAttempt(db: Db, sellerId: string, date: string, buyer: string): Promise<AttemptRow | null> {
  const rows = await db
    .select()
    .from(parcels)
    .where(and(eq(parcels.sellerId, sellerId), eq(parcels.date, date), eq(parcels.buyer, buyer)))
    .orderBy(desc(parcels.no))
  const list = rows.map(toAttempt)
  return list.find((row) => LIVE_STATES.includes(row.state)) ?? list[0] ?? null
}

export async function attemptById(db: Db, sellerId: string, id: string): Promise<AttemptRow | null> {
  const rows = await db
    .select()
    .from(parcels)
    .where(and(eq(parcels.sellerId, sellerId), eq(parcels.id, id)))
    .limit(1)
  return rows[0] === undefined ? null : toAttempt(rows[0])
}

/** 그 묶음에 살아 있는 시도가 있는지 (포장 명령·합치기 막기) */
export async function hasLiveAttempt(db: Db, sellerId: string, date: string, buyer: string, states: readonly ParcelState[] = LIVE_STATES): Promise<boolean> {
  const rows = await db
    .select({ id: parcels.id })
    .from(parcels)
    .where(and(eq(parcels.sellerId, sellerId), eq(parcels.date, date), eq(parcels.buyer, buyer), inArray(parcels.state, [...states])))
    .limit(1)
  return rows.length > 0
}

/** 무작위 택배사 요청 번호 (전화번호·이름을 담지 않는다) */
export const newRequestKey = (): string => `lj-${randomBytes(16).toString('base64url')}`

/** 새 시도 PENDING (살아 있는 시도가 이미 있으면 DB 고유 색인이 막아 null — PC-INV-1) */
export async function insertAttempt(
  tx: Db,
  input: { sellerId: string; date: string; buyer: string; carrier: CarrierCode; box: BoxKind; qty: number; accountId: string; now: Date },
): Promise<AttemptRow | null> {
  const id = `pc_${randomUUID()}`
  const inserted = await tx
    .insert(parcels)
    .values({
      id,
      sellerId: input.sellerId,
      date: input.date,
      buyer: input.buyer,
      carrier: input.carrier,
      requestKey: newRequestKey(),
      state: 'PENDING',
      box: input.box,
      qty: input.qty,
      createdAt: input.now,
      createdBy: input.accountId,
      updatedAt: input.now,
    })
    .onConflictDoNothing()
    .returning()
  return inserted[0] === undefined ? null : toAttempt(inserted[0])
}

/** 시도 상태 바꾸기 (from 상태일 때만 — 바뀐 행이 없으면 false) */
export async function moveAttempt(
  tx: Db,
  sellerId: string,
  id: string,
  from: readonly ParcelState[],
  set: Partial<{ state: ParcelState; reason: FailureReason | null; invoice: string | null; track: TrackCode | null; trackedAt: Date | null; bookedAt: Date; cancelledAt: Date; cancelledBy: string; updatedAt: Date }>,
): Promise<boolean> {
  const updated = await tx
    .update(parcels)
    .set(set)
    .where(and(eq(parcels.sellerId, sellerId), eq(parcels.id, id), inArray(parcels.state, [...from])))
    .returning({ id: parcels.id })
  return updated.length > 0
}

/** 조회할 시도 (판매자를 가리지 않고 할 일을 찾는다 — 접수 뒤 14일 안, 도착 전) */
export async function trackCandidates(db: Db, bookedAfter: Date): Promise<{ id: string; sellerId: string; date: string; buyer: string; carrier: string; invoice: string; track: string | null }[]> {
  const rows = await db
    .select({ id: parcels.id, sellerId: parcels.sellerId, date: parcels.date, buyer: parcels.buyer, carrier: parcels.carrier, invoice: parcels.invoice, track: parcels.track, bookedAt: parcels.bookedAt })
    .from(parcels)
    .where(and(eq(parcels.state, 'BOOKED'), sql`${parcels.bookedAt} >= ${bookedAfter}`, sql`(${parcels.track} is null or ${parcels.track} <> 'DELIVERED')`))
    .orderBy(asc(parcels.bookedAt))
  return rows.flatMap((row) => (row.invoice === null ? [] : [{ id: row.id, sellerId: row.sellerId, date: row.date, buyer: row.buyer, carrier: row.carrier, invoice: row.invoice, track: row.track }]))
}

export async function setTrack(db: Db, sellerId: string, id: string, track: TrackCode, at: Date): Promise<void> {
  await db
    .update(parcels)
    .set({ track, trackedAt: at })
    .where(and(eq(parcels.sellerId, sellerId), eq(parcels.id, id), eq(parcels.state, 'BOOKED')))
}

/** 지금 보이는 상태 (2분 넘은 PENDING → UNKNOWN) */
export const stateNow = (row: AttemptRow, now: number): ParcelState => effectiveState(row.state, row.updatedAt.getTime(), now)

/** 배송지 행 → 상태 (보관 기간이 지났거나 풀리지 않으면 없음) */
export function addressState(row: AddressRow | null | undefined, opened: boolean): AddressState {
  if (row === null || row === undefined || !opened) return 'NONE'
  return row.confirmed ? 'CONFIRMED' : 'UNCONFIRMED'
}

// ── 화면 요청 번호 ───────────────────────────────────────────────────────

export type ParcelRequestKind = 'BOOK' | 'CANCEL' | 'ADDRESS' | 'CONFIRM' | 'DELETE' | 'LEDGER' // KP1 LEDGER = 장부 배송지 확인(CR-4)

export interface RequestRow {
  readonly date: string
  readonly kind: string
  readonly targets: string
  readonly result: string | null
  readonly createdAt: Date
}

export async function requestRow(db: Db, sellerId: string, requestId: string): Promise<RequestRow | null> {
  const rows = await db
    .select({ date: parcelRequests.date, kind: parcelRequests.kind, targets: parcelRequests.targets, result: parcelRequests.result, createdAt: parcelRequests.createdAt })
    .from(parcelRequests)
    .where(and(eq(parcelRequests.sellerId, sellerId), eq(parcelRequests.requestId, requestId)))
    .limit(1)
  return rows[0] ?? null
}

/** 요청 번호를 처음 적는다 (이미 있으면 false) */
export async function claimRequest(db: Db, input: { sellerId: string; requestId: string; date: string; kind: ParcelRequestKind; targets: readonly unknown[]; result: string | null; now: Date }): Promise<boolean> {
  const inserted = await db
    .insert(parcelRequests)
    .values({ sellerId: input.sellerId, requestId: input.requestId, date: input.date, kind: input.kind, targets: JSON.stringify(input.targets), result: input.result, createdAt: input.now })
    .onConflictDoNothing({ target: [parcelRequests.sellerId, parcelRequests.requestId] })
    .returning({ id: parcelRequests.id })
  return inserted.length > 0
}

/**
 * 결과 없이 남은 요청 번호를 이어받는다 (TD-T1-002): 결과가 없고 처음 적은 때(createdAt)가 그대로일 때만 지금 시각으로 바꾼다.
 * 두 요청이 함께 이어받으려 해도 한쪽만 true다(조건부 갱신 하나)
 */
export async function takeOverRequest(db: Db, sellerId: string, requestId: string, seenCreatedAt: Date, now: Date): Promise<boolean> {
  const updated = await db
    .update(parcelRequests)
    .set({ createdAt: now })
    .where(and(eq(parcelRequests.sellerId, sellerId), eq(parcelRequests.requestId, requestId), isNull(parcelRequests.result), eq(parcelRequests.createdAt, seenCreatedAt)))
    .returning({ id: parcelRequests.id })
  return updated.length > 0
}

export async function saveRequestResult(db: Db, sellerId: string, requestId: string, result: string): Promise<void> {
  await db
    .update(parcelRequests)
    .set({ result })
    .where(and(eq(parcelRequests.sellerId, sellerId), eq(parcelRequests.requestId, requestId)))
}

export async function dropRequest(db: Db, sellerId: string, requestId: string): Promise<void> {
  await db.delete(parcelRequests).where(and(eq(parcelRequests.sellerId, sellerId), eq(parcelRequests.requestId, requestId)))
}

// ── 설정 "택배" ──────────────────────────────────────────────────────────

const senderAad = (sellerId: string) => `livejjim/parcel-sender/v1/${sellerId}`
const customerAad = (sellerId: string) => `livejjim/parcel-customer/v1/${sellerId}`
const epostAad = (sellerId: string) => `livejjim/parcel-epost/v1/${sellerId}`

/** 우체국 계약소포 인증키·보안키 (D-REAL-04 — 고객 번호는 customerNo) */
export interface EpostKeys {
  readonly key: string
  readonly secret: string
}

export interface StoredSettings {
  /** 쓰는 택배사 (자동 접수는 그 코드의 어댑터가 있을 때만 — FB1 D-FB1-04) */
  readonly carrier: SettingsCarrier | null
  /** 직접 입력(OTHER) 이름 — 그 밖엔 null */
  readonly carrierName: string | null
  readonly customerNo: string | null
  readonly sender: ParcelSender | null
  readonly box: BoxKind
  readonly epost: EpostKeys | null
}

export async function readSettings(db: Db, masterKey: Buffer, sellerId: string): Promise<StoredSettings> {
  const rows = await db.select().from(parcelSettings).where(eq(parcelSettings.sellerId, sellerId)).limit(1)
  const row = rows[0]
  if (row === undefined) return { carrier: null, carrierName: null, customerNo: null, sender: null, box: DEFAULT_BOX, epost: null }
  const open = (aad: string, sealed: string | null): string | null => {
    if (sealed === null) return null
    try {
      return openText(masterKey, aad, sealed)
    } catch {
      return null
    }
  }
  let sender: ParcelSender | null = null
  const senderText = open(senderAad(sellerId), row.senderEnc)
  if (senderText !== null) {
    try {
      const parsed = JSON.parse(senderText) as Record<string, unknown>
      const input = readAddressInput(parsed, SENDER_FIELDS)
      const read = input === null ? null : readSender(input)
      if (read !== null && 'ok' in read) sender = read.ok
    } catch {
      sender = null
    }
  }
  return {
    carrier: isSettingsCarrier(row.carrier) ? row.carrier : null,
    carrierName: row.carrier === OTHER_CARRIER && row.carrierName !== null && row.carrierName !== '' ? row.carrierName : null,
    customerNo: open(customerAad(sellerId), row.customerEnc),
    sender,
    box: storedBox(row.box),
    epost: readEpostKeys(open(epostAad(sellerId), row.epostEnc)),
  }
}

function readEpostKeys(text: string | null): EpostKeys | null {
  if (text === null) return null
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    return typeof parsed.key === 'string' && typeof parsed.secret === 'string' && parsed.key !== '' && parsed.secret !== '' ? { key: parsed.key, secret: parsed.secret } : null
  } catch {
    return null
  }
}

export async function writeSettings(db: Db, masterKey: Buffer, sellerId: string, value: StoredSettings, now: Date): Promise<void> {
  const values = {
    carrier: value.carrier,
    carrierName: value.carrier === OTHER_CARRIER ? value.carrierName : null,
    customerEnc: value.customerNo === null || value.customerNo === '' ? null : sealText(masterKey, customerAad(sellerId), value.customerNo),
    senderEnc: value.sender === null ? null : sealText(masterKey, senderAad(sellerId), JSON.stringify(value.sender)),
    box: value.box,
    epostEnc: value.epost === null ? null : sealText(masterKey, epostAad(sellerId), JSON.stringify({ key: value.epost.key, secret: value.epost.secret })),
    updatedAt: now,
  }
  await db
    .insert(parcelSettings)
    .values({ sellerId, ...values })
    .onConflictDoUpdate({ target: parcelSettings.sellerId, set: values })
}
