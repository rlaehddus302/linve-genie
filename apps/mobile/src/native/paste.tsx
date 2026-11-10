// 방송 링크 칸 바로 아래 왼쪽 [붙여넣기] 칩 (D-UX3-11 → D-UX4-113 → D-UX4-115). 모든 기기에서 [링크를 모르겠어요]와 똑같은 회색 칩 —
// 누르면 클립보드를 읽는다(아이폰은 이때 "붙여넣기 허용"을 물을 수 있다). 아이폰 기본 붙여넣기 단추(UIPasteControl)는 글자 크기·글꼴이 달라 쓰지 않는다.
import { useSyncExternalStore, type ComponentType } from 'react'
import { readClipboard } from '../lib/clipboard.ts'
import { SoftChip } from '../ui/kit/press.tsx'

export interface PasteControlProps {
  readonly onPaste: (text: string) => void
}

/** 보통 [붙여넣기] — 토스 "… 붙여넣기" 칩처럼 옅은 회색 둥근 네모(SoftChip, [링크를 모르겠어요]와 같은 모양) (D-UX4-113) */
function PlainPasteButton({ onPaste }: PasteControlProps) {
  return <SoftChip label="붙여넣기" onPress={() => void readClipboard().then(onPaste)} />
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
