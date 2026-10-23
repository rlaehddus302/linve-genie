// 택배 화면 낱말 (T1, PARCEL_RULES PC-3·PC-4·PC-8, D-T1-08·D-T1-12).
// 영어 상태값(PENDING·BOOKED…)은 화면 글자에 넣지 않는다 — 서버가 준 문장·조회 낱말을 쓰고, 없을 때만 여기 문장으로 채운다.
import type { AddressFields, BundleView, ParcelBrief, ParcelRow } from '../api/parcel-types.ts'
import { kstShort } from './kst.ts'

export const PARCEL_TITLE = '택배 접수'
export const GROUP_READY = '보낼 수 있어요'
export const GROUP_EXCLUDED = '아직 못 보내요'
export const GROUP_BOOKED = '접수했어요'
export const WAYBILL_NOTE = '운송장은 일반 프린터나 100×150 라벨 프린터로 찍어요. 라벨 프린터(B1)로는 찍을 수 없어요.'
export const RETRY_FAILED = '실패한 것만 다시'
export const NO_PARCEL_DATES = '아직 실제 방송 판매 기록이 없어요.'
export const NOTHING_READY = '지금 보낼 수 있는 묶음이 없어요.'
export const NOTHING_EXCLUDED = '빠진 묶음이 없어요.'
export const NOTHING_BOOKED = '아직 접수한 택배가 없어요.'
export const WAITING = '접수 결과를 기다리고 있어요'
export const UNKNOWN_RESULT = '접수됐는지 아직 몰라요. 잠시 뒤 다시 확인해 주세요.'
export const LOCKED_ADDRESS = '택배 접수를 먼저 취소해 주세요.'
export const NO_ADDRESS = '배송지가 없어요'
export const BUYER_CAN_WRITE = '구매자 확인서 링크에서 구매자가 직접 적을 수도 있어요.'
export const PICKUP_BUNDLE = '직접 수령이에요'
export const COMBINED_BUNDLE = '합배송이에요'
export const ADDRESS_EXPIRED = '주문 날짜로부터 30일이 지나 배송지를 지웠어요.'
export const ADDRESS_SAVED = '배송지를 저장했어요.'
export const ADDRESS_CONFIRMED = '배송지를 확인했어요.'
export const ADDRESS_DELETED = '배송지를 지웠어요.'
export const PARCEL_SETTINGS_SAVED = '택배 설정을 저장했어요.'

/** 살아 있는 접수 (배송지·포장 기록을 고칠 수 없다 — PC-3 잠금, PC-5) */
export function isLive(parcel: ParcelBrief | null | undefined): boolean {
  return parcel != null && (parcel.state === 'PENDING' || parcel.state === 'UNKNOWN' || parcel.state === 'BOOKED')
}

/** 다시 보낼 수 있는 시도: 택배사가 거절했거나(새 요청 번호) 접수됐는지 모름(같은 요청 번호) — 기다리는 중(PENDING)은 아니다 */
export function isRetryable(parcel: ParcelBrief | null | undefined): boolean {
  return parcel != null && (parcel.state === 'FAILED' || parcel.state === 'UNKNOWN')
}

/**
 * "택배: 배송 중 · 9000-0000-0001" (PC-8 판매자 화면). 접수 결과를 기다리면 "택배: 접수 결과를 기다리고 있어요",
 * 모르면 그 문장, 실패하면 실패 문장, 취소면 "택배: 접수 취소됨".
 */
export function parcelLine(parcel: ParcelBrief): string {
  switch (parcel.state) {
    case 'BOOKED':
      return `택배: ${parcel.status ?? '접수됨'}${parcel.invoiceText === null ? '' : ` · ${parcel.invoiceText}`}`
    case 'PENDING':
      return `택배: ${parcel.message ?? WAITING}`
    case 'UNKNOWN':
      return `택배: ${parcel.message ?? UNKNOWN_RESULT}`
    case 'FAILED':
      return `택배: ${parcel.message ?? '접수하지 못했어요'}`
    case 'CANCELLED':
      return `택배: ${parcel.status ?? '접수 취소됨'}`
  }
}

/** 색 (글자와 함께 — 색만으로 알리지 않는다) */
export function parcelTone(parcel: ParcelBrief): 'success' | 'warning' | 'danger' | 'info' {
  if (parcel.state === 'BOOKED') return parcel.status === '도착' ? 'success' : 'info'
  if (parcel.state === 'FAILED') return 'danger'
  if (parcel.state === 'CANCELLED') return 'info'
  return 'warning'
}

/** "마지막 확인 10/22 14:30" (없으면 null) */
export function checkedWords(parcel: ParcelBrief): string | null {
  return parcel.checkedAt === null ? null : `마지막 확인 ${kstShort(parcel.checkedAt)}`
}

/** 빠진 줄의 문장: 시도의 문장(실패·모름)이 먼저, 없으면 빠지는 이유 문장 */
export function rowReason(row: ParcelRow): string {
  if (row.parcel !== null && (row.parcel.state === 'FAILED' || row.parcel.state === 'UNKNOWN' || row.parcel.state === 'PENDING') && row.parcel.message !== null) return row.parcel.message
  if (row.parcel?.state === 'PENDING') return WAITING
  if (row.parcel?.state === 'UNKNOWN') return UNKNOWN_RESULT
  return row.message ?? ''
}

