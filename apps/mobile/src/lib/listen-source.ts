// 소리 듣기 고르기 (D-RETRO-70, 사용자 지시 2026-11-13 "휴대폰 마이크로 들을지 라이브 소리로 바로 할지 설정하게 해 달라"):
// 판매자가 고른 듣는 곳(휴대폰 마이크 · 라이브 소리)은 서버의 판매자 설정에 남는다(GET·PUT /api/settings/listen-source).
// - 휴대폰 마이크: 이 휴대폰 마이크를 켠다. 마이크가 꺼져 있으면 서버가 라이브 소리로 듣는다(서버 규칙 D-LV1-06 그대로).
// - 라이브 소리: 이 휴대폰 마이크를 켜지 않는다. 서버가 라이브 방송 소리를 듣는다(앱을 닫아도 — D-LV1-14).
// 서버 값을 아직 모르면(null) 예전 동작 그대로 둔다 — 화면은 "확인하는 중"만 보인다.
import { STREAM_AUDIO_LATE, STREAM_AUDIO_LATE_MS, type StreamAudioStatus } from '@livejjim/web/src/lib/stream-audio.ts'
import { get, isApiError, put } from '../api/client.ts'

export type ListenSource = 'mic' | 'stream'

export interface ListenSetting {
  /** 지금 통하는 선택 */
  readonly source: ListenSource
  /** 이 서버에서 라이브 소리로 들을 수 있는지 */
  readonly streamAvailable: boolean
  /** 라이브 소리 듣기 켬·끔 (웹 설정의 스위치와 같은 값) */
  readonly streamEnabled: boolean
}

export const LISTEN_SOURCE_PATH = '/api/settings/listen-source'

/** 관리 화면 줄·고르는 판 이름 */
export const LISTEN_SOURCE_TITLE = '소리 듣기'
/** 판 제목 아래 설명 */
export const LISTEN_SOURCE_DESCRIPTION = '라이브에서 하는 말을 어디서 들을지 골라요.\n라이브 중에 바꿔도 바로 바뀌어요.'
export const LISTEN_SOURCE_LABEL: Readonly<Record<ListenSource, string>> = { mic: '휴대폰 마이크', stream: '라이브 소리' }
/** 음성 창의 작은 표시 */
export const LISTEN_SOURCE_SHORT = { mic: '마이크', stream: '라이브', otherMic: '다른 기기' } as const

export const LISTEN_MIC_BODY = '이 휴대폰 마이크로 바로 들어요. 라이브 소리보다 빨리 글로 바뀌어요.'
/** 라이브 소리 듣기가 켜져 있을 때만 덧붙인다 — 마이크가 꺼지면 서버가 라이브 소리로 듣는다(D-LV1-06) */
export const LISTEN_MIC_FALLBACK = '마이크가 꺼지면 라이브 소리로 들어요.'
export const LISTEN_STREAM_BODY = '라이브로 나간 소리를 서버가 들어요. 앱을 닫아도 들어요. 라이브가 늦게 나가는 만큼 늦어요.'
export const LISTEN_STREAM_UNAVAILABLE = '지금은 라이브 소리로 들을 수 없어요.'

export const LISTEN_CHECKING = '확인하는 중이에요'
export const LISTEN_MIC_ON = '휴대폰 마이크로 듣고 있어요'
export const LISTEN_MIC_STARTING = '휴대폰 마이크를 켜는 중이에요'
export const LISTEN_MIC_RECONNECTING = '휴대폰 마이크를 다시 연결하는 중이에요'
export const LISTEN_OTHER_MIC = '다른 기기의 마이크로 듣고 있어요'
export const LISTEN_STREAM_ON = '라이브 소리로 듣고 있어요'
export const LISTEN_STREAM_RECONNECTING = '라이브 소리를 다시 연결하는 중이에요'
export const LISTEN_STREAM_IDLE = '라이브를 연결하면 라이브 소리로 들어요'
export const LISTEN_STREAM_STOPPED = '라이브 소리 듣기가 멈췄어요'
export const LISTEN_STREAM_UNSUPPORTED = '이 라이브는 소리를 받을 수 없어요'
export const LISTEN_STREAM_OFF = '라이브 소리 듣기가 꺼져 있어요'
export const LISTEN_NOTHING = '지금은 듣지 않아요'
export const LISTEN_ENDED = '라이브가 끝났어요'
/** 휴대폰 마이크를 골랐는데 마이크가 듣지 않을 때 문장 앞에 붙는 까닭 */
export const LISTEN_WHY = { off: '마이크가 꺼져 있어', denied: '마이크 권한이 없어', stopped: '휴대폰 마이크가 멈춰서' } as const
/** 같은 까닭을 끝나는 문장으로 — 뒤에 "지금은 듣지 않아요"가 따로 올 때 */
export const LISTEN_WHY_END = { off: '마이크가 꺼져 있어요.', denied: '마이크 권한이 없어요.', stopped: '휴대폰 마이크가 멈췄어요.' } as const

