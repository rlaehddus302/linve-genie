// @vitest-environment node
// E2E 기동 설정 (AC-S06-73, RA-S05-006, D-096): 서버·화면 미리 보기 모두 127.0.0.1에서만 연다(모든 인터페이스가 아니다).
// 브라우저 주소는 localhost(크로미움이 127.0.0.1로 잇는다 — Secure 세션 쿠키를 Playwright page.request가 보내도록), 서버 --origin은 브라우저 주소와 같다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import config, { E2E_HOST, SERVED_WEB_DIR, STACKS, e2eServerUrl, fakeMetaUrl, fakeOAuthUrl, fakeYoutubeUrl } from '../playwright.config.ts'

const serve = readFileSync(new URL('../e2e/serve.ts', import.meta.url), 'utf8')

describe('E2E 기동 (코드 검사)', () => {
  it('화면 미리 보기는 127.0.0.1에서만 연다', () => {
    expect(serve).toMatch(/export const SERVE_HOST = '127\.0\.0\.1'/)
    expect(serve).toMatch(/host: SERVE_HOST/)
    expect(serve).not.toMatch(/host: '(0\.0\.0\.0|::|localhost)'|host: true/)
  })

  it('헬스체크·프록시 대상은 127.0.0.1, 브라우저 주소와 서버 --origin은 같다', () => {
    expect(E2E_HOST).toBe('127.0.0.1')
    const servers = Array.isArray(config.webServer) ? config.webServer : []
    const served = STACKS.filter((stack) => stack.served === true)
    expect(servers).toHaveLength(STACKS.length * 2 - served.length)
    for (const stack of served) {
      // 서버가 화면을 내는 묶음: 화면 서버 없이 서버 주소를 바로 연다 (화면은 먼저 운영용으로 빌드)
      const project = config.projects?.find((item) => item.name === stack.name)
      expect(stack.web).toBe(stack.api)
      expect(project?.use?.baseURL).toBe(`http://localhost:${String(stack.api)}`)
      const server = servers.find((item) => item.command?.includes(`--port ${String(stack.api)}`))
      expect(server?.url).toBe(`http://127.0.0.1:${String(stack.api)}/api/health`)
      expect(server?.command).toMatch(/^node e2e\/build\.ts --out "[^"]+" && pnpm --filter @livejjim\/server e2e /)
      expect(server?.command).toContain(`--origin http://localhost:${String(stack.api)}`)
      expect(server?.command).toContain(`--web-dir "${SERVED_WEB_DIR}"`)
    }
    for (const stack of STACKS.filter((item) => item.served !== true)) {
      const project = config.projects?.find((item) => item.name === stack.name)
      const baseURL = project?.use?.baseURL
      expect(baseURL).toBe(`http://localhost:${String(stack.web)}`)
      const api = servers.find((server) => server.command?.includes(`--port ${String(stack.api)}`) && server.command.includes('@livejjim/server'))
      const web = servers.find((server) => server.command?.includes(`e2e/serve.ts --port ${String(stack.web)}`))
      expect(api?.url).toBe(`http://127.0.0.1:${String(stack.api)}/api/health`)
      expect(api?.command).toContain(`--origin ${String(baseURL)}`)
      expect(web?.url).toBe(`http://127.0.0.1:${String(stack.web)}`)
      expect(web?.command).toContain(`--api http://127.0.0.1:${String(stack.api)}`)
    }
  })

  it('I3 묶음(AC-I3-93): 가짜 유튜브 묶음은 127.0.0.1의 가짜 서버와 함께, 기본 묶음은 그 시험을 고르지 않는다, 포트는 겹치지 않는다', () => {
    const servers = Array.isArray(config.webServer) ? config.webServer : []
    for (const name of ['chromium-youtube', 'chromium-quota']) {
      const stack = STACKS.find((item) => item.name === name)
      expect(stack?.youtube).toBeDefined()
      const server = servers.find((item) => item.command?.includes(`--port ${String(stack?.api)}`) && item.command.includes('@livejjim/server'))
      expect(server?.command).toContain(`--youtube fake --youtube-port ${String(stack?.youtube)}`)
      expect(fakeYoutubeUrl(name)).toBe(`http://127.0.0.1:${String(stack?.youtube)}`)
    }
    expect(servers.find((item) => item.command?.includes(`--port ${String(STACKS.find((s) => s.name === 'chromium-quota')?.api)}`))?.command).toContain('--youtube-quota-budget')
    expect(fakeYoutubeUrl('chromium')).toBeNull()
    const base = STACKS.find((item) => item.name === 'chromium')
    for (const tag of ['@youtube', '@quota', '@served', '@prod-delay', '@fill']) expect(base?.grepInvert?.test(`시험 ${tag}`)).toBe(true)
    // 빌드 결과물은 린트·git 범위 밖 (node_modules/.cache)
    expect(SERVED_WEB_DIR.split(/[\\/]/).slice(-4)).toEqual(['node_modules', '.cache', 'livejjim-e2e', 'served-web'])
    const ports = STACKS.flatMap((stack) => [...new Set([stack.web, stack.api, ...(stack.youtube === undefined ? [] : [stack.youtube])])])
    expect(new Set(ports).size).toBe(ports.length)
  })

  it('N2b-2 여러 플랫폼 묶음(AC-N2b-2-80): 가짜 유튜브·가짜 메타(정한 포트)·가짜 틱톡을 함께 켜고 @multi만 고른다, 포트는 겹치지 않는다', () => {
    const servers = Array.isArray(config.webServer) ? config.webServer : []
    const stack = STACKS.find((item) => item.name === 'chromium-multi')
    expect(stack?.youtube).toBeDefined()
    expect(stack?.instagram).toBeDefined()
    const server = servers.find((item) => item.command?.includes(`--port ${String(stack?.api)}`) && item.command.includes('@livejjim/server'))
    expect(server?.command).toContain(`--youtube fake --youtube-port ${String(stack?.youtube)}`)
    expect(server?.command).toContain(`--instagram yes --instagram-port ${String(stack?.instagram)}`)
    expect(server?.command).toContain('--tiktok yes')
    expect(stack?.grep?.test('시험 @multi')).toBe(true)
    expect(STACKS.find((item) => item.name === 'chromium')?.grepInvert?.test('시험 @multi')).toBe(true)
    expect(fakeMetaUrl('chromium-multi')).toBe(`http://127.0.0.1:${String(stack?.instagram)}`)
    expect(fakeMetaUrl('chromium')).toBeNull()
    expect(e2eServerUrl('chromium-multi')).toBe(`http://127.0.0.1:${String(stack?.api)}`)
    const ports = STACKS.flatMap((item) => [item.web, item.api, ...(item.youtube === undefined ? [] : [item.youtube]), ...(item.instagram === undefined ? [] : [item.instagram])].filter((port, index, all) => all.indexOf(port) === index))
    expect(new Set(ports).size).toBe(ports.length)
  })

  it('L1 간편 로그인 묶음(AC-L1-30): 가짜 OAuth(정한 포트)와 함께 — 셋 다 켠 묶음은 @social, 구글 하나만 켠 묶음은 @social-one, 기본 묶음은 둘 다 고르지 않는다', () => {
    const servers = Array.isArray(config.webServer) ? config.webServer : []
    const command = (name: string) => {
      const stack = STACKS.find((item) => item.name === name)
      return servers.find((item) => item.command?.includes(`--port ${String(stack?.api)}`) && item.command.includes('@livejjim/server'))?.command ?? ''
    }
    const all = STACKS.find((item) => item.name === 'chromium-social')
    const one = STACKS.find((item) => item.name === 'chromium-social-one')
    expect(command('chromium-social')).toContain(`--social fake --social-port ${String(all?.social)}`)
    expect(command('chromium-social')).not.toContain('--social-providers')
    expect(command('chromium-social-one')).toContain(`--social fake --social-port ${String(one?.social)} --social-providers google`)
    expect(all?.grep?.test('시험 @social')).toBe(true)
    expect(all?.grep?.test('시험 @social-one')).toBe(false)
    expect(one?.grep?.test('시험 @social-one')).toBe(true)
    expect(one?.grep?.test('시험 @social')).toBe(false)
    const base = STACKS.find((item) => item.name === 'chromium')
    for (const tag of ['@social', '@social-one']) expect(base?.grepInvert?.test(`시험 ${tag}`)).toBe(true)
    expect(command('chromium')).not.toContain('--social')
    expect(fakeOAuthUrl('chromium-social')).toBe(`http://127.0.0.1:${String(all?.social)}`)
    expect(fakeOAuthUrl('chromium')).toBeNull()
    const ports = STACKS.flatMap((item) => [item.web, item.api, item.youtube, item.instagram, item.social].filter((port): port is number => port !== undefined).filter((port, index, list) => list.indexOf(port) === index))
    expect(new Set(ports).size).toBe(ports.length)
  })

  it('I5 아이폰 크기 묶음(AC-I5-90, D-I5-08): webkit-iphone은 WebKit·iPhone 15·5183/3111(+오프셋)·@webkit만, 기본 묶음은 @webkit을 빼고 건너뛰기가 없다', () => {
    const offset = Number(process.env['E2E_PORT_OFFSET'] ?? '0')
    const stack = STACKS.find((item) => item.name === 'webkit-iphone')
    expect(stack).toMatchObject({ web: 5183 + offset, api: 3111 + offset, device: 'iPhone 15', dropSecureCookie: true })
    expect(stack?.grep?.test('시험 @webkit')).toBe(true)
    expect(stack?.grep?.test('시험')).toBe(false)
    const project = config.projects?.find((item) => item.name === 'webkit-iphone')
    expect(project?.use?.defaultBrowserType).toBe('webkit')
    expect(project?.use?.viewport).toEqual({ width: 393, height: 659 })
    expect(project?.use?.hasTouch).toBe(true)
    expect(project?.use?.baseURL).toBe(`http://localhost:${String(5183 + offset)}`)
    const base = STACKS.find((item) => item.name === 'chromium')
    expect(base?.grepInvert?.test('시험 @webkit')).toBe(true)
    // 다른 묶음은 크로미움 그대로 (기기를 덮지 않는다)
    for (const other of config.projects ?? []) if (other.name !== 'webkit-iphone') expect(other.use?.defaultBrowserType).toBeUndefined()
    // Secure 떼기는 이 묶음의 화면 미리 보기 서버만
    const servers = Array.isArray(config.webServer) ? config.webServer : []
    const dropping = servers.filter((item) => item.command?.includes('--drop-secure-cookie yes'))
    expect(dropping.map((item) => item.command)).toEqual([`node e2e/serve.ts --port ${String(5183 + offset)} --api http://127.0.0.1:${String(3111 + offset)} --drop-secure-cookie yes`])
    // 설치 방법이 머리 주석에, 건너뛰기 없음
    const source = readFileSync(new URL('../playwright.config.ts', import.meta.url), 'utf8')
    expect(source.split('import ')[0]).toContain('pnpm exec playwright install webkit')
    expect(source).not.toMatch(/\.skip|testIgnore|test\.fixme/)
    const ports = STACKS.flatMap((item) => [item.web, item.api, item.youtube, item.instagram, item.social].filter((port): port is number => port !== undefined).filter((port, index, list) => list.indexOf(port) === index))
    expect(new Set(ports).size).toBe(ports.length)
  })

  it('시험용 미리 보기 서버의 Secure 떼기는 Secure 속성만 뗀다', async () => {
    const { dropSecure } = await import('../e2e/cookie.ts')
    expect(dropSecure('lj_session=abc; Path=/; HttpOnly; Secure; SameSite=Lax')).toBe('lj_session=abc; Path=/; HttpOnly; SameSite=Lax')
    expect(dropSecure('a=Secure; secure')).toBe('a=Secure')
    expect(dropSecure('a=b; Path=/')).toBe('a=b; Path=/')
    expect(serve).toMatch(/--drop-secure-cookie/)
  })
})
