// 아래 창 (D-UX4-76, 사용자 지시 2026-11-10 토스 "비밀번호 인증" 사진): 앱의 모든 아래에서 올라오는 판은 이 모듈 하나 — BottomSheet(내용 자유), ConfirmSheet(확인 질문).
// 모양: 화면 양옆·아래에서 GUTTER(12)만큼 떨어져 뜬 흰 둥근 카드(모서리 28, 네 귀 모두) — 뒤 회색 화면의 흰 묶음과 같은 줄에 선다. 맨 위 가운데 옅은 회색 손잡이(40×5).
// 손맛: 손잡이·제목을 잡고(내용이 넘치지 않으면 카드 어디든) 아래로 끌면 손가락을 따라 내려오고, 충분히 내렸거나 빠르게 튕기면 닫힌다(아니면 제자리로).
// 카드의 단추 아닌 곳을 꾹 누르면 단추처럼 카드 전체가 살짝(0.98) 들어갔다 돌아온다. 아래 단추를 주면 카드 바닥에 붙어 있고(내용만 스크롤) 단추의 옆·아래 여백이 같다.
// 닫기 단추는 없다 (D-UX4-103, 사용자 지시 2026-11-10 "모든 아래팝업의 닫기 버튼을 없애") — 끌어내리기·바깥 누르기·안드로이드 뒤로로 닫는다. 단추를 안 주면 단추 줄도 없다.
// 닫히는 동안에는 열려 있던 마지막 모습(제목·내용·단추)을 그대로 보인다 (D-UX4-103 "닫을 때 안에 내용이 사라져서 닫김") — 부르는 쪽이 닫으며 내용을 비워도 빈 카드가 내려가지 않게.
// 반 화면 판(half, D-UX4-106): 화면 양옆·아래에 붙고 위 두 귀만 둥근 흰 판 — 화면 높이의 절반 이상. 웹(시험)은 움직이지 않는다.
// 움직임 (D-UX3-05): 뒤 어두운 막은 제자리에서 서서히 짙어지고(페이드), 판만 아래에서 올라온다 — 막이 판과 함께 밀려 올라오지 않게.
// 닫을 때도 막은 서서히 걷히고 판은 내려간 뒤 사라진다. 키보드가 뜨면 판이 키보드 위로 올라간다(입력 칸이 가려지지 않게).
import { Children, useEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import { AccessibilityInfo, ActivityIndicator, Animated, Easing, Keyboard, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, Text, View, useWindowDimensions, type GestureResponderHandlers, type ScrollViewInstance } from 'react-native'
import { BigButton, ButtonRow } from './buttons.tsx'
import { BACKDROP_OPACITY, GUTTER, PAGE, RADIUS, SPACE, WEIGHT } from './tokens.ts'
import { PageTopProvider, Txt, useBottomInset, useKit, usePageTop, useTopInset, useWhiteTop } from './theme.tsx'
import { font } from './font.ts'
import { NAV, NavBar } from './app.tsx'
import { Tap, usePressMotion } from './press.tsx'

export interface BottomSheetProps {
  readonly visible: boolean
  readonly onClose: () => void
  /** 굵은 큰 제목 (보조 기술에 읽히는 창 이름). 빈 글이면 제목 줄이 없다 */
  readonly title: string
  /** 제목 아래 회색 설명 한 줄 (토스 "비밀번호 인증" 아래 글) */
  readonly description?: string
  readonly children?: ReactNode
  /** 판 맨 아래 고정 단추들 (BigButton). 없으면 단추 줄도 없다 — 닫기 단추는 붙이지 않는다 (D-UX4-103) */
  readonly actions?: ReactNode
  /**
   * 반 화면 판 (D-UX4-106): 화면 양옆·아래 끝까지 붙은 흰 판 — 위 두 귀만 둥글고(SHEET.radius), 높이는 화면의 절반 이상, 내용 자리가 남는 높이를 채운다.
   * 키보드가 없으면 홈 표시줄 자리만큼 아래를 비우고(흰 바탕은 화면 끝까지), 키보드가 뜨면 판이 키보드 위로 올라간다.
   * 열린 채로 바꿔도 모양만 다시 놓인다 — 안의 입력 칸이 새로 만들어지지 않아 커서가 그대로다.
   */
  readonly half?: boolean
  /** 내용 자리 안쪽 여백(양옆 24)·줄 사이(12). false면 둘 다 없다 — 숫자판처럼 끝까지 붙는 내용을 부르는 쪽이 직접 놓는다 (기본 true) */
  readonly bodyPadding?: boolean
  readonly testID?: string
}

export const SHEET_IN_MS = 260
export const SHEET_OUT_MS = 200

/**
 * 아래 창 치수 (D-UX4-76, 토스 사진을 재어): 카드 모서리 28 · 손잡이 40×5(위에서 10) · 글 안쪽 여백 24(제목·내용·고르기 줄 글이 한 줄에 선다) ·
 * 아래 단추는 카드 안에서 옆·아래 모두 16. 단추가 없으면 내용 아래를 글 옆 여백과 같은 24만큼 띄운다 (D-UX4-103).
 * 반 화면 판은 화면 높이의 halfMin(절반) 이상 (D-UX4-106).
 */
export const SHEET = { radius: 28, handleWidth: 40, handleHeight: 5, handleTop: 10, side: PAGE.side, buttonInset: SPACE.lg, end: PAGE.side, halfMin: 0.5 } as const

/** 카드 단추 아닌 곳을 꾹 누르면 줄어드는 비율 (단추 0.97보다 덜 — 큰 판이라) */
export const SHEET_PRESS_SCALE = 0.98

/** 카드 아래 여백: 화면 양옆 여백(GUTTER)과 같게 — 홈 표시줄 안전 영역이 더 크면 그만큼. 키보드가 떠 있으면 키보드 위 GUTTER */
export function sheetBottomGap(bottomInset: number, keyboard = false): number {
  return keyboard ? GUTTER : Math.max(bottomInset, GUTTER)
}

/** 끌어내려 닫는 거리(카드 높이의 1/3, 최대 96)와 튕김 빠르기(pt/ms). 손가락이 이만큼 움직이기 전에는 끌기가 아니다 */
export const SHEET_DRAG = { close: 96, flick: 0.9, start: 6 } as const

/** 끌기를 놓았을 때 닫을지: 충분히 내렸거나, 아래로 빠르게 튕겼으면 닫는다 */
export function sheetDragCloses(dy: number, vy: number, cardHeight: number): boolean {
  const far = cardHeight > 0 ? Math.min(SHEET_DRAG.close, cardHeight / 3) : SHEET_DRAG.close
  return dy > far || (vy > SHEET_DRAG.flick && dy > SHEET_DRAG.start)
}

/**
 * 닫히는 동안 붙잡아 두기 (D-UX4-103): 열려 있는 동안은 받은 값을 그대로 쓰고, 닫히기 시작하면(visible이 false) 열려 있던 마지막 값을 돌려준다.
 * 부르는 쪽은 흔히 닫으면서 내용도 비운다(`visible={x !== null}` · `{x ? <내용 /> : null}`) — 닫히는 움직임(200ms) 동안 빈 카드가 보이지 않게.
 * 다시 열리면 새 값을 쓴다. 붙잡은 내용 요소는 같은 요소라 다시 그리지도 않는다.
 */
export function useHeldWhileClosing<T>(visible: boolean, value: T): T {
  const held = useRef(value)
  if (visible) held.current = value
  return held.current
}

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

interface SheetGesture {
  /** 끌어내린 거리 */
  readonly drag: Animated.Value
  /** 꾹 누른 정도 0 → 1 */
  readonly pressed: Animated.Value
  /** 손잡이·제목 자리: 늘 끌 수 있다 */
  readonly head: GestureResponderHandlers
  /** 카드 전체: 꾹 누름 + 내용이 넘치지 않을 때만 끌기 */
  readonly card: GestureResponderHandlers
  readonly setCardHeight: (height: number) => void
  readonly setScrollable: (scrollable: boolean) => void
}

/**
 * 끌어내려 닫기 + 꾹 누름. 단추가 먼저 누름을 가져가고(안쪽부터 묻는다), 단추 위에서 시작해도 아래로 끌면 카드가 넘겨받는다.
 * 내용이 스크롤되면 내용 위 끌기는 스크롤에 맡기고 손잡이·제목 자리만 끈다. 웹(시험)은 손 처리 없음.
 */
function useSheetGesture(visible: boolean, onClose: () => void): SheetGesture {
  const press = usePressMotion()
  const drag = useRef(new Animated.Value(0)).current
  const state = useRef({ owned: false, dragging: false, height: 0, scrollable: false, visible, onClose })
  useEffect(() => {
    state.current.visible = visible
    state.current.onClose = onClose
  })
  useEffect(() => {
    if (visible) drag.setValue(0)
  }, [visible, drag])
  const [made] = useState(() => {
    const springBack = () => Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 18 }).start()
    const finish = (dy: number, vy: number) => {
      const s = state.current
      const was = s.dragging
      s.owned = false
      s.dragging = false
      press.pressOut()
      if (!was) return
      if (!sheetDragCloses(dy, vy, s.height)) {
        springBack()
        return
      }
      s.onClose()
      // 닫지 않기로 한 화면이면 제자리로 돌아온다
      setTimeout(() => {
        if (state.current.visible) springBack()
      }, SHEET_OUT_MS + 80)
    }
    const downward = (dx: number, dy: number) => dy > SHEET_DRAG.start && Math.abs(dy) > Math.abs(dx) * 1.5
    const make = (always: boolean) => {
      const wantsDrag = (dx: number, dy: number) => !state.current.owned && (always || !state.current.scrollable) && downward(dx, dy)
      return PanResponder.create({
        onStartShouldSetPanResponder: () => !state.current.owned,
        onMoveShouldSetPanResponderCapture: (_event, g) => wantsDrag(g.dx, g.dy),
        onMoveShouldSetPanResponder: (_event, g) => wantsDrag(g.dx, g.dy),
        onPanResponderGrant: () => {
          state.current.owned = true
          press.pressIn()
        },
        onPanResponderMove: (_event, g) => {
          const s = state.current
          if (!s.dragging && (always || !s.scrollable) && downward(g.dx, g.dy)) {
            s.dragging = true
            press.pressOut()
          }
          // 위로는 조금만 따라온다
          if (s.dragging) drag.setValue(g.dy >= 0 ? g.dy : Math.max(g.dy / 5, -SPACE.md))
        },
        onPanResponderTerminationRequest: () => !state.current.dragging,
        onPanResponderRelease: (_event, g) => finish(g.dy, g.vy),
        onPanResponderTerminate: () => finish(0, 0),
      }).panHandlers
    }
    return { head: make(true), card: make(false) }
  })
  const web = Platform.OS === 'web'
  return {
    drag,
    pressed: press.value,
    head: web ? {} : made.head,
    card: web ? {} : made.card,
    setCardHeight: (height) => {
      state.current.height = height
    },
    setScrollable: (scrollable) => {
      state.current.scrollable = scrollable
    },
  }
}

