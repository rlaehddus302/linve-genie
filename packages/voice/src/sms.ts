// 음성 문자찜 문장 읽기 (SPEC ORD-08 AC9·VOC-02, DOMAIN_RULES R-21, V1 — D-V1-01·D-V1-02·D-V1-04·D-V1-08·D-V1-12).
// 사례: tests/golden/voice/voice-sms.json (packages/voice 단위 시험이 읽는다).
// 문장 하나 → null(문자찜 문장이 아님 — R-17 상품 등록 추출로) 또는 정확히 { orders, last4, name, time, problem }.
// 애매하면 넣지 않는다: 문제가 있으면 주문을 비우고 이유 하나만 돌려준다.
// 순수 함수: 같은 입력이면 같은 결과, 넘긴 값을 바꾸지 않고, 시계·난수·네트워크를 쓰지 않으며, 어떤 입력에도 예외를 던지지 않는다.
// 토큰·읽는 모양·번호 표시·끊어 말한 번호는 R-17 추출기(extract.ts)의 같은 코드를, 옵션 방식은 코어 parseOptionComment(R-20)를 그대로 쓴다.
import { normalizeText, parseOptionComment, type OptionCatalogEntry, type OptionFocus } from '@livejjim/core'
import { findNumberMarkers, readingForms, tokenize } from './extract.ts'

/** R-21 문제 (9의 순서: CANCEL → NOT_SURE → LAST4_UNCLEAR → NAME_UNCLEAR → TIME_UNCLEAR → NUMBER_UNCLEAR/OPTION_UNCLEAR) */
export type SmsProblem = 'CANCEL' | 'NOT_SURE' | 'LAST4_UNCLEAR' | 'NAME_UNCLEAR' | 'TIME_UNCLEAR' | 'NUMBER_UNCLEAR' | 'OPTION_UNCLEAR'

/** 주문 하나 = `sms` 이벤트 하나. 번호 방식은 qty 1·options 없음, 옵션 방식은 R-20 주문 그대로 */
export interface SmsOrder {
  readonly no: number
  readonly options?: Readonly<Record<string, string>>
  readonly qty: number
}

/** 결과 — 정확히 다섯 키. problem이 있으면 orders는 []이고 last4·name·time은 null */
export interface SmsReading {
  readonly orders: readonly SmsOrder[]
  /** 뒤 4자리 (숫자 4개 글) */
  readonly last4: string | null
  /** 이름 (`김민지님`의 `김민지`) */
  readonly name: string | null
  /** 말한 받은 시각 `H:MM`·`H:MM:SS` (오전·오후는 읽지 않는다 — 부르는 쪽이 ORD-08 AC6 읽기로 정한다) */
  readonly time: string | null
  readonly problem: SmsProblem | null
}

export interface SmsReadOptions {
  /** claim.parseMode — `OPTIONS`이면 옵션 방식, 그 밖(생략 포함)은 번호 방식 */
  readonly parseMode?: string
  /** claim.maxNumber (1~9999 정수가 아니면 999) */
  readonly maxNumber?: number
  /** claim.maxQuantity (1~99 정수가 아니면 10) — 옵션 방식만 */
  readonly maxQuantity?: number
  /** 옵션 방식의 R-20 입력: 그 방송의 판매 종료가 아닌 상품 */
  readonly catalog?: readonly OptionCatalogEntry[]
  /** 옵션 방식의 R-20 입력: 지금 상품과 지난 초 (없으면 null) */
  readonly focus?: OptionFocus | null
}

export const SMS_PROBLEMS: readonly SmsProblem[] = Object.freeze(['CANCEL', 'NOT_SURE', 'LAST4_UNCLEAR', 'NAME_UNCLEAR', 'TIME_UNCLEAR', 'NUMBER_UNCLEAR', 'OPTION_UNCLEAR'])
/** 번호 방식의 서로 다른 번호 최대 수 (R-21 7) */
export const SMS_MAX_ORDERS = 5

