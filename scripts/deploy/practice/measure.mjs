#!/usr/bin/env node
// 교체하는 동안 무엇이 끊기는지 잰다 (D-RETRO-35, docs/DEPLOY.md 6-2절 "연습 환경") — 내 컴퓨터 연습 환경(practice.sh)이 부른다. 운영 서버에 쓰지 않는다.
//   node scripts/deploy/practice/measure.mjs --base http://localhost:18080 --cookie-file <파일> --out <결과.json> [--worker-token-file <파일>] [--label 글]
// 끝낼 때: SIGINT·SIGTERM을 받으면 쓰기를 마무리하고 결과를 --out 에 JSON으로, 표준 출력에 한 줄 요약으로 낸다.
//
// 동시에 넷을 돌린다 (모두 앞단을 지나서):
//   읽기    50밀리초마다(초당 20번) GET /health 와 읽기 API(GET /api/days/<날짜>?rehearsal=true)를 번갈아 부른다. 200이 아니거나 연결이 안 되면 실패로 센다.
//           /health 가 답한 자리 이름(slot)이 바뀐 때도 적는다. 실패가 이어진 가장 긴 시간이 "끊긴 시간"이다.
//   쓰기    200밀리초마다 리허설 방송에 상품 등록 이벤트를 하나씩 쓴다(요청 번호 pw-<실행>-<번호>). 실패하면 **같은 요청 번호로** 다시 보낸다(1초 간격, 20번까지).
//           끝에 서버 기록(이력)과 맞대어 유실(받았다고 답했는데 기록에 없음)·중복(같은 번호의 등록이 두 줄)을 센다.
//   SSE     GET /api/stream 을 열어 두고, 끊기면 250밀리초마다 다시 붙는다. 끊긴 때부터 다시 ready 를 받을 때까지를 잰다.
//           (브라우저 EventSource 는 서버가 알려 준 retry 3초 뒤에 붙는다 — 그 값은 따로 더해 읽는다)
//   웹소켓  받아쓰기 일꾼 입구(/api/voice/worker)에 일꾼 토큰으로 붙어 hello 를 보내 두고, 끊기면 250밀리초마다 다시 붙는다(--worker-token-file 을 줬을 때만).
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { setTimeout as sleep } from 'node:timers/promises'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1])
const base = (args.get('--base') ?? '').replace(/\/$/, '')
const out = args.get('--out')
const cookieFile = args.get('--cookie-file')
if (base === '' || out === undefined || cookieFile === undefined) {
  console.error('쓰는 법: measure.mjs --base <앞단 주소> --cookie-file <세션 쿠키 파일> --out <결과.json> [--worker-token-file <파일>] [--label 글]')
  process.exit(2)
}
const cookie = readFileSync(cookieFile, 'utf8').trim()
const workerToken = args.has('--worker-token-file') ? readFileSync(args.get('--worker-token-file'), 'utf8').trim() : null
const label = args.get('--label') ?? ''
const READ_EVERY_MS = 50
const WRITE_EVERY_MS = 200
const RECONNECT_EVERY_MS = 250
const run = Math.random().toString(16).slice(2, 10)
const t0 = Date.now()
const since = () => Date.now() - t0

let stopping = false
/** 끝낼 때 열어 둔 실시간 연결을 끊는다 (읽기 대기에서 바로 빠져나오게) */
const stopSignal = new AbortController()
const headers = { Cookie: cookie }
const post = (path, body) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { ...headers, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) })

// ── 준비: 리허설 방송 하나 ─────────────────────────────────────────────
const made = await post('/api/broadcasts', { requestId: `pw-${run}-bc`, rehearsal: true })
if (made.status !== 200) {
  console.error(`리허설 방송을 만들지 못했어요 (HTTP ${String(made.status)})`)
  process.exit(1)
}
const { broadcast } = await made.json()

