// APP1 시험 경계: 합성 마이크 → 실제 AudioWorklet PCM → 실제 서버 WS → 모의 받아쓰기 일꾼.
// 상품 읽기·카드·쓰기 API는 제품 코드를 그대로 통과한다. 기기별 PCM 표지로 흐름을 구별한다.
import { once } from 'node:events'
import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { WebSocket as NodeSocket } from 'ws'
import { e2eServerUrl } from '../../../apps/web/playwright.config.ts'

interface Worker { socket: NodeSocket; streams: Map<number, { marker: number; frames: number }>; owners: Set<Page | BrowserContext>; url: string }
let active: Worker | null = null
let serial = 100
const trackedClocks = new WeakSet<Page>()
const installedClocks = new WeakSet<Page>()
/** clock.runFor는 미설치 때 epoch 0으로 깐다. 시험이 명시 설치한 경우에만 캡처 시간을 가속한다. */
function trackClock(page: Page): void {
  if (trackedClocks.has(page)) return
  trackedClocks.add(page)
  const install = page.clock.install.bind(page.clock)
  page.clock.install = async (options) => { await install(options); installedClocks.add(page) }
}
async function openWorker(url: string): Promise<Worker> {
  const socket = new NodeSocket(url, { headers: { Authorization: 'Bearer livejjim-e2e-transcribe-worker' } })
  const worker: Worker = { socket, streams: new Map(), owners: new Set(), url }
  socket.on('error', () => {})
  socket.on('message', (raw, binary) => {
    const bytes = Buffer.from(raw as Buffer)
    if (binary) {
      if (bytes.length !== 3204) throw new Error('PCM 틀은 흐름 번호 4바이트와 소리 3,200바이트여야 한다')
      const id = bytes.readUInt32BE(0)
      worker.streams.set(id, { marker: bytes.readInt16LE(4), frames: (worker.streams.get(id)?.frames ?? 0) + 1 })
    } else {
      const message = JSON.parse(bytes.toString()) as {type:string;stream:number}
      if (message.type === 'open') worker.streams.set(message.stream, { marker: 0, frames: 0 })
      if (message.type === 'close') worker.streams.delete(message.stream)
    }
  })
  await once(socket, 'open')
  socket.send(JSON.stringify({ type: 'hello', maxStreams: 64 }))
  return worker
}

