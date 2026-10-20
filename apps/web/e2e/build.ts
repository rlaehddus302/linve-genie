// 서버가 화면을 함께 내는 E2E 묶음용 화면 빌드 (AC-I3-70·93). 운영용으로 빌드해 --out 폴더에 둔다(폴더를 비우고 다시 쓴다).
// node e2e/build.ts --out /절대/경로
// 서버는 이 폴더를 --web-dir로 받아 같은 출처로 낸다(index.html이 있어야 시작한다).
import { isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const args = process.argv.slice(2)
const out = args[0] === '--out' ? args[1] : undefined
if (out === undefined || args.length !== 2 || !isAbsolute(out)) {
  process.stderr.write('인자는 --out /절대/경로 처럼 적어 주세요.\n')
  process.exit(2)
}

await build({ root: ROOT, configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)), logLevel: 'warn', build: { outDir: out, emptyOutDir: true } })
process.stdout.write(`E2E 화면을 빌드했어요. ${out}\n`)
