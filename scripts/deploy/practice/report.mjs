#!/usr/bin/env node
// 연습 환경에서 잰 결과(measure.mjs의 JSON)를 표로 낸다 — practice.sh report 가 부른다.
//   node scripts/deploy/practice/report.mjs <결과 폴더>
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
if (dir === undefined) {
  console.error('쓰는 법: report.mjs <결과 폴더>')
  process.exit(2)
}
const read = (name) => (existsSync(join(dir, name)) ? JSON.parse(readFileSync(join(dir, name), 'utf8')) : null)
const text = (name) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8').trim() : '')
const ms = (values) => (values === undefined || values.length === 0 ? '끊기지 않음' : values.map((v) => `${(v / 1000).toFixed(1)}초`).join(' · '))

const rows = [
  ['old.json', '지금 방식 (그 자리에서 다시 켜기 3번)'],
  ['migrate.json', '이사 (한 자리 → 두 자리, 한 번)'],
  ['new.json', '두 자리 교대 3번'],
  ['back.json', '되돌리기 한 번'],
]
console.log('| 무엇 | 읽기 요청 실패 / 전체 | 요청이 이어 실패한 가장 긴 시간 | 가장 느린 답 | 쓰기: 첫 시도 실패 · 포기 · 유실 · 중복 / 전체 | 실시간 연결(SSE) 다시 붙기 | 웹소켓 다시 붙기 |')
console.log('|---|---|---|---|---|---|---|')
for (const [file, name] of rows) {
  const r = read(file)
  if (r === null) {
    console.log(`| ${name} | (재지 않음) | | | | | |`)
    continue
  }
  const w = r.writes
  console.log(
    `| ${name} | ${String(r.reads.failed)} / ${String(r.reads.total)} | ${(r.reads.longestGapMs / 1000).toFixed(1)}초 | ${(r.reads.slowestMs / 1000).toFixed(2)}초 | ` +
      `${String(w.firstTryFailed)} · ${String(w.gaveUp)} · ${String(w.lost)} · ${String(w.duplicated)} / ${String(w.sent)}${w.error ? ` (기록 확인 실패: ${w.error})` : ''} | ` +
      `${String(r.sse.drops)}번 끊김, ${ms(r.sse.reconnectMs)} | ${r.ws.skipped ? '재지 않음' : `${String(r.ws.drops)}번 끊김, ${ms(r.ws.reconnectMs)}`} |`,
  )
}

// 걸린 시간·메모리
console.log('')
for (const name of ['build.txt', 'old.times', 'migrate.times', 'new.times', 'back.times']) {
  const t = text(name)
  if (t !== '') console.log(t.split('\n').map((line) => `- ${line}`).join('\n'))
}
const toMiB = (value) => {
  const m = /^([\d.]+)([KMG]i?B)/.exec(value)
  if (m === null) return 0
  const n = Number(m[1])
  return m[2].startsWith('G') ? n * 1024 : m[2].startsWith('K') ? n / 1024 : n
}
console.log('')
console.log('| 컨테이너 | 잰 동안 가장 큰 메모리 (MiB) | 어느 구간 |')
console.log('|---|---|---|')
for (const [file, name] of rows) {
  const mem = text(file.replace('.json', '.mem'))
  if (mem === '') continue
  const peak = new Map()
  let both = 0
  let sample = new Map()
  for (const line of mem.split('\n')) {
    const [container, usage] = line.split(' ')
    const value = toMiB(usage ?? '')
    peak.set(container, Math.max(peak.get(container) ?? 0, value))
    // 앱 컨테이너 둘이 같이 떠 있을 때의 합 (표본 하나 = 같은 이름이 다시 나오기 전까지)
    if (sample.has(container)) {
      both = Math.max(both, [...sample].filter(([k]) => /app/.test(k)).reduce((sum, [, v]) => sum + v, 0))
      sample = new Map()
    }
    sample.set(container, value)
  }
  for (const [container, value] of [...peak].sort()) console.log(`| ${container} | ${value.toFixed(0)} | ${name} |`)
  console.log(`| (앱 컨테이너 합의 최대) | ${both.toFixed(0)} | ${name} |`)
}
