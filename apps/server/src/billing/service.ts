// 요금 서비스 (BILLING_RULES BL-0~BL-9, D-N5-01~D-N5-14, AC-N5-10~15·20~27·30~41).
// - 판단은 순수 함수 셋(rules.ts billingStatus·judgePayment·judgeGranted)만 한다 — 새 실제 방송 시작·미리 보기·요금 상태·7일 환불·알림 띠는 billingStatus,
//   결제 확인·다시 확인·웹훅은 judgePayment, 이미 부여된 결제를 결제 조회로 다시 맞추는 일은 judgeGranted(RA-N5-01). 여기서는 원장을 읽어 넘기고 결과대로 적는다.
// - 7일 환불은 결제 취소를 요청하기 전에 '환불 중'을 기록한다. 이 표시는 시간이 지나도 저절로 풀리지 않는다 — 결제 조회로 취소됐으면 환불함으로 마무리,
//   그대로면 푼다. 취소 응답이 끊기거나 마무리 기록 전에 멈춰도 그동안 그 이용권으로 방송을 시작하지 않고, 결제 내역·웹훅·다시 환불이 맞춘다(RA-N5-01).
// - 같은 판매자의 요금 쓰기(새 실제 방송 시작·환불·부여·결제 확인·주문 건/라벨 장 쓰기)는 판매자 요금 락(lockBilling)으로 차례로 처리한다.
//   결제 조회·취소(외부 호출)는 트랜잭션 밖에서 하고, 결과를 적는 짧은 트랜잭션만 락을 잡는다(BL-6 7 — 조회가 멈춰도 판매 쓰기가 늦지 않다).
// - 이용권은 판정을 바꾸지 않는다: 엔진 이벤트·상태·효과에 요금 정보를 넣지 않는다(BL-INV-7). 막는 곳은 새 실제 방송 시작 하나(BL-4).
// - 로그에는 정해진 코드만 남긴다(결제 ID·사업자 정보·조회 원문·비밀값 없음).
import { randomBytes } from 'node:crypto'
import { containsPhoneRun, listProducts, type EngineState, type ProductInfo } from '@livejjim/core'
import { hasControlChar, isPlainObject, own, ownKeys } from '../api-fields.ts'
import type { Db } from '../db/database.ts'
import type { FieldProblem } from '../errors.ts'
import { errorKind, type LogSink } from '../log.ts'
import { unknownFieldProblems } from '../messages.ts'
import { openSellerText, sealSellerText } from '../secrets.ts'
import type { Clock } from '../time.ts'
import { WriteAbort, type Rejection, type TxHookContext } from '../writer.ts'
import { DEFAULT_PRICE_TABLE, type PriceItem, type PriceTable } from './config.ts'
import { ISSUED_RECEIPT_KIND, noneIssuer, type DocumentIssuer, type DocumentRecipient, type ReceiptKind } from './documents.ts'
import type { TestPayment } from './fake.ts'
import { PAYMENT_ID_RE, checkWebhook, type LookupResult, type PaymentGateway } from './portone.ts'
import {
  DAY_WINDOW_MS,
  PASS_KINDS,
  billingBanners,
  billingStatus,
  byCodeUnit,
  isQuantityKind,
  judgeGranted,
  judgePayment,
  maskBizno,
  parseBizno,
  splitVat,
  type BillingStatus,
  type LedgerGrant,
  type LedgerUsage,
  type LookedUpPayment,
  type OrderState,
  type PassKind,
  type PaymentAction,
  type StartMode,
  type StatusInput,
} from './rules.ts'
import {
  broadcastsWithMode,
  documentOf,
  documentsOf,
  findBillingRequest,
  findOrder,
  flatStartTimes,
  grantOfPayment,
  grantRows,
  insertBillingRequest,
  insertDocument,
  insertGrant,
  insertMode,
  insertOrder,
  insertRevocation,
  insertUsage,
  lockBilling,
  modeOf,
  orderByRequest,
  orderSeller,
  ordersOf,
  readBusiness,
  refundingOrders,
  updateDocument,
  updateOrder,
  upsertBusiness,
  usageRows,
  usageSummary,
  type GrantRow,
  type OrderRow,
  type UsageRow,
} from './store.ts'

/** 요금 설정 (서버 기동이 정한다 — 운영: productionServerOptions, 시험: testBilling) */
export interface BillingSetup {
  /** 요금 기능 스위치 (기본 꺼짐 — 꺼지면 막지도 세지도 않고 요금 경로가 없다, BL-0 7) */
  readonly enabled: boolean
  readonly prices: PriceTable
  /** 우리 상점 ID (결제 확인 판단의 storeId) */
  readonly storeId: string
  readonly gateway: PaymentGateway
  readonly issuer: DocumentIssuer
  /** 포트원 웹훅 비밀값 (서버에만) */
  readonly webhookSecret: string
  /** 화면이 받는 공개 값 — 운영 결제일 때만 (시험 결제면 null) */
  readonly publicKeys: { readonly storeId: string; readonly channelKey: string } | null
  /** 시험 결제 (가짜 결제 서버·가짜 발행기 조작). 운영 구성에는 없다 */
  readonly test: TestPayment | null
}

const unavailableGateway: PaymentGateway = {
  lookup: () => Promise.resolve({ kind: 'error' }),
  cancel: () => Promise.resolve({ kind: 'error' }),
}

/** 요금 기능 꺼짐 (기본) */
export const DISABLED_BILLING: BillingSetup = {
  enabled: false,
  prices: DEFAULT_PRICE_TABLE,
  storeId: '',
  gateway: unavailableGateway,
  issuer: noneIssuer,
  webhookSecret: '',
  publicKeys: null,
  test: null,
}

/** 화면 문장 (BL-4 1.5, BL-9 4 — 따옴표로 정한 그대로) */
export const BILLING_MESSAGES = {
  noPass: '이용권이 없어 실제 방송을 시작할 수 없어요. 요금 화면에서 이용권을 산 뒤 다시 시작해 주세요. 리허설은 언제든 할 수 있어요.',
  wait: "결제를 확인하는 중이에요. 잠시 뒤 '다시 확인'을 눌러 주세요.",
  failed: '결제가 되지 않았어요. 돈은 나가지 않았어요.',
  mismatch: '결제 금액이 주문과 달라 결제를 취소했어요. 다시 시도해 주세요.',
  review: '결제를 자동으로 확인하지 못했어요. 운영자가 확인해요.',
  lookupFailed: "결제를 확인하지 못했어요. 잠시 뒤 '다시 확인'을 눌러 주세요.",
  businessRequired: '결제 전에 사업자 정보를 적어 주세요.',
  itemUnavailable: '지금 살 수 없는 이용권이에요.',
  termsRequired: '이용권 약관과 환불 규정을 읽었다고 체크해 주세요.',
  refunded: '환불했어요. 결제 수단으로 돌려드려요.',
  refundRefused: '이 이용권은 환불할 수 없어요. 결제한 지 7일이 지났거나 이미 쓰기 시작했어요.',
  refundFailed: '환불하지 못했어요. 잠시 뒤 다시 해 주세요.',
  refundBusy: '환불을 처리하는 중이에요. 잠시 뒤 결제 내역을 확인해 주세요.',
  biznoFormat: '사업자등록번호는 숫자 10자리로 적어 주세요.',
  biznoChecksum: '사업자등록번호를 다시 확인해 주세요.',
} as const

/** 마지막 글자에 받침이 있으면 '을', 없으면 '를' (한글이 아니면 '을(를)') */
export function objectParticle(word: string): string {
  const last = word.trim().at(-1)
  if (last === undefined) return '을(를)'
  const code = last.charCodeAt(0)
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 === 0 ? '를' : '을'
  if (/[0-9]/.test(last)) return '을(를)'
  return '을(를)'
}

export const grantedMessage = (itemName: string): string => `결제했어요. ${itemName}${objectParticle(itemName)} 받았어요.`

/**
 * 환불 요청이 결제 취소를 맡는 기한 (결제 취소·결제 조회 시간 제한의 합보다 길게). 그동안 다른 환불 요청은 '처리하는 중'이고 다른 맞추기는 환불 중을 풀지 않는다.
 * 기한이 지나도 환불 중 표시는 남는다 — 결제 조회로 맞춘 뒤에만 마무리하거나 푼다(RA-N5-01)
 */
export const REFUND_HOLD_MS = 60_000
/** 결제 내역을 열 때 결제 조회로 맞추는 멈춘 환불 수 (응답이 늦어지지 않게) */
export const REFUND_SETTLE_MAX = 3
/** 결제 내역·쓴 내역 개수 (1~100) */
export const BILLING_LIST_MAX = 100
export const BILLING_LIST_DEFAULT = 50
/** 사업자 정보 길이 (BL-8 1) */
export const BUSINESS_NAME_MAX = 50
export const BUSINESS_CEO_MAX = 30
export const BUSINESS_EMAIL_MAX = 100
/** 운영자 부여 사유 길이 (AC-N5-12) */
export const GRANT_REASON_MAX = 200

