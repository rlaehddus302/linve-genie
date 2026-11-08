// 방송 소리로 듣기 (LV1, SPEC VOC-08, D-LV1-03·05·06·08 — 웹 StreamAudio와 같은 규칙·문구, D-LIVETEST-02).
// - 마지막으로 연 방송 중인 방송을 앱 뿌리(KeptStreamAudio)가 붙잡아, 방송 화면을 나가도 서버 상태를 1초마다 읽고 10초마다 "화면이 열려 있어요"를 알린다.
// - D-LV1-16: 처음 한 번 묻던 안내 카드([확인하고 듣기])는 없앴다 — 방송 화면을 열면 바로 듣는다.
//   서버가 방송 소리를 받아 받아쓰기 일꾼에 넣고, 받아쓴 글은 이 기기의 마이크 없는 연결(음성 세션의 조작 전용 흐름)로 온다.
// - 휴대폰 마이크를 켜면 마이크가 대신 듣는다(서버는 쉰다, D-LV1-06). 상태 줄은 색 + 글자로.
// - D-LV1-14: 앱을 닫아도 서버는 방송이 끝날 때까지 듣고, 받을 앱이 없으면 서버가 읽고 바로 등록한다. 돌아오면 ServerHeard가 그동안 한 일을 보여 준다.
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { Pressable, View } from 'react-native'
import { readStreamAudioStatus, streamAudioLine, type StreamAudioStatus } from '@livejjim/web/src/lib/stream-audio.ts'
import { get, post } from '../../api/client.ts'
import type { VoiceSession, VoiceView } from '../../lib/voice-session.ts'
import { Icon, Txt, useKit } from '../../ui/kit/index.ts'
import { RADIUS, SPACE } from '../../ui/kit/tokens.ts'
import { listenState } from './VoicePanel.tsx'
import { BigButton, Body, Card, Hint } from '../../ui/parts.tsx'
import type { StreamKeep } from '../../lib/stream-keep.ts'

const POLL_MS = 1000
const WATCH_MS = 10_000

export const streamAudioPath = (broadcastId: string): string => `/api/broadcasts/${encodeURIComponent(broadcastId)}/stream-audio`
/** 서버가 듣고 있거나 들으려는 상태 — 이때만 받아쓴 글을 받을 연결을 열어 둔다 */
export const holdsStream = (status: StreamAudioStatus | null): boolean => status !== null && ['idle', 'listening', 'reconnecting'].includes(status.phase)

/** 받아쓴 글 그대로 — 해석(번호·가격) 문장은 카드에만. 새 줄이 아래, 지난 줄은 남겨 둔다. small: 들린 말 카드처럼 모든 줄을 작은 글자 한 크기로 (D-UX3-76) */
export function Transcript({ lines, small = false }: { readonly lines: readonly string[]; readonly small?: boolean }) {
  return (
    <View aria-label="들린 말" role="log" style={{ gap: 2 }}>
      {lines.length === 0 ? <Hint>아직 들린 말이 없어요.</Hint> : lines.map((line, index) => {
        const key = `${String(index)}:${line}`
        const last = index === lines.length - 1
        if (small) return <Txt key={key} step="caption" color={last ? undefined : 'textSub'} weight={last ? 'bold' : undefined}>{line}</Txt>
        return last ? <Body key={key} bold>{line}</Body> : <Hint key={key}>{line}</Hint>
      })}
    </View>
  )
}

export interface StreamAudio {
  readonly status: StreamAudioStatus | null
  /** 방송 소리로 듣는 중 (받아쓴 글을 받을 연결을 열어 둠) */
  readonly hold: boolean
  readonly retry: () => void
}

/** 방송 화면이 열린 동안: 상태 읽기(1초)·watch(10초)·받아쓴 글을 받을 연결 유지 */
export function useStreamAudio(session: VoiceSession, broadcastId: string, title: string, active: boolean): StreamAudio {
  const view = useSyncExternalStore(session.subscribe, session.getView)
  const micOn = view.on && view.broadcastId === broadcastId
  const [status, setStatus] = useState<StreamAudioStatus | null>(null)
  useEffect(() => {
    if (!active) return
    let stop = false
    const read = () => { get<unknown>(streamAudioPath(broadcastId)).then((body) => { if (!stop) setStatus(readStreamAudioStatus(body)) }, () => undefined) }
    read()
    const timer = setInterval(read, POLL_MS)
    return () => { stop = true; clearInterval(timer) }
  }, [broadcastId, active])
  useEffect(() => {
    if (!active) return
    const watch = () => { post(`${streamAudioPath(broadcastId)}/watch`, {}).catch(() => undefined) }
    watch()
    const timer = setInterval(watch, WATCH_MS)
    return () => clearInterval(timer)
  }, [broadcastId, active])
  const hold = active && !micOn && holdsStream(status)
  useEffect(() => {
    session.holdStream(broadcastId, title, hold)
  }, [session, broadcastId, title, hold])
  useEffect(() => () => session.holdStream(broadcastId, title, false), [session, broadcastId, title])
  const retry = useCallback(() => { post(`${streamAudioPath(broadcastId)}/restart`, {}).catch(() => undefined) }, [broadcastId])
  return { status, hold, retry }
}

