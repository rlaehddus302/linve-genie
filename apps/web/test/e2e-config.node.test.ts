// @vitest-environment node
// E2E 기동 설정 (AC-S06-73, RA-S05-006, D-096): 서버·화면 미리 보기 모두 127.0.0.1에서만 연다(모든 인터페이스가 아니다).
// 브라우저 주소는 localhost(크로미움이 127.0.0.1로 잇는다 — Secure 세션 쿠키를 Playwright page.request가 보내도록), 서버 --origin은 브라우저 주소와 같다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import config, { E2E_HOST, SERVED_WEB_DIR, STACKS, fakeYoutubeUrl } from '../playwright.config.ts'

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
})
