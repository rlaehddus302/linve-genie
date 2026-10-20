// 백업·복구·전체 내려받기 (DAT-03·DAT-04, I2 D-I2-10~D-I2-12, AC-I2-60~64).
// 파일 = gzip으로 압축한 JSON 하나 (형식 번호 2 — harness/sprints/I2/dev-notes.md "백업 파일 형식"):
//   형식 이름·번호, 만든 시각(UTC ISO), 판매자 ID, 가게 설정, 판매 규칙 설정, 모든 범위(실제·리허설)의 이벤트 기록 전부(seq 순)와 방송 목록,
//   포장·배송 기록 전부(기록 순), 내용 요약값(손상 확인).
// 넣지 않는다: 비밀번호 해시·로그인 아이디·세션·로그인 시도 기록·판매자 전화번호 키(암호문 포함)·마스터 키·상태 스냅샷·발송함.
// - 판매자의 전체 역사를 글 하나로 만들지 않는다(RA-I2-005 — V8 문자열 한도): 만들 때는 범위마다·이벤트 묶음마다 조각 글을 gzip 스트림에 이어 쓰고,
//   요약값은 조각마다 이어 계산한다. 읽을 때(검사·복구)도 gzip 스트림을 조각으로 풀어 이벤트 하나씩 읽는다(json-stream.ts).
//   그래서 파일 안 칸의 차례가 정해져 있다(형식 번호 2): 맨 위 format·version·createdAt·sellerId·shop·settings·scopes·packing·digest,
//   범위 안 date·rehearsal·events·seq·broadcasts. 이벤트·포장 기록·방송 하나의 칸 차례는 상관없다.
// - 채팅 본문·이름 (Y1 합친 뒤, AC-Y1-60): 서버는 채팅 이벤트의 본문(text)·이름(nick)을 chat_raw에 따로 둔다. 파일의 이벤트 본문은 Y1 전과 같은 모양 —
//   따로 둔 값을 다시 합친 엔진 이벤트 그대로다(형식 번호 2 그대로). 복구는 채팅을 다시 떼어 chat_raw에 넣고, 실제 범위의 채팅은 유튜브 채팅(봉인 대상),
//   리허설 범위의 채팅은 리허설 채팅으로 적는다(서버 수집 경로와 같은 규칙 — service.ts #recordChat).
// - 범위마다 한 시점의 일관된 기록: 범위 행의 seq를 먼저 읽고 그 seq까지의 이벤트만 담는다(이벤트는 덧붙이기만, seq는 이벤트와 같은 트랜잭션에서 고친다).
//   방송 목록은 그 이벤트로 정한다(broadcast.start·end가 상태를 바꾼 것 — 방송 목록 표와 같은 규칙). 긴 트랜잭션을 잡지 않아 판매(쓰기)를 막지 않는다.
//   이벤트는 묶음(BACKUP_PAGE)마다 DB에서 읽고, 묶음 사이에 이벤트 루프에 차례를 넘긴다 — 만드는 동안 판정이 멈추지 않는다(RA-I2-003).
// - 복구·가져오기(운영자 명령, D-I2-11): 먼저 파일 전체를 검사(형식·요약값·이벤트 요약값·seq·범위 겹침·재생·판매 규칙 설정·포장 기록)하고 하나라도 어긋나면 아무것도 바꾸지 않는다.
//   기록이 있는 판매자는 바꾸기 옵션이 있을 때만 — 지금 기록의 안전 백업을 저장소에 쓴 뒤 한 트랜잭션에 바꾼다(파일을 한 번 더 읽으며 넣는다). 상태 스냅샷·발송함은 재생으로 다시 만들고,
//   다시 만든 발송함 행은 모두 restored = true(실행하지 않음). 끝나면 재생 무결성 검사를 돌린다.
import { createHash, type Hash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip, createGzip } from 'node:zlib'
import { STATE_FORMAT, applyEvent, checkInvariants, checkSettings, isValidDate, type EngineEffect, type EngineEvent, type EngineState } from '@livejjim/core'
import { and, asc, eq, gt, inArray, lte, ne, sql } from 'drizzle-orm'
import { canonicalJson, checkReplay, type ScopeCheck } from './check-replay.ts'
import type { Db } from './db/database.ts'
import {
  accounts,
  broadcasts,
  chatRaw,
  events,
  executableOutbox,
  igConnections,
  igDmRows,
  igDmSends,
  igOauthStates,
  labelSwitches,
  labelTemplates,
  liveLinkMoves,
  liveLinks,
  liveRequests,
  liveUnlinked,
  loginLimits,
  outbox,
  packingRecords,
  receiptLinkRequests,
  receiptLinks,
  printAttempts,
  printJobs,
  printLabels,
  printQueues,
  printRequests,
  scopeLockKey,
  scopes,
  sellers,
  sessions,
  snapshots,
  youtubeCollectors,
  youtubeConnections,
  youtubeLinks,
  youtubeNotices,
  youtubeOauthStates,
  youtubeOwnMessages,
  youtubeQuota,
} from './db/schema.ts'
import type { IdSource } from './ids.ts'
import { JsonPullReader, JsonStreamError } from './json-stream.ts'
import { errorKind, type LogSink } from './log.ts'
import { PACKING_KINDS, packedItemValue, parsePackedItems, readPackedItem, type PackedItem, type PackedItemValue, type PackingKind } from './packing.ts'
import { FAILED_INPUT_MESSAGE, emptyState, type AttentionItem } from './runtime.ts'
import { sha256Hex } from './secrets.ts'
import { readShop, shopJson, type ShopView } from './shop.ts'
import { mergeRaw } from './store.ts'
import { iso, kstDate, type Clock } from './time.ts'
import { eventDigest, splitChatRaw } from './writer.ts'

export const BACKUP_FORMAT = 'livejjim-seller-backup'
/** 형식 번호 (2 = 칸 차례가 정해진 스트림 형식·이어 계산하는 요약값, RA-I2-005) */
export const BACKUP_VERSION = 2
/** 이벤트를 DB에서 한 번에 읽는 수 (묶음 사이에 이벤트 루프에 차례를 넘긴다) */
export const BACKUP_PAGE = 2000
/** 보관 기간 (D-I2-10): 만든 지 30×24시간이 지난 파일은 지운다 — 판매자마다 가장 최근 파일 하나는 늘 남긴다 */
export const BACKUP_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
export const BACKUP_RETENTION_DAYS = 30
/** 자동 백업 시각: 그날(KST) 04:00이 지난 확인 */
export const BACKUP_HOUR_KST = 4
/** 확인 주기 (기본 5분) */
export const BACKUP_CHECK_INTERVAL_MS = 5 * 60 * 1000
/** 서버를 켠 뒤 첫 확인까지 (기본 3분 — 켜자마자 판매 중인 서버에 백업 부하를 얹지 않는다, RA-I2-003) */
export const BACKUP_START_DELAY_MS = 3 * 60 * 1000
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
  readonly events: readonly BackupEvent[]
  readonly seq: number
  readonly broadcasts: readonly BackupBroadcast[]
}