/** Web Speech가 선택된 PC에서는 쓰이지 않는다. 모바일·사파리는 이 마이크로 실제 PCM을 보낸다. */
export async function installPcmMicrophone(target: Page | BrowserContext, options: { unsupported?: boolean } = {}): Promise<void> {
  const server = e2eServerUrl(test.info().project.name)
  if (server === null) throw new Error('E2E 서버 주소가 없다')
  const url = `${server.replace('http:', 'ws:')}/api/voice/worker`
  if (active === null || active.url !== url || active.socket.readyState !== NodeSocket.OPEN) active = await openWorker(url)
  const worker = active
  if ('context' in target) trackClock(target)
  else { for (const page of target.pages()) trackClock(page); target.on('page', trackClock) }
  worker.owners.add(target)
  const release = () => { worker.owners.delete(target); if (worker.owners.size === 0) { worker.socket.terminate(); if (active === worker) active = null } }
  if ('context' in target) target.once('close', release)
  else target.once('close', release)
  await target.addInitScript(({ marker, unsupported, synthetic }) => {
    const state = { marker, starts: 0, stops: 0, sockets: [] as WebSocket[], captureAt: 0, readyAt: 0, lastContextAt: 0, sessionOn: false, snapshotNow: 0, heard: [] as string[], lastContext: { dialogOpen: false, smsAutoAllowed: true }, binarySent: 0, pulses: 0, microphoneError: null as string | null, sources: [] as AudioContext[], stage: 'idle', pulse: () => {} }
    ;(window as unknown as { __pcm: typeof state }).__pcm = state
    // WebKit은 mediaDevices wrapper를 다시 얻을 때 own override가 빠질 수 있어 시험 경계 객체를 보존한다.
    const mediaDevices = navigator.mediaDevices
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, get: () => mediaDevices })
    const NativeSocket = window.WebSocket
    class ObservedSocket extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols)
        if (String(url).includes('/api/voice/stream')) {
          state.sockets.push(this)
          state.sessionOn = false
          this.addEventListener('message', (event) => {
            if (typeof event.data !== 'string') return
            try { const value = JSON.parse(event.data); if (value.type === 'ready') state.readyAt = Date.now(); if (value.type === 'voice.state') { state.snapshotNow = value.snapshot.now; state.heard = value.snapshot.heard.map((line: {text:string}) => line.text); state.sessionOn = value.snapshot.phase === 'on' } } catch { /* 받아쓴 글이나 오류 원문을 로그에 남기지 않는다. */ }
          })
        }
      }
      override send(data: Parameters<WebSocket['send']>[0]): void {
        if (this.url.includes('/api/voice/stream') && typeof data === 'string') {
          try {
            const value = JSON.parse(data)
            if (value.type === 'voice.session' && value.op === 'capture') state.captureAt = value.at
            if (value.type === 'voice.session' && ['hello', 'context'].includes(value.op)) { state.lastContextAt = value.context.now; state.lastContext = { dialogOpen: value.context.dialogOpen, smsAutoAllowed: value.context.smsAutoAllowed } }
          } catch { /* 받아쓴 글이나 오류 원문을 로그에 남기지 않는다. */ }
        }
        if (this.url.includes('/api/voice/stream') && typeof data !== 'string') state.binarySent++
        super.send(data)
      }
    }
    window.WebSocket = ObservedSocket
    // WebKit 자동화는 소리 장치의 허용/재생 정책이 실제 iPhone과 다르다. 캡처 경계에서 PCM만 합성한다.
    // Chrome 묶음은 위 경계를 바꾸지 않아 실제 AudioWorklet 변환도 별도로 검증한다.
    if (synthetic) {
      class AudioNode {
        gain = { value: 0 }
        connect<T>(next: T): T { return next }
        disconnect(): void {}
      }
      class Worklet extends AudioNode {
        port = { onmessage: null as ((event: MessageEvent<ArrayBuffer>) => void) | null }
        constructor() {
          super()
          state.pulse = () => {
            state.pulses++
            const bytes = new ArrayBuffer(3200), samples = new DataView(bytes)
            for (let i = 0; i < 1600; i++) samples.setInt16(i * 2, marker, true)
            this.port.onmessage?.({ data: bytes } as MessageEvent<ArrayBuffer>)
          }
        }
      }
      class Audio {
        destination = new AudioNode()
        audioWorklet = { addModule: async () => {} }
        createMediaStreamSource() { return new AudioNode() }
        createGain() { return new AudioNode() }
        async resume() { state.pulse() }
        async close() {}
      }
      Object.defineProperty(window, 'AudioContext', { configurable: true, value: Audio })
      Object.defineProperty(window, 'AudioWorkletNode', { configurable: true, value: Worklet })
    }
    if (unsupported) {
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, get: () => undefined, set: () => {} })
      document.addEventListener('DOMContentLoaded', () => Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, get: () => undefined, set: () => {} }), { once: true })
      return
    }
    const getMicrophone = async () => {
      state.starts++
      if (state.microphoneError !== null) throw new DOMException('시험 마이크 오류', state.microphoneError)
      if (synthetic) { state.stage = 'ready'; return { getTracks: () => [{ stop: () => { state.stops++ } }] } as unknown as MediaStream }
      state.stage = 'context'
      const context = new AudioContext()
      state.stage = 'source'
      const source = context.createConstantSource()
      source.offset.value = marker / 32767
      state.stage = 'destination'
      const output = context.createMediaStreamDestination()
      source.connect(output)
      source.start()
      state.stage = 'resume'
      await context.resume()
      state.stage = 'ready'
      state.sources.push(context)
      for (const track of output.stream.getTracks()) {
        const stop = track.stop.bind(track)
        track.stop = () => { state.stops++; stop(); source.stop(); void context.close() }
      }
      return output.stream
    }
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, get: () => getMicrophone, set: () => {} })
    // 여러 addInitScript의 실행 순서는 약속되지 않는다. 옛 Web Speech 계수 wrapper 뒤에도 같은 마이크 경계를 쓴다.
    document.addEventListener('DOMContentLoaded', () => { Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, get: () => getMicrophone, set: () => {} }) }, { once: true })
  }, { marker: serial++, unsupported: options.unsupported === true, synthetic: test.info().project.name.includes('webkit') })
}

