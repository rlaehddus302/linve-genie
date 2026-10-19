// @vitest-environment node
// E2E 기동 설정 (AC-S06-73, RA-S05-006, D-096): 서버·화면 미리 보기 모두 127.0.0.1에서만 연다(모든 인터페이스가 아니다).
// 브라우저 주소는 localhost(크로미움이 127.0.0.1로 잇는다 — Secure 세션 쿠키를 Playwright page.request가 보내도록), 서버 --origin은 브라우저 주소와 같다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import config, { E2E_HOST, STACKS } from '../playwright.config.ts'

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
    expect(servers).toHaveLength(STACKS.length * 2)
    for (const stack of STACKS) {
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
})
