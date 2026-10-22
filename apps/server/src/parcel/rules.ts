// 택배 자동 접수의 순수 규칙 (PARCEL_RULES PC-2·PC-4·PC-5·PC-8, T1 D-T1-03·D-T1-05·D-T1-11·D-T1-12).
// - 배송지 읽기(readAddress)와 접수할 수 있는지(parcelEligibility)는 골든 tests/golden/parcel/*.json이 고정한다(test/t1-parcel-golden.test.ts).
// - 시계·난수·DB를 쓰지 않는다. 판정 엔진(packages/core) 규칙이 아니다 — 택배는 1등·금액을 바꾸지 않는다(D-T1-01).
// - 화면 문장은 여기 한곳에 둔다(쉬운 한국어 — 영어 상태값은 화면에 내지 않는다, CLAUDE.md 규칙 8).

// ── 배송지 (PC-2) ────────────────────────────────────────────────────────

/** 배송지 여섯 칸 (칸 순서 = 오류 순서) */
export const ADDRESS_FIELDS = ['name', 'phone', 'address', 'detail', 'zip', 'memo'] as const
export type AddressField = (typeof ADDRESS_FIELDS)[number]

export interface ParcelAddress {
  readonly name: string
  /** 숫자만 (9~11자리, 0으로 시작) */
  readonly phone: string
  readonly address: string
  readonly detail: string
  /** 없으면 "" */
  readonly zip: string
  readonly memo: string
}

export const ADDRESS_ERROR_CODES = [
  'NAME_EMPTY',
  'NAME_TOO_LONG',
  'PHONE_EMPTY',
  'PHONE_INVALID',
  'ADDRESS_EMPTY',
  'ADDRESS_TOO_LONG',
  'DETAIL_TOO_LONG',
  'ZIP_INVALID',
  'MEMO_TOO_LONG',
] as const
export type AddressErrorCode = (typeof ADDRESS_ERROR_CODES)[number]

export type AddressResult = { readonly ok: ParcelAddress } | { readonly errors: readonly AddressErrorCode[] }

/** 칸마다 글자 수 상한 (코드 포인트) */
export const ADDRESS_LIMITS = { name: 20, address: 100, detail: 100, memo: 50 } as const

/** 칸 코드 → 그 칸 */
export const ADDRESS_ERROR_FIELD: Readonly<Record<AddressErrorCode, AddressField>> = {
  NAME_EMPTY: 'name',
  NAME_TOO_LONG: 'name',
  PHONE_EMPTY: 'phone',
  PHONE_INVALID: 'phone',
  ADDRESS_EMPTY: 'address',
  ADDRESS_TOO_LONG: 'address',
  DETAIL_TOO_LONG: 'detail',
  ZIP_INVALID: 'zip',
  MEMO_TOO_LONG: 'memo',
}

/** 칸 코드 → 화면 문장 (구매자 링크 양식·판매자 화면·설정 보내는 사람이 같은 문장) */
export const ADDRESS_ERROR_MESSAGES: Readonly<Record<AddressErrorCode, string>> = {
  NAME_EMPTY: '받는 분을 적어 주세요.',
  NAME_TOO_LONG: '받는 분은 20자까지 적어 주세요.',
  PHONE_EMPTY: '연락처를 적어 주세요.',
  PHONE_INVALID: '연락처는 010으로 시작하는 숫자로 적어 주세요.',
  ADDRESS_EMPTY: '주소를 적어 주세요.',
  ADDRESS_TOO_LONG: '주소는 100자까지 적어 주세요.',
  DETAIL_TOO_LONG: '상세 주소는 100자까지 적어 주세요.',
  ZIP_INVALID: '우편번호는 숫자 5자리로 적어 주세요. 모르면 비워 두세요.',
  MEMO_TOO_LONG: '배송 메모는 50자까지 적어 주세요.',
}

/** 공백 문자(JavaScript \s — 전각 공백·탭·줄바꿈 포함)이거나 제어 글자(U+0000~U+001F, U+007F~U+009F)인지 */
function isSpaceLike(char: string): boolean {
  const code = char.codePointAt(0) as number
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || /^\s$/u.test(char)
}

