// 방송 소리로 듣기 (LV1, SPEC VOC-08, D-LV1-03·05·06·08 — 웹 StreamAudio와 같은 규칙·문구, D-LIVETEST-02).
// - 마지막으로 연 방송 중인 방송을 앱 뿌리(KeptStreamAudio)가 붙잡아, 방송 화면을 나가도 서버 상태를 1초마다 읽고 10초마다 "화면이 열려 있어요"를 알린다.
// - D-LV1-16: 처음 한 번 묻던 안내 카드([확인하고 듣기])는 없앴다 — 방송 화면을 열면 바로 듣는다.
//   서버가 방송 소리를 받아 받아쓰기 일꾼에 넣고, 받아쓴 글은 이 기기의 마이크 없는 연결(음성 세션의 조작 전용 흐름)로 온다.
// - 휴대폰 마이크를 켜면 마이크가 대신 듣는다(서버는 쉰다, D-LV1-06). 상태 줄은 색 + 글자로.
// - D-LV1-14: 앱을 닫아도 서버는 방송이 끝날 때까지 듣고, 받을 앱이 없으면 서버가 읽고 바로 등록한다. 돌아오면 ServerHeard가 그동안 한 일을 보여 준다.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Animated, Easing, Platform, ScrollView, View } from 'react-native'
import { readStreamAudioStatus, streamAudioLine, type StreamAudioStatus } from '@livejjim/web/src/lib/stream-audio.ts'
import { useFollowScroll } from '../../lib/use-follow-scroll.ts'
import { get, post } from '../../api/client.ts'
import type { VoiceSession, VoiceView } from '../../lib/voice-session.ts'
import { DotStatus, EmptyFill, Icon, Tap, Txt, useKit } from '../../ui/kit/index.ts'
import { RADIUS, SPACE } from '../../ui/kit/tokens.ts'
import { BigButton, Body, Card, Hint } from '../../ui/parts.tsx'
import type { StreamKeep } from '../../lib/stream-keep.ts'
import { localHeard, mergeHeard, splitHeard, useSavedHeard } from './heard-history.ts'

const POLL_MS = 1000
const WATCH_MS = 10_000
/** 고른 듣는 곳(D-RETRO-70)을 서버에서 다시 읽는 사이 — 웹·다른 기기에서 바꾼 것이 이만큼 안에 따라온다 */
export const LISTEN_SOURCE_POLL_MS = 5000

export const streamAudioPath = (broadcastId: string): string => `/api/broadcasts/${encodeURIComponent(broadcastId)}/stream-audio`
/** 서버가 듣고 있거나 들으려는 상태 — 이때만 받아쓴 글을 받을 연결을 열어 둔다 */
export const holdsStream = (status: StreamAudioStatus | null): boolean => status !== null && ['idle', 'listening', 'reconnecting'].includes(status.phase)

