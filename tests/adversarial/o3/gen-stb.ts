// D-STB-01 새 고정값 만들기 (테스트 파일 아님, AC-O3-30 (1)). 날짜 칸을 바꾼 지금 src로 돌린다:
//   node tests/adversarial/o3/gen-stb.ts   → tests/adversarial/o3/fixtures/base-strict-stb.json
// 지금 기본 템플릿으로 그린 상품 라벨 그림 중 BASE(base-strict.json)와 다른 해시만 모은다. BASE는 지우지 않는다 —
// strict-regression.test.ts가 옛 기본 템플릿(revertedLabel)으로 BASE 전부를 그대로 맞춘다.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as labelData from '../../../apps/server/src/label-data.ts'
import * as packing from '../../../apps/server/src/packing.ts'
import * as documents from '../../../packages/documents/src/index.ts'
import * as label from '../../../packages/label/src/index.ts'
import { createNodeRenderEnv } from '../../../packages/label/src/node.ts'
import { STRICT_SEEDS, play, snapshot, strictScenario, type Mods } from './scenarios.ts'
import type { StbFixture } from './stb.ts'

const dir = join(import.meta.dirname, 'fixtures')
const base = JSON.parse(readFileSync(join(dir, 'base-strict.json'), 'utf8')) as Record<string, { product: Record<string, { image: string | null }> }>
const mods: Mods = { labelData, packing, label, documents, env: createNodeRenderEnv() }
const out: StbFixture = {}
let changed = 0
let total = 0
for (const seed of STRICT_SEEDS) {
  const now = snapshot(play(strictScenario(seed)).state, mods).product as Record<string, { image: string | null }>
  const images: Record<string, string> = {}
  for (const [id, v] of Object.entries(now)) {
    total++
    if (v.image !== null && base[String(seed)]?.product[id]?.image !== v.image) {
      images[id] = v.image
      changed++
    }
  }
  out[String(seed)] = images
}
writeFileSync(join(dir, 'base-strict-stb.json'), `${JSON.stringify(out)}\n`)
console.log(`달라진 상품 라벨 그림 ${String(changed)} / ${String(total)}`)
