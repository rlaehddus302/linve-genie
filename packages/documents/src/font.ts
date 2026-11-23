// 문서 글꼴 (D-207): 부르는 쪽이 넘긴 글꼴 바이트(Pretendard·Noto Sans KR 등 OFL 한글 글꼴)를 한 번 읽어
// 글자 폭 재기·그릴 수 없는 글자 빼기·글자 모양(이미지용)에 쓴다. PDF(pdf-lib)도 같은 fontkit으로 같은 글리프를 고른다.
// 파일을 직접 읽지 않는다 — 브라우저와 Node 둘 다에서 돈다.
import fontkit from '@pdf-lib/fontkit'
import { stripInvisible } from './text.ts'

/** fontkit 글리프 중 쓰는 부분 */
export interface GlyphLike {
  readonly id: number
  readonly advanceWidth: number
  readonly path: { readonly commands: readonly { readonly command: string; readonly args: readonly number[] }[] }
}

interface FontkitFont {
  readonly unitsPerEm: number
  readonly ascent: number
  readonly descent: number
  hasGlyphForCodePoint(codePoint: number): boolean
  layout(text: string): { readonly glyphs: readonly GlyphLike[] }
}

/**
 * 글자 바꿔 끼우기(GSUB) 표를 이름만 바꿔 숨긴 사본 (D-PDF-FONT-01).
 * Pretendard는 숫자 사이 `:`·`-`를 `colon.case`·`hyphen.case`로 바꿔 끼우는데, pdf-lib은 그런 글리프의 폭(/W)을 적지 않아
 * PDF 보기 프로그램이 기본 폭(1000)으로 그려 "23:   30"처럼 벌어진다. 표를 숨기면 글자표(cmap)의 글리프만 쓰여
 * 폭 재기·PDF·이미지가 모두 같은 글리프를 쓴다. 표 목록 순서(태그 정렬)를 지키려고 마지막 글자만 바꾼다(`GSUB`→`GSUX`).
 */
function hideSubstitutions(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 12) return bytes
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint16(4)
  for (let i = 0; i < count; i++) {
    const at = 12 + 16 * i
    if (at + 4 > bytes.length) break
    if (bytes[at] === 0x47 && bytes[at + 1] === 0x53 && bytes[at + 2] === 0x55 && bytes[at + 3] === 0x42) {
      const copy = bytes.slice()
      copy[at + 3] = 0x58
      return copy
    }
  }
  return bytes
}

export class DocumentFont {
  /** 부르는 쪽이 넘긴 글꼴 바이트에서 바꿔 끼우기 표를 숨긴 것 (PDF에 통째로 넣는다) */
  readonly bytes: Uint8Array
  readonly unitsPerEm: number
  /** 글꼴 단위의 위·아래 높이 (아래는 음수) */
  readonly ascent: number
  readonly descent: number
  private readonly font: FontkitFont
  private readonly widths = new Map<string, number>()
  private readonly glyphCache = new Map<number, boolean>()

  constructor(bytes: Uint8Array) {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw new TypeError('글꼴 바이트(Uint8Array)가 필요하다')
    this.bytes = hideSubstitutions(bytes)
    this.font = (fontkit as unknown as { create(buffer: Uint8Array): FontkitFont }).create(this.bytes)
    this.unitsPerEm = this.font.unitsPerEm
    this.ascent = this.font.ascent
    this.descent = this.font.descent
  }

  /** 그 글자를 이 글꼴로 그릴 수 있는가 */
  hasGlyph(codePoint: number): boolean {
    let known = this.glyphCache.get(codePoint)
    if (known === undefined) {
      known = this.font.hasGlyphForCodePoint(codePoint)
      this.glyphCache.set(codePoint, known)
    }
    return known
  }

  /**
   * 그릴 수 있는 글자만 남긴다 (D-207 ③): 제어 글자(줄바꿈·탭·방향 표시 포함)와 글꼴에 없는 글자(이모지 등)를 뺀다.
   * 문서 하나 때문에 일괄이 실패하지 않게 — 그 글자만 빠진다.
   */
  sanitize(text: string): string {
    let out = ''
    for (const char of stripInvisible(typeof text === 'string' ? text : '')) {
      if (this.hasGlyph(char.codePointAt(0) as number)) out += char
    }
    return out
  }

  /** 글리프 (pdf-lib가 PDF에 넣는 것과 같은 fontkit 배치) */
  glyphs(text: string): readonly GlyphLike[] {
    return this.font.layout(text).glyphs
  }

  /** 글자 폭 (pt) = 글리프 advanceWidth 합 × 크기 / unitsPerEm — pdf-lib widthOfTextAtSize와 같은 계산 */
  widthOf(text: string, size: number): number {
    let units = this.widths.get(text)
    if (units === undefined) {
      units = 0
      for (const glyph of this.glyphs(text)) units += glyph.advanceWidth
      this.widths.set(text, units)
    }
    return (units * size) / this.unitsPerEm
  }

  /** 줄 상자 높이 (pt): 위·아래 높이 합 */
  boxHeight(size: number): number {
    return ((this.ascent - this.descent) * size) / this.unitsPerEm
  }

  /** 줄 상자 위에서 기준선까지 (pt) */
  baselineOffset(size: number): number {
    return (this.ascent * size) / this.unitsPerEm
  }
}

/** 글꼴 바이트 → 문서 글꼴 (한 번 읽어 여러 문서에 쓴다) */
export function loadDocumentFont(bytes: Uint8Array): DocumentFont {
  return new DocumentFont(bytes)
}
