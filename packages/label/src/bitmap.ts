// 1비트 그림 형식 (LABEL_RULES L-1, D-P1-02). 라벨 → 미리보기·PNG·PDF·프린터가 모두 이 객체 하나를 쓴다 (L-0 1).
// `data`는 줄 순서(위 → 아래), 한 줄은 ceil(width/8)바이트, 바이트 안은 왼쪽 점이 높은 비트, 1 = 검정.

export interface LabelBitmap {
  readonly width: number
  readonly height: number
  readonly data: Uint8Array
}

/** 1비트 변환 문턱값: 흰 바탕에 합친 밝기(R·G·B 평균)가 이 값 미만이면 검정 */
export const ONE_BIT_THRESHOLD = 128

export function bytesPerRow(width: number): number {
  return Math.ceil(width / 8)
}

function checkSize(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`그림 크기는 1 이상 정수여야 한다 (${String(width)}×${String(height)})`)
  }
}

/** 모두 흰색인 그림 */
export function createBitmap(width: number, height: number): LabelBitmap {
  checkSize(width, height)
  return { width, height, data: new Uint8Array(bytesPerRow(width) * height) }
}

/** 그 점이 검정인지 */
export function getPixel(bitmap: LabelBitmap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) return false
  const byte = bitmap.data[y * bytesPerRow(bitmap.width) + (x >> 3)] ?? 0
  return (byte & (0x80 >> (x & 7))) !== 0
}

/** 점 하나를 칠한다 (만들고 있는 그림에만 쓴다) */
export function setPixel(bitmap: LabelBitmap, x: number, y: number, black: boolean): void {
  if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) return
  const at = y * bytesPerRow(bitmap.width) + (x >> 3)
  const mask = 0x80 >> (x & 7)
  const old = bitmap.data[at] ?? 0
  bitmap.data[at] = black ? old | mask : old & ~mask
}

/** 그림이 형식(L-1)에 맞는지 — 크기·바이트 수 */
export function isLabelBitmap(value: unknown): value is LabelBitmap {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Partial<LabelBitmap>
  return (
    typeof v.width === 'number' &&
    typeof v.height === 'number' &&
    Number.isSafeInteger(v.width) &&
    Number.isSafeInteger(v.height) &&
    v.width > 0 &&
    v.height > 0 &&
    v.data instanceof Uint8Array &&
    v.data.length === bytesPerRow(v.width) * v.height
  )
}

/**
 * RGBA 점(캔버스 getImageData 결과)을 1비트로 바꾼다 (L-1 "1비트").
 * 흰 바탕에 합친 밝기 = a/255 × (R+G+B)/3 + (1 − a/255) × 255, 128 미만이면 검정. 회색·디더링은 없다.
 */
export function oneBitFromRgba(rgba: ArrayLike<number>, width: number, height: number): LabelBitmap {
  checkSize(width, height)
  if (rgba.length < width * height * 4) throw new RangeError('RGBA 바이트 수가 그림 크기보다 적다')
  const out = createBitmap(width, height)
  const row = bytesPerRow(width)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const r = rgba[i] ?? 255
      const g = rgba[i + 1] ?? 255
      const b = rgba[i + 2] ?? 255
      const a = rgba[i + 3] ?? 255
      // 정수로만 계산한다: 밝기×255×3 = a·(r+g+b) + (255−a)·255·3 < 128×255×3
      const lum = a * (r + g + b) + (255 - a) * 765
      if (lum < ONE_BIT_THRESHOLD * 765) {
        const at = y * row + (x >> 3)
        out.data[at] = (out.data[at] ?? 0) | (0x80 >> (x & 7))
      }
    }
  }
  return out
}

/** 검정 점 수 */
export function countBlack(bitmap: LabelBitmap, region?: { x: number; y: number; width: number; height: number }): number {
  const x0 = Math.max(0, region?.x ?? 0)
  const y0 = Math.max(0, region?.y ?? 0)
  const x1 = Math.min(bitmap.width, region ? region.x + region.width : bitmap.width)
  const y1 = Math.min(bitmap.height, region ? region.y + region.height : bitmap.height)
  let n = 0
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (getPixel(bitmap, x, y)) n++
  return n
}

/** 두 그림이 점 하나까지 같은지 */
export function bitmapsEqual(a: LabelBitmap, b: LabelBitmap): boolean {
  if (a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) return false
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false
  return true
}

/** 그림을 복사한다 (받은 쪽이 원본을 바꿔도 기록이 바뀌지 않게) */
export function copyBitmap(bitmap: LabelBitmap): LabelBitmap {
  return { width: bitmap.width, height: bitmap.height, data: new Uint8Array(bitmap.data) }
}

export interface PreviewImage {
  readonly width: number
  readonly height: number
  /** RGBA, 검정 (0,0,0,255) · 흰색 (255,255,255,255) */
  readonly data: Uint8ClampedArray
}

/**
 * 미리보기용 RGBA (LBL-03, L-0 1). 라벨을 다시 그리지 않고 1비트 그림을 정수 배로 키운다(가장 가까운 점).
 * 화면은 이 결과를 ImageData로 캔버스에 올린다 — 미리보기 = 출력 그림.
 */
export function toPreviewRgba(bitmap: LabelBitmap, scale = 1): PreviewImage {
  if (!Number.isSafeInteger(scale) || scale < 1 || scale > 16) throw new RangeError('확대 배수는 1~16 정수여야 한다')
  const width = bitmap.width * scale
  const height = bitmap.height * scale
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const sy = Math.floor(y / scale)
    for (let x = 0; x < width; x++) {
      const v = getPixel(bitmap, Math.floor(x / scale), sy) ? 0 : 255
      const i = (y * width + x) * 4
      data[i] = v
      data[i + 1] = v
      data[i + 2] = v
      data[i + 3] = 255
    }
  }
  return { width, height, data }
}
