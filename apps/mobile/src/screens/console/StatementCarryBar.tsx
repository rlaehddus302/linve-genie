// 구매자 정산서 위의 지난 주문 칸 (D-STMT-CARRY-01): 같은 손님의 아직 안 보낸 지난 주문이 있으면
// "지난 11.15 주문 2개 · 20,000원을 아직 안 보냈어요." · 지난 상품 줄 · 왼쪽 [이미 보냈어요](한 번 묻는다) · 오른쪽 [같이 보내기].
// 같이 보내기로 했으면 "…을 같이 보내요." · [빼기]. 연습 라이브·봉인된 날짜에는 없다(서버가 주지 않는다 · 정산서 화면이 그리지 않는다).
// 단추는 좌우 한 줄(부정 왼쪽·긍정 오른쪽, D-UX4-01). 상품 이름은 글자(Txt)로만 그린다.
import { useState } from 'react'
import { View } from 'react-native'
import { isApiError } from '../../api/client.ts'
import { lineNoWord, salesMoney, type BuyerOrder, type PastOrder } from '../../lib/broadcast-sales.ts'
import {
  CARRY_BUTTON, CARRY_DROP_BUTTON, CARRY_FAILED, CARRY_SENT_BUTTON, CARRY_SENT_DESCRIPTION, CARRY_SENT_QUESTION, WAITING_HELP, carriedNote, waitingNote, type StatementCarries,
} from '../../lib/statement-carries.ts'
import { BigButton, ButtonRow, ConfirmSheet, SmallButton, Txt, useKit } from '../../ui/kit/index.ts'
import { RADIUS, SPACE } from '../../ui/kit/tokens.ts'

/** 지난 상품 줄 "11.15 1번 핑크프릴 · 1개 · 20,000원" */
function PastLines({ orders }: { readonly orders: readonly PastOrder[] }) {
  return <View role="list" style={{ gap: 2 }}>
    {orders.flatMap(order => order.lines).map(line => (
      <View key={line.key} role="listitem" style={{ flexDirection: 'row', gap: SPACE.sm }}>
        <View style={{ flex: 1 }}><Txt step="meta" color="textSub">{`${lineNoWord(line)} ${[line.name, line.variant].filter(Boolean).join(' · ')} · ${line.qty}개`}</Txt></View>
        <Txt step="meta" color="textSub">{salesMoney(line.amount)}</Txt>
      </View>
    ))}
  </View>
}

export function StatementCarryBar({ order, carries }: { readonly order: BuyerOrder; readonly carries: StatementCarries }) {
  const { p } = useKit()
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState('')
  const waiting = order.waiting ?? []
  const carried = order.carried ?? []
  if (waiting.length === 0 && carried.length === 0) return null

  const run = async (kind: 'carry' | 'drop' | 'sent', past: readonly PastOrder[]) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await carries.change(kind, order.id, past)
      setAsking(false)
    } catch (e) {
      setAsking(false)
      setError(isApiError(e) ? e.message : CARRY_FAILED)
    } finally { setBusy(false) }
  }

  return <View testID="statement-carry" style={{ alignSelf: 'stretch', gap: SPACE.sm }}>
    {waiting.length > 0 ? (
      <View testID="statement-carry-waiting" role="alert" style={{ gap: SPACE.sm, padding: SPACE.lg, borderRadius: RADIUS.xl, borderCurve: 'continuous', backgroundColor: p.warnBg }}>
        <Txt weight="bold" color="warnText">{waitingNote(waiting)}</Txt>
        <Txt step="meta" color="textSub">{WAITING_HELP}</Txt>
        <PastLines orders={waiting} />
        <ButtonRow>
          <BigButton kind="secondary" label={CARRY_SENT_BUTTON} disabled={busy} onPress={() => { setError(''); setAsking(true) }} />
          <BigButton label={CARRY_BUTTON} busy={busy} onPress={() => void run('carry', waiting)} />
        </ButtonRow>
      </View>
    ) : null}
    {carried.length > 0 ? (
      <View testID="statement-carry-carried" style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingVertical: SPACE.md, paddingHorizontal: SPACE.lg, borderRadius: RADIUS.xl, borderCurve: 'continuous', backgroundColor: p.surface }}>
        <View style={{ flex: 1, gap: SPACE.xs }}>
          <Txt weight="bold">{carriedNote(carried)}</Txt>
          <PastLines orders={carried} />
        </View>
        <SmallButton label={CARRY_DROP_BUTTON} disabled={busy} onPress={() => void run('drop', carried)} />
      </View>
    ) : null}
    {error ? <Txt color="dangerText" role="alert">{error}</Txt> : null}
    <ConfirmSheet visible={asking} question={CARRY_SENT_QUESTION} description={CARRY_SENT_DESCRIPTION} cancelLabel="취소" confirmLabel={CARRY_SENT_BUTTON} busy={busy}
      onCancel={() => setAsking(false)} onConfirm={() => void run('sent', waiting)} />
  </View>
}
