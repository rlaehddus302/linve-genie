// R-16 빠른 입력 한 줄 (PRD-01, D-030). 애매하면 등록하지 않고 오류를 돌려준다.
// 화면은 오류에 담긴 번호·품종을 채운 채 고칠 칸으로 커서를 보낸다(PRD-01 AC3, S05).
import { resolveSettings, type SettingsOverride } from '../settings.ts'
import { AMOUNT_MAX_TOKENS, parseAmount } from './amount.ts'
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
 */
function findPrice(tokens: readonly string[], settings: SettingsOverride): { at: number; price: number } | null {
  for (let at = Math.max(0, tokens.length - AMOUNT_MAX_TOKENS); at < tokens.length; at++) {
    const price = parseAmount(tokens.slice(at).join(' '), settings)
    if (price !== null) return { at, price }
  }
  return null
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
  if (found === null) return { error: 'PRICE_MISSING', no, name: rest.join(' ') }
  const name = rest.slice(0, found.at).join(' ')
  if (found.price < MIN_PRICE) return { error: 'PRICE_TOO_LOW', no, name }
  return { no, name, price: found.price }
}
