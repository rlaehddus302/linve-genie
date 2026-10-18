// R-16 빠른 입력 한 줄 (PRD-01, D-030). 애매하면 등록하지 않고 오류를 돌려준다.
// 화면은 오류에 담긴 번호·품종을 채운 채 고칠 칸으로 커서를 보낸다(PRD-01 AC3, S05).
import { resolveSettings, type SettingsOverride } from '../settings.ts'
import { AMOUNT_MAX_TOKENS, isUnitChar, parseAmount, SINO_DIGITS } from './amount.ts'
import { asText, digitRunEnd, isDigitAt, normalizeText } from './text.ts'

export type QuickInputError = 'PRICE_MISSING' | 'NUMBER_MISSING' | 'EMPTY' | 'NUMBER_INVALID' | 'PRICE_TOO_LOW'

/**
 * PRD-01 빠른 입력 한 줄의 해석 결과 (R-16 6).
 * - 성공: 정확히 `{ no, name, price }`
 * - `EMPTY`·`NUMBER_MISSING`·`NUMBER_INVALID`: `{ error }`만
 * - `PRICE_MISSING`·`PRICE_TOO_LOW`: 정확히 `{ error, no, name }`
 */
export type QuickInputResult =
  | { readonly no: number; readonly name: string; readonly price: number }
  | { readonly error: QuickInputError; readonly no?: number; readonly name?: string }

/** 가격 하한 (R-16 4): 단위 설정과 상관없이 100원 미만은 등록하지 않는다 */
const MIN_PRICE = 100
const MAX_NUMBER_DIGITS = 4
const BEON = '번'

/** 번호 바로 뒤에 '/'가 오면 슬래시 형식 (R-16 2): 숫자 [번] / */
function isSlashForm(s: string): boolean {
  const digitsEnd = digitRunEnd(s, 0)
  const next = s[digitsEnd] === BEON ? digitsEnd + 1 : digitsEnd
  return digitsEnd > 0 && s[next] === '/'
}

/** 첫 토큰의 번호: 숫자 1~4자리(선행 0 허용)에 '번'을 붙여 쓴 것까지. 형식이 아니면 null. */
function readNumberToken(token: string): { value: number; hasBeon: boolean } | null {
  const digitsEnd = digitRunEnd(token, 0)
  if (digitsEnd > MAX_NUMBER_DIGITS) return null
  const rest = token.slice(digitsEnd)
  if (rest !== '' && rest !== BEON) return null
  return { value: Number(token.slice(0, digitsEnd)), hasBeon: rest === BEON }
}

/**
 * 끝에서부터 R-14로 해석되는 가장 긴 연속 토큰 묶음의 시작 위치와 가격 (R-16 4).
 * 해석되는 묶음은 AMOUNT_MAX_TOKENS개를 넘지 않으므로 그보다 앞에서 시작하는 묶음은 보지 않는다(적대 입력에서도 선형 시간).
 * `maxTokens`는 단위 테스트가 "모든 묶음을 보는 찾기"와 결과가 같은지 확인할 때만 바꾼다.
 */
export function findPrice(tokens: readonly string[], settings: SettingsOverride, maxTokens = AMOUNT_MAX_TOKENS): { at: number; price: number } | null {
  for (let at = Math.max(0, tokens.length - maxTokens); at < tokens.length; at++) {
    const price = parseAmount(tokens.slice(at).join(' '), settings)
    if (price !== null) return { at, price }
  }
  return null
}

/** 금액 글자: ASCII 숫자, 한글 숫자 일~구, 단위 십·백·천·만 (R-14 3·4). 쉼표·점은 숫자 사이에만 오므로 따로 본다. */
function isAmountNumeral(char: string): boolean {
  return isDigitAt(char, 0) || SINO_DIGITS.has(char) || isUnitChar(char)
}

/**
 * 가격 묶음 바로 앞 토큰이 띄어 쓴 한 금액의 앞부분일 수 있는가 (R-16 머리말 "애매하면 등록하지 않고 오류", R-14 머리말, RA-S01-001·TD-S01-003).
 * R-14가 애매하다고 거부한 금액('1만 500', '5 만')을 R-16 4의 "끝에서부터 가장 긴 묶음"이 꼬리 조각('500', '만')만 가격으로 집어
 * 판매자가 뜻한 것과 다른 가격(500,000원·10,000원)으로 등록하는 길을 막는다.
 * 앞 토큰이 금액 글자·쉼표·점으로만 되어 있고(금액 글자 하나 이상, '원'은 금액의 끝이라 제외) 다음 중 하나이면 애매하다.
 * - 단위·숫자·쉼표·점으로 끝난다: '1만 500', '1.5만 5천', '5천 1만', '1 500', '2 만원', '5 만'
 * - 한글 숫자로 끝나고 가격 묶음이 단위로 시작한다(계수와 단위를 띄어 씀): '오 천', '이만오 천'
 * 한글 숫자로 끝나고 가격 묶음이 숫자·한글 숫자로 시작하면 한 금액으로 이을 수 없어 애매하지 않다('천사 5천', '핑크 오 10').
 */
function isSplitAmount(previous: string, priceStart: string): boolean {
  let numerals = 0
  for (const char of previous) {
    if (isAmountNumeral(char)) numerals++
    else if (char !== ',' && char !== '.') return false
  }
  if (numerals === 0) return false
  return !SINO_DIGITS.has(previous.slice(-1)) || isUnitChar(priceStart)
}

/** 빠른 입력 한 줄 → 번호·품종·가격 (PRD-01, R-16). 어떤 문자열에도 예외를 던지지 않는다. */
export function parseQuickInput(text: string, settings: SettingsOverride = {}): QuickInputResult {
  const config = resolveSettings(settings)
  let s = normalizeText(asText(text))
  if (s === '') return { error: 'EMPTY' }
  if (isSlashForm(s)) s = normalizeText(s.replaceAll('/', ' '))

  const tokens = s.split(' ')
  const first = tokens[0] as string
  if (!isDigitAt(first, 0)) return { error: 'NUMBER_MISSING' }
  const number = readNumberToken(first)
  if (number === null) return { error: 'NUMBER_INVALID' }
  const no = number.value
  if (!(no >= 1 && no <= config['claim.maxNumber'])) return { error: 'NUMBER_INVALID' }

  // 번호 다음 토큰이 '번' 하나이면 번호에 붙는다
  const restStart = !number.hasBeon && tokens[1] === BEON ? 2 : 1
  const rest = tokens.slice(restStart)
  const found = findPrice(rest, config)
  // 가격이 없거나, 가격 묶음 앞 토큰과 이어진 한 금액일 수 있으면(어디서부터 가격인지 애매) 등록하지 않는다
  const previous = found === null ? undefined : rest[found.at - 1]
  if (found === null || (previous !== undefined && isSplitAmount(previous, (rest[found.at] as string).charAt(0)))) {
    return { error: 'PRICE_MISSING', no, name: rest.join(' ') }
  }
  const name = rest.slice(0, found.at).join(' ')
  if (found.price < MIN_PRICE) return { error: 'PRICE_TOO_LOW', no, name }
  return { no, name, price: found.price }
}
