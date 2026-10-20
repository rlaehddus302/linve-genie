// 정산 마무리 작업 (I2 — STL-04·05·06·08·10, BUY-05, PRD-05, DAT-03·04, D-I2-01~D-I2-13).
// 판정·정산은 모두 packages/core가 하고, 문서는 packages/documents·packages/label이 만든다 — 여기서는 범위 상태를 읽어 넘기고 기록을 덧붙인다.
// - 가게 설정, 확인서(데이터·PDF·PNG·전원 PDF), 판매대장 엑셀, 포장·배송(상태·명령·라벨), 지난 구매, 상품 목록 가져오기(미리 보기·등록), 백업 상태, 전체 내려받기.
// - 판매자 ID 조건은 늘 세션의 판매자다. 없는 범위·다른 판매자의 자원은 404(있는지 드러내지 않는다).
// - 문서·파일 내용, 파일 이름, 송장번호, 가게 설정 값, 가져오기 글은 로그에 남기지 않는다(로그는 정해진 코드·날짜뿐).
import { containsPhoneRun, currentBuyerOf, getBroadcast, getBuyer, isValidDate, listProducts, looksLikePhoneId, normalizeText, type EngineState } from '@livejjim/core'
import { buildLedger, buildReceipt, ledgerToXlsx, renderBatchPdf, renderReceiptPdf, renderReceiptPng, type ReceiptData } from '@livejjim/documents'
import type { PackingLabelData } from '@livejjim/label'
import { and, asc, eq, gte, sql } from 'drizzle-orm'
import { hasControlChar, isPlainObject, own, ownKeys } from './api-fields.ts'
import { buildBackup, encodeBackup, type BackupScheduler, type BackupStatus } from './backup.ts'
import type { Db } from './db/database.ts'
import { events, packingRecords } from './db/schema.ts'
import type { ErrorCode, FieldProblem } from './errors.ts'
import { MIME, documentFont, fileNamePart } from './files.ts'
import type { StreamHub } from './hub.ts'
import { IMPORT_FILE_MAX_BYTES, IMPORT_FILE_MESSAGES, IMPORT_TEXT_MAX_CHARS, decodeTextFile, importFileKind, readXlsxRows } from './import-files.ts'
import type { LogSink } from './log.ts'
import { phoneIdProblem, unknownFieldProblems } from './messages.ts'
import {
  PACKING_ACTIONS,
  PACKING_MESSAGES,
  PRODUCT_KEY_RE,
  decidePacking,
  labelPdf,
  labelPng,
  ledgerShippingWord,
  packingByRequest,
  packingEntries,
  packingEntry,
  packingLabelData,
  packingRows,
  packingStatusByBuyer,
  readInvoice,
  renderPacking,
  replayPacking,
  type PackingAction,
  type PackingEntry,
  type PackingWord,
} from './packing.ts'
import { pastPurchases, type PastView } from './past.ts'
import { IMPORT_MAX_ROWS, isNormalizedName, parseProductList, parseProductRows, recheckRows, splitCells, splitImportLines, type ImportResult, type RegisterRow } from './product-import.ts'
import type { ScopeRuntime } from './runtime.ts'
import { checkShopInput, documentShop, readShop, writeShop, type ShopView } from './shop.ts'
import { findBroadcast, listBroadcastRows, scopeSeqs } from './store.ts'
import { kstDate, type Clock } from './time.ts'
import type { Actor, Rejection, ScopeWriter, WriteOutcome } from './writer.ts'

export interface ClosingDeps {
  readonly db: Db
  readonly writer: ScopeWriter
  readonly clock: Clock
  readonly hub: StreamHub
  readonly backups: BackupScheduler
  readonly log: LogSink
}

/** 화면에 돌려줄 오류 (쉬운 문장 — 받은 값은 담지 않는다) */
export interface ApiProblem {
  readonly status: number
  readonly code: ErrorCode
  readonly message: string
  readonly problems?: readonly FieldProblem[]
  readonly extra?: Readonly<Record<string, unknown>>
}

export interface FileResult {
  readonly bytes: Uint8Array
  readonly type: string
  readonly fileName: string
  readonly fallback: string
  readonly headers?: Readonly<Record<string, string>>
}

export type Outcome<T> = { readonly kind: 'ok'; readonly value: T } | { readonly kind: 'error'; readonly error: ApiProblem } | { readonly kind: 'not_found' }

const ok = <T>(value: T): Outcome<T> => ({ kind: 'ok', value })
const problem = (status: number, code: ErrorCode, message: string, problems: readonly FieldProblem[] = [], extra?: Readonly<Record<string, unknown>>): { kind: 'error'; error: ApiProblem } => ({
  kind: 'error',
  error: { status, code, message, problems, ...(extra === undefined ? {} : { extra }) },
})
const NOT_FOUND = { kind: 'not_found' } as const

