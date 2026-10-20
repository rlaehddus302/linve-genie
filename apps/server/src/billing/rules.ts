// 요금 순수 함수 넷 (BILLING_RULES BL-2·BL-3·BL-4·BL-6·BL-7·BL-8, N5 — D-N5-01~D-N5-11). 골든: tests/golden/billing/*.json (G-BIL-*).
// - 시계·난수·환경 시간대·Intl·localeCompare를 읽지 않는다(AC-N5-05). "지금"은 인자로 받고, 시각은 UTC 밀리초, 정렬은 시각 다음 ID의 문자 코드 순.
// - 금액은 정수 원이고 소수가 생기는 연산을 하지 않는다(절대 규칙 2).
// - 새 실제 방송 시작(AC-N5-20)·미리 보기와 요금 상태(AC-N5-13)·7일 환불(AC-N5-36)·알림 띠(AC-N5-57 재료)는 모두 billingStatus 하나를 부른다.
//   결제 확인·다시 확인·웹훅(AC-N5-31·32)은 모두 judgePayment 하나를 부른다. 판단을 다시 구현한 곳이 없다.
//   이미 부여된 결제를 결제 조회로 다시 맞추는 일(환불 마무리·환불 중 풀기·밖에서 취소된 결제, RA-N5-01)은 judgeGranted 하나를 부른다.

/** 시간 단위 (밀리초) */
export const HOUR_MS = 60 * 60 * 1000
export const DAY_MS = 24 * HOUR_MS
/** 정액제 한 장 = 30×24시간 (BL-2 1) */
export const FLAT_PERIOD_MS = 30 * DAY_MS
/** 방송 일 창 = 24시간 (BL-4 1.2) */
export const DAY_WINDOW_MS = DAY_MS
/** 7일 환불 기한 = 7×24시간 (BL-7 1) */
export const REFUND_PERIOD_MS = 7 * DAY_MS
/** 알림 띠: 정액제 남은 기간·끝난 뒤 7×24시간 (BL-9 1) */
export const FLAT_NOTICE_MS = 7 * DAY_MS

export const PASS_KINDS = ['FLAT_30D', 'DAYS', 'ORDERS', 'LABELS'] as const
export type PassKind = (typeof PASS_KINDS)[number]
export const QUANTITY_KINDS = ['DAYS', 'ORDERS', 'LABELS'] as const
export type QuantityKind = (typeof QUANTITY_KINDS)[number]
export const GRANT_SOURCES = ['PAYMENT', 'OPERATOR'] as const
export type GrantSource = (typeof GRANT_SOURCES)[number]
/** 방송의 이용 방식 (BL-4 1) */
export const START_MODES = ['FLAT', 'DAY', 'ORDERS'] as const
export type StartMode = (typeof START_MODES)[number]

export const isQuantityKind = (kind: string): kind is QuantityKind => (QUANTITY_KINDS as readonly string[]).includes(kind)

/** 이용권 한 장 (원장의 부여 + 회수 여부) */
export interface LedgerGrant {
  readonly id: string
  readonly kind: PassKind
  /** 정량(DAYS·ORDERS·LABELS)만 1 이상 정수. 정액엔 없다 */
  readonly quantity?: number
  readonly source: GrantSource
  /** 부여 시각 (UTC 밀리초) */
  readonly at: number
  /** 환불로 회수됨 (환불하는 중인 이용권도 회수된 것으로 넘긴다 — 쓰지 않게) */
  readonly revoked?: boolean
}

/** 쓴 기록 (같은 시각에 여럿이면 count) */
export interface LedgerUsage {
  readonly kind: QuantityKind
  readonly at: number
  /** ORDERS·LABELS만 1 이상 정수 (기본 1). DAYS는 늘 1 = 그 시각에 연 24시간 창 */
  readonly count?: number
}

