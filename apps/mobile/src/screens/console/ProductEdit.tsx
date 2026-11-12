// 상품 수정은 입력의 확인 버튼에서 저장한다. 창을 닫으면 입력 중인 값을 버린다.
import { useEffect, useRef, useState } from 'react'
import { Animated, Keyboard, TextInput, View } from 'react-native'
import type { Product } from '@livejjim/web/src/api/types.ts'
import { isApiError } from '../../api/client.ts'
import { koreanWon } from '../../lib/korean-won.ts'
import { productKey } from '../../lib/derive.ts'
import { formatWon } from '../../lib/words.ts'
import { BigButton, BottomSheet, ErrorLine, Icon, Txt, font, useKit, useWrongShake, Tap } from '../../ui/kit/index.ts'
import { RADIUS, SPACE, TYPE, WEIGHT } from '../../ui/kit/tokens.ts'
import { useConsoleApi } from './context.ts'
import { BigNumber, NumberKeys, PRICE_LIMIT, noLimitWords, typeDigits } from './ProductAdd.tsx'
import { ProductDetail, rowName } from './ProductBoard.tsx'

export type EditField = 'no' | 'name' | 'price'

/** 고친 값 (칸마다 적은 글 그대로 — 숫자 칸은 숫자만). 없거나 빈 칸은 안 바꿈 */
export type EditDraft = Partial<Record<EditField, string>>

export const EDIT_LABEL: Readonly<Record<EditField, string>> = { no: '번호', name: '품종', price: '가격' }
export const EDIT_DONE = '확인'
/** 방송에 번호 끝이 없을 때 번호 칸이 받는 가장 큰 수 (상품 추가와 같다) */
const NO_FALLBACK_MAX = 9999
const PRICE_DIGITS = 9
const NAME_MAX = 40

export interface EditPlan {
  /** 바꿀 번호 (안 바꾸면 null) */
  readonly no: number | null
  readonly name: string | null
  readonly price: number | null
}

