// LV1 방송 소리로 듣기 (VOC-08, D-LV1-02~09): 방송 소리를 16kHz 모노 PCM16 100ms 조각으로 받아 기존 받아쓰기 일꾼 입구에 넣는 부품.
// 소리는 메모리에서만 다룬다 — 로그·DB·백업·이벤트에 쓰지 않는다(VOC-07 저장하지 않음). 로그에는 까닭 코드만 남긴다.
import { execFile, spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { activeLink } from '../youtube/store.ts'
import { latestTiktokLink } from '../tiktok-live/store.ts'
import { parseTikTokTarget } from '../tiktok/index.ts'
import type { WebChatSource } from '../youtube/web-chat-source.ts'
import type { Db } from '../db/database.ts'
import type { LogSink } from '../log.ts'

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
/** 서버가 소리를 받아 오는 길이 끊겼을 때 다시 보는 간격 (D-LV1-17) — 길이 돌아오면 판매자가 아무것도 안 해도 다시 듣는다 */
export const STREAM_UNREACHABLE_RECHECK_MS = 60_000
/** 이만큼 조각이 안 오면 HLS가 멈춘 것으로 보고 끊김으로 센다 (RA-LV1-01) */
export const STREAM_STALL_MS = 8_000
/** 멈춤 확인 간격 */
export const STREAM_STALL_CHECK_MS = 2_500

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
  /**
   * source = 소리 주인 (D-LV1-15): 같은 영상(유튜브 영상 id·틱톡 계정)이면 같은 값 — 여러 판매자 계정이 한 방송을 이으면 소리 받기·받아쓰기를 한 번만 한다.
   * 주소(url)는 부를 때마다 달라서(서명) 열쇠로 쓰지 않는다. 없으면 나누지 않는다(판매자마다 흐름 하나, 옛 동작)
   */
  | { readonly kind: 'ok'; readonly url: string; readonly source?: string }
  /** 이 방송에 이은 유튜브 링크가 없음·아직 예정 — 잠시 뒤 다시 본다 */
  | { readonly kind: 'none' }
  /** 소리를 받을 수 없는 방송 (회원 전용·비공개·소리 주소 없음, D-LV1-07) */
  | { readonly kind: 'unsupported' }
  /** 방송은 멀쩡한데 서버가 소리를 받아 오는 길(집 회선 프록시, D-LV1-13)이 끊겼다 — 방송 탓이 아니라고 알리고 천천히 다시 본다 (D-LV1-17) */
  | { readonly kind: 'unreachable' }
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

// ── 소리 주소를 yt-dlp로 얻기 (D-LV1-11) ─────────────────────────────────
// 유튜브 웹 방송 페이지가 이제 hlsManifestUrl 대신 SABR·PO 토큰이 필요한 주소만 준다. 그래서 페이지에 HLS가 없으면
// yt-dlp(로그인·쿠키·PO 토큰 없음. 프록시는 D-LV1-13 집 회선만)로 라이브 HLS 주소를 묻는다. 주소는 몇 시간 뒤 만료되므로 끊길 때마다 다시 묻는다(캐시 없음).

/** yt-dlp 한 번 기다리는 최대 시간 */
export const YTDLP_TIMEOUT_MS = 60_000
/** yt-dlp 출력 최대 바이트 (주소 한두 줄) */
const YTDLP_MAX_BUFFER = 256 * 1024
/** 봇 확인 막힘을 알아보는 stderr 표지 (분류에만 쓰고 원문은 버린다) */
const YTDLP_BLOCKED = /not a bot|sign in to confirm/i
/**
 * 집 회선 프록시가 끊김을 알아보는 stderr 표지 (D-LV1-13 — 분류에만 쓰고 원문은 버린다). 프록시를 쓸 때만 본다.
 * 터널 끝이 없음 → "Unable to connect to proxy"(ProxyError), 터널은 있는데 집 tinyproxy가 꺼짐 → 받자마자 끊김("Connection aborted"·reset),
 * tinyproxy 필터 거절 → "Tunnel connection failed: 403". 프록시를 쓸 때는 모든 연결이 그 길로 가므로 끊김은 출구 쪽 문제로 본다(실측 2026-11-01).
 */
const YTDLP_PROXY_DOWN = /unable to connect to proxy|proxyerror|tunnel connection failed|connection aborted|connection reset by peer|remote end closed connection/i
/** 유튜브 영상 ID (11자) — 이것만 yt-dlp에 넘긴다 */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

/** 소리 주소 얻기 결과. 실패는 종류만 (주소·영상 정보·stderr 원문은 담지 않는다) */
export type AudioUrlResult =
  | { readonly kind: 'ok'; readonly url: string }
  /** yt-dlp가 없음 */
  | { readonly kind: 'missing' }
  /** 시간 넘김 (네트워크일 수 있음 — 다시 본다) */
  | { readonly kind: 'timeout' }
  /** 유튜브가 봇 확인("Sign in to confirm you're not a bot")으로 막음 — 데이터센터 IP에서 흔하다 */
  | { readonly kind: 'blocked' }
  /** 집 회선 프록시(D-LV1-13)에 닿지 못함 — 터널·tinyproxy·집 장비가 꺼짐. 운영자가 할 일이 있다 */
  | { readonly kind: 'proxy_down' }
  /** yt-dlp가 그 밖의 실패로 끝남 (소리 없는 방송 등) */
  | { readonly kind: 'failed' }
  /** 출력이 유튜브 영상 서버의 https 주소가 아님 */
  | { readonly kind: 'bad_output' }
  /** 틱톡: 그 계정이 지금 라이브 중이 아님 (아직 시작 전·끝남 — 잠시 뒤 다시 본다, D-UX3-16) */
  | { readonly kind: 'not_live' }
/** 검증된 영상 ID로 소리 주소를 얻는 함수 (시험은 가짜) */
export type AudioUrlResolver = (videoId: string) => Promise<AudioUrlResult>

/** execFile 모양 (시험은 가짜) */
export type ExecFileRunner = (
  file: string,
  args: readonly string[],
  options: { timeout: number; killSignal: 'SIGKILL'; maxBuffer: number; windowsHide: boolean; shell: false },
  callback: (error: (Error & { code?: unknown; killed?: boolean }) | null, stdout: string, stderr: string) => void,
) => void

const defaultRunner: ExecFileRunner = (file, args, options, callback) => {
  execFile(file, [...args], { ...options, encoding: 'utf8' }, (error, stdout, stderr) => callback(error, String(stdout), String(stderr)))
}

/** `LIVEJJIM_YTDLP_PATH` (다듬어서 비면 `yt-dlp`) */
export function readYtDlpPath(env: Readonly<Record<string, string | undefined>>): string {
  const value = (env['LIVEJJIM_YTDLP_PATH'] ?? '').trim()
  return value === '' ? 'yt-dlp' : value
}

// ── 집 회선 프록시 (D-LV1-13) ────────────────────────────────────────────
// 데이터센터 IP는 봇 확인으로 막히므로, 팀 장비(맥 미니)의 집 회선을 SSH 역방향 터널로 끌어와 yt-dlp·ffmpeg만 그쪽으로 내보낸다.
// 프록시는 이 기계(또는 컨테이너의 호스트) 안의 터널 끝만 허용한다 — 다른 곳이면 판매자·방송 정보가 바깥 프록시로 새지 않게 쓰지 않는다.

/** 허용하는 프록시 호스트: 이 기계(127.0.0.1·localhost)와, 컨테이너에서 본 호스트(compose extra_hosts의 host.docker.internal) */
const PROXY_HOSTS = new Set(['127.0.0.1', 'localhost', 'host.docker.internal'])

/** `LIVEJJIM_YT_MEDIA_PROXY` 읽기 결과. 값이 있는데 허용하지 않는 모양이면 쓰지 않고(rejected) 시작 기록 한 줄 */
export type MediaProxySetting =
  | { readonly kind: 'none' }
  | { readonly kind: 'ok'; readonly url: string }
  | { readonly kind: 'rejected' }

/** `LIVEJJIM_YT_MEDIA_PROXY` (예 `http://127.0.0.1:18888`, 비우면 없음). `http://<허용 호스트>:<포트>`만 — 계정·경로·질의 없음 */
export function readMediaProxy(env: Readonly<Record<string, string | undefined>>): MediaProxySetting {
  const value = (env['LIVEJJIM_YT_MEDIA_PROXY'] ?? '').trim()
  if (value === '') return { kind: 'none' }
  if (value.length > 200) return { kind: 'rejected' }
  try {
    const url = new URL(value)
    const plain = url.username === '' && url.password === '' && (url.pathname === '/' || url.pathname === '') && url.search === '' && url.hash === ''
    const port = Number(url.port)
    if (url.protocol !== 'http:' || !PROXY_HOSTS.has(url.hostname) || !plain || !Number.isInteger(port) || port < 1 || port > 65_535) return { kind: 'rejected' }
    return { kind: 'ok', url: `http://${url.hostname}:${port}` }
  } catch {
    return { kind: 'rejected' }
  }
}

/** 실제: `yt-dlp -g -f bestaudio/best <방송 주소>` 출력 첫 줄. 셸 없이 인자 배열, 60초 제한, 설정 파일 무시. proxy가 있으면 `--proxy` */
export function ytDlpResolver(command = 'yt-dlp', run: ExecFileRunner = defaultRunner, proxy: string | null = null): AudioUrlResolver {
  return (videoId) => {
    if (!VIDEO_ID.test(videoId)) return Promise.resolve({ kind: 'failed' })
    return askYtDlp(command, run, proxy, ['-f', 'bestaudio/best', '--', `https://www.youtube.com/watch?v=${videoId}`], safeHlsUrl)
  }
}

function askYtDlp(command: string, run: ExecFileRunner, proxy: string | null, target: readonly string[], accept: (url: string) => string | null): Promise<AudioUrlResult> {
  return new Promise((resolve) => {
    const args = ['--ignore-config', '--no-playlist', '--no-warnings', ...(proxy === null ? [] : ['--proxy', proxy]), '-g', ...target]
    try {
      run(command, args, { timeout: YTDLP_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: YTDLP_MAX_BUFFER, windowsHide: true, shell: false }, (error, stdout, stderr) => {
        if (error !== null) {
          if (error.code === 'ENOENT' || error.code === 'EACCES') resolve({ kind: 'missing' })
          else if (error.killed === true) resolve({ kind: 'timeout' })
          else if (proxy !== null && YTDLP_PROXY_DOWN.test(stderr)) resolve({ kind: 'proxy_down' })
          else if (YTDLP_BLOCKED.test(stderr)) resolve({ kind: 'blocked' })
          else if (YTDLP_NOT_LIVE.test(stderr)) resolve({ kind: 'not_live' })
          else resolve({ kind: 'failed' })
          return
        }
        const first = stdout.split(/\r?\n/, 1)[0]?.trim() ?? ''
        const url = accept(first)
        resolve(url === null ? { kind: 'bad_output' } : { kind: 'ok', url })
      })
    } catch {
      resolve({ kind: 'missing' })
    }
  })
}

// ── 틱톡 라이브 소리 (D-UX3-16) ──────────────────────────────────────────
// 회차에 이은 틱톡 계정(tiktok_links LINKED — 동의·운영자 스위치를 거친 것)의 라이브 소리를 yt-dlp로 묻는다. 로그인·쿠키 없음.
// 집 회선 프록시는 쓰지 않는다 — 프록시 허용 목록은 유튜브뿐이고(deploy/home-proxy/filter), 틱톡은 서버에서 바로 열린다.

/** yt-dlp가 '지금 라이브 아님'을 알리는 stderr 표지 (분류에만 쓴다) */
const YTDLP_NOT_LIVE = /not currently live/i
const TIKTOK_MEDIA_HOSTS = /(^|\.)(tiktokcdn\.com|tiktokcdn-us\.com|tiktokcdn-eu\.com|ttlivecdn\.com)$/
/** 틱톡 라이브 영상 서버의 https 주소만 연다 */
export function safeTiktokMediaUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.length > 4_096) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && TIKTOK_MEDIA_HOSTS.test(url.hostname) ? url.href : null
  } catch {
    return null
  }
}
/** 검증된 틱톡 아이디로 라이브 소리 주소를 얻는 함수 (시험은 가짜) */
export type TiktokAudioUrlResolver = (uniqueId: string) => Promise<AudioUrlResult>

