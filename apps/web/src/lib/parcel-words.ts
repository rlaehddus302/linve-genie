// 택배 화면 낱말 (T1, PARCEL_RULES PC-3·PC-4·PC-8, D-T1-08·D-T1-12).
// 영어 상태값(PENDING·BOOKED…)은 화면 글자에 넣지 않는다 — 서버가 준 문장·조회 낱말을 쓰고, 없을 때만 여기 문장으로 채운다.
import type { AddressFields, AddressSource, BoxKind, BundleView, ParcelBrief, ParcelRow, ParcelSender, ParcelSettings, SettingsCarrier } from '../api/parcel-types.ts'
import type { PackingWord } from '../api/types.ts'
import { dateWords, kstShort } from './kst.ts'
import { packingWords } from './packing-words.ts'

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
export const BUYER_CAN_WRITE = "구매자 확인서 링크에서 구매자가 직접 적을 수도 있어요. 링크는 방송을 끝낸 뒤 '영수증 보내기'에서 만들어요."
export const PICKUP_BUNDLE = '직접 수령이에요'
export const COMBINED_BUNDLE = '합배송이에요'
export const ADDRESS_EXPIRED = '주문 날짜로부터 30일이 지나 배송지를 지웠어요.'
export const ADDRESS_SAVED = '배송지를 저장했어요.'
export const ADDRESS_CONFIRMED = '배송지를 확인했어요.'
export const ADDRESS_DELETED = '배송지를 지웠어요.'
export const PARCEL_SETTINGS_SAVED = '택배 설정을 저장했어요.'
/** 택배 크기 (세 변의 합, FB1 D-FB1-05 — 문서 패키지 BOX_SIZE_NAMES와 같은 낱말) */
export const BOX_KINDS = ['60', '80', '100', '120', '160'] as const satisfies readonly BoxKind[]
export const BOX_WORDS: Readonly<Record<BoxKind, string>> = { '60': '60cm 이하', '80': '80cm 이하', '100': '100cm 이하', '120': '120cm 이하', '160': '160cm 이하' }
/** 낱말 (모르는 값이면 그대로 — 옛 기록) */
export const boxWord = (box: string): string => (BOX_WORDS as Readonly<Record<string, string>>)[box] ?? box
export const BOX_LABEL = '기본 택배 크기 (세 변의 합)'
export const BOX_HINT = '가로·세로·높이를 더한 길이예요. 우체국 기준이고, 무게 기준은 택배사마다 달라요.'
/** 줄마다 크기 고르기 (택배 화면) */
export const ROW_BOX_LABEL = '택배 크기'
/** 자동 접수가 안 되는 택배사를 골랐거나 고르지 않았을 때 (FB1 D-FB1-04) */
export const NO_AUTO_BOOK_NOTE = '자동 접수는 아직 준비 중이에요. 지금은 포장 화면에서 송장번호를 직접 적어요.'
export const OTHER_CARRIER = 'OTHER'
/** 우체국 계약소포 (D-REAL-04) — 판매자가 우체국과 계약하고 OpenAPI를 신청해 받은 값을 넣는다 */
export const EPOST_CARRIER = 'EPOST'
export const EPOST_CUSTOMER_LABEL = '우체국 고객 번호'
export const EPOST_KEY_LABEL = '우체국 인증키'
export const EPOST_SECRET_LABEL = '우체국 보안키'
export const EPOST_GUIDE = '우체국 계약소포 고객이면 자동 접수를 쓸 수 있어요. 우체국 계약고객전용시스템(biz.epost.go.kr) > 오픈API 사용 신청에서 받은 인증키·보안키를 넣어 주세요.'
export const EPOST_PRINT_NOTE = '접수하면 우체국이 가지러 와요. 운송장은 우체국 계약고객전용시스템에서 뽑아 붙여 주세요.'
export const epostKeyHelp = (ready: boolean): string => (ready ? '저장돼 있어요 · 바꿀 때만 새로 적어 주세요.' : '저장하면 우체국에 맞는지 바로 확인해요.')
export const CARRIER_NAME_LABEL = '택배사 이름'
/** 택배사 이름 칸 상한 (서버와 같다 — 코드 포인트) */
export const CARRIER_NAME_MAX = 20
/** 확인 창 안내 (D-T1-15) */
export const PARCEL_SHOWN_NOTE = '접수하면 포장·정산 화면에 택배 상태와 송장번호가 보여요.'
/** 택배 화면 기다림 안내 (D-T1-18, PC-5 "기다릴 때의 안내 — 택배 화면") — 다른 화면 꼬리표는 짧은 문장(PC-4) 그대로 */
export const BOOKING_NOW = '택배사에 접수하는 중이에요… 택배사 답이 늦으면 조금 걸려요.'
export const UNKNOWN_WAIT = "택배사 답이 없어 접수됐는지 아직 몰라요. 잠시 뒤 '다시 확인'을 눌러 주세요. 두 번 접수되지 않아요."
export const PENDING_WAIT = "택배사 답을 기다리고 있어요. 다른 일을 하셔도 돼요. 2분이 지나도 그대로면 '다시 확인'을 누를 수 있어요."
/** 기다리는(PENDING) 줄이 있는 동안 목록을 다시 읽는 간격 (D-T1-18) */
export const PENDING_POLL_MS = 30_000
/** 집하 뒤라 접수 취소를 보낼 수 없는 줄 (U-T1-05 — 버튼 대신) */
export const NOT_CANCELLABLE = '택배사가 이미 가져가서 여기서는 접수를 취소할 수 없어요. 바꿔야 하면 택배사에 직접 문의해 주세요.'
/** 포장 체크리스트 잠김 안내 (U-T1-07 — 무엇 때문인지 → 필요할 때만 무엇을). 접수함은 서버 409 문장(LOCKED_ADDRESS)을 품는다 */
export const PACKING_LOCKED_BOOKED = `택배로 접수한 묶음이라 포장·배송 기록은 여기서 바꿀 수 없어요. 바꿔야 하면 ${LOCKED_ADDRESS}`
export const PACKING_LOCKED_WAITING = '택배 접수 결과를 기다리는 묶음이라 포장·배송 기록은 여기서 바꿀 수 없어요. 택배 화면에서 접수 결과를 먼저 확인해 주세요.'

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