/** 사업자 정보 암호화 쓰임새 (AAD) */
export const BUSINESS_PURPOSE = 'billing-business'

const rejection = (status: number, code: Rejection['code'], message: string, problems: readonly FieldProblem[] = []): Rejection => ({ status, code, message, problems })
const charCount = (value: string): number => [...value].length
const iso = (ms: number): string => new Date(ms).toISOString()

export type BillingOutcome<T> = { readonly kind: 'ok'; readonly value: T } | { readonly kind: 'rejected'; readonly rejection: Rejection } | { readonly kind: 'not_found' }

/** 요금 실시간 알림 까닭 (주문 건·라벨 장 쓰기는 알리지 않는다, AC-N5-13) */
export type BillingNotice = 'grant' | 'revoke' | 'order' | 'start' | 'business'

export interface BillingServiceOptions {
  readonly db: Db
  readonly setup: BillingSetup
  readonly clock: Clock
  readonly masterKey: Buffer
  readonly log: LogSink
  /** 실시간 알림 (event: billing) */
  readonly publish: (sellerId: string, data: Readonly<Record<string, unknown>>) => void
  /** 범위 상태 (쓴 내역의 지금 상품 번호·품종) */
  readonly readState: (sellerId: string, date: string) => Promise<EngineState>
}

// ── 화면에 내는 모양 ─────────────────────────────────────────────────────

export type StartPreview =
  | { readonly allowed: false; readonly reason: 'NO_PASS' }
  | {
      readonly allowed: true
      readonly mode: StartMode
      /** 방송 일 1을 새로 쓰는지 */
      readonly useDay: boolean
      /** FLAT: 정액제 이어진 끝 */
      readonly flatUntil: string | null
      /** DAY(열린 창): 창 끝 */
      readonly windowUntil: string | null
      /** DAY(새로 씀): 남은 일 → 뒤 */
      readonly days: { readonly before: number; readonly after: number } | null
      /** ORDERS: 남은 건 */
      readonly orders: number | null
    }

export type BannerView =
  | { readonly kind: 'FLAT_REMAINING'; readonly days: number; readonly until: string }
  | { readonly kind: 'FLAT_ENDED'; readonly at: string }
  | { readonly kind: 'NO_PASS' }
  | { readonly kind: 'ORDERS_OVER'; readonly count: number }
  | { readonly kind: 'LABELS_OVER'; readonly count: number }

export interface BusinessView {
  /** `123-45-*****` */
  readonly masked: string
  readonly name: string | null
  readonly ceo: string | null
  readonly email: string | null
  /** 늘 `CASH_RECEIPT` (BL-8 6, D-PL1-07 — 저장값이 옛 `TAX_INVOICE`여도) */
  readonly receiptKind: ReceiptKind
  /** 결제할 수 있게 다 적었는지 (상호·대표자 이름까지) */
  readonly complete: boolean
}

export interface BillingStatusView {
  readonly now: string
  readonly flat: {
    readonly active: boolean
    readonly until: string | null
    /** 끝난 정액제의 마지막 끝 (이용 중이 아니고 사슬이 있을 때) */
    readonly endedAt: string | null
    readonly chain: readonly { readonly grant: string; readonly from: string; readonly until: string }[]
  }
  readonly balances: { readonly DAYS: number; readonly ORDERS: number; readonly LABELS: number }
  readonly window: { readonly from: string; readonly until: string } | null
  readonly start: StartPreview
  readonly banners: readonly BannerView[]
  readonly items: readonly { readonly id: string; readonly name: string; readonly kind: PassKind; readonly quantity: number | null; readonly price: number }[]
  readonly business: BusinessView | null
  readonly testPayment: boolean
}

export interface OrderCreated {
  readonly paymentId: string
  readonly orderName: string
  readonly amount: number
  readonly currency: 'KRW'
  readonly method: 'CARD' | 'TRANSFER'
  readonly itemId: string
  readonly kind: PassKind
  readonly quantity: number | null
  readonly testPayment: boolean
  /** 운영 결제 창의 공개 값 (시험 결제면 null) */
  readonly storeId: string | null
  readonly channelKey: string | null
}

export type ConfirmResult = PaymentAction | 'LOOKUP_FAILED'

export interface ConfirmView {
  readonly paymentId: string
  readonly result: ConfirmResult
  readonly state: OrderState
  readonly message: string
  readonly itemName: string
  readonly amount: number
}

export interface DocumentView {
  readonly kind: ReceiptKind
  readonly status: 'PENDING' | 'ISSUED' | 'FAILED'
  readonly approval: string | null
  readonly cancel: 'REQUESTED' | 'CANCELLED' | 'FAILED' | null
}

export type PaymentItem =
  | {
      readonly type: 'order'
      readonly paymentId: string
      readonly itemId: string
      readonly itemName: string
      readonly kind: PassKind
      readonly quantity: number | null
      readonly amount: number
      readonly method: 'CARD' | 'TRANSFER'
      readonly paidMethod: string | null
      readonly state: OrderState
      readonly createdAt: string
      readonly grantedAt: string | null
      readonly refundedAt: string | null
      /** 지금 7일 환불할 수 있는지 (그 순간의 G-BIL refundable) */
      readonly refundable: boolean
      /** 환불하는 중 */
      readonly refunding: boolean
      readonly document: DocumentView | null
    }
  | {
      readonly type: 'operator'
      readonly grantId: string
      readonly kind: PassKind
      readonly quantity: number | null
      readonly reason: string
      readonly at: string
      readonly revoked: boolean
    }

export interface UsageItem {
  readonly id: number
  readonly kind: 'DAYS' | 'ORDERS' | 'LABELS'
  readonly at: string
  readonly broadcast: { readonly id: string; readonly title: string; readonly date: string } | null
  /** ORDERS: 지금 번호(없으면 쓸 때 번호) · LABELS: 라벨의 번호 */
  readonly productNo: number | null
  /** ORDERS: 지금 품종 */
  readonly productName: string | null
  /** DAYS: 24시간 창 끝 */
  readonly windowUntil: string | null
}

export interface ListPage<T> {
  readonly items: readonly T[]
  /** 다음 쪽 기준 (없으면 null) */
  readonly next: string | null
}

/** 이어 받기 기준 `<시각 밀리초>.<ID>` */
const CURSOR_RE = /^(\d{1,15})\.([A-Za-z0-9]{1,64})$/

export function parseCursor(raw: string | undefined): { at: number; id: string } | null | 'bad' {
  if (raw === undefined || raw === '') return null
  const match = CURSOR_RE.exec(raw)
  if (match === null) return 'bad'
  return { at: Number(match[1]), id: match[2] as string }
}

const newId = (prefix: string): string => `${prefix}${randomBytes(16).toString('hex')}`

/** 정량 이용권 종류 → 쓴 기록 종류 */
const isOrderState = (state: string): state is OrderState => ['PENDING', 'FAILED', 'GRANTED', 'MISMATCH_CANCELLED', 'NEEDS_REVIEW', 'REFUNDED'].includes(state)

/** 주문 상태 → BL-9 4 문장 */
export function stateMessage(state: OrderState, itemName: string): string {
  switch (state) {
    case 'GRANTED':
      return grantedMessage(itemName)
    case 'PENDING':
      return BILLING_MESSAGES.wait
    case 'FAILED':
      return BILLING_MESSAGES.failed
    case 'MISMATCH_CANCELLED':
      return BILLING_MESSAGES.mismatch
    case 'NEEDS_REVIEW':
      return BILLING_MESSAGES.review
    case 'REFUNDED':
      return BILLING_MESSAGES.refunded
  }
}

/** 환불함 응답 (처음 결과로 저장한다) */
export interface RefundView {
  readonly paymentId: string
  readonly state: OrderState
  readonly message: string
}

const refundedView = (paymentId: string): RefundView => ({ paymentId, state: 'REFUNDED', message: BILLING_MESSAGES.refunded })

/**
 * 부여된 결제를 결제 조회로 다시 맞춘 결과 (RA-N5-01)
 * REFUNDED 환불함(이번에 마무리했거나 이미 환불함) · RELEASED 환불 중을 풀었다(취소가 실제로 안 됐다) · KEPT 환불 중 그대로(아직 모른다)
 * · REVIEW 확인 필요로 올렸다 · IN_REVIEW 이미 확인 필요였다(취소를 맡은 요청에게만) · NONE 할 일 없음 · LOOKUP_FAILED 결제 조회 실패(아무것도 바꾸지 않았다)
 */
type Settled = 'REFUNDED' | 'RELEASED' | 'KEPT' | 'REVIEW' | 'IN_REVIEW' | 'NONE' | 'LOOKUP_FAILED'