export interface StatusInput {
  readonly grants: readonly LedgerGrant[]
  readonly usage: readonly LedgerUsage[]
  /** 정액 방식으로 시작한 실제 방송의 시작 시각 */
  readonly flatStarts: readonly number[]
  readonly now: number
}

export interface ChainLink {
  readonly grant: string
  readonly from: number
  readonly until: number
}

export interface FlatStatus {
  readonly active: boolean
  /** 이용 중이면 지금 이용권부터 이어진 마지막 끝, 아니면 null */
  readonly until: number | null
  readonly chain: readonly ChainLink[]
}

export type Balances = Readonly<Record<QuantityKind, number>>

export interface DayWindow {
  readonly from: number
  readonly until: number
}

export type StartDecision =
  | { readonly allowed: true; readonly mode: StartMode; readonly useDay: boolean }
  | { readonly allowed: false; readonly reason: 'NO_PASS' }

export interface BillingStatus {
  readonly flat: FlatStatus
  readonly balances: Balances
  readonly window: DayWindow | null
  /** 지금 7일 환불할 수 있는 이용권 ID (부여 시각·ID 순) */
  readonly refundable: readonly string[]
  readonly start: StartDecision
}

/** 문자 코드 순 비교 (localeCompare를 쓰지 않는다) */
export function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** 부여 시각 다음 ID 순 */
const grantOrder = (a: LedgerGrant, b: LedgerGrant): number => a.at - b.at || byCodeUnit(a.id, b.id)

const usageCount = (usage: LedgerUsage): number => (usage.kind === 'DAYS' ? 1 : (usage.count ?? 1))

/** 정액제 기간 사슬 (BL-2 1): 회수되지 않은 정액 이용권을 부여 순으로, 시작 = max(부여, 앞 끝), 끝 = 시작 + 30×24시간 */
export function flatChain(grants: readonly LedgerGrant[]): ChainLink[] {
  const chain: ChainLink[] = []
  let previousEnd: number | null = null
  for (const grant of grants.filter((g) => g.kind === 'FLAT_30D' && g.revoked !== true).sort(grantOrder)) {
    const from: number = previousEnd === null ? grant.at : Math.max(grant.at, previousEnd)
    const until = from + FLAT_PERIOD_MS
    chain.push({ grant: grant.id, from, until })
    previousEnd = until
  }
  return chain
}

