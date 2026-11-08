// 새 시안 조각 (D-UX2-01): 선 아이콘, 화면 머리(뒤로·제목·오른쪽), 아래 탭 5개(D-UX3-01), 큰 초록 카드, 할 일 줄, 메뉴 줄.
// 누르는 동안은 흐려지지 않고 바탕이 진해진다(D-UX3-03).
// 아이콘은 그림 파일·글꼴 없이 View 선으로 그린다(새 패키지를 넣지 않는다). 아이콘만으로 뜻을 전하지 않고 늘 글자와 함께 둔다.
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { Animated, Easing, Platform, Pressable, View, type ViewStyle } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { PAGE, RADIUS, SHADOW, SPACE, TOUCH } from './tokens.ts'
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
      case 'back':
        // 뒤로 ‹는 선 끝과 꺾인 곳을 둥글게, 선은 2.4 (D-UX3-55, 사용자 지시 2026-11-07 "뒤로가기 아이콘 살짝만 더 두껍게, 더 라운드지게" — 옛 각진 2)
        // 크기·자리는 토스 사진(폭 430 휴대폰)과 픽셀로 같게: 높이 37px·폭 21px, 왼쪽 51px·위 155px (D-UX3-56 — 옛 ‹는 16% 컸다)
        return (
          <Svg width={s} height={s} viewBox="0 0 24 24">
            <Path d="M12.31 4.95 L6.93 10.33 L12.31 15.71" stroke={c} strokeWidth={(BACK_STROKE * 24) / s} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </Svg>
        )
      case 'chevron': {
        const arm = s * 0.38
        // 화살표는 커져도 선은 가늘게 (토스 ‹와 같은 2, D-UX3-51)
        const line = Math.max(2, Math.round(s / 14))
        return <View style={{ width: arm, height: arm, borderTopWidth: line, borderRightWidth: line, borderColor: c, borderRadius: 1, borderCurve: 'continuous', transform: [{ rotate: '45deg' }], marginLeft: -arm * 0.35 }} />
      }
      case 'play':
        return (
          <View style={{ width: s * 0.9, height: s * 0.9, borderRadius: s, borderCurve: 'continuous', borderWidth: stroke, borderColor: c, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 0, height: 0, marginLeft: s * 0.08, borderTopWidth: s * 0.17, borderBottomWidth: s * 0.17, borderLeftWidth: s * 0.26, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: c }} />
          </View>
        )
      case 'home': {
        // 지붕(돌린 네모) + 몸통. 찬 모양도 같은 치수 — 몸통 가운데 아래에 문(놓인 바탕 색)만 뚫는다 (D-UX3-07)
        const roof = s * 0.52
        return (
          <View style={{ alignItems: 'center' }}>
            <View style={{ width: roof, height: roof, borderTopWidth: stroke, borderLeftWidth: stroke, borderColor: c, backgroundColor: filled ? c : 'transparent', borderRadius: 2, borderCurve: 'continuous', transform: [{ rotate: '45deg' }], marginBottom: -s * 0.3 }} />
            <View style={{ width: s * 0.62, height: s * 0.42, borderLeftWidth: stroke, borderRightWidth: stroke, borderBottomWidth: stroke, borderColor: c, backgroundColor: filled ? c : 'transparent', borderBottomLeftRadius: 2, borderBottomRightRadius: 2, alignItems: 'center', justifyContent: 'flex-end' }}>
              {filled ? <View style={{ width: s * 0.16, height: s * 0.2, backgroundColor: hole, borderTopLeftRadius: s, borderTopRightRadius: s }} /> : null}
            </View>
          </View>
        )
      }
      case 'box':
        return (
          <View style={{ width: s * 0.78, height: s * 0.7, borderWidth: stroke, borderColor: c, backgroundColor: filled ? c : 'transparent', borderRadius: 3, borderCurve: 'continuous', alignItems: 'center' }}>
            <View style={{ position: 'absolute', top: s * 0.16, left: 0, right: 0, height: stroke, backgroundColor: filled ? hole : c }} />
            <View style={{ width: stroke, height: s * 0.2, backgroundColor: filled ? hole : c }} />
          </View>
        )
      case 'card':
        return (
          <View style={{ width: s * 0.8, height: s * 0.6, borderWidth: stroke, borderColor: c, backgroundColor: filled ? c : 'transparent', borderRadius: 3, borderCurve: 'continuous' }}>
            <View style={{ marginTop: s * 0.12, height: stroke, backgroundColor: filled ? hole : c }} />
          </View>
        )
      case 'label': {
        // 라벨 한 장: 네모 + 글줄 둘 (찬 모양은 네모를 채우고 글줄을 뚫는다)
        const lines = filled ? hole : c
        return (
          <View style={{ width: s * 0.8, height: s * 0.66, borderRadius: 3, borderCurve: 'continuous', borderWidth: stroke, borderColor: c, backgroundColor: filled ? c : 'transparent', justifyContent: 'center', paddingLeft: s * 0.14, gap: s * 0.09 }}>
            <View style={{ width: s * 0.42, height: stroke, backgroundColor: lines }} />
            <View style={{ width: s * 0.26, height: stroke, backgroundColor: lines }} />
          </View>
        )
      }
      case 'menu':
        return (
          <View style={{ gap: s * 0.17 }}>
            {[0, 1, 2].map((n) => (
              <View key={n} style={{ width: s * 0.72, height: stroke, borderRadius: stroke, borderCurve: 'continuous', backgroundColor: c }} />
            ))}
          </View>
        )
      case 'more':
        return (
          <View style={{ flexDirection: 'row', gap: s * 0.16 }}>
            {[0, 1, 2].map((n) => (
              <View key={n} style={{ width: s * 0.15, height: s * 0.15, borderRadius: s, borderCurve: 'continuous', backgroundColor: c }} />
            ))}
          </View>
        )
      case 'mic':
        return (
          <View style={{ alignItems: 'center' }}>
            <View style={{ width: s * 0.3, height: s * 0.48, borderRadius: s, borderCurve: 'continuous', borderWidth: stroke, borderColor: c }} />
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
/** 뒤로 화살표 크기 — 토스 사진을 재어 33(선 두께는 2 그대로, D-UX3-51 — 옛 26) */
export const BACK_ICON = 33
/** 뒤로 ‹ 선 두께 (D-UX3-55) */
export const BACK_STROKE = 2.4

/** 뒤로 단추 하나 (토스 ‹): 48×48 누름 자리, 글자색 화살표 33. 누르면 바탕은 그대로 두고 화살표만 연해진다(D-UX3-51). 어느 화면이든 이것만 쓴다 */
export function BackButton({ label = '뒤로', onPress }: { readonly label?: string; readonly onPress: () => void }) {
  const { p } = useKit()
  return (
    <Pressable role="button" aria-label={label} onPress={onPress} hitSlop={6} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
      {({ pressed }) => <Icon name="back" size={BACK_ICON} color={pressed ? p.iconPressed : p.text} />}
    </Pressable>
  )
}

/** 화면 머리: 뒤로(44) · 제목 · 오른쪽 조각(상태·⋯). 뒤로가 없으면 제목만 크게. */
export function AppHeader({ title, onBack, backLabel = '뒤로', right, testID }: { readonly title: string; readonly onBack?: () => void; readonly backLabel?: string; readonly right?: ReactNode; readonly testID?: string }) {
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, paddingTop: onBack === undefined ? SPACE.lg : 0, paddingBottom: SPACE.xs, paddingLeft: onBack === undefined ? SPACE.xl : PAGE.backLeft, paddingRight: SPACE.md, minHeight: onBack === undefined ? 64 : 52 }}>
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
    <Pressable role="button" aria-label={label} onPress={onPress} testID={testID} hitSlop={6} style={({ pressed }) => ({ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
      <Icon name={icon} />
    </Pressable>
  )
}

export type TabKey = 'home' | 'settle' | 'packing' | 'customers' | 'more'

/**
 * 아래 탭 5개 (D-UX3-01 → D-UX3-39, 사용자 지시 2026-11-06 "우리 서비스 이용 플로우대로"): 방송 뒤 일하는 순서 그대로 —
 * 홈(방송·다음 할 일) · 주문(예약자별 정리 → 손님 정보 받기 → 확인서 보내기 → 입금 확인) · 포장(포장·라벨 부착 + 택배 접수, 위에서 나눔 — D-UX3-60) · 고객 · 전체. 라벨 프린터는 전체 안(장치 설정)
 */
export const TABS: readonly { readonly key: TabKey; readonly word: string; readonly icon: TabIconName }[] = [
  { key: 'home', word: '홈', icon: 'home' },
  { key: 'settle', word: '주문', icon: 'receipt' },
  { key: 'packing', word: '택배', icon: 'box' },
  { key: 'customers', word: '고객', icon: 'person' },
  { key: 'more', word: '전체', icon: 'menu' },
]

/** 탭 순서 (화면 바뀔 때 왼쪽·오른쪽 어느 쪽에서 들어올지 정한다) */
export function tabIndex(key: TabKey): number {
  return TABS.findIndex((tab) => tab.key === key)
}

/** 아래 탭 칸 높이 (D-UX3-41) */
export const TAB_CELL = 55
/** 아래 안전 영역이 이보다 크면 손잡이(아이폰 홈 막대 34·안드로이드 제스처 막대 ~24)가 아니라 안드로이드 단추 막대(◁ ○ ▢, ~48)다 */
export const BUTTON_NAV_MIN_INSET = 40

/**
 * 아래 탭 아래 여백 (토스처럼 홈 막대 자리까지 내려 앉는다, D-UX3-41): 홈 막대가 있으면 그 높이보다 14 작게, 없으면 8.
 * 안드로이드 단추 막대는 눌러야 하는 단추라 겹치면 안 된다 — 그 위로 8 띄운다 (D-UX3-67).
 */
export function tabBarBottom(inset: number): number {
  if (inset >= BUTTON_NAV_MIN_INSET) return inset + SPACE.sm
  return Math.max(inset - 14, SPACE.sm)
}

/** 아래 탭 뒤 흐림 (D-UX3-13): 앱은 시작 때 기기 흐림(expo-blur)을 끼운다. 시험·웹은 없음(반투명 흰색만) */
let Backdrop: ComponentType | null = null
export function setTabBarBackdrop(next: ComponentType | null): void {
  Backdrop = next
}

/**
 * 아래 탭 (토스식, D-UX3-01·12·13): 내용 위에 떠 있는 둥근 막대 — 따로 바탕 띠를 두지 않아 뒤 내용이 흐리게 비친다(반투명 흰색 + 흐림).
 * 고른 칸은 회색 둥근 바탕 + 속이 찬 아이콘 + 굵은 글자, 나머지는 선 아이콘 + 회색 글자. 누르는 동안은 그 칸 바탕이 진해진다.
 * 탭을 바꾸면 회색 바탕이 전 탭 자리에서 새 탭으로 미끄러진다(from). onHeight로 차지하는 높이를 알린다(내용 아래 여백).
 */
export function TabBar({ active, from = null, onSelect, onHeight }: { readonly active: TabKey; readonly from?: TabKey | null; readonly onSelect: (key: TabKey) => void; readonly onHeight?: (height: number) => void }) {
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
    <View pointerEvents="box-none" onLayout={(event) => onHeight?.(event.nativeEvent.layout.height)} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: SPACE.xl, paddingTop: SPACE.xs, paddingBottom: tabBarBottom(inset) }}>
      {/* 그림자는 겉에(둥글게 자르면 그림자도 잘린다), 흐림·반투명은 안에서 둥글게 자른다 */}
      <View style={{ borderRadius: RADIUS.pill, borderCurve: 'continuous', ...SHADOW.sheet, shadowOpacity: 0.03, shadowRadius: 8, elevation: 1 }}>
        <View role="tablist" aria-label="아래 메뉴" style={{ flexDirection: 'row', borderRadius: RADIUS.pill, borderCurve: 'continuous', overflow: 'hidden', borderWidth: 1, borderColor: p.tabLine, padding: SPACE.xs, gap }}>
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
            {Backdrop === null ? null : <Backdrop />}
            <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: p.glass }} />
          </View>
          {/* 고른 칸 회색 바탕 — 칸들 뒤에서 미끄러진다 */}
          <View pointerEvents="none" style={{ position: 'absolute', left: SPACE.xs, right: SPACE.xs, top: SPACE.xs, bottom: SPACE.xs }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
            {cell > 0 ? <Animated.View style={{ position: 'absolute', top: 0, bottom: 0, width: cell, borderRadius: RADIUS.pill, borderCurve: 'continuous', backgroundColor: p.soft, transform: [{ translateX: slide.interpolate({ inputRange: [0, TABS.length - 1], outputRange: [0, (cell + gap) * (TABS.length - 1)] }) }] }} /> : null}
          </View>
          {TABS.map((tab) => {
            const on = tab.key === active
            const ink = on ? p.text : p.tabInk
            return (
              <Pressable key={tab.key} role="tab" aria-selected={on} aria-label={tab.word} onPress={() => {
                  tapHaptic()
                  onSelect(tab.key)
                }} style={({ pressed }) => ({ flex: 1, minHeight: TAB_CELL, borderRadius: RADIUS.pill, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: pressed ? p.softPressed : on && cell === 0 ? p.soft : 'transparent' })}>
                {() => (
                  <>
                    <TabIcon name={tab.icon} color={ink} size={26} filled={on} cut={p.surface} />
                    <Txt step="tab" weight="medium" ink={ink}>
                      {tab.word}
                    </Txt>
                  </>
                )}
              </Pressable>
            )
          })}
        </View>
      </View>
    </View>
  )
}

