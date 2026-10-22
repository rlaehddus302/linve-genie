// 택배 자동 접수 (STL-08 T1 세부 — PARCEL_RULES PC-0~PC-8, D-T1-01~D-T1-14). 판정 엔진 밖이다: 정산 묶음·입금 상태·포장 상태는 코어·STL-08 결과 그대로 읽는다.
// - 묶음 = (판매자, 실제 범위 날짜, 지금의 구매자 ID). 묶음 하나 = 택배 하나. 접수가 되면 같은 트랜잭션에 STL-08 포장 기록 "배송 완료 — 송장번호"를,
//   접수 취소가 되면 "배송 취소"를 덧붙인다(판매대장 배송 칸·합치기 막기·배송 뒤 바뀜이 지금 규칙 그대로).
// - 쓰기(배송지·접수 시도·취소)는 범위 줄(writer.withScope) 안에서 범위 어드바이저리 락을 잡은 트랜잭션으로 한다 — 포장 명령·엔진 기록과 같은 줄이라
//   접수 직전 다시 판단(PC-4)과 PENDING 시도 만들기 사이에 입금·포장·배송지가 바뀌지 않는다. 택배사 호출은 락 밖에서 한다(판매를 멈추지 않는다, PC-0 5).
// - 한 묶음에 살아 있는 시도는 많아야 하나(DB 부분 고유 색인 parcels_live_uq, PC-INV-1). 응답이 끊기면 UNKNOWN으로 두고 같은 요청 번호로 다시 확인한다.
// - 배송지 원문은 로그·오류·감사 메시지·발송함·이벤트 로그·요청 번호 기록에 남기지 않는다. 택배사 원래 응답 글은 읽지 않는다(carrier.ts).
// - 판매자 ID 조건은 늘 세션의 판매자다. 없는 범위·모르는 구매자는 404(다른 판매자의 묶음이 있는지 드러내지 않는다).
import { currentBuyerOf, getBuyer, getSettlement, isValidDate, type EngineState } from '@livejjim/core'
import { formatInvoiceNumber, type WaybillData, type WaybillsPdfResult } from '@livejjim/documents'
import { and, eq, sql } from 'drizzle-orm'
import { ClosingService, type ApiProblem, type FileResult, type Outcome } from '../closing.ts'
import type { Db } from '../db/database.ts'
import { packingRecords, parcelAddresses, parcels, scopes } from '../db/schema.ts'
import type { FieldProblem } from '../errors.ts'
import { MIME, fileNamePart } from '../files.ts'
import type { StreamHub } from '../hub.ts'
import { errorKind, type LogSink } from '../log.ts'
import { unknownFieldProblems } from '../messages.ts'
import { lookupOf, packingRows, packingStatusOf, replayPacking, type PackingRecordRow } from '../packing.ts'
import type { ScopeRuntime } from '../runtime.ts'
import { readShop } from '../shop.ts'
import { iso, kstDate, type Clock } from '../time.ts'
import { WorkBusy, WorkFailed, type WorkPools } from '../work-pool.ts'
import { SEALED_MESSAGE, type ScopeWriter } from '../writer.ts'
import { kstMidnightAfter, type Timer } from '../youtube/timer.ts'
import { CARRIER_CODES, CARRIER_LABELS, type CarrierAdapter, type CarrierCode, type ParcelSender } from './carrier.ts'
import {
  BOOK_MAX,
  BOX_KINDS,
  CANCELLED_WORD,
  ELIGIBILITY_MESSAGES,
  FAILURE_MESSAGES,
  PARCEL_MESSAGES,
  TRACK_EVERY_MS,
  TRACK_STOP_MS,
  TRACK_WORDS,
  addressProblems,
  parcelEligibility,
  phoneLast4,
  readAddress,
  readAddressInput,
  tidyText,
  type AddressErrorCode,
  type AddressField,
  type AddressState,
  type BoxKind,
  type EligibilityFacts,
  type EligibilityReason,
  type FailureReason,
  type ParcelAddress,
  type ParcelState,
  type ShippingKind,
} from './rules.ts'
import {
  addressRow,
  addressRowsOf,
  attemptById,
  claimRequest,
  confirmAddress,
  deleteAddress,
  insertAttempt,
  latestAttempt,
  latestAttempts,
  moveAttempt,
  openAddress,
  putAddress,
  readSettings,
  requestRow,
  saveRequestResult,
  setTrack,
  stateNow,
  sweepAddresses,
  trackCandidates,
  writeSettings,
  type AddressRow,
  type AttemptRow,
  type ParcelRequestKind,
  type StoredSettings,
} from './store.ts'

/** 배송지 보관 날 수 (PC-3 "보관" — 봉인 D-Y11과 같은 때) */
export const ADDRESS_KEEP_DAYS = 30
/** 배송지 정리 간격 */
export const SWEEP_EVERY_MS = 60 * 60 * 1000
/** 한 번에 접수할 때 택배사에 동시에 보내는 수 */
export const BOOK_CONCURRENCY = 4
/** 조회 한 번에 묻는 송장 수 */
const TRACK_CHUNK = 100
/** 택배사 고객 번호 길이 상한 */
export const CUSTOMER_NO_MAX = 30

export interface ParcelOptions {
  /** 이어진 택배사 어댑터 (T1: 가짜 택배사 FAKE — 시험 모드·서버 시험만. 운영 기동에는 없다 — 설정에 "우체국 택배 — 준비 중"만) */
  readonly carriers?: Partial<Record<CarrierCode, CarrierAdapter>>
  /** 조회 간격 (기본 30분 — 시험 모드는 줄일 수 있다) */
  readonly trackEveryMs?: number
  /** 배송지 정리 간격 (기본 1시간) */
  readonly sweepEveryMs?: number
  /** 한 번에 접수할 때 동시에 보내는 수 (기본 4) */
  readonly concurrency?: number
}

export interface ParcelDeps {
  readonly db: Db
  readonly writer: ScopeWriter
  readonly clock: Clock
  readonly timer: Timer
  readonly masterKey: Buffer
  readonly hub: StreamHub
  readonly log: LogSink
  readonly work: WorkPools
  readonly options: ParcelOptions
}

/** 묶음의 택배 줄 (`parcel` — 정산 묶음·포장 모드·택배 화면) */
export interface ParcelBrief {
  readonly state: ParcelState
  readonly carrier: CarrierCode
  readonly carrierName: string
  readonly invoice: string | null
  /** 4자리마다 `-` */
  readonly invoiceText: string | null
  /** 조회 낱말 (접수됨·집하·배송 중·도착·접수 취소됨, 접수 전이면 null) */
  readonly status: string | null
  /** 마지막 확인 시각 (UTC ISO) */
  readonly checkedAt: string | null
  readonly trackUrl: string | null
  readonly reason: FailureReason | null
  /** 상태 문장 (실패 사유·모름·기다림 — 없으면 null) */
  readonly message: string | null
  readonly box: BoxKind
  readonly qty: number
  readonly bookedAt: string | null
  /** 접수 취소를 보낼 수 있는지 (BOOKED이고 집하 전) */
  readonly cancellable: boolean
}

/** 택배 화면의 묶음 한 줄 */
export interface ParcelRow {
  readonly buyer: string
  readonly name: string
  readonly phoneLast4: string | null
  /** 품목 수 */
  readonly itemCount: number
  /** 물품 N개의 N (품목 수량 합) */
  readonly qty: number
  /** 최종 금액 (코어 값 그대로) */
  readonly total: number
  /** 입금 상태 (코어 값 — 화면이 D-092 말로 바꾼다) */
  readonly payment: string
  /** 포장 상태 말 (STL-08) */
  readonly packing: string
  readonly shipping: ShippingKind
  readonly address: AddressState
  readonly ready: boolean
  readonly reason: EligibilityReason | null
  /** 빠지는 이유의 화면 문장 */
  readonly message: string | null
  /** 상자 크기 (고를 수 있으면 설정의 기본값, 아니면 시도의 것 또는 기본값) */
  readonly box: BoxKind
  readonly parcel: ParcelBrief | null
}

export interface ParcelDay {
  readonly date: string
  readonly seq: number
  /** 목록 위 한 문장 (보내는 사람 없음·택배사 없음 — 접수 버튼을 잠근다) */
  readonly blocked: { readonly code: 'NO_SENDER' | 'NO_CARRIER'; readonly message: string } | null
  readonly carrier: { readonly code: CarrierCode; readonly name: string } | null
  readonly box: BoxKind
  readonly ready: readonly ParcelRow[]
  readonly excluded: readonly ParcelRow[]
  readonly booked: readonly ParcelRow[]
}

