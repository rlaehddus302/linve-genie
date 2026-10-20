// PNG 내보내기 (LABEL_RULES L-6, D-P1-07). 1비트 그림을 그대로 담는다 — 검정·흰색 두 색, 203dpi(pHYs 7992점/m).
// 같은 그림이면 같은 바이트다(시각·난수 없음). 압축은 fflate(zlib, 결정적).
import { zlibSync } from 'fflate'
import { bytesPerRow, isLabelBitmap, type LabelBitmap } from './bitmap.ts'
import { LABEL_MESSAGES, type LabelError } from './errors.ts'

/** 203dpi를 1m당 점 수로: 203 ÷ 0.0254 ≈ 7992 */
export const PNG_DOTS_PER_METER = 7992

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, body.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(body, 8)
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)))
  return out
}

export type PngResult = { readonly ok: true; readonly bytes: Uint8Array } | { readonly ok: false; readonly error: LabelError }

/**
 * 1비트 그림 → PNG (흑백 1비트, 색 형식 0). PNG 흑백은 0 = 검정이라 라벨 형식(1 = 검정)을 뒤집어 담는다.
 * 줄마다 필터 0(없음). 크기는 그림 점 수 그대로다.
 */
export function encodeLabelPng(bitmap: LabelBitmap): PngResult {
  if (!isLabelBitmap(bitmap)) return { ok: false, error: { code: 'INVALID_IMAGE', message: LABEL_MESSAGES.invalidImage } }
  const { width, height, data } = bitmap
  const row = bytesPerRow(width)
  const padBits = row * 8 - width
  const padMask = padBits === 0 ? 0 : (1 << padBits) - 1
  const raw = new Uint8Array((row + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (row + 1)] = 0
    for (let i = 0; i < row; i++) {
      let v = ~(data[y * row + i] ?? 0) & 0xff
      if (i === row - 1) v |= padMask // 줄 끝 남는 비트는 흰색
      raw[y * (row + 1) + 1 + i] = v
    }
  }
  const ihdr = new Uint8Array(13)
  const ih = new DataView(ihdr.buffer)
  ih.setUint32(0, width)
  ih.setUint32(4, height)
  ihdr[8] = 1 // 비트 깊이
  ihdr[9] = 0 // 흑백
  ihdr[10] = 0 // 압축: deflate
  ihdr[11] = 0 // 필터 방식 0
  ihdr[12] = 0 // 비월 없음
  const phys = new Uint8Array(9)
  const ph = new DataView(phys.buffer)
  ph.setUint32(0, PNG_DOTS_PER_METER)
  ph.setUint32(4, PNG_DOTS_PER_METER)
  phys[8] = 1 // 단위: m
  const parts = [SIGNATURE, chunk('IHDR', ihdr), chunk('pHYs', phys), chunk('IDAT', zlibSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))]
  const total = parts.reduce((sum, p) => sum + p.length, 0)
  const bytes = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    bytes.set(p, at)
    at += p.length
  }
  return { ok: true, bytes }
}
