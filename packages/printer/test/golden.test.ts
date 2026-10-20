// 프린터 골든 (AC-N1-01, D-N1-01·09): tests/golden/printer/*.json의 모든 사례를 프린터 패키지의 순수 함수로 돌려 out과 비교한다.
// 형식 계약(tests/golden/README.md "프린터 골든")을 어기면 읽기 오류다. 파일 수·사례 수는 고정값으로 단언한다 — 사례가 조용히 빠지면 실패한다.
// 골든 파일은 보호 경로라 고치지 않는다. yxqRaster는 압축 바이트가 아니라 머리·길이 칸·CMF 28·FLG·사전 비트·창 10으로 풀기·L바이트에서 끝남을 본다.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync, inflateSync } from 'node:zlib'
import { createBitmap, type LabelBitmap } from '@livejjim/label'
import { describe, expect, it } from 'vitest'
import { EXPERIMENTAL_PROFILES, MARKLIFE_PROFILES, buildPrintJob, printerProfile, profileForDeviceName, unsupportedReason, type ModelProfile } from '../src/index.ts'

const GOLDEN_DIR = join(import.meta.dirname, '..', '..', '..', 'tests', 'golden', 'printer')

const FILE_KEYS = ['kind', 'about', 'cases']
const KINDS = ['job', 'name', 'profile', 'browser'] as const
type Kind = (typeof KINDS)[number]
const CASE_KEYS: Record<Kind, readonly string[]> = {
  job: ['id', 'title', 'refs', 'note', 'profile', 'image', 'options', 'out'],
  name: ['id', 'title', 'refs', 'note', 'name', 'out'],
  profile: ['id', 'title', 'refs', 'note', 'profile', 'out'],
  browser: ['id', 'title', 'refs', 'note', 'ua', 'maxTouchPoints', 'out'],
}
const REQUIRED: Record<Kind, readonly string[]> = {
  job: ['id', 'title', 'refs', 'profile', 'image', 'out'],
  name: ['id', 'title', 'refs', 'name', 'out'],
  profile: ['id', 'title', 'refs', 'profile', 'out'],
  browser: ['id', 'title', 'refs', 'ua', 'out'],
}
const PROFILE_FIELDS = ['maker', 'displayName', 'protocol', 'dpi', 'headDots', 'rotate', 'sizes', 'defaultSize', 'density', 'experimental', 'fallbackApp', 'namePrefix'] as const
const PROFILE_IDS = ['NIIMBOT_B1', 'MARKLIFE_P50', 'MARKLIFE_S2', 'MARKLIFE_X2', 'MARKLIFE_P11', 'MARKLIFE_P12', 'MARKLIFE_P15', 'MARKLIFE_L13', 'MARKLIFE_LP90', 'MARKLIFE_LP15', 'BAUATO_PPA2L']
const JOB_ERRORS = ['IMAGE_TOO_WIDE', 'INVALID_DENSITY', 'PRINT_FAILED']
const REASONS = ['IOS', 'IN_APP', 'OTHER']
const FILLS = ['white', 'black', 'border']
const CASE_ID = /^G-PRT-N1-\d{2}$/

type Fill = 'white' | 'black' | 'border'
type ImageSpec = { readonly width: number; readonly height: number; readonly rows: readonly string[] } | { readonly width: number; readonly height: number; readonly fill: Fill }
type RasterSpec = { readonly widthBytes: number; readonly height: number; readonly rows?: readonly string[]; readonly fill?: Fill }
type Piece = string | { readonly yxqRaster: RasterSpec } | { readonly rawRaster: RasterSpec }

