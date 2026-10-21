// N1 적대 테스트 (test-domain): 작업 바이트 공격 (AC-N1-70, AC-N1-20~23, LABEL_RULES L-12 2).
// 무작위 그림(폭 1~400, 높이 1~500, 폭이 8의 배수가 아닌 것, 남는 비트에 1을 넣은 그림) × 모든 Marklife·바우아토 프로필 × 농도에서
// 바이트를 L-12 2의 문장만으로 직접 읽어(제품 코드·개발자 시험 도우미를 쓰지 않는다) 아래를 본다.
// - YXQ: 순서·농도 바이트, CMF 28·FLG·사전 없음, 길이 칸 = 압축 바이트 수, node:zlib 창 10으로 풀면 (남는 비트를 지운) 줄
// - L11: 00×15 · 10 FF F1 02 · 1D 76 30 00 + LE16 폭·높이 + 줄 그대로 · 1D 0C · 10 FF F1 45, 농도와 상관없이 같은 바이트
// - 돌림: 보낸 점 (x, y) = 받은 점 (y, H−1−x) / 보내는 줄의 남는 비트는 늘 0 / 헤드보다 넓으면 언제나 IMAGE_TOO_WIDE
// - 결정성(두 번 같은 바이트), 받은 그림은 바뀌지 않는다
import { inflateSync } from 'node:zlib'
import { bytesPerRow, type LabelBitmap } from '@livejjim/label'
import { BAUATO_PPA2L, MARKLIFE_PROFILES, buildPrintJob, type ModelProfile } from '@livejjim/printer'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

const ALL: readonly ModelProfile[] = [...MARKLIFE_PROFILES, BAUATO_PPA2L]

const DENSITY: Record<string, readonly [number, number, number]> = {
  MARKLIFE_YXQ2: [0x03, 0x0a, 0x0e],
  MARKLIFE_YXQ3: [0x03, 0x0a, 0x0e],
  MARKLIFE_YXQ8: [0x03, 0x08, 0x0e],
}

const getBit = (data: Uint8Array, row: number, x: number, y: number): boolean => (((data[y * row + (x >> 3)] as number) >> (7 - (x & 7))) & 1) === 1

/** 보낼 그림의 기대 줄 (L-12 2 문장 그대로: 돌림, 남는 비트 0) */
function expectedRows(profile: ModelProfile, image: LabelBitmap): { width: number; height: number; rows: Uint8Array } {
  const W = image.width
  const H = image.height
  const srcRow = bytesPerRow(W)
  const rotate = profile.rotate === 'CW90'
  const width = rotate ? H : W
  const height = rotate ? W : H
  const row = bytesPerRow(width)
  const rows = new Uint8Array(row * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const on = rotate ? getBit(image.data, srcRow, y, H - 1 - x) : getBit(image.data, srcRow, x, y)
      if (on) rows[y * row + (x >> 3)] = (rows[y * row + (x >> 3)] as number) | (0x80 >> (x & 7))
    }
  return { width, height, rows }
}

const hex = (b: Uint8Array | readonly number[]): string => Buffer.from(b).toString('hex')

class Reader {
  at = 0
  readonly bytes: Uint8Array
  constructor(bytes: Uint8Array) {
    this.bytes = bytes
  }
  take(n: number): Uint8Array {
    if (this.at + n > this.bytes.length) throw new Error(`바이트가 모자라다: ${this.at}+${n} > ${this.bytes.length}`)
    const out = this.bytes.subarray(this.at, this.at + n)
    this.at += n
    return out
  }
  expect(seq: readonly number[], what: string): void {
    expect(hex(this.take(seq.length)), what).toBe(hex(seq))
  }
}

