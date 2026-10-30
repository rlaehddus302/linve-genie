// SRV1 서버 읽기 (D-APP-22~24, acceptance "약속" 1·2): 사람이 친 글 → 값(번호·품종·가격·금액·받은 시각·전화번호).
// 기기(웹·앱·확장)는 이 함수를 부르지 않는다 — 서버 읽기 입구(`POST /api/broadcasts/:id/read` `{ kind, text }`)와
// 원문을 받는 쓰기 API가 부른다. 결과 모양은 옮기기 전 기기 함수(웹 lib/quick.ts·received.ts·money.ts)가 내던 것과 같다(골든 그대로).
// 저장·로그·이벤트를 남기지 않는다(읽기만, AC-SRV1-03). 시각은 인자로 받는다(입구가 서버 시계를 넣는다).
import { formatWon, normalizePhone, parseAmount, parseQuickInput, phoneLast4, resolveReceivedTime, type PriceUnit, type QuickInputError } from '@livejjim/core'

/** 읽기 종류 (약속 1) */
export const READ_KINDS = ['quick', 'fix', 'price', 'money', 'received', 'phone'] as const
export type ReadKind = (typeof READ_KINDS)[number]
/** 한 번에 읽는 글 한도 (약속 1) */
export const READ_TEXT_LIMIT = 2000

export function isReadKind(value: unknown): value is ReadKind {
  return typeof value === 'string' && (READ_KINDS as readonly string[]).includes(value)
}

/** 읽기에 쓰는 그 방송 설정 */
export interface ReadSettings {
  readonly 'price.unit': PriceUnit
  readonly 'claim.maxNumber': number
}

export interface ReadContext {
  readonly settings: ReadSettings
  /** 지금(UTC 밀리초) — 받은 시각의 날짜를 정한다 */
  readonly now: number
}

/** 빠른 입력 한 줄 (kind `quick`) — parseQuickInput + 번호 오류 때 고치기 칸 채우기 + 오류 문장 (AC-S05-11·S06-65) */
export interface QuickReading {
  readonly no: number | null
  readonly name: string | null
  readonly price: number | null
  readonly error: QuickInputError | null
  /** 오류 문장 (AC-S05-11 표 그대로). EMPTY·성공이면 null */
  readonly message: string | null
  /** 번호 오류: 번호 칸에 그대로 둘 글자 (범위 밖 번호는 친 첫 토큰) */
  readonly noText?: string
  /** 번호 오류: 가격 칸에 채울 글자 (나머지에서 읽은 가격) */
  readonly priceText?: string
}

/** 고치기 칸의 번호 칸 (kind `fix`) — 빠른 입력 첫 토큰과 같은 번호 읽기 */
export interface FixNumberReading {
  readonly no: number | null
  readonly error: 'NUMBER_MISSING' | 'NUMBER_INVALID' | null
  readonly message: string | null
}

/** 상품 가격 칸 (kind `price`) — 그 방송의 가격 단위 */
export interface PriceReading {
  readonly amount: number | null
  readonly error: 'PRICE_MISSING' | 'PRICE_TOO_LOW' | null
  readonly message: string | null
}

/** 돈 칸 (kind `money`) — 정산·설정 금액은 늘 원 단위 (R-14, D-029) */
export interface MoneyReading {
  readonly amount: number | null
}

export type ReceivedDay = '어제' | '오늘' | '내일'

/** 문자찜 받은 시각 칸 (kind `received`) — 옮기기 전 웹 lib/received.ts readReceived와 같은 결과 */
export type ReceivedReading =
  | { readonly kind: 'empty' }
  | { readonly kind: 'invalid' }
  | {
      readonly kind: 'ok'
      /** 보내는 값 `HH:MM` 또는 `HH:MM:SS` */
      readonly value: string
      /** 분까지만 적었는가 */
      readonly minute: boolean
      /** 읽은 시각 (UTC 밀리초 — 분까지면 그 분의 시작) */
      readonly time: number
      readonly day: ReceivedDay
      /** 지금보다 늦다 (보내기 전에 묻는다) */
      readonly late: boolean
    }

