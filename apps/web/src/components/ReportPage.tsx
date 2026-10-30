// 방송 리포트 화면 `/report?date=YYYY-MM-DD` (KP1 RPT-01~RPT-08, AC-KP1-19, D-KP1-14).
// 순서: 돈 → 손님 → 지난 방송과 비교 → 몰린 상품 5개 → 품종 10개(더 보기) → 시간대 막대. 숫자만 — 손님 이름·연락처 없음.
// 볼 곳: 정산 화면 날짜 줄의 "방송 리포트"(ReportLink), 방송을 끝낸 콘솔의 "오늘 리포트 보기"(TodayReportLink).
// 상품 이름은 판매자가 적은 글이라 React 기본 이스케이프로만 보인다. 375px에서 가로로 넘치지 않는다(kp1-report.css).
import { useEffect, useId, useState, type ReactNode } from 'react'
import { isApiError, type ApiError } from '../api/client.ts'
import { dateLong } from '../lib/kst.ts'
import {
  LIVE_NOTE,
  NO_COMPARE,
  NO_DATE_NOTE,
  RECEIVED_HELP,
  REPORT_TITLE,
  SEALED_NOTE,
  TODAY_REPORT,
  VARIETY_FIRST,
  amountWords,
  barPercent,
  bucketLine,
  compareWords,
  fetchReport,
  recentName,
  rushWords,
  type CompareDiff,
  type ReportView,
} from '../lib/report.ts'
import type { Navigate } from '../lib/router.ts'
import { AppLink } from './AppLink.tsx'
import { RequestError } from './ErrorNote.tsx'
import './kp1-report.css'

export interface ReportPageProps {
  readonly date?: string
  readonly navigate: Navigate
}

export function ReportPage({ date }: ReportPageProps) {
  const [view, setView] = useState<ReportView | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (date === undefined) return
    let alive = true
    setLoading(true)
    fetchReport(date).then(
      (result) => {
        if (!alive) return
        setView(result)
        setError(null)
        setLoading(false)
      },
      (caught: unknown) => {
        if (!alive) return
        setLoading(false)
        if (isApiError(caught)) setError(caught)
      },
    )
    return () => {
      alive = false
    }
  }, [date, attempt])

  const shown = view !== null && view.date === date ? view : null
  return (
    <main className="page stack kp1-page report-page">
      <h1>
        {REPORT_TITLE}
        {date !== undefined ? <span className="report-date"> · {dateLong(date)}</span> : null}
      </h1>
      <div className="row">
        <AppLink to={date === undefined ? { name: 'settlements', rehearsal: false } : { name: 'settlements', date, rehearsal: false }} className="button kp1-button">
          정산으로
        </AppLink>
        {date !== undefined ? (
          <button type="button" className="button kp1-button" disabled={loading} onClick={() => setAttempt((n) => n + 1)}>
            {loading ? '불러오는 중…' : '새로 보기'}
          </button>
        ) : null}
      </div>
      {date === undefined ? (
        <p className="kp1-note" role="note">
          {NO_DATE_NOTE}
        </p>
      ) : null}
      {error !== null ? <RequestError error={error} onRetry={() => setAttempt((n) => n + 1)} retryLabel="다시 불러오기" /> : null}
      {date !== undefined && shown === null && error === null ? <p role="status">리포트를 불러오는 중…</p> : null}
      {shown !== null ? <ReportBody view={shown} /> : null}
    </main>
  )
}

/** 리포트 본문 (불러온 뒤) */
export function ReportBody({ view }: { readonly view: ReportView }) {
  const { summary } = view
  return (
    <>
      {view.live ? (
        <p className="kp1-note" role="status">
          {LIVE_NOTE}
        </p>
      ) : null}
      <Section title="돈">
        <dl className="kp1-numbers">
          <NumberRow label="판매 금액" value={amountWords(summary.sales, '원')} hint="상품값만 더했어요. 배송비·할인·추가 금액은 빼요." />
          <NumberRow label="판매 수량" value={amountWords(summary.qty, '개')} />
          <NumberRow label="받은 돈" value={amountWords(summary.received, '원')} hint={RECEIVED_HELP} />
          <NumberRow label="아직 못 받은 돈" value={amountWords(summary.unpaid, '원')} hint="손님마다 낼 돈에서 받은 돈을 뺀 합이에요." />
          <NumberRow label="돌려줄 돈" value={amountWords(summary.refund, '원')} hint="더 받은 돈의 합이에요." />
        </dl>
      </Section>
      <Section title="손님">
        <dl className="kp1-numbers">
          <NumberRow label="산 손님" value={amountWords(summary.buyers, '명')} />
          <NumberRow label="아직 다 내지 않은 손님" value={amountWords(summary.unpaidBuyers, '명')} />
          <NumberRow label="새 손님" value={amountWords(summary.newBuyers, '명')} hint="앞선 방송에서 산 적이 없는 손님이에요." />
          <NumberRow label="다시 온 손님" value={amountWords(summary.returningBuyers, '명')} hint="앞선 방송에서도 산 손님이에요." />
          <NumberRow label="알 수 없는 손님" value={amountWords(summary.unknownBuyers, '명')} hint="전화번호 없이 받은 문자찜이라 새 손님인지 알 수 없어요." />
        </dl>
      </Section>
      <Section title="지난 방송과 비교">
        <CompareBlock view={view} />
      </Section>
      <Section title="몰린 상품">
        {view.sealed || view.rush === null ? (
          <p>{SEALED_NOTE}</p>
        ) : view.rush.length === 0 ? (
          <p>몰린 상품이 없어요.</p>
        ) : (
          <>
            <p className="hint">상품을 열고 30초 안에 찜한 손님이 많은 순이에요. 다음 방송 재고를 정할 때 참고하세요.</p>
            <ol className="kp1-list" aria-label="몰린 상품 목록">
              {view.rush.slice(0, 5).map((row) => {
                const words = rushWords(row)
                return (
                  <li key={`${row.b}/${String(row.no)}`}>
                    <span className="kp1-row-title">{words.title}</span>
                    <br />
                    {words.detail}
                  </li>
                )
              })}
            </ol>
          </>
        )}
      </Section>
      <Section title="품종별 판매">
        <Varieties view={view} />
      </Section>
      <Section title="시간대별 판매">
        {view.sealed || view.buckets === null ? (
          <p>{SEALED_NOTE}</p>
        ) : view.buckets.length === 0 ? (
          <p>찜이 없어요.</p>
        ) : (
          <Buckets view={view} />
        )}
      </Section>
    </>
  )
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  const id = useId()
  return (
    <section className="card stack-tight" aria-labelledby={id}>
      <h2 id={id} className="section-title">
        {title}
      </h2>
      {children}
    </section>
  )
}

