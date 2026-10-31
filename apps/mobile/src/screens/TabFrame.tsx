// 아래 탭이 붙는 화면 틀 (D-UX2-02): 홈 · 포장 · 정산 · 더보기. 정산은 아직 앱 화면이 없어 웹(기기 브라우저)으로 연다.
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { openWeb } from '../lib/open-web.ts'
import { TabBar, useKit, type TabKey } from '../ui/kit/index.ts'

export function TabFrame({ active, go, children }: { readonly active: TabKey; readonly go: (key: Exclude<TabKey, 'settle'>) => void; readonly children: ReactNode }) {
  const { p } = useKit()
  return (
    <View style={{ flex: 1, backgroundColor: p.background }}>
      <View style={{ flex: 1 }}>{children}</View>
      <TabBar
        active={active}
        onSelect={(key) => {
          if (key === active) return
          if (key === 'settle') void openWeb('/settlements')
          else go(key)
        }}
      />
    </View>
  )
}
