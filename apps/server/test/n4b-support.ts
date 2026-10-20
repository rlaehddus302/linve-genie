// N4b 서버 시험 도우미: JPEG 머리 읽기, ZIP 읽기(중앙 목록 — 이름·플래그·순서·내용), 날짜 하나에 여러 구매자 판매 넣기.
import { inflateRawSync } from 'node:zlib'
import { expect } from 'vitest'
import { chat, ok } from './i2-support.ts'
import { createBroadcast, type Seller, type TestServer } from './support.ts'

export interface JpegInfo {
  /** 나온 표시(마커) 차례 (FFxx의 xx) */
  readonly markers: number[]
  readonly width: number
  readonly height: number
  readonly components: number
}

/** JPEG 구조 읽기: SOI부터 SOS까지 표시를 차례로, 프레임 머리의 크기·구성 요소 수. 끝 EOI 확인 */
export function readJpeg(bytes: Uint8Array): JpegInfo {
  expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8])
  expect([bytes[bytes.length - 2], bytes[bytes.length - 1]]).toEqual([0xff, 0xd9])
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const markers: number[] = [0xd8]
  let offset = 2
  let width = 0
  let height = 0
  let components = 0
  for (;;) {
    expect(bytes[offset]).toBe(0xff)
    const marker = bytes[offset + 1] as number
    markers.push(marker)
    const length = view.getUint16(offset + 2)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      height = view.getUint16(offset + 5)
      width = view.getUint16(offset + 7)
      components = bytes[offset + 9] as number
    }
    offset += 2 + length
    if (marker === 0xda) break
  }
  return { markers, width, height, components }
}

export interface ZipItem {
  readonly name: string
  readonly flags: number
  readonly method: number
  readonly bytes: Uint8Array
}

/** ZIP 읽기 (중앙 목록 차례): 이름은 UTF-8로 푼다 */
export function readZip(bytes: Uint8Array): ZipItem[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = bytes.length - 22
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--
  expect(end).toBeGreaterThanOrEqual(0)
  const count = view.getUint16(end + 10, true)
  let offset = view.getUint32(end + 16, true)
  const items: ZipItem[] = []
  const decoder = new TextDecoder('utf-8', { fatal: true })
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(offset, true)).toBe(0x02014b50)
    const flags = view.getUint16(offset + 8, true)
    const method = view.getUint16(offset + 10, true)
    const compressed = view.getUint32(offset + 20, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const local = view.getUint32(offset + 42, true)
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    expect(view.getUint32(local, true)).toBe(0x04034b50)
    expect(view.getUint16(local + 6, true)).toBe(flags)
    const localName = view.getUint16(local + 26, true)
    const localExtra = view.getUint16(local + 28, true)
    const start = local + 30 + localName + localExtra
    const raw = bytes.subarray(start, start + compressed)
    items.push({ name, flags, method, bytes: method === 0 ? raw.slice() : new Uint8Array(inflateRawSync(raw)) })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return items
}

/** 날짜 하나의 실제 방송에 (채널, 닉네임, 상품 수) 판매를 넣는다. 돌려주는 값: 방송 ID */
export async function sellMany(world: TestServer, seller: Seller, date: string, buyers: readonly (readonly [string, string, number])[], options: { rehearsal?: boolean; price?: number } = {}): Promise<string> {
  const b = (await createBroadcast(world, seller, { date, ...(options.rehearsal === true ? { rehearsal: true } : {}) })).id
  let no = 0
  for (const [ch, nick, count] of buyers) {
    for (let k = 0; k < count; k++) {
      no++
      await ok(world, seller, { type: 'product.register', b, no, name: `품종${String(no)}`, price: options.price ?? 1000 * no })
      await chat(world, seller, b, `m${String(no)}`, ch, nick, String(no))
    }
  }
  return b
}
