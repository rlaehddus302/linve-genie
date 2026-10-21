// 옵션 방송 입력 오류의 판매자 문장 (D-O2-13, AC-O2-18, R-19 "판매 방식"·"옵션 모델"·"수량").
// 코어 checkEvent 문제의 field(옵션 칸 경로)를 쉬운 한국어 한 문장으로 바꾼다. 영어 칸 이름(options[0].choices…)은 문장에 넣지 않는다.
// - 번호 방송(claim.parseMode ≠ OPTIONS)에 옵션 칸·옵션 이벤트를 보냈는지는 그 범위의 지금 상태(방송 설정 스냅샷)로 본다 — 코어 문장을 읽지 않는다.
// - 옵션 방송 안의 문제는 칸 경로로 고르고, 같은 칸에 뜻이 여럿인 곳(options — 단가·조합 수·항목 수·고른 옵션)만 코어 문제 문장의 열쇠말로 가른다.
//   열쇠말은 packages/core/src/engine/validate-options.ts의 문장이고, 이 파일의 단위 시험(test/o2-option-messages.test.ts)이 코어와 맞는지 늘 본다.
// - 판매자가 적은 말(겹친 이름)은 문장에 그대로 넣는다(응답은 JSON 글이고 화면이 이스케이프한다). 휴대폰 번호처럼 보이는 말은 넣지 않는다.
import { OPTION_LIMITS, containsPhoneRun, getBroadcast, getProduct, resolveSettings, type EngineState, type EventProblem } from '@livejjim/core'
import type { FieldProblem } from './errors.ts'

type Rec = Readonly<Record<string, unknown>>

/** 옵션 방송에서만 쓰는 이벤트 (번호 방송이면 코어가 type 문제로 막는다) */
export const OPTION_EVENT_TYPES: readonly string[] = ['product.focus', 'host.resolveReview', 'host.dismissReview']
/** 옵션 방송에서만 쓰는 칸 */
const OPTION_FIELD_ROOTS = new Set(['options', 'aliases', 'stocks', 'qty'])

