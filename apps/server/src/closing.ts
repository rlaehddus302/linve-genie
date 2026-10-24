// 정산 마무리 작업 (I2 — STL-04·05·06·08·10, BUY-05, PRD-05, DAT-03·04, D-I2-01~D-I2-13).
// 판정·정산은 모두 packages/core가 하고, 문서는 packages/documents·packages/label이 만든다 — 여기서는 범위 상태를 읽어 넘기고 기록을 덧붙인다.
// - 가게 설정, 확인서(데이터·PDF·PNG·전원 PDF), 판매대장 엑셀, 포장·배송(상태·명령·라벨), 지난 구매, 상품 목록 가져오기(미리 보기·등록), 백업 상태, 전체 내려받기.
// - 판매자 ID 조건은 늘 세션의 판매자다. 없는 범위·다른 판매자의 자원은 404(있는지 드러내지 않는다).
// - 문서·파일 내용, 파일 이름, 송장번호, 가게 설정 값, 가져오기 글은 로그에 남기지 않는다(로그는 정해진 코드·날짜뿐).
import { containsPhoneRun, currentBuyerOf, getBroadcast, getBuyer, isValidDate, listBroadcasts, listProducts, listSettlements, looksLikePhoneId, normalizeText, type EngineState } from '@livejjim/core'
import { buildLedger, buildReceipt, buildReceipts, compareCodePoints, printedName, type ReceiptData } from '@livejjim/documents'
import type { PackingLabelData } from '@livejjim/label'
import { and, asc, eq, gte, sql } from 'drizzle-orm'
import { hasControlChar, isPlainObject, own, ownKeys } from './api-fields.ts'
import { createBackupBytes, type BackupScheduler, type BackupStatus } from './backup.ts'
import type { Db } from './db/database.ts'
import { events, packingRecords } from './db/schema.ts'
import type { ErrorCode, FieldProblem } from './errors.ts'
import { MIME, documentFont, fileNamePart } from './files.ts'
import type { StreamHub } from './hub.ts'
import { IMPORT_FILE_MAX_BYTES, IMPORT_FILE_MESSAGES, IMPORT_REGISTER_BODY_LIMIT_BYTES, IMPORT_TEXT_MAX_CHARS, decodeTextFile, importFileKind, importRegisterBodyBytes, type XlsxReadResult } from './import-files.ts'
import { AMOUNT_MISSING_MESSAGE, MissingAmountError } from './amount.ts'
import type { LogSink } from './log.ts'
import { phoneIdProblem, unknownFieldProblems } from './messages.ts'
import { servedTemplate } from './print.ts'
import {
  PACKING_ACTIONS,
  PACKING_MESSAGES,
  decidePacking,
  packedItemsJson,
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
  readSentItem,
  renderPacking,
  replayPacking,
  type PackingAction,
  type PackingEntry,
  type PackingWord,
  type SentItem,
} from './packing.ts'
import { PARCEL_MESSAGES } from './parcel/rules.ts'
import { hasLiveAttempt } from './parcel/store.ts'
import { pastPurchases, type PastView } from './past.ts'
import { LEDGER_UNREADABLE_MESSAGE, readSealed } from './sealed-state.ts'
import { IMPORT_MAX_ROWS, isNormalizedName, parseProductList, parseProductRows, recheckRows, splitCells, splitImportLines, type ImportResult, type RegisterRow } from './product-import.ts'
import { emptyState, type ScopeRuntime } from './runtime.ts'
import { checkShopInput, checkShopName, documentShop, readShop, writeShop, type ShopView } from './shop.ts'
import { findBroadcast, listBroadcastRows, scopeSeqs } from './store.ts'
import { kstDate, type Clock } from './time.ts'
import { WorkBusy, WorkFailed, type LedgerChunk, type WorkPools } from './work-pool.ts'
import { uniqueNames } from './zip.ts'
import { SEALED_MESSAGE, type Actor, type Rejection, type ScopeWriter, type WriteOutcome } from './writer.ts'
import { scopeSealedAt } from './store.ts'
import { SERVICE_FILE_PREFIX, SERVICE_NAME } from './brand.ts'

export interface ClosingDeps {
  readonly db: Db
  readonly writer: ScopeWriter
  readonly clock: Clock
  readonly hub: StreamHub
  readonly backups: BackupScheduler
  readonly log: LogSink
  /** 무거운 파일 작업을 맡길 워커 풀 (RA-I2-003 — 확인서 그림·PDF·전원 PDF·판매대장 엑셀·.xlsx 읽기는 판정과 다른 스레드에서) */
  readonly work: WorkPools
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
/** 그 판매자의 파일 작업이 밀려 있음 (판매자마다 동시 작업 상한·줄 길이 상한 — RA-I2-003) */
export const WORK_BUSY_MESSAGE = '지금 다른 파일을 만들고 있어요. 잠시 뒤 다시 눌러 주세요.'
/** 워커가 파일을 만들지 못함 (시간·메모리 상한 등) */
export const WORK_FAILED_MESSAGE = '파일을 만들지 못했어요. 잠시 뒤 다시 눌러 주세요.'
const BUYER_ID_MAX = 128

/** 요청이 끊기면 아직 시작하지 않은 작업을 뺀다 */
const signalOf = (signal: AbortSignal | undefined): { signal?: AbortSignal } => (signal === undefined ? {} : { signal })

/** 범위 상태의 방송 ID (선언 순) */
const listBroadcastIds = (state: EngineState): string[] => listBroadcasts(state).map((broadcast) => broadcast.id)

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
  /** 전체 기록을 만드는 중인 판매자 */
  readonly #exporting = new Set<string>()

