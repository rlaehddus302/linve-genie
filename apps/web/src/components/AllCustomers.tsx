// 구매자 화면의 "모든 손님" 보기 (CRM1 D-CRM1-06·D-CRM1-09, AC-CRM1-16·17·24). 판매자 계정만.
// - 목록: 표지마다 한 줄(이름·종류·꼬리표·누적 구매 금액·구매 횟수·마지막 구매일·미입금 횟수), 20줄씩 "더 보기".
//   정렬·거르기는 서버가 한다(주소에 sort·filter — 새로고침해도 같다). 찾는 말은 주소에 넣지 않는다(끝자리 숫자일 수 있다).
// - 손님 자세히: 손님 기록 칸 + 메모 + 날짜 줄(최근부터 20개씩), 날짜 줄을 누르면 그날 구매자 자세히. 차단 버튼은 없고
//   "가장 최근 날짜(10월 22일)의 구매자 화면에서 차단할 수 있어요" 길만 (D-CRM1-09).
// - 뒤로 가기로 목록에 돌아오면 같은 정렬·거르기·찾는 말·불러온 줄·스크롤 자리 (받아 둔 목록을 보이고 뒤에서 새로 받는다).
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { get, isApiError, withQuery, type ApiError } from '../api/client.ts'
import {
  CUSTOMER_FILTERS,
  CUSTOMER_SORTS,
  FILTER_WORD,
  SORT_WORD,
  customerDate,
  dayLineTags,
  isCustomerFilter,
  isCustomerSort,
  memberLabel,
  type CustomerDetailView,
  type CustomerDayLine,
  type CustomerFilter,
  type CustomerRow,
  type CustomerSort,
  type CustomersView,
} from '../lib/customers.ts'
import { formatWon } from '../lib/derive.ts'
import { dateWords, kstToday } from '../lib/kst.ts'
import { routePath, type Navigate, type ScopeRoute } from '../lib/router.ts'
import { useWide } from '../lib/use-wide.ts'
import { CustomerTags, MemoEditor, SummaryFacts } from './CustomerParts.tsx'
import { RequestError } from './ErrorNote.tsx'

/** 받아 둔 목록 (뒤로 가기로 돌아올 때 그대로 보인다) */
interface ListMemory {
  readonly q: string
  readonly rows: readonly CustomerRow[]
  readonly count: number
  readonly more: boolean
  readonly next: number | null
  readonly today: string
  scrollY: number
}

const memory = new Map<string, ListMemory>()

/** "날짜별 · 모든 손님"에서 새로 고르면 지난 찾기·스크롤을 잊는다 */
export function forgetCustomerList(): void {
  memory.clear()
}

const sortOf = (route: ScopeRoute): CustomerSort => (isCustomerSort(route.sort) ? route.sort : 'total')
const filterOf = (route: ScopeRoute): CustomerFilter => (isCustomerFilter(route.filter) ? route.filter : 'all')

/** 목록 주소 (기본 정렬·거르기는 적지 않는다) */
export function customersRoute(route: Pick<ScopeRoute, 'date'>, sort: CustomerSort, filter: CustomerFilter, customer?: string): ScopeRoute {
  return {
    name: 'buyers',
    ...(route.date === undefined ? {} : { date: route.date }),
    rehearsal: false,
    view: 'customers',
    ...(sort === 'total' ? {} : { sort }),
    ...(filter === 'all' ? {} : { filter }),
    ...(customer === undefined ? {} : { customer }),
  }
}

function linkClick(event: MouseEvent<HTMLAnchorElement>, go: () => void): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  go()
}

export function AllCustomers({ route, navigate }: { readonly route: ScopeRoute; readonly navigate: Navigate }) {
  return route.customer === undefined ? <CustomerList route={route} navigate={navigate} /> : <CustomerDetail key={route.customer} route={route} id={route.customer} navigate={navigate} />
}

// ── 목록 ──────────────────────────────────────────────────────────────

const listPath = (sort: CustomerSort, filter: CustomerFilter, q: string, offset: number): string =>
  withQuery('/api/customers', { sort, filter, ...(q.trim() === '' ? {} : { q: q.trim() }), offset })

