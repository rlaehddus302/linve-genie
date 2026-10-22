// 구매자 자세히의 "지난 구매" (BUY-05, D-I2-08, D-101, AC-I2-41). 실제 범위만 — 리허설 범위의 구매자 자세히에는 이 부분이 없다.
// - 서버가 채널 ID·전화번호 키로만 이은 다른 날짜의 묶음(최근 날짜부터 20개, "더 보기")을 그대로 보인다. 닉네임·메모로는 잇지 않는다.
// - 항목마다 날짜(연도·요일)·방송 제목·그날 이름·"상품 n개"(번호·품종·가격)·최종 결제 금액·입금 상태 말·포장·배송 상태 말(송장번호)·찾은 까닭.
// - 항목을 누르면 그 날짜의 정산 자세히(`/settlements?date=…&buyer=…`)로 간다.
// - 품목 줄 (O4 D-O4-06): `{번호}번 {품종}[ {옵션 글}][ {수량}개] {찜 금액}` — 찜 금액은 서버(코어) 값 그대로, 없으면 금액 칸을 비운다(단가로 채우지 않는다).
//   "상품 n개"는 수량 합(D-O3-05와 같은 셈). 옵션 없는 수량 1 품목 줄은 이전 그대로.
import { formatWon } from '@livejjim/core'
import { useEffect, useState, type MouseEvent } from 'react'
import { get, isApiError, withQuery, type ApiError } from '../api/client.ts'
import type { PastItem, PastView } from '../api/types.ts'
import { dateLong } from '../lib/kst.ts'
import { PACKING_TONE, packingWords } from '../lib/packing.ts'
import { routePath } from '../lib/router.ts'
import { paymentWord } from '../lib/words.ts'
import { RequestError } from './ErrorNote.tsx'

export const NO_PAST = '다른 날의 구매 기록이 없어요.'

type PastLine = PastItem['items'][number]

/** 지난 구매 품목 한 줄 (AC-O4-24): "22번 반팔티 105/검정색 2개 34,000원", "7번 핑크프릴 8,000원", 금액이 없으면 "21번 반바지 M" */
export function pastLineWords(line: PastLine): string {
  const name = line.name.trim() === '' ? '품종 미입력' : line.name
  const variant = line.variant === null || line.variant === '' ? '' : ` ${line.variant}`
  const qty = line.qty > 1 ? ` ${String(line.qty)}개` : ''
  const amount = line.amount === null ? '' : ` ${formatWon(line.amount)}`
  return `${String(line.no)}번 ${name}${variant}${qty}${amount}`
}

/** "상품 n개"의 n = 수량 합 */
export const pastCount = (lines: readonly PastLine[]): number => lines.reduce((sum, line) => sum + line.qty, 0)

export interface PastPurchasesProps {
  readonly date: string
  /** 지금의 구매자 ID */
  readonly buyer: string
  /** 바뀌면 다시 받는다 (합치기·떼어 내기로 표지가 바뀐다) */
  readonly refreshKey: string
  readonly onOpen: (date: string, buyer: string) => void
}

export function PastPurchases({ date, buyer, refreshKey, onOpen }: PastPurchasesProps) {
  const [items, setItems] = useState<readonly PastItem[] | null>(null)
  const [next, setNext] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setError(null)
    get<PastView>(withQuery(`/api/days/${date}/past`, { buyer })).then(
      (view) => {
        if (!alive) return
        setItems(view.items)
        setMore(view.more)
        setNext(view.next)
      },
      (caught: unknown) => {
        if (alive && isApiError(caught)) setError(caught)
      },
    )
    return () => {
      alive = false
    }
  }, [date, buyer, refreshKey, attempt])

  const loadMore = async () => {
    if (next === null || loadingMore) return
    setLoadingMore(true)
    setError(null)
    try {
      const view = await get<PastView>(withQuery(`/api/days/${date}/past`, { buyer, before: next }))
      setItems((current) => [...(current ?? []), ...view.items])
      setMore(view.more)
      setNext(view.next)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    } finally {
      setLoadingMore(false)
    }
  }

  const click = (event: MouseEvent<HTMLAnchorElement>, item: PastItem) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onOpen(item.date, item.buyer)
  }

  return (
    <section className="stack-tight" aria-label="지난 구매">
      <h3 className="sub-title">지난 구매</h3>
      {items === null && error === null ? <p role="status">불러오는 중…</p> : null}
      {items !== null && items.length === 0 ? <p>{NO_PAST}</p> : null}
      {items !== null && items.length > 0 ? (
        <ul className="plain-list stack-tight past-list">
          {items.map((item) => (
            <li key={`${item.date}|${item.buyer}`}>
              <a className="list-link past-item" href={routePath({ name: 'settlements', date: item.date, rehearsal: false, buyer: item.buyer })} onClick={(event) => click(event, item)}>
                <strong>{dateLong(item.date)}</strong>
                <span>{item.broadcasts.join(', ')}</span>
                <span>그날 이름 {item.name}</span>
                <span className="past-lines">
                  상품 {pastCount(item.items)}개 ({item.items.map(pastLineWords).join(' · ')})
                </span>
                <span>최종 {formatWon(item.total)}</span>
                <span className={`tag pay-${item.payment}`}>{paymentWord(item.payment, item.refundDue)}</span>
                <span className="tag" data-tone={PACKING_TONE[item.packing]}>
                  {packingWords(item.packing, item.invoice)}
                </span>
                <span className="hint">{item.reasons.join(' · ')}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {more ? (
        <button type="button" className="button" disabled={loadingMore} onClick={() => void loadMore()}>
          더 보기
        </button>
      ) : null}
      {error !== null ? <RequestError error={error} onRetry={() => setAttempt((n) => n + 1)} retryLabel="다시 불러오기" /> : null}
    </section>
  )
}