export interface BackupPacking {
  readonly date: string
  readonly buyer: string
  readonly kind: PackingKind
  /** 포장 완료의 담은 품목 = (상품 ID, 상품 키) 쌍 { id, key } 목록 (D-I2-19 — 이 결정 전 파일은 상품 키 글) */
  readonly items: readonly PackedItemValue[] | null
  readonly invoice: string | null
  readonly accountId: string | null
  readonly requestId: string | null
  readonly createdAt: string
}

/** 파일 내용 (시험·작은 기록용 — 서버는 이 모양을 메모리에 통째로 만들지 않는다) */
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
  /** 내용 요약값 (BackupDigest) */
  readonly digest: string
}

export function backupEventDigest(date: string, rehearsal: boolean, seq: number, type: string, body: string, failed: boolean): string {
  return sha256Hex(JSON.stringify([date, rehearsal, seq, type, body, failed]))
}

/**
 * 내용 요약값 (형식 번호 2): 내용을 파일 차례대로 조각으로 나눠 조각마다 정규 JSON(키 정렬) + 줄바꿈을 이어 넣은 SHA-256.
 * 조각 = ["format", 형식 이름] · ["version", 2] · ["sellerId", …] · ["shop", …] · ["settings", …] ·
 *        범위마다 ["scope", 날짜, 리허설인지] · 이벤트마다 그 이벤트 · ["scopeEnd", seq, 방송 목록] · 포장 기록마다 ["packing", 기록] · ["end", 범위 수, 포장 기록 수].
 * 만든 시각과 요약값 칸은 넣지 않는다 — 같은 기록이면 만든 시각과 상관없이 같은 요약값이다. 만들기·검사가 같은 클래스를 쓴다
 */
export class BackupDigest {
  readonly #hash: Hash = createHash('sha256')
  #scopes = 0
  #packing = 0

  #feed(value: unknown): void {
    this.#hash.update(canonicalJson(value), 'utf8')
    this.#hash.update('\n', 'utf8')
  }

  header(value: { readonly format: unknown; readonly version: unknown; readonly sellerId: unknown; readonly shop: unknown; readonly settings: unknown }): void {
    this.#feed(['format', value.format])
    this.#feed(['version', value.version])
    this.#feed(['sellerId', value.sellerId])
    this.#feed(['shop', value.shop])
    this.#feed(['settings', value.settings])
  }

  scopeStart(date: unknown, rehearsal: unknown): void {
    this.#scopes++
    this.#feed(['scope', date, rehearsal])
  }

  event(event: unknown): void {
    this.#feed(event)
  }

  scopeEnd(seq: unknown, broadcastList: unknown): void {
    this.#feed(['scopeEnd', seq, broadcastList])
  }

  packing(record: unknown): void {
    this.#packing++
    this.#feed(['packing', record])
  }

  digest(): string {
    this.#feed(['end', this.#scopes, this.#packing])
    return this.#hash.digest('hex')
  }
}

/** 파일 내용 객체의 요약값 (시험이 고친 내용을 다시 요약할 때 — 만들기·검사와 같은 정의) */
export function backupDigest(file: { readonly format: unknown; readonly version: unknown; readonly sellerId: unknown; readonly shop: unknown; readonly settings: unknown; readonly scopes: readonly unknown[]; readonly packing: readonly unknown[] }): string {
  const digest = new BackupDigest()
  digest.header(file)
  for (const raw of file.scopes) {
    const scope = raw as Partial<BackupScope>
    digest.scopeStart(scope.date, scope.rehearsal)
    for (const event of scope.events ?? []) digest.event(event)
    digest.scopeEnd(scope.seq, scope.broadcasts)
  }
  for (const record of file.packing) digest.packing(record)
  return digest.digest()
}

// ── 만들기 ───────────────────────────────────────────────────────────────

const toIso = (value: Date): string => value.toISOString()
const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/** 파일 글 조각을 만드는 쓰개 (칸 차례 = 형식 번호 2). 요약값을 함께 이어 계산한다 */
class BackupWriter {
  readonly digest = new BackupDigest()
  #scopeCount = 0
  #eventCount = 0
  #packingCount = 0

  header(createdAt: string, sellerId: string, shop: ShopView, settings: Readonly<Record<string, unknown>>): string {
    this.digest.header({ format: BACKUP_FORMAT, version: BACKUP_VERSION, sellerId, shop, settings })
    return `{"format":${JSON.stringify(BACKUP_FORMAT)},"version":${String(BACKUP_VERSION)},"createdAt":${JSON.stringify(createdAt)},"sellerId":${JSON.stringify(sellerId)},"shop":${JSON.stringify(shop)},"settings":${JSON.stringify(settings)},"scopes":[`
  }

  scopeStart(date: string, rehearsal: boolean): string {
    this.digest.scopeStart(date, rehearsal)
    this.#eventCount = 0
    return `${this.#scopeCount++ === 0 ? '' : ','}{"date":${JSON.stringify(date)},"rehearsal":${String(rehearsal)},"events":[`
  }

  event(event: BackupEvent): string {
    const row = {
      seq: event.seq,
      type: event.type,
      body: event.body,
      at: event.at,
      receivedAt: event.receivedAt,
      actor: event.actor,
      accountId: event.accountId,
      requestId: event.requestId,
      failed: event.failed,
      digest: event.digest,
    }
    this.digest.event(row)
    return `${this.#eventCount++ === 0 ? '' : ','}${JSON.stringify(row)}`
  }

  scopeEnd(seq: number, broadcastList: readonly BackupBroadcast[]): string {
    const list = broadcastList.map((broadcast) => ({ id: broadcast.id, date: broadcast.date, title: broadcast.title, startSeq: broadcast.startSeq, endedAt: broadcast.endedAt, createdAt: broadcast.createdAt }))
    this.digest.scopeEnd(seq, list)
    return `],"seq":${String(seq)},"broadcasts":${JSON.stringify(list)}}`
  }

  packingStart(): string {
    return '],"packing":['
  }

  packing(record: BackupPacking): string {
    const row = { date: record.date, buyer: record.buyer, kind: record.kind, items: record.items, invoice: record.invoice, accountId: record.accountId, requestId: record.requestId, createdAt: record.createdAt }
    this.digest.packing(row)
    return `${this.#packingCount++ === 0 ? '' : ','}${JSON.stringify(row)}`
  }

  end(): string {
    return `],"digest":${JSON.stringify(this.digest.digest())}}`
  }
}

