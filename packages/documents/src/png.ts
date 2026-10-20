// 휴대폰 공유 이미지 (STL-04, D-207): 한 사람 확인서를 폭 1080px PNG 한 장으로(높이는 내용만큼, 쪽 나눔 없음).
// PDF와 같은 확인서 데이터·같은 배치 모델·같은 글꼴로 그린다. 글자는 글꼴의 글리프 윤곽을 직접 칠하므로(캔버스·글꼴 등록 없음)
// 브라우저와 Node에서 같은 함수가 같은 그림을 만든다. PNG 압축은 fflate(브라우저·Node 공용)를 쓴다.
import { zlibSync } from 'fflate'
import type { DocumentFont, GlyphLike } from './font.ts'
import { layoutReceipt, type LayoutPage } from './layout.ts'
import { asDocumentFont, type FontSource } from './pdf.ts'
import type { ReceiptData } from './receipt.ts'

export const IMAGE_WIDTH_PX = 1080
/** 줄 긋기 진하기 (0 = 흰색, 1 = 검정) */
const RULE_INK = 0.45

// ── 칠하기 ───────────────────────────────────────────────────────────────

/**
 * 부호 있는 넓이 누적 방식의 안티앨리어싱 칠하기 (font-rs와 같은 방법). 선분마다 지나가는 칸에 넓이를 더하고,
 * 줄마다 왼쪽부터 더한 값의 절댓값(1에서 자름)이 그 칸이 덮인 정도다. 겹친 윤곽(같은 방향)도 1로 잘려 비지 않는다.
 */
class Coverage {
  readonly width: number
  readonly height: number
  readonly cells: Float32Array

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.cells = new Float32Array(width * height + 2)
  }

  line(ax: number, ay: number, bx: number, by: number): void {
    if (ay === by) return
    let x0 = ax
    let y0 = ay
    let x1 = bx
    let y1 = by
    let dir = 1
    if (y0 > y1) {
      dir = -1
      ;[x0, x1] = [x1, x0]
      ;[y0, y1] = [y1, y0]
    }
    const dxdy = (x1 - x0) / (y1 - y0)
    let x = x0
    if (y0 < 0) x -= y0 * dxdy
    const w = this.width
    const a = this.cells
    const yEnd = Math.min(this.height, Math.ceil(y1))
    for (let y = Math.max(0, Math.floor(y0)); y < yEnd; y++) {
      const start = y * w
      const dy = Math.min(y + 1, y1) - Math.max(y, y0)
      const xnext = x + dxdy * dy
      const d = dy * dir
      const xa = Math.min(x, xnext)
      const xb = Math.max(x, xnext)
      const xai = Math.floor(xa)
      const xbi = Math.ceil(xb)
      if (xai < 0 || xbi >= w) {
        x = xnext
        continue
      }
      if (xbi <= xai + 1) {
        const xmf = 0.5 * (x + xnext) - xai
        a[start + xai] = (a[start + xai] as number) + d - d * xmf
        a[start + xai + 1] = (a[start + xai + 1] as number) + d * xmf
      } else {
        const s = 1 / (xb - xa)
        const x0f = xa - xai
        const a0 = 0.5 * s * (1 - x0f) * (1 - x0f)
        const x1f = xb - xbi + 1
        const am = 0.5 * s * x1f * x1f
        a[start + xai] = (a[start + xai] as number) + d * a0
        if (xbi === xai + 2) a[start + xai + 1] = (a[start + xai + 1] as number) + d * (1 - a0 - am)
        else {
          const a1 = s * (1.5 - x0f)
          a[start + xai + 1] = (a[start + xai + 1] as number) + d * (a1 - a0)
          for (let xi = xai + 2; xi < xbi - 1; xi++) a[start + xi] = (a[start + xi] as number) + d * s
          const a2 = a1 + (xbi - xai - 3) * s
          a[start + xbi - 1] = (a[start + xbi - 1] as number) + d * (1 - a2 - am)
        }
        a[start + xbi] = (a[start + xbi] as number) + d * am
      }
      x = xnext
    }
  }
}