/** 결제 취소를 맡은 환불 요청의 응답 (맞춘 결과마다) */
function refundOutcome(paymentId: string, settled: Settled): BillingOutcome<RefundView> {
  switch (settled) {
    case 'REFUNDED':
      return { kind: 'ok', value: refundedView(paymentId) }
    case 'RELEASED':
    case 'NONE':
      // 결제가 그대로다 — 아무것도 바꾸지 않았다 (BL-7 2)
      return { kind: 'rejected', rejection: rejection(502, 'REFUND_FAILED', BILLING_MESSAGES.refundFailed) }
    case 'REVIEW':
    case 'IN_REVIEW':
      return { kind: 'rejected', rejection: rejection(409, 'REFUND_IN_PROGRESS', BILLING_MESSAGES.review) }
    case 'KEPT':
    case 'LOOKUP_FAILED':
      // 취소가 됐는지 아직 모른다 — 환불 중 그대로(그 이용권은 쓰지 않는다). 결제 내역·웹훅·다시 환불이 결제 조회로 맞춘다
      return { kind: 'rejected', rejection: rejection(409, 'REFUND_IN_PROGRESS', BILLING_MESSAGES.refundBusy) }
  }
}

/** 원장 → 순수 함수 입력. holdIgnore = 이 결제의 환불 중 표시는 보지 않는다(환불 판단 자신) */
export function ledgerInput(grants: readonly GrantRow[], usage: { days: readonly Date[]; orders: number; labels: number }, flatStarts: readonly Date[], now: number, holdIgnore: string | null = null): StatusInput {
  const ledgerGrants: LedgerGrant[] = grants.map((grant) => {
    // 환불 중 표시는 시간이 지나도 저절로 풀지 않는다 — 결제가 취소됐는지 결제 조회로 확인하기 전까지 쓰지 않는다 (RA-N5-01)
    const held = grant.refundHoldUntil !== null && grant.paymentId !== holdIgnore
    return {
      id: grant.id,
      kind: grant.kind,
      ...(grant.quantity === null ? {} : { quantity: grant.quantity }),
      source: grant.source,
      at: grant.at.getTime(),
      // 환불하는 중인 이용권도 회수된 것으로 넘긴다 — 쓰지 않게 (BL-7 4)
      revoked: grant.revoked || held,
    }
  })
  const ledgerUsage: LedgerUsage[] = usage.days.map((at) => ({ kind: 'DAYS', at: at.getTime() }))
  if (usage.orders > 0) ledgerUsage.push({ kind: 'ORDERS', at: 0, count: usage.orders })
  if (usage.labels > 0) ledgerUsage.push({ kind: 'LABELS', at: 0, count: usage.labels })
  return { grants: ledgerGrants, usage: ledgerUsage, flatStarts: flatStarts.map((at) => at.getTime()), now }
}

export class BillingService {
  readonly #options: BillingServiceOptions
  /** 범위마다 확정 횟수를 이미 셈한(또는 셀 일이 없는) 주문 건 방식 상품 ID — 다음 쓰기에서 다시 보지 않는다 */
  readonly #counted = new Map<string, Set<string>>()

  constructor(options: BillingServiceOptions) {
    this.#options = options
  }

  get enabled(): boolean {
    return this.#options.setup.enabled
  }

  get setup(): BillingSetup {
    return this.#options.setup
  }

