// 방송 화면 조각 (D-UX4-20~26, 사용자 지시 2026-11-09 토스 사진): 오른쪽에서 밀려 들어오는 화면, 토스 메뉴 줄(왼쪽 둥근 네모 아이콘),
// 설정 묶음 카드(굵은 묶음 이름), 이름 알약(위 탭 알약과 같은 크기).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AccessibilityInfo, Animated, BackHandler, Easing, KeyboardAvoidingView, Platform, ScrollView, View, useWindowDimensions } from 'react-native'
import { Icon, KEYBOARD_AVOID, NavBar, Txt, useWhiteTop, useBottomInset, useEdgeSwipeBack, useHoldRouteSwipe, useKit, usePageTop, useTopInset, Tap } from '../../ui/kit/index.ts'
import { RADIUS, GUTTER, SPACE, TOUCH, pressedFill } from '../../ui/kit/tokens.ts'

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
  // 방송 화면 경로는 이미 상태 막대 아래에서 시작한다 — 또 띄우면 상태 막대만큼 내려온다 (D-UX4-41)
  const top = usePageTop()
  // 키보드 피하기는 이 화면의 부모가 화면 맨 위에서 얼마나 아래에서 시작하는지 알아야 한다(상태 막대 아래에서 시작하면 그 높이)
  const parentTop = useTopInset() - top
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
  // 열려 있는 동안 방송 화면 경로의 밀어 뒤로 가기를 끄고(그대로 두면 방송 화면이 닫혀 홈으로 나갔다), 이 화면만 밀려 닫힌다 (D-UX4-50)
  useHoldRouteSwipe(visible)
  // 흰 겹친 화면이 떠 있는 동안 상태 막대 자리도 흰색 (D-UX4-97)
  useWhiteTop(visible && !gray)
  const swipe = useEdgeSwipeBack({ progress, width, onClose, enabled: visible })
  if (!(instant ? visible : mounted)) return null
  const bg = gray ? p.background : p.surface
  const shift = progress.interpolate({ inputRange: [0, 1], outputRange: [width, 0] })
  const body = scroll ? (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: gray ? GUTTER : SPACE.lg, paddingTop: SPACE.sm, paddingBottom: SPACE.xxl, gap: SPACE.md }} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={{ flex: 1 }}>{children}</View>
  )
  return (
    <Animated.View role="dialog" aria-label={name} testID={testID} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20, elevation: 20, backgroundColor: bg, paddingTop: top, transform: [{ translateX: shift }] }} {...swipe}>
      <KeyboardAvoidingView behavior={KEYBOARD_AVOID} keyboardVerticalOffset={parentTop} style={{ flex: 1 }}>
        {/* 모든 쌓인 화면과 같은 머리 (D-UX4-40) */}
        <NavBar onBack={onClose} {...(title === undefined ? {} : { title })} />
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
    <View role="group" aria-label={title} style={{ backgroundColor: p.surface, borderRadius: title === undefined ? RADIUS.xl : 0, borderCurve: 'continuous', paddingVertical: SPACE.sm }}>
      {title === undefined ? null : (
        <View style={{ paddingHorizontal: PLAIN.side, paddingTop: SPACE.sm, paddingBottom: SPACE.xs }}>
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
    <Tap role="button" aria-label={title} testID={testID} onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, minHeight: 56, paddingHorizontal: SPACE.xl - SPACE.sm, marginHorizontal: SPACE.sm, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
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
    </Tap>
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
    <Tap role="button" aria-label={ariaLabel ?? title} testID={testID} onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.md + 2, minHeight: 60, paddingHorizontal: SPACE.sm, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
      <View aria-hidden style={{ width: 40, height: 40, borderRadius: 13, borderCurve: 'continuous', backgroundColor: tint, alignItems: 'center', justifyContent: 'center' }}>
        <Txt step="lead">
          {emoji}
        </Txt>
      </View>
      <Txt step="bodyLarge" weight="medium">
        {title}
      </Txt>
    </Tap>
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
    <Tap role="button" aria-label={ariaLabel} onPress={onPress} hitSlop={2} pressScale={0.96} style={({ pressed }) => ({ ...shape, minWidth: TOUCH.min, backgroundColor: pressed ? pressedFill(p, pair.bg) : pair.bg })}>
      {label}
    </Tap>
  )
}

/** 아래 여백 (홈 막대) */
export function useFooterInset(): number {
  const inset = useBottomInset()
  return Math.max(inset, SPACE.md)
}

