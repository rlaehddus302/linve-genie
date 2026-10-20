// 백업·복구·전체 내려받기 (DAT-03·DAT-04, I2 D-I2-10~D-I2-12, AC-I2-60~64).
// 파일 = gzip으로 압축한 JSON 하나 (형식은 harness/sprints/I2/dev-notes.md "백업 파일 형식"):
//   형식 이름·번호, 만든 시각(UTC ISO), 판매자 ID, 가게 설정, 판매 규칙 설정, 모든 범위(실제·리허설)의 방송 목록과 이벤트 기록 전부(seq 순),
//   포장·배송 기록 전부(기록 순), 내용 요약값(만든 시각·요약값 칸을 뺀 내용의 정규 JSON SHA-256 — 손상 확인).
// 넣지 않는다: 비밀번호 해시·로그인 아이디·세션·로그인 시도 기록·판매자 전화번호 키(암호문 포함)·마스터 키·상태 스냅샷·발송함.
// - 범위마다 한 시점의 일관된 기록: 범위 행의 seq를 먼저 읽고 그 seq까지의 이벤트만 담는다(이벤트는 덧붙이기만, seq는 이벤트와 같은 트랜잭션에서 고친다).
//   방송 목록은 그 이벤트로 정한다(broadcast.start·end가 상태를 바꾼 것 — 방송 목록 표와 같은 규칙). 긴 트랜잭션을 잡지 않아 판매(쓰기)를 막지 않는다.
// - 복구·가져오기(운영자 명령, D-I2-11): 먼저 검사(형식·요약값·이벤트 요약값·seq·범위 겹침·재생·판매 규칙 설정·포장 기록)하고 하나라도 어긋나면 아무것도 바꾸지 않는다.
//   기록이 있는 판매자는 바꾸기 옵션이 있을 때만 — 지금 기록의 안전 백업을 저장소에 쓴 뒤 한 트랜잭션에 바꾼다. 상태 스냅샷·발송함은 재생으로 다시 만들고,
//   다시 만든 발송함 행은 모두 restored = true(실행하지 않음). 끝나면 재생 무결성 검사를 돌린다.
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { STATE_FORMAT, applyEvent, checkInvariants, checkSettings, isValidDate, type EngineEffect, type EngineEvent, type EngineState } from '@livejjim/core'
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm'
import { canonicalJson, checkReplay, type ScopeCheck } from './check-replay.ts'
import type { Db } from './db/database.ts'
import { accounts, broadcasts, events, outbox, packingRecords, scopeLockKey, scopes, sellers, snapshots } from './db/schema.ts'
import type { IdSource } from './ids.ts'
import { errorKind, type LogSink } from './log.ts'
import { PACKING_KINDS, PRODUCT_KEY_RE, type PackingKind } from './packing.ts'
import { FAILED_INPUT_MESSAGE, emptyState, type AttentionItem } from './runtime.ts'
import { sha256Hex } from './secrets.ts'
import { readShop, shopJson, type ShopView } from './shop.ts'
import { iso, kstDate, type Clock } from './time.ts'
import { eventDigest } from './writer.ts'

export const BACKUP_FORMAT = 'livejjim-seller-backup'
export const BACKUP_VERSION = 1
/** 보관 기간 (D-I2-10): 만든 지 30×24시간이 지난 파일은 지운다 — 판매자마다 가장 최근 파일 하나는 늘 남긴다 */
export const BACKUP_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
export const BACKUP_RETENTION_DAYS = 30
/** 자동 백업 시각: 그날(KST) 04:00이 지난 확인 */
export const BACKUP_HOUR_KST = 4
/** 확인 주기 (기본 5분) */
export const BACKUP_CHECK_INTERVAL_MS = 5 * 60 * 1000
export const BACKUP_DISABLED_MESSAGE = '백업 저장소가 정해지지 않아 자동 백업이 꺼져 있어요.'

export type BackupActor = 'account' | 'server' | 'collector'
const ACTORS: readonly string[] = ['account', 'server', 'collector']

export interface BackupEvent {
  readonly seq: number
  readonly type: string
  /** 엔진 이벤트 그대로의 JSON 문자열 (type·seq·at 포함) */
  readonly body: string
  readonly at: number
  /** 서버 도착 시각 (UTC ISO) */
  readonly receivedAt: string
  readonly actor: BackupActor
  readonly accountId: string | null
  readonly requestId: string | null
  readonly failed: boolean
  /** 이벤트 요약값 = SHA-256(JSON [날짜, 리허설인지, seq, 종류, 본문, 실패 표시]) */
  readonly digest: string
}

export interface BackupBroadcast {
  readonly id: string
  readonly date: string
  readonly title: string
  readonly startSeq: number
  /** 끝낸 시각 (UTC ISO, 끝나지 않았으면 null) */
  readonly endedAt: string | null
  /** 만든 시각 = 방송 시작 이벤트의 도착 시각 (UTC ISO) */
  readonly createdAt: string
}

export interface BackupScope {
  readonly date: string
  readonly rehearsal: boolean
  readonly seq: number
  readonly broadcasts: readonly BackupBroadcast[]
  readonly events: readonly BackupEvent[]
}

export interface BackupPacking {
  readonly date: string
  readonly buyer: string
  readonly kind: PackingKind
  readonly items: readonly string[] | null
  readonly invoice: string | null
  readonly accountId: string | null
  readonly requestId: string | null
  readonly createdAt: string
}

