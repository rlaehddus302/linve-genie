// 옵션 방송 입력의 형식 검사 (R-1 "옵션 방송의 이벤트", R-19 "판매 방식"·"옵션 모델"·"수량", R-20 7, D-O-02·D-O-04·D-O1-03).
// - 모양(상태 없이): 옵션 항목·선택지·별칭·가격 차이·변형 수·비교 글자 겹침, 상품 별칭, 변형 재고 값, 수량 정수, 고른 옵션 맵.
// - 상태가 필요한 것: 옵션 방송인지, 그 상품의 항목·선택지와 맞는지, 변형 재고의 키가 그 상품(바꾼 뒤)의 변형인지, 변형 단가 0 이상,
//   수량이 그 방송의 claim.maxQuantity 이하인지, 바로잡기의 번호에 상품이 있는지.
// 모두 구조 검사(checkShape)다 — applyEvent·checkEvent가 같게 입력 오류로 본다. 글 칸의 휴대폰 번호만 기록 전 검사(checkEvent)에서 본다(D-079 ⑤).
import { OPTION_LIMITS, OPTION_TEXT_SEPARATOR, charCount, compareChars, lowestUnitPrice, pickIndexes, variantCount, variantTexts, type OptionItem, type OptionPick } from '../options.ts'
import { resolveSettings, type SaleSettings } from '../settings.ts'
import { leftoverVariant } from './leftover.ts'
import { pget } from './pmap.ts'
import type { EngineState, EventProblem, ProductRecord } from './types.ts'

type Rec = Readonly<Record<string, unknown>>

const isPlain = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)
const CONTROL = /\p{Cc}/u

/** 판매자가 적는 글 하나 (옵션 이름·별칭) — 1~max자, 비교 글자가 비지 않고, 제어 글자 없음 (label·별칭은 `/`·`#`도 없음) */
function wordProblem(value: unknown, max: number, noMarks: boolean): string | null {
  if (typeof value !== 'string') return '문자열이어야 한다'
  const n = charCount(value)
  if (n < 1 || n > max) return `1~${String(max)}자여야 한다 (지금 ${String(n)}자)`
  if (compareChars(value) === '') return '빈 글이면 안 된다 (공백만 있음)'
  if (CONTROL.test(value)) return '제어 글자를 쓸 수 없다'
  if (noMarks && (value.includes(OPTION_TEXT_SEPARATOR) || value.includes('#'))) return "'/'·'#'를 쓸 수 없다 (옵션 글·변형 키의 구분자)"
  return null
}

export interface OptionShape {
  readonly problems: EventProblem[]
  /** 판매자가 적은 글 칸 [필드, 값] — 기록 전 검사가 휴대폰 번호를 본다 */
  readonly texts: [string, string][]
  /** 모양이 맞으면 옵션 항목 (아니면 null) */
  readonly options: readonly OptionItem[] | null
}

