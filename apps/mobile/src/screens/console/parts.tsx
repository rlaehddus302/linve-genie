// 방송 화면 조각 (D-UX4-20~26, 사용자 지시 2026-11-09 토스 사진): 오른쪽에서 밀려 들어오는 화면, 토스 메뉴 줄(왼쪽 둥근 네모 아이콘),
// 설정 묶음 카드(굵은 묶음 이름), 이름 알약(위 탭 알약과 같은 크기).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AccessibilityInfo, Animated, BackHandler, Easing, KeyboardAvoidingView, Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native'
import { BackButton, KEYBOARD_AVOID, Txt, useBottomInset, useKit, useTopInset } from '../../ui/kit/index.ts'
import { PAGE, RADIUS, SPACE, TOUCH, pressedFill } from '../../ui/kit/tokens.ts'

/** 밀려 들어오는 시간 (쌓인 화면과 비슷하게) */
export const SLIDE_IN_MS = 280
export const SLIDE_OUT_MS = 220

/**
 * 방송 화면 위에 오른쪽에서 밀려 들어오는 화면 (D-UX4-20 — 아래에서 올라오는 판이 아니라 다음 화면처럼). 판(Modal)이 아니라 방송 화면 안에 겹쳐 그려서,
 * 이 화면에서 연 아래 판·팝업이 그 위에 그대로 뜬다(아이폰 판 겹침 문제 없음). 안드로이드 뒤로 단추는 이 화면을 닫는다.
 * title이 있으면 머리 가운데에 (토스 "토스뱅크 송금"처럼), 없으면 뒤로만.
 */
export function SlidePage({ visible, onClose, title, name, children, gray = false, footer, scroll = true, testID }: { readonly visible: boolean; readonly onClose: () => void; readonly title?: string; readonly name: string; readonly children?: ReactNode; readonly gray?: boolean; readonly footer?: ReactNode; readonly scroll?: boolean; readonly testID?: string }) {
  const { p } = useKit()
  const top = useTopInset()
  const { width } = useWindowDimensions()
  const instant = Platform.OS === 'web'
  const [mounted, setMounted] = useState(visible)
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current
  useEffect(() => {
    if (instant) {
      setMounted(visible)
      progress.setValue(visible ? 1 : 0)
      return
    }
    let alive = true
    if (visible) setMounted(true)
    const go = (reduce: boolean) => {
      if (!alive) return
      Animated.timing(progress, { toValue: visible ? 1 : 0, duration: reduce ? 0 : visible ? SLIDE_IN_MS : SLIDE_OUT_MS, easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
        if (alive && finished && !visible) setMounted(false)
      })
    }
    AccessibilityInfo.isReduceMotionEnabled().then(go, () => go(false))
    return () => {
      alive = false
    }
  }, [visible, instant, progress])
  useEffect(() => {
    if (!visible || Platform.OS !== 'android') return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose()
      return true
    })
    return () => sub.remove()
  }, [visible, onClose])
  if (!(instant ? visible : mounted)) return null
  const bg = gray ? p.background : p.surface
  const shift = progress.interpolate({ inputRange: [0, 1], outputRange: [width, 0] })
  const body = scroll ? (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SPACE.lg, paddingTop: SPACE.sm, paddingBottom: SPACE.xxl, gap: SPACE.md }} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={{ flex: 1 }}>{children}</View>
  )
  return (
    <Animated.View role="dialog" aria-label={name} testID={testID} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20, elevation: 20, backgroundColor: bg, paddingTop: top, transform: [{ translateX: shift }] }}>
      <KeyboardAvoidingView behavior={KEYBOARD_AVOID} style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingLeft: PAGE.backLeft, paddingRight: SPACE.md }}>
          <BackButton label="뒤로" onPress={onClose} />
          {title === undefined ? null : (
            // 토스 "토스뱅크 송금"처럼 가운데 제목 (본문보다 조금 큰 글자, 중간 굵기)
            <View pointerEvents="none" style={{ position: 'absolute', left: 64, right: 64, alignItems: 'center' }}>
              <Txt step="bodyLarge" weight="medium" role="heading" aria-level={1} numberOfLines={1}>
                {title}
              </Txt>
            </View>
          )}
        </View>
        {body}
        {footer}
      </KeyboardAvoidingView>
    </Animated.View>
  )
}

/** 설정 묶음 카드 (토스 설정 화면처럼): 흰 둥근 카드, 위에 굵은 묶음 이름 */
export function MenuGroup({ title, children }: { readonly title?: string; readonly children?: ReactNode }) {
  const { p } = useKit()
  return (
    <View role="group" aria-label={title} style={{ backgroundColor: p.surface, borderRadius: RADIUS.xl, borderCurve: 'continuous', paddingVertical: SPACE.sm }}>
      {title === undefined ? null : (
        <View style={{ paddingHorizontal: SPACE.xl, paddingTop: SPACE.md, paddingBottom: SPACE.xs }}>
          <Txt step="bodyLarge" weight="bold" role="heading" aria-level={2}>
            {title}
          </Txt>
        </View>
      )}
      {children}
    </View>
  )
}

