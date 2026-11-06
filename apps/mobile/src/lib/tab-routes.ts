// 아래 탭 → 경로 (D-UX2-02 → D-UX3-01). 탭끼리는 쌓지 않고 바꿔 끼운다(router.replace) — 뒤로 가기가 탭 사이를 맴돌지 않게.
// 탭은 일하는 순서(D-UX3-39): 홈 · 주문(정산 화면) · 포장 · 택배 · 전체. 라벨 프린터는 탭이 아니라 뒤로 가기가 있는 화면(전체·홈·방송 화면에서 연다).
export const TAB_PATH = { home: '/', settle: '/settle', packing: '/packing', parcels: '/parcels', more: '/more' } as const
export type TabRoute = keyof typeof TAB_PATH

/** 탭 화면들 — 앱 뼈대가 이 경로들의 화면 전환을 끈다(움직임은 TabFrame이 낸다) */
export const TAB_SCREENS = ['index', 'settle', 'packing', 'parcels', 'more'] as const