/** 옵션 항목 목록의 모양 (R-19 "옵션 모델", D-O-04) */
export function checkOptionsShape(value: unknown, field = 'options'): OptionShape {
  const problems: EventProblem[] = []
  const texts: [string, string][] = []
  const push = (f: string, message: string): void => {
    problems.push({ field: f, message })
  }
  if (!Array.isArray(value)) {
    push(field, '옵션 항목 목록이어야 한다')
    return { problems, texts, options: null }
  }
  if (value.length > OPTION_LIMITS.items) push(field, `옵션 항목은 ${String(OPTION_LIMITS.items)}개까지다 (지금 ${String(value.length)}개)`)
  const itemNames = new Set<string>()
  const words = new Map<string, string>()
  value.forEach((item: unknown, i) => {
    const ip = `${field}[${String(i)}]`
    if (!isPlain(item)) {
      push(ip, '옵션 항목은 { name, choices } 맵이어야 한다')
      return
    }
    for (const key of Object.keys(item)) if (key !== 'name' && key !== 'choices') push(`${ip}.${key}`, '옵션 항목에 없는 칸이다 (name·choices만)')
    const nameProblem = wordProblem(item.name, OPTION_LIMITS.itemName, false)
    if (nameProblem !== null) push(`${ip}.name`, `항목 이름은 ${nameProblem}`)
    else {
      texts.push([`${ip}.name`, item.name as string])
      const key = compareChars(item.name as string)
      if (itemNames.has(key)) push(`${ip}.name`, '한 상품 안의 항목 이름은 서로 달라야 한다')
      itemNames.add(key)
    }
    const choices = item.choices
    if (!Array.isArray(choices) || choices.length < 1 || choices.length > OPTION_LIMITS.choices) {
      push(`${ip}.choices`, `선택지는 1~${String(OPTION_LIMITS.choices)}개 목록이어야 한다`)
      return
    }
    choices.forEach((choice: unknown, j) => {
      const cp = `${ip}.choices[${String(j)}]`
      if (!isPlain(choice)) {
        push(cp, '선택지는 { label, aliases?, price? } 맵이어야 한다')
        return
      }
      for (const key of Object.keys(choice)) if (key !== 'label' && key !== 'aliases' && key !== 'price') push(`${cp}.${key}`, '선택지에 없는 칸이다 (label·aliases·price만)')
      const all: [string, unknown][] = [[`${cp}.label`, choice.label]]
      if (choice.aliases !== undefined) {
        if (!Array.isArray(choice.aliases) || choice.aliases.length > OPTION_LIMITS.aliases) push(`${cp}.aliases`, `별칭은 ${String(OPTION_LIMITS.aliases)}개까지의 목록이어야 한다`)
        else choice.aliases.forEach((alias: unknown, k) => all.push([`${cp}.aliases[${String(k)}]`, alias]))
      }
      for (const [f, word] of all) {
        const problem = wordProblem(word, OPTION_LIMITS.label, true)
        if (problem !== null) {
          push(f, problem)
          continue
        }
        texts.push([f, word as string])
        const key = compareChars(word as string)
        const seen = words.get(key)
        if (seen !== undefined) push(f, `한 상품 안의 선택지 이름·별칭은 비교 글자(공백 빼기·영문 소문자)로 서로 달라야 한다 (${seen}와 같다)`)
        else words.set(key, f)
      }
      if (choice.price !== undefined && !(isInt(choice.price) && Math.abs(choice.price) <= OPTION_LIMITS.price)) {
        push(`${cp}.price`, `가격 차이는 −${String(OPTION_LIMITS.price)}~${String(OPTION_LIMITS.price)} 정수(원)여야 한다`)
      }
    })
  })
  if (problems.length > 0) return { problems, texts, options: null }
  const options = value as readonly OptionItem[]
  const count = variantCount(options)
  if (count > OPTION_LIMITS.variants) push(field, `변형(선택지 조합)은 ${String(OPTION_LIMITS.variants)}개까지다 (지금 ${String(count)}개)`)
  return { problems, texts, options: problems.length > 0 ? null : options }
}

/** 상품 별칭 목록 (R-19 "상품 별칭") */
export function checkAliasesShape(value: unknown, field = 'aliases'): { readonly problems: EventProblem[]; readonly texts: [string, string][] } {
  const problems: EventProblem[] = []
  const texts: [string, string][] = []
  if (!Array.isArray(value) || value.length > OPTION_LIMITS.productAliases) {
    problems.push({ field, message: `상품 별칭은 ${String(OPTION_LIMITS.productAliases)}개까지의 목록이어야 한다` })
    return { problems, texts }
  }
  value.forEach((alias: unknown, i) => {
    const f = `${field}[${String(i)}]`
    const problem = wordProblem(alias, OPTION_LIMITS.productAlias, false)
    if (problem !== null) problems.push({ field: f, message: `상품 별칭은 ${problem}` })
    else texts.push([f, alias as string])
  })
  return { problems, texts }
}

/** 변형 재고 맵의 값 (키는 상품과 함께 checkStocksKeys) */
export function checkStocksShape(value: unknown, field = 'stocks'): EventProblem[] {
  if (!isPlain(value)) return [{ field, message: '변형 재고는 옵션 글 → 재고 맵이어야 한다' }]
  const problems: EventProblem[] = []
  for (const [key, stock] of Object.entries(value)) {
    if (!(isInt(stock) && stock >= 0)) problems.push({ field: `${field}.${key}`, message: '변형 재고는 0 이상 정수여야 한다' })
  }
  return problems
}

