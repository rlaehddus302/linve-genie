#!/usr/bin/env node
// 실방송 재생 시험 (음성 상품 등록). 쓰는 법은 scripts/replay/README.md
//   node scripts/replay/cli.mjs record  <방송> [--from 초] [--duration 초] [--port 7700]
//   node scripts/replay/cli.mjs compare <방송> [--run 폴더] [--result result.json]
//   node scripts/replay/cli.mjs replay  <방송> [--run 폴더] [--port 7720] [--max-step 10000] [--headed]
//   node scripts/replay/cli.mjs all     <방송> [record 옵션]   (record → compare → replay)
// <방송>은 .live-replay/ 아래 폴더 이름 (예: 2026-10-26-금화다육). --run을 빼면 가장 최근 녹음.
import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { broadcastDir, latestRun, ROOT } from './lib/common.mjs'

const [command, broadcast, ...rest] = process.argv.slice(2)
const opts = {}
for (let i = 0; i < rest.length; i++) {
  const a = rest[i]
  if (!a.startsWith('--')) continue
  const key = a.slice(2)
  const next = rest[i + 1]
  if (next === undefined || next.startsWith('--')) opts[key] = true
  else {
    opts[key] = next
    i++
  }
}
const num = (v, d) => (v === undefined ? d : Number(v))
const usage = () => {
  process.stderr.write('쓰는 법: node scripts/replay/cli.mjs record|compare|replay|all <방송 폴더 이름> [옵션] — scripts/replay/README.md\n')
  process.exit(2)
}
if (!['record', 'compare', 'replay', 'all'].includes(command) || broadcast === undefined) usage()
broadcastDir(broadcast)

const runOf = () => {
  const run = opts.run === undefined ? latestRun(broadcast) : isAbsolute(opts.run) ? opts.run : join(broadcastDir(broadcast), 'runs', opts.run)
  if (run === null || !existsSync(run)) throw new Error('녹음 실행 폴더가 없어요. 먼저 record를 하세요.')
  return run
}
const truthOf = () => {
  const f = join(broadcastDir(broadcast), 'truth.json')
  return existsSync(f) ? f : null
}

async function doRecord() {
  const { record } = await import('./record.mjs')
  return await record({ broadcast, from: num(opts.from, 0), duration: opts.duration === undefined ? null : Number(opts.duration), port: num(opts.port, 7700) })
}
async function doCompare(run) {
  const { compare } = await import('./compare.mjs')
  const resultFile = opts.result === undefined ? join(run, 'result.json') : isAbsolute(opts.result) ? opts.result : join(ROOT, opts.result)
  const score = compare({ resultFile, truthFile: truthOf(), transcriptFile: join(run, 'transcript.jsonl'), outDir: run, label: `${broadcast} 녹음` })
  process.stdout.write(`${JSON.stringify({ report: join(run, 'report.md'), counts: score.counts, products: score.products, extras: score.extras })}\n`)
}
async function doReplay(run) {
  const { replay } = await import('./replay.mjs')
  const out = await replay({ broadcast, runDir: run, port: num(opts.port, 7720), maxStepMs: num(opts['max-step'], 10_000), headless: opts.headed !== true })
  process.stdout.write(`${JSON.stringify({ report: join(out.outDir, 'report.md'), counts: out.score.counts, vsRecord: out.sameAsRecord === null ? null : { same: out.sameAsRecord.same, differ: out.sameAsRecord.differ.length, onlyRecord: out.sameAsRecord.onlyRecord, onlyReplay: out.sameAsRecord.onlyReplay, voiceLogSame: out.sameAsRecord.voiceLog.same } })}\n`)
}

try {
  if (command === 'record') await doRecord()
  else if (command === 'compare') await doCompare(runOf())
  else if (command === 'replay') await doReplay(runOf())
  else {
    const run = await doRecord()
    await doCompare(run)
    await doReplay(run)
  }
  process.exit(0)
} catch (error) {
  process.stderr.write(`실패: ${error?.stack ?? String(error)}\n`)
  process.exit(1)
}
