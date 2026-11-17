// 주문 상세 [상품 빼기] (D-PASS-01, 사용자 지시 2026-11-18 "이렇게 부분 패스 하는 사람도 있어서 취소 처리, 주의고객 기록(패스 자주하는 사람) 기능 필요함").
// 정산서를 보낸 뒤 손님이 카톡·문자로 "173·179·499만 가능할까요"처럼 일부만 사겠다고 하면, 판매자가 뺄 상품을 골라 한 번에 뺀다.
// - 앱은 판정하지 않는다: 고른 줄마다 엔진의 방송자 취소(host.cancel b·no·buyer·options)를 보낼 뿐이다. 금액·배송비·대기 손님 승계는 엔진이 정한다.
// - 까닭 둘: "손님이 패스했어요"(사유 '손님 패스' — 손님 기록의 패스 횟수에 든다, 세 번부터 "패스 잦음 주의") /
//   "제가 잘못 넣었어요"(사유 '판매자 착오' — 패스로 세지 않는다). 처음엔 "손님이 패스했어요"가 골라져 있다(이 창을 여는 까닭이 대개 그것이라).
// - 단추는 좌우로만 (D-UX4-01): 창 아래 [닫기] [n개 빼기] → 같은 창이 확인 단계로 바뀌어 [아니요] [빼기]
//   (창 위에 팝업을 또 띄우면 아이폰에서 두 번째 판이 뜨지 않을 수 있어 한 창 안에서 묻는다).
// - 같은 요청 번호로 다시 보내도 한 번만 (줄마다 요청 번호를 하나씩 두고, 다 보낸 뒤 새로 만든다).
import { useRef, useState } from 'react'
import { View } from 'react-native'
import type { OrderItem } from '@livejjim/web/src/api/order-types.ts'
import type { WriteResult } from '@livejjim/web/src/api/types.ts'
import { isApiError, newRequestId, post, withRetry } from '../api/client.ts'
import { formatWon } from '../lib/words.ts'
import { BigButton, BottomSheet, ErrorLine, Icon, Tap, Txt, useKit } from '../ui/kit/index.ts'
import { RADIUS, SPACE } from '../ui/kit/tokens.ts'

export const REMOVE_BUTTON = '상품 빼기'
export const REMOVE_DESCRIPTION = '손님이 빼 달라고 한 상품을 골라 주세요'
export const REMOVE_WHY = '왜 빼나요?'
export const REMOVE_CONFIRM = '빼기'
export const REMOVE_FAILED = '빼지 못한 상품이 있어요. 다시 눌러 주세요.'
export const REMOVE_ASK_NOTE = '최종 금액과 배송비가 다시 계산돼요. 기다리던 손님이 있으면 그 손님 찜이 돼요.'

export type RemoveWhy = 'pass' | 'mine'

/** 까닭 → 방송자 취소 사유 (서버 손님 기록 isPassReason이 '손님 패스'를 패스로 센다) */
export const REMOVE_REASON: Readonly<Record<RemoveWhy, string>> = { pass: '손님 패스', mine: '판매자 착오' }

export const WHY_CHOICES: readonly { readonly value: RemoveWhy; readonly label: string; readonly sub: string }[] = [
  { value: 'pass', label: '손님이 패스했어요', sub: '손님 기록에 패스로 남아요. 세 번부터 "패스 잦음 주의"가 붙어요' },
  { value: 'mine', label: '제가 잘못 넣었어요', sub: '손님 기록에 남기지 않아요' },
]

/** 줄 열쇠 (같은 번호가 다른 방송·옵션에 있을 수 있다) */
export const itemKey = (item: OrderItem): string => JSON.stringify([item.b, item.no, item.options])

/** 고른 번호 글 ("173·179번") */
export function pickedWords(items: readonly OrderItem[]): string {
  return `${[...new Set(items.map((item) => item.no))].sort((a, b) => a - b).map(String).join('·')}번`
}

