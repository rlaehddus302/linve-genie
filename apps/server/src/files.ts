// 서버가 만드는 파일의 공용 도구 (I2 D-I2-01): 문서 글꼴 읽기, 파일 이름 다듬기, 내려받기 응답(Content-Disposition — UTF-8 filename*와 ASCII 대체 이름).
// - 파일 이름에는 구매자 이름이 들어가므로 로그에 남기지 않는다(AC-I2-81). 응답은 모두 Cache-Control: no-store.
// - 이름 다듬기 뒤 헤더에는 줄바꿈·따옴표·`/`·`\`가 들어가지 않는다(UTF-8 이름은 퍼센트 인코딩, 대체 이름은 영문·숫자·`-`·`.`만).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadDocumentFont, type DocumentFont } from '@livejjim/documents'

let documentFontCache: DocumentFont | null = null

/** 문서 글꼴 (Pretendard Regular, packages/documents/fonts — 처음 한 번 읽는다). 확인서 PDF·PNG가 같은 글꼴을 쓴다 */
export function documentFont(): DocumentFont {
  documentFontCache ??= loadDocumentFont(new Uint8Array(readFileSync(fileURLToPath(import.meta.resolve('@livejjim/documents/fonts/Pretendard-Regular.ttf')))))
  return documentFontCache
}

/** 파일 이름에 못 쓰는 글자 (D-I2-01) */
const FORBIDDEN_IN_NAME = new Set(['\\', '/', ':', '*', '?', '"', '<', '>', '|'])
export const FILE_NAME_PART_MAX = 40
export const NAMELESS_PART = '구매자'

/**
 * 파일 이름의 `<이름>` (D-I2-01): 문서에 찍힌 구매자 이름(글꼴로 그릴 수 없는 글자·제어·서식 글자를 뺀 이름)에서
 * 파일 이름에 못 쓰는 글자(`\` `/` `:` `*` `?` `"` `<` `>` `|`)·제어 글자를 빼고 공백은 `_`, 40글자(코드 포인트)까지, 비면 `구매자`
 */
export function fileNamePart(name: string, font: Pick<DocumentFont, 'sanitize'> = documentFont()): string {
  const printed = font.sanitize(typeof name === 'string' ? name : '')
  let out = ''
  let count = 0
  for (const char of printed.split(' ').filter((part) => part !== '').join(' ')) {
    const code = char.codePointAt(0) as number
    if (FORBIDDEN_IN_NAME.has(char) || code <= 0x1f || (code >= 0x7f && code <= 0x9f)) continue
    out += char === ' ' ? '_' : char
    count++
    if (count >= FILE_NAME_PART_MAX) break
  }
  return out === '' ? NAMELESS_PART : out
}

/** RFC 5987 값 (UTF-8 퍼센트 인코딩 — `'`·`(`·`)`·`*`도 인코딩) */
function encodeExtValue(text: string): string {
  return encodeURIComponent(text.toWellFormed()).replace(/['()*]/g, (char) => `%${(char.codePointAt(0) as number).toString(16).toUpperCase()}`)
}

/** ASCII 대체 이름: 영문·숫자·`-`·`.`·`_`만 남긴다 (비면 file) */
function asciiFallback(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, '')
  return cleaned === '' ? 'file' : cleaned
}

/** 내려받기 헤더: attachment; filename="<ASCII 대체 이름>"; filename*=UTF-8''<UTF-8 이름> */
export function contentDisposition(fileName: string, fallback: string): string {
  return `attachment; filename="${asciiFallback(fallback)}"; filename*=UTF-8''${encodeExtValue(fileName)}`
}

export const MIME = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  zip: 'application/zip',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  gzip: 'application/gzip',
} as const

/** 파일 응답 (내려받기 이름·형식·저장하지 않음) */
export function fileResponse(bytes: Uint8Array, type: string, fileName: string, fallback: string, extraHeaders: Readonly<Record<string, string>> = {}): Response {
  const headers = new Headers(extraHeaders)
  headers.set('Content-Type', type)
  headers.set('Content-Disposition', contentDisposition(fileName, fallback))
  headers.set('Cache-Control', 'no-store')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Content-Length', String(bytes.byteLength))
  return new Response(bytes, { status: 200, headers })
}