/** 전화번호 칸 (kind `phone`) — 정리한 번호와 뒤 4자리. 휴대폰 번호가 아니면 둘 다 null */
export interface PhoneReading {
  readonly phone: string | null
  readonly last4: string | null
}

export interface ReadingOf {
  readonly quick: QuickReading
  readonly fix: FixNumberReading
  readonly price: PriceReading
  readonly money: MoneyReading
  readonly received: ReceivedReading
  readonly phone: PhoneReading
}
export type Reading = ReadingOf[ReadKind]

/** 빠른 입력 오류 문장 (AC-S05-11 표 그대로) */
export function quickErrorMessage(error: Exclude<QuickInputError, 'EMPTY'>, maxNumber: number): string {
  switch (error) {
    case 'PRICE_MISSING':
      return '가격을 알아보지 못했어요. 가격 칸에 적어 주세요.'
    case 'PRICE_TOO_LOW':
      return '가격이 100원보다 적어요. 가격을 확인해 주세요.'
    case 'NUMBER_MISSING':
      return '맨 앞에 상품 번호를 적어 주세요. 예: 15 핑크프릴 10000'
    case 'NUMBER_INVALID':
      return `번호는 1부터 ${String(maxNumber)}까지예요. 번호를 확인해 주세요.`
  }
}

/**
 * 번호를 빠뜨렸거나(NUMBER_MISSING) 범위 밖(NUMBER_INVALID)인 줄의 고치기 칸 (AC-S06-65, UX-S05-009):
 * 번호 자리를 뺀 나머지(빠뜨림은 줄 전체, 범위 밖은 첫 토큰 뒤)를 parseQuickInput으로 읽는다 — 나머지 앞에 범위 안의 번호(1)를 붙여 읽은
 * 품종·가격(R-16 4·5). 가격을 읽지 못하면 가격 칸은 비우고 품종은 나머지 전부. 범위 밖이면 번호 칸에 친 첫 토큰을 그대로 둔다.
 */
