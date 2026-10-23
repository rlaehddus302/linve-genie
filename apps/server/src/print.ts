// 서버 출력 기록과 출력 기기 (I1, LABEL_RULES L-8·L-9·L-10·L-11, D-I1-01~D-I1-10).
// - 대기열은 판매자 단위로 서버가 원본이다. 출력은 판매자가 정한 출력 기기 하나가 한 번에 한 장씩 받아 간다(L-11 4·10).
// - 자동 작업은 실제 범위의 PRINT_PRODUCT_LABEL 효과가 기록되는 같은 트랜잭션에서 만든다(txHook, L-11 2).
// - 폐기는 상태로 정한다: 커밋마다(그리고 출력 기기가 받을 때) 라벨 키의 찜이 그 확정버전의 1등이 아니면 폐기, VOID_LABEL도 같은 키를 폐기(L-11 5).
// - 출력함이 되면 그 라벨 키의 자동 출력 효과가 엔진에서 아직 실행 완료가 아닐 때 effect.labelPrinted를 같은 트랜잭션에서 기록한다(L-11 7).
// - 판정은 하지 않는다. 엔진 상태는 코어 조회 함수로만 읽는다(label-data.ts).
// - 로그에 라벨 데이터·닉네임·품종·기기 이름·가게 이름·템플릿·요청 본문을 남기지 않는다(L-11 16).
// - 라벨 기능 켬/끔(N4a, L-13): 판매자 대기열 줄의 칸. 그 줄을 잠근 트랜잭션 안에서 읽고 바꾼다 — 꺼져 있으면 효과로 작업을 만들지 않고(createAutoJobs),
//   출력을 새로 시작하거나 라벨을 새로 만드는 요청을 LABELS_OFF로 거절한다. 줄이거나 끝내는 요청·조회·폐기는 그대로다.
import { randomBytes } from 'node:crypto'
import { containsPhoneRun, currentBuyerOf, getProduct, listBroadcasts, listEffects, listProducts, type EngineState } from '@livejjim/core'
import {
  computePackingText,
  defaultTemplate,
  splitGraphemes,
  templateToJson,
  trimLabelText,
  validateTemplate,
  type LabelBuyer,
  type LabelTemplate,
  type PackingLabelData,
  type ProductLabelData,
} from '@livejjim/label'
import type { Db } from './db/database.ts'
import type { FieldProblem } from './errors.ts'
import { contentKeyOf, currentLabelBuyer, isWinnerOf, packingLabelData, productLabelBuyer, productLabelData, type ClaimIndex } from './label-data.ts'
import { AMOUNT_MISSING_MESSAGE, claimAmount } from './amount.ts'
import { errorKind, type LogSink } from './log.ts'
import {
  activeJobs,
  bindLabelEffect,
  cancelWaiting,
  createAutoJobs,
  discardJobs,
  findAttempt,
  findJob,
  findLabel,
  findPrintRequest,
  finishAttempt,
  headWaitingJob,
  insertAttempt,
  insertJobs,
  insertLabelSwitch,
  insertLabels,
  insertPrintRequest,
  jobsOfLabels,
  jobsWithLabels,
  labelSwitchHistory,
  labelsByIds,
  labelsOff,
  liveProductLabels,
  lockQueue,
  openAttempt,
  printingJob,
  queueCounts,
  readQueue,
  readTemplate,
  scopeLabels,
  updateJob,
  updateQueue,
  voidLabels,
  waitingJobIds,
  writeTemplate,
  type JobRow,
  type JobWithLabel,
  type LabelEffectBody,
  type LabelRow,
  type LabelSwitchRow,
  type PauseReason,
  type QueuePatch,
  type QueueRow,
} from './print-store.ts'
import type { ScopeRuntime } from './runtime.ts'
import { findBroadcast, scopeSealInfo } from './store.ts'
import type { Clock } from './time.ts'
import { claimIndex } from './views.ts'
import { winnerClaimsOf } from './winners.ts'
import { SEALED_MESSAGE, WriteAbort, type Rejection, type ScopeWriter, type TxHookContext } from './writer.ts'

export { winnerClaimsOf }

// ── 문장 (LABEL_RULES L-8·L-11, acceptance AC-I1-09·11·13·14 — 화면에 그대로 쓴다) ──

/** 멈춘 까닭의 문장 (L-8 3) */
export const PAUSE_MESSAGES: Readonly<Record<PauseReason, string>> = {
  DISCONNECTED: '프린터 연결이 끊겼어요.',
  PRINTER_ERROR: '프린터 오류로 멈췄어요.',
  SELLER: '출력을 멈췄어요.',
  LABEL_ERROR: '라벨을 만들지 못해 멈췄어요. 라벨 설정을 확인한 뒤 다시 시작해 주세요.',
}

export const PRINT_MESSAGES = {
  rehearsal: '리허설 방송은 라벨을 출력하지 않아요.',
  notDevice: '이 기기는 출력 기기가 아니에요.',
  deviceTaken: '다른 기기에서 출력하고 있어요. 이 기기로 바꾸려면 바꾸기를 눌러 주세요.',
  reconnect: '출력 기기에서 다시 연결해 주세요.',
  notWinner: '지금 1등이 아니라 라벨을 출력할 수 없어요.',
  labelExists: '이미 만든 라벨이에요. 다시 출력을 눌러 주세요.',
  voided: '폐기한 라벨은 다시 출력할 수 없어요.',
  inProgress: '이 라벨은 이미 출력을 기다리고 있어요.',
  notPrinted: '아직 출력한 적이 없는 라벨이에요.',
  winnerChanged: '1등이 바뀐 라벨은 다시 출력할 수 없어요.',
  jobPrinting: '출력 중인 라벨은 뺄 수 없어요.',
  notDiscardable: '버릴 라벨이 아니에요.',
  noItems: '이 묶음에는 1등 상품이 없어 포장 라벨을 만들 수 없어요.',
  confirmRequired: '대기 중인 라벨을 모두 빼려면 확인이 필요해요.',
  templateConflict: '다른 기기에서 라벨 설정이 바뀌었어요. 새로 불러온 뒤 다시 바꿔 주세요.',
  templateTooLarge: '라벨 설정이 너무 커요.',
  templateInvalid: '라벨 설정에 고칠 곳이 있어요.',
  shopNameTooLong: '가게 이름은 40자 이하로 적어 주세요.',
  templateSaved: '라벨 설정을 저장했어요.',
  /** 라벨 기능이 꺼져 있을 때 거절 (L-13 5, D-N4a-03) */
  labelsOff: '라벨 기능이 꺼져 있어요. 설정에서 켠 뒤 다시 해 주세요.',
  /** 켬/끔 값이 불리언이 아님 */
  labelsInvalid: '라벨 기능은 켜기나 끄기로만 정할 수 있어요.',
} as const

/** 작업 상태 낱말 (D-I1-08) */
export function jobWord(job: Pick<JobRow, 'status' | 'voided' | 'discardedAt'>): string {
  switch (job.status) {
    case 'WAITING':
      return '작업 대기'
    case 'PRINTING':
      return '출력 중'
    case 'DONE':
      return job.voided ? (job.discardedAt === null ? '폐기 — 버려 주세요' : '폐기') : '출력함'
    default:
      return job.voided ? '폐기' : '출력 안 함'
  }
}

/** 라벨 키 상태 (AC-I1-30) */
export type LabelState = 'NONE' | 'WAITING' | 'PRINTING' | 'PRINTED' | 'REPRINT_NEEDED' | 'NOT_PRINTED' | 'VOIDED'

const LABEL_WORDS: Readonly<Record<Exclude<LabelState, 'VOIDED'>, string>> = {
  NONE: '',
  WAITING: '라벨 대기',
  PRINTING: '출력 중',
  PRINTED: '라벨 출력됨',
  REPRINT_NEEDED: '재출력 필요',
  NOT_PRINTED: '출력 안 함',
}

// ── 오류 코드 (L-7 표·라벨 패키지 오류) ───────────────────────────────────

/** 프린터 어댑터 오류 코드 (L-7 표) */
export const PRINTER_ERROR_CODES = [
  'UNSUPPORTED',
  'NOT_SELECTED',
  'BLUETOOTH_OFF',
  'PORT_BUSY',
  'WRONG_MODEL',
  'DISCONNECTED',
  'NOT_CONNECTED',
  'BUSY',
  'IMAGE_TOO_WIDE',
  'TIMEOUT',
  'PRINT_FAILED',
  'INVALID_DENSITY',
] as const
/** 라벨을 그리지 못한 오류 코드 (라벨 패키지) — 라벨 오류 멈춤 */
export const LABEL_ERROR_CODES = ['INVALID_DATA', 'INVALID_TEMPLATE', 'DOES_NOT_FIT', 'MIXED_SIZES', 'NO_LABELS', 'INVALID_IMAGE'] as const
const PRINTER_CODES: ReadonlySet<string> = new Set(PRINTER_ERROR_CODES)
const LABEL_CODES: ReadonlySet<string> = new Set(LABEL_ERROR_CODES)

/** 실패 결과의 멈춤 까닭 (L-11 6) */
export function pauseForError(code: string): PauseReason {
  if (code === 'DISCONNECTED') return 'DISCONNECTED'
  if (LABEL_CODES.has(code)) return 'LABEL_ERROR'
  return 'PRINTER_ERROR'
}

/** 오류 코드가 받을 수 있는 것인지 */
export function isKnownErrorCode(code: unknown): code is string {
  return typeof code === 'string' && (PRINTER_CODES.has(code) || LABEL_CODES.has(code))
}

// ── 보기 ─────────────────────────────────────────────────────────────────

export interface QueueSummary {
  /** 출력 기록이 바뀔 때마다 는다 */
  readonly rev: number
  readonly device: {
    readonly id: string
    readonly name: string
    /** 그 기기의 실시간 연결이 열려 있는지 */
    readonly live: boolean
    /** 그 기기가 알린 프린터 연결 여부 */
    readonly printerConnected: boolean
    /** 출력 그만하기를 눌러 출력 중인 장이 끝나기를 기다리는 중 */
    readonly releasing: boolean
  } | null
  readonly pause: { readonly reason: PauseReason; readonly message: string; readonly backlog: boolean } | null
  readonly waiting: number
  readonly printing: number
  readonly discard: number
  /** 라벨 기능 켬(true)/끔(false) — 기록이 없으면 켬 (N4a, L-13 1) */
  readonly labelsEnabled: boolean
}

/** 라벨 기능 켬/끔을 바꾼 기록 한 줄 (N4a, L-13 2) */
export interface LabelSwitchEntry {
  readonly enabled: boolean
  /** 바꾼 시각 (UTC ISO) */
  readonly at: string
  /** 바꾼 계정의 로그인 아이디 */
  readonly loginId: string
}

