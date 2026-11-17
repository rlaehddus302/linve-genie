// 위 탭 바 하나로 (D-TABS-01, 사용자 지시 2026-11-17 "탭 바 디자인도 라이브 안에 있는 탭 바 디자인을 모듈화해서 그걸로 통일하라"):
// 라이브 화면의 밑줄 글자 탭(D-UX4-201·203 — 토스 거래 내역 탭)을 모든 화면의 위 탭이 같이 쓴다.
// 탭 줄 아래 화면 끝까지 옅은 선, 고른 탭은 굵은 검정 글 + 탭 폭만큼 검정 밑줄(옅은 선 위에 겹친다), 안 고른 탭은 회색 글. 포인트 색은 쓰지 않는다.
// 넘치면 옆으로 민다. 탭 바는 늘 머리(화면 상단 영역) 바로 밑에 붙는다 — 그 사이에 알림·단추를 두지 않는다 (D-TABS-02).
// 탭을 바꾸면 검정 밑줄이 옛 탭 자리에서 새 탭 자리로 미끄러지며 폭도 맞춘다 (D-TABS-04, 사용자 "탭 전환할 때 탭 아래 검정 선이 좌우로 움직이는 애니메이션").
import { createContext, useContext, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { AccessibilityInfo, Animated, Easing, Platform, ScrollView, View, type LayoutChangeEvent } from 'react-native'
import { SPACE, TOUCH } from './tokens.ts'
import { Txt, useKit } from './theme.tsx'
import { Tap } from './press.tsx'

/** 밑줄 글자 탭 안쪽 양옆 여백 — 밑줄이 글보다 양옆으로 12씩 길다 (토스 거래 내역 탭 재기, D-UX4-203) */
export const LINE_TAB_PAD = SPACE.md
/** 첫 탭 밑줄이 화면 끝에서 22 — 상품 줄 번호 네모와 같은 세로 줄 (D-UX4-203) */
export const LINE_TAB_EDGE = 22
/** 머리와 탭 글 사이 (라이브 화면 TABS_TOP, D-UX4-110). 8 → 4 (D-TABS-03, 토스 거래 내역 사진 재기 — 머리 가운데 ↔ 탭 글 가운데 51) */
export const LINE_TABS_TOP = SPACE.xs
/**
 * 탭 한 칸 높이 — 글 가운데 ↔ 밑 선 18.5 (D-TABS-03, 토스 18.6. 옛 48은 25였다).
 * 누름 자리는 위아래 hitSlop으로 48을 지킨다
 */
export const LINE_TAB_HEIGHT = 35
/** 고른 탭 밑줄 두께 (D-TABS-03, 토스 2 — 옛 3) */
export const LINE_TAB_BAR = 2

/** 밑줄이 미끄러지는 시간 (D-TABS-04) */
export const LINE_TAB_SLIDE_MS = 250
const SLIDE_EASE = Easing.bezier(0.2, 0.8, 0.2, 1)

export type TabBox = { readonly x: number; readonly width: number }

/** 막 고른 탭(me)의 밑줄 시작 모양: 옛 밑줄(from) 가운데까지 옮김·옛 폭 비율. 움직일 것이 없으면 null (D-TABS-04) */
export function barStart(from: TabBox | null, me: TabBox): { readonly shift: number; readonly stretch: number } | null {
  if (from === null || me.width === 0 || (from.x === me.x && from.width === me.width)) return null
  return { shift: from.x + from.width / 2 - (me.x + me.width / 2), stretch: from.width / me.width }
}
/** 한 탭 줄 안에서 마지막으로 밑줄이 있던 자리 — 새로 고른 탭이 거기서부터 밑줄을 끌어온다 */
const LastBar = createContext<MutableRefObject<TabBox | null> | null>(null)

/**
 * 고른 탭 밑줄의 미끄러짐 (D-TABS-04): 밑줄은 늘 고른 탭 안에 있고(탭 폭만큼), 막 고른 때만 옛 탭 자리·폭에서 시작해
 * 가운데 옮김(translateX)과 가로 늘임(scaleX)으로 제자리에 온다 — 둘 다 휴대폰 쪽 구동이라 목록이 바빠도 끊기지 않는다.
 * 처음 그릴 때·글이 바뀌어 폭만 달라질 때·움직임 줄이기를 켰을 때는 움직이지 않는다
 */
function useSlidingBar(on: boolean) {
  const last = useContext(LastBar)
  const box = useRef<TabBox | null>(null)
  const shift = useRef(new Animated.Value(0)).current
  const stretch = useRef(new Animated.Value(1)).current
  const [still, setStill] = useState(false)
  useEffect(() => {
    let alive = true
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => { if (alive) setStill(reduce) }, () => undefined)
    return () => { alive = false }
  }, [])
  useEffect(() => {
    const me = box.current
    if (!on || last === null || me === null) return
    const from = last.current
    last.current = me
    const start = still ? null : barStart(from, me)
    if (start === null) return
    shift.setValue(start.shift)
    stretch.setValue(start.stretch)
    const native = Platform.OS !== 'web'
    const run = Animated.parallel([
      Animated.timing(shift, { toValue: 0, duration: LINE_TAB_SLIDE_MS, easing: SLIDE_EASE, useNativeDriver: native }),
      Animated.timing(stretch, { toValue: 1, duration: LINE_TAB_SLIDE_MS, easing: SLIDE_EASE, useNativeDriver: native }),
    ])
    run.start()
    return () => run.stop()
  }, [on, last, still, shift, stretch])
  const onLayout = (event: LayoutChangeEvent) => {
    const { x, width } = event.nativeEvent.layout
    box.current = { x, width }
    // 고른 탭이 자리·폭만 바뀌면(글 "상품 51"→"상품 52") 움직이지 않고 밑줄 자리만 새로 적는다
    if (on && last !== null) last.current = box.current
  }
  return { onLayout, transform: [{ translateX: shift }, { scaleX: stretch }] }
}

