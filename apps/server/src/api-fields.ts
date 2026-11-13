// 화면이 이벤트 쓰기 API로 보낼 수 있는 종류와 요청 필드 (AC-S04-51).
// - 요청 본문은 그 종류의 엔진 필드(seq·at 제외)와 요청 번호(requestId)·종류(type)만이다. 값의 형식은 코어 checkEvent가 검사한다.
// - broadcast.*는 방송 만들기·끝내기로만(방송 중 감사 켜기·끄기 broadcast.thanks만 여기, D-YT-SRV-24), chat은 서버 수집 함수로만, effect.*는 S08·S11.
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
/** 음성 기록 칸 (V3 R-25) — 엔진 필드가 아니다 */
export const VOICE_LOG_FIELD = 'voiceLog'

export const API_EVENTS: Readonly<Record<string, ApiEventSpec>> = {
  // voiceLog (V3 R-25, D-V3-65): 음성으로 한 쓰기의 기록 칸 { heard, source?, undo?, device? } — 엔진 필드가 아니고 서버가 음성 기록 줄로만 쓴다 (판매 종료는 등록 되돌리기만)
  // 방송 중 감사 채팅 켜기·끄기 (D-YT-SRV-24) — 방송 메뉴(⋯)
  'broadcast.thanks': { broadcast: true, fields: ['b', 'liveChat'] },
  'product.register': { broadcast: true, fields: [...BY_PRODUCT, 'name', 'price', 'stock', 'status', ...PRODUCT_OPTIONS, VOICE_LOG_FIELD] },
  'product.open': { broadcast: true, fields: BY_PRODUCT },
  'product.hold': { broadcast: true, fields: BY_PRODUCT },
  'product.close': { broadcast: true, fields: [...BY_PRODUCT, VOICE_LOG_FIELD] },
  'product.update': { broadcast: true, fields: [...BY_PRODUCT, 'name', 'price', 'stock', 'applyTo', ...PRODUCT_OPTIONS, VOICE_LOG_FIELD] },
  'product.renumber': { broadcast: true, fields: ['b', 'from', 'to', 'reuseClosed', VOICE_LOG_FIELD] },
  // 확인 중(임시 등록) 상품을 판매자가 한 번에 확정·거두기 (R-2 "확인 중", D-RETRO-82): 후보에서 고른 번호(to)·품종·금액을 함께 보낸다 — 적지 않은 칸은 지금 값.
  // 확인 중으로 올리는 칸(product.register의 tentative)은 여기서 받지 않는다 — 판매자의 손 등록은 늘 바로 판매 중이다(일꾼 입구·계정 동기화만 임시로 올린다)
  'product.confirm': { broadcast: true, fields: [...BY_PRODUCT, 'to', 'name', 'price'] },
  'product.withdraw': { broadcast: true, fields: BY_PRODUCT },
  // O2: 지금 상품 정하기 (옵션 방송만, 화면은 5초 대기 없이 바로 보낸다 — D-O2-10)
  'product.focus': { broadcast: true, fields: BY_PRODUCT },
  // last4 (V1): 음성 문자찜의 뒤 4자리 — phone처럼 엔진 필드가 아니고 서버가 지정 구매자 또는 키·뒤 4자리로 바꾼다 (AC-V1-10)
  // newBuyer·voice (V1): "새 손님으로 넣기"(D-V1-14)·음성으로 넣는 쓰기(D-V1-13) — 엔진 필드가 아니고 서버만 읽는다
  sms: { broadcast: true, fields: ['b', 'no', 'received', 'memo', 'phone', 'last4', 'newBuyer', 'voice', 'buyer', 'qty', ...PICK] },
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

/**
 * 판매자가 적은 글에 DB·JSON이 받지 못하는 글자가 있는지 — 제어 문자(NUL 포함)나 짝 없는 서로게이트(SA-N3-11, TD-N3-005).
 * 짝 없는 서로게이트는 PostgreSQL 글자 칸이 UTF-8로 바꾸지 못해 저장에서 500이 난다 — 저장 전에 400으로 거절한다
 */
export function hasUnsafeText(text: string): boolean {
  return hasControlChar(text) || !text.isWellFormed()
}
