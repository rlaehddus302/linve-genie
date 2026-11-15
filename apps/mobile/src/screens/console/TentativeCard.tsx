// 확인 중(임시 등록) 상품 확인 카드 (11월 12일 라이브 복기 5.3·6.3, 개선 계획표 A2·C2, 계약서 docs/retro/tentative-contract.md 3.3).
// 화면 일꾼이 번호·가격을 확신하지 못했거나 다른 계정의 손 등록이 기다리는 찜이 있는 번호로 들어오면, 판매자가 한 번 탭으로 확정한다.
// - 번호 후보가 갈리면 좌우 단추로 번호를 고른다 — 지금 번호(일꾼이 따른 쪽)가 오른쪽. 금액 후보가 갈리면 같은 방식.
//   둘 다 갈리면 번호 → 금액 차례로 묻고, 번호는 금액을 고를 때 한 번에 같이 보낸다(탭 둘, 요청 하나).
// - 후보가 없으면 왼쪽 [거두기] · 오른쪽 [이대로 확정]. 다 틀렸으면 [고치기]로 상품 수정창.
// - 거두기는 먼저 묻는다(왼쪽 [닫기] · 오른쪽 [거두기]). 거둬도 기다리는 찜은 그대로 남는다 — 상품 삭제(판매 종료)와 다르다.
// - 서버가 "바뀐 것 없음"이면(그사이 일꾼·다른 기기가 확정) 조용히 닫고 따라잡은 상태를 보인다.
// 방송 화면에는 한 번에 한 장만, 먼저 올라온 것부터 — 화면 아래(엄지 자리)의 같은 곳에 뜬다. 상품 자세히도 같은 조각(TentativePanel)을 쓴다.
// - 일꾼이 품종을 여러 가지로 들었으면(품종 후보) 품종 단추 한 줄을 띄운다 — 누른 품종으로 확정된다(D-VARIETY-01, 개선 계획 E1). 지금 품종이 먼저 골라져 있다.
// 앱은 판정하지 않는다. 닉네임·채팅 글은 그리지 않는다. 품종은 글자로만 그린다.
import { productTitle } from '@livejjim/core/format'
import { useRef, useState } from 'react'
import { Platform, View } from 'react-native'
import type { Product } from '@livejjim/web/src/api/types.ts'
import { isApiError } from '../../api/client.ts'
import { productKey } from '../../lib/derive.ts'
import { TENTATIVE_TAG, confirmEvent, isTentative, otherNames, otherNumbers, otherPrices, reasonLine, tentativeProducts, waitingAt, waitingWords, withdrawEvent } from '../../lib/tentative.ts'
import { formatWon } from '../../lib/words.ts'
import { Appear, BigButton, ButtonRow, ErrorLine, PopupDialog, Tap, Txt, useKit } from '../../ui/kit/index.ts'
import { GUTTER, RADIUS, SHADOW, SPACE } from '../../ui/kit/tokens.ts'
import { useConsoleApi } from './context.ts'
import { VarietyChips } from './VarietyChips.tsx'

export const TENTATIVE_REGION = '확인 중인 상품'
export const ASK_WHICH_NUMBER = '몇 번이 맞나요?'
export const ASK_WHICH_PRICE = '얼마가 맞나요?'
export const CONFIRM_AS_IS = '이대로 확정'
export const WITHDRAW = '거두기'
export const WITHDRAW_ASK = '이 상품을 거둘까요?'
export const WITHDRAW_NOTE = '기다리는 찜은 그대로 남아요.'
export const WITHDRAW_CLOSE = '닫기'
export const TENTATIVE_EDIT = '고치기'
export const PICK_NUMBER_AGAIN = '번호 다시'
export const CONFIRM_FAILED = '확정하지 못했어요. 다시 눌러 주세요.'
export const WITHDRAW_FAILED = '거두지 못했어요. 다시 눌러 주세요.'
export const moreWords = (more: number): string => `외 ${String(more)}개`
export const numberTaken = (no: number): string => `${String(no)}번에는 이미 상품이 있어요. 다른 번호를 고르거나 고쳐 주세요.`
/** 번호 단추 글: "333번", 그 번호로 기다리는 찜이 있으면 "333번 · 찜 2건" (손님 찜이 들어온 번호가 고르는 근거 — 계획표 C3) */
export const numberChoice = (no: number, waiting: number): string => (waiting > 0 ? `${String(no)}번 · 찜 ${String(waiting)}건` : `${String(no)}번`)

