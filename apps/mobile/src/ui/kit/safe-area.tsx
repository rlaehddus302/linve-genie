// 기기의 안전 영역 값을 공통 조각에 연결한다. 기기에서만 쓰고(라우트 파일), 시험은 theme.tsx의 기본값 0을 쓴다.
import type { ReactNode } from 'react'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BottomInsetProvider } from './theme.tsx'

/** 라우트 화면을 감싼다: 위쪽은 SafeAreaView(edges=['top'])가, 아래쪽은 BottomCTA·시트·알림 막대가 직접 피한다. */
export function KitInsets({ children }: { readonly children: ReactNode }) {
  const { bottom } = useSafeAreaInsets()
  return <BottomInsetProvider bottom={bottom}>{children}</BottomInsetProvider>
}