function CustomerList({ route, navigate }: { readonly route: ScopeRoute; readonly navigate: Navigate }) {
  const sort = sortOf(route)
  const filter = filterOf(route)
  const key = `${sort}|${filter}`
  const remembered = memory.get(key)
  const wide = useWide()
  const [query, setQuery] = useState(remembered?.q ?? '')
  const [asked, setAsked] = useState(remembered?.q ?? '')
  const [rows, setRows] = useState<readonly CustomerRow[] | null>(remembered?.rows ?? null)
  const [count, setCount] = useState(remembered?.count ?? 0)
  const [more, setMore] = useState(remembered?.more ?? false)
  const [next, setNext] = useState<number | null>(remembered?.next ?? null)
  const [today, setToday] = useState(remembered?.today ?? '')
  const [error, setError] = useState<ApiError | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const restoreY = useRef<number | null>(remembered?.scrollY ?? null)
  const shownRef = useRef(remembered?.rows.length ?? 0)

  // 찾는 말은 치기를 멈추면 (0.3초) 묻는다
  useEffect(() => {
    if (query === asked) return
    const handle = setTimeout(() => setAsked(query), 300)
    return () => clearTimeout(handle)
  }, [query, asked])

  // 받기: 처음·정렬·거르기·찾는 말이 바뀌면 첫 쪽. 받아 둔 목록으로 돌아왔으면 그만큼 다시 받아 바꾼다(차단·입금이 바뀌었을 수 있다)
  useEffect(() => {
    let alive = true
    const want = Math.max(shownRef.current, 1)
    shownRef.current = 0
    setError(null)
    const load = async () => {
      const gathered: CustomerRow[] = []
      let view: CustomersView
      let offset = 0
      do {
        view = await get<CustomersView>(listPath(sort, filter, asked, offset))
        gathered.push(...view.customers)
        if (view.next === null) break
        offset = view.next
      } while (gathered.length < want)
      return { view, gathered }
    }
    load().then(
      ({ view, gathered }) => {
        if (!alive) return
        setRows(gathered)
        setCount(view.count)
        setMore(view.more)
        setNext(view.next)
        setToday(view.today)
      },
      (caught: unknown) => {
        if (alive && isApiError(caught)) setError(caught)
      },
    )
    return () => {
      alive = false
    }
  }, [sort, filter, asked, attempt])

  // 받아 둔 목록이면 그때의 스크롤 자리로
  useLayoutEffect(() => {
    if (restoreY.current === null || rows === null) return
    const y = restoreY.current
    restoreY.current = null
    if (y > 0 && typeof window.scrollTo === 'function') {
      try {
        window.scrollTo(0, y)
      } catch {
        // 스크롤을 못 하는 환경(시험)은 그대로
      }
    }
  }, [rows])

  // 지금 목록을 기억한다 (자세히로 갔다 돌아오면 그대로)
  useEffect(() => {
    if (rows === null) return
    memory.set(key, { q: asked, rows, count, more, next, today, scrollY: memory.get(key)?.scrollY ?? 0 })
  }, [key, asked, rows, count, more, next, today])

  const loadMore = async () => {
    if (next === null || loadingMore) return
    setLoadingMore(true)
    setError(null)
    try {
      const view = await get<CustomersView>(listPath(sort, filter, asked, next))
      setRows((current) => [...(current ?? []), ...view.customers])
      setCount(view.count)
      setMore(view.more)
      setNext(view.next)
      setToday(view.today)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    } finally {
      setLoadingMore(false)
    }
  }

  const choose = (nextSort: CustomerSort, nextFilter: CustomerFilter) => {
    memory.delete(`${nextSort}|${nextFilter}`)
    shownRef.current = 0
    navigate(customersRoute(route, nextSort, nextFilter), { replace: true })
  }

  const open = (row: CustomerRow) => {
    const saved = memory.get(key)
    if (saved !== undefined) saved.scrollY = window.scrollY
    navigate(customersRoute(route, sort, filter, row.id))
  }

  const Rows = wide ? CustomerTable : CustomerCards
  return (
    <section className="stack" aria-label="모든 손님">
      <div className="toolbar">
        <div className="field">
          <label htmlFor="customer-search">손님 찾기</label>
          <input
            id="customer-search"
            className="input"
            type="search"
            autoComplete="off"
            maxLength={40}
            placeholder="닉네임·끝자리 4개"
            value={query}
            onChange={(event) => {
              shownRef.current = 0
              setQuery(event.target.value)
            }}
          />
        </div>
        <div className="row" role="group" aria-label="정렬">
          {CUSTOMER_SORTS.map((value) => (
            <button key={value} type="button" className="button" aria-pressed={sort === value} onClick={() => choose(value, filter)}>
              {SORT_WORD[value]}
            </button>
          ))}
        </div>
        <div className="row" role="group" aria-label="거르기">
          {CUSTOMER_FILTERS.map((value) => (
            <button key={value} type="button" className="button" aria-pressed={filter === value} onClick={() => choose(sort, value)}>
              {FILTER_WORD[value]}
            </button>
          ))}
        </div>
      </div>
      {rows === null && error === null ? <p role="status">불러오는 중…</p> : null}
      {rows !== null ? (
        <>
          <p className="summary-line" role="status">
            손님 {count}명
          </p>
          {rows.length === 0 ? <p>{asked.trim() === '' ? '아직 입금·취소 기록이 있는 손님이 없어요.' : '찾는 손님이 없어요.'}</p> : null}
          <Rows rows={rows} today={today} route={route} sort={sort} filter={filter} onOpen={open} />
          {more ? (
            <button type="button" className="button" disabled={loadingMore} onClick={() => void loadMore()}>
              더 보기 ({count - rows.length}명 더)
            </button>
          ) : null}
        </>
      ) : null}
      {error !== null ? <RequestError error={error} onRetry={() => setAttempt((n) => n + 1)} retryLabel="다시 불러오기" /> : null}
    </section>
  )
}