/** 실제: `yt-dlp -g https://www.tiktok.com/@<아이디>/live`. HLS(m3u8)를 먼저 고른다 — ffmpeg가 끝에서부터 읽는다 */
export function ytDlpTiktokResolver(command = 'yt-dlp', run: ExecFileRunner = defaultRunner): TiktokAudioUrlResolver {
  return (uniqueId) => {
    const parsed = parseTikTokTarget(uniqueId)
    if (!('uniqueId' in parsed) || parsed.uniqueId !== uniqueId) return Promise.resolve({ kind: 'failed' })
    return askYtDlp(command, run, null, ['-f', 'bestaudio[protocol^=m3u8]/best[protocol^=m3u8]/bestaudio/best', '--', `https://www.tiktok.com/@${uniqueId}/live`], safeTiktokMediaUrl)
  }
}

/** 틱톡 라이브 시작 전에는 3초마다 yt-dlp를 띄우지 않게: '라이브 아님'을 받은 아이디는 waitMs 동안 다시 묻지 않고 '라이브 아님' */
export function notLiveBackoff(resolve: TiktokAudioUrlResolver, now: () => number, waitMs = TIKTOK_NOT_LIVE_WAIT_MS): TiktokAudioUrlResolver {
  const until = new Map<string, number>()
  return async (uniqueId) => {
    const t = now()
    for (const [id, end] of until) if (end <= t) until.delete(id)
    if ((until.get(uniqueId) ?? 0) > t) return { kind: 'not_live' }
    const found = await resolve(uniqueId)
    if (found.kind === 'not_live') until.set(uniqueId, now() + waitMs)
    return found
  }
}
/** 틱톡 '라이브 아님' 뒤 다시 묻기까지 */
export const TIKTOK_NOT_LIVE_WAIT_MS = 15_000

