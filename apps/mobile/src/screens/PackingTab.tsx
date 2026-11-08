// 포장 탭 (D-UX3-60, 사용자 지시 2026-11-07 "포장, 택배 한 탭으로 합치자"): 위에 [포장 · 택배] 큰 글자 나누기(토스 "시장 뉴스"처럼),
// 고른 쪽은 진한 글자, 다른 쪽은 회색. 포장 화면 [택배 접수로]·홈 "택배 접수"는 택배 쪽을 그 날짜로 연다.
import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { SPACE, Txt, useKit } from '../ui/kit/index.ts'
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
      <View role="tablist" aria-label="포장 · 택배" style={{ flexDirection: 'row', gap: SPACE.lg, paddingTop: SPACE.lg, paddingBottom: SPACE.xs, paddingHorizontal: SPACE.xl }}>
        {SIDES.map((item) => {
          const on = item.key === side
          return (
            <Pressable key={item.key} role="tab" aria-label={item.word} aria-selected={on} hitSlop={8} onPress={() => setSide(item.key)}>
              <Txt step="title" weight="heavy" ink={on ? p.text : p.segmentOff}>
                {item.word}
              </Txt>
            </Pressable>
          )
        })}
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
