// 이 주문 배송비 바꾸기 (D-UX4-128, 사용자 지시 2026-11-11 "배송비 우리가 만든 키보드로 입력하게 해"):
// 주문 상세 [배송비 바꾸기] → "이 주문 배송비 바꾸기"를 고르면 이 화면이 쌓인다. 상품 추가 가격 단계·손님 정보 휴대폰 번호 단계와 같은 모양 —
// 묻는 말 아래 큰 칸(쉼표·"원"), 앱 숫자판, 숫자판 바로 위 [저장하기]. 처음 값은 지금 배송비(주문 상세), 0원(무료)도 된다.
// 쓰기는 옛 금액 고치기 시트(order-fix.tsx, 배송비 '직접 적기')와 같은 이벤트: settlement.shippingOverride mode FIXED, 한 화면에 요청 번호 하나(다시 보내도 한 번만).
// 금액은 정수 원. 범위(0원~1,000,000원)는 settle.ts readAmount로 읽고 밖이면 칸 아래 빨간 글·흔들기, [저장하기]는 흐리게.
// 30일 지난 날짜(봉인)는 보기만 한다. 적용되지 않았으면(changed=false) 화면을 닫지 않고 알린다.
import { useRef, useState } from 'react'
import { Animated, View } from 'react-native'
import type { OrderDetailView } from '@livejjim/web/src/api/order-types.ts'
import type { Settlement, WriteResult } from '@livejjim/web/src/api/types.ts'
import { isApiError, newRequestId, post, withQuery, withRetry } from '../api/client.ts'
import { useCachedGet } from '../lib/cached-get.ts'
import { useDayScope } from '../lib/day-scope.ts'
import { koreanWon } from '../lib/korean-won.ts'
import { ORDERS_TOPIC, orderPath } from '../lib/orders.ts'
import { settlementKey } from '../lib/scope-data.ts'
import { signalScreens } from '../lib/screen-signals.ts'
import { NOT_APPLIED_SETTLEMENT, SEALED_SETTLEMENT, SHIPPING_RANGE, readAmount } from '../lib/settle.ts'
import { formatWon, RETRY_NOW } from '../lib/words.ts'
import { BigButton, ErrorLine, StackPage, Txt, useWrongShake } from '../ui/kit/index.ts'
import { SPACE } from '../ui/kit/tokens.ts'
import { Loading, Notice } from '../ui/parts.tsx'
import { BigNumber, NumberKeys } from './console/ProductAdd.tsx'
import { useFooterInset } from './console/parts.tsx'

export const SHIPPING_TITLE = '배송비 바꾸기'
export const ASK_SHIPPING = '이 주문 배송비는 얼마인가요?'
export const SHIPPING_SAVE = '저장하기'
export const NO_SETTLEMENT = '이 주문의 금액을 찾지 못했어요. 잠시 뒤 다시 열어 주세요.'
const SAVE_FAILED = '저장하지 못했어요. 다시 눌러 주세요.'

/** 지금 배송비 회색 줄 */
export const currentShippingWords = (amount: number): string => `지금 배송비 ${formatWon(amount)}`

/** 배송비 자리 수 — 1,000,000원(일곱 자리)까지. 넘친 한 자리는 보여 주고 그보다 더 치면 받지 않는다(상품 추가와 같은 규칙) */
const SHIPPING_DIGITS = String(SHIPPING_RANGE.max).length

/**
 * 숫자판 누름 하나 → 배송비 숫자 (순수 계산). 앞의 0은 떼지만 0원(무료)은 "0" 하나로 남긴다. 지우기는 끝 한 자리.
 * 이미 limit을 넘긴 뒤에 더 치면 null(받지 않음 — 흔든다)
 */
export function typeShipping(current: string, value: string, limit = SHIPPING_DIGITS): string | null {
  if (value === 'back') return current.slice(0, -1)
  if (current.length > limit) return null
  return (current + value).replace(/^0+(?=\d)/, '')
}

/** 큰 칸 쉼표 (원은 붙임말로) */
const commas = (digits: string): string => formatWon(Number(digits)).replace(/원$/, '')

export interface OrderShippingProps {
  readonly date: string
  readonly buyer: string
  readonly onSaved: () => void
}

/** 배송비 바꾸기 쌓인 화면 — 한 단계라 머리 ‹는 화면을 닫는다 */
export function OrderShippingScreen({ date, buyer, onBack, onSaved }: OrderShippingProps & { readonly onBack: () => void }) {
  return (
    <StackPage name={SHIPPING_TITLE} title={SHIPPING_TITLE} onBack={onBack} scroll={false} testID="order-shipping">
      <OrderShippingFlow date={date} buyer={buyer} onSaved={onSaved} />
    </StackPage>
  )
}

