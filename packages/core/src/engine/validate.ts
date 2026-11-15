// 이벤트 형식 검사 (R-1 "입력 오류와 맞지 않는 명령", D-050, AC-S03-02, AC-S04-01·06·07).
// - 입력 오류: 표에 없는 종류, 필수 필드가 없거나 값의 형식이 틀림, 함께 와야 하는 필드가 한쪽만 옴(D-065, D-061),
//   sms에 전화번호 원문 필드 phone이 있음(D-061), 표에 없는 필드(모든 종류, 값과 상관없이 — D-073), 방송 날짜·설정 스냅샷의 형식·범위(D-071),
//   선언하지 않은 방송, seq·at이 수가 아님, 이벤트가 객체가 아님 (구조 검사 checkShape).
//   applyEvent는 구조 검사에 걸리면 상태를 바꾸지 않고 InvalidEventError를 던진다.
// - 판매자가 적는 칸의 휴대폰 번호(R-1, D-079·D-080, DAT-06): 글 칸(sms의 ref·memo, 입금 메모, 사유, 방송 제목, 상품 이름)의
//   containsPhoneRun, ID 칸(buyer·from·into·replace·msg)의 looksLikePhoneId. 기록 전 검사 checkEvent에서만 본다 —
//   재생(applyEvent)은 이 검사로 입력 오류를 내지 않는다(D-079 ⑤, RA-S04-011). 서버는 기록하기 전에 checkEvent로 거른다(D-072).
// - 맞지 않는 명령(형식은 맞지만 지금 상태에 맞지 않음)은 입력 오류가 아니다. 엔진이 아무것도 바꾸지 않는다(D-039).
// - 처음 쓰는 스프린트가 따로 있는 종류(effect.failed → S11)와 settlement.groupBy=MANUAL은 applyEvent가 NotImplementedError로 알린다.
// - 상태 형식이 지금 코어와 다르면 문제 목록 대신 StateFormatError를 던진다(D-072).
import { checkSettings } from '../settings.ts'
import { ownGet } from './draft.ts'
import { containsPhoneRun, looksLikePhoneId } from './phone.ts'
import { assertStateFormat } from './state-format.ts'
import { isValidDate, isValidReceivedTime } from './time.ts'
import { checkAliasesShape, checkOptionContext, checkOptionsShape, checkPickShape, checkStocksShape } from './validate-options.ts'
import type { EngineState, EventProblem } from './types.ts'

/** 입력 오류 (NotImplementedError와 구별되는 오류 하나, D-050). 판별은 isInvalidEvent로 한다 */
export class InvalidEventError extends Error {
  /** 이벤트 종류 (알아볼 수 없으면 null) */
  readonly eventType: string | null
  readonly problems: readonly EventProblem[]

  constructor(eventType: string | null, problems: readonly EventProblem[]) {
    const shown = problems.map((p) => (p.field === null ? p.message : `${p.field}: ${p.message}`)).join(' · ')
    super(`입력 오류${eventType === null ? '' : ` (${eventType})`}: ${shown}`)
    this.name = 'InvalidEventError'
    this.eventType = eventType
    this.problems = problems
  }
}

export function isInvalidEvent(error: unknown): error is InvalidEventError {
  return error instanceof InvalidEventError
}

/** 처음 쓰는 스프린트가 따로 있는 R-1 이벤트 → 보고용 기능 이름 */
export const DEFERRED_EVENTS: Readonly<Record<string, string>> = {
  'effect.failed': '효과 실패 보고(effect.failed, R-13) — S11',
}

/** 값 검사: 통과면 null, 아니면 이유 */
type Check = (value: unknown) => string | null

const isInt = (value: unknown, min: number): boolean => typeof value === 'number' && Number.isSafeInteger(value) && value >= min

const id: Check = (v) => (typeof v === 'string' && v !== '' ? null : '빈 문자열이 아닌 문자열이어야 한다')
const text: Check = (v) => (typeof v === 'string' ? null : '문자열이어야 한다')

