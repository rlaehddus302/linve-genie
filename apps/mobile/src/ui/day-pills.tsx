// 실제 방송 날짜 고르기 (정산·입금·리포트·손님 화면이 같이 쓴다 — 포장 화면의 날짜 알약과 같은 모양).
// 날짜는 서버 `GET /api/days`의 실제 범위만(리허설 날짜는 넣지 않는다), 최근 8개까지.
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { dateWords } from '@livejjim/web/src/lib/kst.ts'
import { get, isApiError, type ApiError } from '../api/client.ts'
import { Txt, useKit } from './kit/index.ts'
import { RADIUS, SPACE, pressedFill } from './kit/tokens.ts'

interface Day {
  readonly date: string
  readonly rehearsal: boolean
}

/** 실제 방송 날짜 목록(최근 먼저). 처음 고른 날짜는 initial이 있으면 그것, 없으면 가장 최근 */
export function useRealDays(initial?: string): { days: readonly string[] | null; date: string | null; setDate: (date: string) => void; error: ApiError | null } {
  const [days, setDays] = useState<readonly string[] | null>(null)
  const [date, setDate] = useState<string | null>(initial ?? null)
  const [error, setError] = useState<ApiError | null>(null)
  useEffect(() => {
    let alive = true
    get<{ days: Day[] }>('/api/days').then(
      (view) => {
        if (!alive) return
        const real = view.days.filter((day) => !day.rehearsal).map((day) => day.date)
        setDays(real)
        setDate((current) => current ?? real[0] ?? null)
      },
      (caught: unknown) => {
        if (alive && isApiError(caught)) setError(caught)
      },
    )
    return () => {
      alive = false
    }
  }, [])
  return { days, date, setDate, error }
}

export function Pill({ on, label, ariaLabel, onPress }: { readonly on: boolean; readonly label: string; readonly ariaLabel: string; readonly onPress: () => void }) {
  const { p } = useKit()
  return (
    <Pressable role="button" aria-label={ariaLabel} aria-selected={on} onPress={onPress} style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: SPACE.lg, borderRadius: RADIUS.pill, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', borderWidth: on ? 0 : 1, borderColor: p.outline, backgroundColor: pressed ? pressedFill(p, on ? p.primary : p.surface) : on ? p.primary : p.surface })}>
      <Txt step="caption" weight="bold" color={on ? 'onPrimary' : 'text'}>
        {label}
      </Txt>
    </Pressable>
  )
}

export function DayPills({ days, date, onPick }: { readonly days: readonly string[]; readonly date: string | null; readonly onPick: (date: string) => void }) {
  return (
    <View role="radiogroup" aria-label="날짜">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACE.sm, paddingHorizontal: SPACE.xs, paddingVertical: SPACE.xs }}>
        {days.slice(0, 8).map((day) => (
          <Pill key={day} on={day === date} label={dateWords(day)} ariaLabel={`날짜 ${dateWords(day)}`} onPress={() => onPick(day)} />
        ))}
      </ScrollView>
      {days.length === 0 ? <Txt color="textSub">아직 판매 기록이 없어요.</Txt> : null}
    </View>
  )
}
