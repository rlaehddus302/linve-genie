// 서버가 준 라벨 그림(1비트) → 203dpi 1비트 PNG 바이트 (PR-07: 제조사 앱에 공유 시트로 보낸다).
// 그리는 것이 아니라 받은 점을 파일 모양으로 담기만 한다. 압축 없는 deflate(저장 블록)라 결정적이다.
import type { LabelBitmap } from '@livejjim/label'

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
/** 203dpi ÷ 0.0254 ≈ 7992점/m (서버 PNG와 같다) */
const DOTS_PER_METER = 7992
const STORED_MAX = 65535

const CRC = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(parts: readonly Uint8Array[]): number {
  let c = 0xffffffff
  for (const part of parts) for (const byte of part) c = CRC[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function adler32(data: Uint8Array): number {
  let a = 1
  let b = 0
  for (const byte of data) {
    a = (a + byte) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const name = Uint8Array.from(type, (ch) => ch.charCodeAt(0))
  const out = new Uint8Array(12 + body.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, body.length)
  out.set(name, 4)
  out.set(body, 8)
  view.setUint32(8 + body.length, crc32([name, body]))
  return out
}

/** zlib 저장 블록 (압축 없음) */
function zlibStored(raw: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(raw.length / STORED_MAX))
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4)
  out[0] = 0x78
  out[1] = 0x01
  let at = 2
  for (let i = 0; i < blocks; i++) {
    const part = raw.subarray(i * STORED_MAX, (i + 1) * STORED_MAX)
    out[at++] = i === blocks - 1 ? 1 : 0
    out[at++] = part.length & 0xff
    out[at++] = part.length >>> 8
    out[at++] = ~part.length & 0xff
    out[at++] = (~part.length >>> 8) & 0xff
    out.set(part, at)
    at += part.length
  }
  new DataView(out.buffer).setUint32(at, adler32(raw))
  return out
}

/** 1 = 검정인 행 바이트를 PNG(0 = 검정)로 뒤집어 담는다. 줄 끝 남는 비트는 흰색 */
export function labelBitmapToPng(bitmap: LabelBitmap): Uint8Array {
  const { width, height, data } = bitmap
  const row = Math.ceil(width / 8)
  const padBits = row * 8 - width
  const padMask = padBits === 0 ? 0 : (1 << padBits) - 1
  const raw = new Uint8Array((row + 1) * height)
  for (let y = 0; y < height; y++) {
    for (let i = 0; i < row; i++) {
      let v = ~(data[y * row + i] ?? 0) & 0xff
      if (i === row - 1) v |= padMask
      raw[y * (row + 1) + 1 + i] = v
    }
  }
  const ihdr = new Uint8Array(13)
  const ih = new DataView(ihdr.buffer)
  ih.setUint32(0, width)
  ih.setUint32(4, height)
  ihdr[8] = 1
  const phys = new Uint8Array(9)
  const ph = new DataView(phys.buffer)
  ph.setUint32(0, DOTS_PER_METER)
  ph.setUint32(4, DOTS_PER_METER)
  phys[8] = 1
  const parts = [Uint8Array.from(SIGNATURE), chunk('IHDR', ihdr), chunk('pHYs', phys), chunk('IDAT', zlibStored(raw)), chunk('IEND', new Uint8Array(0))]
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