/**
 * 카드가 뜨거나 다음 카드로 바뀐 직후 잠깐은 누름을 받지 않는다 — 앞 카드를 누르던 손가락이나, 그 자리의 다른 것을 누르려던 손가락이
 * 방금 뜬 카드를 확정하지 않게. 웹(시험)은 0
 */
export const CARD_GUARD_MS = 600

/** 카드 머리 오른쪽의 작은 단추 (거두기 · 번호 다시 · 고치기) */
function SmallAction({ label, ariaLabel, disabled, onPress }: { readonly label: string; readonly ariaLabel: string; readonly disabled: boolean; readonly onPress: () => void }) {
  const { p } = useKit()
  return (
    <Tap
      role="button"
      aria-label={ariaLabel}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({ minHeight: 36, paddingHorizontal: SPACE.md, borderRadius: RADIUS.pill, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: pressed && !disabled ? p.pressed : p.soft, opacity: disabled ? 0.45 : 1 })}
    >
      <Txt step="caption" weight="bold" color="textSub">
        {label}
      </Txt>
    </Tap>
  )
}

/**
 * 확인 중 상품 하나의 물음과 단추. values: 번호·품종·가격의 지금 값을 크게 보인다(상품 자세히는 위 칸이 이미 보이므로 끈다).
 * more: 이 상품 말고 더 기다리는 확인 중 상품 수. onEdit: [고치기](없으면 단추가 없다). onDone: 확정·거둔 뒤.
 * guardMs: 뜬 직후 누름을 받지 않는 시간
 */
