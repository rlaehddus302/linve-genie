// 아래에서 올라오는 판: BottomSheet(내용 자유), ConfirmSheet(확인 질문). 닫기 단추가 늘 있다 — 끌어내리기만으로 되는 일은 없다.
// 움직임 (D-UX3-05): 뒤 어두운 막은 제자리에서 서서히 짙어지고(페이드), 판만 아래에서 올라온다 — 막이 판과 함께 밀려 올라오지 않게.
// 닫을 때도 막은 서서히 걷히고 판은 내려간 뒤 사라진다. 키보드가 뜨면 판이 키보드 위로 올라간다(입력 칸이 가려지지 않게).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AccessibilityInfo, Animated, Easing, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native'
import { BigButton } from './buttons.tsx'
import { BACKDROP_OPACITY, RADIUS, SHADOW, SPACE } from './tokens.ts'
import { Txt, useBottomInset, useKit, useTopInset } from './theme.tsx'
import { AppHeader } from './app.tsx'

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
  readonly title: string
  readonly children?: ReactNode
  /** 화면 맨 아래 고정 단추들 — 키보드가 뜨면 키보드 바로 위로 올라온다 */
  readonly actions?: ReactNode
  readonly closeLabel?: string
  readonly testID?: string
}

/**
 * 전체 화면 판 (D-UX3-06): 입력이 있는 일(새 방송·방송 연결)은 아래 판 대신 화면 전체로 — 위에 뒤로 단추와 제목, 가운데 내용(스크롤),
 * 맨 아래 단추. 키보드가 뜨면 내용과 단추가 키보드 위로 올라와 입력 칸이 가려지지 않는다. 화면 전체가 아래에서 올라온다(뒤 막 없음).
 */
export function FullSheet({ visible, onClose, title, children, actions, closeLabel = '닫기', testID }: FullSheetProps) {
  const { p } = useKit()
  const inset = useBottomInset()
  const top = useTopInset()
  return (
    <Modal visible={visible} animationType={Platform.OS === 'web' ? 'none' : 'slide'} onRequestClose={onClose} statusBarTranslucent presentationStyle="fullScreen">
      <View role="dialog" aria-modal aria-label={title} testID={testID} style={{ flex: 1, backgroundColor: p.background, paddingTop: top }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <AppHeader title={title} onBack={onClose} backLabel={closeLabel} />
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SPACE.lg, paddingTop: SPACE.sm, paddingBottom: SPACE.xxl, gap: SPACE.lg }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {actions === undefined ? null : <View style={{ paddingHorizontal: SPACE.lg, paddingTop: SPACE.sm, paddingBottom: Math.max(inset, SPACE.md) + SPACE.xs, gap: SPACE.sm, backgroundColor: p.background }}>{actions}</View>}
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