/**
 * 판매자가 적는 칸 → 휴대폰 번호 판단 (R-1 "판매자가 적는 칸의 휴대폰 번호", D-079·D-080, DAT-06).
 * 이 칸들은 지울 수 없는 이벤트 로그·엔진 상태(입금 메모는 정산 장부, 문자찜 메모는 표시 이름)·이력 응답·백업에 평문으로 남는다.
 * 구조 검사가 통과한 값에만, 기록 전 검사(checkEvent)에서만 본다 — 재생(applyEvent)은 보지 않는다(D-079 ⑤).
 * 시청자 쪽 값(chat의 id·ch·nick·text)에는 쓰지 않는다 — 찜을 버리게 되므로(R-3).
 */
const PHONE_JUDGES = new Map<Check, { readonly judge: (value: string) => boolean; readonly message: string }>()
const PHONE_IN_TEXT = '휴대폰 번호가 들어 있다 — 판매자가 적는 글 칸에는 전화번호를 넣지 않는다(문자찜 번호는 전화번호 칸 phoneKey·phoneLast4로만) (R-1, D-079, DAT-06)'
const PHONE_AS_ID = '휴대폰 번호로 된 ID다 — 구매자·메시지 ID 칸에는 전화번호를 넣지 않는다 (R-1, D-079, DAT-06)'
/** 판매자가 적는 칸의 검사: 구조 검사는 check 그대로, 휴대폰 번호 판단은 judge (checkEvent에서만) */
function sellerTyped(check: Check, judge: (value: string) => boolean, message: string): Check {
  const wrapped: Check = (v) => check(v)
  PHONE_JUDGES.set(wrapped, { judge, message })
  return wrapped
}
/** 판매자가 고르거나 적는 구매자·메시지 ID 칸 (buyer·from·into·replace·msg) — looksLikePhoneId */
const typedId: Check = sellerTyped(id, looksLikePhoneId, PHONE_AS_ID)
/** 글 칸 — containsPhoneRun */
const sellerText = (check: Check): Check => sellerTyped(check, containsPhoneRun, PHONE_IN_TEXT)
/** 판매자가 적는 글 (입금 메모·방송 제목·상품 이름·문자찜 메모) */
const freeText: Check = sellerText(text)
const reason: Check = sellerText((v) => (typeof v === 'string' && v.trim() !== '' ? null : '사유는 빈 문자열이 아닌 문자열이어야 한다'))
const no: Check = (v) => (isInt(v, 1) ? null : '1 이상 정수여야 한다')
const money: Check = (v) => (isInt(v, 0) ? null : '0 이상 정수(원)여야 한다')
const positive: Check = (v) => (isInt(v, 1) ? null : '1 이상 정수(원)여야 한다')
const signed: Check = (v) => (typeof v === 'number' && Number.isSafeInteger(v) ? null : '정수(원)여야 한다')
const stock: Check = (v) => (isInt(v, 1) ? null : '재고는 1 이상 정수여야 한다')
/** 한 상품(번호 하나)에 묶어 파는 개수 1~99 ("채홍 3개", D-PIECES-01). 판정·금액과 상관없는 표시 칸이다 */
export const PIECES_MAX = 99
const pieces: Check = (v) => (isInt(v, 1) && (v as number) <= PIECES_MAX ? null : `개수는 1~${String(PIECES_MAX)} 정수여야 한다`)
const bool: Check = (v) => (typeof v === 'boolean' ? null : 'true 또는 false여야 한다')
const time: Check = (v) => (typeof v === 'number' && Number.isFinite(v) ? null : '유한한 수(UTC 밀리초)여야 한다')
const received: Check = (v) => (isValidReceivedTime(v) ? null : '수신 시각은 HH:MM 또는 HH:MM:SS(00:00~23:59:59)여야 한다')
const date: Check = (v) => (isValidDate(v) ? null : '날짜는 실제 있는 YYYY-MM-DD여야 한다')
const channel: Check = (v) => id(v) ?? ((v as string).startsWith('sms:') ? "채널 ID는 'sms:'로 시작할 수 없다 (문자 구매자 ID 자리)" : null)
/** 문자찜 ref·전화번호 키 형식 (R-1 "문자찜 ref와 전화번호", D-061). 정규화한 번호 11자리·하이픈 13자는 키 길이에 못 미친다 */
const SMS_REF_RE = /^[A-Za-z0-9_-]{1,64}$/
const PHONE_KEY_RE = /^[A-Za-z0-9_-]{16,128}$/
const PHONE_LAST4_RE = /^[0-9]{4}$/
/** 문자찜 ref도 글 칸 — 번호는 전화번호 칸으로 (R-1, D-079 ③, DAT-06, 위 sellerText) */
const smsRef: Check = sellerText((v) => (typeof v === 'string' && SMS_REF_RE.test(v) ? null : "문자찜 ref는 영문·숫자·'_'·'-'로 된 1~64자여야 한다"))
const memo: Check = freeText
const phoneKey: Check = (v) => (typeof v === 'string' && PHONE_KEY_RE.test(v) ? null : "전화번호 키는 영문·숫자·'_'·'-'로 된 16~128자여야 한다")
const phoneLast4: Check = (v) => (typeof v === 'string' && PHONE_LAST4_RE.test(v) ? null : '전화번호 뒤 4자리는 숫자 4자리 문자열이어야 한다')
const oneOf =
  (...choices: readonly string[]): Check =>
  (v) =>
    typeof v === 'string' && choices.includes(v) ? null : `${choices.join(' / ')} 중 하나여야 한다`

