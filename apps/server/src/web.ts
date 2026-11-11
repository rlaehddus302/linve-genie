// 화면 빌드를 같은 출처로 함께 낸다 (SYS-05, UX-07, D-093, D-I3-13, AC-I3-70·71).
// - GET·HEAD만. /api/*·/health*·/ops/*는 넘기지 않는다(그 경로는 서버 응답 그대로 — 없는 것은 JSON 404).
// - 있는 파일은 그 파일(내용 종류 맞게), 확장자 없는 화면 주소는 index.html(200 — 화면의 주소 처리), 없는 파일은 404.
// - 폴더 밖을 읽지 못한다: `..`·`%2e%2e`·`%2f`·`%5c`·역슬래시·널 문자가 있는 요청과 점으로 시작하는 이름(.env 등)은 404.
//   요청 원문(정규화 전)과 풀어 쓴 경로를 둘 다 보고, 파일의 실제 경로(링크를 따라간 것)가 그 폴더 안인지 다시 본다.
// - 캐시: index.html·sw.js·manifest.webmanifest·그 밖의 화면 파일은 no-cache, /assets/ 아래(해시가 붙은 이름)는 1년 immutable.
// - 화면 문서(index.html)에 CSP. 모든 응답의 보안 머리글은 app.ts가 붙인다.
import { existsSync, realpathSync, statSync } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, join, sep } from 'node:path'
import type { Context } from 'hono'
import { errorResponse } from './errors.ts'

/** 화면 문서의 콘텐츠 보안 정책 (AC-I3-71 — 이보다 넓히지 않는다) */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'self'",
].join('; ')

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
}

const NO_CACHE_FILES = new Set(['index.html', 'sw.js', 'manifest.webmanifest'])
export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'

/** 서버가 내지 않는(화면으로 넘기지 않는) 경로 — 웹훅 받는 주소 /webhooks(N2), 구매자 확인서 링크 /r(N4b), 앱 새 버전 /app-updates(D-OTA-01)도 */
export function isServerPath(path: string): boolean {
  // KP1: /s·/s/* = 공개 방송 일정 페이지 (서버가 그린다 — 화면 문서로 빠지지 않게)
  return path === '/r' || path.startsWith('/r/') || path === '/s' || path.startsWith('/s/') || path === '/api' || path.startsWith('/api/') || path === '/health' || path.startsWith('/health/') || path === '/ops' || path.startsWith('/ops/') || path === '/webhooks' || path.startsWith('/webhooks/') || path === '/ext' || path.startsWith('/ext/') || path === '/app-updates' || path.startsWith('/app-updates/')
}

/** 화면 폴더 확인 (운영 시작 검사, AC-I3-72): 그 폴더에 index.html이 있어야 한다 */
export function webDirProblem(dir: string): string | null {
  try {
    if (!statSync(dir).isDirectory() || !existsSync(join(dir, 'index.html')) || !statSync(join(dir, 'index.html')).isFile()) return 'missing'
    return null
  } catch {
    return 'missing'
  }
}

/** 요청 원문(정규화 전)에 폴더를 벗어나려는 모양이 있는지 */
function suspiciousTarget(raw: string): boolean {
  const path = raw.split('?')[0] ?? ''
  const lower = path.toLowerCase()
  if (/%2f|%5c|%00|%2e%2e|%2e\.|\.%2e/.test(lower)) return true
  if (path.includes('\\') || path.includes('\0')) return true
  return path.split('/').some((segment) => segment === '..' || segment === '.')
}

export interface WebServer {
  /** 화면 요청 처리 (GET·HEAD) */
  serve(c: Context): Promise<Response>
}

export function createWebServer(dir: string): WebServer {
  const root = realpathSync(dir)
  const inside = (path: string) => path === root || path.startsWith(root + sep)

  const fileResponse = async (path: string, name: string, assets: boolean): Promise<Response> => {
    const body = await readFile(path)
    const headers = new Headers({ 'Content-Type': CONTENT_TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': assets ? IMMUTABLE_CACHE : 'no-cache' })
    if (NO_CACHE_FILES.has(name)) headers.set('Cache-Control', 'no-cache')
    if (name === 'index.html') headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY)
    return new Response(body, { status: 200, headers })
  }

  return {
    async serve(c: Context): Promise<Response> {
      const env = c.env as { incoming?: { url?: unknown } } | undefined
      const rawTarget = typeof env?.incoming?.url === 'string' ? env.incoming.url : null
      const pathname = new URL(c.req.url).pathname
      if ((rawTarget !== null && suspiciousTarget(rawTarget)) || suspiciousTarget(pathname)) return errorResponse(404)
      let decoded: string
      try {
        decoded = decodeURIComponent(pathname)
      } catch {
        return errorResponse(404)
      }
      if (decoded.includes('\0') || decoded.includes('\\')) return errorResponse(404)
      const segments = decoded.split('/').filter((segment) => segment !== '')
      if (segments.some((segment) => segment === '..' || segment.startsWith('.'))) return errorResponse(404)
      const last = segments.at(-1) ?? ''
      // 확장자 없는 화면 주소(/, /settings/youtube, /broadcasts/x …)는 화면 문서
      if (extname(last) === '') return fileResponse(join(root, 'index.html'), 'index.html', false)
      const candidate = join(root, ...segments)
      if (!inside(candidate)) return errorResponse(404)
      try {
        const real = await realpath(candidate)
        if (!inside(real) || !(await stat(real)).isFile()) return errorResponse(404)
        return await fileResponse(real, last, segments[0] === 'assets')
      } catch {
        return errorResponse(404)
      }
    },
  }
}
