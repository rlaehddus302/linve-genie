// 우체국 창구소포 간편사전접수 — 앱 안 화면 자동 입력의 순수 규칙 (PARCEL_RULES PC-9, D-EP1-01~D-EP1-10).
// - 라이브지니는 우체국에 아무것도 보내지 않는다. 앱이 우체국 사전접수 화면을 앱 안에 열고, 이 모듈이 만든 값으로 칸을 채운다.
//   약관 동의·주소 검증·최종 신청은 판매자가 우체국 화면에서 직접 누른다(자동으로 누르지 않는다).
// - 상태는 둘로 나눈다: 입력 완료(FILLED — 칸을 채웠다, 신청했는지는 모름) · 사전접수 완료(RECEIVED — 판매자가 확인한 접수번호가 있다).
// - 시계·난수·DB를 쓰지 않는다. 화면 문장은 여기 한곳에 둔다(쉬운 한국어).
import type { ParcelSender } from './carrier.ts'
import type { ParcelAddress } from './rules.ts'

// ── 상태 (PC-9 2) ────────────────────────────────────────────────────────

export const EPOST_STATES = ['FILLED', 'RECEIVED'] as const
export type EpostState = (typeof EPOST_STATES)[number]
export const isEpostState = (value: unknown): value is EpostState => typeof value === 'string' && (EPOST_STATES as readonly string[]).includes(value)

/** 화면 낱말 */
export const EPOST_WORDS: Readonly<Record<EpostState, string>> = {
  FILLED: '우체국 입력 완료',
  RECEIVED: '우체국 사전접수 완료',
}

/** 판매자가 하는 일 셋 */
export const EPOST_ACTIONS = ['FILLED', 'RECEIVED', 'CLEAR'] as const
export type EpostAction = (typeof EPOST_ACTIONS)[number]

export type EpostTransition =
  | { readonly next: { readonly state: EpostState; readonly receiptNo: string | null } | null; readonly changed: boolean }
  | { readonly refused: 'ALREADY_RECEIVED' | 'OTHER_RECEIPT' | 'RECEIPT_INVALID' }

/**
 * 상태 바꾸기 (PC-9 2). 같은 일을 두 번 해도 결과가 같다(두 기기·다시 보내기).
 * - FILLED: 없음·입력 완료 → 입력 완료. 사전접수 완료 → 거절(이미 접수번호가 있다 — 두 번 신청하지 않게).
 * - RECEIVED(접수번호): 없음·입력 완료 → 사전접수 완료. 같은 번호로 이미 완료 → 그대로. 다른 번호로 완료 → 거절(먼저 기록을 지운다).
 * - CLEAR: 무엇이든 → 없음 (판매자가 우체국에서 신청을 취소했거나, 입력만 하고 신청하지 않았을 때).
 */
export function epostTransition(current: { readonly state: EpostState; readonly receiptNo: string | null } | null, action: EpostAction, receiptRaw: unknown = null): EpostTransition {
  if (action === 'CLEAR') return { next: null, changed: current !== null }
  if (action === 'FILLED') {
    if (current?.state === 'RECEIVED') return { refused: 'ALREADY_RECEIVED' }
    return { next: { state: 'FILLED', receiptNo: null }, changed: true }
  }
  const receiptNo = readReceiptNo(receiptRaw)
  if (receiptNo === null) return { refused: 'RECEIPT_INVALID' }
  if (current?.state === 'RECEIVED') {
    return current.receiptNo === receiptNo ? { next: current, changed: false } : { refused: 'OTHER_RECEIPT' }
  }
  return { next: { state: 'RECEIVED', receiptNo }, changed: true }
}

// ── 접수번호 (PC-9 3) ─────────────────────────────────────────────────────

export const RECEIPT_MIN = 6
export const RECEIPT_MAX = 30

/**
 * 판매자가 적거나 앱이 완료 화면에서 찾은 접수번호 → 저장할 글 (없으면 null).
 * NFC·전각 숫자를 반각으로, 공백·`-`를 지우고, 영문은 대문자로. 남은 글이 ASCII 영숫자 6~30자이고 숫자가 하나 이상이어야 한다.
 */