/** 받아쓴 글 그대로 — 해석(번호·가격) 문장은 카드에만. 새 줄이 아래, 지난 줄은 남겨 둔다. small: 들린 말 카드처럼 모든 줄을 작은 글자 한 크기로 (D-UX3-76) */
export function Transcript({ lines, small = false }: { readonly lines: readonly string[]; readonly small?: boolean }) {
  return (
    <View aria-label="음성 인식" role="log" style={{ gap: 2 }}>
      {lines.length === 0 ? <Hint>아직 인식한 말이 없어요.</Hint> : lines.map((line, index) => {
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
  useListenSourceRule(session, keep, broadcastId, title)
  return null
}

/**
 * 고른 듣는 곳을 이 휴대폰 마이크에 그대로 따르게 한다 (D-RETRO-70) — 방송을 붙잡은 동안 앱 뿌리에서 한 번만.
 * - 라이브 소리: 이 방송으로 켜진 휴대폰 마이크를 끈다(서버가 라이브 소리로 돌아온다, D-LV1-06).
 * - 휴대폰 마이크로 바뀜(웹·다른 기기에서): 이 기기가 예전에 안내를 받았고 권한이 있을 때만 켠다. 이 기기에서 고른 것은 고르는 판이 직접 켠다.
 * 서버 값을 모르면 아무것도 하지 않는다(예전 동작 그대로).
 */
function useListenSourceRule(session: VoiceSession, keep: StreamKeep, broadcastId: string, title: string): void {
  const view = useSyncExternalStore(session.subscribe, session.getView, session.getView)
  const setting = useSyncExternalStore(keep.listen.subscribe, keep.listen.get, keep.listen.get)
  const source = setting?.source ?? null
  const micOn = view.on && view.broadcastId === broadcastId
  useEffect(() => {
    const read = () => { void keep.listen.refresh() }
    read()
    const timer = setInterval(read, LISTEN_SOURCE_POLL_MS)
    return () => clearInterval(timer)
  }, [keep])
  const before = useRef(source)
  useEffect(() => {
    const was = before.current
    before.current = source
    if (source === 'stream') {
      if (micOn) void session.turnOff()
    } else if (source === 'mic' && was === 'stream' && !keep.listen.choseHere) void session.preferMic(broadcastId, title)
  }, [session, keep, broadcastId, title, source, micOn])
}

/** 앱 뿌리에 하나: 로그인한 동안, 마지막으로 연 방송 중인 방송의 소리를 화면과 상관없이 계속 듣는다 */
export function KeptStreamAudio({ session, keep, signedIn }: { readonly session: VoiceSession; readonly keep: StreamKeep; readonly signedIn: boolean }) {
  const kept = useSyncExternalStore(keep.subscribe, keep.getKept)
  useEffect(() => { if (!signedIn) keep.release() }, [keep, signedIn])
  if (!signedIn || kept === null) return null
  return <KeptRunner key={kept.broadcastId} session={session} keep={keep} broadcastId={kept.broadcastId} title={kept.title} />
}

/** 들린 말 창 왼쪽 상태 낱말 세 가지 (D-UX4-67, 사용자 지시 2026-11-10 "듣는 중 표시 말고 다른 상태는 연결 끊김(red), 재연결 중(orange)") */
export const DOCK_STATE = { on: '인식 중', reconnecting: '재연결 중', lost: '연결 끊김' } as const

/**
 * 들린 말 창 왼쪽 상태 한 곳: 마이크가 켜져 있으면 마이크, 아니면 방송 소리.
 * 듣는 중(초록) · 켜는 중·다시 잇는 중·아직 듣기 전(주황 "재연결 중") · 멈춤·꺼짐·받을 수 없음·모름(빨강 "연결 끊김")
 */
export function listenChip(view: VoiceView, broadcastId: string, status: StreamAudioStatus | null): { readonly word: string; readonly tone: 'on' | 'off' | 'warn' } {
  const on = { word: DOCK_STATE.on, tone: 'on' } as const
  const again = { word: DOCK_STATE.reconnecting, tone: 'warn' } as const
  const lost = { word: DOCK_STATE.lost, tone: 'off' } as const
  if (view.on && view.broadcastId === broadcastId) {
    const kind = view.state.kind
    if (kind === 'listening') return on
    return kind === 'starting' || kind === 'reconnecting' ? again : lost
  }
  if (status?.phase === 'listening') return on
  if (status?.phase === 'reconnecting' || status?.phase === 'idle') return again
  return lost
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
    <Card label="앱을 닫은 동안 서버가 인식한 말">
      <View style={{ gap: 6 }}>
        <Body bold>앱을 닫은 동안 서버가 음성 인식했어요</Body>
        <Hint>{registered > 0 ? `상품 ${String(registered)}개를 등록했어요.` : '등록한 상품은 없어요.'} 틀린 게 있으면 상품 목록에서 고쳐 주세요.</Hint>
        {done.length > 0 ? <View role="list" aria-label="서버가 한 일" style={{ gap: 2 }}>{done.map((text, index) => <Body key={`${String(index)}:${text}`}>{text}</Body>)}</View> : null}
        {pending.length > 0 ? (
          <View aria-label="확인이 필요한 말" style={{ gap: 2 }}>
            <Body bold>확인이 필요한 말 (등록하지 않았어요)</Body>
            {pending.map((text, index) => <Hint key={`${String(index)}:${text}`}>{text}</Hint>)}
          </View>
        ) : null}
        {heard.length > 0 ? (
          <Tap role="button" aria-label={open ? '서버가 인식한 말 접기' : '서버가 인식한 말 펼치기'} aria-expanded={open} onPress={() => setOpen((now) => !now)}>
            <Txt step="caption" color="textSub">{open ? '인식한 말 접기' : `인식한 말 ${String(heard.length)}줄 펼치기`}</Txt>
          </Tap>
        ) : null}
        {open ? <Transcript lines={heard} /> : null}
        <BigButton small primary label="확인했어요" onPress={clear} />
      </View>
    </Card>
  )
}

/** 들린 말 창을 펼쳤을 때 지난 줄이 보이는 높이 (넘으면 채팅처럼 위로 밀어 올려 본다) */
export const HEARD_LOG_HEIGHT = 240
/** 펼치고 접는 움직임 (D-UX4-67, 사용자 지시 2026-11-10 "부드럽게 펼쳐줘") */
// 열고 닫는 시간: 240 → 160 (D-UX4-90, 사용자 지시 2026-11-10 "화면아래창 열고 닫히는 속도 좀 더 빠르게")
export const HEARD_OPEN_MS = 160

/**
 * 펼친 지난 말 칸이 지금 줄 위로 겹치는 만큼 (D-UX4-90, 사용자 지시 2026-11-10 "화면 아래창 위로 늘렸을 때 이전 채팅과 지금 채팅 사이 여백이 있어"):
 * 지금 줄은 누르는 줄(높이 44) 한가운데 — 글자(줄 높이 20) 위가 12 비어 있다. 지난 말끼리 사이 4만 남기고 8을 겹친다.
 */
/** 지금 줄(누르는 줄) 높이 */
export const DOCK_ROW_HEIGHT = 44
export const HEARD_OVERLAP = (DOCK_ROW_HEIGHT - 20) / 2 - SPACE.xs
/** 상태 칸 폭을 정하는 낱말들 — 가장 긴 상태 알약 폭으로 고정해, 지금 말·지난 말 글이 모두 같은 세로줄에서 시작한다 */
const DOCK_WORDS = [DOCK_STATE.on, DOCK_STATE.reconnecting, DOCK_STATE.lost] as const

const toTwo = (n: number): string => String(n).padStart(2, '0')
/** 들린 시각 "21:07:33" (한국 시각) — 지난 말 왼쪽 칸 */
export function heardTime(at: number): string {
  const kst = new Date(at + 9 * 3600_000)
  return `${toTwo(kst.getUTCHours())}:${toTwo(kst.getUTCMinutes())}:${toTwo(kst.getUTCSeconds())}`
}

/** 펼침 0 → 1. 시험·웹은 바로 */
export function useOpenMotion(open: boolean): { readonly value: Animated.Value; readonly shown: boolean } {
  const value = useRef(new Animated.Value(open ? 1 : 0)).current
  const [shown, setShown] = useState(open)
  useEffect(() => {
    if (Platform.OS === 'web') {
      value.setValue(open ? 1 : 0)
      setShown(open)
      return
    }
    if (open) setShown(true)
    const run = Animated.timing(value, { toValue: open ? 1 : 0, duration: HEARD_OPEN_MS, easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic), useNativeDriver: false })
    run.start(({ finished }) => {
      if (finished && !open) setShown(false)
    })
    return () => run.stop()
  }, [open, value])
  return { value, shown: Platform.OS === 'web' ? open : shown }
}

/**
 * 들린 말 창 (D-LIVETEST-07 → D-UX4-53 → D-UX4-67): 방송 화면 맨 아래에 붙는다.
 * 왼쪽에 듣기 상태 알약(듣는 중 초록 · 재연결 중 주황 · 연결 끊김 빨강), 가운데 지금 들리는 말 한 줄, 오른쪽 ⌃.
 * 누르면 높이가 부드럽게 늘며 위로 펼쳐져 지난 들린 말이 채팅처럼 쌓여 보인다(새 줄이 아래). 지난 말 왼쪽은 들린 시각 —
 * 시각 칸과 상태 칸은 같은 폭이라 지난 말·지금 말이 모두 같은 왼쪽 줄에서 시작한다. 지금 들리는 말은 아래 줄에만.
 * 글자 크기는 채팅·문자 탭 채팅과 같은 meta. 다시 켜기·휴대폰 마이크는 방송 관리 화면에 있다(D-UX3-73).
 */
export function ListenLine({ session, broadcastId, stream, bottom, source }: { readonly session: VoiceSession; readonly broadcastId: string; readonly stream: StreamAudio; readonly bottom: number; /** 지금 줄 오른쪽 끝의 작은 "소리 듣기" 표시 (D-RETRO-72) — 누르면 고르는 판 */ readonly source?: ReactNode }) {
  const { p } = useKit()
  const view = useSyncExternalStore(session.subscribe, session.getView)
  const [open, setOpen] = useState(false)
  const [column, setColumn] = useState<number | null>(null)
  const [logHeight, setLogHeight] = useState(0)
  const motion = useOpenMotion(open)
  const follow = useFollowScroll()
  const micOn = view.on && view.broadcastId === broadcastId
  // "앱을 닫은 동안 서버가 들었어요" 카드는 띄우지 않는다 (D-UX3-87, 사용자 지시 2026-11-09)
  const line = streamAudioLine(stream.status, micOn)
  const hearing = micOn || stream.hold
  const chip = listenChip(view, broadcastId, stream.status)
  // 긴 조각은 문장으로 나눠 지금 줄에는 마지막 문장만 (D-UX4-165, 사용자 "음성인식이 끊기지 않고 계속 이어지면 너무 긴 문장으로 보내지는데") —
  // 옛: 20초 조각 한 덩어리를 지금 줄에 다 보였다
  const sentences = splitHeard(view.transcript.flatMap((text, index) => [{ at: view.transcriptAt[index] ?? Number.NaN, text }]))
  const last = sentences.at(-1)?.text ?? null
  const earlier = sentences.slice(0, -1).map((line) => line.text)
  const times = sentences.slice(0, -1).map((line) => (Number.isNaN(line.at) ? undefined : line.at))
  const now = hearing ? (last ?? '아직 인식한 말이 없어요.') : (line?.text ?? '인식한 말이 여기에 나와요.')
  // 펼친 칸 높이: 안쪽 글 높이(최대 HEARD_LOG_HEIGHT)까지 0에서 늘린다. 재기 전(첫 그림)에는 바로 그 높이
  const target = Math.min(logHeight, HEARD_LOG_HEIGHT)
  const height = motion.value.interpolate({ inputRange: [0, 1], outputRange: [0, target] })
  // 지난 말과 지금 말 사이를 지난 말끼리 사이(4)와 같게 (D-UX4-90): 지금 줄은 누르는 줄(높이 44) 가운데라 위가 12 떠 있어 그만큼 겹친다
  // 지금 줄 글이 두 줄 넘게 길면 누르는 줄 위 여백이 없어 겹친다 — 그때는 겹치지 않는다 (D-UX4-165: "그랬죠."가 긴 지금 줄 위에 포개졌다)
  const [nowTall, setNowTall] = useState(false)
  const overlap = motion.value.interpolate({ inputRange: [0, 1], outputRange: [0, nowTall ? 0 : -HEARD_OVERLAP] })
  const lines = (
    <View role="log" aria-label="지난 인식한 말" style={{ gap: SPACE.xs }} onLayout={(event) => setLogHeight(event.nativeEvent.layout.height)}>
      {/* 지난 말이 없으면 비워 둔다 — 안내 문장을 띄우지 않는다 (D-UX4-69, 사용자 지시 2026-11-10) */}
      {earlier.map((text, index) => {
          const at = times[index]
          return (
            <View key={`${String(index)}:${text}`} testID="heard-row" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.sm }}>
              <View style={{ width: column ?? undefined, paddingLeft: SPACE.sm + 2, paddingTop: 1 }}>
                <Txt step="caption" color="textSub">{at === undefined ? '' : heardTime(at)}</Txt>
              </View>
              <View style={{ flex: 1 }}>
                <Txt step="meta" color="textSub">{text}</Txt>
              </View>
            </View>
          )
        })}
    </View>
  )
  const expandRow = (
      <Tap role="button" aria-label={open ? '음성 인식 접기' : '음성 인식 펼치기'} aria-expanded={open} onPress={() => { follow.reset(); setOpen((was) => !was) }} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, minHeight: DOCK_ROW_HEIGHT, paddingHorizontal: SPACE.xs, borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
        <View onLayout={(event) => setColumn(event.nativeEvent.layout.width)}>
          {/* 자리 재기: 가장 긴 상태 알약 폭 — 보이지도 읽히지도 않는다 */}
          {DOCK_WORDS.map((word) => (
            <View key={word} aria-hidden importantForAccessibility="no-hide-descendants" style={{ height: 0, overflow: 'hidden', opacity: 0 }}>
              <StillPill word={word} />
            </View>
          ))}
          <View style={{ flexDirection: 'row' }}>
            <DotStatus word={chip.word} tone={chip.tone} />
          </View>
        </View>
        <View role="status" aria-label="지금 인식한 말" style={{ flex: 1 }} onLayout={(event) => setNowTall(event.nativeEvent.layout.height > DOCK_ROW_HEIGHT - 2 * HEARD_OVERLAP)}>
          <Txt step="meta" weight={hearing && last !== null ? 'medium' : undefined} {...(open ? {} : { numberOfLines: 1 })} color={hearing && last !== null ? undefined : 'textSub'}>
            {now}
          </Txt>
        </View>
        {/* 아래에 붙은 창이라 위로 펼친다 — 닫혀 있으면 ⌃, 펼쳤으면 ⌄ */}
        <Icon name={open ? 'down' : 'up'} size={16} color={p.textSub} />
      </Tap>
  )
  // 소리 듣기 표시는 펼치는 줄 옆 형제로 둔다 — 누르는 칸 안에 누르는 칸을 넣지 않는다 (D-RETRO-72)
  const currentRow = source === undefined || source === null ? expandRow : (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.xs }}>
      <View style={{ flex: 1 }}>{expandRow}</View>
      {source}
    </View>
  )
  return (
    <View role="region" aria-label="음성 인식 창" style={{ backgroundColor: p.surface, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, borderCurve: 'continuous', paddingHorizontal: SPACE.md, paddingTop: SPACE.sm, paddingBottom: bottom, shadowColor: '#000000', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: -2 }, elevation: 8 }}>
      {motion.shown ? (
        <Animated.View testID="heard-log-box" style={{ height: Platform.OS === 'web' ? undefined : height, marginBottom: overlap, opacity: motion.value, overflow: 'hidden', paddingHorizontal: SPACE.xs }}>
          <ScrollView ref={follow.scroll} style={{ maxHeight: HEARD_LOG_HEIGHT }} scrollEventThrottle={16}
            onScrollBeginDrag={follow.begin} onScroll={follow.track} onScrollEndDrag={follow.end} onContentSizeChange={follow.contentChanged}>
            {lines}
          </ScrollView>
        </Animated.View>
      ) : null}
      {open && line?.late != null ? <Txt step="caption" color="textSub">{line.late}</Txt> : null}
      {open ? <ScrollView style={{ maxHeight: HEARD_LOG_HEIGHT, flexGrow: 0 }} bounces={false} keyboardShouldPersistTaps="handled">{currentRow}</ScrollView> : currentRow}
    </View>
  )
}

