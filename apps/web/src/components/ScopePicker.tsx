// 날짜 고르기 (AC-S06-20·30, D-069·D-081·D-090): 실제 범위 날짜(GET /api/days)와 리허설 범위 날짜(?rehearsal=true, "리허설" 글자).
// 기본은 오늘(KST)의 실제 범위, 없으면 가장 최근 실제 범위. 둘 다 없으면 고른 날짜가 없다("아직 판매 기록이 없어요.").
// 고른 날짜·리허설은 주소 검색값이다(새로고침·북마크해도 같은 화면) — 기본 날짜도 주소에 적는다(기록을 남기지 않고).
import { useEffect, useId, useState } from 'react'
import { get, isApiError, type ApiError } from '../api/client.ts'
import { dateWords, kstToday } from '../lib/kst.ts'
import type { Navigate, ScopeRoute } from '../lib/router.ts'
import { ErrorNote } from './ErrorNote.tsx'

export interface DayOption {
  readonly date: string
  readonly rehearsal: boolean
  /** 봉인 예정 시각 (유튜브 채팅이 있는 실제 날짜만, AC-I3-40) */
  readonly sealAt?: string | null
  readonly sealed?: boolean
}

interface DaysState {
  readonly days: readonly DayOption[] | null
  readonly error: ApiError | null
}

/** 범위 목록을 받아 기본 날짜를 정한다 */
export function useScopeChoice(route: ScopeRoute, navigate: Navigate): { readonly days: readonly DayOption[] | null; readonly error: ApiError | null; readonly retry: () => void; readonly scope: DayOption | null } {
  const [state, setState] = useState<DaysState>({ days: null, error: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    Promise.all([get<{ days: DayOption[] }>('/api/days'), get<{ days: DayOption[] }>('/api/days?rehearsal=true')]).then(
      ([real, rehearsal]) => {
        if (!alive) return
        const days = [
          ...real.days.map((day) => ({ date: day.date, rehearsal: false, sealAt: day.sealAt ?? null, sealed: day.sealed === true })),
          ...rehearsal.days.map((day) => ({ date: day.date, rehearsal: true })),
        ]
        setState({ days, error: null })
      },
      (error: unknown) => {
        if (alive && isApiError(error)) setState({ days: null, error })
      },
    )
    return () => {
      alive = false
    }
  }, [attempt])

  const days = state.days
  const defaultDay = (() => {
    if (days === null) return null
    const real = days.filter((day) => !day.rehearsal).map((day) => day.date)
    const today = kstToday()
    if (real.includes(today)) return today
    return real.length === 0 ? null : real.reduce((latest, date) => (date > latest ? date : latest))
  })()

  // 주소에 날짜가 없으면 기본 날짜를 적는다 (새로고침해도 같은 날짜)
  useEffect(() => {
    if (route.date === undefined && defaultDay !== null) navigate({ ...route, date: defaultDay, rehearsal: false }, { replace: true })
  }, [route, defaultDay, navigate])

  const scope: DayOption | null = route.date !== undefined ? { date: route.date, rehearsal: route.rehearsal } : null
  return { days, error: state.error, retry: () => setAttempt((n) => n + 1), scope }
}

/** 고른 날짜의 봉인 정보 (실제 날짜만) */
export function sealOf(days: readonly DayOption[] | null, scope: DayOption | null): { readonly sealAt: string | null; readonly sealed: boolean } {
  if (days === null || scope === null || scope.rehearsal) return { sealAt: null, sealed: false }
  const day = days.find((item) => item.date === scope.date && !item.rehearsal)
  return { sealAt: day?.sealAt ?? null, sealed: day?.sealed === true }
}

const keyOf = (day: DayOption) => `${day.date}|${day.rehearsal ? 'r' : ''}`

export function dayWords(day: DayOption): string {
  return `${dateWords(day.date)}${day.rehearsal ? ' 리허설' : ''}`
}

export interface ScopePickerProps {
  readonly route: ScopeRoute
  readonly navigate: Navigate
  readonly days: readonly DayOption[] | null
  readonly error: ApiError | null
  readonly onRetry: () => void
}

export function ScopePicker({ route, navigate, days, error, onRetry }: ScopePickerProps) {
  const id = useId()
  if (error !== null) return <ErrorNote error={error} onRetry={onRetry} retryLabel="다시 불러오기" />
  if (days === null) return <p role="status">날짜를 불러오는 중…</p>
  const options = [...days]
  if (route.date !== undefined && !options.some((day) => day.date === route.date && day.rehearsal === route.rehearsal)) options.push({ date: route.date, rehearsal: route.rehearsal })
  options.sort((a, b) => (a.date === b.date ? Number(a.rehearsal) - Number(b.rehearsal) : a.date < b.date ? 1 : -1))
  if (options.length === 0) return null
  const value = route.date === undefined ? '' : keyOf({ date: route.date, rehearsal: route.rehearsal })
  return (
    <div className="field scope-picker">
      <label htmlFor={id}>날짜</label>
      <select
        id={id}
        className="input"
        value={value}
        onChange={(event) => {
          const day = options.find((option) => keyOf(option) === event.target.value)
          if (day !== undefined) navigate({ name: route.name, date: day.date, rehearsal: day.rehearsal })
        }}
      >
        {value === '' ? <option value="">날짜를 골라 주세요</option> : null}
        {options.map((day) => (
          <option key={keyOf(day)} value={keyOf(day)}>
            {dayWords(day)}
          </option>
        ))}
      </select>
    </div>
  )
}