/** PC-2 1 다듬기: NFC → 공백·제어 글자는 공백 하나로, 이어진 공백 줄이기, 앞뒤 지우기 */
export function tidyText(text: string): string {
  let out = ''
  let pending = false
  for (const char of text.normalize('NFC')) {
    if (isSpaceLike(char)) {
      pending = out !== ''
      continue
    }
    if (pending) out += ' '
    pending = false
    out += char
  }
  return out
}

const codePoints = (text: string): number => [...text].length

/**
 * 배송지 읽기 (PC-2, G-PCL-T1-01~26). 여섯 칸이 모두 글이라고 본다 — 칸이 빠지거나 글이 아니면 부르는 쪽이 먼저 INVALID_INPUT으로 거른다(readAddressInput).
 * 문제가 없으면 다듬은 값(연락처는 숫자만), 있으면 칸 순서대로 칸마다 많아야 하나의 코드
 */
export function readAddress(input: Readonly<Record<AddressField, string>>): AddressResult {
  const name = tidyText(input.name)
  const phoneText = tidyText(input.phone)
  const address = tidyText(input.address)
  const detail = tidyText(input.detail)
  const zip = tidyText(input.zip)
  const memo = tidyText(input.memo)
  const errors: AddressErrorCode[] = []
  if (name === '') errors.push('NAME_EMPTY')
  else if (codePoints(name) > ADDRESS_LIMITS.name) errors.push('NAME_TOO_LONG')
  const phone = phoneText.replace(/[ \-.()]/g, '')
  if (phone === '') errors.push('PHONE_EMPTY')
  else if (!/^0[0-9]{8,10}$/.test(phone)) errors.push('PHONE_INVALID')
  if (address === '') errors.push('ADDRESS_EMPTY')
  else if (codePoints(address) > ADDRESS_LIMITS.address) errors.push('ADDRESS_TOO_LONG')
  if (codePoints(detail) > ADDRESS_LIMITS.detail) errors.push('DETAIL_TOO_LONG')
  if (zip !== '' && !/^[0-9]{5}$/.test(zip)) errors.push('ZIP_INVALID')
  if (codePoints(memo) > ADDRESS_LIMITS.memo) errors.push('MEMO_TOO_LONG')
  if (errors.length > 0) return { errors }
  return { ok: { name, phone, address, detail, zip, memo } }
}

/** 받은 값이 여섯 칸 모두 글인 객체인지 (모르는 칸·빠진 칸·글이 아닌 값 → null). fields를 주면 그 칸만 받는다(보내는 사람 — 메모 없음) */
export function readAddressInput(value: unknown, fields: readonly AddressField[] = ADDRESS_FIELDS): Record<AddressField, string> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const keys = Object.keys(value)
  if (keys.length !== fields.length || !keys.every((key) => (fields as readonly string[]).includes(key))) return null
  const out: Record<AddressField, string> = { name: '', phone: '', address: '', detail: '', zip: '', memo: '' }
  for (const field of fields) {
    const raw = (value as Record<string, unknown>)[field]
    if (typeof raw !== 'string') return null
    out[field] = raw
  }
  return out
}

/** 오류 코드 → 칸 문제 목록 (field = 칸 이름, prefix를 주면 `sender.name`처럼) */
export function addressProblems(errors: readonly AddressErrorCode[], prefix = ''): { field: string; message: string }[] {
  return errors.map((code) => ({ field: `${prefix}${ADDRESS_ERROR_FIELD[code]}`, message: ADDRESS_ERROR_MESSAGES[code] }))
}

/** 연락처 끝 4자리 (구매자 링크에 보이는 것) */
export const phoneLast4 = (phone: string): string => phone.slice(-4)

// ── 접수할 수 있는지 (PC-4) ─────────────────────────────────────────────

export const SHIPPING_KINDS = ['NONE', 'FIXED', 'PICKUP', 'COMBINED'] as const
export type ShippingKind = (typeof SHIPPING_KINDS)[number]
export const PAYMENT_KINDS = ['UNPAID', 'PARTIAL', 'PAID', 'OVERPAID'] as const
export type PaymentKind = (typeof PAYMENT_KINDS)[number]
export const PACKING_WORD_KINDS = ['포장 대기', '포장 완료', '포장 다시 확인', '배송 완료', '배송 뒤 바뀜'] as const
export type PackingWordKind = (typeof PACKING_WORD_KINDS)[number]
/** 시도 상태 (PC-5) — 가장 나중 시도, 없으면 NONE */
export const PARCEL_STATES = ['PENDING', 'UNKNOWN', 'BOOKED', 'FAILED', 'CANCELLED'] as const
export type ParcelState = (typeof PARCEL_STATES)[number]
export const PARCEL_STATE_KINDS = ['NONE', ...PARCEL_STATES] as const
export type ParcelStateKind = (typeof PARCEL_STATE_KINDS)[number]
export const ADDRESS_STATES = ['NONE', 'UNCONFIRMED', 'CONFIRMED'] as const
export type AddressState = (typeof ADDRESS_STATES)[number]

