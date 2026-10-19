// @vitest-environment node
// 빌드 (AC-S00-51): `vite build`가 성공하고, 결과물도 한국어 문서이며 외부 리소스를 부르지 않는다 (AC-S00-50).
// `pnpm --filter @livejjim/web build`와 같은 명령을 임시 폴더로 출력해 돌린다(작업 트리의 dist를 건드리지 않는다).
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cssUrls, isExternalUrl, urlAttributes } from './urls.ts'

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url))

function viteBin(): string {
  const require = createRequire(join(WEB_ROOT, 'package.json'))
  const manifestPath = require.resolve('vite/package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { bin: Record<string, string> }
  const entry = manifest.bin['vite']
  if (!entry) throw new Error('vite 실행 파일을 찾지 못했다')
  return join(manifestPath, '..', entry)
}

let outDir = ''
let build: { ok: true; stdout: string } | { ok: false; error: string } = { ok: false, error: '빌드를 시작하지 않았다' }
let files: string[] = []

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'livejjim-web-build-'))
  // Vitest가 넣은 NODE_ENV=test 등을 빼서 실제 `pnpm build`와 같은 운영용 빌드를 만든다
  // (색 코드는 꺼서 실패 메시지를 읽기 쉽게 한다)
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_ENV' && key !== 'FORCE_COLOR' && !key.startsWith('VITEST'))),
    NO_COLOR: '1',
  }
  try {
    const { stdout } = await promisify(execFile)(process.execPath, [viteBin(), 'build', '--outDir', outDir, '--emptyOutDir'], { cwd: WEB_ROOT, env })
    build = { ok: true, stdout }
    files = readdirSync(outDir, { recursive: true, encoding: 'utf8' }).sort()
  } catch (error) {
    // 빌드 실패는 아래 각 테스트의 실패로 보여 준다(건너뜀으로 숨기지 않는다)
    const e = error as { message?: string; stdout?: string; stderr?: string }
    build = { ok: false, error: [e.message, e.stdout, e.stderr].filter(Boolean).join('\n') }
  }
}, 60_000)

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true })
})

function builtFiles(): string[] {
  if (!build.ok) throw new Error(`vite build 실패:\n${build.error}`)
  return files
}

function read(file: string): string {
  if (!builtFiles().includes(file)) throw new Error(`빌드 결과에 ${file}이 없다`)
  return readFileSync(join(outDir, file), 'utf8')
}

describe('vite build', () => {
  it('성공하고 index.html·스크립트·스타일을 만든다', () => {
    if (!build.ok) expect.fail(`vite build 실패:\n${build.error}`)
    expect(build.stdout).toContain('built in')
    expect(files).toContain('index.html')
    expect(files.some((f) => /^assets\/.+\.js$/.test(f))).toBe(true)
    expect(files.some((f) => /^assets\/.+\.css$/.test(f))).toBe(true)
  })

  it('빌드한 index.html도 한국어 문서이고 제목·viewport를 지킨다', () => {
    const html = read('index.html')
    expect(html).toMatch(/<html lang="ko">/)
    expect(html).toContain('<title>라이브찜</title>')
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1" />')
  })

  it('빌드한 index.html은 같은 출처의 파일만 부르고, 부르는 파일이 모두 있다', () => {
    const urls = urlAttributes(read('index.html'))
    expect(urls.length).toBeGreaterThan(1)
    expect(urls.filter(isExternalUrl)).toEqual([])
    for (const url of urls.filter((u) => !u.startsWith('data:'))) {
      expect(url, url).toMatch(/^\/assets\//)
      expect(existsSync(join(outDir, url.slice(1))), url).toBe(true)
    }
  })

  it('빌드한 스타일에 외부 글꼴·외부 주소가 없고 기본 글자 16px 이상이 남아 있다', () => {
    const css = builtFiles().filter((f) => f.endsWith('.css')).map(read).join('\n')
    expect(css).not.toMatch(/@font-face|@import/i)
    expect(cssUrls(css).filter(isExternalUrl)).toEqual([])
    expect(css.replace(/\s+/g, '')).toContain('font-size:max(100%,16px)')
  })

  it('운영용 빌드다 (React 개발 모드 코드가 들어가지 않는다)', () => {
    const js = builtFiles().filter((f) => f.endsWith('.js')).map(read).join('\n')
    // S05 화면(로그인·콘솔)이 들어 있다 (S00의 "준비 중이에요." 첫 화면을 바꿨다)
    expect(js).toContain('로그인이 풀렸어요. 다시 로그인해 주세요.')
    expect(js).toContain('리허설 중 — 실제 판매가 아니에요')
    expect(js).not.toContain('react-dom.development')
    expect(js).not.toContain('__REACT_DEVTOOLS_GLOBAL_HOOK__ is not')
  })
})
