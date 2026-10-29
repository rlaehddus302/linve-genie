// from-whisper: whisper.cpp JSON(-oj) 받아쓰기를 replay가 읽는 transcript.jsonl 모양으로 바꾼다 — 다른 인식 엔진을 같은 채점으로 비교하려고.
//
// replay는 녹음 줄을 "화면이 만든 인식 객체 차례(k)"로 낸다. 크롬 녹음에는 화면(음성 엔진)이 스스로 닫고 연 객체가
// 그대로 적혀 있어 차례가 맞지만, 위스퍼 글에는 그런 것이 없다. 화면은 재생 중에도 똑같이
//   - 멈춤 지킴이: 소리를 받는 객체에서 결과 이벤트가 2초(결과 없는 다시 열기 3번 이어지면 4초) 없으면 abort하고 새 객체를 연다
//   - 쉬는 틈 다시 열기: 연 지 45초 넘은 객체에서 최종 결과가 오고 남은 중간 결과가 없으면 stop()하고, 끝(end) 뒤 새 객체를 연다
// 를 하므로, 변환기가 그 결정을 미리 똑같이 흉내 내어 크롬이 했을 응답(abort → audioend·error aborted·end, stop → audioend·end)과
// 새 객체(create·start·audiostart)를 적는다. 그래야 글이 화면이 지금 쓰는 객체로 간다. (packages/voice/src/web-speech.ts의 값과 같게 둔다)
//
// 글: 조각마다 크롬처럼 낱말씩 자라는 중간 결과(조각 시간 안에 글자 수 비율로 퍼뜨림)를 내고, 조각 끝 + latencyMs에 최종 결과를 낸다.
// 말하는 중에 결과가 KEEPALIVE_MS보다 오래 비면 같은 중간 결과를 한 번 더 낸다(크롬은 말하는 동안 결과를 계속 낸다 — 말 한가운데서 멈춤 지킴이가 끊지 않게).
// 결과 목록은 크롬처럼 한 객체 안에 쌓인다(앞 최종 결과들 + 지금 중간 결과, resultIndex = 바뀐 첫 자리).
// 글 내용은 바꾸지 않는다(앞뒤 공백만 뺀다). 중간 결과는 최종 글의 앞부분 낱말들이다.
//
// usage: node scripts/replay/from-whisper.mjs <whisper.json> <방송> <runName> [--latency 500] [--interim words|0|<ms>] [--stall-ms 2000]
//   --interim words(기본): 낱말씩 자라는 중간 결과 · 0: 중간 결과 없음 · <ms>: 최종 글 그대로를 최종 ms 앞에 한 번(예전 방식)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = process.argv.slice(2)
const raw = (name, d) => {
  const i = args.indexOf(name)
  return i < 0 ? d : args[i + 1]
}
const [jsonFile, broadcast, runName] = args
if (!jsonFile || !broadcast || !runName) {
  console.error('usage: from-whisper.mjs <whisper.json> <방송> <runName> [--latency 500] [--interim words|0|<ms>] [--stall-ms 2000]')
  process.exit(2)
}
const latencyMs = Number(raw('--latency', 500))
const interimOpt = String(raw('--interim', 'words'))
const interimWords = interimOpt === 'words'
const interimMs = interimWords ? 0 : Number(interimOpt)
// web-speech.ts와 같은 값 (STALL_MS·STALL_BACKOFF_AFTER·PLANNED_RESTART_AFTER_MS). 재생 화면 설정 voice.stallMs를 바꿨으면 --stall-ms로 맞춘다
const STALL_MS = Number(raw('--stall-ms', 2000))
const STALL_BACKOFF_AFTER = 3
const PLANNED_RESTART_AFTER_MS = 45_000
// 크롬 녹음에서 본 응답 시간: stop() 뒤 끝까지 약 150 ms, 새 객체 start 뒤 audiostart까지 약 300 ms
const STOP_END_MS = 150
const AUDIOSTART_MS = 300
const KEEPALIVE_MS = 1500
const MIN_INTERIM_GAP_MS = 80

const segs = JSON.parse(readFileSync(jsonFile, 'utf8'))
  .transcription.map((s) => ({ from: s.offsets.from, to: s.offsets.to, text: String(s.text ?? '').trim() }))
  .filter((s) => s.text !== '')

const runDir = join(ROOT, '.live-replay', broadcast, 'runs', runName)
if (existsSync(join(runDir, 'transcript.jsonl'))) throw new Error(`이미 있어요: ${runDir}`)

