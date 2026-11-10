// 상품 자세히 아래 창 + 고치기 (D-UX4-106, 사용자 지시 2026-11-10):
// "수정할 영역을 눌렀을 때 아래팝업을 하프 화면으로 늘려서 좌우 하단 여백 없이 흰색으로 채우고 수정할때 기존값을 플레이스홀더로 두고 입력 시작하면 날라가게 해
//  마치 상품 추가하는 화면처럼 … 키보드 ui도 상품 추가 화면과 동일한 경험 … 키보드 위에 확인 누르면 키보드만 닫기고 수정할까요? 묻거나 해당 화면을 내리진 마
//  값들 수정하고 이제 화면 닫으면 팝업으로 '1번 품종a 10,000원에서 ⏎ 2번 품종 b 20,000원으로 바꿀까요?' 아니요 / 바꿀게요 … 바뀐부분에 포인트 컬러"
// - 번호·품종·가격 칸을 누르면 아래 창이 화면 아래에 붙은 반 화면 판(양옆·아래 여백 없음, 흰색)으로 커진다.
// - 큰 칸은 비어 있고 옛 값이 회색 자리 글. 번호·가격은 상품 추가와 같은 앱 숫자판, 품종은 휴대폰 키보드. 숫자판·키보드 바로 위 [확인]은 키보드만 닫는다.
// - 고친 값은 바로 보내지 않는다. 창을 닫을 때(끌어내리기·바깥·뒤로) 바뀐 것이 있으면 팝업으로 묻고 [바꿀게요]면 그때 보낸다. [아니요]면 버리고 닫는다.
// - 비운 칸은 "안 바꿈". 잘못된 값(없는 번호·100원 미만·이미 있는 번호)은 칸 아래 빨간 글 — 닫으려 해도 창이 남아 고치게 한다.
import { useEffect, useRef, useState } from 'react'
import { Animated, Keyboard, TextInput, View } from 'react-native'
import type { Product } from '@livejjim/web/src/api/types.ts'
import { isApiError } from '../../api/client.ts'
import { koreanWon } from '../../lib/korean-won.ts'
import { productKey } from '../../lib/derive.ts'
import { formatWon } from '../../lib/words.ts'
import { BigButton, BottomSheet, ErrorLine, Icon, PopupDialog, Txt, font, useKit, useWrongShake, Tap } from '../../ui/kit/index.ts'
import { RADIUS, SPACE, TYPE, WEIGHT } from '../../ui/kit/tokens.ts'
import { useConsoleApi } from './context.ts'
import { BigNumber, NumberKeys } from './ProductAdd.tsx'
import { ProductDetail, rowName } from './ProductBoard.tsx'

export type EditField = 'no' | 'name' | 'price'

/** 고친 값 (칸마다 적은 글 그대로 — 숫자 칸은 숫자만). 없거나 빈 칸은 안 바꿈 */
export type EditDraft = Partial<Record<EditField, string>>

export const EDIT_LABEL: Readonly<Record<EditField, string>> = { no: '번호', name: '품종', price: '가격' }
export const EDIT_DONE = '확인'
export const EDIT_NO = '아니요'
export const EDIT_YES = '바꿀게요'

/** 방송에 번호 끝이 없을 때 번호 칸이 받는 가장 큰 수 (상품 추가와 같다) */
const NO_FALLBACK_MAX = 9999
const PRICE_DIGITS = 9
const NAME_MAX = 40

/** 줄 하나의 조각: 글과 바뀌었는지 */
export interface EditToken {
  readonly text: string
  readonly changed: boolean
}

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

export const planEmpty = (plan: EditPlan): boolean => plan.no === null && plan.name === null && plan.price === null

/** 팝업 두 줄: "1번 품종a 10,000원" → "2번 품종b 20,000원" — 품종이 둘 다 없으면 빼고, 바뀐 조각에 표시 */
export function editLines(product: Pick<Product, 'no' | 'name' | 'price'>, plan: EditPlan): { readonly before: EditToken[]; readonly after: EditToken[] } {
  const oldName = product.name.trim()
  const newName = plan.name ?? oldName
  const before: EditToken[] = [{ text: `${String(product.no)}번`, changed: false }]
  const after: EditToken[] = [{ text: `${String(plan.no ?? product.no)}번`, changed: plan.no !== null }]
  if (oldName !== '') before.push({ text: oldName, changed: false })
  if (newName !== '') after.push({ text: newName, changed: plan.name !== null })
  before.push({ text: formatWon(product.price), changed: false })
  after.push({ text: formatWon(plan.price ?? product.price), changed: plan.price !== null })
  return { before, after }
}

export const editQuestion = (lines: ReturnType<typeof editLines>): string =>
  `${lines.before.map((token) => token.text).join(' ')}에서\n${lines.after.map((token) => token.text).join(' ')}으로 바꿀까요?`