/** 묶음 자세히에서 배송지를 고쳐 풀 수 있는 이유 (그 줄에 "배송지 보기" 링크) */
export function addressReason(row: ParcelRow): boolean {
  return row.reason === 'NO_ADDRESS' || row.reason === 'ADDRESS_UNCONFIRMED' || (row.parcel?.state === 'FAILED' && row.parcel.reason === 'ADDRESS')
}

/**
 * 택배 화면의 세 무리 (D-T1-08): 고를 수 있음 = 서버의 ready 중 실패한 시도가 없는 것, 빠짐 = excluded + 실패한 시도가 있는 ready
 * (실패 문장과 함께 — "실패한 것만 다시"로 보낸다), 접수함 = booked. 순서는 서버 순서(확인서 일괄 순서) 그대로.
 */
export function parcelGroups(day: { readonly ready: readonly ParcelRow[]; readonly excluded: readonly ParcelRow[]; readonly booked: readonly ParcelRow[] }): {
  readonly ready: readonly ParcelRow[]
  readonly excluded: readonly ParcelRow[]
  readonly booked: readonly ParcelRow[]
} {
  const failed = day.ready.filter((row) => row.parcel?.state === 'FAILED')
  return { ready: day.ready.filter((row) => row.parcel?.state !== 'FAILED'), excluded: [...failed, ...day.excluded], booked: day.booked }
}

/** "실패한 것만 다시"로 보낼 줄: 실패(ready 쪽)와 모름(excluded 쪽 — 같은 요청 번호로 다시 묻는다) */
export function retryRows(day: { readonly ready: readonly ParcelRow[]; readonly excluded: readonly ParcelRow[] }): readonly ParcelRow[] {
  return [...day.ready, ...day.excluded].filter((row) => isRetryable(row.parcel))
}

/** 배송지 칸 (이름표는 구매자 링크와 같다 — AC-T1-10) */
export const ADDRESS_LABELS: Readonly<Record<keyof AddressFields, string>> = {
  name: '받는 분',
  phone: '연락처',
  address: '주소',
  detail: '상세 주소',
  zip: '우편번호(몰라도 돼요)',
  memo: '배송 메모',
}
export const ADDRESS_KEYS = ['name', 'phone', 'address', 'detail', 'zip', 'memo'] as const satisfies readonly (keyof AddressFields)[]

export const EMPTY_ADDRESS: AddressFields = { name: '', phone: '', address: '', detail: '', zip: '', memo: '' }

/** 출처 문장 */
export function sourceWords(source: 'BUYER' | 'SELLER'): string {
  return source === 'BUYER' ? '구매자가 적었어요' : '판매자가 적었어요'
}

/** 묶음 자세히의 배송지 칸 모양 */
export type AddressShape = 'pickup' | 'combined' | 'expired' | 'none' | 'shown'

export function addressShape(bundle: BundleView): AddressShape {
  if (bundle.row.shipping === 'PICKUP') return 'pickup'
  if (bundle.row.shipping === 'COMBINED') return 'combined'
  if (bundle.address !== null) return 'shown'
  return bundle.expired ? 'expired' : 'none'
}

/** 숫자만인 연락처를 읽기 쉽게: 010-1234-5678 (그 밖 길이는 그대로) */
export function phoneWords(phone: string): string {
  if (/^01\d{8,9}$/.test(phone)) return phone.length === 11 ? `${phone.slice(0, 3)}-${phone.slice(3, 7)}-${phone.slice(7)}` : `${phone.slice(0, 3)}-${phone.slice(3, 6)}-${phone.slice(6)}`
  return phone
}

/**
 * 택배 화면 줄 이름 (BUY-01·D-098, TE-T1-001) — 고르는 칸·"접수 취소"·"운송장 PDF"가 어느 구매자 것인지 늘 구분된다.
 * - 그날 범위 자료가 있으면 다른 화면과 같은 이름(buyerLabels: 그날 모든 구매자 기준 " · 끝 1234"·" · 뒤 4자리 5678"·" · 문자 20:01:05"·" · 2")을 쓴다.
 * - 아직 없으면(불러오는 중·못 읽음) 이 목록의 줄끼리 같은 규칙: 같은 표시 이름이 둘 이상이면 " · 뒤 4자리 5678"(있을 때),
 *   그래도 겹치면 목록 순서로 둘째부터 " · 2", " · 3". 전화번호 원문은 넣지 않는다(서버가 준 뒤 4자리만).
 */
export function parcelNames(rows: readonly ParcelRow[], known: (buyer: string) => string | undefined = () => undefined): Map<string, string> {
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.name, (counts.get(row.name) ?? 0) + 1)
  const out = new Map<string, string>()
  const taken = new Set<string>()
  const local: ParcelRow[] = []
  for (const row of rows) {
    const label = known(row.buyer)
    if (label === undefined) local.push(row)
    else {
      out.set(row.buyer, label)
      taken.add(label)
    }
  }
  for (const row of local) {
    const base = (counts.get(row.name) ?? 0) >= 2 && row.phoneLast4 !== null ? `${row.name} · 뒤 4자리 ${row.phoneLast4}` : row.name
    let label = base
    for (let n = 2; taken.has(label); n++) label = `${base} · ${String(n)}`
    taken.add(label)
    out.set(row.buyer, label)
  }
  return out
}