export function numberErrorFill(text: string, error: 'NUMBER_MISSING' | 'NUMBER_INVALID', settings: ReadSettings): { noText: string; name: string; priceText: string } {
  let line = text.trim()
  // 슬래시 형식(`1000/핑크프릴/10`)은 코어처럼 '/'를 띄어쓰기로 읽는다
  if (/^\d+번?\//.test(line)) line = line.replaceAll('/', ' ')
  const tokens = line.split(/\s+/).filter((token) => token !== '')
  let noText = ''
  let rest = tokens
  if (error === 'NUMBER_INVALID') {
    noText = tokens[0] ?? ''
    rest = tokens.slice(tokens[1] === '번' ? 2 : 1)
  }
  const remainder = rest.join(' ')
  if (remainder === '') return { noText, name: '', priceText: '' }
  const parsed = parseQuickInput(`1 ${remainder}`, settings)
  if (!('error' in parsed)) return { noText, name: parsed.name, priceText: formatWon(parsed.price) }
  return { noText, name: remainder, priceText: '' }
}

/** 빠른 입력 한 줄 읽기 */
export function readQuick(text: string, settings: ReadSettings): QuickReading {
  const parsed = parseQuickInput(text, settings)
  if (!('error' in parsed)) return { no: parsed.no, name: parsed.name, price: parsed.price, error: null, message: null }
  if (parsed.error === 'EMPTY') return { no: null, name: null, price: null, error: 'EMPTY', message: null }
  const message = quickErrorMessage(parsed.error, settings['claim.maxNumber'])
  if (parsed.error === 'NUMBER_MISSING' || parsed.error === 'NUMBER_INVALID') {
    const filled = numberErrorFill(text, parsed.error, settings)
    return { no: null, name: filled.name, price: null, error: parsed.error, message, noText: filled.noText, priceText: filled.priceText }
  }
  return { no: parsed.no ?? null, name: parsed.name ?? null, price: null, error: parsed.error, message }
}

/**
 * 번호 칸 글자 → 번호 (parseQuickInput이 줄의 첫 토큰을 읽는 것과 같다 — 전각 숫자·"15번"·"15 번").
 * 번호 하나만 적힌 칸이면 그 번호, 비면 NUMBER_MISSING, 번호 하나가 아니거나 범위 밖이면 NUMBER_INVALID.
 */
export function readFixNumber(text: string, settings: ReadSettings): FixNumberReading {
  const parsed = parseQuickInput(text, settings)
  const max = settings['claim.maxNumber']
  if ('error' in parsed) {
    if (parsed.error === 'EMPTY') return { no: null, error: 'NUMBER_MISSING', message: quickErrorMessage('NUMBER_MISSING', max) }
    // 번호 뒤에 아무것도 없을 때만 (번호 칸에 품종·가격이 섞이면 번호로 보지 않는다)
    if (parsed.error === 'PRICE_MISSING' && parsed.no !== undefined && parsed.name === '') return { no: parsed.no, error: null, message: null }
  }
  return { no: null, error: 'NUMBER_INVALID', message: quickErrorMessage('NUMBER_INVALID', max) }
}

/** 상품 가격 칸 (그 방송의 가격 단위, 100원 이상) */
export function readPrice(text: string, settings: ReadSettings): PriceReading {
  const amount = parseAmount(text, settings)
  if (amount === null) return { amount: null, error: 'PRICE_MISSING', message: quickErrorMessage('PRICE_MISSING', settings['claim.maxNumber']) }
  if (amount < 100) return { amount, error: 'PRICE_TOO_LOW', message: quickErrorMessage('PRICE_TOO_LOW', settings['claim.maxNumber']) }
  return { amount, error: null, message: null }
}

/** 돈 칸 (원 단위 — 판매자 설정의 천원 단위를 쓰지 않는다: `14` → 14원) */
export function readMoney(text: string): MoneyReading {
  return { amount: text.trim() === '' ? null : parseAmount(text, { 'price.unit': 'WON' }) }
}

/** 고치기 칸 전체(번호·품종·가격) → 고칠 문장 또는 등록 값 (카드 고치기 칸, 서버 음성 흐름) */
export function readFixForm(
  input: { readonly no: string; readonly name: string; readonly price: string },
  settings: ReadSettings,
): { readonly kind: 'fix'; readonly message: string; readonly focus: 'no' | 'price' } | { readonly kind: 'register'; readonly no: number; readonly name: string; readonly price: number } {
  const no = readFixNumber(input.no, settings)
  if (no.no === null) return { kind: 'fix', message: no.message ?? quickErrorMessage('NUMBER_INVALID', settings['claim.maxNumber']), focus: 'no' }
  const price = readPrice(input.price, settings)
  if (price.error !== null || price.amount === null) return { kind: 'fix', message: price.message ?? quickErrorMessage('PRICE_MISSING', settings['claim.maxNumber']), focus: 'price' }
  return { kind: 'register', no: no.no, name: input.name.trim(), price: price.amount }
}

// ── 받은 시각 (AC-S06-12, ORD-08 AC1, R-6, D-089) ─────────────────────────
//   | 친 글자                         | 읽은 값                                                                        |
//   | `20:01` / `2001`                | 20:01 (분까지)                                                                 |
//   | `20:01:05` / `200105`           | 20:01:05                                                                       |
//   | `8:01` / `801` (오전·오후 없음, 앞자리 0 없음, 시 1~12) | 오전·오후 두 읽기 중 지금과의 거리가 짧은 쪽(같으면 이른 쪽) |
//   | `오후 8:01` / `오전 8:01`        | 20:01 / 08:01                                                                  |
//   | `08:01` / `00:30` / `13:05`     | 그대로 24시간 표기                                                             |
//   | `25:00`·`20:61`·`2:5`·그 밖     | 읽지 못함                                                                      |

interface Clock {
  readonly hour: number
  readonly minute: number
  readonly second: number | null
  /** 오전·오후 없이 12시간 표기로 읽힐 수 있다 (앞자리 0 없음, 시 1~12) */
  readonly ambiguous: boolean
}

const pad = (n: number): string => String(n).padStart(2, '0')
const KST_OFFSET_MS = 9 * 3_600_000
const DAY_MS = 86_400_000

function clockText(clock: Pick<Clock, 'hour' | 'minute' | 'second'>): string {
  return clock.second === null ? `${pad(clock.hour)}:${pad(clock.minute)}` : `${pad(clock.hour)}:${pad(clock.minute)}:${pad(clock.second)}`
}

function readBody(body: string): { hourText: string; minute: number; second: number | null } | null {
  let m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(body)
  if (m !== null) return { hourText: m[1] as string, minute: Number(m[2]), second: m[3] === undefined ? null : Number(m[3]) }
  m = /^(\d{1,2})(\d{2})(\d{2})?$/.exec(body)
  if (m === null) return null
  // 숫자만: 3자리 HMM · 4자리 HHMM · 5자리 HMMSS · 6자리 HHMMSS
  const digits = body.length
  if (digits === 3 || digits === 5) return { hourText: body.slice(0, 1), minute: Number(body.slice(1, 3)), second: digits === 5 ? Number(body.slice(3, 5)) : null }
  if (digits === 4 || digits === 6) return { hourText: body.slice(0, 2), minute: Number(body.slice(2, 4)), second: digits === 6 ? Number(body.slice(4, 6)) : null }
  return null
}

function readClock(text: string): Clock | null {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  const m = /^(오전|오후)?\s?([\d:]+)$/.exec(trimmed)
  if (m === null) return null
  const half = m[1] ?? null
  const body = readBody(m[2] as string)
  if (body === null) return null
  const hour = Number(body.hourText)
  if (body.minute > 59 || (body.second !== null && body.second > 59)) return null
  if (half !== null) {
    if (hour > 12) return null
    const h24 = half === '오전' ? hour % 12 : (hour % 12) + 12
    return { hour: h24, minute: body.minute, second: body.second, ambiguous: false }
  }
  if (hour > 23) return null
  const ambiguous = !body.hourText.startsWith('0') && hour >= 1 && hour <= 12
  return { hour, minute: body.minute, second: body.second, ambiguous }
}

/** 한국 날짜 번호 (1970-01-01 KST부터 센 날) */
const kstDay = (ms: number): number => Math.floor((ms + KST_OFFSET_MS) / DAY_MS)

/** 칸 글자 → 읽은 수신 시각. now = 지금(UTC 밀리초) */
export function readReceived(text: string, now: number): ReceivedReading {
  if (text.trim() === '') return { kind: 'empty' }
  const clock = readClock(text)
  if (clock === null) return { kind: 'invalid' }
  const candidates = clock.ambiguous ? [clock.hour % 12, (clock.hour % 12) + 12] : [clock.hour]
  let best: { value: string; time: number; minute: boolean } | null = null
  for (const hour of candidates) {
    const value = clockText({ hour, minute: clock.minute, second: clock.second })
    const resolved = resolveReceivedTime(value, now)
    if (resolved === null) continue
    const distance = Math.abs(resolved.time - now)
    const bestDistance = best === null ? Number.POSITIVE_INFINITY : Math.abs(best.time - now)
    // 거리가 짧은 쪽, 같으면 이른 쪽
    if (best === null || distance < bestDistance || (distance === bestDistance && resolved.time < best.time)) best = { value, time: resolved.time, minute: resolved.minute }
  }
  if (best === null) return { kind: 'invalid' }
  const dayOffset = kstDay(best.time) - kstDay(now)
  const day: ReceivedDay = dayOffset < 0 ? '어제' : dayOffset > 0 ? '내일' : '오늘'
  return { kind: 'ok', value: best.value, minute: best.minute, time: best.time, day, late: best.time > now }
}

/** 전화번호 칸 */
export function readPhone(text: string): PhoneReading {
  const phone = text.trim() === '' ? null : normalizePhone(text)
  return { phone, last4: phone === null ? null : phoneLast4(phone) }
}

/** 읽기 입구 하나 (약속 1): 종류마다 위 함수 */
export function readText<K extends ReadKind>(kind: K, text: string, context: ReadContext): ReadingOf[K]
export function readText(kind: ReadKind, text: string, context: ReadContext): Reading {
  switch (kind) {
    case 'quick':
      return readQuick(text, context.settings)
    case 'fix':
      return readFixNumber(text, context.settings)
    case 'price':
      return readPrice(text, context.settings)
    case 'money':
      return readMoney(text)
    case 'received':
      return readReceived(text, context.now)
    case 'phone':
      return readPhone(text)
  }
}
