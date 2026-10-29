#!/usr/bin/env node
// 받아쓰기 일꾼 재생 측정 (VOC-07 AC5, AC-APP1-15, D-APP1-15) — 게이트 밖.
// 실방송 녹음(16kHz wav)을 100ms 조각으로 실시간 속도(--speed 1)로 흘려 넣고, 진짜 파이썬 일꾼(packages/voice/transcriber)이
// 돌려준 글과 말 끝 → 글 도착 지연(p50·p95)을 잰다. 일꾼은 이 스크립트가 127.0.0.1에 연 측정용 서버(일꾼 약속 그대로)로 먼저 붙는다.
// 받아쓴 글은 from-whisper.mjs가 읽는 모양(asr.json)으로 남겨 replay 채점(경성·금화 점수)에 쓴다.
//
//   node scripts/replay/stream.mjs <방송> [--from 초] [--duration 초] [--speed 1] [--model cohere|whisper] [--python <파이썬>]
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
  process.stderr.write('쓰는 법: node scripts/replay/stream.mjs <방송> [--from 초] [--duration 초] [--speed 1] [--model cohere|whisper] [--python <파이썬>]\n')
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
process.on('SIGINT', () => {
  cleanup()
  process.exit(130)
})

const worker = await Promise.race([hello, new Promise((_, reject) => setTimeout(() => reject(new Error('일꾼이 3분 안에 붙지 않았어요')), 180_000))])
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
closeSync(fd)
// 마지막 조각이 닫히게 쉼 1초, 그 뒤 결과를 기다린다
for (let index = 0; index < 10; index++) worker.sendBinary(Buffer.concat([header, Buffer.alloc(CHUNK_BYTES)]))
let before = -1
while (before !== results.length) {
  before = results.length
  await new Promise((resolve) => setTimeout(resolve, 8_000))
}
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
  latencyMs: speed === 1 ? { p50: quantile(latencies, 50), p95: quantile(latencies, 95), max: quantile(latencies, 100), n: latencies.length } : null,
  procMs: { p50: quantile(proc, 50), p95: quantile(proc, 95), max: quantile(proc, 100) },
}
writeJson(join(runDir, 'latency.json'), summary)
log(`끝 ${JSON.stringify(summary)}`)
log(`채점: node scripts/replay/from-whisper.mjs ${join(runDir, 'asr.json')} ${broadcast} <이름> --interim 0 → node scripts/replay/cli.mjs replay ${broadcast} --run <이름>`)
await server.close().catch(() => undefined)
logFile.end()
process.exit(existsSync(tokenFile) ? 1 : 0)