export interface BackupFile {
  readonly format: typeof BACKUP_FORMAT
  readonly version: typeof BACKUP_VERSION
  readonly createdAt: string
  readonly sellerId: string
  readonly shop: ShopView
  /** 판매 규칙 설정 덮어쓰기 (빠진 키는 DOMAIN_RULES 기본값) */
  readonly settings: Readonly<Record<string, unknown>>
  readonly scopes: readonly BackupScope[]
  readonly packing: readonly BackupPacking[]
  /** 내용 요약값 = SHA-256(만든 시각·요약값을 뺀 내용의 정규 JSON) */
  readonly digest: string
}

export function backupEventDigest(date: string, rehearsal: boolean, seq: number, type: string, body: string, failed: boolean): string {
  return sha256Hex(JSON.stringify([date, rehearsal, seq, type, body, failed]))
}

/** 내용 요약값 (만든 시각·요약값 칸을 뺀 내용, 키 순서와 상관없는 정규 JSON) */
export function backupDigest(file: Omit<BackupFile, 'digest' | 'createdAt'> & { readonly createdAt?: unknown; readonly digest?: unknown }): string {
  const { format, version, sellerId, shop, settings, scopes: scopeList, packing } = file
  return sha256Hex(canonicalJson({ format, version, sellerId, shop, settings, scopes: scopeList, packing }))
}

// ── 만들기 ───────────────────────────────────────────────────────────────

const toIso = (value: Date): string => value.toISOString()

/** 판매자 전체 기록 → 백업 파일 내용 (D-I2-10·12). 범위마다 범위 행의 seq까지 */
export async function buildBackup(db: Db, sellerId: string, now: number): Promise<BackupFile> {
  const sellerRows = await db.select({ settings: sellers.settings }).from(sellers).where(eq(sellers.id, sellerId)).limit(1)
  const sellerRow = sellerRows[0]
  if (sellerRow === undefined) throw new Error('판매자가 없다')
  const shop = await readShop(db, sellerId)
  let settings: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(sellerRow.settings)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) settings = parsed as Record<string, unknown>
  } catch {
    settings = {}
  }
  const scopeRows = await db
    .select({ id: scopes.id, date: scopes.date, rehearsal: scopes.rehearsal, seq: scopes.seq })
    .from(scopes)
    .where(eq(scopes.sellerId, sellerId))
    .orderBy(asc(scopes.date), asc(scopes.rehearsal))
  const scopeList: BackupScope[] = []
  for (const scope of scopeRows) {
    const rows = await db
      .select({
        seq: events.seq,
        type: events.type,
        body: events.body,
        at: events.at,
        receivedAt: events.receivedAt,
        actor: events.actor,
        accountId: events.accountId,
        requestId: events.requestId,
        changed: events.changed,
        failed: events.failed,
      })
      .from(events)
      .where(and(eq(events.sellerId, sellerId), eq(events.scopeId, scope.id), lte(events.seq, scope.seq)))
      .orderBy(asc(events.seq))
    const broadcastList: BackupBroadcast[] = []
    const list: BackupEvent[] = rows.map((row) => {
      if (!row.failed && row.changed && (row.type === 'broadcast.start' || row.type === 'broadcast.end')) {
        const event = JSON.parse(row.body) as { b: string; date?: string; title?: string; at: number }
        if (row.type === 'broadcast.start') {
          broadcastList.push({ id: event.b, date: event.date ?? scope.date, title: event.title ?? '', startSeq: row.seq, endedAt: null, createdAt: toIso(row.receivedAt) })
        } else {
          const index = broadcastList.findIndex((broadcast) => broadcast.id === event.b)
          if (index >= 0) broadcastList[index] = { ...(broadcastList[index] as BackupBroadcast), endedAt: iso(event.at) }
        }
      }
      return {
        seq: row.seq,
        type: row.type,
        body: row.body,
        at: row.at,
        receivedAt: toIso(row.receivedAt),
        actor: (ACTORS.includes(row.actor) ? row.actor : 'server') as BackupActor,
        accountId: row.accountId,
        requestId: row.requestId,
        failed: row.failed,
        digest: backupEventDigest(scope.date, scope.rehearsal, row.seq, row.type, row.body, row.failed),
      }
    })
    scopeList.push({ date: scope.date, rehearsal: scope.rehearsal, seq: list.at(-1)?.seq ?? 0, broadcasts: broadcastList, events: list })
  }
  const packingRows = await db
    .select({
      date: packingRecords.date,
      buyer: packingRecords.buyer,
      kind: packingRecords.kind,
      items: packingRecords.items,
      invoice: packingRecords.invoice,
      accountId: packingRecords.accountId,
      requestId: packingRecords.requestId,
      createdAt: packingRecords.createdAt,
    })
    .from(packingRecords)
    .where(eq(packingRecords.sellerId, sellerId))
    .orderBy(asc(packingRecords.id))
  const packing: BackupPacking[] = packingRows.map((row) => ({
    date: row.date,
    buyer: row.buyer,
    kind: row.kind as PackingKind,
    items: row.items === null ? null : (JSON.parse(row.items) as string[]),
    invoice: row.invoice,
    accountId: row.accountId,
    requestId: row.requestId,
    createdAt: toIso(row.createdAt),
  }))
  const content = { format: BACKUP_FORMAT, version: BACKUP_VERSION, sellerId, shop, settings, scopes: scopeList, packing } as const
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: iso(now), sellerId, shop, settings, scopes: scopeList, packing, digest: backupDigest(content) }
}

export function encodeBackup(file: BackupFile): Uint8Array {
  return new Uint8Array(gzipSync(Buffer.from(JSON.stringify(file), 'utf8')))
}

// ── 읽기·검사 ────────────────────────────────────────────────────────────

/** 검사를 통과한 범위의 재생 결과 (복구가 그대로 쓴다) */
export interface ReplayedScope {
  readonly scope: BackupScope
  /** 이벤트마다 상태를 바꿨는지 (실패 표시는 false) */
  readonly changed: readonly boolean[]
  readonly effects: readonly { readonly seq: number; readonly effect: EngineEffect }[]
  readonly state: EngineState
  readonly attention: readonly AttentionItem[]
}

