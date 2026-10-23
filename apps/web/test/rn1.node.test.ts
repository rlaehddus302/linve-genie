// @vitest-environment node
// AC-RN1-09 이름 상수 한 곳 · AC-RN1-10 보이는 소스에 옛 이름 0개 (UX-01, D-RN1-03)
// 화면 영역의 "보이는 소스": apps/web/src·index.html·public·pwa. 여기서 옛 이름은 주석 밖에 0개여야 한다.
// 고정 파일(index.html 제목, manifest name·short_name)은 글자로 두고 그 값이 SERVICE_NAME과 같은지 본다.
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SERVICE_NAME } from '../src/brand.ts'

const OLD_NAME = '라이브' + '찜'
const ROOT = new URL('../', import.meta.url)
const TEXT_FILE = /\.(tsx?|html|webmanifest|json|txt|svg|css|js)$/

/** 줄 주석·블록 주석·HTML 주석을 지운 글. 문자열·템플릿 안의 // 는 지우지 않는다 */
function stripComments(source: string): string {
  let out = ''
  let i = 0
  while (i < source.length) {
    const ch = source[i] as string
    const next = source[i + 1]
    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4)
      i = end === -1 ? source.length : end + 3
      continue
    }
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++
      continue
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 2
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1
      while (j < source.length && source[j] !== ch && !(ch !== '`' && source[j] === '\n')) j += source[j] === '\\' ? 2 : 1
      out += source.slice(i, j + 1)
      i = j + 1
      continue
    }
    out += ch
    i++
  }
  return out
}

function countOutsideComments(source: string, word: string): number {
  return stripComments(source).split(word).length - 1
}

/** JSON 파일은 주석이 없으므로 글 전체를 센다 */
function countIn(file: string, text: string, word: string): number {
  return /\.(webmanifest|json)$/.test(file) ? text.split(word).length - 1 : countOutsideComments(text, word)
}

function files(dir: URL, base: string): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const url = new URL(entry.isDirectory() ? `${entry.name}/` : entry.name, dir)
    if (entry.isDirectory()) out.push(...files(url, `${base}${entry.name}/`))
    else if (TEXT_FILE.test(entry.name)) out.push({ file: `${base}${entry.name}`, text: readFileSync(url, 'utf8') })
  }
  return out
}

const visible = [
  ...files(new URL('src/', ROOT), 'src/'),
  ...files(new URL('public/', ROOT), 'public/'),
  ...files(new URL('pwa/', ROOT), 'pwa/'),
  { file: 'index.html', text: readFileSync(new URL('index.html', ROOT), 'utf8') },
]

describe('AC-RN1-09 화면 이름 상수', () => {
  it('SERVICE_NAME = 라이브지니', () => {
    expect(SERVICE_NAME).toBe('라이브지니')
  })

  it('고정 파일의 이름이 상수와 같다: index.html 제목, manifest name·short_name', () => {
    const html = readFileSync(new URL('index.html', ROOT), 'utf8')
    expect(html).toContain(`<title>${SERVICE_NAME}</title>`)
    const manifest = JSON.parse(readFileSync(new URL('public/manifest.webmanifest', ROOT), 'utf8')) as { name: string; short_name: string }
    expect(manifest.name).toBe(SERVICE_NAME)
    expect(manifest.short_name).toBe(SERVICE_NAME)
  })

  it('src·pwa에서 이름 글자는 상수 파일 한 곳에만 있다', () => {
    const holders = visible
      .filter((f) => /\.tsx?$/.test(f.file))
      .filter((f) => countOutsideComments(f.text, SERVICE_NAME) > 0)
      .map((f) => f.file)
    expect(holders).toEqual(['src/brand.ts'])
    expect(countOutsideComments(readFileSync(new URL('src/brand.ts', ROOT), 'utf8'), SERVICE_NAME)).toBe(1)
  })
})

describe('AC-RN1-10 화면의 보이는 소스에 옛 이름 0개 (주석 밖)', () => {
  it('src·public·pwa·index.html 파일마다 0개', () => {
    expect(visible.length).toBeGreaterThan(50)
    const found = visible.map((f) => ({ file: f.file, count: countIn(f.file, f.text, OLD_NAME) })).filter((f) => f.count > 0)
    expect(found).toEqual([])
  })

  it('검사가 실제로 잡는다: 문장·JSX 글·HTML 제목에 넣으면 세고, 주석에만 있으면 세지 않는다', () => {
    expect(countOutsideComments(`const a = '${OLD_NAME}'`, OLD_NAME)).toBe(1)
    expect(countOutsideComments(`<h1>${OLD_NAME}</h1> // ${OLD_NAME}`, OLD_NAME)).toBe(1)
    expect(countOutsideComments(`<title>${OLD_NAME}</title><!-- ${OLD_NAME} -->`, OLD_NAME)).toBe(1)
    expect(countOutsideComments(`const url = 'https://x.y/${OLD_NAME}'`, OLD_NAME)).toBe(1)
    expect(countIn('manifest.webmanifest', `{"name":"${OLD_NAME}"}`, OLD_NAME)).toBe(1)
    expect(countOutsideComments(`// ${OLD_NAME}\n/* ${OLD_NAME} */\n{/* ${OLD_NAME} */}\nconst a = 1`, OLD_NAME)).toBe(0)
  })
})
