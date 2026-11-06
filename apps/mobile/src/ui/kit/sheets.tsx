// 아래에서 올라오는 판: BottomSheet(내용 자유), ConfirmSheet(확인 질문). 닫기 단추가 늘 있다 — 끌어내리기만으로 되는 일은 없다.
// 움직임 (D-UX3-05): 뒤 어두운 막은 제자리에서 서서히 짙어지고(페이드), 판만 아래에서 올라온다 — 막이 판과 함께 밀려 올라오지 않게.
// 닫을 때도 막은 서서히 걷히고 판은 내려간 뒤 사라진다. 키보드가 뜨면 판이 키보드 위로 올라간다(입력 칸이 가려지지 않게).
import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import { AccessibilityInfo, Animated, Easing, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View, useWindowDimensions, type ScrollViewInstance } from 'react-native'
import { BigButton, ButtonRow } from './buttons.tsx'
import { BACKDROP_OPACITY, PAGE, RADIUS, SHADOW, SPACE } from './tokens.ts'
import { Txt, useBottomInset, useKit, useTopInset } from './theme.tsx'
import { BackButton } from './app.tsx'

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
          <ButtonRow>{actions ?? <BigButton kind="secondary" label="닫기" onPress={onClose} />}</ButtonRow>
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
  /** 카드로 나뉜 내용이면 회색 바탕 */
  readonly cards?: boolean
  readonly overlay?: ReactNode
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

export interface FormPageProps {
  /** 큰 질문형 제목 ("어떤 방송인가요?") */
  readonly title: string
  /** 보조 기술에 읽히는 화면 이름 — 없으면 제목 */
  readonly name?: string
  readonly onBack: () => void
  readonly backLabel?: string
  readonly children?: ReactNode
  /** 화면 맨 아래 고정 단추 — 키보드가 뜨면 키보드 바로 위(여백 12)로 올라온다. null이면 자리도 없다 */
  readonly actions?: ReactNode
  /** 내용이 카드로 나뉘면 회색 바탕, 입력 칸·단추만 있으면 흰 바탕 (D-UX3-08) */
  readonly cards?: boolean
  /** 화면 위에 겹쳐 띄우는 것 (잠깐 뜨는 알림 PopNote 등) */
  readonly overlay?: ReactNode
  /** 제목 아래에서 스크롤해도 위에 붙어 있는 것 (라벨 꾸미기의 미리 보기 — D-UX4-05) */
  readonly sticky?: ReactNode
  /** 내용 스크롤 (눌러서 그 설정으로 옮겨 갈 때) */
  readonly scrollRef?: Ref<ScrollViewInstance>
  readonly testID?: string
}

/**
 * 입력 화면 틀 (토스 "어떤 계좌로 보낼까요?" 그대로, D-UX3-06·07·08): 왼쪽 위 뒤로(‹)만 있는 머리 → 큰 질문 제목 → 내용(스크롤) → 맨 아래 단추.
 * 바탕은 흰색(카드로 나뉜 내용이면 회색). 키보드가 뜨면 내용과 단추가 키보드 위로 올라와 입력 칸이 가려지지 않고, 단추와 키보드 사이는 12만 띈다.
 * 경로 화면(밀어서 뒤로 가기가 되는 쌓인 화면)과 FullSheet(앱 안 판)가 같이 쓴다.
 */
