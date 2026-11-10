// 서버 날짜 목록(/api/days)은 오래된 날부터 온다(store scopeSeqs — 날짜 오름차순). 앱 화면은 가장 최근 날을 먼저 보이고 기본으로 고른다 (D-UX4-124).
// 옛 앱은 첫 줄을 "가장 최근"으로 여겨 주문·포장·영수증이 가장 오래된 날로 열리고, 홈 "오늘 할 일"도 가장 오래된 날 숫자였다.

/** 실제(리허설 아닌) 날짜만, 가장 최근 날부터 */
export function latestFirst<T extends { readonly date: string; readonly rehearsal: boolean }>(days: readonly T[]): T[] {
  return days.filter((day) => !day.rehearsal).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}
