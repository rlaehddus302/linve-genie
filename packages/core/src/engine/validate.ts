// 이벤트 형식 검사 (R-1 "입력 오류와 맞지 않는 명령", D-050, AC-S03-02, AC-S04-01·06·07).
// - 입력 오류: 표에 없는 종류, 필수 필드가 없거나 값의 형식이 틀림, 함께 와야 하는 필드가 한쪽만 옴(D-065, D-061),
//   sms에 전화번호 원문 필드 phone이 있음(D-061), 표에 없는 필드(모든 종류, 값과 상관없이 — D-073),
//   판매자가 손으로 적는 글 칸(sms의 ref·memo, 입금 메모, 사유, 방송 제목, 상품 이름)에 휴대폰 번호가 들어 있음
//   (containsPhoneNumber — 숫자만 모은 것이 번호 모양이거나 번호 덩어리·번호 배열이 있음, D-073, DAT-06), 방송 날짜·설정 스냅샷의 형식·범위(D-071),
//   선언하지 않은 방송, seq·at이 수가 아님, 이벤트가 객체가 아님.
//   applyEvent는 상태를 바꾸지 않고 InvalidEventError를 던진다. 서버는 기록하기 전에 checkEvent로 거른다(D-072).
// - 맞지 않는 명령(형식은 맞지만 지금 상태에 맞지 않음)은 입력 오류가 아니다. 엔진이 아무것도 바꾸지 않는다(D-039).
// - 처음 쓰는 스프린트가 따로 있는 종류(effect.failed → S11)와 settlement.groupBy=MANUAL은 applyEvent가 NotImplementedError로 알린다.
// - 상태 형식이 지금 코어와 다르면 문제 목록 대신 StateFormatError를 던진다(D-072).
import { checkSettings } from '../settings.ts'
import { ownGet } from './draft.ts'
import { containsPhoneNumber } from './phone.ts'
import { assertStateFormat } from './state-format.ts'
import { isValidDate, isValidReceivedTime } from './time.ts'
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
 * 판매자가 손으로 적는 글 칸에 휴대폰 번호가 들어 있으면 입력 오류 (R-1·D-073 "메모·ref ②"를 넓힌 것, DAT-06, RA-S04-001·009).
 * 이 칸들은 지울 수 없는 이벤트 로그·엔진 상태(입금 메모는 정산 장부, 문자찜 메모는 표시 이름)·이력 응답·백업에 평문으로 남는다.
 * 시청자가 쓴 글(chat의 text·nick)에는 쓰지 않는다 — 찜을 버리게 되므로(R-3).
 */
const NO_PHONE_IN_TEXT = '휴대폰 번호가 들어 있다 — 판매자가 적는 글 칸에는 전화번호를 넣지 않는다(문자찜은 전화번호 칸 phoneKey·phoneLast4로만) (D-073, DAT-06)'
const withoutPhone =
  (check: Check): Check =>
  (v) =>
    check(v) ?? (containsPhoneNumber(v as string) ? NO_PHONE_IN_TEXT : null)
/** 판매자가 적는 글 (입금 메모·방송 제목·상품 이름) */
const freeText: Check = withoutPhone(text)
const reason: Check = withoutPhone((v) => (typeof v === 'string' && v.trim() !== '' ? null : '사유는 빈 문자열이 아닌 문자열이어야 한다'))
const no: Check = (v) => (isInt(v, 1) ? null : '1 이상 정수여야 한다')
const money: Check = (v) => (isInt(v, 0) ? null : '0 이상 정수(원)여야 한다')
const positive: Check = (v) => (isInt(v, 1) ? null : '1 이상 정수(원)여야 한다')
const signed: Check = (v) => (typeof v === 'number' && Number.isSafeInteger(v) ? null : '정수(원)여야 한다')
const stock: Check = (v) => (isInt(v, 1) ? null : '재고는 1 이상 정수여야 한다')
const bool: Check = (v) => (typeof v === 'boolean' ? null : 'true 또는 false여야 한다')
const time: Check = (v) => (typeof v === 'number' && Number.isFinite(v) ? null : '유한한 수(UTC 밀리초)여야 한다')
const received: Check = (v) => (isValidReceivedTime(v) ? null : '수신 시각은 HH:MM 또는 HH:MM:SS(00:00~23:59:59)여야 한다')
const date: Check = (v) => (isValidDate(v) ? null : '날짜는 실제 있는 YYYY-MM-DD여야 한다')
const channel: Check = (v) => id(v) ?? ((v as string).startsWith('sms:') ? "채널 ID는 'sms:'로 시작할 수 없다 (문자 구매자 ID 자리)" : null)
/** 문자찜 ref·전화번호 키 형식 (R-1 "문자찜 ref와 전화번호", D-061). 정규화한 번호 11자리·하이픈 13자는 키 길이에 못 미친다 */
const SMS_REF_RE = /^[A-Za-z0-9_-]{1,64}$/
const PHONE_KEY_RE = /^[A-Za-z0-9_-]{16,128}$/
const PHONE_LAST4_RE = /^[0-9]{4}$/
/** 문자찜 ref·memo에 휴대폰 번호가 들어 있으면 입력 오류 — 번호는 전화번호 칸으로 (R-1, D-073, DAT-06, 위 withoutPhone) */
const smsRef: Check = withoutPhone((v) => (typeof v === 'string' && SMS_REF_RE.test(v) ? null : "문자찜 ref는 영문·숫자·'_'·'-'로 된 1~64자여야 한다"))
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
}

