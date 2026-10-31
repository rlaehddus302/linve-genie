// 새 시안 조각 (D-UX2-01): 선 아이콘, 화면 머리(뒤로·제목·오른쪽), 아래 탭 4개, 큰 초록 카드, 할 일 줄, 메뉴 줄.
// 아이콘은 그림 파일·글꼴 없이 View 선으로 그린다(새 패키지를 넣지 않는다). 아이콘만으로 뜻을 전하지 않고 늘 글자와 함께 둔다.
import type { ReactNode } from 'react'
import { Pressable, View, type ViewStyle } from 'react-native'
import { RADIUS, SPACE, TOUCH } from './tokens.ts'
import { Txt, useBottomInset, useKit } from './theme.tsx'

export type IconName = 'back' | 'chevron' | 'play' | 'home' | 'box' | 'card' | 'more' | 'mic' | 'check' | 'plus'

/** 선 아이콘 (24 기준). 보조 기술에는 읽히지 않는다 — 옆 글자가 이름이다. */
export function Icon({ name, color, size = 24 }: { readonly name: IconName; readonly color?: string; readonly size?: number }) {
  const { p } = useKit()
  const c = color ?? p.text
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
      case 'home':
        return (
          <View style={{ alignItems: 'center' }}>
            <View style={{ width: s * 0.52, height: s * 0.52, borderTopWidth: stroke, borderLeftWidth: stroke, borderColor: c, transform: [{ rotate: '45deg' }], marginBottom: -s * 0.3 }} />
            <View style={{ width: s * 0.62, height: s * 0.42, borderLeftWidth: stroke, borderRightWidth: stroke, borderBottomWidth: stroke, borderColor: c, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 }} />
          </View>
        )
      case 'box':
        return (
          <View style={{ width: s * 0.78, height: s * 0.7, borderWidth: stroke, borderColor: c, borderRadius: 3, alignItems: 'center' }}>
            <View style={{ position: 'absolute', top: s * 0.16, left: 0, right: 0, height: stroke, backgroundColor: c }} />
            <View style={{ width: stroke, height: s * 0.2, backgroundColor: c }} />
          </View>
        )
      case 'card':
        return (
          <View style={{ width: s * 0.8, height: s * 0.6, borderWidth: stroke, borderColor: c, borderRadius: 3 }}>
            <View style={{ marginTop: s * 0.12, height: stroke, backgroundColor: c }} />
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

/** 화면 머리: 뒤로(44) · 제목 · 오른쪽 조각(상태·⋯). 뒤로가 없으면 제목만 크게. */
export function AppHeader({ title, onBack, backLabel = '뒤로', right, testID }: { readonly title: string; readonly onBack?: () => void; readonly backLabel?: string; readonly right?: ReactNode; readonly testID?: string }) {
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, paddingTop: SPACE.lg, paddingBottom: SPACE.xs, paddingLeft: onBack === undefined ? SPACE.xl : SPACE.md, paddingRight: SPACE.md, minHeight: 64 }}>
      {onBack === undefined ? null : (
        <Pressable role="button" aria-label={backLabel} onPress={onBack} hitSlop={6} style={({ pressed }) => ({ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.md, opacity: pressed ? 0.5 : 1 })}>
          <Icon name="back" />
        </Pressable>
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
  return (
    <Pressable role="button" aria-label={label} onPress={onPress} testID={testID} hitSlop={6} style={({ pressed }) => ({ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.md, opacity: pressed ? 0.5 : 1 })}>
      <Icon name={icon} />
    </Pressable>
  )
}

export type TabKey = 'home' | 'packing' | 'settle' | 'more'

const TABS: readonly { readonly key: TabKey; readonly word: string; readonly icon: IconName }[] = [
  { key: 'home', word: '홈', icon: 'home' },
  { key: 'packing', word: '포장', icon: 'box' },
  { key: 'settle', word: '정산', icon: 'card' },
  { key: 'more', word: '더보기', icon: 'more' },
]

/** 아래 탭 4개: 홈 · 포장 · 정산 · 더보기. 고른 탭은 초록 + 굵게. */
export function TabBar({ active, onSelect }: { readonly active: TabKey; readonly onSelect: (key: TabKey) => void }) {
  const { p } = useKit()
  const inset = useBottomInset()
  return (
    <View role="tablist" aria-label="아래 메뉴" style={{ flexDirection: 'row', backgroundColor: p.surface, borderTopWidth: 1, borderTopColor: p.line, paddingTop: SPACE.xs, paddingBottom: Math.max(inset, SPACE.sm) }}>
      {TABS.map((tab) => {
        const on = tab.key === active
        const ink = on ? p.primaryText : p.textSub
        return (
          <Pressable key={tab.key} role="tab" aria-selected={on} aria-label={tab.word} onPress={() => onSelect(tab.key)} style={({ pressed }) => ({ flex: 1, minHeight: TOUCH.min + 4, alignItems: 'center', justifyContent: 'center', gap: 2, opacity: pressed ? 0.6 : 1 })}>
            <Icon name={tab.icon} color={ink} />
            <Txt step="caption" weight={on ? 'heavy' : 'medium'} ink={ink}>
              {tab.word}
            </Txt>
          </Pressable>
        )
      })}
    </View>
  )
}

/** 큰 초록 카드 버튼 (홈 "방송 시작하기"): 제목 크게 + 한 줄 설명. */
export function HeroButton({ title, sub, icon = 'play', onPress, disabled, ariaLabel, testID }: { readonly title: string; readonly sub?: string; readonly icon?: IconName; readonly onPress: () => void; readonly disabled?: boolean; readonly ariaLabel?: string; readonly testID?: string }) {
  const { p } = useKit()
  return (
    <Pressable role="button" aria-label={ariaLabel ?? title} aria-disabled={disabled === true} disabled={disabled === true} onPress={onPress} testID={testID} style={({ pressed }) => ({ backgroundColor: p.primary, borderRadius: RADIUS.xl, paddingVertical: 22, paddingHorizontal: SPACE.xl, gap: 6, opacity: disabled === true ? 0.5 : pressed ? 0.88 : 1 })}>
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

/** 흰 묶음 카드 (줄들을 담는다. 줄 사이 얇은 선은 RowDivider) */
export function RowGroup({ children, label }: { readonly children?: ReactNode; readonly label?: string }) {
  const { p } = useKit()
  return (
    <View role={label === undefined ? undefined : 'group'} aria-label={label} style={{ backgroundColor: p.surface, borderRadius: RADIUS.xl, paddingVertical: SPACE.xs }}>
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
    <Pressable role="button" aria-label={name} onPress={onPress} testID={testID} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: SPACE.lg, paddingHorizontal: SPACE.xl, minHeight: TOUCH.min, opacity: pressed ? 0.6 : 1 })}>
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
