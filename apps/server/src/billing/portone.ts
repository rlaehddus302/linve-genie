// 결제 어댑터 (BILLING_RULES BL-6, D-N5-08, AC-N5-40). 포트원 V2 하나(PG 채널 토스페이먼츠).
// - 결제 조회: GET {base}/payments/{결제 ID}?storeId={상점 ID}, 머리말 `Authorization: PortOne {API 비밀값}`.
//   응답 칸 status·amount.total·currency·storeId·method.type을 G-BIL payment 입력(LookedUpPayment)으로 옮긴다.
//   모르는 상태 글자·수단은 그대로 넘긴다(판단이 REVIEW로 정한다). 404 PAYMENT_NOT_FOUND = 그 결제 없음(기다림).
//   시간 초과·5xx·이상한 응답은 'error' — 판단을 짐작하지 않는다(BL-6 7).
// - 전액 취소: POST {base}/payments/{결제 ID}/cancel, 본문 { storeId, reason } (금액 없음 = 전액), 머리말 `Idempotency-Key`(PAY2, BL-6 10).
// - 시간 한도 (PAY2, D-PAY-09): 결제 조회(읽기만) 10초, 상태를 바꾸는 요청(결제 취소·현금영수증 발급·취소) 60초. 넘기면 'error'(결과 모름).
// - 웹훅 서명: 포트원 V2 웹훅은 Standard Webhooks 방식 — 머리말 webhook-id·webhook-timestamp(초)·webhook-signature(`v1,<base64>` 여럿, 띄어쓰기로 나눔),
//   서명 = base64(HMAC-SHA256(비밀값, `${id}.${timestamp}.${본문}`)), 비밀값은 `whsec_` 뒤의 base64를 푼 바이트. 보낸 시각이 지금 ±5분 안이어야 한다.
// 비밀값은 오류·로그·응답에 넣지 않는다. 결제 조회 원문도 로그에 남기지 않는다.
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { LookedUpPayment } from './rules.ts'

export type LookupResult = { readonly kind: 'found'; readonly payment: LookedUpPayment } | { readonly kind: 'missing' } | { readonly kind: 'error' }
/** 'already' = 이미 취소된 결제 (조회로 다시 확인한다) */
export type CancelResult = { readonly kind: 'ok' } | { readonly kind: 'already' } | { readonly kind: 'error' }

/** 결제 어댑터 (결제 조회·전액 취소). 시험은 가짜 포트원 서버를 쓴다 */
export interface PaymentGateway {
  lookup(paymentId: string): Promise<LookupResult>
  /** idempotencyKey = 그 일을 맡은 우리 기록에서 만든 키 (BL-6 10 — 같은 일이면 같은 키) */
  cancel(paymentId: string, reason: string, idempotencyKey?: string): Promise<CancelResult>
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export interface PortOneOptions {
  readonly storeId: string
  readonly apiSecret: string
  /** 기본 https://api.portone.io */
  readonly baseUrl?: string
  readonly fetch?: FetchLike
  /** 요청 하나의 시간 제한 — 주면 조회·상태를 바꾸는 요청 모두 이 값 (시험이 줄인다) */
  readonly timeoutMs?: number
  /** 결제 조회 시간 한도 (기본 10초) */
  readonly lookupTimeoutMs?: number
  /** 상태를 바꾸는 요청의 시간 한도 (기본 60초) */
  readonly mutateTimeoutMs?: number
}

export const PORTONE_API_BASE = 'https://api.portone.io'
/** 결제 조회(읽기만) 시간 한도 (BL-6 7·10) */
export const PORTONE_TIMEOUT_MS = 10_000
/** 상태를 바꾸는 요청(결제 취소·현금영수증 발급·취소) 시간 한도 — 포트원 권장 (BL-6 10, D-PAY-09) */
export const PORTONE_MUTATE_TIMEOUT_MS = 60_000

/** 포트원 연결 설정 (결제 어댑터·현금영수증 어댑터가 함께 쓴다) */
export interface PortOneConnection {
  readonly storeId: string
  readonly apiSecret: string
  readonly baseUrl: string
  readonly fetch: FetchLike
  readonly lookupTimeoutMs: number
  readonly mutateTimeoutMs: number
}

export function portOneConnection(options: PortOneOptions): PortOneConnection {
  return {
    storeId: options.storeId,
    apiSecret: options.apiSecret,
    baseUrl: (options.baseUrl ?? PORTONE_API_BASE).replace(/\/+$/, ''),
    fetch: options.fetch ?? ((input, init) => fetch(input, init)),
    lookupTimeoutMs: options.lookupTimeoutMs ?? options.timeoutMs ?? PORTONE_TIMEOUT_MS,
    mutateTimeoutMs: options.mutateTimeoutMs ?? options.timeoutMs ?? PORTONE_MUTATE_TIMEOUT_MS,
  }
}

/** 멱등 키 형식 (영문·숫자·`-` 1~64자 — 우리 기록에서 만든 값만 보낸다) */
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9-]{1,64}$/