export interface CheckedBackup {
  readonly file: BackupFile
  readonly scopes: readonly ReplayedScope[]
}

type Checked<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string }
const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason })

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isInt = (value: unknown, min = 0): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min
const isIso = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value))
const isStringOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string'
const hasKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const own = Object.keys(value)
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}
const SHOP_KEYS = ['name', 'bank', 'accountNumber', 'accountHolder', 'accountNote'] as const

function checkShop(value: unknown): value is ShopView {
  if (!isObject(value) || !hasKeys(value, SHOP_KEYS)) return false
  return SHOP_KEYS.every((key) => {
    const text = value[key]
    if (typeof text !== 'string') return false
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      if (code <= 0x1f || code === 0x7f) return false
    }
    return key !== 'name' || text.trim() !== ''
  })
}

const EVENT_KEYS = ['seq', 'type', 'body', 'at', 'receivedAt', 'actor', 'accountId', 'requestId', 'failed', 'digest'] as const
const BROADCAST_KEYS = ['id', 'date', 'title', 'startSeq', 'endedAt', 'createdAt'] as const
const SCOPE_KEYS = ['date', 'rehearsal', 'seq', 'broadcasts', 'events'] as const
const PACKING_KEYS = ['date', 'buyer', 'kind', 'items', 'invoice', 'accountId', 'requestId', 'createdAt'] as const
const FILE_KEYS = ['format', 'version', 'createdAt', 'sellerId', 'shop', 'settings', 'scopes', 'packing', 'digest'] as const

const scopeName = (date: string, rehearsal: boolean): string => `${date}${rehearsal ? ' 리허설' : ''}`

/** 한 범위를 처음부터 재생 (실패 표시는 건너뛴다). 입력 오류·형식 오류·본문과 칸이 다르면 실패 */
function replayScope(scope: BackupScope): Checked<ReplayedScope> {
  let state = emptyState()
  const changed: boolean[] = []
  const effects: { seq: number; effect: EngineEffect }[] = []
  const attention: AttentionItem[] = []
  const derived: BackupBroadcast[] = []
  const where = scopeName(scope.date, scope.rehearsal)
  for (const event of scope.events) {
    if (event.failed) {
      attention.push({ seq: event.seq, message: FAILED_INPUT_MESSAGE })
      changed.push(false)
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(event.body)
    } catch {
      return fail(`범위 ${where}의 seq ${String(event.seq)} 이벤트 본문을 읽지 못했어요.`)
    }
    if (!isObject(parsed) || parsed.type !== event.type || parsed.seq !== event.seq || parsed.at !== event.at) {
      return fail(`범위 ${where}의 seq ${String(event.seq)} 이벤트 본문이 기록 칸과 맞지 않아요.`)
    }
    try {
      const result = applyEvent(state, parsed as unknown as EngineEvent)
      changed.push(result.state !== state)
      if (result.state !== state && (event.type === 'broadcast.start' || event.type === 'broadcast.end')) {
        const b = String(parsed.b)
        if (event.type === 'broadcast.start') {
          derived.push({ id: b, date: String(parsed.date), title: String(parsed.title), startSeq: event.seq, endedAt: null, createdAt: event.receivedAt })
        } else {
          const index = derived.findIndex((broadcast) => broadcast.id === b)
          if (index >= 0) derived[index] = { ...(derived[index] as BackupBroadcast), endedAt: iso(event.at) }
        }
      }
      state = result.state
      for (const effect of result.effects) effects.push({ seq: event.seq, effect })
    } catch {
      return fail(`범위 ${where}의 seq ${String(event.seq)}에서 다시 계산하지 못했어요.`)
    }
  }
  if (checkInvariants(state).length > 0) return fail(`범위 ${where}의 마지막 상태가 불변식 검사를 통과하지 못했어요.`)
  if (canonicalJson(derived) !== canonicalJson(scope.broadcasts)) return fail(`범위 ${where}의 방송 목록이 이벤트와 맞지 않아요.`)
  return { ok: true, value: { scope, changed, effects, state, attention } }
}