/** 판매자 전체 기록 → 파일 글 조각 (D-I2-10·12). 범위마다 범위 행의 seq까지, 이벤트는 BACKUP_PAGE개씩 읽는다. 기록이 없는 범위 행(seq 0)은 넣지 않는다 */
export async function* backupPieces(db: Db, sellerId: string, now: number): AsyncGenerator<string> {
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
  const writer = new BackupWriter()
  yield writer.header(iso(now), sellerId, shop, settings)
  const scopeRows = await db
    .select({ id: scopes.id, date: scopes.date, rehearsal: scopes.rehearsal, seq: scopes.seq })
    .from(scopes)
    .where(eq(scopes.sellerId, sellerId))
    .orderBy(asc(scopes.date), asc(scopes.rehearsal))
  for (const scope of scopeRows) {
    if (scope.seq === 0) continue
    yield writer.scopeStart(scope.date, scope.rehearsal)
    const broadcastList: BackupBroadcast[] = []
    let last = 0
    for (;;) {
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
          rawNick: chatRaw.nick,
          rawText: chatRaw.text,
        })
        .from(events)
        // 채팅의 따로 둔 본문·이름 (Y1, AC-Y1-60) — 파일에는 합친 본문을 쓴다
        .leftJoin(chatRaw, and(eq(chatRaw.scopeId, events.scopeId), eq(chatRaw.seq, events.seq), eq(chatRaw.sellerId, events.sellerId)))
        .where(and(eq(events.sellerId, sellerId), eq(events.scopeId, scope.id), gt(events.seq, last), lte(events.seq, scope.seq)))
        .orderBy(asc(events.seq))
        .limit(BACKUP_PAGE)
      const pieces: string[] = []
      for (const stored of rows) {
        const row = { ...stored, body: mergeRaw(stored.body, stored.rawNick, stored.rawText) }
        if (!row.failed && row.changed && (row.type === 'broadcast.start' || row.type === 'broadcast.end')) {
          const event = JSON.parse(row.body) as { b: string; date?: string; title?: string; at: number }
          if (row.type === 'broadcast.start') {
            broadcastList.push({ id: event.b, date: event.date ?? scope.date, title: event.title ?? '', startSeq: row.seq, endedAt: null, createdAt: toIso(row.receivedAt) })
          } else {
            const index = broadcastList.findIndex((broadcast) => broadcast.id === event.b)
            if (index >= 0) broadcastList[index] = { ...(broadcastList[index] as BackupBroadcast), endedAt: iso(event.at) }
          }
        }
        pieces.push(
          writer.event({
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
          }),
        )
      }
      if (pieces.length > 0) yield pieces.join('')
      const tail = rows.at(-1)
      if (tail === undefined || rows.length < BACKUP_PAGE) {
        if (tail !== undefined) last = tail.seq
        break
      }
      last = tail.seq
      await yieldToLoop()
    }
    yield writer.scopeEnd(last, broadcastList)
  }
  yield writer.packingStart()
  let lastPacking = 0
  for (;;) {
    const rows = await db
      .select({
        id: packingRecords.id,
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
      .where(and(eq(packingRecords.sellerId, sellerId), gt(packingRecords.id, lastPacking)))
      .orderBy(asc(packingRecords.id))
      .limit(BACKUP_PAGE)
    if (rows.length > 0) {
      yield rows
        .map((row) =>
          writer.packing({
            date: row.date,
            buyer: row.buyer,
            kind: row.kind as PackingKind,
            items: row.items === null ? null : parsePackedItems(row.items).map(packedItemValue),
            invoice: row.invoice,
            accountId: row.accountId,
            requestId: row.requestId,
            createdAt: toIso(row.createdAt),
          }),
        )
        .join('')
    }
    const tail = rows.at(-1)
    if (tail === undefined || rows.length < BACKUP_PAGE) break
    lastPacking = tail.id
    await yieldToLoop()
  }
  yield writer.end()
}

/**
 * 판매자 전체 기록 → 백업 파일 바이트 (gzip JSON — 자동 백업·안전 백업·전체 내려받기가 같은 형식, D-I2-12).
 * 글 조각을 gzip 스트림(스레드 풀)에 이어 넣는다 — 글 하나로 만들지 않고, 이벤트 묶음 사이에 이벤트 루프에 차례를 넘긴다
 */
export async function createBackupBytes(db: Db, sellerId: string, now: number): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  await pipeline(
    Readable.from(
      (async function* () {
        for await (const piece of backupPieces(db, sellerId, now)) yield Buffer.from(piece, 'utf8')
      })(),
    ),
    createGzip(),
    async function (source: AsyncIterable<Buffer>) {
      for await (const chunk of source) chunks.push(chunk)
    },
  )
  const out = Buffer.concat(chunks)
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength)
}

// ── 읽기·검사 ────────────────────────────────────────────────────────────

type Checked<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string }
const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason })

/** 검사 실패 (쉬운 문장 — 기록 내용·개인정보 없음) */
class BackupInvalid extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupInvalid'
  }
}
const invalid = (message: string): never => {
  throw new BackupInvalid(message)
}

const MESSAGES = {
  gzip: '백업 파일을 풀지 못했어요(gzip 파일이 아니거나 손상됐어요).',
  format: '라이브찜 백업 파일이 아니에요(형식 이름이 달라요).',
  version: `이 서버가 읽을 수 없는 형식 번호예요(${String(BACKUP_VERSION)}만 읽어요).`,
  keys: '백업 파일의 칸이 형식과 달라요.',
  shop: '가게 설정의 형식이 올바르지 않아요.',
  settings: '판매 규칙 설정의 형식이 올바르지 않아요.',
  settingsCheck: '판매 규칙 설정이 검사를 통과하지 못했어요.',
  scopes: '범위 목록의 형식이 올바르지 않아요.',
  scope: '범위의 형식이 올바르지 않아요.',
  packing: '포장 기록이 목록이 아니에요.',
  digest: '파일 요약값이 맞지 않아요(파일이 손상됐거나 바뀌었어요).',
} as const

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
const PACKING_KEYS = ['date', 'buyer', 'kind', 'items', 'invoice', 'accountId', 'requestId', 'createdAt'] as const

const scopeName = (date: string, rehearsal: boolean): string => `${date}${rehearsal ? ' 리허설' : ''}`

function checkEventRow(raw: unknown, date: string, rehearsal: boolean, expectedSeq: number): BackupEvent {
  const where = `범위 ${scopeName(date, rehearsal)}의 ${String(expectedSeq)}번째 이벤트`
  if (!isObject(raw) || !hasKeys(raw, EVENT_KEYS)) return invalid(`${where}의 형식이 올바르지 않아요.`)
  const { seq, type, body, at, receivedAt, actor, accountId, requestId, failed, digest } = raw
  if (!isInt(seq, 1)) return invalid(`${where}의 seq가 올바르지 않아요.`)
  if (seq !== expectedSeq) return invalid(`범위 ${scopeName(date, rehearsal)}의 seq가 1부터 빈틈없이 이어지지 않아요(${String(expectedSeq)}번째).`)
  if (typeof type !== 'string' || typeof body !== 'string' || !isInt(at) || !isIso(receivedAt) || typeof failed !== 'boolean' || typeof digest !== 'string') {
    return invalid(`${where}의 형식이 올바르지 않아요.`)
  }
  if (typeof actor !== 'string' || !ACTORS.includes(actor) || !isStringOrNull(accountId) || !isStringOrNull(requestId)) return invalid(`${where}의 형식이 올바르지 않아요.`)
  if (backupEventDigest(date, rehearsal, seq, type, body, failed) !== digest) return invalid(`범위 ${scopeName(date, rehearsal)}의 seq ${String(seq)} 이벤트 요약값이 맞지 않아요(기록이 바뀌었어요).`)
  return { seq, type, body, at, receivedAt, actor: actor as BackupActor, accountId, requestId, failed, digest }
}

