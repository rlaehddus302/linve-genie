// 상품 라벨의 직접 입력 문구. 같은 모서리의 문구는 입력 순서대로 줄을 쌓는다.
import type { TemplateItem } from './template.ts'

export const CAPTION_POSITIONS = ['topRight', 'topLeft', 'bottomRight', 'bottomLeft'] as const
export type CaptionPosition = (typeof CAPTION_POSITIONS)[number]
export interface LabelCaption {
  readonly text: string
  readonly position: CaptionPosition
}
export const CAPTION_WORDS: Record<CaptionPosition, string> = { topRight: '오른쪽 위', topLeft: '왼쪽 위', bottomRight: '오른쪽 아래', bottomLeft: '왼쪽 아래' }
export const CAPTION_TEXT_MAX = 80
export const CAPTION_SPACE_HINT = '상품 칸이 좁아요. 문구를 좌우로 나누거나 더 큰 용지를 골라 주세요.'
const LINE = 24

export function captionLayout(notes: readonly LabelCaption[], width: number, height: number) {
  const columns: Record<CaptionPosition, string[]> = { topRight: [], topLeft: [], bottomRight: [], bottomLeft: [] }
  for (const note of notes) {
    if (note.text.trim()) columns[note.position].push(note.text.trim())
  }
  const top = Math.max(columns.topRight.length, columns.topLeft.length) * LINE
  const bottom = Math.max(columns.bottomRight.length, columns.bottomLeft.length) * LINE
  const bodyHeight = height - top - bottom
  const lines = CAPTION_POSITIONS.flatMap((position) => {
    const upper = position === 'topLeft' || position === 'topRight'
    const left = position === 'topLeft' || position === 'bottomLeft'
    const opposite = upper ? (left ? 'topRight' : 'topLeft') : (left ? 'bottomRight' : 'bottomLeft')
    return columns[position].map((text, i) => {
      const half = Math.floor(width / 2)
      const paired = columns[opposite][i] !== undefined
      const x = !left && paired ? half + 2 : 2
      const right = left && paired ? half - 2 : width - 2
      return { text, left, x, y: (upper ? 0 : height - bottom) + i * LINE, width: right - x, height: LINE }
    })
  })
  return { top, bodyHeight, lines }
}

// 경계 두 곳을 같은 식으로 반올림해야 표의 이웃한 셀 사이에 틈이 생기지 않는다.
export function captionBodyItem(item: TemplateItem, top: number, scaleY: number): TemplateItem {
  const y = Math.round(item.y * scaleY)
  return { ...item, y: top + y, height: Math.max(1, Math.round((item.y + item.height) * scaleY) - y), minFontSize: Math.max(1, Math.floor(item.minFontSize * scaleY)) }
}