/**
 * 탭 하나: 글자만(15 — D-TABS-03, 토스 사진과 한글 폭을 재어. 옛 16은 7% 컸다), 고르면 굵은 검정 글과 탭 폭만큼 검정 밑줄, 안 고르면 회색 글.
 * role: 라이브 화면은 옛 그대로 'button'(aria-selected), 다른 화면은 'tab'
 */
export function LineTab({ on, label, ariaLabel, onPress, role = 'tab', testID }: { readonly on: boolean; readonly label: string; readonly ariaLabel?: string; readonly onPress: () => void; readonly role?: 'tab' | 'button'; readonly testID?: string }) {
  const { p } = useKit()
  const bar = useSlidingBar(on)
  return (
    <Tap role={role} aria-label={ariaLabel ?? label} aria-selected={on} testID={testID} onPress={onPress} onLayout={bar.onLayout} pressScale={1} hitSlop={{ top: (TOUCH.min - LINE_TAB_HEIGHT) / 2, bottom: (TOUCH.min - LINE_TAB_HEIGHT) / 2 }} style={({ pressed }) => ({ minHeight: LINE_TAB_HEIGHT, paddingHorizontal: LINE_TAB_PAD, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
      <Txt step="body" weight={on ? 'bold' : 'medium'} ink={on ? p.text : p.borderStrong} numberOfLines={1}>
        {label}
      </Txt>
      {on ? <Animated.View aria-hidden testID="line-tab-bar" style={{ transform: bar.transform, position: 'absolute', left: 0, right: 0, bottom: -1, height: LINE_TAB_BAR, borderRadius: LINE_TAB_BAR / 2, borderCurve: 'continuous', backgroundColor: p.text }} /> : null}
    </Tap>
  )
}

/**
 * 탭 줄: 옆으로 미는 줄 + 화면 끝까지 옅은 선. bleed: 부르는 쪽 양옆 여백 — 그만큼 밖으로 내어 선이 화면 끝까지 닿게 한다.
 * right: 탭 줄 맨 오른쪽에 붙는 것(정산서 [정산 정보를 알려주세요 ›], D-UX4-177) — 탭 바 위가 아니라 같은 줄이다.
 * 바탕은 칠하지 않는다 — 붙는 머리로 쓸 때는 부르는 쪽 칸이 화면 바탕을 칠한다.
 */
export function LineTabs({ label, children, bleed = 0, right, testID }: { readonly label: string; readonly children: ReactNode; readonly bleed?: number; readonly right?: ReactNode; readonly testID?: string }) {
  const { p } = useKit()
  const last = useRef<TabBox | null>(null)
  const line = { borderBottomWidth: 1, borderBottomColor: p.border } as const
  const tabs = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} testID={testID} style={{ ...line, flexGrow: right === undefined || right === null ? 0 : 1, flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: LINE_TAB_EDGE }}>
      <View role="tablist" aria-label={label} style={{ flexDirection: 'row', gap: SPACE.md }}>
        <LastBar.Provider value={last}>{children}</LastBar.Provider>
      </View>
    </ScrollView>
  )
  if (right === undefined || right === null) return <View style={{ marginHorizontal: -bleed }}>{tabs}</View>
  return (
    <View style={{ marginHorizontal: -bleed, flexDirection: 'row' }}>
      {tabs}
      {/* 오른쪽 칸도 같은 선 — 선이 화면 끝까지 이어진다 */}
      <View style={{ ...line, justifyContent: 'center', paddingRight: Math.max(bleed, SPACE.sm) }}>{right}</View>
    </View>
  )
}