/** 폭 재기용 상태 알약 (DotStatus와 같은 치수, 움직임·읽기 없음) */
function StillPill({ word }: { readonly word: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: SPACE.sm + 2, paddingVertical: 5, marginRight: SPACE.xs }}>
      <View style={{ width: 9, height: 9 }} />
      <Txt step="caption" weight="bold">{word}</Txt>
    </View>
  )
}

/** 들린 말 탭 (D-UX4-91, 사용자 지시 2026-11-10 "음성인식도 새 탭으로 만들어서 보여주도록 해") */
export const HEARD_TAB = '음성 인식'
export const HEARD_EMPTY = '아직 인식한 말이 없어요'
export const HEARD_EMPTY_BODY = '음성 인식을 시작하면\n인식한 말이 여기에 나와요'
/** 끝난 라이브에 남은 인식한 말이 없을 때 (D-UX4-156) */
export const HEARD_EMPTY_ENDED = '인식한 말이 없어요'
export const HEARD_EMPTY_ENDED_BODY = '음성 인식을 켠 라이브는\n인식한 말이 여기에 남아요'

/**
 * 들린 말 탭: 이 방송에서 알아들은 말 전부를 채팅·문자 탭처럼 — 왼쪽 들린 시각(폭 고정 칸, 한국 시각 21:07:33), 오른쪽 말. 새 말이 맨 아래.
 * 화면 아래 창이 "들린 말"이면 같은 것이 겹쳐 보여 이 탭은 숨긴다(방송 화면이 정한다).
 */
