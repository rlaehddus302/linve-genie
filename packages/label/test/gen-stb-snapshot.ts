// D-STB-01 새 고정값 만들기 (테스트 파일 아님 — vitest가 읽지 않는다). 날짜 칸을 바꾼 지금 src로 돌린다:
//   node packages/label/test/gen-stb-snapshot.ts
// 지금 기본 템플릿으로 그린 그림 중 BASE(base-o3.json)와 다른 것만 모아 packages/label/test/fixtures/base-o3-stb.json에 쓴다.
// BASE는 지우지 않는다 — o3.test.ts가 옛 기본 템플릿(revertStbDateBox)으로 BASE 전부를 그대로 맞춘다.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createNodeRenderEnv } from '../src/node.ts'
import { collectSnapshot, type BaseSnapshot } from './base-snapshot.ts'

const fixtures = join(import.meta.dirname, 'fixtures')
const base = JSON.parse(readFileSync(join(fixtures, 'base-o3.json'), 'utf8')) as BaseSnapshot
const now = collectSnapshot(createNodeRenderEnv())
const renders: Record<string, string> = {}
for (const [key, value] of Object.entries(now.renders)) if (base.renders[key] !== value) renders[key] = value
writeFileSync(join(fixtures, 'base-o3-stb.json'), `${JSON.stringify({ renders }, null, 1)}\n`)
console.log(`달라진 그림 ${String(Object.keys(renders).length)} / ${String(Object.keys(now.renders).length)}`)
