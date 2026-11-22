// D-LABEL-SAFE-01 새 고정값 만들기 (테스트 파일 아님 — vitest가 읽지 않는다). 안전 영역을 넣은 지금 src로 돌린다:
//   node packages/label/test/gen-safe-snapshot.ts
// 종이 가장자리 1mm 안전 영역으로 달라진 그림만 모아 packages/label/test/fixtures/base-o3-safe.json에 쓴다.
// renders = 지금 기본 템플릿(BASE + D-STB-01 값)과 다른 것, before = 옛 기본 템플릿(revertStbDateBox)으로 그린 BASE와 다른 것.
// BASE·STB는 지우지 않는다 — o3.test.ts가 둘 위에 이 값을 덮어 점 하나까지 맞춘다.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createNodeRenderEnv } from '../src/node.ts'
import { beforeLargeFont, collectSnapshot, revertStbDateBox, type BaseSnapshot } from './base-snapshot.ts'

const fixtures = join(import.meta.dirname, 'fixtures')
const base = JSON.parse(readFileSync(join(fixtures, 'base-o3.json'), 'utf8')) as BaseSnapshot
const stb = JSON.parse(readFileSync(join(fixtures, 'base-o3-stb.json'), 'utf8')) as Pick<BaseSnapshot, 'renders'>
const nowBase: Record<string, string> = { ...base.renders, ...stb.renders }
const env = createNodeRenderEnv()
const diff = (now: Record<string, string>, old: Record<string, string>) => Object.fromEntries(Object.entries(now).filter(([key, value]) => old[key] !== value))
const renders = diff(collectSnapshot(env, undefined, beforeLargeFont).renders, nowBase)
const before = diff(collectSnapshot(env, undefined, revertStbDateBox).renders, base.renders)
writeFileSync(join(fixtures, 'base-o3-safe.json'), `${JSON.stringify({ renders, before }, null, 1)}\n`)
console.log(`달라진 그림 ${String(Object.keys(renders).length)} · 옛 기본 템플릿 ${String(Object.keys(before).length)}`)