// 1. 말 이벤트(중간·최종) 시각 차례
const speech = []
let lastMs = 0
const push = (ms, text, final) => {
  const t = Math.max(lastMs + 1, Math.round(ms))
  lastMs = t
  speech.push({ ms: t, text, final })
}
for (const s of segs) {
  const finalAt = Math.max(lastMs + 1, s.to + latencyMs)
  const interims = []
  if (interimWords) {
    const words = s.text.split(/\s+/).filter((w) => w !== '')
    const total = words.join(' ').length
    const span = Math.max(1, s.to - s.from)
    for (let k = 1; k <= words.length; k++) {
      const text = words.slice(0, k).join(' ')
      interims.push({ ms: s.from + (span * text.length) / total, text })
    }
  } else if (interimMs > 0) interims.push({ ms: Math.max(finalAt - interimMs, (s.from + s.to) / 2), text: s.text })
  let prev = null
  for (const it of interims) {
    if (it.ms >= finalAt) break
    // 말하는 중 빈 틈: 같은 중간 결과를 다시 낸다
    if (prev !== null) for (let k = prev.ms + KEEPALIVE_MS; k < it.ms - MIN_INTERIM_GAP_MS; k += KEEPALIVE_MS) push(k, prev.text, false)
    if (prev !== null && it.ms - lastMs < MIN_INTERIM_GAP_MS && it.text !== s.text) {
      prev = { ms: lastMs, text: prev.text }
      continue
    }
    push(it.ms, it.text, false)
    prev = { ms: lastMs, text: it.text }
  }
  if (prev !== null) for (let k = prev.ms + KEEPALIVE_MS; k < finalAt - MIN_INTERIM_GAP_MS; k += KEEPALIVE_MS) push(k, prev.text, false)
  push(finalAt, s.text, true)
}

// 2. 화면 엔진의 다시 열기를 흉내 내며 줄을 적는다
const T0 = Date.parse('2026-01-01T00:00:00Z')
const lines = []
const at = (ms) => ({ seg: 0, a: Math.round(ms) / 1000, t: T0 + Math.round(ms) })
const ev = (ms, name, rec, extra = {}) => lines.push({ ...at(ms), type: 'event', ev: name, rec, ...extra })
let rec = 0
let openedAt = 0
let deadline = Infinity
let streak = 0
let results = []
let stalls = 0
let planned = 0
/** 새 객체: 만들기·start 호출은 ms, onstart는 ms+1(여기서 화면이 멈춤 지킴이를 건다), audiostart는 조금 뒤 */
const open = (ms) => {
  rec++
  openedAt = ms
  results = []
  lines.push({ ...at(ms), type: 'create', rec }, { ...at(ms), type: 'call', fn: 'start', rec, lang: 'ko-KR', continuous: true, interimResults: true })
  ev(ms + 1, 'start', rec)
  ev(ms + AUDIOSTART_MS, 'audiostart', rec)
  deadline = ms + 1 + (streak >= STALL_BACKOFF_AFTER ? STALL_MS * 2 : STALL_MS)
  return ms + 1
}
lines.push({ seg: 0, a: null, type: 'mark', what: 'voice-on-click', t: T0 - 1000 })
let ready = open(-900)
lines.push({ ...at(0), type: 'mark', what: 'play', from: 0, length: null })
// 줄은 시각 차례로 적어야 한다(replay는 줄 차례대로 낸다) — 이벤트 사이 다시 열기는 그 앞에 끼운다
const sorted = () => lines.sort((x, y) => (x.t ?? -Infinity) - (y.t ?? -Infinity))
for (const sp of speech) {
  let ms = Math.max(sp.ms, ready)
  // 멈춤 지킴이: 결과 없이 기다림이 다 되면 그 순간 abort하고 바로 새 객체 (화면 타이머가 이벤트보다 먼저 돈다 — 같은 ms도)
  while (deadline <= ms) {
    const d = deadline
    lines.push({ ...at(d), type: 'call', fn: 'abort', rec })
    const old = rec
    streak++
    stalls++
    ready = open(d)
    ev(d + 1, 'audioend', old)
    ev(d + 1, 'error', old, { error: 'aborted', message: '' })
    ev(d + 1, 'end', old)
    ms = Math.max(ms, ready + 1)
  }
  const idx = results.length
  const shown = [...results.map((r) => ({ ...r })), { f: sp.final, alts: [[sp.text, sp.final ? 0.9 : 0.01]] }]
  ev(ms, 'result', rec, { resultIndex: idx, results: shown })
  streak = 0
  deadline = ms + STALL_MS
  if (sp.final) {
    results.push({ f: true, alts: [[sp.text, 0.9]] })
    // 쉬는 틈 다시 열기: 연 지 45초 넘었고 남은 중간 결과가 없다 → stop() → 크롬이 끝을 내면 바로 새 객체
    if (ms - openedAt >= PLANNED_RESTART_AFTER_MS) {
      const old = rec
      lines.push({ ...at(ms), type: 'call', fn: 'stop', rec: old })
      ev(ms + 2, 'audioend', old)
      ev(ms + STOP_END_MS, 'end', old)
      planned++
      ready = open(ms + STOP_END_MS) + 1
    }
  }
}
ev(Math.max(lastMs, ready) + 1000, 'end', rec)
sorted()
mkdirSync(runDir, { recursive: true })
writeFileSync(join(runDir, 'transcript.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
const end = Math.max(lastMs, ready) + 1000
writeFileSync(
  join(runDir, 'meta.json'),
  JSON.stringify({ mode: 'whisper', source: jsonFile, latencyMs, interim: interimOpt, stallMs: STALL_MS, broadcast, from: 0, duration: null, segments: [{ seg: 0, from: 0, to: end / 1000, reason: 'done' }], restarts: 0, voiceReOn: 0, done: true }, null, 2),
)
console.log(JSON.stringify({ runDir, segments: segs.length, speechEvents: speech.length, recs: rec, stalls, planned, seconds: Math.round(end / 1000) }))