const hasContent = (children: ReactNode) => Children.toArray(children).length > 0

export function BottomSheet({ visible, onClose, testID, ...look }: BottomSheetProps) {
  const { p } = useKit()
  const inset = useBottomInset()
  const top = useTopInset()
  const keyboard = useKeyboardShown()
  const { height } = useWindowDimensions()
  const { mounted, progress } = useSheetMotion(visible)
  const gesture = useSheetGesture(visible, onClose)
  // 닫히는 동안은 열려 있던 마지막 모습 그대로 (D-UX4-103)
  const { title, description, children, actions, half = false, bodyPadding = true } = useHeldWhileClosing(visible, look)
  const viewHeight = useRef(0)
  const contentHeight = useRef(0)
  // 반 화면 판은 화면 끝에 붙는다 — 아래 띄움 없이 홈 표시줄 자리만 판 안에서 비운다(키보드가 뜨면 키보드 위라 0) (D-UX4-106)
  const gap = half ? 0 : sheetBottomGap(inset, keyboard)
  const backdrop = progress.interpolate({ inputRange: [0, 1], outputRange: [0, BACKDROP_OPACITY] })
  const rise = progress.interpolate({ inputRange: [0, 1], outputRange: [height, 0] })
  // 화면 끝에 붙은 반 화면 판은 꾹 눌러도 줄지 않는다 (양옆이 떨어져 보이지 않게)
  const scale = gesture.pressed.interpolate({ inputRange: [0, 1], outputRange: [1, half ? 1 : SHEET_PRESS_SCALE] })
  const body = hasContent(children)
  const headed = title !== '' || (description !== undefined && description !== '')
  const footed = actions !== undefined && actions !== null
  const measure = () => gesture.setScrollable(contentHeight.current > viewHeight.current + 1)
  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={KEYBOARD_AVOID} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View pointerEvents="box-none" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: p.backdrop, opacity: backdrop }}>
          {/* 누름 예외: 시트 바깥 (D-UX4-72) */}
          <Pressable aria-label="판 닫기" role="button" onPress={onClose} style={{ flex: 1 }} />
        </Animated.View>
        {/* half를 바꿔도 같은 요소 나무 — 모양(style)만 바뀌어 안의 입력 칸이 그대로 남는다 (D-UX4-106) */}
        <Animated.View
          role="dialog"
          aria-modal
          aria-label={title}
          testID={testID}
          {...gesture.card}
          onLayout={(event) => gesture.setCardHeight(event.nativeEvent.layout.height)}
          style={{
            marginHorizontal: half ? 0 : GUTTER,
            marginBottom: gap,
            paddingBottom: half && !keyboard ? inset : 0,
            minHeight: half ? Math.round(height * SHEET.halfMin) : undefined,
            maxHeight: Math.min(height * 0.92, height - top - gap - SPACE.xl),
            backgroundColor: p.surface,
            borderTopLeftRadius: SHEET.radius,
            borderTopRightRadius: SHEET.radius,
            borderBottomLeftRadius: half ? 0 : SHEET.radius,
            borderBottomRightRadius: half ? 0 : SHEET.radius,
            borderCurve: 'continuous',
            overflow: 'hidden',
            transform: [{ translateY: Animated.add(rise, gesture.drag) }, { scale }],
          }}
        >
          <View {...gesture.head} style={{ paddingTop: SHEET.handleTop, paddingBottom: body || footed ? 0 : SHEET.end }}>
            <View aria-hidden testID="sheet-handle" style={{ alignSelf: 'center', width: SHEET.handleWidth, height: SHEET.handleHeight, borderRadius: SHEET.handleHeight / 2, borderCurve: 'continuous', backgroundColor: p.soft }} />
            {headed ? (
              <View style={{ paddingHorizontal: SHEET.side, paddingTop: SPACE.lg - SPACE.xs, gap: SPACE.sm - 2 }}>
                {title !== '' ? (
                  <Txt step="headline" weight="bold" role="heading" aria-level={2}>
                    {title}
                  </Txt>
                ) : null}
                {description !== undefined && description !== '' ? (
                  <Txt step="body" color="textSub">
                    {description}
                  </Txt>
                ) : null}
              </View>
            ) : null}
          </View>
          {body ? (
            <ScrollView
              testID="sheet-body"
              // 반 화면 판은 내용 자리가 남는 높이를 채운다 (D-UX4-106)
              style={{ flexGrow: half ? 1 : 0, flexShrink: 1 }}
              contentContainerStyle={{
                flexGrow: half ? 1 : 0,
                paddingHorizontal: bodyPadding ? SHEET.side : 0,
                paddingTop: headed ? SPACE.xl : SPACE.md,
                // 단추 줄이 없으면 내용 아래를 글 옆 여백만큼 띄운다 (D-UX4-103)
                paddingBottom: footed ? SPACE.xs : SHEET.end,
                gap: bodyPadding ? SPACE.md : 0,
              }}
              keyboardShouldPersistTaps="handled"
              onLayout={(event) => {
                viewHeight.current = event.nativeEvent.layout.height
                measure()
              }}
              onContentSizeChange={(_width, h) => {
                contentHeight.current = h
                measure()
              }}
            >
              {children}
            </ScrollView>
          ) : null}
          {footed ? (
            <View testID="sheet-actions" style={{ paddingHorizontal: SHEET.buttonInset, paddingTop: body ? SPACE.md : SPACE.xxl, paddingBottom: SHEET.buttonInset }}>
              <ButtonRow>{actions}</ButtonRow>
            </View>
          ) : null}
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
  /** 제목 아래 회색 설명 (FormPage와 같다) */
  readonly description?: string
  /** 설명 아래 작은 곁길 단추 (FormPage와 같다) */
  readonly headerAction?: ReactNode
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