/** 줄 하나 → 방송자 취소 이벤트 (요청 번호는 부르는 쪽이) */
export function removeEvent(item: OrderItem, buyer: string, why: RemoveWhy): Record<string, unknown> {
  return {
    type: 'host.cancel',
    b: item.b,
    no: item.no,
    buyer,
    reason: REMOVE_REASON[why],
    ...(item.options === null || item.options.length === 0 ? {} : { options: Object.fromEntries(item.options.map(([name, label]) => [name, label])) }),
  }
}

export interface OrderRemoveSheetProps {
  readonly visible: boolean
  /** 묶음 구매자 (지금의 구매자) */
  readonly buyer: string
  readonly items: readonly OrderItem[]
  readonly onClose: () => void
  /** 다 보냈다 — 상세·목록을 다시 받는다. removed = 뺀 줄 수 */
  readonly onDone: (removed: number, why: RemoveWhy) => void
}

export function OrderRemoveSheet({ visible, buyer, items, onClose, onDone }: OrderRemoveSheetProps) {
  const { p } = useKit()
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [why, setWhy] = useState<RemoveWhy>('pass')
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  // 줄마다 요청 번호 (다시 눌러도 이미 보낸 줄은 한 번만)
  const requestIds = useRef(new Map<string, string>())
  const chosen = items.filter((item) => picked.has(itemKey(item)))
  const sorted = [...items].sort((a, b) => a.no - b.no)
  const close = () => {
    if (busy) return
    setAsking(false)
    setProblem(null)
    setPicked(new Set())
    setWhy('pass')
    onClose()
  }
  const toggle = (key: string) => {
    setProblem(null)
    setPicked((before) => {
      const next = new Set(before)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const send = async () => {
    setBusy(true)
    setProblem(null)
    let failed = false
    for (const item of chosen) {
      const key = itemKey(item)
      const requestId = requestIds.current.get(key) ?? newRequestId()
      requestIds.current.set(key, requestId)
      try {
        // 방송이 있는 입력은 날짜를 따로 적지 않는다(서버가 방송으로 범위를 찾는다 — console/scope.tsx와 같다)
        await withRetry(() => post<WriteResult>('/api/events', { requestId, ...removeEvent(item, buyer, why) }))
      } catch (caught: unknown) {
        failed = true
        setProblem(isApiError(caught) ? caught.message : REMOVE_FAILED)
        break
      }
    }
    setBusy(false)
    setAsking(false)
    if (failed) return
    requestIds.current = new Map()
    const removed = chosen.length
    setPicked(new Set())
    setWhy('pass')
    onDone(removed, why)
  }
  const count = chosen.length
  const whyLabel = WHY_CHOICES.find((choice) => choice.value === why)?.label ?? ''
  // 단추는 좌우로만 — 부정 왼쪽, 긍정 오른쪽 (D-UX4-01)
  const actions = asking ? (
    <View style={{ flexDirection: 'row', gap: SPACE.sm }}>
      <View style={{ flex: 1 }}>
        <BigButton kind="secondary" label="아니요" onPress={() => setAsking(false)} disabled={busy} />
      </View>
      <View style={{ flex: 1 }}>
        <BigButton kind="danger" label={REMOVE_CONFIRM} busy={busy} disabled={busy} onPress={() => void send()} />
      </View>
    </View>
  ) : (
    <View style={{ flexDirection: 'row', gap: SPACE.sm }}>
      <View style={{ flex: 1 }}>
        <BigButton kind="secondary" label="닫기" onPress={close} disabled={busy} />
      </View>
      <View style={{ flex: 1 }}>
        <BigButton kind="danger" label={count === 0 ? REMOVE_CONFIRM : `${String(count)}개 빼기`} disabled={count === 0} onPress={() => { setProblem(null); setAsking(true) }} />
      </View>
    </View>
  )
  return (
    <BottomSheet visible={visible} onClose={close} title={asking ? `${pickedWords(chosen)}을 뺄까요?` : REMOVE_BUTTON} description={asking ? REMOVE_ASK_NOTE : REMOVE_DESCRIPTION} testID="order-remove" actions={actions}>
      {asking ? (
        <View role="list" aria-label="뺄 상품" style={{ gap: SPACE.xs }}>
          {[...chosen].sort((a, b) => a.no - b.no).map((item) => (
            <View key={itemKey(item)} role="listitem" aria-label={`${String(item.no)}번 ${item.name} ${formatWon(item.price * item.qty)}`} style={{ flexDirection: 'row', gap: SPACE.md, minHeight: 28, alignItems: 'center' }}>
              <Txt step="body" color="textSub">{String(item.no)}</Txt>
              <View style={{ flex: 1 }}>
                <Txt step="body" weight="medium" numberOfLines={1}>{item.qty > 1 ? `${item.name} ${String(item.qty)}개` : item.name}</Txt>
              </View>
              <Txt step="body" weight="medium" right>{formatWon(item.price * item.qty)}</Txt>
            </View>
          ))}
          <View style={{ marginTop: SPACE.sm }}>
            <Txt step="caption" weight="medium" color="textSub">{`까닭: ${whyLabel}`}</Txt>
          </View>
        </View>
      ) : (
        <>
          <View role="list" aria-label="뺄 상품" style={{ marginHorizontal: -SPACE.sm }}>
            {sorted.map((item) => {
              const key = itemKey(item)
              const on = picked.has(key)
              const price = formatWon(item.price * item.qty)
              return (
                <Tap
                  key={key}
                  role="checkbox"
                  aria-checked={on}
                  aria-label={`${String(item.no)}번 ${item.name}${item.qty > 1 ? ` ${String(item.qty)}개` : ''} ${price}`}
                  testID={`remove-pick-${String(item.no)}`}
                  onPress={() => toggle(key)}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, minHeight: 48, paddingHorizontal: SPACE.sm, borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}
                >
                  <View aria-hidden style={{ width: 26, height: 26, borderRadius: 13, borderCurve: 'continuous', backgroundColor: on ? p.danger : p.soft, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="check" color={on ? p.onPrimary : p.surface} size={16} />
                  </View>
                  <Txt step="body" color="textSub">{String(item.no)}</Txt>
                  <View style={{ flex: 1 }}>
                    <Txt step="body" weight="medium" numberOfLines={2}>{item.qty > 1 ? `${item.name} ${String(item.qty)}개` : item.name}</Txt>
                  </View>
                  <Txt step="body" weight="medium" right numberOfLines={1}>{price}</Txt>
                </Tap>
              )
            })}
          </View>
          <View role="radiogroup" aria-label={REMOVE_WHY} style={{ gap: SPACE.sm, marginTop: SPACE.sm }}>
            <Txt step="caption" weight="medium" color="textSub">{REMOVE_WHY}</Txt>
            {WHY_CHOICES.map((choice) => {
              const on = why === choice.value
              return (
                <Tap
                  key={choice.value}
                  role="radio"
                  aria-checked={on}
                  aria-label={`${choice.label} · ${choice.sub}`}
                  testID={`remove-why-${choice.value}`}
                  onPress={() => setWhy(choice.value)}
                  style={({ pressed }) => ({ gap: 2, paddingVertical: SPACE.sm, paddingHorizontal: SPACE.md, borderRadius: RADIUS.md, borderCurve: 'continuous', borderWidth: on ? 2 : 1, borderColor: on ? p.primary : p.border, backgroundColor: pressed ? p.pressed : on ? p.freshBg : p.surface })}
                >
                  <Txt step="body" weight={on ? 'bold' : 'medium'}>{choice.label}</Txt>
                  <Txt step="caption" color="textSub">{choice.sub}</Txt>
                </Tap>
              )
            })}
          </View>
        </>
      )}
      {problem !== null ? <ErrorLine>{problem}</ErrorLine> : null}
    </BottomSheet>
  )
}
