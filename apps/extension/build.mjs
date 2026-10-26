// 확장 빌드: dist/ 폴더를 만든다 → 크롬 "확장 프로그램 관리 → 개발자 모드 → 압축해제된 확장 프로그램을 로드합니다"에서 이 폴더를 고른다.
//   pnpm --filter @livejjim/extension build                      (라이브지니 주소 기본 http://localhost:5173)
//   LIVEGENIE_ORIGIN=https://app.example.kr pnpm --filter @livejjim/extension build
//   LIVEGENIE_ORIGIN=https://app.example.kr pnpm --filter @livejjim/extension build -- --prod   (배포: https가 아니면 빌드 실패)
// 주소는 매니페스트 host 권한과 서버 부르는 주소 둘 다에 들어간다(D-X1-14). 출력은 사람이 읽을 수 있게 줄이지 않는다(스토어 심사).
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rolldown } from 'rolldown'
import { buildManifest, originPattern } from './src/manifest.ts'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, process.env['LIVEGENIE_EXT_OUT'] ?? 'dist')
const origin = (process.env['LIVEGENIE_ORIGIN'] ?? 'http://localhost:5173').replace(/\/+$/, '')
const prod = process.argv.includes('--prod') || process.env['LIVEGENIE_PROD'] === '1'
originPattern(origin, prod)
const { version } = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'))

const DEFAULT_LITERAL = "'http://localhost:5173'"
/** config.ts의 기본 주소를 빌드 주소로 바꾼다 */
const originPlugin = {
  name: 'livegenie-origin',
  transform(code, id) {
    if (!id.endsWith(join('src', 'config.ts'))) return null
    if (!code.includes(DEFAULT_LITERAL)) throw new Error('config.ts에서 기본 주소를 찾지 못했다')
    return { code: code.replaceAll(DEFAULT_LITERAL, JSON.stringify(origin)) }
  },
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
for (const entry of ['background', 'content', 'page', 'popup', 'tiktok-content']) {
  const bundle = await rolldown({ input: join(here, 'src', `${entry}.ts`), plugins: [originPlugin], platform: 'browser' })
  await bundle.write({ file: join(out, `${entry}.js`), format: 'iife', minify: false, sourcemap: false })
  await bundle.close()
}
copyFileSync(join(here, 'src', 'popup.html'), join(out, 'popup.html'))
copyFileSync(join(here, 'src', 'popup.css'), join(out, 'popup.css'))
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(buildManifest(origin, version), null, 2)}\n`)
process.stdout.write(`확장 빌드 완료: ${out} (라이브지니 주소 ${origin})\n`)
