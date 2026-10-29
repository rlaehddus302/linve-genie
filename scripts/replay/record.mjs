// record: 실제 소리를 BlackHole로 틀어 브랜드 크롬의 Web Speech가 듣게 하고, 모든 인식 이벤트를 transcript.jsonl에 남긴다.
// 화면은 진짜 라이브찜 콘솔(연습 서버) — 음성 바로 등록이 실제로 상품을 만든다. 결과(상품·음성 기록)는 result.json.
// 무인 실행용: 크롬·페이지가 죽거나 연습 서버가 죽으면 지금 소리 위치부터 다시 이어 간다. 끝·신호에 모두 끄고 소리 장치를 되돌린다.
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, ensureWav, fetchResult, guardAudio, installSignalHandlers, killGroup, makeLog, onCleanup, prepareBroadcast, runCleanups, sleep, stamp, startTry, switchAudio, WORK, broadcastDir, writeJson } from './lib/common.mjs'
import { openConsole, turnOnVoice, uiLogin, voiceIsOff, voiceStatus } from './lib/console.mjs'
import { captureSpeech } from './lib/page-scripts.mjs'
import { sliceWav, wavInfo } from './lib/wav.mjs'

const CHROME_ARGS = ['--use-fake-ui-for-media-stream', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--no-first-run', '--no-default-browser-check']
const MAX_RESTARTS = 30
/** 이만큼 소리 받기 시작·결과가 하나도 없으면 크롬을 다시 켠다 */
const DEAF_MS = 120_000

export async function record({ broadcast, from = 0, duration = null, port = 7700, snapshotSec = 60 }) {
  installSignalHandlers()
  const runDir = join(broadcastDir(broadcast), 'runs', stamp())
  mkdirSync(runDir, { recursive: true })
  const log = makeLog(join(runDir, 'run.log'))
  const transcriptFile = join(runDir, 'transcript.jsonl')
  const meta = { mode: 'record', broadcast, from, duration, startedAt: new Date().toISOString(), segments: [], restarts: 0, voiceReOn: 0, done: false }
  const metaFile = join(runDir, 'meta.json')
  log('녹음 시작', broadcast, `from=${from}`, `duration=${duration ?? '끝까지'}`, runDir)

  const wav = ensureWav(broadcast, log)
  const info = wavInfo(wav)
  const end = Math.min(info.duration, duration === null ? info.duration : from + duration)
  log(`소리 길이 ${info.duration.toFixed(1)}초, 틀 구간 ${from}~${end.toFixed(1)}초`)

  guardAudio(log)
  switchAudio('input')
  log('입력 장치 → BlackHole 2ch')

  // 상태
  let server = null
  let session = null // { api, b, date, segIndex }
  const servers = [] // 서버마다 결과 (서버가 죽으면 메모리 DB가 사라지므로 마지막 모음을 남긴다)
  let lines = 0
  let finals = 0
  let seg = -1
  let playStart = 0
  let segFrom = from
  let lastResult = null
  let lastHeardAt
  let heardInSeg = 0

  const append = (line) => {
    const t = typeof line.t === 'number' ? line.t : Date.now()
    const a = playStart === 0 ? null : Math.round((segFrom + (t - playStart) / 1000) * 1000) / 1000
    appendFileSync(transcriptFile, `${JSON.stringify({ seg, a, ...line })}\n`)
    lines++
    if (line.ev === 'result' || line.ev === 'audiostart') {
      lastHeardAt = Date.now()
      if (line.ev === 'result') heardInSeg++
    }
    if (line.ev === 'result') finals += line.results.slice(line.resultIndex).filter((r) => r.f).length
  }

  const snapshot = async () => {
    if (session === null || server === null || !server.alive()) return
    try {
      lastResult = await fetchResult(session.api, session.b, session.date)
      servers[session.serverIndex] = { b: session.b, date: session.date, from: session.from, ...lastResult }
      writeJson(join(runDir, 'result.json'), mergeServers(servers))
    } catch (error) {
      log('결과 모으기 실패', String(error).slice(0, 200))
    }
  }

  const newServer = async () => {
    if (server !== null) await server.stop()
    server = await startTry({ port, log })
    const prepared = await prepareBroadcast(server, `재생 ${broadcast} ${new Date().toISOString().slice(11, 16)}`, log)
    session = { ...prepared, serverIndex: servers.length, from: segFrom }
    servers.push({ b: prepared.b, date: prepared.date, from: segFrom, products: [], voiceLog: [] })
  }

  let context = null
  let player = null
  const closeBrowser = async () => {
    const c = context
    context = null
    if (c !== null) await Promise.race([c.close().catch(() => {}), sleep(10_000)])
  }
  onCleanup(closeBrowser)
  onCleanup(async () => {
    if (player !== null) await killGroup(player, 2000)
  })

  let offset = from
  try {
    await newServer()
    while (offset < end - 1) {
      if (meta.restarts > MAX_RESTARTS) {
        log(`다시 시작이 ${MAX_RESTARTS}번을 넘어 멈춰요`)
        break
      }
      seg++
      segFrom = offset
      playStart = 0
      const segInfo = { seg, from: offset, startedAt: new Date().toISOString(), endedAt: null, to: null, reason: null }
      meta.segments.push(segInfo)
      writeJson(metaFile, meta)
      let crashed = null
      try {
        if (!server.alive()) {
          log('연습 서버가 꺼져 있어 새로 켜요 (앞 기록은 result.json의 이전 서버 칸에 남아요)')
          await newServer()
        }
        context = await chromium.launchPersistentContext(join(WORK, 'chrome-profile'), {
          channel: 'chrome',
          headless: false,
          ignoreDefaultArgs: ['--enable-automation'],
          args: CHROME_ARGS,
          viewport: { width: 1440, height: 900 },
          permissions: ['microphone'],
        })
        context.on('close', () => {
          crashed ??= '크롬이 닫혔어요'
        })
        await context.exposeBinding('__replayRecord', (_source, line) => append(line))
        await context.addInitScript(captureSpeech)
        const page = context.pages()[0] ?? (await context.newPage())
        page.on('crash', () => {
          crashed ??= '페이지가 죽었어요'
        })
        page.on('close', () => {
          crashed ??= '페이지가 닫혔어요'
        })
        await uiLogin(page, server.origin, server.password)
        await openConsole(page, server.origin, session.b)
        append({ type: 'mark', what: 'voice-on-click', t: Date.now() })
        await turnOnVoice(page)
        log('음성 켜짐', await voiceStatus(page))

        const segWav = join(runDir, `seg-${seg}.wav`)
        const length = sliceWav(wav, info, offset, end, segWav)
        onCleanup(() => rmSync(segWav, { force: true }))
        switchAudio('output')
        playStart = Date.now()
        lastHeardAt = playStart
        heardInSeg = 0
        append({ type: 'mark', what: 'play', t: playStart, from: offset, length })
        player = spawn('afplay', [segWav], { stdio: 'ignore', detached: true })
        log(`재생 ${offset.toFixed(1)}초부터 ${length.toFixed(1)}초`)
        let lastSnap = Date.now()
        let lastBeat = 0
        let lastOffCheck = 0
        // 지켜보기
        while (true) {
          await sleep(1000)
          const pos = offset + (Date.now() - playStart) / 1000
          if (crashed !== null) throw new Error(crashed)
          if (!server.alive()) throw new Error('연습 서버가 꺼졌어요')
          if (player.exitCode !== null || player.signalCode !== null) {
            log(`재생 끝남 (afplay ${((Date.now() - playStart) / 1000).toFixed(0)}초 걸림, 결과 이벤트 ${heardInSeg})`)
            segInfo.reason = 'done'
            offset = end
            break
          }
          // 소리를 틀고 있는데 오래 아무것도 못 들으면(소리 받기 시작·결과 없음) 크롬을 다시 켠다
          if (Date.now() - lastHeardAt > DEAF_MS) throw new Error(`${DEAF_MS / 1000}초 동안 소리를 못 들었어요`)
          if (Date.now() - lastOffCheck > 5000) {
            lastOffCheck = Date.now()
            if (await voiceIsOff(page).catch(() => false)) {
              meta.voiceReOn++
              log('음성이 꺼져 있어 다시 켜요', await voiceStatus(page))
              append({ type: 'mark', what: 'voice-reon', t: Date.now() })
              await turnOnVoice(page).catch((error) => log('다시 켜기 실패', String(error).slice(0, 200)))
            }
          }
          if (Date.now() - lastBeat > 30_000) {
            lastBeat = Date.now()
            log(`살아 있음 위치=${pos.toFixed(0)}/${end.toFixed(0)}초 이벤트=${lines} 최종=${finals} 상품=${lastResult?.products.length ?? '-'} 상태=${await voiceStatus(page)}`)
            writeJson(metaFile, { ...meta, position: pos })
          }
          if (Date.now() - lastSnap > snapshotSec * 1000) {
            lastSnap = Date.now()
            await snapshot()
          }
        }
      } catch (error) {
        crashed = String(error?.message ?? error)
        meta.restarts++
        segInfo.reason = `오류: ${crashed.slice(0, 200)}`
        if (playStart !== 0) offset = Math.min(end, offset + (Date.now() - playStart) / 1000)
        log('문제가 생겨 다시 시작해요', crashed.slice(0, 300), `이어 갈 위치=${offset.toFixed(1)}초`)
      } finally {
        if (player !== null) await killGroup(player, 2000)
        player = null
        segInfo.endedAt = new Date().toISOString()
        segInfo.to = playStart === 0 ? segFrom : Math.min(end, segFrom + (Date.now() - playStart) / 1000)
        // 마지막 결과가 들어오게 잠깐 기다렸다가 모은다 (자동 등록 대기 시간)
        if (segInfo.reason === 'done') await sleep(8000)
        await snapshot()
        await closeBrowser()
        writeJson(metaFile, meta)
      }
      if (offset < end - 1) await sleep(3000)
    }
    meta.done = offset >= end - 1
  } finally {
    meta.endedAt = new Date().toISOString()
    writeJson(metaFile, meta)
    log('끝', `이벤트=${lines}`, `최종=${finals}`, `다시 시작=${meta.restarts}`, `음성 다시 켬=${meta.voiceReOn}`)
    await runCleanups()
  }
  return runDir
}

/** 서버(메모리 DB)마다 모은 결과를 하나로: 같은 번호는 뒤 서버 것이 이긴다 */
export function mergeServers(servers) {
  const byNo = new Map()
  for (const s of servers) for (const p of s.products) byNo.set(p.no, { ...p, server: servers.indexOf(s) })
  return {
    at: new Date().toISOString(),
    servers: servers.map((s) => ({ b: s.b, date: s.date, from: s.from, products: s.products.length })),
    products: [...byNo.values()].sort((x, y) => (x.no ?? 0) - (y.no ?? 0)),
    voiceLog: servers.flatMap((s) => s.voiceLog),
  }
}

export const hasTranscript = (dir) => existsSync(join(dir, 'transcript.jsonl'))
