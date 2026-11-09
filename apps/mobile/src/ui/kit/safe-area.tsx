// 기기의 안전 영역 값을 공통 조각에 연결한다. 기기에서만 쓰고(라우트 파일), 시험은 theme.tsx의 기본값 0을 쓴다.
import type { ReactNode } from 'react'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BottomInsetProvider, PageTopProvider } from './theme.tsx'

/**
 * 라우트 화면을 감싼다: 위쪽은 SafeAreaView(edges=['top'])가, 아래쪽은 BottomCTA·시트·알림 막대가 직접 피한다.
 * belowStatusBar (D-UX4-41): 이 경로가 SafeAreaView 안이라 이미 상태 막대 아래에서 시작하면 true(기본) — 안의 쌓인 화면(SlidePage)·입력 화면 틀이 위를 또 띄우지 않는다.
 * 상태 막대까지 그리는 경로(입력 화면 틀 FormPage가 직접 띄우는 방송 연결·새 방송)는 false.
 */
export function KitInsets({ children, belowStatusBar = true }: { readonly children: ReactNode; readonly belowStatusBar?: boolean }) {
  const { bottom, top } = useSafeAreaInsets()
  return (
    <BottomInsetProvider bottom={bottom} top={top}>
      <PageTopProvider value={belowStatusBar ? 0 : top}>{children}</PageTopProvider>
    </BottomInsetProvider>
  )
}
