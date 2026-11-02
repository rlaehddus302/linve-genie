// 새 시안 조각 (D-UX2-01): 선 아이콘, 화면 머리(뒤로·제목·오른쪽), 아래 탭 5개(D-UX3-01), 큰 초록 카드, 할 일 줄, 메뉴 줄.
// 누르는 동안은 흐려지지 않고 바탕이 진해진다(D-UX3-03).
// 아이콘은 그림 파일·글꼴 없이 View 선으로 그린다(새 패키지를 넣지 않는다). 아이콘만으로 뜻을 전하지 않고 늘 글자와 함께 둔다.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Animated, Easing, Platform, Pressable, View, type ViewStyle } from 'react-native'
import { RADIUS, SHADOW, SPACE, TOUCH } from './tokens.ts'
import { Txt, useBottomInset, useKit } from './theme.tsx'
import { tapHaptic } from '../../native/haptics.ts'
import { TabIcon, type TabIconName } from './tab-icons.tsx'

export type IconName = 'back' | 'chevron' | 'play' | 'home' | 'box' | 'card' | 'more' | 'menu' | 'label' | 'mic' | 'check' | 'plus'

/**
 * 선 아이콘 (24 기준). 보조 기술에는 읽히지 않는다 — 옆 글자가 이름이다.
 * filled: 아래 탭에서 고른 칸처럼 속을 채운 모양(홈·상자·카드·라벨). 채운 모양 안의 선은 cut 색(놓인 바탕 색)으로 뚫는다.
 */
export function Icon({ name, color, size = 24, filled = false, cut }: { readonly name: IconName; readonly color?: string; readonly size?: number; readonly filled?: boolean; readonly cut?: string }) {
  const { p } = useKit()
  const c = color ?? p.text
  const hole = cut ?? p.surface
  const s = size
  const stroke = Math.max(2, Math.round(s / 11))
  const box: ViewStyle = { width: s, height: s, alignItems: 'center', justifyContent: 'center' }
  const shape = (() => {
    switch (name) {
      case 'chevron':
      case 'back': {
        const arm = s * 0.38
        return <View style={{ width: arm, height: arm, borderTopWidth: stroke, borderRightWidth: stroke, borderColor: c, borderRadius: 1, transform: [{ rotate: name === 'chevron' ? '45deg' : '-135deg' }], marginLeft: name === 'chevron' ? -arm * 0.35 : arm * 0.35 }} />
      }
      case 'play':
        return (
          <View style={{ width: s * 0.9, height: s * 0.9, borderRadius: s, borderWidth: stroke, borderColor: c, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 0, height: 0, marginLeft: s * 0.08, borderTopWidth: s * 0.17, borderBottomWidth: s * 0.17, borderLeftWidth: s * 0.26, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: c }} />
          </View>
        )
      case 'home': {
        // 지붕(돌린 네모) + 몸통. 찬 모양도 같은 치수 — 몸통 가운데 아래에 문(놓인 바탕 색)만 뚫는다 (D-UX3-07)
        const roof = s * 0.52
        return (
          <View style={{ alignItems: 'center' }}>
            <View style={{ width: roof, height: roof, borderTopWidth: stroke, borderLeftWidth: stroke, borderColor: c, backgroundColor: filled ? c : 'transparent', borderRadius: 2, transform: [{ rotate: '45deg' }], marginBottom: -s * 0.3 }} />
            <View style={{ width: s * 0.62, height: s * 0.42, borderLeftWidth: stroke, borderRightWidth: stroke, borderBottomWidth: stroke, borderColor: c, backgroundColor: filled ? c : 'transparent', borderBottomLeftRadius: 2, borderBottomRightRadius: 2, alignItems: 'center', justifyContent: 'flex-end' }}>
              {filled ? <View style={{ width: s * 0.16, height: s * 0.2, backgroundColor: hole, borderTopLeftRadius: s, borderTopRightRadius: s }} /> : null}
            </View>
          </View>
        )
      }
      case 'box':
        return (
          <View style={{ width: s * 0.78, height: s * 0.7, borderWidth: stroke, borderColor: c, backgroundColor: filled ? c : 'transparent', borderRadius: 3, alignItems: 'center' }}>
            <View style={{ position: 'absolute', top: s * 0.16, left: 0, right: 0, height: stroke, backgroundColor: filled ? hole : c }} />
            <View style={{ width: stroke, height: s * 0.2, backgroundColor: filled ? hole : c }} />
          </View>
        )
      case 'card':
        return (
          <View style={{ width: s * 0.8, height: s * 0.6, borderWidth: stroke, borderColor: c, backgroundColor: filled ? c : 'transparent', borderRadius: 3 }}>
            <View style={{ marginTop: s * 0.12, height: stroke, backgroundColor: filled ? hole : c }} />
          </View>
        )
      case 'label': {
        // 라벨 한 장: 네모 + 글줄 둘 (찬 모양은 네모를 채우고 글줄을 뚫는다)
        const lines = filled ? hole : c
        return (
          <View style={{ width: s * 0.8, height: s * 0.66, borderRadius: 3, borderWidth: stroke, borderColor: c, backgroundColor: filled ? c : 'transparent', justifyContent: 'center', paddingLeft: s * 0.14, gap: s * 0.09 }}>
            <View style={{ width: s * 0.42, height: stroke, backgroundColor: lines }} />
            <View style={{ width: s * 0.26, height: stroke, backgroundColor: lines }} />
          </View>
        )
      }
      case 'menu':
        return (
          <View style={{ gap: s * 0.17 }}>
            {[0, 1, 2].map((n) => (
              <View key={n} style={{ width: s * 0.72, height: stroke, borderRadius: stroke, backgroundColor: c }} />
            ))}
          </View>
        )
      case 'more':
        return (
          <View style={{ flexDirection: 'row', gap: s * 0.16 }}>
            {[0, 1, 2].map((n) => (
              <View key={n} style={{ width: s * 0.15, height: s * 0.15, borderRadius: s, backgroundColor: c }} />
            ))}
          </View>
        )
      case 'mic':
        return (
          <View style={{ alignItems: 'center' }}>
            <View style={{ width: s * 0.3, height: s * 0.48, borderRadius: s, borderWidth: stroke, borderColor: c }} />
            <View style={{ width: s * 0.58, height: s * 0.3, marginTop: -s * 0.2, borderLeftWidth: stroke, borderRightWidth: stroke, borderBottomWidth: stroke, borderColor: c, borderBottomLeftRadius: s, borderBottomRightRadius: s }} />
            <View style={{ width: stroke, height: s * 0.14, backgroundColor: c }} />
          </View>
        )
      case 'check':
        return <View style={{ width: s * 0.3, height: s * 0.55, borderBottomWidth: stroke + 1, borderRightWidth: stroke + 1, borderColor: c, transform: [{ rotate: '45deg' }], marginTop: -s * 0.12 }} />
      case 'plus':
        return (
          <View style={{ width: s * 0.6, height: s * 0.6, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ position: 'absolute', width: s * 0.6, height: stroke, backgroundColor: c }} />
            <View style={{ position: 'absolute', width: stroke, height: s * 0.6, backgroundColor: c }} />
          </View>
        )
    }
  })()
  return (
    <View aria-hidden style={box} pointerEvents="none">
      {shape}
    </View>
  )
}