/** 기간 상한 (D-I2-03): 시작·끝 포함 366일 */
export const LEDGER_MAX_DAYS = 366
export const LEDGER_MESSAGES = {
  date: '날짜를 2026-10-19처럼 적어 주세요.',
  order: '시작 날짜가 끝 날짜보다 늦어요.',
  tooLong: '기간은 366일까지 고를 수 있어요.',
  broadcast: '고른 방송을 다시 확인해 주세요.',
  empty: '고른 기간에 방송이 없어요.',
} as const
export const NO_RECORDS_MESSAGE = '아직 판매 기록이 없어요.'
export const LABEL_NO_ITEMS_MESSAGE = '담을 상품이 없어 포장 라벨을 만들 수 없어요.'
export const LABEL_FAILED_MESSAGE = '포장 라벨을 만들지 못했어요. 고객센터에 알려 주세요.'
export const IMPORT_ENDED_MESSAGE = '끝난 방송에는 상품 목록을 가져올 수 없어요.'
export const IMPORT_CHANGED_MESSAGE = '그 사이에 바뀐 것이 있어요. 다시 확인해 주세요.'
const BUYER_ID_MAX = 128

/** 'YYYY-MM-DD' 두 날짜 사이의 날 수 (둘 다 포함) */
function daysBetween(from: string, to: string): number {
  const ms = (date: string) => {
    const [y, m, d] = date.split('-').map(Number) as [number, number, number]
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((ms(to) - ms(from)) / 86_400_000) + 1
}

/** 구매자 ID 검색값 검사 (휴대폰 번호 모양은 D-079 ⑥ 문장 — 값은 되돌려 보내지 않는다) */
export function buyerParam(value: string | undefined): { ok: true; buyer: string } | { ok: false; error: ApiProblem } {
  if (value === undefined || value === '' || [...value].length > BUYER_ID_MAX || hasControlChar(value)) {
    return { ok: false, error: { status: 400, code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [{ field: 'buyer', message: '구매자를 골라 주세요.' }] } }
  }
  if (looksLikePhoneId(value)) return { ok: false, error: { status: 400, code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [phoneIdProblem('buyer')] } }
  return { ok: true, buyer: value }
}

export class ClosingService {
  readonly #deps: ClosingDeps

  constructor(deps: ClosingDeps) {
    this.#deps = deps
  }

  /** 범위 상태 (없는 범위면 null) */
  async #scope(sellerId: string, date: string, rehearsal: boolean): Promise<ScopeRuntime | null> {
    if (!isValidDate(date)) return null
    const runtime = await this.#deps.writer.read(sellerId, date, rehearsal)
    return runtime.seq === 0 || runtime.scopeId === null ? null : runtime
  }

  // ── 가게 설정 (AC-I2-01) ───────────────────────────────────────────────

  shop(sellerId: string): Promise<ShopView> {
    return readShop(this.#deps.db, sellerId)
  }

  async updateShop(sellerId: string, body: unknown): Promise<{ ok: true; shop: ShopView } | { ok: false; rejection: Rejection }> {
    const checked = checkShopInput(body)
    if (!checked.ok) return checked
    await writeShop(this.#deps.db, sellerId, checked.value)
    // 다른 기기 화면이 확인서 미리 보기를 새로 받는다 (AC-I2-13) — 값은 알림에 넣지 않는다
    this.#deps.hub.publishNamed(sellerId, 'shop', {})
    return { ok: true, shop: await readShop(this.#deps.db, sellerId) }
  }

  // ── 확인서 (AC-I2-10·11·12) ────────────────────────────────────────────

  /**
   * 한 사람 확인서 데이터: 그 범위의 지금 엔진 상태·가게 설정·리허설 여부·서버 시계의 지금 시각으로 buildReceipt.
   * 품목이 없는 묶음·모르는 구매자 → NO_ITEMS(422), 줄 합 ≠ 코어 합계 → AMOUNT_MISMATCH(500, 경보)
   */
  async receipt(sellerId: string, date: string, rehearsal: boolean, buyer: string, at?: number): Promise<Outcome<{ receipt: ReceiptData; createdAt: number }>> {
    const runtime = await this.#scope(sellerId, date, rehearsal)
    if (runtime === null) return NOT_FOUND
    const { state } = runtime
    const shop = documentShop(await readShop(this.#deps.db, sellerId))
    // 만든 시각 = 서버 시계 (at은 E2E 기동의 확인서 데이터 조회만 넘긴다 — AC-I2-15)
    const createdAt = at ?? this.#deps.clock.now()
    const result = buildReceipt({ state, buyer, date, shop, rehearsal, createdAt })
    if (!result.ok) return this.#receiptError(date, result.error.code, result.error.message)
    return ok({ receipt: result.receipt, createdAt })
  }

  #receiptError(date: string, code: string, message: string): { kind: 'error'; error: ApiProblem } {
    if (code === 'AMOUNT_MISMATCH') {
      this.#deps.log({ level: 'error', code: 'DOCUMENT_MISMATCH', date })
      return problem(500, 'AMOUNT_MISMATCH', message)
    }
    if (code === 'NO_ITEMS') return problem(422, 'NO_ITEMS', message)
    return problem(400, 'INVALID_INPUT', message)
  }

  /** 한 사람 확인서 PDF·PNG (같은 확인서 데이터·같은 내장 글꼴). 이름 D-I2-01 */
  async receiptFile(sellerId: string, date: string, rehearsal: boolean, buyer: string, kind: 'pdf' | 'png'): Promise<Outcome<FileResult>> {
    const outcome = await this.receipt(sellerId, date, rehearsal, buyer)
    if (outcome.kind !== 'ok') return outcome
    const { receipt, createdAt } = outcome.value
    const font = documentFont()
    const bytes = kind === 'pdf' ? await renderReceiptPdf(receipt, font) : renderReceiptPng(receipt, font)
    const prefix = rehearsal ? '리허설-' : ''
    return ok({
      bytes,
      type: kind === 'pdf' ? MIME.pdf : MIME.png,
      fileName: `${prefix}확인서-${date}-${fileNamePart(receipt.buyerName, font)}.${kind}`,
      fallback: `${rehearsal ? 'rehearsal-' : ''}receipt-${date}.${kind}`,
      // 그 파일을 만든 확인서 데이터의 만든 시각 (E2E가 같은 데이터로 Node 그림과 맞댈 때 — harness/sprints/I2/dev-notes.md)
      headers: { 'X-Receipt-Created-At': String(createdAt) },
    })
  }

  /** 전원 확인서 PDF (renderBatchPdf — 찍힌 이름 순, 구매자마다 새 쪽). 이름 `확인서-YYYY-MM-DD-전원.pdf` */
  async batchPdf(sellerId: string, date: string, rehearsal: boolean): Promise<Outcome<FileResult>> {
    const runtime = await this.#scope(sellerId, date, rehearsal)
    if (runtime === null) return NOT_FOUND
    const shop = documentShop(await readShop(this.#deps.db, sellerId))
    const createdAt = this.#deps.clock.now()
    const result = await renderBatchPdf({ state: runtime.state, date, shop, rehearsal, createdAt }, documentFont())
    if (!result.ok) return this.#receiptError(date, result.error.code, result.error.message)
    return ok({
      bytes: result.pdf,
      type: MIME.pdf,
      fileName: `${rehearsal ? '리허설-' : ''}확인서-${date}-전원.pdf`,
      fallback: `${rehearsal ? 'rehearsal-' : ''}receipts-${date}-all.pdf`,
      headers: { 'X-Receipt-Created-At': String(createdAt), 'X-Receipt-Count': String(result.receipts.length) },
    })
  }

  // ── 판매대장 (AC-I2-20·21·33) ──────────────────────────────────────────

  /** 실제 범위들의 대장 엑셀 (배송 칸 = 그 묶음의 포장·배송 상태 말) */
  async #ledgerFile(sellerId: string, dates: readonly string[], from: string, to: string, selected: readonly string[] | null): Promise<Uint8Array> {
    const scopeList: { state: EngineState; rehearsal: false }[] = []
    const words = new Map<string, Map<string, { readonly status: PackingWord; readonly invoice: string | null }>>()
    for (const date of dates) {
      const runtime = await this.#deps.writer.read(sellerId, date, false)
      if (runtime.seq === 0 || runtime.scopeId === null) continue
      const { state, scopeId } = runtime
      scopeList.push({ state, rehearsal: false })
      words.set(date, packingStatusByBuyer(state, date, await packingRows(this.#deps.db, sellerId, scopeId)))
    }
    const result = buildLedger({
      scopes: scopeList,
      from,
      to,
      broadcasts: selected,
      shipping: (buyer, date) => {
        const word = words.get(date)?.get(buyer)
        return word === undefined ? '포장 대기' : ledgerShippingWord(word.status, word.invoice)
      },
    })
    if (!result.ok) throw new Error('대장 행을 만들지 못했다')
    return ledgerToXlsx(result.rows)
  }

  /**
   * 판매대장 엑셀 (D-I2-03): 기간(시작·끝 포함, 366일까지)과 고른 방송(없으면 전부). 그 판매자의 실제 범위만 읽는다.
   * 고른 방송이 기간 안 그 판매자의 실제 방송이 아니면(없는 것·남의 것·리허설·기간 밖) 모두 같은 문장
   */
  async ledger(sellerId: string, from: string | undefined, to: string | undefined, selected: readonly string[] | null): Promise<Outcome<FileResult>> {
    const problems: FieldProblem[] = []
    if (from === undefined || !isValidDate(from)) problems.push({ field: 'from', message: LEDGER_MESSAGES.date })
    if (to === undefined || !isValidDate(to)) problems.push({ field: 'to', message: LEDGER_MESSAGES.date })
    if (problems.length > 0 || from === undefined || to === undefined) return problem(400, 'PERIOD_INVALID', LEDGER_MESSAGES.date, problems)
    if (from > to) return problem(400, 'PERIOD_INVALID', LEDGER_MESSAGES.order, [{ field: 'from', message: LEDGER_MESSAGES.order }])
    if (daysBetween(from, to) > LEDGER_MAX_DAYS) return problem(400, 'PERIOD_INVALID', LEDGER_MESSAGES.tooLong, [{ field: 'to', message: LEDGER_MESSAGES.tooLong }])
    const real = (await listBroadcastRows(this.#deps.db, sellerId)).filter((row) => !row.rehearsal && row.date >= from && row.date <= to)
    const known = new Set(real.map((row) => row.id))
    if (selected !== null && (selected.length === 0 || selected.some((id) => !known.has(id)))) return problem(400, 'INVALID_INPUT', LEDGER_MESSAGES.broadcast, [{ field: 'b', message: LEDGER_MESSAGES.broadcast }])
    if (real.length === 0) return problem(422, 'NO_BROADCASTS', LEDGER_MESSAGES.empty)
    const picked = selected === null ? real : real.filter((row) => selected.includes(row.id))
    const dates = [...new Set(picked.map((row) => row.date))].sort()
    const bytes = await this.#ledgerFile(sellerId, dates, from, to, selected)
    const span = from === to ? from : `${from}-${to}`
    return ok({ bytes, type: MIME.xlsx, fileName: `판매대장-${span}.xlsx`, fallback: `ledger-${span}.xlsx` })
  }

  // ── 전체 내려받기 (AC-I2-64) ───────────────────────────────────────────

  /** 실제 범위 전체 기간의 판매대장 (366일 상한 없음). 실제 범위가 없으면 파일 없이 */
  async exportLedger(sellerId: string): Promise<Outcome<FileResult>> {
    const dates = (await scopeSeqs(this.#deps.db, sellerId, false)).map((row) => row.date).sort()
    const first = dates[0]
    const last = dates.at(-1)
    if (first === undefined || last === undefined) return problem(422, 'NO_RECORDS', NO_RECORDS_MESSAGE)
    const bytes = await this.#ledgerFile(sellerId, dates, first, last, null)
    const today = kstDate(this.#deps.clock.now())
    return ok({ bytes, type: MIME.xlsx, fileName: `라이브찜-판매대장-전체-${today}.xlsx`, fallback: `livejjim-ledger-all-${today}.xlsx` })
  }

  /** 판매자 전체 기록 JSON (백업과 같은 형식, gzip — D-I2-12). 기록이 없어도 빈 기록으로 만든다 */
  async exportRecords(sellerId: string): Promise<Outcome<FileResult>> {
    const now = this.#deps.clock.now()
    const bytes = encodeBackup(await buildBackup(this.#deps.db, sellerId, now))
    const today = kstDate(now)
    return ok({ bytes, type: MIME.gzip, fileName: `라이브찜-전체기록-${today}.json.gz`, fallback: `livejjim-records-${today}.json.gz` })
  }

  backupStatus(sellerId: string): Promise<BackupStatus> {
    return this.#deps.backups.status(sellerId)
  }

  // ── 포장·배송 (AC-I2-30~34) ────────────────────────────────────────────

  /** 포장 목록 (실제 범위만 — 리허설은 404) */
  async packingList(sellerId: string, date: string): Promise<{ date: string; seq: number; entries: PackingEntry[] } | null> {
    const runtime = await this.#scope(sellerId, date, false)
    if (runtime === null) return null
    const { state, seq, scopeId } = runtime
    return { date, seq, entries: packingEntries(state, date, await packingRows(this.#deps.db, sellerId, scopeId as string)) }
  }

  /** 정산 조회(날짜 보기)에 붙이는 묶음마다의 포장·배송 상태 (AC-I2-33) */
  async packingSummary(sellerId: string, date: string): Promise<{ buyer: string; status: string; invoice: string | null }[]> {
    const runtime = await this.#scope(sellerId, date, false)
    if (runtime === null) return []
    const map = packingStatusByBuyer(runtime.state, date, await packingRows(this.#deps.db, sellerId, runtime.scopeId as string))
    return [...map.entries()].map(([buyer, value]) => ({ buyer, status: value.status, invoice: value.invoice }))
  }

  /** 포장 명령 본문 검사: { requestId, buyer, action, items?(포장 완료), invoice?(배송 완료) } */
  static packingInput(body: Record<string, unknown>): { ok: true; buyer: string; action: PackingAction; items: string[]; invoice: string | null } | { ok: false; error: ApiProblem } {
    const extra = ownKeys(body).filter((key) => !['requestId', 'buyer', 'action', 'items', 'invoice'].includes(key))
    if (extra.length > 0) return { ok: false, error: { status: 400, code: 'UNKNOWN_FIELD', message: '받을 수 없는 항목이 있어요.', problems: unknownFieldProblems(extra) } }
    const action = own(body, 'action')
    if (typeof action !== 'string' || !(PACKING_ACTIONS as readonly string[]).includes(action)) {
      return { ok: false, error: { status: 400, code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [{ field: 'action', message: '할 일을 골라 주세요.' }] } }
    }
    const buyer = buyerParam(typeof own(body, 'buyer') === 'string' ? (own(body, 'buyer') as string) : undefined)
    if (!buyer.ok) return buyer
    const items = own(body, 'items')
    const invoice = own(body, 'invoice')
    let list: string[] = []
    if (action === 'pack') {
      if (!Array.isArray(items) || items.length > 2000 || !items.every((key) => typeof key === 'string' && PRODUCT_KEY_RE.test(key)) || new Set(items).size !== items.length) {
        return { ok: false, error: { status: 400, code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [{ field: 'items', message: '담은 상품을 확인해 주세요.' }] } }
      }
      list = [...(items as string[])]
    } else if (items !== undefined) {
      return { ok: false, error: { status: 400, code: 'UNKNOWN_FIELD', message: '받을 수 없는 항목이 있어요.', problems: [{ field: 'items', message: '받을 수 없는 항목이에요.' }] } }
    }
    let invoiceValue: string | null = null
    if (action === 'ship') {
      const read = readInvoice(invoice, containsPhoneRun)
      if (!read.ok) return { ok: false, error: { status: 400, code: 'INVALID_INPUT', message: read.message, problems: [{ field: 'invoice', message: read.message }] } }
      invoiceValue = read.invoice
    } else if (invoice !== undefined) {
      return { ok: false, error: { status: 400, code: 'UNKNOWN_FIELD', message: '받을 수 없는 항목이 있어요.', problems: [{ field: 'invoice', message: '받을 수 없는 항목이에요.' }] } }
    }
    return { ok: true, buyer: buyer.buyer, action: action as PackingAction, items: list, invoice: invoiceValue }
  }

  /**
   * 포장 명령 (AC-I2-31): 범위 줄 안에서 범위 락을 잡은 트랜잭션으로 검사·기록. 커밋된 뒤에만 성공·실시간 알림.
   * 같은 요청 번호면 처음 결과(그 묶음의 지금 상태, 새 기록 없음). 리허설·없는 범위 → 404
   */
  async packingCommand(
    sellerId: string,
    accountId: string,
    date: string,
    requestId: string,
    input: { buyer: string; action: PackingAction; items: readonly string[]; invoice: string | null },
  ): Promise<Outcome<{ entry: PackingEntry; recorded: boolean }>> {
    if (!isValidDate(date)) return NOT_FOUND
    const { db, writer, clock } = this.#deps
    const result = await writer.withScope(sellerId, date, false, async (runtime, catchUpIn): Promise<Outcome<{ entry: PackingEntry; recorded: boolean; buyer: string }>> => {
      if (runtime.seq === 0 || runtime.scopeId === null) return NOT_FOUND
      const scopeId = runtime.scopeId
      return db.transaction(async (tx) => {
        await catchUpIn(tx)
        const prior = await packingByRequest(tx, sellerId, requestId)
        if (prior !== null) {
          // 같은 요청 번호: 처음 기록한 묶음의 지금 상태 (그 요청이 다른 날짜면 그 날짜 범위는 여기서 읽지 않는다 — 같은 날짜만 처음 결과로 본다)
          if (prior.date !== date) return problem(409, 'REQUEST_ERROR', '이미 받은 입력이에요.')
          const rows = await packingRows(tx, sellerId, scopeId, prior.buyer)
          return ok({ entry: packingEntry(runtime.state, date, prior.buyer, rows), recorded: false, buyer: prior.buyer })
        }
        const { state } = runtime
        if (getBuyer(state, input.buyer) === null || currentBuyerOf(state, input.buyer) !== input.buyer) {
          return problem(400, 'BUYER_NOT_FOUND', PACKING_MESSAGES.buyer, [{ field: 'buyer', message: PACKING_MESSAGES.buyer }])
        }
        const rows = await packingRows(tx, sellerId, scopeId, input.buyer)
        const current = packingEntry(state, date, input.buyer, rows)
        const decision = decidePacking(replayPacking(rows), new Set(current.items.map((item) => item.key)), input.action, input.items, input.invoice)
        if (decision.kind === 'reject') return problem(409, decision.code, decision.message, [], { entry: current })
        if (decision.kind === 'same') return ok({ entry: current, recorded: false, buyer: input.buyer })
        const inserted = await tx
          .insert(packingRecords)
          .values({
            sellerId,
            scopeId,
            date,
            buyer: input.buyer,
            kind: decision.record.kind,
            items: decision.record.items === null ? null : JSON.stringify(decision.record.items),
            invoice: decision.record.invoice,
            accountId,
            requestId,
            createdAt: new Date(clock.now()),
          })
          .onConflictDoNothing({ target: [packingRecords.sellerId, packingRecords.requestId] })
          .returning({ id: packingRecords.id })
        if (inserted.length === 0) return problem(409, 'REQUEST_ERROR', '이미 받은 입력이에요.')
        const after = await packingRows(tx, sellerId, scopeId, input.buyer)
        return ok({ entry: packingEntry(state, date, input.buyer, after), recorded: true, buyer: input.buyer })
      })
    })
    if (result.kind !== 'ok') return result
    // 커밋된 뒤에만 다른 기기에 알린다 (AC-I2-32) — 값(품목·송장)은 알림에 넣지 않는다
    if (result.value.recorded) this.#deps.hub.publishNamed(sellerId, 'packing', { date, buyer: result.value.buyer })
    return ok({ entry: result.value.entry, recorded: result.value.recorded })
  }

  /** 포장 라벨 (AC-I2-34): 라벨 데이터(L-9)와 쪽마다 그림. 합쳐진 구매자 ID는 지금의 구매자로 푼다 */
  async packingLabel(sellerId: string, date: string, buyer: string): Promise<Outcome<{ buyer: string; data: PackingLabelData; pages: Uint8Array[]; pdf: () => Uint8Array | null; name: string }>> {
    const runtime = await this.#scope(sellerId, date, false)
    if (runtime === null) return NOT_FOUND
    const { state } = runtime
    const root = getBuyer(state, buyer) === null ? null : currentBuyerOf(state, buyer)
    const data = root === null ? null : packingLabelData(state, date, root)
    if (data === null) return problem(422, 'NO_ITEMS', LABEL_NO_ITEMS_MESSAGE)
    const shop = await readShop(this.#deps.db, sellerId)
    const rendered = renderPacking(data, shop.name)
    if (!rendered.ok) {
      this.#deps.log({ level: 'error', code: 'LABEL_INVALID', date })
      return problem(500, 'LABEL_INVALID', LABEL_FAILED_MESSAGE)
    }
    const pages: Uint8Array[] = []
    for (const bitmap of rendered.labels.pages) {
      const png = labelPng(bitmap)
      if (png === null) {
        this.#deps.log({ level: 'error', code: 'LABEL_INVALID', date })
        return problem(500, 'LABEL_INVALID', LABEL_FAILED_MESSAGE)
      }
      pages.push(png)
    }
    return ok({ buyer: root as string, data, pages, pdf: () => labelPdf(rendered.labels.pages), name: fileNamePart(rendered.labels.buyerText) })
  }

  // ── 지난 구매 (AC-I2-40) ───────────────────────────────────────────────

  past(sellerId: string, date: string, buyer: string, before: string | null): Promise<PastView | null> {
    if (!isValidDate(date)) return Promise.resolve(null)
    return pastPurchases({ db: this.#deps.db, read: (day) => this.#deps.writer.read(sellerId, day, false) }, sellerId, date, buyer, before)
  }

  // ── 상품 목록 가져오기 (AC-I2-51) ──────────────────────────────────────

  /** 그 방송(끝나지 않은)의 설정 스냅샷·이미 있는 번호. 끝났으면 'ended', 없으면 null */
  async #importTarget(sellerId: string, b: string): Promise<{ date: string; rehearsal: boolean; unit: string; maxNumber: number; existing: number[] } | 'ended' | null> {
    const row = await findBroadcast(this.#deps.db, sellerId, b)
    if (row === null) return null
    const runtime = await this.#deps.writer.read(sellerId, row.date, row.rehearsal)
    const broadcast = getBroadcast(runtime.state, b)
    if (broadcast === null) return null
    if (broadcast.endedAt !== null) return 'ended'
    return {
      date: row.date,
      rehearsal: row.rehearsal,
      unit: broadcast.settings['price.unit'],
      maxNumber: broadcast.settings['claim.maxNumber'],
      existing: listProducts(runtime.state)
        .filter((product) => product.broadcast === b)
        .map((product) => product.no),
    }
  }

  /** 미리 보기 본문: { text } 또는 { file: { name, data(base64) } } 하나 */
  static async importSource(body: Record<string, unknown>): Promise<{ ok: true; kind: 'text'; text: string; lines: Map<number, string> } | { ok: true; kind: 'rows'; rows: { line: number; cells: string[] }[] } | { ok: false; error: ApiProblem }> {
    const extra = ownKeys(body).filter((key) => key !== 'text' && key !== 'file')
    if (extra.length > 0) return { ok: false, error: { status: 400, code: 'UNKNOWN_FIELD', message: '받을 수 없는 항목이 있어요.', problems: unknownFieldProblems(extra) } }
    const text = own(body, 'text')
    const file = own(body, 'file')
    if ((text === undefined) === (file === undefined)) {
      return { ok: false, error: { status: 400, code: 'INVALID_INPUT', message: '붙여 넣은 글이나 파일 하나를 보내 주세요.', problems: [{ field: 'text', message: '붙여 넣은 글이나 파일 하나를 보내 주세요.' }] } }
    }
    if (text !== undefined) {
      if (typeof text !== 'string') return { ok: false, error: { status: 400, code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [{ field: 'text', message: '붙여 넣은 글을 확인해 주세요.' }] } }
      if ([...text].length > IMPORT_TEXT_MAX_CHARS) return { ok: false, error: { status: 413, code: 'PAYLOAD_TOO_LARGE', message: IMPORT_FILE_MESSAGES.textTooLong } }
      return { ok: true, kind: 'text', text, lines: new Map(splitImportLines(text).map((line) => [line.line, line.text])) }
    }
    if (!isPlainObject(file) || ownKeys(file).some((key) => key !== 'name' && key !== 'data') || typeof own(file, 'name') !== 'string' || typeof own(file, 'data') !== 'string') {
      return { ok: false, error: { status: 400, code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [{ field: 'file', message: '파일을 다시 골라 주세요.' }] } }
    }
    const kind = importFileKind(own(file, 'name') as string)
    if (kind === null) return { ok: false, error: { status: 400, code: 'FILE_TYPE', message: IMPORT_FILE_MESSAGES.type, problems: [{ field: 'file', message: IMPORT_FILE_MESSAGES.type }] } }
    const data = own(file, 'data') as string
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return { ok: false, error: { status: 400, code: 'FILE_UNREADABLE', message: IMPORT_FILE_MESSAGES.unreadable } }
    const bytes = new Uint8Array(Buffer.from(data, 'base64'))
    if (bytes.byteLength > IMPORT_FILE_MAX_BYTES) return { ok: false, error: { status: 413, code: 'FILE_TOO_LARGE', message: IMPORT_FILE_MESSAGES.tooLarge, problems: [{ field: 'file', message: IMPORT_FILE_MESSAGES.tooLarge }] } }
    if (kind === 'text') {
      const decoded = decodeTextFile(bytes)
      return { ok: true, kind: 'text', text: decoded, lines: new Map(splitImportLines(decoded).map((line) => [line.line, line.text])) }
    }
    const rows = await readXlsxRows(bytes)
    if (rows === null) return { ok: false, error: { status: 400, code: 'FILE_UNREADABLE', message: IMPORT_FILE_MESSAGES.unreadable, problems: [{ field: 'file', message: IMPORT_FILE_MESSAGES.unreadable }] } }
    return { ok: true, kind: 'rows', rows: rows.map((row) => ({ line: row.line, cells: [...row.cells] })) }
  }

  /** 미리 보기 (기록하지 않는다): R-18 결과 + 줄마다 원래 줄 글 + 등록할 줄 수·문제 줄 수 */
  async importPreview(sellerId: string, b: string, body: Record<string, unknown>): Promise<Outcome<ImportPreview>> {
    const target = await this.#importTarget(sellerId, b)
    if (target === null) return NOT_FOUND
    if (target === 'ended') return problem(409, 'BROADCAST_ENDED', IMPORT_ENDED_MESSAGE)
    const source = await ClosingService.importSource(body)
    if (!source.ok) return { kind: 'error', error: source.error }
    const settings = { unit: target.unit, maxNumber: target.maxNumber, existing: target.existing }
    const result: ImportResult = source.kind === 'text' ? parseProductList(source.text, settings) : parseProductRows(source.rows, settings)
    if ('error' in result) return ok({ broadcast: b, unit: target.unit, maxNumber: target.maxNumber, error: result.error, header: null, headerCells: null, rows: [], register: 0, problems: 0 })
    const sheet = source.kind === 'rows' ? new Map(source.rows.map((row) => [row.line, row.cells])) : null
    const lineText = (line: number): string => (sheet === null ? (source.kind === 'text' ? (source.lines.get(line) ?? '') : '') : (sheet.get(line)?.join('\t') ?? ''))
    // 머리글 칸: 해석기와 같은 칸 나누기(따옴표 포함)·정규화
    const headerCells =
      result.header === null ? null : (sheet === null ? (splitCells(lineText(result.header)) ?? [lineText(result.header)]) : (sheet.get(result.header) ?? [])).map((cell) => normalizeText(cell))
    const rows = result.rows.map((row) => ({ ...row, text: lineText(row.line) }))
    const register = result.rows.filter((row) => !('error' in row)).length
    return ok({ broadcast: b, unit: target.unit, maxNumber: target.maxNumber, error: null, header: result.header, headerCells, rows, register, problems: result.rows.length - register })
  }

  /** 등록 본문 검사: rows = [{ no, name, price }] 1~500개 (미리 보기에서 본 등록할 값) */
  static importRows(body: Record<string, unknown>): { ok: true; rows: RegisterRow[] } | { ok: false; error: ApiProblem } {
    const extra = ownKeys(body).filter((key) => key !== 'requestId' && key !== 'rows')
    if (extra.length > 0) return { ok: false, error: { status: 400, code: 'UNKNOWN_FIELD', message: '받을 수 없는 항목이 있어요.', problems: unknownFieldProblems(extra) } }
    const rows = own(body, 'rows')
    const invalid = (message: string): { ok: false; error: ApiProblem } => ({ ok: false, error: { status: 400, code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [{ field: 'rows', message }] } })
    if (!Array.isArray(rows) || rows.length === 0) return invalid('등록할 상품을 하나 이상 보내 주세요.')
    if (rows.length > IMPORT_MAX_ROWS) return invalid('한 번에 500개까지 가져올 수 있어요.')
    const out: RegisterRow[] = []
    for (const row of rows as unknown[]) {
      if (!isPlainObject(row) || ownKeys(row).length !== 3) return invalid('등록할 상품을 확인해 주세요.')
      const no = own(row, 'no')
      const name = own(row, 'name')
      const price = own(row, 'price')
      if (typeof no !== 'number' || !Number.isSafeInteger(no) || typeof price !== 'number' || !Number.isSafeInteger(price) || !isNormalizedName(name)) return invalid('등록할 상품을 확인해 주세요.')
      out.push({ no, name, price })
    }
    return { ok: true, rows: out }
  }

  /**
   * 등록 (R-18 11): 그 순간 그 방송의 상태로 줄들을 다시 검사해 모두 통과하면 한 트랜잭션에 줄 순서대로 product.register(READY).
   * 하나라도 문제면 아무것도 기록하지 않는다(IMPORT_CHANGED). 같은 요청 번호면 처음 결과
   */
  async importRegister(sellerId: string, actor: Actor, b: string, requestId: string, rows: readonly RegisterRow[]): Promise<Outcome<{ registered: number; seq: number }>> {
    const row = await findBroadcast(this.#deps.db, sellerId, b)
    if (row === null) return NOT_FOUND
    const outcome: WriteOutcome = await this.#deps.writer.write({
      sellerId,
      date: row.date,
      rehearsal: row.rehearsal,
      createScope: false,
      requestId,
      build: (ctx) => {
        const broadcast = getBroadcast(ctx.state, b)
        if (broadcast === null) return { status: 404, code: 'NOT_FOUND', message: '찾을 수 없어요.', problems: [] }
        if (broadcast.endedAt !== null) return { status: 409, code: 'BROADCAST_ENDED', message: IMPORT_ENDED_MESSAGE, problems: [] }
        const existing = listProducts(ctx.state)
          .filter((product) => product.broadcast === b)
          .map((product) => product.no)
        const errors = recheckRows(rows, { unit: broadcast.settings['price.unit'], maxNumber: broadcast.settings['claim.maxNumber'], existing })
        const changed = errors.flatMap((error, index) => (error === null ? [] : [{ field: `rows.${String(index)}`, message: IMPORT_CHANGED_MESSAGE }]))
        if (changed.length > 0) return { status: 409, code: 'IMPORT_CHANGED', message: IMPORT_CHANGED_MESSAGE, problems: changed }
        return rows.map((item, index) => ({
          fields: { type: 'product.register', b, no: item.no, name: item.name, price: item.price, status: 'READY' },
          actor,
          ...(index === 0 ? { requestId } : {}),
        }))
      },
    })
    switch (outcome.kind) {
      case 'ok':
        return ok({ registered: outcome.records.length, seq: outcome.result.seq })
      case 'duplicate':
        return outcome.result === null ? problem(409, 'REQUEST_ERROR', '이미 받은 입력이에요.') : ok(await this.#priorImport(sellerId, outcome.result.date, outcome.result.rehearsal, outcome.result.seq))
      case 'rejected':
        return problem(outcome.rejection.status, outcome.rejection.code, outcome.rejection.message, outcome.rejection.problems)
      case 'not_found':
        return NOT_FOUND
      case 'save_failed':
        return problem(500, 'SAVE_FAILED', '저장하지 못했어요. 다시 시도해 주세요.')
    }
  }

  /** 같은 요청 번호로 이미 등록한 수: 그 요청의 첫 이벤트부터 같은 트랜잭션(같은 도착 시각)에 이어 적힌 product.register 수 */
  async #priorImport(sellerId: string, date: string, rehearsal: boolean, seq: number): Promise<{ registered: number; seq: number }> {
    const runtime = await this.#deps.writer.read(sellerId, date, rehearsal)
    if (runtime.scopeId === null) return { registered: 0, seq }
    const rows = await this.#deps.db
      .select({ seq: events.seq, type: events.type, receivedAt: events.receivedAt, requestId: events.requestId })
      .from(events)
      .where(and(eq(events.sellerId, sellerId), eq(events.scopeId, runtime.scopeId), gte(events.seq, seq), sql`${events.seq} < ${seq + IMPORT_MAX_ROWS}`))
      .orderBy(asc(events.seq))
    const first = rows[0]
    if (first === undefined || first.type !== 'product.register') return { registered: 0, seq }
    let count = 0
    for (const [index, row] of rows.entries()) {
      if (row.seq !== seq + index || row.type !== 'product.register' || row.receivedAt.getTime() !== first.receivedAt.getTime() || (index > 0 && row.requestId !== null)) break
      count++
    }
    return { registered: count, seq }
  }
}

/** 미리 보기 응답 (POST /api/broadcasts/:id/import/preview) */
export interface ImportPreview {
  readonly broadcast: string
  readonly unit: string
  readonly maxNumber: number
  /** 전체 문제 (EMPTY·TOO_MANY) — 있으면 rows는 비어 있다 */
  readonly error: 'EMPTY' | 'TOO_MANY' | null
  readonly header: number | null
  /** 머리글로 본 줄의 칸 (화면 "머리글로 보고 뺀 줄: 1번 줄 (번호, 품종, 가격)") */
  readonly headerCells: readonly string[] | null
  /** R-18 줄 결과 + 원래 줄 글(text) */
  readonly rows: readonly (({ line: number; no: number; name: string; price: number } | { line: number; error: string }) & { text: string })[]
  readonly register: number
  readonly problems: number
}