/** 방송 페이지 하나로 소리 주소 찾기: 페이지의 HLS가 있으면 그것, 없으면 yt-dlp (D-LV1-11) */
export async function locateFromPage(
  web: Pick<WebChatSource, 'page'>,
  videoId: string,
  options: { readonly resolve?: AudioUrlResolver | null; readonly log?: LogSink; readonly sellerId?: string } = {},
): Promise<StreamLocation> {
  const page = await web.page(videoId)
  switch (page.state) {
    case 'LIVE':
    case 'CHAT_DISABLED': {
      const url = safeHlsUrl(page.hlsUrl)
      if (url !== null) return { kind: 'ok', url }
      return byYtDlp(videoId, options)
    }
    // 데이터센터 IP라 방송 페이지가 봇 확인으로 막힘(D-LIVETEST-12): 페이지를 다시 볼수록 같은 막힘이다 — yt-dlp(집 회선 프록시, D-LV1-13)로 바로 묻는다.
    // yt-dlp가 없으면 지금처럼 잠시 뒤 다시 본다
    case 'BLOCKED':
      return options.resolve == null ? { kind: 'retry' } : byYtDlp(videoId, options)
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
}

async function byYtDlp(
  videoId: string,
  options: { readonly resolve?: AudioUrlResolver | null; readonly log?: LogSink; readonly sellerId?: string },
): Promise<StreamLocation> {
  if (options.resolve == null || !VIDEO_ID.test(videoId)) return { kind: 'unsupported' }
  const found = await options.resolve(videoId)
  if (found.kind === 'ok') return found
  const seller = options.sellerId === undefined ? {} : { seller: options.sellerId }
  // 집 회선 프록시가 끊김(D-LV1-13): 운영자 경보 한 줄. 방송 탓이 아니므로 "받을 수 없는 방송"이 아니라 "서버 쪽 길이 끊김"으로 돌려준다 (D-LV1-17)
  if (found.kind === 'proxy_down') {
    options.log?.({ level: 'alert', code: 'STREAM_AUDIO_PROXY_DOWN', ...seller })
    return { kind: 'unreachable' }
  }
  options.log?.({ level: 'warn', code: 'STREAM_AUDIO_YTDLP_FAILED', reason: found.kind.toUpperCase(), ...seller })
  // 시간 넘김만 끊김으로 세어 다시 본다. 없음·봇 확인 막힘·실패는 지금처럼 바로 꺼짐 + 휴대폰 마이크 안내
  return found.kind === 'timeout' ? { kind: 'retry' } : { kind: 'unsupported' }
}

/**
 * 실제: 수집기와 같은 방송 페이지 응답(innertube)의 라이브 HLS 주소 (D-LV1-02), 없으면 yt-dlp (D-LV1-11). 계정·쿠키 없음.
 * 끊기면 서비스가 다시 부르므로 만료된 주소 대신 새 주소를 얻는다.
 */
export function webStreamLocator(
  db: Db,
  web: WebChatSource | null,
  options: { readonly resolve?: AudioUrlResolver | null; readonly tiktok?: TiktokAudioUrlResolver | null; readonly log?: LogSink } = {},
): StreamLocator {
  return async (sellerId, broadcastId) => {
    const link = await activeLink(db, sellerId, broadcastId)
    // 유튜브를 먼저 — 같은 방송을 함께 내보내면 소리를 두 번 듣지 않는다 (D-UX3-16)
    if (link === null) return locateTiktok(db, sellerId, broadcastId, options)
    if (web === null || web.off) return { kind: 'unsupported' }
    try {
      const found = await locateFromPage(web, link.videoId, { ...options, sellerId })
      return found.kind === 'ok' ? { ...found, source: `youtube:${link.videoId}` } : found
    } catch {
      return { kind: 'retry' }
    }
  }
}

async function locateTiktok(
  db: Db,
  sellerId: string,
  broadcastId: string,
  options: { readonly tiktok?: TiktokAudioUrlResolver | null; readonly log?: LogSink },
): Promise<StreamLocation> {
  const link = await latestTiktokLink(db, sellerId, broadcastId)
  if (link === null || link.state !== 'LINKED') return { kind: 'none' }
  if (options.tiktok == null) return { kind: 'unsupported' }
  let found: AudioUrlResult
  try {
    found = await options.tiktok(link.tiktokId)
  } catch {
    return { kind: 'retry' }
  }
  if (found.kind === 'ok') return { ...found, source: `tiktok:${link.tiktokId}` }
  if (found.kind === 'not_live') return { kind: 'none' }
  options.log?.({ level: 'warn', code: 'STREAM_AUDIO_YTDLP_FAILED', reason: `TIKTOK_${found.kind.toUpperCase()}`, seller: sellerId })
  return found.kind === 'timeout' ? { kind: 'retry' } : { kind: 'unsupported' }
}

/**
 * ffmpeg 인자. proxy가 있으면(D-LV1-13) `-http_proxy`로 목록·조각 모두 같은 출구로 받는다 — HLS 주소에 요청 IP가 박혀 있어
 * 다른 IP로 조각을 받으면 403이다. https는 tls가 그 프록시에 CONNECT로 터널을 여므로 허용 목록에 `httpproxy`만 더한다(평문 http는 그대로 뺌).
 * 환경변수(http_proxy)가 아니라 옵션으로 준다 — no_proxy 같은 바깥 값에 흔들리지 않고, 프록시가 죽으면 바로 나가지 않고 실패한다(실측 2026-11-01).
 */
export function ffmpegArgs(url: string, proxy: string | null = null): string[] {
  return [
    '-hide_banner', '-loglevel', 'quiet', '-nostdin',
    ...(proxy === null ? [] : ['-http_proxy', proxy]),
    '-protocol_whitelist', proxy === null ? 'https,tls,tcp,crypto,hls' : 'https,tls,tcp,crypto,hls,httpproxy',
    // HLS 전용 옵션 — 틱톡 flv에 주면 ffmpeg가 열지 못한다 (실측 2026-11-03)
    ...(isHlsUrl(url) ? ['-live_start_index', '-1'] : []),
    '-i', url,
    '-vn', '-ac', '1', '-ar', String(STREAM_SAMPLE_RATE), '-f', 's16le', 'pipe:1',
  ]
}

function isHlsUrl(value: string): boolean {
  try {
    return new URL(value).pathname.endsWith('.m3u8') || safeHlsUrl(value) !== null
  } catch {
    return false
  }
}

/** 실제: ffmpeg로 HLS를 열어 16kHz 모노 s16le로 바꾼다. 표준 오류는 버린다(주소·내용을 로그에 남기지 않음) */
export class FfmpegAudioFeed implements AudioFeed {
  readonly #command: string
  readonly #proxy: string | null
  constructor(command = 'ffmpeg', proxy: string | null = null) { this.#command = command; this.#proxy = proxy }
  open(url: string, sink: AudioSink): { close(): void } {
    let done = false
    const chunker = new Rechunker()
    let child: ChildProcessByStdio<null, Readable, null> | null = null
    const end = () => { if (done) return; done = true; chunker.clear(); sink.fail() }
    try {
      // 프록시는 유튜브 영상 서버에만 — 틱톡 주소는 서버에서 바로 받았으므로 바로 연다 (D-UX3-16)
      child = spawn(this.#command, ffmpegArgs(url, safeHlsUrl(url) === null ? null : this.#proxy), { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
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
