// 입금 확인 서비스 (N3, DEPOSIT_RULES DP-0~DP-8, D-N3-02~D-N3-12, AC-N3-10~33).
// - 원천: 계좌조회(팝빌 EasyFinBank 어댑터)·붙여넣기·가짜(시험 모드에서만). 받아 오기는 원천마다 주기로, 같은 원천의 받아 오기는 겹쳐 돌지 않는다.
//   원천을 기다리는 동안 판매 범위의 기록 잠금도 판매자 입금 처리 줄도 잡지 않는다(DP-0 5, DP-7).
// - 판매자마다 입금 저장·자동 확인·확정·무시·되돌리기를 한 번에 하나씩 처리한다(프로세스 안 판매자별 줄 + 저장 트랜잭션의 어드바이저리 락, DP-7).
// - 맞추기는 순수 함수(match.ts) 하나만 부른다: 받을 때(자동 확인)와 볼 때(확인 필요 사유·제안) 모두.
// - 엔진에 남기는 것은 손 입금과 같은 settlement.payment(메모 `자동 입금 확인 · 입금 #12`·`입금 내역으로 확인 · 입금 #12`)와
//   되돌리기의 settlement.refund(사유 `입금 확인 되돌림 · 입금 #12`)뿐이다. 엔진 기록·입금 상태·연결·처리 기록·요청 번호는 같은 트랜잭션이다
//   (기록 경로의 afterInsert — 엔진 기록과 입금 상태 저장 사이에 멈춰도 한쪽만 남지 않는다). 엔진 요청 번호는 dep-<번호>-pay-<차례>·dep-<번호>-rev-<차례>.
// - 자동 확인·확정·되돌리기의 마지막 확인은 기록 경로의 build 안(그 범위의 기록 잠금 안, 최신 상태)에서 한다.
// - 로그에는 코드·개수·오류 종류만 남긴다(입금자명·금액·붙여넣은 글·계좌번호·사업자번호·팝빌 응답 없음, AC-N3-16).
import { randomUUID } from 'node:crypto'
import { currentBuyerOf, getSettlement, isValidDate } from '@livejjim/core'
import { hasUnsafeText } from '../api-fields.ts'
import type { Db } from '../db/database.ts'
import type { ErrorCode, FieldProblem } from '../errors.ts'
import { realTimer, type GeneratorTimer } from '../generator.ts'
import { errorKind, type LogSink } from '../log.ts'
import { sha256Hex } from '../secrets.ts'
import type { Clock } from '../time.ts'
import { WriteAbort, type Rejection, type ScopeWriter, type WriteOutcome } from '../writer.ts'
import { corpKeyOf, openAccount, sealAccount } from './account-seal.ts'
import { bundleOf, bundlesOf, buyerInfoOf, buyerLabel, previewPayment, type BundleFacts, type PaymentPreview, type StateAt } from './bundles.ts'
import { addDays, kstDateOf, kstStartOf, parseOffsetIso } from './calendar.ts'
import { MATCH_DAYS_BACK, evaluateDeposits, evaluateEach, type MatchDeposit, type ReviewReason } from './match.ts'
import { normalizeDepositName } from './name.ts'
import { DEPOSIT_AMOUNT_MAX, cleanDepositName, readPaste, type PasteRow } from './paste.ts'
import { SOURCE_MESSAGES, SourceError, fetchPopbill, sourceErrorKind, withTimeout, type FetchResult, type FetchedRow, type PopbillTransport } from './popbill.ts'
import {
  actionsOfDeposit,
  bindCorpKey,
  corpKeyOfSeller,
  depositsBetween,
  depositsByNos,
  enabledFetchSources,
  ensurePasteSource,
  existingKeys,
  findDeposit,
  findPasteSource,
  findRequest,
  findSource,
  insertActions,
  insertDeposits,
  insertLink,
  insertName,
  insertRequest,
  insertSource,
  latestLinkDates,
  linksOfScope,
  listDeposits,
  listNames,
  listSources,
  lockSellerDeposits,
  maxDepositNo,
  realScopeDates,
  realScopeId,
  reviewCount,
  sellerOfCorpKey,
  setDepositState,
  updateSource,
  deleteName,
  type DepositRow,
  type DepositStatus,
  type NewDeposit,
  type SourceKind,
  type SourceRow,
  type StoredResult,
} from './store.ts'

// ── 정한 값 ──────────────────────────────────────────────────────────────

/** 받는 기간: 거래 시각의 KST 날짜가 받는 날 − 30일과 같거나 늦고, 받는 순간 + 5분보다 늦지 않은 입금 (DP-1) */
export const RECEIVE_DAYS_BACK = 30
export const RECEIVE_FUTURE_MS = 5 * 60_000
/** "지금 받아 오기" 간격 (같은 원천 1분에 한 번 — E2E 기동만 줄인다) */
export const REFETCH_GAP_MS = 60_000
/** 수집 상태 확인 간격·수집 대기 상한·전송 호출 시간 제한 (AC-N3-15) */
export const POPBILL_POLL_MS = 1000
export const POPBILL_JOB_TIMEOUT_MS = 60_000
export const SOURCE_CALL_TIMEOUT_MS = 30_000
/** 받아 오기 주기 (분) */
export const INTERVAL_MIN = 1
export const INTERVAL_MAX = 5
export const INTERVAL_DEFAULT = 5
/** 원천 표시 이름 길이 */
export const SOURCE_LABEL_MAX = 20
/** 목록 개수 */
export const LIST_LIMIT_DEFAULT = 50
export const LIST_LIMIT_MAX = 200
/** 한꺼번에 처리할 수 있는 항목 수 */
export const BULK_MAX = 100
/** 묶음 찾기 결과 수 */
export const SEARCH_LIMIT = 50
/** 날짜를 고르지 않은 묶음 찾기의 날짜 범위: 입금 날짜 60일 전 ~ 30일 뒤 (그 밖의 날짜는 날짜를 골라 찾는다 — RA-N3-003) */
export const SEARCH_DAYS_BEFORE = 60
export const SEARCH_DAYS_AFTER = 30
/** 기억한 입금자명의 구매자 표시 이름을 찾는 최근 날짜 범위 (그 밖은 그 채널에 입금 확인으로 적은 가장 늦은 날짜를 본다) */
export const NAMES_DAYS_BACK = 60
/** 시험용 입금 넣기 한 번의 줄 수 */
export const TEST_ROWS_MAX = 1000

/** 화면 문장 (acceptance·DEPOSIT_RULES가 따옴표로 정한 것 — 화면이 그대로 보인다) */
export const DEPOSIT_MESSAGES = {
  bundleChanged: '묶음 금액이 바뀌었어요. 다시 확인해 주세요.',
  applied: '이미 반영한 입금이에요.',
  ignored: '무시한 입금이에요. 다시 확인 필요로 옮긴 뒤 확정해 주세요.',
  notReview: '확인 필요인 입금만 무시할 수 있어요.',
  notIgnored: '무시한 입금만 다시 확인 필요로 옮길 수 있어요.',
  notApplied: '반영한 입금만 되돌릴 수 있어요.',
  changed: '입금 상태가 바뀌었어요. 다시 확인해 주세요.',
  refundRecorded: '이미 환불을 적어서 되돌릴 수 없어요. 정산에서 확인해 주세요.',
  duplicateItem: '같은 입금이 두 번 들어 있어요.',
  noBundle: '묶음을 골라 주세요.',
  noHeader: '표의 첫 줄(거래일시·입금액 같은 칸 이름)을 함께 붙여 넣어 주세요.',
  tooManyRows: '한 번에 2,000줄까지 넣을 수 있어요. 나눠서 넣어 주세요.',
  popbillNotReady: '계좌 연동은 아직 준비 중이에요. 붙여넣기로 넣어 주세요.',
  noFetch: '붙여넣기는 받아 오기가 없어요.',
  disabled: '꺼진 원천이에요. 켠 뒤 받아 와 주세요.',
  tooSoon: '방금 받아 왔어요. 잠시 뒤에 다시 눌러 주세요.',
  saveFailed: '받은 내역을 저장하지 못했어요. 잠시 뒤에 다시 받아 올게요.',
  writeFailed: '저장하지 못했어요. 다시 시도해 주세요.',
} as const

/** 원천 표시 이름 기본값 (DP-8) */
const KIND_LABEL: Readonly<Record<SourceKind, string>> = { POPBILL: '계좌조회', PASTE: '붙여넣기', FAKE: '시험용 입금' }

// ── 보기 ─────────────────────────────────────────────────────────────────

export type DepositOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly status: number; readonly code: ErrorCode; readonly message: string; readonly problems?: readonly FieldProblem[] }

