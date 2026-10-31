// 아래에서 올라오는 판: BottomSheet(내용 자유), ConfirmSheet(확인 질문). 닫기 단추가 늘 있다 — 끌어내리기만으로 되는 일은 없다.
import type { ReactNode } from 'react'
import { Modal, Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native'
import { BigButton } from './buttons.tsx'
import { BACKDROP_OPACITY, RADIUS, SHADOW, SPACE } from './tokens.ts'
import { Txt, useBottomInset, useKit } from './theme.tsx'

export interface BottomSheetProps {
  readonly visible: boolean
  readonly onClose: () => void
  readonly title: string
  readonly children?: ReactNode
  /** 판 맨 아래 고정 단추들 (BigButton). 없으면 "닫기" 하나가 붙는다. */
  readonly actions?: ReactNode
  readonly testID?: string
}

export function BottomSheet({ visible, onClose, title, children, actions, testID }: BottomSheetProps) {
  const { p } = useKit()
  const inset = useBottomInset()
  const { height } = useWindowDimensions()
  return (
    <Modal visible={visible} transparent animationType={Platform.OS === 'web' ? 'none' : 'slide'} onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable aria-label="판 닫기" role="button" onPress={onClose} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: p.backdrop, opacity: BACKDROP_OPACITY }} />
        <View
          role="dialog"
          aria-modal
          aria-label={title}
          testID={testID}
          style={{ backgroundColor: p.surface, borderTopLeftRadius: RADIUS.xxl, borderTopRightRadius: RADIUS.xxl, maxHeight: height * 0.9, paddingTop: SPACE.xxl, paddingHorizontal: SPACE.lg, paddingBottom: Math.max(inset, SPACE.md) + SPACE.md, gap: SPACE.lg, ...SHADOW.sheet }}
        >
          <Txt step="title" weight="bold" role="heading" aria-level={2}>
            {title}
          </Txt>
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: SPACE.md }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          <View style={{ gap: SPACE.sm }}>{actions ?? <BigButton kind="secondary" label="닫기" onPress={onClose} />}</View>
        </View>
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