function checkBroadcastRow(raw: unknown): BackupBroadcast | null {
  if (!isObject(raw) || !hasKeys(raw, BROADCAST_KEYS)) return null
  const { id, date, title, startSeq, endedAt, createdAt } = raw
  if (typeof id !== 'string' || typeof date !== 'string' || typeof title !== 'string' || !isInt(startSeq, 1) || !(endedAt === null || isIso(endedAt)) || !isIso(createdAt)) return null
  return { id, date, title, startSeq, endedAt, createdAt }
}

/** 한 범위를 처음부터 이벤트 하나씩 재생 (실패 표시는 건너뛴다). 입력 오류·형식 오류·본문과 칸이 다르면 실패 */
class ScopeReplay {
  state: EngineState = emptyState()
  readonly attention: AttentionItem[] = []
  readonly derived: BackupBroadcast[] = []
  count = 0
  readonly #where: string

  constructor(date: string, rehearsal: boolean) {
    this.#where = scopeName(date, rehearsal)
  }

  /** 이벤트 하나: 상태를 바꿨는지와 낸 효과 */
  apply(event: BackupEvent): { changed: boolean; effects: readonly EngineEffect[] } {
    this.count++
    if (event.failed) {
      this.attention.push({ seq: event.seq, message: FAILED_INPUT_MESSAGE })
      return { changed: false, effects: [] }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(event.body)
    } catch {
      return invalid(`범위 ${this.#where}의 seq ${String(event.seq)} 이벤트 본문을 읽지 못했어요.`)
    }
    if (!isObject(parsed) || parsed.type !== event.type || parsed.seq !== event.seq || parsed.at !== event.at) {
      return invalid(`범위 ${this.#where}의 seq ${String(event.seq)} 이벤트 본문이 기록 칸과 맞지 않아요.`)
    }
    let result: { state: EngineState; effects: readonly EngineEffect[] }
    try {
      result = applyEvent(this.state, parsed as unknown as EngineEvent)
    } catch {
      return invalid(`범위 ${this.#where}의 seq ${String(event.seq)}에서 다시 계산하지 못했어요.`)
    }
    const changed = result.state !== this.state
    if (changed && (event.type === 'broadcast.start' || event.type === 'broadcast.end')) {
      const b = String(parsed.b)
      if (event.type === 'broadcast.start') {
        this.derived.push({ id: b, date: String(parsed.date), title: String(parsed.title), startSeq: event.seq, endedAt: null, createdAt: event.receivedAt })
      } else {
        const index = this.derived.findIndex((broadcast) => broadcast.id === b)
        if (index >= 0) this.derived[index] = { ...(this.derived[index] as BackupBroadcast), endedAt: iso(event.at) }
      }
    }
    this.state = result.state
    return { changed, effects: result.effects }
  }

  /** 범위 끝: seq = 이벤트 수(1 이상), 불변식, 방송 목록 = 이벤트로 정한 것 */
  finish(seq: unknown, rawBroadcasts: unknown, date: string, rehearsal: boolean): BackupBroadcast[] {
    if (!isInt(seq) || this.count === 0 || seq !== this.count) return invalid(`범위 ${scopeName(date, rehearsal)}의 seq가 이벤트 기록과 맞지 않아요.`)
    if (!Array.isArray(rawBroadcasts)) return invalid(MESSAGES.scope)
    const list: BackupBroadcast[] = []
    for (const raw of rawBroadcasts as unknown[]) {
      const checked = checkBroadcastRow(raw)
      if (checked === null) return invalid(`범위 ${scopeName(date, rehearsal)}의 방송 목록 형식이 올바르지 않아요.`)
      list.push(checked)
    }
    if (checkInvariants(this.state).length > 0) return invalid(`범위 ${this.#where}의 마지막 상태가 불변식 검사를 통과하지 못했어요.`)
    if (canonicalJson(this.derived) !== canonicalJson(list)) return invalid(`범위 ${this.#where}의 방송 목록이 이벤트와 맞지 않아요.`)
    return list
  }
}

/** 포장 기록 하나씩의 형식과 차례 (구매자 ID마다: 포장 완료 ← 대기·포장됨, 포장 취소 ← 포장됨, 배송 완료 ← 포장됨·배송됨, 배송 취소 ← 배송됨) */
class PackingCheck {
  readonly #phases = new Map<string, 'WAITING' | 'PACKED' | 'SHIPPED'>()
  readonly #requests = new Set<string>()
  readonly #realDates: ReadonlySet<string>
  #index = 0

  constructor(realDates: ReadonlySet<string>) {
    this.#realDates = realDates
  }

