// 작업 바이트 (AC-N1-20~23, LABEL_RULES L-12 2, D-N1-02·09) — 순수 함수·결정성·창 1KiB zlib·돌림·남는 비트·거절.
import { inflateSync } from 'node:zlib'
import { bytesPerRow, createBitmap, defaultTemplate, getPixel, renderProductLabel, type LabelBitmap } from '@livejjim/label'
import { createNodeRenderEnv } from '@livejjim/label/node'
import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  B1_PROFILE,
  BAUATO_PPA2L,
  MARKLIFE_P12,
  MARKLIFE_PROFILES,
  MARKLIFE_S2,
  MARKLIFE_X2,
  PRINTER_PROFILES,
  buildPrintJob,
  rotateClockwise,
  zlibWindow1K,
  type ModelProfile,
} from '../src/index.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

const PROFILES: readonly ModelProfile[] = PRINTER_PROFILES.filter((p) => p.protocol !== 'NIIMBOT_B1')

/** 결정적 의사 난수 그림 */
function randomImage(width: number, height: number, seed: number, density = 0.5): LabelBitmap {
  const image = createBitmap(width, height)
  let v = seed >>> 0 || 1
  for (let i = 0; i < image.data.length; i++) {
    let byte = 0
    for (let b = 0; b < 8; b++) {
      v = (Math.imul(v, 1103515245) + 12345) >>> 0
      if ((v >>> 16) / 65536 < density) byte |= 0x80 >> b
    }
    image.data[i] = byte
  }
  return image
}

/** 남는 비트를 지운 줄 */
function cleaned(image: LabelBitmap): Uint8Array {
  const row = bytesPerRow(image.width)
  const out = image.data.slice()
  const spare = row * 8 - image.width
  if (spare > 0) for (let y = 0; y < image.height; y++) out[y * row + row - 1] = (out[y * row + row - 1] as number) & ((0xff << spare) & 0xff)
  return out
}

/** YXQ 래스터를 꺼낸다 (머리 위치는 방식마다) */
function yxqRaster(bytes: Uint8Array, profile: ModelProfile): { widthBytes: number; height: number; length: number; packed: Uint8Array; end: number } {
  const at = profile.protocol === 'MARKLIFE_YXQ2' ? 8 : 21
  expect([bytes[at], bytes[at + 1]]).toEqual([0x1f, 0x10])
  const widthBytes = ((bytes[at + 2] as number) << 8) | (bytes[at + 3] as number)
  const height = ((bytes[at + 4] as number) << 8) | (bytes[at + 5] as number)
  const length = (((bytes[at + 6] as number) << 24) | ((bytes[at + 7] as number) << 16) | ((bytes[at + 8] as number) << 8) | (bytes[at + 9] as number)) >>> 0
  return { widthBytes, height, length, packed: bytes.subarray(at + 10, at + 10 + length), end: at + 10 + length }
}

function l11Raster(bytes: Uint8Array): LabelBitmap {
  const at = 19
  expect(Array.from(bytes.subarray(0, 19))).toEqual([...new Array<number>(15).fill(0), 0x10, 0xff, 0xf1, 0x02])
  expect(Array.from(bytes.subarray(at, at + 4))).toEqual([0x1d, 0x76, 0x30, 0x00])
  const widthBytes = (bytes[at + 4] as number) | ((bytes[at + 5] as number) << 8)
  const height = (bytes[at + 6] as number) | ((bytes[at + 7] as number) << 8)
  const data = bytes.slice(at + 8, at + 8 + widthBytes * height)
  expect(Array.from(bytes.subarray(at + 8 + widthBytes * height))).toEqual([0x1d, 0x0c, 0x10, 0xff, 0xf1, 0x45])
  return { width: widthBytes * 8, height, data }
}

const ok = (profile: ModelProfile, image: LabelBitmap, density?: number): Uint8Array => {
  const r = buildPrintJob(profile, image, density === undefined ? {} : { density })
  if (!r.ok) throw new Error(r.code)
  return r.bytes
}