/** 틀 없는 내용 (주문 상세가 쌓인 경로 없이 제자리에 그릴 때·시험) */
export function OrderShippingFlow({ date, buyer, onSaved }: OrderShippingProps) {
  const day = useDayScope(date)
  const detail = useCachedGet<OrderDetailView>(orderPath(date, buyer))
  const data = day.data
  if (data === null) {
    if (day.error === null) return <Loading />
    return (
      <View style={{ padding: SPACE.xl, gap: SPACE.sm }}>
        <Notice tone="danger" alert>{day.error.message}</Notice>
        <BigButton kind="secondary" label={RETRY_NOW} onPress={day.reload} />
      </View>
    )
  }
  if (data.sealed === true) {
    return (
      <View style={{ padding: SPACE.xl }}>
        <Notice tone="info">{SEALED_SETTLEMENT}</Notice>
      </View>
    )
  }
  const settlement = data.settlements.get(settlementKey({ buyer, date }))
  if (settlement === undefined) {
    return (
      <View style={{ padding: SPACE.xl }}>
        <Notice tone="info">{NO_SETTLEMENT}</Notice>
      </View>
    )
  }
  // 처음 값은 주문 상세의 지금 배송비 — 상세를 못 받으면 정산 묶음의 배송비
  if (detail.data === null && detail.error === null) return <Loading />
  const current = detail.data?.shipping ?? settlement.shipping
  return <ShippingStep settlement={settlement} current={current} onSaved={onSaved} />
}

function ShippingStep({ settlement, current, onSaved }: { readonly settlement: Settlement; readonly current: number; readonly onSaved: () => void }) {
  const footer = useFooterInset()
  // 숫자와 넘쳐 친 횟수(흔들기)를 한 상태로 — 누름마다 앞 누름의 결과에서 이어 간다 (상품 추가 D-UX4-102와 같게)
  const [typed, setTyped] = useState<{ readonly digits: string; readonly again: number }>(() => ({ digits: String(current), again: 0 }))
  const { digits, again } = typed
  const requestId = useRef(newRequestId())
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ readonly tone: 'danger' | 'warning'; readonly text: string } | null>(null)

  const read = digits === '' ? null : readAmount(digits, SHIPPING_RANGE)
  const problem = read !== null && !read.ok ? read.message : null
  // 잘못이 생기거나 바뀌면, 또 넘쳐 치면 큰 칸이 좌우로 흔들리고 진동한다 (상품 추가와 같게)
  const shake = useWrongShake(problem, again)

  const typeKey = (value: string) => {
    setNotice(null)
    setTyped((now) => {
      const next = typeShipping(now.digits, value)
      return next === null ? { ...now, again: now.again + 1 } : { ...now, digits: next }
    })
  }

  const save = async () => {
    if (busy || read === null || !read.ok) return
    setBusy(true)
    setNotice(null)
    try {
      const result = await withRetry(() =>
        post<WriteResult>(withQuery('/api/events', { date: settlement.date, rehearsal: false }), {
          requestId: requestId.current,
          type: 'settlement.shippingOverride',
          buyer: settlement.buyer,
          date: settlement.date,
          mode: 'FIXED',
          amountText: String(read.amount),
        }),
      )
      setBusy(false)
      if (!result.changed) {
        setNotice({ tone: 'warning', text: NOT_APPLIED_SETTLEMENT })
        return
      }
      signalScreens(ORDERS_TOPIC)
      onSaved()
    } catch (caught: unknown) {
      setBusy(false)
      setNotice({ tone: 'danger', text: isApiError(caught) && caught.message !== '' ? caught.message : SAVE_FAILED })
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1, paddingHorizontal: SPACE.xxl, paddingTop: SPACE.xxl, gap: SPACE.xxl }}>
        <View style={{ gap: 2 }}>
          <Txt step="title" weight="bold">
            {ASK_SHIPPING}
          </Txt>
          <Txt step="body" color="textSub">
            {currentShippingWords(current)}
          </Txt>
        </View>
        <View style={{ gap: SPACE.sm }}>
          <Animated.View style={{ transform: [{ translateX: shake }] }}>
            <BigNumber label="배송비" question={ASK_SHIPPING} digits={digits} format={commas} suffix="원" />
          </Animated.View>
          {/* 만 원 아래는 한글 읽기가 위 금액과 같아 그리지 않는다 (상품 추가 가격과 같게) */}
          {problem === null && Number(digits) >= 10_000 ? (
            <Txt step="body" color="textSub">
              {koreanWon(Number(digits))}
            </Txt>
          ) : null}
          {problem !== null ? <ErrorLine large>{problem}</ErrorLine> : null}
        </View>
      </View>
      {/* 숫자판 바로 위 큰 단추 — 상품 추가 [다음]과 같은 자리 */}
      <View style={{ paddingHorizontal: SPACE.xl, paddingTop: SPACE.sm, paddingBottom: SPACE.sm, gap: SPACE.sm }}>
        {notice !== null ? (
          <Notice tone={notice.tone} alert>
            {notice.text}
          </Notice>
        ) : null}
        <BigButton label={SHIPPING_SAVE} busy={busy} disabled={busy || read === null || !read.ok} onPress={() => void save()} />
      </View>
      <View style={{ paddingBottom: footer }}>
        <NumberKeys onKey={typeKey} />
      </View>
    </View>
  )
}