/** 방송 필드: 선언한 방송만 (state가 필요해 따로 검사한다) */
const BROADCAST = 'b'

interface Spec {
  /** 방송 필드 b가 새 방송을 선언한다 (broadcast.start — 선언하지 않은 방송이어도 된다, 이미 선언했으면 사본) */
  readonly declares?: true
  readonly required: Readonly<Record<string, Check>>
  readonly optional?: Readonly<Record<string, Check>>
  /** 함께 와야 하는 선택 필드 쌍 — 한쪽만 있으면 빠진 쪽을 짚는다 (D-061, D-065) */
  readonly pairs?: readonly (readonly [string, string])[]
  /** 있으면 안 되는 필드 → 이유. 값이 무엇이든(undefined여도) 필드가 있으면 입력 오류다 */
  readonly forbidden?: Readonly<Record<string, string>>
  /** 필드끼리의 조건 (다른 문제가 없을 때만 본다) */
  readonly extra?: (event: Readonly<Record<string, unknown>>) => EventProblem | null
  /** 필드 안쪽 검사 (늘 본다) — 필드 이름은 `필드.안쪽 키` */
  readonly nested?: (event: Readonly<Record<string, unknown>>) => EventProblem[]
  /** 필드 안쪽의 판매자가 적는 글 칸 [필드, 값] (옵션 이름·별칭) — 기록 전 검사가 휴대폰 번호를 본다 */
  readonly texts?: (event: Readonly<Record<string, unknown>>) => [string, string][]
}

const BY_PRODUCT = { [BROADCAST]: id, no }
const BY_CLAIM = { [BROADCAST]: id, no, buyer: typedId }
const HOST_REASON = { ...BY_CLAIM, reason }
const LEDGER = { buyer: typedId, date }

/** 모양은 nested에서 본다 (옵션 항목·별칭·변형 재고·고른 옵션 — validate-options.ts) */
const nestedShape: Check = () => null
const quantity: Check = (v) => (isInt(v, 1) ? null : '수량은 1 이상 정수여야 한다')

/** 옵션 방송의 상품 등록·수정 필드 (R-19, D-O-04·D-O1-03): 모양과 글 칸 */
function productOptionShapes(e: Readonly<Record<string, unknown>>): EventProblem[] {
  return [
    ...(e.options === undefined ? [] : checkOptionsShape(e.options).problems),
    ...(e.aliases === undefined ? [] : checkAliasesShape(e.aliases).problems),
    ...(e.stocks === undefined ? [] : checkStocksShape(e.stocks)),
  ]
}