/**
 * 키보드 피하기 방식 (D-UX3-67): 아이폰·안드로이드 모두 'padding'(키보드 높이만큼 아래를 비워 단추를 키보드 위로 올린다).
 * 안드로이드는 화면 끝까지 그리기(edge-to-edge, RN 0.88·targetSdk 36 기본)라 창이 키보드만큼 줄지 않는다 — 'padding'이 없으면 아래 단추가 키보드에 가린다.
 * 창이 줄어드는 옛 기기에서도 KeyboardAvoidingView는 겹친 만큼만 비우므로(겹침 0이면 0) 두 번 올라가지 않는다. 웹은 키보드가 창을 줄인다.
 */
export function keyboardAvoidFor(os: string): 'padding' | undefined {
  return os === 'web' ? undefined : 'padding'
}
export const KEYBOARD_AVOID = keyboardAvoidFor(Platform.OS)

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
  /** 큰 질문형 제목 ("어떤 방송인가요?") — 줄바꿈(\n)을 그대로 보인다 */
  readonly title: string
  /** 제목 아래 회색 설명 (D-UX4-112 — 라이브 링크 화면 "링크만 알려주시면 …") */
  readonly description?: string
  /** 설명 아래 작은 곁길 단추 (D-UX4-113 — 토스 "토스인증서 · 자세히 보기" 자리: [링크를 모르겠어요]) */
  readonly headerAction?: ReactNode
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
export function FormPage({ title, description, headerAction, name, onBack, backLabel = '뒤로', children, actions, cards = false, overlay, sticky, scrollRef, testID }: FormPageProps) {
  const { p } = useKit()
  const inset = useBottomInset()
  // 상태 막대를 피할 높이 — 경로가 이미 피했으면 0, 판(FullSheet)·상태 막대까지 그리는 경로면 기기 값 (D-UX4-41)
  const top = usePageTop()
  const keyboard = useKeyboardShown()
  // 흰 화면이면 상태 막대 자리도 흰색 (D-UX4-97)
  useWhiteTop(!cards)
  const bg = cards ? p.background : p.surface
  return (
    <View role="dialog" aria-label={name ?? title} testID={testID} style={{ flex: 1, backgroundColor: bg, paddingTop: top }}>
      <KeyboardAvoidingView behavior={KEYBOARD_AVOID} style={{ flex: 1 }}>
        {/* 뒤로 자리는 모든 쌓인 화면과 같은 머리 (D-UX4-40) */}
        <NavBar onBack={onBack} backLabel={backLabel} />
        <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: PAGE.side, paddingTop: PAGE.titleTop - NAV.below, paddingBottom: SPACE.xxl, gap: SPACE.xxl }} keyboardShouldPersistTaps="handled" stickyHeaderIndices={sticky === undefined ? undefined : [1]}>
          <View style={{ paddingBottom: PAGE.titleGap - SPACE.xxl, gap: SPACE.sm }}>
            <Txt step="headline" weight="bold" role="heading" aria-level={1}>
              {title}
            </Txt>
            {description === undefined || description === '' ? null : (
              <Txt step="body" color="textSub" testID="form-description">
                {description}
              </Txt>
            )}
            {headerAction === undefined || headerAction === null ? null : <View style={{ paddingTop: SPACE.md, alignItems: 'flex-start' }}>{headerAction}</View>}
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
export function FullSheet({ visible, onClose, testID, ...look }: FullSheetProps) {
  const top = useTopInset()
  // 아이폰은 판이 미끄러져 내려가는 동안에도 안을 그린다 — 닫히는 동안은 열려 있던 마지막 모습 그대로 (D-UX4-103)
  const { title, description, headerAction, name, children, actions, closeLabel = '닫기', cards, overlay } = useHeldWhileClosing(visible, look)
  return (
    <Modal visible={visible} animationType={Platform.OS === 'web' ? 'none' : 'slide'} onRequestClose={onClose} statusBarTranslucent presentationStyle="fullScreen">
      {/* 판은 화면 맨 위(상태 막대 자리)부터 그린다 — 기기 값만큼 띄운다 (D-UX4-41) */}
      <PageTopProvider value={top}>
        <FormPage title={title} {...(description === undefined ? {} : { description })} headerAction={headerAction} name={name} onBack={onClose} backLabel={closeLabel} actions={actions} cards={cards} overlay={overlay} testID={testID}>
          {children}
        </FormPage>
      </PageTopProvider>
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
      description={description}
      actions={
        <>
          <BigButton kind="secondary" label={cancelLabel} onPress={onCancel} />
          <BigButton kind={danger === true ? 'danger' : 'primary'} label={confirmLabel} onPress={onConfirm} busy={busy} />
        </>
      }
    />
  )
}

