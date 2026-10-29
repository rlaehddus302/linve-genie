#!/usr/bin/env node
// 받아쓰기 일꾼 재생 측정 (VOC-07 AC5, AC-APP1-15, D-APP1-15) — 게이트 밖.
// 실방송 녹음(16kHz wav)을 100ms 조각으로 실시간 속도(--speed 1)로 흘려 넣고, 진짜 파이썬 일꾼(packages/voice/transcriber)이
// 돌려준 글과 말 끝 → 글 도착 지연(p50·p95)을 잰다. 일꾼은 이 스크립트가 127.0.0.1에 연 측정용 서버(일꾼 약속 그대로)로 먼저 붙는다.
// 받아쓴 글은 from-whisper.mjs가 읽는 모양(asr.json)으로 남겨 replay 채점(경성·금화 점수)에 쓴다.
//
//   node scripts/replay/stream.mjs <방송> [--from 초] [--duration 초] [--speed 1] [--model cohere|whisper] [--python <파이썬>] [--drain-idle 초]
//
// --speed 1이 아니면 지연은 재지 않는다(조각 나누기·글은 속도와 상관없이 같다 — 점수용으로 빨리 돌릴 때).
// 결과: .live-replay/<방송>/runs/stream-<시각>/ — asr.json(받아쓴 글, 개인정보), latency.json(숫자만), run.log(일꾼 로그: 셈만).
// 받아쓴 글은 화면·콘솔에 찍지 않는다. 일꾼 토큰은 이번 실행에만 쓰는 무작위 값(실행 폴더의 0600 파일, 끝나면 지움).
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, WORK, broadcastDir, ensureWav, stamp, writeJson } from './lib/common.mjs'
import { wavInfo } from './lib/wav.mjs'
import { startWsServer } from './lib/ws-mini.mjs'

const args = process.argv.slice(2)
const broadcast = args[0]
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index < 0 ? fallback : args[index + 1]
}
if (broadcast === undefined || broadcast.startsWith('--')) {
  process.stderr.write('쓰는 법: node scripts/replay/stream.mjs <방송> [--from 초] [--duration 초] [--speed 1] [--model cohere|whisper] [--python <파이썬>] [--drain-idle 초]\n')
  process.exit(2)
}
const from = Number(option('from', 0))
const duration = option('duration', null)
const speed = Number(option('speed', 1))
const model = option('model', 'cohere')
const python = option('python', process.env.LIVEJJIM_PYTHON ?? join(WORK, 'asr', '.venv-cohere', 'bin', 'python'))
if (!(speed > 0) || !(from >= 0)) {
  process.stderr.write('--speed는 0보다 크고 --from은 0 이상이어야 해요.\n')
  process.exit(2)
}

const CHUNK_BYTES = 3_200
const CHUNK_MS = 100
const STREAM = 1

const dir = broadcastDir(broadcast)
const runDir = join(dir, 'runs', `stream-${model}-${stamp()}`)
mkdirSync(runDir, { recursive: true })
const logFile = createWriteStream(join(runDir, 'run.log'))
const log = (line) => {
  const text = `${new Date().toISOString()} ${line}`
  process.stdout.write(`${text}\n`)
  logFile.write(`${text}\n`)
}

const wav = ensureWav(broadcast, log)
const info = wavInfo(wav)
if (info.sampleRate !== 16_000 || info.channels !== 1 || info.bits !== 16) throw new Error('16kHz 모노 16비트 wav가 아니에요')
const startByte = Math.floor(from * 16_000) * 2
const endByte = duration === null ? info.dataSize : Math.min(info.dataSize, startByte + Math.floor(Number(duration) * 16_000) * 2)
const totalChunks = Math.ceil((endByte - startByte) / CHUNK_BYTES)

const token = randomBytes(32).toString('hex')
const tokenFile = join(runDir, '.worker-token')
writeFileSync(tokenFile, token, { mode: 0o600 })

const results = []
let resolveHello
const hello = new Promise((resolve) => {
  resolveHello = resolve
})
let t0 = 0

const server = await startWsServer({
  accept: (request) => {
    if (!request.url?.startsWith('/api/voice/worker')) return 404
    return request.headers.authorization === `Bearer ${token}` ? null : 401
  },
  onPeer: (peer) => {
    peer.onText = (text) => {
      let message
      try {
        message = JSON.parse(text)
      } catch {
        return
      }
      if (message.type === 'hello') resolveHello(peer)
      else if (message.type === 'result' && message.stream === STREAM) results.push({ ...message, recvAt: performance.now() })
    }
    peer.onClose = () => log('일꾼 연결이 닫혔어요')
  },
})
log(`측정 서버 127.0.0.1:${String(server.port)} · ${broadcast} ${String(from)}초부터 ${String(((endByte - startByte) / 32_000).toFixed(0))}초 · 속도 ×${String(speed)} · 모델 ${model}`)

