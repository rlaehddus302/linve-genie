// 실제 방송 날짜 고르기 (정산·입금·리포트·손님 화면이 같이 쓴다 — 포장 화면의 날짜 알약과 같은 모양).
// 날짜는 서버 `GET /api/days`의 실제 범위만(리허설 날짜는 넣지 않는다), 최근 8개까지.
import { useEffect, useMemo, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { dateWords } from '@livejjim/web/src/lib/kst.ts'
import type { ApiError } from '../api/client.ts'
import { useCachedGet } from '../lib/cached-get.ts'
import { Tap, Txt, useKit } from './kit/index.ts'
import { RADIUS, SPACE, pressedFill } from './kit/tokens.ts'

interface Day {
  readonly date: string
  readonly rehearsal: boolean
}

/** 실제 방송 날짜 목록(최근 먼저). 처음 고른 날짜는 initial이 있으면 그것, 없으면 가장 최근 */
export function useRealDays(initial?: string): { days: readonly string[] | null; date: string | null; setDate: (date: string) => void; error: ApiError | null } {
  // 날짜 목록은 기억해 둔 것을 바로 보이고 뒤에서 다시 받는다 (D-UX4-77) — 다시 받다 실패하면 보이던 목록 그대로
  const { data, error, checked } = useCachedGet<{ days: Day[] }>('/api/days')
  const days = useMemo(() => (data === null ? null : data.days.filter((day) => !day.rehearsal).map((day) => day.date)), [data])
  // 고른 날짜가 없으면 가장 최근 — 서버에서 새로 받은 목록으로 한 번 정한 뒤에는 새 목록이 와도 바꾸지 않는다(보던 날짜가 저절로 넘어가지 않게).
  // 기억해 둔 목록만 있는 동안은 따라간다(그 사이 새 방송 날이 생겼으면 가장 최근 날로)
  const [picked, setDate] = useState<string | null>(initial ?? null)
  const date = picked ?? days?.[0] ?? null
  useEffect(() => {
    if (picked === null && date !== null && checked) setDate(date)
  }, [picked, date, checked])
  return { days, date, setDate, error }
}

/**
 * 알약 하나. 고르든 안 고르든 크기가 같아야 옆 알약이 밀리지 않는다 (D-UX4-65, 사용자 지시 2026-11-10 "누를 때마다 위치가 살짝 바뀌는데"):
 * 옛 모양은 고른 알약만 테두리(1)를 빼고 글자를 book→medium으로 굵혀 폭이 2~3 달라졌다. 이제 테두리는 늘 1(고르면 주색과 같은 색),
 * 글자 굵기는 늘 medium — 고름은 바탕·글자 색으로만 다르다.
 */
export function Pill({ on, label, ariaLabel, onPress }: { readonly on: boolean; readonly label: string; readonly ariaLabel: string; readonly onPress: () => void }) {
  const { p } = useKit()
  return (
    // 토스 알약처럼 (D-UX3-89): 높이 36, 글자는 본문보다 큰 bodyLarge·중간 굵기, 좌우 14 — 옛 높이 44·작은 글자
    <Tap role="button" aria-label={ariaLabel} aria-selected={on} onPress={onPress} style={({ pressed }) => ({ minHeight: 36, paddingHorizontal: SPACE.md + 1, borderRadius: RADIUS.pill, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: on ? p.primary : p.outline, backgroundColor: pressed ? pressedFill(p, on ? p.primary : p.surface) : on ? p.primary : p.surface })}>
      <Txt step="bodyLarge" weight="medium" color={on ? 'onPrimary' : 'text'}>
        {label}
      </Txt>
    </Tap>
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
