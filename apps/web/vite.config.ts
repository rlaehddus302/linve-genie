// 웹 빌드·개발 서버 설정 (AC-S00-51, AC-S05-91, AC-S06-50·51). `pnpm --filter @livejjim/web dev | build | preview`
// 서버는 CORS를 내지 않으므로 화면과 API는 같은 출처로 띄운다: 개발·미리 보기 서버가 /api를 서버로 넘긴다(SSE 포함).
// 서버 주소는 LIVEJJIM_API_URL(기본 http://localhost:3000). 서버의 LIVEJJIM_APP_ORIGIN은 이 화면 주소(예: http://localhost:5173)로 둔다.
// PWA: 운영용 빌드가 끝나면 그 빌드의 앱 껍데기(index.html·해시가 붙은 파일·public의 매니페스트·아이콘) 목록으로 /sw.js를 만든다(D-093).
// 음성: 운영용 빌드는 음성 연결 조각(transport.ts) 주소를 src/voice/retry.ts에 넣어 준다 — 받지 못한 뒤 새 주소로 다시 받는다(TE-I4-002).
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join, posix, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { serviceWorkerSource } from './pwa/service-worker.ts'
import { VOICE_CHUNK_PLACEHOLDER } from './src/voice/chunk.ts'

const apiTarget = process.env['LIVEJJIM_API_URL'] ?? 'http://localhost:3000'
// /r/<토큰>(구매자 확인서 링크 — 서버가 그리는 문서, N4b)도 서버로 넘긴다. '/receipts' 같은 화면 주소는 넘기지 않게 정규식으로 /r 하나·/r/만 고른다
// /ext/**(크롬 확장이 부르는 경로 — X1)도 넘긴다: 확장은 판매자가 여는 화면 주소 하나만 안다(host 권한도 그 주소 하나).
const proxy = { '/api': { target: apiTarget, changeOrigin: false, ws: true }, '^/r(/|$)': { target: apiTarget, changeOrigin: false }, '^/ext/': { target: apiTarget, changeOrigin: false } }

function publicFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
  } catch {
    return []
  }
}

/**
 * 첫 화면이 받지 않는 JS 조각: 진입 조각과 그 정적 import(꼬리까지)에 들지 않고 동적 import로만 닿는 조각.
 * 콘솔의 음성 연결 코드(transport.ts — "음성 켜기"를 누를 때 동적 import, D-I4-09)가 여기 든다.
 */
export function lazyChunks(bundle: Readonly<Record<string, { readonly type: string; readonly isEntry?: boolean; readonly imports?: readonly string[] }>>): Set<string> {
  const chunks = Object.entries(bundle).filter(([, output]) => output.type === 'chunk')
  const eager = new Set<string>()
  const queue = chunks.filter(([, output]) => output.isEntry === true).map(([fileName]) => fileName)
  while (queue.length > 0) {
    const fileName = queue.pop() as string
    if (eager.has(fileName)) continue
    eager.add(fileName)
    for (const imported of bundle[fileName]?.imports ?? []) queue.push(imported)
  }
  // URL로 읽는 PCM 작업 파일도 음성을 켤 때만 받는다(D-I4-09). Vite는 이 JS를 chunk가 아닌 asset으로 낸다.
  const worklets = Object.entries(bundle).filter(([fileName, output]) => output.type === 'asset' && /(?:^|\/)pcm-worklet-[^/]+\.js$/.test(fileName)).map(([fileName]) => fileName)
  return new Set([...chunks.map(([fileName]) => fileName).filter((fileName) => !eager.has(fileName)), ...worklets])
}

function realPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/** 음성 패키지 진입 파일 (그 동적 import가 만드는 조각을 찾는다) */
const VOICE_ENTRY = realPath(fileURLToPath(new URL('./src/voice/transport.ts', import.meta.url)))
const PCM_WORKLET_ENTRY = realPath(fileURLToPath(new URL('./src/voice/pcm-worklet.js', import.meta.url)))

/** chunk에서 target 파일을 부르는 상대 주소 (같은 폴더면 "./파일") */
export function chunkRelative(from: string, target: string): string {
  const path = posix.relative(posix.dirname(from), target)
  return path.startsWith('.') ? path : `./${path}`
}

/**
 * 음성 조각 주소를 넣는다 (TE-I4-002): 자리 글자(VOICE_CHUNK_PLACEHOLDER)가 든 조각마다 그 조각에서 본 음성 조각의 상대 주소로 바꾼다.
 * 크롬은 받지 못한 동적 import 주소를 다시 받지 않으므로 retry.ts가 이 주소에 ?retry=N을 붙여 다시 받는다. 음성 조각이나 자리를 못 찾으면 빌드를 멈춘다.
 */
function voiceChunkAddress(): Plugin {
  return {
    name: 'livejjim-voice-chunk-address',
    apply: 'build',
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).flatMap((output) => (output.type === 'chunk' ? [output] : []))
      const voice = chunks.filter((chunk) => chunk.facadeModuleId !== null && realPath(chunk.facadeModuleId) === VOICE_ENTRY)
      if (voice.length !== 1 || voice[0] === undefined) {
        this.error(`음성 조각을 하나로 찾지 못했다 (${String(voice.length)}개) — ${VOICE_ENTRY}`)
      }
      const target = voice[0].fileName
      let filled = 0
      for (const chunk of chunks) {
        if (!chunk.code.includes(VOICE_CHUNK_PLACEHOLDER)) continue
        chunk.code = chunk.code.replaceAll(VOICE_CHUNK_PLACEHOLDER, chunkRelative(chunk.fileName, target))
        filled++
      }
      if (filled === 0) this.error(`음성 조각 주소 자리(${VOICE_CHUNK_PLACEHOLDER})가 든 조각이 없다 — src/voice/retry.ts를 확인한다`)
    },
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
      const lazy = lazyChunks(bundle)
      for (const [fileName, output] of Object.entries(bundle).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
        if (fileName.endsWith('.map') || fileName === 'sw.js') continue
        // 누를 때만 받는 조각(음성 — D-I4-09)은 앱 껍데기가 아니다: 미리 받아 두지 않는다(누르기 전엔 음성 코드를 받지 않는다)
        if (lazy.has(fileName)) continue
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
  plugins: [react(), voiceChunkAddress(), serviceWorker()],
  // AudioWorklet은 같은 출처의 독립 JS로 읽는다. 그 외 자산은 Vite 기본 크기 기준을 유지한다.
  build: { assetsInlineLimit: (file) => realPath(file) === PCM_WORKLET_ENTRY ? false : undefined },
  server: { proxy },
  preview: { proxy },
})