/** 가속한 기기 시각만 실제 읽기 세션에 맞춘다. 읽기/카드/등록 상태는 주입하지 않는다. */
export async function syncReadingClock(page: Page): Promise<void> {
  const sent = await page.evaluate(() => {
    const state = (window as unknown as {__pcm?:{sockets:WebSocket[];sessionOn:boolean;lastContext:{dialogOpen:boolean;smsAutoAllowed:boolean}}}).__pcm
    const socket = state?.sockets.at(-1)
    if (state === undefined || !state.sessionOn || socket?.readyState !== WebSocket.OPEN) return null
    const now = Date.now()
    socket.send(JSON.stringify({ type: 'voice.session', op: 'context', context: { ...state.lastContext, now } }))
    return now
  })
  if (sent !== null) await expect.poll(() => page.evaluate(() => (window as unknown as {__pcm:{snapshotNow:number}}).__pcm.snapshotNow)).toBeGreaterThanOrEqual(sent)
}

/** 서버가 이미 받은 최종 글을 돌려준 뒤 다음 조작을 한다(원래 동기식 fake Speech의 경계). */
export async function waitReadingHeard(page: Page, text: string): Promise<void> {
  await expect.poll(() => page.evaluate((value) => (window as unknown as {__pcm:{heard:string[]}}).__pcm.heard.includes(value), text)).toBe(true)
}

export async function pcmState(page: Page) {
  return page.evaluate(() => {
    const state = (window as unknown as {__pcm?: {marker:number;starts:number;stops:number;sockets:WebSocket[];captureAt:number;readyAt:number;lastContextAt:number;sessionOn:boolean;binarySent:number;pulses:number;stage:string}}).__pcm
    return state === undefined ? null : { microphone: String(navigator.mediaDevices.getUserMedia).slice(0, 80), audio: window.AudioContext.name, stage: state.stage, binarySent: state.binarySent, pulses: state.pulses, marker: state.marker, starts: state.starts, stops: state.stops, sockets: state.sockets.length, openSockets: state.sockets.filter((socket) => socket.readyState !== WebSocket.CLOSED).length, captureAt: state.captureAt, readyAt: state.readyAt, now: Date.now(), lastContextAt: state.lastContextAt, sessionOn: state.sessionOn, chrome: state.sockets.at(-1)?.url.includes('mode=chrome') ?? true }
  })
}
export async function usesPcm(page: Page): Promise<boolean> { const state = await pcmState(page); return state !== null && state.sockets > 0 && !state.chrome }
export async function pcmCounts(page: Page) { const state = await pcmState(page); return { starts: state?.starts ?? 0, stops: state?.stops ?? 0, sockets: state?.sockets ?? 0, openSockets: state?.openSockets ?? 0, streams: active?.streams.size ?? 0 } }
export async function sayPcm(page: Page, text: string, options: { late?: boolean } = {}): Promise<void> {
  await expect.poll(async () => (await pcmState(page))?.sessionOn).toBe(true)
  // 제품은 ready 전에 잡힌 100ms PCM을 버린다. 시험 캡처도 실제 한 틀 분량의 시간이 지난 뒤 보낸다.
  const ready = (await pcmState(page))!
  if (ready.now < ready.readyAt + 101 && installedClocks.has(page)) await page.clock.runFor(ready.readyAt + 101 - ready.now)
  else await expect.poll(async () => (await pcmState(page))!.now).toBeGreaterThanOrEqual(ready.readyAt + 101)
  await page.evaluate(() => { (window as unknown as {__pcm:{pulse():void}}).__pcm.pulse() })
  try {
    await expect.poll(async () => { const state = await pcmState(page); return [...(active?.streams.values() ?? [])].some((value) => value.marker === state?.marker && value.frames > 0) }).toBe(true)
  } catch (cause) { throw new Error(`PCM 경계: ${JSON.stringify({ device: await pcmState(page), streams: [...(active?.streams.values() ?? [])] })}`, { cause }) }
  if (options.late) await page.clock.runFor(12_000)
  await syncReadingClock(page)
  const state = (await pcmState(page))!
  const entry = [...active!.streams].find(([, value]) => value.marker === state.marker)!
  const endMs = Math.max(0, Math.floor(state.now - state.captureAt - (options.late ? 11_000 : 0)))
  active!.socket.send(JSON.stringify({ type: 'result', stream: entry[0], text, startMs: Math.max(0, endMs - 100), endMs, procMs: 15 }))
}
export async function closePcmConnection(page: Page): Promise<void> {
  await page.evaluate(() => { (window as unknown as {__pcm:{sockets:WebSocket[]}}).__pcm.sockets.at(-1)?.close() })
}
export async function microphoneError(page: Page, name: 'NotAllowedError' | 'NotFoundError' | null): Promise<void> {
  await page.evaluate((value) => { (window as unknown as {__pcm:{microphoneError:string|null}}).__pcm.microphoneError = value }, name)
}