export function TentativePanel({ product, values = true, more = 0, guardMs = 0, onEdit, onDone }: { readonly product: Product; readonly values?: boolean; readonly more?: number; readonly guardMs?: number; readonly onEdit?: () => void; readonly onDone?: () => void }) {
  const api = useConsoleApi()
  const { p } = useKit()
  // 번호와 금액이 둘 다 갈릴 때 먼저 고른 번호 — 금액을 고를 때 같이 보낸다
  const [picked, setPicked] = useState<number | null>(null)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 품종 후보 단추로 고른 품종 (없으면 지금 품종) — 확정할 때 같이 보낸다 (D-VARIETY-01)
  const [pickedName, setPickedName] = useState<string | null>(null)
  const sending = useRef(false)
  const shownAt = useRef(Date.now())
  const tentative = product.tentative
  if (tentative === undefined) return null

  const numbers = otherNumbers(product)
  const prices = otherPrices(product)
  const step = numbers.length > 0 && picked === null ? 'no' : prices.length > 0 ? 'price' : 'plain'
  const no = picked ?? product.no
  const waiting = waitingAt(api.data, api.b, no)
  const names = otherNames(product)
  const name = pickedName ?? product.name.trim()
  const line = [`${String(no)}번`, productTitle(name, product.pieces), formatWon(product.price)].filter((part) => part !== '').join(' ')
  const why = [reasonLine(tentative), ...(waiting > 0 ? [waitingWords(waiting)] : [])].join(' · ')
  const tooSoon = () => guardMs > 0 && Date.now() - shownAt.current < guardMs

  const send = async (event: Readonly<Record<string, unknown>>, failed: string, moveTo?: number) => {
    if (sending.current || tooSoon()) return
    sending.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await api.command(event)
      // 바뀐 것이 없다: 그사이 일꾼·다른 기기가 확정했으면 조용히 닫는다. 아직 확인 중이면(옮길 번호에 상품이 생김 등) 그 까닭을 알린다
      if (!result.changed && isTentative((api.latest?.() ?? api.data).products.get(product.key))) {
        setAsking(false)
        setPicked(null)
        setError(moveTo === undefined ? failed : numberTaken(moveTo))
        return
      }
      setAsking(false)
      onDone?.()
    } catch (caught) {
      setAsking(false)
      setError(isApiError(caught) ? caught.message : failed)
    } finally {
      sending.current = false
      setBusy(false)
    }
  }
  const confirm = (pick: { readonly no?: number; readonly price?: number }) => {
    const to = pick.no !== undefined && pick.no !== product.no ? pick.no : undefined
    void send(confirmEvent(product, { ...pick, ...(pickedName === null ? {} : { name: pickedName }) }), CONFIRM_FAILED, to)
  }
  const pickNumber = (value: number) => {
    if (sending.current || tooSoon()) return
    // 옮길 번호에 이미 상품이 있으면(지운 상품 포함) 서버가 확정하지 않는다 — 보내지 않고 바로 알린다
    if (value !== product.no && api.data.products.has(productKey(api.b, value))) {
      setError(numberTaken(value))
      return
    }
    setError(null)
    if (prices.length > 0) setPicked(value)
    else confirm({ no: value })
  }
  const pickPrice = (value: number) => confirm({ ...(picked === null ? {} : { no: picked }), price: value })

  const choice = (label: string, ariaLabel: string, current: boolean, onPress: () => void) => (
    <BigButton key={ariaLabel} kind={current ? 'primary' : 'outline'} label={label} ariaLabel={ariaLabel} oneLine disabled={busy} onPress={onPress} />
  )
  // 번호를 고르면 바로 확정되는지(금액을 더 묻지 않음), 금액으로 넘어가는지에 따라 단추 이름이 다르다
  const numberLabel = (value: number) => (prices.length > 0 ? `${String(value)}번 고르기` : `${String(value)}번으로 확정`)

  return (
    <View role="group" aria-label={`${TENTATIVE_TAG} — ${String(product.no)}번`} style={{ gap: SPACE.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
        <View style={{ paddingHorizontal: SPACE.md, paddingVertical: SPACE.xs, borderRadius: RADIUS.pill, borderCurve: 'continuous', backgroundColor: p.warnBg }}>
          <Txt step="caption" weight="heavy" ink={p.warnText}>
            {TENTATIVE_TAG}
          </Txt>
        </View>
        {more > 0 ? (
          <Txt step="caption" color="textSub">
            {moreWords(more)}
          </Txt>
        ) : null}
        <View style={{ flex: 1 }} />
        {/* 작은 단추도 한 줄 — 부정(거두기·번호 다시)이 왼쪽, 고치기가 오른쪽 */}
        {step === 'plain' ? null : picked === null ? (
          <SmallAction label={WITHDRAW} ariaLabel={`${WITHDRAW} — ${String(product.no)}번`} disabled={busy} onPress={() => { if (!tooSoon()) setAsking(true) }} />
        ) : (
          <SmallAction label={PICK_NUMBER_AGAIN} ariaLabel={PICK_NUMBER_AGAIN} disabled={busy} onPress={() => { setError(null); setPicked(null) }} />
        )}
        {onEdit === undefined ? null : <SmallAction label={TENTATIVE_EDIT} ariaLabel={`${TENTATIVE_EDIT} — ${String(product.no)}번`} disabled={busy} onPress={() => { if (!tooSoon()) onEdit() }} />}
      </View>
      {values ? (
        <Txt step="title" weight="heavy" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} testID="tentative-values">
          {line}
        </Txt>
      ) : null}
      <Txt step="caption" weight="bold" color="warnText" role="note">
        {why}
      </Txt>
      {/* 일꾼이 품종을 여러 가지로 들었으면 품종 단추 한 줄 — 지금 품종이 맨 앞(골라져 있음), 누르면 그 품종으로 확정된다 (D-VARIETY-01) */}
      {names.length === 0 ? null : (
        <VarietyChips choices={[...(product.name.trim() === '' ? [] : [product.name.trim()]), ...names]} selected={name} disabled={busy} inset={0} onPick={(value) => { if (!tooSoon()) setPickedName(value === product.name.trim() ? null : value) }} />
      )}
      {step === 'plain' ? null : (
        <Txt step="bodyLarge" weight="bold">
          {step === 'no' ? ASK_WHICH_NUMBER : ASK_WHICH_PRICE}
        </Txt>
      )}
      {error !== null ? <ErrorLine>{error}</ErrorLine> : null}
      {/* 단추는 좌우 한 줄 (절대 규칙 8). 후보끼리는 긍정·부정이 아니므로 지금 값(일꾼이 따른 쪽)을 오른쪽에 둔다 */}
      <ButtonRow>
        {step === 'no' ? (
          <>
            {numbers.map((value) => choice(numberChoice(value, waitingAt(api.data, api.b, value)), numberLabel(value), false, () => pickNumber(value)))}
            {choice(numberChoice(product.no, waitingAt(api.data, api.b, product.no)), numberLabel(product.no), true, () => pickNumber(product.no))}
          </>
        ) : step === 'price' ? (
          <>
            {prices.map((value) => choice(formatWon(value), `${formatWon(value)}으로 확정`, false, () => pickPrice(value)))}
            {choice(formatWon(product.price), `${formatWon(product.price)}으로 확정`, true, () => pickPrice(product.price))}
          </>
        ) : (
          <>
            <BigButton kind="outline" label={WITHDRAW} ariaLabel={`${WITHDRAW} — ${String(product.no)}번`} disabled={busy} onPress={() => { if (!tooSoon()) setAsking(true) }} />
            <BigButton label={CONFIRM_AS_IS} ariaLabel={`${CONFIRM_AS_IS} — ${String(product.no)}번`} busy={busy} onPress={() => confirm({})} />
          </>
        )}
      </ButtonRow>
      <PopupDialog
        visible={asking}
        message={WITHDRAW_ASK}
        description={`${line}\n${WITHDRAW_NOTE}`}
        cancelLabel={WITHDRAW_CLOSE}
        confirmLabel={WITHDRAW}
        busy={busy}
        onCancel={() => setAsking(false)}
        onConfirm={() => void send(withdrawEvent(product), WITHDRAW_FAILED)}
      />
    </View>
  )
}