/** 변형 재고의 키는 그 상품(바꾼 뒤)의 변형 옵션 글이어야 한다 (D-O1-03) */
function checkStocksKeys(stocks: Rec, options: readonly OptionItem[], field = 'stocks'): EventProblem[] {
  if (options.length === 0) return [{ field, message: '옵션이 없는 상품에는 변형 재고를 쓰지 않는다 (재고는 stock)' }]
  const texts = new Set(variantTexts(options))
  return Object.keys(stocks)
    .filter((key) => !texts.has(key))
    .map((key) => ({ field: `${field}.${key}`, message: `그 상품의 변형이 아니다 (옵션 글은 선택지 이름을 항목 순서대로 '/'로)` }))
}

/** 고른 옵션 맵의 모양: 항목 이름 → label 문자열 */
export function checkPickShape(value: unknown, field = 'options'): EventProblem[] {
  if (!isPlain(value)) return [{ field, message: '고른 옵션은 항목 이름 → 선택지 이름 맵이어야 한다' }]
  return Object.entries(value)
    .filter(([, label]) => typeof label !== 'string')
    .map(([key]) => ({ field: `${field}.${key}`, message: '선택지 이름은 문자열이어야 한다' }))
}

// ── 상태가 필요한 검사 ───────────────────────────────────────────────────

function broadcastSettings(state: EngineState, b: unknown): SaleSettings | undefined {
  return state.broadcasts.find((broadcast) => broadcast.id === b)?.settings
}

function productAt(state: EngineState, b: unknown, no: unknown): ProductRecord | null {
  if (typeof b !== 'string' || !isInt(no)) return null
  return pget(state.slots, `${b}/${String(no)}`)?.product ?? null
}

const NOT_OPTION_BROADCAST = '상품명·옵션도 받는 방송(claim.parseMode=OPTIONS)에서만 쓴다 (R-19 "판매 방식", D-O-02)'

/** 옵션 방송만의 필드 */
const OPTION_FIELDS: Readonly<Record<string, readonly string[]>> = {
  'product.register': ['aliases', 'options', 'stocks'],
  'product.update': ['aliases', 'options', 'stocks'],
  sms: ['qty', 'options'],
  'host.assign': ['qty', 'options'],
  'host.cancel': ['options'],
  'host.reject': ['options'],
  'host.promote': ['options'],
  'host.confirm': ['options'],
  'host.approveCancel': ['options'],
  'host.dismissCancel': ['options'],
  'host.reopen': ['options'],
}

/** 옵션 방송만의 이벤트 */
const OPTION_EVENTS = new Set(['product.focus', 'host.resolveReview', 'host.dismissReview'])

/** 고른 옵션이 그 상품의 모든 항목과 맞는가 (선택지 이름은 label) */
function pickProblems(product: ProductRecord | null, pick: unknown, required: boolean, field = 'options'): EventProblem[] {
  if (pick === undefined) {
    return required && product !== null && product.options.length > 0 ? [{ field, message: '옵션 상품이면 모든 항목의 옵션을 적어야 한다' }] : []
  }
  if (product === null) return [{ field, message: '그 번호에 상품이 없어 옵션을 적을 수 없다 (상품을 먼저 등록한다)' }]
  if (product.options.length === 0) return [{ field, message: '옵션이 없는 상품에는 옵션을 적지 않는다' }]
  return pickIndexes(product.options, pick as Rec as Readonly<Record<string, string>>) === null
    ? [{ field, message: `그 상품의 모든 항목(${product.options.map((item) => item.name).join('·')})에 있는 선택지를 하나씩 적어야 한다` }]
    : []
}

function qtyProblem(value: unknown, settings: SaleSettings, field = 'qty'): EventProblem[] {
  const max = settings['claim.maxQuantity']
  return isInt(value) && value >= 1 && value <= max ? [] : [{ field, message: `수량은 1~${String(max)} 정수여야 한다 (claim.maxQuantity)` }]
}