export function readReceiptNo(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 100) return null
  const text = raw
    .normalize('NFKC')
    .replace(/[\s\-‐-―]/gu, '')
    .toUpperCase()
  if (text.length < RECEIPT_MIN || text.length > RECEIPT_MAX) return null
  if (!/^[0-9A-Z]+$/.test(text) || !/[0-9]/.test(text)) return null
  return text
}

// ── 비회원 신청 비밀번호 (PC-9 8, D-EP1-14) ──────────────────────────────

/**
 * 설정에 적은 우체국 비회원 신청 비밀번호 → 저장할 글. 빈 글·null은 지우기(null), NFKC(전각 숫자) 뒤 ASCII 숫자 정확히 4자리면 그 글, 아니면 'invalid'.
 * 우체국 비회원 약관 쪽이 숫자 4자리만 받는다(2026-11-08 실제 화면의 goNextPage 확인).
 */
export function readEpostPassword(raw: unknown): string | null | 'invalid' {
  if (raw === null) return null
  if (typeof raw !== 'string' || raw.length > 20) return 'invalid'
  const text = raw.normalize('NFKC').trim()
  if (text === '') return null
  return /^[0-9]{4}$/.test(text) ? text : 'invalid'
}

// ── 연락처 (PC-9 4) ───────────────────────────────────────────────────────

/** 휴대전화 앞자리 (그 밖의 0으로 시작하는 번호는 일반전화) */
const MOBILE_PREFIX = /^01[016789]/

/**
 * 숫자만인 연락처(PC-2 — 0으로 시작 9~11자리) → 세 토막. 우체국 화면은 연락처를 세 칸으로 받는 일이 많다.
 * 02 지역 번호는 앞 2자리, 그 밖은 앞 3자리. 가운데는 남은 자리에서 뒤 4자리를 뺀 것.
 */
export function phoneParts(phone: string): readonly [string, string, string] {
  const head = phone.startsWith('02') ? 2 : 3
  return [phone.slice(0, head), phone.slice(head, phone.length - 4), phone.slice(-4)]
}

/** 연락처 글 (`010-1234-5678`) */
export const phoneText = (phone: string): string => phoneParts(phone).join('-')

/** 휴대전화인지 */
export const isMobile = (phone: string): boolean => MOBILE_PREFIX.test(phone)

// ── 자동 입력 값 (PC-9 1) ─────────────────────────────────────────────────

export interface EpostPerson {
  readonly name: string
  readonly zip: string
  readonly address: string
  readonly detail: string
  /** 휴대전화 세 토막 (휴대전화가 아니면 null) */
  readonly mobile: readonly [string, string, string] | null
  /** 일반전화 세 토막 (휴대전화면 null) */
  readonly phone: readonly [string, string, string] | null
}

export interface EpostFill {
  readonly receiver: EpostPerson
  readonly sender: EpostPerson
  /** 내용품 (품종·가격은 넣지 않는다 — PC-6과 같음) */
  readonly item: string
  /** 물품 수 N (화면 안내 "물품 N개") */
  readonly qty: number
  /** 배송 메모 (있으면) */
  readonly memo: string
}

/** 내용품 글 (다육이 판매 — 품종·가격 없이, D-EP1-04) */
export const EPOST_ITEM = '식물'

const personOf = (value: { readonly name: string; readonly phone: string; readonly address: string; readonly detail: string; readonly zip: string }): EpostPerson => ({
  name: value.name,
  zip: value.zip,
  address: value.address,
  detail: value.detail,
  mobile: isMobile(value.phone) ? phoneParts(value.phone) : null,
  phone: isMobile(value.phone) ? null : phoneParts(value.phone),
})

/** 받는 분·보내는 사람·물품 수 → 우체국 화면에 채울 값 */
export function epostFill(receiver: ParcelAddress, sender: ParcelSender, qty: number): EpostFill {
  return { receiver: personOf(receiver), sender: personOf(sender), item: EPOST_ITEM, qty, memo: receiver.memo }
}

// ── 앱 안 화면 (PC-9 1) ───────────────────────────────────────────────────