function productOptionTexts(e: Readonly<Record<string, unknown>>): [string, string][] {
  return [...(e.options === undefined ? [] : checkOptionsShape(e.options).texts), ...(e.aliases === undefined ? [] : checkAliasesShape(e.aliases).texts)]
}

// ── 확인 중 칸 (R-2 "확인 중", D-RETRO-80) ───────────────────────────────

/** 확인 중으로 올린 쪽 */
export const TENTATIVE_BY: readonly string[] = ['WORKER', 'SYNC']
/**
 * 지금 쓰는 까닭 낱말 (화면이 쉬운 문장으로 바꾼다). 엔진은 모양(영문 대문자·숫자·`_` 1~32자)만 검사한다 —
 * 일꾼이 낱말을 더해도 서버·엔진을 먼저 고치지 않아도 되게(모르는 낱말은 화면이 "확인이 필요해요"로 보인다).
 */
export const TENTATIVE_REASONS = Object.freeze({
  /** 번호 근거가 하나뿐 (말한 번호만, 또는 화면 번호표만) */
  NUMBER_SINGLE_SOURCE: 'NUMBER_SINGLE_SOURCE',
  /** 말한 번호와 화면 번호표가 다름 (숫자 쌍 불일치) */
  NUMBER_MISMATCH: 'NUMBER_MISMATCH',
  /** 오늘 쓰는 번호대 밖 */
  NUMBER_OUT_OF_RANGE: 'NUMBER_OUT_OF_RANGE',
  /** 금액 근거가 하나뿐 (규칙 값만, 또는 LLM 값만) */
  PRICE_SINGLE_SOURCE: 'PRICE_SINGLE_SOURCE',
  /** 금액 답이 갈림 (규칙 값 ≠ LLM 값) */
  PRICE_DISAGREE: 'PRICE_DISAGREE',
  /** 자릿수·가격대가 이 판매자와 맞지 않음 */
  PRICE_OUT_OF_RANGE: 'PRICE_OUT_OF_RANGE',
  /** 품종 답이 갈리거나 사전에 없음 */
  NAME_UNSURE: 'NAME_UNSURE',
  /** 다른 계정이 넣은 값 (계정 동기화) */
  OTHER_ACCOUNT: 'OTHER_ACCOUNT',
  /** 이 번호로 기다리는 찜이 있음 (계정 동기화) */
  PENDING_CLAIMS: 'PENDING_CLAIMS',
} as const)
/** 확인 중 칸의 크기 제한: 까닭 6개, 후보는 칸마다 4개, 품종 후보 60자 */
export const TENTATIVE_LIMITS = Object.freeze({ reasons: 6, candidates: 4, name: 60 })
const TENTATIVE_REASON_RE = /^[A-Z][A-Z0-9_]{0,31}$/
const TENTATIVE_KEYS: readonly string[] = ['by', 'reasons', 'candidates']
const CANDIDATE_KEYS: readonly string[] = ['no', 'price', 'name']
const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** product.register의 tentative 칸: 모양 문제와 글 칸(품종 후보) */
function checkTentativeShape(value: unknown): { readonly problems: EventProblem[]; readonly texts: [string, string][] } {
  const problems: EventProblem[] = []
  const texts: [string, string][] = []
  const bad = (field: string, message: string): void => void problems.push({ field, message })
  if (!isRecord(value)) {
    bad('tentative', '확인 중 칸은 { by, reasons, candidates? } 객체여야 한다')
    return { problems, texts }
  }
  for (const key of Reflect.ownKeys(value)) if (typeof key !== 'string' || !TENTATIVE_KEYS.includes(key)) bad(`tentative.${String(key)}`, '확인 중 칸에 없는 항목이다')
  if (typeof value.by !== 'string' || !TENTATIVE_BY.includes(value.by)) bad('tentative.by', `${TENTATIVE_BY.join(' / ')} 중 하나여야 한다`)
  const reasons = value.reasons
  if (!Array.isArray(reasons) || reasons.length < 1 || reasons.length > TENTATIVE_LIMITS.reasons) bad('tentative.reasons', `까닭 낱말은 1~${String(TENTATIVE_LIMITS.reasons)}개 목록이어야 한다`)
  else if (!reasons.every((reason) => typeof reason === 'string' && TENTATIVE_REASON_RE.test(reason))) bad('tentative.reasons', "까닭 낱말은 영문 대문자로 시작하는 대문자·숫자·'_' 1~32자여야 한다")
  else if (new Set(reasons).size !== reasons.length) bad('tentative.reasons', '까닭 낱말이 겹친다')
  const candidates = value.candidates
  if (candidates === undefined) return { problems, texts }
  if (!isRecord(candidates)) {
    bad('tentative.candidates', '후보는 { no?, price?, name? } 객체여야 한다')
    return { problems, texts }
  }
  for (const key of Reflect.ownKeys(candidates)) if (typeof key !== 'string' || !CANDIDATE_KEYS.includes(key)) bad(`tentative.candidates.${String(key)}`, '후보에 없는 항목이다')
  const list = (key: 'no' | 'price' | 'name', ok: (item: unknown) => boolean, message: string): void => {
    const items = candidates[key]
    if (items === undefined) return
    const field = `tentative.candidates.${key}`
    if (!Array.isArray(items) || items.length > TENTATIVE_LIMITS.candidates) bad(field, `후보는 ${String(TENTATIVE_LIMITS.candidates)}개까지의 목록이어야 한다`)
    else if (!items.every(ok)) bad(field, message)
    else if (new Set(items).size !== items.length) bad(field, '후보가 겹친다')
    else if (key === 'name') for (const item of items as string[]) texts.push([field, item])
  }
  list('no', (item) => isInt(item, 1), '번호 후보는 1 이상 정수여야 한다')
  list('price', (item) => isInt(item, 0), '금액 후보는 0 이상 정수(원)여야 한다')
  list('name', (item) => typeof item === 'string' && item.trim() !== '' && [...item].length <= TENTATIVE_LIMITS.name, `품종 후보는 빈 글이 아닌 ${String(TENTATIVE_LIMITS.name)}자까지의 글이어야 한다`)
  return { problems, texts }
}

