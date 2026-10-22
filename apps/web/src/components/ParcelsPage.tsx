// 택배 접수 (SPEC §7 화면 16, STL-08, PARCEL_RULES PC-4~PC-8, D-T1-08·D-T1-11·D-T1-13, AC-T1-61~64).
// - 주소 `/parcels?date=2026-10-22` (실제 범위만). 날짜가 없으면 서버가 고른 날짜(고를 수 있는 묶음이 있는 가장 최근 날짜)를 기록 없이 주소에 적는다.
// - 세 무리: "보낼 수 있어요"(기본 모두 고름·줄마다 상자 크기) · "아직 못 보내요"(줄마다 이유 문장 — 실패·모름 포함) · "접수했어요"
//   (송장번호·"택배: 접수됨"·마지막 확인 시각·"운송장 PDF"·"접수 취소"). 영어 상태값은 화면에 없다.
// - 주 버튼 "N개 택배 접수하기"(0개·보내는 사람/택배사 없음이면 잠김) → 확인 창(처음 포커스 "닫기") → "접수하기".
//   보내는 동안 잠기고 두 번 눌러도 요청 하나(같은 화면 요청 번호 — 연결이 끊기면 같은 번호로 다시). 끝나면 줄마다 결과, 실패가 있으면 "실패한 것만 다시".
// - 다른 기기의 접수·취소·조회·입금·포장도 실시간 알림(parcel·packing·change)으로 다시 읽는다. 다시 붙으면 한 번 다시 읽는다.
// - 이름은 서버가 준 표시 이름(BUY-01)을 React 기본 이스케이프로만 그린다.
import { formatWon } from '@livejjim/core'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { get, isApiError, newRequestId, post, withQuery, withRetry, type ApiError } from '../api/client.ts'
import type { BookResponse, BookResult, BoxKind, BundleView, ParcelDay, ParcelDays, ParcelRow } from '../api/parcel-types.ts'
import { dateLong } from '../lib/kst.ts'
import { useLiveEvents } from '../lib/live-events.ts'
import { PACKING_TONE } from '../lib/packing.ts'
import {
  GROUP_BOOKED,
  GROUP_EXCLUDED,
  GROUP_READY,
  NO_PARCEL_DATES,
  NOTHING_BOOKED,
  NOTHING_EXCLUDED,
  NOTHING_READY,
  PARCEL_TITLE,
  RETRY_FAILED,
  WAYBILL_NOTE,
  addressReason,
  checkedWords,
  isRetryable,
  parcelGroups,
  retryRows,
  rowReason,
} from '../lib/parcel-words.ts'
import type { Navigate, ParcelsRoute } from '../lib/router.ts'
import { PAYMENT_WORD } from '../lib/words.ts'
import type { PackingWord } from '../api/types.ts'
import { useDownload } from './downloads.tsx'
import { RequestError } from './ErrorNote.tsx'
import { Modal } from './Modal.tsx'
import { ParcelTag } from './ParcelParts.tsx'
import { SpaLink } from './SettingsPage.tsx'

const BOXES: readonly BoxKind[] = ['극소', '소', '중', '대']
export const BOOKING_NOW = '택배사에 접수하는 중이에요…'
export const DATE_NOT_FOUND = '그 날짜는 택배를 접수할 수 없어요. 다른 날짜를 골라 주세요.'

/** 접수 결과 요약 */
export function bookSummary(results: readonly BookResult[]): string {
  const ok = results.filter((result) => result.ok).length
  const failed = results.length - ok
  if (failed === 0) return `${String(ok)}개 접수했어요.`
  if (ok === 0) return `${String(failed)}개는 접수하지 못했어요. 줄마다 이유를 확인해 주세요.`
  return `${String(ok)}개 접수했어요. ${String(failed)}개는 접수하지 못했어요 — 줄마다 이유를 확인해 주세요.`
}

// ── 날짜 ────────────────────────────────────────────────────────────────