describe('작업 바이트 순수 함수와 결정성 (AC-N1-20)', () => {
  it('같은 입력을 두 번 부르면 바이트까지 같다 — 받은 그림(얼린 그림)을 바꾸지 않는다', () => {
    for (const profile of PROFILES) {
      const source = randomImage(profile.headDots === 96 ? 320 : 384, 96, 11)
      const before = source.data.slice()
      const frozen = Object.freeze({ width: source.width, height: source.height, data: source.data })
      const a = ok(profile, frozen)
      const b = ok(profile, frozen)
      expect(Buffer.from(a).equals(Buffer.from(b)), profile.id).toBe(true)
      expect(Array.from(source.data)).toEqual(Array.from(before))
    }
  })

  it('남는 비트에 1이 있는 그림을 넣어도 받은 그림은 그대로다', () => {
    const image = randomImage(10, 5, 3, 1)
    const before = image.data.slice()
    for (const profile of [MARKLIFE_S2, BAUATO_PPA2L, MARKLIFE_P12]) ok(profile, image)
    expect(Array.from(image.data)).toEqual(Array.from(before))
  })

  it('50×30 상품 라벨 30장(서로 다른 데이터)으로도 두 번 만든 바이트가 같다', () => {
    const env = createNodeRenderEnv()
    const t = { ...defaultTemplate('product'), shopName: '다육농장' }
    for (let i = 0; i < 30; i++) {
      const r = renderProductLabel(env, t, { no: 100 + i, name: `왕비뇌신금 ${String(i)}호`, price: 8000 + i * 500, date: '2026-10-08', buyer: { kind: 'youtube', name: `구매자${String(i)}` } })
      if (!r.ok) throw new Error('렌더')
      for (const profile of [MARKLIFE_S2, MARKLIFE_PROFILES[0] as ModelProfile, MARKLIFE_X2]) {
        expect(Buffer.from(ok(profile, r.image)).equals(Buffer.from(ok(profile, r.image))), `${profile.id} ${String(i)}`).toBe(true)
      }
    }
  })

  it('시각·난수·시간대를 읽지 않는다 (Date.now·Math.random을 던지게 하고 TZ를 바꿔도 같은 바이트)', () => {
    const image = randomImage(384, 240, 5, 0.1)
    const before = PROFILES.map((p) => ok(p, p.headDots === 96 ? randomImage(320, 96, 5) : image))
    const tz = process.env.TZ
    process.env.TZ = 'Pacific/Honolulu'
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Date.now')
    })
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random')
    })
    try {
      PROFILES.forEach((p, i) => {
        expect(Buffer.from(ok(p, p.headDots === 96 ? randomImage(320, 96, 5) : image)).equals(Buffer.from(before[i] as Uint8Array)), p.id).toBe(true)
      })
    } finally {
      process.env.TZ = tz
    }
  })

  it('NIIMBOT B1 바이트는 이 함수가 만들지 않는다 (niimbluelib)', () => {
    expect(() => buildPrintJob(B1_PROFILE, createBitmap(8, 8))).toThrow(RangeError)
  })
})