/** 작업 바이트를 L-12 2로 읽어 래스터 줄을 돌려준다 (꼴이 다르면 단언 실패) */
function readJob(profile: ModelProfile, bytes: Uint8Array, density: number): { widthBytes: number; height: number; rows: Uint8Array } {
  const r = new Reader(bytes)
  let widthBytes: number
  let height: number
  let rows: Uint8Array
  const yxq = (): void => {
    r.expect([0x1f, 0x10], 'YXQ 래스터 머리')
    const h = r.take(8)
    widthBytes = ((h[0] as number) << 8) | (h[1] as number)
    height = ((h[2] as number) << 8) | (h[3] as number)
    const length = (((h[4] as number) << 24) | ((h[5] as number) << 16) | ((h[6] as number) << 8) | (h[7] as number)) >>> 0
    const packed = r.take(length)
    expect(packed[0], 'CMF 28 (창 1KiB)').toBe(0x28)
    expect(((packed[0] as number) * 256 + (packed[1] as number)) % 31, 'FLG 검사').toBe(0)
    expect((packed[1] as number) & 0x20, '사전 없음').toBe(0)
    // 창 10으로 풀린다 — 1KiB를 넘는 되짚기가 있으면 여기서 던진다
    rows = new Uint8Array(inflateSync(packed, { windowBits: 10 }))
  }
  switch (profile.protocol) {
    case 'MARKLIFE_YXQ2':
      r.expect([0x1f, 0x70, 0x01, DENSITY.MARKLIFE_YXQ2![density - 1] as number], '농도')
      r.expect([0x10, 0xff, 0xf1, 0x02], '시작')
      yxq()
      r.expect([0x1d, 0x0c, 0x10, 0xff, 0xf1, 0x45], '다음 라벨·끝')
      break
    case 'MARKLIFE_YXQ3':
    case 'MARKLIFE_YXQ8':
      r.expect([0x1f, 0x80, 0x02, 0x20, 0x1f, 0x70, 0x02, DENSITY[profile.protocol]![density - 1] as number, 0, 0, 0, 0, 0, 0, 0x1f, 0xc0, 0x01, 0x00, 0x1f, 0x11, 0x51], '앞')
      yxq()
      r.expect([0x1f, 0x12, 0x20, 0x00, 0x1f, 0xc0, 0x01, 0x01, 0x1f, 0x11, 0x50], '뒤')
      break
    case 'MARKLIFE_L11': {
      r.expect([...new Array<number>(15).fill(0), 0x10, 0xff, 0xf1, 0x02], '00×15 · 시작')
      r.expect([0x1d, 0x76, 0x30, 0x00], 'GS v 0')
      const h = r.take(4)
      widthBytes = (h[0] as number) | ((h[1] as number) << 8)
      height = (h[2] as number) | ((h[3] as number) << 8)
      rows = r.take(widthBytes * height).slice()
      r.expect([0x1d, 0x0c, 0x10, 0xff, 0xf1, 0x45], '다음 라벨·끝')
      break
    }
    default:
      throw new Error(`모르는 방식 ${profile.protocol}`)
  }
  expect(r.at, '남는 바이트 없음').toBe(bytes.length)
  return { widthBytes: widthBytes!, height: height!, rows: rows! }
}

/** 무작위 그림: 무작위 점·반복 무늬·꽉 참·빈 그림, 남는 비트에 1을 넣은 것 포함 */
const bitmapArb = (maxW: number, maxH: number): fc.Arbitrary<LabelBitmap> =>
  fc
    .record({
      width: fc.integer({ min: 1, max: maxW }),
      height: fc.integer({ min: 1, max: maxH }),
      kind: fc.constantFrom('random', 'stripes', 'full', 'empty', 'checker'),
      seed: fc.integer({ min: 0, max: 0x7fffffff }),
      dirtySpare: fc.boolean(),
    })
    .map(({ width, height, kind, seed, dirtySpare }) => {
      const row = bytesPerRow(width)
      const data = new Uint8Array(row * height)
      let s = seed || 1
      const rnd = (): number => {
        s ^= s << 13
        s ^= s >>> 17
        s ^= s << 5
        return s >>> 0
      }
      for (let i = 0; i < data.length; i++) {
        const y = Math.floor(i / row)
        data[i] = kind === 'random' ? rnd() & 0xff : kind === 'full' ? 0xff : kind === 'empty' ? 0 : kind === 'stripes' ? (y % 3 === 0 ? 0xff : 0x00) : y % 2 === 0 ? 0xaa : 0x55
      }
      const spare = row * 8 - width
      for (let y = 0; y < height; y++) {
        const at = y * row + row - 1
        const mask = (0xff << spare) & 0xff
        data[at] = dirtySpare ? (data[at] as number) | (~mask & 0xff) : (data[at] as number) & mask
      }
      return { width, height, data }
    })

const densityArb = fc.oneof(fc.constantFrom(1, 2, 3, undefined), fc.constantFrom(0, 4, 1.5, -1, Number.NaN))