const curveSteps = (deviation: number): number => Math.min(32, Math.max(1, Math.ceil(Math.sqrt(deviation) * 1.5)))

/** 글리프 윤곽 하나를 그림 좌표로 바꿔 칠한다 (originX·baselineY는 픽셀, scale은 글꼴 단위 → 픽셀) */
function fillGlyph(ink: Float32Array, imageWidth: number, imageHeight: number, glyph: GlyphLike, originX: number, baselineY: number, scale: number): void {
  const commands = glyph.path?.commands ?? []
  if (commands.length === 0) return
  // 윤곽을 선분으로 편다
  const segments: number[] = []
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  let open = false
  const px = (x: number): number => originX + x * scale
  const py = (y: number): number => baselineY - y * scale
  const lineTo = (x: number, y: number): void => {
    segments.push(cx, cy, x, y)
    cx = x
    cy = y
  }
  const close = (): void => {
    if (open && (cx !== sx || cy !== sy)) lineTo(sx, sy)
    open = false
  }
  for (const { command, args } of commands) {
    switch (command) {
      case 'moveTo':
        close()
        cx = sx = px(args[0] as number)
        cy = sy = py(args[1] as number)
        open = true
        break
      case 'lineTo':
        lineTo(px(args[0] as number), py(args[1] as number))
        break
      case 'quadraticCurveTo': {
        const qx = px(args[0] as number)
        const qy = py(args[1] as number)
        const ex = px(args[2] as number)
        const ey = py(args[3] as number)
        const x0 = cx
        const y0 = cy
        const n = curveSteps(Math.hypot(x0 - 2 * qx + ex, y0 - 2 * qy + ey))
        for (let i = 1; i <= n; i++) {
          const t = i / n
          const u = 1 - t
          lineTo(u * u * x0 + 2 * u * t * qx + t * t * ex, u * u * y0 + 2 * u * t * qy + t * t * ey)
        }
        break
      }
      case 'bezierCurveTo': {
        const ax = px(args[0] as number)
        const ay = py(args[1] as number)
        const bx = px(args[2] as number)
        const by = py(args[3] as number)
        const ex = px(args[4] as number)
        const ey = py(args[5] as number)
        const x0 = cx
        const y0 = cy
        const n = curveSteps(Math.max(Math.hypot(x0 - 2 * ax + bx, y0 - 2 * ay + by), Math.hypot(ax - 2 * bx + ex, ay - 2 * by + ey)))
        for (let i = 1; i <= n; i++) {
          const t = i / n
          const u = 1 - t
          lineTo(
            u * u * u * x0 + 3 * u * u * t * ax + 3 * u * t * t * bx + t * t * t * ex,
            u * u * u * y0 + 3 * u * u * t * ay + 3 * u * t * t * by + t * t * t * ey,
          )
        }
        break
      }
      case 'closePath':
        close()
        break
    }
  }
  close()
  if (segments.length === 0) return
  // 이 글리프가 덮는 칸만 따로 칠하고 합친다
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (let i = 0; i < segments.length; i += 2) {
    minX = Math.min(minX, segments[i] as number)
    maxX = Math.max(maxX, segments[i] as number)
    minY = Math.min(minY, segments[i + 1] as number)
    maxY = Math.max(maxY, segments[i + 1] as number)
  }
  const left = Math.floor(minX) - 1
  const top = Math.floor(minY)
  const local = new Coverage(Math.ceil(maxX) - left + 3, Math.ceil(maxY) - top + 1)
  for (let i = 0; i < segments.length; i += 4) {
    local.line((segments[i] as number) - left, (segments[i + 1] as number) - top, (segments[i + 2] as number) - left, (segments[i + 3] as number) - top)
  }
  for (let y = 0; y < local.height; y++) {
    const iy = top + y
    let sum = 0
    for (let x = 0; x < local.width; x++) {
      sum += local.cells[y * local.width + x] as number
      const ix = left + x
      if (iy < 0 || iy >= imageHeight || ix < 0 || ix >= imageWidth) continue
      const cover = Math.min(1, Math.abs(sum))
      if (cover <= 0) continue
      const k = iy * imageWidth + ix
      const before = ink[k] as number
      ink[k] = before + cover - before * cover
    }
  }
}