describe('YXQ — 창 1KiB zlib (AC-N1-21)', () => {
  it('무작위 그림 200장(폭 8~384, 높이 1~400, 반복 무늬·무작위 점): 첫 바이트 28, FLG, 사전 없음, 창 10으로 풀면 (남는 비트를 지운) 줄, 길이 칸 = 압축 바이트 수', () => {
    const imageArb = fc
      .record({
        width: fc.integer({ min: 8, max: 384 }),
        height: fc.integer({ min: 1, max: 400 }),
        kind: fc.constantFrom('random', 'sparse', 'stripes', 'repeat', 'white', 'black'),
        seed: fc.integer({ min: 1, max: 1_000_000 }),
        period: fc.integer({ min: 1, max: 1500 }),
      })
      .map(({ width, height, kind, seed, period }) => {
        const image = kind === 'random' ? randomImage(width, height, seed) : kind === 'sparse' ? randomImage(width, height, seed, 0.03) : createBitmap(width, height)
        if (kind === 'stripes') for (let i = 0; i < image.data.length; i++) image.data[i] = i % 7 < 3 ? 0xff : 0x00
        if (kind === 'repeat') {
          const tile = randomImage(8, Math.max(1, Math.min(period, 64)), seed).data
          for (let i = 0; i < image.data.length; i++) image.data[i] = tile[i % tile.length] as number
        }
        if (kind === 'black') image.data.fill(0xff)
        return image
      })
    fc.assert(
      fc.property(imageArb, fc.constantFrom(MARKLIFE_S2, MARKLIFE_PROFILES[0] as ModelProfile, MARKLIFE_X2), (image, profile) => {
        const bytes = ok(profile, image)
        const raster = yxqRaster(bytes, profile)
        expect(raster.widthBytes).toBe(bytesPerRow(image.width))
        expect(raster.height).toBe(image.height)
        expect(raster.packed.length).toBe(raster.length)
        expect(raster.packed[0]).toBe(0x28)
        const flg = raster.packed[1] as number
        expect((0x28 * 256 + flg) % 31).toBe(0)
        expect(flg & 0x20).toBe(0)
        const inflated = inflateSync(raster.packed, { windowBits: 10 })
        expect(Buffer.from(inflated).equals(Buffer.from(cleaned(image)))).toBe(true)
        // 뒤 명령까지 남는 바이트 없이
        const tail = profile.protocol === 'MARKLIFE_YXQ2' ? [0x1d, 0x0c, 0x10, 0xff, 0xf1, 0x45] : [0x1f, 0x12, 0x20, 0x00, 0x1f, 0xc0, 0x01, 0x01, 0x1f, 0x11, 0x50]
        expect(Array.from(bytes.subarray(raster.end))).toEqual(tail)
      }),
      { numRuns: 200, seed: 20261020 },
    )
  })

  it('압축기 자체: 1KiB를 넘는 되짚기가 없다 — 1KiB보다 먼 곳에만 같은 무늬가 있어도 창 10으로 풀린다', () => {
    const data = new Uint8Array(6000)
    let v = 9
    for (let i = 0; i < 1500; i++) {
      v = (Math.imul(v, 1103515245) + 12345) >>> 0
      data[i] = v >>> 24
    }
    // 1500바이트 무늬를 그대로 되풀이 — 되짚을 곳이 1500바이트 뒤라 창 1KiB 밖이다
    for (let i = 1500; i < data.length; i++) data[i] = data[i - 1500] as number
    const packed = zlibWindow1K(data)
    expect(Buffer.from(inflateSync(packed, { windowBits: 10 })).equals(Buffer.from(data))).toBe(true)
    expect(Buffer.from(inflateSync(zlibWindow1K(new Uint8Array(0)), { windowBits: 10 })).length).toBe(0)
  })
})