interface RowsProps {
  readonly rows: readonly CustomerRow[]
  readonly today: string
  readonly route: ScopeRoute
  readonly sort: CustomerSort
  readonly filter: CustomerFilter
  readonly onOpen: (row: CustomerRow) => void
}

const lastWords = (row: CustomerRow, today: string): string => (row.lastPurchase === null ? '구매 없음' : customerDate(row.lastPurchase, today))

/** 휴대폰: 카드 */
function CustomerCards({ rows, today, route, sort, filter, onOpen }: RowsProps) {
  return (
    <ul className="plain-list stack-tight" aria-label="손님">
      {rows.map((row) => (
        <li key={row.id}>
          <a className="list-link customer-link" href={routePath(customersRoute(route, sort, filter, row.id))} onClick={(event) => linkClick(event, () => onOpen(row))}>
            <strong className="buyer-name">{row.name}</strong>
            <span className="tag">{row.kindLabel}</span>
            <CustomerTags summary={row} blocked={row.blocked} />
            <span>
              누적 {formatWon(row.purchaseTotal)} · {row.purchaseDays}번
            </span>
            <span>마지막 구매 {lastWords(row, today)}</span>
            <span>미입금 {row.unpaidDays}번</span>
          </a>
        </li>
      ))}
    </ul>
  )
}

