// 알려 주는 조각: 상태 꼬리표(StatusChip), 알림 막대(Toast + useToast).
import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'
import { RADIUS, SHADOW, SPACE, TOAST_MS, TOUCH, type Tone } from './tokens.ts'
import { Txt, useBottomInset, useKit } from './theme.tsx'

const TONE_MARK: Readonly<Record<Tone, string>> = { neutral: '•', info: '•', success: '✓', warning: '!', danger: '✕' }

/** 상태 꼬리표: 색 + 기호 + 글자. 색만으로 뜻을 전하지 않는다. */
export function StatusChip({ tone, label, testID }: { readonly tone: Tone; readonly label: string; readonly testID?: string }) {
  const { tones } = useKit()
  const pair = tones[tone]
  return (
    <View testID={testID} style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, paddingHorizontal: SPACE.md, paddingVertical: SPACE.xs, borderRadius: RADIUS.pill, backgroundColor: pair.bg }}>
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
      <View role={sticky ? 'alert' : 'status'} aria-live={sticky ? 'assertive' : 'polite'} style={{ backgroundColor: p.toast, borderRadius: RADIUS.lg, padding: SPACE.lg, gap: SPACE.sm, ...SHADOW.toast }}>
        <Txt color="onToast">{toast.message}</Txt>
        {actionLabel === undefined ? null : (
          <Pressable
            role="button"
            aria-label={actionLabel}
            onPress={() => {
              if (hasAction) toast.onAction?.()
              onDismiss()
            }}
            style={({ pressed }) => ({ minHeight: TOUCH.min, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: SPACE.sm, borderRadius: RADIUS.md, backgroundColor: pressed ? 'rgba(255,255,255,0.14)' : 'transparent' })}
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