  check(raw: unknown): BackupPacking {
    this.#index++
    const where = `포장 기록 ${String(this.#index)}번`
    if (!isObject(raw) || !hasKeys(raw, PACKING_KEYS)) return invalid(`${where}의 형식이 올바르지 않아요.`)
    const { date, buyer, kind, items, invoice, accountId, requestId, createdAt } = raw
    if (typeof date !== 'string' || !this.#realDates.has(date)) return invalid(`${where}의 날짜가 실제 범위가 아니에요.`)
    if (typeof buyer !== 'string' || buyer === '' || buyer.length > 256) return invalid(`${where}의 구매자가 올바르지 않아요.`)
    if (typeof kind !== 'string' || !(PACKING_KINDS as readonly string[]).includes(kind)) return invalid(`${where}의 종류가 올바르지 않아요.`)
    if (!isStringOrNull(accountId) || !isStringOrNull(requestId) || !isIso(createdAt)) return invalid(`${where}의 형식이 올바르지 않아요.`)
    if (requestId !== null) {
      if (this.#requests.has(requestId)) return invalid(`${where}의 요청 번호가 겹쳐요.`)
      this.#requests.add(requestId)
    }
    let pairs: PackedItem[] = []
    if (kind === 'PACKED') {
      // 품목 = (상품 ID, 상품 키) 쌍 { id, key } (D-I2-19). 이 결정 전 형식(상품 키 글)도 읽는다 — 상태 계산에서 지금 품목과 같지 않다고 본다
      const read = Array.isArray(items) ? (items as unknown[]).map(readPackedItem) : []
      pairs = read.filter((item): item is PackedItem => item !== null)
      const ids = pairs.flatMap((item) => (item.id === null ? [] : [item.id]))
      if (!Array.isArray(items) || items.length === 0 || pairs.length !== items.length || new Set(pairs.map((item) => item.key)).size !== pairs.length || new Set(ids).size !== ids.length) {
        return invalid(`${where}의 담은 품목이 올바르지 않아요.`)
      }
    } else if (items !== null) return invalid(`${where}의 담은 품목이 올바르지 않아요.`)
    if (kind === 'SHIPPED') {
      if (invoice !== null && (typeof invoice !== 'string' || !/^[0-9]{8,20}$/.test(invoice))) return invalid(`${where}의 송장번호가 올바르지 않아요.`)
    } else if (invoice !== null) return invalid(`${where}의 송장번호가 올바르지 않아요.`)
    const key = JSON.stringify([date, buyer])
    const phase = this.#phases.get(key) ?? 'WAITING'
    const allowed =
      (kind === 'PACKED' && phase !== 'SHIPPED') || (kind === 'UNPACKED' && phase === 'PACKED') || (kind === 'SHIPPED' && phase !== 'WAITING') || (kind === 'UNSHIPPED' && phase === 'SHIPPED')
    if (!allowed) return invalid(`${where}의 차례가 맞지 않아요.`)
    this.#phases.set(key, kind === 'PACKED' || kind === 'UNSHIPPED' ? 'PACKED' : kind === 'UNPACKED' ? 'WAITING' : 'SHIPPED')
    return { date, buyer, kind: kind as PackingKind, items: kind === 'PACKED' ? pairs.map(packedItemValue) : null, invoice: invoice as string | null, accountId, requestId, createdAt }
  }
}

/** 검사를 통과한 파일의 요약 (범위마다 날짜·리허설인지·seq·이벤트 수·방송 목록 — 이벤트 내용은 담지 않는다) */
export interface BackupScopeSummary {
  readonly date: string
  readonly rehearsal: boolean
  readonly seq: number
  readonly events: number
  readonly broadcasts: readonly BackupBroadcast[]
}

export interface BackupSummary {
  readonly format: typeof BACKUP_FORMAT
  readonly version: typeof BACKUP_VERSION
  readonly createdAt: string
  readonly sellerId: string
  readonly shop: ShopView
  readonly settings: Readonly<Record<string, unknown>>
  readonly scopes: readonly BackupScopeSummary[]
  readonly packing: number
  readonly digest: string
}

export interface CheckedBackup {
  readonly file: BackupSummary
}

/** 검사하며 읽는 동안 부르는 곳 (복구가 DB에 넣는다). 하나라도 던지면 읽기가 멈춘다 */
interface BackupVisitor {
  header?(summary: Pick<BackupSummary, 'sellerId' | 'shop' | 'settings'>): Promise<void>
  scopeStart?(date: string, rehearsal: boolean): Promise<void>
  event?(event: BackupEvent, changed: boolean, effects: readonly EngineEffect[]): Promise<void>
  scopeEnd?(seq: number, broadcastList: readonly BackupBroadcast[], state: EngineState, attention: readonly AttentionItem[]): Promise<void>
  packing?(record: BackupPacking): Promise<void>
}

/** gzip 바이트 → 풀린 글 조각 (gzip 오류는 GzipBroken으로) */
class GzipBroken extends Error {}
async function* gunzipText(bytes: Uint8Array): AsyncGenerator<string> {
  const stream = Readable.from([Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)]).pipe(createGunzip())
  stream.setEncoding('utf8')
  try {
    for await (const chunk of stream) yield chunk as string
  } catch {
    throw new GzipBroken()
  } finally {
    stream.destroy()
  }
}

/**
 * 백업·내보내기 파일을 처음부터 끝까지 한 번 읽으며 검사한다 (AC-I2-62 검사 목록 — 하나라도 어긋나면 까닭).
 * 이벤트는 하나씩 읽고 범위마다 처음부터 재생한다(범위 하나의 상태만 메모리에). visitor가 있으면 검사를 통과한 값마다 부른다.
 * 칸의 차례(형식 번호 2): 맨 위 format·version·createdAt·sellerId·shop·settings·scopes·packing·digest,
 * 범위 date·rehearsal·events·seq·broadcasts(이벤트 요약값에 날짜·리허설인지가 들어가 events 앞에 온다)
 */
async function walkBackup(bytes: Uint8Array, visitor: BackupVisitor = {}): Promise<Checked<BackupSummary>> {
  const reader = new JsonPullReader(gunzipText(bytes))
  try {
    const key = async (expected: string, message: string = MESSAGES.keys): Promise<void> => {
      if ((await reader.readKey()) !== expected) invalid(message)
    }
    await reader.expect('{')
    if ((await reader.readKey()) !== 'format') invalid(MESSAGES.keys)
    if ((await reader.readValue(256)) !== BACKUP_FORMAT) invalid(MESSAGES.format)
    await reader.expect(',', MESSAGES.keys)
    await key('version')
    if ((await reader.readValue(64)) !== BACKUP_VERSION) invalid(MESSAGES.version)
    await reader.expect(',', MESSAGES.keys)
    await key('createdAt')
    const createdAt = await reader.readValue(64)
    if (!isIso(createdAt)) invalid(MESSAGES.keys)
    await reader.expect(',', MESSAGES.keys)
    await key('sellerId')
    const sellerId = await reader.readValue(1024)
    if (typeof sellerId !== 'string') invalid(MESSAGES.keys)
    await reader.expect(',', MESSAGES.keys)
    await key('shop')
    const shop = await reader.readValue()
    if (!checkShop(shop)) invalid(MESSAGES.shop)
    await reader.expect(',', MESSAGES.keys)
    await key('settings')
    const settings = await reader.readValue()
    if (!isObject(settings)) invalid(MESSAGES.settings)
    const settingsObject = settings as Record<string, unknown>
    if (checkSettings(settingsObject).length > 0 || settingsObject['settlement.groupBy'] === 'MANUAL') invalid(MESSAGES.settingsCheck)
    const digest = new BackupDigest()
    digest.header({ format: BACKUP_FORMAT, version: BACKUP_VERSION, sellerId, shop, settings })
    await visitor.header?.({ sellerId: sellerId as string, shop: shop as ShopView, settings: settingsObject })

    // 범위
    await reader.expect(',', MESSAGES.keys)
    await key('scopes')
    await reader.expect('[', MESSAGES.scopes)
    const seen = new Set<string>()
    const scopeList: BackupScopeSummary[] = []
    if (!(await reader.take(']'))) {
      do {
        await reader.expect('{', MESSAGES.scope)
        await key('date', MESSAGES.scope)
        const date = await reader.readValue(64)
        await reader.expect(',', MESSAGES.scope)
        await key('rehearsal', MESSAGES.scope)
        const rehearsal = await reader.readValue(16)
        if (!isValidDate(date) || typeof rehearsal !== 'boolean') invalid(MESSAGES.scope)
        const scopeDate = date as string
        const scopeKey = JSON.stringify([scopeDate, rehearsal])
        if (seen.has(scopeKey)) invalid(`범위 ${scopeName(scopeDate, rehearsal as boolean)}가 두 번 있어요.`)
        seen.add(scopeKey)
        digest.scopeStart(scopeDate, rehearsal)
        await visitor.scopeStart?.(scopeDate, rehearsal as boolean)
        await reader.expect(',', MESSAGES.scope)
        await key('events', MESSAGES.scope)
        await reader.expect('[', MESSAGES.scope)
        const replay = new ScopeReplay(scopeDate, rehearsal as boolean)
        if (!(await reader.take(']'))) {
          do {
            const raw = await reader.readValue()
            const event = checkEventRow(raw, scopeDate, rehearsal as boolean, replay.count + 1)
            digest.event(raw)
            const { changed, effects } = replay.apply(event)
            await visitor.event?.(event, changed, effects)
          } while (await reader.take(','))
          await reader.expect(']', MESSAGES.scope)
        }
        await reader.expect(',', MESSAGES.scope)
        await key('seq', MESSAGES.scope)
        const seq = await reader.readValue(64)
        await reader.expect(',', MESSAGES.scope)
        await key('broadcasts', MESSAGES.scope)
        const rawBroadcasts = await reader.readValue()
        await reader.expect('}', MESSAGES.scope)
        const broadcastList = replay.finish(seq, rawBroadcasts, scopeDate, rehearsal as boolean)
        digest.scopeEnd(seq, rawBroadcasts)
        await visitor.scopeEnd?.(seq as number, broadcastList, replay.state, replay.attention)
        scopeList.push({ date: scopeDate, rehearsal: rehearsal as boolean, seq: seq as number, events: replay.count, broadcasts: broadcastList })
      } while (await reader.take(','))
      await reader.expect(']', MESSAGES.scopes)
    }

    // 포장 기록 (실제 범위 날짜만)
    await reader.expect(',', MESSAGES.keys)
    await key('packing')
    await reader.expect('[', MESSAGES.packing)
    const packing = new PackingCheck(new Set(scopeList.filter((scope) => !scope.rehearsal).map((scope) => scope.date)))
    let packingCount = 0
    if (!(await reader.take(']'))) {
      do {
        const raw = await reader.readValue()
        const record = packing.check(raw)
        digest.packing(raw)
        packingCount++
        await visitor.packing?.(record)
      } while (await reader.take(','))
      await reader.expect(']', MESSAGES.packing)
    }
    await reader.expect(',', MESSAGES.keys)
    await key('digest')
    const fileDigest = await reader.readValue(256)
    await reader.expect('}', MESSAGES.keys)
    await reader.end()
    if (typeof fileDigest !== 'string') invalid(MESSAGES.keys)
    if (digest.digest() !== fileDigest) invalid(MESSAGES.digest)
    return {
      ok: true,
      value: {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        createdAt: createdAt as string,
        sellerId: sellerId as string,
        shop: shop as ShopView,
        settings: settingsObject,
        scopes: scopeList,
        packing: packingCount,
        digest: fileDigest as string,
      },
    }
  } catch (error) {
    if (error instanceof BackupInvalid) return fail(error.message)
    if (error instanceof JsonStreamError) return fail(error.message)
    if (error instanceof GzipBroken) return fail(MESSAGES.gzip)
    throw error
  } finally {
    await reader.close().catch(() => undefined)
  }
}

/**
 * 백업·내보내기 파일 바이트 → 검사 결과 (AC-I2-62 검사 목록 — 형식 이름·번호, 칸, 가게 설정, 판매 규칙 설정, 범위 겹침, 이벤트마다 요약값·seq 1부터 빈틈없음,
 * 범위마다 처음부터 재생·불변식·방송 목록, 포장 기록의 형식·차례·요청 번호, 파일 요약값). 하나라도 어긋나면 까닭(쉬운 문장 — 기록 내용·개인정보 없음)
 */
export async function checkBackupBytes(bytes: Uint8Array): Promise<Checked<CheckedBackup>> {
  const walked = await walkBackup(bytes)
  return walked.ok ? { ok: true, value: { file: walked.value } } : walked
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
  /** 켠 뒤 첫 확인까지 (기본 BACKUP_START_DELAY_MS) */
  readonly startDelayMs?: number
}

export class BackupScheduler {
  readonly #options: BackupSchedulerOptions
  #timer: ReturnType<typeof setInterval> | null = null
  #first: ReturnType<typeof setTimeout> | null = null
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