/** 택배 화면 빠진 줄의 문장 (D-T1-18): 기다림·모름은 길게(이유와 다음 할 일), 그 밖은 rowReason */
export function screenReason(row: ParcelRow): string {
  if (row.parcel?.state === 'PENDING') return PENDING_WAIT
  if (row.parcel?.state === 'UNKNOWN') return UNKNOWN_WAIT
  return rowReason(row)
}

/** 택배사 답을 기다리는(PENDING) 줄이 있다 — 그동안 30초마다 다시 읽는다 (D-T1-18) */
export function hasPending(day: { readonly ready: readonly ParcelRow[]; readonly excluded: readonly ParcelRow[] }): boolean {
  return [...day.ready, ...day.excluded].some((row) => row.parcel?.state === 'PENDING')
}

/**
 * 포장 꼬리표를 그리지 않는다 (D-T1-15, AC-T1-65): 포장 상태가 "배송 완료"이고 접수(BOOKED)가 있으면 택배 꼬리표 하나만.
 * 손으로 적은 배송 완료(접수 없음)·배송 뒤 바뀜(주의 — 둘 다)·기다림·실패·취소 접수는 그대로 그린다.
 */
export function hidesPackingTag(status: string, parcel: ParcelBrief | null | undefined): boolean {
  return status === '배송 완료' && parcel?.state === 'BOOKED'
}

