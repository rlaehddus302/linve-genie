// 브라우저 진입점 (@livejjim/label/browser) — 내장 글꼴을 캔버스에 올리고 렌더 환경을 만든다 (L-2 글꼴, L-0 3).
// 글꼴은 이 패키지에 든 파일을 앱 번들의 자산으로 받는다(Vite가 아래 new URL(..., import.meta.url)을 자산 주소로 바꾼다).
// 인터넷의 글꼴 주소를 쓰지 않는다. import만으로는 document·navigator를 건드리지 않는다 — 함수를 부를 때만 쓴다.
import { LABEL_FONT_FAMILY, LABEL_FONT_FILE, parseLabelFont, type LabelFont } from './font.ts'
import type { LabelCanvas2D, LabelRenderEnv } from './render.ts'

/** 번들 안 글꼴 자산 주소 */
export const LABEL_FONT_URL: URL = new URL(`../fonts/${LABEL_FONT_FILE}`, import.meta.url)

/**
 * 글꼴 바이트를 브라우저 캔버스에 등록한다(FontFace). 등록이 끝난 뒤에 렌더해야 한다 —
 * 끝나기 전에 그리면 캔버스가 다른 글꼴로 그린다.
 */
export async function registerBrowserLabelFont(bytes: Uint8Array): Promise<LabelFont> {
  const copy = new Uint8Array(bytes)
  const face = new FontFace(LABEL_FONT_FAMILY, copy.buffer)
  await face.load()
  const fonts = (globalThis as { document?: Document }).document?.fonts ?? (globalThis as unknown as { fonts?: FontFaceSet }).fonts
  if (!fonts) throw new Error('이 환경에는 글꼴 목록(document.fonts)이 없다')
  fonts.add(face)
  return parseLabelFont(bytes, LABEL_FONT_FAMILY)
}

/** 번들 안 글꼴 자산을 받아 등록한다 (같은 출처의 파일 — 인터넷 글꼴이 아니다) */
export async function loadBrowserLabelFont(url: URL | string = LABEL_FONT_URL): Promise<LabelFont> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`내장 글꼴 파일을 읽지 못했다 (${String(response.status)})`)
  return registerBrowserLabelFont(new Uint8Array(await response.arrayBuffer()))
}

/** 브라우저 렌더 환경: OffscreenCanvas가 있으면 그것을, 없으면 <canvas>를 쓴다 */
export function createBrowserRenderEnv(font: LabelFont): LabelRenderEnv {
  return {
    font,
    createContext: (width, height) => {
      if (typeof OffscreenCanvas !== 'undefined') {
        const ctx = new OffscreenCanvas(width, height).getContext('2d')
        if (ctx) return ctx as unknown as LabelCanvas2D
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('캔버스 2D를 만들 수 없다')
      return ctx as unknown as LabelCanvas2D
    },
  }
}
