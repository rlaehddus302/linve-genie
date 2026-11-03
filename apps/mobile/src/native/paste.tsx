// 방송 링크 칸의 [붙여넣기] (D-UX3-11). 아이폰 16 이상은 기본 붙여넣기 단추(UIPasteControl — "붙여넣기 허용" 창 없음)를
// 앱 시작 때 끼운다(production.tsx). 그 밖(안드로이드·옛 아이폰·시험)은 누르면 클립보드를 읽는 보통 단추.
import { useSyncExternalStore, type ComponentType } from 'react'
import { Pressable } from 'react-native'
import { readClipboard } from '../lib/clipboard.ts'
import { RADIUS, SPACE } from '../ui/kit/tokens.ts'
import { Txt, useKit } from '../ui/kit/theme.tsx'

export interface PasteControlProps {
  readonly onPaste: (text: string) => void
}

function PlainPasteButton({ onPaste }: PasteControlProps) {
  const { p } = useKit()
  return (
    <Pressable role="button" aria-label="붙여넣기" onPress={() => void readClipboard().then(onPaste)} hitSlop={6} style={({ pressed }) => ({ height: 36, paddingHorizontal: SPACE.md, borderRadius: RADIUS.md, borderCurve: 'continuous', justifyContent: 'center', backgroundColor: pressed ? p.softPressed : p.soft })}>
      <Txt step="caption" weight="bold">
        붙여넣기
      </Txt>
    </Pressable>
  )
}

let Control: ComponentType<PasteControlProps> = PlainPasteButton
const listeners = new Set<() => void>()

export function setPasteControl(next: ComponentType<PasteControlProps> | null): void {
  Control = next ?? PlainPasteButton
  for (const listener of listeners) listener()
}

export function PasteButton(props: PasteControlProps) {
  const Current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => Control,
  )
  return <Current {...props} />
}
