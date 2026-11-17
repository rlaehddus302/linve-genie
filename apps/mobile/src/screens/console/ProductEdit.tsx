// 상품 수정은 입력의 확인 버튼에서 저장한다. 창을 닫으면 입력 중인 값을 버린다.
// 11월 12일 라이브 복기(6.2·9.4)에서 더한 물음 — 판정은 엔진이 하고, 앱은 보내기 전에 묻기만 한다:
// - 가격 (D-RETRO-20): 그 상품에 확정된 찜이 있으면 "이미 찜한 손님 n명에게도 새 가격을 적용할까요?" [새 찜부터 | 찜한 손님도].
//   옛: 묻지 않고 보내 서버 기본값(새 찜부터)이 되어, 확정 뒤 고친 가격 5건이 찜 금액에 반영되지 않았다.
// - 번호 (D-RETRO-21): 번호를 바꾸면 엔진이 그 번호의 확정·대기·겹침 찜을 모두 거절한다(R-10) — "찜 n건이 사라져요. 바꿀까요?" [그대로 두기 | 바꾸기].
//   지운 번호 자리로 바꿀 때는 "지운 번호예요. 이 번호로 다시 쓸까요?" [그대로 두기 | 다시 쓰기] 뒤 reuseClosed로 보낸다.
// - 이미 있는 번호 (D-RETRO-22): 그 번호 상품의 품종·가격과 [닫기 | 그 상품 보기].
// - 확인 중(임시 등록) 상품 (D-RETRO-91): 단추가 [이 값으로 확정] — 번호·품종·가격을 고친 뒤 product.confirm까지 보낸다. 확정된 찜이 없어 위 가격·번호 물음은 뜨지 않는다.
// - 품종 후보 단추 (D-VARIETY-01, 사용자 메모 11-13·개선 계획 E1): 상품 자세히와 품종 칸 아래에 한 줄 — 일꾼이 들은 이름 → 이 방송 최근 → 자주 판 품종.
//   누르면 품종 칸이 그 이름으로 바뀌고 [확인](확인 중이면 [이 값으로 확정])으로 저장한다. 한 번에 저장하지 않는다(번호·가격도 보고 누르게).
// - 개수 (D-PIECES-01, 사용자 메모 "66 채홍 3개"): 품종 칸 아래 [−] n개 [+]. 품종 칸에 "채홍 3개"라고 적어도 개수로 나눈다. 가격은 묶음 하나의 값 그대로.
import { productTitle, splitPieces } from '@livejjim/core/format'
import { useEffect, useRef, useState } from 'react'
import { Animated, Keyboard, View } from 'react-native'
import type { Product } from '@livejjim/web/src/api/types.ts'
import { isApiError } from '../../api/client.ts'
import { koreanWon } from '../../lib/korean-won.ts'
import { claimsOfProduct, productKey, productSlots } from '../../lib/derive.ts'
import { isTentative, needsPrice, otherNames } from '../../lib/tentative.ts'
import { localRecent, useVarietyLists, varietyChoices } from '../../lib/varieties.ts'
import type { ScopeData } from '../../lib/scope-data.ts'
import { formatWon, priceWords } from '../../lib/words.ts'
import { FocusInput, BigButton, BottomSheet, ErrorLine, HandwritingButton, HandwritingSheet, Icon, PopupDialog, Txt, font, useKit, useWrongShake, Tap } from '../../ui/kit/index.ts'
import { RADIUS, SPACE, TYPE, WEIGHT } from '../../ui/kit/tokens.ts'
import { useConsoleApi } from './context.ts'
import { BigNumber, NumberKeys, PRICE_LIMIT, SameNumberButtons, SameNumberLine, liveProductAt, noLimitWords, typeDigits, type SameNumber } from './ProductAdd.tsx'
import { ProductDetail, rowName } from './ProductBoard.tsx'
import { PRICE_SCOPE_ALL, PRICE_SCOPE_NEW, claimedBuyers, priceScopeAsk } from './price-scope.ts'
import { PIECES_NOTE, PiecesStepper, VarietyChips } from './VarietyChips.tsx'

export type EditField = 'no' | 'name' | 'price'

