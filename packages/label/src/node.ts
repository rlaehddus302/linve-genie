// Node 전용 진입점 (@livejjim/label/node) — 시험·서버에서 같은 렌더 함수를 Node 캔버스(@napi-rs/canvas)로 돌린다 (AC-P1-10).
// 렌더 경로(src의 다른 파일)는 node: 모듈·fs·path를 쓰지 않는다. 파일을 읽고 캔버스를 만드는 일은 이 파일만 한다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { GlobalFonts, createCanvas } from '@napi-rs/canvas'
import { LABEL_FONT_FAMILY, LABEL_FONT_FILE, parseLabelFont, type LabelFont } from './font.ts'
import type { LabelCanvas2D, LabelRenderEnv } from './render.ts'

/** 패키지에 든 글꼴 파일의 경로 */
export const LABEL_FONT_PATH = fileURLToPath(new URL(`../fonts/${LABEL_FONT_FILE}`, import.meta.url))

/** 내장 글꼴 바이트 */
export function readLabelFontBytes(): Uint8Array {
  return new Uint8Array(readFileSync(LABEL_FONT_PATH))
}

let registered: LabelFont | undefined

/** 내장 글꼴을 Node 캔버스에 한 번 등록하고 그 정보를 돌려준다 */
export function nodeLabelFont(): LabelFont {
  if (registered) return registered
  const bytes = readLabelFontBytes()
  const key = GlobalFonts.register(Buffer.from(bytes), LABEL_FONT_FAMILY)
  if (key === null) throw new Error(`내장 글꼴을 Node 캔버스에 등록하지 못했다: ${LABEL_FONT_PATH}`)
  registered = parseLabelFont(bytes, LABEL_FONT_FAMILY)
  return registered
}

/** Node 렌더 환경: 내장 글꼴 + @napi-rs/canvas */
export function createNodeRenderEnv(): LabelRenderEnv {
  const font = nodeLabelFont()
  return {
    font,
    createContext: (width, height) => createCanvas(width, height).getContext('2d') as unknown as LabelCanvas2D,
  }
}
