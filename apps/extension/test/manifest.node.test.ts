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
    content_scripts: { matches: string[]; exclude_matches?: string[]; all_frames?: boolean; world?: string; js: string[]; run_at: string }[]
  }
  const youtubeScripts = manifest.content_scripts.filter((script) => script.matches.some((match) => match.startsWith('https://www.youtube.com/')))

  it('AC-TTX-09: MV3, host 권한은 정확히 유튜브·틱톡·라이브지니 주소 하나, 권한은 storage(·alarms) 안', () => {
    expect(manifest.manifest_version).toBe(3)
    expect(manifest.host_permissions).toEqual(['https://www.youtube.com/*', 'https://www.tiktok.com/*', 'https://app.livegenie.kr/*'])
    for (const permission of manifest.permissions) expect(['storage', 'alarms']).toContain(permission)
    expect(manifest.optional_permissions).toBeUndefined()
    const text = JSON.stringify(manifest)
    for (const banned of ['tabs', 'webRequest', '<all_urls>', 'cookies', 'scripting', 'debugger']) expect(text).not.toContain(`"${banned}"`)
  })

  it('AC-TTX-09: 유튜브 content script 두 항목은 BASE와 같다', () => {
    const CHAT = { matches: ['https://www.youtube.com/live_chat*'], exclude_matches: ['https://www.youtube.com/live_chat_replay*'], all_frames: true }
    expect(youtubeScripts).toEqual([
      { ...CHAT, js: ['page.js'], run_at: 'document_start', world: 'MAIN' },
      { ...CHAT, js: ['content.js'], run_at: 'document_idle' },
    ])
  })

  it('AC-TTX-09: 틱톡 content script는 www.tiktok.com 전체 하나 (페이지 쪽 스크립트 없음)', () => {
    const tiktok = manifest.content_scripts.filter((script) => !youtubeScripts.includes(script))
    expect(tiktok).toEqual([{ matches: ['https://www.tiktok.com/*'], js: ['tiktok-content.js'], run_at: 'document_idle' }])
  })

  it('AC-X1-05: 유튜브 content script는 live_chat만, live_chat_replay는 뺀다', () => {
    expect(youtubeScripts.length).toBe(2)
    for (const script of youtubeScripts) {
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

describe('틱톡 소스 검사 (TTX)', () => {
  const files = readdirSync(SRC).filter((name) => /\.(ts|html)$/.test(name))
  const sources = files.map((name) => ({ name, text: readFileSync(join(SRC, name), 'utf8') }))
  const tiktokFiles = sources.filter(({ name }) => name.startsWith('tiktok-'))

  it('AC-TTX-01: 틱톡 선택자·요소 데이터 이름은 tiktok-selectors.ts 한 파일에만, 첫머리 주석에 "가짜 페이지 기준 — 실물 확인 필요(HG-TTX)"', async () => {
    const selectors = sources.find(({ name }) => name === 'tiktok-selectors.ts')
    expect(selectors?.text.split('\n')[0]).toContain('가짜 페이지 기준 — 실물 확인 필요(HG-TTX)')
    const module = (await import('../src/tiktok-selectors.ts')) as Record<string, unknown>
    const names = Object.entries(module)
      .filter(([key]) => key.startsWith('TT_'))
      .flatMap(([, value]) => (Array.isArray(value) ? value : [value]))
      .filter((value): value is string => typeof value === 'string')
    expect(names.length).toBeGreaterThan(5)
    for (const { name, text } of sources) {
      if (name === 'tiktok-selectors.ts') continue
      for (const shape of names) expect(`${name}: ${shape}: ${String(text.includes(shape))}`).toBe(`${name}: ${shape}: false`)
      // 틱톡 쪽 이름 모양(.tt-·data-*-id)도 다른 파일에 직접 쓰지 않는다
      expect(`${name}: ${String(/['"`]\.tt-|data-(comment|user|unique)-id/.test(text))}`).toBe(`${name}: false`)
    }
  })

  it('AC-TTX-01: 가짜 틱톡 페이지도 선택자 파일의 이름만 쓴다', async () => {
    const module = (await import('../src/tiktok-selectors.ts')) as Record<string, unknown>
    const known = new Set(
      Object.entries(module)
        .filter(([key]) => key.startsWith('TT_'))
        .flatMap(([, value]) => (Array.isArray(value) ? value : [value]))
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.replace(/^\./, '')),
    )
    const html = readFileSync(fileURLToPath(new URL('./fixtures/tiktok-live.html', import.meta.url)), 'utf8')
    const classes = [...html.matchAll(/class="([^"]+)"/g)].flatMap((match) => (match[1] ?? '').split(/\s+/))
    const attrs = [...html.matchAll(/\s(data-[a-z-]+)=/g)].map((match) => match[1] ?? '')
    expect(classes.length).toBeGreaterThan(0)
    for (const name of [...classes, ...attrs]) expect(`${name}: ${String(known.has(name))}`).toBe(`${name}: true`)
    const helper = readFileSync(fileURLToPath(new URL('./fake-tiktok.ts', import.meta.url)), 'utf8')
    expect(/['"`]\.?tt-|data-(comment|user|unique)-id/.test(helper)).toBe(false)
  })

  it('AC-TTX-08: 틱톡 쪽에는 요청 가로채기·틱톡 요청·쿠키·누르기·입력·이벤트 보내기가 없다', () => {
    expect(tiktokFiles.map(({ name }) => name).sort()).toEqual(['tiktok-content.ts', 'tiktok-hub.ts', 'tiktok-outbox.ts', 'tiktok-reader.ts', 'tiktok-selectors.ts', 'tiktok-watch.ts'])
    const banned = [
      /\bfetch\b/,
      /XMLHttpRequest/,
      /WebSocket/,
      /sendBeacon/,
      /EventSource/,
      /document\.cookie/,
      /chrome\.cookies/,
      /\.click\(/,
      /dispatchEvent/,
      /execCommand/,
      /\.value\s*=/,
      /new\s+(MouseEvent|KeyboardEvent|PointerEvent|InputEvent|Event|CustomEvent)\b/,
      /\.(prototype)\b/,
      /world:\s*['"]MAIN/,
    ]
    for (const { name, text } of tiktokFiles) for (const pattern of banned) expect(`${name}: ${String(pattern)}: ${String(pattern.test(text))}`).toBe(`${name}: ${String(pattern)}: false`)
    // 확장의 요청은 api.ts 한 곳 — 라이브지니 주소로만 (틱톡 주소로 부르지 않는다)
    const api = sources.find(({ name }) => name === 'api.ts')?.text ?? ''
    expect(api).not.toMatch(/tiktok/i)
    for (const { name, text } of sources) expect(`${name}: ${String(/https:\/\/www\.tiktok\.com\/(?!\*)/.test(text) && /\.call\(|fetch\(/.test(text) && name !== 'tiktok-reader.ts')}`).toBe(`${name}: false`)
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
