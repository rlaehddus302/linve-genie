// 내장 글꼴 읽기 (LABEL_RULES L-2 글꼴, D-P1-04).
// 글꼴 파일(OpenType/TrueType)의 글자 표(cmap)와 세로 치수(head·hhea)만 읽는 순수 함수다.
// 그리기는 이 표에 있는 글자만 캔버스에 맡기고, 없는 글자는 빈 네모로 그린다 — 캔버스가 시스템 글꼴로 대신 그리지 않게.

/** 캔버스에 등록할 글꼴 이름. 시스템 글꼴 이름과 겹치지 않게 따로 짓는다 */
export const LABEL_FONT_FAMILY = 'LivejjimLabel'

/** 패키지에 들어 있는 글꼴 파일 (packages/label/fonts/) */
export const LABEL_FONT_FILE = 'Pretendard-Bold.otf'

export interface LabelFont {
  /** 캔버스 `font`에 쓰는 이름 */
  readonly family: string
  /** 글꼴 한 칸(em)의 단위 수 */
  readonly unitsPerEm: number
  /** 기준선 위 높이 (em 단위 비율) */
  readonly ascent: number
  /** 기준선 아래 깊이 (em 단위 비율, 양수) */
  readonly descent: number
  /** 이 글꼴에 그 글자(코드 포인트)의 모양이 있는지 */
  hasCodePoint(codePoint: number): boolean
  /** 글자 표에 있는 코드 포인트 수 */
  readonly codePointCount: number
}

export class FontReadError extends Error {
  override readonly name = 'FontReadError'
}

interface TableRecord {
  readonly offset: number
  readonly length: number
}

function readTables(view: DataView): Map<string, TableRecord> {
  if (view.byteLength < 12) throw new FontReadError('글꼴 파일이 너무 짧다')
  const version = view.getUint32(0)
  // 0x00010000 = TrueType, 'OTTO' = CFF, 'true' = 옛 맥 TrueType
  if (version !== 0x00010000 && version !== 0x4f54544f && version !== 0x74727565) {
    throw new FontReadError('OpenType/TrueType 글꼴이 아니다')
  }
  const count = view.getUint16(4)
  const tables = new Map<string, TableRecord>()
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16
    if (at + 16 > view.byteLength) throw new FontReadError('표 목록이 잘렸다')
    const tag = String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3))
    const offset = view.getUint32(at + 8)
    const length = view.getUint32(at + 12)
    if (offset + length > view.byteLength) throw new FontReadError(`표 ${tag}가 파일 밖을 가리킨다`)
    tables.set(tag, { offset, length })
  }
  return tables
}

function table(tables: Map<string, TableRecord>, tag: string): TableRecord {
  const found = tables.get(tag)
  if (!found) throw new FontReadError(`글꼴에 ${tag} 표가 없다`)
  return found
}

/** cmap 부분표 하나를 읽어 코드 포인트 집합에 더한다 (형식 4·12만 — 유니코드 글꼴은 둘 중 하나를 가진다) */
function readSubtable(view: DataView, at: number, out: Set<number>): boolean {
  const format = view.getUint16(at)
  if (format === 4) {
    const segX2 = view.getUint16(at + 6)
    const ends = at + 14
    const starts = ends + segX2 + 2
    const deltas = starts + segX2
    const rangeOffsets = deltas + segX2
    for (let s = 0; s < segX2 / 2; s++) {
      const end = view.getUint16(ends + s * 2)
      const start = view.getUint16(starts + s * 2)
      const delta = view.getInt16(deltas + s * 2)
      const rangeOffsetAt = rangeOffsets + s * 2
      const rangeOffset = view.getUint16(rangeOffsetAt)
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let glyph: number
        if (rangeOffset === 0) glyph = (c + delta) & 0xffff
        else {
          const glyphAt = rangeOffsetAt + rangeOffset + (c - start) * 2
          const raw = glyphAt + 2 <= view.byteLength ? view.getUint16(glyphAt) : 0
          glyph = raw === 0 ? 0 : (raw + delta) & 0xffff
        }
        if (glyph !== 0) out.add(c)
      }
    }
    return true
  }
  if (format === 12) {
    const groups = view.getUint32(at + 12)
    for (let g = 0; g < groups; g++) {
      const base = at + 16 + g * 12
      const start = view.getUint32(base)
      const end = view.getUint32(base + 4)
      const startGlyph = view.getUint32(base + 8)
      for (let c = start; c <= end; c++) {
        if (startGlyph + (c - start) !== 0) out.add(c)
      }
    }
    return true
  }
  return false
}

/** 글꼴 바이트에서 글자 표(유니코드 cmap)의 코드 포인트를 모두 읽는다 */
export function readFontCodePoints(bytes: Uint8Array): Set<number> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const cmap = table(readTables(view), 'cmap')
  const count = view.getUint16(cmap.offset + 2)
  // 유니코드 전체(형식 12)를 먼저, 없으면 BMP(형식 4)
  const candidates: { priority: number; at: number }[] = []
  for (let i = 0; i < count; i++) {
    const rec = cmap.offset + 4 + i * 8
    const platform = view.getUint16(rec)
    const encoding = view.getUint16(rec + 2)
    const at = cmap.offset + view.getUint32(rec + 4)
    const format = view.getUint16(at)
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10))
    if (!unicode) continue
    candidates.push({ priority: format === 12 ? 0 : format === 4 ? 1 : 2, at })
  }
  candidates.sort((a, b) => a.priority - b.priority)
  const out = new Set<number>()
  for (const candidate of candidates) {
    if (readSubtable(view, candidate.at, out)) return out
  }
  throw new FontReadError('유니코드 글자 표(cmap 형식 4·12)가 없다')
}

/** 글꼴 바이트를 읽어 그리기에 필요한 정보를 만든다 */
export function parseLabelFont(bytes: Uint8Array, family: string = LABEL_FONT_FAMILY): LabelFont {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tables = readTables(view)
  const head = table(tables, 'head')
  const hhea = table(tables, 'hhea')
  const unitsPerEm = view.getUint16(head.offset + 18)
  if (unitsPerEm === 0) throw new FontReadError('unitsPerEm이 0이다')
  const ascender = view.getInt16(hhea.offset + 4)
  const descender = view.getInt16(hhea.offset + 6)
  const codePoints = readFontCodePoints(bytes)
  return {
    family,
    unitsPerEm,
    ascent: ascender / unitsPerEm,
    descent: Math.abs(descender) / unitsPerEm,
    hasCodePoint: (codePoint) => codePoints.has(codePoint),
    codePointCount: codePoints.size,
  }
}