/** 요금 상태 (G-BIL status) */
export function billingStatus(input: StatusInput): BillingStatus {
  const { grants, usage, flatStarts, now } = input
  const chain = flatChain(grants)
  // BL-2 2: 이용 중 = 시작 ≤ 지금 < 끝인 이용권. "…까지" = 지금 이용권부터 앞 끝 = 다음 시작으로 이어진 마지막 끝
  const current = chain.findIndex((link) => link.from <= now && now < link.until)
  let until: number | null = null
  if (current >= 0) {
    until = (chain[current] as ChainLink).until
    for (let i = current + 1; i < chain.length && (chain[i] as ChainLink).from === until; i++) until = (chain[i] as ChainLink).until
  }
  const flat: FlatStatus = { active: current >= 0, until, chain }

  // BL-3 1: 잔량 = 회수되지 않은 그 종류 양의 합 − 쓴 수 (음수 = 초과)
  const live = grants.filter((g) => g.revoked !== true)
  const granted = (kind: QuantityKind): number => live.filter((g) => g.kind === kind).reduce((sum, g) => sum + (g.quantity ?? 0), 0)
  const used = (kind: QuantityKind): number => usage.filter((u) => u.kind === kind).reduce((sum, u) => sum + usageCount(u), 0)
  const usedCount: Balances = { DAYS: used('DAYS'), ORDERS: used('ORDERS'), LABELS: used('LABELS') }
  const balances: Balances = {
    DAYS: granted('DAYS') - usedCount.DAYS,
    ORDERS: granted('ORDERS') - usedCount.ORDERS,
    LABELS: granted('LABELS') - usedCount.LABELS,
  }

  // BL-4 1.2: 열린 방송 일 창 = 방송 일 쓴 기록 u 중 u ≤ 지금 < u + 24시간 (겹치지 않지만, 여럿이면 가장 늦게 연 것)
  let window: DayWindow | null = null
  for (const u of usage) {
    if (u.kind !== 'DAYS' || !(u.at <= now && now < u.at + DAY_WINDOW_MS)) continue
    if (window === null || u.at > window.from) window = { from: u.at, until: u.at + DAY_WINDOW_MS }
  }

  // BL-7 1: 7일 환불 = 결제·회수 안 됨·지금 < 부여 + 7×24시간·쓰지 않음
  const refundable: string[] = []
  const ordered = [...live].sort(grantOrder)
  for (const grant of ordered) {
    if (grant.source !== 'PAYMENT' || !(now < grant.at + REFUND_PERIOD_MS)) continue
    if (grant.kind === 'FLAT_30D') {
      // 정액: 그 기간 [시작, 끝)에 정액 방식으로 시작한 실제 방송이 없다
      const link = chain.find((item) => item.grant === grant.id)
      if (link !== undefined && !flatStarts.some((at) => link.from <= at && at < link.until)) refundable.push(grant.id)
    } else if (isQuantityKind(grant.kind)) {
      // 정량: 그 종류 쓴 수 ≤ 앞 용량(앞선 회수 안 된 같은 종류 양의 합)이면 쓰지 않은 것 (BL-3 2)
      const kind = grant.kind
      let before = 0
      for (const other of ordered) {
        if (other === grant) break
        if (other.kind === kind) before += other.quantity ?? 0
      }
      if (usedCount[kind] <= before) refundable.push(grant.id)
    }
  }

  // BL-4 1: 위에서부터 처음 맞는 것. 라벨 장권은 보지 않는다(BL-4 2)
  let start: StartDecision
  if (flat.active) start = { allowed: true, mode: 'FLAT', useDay: false }
  else if (window !== null) start = { allowed: true, mode: 'DAY', useDay: false }
  else if (balances.DAYS >= 1) start = { allowed: true, mode: 'DAY', useDay: true }
  else if (balances.ORDERS >= 1) start = { allowed: true, mode: 'ORDERS', useDay: false }
  else start = { allowed: false, reason: 'NO_PASS' }

  return { flat, balances, window, refundable, start }
}

// ── 알림 띠 (BL-9 1) ─────────────────────────────────────────────────────

export type Banner =
  | { readonly kind: 'FLAT_REMAINING'; readonly days: number; readonly until: number }
  | { readonly kind: 'FLAT_ENDED'; readonly at: number }
  | { readonly kind: 'NO_PASS' }
  | { readonly kind: 'ORDERS_OVER'; readonly count: number }
  | { readonly kind: 'LABELS_OVER'; readonly count: number }

/** 올림 나눗셈 (양의 정수) — 소수 없이 */
function ceilDiv(value: number, unit: number): number {
  const rest = value % unit
  return (value - rest) / unit + (rest > 0 ? 1 : 0)
}

/** 알림 띠 목록 (종류와 숫자·시각만 — 문장은 화면이 만든다). billingStatus의 결과와 지금으로만 정한다 */
export function billingBanners(status: BillingStatus, now: number): Banner[] {
  const banners: Banner[] = []
  const { flat, start, balances } = status
  let flatEnded = false
  if (flat.active && flat.until !== null) {
    const left = flat.until - now
    if (left <= FLAT_NOTICE_MS) banners.push({ kind: 'FLAT_REMAINING', days: ceilDiv(left, DAY_MS), until: flat.until })
  } else if (!flat.active && flat.chain.length > 0) {
    const ended = Math.max(...flat.chain.map((link) => link.until))
    if (ended <= now && now < ended + FLAT_NOTICE_MS && !start.allowed) {
      banners.push({ kind: 'FLAT_ENDED', at: ended })
      flatEnded = true
    }
  }
  if (!flatEnded && !start.allowed) banners.push({ kind: 'NO_PASS' })
  if (balances.ORDERS < 0) banners.push({ kind: 'ORDERS_OVER', count: -balances.ORDERS })
  if (balances.LABELS < 0) banners.push({ kind: 'LABELS_OVER', count: -balances.LABELS })
  return banners
}