interface GoldenCase {
  readonly id: string
  readonly title: string
  readonly refs: readonly string[]
  readonly profile?: string
  readonly image?: ImageSpec
  readonly options?: { readonly density: number }
  readonly name?: string
  readonly ua?: string
  readonly maxTouchPoints?: number
  readonly out: Record<string, unknown>
}
interface GoldenFile {
  readonly file: string
  readonly kind: Kind
  readonly cases: readonly GoldenCase[]
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isInt = (v: unknown, min = 0): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min

/** 16진 글(공백 허용) → 바이트. 형식이 틀리면 읽기 오류 */
function hex(text: string, where: string): Uint8Array {
  const compact = text.replace(/\s+/g, '')
  if (!/^(?:[0-9A-Fa-f]{2})*$/.test(compact)) throw new Error(`${where}: 16진 글 형식 ${text}`)
  return Uint8Array.from(compact.match(/../g) ?? [], (b) => parseInt(b, 16))
}

function checkRows(rows: unknown, width: number, height: number, where: string): void {
  if (!Array.isArray(rows) || rows.length !== height) throw new Error(`${where}: rows 수가 높이와 다르다`)
  for (const row of rows) {
    if (typeof row !== 'string') throw new Error(`${where}: rows는 글이어야 한다`)
    if (hex(row, where).length !== Math.ceil(width / 8)) throw new Error(`${where}: 한 줄 바이트 수`)
  }
}

function checkImage(image: unknown, where: string): void {
  if (!isObject(image)) throw new Error(`${where}: image 형식`)
  const keys = Object.keys(image).sort()
  if (!isInt(image.width, 1) || !isInt(image.height, 1)) throw new Error(`${where}: image 크기`)
  if ('rows' in image) {
    if (keys.join() !== 'height,rows,width') throw new Error(`${where}: 모르는 image 키 ${keys.join()}`)
    checkRows(image.rows, image.width, image.height, where)
  } else {
    if (keys.join() !== 'fill,height,width') throw new Error(`${where}: 모르는 image 키 ${keys.join()}`)
    if (!FILLS.includes(image.fill as string)) throw new Error(`${where}: 모르는 fill`)
    if (image.width % 8 !== 0) throw new Error(`${where}: fill 그림 폭은 8의 배수`)
  }
}

function checkRaster(raster: unknown, where: string): void {
  if (!isObject(raster)) throw new Error(`${where}: 래스터 형식`)
  if (!isInt(raster.widthBytes, 1) || !isInt(raster.height, 1)) throw new Error(`${where}: 래스터 크기`)
  const keys = Object.keys(raster).sort().join()
  if ('rows' in raster) {
    if (keys !== 'height,rows,widthBytes') throw new Error(`${where}: 모르는 래스터 키 ${keys}`)
    checkRows(raster.rows, raster.widthBytes * 8, raster.height, where)
  } else {
    if (keys !== 'fill,height,widthBytes') throw new Error(`${where}: 모르는 래스터 키 ${keys}`)
    if (!FILLS.includes(raster.fill as string)) throw new Error(`${where}: 모르는 fill`)
  }
}

function checkOut(kind: Kind, out: unknown, where: string): void {
  if (!isObject(out)) throw new Error(`${where}: out 형식`)
  const keys = Object.keys(out)
  if (kind === 'job') {
    if ('error' in out) {
      if (keys.length !== 1 || !JOB_ERRORS.includes(out.error as string)) throw new Error(`${where}: 오류 out 형식`)
      return
    }
    if (keys.join() !== 'bytes' || !Array.isArray(out.bytes) || out.bytes.length === 0) throw new Error(`${where}: out.bytes 형식`)
    for (const piece of out.bytes as unknown[]) {
      if (typeof piece === 'string') hex(piece, where)
      else if (isObject(piece) && Object.keys(piece).join() === 'yxqRaster') checkRaster(piece.yxqRaster, where)
      else if (isObject(piece) && Object.keys(piece).join() === 'rawRaster') checkRaster(piece.rawRaster, where)
      else throw new Error(`${where}: 모르는 조각 ${JSON.stringify(piece)}`)
    }
    return
  }
  if (kind === 'name') {
    if (keys.join() !== 'profile' || (out.profile !== null && !PROFILE_IDS.includes(out.profile as string))) throw new Error(`${where}: name out 형식`)
    return
  }
  if (kind === 'profile') {
    if ([...keys].sort().join() !== [...PROFILE_FIELDS].sort().join()) throw new Error(`${where}: profile out은 열두 칸이 모두 있어야 한다`)
    return
  }
  if (keys.join() !== 'reason' || !REASONS.includes(out.reason as string)) throw new Error(`${where}: browser out 형식`)
}

/** 골든 파일을 읽고 형식 계약을 검사한다. 어기면 읽기 오류로 던진다 */
function loadGolden(dir: string): GoldenFile[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
  const ids = new Set<string>()
  return files.map((file) => {
    const raw = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<string, unknown>
    const where = `읽기 오류 ${file}`
    for (const key of Object.keys(raw)) if (!FILE_KEYS.includes(key)) throw new Error(`${where}: 모르는 키 ${key}`)
    const kind = raw.kind as Kind
    if (!KINDS.includes(kind)) throw new Error(`${where}: 모르는 kind ${String(raw.kind)}`)
    if (!Array.isArray(raw.cases)) throw new Error(`${where}: cases가 목록이 아니다`)
    for (const c of raw.cases as Record<string, unknown>[]) {
      const at = `${where} ${String(c.id)}`
      for (const key of Object.keys(c)) if (!CASE_KEYS[kind].includes(key)) throw new Error(`${at}: 모르는 키 ${key}`)
      for (const key of REQUIRED[kind]) if (!Object.hasOwn(c, key)) throw new Error(`${at}: ${key}가 없다`)
      if (typeof c.id !== 'string' || !CASE_ID.test(c.id)) throw new Error(`${at}: id 형식`)
      if (ids.has(c.id)) throw new Error(`${at}: 겹친 id`)
      ids.add(c.id)
      if (typeof c.title !== 'string' || !Array.isArray(c.refs) || c.refs.length === 0) throw new Error(`${at}: title·refs 형식`)
      if (c.note !== undefined && typeof c.note !== 'string') throw new Error(`${at}: note 형식`)
      if (kind === 'job' || kind === 'profile') {
        if (!PROFILE_IDS.includes(c.profile as string)) throw new Error(`${at}: 모르는 프로필 ${String(c.profile)}`)
      }
      if (kind === 'job') {
        if (c.profile === 'NIIMBOT_B1') throw new Error(`${at}: job 사례에 NIIMBOT_B1은 쓰지 않는다`)
        checkImage(c.image, at)
        if (c.options !== undefined && (!isObject(c.options) || Object.keys(c.options).join() !== 'density' || typeof c.options.density !== 'number')) throw new Error(`${at}: options 형식`)
      }
      if (kind === 'name' && typeof c.name !== 'string') throw new Error(`${at}: name 형식`)
      if (kind === 'browser') {
        if (typeof c.ua !== 'string') throw new Error(`${at}: ua 형식`)
        if (c.maxTouchPoints !== undefined && !isInt(c.maxTouchPoints)) throw new Error(`${at}: maxTouchPoints 형식`)
      }
      checkOut(kind, c.out, at)
    }
    return { file, kind, cases: raw.cases as unknown as GoldenCase[] }
  })
}

/** fill 그림의 줄 바이트 (폭 = widthBytes × 8) */
function fillRows(widthBytes: number, height: number, fill: Fill): Uint8Array {
  const out = new Uint8Array(widthBytes * height)
  if (fill === 'black') out.fill(0xff)
  if (fill === 'border') {
    for (let y = 0; y < height; y++) {
      if (y === 0 || y === height - 1) out.fill(0xff, y * widthBytes, (y + 1) * widthBytes)
      else {
        out[y * widthBytes] = (out[y * widthBytes] as number) | 0x80
        out[(y + 1) * widthBytes - 1] = (out[(y + 1) * widthBytes - 1] as number) | 0x01
      }
    }
  }
  return out
}

function rasterRows(spec: RasterSpec, where: string): Uint8Array {
  if (spec.rows) {
    const out = new Uint8Array(spec.widthBytes * spec.height)
    spec.rows.forEach((row, y) => out.set(hex(row, where), y * spec.widthBytes))
    return out
  }
  return fillRows(spec.widthBytes, spec.height, spec.fill as Fill)
}

function imageOf(spec: ImageSpec, where: string): LabelBitmap {
  if ('rows' in spec) {
    const image = createBitmap(spec.width, spec.height)
    spec.rows.forEach((row, y) => image.data.set(hex(row, where), y * Math.ceil(spec.width / 8)))
    return image
  }
  return { width: spec.width, height: spec.height, data: fillRows(spec.width / 8, spec.height, spec.fill) }
}

const be16 = (b: Uint8Array, i: number): number => ((b[i] as number) << 8) | (b[i + 1] as number)
const le16 = (b: Uint8Array, i: number): number => (b[i] as number) | ((b[i + 1] as number) << 8)
const be32 = (b: Uint8Array, i: number): number => (((b[i] as number) << 24) | ((b[i + 1] as number) << 16) | ((b[i + 2] as number) << 8) | (b[i + 3] as number)) >>> 0
const hexOf = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ')

/**
 * 압축 바이트가 창 1KiB zlib로 rows와 같은지 (README `yxqRaster` ①~④). 압축 바이트 자체는 비교하지 않는다(D-N1-09).
 * ④ L바이트에서 정확히 끝난다: L바이트 전부로 풀리고(Adler-32 포함), 마지막 한 바이트를 빼면 풀리지 않는다.
 */
export function expectZlibWindow1K(packed: Uint8Array, rows: Uint8Array, where: string): void {
  expect(packed[0], `${where}: CMF`).toBe(0x28)
  const flg = packed[1] as number
  expect((0x28 * 256 + flg) % 31, `${where}: FLG`).toBe(0)
  expect(flg & 0x20, `${where}: 사전 비트`).toBe(0)
  const inflated = new Uint8Array(inflateSync(packed, { windowBits: 10 }))
  expect(inflated.length, `${where}: 푼 길이`).toBe(rows.length)
  expect(Buffer.compare(Buffer.from(inflated), Buffer.from(rows)), `${where}: 푼 줄`).toBe(0)
  expect(() => inflateSync(packed.subarray(0, packed.length - 1), { windowBits: 10 }), `${where}: L바이트에서 끝남`).toThrow()
}

/** 만든 바이트를 조각과 처음부터 끝까지 차례로 대조한다 */
export function expectBytesMatchPieces(bytes: Uint8Array, pieces: readonly Piece[], where: string): void {
  let at = 0
  pieces.forEach((piece, k) => {
    const here = `${where} 조각 ${String(k)}`
    if (typeof piece === 'string') {
      const want = hex(piece, here)
      expect(hexOf(bytes.subarray(at, at + want.length)), here).toBe(hexOf(want))
      at += want.length
      return
    }
    if ('yxqRaster' in piece) {
      const spec = piece.yxqRaster
      expect(hexOf(bytes.subarray(at, at + 2)), `${here}: 1F 10`).toBe('1F 10')
      expect(be16(bytes, at + 2), `${here}: 한 줄 바이트 수`).toBe(spec.widthBytes)
      expect(be16(bytes, at + 4), `${here}: 높이`).toBe(spec.height)
      const length = be32(bytes, at + 6)
      expect(at + 10 + length, `${here}: 압축 길이 칸`).toBeLessThanOrEqual(bytes.length)
      expectZlibWindow1K(bytes.subarray(at + 10, at + 10 + length), rasterRows(spec, here), here)
      at += 10 + length
      return
    }
    const spec = piece.rawRaster
    expect(hexOf(bytes.subarray(at, at + 4)), `${here}: 1D 76 30 00`).toBe('1D 76 30 00')
    expect(le16(bytes, at + 4), `${here}: 한 줄 바이트 수`).toBe(spec.widthBytes)
    expect(le16(bytes, at + 6), `${here}: 높이`).toBe(spec.height)
    const rows = rasterRows(spec, here)
    expect(hexOf(bytes.subarray(at + 8, at + 8 + rows.length)), `${here}: 줄 그대로`).toBe(hexOf(rows))
    at += 8 + rows.length
  })
  expect(at, `${where}: 남는 바이트 없음`).toBe(bytes.length)
}

const golden = loadGolden(GOLDEN_DIR)
const NAME_LIST: readonly ModelProfile[] = [...MARKLIFE_PROFILES, ...EXPERIMENTAL_PROFILES]

describe('프린터 골든 (AC-N1-01)', () => {
  it('파일 4개 · 사례 84개(작업 34 · 이름 24 · 프로필 11 · 브라우저 15)를 읽는다', () => {
    expect(golden.map((g) => g.file)).toEqual(['browser.json', 'job.json', 'name.json', 'profile.json'])
    const count = (kind: Kind): number => golden.filter((g) => g.kind === kind).reduce((n, g) => n + g.cases.length, 0)
    expect([count('job'), count('name'), count('profile'), count('browser')]).toEqual([34, 24, 11, 15])
    expect(golden.reduce((n, g) => n + g.cases.length, 0)).toBe(84)
  })

  for (const g of golden) {
    describe(g.file, () => {
      for (const c of g.cases) {
        it(`${c.id} ${c.title}`, () => {
          if (g.kind === 'job') {
            const profile = printerProfile(c.profile as string)
            if (!profile) throw new Error('프로필 없음')
            const image = imageOf(c.image as ImageSpec, c.id)
            const before = image.data.slice()
            const result = buildPrintJob(profile, Object.freeze({ ...image }), c.options ?? {})
            // 받은 그림을 바꾸지 않는다
            expect(Array.from(image.data)).toEqual(Array.from(before))
            if ('error' in c.out) {
              expect(result).toEqual({ ok: false, code: c.out.error })
              expect('bytes' in result).toBe(false)
              return
            }
            expect(result.ok).toBe(true)
            if (!result.ok) return
            expectBytesMatchPieces(result.bytes, c.out.bytes as Piece[], c.id)
            return
          }
          if (g.kind === 'name') {
            expect(profileForDeviceName(c.name, NAME_LIST)?.id ?? null).toBe(c.out.profile)
            return
          }
          if (g.kind === 'profile') {
            const profile = printerProfile(c.profile as string)
            if (!profile) throw new Error('프로필 없음')
            const picked = Object.fromEntries(PROFILE_FIELDS.map((f) => [f, profile[f]]))
            expect(JSON.parse(JSON.stringify(picked))).toStrictEqual(c.out)
            for (const f of PROFILE_FIELDS) expect(Object.hasOwn(profile, f), f).toBe(true)
            return
          }
          expect(unsupportedReason(c.ua, c.maxTouchPoints ?? 0)).toBe(c.out.reason)
        })
      }
    })
  }
})

describe('프린터 골든 읽기 — 형식 계약을 어기면 읽기 오류 (AC-N1-01)', () => {
  it('사례 ID 형식: G-PRT-N1-<두 자리>만 받는다', () => {
    for (const id of ['G-PRT-N1-01', 'G-PRT-N1-95']) expect(CASE_ID.test(id), id).toBe(true)
    for (const id of ['G-PRT-N1-1', 'G-PRT-N1-001', 'G-PRT-001', 'G-LBL-N1-01', 'G-PRT-N2-01']) expect(CASE_ID.test(id), id).toBe(false)
  })

  it('yxqRaster를 창 15(78)로 압축한 바이트로 바꾸면 실패한다', () => {
    const rows = Uint8Array.from([0x80, 0x00, 0x00, 0x01, 0xff, 0xff])
    // 기본 창(windowBits 15, 첫 바이트 78)으로 압축한 바이트 — 풀면 같은 줄이지만 프린터가 버린다
    const window15 = new Uint8Array(deflateSync(rows))
    expect(window15[0]).toBe(0x78)
    expect(() => expectZlibWindow1K(window15, rows, 'window15')).toThrow()
    expect(() => expectZlibWindow1K(new Uint8Array(deflateSync(rows, { windowBits: 10 })), rows, 'window10')).not.toThrow()
  })

  it('기대값 하나를 바꾸면 실패한다 (예: G-PRT-N1-15의 A0 → A1)', () => {
    const c = golden.find((g) => g.kind === 'job')?.cases.find((x) => x.id === 'G-PRT-N1-15')
    const profile = printerProfile('MARKLIFE_P12') as ModelProfile
    const result = buildPrintJob(profile, imageOf(c?.image as ImageSpec, 'N1-15'))
    if (!result.ok) throw new Error('바이트 없음')
    const pieces = (c?.out.bytes as string[]).map((p) => p.replace(' 10 00 A0 ', ' 10 00 A1 '))
    expect(() => expectBytesMatchPieces(result.bytes, pieces, 'N1-15 바꿈')).toThrow()
    expect(() => expectBytesMatchPieces(result.bytes, c?.out.bytes as string[], 'N1-15')).not.toThrow()
  })
})