  /**
   * 켠 뒤 잠시(startDelayMs, 기본 3분) 기다렸다 한 번, 그 뒤 주기마다 확인한다 — 판매 중에 다시 켜도 켜자마자 모든 판매자의 백업을 몰아 만들지 않는다(RA-I2-003).
   * 저장소가 없으면 시작 경보만 남긴다(판매는 그대로)
   */
  start(): void {
    if (this.#options.storage === null) {
      this.#options.log({ level: 'warn', code: 'BACKUP_DISABLED' })
      return
    }
    if (this.#timer !== null) return
    this.#first = setTimeout(() => void this.check(), this.#options.startDelayMs ?? BACKUP_START_DELAY_MS)
    this.#first.unref?.()
    this.#timer = setInterval(() => void this.check(), this.#options.intervalMs ?? BACKUP_CHECK_INTERVAL_MS)
    this.#timer.unref?.()
  }

  stop(): void {
    if (this.#first !== null) clearTimeout(this.#first)
    if (this.#timer !== null) clearInterval(this.#timer)
    this.#first = null
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
    return storage.write(sellerId, kind, now, await createBackupBytes(this.#options.db, sellerId, now))
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
  /** 같은 서버의 다른 판매자에게 같은 방송 ID가 있음 (방송 ID는 서버 전체에서 유일 — RA-I2-002) */
  broadcastTaken: '이 서버의 다른 판매자에게 같은 방송 기록이 있어 가져올 수 없어요. 아무것도 바꾸지 않았어요.',
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

/**
 * 복구·가져오기가 그 판매자의 행을 모두 지우고 파일로 다시 만드는 표 — 지우는 순서(다른 표를 참조하는 표가 먼저). D-I2-11, RA-I2-001.
 * 판매자 ID 칸이 있는 표는 모두 이 목록이나 RESTORE_KEPT_TABLES 중 하나에 있어야 하고, 범위·방송 등 이 목록의 표를 참조하는 표는 이 목록에 있어야 한다
 * (test/i2-restore-contract.test.ts가 마이그레이션을 적용한 실제 DB의 표·외래 키로 확인한다 — 다른 트랙의 표를 합치면 그 시험이 어디에 둘지 정하라고 알린다)
 * 합칠 때(I1·Y1·I3) 더한 표:
 * - 출력 기록(I1 — 시도·작업·라벨 키·출력 요청 번호·대기열): 범위를 참조하고 파일에 없다 — 지운다(복구한 기록의 효과는 다시 출력하지 않는다, restored).
 *   대기열 줄(print_queues)은 그대로 둔다 — 라벨 기능 켬/끔(N4a labels_enabled)·출력 기기 설정이 있다. 출력 중·멈춤 상태만 지운다(지운 작업을 기다리지 않게).
 * - 유튜브(Y1 — 채팅 본문·이름 chat_raw, 수집기·방송 잇기·우리 메시지·삭제·차단 알림): 범위를 참조한다 — 지운다. 채팅 본문·이름은 파일의 이벤트에서 다시 만든다.
 * - 인스타그램·라이브 연결(N2 — 감사 DM 행·발송, 라이브 연결·옮긴 기록, 이어지지 않은 댓글 수, 요청 번호): 범위·방송·발송함을 참조하거나 그 기록이다 — 지운다
 *   (복구한 지난 감사 DM을 다시 보내지 않는다).
 * - 구매자 확인서 공유 링크·그 요청 번호(N4b D-N4b-06): 파일에 없다 — 지운다. 복구한 기록의 구매자 ID가 다른 사람을 가리킬 수 있어 복구 전에 만든 링크는 모두 열리지 않게 한다.
 */
export const RESTORE_REPLACED_TABLES = [
  receiptLinks,
  receiptLinkRequests,
  igDmRows,
  igDmSends,
  liveLinkMoves,
  liveLinks,
  liveUnlinked,
  liveRequests,
  printAttempts,
  printJobs,
  printLabels,
  printRequests,
  youtubeOwnMessages,
  youtubeNotices,
  youtubeCollectors,
  youtubeLinks,
  chatRaw,
  packingRecords,
  outbox,
  snapshots,
  events,
  broadcasts,
  scopes,
] as const
/**
 * 복구가 그대로 두는 판매자 표: 판매자 행(가게 설정·판매 규칙 설정 칸만 파일의 것으로 바꾼다)·로그인 계정·세션 (AC-I2-62 "판매자 ID·로그인 계정·세션·전화번호 키는 그대로"),
 * 라벨 템플릿(I1 — 판매자 설정, 파일에 없다), 구글 연결·승인 요청·할당량 사용량(Y1 — 계정 연결과 그날 쓴 양, 파일에 없다), 인스타그램 연결·승인 요청(N2 — 계정 연결), 출력 대기열 줄·라벨 기능 켬/끔 기록(I1·N4a — 판매자 설정, 대기열의 출력 중·멈춤 상태는 복구가 지운다)
 */
export const RESTORE_KEPT_TABLES = [sellers, accounts, sessions, labelTemplates, youtubeConnections, youtubeOauthStates, youtubeQuota, igConnections, igOauthStates, printQueues, labelSwitches] as const
/** 판매자 데이터가 아닌 표 (로그인 전 시도 수 — 판매자 ID가 없다) */
export const RESTORE_UNRELATED_TABLES = [loginLimits] as const

/** 모아 두었다가 BATCH개마다 넣는 통 */
class Batcher<T> {
  readonly #insert: (rows: T[]) => Promise<unknown>
  #rows: T[] = []

  constructor(insert: (rows: T[]) => Promise<unknown>) {
    this.#insert = insert
  }

  async push(row: T): Promise<void> {
    this.#rows.push(row)
    if (this.#rows.length >= BATCH) await this.flush()
  }

  async flush(): Promise<void> {
    if (this.#rows.length === 0) return
    const rows = this.#rows
    this.#rows = []
    await this.#insert(rows)
  }
}

/**
 * 복구·가져오기 (D-I2-11). 파일 전체 검사 → (다른 판매자와 방송 ID 겹침 확인) → (바꾸기면 안전 백업) →
 * 한 트랜잭션에 판매자의 범위·방송·이벤트·스냅샷·발송함·포장 기록·가게 설정·판매 규칙 설정을 파일의 것으로(파일을 한 번 더 읽으며 넣는다).
 * 판매자 ID·로그인 계정·세션·전화번호 키는 그대로 둔다. 끝나면 그 판매자에 재생 무결성 검사를 돌린다.
 * 부르는 쪽이 같은 프로세스의 범위 상태 캐시를 비워야 한다(ScopeWriter.forgetSeller — 운영 명령은 서버를 다시 켠다)
 */
export async function restoreSeller(options: RestoreOptions): Promise<RestoreOutcome> {
  const { db, sellerId } = options
  const checked = await walkBackup(options.bytes)
  if (!checked.ok) return checked
  const summary = checked.value
  const sellerRows = await db.select({ id: sellers.id }).from(sellers).where(eq(sellers.id, sellerId)).limit(1)
  if (sellerRows.length === 0) return fail(RESTORE_MESSAGES.noSeller)
  const existing = await db.select({ date: scopes.date, rehearsal: scopes.rehearsal }).from(scopes).where(eq(scopes.sellerId, sellerId))
  if (existing.length > 0 && !options.replace) return fail(RESTORE_MESSAGES.needReplace)
  if (await broadcastTaken(db, sellerId, summary.scopes.flatMap((scope) => scope.broadcasts.map((broadcast) => broadcast.id)))) return fail(RESTORE_MESSAGES.broadcastTaken)
  let safety: string | null = null
  if (existing.length > 0) {
    if (options.storage === null) return fail(RESTORE_MESSAGES.noStorage)
    try {
      const now = options.clock.now()
      safety = (await options.storage.write(sellerId, 'safety', now, await createBackupBytes(db, sellerId, now))).name
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
      const lockKeys = [...new Set([...existing.map((row) => JSON.stringify([row.date, row.rehearsal])), ...summary.scopes.map((scope) => JSON.stringify([scope.date, scope.rehearsal]))])].sort()
      for (const key of lockKeys) {
        const [date, rehearsal] = JSON.parse(key) as [string, boolean]
        await tx.execute(sql`select pg_advisory_xact_lock(${scopeLockKey(sellerId, date, rehearsal)})`)
      }
      const nowExisting = await tx.select({ id: scopes.id }).from(scopes).where(eq(scopes.sellerId, sellerId))
      if (nowExisting.length > 0 && !options.replace) throw new RestoreAbort(RESTORE_MESSAGES.needReplace)
      for (const table of RESTORE_REPLACED_TABLES) await tx.delete(table).where(eq(table.sellerId, sellerId))
      // 출력 대기열 줄은 남긴다(라벨 기능 켬/끔·출력 기기) — 지운 작업을 기다리는 출력 중·멈춤 상태만 지운다 (D-I2-14)
      await tx.update(printQueues).set({ releasing: false, paused: null, backlog: false, rev: sql`${printQueues.rev} + 1`, updatedAt: now }).where(eq(printQueues.sellerId, sellerId))
      await tx
        .update(sellers)
        .set({ name: summary.shop.name.trim(), shop: shopJson(summary.shop), settings: JSON.stringify(summary.settings) })
        .where(eq(sellers.id, sellerId))
      const scopeIds = new Map<string, string>()
      // 지금 넣는 범위 (범위 행은 첫 이벤트에서 — 만든 시각 = 첫 이벤트의 도착 시각)
      let current: { date: string; rehearsal: boolean; id: string; created: boolean; youtubeChat: boolean } | null = null
      const eventRows = new Batcher<typeof events.$inferInsert>((rows) => tx.insert(events).values(rows))
      const chatRawRows = new Batcher<typeof chatRaw.$inferInsert>((rows) => tx.insert(chatRaw).values(rows))
      const outboxRows = new Batcher<typeof outbox.$inferInsert>((rows) => tx.insert(outbox).values(rows))
      const packingBatch = new Batcher<typeof packingRecords.$inferInsert>((rows) => tx.insert(packingRecords).values(rows))
      const visitor: BackupVisitor = {
        scopeStart: async (date, rehearsal) => {
          const id = options.ids.scope()
          scopeIds.set(JSON.stringify([date, rehearsal]), id)
          current = { date, rehearsal, id, created: false, youtubeChat: false }
        },
        event: async (event, changed, effects) => {
          const scope = current as unknown as { date: string; rehearsal: boolean; id: string; created: boolean; youtubeChat: boolean }
          if (!scope.created) {
            await tx.insert(scopes).values({ id: scope.id, sellerId, date: scope.date, rehearsal: scope.rehearsal, seq: 0, createdAt: new Date(event.receivedAt) })
            scope.created = true
          }
          const body = JSON.parse(event.body) as Record<string, unknown>
          // 채팅의 본문·이름은 chat_raw에 따로 둔다 (Y1, AC-Y1-60 — 기록 경로와 같은 모양). 실제 범위의 채팅 = 유튜브 채팅(봉인 대상, AC-Y1-61)
          const split = event.type === 'chat' ? splitChatRaw(body) : null
          const stored = split === null ? event.body : JSON.stringify(split.body)
          if (event.type === 'chat' && !scope.rehearsal) scope.youtubeChat = true
          await eventRows.push({
            sellerId,
            scopeId: scope.id,
            seq: event.seq,
            type: event.type,
            body: stored,
            at: event.at,
            receivedAt: new Date(event.receivedAt),
            actor: event.actor,
            accountId: keepAccount(event.accountId),
            requestId: event.requestId,
            chatBroadcast: event.type === 'chat' && typeof body.b === 'string' ? body.b : null,
            chatMessageId: event.type === 'chat' && typeof body.id === 'string' ? body.id : null,
            smsRef: event.type === 'sms' && typeof body.ref === 'string' ? body.ref : null,
            changed,
            failed: event.failed,
            digest: eventDigest(scope.id, event.seq, event.type, stored, event.failed, split?.raw ?? null),
            chatSource: event.type === 'chat' ? (scope.rehearsal ? 'rehearsal' : 'youtube') : null,
            raw: split !== null,
          })
          if (split !== null) await chatRawRows.push({ sellerId, scopeId: scope.id, seq: event.seq, nick: split.raw.nick, text: split.raw.text })
          // 다시 만든 발송함: 실행하지 않음 표시 (D-I2-11 — 지난 라벨·감사 메시지를 다시 내지 않는다)
          for (const effect of effects) {
            await outboxRows.push({ sellerId, scopeId: scope.id, effectId: effect.id, seq: event.seq, kind: effect.kind, body: JSON.stringify(effect), rehearsal: scope.rehearsal, restored: true, createdAt: now })
          }
          eventCount++
        },
        scopeEnd: async (seq, broadcastList, state, attention) => {
          const scope = current as unknown as { date: string; rehearsal: boolean; id: string; created: boolean; youtubeChat: boolean }
          await eventRows.flush()
          await chatRawRows.flush()
          await outboxRows.flush()
          await tx.update(scopes).set({ seq, youtubeChat: scope.youtubeChat }).where(and(eq(scopes.sellerId, sellerId), eq(scopes.id, scope.id)))
          if (broadcastList.length > 0) {
            await tx.insert(broadcasts).values(
              broadcastList.map((broadcast) => ({
                id: broadcast.id,
                sellerId,
                scopeId: scope.id,
                date: broadcast.date,
                title: broadcast.title,
                startSeq: broadcast.startSeq,
                endedAt: broadcast.endedAt === null ? null : new Date(broadcast.endedAt),
                createdAt: new Date(broadcast.createdAt),
              })),
            )
          }
          await tx.insert(snapshots).values({ sellerId, scopeId: scope.id, seq, format: STATE_FORMAT, state: JSON.stringify(state), attention: JSON.stringify(attention), createdAt: now })
          current = null
        },
        packing: async (record) =>
          packingBatch.push({
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
          }),
      }
      // 같은 바이트를 한 번 더 읽으며 넣는다 (첫 검사를 통과했으니 같은 결과여야 한다 — 아니면 멈춘다)
      const written = await walkBackup(options.bytes, visitor)
      if (!written.ok || written.value.digest !== summary.digest) throw new RestoreAbort(RESTORE_MESSAGES.failed)
      await packingBatch.flush()
      await options.beforeCommit?.()
    })
  } catch (error) {
    if (error instanceof RestoreAbort) return fail(error.message)
    return fail(RESTORE_MESSAGES.failed)
  }
  const checks = await checkReplay(db, { sellerId })
  return { ok: true, scopes: summary.scopes.length, events: eventCount, packing: summary.packing, safety, checks }
}

/** 파일의 방송 ID 중 다른 판매자의 방송 ID와 같은 것이 있는가 (방송 기본 키는 서버 전체 — 같은 서버의 다른 판매자로 가져오기, RA-I2-002) */
async function broadcastTaken(db: Db, sellerId: string, ids: readonly string[]): Promise<boolean> {
  for (let start = 0; start < ids.length; start += BATCH) {
    const rows = await db
      .select({ id: broadcasts.id })
      .from(broadcasts)
      .where(and(inArray(broadcasts.id, ids.slice(start, start + BATCH)), ne(broadcasts.sellerId, sellerId)))
      .limit(1)
    if (rows.length > 0) return true
  }
  return false
}

class RestoreAbort extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RestoreAbort'
  }
}

/** 발송함 실행 대상 수 (실행기의 조건 executableOutbox — 리허설 행과 복구로 다시 만든 행은 빠진다, D-081·D-I2-11) */
export async function executableOutboxCount(db: Db, sellerId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(outbox)
    .where(and(eq(outbox.sellerId, sellerId), executableOutbox))
  return rows[0]?.n ?? 0
}