const pickShape = (e: Readonly<Record<string, unknown>>): EventProblem[] => (e.options === undefined ? [] : checkPickShape(e.options))
const PRODUCT_OPTIONS = { aliases: nestedShape, options: nestedShape, stocks: nestedShape }
const PICK = { options: nestedShape }

/** 설정 스냅샷: 객체(배열·null 아님). 키·값·범위는 nested에서 checkSettings로 (D-071) */
const settingsShape: Check = (v) => (typeof v === 'object' && v !== null && !Array.isArray(v) ? null : '설정 스냅샷은 키와 값을 짝지은 객체여야 한다')

/** R-1 이벤트 표 = tests/golden/README "이벤트 종류와 필드" (효과 보고만 효과 ID, 문자찜 전화번호만 phoneKey·phoneLast4) */
const SPECS: Readonly<Record<string, Spec>> = {
  'broadcast.start': {
    declares: true,
    required: { [BROADCAST]: id, date, title: freeText },
    optional: { settings: settingsShape },
    nested: (e) => {
      if (e.settings === undefined || settingsShape(e.settings) !== null) return []
      return checkSettings(e.settings).map((p) => ({ field: p.key === null ? 'settings' : `settings.${p.key}`, message: p.message }))
    },
  },
  'broadcast.end': { required: { [BROADCAST]: id } },
  'broadcast.thanks': { required: { [BROADCAST]: id, liveChat: bool } },
  'broadcast.pendingExpire': { required: { [BROADCAST]: id, expire: bool } },
  'product.register': {
    required: { ...BY_PRODUCT, name: freeText, price: money },
    optional: { stock, status: oneOf('OPEN', 'READY'), ...PRODUCT_OPTIONS, tentative: nestedShape, pieces },
    nested: (e) => [...productOptionShapes(e), ...(e.tentative === undefined ? [] : checkTentativeShape(e.tentative).problems)],
    texts: (e) => [...productOptionTexts(e), ...(e.tentative === undefined ? [] : checkTentativeShape(e.tentative).texts)],
    // 확인 중으로 올리는 등록은 공개 전이다 — 바로 판매 중(OPEN)과 함께 쓸 수 없다 (R-2 "확인 중")
    extra: (e) => (e.tentative !== undefined && e.status === 'OPEN' ? { field: 'status', message: '확인 중(tentative)으로 올리는 등록은 OPEN일 수 없다' } : null),
  },
  'product.open': { required: BY_PRODUCT },
  'product.hold': { required: BY_PRODUCT },
  'product.close': { required: BY_PRODUCT },
  'product.update': {
    required: BY_PRODUCT,
    optional: { name: freeText, price: money, stock, applyTo: oneOf('NEW_ONLY', 'UNPAID_CLAIMS'), ...PRODUCT_OPTIONS, pieces },
    nested: productOptionShapes,
    texts: productOptionTexts,
  },
  'product.renumber': { required: { [BROADCAST]: id, from: no, to: no }, optional: { reuseClosed: bool } },
  // 확인 중 상품 확정·거두기 (R-2 "확인 중", D-RETRO-80)
  'product.confirm': { required: BY_PRODUCT, optional: { to: no, name: freeText, price: money, pieces } },
  'product.withdraw': { required: BY_PRODUCT },
  'product.focus': { required: BY_PRODUCT },
  chat: { required: { [BROADCAST]: id, id, ch: channel, nick: text, text }, optional: { owner: bool, publishedAt: time } },
  sms: {
    required: { [BROADCAST]: id, ref: smsRef, no, received },
    optional: { memo, phoneKey, phoneLast4, buyer: typedId, qty: quantity, ...PICK },
    pairs: [['phoneKey', 'phoneLast4']],
    nested: pickShape,
    forbidden: { phone: '전화번호 원문은 엔진에 넣지 않는다 — 서버가 정규화해 phoneKey·phoneLast4로 바꿔 넣는다 (D-061)' },
  },
  'host.cancel': { required: HOST_REASON, optional: PICK, nested: pickShape },
  'host.reject': { required: HOST_REASON, optional: PICK, nested: pickShape },
  'host.promote': { required: HOST_REASON, optional: PICK, nested: pickShape },
  'host.confirm': { required: BY_CLAIM, optional: { reason, ...PICK }, nested: pickShape },
  'host.approveCancel': { required: BY_CLAIM, optional: { reason, ...PICK }, nested: pickShape },
  'host.dismissCancel': { required: BY_CLAIM, optional: { reason, ...PICK }, nested: pickShape },
  'host.assign': {
    required: HOST_REASON,
    optional: { replace: typedId, replaceTo: oneOf('WAITLIST', 'CANCEL'), qty: quantity, ...PICK },
    pairs: [['replace', 'replaceTo']],
    nested: pickShape,
  },
  'host.reopen': { required: { ...BY_PRODUCT, reason }, optional: PICK, nested: pickShape },
  'host.resolveConflict': { required: { ...BY_PRODUCT, decision: oneOf('KEEP', 'SWITCH') }, optional: { reason } },
  'host.convertMessage': { required: { [BROADCAST]: id, msg: typedId, no }, optional: { reason } },
  'host.resolveReview': { required: { ...BY_PRODUCT, item: id, qty: quantity }, optional: { reason, ...PICK }, nested: pickShape },
  'host.dismissReview': { required: { [BROADCAST]: id, item: id }, optional: { reason } },
  'host.blockBuyer': { required: { buyer: typedId, reason } },
  'host.unblockBuyer': { required: { buyer: typedId, reason } },
  'buyer.merge': { required: { from: typedId, into: typedId, reason } },
  'buyer.unmerge': { required: { from: typedId, reason } },
  'effect.labelPrinted': { required: { effectId: id } },
  'effect.thanksSent': { required: { effectId: id } },
  'settlement.shippingOverride': {
    required: { ...LEDGER, mode: oneOf('PICKUP', 'COMBINED', 'FIXED', 'DEFAULT') },
    optional: { amount: money },
    extra: (e) => {
      if (e.mode === 'FIXED' && e.amount === undefined) return { field: 'amount', message: '금액 지정(FIXED)에는 금액이 필요하다' }
      if (e.mode !== 'FIXED' && e.amount !== undefined) return { field: 'amount', message: '금액은 금액 지정(FIXED)일 때만 쓴다' }
      return null
    },
  },
  'settlement.adjust': { required: { ...LEDGER, amount: signed, reason } },
  'settlement.payment': { required: { ...LEDGER, amount: positive }, optional: { memo: freeText } },
  'settlement.refund': { required: { ...LEDGER, amount: positive, reason } },
}