/** 살아 있는 시도 (한 묶음에 많아야 하나 — PC-INV-1) */
export const LIVE_STATES: readonly ParcelState[] = ['PENDING', 'UNKNOWN', 'BOOKED']

export interface EligibilityFacts {
  /** 품목 수 */
  readonly items: number
  readonly shipping: ShippingKind
  readonly payment: PaymentKind
  readonly packing: PackingWordKind
  readonly parcel: ParcelStateKind
  readonly address: AddressState
}

export const ELIGIBILITY_REASONS = ['BOOKING', 'BOOKED', 'NO_ITEMS', 'PICKUP', 'COMBINED', 'SHIPPED', 'NOT_PAID', 'NOT_PACKED', 'PACK_CHECK', 'NO_ADDRESS', 'ADDRESS_UNCONFIRMED'] as const
export type EligibilityReason = (typeof ELIGIBILITY_REASONS)[number]

export type Eligibility = { readonly ready: true } | { readonly reason: EligibilityReason }

/** 빠지는 이유의 화면 문장 (PC-4 표) */
export const ELIGIBILITY_MESSAGES: Readonly<Record<EligibilityReason, string>> = {
  BOOKING: '접수 결과를 기다리고 있어요',
  BOOKED: '이미 접수했어요',
  NO_ITEMS: '품목이 없어요',
  PICKUP: '직접 수령이에요',
  COMBINED: '합배송이에요 — 함께 보낼 묶음으로 접수해요',
  SHIPPED: '배송 완료로 적혀 있어요',
  NOT_PAID: '입금 완료 전이에요',
  NOT_PACKED: '포장 전이에요',
  PACK_CHECK: '포장을 다시 확인해 주세요',
  NO_ADDRESS: '배송지가 없어요',
  ADDRESS_UNCONFIRMED: '배송지를 확인해 주세요',
}

/** 접수할 수 있는지 (PC-4, G-PCL-T1-101~121): 표의 위에서부터 처음 걸린 이유 하나 */
export function parcelEligibility(facts: EligibilityFacts): Eligibility {
  if (facts.parcel === 'PENDING' || facts.parcel === 'UNKNOWN') return { reason: 'BOOKING' }
  if (facts.parcel === 'BOOKED') return { reason: 'BOOKED' }
  if (facts.items === 0) return { reason: 'NO_ITEMS' }
  if (facts.shipping === 'PICKUP') return { reason: 'PICKUP' }
  if (facts.shipping === 'COMBINED') return { reason: 'COMBINED' }
  if (facts.packing === '배송 완료' || facts.packing === '배송 뒤 바뀜') return { reason: 'SHIPPED' }
  if (facts.payment === 'UNPAID' || facts.payment === 'PARTIAL') return { reason: 'NOT_PAID' }
  if (facts.packing === '포장 대기') return { reason: 'NOT_PACKED' }
  if (facts.packing === '포장 다시 확인') return { reason: 'PACK_CHECK' }
  if (facts.address === 'NONE') return { reason: 'NO_ADDRESS' }
  if (facts.address === 'UNCONFIRMED') return { reason: 'ADDRESS_UNCONFIRMED' }
  return { ready: true }
}

// ── 시도 (PC-5) ──────────────────────────────────────────────────────────

/** 택배사 실패 사유 (PC-1) */
export const FAILURE_REASONS = ['ADDRESS', 'REJECTED', 'UNAVAILABLE'] as const
export type FailureReason = (typeof FAILURE_REASONS)[number]

export const FAILURE_MESSAGES: Readonly<Record<FailureReason, string>> = {
  ADDRESS: '택배사가 주소를 찾지 못했어요. 배송지를 확인해 주세요.',
  REJECTED: '택배사가 접수를 받지 않았어요.',
  UNAVAILABLE: '접수됐는지 아직 몰라요. 잠시 뒤 다시 확인해 주세요.',
}

