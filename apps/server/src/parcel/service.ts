// 택배 자동 접수 (STL-08 T1 세부 — PARCEL_RULES PC-0~PC-8, D-T1-01~D-T1-14). 판정 엔진 밖이다: 정산 묶음·입금 상태·포장 상태는 코어·STL-08 결과 그대로 읽는다.
// - 묶음 = (판매자, 실제 범위 날짜, 지금의 구매자 ID). 묶음 하나 = 택배 하나. 접수가 되면 같은 트랜잭션에 STL-08 포장 기록 "배송 완료 — 송장번호"를,
//   접수 취소가 되면 "배송 취소"를 덧붙인다(판매대장 배송 칸·합치기 막기·배송 뒤 바뀜이 지금 규칙 그대로).
// - 쓰기(배송지·접수 시도·취소)는 범위 줄(writer.withScope) 안에서 범위 어드바이저리 락을 잡은 트랜잭션으로 한다 — 포장 명령·엔진 기록과 같은 줄이라
//   접수 직전 다시 판단(PC-4)과 PENDING 시도 만들기 사이에 입금·포장·배송지가 바뀌지 않는다. 택배사 호출은 락 밖에서 한다(판매를 멈추지 않는다, PC-0 5).
// - 한 묶음에 살아 있는 시도는 많아야 하나(DB 부분 고유 색인 parcels_live_uq, PC-INV-1). 응답이 끊기면 UNKNOWN으로 두고 같은 요청 번호로 다시 확인한다.
// - 배송지 원문은 로그·오류·감사 메시지·발송함·이벤트 로그·요청 번호 기록에 남기지 않는다. 택배사 원래 응답 글은 읽지 않는다(carrier.ts).
// - 판매자 ID 조건은 늘 세션의 판매자다. 없는 범위·모르는 구매자는 404(다른 판매자의 묶음이 있는지 드러내지 않는다).
import { currentBuyerOf, getBuyer, getSettlement, isValidDate, type EngineState } from '@livejjim/core'
import { EPOST_VISIT_CLASS, EPOST_VISIT_MAX_ROWS, formatInvoiceNumber, textRowsToXlsx, type EpostVisitRow, type WaybillData, type WaybillsPdfResult } from '@livejjim/documents'
import { trimLabelText } from '@livejjim/label'
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
import { emptyState, type ScopeRuntime } from '../runtime.ts'
import { readShop } from '../shop.ts'
import { iso, kstDate, type Clock } from '../time.ts'
import { WorkBusy, WorkFailed, type WorkPools } from '../work-pool.ts'
import { SEALED_MESSAGE, type ScopeWriter } from '../writer.ts'
import { kstMidnightAfter, type Timer } from '../youtube/timer.ts'
import type { LedgerPrefill, LedgerService } from '../customers/ledger.ts' // KP1
import { maskRecipient } from '../customers/ledger-rules.ts' // KP1
import {
  CARRIER_CODES,
  CARRIER_LABELS,
  CARRIER_NAME_MAX,
  OTHER_CARRIER,
  OTHER_CARRIER_LABEL,
  SETTINGS_CARRIER_ORDER,
  isSettingsCarrier,
  itemText,
  type CancelResult,
  type CarrierAdapter,
  type CarrierCode,
  type CarrierAccount,
  type ParcelSender,
  type SettingsCarrier,
} from './carrier.ts'
import {
  EPOST_FILE_COLUMNS,
  EPOST_FILE_MAX,
  EPOST_FORM_HINTS,
  EPOST_HOSTS,
  EPOST_MESSAGES,
  EPOST_PAGES,
  EPOST_WORDS,
  epostFileRow,
  epostFill,
  epostTransition,
  readEpostPassword,
  type EpostAction,
  type EpostFill,
  type EpostFormHints,
  type EpostState,
} from './epost-window.ts'
import {
  BOOK_MAX,
  BOX_KINDS,
  CANCELLED_WORD,
  ELIGIBILITY_MESSAGES,
  EXTRA_DAY_MAX,
  FAILURE_MESSAGES,
  PARCEL_MESSAGES,
  SENDER_FIELDS,
  STALE_PENDING_MS,
  TRACK_EVERY_MS,
  TRACK_STOP_MS,
  TRACK_WORDS,
  addressProblems,
  parcelEligibility,
  phoneLast4,
  readAddress,
  readAddressInput,
  readBox,
  readQty,
  readSender,
  senderProblems,
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
  epostRow,
  epostRowsOf,
  writeEpost,
  type EpostRow,
  deleteExtra,
  directOf,
  directRequestKey,
  extraDates,
  extraRow,
  extrasOf,
  insertAttempt,
  insertExtra,
  isExtraBuyer,
  latestAttempt,
  latestAttempts,
  moveAttempt,
  newExtraId,
  openAddress,
  putAddress,
  readSettings,
  requestRow,
  saveRequestResult,
  setExtraQty,
  setTrack,
  stateNow,
  sweepAddresses,
  takeOverRequest,
  trackCandidates,
  writeSettings,
  type AddressRow,
  type AttemptRow,
  type DirectKind,
  type ExtraRow,
  type ParcelRequestKind,
  type RequestRow,
  type StoredSettings,
} from './store.ts'
import { zipQuery, type ZipFound } from './epost-public.ts'

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
/** 우체국 인증키·보안키 길이 상한 (D-REAL-04) */
export const EPOST_KEY_MAX = 100

export interface ParcelOptions {
  /** 이어진 택배사 어댑터 (T1: 가짜 택배사 FAKE — 시험 모드·서버 시험만. 운영 기동에는 없다 — 쓰는 택배사는 고를 수 있고 자동 접수만 막힌다, FB1 D-FB1-04) */
  readonly carriers?: Partial<Record<CarrierCode, CarrierAdapter>>
  /** 조회 간격 (기본 30분 — 시험 모드는 줄일 수 있다) */
  readonly trackEveryMs?: number
  /** 배송지 정리 간격 (기본 1시간) */
  readonly sweepEveryMs?: number
  /** 한 번에 접수할 때 동시에 보내는 수 (기본 4) */
  readonly concurrency?: number
  /** 우편번호 찾기 (공공데이터포털 우체국 — D-REAL-08). 우체국 방문접수 파일의 빈 우편번호를 채운다(D-UX3-36). 없으면 빈 칸(우체국 [주소검증]) */
  readonly findZip?: (address: string) => Promise<ZipFound>
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
  /** KP1 손님 장부 (묶음 배송지 칸의 "확인 전"·[배송지 확인]·링크 동의). 없으면 장부를 보지 않는다 */
  readonly ledger?: LedgerService
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
  /** 판매자가 인터넷우체국에서 직접 접수하고 송장번호만 적은 묶음 (D-UX3-37 — VISIT 방문접수·COUNTER 창구 간편사전접수, 자동 접수면 null) */
  readonly direct: DirectKind | null
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
  /** 우체국 창구소포 사전접수 기록 (EP1 PC-9 — 없으면 null) */
  readonly epost: EpostBrief | null
  /** 직접 넣은 택배 (D-UX3-38 — 방송 판매 기록 없음, 입금·포장 판단 없음) */
  readonly extra: boolean
}

/** 묶음의 우체국 사전접수 줄 (EP1 PC-9) */
export interface EpostBrief {
  readonly state: EpostState
  /** 화면 낱말 (우체국 입력 완료 · 우체국 사전접수 완료) */
  readonly word: string
  readonly receiptNo: string | null
  /** 상태가 된 시각 (UTC ISO) */
  readonly at: string
}

/** 앱 안 우체국 화면 자동 입력에 쓰는 값 (EP1 PC-9 1) */
export interface EpostFillView {
  readonly date: string
  readonly buyer: string
  readonly fill: EpostFill
  readonly row: ParcelRow
  readonly pages: typeof EPOST_PAGES
  readonly hosts: readonly string[]
  readonly form: EpostFormHints
  /** 설정의 비회원 신청 비밀번호 (없으면 null — 앱이 우체국 약관 쪽 비밀번호 칸에 넣는다, D-EP1-14) */
  readonly password: string | null
}

export interface ParcelDay {
  readonly date: string
  readonly seq: number
  /** 목록 위 한 문장 (보내는 사람 없음·택배사 없음 — 접수 버튼을 잠근다) */
  readonly blocked: { readonly code: ParcelBlockedCode; readonly message: string } | null
  /** 쓰는 택배사 (이름 = 화면 낱말, 직접 입력이면 적은 이름 — FB1 D-FB1-04) */
  readonly carrier: { readonly code: SettingsCarrier; readonly name: string } | null
  readonly box: BoxKind
  readonly ready: readonly ParcelRow[]
  readonly excluded: readonly ParcelRow[]
  readonly booked: readonly ParcelRow[]
  /** 우체국에 사전접수한 묶음 (EP1 PC-9 — 고를 수 있음·빠짐에서 뺀다) */
  readonly epost: readonly ParcelRow[]
}

export interface AddressView extends ParcelAddress {
  readonly source: 'BUYER' | 'SELLER' | 'LEDGER'
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
  /** KP1: 저장한 배송지가 없을 때 손님 장부 연락처 "확인 전" (CR-4 — 보이기만, 복사하지 않음). 없으면 null */
  readonly ledger: LedgerPrefill | null
}

/**
 * 택배 화면 목록 위 막힘 (접수 버튼을 잠근다): 택배사를 고르지 않음(또는 이 서버에 없는 가짜 택배) · 고른 택배사에 자동 접수 어댑터가 없음(FB1 D-FB1-04) · 보내는 사람 없음
 */
export type ParcelBlockedCode = 'NO_CARRIER' | 'NO_AUTO_BOOK' | 'NO_SENDER'

/** 설정의 택배사 한 줄 (FB1 D-FB1-04 — 모두 고를 수 있다. autoBook = 이 서버에 그 택배사의 자동 접수 어댑터가 있다) */
export interface CarrierChoice {
  readonly code: SettingsCarrier
  readonly name: string
  readonly autoBook: boolean
}

export interface ParcelSettingsView {
  readonly carrier: SettingsCarrier | null
  /** 고른 택배사의 화면 이름 (직접 입력이면 적은 이름, 고르지 않았으면 null) */
  readonly carrierName: string | null
  readonly carriers: readonly CarrierChoice[]
  /** 고객 번호 끝 4자리 (없으면 null) */
  readonly customerNoLast4: string | null
  /** 우체국 인증키·보안키를 저장했다 (값은 내지 않는다 — D-REAL-04) */
  readonly epostReady: boolean
  readonly sender: ParcelSender | null
  /** 보내는 사람 이름 기본값 (가게 이름) */
  readonly shopName: string
  readonly box: BoxKind
  readonly boxes: readonly BoxKind[]
  /** 우체국 비회원 신청 비밀번호 (숫자 4자리 — 판매자만 본다, 없으면 null. EP1 D-EP1-14) */
  readonly epostPassword: string | null
}

export type BookItemResult =
  | { readonly buyer: string; readonly ok: true; readonly invoice: string; readonly invoiceText: string }
  | { readonly buyer: string; readonly ok: false; readonly reason: EligibilityReason | FailureReason | 'BUYER' | 'SEALED' | 'ADDRESS_EXPIRED' | 'EPOST'; readonly message: string }

/** 앱 안 우체국 화면 자동 채우기 자료 (D-UX3-37) */
export interface EpostKit {
  readonly date: string
  readonly sender: ParcelSender | null
  readonly receivers: readonly {
    readonly buyer: string
    readonly name: string
    /** 숫자만 */
    readonly phone: string
    /** 숫자 5자리 또는 "" */
    readonly zip: string
    readonly address: string
    readonly detail: string
    readonly memo: string
    readonly qty: number
    /** 내용물 (예: "물품 3개") */
    readonly content: string
    /** 상자 기본값의 우체국 중량(kg)·크기(cm) */
    readonly kg: number
    readonly cm: number
  }[]
  /** 방문접수 [파일(주소) 등록]에 넣는 파일 */
  readonly file: { readonly name: string; readonly base64: string }
}

