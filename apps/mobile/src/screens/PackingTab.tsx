// 포장 탭 (D-UX3-60, 사용자 지시 2026-11-07 "포장, 택배 한 탭으로 합치자"): 머리 밑에 [포장 · 택배] 밑줄 글자 탭(D-TABS-01 — 라이브 화면 탭과 같은 모양,
// 옛: 큰 제목 자리 나누기). 포장 화면 [택배 접수로]·홈 "택배 접수"는 택배 쪽을 그 날짜로 연다.
import { useState } from 'react'
import { View } from 'react-native'
import { AppHeader, GUTTER, LINE_TABS_TOP, LineTab, LineTabs, SPACE, useKit } from '../ui/kit/index.ts'
import { PackingScreen } from './PackingScreen.tsx'
import { ParcelsScreen, type ParcelsNavigation } from './ParcelsScreen.tsx'

export type PackingSide = 'packing' | 'parcels'
const SIDES: readonly { readonly key: PackingSide; readonly word: string }[] = [
  { key: 'packing', word: '포장' },
  { key: 'parcels', word: '택배' },
]

export function PackingTab({ initialSide = 'packing', initialDate, nav }: { readonly initialSide?: PackingSide; readonly initialDate?: string; readonly nav: ParcelsNavigation }) {
  const { p } = useKit()
  const [side, setSide] = useState<PackingSide>(initialSide)
  const [parcelDate, setParcelDate] = useState(initialDate)
  return (
    <View style={{ flex: 1, backgroundColor: p.background }}>
      {/* 모든 화면과 같은 머리 줄 (D-UX4-59) + 바로 밑에 붙는 밑줄 글자 탭 [포장 · 택배] (D-TABS-01 — 라이브 화면 탭과 같은 모양. 옛: 큰 제목 자리 나누기 D-UX3-60) */}
      <AppHeader title="택배" />
      <View style={{ paddingHorizontal: GUTTER, paddingTop: LINE_TABS_TOP }}>
        <LineTabs label="포장 · 택배" bleed={GUTTER}>
          {SIDES.map((item) => (
            <LineTab key={item.key} label={item.word} on={item.key === side} onPress={() => setSide(item.key)} />
          ))}
        </LineTabs>
      </View>
      {side === 'packing' ? (
        <PackingScreen
          topGap={SPACE.sm}
          openParcels={(date) => {
            setParcelDate(date)
            setSide('parcels')
          }}
        />
      ) : (
        <ParcelsScreen key={parcelDate ?? ''} topGap={SPACE.sm} initialDate={parcelDate} nav={nav} />
      )}
    </View>
  )
}