/** 설정 줄 (토스 "언어 한국어 >"): 이름 · 오른쪽 값(있으면 주색) · 화살표 */
export function MenuRow({ title, value, onPress, danger, testID }: { readonly title: string; readonly value?: string; readonly onPress: () => void; readonly danger?: boolean; readonly testID?: string }) {
  const { p } = useKit()
  return (
    <Pressable role="button" aria-label={title} testID={testID} onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, minHeight: 56, paddingHorizontal: SPACE.xl - SPACE.sm, marginHorizontal: SPACE.sm, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
      <View style={{ flex: 1 }}>
        <Txt step="bodyLarge" weight="book" {...(danger === true ? { ink: p.dangerText } : {})}>
          {title}
        </Txt>
      </View>
      {value === undefined ? null : (
        <Txt step="bodyLarge" weight="book" color="primaryText">
          {value}
        </Txt>
      )}
      <Chevron />
    </Pressable>
  )
}

function Chevron() {
  const { p } = useKit()
  return <View aria-hidden style={{ width: 8, height: 8, marginRight: 4, borderTopWidth: 2, borderRightWidth: 2, borderColor: p.iconPressed, transform: [{ rotate: '45deg' }] }} />
}

/** 아이콘 줄 (토스 "전체" 메뉴처럼): 왼쪽 둥근 네모 안 그림 글자 · 이름. tint는 둥근 네모 바탕 */
export function IconMenuRow({ emoji, tint, title, onPress, testID, ariaLabel }: { readonly emoji: string; readonly tint: string; readonly title: string; readonly onPress: () => void; readonly testID?: string; readonly ariaLabel?: string }) {
  const { p } = useKit()
  return (
    <Pressable role="button" aria-label={ariaLabel ?? title} testID={testID} onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.md + 2, minHeight: 60, paddingHorizontal: SPACE.sm, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
      <View aria-hidden style={{ width: 40, height: 40, borderRadius: 13, borderCurve: 'continuous', backgroundColor: tint, alignItems: 'center', justifyContent: 'center' }}>
        <Txt step="lead">
          {emoji}
        </Txt>
      </View>
      <Txt step="bodyLarge" weight="medium">
        {title}
      </Txt>
    </Pressable>
  )
}

/** 휴지통 줄 바탕 (밝은 빨강 — 흰 휴지통 그림이 잘 보이게) */
export const TRASH_TINT = '#FF5A5F'

export type PillTone = 'win' | 'wait' | 'pending' | 'conflict'

/**
 * 이름 알약 (D-UX4-26, 사용자 지시 2026-11-09 "닉네임 알약 사이즈를 바깥에 있는 상품, 찜기록 알약 버튼만큼"): 높이 36·좌우 14·본문 큰 글자.
 * 찜(1등) 금색, 대기 회색, 보류 주황, 겹침 빨강 — 상품 줄·찜 기록과 같은 색.
 */
export function NamePill({ text, tone, onPress, ariaLabel, square = false }: { readonly text: string; readonly tone: PillTone; readonly onPress?: () => void; readonly ariaLabel: string; readonly square?: boolean }) {
  const { p, tones } = useKit()
  const pair = tone === 'win' ? { bg: p.goldBg, fg: p.goldText } : tone === 'pending' ? { bg: p.warnBg, fg: p.warnText } : tone === 'conflict' ? tones.danger : { bg: p.soft, fg: p.textSub }
  const shape = { minHeight: 36, paddingHorizontal: SPACE.md + 2, borderRadius: square ? 10 : RADIUS.pill, borderCurve: 'continuous' as const, alignItems: 'center' as const, justifyContent: 'center' as const }
  const label = (
    <Txt step="bodyLarge" weight={tone === 'wait' ? 'medium' : 'bold'} ink={pair.fg} numberOfLines={1}>
      {text}
    </Txt>
  )
  if (onPress === undefined) return <View aria-label={ariaLabel} style={{ ...shape, backgroundColor: pair.bg }}>{label}</View>
  return (
    <Pressable role="button" aria-label={ariaLabel} onPress={onPress} hitSlop={2} style={({ pressed }) => ({ ...shape, minWidth: TOUCH.min, backgroundColor: pressed ? pressedFill(p, pair.bg) : pair.bg, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
      {label}
    </Pressable>
  )
}

/** 아래 여백 (홈 막대) */
export function useFooterInset(): number {
  const inset = useBottomInset()
  return Math.max(inset, SPACE.md)
}
