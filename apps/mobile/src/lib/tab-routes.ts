// 아래 탭 → 경로 (D-UX2-02). 탭끼리는 쌓지 않고 바꿔 끼운다(router.replace) — 뒤로 가기가 탭 사이를 맴돌지 않게.
// 정산 탭은 앱 정산 화면이다(D-APPX-01 — 옛 안내 화면 D-UX2-07은 없앴다).
export const TAB_PATH = { home: '/', packing: '/packing', settle: '/settle', more: '/more' } as const
export type TabRoute = keyof typeof TAB_PATH
