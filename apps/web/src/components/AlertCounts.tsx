// 설정 "방송 알림" (KP1 SCH-03, AC-KP1-23, D-KP1-16): 공개 일정 페이지에서 손님이 직접 신청한 수만 보인다.
// 번호 확인 전(PENDING, UX-KP1-012)·받는 중(ACTIVE)·그만 받음(WITHDRAWN) — 번호 목록·내려받기·대신 넣기는 없다(영어 상태값도 화면에 내지 않는다).
import { useEffect, useState } from 'react'
import { isApiError, type ApiError } from '../api/client.ts'
import { amountWords } from '../lib/report.ts'
import { ALERTS_HINT, ALERTS_NOT_SENDING, ALERT_WORDS, fetchAlertCounts, type AlertCounts } from '../lib/schedule.ts'
import { RequestError } from './ErrorNote.tsx'
import './kp1-report.css'

export function AlertCountsSection() {
  const [counts, setCounts] = useState<AlertCounts | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    fetchAlertCounts().then(
      (result) => {
        if (!alive) return
        setCounts(result)
        setError(null)
      },
      (caught: unknown) => {
        if (alive && isApiError(caught)) setError(caught)
      },
    )
    return () => {
      alive = false
    }
  }, [attempt])

  if (counts === null) {
    return error !== null ? <RequestError error={error} onRetry={() => setAttempt((n) => n + 1)} retryLabel="다시 불러오기" /> : <p role="status">방송 알림 수를 불러오는 중…</p>
  }
  const rows = [
    { key: 'pending', label: ALERT_WORDS.pending, value: counts.pending },
    { key: 'active', label: ALERT_WORDS.active, value: counts.active },
    { key: 'withdrawn', label: ALERT_WORDS.withdrawn, value: counts.withdrawn },
  ] as const
  return (
    <div className="stack-tight kp1-page kp1-seller">
      <p className="kp1-note" role="note">
        {ALERTS_NOT_SENDING}
      </p>
      <p className="hint">{ALERTS_HINT}</p>
      <dl className="kp1-numbers">
        {rows.map((row) => (
          <div key={row.key} className="kp1-number">
            <dt>{row.label}</dt>
            <dd>{amountWords(row.value, '명')}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
