// 경로(화면) 틀 하나 (D-UX4-97, 사용자 지시 2026-11-10 "위에 배경이 또 다름. 이거 왜이러는지 원인 제대로 파악하고 다신 안 이러게 조치하삼"):
// 원인 — 경로마다 상태 막대 자리(SafeAreaView 위쪽)를 회색으로 못 박아 칠했는데, 그 안 화면이 흰 바탕(라이브 관리·쌓인 흰 화면·입력 화면)이면
// 위 띠만 회색으로 남았다. 고침 — 모든 경로가 이 틀 하나를 쓰고, 상태 막대 자리 색은 안에 떠 있는 화면이 정한다:
// 흰 화면(StackPage 흰 바탕·FormPage·흰 SlidePage)은 useWhiteTop으로 알리고, 하나라도 있으면 흰색, 없으면 회색. test/route-frame.test.tsx가 경로 파일을 읽어 지킨다.
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { SafeAreaView, type Edge } from 'react-native-safe-area-context'
import { KitInsets } from './safe-area.tsx'
import { TopWhiteProvider, useTopWhiteCount } from './theme.tsx'
import { PALETTE } from './tokens.ts'

/** 상태 막대 자리 색: 흰 화면이 하나라도 떠 있으면 흰색 */
export const routeTopColor = (whiteCount: number): string => (whiteCount > 0 ? PALETTE.light.surface : PALETTE.light.background)

/**
 * selfTop: 안의 화면(FormPage 등)이 상태 막대 자리까지 직접 그린다 — 틀은 위를 띄우지 않는다.
 * edges: 기본 위쪽만 (우체국 화면처럼 아래도 피하면 ['top', 'bottom']).
 */
export function RouteFrame({ children, selfTop = false, edges }: { readonly children: ReactNode; readonly selfTop?: boolean; readonly edges?: readonly Edge[] }) {
  const [white, change] = useTopWhiteCount()
  if (selfTop) {
    return (
      <View style={{ flex: 1, backgroundColor: PALETTE.light.surface }}>
        <KitInsets belowStatusBar={false}>{children}</KitInsets>
      </View>
    )
  }
  return (
    <SafeAreaView testID="route-frame" style={{ flex: 1, backgroundColor: routeTopColor(white) }} edges={edges ?? ['top']}>
      <TopWhiteProvider change={change}>
        <KitInsets>{children}</KitInsets>
      </TopWhiteProvider>
    </SafeAreaView>
  )
}