const transcriber = join(ROOT, 'packages', 'voice', 'transcriber')
const child = spawn(python, ['-B', '-m', 'livegenie_transcriber', '--server', `http://127.0.0.1:${String(server.port)}`, '--token-file', tokenFile, '--model', model, '--max-streams', '1'], {
  cwd: transcriber,
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
child.stdout.on('data', (data) => logFile.write(data))
child.stderr.on('data', (data) => logFile.write(data))
let exited = false
child.on('exit', (code) => {
  exited = true
  log(`일꾼 끝 (${String(code)})`)
})

const cleanup = () => {
  try {
    rmSync(tokenFile, { force: true })
  } catch {
    // 무시
  }
  if (!exited) child.kill('SIGTERM')
}
// 어떻게 끝나든(오류·SIGTERM·Ctrl+C) 일꾼을 남기지 않는다 — 일꾼은 서버가 없어도 끝없이 다시 붙으려 해 고아로 남으면 모델 메모리를 쥔다.
process.on('exit', cleanup)
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
  process.on(signal, () => {
    cleanup()
    process.exit(code)
  })
}

// 모델 불러오기는 다른 측정과 겹치면 몇 분 넘게 걸린다 — 10분 기다리고, 일꾼이 먼저 끝나면 바로 멈춘다.
const workerExited = new Promise((_, reject) => child.on('exit', () => reject(new Error('일꾼이 붙기 전에 끝났어요 (run.log를 보세요)'))))
const worker = await Promise.race([
  hello,
  workerExited,
  new Promise((_, reject) => setTimeout(() => reject(new Error('일꾼이 10분 안에 붙지 않았어요')), 600_000).unref()),
]).catch((error) => {
  log(error.message)
  process.exit(1)
})
log('일꾼이 붙었어요 — 흐름을 열고 소리를 흘려요')
worker.sendText(JSON.stringify({ type: 'open', stream: STREAM }))

const fd = openSync(wav, 'r')
const header = Buffer.alloc(4)
header.writeUInt32BE(STREAM, 0)
t0 = performance.now()
let lastReport = 0
for (let index = 0; index < totalChunks; index++) {
  const due = t0 + (index * CHUNK_MS) / speed
  const wait = due - performance.now()
  if (wait > 1) await new Promise((resolve) => setTimeout(resolve, wait))
  const position = startByte + index * CHUNK_BYTES
  const length = Math.min(CHUNK_BYTES, endByte - position)
  const pcm = Buffer.alloc(length)
  readSync(fd, pcm, 0, length, info.dataOffset + position)
  worker.sendBinary(Buffer.concat([header, pcm]))
  if (performance.now() - lastReport > 60_000) {
    lastReport = performance.now()
    log(`진행 ${String(Math.round((index * CHUNK_MS) / 1000))}/${String(Math.round((totalChunks * CHUNK_MS) / 1000))}초 · 결과 ${String(results.length)}개`)
  }
}
// 줄에 선 조각을 다 받아쓸 때까지 기다린다 (일꾼은 close를 받으면 줄에 선 조각을 버린다 — D-APP1-11).
// 예전엔 "8초 동안 새 결과 없음"이면 닫았는데, 빠른 속도(--speed 8)로 일꾼이 밀리면 그때 줄에 선 조각(금화 4시간 중 뒤 2시간)이
// 통째로 버려져 MISSING이 됐다. 이제는 끝 표시를 보낸다: 쉼 1초 뒤 이미 글이 나온 말 한 토막을 한 번 더 흘리고 쉼 1초.
// 일꾼은 조각을 들어온 차례대로 받아쓰므로 끝 표시의 결과가 오면 그 앞 조각은 다 끝난 것이다. 끝 표시 결과는 asr.json에 넣지 않는다.
// 끝 표시가 빈 글로 끝나 오지 않을 때를 대비해, --drain-idle초(기본 900) 동안 새 결과가 하나도 없으면 그만 기다린다(drained=false).
const silence = () => {
  for (let index = 0; index < 10; index++) worker.sendBinary(Buffer.concat([header, Buffer.alloc(CHUNK_BYTES)]))
}
const pause = () => new Promise((resolve) => setTimeout(resolve, 1_000))
const mainEndMs = Math.floor(((endByte - startByte) / 2) * 1000 / 16_000)
const drainIdleMs = Number(option('drain-idle', 900)) * 1000
let lastCount = results.length
let lastChange = performance.now()
const idleTooLong = () => {
  if (results.length !== lastCount) {
    lastCount = results.length
    lastChange = performance.now()
  }
  return performance.now() - lastChange > drainIdleMs
}
silence()
const sentBytes = endByte - startByte + 10 * CHUNK_BYTES
// 끝 표시로 쓸 말: 이미 받은 결과 중 1초 이상인 첫 것 (아직 없으면 생길 때까지 기다린다)
let source
while ((source = results.find((result) => result.endMs - result.startMs >= 1_000)) === undefined && !exited && !idleTooLong()) await pause()
let markerFromMs = null
if (source !== undefined) {
  markerFromMs = Math.floor((sentBytes / 2) * 1000 / 16_000)
  const position = startByte + Math.floor((source.startMs * 16_000) / 1000) * 2
  const length = Math.min(Math.floor(((source.endMs - source.startMs) * 16_000) / 1000) * 2 + 3_200, endByte - position)
  const pcm = Buffer.alloc(length)
  const markerFd = openSync(wav, 'r')
  readSync(markerFd, pcm, 0, length, info.dataOffset + position)
  closeSync(markerFd)
  for (let offset = 0; offset < pcm.length; offset += CHUNK_BYTES) {
    worker.sendBinary(Buffer.concat([header, pcm.subarray(offset, Math.min(offset + CHUNK_BYTES, pcm.length))]))
    await new Promise((resolve) => setTimeout(resolve, CHUNK_MS / speed))
  }
  silence()
}
let drained = false
let lastWaitReport = performance.now()
while (!exited) {
  if (markerFromMs !== null && results.some((result) => result.startMs >= markerFromMs)) {
    drained = true
    break
  }
  if (idleTooLong()) break
  if (performance.now() - lastWaitReport > 60_000) {
    lastWaitReport = performance.now()
    log(`남은 조각 기다리는 중 · 결과 ${String(results.length)}개`)
  }
  await pause()
}
if (!drained) log(`줄에 선 조각을 다 받았는지 확인하지 못했어요(일꾼 ${exited ? '끝남' : `${String(drainIdleMs / 1000)}초 동안 결과 없음`}) — 점수가 낮게 나올 수 있어요`)
// 끝 표시와 그 뒤 쉼에서 나온 결과는 버린다(방송 소리 밖)
const markerResults = results.filter((result) => result.startMs >= mainEndMs).length
results.splice(0, results.length, ...results.filter((result) => result.startMs < mainEndMs))
worker.sendText(JSON.stringify({ type: 'close', stream: STREAM }))
cleanup()
await new Promise((resolve) => setTimeout(resolve, 500))
worker.close()

// 지연: 말 끝 → 결과 도착. 조각 i(소리 i×100 ~ i×100+100ms)는 t0 + i×100에 보내므로, 그 조각 소리가 끝난 때 = 보낸 때로 보면
// 소리 위치 a ms의 실제 시각 = t0 + a − 100. 기기가 100ms 조각을 모으는 기다림도 지연에 든다. 망 지연(휴대폰 ↔ 서버 ↔ 일꾼)은 들지 않는다(127.0.0.1)
const latencies = speed === 1 ? results.map((result) => Math.round(result.recvAt - (t0 + result.endMs - CHUNK_MS))) : []
const proc = results.map((result) => result.procMs)
const quantile = (values, rank) => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(1, Math.ceil((rank / 100) * sorted.length)) - 1]
}
const offset = Math.round(from * 1_000)
writeJson(join(runDir, 'asr.json'), {
  engine: `livegenie-${model}`,
  audioSeconds: (endByte - startByte) / 32_000,
  from,
  speed,
  transcription: results.map((result) => ({ offsets: { from: offset + result.startMs, to: offset + result.endMs }, text: result.text })),
})
const summary = {
  broadcast,
  model,
  from,
  seconds: (endByte - startByte) / 32_000,
  speed,
  results: results.length,
  drained,
  markerResults,
  latencyMs: speed === 1 ? { p50: quantile(latencies, 50), p95: quantile(latencies, 95), max: quantile(latencies, 100), n: latencies.length } : null,
  procMs: { p50: quantile(proc, 50), p95: quantile(proc, 95), max: quantile(proc, 100) },
}
writeJson(join(runDir, 'latency.json'), summary)
log(`끝 ${JSON.stringify(summary)}`)
log(`채점: node scripts/replay/from-whisper.mjs ${join(runDir, 'asr.json')} ${broadcast} <이름> --interim 0 → node scripts/replay/cli.mjs replay ${broadcast} --run <이름>`)
await server.close().catch(() => undefined)
logFile.end()
process.exit(existsSync(tokenFile) ? 1 : 0)
