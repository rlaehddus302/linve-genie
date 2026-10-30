// E2E용 화면 띄우기 (AC-S05-91, AC-S06-73): 운영용으로 빌드(임시 폴더)한 화면을 Vite 미리 보기 서버로 띄우고 /api·/r을 E2E 서버로 넘긴다(같은 출처).
// node e2e/serve.ts --port 5173 --api http://127.0.0.1:3100
// 127.0.0.1에서만 연다(모든 인터페이스가 아니다, D-096). 준비되면 "E2E 화면을 시작했어요. http://127.0.0.1:<포트>" 한 줄을 쓴다.
// 끄면(SIGINT·SIGTERM) 임시 폴더를 지운다.
// --drop-secure-cookie yes (아이폰 크기 묶음 webkit-iphone 전용, I5 D-I5-08): Playwright WebKit은 http://localhost에서 Secure 쿠키를 보내지 않아
//   로그인하자마자 "로그인이 풀렸어요"가 된다. 이 시험용 미리 보기 서버가 /api 응답의 Set-Cookie에서 Secure만 떼어 넘긴다 — 서버·운영은 그대로(Secure).
//   크로미움 묶음은 쓰지 않는다(쿠키 속성 시험은 크로미움·서버가 화면을 내는 묶음에서 본다).
import type { IncomingMessage } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, preview } from 'vite'
import { dropSecure } from './cookie.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
/** 화면 미리 보기 서버가 듣는 주소 */
export const SERVE_HOST = '127.0.0.1'

function readArgs(argv: readonly string[]): { port: number; api: string; dropSecureCookie: boolean } {
  const values = new Map<string, string>()
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    const value = argv[i + 1]
    if (key === undefined || value === undefined || !key.startsWith('--')) throw new Error('인자는 --port 5173 --api http://127.0.0.1:3100 처럼 적어 주세요.')
    values.set(key.slice(2), value)
  }
  const port = Number(values.get('port') ?? '5173')
  const api = values.get('api') ?? 'http://127.0.0.1:3100'
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port는 1~65535 사이의 정수로 적어 주세요.')
  if (!/^https?:\/\/[^/\s]+$/.test(api)) throw new Error('--api는 http://127.0.0.1:3100 처럼 경로 없이 적어 주세요.')
  const drop = values.get('drop-secure-cookie') ?? 'no'
  if (drop !== 'yes' && drop !== 'no') throw new Error('--drop-secure-cookie는 yes 또는 no로 적어 주세요.')
  return { port, api, dropSecureCookie: drop === 'yes' }
}

const { port, api, dropSecureCookie } = readArgs(process.argv.slice(2))
const outDir = mkdtempSync(join(tmpdir(), 'livejjim-web-e2e-'))
const configFile = join(ROOT, 'vite.config.ts')
// /r/<토큰>(구매자 확인서 링크, N4b)도 E2E 서버로: 키를 vite.config.ts의 정규식 키와 같게 적어야 설정 파일의 대상(LIVEJJIM_API_URL 기본값)을 덮는다 (TE-N4b-001)
const configure = dropSecureCookie
  ? (proxyServer: { on(event: 'proxyRes', listener: (res: IncomingMessage) => void): unknown }) => {
      proxyServer.on('proxyRes', (res) => {
        const cookies = res.headers['set-cookie']
        if (cookies !== undefined) res.headers['set-cookie'] = cookies.map(dropSecure)
      })
    }
  : undefined
const target = { target: api, changeOrigin: false, ws: true, ...(configure === undefined ? {} : { configure }) }
const proxy = { '/api': target, '^/r(/|$)': target, '^/s/': target }

await build({ root: ROOT, configFile, logLevel: 'warn', build: { outDir, emptyOutDir: true } })
const server = await preview({ root: ROOT, configFile, logLevel: 'warn', build: { outDir }, preview: { port, strictPort: true, host: SERVE_HOST, proxy } })
process.stdout.write(`E2E 화면을 시작했어요. http://${SERVE_HOST}:${String(port)} · API ${api}\n`)

let stopping = false
async function stop(): Promise<void> {
  if (stopping) return
  stopping = true
  try {
    await server.close()
  } finally {
    rmSync(outDir, { recursive: true, force: true })
    process.exit(0)
  }
}
process.on('SIGINT', () => void stop())
process.on('SIGTERM', () => void stop())