/** 큰 초록 카드 버튼 (홈 "방송 시작하기"): 제목 크게 + 한 줄 설명. */
export function HeroButton({ title, sub, icon = 'play', onPress, disabled, ariaLabel, testID }: { readonly title: string; readonly sub?: string; readonly icon?: IconName; readonly onPress: () => void; readonly disabled?: boolean; readonly ariaLabel?: string; readonly testID?: string }) {
  const { p } = useKit()
  return (
    <Pressable role="button" aria-label={ariaLabel ?? title} aria-disabled={disabled === true} disabled={disabled === true} onPress={onPress} testID={testID} style={({ pressed }) => ({ borderRadius: RADIUS.xl, borderCurve: 'continuous', paddingVertical: 22, paddingHorizontal: SPACE.xl, gap: 6, backgroundColor: pressed && disabled !== true ? p.primaryPressed : p.primary, opacity: disabled === true ? 0.5 : 1 })}>
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
    <View aria-hidden style={{ minWidth: 48, height: 48, paddingHorizontal: 6, borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
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
    <View role={name === undefined ? undefined : 'group'} aria-label={name} style={{ backgroundColor: p.surface, borderRadius: RADIUS.xl, borderCurve: 'continuous', paddingVertical: SPACE.xs }}>
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
    <Pressable role="button" aria-label={name} onPress={onPress} testID={testID} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: SPACE.lg, paddingHorizontal: SPACE.xl - SPACE.sm, marginHorizontal: SPACE.sm, borderRadius: RADIUS.lg, borderCurve: 'continuous', minHeight: TOUCH.min, backgroundColor: pressed ? p.pressed : 'transparent' })}>
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
      <View aria-hidden style={{ width: 10, height: 10, borderRadius: 5, borderCurve: 'continuous', backgroundColor: ink }} />
      <Txt step="caption" weight="bold" ink={ink}>
        {word}
      </Txt>
    </View>
  )
}
