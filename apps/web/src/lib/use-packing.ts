// 포장 목록 받기 (AC-I2-32·33·35): 포장 상태는 증분 조회에 없다 — 품목이 바뀌거나(범위 자료의 묶음·상품·구매자 목록) 포장 알림(packing)이
// 오면 GET /api/days/:date/packing을 다시 받는다. 늦게 온 앞 응답은 버린다. 채팅만 들어올 때(목록이 그대로)는 다시 받지 않는다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { get, isApiError, type ApiError } from '../api/client.ts'
import type { PackingEntry, PackingList, Settlement } from '../api/types.ts'
import { settlementKey, type ScopeData } from './scope-data.ts'

/** 품목 키(옵션 찜은 변형 키 `<방송>/<번호>#<옵션 글>`)의 상품 키 — 품종은 상품에 있다 (O4: 옵션 품목의 품종이 바뀌어도 다시 받게) */
export function productKeyOfItem(key: string): string {
  const at = key.indexOf('#')
  return at < 0 ? key : key.slice(0, at)
}

/**
 * 포장·확인서에 닿는 범위 자료의 모양: 그날 묶음(구매자·품목·상품 합계·입금 상태)·품목의 품종·구매자 표시 이름·방송 제목.
 * 이 값이 같으면 포장 목록(품목의 가격 스냅샷 포함)·확인서 그림도 같다(채팅만 들어온 변경은 다시 받지 않는다).
 * 상품 합계 = 품목 가격 스냅샷의 합 — 입금 전 찜까지 가격을 바꾸면(UNPAID_CLAIMS) 품목은 그대로여도 합계가 바뀐다 (SA-I2-002).
 */
export function closingSignature(data: ScopeData): string {
  const parts: unknown[] = []
  for (const settlement of data.settlements.values()) {
    if (settlement.date !== data.date) continue
    const buyer = data.buyers.get(settlement.buyer)
    parts.push([settlement.buyer, buyer?.display ?? '', settlement.payment, settlement.items, settlement.subtotal, settlement.items.map((key) => data.products.get(productKeyOfItem(key))?.name ?? '')])
  }
  for (const broadcast of data.broadcasts.values()) parts.push([broadcast.id, broadcast.title])
  return JSON.stringify(parts)
}

/**
 * 그 묶음의 포장 라벨에 찍히는 값의 모양 (L-9, AC-I2-34·39, LBL-03): 품목(방송·번호)·방송 제목·상품 합계·구매자(문자 구매자인지, 표시 이름).
 * 이 값이나 가게 이름이 바뀌면 라벨 그림을 새로 받는다 — 화면 그림 = "그림 저장" 파일 = 지금 라벨.
 * 범위 자료에서 바로 정한다(포장 목록을 다시 받기를 기다리지 않는다). 다른 묶음·채팅·입금만 바뀌면 같다.
 */
export function packingLabelSignature(data: ScopeData, buyer: string): string {
  const settlement = data.settlements.get(settlementKey({ buyer, date: data.date }))
  const info = data.buyers.get(buyer)
  const titles = [...data.broadcasts.values()].map((broadcast) => [broadcast.id, broadcast.title])
  return JSON.stringify([settlement?.items ?? null, settlement?.subtotal ?? null, info?.kind ?? null, info?.display ?? null, titles])
}

/**
 * 한 묶음의 확인서에 닿는 자료의 모양 (AC-I2-13): 그 묶음(품목·금액·기록)·구매자 표시 이름·끝자리·품목의 품종·방송 제목.
 * 다른 묶음이나 채팅만 바뀌면 같다 — 그 묶음이 바뀔 때만 그림을 새로 받는다.
 */
export function receiptSignature(data: ScopeData, settlement: Settlement): string {
  const buyer = data.buyers.get(settlement.buyer)
  const titles = [...data.broadcasts.values()].map((broadcast) => [broadcast.id, broadcast.title])
  return JSON.stringify([settlement, buyer?.display ?? '', buyer?.phoneLast4 ?? null, settlement.items.map((key) => data.products.get(productKeyOfItem(key))?.name ?? ''), titles])
}

export function useClosingSignature(data: ScopeData): string {
  return useMemo(() => closingSignature(data), [data.settlements, data.buyers, data.products, data.broadcasts, data.date])
}

export interface PackingState {
  /** 받은 포장 목록 (아직 없으면 null) */
  readonly entries: readonly PackingEntry[] | null
  readonly error: ApiError | null
  readonly loading: boolean
  /** 지금 다시 받기 */
  readonly reload: () => void
  /** 포장 명령 응답의 묶음으로 한 줄을 바로 바꾼다 (알림을 기다리지 않는다) */
  readonly replace: (entry: PackingEntry) => void
}

/** date가 null이면 받지 않는다 (리허설 범위). trigger가 바뀔 때마다 다시 받는다 */
export function usePackingList(date: string | null, trigger: string): PackingState {
  const [entries, setEntries] = useState<readonly PackingEntry[] | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const version = useRef(0)

  useEffect(() => {
    if (date === null) {
      setEntries(null)
      return
    }
    const mine = ++version.current
    setLoading(true)
    get<PackingList>(`/api/days/${date}/packing`).then(
      (list) => {
        if (mine !== version.current) return
        setEntries(list.entries)
        setError(null)
        setLoading(false)
      },
      (caught: unknown) => {
        if (mine !== version.current) return
        setLoading(false)
        if (isApiError(caught)) setError(caught)
      },
    )
  }, [date, trigger, attempt])

  const replace = useCallback((entry: PackingEntry) => {
    setEntries((list) => {
      if (list === null) return list
      const at = list.findIndex((item) => item.buyer === entry.buyer)
      if (at < 0) return [...list, entry]
      const next = [...list]
      next[at] = entry
      return next
    })
  }, [])

  return { entries, error, loading, reload: useCallback(() => setAttempt((n) => n + 1), []), replace }
}
