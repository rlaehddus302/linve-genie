// 방송 소리로 듣기 (LV1, SPEC VOC-08, D-LV1-03·05·06·08 — 웹 StreamAudio와 같은 규칙·문구, D-LIVETEST-02).
// - 방송 화면이 열려 있는 동안 서버 상태를 1초마다 읽고, 처음 한 번 안내를 확인한 뒤에는 10초마다 "화면이 열려 있어요"를 알린다.
//   서버가 방송 소리를 받아 받아쓰기 일꾼에 넣고, 받아쓴 글은 이 기기의 마이크 없는 연결(음성 세션의 조작 전용 흐름)로 온다.
// - 휴대폰 마이크를 켜면 마이크가 대신 듣는다(서버는 쉰다, D-LV1-06). 상태 줄은 색 + 글자로.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { View } from 'react-native'
import {
  STREAM_AUDIO_CONSENT,
  STREAM_AUDIO_CONSENT_TITLE,
  STREAM_AUDIO_LOW_LATENCY,
  readStreamAudioStatus,
  streamAudioLine,
  type StreamAudioStatus,
} from '@livejjim/web/src/lib/stream-audio.ts'
import { get, post } from '../../api/client.ts'
import type { VoiceSession } from '../../lib/voice-session.ts'
import { readVoicePreferences, writeVoicePreference } from '../../lib/voice-preferences.ts'
import { BigButton, Body, Card, Hint, Notice, Row } from '../../ui/parts.tsx'

const POLL_MS = 1000
const WATCH_MS = 10_000
/** 이 기기 음성 설정에 남기는 안내 확인 (웹은 브라우저 저장소) */
const CONSENT_KEY = 'streamAudioConsent'
const TONE = { ok: 'success', warn: 'warning', danger: 'danger', info: 'info' } as const

export const streamAudioPath = (broadcastId: string): string => `/api/broadcasts/${encodeURIComponent(broadcastId)}/stream-audio`
/** 서버가 듣고 있거나 들으려는 상태 — 이때만 받아쓴 글을 받을 연결을 열어 둔다 */
export const holdsStream = (status: StreamAudioStatus | null): boolean => status !== null && ['idle', 'listening', 'reconnecting'].includes(status.phase)

/** 받아쓴 글 그대로 — 해석(번호·가격) 문장은 카드에만. 새 줄이 아래, 지난 줄은 남겨 둔다 */
export function Transcript({ lines }: { readonly lines: readonly string[] }) {
  return (
    <View aria-label="들린 말" role="log" style={{ gap: 2 }}>
      {lines.length === 0 ? <Hint>아직 들린 말이 없어요.</Hint> : lines.map((line, index) => (
        index === lines.length - 1 ? <Body key={`${String(index)}:${line}`} bold>{line}</Body> : <Hint key={`${String(index)}:${line}`}>{line}</Hint>
      ))}
    </View>
  )
}

export function StreamAudioPanel({ session, broadcastId, title }: { readonly session: VoiceSession; readonly broadcastId: string; readonly title: string }) {
  const view = useSyncExternalStore(session.subscribe, session.getView)
  const micOn = view.on && view.broadcastId === broadcastId
  const [status, setStatus] = useState<StreamAudioStatus | null>(null)
  const [consented, setConsented] = useState<boolean | null>(null)
  useEffect(() => {
    let stop = false
    void readVoicePreferences().then((prefs) => { if (!stop) setConsented(prefs[CONSENT_KEY] === true) }, () => { if (!stop) setConsented(false) })
    return () => { stop = true }
  }, [])
  useEffect(() => {
    let stop = false
    const read = () => { get<unknown>(streamAudioPath(broadcastId)).then((body) => { if (!stop) setStatus(readStreamAudioStatus(body)) }, () => undefined) }
    read()
    const timer = setInterval(read, POLL_MS)
    return () => { stop = true; clearInterval(timer) }
  }, [broadcastId])
  useEffect(() => {
    if (consented !== true) return
    const watch = () => { post(`${streamAudioPath(broadcastId)}/watch`, {}).catch(() => undefined) }
    watch()
    const timer = setInterval(watch, WATCH_MS)
    return () => clearInterval(timer)
  }, [broadcastId, consented])
  const hold = consented === true && !micOn && holdsStream(status)
  useEffect(() => {
    session.holdStream(broadcastId, title, hold)
  }, [session, broadcastId, title, hold])
  useEffect(() => () => session.holdStream(broadcastId, title, false), [session, broadcastId, title])

  const accept = () => {
    setConsented(true)
    writeVoicePreference(CONSENT_KEY, true).catch(() => undefined)
  }
  if (consented === false && status !== null && !['hidden', 'off', 'ended'].includes(status.phase)) {
    return (
      <Card label={STREAM_AUDIO_CONSENT_TITLE}>
        <View role="dialog" aria-label={STREAM_AUDIO_CONSENT_TITLE} style={{ gap: 8 }}>
          <Body bold>{STREAM_AUDIO_CONSENT_TITLE}</Body>
          <Body>{STREAM_AUDIO_CONSENT}</Body>
          <Hint>{STREAM_AUDIO_LOW_LATENCY}</Hint>
          <BigButton primary label="확인하고 듣기" onPress={accept} />
        </View>
      </Card>
    )
  }
  const line = streamAudioLine(status, micOn)
  if (line === null) return null
  return (
    <View aria-label="듣는 곳" style={{ gap: 6 }}>
      <Notice tone={TONE[line.tone]} alert={line.tone === 'danger'}>{line.text}</Notice>
      {line.late !== null ? <Hint>{line.late}</Hint> : null}
      {hold ? <Transcript lines={view.transcript} /> : null}
      {line.retry || line.useMic ? (
        <Row wrap>
          {line.retry ? <BigButton small label="다시 켜기" onPress={() => { post(`${streamAudioPath(broadcastId)}/restart`, {}).catch(() => undefined) }} /> : null}
          {line.useMic ? <BigButton small label="휴대폰으로 듣기" onPress={() => void session.turnOn(broadcastId, title)} /> : null}
        </Row>
      ) : null}
    </View>
  )
}
