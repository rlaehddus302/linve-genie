// 아래 탭이 붙는 화면 틀 (D-UX2-02): 홈 · 포장 · 정산 · 더보기. 정산 탭은 "웹 화면에서 열려요" 안내 화면으로 간다(D-UX2-07).
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { TabBar, useKit, type TabKey } from '../ui/kit/index.ts'

export function TabFrame({ active, go, children }: { readonly active: TabKey; readonly go: (key: TabKey) => void; readonly children: ReactNode }) {
  const { p } = useKit()
  return (
    <View style={{ flex: 1, backgroundColor: p.background }}>
      <View style={{ flex: 1 }}>{children}</View>
      <TabBar
        active={active}
        onSelect={(key) => {
          if (key === active) return
          go(key)
        }}
      />
    </View>
  )
}