/** 포장 기록의 형식과 차례 (구매자 ID마다: 포장 완료 ← 대기·포장됨, 포장 취소 ← 포장됨, 배송 완료 ← 포장됨·배송됨, 배송 취소 ← 배송됨) */
function checkPacking(list: unknown, realDates: ReadonlySet<string>): Checked<BackupPacking[]> {
  if (!Array.isArray(list)) return fail('포장 기록이 목록이 아니에요.')
  const phases = new Map<string, 'WAITING' | 'PACKED' | 'SHIPPED'>()
  const requests = new Set<string>()
  const out: BackupPacking[] = []
  for (const [index, raw] of (list as unknown[]).entries()) {
    const where = `포장 기록 ${String(index + 1)}번`
    if (!isObject(raw) || !hasKeys(raw, PACKING_KEYS)) return fail(`${where}의 형식이 올바르지 않아요.`)
    const { date, buyer, kind, items, invoice, accountId, requestId, createdAt } = raw
    if (typeof date !== 'string' || !realDates.has(date)) return fail(`${where}의 날짜가 실제 범위가 아니에요.`)
    if (typeof buyer !== 'string' || buyer === '' || buyer.length > 256) return fail(`${where}의 구매자가 올바르지 않아요.`)
    if (typeof kind !== 'string' || !(PACKING_KINDS as readonly string[]).includes(kind)) return fail(`${where}의 종류가 올바르지 않아요.`)
    if (!isStringOrNull(accountId) || !isStringOrNull(requestId) || !isIso(createdAt)) return fail(`${where}의 형식이 올바르지 않아요.`)
    if (requestId !== null) {
      if (requests.has(requestId)) return fail(`${where}의 요청 번호가 겹쳐요.`)
      requests.add(requestId)
    }
    if (kind === 'PACKED') {
      if (!Array.isArray(items) || items.length === 0 || !items.every((key) => typeof key === 'string' && PRODUCT_KEY_RE.test(key)) || new Set(items).size !== items.length) {
        return fail(`${where}의 담은 품목이 올바르지 않아요.`)
      }
    } else if (items !== null) return fail(`${where}의 담은 품목이 올바르지 않아요.`)
    if (kind === 'SHIPPED') {
      if (invoice !== null && (typeof invoice !== 'string' || !/^[0-9]{8,20}$/.test(invoice))) return fail(`${where}의 송장번호가 올바르지 않아요.`)
    } else if (invoice !== null) return fail(`${where}의 송장번호가 올바르지 않아요.`)
    const key = JSON.stringify([date, buyer])
    const phase = phases.get(key) ?? 'WAITING'
    const allowed =
      (kind === 'PACKED' && phase !== 'SHIPPED') || (kind === 'UNPACKED' && phase === 'PACKED') || (kind === 'SHIPPED' && phase !== 'WAITING') || (kind === 'UNSHIPPED' && phase === 'SHIPPED')
    if (!allowed) return fail(`${where}의 차례가 맞지 않아요.`)
    phases.set(key, kind === 'PACKED' || kind === 'UNSHIPPED' ? 'PACKED' : kind === 'UNPACKED' ? 'WAITING' : 'SHIPPED')
    out.push({ date, buyer, kind: kind as PackingKind, items: kind === 'PACKED' ? [...(items as string[])] : null, invoice: invoice as string | null, accountId, requestId, createdAt })
  }
  return { ok: true, value: out }
}

function checkEventRow(raw: unknown, date: string, rehearsal: boolean, expectedSeq: number): Checked<BackupEvent> {
  const where = `범위 ${scopeName(date, rehearsal)}의 ${String(expectedSeq)}번째 이벤트`
  if (!isObject(raw) || !hasKeys(raw, EVENT_KEYS)) return fail(`${where}의 형식이 올바르지 않아요.`)
  const { seq, type, body, at, receivedAt, actor, accountId, requestId, failed, digest } = raw
  if (!isInt(seq, 1)) return fail(`${where}의 seq가 올바르지 않아요.`)
  if (seq !== expectedSeq) return fail(`범위 ${scopeName(date, rehearsal)}의 seq가 1부터 빈틈없이 이어지지 않아요(${String(expectedSeq)}번째).`)
  if (typeof type !== 'string' || typeof body !== 'string' || !isInt(at) || !isIso(receivedAt) || typeof failed !== 'boolean' || typeof digest !== 'string') {
    return fail(`${where}의 형식이 올바르지 않아요.`)
  }
  if (typeof actor !== 'string' || !ACTORS.includes(actor) || !isStringOrNull(accountId) || !isStringOrNull(requestId)) return fail(`${where}의 형식이 올바르지 않아요.`)
  if (backupEventDigest(date, rehearsal, seq, type, body, failed) !== digest) return fail(`범위 ${scopeName(date, rehearsal)}의 seq ${String(seq)} 이벤트 요약값이 맞지 않아요(기록이 바뀌었어요).`)
  return { ok: true, value: { seq, type, body, at, receivedAt, actor: actor as BackupActor, accountId, requestId, failed, digest } }
}

function checkBroadcastRow(raw: unknown): BackupBroadcast | null {
  if (!isObject(raw) || !hasKeys(raw, BROADCAST_KEYS)) return null
  const { id, date, title, startSeq, endedAt, createdAt } = raw
  if (typeof id !== 'string' || typeof date !== 'string' || typeof title !== 'string' || !isInt(startSeq, 1) || !(endedAt === null || isIso(endedAt)) || !isIso(createdAt)) return null
  return { id, date, title, startSeq, endedAt, createdAt }
}

/**
 * 백업·내보내기 파일 바이트 → 검사를 통과한 내용과 범위마다의 재생 결과 (AC-I2-62 검사 목록).
 * 하나라도 어긋나면 까닭(쉬운 문장 — 기록 내용·개인정보 없음)
 */
