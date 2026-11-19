// 정산서 손님 합치기 (D-STMT-JOIN-01, 판매자 요청 2026-11-20 "닉네임은 다르지만 같은 휴대폰 번호인 경우 … 정산서 합쳐줘야 해. 자동으로 … 수동으로도"):
// 같은 날 정산서에서 한 장으로 보일 구매자 묶음 — 같은 번호는 서버가 저절로, 판매자가 고른 묶음은 기록대로. 연습 라이브는 묶지 않는다.
// 묶음을 받기 전에는 정산서를 보내지 않는다(ready) — 같은 사람에게 배송비가 두 번 붙은 정산서가 나가지 않게. 서버가 이 경로를 모르면(404) 묶음 없이.
import { useCallback, useMemo } from 'react'
import { joinSales, type BuyerOrder, type StatementJoinGroup } from '@livejjim/web/src/lib/broadcast-sales.ts'
import { newRequestId, post } from '../api/client.ts'
import { useCachedGet } from './cached-get.ts'

export type { StatementJoinGroup }

export const JOIN_BUTTON = '다른 닉네임 합치기'
export const JOIN_TITLE = '같은 사람의 다른 닉네임 고르기'
export const JOIN_HELP = '고른 닉네임의 상품을 이 정산서 한 장에 모아요. 배송비도 한 번만 붙어요.'
export const JOIN_CONFIRM = '합치기'
export const JOIN_NOBODY = '합칠 다른 구매자가 없어요.'
export const APART_BUTTON = '나누기'
export const APART_QUESTION = '정산서를 닉네임마다 나눌까요?'
export const APART_DESCRIPTION = '닉네임마다 정산서가 따로 생기고 배송비도 따로 붙어요. 같은 번호라도 다시 저절로 합치지 않아요.'
export const JOINS_LOAD_FAILED = '같은 사람의 정산서인지 확인하지 못했어요. 다시 불러와 주세요.'
export const JOIN_FAILED = '정산서를 합치지 못했어요. 다시 해 주세요.'
export const APART_FAILED = '정산서를 나누지 못했어요. 다시 해 주세요.'
/** 합친 정산서 위 한 줄 */
export const joinedNote = (count: number, auto: boolean): string =>
  auto ? `휴대폰 번호가 같아 닉네임 ${count}개를 한 정산서로 합쳤어요.` : `닉네임 ${count}개를 한 정산서로 합쳤어요.`

const NO_GROUPS: readonly StatementJoinGroup[] = []

export const joinsPath = (date: string, rehearsal: boolean): string | null => (rehearsal ? null : `/api/days/${date}/statement-joins`)

export interface StatementJoins {
  readonly groups: readonly StatementJoinGroup[]
  /** 묶음을 받았다(또는 받을 필요가 없다) — 그 전에는 보내지 않는다 */
  readonly ready: boolean
  readonly failed: boolean
  readonly reload: () => Promise<void>
  /** 합치기·나누기 (요청 번호를 새로 만든다). 실패면 던진다 */
  readonly change: (kind: 'join' | 'apart', buyers: readonly string[]) => Promise<void>
}

export function useStatementJoins(date: string, rehearsal: boolean): StatementJoins {
  const path = joinsPath(date, rehearsal)
  const { data, error, reload, set } = useCachedGet<{ groups: StatementJoinGroup[] }>(path)
  const change = useCallback(async (kind: 'join' | 'apart', buyers: readonly string[]) => {
    if (path === null) return
    const result = await post<{ groups: StatementJoinGroup[] }>(path, { requestId: newRequestId(), kind, buyers })
    set(result)
  }, [path, set])
  const missing = error?.status === 404
  const groups = data?.groups ?? NO_GROUPS
  return useMemo(() => ({
    groups,
    ready: path === null || data !== null || missing,
    failed: error !== null && !missing,
    reload,
    change,
  }), [groups, path, data, missing, error, reload, change])
}

/** 정산서 판매에 묶음을 입힌다 (화면·사진·보내기 모두 같은 묶음) */
export function useJoinedSales<T extends { orders: BuyerOrder[]; buyers: number }>(sales: T, joins: StatementJoins): T {
  return useMemo(() => joinSales(sales, joins.groups), [sales, joins.groups])
}
