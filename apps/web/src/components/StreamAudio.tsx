// 방송 소리로 듣기 (LV1, SPEC VOC-08, D-LV1-03·05·06·08, AC-LV1-01·05~07·09·12)
// - 콘솔 상태 줄: 지금 듣는 곳·끊김·멈춤·늦음 문장과 [다시 켜기]·[휴대폰으로 듣기]. 색 + 글자로.
// - 처음 한 번 안내 창: 확인해야 서버에 "콘솔이 열려 있어요"를 알린다(아무도 못 보는 바로 등록 없음).
// - 설정 칸: 판매자 설정 "방송 소리로 듣기"(기본 켬). 운영자가 껐으면 칸이 없다.
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { get, post, put } from '../api/client.ts'
import {
  STREAM_AUDIO_CONSENT,
  STREAM_AUDIO_CONSENT_TITLE,
  STREAM_AUDIO_LOW_LATENCY,
  STREAM_AUDIO_SETTING_HELP,
  STREAM_AUDIO_SETTING_LABEL,
  readStreamAudioConsent,
  readStreamAudioStatus,
  streamAudioLine,
  writeStreamAudioConsent,
  type StreamAudioStatus,
} from '../lib/stream-audio.ts'
import { Modal } from './Modal.tsx'

const POLL_MS = 1000
const WATCH_MS = 10_000

/** 이 기기 저장소 — 막힌 브라우저(읽기만 해도 예외)에서는 없음으로 본다. 콘솔이 그려지지 않으면 안 된다 (AC-I4-11·30) */
const storage = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export const streamAudioPath = (broadcastId: string): string => `/api/broadcasts/${encodeURIComponent(broadcastId)}/stream-audio`

/** 콘솔이 열려 있는 동안 상태를 읽고, 안내 확인 뒤에는 "보는 중"을 알린다 */
export function useStreamAudio(broadcastId: string, active: boolean) {
  const [status, setStatus] = useState<StreamAudioStatus | null>(null)
  const [consented, setConsented] = useState(() => readStreamAudioConsent(storage()))
  useEffect(() => {
    if (!active) return
    let stop = false
    const read = () => {
      get<unknown>(streamAudioPath(broadcastId)).then((body) => { if (!stop) setStatus(readStreamAudioStatus(body)) }, () => undefined)
    }
    read()
    const timer = setInterval(read, POLL_MS)
    return () => { stop = true; clearInterval(timer) }
  }, [broadcastId, active])
  useEffect(() => {
    if (!active || !consented) return
    const watch = () => { post(`${streamAudioPath(broadcastId)}/watch`, {}).catch(() => undefined) }
    watch()
    const timer = setInterval(watch, WATCH_MS)
    return () => clearInterval(timer)
  }, [broadcastId, active, consented])
  const accept = useCallback(() => { writeStreamAudioConsent(storage()); setConsented(true) }, [])
  const retry = useCallback(() => { post(`${streamAudioPath(broadcastId)}/restart`, {}).catch(() => undefined) }, [broadcastId])
  /** 안내 창을 띄울 때: 서버가 들을 수 있다고 하고(숨김·끔·끝이 아님) 아직 확인 안 함 */
  const askConsent = !consented && status !== null && !['hidden', 'off', 'ended'].includes(status.phase)
  return { status, consented, askConsent, accept, retry }
}

const TONE_CLASS = { ok: 'stream-audio-ok', warn: 'stream-audio-warn', danger: 'stream-audio-danger', info: 'stream-audio-info' } as const
const TONE_MARK = { ok: '●', warn: '!', danger: '■', info: 'i' } as const

export function StreamAudioLine({ status, micOn, onRetry, onUseMic }: {
  readonly status: StreamAudioStatus | null
  readonly micOn: boolean
  readonly onRetry: () => void
  readonly onUseMic: () => void
}) {
  const line = streamAudioLine(status, micOn)
  if (line === null) return null
  const danger = line.tone === 'danger'
  return (
    <section className={`stream-audio ${TONE_CLASS[line.tone]}`} aria-label="듣는 곳">
      <p className={danger ? 'stream-audio-text stream-audio-big' : 'stream-audio-text'} role={danger ? 'alert' : 'status'}>
        <span aria-hidden="true">{TONE_MARK[line.tone]} </span>
        {line.text}
      </p>
      {line.late !== null ? <p className="stream-audio-text" role="status">{line.late}</p> : null}
      {line.retry || line.useMic ? (
        <div className="row">
          {line.retry ? <button type="button" className="button stream-audio-button" onClick={onRetry}>다시 켜기</button> : null}
          {line.useMic ? <button type="button" className="button stream-audio-button" onClick={onUseMic}>휴대폰으로 듣기</button> : null}
        </div>
      ) : null}
    </section>
  )
}

export function StreamAudioConsent({ onAccept, onClose }: { readonly onAccept: () => void; readonly onClose: () => void }) {
  return (
    <Modal
      title={STREAM_AUDIO_CONSENT_TITLE}
      onClose={onClose}
      className="kp1-seller"
      actions={<button type="button" className="button button-primary" onClick={onAccept}>확인하고 듣기</button>}
    >
      <p>{STREAM_AUDIO_CONSENT}</p>
      <p>{STREAM_AUDIO_LOW_LATENCY}</p>
    </Modal>
  )
}

interface StreamAudioSettings { readonly available: boolean; readonly enabled: boolean }

function readSettings(body: unknown): StreamAudioSettings {
  if (typeof body !== 'object' || body === null) return { available: false, enabled: false }
  const record = body as { available?: unknown; enabled?: unknown }
  return { available: record.available === true, enabled: record.enabled !== false }
}

/** 설정 화면의 칸 — 운영자가 껐으면(available false) 아무것도 그리지 않는다(AC-LV1-09) */
export function StreamAudioSetting({ wrap }: { readonly wrap: (children: ReactNode) => ReactNode }) {
  const [settings, setSettings] = useState<StreamAudioSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  useEffect(() => {
    let stop = false
    get<unknown>('/api/settings/stream-audio').then((body) => { if (!stop) setSettings(readSettings(body)) }, () => undefined)
    return () => { stop = true }
  }, [])
  if (settings === null || !settings.available) return null
  const change = (enabled: boolean) => {
    setBusy(true)
    setError(false)
    put<unknown>('/api/settings/stream-audio', { enabled }).then(
      (body) => { setSettings(readSettings(body ?? { available: true, enabled })); setBusy(false) },
      () => { setError(true); setBusy(false) },
    )
  }
  return wrap(
    <div className="stack stream-audio-setting">
      <label className="row stream-audio-check">
        <input type="checkbox" checked={settings.enabled} disabled={busy} onChange={(event) => change(event.target.checked)} />
        <span>{STREAM_AUDIO_SETTING_LABEL}</span>
      </label>
      <p>{settings.enabled ? '지금: 켜짐' : '지금: 꺼짐'}</p>
      <p className="muted">{STREAM_AUDIO_SETTING_HELP}</p>
      <p>{STREAM_AUDIO_LOW_LATENCY}</p>
      {error ? <p role="alert" className="voice-error">저장하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.</p> : null}
    </div>
  )
}
