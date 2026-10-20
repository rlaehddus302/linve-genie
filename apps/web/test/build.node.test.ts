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
import { VOICE_CHUNK_PLACEHOLDER } from '../src/voice/chunk.ts'
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

/** 스크립트 하나의 정적 import·re-export 대상 (동적 import(…)는 빼고) — 빌드 결과는 같은 폴더의 상대 경로다 */
function staticImports(code: string): string[] {
  const out: string[] = []
  for (const match of code.matchAll(/\b(?:import|export)\s*(?:[^'"`();]*?\bfrom\s*)?["'`]([^"'`]+)["'`]/g)) {
    const target = match[1]
    if (target !== undefined && target.startsWith('./')) out.push(`assets/${target.slice(2)}`)
  }
  return out
}

/** 첫 화면이 받는 스크립트: index.html이 부르는 스크립트(script·modulepreload)와 그 정적 import를 꼬리까지 */
function eagerScripts(): string[] {
  const html = read('index.html')
  const queue = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((match) => match[1] as string)
  const seen = new Set<string>()
  while (queue.length > 0) {
    const file = queue.pop() as string
    if (seen.has(file)) continue
    seen.add(file)
    queue.push(...staticImports(read(file)))
  }
  return [...seen].sort()
}

/** 첫 화면이 받지 않는(누를 때 받는) 스크립트 */
function lazyScripts(): string[] {
  const eager = new Set(eagerScripts())
  return builtFiles().filter((file) => /^assets\/.+\.js$/.test(file) && !eager.has(file))
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
      // 해시가 붙은 정적 파일 또는 PWA 파일(매니페스트·아이콘 — public 폴더, AC-S06-50)
      expect(url, url).toMatch(/^\/(assets\/|icons\/[a-z0-9-]+\.png$|manifest\.webmanifest$)/)
      expect(existsSync(join(outDir, url.slice(1))), url).toBe(true)
    }
  })

  it('PWA (AC-S06-50·51): 매니페스트·아이콘 크기, /sw.js가 그 빌드의 앱 껍데기만 저장하고 /api/는 없다', () => {
    const manifest = JSON.parse(read('manifest.webmanifest')) as Record<string, unknown> & { icons: { src: string; sizes: string; type: string; purpose: string }[] }
    expect(manifest).toMatchObject({ name: '라이브찜', short_name: '라이브찜', lang: 'ko', start_url: '/', scope: '/', display: 'standalone' })
    expect(typeof manifest['background_color']).toBe('string')
    expect(typeof manifest['theme_color']).toBe('string')
    const icons = manifest.icons.map((icon) => `${icon.sizes} ${icon.purpose} ${icon.type}`).sort()
    expect(icons).toEqual(['192x192 any image/png', '512x512 any image/png', '512x512 maskable image/png'])
    // 아이콘 파일은 적힌 크기 그대로다 (PNG 머리의 폭·높이)
    for (const icon of [...manifest.icons, { src: '/icons/apple-touch-icon.png', sizes: '180x180' }]) {
      const png = readFileSync(join(outDir, icon.src.slice(1)))
      expect(png.subarray(1, 4).toString('latin1'), icon.src).toBe('PNG')
      expect(`${String(png.readUInt32BE(16))}x${String(png.readUInt32BE(20))}`, icon.src).toBe(icon.sizes)
    }
    const sw = read('sw.js')
    const shell = JSON.parse(/\(self, (\{.*\})\);/.exec(sw)?.[1] ?? 'null') as { version: string; files: string[] } | null
    expect(shell).not.toBeNull()
    const files = shell?.files ?? []
    expect(files).toContain('/index.html')
    expect(files).toContain('/manifest.webmanifest')
    expect(files.filter((f) => f.startsWith('/api'))).toEqual([])
    // 빌드의 해시가 붙은 파일이 모두 들어 있고(누를 때만 받는 음성 조각은 빼고 — AC-I4-10, D-I4-09), 적힌 파일은 모두 있다
    const lazy = new Set(lazyScripts())
    expect(lazy.size).toBeGreaterThan(0)
    for (const file of builtFiles().filter((f) => f.startsWith('assets/'))) {
      if (lazy.has(file)) expect(files, file).not.toContain(`/${file}`)
      else expect(files).toContain(`/${file}`)
    }
    for (const file of files) expect(existsSync(join(outDir, file.slice(1))), file).toBe(true)
    expect(shell?.version).toMatch(/^[0-9a-f]{16}$/)
  })

  it('빌드한 스타일에 외부 글꼴·외부 주소가 없고 기본 글자 16px 이상이 남아 있다', () => {
    const css = builtFiles().filter((f) => f.endsWith('.css')).map(read).join('\n')
    expect(css).not.toMatch(/@font-face|@import/i)
    expect(cssUrls(css).filter(isExternalUrl)).toEqual([])
    expect(css.replace(/\s+/g, '')).toContain('font-size:max(100%,16px)')
  })

  it('AC-I4-10 (VOC-05, D-I4-09): 첫 화면이 받는 JS(진입 조각과 그 정적 import)에 음성 패키지 코드가 없고, 음성 코드는 따로 받는 조각에 있다', () => {
    const marker = '음성 인식이 자꾸 끊겨요.' // D-205 문장 (음성 패키지의 오류 문장)
    const eager = eagerScripts()
    expect(eager.length).toBeGreaterThan(0)
    for (const file of eager) expect(read(file), file).not.toContain(marker)
    // 음성 패키지의 다른 값도 첫 화면에 없다 (기본 품종 사전·인식 언어)
    for (const file of eager) expect(read(file), file).not.toContain('블루엘프')
    const lazy = lazyScripts()
    const voice = lazy.filter((file) => read(file).includes(marker))
    expect(voice).toHaveLength(1)
    expect(read(voice[0] as string)).toContain('ko-KR')
    // 첫 화면 html은 그 조각을 미리 받지 않는다 (modulepreload 없음)
    expect(read('index.html')).not.toContain(voice[0] as string)
  })

  it('TE-I4-002: 음성 조각 주소가 진입 조각에 들어가 있다 — 받지 못한 뒤 그 주소에 ?retry=N을 붙여 다시 받는다. 자리 글자는 남지 않는다', () => {
    const marker = '음성 인식이 자꾸 끊겨요.'
    const voice = lazyScripts().filter((file) => read(file).includes(marker))
    expect(voice).toHaveLength(1)
    const address = `./${(voice[0] as string).slice('assets/'.length)}`
    for (const file of builtFiles().filter((f) => f.endsWith('.js'))) expect(read(file), file).not.toContain(VOICE_CHUNK_PLACEHOLDER)
    // 진입 조각: 동적 import 한 번 + 다시 받을 주소 글자 한 번 (같은 폴더의 상대 주소)
    const eager = eagerScripts().map(read).join('\n')
    expect(eager.split(address).length - 1).toBeGreaterThanOrEqual(2)
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