export function HeardTab({ session, broadcastId, live }: { readonly session: VoiceSession; readonly broadcastId: string; /** 라이브 중이면 서버 기록을 가끔 다시 받는다 · 끝났으면 한 번만 */ readonly live: boolean }) {
  const view = useSyncExternalStore(session.subscribe, session.getView)
  // 서버가 남긴 그 방송의 들린 말 + 이 기기가 지금 받는 줄 — 끝난 라이브·앱을 다시 켠 뒤에도 전체가 보인다 (D-UX4-156)
  const saved = useSavedHeard(broadcastId, live)
  // 긴 조각은 문장으로 나눠 한 줄씩 (D-UX4-165)
  const lines = splitHeard(mergeHeard(saved.lines, localHeard(view, broadcastId)))
  const [timeWidth, setTimeWidth] = useState(0)
  const onTimeWidth = useCallback((width: number) => setTimeWidth((was) => Math.max(was, Math.ceil(width))), [])
  if (lines.length === 0) return saved.loaded ? (live ? <EmptyFill title={HEARD_EMPTY} body={HEARD_EMPTY_BODY} /> : <EmptyFill title={HEARD_EMPTY_ENDED} body={HEARD_EMPTY_ENDED_BODY} />) : null
  return (
    <View role="list" aria-label={HEARD_TAB} style={{ gap: SPACE.xs }}>
      {lines.map(({ at, text }, index) => {
        return (
          <View key={`${String(index)}:${text}`} role="listitem" testID="heard-tab-row" style={{ flexDirection: 'row', alignItems: 'flex-start', columnGap: SPACE.sm, paddingVertical: 2 }}>
            <View style={{ minWidth: timeWidth }}>
              <View style={{ alignSelf: 'flex-start' }} onLayout={(event) => onTimeWidth(event.nativeEvent.layout.width)}>
                <Txt step="meta" color="textSub">{heardTime(at)}</Txt>
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Txt step="meta">{text}</Txt>
            </View>
          </View>
        )
      })}
    </View>
  )
}