function useParcelDates(route: ParcelsRoute, navigate: Navigate, version: number) {
  const [days, setDays] = useState<ParcelDays | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    get<ParcelDays>('/api/parcels/days').then(
      (result) => {
        if (!alive) return
        setDays(result)
        setError(null)
      },
      (caught: unknown) => {
        if (alive && isApiError(caught)) setError(caught)
      },
    )
    return () => {
      alive = false
    }
  }, [attempt, version])
  const selected = days?.selected ?? null
  useEffect(() => {
    if (route.date === undefined && selected !== null) navigate({ name: 'parcels', date: selected }, { replace: true })
  }, [route.date, selected, navigate])
  return { days, error, retry: () => setAttempt((n) => n + 1) }
}

function DatePicker({ route, navigate, days }: { readonly route: ParcelsRoute; readonly navigate: Navigate; readonly days: ParcelDays }) {
  const id = useId()
  const dates = days.dates.map((day) => day.date)
  const options = [...new Set([...dates, ...(route.date === undefined ? [] : [route.date])])].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
  if (options.length === 0) return null
  const count = new Map(days.dates.map((day) => [day.date, day]))
  return (
    <div className="field scope-picker">
      <label htmlFor={id}>날짜</label>
      <select id={id} className="input" value={route.date ?? ''} onChange={(event) => navigate({ name: 'parcels', date: event.target.value })}>
        {route.date === undefined ? <option value="">날짜를 골라 주세요</option> : null}
        {options.map((day) => {
          const info = count.get(day)
          return (
            <option key={day} value={day}>
              {dateLong(day)}
              {info === undefined ? '' : ` · 보낼 수 있어요 ${String(info.ready)} · 접수 ${String(info.booked)}`}
            </option>
          )
        })}
      </select>
    </div>
  )
}

// ── 화면 ────────────────────────────────────────────────────────────────

export function ParcelsPage({ route, navigate }: { readonly route: ParcelsRoute; readonly navigate: Navigate }) {
  /** 실시간 알림·다시 붙음으로 늘어나는 값 (그날 목록·날짜 목록을 다시 읽는다) */
  const [version, setVersion] = useState(0)
  const date = route.date ?? null
  const bump = useCallback(() => setVersion((n) => n + 1), [])
  useLiveEvents({
    onParcel: (event) => {
      if (event.settings === true || event.date === undefined || event.date === date) bump()
    },
    onPacking: (event) => {
      if (event.date === date) bump()
    },
    onChange: (event) => {
      if (!event.rehearsal && event.date === date) bump()
    },
    onReconnect: bump,
  })
  const dates = useParcelDates(route, navigate, version)
  return (
    <main className="page page-wide parcels-page stack">
      <h1>{PARCEL_TITLE}</h1>
      <div className="row scope-row">
        {dates.error !== null ? (
          <RequestError error={dates.error} onRetry={dates.retry} retryLabel="다시 불러오기" />
        ) : dates.days === null ? (
          <p role="status">날짜를 불러오는 중…</p>
        ) : (
          <DatePicker route={route} navigate={navigate} days={dates.days} />
        )}
      </div>
      {date === null ? dates.days !== null && dates.days.dates.length === 0 ? <p>{NO_PARCEL_DATES}</p> : null : <ParcelDayView key={date} date={date} navigate={navigate} version={version} onChanged={bump} />}
    </main>
  )
}

interface DayState {
  readonly day: ParcelDay | null
  readonly error: ApiError | null
  readonly reload: () => void
}

/** 그날 목록 (늦게 온 앞 응답은 버린다) */
function useParcelDay(date: string, version: number): DayState {
  const [day, setDay] = useState<ParcelDay | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const latest = useRef(0)
  useEffect(() => {
    const mine = ++latest.current
    get<ParcelDay>(`/api/parcels/days/${date}`).then(
      (result) => {
        if (mine !== latest.current) return
        setDay(result)
        setError(null)
      },
      (caught: unknown) => {
        if (mine !== latest.current || !isApiError(caught)) return
        setError(caught)
      },
    )
  }, [date, version, attempt])
  return { day, error, reload: () => setAttempt((n) => n + 1) }
}