/** 라벨 기능 설정 보기 (GET·PUT /api/settings/labels) */
export interface LabelSettings {
  readonly enabled: boolean
  /** 바꾼 기록 최근 LABEL_HISTORY_LIMIT줄, 새것 먼저 */
  readonly history: LabelSwitchEntry[]
  /** 지금 대기 작업 장 수 (끄기 확인 창) */
  readonly waiting: number
  /** 읽은 때의 출력 기록 판 */
  readonly rev: number
}

/** 바꾼 기록을 보이는 줄 수 (AC-N4a-02·12) */
export const LABEL_HISTORY_LIMIT = 20

export interface LabelRef {
  /** 라벨 키 (상품 `<찜>@<확정버전>`, 포장 `packing:<구매자>`) */
  readonly key: string
  readonly claim: string | null
  readonly version: number | null
  readonly broadcast: string | null
  readonly no: number | null
  /** 포장: 요청 때의 지금의 구매자 ID */
  readonly buyerId: string | null
  /** 라벨의 구매자 (L-3 buyer — 문자찜은 이름 없음) */
  readonly buyer: LabelBuyer
}

export interface JobView {
  /** 작업 ID (자동 출력 = 효과 ID) */
  readonly id: string
  /** 범위 날짜 */
  readonly date: string
  readonly kind: 'product' | 'packing'
  readonly reason: 'auto' | 'manual' | 'reprint' | 'packing'
  readonly status: 'WAITING' | 'PRINTING' | 'DONE' | 'CANCELLED'
  /** 화면 낱말 (작업 대기 · 출력 중 · 출력함 · 출력 안 함 · 폐기 · 폐기 — 버려 주세요) */
  readonly word: string
  readonly voided: boolean
  /** 버릴 라벨 (출력함이 폐기됐고 아직 버렸어요를 누르지 않음) */
  readonly discard: boolean
  readonly discardedAt: string | null
  /** 실패한 시도 수 */
  readonly attempts: number
  readonly lastError: { readonly code: string; readonly item: string | null } | null
  readonly label: LabelRef
  readonly page: number | null
  readonly pages: number | null
  /** 출력함 = 찍은 데이터, 포장 = 요청 때 정한 데이터, 그 밖 상품 = 지금 데이터(1등이 아니면 null) */
  readonly data: ProductLabelData | PackingLabelData | null
  /** 출력한 기기 이름·시각 (출력함만) */
  readonly device: string | null
  readonly printedAt: string | null
  readonly createdAt: string
}

export interface LabelView extends LabelRef {
  readonly date: string
  readonly kind: 'product' | 'packing'
  readonly state: LabelState
  /** 화면 낱말 (라벨 대기 · 출력 중 · 라벨 출력됨 · 재출력 필요 · 출력 안 함 · 폐기 · 폐기 — 버려 주세요, 작업이 없으면 빈 글) */
  readonly word: string
  readonly voided: boolean
  /** 버릴 라벨 장 수 */
  readonly discard: number
  readonly reprintNeeded: boolean
  /** 출력 횟수 */
  readonly printed: number
  /** 출력함마다 시각(UTC ISO)·기기 이름, 출력 순서 */
  readonly history: readonly { readonly at: string; readonly device: string }[]
  /** 상품: 지금 그 확정버전의 1등인지 */
  readonly winner: boolean
  /** 지금 데이터 (미리 보기·그림 파일용 — 1등이 아니거나 폐기됐으면 null) */
  readonly data: ProductLabelData | PackingLabelData | null
  /** 버튼 도우미: 라벨 출력(작업이 없는 1등) · 다시 출력(L-8 5·L-11 9 조건) */
  readonly canPrint: boolean
  readonly canReprint: boolean
}

export interface ClaimedJob {
  readonly id: string
  readonly date: string
  readonly kind: 'product' | 'packing'
  readonly reason: string
  /** 이 시도의 표 — 결과는 이 값으로만 받는다 */
  readonly attempt: string
  readonly data: ProductLabelData | PackingLabelData
  /** 그릴 템플릿 (그때의 템플릿. 포장은 요청 때의 한 장 번호 수) */
  readonly template: LabelTemplate
  readonly page: number | null
  readonly pages: number | null
  readonly label: LabelRef
}

export type ClaimOutcome =
  | { readonly kind: 'not_device' }
  | { readonly kind: 'labels_off' }
  | { readonly kind: 'none'; readonly reason: 'PAUSED' | 'BUSY' | 'EMPTY' }
  | { readonly kind: 'job'; readonly job: ClaimedJob }

export type ResultInput = { readonly ok: true } | { readonly ok: false; readonly code: string; readonly item: string | null }

export type ActionOutcome<T> = { readonly kind: 'ok'; readonly value: T } | { readonly kind: 'rejected'; readonly rejection: Rejection; readonly extra?: Readonly<Record<string, unknown>> } | { readonly kind: 'not_found' }

interface Touched {
  readonly jobs: number[]
  readonly labels: number[]
}

interface StateContext {
  readonly state: EngineState
  readonly claims: ClaimIndex
}

const rejection = (status: number, code: Rejection['code'], message: string, problems: readonly FieldProblem[] = []): Rejection => ({ status, code, message, problems })
const rejected = (status: number, code: Rejection['code'], message: string, extra?: Readonly<Record<string, unknown>>): ActionOutcome<never> => ({
  kind: 'rejected',
  rejection: rejection(status, code, message),
  ...(extra === undefined ? {} : { extra }),
})
/** 라벨 기능이 꺼져 있어 거절 (L-13 5) — 아무것도 기록하지 않는다 */
const labelsOffRejected = (): ActionOutcome<never> => rejected(409, 'LABELS_OFF', PRINT_MESSAGES.labelsOff)

const entryOf = (row: LabelSwitchRow): LabelSwitchEntry => ({ enabled: row.enabled, at: row.changedAt.toISOString(), loginId: row.loginId })

/** 템플릿 JSON 상한 (L-11 13) */
export const TEMPLATE_MAX_BYTES = 16 * 1024
/** 가게 이름 상한 (다듬은 뒤, 보이는 글자 수) */
export const SHOP_NAME_MAX = 40
/** 기기 이름 (다듬은 뒤 1~20자) */
export const DEVICE_NAME_MAX = 20
export const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/
/** 받을 때 폐기한 작업을 건너뛰며 다음 작업을 찾는 횟수 상한 */
const CLAIM_ROUNDS = 200
/**
 * 같은 기기가 출력 중인 장을 다시 받을 수 있게 되는 때 (그 시도를 준 뒤, 서버 시계). 그 전에 겹쳐 온 같은 기기의 받기는 BUSY —
 * 동시에 거듭 온 요청이 같은 장을 여러 번 받아 겹쳐 찍지 않게 한다(AC-I1-06). 출력 기기 화면은 받기 응답을 잃으면 3초 뒤 다시 받는다
 */
export const RECLAIM_AFTER_MS = 2000

/** 지우는 글자: 제어 문자(C0·C1)와 보이지 않는 서식 글자 (폭 없는 공백·방향 표시·줄 나눔 기호·BOM) */
function isInvisible(code: number): boolean {
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2064) ||
    code === 0xfeff
  )
}

/** 기기 이름 다듬기: 제어 문자·보이지 않는 글자를 지우고 앞뒤 공백을 지운다. 1~20자가 아니면 null */
export function cleanDeviceName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let kept = ''
  for (const char of value) if (!isInvisible(char.codePointAt(0) ?? 0)) kept += char
  const cleaned = kept.trim()
  const length = [...cleaned].length
  return length >= 1 && length <= DEVICE_NAME_MAX ? cleaned : null
}

const parseBuyer = (text: string): LabelBuyer => JSON.parse(text) as LabelBuyer

function labelRef(label: LabelRow): LabelRef {
  return {
    key: label.key,
    claim: label.claim,
    version: label.version,
    broadcast: label.broadcast,
    no: label.no,
    buyerId: label.buyerId,
    buyer: parseBuyer(label.buyer),
  }
}

function lastErrorOf(text: string | null): JobView['lastError'] {
  if (text === null) return null
  const split = text.indexOf(':')
  return split < 0 ? { code: text, item: null } : { code: text.slice(0, split), item: text.slice(split + 1) }
}

export interface PrintOptions {
  readonly db: Db
  readonly writer: ScopeWriter
  readonly clock: Clock
  readonly log: LogSink
  /** 실시간 알림 (event: print) */
  readonly publish: (sellerId: string, data: Readonly<Record<string, unknown>>) => void
  /** 라벨 기능 켬/끔 알림 (event: labels, N4a) */
  readonly publishLabels?: (sellerId: string, data: Readonly<Record<string, unknown>>) => void
  /** 그 기기의 실시간 연결이 열려 있는지 */
  readonly deviceLive: (sellerId: string, deviceId: string) => boolean
  /**
   * 상품 라벨 작업이 출력함이 될 때 같은 트랜잭션에서 부른다 (N5 라벨 장 쓰기, BL-5 3). 폐기된 작업·포장 라벨은 부르지 않는다.
   * 던지면 결과 기록 전체가 되돌아간다
   */
  readonly onPrinted?: (tx: Db, info: { sellerId: string; date: string; jobId: string; broadcast: string | null; no: number | null; now: Date }) => Promise<void>
}

export class PrintService {
  readonly #options: PrintOptions
  /** 판매자마다 알림을 차례로 만든다 (나중 알림이 앞 알림보다 먼저 나가지 않게) */
  readonly #chains = new Map<string, Promise<void>>()
  #closed = false

  constructor(options: PrintOptions) {
    this.#options = options
  }

