// LV1 방송 소리로 듣기 (VOC-08, D-LV1-02~09): 방송 소리를 16kHz 모노 PCM16 100ms 조각으로 받아 기존 받아쓰기 일꾼 입구에 넣는 부품.
// 소리는 메모리에서만 다룬다 — 로그·DB·백업·이벤트에 쓰지 않는다(VOC-07 저장하지 않음). 로그에는 까닭 코드만 남긴다.
import { spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { activeLink } from '../youtube/store.ts'
import type { WebChatSource } from '../youtube/web-chat-source.ts'
import type { Db } from '../db/database.ts'

/** 조각 하나: 16,000Hz × 2바이트 × 0.1초 */
export const STREAM_CHUNK_BYTES = 3_200
export const STREAM_SAMPLE_RATE = 16_000
/** 늦음 안내 기준 (D-LV1-10 — 30초를 넘으면, 조각 도착 기준) */
export const STREAM_LATE_MS = 30_000
/** 끊김 다시 잇기 (D-LV1-05) */
export const STREAM_RETRY_WINDOW_MS = 60_000
export const STREAM_RETRY_LIMIT = 6
/** 방송을 아직 잇지 않았을 때 다시 볼 간격 */
export const STREAM_IDLE_RECHECK_MS = 3_000

/** 끊김 n번째(창 안)의 다음 시도까지: 1·2·4·8초, 가장 길게 8초 */
export function retryDelayMs(failures: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, failures - 1), 8_000)
}

/** 60초 창 안의 끊김 시각들 → 이번 끊김이 멈춤인지 (60초 안 여섯 번째) */
export function recordFailure(times: number[], now: number): { stop: boolean; count: number } {
  times.push(now)
  while (times.length > 0 && times[0]! <= now - STREAM_RETRY_WINDOW_MS) times.shift()
  return { stop: times.length >= STREAM_RETRY_LIMIT, count: times.length }
}

/** 이어 붙인 바이트를 정확히 3,200바이트 조각으로 자른다 (남는 바이트는 다음 번에) */
export class Rechunker {
  #rest: Buffer = Buffer.alloc(0)
  push(data: Buffer, emit: (chunk: Buffer) => void): void {
    let buffer = this.#rest.length === 0 ? data : Buffer.concat([this.#rest, data])
    while (buffer.length >= STREAM_CHUNK_BYTES) {
      emit(Buffer.from(buffer.subarray(0, STREAM_CHUNK_BYTES)))
      buffer = buffer.subarray(STREAM_CHUNK_BYTES)
    }
    this.#rest = Buffer.from(buffer)
  }
  clear(): void { this.#rest = Buffer.alloc(0) }
}

/** 소리 받기 어댑터가 조각을 넘기는 곳 */
export interface AudioSink {
  /** 3,200바이트 조각. producedAt = 그 소리가 방송에서 나온 시각(알면, UTC 밀리초) — 늦음 계산용 */
  chunk(pcm: Buffer, producedAt?: number): void
  /** 끊김(HLS 끝남·ffmpeg 꺼짐·네트워크) — 한 번만 부른다 */
  fail(): void
}
export interface AudioFeed {
  open(url: string, sink: AudioSink): { close(): void }
}

/** 방송 소리 주소 찾기 결과 */
export type StreamLocation =
  | { readonly kind: 'ok'; readonly url: string }
  /** 이 방송에 이은 유튜브 링크가 없음·아직 예정 — 잠시 뒤 다시 본다 */
  | { readonly kind: 'none' }
  /** 소리를 받을 수 없는 방송 (회원 전용·비공개·소리 주소 없음, D-LV1-07) */
  | { readonly kind: 'unsupported' }
  /** 유튜브 라이브가 끝났다 (수집기가 끝을 앎) */
  | { readonly kind: 'ended' }
  /** 지금은 못 봄(막힘·네트워크) — 끊김으로 센다 */
  | { readonly kind: 'retry' }
export type StreamLocator = (sellerId: string, broadcastId: string) => Promise<StreamLocation>

export interface StreamAudioOptions {
  /** 운영자 스위치·ffmpeg 유무까지 본 최종 사용 가능 여부 (D-LV1-08) */
  readonly available: boolean
  readonly locate: StreamLocator
  readonly feed: AudioFeed
  /** 판매자 설정 "방송 소리로 듣기" (기본 켬) */
  readonly sellerOn: (sellerId: string) => Promise<boolean>
  /** 다시 잇기 타이머 (시험은 가짜) */
  readonly schedule?: (run: () => void, ms: number) => () => void
}

/** `LIVEJJIM_STREAM_AUDIO`가 다듬고 소문자로 `off`일 때만 끔 */
export function readStreamAudioSwitch(env: Readonly<Record<string, string | undefined>>): boolean {
  return (env['LIVEJJIM_STREAM_AUDIO'] ?? '').trim().toLowerCase() !== 'off'
}

/** 이 서버에 ffmpeg가 있는가 (시작 때 한 번) */
export function ffmpegAvailable(command = 'ffmpeg'): boolean {
  try {
    const result = spawnSync(command, ['-hide_banner', '-version'], { stdio: 'ignore', timeout: 5_000, windowsHide: true })
    return result.status === 0
  } catch {
    return false
  }
}

const HLS_HOSTS = /(^|\.)(googlevideo\.com|youtube\.com)$/
/** 방송 페이지가 알려 준 라이브 HLS 주소만 연다 (https, 유튜브 영상 서버) */
export function safeHlsUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.length > 4_096) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && HLS_HOSTS.test(url.hostname) ? url.href : null
  } catch {
    return null
  }
}