/** 우체국 화면 주소 (서버가 내려 준다 — 우체국이 주소를 바꾸면 앱을 새로 내지 않고 고친다) */
export const EPOST_PAGES = {
  /**
   * 창구소포 간편사전접수 — 모바일 입구 (D-EP1-18). 로그인 전이면 모바일 비회원 약관(그 위 [로그인]은 모바일 로그인), 로그인했으면 모바일 신청서.
   * PC 입구(service.epost.go.kr …ParcelRetrieveAcceptPlus.postal?gubun=2)는 비회원은 모바일로 넘기지만, 지난 로그인 쿠키가 남아 있으면 PC 로그인 화면으로 보낸다
   */
  // ctype=c2 = 소포 (모바일 소포접수 메뉴의 [사전접수 신청]과 같은 주소). 빠지면 등기통상 신청서가 열린다
  apply: 'https://m.epost.go.kr/postal/mobile/mobile.RetrieveAcceptRn.postal?ctype=c2',
  /** 회원 신청 내역·취소 */
  history: 'https://www.epost.go.kr/usr/login/cafzc008k01.jsp?loginType=login&s_url=https://service.epost.go.kr/front.commonpostplus.ParcelRetrieveMyBefRecevList.postal&login=plus_bsearch&webacc=',
  /** 비회원 이용 내역 */
  guestHistory: 'https://service.epost.go.kr/useinfo.RetrievePostalNomemUseInfo.postal',
} as const

/** 자동 입력을 하는 화면의 호스트 (이 밖의 화면에는 배송지를 넣지 않는다 — D-EP1-06) */
export const EPOST_HOSTS = ['service.epost.go.kr', 'www.epost.go.kr', 'epost.go.kr'] as const

/**
 * 칸 찾기 힌트 (D-EP1-05): 칸 이름 → 그 칸을 가리키는 글. 앱은 칸의 label·title·placeholder·name·id와 바로 앞 표 머리글에서 이 글을 찾는다.
 * 우체국 화면의 실제 칸 이름은 아직 확인하지 못했다 — 처음 시험에서 맞춘다. 서버가 내려 주므로 앱을 새로 내지 않고 고칠 수 있다.
 * `selectors`는 정확한 CSS 선택자 (찾으면 글보다 먼저 쓴다).
 */
export interface EpostFormHints {
  readonly sections: { readonly receiver: readonly string[]; readonly sender: readonly string[] }
  readonly fields: Readonly<Record<EpostFieldKey, readonly string[]>>
  readonly selectors: Readonly<Partial<Record<`${'receiver' | 'sender'}.${EpostPersonKey}` | 'item' | 'memo', string>>>
  /** 완료 화면에서 접수번호를 가리키는 글 */
  readonly receiptWords: readonly string[]
  /** 비회원 신청 비밀번호 칸 (정확한 선택자 — 쉼표로 여럿, D-EP1-14) */
  readonly password: string
  /**
   * 받는 분 여러 명 한 번에 (D-EP1-19 — 모바일 소포 신청서, 2026-11-08 실제 확인): 받는 분을 채운 뒤 `next`([다음])를 누르면 신청서가 확인하고
   * `list`(받는 분 목록)에 더한다. 그 뒤 글 `add`가 든 단추([받는 분 추가 +])가 받는 분 칸을 비운다. `agree`([필수동의] 우편금지물품 확인)는 판매자가 체크한다
   */
  readonly batch: { readonly next: string; readonly add: string; readonly list: string; readonly agree: string }
}

export const EPOST_PERSON_KEYS = ['name', 'zip', 'address', 'detail', 'mobile', 'phone'] as const
export type EpostPersonKey = (typeof EPOST_PERSON_KEYS)[number]
export type EpostFieldKey = EpostPersonKey | 'item' | 'memo'