/** 고친 값 (칸마다 적은 글 그대로 — 숫자 칸은 숫자만). 없거나 빈 칸은 안 바꿈 */
export type EditDraft = Partial<Record<EditField, string>>

export const EDIT_LABEL: Readonly<Record<EditField, string>> = { no: '번호', name: '품종', price: '가격' }
export const EDIT_DONE = '확인'
/** 확인 중(임시 등록) 상품의 수정창 단추 — 고친 값을 저장하고 확정까지 한다 (D-RETRO-91) */
export const EDIT_CONFIRM = '이 값으로 확정'
/** 가격이 빈 확인 중 상품을 가격 없이 확정하려 할 때 (D-RECOG-22) — 가격 칸을 연다 */
export const PRICE_NEEDED = '가격을 적어 주세요. 가격을 적어야 확정할 수 있어요.'
/** 방송에 번호 끝이 없을 때 번호 칸이 받는 가장 큰 수 (상품 추가와 같다) */
const NO_FALLBACK_MAX = 9999
const PRICE_DIGITS = 9
const NAME_MAX = 40

// ── 저장 전 물음의 글 (D-RETRO-20·21) ──
export { PRICE_SCOPE_ALL, PRICE_SCOPE_NEW, claimedBuyers, priceScopeAsk }
export const RENUMBER_KEEP = '그대로 두기'
export const RENUMBER_GO = '바꾸기'
export const renumberAsk = (claims: number): string => `번호를 바꾸면 이 번호의 찜 ${String(claims)}건이 사라져요. 바꿀까요?`
export const REUSE_ASK = '지운 번호예요. 이 번호로 다시 쓸까요?'
export const REUSE_GO = '다시 쓰기'
export const reuseNote = (no: number): string => `${String(no)}번은 지운 번호예요. 이 번호로 다시 써요.`

export interface EditPlan {
  /** 바꿀 번호 (안 바꾸면 null) */
  readonly no: number | null
  readonly name: string | null
  readonly price: number | null
  /** 바꿀 개수 (안 바꾸면 칸이 없다, D-PIECES-01) */
  readonly pieces?: number
}

/**
 * 적은 값에서 실제로 바뀌는 것만 (빈 칸·같은 값은 안 바꿈). pieces: 개수 칸에서 고른 값(안 건드렸으면 undefined).
 * 품종 칸에 "채홍 3개"처럼 개수까지 적었으면 품종과 개수로 나눈다 — 개수 칸을 건드렸으면 개수 칸 값이 먼저다 (D-PIECES-01)
 */
export function editPlan(product: Pick<Product, 'no' | 'name' | 'price' | 'pieces'>, draft: EditDraft, pieces?: number): EditPlan {
  const no = draft.no === undefined || draft.no === '' ? null : Number(draft.no)
  let name = draft.name === undefined ? null : draft.name.trim()
  let count = pieces
  if (name !== null) {
    const split = splitPieces(name)
    if (split.pieces !== null) {
      name = split.name
      count ??= split.pieces
    }
  }
  const price = draft.price === undefined || draft.price === '' ? null : Number(draft.price)
  return {
    no: no === null || no === product.no ? null : no,
    name: name === null || name === '' || name === product.name.trim() ? null : name,
    price: price === null || price === product.price ? null : price,
    ...(count === undefined || count === (product.pieces ?? 1) ? {} : { pieces: count }),
  }
}

/** 번호를 바꾸면 사라지는 찜 수: 엔진이 거절하는 확정·대기·겹침 찜 (R-10). 보류 찜은 옛 번호에 그대로 남아 세지 않는다 */
export function renumberLoses(data: ScopeData, product: Product): number {
  return claimsOfProduct(data, product).filter((claim) => claim.status === 'CONFIRMED' || claim.status === 'WAITLISTED' || claim.status === 'CONFLICT').length
}

type Answer = 'yes' | 'no' | 'dismiss'

/** 저장 전에 한 번 묻는 팝업. apart: 바깥을 누른 것을 왼쪽 단추와 따로 받는다(왼쪽 단추도 저장을 하는 가격 물음) */
interface Question {
  readonly message: string
  readonly description: string | null
  readonly cancelLabel: string
  readonly confirmLabel: string
  readonly apart: boolean
}