/**
 * 포트원 요청 하나. 시간 한도는 setTimeout + AbortController(시험의 가짜 타이머로도 돈다).
 * 시간 초과·연결 실패는 null — 오류 내용에는 주소·비밀값이 섞일 수 있어 버린다
 */
export async function portOneRequest(
  connection: PortOneConnection,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; idempotencyKey?: string | undefined; mutate: boolean },
): Promise<{ status: number; body: unknown } | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout')), init.mutate ? connection.mutateTimeoutMs : connection.lookupTimeoutMs)
  try {
    const headers: Record<string, string> = { Authorization: `PortOne ${connection.apiSecret}` }
    if (init.body !== undefined) headers['Content-Type'] = 'application/json'
    if (init.idempotencyKey !== undefined && IDEMPOTENCY_KEY_RE.test(init.idempotencyKey)) headers['Idempotency-Key'] = init.idempotencyKey
    // 신호를 지키지 않는 fetch여도 시간 한도에서 끊는다
    const response = await abortable(
      connection.fetch(`${connection.baseUrl}${path}`, {
        method: init.method,
        headers,
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: controller.signal,
      }),
      controller.signal,
    )
    const text = await abortable(response.text(), controller.signal)
    let body: unknown = null
    try {
      body = text === '' ? null : JSON.parse(text)
    } catch {
      body = null
    }
    return { status: response.status, body }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function abortable<T>(value: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('aborted'))
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error('aborted'))
    signal.addEventListener('abort', abort, { once: true })
    value.then(
      (result) => {
        signal.removeEventListener('abort', abort)
        resolve(result)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort)
        reject(error instanceof Error ? error : new Error('failed'))
      },
    )
  })
}

/** 포트원 V2 결제 수단 type → G-BIL 수단 글자 (모르는 type은 그대로) */
const METHOD_TYPES: Readonly<Record<string, string>> = {
  PaymentMethodCard: 'CARD',
  PaymentMethodTransfer: 'TRANSFER',
  PaymentMethodEasyPay: 'EASY_PAY',
  PaymentMethodVirtualAccount: 'VIRTUAL_ACCOUNT',
  PaymentMethodMobile: 'MOBILE',
  PaymentMethodGiftCertificate: 'GIFT_CERTIFICATE',
}

export const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
export const field = (value: Record<string, unknown>, key: string): unknown => (Object.hasOwn(value, key) ? value[key] : undefined)

/** 금액·통화가 꼭 있어야 하는 상태 (결제가 이루어진 뒤) */
const MONEY_STATUSES: ReadonlySet<string> = new Set(['PAID', 'PARTIAL_CANCELLED', 'CANCELLED'])

/** 포트원 V2 결제 조회 응답 본문 → G-BIL payment 입력. 형식이 이상하면 null */
export function mapPortOnePayment(body: unknown): LookedUpPayment | null {
  if (!isObject(body)) return null
  const status = field(body, 'status')
  if (typeof status !== 'string' || status === '' || status.length > 64) return null
  const amountField = field(body, 'amount')
  let amount: number | null = null
  if (amountField !== undefined && amountField !== null) {
    if (!isObject(amountField)) return null
    const total = field(amountField, 'total')
    if (typeof total !== 'number' || !Number.isSafeInteger(total)) return null
    amount = total
  }
  const currencyField = field(body, 'currency')
  if (currencyField !== undefined && currencyField !== null && typeof currencyField !== 'string') return null
  const currency = typeof currencyField === 'string' ? currencyField : null
  if (MONEY_STATUSES.has(status) && (amount === null || currency === null)) return null
  const storeField = field(body, 'storeId')
  if (storeField !== undefined && storeField !== null && typeof storeField !== 'string') return null
  const methodField = field(body, 'method')
  let method: string | null = null
  if (methodField !== undefined && methodField !== null) {
    if (!isObject(methodField)) return null
    const type = field(methodField, 'type')
    if (typeof type === 'string' && type !== '') method = METHOD_TYPES[type] ?? type
  }
  return { status, amount, currency, storeId: typeof storeField === 'string' ? storeField : null, method }
}

/** 결제 ID 형식 (서버가 만든 값: 영문·숫자 20~64자) */
export const PAYMENT_ID_RE = /^[A-Za-z0-9]{20,64}$/

/** 포트원 V2 REST 어댑터 */
export class PortOneGateway implements PaymentGateway {
  readonly #connection: PortOneConnection

  constructor(options: PortOneOptions) {
    this.#connection = portOneConnection(options)
  }