/** 뒤로 화살표 크기 — 모든 화면 머리·전체 화면 판이 같은 크기·색을 쓴다 (D-UX3-08) */
export const BACK_ICON = 26

/** 뒤로 단추 하나 (토스 ‹): 48×48 누름 자리, 글자색 화살표 26, 누르면 바탕이 진해진다. 어느 화면이든 이것만 쓴다 */
export function BackButton({ label = '뒤로', onPress }: { readonly label?: string; readonly onPress: () => void }) {
  const { p } = useKit()
  return (
    <Pressable role="button" aria-label={label} onPress={onPress} hitSlop={6} style={({ pressed }) => ({ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.md, backgroundColor: pressed ? p.pressed : 'transparent' })}>
      <Icon name="back" size={BACK_ICON} color={p.text} />
    </Pressable>
  )
}

/** 화면 머리: 뒤로(44) · 제목 · 오른쪽 조각(상태·⋯). 뒤로가 없으면 제목만 크게. */
export function AppHeader({ title, onBack, backLabel = '뒤로', right, testID }: { readonly title: string; readonly onBack?: () => void; readonly backLabel?: string; readonly right?: ReactNode; readonly testID?: string }) {
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, paddingTop: SPACE.lg, paddingBottom: SPACE.xs, paddingLeft: onBack === undefined ? SPACE.xl : SPACE.md, paddingRight: SPACE.md, minHeight: 64 }}>
      {onBack === undefined ? null : (
        <BackButton label={backLabel} onPress={onBack} />
      )}
      <View style={{ flex: 1 }}>
        <Txt step="title" weight="heavy" role="heading" aria-level={1} numberOfLines={1}>
          {title}
        </Txt>
      </View>
      {right}
    </View>
  )
}

/** 머리 오른쪽 둥근 아이콘 버튼 (⋯ 등). 이름은 aria-label로 꼭 준다. */
export function HeaderIconButton({ icon, label, onPress, testID }: { readonly icon: IconName; readonly label: string; readonly onPress: () => void; readonly testID?: string }) {
  const { p } = useKit()
  return (
    <Pressable role="button" aria-label={label} onPress={onPress} testID={testID} hitSlop={6} style={({ pressed }) => ({ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.md, backgroundColor: pressed ? p.pressed : 'transparent' })}>
      <Icon name={icon} />
    </Pressable>
  )
}