export const EPOST_FORM_HINTS: EpostFormHints = {
  sections: { receiver: ['받는분', '받는 분', '수취인', '받으시는 분', 'receiver', 'recv', 'rcv'], sender: ['보내는분', '보내는 분', '발송인', '보내시는 분', 'sender', 'send', 'snd'] },
  fields: {
    name: ['성명', '이름', '받는분', '보내는분', '수취인명', '발송인명', 'nm', 'name'],
    zip: ['우편번호', 'zip', 'zipcode'],
    address: ['기본주소', '주소', 'addr1', 'address'],
    detail: ['상세주소', '나머지주소', 'addr2', 'detail'],
    mobile: ['휴대전화', '휴대폰', '핸드폰', 'hp', 'mobile', 'cell'],
    phone: ['일반전화', '전화번호', 'tel', 'phone'],
    item: ['내용품', '물품', '품명', 'content', 'item'],
    memo: ['요청사항', '배송메모', '메모', 'memo'],
  },
  // 인터넷우체국 창구(다량)소포 신청서(2026-11-08 확인): 내용품·배송 요청은 고르기 + 글 칸 한 쌍이고, 숨은 준등기 내용품 고르기(semiCode)가
  // 같은 "내용품코드" 이름을 써서 글로는 가릴 수 없다 — 정확한 선택자로 둘을 함께 준다(쉼표로 여럿)
  // 보내는 분은 PC·모바일 모두 tSnd* 이름이다(2026-11-08 확인). 우체국 회원으로 연 모바일 신청서는 보내는 분을 회원 정보 요약으로만 보이고
  // 칸은 숨겨 두어 글로는 찾지 못한다 — 회원 정보에 주소가 없으면 "보내는 분 주소를 입력하십시오"로 막혔다(D-EP1-20). 빈 칸에만 넣는다
  selectors: {
    item: '#labProductCode, #tMailCont',
    memo: '#delivReqMsgCd, #delivReqMsg',
    'sender.name': '[name="tSndNm"]',
    'sender.zip': '[name="tSndZipcd"]',
    'sender.address': '[name="tSndAddr1"]',
    'sender.detail': '[name="tSndAddr2"]',
    'sender.mobile': '[name="tSndHTel1"], [name="tSndHTel2"], [name="tSndHTel3"]',
    'sender.phone': '[name="tSndTel1"], [name="tSndTel2"], [name="tSndTel3"]',
  },
  receiptWords: ['접수번호', '예약번호', '사전접수번호', '등기번호'],
  // 실제 비회원 약관 쪽(데스크톱, 2026-11-08): 신청 비밀번호 guest_orderpw · 비밀번호 확인 guest_orderpw2
  // 모바일 신청서는 받는 분 목록 단계에서 guest_orderpw · guest_orderpw_con (2026-11-08)
  password: '#guest_orderpw, #guest_orderpw2, #guest_orderpw_con',
  batch: { next: 'a#subStep2', add: '받는 분 추가', list: '#recevList > li', agree: '[name="broken_agree"]' },
}

// ── 주소 파일 (PC-9 5) ────────────────────────────────────────────────────

/** 우체국 창구소포 사전접수 주소 파일 열 (공식 안내 순서 — 받는분/우편번호/기본주소/상세주소/휴대전화/일반전화) */
export const EPOST_FILE_COLUMNS = ['받는분', '우편번호', '기본주소', '상세주소', '휴대전화', '일반전화'] as const
/** 우체국 한 번 파일 접수 상한 */
export const EPOST_FILE_MAX = 3000

/** 받는 분 → 파일 한 줄 (연락처는 휴대전화·일반전화 중 맞는 칸에 `-`로 이어서) */
export function epostFileRow(receiver: ParcelAddress): readonly string[] {
  const mobile = isMobile(receiver.phone)
  return [receiver.name, receiver.zip, receiver.address, receiver.detail, mobile ? phoneText(receiver.phone) : '', mobile ? '' : phoneText(receiver.phone)]
}

// ── 문장 ─────────────────────────────────────────────────────────────────

export const EPOST_MESSAGES = {
  notReady: '이 주문은 아직 우체국에 접수할 수 없어요.',
  noSender: '설정에서 보내는 사람을 먼저 적어 주세요.',
  alreadyReceived: '이미 우체국에 사전접수했어요. 다시 하려면 우체국에서 신청을 취소한 뒤 접수 기록을 지워 주세요.',
  otherReceipt: '이미 다른 접수번호가 이어져 있어요. 접수 기록을 먼저 지워 주세요.',
  receiptInvalid: '접수번호는 우체국 화면에 나온 숫자(영문 포함)를 그대로 적어 주세요.',
  noRows: '우체국 파일로 만들 주문이 없어요. 입금·포장·배송지 확인이 끝난 주문만 들어가요.',
  tooMany: `우체국 파일은 한 번에 ${String(EPOST_FILE_MAX)}개까지예요.`,
  addressExpired: '배송지 보관 기간이 지나 우체국에 입력할 수 없어요.',
  passwordInvalid: '우체국 신청 비밀번호는 숫자 4자리로 적어 주세요.',
} as const
