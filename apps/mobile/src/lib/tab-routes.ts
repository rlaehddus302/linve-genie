// 아래 탭 → 경로 (D-UX2-02 → D-UX3-01). 탭끼리는 쌓지 않고 바꿔 끼운다(router.replace) — 뒤로 가기가 탭 사이를 맴돌지 않게.
// 정산 탭은 앱 정산 화면이다(D-APPX-01 — 옛 안내 화면 D-UX2-07은 없앴다). 라벨은 탭이 됐다 — 방송 화면 등에서 열면 뒤로 가기가 있는 화면(`?from=`)으로.
export const TAB_PATH = { home: '/', labels: '/labels', settle: '/settle', packing: '/packing', more: '/more' } as const
export type TabRoute = keyof typeof TAB_PATH

/** 탭 화면들 — 앱 뼈대가 이 경로들의 화면 전환을 끈다(움직임은 TabFrame이 낸다) */
export const TAB_SCREENS = ['index', 'labels', 'settle', 'packing', 'more'] as const