export const LISTEN_MIC_START = '휴대폰 마이크 켜기'
export const LISTEN_STREAM_RETRY = '라이브 소리 다시 켜기'
export const LISTEN_SAVE_FAILED = '바꾸지 못했어요. 다시 눌러 주세요.'
export const LISTEN_CONSENT_NO = '안 켤래요'
export const LISTEN_CONSENT_YES = '알겠어요, 켤게요'

/** 서버 응답을 믿지 않고 읽는다 — 모양이 다르면 null */
export function readListenSetting(body: unknown): ListenSetting | null {
  if (typeof body !== 'object' || body === null) return null
  const record = body as { source?: unknown; streamAvailable?: unknown; streamEnabled?: unknown }
  if (record.source !== 'mic' && record.source !== 'stream') return null
  return { source: record.source, streamAvailable: record.streamAvailable === true, streamEnabled: record.streamEnabled === true }
}

/** 고르는 판의 두 줄 — 설명은 지금 사실인 것만 */
export function listenChoices(setting: ListenSetting | null): readonly { readonly value: ListenSource; readonly label: string; readonly description: string }[] {
  const fallback = setting !== null && setting.streamAvailable && setting.streamEnabled
  const streamBlocked = setting !== null && !setting.streamAvailable
  return [
    { value: 'mic', label: LISTEN_SOURCE_LABEL.mic, description: fallback ? `${LISTEN_MIC_BODY} ${LISTEN_MIC_FALLBACK}` : LISTEN_MIC_BODY },
    { value: 'stream', label: LISTEN_SOURCE_LABEL.stream, description: streamBlocked ? LISTEN_STREAM_UNAVAILABLE : LISTEN_STREAM_BODY },
  ]
}

/** 이 휴대폰 마이크의 지금 모습 (음성 세션에서) */
export interface ListenMic {
  /** 이 방송으로 마이크를 켰다 */
  readonly on: boolean
  readonly kind: 'off' | 'starting' | 'listening' | 'reconnecting' | 'stopped'
  /** 마이크 권한 — 모르면 null */
  readonly allowed: boolean | null
}

export type ListenHearing = 'mic' | 'stream' | 'otherMic' | 'none'
export type ListenTone = 'ok' | 'warn' | 'danger' | 'info'

export interface ListenNow {
  /** 지금 실제로 듣는 쪽 */
  readonly hearing: ListenHearing
  readonly text: string
  readonly tone: ListenTone
  /** 늦음 안내 한 줄 (라이브 소리가 30초 넘게 늦을 때) */
  readonly late: string | null
  /** [휴대폰 마이크 켜기] 보이기 */
  readonly canMic: boolean
  /** [라이브 소리 다시 켜기] 보이기 */
  readonly canRetry: boolean
}

/** 지금 실제로 듣는 쪽과 상태 한 문장. 순수 함수 — 고른 값, 이 휴대폰 마이크, 서버가 알려 준 라이브 소리 상태에서 */
export function listenNow(source: ListenSource | null, mic: ListenMic, status: StreamAudioStatus | null): ListenNow {
  const base = { late: null, canMic: false, canRetry: false }
  if (mic.on) {
    if (mic.kind === 'listening') return { ...base, hearing: 'mic', text: LISTEN_MIC_ON, tone: 'ok' }
    return { ...base, hearing: 'none', text: mic.kind === 'reconnecting' ? LISTEN_MIC_RECONNECTING : LISTEN_MIC_STARTING, tone: 'warn' }
  }
  if (status === null) return { ...base, hearing: 'none', text: LISTEN_CHECKING, tone: 'info' }
  if (status.phase === 'ended') return { ...base, hearing: 'none', text: LISTEN_ENDED, tone: 'info' }
  // 휴대폰 마이크를 골랐는데 이 휴대폰 마이크가 듣지 않는다 — 까닭을 앞에 붙이고 [휴대폰 마이크 켜기]를 보인다
  const wantsMic = source === 'mic'
  const cause = mic.kind === 'stopped' ? 'stopped' : mic.allowed === false ? 'denied' : 'off'
  const why = wantsMic ? `${LISTEN_WHY[cause]} ` : ''
  const whyEnd = LISTEN_WHY_END[cause]
  const more = { ...base, canMic: wantsMic }
  switch (status.phase) {
    case 'mic':
      return { ...more, hearing: 'otherMic', text: LISTEN_OTHER_MIC, tone: 'ok' }
    case 'listening': {
      const late = (status.lagMs ?? 0) > STREAM_AUDIO_LATE_MS
      return { ...more, hearing: 'stream', text: `${why}${LISTEN_STREAM_ON}`, tone: wantsMic ? 'warn' : 'ok', late: late ? STREAM_AUDIO_LATE : null }
    }
    case 'reconnecting':
      return { ...more, hearing: 'none', text: `${why}${LISTEN_STREAM_RECONNECTING}`, tone: 'warn' }
    case 'stopped':
      return { ...more, hearing: 'none', text: `${why}${LISTEN_STREAM_STOPPED}`, tone: 'danger', canRetry: true }
    case 'unsupported':
      return { ...more, hearing: 'none', text: wantsMic ? `${whyEnd} ${LISTEN_STREAM_UNSUPPORTED}. ${LISTEN_NOTHING}` : LISTEN_STREAM_UNSUPPORTED, tone: 'danger' }
    case 'off':
      return { ...more, hearing: 'none', text: wantsMic ? `${whyEnd} ${LISTEN_STREAM_OFF}. ${LISTEN_NOTHING}` : LISTEN_STREAM_OFF, tone: 'danger' }
    case 'hidden':
      return { ...more, hearing: 'none', text: wantsMic ? `${whyEnd} ${LISTEN_NOTHING}` : LISTEN_NOTHING, tone: 'danger' }
    default:
      return { ...more, hearing: 'none', text: `${why}${LISTEN_STREAM_IDLE}`, tone: wantsMic ? 'warn' : 'info' }
  }
}