/** 포장 꼬리표 글: 그 송장이 접수한 송장이면 택배 꼬리표와 같은 끊어 읽는 모양(9000-0000-0001 — U-T1-06), 손으로 적은 송장은 적은 그대로 */
export function packingTagWords(status: PackingWord, invoice: string | null, parcel: ParcelBrief | null | undefined): string {
  const shown = parcel?.state === 'BOOKED' && parcel.invoice !== null && parcel.invoice === invoice && parcel.invoiceText !== null ? parcel.invoiceText : invoice
  return packingWords(status, shown)
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

/** 출처 문장 (모르는 값은 지금까지처럼 "판매자가 적었어요") */
export function sourceWords(source: AddressSource | string): string {
  if (source === 'BUYER') return '구매자가 적었어요'
  if (source === 'LEDGER') return '손님이 지난번에 적은 배송지'
  return '판매자가 적었어요'
}

/** 출처 옆 확인 꼬리표 (손님이 지난번에 적은 배송지는 누가 확인했는지까지 — UX-KP1-004) */
export function confirmedWords(source: AddressSource | string, confirmed: boolean): string {
  if (!confirmed) return '확인 전'
  return source === 'LEDGER' ? '판매자가 확인함' : '확인함'
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

// ── 설정 "택배" 칸 값 (D-T1-09, FB1 D-FB1-04·05 — 웹 ParcelSettings·앱 가게 설정이 같이 쓴다, D-APPX-03) ──

export const SENDER_KEYS = ['name', 'phone', 'address', 'detail', 'zip'] as const
export const SENDER_LABELS: Readonly<Record<(typeof SENDER_KEYS)[number], string>> = {
  name: '보내는 사람 이름',
  phone: '보내는 사람 연락처',
  address: '보내는 주소',
  detail: '보내는 상세 주소',
  zip: '보내는 우편번호(몰라도 돼요)',
}

export interface ParcelDraft {
  readonly carrier: SettingsCarrier | ''
  /** 직접 입력 택배사 이름 (carrier가 OTHER일 때만 쓴다) */
  readonly carrierName: string
  readonly customerNo: string
  readonly sender: ParcelSender
  readonly box: BoxKind
  /** 우체국 인증키·보안키 (새로 적을 때만 — 저장한 값은 오지 않는다, D-REAL-04) */
  readonly epostKey: string
  readonly epostSecret: string
  /** 우체국 비회원 신청 비밀번호 (EP1 D-EP1-14 — 저장한 것을 그대로 보이고, 바뀌었을 때만 보낸다) */
  readonly epostPassword: string
}

/** 우체국 신청 비밀번호 칸 (EP1 D-EP1-14) */
export const EPOST_PASSWORD_LABEL = '우체국 신청 비밀번호 (숫자 4자리)'
export const EPOST_PASSWORD_HINT = '우체국 창구소포를 비회원으로 사전접수할 때 쓰는 번호예요. 우체국 화면에 신청 비밀번호 칸이 나오면 앱이 넣어 드려요. 우체국에서 신청 내역을 볼 때도 이 번호를 써요.'

export function parcelDraftOf(settings: ParcelSettings): ParcelDraft {
  const sender = settings.sender ?? { name: settings.shopName, phone: '', address: '', detail: '', zip: '' }
  return {
    carrier: settings.carrier ?? '',
    carrierName: settings.carrier === OTHER_CARRIER ? (settings.carrierName ?? '') : '',
    customerNo: '',
    sender: { ...sender, name: sender.name === '' ? settings.shopName : sender.name },
    box: settings.box,
    epostKey: '',
    epostSecret: '',
    epostPassword: settings.epostPassword ?? '',
  }
}

export function sameParcelDraft(a: ParcelDraft, b: ParcelDraft): boolean {
  return (
    a.carrier === b.carrier &&
    (a.carrier !== OTHER_CARRIER || a.carrierName === b.carrierName) &&
    a.customerNo === b.customerNo &&
    a.box === b.box &&
    a.epostKey === b.epostKey &&
    a.epostSecret === b.epostSecret &&
    a.epostPassword === b.epostPassword &&
    SENDER_KEYS.every((key) => a.sender[key] === b.sender[key])
  )
}

/** 보내는 사람을 보낼지: 저장한 것이 없고 이름 말고 아무것도 적지 않았으면 보내지 않는다(빈 칸 오류를 내지 않게) */
export function senderToSend(settings: ParcelSettings, draft: ParcelDraft): ParcelSender | undefined {
  if (settings.sender !== null) return draft.sender
  const touched = SENDER_KEYS.some((key) => key !== 'name' && draft.sender[key].trim() !== '') || draft.sender.name !== settings.shopName
  return touched ? draft.sender : undefined
}

/** 보낼 본문 (직접 입력이면 이름도) */
export function parcelBody(settings: ParcelSettings, draft: ParcelDraft): Record<string, unknown> {
  const sender = senderToSend(settings, draft)
  return {
    carrier: draft.carrier === '' ? null : draft.carrier,
    ...(draft.carrier === OTHER_CARRIER ? { carrierName: draft.carrierName } : {}),
    box: draft.box,
    ...(sender === undefined ? {} : { sender }),
    ...(draft.customerNo.trim() === '' ? {} : { customerNo: draft.customerNo }),
    ...(draft.carrier === EPOST_CARRIER && draft.epostKey.trim() !== '' ? { epostKey: draft.epostKey } : {}),
    ...(draft.carrier === EPOST_CARRIER && draft.epostSecret.trim() !== '' ? { epostSecret: draft.epostSecret } : {}),
    // 바뀌었을 때만 (빈 글이면 지운다 — EP1 D-EP1-14)
    ...(draft.epostPassword === (settings.epostPassword ?? '') ? {} : { epostPassword: draft.epostPassword }),
  }
}

// ── 우체국 방문접수 파일 (D-UX3-36) — 계약 없이 인터넷우체국에 직접 접수 ──
export const EPOST_FILE_TITLE = '우체국에 직접 접수하기'
export const EPOST_FILE_HOW = '계약하지 않아도 돼요. 이 파일을 인터넷우체국 [방문접수소포 예약] 화면의 [파일(주소) 등록]에 올리면 받는 분이 한 번에 채워져요. 결제와 [신청]은 우체국 화면에서 직접 눌러 주세요.'
export const EPOST_FILE_AFTER = '우체국에서 받은 송장번호를 포장 화면에 적으면 배송 완료가 되고, 다음 파일에서 빠져요.'
export const EPOST_FILE_BUSY = '우체국 파일을 만드는 중이에요…'
export const EPOST_FILE_OPEN = '인터넷우체국 열기'
/** 인터넷우체국 방문접수소포 예약 (로그인하거나 비회원으로) */
export const EPOST_VISIT_URL = 'https://parcel.epost.go.kr/general.RetrieveGeneralNewGubun.parcel?isGuest=true&isAllDelete=true&userType=5'
export const epostFileLabel = (count: number): string => `우체국 파일 받기 (${String(count)}개)`
/** 상자 크기 안내: 파일은 설정의 기본 상자로 넣는다 */
export const epostFileBox = (box: BoxKind): string => `상자 크기는 모두 기본 상자(${boxWord(box)})로 넣어요. 다른 묶음은 우체국 목록에서 바꿔 주세요.`
export const epostFileName = (date: string): string => `우체국-방문접수-${date}.xlsx`
export const epostFilePath = (date: string): string => `/api/parcels/days/${date}/epost-visit.xlsx`
/** 우체국 파일 칸을 보이는지: 우체국을 골랐거나 아직 택배사를 고르지 않았고, 보낼 수 있는 묶음이 있다 */
/** 우체국 직접 접수·자료 칸 — 보낼 묶음이 없어도 보인다(D-UX3-64, 판매 전에도 기능을 써 볼 수 있게. 0개면 우체국 쪽에서 쉬운 문장으로 알린다) */
export const showsEpostFile = (day: { readonly carrier: { readonly code: SettingsCarrier } | null }): boolean => day.carrier === null || day.carrier.code === 'EPOST'

// ── 우체국 직접 접수 (D-UX3-40) — 앱 안 들고 가기·가지러 오기 화면은 우체국 창구소포 사전접수(EP1 PC-9)로 바꿈 (D-EP1-21) ──
export const EPOST_FILE_PC_TITLE = 'PC에서 접수하기'
export const EPOST_FILE_PC = 'PC에서 접수하려면 파일을 받아 방문접수 화면의 [파일(주소) 등록]에 올려도 돼요.'
/** 택배 화면: 계약 인증키가 없을 때 — 자동 접수 대신 우체국 직접 접수가 먼저 (D-UX3-40) */
export const DIRECT_FIRST_NOTE = '우체국 계약 인증키가 없어 자동 접수는 꺼져 있어요. 아래 단추로 우체국에 바로 접수해요.'
export const DIRECT_FIRST_KEY = '계약했다면 인증키 넣기'

// 직접 접수한 묶음 (택배 화면 접수함 줄)
export const DIRECT_TAG = '우체국 직접 접수'
export const DIRECT_CANCEL_LABEL = '기록 지우기'
export const DIRECT_CANCEL_QUESTION = '송장 기록을 지울까요?'
export const directCancelDescription = (name: string): string => `${name}님 묶음에 적은 송장번호만 지워요. 우체국 접수는 그대로라, 취소하려면 인터넷우체국에서 해 주세요.`
export const DIRECT_CANCEL_DONE = '송장 기록을 지웠어요.'

// ── 직접 넣은 택배 (D-UX3-38) — 방송 판매 기록 없이 받는 분을 적어 접수 ──
export const EXTRA_TITLE = '받는 분 직접 넣기'
export const EXTRA_HOW = '방송 판매 기록이 없어도 보낼 수 있어요. 받는 분과 물품 수를 적으면 그 날짜의 "보낼 수 있어요"에 들어가고, 다른 묶음과 똑같이 접수해요.'
export const EXTRA_ADD = '받는 분 넣기'
export const EXTRA_EDIT = '고치기'
export const EXTRA_DELETE = '지우기'
export const EXTRA_TAG = '직접 넣음'
export const EXTRA_QTY_LABEL = '물품 수'
export const EXTRA_SAVED = '받는 분을 넣었어요. "보낼 수 있어요"에서 접수해 주세요.'
export const EXTRA_EDITED = '받는 분을 고쳤어요.'
export const EXTRA_DELETED = '받는 분을 지웠어요.'
export const EXTRA_DELETE_QUESTION = '받는 분을 지울까요?'
export const extraDeleteDescription = (name: string): string => `${name}님을 접수 목록에서 지워요. 지우면 되돌릴 수 없어요.`
/** "물품 3개 · 직접 넣음" */
export const extraFacts = (qty: number): string => `물품 ${String(qty)}개 · ${EXTRA_TAG}`
/** 넣을 날짜 안내 */
export const extraDateNote = (date: string): string => `${dateWords(date)} 목록에 넣어요.`
export const isExtraRow = (row: { readonly extra?: boolean }): boolean => row.extra === true