function ParcelDayView({ date, navigate, version, onChanged }: { readonly date: string; readonly navigate: Navigate; readonly version: number; readonly onChanged: () => void }) {
  const state = useParcelDay(date, version)
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set())
  const [boxes, setBoxes] = useState<ReadonlyMap<string, BoxKind>>(new Map())
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [bookError, setBookError] = useState<ApiError | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  /** 이번 화면에서 받은 실패 결과 문장 (다시 읽은 목록에 그 줄의 이유가 없을 때 보인다) */
  const [results, setResults] = useState<ReadonlyMap<string, string>>(new Map())
  const running = useRef(false)
  const pending = useRef<{ key: string; requestId: string } | null>(null)
  const waybills = useDownload()

  const day = state.day
  const groups = useMemo(() => (day === null ? null : parcelGroups(day)), [day])
  const retry = useMemo(() => (day === null ? [] : retryRows(day)), [day])
  const chosen = groups === null ? [] : groups.ready.filter((row) => !unchecked.has(row.buyer))
  const boxOf = (row: ParcelRow): BoxKind => boxes.get(row.buyer) ?? row.box
  const blocked = day?.blocked ?? null

  const book = async (rows: readonly ParcelRow[]) => {
    if (running.current || rows.length === 0) return
    const items = rows.map((row) => ({ buyer: row.buyer, box: boxOf(row) }))
    const key = JSON.stringify(items)
    if (pending.current?.key !== key) pending.current = { key, requestId: newRequestId() }
    const { requestId } = pending.current
    running.current = true
    setBusy(true)
    setBookError(null)
    setSummary(null)
    try {
      const response = await withRetry(() => post<BookResponse>(`/api/parcels/days/${date}/book`, { requestId, items }))
      pending.current = null
      setSummary(bookSummary(response.results))
      setResults(new Map(response.results.flatMap((result) => (result.ok ? [] : [[result.buyer, result.message] as const]))))
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      if (!caught.transient) pending.current = null
      setBookError(caught)
    } finally {
      running.current = false
      setBusy(false)
      onChanged()
    }
  }

  if (day === null || groups === null) {
    if (state.error !== null) {
      return state.error.status === 404 ? (
        <p>{DATE_NOT_FOUND}</p>
      ) : (
        <RequestError error={state.error} onRetry={state.reload} retryLabel="다시 불러오기" />
      )
    }
    return <p role="status">불러오는 중…</p>
  }

  const toggle = (buyer: string) =>
    setUnchecked((set) => {
      const next = new Set(set)
      if (next.has(buyer)) next.delete(buyer)
      else next.add(buyer)
      return next
    })
  const primaryLabel = `${String(chosen.length)}개 택배 접수하기`
  const locked = blocked !== null || chosen.length === 0 || busy

  return (
    <>
      {state.error !== null ? <RequestError error={state.error} onRetry={state.reload} retryLabel="다시 불러오기" /> : null}
      {blocked !== null ? (
        <div className="notice stack-tight" role="note" data-tone="warning">
          <p>{blocked.message}</p>
          <p>
            <SpaLink navigate={navigate} to={{ name: 'settings', section: 'parcel' }} className="button">
              설정으로
            </SpaLink>
          </p>
        </div>
      ) : null}
      {day.carrier !== null ? <p className="hint">택배사: {day.carrier.name}</p> : null}

      <section className="card stack" aria-labelledby={`ready-${date}`}>
        <h2 id={`ready-${date}`} className="section-title">
          {GROUP_READY}
        </h2>
        <p className="hint">{String(groups.ready.length)}개</p>
        {groups.ready.length === 0 ? <p>{NOTHING_READY}</p> : null}
        {groups.ready.length > 0 ? (
          <ul className="plain-list stack-tight parcel-list">
            {groups.ready.map((row) => (
              <li key={row.buyer} className="parcel-row stack-tight">
                <label className="pack-item parcel-pick">
                  <input type="checkbox" checked={!unchecked.has(row.buyer)} disabled={busy} onChange={() => toggle(row.buyer)} />
                  <strong className="buyer-name">{row.name}</strong>
                </label>
                <RowFacts row={row} />
                <div className="field parcel-box">
                  <label htmlFor={`box-${date}-${row.buyer}`}>상자 크기</label>
                  <select
                    id={`box-${date}-${row.buyer}`}
                    className="input"
                    value={boxOf(row)}
                    disabled={busy}
                    onChange={(event) => {
                      const value = event.target.value as BoxKind
                      setBoxes((map) => new Map(map).set(row.buyer, value))
                    }}
                  >
                    {BOXES.map((box) => (
                      <option key={box} value={box}>
                        {box}
                      </option>
                    ))}
                  </select>
                </div>
                {row.parcel?.state === 'CANCELLED' ? <ParcelTag parcel={row.parcel} /> : null}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="row parcel-actions">
          <button type="button" className="button button-primary" disabled={locked} onClick={() => setAsking(true)}>
            {primaryLabel}
          </button>
          {busy ? <span role="status">{BOOKING_NOW}</span> : null}
        </div>
        {summary !== null ? (
          <p className="notice" role="status" data-tone={results.size === 0 ? 'success' : 'warning'}>
            {summary}
          </p>
        ) : null}
        {bookError !== null ? <RequestError error={bookError} onRetry={() => void book(chosen)} retryLabel="다시 보내기" /> : null}
      </section>

      <section className="card stack" aria-labelledby={`excluded-${date}`}>
        <h2 id={`excluded-${date}`} className="section-title">
          {GROUP_EXCLUDED}
        </h2>
        <p className="hint">{String(groups.excluded.length)}개</p>
        {groups.excluded.length === 0 ? <p>{NOTHING_EXCLUDED}</p> : null}
        {groups.excluded.length > 0 ? (
          <ul className="plain-list stack-tight parcel-list">
            {groups.excluded.map((row) => (
              <ExcludedRow key={row.buyer} date={date} row={row} navigate={navigate} result={results.get(row.buyer) ?? null} busy={busy} onRetry={() => void book([row])} blocked={blocked !== null} />
            ))}
          </ul>
        ) : null}
        {retry.length > 0 ? (
          <div className="row">
            <button type="button" className="button" disabled={busy || blocked !== null} onClick={() => void book(retry)}>
              {RETRY_FAILED}
            </button>
          </div>
        ) : null}
      </section>

      <section className="card stack" aria-labelledby={`booked-${date}`}>
        <h2 id={`booked-${date}`} className="section-title">
          {GROUP_BOOKED}
        </h2>
        <p className="hint">{String(groups.booked.length)}개</p>
        <p className="hint">{WAYBILL_NOTE}</p>
        {groups.booked.length === 0 ? <p>{NOTHING_BOOKED}</p> : null}
        {groups.booked.length > 0 ? (
          <>
            <div className="row">
              <button type="button" className="button" disabled={waybills.busy} onClick={() => void waybills.run(`/api/parcels/days/${date}/waybills.pdf`, `운송장-${date}-전부.pdf`)}>
                운송장 전부 PDF
              </button>
              {waybills.busy ? <span role="status">운송장을 만드는 중이에요…</span> : null}
            </div>
            {waybills.error !== null ? <RequestError error={waybills.error} /> : null}
            <ul className="plain-list stack-tight parcel-list">
              {groups.booked.map((row) => (
                <BookedRow key={row.buyer} date={date} row={row} onChanged={onChanged} />
              ))}
            </ul>
          </>
        ) : null}
      </section>

      {asking ? (
        <Modal
          title={PARCEL_TITLE}
          onClose={() => setAsking(false)}
          actions={
            <button
              type="button"
              className="button button-primary"
              disabled={busy}
              onClick={() => {
                setAsking(false)
                void book(chosen)
              }}
            >
              접수하기
            </button>
          }
        >
          <p>{`${String(chosen.length)}개를 택배로 접수할까요?`}</p>
          <p className="hint">접수하면 포장 상태가 "배송 완료"로 바뀌고 송장번호가 붙어요.</p>
        </Modal>
      ) : null}
    </>
  )
}

/** 줄의 사실: 상품 수·최종 금액·입금 상태 말·포장 상태 말 */
function RowFacts({ row }: { readonly row: ParcelRow }) {
  return (
    <p className="row parcel-facts">
      <span>상품 {row.itemCount}개</span>
      <span>{formatWon(row.total)}</span>
      <span className={`tag pay-${row.payment}`}>{PAYMENT_WORD[row.payment]}</span>
      <span className="tag" data-tone={PACKING_TONE[row.packing as PackingWord] ?? 'info'}>
        {row.packing}
      </span>
    </p>
  )
}

function ExcludedRow({
  date,
  row,
  navigate,
  result,
  busy,
  blocked,
  onRetry,
}: {
  readonly date: string
  readonly row: ParcelRow
  readonly navigate: Navigate
  readonly result: string | null
  readonly busy: boolean
  readonly blocked: boolean
  readonly onRetry: () => void
}) {
  const reason = rowReason(row)
  const text = reason === '' ? (result ?? '') : reason
  const failed = row.parcel?.state === 'FAILED'
  const unknown = row.parcel?.state === 'UNKNOWN'
  return (
    <li className="parcel-row stack-tight">
      <strong className="buyer-name">{row.name}</strong>
      <RowFacts row={row} />
      {text !== '' ? (
        <p className="parcel-reason" data-tone={failed ? 'danger' : unknown ? 'warning' : undefined}>
          {text}
        </p>
      ) : null}
      <div className="row">
        {unknown && isRetryable(row.parcel) ? (
          <button type="button" className="button" disabled={busy || blocked} onClick={onRetry}>
            다시 확인
          </button>
        ) : null}
        {addressReason(row) ? (
          <SpaLink navigate={navigate} to={{ name: 'settlements', date, rehearsal: false, buyer: row.buyer }} className="button">
            배송지 보기
          </SpaLink>
        ) : null}
      </div>
    </li>
  )
}

function BookedRow({ date, row, onChanged }: { readonly date: string; readonly row: ParcelRow; readonly onChanged: () => void }) {
  const parcel = row.parcel
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [done, setDone] = useState(false)
  const pending = useRef<string | null>(null)
  const running = useRef(false)
  const waybill = useDownload()
  const checked = parcel === null ? null : checkedWords(parcel)

  const cancel = async () => {
    if (running.current) return
    pending.current ??= newRequestId()
    const requestId = pending.current
    running.current = true
    setBusy(true)
    setError(null)
    try {
      await withRetry(() => post<{ bundle: BundleView }>(`/api/parcels/days/${date}/cancel`, { requestId, buyer: row.buyer }))
      pending.current = null
      setDone(true)
      onChanged()
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      // 모름(503)은 같은 송장 취소라 다시 보내도 된다 — 새 요청 번호로 다시 묻는다(서버가 같은 송장에 보낸다)
      pending.current = null
      setError(caught)
      if (caught.status === 409) onChanged()
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  return (
    <li className="parcel-row stack-tight">
      <strong className="buyer-name">{row.name}</strong>
      <RowFacts row={row} />
      {parcel !== null ? (
        <p className="row">
          {parcel.invoiceText !== null ? <span className="parcel-invoice">송장 {parcel.invoiceText}</span> : null}
          <ParcelTag parcel={parcel} />
          {checked !== null ? <span className="hint">{checked}</span> : null}
        </p>
      ) : null}
      <div className="row" role="group" aria-label={`${row.name} 택배`}>
        <button type="button" className="button" disabled={waybill.busy} onClick={() => void waybill.run(withQuery(`/api/parcels/days/${date}/waybill.pdf`, { buyer: row.buyer }), `운송장-${date}.pdf`)}>
          운송장 PDF
        </button>
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => {
            setError(null)
            setAsking(true)
          }}
        >
          접수 취소
        </button>
        {busy ? <span role="status">취소하는 중…</span> : null}
        {waybill.busy ? <span role="status">운송장을 만드는 중이에요…</span> : null}
      </div>
      {done ? (
        <p className="notice" role="status" data-tone="success">
          접수를 취소했어요.
        </p>
      ) : null}
      {error !== null ? <RequestError error={error} /> : null}
      {waybill.error !== null ? <RequestError error={waybill.error} /> : null}
      {asking ? (
        <Modal
          title="접수 취소"
          onClose={() => setAsking(false)}
          actions={
            <button
              type="button"
              className="button button-danger"
              disabled={busy}
              onClick={() => {
                setAsking(false)
                void cancel()
              }}
            >
              취소하기
            </button>
          }
        >
          <p>{`${row.name}님의 택배 접수를 취소할까요? 택배사가 아직 가져가지 않았을 때만 취소돼요.`}</p>
        </Modal>
      ) : null}
    </li>
  )
}