export interface PopupDialogProps {
  readonly visible: boolean
  /** 묻는 말 — 줄바꿈(\n)을 그대로 보인다 */
  readonly message: string
  /** 묻는 말 아래 회색 설명 (토스 "문자를 다시 받을까요?") */
  readonly description?: string | null
  /** 긍정 단추를 잠시 끈다 (예: 다시 받기까지 남은 초) */
  readonly confirmDisabled?: boolean
  /** 보조 기술에 읽히는 이름 — 없으면 묻는 말 */
  readonly name?: string
  /** 긍정 단추 (오른쪽) */
  readonly confirmLabel: string
  /** 부정 단추 (왼쪽) */
  readonly cancelLabel: string
  readonly busy?: boolean
  /** 되돌릴 수 없는 일이면 오른쪽 긍정 단추만 빨간 바탕 (예: "방송 연결 끊기") — 나머지 모양은 그대로 */
  readonly danger?: boolean
  /**
   * 묻는 말 자리에 대신 그릴 것 (D-UX4-103) — 몇 낱말만 강조한 글처럼 글자 하나로 못 쓰는 묻는 말. 보통 Txt(step="lead" weight="bold") 안에 강조 Txt를 섞는다.
   * 주면 message는 화면에 그리지 않고 보조 기술에 읽히는 이름으로만 쓴다(name이 없을 때).
   */
  readonly content?: ReactNode
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

/**
 * 가운데 뜨는 확인 팝업 (D-UX4-02, 사용자 지시 2026-11-03 "이러한 알림은 별도 팝업으로"): 화면 안에 확인 줄을 끼워 넣지 않고 그 위에 띄운다.
 * 흰 둥근 판에 묻는 말, 아래 단추 둘 — 왼쪽 부정(회색), 오른쪽 긍정(주색) (D-UX4-01). 뒤 막은 서서히 짙어지고 판은 살짝 커지며 나타난다.
 * 바깥을 누르거나 뒤로 가기는 부정과 같다.
 */
/**
 * 가운데 팝업 크기 (D-UX3-56, 사용자 지시 2026-11-07 "팝업 안 버튼 크기가 토스보다 작음"): 사진을 찍은 휴대폰이 폭 430(15 Pro Max)인데 393으로 재 9% 작았다.
 * 다시 재어 폭 320·둘레 16·모서리 24·제목 위 22·글 왼쪽 22 (옛 D-UX3-54 폭 292·둘레 14·모서리 20).
 */
const POPUP_WIDTH = 320
const POPUP_EDGE = 16
const POPUP_TOP = 22
const POPUP_TEXT_SIDE = 22
/** 팝업 뒤 어둡기·단추 (D-UX3-55, 사용자 지시 2026-11-07 "팝업 띄울 때 배경 어두워지는 정도, 팝업 및 버튼 가로세로, 버튼 색깔, 버튼 안 글자 크기, 두께, 색깔 다 맞춰" — 토스 사진을 재어: 뒤 0.22, 단추 높이 44·모서리 12·글자 17 두께 600, 왼쪽 단추 연회색 바탕 #F2F4F6에 회색 글자) */
export const POPUP_DIM = 0.22
/** 단추 높이 47 (D-UX3-56 다시 재어 — 옛 44). 폭은 둘이 나눠 140 */
const POPUP_BUTTON_HEIGHT = 47
const POPUP_BUTTON_TEXT = 15 // D-UX3-74: 17에서 한 단계 줄임

/** 팝업 안 단추 — 큰 단추보다 낮고 글자가 덜 굵다 (토스 팝업 단추) */
function PopupButton({ label, kind, disabled, busy, onPress }: { readonly label: string; readonly kind: 'cancel' | 'confirm' | 'danger'; readonly disabled?: boolean; readonly busy?: boolean; readonly onPress: () => void }) {
  const { p } = useKit()
  const off = disabled === true || busy === true
  const fill = kind === 'confirm' ? p.primary : kind === 'danger' ? p.danger : p.surfaceAlt
  const fillPressed = kind === 'confirm' ? p.primaryPressed : kind === 'danger' ? p.dangerPressed : p.pressed
  const ink = kind === 'confirm' ? p.onPrimary : kind === 'danger' ? p.onDanger : p.textSub
  return (
    <Tap
      role="button"
      aria-label={label}
      aria-disabled={off}
      aria-busy={busy === true}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => ({ height: POPUP_BUTTON_HEIGHT, borderRadius: RADIUS.md, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: SPACE.sm, backgroundColor: pressed && !off ? fillPressed : fill, opacity: disabled === true ? 0.45 : 1 })}
    >
      {busy === true ? <ActivityIndicator color={ink} /> : null}
      <Text allowFontScaling={false} numberOfLines={1} style={{ fontSize: POPUP_BUTTON_TEXT, lineHeight: Math.round(POPUP_BUTTON_TEXT * 1.3), ...font(WEIGHT.medium), color: ink }}>
        {label}
      </Text>
    </Tap>
  )
}

