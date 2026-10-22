// BASE 고정값 만들기 (테스트 파일 아님, AC-O3-30 (1)). O3 전(BASE) 커밋의 src로 다육 시나리오의 결과를 모은다.
// 쓰는 법 (BASE 트리를 따로 풀어 node_modules를 이어 둔 뒤):
//   node tests/adversarial/o3/gen-base.ts <BASE 트리 루트>   → tests/adversarial/o3/fixtures/base-strict.json
// 지금 src로 만들면 회귀 시험이 아니다. 코어는 O3에서 바뀌지 않으므로 시나리오 재생은 이 트리의 코어로 한다.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { STRICT_SEEDS, play, snapshot, strictScenario, type Mods } from './scenarios.ts'

const root = process.argv[2]
if (root === undefined) throw new Error('BASE 트리 루트를 적어 주세요')
const mods: Mods = {
  labelData: await import(join(root, 'apps/server/src/label-data.ts')),
  packing: await import(join(root, 'apps/server/src/packing.ts')),
  label: await import(join(root, 'packages/label/src/index.ts')),
  documents: await import(join(root, 'packages/documents/src/index.ts')),
  env: (await import(join(root, 'packages/label/src/node.ts'))).createNodeRenderEnv(),
}
const out: Record<string, unknown> = {}
for (const seed of STRICT_SEEDS) out[String(seed)] = snapshot(play(strictScenario(seed)).state, mods)
const dir = join(import.meta.dirname, 'fixtures')
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'base-strict.json'), `${JSON.stringify(out)}\n`)
console.log(`seeds ${String(STRICT_SEEDS.length)}`)