const DEFAULT_MAX_NUMBER = 999
const MAX_NUMBER_LIMIT = 9999
const DEFAULT_MAX_QUANTITY = 10
const MAX_QUANTITY_LIMIT = 99
const SMS_WORD = '문자찜'
const SMS_SPLIT_FIRST = '문자'
const SMS_SPLIT_SECOND = '찜'
const CANCEL_WORD = '취소'
/** 아니라는 말·묻는 말 (R-21 3a, D-V1-12): 살필 글이 이것으로 시작하거나 끝나면 NOT_SURE */
const NOT_SURE_STARTS: readonly string[] = Object.freeze(['아니', '아닌', '안', '않', '못', '말고'])
const NOT_SURE_ENDS: readonly string[] = Object.freeze(['나요', '까요'])
const QUESTION_MARKS: readonly string[] = Object.freeze(['?', '？'])
/** 뒤 4자리 앞 낱말 (R-21 4, 읽는 모양으로 비교) */
const LAST4_WORDS = new Set(['끝자리', '뒷자리', '뒷번호', '끝번호'])
const LAST4_VALUE = /^([0-9]{4})번?$/
const NIM = '님'
/** 이름이 아닌 님 앞 말 (R-21 5) */
const NOT_NAMES = new Set(['고객', '손', '회원', '사장', '구매자', '시청자', '선생'])
const NAME_PATTERN = /^[가-힣]{1,10}$/
const HOUR = /^([0-9]{1,2})시$/
const MINUTE = /^([0-9]{1,2})분$/
const SECOND = /^([0-9]{1,2})초$/
const HALF = '반'

const problemOf = (problem: SmsProblem): SmsReading => ({ orders: [], last4: null, name: null, time: null, problem })

const intIn = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback

function optionValue<T>(options: unknown, key: string): T | undefined {
  if (typeof options !== 'object' || options === null) return undefined
  try {
    return (options as Record<string, unknown>)[key] as T | undefined
  } catch {
    return undefined
  }
}

/** 문자찜 표시가 시작하는 토큰 위치 (없으면 -1, R-21 2) */
export function findSmsMarker(tokens: readonly string[]): number {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string
    if (token.startsWith(SMS_WORD)) return i
    if (token === SMS_SPLIT_FIRST && (tokens[i + 1] ?? '').startsWith(SMS_SPLIT_SECOND)) return i
  }
  return -1
}

/**
 * 살필 글 (R-21 3a): 맡은 토큰이 아닌 토큰 그대로(끝 문장 부호를 지운 것),
 * 단 문자찜 표시 토큰은 표시 낱말(`문자찜`, 두 토큰 표시이면 `문자`와 `찜`) 뒤에 붙은 나머지 글(없으면 보지 않음).
 */
function notSureTexts(tokens: readonly string[], assigned: ReadonlySet<number>): string[] {
  const texts: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    if (assigned.has(i)) continue
    const token = tokens[i] as string
    if (token.startsWith(SMS_WORD)) {
      texts.push(token.slice(SMS_WORD.length))
    } else if (token === SMS_SPLIT_FIRST && (tokens[i + 1] ?? '').startsWith(SMS_SPLIT_SECOND) && !assigned.has(i + 1)) {
      // 두 토큰 표시: `문자`는 나머지가 없고, `찜…`은 `찜` 뒤 나머지를 본다
      texts.push((tokens[i + 1] as string).slice(SMS_SPLIT_SECOND.length))
      i++
    } else {
      texts.push(token)
    }
  }
  return texts.filter((text) => text !== '')
}

/** 3a. 아니라는 말·묻는 말 — 정규화한 문장(끝 문장 부호를 지우기 전)의 물음표 또는 살필 글의 시작·끝 */
function isNotSure(text: unknown, tokens: readonly string[], assigned: ReadonlySet<number>): boolean {
  const normalized = normalizeText(typeof text === 'string' ? text : '')
  if (QUESTION_MARKS.some((mark) => normalized.includes(mark))) return true
  return notSureTexts(tokens, assigned).some(
    (piece) => NOT_SURE_STARTS.some((start) => piece.startsWith(start)) || NOT_SURE_ENDS.some((end) => piece.endsWith(end)),
  )
}