/**
 * 토스 설정 화면 줄 (D-UX4-94, 사용자 지시 2026-11-10 "섹션 및 섹션 라벨을 없애고 전체 배경을 흰색 … 폰트의 색, 크기, 두께, 위치, 상하좌우 여백 등을 사진1 기준으로"):
 * 토스 "비밀번호 · 보안"(923px = 393pt)을 재어 — 큰 제목 22 굵게 #191F28 · 화면 끝에서 24, 줄 이름 17 보통 #4F545E · 줄 높이 44,
 * 오른쪽 값 16 주색, › #90969E 20(오른쪽 끝에서 약 23). 흰 바탕에 묶음·묶음 이름 없이 줄만. 라이브 관리·라이브 연결이 같이 쓴다.
 */
/** weight: 같은 휴대폰 사진으로 견주니 토스 줄 글자 줄기가 우리 보통(400)보다 굵어 500(book) (D-UX4-100) */
/**
 * D-UX4-100: 시뮬레이터 화면(우리)과 토스 사진을 같은 pt로 나란히 재어 다시 맞춤 — 글자 폭·높이로 줄 이름 16(옛 17)·제목 21(옛 22)·오른쪽 값 15,
 * 글자 왼쪽 끝 22(잉크 22.5 — 토스 22.6~23), 제목↔첫 줄 가운데 58·뒤로↔제목 가운데 65(titleTop 12·titleBottom 21), 줄 44 · 켜고 끄는 줄 49.
 */
/**
 * D-UX4-130 (사용자 지시 2026-11-12 "사진 1(토스), 2(라이브지니) 비교해보면 텍스트 크기, 두께, 간격, 여백이 다르다. 토글 버튼 디자인도 똑같이"):
 * 같은 휴대폰(폭 430pt)으로 찍은 두 사진을 나란히 재니 글자 크기(한 글자 폭·높이)는 같고, 다른 것은 —
 * 글자 왼쪽 끝이 토스보다 2 왼쪽(→ 24), 줄 간격 44 → 48, 켜고 끄는 줄 49 → 54, 제목이 6 위(titleTop 12 → 18), 제목↔첫 줄 3 좁음(titleBottom 21 → 24),
 * 큰 제목 줄기가 토스보다 가늘어(1.8 : 2.3) 아주 굵게(heavy). 옛 D-UX4-100은 토스 사진 폭을 393pt로 잘못 알고 재었다.
 */
export const PLAIN = { side: 24, title: 21, titleTop: 18, titleBottom: 24, label: 16, value: 15, ink: '#4F545E', chevron: '#90969E', row: 48, weight: 'book', titleWeight: 'heavy' } as const

/** 흰 화면 맨 위 큰 제목 (토스 "비밀번호 · 보안") */
export function PlainTitle({ title }: { readonly title: string }) {
  return (
    <View style={{ paddingHorizontal: PLAIN.side, paddingTop: PLAIN.titleTop, paddingBottom: PLAIN.titleBottom }}>
      <Txt step="pageTitle" weight={PLAIN.titleWeight} role="heading" aria-level={1}>
        {title}
      </Txt>
    </View>
  )
}

/** 흰 화면 줄 하나: 이름 · (오른쪽 값·조각) · ›. onPress가 없으면 누를 수 없는 정보 줄(› 없음). danger면 빨간 이름 */
export function PlainRow({ title, value, right, onPress, danger, testID, ariaLabel }: { readonly title: string; readonly value?: string; readonly right?: ReactNode; readonly onPress?: () => void; readonly danger?: boolean; readonly testID?: string; readonly ariaLabel?: string }) {
  const { p } = useKit()
  const body = (
    <>
      <View style={{ flex: 1 }}>
        <Txt step="bodyLarge" weight={PLAIN.weight} ink={danger === true ? p.dangerText : PLAIN.ink} numberOfLines={1}>
          {title}
        </Txt>
      </View>
      {value === undefined ? null : (
        <Txt step="body" weight="regular" color="primaryText" numberOfLines={1}>
          {value}
        </Txt>
      )}
      {right}
    </>
  )
  const frame = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACE.sm, minHeight: PLAIN.row, paddingHorizontal: PLAIN.side }
  if (onPress === undefined) {
    return (
      <View testID={testID} aria-label={ariaLabel ?? (value === undefined ? title : `${title} ${value}`)} style={frame}>
        {body}
      </View>
    )
  }
  return (
    // 누르면 화면 끝에서 12 들어온 둥근 바탕 — 자동 감사 채팅 켜고 끄는 줄(ToggleRow)의 눌림과 같다
    <Tap role="button" aria-label={ariaLabel ?? title} testID={testID} onPress={onPress} style={({ pressed }) => ({ ...frame, marginHorizontal: PLAIN.side / 2, paddingLeft: PLAIN.side / 2, paddingRight: PLAIN.side / 2 - 6, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
      {body}
      <Icon name="chevron" color={PLAIN.chevron} size={20} />
    </Tap>
  )
}