/** 멈춘 시도: PENDING이 이만큼 넘게 남으면 UNKNOWN으로 본다 (PC-5 "멈춘 시도") */
export const STALE_PENDING_MS = 2 * 60 * 1000

/** 저장된 상태와 시각 → 지금 보이는 상태 (2분 넘은 PENDING → UNKNOWN) */
export function effectiveState(state: ParcelState, updatedAt: number, now: number): ParcelState {
  return state === 'PENDING' && now - updatedAt > STALE_PENDING_MS ? 'UNKNOWN' : state
}

/** 상자 크기 (PC-6) */
export const BOX_KINDS = ['극소', '소', '중', '대'] as const
export type BoxKind = (typeof BOX_KINDS)[number]
export const DEFAULT_BOX: BoxKind = '소'

/** 한 번에 접수할 수 있는 묶음 수 (PC-5) */
export const BOOK_MAX = 200

/** 택배사가 준 송장번호 모양 (숫자 8~20자리 — 아니면 접수됐는지 모름, PC-1) */
export const INVOICE_RE = /^[0-9]{8,20}$/

// ── 배송 조회 (PC-8) ─────────────────────────────────────────────────────

/** 조회 상태 (저장 값) — 화면 낱말은 TRACK_WORDS */
export const TRACK_CODES = ['ACCEPTED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED'] as const
export type TrackCode = (typeof TRACK_CODES)[number]
export const TRACK_WORDS: Readonly<Record<TrackCode, string>> = { ACCEPTED: '접수됨', PICKED_UP: '집하', IN_TRANSIT: '배송 중', DELIVERED: '도착' }
/** 접수 취소한 시도의 낱말 */
export const CANCELLED_WORD = '접수 취소됨'
/** 접수 뒤 이만큼 지나면 더 조회하지 않는다 */
export const TRACK_STOP_MS = 14 * 24 * 60 * 60 * 1000
/** 조회 간격 (운영 30분 — 시험 모드는 바꿀 수 있다) */
export const TRACK_EVERY_MS = 30 * 60 * 1000

// ── 문장 ────────────────────────────────────────────────────────────────

export const PARCEL_MESSAGES = {
  noSender: '보내는 사람 정보를 먼저 적어 주세요.',
  noCarrier: '택배사를 먼저 이어 주세요.',
  locked: '택배 접수를 먼저 취소해 주세요.',
  buyerLocked: '택배를 이미 접수했어요. 바꿀 일이 있으면 판매자에게 알려 주세요.',
  buyerPreparing: '택배 접수를 준비하고 있어요.',
  addressChanged: '구매자가 배송지를 바꿨어요. 다시 확인해 주세요.',
  addressExpired: '배송지 보관 기간이 지나 운송장을 만들 수 없어요.',
  addressClosed: '주문 날짜로부터 30일이 지나 배송지를 받을 수 없어요.',
  noAddress: '배송지가 없어요.',
  noBooked: '접수한 택배가 없어요.',
  pickedUp: '택배사가 이미 가져갔어요. 택배사에 직접 문의해 주세요.',
  cancelUnknown: '취소됐는지 아직 몰라요. 잠시 뒤 다시 해 주세요.',
  tooMany: `한 번에 ${String(BOOK_MAX)}개까지 접수할 수 있어요.`,
  rehearsal: '리허설 방송은 택배를 접수하지 않아요.',
  epostNotReady: '우체국 택배는 아직 준비 중이에요.',
  fakeTestOnly: '가짜 택배는 시험 모드에서만 고를 수 있어요.',
  busy: '아직 접수하고 있어요. 잠시 뒤 다시 확인해 주세요.',
  request: '이미 받은 입력이에요.',
  unmergeBooking: '택배 접수 결과를 기다리는 구매자에게서는 떼어 낼 수 없어요. 택배 화면에서 접수 결과를 먼저 확인해 주세요.',
  saved: '저장했어요',
  pickupLink: '직접 받기로 했어요.',
  combinedLink: '다른 주문과 함께 보내요.',
  linkNotice: '받는 분·연락처·주소는 이 주문을 보내는 데만 쓰고, 주문 날짜로부터 30일 뒤 지워요.',
} as const