/** 첫 읽는 모양 중 패턴에 맞는 것의 첫 묶음 */
function matchForm(forms: readonly string[] | undefined, pattern: RegExp): string | null {
  for (const form of forms ?? []) {
    const found = pattern.exec(form)
    if (found !== null) return found[1] ?? ''
  }
  return null
}

/** 숫자 1~2개 글 → 정수 */
const small = (digits: string): number => Number(digits)
const two = (value: number): string => String(value).padStart(2, '0')

interface Part<T> {
  readonly value: T | null
  readonly unclear: boolean
}

/** 4. 뒤 4자리 */
function readLast4(forms: readonly (readonly string[])[], assigned: Set<number>): Part<string> {
  const values = new Set<string>()
  let unclear = false
  forms.forEach((tokenForms, i) => {
    if (!tokenForms.some((form) => LAST4_WORDS.has(form))) return
    assigned.add(i)
    const digits = matchForm(forms[i + 1], LAST4_VALUE)
    if (digits === null) {
      unclear = true
      return
    }
    assigned.add(i + 1)
    values.add(digits)
  })
  if (unclear || values.size > 1) return { value: null, unclear: true }
  return { value: values.size === 1 ? ([...values][0] as string) : null, unclear: false }
}

const isName = (candidate: string): boolean => NAME_PATTERN.test(candidate) && !NOT_NAMES.has(candidate)

/** 5. 이름 */
function readName(tokens: readonly string[], forms: readonly (readonly string[])[], assigned: Set<number>): Part<string> {
  const names = new Set<string>()
  tokens.forEach((_token, i) => {
    const tokenForms = forms[i] ?? []
    // 토큰 `님` 하나: 바로 앞 토큰(그대로)이 이름 후보
    if (tokenForms.includes(NIM)) {
      const previous = tokens[i - 1]
      if (previous !== undefined && isName(previous)) {
        names.add(previous)
        assigned.add(i - 1)
        assigned.add(i)
      }
      return
    }
    // `님`으로 끝나는 읽는 모양: 님 앞 글자가 이름 후보
    for (const form of tokenForms) {
      if (!form.endsWith(NIM)) continue
      const candidate = form.slice(0, -NIM.length)
      if (isName(candidate)) {
        names.add(candidate)
        assigned.add(i)
      }
      break
    }
  })
  if (names.size > 1) return { value: null, unclear: true }
  return { value: names.size === 1 ? ([...names][0] as string) : null, unclear: false }
}

/** 6. 받은 시각 */
function readTime(forms: readonly (readonly string[])[], assigned: Set<number>): Part<string> {
  const times = new Set<string>()
  let unclear = false
  forms.forEach((tokenForms, i) => {
    const hourText = matchForm(tokenForms, HOUR)
    if (hourText === null) return
    assigned.add(i)
    const hour = small(hourText)
    let minute = 0
    let second: number | null = null
    const minuteText = matchForm(forms[i + 1], MINUTE)
    if (minuteText !== null) {
      assigned.add(i + 1)
      minute = small(minuteText)
      const secondText = matchForm(forms[i + 2], SECOND)
      if (secondText !== null) {
        assigned.add(i + 2)
        second = small(secondText)
      }
    } else if ((forms[i + 1] ?? []).includes(HALF)) {
      assigned.add(i + 1)
      minute = 30
    }
    if (hour > 23 || minute > 59 || (second !== null && second > 59)) {
      unclear = true
      return
    }
    times.add(`${String(hour)}:${two(minute)}${second === null ? '' : `:${two(second)}`}`)
  })
  if (unclear || times.size > 1) return { value: null, unclear: true }
  return { value: times.size === 1 ? ([...times][0] as string) : null, unclear: false }
}