const NO_STREAM: StreamAudio = { status: null, hold: false, retry: () => undefined }

/** 방송 화면이 읽는 방송 소리 — 앱 뿌리가 듣고 있는 그 방송이면 그것, 아니면 아직 없음 */
export function useKeptStream(keep: StreamKeep, broadcastId: string): StreamAudio {
  const audio = useSyncExternalStore(keep.subscribe, keep.getAudio)
  return audio?.broadcastId === broadcastId ? audio.stream : NO_STREAM
}

function KeptRunner({ session, keep, broadcastId, title }: { readonly session: VoiceSession; readonly keep: StreamKeep; readonly broadcastId: string; readonly title: string }) {
  const stream = useStreamAudio(session, broadcastId, title, true)
  const { status, hold, retry } = stream
  useEffect(() => { keep.publish(broadcastId, { status, hold, retry }) }, [keep, broadcastId, status, hold, retry])
  // 방송이 끝나면(서버가 끝을 앎) 놓는다
  useEffect(() => { if (status?.phase === 'ended') keep.release(broadcastId) }, [keep, broadcastId, status?.phase])
  return null
}

/** 앱 뿌리에 하나: 로그인한 동안, 마지막으로 연 방송 중인 방송의 소리를 화면과 상관없이 계속 듣는다 */
export function KeptStreamAudio({ session, keep, signedIn }: { readonly session: VoiceSession; readonly keep: StreamKeep; readonly signedIn: boolean }) {
  const kept = useSyncExternalStore(keep.subscribe, keep.getKept)
  useEffect(() => { if (!signedIn) keep.release() }, [keep, signedIn])
  if (!signedIn || kept === null) return null
  return <KeptRunner key={kept.broadcastId} session={session} keep={keep} broadcastId={kept.broadcastId} title={kept.title} />
}

/** 머리 오른쪽 듣기 상태 한 곳: 마이크가 켜져 있으면 마이크, 아니면 방송 소리, 둘 다 아니면 꺼짐 */
export function listenChip(view: VoiceView, broadcastId: string, status: StreamAudioStatus | null): { readonly word: string; readonly tone: 'on' | 'off' | 'warn' } {
  const mic = listenState(view, broadcastId)
  if (view.on && view.broadcastId === broadcastId) return mic
  if (status?.phase === 'listening') return { word: '방송 소리 듣는 중', tone: 'on' }
  if (status?.phase === 'reconnecting') return { word: '방송 소리 다시 잇는 중', tone: 'warn' }
  if (status?.phase === 'stopped') return { word: '방송 소리 멈춤', tone: 'warn' }
  return mic
}

/** 서버가 앱 없이 들은·한 일 한 줄 (D-LV1-14) */
export interface ServerHeardEntry { readonly at: number; readonly kind: 'heard' | 'registered' | 'exists' | 'skipped' | 'failed'; readonly text?: string; readonly no?: number; readonly name?: string; readonly price?: number }
const HEARD_POLL_MS = 5000
const won = (price: number | undefined): string => (price === undefined ? '' : ` ${price.toLocaleString('ko-KR')}원`)

/** 서버가 한 일 한 줄 (쉬운 말) */
export function serverHeardLine(entry: ServerHeardEntry): string | null {
  const product = `${entry.no === undefined ? '' : `${String(entry.no)}번 `}${entry.name ?? ''}${won(entry.price)}`.trim()
  if (entry.kind === 'registered') return `${product} 등록했어요`
  if (entry.kind === 'exists') return `${product} — 이미 있는 번호라 등록하지 않았어요`
  if (entry.kind === 'failed') return `${product} — 등록하지 못했어요. 상품 목록에서 확인해 주세요`
  if (entry.kind === 'skipped') return '고치기·번호 바꾸기 말은 하지 않았어요. 상품 목록에서 확인해 주세요'
  return null
}

/**
 * 앱을 닫은 동안 서버가 들은 말 (D-LV1-14, 사용자 지시 2026-11-08): 앱이 없을 때는 서버가 방송 소리를 읽고 바로 등록한다.
 * 돌아오면 서버가 등록한 상품·하지 않은 말·확인이 필요한 말·들린 말을 보여 주고, [확인했어요]로 지운다
 */