function renumberQuestion(from: number, to: number, lost: number, reuse: boolean): Question {
  const move = `${String(from)}번 → ${String(to)}번`
  if (lost > 0) return { message: renumberAsk(lost), description: reuse ? `${move}\n${reuseNote(to)}` : move, cancelLabel: RENUMBER_KEEP, confirmLabel: RENUMBER_GO, apart: false }
  return { message: REUSE_ASK, description: move, cancelLabel: RENUMBER_KEEP, confirmLabel: REUSE_GO, apart: false }
}

function priceQuestion(product: Pick<Product, 'no' | 'name' | 'price'>, no: number, price: number, buyers: number, apart: boolean): Question {
  const what = [`${String(no)}번`, rowName(product)].filter((part) => part !== '').join(' ')
  return { message: priceScopeAsk(buyers), description: `${what} · ${priceWords(product.price)} → ${formatWon(price)}`, cancelLabel: PRICE_SCOPE_NEW, confirmLabel: PRICE_SCOPE_ALL, apart }
}

/** 번호·품종·가격 칸 하나 (점선 둥근 칸, 왼쪽 위 연필): 누르면 그 칸을 고친다. 원래 값을 보여 주고 지금 고치는 칸의 테두리를 강조한다 */
function FieldBox({ label, shown, active, flex, disabled, onPress }: { readonly label: string; readonly shown: string; readonly active: boolean; readonly flex: number; readonly disabled: boolean; readonly onPress: () => void }) {
  const { p } = useKit()
  return (
    <Tap
      role="button"
      aria-label={`${label} 고치기`}
      aria-selected={active}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ flex, minHeight: 64, paddingTop: SPACE.lg, paddingBottom: SPACE.sm, paddingHorizontal: SPACE.sm, borderRadius: RADIUS.md, borderCurve: 'continuous', borderWidth: 1.5, borderStyle: active ? 'solid' : 'dashed', borderColor: active ? p.primary : p.borderStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? p.pressed : 'transparent' })}
    >
      {disabled ? null : (
        <View aria-hidden pointerEvents="none" style={{ position: 'absolute', top: 5, left: 7 }}>
          <Icon name="edit" size={14} color={active ? p.primary : p.textSub} />
        </View>
      )}
      <Txt step="lead" weight="bold" numberOfLines={1}>
        {shown}
      </Txt>
    </Tap>
  )
}

/**
 * 상품 자세히 아래 창 (D-UX4-30 → D-UX4-106). product가 없으면 닫힌다(닫히는 동안은 아래 창이 마지막 내용을 붙들고 있다 — D-UX4-103).
 * onClose: 창을 내린다(고친 것은 이미 보냈거나 버렸다). onKey: 번호를 바꿔 상품 열쇠가 바뀌었을 때. onDecide: 겹침·승계 정하기(판매자만).
 * onShow: 이미 있는 번호의 [그 상품 보기] — 상품 목록의 그 줄로 가서 그 상품 자세히를 연다 (D-RETRO-22). 없으면 자세히만 바꾼다
 * focus: 열 때 바로 열 칸 — 확인 카드의 [가격 적기]는 'price'(가격 칸 숫자판이 바로 뜬다, D-RECOG-29)
 */
