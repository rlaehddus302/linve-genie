// 그 날짜 손님마다 정보·확인서 단계 (D-UX4-122) — 택배 줄·영수증 줄을 기억해 둔 것으로 바로 채우고 뒤에서 다시 받는다 (D-UX4-77).
// 하나라도 못 받으면 null (모름 — 주문 탭이 "모두 끝났어요"를 말하지 않는다).
import { useMemo } from 'react'
import type { ReceiptBuyers } from '@livejjim/web/src/api/types.ts'
import type { ParcelDay } from '@livejjim/web/src/api/parcel-types.ts'
import { useCachedGet } from './cached-get.ts'
import { buyerStepsOf, type BuyerSteps } from './order-flow.ts'

export function useOrderSteps(date: string, version: number): ReadonlyMap<string, BuyerSteps> | null {
  const { data: parcels } = useCachedGet<ParcelDay>(`/api/parcels/days/${date}`, version)
  const { data: receipts } = useCachedGet<ReceiptBuyers>(`/api/days/${date}/receipt-buyers`, version)
  return useMemo(() => buyerStepsOf(parcels, receipts), [parcels, receipts])
}
