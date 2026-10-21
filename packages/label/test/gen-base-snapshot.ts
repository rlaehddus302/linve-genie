// O3 다육 회귀 고정값 만들기 (테스트 파일 아님 — vitest가 읽지 않는다). 반드시 O3 전(BASE) src로 돌린다:
//   git stash push packages/label/src && node packages/label/test/gen-base-snapshot.ts && git stash pop
// 결과: packages/label/test/fixtures/base-o3.json
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createNodeRenderEnv } from '../src/node.ts'
import { collectSnapshot } from './base-snapshot.ts'

const snapshot = collectSnapshot(createNodeRenderEnv())
writeFileSync(join(import.meta.dirname, 'fixtures', 'base-o3.json'), `${JSON.stringify(snapshot, null, 1)}\n`)
console.log(`그림 ${String(Object.keys(snapshot.renders).length)} · 키 ${String(Object.keys(snapshot.keys).length)}`)
