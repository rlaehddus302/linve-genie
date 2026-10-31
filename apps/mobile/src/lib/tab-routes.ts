// 아래 탭 → 경로 (D-UX2-02). 탭끼리는 쌓지 않고 바꿔 끼운다(router.replace) — 뒤로 가기가 탭 사이를 맴돌지 않게.
// 정산 탭은 안내 화면(웹으로 열기 버튼)으로 간다 — 누르자마자 브라우저로 나가지 않는다(D-UX2-07).
export const TAB_PATH = { home: '/', packing: '/packing', settle: '/settle', more: '/more' } as const
export type TabRoute = keyof typeof TAB_PATH