// ── 결제 확인 판단 (BL-6 3·4, G-BIL payment) ─────────────────────────────

export const ORDER_STATES = ['PENDING', 'FAILED', 'GRANTED', 'MISMATCH_CANCELLED', 'NEEDS_REVIEW', 'REFUNDED'] as const
export type OrderState = (typeof ORDER_STATES)[number]
export const PAYMENT_ACTIONS = ['GRANT', 'WAIT', 'FAIL', 'CANCEL_MISMATCH', 'REVIEW', 'NONE'] as const
export type PaymentAction = (typeof PAYMENT_ACTIONS)[number]

/** 결제 조회 API로 다시 읽은 결제 (포트원 V2 결제 상태 글자 그대로) */
export interface LookedUpPayment {
  readonly status: string
  readonly amount: number | null
  readonly currency: string | null
  readonly storeId: string | null
  /** CARD · TRANSFER · EASY_PAY · VIRTUAL_ACCOUNT · 그 밖 글자 · null */
  readonly method: string | null
}

export interface PaymentJudgeInput {
  /** 우리 결제 주문 (금액 스냅샷·상태) */
  readonly order: { readonly amount: number; readonly state: OrderState }
  /** 결제 조회 결과 (그 결제가 없으면 null). 화면·웹훅이 보낸 값은 입력이 아니다 */
  readonly payment: LookedUpPayment | null
  /** 우리 상점 ID */
  readonly storeId: string
}

export interface PaymentJudgement {
  readonly action: PaymentAction
  /** 증빙 요청을 만드는지 (GRANT이고 계좌이체일 때만) */
  readonly document: boolean
}

const WAIT_STATUSES: ReadonlySet<string> = new Set(['READY', 'PAY_PENDING', 'VIRTUAL_ACCOUNT_ISSUED'])
const FAIL_STATUSES: ReadonlySet<string> = new Set(['FAILED', 'CANCELLED'])

/** 결제 확인 판단 — 위에서부터 처음 맞는 규칙 (G-BIL-101~121) */
export function judgePayment(input: PaymentJudgeInput): PaymentJudgement {
  const { order, payment, storeId } = input
  const result = (action: PaymentAction, document = false): PaymentJudgement => ({ action, document })
  if (order.state !== 'PENDING' && order.state !== 'FAILED') return result('NONE')
  if (payment === null) return result('WAIT')
  if (payment.storeId !== storeId) return result('REVIEW')
  if (payment.status === 'PAID') {
    if (payment.currency === 'KRW' && payment.amount === order.amount) return result('GRANT', payment.method === 'TRANSFER')
    return result('CANCEL_MISMATCH')
  }
  if (WAIT_STATUSES.has(payment.status)) return result('WAIT')
  if (FAIL_STATUSES.has(payment.status)) return result('FAIL')
  return result('REVIEW')
}

// ── 부여된 결제 다시 맞추기 (RA-N5-01 — BL-7 2 보강, 골든 없음: spec-keeper 확인 대기) ─────────

/**
 * 이미 부여된 결제(GRANTED)를 결제 조회 결과로 다시 맞출 때 할 일.
 * - REFUND: 환불 중인데 결제가 취소돼 있다 → 회수·환불함으로 마무리 (취소는 됐는데 응답이 끊겼거나, 마무리 기록 전에 멈춘 경우)
 * - RELEASE: 환불 중인데 결제가 그대로다(취소가 실제로 안 됐다) → 환불 중 표시만 푼다 (BL-7 2 "아무것도 바꾸지 않고")
 * - KEEP: 아직 모른다(조회 결과 없음·다른 상점·취소를 맡은 요청이 아직 기다리는 중) → 환불 중 그대로 (이용권을 쓰지 않는다)
 * - REVIEW: 우리 환불이 아닌데 결제가 취소됐거나, 부분 취소·모르는 상태 → 확인 필요 (운영자 목록, 자동으로 더 건드리지 않는다)
 * - NONE: 결제 완료 그대로 — 할 일 없음
 */
