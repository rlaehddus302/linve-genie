// 라벨 크기와 점 (LABEL_RULES L-1, D-P1-02), A4 모아찍기 칸 배치 (L-6, D-P1-07).

/** 쓸 수 있는 라벨 크기 (폭×높이 mm). 이 밖의 크기는 템플릿 오류다 */
export const LABEL_SIZES = ['50x30', '50x20', '50x40'] as const
export type LabelSizeId = (typeof LABEL_SIZES)[number]
export const DEFAULT_LABEL_SIZE: LabelSizeId = '50x30'

/** B1: 203dpi = 1mm에 8점, 인쇄 헤드 384점(48mm) */
export const DOTS_PER_MM = 8
export const PRINT_HEAD_DOTS = 384

export interface LabelSizeInfo {
  readonly id: LabelSizeId
  readonly widthMm: number
  readonly heightMm: number
  /** 그림 폭 = min(폭mm × 8, 384) */
  readonly widthDots: number
  /** 그림 높이 = 높이mm × 8 */
  readonly heightDots: number
}

export function isLabelSize(value: unknown): value is LabelSizeId {
  return typeof value === 'string' && (LABEL_SIZES as readonly string[]).includes(value)
}

export function labelSizeInfo(size: LabelSizeId): LabelSizeInfo {
  const m = /^(\d+)x(\d+)$/.exec(size)
  const widthMm = Number(m?.[1])
  const heightMm = Number(m?.[2])
  return {
    id: size,
    widthMm,
    heightMm,
    widthDots: Math.min(widthMm * DOTS_PER_MM, PRINT_HEAD_DOTS),
    heightDots: heightMm * DOTS_PER_MM,
  }
}

/** A4 모아찍기 (L-6): A4 세로 210×297mm, 여백 10mm, 칸 사이 2mm, 칸 = 라벨 크기 */
export const A4_WIDTH_MM = 210
export const A4_HEIGHT_MM = 297
export const A4_MARGIN_MM = 10
export const A4_GAP_MM = 2

export interface A4Layout {
  readonly size: LabelSizeId
  readonly columns: number
  readonly rows: number
  readonly perPage: number
}

export function a4Layout(size: LabelSizeId): A4Layout {
  const { widthMm, heightMm } = labelSizeInfo(size)
  const columns = Math.floor((A4_WIDTH_MM - 2 * A4_MARGIN_MM + A4_GAP_MM) / (widthMm + A4_GAP_MM))
  const rows = Math.floor((A4_HEIGHT_MM - 2 * A4_MARGIN_MM + A4_GAP_MM) / (heightMm + A4_GAP_MM))
  return { size, columns, rows, perPage: columns * rows }
}

export interface A4Cell {
  /** 몇 번째 쪽인지 (0부터) */
  readonly page: number
  readonly column: number
  readonly row: number
  /** 칸 왼쪽 (mm, 종이 왼쪽에서) */
  readonly leftMm: number
  /** 칸 위 (mm, 종이 위에서) */
  readonly topMm: number
  readonly widthMm: number
  readonly heightMm: number
}

/**
 * i번째(0부터) 라벨의 칸: 열 = i mod 열 수, 줄 = floor(i ÷ 열 수) mod 줄 수,
 * 왼쪽 = 10 + 열 × (폭 + 2), 위 = 10 + 줄 × (높이 + 2) (AC-P1-32).
 */
export function a4Cell(size: LabelSizeId, index: number): A4Cell {
  if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('칸 번호는 0 이상 정수여야 한다')
  const layout = a4Layout(size)
  const { widthMm, heightMm } = labelSizeInfo(size)
  const column = index % layout.columns
  const row = Math.floor(index / layout.columns) % layout.rows
  return {
    page: Math.floor(index / layout.perPage),
    column,
    row,
    leftMm: A4_MARGIN_MM + column * (widthMm + A4_GAP_MM),
    topMm: A4_MARGIN_MM + row * (heightMm + A4_GAP_MM),
    widthMm,
    heightMm,
  }
}

/** 그림 점 수로 크기를 찾는다 (PDF·PNG가 받은 그림의 크기를 알 때) */
export function sizeOfBitmap(width: number, height: number): LabelSizeId | undefined {
  return LABEL_SIZES.find((size) => {
    const info = labelSizeInfo(size)
    return info.widthDots === width && info.heightDots === height
  })
}