/** 적은 값에서 실제로 바뀌는 것만 (빈 칸·같은 값은 안 바꿈) */
export function editPlan(product: Pick<Product, 'no' | 'name' | 'price'>, draft: EditDraft): EditPlan {
  const no = draft.no === undefined || draft.no === '' ? null : Number(draft.no)
  const name = draft.name === undefined ? null : draft.name.trim()
  const price = draft.price === undefined || draft.price === '' ? null : Number(draft.price)
  return {
    no: no === null || no === product.no ? null : no,
    name: name === null || name === '' || name === product.name.trim() ? null : name,
    price: price === null || price === product.price ? null : price,
  }
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
 * onClose: 창을 내린다(고친 것은 이미 보냈거나 버렸다). onKey: 번호를 바꿔 상품 열쇠가 바뀌었을 때. onDecide: 겹침·승계 정하기(판매자만)
 */
export function ProductSheet({ product, onClose, onKey, onDecide }: { readonly product: Product | undefined; readonly onClose: () => void; readonly onKey: (key: string) => void; readonly onDecide?: () => void }) {
  const api = useConsoleApi()
  const { p } = useKit()
  const closed = api.ended || api.sealed
  const visible = product !== undefined && product.status !== 'CLOSED'
  const [half, setHalf] = useState(false)
  const [field, setField] = useState<EditField | null>(null)
  const [original, setOriginal] = useState<Pick<Product, 'key' | 'no' | 'name' | 'price'> | null>(null)
  const [draft, setDraft] = useState<EditDraft>({})
  const [error, setError] = useState<string | null>(null)
  const [again, setAgain] = useState(0)
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const lastKey = useRef(product?.key)
  const reset = () => {
    setHalf(false)
    setField(null)
    setDraft({})
    setOriginal(null)
    setError(null)
  }
  // 다른 상품을 열면 처음부터 (번호를 바꿔 열쇠가 바뀐 것은 고친 뒤 닫히므로 같다)
  useEffect(() => {
    if (product?.key === lastKey.current) return
    lastKey.current = product?.key
    if (product === undefined) return
    setHalf(false)
    setField(null)
    setDraft({})
    setOriginal(null)
    setError(null)
  }, [product?.key, product])

  const maxNumber = (() => {
    const value = api.data.broadcasts.get(api.b)?.settings['claim.maxNumber']
    return typeof value === 'number' && value > 0 ? value : null
  })()
  const digitLimit = (which: EditField): number => (which === 'no' ? Math.max(String(maxNumber ?? NO_FALLBACK_MAX).length, 1) : PRICE_DIGITS)
  /** 칸 값이 틀렸으면 그 까닭 (빈 칸은 안 바꿈이라 맞다) */
  const wrong = (which: EditField, text: string | undefined): string | null => {
    if (product === undefined || text === undefined || text.trim() === '') return null
    if (which !== 'name' && text.length > digitLimit(which)) return which === 'no' ? noLimitWords(maxNumber ?? NO_FALLBACK_MAX) : PRICE_LIMIT
    if (which === 'no') {
      const to = Number(text)
      if (!Number.isSafeInteger(to) || to < 1) return '번호를 숫자로 적어 주세요.'
      if (maxNumber !== null && to > maxNumber) return `번호는 ${String(maxNumber)}번까지 적을 수 있어요.`
      const other = api.data.products.get(productKey(api.b, to))
      if (to !== product.no && other !== undefined && other.status !== 'CLOSED') return `${String(to)}번은 이미 있어요.`
    }
    if (which === 'price' && Number(text) < 100) return '가격은 100원 이상으로 적어 주세요.'
    return null
  }
  const firstWrong = (values = draft): { readonly field: EditField; readonly message: string } | null => {
    for (const which of ['no', 'name', 'price'] as const) {
      const message = wrong(which, values[which])
      if (message !== null) return { field: which, message }
    }
    return null
  }

  const openField = (which: EditField) => {
    if (product === undefined) return
    if (!half) setOriginal({ key: product.key, no: product.no, name: product.name, price: product.price })
    setError(null)
    setHalf(true)
    setField(which)
  }
  const type = (key: string) => {
    if (saving.current || field === null || field === 'name') return
    const which = field
    setError(null)
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
      setAgain(count => count + 1)
      return
    }
    saving.current = true
    Keyboard.dismiss()
    const plan = editPlan(product, values)
    setBusy(true)
    try {
      let no = product.no
      if (plan.no !== null) {
        const result = await api.command({ type: 'product.renumber', b: api.b, from: product.no, to: plan.no, ...(api.data.products.get(productKey(api.b, plan.no))?.status === 'CLOSED' ? { reuseClosed: true } : {}) })
        if (!result.changed) throw new Error('번호를 바꾸지 못했어요. 같은 번호 상품이 있는지 확인해 주세요.')
        no = plan.no
        onKey(productKey(api.b, no))
      }
      // 가격은 원문 칸으로 보낸다(SRV1 약속 2) — "원"을 붙여 방송 가격 단위와 상관없이 원으로 읽힌다. 품종도 같이 바뀌면 한 번에
      if (plan.price !== null) await api.command({ type: 'product.update', b: api.b, noText: String(no), priceText: `${String(plan.price)}원`, ...(plan.name === null ? {} : { name: plan.name }) })
      else if (plan.name !== null) await api.command({ type: 'product.update', b: api.b, no, name: plan.name })
      finish()
    } catch (caught) {
      setError(isApiError(caught) ? caught.message : caught instanceof Error && caught.message !== '' ? caught.message : '바꾸지 못했어요. 다시 해 주세요.')
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  const shake = useWrongShake(field === null ? null : error, again)
  const before = original !== null && original.key === product?.key ? original : product
  const box = (which: EditField, shown: string, flex: number) => (
    <FieldBox key={which} label={EDIT_LABEL[which]} shown={shown} active={field === which} flex={flex} disabled={closed || busy} onPress={() => openField(which)} />
  )
  const fields = before === undefined ? null : (
    <View style={{ flexDirection: 'row', gap: SPACE.sm }}>
      {box('no', `${String(before.no)}번`, 0.8)}
      {box('name', rowName(before), 1.4)}
      {box('price', formatWon(before.price), 1.3)}
    </View>
  )

  // 고치는 칸: 상품 추가처럼 큰 칸(품종은 현재 이름, 숫자는 자리 글) → [확인] → 숫자판(번호·가격)
  const editor = before === undefined || field === null ? null : (
    <View testID="product-edit" style={{ gap: SPACE.md }}>
      <View style={{ paddingHorizontal: SPACE.xl, gap: SPACE.sm }}>
        <Animated.View style={{ transform: [{ translateX: shake }] }}>
          {field === 'name' ? (
            <TextInput
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
              onSubmitEditing={({ nativeEvent }) => void apply(draft.name === undefined && nativeEvent.text === before.name ? draft : { ...draft, name: nativeEvent.text })}
              style={{ fontSize: TYPE.amount, minHeight: TYPE.amount * 1.5, paddingVertical: 0, color: p.text, ...font(WEIGHT.bold) }}
            />
          ) : (
            <BigNumber
              label={EDIT_LABEL[field]}
              question={field === 'no' ? `${String(before.no)}번` : formatWon(before.price)}
              digits={draft[field] ?? ''}
              format={field === 'no' ? (value) => value : (value) => Number(value).toLocaleString('ko-KR')}
              suffix={field === 'no' ? '번' : '원'}
            />
          )}
        </Animated.View>
        {field === 'price' && Number(draft.price ?? '') >= 10_000 ? (
          <Txt step="body" color="textSub">
            {koreanWon(Number(draft.price))}
          </Txt>
        ) : null}
        {error !== null ? <ErrorLine large>{error}</ErrorLine> : null}
      </View>
      <View style={{ paddingHorizontal: SPACE.xl }}>
        <BigButton label={EDIT_DONE} busy={busy} onPress={() => void apply()} />
      </View>
      {field === 'name' ? null : <NumberKeys doubleZero={field === 'price'} onKey={type} />}
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
      </BottomSheet>
  )
}
