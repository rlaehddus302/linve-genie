// 아래에서 올라오는 판: BottomSheet(내용 자유), ConfirmSheet(확인 질문). 닫기 단추가 늘 있다 — 끌어내리기만으로 되는 일은 없다.
// 움직임 (D-UX3-05): 뒤 어두운 막은 제자리에서 서서히 짙어지고(페이드), 판만 아래에서 올라온다 — 막이 판과 함께 밀려 올라오지 않게.
// 닫을 때도 막은 서서히 걷히고 판은 내려간 뒤 사라진다. 키보드가 뜨면 판이 키보드 위로 올라간다(입력 칸이 가려지지 않게).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AccessibilityInfo, Animated, Easing, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native'
import { BigButton } from './buttons.tsx'
import { BACKDROP_OPACITY, RADIUS, SHADOW, SPACE } from './tokens.ts'
import { Txt, useBottomInset, useKit, useTopInset } from './theme.tsx'
import { Icon } from './app.tsx'

export interface BottomSheetProps {
  readonly visible: boolean
  readonly onClose: () => void
  readonly title: string
  readonly children?: ReactNode
  /** 판 맨 아래 고정 단추들 (BigButton). 없으면 "닫기" 하나가 붙는다. */
  readonly actions?: ReactNode
  readonly testID?: string
}

export const SHEET_IN_MS = 260
export const SHEET_OUT_MS = 200

/** 열고 닫는 움직임: 0 = 닫힘, 1 = 열림. 닫히는 움직임이 끝나야 판을 내린다. 웹(시험)·움직임 줄이기는 바로 */
function useSheetMotion(visible: boolean): { readonly mounted: boolean; readonly progress: Animated.Value } {
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
    AccessibilityInfo.isReduceMotionEnabled().then(
      (reduce) => go(reduce),
      () => go(false),
    )
    function go(reduce: boolean) {
      if (!alive) return
      Animated.timing(progress, {
        toValue: visible ? 1 : 0,
        duration: reduce ? 0 : visible ? SHEET_IN_MS : SHEET_OUT_MS,
        easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (alive && finished && !visible) setMounted(false)
      })
    }
    return () => {
      alive = false
    }
  }, [visible, instant, progress])
  return { mounted: instant ? visible : mounted, progress }
}

export function BottomSheet({ visible, onClose, title, children, actions, testID }: BottomSheetProps) {
  const { p } = useKit()
  const inset = useBottomInset()
  const { height } = useWindowDimensions()
  const { mounted, progress } = useSheetMotion(visible)
  const backdrop = progress.interpolate({ inputRange: [0, 1], outputRange: [0, BACKDROP_OPACITY] })
  const rise = progress.interpolate({ inputRange: [0, 1], outputRange: [height * 0.6, 0] })
  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View pointerEvents="box-none" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: p.backdrop, opacity: backdrop }}>
          <Pressable aria-label="판 닫기" role="button" onPress={onClose} style={{ flex: 1 }} />
        </Animated.View>
        <Animated.View
          role="dialog"
          aria-modal
          aria-label={title}
          testID={testID}
          style={{ backgroundColor: p.surface, borderTopLeftRadius: RADIUS.xxl, borderTopRightRadius: RADIUS.xxl, maxHeight: height * 0.9, paddingTop: SPACE.xxl, paddingHorizontal: SPACE.lg, paddingBottom: Math.max(inset, SPACE.md) + SPACE.md, gap: SPACE.lg, transform: [{ translateY: rise }], ...SHADOW.sheet }}
        >
          {title !== '' ? (
            <Txt step="title" weight="bold" role="heading" aria-level={2}>
              {title}
            </Txt>
          ) : null}
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: SPACE.md }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          <View style={{ gap: SPACE.sm }}>{actions ?? <BigButton kind="secondary" label="닫기" onPress={onClose} />}</View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

