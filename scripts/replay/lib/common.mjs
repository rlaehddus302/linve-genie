// 재생 시험 공용 도구: 경로·로그·정리(자식 프로세스·소리 장치 되돌리기)·연습 서버 띄우기·API.
// 이 폴더의 코드에는 개인정보를 넣지 않는다. 방송 자료와 결과는 모두 .live-replay/ 아래(깃 무시)에만 쓴다.
import { spawn, execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

export const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
export const DATA = join(ROOT, '.live-replay')
export const WORK = join(DATA, 'work')
const require = createRequire(join(ROOT, 'package.json'))
export const { chromium } = require('@playwright/test')

export const nowMs = () => Date.now()
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
/** 실행 폴더 이름 (한국 시각, 20261027-020341) */
export const stamp = () => new Date(Date.now() + 9 * 3600_000).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', '-')

export function broadcastDir(name) {
  const dir = join(DATA, name)
  if (!existsSync(dir)) throw new Error(`방송 폴더가 없어요: ${dir}`)
  return dir
}

/** 가장 최근 녹음 실행 폴더 (transcript.jsonl이 있는 것) */
export function latestRun(name) {
  const runs = join(broadcastDir(name), 'runs')
  if (!existsSync(runs)) return null
  const found = readdirSync(runs)
    .filter((d) => existsSync(join(runs, d, 'transcript.jsonl')))
    .sort()
  return found.length === 0 ? null : join(runs, found.at(-1))
}

export function makeLog(file) {
  return (...parts) => {
    const line = `${new Date().toISOString()} ${parts.join(' ')}`
    process.stdout.write(`${line}\n`)
    try {
      appendFileSync(file, `${line}\n`)
    } catch {
      // 로그 실패는 무시
    }
  }
}

export const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)

// ── 정리 ─────────────────────────────────────────────────────
const cleanups = []
let cleaning = null
/** 끝날 때(정상·오류·신호) 거꾸로 부른다 */
export function onCleanup(fn) {
  cleanups.push(fn)
  return () => {
    const i = cleanups.indexOf(fn)
    if (i >= 0) cleanups.splice(i, 1)
  }
}
export async function runCleanups() {
  if (cleaning !== null) return cleaning
  cleaning = (async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop()
      try {
        await Promise.race([fn(), sleep(15_000)])
      } catch (error) {
        process.stderr.write(`정리 중 오류: ${String(error)}\n`)
      }
    }
  })()
  const current = cleaning
  await current
  cleaning = null
}
let signalsInstalled = false
export function installSignalHandlers() {
  if (signalsInstalled) return
  signalsInstalled = true
  let count = 0
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      count++
      if (count > 2) process.exit(130)
      process.stderr.write(`\n${signal} — 정리하고 끝내요...\n`)
      void runCleanups().finally(() => process.exit(130))
    })
  }
  process.on('uncaughtException', (error) => {
    process.stderr.write(`처리 못 한 오류: ${error?.stack ?? String(error)}\n`)
    void runCleanups().finally(() => process.exit(1))
  })
}

// ── 소리 장치 ────────────────────────────────────────────────
const BLACKHOLE = 'BlackHole 2ch'
const sas = (args) => execFileSync('SwitchAudioSource', args, { encoding: 'utf8' }).trim()
export function currentAudio() {
  return { input: sas(['-c', '-t', 'input']), output: sas(['-c', '-t', 'output']) }
}
export function switchAudio(type, name = BLACKHOLE) {
  sas(['-t', type, '-s', name])
}
/** BlackHole이 아닌 첫 장치 (되돌릴 곳을 모를 때) */
function otherDevice(type) {
  const all = sas(['-a', '-t', type]).split('\n').map((x) => x.trim()).filter((x) => x !== '' && !x.startsWith('BlackHole'))
  return all.find((x) => /MacBook/.test(x)) ?? all[0] ?? BLACKHOLE
}
/** 지금 장치를 기억하고, 끝날 때 되돌리게 등록한다 */
export function guardAudio(log) {
  const before = currentAudio()
  if (before.input === BLACKHOLE || before.output === BLACKHOLE) log?.(`주의: 시작할 때 이미 ${BLACKHOLE}이 골라져 있어요 (지난 실행이 되돌리지 못했을 수 있음)`, JSON.stringify(before))
  const restore = () => {
    try {
      // 지난 실행이 되돌리지 못한 경우 BlackHole을 그대로 두지 않는다
      sas(['-t', 'input', '-s', before.input === BLACKHOLE ? otherDevice('input') : before.input])
      sas(['-t', 'output', '-s', before.output === BLACKHOLE ? otherDevice('output') : before.output])
      log?.('소리 장치 되돌림', JSON.stringify(currentAudio()))
    } catch (error) {
      log?.('소리 장치 되돌리기 실패', String(error))
    }
  }
  onCleanup(restore)
  return { before, restore }
}

// ── 자식 프로세스 ────────────────────────────────────────────
/** 프로세스 묶음 통째로 끈다 (detached로 띄운 것) */
export async function killGroup(child, waitMs = 8000) {
  if (child === null || child === undefined || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise((resolve) => child.once('exit', resolve))
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    try {
      child.kill('SIGTERM')
    } catch {
      // 이미 끝남
    }
  }
  const done = await Promise.race([exited.then(() => true), sleep(waitMs).then(() => false)])
  if (!done) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      // 이미 끝남
    }
  }
}