export function checkBackupBytes(bytes: Uint8Array): Checked<CheckedBackup> {
  let text: string
  try {
    text = gunzipSync(bytes).toString('utf8')
  } catch {
    return fail('백업 파일을 풀지 못했어요(gzip 파일이 아니거나 손상됐어요).')
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return fail('백업 파일의 내용을 읽지 못했어요(JSON이 아니에요).')
  }
  if (!isObject(raw) || raw.format !== BACKUP_FORMAT) return fail('라이브찜 백업 파일이 아니에요(형식 이름이 달라요).')
  if (raw.version !== BACKUP_VERSION) return fail(`이 서버가 읽을 수 없는 형식 번호예요(${String(BACKUP_VERSION)}만 읽어요).`)
  if (!hasKeys(raw, FILE_KEYS)) return fail('백업 파일의 칸이 형식과 달라요.')
  const { createdAt, sellerId, shop, settings, scopes: scopeList, packing, digest } = raw
  if (!isIso(createdAt) || typeof sellerId !== 'string' || typeof digest !== 'string') return fail('백업 파일의 칸이 형식과 달라요.')
  if (!checkShop(shop)) return fail('가게 설정의 형식이 올바르지 않아요.')
  if (!isObject(settings)) return fail('판매 규칙 설정의 형식이 올바르지 않아요.')
  if (!Array.isArray(scopeList)) return fail('범위 목록의 형식이 올바르지 않아요.')
  if (backupDigest({ format: BACKUP_FORMAT, version: BACKUP_VERSION, sellerId, shop, settings, scopes: scopeList as BackupScope[], packing: packing as BackupPacking[] }) !== digest) {
    return fail('파일 요약값이 맞지 않아요(파일이 손상됐거나 바뀌었어요).')
  }
  if (checkSettings(settings).length > 0 || settings['settlement.groupBy'] === 'MANUAL') return fail('판매 규칙 설정이 검사를 통과하지 못했어요.')
  const seen = new Set<string>()
  const replayed: ReplayedScope[] = []
  for (const rawScope of scopeList as unknown[]) {
    if (!isObject(rawScope) || !hasKeys(rawScope, SCOPE_KEYS)) return fail('범위의 형식이 올바르지 않아요.')
    const { date, rehearsal, seq, broadcasts: rawBroadcasts, events: rawEvents } = rawScope
    if (!isValidDate(date) || typeof rehearsal !== 'boolean' || !isInt(seq) || !Array.isArray(rawBroadcasts) || !Array.isArray(rawEvents)) return fail('범위의 형식이 올바르지 않아요.')
    const key = JSON.stringify([date, rehearsal])
    if (seen.has(key)) return fail(`범위 ${scopeName(date as string, rehearsal)}가 두 번 있어요.`)
    seen.add(key)
    const eventList: BackupEvent[] = []
    for (const [index, rawEvent] of (rawEvents as unknown[]).entries()) {
      const checked = checkEventRow(rawEvent, date as string, rehearsal, index + 1)
      if (!checked.ok) return checked
      eventList.push(checked.value)
    }
    if (eventList.length === 0 || seq !== eventList.length) return fail(`범위 ${scopeName(date as string, rehearsal)}의 seq가 이벤트 기록과 맞지 않아요.`)
    const broadcastList: BackupBroadcast[] = []
    for (const rawBroadcast of rawBroadcasts as unknown[]) {
      const checked = checkBroadcastRow(rawBroadcast)
      if (checked === null) return fail(`범위 ${scopeName(date as string, rehearsal)}의 방송 목록 형식이 올바르지 않아요.`)
      broadcastList.push(checked)
    }
    const result = replayScope({ date: date as string, rehearsal, seq, broadcasts: broadcastList, events: eventList })
    if (!result.ok) return result
    replayed.push(result.value)
  }
  const realDates = new Set(replayed.filter((item) => !item.scope.rehearsal).map((item) => item.scope.date))
  const packingChecked = checkPacking(packing, realDates)
  if (!packingChecked.ok) return packingChecked
  const file: BackupFile = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt,
    sellerId,
    shop,
    settings,
    scopes: replayed.map((item) => item.scope),
    packing: packingChecked.value,
    digest,
  }
  return { ok: true, value: { file, scopes: replayed } }
}

// ── 저장소 (어댑터) ──────────────────────────────────────────────────────

export type BackupKind = 'daily' | 'safety'

export interface BackupEntry {
  readonly name: string
  readonly kind: BackupKind
  /** 만든 시각 (UTC 밀리초 — 파일 이름에서 읽는다) */
  readonly createdAt: number
  readonly size: number
}

/** 백업 저장소 (D-I2-10 — 이번에는 폴더 저장소, 다른 저장소는 배포 I3). 판매자 파일은 판매자마다 따로다 */
export interface BackupStorage {
  list(sellerId: string): Promise<BackupEntry[]>
  write(sellerId: string, kind: BackupKind, createdAt: number, bytes: Uint8Array): Promise<BackupEntry>
  read(sellerId: string, name: string): Promise<Uint8Array>
  remove(sellerId: string, name: string): Promise<void>
}

const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/
const FILE_RE = /^(daily|safety)-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z(?:-(\d{1,3}))?\.json\.gz$/

/** 파일 이름 = <종류>-<만든 시각 UTC>.json.gz (판매자 이름·구매자 정보 없음) */
export function backupFileName(kind: BackupKind, createdAt: number, suffix = 0): string {
  const stamp = new Date(createdAt).toISOString().replace(/[-:.]/g, '')
  return `${kind}-${stamp}${suffix === 0 ? '' : `-${String(suffix)}`}.json.gz`
}

export function parseBackupFileName(name: string): { kind: BackupKind; createdAt: number } | null {
  const match = FILE_RE.exec(name)
  if (match === null) return null
  const [, kind, y, mo, d, h, mi, s, ms] = match as unknown as [string, BackupKind, string, string, string, string, string, string, string]
  const createdAt = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), Number(ms))
  return Number.isNaN(createdAt) ? null : { kind, createdAt }
}

/** 폴더 저장소: <폴더>/<판매자 ID>/<종류>-<UTC>.json.gz. 임시 이름에 쓴 뒤 바꿔 반쯤 쓴 파일이 남지 않게 한다 */
export class FolderBackupStorage implements BackupStorage {
  readonly root: string

  constructor(root: string) {
    this.root = root
  }