export type TabKey = 'home' | 'labels' | 'settle' | 'packing' | 'more'

/** 아래 탭 5개 (D-UX3-01): 일하는 순서대로 홈 · 라벨 · 정산 · 포장 · 전체 */
export const TABS: readonly { readonly key: TabKey; readonly word: string; readonly icon: TabIconName }[] = [
  { key: 'home', word: '홈', icon: 'home' },
  { key: 'labels', word: '라벨', icon: 'printer' },
  { key: 'settle', word: '정산', icon: 'receipt' },
  { key: 'packing', word: '포장', icon: 'box' },
  { key: 'more', word: '전체', icon: 'menu' },
]

/** 탭 순서 (화면 바뀔 때 왼쪽·오른쪽 어느 쪽에서 들어올지 정한다) */
export function tabIndex(key: TabKey): number {
  return TABS.findIndex((tab) => tab.key === key)
}

/**
 * 아래 탭 (토스식, D-UX3-01·12): 떠 있는 둥근 흰 막대. 고른 칸은 회색 둥근 바탕 + 속이 찬 아이콘 + 굵은 글자,
 * 나머지는 선 아이콘 + 회색 글자. 누르는 동안은 그 칸 바탕이 진해진다. 탭을 바꾸면 회색 바탕이 전 탭 자리에서 새 탭으로 미끄러진다(from).
 */
