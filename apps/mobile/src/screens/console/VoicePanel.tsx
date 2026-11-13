// 음성 (VOC-06 기기 쪽, APP-02, D-APP-05·08, D-UX2-03): 방송 중 화면에는 "확인할 것"만 — 처음 켤 때 안내 창, 듣기 멈춤 큰 빨간 글 + [다시 켜기],
// 문제 문장, 지금 들리는 말 한 줄, 확인할 카드(서버 카드·묻기·문자찜 포함). 켜고 끄기는 화면 아래 고정 버튼(ListenButton),
// 음성 설정과 기록은 방송 메뉴(VoiceSettingsSheet)로 옮겼다.
import { useEffect, useSyncExternalStore } from 'react'
import { View } from 'react-native'
import type { ListenSourceStore } from '../../lib/listen-source.ts'
import type { VoiceSession } from '../../lib/voice-session.ts'
import { RemoteVoicePanel, VoiceSettings } from './RemoteVoicePanel.tsx'
import {
  LISTEN_START,
  LISTEN_STATE,
  LISTEN_STOP,
  VOICE_CONSENT_LINES,
  VOICE_RETRY,
  VOICE_SENT_LINE,
  VOICE_STOPPED_TITLE,
} from '../../lib/words.ts'
import { DotStatus, TodoRow } from '../../ui/kit/index.ts'
import { SPACE } from '../../ui/kit/tokens.ts'
import { BigButton, BigRed, Body, Card, Hint, Notice, Row } from '../../ui/parts.tsx'

type ListenTone = 'on' | 'off' | 'warn'

/** 머리 오른쪽 음성 상태 낱말 (실제 상태 값에서) */
export function listenState(view: ReturnType<VoiceSession['getView']>, broadcastId: string): { readonly word: string; readonly tone: ListenTone } {
  const mine = view.broadcastId === broadcastId
  if (view.state.kind === 'stopped' && mine) return { word: LISTEN_STATE.stopped, tone: 'warn' }
  if (!view.on || !mine) return { word: LISTEN_STATE.off, tone: 'off' }
  if (view.state.kind === 'reconnecting') return { word: LISTEN_STATE.reconnecting, tone: 'warn' }
  if (view.state.kind === 'starting') return { word: LISTEN_STATE.starting, tone: 'off' }
  return { word: LISTEN_STATE.on, tone: 'on' }
}

export function ListenStatus({ session, broadcastId }: { readonly session: VoiceSession; readonly broadcastId: string }) {
  const view = useSyncExternalStore(session.subscribe, session.getView)
  const state = listenState(view, broadcastId)
  return <DotStatus word={state.word} tone={state.tone} />
}

/** 방송 메뉴 한 줄: 휴대폰 마이크로 듣기 / 끄기 (D-UX3-73 — 아래 고정 단추에서 옮김). 누르면 메뉴를 닫고(onDone) 켜거나 끈다 */
export function ListenMenuRow({ session, broadcastId, title, onDone }: { readonly session: VoiceSession; readonly broadcastId: string; readonly title: string; readonly onDone: () => void }) {
  const view = useSyncExternalStore(session.subscribe, session.getView)
  const on = view.on && view.broadcastId === broadcastId
  return (
    <TodoRow
      title={on ? LISTEN_STOP : LISTEN_START}
      sub={on ? '라이브 소리로 다시 음성 인식해요' : '라이브 소리 대신 이 휴대폰 마이크로'}
      testID="listen-button"
      onPress={() => {
        onDone()
        void (on ? session.turnOff() : session.turnOn(broadcastId, title))
      }}
    />
  )
}

/** listen: 고른 듣는 곳 (D-RETRO-70) — "라이브 소리"를 골랐으면 방송 화면을 열어도 휴대폰 마이크를 저절로 켜지 않는다. 없거나 서버 값을 모르면 예전 그대로 켠다 */
export function VoicePanel({ session, broadcastId, title, seller, ended, listen }: { readonly session: VoiceSession; readonly broadcastId: string; readonly title: string; readonly seller: boolean; readonly ended: boolean; readonly listen?: ListenSourceStore }) {
  const view = useSyncExternalStore(session.subscribe, session.getView)
  useEffect(() => {
    if (!seller || ended) return
    if (listen === undefined) { void session.resumeIfConsented(broadcastId, title); return }
    let stop = false
    void listen.known().then((setting) => { if (!stop && setting?.source !== 'stream') void session.resumeIfConsented(broadcastId, title) })
    return () => { stop = true }
  }, [session, seller, ended, broadcastId, title, listen])
  if (!seller) return null
  const mine = view.broadcastId === broadcastId
  const stopped = view.state.kind === 'stopped' && mine

  return (
    <View aria-label="음성" role="region" style={{ gap: SPACE.sm }}>
      {view.askConsent ? (
        <Card label="음성 안내">
          <View role="dialog" aria-label="음성 안내" style={{ gap: 8 }}>
            {VOICE_CONSENT_LINES.map((line) => (
              <Body key={line}>{line}</Body>
            ))}
            <Row wrap>
              <BigButton label="알겠어요, 켤게요" primary onPress={() => void session.acceptConsent()} />
              <BigButton label="안 켤래요" onPress={() => session.declineConsent()} />
            </Row>
          </View>
        </Card>
      ) : null}
      {stopped ? (
        <>
          <BigRed title={VOICE_STOPPED_TITLE} body={view.state.kind === 'stopped' ? view.state.message : ''} />
          <BigButton label={VOICE_RETRY} primary onPress={() => void session.retry()} />
        </>
      ) : null}
      {view.problem !== null && !stopped ? <Notice tone="danger" alert>{view.problem}</Notice> : null}
      {/* 바로 등록 뒤 "N번 등록 되돌리기"는 띄우지 않는다 — 고치거나 지울 것은 상품에서 직접 (D-UX4-70) */}
      {mine && view.remote !== null ? <RemoteVoicePanel session={session} snapshot={view.remote} display={view.display} /> : null}
      {/* 확인 카드(등록할까요?·고칠까요?)는 띄우지 않는다 — 상품 목록에서 직접 (D-UX4-92) */}
    </View>
  )
}

/** 방송 메뉴 → 음성 설정: 보내지는 곳 안내, 서버 음성 설정·기록, 이 기기 최근 기록 */
export function VoiceSettingsPanel({ session, broadcastId }: { readonly session: VoiceSession; readonly broadcastId: string }) {
  const view = useSyncExternalStore(session.subscribe, session.getView)
  const mine = view.broadcastId === broadcastId
  return (
    <View style={{ gap: SPACE.md }}>
      <Hint>{VOICE_SENT_LINE}</Hint>
      {mine && view.remote !== null ? <VoiceSettings session={session} snapshot={view.remote} display={view.display} /> : <Body muted>음성 인식을 켜면 음성 설정을 바꿀 수 있어요.</Body>}
      {view.log.length > 0 ? (
        <View aria-label="음성 기록" style={{ gap: 2 }}>
          {view.log.slice(0, 5).map((line, index) => (
            <Hint key={`${String(index)}-${line}`}>{line}</Hint>
          ))}
        </View>
      ) : null}
    </View>
  )
}
