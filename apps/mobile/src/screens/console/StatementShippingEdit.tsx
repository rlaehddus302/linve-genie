// 정산서 배송비 바꾸기 (D-STMT-SHIP-01, 판매자 요청 2026-11-20 "특정 사람의 경우 배송비가 천 원 더 드는 경우도 있으니까 정산서에서 바로 배송비를 수정할 수 있게 해 줘.
// 즉, 무료로 수정하거나 내가 원하는 금액으로 편리하게 바꿀 수 있도록"):
// 손님 정산서의 배송비 줄 [바꾸기] → 정산서 위에 겹친 화면(주문 상세 "이 주문 배송비 바꾸기"와 같은 모양 — 묻는 말 · 큰 칸 · 앱 숫자판).
// - [무료]는 칸을 0원으로. 0원~1,000,000원, 정수 원(settle.ts readAmount).
// - 저장은 엔진 정산의 배송비 예외(settlement.shippingOverride FIXED) — 주문 상세·입금 확인·확인서 문자와 같은 값이 된다. 그 손님(합친 정산서면 대표 구매자)의 그 날짜 정산에만.
// - 따로 정했으면 왼쪽 [정해진 대로](예외를 지운다 — DEFAULT) · 오른쪽 [저장하기] (D-UX4-01 좌우 한 줄, 부정 왼쪽).
import { useState } from 'react'
import { Animated, View } from 'react-native'
import { isApiError } from '../../api/client.ts'
import { koreanWon } from '../../lib/korean-won.ts'
import { SHIPPING_RANGE, readAmount } from '../../lib/settle.ts'
import { formatWon } from '../../lib/words.ts'
import { BigButton, ButtonRow, ErrorLine, SmallButton, StackPage, Txt, useWrongShake } from '../../ui/kit/index.ts'
import { SPACE } from '../../ui/kit/tokens.ts'
import { Notice } from '../../ui/parts.tsx'
import { typeShipping } from '../OrderShippingScreen.tsx'
import { BigNumber, NumberKeys } from './ProductAdd.tsx'
import { useFooterInset } from './parts.tsx'

export const STATEMENT_SHIPPING_TITLE = '배송비 바꾸기'
export const STATEMENT_SHIPPING_BUTTON = '바꾸기'
export const ASK_STATEMENT_SHIPPING = '이 손님 배송비는 얼마인가요?'
export const FREE_BUTTON = '무료'
export const RULE_BUTTON = '정해진 대로'
export const SAVE_BUTTON = '저장하기'
export const SHIPPING_SAVE_FAILED = '배송비를 저장하지 못했어요. 다시 눌러 주세요.'
export const NOT_APPLIED = '배송비가 바뀌지 않았어요. 정산서를 다시 열어 확인해 주세요.'
/** 정해진 규칙대로의 배송비 회색 줄 */
export const ruleShippingWords = (amount: number | null): string => (amount === null ? '' : `정해진 대로면 ${amount === 0 ? '무료' : formatWon(amount)}`)

const commas = (digits: string): string => formatWon(Number(digits)).replace(/원$/, '')

/**
 * onSave(amount): 정수 원이면 그 금액으로, null이면 정해진 대로(예외 지우기). 바뀌지 않았으면 false.
 * 실패면 던진다(오류 문장을 보인다)
 */
export function StatementShippingPage({ current, ruleShipping, overridden, onSave, onClose }: {
  readonly current: number
  readonly ruleShipping: number | null
  readonly overridden: boolean
  readonly onSave: (amount: number | null) => Promise<boolean>
  readonly onClose: () => void
}) {
  const footer = useFooterInset()
  const [typed, setTyped] = useState<{ readonly digits: string; readonly again: number }>(() => ({ digits: String(current), again: 0 }))
  const { digits, again } = typed
  const [busy, setBusy] = useState<'save' | 'rule' | null>(null)
  const [notice, setNotice] = useState('')
  const read = digits === '' ? null : readAmount(digits, SHIPPING_RANGE)
  const problem = read !== null && !read.ok ? read.message : null
  const shake = useWrongShake(problem, again)

  const typeKey = (value: string) => {
    setNotice('')
    setTyped(now => {
      const next = typeShipping(now.digits, value)
      return next === null ? { ...now, again: now.again + 1 } : { ...now, digits: next }
    })
  }
  const save = async (amount: number | null) => {
    if (busy !== null) return
    setBusy(amount === null ? 'rule' : 'save')
    setNotice('')
    try {
      const changed = await onSave(amount)
      if (!changed) { setNotice(NOT_APPLIED); return }
      onClose()
    } catch (e) {
      setNotice(isApiError(e) && e.message !== '' ? e.message : SHIPPING_SAVE_FAILED)
    } finally { setBusy(null) }
  }
  const ok = read !== null && read.ok

  return (
    <StackPage name={STATEMENT_SHIPPING_TITLE} title={STATEMENT_SHIPPING_TITLE} onBack={onClose} scroll={false} testID="statement-shipping-edit">
      <View style={{ flex: 1 }}>
        <View style={{ flex: 1, paddingHorizontal: SPACE.xxl, paddingTop: SPACE.xxl, gap: SPACE.xxl }}>
          <View style={{ gap: 2 }}>
            <Txt step="title" weight="bold">{ASK_STATEMENT_SHIPPING}</Txt>
            {ruleShipping !== null ? <Txt step="body" color="textSub">{ruleShippingWords(ruleShipping)}</Txt> : null}
          </View>
          <View style={{ gap: SPACE.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.md }}>
              <Animated.View style={{ flex: 1, transform: [{ translateX: shake }] }}>
                <BigNumber label="배송비" question={ASK_STATEMENT_SHIPPING} digits={digits} format={commas} suffix="원" />
              </Animated.View>
              <SmallButton label={FREE_BUTTON} onPress={() => { setNotice(''); setTyped(now => ({ ...now, digits: '0' })) }} />
            </View>
            {problem === null && Number(digits) >= 10_000 ? <Txt step="body" color="textSub">{koreanWon(Number(digits))}</Txt> : null}
            {problem !== null ? <ErrorLine large>{problem}</ErrorLine> : null}
          </View>
        </View>
        <View style={{ paddingHorizontal: SPACE.xl, paddingTop: SPACE.sm, paddingBottom: SPACE.sm, gap: SPACE.sm }}>
          {notice ? <Notice tone="danger" alert>{notice}</Notice> : null}
          {overridden ? (
            <ButtonRow>
              <BigButton kind="secondary" label={RULE_BUTTON} busy={busy === 'rule'} disabled={busy !== null} onPress={() => void save(null)} />
              <BigButton label={SAVE_BUTTON} busy={busy === 'save'} disabled={busy !== null || !ok} onPress={() => void (ok ? save(read.amount) : undefined)} />
            </ButtonRow>
          ) : (
            <BigButton label={SAVE_BUTTON} busy={busy === 'save'} disabled={busy !== null || !ok} onPress={() => void (ok ? save(read.amount) : undefined)} />
          )}
        </View>
        <View style={{ paddingBottom: footer }}>
          <NumberKeys onKey={typeKey} />
        </View>
      </View>
    </StackPage>
  )
}
