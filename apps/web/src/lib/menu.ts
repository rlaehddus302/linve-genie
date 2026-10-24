// 메뉴 정의 (UX-04, D-NAV-01, AC-NAV-01~10 — 이 파일 한 곳에만 둔다).
// - 순서: 막대 네 칸(방송·문자찜 입력·구매자·정산) → 더보기 목록 항목 → "설정"(늘 마지막).
// - PC(48rem 이상)는 이 순서 그대로 모두 위 줄에. 휴대폰은 아래 막대 다섯 칸(앞 네 칸 + "더보기"), 나머지는 "더보기" 목록에 같은 순서로.
// - 새 메뉴 기본 규칙(D-NAV-01 (9)): 새 메뉴는 `moreItems` 안에 더한다 — 그러면 PC는 "설정" 바로 앞, 휴대폰은 목록의 "설정" 바로 앞에 저절로 들어간다.
//   막대의 앞 네 칸(`barItems`)은 바꾸지 않는다 — 바꾸려면 새 결정이 필요하다. "설정"은 `settingsItem` 하나로 늘 맨 뒤다.
// - 요금(N5)은 이 규칙대로 목록 끝("설정" 바로 앞)에 — 요금 기능이 켜져 있을 때만(AC-NAV-09).
// - 택배(T1, D-T1-08, AC-T1-60)도 이 규칙대로 목록 끝("설정" 바로 앞) — 판매자에게 늘. 실제 날짜를 보고 있었으면 그 날짜로.
// - 보조자는 "문자찜 입력" 한 칸, 더보기 없음.
// - 휴대폰 아래 막대의 칸 이름은 `barLabel`(MOB1 D-MOB1-04): 두 번째 칸만 "문자찜"(한 줄로 읽히게). PC 위 줄 메뉴·화면 제목은 "문자찜 입력" 그대로.
import type { MenuKey, Route } from './router.ts'

export interface MenuItem {
  readonly key: MenuKey
  readonly label: string
  readonly to: Route
  /** 글자 뒤에 붙는 수 (입금 확인의 확인 필요 수) */
  readonly count?: number
}

export interface MenuInput {
  readonly route: Route
  readonly assistant: boolean
  /** 라벨 기능이 켜져 있다고 아는가 (꺼짐·모름이면 "라벨"을 만들지 않는다 — L-13 9) */
  readonly labels: boolean
  /** 확인 필요 입금 수 (모르면 null) */
  readonly review: number | null
  /** 요금 기능이 켜져 있다 (N5, AC-N5-50 — 켜져 있을 때만 "요금". 보조자에게는 없다) */
  readonly billing?: boolean
}

export interface MenuLayout {
  /** 막대 칸 (휴대폰: 앞 네 칸, 보조자: 한 칸) */
  readonly bar: readonly MenuItem[]
  /** 더보기 목록 (보조자는 빈 목록 — 더보기 칸이 없다) */
  readonly more: readonly MenuItem[]
}

/** 구매자·정산 사이를 오가면 고른 날짜·리허설을 이어 간다. 포장은 실제 범위만이라 실제 날짜를 보고 있었을 때만 그 날짜로 */
function scopes(route: Route) {
  const scoped = route.name === 'buyers' || route.name === 'settlements' ? route : null
  const scope = scoped === null ? { rehearsal: false } : { ...(scoped.date === undefined ? {} : { date: scoped.date }), rehearsal: scoped.rehearsal }
  const realDate = scoped !== null && !scoped.rehearsal && scoped.date !== undefined ? scoped.date : route.name === 'packing' || route.name === 'parcels' ? route.date : undefined
  return { scope, realDate }
}

/** 막대 앞 네 칸 — 방송 중 엄지 한 번에 닿아야 하는 화면. 바꾸지 않는다(D-NAV-01 (9)) */
function barItems(input: MenuInput): readonly [MenuItem, MenuItem, MenuItem, MenuItem] {
  const { scope } = scopes(input.route)
  return [
    { key: 'broadcasts', label: '방송', to: { name: 'home' } },
    { key: 'sms', label: '문자찜 입력', to: { name: 'sms' } },
    { key: 'buyers', label: '구매자', to: { name: 'buyers', ...scope } },
    { key: 'settlements', label: '정산', to: { name: 'settlements', ...scope } },
  ]
}

/** 더보기 목록 항목 ("설정" 앞). 새 메뉴는 여기 맨 뒤에 더한다 */
function moreItems(input: MenuInput): readonly MenuItem[] {
  const { realDate } = scopes(input.route)
  return [
    { key: 'deposits', label: '입금 확인', to: { name: 'deposits', tab: 'review' }, ...(input.review !== null && input.review > 0 ? { count: input.review } : {}) },
    { key: 'packing', label: '포장', to: { name: 'packing', ...(realDate === undefined ? {} : { date: realDate }) } },
    ...(input.labels ? [{ key: 'labels', label: '라벨', to: { name: 'labels' } } as const] : []),
    ...(input.billing === true ? [{ key: 'billing', label: '요금', to: { name: 'billing' } } as const] : []),
    { key: 'parcels', label: '택배', to: { name: 'parcels', ...(realDate === undefined ? {} : { date: realDate }) } },
  ]
}

/** "설정"은 메뉴 한 칸(D-N4a-07)이고 늘 맨 뒤다 */
const settingsItem: MenuItem = { key: 'settings', label: '설정', to: { name: 'settings' } }

export function menuLayout(input: MenuInput): MenuLayout {
  if (input.assistant) return { bar: [{ key: 'sms', label: '문자찜 입력', to: { name: 'sms' } }], more: [] }
  return { bar: barItems(input), more: [...moreItems(input), settingsItem] }
}

/** PC 메뉴: 막대 칸과 목록 항목을 한 줄로 (같은 순서) */
export function menuAll(layout: MenuLayout): readonly MenuItem[] {
  return [...layout.bar, ...layout.more]
}

/** 메뉴 이름 (화면 읽기 이름과 같다 — "입금 확인 3") */
export function menuName(item: MenuItem): string {
  return item.count === undefined ? item.label : `${item.label} ${item.count}`
}

/** 휴대폰 아래 막대의 "문자찜" 칸 이름 (D-MOB1-04 — 판매자·보조자 모두. 보이는 글 = 접근성 이름) */
export const SMS_BAR_LABEL = '문자찜'

/** 휴대폰 아래 막대 칸 이름 — "문자찜 입력"만 "문자찜"으로 줄인다. 그 밖은 `menuName`과 같다 */
export function barLabel(item: MenuItem): string {
  return item.key === 'sms' ? SMS_BAR_LABEL : menuName(item)
}
