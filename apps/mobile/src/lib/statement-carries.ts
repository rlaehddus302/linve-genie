// 지난 주문 같이 보내기 (D-STMT-CARRY-01, 판매자 요청 2026-11-20 "정산할 때 해당 구매자의 예전 주문(저번에 안 보낸 물품) 있으면 알려주기. 그래서 다 같이 묶어서 보낼 수 있게.
// 배송비도 함께 고려해 줘") · 정산서 배송비 바꾸기 (D-STMT-SHIP-01, "특정 사람의 경우 배송비가 천 원 더 드는 경우도 있으니까 정산서에서 바로 배송비를 수정할 수 있게"):
// - 지난 주문은 서버가 찾는다(GET /api/days/:date/statement-carries — 손님 장부로 이어진 같은 손님, 30일 안, 배송 완료·이미 보냈어요 빼고). 연습 라이브는 없다.
// - 같이 보내기·빼기·이미 보냈어요는 정산서 기록(엔진은 그대로). 배송비 바꾸기는 엔진 정산의 배송비 예외(주문 상세 "이 주문 배송비 바꾸기"와 같은 기록) —
//   입금 확인·주문 상세·확인서 문자와 같은 금액이 된다.
// - 화면·사진·엑셀/CSV·구매자마다 따로 저장·문자가 같은 셈(broadcast-sales dressSales → paperOrder → orderTotals).
// - 서버가 이 경로를 모르면(404) 지난 주문 없이. 못 받으면 정산서는 그대로 보이고 알림만 없다(보내기를 막지 않는다 — 지난 주문은 판매자가 고르는 것).
import { useCallback, useMemo } from 'react'
import { dressSales, pastOrdersWord, type BuyerOrder, type PastOrder, type StatementCarry } from '@livejjim/web/src/lib/broadcast-sales.ts'
import { settlementKey, type ScopeData } from './scope-data.ts'
import { formatWon } from './words.ts'
import { newRequestId, post } from '../api/client.ts'
import { useCachedGet } from './cached-get.ts'

export type { PastOrder, StatementCarry }

export const CARRY_BUTTON = '같이 보내기'
export const CARRY_SENT_BUTTON = '이미 보냈어요'
export const CARRY_DROP_BUTTON = '빼기'
export const CARRY_FAILED = '지난 주문을 바꾸지 못했어요. 다시 해 주세요.'
export const CARRY_SENT_QUESTION = '지난 주문을 이미 보냈나요?'
export const CARRY_SENT_DESCRIPTION = '이 지난 주문은 다시 알리지 않아요.'
/** 아직 안 보낸 지난 주문 알림 — "지난 11.15 주문 2개 · 20,000원을 아직 안 보냈어요." */
export const waitingNote = (orders: readonly PastOrder[]): string => `${pastOrdersWord(orders)}을 아직 안 보냈어요.`
export const WAITING_HELP = '같이 보내면 이 정산서에 함께 담고, 배송비는 합친 금액으로 다시 세요.'
/** 같이 보내는 지난 주문 — "지난 11.15 주문 2개 · 20,000원을 같이 보내요." */
export const carriedNote = (orders: readonly PastOrder[]): string => `${pastOrdersWord(orders)}을 같이 보내요.`
/** 지난 주문에서 이미 받은 돈 줄 이름 */
export const CREDIT_WORD = '지난 주문에서 받은 돈'
export const creditHelp = (credit: number): string => `지난 주문에서 이미 받은 ${formatWon(credit)}을 뺐어요.`
/** 목록 줄 꼬리표 */
export const WAITING_TAG = '지난 주문'

const NO_CARRIES: readonly StatementCarry[] = []

export const carriesPath = (date: string, rehearsal: boolean): string | null => (rehearsal ? null : `/api/days/${date}/statement-carries`)

export type CarryKind = 'carry' | 'drop' | 'sent'

export interface StatementCarries {
  readonly buyers: readonly StatementCarry[]
  readonly reload: () => Promise<void>
  /** 같이 보내기·빼기·이미 보냈어요 (요청 번호를 새로 만든다). buyer는 이 정산서의 대표 구매자. 실패면 던진다 */
  readonly change: (kind: CarryKind, buyer: string, past: readonly PastOrder[]) => Promise<void>
}

export function useStatementCarries(date: string, rehearsal: boolean): StatementCarries {
  const path = carriesPath(date, rehearsal)
  const { data, reload, set } = useCachedGet<{ buyers: StatementCarry[] }>(path)
  const change = useCallback(async (kind: CarryKind, buyer: string, past: readonly PastOrder[]) => {
    if (path === null || past.length === 0) return
    const result = await post<{ buyers: StatementCarry[] }>(path, { requestId: newRequestId(), kind, buyer, past: past.map(order => ({ date: order.date, buyer: order.buyer })) })
    set(result)
  }, [path, set])
  const buyers = data?.buyers ?? NO_CARRIES
  return useMemo(() => ({ buyers, reload, change }), [buyers, reload, change])
}

/**
 * 정산서 판매에 지난 주문·손님 배송비 예외를 입힌다 (화면·사진·보내기 모두 같은 값). settlements: 그 날짜 범위의 엔진 정산(없으면 예외 없음).
 * 합친 정산서는 대표 구매자의 정산 예외를 따른다
 */
export function useStatementSales<T extends { orders: BuyerOrder[] }>(sales: T, carries: StatementCarries, settlements: ScopeData['settlements'] | undefined, date: string): T {
  return useMemo(() => dressSales(sales, carries.buyers, buyer => settlements?.get(settlementKey({ buyer, date }))), [sales, carries.buyers, settlements, date])
}