/**
 * 방송 화면의 확인 카드: 확인 중 상품이 있으면 화면 아래(목록과 아래 창 사이)에 한 장 — 먼저 올라온 것부터, 확정·거두면 다음 것이 같은 자리에 뜬다.
 * onEdit: [고치기] — 그 상품 자세히(수정창)를 연다. bottom: 아래 여백(아래 창이 없으면 홈 막대 자리)
 */
export function TentativeCards({ onEdit, bottom, guardMs = Platform.OS === 'web' ? 0 : CARD_GUARD_MS }: { readonly onEdit: (key: string) => void; readonly bottom: number; readonly guardMs?: number }) {
  const api = useConsoleApi()
  const { p } = useKit()
  const waitingList = api.ended || api.sealed ? [] : tentativeProducts(api.data, api.b)
  const first = waitingList[0]
  if (first === undefined) return null
  return (
    <View role="region" aria-label={TENTATIVE_REGION} testID="tentative-card" style={{ paddingHorizontal: GUTTER, paddingTop: SPACE.sm, paddingBottom: bottom, backgroundColor: p.background }}>
      <Appear key={first.key} style={{ padding: SPACE.lg, borderRadius: RADIUS.xl, borderCurve: 'continuous', borderWidth: 1.5, borderColor: p.warnText, backgroundColor: p.surface, ...SHADOW.card }}>
        <TentativePanel product={first} more={waitingList.length - 1} guardMs={guardMs} onEdit={() => onEdit(first.key)} />
      </Appear>
    </View>
  )
}