/** 엔진이 처리하는 이벤트 종류 (처음 쓰는 스프린트가 따로 있는 종류는 뺀다) */
export const EVENT_TYPES: readonly string[] = Object.keys(SPECS)

/** 모든 이벤트에 붙는 필드 */
const COMMON_FIELDS: ReadonlySet<string> = new Set(['type', 'seq', 'at'])

/**
 * 기록 전 검사 (서버가 기록하기 전에 거른다, D-072). 문제가 없으면 빈 목록.
 * = 구조 검사(checkShape — applyEvent가 InvalidEventError를 던지는 경우와 같다) + 판매자가 적는 칸의 휴대폰 번호(R-1, D-079·D-080).
 * 휴대폰 번호 문제는 구조 문제 뒤에 오고 code가 'PHONE_NUMBER'다. 이 두 판단에 한해 checkEvent가 문제를 돌려줘도 applyEvent는 처리한다
 * (재생 때는 번호 검사를 하지 않는다, D-079 ⑤). 그 밖의 입력 오류는 둘의 판정이 같다.
 * 형식은 맞지만 지금 상태에 맞지 않는 명령(없는 상품·찜·메시지 등)은 문제가 아니다.
 * 상태 형식이 지금 코어와 다르면 StateFormatError를 던진다(D-072).
 */