export function PopupDialog({ visible, confirmDisabled, busy, onConfirm, onCancel, ...look }: PopupDialogProps) {
  const { p } = useKit()
  // 닫히는 동안은 열려 있던 마지막 글·단추 이름 그대로 (D-UX4-103) — 부르는 쪽이 닫으며 묻는 말을 비워도 빈 판이 사라지지 않게
  const { message, name, description, content, confirmLabel, cancelLabel, danger } = useHeldWhileClosing(visible, look)
  const { mounted, progress } = useSheetMotion(visible)
  const backdrop = progress.interpolate({ inputRange: [0, 1], outputRange: [0, POPUP_DIM] })
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] })
  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onCancel} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: SPACE.xxl }}>
        <Animated.View pointerEvents="box-none" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: p.backdrop, opacity: backdrop }}>
          {/* 누름 예외: 시트 바깥 (D-UX4-72) */}
          <Pressable aria-label="팝업 닫기" role="button" onPress={onCancel} style={{ flex: 1 }} />
        </Animated.View>
        <Animated.View
          role="alertdialog"
          aria-modal
          aria-label={name ?? message}
          style={{ width: '100%', maxWidth: POPUP_WIDTH, alignSelf: 'center', backgroundColor: p.surface, borderRadius: RADIUS.xxl, borderCurve: 'continuous', paddingTop: POPUP_TOP, paddingHorizontal: POPUP_EDGE, paddingBottom: POPUP_EDGE, gap: SPACE.xxl - SPACE.xs, opacity: progress, transform: [{ scale }] }}
        >
          {/* 제목 20 굵게 (D-UX3-54, 사용자 지시 2026-11-07 "팝업 안에 제목 글자 크기가 내가 보내줬던 사진과 다름" — 토스 사진을 재어, 옛 18) */}
          <View style={{ gap: SPACE.sm, paddingHorizontal: POPUP_TEXT_SIDE - POPUP_EDGE }}>
            {content ?? (
              <Txt step="lead" weight="bold">
                {message}
              </Txt>
            )}
            {description === undefined || description === null ? null : <Txt color="textSub">{description}</Txt>}
          </View>
          <ButtonRow>
            <PopupButton kind="cancel" label={cancelLabel} disabled={busy} onPress={onCancel} />
            <PopupButton kind={danger === true ? 'danger' : 'confirm'} label={confirmLabel} busy={busy} disabled={confirmDisabled} onPress={onConfirm} />
          </ButtonRow>
        </Animated.View>
      </View>
    </Modal>
  )
}
