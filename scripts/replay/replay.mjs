// replay: 녹음한 transcript.jsonl을 진짜 라이브찜 화면(연습 서버)의 음성 컨트롤러에 그대로 다시 넣는다 — 소리·크롬 음성 인식 없이, 실제 시간보다 훨씬 빨리.
// Playwright 기본 chromium + 가짜 SpeechRecognition(녹음된 이벤트를 그대로 냄) + page.clock(멈춰 두고 이벤트 사이만큼 당김)이라
// 컨트롤러의 1,000ms 안정 기다림·자동 등록 타이머가 실제 시간처럼 돈다. 같은 녹음이면 같은 결과가 나와야 한다.
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, fetchResult, installSignalHandlers, makeLog, onCleanup, prepareBroadcast, runCleanups, sleep, stamp, startTry, broadcastDir, writeJson } from './lib/common.mjs'
import { openConsole, turnOnVoice, uiLogin, voiceIsOff } from './lib/console.mjs'
import { fakeSpeech } from './lib/page-scripts.mjs'
import { compare } from './compare.mjs'

/** 녹음 줄 → 재생 차례 (가상 시각 vt: 구간마다 이어 붙이고 구간 사이 빈 시간은 1초로) */
export function planTranscript(file) {
  const raw = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '')
  const lines = []
  for (const r of raw) {
    try {
      lines.push(JSON.parse(r))
    } catch {
      // 잘린 마지막 줄
    }
  }
  const out = []
  let seg = null
  let segT0 = 0
  let segV0 = 0
  let lastV = 0
  const keys = new Map()
  for (const l of lines) {
    if (typeof l.t !== 'number') continue
    if (l.seg !== seg) {
      if (seg !== null) out.push({ kind: 'segment', vt: lastV + 500, seg: l.seg })
      seg = l.seg
      segT0 = l.t
      segV0 = seg === lines[0].seg ? 0 : lastV + 1000
    }
    const vt = Math.max(lastV, segV0 + (l.t - segT0))
    lastV = vt
    if (l.type === 'create') {
      keys.set(`${l.seg}:${l.rec}`, keys.size)
      out.push({ kind: 'create', vt, k: keys.size - 1, t: l.t })
    } else if (l.type === 'event') {
      const k = keys.get(`${l.seg}:${l.rec}`)
      if (k === undefined) continue
      out.push({ kind: 'event', vt, k, t: l.t, line: l })
    } else if (l.type === 'mark' && l.what === 'voice-reon') out.push({ kind: 'reon', vt, t: l.t })
  }
  return { steps: out, instances: keys.size, duration: lastV }
}