/**
 * 상태가 필요한 옵션 방송 검사. 다른 구조 문제가 없을 때만 부른다(방송은 선언된 방송이다).
 * @returns 구조 문제 (빈 목록이면 통과)
 */
export function checkOptionContext(state: EngineState, type: string, e: Rec): EventProblem[] {
  const settings = broadcastSettings(state, e.b) ?? resolveSettings({})
  const optionBroadcast = settings['claim.parseMode'] === 'OPTIONS'
  if (OPTION_EVENTS.has(type) && !optionBroadcast) return [{ field: 'type', message: NOT_OPTION_BROADCAST }]
  const fields = OPTION_FIELDS[type] ?? []
  const used = fields.filter((field) => e[field] !== undefined)
  if (used.length > 0 && !optionBroadcast) return used.map((field) => ({ field, message: NOT_OPTION_BROADCAST }))
  if (!optionBroadcast) return []
  const product = productAt(state, e.b, e.no)
  switch (type) {
    case 'product.register': {
      const options = (e.options as readonly OptionItem[] | undefined) ?? []
      const problems: EventProblem[] = []
      if (e.stocks !== undefined) problems.push(...checkStocksKeys(e.stocks as Rec, options))
      // 가격 없는 확인 중 등록(D-RECOG-22)은 단가를 아직 셈하지 않는다 — 가격을 채울 때(update·confirm) 본다
      if (options.length > 0 && e.price !== undefined && lowestUnitPrice(e.price as number, options) < 0) problems.push({ field: 'options', message: '변형 단가(상품 가격 + 가격 차이)는 0원 이상이어야 한다' })
      return problems
    }
    case 'product.update': {
      if (product === null) return []
      const options = (e.options as readonly OptionItem[] | undefined) ?? product.options
      const price = (e.price as number | undefined) ?? product.price
      const problems: EventProblem[] = []
      if (e.stocks !== undefined) problems.push(...checkStocksKeys(e.stocks as Rec, options))
      if (options.length > 0 && price !== null && lowestUnitPrice(price, options) < 0) problems.push({ field: e.options === undefined ? 'price' : 'options', message: '변형 단가(상품 가격 + 가격 차이)는 0원 이상이어야 한다' })
      return problems
    }
    case 'sms':
      return [...(e.qty === undefined ? [] : qtyProblem(e.qty, settings)), ...pickProblems(product, e.options, true)]
    case 'host.assign':
      return [...(e.qty === undefined ? [] : qtyProblem(e.qty, settings)), ...(product === null && e.options === undefined ? [] : pickProblems(product, e.options, true))]
    case 'host.resolveReview': {
      if (product === null) return [{ field: 'no', message: '그 방송에 그 번호의 상품이 없다 (R-20 7)' }]
      return [...qtyProblem(e.qty, settings), ...pickProblems(product, e.options, true)]
    }
    case 'product.confirm': {
      // 확정하며 정하는 금액도 변형 단가가 0원 아래로 내려가면 안 된다 (R-19 "가격")
      if (product === null || e.price === undefined || product.options.length === 0) return []
      return lowestUnitPrice(e.price as number, product.options) < 0 ? [{ field: 'price', message: '변형 단가(상품 가격 + 가격 차이)는 0원 이상이어야 한다' }] : []
    }
    case 'product.withdraw':
    case 'product.focus':
    case 'host.dismissReview':
      return []
    default: {
      // 찜을 가리키는 방송자 조치의 변형 고르기 (적지 않으면 엔진이 그 구매자의 활성 찜 하나를 찾는다).
      // 번호를 바꿔 남은 변형 보류 찜(R-10 1)은 그 번호에 상품이 없거나 다른 상품이어도 그 찜의 옵션을 적으면 받는다 (R-5, R-19)
      const problems = pickProblems(product, e.options, false)
      if (problems.length === 0) return problems
      // 고른 옵션 맵 모양과 번호는 구조 검사가 이미 확인했다
      const slot = pget(state.slots, `${String(e.b)}/${String(e.no)}`)
      return leftoverVariant(slot, (id) => pget(state.claims, id), e.options as OptionPick) === null ? problems : []
    }
  }
}