  get #db(): Db {
    return this.#options.db
  }

  /** 서버 시각 (UTC 밀리초) */
  now(): number {
    return this.#options.clock.now()
  }

  #publish(sellerId: string, reason: BillingNotice): void {
    try {
      this.#options.publish(sellerId, { reason })
    } catch (error) {
      this.#options.log({ level: 'warn', code: 'STREAM_FAILED', errorKind: errorKind(error) })
    }
  }

  /** 원장을 읽어 순수 함수 입력을 만든다 */
  async #input(db: Db, sellerId: string, now: number, holdIgnore: string | null = null): Promise<{ input: StatusInput; grants: GrantRow[] }> {
    const grants = await grantRows(db, sellerId)
    const usage = await usageSummary(db, sellerId)
    const flat = await flatStartTimes(db, sellerId)
    return { input: ledgerInput(grants, usage, flat, now, holdIgnore), grants }
  }

  // ── 요금 상태 (AC-N5-13) ─────────────────────────────────────────────

  /** 그 순간 서버 시각의 요금 상태·미리 보기·알림 띠·요금 표·사업자 정보. 아무것도 기록하지 않는다 */
  async status(sellerId: string): Promise<BillingStatusView> {
    const now = this.#options.clock.now()
    const { input } = await this.#input(this.#db, sellerId, now)
    const status = billingStatus(input)
    return {
      now: iso(now),
      flat: {
        active: status.flat.active,
        until: status.flat.until === null ? null : iso(status.flat.until),
        endedAt: !status.flat.active && status.flat.chain.length > 0 ? iso(Math.max(...status.flat.chain.map((link) => link.until))) : null,
        chain: status.flat.chain.map((link) => ({ grant: link.grant, from: iso(link.from), until: iso(link.until) })),
      },
      balances: { ...status.balances },
      window: status.window === null ? null : { from: iso(status.window.from), until: iso(status.window.until) },
      start: startPreview(status),
      banners: billingBanners(status, now).map(bannerView),
      items: this.#options.setup.prices.items.filter((item) => item.onSale).map((item) => ({ id: item.id, name: item.name, kind: item.kind, quantity: item.quantity, price: item.price })),
      business: await this.#businessView(this.#db, sellerId),
      testPayment: this.#options.setup.test !== null,
    }
  }

  async #businessView(db: Db, sellerId: string): Promise<BusinessView | null> {
    const row = await readBusiness(db, sellerId)
    if (row === null) return null
    const info = this.#openBusiness(sellerId, row.sealed)
    if (info === null) return null
    return {
      masked: row.masked,
      name: info.name,
      ceo: info.ceo,
      email: info.email,
      // 저장값(옛 `TAX_INVOICE` 포함)과 상관없이 현금영수증으로 읽는다 — 저장값은 고쳐 쓰지 않는다 (BL-8 6, D-PL1-07)
      receiptKind: ISSUED_RECEIPT_KIND,
      complete: info.name !== null && info.ceo !== null,
    }
  }

  #openBusiness(sellerId: string, sealed: string): { businessNumber: string; name: string | null; ceo: string | null; email: string | null } | null {
    try {
      const parsed = JSON.parse(openSellerText(this.#options.masterKey, BUSINESS_PURPOSE, sellerId, sealed)) as Record<string, unknown>
      const text = (key: string) => (typeof parsed[key] === 'string' ? (parsed[key] as string) : null)
      const businessNumber = text('businessNumber')
      return businessNumber === null ? null : { businessNumber, name: text('name'), ceo: text('ceo'), email: text('email') }
    } catch (error) {
      this.#options.log({ level: 'error', code: 'BILLING_FAILED', errorKind: errorKind(error) })
      return null
    }
  }

  // ── 새 실제 방송 시작 (AC-N5-20) — 기록 경로의 같은 트랜잭션 ───────────

  /**
   * 새 실제 방송의 이용 방식을 정하고 적는다 (엔진 broadcast.start·방송 행과 같은 트랜잭션). 이용권이 없으면 WriteAbort(422 NO_PASS)로
   * 트랜잭션 전체를 되돌린다 — 아무것도 기록하지 않는다(BL-4 1.5). 판단은 그 순간 서버 시각으로 billingStatus 하나가 한다
   */
  async decideStart(tx: Db, input: { sellerId: string; scopeId: string; broadcastId: string; date: string; now: Date }): Promise<{ mode: StartMode; usedDay: boolean }> {
    const { sellerId, scopeId, broadcastId, date, now } = input
    await lockBilling(tx, sellerId)
    const { input: ledger } = await this.#input(tx, sellerId, now.getTime())
    const status = billingStatus(ledger)
    if (!status.start.allowed) throw new WriteAbort({ kind: 'rejected', rejection: rejection(422, 'NO_PASS', BILLING_MESSAGES.noPass) })
    const { mode, useDay } = status.start
    await insertMode(tx, { broadcastId, sellerId, scopeId, mode, usedDay: useDay, at: now })
    if (useDay) {
      await insertUsage(tx, [{ sellerId, kind: 'DAYS', key: `DAYS:${broadcastId}`, at: now, broadcastId, date, productId: null, productNo: null, jobId: null }])
    }
    return { mode, usedDay: useDay }
  }

  /** 시작 뒤 알림 (커밋된 뒤 부른다) */
  started(sellerId: string): void {
    this.#publish(sellerId, 'start')
  }

  /** 방송의 이용 방식 (방송 만들기 응답 — 이용 방식이 없는 방송이면 null) */
  modeOf(sellerId: string, broadcastId: string): Promise<{ mode: StartMode; usedDay: boolean } | null> {
    return modeOf(this.#db, sellerId, broadcastId)
  }

  // ── 주문 건 쓰기 (AC-N5-23) — 기록 경로의 같은 트랜잭션 ──────────────────

  /**
   * 이벤트 기록과 같은 트랜잭션에서 부른다. 주문 건 방식 방송의 상품이 처음으로 1등을 얻으면(코어 확정 횟수 0 → 1 이상) 주문 건 1을 적는다.
   * 키 = 주문 건:범위 날짜:상품 ID. 리허설·요금 기능 꺼짐·상품 칸이 그대로인 기록은 아무것도 하지 않는다
   */
  readonly txHook = async (tx: Db, ctx: TxHookContext): Promise<(() => void) | null> => {
    if (!this.enabled || ctx.rehearsal) return null
    const final = ctx.states.at(-1)
    if (final === undefined || final.slots === ctx.before.slots) return null
    const orders = await broadcastsWithMode(tx, ctx.sellerId, ctx.scopeId, ['ORDERS'])
    if (orders.size === 0) return null
    const counted = this.#countedOf(ctx.scopeId)
    const candidates = listProducts(final).filter((product) => orders.has(product.broadcast) && product.confirmVersion >= 1 && !counted.has(product.id))
    if (candidates.length === 0) return null
    const before = new Map(listProducts(ctx.before).map((product) => [product.id, product.confirmVersion]))
    const fresh: ProductInfo[] = []
    for (const product of candidates) {
      // 이 기록 전에 이미 1등이 있었던 상품은 그때 셌다(또는 셀 일이 없었다)
      if ((before.get(product.id) ?? 0) >= 1) counted.add(product.id)
      else fresh.push(product)
    }
    if (fresh.length === 0) return null
    await lockBilling(tx, ctx.sellerId)
    await insertUsage(
      tx,
      fresh.map((product) => ({
        sellerId: ctx.sellerId,
        kind: 'ORDERS' as const,
        key: `ORDERS:${ctx.date}:${product.id}`,
        at: ctx.now,
        broadcastId: product.broadcast,
        date: ctx.date,
        productId: product.id,
        productNo: product.no,
        jobId: null,
      })),
    )
    return () => {
      for (const product of fresh) counted.add(product.id)
    }
  }

  #countedOf(scopeId: string): Set<string> {
    let set = this.#counted.get(scopeId)
    if (set === undefined) {
      set = new Set()
      this.#counted.set(scopeId, set)
      // 범위 수 상한 (오래 넣은 것부터 버린다 — 버려도 다음 쓰기에서 이전 상태와 비교해 다시 정한다)
      if (this.#counted.size > 64) this.#counted.delete(this.#counted.keys().next().value as string)
    }
    return set
  }

  // ── 라벨 장 쓰기 (AC-N5-24) — 출력함을 적는 같은 트랜잭션 ──────────────

  /**
   * 상품 라벨 작업이 출력함이 될 때 (PrintService가 같은 트랜잭션에서 부른다). 그 라벨의 방송이 정량 방식(DAY·ORDERS)이면 라벨 장 1 (키 = 작업).
   * 정액·이용 방식이 없는 방송·요금 기능 꺼짐은 아무것도 하지 않는다. 막지 않는다(잔량이 0 아래로 내려가도)
   */
  readonly onLabelPrinted = async (tx: Db, info: { sellerId: string; date: string; jobId: string; broadcast: string | null; no: number | null; now: Date }): Promise<void> => {
    if (!this.enabled || info.broadcast === null) return
    const mode = await modeOf(tx, info.sellerId, info.broadcast)
    if (mode === null || mode.mode === 'FLAT') return
    await lockBilling(tx, info.sellerId)
    await insertUsage(tx, [
      {
        sellerId: info.sellerId,
        kind: 'LABELS',
        key: `LABELS:${info.date}:${info.jobId}`,
        at: info.now,
        broadcastId: info.broadcast,
        date: info.date,
        productId: null,
        productNo: info.no,
        jobId: info.jobId,
      },
    ])
  }

  // ── 결제 주문 만들기 (AC-N5-30) ──────────────────────────────────────

  async createOrder(sellerId: string, requestId: string, body: Record<string, unknown>): Promise<BillingOutcome<OrderCreated>> {
    const prior = await orderByRequest(this.#db, sellerId, requestId)
    if (prior !== null) return { kind: 'ok', value: this.#created(prior) }
    const extra = ownKeys(body).filter((key) => !['requestId', 'itemId', 'method', 'agreed'].includes(key))
    if (extra.length > 0) return { kind: 'rejected', rejection: rejection(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', unknownFieldProblems(extra)) }
    const itemId = own(body, 'itemId')
    const method = own(body, 'method')
    const agreed = own(body, 'agreed')
    const problems: FieldProblem[] = []
    if (typeof itemId !== 'string' || itemId.length > 64) problems.push({ field: 'itemId', message: '살 이용권을 골라 주세요.' })
    if (method !== 'CARD' && method !== 'TRANSFER') problems.push({ field: 'method', message: '결제 수단은 카드나 계좌이체로 골라 주세요.' })
    if (problems.length > 0) return { kind: 'rejected', rejection: rejection(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', problems) }
    if (agreed !== true) return { kind: 'rejected', rejection: rejection(400, 'TERMS_REQUIRED', BILLING_MESSAGES.termsRequired, [{ field: 'agreed', message: BILLING_MESSAGES.termsRequired }]) }
    const item: PriceItem | undefined = this.#options.setup.prices.items.find((candidate) => candidate.id === itemId && candidate.onSale)
    if (item === undefined) return { kind: 'rejected', rejection: rejection(409, 'ITEM_UNAVAILABLE', BILLING_MESSAGES.itemUnavailable) }
    const business = await this.#businessView(this.#db, sellerId)
    if (business === null || !business.complete) return { kind: 'rejected', rejection: rejection(409, 'BUSINESS_REQUIRED', BILLING_MESSAGES.businessRequired) }
    const now = new Date(this.#options.clock.now())
    const paymentId = newId('lj')
    try {
      await insertOrder(this.#db, {
        paymentId,
        sellerId,
        requestId,
        itemId: item.id,
        itemName: item.name,
        kind: item.kind,
        quantity: item.quantity,
        // 그 순간 요금 표 가격의 스냅샷 (BL-6 1)
        amount: item.price,
        method: method as 'CARD' | 'TRANSFER',
        state: 'PENDING',
        paidMethod: null,
        createdAt: now,
        updatedAt: now,
        grantedAt: null,
        refundHoldUntil: null,
        refundedAt: null,
      })
    } catch (error) {
      // 같은 요청 번호가 동시에 왔다 — 처음 주문
      const again = await orderByRequest(this.#db, sellerId, requestId)
      if (again !== null) return { kind: 'ok', value: this.#created(again) }
      throw error
    }
    this.#publish(sellerId, 'order')
    const created = await findOrder(this.#db, sellerId, paymentId)
    return { kind: 'ok', value: this.#created(created as OrderRow) }
  }

  #created(order: OrderRow): OrderCreated {
    const keys = this.#options.setup.publicKeys
    return {
      paymentId: order.paymentId,
      orderName: order.itemName,
      amount: order.amount,
      currency: 'KRW',
      method: order.method === 'TRANSFER' ? 'TRANSFER' : 'CARD',
      itemId: order.itemId,
      kind: order.kind as PassKind,
      quantity: order.quantity,
      testPayment: this.#options.setup.test !== null,
      storeId: keys?.storeId ?? null,
      channelKey: keys?.channelKey ?? null,
    }
  }

  // ── 결제 확인 (AC-N5-31·33·34·35) ─────────────────────────────────────

  /**
   * 결제 확인·다시 확인·웹훅이 모두 부른다. 결제 조회 API로 다시 읽은 결과만 judgePayment에 넘긴다(화면·웹훅이 보낸 금액·상태는 입력이 아니다).
   * 조회는 트랜잭션 밖. 결과를 적을 때 그 판매자의 요금 락 안에서 주문 상태를 다시 읽고 판단한다 — 동시에 여러 번 와도 부여는 하나(BL-INV-1).
   * 이미 부여된 결제는 결제 조회로 다시 맞춘다(judgeGranted — 멈춘 환불의 마무리·풀기, 밖에서 취소된 결제는 확인 필요, RA-N5-01)
   */
  async confirm(sellerId: string, paymentId: string): Promise<BillingOutcome<ConfirmView>> {
    return (await this.#confirm(sellerId, paymentId)).outcome
  }

  /** retry = 결제 조회가 실패해 나중에 다시 해야 한다 (웹훅은 503 — 포트원이 다시 보낸다) */
  async #confirm(sellerId: string, paymentId: string): Promise<{ outcome: BillingOutcome<ConfirmView>; retry: boolean }> {
    if (!PAYMENT_ID_RE.test(paymentId)) return { outcome: { kind: 'not_found' }, retry: false }
    const order = await findOrder(this.#db, sellerId, paymentId)
    if (order === null) return { outcome: { kind: 'not_found' }, retry: false }
    if (order.state === 'GRANTED') {
      const settled = await this.#settle(sellerId, paymentId, null)
      const current = (await findOrder(this.#db, sellerId, paymentId)) as OrderRow
      // 부여된 결제의 조회 실패는 판매자에게 알리지 않는다(결제 완료 그대로) — 웹훅만 다시 받는다
      return { outcome: { kind: 'ok', value: this.#confirmView(current, settled === 'REVIEW' ? 'REVIEW' : 'NONE') }, retry: settled === 'LOOKUP_FAILED' }
    }
    if (order.state !== 'PENDING' && order.state !== 'FAILED') return { outcome: { kind: 'ok', value: this.#confirmView(order, 'NONE') }, retry: false }
    const looked = await this.#lookup(paymentId)
    if (looked.kind === 'error') {
      return { outcome: { kind: 'ok', value: { ...this.#confirmView(order, 'LOOKUP_FAILED'), message: BILLING_MESSAGES.lookupFailed } }, retry: true }
    }
    const payment = looked.kind === 'found' ? looked.payment : null
    const now = new Date(this.#options.clock.now())
    const judged = await this.#db.transaction(async (tx) => {
      await lockBilling(tx, sellerId)
      const current = await findOrder(tx, sellerId, paymentId, true)
      if (current === null || !isOrderState(current.state)) return { action: 'NONE' as PaymentAction, document: false }
      const judgement = judgePayment({ order: { amount: current.amount, state: current.state }, payment, storeId: this.#options.setup.storeId })
      switch (judgement.action) {
        case 'GRANT': {
          await insertGrant(tx, {
            id: newId('g'),
            sellerId,
            kind: current.kind as PassKind,
            quantity: current.quantity,
            source: 'PAYMENT',
            paymentId,
            reason: null,
            at: now,
          })
          await updateOrder(tx, sellerId, paymentId, { state: 'GRANTED', grantedAt: now, paidMethod: payment?.method ?? null }, now)
          if (judgement.document) {
            const business = await readBusiness(tx, sellerId)
            const { supply, vat } = splitVat(current.amount)
            await insertDocument(tx, {
              sellerId,
              paymentId,
              // 새 증빙 요청은 늘 현금영수증(지출증빙) — 사업자 정보에 옛 `TAX_INVOICE`가 저장돼 있어도 (BL-8 3·6, D-PL1-07)
              kind: ISSUED_RECEIPT_KIND,
              // 받는 쪽 = 그 순간 사업자 정보 (암호화한 그대로 — 나중에 바꿔도 이 요청은 그대로)
              recipientSealed: business?.sealed ?? sealSellerText(this.#options.masterKey, BUSINESS_PURPOSE, sellerId, '{}'),
              amount: current.amount,
              supply,
              vat,
              status: 'PENDING',
              approval: null,
              cancel: null,
              createdAt: now,
              updatedAt: now,
            })
          }
          break
        }
        case 'FAIL':
          if (current.state === 'PENDING') await updateOrder(tx, sellerId, paymentId, { state: 'FAILED' }, now)
          break
        case 'CANCEL_MISMATCH':
        case 'REVIEW':
          // 금액 불일치는 취소를 요청하기 전에 확인 필요로 잡아 둔다 — 다시 확인·웹훅이 취소를 두 번 요청하지 않는다(취소가 끝나면 금액이 달라 취소함)
          await updateOrder(tx, sellerId, paymentId, { state: 'NEEDS_REVIEW' }, now)
          break
        case 'WAIT':
        case 'NONE':
          break
      }
      return judgement
    })
    if (judged.action === 'CANCEL_MISMATCH') await this.#cancelMismatch(sellerId, paymentId)
    if (judged.action === 'GRANT' && judged.document) await this.#issue(sellerId, paymentId)
    if (judged.action === 'GRANT') this.#publish(sellerId, 'grant')
    else if (judged.action !== 'WAIT' && judged.action !== 'NONE') this.#publish(sellerId, 'order')
    const after = (await findOrder(this.#db, sellerId, paymentId)) as OrderRow
    return { outcome: { kind: 'ok', value: this.#confirmView(after, judged.action) }, retry: false }
  }

  /** 결제 조회 (실패는 'error' — 어댑터가 던져도 같다) */
  async #lookup(paymentId: string): Promise<LookupResult> {
    try {
      const looked = await this.#options.setup.gateway.lookup(paymentId)
      if (looked.kind === 'error') this.#options.log({ level: 'warn', code: 'PAYMENT_LOOKUP_FAILED' })
      return looked
    } catch (error) {
      this.#options.log({ level: 'warn', code: 'PAYMENT_LOOKUP_FAILED', errorKind: errorKind(error) })
      return { kind: 'error' }
    }
  }

  /**
   * 전액 결제 취소 요청. true = 취소됨. false = 모른다 — 실패·시간 초과·연결 끊김·'이미 취소됨' 응답 모두(취소는 됐는데 응답만 끊겼을 수 있다).
   * false면 부른 쪽이 결제 조회로 확인한다(RA-N5-01)
   */
  async #cancel(paymentId: string, reason: string): Promise<boolean> {
    try {
      const result = await this.#options.setup.gateway.cancel(paymentId, reason)
      if (result.kind === 'ok') return true
      if (result.kind === 'error') this.#options.log({ level: 'warn', code: 'PAYMENT_CANCEL_FAILED' })
    } catch (error) {
      this.#options.log({ level: 'warn', code: 'PAYMENT_CANCEL_FAILED', errorKind: errorKind(error) })
    }
    return false
  }

  /**
   * 부여된 결제(GRANTED)를 결제 조회로 다시 맞춘다 (RA-N5-01, judgeGranted). 조회는 트랜잭션 밖, 적는 것은 요금 락 안에서 주문을 다시 읽고 한다.
   * owner = 결제 취소를 맡은 환불 요청(그 요청 번호로 처음 결과를 남긴다). cancelled = 그 요청의 취소가 성공했다(조회 없이 취소됨으로 본다)
   */
  async #settle(sellerId: string, paymentId: string, owner: { readonly requestId: string } | null, cancelled = false): Promise<Settled> {
    const { storeId } = this.#options.setup
    const looked: LookupResult = cancelled
      ? { kind: 'found', payment: { status: 'CANCELLED', amount: null, currency: null, storeId, method: null } satisfies LookedUpPayment }
      : await this.#lookup(paymentId)
    const now = new Date(this.#options.clock.now())
    const result = await this.#db.transaction(async (tx): Promise<{ settled: Settled; document: boolean }> => {
      await lockBilling(tx, sellerId)
      const current = await findOrder(tx, sellerId, paymentId, true)
      if (current === null) return { settled: 'NONE', document: false }
      if (current.state === 'REFUNDED') {
        // 다른 맞추기(웹훅·결제 내역)가 먼저 마무리했다 — 취소를 맡은 요청의 결과도 환불함
        if (owner !== null) await insertBillingRequest(tx, { sellerId, requestId: owner.requestId, kind: 'refund', result: JSON.stringify(refundedView(paymentId)), createdAt: now })
        return { settled: owner === null ? 'NONE' : 'REFUNDED', document: false }
      }
      // 다른 맞추기(웹훅)가 먼저 확인 필요로 올렸다 — 취소를 맡은 요청에도 "운영자가 확인해요"(이미 올렸으니 다시 알리지 않는다)
      if (current.state === 'NEEDS_REVIEW' && owner !== null) return { settled: 'IN_REVIEW', document: false }
      if (current.state !== 'GRANTED') return { settled: 'NONE', document: false }
      const hold = current.refundHoldUntil
      if (looked.kind === 'error') {
        // 모른다 — 환불 중이면 그대로 둔다. 맡은 요청은 기한을 지금으로 당겨 다음 맞추기(결제 내역·웹훅·다시 환불)가 바로 할 수 있게 한다
        if (hold !== null && owner !== null) await updateOrder(tx, sellerId, paymentId, { refundHoldUntil: now }, now)
        return { settled: 'LOOKUP_FAILED', document: false }
      }
      const action = judgeGranted({
        refunding: hold !== null,
        settled: owner !== null || (hold !== null && hold.getTime() <= now.getTime()),
        payment: looked.kind === 'found' ? looked.payment : null,
        storeId,
      })
      switch (action) {
        case 'REFUND':
          return { settled: 'REFUNDED', document: await this.#finishRefund(tx, sellerId, paymentId, owner?.requestId ?? null, now) }
        case 'RELEASE':
          await updateOrder(tx, sellerId, paymentId, { refundHoldUntil: null }, now)
          return { settled: 'RELEASED', document: false }
        case 'KEEP':
          if (owner !== null) await updateOrder(tx, sellerId, paymentId, { refundHoldUntil: now }, now)
          return { settled: 'KEPT', document: false }
        case 'REVIEW':
          // 환불 중 표시는 그대로 둔다(환불 중이었으면 그 이용권은 계속 쓰지 않는다). 운영자 목록에 보인다
          await updateOrder(tx, sellerId, paymentId, { state: 'NEEDS_REVIEW' }, now)
          return { settled: 'REVIEW', document: false }
        case 'NONE':
          return { settled: 'NONE', document: false }
      }
    })
    if (result.settled === 'REFUNDED' && result.document) await this.#cancelDocument(sellerId, paymentId)
    if (result.settled === 'REFUNDED') this.#publish(sellerId, 'revoke')
    else if (result.settled === 'RELEASED' || result.settled === 'REVIEW') this.#publish(sellerId, 'order')
    if (result.settled === 'REVIEW') this.#options.log({ level: 'warn', code: 'PAYMENT_REVIEW' })
    return result.settled
  }

  /** 환불 마무리 (요금 락 안): 회수 기록·주문 환불함·환불 중 지움·증빙 취소 요청·처음 결과. 증빙 요청이 있었는지 돌려준다 */
  async #finishRefund(tx: Db, sellerId: string, paymentId: string, requestId: string | null, at: Date): Promise<boolean> {
    const grant = await grantOfPayment(tx, sellerId, paymentId)
    if (grant !== null) await insertRevocation(tx, { sellerId, grantId: grant.id, reason: 'REFUND', at })
    await updateOrder(tx, sellerId, paymentId, { state: 'REFUNDED', refundedAt: at, refundHoldUntil: null }, at)
    const doc = await documentOf(tx, sellerId, paymentId)
    if (doc !== null) await updateDocument(tx, sellerId, paymentId, { cancel: 'REQUESTED' }, at)
    if (requestId !== null) await insertBillingRequest(tx, { sellerId, requestId, kind: 'refund', result: JSON.stringify(refundedView(paymentId)), createdAt: at })
    return doc !== null
  }

  #confirmView(order: OrderRow, result: ConfirmResult): ConfirmView {
    const state = isOrderState(order.state) ? order.state : 'NEEDS_REVIEW'
    return { paymentId: order.paymentId, result, state, message: stateMessage(state, order.itemName), itemName: order.itemName, amount: order.amount }
  }

  /** 금액이 다른 결제의 전액 취소 (BL-6 4). 성공하면 금액이 달라 취소함, 실패하면 확인 필요로 둔다 */
  async #cancelMismatch(sellerId: string, paymentId: string): Promise<void> {
    let cancelled = await this.#cancel(paymentId, '결제 금액 불일치')
    if (!cancelled) {
      // 취소는 됐는데 응답만 끊겼을 수 있다 — 결제 조회로 확인한다 (RA-N5-01)
      const looked = await this.#lookup(paymentId)
      cancelled = looked.kind === 'found' && looked.payment.status === 'CANCELLED'
    }
    if (!cancelled) {
      this.#options.log({ level: 'warn', code: 'PAYMENT_CANCEL_FAILED' })
      return
    }
    const now = new Date(this.#options.clock.now())
    await this.#db.transaction(async (tx) => {
      await lockBilling(tx, sellerId)
      const current = await findOrder(tx, sellerId, paymentId, true)
      if (current?.state === 'NEEDS_REVIEW') await updateOrder(tx, sellerId, paymentId, { state: 'MISMATCH_CANCELLED' }, now)
    })
  }

  /** 증빙 발행 (발행기 실패는 발행 실패로 남고 결제·이용권은 그대로) */
  async #issue(sellerId: string, paymentId: string): Promise<void> {
    const doc = await documentOf(this.#db, sellerId, paymentId)
    if (doc === null || doc.status !== 'PENDING') return
    const recipient = this.#recipient(sellerId, doc.recipientSealed)
    let status: 'ISSUED' | 'PENDING' | 'FAILED' = 'FAILED'
    let approval: string | null = null
    try {
      const result = await this.#options.setup.issuer.issue({ paymentId, kind: doc.kind as ReceiptKind, amount: doc.amount, supply: doc.supply, vat: doc.vat, recipient })
      status = result.status
      if (result.status === 'ISSUED') approval = result.approval
    } catch (error) {
      this.#options.log({ level: 'warn', code: 'DOCUMENT_FAILED', errorKind: errorKind(error) })
    }
    if (status === 'PENDING') return
    const now = new Date(this.#options.clock.now())
    await updateDocument(this.#db, sellerId, paymentId, { status, approval }, now)
  }

  #recipient(sellerId: string, sealed: string): DocumentRecipient {
    const info = this.#openBusiness(sellerId, sealed)
    return { businessNumber: info?.businessNumber ?? '', name: info?.name ?? '', ceo: info?.ceo ?? '', email: info?.email ?? null }
  }

  // ── 웹훅 (AC-N5-32) ──────────────────────────────────────────────────

  /**
   * 포트원 V2 웹훅. 서명·보낸 시각(±5분)·본문 형식이 맞을 때만 결제 ID를 꺼내 결제 확인과 같은 일을 한다(본문의 금액·상태·상점은 쓰지 않는다).
   * 틀리면 400(아무것도 기록하지 않고 조회도 하지 않는다). 모르는 결제 ID는 200(있는지 알리지 않는다). 조회 실패는 503(포트원이 다시 보낸다).
   * 이미 부여된 결제의 웹훅(취소 알림 등)도 결제 조회로 다시 맞춘다 — 멈춘 환불의 마무리, 밖에서 취소된 결제는 확인 필요(RA-N5-01)
   */
  async webhook(headers: { get(name: string): string | null }, body: string): Promise<200 | 400 | 503> {
    const checked = checkWebhook(this.#options.setup.webhookSecret, headers, body, this.#options.clock.now())
    if (!checked.ok) return 400
    if (checked.paymentId === null || !PAYMENT_ID_RE.test(checked.paymentId)) return 200
    const sellerId = await orderSeller(this.#db, checked.paymentId)
    if (sellerId === null) return 200
    const { retry } = await this.#confirm(sellerId, checked.paymentId)
    return retry ? 503 : 200
  }

  // ── 7일 환불 (AC-N5-36, RA-N5-01) ─────────────────────────────────────

  /**
   * 7일 환불 (BL-7 2). 1) 그 순간 다시 판단하고 '환불 중'을 기록한다 — 그 이용권은 이제 쓰지 않고, 시간이 지나도 저절로 풀리지 않는다.
   * 2) 전액 결제 취소(트랜잭션 밖). 3) 취소됐으면 한 트랜잭션에서 회수·환불함·증빙 취소 요청.
   * 취소 결과가 실패·시간 초과·연결 끊김·'이미 취소됨'이면 결제 조회로 확인한다 — 취소돼 있으면 3, 결제가 그대로면 환불 중만 풀고 "환불하지 못했어요"
   * (아무것도 바뀌지 않음), 조회도 안 되면 환불 중 그대로 "환불을 처리하는 중이에요"(결제 내역·웹훅·다시 환불이 결제 조회로 맞춘다).
   * 앞선 환불이 결과를 남기지 못하고 멈췄으면(결제 취소를 맡은 기한이 지남) 이 요청이 맡아 결제 조회로 먼저 맞춘다
   */
  async refund(sellerId: string, requestId: string, paymentId: string): Promise<BillingOutcome<RefundView>> {
    const prior = await findBillingRequest(this.#db, sellerId, requestId)
    if (prior !== null) return { kind: 'ok', value: JSON.parse(prior.result) as RefundView }
    if (!PAYMENT_ID_RE.test(paymentId)) return { kind: 'not_found' }
    if ((await findOrder(this.#db, sellerId, paymentId)) === null) return { kind: 'not_found' }
    const owner = { requestId }
    for (let round = 0; round < 2; round += 1) {
      const now = this.#options.clock.now()
      // 1. 그 순간 다시 판단하고(billingStatus refundable) 환불 중으로 잡는다 — 요금 락으로 새 방송 시작과 차례로 (BL-7 4)
      const step = await this.#db.transaction(async (tx): Promise<'refused' | 'busy' | 'held' | 'stale'> => {
        await lockBilling(tx, sellerId)
        const current = await findOrder(tx, sellerId, paymentId, true)
        if (current === null || current.state !== 'GRANTED') return 'refused'
        const lease = new Date(now + REFUND_HOLD_MS)
        if (current.refundHoldUntil !== null) {
          if (current.refundHoldUntil.getTime() > now) return 'busy'
          // 앞선 환불이 결과를 남기지 못했다 — 이 요청이 맡는다(다른 요청은 '처리하는 중')
          await updateOrder(tx, sellerId, paymentId, { refundHoldUntil: lease }, new Date(now))
          return 'stale'
        }
        const grant = await grantOfPayment(tx, sellerId, paymentId)
        if (grant === null) return 'refused'
        const { input } = await this.#input(tx, sellerId, now, paymentId)
        if (!billingStatus(input).refundable.includes(grant.id)) return 'refused'
        await updateOrder(tx, sellerId, paymentId, { refundHoldUntil: lease }, new Date(now))
        return 'held'
      })
      if (step === 'refused') return { kind: 'rejected', rejection: rejection(409, 'REFUND_NOT_ALLOWED', BILLING_MESSAGES.refundRefused) }
      if (step === 'busy') return { kind: 'rejected', rejection: rejection(409, 'REFUND_IN_PROGRESS', BILLING_MESSAGES.refundBusy) }
      if (step === 'stale') {
        // 앞선 취소가 실제로 됐는지 먼저 맞춘다. 안 됐으면(환불 중을 풀었으면) 처음부터 다시 판단한다
        const settled = await this.#settle(sellerId, paymentId, owner)
        if (settled === 'RELEASED' && round === 0) continue
        return refundOutcome(paymentId, settled)
      }
      this.#publish(sellerId, 'order')
      // 2. 전액 결제 취소 (트랜잭션 밖) → 3. 결과를 적는다 (취소됐으면 마무리, 모르면 결제 조회로 확인)
      const cancelled = await this.#cancel(paymentId, '7일 환불')
      return refundOutcome(paymentId, await this.#settle(sellerId, paymentId, owner, cancelled))
    }
    return { kind: 'rejected', rejection: rejection(409, 'REFUND_IN_PROGRESS', BILLING_MESSAGES.refundBusy) }
  }

  async #cancelDocument(sellerId: string, paymentId: string): Promise<void> {
    const doc = await documentOf(this.#db, sellerId, paymentId)
    if (doc === null || doc.cancel !== 'REQUESTED') return
    let cancel: 'CANCELLED' | 'REQUESTED' | 'FAILED' = 'FAILED'
    try {
      const result = await this.#options.setup.issuer.cancel({
        paymentId,
        kind: doc.kind as ReceiptKind,
        amount: doc.amount,
        supply: doc.supply,
        vat: doc.vat,
        recipient: this.#recipient(sellerId, doc.recipientSealed),
        approval: doc.approval,
      })
      cancel = result.cancel
    } catch (error) {
      this.#options.log({ level: 'warn', code: 'DOCUMENT_FAILED', errorKind: errorKind(error) })
    }
    if (cancel === 'REQUESTED') return
    await updateDocument(this.#db, sellerId, paymentId, { cancel }, new Date(this.#options.clock.now()))
  }

  // ── 사업자 정보 (AC-N5-37) ───────────────────────────────────────────

  async saveBusiness(sellerId: string, body: Record<string, unknown>): Promise<BillingOutcome<BusinessView>> {
    const extra = ownKeys(body).filter((key) => !['requestId', 'businessNumber', 'name', 'ceo', 'email', 'receiptKind'].includes(key))
    if (extra.length > 0) return { kind: 'rejected', rejection: rejection(400, 'UNKNOWN_FIELD', '받을 수 없는 항목이 있어요.', unknownFieldProblems(extra)) }
    const checked = checkBusiness(body)
    // 증빙 종류 칸이 틀리면 422 (BL-8 6, D-PL1-07 — AC-PL1B-01 (c)·(d)), 그 밖의 칸만 틀리면 지금처럼 400
    if (!checked.ok) {
      const status = checked.problems.some((problem) => problem.field === 'receiptKind') ? 422 : 400
      return { kind: 'rejected', rejection: rejection(status, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.', checked.problems) }
    }
    const { businessNumber, name, ceo, email, receiptKind } = checked.value
    const now = new Date(this.#options.clock.now())
    await this.#db.transaction(async (tx) => {
      await lockBilling(tx, sellerId)
      await upsertBusiness(tx, {
        sellerId,
        sealed: sealSellerText(this.#options.masterKey, BUSINESS_PURPOSE, sellerId, JSON.stringify({ businessNumber, name, ceo, email })),
        masked: maskBizno(businessNumber),
        receiptKind,
        updatedAt: now,
      })
    })
    this.#publish(sellerId, 'business')
    return { kind: 'ok', value: (await this.#businessView(this.#db, sellerId)) as BusinessView }
  }

  // ── 결제 내역·쓴 내역 (AC-N5-14) ──────────────────────────────────────

  async payments(sellerId: string, cursor: { at: number; id: string } | null, limit: number): Promise<ListPage<PaymentItem>> {
    if (cursor === null) await this.#settleStale(sellerId)
    const now = this.#options.clock.now()
    const { input, grants } = await this.#input(this.#db, sellerId, now)
    const refundable = new Set(billingStatus(input).refundable)
    const grantByPayment = new Map(grants.filter((grant) => grant.paymentId !== null).map((grant) => [grant.paymentId as string, grant.id]))
    const docs = new Map((await documentsOf(this.#db, sellerId)).map((doc) => [doc.paymentId, doc]))
    const entries: { at: number; id: string; item: PaymentItem }[] = []
    for (const order of await ordersOf(this.#db, sellerId)) {
      const doc = docs.get(order.paymentId)
      const grantId = grantByPayment.get(order.paymentId)
      const state = isOrderState(order.state) ? order.state : 'NEEDS_REVIEW'
      entries.push({
        at: order.createdAt.getTime(),
        id: order.paymentId,
        item: {
          type: 'order',
          paymentId: order.paymentId,
          itemId: order.itemId,
          itemName: order.itemName,
          kind: order.kind as PassKind,
          quantity: order.quantity,
          amount: order.amount,
          method: order.method === 'TRANSFER' ? 'TRANSFER' : 'CARD',
          paidMethod: order.paidMethod,
          state,
          createdAt: order.createdAt.toISOString(),
          grantedAt: order.grantedAt?.toISOString() ?? null,
          refundedAt: order.refundedAt?.toISOString() ?? null,
          refundable: state === 'GRANTED' && grantId !== undefined && refundable.has(grantId),
          refunding: state === 'GRANTED' && order.refundHoldUntil !== null,
          document:
            doc === undefined
              ? null
              : {
                  kind: doc.kind as ReceiptKind,
                  status: doc.status as DocumentView['status'],
                  approval: doc.approval,
                  cancel: doc.cancel as DocumentView['cancel'],
                },
        },
      })
    }
    for (const grant of grants) {
      if (grant.source !== 'OPERATOR') continue
      entries.push({
        at: grant.at.getTime(),
        id: grant.id,
        item: { type: 'operator', grantId: grant.id, kind: grant.kind, quantity: grant.quantity, reason: grant.reason ?? '', at: grant.at.toISOString(), revoked: grant.revoked },
      })
    }
    entries.sort((a, b) => b.at - a.at || byCodeUnit(b.id, a.id))
    const after = cursor === null ? entries : entries.filter((entry) => entry.at < cursor.at || (entry.at === cursor.at && byCodeUnit(entry.id, cursor.id) < 0))
    const page = after.slice(0, limit)
    const last = page.at(-1)
    return { items: page.map((entry) => entry.item), next: after.length > limit && last !== undefined ? `${String(last.at)}.${last.id}` : null }
  }

  /**
   * 결과를 남기지 못하고 멈춘 환불(결제 취소를 맡은 기한이 지난 환불 중)을 결제 조회로 맞춘다 — 많아야 REFUND_SETTLE_MAX건 (RA-N5-01).
   * 결제 조회는 한꺼번에 해서 결제 내역이 늦어져도 조회 시간 제한 한 번만큼이다(적는 것은 요금 락으로 차례로)
   */
  async #settleStale(sellerId: string): Promise<void> {
    const now = this.#options.clock.now()
    const stale = (await refundingOrders(this.#db, sellerId)).filter((order) => order.refundHoldUntil !== null && order.refundHoldUntil.getTime() <= now)
    await Promise.all(
      stale.slice(0, REFUND_SETTLE_MAX).map(async (order) => {
        try {
          await this.#settle(sellerId, order.paymentId, null)
        } catch (error) {
          // 맞추지 못해도 내역은 보인다(환불 중 그대로)
          this.#options.log({ level: 'warn', code: 'BILLING_FAILED', errorKind: errorKind(error) })
        }
      }),
    )
  }

  async usage(sellerId: string, cursor: { at: number; id: string } | null, limit: number): Promise<ListPage<UsageItem>> {
    if (cursor !== null && !/^\d{1,15}$/.test(cursor.id)) return { items: [], next: null }
    const rows: UsageRow[] = await usageRows(this.#db, sellerId, cursor === null ? null : { at: new Date(cursor.at), id: Number(cursor.id) }, limit + 1)
    const page = rows.slice(0, limit)
    const products = new Map<string, Map<string, ProductInfo>>()
    for (const date of new Set(page.filter((row) => row.kind === 'ORDERS' && row.date !== null).map((row) => row.date as string))) {
      try {
        products.set(date, new Map(listProducts(await this.#options.readState(sellerId, date)).map((product) => [product.id, product])))
      } catch (error) {
        this.#options.log({ level: 'warn', code: 'BILLING_FAILED', date, errorKind: errorKind(error) })
      }
    }
    const items = page.map((row): UsageItem => {
      const product = row.kind === 'ORDERS' && row.date !== null && row.productId !== null ? products.get(row.date)?.get(row.productId) : undefined
      return {
        id: row.id,
        kind: row.kind,
        at: row.at.toISOString(),
        broadcast: row.broadcastId === null || row.broadcastTitle === null || row.broadcastDate === null ? null : { id: row.broadcastId, title: row.broadcastTitle, date: row.broadcastDate },
        productNo: product?.no ?? row.productNo,
        productName: row.kind === 'ORDERS' ? (product?.name ?? null) : null,
        windowUntil: row.kind === 'DAYS' ? iso(row.at.getTime() + DAY_WINDOW_MS) : null,
      }
    })
    const last = page.at(-1)
    return { items, next: rows.length > limit && last !== undefined ? `${String(last.at.getTime())}.${String(last.id)}` : null }
  }

  // ── 운영자·시험 부여 (AC-N5-12·40) ────────────────────────────────────

  /** 운영자 이용권 부여 (명령마다 새 이용권 — 같은 명령을 두 번 실행하면 두 장) */
  async grantByOperator(sellerId: string, input: { kind: PassKind; quantity: number | null; reason: string; at?: number }): Promise<string> {
    const id = await operatorGrant(this.#db, sellerId, input, this.#options.clock.now())
    this.#publish(sellerId, 'grant')
    return id
  }

  /** 시험 웹훅: 가짜 결제 서버가 서명한 웹훅을 이 서버의 웹훅 처리에 그대로 넣는다 */
  async testWebhook(paymentId: string): Promise<200 | 400 | 503> {
    const test = this.#options.setup.test
    if (test === null) return 400
    const { signedWebhook } = await import('./fake.ts')
    const signed = signedWebhook(test.webhookSecret, paymentId, this.#options.clock.now())
    return this.webhook(new Headers(signed.headers), signed.body)
  }

  /** 시험: 그 판매자의 주문 (가짜 결제 서버 조작에 금액을 쓴다) */
  order(sellerId: string, paymentId: string): Promise<OrderRow | null> {
    return PAYMENT_ID_RE.test(paymentId) ? findOrder(this.#db, sellerId, paymentId) : Promise.resolve(null)
  }
}

/** 운영자 부여 검사: 종류·양(정량 1~100,000, 정액은 없음)·사유(1~200자, 휴대폰 번호 거절 — D-079) */
export function checkOperatorGrant(input: { kind: unknown; quantity: unknown; reason: unknown }): { ok: true; kind: PassKind; quantity: number | null; reason: string } | { ok: false; message: string } {
  const { kind, quantity, reason } = input
  if (typeof kind !== 'string' || !(PASS_KINDS as readonly string[]).includes(kind)) return { ok: false, message: '종류는 FLAT_30D·DAYS·ORDERS·LABELS 중 하나로 적어 주세요.' }
  let amount: number | null = null
  if (isQuantityKind(kind)) {
    if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100_000) return { ok: false, message: '양은 1부터 100,000까지의 정수로 적어 주세요.' }
    amount = quantity
  } else if (quantity !== undefined && quantity !== null) return { ok: false, message: '정액제에는 양을 적지 않아요.' }
  if (typeof reason !== 'string' || reason.trim() === '' || charCount(reason.trim()) > GRANT_REASON_MAX || hasControlChar(reason)) return { ok: false, message: '사유는 1~200자로 적어 주세요.' }
  if (containsPhoneRun(reason)) return { ok: false, message: '사유에 휴대폰 번호를 적지 않아요.' }
  return { ok: true, kind: kind as PassKind, quantity: amount, reason: reason.trim() }
}

/** 운영자 이용권 한 장 덧붙이기 (요금 락 안). 부여 시각 = 기록 시각(시험은 at을 과거로) */
export async function operatorGrant(db: Db, sellerId: string, input: { kind: PassKind; quantity: number | null; reason: string; at?: number }, now: number): Promise<string> {
  const id = newId('g')
  await db.transaction(async (tx) => {
    await lockBilling(tx, sellerId)
    await insertGrant(tx, { id, sellerId, kind: input.kind, quantity: input.quantity, source: 'OPERATOR', paymentId: null, reason: input.reason, at: new Date(input.at ?? now) })
  })
  return id
}

/** 사업자 정보 저장의 `TAX_INVOICE` 거절 문장 (BL-8 6, D-PL1-07) */
export const BUSINESS_TAX_INVOICE_MESSAGE = '세금계산서는 지금은 발급할 수 없어요. 현금영수증(지출증빙)으로 발행해요.'
/** 사업자 정보 저장의 모르는 증빙 종류 문장 (N5 그대로 — AC-PL1B-01 (d)) */
export const BUSINESS_RECEIPT_KIND_MESSAGE = '계좌이체 증빙은 세금계산서나 현금영수증 중에서 골라 주세요.'

/** 사업자 정보 검사 (BL-8 1·6, G-BIL bizno) */
export function checkBusiness(body: Record<string, unknown>):
  | { ok: true; value: { businessNumber: string; name: string; ceo: string; email: string | null; receiptKind: ReceiptKind } }
  | { ok: false; problems: FieldProblem[] } {
  const problems: FieldProblem[] = []
  const number = own(body, 'businessNumber')
  const name = own(body, 'name')
  const ceo = own(body, 'ceo')
  const email = own(body, 'email')
  const receiptKind = own(body, 'receiptKind')
  let businessNumber = ''
  if (typeof number !== 'string' || number.length > 64) problems.push({ field: 'businessNumber', message: BILLING_MESSAGES.biznoFormat })
  else {
    const parsed = parseBizno(number)
    if ('error' in parsed) problems.push({ field: 'businessNumber', message: parsed.error === 'FORMAT' ? BILLING_MESSAGES.biznoFormat : BILLING_MESSAGES.biznoChecksum })
    else businessNumber = parsed.ok
  }
  const text = (value: unknown, max: number): string | null => {
    if (typeof value !== 'string' || hasControlChar(value)) return null
    const trimmed = value.trim()
    return trimmed === '' || charCount(trimmed) > max ? null : trimmed
  }
  const shop = text(name, BUSINESS_NAME_MAX)
  if (shop === null) problems.push({ field: 'name', message: '상호는 1~50자로 적어 주세요.' })
  const owner = text(ceo, BUSINESS_CEO_MAX)
  if (owner === null) problems.push({ field: 'ceo', message: '대표자 이름은 1~30자로 적어 주세요.' })
  let mail: string | null = null
  if (email !== undefined && email !== null && email !== '') {
    const trimmed = typeof email === 'string' ? email.trim() : null
    if (trimmed === null || hasControlChar(trimmed) || trimmed.length > BUSINESS_EMAIL_MAX || !/^[^\s@]+@[^\s@]+$/.test(trimmed)) {
      problems.push({ field: 'email', message: '이메일은 이름@도메인 모양으로 100자 이하로 적어 주세요.' })
    } else mail = trimmed
  }
  // 받는 값: 적지 않음 · `CASH_RECEIPT`. `TAX_INVOICE`는 지금 발급할 수 없다고 거절한다 (BL-8 6, D-PL1-07)
  if (receiptKind === 'TAX_INVOICE') problems.push({ field: 'receiptKind', message: BUSINESS_TAX_INVOICE_MESSAGE })
  else if (receiptKind !== undefined && receiptKind !== ISSUED_RECEIPT_KIND) problems.push({ field: 'receiptKind', message: BUSINESS_RECEIPT_KIND_MESSAGE })
  if (problems.length > 0 || shop === null || owner === null) return { ok: false, problems }
  return { ok: true, value: { businessNumber, name: shop, ceo: owner, email: mail, receiptKind: ISSUED_RECEIPT_KIND } }
}

function startPreview(status: BillingStatus): StartPreview {
  const { start, flat, window, balances } = status
  if (!start.allowed) return { allowed: false, reason: 'NO_PASS' }
  return {
    allowed: true,
    mode: start.mode,
    useDay: start.useDay,
    flatUntil: start.mode === 'FLAT' && flat.until !== null ? iso(flat.until) : null,
    windowUntil: start.mode === 'DAY' && !start.useDay && window !== null ? iso(window.until) : null,
    days: start.mode === 'DAY' && start.useDay ? { before: balances.DAYS, after: balances.DAYS - 1 } : null,
    orders: start.mode === 'ORDERS' ? balances.ORDERS : null,
  }
}

function bannerView(banner: ReturnType<typeof billingBanners>[number]): BannerView {
  switch (banner.kind) {
    case 'FLAT_REMAINING':
      return { kind: banner.kind, days: banner.days, until: iso(banner.until) }
    case 'FLAT_ENDED':
      return { kind: banner.kind, at: iso(banner.at) }
    case 'NO_PASS':
      return { kind: 'NO_PASS' }
    case 'ORDERS_OVER':
    case 'LABELS_OVER':
      return { kind: banner.kind, count: banner.count }
  }
}

/** 사업자등록번호를 받는 계정 명령용: 번호만 담은 사업자 정보 (상호·대표자는 화면에서 적는다) */
export function sealedBusinessNumber(masterKey: Buffer, sellerId: string, formatted: string): { sealed: string; masked: string } {
  return { sealed: sealSellerText(masterKey, BUSINESS_PURPOSE, sellerId, JSON.stringify({ businessNumber: formatted, name: null, ceo: null, email: null })), masked: maskBizno(formatted) }
}

/** 받은 값이 JSON 객체인지 (요금 경로 공통) */
export const isBody = isPlainObject