/** 우체국 등기번호 (숫자 13자리) */
export const EPOST_REGI_RE = /^[0-9]{13}$/

/** 구매자 링크 쪽의 배송지 칸 (PC-3·PC-8) */
export type LinkSection =
  | { readonly kind: 'form' }
  | { readonly kind: 'saved'; readonly name: string; readonly last4: string }
  /** KP1: 손님 장부의 지난번 배송지 (가린 이름·끝 4자리만 — CR-4) */
  | { readonly kind: 'ledger'; readonly name: string; readonly last4: string }
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

/** KP1 장부 배송지 확인 문장 (CR-4) */
export const LEDGER_PARCEL_MESSAGES = {
  noLedger: '지난 주문 배송지가 없어졌어요. 배송지를 직접 적어 주세요.',
  changed: '지난 주문 배송지가 바뀌었어요. 다시 확인해 주세요.',
  exists: '이미 이 묶음에 배송지가 있어요.',
} as const

/** 그 날짜 배송지의 보관이 끝나는 시각 (날짜 + 30일의 0시 KST) */
export const addressExpiresAt = (date: string): number => kstMidnightAfter(date, ADDRESS_KEEP_DAYS)

/** 지금 지울 마지막 날짜: 그 날짜 + 30일 0시(KST)가 지났거나 같은 날짜 중 가장 늦은 것 */
export function lastExpiredDate(now: number): string {
  const today = kstDate(now)
  const [y, m, d] = today.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d - ADDRESS_KEEP_DAYS)).toISOString().slice(0, 10)
}