// ── 읽기 ───────────────────────────────────────────────────────────────
const reads = { total: 0, failed: 0, failures: [], slowest: 0, latencies: [], slots: [], longestGapMs: 0 }
async function reader() {
  let lastSlot = null
  let failingSince = null
  let n = 0
  while (!stopping) {
    const started = Date.now()
    const path = n % 2 === 0 ? '/health' : `/api/days/${broadcast.date}?rehearsal=true`
    n += 1
    let ok = false
    let detail
    try {
      const response = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(30_000) })
      const body = await response.text()
      ok = response.status === 200
      detail = `HTTP ${String(response.status)}`
      if (ok && path === '/health') {
        const slot = JSON.parse(body).slot ?? '(자리 없음)'
        if (slot !== lastSlot) {
          reads.slots.push({ atMs: since(), slot })
          lastSlot = slot
        }
      }
    } catch (error) {
      detail = error?.cause?.code ?? error?.name ?? 'error'
    }
    const took = Date.now() - started
    reads.total += 1
    reads.latencies.push(took)
    if (took > reads.slowest) reads.slowest = took
    if (!ok) {
      reads.failed += 1
      if (reads.failures.length < 200) reads.failures.push({ atMs: started - t0, path: path.startsWith('/health') ? '/health' : '읽기 API', detail })
      failingSince ??= started
    } else if (failingSince !== null) {
      reads.longestGapMs = Math.max(reads.longestGapMs, Date.now() - failingSince)
      failingSince = null
    }
    await sleep(Math.max(0, READ_EVERY_MS - took))
  }
  if (failingSince !== null) reads.longestGapMs = Math.max(reads.longestGapMs, Date.now() - failingSince)
}

// ── 쓰기 ───────────────────────────────────────────────────────────────
const writes = { sent: 0, acked: 0, firstTryFailed: 0, gaveUp: 0, retries: 0, slowest: 0, failures: [], ackedNos: [] }
async function writer() {
  let no = 0
  while (!stopping) {
    no += 1
    const requestId = `pw-${run}-${String(no)}`
    writes.sent += 1
    let done = false
    for (let attempt = 0; attempt < 20 && !done; attempt += 1) {
      const started = Date.now()
      let detail
      try {
        const response = await post('/api/events', { requestId, type: 'product.register', b: broadcast.id, no, name: `연습 ${String(no)}`, price: 1000 })
        await response.text()
        detail = `HTTP ${String(response.status)}`
        done = response.status === 200
      } catch (error) {
        detail = error?.cause?.code ?? error?.name ?? 'error'
      }
      writes.slowest = Math.max(writes.slowest, Date.now() - started)
      if (!done) {
        if (attempt === 0) writes.firstTryFailed += 1
        else writes.retries += 1
        if (writes.failures.length < 200) writes.failures.push({ atMs: started - t0, requestId, attempt, detail })
        await sleep(1000)
      }
    }
    if (done) {
      writes.acked += 1
      writes.ackedNos.push(no)
    } else writes.gaveUp += 1
    await sleep(WRITE_EVERY_MS)
  }
}

// ── SSE ────────────────────────────────────────────────────────────────
const sse = { connects: 0, drops: [], reconnectMs: [] }
async function sseLoop() {
  let droppedAt = null
  while (!stopping) {
    let ready = false
    try {
      const response = await fetch(`${base}/api/stream`, { headers: { ...headers, Accept: 'text/event-stream' }, signal: stopSignal.signal })
      if (response.status !== 200 || response.body === null) throw new Error(`HTTP ${String(response.status)}`)
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        buffer += decoder.decode(chunk.value, { stream: true })
        if (!ready && buffer.includes('event: ready')) {
          ready = true
          sse.connects += 1
          if (droppedAt !== null) {
            sse.reconnectMs.push(Date.now() - droppedAt)
            droppedAt = null
          }
        }
        if (buffer.length > 65_536) buffer = buffer.slice(-1024)
        if (stopping) {
          await reader.cancel().catch(() => {})
          return
        }
      }
    } catch {
      // 붙지 못했거나 읽다가 연결이 깨짐 — 아래에서 끊김으로 세고 다시 해 본다
    }
    // 붙어 있던 연결이 끝났다(서버가 닫았든 연결이 깨졌든). 이미 끊긴 채 다시 붙는 중이었으면 처음 끊긴 때를 그대로 둔다
    if (ready && !stopping) {
      sse.drops.push({ atMs: since() })
      droppedAt ??= Date.now()
    }
    if (!stopping) await sleep(RECONNECT_EVERY_MS)
  }
}

