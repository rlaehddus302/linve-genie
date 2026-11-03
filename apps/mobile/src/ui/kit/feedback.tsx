// 알려 주는 조각: 상태 꼬리표(StatusChip), 알림 막대(Toast + useToast), 잠깐 뜨는 알림(PopNote, D-UX3-11).
import { useCallback, useEffect, useRef, useState } from 'react'
import { Animated, Easing, Platform, Pressable, View } from 'react-native'
import { RADIUS, SHADOW, SPACE, TOAST_MS, TOUCH, type Tone } from './tokens.ts'
import { Txt, useBottomInset, useKit, useTopInset } from './theme.tsx'

const TONE_MARK: Readonly<Record<Tone, string>> = { neutral: '•', info: '•', success: '✓', warning: '!', danger: '✕' }

/** 상태 꼬리표: 색 + 기호 + 글자. 색만으로 뜻을 전하지 않는다. */
export function StatusChip({ tone, label, testID }: { readonly tone: Tone; readonly label: string; readonly testID?: string }) {
  const { tones } = useKit()
  const pair = tones[tone]
  return (
    <View testID={testID} style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, paddingHorizontal: SPACE.md, paddingVertical: SPACE.xs, borderRadius: RADIUS.pill, borderCurve: 'continuous', backgroundColor: pair.bg }}>
      <View aria-hidden>
        <Txt step="caption" weight="heavy" ink={pair.fg}>
          {TONE_MARK[tone]}
        </Txt>
      </View>
      <Txt step="caption" weight="bold" ink={pair.fg}>
        {label}
      </Txt>
    </View>
  )
}

export interface ToastData {
  readonly id: number
  readonly message: string
  /** 되돌리기 같은 단추 글 */
  readonly actionLabel?: string
  readonly onAction?: () => void
  /** 잘못됐을 때: 저절로 사라지지 않고 "닫기"를 눌러야 사라진다 */
  readonly problem?: boolean
}

export interface ToastApi {
  readonly toast: ToastData | null
  readonly show: (message: string, options?: { readonly actionLabel?: string; readonly onAction?: () => void; readonly problem?: boolean }) => void
  readonly hide: () => void
}

/** 알림 막대 상태. 새 알림이 오면 이전 것을 대신한다. */
export function useToast(): ToastApi {
  const [toast, setToast] = useState<ToastData | null>(null)
  const next = useRef(0)
  const show = useCallback<ToastApi['show']>((message, options) => {
    next.current += 1
    setToast({ id: next.current, message, ...options })
  }, [])
  const hide = useCallback(() => setToast(null), [])
  return { toast, show, hide }
}

/**
 * 알림 막대: 아래쪽에 떠서 일어난 일을 알린다. 되돌리기 단추가 있으면 더 오래(8초) 둔다.
 * 화면 아래 고정 버튼(BottomCTA) 위에 놓으려면 bottomOffset에 그 높이를 준다.
 */
export function Toast({ toast, onDismiss, bottomOffset = 0 }: { readonly toast: ToastData | null; readonly onDismiss: () => void; readonly bottomOffset?: number }) {
  const { p } = useKit()
  const inset = useBottomInset()
  const id = toast?.id
  const sticky = toast?.problem === true
  const ms = toast?.onAction === undefined ? TOAST_MS.plain : TOAST_MS.withUndo
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss
  useEffect(() => {
    if (id === undefined || sticky) return undefined
    const timer = setTimeout(() => dismiss.current(), ms)
    return () => clearTimeout(timer)
  }, [id, sticky, ms])
  if (toast === null) return null
  const hasAction = toast.actionLabel !== undefined && toast.onAction !== undefined
  const actionLabel = hasAction ? toast.actionLabel : sticky ? '닫기' : undefined
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: SPACE.lg, right: SPACE.lg, bottom: bottomOffset + Math.max(inset, SPACE.md) + SPACE.md }}>
      <View role={sticky ? 'alert' : 'status'} aria-live={sticky ? 'assertive' : 'polite'} style={{ backgroundColor: p.toast, borderRadius: RADIUS.lg, borderCurve: 'continuous', padding: SPACE.lg, gap: SPACE.sm, ...SHADOW.toast }}>
        <Txt color="onToast">{toast.message}</Txt>
        {actionLabel === undefined ? null : (
          <Pressable
            role="button"
            aria-label={actionLabel}
            onPress={() => {
              if (hasAction) toast.onAction?.()
              onDismiss()
            }}
            style={({ pressed }) => ({ minHeight: TOUCH.min, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: SPACE.sm, borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: pressed ? 'rgba(255,255,255,0.14)' : 'transparent' })}
          >
            <Txt step="bodyLarge" weight="bold" ink={p.toastAction}>
              {actionLabel}
            </Txt>
          </Pressable>
        )}
      </View>
    </View>
  )
}

/** 잠깐 뜨는 알림이 보이는 시간 */
export const POP_NOTE_MS = 1800

/**
 * 잠깐 뜨는 알림 (D-UX3-11, "복사한 링크를 넣었어요"): 화면 위쪽 가운데에 둥근 검은 알약이 부드럽게 나타났다가 잠시 뒤 사라진다.
 * 칸 아래에 문장을 계속 두지 않는다. note가 바뀔 때마다(같은 글이라도 id가 바뀌면) 다시 뜬다.
 */
export function PopNote({ note }: { readonly note: { readonly id: number; readonly message: string } | null }) {
  const { p } = useKit()
  const top = useTopInset()
  const fade = useRef(new Animated.Value(0)).current
  const [shown, setShown] = useState<string | null>(null)
  const id = note?.id
  useEffect(() => {
    if (note === null) return undefined
    setShown(note.message)
    const native = Platform.OS !== 'web'
    fade.setValue(0)
    Animated.timing(fade, { toValue: 1, duration: 160, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start()
    const timer = setTimeout(() => {
      Animated.timing(fade, { toValue: 0, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: native }).start(({ finished }) => {
        if (finished) setShown(null)
      })
    }, POP_NOTE_MS)
    return () => clearTimeout(timer)
    // 같은 알림 id면 다시 띄우지 않는다
  }, [id])
  if (shown === null) return null
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: top + SPACE.md, alignItems: 'center' }}>
      <Animated.View role="status" aria-live="polite" style={{ opacity: fade, transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }], backgroundColor: p.toast, borderRadius: RADIUS.pill, borderCurve: 'continuous', paddingVertical: SPACE.sm + 2, paddingHorizontal: SPACE.lg, ...SHADOW.toast }}>
        <Txt step="caption" weight="bold" color="onToast">
          {shown}
        </Txt>
      </Animated.View>
    </View>
  )
}