/** 바꿀까요? 팝업 글 — 바뀐 조각만 주색 */
function EditQuestion({ lines }: { readonly lines: ReturnType<typeof editLines> }) {
  const { p } = useKit()
  const line = (tokens: readonly EditToken[], tail: string, testID: string) => (
    <Txt step="lead" weight="bold" testID={testID}>
      {tokens.map((token, index) => (
        <Txt key={`${String(index)}-${token.text}`} step="lead" weight="bold" {...(token.changed ? { ink: p.primary, testID: 'edit-changed' } : {})}>
          {`${index === 0 ? '' : ' '}${token.text}`}
        </Txt>
      ))}
      {tail}
    </Txt>
  )
  return (
    <View style={{ gap: 2 }}>
      {line(lines.before, '에서', 'edit-before')}
      {line(lines.after, '으로 바꿀까요?', 'edit-after')}
    </View>
  )
}

/** 번호·품종·가격 칸 하나 (점선 둥근 칸, 왼쪽 위 연필): 누르면 그 칸을 고친다. 고친 값은 주색, 지금 고치는 칸은 주색 테두리 */
function FieldBox({ label, shown, changed, active, flex, disabled, onPress }: { readonly label: string; readonly shown: string; readonly changed: boolean; readonly active: boolean; readonly flex: number; readonly disabled: boolean; readonly onPress: () => void }) {
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
      <Txt step="lead" weight="bold" numberOfLines={1} {...(changed ? { ink: p.primary } : {})}>
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
  const [draft, setDraft] = useState<EditDraft>({})
  const [error, setError] = useState<string | null>(null)
  const [again, setAgain] = useState(0)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const lastKey = useRef(product?.key)
  const reset = () => {
    setHalf(false)
    setField(null)
    setDraft({})
    setError(null)
    setAsking(false)
  }
  // 다른 상품을 열면 처음부터 (번호를 바꿔 열쇠가 바뀐 것은 고친 뒤 닫히므로 같다)
  useEffect(() => {
    if (product?.key === lastKey.current) return
    lastKey.current = product?.key
    if (product === undefined) return
    setHalf(false)
    setField(null)
    setDraft({})
    setError(null)
    setAsking(false)
  }, [product?.key, product])

  const maxNumber = (() => {
    const value = api.data.broadcasts.get(api.b)?.settings['claim.maxNumber']
    return typeof value === 'number' && value > 0 ? value : null
  })()
  const digitLimit = (which: EditField): number => (which === 'no' ? Math.max(String(maxNumber ?? NO_FALLBACK_MAX).length, 1) : PRICE_DIGITS)
  /** 칸 값이 틀렸으면 그 까닭 (빈 칸은 안 바꿈이라 맞다) */
  const wrong = (which: EditField, text: string | undefined): string | null => {
    if (product === undefined || text === undefined || text.trim() === '') return null
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
  const firstWrong = (): { readonly field: EditField; readonly message: string } | null => {
    for (const which of ['no', 'name', 'price'] as const) {
      const message = wrong(which, draft[which])
      if (message !== null) return { field: which, message }
    }
    return null
  }

  const openField = (which: EditField) => {
    setError(null)
    setHalf(true)
    setField(which)
  }
  const type = (key: string) => {
    if (field === null || field === 'name') return
    const which = field
    setError(null)
    setDraft((was) => {
      const current = was[which] ?? ''
      const next = key === 'back' ? current.slice(0, -1) : (current + key).replace(/^0+/, '')
      if (next.length > digitLimit(which)) {
        setAgain((count) => count + 1)
        return was
      }
      return { ...was, [which]: next }
    })
  }
  /** [확인]: 키보드(숫자판)만 닫는다 — 묻거나 창을 내리지 않는다 */
  const done = () => {
    if (field === null) return
    const message = wrong(field, draft[field])
    if (message !== null) {
      setError(message)
      setAgain((count) => count + 1)
      return
    }
    Keyboard.dismiss()
    setField(null)
  }
  /** 창을 닫으려 할 때(끌어내리기·바깥·뒤로): 바뀐 것이 있으면 묻는다 */
  const tryClose = () => {
    if (asking || busy || product === undefined) return
    const bad = firstWrong()
    if (bad !== null) {
      setHalf(true)
      setField(bad.field)
      setError(bad.message)
      setAgain((count) => count + 1)
      return
    }
    if (planEmpty(editPlan(product, draft))) {
      reset()
      onClose()
      return
    }
    Keyboard.dismiss()
    setField(null)
    setAsking(true)
  }
  /** 닫기: 팝업을 먼저 걷고 다음 차례에 창을 내린다 — 아래 창이 닫히는 동안 붙든 마지막 내용(D-UX4-103)에 팝업이 다시 들지 않게 */
  const finish = () => {
    setAsking(false)
    setTimeout(() => {
      reset()
      onClose()
    }, 0)
  }
  const discard = finish
  const apply = async () => {
    if (product === undefined) return
    const plan = editPlan(product, draft)
    setBusy(true)
    try {
      let no = product.no
      if (plan.no !== null) {
        const result = await api.command({ type: 'product.renumber', b: api.b, from: product.no, to: plan.no })
        if (!result.changed) throw new Error('번호를 바꾸지 못했어요. 같은 번호 상품이 있는지 확인해 주세요.')
        no = plan.no
        onKey(productKey(api.b, no))
      }
      // 가격은 원문 칸으로 보낸다(SRV1 약속 2) — "원"을 붙여 방송 가격 단위와 상관없이 원으로 읽힌다. 품종도 같이 바뀌면 한 번에
      if (plan.price !== null) await api.command({ type: 'product.update', b: api.b, noText: String(no), priceText: `${String(plan.price)}원`, ...(plan.name === null ? {} : { name: plan.name }) })
      else if (plan.name !== null) await api.command({ type: 'product.update', b: api.b, no, name: plan.name })
      setBusy(false)
      finish()
    } catch (caught) {
      setBusy(false)
      setAsking(false)
      setError(isApiError(caught) ? caught.message : caught instanceof Error && caught.message !== '' ? caught.message : '바꾸지 못했어요. 다시 해 주세요.')
    }
  }

  const shake = useWrongShake(field === null ? null : error, again)
  const plan = product === undefined ? null : editPlan(product, draft)
  const lines = product === undefined || plan === null ? null : editLines(product, plan)
  const shownOf = (which: EditField): { readonly text: string; readonly changed: boolean } => {
    if (product === undefined || plan === null) return { text: '', changed: false }
    if (which === 'no') return { text: `${String(plan.no ?? product.no)}번`, changed: plan.no !== null }
    if (which === 'name') return { text: plan.name ?? rowName(product), changed: plan.name !== null }
    return { text: formatWon(plan.price ?? product.price), changed: plan.price !== null }
  }
  const box = (which: EditField, flex: number) => {
    const shown = shownOf(which)
    return <FieldBox key={which} label={EDIT_LABEL[which]} shown={shown.text} changed={shown.changed} active={field === which} flex={flex} disabled={closed} onPress={() => openField(which)} />
  }
  const fields = (
    <View style={{ flexDirection: 'row', gap: SPACE.sm }}>
      {box('no', 0.8)}
      {box('name', 1.4)}
      {box('price', 1.3)}
    </View>
  )

  // 고치는 칸: 상품 추가처럼 큰 칸(옛 값은 회색 자리 글) → [확인] → 숫자판(번호·가격)
  const editor = product === undefined || field === null ? null : (
    <View testID="product-edit" style={{ gap: SPACE.md }}>
      <View style={{ paddingHorizontal: SPACE.xl, gap: SPACE.sm }}>
        <Txt step="body" color="textSub">
          {EDIT_LABEL[field]}
        </Txt>
        <Animated.View style={{ transform: [{ translateX: shake }] }}>
          {field === 'name' ? (
            <TextInput
              aria-label={EDIT_LABEL.name}
              autoFocus
              value={draft.name ?? ''}
              onChangeText={(value) => {
                setError(null)
                setDraft((was) => ({ ...was, name: value }))
              }}
              placeholder={product.name.trim() === '' ? '어떤 품종인가요?' : product.name}
              placeholderTextColor={p.placeholder}
              maxLength={NAME_MAX}
              returnKeyType="done"
              onSubmitEditing={done}
              style={{ fontSize: TYPE.amount, minHeight: TYPE.amount * 1.5, paddingVertical: 0, color: p.text, ...font(WEIGHT.bold) }}
            />
          ) : (
            <BigNumber
              label={EDIT_LABEL[field]}
              question={field === 'no' ? `${String(product.no)}번` : formatWon(product.price)}
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
        <BigButton label={EDIT_DONE} onPress={done} />
      </View>
      {field === 'name' ? null : <NumberKeys onKey={type} />}
    </View>
  )

  // 바꿀까요? 팝업은 아래 창 안에 둔다 — 창 위에 뜨는 팝업(같은 판 안에서 띄워야 기기에서 겹쳐 뜬다)
  const question = (
    <PopupDialog
      visible={asking}
      message={lines === null ? '' : editQuestion(lines)}
      content={lines === null ? undefined : <EditQuestion lines={lines} />}
      cancelLabel={EDIT_NO}
      confirmLabel={EDIT_YES}
      busy={busy}
      onCancel={discard}
      onConfirm={() => void apply()}
    />
  )
  return (
      <BottomSheet visible={visible} onClose={tryClose} title="" half={half} bodyPadding={!half} testID="product-sheet">
        {product === undefined ? null : half ? (
          <View style={{ gap: SPACE.lg, paddingTop: SPACE.md }}>
            <View style={{ paddingHorizontal: SPACE.xl }}>{fields}</View>
            {editor ?? (
              <View style={{ paddingHorizontal: SPACE.xl }}>
                {error !== null ? <ErrorLine>{error}</ErrorLine> : null}
                <ProductDetail product={product} fields={null} onKey={onKey} onDone={discard} {...(onDecide === undefined ? {} : { onDecide })} />
              </View>
            )}
          </View>
        ) : (
          <>
            {error !== null ? <ErrorLine>{error}</ErrorLine> : null}
            <ProductDetail product={product} fields={fields} onKey={onKey} onDone={discard} {...(onDecide === undefined ? {} : { onDecide })} />
          </>
        )}
        {question}
      </BottomSheet>
  )
}
