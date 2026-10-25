// 콘솔 1등 옆 "입금 늦음 주의" (CRM1 D-CRM1-07, AC-CRM1-18~20). 표시만 한다 — 판정·대기·승계·라벨·감사 메시지·정산을 바꾸지 않고 이벤트를 쓰지 않는다.
// - 실제 방송만(리허설은 부르지 않는다). 판매자 전용 조회 GET /api/days/:date/customers의 caution을 본다. 단골은 콘솔에 보이지 않는다.
// - 콘솔을 열 때 받고, 1등이 바뀌면 다시 받는다(10초에 한 번까지 — 연 때 받은 것은 세지 않아 연 뒤 첫 변화는 바로). 받지 못하면 꼬리표 없이 지금 화면 그대로(오류 띠·알림 없음).
// - 꼬리표는 누를 수 없는 작은 글. 화면 읽기 프로그램엔 "입금 늦음 주의 손님".
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { CAUTION_SHORT, CAUTION_SPOKEN, CAUTION_WORD, useDayCustomers } from '../lib/customers.ts'
import type { ScopeData } from '../lib/scope-data.ts'

/** 다시 받기 가장 짧은 간격 (D-CRM1-07) */
export const CAUTION_GAP_MS = 10_000

/** 그 구매자(지금의 구매자 ID)가 입금 늦음 주의인가 */
export type CautionOf = (buyer: string) => boolean

const NONE: CautionOf = () => false

export const CautionContext = createContext<CautionOf>(NONE)

export const useCaution = (): CautionOf => useContext(CautionContext)

/** 그날 모든 상품의 1등(지금의 구매자) — 바뀌면 다시 받는다 */
export function winnersKey(data: ScopeData): string {
  const ids = new Set<string>()
  for (const product of data.products.values()) {
    for (const id of product.winners) ids.add(id)
    for (const variant of product.variants) for (const id of variant.winners) ids.add(id)
  }
  return [...ids].sort().join('|')
}

/** 콘솔이 쓰는 꼬리표 자료 (리허설·실패면 늘 false) */
export function useConsoleCaution(data: ScopeData | null, date: string, rehearsal: boolean): CautionOf {
  const key = useMemo(() => (data === null ? '' : winnersKey(data)), [data?.products])
  // 방송 자료가 온 뒤에 연다 — 자료 없이(1등 '') 받은 것이 연 때 받기가 되면 자료가 오는 순간이 첫 변화로 세져 그 뒤 1등 변화가 10초 밀린다(TE-CRM1-001)
  const customers = useDayCustomers(date, !rehearsal && date !== '' && data !== null, key, CAUTION_GAP_MS)
  return useMemo<CautionOf>(() => {
    if (rehearsal || customers.view === null) return NONE
    const map = customers.map
    return (buyer) => map.get(buyer)?.caution === true
  }, [rehearsal, customers.view, customers.map])
}

export function CautionProvider({ value, children }: { readonly value: CautionOf; readonly children: ReactNode }) {
  return <CautionContext.Provider value={value}>{children}</CautionContext.Provider>
}

/** 1등 이름 뒤의 작은 꼬리표 (누르는 것이 아니다) */
export function CautionMark({ short = false }: { readonly short?: boolean }) {
  return (
    <span className="tag tag-caution caution-mark">
      <span aria-hidden="true">{short ? CAUTION_SHORT : CAUTION_WORD}</span>
      <span className="sr-only">{CAUTION_SPOKEN}</span>
    </span>
  )
}

/** 1등 이름들 ", "로 잇고 주의 손님 뒤에 꼬리표 (꼬리표가 없으면 글자는 지금 그대로) */
export function WinnerNames({ ids, nameOf }: { readonly ids: readonly string[]; readonly nameOf: (id: string) => string }) {
  const caution = useCaution()
  // 주의 손님이 없으면 지금과 같은 한 덩어리 글 (다른 화면·시험이 보는 글자 그대로)
  if (!ids.some((id) => caution(id))) return <>{ids.map(nameOf).join(', ')}</>
  return (
    <>
      {ids.map((id, index) => (
        <span key={`${id}-${String(index)}`}>
          {index > 0 ? ', ' : ''}
          {nameOf(id)}
          {caution(id) ? (
            <>
              {' '}
              <CautionMark />
            </>
          ) : null}
        </span>
      ))}
    </>
  )
}
