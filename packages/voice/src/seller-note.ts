// 판매자 채팅 품종 글 (SPEC VOC-03, DOMAIN_RULES R-23, D-V3-49). 사례: tests/golden/voice-register/seller-note.json.
// 주인 배지가 확실한 채팅 글 하나 → { no, name, price } 또는 null ("93번🍀[청개구리] ₩70,000 [용용]님 감사합니다🍀").
// 순수 함수: 어떤 입력에도 예외를 던지지 않는다. 화면에 보일 때 품종 글은 이스케이프한다(이 함수는 글자만 고른다).
import { normalizeText } from '@livejjim/core'

export interface SellerNote {
  readonly no: number
  readonly name: string
  readonly price: number
}

const DEFAULT_MAX_NUMBER = 999
const NAME_MIN = 2
const NAME_MAX = 20
const NUMBER_PATTERN = /(?<![0-9])([0-9]{1,4})번/g
const WON_SIGN = '₩'
/** ₩ 바로 뒤(공백 하나 허용)의 수: 숫자만 또는 쉼표 묶음 */
const PRICE_PATTERN = /^ ?([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?![0-9,.])/
const NAME_CHARS = /^[가-힣A-Za-z ]+$/

/** R-23: 판매자 채팅 글 → { no, name, price } (규칙에 맞지 않으면 null) */
export function readSellerNote(text: unknown, options: { readonly maxNumber?: number } = {}): SellerNote | null {
  try {
    if (typeof text !== 'string') return null
    const normalized = normalizeText(text)
    const max = typeof options?.maxNumber === 'number' && Number.isSafeInteger(options.maxNumber) && options.maxNumber >= 1 ? options.maxNumber : DEFAULT_MAX_NUMBER
    // 2. 번호: '숫자 1~4자리 + 번' 값이 하나뿐
    const numbers = [...normalized.matchAll(NUMBER_PATTERN)]
    const values = new Set(numbers.map((match) => Number(match[1])))
    if (values.size !== 1) return null
    const no = [...values][0] as number
    if (no < 1 || no > max) return null
    // 3. 가격: '₩'이 정확히 하나, 바로 뒤 수
    const wonAt = normalized.indexOf(WON_SIGN)
    if (wonAt < 0 || normalized.indexOf(WON_SIGN, wonAt + 1) >= 0) return null
    const priceMatch = PRICE_PATTERN.exec(normalized.slice(wonAt + WON_SIGN.length))
    if (priceMatch === null) return null
    const price = Number((priceMatch[1] as string).replaceAll(',', ''))
    if (!Number.isSafeInteger(price) || price < 100) return null
    // 4. 품종: 번호 뒤·₩ 앞의 첫 대괄호
    const numberEnd = (numbers[0]?.index ?? 0) + (numbers[0]?.[0].length ?? 0)
    const between = normalized.slice(numberEnd, wonAt)
    const bracket = /\[([^[\]]*)\]/.exec(between)
    if (bracket === null) return null
    const name = (bracket[1] as string).trim().replace(/ +/g, ' ')
    const length = [...name].length
    if (length < NAME_MIN || length > NAME_MAX || !NAME_CHARS.test(name)) return null
    return { no, name, price }
  } catch {
    return null
  }
}
