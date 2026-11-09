import { SERVICE_NAME } from '../brand.ts'
// 방송 소리로 듣기 (LV1, SPEC VOC-08, D-LV1-03~08) — 서버가 알려 준 상태를 화면 문장으로 바꾼다. 순수 함수.
// 화면에는 쉬운 한국어만 — 소리 받는 방법의 기술 이름은 보이지 않는다(AC-LV1-12).

/** 서버가 알려 주는 그 방송의 소리 상태 (dev-notes `## server`의 모양에 맞춘다) */
export type StreamAudioPhase =
  | 'hidden' // 운영자가 껐거나 이 서버에서 쓸 수 없음 — 칸·줄을 숨긴다(D-LV1-08)
  | 'off' // 판매자 설정 끔
  | 'idle' // 아직 듣지 않음(안내 확인 전·방송을 잇기 전)
  | 'listening'
  | 'reconnecting'
  | 'stopped' // 60초 안 여섯 번째 끊김
  | 'unsupported' // 소리를 받을 수 없는 방송(D-LV1-07)
  | 'mic' // 휴대폰 마이크가 듣는 중(D-LV1-06)
  | 'ended'

export interface StreamAudioStatus {
  readonly phase: StreamAudioPhase
  /** 받는 소리가 실시간보다 얼마나 뒤처졌는지(밀리초, 조각 도착 기준) */
  readonly lagMs?: number
}

/** 늦음 안내 기준 (D-LV1-04 → D-LV1-10 30초) */
export const STREAM_AUDIO_LATE_MS = 30_000

export const STREAM_AUDIO_LISTENING = '라이브 소리로 음성 인식 중'
export const STREAM_AUDIO_MIC = '휴대폰 마이크로 음성 인식 중'
export const STREAM_AUDIO_RECONNECTING = '라이브 소리 다시 잇는 중'
export const STREAM_AUDIO_STOPPED = '라이브 소리 음성 인식 멈춤 · 상품은 빠른 입력으로 넣거나 휴대폰 마이크로 음성 인식해 주세요.'
export const STREAM_AUDIO_LATE = '라이브 소리가 늦어요. 휴대폰 마이크로 음성 인식하면 더 빨라요.'
export const STREAM_AUDIO_UNSUPPORTED = '이 라이브는 소리를 받을 수 없어요. 휴대폰 마이크로 음성 인식해 주세요.'
export const STREAM_AUDIO_OFF = '라이브 소리로 음성 인식이 꺼져 있어요. 설정에서 켤 수 있어요.'
export const STREAM_AUDIO_IDLE = '라이브를 이으면 라이브 소리로 음성 인식해요.'
export const STREAM_AUDIO_CONSENT_TITLE = '라이브 소리로 음성 인식'
export const STREAM_AUDIO_CONSENT = `라이브 소리를 ${SERVICE_NAME} 받아쓰기 서버로 보내 글로 바꿔요. 소리는 저장하지 않아요.`
/** 초저지연 안내 (D-LV1-10, AC-LV1-13) — 설정 칸·첫 안내 창 */
export const STREAM_AUDIO_LOW_LATENCY = "유튜브 라이브 설정에서 지연 시간을 '초저지연'으로 하면 더 빨리 등록돼요."
export const STREAM_AUDIO_SETTING_LABEL = '라이브 소리로 음성 인식'
export const STREAM_AUDIO_SETTING_HELP = '켜 두면 라이브 화면을 한 번 연 뒤로는 앱을 닫아도 라이브가 끝날 때까지 라이브 소리를 음성 인식해 상품을 등록해요. 휴대폰 마이크를 켜면 마이크로 대신 음성 인식해요.'

export type StreamAudioTone = 'ok' | 'warn' | 'danger' | 'info'

export interface StreamAudioLine {
  readonly text: string
  readonly tone: StreamAudioTone
  /** [다시 켜기] 보이기 */
  readonly retry: boolean
  /** [휴대폰으로 듣기] 보이기 */
  readonly useMic: boolean
  /** 늦음 안내 (듣는 중일 때 따로 한 줄) */
  readonly late: string | null
}

/** 콘솔 상태 줄. `micOn`은 이 기기에서 음성(마이크)을 켰는지 — 서버가 아직 모를 때도 마이크가 이긴다. 숨길 때는 null */
export function streamAudioLine(status: StreamAudioStatus | null, micOn: boolean): StreamAudioLine | null {
  if (status === null || status.phase === 'hidden' || status.phase === 'ended') return null
  const base = { retry: false, useMic: false, late: null }
  if (micOn || status.phase === 'mic') return { ...base, text: STREAM_AUDIO_MIC, tone: 'ok' }
  switch (status.phase) {
    case 'listening': {
      const late = (status.lagMs ?? 0) > STREAM_AUDIO_LATE_MS
      return { ...base, text: STREAM_AUDIO_LISTENING, tone: 'ok', late: late ? STREAM_AUDIO_LATE : null, useMic: late }
    }
    case 'reconnecting':
      return { ...base, text: STREAM_AUDIO_RECONNECTING, tone: 'warn' }
    case 'stopped':
      return { ...base, text: STREAM_AUDIO_STOPPED, tone: 'danger', retry: true, useMic: true }
    case 'unsupported':
      return { ...base, text: STREAM_AUDIO_UNSUPPORTED, tone: 'warn', useMic: true }
    case 'off':
      return { ...base, text: STREAM_AUDIO_OFF, tone: 'info' }
    default:
      return { ...base, text: STREAM_AUDIO_IDLE, tone: 'info' }
  }
}

const PHASES: readonly StreamAudioPhase[] = ['hidden', 'off', 'idle', 'listening', 'reconnecting', 'stopped', 'unsupported', 'mic', 'ended']

/** 서버 응답을 믿지 않고 읽는다 — 모르는 값은 숨김 */
export function readStreamAudioStatus(body: unknown): StreamAudioStatus {
  if (typeof body !== 'object' || body === null) return { phase: 'hidden' }
  const record = body as { phase?: unknown; lagMs?: unknown }
  const phase = PHASES.find((p) => p === record.phase) ?? 'hidden'
  const lagMs = typeof record.lagMs === 'number' && Number.isFinite(record.lagMs) ? record.lagMs : undefined
  return lagMs === undefined ? { phase } : { phase, lagMs }
}

const CONSENT_KEY = 'livejjim.streamAudioConsent'

export function readStreamAudioConsent(storage: Pick<Storage, 'getItem'> | null): boolean {
  try { return storage?.getItem(CONSENT_KEY) === '1' } catch { return false }
}

export function writeStreamAudioConsent(storage: Pick<Storage, 'setItem'> | null): void {
  try { storage?.setItem(CONSENT_KEY, '1') } catch { /* 저장 못 해도 이번엔 듣는다 */ }
}