export function FormPage({ title, name, onBack, backLabel = '뒤로', children, actions, cards = false, overlay, sticky, scrollRef, testID }: FormPageProps) {
  const { p } = useKit()
  const inset = useBottomInset()
  const top = useTopInset()
  const keyboard = useKeyboardShown()
  const bg = cards ? p.background : p.surface
  return (
    <View role="dialog" aria-label={name ?? title} testID={testID} style={{ flex: 1, backgroundColor: bg, paddingTop: top }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        {/* 뒤로·제목 자리는 토스와 같게 (D-UX3-51) */}
        <View style={{ paddingLeft: PAGE.backLeft }}>
          <BackButton label={backLabel} onPress={onBack} />
        </View>
        <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: PAGE.side, paddingTop: PAGE.titleTop, paddingBottom: SPACE.xxl, gap: SPACE.xxl }} keyboardShouldPersistTaps="handled" stickyHeaderIndices={sticky === undefined ? undefined : [1]}>
          <View style={{ paddingBottom: PAGE.titleGap - SPACE.xxl }}>
            <Txt step="headline" weight="bold" role="heading" aria-level={1}>
              {title}
            </Txt>
          </View>
          {sticky === undefined ? null : <View style={{ backgroundColor: bg, marginHorizontal: -PAGE.side, paddingHorizontal: PAGE.side, paddingBottom: SPACE.sm }}>{sticky}</View>}
          {children}
        </ScrollView>
        {actions === undefined || actions === null ? null : (
          <View style={{ paddingHorizontal: SPACE.xl, paddingTop: SPACE.sm, paddingBottom: keyboard ? SPACE.md : Math.max(inset, SPACE.md) + SPACE.xs, backgroundColor: bg }}>
            <ButtonRow>{actions}</ButtonRow>
          </View>
        )}
      </KeyboardAvoidingView>
      {overlay}
    </View>
  )
}

/** 전체 화면 판 — FormPage를 앱 안 판(Modal)으로. 밀어서 뒤로 가기가 필요한 곳은 경로 화면으로 FormPage를 쓴다 */
export function FullSheet({ visible, onClose, title, name, children, actions, closeLabel = '닫기', cards, overlay, testID }: FullSheetProps) {
  return (
    <Modal visible={visible} animationType={Platform.OS === 'web' ? 'none' : 'slide'} onRequestClose={onClose} statusBarTranslucent presentationStyle="fullScreen">
      <FormPage title={title} name={name} onBack={onClose} backLabel={closeLabel} actions={actions} cards={cards} overlay={overlay} testID={testID}>
        {children}
      </FormPage>
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

export interface PopupDialogProps {
  readonly visible: boolean
  /** 묻는 말 — 줄바꿈(\n)을 그대로 보인다 */
  readonly message: string
  /** 보조 기술에 읽히는 이름 — 없으면 묻는 말 */
  readonly name?: string
  /** 긍정 단추 (오른쪽) */
  readonly confirmLabel: string
  /** 부정 단추 (왼쪽) */
  readonly cancelLabel: string
  readonly busy?: boolean
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

/**
 * 가운데 뜨는 확인 팝업 (D-UX4-02, 사용자 지시 2026-11-03 "이러한 알림은 별도 팝업으로"): 화면 안에 확인 줄을 끼워 넣지 않고 그 위에 띄운다.
 * 흰 둥근 판에 묻는 말, 아래 단추 둘 — 왼쪽 부정(회색), 오른쪽 긍정(주색) (D-UX4-01). 뒤 막은 서서히 짙어지고 판은 살짝 커지며 나타난다.
 * 바깥을 누르거나 뒤로 가기는 부정과 같다.
 */
export function PopupDialog({ visible, message, name, confirmLabel, cancelLabel, busy, onConfirm, onCancel }: PopupDialogProps) {
  const { p } = useKit()
  const { mounted, progress } = useSheetMotion(visible)
  const backdrop = progress.interpolate({ inputRange: [0, 1], outputRange: [0, BACKDROP_OPACITY] })
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] })
  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onCancel} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: SPACE.xxl }}>
        <Animated.View pointerEvents="box-none" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: p.backdrop, opacity: backdrop }}>
          <Pressable aria-label="팝업 닫기" role="button" onPress={onCancel} style={{ flex: 1 }} />
        </Animated.View>
        <Animated.View
          role="alertdialog"
          aria-modal
          aria-label={name ?? message}
          style={{ backgroundColor: p.surface, borderRadius: RADIUS.xxl, borderCurve: 'continuous', paddingTop: SPACE.xxl, paddingHorizontal: SPACE.xl, paddingBottom: SPACE.lg, gap: SPACE.xxl, opacity: progress, transform: [{ scale }], ...SHADOW.sheet }}
        >
          <Txt step="bodyLarge" weight="bold">
            {message}
          </Txt>
          <ButtonRow>
            <BigButton kind="outline" label={cancelLabel} disabled={busy} onPress={onCancel} />
            <BigButton label={confirmLabel} busy={busy} onPress={onConfirm} />
          </ButtonRow>
        </Animated.View>
      </View>
    </Modal>
  )
}