// ── 웹소켓 (받아쓰기 일꾼 입구) ────────────────────────────────────────
const ws = { connects: 0, drops: [], reconnectMs: [], skipped: workerToken === null }
async function wsLoop() {
  if (workerToken === null) return
  const require = createRequire(new URL('../../../apps/server/package.json', import.meta.url))
  const WebSocket = require('ws')
  const url = `${base.replace(/^http/, 'ws')}/api/voice/worker`
  let droppedAt = null
  while (!stopping) {
    await new Promise((resolve) => {
      let opened = false
      const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${workerToken}` } })
      const stop = setInterval(() => {
        if (stopping) socket.terminate()
      }, 200)
      socket.on('open', () => {
        opened = true
        ws.connects += 1
        socket.send(JSON.stringify({ type: 'hello', maxStreams: 1 }))
        if (droppedAt !== null) {
          ws.reconnectMs.push(Date.now() - droppedAt)
          droppedAt = null
        }
      })
      socket.on('error', () => {})
      socket.on('close', () => {
        clearInterval(stop)
        if (opened && !stopping) {
          droppedAt = Date.now()
          ws.drops.push({ atMs: since() })
        }
        resolve()
      })
    })
    if (!stopping) await sleep(RECONNECT_EVERY_MS)
  }
}

// ── 끝내기: 서버 기록과 맞대기 ─────────────────────────────────────────
async function recorded() {
  // 이력은 seq 오름차순으로 after 뒤 500개씩. 이번 실행의 방송에 쓴 상품 등록만 번호(no)로 모은다
  const numbers = []
  let after = 0
  for (let page = 0; page < 400; page += 1) {
    const response = await fetch(`${base}/api/days/${broadcast.date}/history?limit=500&after=${String(after)}&rehearsal=true`, { headers })
    if (response.status !== 200) throw new Error(`이력을 읽지 못했어요 (HTTP ${String(response.status)})`)
    const events = (await response.json()).events ?? []
    for (const event of events) if (event.type === 'product.register' && event.fields?.b === broadcast.id) numbers.push(event.fields.no)
    if (events.length < 500) break
    after = events.at(-1).seq
  }
  return numbers
}

const percentile = (values, p) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

const tasks = [reader(), writer(), sseLoop(), wsLoop()]
const finish = async () => {
  if (stopping) return
  stopping = true
  stopSignal.abort()
  await Promise.allSettled(tasks)
  let check = { recorded: null, lost: null, duplicated: null, error: null }
  try {
    const numbers = await recorded()
    const counts = new Map()
    for (const no of numbers) counts.set(no, (counts.get(no) ?? 0) + 1)
    check = {
      recorded: numbers.length,
      // 유실: 서버가 받았다고 답했는데 기록에 없는 것 · 중복: 같은 번호의 등록이 두 줄 이상(같은 요청 번호로 다시 보낸 것이 두 번 기록됨)
      lost: writes.ackedNos.filter((no) => !counts.has(no)).length,
      duplicated: [...counts.values()].filter((count) => count > 1).length,
      error: null,
    }
  } catch (error) {
    check.error = String(error?.message ?? error)
  }
  const result = {
    label,
    base,
    seconds: Math.round(since() / 1000),
    reads: { total: reads.total, failed: reads.failed, longestGapMs: reads.longestGapMs, p50Ms: percentile(reads.latencies, 50), p99Ms: percentile(reads.latencies, 99), slowestMs: reads.slowest, slots: reads.slots, failures: reads.failures },
    writes: { sent: writes.sent, acked: writes.acked, firstTryFailed: writes.firstTryFailed, retries: writes.retries, gaveUp: writes.gaveUp, slowestMs: writes.slowest, ...check, failures: writes.failures },
    sse: { connects: sse.connects, drops: sse.drops.length, reconnectMs: sse.reconnectMs },
    ws: ws.skipped ? { skipped: true } : { connects: ws.connects, drops: ws.drops.length, reconnectMs: ws.reconnectMs },
  }
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`)
  console.log(
    `[${label}] ${String(result.seconds)}초 · 읽기 ${String(reads.total)}번 중 실패 ${String(reads.failed)}(가장 길게 ${String(reads.longestGapMs)}ms, 가장 느린 답 ${String(reads.slowest)}ms) · ` +
      `쓰기 ${String(writes.sent)}건 중 첫 시도 실패 ${String(writes.firstTryFailed)}·포기 ${String(writes.gaveUp)}·유실 ${String(check.lost)}·중복 ${String(check.duplicated)} · ` +
      `SSE 끊김 ${String(sse.drops.length)}번(다시 붙기 ${sse.reconnectMs.join('·') || '-'}ms) · 웹소켓 ${ws.skipped ? '건너뜀' : `끊김 ${String(ws.drops.length)}번(다시 붙기 ${ws.reconnectMs.join('·') || '-'}ms)`}`,
  )
  process.exit(0)
}
process.on('SIGINT', () => void finish())
process.on('SIGTERM', () => void finish())
console.log(`[${label}] 재는 중 — 방송 ${broadcast.id} (${broadcast.date}), 실행 ${run}`)