export interface AddressView extends ParcelAddress {
  readonly source: 'BUYER' | 'SELLER'
  readonly confirmed: boolean
  /** 고친 시각 (UTC ISO — 배송지 확인 요청에 그대로 보낸다) */
  readonly updatedAt: string
}

export interface BundleView {
  readonly date: string
  readonly buyer: string
  readonly address: AddressView | null
  /** 살아 있는 접수가 있어 고칠 수 없다 */
  readonly locked: boolean
  /** 보관 기간(날짜 + 30일)이 지났다 */
  readonly expired: boolean
  readonly row: ParcelRow
}

export interface ParcelSettingsView {
  readonly carrier: CarrierCode | null
  readonly carriers: readonly { readonly code: CarrierCode; readonly name: string; readonly available: boolean; readonly note: string | null }[]
  /** 고객 번호 끝 4자리 (없으면 null) */
  readonly customerNoLast4: string | null
  readonly sender: ParcelSender | null
  /** 보내는 사람 이름 기본값 (가게 이름) */
  readonly shopName: string
  readonly box: BoxKind
  readonly boxes: readonly BoxKind[]
}

export type BookItemResult =
  | { readonly buyer: string; readonly ok: true; readonly invoice: string; readonly invoiceText: string }
  | { readonly buyer: string; readonly ok: false; readonly reason: EligibilityReason | FailureReason | 'BUYER' | 'SEALED' | 'ADDRESS_EXPIRED'; readonly message: string }

/** 구매자 링크 쪽의 배송지 칸 (PC-3·PC-8) */
export type LinkSection =
  | { readonly kind: 'form' }
  | { readonly kind: 'saved'; readonly name: string; readonly last4: string }
  | { readonly kind: 'pickup' }
  | { readonly kind: 'combined' }
  | { readonly kind: 'closed' }
  | { readonly kind: 'preparing' }
  | { readonly kind: 'booked'; readonly carrierName: string; readonly invoiceText: string; readonly status: string; readonly checkedAt: number | null; readonly trackUrl: string | null }

export type LinkSave =
  | { readonly kind: 'saved' }
  | { readonly kind: 'invalid'; readonly errors: readonly AddressErrorCode[] }
  | { readonly kind: 'refused'; readonly message: string }

const ok = <T>(value: T): Outcome<T> => ({ kind: 'ok', value })
const NOT_FOUND = { kind: 'not_found' } as const
const problem = (status: number, code: ApiProblem['code'], message: string, problems: readonly FieldProblem[] = [], extra?: Readonly<Record<string, unknown>>): { kind: 'error'; error: ApiProblem } => ({
  kind: 'error',
  error: { status, code, message, problems, ...(extra === undefined ? {} : { extra }) },
})
const invalid = (field: string, message: string) => problem(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', [{ field, message }])

/** 그 날짜 배송지의 보관이 끝나는 시각 (날짜 + 30일의 0시 KST) */
export const addressExpiresAt = (date: string): number => kstMidnightAfter(date, ADDRESS_KEEP_DAYS)

/** 지금 지울 마지막 날짜: 그 날짜 + 30일 0시(KST)가 지났거나 같은 날짜 중 가장 늦은 것 */
export function lastExpiredDate(now: number): string {
  const today = kstDate(now)
  const [y, m, d] = today.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d - ADDRESS_KEEP_DAYS)).toISOString().slice(0, 10)
}

/** 같은 트랜잭션에서 요청 번호를 이미 다른 요청이 적었다 — 되돌린다 */
class RequestTaken extends Error {
  constructor() {
    super('요청 번호가 이미 있다')
    this.name = 'RequestTaken'
  }
}

type Prepared =
  | { readonly kind: 'skip'; readonly result: BookItemResult }
  | { readonly kind: 'send'; readonly attempt: AttemptRow; readonly receiver: ParcelAddress }

export class ParcelService {
  readonly #deps: ParcelDeps
  readonly #carriers: Partial<Record<CarrierCode, CarrierAdapter>>
  /** 이 서버에서 처리 중인 한 번에 접수 (같은 화면 요청 번호가 다시 오면 끝날 때까지 기다린다) */
  readonly #flights = new Map<string, Promise<BookItemResult[]>>()
  #loop: Promise<void> | null = null
  #stopped = false
  #wake = new AbortController()

  constructor(deps: ParcelDeps) {
    this.#deps = deps
    this.#carriers = deps.options.carriers ?? {}
  }

  /** 이 서버가 고를 수 있는 택배사 (가짜 택배사는 시험 모드에서만 — 운영에는 어댑터가 없다) */
  available(code: CarrierCode): boolean {
    return this.#carriers[code] !== undefined
  }

  // ── 공통 ───────────────────────────────────────────────────────────────