export function checkEvent(state: EngineState, event: unknown): EventProblem[] {
  const { problems, phone } = inspect(state, event, true)
  return phone.length === 0 ? problems : [...problems, ...phone]
}

/**
 * 구조 검사: applyEvent가 InvalidEventError를 던지는 경우와 그 문제 목록 (휴대폰 번호 판단은 빼고 — D-079 ⑤).
 * 상태 형식이 지금 코어와 다르면 StateFormatError를 던진다(D-072).
 */
export function checkShape(state: EngineState, event: unknown): EventProblem[] {
  return inspect(state, event, false).problems
}

interface Inspection {
  /** 구조 문제 */
  readonly problems: EventProblem[]
  /** 판매자가 적는 칸의 휴대폰 번호 문제 (구조 검사가 통과한 칸만, withPhone일 때만 본다) */
  readonly phone: EventProblem[]
}

function inspect(state: EngineState, event: unknown, withPhone: boolean): Inspection {
  assertStateFormat(state)
  const phone: EventProblem[] = []
  const only = (problem: EventProblem): Inspection => ({ problems: [problem], phone })
  if (typeof event !== 'object' || event === null || Array.isArray(event)) return only({ field: null, message: '이벤트는 객체여야 한다' })
  const record = event as Readonly<Record<string, unknown>>
  const type = record.type
  if (typeof type !== 'string') return only({ field: 'type', message: '이벤트 종류(type)가 없다' })
  const deferred = ownGet(DEFERRED_EVENTS, type) !== undefined
  const spec = ownGet(SPECS, type)
  if (spec === undefined && !deferred) return only({ field: 'type', message: `모르는 이벤트 종류 '${type}'` })
  const problems: EventProblem[] = []
  if (typeof record.seq !== 'number' || !Number.isSafeInteger(record.seq)) problems.push({ field: 'seq', message: 'seq는 정수여야 한다' })
  const atProblem = time(record.at)
  if (atProblem !== null) problems.push({ field: 'at', message: atProblem })
  // 처음 쓰는 스프린트가 따로 있는 종류는 필드를 아직 정하지 않았다 (applyEvent가 NotImplementedError로 알린다)
  if (spec === undefined) return { problems, phone }
  /** 값이 있는 필드 하나: 구조 검사, 통과하면 판매자가 적는 칸의 휴대폰 번호 판단 */
  const checkField = (field: string, check: Check, value: unknown): boolean => {
    const problem = check(value)
    if (problem !== null) {
      problems.push({ field, message: problem })
      return false
    }
    const judge = withPhone ? PHONE_JUDGES.get(check) : undefined
    if (judge !== undefined && judge.judge(value as string)) phone.push({ field, message: judge.message, code: 'PHONE_NUMBER' })
    return true
  }
  for (const [field, check] of Object.entries(spec.required)) {
    const value = record[field]
    if (value === undefined) {
      problems.push({ field, message: '필수 필드가 없다' })
      continue
    }
    if (checkField(field, check, value) && field === BROADCAST && spec.declares !== true && !state.broadcasts.some((broadcast) => broadcast.id === value)) {
      problems.push({ field, message: `선언하지 않은 방송 '${value as string}'` })
    }
  }
  for (const [field, check] of Object.entries(spec.optional ?? {})) {
    const value = record[field]
    if (value !== undefined) checkField(field, check, value)
  }
  for (const [a, b] of spec.pairs ?? []) {
    const hasA = record[a] !== undefined
    if (hasA !== (record[b] !== undefined)) {
      const [present, missing] = hasA ? [a, b] : [b, a]
      problems.push({ field: missing, message: `${present}와 함께 와야 한다 (한쪽만 있으면 입력 오류)` })
    }
  }
  for (const [field, message] of Object.entries(spec.forbidden ?? {})) {
    if (Object.hasOwn(record, field)) problems.push({ field, message })
  }
  problems.push(...(spec.nested?.(record) ?? []))
  // 표에 없는 필드: 자기 속성이면 값과 상관없이(undefined여도) 입력 오류 — 이름이 다른 번호 필드가 로그에 남지 않게 (D-073)
  for (const key of Reflect.ownKeys(record)) {
    const field = typeof key === 'string' ? key : String(key)
    const known = typeof key === 'string' && (COMMON_FIELDS.has(key) || Object.hasOwn(spec.required, key) || Object.hasOwn(spec.optional ?? {}, key) || Object.hasOwn(spec.forbidden ?? {}, key))
    if (!known) problems.push({ field, message: '이 종류의 이벤트에 없는 필드다 (표에 없는 필드는 받지 않는다)' })
  }
  const extra = problems.length === 0 ? (spec.extra?.(record) ?? null) : null
  if (extra !== null) problems.push(extra)
  // 옵션 방송 (R-19·R-20): 옵션 방송인지, 그 상품의 항목·변형과 맞는지, 수량 상한 — 상태를 본다
  if (problems.length === 0) problems.push(...checkOptionContext(state, type, record))
  // 필드 안쪽의 판매자가 적는 글 칸 (옵션 이름·별칭)의 휴대폰 번호 — 기록 전 검사만
  if (withPhone && problems.length === 0) {
    for (const [field, value] of spec.texts?.(record) ?? []) if (containsPhoneRun(value)) phone.push({ field, message: PHONE_IN_TEXT, code: 'PHONE_NUMBER' })
  }
  return { problems, phone }
}