/** 7. 번호 방식 주문 (null = NUMBER_UNCLEAR) */
function readNumberOrders(tokens: readonly string[], forms: readonly (readonly string[])[], assigned: ReadonlySet<number>, maxNumber: number): SmsOrder[] | null {
  const markers = findNumberMarkers(tokens, forms, (i) => assigned.has(i))
  if (markers.split || markers.values.length === 0) return null
  const distinct: number[] = []
  for (const value of markers.values) {
    if (!(Number.isSafeInteger(value) && value >= 1 && value <= maxNumber)) return null
    if (!distinct.includes(value)) distinct.push(value)
  }
  if (distinct.length > SMS_MAX_ORDERS) return null
  return distinct.map((no) => ({ no, qty: 1 }))
}

/** 8. 옵션 방식 주문 (null = OPTION_UNCLEAR) */
function readOptionOrder(tokens: readonly string[], marker: number, assigned: ReadonlySet<number>, options: unknown, maxNumber: number): SmsOrder[] | null {
  const text = tokens
    .slice(0, marker)
    .filter((_token, i) => !assigned.has(i))
    .join(' ')
  if (text === '') return null
  const catalog = optionValue<unknown>(options, 'catalog')
  const focus = optionValue<unknown>(options, 'focus')
  const maxQuantity = intIn(optionValue<unknown>(options, 'maxQuantity'), 1, MAX_QUANTITY_LIMIT, DEFAULT_MAX_QUANTITY)
  try {
    const result = parseOptionComment(text, Array.isArray(catalog) ? (catalog as OptionCatalogEntry[]) : [], (focus ?? null) as OptionFocus | null, {
      'claim.maxNumber': maxNumber,
      'claim.maxQuantity': maxQuantity,
    })
    if (result.review !== null || result.cancels.length > 0 || result.orders.length !== 1) return null
    const order = result.orders[0] as SmsOrder
    return [order.options === undefined ? { no: order.no, qty: order.qty } : { no: order.no, options: { ...order.options }, qty: order.qty }]
  } catch {
    // 상품 목록 모양이 틀려도 예외를 던지지 않는다 — 옵션을 못 읽은 것으로
    return null
  }
}

/**
 * 문장 하나 → 문자찜 읽기 (R-21). 문자찜 표시(`문자찜…` 토큰, 또는 `문자` + `찜…`)가 없으면 null.
 * 문자찜 문장이면 상품 등록 추출(R-17)을 하지 않는다 — 부르는 쪽은 readVoiceSentence로 둘 중 하나만 받는다.
 */
export function readSmsSentence(text: unknown, options: SmsReadOptions = {}): SmsReading | null {
  const tokens = tokenize(text)
  if (tokens === null) return null
  const marker = findSmsMarker(tokens)
  if (marker === -1) return null
  const forms = tokens.map(readingForms)
  // 3. 취소
  if (tokens.some((token) => token.startsWith(CANCEL_WORD))) return problemOf('CANCEL')
  const assigned = new Set<number>()
  const last4 = readLast4(forms, assigned)
  const name = readName(tokens, forms, assigned)
  const time = readTime(forms, assigned)
  // 3a. 아니라는 말·묻는 말 (맡은 토큰 4·5·6이 정해진 뒤에 본다 — 이름 `안지민님`·끝자리 숫자는 살피지 않는다)
  if (isNotSure(text, tokens, assigned)) return problemOf('NOT_SURE')
  if (last4.unclear) return problemOf('LAST4_UNCLEAR')
  if (name.unclear) return problemOf('NAME_UNCLEAR')
  if (time.unclear) return problemOf('TIME_UNCLEAR')
  const maxNumber = intIn(optionValue<unknown>(options, 'maxNumber'), 1, MAX_NUMBER_LIMIT, DEFAULT_MAX_NUMBER)
  const optionsMode = optionValue<unknown>(options, 'parseMode') === 'OPTIONS'
  const orders = optionsMode ? readOptionOrder(tokens, marker, assigned, options, maxNumber) : readNumberOrders(tokens, forms, assigned, maxNumber)
  if (orders === null) return problemOf(optionsMode ? 'OPTION_UNCLEAR' : 'NUMBER_UNCLEAR')
  return { orders, last4: last4.value, name: name.value, time: time.value, problem: null }
}
