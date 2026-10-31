// 서버 라벨 그림 → 공유용 PNG (PR-07): 서버 PNG와 같은 점·같은 203dpi
// @vitest-environment node
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { encodeLabelPng, type LabelBitmap } from '@livejjim/label'
import { labelBitmapToPng } from '../src/lib/label-png.ts'

function parse(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const chunks = new Map<string, Uint8Array>()
  for (let at = 8; at < png.length; ) {
    const len = view.getUint32(at)
    chunks.set(String.fromCharCode(...png.subarray(at + 4, at + 8)), png.subarray(at + 8, at + 8 + len))
    at += 12 + len
  }
  return { sig: Array.from(png.subarray(0, 8)), ihdr: chunks.get('IHDR')!, phys: chunks.get('pHYs')!, pixels: inflateSync(chunks.get('IDAT')!) }
}

const bitmap = (width: number, height: number): LabelBitmap => {
  const row = Math.ceil(width / 8)
  const data = new Uint8Array(row * height)
  for (let i = 0; i < data.length; i++) data[i] = (i * 37 + 11) & 0xff
  return { width, height, data }
}

describe('labelBitmapToPng', () => {
  it.each([[8, 3], [50, 7], [400, 240], [412, 300]])('%i×%i 점이 서버 PNG와 같다', (w, h) => {
    const image = bitmap(w, h)
    const mine = parse(labelBitmapToPng(image))
    const server = encodeLabelPng(image)
    if (!server.ok) throw new Error('서버 PNG 실패')
    const theirs = parse(server.bytes)
    expect(mine.sig).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(Array.from(mine.ihdr)).toEqual(Array.from(theirs.ihdr))
    expect(Array.from(mine.phys)).toEqual(Array.from(theirs.phys))
    expect(Buffer.from(mine.pixels).equals(Buffer.from(theirs.pixels))).toBe(true)
  })

  it('65535바이트를 넘는 그림도 저장 블록을 나눠 담는다', () => {
    const image = bitmap(832, 700)
    expect(parse(labelBitmapToPng(image)).pixels.length).toBe((104 + 1) * 700)
  })
})