  get #db(): Db {
    return this.#options.db
  }

  #now(): Date {
    return new Date(this.#options.clock.now())
  }

  /** 확정 찜에 찜 금액이 없어 라벨 데이터를 만들지 않았다 (D-O3-15) — 찜 ID만 남긴다 */
  readonly #amountMissing = (claimId: string): void => {
    this.#options.log({ level: 'error', code: 'AMOUNT_MISSING', claim: claimId })
  }

  /** 알림 만들기를 멈춘다 (서버 끄기) */
  close(): void {
    this.#closed = true
  }

  /** 지금 쌓인 알림을 모두 보낼 때까지 기다린다 (시험용) */
  async settled(): Promise<void> {
    for (;;) {
      const pending = [...this.#chains.values()]
      if (pending.length === 0) return
      await Promise.all(pending)
    }
  }

  // ── 기록 경로 안 (효과 → 작업, 폐기 — L-11 2·5) ────────────────────────

  /**
   * 이벤트 기록과 같은 트랜잭션에서 부른다 (ScopeWriter txHook). 리허설 범위는 아무것도 하지 않는다(효과 조회도 실제 범위로 고정).
   * 1. 이 기록의 PRINT_PRODUCT_LABEL 효과 → 자동 작업 (createAutoJobs)
   * 2. VOID_LABEL 효과 → 그 라벨 키 폐기
   * 3. 찜·상품 상태가 바뀌었으면 아직 폐기되지 않은 상품 라벨 키 중 그 찜이 그 확정버전의 1등이 아닌 것을 폐기
   */
  readonly txHook = async (tx: Db, ctx: TxHookContext): Promise<(() => void) | null> => {
    if (ctx.rehearsal) return null
    const { sellerId, scopeId, records, states, now } = ctx
    const final = states.at(-1) as EngineState
    const first = records[0]
    const last = records.at(-1)
    if (first === undefined || last === undefined) return null
    const touched: Touched = { jobs: [], labels: [] }
    if (records.some((record) => record.effects.some((effect) => effect.kind === 'PRINT_PRODUCT_LABEL'))) {
      const claims = claimIndex(ctx.runtime, final)
      const stateAt = (seq: number): EngineState => states[records.findIndex((record) => record.seq === seq)] ?? final
      const created = await createAutoJobs(
        tx,
        sellerId,
        scopeId,
        first.seq,
        last.seq,
        (effect: LabelEffectBody, seq: number) => JSON.stringify(productLabelBuyer(stateAt(seq), { origin: claims.get(effect.claim)?.origin ?? '', buyer: effect.buyer })),
        now,
        // 찜 금액이 없는 확정 찜은 작업(·라벨 키)을 만들지 않는다 (D-O3-15)
        (effect: LabelEffectBody) => {
          const info = claims.get(effect.claim)
          if (info === undefined || info.status !== 'CONFIRMED' || claimAmount(info) !== null) return false
          this.#amountMissing(info.id)
          return true
        },
      )
      touched.jobs.push(...created.jobs)
      touched.labels.push(...created.labels)
    }
    const toVoid = new Set<number>()
    const voidKeys = records.flatMap((record) => record.effects.filter((effect) => effect.kind === 'VOID_LABEL').map((effect) => `${effect.claim}@${String(effect.confirmVersion)}`))
    for (const key of voidKeys) {
      const label = await findLabel(tx, sellerId, scopeId, key)
      if (label !== null && label.voidedAt === null) toVoid.add(label.id)
    }
    if (ctx.before.claims !== final.claims || ctx.before.slots !== final.slots) {
      const live = await liveProductLabels(tx, sellerId, scopeId)
      if (live.length > 0) {
        if (records.length === 1) {
          // 한 이벤트: 그 번호의 지금 1등 찜 목록으로 본다 (찜이 1등에서 빠지는 커밋마다 여기서 폐기되므로 확정버전도 같다)
          const winners = new Map<string, readonly string[]>()
          for (const label of live) {
            const slot = `${label.broadcast ?? ''}/${String(label.no)}`
            let list = winners.get(slot)
            if (list === undefined) {
              const product = getProduct(final, label.broadcast ?? '', label.no ?? 0)
              list = product === null ? [] : winnerClaimsOf(product)
              winners.set(slot, list)
            }
            if (!list.includes(label.claim ?? '')) toVoid.add(label.id)
          }
        } else {
          // 여러 이벤트를 한 번에 쓴 기록(채우기 등): 찜의 확정버전까지 본다
          const claims = claimIndex(ctx.runtime, final)
          for (const label of live) if (isWinnerOf(claims, label.claim ?? '', label.version ?? -1) === null) toVoid.add(label.id)
        }
      }
    }
    if (toVoid.size > 0) {
      await lockQueue(tx, sellerId, now)
      const voided = await voidLabels(tx, sellerId, [...toVoid], now)
      touched.jobs.push(...voided.jobs)
      touched.labels.push(...voided.labels)
      if (voided.jobs.length > 0 || voided.labels.length > 0) await updateQueue(tx, sellerId, {}, now)
    }
    if (touched.jobs.length === 0 && touched.labels.length === 0) return null
    return () => this.#notify(sellerId, touched)
  }

  // ── 알림 (AC-I1-15) ────────────────────────────────────────────────────

  #notify(sellerId: string, touched: Touched): void {
    if (this.#closed) return
    const previous = this.#chains.get(sellerId) ?? Promise.resolve()
    const next = previous
      .then(() => (this.#closed ? undefined : this.#publishNow(sellerId, touched)))
      .catch((error: unknown) => this.#options.log({ level: 'warn', code: 'PRINT_NOTIFY_FAILED', errorKind: errorKind(error) }))
    this.#chains.set(sellerId, next)
    void next.then(() => {
      if (this.#chains.get(sellerId) === next) this.#chains.delete(sellerId)
    })
  }

  /** 대기열 요약만 알린다 (출력 기기 실시간 연결이 바뀜) */
  notifyQueue(sellerId: string): void {
    this.#notify(sellerId, { jobs: [], labels: [] })
  }

  async #publishNow(sellerId: string, touched: Touched): Promise<void> {
    const queue = await this.summary(sellerId)
    const rows = await jobsWithLabels(this.#db, sellerId, [...new Set(touched.jobs)])
    const labelIds = new Set([...touched.labels, ...rows.map((row) => row.label.id)])
    const labels = await labelsByIds(this.#db, sellerId, [...labelIds])
    const contexts = await this.#contexts(sellerId, [...rows.map((row) => row.job.date), ...labels.map((label) => label.date)])
    const jobs = rows.map((row) => this.#jobView(row, contexts.get(row.job.date) ?? null))
    const labelViews = await this.#labelViews(sellerId, labels, contexts)
    if (this.#closed) return
    this.#options.publish(sellerId, { rev: queue.rev, queue, jobs, labels: labelViews })
  }

  // ── 조회 ─────────────────────────────────────────────────────────────────

  async summary(sellerId: string): Promise<QueueSummary> {
    const queue = await readQueue(this.#db, sellerId)
    const counts = await queueCounts(this.#db, sellerId)
    return this.#summaryOf(sellerId, queue, counts)
  }

  #summaryOf(sellerId: string, queue: QueueRow | null, counts: { waiting: number; printing: number; discard: number }): QueueSummary {
    const deviceId = queue?.deviceId ?? null
    const paused = (queue?.paused ?? null) as PauseReason | null
    return {
      rev: queue?.rev ?? 0,
      device:
        queue === null || deviceId === null
          ? null
          : {
              id: deviceId,
              name: queue.deviceName ?? '',
              live: this.#options.deviceLive(sellerId, deviceId),
              printerConnected: queue.printerConnected,
              releasing: queue.releasing,
            },
      pause: paused === null ? null : { reason: paused, message: PAUSE_MESSAGES[paused], backlog: queue?.backlog === true },
      ...counts,
      labelsEnabled: queue?.labelsEnabled ?? true,
    }
  }

  /** 대기열 전체 (출력 중·대기 작업, 버릴 라벨, 요약) */
  async overview(sellerId: string): Promise<{ queue: QueueSummary; jobs: JobView[]; discard: JobView[] }> {
    const queue = await this.summary(sellerId)
    const active = await activeJobs(this.#db, sellerId)
    const discard = await discardJobs(this.#db, sellerId)
    const contexts = await this.#contexts(sellerId, active.filter((row) => row.job.kind === 'product').map((row) => row.job.date))
    return {
      queue,
      jobs: active.map((row) => this.#jobView(row, contexts.get(row.job.date) ?? null)),
      discard: discard.map((row) => this.#jobView(row, null)),
    }
  }

  /** 날짜들의 실제 범위 상태 (범위가 없으면 빠진다) */
  async #contexts(sellerId: string, dates: readonly string[]): Promise<Map<string, StateContext>> {
    const map = new Map<string, StateContext>()
    for (const date of new Set(dates)) {
      const runtime = await this.#options.writer.read(sellerId, date)
      if (runtime.seq === 0) continue
      map.set(date, { state: runtime.state, claims: claimIndex(runtime, runtime.state) })
    }
    return map
  }

  #jobView(row: JobWithLabel, ctx: StateContext | null): JobView {
    const { job, label } = row
    const ref = labelRef(label)
    let data: JobView['data'] = null
    if (job.printedData !== null) data = JSON.parse(job.printedData) as ProductLabelData | PackingLabelData
    else if (job.kind === 'packing' && job.data !== null) data = JSON.parse(job.data) as PackingLabelData
    else if (job.kind === 'product' && ctx !== null && !job.voided && label.claim !== null && label.version !== null) {
      data = productLabelData(ctx.state, ctx.claims, { claim: label.claim, version: label.version, buyer: ref.buyer }, this.#amountMissing)
    }
    return {
      id: job.jobId,
      date: job.date,
      kind: job.kind as JobView['kind'],
      reason: job.reason as JobView['reason'],
      status: job.status as JobView['status'],
      word: jobWord(job),
      voided: job.voided,
      discard: job.status === 'DONE' && job.voided && job.discardedAt === null,
      discardedAt: job.discardedAt === null ? null : job.discardedAt.toISOString(),
      attempts: job.attempts,
      lastError: lastErrorOf(job.lastError),
      label: ref,
      page: job.page,
      pages: job.pages,
      data,
      device: job.deviceName,
      printedAt: job.printedAt === null ? null : job.printedAt.toISOString(),
      createdAt: job.createdAt.toISOString(),
    }
  }

  /** 라벨 키 보기 (상태 낱말·재출력 필요·이력·지금 데이터) */
  async #labelViews(sellerId: string, labels: readonly LabelRow[], contexts: Map<string, StateContext>): Promise<LabelView[]> {
    const jobs = await jobsOfLabels(this.#db, sellerId, labels.map((label) => label.id))
    const byLabel = new Map<number, JobRow[]>()
    for (const job of jobs) {
      const list = byLabel.get(job.labelId)
      if (list === undefined) byLabel.set(job.labelId, [job])
      else list.push(job)
    }
    return labels.map((label) => this.#labelView(label, byLabel.get(label.id) ?? [], contexts.get(label.date) ?? null))
  }

  #labelView(label: LabelRow, jobs: readonly JobRow[], ctx: StateContext | null): LabelView {
    const ref = labelRef(label)
    const kind = label.kind as 'product' | 'packing'
    const voided = label.voidedAt !== null
    let data: LabelView['data'] = null
    let winner = false
    if (ctx !== null && !voided) {
      if (kind === 'product' && label.claim !== null && label.version !== null) {
        winner = isWinnerOf(ctx.claims, label.claim, label.version) !== null
        data = productLabelData(ctx.state, ctx.claims, { claim: label.claim, version: label.version, buyer: ref.buyer }, this.#amountMissing)
      } else if (kind === 'packing' && label.buyerId !== null) {
        data = packingLabelData(ctx.state, label.buyerId, label.date, this.#amountMissing)?.data ?? null
      }
    }
    return this.#composeLabelView(label.date, kind, ref, voided, jobs, data, winner)
  }

  #composeLabelView(date: string, kind: 'product' | 'packing', ref: LabelRef, voided: boolean, jobs: readonly JobRow[], data: LabelView['data'], winner: boolean): LabelView {
    const printing = jobs.some((job) => job.status === 'PRINTING')
    const waiting = jobs.some((job) => job.status === 'WAITING')
    const done = jobs
      .filter((job) => job.status === 'DONE' && job.printedAt !== null)
      .sort((a, b) => (a.printedAt as Date).getTime() - (b.printedAt as Date).getTime() || a.id - b.id)
    const lastDone = done.at(-1)
    const discard = jobs.filter((job) => job.status === 'DONE' && job.voided && job.discardedAt === null).length
    const currentKey = data === null ? null : contentKeyOf(kind, data)
    const reprintNeeded = !voided && lastDone !== undefined && (kind === 'packing' || winner) && currentKey !== lastDone.contentKey
    let state: LabelState
    let word: string
    if (printing) {
      state = 'PRINTING'
      word = LABEL_WORDS.PRINTING
    } else if (voided) {
      state = 'VOIDED'
      word = discard > 0 ? '폐기 — 버려 주세요' : '폐기'
    } else if (waiting) {
      state = 'WAITING'
      word = LABEL_WORDS.WAITING
    } else if (lastDone !== undefined) {
      state = reprintNeeded ? 'REPRINT_NEEDED' : 'PRINTED'
      word = LABEL_WORDS[state]
    } else if (jobs.length > 0) {
      state = 'NOT_PRINTED'
      word = LABEL_WORDS.NOT_PRINTED
    } else {
      state = 'NONE'
      word = LABEL_WORDS.NONE
    }
    const idle = !printing && !waiting
    return {
      ...ref,
      date,
      kind,
      state,
      word,
      voided,
      discard,
      reprintNeeded,
      printed: done.length,
      history: done.map((job) => ({ at: (job.printedAt as Date).toISOString(), device: job.deviceName ?? '' })),
      winner,
      data,
      canPrint: kind === 'product' && winner && jobs.length === 0,
      canReprint: !voided && idle && jobs.length > 0 && (kind === 'product' ? winner : data !== null),
    }
  }

  /**
   * 범위(실제)의 라벨 상태 (AC-I1-12·30·31): 라벨 키가 있는 것 전부 + 작업이 없는 지금 1등(상태 NONE).
   * 상품은 방송 선언 순서·번호·확정버전 순, 포장은 그 뒤 만든 순서. 범위가 없으면 null
   */
  async labels(sellerId: string, date: string): Promise<{ date: string; labels: LabelView[] } | null> {
    const runtime = await this.#options.writer.read(sellerId, date)
    const { state, scopeId, seq } = runtime
    if (seq === 0 || scopeId === null) return null
    const ctx: StateContext = { state, claims: claimIndex(runtime, state) }
    const rows = await scopeLabels(this.#db, sellerId, scopeId)
    const contexts = new Map([[date, ctx]])
    const views = await this.#labelViews(sellerId, rows, contexts)
    const known = new Set(rows.filter((row) => row.kind === 'product').map((row) => row.key))
    for (const product of listProducts(state)) {
      for (const claimId of winnerClaimsOf(product)) {
        const info = ctx.claims.get(claimId)
        if (info === undefined || info.confirmVersion === null) continue
        const key = `${claimId}@${String(info.confirmVersion)}`
        if (known.has(key)) continue
        const buyer = productLabelBuyer(state, info)
        const ref: LabelRef = { key, claim: claimId, version: info.confirmVersion, broadcast: info.broadcast, no: info.no, buyerId: null, buyer }
        const data = productLabelData(state, ctx.claims, { claim: claimId, version: info.confirmVersion, buyer }, this.#amountMissing)
        views.push(this.#composeLabelView(date, 'product', ref, false, [], data, true))
      }
    }
    const order = new Map(listBroadcasts(state).map((broadcast, index) => [broadcast.id, index]))
    const rank = (view: LabelView) => (view.kind === 'packing' ? Number.MAX_SAFE_INTEGER : (order.get(view.broadcast ?? '') ?? Number.MAX_SAFE_INTEGER - 1))
    views.sort((a, b) => rank(a) - rank(b) || (a.no ?? 0) - (b.no ?? 0) || (a.version ?? 0) - (b.version ?? 0))
    return { date, labels: views }
  }

  /** 정산 묶음의 포장 라벨 (AC-I1-35): 지금 데이터와 그 라벨 키의 상태. 범위·구매자가 없으면 null */
  async packing(sellerId: string, date: string, buyerId: string): Promise<{ date: string; buyer: string; data: PackingLabelData | null; label: LabelView } | null> {
    const runtime = await this.#options.writer.read(sellerId, date)
    if (runtime.seq === 0 || runtime.scopeId === null) return null
    const { state, scopeId } = runtime
    const root = currentBuyerOf(state, buyerId)
    if (root === null) return null
    const data = packingLabelData(state, root, date, this.#amountMissing)?.data ?? null
    const key = `packing:${root}`
    const row = await findLabel(this.#db, sellerId, scopeId, key)
    const label =
      row === null
        ? this.#composeLabelView(date, 'packing', { key, claim: null, version: null, broadcast: null, no: null, buyerId: root, buyer: data?.buyer ?? currentLabelBuyer(state, root) }, false, [], data, false)
        : ((await this.#labelViews(sellerId, [row], new Map([[date, { state, claims: claimIndex(runtime, state) }]])))[0] as LabelView)
    return { date, buyer: root, data, label }
  }

  // ── 출력 기기 (L-11 10) ──────────────────────────────────────────────────

  /**
   * 출력 기기 되기. 출력 기기가 없으면 바로, 다른 기기면 replace 없이 거절(지금 출력 기기 이름을 extra로).
   * 바꾸면 이전 기기의 출력 중 작업은 대기 맨 앞(시도 +1, DISCONNECTED). 새로 정할 때 대기 작업이 있으면 판매자 멈춤(backlog)으로 시작.
   * 이미 출력 기기인 기기가 다시 알리면 이름을 고치고 출력 그만하기를 거두며 멈춤을 바꾸지 않는다. 출력 기기가 되는 기기는 프린터가 연결돼 있다
   */
  async registerDevice(sellerId: string, deviceId: string, name: string, replace: boolean): Promise<ActionOutcome<{ queue: QueueSummary; waiting: number; backlog: boolean }>> {
    // 라벨 기능이 꺼져 있으면 출력 기기를 정하지 않는다 (같은 기기의 다시 알림·바꾸기 포함, L-13 5)
    if (await labelsOff(this.#db, sellerId)) return labelsOffRejected()
    const now = this.#now()
    const touched: Touched = { jobs: [], labels: [] }
    const outcome = await this.#db.transaction(async (tx) => {
      const queue = await lockQueue(tx, sellerId, now)
      if (!queue.labelsEnabled) return { kind: 'off' as const }
      const counts = async () => queueCounts(tx, sellerId)
      if (queue.deviceId === deviceId) {
        // 같은 기기가 다시 "이 기기에서 출력"을 누르면 출력 그만하기를 거둔다(출력 중인 장이 끝나도 출력 기기로 남는다, L-11 10). 멈춤은 그대로
        await updateQueue(tx, sellerId, { deviceName: name, releasing: false }, now)
        return { kind: 'ok' as const, backlog: false }
      }
      if (queue.deviceId !== null && !replace) return { kind: 'taken' as const, name: queue.deviceName ?? '' }
      const patch: QueuePatch = { deviceId, deviceName: name, printerConnected: true, releasing: false }
      let backlog = false
      if (queue.deviceId !== null) {
        // 바꾸기: 이전 기기의 출력 중 작업을 대기 맨 앞으로 (L-11 10)
        const returned = await this.#returnPrinting(tx, sellerId, queue, 'DISCONNECTED', now, patch)
        if (returned !== null) touched.jobs.push(returned)
        if (queue.paused === 'DISCONNECTED') patch.paused = null
      } else {
        const { waiting } = await counts()
        if (waiting > 0) {
          patch.paused = 'SELLER'
          patch.backlog = true
          backlog = true
        } else if (queue.paused === 'DISCONNECTED') patch.paused = null
      }
      await updateQueue(tx, sellerId, patch, now)
      return { kind: 'ok' as const, backlog }
    })
    if (outcome.kind === 'off') return labelsOffRejected()
    if (outcome.kind === 'taken') return rejected(409, 'PRINT_DEVICE_TAKEN', PRINT_MESSAGES.deviceTaken, { device: { name: outcome.name } })
    this.#notify(sellerId, touched)
    const queue = await this.summary(sellerId)
    return { kind: 'ok', value: { queue, waiting: queue.waiting, backlog: outcome.backlog } }
  }

  /** 출력 중 작업(이전 기기)의 시도를 끝내고 대기 맨 앞으로(폐기됐으면 출력 안 함). 되돌린 작업 행 ID */
  async #returnPrinting(tx: Db, sellerId: string, queue: QueueRow, code: string, now: Date, patch: QueuePatch): Promise<number | null> {
    const job = await printingJob(tx, sellerId)
    if (job === null) return null
    const attempt = await openAttempt(tx, sellerId, job.id)
    if (attempt !== null) await finishAttempt(tx, sellerId, attempt.id, code, now)
    const front = patch.frontOrder ?? queue.frontOrder
    if (job.voided) await updateJob(tx, sellerId, job.id, { status: 'CANCELLED', attempts: job.attempts + 1, lastError: code })
    else {
      await updateJob(tx, sellerId, job.id, { status: 'WAITING', queueOrder: front, attempts: job.attempts + 1, lastError: code })
      patch.frontOrder = front - 1
    }
    return job.id
  }

  /** 출력 기기가 알린 프린터 연결 상태 (끊김 → 멈춤(끊김), 다시 연결 → 끊김 멈춤만 풀린다, L-8 3) */
  async deviceState(sellerId: string, deviceId: string, connected: boolean): Promise<ActionOutcome<{ queue: QueueSummary }>> {
    // 출력 기기가 아니면 아무것도 쓰지 않는다 (대기열 줄도 만들지 않는다)
    if ((await readQueue(this.#db, sellerId))?.deviceId !== deviceId) return rejected(409, 'PRINT_NOT_DEVICE', PRINT_MESSAGES.notDevice)
    const now = this.#now()
    const ok = await this.#db.transaction(async (tx) => {
      const queue = await lockQueue(tx, sellerId, now)
      if (queue.deviceId !== deviceId) return false
      const patch: QueuePatch = { printerConnected: connected }
      if (connected && queue.paused === 'DISCONNECTED') patch.paused = null
      if (!connected && queue.paused === null) patch.paused = 'DISCONNECTED'
      await updateQueue(tx, sellerId, patch, now)
      return true
    })
    if (!ok) return rejected(409, 'PRINT_NOT_DEVICE', PRINT_MESSAGES.notDevice)
    this.#notify(sellerId, { jobs: [], labels: [] })
    return { kind: 'ok', value: { queue: await this.summary(sellerId) } }
  }

  /** 출력 그만하기 (L-11 10): 출력 중 작업이 없으면 바로, 있으면 그 결과가 정해진 뒤 출력 기기를 비운다 */
  async releaseDevice(sellerId: string): Promise<{ queue: QueueSummary }> {
    if ((await readQueue(this.#db, sellerId))?.deviceId == null) return { queue: await this.summary(sellerId) }
    const now = this.#now()
    await this.#db.transaction(async (tx) => {
      const queue = await lockQueue(tx, sellerId, now)
      if (queue.deviceId === null) return
      if ((await printingJob(tx, sellerId)) !== null) {
        await updateQueue(tx, sellerId, { releasing: true }, now)
        return
      }
      await updateQueue(tx, sellerId, clearDevice(queue.paused as PauseReason | null), now)
    })
    this.#notify(sellerId, { jobs: [], labels: [] })
    return { queue: await this.summary(sellerId) }
  }

  /** 출력 멈추기 (판매자 멈춤). 이미 손으로 푸는 멈춤이면 그대로 */
  async pause(sellerId: string): Promise<{ queue: QueueSummary }> {
    const now = this.#now()
    await this.#db.transaction(async (tx) => {
      const queue = await lockQueue(tx, sellerId, now)
      if (queue.paused === 'SELLER' || queue.paused === 'PRINTER_ERROR' || queue.paused === 'LABEL_ERROR') return
      await updateQueue(tx, sellerId, { paused: 'SELLER', backlog: false }, now)
    })
    this.#notify(sellerId, { jobs: [], labels: [] })
    return { queue: await this.summary(sellerId) }
  }

  /**
   * 다시 시작·출력 시작 (판매자·프린터 오류·라벨 오류 멈춤 풀기, 어느 기기에서나). 끊김 멈춤은 출력 기기의 다시 연결로만 풀린다(거절, 출력 기기 이름을 extra로).
   * 출력 기기의 프린터가 끊겨 있으면 끊김 멈춤으로 바뀐다
   */
  async restart(sellerId: string): Promise<ActionOutcome<{ queue: QueueSummary }>> {
    const current = await readQueue(this.#db, sellerId)
    // 라벨 기능이 꺼져 있으면 멈춰 있지 않아도 거절한다 (L-13 5)
    if (current?.labelsEnabled === false) return labelsOffRejected()
    if (current?.paused == null) return { kind: 'ok', value: { queue: await this.summary(sellerId) } }
    const now = this.#now()
    const blocked = await this.#db.transaction(async (tx) => {
      const queue = await lockQueue(tx, sellerId, now)
      if (!queue.labelsEnabled) return 'off' as const
      if (queue.paused === 'DISCONNECTED') return { name: queue.deviceName ?? '' }
      if (queue.paused === null) return null
      const paused = queue.deviceId !== null && !queue.printerConnected ? 'DISCONNECTED' : null
      await updateQueue(tx, sellerId, { paused, backlog: false }, now)
      return null
    })
    if (blocked === 'off') return labelsOffRejected()
    if (blocked !== null) return rejected(409, 'PRINT_RECONNECT_REQUIRED', PRINT_MESSAGES.reconnect, { device: { name: blocked.name } })
    this.#notify(sellerId, { jobs: [], labels: [] })
    return { kind: 'ok', value: { queue: await this.summary(sellerId) } }
  }

  // ── 받기·결과 (L-11 4·6·7) ───────────────────────────────────────────────

  /**
   * 출력 기기가 작업 하나를 받는다. 출력 기기가 아니면 not_device(아무것도 바뀌지 않는다). 멈춤·출력 중 작업이 있으면·대기가 없으면 none.
   * 단 출력 중 작업의 열린 시도가 이 기기의 것이고 준 지 RECLAIM_AFTER_MS가 지났으면(받기 응답을 잃음) 그 시도를 끊김으로 끝내고 같은 장을 새 표로 다시 준다.
   * 대기 맨 앞 작업의 라벨 키 찜이 그 확정버전의 1등이 아니면 폐기하고 다음 작업을 본다. 1등인데 데이터를 만들지 못하면 라벨 오류 멈춤.
   * 상품 라벨 데이터는 지금 상태로 만든다(구매자만 고정)
   */
  async claim(sellerId: string, deviceId: string): Promise<ClaimOutcome> {
    const current = await readQueue(this.#db, sellerId)
    // 라벨 기능이 꺼져 있으면 받지 않는다 — 출력 기기가 아니어도 (L-13 5·6, 이미 받은 시도의 결과는 받는다)
    if (current?.labelsEnabled === false) return { kind: 'labels_off' }
    // 출력 기기가 아니면 아무것도 쓰지 않는다 (대기열 줄도 만들지 않는다, AC-I1-06)
    if (current?.deviceId !== deviceId) return { kind: 'not_device' }
    for (let round = 0; round < CLAIM_ROUNDS; round++) {
      const peek = await headWaitingJob(this.#db, sellerId)
      let ctx: StateContext | null = null
      if (peek !== null && peek.job.kind === 'product') {
        const runtime = await this.#options.writer.read(sellerId, peek.job.date)
        ctx = { state: runtime.state, claims: claimIndex(runtime, runtime.state) }
      }
      const now = this.#now()
      const touched: Touched = { jobs: [], labels: [] }
      const outcome: ClaimOutcome | { kind: 'retry' } = await this.#db.transaction(async (tx) => {
        const queue = await lockQueue(tx, sellerId, now)
        if (!queue.labelsEnabled) return { kind: 'labels_off' as const }
        if (queue.deviceId !== deviceId) return { kind: 'not_device' as const }
        if (queue.paused !== null) return { kind: 'none' as const, reason: 'PAUSED' as const }
        const printing = await printingJob(tx, sellerId)
        if (printing !== null) {
          const open = await openAttempt(tx, sellerId, printing.id)
          if (open === null || open.deviceId !== deviceId || now.getTime() - open.startedAt.getTime() < RECLAIM_AFTER_MS) {
            return { kind: 'none' as const, reason: 'BUSY' as const }
          }
          // 같은 기기가 출력 중인 장의 열린 시도를 가진 채 한참 뒤 다시 받는다 = 받기 응답을 잃었다(출력 기기는 결과를 보내기 전에는 받지 않는다).
          // 그 시도를 끊김으로 끝내고(시도 +1) 그 장을 대기 맨 앞으로 돌린 뒤 다음 차례에 같은 장을 새 표로 준다 — 다음 작업이 아니다(AC-I1-06).
          // 데이터·템플릿·1등 확인은 다시 받는 때의 규칙 그대로. 출력 그만하기를 기다리던 중이면 그 장의 결과가 정해졌으니 출력 기기를 비운다(L-11 10)
          const patch: QueuePatch = {}
          await this.#returnPrinting(tx, sellerId, queue, 'DISCONNECTED', now, patch)
          touched.jobs.push(printing.id)
          touched.labels.push(printing.labelId)
          if (queue.releasing) Object.assign(patch, clearDevice(queue.paused as PauseReason | null))
          await updateQueue(tx, sellerId, patch, now)
          return queue.releasing ? { kind: 'not_device' as const } : { kind: 'retry' as const }
        }
        const head = await headWaitingJob(tx, sellerId)
        if (head === null) return { kind: 'none' as const, reason: 'EMPTY' as const }
        if (peek === null || head.job.id !== peek.job.id) return { kind: 'retry' as const }
        const { job, label } = head
        const kind = job.kind as 'product' | 'packing'
        let data: ProductLabelData | PackingLabelData | null
        if (kind === 'product') {
          const { claim, version } = label
          if (ctx === null || claim === null || version === null || isWinnerOf(ctx.claims, claim, version) === null) {
            // 받을 때의 확인: 1등이 아니면 폐기하고 다음 작업 (L-11 4·5)
            const voided = await voidLabels(tx, sellerId, [label.id], now)
            touched.jobs.push(...voided.jobs)
            touched.labels.push(...voided.labels)
            await updateQueue(tx, sellerId, {}, now)
            return { kind: 'retry' as const }
          }
          // 1등인데 데이터를 만들지 못하면(L-3 범위 밖 번호 등) 폐기하지 않는다 — 아래 라벨 오류 멈춤 (L-11 5: 폐기는 1등이 아닐 때만)
          data = productLabelData(ctx.state, ctx.claims, { claim, version, buyer: parseBuyer(label.buyer) }, this.#amountMissing)
        } else {
          data = job.data === null ? null : (JSON.parse(job.data) as PackingLabelData)
        }
        const contentKey = data === null ? null : contentKeyOf(kind, data)
        if (data === null || contentKey === null) {
          // 라벨 데이터를 만들 수 없다: 라벨 오류 멈춤 (작업은 대기 맨 앞 그대로, 시도 +1)
          await updateJob(tx, sellerId, job.id, { attempts: job.attempts + 1, lastError: 'INVALID_DATA' })
          await updateQueue(tx, sellerId, { paused: 'LABEL_ERROR', backlog: false }, now)
          touched.jobs.push(job.id)
          return { kind: 'none' as const, reason: 'PAUSED' as const }
        }
        const token = randomBytes(18).toString('base64url')
        await updateJob(tx, sellerId, job.id, { status: 'PRINTING' })
        await insertAttempt(tx, {
          sellerId,
          jobRef: job.id,
          token,
          deviceId,
          deviceName: queue.deviceName ?? '',
          data: JSON.stringify(data),
          contentKey,
          startedAt: now,
        })
        await updateQueue(tx, sellerId, {}, now)
        touched.jobs.push(job.id)
        const template = await this.#template(tx, sellerId, kind)
        return {
          kind: 'job' as const,
          job: {
            id: job.jobId,
            date: job.date,
            kind,
            reason: job.reason,
            attempt: token,
            data,
            template: kind === 'packing' && job.perPage !== null && template.kind === 'packing' ? { ...template, perPage: job.perPage } : template,
            page: job.page,
            pages: job.pages,
            label: labelRef(label),
          },
        }
      })
      if (touched.jobs.length > 0 || touched.labels.length > 0) this.#notify(sellerId, touched)
      if (outcome.kind !== 'retry') return outcome
    }
    return { kind: 'none', reason: 'BUSY' }
  }

  /**
   * 받은 작업의 결과 (L-11 6·7). 지금 그 기기가 가진, 결과가 아직 없는 시도의 결과만 기록한다 — 아니면 recorded: false(아무것도 바뀌지 않는다).
   * 출력함이고 그 라벨 키의 자동 출력 효과가 엔진에서 아직 실행 완료가 아니면 effect.labelPrinted를 같은 트랜잭션에서 기록한다(효과마다 한 번)
   */
  async result(sellerId: string, deviceId: string, token: string, input: ResultInput): Promise<{ kind: 'not_found' } | { kind: 'save_failed' } | { kind: 'ok'; recorded: boolean }> {
    const attempt = await findAttempt(this.#db, sellerId, token)
    if (attempt === null) return { kind: 'not_found' }
    if (attempt.result !== null || attempt.deviceId !== deviceId) return { kind: 'ok', recorded: false }
    const [row] = await jobsWithLabels(this.#db, sellerId, [attempt.jobRef])
    if (row === undefined) return { kind: 'not_found' }
    const effectId = row.label.effectId
    if (input.ok && effectId !== null) {
      const applied: { touched: Touched | null } = { touched: null }
      const written = await this.#options.writer.write({
        sellerId,
        date: row.job.date,
        rehearsal: false,
        createScope: false,
        requestId: null,
        build: (ctx) => {
          const effect = listEffects(ctx.state).find((item) => item.id === effectId)
          // 효과마다 한 번: 이미 실행 완료면 보고하지 않는다 (재출력·같은 결과 재전송·두 기기·재시작)
          if (effect === undefined || effect.kind !== 'PRINT_PRODUCT_LABEL' || effect.status === 'DONE') return rejection(409, 'PRINT_NO_REPORT', '')
          return [{ fields: { type: 'effect.labelPrinted', effectId }, actor: { kind: 'server' } }]
        },
        afterInsert: async (tx, _scopeId, _records, now) => {
          applied.touched = await this.#applyResult(tx, sellerId, deviceId, token, input, now)
          if (applied.touched === null) throw new WriteAbort({ kind: 'rejected', rejection: rejection(409, 'PRINT_STALE', '') })
        },
      })
      if (written.kind === 'ok') {
        if (applied.touched !== null) this.#notify(sellerId, applied.touched)
        return { kind: 'ok', recorded: true }
      }
      if (written.kind === 'rejected' && written.rejection.code === 'PRINT_STALE') return { kind: 'ok', recorded: false }
      if (written.kind === 'save_failed') return { kind: 'save_failed' }
      // PRINT_NO_REPORT (이미 보고됨) 등: 엔진 보고 없이 기록한다
    }
    const touched = await this.#db.transaction((tx) => this.#applyResult(tx, sellerId, deviceId, token, input, this.#now()))
    if (touched === null) return { kind: 'ok', recorded: false }
    this.#notify(sellerId, touched)
    return { kind: 'ok', recorded: true }
  }

  /** 결과 적용 (잠근 트랜잭션 안에서). 지금 시도가 아니면 null */
  async #applyResult(tx: Db, sellerId: string, deviceId: string, token: string, input: ResultInput, now: Date): Promise<Touched | null> {
    const queue = await lockQueue(tx, sellerId, now)
    const attempt = await findAttempt(tx, sellerId, token, true)
    if (attempt === null || attempt.result !== null || attempt.deviceId !== deviceId || queue.deviceId !== deviceId) return null
    const [row] = await jobsWithLabels(tx, sellerId, [attempt.jobRef])
    if (row === undefined || row.job.status !== 'PRINTING') return null
    const { job } = row
    const patch: QueuePatch = {}
    let paused = queue.paused as PauseReason | null
    if (input.ok) {
      await finishAttempt(tx, sellerId, attempt.id, 'DONE', now)
      await updateJob(tx, sellerId, job.id, {
        status: 'DONE',
        printedAt: now,
        deviceName: attempt.deviceName,
        contentKey: attempt.contentKey,
        printedData: attempt.data,
        lastError: null,
      })
      // 라벨 장 쓰기 (N5): 상품 라벨이 출력함이 되면 같은 트랜잭션에서. 폐기된 작업은 세지 않는다
      if (job.kind === 'product' && !job.voided) {
        await this.#options.onPrinted?.(tx, { sellerId, date: job.date, jobId: job.jobId, broadcast: row.label.broadcast, no: row.label.no, now })
      }
    } else {
      const code = input.code === 'DOES_NOT_FIT' && input.item !== null ? `${input.code}:${input.item}` : input.code
      await finishAttempt(tx, sellerId, attempt.id, code, now)
      if (job.voided) {
        // 출력 중에 폐기된 작업이 실패로 끝나면 대기로 되돌리지 않는다 (L-8 4)
        await updateJob(tx, sellerId, job.id, { status: 'CANCELLED', attempts: job.attempts + 1, lastError: code })
      } else {
        await updateJob(tx, sellerId, job.id, { status: 'WAITING', queueOrder: queue.frontOrder, attempts: job.attempts + 1, lastError: code })
        patch.frontOrder = queue.frontOrder - 1
      }
      const reason = pauseForError(input.code)
      if (reason === 'DISCONNECTED') {
        patch.printerConnected = false
        if (paused === null) paused = 'DISCONNECTED'
      } else {
        paused = reason
        patch.backlog = false
      }
      patch.paused = paused
    }
    if (queue.releasing) Object.assign(patch, clearDevice(paused))
    await updateQueue(tx, sellerId, patch, now)
    return { jobs: [job.id], labels: [job.labelId] }
  }

  // ── 판매자 조치 (L-11 3·9·12, AC-I1-11·13) ─────────────────────────────

  /** 같은 요청 번호로 이미 만든 작업 (처음 결과) */
  async #priorJobs(sellerId: string, requestId: string): Promise<JobView[] | null> {
    const prior = await findPrintRequest(this.#db, sellerId, requestId)
    if (prior === null) return null
    const parsed = JSON.parse(prior) as { date: string; jobs: string[] }
    return this.#jobViewsOf(sellerId, parsed.date, parsed.jobs, await this.#options.writer.read(sellerId, parsed.date))
  }

  async #jobViewsOf(sellerId: string, date: string, jobIds: readonly string[], runtime: ScopeRuntime | null): Promise<JobView[]> {
    const ctx = runtime === null ? null : { state: runtime.state, claims: claimIndex(runtime, runtime.state) }
    const views: JobView[] = []
    for (const jobId of jobIds) {
      const row = await findJob(this.#db, sellerId, date, jobId)
      if (row !== null) views.push(this.#jobView(row, ctx))
    }
    return views
  }

  /** 리허설 방송·없는 방송 확인 (방송이 있는 조치) */
  async #broadcastScope(sellerId: string, b: string): Promise<{ date: string } | 'rehearsal' | null> {
    const row = await findBroadcast(this.#db, sellerId, b)
    if (row === null) return null
    return row.rehearsal ? 'rehearsal' : { date: row.date }
  }

  /**
   * 라벨 출력 (손으로, L-11 3): 실제 범위의 지금 1등 찜, 그 라벨 키(찜, 지금 확정버전)에 작업이 하나도 없을 때만.
   * 같은 요청 번호면 같은 결과. 엔진 기록이 아니라 5초 대기가 없다. 라벨 기능이 꺼져 있으면 거절(L-13 5).
   * 그 라벨 키에 그 범위의 PRINT_PRODUCT_LABEL 효과가 있으면(라벨 기능을 끈 동안 나와 작업이 되지 않은 효과) 라벨 키를 그 효과와 묶는다 —
   * 출력함이 되면 L-11 7대로 그 효과를 보고한다(N4a L-11 3·7, L-13 8, D-N4a-04)
   */
  async printLabel(sellerId: string, accountId: string, requestId: string, b: string, claimId: string): Promise<ActionOutcome<{ jobs: JobView[] }>> {
    const prior = await this.#priorJobs(sellerId, requestId)
    if (prior !== null) return { kind: 'ok', value: { jobs: prior } }
    const scope = await this.#broadcastScope(sellerId, b)
    if (scope === null) return { kind: 'not_found' }
    if (scope === 'rehearsal') return rejected(422, 'PRINT_REHEARSAL', PRINT_MESSAGES.rehearsal)
    if (await labelsOff(this.#db, sellerId)) return labelsOffRejected()
    const { date } = scope
    let created: string[] = []
    const outcome = await this.#options.writer.withState(sellerId, date, false, async (runtime): Promise<ActionOutcome<null>> => {
      if (runtime.scopeId === null) return { kind: 'not_found' }
      const claims = claimIndex(runtime, runtime.state)
      const info = claims.get(claimId)
      if (info === undefined || info.broadcast !== b) return { kind: 'not_found' }
      if (info.status !== 'CONFIRMED' || info.confirmVersion === null) return rejected(409, 'PRINT_NOT_WINNER', PRINT_MESSAGES.notWinner)
      // 찜 금액이 없으면 라벨 데이터를 만들 수 없다 — 작업을 만들지 않는다 (D-O3-15)
      if (claimAmount(info) === null) {
        this.#amountMissing(info.id)
        return rejected(500, 'AMOUNT_MISSING', AMOUNT_MISSING_MESSAGE)
      }
      const scopeId = runtime.scopeId
      const version = info.confirmVersion
      const key = `${claimId}@${String(version)}`
      const now = this.#now()
      const buyer = JSON.stringify(productLabelBuyer(runtime.state, info))
      // 이 라벨 키의 자동 출력 효과 (실제 범위의 엔진 상태 — 리허설 범위는 위에서 거절했다)
      const effectId = listEffects(runtime.state).find((effect) => effect.kind === 'PRINT_PRODUCT_LABEL' && effect.claim === claimId && effect.confirmVersion === version)?.id ?? null
      return this.#db.transaction(async (tx): Promise<ActionOutcome<null>> => {
        if ((await findPrintRequest(tx, sellerId, requestId)) !== null) return { kind: 'ok', value: null }
        const queue = await lockQueue(tx, sellerId, now)
        if (!queue.labelsEnabled) return labelsOffRejected()
        let label = await findLabel(tx, sellerId, scopeId, key)
        if (label !== null && (await jobsOfLabels(tx, sellerId, [label.id])).length > 0) return rejected(409, 'PRINT_LABEL_EXISTS', PRINT_MESSAGES.labelExists)
        if (label === null) {
          await insertLabels(tx, [{ sellerId, scopeId, date, key, kind: 'product', claim: claimId, version, broadcast: info.broadcast, no: info.no, buyer, effectId, createdAt: now }])
          label = await findLabel(tx, sellerId, scopeId, key)
          if (label === null) throw new Error('라벨 키를 만들지 못했다')
        } else if (label.effectId === null && effectId !== null) {
          await bindLabelEffect(tx, sellerId, label.id, effectId)
        }
        const jobId = newJobId('m')
        await insertJobs(tx, [
          {
            sellerId,
            scopeId,
            labelId: label.id,
            date,
            jobId,
            kind: 'product',
            reason: 'manual',
            status: label.voidedAt === null ? 'WAITING' : 'CANCELLED',
            voided: label.voidedAt !== null,
            queueOrder: queue.nextOrder,
            requestedBy: accountId,
            createdAt: now,
          },
        ])
        await insertPrintRequest(tx, sellerId, requestId, JSON.stringify({ date, jobs: [jobId] }), now)
        await updateQueue(tx, sellerId, { nextOrder: queue.nextOrder + 1 }, now)
        created = [jobId]
        return { kind: 'ok', value: null }
      })
    })
    if (outcome.kind !== 'ok') return outcome
    if (created.length === 0) return { kind: 'ok', value: { jobs: (await this.#priorJobs(sellerId, requestId)) ?? [] } }
    const jobs = await this.#jobViewsOf(sellerId, date, created, await this.#options.writer.read(sellerId, date))
    this.#notifyJobs(sellerId, date, created)
    return { kind: 'ok', value: { jobs } }
  }

  /**
   * 다시 출력 (L-8 5, L-11 9): 그 라벨 키의 작업이 출력함 또는 출력 안 함이고, 폐기되지 않았고, 대기·출력 중 작업이 없고,
   * 그 찜이 지금도 그 확정버전의 1등일 때만 새 작업(대기 맨 끝). version을 주지 않으면 그 찜의 마지막 라벨 키
   */
  async reprintLabel(sellerId: string, accountId: string, requestId: string, b: string, claimId: string, version: number | null): Promise<ActionOutcome<{ jobs: JobView[] }>> {
    const prior = await this.#priorJobs(sellerId, requestId)
    if (prior !== null) return { kind: 'ok', value: { jobs: prior } }
    const scope = await this.#broadcastScope(sellerId, b)
    if (scope === null) return { kind: 'not_found' }
    if (scope === 'rehearsal') return rejected(422, 'PRINT_REHEARSAL', PRINT_MESSAGES.rehearsal)
    if (await labelsOff(this.#db, sellerId)) return labelsOffRejected()
    const { date } = scope
    let created: string[] = []
    const touched: Touched = { jobs: [], labels: [] }
    const outcome = await this.#options.writer.withState(sellerId, date, false, async (runtime): Promise<ActionOutcome<null>> => {
      if (runtime.scopeId === null) return { kind: 'not_found' }
      const scopeId = runtime.scopeId
      const claims = claimIndex(runtime, runtime.state)
      const info = claims.get(claimId)
      if (info === undefined || info.broadcast !== b) return { kind: 'not_found' }
      const now = this.#now()
      return this.#db.transaction(async (tx): Promise<ActionOutcome<null>> => {
        if ((await findPrintRequest(tx, sellerId, requestId)) !== null) return { kind: 'ok', value: null }
        const queue = await lockQueue(tx, sellerId, now)
        if (!queue.labelsEnabled) return labelsOffRejected()
        let label: LabelRow | null
        if (version !== null) label = await findLabel(tx, sellerId, scopeId, `${claimId}@${String(version)}`)
        else {
          const all = (await scopeLabels(tx, sellerId, scopeId, 'product')).filter((row) => row.claim === claimId)
          label = all.sort((x, y) => (y.version ?? 0) - (x.version ?? 0))[0] ?? null
        }
        if (label === null) return rejected(409, 'PRINT_NOT_PRINTED', PRINT_MESSAGES.notPrinted)
        const jobs = await jobsOfLabels(tx, sellerId, [label.id])
        if (label.voidedAt !== null) return rejected(409, 'PRINT_VOIDED', PRINT_MESSAGES.voided)
        if (jobs.some((job) => job.status === 'WAITING' || job.status === 'PRINTING')) return rejected(409, 'PRINT_IN_PROGRESS', PRINT_MESSAGES.inProgress)
        if (jobs.length === 0) return rejected(409, 'PRINT_NOT_PRINTED', PRINT_MESSAGES.notPrinted)
        if (isWinnerOf(claims, claimId, label.version ?? -1) === null) {
          // 1등이 아닌 라벨 키는 이 자리에서 폐기한다 (L-11 5)
          const voided = await voidLabels(tx, sellerId, [label.id], now)
          touched.jobs.push(...voided.jobs)
          touched.labels.push(...voided.labels)
          await updateQueue(tx, sellerId, {}, now)
          return rejected(409, 'PRINT_WINNER_CHANGED', PRINT_MESSAGES.winnerChanged)
        }
        const jobId = newJobId('r')
        await insertJobs(tx, [
          {
            sellerId,
            scopeId,
            labelId: label.id,
            date,
            jobId,
            kind: 'product',
            reason: 'reprint',
            status: 'WAITING',
            queueOrder: queue.nextOrder,
            requestedBy: accountId,
            createdAt: now,
          },
        ])
        await insertPrintRequest(tx, sellerId, requestId, JSON.stringify({ date, jobs: [jobId] }), now)
        await updateQueue(tx, sellerId, { nextOrder: queue.nextOrder + 1 }, now)
        created = [jobId]
        return { kind: 'ok', value: null }
      })
    })
    if (touched.jobs.length > 0 || touched.labels.length > 0) this.#notify(sellerId, touched)
    if (outcome.kind !== 'ok') return outcome
    if (created.length === 0) return { kind: 'ok', value: { jobs: (await this.#priorJobs(sellerId, requestId)) ?? [] } }
    const jobs = await this.#jobViewsOf(sellerId, date, created, await this.#options.writer.read(sellerId, date))
    this.#notifyJobs(sellerId, date, created)
    return { kind: 'ok', value: { jobs } }
  }

  /**
   * 포장 라벨 출력 (L-11 12, D-I1-10): (지금의 구매자, 날짜) 실제 범위 정산 묶음의 그때 데이터로 쪽마다 작업 하나(쪽 순서).
   * 라벨 키 = (포장, 지금의 구매자, 날짜). 1등 상품이 없으면 거절. 그 라벨 키에 대기·출력 중 작업이 있으면 거절
   */
  async printPacking(sellerId: string, accountId: string, requestId: string, date: string, buyerId: string): Promise<ActionOutcome<{ jobs: JobView[] }>> {
    // 30일 봉인 날짜는 출력 작업을 만들지 않는다 (PL1A D-PL1-04 — 라벨 꺼짐보다 먼저, 같은 요청 번호여도. 봉인 범위 상태는 비어 있어 잠긴 뒤 봉인돼도 작업이 생기지 않는다)
    if ((await scopeSealInfo(this.#db, sellerId, date, false))?.sealedAt != null) return rejected(409, 'SEALED', SEALED_MESSAGE)
    const prior = await this.#priorJobs(sellerId, requestId)
    if (prior !== null) return { kind: 'ok', value: { jobs: prior } }
    if (await labelsOff(this.#db, sellerId)) return labelsOffRejected()
    let created: string[] = []
    const outcome = await this.#options.writer.withState(sellerId, date, false, async (runtime): Promise<ActionOutcome<null>> => {
      if (runtime.scopeId === null || runtime.seq === 0) return { kind: 'not_found' }
      const scopeId = runtime.scopeId
      const root = currentBuyerOf(runtime.state, buyerId)
      if (root === null) return { kind: 'not_found' }
      const current = packingLabelData(runtime.state, buyerId, date, this.#amountMissing)
      if (current === null) return rejected(409, 'PRINT_NO_ITEMS', PRINT_MESSAGES.noItems)
      const now = this.#now()
      return this.#db.transaction(async (tx): Promise<ActionOutcome<null>> => {
        if ((await findPrintRequest(tx, sellerId, requestId)) !== null) return { kind: 'ok', value: null }
        const queue = await lockQueue(tx, sellerId, now)
        if (!queue.labelsEnabled) return labelsOffRejected()
        const template = await this.#template(tx, sellerId, 'packing')
        const text = computePackingText(template, current.data)
        if (!text.ok) return rejected(409, 'PRINT_NO_ITEMS', PRINT_MESSAGES.noItems)
        const pages = text.text.pages.length
        const perPage = template.kind === 'packing' ? template.perPage : null
        const key = `packing:${current.root}`
        const buyer = JSON.stringify(current.data.buyer)
        let label = await findLabel(tx, sellerId, scopeId, key)
        if (label === null) {
          await insertLabels(tx, [{ sellerId, scopeId, date, key, kind: 'packing', buyerId: current.root, buyer, createdAt: now }])
          label = await findLabel(tx, sellerId, scopeId, key)
          if (label === null) throw new Error('라벨 키를 만들지 못했다')
        } else {
          const jobs = await jobsOfLabels(tx, sellerId, [label.id])
          if (jobs.some((job) => job.status === 'WAITING' || job.status === 'PRINTING')) return rejected(409, 'PRINT_IN_PROGRESS', PRINT_MESSAGES.inProgress)
        }
        const base = newJobId('p')
        const ids = Array.from({ length: pages }, (_, index) => `${base}-${String(index + 1)}`)
        const data = JSON.stringify(current.data)
        await insertJobs(
          tx,
          ids.map((jobId, index) => ({
            sellerId,
            scopeId,
            labelId: (label as LabelRow).id,
            date,
            jobId,
            kind: 'packing',
            reason: 'packing',
            status: 'WAITING',
            data,
            page: index + 1,
            pages,
            perPage,
            queueOrder: queue.nextOrder + index,
            requestedBy: accountId,
            createdAt: now,
          })),
        )
        await insertPrintRequest(tx, sellerId, requestId, JSON.stringify({ date, jobs: ids }), now)
        await updateQueue(tx, sellerId, { nextOrder: queue.nextOrder + pages }, now)
        created = ids
        return { kind: 'ok', value: null }
      })
    })
    if (outcome.kind !== 'ok') return outcome
    if (created.length === 0) return { kind: 'ok', value: { jobs: (await this.#priorJobs(sellerId, requestId)) ?? [] } }
    const jobs = await this.#jobViewsOf(sellerId, date, created, null)
    this.#notifyJobs(sellerId, date, created)
    return { kind: 'ok', value: { jobs } }
  }

  /** 만든 작업 알림 */
  #notifyJobs(sellerId: string, date: string, jobIds: readonly string[]): void {
    void (async () => {
      const ids: number[] = []
      const labels: number[] = []
      for (const jobId of jobIds) {
        const row = await findJob(this.#db, sellerId, date, jobId)
        if (row !== null) {
          ids.push(row.job.id)
          labels.push(row.label.id)
        }
      }
      this.#notify(sellerId, { jobs: ids, labels })
    })().catch((error: unknown) => this.#options.log({ level: 'warn', code: 'PRINT_NOTIFY_FAILED', errorKind: errorKind(error) }))
  }

  /** 빼기 (L-8 6): 대기 작업 하나를 출력 안 함으로. 출력 중이면 거절. 이미 끝난 작업은 그대로 */
  async cancelJob(sellerId: string, date: string, jobId: string): Promise<ActionOutcome<{ job: JobView }>> {
    const row = await findJob(this.#db, sellerId, date, jobId)
    if (row === null) return { kind: 'not_found' }
    if (row.job.status === 'PRINTING') return rejected(409, 'PRINT_JOB_PRINTING', PRINT_MESSAGES.jobPrinting)
    const now = this.#now()
    const changed = await this.#db.transaction(async (tx) => {
      await lockQueue(tx, sellerId, now)
      const ids = await cancelWaiting(tx, sellerId, [row.job.id])
      if (ids.length > 0) await updateQueue(tx, sellerId, {}, now)
      return ids
    })
    const fresh = await findJob(this.#db, sellerId, date, jobId)
    if (fresh === null) return { kind: 'not_found' }
    if (fresh.job.status === 'PRINTING') return rejected(409, 'PRINT_JOB_PRINTING', PRINT_MESSAGES.jobPrinting)
    if (changed.length > 0) this.#notify(sellerId, { jobs: changed, labels: [fresh.label.id] })
    return { kind: 'ok', value: { job: this.#jobView(fresh, null) } }
  }

  /** 모두 빼기 (확인 표시가 있는 요청만): 그때의 대기 작업 전부를 출력 안 함으로 */
  async cancelAll(sellerId: string): Promise<{ cancelled: number; queue: QueueSummary }> {
    const now = this.#now()
    const changed = await this.#db.transaction(async (tx) => {
      await lockQueue(tx, sellerId, now)
      const ids = await cancelWaiting(tx, sellerId, await waitingJobIds(tx, sellerId))
      if (ids.length > 0) await updateQueue(tx, sellerId, {}, now)
      return ids
    })
    if (changed.length > 0) this.#notify(sellerId, { jobs: changed, labels: [] })
    return { cancelled: changed.length, queue: await this.summary(sellerId) }
  }

  /** 버렸어요 (L-11 5): 버릴 라벨에서 뺀다 — 누가·언제 남김, 다시 보내도 한 번 */
  async discard(sellerId: string, accountId: string, date: string, jobId: string): Promise<ActionOutcome<{ job: JobView }>> {
    const row = await findJob(this.#db, sellerId, date, jobId)
    if (row === null) return { kind: 'not_found' }
    if (row.job.status !== 'DONE' || !row.job.voided) return rejected(409, 'PRINT_NOT_DISCARDABLE', PRINT_MESSAGES.notDiscardable)
    const now = this.#now()
    const changed = await this.#db.transaction(async (tx) => {
      await lockQueue(tx, sellerId, now)
      const fresh = await findJob(tx, sellerId, date, jobId)
      if (fresh === null || fresh.job.discardedAt !== null) return false
      await updateJob(tx, sellerId, fresh.job.id, { discardedAt: now, discardedBy: accountId })
      await updateQueue(tx, sellerId, {}, now)
      return true
    })
    const fresh = (await findJob(this.#db, sellerId, date, jobId)) as JobWithLabel
    if (changed) this.#notify(sellerId, { jobs: [fresh.job.id], labels: [fresh.label.id] })
    return { kind: 'ok', value: { job: this.#jobView(fresh, null) } }
  }

  // ── 템플릿 (L-11 13) ─────────────────────────────────────────────────────

  async #template(db: Db, sellerId: string, kind: 'product' | 'packing'): Promise<LabelTemplate> {
    const row = await readTemplate(db, sellerId, kind)
    if (row === null) return defaultTemplate(kind)
    const checked = validateTemplate(JSON.parse(row.body))
    return checked.ok ? checked.template : defaultTemplate(kind)
  }

  async templates(sellerId: string): Promise<Record<'product' | 'packing', { template: LabelTemplate; version: number }>> {
    const read = async (kind: 'product' | 'packing') => {
      const row = await readTemplate(this.#db, sellerId, kind)
      return { template: await this.#template(this.#db, sellerId, kind), version: row?.version ?? 0 }
    }
    return { product: await read('product'), packing: await read('packing') }
  }

  /**
   * 템플릿 저장: validateTemplate 오류 없음·JSON 16KB 이하·가게 이름(다듬은 뒤) 40자 이하만. version = 읽은 판(저장한 적이 없으면 0) —
   * 서버 판이 더 새것이면 거절. 가게 이름에는 휴대폰 번호 검사를 하지 않는다(D-I1-05)
   */
  async saveTemplate(
    sellerId: string,
    kind: 'product' | 'packing',
    value: unknown,
    version: number,
  ): Promise<ActionOutcome<{ template: LabelTemplate; version: number; warnings: { field: string; message: string }[]; message: string }>> {
    // 라벨 기능이 꺼져 있으면 저장하지 않는다 (L-13 5 — 형식 검사보다 먼저)
    if (await labelsOff(this.#db, sellerId)) return labelsOffRejected()
    let text: string
    try {
      text = JSON.stringify(value)
    } catch {
      return { kind: 'rejected', rejection: rejection(400, 'INVALID_TEMPLATE', PRINT_MESSAGES.templateInvalid, [{ field: 'template', message: PRINT_MESSAGES.templateInvalid }]) }
    }
    if (text === undefined || Buffer.byteLength(text, 'utf8') > TEMPLATE_MAX_BYTES) return rejected(400, 'TEMPLATE_TOO_LARGE', PRINT_MESSAGES.templateTooLarge)
    const checked = validateTemplate(value)
    const problems: FieldProblem[] = []
    if (!checked.ok) for (const problem of checked.error.problems ?? []) problems.push({ field: templateField(problem.path), message: problem.message })
    else {
      if (checked.template.kind !== kind) problems.push({ field: 'template.kind', message: '라벨 종류를 읽을 수 없어요.' })
      if (splitGraphemes(trimLabelText(checked.template.shopName)).length > SHOP_NAME_MAX) problems.push({ field: 'template.shopName', message: PRINT_MESSAGES.shopNameTooLong })
    }
    if (problems.length > 0 || !checked.ok) return { kind: 'rejected', rejection: rejection(400, 'INVALID_TEMPLATE', PRINT_MESSAGES.templateInvalid, problems) }
    const template = checked.template
    const now = this.#now()
    const saved = await this.#db.transaction(async (tx) => {
      const queue = await lockQueue(tx, sellerId, now)
      if (!queue.labelsEnabled) return 'off' as const
      const row = await readTemplate(tx, sellerId, kind, true)
      const current = row?.version ?? 0
      if (version !== current) return null
      await writeTemplate(tx, sellerId, kind, templateToJson(template), current + 1, now)
      await updateQueue(tx, sellerId, {}, now)
      return current + 1
    })
    if (saved === 'off') return labelsOffRejected()
    if (saved === null) return rejected(409, 'TEMPLATE_CONFLICT', PRINT_MESSAGES.templateConflict)
    if (!this.#closed) this.#options.publish(sellerId, { template: { kind, version: saved } })
    return {
      kind: 'ok',
      value: { template, version: saved, warnings: checked.warnings.map((warning) => ({ field: templateField(warning.path), message: warning.message })), message: PRINT_MESSAGES.templateSaved },
    }
  }

  // ── 라벨 기능 켬/끔 (N4a, L-13 1·2·6·7, D-N4a-01·02) ────────────────────

  /** 지금 켬/끔·바꾼 기록 최근 20줄(새것 먼저)·대기 장 수. 아무것도 쓰지 않는다 (대기열 줄도 만들지 않는다) */
  async labelSettings(sellerId: string): Promise<LabelSettings> {
    const queue = await readQueue(this.#db, sellerId)
    const { waiting } = await queueCounts(this.#db, sellerId)
    const history = await labelSwitchHistory(this.#db, sellerId, LABEL_HISTORY_LIMIT)
    return { enabled: queue?.labelsEnabled ?? true, history: history.map(entryOf), waiting, rev: queue?.rev ?? 0 }
  }

  /**
   * 켬/끔 바꾸기. 판매자 대기열 줄을 잠근 트랜잭션 안에서 지금 값과 비교해, 실제로 바뀔 때만 값을 바꾸고 바꾼 기록 한 줄을 남긴다(같은 값이면 아무것도 없다).
   * 끌 때: 대기·출력 중 작업, 출력 기기, 멈춤을 바꾸지 않는다(L-13 6).
   * 켤 때: 대기 작업이 있고 멈추지 않았거나 끊김 멈춤이면 판매자 멈춤 + 쌓인 라벨("출력 시작"), 손으로 푸는 멈춤이면 그대로, 대기 작업이 없으면 대기열을 바꾸지 않는다(L-13 7).
   * 커밋된 뒤에만 응답·알림(labels, print)이 나간다
   */
  async setLabels(sellerId: string, accountId: string, enabled: boolean): Promise<LabelSettings & { changed: boolean }> {
    const current = await readQueue(this.#db, sellerId)
    // 줄이 없으면 켬이다 — 켜기는 바꿀 것이 없다 (대기열 줄도 만들지 않는다)
    if (current === null && enabled) return { ...(await this.labelSettings(sellerId)), changed: false }
    const now = this.#now()
    const changed = await this.#db.transaction(async (tx) => {
      const queue = await lockQueue(tx, sellerId, now)
      if (queue.labelsEnabled === enabled) return null
      const patch: QueuePatch = { labelsEnabled: enabled }
      if (enabled) {
        const { waiting } = await queueCounts(tx, sellerId)
        if (waiting > 0 && (queue.paused === null || queue.paused === 'DISCONNECTED')) {
          patch.paused = 'SELLER'
          patch.backlog = true
        }
      }
      const rev = await updateQueue(tx, sellerId, patch, now)
      const id = await insertLabelSwitch(tx, sellerId, enabled, accountId, now)
      return { rev, id }
    })
    if (changed === null) return { ...(await this.labelSettings(sellerId)), changed: false }
    const [row] = await labelSwitchHistory(this.#db, sellerId, 1, changed.id)
    if (!this.#closed && row !== undefined) this.#options.publishLabels?.(sellerId, { rev: changed.rev, enabled, entry: entryOf(row) })
    // 대기열 요약(labelsEnabled·켤 때의 멈춤)도 출력 알림 순서대로 알린다
    this.#notify(sellerId, { jobs: [], labels: [] })
    return { ...(await this.labelSettings(sellerId)), changed: true }
  }

  // ── 시험·점검 ─────────────────────────────────────────────────────────────

  /** 지금 상품 라벨 데이터 (그 범위·라벨 키) — 시험이 L-9 계산과 비교할 때 */
  async currentProductData(sellerId: string, date: string, claim: string, version: number): Promise<ProductLabelData | null> {
    const runtime = await this.#options.writer.read(sellerId, date)
    if (runtime.scopeId === null) return null
    const label = await findLabel(this.#db, sellerId, runtime.scopeId, `${claim}@${String(version)}`)
    if (label === null) return null
    return productLabelData(runtime.state, claimIndex(runtime, runtime.state), { claim, version, buyer: parseBuyer(label.buyer) }, this.#amountMissing)
  }
}

/** 출력 기기 비우기 (끊김 멈춤은 다시 연결할 기기가 없으니 푼다) */
function clearDevice(paused: PauseReason | null): QueuePatch {
  return { deviceId: null, deviceName: null, printerConnected: false, releasing: false, ...(paused === 'DISCONNECTED' ? { paused: null } : {}) }
}

const PATH_SEGMENT = /^[A-Za-z][A-Za-z0-9_]{0,40}$/

/** 템플릿 문제의 칸 이름 (받은 키는 영문 칸 이름일 때만 되돌린다 — 번호가 든 키·긴 글자 키는 'template') */
function templateField(path: string): string {
  if (path === '') return 'template'
  const segments = path.split('.')
  return segments.length <= 5 && segments.every((segment) => PATH_SEGMENT.test(segment)) && !containsPhoneRun(path) ? `template.${path}` : 'template'
}

const LOWER = 'abcdefghijklmnopqrstuvwxyz'

/** 서버가 정하는 작업 ID: 접두어 + 영문 소문자 20자 (숫자가 없어 휴대폰 번호 모양이 될 수 없다) */
function newJobId(prefix: 'm' | 'r' | 'p'): string {
  const bytes = randomBytes(20)
  let out = ''
  for (const byte of bytes) out += LOWER[byte % LOWER.length]
  return `${prefix}-${out}`
}
