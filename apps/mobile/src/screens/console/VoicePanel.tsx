// 음성 (VOC-06 기기 쪽, APP-02, D-APP-05·08, D-UX2-03): 방송 중 화면에는 "확인할 것"만 — 처음 켤 때 안내 창, 듣기 멈춤 큰 빨간 글 + [다시 켜기],
// 문제 문장, 지금 들리는 말 한 줄, 바로 등록 되돌리기, 확인할 카드(서버 카드·묻기·문자찜 포함). 켜고 끄기는 화면 아래 고정 버튼(ListenButton),
// 음성 설정과 기록은 방송 메뉴(VoiceSettingsSheet)로 옮겼다.
import { useEffect, useSyncExternalStore } from 'react'
import { View } from 'react-native'
import type { VoiceSession } from '../../lib/voice-session.ts'
import { RemoteVoicePanel, VoiceSettings } from './RemoteVoicePanel.tsx'
import {
  LISTEN_START,
  LISTEN_STATE,
  LISTEN_STOP,
  VOICE_CARD_DISMISS,
  VOICE_CARD_REGISTER,
  VOICE_CONSENT_LINES,
  VOICE_LATE_NOTE,
  VOICE_RETRY,
  VOICE_SENT_LINE,
  VOICE_STOPPED_TITLE,
  UNDO,
} from '../../lib/words.ts'
import { BigButton as KitButton, DotStatus, Icon, useKit } from '../../ui/kit/index.ts'
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

/** 아래 고정 큰 버튼: 듣기 멈추기 / 듣기 시작 */
export function ListenButton({ session, broadcastId, title }: { readonly session: VoiceSession; readonly broadcastId: string; readonly title: string }) {
  const { p } = useKit()
  const view = useSyncExternalStore(session.subscribe, session.getView)
  const on = view.on && view.broadcastId === broadcastId
  return (
    <View style={{ flex: 1 }}>
      <KitButton label={on ? LISTEN_STOP : LISTEN_START} leading={<Icon name="mic" color={p.onPrimary} size={22} />} onPress={() => void (on ? session.turnOff() : session.turnOn(broadcastId, title))} testID="listen-button" />
    </View>
  )
}

export function VoicePanel({ session, broadcastId, title, seller, ended }: { readonly session: VoiceSession; readonly broadcastId: string; readonly title: string; readonly seller: boolean; readonly ended: boolean }) {
  const view = useSyncExternalStore(session.subscribe, session.getView)
  useEffect(() => { if (seller && !ended) void session.resumeIfConsented(broadcastId, title) }, [session, seller, ended, broadcastId, title])
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
      {mine && view.undo !== null ? (
        <Row>
          <BigButton small label={`${String(view.undo.no)}번 등록 ${UNDO}`} onPress={() => void session.undo()} />
        </Row>
      ) : null}
      {mine && view.remote !== null ? <RemoteVoicePanel session={session} snapshot={view.remote} display={view.display} /> : null}
      {view.cards.length > 0 ? (
        <View role="list" aria-label="확인할 카드" style={{ gap: 8 }}>
          {view.cards.map((card) => (
            <Card key={card.id} label={`카드 ${String(card.id)}`}>
              <Body bold>{card.reading?.readout ?? card.text}</Body>
              {card.reading !== null && card.reading.readout !== card.text ? <Hint>{`들린 말: ${card.text}`}</Hint> : null}
              {card.late ? <Hint>{VOICE_LATE_NOTE}</Hint> : null}
              <Row>
                {card.reading !== null && card.reading.no !== null && card.reading.price !== null ? <BigButton small primary label={VOICE_CARD_REGISTER} ariaLabel={`${VOICE_CARD_REGISTER} — 카드 ${String(card.id)}`} onPress={() => void session.registerCard(card.id)} /> : null}
                <BigButton small label={VOICE_CARD_DISMISS} ariaLabel={`${VOICE_CARD_DISMISS} — 카드 ${String(card.id)}`} onPress={() => session.dismissCard(card.id)} />
              </Row>
            </Card>
          ))}
        </View>
      ) : null}
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
      {mine && view.remote !== null ? <VoiceSettings session={session} snapshot={view.remote} display={view.display} /> : <Body muted>듣기를 켜면 음성 설정을 바꿀 수 있어요.</Body>}
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