function fillRect(ink: Float32Array, imageWidth: number, imageHeight: number, x: number, y: number, width: number, height: number, amount: number): void {
  const x0 = Math.max(0, Math.floor(x))
  const x1 = Math.min(imageWidth, Math.ceil(x + width))
  const y0 = Math.max(0, Math.floor(y))
  const y1 = Math.min(imageHeight, Math.max(y0 + 1, Math.ceil(y + height)))
  for (let iy = y0; iy < y1; iy++) {
    for (let ix = x0; ix < x1; ix++) {
      const k = iy * imageWidth + ix
      const before = ink[k] as number
      ink[k] = before + amount - before * amount
    }
  }
}

/** 배치 한 장 → 회색조 화소 (0 = 검정, 255 = 흰색) */
export function rasterizePage(page: LayoutPage, font: DocumentFont, widthPx: number = IMAGE_WIDTH_PX): { readonly width: number; readonly height: number; readonly pixels: Uint8Array } {
  const scale = widthPx / page.width
  const width = widthPx
  const height = Math.ceil(page.height * scale)
  const ink = new Float32Array(width * height)
  for (const item of page.items) {
    if (item.kind === 'rule') {
      fillRect(ink, width, height, item.x * scale, item.y * scale, item.width * scale, item.height * scale, RULE_INK)
      continue
    }
    const unit = (item.size / font.unitsPerEm) * scale
    let penX = item.x * scale
    const baseline = item.baseline * scale
    for (const glyph of font.glyphs(item.text)) {
      fillGlyph(ink, width, height, glyph, penX, baseline, unit)
      penX += glyph.advanceWidth * unit
    }
  }
  const pixels = new Uint8Array(width * height)
  for (let i = 0; i < pixels.length; i++) pixels[i] = Math.round(255 * (1 - Math.min(1, ink[i] as number)))
  return { width, height, pixels }
}

// ── PNG ─────────────────────────────────────────────────────────────────

let crcTable: Uint32Array | null = null

function crc32(bytes: Uint8Array): number {
  if (crcTable === null) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (const byte of bytes) crc = (crcTable[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** 회색조 8비트 PNG (색 형식 0) */
export function encodeGrayPng(width: number, height: number, pixels: Uint8Array): Uint8Array {
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header[8] = 8 // 비트 깊이
  header[9] = 0 // 회색조
  // 압축·거르기·인터레이스 = 0
  const raw = new Uint8Array((width + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (width + 1)
    raw[row] = 2 // 거르기 'Up' — 글자 그림은 위 줄과 같은 화소가 많아 잘 줄어든다
    for (let x = 0; x < width; x++) {
      const value = pixels[y * width + x] as number
      const above = y === 0 ? 0 : (pixels[(y - 1) * width + x] as number)
      raw[row + 1 + x] = (value - above) & 0xff
    }
  }
  const signature = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
  const parts = [signature, chunk('IHDR', header), chunk('IDAT', zlibSync(raw, { level: 6 })), chunk('IEND', new Uint8Array(0))]
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** 한 사람 확인서 → 폭 1080px PNG 한 장 (D-207) */
export function renderReceiptPng(receipt: ReceiptData, fontSource: FontSource): Uint8Array {
  const font = asDocumentFont(fontSource)
  const page = layoutReceipt(receipt, font, 'image').pages[0] as LayoutPage
  const { width, height, pixels } = rasterizePage(page, font)
  return encodeGrayPng(width, height, pixels)
}
