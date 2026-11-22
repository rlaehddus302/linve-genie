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

/**
 * 안전 영역 (D-LABEL-SAFE-01, 사용자 지시 2026-11-23 "너무 딱 붙으면 글자 잘리니까 안전 영역(padding) 확보해줘. 1mm 정도면"):
 * 종이 가장자리에서 1mm(8점) 안에는 아무것도 찍지 않는다. 템플릿 칸 좌표(라벨 그림 전체 기준)는 그대로 두고, 그릴 때 안쪽으로 줄여 넣는다 —
 * 저장된 템플릿을 고치지 않아도 모든 상품 라벨에 들어간다. 미리 보기의 칸 자리도 같은 식으로 그린다.
 * 그림이 종이보다 좁은 쪽(50mm 라벨의 폭 — 인쇄 머리 48mm, 15mm 테이프의 폭 — 12mm)은 이미 종이 여백이 있어 모자란 만큼만 더한다.
 * 옛 방식처럼 사방을 똑같이 줄이면 번호 9999·가격 99,999,999원 보장값(L-5)이 깨져 라벨이 안 뽑힌다.
 */
export const SAFE_MARGIN_DOTS = 8

export interface SafeMargin {
  readonly x: number
  readonly y: number
}

/**
 * 테이프 라벨(D 시리즈)의 길이 쪽 여백(점). 15×30mm 작은 템플릿은 1mm를 주면 보장값 `99개 99,999,999원`(L-5·AC-O3-04)이 들어가지 않아
 * 라벨이 안 뽑힌다 — 안 뽑히는 것보다 0.25mm 여백이 안전하다 (D-LABEL-SAFE-01 AUTO)
 */
export const TAPE_LENGTH_MARGIN_DOTS = 2

/** 그림의 각 쪽에 더할 여백(점): 종이 크기(mm)와 그림 크기(점)의 차이로 이미 생긴 여백을 뺀다 */
export function safeMargin(size: { readonly widthMm: number; readonly heightMm: number; readonly widthDots: number; readonly heightDots: number; readonly tape?: boolean }): SafeMargin {
  const need = (mm: number, dots: number) => Math.max(0, SAFE_MARGIN_DOTS - Math.floor((mm * 8 - dots) / 2))
  const x = need(size.widthMm, size.widthDots)
  return { x: size.tape === true ? Math.min(TAPE_LENGTH_MARGIN_DOTS, x) : x, y: need(size.heightMm, size.heightDots) }
}

/** 상품 라벨의 그릴 자리: 안전 영역 안쪽에서 문구 줄(위·아래)을 뺀 상품 칸 영역(body)과 문구 줄들 */
export function productArea(notes: readonly LabelCaption[], width: number, height: number, margin: SafeMargin) {
  const innerWidth = Math.max(1, width - 2 * margin.x)
  const innerHeight = Math.max(1, height - 2 * margin.y)
  const { top, bodyHeight, lines } = captionLayout(notes, innerWidth, innerHeight)
  return {
    body: { x: margin.x, y: margin.y + top, width: innerWidth, height: Math.max(0, bodyHeight) },
    innerHeight,
    lines: lines.map((line) => ({ ...line, x: line.x + margin.x, y: line.y + margin.y })),
  }
}

/** 문구가 상품 칸을 반 넘게 차지하나 (저장 막음 — CAPTION_SPACE_HINT) */
export function captionsCrowded(notes: readonly LabelCaption[], width: number, height: number, margin: SafeMargin): boolean {
  const { body, innerHeight } = productArea(notes, width, height, margin)
  return body.height < innerHeight / 2
}

/** 라벨 전체 기준 칸 → 그릴 자리(body) 안의 칸. 경계마다 같은 식으로 반올림해 표의 이웃한 셀 사이에 틈이 생기지 않는다. 문구로 줄어든 만큼 가장 작은 글자도 줄인다 */
export function areaItem(item: TemplateItem, width: number, height: number, body: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }, innerHeight: number): TemplateItem {
  const sx = body.width / width
  const sy = body.height / height
  const x = body.x + Math.round(item.x * sx)
  const y = body.y + Math.round(item.y * sy)
  const shrink = body.height / innerHeight
  return {
    ...item,
    x,
    y,
    width: Math.max(1, body.x + Math.round((item.x + item.width) * sx) - x),
    height: Math.max(1, body.y + Math.round((item.y + item.height) * sy) - y),
    minFontSize: shrink < 1 ? Math.max(1, Math.floor(item.minFontSize * shrink)) : item.minFontSize,
  }
}