/** PC: 표 (D-101) */
function CustomerTable({ rows, today, route, sort, filter, onOpen }: RowsProps) {
  return (
    <div className="table-scroll">
      <table className="list-table" aria-label="손님">
        <thead>
          <tr>
            <th scope="col">이름</th>
            <th scope="col">종류</th>
            <th scope="col">표시</th>
            <th scope="col" className="num">
              누적 구매
            </th>
            <th scope="col" className="num">
              구매 횟수
            </th>
            <th scope="col">마지막 구매</th>
            <th scope="col" className="num">
              미입금
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="cell-name">
                <a className="table-link" href={routePath(customersRoute(route, sort, filter, row.id))} onClick={(event) => linkClick(event, () => onOpen(row))}>
                  {row.name}
                </a>
              </td>
              <td>{row.kindLabel}</td>
              <td>
                <span className="cell-marks">
                  <CustomerTags summary={row} blocked={row.blocked} />
                </span>
              </td>
              <td className="num">{formatWon(row.purchaseTotal)}</td>
              <td className="num">{row.purchaseDays}번</td>
              <td>{lastWords(row, today)}</td>
              <td className="num">{row.unpaidDays}번</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── 손님 자세히 ───────────────────────────────────────────────────────

function CustomerDetail({ route, id, navigate }: { readonly route: ScopeRoute; readonly id: string; readonly navigate: Navigate }) {
  const sort = sortOf(route)
  const filter = filterOf(route)
  const [view, setView] = useState<CustomerDetailView | null>(null)
  const [days, setDays] = useState<readonly CustomerDayLine[]>([])
  const [error, setError] = useState<ApiError | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const today = memory.get(`${sort}|${filter}`)?.today ?? ''

  useEffect(() => {
    let alive = true
    setError(null)
    get<CustomerDetailView>(`/api/customers/${encodeURIComponent(id)}`).then(
      (result) => {
        if (!alive) return
        setView(result)
        setDays(result.days)
      },
      (caught: unknown) => {
        if (alive && isApiError(caught)) setError(caught)
      },
    )
    return () => {
      alive = false
    }
  }, [id, attempt])

  const loadMore = async () => {
    if (view?.next === null || view === null || loadingMore) return
    setLoadingMore(true)
    try {
      const result = await get<CustomerDetailView>(withQuery(`/api/customers/${encodeURIComponent(id)}`, { before: view.next }))
      setDays((current) => [...current, ...result.days])
      setView((current) => (current === null ? current : { ...current, more: result.more, next: result.next }))
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    } finally {
      setLoadingMore(false)
    }
  }

  const back = (
    <button type="button" className="button back-button" onClick={() => navigate(customersRoute(route, sort, filter))}>
      모든 손님 목록으로
    </button>
  )
  if (view === null) {
    return (
      <section className="stack" aria-label="손님 자세히">
        {back}
        {error === null ? <p role="status">불러오는 중…</p> : error.status === 404 ? <p>그 손님을 찾지 못했어요.</p> : <RequestError error={error} onRetry={() => setAttempt((n) => n + 1)} retryLabel="다시 불러오기" />}
      </section>
    )
  }
  const row = view.customer
  // 올해 기준: 이 응답의 서버 오늘(주소로 바로 열거나 새로고침해도 맞다 — TE-CRM1-003). 없으면 목록 응답의 today, 그것도 없으면 기기 KST 오늘
  const base = typeof view.today === 'string' && view.today !== '' ? view.today : today !== '' ? today : kstToday()
  const label = memberLabel(row)
  const openDay = (line: CustomerDayLine) => navigate({ name: 'buyers', date: line.date, rehearsal: false, buyer: line.buyer })
  const blockRoute: ScopeRoute = { name: 'buyers', date: row.latestDate, rehearsal: false, buyer: row.latestBuyer }
  return (
    <section className="stack" aria-label="손님 자세히">
      {back}
      <h2 className="section-title">{row.name}</h2>
      <p className="row">
        <span className="tag">{row.kindLabel}</span>
        <CustomerTags summary={undefined} blocked={row.blocked} />
      </p>
      <section className="stack-tight customer-record" aria-label="손님 기록">
        <h3 className="sub-title">손님 기록</h3>
        <SummaryFacts summary={row} today={base} />
        <MemoEditor key={`${row.id}|${view.memo?.savedAt ?? ''}`} customer={row.id} label={label} memo={view.memo} today={base} />
      </section>
      <p className="hint">
        <a className="table-link" href={routePath(blockRoute)} onClick={(event) => linkClick(event, () => navigate(blockRoute))}>
          가장 최근 날짜({dateWords(row.latestDate)})의 구매자 화면에서 차단할 수 있어요
        </a>
      </p>
      <section className="stack-tight" aria-label="날짜별 기록">
        <h3 className="sub-title">날짜별 기록</h3>
        <ul className="plain-list stack-tight">
          {days.map((line) => {
            return (
              <li key={`${line.date}|${line.buyer}`}>
                <a className="list-link" href={routePath({ name: 'buyers', date: line.date, rehearsal: false, buyer: line.buyer })} onClick={(event) => linkClick(event, () => openDay(line))}>
                  <strong>{customerDate(line.date, base)}</strong>
                  <span>그날 이름 {line.name}</span>
                  <span>상품 합계 {formatWon(line.subtotal)}</span>
                  {dayLineTags(line).map((tag) => (
                    <span key={tag.text} className={tag.className}>
                      {tag.text}
                    </span>
                  ))}
                </a>
              </li>
            )
          })}
        </ul>
        {view.more ? (
          <button type="button" className="button" disabled={loadingMore} onClick={() => void loadMore()}>
            더 보기
          </button>
        ) : null}
        {error !== null ? <RequestError error={error} onRetry={() => setAttempt((n) => n + 1)} retryLabel="다시 불러오기" /> : null}
      </section>
    </section>
  )
}