const BY_PRODUCT = { [BROADCAST]: id, no }
const BY_CLAIM = { [BROADCAST]: id, no, buyer: id }
const HOST_REASON = { ...BY_CLAIM, reason }
const LEDGER = { buyer: id, date }

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
  'product.register': { required: { ...BY_PRODUCT, name: freeText, price: money }, optional: { stock, status: oneOf('OPEN', 'READY') } },
  'product.open': { required: BY_PRODUCT },
  'product.hold': { required: BY_PRODUCT },
  'product.close': { required: BY_PRODUCT },
  'product.update': { required: BY_PRODUCT, optional: { name: freeText, price: money, stock, applyTo: oneOf('NEW_ONLY', 'UNPAID_CLAIMS') } },
  'product.renumber': { required: { [BROADCAST]: id, from: no, to: no } },
  chat: { required: { [BROADCAST]: id, id, ch: channel, nick: text, text }, optional: { owner: bool, publishedAt: time } },
  sms: {
    required: { [BROADCAST]: id, ref: smsRef, no, received },
    optional: { memo, phoneKey, phoneLast4, buyer: id },
    pairs: [['phoneKey', 'phoneLast4']],
    forbidden: { phone: '전화번호 원문은 엔진에 넣지 않는다 — 서버가 정규화해 phoneKey·phoneLast4로 바꿔 넣는다 (D-061)' },
  },
  'host.cancel': { required: HOST_REASON },
  'host.reject': { required: HOST_REASON },
  'host.promote': { required: HOST_REASON },
  'host.confirm': { required: BY_CLAIM, optional: { reason } },
  'host.approveCancel': { required: BY_CLAIM, optional: { reason } },
  'host.dismissCancel': { required: BY_CLAIM, optional: { reason } },
  'host.assign': { required: HOST_REASON, optional: { replace: id, replaceTo: oneOf('WAITLIST', 'CANCEL') }, pairs: [['replace', 'replaceTo']] },
  'host.reopen': { required: { ...BY_PRODUCT, reason } },
  'host.resolveConflict': { required: { ...BY_PRODUCT, decision: oneOf('KEEP', 'SWITCH') }, optional: { reason } },
  'host.convertMessage': { required: { [BROADCAST]: id, msg: id, no }, optional: { reason } },
  'host.blockBuyer': { required: { buyer: id, reason } },
  'host.unblockBuyer': { required: { buyer: id, reason } },
  'buyer.merge': { required: { from: id, into: id, reason } },
  'buyer.unmerge': { required: { from: id, reason } },
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
 * 이벤트 형식 검사. 문제가 없으면 빈 목록.
 * 같은 상태·이벤트에 대해 applyEvent가 입력 오류(InvalidEventError)를 던질 때만, 그리고 그때는 언제나 문제를 돌려준다.
 * 형식은 맞지만 지금 상태에 맞지 않는 명령(없는 상품·찜·메시지 등)은 문제가 아니다.
 * 상태 형식이 지금 코어와 다르면 StateFormatError를 던진다(D-072).
 */
export function checkEvent(state: EngineState, event: unknown): EventProblem[] {
  assertStateFormat(state)
  if (typeof event !== 'object' || event === null || Array.isArray(event)) return [{ field: null, message: '이벤트는 객체여야 한다' }]
  const record = event as Readonly<Record<string, unknown>>
  const type = record.type
  if (typeof type !== 'string') return [{ field: 'type', message: '이벤트 종류(type)가 없다' }]
  const deferred = ownGet(DEFERRED_EVENTS, type) !== undefined
  const spec = ownGet(SPECS, type)
  if (spec === undefined && !deferred) return [{ field: 'type', message: `모르는 이벤트 종류 '${type}'` }]
  const problems: EventProblem[] = []
  if (typeof record.seq !== 'number' || !Number.isSafeInteger(record.seq)) problems.push({ field: 'seq', message: 'seq는 정수여야 한다' })
  const atProblem = time(record.at)
  if (atProblem !== null) problems.push({ field: 'at', message: atProblem })
  // 처음 쓰는 스프린트가 따로 있는 종류는 필드를 아직 정하지 않았다 (applyEvent가 NotImplementedError로 알린다)
  if (spec === undefined) return problems
  for (const [field, check] of Object.entries(spec.required)) {
    const value = record[field]
    if (value === undefined) {
      problems.push({ field, message: '필수 필드가 없다' })
      continue
    }
    const problem = check(value)
    if (problem !== null) problems.push({ field, message: problem })
    else if (field === BROADCAST && spec.declares !== true && !state.broadcasts.some((broadcast) => broadcast.id === value)) {
      problems.push({ field, message: `선언하지 않은 방송 '${value as string}'` })
    }
  }
  for (const [field, check] of Object.entries(spec.optional ?? {})) {
    const value = record[field]
    if (value === undefined) continue
    const problem = check(value)
    if (problem !== null) problems.push({ field, message: problem })
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
  return problems
}