/** 직접 넣은 택배의 배송지 쓰기에 넘기는 빈 범위 (엔진 상태를 읽지 않는 쓰기만 온다 — D-UX3-38) */
const EMPTY_STATE = emptyState()

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
  available(code: SettingsCarrier): boolean {
    return code !== OTHER_CARRIER && this.#carriers[code] !== undefined
  }

  /** 설정에 저장된 택배사의 화면 이름 (직접 입력이면 적은 이름) */
  static carrierNameOf(settings: Pick<StoredSettings, 'carrier' | 'carrierName'>): string | null {
    if (settings.carrier === null) return null
    if (settings.carrier === OTHER_CARRIER) return settings.carrierName ?? OTHER_CARRIER_LABEL
    return CARRIER_LABELS[settings.carrier]
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
    return (await this.#scopeOf(sellerId, date)).runtime
  }

  /** 실제 범위와 봉인 여부 (직접 넣은 택배만 있는 날짜는 범위가 없다 — D-UX3-38) */
  async #scopeOf(sellerId: string, date: string): Promise<{ runtime: ScopeRuntime | null; sealed: boolean }> {
    if (!isValidDate(date)) return { runtime: null, sealed: false }
    const runtime = await this.#deps.writer.read(sellerId, date, false)
    if (runtime.seq === 0 || runtime.scopeId === null) return { runtime: null, sealed: false }
    if (await this.#sealed(this.#deps.db, sellerId, runtime.scopeId)) return { runtime: null, sealed: true }
    return { runtime, sealed: false }
  }

  /** 그 날짜의 직접 넣은 택배 (날짜가 틀리면 빈 표) */
  async #extrasOf(db: Db, sellerId: string, date: string): Promise<Map<string, ExtraRow>> {
    return isValidDate(date) ? extrasOf(db, sellerId, date) : new Map()
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
      direct: directOf(row.requestKey),
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
  #row(
    state: EngineState,
    date: string,
    buyer: string,
    records: readonly PackingRecordRow[],
    address: AddressRow | null | undefined,
    attempt: AttemptRow | null | undefined,
    defaultBox: BoxKind,
    sellerId: string,
    ledgered = false,
    epost: EpostRow | null | undefined = null,
  ): ParcelRow {
    const settlement = getSettlement(state, buyer, date)
    const info = getBuyer(state, buyer)
    const packing = packingStatusOf(state, date, buyer, records).status
    const opened = this.#open(sellerId, address) !== null
    // KP1: 장부 연락처를 "확인 전"으로 보이는 묶음은 UNCONFIRMED (PC-4 ADDRESS_UNCONFIRMED — CR-4)
    const addressKind: AddressState = !opened ? (ledgered ? 'UNCONFIRMED' : 'NONE') : address?.confirmed === true ? 'CONFIRMED' : 'UNCONFIRMED'
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
      extra: false,
      epost: ParcelService.epostBrief(epost),
    }
  }

  /** 우체국 기록 → 묶음 줄 (EP1 PC-9) */
  static epostBrief(row: EpostRow | null | undefined): EpostBrief | null {
    if (row === null || row === undefined) return null
    const at = row.state === 'RECEIVED' ? (row.receivedAt ?? row.updatedAt) : (row.filledAt ?? row.updatedAt)
    return { state: row.state, word: EPOST_WORDS[row.state], receiptNo: row.state === 'RECEIVED' ? row.receiptNo : null, at: iso(at.getTime()) }
  }

  /**
   * 직접 넣은 택배 한 줄 (D-UX3-38): 판매 기록이 없어 입금·포장 판단이 없다 — 배송지(판매자가 적어 확인함)가 남아 있으면 고를 수 있고,
   * 시도 상태(기다림·접수함)와 배송지 보관 기간만 본다. 이름 = 받는 분
   */
  #extraRow(sellerId: string, date: string, extra: ExtraRow, address: AddressRow | null | undefined, attempt: AttemptRow | null | undefined, defaultBox: BoxKind): ParcelRow {
    const opened = this.#open(sellerId, address)
    const now = this.#deps.clock.now()
    const parcelState = attempt === null || attempt === undefined ? 'NONE' : stateNow(attempt, now)
    const addressKind: AddressState = opened === null ? 'NONE' : 'CONFIRMED'
    const packing = parcelState === 'BOOKED' ? '배송 완료' : '포장 완료'
    const eligibility = parcelEligibility({ items: 1, shipping: 'NONE', payment: 'PAID', packing, parcel: parcelState, address: addressKind })
    const reason = 'reason' in eligibility ? eligibility.reason : null
    return {
      buyer: extra.id,
      name: opened?.name ?? '받는 분',
      phoneLast4: opened === null ? null : phoneLast4(opened.phone),
      itemCount: 0,
      qty: extra.qty,
      total: 0,
      payment: 'PAID',
      packing,
      shipping: 'NONE',
      address: addressKind,
      ready: reason === null,
      reason,
      message: reason === null ? null : ELIGIBILITY_MESSAGES[reason],
      box: reason === null || attempt === null || attempt === undefined ? defaultBox : attempt.box,
      parcel: this.#brief(attempt),
      extra: true,
      epost: null,
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
    // 가짜 택배는 시험 모드에서만 고를 수 있다 — 어댑터가 없는 서버에 남은 값은 고르지 않은 것으로 본다
    if (settings.carrier === null || (settings.carrier === 'FAKE' && !this.available('FAKE'))) return { code: 'NO_CARRIER', message: PARCEL_MESSAGES.noCarrier }
    // 쓰는 택배사를 골랐지만 자동 접수 어댑터가 없다 — 택배사에 아무것도 보내지 않는다(FB1 D-FB1-04)
    if (!this.available(settings.carrier)) return { code: 'NO_AUTO_BOOK', message: PARCEL_MESSAGES.noAutoBook }
    // 계약 정보가 있어야 하는 택배사(우체국)는 정보가 없으면 보내지 않는다 (D-REAL-04)
    if (this.#carriers[settings.carrier as CarrierCode]?.needsAccount === true && ParcelService.accountOf(settings) === null) return { code: 'NO_AUTO_BOOK', message: PARCEL_MESSAGES.noEpostAccount }
    if (settings.sender === null) return { code: 'NO_SENDER', message: PARCEL_MESSAGES.noSender }
    return null
  }

  /** 택배사 계약 정보 (우체국 인증키·보안키 + 고객 번호 — 하나라도 없으면 null) */
  static accountOf(settings: StoredSettings): CarrierAccount | null {
    if (settings.epost === null || settings.customerNo === null || settings.customerNo === '') return null
    return { key: settings.epost.key, secret: settings.epost.secret, customerNo: settings.customerNo }
  }

  // ── 설정 "택배" (PC-6, AC-T1-23) ─────────────────────────────────────

  async settings(sellerId: string): Promise<ParcelSettingsView> {
    const stored = await readSettings(this.#deps.db, this.#deps.masterKey, sellerId)
    const shop = await readShop(this.#deps.db, sellerId)
    return {
      carrier: stored.carrier,
      carrierName: ParcelService.carrierNameOf(stored),
      carriers: SETTINGS_CARRIER_ORDER.filter((code) => code !== 'FAKE' || this.available('FAKE')).map((code) => ({
        code,
        name: code === OTHER_CARRIER ? OTHER_CARRIER_LABEL : CARRIER_LABELS[code],
        autoBook: this.available(code),
      })),
      customerNoLast4: stored.customerNo === null || stored.customerNo === '' ? null : [...stored.customerNo].slice(-4).join(''),
      epostReady: stored.epost !== null,
      sender: stored.sender,
      shopName: shop.name,
      box: stored.box,
      boxes: BOX_KINDS,
      epostPassword: stored.epostPassword,
    }
  }

  /**
   * PUT 설정 "택배": { carrier, carrierName?, customerNo?, sender, box }. 틀리면 칸마다 문제(보내는 사람은 PC-2와 같은 칸 코드 — extra.codes).
   * 택배사(FB1 D-FB1-04): EPOST·CJ·HANJIN·LOGEN·LOTTE는 모두 고를 수 있다(자동 접수는 어댑터가 있을 때만), OTHER는 carrierName(다듬어 1~20자)과 함께,
   * FAKE는 시험 모드에서만. OTHER가 아닌 코드와 함께 온 carrierName은 저장하지 않는다. 이름은 로그에 남기지 않는다
   */
  async updateSettings(sellerId: string, body: Record<string, unknown>): Promise<Outcome<ParcelSettingsView>> {
    const allowed = ['carrier', 'carrierName', 'customerNo', 'sender', 'box', 'epostKey', 'epostSecret', 'epostPassword']
    const extra = Object.keys(body).filter((key) => !allowed.includes(key))
    if (extra.length > 0) return problem(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', unknownFieldProblems(extra))
    const current = await readSettings(this.#deps.db, this.#deps.masterKey, sellerId)
    const problems: FieldProblem[] = []
    let codes: AddressErrorCode[] = []
    // 택배사
    const carrierRaw = body.carrier
    let carrier: SettingsCarrier | null = current.carrier
    let carrierName: string | null = current.carrierName
    if (carrierRaw === null) carrier = null
    else if (carrierRaw === 'FAKE') {
      if (this.available('FAKE')) carrier = 'FAKE'
      else problems.push({ field: 'carrier', message: PARCEL_MESSAGES.fakeTestOnly })
    } else if (isSettingsCarrier(carrierRaw)) carrier = carrierRaw
    else if (carrierRaw !== undefined) problems.push({ field: 'carrier', message: PARCEL_MESSAGES.carrierInvalid })
    // 직접 입력 이름: OTHER를 새로 보냈으면 이름이 있어야 한다. OTHER 그대로이고 이름만 보냈으면 이름만 바꾼다
    const nameRaw = body.carrierName
    if (carrier === OTHER_CARRIER && (carrierRaw === OTHER_CARRIER || nameRaw !== undefined)) {
      // FB1 D-FB1-16 · PC-1: 택배사 이름은 L-2 글 다듬기(라벨 패키지 trimLabelText 그대로) — 서식 글자만이면 빈 글, 글자 수는 다듬은 뒤
      const tidy = typeof nameRaw === 'string' ? trimLabelText(nameRaw) : ''
      if (tidy === '') problems.push({ field: 'carrierName', message: PARCEL_MESSAGES.carrierNameEmpty })
      else if ([...tidy].length > CARRIER_NAME_MAX) problems.push({ field: 'carrierName', message: PARCEL_MESSAGES.carrierNameTooLong })
      else carrierName = tidy
    }
    if (carrier !== OTHER_CARRIER) carrierName = null
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
      const input = readAddressInput(body.sender, SENDER_FIELDS)
      if (input === null) problems.push({ field: 'sender', message: '보내는 사람 칸을 확인해 주세요.' })
      else {
        // 이름 1~30자(가게 이름 상한과 같음)·칸 문장은 보내는 사람 줄 (D-T1-16·17)
        const read = readSender(input)
        if ('errors' in read) {
          codes = [...read.errors]
          problems.push(...senderProblems(read.errors))
        } else sender = read.ok
      }
    }
    // 기본 택배 크기 (골든 parcel/box.json — 옛 낱말은 옮긴 코드로 저장, FB1 D-FB1-05)
    let box = current.box
    if (body.box !== undefined) {
      const read = readBox(body.box)
      if ('box' in read) box = read.box
      else problems.push({ field: 'box', message: PARCEL_MESSAGES.boxInvalid })
    }
    // 우체국 인증키·보안키 (D-REAL-04 — 적지 않으면 그대로, 둘 다 빈 글이면 지운다, 하나만 바꾸면 다른 하나는 저장한 것)
    let epost = current.epost
    if (body.epostKey !== undefined || body.epostSecret !== undefined) {
      const read = (value: unknown, kept: string): string | null => {
        if (value === undefined) return kept
        if (typeof value !== 'string') return null
        return value.replace(/\s+/g, '')
      }
      const key = read(body.epostKey, current.epost?.key ?? '')
      const secret = read(body.epostSecret, current.epost?.secret ?? '')
      if (key === null || secret === null || key.length > EPOST_KEY_MAX || secret.length > EPOST_KEY_MAX) problems.push({ field: 'epostKey', message: PARCEL_MESSAGES.epostKeyTooLong })
      else if (key === '' && secret === '') epost = null
      else if (key === '') problems.push({ field: 'epostKey', message: PARCEL_MESSAGES.noEpostAccount })
      else if (secret === '') problems.push({ field: 'epostSecret', message: PARCEL_MESSAGES.noEpostAccount })
      else epost = { key, secret }
    }
    // 우체국 비회원 신청 비밀번호 (EP1 D-EP1-14 — 적지 않으면 그대로, 빈 글·null이면 지운다)
    let epostPassword = current.epostPassword
    if (body.epostPassword !== undefined) {
      const read = readEpostPassword(body.epostPassword)
      if (read === 'invalid') problems.push({ field: 'epostPassword', message: EPOST_MESSAGES.passwordInvalid })
      else epostPassword = read
    }
    if (problems.length > 0) return problem(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', problems, codes.length > 0 ? { codes } : undefined)
    // 우체국을 쓰고 계약 정보가 바뀌었으면 우체국에 맞는지 물어 본 뒤 저장한다 (틀린 정보로 접수 날에 막히지 않게)
    const next: StoredSettings = { carrier, carrierName, customerNo, sender, box, epost, epostPassword }
    const adapter = carrier === null || carrier === OTHER_CARRIER ? undefined : this.#carriers[carrier]
    const account = ParcelService.accountOf(next)
    const changed = epost?.key !== current.epost?.key || epost?.secret !== current.epost?.secret || customerNo !== current.customerNo || carrier !== current.carrier
    if (adapter?.verify !== undefined && account !== null && changed) {
      let check
      try {
        check = await adapter.verify(account)
      } catch {
        check = 'UNKNOWN' as const
      }
      if (check === 'REJECTED') return problem(400, 'INVALID_INPUT', PARCEL_MESSAGES.epostRejected, [{ field: 'epostKey', message: PARCEL_MESSAGES.epostRejected }])
      if (check === 'UNKNOWN') return problem(503, 'CARRIER_UNAVAILABLE', PARCEL_MESSAGES.epostUnknown)
    }
    await writeSettings(this.#deps.db, this.#deps.masterKey, sellerId, next, new Date(this.#deps.clock.now()))
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
    // 직접 넣은 택배만 있는 날짜도 목록에 (D-UX3-38 — 봉인한 날짜는 그대로 뺀다)
    const sealedDates = new Set(rows.filter((row) => row.sealedAt !== null).map((row) => row.date))
    const dates = [...new Set([...rows.filter((row) => row.sealedAt === null).map((row) => row.date), ...(await extraDates(db, sellerId)).filter((date) => !sealedDates.has(date))])].sort().reverse()
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

  /** 그 날짜의 접수 목록 (AC-T1-22): 고를 수 있음·빠짐(이유)·접수함. 봉인한 범위는 404.
   *  판매 기록도 직접 넣은 택배도 없는 날짜는 빈 목록(D-UX3-64 — 판매 전에도 택배사·우체국 직접 접수·받는 분 직접 넣기를 써 볼 수 있게) */
  async day(sellerId: string, date: string): Promise<Outcome<ParcelDay>> {
    const scope = await this.#scopeOf(sellerId, date)
    if (scope.sealed) return NOT_FOUND
    const { db, masterKey } = this.#deps
    // 직접 넣은 택배만 있는 날짜는 범위 없이 그 줄들만 (D-UX3-38). 둘 다 없으면 빈 목록 (D-UX3-64)
    const extras = await this.#extrasOf(db, sellerId, date)
    const runtime = scope.runtime
    const settings = await readSettings(db, masterKey, sellerId)
    const addresses = await addressRowsOf(db, sellerId, date)
    const attempts = await latestAttempts(db, sellerId, date)
    const rows: ParcelRow[] = []
    if (runtime !== null) {
      const { state } = runtime
      const records = await packingRows(db, sellerId, runtime.scopeId as string)
      const buyers = ParcelService.buyersOf(state, date, attempts).filter((buyer) => !isExtraBuyer(buyer))
      const ledgered = await this.#prefills(db, sellerId, date, state, buyers, addresses, await this.#known(sellerId, date))
      const eposts = await epostRowsOf(db, sellerId, date)
      for (const buyer of buyers) rows.push(this.#row(state, date, buyer, records, addresses.get(buyer), attempts.get(buyer), settings.box, sellerId, ledgered.has(buyer), eposts.get(buyer)))
    }
    for (const extra of extras.values()) rows.push(this.#extraRow(sellerId, date, extra, addresses.get(extra.id), attempts.get(extra.id), settings.box))
    // EP1: 우체국에 사전접수한 묶음은 따로 (택배사 접수와 두 번 보내지 않게 — PC-9 2)
    const received = (row: ParcelRow) => row.epost?.state === 'RECEIVED' && row.parcel?.state !== 'BOOKED'
    return ok({
      date,
      seq: runtime?.seq ?? 0,
      blocked: this.#blocked(settings),
      carrier: settings.carrier === null ? null : { code: settings.carrier, name: ParcelService.carrierNameOf(settings) ?? '' },
      box: settings.box,
      ready: rows.filter((row) => row.ready && !received(row)),
      booked: rows.filter((row) => row.parcel?.state === 'BOOKED'),
      excluded: rows.filter((row) => !row.ready && row.parcel?.state !== 'BOOKED' && !received(row)),
      epost: rows.filter(received),
    })
  }

  // ── 묶음 자세히·배송지 (PC-3, AC-T1-13) ──────────────────────────────

  async #bundleView(db: Db, sellerId: string, runtime: ScopeRuntime, date: string, buyer: string, known: ReadonlyMap<string, string>): Promise<BundleView> {
    const settings = await readSettings(db, this.#deps.masterKey, sellerId)
    const records = await packingRows(db, sellerId, runtime.scopeId as string, buyer)
    const address = await addressRow(db, sellerId, date, buyer)
    const attempt = await latestAttempt(db, sellerId, date, buyer)
    const epost = await epostRow(db, sellerId, date, buyer)
    const opened = this.#open(sellerId, address)
    const ledger = (await this.#prefills(db, sellerId, date, runtime.state, [buyer], new Map(address === null ? [] : [[buyer, address]]), known)).get(buyer) ?? null
    const row = this.#row(runtime.state, date, buyer, records, address, attempt, settings.box, sellerId, ledger !== null, epost)
    const live = row.parcel !== null && (row.parcel.state === 'PENDING' || row.parcel.state === 'UNKNOWN' || row.parcel.state === 'BOOKED')
    return {
      date,
      buyer,
      address: opened === null || address === null ? null : { ...opened, source: address.source, confirmed: address.confirmed, updatedAt: iso(address.updatedAt.getTime()) },
      locked: live,
      expired: this.#expired(date),
      row,
      ledger,
    }
  }

  // ── KP1 손님 장부 (CR-4) ───────────────────────────────────────────────

  /** 그날 문자 구매자 표지 (범위 줄 밖에서만 부른다 — 장부가 없으면 빈 표) */
  async #known(sellerId: string, date: string, force = false): Promise<ReadonlyMap<string, string>> {
    return this.#deps.ledger === undefined ? new Map() : this.#deps.ledger.knownMarkers(sellerId, date, force)
  }

  /** 묶음마다 장부 "확인 전" (저장한 배송지가 풀리지 않거나 없는 묶음만) */
  async #prefills(db: Db, sellerId: string, date: string, state: EngineState, buyers: readonly string[], addresses: ReadonlyMap<string, AddressRow>, known: ReadonlyMap<string, string>): Promise<Map<string, LedgerPrefill>> {
    const ledger = this.#deps.ledger
    if (ledger === undefined || this.#expired(date)) return new Map()
    const bundles = buyers.map((buyer) => {
      const row = addresses.get(buyer)
      const saved: AddressState = this.#open(sellerId, row) === null ? 'NONE' : row?.confirmed === true ? 'CONFIRMED' : 'UNCONFIRMED'
      return { buyer, saved }
    })
    return ledger.prefills(db, sellerId, date, state, bundles, known)
  }

  /** 직접 넣은 택배의 자세히 (D-UX3-38): 배송지·택배 줄, 장부 없음 */
  async #extraBundle(db: Db, sellerId: string, date: string, extra: ExtraRow): Promise<BundleView> {
    const settings = await readSettings(db, this.#deps.masterKey, sellerId)
    const address = await addressRow(db, sellerId, date, extra.id)
    const attempt = await latestAttempt(db, sellerId, date, extra.id)
    const opened = this.#open(sellerId, address)
    const row = this.#extraRow(sellerId, date, extra, address, attempt, settings.box)
    const live = row.parcel !== null && (row.parcel.state === 'PENDING' || row.parcel.state === 'UNKNOWN' || row.parcel.state === 'BOOKED')
    return {
      date,
      buyer: extra.id,
      address: opened === null || address === null ? null : { ...opened, source: address.source, confirmed: address.confirmed, updatedAt: iso(address.updatedAt.getTime()) },
      locked: live,
      expired: this.#expired(date),
      row,
      ledger: null,
    }
  }

  /** 묶음 자세히 (배송지 여섯 칸 전부·출처·확인 여부, 택배 줄). 모르는 구매자 404 */
  async bundle(sellerId: string, date: string, buyer: string): Promise<Outcome<BundleView>> {
    if (isExtraBuyer(buyer)) {
      if (!isValidDate(date) || (await this.#scopeOf(sellerId, date)).sealed) return NOT_FOUND
      const extra = await extraRow(this.#deps.db, sellerId, date, buyer)
      return extra === null ? NOT_FOUND : ok(await this.#extraBundle(this.#deps.db, sellerId, date, extra))
    }
    const runtime = await this.#realScope(sellerId, date)
    if (runtime === null || getBuyer(runtime.state, buyer) === null) return NOT_FOUND
    return ok(await this.#bundleView(this.#deps.db, sellerId, runtime, date, buyer, await this.#known(sellerId, date)))
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
    work: (tx: Db, runtime: Pick<ScopeRuntime, 'state' | 'scopeId' | 'seq'>, now: Date, known: ReadonlyMap<string, string>) => Promise<{ kind: 'error'; error: ApiProblem } | null>,
  ): Promise<Outcome<BundleView>> {
    if (!isValidDate(date)) return NOT_FOUND
    if (isExtraBuyer(buyer)) return this.#extraWrite(sellerId, date, requestId, kind, buyer, (tx, extra, now) => work(tx, { scopeId: null, state: EMPTY_STATE, seq: 0 }, now, new Map()).then((failed) => failed ?? (kind === 'DELETE' ? deleteExtra(tx, sellerId, date, extra.id).then(() => null) : null)))
    const { db, writer } = this.#deps
    const prior = await requestRow(db, sellerId, requestId)
    if (prior !== null) {
      if (prior.kind !== kind || prior.date !== date) return problem(409, 'REQUEST_ERROR', PARCEL_MESSAGES.request)
      return this.bundle(sellerId, date, buyer)
    }
    // KP1: 장부 표지는 범위 줄 밖에서 미리 (범위 줄 안에서 그날 재료를 읽으면 자기 차례를 기다린다)
    const known = await this.#known(sellerId, date, kind === 'LEDGER')
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
          const failed = await work(tx, runtime, new Date(now), known)
          if (failed !== null) return failed
          if (!(await claimRequest(tx, { sellerId, requestId, date, kind, targets: [buyer], result: null, now: new Date(now) }))) throw new RequestTaken()
          return ok(await this.#bundleView(tx, sellerId, runtime, date, buyer, known))
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

  /**
   * KP1 [배송지 확인] (CR-4, AC-KP1-08): 그때 장부 연락처(+ 빈 배송 메모)를 이 묶음 배송지로 저장한다(출처 판매자, 확인함). 그 뒤로는 묶음 배송지가 앞선다.
   * 줄이 없어졌거나 하나가 아니면 NO_LEDGER, 줄을 그사이 고쳤으면 LEDGER_CHANGED, 이미 배송지가 있으면 ADDRESS_EXISTS
   */
  async confirmFromLedger(sellerId: string, accountId: string, date: string, requestId: string, buyer: string, ledgerId: string, updatedAt: string): Promise<Outcome<BundleView>> {
    const ledger = this.#deps.ledger
    if (ledger === undefined || isExtraBuyer(buyer)) return NOT_FOUND
    return this.#addressWrite(sellerId, date, requestId, 'LEDGER', buyer, async (tx, runtime, now, known) => {
      if (this.#expired(date)) return problem(409, 'ADDRESS_EXPIRED', PARCEL_MESSAGES.addressClosed)
      if (this.#open(sellerId, await addressRow(tx, sellerId, date, buyer)) !== null) return problem(409, 'ADDRESS_EXISTS', LEDGER_PARCEL_MESSAGES.exists)
      const settlement = getSettlement(runtime.state, buyer, date)
      const shipping = settlement.shippingOverride
      const found = settlement.items.length === 0 || shipping === 'PICKUP' || shipping === 'COMBINED' ? null : await ledger.lineForBundle(tx, sellerId, runtime.state, buyer, known)
      if (found === null || found.line.id !== ledgerId) return problem(409, 'NO_LEDGER', LEDGER_PARCEL_MESSAGES.noLedger)
      if (iso(found.line.updatedAt.getTime()) !== updatedAt) return problem(409, 'LEDGER_CHANGED', LEDGER_PARCEL_MESSAGES.changed)
      await putAddress(tx, this.#deps.masterKey, { sellerId, date, buyer, address: { ...found.contact, memo: '' }, source: 'LEDGER', accountId, confirmed: true, now })
      return null
    })
  }

  /** 배송지 지우기 (행이 없어지고 NO_ADDRESS). 직접 넣은 택배면 그 줄째 지운다(D-UX3-38) */
  async removeAddress(sellerId: string, date: string, requestId: string, buyer: string): Promise<Outcome<BundleView>> {
    return this.#addressWrite(sellerId, date, requestId, 'DELETE', buyer, async (tx) => {
      await deleteAddress(tx, sellerId, date, buyer)
      return null
    })
  }

  // ── 직접 넣은 택배 (D-UX3-38) ───────────────────────────────────────────

  /**
   * 직접 넣은 택배 쓰기 공통 (범위 줄 없이 — 엔진 기록과 잇지 않는다): 없는 줄 404, 살아 있는 시도면 409, 같은 요청 번호면 처음 결과(지금 모습).
   * 요청 번호는 쓰기와 같은 트랜잭션에 적는다. 줄을 지운 쓰기는 지우기 전 모습을 돌려준다
   */
  async #extraWrite(
    sellerId: string,
    date: string,
    requestId: string,
    kind: ParcelRequestKind,
    buyer: string,
    work: (tx: Db, extra: ExtraRow, now: Date) => Promise<{ kind: 'error'; error: ApiProblem } | null>,
  ): Promise<Outcome<BundleView>> {
    const { db } = this.#deps
    const prior = await requestRow(db, sellerId, requestId)
    if (prior !== null) {
      if (prior.kind !== kind || prior.date !== date) return problem(409, 'REQUEST_ERROR', PARCEL_MESSAGES.request)
      return this.bundle(sellerId, date, buyer)
    }
    if ((await this.#scopeOf(sellerId, date)).sealed) return problem(409, 'SEALED', SEALED_MESSAGE)
    try {
      const outcome = await db.transaction(async (tx): Promise<Outcome<BundleView>> => {
        const extra = await extraRow(tx, sellerId, date, buyer)
        if (extra === null) return NOT_FOUND
        const now = this.#deps.clock.now()
        const attempt = await latestAttempt(tx, sellerId, date, buyer)
        if (attempt !== null && ['PENDING', 'UNKNOWN', 'BOOKED'].includes(stateNow(attempt, now))) return problem(409, 'PARCEL_LOCKED', PARCEL_MESSAGES.extraLocked)
        const before = await this.#extraBundle(tx, sellerId, date, extra)
        const failed = await work(tx, extra, new Date(now))
        if (failed !== null) return failed
        if (!(await claimRequest(tx, { sellerId, requestId, date, kind, targets: [buyer], result: null, now: new Date(now) }))) throw new RequestTaken()
        const after = await extraRow(tx, sellerId, date, buyer)
        return ok(after === null ? before : await this.#extraBundle(tx, sellerId, date, after))
      })
      if (outcome.kind === 'ok') this.#deps.hub.publishNamed(sellerId, 'parcel', { date, buyer })
      return outcome
    } catch (error) {
      if (error instanceof RequestTaken) return problem(409, 'REQUEST_ERROR', PARCEL_MESSAGES.request)
      throw error
    }
  }

  /**
   * 받는 분 직접 넣기·고치기 (D-UX3-38): { address(여섯 칸), qty }. buyer가 있으면 그 줄을 고친다(살아 있는 시도면 409).
   * 새 줄은 그 날짜(실제 범위가 없어도 된다 — 봉인한 날짜는 409, 보관 기간이 지난 날짜는 409)에 넣고 배송지는 판매자 출처·확인함으로 저장한다.
   * 같은 요청 번호면 처음 만든 줄의 지금 모습
   */
  async upsertExtra(sellerId: string, accountId: string, date: string, requestId: string, buyer: string | null, rawAddress: unknown, rawQty: unknown): Promise<Outcome<BundleView>> {
    if (!isValidDate(date)) return NOT_FOUND
    const input = readAddressInput(rawAddress)
    if (input === null) return invalid('address', '배송지 칸을 확인해 주세요.')
    const read = readAddress(input)
    if ('errors' in read) return problem(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', addressProblems(read.errors, 'address.'), { codes: read.errors })
    const qty = readQty(rawQty)
    if (qty === null) return invalid('qty', PARCEL_MESSAGES.extraQty)
    const address = read.ok
    if (buyer !== null) {
      if (!isExtraBuyer(buyer)) return NOT_FOUND
      return this.#extraWrite(sellerId, date, requestId, 'EXTRA', buyer, async (tx, extra, now) => {
        if (this.#expired(date)) return problem(409, 'ADDRESS_EXPIRED', PARCEL_MESSAGES.extraClosed)
        await putAddress(tx, this.#deps.masterKey, { sellerId, date, buyer: extra.id, address, source: 'SELLER', accountId, confirmed: true, now })
        await setExtraQty(tx, sellerId, date, extra.id, qty)
        return null
      })
    }
    const { db } = this.#deps
    const prior = await requestRow(db, sellerId, requestId)
    const answerPrior = (row: RequestRow): Promise<Outcome<BundleView>> | Outcome<BundleView> => {
      if (row.kind !== 'EXTRA' || row.date !== date || row.result === null) return problem(409, 'REQUEST_ERROR', PARCEL_MESSAGES.request)
      const made = JSON.parse(row.result) as { buyer?: unknown }
      return typeof made.buyer === 'string' ? this.bundle(sellerId, date, made.buyer) : problem(409, 'REQUEST_ERROR', PARCEL_MESSAGES.request)
    }
    if (prior !== null) return answerPrior(prior)
    if (this.#expired(date)) return problem(409, 'ADDRESS_EXPIRED', PARCEL_MESSAGES.extraClosed)
    if ((await this.#scopeOf(sellerId, date)).sealed) return problem(409, 'SEALED', SEALED_MESSAGE)
    try {
      const outcome = await db.transaction(async (tx): Promise<Outcome<BundleView>> => {
        const now = new Date(this.#deps.clock.now())
        if ((await extrasOf(tx, sellerId, date)).size >= EXTRA_DAY_MAX) return problem(409, 'TOO_MANY', PARCEL_MESSAGES.extraTooMany)
        const id = newExtraId()
        if (!(await claimRequest(tx, { sellerId, requestId, date, kind: 'EXTRA', targets: [id], result: JSON.stringify({ buyer: id }), now }))) throw new RequestTaken()
        await insertExtra(tx, { sellerId, date, id, qty, accountId, now })
        await putAddress(tx, this.#deps.masterKey, { sellerId, date, buyer: id, address, source: 'SELLER', accountId, confirmed: true, now })
        return ok(await this.#extraBundle(tx, sellerId, date, (await extraRow(tx, sellerId, date, id)) as ExtraRow))
      })
      if (outcome.kind === 'ok') this.#deps.hub.publishNamed(sellerId, 'parcel', { date, buyer: outcome.value.buyer })
      return outcome
    } catch (error) {
      if (error instanceof RequestTaken) {
        const again = await requestRow(db, sellerId, requestId)
        return again === null ? problem(409, 'REQUEST_ERROR', PARCEL_MESSAGES.request) : answerPrior(again)
      }
      throw error
    }
  }

  /** 직접 넣은 택배 지우기 (D-UX3-38): 배송지와 줄을 지운다. 살아 있는 시도(접수함 포함)면 409 — 접수 취소가 먼저 */
  async removeExtra(sellerId: string, date: string, requestId: string, buyer: string): Promise<Outcome<{ buyer: string }>> {
    if (!isValidDate(date) || !isExtraBuyer(buyer)) return NOT_FOUND
    const prior = await requestRow(this.#deps.db, sellerId, requestId)
    if (prior !== null) return prior.kind === 'EXTRA_DELETE' && prior.date === date ? ok({ buyer }) : problem(409, 'REQUEST_ERROR', PARCEL_MESSAGES.request)
    const outcome = await this.#extraWrite(sellerId, date, requestId, 'EXTRA_DELETE', buyer, async (tx, extra) => {
      await deleteAddress(tx, sellerId, date, extra.id)
      await deleteExtra(tx, sellerId, date, extra.id)
      return null
    })
    return outcome.kind === 'ok' ? ok({ buyer }) : outcome
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
    const row = await addressRow(db, sellerId, date, buyer)
    const opened = this.#open(sellerId, row)
    if (opened !== null) return { kind: 'saved', name: opened.name, last4: phoneLast4(opened.phone) }
    // KP1: 손님 장부의 지난번 배송지 (가린 이름·끝 4자리만 — 주소 원문은 링크에 없다, CR-4)
    const prefill = (await this.#prefills(db, sellerId, date, state, [buyer], new Map(row === null ? [] : [[buyer, row]]), await this.#known(sellerId, date))).get(buyer)
    if (prefill !== undefined) return { kind: 'ledger', name: maskRecipient(prefill.name), last4: phoneLast4(prefill.phone) }
    return { kind: 'form' }
  }

  /** 구매자 링크 양식 저장 (출처 구매자, "확인 전" — 확인한 배송지도 덮어쓰면 다시 확인 전). 잠금·직접 수령·합배송·보관 기간이면 refused */
  async saveFromLink(sellerId: string, date: string, buyer: string, raw: Record<AddressField, string> | null, keep = false): Promise<LinkSave> {
    if (raw === null) return { kind: 'invalid', errors: [] }
    const read = readAddress(raw)
    if ('errors' in read) return { kind: 'invalid', errors: read.errors }
    const { db, writer } = this.#deps
    // KP1 "다음 주문에도 이 배송지 쓰기"(CR-2): 고른 경우만, 표지는 범위 줄 밖에서 미리
    const ledger = keep ? this.#deps.ledger : undefined
    const known = ledger === undefined ? new Map<string, string>() : await ledger.knownMarkers(sellerId, date, true)
    let consented = false
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
        // 같은 트랜잭션: 장부 줄·동의 기록 (구성원 표지가 없으면 칸이 안 보이는 묶음 — keep을 무시하고 배송지만)
        if (ledger !== undefined) consented = await ledger.consentInTx(tx, { sellerId, date, state, buyer, known, contact: read.ok, now: new Date(now) })
        return { kind: 'saved' }
      })
    })
    if (result.kind === 'saved') this.#deps.hub.publishNamed(sellerId, 'parcel', { date, buyer })
    if (result.kind === 'saved' && consented) this.#deps.ledger?.published(sellerId)
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
      // 골든 parcel/box.json과 같은 읽기 — 옛 낱말은 옮긴 코드로 접수한다(FB1 D-FB1-05)
      const read = box === undefined ? null : readBox(box)
      if (read !== null && 'error' in read) return bad(PARCEL_MESSAGES.boxInvalid)
      seen.add(buyer)
      out.push({ buyer, box: read === null ? null : read.box })
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
    if (prior !== null) return this.#priorBook(sellerId, accountId, date, requestId, prior)
    const known = await this.#knownBuyers(sellerId, date, items)
    if (known.kind !== 'ok') return known
    const settings = await readSettings(db, masterKey, sellerId)
    const blocked = this.#blocked(settings)
    if (blocked !== null) return problem(409, 'PARCEL_BLOCKED', blocked.message)
    const adapter = this.#carriers[settings.carrier as CarrierCode] as CarrierAdapter
    // 요청 번호와 함께 묶음·상자 크기를 적어 둔다 — 서버가 멈춰 결과가 없으면 같은 요청 번호가 이것으로 이어받는다(TD-T1-002)
    const targets = items.map((item) => ({ buyer: item.buyer, box: item.box }))
    if (!(await claimRequest(db, { sellerId, requestId, date, kind: 'BOOK', targets, result: null, now: new Date(this.#deps.clock.now()) }))) {
      const again = await requestRow(db, sellerId, requestId)
      return again === null ? problem(409, 'REQUEST_ERROR', PARCEL_MESSAGES.request) : this.#priorBook(sellerId, accountId, date, requestId, again)
    }
    return ok({ results: await this.#fly(sellerId, requestId, () => this.#runBook(sellerId, accountId, date, items, adapter, settings)) })
  }

  /**
   * 접수·직접 접수 송장의 구매자 검사: 엔진 구매자는 실제 범위(봉인 409)의 구매자여야 하고, 직접 넣은 택배(D-UX3-38)는 그 날짜 줄이어야 한다.
   * 모르는 구매자가 섞이면 404(아무것도 하지 않음)
   */
  async #knownBuyers(sellerId: string, date: string, items: readonly { buyer: string }[]): Promise<Outcome<null>> {
    const { db } = this.#deps
    const engine = items.filter((item) => !isExtraBuyer(item.buyer))
    const runtime = await this.#deps.writer.read(sellerId, date, false)
    if (engine.length > 0) {
      if (runtime.seq === 0 || runtime.scopeId === null) return NOT_FOUND
      // 봉인한 범위는 상태를 재생하지 않아 구매자가 보이지 않는다 — 봉인을 먼저 본다(지금 포장 명령과 같은 문장)
      if (await this.#sealed(db, sellerId, runtime.scopeId)) return problem(409, 'SEALED', SEALED_MESSAGE)
      if (engine.some((item) => getBuyer(runtime.state, item.buyer) === null)) return NOT_FOUND
    } else if (runtime.scopeId !== null && (await this.#sealed(db, sellerId, runtime.scopeId))) return problem(409, 'SEALED', SEALED_MESSAGE)
    if (engine.length < items.length) {
      const extras = await this.#extrasOf(db, sellerId, date)
      if (items.some((item) => isExtraBuyer(item.buyer) && !extras.has(item.buyer))) return NOT_FOUND
    }
    return ok(null)
  }

  /** 접수 하나를 돌리고 결과를 요청 번호에 적는다. 도중에 예외가 나면 결과 없이 남고, STALE_PENDING_MS 뒤 같은 요청 번호가 이어받는다 */
  async #fly(sellerId: string, requestId: string, run: () => Promise<BookItemResult[]>): Promise<BookItemResult[]> {
    const key = JSON.stringify([sellerId, requestId])
    const flight = run()
    this.#flights.set(key, flight)
    let results: BookItemResult[]
    try {
      results = await flight
    } finally {
      this.#flights.delete(key)
    }
    await saveRequestResult(this.#deps.db, sellerId, requestId, JSON.stringify(results))
    return results
  }

  /**
   * 같은 화면 요청 번호: 처음 결과 → 이 서버에서 처리 중이면 기다림 → 결과 없이 STALE_PENDING_MS가 지났으면(서버가 멈췄거나 도중에 예외) 이어받아 다시 실행
   * → 아직 그 전이면 그 묶음들의 지금 시도로 만든 답(TD-T1-002)
   */
  async #priorBook(sellerId: string, accountId: string, date: string, requestId: string, prior: RequestRow): Promise<Outcome<{ results: BookItemResult[] }>> {
    if (prior.kind !== 'BOOK' || prior.date !== date) return problem(409, 'REQUEST_ERROR', PARCEL_MESSAGES.request)
    if (prior.result !== null) return ok({ results: JSON.parse(prior.result) as BookItemResult[] })
    const flight = this.#flights.get(JSON.stringify([sellerId, requestId]))
    if (flight !== undefined) return ok({ results: await flight })
    const targets = ParcelService.bookTargets(prior.targets)
    const now = this.#deps.clock.now()
    if (now - prior.createdAt.getTime() > STALE_PENDING_MS) {
      const resumed = await this.#resumeBook(sellerId, accountId, date, requestId, prior, targets)
      if (resumed !== null) return resumed
    }
    const attempts = await latestAttempts(this.#deps.db, sellerId, date)
    return ok({ results: targets.map((item) => this.#resultOf(item.buyer, attempts.get(item.buyer) ?? null)) })
  }

  /** 적어 둔 묶음 목록 (예전 모양 — 구매자 ID 글만 — 이면 상자 크기는 설정값) */
  static bookTargets(text: string): { buyer: string; box: BoxKind | null }[] {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return []
    }
    if (!Array.isArray(parsed)) return []
    const out: { buyer: string; box: BoxKind | null }[] = []
    for (const item of parsed as unknown[]) {
      if (typeof item === 'string') out.push({ buyer: item, box: null })
      else if (typeof item === 'object' && item !== null && typeof (item as { buyer?: unknown }).buyer === 'string') {
        const box = (item as { box?: unknown }).box
        const read = readBox(box)
        out.push({ buyer: (item as { buyer: string }).buyer, box: 'box' in read ? read.box : null })
      }
    }
    return out
  }

  /**
   * 결과 없이 멈춘 요청 번호 이어받기 (TD-T1-002). 요청 번호를 조건부로 이어받은 쪽 하나만 돈다(못 이어받으면 null — 지금 시도로 답한다).
   * 묶음마다: 이미 BOOKED이거나 결과를 기다리는(2분 안 PENDING) 시도, 이 요청 뒤에 끝난 FAILED·CANCELLED 시도는 그 답을 그대로 돌려준다.
   * 시도가 없거나 이 요청 전 시도면 지금 다시 판단해 접수하고(PC-4), UNKNOWN이면 같은 요청 번호로 다시 확인한다 — 한 묶음에 살아 있는 시도는 하나라(PC-INV-1) 두 번 접수되지 않는다
   */
  async #resumeBook(sellerId: string, accountId: string, date: string, requestId: string, prior: RequestRow, targets: readonly { buyer: string; box: BoxKind | null }[]): Promise<Outcome<{ results: BookItemResult[] }> | null> {
    const { db, masterKey } = this.#deps
    const settings = await readSettings(db, masterKey, sellerId)
    const blocked = this.#blocked(settings)
    if (blocked !== null) return problem(409, 'PARCEL_BLOCKED', blocked.message)
    if (!(await takeOverRequest(db, sellerId, requestId, prior.createdAt, new Date(this.#deps.clock.now())))) return null
    this.#deps.log({ level: 'warn', code: 'PARCEL_BOOK_RESUMED', seller: sellerId, date })
    const adapter = this.#carriers[settings.carrier as CarrierCode] as CarrierAdapter
    const since = prior.createdAt.getTime()
    const results = await this.#fly(sellerId, requestId, async () => {
      const attempts = await latestAttempts(db, sellerId, date)
      const now = this.#deps.clock.now()
      const answered: (BookItemResult | null)[] = targets.map((item) => {
        const attempt = attempts.get(item.buyer) ?? null
        if (attempt === null) return null
        const state = stateNow(attempt, now)
        if (state === 'BOOKED' || state === 'PENDING') return this.#resultOf(item.buyer, attempt)
        if ((state === 'FAILED' || state === 'CANCELLED') && attempt.createdAt.getTime() >= since) return this.#resultOf(item.buyer, attempt)
        return null
      })
      const rest = targets.filter((_, index) => answered[index] === null)
      const ran = rest.length === 0 ? [] : await this.#runBook(sellerId, accountId, date, rest, adapter, settings)
      let next = 0
      return answered.map((result) => result ?? (ran[next++] as BookItemResult))
    })
    return ok({ results })
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
      answer = await adapter.book({ requestKey: attempt.requestKey, customerNo: settings.customerNo, receiver: prepared.receiver, sender, box: attempt.box, count: attempt.qty, account: ParcelService.accountOf(settings) })
    } catch {
      answer = { kind: 'UNKNOWN' as const }
    }
    if (answer.kind === 'UNKNOWN') this.#deps.log({ level: 'warn', code: 'PARCEL_BOOK_UNKNOWN', seller: sellerId, date, reason: adapter.code })
    return this.#finish(sellerId, accountId, date, attempt, answer)
  }

  async #prepare(sellerId: string, accountId: string, date: string, buyer: string, box: BoxKind, carrier: CarrierCode, direct: DirectKind | null = null): Promise<Prepared> {
    const { db, writer } = this.#deps
    const skip = (result: BookItemResult): Prepared => ({ kind: 'skip', result })
    if (isExtraBuyer(buyer)) return this.#prepareExtra(sellerId, accountId, date, buyer, box, carrier, direct)
    // KP1 SA-KP1-001: 장부 "확인 전" 묶음은 목록과 같이 UNCONFIRMED로 판단한다 — 표지는 범위 줄 밖에서 미리
    const known = await this.#known(sellerId, date)
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
        // 직접 접수(D-UX3-37)는 택배사 결과를 기다리는 자동 접수 시도를 건드리지 않는다
        if (direct !== null && latest !== null && ['PENDING', 'UNKNOWN'].includes(stateNow(latest, now))) return skip({ buyer, ok: false, reason: 'BOOKING', message: ELIGIBILITY_MESSAGES.BOOKING })
        if (latest !== null && stateNow(latest, now) === 'UNKNOWN') {
          // 다시 확인: 다시 판단하지 않고 같은 요청 번호로 (배송지는 잠겨 있어 그때와 같다). 다른 기기가 함께 다시 보내지 않게 PENDING으로 돌려 둔다
          const receiver = this.#open(sellerId, address)
          if (receiver === null) return skip({ buyer, ok: false, reason: 'ADDRESS_EXPIRED', message: PARCEL_MESSAGES.addressExpired })
          if (!(await moveAttempt(tx, sellerId, latest.id, ['PENDING', 'UNKNOWN'], { state: 'PENDING', updatedAt: new Date(now) }))) return skip(this.#resultOf(buyer, await attemptById(tx, sellerId, latest.id)))
          return { kind: 'send', attempt: latest, receiver }
        }
        // EP1: 우체국에 사전접수한 묶음은 택배사에 다시 보내지 않는다 (PC-9 2)
        if ((await epostRow(tx, sellerId, date, buyer))?.state === 'RECEIVED') return skip({ buyer, ok: false, reason: 'EPOST', message: EPOST_MESSAGES.alreadyReceived })
        const records = await packingRows(tx, sellerId, scopeId, buyer)
        const ledgered = (await this.#prefills(tx, sellerId, date, state, [buyer], new Map(address === null ? [] : [[buyer, address]]), known)).has(buyer)
        const row = this.#row(state, date, buyer, records, address, latest, box, sellerId, ledgered)
        if (!row.ready) return skip({ buyer, ok: false, reason: row.reason as EligibilityReason, message: row.message as string })
        const receiver = this.#open(sellerId, address) as ParcelAddress
        const attempt = await insertAttempt(tx, { sellerId, date, buyer, carrier, box, qty: row.qty, accountId, now: new Date(now), ...(direct === null ? {} : { requestKey: directRequestKey(direct) }) })
        if (attempt === null) return skip({ buyer, ok: false, reason: 'BOOKING', message: ELIGIBILITY_MESSAGES.BOOKING })
        return { kind: 'send', attempt, receiver }
      })
    })
  }

  /** 직접 넣은 택배의 준비 (D-UX3-38): 범위 줄 없이 — 줄이 있고 배송지가 남아 있으면 PENDING 시도(살아 있는 시도는 DB 고유 색인이 막는다). 포장 기록은 없다 */
  async #prepareExtra(sellerId: string, accountId: string, date: string, buyer: string, box: BoxKind, carrier: CarrierCode, direct: DirectKind | null): Promise<Prepared> {
    const { db } = this.#deps
    const skip = (result: BookItemResult): Prepared => ({ kind: 'skip', result })
    return db.transaction(async (tx) => {
      const extra = await extraRow(tx, sellerId, date, buyer)
      if (extra === null) return skip({ buyer, ok: false, reason: 'BUYER', message: '받는 분을 다시 확인해 주세요.' })
      const now = this.#deps.clock.now()
      const latest = await latestAttempt(tx, sellerId, date, buyer)
      const address = await addressRow(tx, sellerId, date, buyer)
      if (direct !== null && latest !== null && ['PENDING', 'UNKNOWN'].includes(stateNow(latest, now))) return skip({ buyer, ok: false, reason: 'BOOKING', message: ELIGIBILITY_MESSAGES.BOOKING })
      if (latest !== null && stateNow(latest, now) === 'UNKNOWN') {
        const receiver = this.#open(sellerId, address)
        if (receiver === null) return skip({ buyer, ok: false, reason: 'ADDRESS_EXPIRED', message: PARCEL_MESSAGES.addressExpired })
        if (!(await moveAttempt(tx, sellerId, latest.id, ['PENDING', 'UNKNOWN'], { state: 'PENDING', updatedAt: new Date(now) }))) return skip(this.#resultOf(buyer, await attemptById(tx, sellerId, latest.id)))
        return { kind: 'send', attempt: latest, receiver }
      }
      const row = this.#extraRow(sellerId, date, extra, address, latest, box)
      if (!row.ready) return skip({ buyer, ok: false, reason: row.reason as EligibilityReason, message: row.message as string })
      const receiver = this.#open(sellerId, address) as ParcelAddress
      const attempt = await insertAttempt(tx, { sellerId, date, buyer, carrier, box, qty: extra.qty, accountId, now: new Date(now), ...(direct === null ? {} : { requestKey: directRequestKey(direct) }) })
      if (attempt === null) return skip({ buyer, ok: false, reason: 'BOOKING', message: ELIGIBILITY_MESSAGES.BOOKING })
      return { kind: 'send', attempt, receiver }
    })
  }

  /** 택배사 답을 적는다 (같은 트랜잭션에 포장 기록 "배송 완료 — 송장번호", 누가 = 접수한 계정). 직접 넣은 택배는 범위 줄·포장 기록 없이(D-UX3-38) */
  async #finish(sellerId: string, accountId: string, date: string, attempt: AttemptRow, answer: { kind: 'BOOKED'; invoice: string } | { kind: 'FAILED'; reason: 'ADDRESS' | 'REJECTED' } | { kind: 'UNKNOWN' }): Promise<BookItemResult> {
    const { db, writer } = this.#deps
    const apply = async (tx: Db, scopeId: string | null) => {
      const now = new Date(this.#deps.clock.now())
      let shipped = false
      if (answer.kind === 'BOOKED') {
        const moved = await moveAttempt(tx, sellerId, attempt.id, ['PENDING', 'UNKNOWN'], { state: 'BOOKED', reason: null, invoice: answer.invoice, bookedAt: now, track: 'ACCEPTED', trackedAt: now, updatedAt: now })
        if (moved && scopeId !== null) {
          const packing = replayPacking(await packingRows(tx, sellerId, scopeId, attempt.buyer))
          if (!(packing.phase === 'SHIPPED' && packing.invoice === answer.invoice)) {
            await tx
              .insert(packingRecords)
              .values({ sellerId, scopeId, date, buyer: attempt.buyer, kind: 'SHIPPED', items: null, invoice: answer.invoice, accountId, requestId: `parcel:${attempt.id}:book`, createdAt: now })
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
    }
    const result = isExtraBuyer(attempt.buyer)
      ? await db.transaction((tx) => apply(tx, null))
      : await writer.withScope(sellerId, date, false, async (runtime, catchUpIn) =>
          db.transaction(async (tx) => {
            await catchUpIn(tx)
            return apply(tx, runtime.scopeId)
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
    // 직접 넣은 택배(D-UX3-38)는 범위 줄·포장 기록 없이 같은 절차
    const extra = isExtraBuyer(buyer)
    if (extra) {
      if ((await this.#scopeOf(sellerId, date)).sealed) return problem(409, 'SEALED', SEALED_MESSAGE)
      if ((await extraRow(db, sellerId, date, buyer)) === null) return NOT_FOUND
    } else {
      const runtime0 = await writer.read(sellerId, date, false)
      if (runtime0.seq === 0 || runtime0.scopeId === null) return NOT_FOUND
      if (await this.#sealed(db, sellerId, runtime0.scopeId)) return problem(409, 'SEALED', SEALED_MESSAGE)
      if (getBuyer(runtime0.state, buyer) === null) return NOT_FOUND
    }
    const check = async (tx: Db, scopeId: string | null): Promise<Outcome<AttemptRow>> => {
      if (!extra && scopeId === null) return NOT_FOUND
      if (scopeId !== null && (await this.#sealed(tx, sellerId, scopeId))) return problem(409, 'SEALED', SEALED_MESSAGE)
      const attempt = await latestAttempt(tx, sellerId, date, buyer)
      if (attempt === null || attempt.state !== 'BOOKED' || attempt.invoice === null) return problem(409, 'NO_PARCELS', PARCEL_MESSAGES.noBooked)
      if (attempt.track !== null && attempt.track !== 'ACCEPTED') return problem(409, 'PICKED_UP', PARCEL_MESSAGES.pickedUp)
      return ok(attempt)
    }
    const checked = extra
      ? await db.transaction((tx) => check(tx, null))
      : await writer.withScope(sellerId, date, false, async (runtime, catchUpIn): Promise<Outcome<AttemptRow>> =>
          db.transaction(async (tx) => {
            await catchUpIn(tx)
            return check(tx, runtime.scopeId)
          }),
        )
    if (checked.kind !== 'ok') return checked
    const attempt = checked.value
    const adapter = this.#carriers[attempt.carrier]
    // 직접 접수(D-UX3-37)는 라이브찜 기록만 지운다 — 우체국 접수 취소는 판매자가 인터넷우체국에서 (택배사에 아무것도 보내지 않는다)
    const direct = directOf(attempt.requestKey) !== null
    if (adapter === undefined && !direct) return problem(503, 'CARRIER_UNAVAILABLE', PARCEL_MESSAGES.cancelUnknown)
    let answer: CancelResult
    if (direct) answer = { kind: 'CANCELLED' }
    else
      try {
        const stored = await readSettings(db, this.#deps.masterKey, sellerId)
        answer = await (adapter as CarrierAdapter).cancel(attempt.invoice as string, { requestKey: attempt.requestKey, bookedAt: attempt.bookedAt, account: ParcelService.accountOf(stored) })
      } catch {
        answer = { kind: 'UNKNOWN' as const }
      }
    if (answer.kind === 'UNKNOWN') {
      this.#deps.log({ level: 'warn', code: 'PARCEL_CANCEL_UNKNOWN', seller: sellerId, date, reason: attempt.carrier })
      return problem(503, 'CARRIER_UNAVAILABLE', PARCEL_MESSAGES.cancelUnknown)
    }
    if (answer.kind === 'REFUSED') return problem(409, 'PICKED_UP', PARCEL_MESSAGES.pickedUp)
    try {
      const known = extra ? new Map<string, string>() : await this.#known(sellerId, date) // KP1 (범위 줄 밖에서)
      const finish = async (tx: Db, runtime: ScopeRuntime | null): Promise<Outcome<BundleView>> => {
        const now = new Date(this.#deps.clock.now())
        const moved = await moveAttempt(tx, sellerId, attempt.id, ['BOOKED'], { state: 'CANCELLED', cancelledAt: now, cancelledBy: accountId, updatedAt: now })
        if (moved && runtime !== null && runtime.scopeId !== null && replayPacking(await packingRows(tx, sellerId, runtime.scopeId, buyer)).phase === 'SHIPPED') {
          await tx
            .insert(packingRecords)
            .values({ sellerId, scopeId: runtime.scopeId, date, buyer, kind: 'UNSHIPPED', items: null, invoice: null, accountId, requestId: `parcel:${attempt.id}:cancel`, createdAt: now })
            .onConflictDoNothing({ target: [packingRecords.sellerId, packingRecords.requestId] })
        }
        if (!(await claimRequest(tx, { sellerId, requestId, date, kind: 'CANCEL', targets: [buyer], result: null, now }))) throw new RequestTaken()
        if (runtime === null) {
          const row = await extraRow(tx, sellerId, date, buyer)
          return row === null ? NOT_FOUND : ok(await this.#extraBundle(tx, sellerId, date, row))
        }
        return ok(await this.#bundleView(tx, sellerId, runtime, date, buyer, known))
      }
      const outcome = extra
        ? await db.transaction((tx) => finish(tx, null))
        : await writer.withScope(sellerId, date, false, async (runtime, catchUpIn): Promise<Outcome<BundleView>> =>
            db.transaction(async (tx) => {
              await catchUpIn(tx)
              return finish(tx, runtime)
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

  // ── 우체국 창구소포 간편사전접수 (EP1 PC-9) ────────────────────────────

  /**
   * 앱 안 우체국 화면에 채울 값 (PC-9 1): 고를 수 있는(입금·포장·배송지 확인이 끝난) 묶음만. 사전접수 완료면 409 — 두 번 신청하지 않게.
   * 보내는 사람이 없으면 409. 배송지 원문은 이 응답에만 있고 저장·로그에 남기지 않는다.
   */
  async epostFill(sellerId: string, date: string, buyer: string): Promise<Outcome<EpostFillView>> {
    const runtime = await this.#realScope(sellerId, date)
    if (runtime === null || getBuyer(runtime.state, buyer) === null) return NOT_FOUND
    if (!ParcelService.current(runtime.state, buyer)) return problem(409, 'PARCEL_STATE', '구매자를 다시 확인해 주세요.')
    const { db, masterKey } = this.#deps
    const settings = await readSettings(db, masterKey, sellerId)
    if (settings.sender === null) return problem(409, 'PARCEL_BLOCKED', EPOST_MESSAGES.noSender)
    const view = await this.#bundleView(db, sellerId, runtime, date, buyer, await this.#known(sellerId, date))
    if (view.row.epost?.state === 'RECEIVED') return problem(409, 'PARCEL_STATE', EPOST_MESSAGES.alreadyReceived, [], { row: view.row })
    if (!view.row.ready) return problem(409, 'PARCEL_STATE', view.row.message ?? EPOST_MESSAGES.notReady, [], { row: view.row })
    if (view.address === null) return problem(409, 'ADDRESS_EXPIRED', EPOST_MESSAGES.addressExpired)
    const { name, phone, address, detail, zip, memo } = view.address
    return ok({
      date,
      buyer,
      fill: epostFill({ name, phone, address, detail, zip, memo }, settings.sender, view.row.qty),
      row: view.row,
      pages: EPOST_PAGES,
      hosts: EPOST_HOSTS,
      form: EPOST_FORM_HINTS,
      password: settings.epostPassword,
    })
  }

  /**
   * 우체국 기록 바꾸기 (PC-9 2): FILLED(칸을 채웠다) · RECEIVED(판매자가 확인한 접수번호) · CLEAR(기록 지우기). 같은 일을 다시 보내도 결과가 같다.
   * 입력 완료·사전접수 완료는 고를 수 있는 묶음(또는 이미 입력 완료한 묶음)만. 지우기는 언제나.
   */
  async epostMark(sellerId: string, accountId: string, date: string, buyer: string, action: EpostAction, receiptRaw: unknown): Promise<Outcome<{ row: ParcelRow }>> {
    const runtime = await this.#realScope(sellerId, date)
    if (runtime === null || getBuyer(runtime.state, buyer) === null) return NOT_FOUND
    const { db } = this.#deps
    const known = await this.#known(sellerId, date)
    const outcome = await db.transaction(async (tx): Promise<Outcome<{ row: ParcelRow }>> => {
      const current = await epostRow(tx, sellerId, date, buyer, true)
      if (action !== 'CLEAR') {
        if (!ParcelService.current(runtime.state, buyer)) return problem(409, 'PARCEL_STATE', '구매자를 다시 확인해 주세요.')
        const before = await this.#bundleView(tx, sellerId, runtime, date, buyer, known)
        if (!before.row.ready && current?.state !== 'FILLED' && current?.state !== 'RECEIVED') return problem(409, 'PARCEL_STATE', before.row.message ?? EPOST_MESSAGES.notReady, [], { row: before.row })
      }
      const step = epostTransition(current, action, receiptRaw)
      if ('refused' in step) {
        if (step.refused === 'RECEIPT_INVALID') return invalid('receiptNo', EPOST_MESSAGES.receiptInvalid)
        return problem(409, 'PARCEL_STATE', step.refused === 'ALREADY_RECEIVED' ? EPOST_MESSAGES.alreadyReceived : EPOST_MESSAGES.otherReceipt)
      }
      if (step.changed) await writeEpost(tx, { sellerId, date, buyer, accountId, now: new Date(this.#deps.clock.now()) }, step.next)
      return ok({ row: (await this.#bundleView(tx, sellerId, runtime, date, buyer, known)).row })
    })
    if (outcome.kind === 'ok') this.#deps.hub.publishNamed(sellerId, 'parcel', { date, buyer })
    return outcome
  }

  /** 우체국 주소 파일 (PC-9 5): 그 날짜의 고를 수 있는 묶음(사전접수 완료 제외)을 우체국 열 순서로. 없으면 409 */
  async epostFile(sellerId: string, date: string): Promise<Outcome<FileResult>> {
    const day = await this.day(sellerId, date)
    if (day.kind !== 'ok') return day.kind === 'not_found' ? NOT_FOUND : { kind: 'error', error: day.error }
    const { db } = this.#deps
    const addresses = await addressRowsOf(db, sellerId, date)
    const rows: (readonly string[])[] = []
    for (const row of day.value.ready) {
      const receiver = this.#open(sellerId, addresses.get(row.buyer))
      if (receiver !== null) rows.push(epostFileRow(receiver))
    }
    if (rows.length === 0) return problem(409, 'NO_PARCELS', EPOST_MESSAGES.noRows)
    if (rows.length > EPOST_FILE_MAX) return problem(409, 'PARCEL_STATE', EPOST_MESSAGES.tooMany)
    const bytes = await textRowsToXlsx('주소', EPOST_FILE_COLUMNS, rows, [12, 10, 40, 30, 16, 16])
    return ok({ bytes, type: MIME.xlsx, fileName: `우체국-주소-${date}.xlsx`, fallback: `epost-addresses-${date}.xlsx`, headers: { 'X-Epost-Count': String(rows.length) } })
  }


  // ── 운송장 (PC-7, AC-T1-43) ──────────────────────────────────────────

  /**
   * 운송장 PDF: buyer가 있으면 그 묶음 하나(`운송장-YYYY-MM-DD-<이름>.pdf`), 없으면 그 날짜의 접수함 전부(목록 순서, `운송장-YYYY-MM-DD-전부.pdf`).
   * BOOKED이고 배송지가 남은 묶음만. 접수함이 없으면 409, 배송지를 지운 묶음 하나짜리는 409. 그리기는 작업 워커(I2 파일 작업 한도 — 바쁘면 429)
   */
  async waybill(sellerId: string, date: string, buyer: string | null, signal?: AbortSignal): Promise<Outcome<FileResult>> {
    const scope = await this.#scopeOf(sellerId, date)
    if (scope.sealed) return NOT_FOUND
    const { db } = this.#deps
    // 직접 넣은 택배(D-UX3-38)는 목록 끝에 — 범위 없는 날짜는 그 줄들만
    const extras = await this.#extrasOf(db, sellerId, date)
    const state = scope.runtime?.state ?? null
    if (state === null && extras.size === 0) return NOT_FOUND
    if (buyer !== null && !(isExtraBuyer(buyer) ? extras.has(buyer) : state !== null && getBuyer(state, buyer) !== null)) return NOT_FOUND
    const settings = await readSettings(db, this.#deps.masterKey, sellerId)
    if (settings.sender === null) return problem(409, 'PARCEL_BLOCKED', PARCEL_MESSAGES.noSender)
    const attempts = await latestAttempts(db, sellerId, date)
    const addresses = await addressRowsOf(db, sellerId, date)
    const order = buyer === null ? [...(state === null ? [] : ParcelService.buyersOf(state, date, attempts).filter((id) => !isExtraBuyer(id))), ...extras.keys()] : [buyer]
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
    const name = buyer === null ? '전부' : fileNamePart(isExtraBuyer(buyer) ? (this.#open(sellerId, addresses.get(buyer))?.name ?? '') : (state === null ? null : getBuyer(state, buyer))?.display ?? '')
    return ok({
      bytes: rendered.pdf,
      type: MIME.pdf,
      fileName: `운송장-${date}-${name}.pdf`,
      fallback: buyer === null ? `waybills-${date}-all.pdf` : `waybill-${date}.pdf`,
      headers: { 'X-Waybill-Count': String(list.length - skipped.length), 'X-Waybill-Skipped': String(skipped.length + (booked.length - list.length)) },
    })
  }

  /**
   * 우체국 방문접수소포 파일접수 엑셀 (D-UX3-36 — 계약 없는 판매자가 인터넷우체국 [파일(주소) 등록]에 올린다. 결제·[신청]은 판매자가 우체국 화면에서 직접).
   * 그 날짜의 "고를 수 있음" 묶음(입금·포장·배송지 확인 끝, 아직 접수·배송 완료 아님) 전부, 목록 순서. 상자 = 설정의 기본 상자.
   * 택배사에는 아무것도 보내지 않고 상태도 바꾸지 않는다 — 판매자가 포장 화면에 송장번호를 적으면 배송 완료가 되어 다음 파일에서 빠진다.
   * 없으면 409, 999개 넘으면 422(우체국이 1000건 미만만 받는다). 만들기는 작업 워커(바쁘면 429)
   */
  async epostVisitFile(sellerId: string, date: string, signal?: AbortSignal): Promise<Outcome<FileResult>> {
    const visit = await this.#visitRows(sellerId, date, signal)
    if (visit.kind !== 'ok') return visit
    const built = await this.#visitXlsx(sellerId, date, visit.value.rows, signal)
    if (built.kind !== 'ok') return built
    return ok({
      bytes: built.value,
      type: MIME.xlsx,
      fileName: `우체국-방문접수-${date}.xlsx`,
      fallback: `epost-visit-${date}.xlsx`,
      headers: { 'X-Epost-Count': String(visit.value.rows.length) },
    })
  }

  /** 그 날짜의 "고를 수 있음" 묶음 → 우체국 파일 줄 (배송지를 풀지 못한 묶음은 뺀다, 빈 우편번호는 서버가 찾아 채운다). 없으면 409, 999개 넘으면 422 */
  async #visitRows(sellerId: string, date: string, signal?: AbortSignal): Promise<Outcome<{ rows: EpostVisitRow[]; buyers: string[]; qty: number[] }>> {
    const day = await this.day(sellerId, date)
    if (day.kind !== 'ok') return day
    const addresses = await addressRowsOf(this.#deps.db, sellerId, date)
    const rows: EpostVisitRow[] = []
    const buyers: string[] = []
    const qty: number[] = []
    for (const row of day.value.ready) {
      const receiver = this.#open(sellerId, addresses.get(row.buyer))
      if (receiver === null) continue
      rows.push({ name: receiver.name, zip: receiver.zip, address: receiver.address, detail: receiver.detail, phone: receiver.phone, box: day.value.box, content: itemText(row.qty), memo: receiver.memo })
      buyers.push(row.buyer)
      qty.push(row.qty)
    }
    if (rows.length === 0) return problem(409, 'NO_PARCELS', PARCEL_MESSAGES.noEpostRows)
    if (rows.length > EPOST_VISIT_MAX_ROWS) return problem(422, 'TOO_MANY', PARCEL_MESSAGES.tooManyEpostRows)
    await this.#fillZips(rows, signal)
    return ok({ rows, buyers, qty })
  }

  /** 방문접수 파일 바이트 (작업 워커 — 바쁘면 429) */
  async #visitXlsx(sellerId: string, date: string, rows: readonly EpostVisitRow[], signal?: AbortSignal): Promise<Outcome<Uint8Array>> {
    try {
      return ok(await this.#deps.work.documents.run<Uint8Array>(sellerId, 'epostVisitXlsx', { rows }, signal === undefined ? {} : { signal }))
    } catch (error) {
      if (error instanceof WorkBusy) return problem(429, 'BUSY', '지금 다른 파일을 만들고 있어요. 잠시 뒤 다시 눌러 주세요.')
      if (error instanceof WorkFailed) {
        this.#deps.log({ level: error.reason === 'aborted' ? 'info' : 'error', code: 'DOCUMENT_WORK_FAILED', seller: sellerId, date, errorKind: error.reason })
        return problem(500, 'FILE_FAILED', '파일을 만들지 못했어요. 잠시 뒤 다시 눌러 주세요.')
      }
      throw error
    }
  }

  /**
   * 앱 안 우체국 화면 자동 채우기 자료 (D-UX3-37): 보내는 사람(설정 — 없으면 null), 받는 분 줄(방문접수 파일과 같은 묶음·순서·우편번호 채우기),
   * 방문접수 [파일(주소) 등록]에 넣을 파일(base64). 앱이 판매자 휴대폰 안의 우체국 화면에 채울 때만 쓴다 — 택배사에 아무것도 보내지 않고 상태도 바꾸지 않는다
   */
  async epostKit(sellerId: string, date: string, signal?: AbortSignal): Promise<Outcome<EpostKit>> {
    const visit = await this.#visitRows(sellerId, date, signal)
    if (visit.kind !== 'ok') return visit
    const built = await this.#visitXlsx(sellerId, date, visit.value.rows, signal)
    if (built.kind !== 'ok') return built
    const settings = await readSettings(this.#deps.db, this.#deps.masterKey, sellerId)
    const { rows, buyers, qty } = visit.value
    // 보내는 분 우편번호가 비었으면 받는 분과 같이 서버 우편번호 찾기로 채운다 (D-UX3-40 — 들고 가기 입력 화면은 보내는 분 우편번호가 있어야 받는다)
    const sender = settings.sender === null ? null : { ...settings.sender, zip: await this.#senderZip(settings.sender, signal) }
    return ok({
      date,
      sender,
      receivers: rows.map((row, index) => {
        const size = EPOST_VISIT_CLASS[row.box]
        return { buyer: buyers[index] as string, name: row.name, phone: row.phone, zip: row.zip, address: row.address, detail: row.detail, memo: row.memo, qty: qty[index] as number, content: row.content, kg: size.kg, cm: size.cm }
      }),
      file: { name: `우체국-방문접수-${date}.xlsx`, base64: Buffer.from(built.value).toString('base64') },
    })
  }

  /** 직접 접수 송장 본문: kind VISIT·COUNTER, items = [{ buyer, invoice }] 1~200개 (겹치는 구매자·송장번호 없음, 송장번호는 우체국 등기번호 숫자 13자리 — 공백·`-`는 뺀다) */
  static directInput(body: Record<string, unknown>): { ok: true; kind: DirectKind; items: { buyer: string; invoice: string }[] } | { ok: false; error: ApiProblem } {
    const bad = (message: string, field = 'items') => ({ ok: false as const, error: { status: 400, code: 'INVALID_INPUT' as const, message, problems: [{ field, message }] } })
    if (Object.keys(body).some((key) => key !== 'requestId' && key !== 'kind' && key !== 'items')) return { ok: false, error: { status: 400, code: 'UNKNOWN_FIELD', message: '받을 수 없는 항목이 있어요.', problems: [] } }
    const kind = body.kind
    if (kind !== 'VISIT' && kind !== 'COUNTER') return bad('우체국 접수 방법을 확인해 주세요.', 'kind')
    const items = body.items
    if (!Array.isArray(items) || items.length === 0) return bad('송장번호를 넣을 묶음을 골라 주세요.')
    if (items.length > BOOK_MAX) return bad(PARCEL_MESSAGES.tooMany)
    const out: { buyer: string; invoice: string }[] = []
    const buyers = new Set<string>()
    const invoices = new Set<string>()
    for (const item of items as unknown[]) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return bad('송장번호를 넣을 묶음을 확인해 주세요.')
      const keys = Object.keys(item)
      if (keys.length !== 2 || !keys.includes('buyer') || !keys.includes('invoice')) return bad('송장번호를 넣을 묶음을 확인해 주세요.')
      const { buyer, invoice } = item as { buyer: unknown; invoice: unknown }
      if (typeof buyer !== 'string' || buyer === '' || [...buyer].length > 128 || buyers.has(buyer)) return bad('송장번호를 넣을 묶음을 확인해 주세요.')
      const digits = typeof invoice === 'string' ? invoice.replace(/[\s-]/g, '') : ''
      if (!EPOST_REGI_RE.test(digits)) return bad(PARCEL_MESSAGES.directInvoice)
      if (invoices.has(digits)) return bad(PARCEL_MESSAGES.directDuplicate)
      buyers.add(buyer)
      invoices.add(digits)
      out.push({ buyer, invoice: digits })
    }
    return { ok: true, kind, items: out }
  }

  /**
   * 직접 접수 송장 적기 (D-UX3-37): 판매자가 인터넷우체국에서 직접 접수(방문접수·창구 간편사전접수)한 묶음에 우체국 송장번호를 붙인다.
   * 묶음마다 자동 접수와 같은 판단(PC-4 — 고를 수 있음만) → 시도 BOOKED(요청 키 앞말 direct-…) + 포장 기록 배송 완료(송장번호). 택배사에는 아무것도 보내지 않는다.
   * 배송 조회는 자동 접수와 같이 우체국 조회로, [접수 취소]는 라이브찜 기록만 지운다. 같은 날 다른 묶음에 이미 적은 송장번호는 그 묶음만 거절. 같은 요청 번호면 처음 결과
   */
  async recordDirect(sellerId: string, accountId: string, date: string, requestId: string, kind: DirectKind, items: readonly { buyer: string; invoice: string }[]): Promise<Outcome<{ results: BookItemResult[] }>> {
    if (!isValidDate(date)) return NOT_FOUND
    const { db, masterKey } = this.#deps
    const answerPrior = async (prior: RequestRow): Promise<Outcome<{ results: BookItemResult[] }>> => {
      if (prior.kind !== 'DIRECT' || prior.date !== date) return problem(409, 'REQUEST_ERROR', PARCEL_MESSAGES.request)
      if (prior.result !== null) return ok({ results: JSON.parse(prior.result) as BookItemResult[] })
      const flight = this.#flights.get(JSON.stringify([sellerId, requestId]))
      if (flight !== undefined) return ok({ results: await flight })
      const attempts = await latestAttempts(db, sellerId, date)
      return ok({ results: ParcelService.bookTargets(prior.targets).map((item) => this.#resultOf(item.buyer, attempts.get(item.buyer) ?? null)) })
    }
    const prior = await requestRow(db, sellerId, requestId)
    if (prior !== null) return answerPrior(prior)
    const known = await this.#knownBuyers(sellerId, date, items)
    if (known.kind !== 'ok') return known
    const settings = await readSettings(db, masterKey, sellerId)
    if (!(await claimRequest(db, { sellerId, requestId, date, kind: 'DIRECT', targets: items.map((item) => ({ buyer: item.buyer })), result: null, now: new Date(this.#deps.clock.now()) }))) {
      const again = await requestRow(db, sellerId, requestId)
      return again === null ? problem(409, 'REQUEST_ERROR', PARCEL_MESSAGES.request) : answerPrior(again)
    }
    const results = await this.#fly(sellerId, requestId, async () => {
      const out: BookItemResult[] = []
      for (const item of items) {
        const used = [...(await latestAttempts(db, sellerId, date)).values()].some((attempt) => attempt.buyer !== item.buyer && attempt.state === 'BOOKED' && attempt.invoice === item.invoice)
        if (used) {
          out.push({ buyer: item.buyer, ok: false, reason: 'REJECTED', message: PARCEL_MESSAGES.directUsed })
          continue
        }
        const prepared = await this.#prepare(sellerId, accountId, date, item.buyer, settings.box, 'EPOST', kind)
        if (prepared.kind === 'skip') {
          out.push(prepared.result)
          continue
        }
        out.push(await this.#finish(sellerId, accountId, date, prepared.attempt, { kind: 'BOOKED', invoice: item.invoice }))
      }
      return out
    })
    return ok({ results })
  }

  /**
   * 우체국 방문접수 파일의 빈 우편번호를 서버 우편번호 찾기로 채운다 (D-UX3-36 — 우체국은 빈 칸을 받지만 [주소검증]에서 판매자가 다시 골라야 한다).
   * 하나로 모일 때만 넣고, 못 찾거나 묻지 못하면 빈 칸 그대로(파일은 그래도 만든다). 동시에 묻는 수는 접수와 같다
   */
  /** 보내는 분 우편번호 — 있으면 그대로, 비었으면 우편번호 찾기(하나로 모일 때만), 못 찾으면 빈 칸 */
  async #senderZip(sender: { readonly zip: string; readonly address: string; readonly detail: string }, signal?: AbortSignal): Promise<string> {
    const findZip = this.#deps.options.findZip
    if (/^[0-9]{5}$/.test(sender.zip) || findZip === undefined || signal?.aborted === true) return sender.zip
    try {
      const found = await findZip(zipQuery(sender))
      return found.kind === 'ZIP' ? found.zip : sender.zip
    } catch {
      return sender.zip
    }
  }

  async #fillZips(rows: EpostVisitRow[], signal?: AbortSignal): Promise<void> {
    const findZip = this.#deps.options.findZip
    if (findZip === undefined) return
    const missing = rows.map((row, index) => ({ row, index })).filter(({ row }) => !/^[0-9]{5}$/.test(row.zip))
    let next = 0
    const lane = async (): Promise<void> => {
      while (next < missing.length && signal?.aborted !== true) {
        const item = missing[next++] as { row: EpostVisitRow; index: number }
        try {
          const found = await findZip(zipQuery(item.row))
          if (found.kind === 'ZIP') rows[item.index] = { ...item.row, zip: found.zip }
        } catch {
          // 묻지 못했다 — 빈 칸 그대로 (우체국 [주소검증])
        }
      }
    }
    const lanes = Math.max(1, Math.min(this.#deps.options.concurrency ?? BOOK_CONCURRENCY, missing.length))
    await Promise.all(Array.from({ length: lanes }, lane))
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