  constructor(deps: ClosingDeps) {
    this.#deps = deps
  }

  /** 범위 상태 (없는 범위면 null) */
  async #scope(sellerId: string, date: string, rehearsal: boolean): Promise<ScopeRuntime | null> {
    if (!isValidDate(date)) return null
    const runtime = await this.#deps.writer.read(sellerId, date, rehearsal)
    return runtime.seq === 0 || runtime.scopeId === null ? null : runtime
  }

  /**
   * 문서를 만들 범위 상태 (PL1A D-I2-22 (2)·D-PL1-04): 봉인 안 한 범위는 범위 상태 그대로, 30일 봉인 범위는 봉인 장부로 다시 세운 조회용 상태(sealed-state.ts).
   * 장부를 읽을 수 없으면 500 LEDGER_UNREADABLE(오류 로그 — 코드·날짜만). 없는 범위는 not_found
   */
  async #docScope(sellerId: string, date: string, rehearsal: boolean): Promise<Outcome<{ runtime: ScopeRuntime; state: EngineState; sealed: boolean }>> {
    const runtime = await this.#scope(sellerId, date, rehearsal)
    if (runtime === null) return NOT_FOUND
    if (rehearsal) return ok({ runtime, state: runtime.state, sealed: false })
    const read = await readSealed(this.#deps.db, sellerId, date)
    if (!read.sealed) return ok({ runtime, state: runtime.state, sealed: false })
    if (read.state === null) return this.#unreadable(date)
    return ok({ runtime, state: read.state, sealed: true })
  }

  #unreadable(date: string): { kind: 'error'; error: ApiProblem } {
    this.#deps.log({ level: 'error', code: 'LEDGER_UNREADABLE', date })
    return problem(500, 'LEDGER_UNREADABLE', LEDGER_UNREADABLE_MESSAGE)
  }

  /** 봉인한 날짜(실제 범위)인가 — 쓰기 요청(포장·배송)의 409 SEALED (D-I2-22 (3)) */
  static sealedProblem(): { kind: 'error'; error: ApiProblem } {
    return problem(409, 'SEALED', SEALED_MESSAGE)
  }

  // ── 가게 설정 (AC-I2-01) ───────────────────────────────────────────────

  shop(sellerId: string): Promise<ShopView> {
    return readShop(this.#deps.db, sellerId)
  }

  async updateShop(sellerId: string, body: unknown): Promise<{ ok: true; shop: ShopView } | { ok: false; rejection: Rejection }> {
    // 지금 이름 그대로면 길이를 다시 따지지 않는다 (계정 만들기가 받은 긴 이름 — SA-I2-006)
    const checked = checkShopInput(body, (await readShop(this.#deps.db, sellerId)).name)
    if (!checked.ok) return checked
    await writeShop(this.#deps.db, sellerId, checked.value)
    // 다른 기기 화면이 확인서 미리 보기를 새로 받는다 (AC-I2-13) — 값은 알림에 넣지 않는다
    this.#deps.hub.publishNamed(sellerId, 'shop', {})
    return { ok: true, shop: await readShop(this.#deps.db, sellerId) }
  }

  /**
   * 가게 이름만 바꾸기 (PUT /api/shop { name } — I3 AC-I3-47 시작 마법사·가게 이름 칸). 상한은 가게 설정과 같다(checkShopName).
   * 틀리면 null. 다른 기기 화면이 확인서 미리 보기를 새로 받게 가게 설정 알림을 보낸다 (AC-I2-13)
   */
  async renameShop(sellerId: string, raw: unknown): Promise<string | null> {
    const current = await readShop(this.#deps.db, sellerId)
    const name = checkShopName(raw, current.name)
    if (name === null) return null
    await writeShop(this.#deps.db, sellerId, { ...current, name })
    this.#deps.hub.publishNamed(sellerId, 'shop', {})
    return name
  }

  // ── 확인서 (AC-I2-10·11·12) ────────────────────────────────────────────

  /**
   * 한 사람 확인서 데이터: 그 범위의 지금 엔진 상태·가게 설정·리허설 여부·서버 시계의 지금 시각으로 buildReceipt.
   * 품목이 없는 묶음·모르는 구매자 → NO_ITEMS(422), 줄 합 ≠ 코어 합계 → AMOUNT_MISMATCH(500, 경보)
   */
  async receipt(sellerId: string, date: string, rehearsal: boolean, buyer: string, at?: number): Promise<Outcome<{ receipt: ReceiptData; createdAt: number }>> {
    const scope = await this.#docScope(sellerId, date, rehearsal)
    if (scope.kind !== 'ok') return scope
    const { state } = scope.value
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

  /** 한 사람 확인서 PDF·PNG·JPG (같은 확인서 데이터·같은 내장 글꼴 — JPG는 PNG와 같은 그림, N4b D-N4b-03). 이름 D-I2-01 */
  async receiptFile(sellerId: string, date: string, rehearsal: boolean, buyer: string, kind: ReceiptFileKind, signal?: AbortSignal): Promise<Outcome<FileResult>> {
    const outcome = await this.receipt(sellerId, date, rehearsal, buyer)
    if (outcome.kind !== 'ok') return outcome
    return this.renderReceiptFile(sellerId, date, rehearsal, outcome.value.receipt, outcome.value.createdAt, kind, signal)
  }

  /** 확인서 데이터 하나 → 파일 (작업 워커 — 받은 확인서 데이터 그대로). 구매자 확인서 링크 화면(N4b)도 쓴다 */
  async renderReceiptFile(sellerId: string, date: string, rehearsal: boolean, receipt: ReceiptData, createdAt: number, kind: ReceiptFileKind, signal?: AbortSignal): Promise<Outcome<FileResult>> {
    const font = documentFont()
    const pool = this.#deps.work.receipts
    // 그리기는 작업 워커에서 (같은 확인서 데이터·같은 내장 글꼴 — 바이트가 같다, AC-I2-15)
    const rendered = await this.#work(sellerId, date, () =>
      kind === 'pdf'
        ? pool.run<Uint8Array>(sellerId, 'receiptPdf', { receipts: [receipt] }, signalOf(signal))
        : pool.run<Uint8Array>(sellerId, kind === 'png' ? 'receiptPng' : 'receiptJpg', { receipt }, signalOf(signal)),
    )
    if (rendered.kind !== 'ok') return rendered
    const bytes = rendered.value
    const prefix = rehearsal ? '리허설-' : ''
    return ok({
      bytes,
      type: MIME[kind],
      fileName: `${prefix}확인서-${date}-${fileNamePart(receipt.buyerName, font)}.${kind}`,
      fallback: `${rehearsal ? 'rehearsal-' : ''}receipt-${date}.${kind}`,
      // 그 파일을 만든 확인서 데이터의 만든 시각 (E2E가 같은 데이터로 Node 그림과 맞댈 때 — harness/sprints/I2/dev-notes.md)
      headers: { 'X-Receipt-Created-At': String(createdAt) },
    })
  }

  /**
   * 일괄 순서의 구매자 (D-I2-04 — buildReceipts와 같은 순서): 그 날짜에 품목이 있는 묶음(지금의 구매자)을 확인서에 찍힌 이름의 코드 포인트 순, 같으면 구매자 ID 순
   */
  static batchOrder(state: EngineState, date: string): string[] {
    const font = documentFont()
    return listSettlements(state)
      .filter((settlement) => settlement.date === date && settlement.items.length > 0)
      .map((settlement) => ({ id: settlement.buyer, printed: printedName(getBuyer(state, settlement.buyer)?.display ?? '', (text) => font.sanitize(text)) }))
      .sort((a, b) => compareCodePoints(a.printed, b.printed) || compareCodePoints(a.id, b.id))
      .map((row) => row.id)
  }

  /**
   * 영수증 보내기 화면의 구매자 줄 (N4b AC-N4b-32): 품목 있는 묶음마다 확인서 데이터의 이름·끝자리·상품 수·최종 금액·입금 상태·남은 금액, 일괄 순서.
   * 리허설 범위도 된다. 없는 범위면 not_found, 품목 있는 묶음이 없으면 빈 목록
   */
  async receiptBuyers(sellerId: string, date: string, rehearsal: boolean): Promise<Outcome<{ state: EngineState; rows: ReceiptBuyerRow[] }>> {
    const scope = await this.#docScope(sellerId, date, rehearsal)
    if (scope.kind !== 'ok') return scope
    const { state } = scope.value
    const shop = documentShop(await readShop(this.#deps.db, sellerId))
    const createdAt = this.#deps.clock.now()
    const font = documentFont()
    const rows: ReceiptBuyerRow[] = []
    for (const buyer of ClosingService.batchOrder(state, date)) {
      const result = buildReceipt({ state, buyer, date, shop, rehearsal, createdAt })
      if (!result.ok) return this.#receiptError(date, result.error.code, result.error.message)
      const receipt = result.receipt
      rows.push({
        buyer,
        name: printedName(receipt.buyerName, (text) => font.sanitize(text)),
        phoneLast4: receipt.phoneLast4,
        itemCount: receipt.itemCount,
        total: receipt.total,
        payment: receipt.payment,
        received: receipt.received,
        remaining: receipt.remaining,
      })
    }
    return ok({ state, rows })
  }

  /**
   * 전원 확인서 PDF (문서 패키지 renderBatchPdf와 같은 결과 — buildReceipts(찍힌 이름 순) → renderReceiptsPdf, 구매자마다 새 쪽). 이름 `확인서-YYYY-MM-DD-전원.pdf`.
   * 확인서 데이터는 여기서 만들고(범위 상태를 워커로 복제하지 않는다) PDF 그리기만 작업 워커에서 한다
   */
  async batchPdf(sellerId: string, date: string, rehearsal: boolean, signal?: AbortSignal): Promise<Outcome<FileResult>> {
    const scope = await this.#docScope(sellerId, date, rehearsal)
    if (scope.kind !== 'ok') return scope
    const shop = documentShop(await readShop(this.#deps.db, sellerId))
    const createdAt = this.#deps.clock.now()
    const result = buildReceipts({ state: scope.value.state, date, shop, rehearsal, createdAt }, documentFont())
    if (!result.ok) return this.#receiptError(date, result.error.code, result.error.message)
    const rendered = await this.#work(sellerId, date, () => this.#deps.work.documents.run<Uint8Array>(sellerId, 'receiptPdf', { receipts: result.receipts }, signalOf(signal)))
    if (rendered.kind !== 'ok') return rendered
    return ok({
      bytes: rendered.value,
      type: MIME.pdf,
      fileName: `${rehearsal ? '리허설-' : ''}확인서-${date}-전원.pdf`,
      fallback: `${rehearsal ? 'rehearsal-' : ''}receipts-${date}-all.pdf`,
      headers: { 'X-Receipt-Created-At': String(createdAt), 'X-Receipt-Count': String(result.receipts.length) },
    })
  }

  /**
   * 전원 이미지 묶음 ZIP (N4b AC-N4b-02, D-N4b-03): 전원 PDF와 같은 확인서 데이터·같은 일괄 순서(buildReceipts), 묶음마다 JPG 하나
   * `확인서-YYYY-MM-DD-<이름>.jpg`(겹치면 `-2`…). 모든 확인서의 만든 시각은 요청 때 서버 시각 하나. 그리기·묶기는 작업 워커에서
   */
  async batchJpgZip(sellerId: string, date: string, rehearsal: boolean, signal?: AbortSignal): Promise<Outcome<FileResult>> {
    const scope = await this.#docScope(sellerId, date, rehearsal)
    if (scope.kind !== 'ok') return scope
    const shop = documentShop(await readShop(this.#deps.db, sellerId))
    const createdAt = this.#deps.clock.now()
    const font = documentFont()
    const result = buildReceipts({ state: scope.value.state, date, shop, rehearsal, createdAt }, font)
    if (!result.ok) return this.#receiptError(date, result.error.code, result.error.message)
    const prefix = rehearsal ? '리허설-' : ''
    const names = uniqueNames(result.receipts.map((receipt) => `${prefix}확인서-${date}-${fileNamePart(receipt.buyerName, font)}.jpg`))
    const entries = result.receipts.map((receipt, index) => ({ name: names[index] as string, receipt }))
    const rendered = await this.#work(sellerId, date, () => this.#deps.work.documents.run<Uint8Array>(sellerId, 'receiptJpgZip', { entries, modifiedAt: createdAt }, signalOf(signal)))
    if (rendered.kind !== 'ok') return rendered
    return ok({
      bytes: rendered.value,
      type: MIME.zip,
      fileName: `${prefix}확인서-${date}-전원-이미지.zip`,
      fallback: `${rehearsal ? 'rehearsal-' : ''}receipts-${date}-images.zip`,
      headers: { 'X-Receipt-Created-At': String(createdAt), 'X-Receipt-Count': String(result.receipts.length) },
    })
  }

  // ── 판매대장 (AC-I2-20·21·33) ──────────────────────────────────────────

  /**
   * 실제 범위들의 대장 행 — 날짜마다 그 범위 하나로 buildLedger (배송 칸 = 그 묶음의 포장·배송 상태 말).
   * 범위마다 방송 날짜 = 범위 날짜라, 날짜 순으로 이어 붙인 행 = 여러 범위를 한 번에 넘긴 buildLedger의 행(방송 날짜 → 선언 순 → 번호 → 확정 순)이다.
   * 범위 상태를 한꺼번에 메모리에 두지 않고, 날짜 사이마다 이벤트 루프에 차례를 넘긴다 (RA-I2-003).
   * 날짜마다 범위 상태는 공용 캐시에 넣지 않는 읽기(readDetached)로 불러온다 — 전체 판매대장이 방송 중인 다른 판매자의 범위 상태를 밀어내지 않는다 (TD-I2-008)
   */
  async *#ledgerRows(sellerId: string, dates: readonly string[], from: string, to: string, selected: readonly string[] | null): AsyncGenerator<LedgerChunk> {
    for (const date of dates) {
      const runtime = await this.#deps.writer.readDetached(sellerId, date, false)
      if (runtime.seq === 0 || runtime.scopeId === null) continue
      const { scopeId } = runtime
      // 봉인한 날짜는 봉인 장부로 다시 세운 상태 (D-PL1-04 — 읽을 수 없는 장부는 파일을 만들기 전에 #sealedDates가 거절했다)
      const sealed = await readSealed(this.#deps.db, sellerId, date)
      if (sealed.sealed && sealed.state === null) throw new Error('봉인 장부를 읽지 못했다')
      const state = sealed.sealed ? (sealed.state as EngineState) : runtime.state
      const words: Map<string, { readonly status: PackingWord; readonly invoice: string | null }> = packingStatusByBuyer(state, date, await packingRows(this.#deps.db, sellerId, scopeId))
      const own = selected === null ? null : listBroadcastIds(state).filter((id) => selected.includes(id))
      if (own !== null && own.length === 0) continue
      const result = buildLedger({
        scopes: [{ state, rehearsal: false }],
        from,
        to,
        broadcasts: own,
        shipping: (buyer) => {
          const word = words.get(buyer)
          return word === undefined ? '포장 대기' : ledgerShippingWord(word.status, word.invoice)
        },
      })
      if (!result.ok) throw new Error('대장 행을 만들지 못했다')
      // 봉인한 날짜의 "찜 시각" 칸은 빈칸 (D-PL1-03 — 장부 판 /2에 찜 시각이 없다. 확정 시각·다른 시각으로 채우지 않는다)
      const rows = sealed.sealed ? result.rows.map((row) => ({ ...row, claimedAt: '' })) : [...result.rows]
      // 열 모양(D-O3-07): 날짜 중 하나라도 옵션 방송을 담으면 대장 전체가 옵션·수량·단가 열 — 워커가 조각마다의 options를 OR로 모은다
      yield { rows, options: result.options }
    }
  }

  /**
   * 대장 엑셀 바이트 (엑셀 쓰기는 작업 워커에서 — 행은 날짜마다 조각으로 보낸다).
   * 든 날짜 중 봉인한 날짜의 장부를 읽을 수 없으면 파일 전체를 만들지 않는다(500 LEDGER_UNREADABLE — 그 날짜가 빠진 대장을 주지 않는다, D-PL1-04)
   */
  async #ledgerFile(sellerId: string, dates: readonly string[], from: string, to: string, selected: readonly string[] | null, signal?: AbortSignal): Promise<Outcome<Uint8Array>> {
    for (const date of dates) {
      const sealed = await readSealed(this.#deps.db, sellerId, date)
      if (sealed.sealed && sealed.state === null) return this.#unreadable(date)
    }
    return this.#work(sellerId, to, () => this.#deps.work.documents.run<Uint8Array>(sellerId, 'ledgerXlsx', null, { chunks: this.#ledgerRows(sellerId, dates, from, to, selected), ...signalOf(signal) }))
  }

  /** 작업 워커에 맡기기: 밀려 있으면 429(쉬운 문장), 워커가 못 끝내면 500(경보 — 판매자 ID·까닭 종류·날짜만) */
  async #work<T>(sellerId: string, date: string | null, task: () => Promise<T>): Promise<Outcome<T>> {
    try {
      return ok(await task())
    } catch (error) {
      if (error instanceof WorkBusy) return problem(429, 'BUSY', WORK_BUSY_MESSAGE)
      if (error instanceof WorkFailed) {
        this.#deps.log({ level: error.reason === 'aborted' ? 'info' : 'error', code: 'DOCUMENT_WORK_FAILED', seller: sellerId, ...(date === null ? {} : { date }), errorKind: error.reason })
        return problem(500, 'FILE_FAILED', WORK_FAILED_MESSAGE)
      }
      throw error
    }
  }

  /**
   * 판매대장 엑셀 (D-I2-03): 기간(시작·끝 포함, 366일까지)과 고른 방송(없으면 전부). 그 판매자의 실제 범위만 읽는다.
   * 고른 방송이 기간 안 그 판매자의 실제 방송이 아니면(없는 것·남의 것·리허설·기간 밖) 모두 같은 문장
   */
  async ledger(sellerId: string, from: string | undefined, to: string | undefined, selected: readonly string[] | null, signal?: AbortSignal): Promise<Outcome<FileResult>> {
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
    const file = await this.#ledgerFile(sellerId, dates, from, to, selected, signal)
    if (file.kind !== 'ok') return file
    const span = from === to ? from : `${from}-${to}`
    return ok({ bytes: file.value, type: MIME.xlsx, fileName: `판매대장-${span}.xlsx`, fallback: `ledger-${span}.xlsx` })
  }

  // ── 전체 내려받기 (AC-I2-64) ───────────────────────────────────────────

  /** 실제 범위 전체 기간의 판매대장 (366일 상한 없음). 실제 범위가 없으면 파일 없이 */
  async exportLedger(sellerId: string, signal?: AbortSignal): Promise<Outcome<FileResult>> {
    const dates = (await scopeSeqs(this.#deps.db, sellerId, false)).map((row) => row.date).sort()
    const first = dates[0]
    const last = dates.at(-1)
    if (first === undefined || last === undefined) return problem(422, 'NO_RECORDS', NO_RECORDS_MESSAGE)
    const file = await this.#ledgerFile(sellerId, dates, first, last, null, signal)
    if (file.kind !== 'ok') return file
    const bytes = file.value
    const today = kstDate(this.#deps.clock.now())
    return ok({ bytes, type: MIME.xlsx, fileName: `${SERVICE_NAME}-판매대장-전체-${today}.xlsx`, fallback: `${SERVICE_FILE_PREFIX}-ledger-all-${today}.xlsx` })
  }

  /** 판매자 전체 기록 JSON (백업과 같은 형식, gzip — D-I2-12). 기록이 없어도 빈 기록으로 만든다 */
  async exportRecords(sellerId: string): Promise<Outcome<FileResult>> {
    const now = this.#deps.clock.now()
    // 판매자마다 한 번에 하나 (같은 판매자가 여러 번 눌러도 서버 일이 쌓이지 않게 — RA-I2-003)
    if (this.#exporting.has(sellerId)) return problem(429, 'BUSY', WORK_BUSY_MESSAGE)
    this.#exporting.add(sellerId)
    let bytes: Uint8Array
    try {
      // 글 조각을 gzip 스트림에 이어 쓴다 — 전체 역사를 글 하나로 만들지 않고, 이벤트 묶음 사이에 판정 요청이 끼어든다 (RA-I2-003·005)
      bytes = await createBackupBytes(this.#deps.db, sellerId, now)
    } finally {
      this.#exporting.delete(sellerId)
    }
    const today = kstDate(now)
    return ok({ bytes, type: MIME.gzip, fileName: `${SERVICE_NAME}-전체기록-${today}.json.gz`, fallback: `${SERVICE_FILE_PREFIX}-records-${today}.json.gz` })
  }

  backupStatus(sellerId: string): Promise<BackupStatus> {
    return this.#deps.backups.status(sellerId)
  }

  // ── 포장·배송 (AC-I2-30~34) ────────────────────────────────────────────

  /**
   * 포장 목록 (실제 범위만 — 리허설은 404). 봉인한 날짜는 봉인 장부와 포장 기록으로 같은 규칙대로 만들고 `sealed: true`를 더한다
   * (봉인 안 한 날짜는 sealed 칸이 없다 — BASE 응답 그대로, D-PL1-04). 장부를 읽을 수 없으면 500 LEDGER_UNREADABLE
   */
  async packingList(sellerId: string, date: string): Promise<Outcome<{ date: string; seq: number; entries: PackingEntry[]; sealed?: true }>> {
    const scope = await this.#docScope(sellerId, date, false)
    if (scope.kind !== 'ok') return scope
    const { runtime, state, sealed } = scope.value
    const records = await packingRows(this.#deps.db, sellerId, runtime.scopeId as string)
    // 찜 금액이 없는 확정 찜이 있으면 목록을 만들지 않는다(서버 오류, D-O3-15) — 찜 ID만 남기고 다시 던진다
    const entries = this.#amountGuard(date, () => packingEntries(state, date, records))
    return ok({ date, seq: runtime.seq, entries, ...(sealed ? { sealed: true as const } : {}) })
  }

  /** 찜 금액이 없는 확정 찜(MissingAmountError)이면 찜 ID만 남기고 그대로 던진다 (D-O3-15) */
  #amountGuard<T>(date: string, make: () => T): T {
    try {
      return make()
    } catch (error) {
      if (error instanceof MissingAmountError) this.#deps.log({ level: 'error', code: 'AMOUNT_MISSING', date, claim: error.claimId })
      throw error
    }
  }

  /** 찜 금액이 없는 확정 찜이면 서버 오류 응답(AMOUNT_MISSING), 그 밖의 오류는 그대로 던진다 */
  #amountProblem(date: string, error: unknown): { kind: 'error'; error: ApiProblem } {
    if (!(error instanceof MissingAmountError)) throw error
    this.#deps.log({ level: 'error', code: 'AMOUNT_MISSING', date, claim: error.claimId })
    return problem(500, 'AMOUNT_MISSING', AMOUNT_MISSING_MESSAGE)
  }

  /** 정산 조회(날짜 보기)에 붙이는 묶음마다의 포장·배송 상태 (AC-I2-33) */
  async packingSummary(sellerId: string, date: string): Promise<{ buyer: string; status: string; invoice: string | null }[]> {
    // 봉인한 날짜는 장부로 (날짜 보기의 봉인 조회와 함께 — 장부를 읽을 수 없으면 빈 목록, 날짜 보기는 그대로)
    const scope = await this.#docScope(sellerId, date, false)
    if (scope.kind !== 'ok') return []
    const { runtime, state } = scope.value
    const map = packingStatusByBuyer(state, date, await packingRows(this.#deps.db, sellerId, runtime.scopeId as string))
    return [...map.entries()].map(([buyer, value]) => ({ buyer, status: value.status, invoice: value.invoice }))
  }

  /** 포장 명령 본문 검사: { requestId, buyer, action, items?(포장 완료), invoice?(배송 완료) } */
  static packingInput(body: Record<string, unknown>): { ok: true; buyer: string; action: PackingAction; items: SentItem[]; invoice: string | null } | { ok: false; error: ApiProblem } {
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
    let list: SentItem[] = []
    if (action === 'pack') {
      // 원소 = 품목 키 글, 또는 { key, qty }(화면이 본 수량 — O3 D-O3-10). 키는 겹치지 않는다
      const read = Array.isArray(items) && items.length <= 2000 ? (items as unknown[]).map(readSentItem) : null
      if (read === null || read.some((item) => item === null) || new Set(read.map((item) => (typeof item === 'string' ? item : (item as { key: string }).key))).size !== read.length) {
        return { ok: false, error: { status: 400, code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [{ field: 'items', message: '담은 상품을 확인해 주세요.' }] } }
      }
      list = read as SentItem[]
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
    input: { buyer: string; action: PackingAction; items: readonly SentItem[]; invoice: string | null },
  ): Promise<Outcome<{ entry: PackingEntry; recorded: boolean }>> {
    if (!isValidDate(date)) return NOT_FOUND
    // 찜 금액이 없는 확정 찜이 있으면 품목을 만들지 못해 트랜잭션을 되돌리고 서버 오류 (D-O3-15)
    let result: Outcome<{ entry: PackingEntry; recorded: boolean; buyer: string }>
    try {
      result = await this.#packingWrite(sellerId, accountId, date, requestId, input)
    } catch (error) {
      return this.#amountProblem(date, error)
    }
    if (result.kind !== 'ok') return result
    // 커밋된 뒤에만 다른 기기에 알린다 (AC-I2-32) — 값(품목·송장)은 알림에 넣지 않는다
    if (result.value.recorded) this.#deps.hub.publishNamed(sellerId, 'packing', { date, buyer: result.value.buyer })
    return ok({ entry: result.value.entry, recorded: result.value.recorded })
  }

  #packingWrite(
    sellerId: string,
    accountId: string,
    date: string,
    requestId: string,
    input: { buyer: string; action: PackingAction; items: readonly SentItem[]; invoice: string | null },
  ): Promise<Outcome<{ entry: PackingEntry; recorded: boolean; buyer: string }>> {
    const { db, writer, clock } = this.#deps
    return writer.withScope(sellerId, date, false, async (runtime, catchUpIn): Promise<Outcome<{ entry: PackingEntry; recorded: boolean; buyer: string }>> => {
      if (runtime.seq === 0 || runtime.scopeId === null) return NOT_FOUND
      const scopeId = runtime.scopeId
      return db.transaction(async (tx) => {
        await catchUpIn(tx)
        // 봉인한 날짜의 포장·배송 명령은 받지 않는다 (D-I2-22 (3)·D-PL1-04 — 같은 요청 번호여도, 기록·알림 없음). 범위 락 안에서 본다(봉인 작업도 같은 락)
        if ((await scopeSealedAt(tx, sellerId, scopeId)) !== null) return ClosingService.sealedProblem()
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
        // 살아 있는 택배 접수(PENDING·UNKNOWN·BOOKED)가 있으면 포장 취소·배송 취소·손으로 적는 배송 완료를 받지 않는다 (T1 PC-5, AC-T1-35)
        if (input.action !== 'pack' && (await hasLiveAttempt(tx, sellerId, date, input.buyer))) return problem(409, 'PACKING_STATE', PARCEL_MESSAGES.locked, [], { entry: current })
        // 지금 품목 = (상품 ID, 상품 키) 쌍 — 보낸 키 목록이 지금 키와 같으면 서버가 상품 ID를 붙여 기록한다 (D-I2-19)
        const decision = decidePacking(replayPacking(rows), current.items.map((item) => ({ id: item.id, key: item.key, qty: item.qty })), input.action, input.items, input.invoice)
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
            items: decision.record.items === null ? null : packedItemsJson(decision.record.items),
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
  }

  /** 포장 라벨 (AC-I2-34): 라벨 데이터(L-9)와 쪽마다 그림. 합쳐진 구매자 ID는 지금의 구매자로 푼다 */
  async packingLabel(sellerId: string, date: string, buyer: string): Promise<Outcome<{ buyer: string; data: PackingLabelData; pages: Uint8Array[]; pdf: () => Uint8Array | null; name: string }>> {
    const scope = await this.#docScope(sellerId, date, false)
    if (scope.kind !== 'ok') return scope
    const { state } = scope.value
    const root = getBuyer(state, buyer) === null ? null : currentBuyerOf(state, buyer)
    let data: PackingLabelData | null
    try {
      data = root === null ? null : packingLabelData(state, date, root)
    } catch (error) {
      return this.#amountProblem(date, error)
    }
    if (data === null) return problem(422, 'NO_ITEMS', LABEL_NO_ITEMS_MESSAGE)
    // 가게 이름 = 포장 템플릿의 가게 이름, 비면 설정 "가게"의 가게 이름 (L-11 13, FB1 D-FB1-07 — 출력 기기가 받는 템플릿과 같은 이름)
    const rendered = renderPacking(data, (await servedTemplate(this.#deps.db, sellerId, 'packing')).template.shopName)
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
    // 보고 있는 날짜는 보통 읽기, 다른 날짜들은 공용 캐시에 넣지 않는 읽기 (TD-I2-008)
    const writer = this.#deps.writer
    const { db, log } = this.#deps
    // 봉인한 날짜는 봉인 장부로 다시 세운 상태 (D-PL1-04). 다른 날짜의 장부를 읽을 수 없으면 그 날짜만 뺀다(빈 범위 상태 — 오류 로그 하나)
    const withSealed = async (day: string, runtime: ScopeRuntime): Promise<ScopeRuntime> => {
      if (runtime.seq === 0 || runtime.scopeId === null) return runtime
      const sealed = await readSealed(db, sellerId, day)
      if (!sealed.sealed) return runtime
      if (sealed.state === null) {
        log({ level: 'error', code: 'LEDGER_UNREADABLE', date: day })
        return { ...runtime, state: emptyState() }
      }
      return { ...runtime, state: sealed.state }
    }
    return pastPurchases(
      { db, read: async (day) => withSealed(day, await writer.read(sellerId, day, false)), readOther: async (day) => withSealed(day, await writer.readDetached(sellerId, day, false)), log },
      sellerId,
      date,
      buyer,
      before,
    )
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

  /** 미리 보기 본문: { text } 또는 { file: { name, data(base64) } } 하나. .xlsx는 작업 워커가 상한을 걸고 읽는다 (RA-I2-004) */
  async #importSource(sellerId: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<{ ok: true; kind: 'text'; text: string; lines: Map<number, string> } | { ok: true; kind: 'rows'; rows: { line: number; cells: string[] }[] } | { ok: false; error: ApiProblem }> {
    const extra = ownKeys(body).filter((key) => key !== 'text' && key !== 'file')
    if (extra.length > 0) return { ok: false, error: { status: 400, code: 'UNKNOWN_FIELD', message: '받을 수 없는 항목이 있어요.', problems: unknownFieldProblems(extra) } }
    const text = own(body, 'text')
    const file = own(body, 'file')
    if ((text === undefined) === (file === undefined)) {
      return { ok: false, error: { status: 400, code: 'INVALID_INPUT', message: '붙여 넣은 글이나 파일 하나를 보내 주세요.', problems: [{ field: 'text', message: '붙여 넣은 글이나 파일 하나를 보내 주세요.' }] } }
    }
    if (text !== undefined) {
      if (typeof text !== 'string') return { ok: false, error: { status: 400, code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [{ field: 'text', message: '붙여 넣은 글을 확인해 주세요.' }] } }
      // 글자 수 = 코드 포인트 (UTF-16 단위 수가 두 배를 넘으면 세 보지 않아도 넘는다)
      if (text.length > IMPORT_TEXT_MAX_CHARS * 2 || (text.length > IMPORT_TEXT_MAX_CHARS && [...text].length > IMPORT_TEXT_MAX_CHARS)) {
        return { ok: false, error: { status: 413, code: 'PAYLOAD_TOO_LARGE', message: IMPORT_FILE_MESSAGES.textTooLong } }
      }
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
    const worked = await this.#work(sellerId, null, () => this.#deps.work.sheets.run<XlsxReadResult>(sellerId, 'xlsxRows', { bytes }, { transfer: [bytes.buffer as ArrayBuffer], ...signalOf(signal) }))
    if (worked.kind === 'error' && worked.error.code === 'BUSY') return { ok: false, error: worked.error }
    // 워커가 시간·메모리 상한에 걸렸으면 읽지 못한 파일이다
    const read: XlsxReadResult = worked.kind === 'ok' ? worked.value : { ok: false, reason: 'unreadable' }
    if (!read.ok && (read.reason === 'tooLong' || read.reason === 'tooBig')) {
      return { ok: false, error: { status: 413, code: 'FILE_TOO_LARGE', message: IMPORT_FILE_MESSAGES.sheetTooLong, problems: [{ field: 'file', message: IMPORT_FILE_MESSAGES.sheetTooLong }] } }
    }
    if (!read.ok) return { ok: false, error: { status: 400, code: 'FILE_UNREADABLE', message: IMPORT_FILE_MESSAGES.unreadable, problems: [{ field: 'file', message: IMPORT_FILE_MESSAGES.unreadable }] } }
    return { ok: true, kind: 'rows', rows: read.rows.map((row) => ({ line: row.line, cells: [...row.cells] })) }
  }

  /** 미리 보기 (기록하지 않는다): R-18 결과 + 줄마다 원래 줄 글 + 등록할 줄 수·문제 줄 수 */
  async importPreview(sellerId: string, b: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Outcome<ImportPreview>> {
    const target = await this.#importTarget(sellerId, b)
    if (target === null) return NOT_FOUND
    if (target === 'ended') return problem(409, 'BROADCAST_ENDED', IMPORT_ENDED_MESSAGE)
    const source = await this.#importSource(sellerId, body, signal)
    if (!source.ok) return { kind: 'error', error: source.error }
    const settings = { unit: target.unit, maxNumber: target.maxNumber, existing: target.existing }
    const result: ImportResult = source.kind === 'text' ? parseProductList(source.text, settings) : parseProductRows(source.rows, settings)
    if ('error' in result) return ok({ broadcast: b, unit: target.unit, maxNumber: target.maxNumber, error: result.error, header: null, headerCells: null, rows: [], register: 0, problems: 0 })
    // 등록할 줄을 그대로 보낸 등록 본문이 등록 상한을 넘으면 "n개 등록하기"를 보이지 않는다 — 미리 보기가 받은 목록은 늘 등록된다 (SA-I2-007)
    if (importRegisterBodyBytes(result.rows.flatMap((row) => ('error' in row ? [] : [row]))) > IMPORT_REGISTER_BODY_LIMIT_BYTES) {
      const [field, message] = own(body, 'file') === undefined ? (['text', IMPORT_FILE_MESSAGES.pasteTooLong] as const) : (['file', IMPORT_FILE_MESSAGES.sheetTooLong] as const)
      return problem(413, 'FILE_TOO_LARGE', message, [{ field, message }])
    }
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
      // 기록 경로의 '아무것도 쓰지 않음'은 채팅 묶음(chatBatch, Y1)에서만 생긴다 — 가져오기는 늘 한 줄 이상 쓴다. 생기면 이미 받은 입력으로 본다
      case 'empty':
        return problem(409, 'REQUEST_ERROR', '이미 받은 입력이에요.')
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

/** 확인서 파일 종류 (I2 PDF·PNG, N4b JPG) */
export type ReceiptFileKind = 'pdf' | 'png' | 'jpg'

/** 영수증 보내기 화면의 구매자 줄 (금액·입금 상태는 확인서 데이터 그대로) */
export interface ReceiptBuyerRow {
  readonly buyer: string
  /** 확인서에 찍힌 이름 */
  readonly name: string
  readonly phoneLast4: string | null
  readonly itemCount: number
  readonly total: number
  readonly payment: 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERPAID'
  readonly received: number
  /** 부분 입금일 때 남은 금액 (아니면 null) */
  readonly remaining: number | null
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