  #dir(sellerId: string): string {
    if (!SAFE_SEGMENT.test(sellerId)) throw new Error('판매자 ID 형식이 올바르지 않다')
    return join(this.root, sellerId)
  }

  async list(sellerId: string): Promise<BackupEntry[]> {
    const dir = this.#dir(sellerId)
    let names: string[]
    try {
      names = await readdir(dir)
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return []
      throw error
    }
    const out: BackupEntry[] = []
    for (const name of names) {
      const parsed = parseBackupFileName(name)
      if (parsed === null) continue
      const info = await stat(join(dir, name))
      out.push({ name, kind: parsed.kind, createdAt: parsed.createdAt, size: info.size })
    }
    return out.sort((a, b) => b.createdAt - a.createdAt || (a.name < b.name ? 1 : -1))
  }

  async write(sellerId: string, kind: BackupKind, createdAt: number, bytes: Uint8Array): Promise<BackupEntry> {
    const dir = this.#dir(sellerId)
    await mkdir(dir, { recursive: true })
    const existing = new Set((await this.list(sellerId)).map((entry) => entry.name))
    let suffix = 0
    while (existing.has(backupFileName(kind, createdAt, suffix))) suffix++
    const name = backupFileName(kind, createdAt, suffix)
    const temp = join(dir, `.${name}.tmp`)
    await writeFile(temp, bytes)
    await rename(temp, join(dir, name))
    return { name, kind, createdAt, size: bytes.byteLength }
  }

  async read(sellerId: string, name: string): Promise<Uint8Array> {
    if (parseBackupFileName(name) === null) throw new Error('백업 파일 이름이 아니다')
    return new Uint8Array(await readFile(join(this.#dir(sellerId), name)))
  }

  async remove(sellerId: string, name: string): Promise<void> {
    if (parseBackupFileName(name) === null) throw new Error('백업 파일 이름이 아니다')
    await rm(join(this.#dir(sellerId), name), { force: true })
  }
}

// ── 매일 자동 백업 (AC-I2-61) ─────────────────────────────────────────────

/** 그 시각의 KST 날짜 04:00 (UTC 밀리초) */
export function backupThreshold(now: number): number {
  const [y, m, d] = kstDate(now).split('-').map(Number) as [number, number, number]
  return Date.UTC(y, m - 1, d, BACKUP_HOUR_KST - 9, 0, 0, 0)
}

export interface BackupStatus {
  readonly enabled: boolean
  readonly retentionDays: number
  /** 마지막 자동 백업 시각 (UTC ISO, 없으면 null) */
  readonly lastSuccessAt: string | null
  /** 보관 중인 백업 (최근 것부터) */
  readonly backups: readonly { readonly createdAt: string; readonly size: number }[]
}

export interface BackupSchedulerOptions {
  readonly db: Db
  readonly storage: BackupStorage | null
  readonly clock: Clock
  readonly log: LogSink
  readonly intervalMs?: number
}

export class BackupScheduler {
  readonly #options: BackupSchedulerOptions
  #timer: ReturnType<typeof setInterval> | null = null
  #running: Promise<unknown> | null = null

  constructor(options: BackupSchedulerOptions) {
    this.#options = options
  }

  get enabled(): boolean {
    return this.#options.storage !== null
  }

  get storage(): BackupStorage | null {
    return this.#options.storage
  }

  /** 켤 때 한 번, 그 뒤 주기마다 확인한다. 저장소가 없으면 시작 경보만 남긴다(판매는 그대로) */
  start(): void {
    if (this.#options.storage === null) {
      this.#options.log({ level: 'warn', code: 'BACKUP_DISABLED' })
      return
    }
    if (this.#timer !== null) return
    void this.check()
    this.#timer = setInterval(() => void this.check(), this.#options.intervalMs ?? BACKUP_CHECK_INTERVAL_MS)
    this.#timer.unref?.()
  }

  stop(): void {
    if (this.#timer !== null) clearInterval(this.#timer)
    this.#timer = null
  }

  /**
   * 확인 한 번: 판매자마다 그날(KST) 04:00이 지났는데 그날 자동 백업이 없으면 하나 만들고, 30일이 지난 파일을 지운다(가장 최근 하나는 남긴다).
   * 한 판매자가 실패해도 다른 판매자는 계속한다(경보 — 판매자 ID·까닭 종류만). 겹쳐 부르면 앞 확인이 끝난 뒤 돈다
   */
  async check(): Promise<{ readonly created: readonly string[]; readonly failed: readonly string[] }> {
    const previous = this.#running ?? Promise.resolve()
    const run = previous.then(() => this.#check())
    this.#running = run.catch(() => undefined)
    return run
  }

  async #check(): Promise<{ created: string[]; failed: string[] }> {
    const storage = this.#options.storage
    const created: string[] = []
    const failed: string[] = []
    if (storage === null) return { created, failed }
    const now = this.#options.clock.now()
    const threshold = backupThreshold(now)
    const sellerIds = (await this.#options.db.select({ id: sellers.id }).from(sellers).orderBy(asc(sellers.id))).map((row) => row.id)
    for (const sellerId of sellerIds) {
      try {
        const entries = await storage.list(sellerId)
        if (now >= threshold && !entries.some((entry) => entry.kind === 'daily' && entry.createdAt >= threshold)) {
          await this.createNow(sellerId, 'daily')
          created.push(sellerId)
        }
      } catch (error) {
        failed.push(sellerId)
        this.#options.log({ level: 'error', code: 'BACKUP_FAILED', seller: sellerId, errorKind: errorKind(error) })
        continue
      }
      try {
        await this.prune(sellerId, now)
      } catch (error) {
        this.#options.log({ level: 'warn', code: 'BACKUP_PRUNE_FAILED', seller: sellerId, errorKind: errorKind(error) })
      }
    }
    return { created, failed }
  }

  /** 지금 백업 하나를 만들어 저장소에 쓴다 (자동 백업·복구 전 안전 백업·E2E 기동) */
  async createNow(sellerId: string, kind: BackupKind): Promise<BackupEntry> {
    const storage = this.#options.storage
    if (storage === null) throw new Error('백업 저장소가 없다')
    const now = this.#options.clock.now()
    const file = await buildBackup(this.#options.db, sellerId, now)
    return storage.write(sellerId, kind, now, encodeBackup(file))
  }

  /** 보관: 만든 지 30×24시간이 지난 파일을 지우되 가장 최근 파일 하나는 늘 남긴다 */
  async prune(sellerId: string, now = this.#options.clock.now()): Promise<number> {
    const storage = this.#options.storage
    if (storage === null) return 0
    const entries = await storage.list(sellerId)
    let removed = 0
    for (const [index, entry] of entries.entries()) {
      if (index === 0) continue // 가장 최근 하나
      if (now - entry.createdAt > BACKUP_RETENTION_MS) {
        await storage.remove(sellerId, entry.name)
        removed++
      }
    }
    return removed
  }

  /** 판매자의 백업 상태 (그 판매자 것만) */
  async status(sellerId: string): Promise<BackupStatus> {
    const storage = this.#options.storage
    if (storage === null) return { enabled: false, retentionDays: BACKUP_RETENTION_DAYS, lastSuccessAt: null, backups: [] }
    const entries = await storage.list(sellerId)
    const lastDaily = entries.find((entry) => entry.kind === 'daily')
    return {
      enabled: true,
      retentionDays: BACKUP_RETENTION_DAYS,
      lastSuccessAt: lastDaily === undefined ? null : iso(lastDaily.createdAt),
      backups: entries.map((entry) => ({ createdAt: iso(entry.createdAt), size: entry.size })),
    }
  }
}

// ── 복구·가져오기 (AC-I2-62) ─────────────────────────────────────────────

export const RESTORE_MESSAGES = {
  noSeller: '판매자를 찾지 못했어요. 판매자 ID를 확인해 주세요.',
  needReplace: '기록이 있는 판매자예요. 바꾸려면 --replace를 붙여 주세요(지금 기록은 먼저 백업해요).',
  noStorage: '백업 저장소가 정해지지 않아 안전 백업을 만들 수 없어요. LIVEJJIM_BACKUP_DIR을 적어 주세요.',
  safetyFailed: '안전 백업을 만들지 못해 복구를 멈췄어요. 아무것도 바꾸지 않았어요.',
  failed: '복구 중 문제가 생겨 멈췄어요. 아무것도 바꾸지 않았어요.',
} as const

export interface RestoreOptions {
  readonly db: Db
  readonly sellerId: string
  readonly bytes: Uint8Array
  readonly replace: boolean
  /** 안전 백업을 쓸 저장소 (바꾸기에만 필요) */
  readonly storage: BackupStorage | null
  readonly clock: Clock
  readonly ids: Pick<IdSource, 'scope'>
  /** 시험용: 트랜잭션 안 마지막에 부른다(던지면 롤백) */
  readonly beforeCommit?: () => void | Promise<void>
}

export type RestoreOutcome =
  | {
      readonly ok: true
      readonly scopes: number
      readonly events: number
      readonly packing: number
      /** 바꾸기 전에 쓴 안전 백업 파일 이름 (기록이 없던 판매자면 null) */
      readonly safety: string | null
      readonly checks: readonly ScopeCheck[]
    }
  | { readonly ok: false; readonly reason: string }

const BATCH = 500

async function insertInBatches<T>(rows: readonly T[], insert: (batch: T[]) => Promise<unknown>): Promise<void> {
  for (let start = 0; start < rows.length; start += BATCH) await insert(rows.slice(start, start + BATCH))
}

/**
 * 복구·가져오기 (D-I2-11). 검사 → (바꾸기면 안전 백업) → 한 트랜잭션에 판매자의 범위·방송·이벤트·스냅샷·발송함·포장 기록·가게 설정·판매 규칙 설정을 파일의 것으로.
 * 판매자 ID·로그인 계정·세션·전화번호 키는 그대로 둔다. 끝나면 그 판매자에 재생 무결성 검사를 돌린다.
 * 부르는 쪽이 같은 프로세스의 범위 상태 캐시를 비워야 한다(ScopeWriter.forgetSeller — 운영 명령은 서버를 다시 켠다)
 */
export async function restoreSeller(options: RestoreOptions): Promise<RestoreOutcome> {
  const { db, sellerId } = options
  const checked = checkBackupBytes(options.bytes)
  if (!checked.ok) return checked
  const { file, scopes: replayed } = checked.value
  const sellerRows = await db.select({ id: sellers.id }).from(sellers).where(eq(sellers.id, sellerId)).limit(1)
  if (sellerRows.length === 0) return fail(RESTORE_MESSAGES.noSeller)
  const existing = await db.select({ date: scopes.date, rehearsal: scopes.rehearsal }).from(scopes).where(eq(scopes.sellerId, sellerId))
  if (existing.length > 0 && !options.replace) return fail(RESTORE_MESSAGES.needReplace)
  let safety: string | null = null
  if (existing.length > 0) {
    if (options.storage === null) return fail(RESTORE_MESSAGES.noStorage)
    try {
      const now = options.clock.now()
      safety = (await options.storage.write(sellerId, 'safety', now, encodeBackup(await buildBackup(db, sellerId, now)))).name
    } catch {
      return fail(RESTORE_MESSAGES.safetyFailed)
    }
  }
  const accountRows = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.sellerId, sellerId))
  const accountIds = new Set(accountRows.map((row) => row.id))
  const keepAccount = (id: string | null): string | null => (id !== null && accountIds.has(id) ? id : null)
  const now = new Date(options.clock.now())
  let eventCount = 0
  try {
    await db.transaction(async (tx) => {
      // 그 판매자의 범위(지금 것·파일의 것) 락을 모두 잡는다 — 같은 순서로 잡아 서로 기다리다 멈추지 않는다
      const lockKeys = [...new Set([...existing.map((row) => JSON.stringify([row.date, row.rehearsal])), ...file.scopes.map((scope) => JSON.stringify([scope.date, scope.rehearsal]))])].sort()
      for (const key of lockKeys) {
        const [date, rehearsal] = JSON.parse(key) as [string, boolean]
        await tx.execute(sql`select pg_advisory_xact_lock(${scopeLockKey(sellerId, date, rehearsal)})`)
      }
      const nowExisting = await tx.select({ id: scopes.id }).from(scopes).where(eq(scopes.sellerId, sellerId))
      if (nowExisting.length > 0 && !options.replace) throw new RestoreAbort(RESTORE_MESSAGES.needReplace)
      await tx.delete(packingRecords).where(eq(packingRecords.sellerId, sellerId))
      await tx.delete(outbox).where(eq(outbox.sellerId, sellerId))
      await tx.delete(snapshots).where(eq(snapshots.sellerId, sellerId))
      await tx.delete(events).where(eq(events.sellerId, sellerId))
      await tx.delete(broadcasts).where(eq(broadcasts.sellerId, sellerId))
      await tx.delete(scopes).where(eq(scopes.sellerId, sellerId))
      await tx
        .update(sellers)
        .set({ name: file.shop.name.trim(), shop: shopJson(file.shop), settings: JSON.stringify(file.settings) })
        .where(eq(sellers.id, sellerId))
      const scopeIds = new Map<string, string>()
      for (const item of replayed) {
        const { scope } = item
        const scopeId = options.ids.scope()
        scopeIds.set(JSON.stringify([scope.date, scope.rehearsal]), scopeId)
        await tx.insert(scopes).values({ id: scopeId, sellerId, date: scope.date, rehearsal: scope.rehearsal, seq: scope.seq, createdAt: new Date(scope.events[0]?.receivedAt ?? now) })
        await insertInBatches(scope.events, (batch) =>
          tx.insert(events).values(
            batch.map((event) => {
              const body = JSON.parse(event.body) as Record<string, unknown>
              const index = event.seq - 1
              return {
                sellerId,
                scopeId,
                seq: event.seq,
                type: event.type,
                body: event.body,
                at: event.at,
                receivedAt: new Date(event.receivedAt),
                actor: event.actor,
                accountId: keepAccount(event.accountId),
                requestId: event.requestId,
                chatBroadcast: event.type === 'chat' && typeof body.b === 'string' ? body.b : null,
                chatMessageId: event.type === 'chat' && typeof body.id === 'string' ? body.id : null,
                smsRef: event.type === 'sms' && typeof body.ref === 'string' ? body.ref : null,
                changed: item.changed[index] === true,
                failed: event.failed,
                digest: eventDigest(scopeId, event.seq, event.type, event.body, event.failed),
              }
            }),
          ),
        )
        eventCount += scope.events.length
        if (scope.broadcasts.length > 0) {
          await tx.insert(broadcasts).values(
            scope.broadcasts.map((broadcast) => ({
              id: broadcast.id,
              sellerId,
              scopeId,
              date: broadcast.date,
              title: broadcast.title,
              startSeq: broadcast.startSeq,
              endedAt: broadcast.endedAt === null ? null : new Date(broadcast.endedAt),
              createdAt: new Date(broadcast.createdAt),
            })),
          )
        }
        // 다시 만든 발송함: 실행하지 않음 표시 (D-I2-11 — 지난 라벨·감사 메시지를 다시 내지 않는다)
        await insertInBatches(item.effects, (batch) =>
          tx.insert(outbox).values(
            batch.map(({ seq, effect }) => ({
              sellerId,
              scopeId,
              effectId: effect.id,
              seq,
              kind: effect.kind,
              body: JSON.stringify(effect),
              rehearsal: scope.rehearsal,
              restored: true,
              createdAt: now,
            })),
          ),
        )
        await tx.insert(snapshots).values({
          sellerId,
          scopeId,
          seq: scope.seq,
          format: STATE_FORMAT,
          state: JSON.stringify(item.state),
          attention: JSON.stringify(item.attention),
          createdAt: now,
        })
      }
      await insertInBatches(file.packing, (batch) =>
        tx.insert(packingRecords).values(
          batch.map((record) => ({
            sellerId,
            scopeId: scopeIds.get(JSON.stringify([record.date, false])) as string,
            date: record.date,
            buyer: record.buyer,
            kind: record.kind,
            items: record.items === null ? null : JSON.stringify(record.items),
            invoice: record.invoice,
            accountId: keepAccount(record.accountId),
            requestId: record.requestId,
            createdAt: new Date(record.createdAt),
          })),
        ),
      )
      await options.beforeCommit?.()
    })
  } catch (error) {
    if (error instanceof RestoreAbort) return fail(error.message)
    return fail(RESTORE_MESSAGES.failed)
  }
  const checks = await checkReplay(db, { sellerId })
  return { ok: true, scopes: replayed.length, events: eventCount, packing: file.packing.length, safety, checks }
}

class RestoreAbort extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RestoreAbort'
  }
}

/** 발송함 실행 대상 (I1·Y1 실행기가 쓸 조회 — 리허설 행과 복구로 다시 만든 행은 빠진다, D-081·D-I2-11) */
export async function executableOutboxCount(db: Db, sellerId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(outbox)
    .where(and(eq(outbox.sellerId, sellerId), eq(outbox.rehearsal, false), eq(outbox.restored, false)))
  return rows[0]?.n ?? 0
}

/** 판매자의 범위 목록이 비었는지 (복구 명령의 안내용) */
export async function sellerScopeCount(db: Db, sellerIds: readonly string[]): Promise<number> {
  if (sellerIds.length === 0) return 0
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(scopes)
    .where(inArray(scopes.sellerId, [...sellerIds]))
  return rows[0]?.n ?? 0
}