export const GRANTED_ACTIONS = ['REFUND', 'RELEASE', 'KEEP', 'REVIEW', 'NONE'] as const
export type GrantedAction = (typeof GRANTED_ACTIONS)[number]

export interface GrantedJudgeInput {
  /** 그 주문에 환불 중 표시가 있다 */
  readonly refunding: boolean
  /** 결제 취소를 맡은 환불 요청이 더는 기다리지 않는다 (맡은 기한이 지났거나, 맡은 요청 자신이 취소 시도를 마쳤다) */
  readonly settled: boolean
  /** 결제 조회 결과 (그 결제가 없으면 null) */
  readonly payment: LookedUpPayment | null
  /** 우리 상점 ID */
  readonly storeId: string
}

/** 부여된 결제 다시 맞추기 판단 — 위에서부터 처음 맞는 규칙 */
export function judgeGranted(input: GrantedJudgeInput): GrantedAction {
  const { refunding, settled, payment, storeId } = input
  if (payment === null || payment.storeId !== storeId) return refunding ? 'KEEP' : 'NONE'
  if (payment.status === 'CANCELLED') return refunding ? 'REFUND' : 'REVIEW'
  if (payment.status === 'PAID') {
    if (!refunding) return 'NONE'
    return settled ? 'RELEASE' : 'KEEP'
  }
  return 'REVIEW'
}

// ── 부가세 나누기 (BL-8 4, G-BIL vat) ────────────────────────────────────

/** 공급가액 = 결제 금액 × 10 ÷ 11에 가장 가까운 정수, 세액 = 결제 금액 − 공급가액 (×10÷11의 나머지는 k/11이라 .5가 없다) */
export function splitVat(amount: number): { readonly supply: number; readonly vat: number } {
  if (!Number.isSafeInteger(amount) || amount < 1) throw new RangeError('결제 금액은 1 이상 정수 원이어야 한다')
  const tenfold = amount * 10
  const rest = tenfold % 11
  const floor = (tenfold - rest) / 11
  const supply = rest * 2 > 11 ? floor + 1 : floor
  return { supply, vat: amount - supply }
}

// ── 사업자등록번호 읽기 (BL-8 1, G-BIL bizno) ────────────────────────────

export type BiznoResult = { readonly ok: string } | { readonly error: 'FORMAT' | 'CHECKSUM' }

const BIZNO_WEIGHTS = [1, 3, 7, 1, 3, 7, 1, 3, 5] as const

/** 띄어쓰기(U+0020)와 붙임표(-)만 지우고 반각 숫자 10개·검증 숫자를 확인한다. 맞으면 'XXX-XX-XXXXX' */
export function parseBizno(text: string): BiznoResult {
  let digits = ''
  for (const char of text) {
    if (char === ' ' || char === '-') continue
    digits += char
  }
  if (!/^[0-9]{10}$/.test(digits)) return { error: 'FORMAT' }
  const d = [...digits].map((char) => char.charCodeAt(0) - 48)
  let sum = 0
  BIZNO_WEIGHTS.forEach((weight, i) => {
    sum += (d[i] as number) * weight
  })
  const ninthTimesFive = (d[8] as number) * 5
  sum += (ninthTimesFive - (ninthTimesFive % 10)) / 10
  const check = (10 - (sum % 10)) % 10
  if (check !== d[9]) return { error: 'CHECKSUM' }
  return { ok: `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}` }
}

/** 가린 번호 `123-45-*****` (앞 5자리) */
export function maskBizno(formatted: string): string {
  return `${formatted.slice(0, 6)}-*****`
}