describe('L11 — 돌림·줄 그대로·농도 없음 (AC-N1-22)', () => {
  it('CW90: 보낸 래스터의 점 (x, y) = 받은 그림의 점 (y, H−1−x) — 폭이 8의 배수가 아닌 그림 포함', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 400 }), fc.integer({ min: 1, max: 96 }), fc.integer({ min: 1, max: 100000 }), (W, H, seed) => {
        const image = randomImage(W, H, seed)
        const sent = l11Raster(ok(MARKLIFE_P12, image))
        expect(sent.width).toBe(bytesPerRow(H) * 8)
        expect(sent.height).toBe(W)
        for (let y = 0; y < W; y++) for (let x = 0; x < H; x++) if (getPixel(sent, x, y) !== getPixel(image, y, H - 1 - x)) throw new Error(`점 (${String(x)}, ${String(y)})`)
        // 폭(H) 밖의 남는 비트는 0
        for (let y = 0; y < W; y++) for (let x = H; x < sent.width; x++) if (getPixel(sent, x, y)) throw new Error('남는 비트')
        const rotated = rotateClockwise(image)
        expect([rotated.width, rotated.height]).toEqual([H, W])
      }),
      { numRuns: 120, seed: 20261020 },
    )
  })

  it('돌림 NONE이면 줄이 받은 그대로이고, 남는 비트에 1이 있어도 보내는 줄의 남는 비트는 0', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 384 }), fc.integer({ min: 1, max: 120 }), fc.integer({ min: 1, max: 100000 }), (W, H, seed) => {
        const image = randomImage(W, H, seed, 0.7)
        const sent = l11Raster(ok(BAUATO_PPA2L, image))
        expect(sent.width).toBe(bytesPerRow(W) * 8)
        expect(Buffer.from(sent.data).equals(Buffer.from(cleaned(image)))).toBe(true)
      }),
      { numRuns: 100, seed: 20261021 },
    )
  })

  it('L11 작업에는 농도 명령(1F 70·10 FF 10)이 없다 — 농도를 넘겨도 바이트가 같다', () => {
    const image = randomImage(320, 96, 4)
    for (const profile of [MARKLIFE_P12, BAUATO_PPA2L]) {
      const target = profile === BAUATO_PPA2L ? randomImage(384, 50, 4) : image
      const base = ok(profile, target)
      for (const density of [1, 2, 3, 0, 9, 2.5, -1, Number.NaN]) expect(Buffer.from(ok(profile, target, density)).equals(Buffer.from(base)), String(density)).toBe(true)
      // 래스터 앞뒤 명령에 농도 명령이 없다
      const head = Array.from(base.subarray(0, 19))
      expect(head).toEqual([...new Array<number>(15).fill(0), 0x10, 0xff, 0xf1, 0x02])
      expect(Array.from(base.subarray(base.length - 6))).toEqual([0x1d, 0x0c, 0x10, 0xff, 0xf1, 0x45])
    }
  })
})

describe('작업 바이트의 거절 (AC-N1-23)', () => {
  it('헤드보다 넓으면 IMAGE_TOO_WIDE, YXQ 농도가 1~3 정수가 아니면 INVALID_DENSITY, L-1 형식이 아니면 PRINT_FAILED — 바이트 없음', () => {
    expect(buildPrintJob(MARKLIFE_S2, createBitmap(385, 8))).toEqual({ ok: false, code: 'IMAGE_TOO_WIDE' })
    expect(buildPrintJob(MARKLIFE_P12, createBitmap(8, 97))).toEqual({ ok: false, code: 'IMAGE_TOO_WIDE' })
    expect(buildPrintJob(BAUATO_PPA2L, createBitmap(385, 8))).toEqual({ ok: false, code: 'IMAGE_TOO_WIDE' })
    for (const density of [0, 4, 1.5, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(buildPrintJob(MARKLIFE_X2, createBitmap(8, 8), { density })).toEqual({ ok: false, code: 'INVALID_DENSITY' })
    const bad: unknown[] = [
      { width: 16, height: 2, data: new Uint8Array(3) },
      { width: 0, height: 2, data: new Uint8Array(0) },
      { width: 8, height: 0, data: new Uint8Array(0) },
      { width: 1.5, height: 2, data: new Uint8Array(2) },
      { width: 8, height: 1, data: [0] },
      null,
    ]
    for (const image of bad) for (const profile of PROFILES) expect(buildPrintJob(profile, image as LabelBitmap), JSON.stringify(image)).toEqual({ ok: false, code: 'PRINT_FAILED' })
  })

  it('헤드보다 넓으면 농도와 상관없이 언제나 IMAGE_TOO_WIDE (형식이 틀린 그림만 PRINT_FAILED가 먼저)', () => {
    for (const density of [undefined, 0, 2, 4, 2.5]) {
      for (const [profile, image] of [
        [MARKLIFE_S2, createBitmap(392, 8)],
        [MARKLIFE_X2, createBitmap(400, 1)],
        [MARKLIFE_P12, createBitmap(8, 97)],
        [BAUATO_PPA2L, createBitmap(392, 8)],
      ] as const) {
        expect(buildPrintJob(profile, image, density === undefined ? {} : { density }), `${profile.id} ${String(density)}`).toEqual({ ok: false, code: 'IMAGE_TOO_WIDE' })
      }
    }
    expect(buildPrintJob(MARKLIFE_S2, { width: 392, height: 8, data: new Uint8Array(1) }, { density: 9 })).toEqual({ ok: false, code: 'PRINT_FAILED' })
  })
})