export function TabBar({ active, from = null, onSelect }: { readonly active: TabKey; readonly from?: TabKey | null; readonly onSelect: (key: TabKey) => void }) {
  const { p } = useKit()
  const inset = useBottomInset()
  const [width, setWidth] = useState(0)
  const target = tabIndex(active)
  const start = from === null ? target : tabIndex(from)
  const slide = useRef(new Animated.Value(start)).current
  useEffect(() => {
    if (start === target) return
    Animated.timing(slide, { toValue: target, duration: 260, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: Platform.OS !== 'web' }).start()
  }, [slide, start, target])
  const gap = 2
  const cell = width === 0 ? 0 : (width - gap * (TABS.length - 1)) / TABS.length
  return (
    <View style={{ backgroundColor: p.background, paddingHorizontal: SPACE.md, paddingTop: SPACE.xs, paddingBottom: Math.max(inset, SPACE.sm) }}>
      <View role="tablist" aria-label="아래 메뉴" style={{ flexDirection: 'row', backgroundColor: p.surface, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: p.line, padding: SPACE.xs, gap, ...SHADOW.sheet, shadowOpacity: 0.06, shadowRadius: 12, elevation: 4 }}>
        {/* 고른 칸 회색 바탕 — 칸들 뒤에서 미끄러진다 */}
        <View pointerEvents="none" style={{ position: 'absolute', left: SPACE.xs, right: SPACE.xs, top: SPACE.xs, bottom: SPACE.xs }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
          {cell > 0 ? <Animated.View style={{ position: 'absolute', top: 0, bottom: 0, width: cell, borderRadius: RADIUS.pill, backgroundColor: p.soft, transform: [{ translateX: slide.interpolate({ inputRange: [0, TABS.length - 1], outputRange: [0, (cell + gap) * (TABS.length - 1)] }) }] }} /> : null}
        </View>
        {TABS.map((tab) => {
          const on = tab.key === active
          const ink = on ? p.text : p.textSub
          return (
            <Pressable key={tab.key} role="tab" aria-selected={on} aria-label={tab.word} onPress={() => {
                tapHaptic()
                onSelect(tab.key)
              }} style={({ pressed }) => ({ flex: 1, minHeight: 56, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: pressed ? p.softPressed : on && cell === 0 ? p.soft : 'transparent' })}>
              {({ pressed }) => (
                <>
                  <TabIcon name={tab.icon} color={ink} size={26} filled={on} cut={pressed ? p.softPressed : on ? p.soft : p.surface} />
                  <Txt step="caption" weight={on ? 'bold' : 'medium'} ink={ink}>
                    {tab.word}
                  </Txt>
                </>
              )}
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

/** 큰 초록 카드 버튼 (홈 "방송 시작하기"): 제목 크게 + 한 줄 설명. */
export function HeroButton({ title, sub, icon = 'play', onPress, disabled, ariaLabel, testID }: { readonly title: string; readonly sub?: string; readonly icon?: IconName; readonly onPress: () => void; readonly disabled?: boolean; readonly ariaLabel?: string; readonly testID?: string }) {
  const { p } = useKit()
  return (
    <Pressable role="button" aria-label={ariaLabel ?? title} aria-disabled={disabled === true} disabled={disabled === true} onPress={onPress} testID={testID} style={({ pressed }) => ({ borderRadius: RADIUS.xl, paddingVertical: 22, paddingHorizontal: SPACE.xl, gap: 6, backgroundColor: pressed && disabled !== true ? p.primaryPressed : p.primary, opacity: disabled === true ? 0.5 : 1 })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Icon name={icon} color={p.onPrimary} size={26} />
        <Txt step="title" weight="heavy" color="onPrimary">
          {title}
        </Txt>
      </View>
      {sub === undefined ? null : (
        <Txt step="caption" color="onPrimary">
          {sub}
        </Txt>
      )}
    </Pressable>
  )
}

export type BadgeTone = 'warn' | 'green' | 'gray'

/** 숫자 배지 (44 정사각, 둥근 14) */
export function CountBadge({ count, tone }: { readonly count: number; readonly tone: BadgeTone }) {
  const { p } = useKit()
  const bg = tone === 'warn' ? p.warnBg : tone === 'green' ? p.freshBg : p.border
  const fg = tone === 'warn' ? p.warnText : tone === 'green' ? p.primaryText : p.text
  return (
    <View aria-hidden style={{ minWidth: 48, height: 48, paddingHorizontal: 6, borderRadius: RADIUS.md, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Txt step="bodyLarge" weight="heavy" ink={fg}>
        {String(count)}
      </Txt>
    </View>
  )
}

/** 흰 묶음 카드 (줄들을 담는다. 줄 사이 얇은 선은 RowDivider). title이 있으면 카드 안 맨 위에 묶음 이름(토스 "금융 서비스"처럼, D-UX3-04) */
export function RowGroup({ children, label, title }: { readonly children?: ReactNode; readonly label?: string; readonly title?: string }) {
  const { p } = useKit()
  const name = label ?? title
  return (
    <View role={name === undefined ? undefined : 'group'} aria-label={name} style={{ backgroundColor: p.surface, borderRadius: RADIUS.xl, paddingVertical: SPACE.xs }}>
      {title === undefined ? null : (
        <View style={{ paddingHorizontal: SPACE.xl, paddingTop: SPACE.lg, paddingBottom: SPACE.xs }}>
          <Txt step="caption" weight="bold" color="textSub" role="heading" aria-level={2}>
            {title}
          </Txt>
        </View>
      )}
      {children}
    </View>
  )
}

export function RowDivider() {
  const { p } = useKit()
  return <View aria-hidden style={{ height: 1, backgroundColor: p.border, marginHorizontal: SPACE.xl }} />
}

/** 할 일 줄: 숫자 배지 · 제목 · 짧은 설명 · 화살표 */
export function TodoRow({ count, tone, title, sub, onPress, ariaLabel, testID }: { readonly count?: number; readonly tone?: BadgeTone; readonly title: string; readonly sub?: string; readonly onPress: () => void; readonly ariaLabel?: string; readonly testID?: string }) {
  const { p } = useKit()
  const name = ariaLabel ?? (count === undefined ? title : `${title} ${String(count)}`)
  return (
    <Pressable role="button" aria-label={name} onPress={onPress} testID={testID} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: SPACE.lg, paddingHorizontal: SPACE.xl - SPACE.sm, marginHorizontal: SPACE.sm, borderRadius: RADIUS.lg, minHeight: TOUCH.min, backgroundColor: pressed ? p.pressed : 'transparent' })}>
      {count === undefined ? null : <CountBadge count={count} tone={tone ?? 'gray'} />}
      <View style={{ flex: 1, gap: 2 }}>
        <Txt step="bodyLarge" weight="bold">
          {title}
        </Txt>
        {sub === undefined ? null : (
          <Txt step="caption" color="textSub">
            {sub}
          </Txt>
        )}
      </View>
      <Icon name="chevron" color={p.textSub} size={20} />
    </Pressable>
  )
}

/** 작은 묶음 이름 ("지난 방송") */
export function GroupLabel({ children }: { readonly children: string }) {
  return (
    <Txt step="caption" weight="bold" color="textSub" role="heading" aria-level={2}>
      {children}
    </Txt>
  )
}

/** 상태 점 + 글 ("듣는 중") */
export function DotStatus({ word, tone }: { readonly word: string; readonly tone: 'on' | 'off' | 'warn' }) {
  const { p } = useKit()
  const ink = tone === 'on' ? p.primaryText : tone === 'warn' ? p.warnText : p.textSub
  return (
    <View role="status" aria-label={word} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: SPACE.xs }}>
      <View aria-hidden style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: ink }} />
      <Txt step="caption" weight="bold" ink={ink}>
        {word}
      </Txt>
    </View>
  )
}