  async #sealed(db: Db, sellerId: string, scopeId: string): Promise<boolean> {
    const rows = await db
      .select({ sealedAt: scopes.sealedAt })
      .from(scopes)
      .where(and(eq(scopes.sellerId, sellerId), eq(scopes.id, scopeId)))
      .limit(1)
    return rows[0]?.sealedAt !== null && rows[0]?.sealedAt !== undefined
  }

  /** 실제 범위 (없는 범위·봉인한 범위는 null — 봉인한 날짜는 접수 목록에 나오지 않는다) */
  async #realScope(sellerId: string, date: string): Promise<ScopeRuntime | null> {
    if (!isValidDate(date)) return null
    const runtime = await this.#deps.writer.read(sellerId, date, false)
    if (runtime.seq === 0 || runtime.scopeId === null) return null
    if (await this.#sealed(this.#deps.db, sellerId, runtime.scopeId)) return null
    return runtime
  }

  /** 지금의 구매자인지 */
  static current(state: EngineState, buyer: string): boolean {
    return getBuyer(state, buyer) !== null && currentBuyerOf(state, buyer) === buyer
  }

  #expired(date: string): boolean {
    return this.#deps.clock.now() >= addressExpiresAt(date)
  }

  /** 배송지 행 → 풀린 배송지 (보관 기간이 지났거나 풀리지 않으면 null) */
  #open(sellerId: string, row: AddressRow | null | undefined): ParcelAddress | null {
    if (row === null || row === undefined || this.#expired(row.date)) return null
    return openAddress(this.#deps.masterKey, sellerId, row.date, row.buyer, row.sealed)
  }

  #brief(row: AttemptRow | null | undefined): ParcelBrief | null {
    if (row === null || row === undefined) return null
    const state = stateNow(row, this.#deps.clock.now())
    const adapter = this.#carriers[row.carrier]
    const message = state === 'FAILED' ? FAILURE_MESSAGES[row.reason === 'ADDRESS' ? 'ADDRESS' : 'REJECTED'] : state === 'UNKNOWN' ? FAILURE_MESSAGES.UNAVAILABLE : state === 'PENDING' ? ELIGIBILITY_MESSAGES.BOOKING : null
    return {
      state,
      carrier: row.carrier,
      carrierName: CARRIER_LABELS[row.carrier],
      invoice: row.invoice,
      invoiceText: row.invoice === null ? null : formatInvoiceNumber(row.invoice),
      status: state === 'BOOKED' ? TRACK_WORDS[row.track ?? 'ACCEPTED'] : state === 'CANCELLED' ? CANCELLED_WORD : null,
      checkedAt: state === 'BOOKED' && row.trackedAt !== null ? iso(row.trackedAt.getTime()) : null,
      trackUrl: row.invoice !== null && adapter !== undefined && (state === 'BOOKED' || state === 'CANCELLED') ? adapter.trackUrl(row.invoice) : null,
      reason: state === 'FAILED' ? row.reason : state === 'UNKNOWN' ? 'UNAVAILABLE' : null,
      message,
      box: row.box,
      qty: row.qty,
      bookedAt: row.bookedAt === null ? null : iso(row.bookedAt.getTime()),
      cancellable: state === 'BOOKED' && (row.track === null || row.track === 'ACCEPTED'),
    }
  }

  /** 정산 묶음·포장 모드에 붙이는 택배 줄 (AC-T1-52): 살아 있는 시도·취소한 시도만, 없으면 null */
  async briefs(sellerId: string, date: string): Promise<Map<string, ParcelBrief | null>> {
    const out = new Map<string, ParcelBrief | null>()
    if (!isValidDate(date)) return out
    for (const [buyer, row] of await latestAttempts(this.#deps.db, sellerId, date)) {
      const brief = this.#brief(row)
      out.set(buyer, brief === null || brief.state === 'FAILED' ? null : brief)
    }
    return out
  }

  /** 물품 수 = 그 묶음 확정 찜의 수량 합 */
  static qtyOf(state: EngineState, date: string, buyer: string): number {
    const lookup = lookupOf(state)
    let qty = 0
    for (const claim of lookup.confirmed.get(buyer) ?? []) if (lookup.dates.get(claim.broadcast) === date) qty += claim.qty
    return qty
  }

  /** 묶음 한 줄 (코어 정산·STL-08 포장 상태·배송지·가장 나중 시도 → PC-4) */
  #row(state: EngineState, date: string, buyer: string, records: readonly PackingRecordRow[], address: AddressRow | null | undefined, attempt: AttemptRow | null | undefined, defaultBox: BoxKind, sellerId: string): ParcelRow {
    const settlement = getSettlement(state, buyer, date)
    const info = getBuyer(state, buyer)
    const packing = packingStatusOf(state, date, buyer, records).status
    const opened = this.#open(sellerId, address) !== null
    const addressKind: AddressState = !opened ? 'NONE' : address?.confirmed === true ? 'CONFIRMED' : 'UNCONFIRMED'
    const now = this.#deps.clock.now()
    const parcelState = attempt === null || attempt === undefined ? 'NONE' : stateNow(attempt, now)
    const shipping: ShippingKind = settlement.items.length === 0 ? 'NONE' : (settlement.shippingOverride ?? 'NONE')
    const facts: EligibilityFacts = { items: settlement.items.length, shipping, payment: settlement.payment, packing, parcel: parcelState, address: addressKind }
    const eligibility = parcelEligibility(facts)
    const reason = 'reason' in eligibility ? eligibility.reason : null
    return {
      buyer,
      name: info?.display ?? '',
      phoneLast4: info?.phoneLast4 ?? null,
      itemCount: settlement.items.length,
      qty: ParcelService.qtyOf(state, date, buyer),
      total: settlement.total,
      payment: settlement.payment,
      packing,
      shipping,
      address: addressKind,
      ready: reason === null,
      reason,
      message: reason === null ? null : ELIGIBILITY_MESSAGES[reason],
      box: reason === null || attempt === null || attempt === undefined ? defaultBox : attempt.box,
      parcel: this.#brief(attempt),
    }
  }

  /** 그 날짜 목록의 구매자: 확인서 일괄 순서(D-I2-04) + 품목이 없어도 시도가 있는 지금의 구매자(구매자 ID 순) */
  static buyersOf(state: EngineState, date: string, attempts: ReadonlyMap<string, AttemptRow>): string[] {
    const order = ClosingService.batchOrder(state, date)
    const seen = new Set(order)
    const extra = [...attempts.keys()].filter((buyer) => !seen.has(buyer) && ParcelService.current(state, buyer)).sort()
    return [...order, ...extra]
  }

  #blocked(settings: StoredSettings): ParcelDay['blocked'] {
    if (settings.carrier === null || !this.available(settings.carrier)) return { code: 'NO_CARRIER', message: PARCEL_MESSAGES.noCarrier }
    if (settings.sender === null) return { code: 'NO_SENDER', message: PARCEL_MESSAGES.noSender }
    return null
  }

  // ── 설정 "택배" (PC-6, AC-T1-23) ─────────────────────────────────────

  async settings(sellerId: string): Promise<ParcelSettingsView> {
    const stored = await readSettings(this.#deps.db, this.#deps.masterKey, sellerId)
    const shop = await readShop(this.#deps.db, sellerId)
    return {
      carrier: stored.carrier,
      carriers: CARRIER_CODES.filter((code) => code !== 'FAKE' || this.available('FAKE')).map((code) => ({
        code,
        name: CARRIER_LABELS[code],
        available: this.available(code),
        note: this.available(code) ? null : '준비 중',
      })),
      customerNoLast4: stored.customerNo === null || stored.customerNo === '' ? null : [...stored.customerNo].slice(-4).join(''),
      sender: stored.sender,
      shopName: shop.name,
      box: stored.box,
      boxes: BOX_KINDS,
    }
  }

  /** PUT 설정 "택배": { carrier, customerNo?, sender, box }. 틀리면 칸마다 문제(보내는 사람은 PC-2와 같은 칸 코드 — extra.codes) */
  async updateSettings(sellerId: string, body: Record<string, unknown>): Promise<Outcome<ParcelSettingsView>> {
    const allowed = ['carrier', 'customerNo', 'sender', 'box']
    const extra = Object.keys(body).filter((key) => !allowed.includes(key))
    if (extra.length > 0) return problem(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', unknownFieldProblems(extra))
    const current = await readSettings(this.#deps.db, this.#deps.masterKey, sellerId)
    const problems: FieldProblem[] = []
    let codes: AddressErrorCode[] = []
    // 택배사
    const carrierRaw = body.carrier
    let carrier: CarrierCode | null = current.carrier
    if (carrierRaw === null) carrier = null
    else if (carrierRaw === 'EPOST') problems.push({ field: 'carrier', message: PARCEL_MESSAGES.epostNotReady })
    else if (carrierRaw === 'FAKE') {
      if (this.available('FAKE')) carrier = 'FAKE'
      else problems.push({ field: 'carrier', message: PARCEL_MESSAGES.fakeTestOnly })
    } else if (carrierRaw !== undefined) problems.push({ field: 'carrier', message: '택배사를 골라 주세요.' })
    // 고객 번호 (적지 않으면 그대로, 빈 글이면 지운다)
    let customerNo = current.customerNo
    if (body.customerNo !== undefined) {
      if (typeof body.customerNo !== 'string') problems.push({ field: 'customerNo', message: `고객 번호는 ${String(CUSTOMER_NO_MAX)}자까지 적어 주세요.` })
      else {
        const tidy = tidyText(body.customerNo)
        if ([...tidy].length > CUSTOMER_NO_MAX) problems.push({ field: 'customerNo', message: `고객 번호는 ${String(CUSTOMER_NO_MAX)}자까지 적어 주세요.` })
        else customerNo = tidy === '' ? null : tidy
      }
    }
    // 보내는 사람 (PC-2 칸 — 메모 없음)
    let sender = current.sender
    if (body.sender === null) sender = null
    else if (body.sender !== undefined) {
      const input = readAddressInput(body.sender, ['name', 'phone', 'address', 'detail', 'zip'] as readonly AddressField[])
      if (input === null) problems.push({ field: 'sender', message: '보내는 사람 칸을 확인해 주세요.' })
      else {
        const read = readAddress(input)
        if ('errors' in read) {
          codes = [...read.errors]
          problems.push(...addressProblems(read.errors, 'sender.'))
        } else sender = { name: read.ok.name, phone: read.ok.phone, address: read.ok.address, detail: read.ok.detail, zip: read.ok.zip }
      }
    }
    // 기본 상자 크기
    let box = current.box
    if (body.box !== undefined) {
      if (typeof body.box === 'string' && (BOX_KINDS as readonly string[]).includes(body.box)) box = body.box as BoxKind
      else problems.push({ field: 'box', message: '상자 크기를 골라 주세요.' })
    }
    if (problems.length > 0) return problem(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', problems, codes.length > 0 ? { codes } : undefined)
    await writeSettings(this.#deps.db, this.#deps.masterKey, sellerId, { carrier, customerNo, sender, box }, new Date(this.#deps.clock.now()))
    this.#deps.hub.publishNamed(sellerId, 'parcel', { settings: true })
    return ok(await this.settings(sellerId))
  }

  // ── 날짜·목록 (PC-4, AC-T1-22) ───────────────────────────────────────

  /** 택배 화면의 날짜 목록: 실제 범위 날짜(리허설·봉인한 날짜 없음), 날짜마다 고를 수 있는 수·접수한 수. 기본 날짜 = 고를 수 있는 묶음이 있는 가장 최근, 없으면 가장 최근 */
  async days(sellerId: string): Promise<{ dates: { date: string; ready: number; booked: number }[]; selected: string | null }> {
    const { db } = this.#deps
    const rows = await db
      .select({ date: scopes.date, sealedAt: scopes.sealedAt })
      .from(scopes)
      .where(and(eq(scopes.sellerId, sellerId), eq(scopes.rehearsal, false), sql`${scopes.seq} > 0`))
    const dates = rows
      .filter((row) => row.sealedAt === null)
      .map((row) => row.date)
      .sort()
      .reverse()
    const counts = new Map<string, { ready: number; booked: number }>()
    // 고를 수 있으려면 확인한 배송지가 있어야 한다 — 그런 날짜(보관 기간 30일 안)만 목록을 계산한다
    const withAddress = await db
      .selectDistinct({ date: parcelAddresses.date })
      .from(parcelAddresses)
      .where(and(eq(parcelAddresses.sellerId, sellerId), eq(parcelAddresses.confirmed, true)))
    const candidates = new Set(withAddress.map((row) => row.date))
    const bookedRows = await db
      .select({ date: parcels.date, n: sql<number>`count(*)::int` })
      .from(parcels)
      .where(and(eq(parcels.sellerId, sellerId), eq(parcels.state, 'BOOKED')))
      .groupBy(parcels.date)
    const bookedBy = new Map(bookedRows.map((row) => [row.date, Number(row.n)]))
    for (const date of dates) {
      let ready = 0
      if (candidates.has(date) && !this.#expired(date)) {
        const day = await this.day(sellerId, date)
        if (day.kind === 'ok') ready = day.value.ready.length
      }
      counts.set(date, { ready, booked: bookedBy.get(date) ?? 0 })
    }
    const list = dates.map((date) => ({ date, ...(counts.get(date) ?? { ready: 0, booked: 0 }) }))
    return { dates: list, selected: list.find((item) => item.ready > 0)?.date ?? list[0]?.date ?? null }
  }

  /** 그 날짜의 접수 목록 (AC-T1-22): 고를 수 있음·빠짐(이유)·접수함. 없는 범위·봉인한 범위는 404 */
  async day(sellerId: string, date: string): Promise<Outcome<ParcelDay>> {
    const runtime = await this.#realScope(sellerId, date)
    if (runtime === null) return NOT_FOUND
    const { db, masterKey } = this.#deps
    const { state } = runtime
    const settings = await readSettings(db, masterKey, sellerId)
    const records = await packingRows(db, sellerId, runtime.scopeId as string)
    const addresses = await addressRowsOf(db, sellerId, date)
    const attempts = await latestAttempts(db, sellerId, date)
    const rows = ParcelService.buyersOf(state, date, attempts).map((buyer) => this.#row(state, date, buyer, records, addresses.get(buyer), attempts.get(buyer), settings.box, sellerId))
    return ok({
      date,
      seq: runtime.seq,
      blocked: this.#blocked(settings),
      carrier: settings.carrier === null ? null : { code: settings.carrier, name: CARRIER_LABELS[settings.carrier] },
      box: settings.box,
      ready: rows.filter((row) => row.ready),
      booked: rows.filter((row) => row.parcel?.state === 'BOOKED'),
      excluded: rows.filter((row) => !row.ready && row.parcel?.state !== 'BOOKED'),
    })
  }

  // ── 묶음 자세히·배송지 (PC-3, AC-T1-13) ──────────────────────────────

  async #bundleView(db: Db, sellerId: string, runtime: ScopeRuntime, date: string, buyer: string): Promise<BundleView> {
    const settings = await readSettings(db, this.#deps.masterKey, sellerId)
    const records = await packingRows(db, sellerId, runtime.scopeId as string, buyer)
    const address = await addressRow(db, sellerId, date, buyer)
    const attempt = await latestAttempt(db, sellerId, date, buyer)
    const opened = this.#open(sellerId, address)
    const row = this.#row(runtime.state, date, buyer, records, address, attempt, settings.box, sellerId)
    const live = row.parcel !== null && (row.parcel.state === 'PENDING' || row.parcel.state === 'UNKNOWN' || row.parcel.state === 'BOOKED')
    return {
      date,
      buyer,
      address: opened === null || address === null ? null : { ...opened, source: address.source, confirmed: address.confirmed, updatedAt: iso(address.updatedAt.getTime()) },
      locked: live,
      expired: this.#expired(date),
      row,
    }
  }

  /** 묶음 자세히 (배송지 여섯 칸 전부·출처·확인 여부, 택배 줄). 모르는 구매자 404 */
  async bundle(sellerId: string, date: string, buyer: string): Promise<Outcome<BundleView>> {
    const runtime = await this.#realScope(sellerId, date)
    if (runtime === null || getBuyer(runtime.state, buyer) === null) return NOT_FOUND
    return ok(await this.#bundleView(this.#deps.db, sellerId, runtime, date, buyer))
  }

  /**
   * 배송지 쓰기 공통 (범위 줄·락 안): 없는 범위·봉인·모르는 구매자·잠금·보관 기간을 본 뒤 work. 같은 요청 번호면 처음 결과(그 묶음의 지금 모습).
   * 요청 번호는 성공한 쓰기와 같은 트랜잭션에 적는다(실패면 적지 않는다)
   */
  async #addressWrite(
    sellerId: string,
    date: string,
    requestId: string,
    kind: ParcelRequestKind,
    buyer: string,
    work: (tx: Db, runtime: ScopeRuntime, now: Date) => Promise<{ kind: 'error'; error: ApiProblem } | null>,
  ): Promise<Outcome<BundleView>> {
    if (!isValidDate(date)) return NOT_FOUND
    const { db, writer } = this.#deps
    const prior = await requestRow(db, sellerId, requestId)
    if (prior !== null) {
      if (prior.kind !== kind || prior.date !== date) return problem(409, 'REQUEST_ERROR', PARCEL_MESSAGES.request)
      return this.bundle(sellerId, date, buyer)
    }
    try {
      const outcome = await writer.withScope(sellerId, date, false, async (runtime, catchUpIn): Promise<Outcome<BundleView>> => {
        if (runtime.seq === 0 || runtime.scopeId === null) return NOT_FOUND
        return db.transaction(async (tx) => {
          await catchUpIn(tx)
          if (await this.#sealed(tx, sellerId, runtime.scopeId as string)) return problem(409, 'SEALED', SEALED_MESSAGE)
          if (!ParcelService.current(runtime.state, buyer)) return getBuyer(runtime.state, buyer) === null ? NOT_FOUND : problem(409, 'BUYER_NOT_FOUND', '구매자를 다시 확인해 주세요.')
          const attempt = await latestAttempt(tx, sellerId, date, buyer)
          const now = this.#deps.clock.now()
          if (attempt !== null && ['PENDING', 'UNKNOWN', 'BOOKED'].includes(stateNow(attempt, now))) return problem(409, 'PARCEL_LOCKED', PARCEL_MESSAGES.locked)
          const failed = await work(tx, runtime, new Date(now))
          if (failed !== null) return failed
          if (!(await claimRequest(tx, { sellerId, requestId, date, kind, targets: [buyer], result: null, now: new Date(now) }))) throw new RequestTaken()
          return ok(await this.#bundleView(tx, sellerId, runtime, date, buyer))
        })
      })
      if (outcome.kind === 'ok') this.#deps.hub.publishNamed(sellerId, 'parcel', { date, buyer })
      return outcome
    } catch (error) {
      if (error instanceof RequestTaken) return problem(409, 'REQUEST_ERROR', PARCEL_MESSAGES.request)
      throw error
    }
  }

  /** 판매자가 배송지를 적거나 고친다 (PC-2 검사, 그 자리에서 "확인함" — 확인한 계정 = 그 판매자) */
  async writeAddress(sellerId: string, accountId: string, date: string, requestId: string, buyer: string, raw: unknown): Promise<Outcome<BundleView>> {
    const input = readAddressInput(raw)
    if (input === null) return invalid('address', '배송지 칸을 확인해 주세요.')
    const read = readAddress(input)
    if ('errors' in read) return problem(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', addressProblems(read.errors, 'address.'), { codes: read.errors })
    return this.#addressWrite(sellerId, date, requestId, 'ADDRESS', buyer, async (tx, _runtime, now) => {
      if (this.#expired(date)) return problem(409, 'ADDRESS_EXPIRED', PARCEL_MESSAGES.addressClosed)
      await putAddress(tx, this.#deps.masterKey, { sellerId, date, buyer, address: read.ok, source: 'SELLER', accountId, confirmed: true, now })
      return null
    })
  }

  /** 구매자가 적은 배송지 확인 (그 배송지의 고친 시각을 함께 — 그 사이 바뀌었으면 409, 옛 내용으로 확인하지 않는다) */
  async confirm(sellerId: string, accountId: string, date: string, requestId: string, buyer: string, updatedAt: string): Promise<Outcome<BundleView>> {
    return this.#addressWrite(sellerId, date, requestId, 'CONFIRM', buyer, async (tx) => {
      const row = await addressRow(tx, sellerId, date, buyer)
      if (row === null || this.#open(sellerId, row) === null) return problem(409, 'NO_ADDRESS', PARCEL_MESSAGES.noAddress)
      if (iso(row.updatedAt.getTime()) !== updatedAt) return problem(409, 'ADDRESS_CHANGED', PARCEL_MESSAGES.addressChanged)
      if (!row.confirmed) await confirmAddress(tx, sellerId, date, buyer, accountId)
      return null
    })
  }

  /** 배송지 지우기 (행이 없어지고 NO_ADDRESS) */
  async removeAddress(sellerId: string, date: string, requestId: string, buyer: string): Promise<Outcome<BundleView>> {
    return this.#addressWrite(sellerId, date, requestId, 'DELETE', buyer, async (tx) => {
      await deleteAddress(tx, sellerId, date, buyer)
      return null
    })
  }

  // ── 구매자 링크 (PC-3·PC-8, AC-T1-10~12) ─────────────────────────────

  /** 링크 쪽의 배송지 칸 (그 구매자가 지금의 구매자이고 품목이 있는 링크일 때만 부른다) */
  async linkSection(sellerId: string, date: string, buyer: string, state: EngineState): Promise<LinkSection> {
    const { db } = this.#deps
    const attempt = await latestAttempt(db, sellerId, date, buyer)
    const now = this.#deps.clock.now()
    if (attempt !== null) {
      const current = stateNow(attempt, now)
      if (current === 'PENDING' || current === 'UNKNOWN') return { kind: 'preparing' }
      if (current === 'BOOKED' && attempt.invoice !== null) {
        return {
          kind: 'booked',
          carrierName: CARRIER_LABELS[attempt.carrier],
          invoiceText: formatInvoiceNumber(attempt.invoice),
          status: TRACK_WORDS[attempt.track ?? 'ACCEPTED'],
          checkedAt: attempt.trackedAt?.getTime() ?? null,
          trackUrl: this.#carriers[attempt.carrier]?.trackUrl(attempt.invoice) ?? null,
        }
      }
    }
    const settlement = getSettlement(state, buyer, date)
    if (settlement.shippingOverride === 'PICKUP') return { kind: 'pickup' }
    if (settlement.shippingOverride === 'COMBINED') return { kind: 'combined' }
    if (this.#expired(date)) return { kind: 'closed' }
    const opened = this.#open(sellerId, await addressRow(db, sellerId, date, buyer))
    if (opened !== null) return { kind: 'saved', name: opened.name, last4: phoneLast4(opened.phone) }
    return { kind: 'form' }
  }

  /** 구매자 링크 양식 저장 (출처 구매자, "확인 전" — 확인한 배송지도 덮어쓰면 다시 확인 전). 잠금·직접 수령·합배송·보관 기간이면 refused */
  async saveFromLink(sellerId: string, date: string, buyer: string, raw: Record<AddressField, string> | null): Promise<LinkSave> {
    if (raw === null) return { kind: 'invalid', errors: [] }
    const read = readAddress(raw)
    if ('errors' in read) return { kind: 'invalid', errors: read.errors }
    const { db, writer } = this.#deps
    const result = await writer.withScope(sellerId, date, false, async (runtime, catchUpIn): Promise<LinkSave> => {
      if (runtime.seq === 0 || runtime.scopeId === null) return { kind: 'refused', message: PARCEL_MESSAGES.addressClosed }
      return db.transaction(async (tx) => {
        await catchUpIn(tx)
        if (await this.#sealed(tx, sellerId, runtime.scopeId as string)) return { kind: 'refused', message: PARCEL_MESSAGES.addressClosed }
        const state = runtime.state
        if (!ParcelService.current(state, buyer) || getSettlement(state, buyer, date).items.length === 0) return { kind: 'refused', message: PARCEL_MESSAGES.addressClosed }
        const now = this.#deps.clock.now()
        const attempt = await latestAttempt(tx, sellerId, date, buyer)
        if (attempt !== null && ['PENDING', 'UNKNOWN', 'BOOKED'].includes(stateNow(attempt, now))) return { kind: 'refused', message: PARCEL_MESSAGES.buyerLocked }
        const override = getSettlement(state, buyer, date).shippingOverride
        if (override === 'PICKUP') return { kind: 'refused', message: PARCEL_MESSAGES.pickupLink }
        if (override === 'COMBINED') return { kind: 'refused', message: PARCEL_MESSAGES.combinedLink }
        if (this.#expired(date)) return { kind: 'refused', message: PARCEL_MESSAGES.addressClosed }
        await putAddress(tx, this.#deps.masterKey, { sellerId, date, buyer, address: read.ok, source: 'BUYER', accountId: null, confirmed: false, now: new Date(now) })
        return { kind: 'saved' }
      })
    })
    if (result.kind === 'saved') this.#deps.hub.publishNamed(sellerId, 'parcel', { date, buyer })
    return result
  }

  // ── 한 번에 접수 (PC-5, AC-T1-30~34) ─────────────────────────────────

  /**
   * 접수 본문 검사: items = [{ buyer, box? }] 1~200개(겹치는 구매자 없음). 201개 이상은 400(아무것도 접수하지 않음)
   */
  static bookInput(body: Record<string, unknown>): { ok: true; items: { buyer: string; box: BoxKind | null }[] } | { ok: false; error: ApiProblem } {
    const extra = Object.keys(body).filter((key) => key !== 'requestId' && key !== 'items')
    if (extra.length > 0) return { ok: false, error: { status: 400, code: 'UNKNOWN_FIELD', message: '받을 수 없는 항목이 있어요.', problems: [] } }
    const items = body.items
    const bad = (message: string) => ({ ok: false as const, error: { status: 400, code: 'INVALID_INPUT' as const, message, problems: [{ field: 'items', message }] } })
    if (!Array.isArray(items) || items.length === 0) return bad('접수할 묶음을 골라 주세요.')
    if (items.length > BOOK_MAX) return { ok: false, error: { status: 400, code: 'TOO_MANY', message: PARCEL_MESSAGES.tooMany, problems: [{ field: 'items', message: PARCEL_MESSAGES.tooMany }] } }
    const out: { buyer: string; box: BoxKind | null }[] = []
    const seen = new Set<string>()
    for (const item of items as unknown[]) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return bad('접수할 묶음을 확인해 주세요.')
      const keys = Object.keys(item)
      if (!keys.includes('buyer') || !keys.every((key) => key === 'buyer' || key === 'box')) return bad('접수할 묶음을 확인해 주세요.')
      const { buyer, box } = item as { buyer: unknown; box?: unknown }
      if (typeof buyer !== 'string' || buyer === '' || [...buyer].length > 128 || seen.has(buyer)) return bad('접수할 묶음을 확인해 주세요.')
      if (box !== undefined && !(typeof box === 'string' && (BOX_KINDS as readonly string[]).includes(box))) return bad('상자 크기를 골라 주세요.')
      seen.add(buyer)
      out.push({ buyer, box: (box as BoxKind | undefined) ?? null })
    }
    return { ok: true, items: out }
  }

  /**
   * 한 번에 접수 (AC-T1-30): 묶음마다 따로 — 접수 직전 다시 판단(PC-4) → PENDING 시도(새 무작위 요청 번호) → 택배사 → BOOKED(+ 포장 기록 배송 완료)·FAILED·UNKNOWN.
   * UNKNOWN(또는 2분 넘은 PENDING)인 묶음은 다시 판단하지 않고 같은 요청 번호로 다시 확인한다("다시 확인" — "실패한 것만 다시"도 이 경로).
   * 같은 화면 요청 번호면 택배사에 새로 보내지 않고 처음 결과(AC-T1-31). 모르는 구매자가 섞이면 404(아무것도 하지 않음)
   */
  async book(sellerId: string, accountId: string, date: string, requestId: string, items: readonly { buyer: string; box: BoxKind | null }[]): Promise<Outcome<{ results: BookItemResult[] }>> {
    if (!isValidDate(date)) return NOT_FOUND
    const { db, masterKey } = this.#deps
    const prior = await requestRow(db, sellerId, requestId)
    if (prior !== null) return this.#priorBook(sellerId, date, requestId, prior)
    const runtime = await this.#deps.writer.read(sellerId, date, false)
    if (runtime.seq === 0 || runtime.scopeId === null) return NOT_FOUND
    if (items.some((item) => getBuyer(runtime.state, item.buyer) === null)) return NOT_FOUND
    if (await this.#sealed(db, sellerId, runtime.scopeId)) return problem(409, 'SEALED', SEALED_MESSAGE)
    const settings = await readSettings(db, masterKey, sellerId)
    const blocked = this.#blocked(settings)
    if (blocked !== null) return problem(409, 'PARCEL_BLOCKED', blocked.message)
    const adapter = this.#carriers[settings.carrier as CarrierCode] as CarrierAdapter
    if (!(await claimRequest(db, { sellerId, requestId, date, kind: 'BOOK', targets: items.map((item) => item.buyer), result: null, now: new Date(this.#deps.clock.now()) }))) {
      const again = await requestRow(db, sellerId, requestId)
      return again === null ? problem(409, 'REQUEST_ERROR', PARCEL_MESSAGES.request) : this.#priorBook(sellerId, date, requestId, again)
    }
    const key = JSON.stringify([sellerId, requestId])
    const flight = this.#runBook(sellerId, accountId, date, items, adapter, settings)
    this.#flights.set(key, flight)
    let results: BookItemResult[]
    try {
      results = await flight
    } finally {
      this.#flights.delete(key)
    }
    await saveRequestResult(db, sellerId, requestId, JSON.stringify(results))
    return ok({ results })
  }

  /** 같은 화면 요청 번호: 처음 결과 → 처리 중이면 기다림 → (서버가 멈췄으면) 그 묶음들의 지금 시도로 만든 답 */
  async #priorBook(sellerId: string, date: string, requestId: string, prior: { date: string; kind: string; targets: string; result: string | null }): Promise<Outcome<{ results: BookItemResult[] }>> {
    if (prior.kind !== 'BOOK' || prior.date !== date) return problem(409, 'REQUEST_ERROR', PARCEL_MESSAGES.request)
    if (prior.result !== null) return ok({ results: JSON.parse(prior.result) as BookItemResult[] })
    const flight = this.#flights.get(JSON.stringify([sellerId, requestId]))
    if (flight !== undefined) return ok({ results: await flight })
    let targets: string[] = []
    try {
      const parsed: unknown = JSON.parse(prior.targets)
      if (Array.isArray(parsed)) targets = parsed.filter((item): item is string => typeof item === 'string')
    } catch {
      targets = []
    }
    const attempts = await latestAttempts(this.#deps.db, sellerId, date)
    return ok({ results: targets.map((buyer) => this.#resultOf(buyer, attempts.get(buyer) ?? null)) })
  }

  /** 시도 하나 → 묶음 결과 */
  #resultOf(buyer: string, attempt: AttemptRow | null): BookItemResult {
    if (attempt === null) return { buyer, ok: false, reason: 'BOOKING', message: ELIGIBILITY_MESSAGES.BOOKING }
    const state = stateNow(attempt, this.#deps.clock.now())
    if (state === 'BOOKED' && attempt.invoice !== null) return { buyer, ok: true, invoice: attempt.invoice, invoiceText: formatInvoiceNumber(attempt.invoice) }
    if (state === 'FAILED') {
      const reason = attempt.reason === 'ADDRESS' ? 'ADDRESS' : 'REJECTED'
      return { buyer, ok: false, reason, message: FAILURE_MESSAGES[reason] }
    }
    if (state === 'UNKNOWN') return { buyer, ok: false, reason: 'UNAVAILABLE', message: FAILURE_MESSAGES.UNAVAILABLE }
    if (state === 'CANCELLED') return { buyer, ok: false, reason: 'NO_ITEMS', message: CANCELLED_WORD }
    return { buyer, ok: false, reason: 'BOOKING', message: ELIGIBILITY_MESSAGES.BOOKING }
  }

  async #runBook(sellerId: string, accountId: string, date: string, items: readonly { buyer: string; box: BoxKind | null }[], adapter: CarrierAdapter, settings: StoredSettings): Promise<BookItemResult[]> {
    const results: BookItemResult[] = new Array<BookItemResult>(items.length)
    let next = 0
    const lanes = Math.max(1, Math.min(this.#deps.options.concurrency ?? BOOK_CONCURRENCY, items.length))
    await Promise.all(
      Array.from({ length: lanes }, async () => {
        for (;;) {
          const index = next++
          if (index >= items.length) return
          const item = items[index] as { buyer: string; box: BoxKind | null }
          results[index] = await this.#bookOne(sellerId, accountId, date, item.buyer, item.box ?? settings.box, adapter, settings)
        }
      }),
    )
    return results
  }

  /** 묶음 하나: 준비(락 안) → 택배사(락 밖) → 마무리(락 안) */
  async #bookOne(sellerId: string, accountId: string, date: string, buyer: string, box: BoxKind, adapter: CarrierAdapter, settings: StoredSettings): Promise<BookItemResult> {
    const prepared = await this.#prepare(sellerId, accountId, date, buyer, box, adapter.code)
    if (prepared.kind === 'skip') return prepared.result
    const { attempt } = prepared
    const sender = settings.sender as ParcelSender
    let answer
    try {
      answer = await adapter.book({ requestKey: attempt.requestKey, customerNo: settings.customerNo, receiver: prepared.receiver, sender, box: attempt.box, count: attempt.qty })
    } catch {
      answer = { kind: 'UNKNOWN' as const }
    }
    if (answer.kind === 'UNKNOWN') this.#deps.log({ level: 'warn', code: 'PARCEL_BOOK_UNKNOWN', seller: sellerId, date, reason: adapter.code })
    return this.#finish(sellerId, accountId, date, attempt, answer)
  }

  async #prepare(sellerId: string, accountId: string, date: string, buyer: string, box: BoxKind, carrier: CarrierCode): Promise<Prepared> {
    const { db, writer, masterKey } = this.#deps
    const skip = (result: BookItemResult): Prepared => ({ kind: 'skip', result })
    return writer.withScope(sellerId, date, false, async (runtime, catchUpIn): Promise<Prepared> => {
      if (runtime.seq === 0 || runtime.scopeId === null) return skip({ buyer, ok: false, reason: 'BUYER', message: '구매자를 다시 확인해 주세요.' })
      const scopeId = runtime.scopeId
      return db.transaction(async (tx) => {
        await catchUpIn(tx)
        if (await this.#sealed(tx, sellerId, scopeId)) return skip({ buyer, ok: false, reason: 'SEALED', message: SEALED_MESSAGE })
        const { state } = runtime
        if (!ParcelService.current(state, buyer)) return skip({ buyer, ok: false, reason: 'BUYER', message: '구매자를 다시 확인해 주세요.' })
        const now = this.#deps.clock.now()
        const latest = await latestAttempt(tx, sellerId, date, buyer)
        const address = await addressRow(tx, sellerId, date, buyer)
        if (latest !== null && stateNow(latest, now) === 'UNKNOWN') {
          // 다시 확인: 다시 판단하지 않고 같은 요청 번호로 (배송지는 잠겨 있어 그때와 같다). 다른 기기가 함께 다시 보내지 않게 PENDING으로 돌려 둔다
          const receiver = this.#open(sellerId, address)
          if (receiver === null) return skip({ buyer, ok: false, reason: 'ADDRESS_EXPIRED', message: PARCEL_MESSAGES.addressExpired })
          if (!(await moveAttempt(tx, sellerId, latest.id, ['PENDING', 'UNKNOWN'], { state: 'PENDING', updatedAt: new Date(now) }))) return skip(this.#resultOf(buyer, await attemptById(tx, sellerId, latest.id)))
          return { kind: 'send', attempt: latest, receiver }
        }
        const records = await packingRows(tx, sellerId, scopeId, buyer)
        const row = this.#row(state, date, buyer, records, address, latest, box, sellerId)
        if (!row.ready) return skip({ buyer, ok: false, reason: row.reason as EligibilityReason, message: row.message as string })
        const receiver = this.#open(sellerId, address) as ParcelAddress
        const attempt = await insertAttempt(tx, { sellerId, date, buyer, carrier, box, qty: row.qty, accountId, now: new Date(now) })
        if (attempt === null) return skip({ buyer, ok: false, reason: 'BOOKING', message: ELIGIBILITY_MESSAGES.BOOKING })
        return { kind: 'send', attempt, receiver }
      })
    })
  }

  /** 택배사 답을 적는다 (같은 트랜잭션에 포장 기록 "배송 완료 — 송장번호", 누가 = 접수한 계정) */
  async #finish(sellerId: string, accountId: string, date: string, attempt: AttemptRow, answer: { kind: 'BOOKED'; invoice: string } | { kind: 'FAILED'; reason: 'ADDRESS' | 'REJECTED' } | { kind: 'UNKNOWN' }): Promise<BookItemResult> {
    const { db, writer } = this.#deps
    const result = await writer.withScope(sellerId, date, false, async (runtime, catchUpIn) =>
      db.transaction(async (tx) => {
        await catchUpIn(tx)
        const now = new Date(this.#deps.clock.now())
        let shipped = false
        if (answer.kind === 'BOOKED') {
          const moved = await moveAttempt(tx, sellerId, attempt.id, ['PENDING', 'UNKNOWN'], { state: 'BOOKED', reason: null, invoice: answer.invoice, bookedAt: now, track: 'ACCEPTED', trackedAt: now, updatedAt: now })
          if (moved && runtime.scopeId !== null) {
            const packing = replayPacking(await packingRows(tx, sellerId, runtime.scopeId, attempt.buyer))
            if (!(packing.phase === 'SHIPPED' && packing.invoice === answer.invoice)) {
              await tx
                .insert(packingRecords)
                .values({ sellerId, scopeId: runtime.scopeId, date, buyer: attempt.buyer, kind: 'SHIPPED', items: null, invoice: answer.invoice, accountId, requestId: `parcel:${attempt.id}:book`, createdAt: now })
                .onConflictDoNothing({ target: [packingRecords.sellerId, packingRecords.requestId] })
              shipped = true
            }
          }
        } else if (answer.kind === 'FAILED') {
          await moveAttempt(tx, sellerId, attempt.id, ['PENDING', 'UNKNOWN'], { state: 'FAILED', reason: answer.reason, updatedAt: now })
        } else {
          await moveAttempt(tx, sellerId, attempt.id, ['PENDING', 'UNKNOWN'], { state: 'UNKNOWN', reason: 'UNAVAILABLE', updatedAt: now })
        }
        return { row: await attemptById(tx, sellerId, attempt.id), shipped }
      }),
    )
    this.#deps.hub.publishNamed(sellerId, 'parcel', { date, buyer: attempt.buyer })
    if (result.shipped) this.#deps.hub.publishNamed(sellerId, 'packing', { date, buyer: attempt.buyer })
    return this.#resultOf(attempt.buyer, result.row)
  }

  // ── 접수 취소 (PC-5 "취소", AC-T1-37) ────────────────────────────────

  /**
   * 접수 취소: BOOKED이고 조회 상태가 접수됨(집하 전)일 때만 택배사에 취소. 받으면 같은 트랜잭션에 CANCELLED + 포장 기록 "배송 취소"(→ 포장 완료).
   * 집하 뒤·택배사 거절 → 409 그대로. 택배사가 답하지 않으면 BOOKED 그대로 503(다시 보내도 같은 송장 취소라 안전하다 — 요청 번호를 적지 않는다)
   */
  async cancel(sellerId: string, accountId: string, date: string, requestId: string, buyer: string): Promise<Outcome<BundleView>> {
    if (!isValidDate(date)) return NOT_FOUND
    const { db, writer } = this.#deps
    const prior = await requestRow(db, sellerId, requestId)
    if (prior !== null) {
      if (prior.kind !== 'CANCEL' || prior.date !== date) return problem(409, 'REQUEST_ERROR', PARCEL_MESSAGES.request)
      return this.bundle(sellerId, date, buyer)
    }
    const runtime0 = await writer.read(sellerId, date, false)
    if (runtime0.seq === 0 || runtime0.scopeId === null || getBuyer(runtime0.state, buyer) === null) return NOT_FOUND
    const checked = await writer.withScope(sellerId, date, false, async (runtime, catchUpIn): Promise<Outcome<AttemptRow>> =>
      db.transaction(async (tx) => {
        await catchUpIn(tx)
        if (runtime.scopeId === null) return NOT_FOUND
        if (await this.#sealed(tx, sellerId, runtime.scopeId)) return problem(409, 'SEALED', SEALED_MESSAGE)
        const attempt = await latestAttempt(tx, sellerId, date, buyer)
        if (attempt === null || attempt.state !== 'BOOKED' || attempt.invoice === null) return problem(409, 'NO_PARCELS', PARCEL_MESSAGES.noBooked)
        if (attempt.track !== null && attempt.track !== 'ACCEPTED') return problem(409, 'PICKED_UP', PARCEL_MESSAGES.pickedUp)
        return ok(attempt)
      }),
    )
    if (checked.kind !== 'ok') return checked
    const attempt = checked.value
    const adapter = this.#carriers[attempt.carrier]
    if (adapter === undefined) return problem(503, 'CARRIER_UNAVAILABLE', PARCEL_MESSAGES.cancelUnknown)
    let answer
    try {
      answer = await adapter.cancel(attempt.invoice as string)
    } catch {
      answer = { kind: 'UNKNOWN' as const }
    }
    if (answer.kind === 'UNKNOWN') {
      this.#deps.log({ level: 'warn', code: 'PARCEL_CANCEL_UNKNOWN', seller: sellerId, date, reason: attempt.carrier })
      return problem(503, 'CARRIER_UNAVAILABLE', PARCEL_MESSAGES.cancelUnknown)
    }
    if (answer.kind === 'REFUSED') return problem(409, 'PICKED_UP', PARCEL_MESSAGES.pickedUp)
    try {
      const outcome = await writer.withScope(sellerId, date, false, async (runtime, catchUpIn): Promise<Outcome<BundleView>> =>
        db.transaction(async (tx) => {
          await catchUpIn(tx)
          const now = new Date(this.#deps.clock.now())
          const moved = await moveAttempt(tx, sellerId, attempt.id, ['BOOKED'], { state: 'CANCELLED', cancelledAt: now, cancelledBy: accountId, updatedAt: now })
          if (moved && runtime.scopeId !== null && replayPacking(await packingRows(tx, sellerId, runtime.scopeId, buyer)).phase === 'SHIPPED') {
            await tx
              .insert(packingRecords)
              .values({ sellerId, scopeId: runtime.scopeId, date, buyer, kind: 'UNSHIPPED', items: null, invoice: null, accountId, requestId: `parcel:${attempt.id}:cancel`, createdAt: now })
              .onConflictDoNothing({ target: [packingRecords.sellerId, packingRecords.requestId] })
          }
          if (!(await claimRequest(tx, { sellerId, requestId, date, kind: 'CANCEL', targets: [buyer], result: null, now }))) throw new RequestTaken()
          return ok(await this.#bundleView(tx, sellerId, runtime, date, buyer))
        }),
      )
      this.#deps.hub.publishNamed(sellerId, 'parcel', { date, buyer })
      this.#deps.hub.publishNamed(sellerId, 'packing', { date, buyer })
      return outcome
    } catch (error) {
      if (error instanceof RequestTaken) return this.bundle(sellerId, date, buyer)
      throw error
    }
  }

  // ── 운송장 (PC-7, AC-T1-43) ──────────────────────────────────────────

  /**
   * 운송장 PDF: buyer가 있으면 그 묶음 하나(`운송장-YYYY-MM-DD-<이름>.pdf`), 없으면 그 날짜의 접수함 전부(목록 순서, `운송장-YYYY-MM-DD-전부.pdf`).
   * BOOKED이고 배송지가 남은 묶음만. 접수함이 없으면 409, 배송지를 지운 묶음 하나짜리는 409. 그리기는 작업 워커(I2 파일 작업 한도 — 바쁘면 429)
   */
  async waybill(sellerId: string, date: string, buyer: string | null, signal?: AbortSignal): Promise<Outcome<FileResult>> {
    const runtime = await this.#realScope(sellerId, date)
    if (runtime === null) return NOT_FOUND
    const { state } = runtime
    if (buyer !== null && getBuyer(state, buyer) === null) return NOT_FOUND
    const { db, masterKey } = this.#deps
    const settings = await readSettings(db, masterKey, sellerId)
    if (settings.sender === null) return problem(409, 'PARCEL_BLOCKED', PARCEL_MESSAGES.noSender)
    const attempts = await latestAttempts(db, sellerId, date)
    const addresses = await addressRowsOf(db, sellerId, date)
    const order = buyer === null ? ParcelService.buyersOf(state, date, attempts) : [buyer]
    const booked = order.filter((id) => attempts.get(id)?.state === 'BOOKED' && attempts.get(id)?.invoice !== null)
    if (booked.length === 0) return problem(409, 'NO_PARCELS', PARCEL_MESSAGES.noBooked)
    const sender = settings.sender
    const list: WaybillData[] = []
    for (const id of booked) {
      const attempt = attempts.get(id) as AttemptRow
      const receiver = this.#open(sellerId, addresses.get(id))
      if (receiver === null) continue
      list.push({
        carrier: attempt.carrier,
        invoice: attempt.invoice as string,
        receiver,
        sender: { name: sender.name, phone: sender.phone, address: sender.address, detail: sender.detail },
        itemCount: attempt.qty,
        box: attempt.box,
        bookedDate: kstDate((attempt.bookedAt ?? attempt.createdAt).getTime()),
      })
    }
    if (list.length === 0) return problem(409, 'ADDRESS_EXPIRED', PARCEL_MESSAGES.addressExpired)
    let rendered: WaybillsPdfResult
    try {
      rendered = await this.#deps.work.documents.run<WaybillsPdfResult>(sellerId, 'waybillPdf', { list }, signal === undefined ? {} : { signal })
    } catch (error) {
      if (error instanceof WorkBusy) return problem(429, 'BUSY', '지금 다른 파일을 만들고 있어요. 잠시 뒤 다시 눌러 주세요.')
      if (error instanceof WorkFailed) {
        this.#deps.log({ level: error.reason === 'aborted' ? 'info' : 'error', code: 'DOCUMENT_WORK_FAILED', seller: sellerId, date, errorKind: error.reason })
        return problem(500, 'FILE_FAILED', '파일을 만들지 못했어요. 잠시 뒤 다시 눌러 주세요.')
      }
      throw error
    }
    const skipped = rendered.outcomes.filter((outcome) => !outcome.ok)
    if (rendered.pdf === null) {
      const tooLong = skipped.some((outcome) => outcome.error?.code === 'TOO_LONG')
      return problem(422, 'WAYBILL_TOO_LONG', tooLong ? (skipped[0]?.error?.message ?? '주소가 길어 운송장에 다 들어가지 않아요.') : '운송장에 넣을 수 없는 값이 있어요.')
    }
    const name = buyer === null ? '전부' : fileNamePart(getBuyer(state, buyer)?.display ?? '')
    return ok({
      bytes: rendered.pdf,
      type: MIME.pdf,
      fileName: `운송장-${date}-${name}.pdf`,
      fallback: buyer === null ? `waybills-${date}-all.pdf` : `waybill-${date}.pdf`,
      headers: { 'X-Waybill-Count': String(list.length - skipped.length), 'X-Waybill-Skipped': String(skipped.length + (booked.length - list.length)) },
    })
  }

  // ── 합치기 (PC-3 "합치기·떼어 내기", AC-T1-05) ───────────────────────

  /**
   * 합치기·떼어 내기를 엔진 이벤트로 적기 전에(같은 범위 줄·락 안) 본다: 떼어 낼 구매자가 붙은 지금의 구매자 Y에 접수 결과를 기다리는 시도(PENDING·UNKNOWN)가 있으면 409.
   * (BOOKED은 포장 기록 배송 완료 때문에 이미 막힌다 — D-I2-20. 합쳐질 X에 살아 있는 시도가 있으면 X는 포장 완료라 이미 막힌다)
   */
  static async mergeGuard(tx: Db, sellerId: string, date: string, state: EngineState, fields: Readonly<Record<string, unknown>>, now: number): Promise<{ status: number; code: 'PACKING_RECORDED'; message: string; problems: [] } | null> {
    const from = fields['from']
    if (typeof from !== 'string' || from === '' || fields['type'] !== 'buyer.unmerge' || getBuyer(state, from) === null) return null
    const into = currentBuyerOf(state, from)
    if (into === null || into === from) return null
    const attempt = await latestAttempt(tx, sellerId, date, into)
    if (attempt !== null && ['PENDING', 'UNKNOWN'].includes(stateNow(attempt, now))) return { status: 409, code: 'PACKING_RECORDED', message: PARCEL_MESSAGES.unmergeBooking, problems: [] }
    return null
  }

  // ── 주기 작업: 배송 조회·배송지 정리 (PC-8·PC-3, AC-T1-03·50) ───────────

  /** 서버 시작 때 한 번, 그 뒤 조회 간격마다 (배송지 정리는 정리 간격마다) */
  start(): void {
    if (this.#loop !== null) return
    this.#stopped = false
    const trackEvery = this.#deps.options.trackEveryMs ?? TRACK_EVERY_MS
    const sweepEvery = this.#deps.options.sweepEveryMs ?? SWEEP_EVERY_MS
    const tick = Math.max(100, Math.min(trackEvery, sweepEvery))
    this.#loop = (async () => {
      let lastTrack = -Infinity
      let lastSweep = -Infinity
      while (!this.#stopped) {
        const now = this.#deps.timer.now()
        try {
          if (now - lastSweep >= sweepEvery) {
            lastSweep = now
            await this.sweepOnce()
          }
          if (now - lastTrack >= trackEvery) {
            lastTrack = now
            await this.trackOnce()
          }
        } catch (error) {
          this.#deps.log({ level: 'error', code: 'PARCEL_JOB_FAILED', errorKind: errorKind(error) })
        }
        if (this.#stopped) break
        this.#wake = new AbortController()
        await this.#deps.timer.sleep(tick, this.#wake.signal)
      }
    })()
  }

  async stop(): Promise<void> {
    this.#stopped = true
    this.#wake.abort()
    await this.#loop
    this.#loop = null
  }

  /** 보관 기간(날짜 + 30일의 0시 KST)이 지난 배송지를 모두 지운다 (다시 해도 같다). 지운 수 */
  async sweepOnce(): Promise<number> {
    const count = await sweepAddresses(this.#deps.db, lastExpiredDate(this.#deps.clock.now()))
    if (count > 0) this.#deps.log({ level: 'info', code: 'PARCEL_ADDRESSES_SWEPT', count })
    return count
  }

  /**
   * 배송 조회 한 바퀴: BOOKED이고 접수 뒤 14일 안·도착 전인 시도를 택배사마다 송장번호 여럿으로 한 번에 묻는다. 바뀐 상태·마지막 확인 시각을 적는다.
   * 실패하면 그대로 두고 택배사 코드·상태 코드만 로그. 조회 API가 없는 택배사는 건너뛴다(접수됨에서 멈춤). 조회한 시도 수
   */
  async trackOnce(): Promise<number> {
    const now = this.#deps.clock.now()
    const candidates = await trackCandidates(this.#deps.db, new Date(now - TRACK_STOP_MS))
    let asked = 0
    for (const code of CARRIER_CODES) {
      const adapter = this.#carriers[code]
      const track = adapter?.track
      if (track === undefined) continue
      const mine = candidates.filter((row) => row.carrier === code)
      for (let start = 0; start < mine.length; start += TRACK_CHUNK) {
        const chunk = mine.slice(start, start + TRACK_CHUNK)
        let answer
        try {
          answer = await track(chunk.map((row) => row.invoice))
        } catch {
          answer = { ok: false as const, status: null }
        }
        if (!answer.ok) {
          this.#deps.log({ level: 'warn', code: 'PARCEL_TRACK_FAILED', reason: code, ...(answer.status === null ? {} : { status: answer.status }) })
          continue
        }
        asked += chunk.length
        const at = new Date(this.#deps.clock.now())
        const changed = new Set<string>()
        for (const row of chunk) {
          const status = answer.items.get(row.invoice)
          if (status === undefined) continue
          await setTrack(this.#deps.db, row.sellerId, row.id, status, at)
          if (status !== row.track) changed.add(JSON.stringify([row.sellerId, row.date, row.buyer]))
        }
        for (const key of changed) {
          const [sellerId, date, buyer] = JSON.parse(key) as [string, string, string]
          this.#deps.hub.publishNamed(sellerId, 'parcel', { date, buyer })
        }
      }
    }
    return asked
  }
}