  get connection(): PortOneConnection {
    return this.#connection
  }

  async lookup(paymentId: string): Promise<LookupResult> {
    if (!PAYMENT_ID_RE.test(paymentId)) return { kind: 'error' }
    const result = await portOneRequest(this.#connection, `/payments/${encodeURIComponent(paymentId)}?storeId=${encodeURIComponent(this.#connection.storeId)}`, { method: 'GET', mutate: false })
    if (result === null) return { kind: 'error' }
    if (result.status === 404 && isObject(result.body) && field(result.body, 'type') === 'PAYMENT_NOT_FOUND') return { kind: 'missing' }
    if (result.status !== 200) return { kind: 'error' }
    const payment = mapPortOnePayment(result.body)
    return payment === null ? { kind: 'error' } : { kind: 'found', payment }
  }

  async cancel(paymentId: string, reason: string, idempotencyKey?: string): Promise<CancelResult> {
    if (!PAYMENT_ID_RE.test(paymentId)) return { kind: 'error' }
    const result = await portOneRequest(this.#connection, `/payments/${encodeURIComponent(paymentId)}/cancel`, {
      method: 'POST',
      body: { storeId: this.#connection.storeId, reason },
      idempotencyKey,
      mutate: true,
    })
    if (result === null) return { kind: 'error' }
    if (result.status === 200 && isObject(result.body)) {
      const cancellation = field(result.body, 'cancellation')
      const status = isObject(cancellation) ? field(cancellation, 'status') : undefined
      return status === 'SUCCEEDED' || status === 'REQUESTED' ? { kind: 'ok' } : { kind: 'error' }
    }
    if (result.status === 409 && isObject(result.body) && field(result.body, 'type') === 'PAYMENT_ALREADY_CANCELLED') return { kind: 'already' }
    return { kind: 'error' }
  }
}

// ── 웹훅 서명 (Standard Webhooks) ─────────────────────────────────────────

/** 웹훅 보낸 시각 허용 범위 (±5분, BL-6 5) */
export const WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000

/** 웹훅 비밀값 → HMAC 키 (`whsec_` 뒤 base64). 형식이 틀리면 null */
export function webhookKey(secret: string): Buffer | null {
  const text = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null
  const key = Buffer.from(text, 'base64')
  return key.length === 0 ? null : key
}

/** 서명 문자열 `v1,<base64>` */
export function signWebhook(secret: string, id: string, timestampSeconds: number, body: string): string {
  const key = webhookKey(secret)
  if (key === null) throw new TypeError('웹훅 비밀값 형식이 올바르지 않다')
  return `v1,${createHmac('sha256', key).update(`${id}.${String(timestampSeconds)}.${body}`, 'utf8').digest('base64')}`
}

export type WebhookCheck = { readonly ok: true; readonly paymentId: string | null } | { readonly ok: false }

/**
 * 웹훅 확인: 서명(웹훅 비밀값)·보낸 시각(지금 ±5분)·본문 형식. 맞으면 본문의 data.paymentId만 꺼낸다(본문의 금액·상태·상점은 쓰지 않는다).
 * data.paymentId가 없는 종류(빌링키 알림 등)는 paymentId null
 */
export function checkWebhook(secret: string, headers: { get(name: string): string | null }, body: string, now: number): WebhookCheck {
  const key = webhookKey(secret)
  const id = headers.get('webhook-id')
  const timestamp = headers.get('webhook-timestamp')
  const signatures = headers.get('webhook-signature')
  if (key === null || id === null || timestamp === null || signatures === null) return { ok: false }
  if (id === '' || id.length > 256 || !/^\d{1,12}$/.test(timestamp)) return { ok: false }
  const sentAt = Number(timestamp) * 1000
  if (Math.abs(now - sentAt) > WEBHOOK_TOLERANCE_MS) return { ok: false }
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`, 'utf8').digest()
  let matched = false
  for (const part of signatures.split(' ')) {
    const [version, value] = part.split(',', 2)
    if (version !== 'v1' || value === undefined) continue
    const given = Buffer.from(value, 'base64')
    if (given.length === expected.length && timingSafeEqual(given, expected)) matched = true
  }
  if (!matched) return { ok: false }
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return { ok: false }
  }
  if (!isObject(parsed) || typeof field(parsed, 'type') !== 'string') return { ok: false }
  const data = field(parsed, 'data')
  if (data === undefined || data === null) return { ok: true, paymentId: null }
  if (!isObject(data)) return { ok: false }
  const paymentId = field(data, 'paymentId')
  if (paymentId === undefined) return { ok: true, paymentId: null }
  if (typeof paymentId !== 'string' || paymentId === '' || paymentId.length > 200) return { ok: false }
  return { ok: true, paymentId }
}
