// 택배사 어댑터 (PARCEL_RULES PC-1, D-T1-02). 택배사 하나는 접수·취소·조회 셋을 한다. 접수는 요청 번호(requestKey)로 멱등이어야 한다 —
// 같은 요청 번호로 다시 보내면 새 접수를 만들지 않고 처음 답(같은 송장번호)을 준다. 그렇게 할 수 없는 택배사는 어댑터로 들이지 않는다.
// - 결과는 셋으로만 나눈다: 접수됨(송장번호) · 실패(ADDRESS 주소 거절 · REJECTED 그 밖 거절) · 모름(응답 없음·시간 초과·서버 오류·알 수 없는 답).
//   송장번호가 숫자 8~20자리가 아니면 모름이다(같은 요청 번호로 다시 확인한다).
// - 택배사가 준 원래 글(오류 문장 — 주소가 들어 있을 수 있다)은 읽지 않고 저장·로그·화면에 내지 않는다. 답에서 정해진 칸(error 코드·invoice·status)만 본다.
// - T1에는 실제 택배사(우체국) 어댑터가 없다. httpCarrier는 가짜 택배사(fake-carrier.ts — 127.0.0.1, 시험 모드만)의 약속을 말한다.
import type { BoxKind, ParcelAddress, TrackCode } from './rules.ts'
import { INVOICE_RE, TRACK_CODES } from './rules.ts'

export const CARRIER_CODES = ['FAKE', 'EPOST'] as const
export type CarrierCode = (typeof CARRIER_CODES)[number]

/** 화면에 보이는 택배사 이름 */
export const CARRIER_LABELS: Readonly<Record<CarrierCode, string>> = { FAKE: '가짜 택배(시험용)', EPOST: '우체국 택배' }

/** 어댑터 시간 제한 기본값 (AC-T1-21) */
export const CARRIER_TIMEOUT_MS = 15_000

/** 보내는 사람 (설정 "택배" — PC-2 칸, 메모 없음) */
export interface ParcelSender {
  readonly name: string
  readonly phone: string
  readonly address: string
  readonly detail: string
  readonly zip: string
}

/** 택배사에 보내는 접수 하나 — 받는 분 여섯 칸·보내는 사람·상자 크기·물품 수만 (품종·가격·구매자 ID·닉네임은 없다, PC-6) */
export interface BookRequest {
  readonly requestKey: string
  readonly customerNo: string | null
  readonly receiver: ParcelAddress
  readonly sender: ParcelSender
  readonly box: BoxKind
  /** 물품 수 N ("물품 N개") */
  readonly count: number
}

export type BookResult = { readonly kind: 'BOOKED'; readonly invoice: string } | { readonly kind: 'FAILED'; readonly reason: 'ADDRESS' | 'REJECTED' } | { readonly kind: 'UNKNOWN' }
export type CancelResult = { readonly kind: 'CANCELLED' } | { readonly kind: 'REFUSED' } | { readonly kind: 'UNKNOWN' }
/** 조회 답: 송장번호마다 조회 상태 (택배사가 모르는 송장은 빠진다). 실패면 HTTP 상태 코드(없으면 null)만 */
export type TrackResult = { readonly ok: true; readonly items: ReadonlyMap<string, TrackCode> } | { readonly ok: false; readonly status: number | null }

export interface CarrierAdapter {
  readonly code: CarrierCode
  book(request: BookRequest): Promise<BookResult>
  cancel(invoice: string): Promise<CancelResult>
  /** 조회 API가 없는 택배사는 두지 않는다 (그러면 접수됨에서 멈춘다, PC-8) */
  readonly track?: (invoices: readonly string[]) => Promise<TrackResult>
  /** 송장번호를 넣은 조회 주소 */
  trackUrl(invoice: string): string
}

export interface HttpCarrierOptions {
  readonly code: CarrierCode
  /** 택배사 주소 (예: http://127.0.0.1:4500) */
  readonly base: string
  readonly timeoutMs?: number
  readonly fetch?: typeof fetch
}

/** 물품 글 (PC-6 — 품종·가격 없이) */
export const itemText = (count: number): string => `물품 ${String(count)}개`

/** 답 본문에서 정해진 칸 하나만 읽는다 (원래 글은 버린다) */
async function field(response: Response, name: string): Promise<unknown> {
  try {
    const parsed: unknown = await response.json()
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>)[name] : undefined
  } catch {
    return undefined
  }
}

/** 가짜 택배사(그리고 같은 약속을 지키는 택배사)의 HTTP 어댑터 */
export function httpCarrier(options: HttpCarrierOptions): CarrierAdapter {
  const doFetch = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? CARRIER_TIMEOUT_MS
  const post = async (path: string, body: unknown): Promise<Response | null> => {
    try {
      return await doFetch(`${options.base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      return null
    }
  }
  return {
    code: options.code,
    async book(request) {
      const response = await post('/book', {
        requestKey: request.requestKey,
        customerNo: request.customerNo,
        receiver: request.receiver,
        sender: request.sender,
        box: request.box,
        item: itemText(request.count),
        count: request.count,
      })
      if (response === null) return { kind: 'UNKNOWN' }
      if (response.status === 200) {
        const invoice = await field(response, 'invoice')
        return typeof invoice === 'string' && INVOICE_RE.test(invoice) ? { kind: 'BOOKED', invoice } : { kind: 'UNKNOWN' }
      }
      if (response.status >= 400 && response.status <= 499 && response.status !== 408 && response.status !== 429) {
        const code = await field(response, 'error')
        return { kind: 'FAILED', reason: code === 'ADDRESS' ? 'ADDRESS' : 'REJECTED' }
      }
      await response.body?.cancel().catch(() => {})
      return { kind: 'UNKNOWN' }
    },
    async cancel(invoice) {
      const response = await post('/cancel', { invoice })
      if (response === null) return { kind: 'UNKNOWN' }
      await response.body?.cancel().catch(() => {})
      if (response.status === 200) return { kind: 'CANCELLED' }
      if (response.status === 409) return { kind: 'REFUSED' }
      return { kind: 'UNKNOWN' }
    },
    async track(invoices) {
      const response = await post('/track', { invoices })
      if (response === null) return { ok: false, status: null }
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => {})
        return { ok: false, status: response.status }
      }
      const items = await field(response, 'items')
      if (!Array.isArray(items)) return { ok: false, status: response.status }
      const out = new Map<string, TrackCode>()
      for (const item of items as unknown[]) {
        if (typeof item !== 'object' || item === null) continue
        const { invoice, status } = item as { invoice?: unknown; status?: unknown }
        if (typeof invoice === 'string' && invoices.includes(invoice) && (TRACK_CODES as readonly unknown[]).includes(status)) out.set(invoice, status as TrackCode)
      }
      return { ok: true, items: out }
    },
    trackUrl: (invoice) => `${options.base}/track/${encodeURIComponent(invoice)}`,
  }
}