export function ProductSheet({ product, onClose, onKey, onDecide, onShow, focus = null }: { readonly product: Product | undefined; readonly onClose: () => void; readonly onKey: (key: string) => void; readonly onDecide?: () => void; readonly onShow?: (key: string) => void; readonly focus?: EditField | null }) {
  const api = useConsoleApi()
  const { p } = useKit()
  const closed = api.ended || api.sealed
  const visible = product !== undefined && product.status !== 'CLOSED'
  const [half, setHalf] = useState(false)
  const [field, setField] = useState<EditField | null>(null)
  // 손글씨 판 (D-HANDWRITE-01) — 번호·가격 칸에서만
  const [pen, setPen] = useState(false)
  const [original, setOriginal] = useState<Pick<Product, 'key' | 'no' | 'name' | 'price' | 'pieces'> | null>(null)
  const [draft, setDraft] = useState<EditDraft>({})
  // 개수 칸에서 고른 값 (안 건드렸으면 undefined — D-PIECES-01)
  const [pieces, setPieces] = useState<number | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  // 이미 있는 번호의 상품 (D-RETRO-22)
  const [same, setSame] = useState<SameNumber | null>(null)
  const [again, setAgain] = useState(0)
  const [busy, setBusy] = useState(false)
  const [question, setQuestion] = useState<Question | null>(null)
  const answer = useRef<((value: Answer) => void) | null>(null)
  const saving = useRef(false)
  const lastKey = useRef(product?.key)
  /** 물음을 띄우고 답을 기다린다 — 답한 뒤에도 팝업은 다음 물음이나 저장 시작까지 그대로 둔다(물음 둘 사이에 깜빡이지 않게) */
  const ask = (next: Question) =>
    new Promise<Answer>((resolve) => {
      answer.current = resolve
      setQuestion(next)
    })
  const reply = (value: Answer) => {
    const resolve = answer.current
    answer.current = null
    resolve?.(value)
  }
  const reset = () => {
    setHalf(false)
    setField(null)
    setDraft({})
    setPieces(undefined)
    setOriginal(null)
    setError(null)
    setSame(null)
  }
  // 다른 상품을 열면 처음부터 (번호를 바꿔 열쇠가 바뀐 것은 고친 뒤 닫히므로 같다)
  useEffect(() => {
    if (product?.key === lastKey.current) return
    lastKey.current = product?.key
    if (product === undefined) return
    setHalf(false)
    setField(null)
    setDraft({})
    setPieces(undefined)
    setOriginal(null)
    setError(null)
    setSame(null)
    // [가격 적기]로 열었으면 가격 칸을 바로 연다 — 칸을 한 번 더 누르지 않고 숫자판으로 적는다 (D-RECOG-29)
    if (focus !== null && !closed && product.status !== 'CLOSED') {
      setOriginal({ key: product.key, no: product.no, name: product.name, price: product.price, ...(product.pieces === undefined ? {} : { pieces: product.pieces }) })
      setHalf(true)
      setField(focus)
    }
    // 저장 중에 우리가 번호를 바꿔 열쇠가 바뀐 것이면 이어지는 물음을 그대로 둔다
    if (!saving.current) reply('dismiss')
  }, [product?.key, product])
  // 창이 내려가면(다른 쪽에서 상품을 지움) 기다리던 물음을 끝낸다 — 답을 못 받아 저장이 잠긴 채 남지 않게
  useEffect(() => {
    if (!visible) reply('dismiss')
  }, [visible])

  const latest = (): ScopeData => api.latest?.() ?? api.data
  // 품종 후보 단추 (D-VARIETY-01): 일꾼이 들은 이름 → 이 방송 최근(앱 자료 → 서버) → 자주 판 것. 지금 저장된 품종은 빼고
  const lists = useVarietyLists(api.b, visible && !closed)
  const chips = product === undefined || closed ? [] : varietyChoices({ heard: otherNames(product), recent: [...localRecent(api.data.products.values(), api.b), ...lists.recent], frequent: lists.frequent, current: product.name })
  const maxNumber = (() => {
    const value = api.data.broadcasts.get(api.b)?.settings['claim.maxNumber']
    return typeof value === 'number' && value > 0 ? value : null
  })()
  const digitLimit = (which: EditField): number => (which === 'no' ? Math.max(String(maxNumber ?? NO_FALLBACK_MAX).length, 1) : PRICE_DIGITS)
  /** 칸 값이 틀렸으면 그 까닭 (빈 칸은 안 바꿈이라 맞다). same: 이미 그 번호에 있는 상품 */
  const wrong = (which: EditField, text: string | undefined): { readonly message: string; readonly same?: SameNumber } | null => {
    if (product === undefined || text === undefined || text.trim() === '') return null
    if (which !== 'name' && text.length > digitLimit(which)) return { message: which === 'no' ? noLimitWords(maxNumber ?? NO_FALLBACK_MAX) : PRICE_LIMIT }
    if (which === 'no') {
      const to = Number(text)
      if (!Number.isSafeInteger(to) || to < 1) return { message: '번호를 숫자로 적어 주세요.' }
      if (maxNumber !== null && to > maxNumber) return { message: `번호는 ${String(maxNumber)}번까지 적을 수 있어요.` }
      const other = to === product.no ? null : liveProductAt(api.data.products, api.b, to)
      if (other !== null) return { message: `${String(to)}번은 이미 있어요.`, same: other }
    }
    if (which === 'price' && Number(text) < 100) return { message: '가격은 100원 이상으로 적어 주세요.' }
    return null
  }
  const firstWrong = (values = draft): { readonly field: EditField; readonly message: string; readonly same?: SameNumber } | null => {
    for (const which of ['no', 'name', 'price'] as const) {
      const found = wrong(which, values[which])
      if (found !== null) return { field: which, ...found }
    }
    return null
  }

  const openField = (which: EditField) => {
    if (product === undefined) return
    if (!half) setOriginal({ key: product.key, no: product.no, name: product.name, price: product.price, ...(product.pieces === undefined ? {} : { pieces: product.pieces }) })
    setError(null)
    setSame(null)
    setHalf(true)
    setField(which)
  }
  /** 품종 후보 단추: 품종 칸을 열고 그 이름을 넣는다 — 저장은 [확인] (D-VARIETY-01) */
  const pickName = (name: string) => {
    if (product === undefined || closed || busy || saving.current) return
    if (field !== 'name') openField('name')
    setError(null)
    setDraft((was) => ({ ...was, name }))
  }
  const type = (key: string) => {
    if (saving.current || field === null || field === 'name') return
    const which = field
    setError(null)
    setSame(null)
    // 상품 추가와 같은 숫자판 규칙 — 00으로 넘겨도 친 것을 보여 주고, 이미 넘친 뒤에 더 치면 흔든다 (D-UX4-111)
    setDraft((was) => {
      const next = typeDigits(was[which] ?? '', key, digitLimit(which))
      if (next === null) {
        setAgain((count) => count + 1)
        return was
      }
      return { ...was, [which]: next }
    })
  }
  const finish = () => {
    reset()
    onClose()
  }
  const discard = () => {
    if (saving.current) return
    Keyboard.dismiss()
    finish()
  }
  const apply = async (values = draft) => {
    if (product === undefined || closed || saving.current) return
    const bad = firstWrong(values)
    if (bad !== null) {
      setField(bad.field)
      setError(bad.message)
      setSame(bad.same ?? null)
      setAgain(count => count + 1)
      return
    }
    const plan = editPlan(product, values, pieces)
    // 가격이 빈 확인 중 상품은 가격 없이 확정하지 않는다 — 가격 칸을 열고 묻는다 (D-RECOG-22). 서버도 받지 않는다
    if (isTentative(product) && needsPrice(product) && plan.price === null) {
      setField('price')
      setHalf(true)
      if (original === null) setOriginal({ key: product.key, no: product.no, name: product.name, price: product.price, ...(product.pieces === undefined ? {} : { pieces: product.pieces }) })
      setError(PRICE_NEEDED)
      setAgain((count) => count + 1)
      return
    }
    saving.current = true
    Keyboard.dismiss()
    // 확인 중 상품은 확정된 찜이 없어 아래 두 물음(번호를 바꾸면 사라지는 찜·가격 적용 범위)이 뜨지 않는다 — 지운 번호 다시 쓰기 물음만 그대로 탄다
    const tentative = isTentative(product)
    try {
      // ① 번호를 바꾸면 사라지는 찜·지운 번호 다시 쓰기 (D-RETRO-21). [그대로 두기]면 아무것도 보내지 않고 번호 칸으로
      let reuse = false
      if (plan.no !== null) {
        reuse = api.data.products.get(productKey(api.b, plan.no))?.status === 'CLOSED'
        const lost = renumberLoses(api.data, product)
        if ((lost > 0 || reuse) && (await ask(renumberQuestion(product.no, plan.no, lost, reuse))) !== 'yes') {
          setField('no')
          return
        }
      }
      // ② 가격을 어디까지 (D-RETRO-20). 번호도 같이 바꾸면 지금 찜은 번호를 바꿀 때 사라지므로 여기서 묻지 않는다
      let applyTo: 'NEW_ONLY' | 'UNPAID_CLAIMS' | undefined
      if (plan.no === null && plan.price !== null) {
        const buyers = claimedBuyers(product)
        if (buyers > 0) {
          const chosen = await ask(priceQuestion(product, product.no, plan.price, buyers, true))
          // 바깥을 눌렀으면 아무것도 저장하지 않는다 — 친 값은 그대로 남는다
          if (chosen === 'dismiss') return
          applyTo = chosen === 'yes' ? 'UNPAID_CLAIMS' : 'NEW_ONLY'
        }
      }
      setQuestion(null)
      setBusy(true)
      let no = product.no
      if (plan.no !== null) {
        const to = plan.no
        const send = (reuseClosed: boolean) => api.command({ type: 'product.renumber', b: api.b, from: product.no, to, ...(reuseClosed ? { reuseClosed: true } : {}) })
        let result = await send(reuse)
        if (!result.changed) {
          // 못 바꿨다 — 따라잡은 자료에서 그 번호 자리를 다시 본다: 그사이 올라온 상품이면 그 상품을 보여 주고, 지운 번호면 다시 쓸지 묻는다
          const now = latest().products.get(productKey(api.b, to))
          if (now !== undefined && now.status !== 'CLOSED') {
            setSame(now)
            setField('no')
            throw new Error(`${String(to)}번은 이미 있어요.`)
          }
          if (now !== undefined && !reuse) {
            setBusy(false)
            if ((await ask(renumberQuestion(product.no, to, 0, true))) !== 'yes') {
              setField('no')
              return
            }
            setQuestion(null)
            setBusy(true)
            result = await send(true)
          }
          if (!result.changed) throw new Error('번호를 바꾸지 못했어요. 같은 번호 상품이 있는지 확인해 주세요.')
        }
        no = to
        onKey(productKey(api.b, no))
        // 새 번호에서 기다리던 찜이 번호를 바꾸는 순간 확정됐을 수 있다 — 가격도 같이 바꾸는 중이면 그 손님에게도 적용할지 묻는다.
        // 번호는 이미 바뀌었으므로 바깥을 눌러도 [새 찜부터]로 가격을 저장한다
        if (plan.price !== null) {
          const moved = latest().products.get(productKey(api.b, no))
          const buyers = moved === undefined ? 0 : claimedBuyers(moved)
          if (moved !== undefined && buyers > 0) {
            setBusy(false)
            applyTo = (await ask(priceQuestion(moved, no, plan.price, buyers, false))) === 'yes' ? 'UNPAID_CLAIMS' : 'NEW_ONLY'
            setQuestion(null)
            setBusy(true)
          }
        }
      }
      // 가격은 원문 칸으로 보낸다(SRV1 약속 2) — "원"을 붙여 방송 가격 단위와 상관없이 원으로 읽힌다. 품종도 같이 바뀌면 한 번에
      // 개수도 같은 고치기에 싣는다 (D-PIECES-01)
      const withPieces = plan.pieces === undefined ? {} : { pieces: plan.pieces }
      if (plan.price !== null) await api.command({ type: 'product.update', b: api.b, noText: String(no), priceText: `${String(plan.price)}원`, ...(plan.name === null ? {} : { name: plan.name }), ...withPieces, ...(applyTo === undefined ? {} : { applyTo }) })
      else if (plan.name !== null || plan.pieces !== undefined) await api.command({ type: 'product.update', b: api.b, no, ...(plan.name === null ? {} : { name: plan.name }), ...withPieces })
      // 확인 중 상품이면 고친 값으로 확정까지 (D-RETRO-91): 값을 먼저 고치고 그다음에 확정해야 기다리던 찜이 고친 값으로 정해진다.
      // 서버가 "바뀐 것 없음"이면 그사이 다른 쪽이 확정한 것 — 따라잡은 상태를 보이고 조용히 닫는다
      if (tentative) await api.command({ type: 'product.confirm', b: api.b, no })
      // 찜한 손님에게도 적용했고 이미 뽑은 라벨이 있으면 창을 닫지 않고 자세히로 — "라벨 다시 인쇄" 줄이 바로 보인다 (D-RETRO-20)
      const winners = productSlots(product).winnerClaims
      const printed = applyTo === 'UNPAID_CLAIMS' && api.productLabels?.some((label) => label.kind === 'product' && label.claim !== null && winners.includes(label.claim) && label.printed > 0) === true
      if (printed) reset()
      else finish()
    } catch (caught) {
      setError(isApiError(caught) ? caught.message : caught instanceof Error && caught.message !== '' ? caught.message : '바꾸지 못했어요. 다시 해 주세요.')
    } finally {
      saving.current = false
      answer.current = null
      setQuestion(null)
      setBusy(false)
    }
  }
  const show = (key: string) => {
    if (onShow === undefined) onKey(key)
    else onShow(key)
  }

  const shake = useWrongShake(field === null ? null : error, again)
  const before = original !== null && original.key === product?.key ? original : product
  const box = (which: EditField, shown: string, flex: number) => (
    <FieldBox key={which} label={EDIT_LABEL[which]} shown={shown} active={field === which} flex={flex} disabled={closed || busy} onPress={() => openField(which)} />
  )
  const fields = before === undefined ? null : (
    <View style={{ gap: SPACE.sm }}>
      <View style={{ flexDirection: 'row', gap: SPACE.sm }}>
        {box('no', `${String(before.no)}번`, 0.8)}
        {box('name', rowName(before), 1.4)}
        {box('price', priceWords(before.price), 1.3)}
      </View>
      {/* 상품을 누르면 바로 품종 후보 단추 한 줄 — 누르면 품종 칸이 열리며 그 이름이 들어간다 (D-VARIETY-01).
          확인 중 상품에 일꾼이 들은 품종 후보가 있으면 아래 확인 물음(TentativePanel)이 같은 단추를 띄우므로 여기서는 두 번 그리지 않는다 */}
      {half || (product !== undefined && isTentative(product) && otherNames(product).length > 0) ? null : <VarietyChips choices={chips} disabled={busy} onPick={pickName} />}
    </View>
  )
  const sameShown = same !== null && field === 'no' && error !== null ? same : null

  // 고치는 칸: 상품 추가처럼 큰 칸(품종은 현재 이름, 숫자는 자리 글) → [확인] → 숫자판(번호·가격)
  const editor = before === undefined || field === null ? null : (
    <View testID="product-edit" style={{ gap: SPACE.md }}>
      <View style={{ paddingHorizontal: SPACE.xl, gap: SPACE.sm }}>
        <Animated.View style={{ transform: [{ translateX: shake }] }}>
          {field === 'name' ? (
            <FocusInput
              aria-label={EDIT_LABEL.name}
              autoFocus
              value={draft.name ?? before.name}
              onChangeText={(value) => {
                setError(null)
                setDraft((was) => ({ ...was, name: value }))
              }}
              placeholder="어떤 품종인가요?"
              placeholderTextColor={p.placeholder}
              maxLength={NAME_MAX}
              returnKeyType="done"
              editable={!busy}
              // 확인 중 상품은 키보드의 완료로 확정하지 않는다 — 가격·번호도 고치려던 참에 품종만 고친 값으로 찜이 정해지지 않게, [이 값으로 확정]을 눌러야 한다 (D-RETRO-91)
              onSubmitEditing={({ nativeEvent }) => {
                if (isTentative(product)) Keyboard.dismiss()
                else void apply(draft.name === undefined && nativeEvent.text === before.name ? draft : { ...draft, name: nativeEvent.text })
              }}
              style={{ fontSize: TYPE.amount, minHeight: TYPE.amount * 1.5, paddingVertical: 0, color: p.text, ...font(WEIGHT.bold) }}
            />
          ) : (
            <BigNumber
              label={EDIT_LABEL[field]}
              question={field === 'no' ? `${String(before.no)}번` : priceWords(before.price)}
              digits={draft[field] ?? ''}
              format={field === 'no' ? (value) => value : (value) => Number(value).toLocaleString('ko-KR')}
              suffix={field === 'no' ? '번' : '원'}
            />
          )}
        </Animated.View>
        {field === 'name' ? (
          <View style={{ gap: SPACE.sm }}>
            {/* 품종 후보 한 줄 (가로로 민다) · 개수 칸 (D-VARIETY-01·D-PIECES-01) */}
            <VarietyChips choices={chips} selected={draft.name ?? before.name} disabled={busy} inset={SPACE.xl} onPick={pickName} />
            <PiecesStepper pieces={pieces ?? before.pieces ?? 1} disabled={busy} onChange={(next) => { setError(null); setPieces(next) }} />
            {(pieces ?? before.pieces ?? 1) > 1 ? (
              <Txt step="caption" color="textSub" testID="pieces-preview">
                {`${productTitle(splitPieces(draft.name ?? before.name).name, pieces ?? before.pieces)} · ${PIECES_NOTE}`}
              </Txt>
            ) : null}
          </View>
        ) : null}
        {field === 'price' && Number(draft.price ?? '') >= 10_000 ? (
          <Txt step="body" color="textSub">
            {koreanWon(Number(draft.price))}
          </Txt>
        ) : null}
        {/* 휴대폰을 눕혀 두고 손가락으로 숫자 쓰기 (D-HANDWRITE-01) */}
        {field === 'no' || field === 'price' ? <HandwritingButton label={EDIT_LABEL[field]} onPress={() => setPen(true)} /> : null}
        {error !== null ? <ErrorLine large>{error}</ErrorLine> : null}
        {sameShown !== null ? <SameNumberLine product={sameShown} /> : null}
      </View>
      <View style={{ paddingHorizontal: SPACE.xl }}>
        {/* 이미 있는 번호면 [확인] 자리에 [닫기 | 그 상품 보기] — 다른 번호를 치면 [확인]으로 돌아온다 (D-RETRO-22) */}
        {sameShown !== null ? <SameNumberButtons onClose={() => setSame(null)} onShow={() => show(sameShown.key)} /> : <BigButton label={isTentative(product) ? EDIT_CONFIRM : EDIT_DONE} busy={busy} onPress={() => void apply()} />}
      </View>
      {field === 'name' ? null : <NumberKeys doubleZero={field === 'price'} onKey={type} />}
      <HandwritingSheet
        visible={pen && (field === 'no' || field === 'price') && !busy}
        onClose={() => setPen(false)}
        label={field === 'price' ? EDIT_LABEL.price : EDIT_LABEL.no}
        unit={field === 'price' ? '원' : '번'}
        maxLength={digitLimit(field === 'price' ? 'price' : 'no')}
        onInsert={(digits) => {
          if (field !== 'no' && field !== 'price') return
          const which = field
          setError(null)
          setSame(null)
          setDraft((was) => ({ ...was, [which]: digits.replace(/^0+(?=\d)/, '') }))
        }}
      />
    </View>
  )

  return (
      <BottomSheet visible={visible} onClose={discard} title="" half={half} bodyPadding={!half} testID="product-sheet">
        {product === undefined ? null : half ? (
          <View style={{ gap: SPACE.lg, paddingTop: SPACE.md }}>
            <View style={{ paddingHorizontal: SPACE.xl }}>{fields}</View>
            {editor}
          </View>
        ) : (
          <>
            {error !== null ? <ErrorLine>{error}</ErrorLine> : null}
            <ProductDetail product={product} fields={fields} onKey={onKey} onDone={discard} {...(onDecide === undefined ? {} : { onDecide })} />
          </>
        )}
        {/* 저장 전 물음 (D-RETRO-20·21): 단추 둘은 한 줄 — 왼쪽 부정, 오른쪽 긍정. 가격 물음은 왼쪽도 저장이라 바깥 누름을 따로 받는다 */}
        <PopupDialog
          visible={question !== null}
          message={question?.message ?? ''}
          description={question?.description ?? null}
          cancelLabel={question?.cancelLabel ?? ''}
          confirmLabel={question?.confirmLabel ?? ''}
          onCancel={() => reply('no')}
          onConfirm={() => reply('yes')}
          {...(question?.apart === true ? { onDismiss: () => reply('dismiss') } : {})}
        />
      </BottomSheet>
  )
}
