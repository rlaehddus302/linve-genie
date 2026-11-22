// 듣는 곳 화면 조각 (D-RETRO-70 → D-LISTEN-MIC-01, 사용자 지시 2026-11-23 "소리 듣기 없애. 그냥 무조건 폰 마이크로 듣는 걸로"):
// 고르기는 없앴다 — 늘 휴대폰 마이크로 듣고, 마이크가 꺼진 동안만 서버가 라이브 소리로 대신 듣는다(D-LV1-06).
// - ListenSourceSheet: 지금 듣는 곳 한 문장 · 필요한 단추([휴대폰 마이크 켜기] · [라이브 소리 다시 켜기]) · 처음 켤 때 안내.
// - ListenSourceChip: 방송 화면 음성 창의 작은 표시(지금 듣는 쪽) — 누르면 같은 판이 열린다.
// 고른 값은 서버의 판매자 설정에 남는다(lib/listen-source.ts). 마이크를 끄는 일(라이브 소리를 골랐을 때)은 앱 뿌리의 KeptRunner가 한다.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { View } from 'react-native'
import {
  LISTEN_CONSENT_NO, LISTEN_CONSENT_YES, LISTEN_MIC_START, LISTEN_SAVE_FAILED, LISTEN_SOURCE_DESCRIPTION, LISTEN_SOURCE_TITLE, LISTEN_STREAM_RETRY,
  listenNow, listenShort, type ListenMic, type ListenNow, type ListenSetting, type ListenSource, type ListenTone,
} from '../../lib/listen-source.ts'
import type { StreamKeep } from '../../lib/stream-keep.ts'
import type { VoiceSession, VoiceView } from '../../lib/voice-session.ts'
import { VOICE_CONSENT_LINES } from '../../lib/words.ts'
import { BigButton, BottomSheet, Tap, Txt, useKit } from '../../ui/kit/index.ts'
import { RADIUS, SPACE } from '../../ui/kit/tokens.ts'
import { Notice } from '../../ui/parts.tsx'
import type { StreamAudio } from './StreamAudio.tsx'

const NOTICE_TONE: Readonly<Record<ListenTone, 'success' | 'warning' | 'danger' | 'info'>> = { ok: 'success', warn: 'warning', danger: 'danger', info: 'info' }

/** 이 방송에서 본 이 휴대폰 마이크 */
export function listenMicOf(view: VoiceView, broadcastId: string, allowed: boolean | null = null): ListenMic {
  const mine = view.broadcastId === broadcastId
  return { on: view.on && mine, kind: mine ? view.state.kind : 'off', allowed }
}

export function useListenSetting(keep: StreamKeep): ListenSetting | null {
  return useSyncExternalStore(keep.listen.subscribe, keep.listen.get, keep.listen.get)
}

interface ListenProps {
  readonly session: VoiceSession
  readonly keep: StreamKeep
  readonly broadcastId: string
  readonly stream: StreamAudio
}

/** 고른 것과 지금 실제로 듣는 쪽·상태 */
function useListenNow({ session, keep, broadcastId, stream }: ListenProps, allowed: boolean | null = null): { readonly setting: ListenSetting | null; readonly view: VoiceView; readonly mic: ListenMic; readonly now: ListenNow } {
  const view = useSyncExternalStore(session.subscribe, session.getView, session.getView)
  const setting = useListenSetting(keep)
  const mic = listenMicOf(view, broadcastId, allowed)
  return { setting, view, mic, now: listenNow(setting?.source ?? null, mic, stream.status) }
}

