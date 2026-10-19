// 웹 빌드·개발 서버 설정 (AC-S00-51, AC-S05-91, AC-S06-50·51). `pnpm --filter @livejjim/web dev | build | preview`
// 서버는 CORS를 내지 않으므로 화면과 API는 같은 출처로 띄운다: 개발·미리 보기 서버가 /api를 서버로 넘긴다(SSE 포함).
// 서버 주소는 LIVEJJIM_API_URL(기본 http://localhost:3000). 서버의 LIVEJJIM_APP_ORIGIN은 이 화면 주소(예: http://localhost:5173)로 둔다.
// PWA: 운영용 빌드가 끝나면 그 빌드의 앱 껍데기(index.html·해시가 붙은 파일·public의 매니페스트·아이콘) 목록으로 /sw.js를 만든다(D-093).
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { serviceWorkerSource } from './pwa/service-worker.ts'

const apiTarget = process.env['LIVEJJIM_API_URL'] ?? 'http://localhost:3000'
const proxy = { '/api': { target: apiTarget, changeOrigin: false } }

function publicFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
  } catch {
    return []
  }
}

/** 빌드 결과로 /sw.js를 쓴다 */
function serviceWorker(): Plugin {
  let publicDir = ''
  return {
    name: 'livejjim-service-worker',
    apply: 'build',
    configResolved(config) {
      publicDir = config.publicDir
    },
    writeBundle(options, bundle) {
      const outDir = options.dir
      if (outDir === undefined) return
      const hash = createHash('sha256')
      const files: string[] = []
      for (const [fileName, output] of Object.entries(bundle).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
        if (fileName.endsWith('.map') || fileName === 'sw.js') continue
        files.push(`/${fileName}`)
        hash.update(fileName)
        hash.update(output.type === 'chunk' ? output.code : output.source)
      }
      for (const file of publicFiles(publicDir).sort()) {
        if (file === 'sw.js') continue
        files.push(`/${file}`)
        hash.update(file)
        hash.update(readFileSync(join(publicDir, file)))
      }
      const version = hash.digest('hex').slice(0, 16)
      writeFileSync(join(outDir, 'sw.js'), serviceWorkerSource({ version, files }))
    },
  }
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  server: { proxy },
  preview: { proxy },
})