/** 실제: 수집기와 같은 방송 페이지 응답(innertube)의 라이브 HLS 주소 (D-LV1-02). 계정·쿠키 없음 */
export function webStreamLocator(db: Db, web: WebChatSource | null): StreamLocator {
  return async (sellerId, broadcastId) => {
    const link = await activeLink(db, sellerId, broadcastId)
    if (link === null) return { kind: 'none' }
    if (web === null || web.off) return { kind: 'unsupported' }
    try {
      const page = await web.page(link.videoId)
      switch (page.state) {
        case 'LIVE':
        case 'CHAT_DISABLED': {
          const url = safeHlsUrl(page.hlsUrl)
          return url === null ? { kind: 'unsupported' } : { kind: 'ok', url }
        }
        case 'UPCOMING':
          return { kind: 'none' }
        case 'ENDED':
        case 'NOT_LIVE':
          return { kind: 'ended' }
        case 'NOT_PUBLIC':
        case 'NOT_FOUND':
          return { kind: 'unsupported' }
        default:
          return { kind: 'retry' }
      }
    } catch {
      return { kind: 'retry' }
    }
  }
}

/** 실제: ffmpeg로 HLS를 열어 16kHz 모노 s16le로 바꾼다. 표준 오류는 버린다(주소·내용을 로그에 남기지 않음) */
export class FfmpegAudioFeed implements AudioFeed {
  readonly #command: string
  constructor(command = 'ffmpeg') { this.#command = command }
  open(url: string, sink: AudioSink): { close(): void } {
    let done = false
    const chunker = new Rechunker()
    let child: ChildProcessByStdio<null, Readable, null> | null = null
    const end = () => { if (done) return; done = true; chunker.clear(); sink.fail() }
    try {
      child = spawn(this.#command, [
        '-hide_banner', '-loglevel', 'quiet', '-nostdin',
        '-protocol_whitelist', 'https,tls,tcp,crypto,hls,http',
        '-live_start_index', '-1', '-i', url,
        '-vn', '-ac', '1', '-ar', String(STREAM_SAMPLE_RATE), '-f', 's16le', 'pipe:1',
      ], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    } catch {
      queueMicrotask(end)
      return { close: () => { done = true } }
    }
    child.stdout.on('data', (data: Buffer) => { if (!done) chunker.push(data, (chunk) => sink.chunk(chunk)) })
    child.on('error', end)
    child.on('close', end)
    return {
      close: () => {
        done = true
        chunker.clear()
        child?.kill('SIGKILL')
      },
    }
  }
}

// ── 연습·시험용 가짜 방송 소리 (D-LV1-09) ─────────────────────────────────

/** 표지 소리 길이 (조각 수) — 모의 일꾼은 이 정해진 소리만 알아듣는다 */
export const MARKER_CHUNKS = 10
/** 모의 일꾼이 표지 소리에 돌려주는 글 */
export const PRACTICE_SPEECH = '15번 핑크프릴 이만 원'

/** 표지 소리 i번째 조각 (정해진 표본 — 진짜 마이크 소리와 겹치지 않는다) */
export function markerChunk(index: number): Buffer {
  const out = Buffer.alloc(STREAM_CHUNK_BYTES)
  for (let j = 0; j < STREAM_CHUNK_BYTES / 2; j++) {
    const n = index * (STREAM_CHUNK_BYTES / 2) + j
    const value = Math.round(6_000 * Math.sin((2 * Math.PI * 440 * n) / STREAM_SAMPLE_RATE)) + ((n * 7) % 13) - 6
    out.writeInt16LE(value, j * 2)
  }
  return out
}
/** 조용한 조각 */
export const SILENT_CHUNK = Buffer.alloc(STREAM_CHUNK_BYTES)

export type FakeAudioOp = 'cut' | 'restore' | 'delay' | 'unsupported' | 'supported' | 'say'

/**
 * 가짜 방송 소리: 이은 유튜브 링크가 있으면 소리 주소 `fake:live`를 주고, 100ms마다 조각을 낸다.
 * 처음 연 흐름은 2초 뒤 표지 소리를 한 번 내고, 그 뒤엔 `say`일 때만. `cut`이면 연 흐름이 끊기고 다시 열기도 실패한다.
 */
export class FakeBroadcastAudio implements AudioFeed {
  readonly #db: Db
  #cut = false
  #unsupported = false
  #delayMs = 0
  #said = false
  readonly #open = new Set<{ sink: AudioSink; timer: ReturnType<typeof setInterval>; queue: Buffer[] }>()
  readonly #now: () => number
  constructor(db: Db, now: () => number = () => Date.now()) { this.#db = db; this.#now = now }

  readonly locate: StreamLocator = async (sellerId, broadcastId) => {
    if ((await activeLink(this.#db, sellerId, broadcastId)) === null) return { kind: 'none' }
    if (this.#unsupported) return { kind: 'unsupported' }
    return this.#cut ? { kind: 'retry' } : { kind: 'ok', url: 'fake:live' }
  }

  open(_url: string, sink: AudioSink): { close(): void } {
    const flow = { sink, queue: [] as Buffer[], timer: null as unknown as ReturnType<typeof setInterval> }
    if (this.#cut) { queueMicrotask(() => sink.fail()); return { close: () => {} } }
    if (!this.#said) { this.#said = true; flow.queue.push(...Array.from({ length: 20 }, () => SILENT_CHUNK), ...this.#marker()) }
    flow.timer = setInterval(() => {
      const chunk = flow.queue.shift() ?? SILENT_CHUNK
      sink.chunk(chunk, this.#now() - this.#delayMs)
    }, 100)
    flow.timer.unref?.()
    this.#open.add(flow)
    return { close: () => { clearInterval(flow.timer); this.#open.delete(flow) } }
  }

  #marker(): Buffer[] {
    return [...Array.from({ length: MARKER_CHUNKS }, (_, i) => markerChunk(i)), ...Array.from({ length: 6 }, () => SILENT_CHUNK)]
  }

  control(op: FakeAudioOp, ms?: number): { ok: true } {
    switch (op) {
      case 'cut':
        this.#cut = true
        for (const flow of [...this.#open]) { clearInterval(flow.timer); this.#open.delete(flow); flow.sink.fail() }
        break
      case 'restore': this.#cut = false; this.#delayMs = 0; break
      case 'delay': this.#delayMs = Math.max(0, Math.min(Math.trunc(ms ?? 0), 600_000)); break
      case 'unsupported': this.#unsupported = true; break
      case 'supported': this.#unsupported = false; break
      case 'say': for (const flow of this.#open) flow.queue.push(...this.#marker()); break
    }
    return { ok: true }
  }
}