/** 서버 이력 어댑터의 관측/실패 주입. 운영 서버에는 이 경로가 없다. */
export async function historyProbe(page: Page, options?: { fail?: boolean; delayMs?: number; hold?: boolean; reset?: boolean; loginId?: string }): Promise<{ fail: boolean; delayMs: number; hold: boolean; held: number; calls: (string | null)[]; pending: number; completed: number }> {
  const server = e2eServerUrl(test.info().project.name)
  const response = options === undefined
    ? await page.request.get(`${server}/_e2e/voice/history?loginId=e2e-shop`)
    : await page.request.post(`${server}/_e2e/voice/history`, { data: { loginId: 'e2e-shop', ...options } })
  expect(response.status(), await response.text()).toBe(200)
  return await response.json() as { fail: boolean; delayMs: number; hold: boolean; held: number; calls: (string | null)[]; pending: number; completed: number }
}

/** 실제 기기 소켓을 끊고 APP1의 1·2·4·8·8초 재시도 간격으로 다시 붙인다. */
export async function reconnectPcm(page: Page, retry = 0): Promise<void> {
  const before = (await pcmCounts(page)).sockets
  await closePcmConnection(page)
  await expect(page.getByRole('region', { name: '음성 등록' }).getByRole('status').first()).toHaveText('다시 잇는 중')
  await page.clock.runFor([1000, 2000, 4000, 8000, 8000][Math.min(retry, 4)]!)
  await expect.poll(async () => (await pcmCounts(page)).sockets).toBe(before + 1)
  await expect(page.getByRole('region', { name: '음성 등록' }).getByRole('status').first()).toHaveText('음성: 듣는 중')
}
export const LG_FAILED = '듣기 멈춤 · 받아쓰기 서버에 연결하지 못했어요. 상품은 빠른 입력으로 넣어 주세요.'
export async function haltPcm(page: Page): Promise<void> {
  for (let i = 0; i < 5; i++) await reconnectPcm(page, i)
  await closePcmConnection(page)
  await expect(page.getByRole('region', { name: '음성 등록' })).toContainText(LG_FAILED)
  await expect(page.getByRole('button', { name: '다시 켜기', exact: true }).first()).toBeVisible()
}