/** 세 자리마다 쉼표 */
function grouped(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export const OPTION_MESSAGES = Object.freeze({
  notOptionBroadcast: '이 방송은 번호로만 받기라 옵션을 쓸 수 없어요.',
  duplicate: (word: string) => `‘${word}’이 두 군데 있어요. 한 상품 안에서 이름은 겹치면 안 돼요.`,
  duplicateAnonymous: '같은 이름이 두 군데 있어요. 한 상품 안에서 이름은 겹치면 안 돼요.',
  missing: (items: readonly string[]) => `${items.join('·')}을(를) 골라 주세요.`,
  missingAnonymous: '옵션을 모두 골라 주세요.',
  unknownStock: '없는 옵션의 재고가 있어요.',
  stockValue: '옵션별 재고는 0 이상의 정수로 적어 주세요.',
  stocksShape: '옵션별 재고를 확인해 주세요.',
  stocksWithoutOptions: '옵션이 없는 상품에는 옵션별 재고를 쓰지 않아요. 재고 칸에 적어 주세요.',
  qty: (max: number) => `수량은 1부터 ${String(max)}까지예요.`,
  noProduct: (no: number | null) => (no === null ? '이 방송에 그 번호의 상품이 없어요.' : `이 방송에 ${String(no)}번 상품이 없어요.`),
  negativeUnitPrice: '가격 차이 때문에 값이 0원보다 작아지는 옵션이 있어요.',
  productFirst: '상품을 먼저 등록해 주세요.',
  noOptionsProduct: '이 상품에는 옵션이 없어요. 옵션을 빼고 보내 주세요.',
  pickShape: '옵션을 골라 주세요.',
  optionsShape: '옵션을 확인해 주세요.',
  tooManyItems: `옵션 항목은 ${String(OPTION_LIMITS.items)}개까지예요.`,
  tooManyVariants: `옵션 조합(변형)은 ${String(OPTION_LIMITS.variants)}개까지예요. 선택지를 줄여 주세요.`,
  itemName: `항목 이름은 1~${String(OPTION_LIMITS.itemName)}자로, 줄바꿈 같은 특수 글자 없이 적어 주세요.`,
  choices: `선택지는 항목마다 1~${String(OPTION_LIMITS.choices)}개예요.`,
  choiceWord: `선택지 이름·별칭은 1~${String(OPTION_LIMITS.label)}자로, ‘/’·‘#’ 없이 적어 주세요.`,
  choiceAliases: `선택지 별칭은 ${String(OPTION_LIMITS.aliases)}개까지예요.`,
  choicePrice: `가격 차이는 −${grouped(OPTION_LIMITS.price)}원부터 ${grouped(OPTION_LIMITS.price)}원까지의 정수로 적어 주세요.`,
  productAliases: `상품 별칭은 ${String(OPTION_LIMITS.productAliases)}개까지예요.`,
  productAlias: `상품 별칭은 1~${String(OPTION_LIMITS.productAlias)}자로 적어 주세요.`,
})

/** 옵션 칸 경로 (`options[0].choices[1].aliases[2]` 같은 것 — 화면이 칸을 찾는다). 값이 들어가는 stocks 키는 경로에 넣지 않는다 */
const OPTION_PATH = /^(?:options(?:\[\d{1,3}\](?:\.(?:name|choices(?:\[\d{1,3}\](?:\.(?:label|price|aliases(?:\[\d{1,3}\])?))?)?))?)?|aliases(?:\[\d{1,3}\])?|qty)$/

/** 응답에 담는 칸 이름: 옵션 칸 경로는 그대로, stocks.<옵션 글>은 stocks, options.<항목>(고른 옵션)은 options */
export function optionFieldName(field: string): string | null {
  if (OPTION_PATH.test(field)) return field
  if (field === 'stocks' || field.startsWith('stocks.')) return 'stocks'
  if (field.startsWith('options.')) return 'options'
  return null
}

/** 경로의 값 (`options[0].choices[1].label` → 이벤트에서 그 글) */
function valueAt(event: Rec, path: string): unknown {
  let current: unknown = event
  for (const part of path.match(/[^.[\]]+/g) ?? []) {
    if (typeof current !== 'object' || current === null) return undefined
    current = Object.hasOwn(current, part) ? (current as Record<string, unknown>)[part] : undefined
  }
  return current
}

function rootOf(field: string): string {
  const match = /^[A-Za-z]+/.exec(field)
  return match === null ? field : match[0]
}

function isOptionBroadcast(state: EngineState, b: unknown): boolean {
  if (typeof b !== 'string') return false
  return getBroadcast(state, b)?.settings['claim.parseMode'] === 'OPTIONS'
}

/** 고른 옵션에서 빠졌거나 그 상품에 없는 선택지를 적은 항목 이름 */
function missingItems(state: EngineState, event: Rec): string[] | null {
  const { b, no, options } = event
  if (typeof b !== 'string' || typeof no !== 'number') return null
  const product = getProduct(state, b, no)
  if (product === null) return null
  const pick = typeof options === 'object' && options !== null && !Array.isArray(options) ? (options as Rec) : {}
  const out = product.options
    .filter((item) => {
      const label = Object.hasOwn(pick, item.name) ? pick[item.name] : undefined
      return typeof label !== 'string' || !item.choices.some((choice) => choice.label === label)
    })
    .map((item) => item.name)
  return out.length === 0 ? null : out
}

/**
 * 옵션 칸 문제 하나의 판매자 문장. 옵션 문제가 아니면 null (호출하는 쪽이 지금 문장 표를 쓴다).
 * 휴대폰 번호 문제(code PHONE_NUMBER)는 여기서 다루지 않는다 — 지금 문장 그대로
 */
export function optionProblem(problem: EventProblem, event: Rec, state: EngineState): FieldProblem | null {
  const field = problem.field
  if (field === null) return null
  const type = event.type
  const root = rootOf(field)
  // 번호 방송에 옵션 이벤트·옵션 칸
  if (!isOptionBroadcast(state, event.b)) {
    if (field === 'type' && typeof type === 'string' && OPTION_EVENT_TYPES.includes(type)) return { field: 'type', message: OPTION_MESSAGES.notOptionBroadcast }
    // 모양 문제(options[0].name …)가 먼저 나도 판매자에게는 "이 방송에서는 옵션을 못 쓴다"가 할 일이다 — 칸 뿌리 하나로 모은다
    if (OPTION_FIELD_ROOTS.has(root)) return { field: root, message: OPTION_MESSAGES.notOptionBroadcast }
  }
  const message = problem.message
  const name = optionFieldName(field)
  switch (root) {
    case 'qty': {
      if (field !== 'qty') return null
      const b = event.b
      const settings = (typeof b === 'string' ? getBroadcast(state, b)?.settings : undefined) ?? resolveSettings({})
      const max = settings['claim.maxQuantity']
      return { field: 'qty', message: OPTION_MESSAGES.qty(max) }
    }
    case 'stocks': {
      if (field === 'stocks') return { field: 'stocks', message: message.includes('옵션이 없는 상품') ? OPTION_MESSAGES.stocksWithoutOptions : OPTION_MESSAGES.stocksShape }
      return { field: 'stocks', message: message.includes('변형이 아니다') ? OPTION_MESSAGES.unknownStock : OPTION_MESSAGES.stockValue }
    }
    case 'aliases': {
      if (field === 'aliases') return { field, message: OPTION_MESSAGES.productAliases }
      return name === null ? null : { field: name, message: OPTION_MESSAGES.productAlias }
    }
    case 'options': {
      if (field === 'options') {
        if (message.includes('변형 단가')) return { field, message: OPTION_MESSAGES.negativeUnitPrice }
        if (message.includes('변형(선택지 조합)')) return { field, message: OPTION_MESSAGES.tooManyVariants }
        if (message.includes('옵션 항목은')) return { field, message: OPTION_MESSAGES.tooManyItems }
        if (message.includes('상품이 없어')) return { field, message: OPTION_MESSAGES.productFirst }
        if (message.includes('옵션이 없는 상품')) return { field, message: OPTION_MESSAGES.noOptionsProduct }
        if (message.includes('모든 항목')) {
          const items = missingItems(state, event)
          return { field, message: items === null ? OPTION_MESSAGES.missingAnonymous : OPTION_MESSAGES.missing(items) }
        }
        if (message.includes('고른 옵션')) return { field, message: OPTION_MESSAGES.pickShape }
        return { field, message: OPTION_MESSAGES.optionsShape }
      }
      // 고른 옵션 맵의 값 (options.<항목>)
      if (field.startsWith('options.')) return { field: 'options', message: OPTION_MESSAGES.pickShape }
      if (name === null) return { field: 'options', message: OPTION_MESSAGES.optionsShape }
      if (message.includes('서로 달라야')) {
        const word = valueAt(event, field)
        const safe = typeof word === 'string' && !containsPhoneRun(word)
        return { field: name, message: safe ? OPTION_MESSAGES.duplicate(word) : OPTION_MESSAGES.duplicateAnonymous }
      }
      if (/\.name$/.test(field)) return { field: name, message: OPTION_MESSAGES.itemName }
      if (/\.choices$/.test(field)) return { field: name, message: OPTION_MESSAGES.choices }
      if (/\.price$/.test(field)) return { field: name, message: OPTION_MESSAGES.choicePrice }
      if (/\.aliases$/.test(field)) return { field: name, message: OPTION_MESSAGES.choiceAliases }
      if (/\.(?:label|aliases\[\d+\])$/.test(field)) return { field: name, message: OPTION_MESSAGES.choiceWord }
      return { field: name, message: OPTION_MESSAGES.optionsShape }
    }
    case 'price':
      // 상품 수정의 가격 때문에 변형 단가가 0 아래 (옵션은 그대로)
      return field === 'price' && message.includes('변형 단가') ? { field, message: OPTION_MESSAGES.negativeUnitPrice } : null
    case 'no':
      if (field === 'no' && type === 'host.resolveReview' && message.includes('상품이 없다')) {
        return { field, message: OPTION_MESSAGES.noProduct(typeof event.no === 'number' && Number.isSafeInteger(event.no) ? event.no : null) }
      }
      return null
    default:
      return null
  }
}
