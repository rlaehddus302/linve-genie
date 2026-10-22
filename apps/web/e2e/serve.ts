// E2E용 화면 띄우기 (AC-S05-91, AC-S06-73): 운영용으로 빌드(임시 폴더)한 화면을 Vite 미리 보기 서버로 띄우고 /api·/r을 E2E 서버로 넘긴다(같은 출처).
// node e2e/serve.ts --port 5173 --api http://127.0.0.1:3100
// 127.0.0.1에서만 연다(모든 인터페이스가 아니다, D-096). 준비되면 "E2E 화면을 시작했어요. http://127.0.0.1:<포트>" 한 줄을 쓴다.
// 끄면(SIGINT·SIGTERM) 임시 폴더를 지운다.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, preview } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
/** 화면 미리 보기 서버가 듣는 주소 */
export const SERVE_HOST = '127.0.0.1'

function readArgs(argv: readonly string[]): { port: number; api: string } {
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
  return { port, api }
}

const { port, api } = readArgs(process.argv.slice(2))
const outDir = mkdtempSync(join(tmpdir(), 'livejjim-web-e2e-'))
const configFile = join(ROOT, 'vite.config.ts')
// /r/<토큰>(구매자 확인서 링크, N4b)도 E2E 서버로: 키를 vite.config.ts의 정규식 키와 같게 적어야 설정 파일의 대상(LIVEJJIM_API_URL 기본값)을 덮는다 (TE-N4b-001)
const proxy = { '/api': { target: api, changeOrigin: false }, '^/r(/|$)': { target: api, changeOrigin: false } }

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