export interface FullSheetProps {
  readonly visible: boolean
  readonly onClose: () => void
  /** 큰 질문형 제목 ("어떤 방송인가요?") */
  readonly title: string
  /** 보조 기술에 읽히는 화면 이름 — 없으면 제목 */
  readonly name?: string
  readonly children?: ReactNode
  /** 화면 맨 아래 고정 단추 — 키보드가 뜨면 키보드 바로 위(여백 12)로 올라온다. null이면 자리도 없다 */
  readonly actions?: ReactNode
  readonly closeLabel?: string
  readonly testID?: string
}

/** 키보드가 떠 있는지 (기기에서만 바뀐다 — 웹·시험은 늘 false) */
export function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (Platform.OS === 'web') return
    const on = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setShown(true))
    const off = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setShown(false))
    return () => {
      on.remove()
      off.remove()
    }
  }, [])
  return shown
}

/**
 * 전체 화면 판 (토스 "어떤 계좌로 보낼까요?" 화면 그대로, D-UX3-06·07): 왼쪽 위 뒤로(‹)만 있는 머리 → 큰 질문 제목 → 내용(스크롤) → 맨 아래 단추.
 * 키보드가 뜨면 내용과 단추가 키보드 위로 올라와 입력 칸이 가려지지 않고, 단추와 키보드 사이는 12만 띈다. 화면 전체가 아래에서 올라온다(뒤 막 없음).
 */
export function FullSheet({ visible, onClose, title, name, children, actions, closeLabel = '닫기', testID }: FullSheetProps) {
  const { p } = useKit()
  const inset = useBottomInset()
  const top = useTopInset()
  const keyboard = useKeyboardShown()
  return (
    <Modal visible={visible} animationType={Platform.OS === 'web' ? 'none' : 'slide'} onRequestClose={onClose} statusBarTranslucent presentationStyle="fullScreen">
      <View role="dialog" aria-modal aria-label={name ?? title} testID={testID} style={{ flex: 1, backgroundColor: p.background, paddingTop: top }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: SPACE.sm, paddingTop: SPACE.sm }}>
            <Pressable role="button" aria-label={closeLabel} onPress={onClose} hitSlop={6} style={({ pressed }) => ({ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.md, backgroundColor: pressed ? p.pressed : 'transparent' })}>
              <Icon name="back" size={26} />
            </Pressable>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SPACE.xl, paddingTop: SPACE.xxxl, paddingBottom: SPACE.xxl, gap: SPACE.xxl }} keyboardShouldPersistTaps="handled">
            <Txt step="headline" weight="heavy" role="heading" aria-level={1}>
              {title}
            </Txt>
            {children}
          </ScrollView>
          {actions === undefined || actions === null ? null : <View style={{ paddingHorizontal: SPACE.xl, paddingTop: SPACE.sm, paddingBottom: keyboard ? SPACE.md : Math.max(inset, SPACE.md) + SPACE.xs, gap: SPACE.sm, backgroundColor: p.background }}>{actions}</View>}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

export interface ConfirmSheetProps {
  readonly visible: boolean
  /** 큰 질문 ("로그아웃할까요?") */
  readonly question: string
  /** 무슨 일이 일어나는지 쉬운 말로 */
  readonly description?: string
  /** 확인 단추 글: 동사로 ("로그아웃") — "확인"·"예"는 쓰지 않는다 */
  readonly confirmLabel: string
  readonly cancelLabel?: string
  /** 되돌릴 수 없는 일이면 빨갛게 */
  readonly danger?: boolean
  readonly busy?: boolean
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

export function ConfirmSheet({ visible, question, description, confirmLabel, cancelLabel = '아니요', danger, busy, onConfirm, onCancel }: ConfirmSheetProps) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onCancel}
      title={question}
      actions={
        <>
          <BigButton kind="secondary" label={cancelLabel} onPress={onCancel} />
          <BigButton kind={danger === true ? 'danger' : 'primary'} label={confirmLabel} onPress={onConfirm} busy={busy} />
        </>
      }
    >
      {description === undefined ? null : <Txt color="textSub">{description}</Txt>}
    </BottomSheet>
  )
}
