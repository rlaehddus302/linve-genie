// 구매자 정산서 위의 손님 합치기 칸 (D-STMT-JOIN-01): 합친 정산서면 "닉네임 n개를 한 정산서로 합쳤어요" · 닉네임들 · [나누기](한 번 묻는다),
// 혼자면 [다른 닉네임 합치기] → 같은 사람의 다른 닉네임을 골라(여럿) [취소] [합치기]. 연습 라이브·봉인된 날짜에는 없다.
// 단추는 좌우 한 줄(부정 왼쪽·긍정 오른쪽, D-UX4-01). 닉네임은 글자(Txt)로만 그린다.
import { useState } from 'react'
import { ScrollView, View } from 'react-native'
import { isApiError } from '../../api/client.ts'
import { orderName, type BuyerOrder } from '../../lib/broadcast-sales.ts'
import {
  APART_BUTTON, APART_DESCRIPTION, APART_FAILED, APART_QUESTION, JOIN_BUTTON, JOIN_CONFIRM, JOIN_FAILED, JOIN_HELP, JOIN_NOBODY, JOIN_TITLE, joinedNote, type StatementJoins,
} from '../../lib/statement-joins.ts'
import { BigButton, BottomSheet, CHOICE_CHECK, ChoiceCheck, ConfirmSheet, SmallButton, Tap, Txt, useKit } from '../../ui/kit/index.ts'
import { RADIUS, SPACE } from '../../ui/kit/tokens.ts'

export function StatementJoinBar({ order, orders, name, joins }: {
  readonly order: BuyerOrder
  /** 이 정산서의 모든 구매자 정산서 (합친 것은 한 줄) */
  readonly orders: readonly BuyerOrder[]
  readonly name: (id: string) => string
  readonly joins: StatementJoins
}) {
  const { p } = useKit()
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<readonly string[]>([])
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const others = orders.filter(row => row.id !== order.id).sort((a, b) => orderName(a, name).localeCompare(orderName(b, name), 'ko'))
  const members = order.members ?? null

  const join = async () => {
    if (busy || picked.length === 0) return
    setBusy(true)
    setError('')
    try {
      // 고른 줄이 이미 합친 정산서면 그 닉네임 모두 — 이 정산서가 대표(앞)
      const chosen = others.filter(row => picked.includes(row.id)).flatMap(row => row.members ?? [row.id])
      await joins.change('join', [...(members ?? [order.id]), ...chosen])
      setPicking(false)
      setPicked([])
    } catch (e) {
      setError(isApiError(e) ? e.message : JOIN_FAILED)
    } finally { setBusy(false) }
  }
  const apart = async () => {
    if (busy || members === null) return
    setBusy(true)
    setError('')
    try {
      await joins.change('apart', members)
      setAsking(false)
    } catch (e) {
      setAsking(false)
      setError(isApiError(e) ? e.message : APART_FAILED)
    } finally { setBusy(false) }
  }

  return <View testID="statement-join" style={{ alignSelf: 'stretch', gap: SPACE.xs }}>
    {members !== null ? (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingVertical: SPACE.md, paddingHorizontal: SPACE.lg, borderRadius: RADIUS.xl, borderCurve: 'continuous', backgroundColor: p.surface }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt weight="bold">{joinedNote(members.length, order.auto === true)}</Txt>
          <Txt step="meta" color="textSub">{orderName(order, name)}</Txt>
        </View>
        <SmallButton label={APART_BUTTON} disabled={busy} onPress={() => { setError(''); setAsking(true) }} />
      </View>
    ) : (
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
        <SmallButton label={JOIN_BUTTON} disabled={busy} onPress={() => { setError(''); setPicked([]); setPicking(true) }} />
      </View>
    )}
    {error ? <Txt color="dangerText" role="alert">{error}</Txt> : null}
    <BottomSheet visible={picking} title={JOIN_TITLE} description={JOIN_HELP} onClose={() => setPicking(false)} testID="statement-join-sheet"
      actions={<>
        <BigButton kind="outline" label="취소" onPress={() => setPicking(false)} />
        <BigButton label={picked.length > 0 ? `${JOIN_CONFIRM} (${picked.length})` : JOIN_CONFIRM} busy={busy} disabled={picked.length === 0} onPress={() => void join()} />
      </>}>
      {others.length === 0 ? <Txt color="textSub">{JOIN_NOBODY}</Txt> : (
        <ScrollView style={{ maxHeight: 360 }} role="list" aria-label={JOIN_TITLE}>
          {others.map(row => {
            const on = picked.includes(row.id)
            const label = orderName(row, name)
            return <Tap key={row.id} role="checkbox" aria-checked={on} aria-label={`${label} ${row.qty}개`}
              onPress={() => setPicked(list => (on ? list.filter(id => id !== row.id) : [...list, row.id]))}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, minHeight: 52, paddingHorizontal: SPACE.sm, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
              <View style={{ flex: 1 }}><Txt step="bodyLarge" weight="medium">{label}</Txt></View>
              <Txt step="body" color="textSub">{`${row.qty}개`}</Txt>
              {on ? <ChoiceCheck /> : <View aria-hidden style={{ width: CHOICE_CHECK, height: CHOICE_CHECK }} />}
            </Tap>
          })}
        </ScrollView>
      )}
    </BottomSheet>
    <ConfirmSheet visible={asking} question={APART_QUESTION} description={APART_DESCRIPTION} cancelLabel="취소" confirmLabel={APART_BUTTON} busy={busy}
      onCancel={() => setAsking(false)} onConfirm={() => void apart()} />
  </View>
}
