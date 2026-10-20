// 라벨 크기와 점 (LABEL_RULES L-1, D-P1-02·D-N1-03), A4 모아찍기 칸 배치 (L-6, D-P1-07).

/**
 * 템플릿 검사가 받는 크기 전체 (L-1 표 순서). 50mm 라벨은 `<폭>x<높이>`(mm), 테이프는 `tape<테이프 폭>x<길이>`(mm).
 * 어느 프린터가 어느 크기를 쓰는지는 프린터 프로필이 정한다(L-12 1).
 */
export const ALL_LABEL_SIZES = ['50x30', '50x20', '50x40', '50x15', '50x50', 'tape12x40', 'tape15x30', 'tape15x50'] as const
export type LabelSizeId = (typeof ALL_LABEL_SIZES)[number]

/**
 * NIIMBOT B1 크기 목록 (P1 그대로 — 지금 화면(I1)이 보이는 목록). B1 판매자에게 테이프 크기가 보이지 않게
 * 이 목록은 바꾸지 않는다. 프로필마다의 목록으로 바꾸는 일은 통합 스프린트가 한다(L-1).
 */
export const LABEL_SIZES = ['50x30', '50x20', '50x40'] as const satisfies readonly LabelSizeId[]
export const DEFAULT_LABEL_SIZE: LabelSizeId = '50x30'

/** 테이프 라벨 (L-1 — 옆으로 눕혀 읽는 그림, 테이프 프린터가 시계 방향 90도로 돌려 보낸다) */
export const TAPE_LABEL_SIZES = ['tape12x40', 'tape15x30', 'tape15x50'] as const satisfies readonly LabelSizeId[]

/** 작은 크기 = 높이(읽는 방향) 15mm 이하. 기본 상품 템플릿이 작은 템플릿이고, 포장 라벨은 만들지 않는다(L-1·L-4·L-5) */
export const SMALL_LABEL_SIZES = ['50x15', 'tape12x40', 'tape15x30', 'tape15x50'] as const satisfies readonly LabelSizeId[]

/** 포장 라벨을 만들 수 있는 크기 = 높이 20mm 이상 (L-4) */
export const PACKING_LABEL_SIZES = ['50x30', '50x20', '50x40', '50x50'] as const satisfies readonly LabelSizeId[]

/** 203dpi = 1mm에 8점. B1·Marklife 50mm 프린터의 인쇄 헤드는 384점(48mm) */
export const DOTS_PER_MM = 8
export const PRINT_HEAD_DOTS = 384
/** 테이프 프린터의 헤드 = 96점(12mm). 15mm 테이프도 가운데 12mm에만 찍힌다 */
export const TAPE_HEAD_DOTS = 96

export interface LabelSizeInfo {
  readonly id: LabelSizeId
  /** 읽는 방향의 폭 (mm) — 테이프는 길이 */
  readonly widthMm: number
  /** 읽는 방향의 높이 (mm) — 테이프는 테이프 폭 */
  readonly heightMm: number
  /** 그림 폭: 50mm 라벨 = min(폭mm × 8, 384), 테이프 = 길이mm × 8 */
  readonly widthDots: number
  /** 그림 높이: 50mm 라벨 = 높이mm × 8, 테이프 = 96 */
  readonly heightDots: number
  /** 테이프 라벨인지 */
  readonly tape: boolean
  /** 작은 크기(높이 15mm 이하)인지 */
  readonly small: boolean
}

export function isLabelSize(value: unknown): value is LabelSizeId {
  return typeof value === 'string' && (ALL_LABEL_SIZES as readonly string[]).includes(value)
}

export function isTapeSize(size: LabelSizeId): boolean {
  return (TAPE_LABEL_SIZES as readonly string[]).includes(size)
}

export function isSmallLabelSize(size: LabelSizeId): boolean {
  return (SMALL_LABEL_SIZES as readonly string[]).includes(size)
}

/** 그 크기에 포장 라벨을 만들 수 있는지 (높이 20mm 이상 — L-4) */
export function canMakePackingLabel(size: LabelSizeId): boolean {
  return (PACKING_LABEL_SIZES as readonly string[]).includes(size)
}

/**
 * 크기의 mm·점. L-1 목록 밖의 크기는 받지 않는다(RangeError — 부르는 쪽이 isLabelSize·템플릿 검사로 먼저 거른다).
 * 아무 `NxM` 글이나 받으면 목록 밖 크기의 그림·A4 배치가 만들어진다.
 */
export function labelSizeInfo(size: LabelSizeId): LabelSizeInfo {
  if (!isLabelSize(size)) throw new RangeError('라벨 크기는 L-1 목록 안이어야 한다')
  const tape = isTapeSize(size)
  const [a, b] = (tape ? size.slice('tape'.length) : size).split('x')
  if (tape) {
    // tape<테이프 폭>x<길이>: 읽는 방향 = 길이 × 테이프 폭, 그림 = 길이×8 × 96
    const tapeMm = Number(a)
    const lengthMm = Number(b)
    return { id: size, widthMm: lengthMm, heightMm: tapeMm, widthDots: lengthMm * DOTS_PER_MM, heightDots: TAPE_HEAD_DOTS, tape, small: true }
  }
  const widthMm = Number(a)
  const heightMm = Number(b)
  return {
    id: size,
    widthMm,
    heightMm,
    widthDots: Math.min(widthMm * DOTS_PER_MM, PRINT_HEAD_DOTS),
    heightDots: heightMm * DOTS_PER_MM,
    tape,
    small: isSmallLabelSize(size),
  }
}

/** 화면 이름: `50×30`, `테이프 12×40` (L-1 크기 ID) */
export function labelSizeName(size: LabelSizeId): string {
  if (!isLabelSize(size)) throw new RangeError('라벨 크기는 L-1 목록 안이어야 한다')
  return isTapeSize(size) ? `테이프 ${size.slice('tape'.length).replace('x', '×')}` : size.replace('x', '×')
}

/** A4 모아찍기 (L-6): A4 세로 210×297mm, 여백 10mm, 칸 사이 2mm, 칸 = 라벨 크기(읽는 방향) */
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
 * 왼쪽 = 10 + 열 × (폭 + 2), 위 = 10 + 줄 × (높이 + 2) (AC-P1-32). 폭·높이는 읽는 방향 크기다.
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

/** 그림 점 수로 크기를 찾는다 (PDF·PNG가 받은 그림의 크기를 알 때). 크기마다 점 수가 달라 많아야 하나다 */
export function sizeOfBitmap(width: number, height: number): LabelSizeId | undefined {
  return ALL_LABEL_SIZES.find((size) => {
    const info = labelSizeInfo(size)
    return info.widthDots === width && info.heightDots === height
  })
}