/** 음성 창의 작은 표시 낱말: 실제로 듣는 쪽, 듣는 쪽이 없으면 고른 쪽 */
export function listenShort(source: ListenSource | null, now: ListenNow): string | null {
  if (now.hearing === 'mic') return LISTEN_SOURCE_SHORT.mic
  if (now.hearing === 'stream') return LISTEN_SOURCE_SHORT.stream
  if (now.hearing === 'otherMic') return LISTEN_SOURCE_SHORT.otherMic
  return source === null ? null : LISTEN_SOURCE_SHORT[source]
}

/** 판매자가 고른 듣는 곳 — 서버 값을 기억해 두고 화면들이 같이 본다 */
export class ListenSourceStore {
  #setting: ListenSetting | null = null
  #reading: Promise<ListenSetting | null> | null = null
  /** 바꾸는 중에 온 옛 읽기 응답을 버리려고 센다 */
  #revision = 0
  /** 지금 값이 이 기기에서 고른 것인가 (서버에서 읽어 바뀌면 거짓) */
  #here = false
  readonly #listeners = new Set<() => void>()
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }
  get = (): ListenSetting | null => this.#setting
  get choseHere(): boolean { return this.#here }
  #put(next: ListenSetting | null): void {
    const was = this.#setting
    if (was === next || (was !== null && next !== null && was.source === next.source && was.streamAvailable === next.streamAvailable && was.streamEnabled === next.streamEnabled)) return
    this.#setting = next
    for (const listener of [...this.#listeners]) listener()
  }
  /** 서버에서 다시 읽는다. 못 읽으면 알던 값 그대로 */
  refresh(): Promise<ListenSetting | null> {
    if (this.#reading !== null) return this.#reading
    const revision = this.#revision
    const reading = get<unknown>(LISTEN_SOURCE_PATH).then((body) => {
      const next = readListenSetting(body)
      if (next !== null && revision === this.#revision) {
        if (next.source !== this.#setting?.source) this.#here = false
        this.#put(next)
      }
      return this.#setting
    }, () => this.#setting).finally(() => { if (this.#reading === reading) this.#reading = null })
    this.#reading = reading
    return reading
  }
  /** 알면 그 값, 모르면 한 번 읽어 본다 */
  known(): Promise<ListenSetting | null> {
    return this.#setting === null ? this.refresh() : Promise.resolve(this.#setting)
  }
  /** 고른 값을 서버에 남긴다. 못 남기면 화면에 보일 문장으로 던진다 */
  async choose(source: ListenSource): Promise<ListenSetting> {
    this.#revision++
    let body: unknown
    try {
      body = await put<unknown>(LISTEN_SOURCE_PATH, { source })
    } catch (caught) {
      throw new Error(isApiError(caught) ? caught.message : LISTEN_SAVE_FAILED, { cause: caught })
    }
    const next = readListenSetting(body)
    if (next === null) throw new Error(LISTEN_SAVE_FAILED)
    this.#revision++
    this.#here = true
    this.#put(next)
    return next
  }
  /** 로그아웃 — 다른 계정의 값이 남지 않게 */
  reset(): void {
    this.#revision++
    this.#reading = null
    this.#here = false
    this.#put(null)
  }
}