function NumberRow({ label, value, hint }: { readonly label: string; readonly value: string; readonly hint?: string }) {
  return (
    <div className="kp1-number">
      <dt>{label}</dt>
      <dd>
        {value}
        {hint !== undefined ? <span className="hint"> — {hint}</span> : null}
      </dd>
    </div>
  )
}

function diffLines(diff: CompareDiff, against: string): string[] {
  return [compareWords(diff.sales, '원', against), compareWords(diff.qty, '개', against), compareWords(diff.buyers, '명', against)]
}

function CompareBlock({ view }: { readonly view: ReportView }) {
  const { last, recent } = view.compare
  if (last === null && recent === null) return <p>{NO_COMPARE}</p>
  return (
    <div className="stack-tight">
      {last !== null ? (
        <div>
          <p className="kp1-row-title">지난 방송 ({dateLong(last.date)})</p>
          <ul className="kp1-list" aria-label="지난 방송과 차이">
            {diffLines(last.diff, '지난 방송').map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {recent !== null ? (
        <div>
          <p className="kp1-row-title">{recentName(recent.count)}</p>
          <ul className="kp1-list" aria-label="평균과 차이">
            {diffLines(recent.diff, recentName(recent.count)).map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="hint">받은 돈은 날이 지나면 늘어서 비교하지 않아요.</p>
    </div>
  )
}

function Varieties({ view }: { readonly view: ReportView }) {
  const [all, setAll] = useState(false)
  if (view.varieties.length === 0) return <p>판매한 품종이 없어요.</p>
  const rows = all ? view.varieties : view.varieties.slice(0, VARIETY_FIRST)
  const more = view.varieties.length - VARIETY_FIRST
  return (
    <>
      <ol className="kp1-list" aria-label="품종 목록">
        {rows.map((row, index) => (
          <li key={`${String(index)}-${row.name}`}>
            <span className="kp1-row-title">{row.name}</span> · {amountWords(row.qty, '개')} · {amountWords(row.amount, '원')}
          </li>
        ))}
      </ol>
      {more > 0 ? (
        <button type="button" className="button kp1-button" aria-expanded={all} onClick={() => setAll((value) => !value)}>
          {all ? '접기' : `더 보기 (${String(more)}개 더)`}
        </button>
      ) : null}
    </>
  )
}

function Buckets({ view }: { readonly view: ReportView }) {
  const rows = view.buckets ?? []
  const max = rows.reduce((top, row) => Math.max(top, row.amount), 0)
  return (
    <>
      <p className="hint">10분마다 판매 금액이에요. 막대가 길수록 많이 팔렸어요.</p>
      <ul className="kp1-list" aria-label="시간대별 판매 목록">
        {rows.map((row) => (
          <li key={row.start}>
            <span>{bucketLine(row, view.date)}</span>
            <div className="kp1-bar-track" aria-hidden="true">
              <div className="kp1-bar" style={{ width: `${String(barPercent(row.amount, max))}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

/** 정산 화면 날짜 줄의 "방송 리포트" (실제 범위만) */
export function ReportLink({ date }: { readonly date: string }) {
  return (
    <AppLink to={{ name: 'report', date }} className="button">
      {REPORT_TITLE}
    </AppLink>
  )
}

/** 방송을 끝낸 콘솔의 "오늘 리포트 보기" (실제 방송만) */
export function TodayReportLink({ date }: { readonly date: string }) {
  return (
    <AppLink to={{ name: 'report', date }} className="button">
      {TODAY_REPORT}
    </AppLink>
  )
}
