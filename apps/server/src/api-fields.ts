// 화면이 이벤트 쓰기 API로 보낼 수 있는 종류와 요청 필드 (AC-S04-51).
// - 요청 본문은 그 종류의 엔진 필드(seq·at 제외)와 요청 번호(requestId)·종류(type)만이다. 값의 형식은 코어 checkEvent가 검사한다.
// - broadcast.*는 방송 만들기·끝내기로만, chat은 서버 수집 함수로만, effect.*는 S08·S11.
// - sms는 서버가 허용 필드로 새 이벤트를 만든다(ref는 서버가 만들고, 전화번호는 키·뒤 4자리로 바꾼다, AC-S04-31).

export interface ApiEventSpec {
  /** 방송 필드 b가 있는 종류 (그 방송의 범위로 간다). 없으면 요청에 적은 날짜(?date=)의 범위 */
  readonly broadcast: boolean
  /** 요청에서 받는 필드 (requestId·type 제외) */
  readonly fields: readonly string[]
}

const BY_PRODUCT = ['b', 'no']
const BY_CLAIM = ['b', 'no', 'buyer', 'reason']
/** 옵션 방송(claim.parseMode=OPTIONS)의 칸 (O2, R-19·R-20 — 번호 방송이면 코어 checkEvent가 막고 서버는 기록하지 않는다, D-O2-13) */
const PRODUCT_OPTIONS = ['aliases', 'options', 'stocks']
/** 찜을 가리키는 방송자 조치의 변형 고르기 (R-19 "찜을 가리키는 방송자 조치", D-O1-02) */
const PICK = ['options']

export const API_EVENTS: Readonly<Record<string, ApiEventSpec>> = {
  'product.register': { broadcast: true, fields: [...BY_PRODUCT, 'name', 'price', 'stock', 'status', ...PRODUCT_OPTIONS] },
  'product.open': { broadcast: true, fields: BY_PRODUCT },
  'product.hold': { broadcast: true, fields: BY_PRODUCT },
  'product.close': { broadcast: true, fields: BY_PRODUCT },
  'product.update': { broadcast: true, fields: [...BY_PRODUCT, 'name', 'price', 'stock', 'applyTo', ...PRODUCT_OPTIONS] },
  'product.renumber': { broadcast: true, fields: ['b', 'from', 'to'] },
  // O2: 지금 상품 정하기 (옵션 방송만, 화면은 5초 대기 없이 바로 보낸다 — D-O2-10)
  'product.focus': { broadcast: true, fields: BY_PRODUCT },
  sms: { broadcast: true, fields: ['b', 'no', 'received', 'memo', 'phone', 'buyer', 'qty', ...PICK] },
  'host.cancel': { broadcast: true, fields: [...BY_CLAIM, ...PICK] },
  'host.reject': { broadcast: true, fields: [...BY_CLAIM, ...PICK] },
  'host.promote': { broadcast: true, fields: [...BY_CLAIM, ...PICK] },
  'host.confirm': { broadcast: true, fields: [...BY_CLAIM, ...PICK] },
  'host.approveCancel': { broadcast: true, fields: [...BY_CLAIM, ...PICK] },
  'host.dismissCancel': { broadcast: true, fields: [...BY_CLAIM, ...PICK] },
  'host.assign': { broadcast: true, fields: [...BY_CLAIM, 'replace', 'replaceTo', 'qty', ...PICK] },
  'host.reopen': { broadcast: true, fields: [...BY_PRODUCT, 'reason', ...PICK] },
  'host.resolveConflict': { broadcast: true, fields: [...BY_PRODUCT, 'decision', 'reason'] },
  'host.convertMessage': { broadcast: true, fields: ['b', 'msg', 'no', 'reason'] },
  // O2: 확인 필요 항목 바로잡기·지우기 (옵션 방송만, D-O2-14 — 여러 줄은 화면이 원래 순서로 하나씩)
  'host.resolveReview': { broadcast: true, fields: [...BY_PRODUCT, 'item', 'qty', 'reason', ...PICK] },
  'host.dismissReview': { broadcast: true, fields: ['b', 'item', 'reason'] },
  'host.blockBuyer': { broadcast: false, fields: ['buyer', 'reason'] },
  'host.unblockBuyer': { broadcast: false, fields: ['buyer', 'reason'] },
  'buyer.merge': { broadcast: false, fields: ['from', 'into', 'reason'] },
  'buyer.unmerge': { broadcast: false, fields: ['from', 'reason'] },
  'settlement.shippingOverride': { broadcast: false, fields: ['buyer', 'date', 'mode', 'amount'] },
  'settlement.adjust': { broadcast: false, fields: ['buyer', 'date', 'amount', 'reason'] },
  'settlement.payment': { broadcast: false, fields: ['buyer', 'date', 'amount', 'memo'] },
  'settlement.refund': { broadcast: false, fields: ['buyer', 'date', 'amount', 'reason'] },
}

/** 서버 수집 함수(채팅)가 받는 필드 (AC-S04-33) */
export const CHAT_FIELDS: readonly string[] = ['b', 'id', 'ch', 'nick', 'text', 'owner', 'publishedAt']

/** 요청 번호 형식 (AC-S04-25) */
export const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/** 객체의 자기 속성 이름 전부 (`__proto__` 같은 키도 포함) */
export function ownKeys(value: object): string[] {
  return Reflect.ownKeys(value).map((key) => (typeof key === 'string' ? key : String(key)))
}

/** JSON 객체(배열·null 아님)인지 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 자기 속성만 읽는다 (상속된 값·`__proto__` 접근자를 거치지 않는다) */
export function own(value: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(value, key) ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined
}

/** 제어 문자(NUL 포함)가 있는지 — 제목·가게 이름·메시지 ID에 넣지 않는다 (DB 글자 칸이 NUL을 받지 않는다) */
export function hasControlChar(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}