export async function replay({ broadcast, runDir, port = 7720, maxStepMs = 10_000, headless = true, tailMs = 30_000 }) {
  installSignalHandlers()
  const transcript = join(runDir, 'transcript.jsonl')
  if (!existsSync(transcript)) throw new Error(`녹음이 없어요: ${transcript}`)
  const outDir = join(runDir, `replay-${stamp()}`)
  mkdirSync(outDir, { recursive: true })
  const log = makeLog(join(outDir, 'run.log'))
  const plan = planTranscript(transcript)
  log('재생 시작', runDir, `단계=${plan.steps.length}`, `인식 객체=${plan.instances}`, `길이=${(plan.duration / 1000).toFixed(0)}초`)
  const started = Date.now()
  const stats = { dispatched: 0, missing: 0, waitedForInstance: 0, synthEnds: 0, reOn: 0, fastForwards: 0, clockMs: 0, settleMs: 0, dispatchMs: 0 }
  const timemap = []
  try {
    const server = await startTry({ port, log })
    const { api, b, date } = await prepareBroadcast(server, `재생(빠름) ${broadcast}`, log)
    const browser = await chromium.launch({ headless, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
    onCleanup(() => browser.close().catch(() => {}))
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] })
    await context.addInitScript(fakeSpeech)
    const page = await context.newPage()
    let pending = 0
    const counted = (r) => ['fetch', 'xhr'].includes(r.resourceType())
    page.on('request', (r) => {
      if (counted(r)) pending++
    })
    const done = (r) => {
      if (counted(r)) pending = Math.max(0, pending - 1)
    }
    page.on('requestfinished', done)
    page.on('requestfailed', done)
    page.on('pageerror', (e) => log('화면 오류', String(e).slice(0, 200)))
    // ping=false: 바로 앞이 page.evaluate(화면 왕복)였으면 한 번 더 왕복하지 않는다
    const settle = async (ping = true) => {
      const t0 = Date.now()
      if (ping) await page.evaluate(() => 0)
      const until = Date.now() + 15_000
      while (pending > 0 && Date.now() < until) await sleep(3)
      stats.settleMs += Date.now() - t0
    }

    await page.clock.install()
    await uiLogin(page, server.origin, server.password)
    await openConsole(page, server.origin, b)
    await turnOnVoice(page)
    let now = (await page.evaluate(() => Date.now())) + 1000
    await page.clock.pauseAt(now)
    const P0 = now
    const count = () => page.evaluate(() => globalThis.__replay.count())
    const advance = async (target) => {
      const delta = target - now
      if (delta <= 0) return
      const t0 = Date.now()
      if (delta <= maxStepMs) await page.clock.runFor(delta)
      else {
        await page.clock.runFor(maxStepMs)
        await settle()
        await page.clock.fastForward(delta - maxStepMs)
        stats.fastForwards++
      }
      now = target
      stats.clockMs += Date.now() - t0
      await settle()
    }

    let lastEnded = new Set()
    let lastBeat = Date.now()
    for (const step of plan.steps) {
      await advance(P0 + step.vt)
      if (step.kind === 'segment') {
        // 녹음 크롬이 다시 켜진 자리: 앞 인식 객체가 끝을 못 냈으면 끝을 내 화면이 새 객체를 열게 한다
        const n = await count()
        if (n > 0 && !lastEnded.has(n - 1)) {
          await page.evaluate((k) => globalThis.__replay.dispatch(k, { ev: 'end' }), n - 1)
          stats.synthEnds++
          await settle()
        }
        continue
      }
      if (step.kind === 'reon') {
        if (await voiceIsOff(page)) {
          await turnOnVoice(page).catch((e) => log('다시 켜기 실패', String(e).slice(0, 200)))
          stats.reOn++
        }
        continue
      }
      if (step.kind === 'create') continue
      // 화면이 아직 그 인식 객체를 안 만들었으면 조금씩 시계를 당겨 기다린다 (다시 시작 타이머)
      let tries = 0
      while ((await count()) <= step.k && tries < 100) {
        await page.clock.runFor(100)
        now += 100
        tries++
        await settle()
      }
      if (tries > 0) stats.waitedForInstance++
      timemap.push([Date.now(), step.t])
      const td = Date.now()
      const r = await page.evaluate(({ k, line }) => globalThis.__replay.dispatch(k, line), { k: step.k, line: step.line })
      stats.dispatchMs += Date.now() - td
      if (r === 'missing') stats.missing++
      else stats.dispatched++
      if (step.line.ev === 'end') lastEnded.add(step.k)
      await settle(false)
      if (Date.now() - lastBeat > 15_000) {
        lastBeat = Date.now()
        log(`진행 ${((now - P0) / 1000).toFixed(0)}/${(plan.duration / 1000).toFixed(0)}초 (가상), 낸 이벤트=${stats.dispatched}, 빠짐=${stats.missing}`)
      }
    }
    // 남은 자동 등록·안정 기다림을 끝낸다
    await advance(now + tailMs)
    await sleep(500)
    await settle()
    timemap.push([Date.now(), plan.steps.at(-1)?.t ?? 0])
    const result = await fetchResult(api, b, date)
    writeJson(join(outDir, 'result.json'), result)
    writeJson(join(outDir, 'timemap.json'), timemap)
    const elapsed = (Date.now() - started) / 1000
    writeJson(join(outDir, 'stats.json'), { ...stats, steps: plan.steps.length, virtualSec: plan.duration / 1000, wallSec: elapsed })
    log(`재생 끝 ${elapsed.toFixed(0)}초 걸림 (가상 ${(plan.duration / 1000).toFixed(0)}초)`, JSON.stringify(stats), `상품=${result.products.length}`)
  } finally {
    await runCleanups()
  }
  // 비교: 정답과, 그리고 녹음 때 결과와
  const truthFile = join(broadcastDir(broadcast), 'truth.json')
  const score = compare({ resultFile: join(outDir, 'result.json'), truthFile: existsSync(truthFile) ? truthFile : null, transcriptFile: transcript, timemapFile: join(outDir, 'timemap.json'), outDir, label: `${broadcast} 재생` })
  const recorded = join(runDir, 'result.json')
  let sameAsRecord = null
  if (existsSync(recorded)) {
    sameAsRecord = diffResults(JSON.parse(readFileSync(recorded, 'utf8')), JSON.parse(readFileSync(join(outDir, 'result.json'), 'utf8')))
    writeJson(join(outDir, 'vs-record.json'), sameAsRecord)
    log(`녹음 결과와 비교: 상품 같음 ${sameAsRecord.same}, 다름 ${sameAsRecord.differ.length}, 녹음에만 ${sameAsRecord.onlyRecord.length}, 재생에만 ${sameAsRecord.onlyReplay.length}, 음성 기록 ${sameAsRecord.voiceLog.same ? '같음' : `다름 ${sameAsRecord.voiceLog.differ.length}줄`} (${sameAsRecord.voiceLog.record}/${sameAsRecord.voiceLog.replay})`)
  }
  return { outDir, score, sameAsRecord }
}

/** 두 결과의 상품(번호·이름·값) 비교 */
export function diffResults(a, b) {
  const A = new Map(a.products.map((p) => [p.no, p]))
  const B = new Map(b.products.map((p) => [p.no, p]))
  const differ = []
  let same = 0
  for (const [no, p] of A) {
    const q = B.get(no)
    if (q === undefined) continue
    if (p.name === q.name && p.price === q.price) same++
    else differ.push({ no, record: { name: p.name, price: p.price }, replay: { name: q.name, price: q.price } })
  }
  return {
    same,
    differ,
    onlyRecord: [...A.keys()].filter((no) => !B.has(no)),
    onlyReplay: [...B.keys()].filter((no) => !A.has(no)),
    voiceLog: voiceLogDiff(a.voiceLog ?? [], b.voiceLog ?? []),
  }
}

/** 음성 기록 줄(종류·번호·옮긴 번호·뒤 값·들은 말)을 차례대로 비교 */
function voiceLogDiff(a, b) {
  const key = (e) => [e.kind, e.no, e.toNo ?? '', e.after?.name ?? '', e.after?.price ?? '', e.undone ? 'undone' : '', e.heard].join(' | ')
  const A = a.map(key)
  const B = b.map(key)
  const differ = []
  for (let i = 0; i < Math.max(A.length, B.length); i++) if (A[i] !== B[i]) differ.push({ i, record: A[i] ?? null, replay: B[i] ?? null })
  return { record: A.length, replay: B.length, same: differ.length === 0, differ: differ.slice(0, 50) }
}