export function ServerHeard({ broadcastId }: { readonly broadcastId: string }) {
  const [entries, setEntries] = useState<readonly ServerHeardEntry[]>([])
  const [pending, setPending] = useState<readonly string[]>([])
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let stop = false
    const read = () => {
      get<{ entries?: unknown; pending?: unknown }>(`${streamAudioPath(broadcastId)}/heard`).then((body) => {
        if (stop) return
        setEntries(Array.isArray(body.entries) ? (body.entries as ServerHeardEntry[]) : [])
        setPending(Array.isArray(body.pending) ? (body.pending as unknown[]).filter((text): text is string => typeof text === 'string') : [])
      }, () => undefined)
    }
    read()
    const timer = setInterval(read, HEARD_POLL_MS)
    return () => { stop = true; clearInterval(timer) }
  }, [broadcastId])
  if (entries.length === 0 && pending.length === 0) return null
  const done = entries.flatMap((entry) => { const text = serverHeardLine(entry); return text === null ? [] : [text] })
  const registered = entries.filter((entry) => entry.kind === 'registered').length
  const heard = entries.flatMap((entry) => (entry.kind === 'heard' && entry.text !== undefined ? [entry.text] : []))
  const clear = () => {
    setEntries([]); setPending([])
    post(`${streamAudioPath(broadcastId)}/heard/clear`, {}).catch(() => undefined)
  }
  return (
    <Card label="앱을 닫은 동안 서버가 들은 말">
      <View style={{ gap: 6 }}>
        <Body bold>앱을 닫은 동안 서버가 들었어요</Body>
        <Hint>{registered > 0 ? `상품 ${String(registered)}개를 등록했어요.` : '등록한 상품은 없어요.'} 틀린 게 있으면 상품 목록에서 고쳐 주세요.</Hint>
        {done.length > 0 ? <View role="list" aria-label="서버가 한 일" style={{ gap: 2 }}>{done.map((text, index) => <Body key={`${String(index)}:${text}`}>{text}</Body>)}</View> : null}
        {pending.length > 0 ? (
          <View aria-label="확인이 필요한 말" style={{ gap: 2 }}>
            <Body bold>확인이 필요한 말 (등록하지 않았어요)</Body>
            {pending.map((text, index) => <Hint key={`${String(index)}:${text}`}>{text}</Hint>)}
          </View>
        ) : null}
        {heard.length > 0 ? (
          <Pressable role="button" aria-label={open ? '서버가 들은 말 접기' : '서버가 들은 말 펼치기'} aria-expanded={open} onPress={() => setOpen((now) => !now)}>
            <Txt step="caption" color="textSub">{open ? '들린 말 접기' : `들린 말 ${String(heard.length)}줄 펼치기`}</Txt>
          </Pressable>
        ) : null}
        {open ? <Transcript lines={heard} /> : null}
        <BigButton small primary label="확인했어요" onPress={clear} />
      </View>
    </Card>
  )
}

/**
 * 들린 말 한 줄 (D-LIVETEST-07): 평소엔 마지막으로 들린 말 한 줄만 — 오른쪽 ⌄를 누르면 최근 줄을 펼친다.
 * D-UX3-76(사용자 지시 2026-11-09): 펼치기·접기 글자 대신 ⌄/⌃ 아이콘, 펼치면 흰 바탕이 늘어나 들린 말까지 한 카드에 담고, 글자는 모두 caption 한 크기.
 * 듣는 곳 상태 문장("방송 소리로 듣는 중" 등)은 머리 오른쪽 듣기 상태와 겹쳐 없앴다 — 늦음 안내만 펼쳤을 때 남긴다(머리에 없는 말).
 * 다시 켜기·휴대폰 마이크는 방송 메뉴(⋯)에만 있다(D-UX3-73).
 */
export function ListenLine({ session, broadcastId, stream }: { readonly session: VoiceSession; readonly broadcastId: string; readonly stream: StreamAudio }) {
  const { p } = useKit()
  const view = useSyncExternalStore(session.subscribe, session.getView)
  const [open, setOpen] = useState(false)
  const [pressed, setPressed] = useState(false)
  const micOn = view.on && view.broadcastId === broadcastId
  // "앱을 닫은 동안 서버가 들었어요" 카드는 띄우지 않는다 (D-UX3-87, 사용자 지시 2026-11-09)
  const line = streamAudioLine(stream.status, micOn)
  const hearing = micOn || stream.hold
  if (!hearing && line === null) return null
  const last = view.transcript.at(-1) ?? null
  return (
    <View style={{ gap: 6 }}>
      <View style={{ borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : p.surface, paddingHorizontal: SPACE.sm, paddingVertical: SPACE.xs, gap: SPACE.xs }}>
        <Pressable role="button" aria-label={open ? '들린 말 접기' : '들린 말 펼치기'} aria-expanded={open} onPress={() => setOpen((now) => !now)} onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
          <Icon name="mic" size={16} color={hearing ? p.primaryText : p.textSub} />
          <View role="status" aria-label="지금 들리는 말" style={{ flex: 1 }}>
            <Txt step="caption" numberOfLines={1} color={last === null ? 'textSub' : undefined}>{hearing ? (last ?? '아직 들린 말이 없어요.') : (line?.text ?? '')}</Txt>
          </View>
          <Icon name={open ? 'up' : 'down'} size={16} color={p.textSub} />
        </Pressable>
        {open && hearing ? <Transcript lines={view.transcript} small /> : null}
        {open && line?.late != null ? <Txt step="caption" color="textSub">{line.late}</Txt> : null}
      </View>
    </View>
  )
}