const fail = (status: number, code: ErrorCode, message: string, problems: readonly FieldProblem[] = []): DepositOutcome<never> => ({ ok: false, status, code, message, ...(problems.length === 0 ? {} : { problems }) })
const invalid = (problems: readonly FieldProblem[]) => fail(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', problems)
const notFound = () => fail(404, 'NOT_FOUND', '찾을 수 없어요.')

export interface SourceView {
  readonly id: string
  readonly kind: SourceKind
  readonly label: string
  readonly enabled: boolean
  readonly intervalMin: number
  /** 계좌조회: 팝빌 은행 코드와 계좌번호 끝 4자리 (사업자번호는 보이지 않는다) */
  readonly bank: string | null
  readonly accountLast4: string | null
  readonly lastFetchedAt: string | null
  readonly lastError: string | null
  readonly lastErrorAt: string | null
  readonly lastNew: number | null
  /** 지금 받아 오는 중 */
  readonly fetching: boolean
  /** 받아 오기가 있는 원천 (붙여넣기는 없다) */
  readonly fetchable: boolean
}

/** 묶음 하나의 보기 (제안·묶음 찾기·확정 창) */
export interface BundleView {
  readonly date: string
  /** 지금의 구매자 ID */
  readonly buyer: string
  /** 그 날짜 범위의 BUY-01 이름 표기 */
  readonly name: string
  readonly total: number
  readonly received: number
  readonly remaining: number
  readonly payment: string
  readonly refundDue: number
  /** 이 입금을 확정하면 바뀔 입금 상태 (코어 정산 계산) */
  readonly after: PaymentPreview | null
  /** 입금 시각이 이 묶음의 판매(판매 시각)보다 먼저인지 */
  readonly beforeSale: boolean
  /** 확정할 때 입금자명을 기억할 수 있는지 (유튜브 구매자이고 이름 후보에 아직 없는 입금자명) */
  readonly canRemember: boolean
}

export type ShownReason = ReviewReason | 'ONE_MATCH'

export interface DepositView {
  readonly no: number
  readonly source: { readonly id: string; readonly kind: SourceKind; readonly label: string }
  readonly at: string
  readonly precision: 'second' | 'minute'
  readonly amount: number
  readonly name: string
  readonly status: DepositStatus
  readonly applied: { readonly date: string; readonly buyer: string; readonly buyerName: string; readonly seq: number; readonly auto: boolean } | null
  readonly receivedAt: string
  readonly handledAt: string | null
  /** 확인 필요 입금만: 볼 때 다시 계산한 사유·쌍둥이·제안·미리 고른 묶음 */
  readonly review?: {
    readonly reason: ShownReason
    readonly twin: number | null
    readonly suggestions: readonly BundleView[]
    readonly preselect: { readonly date: string; readonly buyer: string } | null
  }
}

export interface DepositDetail extends DepositView {
  readonly actions: readonly {
    readonly action: string
    readonly actor: { readonly kind: 'account' | 'auto' | 'server'; readonly loginId: string | null }
    readonly at: string
    readonly date: string | null
    readonly buyer: string | null
    readonly buyerName: string | null
    readonly seq: number | null
  }[]
}

/** 처리 결과 (확정·무시·다시 확인 필요로·되돌리기 — 같은 요청 번호의 재전송도 같은 모양) */
export interface ActionResult {
  readonly deposit: {
    readonly no: number
    readonly status: DepositStatus
    /** 확정: 적은 묶음. beforeSale = 입금 시각이 그 묶음의 판매보다 먼저 ("입금 시각이 이 묶음의 판매보다 먼저예요." — 막지는 않는다) */
    readonly applied: { readonly date: string; readonly buyer: string; readonly buyerName: string; readonly seq: number; readonly beforeSale?: boolean } | null
  }
  /** 되돌리기: 적은 환불 기록 */
  readonly refund?: { readonly date: string; readonly seq: number }
}

export interface IngestSummary {
  /** 새로 저장한 입금 번호 (번호 순) */
  readonly stored: readonly number[]
  readonly existing: number
  /** 저장하지 못한 줄 (DB가 받지 못한 줄 — 그 줄만 건너뛰고 나머지는 저장했다, SA-N3-08) */
  readonly failed: number
  readonly old: number
  readonly future: number
  readonly auto: number
  readonly review: number
}

export interface PasteSummary {
  /** 읽은 입금 (DP-2 rows) */
  readonly read: number
  /** 건너뛴 줄 (출금 등) */
  readonly skipped: number
  /** 읽지 못한 줄 (줄 번호·이유) */
  readonly unreadable: readonly { readonly line: number; readonly why: 'BAD_AMOUNT' | 'BAD_TIME' }[]
  readonly new: number
  readonly existing: number
  /** 저장하지 못한 줄 수 (보통 0 — SA-N3-08) */
  readonly failed: number
  readonly old: number
  readonly future: number
  readonly auto: number
  readonly review: number
}

export type RowState = 'NEW' | 'EXISTING' | 'OLD' | 'FUTURE'

export interface PastePreview {
  readonly rows: readonly (PasteRow & { readonly state: RowState })[]
  readonly skipped: readonly { readonly line: number; readonly why: 'NOT_DEPOSIT' }[]
  readonly unreadable: readonly { readonly line: number; readonly why: 'BAD_AMOUNT' | 'BAD_TIME' }[]
}

/** 정산 조회의 입금 연결 (AC-N3-32) — 범위 seq로 정산 기록에 붙는다 */
export interface DepositLinkView {
  readonly seq: number
  readonly kind: 'payment' | 'refund'
  readonly auto: boolean
  /** 입금 기록이면: 그 뒤 되돌렸는지 */
  readonly reverted: boolean
  readonly deposit: { readonly no: number; readonly name: string; readonly at: string; readonly precision: 'second' | 'minute'; readonly amount: number; readonly source: string; readonly sourceKind: SourceKind }
}

export interface ConfirmInput {
  readonly date: string
  readonly buyer: string
  readonly remaining: number
  readonly remember: boolean
}

export type BulkItem = { readonly no: number; readonly action: 'ignore' } | ({ readonly no: number; readonly action: 'confirm' } & ConfirmInput)
export type BulkEntry = BulkItem | { readonly no: number | null; readonly invalid: DepositOutcome<never> }

export interface BulkResult {
  readonly results: readonly ({ readonly no: number | null; readonly ok: true; readonly deposit: ActionResult['deposit'] } | { readonly no: number | null; readonly ok: false; readonly status: number; readonly error: { readonly code: ErrorCode; readonly message: string } })[]
}

// ── 설정 ─────────────────────────────────────────────────────────────────

export interface DepositOptions {
  /** 시험 모드 — 가짜 원천과 시험용 입금 넣기 경로 (E2E 기동만 켠다. 운영 기동에는 없다, D-N3-12) */
  readonly testMode?: boolean
  /** 팝빌 전송 (연동 키가 있을 때 실제 전송, 시험은 가짜 전송). 없으면 계좌조회 원천을 만들 수 없다 */
  readonly popbill?: PopbillTransport | null
  /** 받아 오기 주기 덮어쓰기 (밀리초, 100~300000 — E2E 기동만. 운영은 원천의 1~5분) */
  readonly pollMs?: number
  /** "지금 받아 오기" 간격 (밀리초, 0~60000, 기본 60000 — E2E 기동만 줄인다) */
  readonly refetchGapMs?: number
  /** 받아 오기 주기 타이머 (시험은 손으로 돌리는 타이머) */
  readonly timer?: GeneratorTimer
  /** 받아 오기 안의 대기·시간 제한 타이머 (수집 상태 확인 간격·전송 호출 시간 제한, 기본 실제 타이머) */
  readonly waitTimer?: GeneratorTimer
  /** 수집 상태 확인 간격 (밀리초, 기본 1000) */
  readonly popbillPollMs?: number
  /** 전송 호출 하나의 시간 제한 (밀리초, 기본 30000) */
  readonly callTimeoutMs?: number
  /** 서버를 켤 때 저장된 원천의 주기를 건다 (기본 true) */
  readonly autoStart?: boolean
  /** 시험용 주입점: 자동 확인을 엔진에 적기 직전(맞추기 뒤) — 그 사이에 손 입금·배송비 예외 같은 쓰기를 끼워 넣는다 (AC-N3-22) */
  readonly hooks?: { readonly beforeAuto?: (sellerId: string, no: number) => Promise<void> | void }
}

export interface DepositServiceDeps {
  readonly db: Db
  readonly writer: ScopeWriter
  readonly clock: Clock
  readonly masterKey: Buffer
  readonly log: LogSink
  /** 실시간 알림 (그 판매자의 연결 전부) */
  readonly publish: (sellerId: string, data: Readonly<Record<string, unknown>>) => void
  readonly options: DepositOptions
}

interface MatchContext {
  /** 날짜 → 범위 상태 */
  readonly states: ReadonlyMap<string, StateAt>
  readonly bundles: readonly BundleFacts[]
  readonly byKey: ReadonlyMap<string, BundleFacts>
  /** 관련 날짜의 입금 전부 (번호 순 — 쌍둥이 후보) */
  readonly sameDays: readonly DepositRow[]
}

const toMatch = (row: DepositRow): MatchDeposit => ({ no: row.no, at: row.at.getTime(), amount: row.amount, name: row.name })
const isoOrNull = (date: Date | null): string | null => (date === null ? null : date.toISOString())
const charCount = (text: string): number => [...text].length

/** 붙여넣기 줄 키 (DP-1): (거래 시각, 금액, 정규화 입금자명, 잔액) + 같은 붙여넣기 안에서 몇 번째 — 해시로 둔다(이름이 키에 그대로 남지 않게) */
export function pasteRowKeys(rows: readonly PasteRow[]): string[] {
  const seen = new Map<string, number>()
  return rows.map((row) => {
    const base = JSON.stringify([row.at, row.amount, normalizeDepositName(row.name), row.balance])
    const nth = (seen.get(base) ?? 0) + 1
    seen.set(base, nth)
    return `p1:${sha256Hex(JSON.stringify([base, nth]))}`
  })
}

export class DepositService {
  readonly #deps: DepositServiceDeps
  readonly #timer: GeneratorTimer
  readonly #waitTimer: GeneratorTimer
  readonly #queues = new Map<string, Promise<unknown>>()
  readonly #schedules = new Map<string, () => void>()
  readonly #running = new Map<string, Promise<void>>()
  readonly #lastManual = new Map<string, number>()
  /** 시험 모드 가짜 원천에 넣은 줄 (원천 ID → 줄) */
  readonly #fakeRows = new Map<string, FetchedRow[]>()
  #closed = false

  constructor(deps: DepositServiceDeps) {
    this.#deps = deps
    this.#timer = deps.options.timer ?? realTimer
    this.#waitTimer = deps.options.waitTimer ?? realTimer
  }

  get testMode(): boolean {
    return this.#deps.options.testMode === true
  }

  /** 계좌조회 원천을 만들 수 있는지 (연동 키 또는 시험용 전송이 있다) */
  get popbillReady(): boolean {
    return this.#deps.options.popbill !== undefined && this.#deps.options.popbill !== null
  }

  #now(): number {
    return this.#deps.clock.now()
  }

  /** 판매자마다 한 줄: 같은 판매자의 입금 처리는 앞 작업이 끝난 뒤 시작한다 (DP-7) */
  #serial<T>(sellerId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(sellerId) ?? Promise.resolve()
    const run = previous.then(task, task)
    const settled = run.then(
      () => undefined,
      () => undefined,
    )
    this.#queues.set(sellerId, settled)
    void settled.then(() => {
      if (this.#queues.get(sellerId) === settled) this.#queues.delete(sellerId)
    })
    return run
  }

  #notify(sellerId: string, nos: readonly number[], sources: readonly string[] = []): void {
    void reviewCount(this.#deps.db, sellerId)
      .then((review) => this.#deps.publish(sellerId, { deposits: [...nos], review, sources: [...sources] }))
      .catch((error: unknown) => this.#deps.log({ level: 'warn', code: 'DEPOSIT_NOTIFY_FAILED', errorKind: errorKind(error) }))
  }

  // ── 원천 ───────────────────────────────────────────────────────────────

  #sourceView(row: SourceRow): SourceView {
    let bank: string | null = null
    let last4: string | null = null
    if (row.kind === 'POPBILL' && row.accountEnc !== null) {
      try {
        const account = openAccount(this.#deps.masterKey, row.sellerId, row.id, row.accountEnc)
        bank = account.bank
        last4 = account.accountNumber.slice(-4)
      } catch {
        // 풀지 못하면 보이지 않는다 (값은 어디에도 남기지 않는다)
      }
    }
    return {
      id: row.id,
      kind: row.kind,
      label: row.label,
      enabled: row.enabled,
      intervalMin: row.intervalMin,
      bank,
      accountLast4: last4,
      lastFetchedAt: isoOrNull(row.lastFetchedAt),
      lastError: row.lastError,
      lastErrorAt: isoOrNull(row.lastErrorAt),
      lastNew: row.lastNew,
      fetching: this.#running.has(row.id),
      fetchable: row.kind !== 'PASTE',
    }
  }

  /** 원천 목록 (AC-N3-14·46) */
  async sources(sellerId: string): Promise<{ sources: SourceView[]; popbill: boolean; testMode: boolean }> {
    const rows = await listSources(this.#deps.db, sellerId)
    return { sources: rows.map((row) => this.#sourceView(row)), popbill: this.popbillReady, testMode: this.testMode }
  }

  /** 원천 만들기: 계좌조회 { kind: POPBILL, label, corpNum, bank, accountNumber } · 시험 모드에서만 가짜 { kind: FAKE, label? } (AC-N3-15·16·17) */
  async createSource(sellerId: string, input: { kind: unknown; label?: unknown; corpNum?: unknown; bank?: unknown; accountNumber?: unknown; intervalMin?: unknown }): Promise<DepositOutcome<SourceView>> {
    const kind = input.kind
    if (kind !== 'POPBILL' && !(kind === 'FAKE' && this.testMode)) return invalid([{ field: 'kind', message: '계좌조회 원천만 만들 수 있어요.' }])
    if (kind === 'POPBILL' && !this.popbillReady) return fail(409, 'POPBILL_NOT_READY', DEPOSIT_MESSAGES.popbillNotReady)
    const problems: FieldProblem[] = []
    const label = typeof input.label === 'string' ? input.label.trim() : input.label === undefined && kind === 'FAKE' ? KIND_LABEL.FAKE : null
    if (label === null || label === '' || charCount(label) > SOURCE_LABEL_MAX || hasUnsafeText(label)) problems.push({ field: 'label', message: `표시 이름은 1~${String(SOURCE_LABEL_MAX)}자로 적어 주세요.` })
    const interval = input.intervalMin === undefined ? INTERVAL_DEFAULT : input.intervalMin
    if (typeof interval !== 'number' || !Number.isInteger(interval) || interval < INTERVAL_MIN || interval > INTERVAL_MAX) problems.push({ field: 'intervalMin', message: '받아 오기 주기는 1~5분 중에서 골라 주세요.' })
    let account: { corpNum: string; bank: string; accountNumber: string } | null = null
    if (kind === 'POPBILL') {
      const corpNum = typeof input.corpNum === 'string' ? input.corpNum.replace(/[\s-]/g, '') : ''
      const bank = typeof input.bank === 'string' ? input.bank.trim() : ''
      const accountNumber = typeof input.accountNumber === 'string' ? input.accountNumber.replace(/[\s-]/g, '') : ''
      if (!/^\d{10}$/.test(corpNum)) problems.push({ field: 'corpNum', message: '사업자번호는 숫자 10자리로 적어 주세요.' })
      if (!/^\d{4}$/.test(bank)) problems.push({ field: 'bank', message: '은행을 골라 주세요.' })
      if (!/^\d{6,20}$/.test(accountNumber)) problems.push({ field: 'accountNumber', message: '계좌번호는 숫자로 적어 주세요.' })
      account = { corpNum, bank, accountNumber }
    } else {
      for (const field of ['corpNum', 'bank', 'accountNumber'] as const) if (input[field] !== undefined) problems.push({ field, message: '시험용 원천에는 계좌를 적지 않아요.' })
    }
    if (problems.length > 0) return invalid(problems)
    // 사업자번호는 판매자에게 묶인 것만 (RA-N3-001, TD-N3-004): 운영에서는 운영자가 popbill-corp 명령으로 이 계정에 묶은 번호만 쓴다.
    // 시험 모드만 팝빌이 그 번호로 처음 답한 때(받아 오기·계좌 관리 주소 성공) 저절로 묶는다
    if (account !== null) {
      const use = await this.#corpUse(sellerId, account.corpNum)
      if (use !== 'OK') return fail(409, 'CORP_NOT_ALLOWED', SOURCE_MESSAGES[use])
    }
    const id = `dsrc_${randomUUID()}`
    const now = new Date(this.#now())
    await insertSource(this.#deps.db, {
      id,
      sellerId,
      kind,
      label: label as string,
      intervalMin: interval as number,
      accountEnc: account === null ? null : sealAccount(this.#deps.masterKey, sellerId, id, account),
      now,
    })
    const row = await findSource(this.#deps.db, sellerId, id)
    if (row === null) return fail(500, 'SAVE_FAILED', DEPOSIT_MESSAGES.writeFailed)
    this.#schedule(row)
    this.#notify(sellerId, [], [id])
    return { ok: true, value: this.#sourceView(row) }
  }

  /** 원천 고치기 { label?, intervalMin?(1~5), enabled? } — 주기는 바로 적용된다. 원천을 지우는 API는 없다(끄기만) */
  async updateSource(sellerId: string, id: string, input: { label?: unknown; intervalMin?: unknown; enabled?: unknown }): Promise<DepositOutcome<SourceView>> {
    const row = await findSource(this.#deps.db, sellerId, id)
    if (row === null) return notFound()
    const problems: FieldProblem[] = []
    const patch: { label?: string; intervalMin?: number; enabled?: boolean } = {}
    if (input.label !== undefined) {
      const label = typeof input.label === 'string' ? input.label.trim() : ''
      if (label === '' || charCount(label) > SOURCE_LABEL_MAX || hasUnsafeText(label)) problems.push({ field: 'label', message: `표시 이름은 1~${String(SOURCE_LABEL_MAX)}자로 적어 주세요.` })
      else patch.label = label
    }
    if (input.intervalMin !== undefined) {
      const interval = input.intervalMin
      if (row.kind === 'PASTE') problems.push({ field: 'intervalMin', message: '붙여넣기는 받아 오기 주기가 없어요.' })
      else if (typeof interval !== 'number' || !Number.isInteger(interval) || interval < INTERVAL_MIN || interval > INTERVAL_MAX) problems.push({ field: 'intervalMin', message: '받아 오기 주기는 1~5분 중에서 골라 주세요.' })
      else patch.intervalMin = interval
    }
    if (input.enabled !== undefined) {
      if (typeof input.enabled !== 'boolean') problems.push({ field: 'enabled', message: '켤지는 예나 아니오로만 정할 수 있어요.' })
      else if (row.kind === 'PASTE') problems.push({ field: 'enabled', message: '붙여넣기는 끌 수 없어요.' })
      else patch.enabled = input.enabled
    }
    if (problems.length > 0) return invalid(problems)
    await updateSource(this.#deps.db, sellerId, id, patch, new Date(this.#now()))
    const updated = (await findSource(this.#deps.db, sellerId, id)) as SourceRow
    this.#schedule(updated)
    this.#notify(sellerId, [], [id])
    return { ok: true, value: this.#sourceView(updated) }
  }

  /** 지금 받아 오기 (AC-N3-14): 바로 받아 온다. 같은 원천 1분 안에 다시 누르면 429. 주기와 겹치면 하나만 돈다 */
  async fetchNow(sellerId: string, id: string): Promise<DepositOutcome<SourceView>> {
    const row = await findSource(this.#deps.db, sellerId, id)
    if (row === null) return notFound()
    if (row.kind === 'PASTE') return fail(400, 'SOURCE_NO_FETCH', DEPOSIT_MESSAGES.noFetch)
    if (row.kind === 'FAKE' && !this.testMode) return notFound()
    if (!row.enabled) return fail(409, 'SOURCE_DISABLED', DEPOSIT_MESSAGES.disabled)
    const gap = this.#deps.options.refetchGapMs ?? REFETCH_GAP_MS
    const last = this.#lastManual.get(id)
    const now = this.#now()
    if (last !== undefined && now - last < gap) return fail(429, 'FETCH_TOO_SOON', DEPOSIT_MESSAGES.tooSoon)
    this.#lastManual.set(id, now)
    await this.#run(sellerId, id, true)
    const updated = (await findSource(this.#deps.db, sellerId, id)) as SourceRow
    return { ok: true, value: this.#sourceView(updated) }
  }

  /** 팝빌 계좌 관리 주소 (어댑터가 팝빌에서 받은 주소 그대로 — 저장하지 않는다) */
  async manageUrl(sellerId: string, input: { corpNum?: unknown; source?: unknown }): Promise<DepositOutcome<{ url: string }>> {
    const transport = this.#deps.options.popbill
    if (transport === undefined || transport === null) return fail(409, 'POPBILL_NOT_READY', DEPOSIT_MESSAGES.popbillNotReady)
    let corpNum: string
    if (input.source !== undefined) {
      const row = typeof input.source === 'string' ? await findSource(this.#deps.db, sellerId, input.source) : null
      if (row === null || row.kind !== 'POPBILL' || row.accountEnc === null) return notFound()
      try {
        corpNum = openAccount(this.#deps.masterKey, sellerId, row.id, row.accountEnc).corpNum
      } catch {
        return fail(503, 'SOURCE_FAILED', SOURCE_MESSAGES.NO_KEY)
      }
    } else {
      corpNum = typeof input.corpNum === 'string' ? input.corpNum.replace(/[\s-]/g, '') : ''
      if (!/^\d{10}$/.test(corpNum)) return invalid([{ field: 'corpNum', message: '사업자번호는 숫자 10자리로 적어 주세요.' }])
    }
    // 팝빌 계좌 관리 주소는 그 사업자로 로그인된 주소다 — 이 판매자에게 묶인(시험 모드만: 또는 아무에게도 묶이지 않은) 사업자번호로만 연다 (RA-N3-001, TD-N3-004)
    const use = await this.#corpUse(sellerId, corpNum)
    if (use !== 'OK') return fail(409, 'CORP_NOT_ALLOWED', SOURCE_MESSAGES[use])
    try {
      const timeout = this.#deps.options.callTimeoutMs ?? SOURCE_CALL_TIMEOUT_MS
      const url = await withTimeout(this.#waitTimer, timeout, () => transport.getBankAccountMgtURL({ corpNum }))
      if (typeof url !== 'string' || !/^https:\/\//.test(url)) throw new SourceError('BAD_RESPONSE')
      // 팝빌이 그 번호로 답했다 — 아직 이 판매자의 번호인지 다시 본다(시험 모드는 처음이면 묶는다). 그사이 묶음이 바뀌었으면 주소를 주지 않는다
      const after = await this.#claimCorp(sellerId, corpNum)
      if (after !== 'OK') return fail(409, 'CORP_NOT_ALLOWED', SOURCE_MESSAGES[after])
      return { ok: true, value: { url } }
    } catch (error) {
      const kind = sourceErrorKind(error)
      this.#deps.log({ level: 'warn', code: 'DEPOSIT_FETCH_FAILED', errorKind: kind })
      return fail(503, 'SOURCE_FAILED', SOURCE_MESSAGES[kind])
    }
  }

  /** 시험용 입금 넣기 (시험 모드에서만 — 넣은 줄은 그 가짜 원천이 다음 받아 오기에서 받아 간다, AC-N3-17) */
  async testInsert(sellerId: string, sourceId: string, rows: readonly FetchedRow[]): Promise<DepositOutcome<{ added: number }>> {
    if (!this.testMode) return notFound()
    const row = await findSource(this.#deps.db, sellerId, sourceId)
    if (row === null || row.kind !== 'FAKE') return notFound()
    this.#fakeRows.set(sourceId, [...(this.#fakeRows.get(sourceId) ?? []), ...rows])
    return { ok: true, value: { added: rows.length } }
  }

  /** 시험용 입금 줄 검사 { key, at, amount, name } */
  static testRow(raw: unknown): FetchedRow | null {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
    const record = raw as Record<string, unknown>
    if (Object.keys(record).some((key) => !['key', 'at', 'amount', 'name'].includes(key))) return null
    const { key, at, amount, name } = record
    if (typeof key !== 'string' || !/^[\x21-\x7e]{1,100}$/.test(key)) return null
    const ms = typeof at === 'string' ? parseOffsetIso(at) : null
    if (ms === null) return null
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1 || amount > DEPOSIT_AMOUNT_MAX) return null
    if (typeof name !== 'string') return null
    return { key, at: ms - (ms % 1000), precision: 'second', amount, name: cleanDepositName(name) }
  }

  // ── 받아 오기 주기 ──────────────────────────────────────────────────────

  /** 서버를 켤 때: 저장된 켜진 원천의 주기를 건다 */
  start(): void {
    if (this.#deps.options.autoStart === false) return
    const kinds: SourceKind[] = this.testMode ? ['POPBILL', 'FAKE'] : ['POPBILL']
    void enabledFetchSources(this.#deps.db, kinds)
      .then((rows) => {
        for (const row of rows) this.#schedule(row)
      })
      .catch((error: unknown) => this.#deps.log({ level: 'warn', code: 'DEPOSIT_FETCH_FAILED', errorKind: errorKind(error) }))
  }

  /** 주기·진행 중 대기를 멈춘다 (DB는 닫지 않는다) */
  close(): void {
    this.#closed = true
    for (const cancel of this.#schedules.values()) cancel()
    this.#schedules.clear()
  }

  /** 주기 간격 (밀리초) */
  #intervalMs(row: SourceRow): number {
    return this.#deps.options.pollMs ?? row.intervalMin * 60_000
  }

  #schedule(row: SourceRow): void {
    this.#schedules.get(row.id)?.()
    this.#schedules.delete(row.id)
    if (this.#closed || !row.enabled || row.kind === 'PASTE' || (row.kind === 'FAKE' && !this.testMode)) return
    const cancel = this.#timer.schedule(this.#intervalMs(row), () => {
      if (this.#schedules.get(row.id) === cancel) this.#schedules.delete(row.id)
      void this.#run(row.sellerId, row.id, false).finally(async () => {
        if (this.#closed || this.#schedules.has(row.id)) return
        try {
          const fresh = await findSource(this.#deps.db, row.sellerId, row.id)
          if (fresh !== null) this.#schedule(fresh)
        } catch (error) {
          this.#deps.log({ level: 'warn', code: 'DEPOSIT_FETCH_FAILED', errorKind: errorKind(error) })
          this.#schedule(row)
        }
      })
    })
    this.#schedules.set(row.id, cancel)
  }

  /** 주기가 걸린 원천 수 (시험·점검용) */
  get scheduledSources(): number {
    return this.#schedules.size
  }

  /** 받아 오기 한 번 (같은 원천이 이미 받아 오는 중이면 그것을 기다린다 — 겹쳐 돌지 않는다) */
  #run(sellerId: string, id: string, manual: boolean): Promise<void> {
    const running = this.#running.get(id)
    if (running !== undefined) return running
    const work = this.#fetchOnce(sellerId, id, manual).catch((error: unknown) => {
      this.#deps.log({ level: 'error', code: 'DEPOSIT_SAVE_FAILED', errorKind: errorKind(error) })
    })
    const tracked = work.finally(() => {
      if (this.#running.get(id) === tracked) this.#running.delete(id)
    })
    this.#running.set(id, tracked)
    return tracked
  }

  /** 받아 오기 한 번. 알림은 새 입금이 있거나·오류 문장이 바뀌었거나·판매자가 누른 받아 오기일 때만 (주기마다 알리지 않는다) */
  async #fetchOnce(sellerId: string, id: string, manual: boolean): Promise<void> {
    const { db } = this.#deps
    const row = await findSource(db, sellerId, id)
    if (row === null || !row.enabled || row.kind === 'PASTE' || (row.kind === 'FAKE' && !this.testMode)) return
    let fetched: FetchResult
    try {
      fetched = await this.#fetchRows(row)
    } catch (error) {
      const kind = sourceErrorKind(error)
      const now = new Date(this.#now())
      await updateSource(db, sellerId, id, { lastError: SOURCE_MESSAGES[kind], lastErrorAt: now }, now)
      this.#deps.log({ level: 'warn', code: 'DEPOSIT_FETCH_FAILED', errorKind: kind })
      if (manual || row.lastError !== SOURCE_MESSAGES[kind]) this.#notify(sellerId, [], [id])
      return
    }
    let summary: IngestSummary
    try {
      summary = await this.#serial(sellerId, () => this.#ingest(sellerId, row, fetched.rows, null))
    } catch (error) {
      const now = new Date(this.#now())
      await updateSource(db, sellerId, id, { lastError: DEPOSIT_MESSAGES.saveFailed, lastErrorAt: now }, now)
      this.#deps.log({ level: 'error', code: 'DEPOSIT_SAVE_FAILED', errorKind: errorKind(error) })
      this.#notify(sellerId, [], [id])
      return
    }
    const now = new Date(this.#now())
    const lastError = fetched.malformed > 0 || summary.failed > 0 ? SOURCE_MESSAGES.MALFORMED : null
    await updateSource(db, sellerId, id, { lastFetchedAt: now, lastError, lastErrorAt: lastError === null ? null : now, lastNew: summary.stored.length }, now)
    if (manual || summary.stored.length > 0 || row.lastError !== lastError) this.#notify(sellerId, summary.stored, [id])
  }

  async #fetchRows(row: SourceRow): Promise<FetchResult> {
    if (row.kind === 'FAKE') return { rows: [...(this.#fakeRows.get(row.id) ?? [])], malformed: 0 }
    const transport = this.#deps.options.popbill
    if (transport === undefined || transport === null || row.accountEnc === null) throw new SourceError('NO_KEY')
    let account
    try {
      account = openAccount(this.#deps.masterKey, row.sellerId, row.id, row.accountEnc)
    } catch {
      throw new SourceError('NO_KEY')
    }
    // 사업자번호가 이 판매자에게 묶인 것인지 팝빌을 부르기 전에 본다 (RA-N3-001 — 원천을 만든 뒤 다른 판매자가 그 번호를 묶었을 수 있다)
    const use = await this.#corpUse(row.sellerId, account.corpNum)
    if (use !== 'OK') throw new SourceError(use)
    const fetched = await fetchPopbill(
      {
        transport,
        now: () => this.#now(),
        timer: this.#waitTimer,
        pollMs: this.#deps.options.popbillPollMs ?? POPBILL_POLL_MS,
        jobTimeoutMs: POPBILL_JOB_TIMEOUT_MS,
        callTimeoutMs: this.#deps.options.callTimeoutMs ?? SOURCE_CALL_TIMEOUT_MS,
      },
      account,
    )
    // 팝빌이 그 번호로 답했다 — 아직 이 판매자의 번호인지 다시 본다(시험 모드는 처음이면 묶는다). 그사이 묶음이 바뀌었으면 받은 줄을 버린다(저장하지 않는다)
    const after = await this.#claimCorp(row.sellerId, account.corpNum)
    if (after !== 'OK') throw new SourceError(after)
    return fetched
  }

  /**
   * 사업자번호를 이 판매자가 쓸 수 있는지 (RA-N3-001, SYS-02): 서버는 연동 키 하나로 모든 판매자를 대신해 팝빌을 부르고 토큰은 사업자번호로 받는다 —
   * 사업자번호가 그 판매자의 것인지 서버가 지켜야 다른 판매자의 팝빌 계좌 관리 화면·입금 내역에 닿지 않는다.
   * 판매자마다 사업자번호 하나, 사업자번호마다 판매자 하나. 이 판매자에게 묶였으면 그 번호만 쓸 수 있다.
   * 운영(시험 모드가 아님)에서는 운영자가 popbill-corp 명령으로 묶은 번호만 쓴다 — 이 계정에 묶인 번호가 없으면 어떤 번호든 CORP_UNBOUND이고
   * 팝빌을 부르지 않는다(TD-N3-004: 아무에게도 묶이지 않은 남의 번호를 먼저 적어 그 사람의 입금 내역을 보는 틈을 막는다. 그 번호가 다른 계정에 묶였는지도 밝히지 않는다).
   * 시험 모드만 아무에게도 묶이지 않은 번호를 쓸 수 있고 팝빌이 처음 답할 때 묶는다(#claimCorp)
   */
  async #corpUse(sellerId: string, corpNum: string): Promise<'OK' | 'CORP_TAKEN' | 'CORP_MISMATCH' | 'CORP_UNBOUND'> {
    const key = corpKeyOf(this.#deps.masterKey, corpNum)
    const mine = await corpKeyOfSeller(this.#deps.db, sellerId)
    if (mine !== null) return mine === key ? 'OK' : 'CORP_MISMATCH'
    if (!this.testMode) return 'CORP_UNBOUND'
    const owner = await sellerOfCorpKey(this.#deps.db, key)
    return owner === null || owner === sellerId ? 'OK' : 'CORP_TAKEN'
  }

  /**
   * 팝빌이 그 사업자번호로 답한 뒤: 아직 이 판매자가 쓸 수 있는 번호인지 다시 본다.
   * 시험 모드는 처음이면 이 판매자에게 묶는다(이미 묶였으면 그대로). 운영은 묶지 않는다 — 그사이 운영자가 풀었으면 거절
   */
  async #claimCorp(sellerId: string, corpNum: string): Promise<'OK' | 'CORP_TAKEN' | 'CORP_MISMATCH' | 'CORP_UNBOUND'> {
    if (!this.testMode) return this.#corpUse(sellerId, corpNum)
    return (await bindCorpKey(this.#deps.db, sellerId, corpKeyOf(this.#deps.masterKey, corpNum), new Date(this.#now()))) ? 'OK' : 'CORP_TAKEN'
  }

  // ── 저장과 자동 확인 (DP-1·DP-5·DP-6·DP-7) ─────────────────────────────────

  /**
   * 받은 줄을 저장하고 맞춘다 (판매자 줄 안에서 부른다). 받는 기간 밖은 개수만, 같은 외부 키는 저장하지 않는다.
   * 새 입금은 거래 시각 순서(같으면 받은 순서)로 번호를 붙이고 그 순서대로 맞춘다
   */
  async #ingest(sellerId: string, source: SourceRow, rows: readonly FetchedRow[], accountId: string | null): Promise<IngestSummary> {
    const { db } = this.#deps
    const nowMs = this.#now()
    const minDate = addDays(kstDateOf(nowMs), -RECEIVE_DAYS_BACK)
    let old = 0
    let future = 0
    const kept: FetchedRow[] = []
    const keys = new Set<string>()
    for (const row of rows) {
      if (kstDateOf(row.at) < minDate) old++
      else if (row.at > nowMs + RECEIVE_FUTURE_MS) future++
      else if (!keys.has(row.key)) {
        keys.add(row.key)
        kept.push(row)
      }
    }
    const ordered = kept.map((row, index) => ({ row, index })).sort((a, b) => a.row.at - b.row.at || a.index - b.index)
    const now = new Date(nowMs)
    let failed = 0
    const inserted = await db.transaction(async (tx) => {
      await lockSellerDeposits(tx, sellerId)
      const existing = await existingKeys(tx, sellerId, source.id, [...keys])
      const first = (await maxDepositNo(tx, sellerId)) + 1
      const fresh: NewDeposit[] = []
      for (const { row } of ordered) {
        if (existing.has(row.key)) continue
        fresh.push({ no: first + fresh.length, sourceId: source.id, externalKey: row.key, at: new Date(row.at), precision: row.precision, amount: row.amount, name: row.name })
      }
      let done: { id: number; no: number }[]
      try {
        // 한 번에 저장 — 실패하면 이 저장점만 되돌리고 한 줄씩 다시 저장한다
        done = await tx.transaction((inner) => insertDeposits(inner, sellerId, fresh, now))
      } catch (error) {
        // 그물(SA-N3-08): DB가 받지 못하는 줄 하나가 같은 받아 오기·붙여넣기의 다른 줄까지 버리지 않게, 그 줄만 건너뛰고(failed) 나머지는 저장한다.
        // 번호는 저장된 줄에만 차례로 다시 붙인다(빈 번호 없음). 이름·금액은 기록에 남기지 않는다
        this.#deps.log({ level: 'error', code: 'DEPOSIT_ROW_SAVE_RETRY', errorKind: errorKind(error) })
        done = []
        let next = first
        for (const row of fresh) {
          try {
            const one = await tx.transaction((inner) => insertDeposits(inner, sellerId, [{ ...row, no: next }], now))
            done.push(...one)
            next += one.length
          } catch (rowError) {
            failed++
            this.#deps.log({ level: 'error', code: 'DEPOSIT_ROW_SAVE_FAILED', errorKind: errorKind(rowError) })
          }
        }
      }
      await insertActions(
        tx,
        sellerId,
        done.map((item) => ({ depositId: item.id, action: 'RECEIVED' as const, accountId })),
        now,
      )
      return done.map((item) => item.no).sort((a, b) => a - b)
    })
    const existingCount = kept.length - inserted.length - failed
    const auto = inserted.length === 0 ? 0 : await this.#autoConfirm(sellerId, inserted)
    return { stored: inserted, existing: existingCount, failed, old, future, auto, review: inserted.length - auto }
  }

  /**
   * 맞추기 재료 (DP-4): 입금 날짜 dd마다 [dd − 30일, dd]의 실제 범위 상태·묶음과 입금 날짜들의 입금(쌍둥이 후보).
   * 읽는 날짜는 그 창들의 합집합뿐이다 — 가장 이른 입금 −30일부터 가장 늦은 입금까지 사이를 모두 읽지 않는다(RA-N3-003).
   */
  async #context(sellerId: string, deposits: readonly DepositRow[], withEmpty: boolean): Promise<MatchContext> {
    const { db, writer } = this.#deps
    const days = [...new Set(deposits.map((row) => kstDateOf(row.at.getTime())))].sort()
    const windows = mergeRuns(days.map((day) => ({ from: addDays(day, -MATCH_DAYS_BACK), to: day })))
    const first = windows[0] as DateRun
    const last = windows.at(-1) as DateRun
    const dates = (await realScopeDates(db, sellerId, first.from, last.to)).filter((date) => windows.some((run) => run.from <= date && date <= run.to))
    const remembered = await this.#remembered(sellerId)
    const states = new Map<string, StateAt>()
    const bundles: BundleFacts[] = []
    for (const date of dates) {
      const runtime = await writer.read(sellerId, date, false)
      const at: StateAt = { date, state: runtime.state, seq: runtime.seq, lastAt: runtime.lastAt }
      states.set(date, at)
      for (const bundle of bundlesOf(at, remembered)) if (withEmpty || bundle.items > 0) bundles.push(bundle)
    }
    const sameDays: DepositRow[] = []
    for (const run of mergeRuns(days.map((day) => ({ from: day, to: day })))) {
      sameDays.push(...(await depositsBetween(db, sellerId, new Date(kstStartOf(run.from) as number), new Date(kstStartOf(addDays(run.to, 1)) as number), null)))
    }
    sameDays.sort((a, b) => a.no - b.no)
    return { states, bundles, byKey: new Map(bundles.map((bundle) => [bundle.key, bundle])), sameDays }
  }

  /** 기억한 입금자명: 채널 → 이름들 */
  async #remembered(sellerId: string): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>()
    for (const row of await listNames(this.#deps.db, sellerId)) {
      const list = out.get(row.channel)
      if (list === undefined) out.set(row.channel, [row.name])
      else list.push(row.name)
    }
    return out
  }

  /** 새 입금(번호 순)을 맞추고 확실한 1:1만 자동 확인한다. 자동 확인한 수를 돌려준다 */
  async #autoConfirm(sellerId: string, nos: readonly number[]): Promise<number> {
    let pending = await depositsByNos(this.#deps.db, sellerId, nos)
    let applied = 0
    while (pending.length > 0) {
      const context = await this.#context(sellerId, pending, false)
      const firstNo = (pending[0] as DepositRow).no
      const earlier = context.sameDays.filter((row) => row.no < firstNo).map(toMatch)
      const results = evaluateDeposits({ bundles: context.bundles, earlier, incoming: pending.map(toMatch) })
      let restart = -1
      for (const [index, result] of results.entries()) {
        if (result.auto === null) continue
        const bundle = context.byKey.get(result.auto) as BundleFacts
        if (await this.#applyAuto(sellerId, pending[index] as DepositRow, bundle)) applied++
        else {
          // 마지막 확인에서 묶음이 바뀌었다 — 이 입금은 확인 필요로 두고, 뒤 입금은 지금 상태로 다시 맞춘다
          restart = index + 1
          break
        }
      }
      if (restart < 0) break
      pending = pending.slice(restart)
    }
    return applied
  }

  /** 자동 확인 하나 (DP-6). 마지막 확인(그 범위의 기록 잠금 안)에서 남은 금액이 달라졌으면 적지 않는다 */
  async #applyAuto(sellerId: string, deposit: DepositRow, bundle: BundleFacts): Promise<boolean> {
    await this.#deps.options.hooks?.beforeAuto?.(sellerId, deposit.no)
    const turn = deposit.turn + 1
    let outcome: WriteOutcome
    try {
      outcome = await this.#writeAuto(sellerId, deposit, bundle, turn)
    } catch (error) {
      // 커밋 뒤 응답 전에 멈춘 경우 등 — 이 입금은 처리하지 않은 것으로 보고 뒤 입금은 지금 상태로 다시 맞춘다 (적혔다면 입금 상태도 같은 트랜잭션에서 바뀌었다)
      this.#deps.log({ level: 'warn', code: 'DEPOSIT_APPLY_FAILED', date: bundle.date, errorKind: errorKind(error) })
      return false
    }
    if (outcome.kind === 'ok') return true
    if (outcome.kind !== 'rejected') this.#deps.log({ level: 'warn', code: 'DEPOSIT_APPLY_FAILED', date: bundle.date, errorKind: outcome.kind })
    return false
  }

  /** 자동 확인의 엔진 기록 (마지막 확인·입금 상태·연결·처리 기록을 같은 트랜잭션에서) */
  #writeAuto(sellerId: string, deposit: DepositRow, bundle: BundleFacts, turn: number): Promise<WriteOutcome> {
    const requestId = `dep-${String(deposit.no)}-pay-${String(turn)}`
    let buyer = bundle.buyer
    return this.#deps.writer.write({
      sellerId,
      date: bundle.date,
      rehearsal: false,
      createScope: false,
      requestId,
      build: (ctx) => {
        const root = currentBuyerOf(ctx.state, bundle.buyer)
        if (root === null) return rejection(409, 'BUNDLE_CHANGED', DEPOSIT_MESSAGES.bundleChanged)
        const settlement = getSettlement(ctx.state, root, bundle.date)
        if (settlement.items.length === 0 || settlement.total - settlement.received !== deposit.amount) return rejection(409, 'BUNDLE_CHANGED', DEPOSIT_MESSAGES.bundleChanged)
        buyer = root
        return [
          {
            fields: { type: 'settlement.payment', buyer: root, date: bundle.date, amount: deposit.amount, memo: `자동 입금 확인 · 입금 #${String(deposit.no)}` },
            actor: { kind: 'deposit' },
            requestId,
          },
        ]
      },
      afterInsert: async (tx, scopeId, records, now) => {
        const record = records[0]
        if (record === undefined || record.failed || !record.changed) throw new WriteAbort({ kind: 'rejected', rejection: rejection(409, 'DEPOSIT_CHANGED', DEPOSIT_MESSAGES.changed) })
        const changed = await setDepositState(tx, sellerId, deposit.no, { status: 'REVIEW', turn: deposit.turn }, { status: 'AUTO_APPLIED', turn, appliedDate: bundle.date, appliedBuyer: buyer, appliedSeq: record.seq, handledAt: now })
        if (changed !== 1) throw new WriteAbort({ kind: 'rejected', rejection: rejection(409, 'DEPOSIT_CHANGED', DEPOSIT_MESSAGES.changed) })
        await insertLink(tx, sellerId, { depositId: deposit.id, scopeId, date: bundle.date, seq: record.seq, kind: 'payment', turn, buyer, auto: true }, now)
        await insertActions(tx, sellerId, [{ depositId: deposit.id, action: 'AUTO', accountId: null, date: bundle.date, buyer, scopeId, seq: record.seq }], now)
      },
    })
  }

  // ── 붙여넣기 (DP-2, AC-N3-13) ───────────────────────────────────────────

  /** 붙여넣기 미리 보기: 아무것도 기록하지 않는다 */
  async pastePreview(sellerId: string, text: string): Promise<DepositOutcome<PastePreview>> {
    const read = readPaste(text)
    if ('error' in read) return read.error === 'NO_HEADER' ? fail(400, 'PASTE_NO_HEADER', DEPOSIT_MESSAGES.noHeader) : fail(400, 'PASTE_TOO_MANY_ROWS', DEPOSIT_MESSAGES.tooManyRows)
    const keys = pasteRowKeys(read.rows)
    const source = await findPasteSource(this.#deps.db, sellerId)
    const existing = source === null ? new Set<string>() : await existingKeys(this.#deps.db, sellerId, source.id, keys)
    const nowMs = this.#now()
    const minDate = addDays(kstDateOf(nowMs), -RECEIVE_DAYS_BACK)
    const rows = read.rows.map((row, index) => {
      const at = parseOffsetIso(row.at) as number
      const state: RowState = kstDateOf(at) < minDate ? 'OLD' : at > nowMs + RECEIVE_FUTURE_MS ? 'FUTURE' : existing.has(keys[index] as string) ? 'EXISTING' : 'NEW'
      return { ...row, state }
    })
    return { ok: true, value: { rows, skipped: read.skipped, unreadable: read.unreadable } }
  }

  /** 붙여넣기 넣기: 같은 규칙으로 읽어 새 입금을 저장하고 맞추기·자동 확인까지 마친 뒤 요약. 같은 요청 번호면 처음 요약 */
  async pasteInsert(sellerId: string, accountId: string, requestId: string, text: string): Promise<DepositOutcome<PasteSummary>> {
    return this.#serial(sellerId, async () => {
      const prior = await findRequest(this.#deps.db, sellerId, requestId)
      if (prior !== null) return storedOutcome<PasteSummary>(prior)
      const read = readPaste(text)
      if ('error' in read) return read.error === 'NO_HEADER' ? fail(400, 'PASTE_NO_HEADER', DEPOSIT_MESSAGES.noHeader) : fail(400, 'PASTE_TOO_MANY_ROWS', DEPOSIT_MESSAGES.tooManyRows)
      const keys = pasteRowKeys(read.rows)
      const rows: FetchedRow[] = read.rows.map((row, index) => ({ key: keys[index] as string, at: parseOffsetIso(row.at) as number, precision: row.precision, amount: row.amount, name: row.name }))
      const source = await ensurePasteSource(this.#deps.db, sellerId, `dsrc_${randomUUID()}`, new Date(this.#now()))
      const summary = await this.#ingest(sellerId, source, rows, accountId)
      const value: PasteSummary = {
        read: read.rows.length,
        skipped: read.skipped.length,
        unreadable: read.unreadable,
        new: summary.stored.length,
        existing: summary.existing,
        failed: summary.failed,
        old: summary.old,
        future: summary.future,
        auto: summary.auto,
        review: summary.review,
      }
      await insertRequest(this.#deps.db, sellerId, requestId, { status: 200, body: value as unknown as Record<string, unknown> }, new Date(this.#now()))
      this.#notify(sellerId, summary.stored, [source.id])
      return { ok: true, value }
    })
  }

  // ── 목록·하나 (AC-N3-23·31) ─────────────────────────────────────────────

  /** 상태별 목록 (상태 하나 이상 — 예: 자동 확인됨·확인함을 함께, 입금 번호 내림차순, before 앞부터 limit개) */
  async list(sellerId: string, statuses: readonly DepositStatus[], before: number | null, limit: number): Promise<{ deposits: DepositView[]; more: boolean; review: number }> {
    const { rows, more } = await listDeposits(this.#deps.db, sellerId, statuses, before, limit)
    return { deposits: await this.#views(sellerId, rows), more, review: await reviewCount(this.#deps.db, sellerId) }
  }

  async count(sellerId: string): Promise<{ review: number }> {
    return { review: await reviewCount(this.#deps.db, sellerId) }
  }

  /** 입금 하나 + 처리 기록 (시간 순서). 다른 판매자의 번호면 null */
  async detail(sellerId: string, no: number): Promise<DepositDetail | null> {
    const row = await findDeposit(this.#deps.db, sellerId, no)
    if (row === null) return null
    const [view] = await this.#views(sellerId, [row])
    const actions = await actionsOfDeposit(this.#deps.db, sellerId, row.id)
    const labels = await this.#labelsFor(sellerId, actions.flatMap((action) => (action.date !== null && action.buyer !== null ? [{ date: action.date, buyer: action.buyer }] : [])))
    return {
      ...(view as DepositView),
      actions: actions.map((action) => ({
        action: action.action,
        actor: { kind: action.actor, loginId: action.actor === 'account' ? action.loginId : null },
        at: action.at.toISOString(),
        date: action.date,
        buyer: action.buyer,
        buyerName: action.date !== null && action.buyer !== null ? (labels.get(JSON.stringify([action.date, action.buyer])) ?? null) : null,
        seq: action.seq,
      })),
    }
  }

  /** (날짜, 구매자) → 그 날짜 범위의 이름 표기 */
  async #labelsFor(sellerId: string, pairs: readonly { date: string; buyer: string }[]): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    const byDate = new Map<string, string[]>()
    for (const pair of pairs) byDate.set(pair.date, [...(byDate.get(pair.date) ?? []), pair.buyer])
    for (const [date, buyers] of byDate) {
      if (!isValidDate(date)) continue
      const runtime = await this.#deps.writer.read(sellerId, date, false)
      // 기록의 구매자가 그 뒤 다른 구매자에 합쳐졌으면 지금의 구매자(묶음의 주인) 이름
      for (const buyer of buyers) out.set(JSON.stringify([date, buyer]), buyerLabel(runtime.state, currentBuyerOf(runtime.state, buyer) ?? buyer))
    }
    return out
  }

  async #views(sellerId: string, rows: readonly DepositRow[]): Promise<DepositView[]> {
    if (rows.length === 0) return []
    const sources = new Map((await listSources(this.#deps.db, sellerId)).map((source) => [source.id, source]))
    const labels = await this.#labelsFor(
      sellerId,
      rows.flatMap((row) => (row.appliedDate !== null && row.appliedBuyer !== null ? [{ date: row.appliedDate, buyer: row.appliedBuyer }] : [])),
    )
    const reviewRows = rows.filter((row) => row.status === 'REVIEW')
    const reviews = reviewRows.length === 0 ? new Map<number, NonNullable<DepositView['review']>>() : await this.#reviews(sellerId, reviewRows)
    return rows.map((row) => {
      const source = sources.get(row.sourceId)
      const view: DepositView = {
        no: row.no,
        source: { id: row.sourceId, kind: source?.kind ?? 'PASTE', label: source?.label ?? KIND_LABEL.PASTE },
        at: row.at.toISOString(),
        precision: row.precision,
        amount: row.amount,
        name: row.name,
        status: row.status,
        applied:
          row.appliedDate !== null && row.appliedBuyer !== null && row.appliedSeq !== null && (row.status === 'AUTO_APPLIED' || row.status === 'APPLIED')
            ? {
                date: row.appliedDate,
                buyer: row.appliedBuyer,
                buyerName: labels.get(JSON.stringify([row.appliedDate, row.appliedBuyer])) ?? '알 수 없는 구매자',
                seq: row.appliedSeq,
                auto: row.status === 'AUTO_APPLIED',
              }
            : null,
        receivedAt: row.receivedAt.toISOString(),
        handledAt: isoOrNull(row.handledAt),
      }
      const review = reviews.get(row.no)
      return review === undefined ? view : { ...view, review }
    })
  }

  /** 확인 필요 입금마다 볼 때의 상태로 다시 맞춘다 (DP-5 "볼 때 다시 계산" — 그 입금 자신은 빼고, 쌍둥이는 번호가 더 작은 입금). 아무것도 기록하지 않는다 */
  async #reviews(sellerId: string, rows: readonly DepositRow[]): Promise<Map<number, NonNullable<DepositView['review']>>> {
    const context = await this.#context(sellerId, rows, false)
    const out = new Map<number, NonNullable<DepositView['review']>>()
    // 묶음 이름 정규화는 한 번만 — 입금마다 따로 정한다(그 입금 자신은 빼고, 쌍둥이는 번호가 더 작은 입금)
    const results = evaluateEach({ bundles: context.bundles, earlier: context.sameDays.map(toMatch), targets: rows.map(toMatch) })
    for (const [index, row] of rows.entries()) {
      const result = results[index] as (typeof results)[number]
      const preselect = result.preselect === null ? null : context.byKey.get(result.preselect)
      out.set(row.no, {
        reason: result.auto !== null ? 'ONE_MATCH' : (result.reason as ReviewReason),
        twin: result.twin,
        suggestions: result.suggestions.map((key) => this.#bundleView(context.byKey.get(key) as BundleFacts, context.states.get((context.byKey.get(key) as BundleFacts).date) as StateAt, row)),
        preselect: preselect === undefined || preselect === null ? null : { date: preselect.date, buyer: preselect.buyer },
      })
    }
    return out
  }

  #bundleView(bundle: BundleFacts, at: StateAt, deposit: DepositRow): BundleView {
    const norm = normalizeDepositName(deposit.name)
    return {
      date: bundle.date,
      buyer: bundle.buyer,
      name: bundle.label,
      total: bundle.total,
      received: bundle.received,
      remaining: bundle.total - bundle.received,
      payment: bundle.payment,
      refundDue: bundle.refundDue,
      after: previewPayment(at, bundle.buyer, deposit.amount),
      beforeSale: bundle.saleAt !== null && deposit.at.getTime() < bundle.saleAt,
      canRemember: bundle.youtube && norm !== '' && !bundle.names.some((name) => normalizeDepositName(name) === norm),
    }
  }

  /**
   * 묶음 찾기 (다른 묶음 지정, AC-N3-33): 실제 범위에서 품목이나 받은 금액이 있는 묶음을 찾을 말(구매자 표시 이름·닉네임 이력·메모·
   * 전화번호 뒤 4자리·채널 ID 끝 4자리 — 일부 글자 포함)과 날짜(선택)로. 남은 금액이 있는 것 먼저 → 날짜가 늦은 것 → 구매자 ID 순, 50개까지
   */
  async searchBundles(sellerId: string, no: number, query: string, date: string | null): Promise<DepositOutcome<{ bundles: BundleView[] }>> {
    const deposit = await findDeposit(this.#deps.db, sellerId, no)
    if (deposit === null) return notFound()
    // 날짜를 고르지 않으면 입금 날짜 60일 전 ~ 30일 뒤의 실제 범위만, 늦은 날짜부터 (RA-N3-003 — 판매자의 전 기간을 읽지 않는다). 더 먼 날짜는 날짜를 골라 찾는다
    const depositDay = kstDateOf(deposit.at.getTime())
    const dates =
      date === null
        ? (await realScopeDates(this.#deps.db, sellerId, addDays(depositDay, -SEARCH_DAYS_BEFORE), addDays(depositDay, SEARCH_DAYS_AFTER))).reverse()
        : (await realScopeId(this.#deps.db, sellerId, date)) === null
          ? []
          : [date]
    const remembered = await this.#remembered(sellerId)
    const needle = query.trim().toLowerCase()
    const found: { bundle: BundleFacts; at: StateAt }[] = []
    let owing = 0
    for (const day of dates) {
      // 메모리를 밀어내지 않는 읽기 — 지난 날짜를 훑어도 방송 중인 범위 상태가 그대로 남는다
      const runtime = await this.#deps.writer.peek(sellerId, day, false)
      const at: StateAt = { date: day, state: runtime.state, seq: runtime.seq, lastAt: runtime.lastAt }
      for (const bundle of bundlesOf(at, remembered)) {
        if (needle !== '' && !this.#bundleMatches(at, bundle, needle)) continue
        found.push({ bundle, at })
        if (bundle.total - bundle.received > 0) owing++
      }
      // 남은 금액이 있는 묶음이 이미 50개면 더 이른 날짜의 묶음은 순서(남은 금액 있는 것 → 늦은 날짜)상 50개 안에 들 수 없다
      if (owing >= SEARCH_LIMIT) break
    }
    found.sort((a, b) => {
      const owesA = a.bundle.total - a.bundle.received > 0 ? 0 : 1
      const owesB = b.bundle.total - b.bundle.received > 0 ? 0 : 1
      if (owesA !== owesB) return owesA - owesB
      if (a.bundle.date !== b.bundle.date) return a.bundle.date < b.bundle.date ? 1 : -1
      return a.bundle.buyer < b.bundle.buyer ? -1 : a.bundle.buyer > b.bundle.buyer ? 1 : 0
    })
    return { ok: true, value: { bundles: found.slice(0, SEARCH_LIMIT).map(({ bundle, at }) => this.#bundleView(bundle, at, deposit)) } }
  }

  #bundleMatches(at: StateAt, bundle: BundleFacts, needle: string): boolean {
    const has = (text: string | null) => text !== null && text.toLowerCase().includes(needle)
    if (has(bundle.label)) return true
    for (const id of bundle.members) {
      const buyer = buyerInfoOf(at.state, id)
      if (buyer === null) continue
      if (has(buyer.display) || buyer.nameHistory.some((name) => has(name)) || has(buyer.phoneLast4)) return true
      if (buyer.kind === 'youtube' && has(buyer.id.slice(-4))) return true
    }
    return false
  }

  // ── 확정·무시·다시 확인 필요로·되돌리기 (DP-6, AC-N3-24~29) ───────────────────

  /** 같은 요청 번호면 처음 결과, 아니면 판매자 줄에서 처리한다 */
  #once<T>(sellerId: string, requestId: string, work: () => Promise<DepositOutcome<T>>, nos: readonly number[]): Promise<DepositOutcome<T>> {
    return this.#serial(sellerId, async () => {
      const prior = await findRequest(this.#deps.db, sellerId, requestId)
      if (prior !== null) return storedOutcome<T>(prior)
      const outcome = await work()
      if (outcome.ok) this.#notify(sellerId, nos)
      return outcome
    })
  }

  confirm(sellerId: string, accountId: string, requestId: string, no: number, input: ConfirmInput): Promise<DepositOutcome<ActionResult>> {
    return this.#once(sellerId, requestId, () => this.#confirmOne(sellerId, accountId, no, input, requestId), [no])
  }

  ignore(sellerId: string, accountId: string, requestId: string, no: number): Promise<DepositOutcome<ActionResult>> {
    return this.#once(sellerId, requestId, () => this.#ignoreOne(sellerId, accountId, no, 'IGNORE', requestId), [no])
  }

  reopen(sellerId: string, accountId: string, requestId: string, no: number): Promise<DepositOutcome<ActionResult>> {
    return this.#once(sellerId, requestId, () => this.#ignoreOne(sellerId, accountId, no, 'REOPEN', requestId), [no])
  }

  revert(sellerId: string, accountId: string, requestId: string, no: number): Promise<DepositOutcome<ActionResult>> {
    return this.#once(sellerId, requestId, () => this.#revertOne(sellerId, accountId, no, requestId), [no])
  }

  /** 한꺼번에 확정·무시 (1~100개): 항목마다 같은 검사·기록, 결과를 항목 순서대로. 한 항목의 거절이 다른 항목을 막지 않는다 */
  bulk(sellerId: string, accountId: string, requestId: string, items: readonly BulkEntry[]): Promise<DepositOutcome<BulkResult>> {
    return this.#serial(sellerId, async () => {
      const prior = await findRequest(this.#deps.db, sellerId, requestId)
      if (prior !== null) return storedOutcome<BulkResult>(prior)
      const seen = new Set<number>()
      const results: BulkResult['results'][number][] = []
      const touched: number[] = []
      for (const item of items) {
        if ('invalid' in item) {
          const invalidOutcome = item.invalid as Extract<DepositOutcome<never>, { ok: false }>
          results.push({ no: item.no, ok: false, status: invalidOutcome.status, error: { code: invalidOutcome.code, message: invalidOutcome.message } })
          continue
        }
        if (seen.has(item.no)) {
          results.push({ no: item.no, ok: false, status: 409, error: { code: 'DUPLICATE_ITEM', message: DEPOSIT_MESSAGES.duplicateItem } })
          continue
        }
        seen.add(item.no)
        const outcome = item.action === 'confirm' ? await this.#confirmOne(sellerId, accountId, item.no, item, null) : await this.#ignoreOne(sellerId, accountId, item.no, 'IGNORE', null)
        if (outcome.ok) {
          touched.push(item.no)
          results.push({ no: item.no, ok: true, deposit: outcome.value.deposit })
        } else results.push({ no: item.no, ok: false, status: outcome.status, error: { code: outcome.code, message: outcome.message } })
      }
      const value: BulkResult = { results }
      await insertRequest(this.#deps.db, sellerId, requestId, { status: 200, body: value as unknown as Record<string, unknown> }, new Date(this.#now()))
      if (touched.length > 0) this.#notify(sellerId, touched)
      return { ok: true, value }
    })
  }

  /** 확정 하나 (AC-N3-24·25): 그 묶음의 지금의 구매자에게 입금 금액 전부를 `입금 내역으로 확인 · 입금 #번호`로. 본 남은 금액과 다르면 BUNDLE_CHANGED */
  async #confirmOne(sellerId: string, accountId: string, no: number, input: ConfirmInput, requestId: string | null): Promise<DepositOutcome<ActionResult>> {
    const { db, writer } = this.#deps
    const deposit = await findDeposit(db, sellerId, no)
    if (deposit === null) return notFound()
    if (deposit.status === 'AUTO_APPLIED' || deposit.status === 'APPLIED') return fail(409, 'DEPOSIT_APPLIED', DEPOSIT_MESSAGES.applied)
    if (deposit.status === 'IGNORED') return fail(409, 'DEPOSIT_IGNORED', DEPOSIT_MESSAGES.ignored)
    if ((await realScopeId(db, sellerId, input.date)) === null) return notFound()
    const remembered = await this.#remembered(sellerId)
    const turn = deposit.turn + 1
    const engineRequestId = `dep-${String(no)}-pay-${String(turn)}`
    const norm = normalizeDepositName(deposit.name)
    const beforeSaleOf = (bundle: BundleFacts): boolean => bundle.saleAt !== null && deposit.at.getTime() < bundle.saleAt
    let chosen: BundleFacts | null = null
    let label = ''
    const outcome = await writer.write({
      sellerId,
      date: input.date,
      rehearsal: false,
      createScope: false,
      requestId: engineRequestId,
      build: (ctx) => {
        const bundle = bundleOf({ date: input.date, state: ctx.state, seq: 0, lastAt: 0 }, input.buyer, remembered)
        if (bundle === null) return rejection(404, 'NOT_FOUND', '찾을 수 없어요.')
        if (bundle.total - bundle.received !== input.remaining) return rejection(409, 'BUNDLE_CHANGED', DEPOSIT_MESSAGES.bundleChanged)
        chosen = bundle
        label = bundle.label
        return [
          {
            fields: { type: 'settlement.payment', buyer: bundle.buyer, date: input.date, amount: deposit.amount, memo: `입금 내역으로 확인 · 입금 #${String(no)}` },
            actor: { kind: 'account', accountId },
            requestId: engineRequestId,
          },
        ]
      },
      afterInsert: async (tx, scopeId, records, now) => {
        const record = records[0]
        const bundle = chosen as BundleFacts | null
        if (record === undefined || record.failed || !record.changed || bundle === null) throw new WriteAbort({ kind: 'rejected', rejection: rejection(409, 'DEPOSIT_CHANGED', DEPOSIT_MESSAGES.changed) })
        const changed = await setDepositState(tx, sellerId, no, { status: 'REVIEW', turn: deposit.turn }, { status: 'APPLIED', turn, appliedDate: input.date, appliedBuyer: bundle.buyer, appliedSeq: record.seq, handledAt: now })
        if (changed !== 1) throw new WriteAbort({ kind: 'rejected', rejection: rejection(409, 'DEPOSIT_CHANGED', DEPOSIT_MESSAGES.changed) })
        await insertLink(tx, sellerId, { depositId: deposit.id, scopeId, date: input.date, seq: record.seq, kind: 'payment', turn, buyer: bundle.buyer, auto: false }, now)
        await insertActions(tx, sellerId, [{ depositId: deposit.id, action: 'CONFIRM', accountId, date: input.date, buyer: bundle.buyer, scopeId, seq: record.seq }], now)
        // 입금자명 기억 (DP-6): 고름 · 빈 이름 아님 · 그 묶음 이름 후보에 아직 없음 · 지금의 구매자가 유튜브 구매자
        if (input.remember && bundle.youtube && norm !== '' && !bundle.names.some((name) => normalizeDepositName(name) === norm)) {
          await insertName(tx, sellerId, { channel: bundle.buyer, norm, name: deposit.name }, now)
        }
        if (requestId !== null) {
          const body: ActionResult = { deposit: { no, status: 'APPLIED', applied: { date: input.date, buyer: bundle.buyer, buyerName: label, seq: record.seq, beforeSale: beforeSaleOf(bundle) } } }
          await insertRequest(tx, sellerId, requestId, { status: 200, body: body as unknown as Record<string, unknown> }, now)
        }
      },
    })
    if (outcome.kind === 'ok') {
      const bundle = chosen as unknown as BundleFacts
      return { ok: true, value: { deposit: { no, status: 'APPLIED', applied: { date: input.date, buyer: bundle.buyer, buyerName: label, seq: outcome.result.seq, beforeSale: beforeSaleOf(bundle) } } } }
    }
    return this.#writeFailure(outcome)
  }

  /** 무시(확인 필요 → 무시함) · 다시 확인 필요로(무시함 → 확인 필요). 엔진에는 아무것도 적지 않는다 (AC-N3-26) */
  async #ignoreOne(sellerId: string, accountId: string, no: number, action: 'IGNORE' | 'REOPEN', requestId: string | null): Promise<DepositOutcome<ActionResult>> {
    const { db } = this.#deps
    const deposit = await findDeposit(db, sellerId, no)
    if (deposit === null) return notFound()
    const from: DepositStatus = action === 'IGNORE' ? 'REVIEW' : 'IGNORED'
    const to: DepositStatus = action === 'IGNORE' ? 'IGNORED' : 'REVIEW'
    if (deposit.status !== from) return action === 'IGNORE' ? fail(409, 'DEPOSIT_NOT_REVIEW', DEPOSIT_MESSAGES.notReview) : fail(409, 'DEPOSIT_NOT_IGNORED', DEPOSIT_MESSAGES.notIgnored)
    const body: ActionResult = { deposit: { no, status: to, applied: null } }
    const done = await db.transaction(async (tx) => {
      const now = new Date(this.#now())
      const changed = await setDepositState(tx, sellerId, no, { status: from, turn: deposit.turn }, { status: to, appliedDate: null, appliedBuyer: null, appliedSeq: null, handledAt: now })
      if (changed !== 1) return false
      await insertActions(tx, sellerId, [{ depositId: deposit.id, action, accountId }], now)
      if (requestId !== null) await insertRequest(tx, sellerId, requestId, { status: 200, body: body as unknown as Record<string, unknown> }, now)
      return true
    })
    if (!done) return fail(409, 'DEPOSIT_CHANGED', DEPOSIT_MESSAGES.changed)
    return { ok: true, value: body }
  }

  /** 되돌리기 (AC-N3-27): 반영한 입금 기록과 같은 (구매자, 날짜)에 같은 금액의 환불 `입금 확인 되돌림 · 입금 #번호`, 입금은 확인 필요로 */
  async #revertOne(sellerId: string, accountId: string, no: number, requestId: string): Promise<DepositOutcome<ActionResult>> {
    const { db, writer } = this.#deps
    const deposit = await findDeposit(db, sellerId, no)
    if (deposit === null) return notFound()
    if ((deposit.status !== 'AUTO_APPLIED' && deposit.status !== 'APPLIED') || deposit.appliedDate === null || deposit.appliedBuyer === null) {
      return fail(409, 'DEPOSIT_NOT_APPLIED', DEPOSIT_MESSAGES.notApplied)
    }
    const date = deposit.appliedDate
    const buyer = deposit.appliedBuyer
    const engineRequestId = `dep-${String(no)}-rev-${String(deposit.turn)}`
    const body: ActionResult = { deposit: { no, status: 'REVIEW', applied: null } }
    let refundSeq = 0
    const outcome = await writer.write({
      sellerId,
      date,
      rehearsal: false,
      createScope: false,
      requestId: engineRequestId,
      build: (ctx) => {
        // 엔진은 받은 금액보다 큰 환불을 아무 일도 없이 넘긴다(R-12) — 조용히 넘어가지 않게 그 범위의 기록 잠금 안에서 본다
        if (getSettlement(ctx.state, buyer, date).received < deposit.amount) return rejection(409, 'REFUND_RECORDED', DEPOSIT_MESSAGES.refundRecorded)
        return [
          {
            fields: { type: 'settlement.refund', buyer, date, amount: deposit.amount, reason: `입금 확인 되돌림 · 입금 #${String(no)}` },
            actor: { kind: 'account', accountId },
            requestId: engineRequestId,
          },
        ]
      },
      afterInsert: async (tx, scopeId, records, now) => {
        const record = records[0]
        if (record === undefined || record.failed || !record.changed) throw new WriteAbort({ kind: 'rejected', rejection: rejection(409, 'REFUND_RECORDED', DEPOSIT_MESSAGES.refundRecorded) })
        const changed = await setDepositState(tx, sellerId, no, { status: deposit.status, turn: deposit.turn }, { status: 'REVIEW', appliedDate: null, appliedBuyer: null, appliedSeq: null, handledAt: now })
        if (changed !== 1) throw new WriteAbort({ kind: 'rejected', rejection: rejection(409, 'DEPOSIT_CHANGED', DEPOSIT_MESSAGES.changed) })
        await insertLink(tx, sellerId, { depositId: deposit.id, scopeId, date, seq: record.seq, kind: 'refund', turn: deposit.turn, buyer, auto: false }, now)
        await insertActions(tx, sellerId, [{ depositId: deposit.id, action: 'REVERT', accountId, date, buyer, scopeId, seq: record.seq }], now)
        refundSeq = record.seq
        await insertRequest(tx, sellerId, requestId, { status: 200, body: { ...body, refund: { date, seq: record.seq } } as unknown as Record<string, unknown> }, now)
      },
    })
    if (outcome.kind === 'ok') return { ok: true, value: { ...body, refund: { date, seq: refundSeq } } }
    return this.#writeFailure(outcome)
  }

  #writeFailure(outcome: Exclude<WriteOutcome, { kind: 'ok' }>): DepositOutcome<never> {
    switch (outcome.kind) {
      case 'rejected':
        return fail(outcome.rejection.status, outcome.rejection.code, outcome.rejection.message, outcome.rejection.problems)
      case 'duplicate':
        // 같은 반영 차례의 엔진 기록이 이미 있다 — 그 기록과 입금 상태는 같은 트랜잭션에서 바뀌었다
        return fail(409, 'DEPOSIT_APPLIED', DEPOSIT_MESSAGES.applied)
      case 'not_found':
        return notFound()
      case 'save_failed':
        return fail(500, 'SAVE_FAILED', DEPOSIT_MESSAGES.writeFailed)
      // 'empty'는 채팅 묶음 기록(chatBatch, Y1)만 낸다 — 입금 확인은 늘 기록 하나를 적는다. 왔다면 저장하지 못한 것으로 본다 (합치기 N3 + main)
      case 'empty':
        return fail(500, 'SAVE_FAILED', DEPOSIT_MESSAGES.writeFailed)
    }
  }

  // ── 기억한 입금자명 (AC-N3-25) ──────────────────────────────────────────

  /** 기억한 입금자명 목록: 입금자명 → 구매자 표시 이름(그 채널의 가장 최근 표시 이름, 없으면 "유튜브 끝 1234") */
  async names(sellerId: string): Promise<{ names: { id: number; name: string; buyerName: string; createdAt: string }[] }> {
    const rows = await listNames(this.#deps.db, sellerId)
    const displays = new Map<string, string>()
    const wanted = new Set(rows.map((row) => row.channel))
    const lookIn = async (date: string): Promise<void> => {
      // 메모리를 밀어내지 않는 읽기 (RA-N3-003)
      const runtime = await this.#deps.writer.peek(sellerId, date, false)
      for (const channel of wanted) {
        const info = buyerInfoOf(runtime.state, channel)
        if (info !== null && !displays.has(channel)) displays.set(channel, info.display)
      }
    }
    if (wanted.size > 0) {
      // 최근 60일을 늦은 날짜부터 — 판매자의 전 기간을 거꾸로 읽지 않는다
      const dates = await realScopeDates(this.#deps.db, sellerId, addDays(kstDateOf(this.#now()), -NAMES_DAYS_BACK), null)
      for (const date of [...dates].reverse()) {
        await lookIn(date)
        if (displays.size === wanted.size) break
      }
      // 그 안에 없는 채널은 그 채널에 입금 확인으로 적은 가장 늦은 날짜에서 (채널마다 많아야 한 날짜)
      const missing = [...wanted].filter((channel) => !displays.has(channel))
      const linked = await latestLinkDates(this.#deps.db, sellerId, missing)
      for (const date of new Set(linked.values())) await lookIn(date)
    }
    return {
      names: rows.map((row) => ({ id: row.id, name: row.name, buyerName: displays.get(row.channel) ?? `유튜브 끝 ${row.channel.slice(-4)}`, createdAt: row.createdAt.toISOString() })),
    }
  }

  /** 기억한 입금자명 지우기 (이미 적은 입금 기록은 그대로) */
  forgetName(sellerId: string, id: number): Promise<DepositOutcome<{ ok: true }>> {
    return this.#serial(sellerId, async () => ((await deleteName(this.#deps.db, sellerId, id)) ? { ok: true, value: { ok: true } } : notFound()))
  }

  // ── 정산 조회의 입금 연결 (AC-N3-32) ───────────────────────────────────

  /** 그 날짜 실제 범위의 입금 연결 (서버의 (범위, seq) 기록 — 메모 글을 읽지 않는다). 리허설 범위에는 없다 */
  async linksForDay(sellerId: string, date: string): Promise<DepositLinkView[]> {
    const rows = await linksOfScope(this.#deps.db, sellerId, date)
    const reverted = new Set(rows.filter((row) => row.kind === 'refund').map((row) => `${String(row.depositId)}:${String(row.turn)}`))
    return rows.map((row) => ({
      seq: row.seq,
      kind: row.kind,
      auto: row.auto,
      reverted: row.kind === 'payment' && reverted.has(`${String(row.depositId)}:${String(row.turn)}`),
      deposit: { no: row.no, name: row.name, at: row.at.toISOString(), precision: row.precision, amount: row.amount, source: row.sourceLabel, sourceKind: row.sourceKind },
    }))
  }

  // ── 시험·점검용 ──────────────────────────────────────────────────────────

  /** 받은 줄을 원천에 넣는다 (서버 시험이 받아 오기 없이 저장·맞추기 흐름을 부를 때 — 판매자 줄에서 처리) */
  ingest(sellerId: string, sourceId: string, rows: readonly FetchedRow[]): Promise<IngestSummary | null> {
    return this.#serial(sellerId, async () => {
      const source = await findSource(this.#deps.db, sellerId, sourceId)
      if (source === null) return null
      const summary = await this.#ingest(sellerId, source, rows, null)
      this.#notify(sellerId, summary.stored, [sourceId])
      return summary
    })
  }

  /** 그 원천을 지금 받아 온다 (주기와 같은 일 — 간격 제한 없음, 시험·점검용) */
  runSource(sellerId: string, sourceId: string): Promise<void> {
    return this.#run(sellerId, sourceId, false)
  }
}

interface DateRun {
  readonly from: string
  readonly to: string
}

/** 날짜 구간들 → 겹치거나 맞닿은 구간을 합친 구간 (시작 날짜 순) */
function mergeRuns(runs: readonly DateRun[]): DateRun[] {
  const sorted = [...runs].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
  const out: DateRun[] = []
  for (const run of sorted) {
    const previous = out.at(-1)
    if (previous !== undefined && run.from <= addDays(previous.to, 1)) {
      if (run.to > previous.to) out[out.length - 1] = { from: previous.from, to: run.to }
    } else out.push(run)
  }
  return out
}

function rejection(status: number, code: ErrorCode, message: string): Rejection {
  return { status, code, message, problems: [] }
}

function storedOutcome<T>(stored: StoredResult): DepositOutcome<T> {
  return { ok: true, value: stored.body as unknown as T }
}
