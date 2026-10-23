// @vitest-environment node
// 매니페스트 권한·읽는 곳 (AC-X1-05·07, YT-10 AC1·AC10)과 소스 검사 (AC-X1-06·19)
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildManifest, originPattern } from '../src/manifest.ts'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

describe('AC-X1-07: 매니페스트', () => {
  const manifest = buildManifest('https://app.livegenie.kr', '0.1.0') as {
    manifest_version: number
    permissions: string[]
    host_permissions: string[]
    optional_permissions?: unknown
    content_scripts: { matches: string[]; exclude_matches: string[]; all_frames: boolean; world?: string }[]
  }

  it('MV3, host 권한은 유튜브와 라이브지니 주소 하나, 권한은 storage(·alarms) 안', () => {
    expect(manifest.manifest_version).toBe(3)
    expect(manifest.host_permissions).toEqual(['https://www.youtube.com/*', 'https://app.livegenie.kr/*'])
    for (const permission of manifest.permissions) expect(['storage', 'alarms']).toContain(permission)
    expect(manifest.optional_permissions).toBeUndefined()
    const text = JSON.stringify(manifest)
    for (const banned of ['tabs', 'webRequest', '<all_urls>', 'cookies', 'scripting', 'debugger']) expect(text).not.toContain(`"${banned}"`)
  })

  it('AC-X1-05: content script는 live_chat만, live_chat_replay는 뺀다', () => {
    expect(manifest.content_scripts.length).toBeGreaterThan(0)
    for (const script of manifest.content_scripts) {
      expect(script.matches).toEqual(['https://www.youtube.com/live_chat*'])
      expect(script.exclude_matches).toEqual(['https://www.youtube.com/live_chat_replay*'])
      expect(script.all_frames).toBe(true)
    }
  })

  it('라이브지니 주소: 포트는 두고 경로는 뺀다, 운영 주소는 https만', () => {
    expect(originPattern('http://localhost:5173')).toBe('http://localhost:5173/*')
    expect(originPattern('https://app.livegenie.kr/settings')).toBe('https://app.livegenie.kr/*')
    expect(() => originPattern('http://app.livegenie.kr')).toThrow()
    expect(() => originPattern('ftp://app.livegenie.kr')).toThrow()
    // AC-X1-33: 배포 빌드는 https만 (localhost도 안 됨)
    expect(originPattern('https://app.livegenie.kr', true)).toBe('https://app.livegenie.kr/*')
    expect(() => originPattern('http://localhost:5173', true)).toThrow()
    expect(() => originPattern('http://127.0.0.1:3000', true)).toThrow()
  })
})

describe('AC-X1-33: 배포 빌드', () => {
  it('--prod에서 라이브지니 주소가 https가 아니면 빌드가 실패하고 아무것도 쓰지 않는다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'livegenie-ext-'))
    const out = join(dir, 'dist')
    try {
      const run = spawnSync(process.execPath, ['build.mjs', '--prod'], {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        env: { ...process.env, LIVEGENIE_ORIGIN: 'http://localhost:5173', LIVEGENIE_EXT_OUT: out },
        encoding: 'utf8',
      })
      expect(run.status).not.toBe(0)
      expect(existsSync(out)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('소스 검사', () => {
  const files = readdirSync(SRC).filter((name) => /\.(ts|html)$/.test(name))
  const sources = files.map((name) => ({ name, text: readFileSync(join(SRC, name), 'utf8') }))

  it('AC-X1-06: 유튜브 요청 가로채기·내부 API 코드가 어디에도 없다', () => {
    const banned = [/window\.fetch\s*=/, /globalThis\.fetch\s*=/, /XMLHttpRequest/, /youtubei/, /\.submit\(/]
    for (const { name, text } of sources) for (const pattern of banned) expect(`${name}: ${String(pattern.test(text))}`).toBe(`${name}: false`)
  })

  it('AC-X1-06·D-X1-25: 누르기·입력·게시는 감사 올리기(poster.ts) 한 곳에서만, 화면 모양은 selectors.ts 한 곳에서만', () => {
    const acting = [/\.click\(/, /new\s+(MouseEvent|KeyboardEvent|PointerEvent)/, /execCommand/, /new\s+InputEventCtor|InputEvent\(/]
    const shape = [/send-button/, /contenteditable/i]
    for (const { name, text } of sources) {
      if (name !== 'poster.ts') for (const pattern of acting) expect(`${name}: ${String(pattern.test(text))}`).toBe(`${name}: false`)
      if (name !== 'selectors.ts') for (const pattern of shape) expect(`${name}: ${String(pattern.test(text))}`).toBe(`${name}: false`)
    }
  })

  it('fetch는 서버 부르기(api.ts) 한 곳에서만', () => {
    const users = sources.filter(({ text }) => /\bfetch\(/.test(text)).map(({ name }) => name)
    expect(users).toEqual(['api.ts'])
  })

  it('AC-X1-19: 확장 console 출력이 없다 (닉네임·본문·토큰이 찍히지 않게)', () => {
    for (const { name, text } of sources) expect(`${name}: ${String(/\bconsole\./.test(text))}`).toBe(`${name}: false`)
  })

  it('화면에 HTML을 넣지 않는다 (글자로만)', () => {
    for (const { name, text } of sources) expect(`${name}: ${String(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(text))}`).toBe(`${name}: false`)
  })
})
