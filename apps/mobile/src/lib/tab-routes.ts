// 아래 탭 → 경로 (D-UX2-02). 탭끼리는 쌓지 않고 바꿔 끼운다(router.replace) — 뒤로 가기가 탭 사이를 맴돌지 않게.
export const TAB_PATH = { home: '/', packing: '/packing', more: '/more' } as const
export type TabRoute = keyof typeof TAB_PATH