/** 듣는 곳 판: 지금 상태와 [휴대폰 마이크 켜기] (고르기 없음 — D-LISTEN-MIC-01) */
export function ListenSourceSheet(props: ListenProps & { readonly visible: boolean; readonly onClose: () => void; readonly title: string }) {
  const { visible, onClose, session, keep, broadcastId, title, stream } = props
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { setting, view, mic, now } = useListenNow(props, allowed)
  // 판을 열 때·마이크가 켜지고 꺼질 때: 서버 값과 마이크 권한을 다시 읽는다
  useEffect(() => {
    if (!visible) return
    let stop = false
    void keep.listen.refresh()
    void session.micAllowed().then((next) => { if (!stop) setAllowed(next) })
    return () => { stop = true }
  }, [visible, keep, session, mic.on, mic.kind])
  useEffect(() => { if (!visible) setError(null) }, [visible])

  const pick = async (next: ListenSource) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const before = keep.listen.get()
      if (before?.source !== next) await keep.listen.choose(next)
      // 휴대폰 마이크를 골랐으면 바로 켠다(처음이면 안내를 먼저 보인다). 라이브 소리를 골랐으면 마이크는 앱 뿌리가 끈다
      if (next === 'mic' && !mic.on) await session.turnOn(broadcastId, title)
      // 라이브 소리 듣기가 꺼져 있다가 방금 같이 켜졌으면(D-RETRO-71) 다음 알림(10초)을 기다리지 않고 바로 듣게 한다
      if (next === 'stream' && before?.streamEnabled === false) stream.retry()
    } catch (caught) {
      setError(caught instanceof Error && caught.message !== '' ? caught.message : LISTEN_SAVE_FAILED)
    } finally {
      setBusy(false)
    }
  }

  // 처음 켤 때의 안내 (D-APP-08) — 방송 화면의 안내 카드와 같은 글, 이 판 안에서 바로 대답한다. 단추는 부정 왼쪽·긍정 오른쪽
  const consent = view.askConsent
  const mine = view.broadcastId === broadcastId
  const micProblem = setting?.source !== 'mic' || mic.on ? null : mine && view.state.kind === 'stopped' ? view.state.message : view.problem
  const actions = consent ? (
    <>
      <BigButton kind="outline" label={LISTEN_CONSENT_NO} onPress={() => session.declineConsent()} />
      <BigButton label={LISTEN_CONSENT_YES} onPress={() => void session.acceptConsent()} />
    </>
  ) : now.canRetry || now.canMic ? (
    <>
      {now.canRetry ? <BigButton kind="outline" label={LISTEN_STREAM_RETRY} onPress={stream.retry} /> : null}
      {now.canMic ? <BigButton label={LISTEN_MIC_START} busy={busy} onPress={() => void pick('mic')} /> : null}
    </>
  ) : undefined

  return (
    <BottomSheet visible={visible} onClose={onClose} title={LISTEN_SOURCE_TITLE} description={LISTEN_SOURCE_DESCRIPTION} actions={actions} testID="listen-source-sheet">
      {consent ? (
        <View role="group" aria-label="음성 안내" style={{ gap: SPACE.sm }}>
          {VOICE_CONSENT_LINES.map((line) => <Txt key={line} step="body">{line}</Txt>)}
        </View>
      ) : (
        <>
          <Notice tone={NOTICE_TONE[now.tone]} label="지금 듣는 곳">{now.text}</Notice>
          {now.late === null ? null : <Txt step="meta" color="textSub">{now.late}</Txt>}
          {micProblem === null || micProblem === '' ? null : <Notice tone="danger" label="휴대폰 마이크 문제">{micProblem}</Notice>}
          {error === null ? null : <Notice tone="danger" alert>{error}</Notice>}
        </>
      )}
    </BottomSheet>
  )
}

/** 방송 화면 음성 창의 작은 표시: 지금 듣는 쪽 낱말 — 누르면 고르는 판 */
export function ListenSourceChip(props: ListenProps & { readonly onPress: () => void }) {
  const { p } = useKit()
  const { setting, now } = useListenNow(props)
  const word = listenShort(setting?.source ?? null, now)
  if (word === null) return null
  return (
    <Tap role="button" aria-label={`${LISTEN_SOURCE_TITLE} · ${now.text}`} testID="listen-source-chip" onPress={props.onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 32, paddingHorizontal: SPACE.sm + 2, borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : p.soft })}>
      <Txt step="caption" weight="bold" color="textSub">{`${word} ›`}</Txt>
    </Tap>
  )
}
