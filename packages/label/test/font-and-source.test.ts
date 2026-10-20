// 내장 글꼴(AC-P1-11)과 소스 검사(AC-P1-03·10·11·15·60) — 렌더 경로가 Node 모듈·인터넷 글꼴·시계·난수·언어 설정을 쓰지 않는지.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LABEL_FONT_FILE, readFontCodePoints } from '../src/index.ts'
import { LABEL_FONT_PATH, readLabelFontBytes } from '../src/node.ts'

const PKG = join(import.meta.dirname, '..')
const SRC = join(PKG, 'src')

describe('내장 한글 글꼴 (AC-P1-11)', () => {
  it('글꼴 파일 하나와 그 라이선스 파일(SIL OFL 1.1)이 있다', () => {
    const files = readdirSync(join(PKG, 'fonts')).sort()
    const fonts = files.filter((f) => /\.(otf|ttf|woff2?)$/i.test(f))
    expect(fonts).toEqual([LABEL_FONT_FILE])
    expect(LABEL_FONT_PATH.endsWith(LABEL_FONT_FILE)).toBe(true)
    const license = files.filter((f) => /ofl|license/i.test(f))
    expect(license).toHaveLength(1)
    const text = readFileSync(join(PKG, 'fonts', license[0] as string), 'utf8')
    expect(text).toContain('SIL OPEN FONT LICENSE Version 1.1')
    expect(text).toContain('Pretendard')
  })

  it('글자 표(cmap)에 한글 음절 11,172자·호환 자모 51자·ASCII 출력 글자가 모두 있다', () => {
    const cps = readFontCodePoints(readLabelFontBytes())
    const missing = (from: number, to: number) => {
      const out: number[] = []
      for (let c = from; c <= to; c++) if (!cps.has(c)) out.push(c)
      return out
    }
    expect(missing(0xac00, 0xd7a3)).toEqual([])
    expect(missing(0x3131, 0x3163)).toEqual([])
    expect(missing(0x20, 0x7e)).toEqual([])
    expect(cps.has(0x2026)).toBe(true) // 말줄임표
    expect(cps.has(0x1f335)).toBe(false) // 🌵 — 빈 네모로 그린다
  })
})

function sources(): { file: string; text: string }[] {
  return readdirSync(SRC)
    .filter((f) => f.endsWith('.ts'))
    .sort()
    .map((file) => ({ file, text: readFileSync(join(SRC, file), 'utf8') }))
}

/** 주석을 뺀 코드 (주석 안의 설명 글은 검사하지 않는다) */
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('렌더 경로 소스 검사', () => {
  it('Node 전용 진입점(node.ts) 말고는 node: 모듈·fs·path·@napi-rs/canvas를 import하지 않는다 (AC-P1-10)', () => {
    for (const { file, text } of sources()) {
      if (file === 'node.ts') continue
      const imports = [...code(text).matchAll(/(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1] ?? m[2])
      for (const spec of imports) {
        expect(spec, `${file}: ${String(spec)}`).not.toMatch(/^node:|^(fs|path|url|os|child_process)(\/|$)|^@napi-rs\//)
      }
      expect(code(text), file).not.toMatch(/\brequire\s*\(/)
    }
  })

  it('글꼴을 인터넷에서 받지 않는다 — 소스에 http(s):// 주소가 없다 (AC-P1-11)', () => {
    for (const { file, text } of sources()) expect(text, file).not.toMatch(/https?:\/\//)
  })

  it('시계·난수·실행 환경 언어 설정을 쓰지 않는다 (AC-P1-03·15)', () => {
    for (const { file, text } of sources()) {
      const c = code(text)
      expect(c, file).not.toMatch(/\bDate\b|Math\.random|performance\.now|crypto\.|toLocale|localeCompare|Intl\.(Collator|DateTimeFormat|NumberFormat|RelativeTimeFormat|PluralRules)/)
      // Intl.Segmenter는 언어를 'und'로 고정해서만 쓴다
      for (const m of c.matchAll(/new Intl\.Segmenter\(([^,)]*)/g)) expect(m[1]?.trim(), file).toBe("'und'")
    }
  })

  it('apps/**를 import하지 않는다 (AC-P1-60)', () => {
    for (const { file, text } of sources()) expect(code(text), file).not.toMatch(/from\s+['"][^'"]*apps\//)
  })

  it('새 의존성은 모두 정확한 버전이다 (AC-P1-60)', () => {
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>
    for (const group of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const [name, version] of Object.entries(manifest[group] ?? {})) {
        if (version.startsWith('workspace:')) continue
        expect(version, name).toMatch(/^\d+\.\d+\.\d+$/)
      }
    }
  })
})