describe('AC-N1-70 작업 바이트 — 무작위 그림 × 모든 프로필 × 농도', () => {
  const okRuns = new Map<string, number>()
  it('바이트가 L-12 2의 꼴이고, 풀면 (돌린 뒤 남는 비트를 지운) 줄과 같다; 넓으면 언제나 IMAGE_TOO_WIDE', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL), fc.oneof(bitmapArb(400, 500), bitmapArb(400, 110)), densityArb, (profile, image, density) => {
        const before = image.data.slice()
        Object.freeze(image)
        const options = density === undefined ? {} : { density }
        const result = buildPrintJob(profile, image, options)
        // 받은 그림은 바뀌지 않는다
        expect(hex(image.data)).toBe(hex(before))
        const sendWidth = profile.rotate === 'CW90' ? image.height : image.width
        if (sendWidth > profile.headDots) {
          expect(result).toEqual({ ok: false, code: 'IMAGE_TOO_WIDE' })
          return
        }
        const yxq = profile.protocol !== 'MARKLIFE_L11'
        const d = density ?? 2
        if (yxq && !(Number.isInteger(d) && d >= 1 && d <= 3)) {
          expect(result).toEqual({ ok: false, code: 'INVALID_DENSITY' })
          return
        }
        if (!result.ok) throw new Error(`바이트를 만들지 못했다: ${result.code}`)
        okRuns.set(profile.rotate, (okRuns.get(profile.rotate) ?? 0) + 1)
        const want = expectedRows(profile, image)
        const got = readJob(profile, result.bytes, yxq ? d : 2)
        expect(got.widthBytes).toBe(bytesPerRow(want.width))
        expect(got.height).toBe(want.height)
        expect(hex(got.rows)).toBe(hex(want.rows))
        // 결정성: 두 번째도 바이트까지 같다
        const again = buildPrintJob(profile, image, options)
        expect(again.ok && hex(again.bytes)).toBe(hex(result.bytes))
        // L11은 농도와 상관없이 같은 바이트
        if (!yxq) {
          const other = buildPrintJob(profile, image, { density: 3 })
          expect(other.ok && hex(other.bytes)).toBe(hex(result.bytes))
        }
      }),
      { numRuns: 600, seed: 0x4e31 },
    )
    // 성공 경로가 실제로 돌았는지 (돌림 있는 것·없는 것 모두)
    expect(okRuns.get('CW90') ?? 0).toBeGreaterThan(30)
    expect(okRuns.get('NONE') ?? 0).toBeGreaterThan(30)
  })

  it('반복 무늬가 긴 큰 그림(384×400·반복 주기 1KiB 언저리)도 창 10으로 풀린다', () => {
    for (const period of [760, 762, 763, 768, 1000, 1024, 1025, 1030]) {
      const width = 384
      const height = 400
      const data = new Uint8Array(48 * height)
      // 주기 period 바이트마다 같은 무작위 블록이 되풀이된다 — 먼 되짚기를 꾀어낸다
      let s = period
      const block = new Uint8Array(period).map(() => {
        s = (s * 1103515245 + 12345) & 0x7fffffff
        return s >>> 16
      })
      for (let i = 0; i < data.length; i++) data[i] = block[i % period] as number
      const image = { width, height, data }
      for (const profile of [MARKLIFE_PROFILES[0]!, MARKLIFE_PROFILES[1]!, MARKLIFE_PROFILES[2]!]) {
        const r = buildPrintJob(profile, image)
        if (!r.ok) throw new Error(r.code)
        const got = readJob(profile, r.bytes, 2)
        expect(hex(got.rows), `${profile.id} 주기 ${period}`).toBe(hex(data))
      }
    }
  })

  it('L-1 형식이 아닌 그림은 PRINT_FAILED (넓은 폭·나쁜 농도보다 먼저)', () => {
    const bad: unknown[] = [
      { width: 0, height: 10, data: new Uint8Array(0) },
      { width: 8, height: 0, data: new Uint8Array(0) },
      { width: 8.5, height: 1, data: new Uint8Array(2) },
      { width: 9, height: 2, data: new Uint8Array(3) },
      { width: 500, height: 2, data: new Uint8Array(10) },
      { width: 8, height: 2, data: [0, 0] },
      null,
    ]
    for (const profile of ALL)
      for (const image of bad) {
        expect(buildPrintJob(profile, image as LabelBitmap, { density: 9 }), `${profile.id} ${JSON.stringify(image)}`).toEqual({ ok: false, code: 'PRINT_FAILED' })
      }
  })
})
