// 방송 링크 칸 바로 아래 왼쪽 [붙여넣기] 칩 (D-UX3-11 → D-UX4-113). 아이폰 16 이상은 기본 붙여넣기 단추(UIPasteControl — "붙여넣기 허용" 창 없음)를
// 앱 시작 때 끼운다(production.tsx). 그 밖(안드로이드·옛 아이폰·시험)은 누르면 클립보드를 읽는 보통 단추.
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