// ── 연습 서버 (scripts/try/try.mjs) ───────────────────────────
/**
 * 연습 서버를 띄우고 주소·비밀번호를 읽는다. 비밀번호는 메모리에만 둔다(로그에 쓰지 않는다).
 * 연습 서버는 메모리 DB라 끄면 기록이 사라진다.
 */
export async function startTry({ port = 7700, log }) {
  const child = spawn(process.execPath, [join(ROOT, 'scripts', 'try', 'try.mjs'), '--port', String(port)], { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const off = onCleanup(() => killGroup(child))
  let out = ''
  let origin = null
  let password = null
  let errText = ''
  child.stderr.on('data', (d) => {
    errText = (errText + d.toString()).slice(-4000)
  })
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => {
      out += d.toString()
      origin ??= /열기\s*:\s*(http:\/\/localhost:\d+)/.exec(out)?.[1] ?? null
      password ??= /비밀번호\s*:\s*([a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})/.exec(out)?.[1] ?? null
      if (origin !== null && password !== null) resolve()
    })
    child.once('exit', (code) => reject(new Error(`연습 서버가 켜지기 전에 끝났어요 (코드 ${code}) ${errText.replace(/비밀번호\s*:\s*\S+/g, '')}`)))
  })
  await Promise.race([ready, sleep(240_000).then(() => Promise.reject(new Error('연습 서버가 4분 안에 켜지지 않았어요')))])
  out = '' // 비밀번호가 든 출력을 버린다
  child.stdout.resume()
  log?.('연습 서버 켜짐', origin)
  return {
    origin,
    password,
    child,
    alive: () => child.exitCode === null && child.signalCode === null,
    stop: async () => {
      off()
      await killGroup(child)
    },
  }
}

// ── API (Node에서 직접, 쿠키는 손으로) ─────────────────────────
export class Api {
  constructor(origin) {
    this.origin = origin
    this.cookies = new Map()
  }
  async call(method, path, body) {
    const headers = { Origin: this.origin, Accept: 'application/json' }
    if (this.cookies.size > 0) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const res = await fetch(`${this.origin}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) })
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';')
      const at = pair.indexOf('=')
      if (at > 0) this.cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim())
    }
    const text = await res.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      json = { text: text.slice(0, 300) }
    }
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json).slice(0, 300)}`)
    return json
  }
  login(password) {
    return this.call('POST', '/api/login', { loginId: 'practice', password })
  }
}

/** 로그인 → 마법사 닫기 → 값 단위 AUTO → 방송 만들기. 방송 ID와 날짜를 돌려준다 */
export async function prepareBroadcast(server, title, log) {
  const api = new Api(server.origin)
  await api.login(server.password)
  await api.call('PUT', '/api/wizard', { status: 'DONE' }).catch((error) => log?.('마법사 닫기 실패(무시)', String(error)))
  // 방송 값 단위는 만들 때 정해진다 — AUTO를 먼저 둔다(뒤에 바꾸면 다음 방송부터라 기본 천 원 단위로 돌았다)
  await api.call('PATCH', '/api/settings', { settings: { 'price.unit': 'AUTO' } })
  const created = await api.call('POST', '/api/broadcasts', { requestId: randomUUID(), title, rehearsal: false })
  const b = created?.result?.b ?? created?.broadcast?.id ?? created?.b ?? created?.id
  if (typeof b !== 'string') throw new Error(`방송 ID를 찾지 못했어요: ${JSON.stringify(created).slice(0, 300)}`)
  const list = await api.call('GET', '/api/broadcasts')
  const date = list.broadcasts.find((x) => x.id === b)?.date
  if (typeof date !== 'string') throw new Error('방송 날짜를 찾지 못했어요')
  log?.('방송 만듦', b, date, title)
  return { api, b, date }
}

/** 상품 한 줄을 비교용 모양으로 */
export function normalizeProduct(p) {
  const pick = (...keys) => {
    for (const k of keys) if (p[k] !== undefined && p[k] !== null) return p[k]
    return null
  }
  return {
    id: pick('id', 'productId'),
    b: pick('b', 'broadcast', 'broadcastId'),
    no: pick('no', 'number'),
    name: pick('name', 'variety'),
    price: pick('price'),
    qty: pick('qty', 'stock', 'quantity'),
    status: pick('status', 'state'),
  }
}

/** 서버 결과 한 번 모으기: 그 방송의 상품과 음성 기록 */
export async function fetchResult(api, b, date) {
  const view = await api.call('GET', `/api/days/${date}`)
  const voice = await api.call('GET', `/api/voice/log?b=${encodeURIComponent(b)}`)
  const products = (view.products ?? []).filter((p) => (p.b ?? p.broadcast ?? b) === b)
  return {
    at: new Date().toISOString(),
    b,
    date,
    products: products.map(normalizeProduct),
    rawProductKeys: products[0] === undefined ? [] : Object.keys(products[0]),
    voiceLog: voice.entries ?? [],
  }
}

/** 16 kHz 모노 wav (방송 폴더 cache/에 한 번 만든다) */
export function ensureWav(name, log) {
  const dir = broadcastDir(name)
  const cache = join(dir, 'cache')
  mkdirSync(cache, { recursive: true })
  const wav = join(cache, 'audio-16k.wav')
  const m4a = join(dir, `${name}-audio.m4a`)
  if (existsSync(wav) && statSync(wav).size > 1000 && statSync(wav).mtimeMs >= statSync(m4a).mtimeMs) return wav
  log?.('소리 파일 바꾸는 중 (처음 한 번, 1~2분)', m4a)
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', m4a, `${wav}.part`], { stdio: 'ignore' })
  execFileSync('mv', [`${wav}.part`, wav])
  return wav
}
