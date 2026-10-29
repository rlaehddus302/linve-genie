// 음성 칸 (VOC-06 기기 쪽, APP-02, D-APP-05·08): 켜기/끄기, 듣는 중·다시 잇는 중, 큰 글자 "지금 들리는 말", 카드([등록]·[아니요]), 바로 등록 되돌리기,
// 듣기 멈춤 큰 빨간 글 + [다시 켜기], 처음 켤 때 안내 창. 상태는 색 + 글자. 판매자 계정만 켤 수 있다(보조자는 음성 없음).
import { useSyncExternalStore } from 'react'
import { View } from 'react-native'
import type { VoiceSession } from '../../lib/voice-session.ts'
import { isFakeAudio, nativeAudio } from '../../native/index.ts'
import { FakeNativeAudio } from '../../native/audio.ts'
import {
  VOICE_CARD_DISMISS,
  VOICE_CARD_REGISTER,
  VOICE_CONSENT_LINES,
  VOICE_HEARD_EMPTY,
  VOICE_HEARD_TITLE,
  VOICE_HEARING,
  VOICE_LATE_NOTE,
  VOICE_LISTENING,
  VOICE_OFF,
  VOICE_ON,
  VOICE_RECONNECTING,
  VOICE_RETRY,
  VOICE_SELLER_ONLY,
  VOICE_SENT_LINE,
  VOICE_STOPPED_TITLE,
  UNDO,
} from '../../lib/words.ts'
import { BigButton, BigRed, Body, Card, Hint, Notice, Row, SectionTitle, Tag } from '../../ui/parts.tsx'

export function VoicePanel({ session, broadcastId, title, seller, ended }: { readonly session: VoiceSession; readonly broadcastId: string; readonly title: string; readonly seller: boolean; readonly ended: boolean }) {
  const view = useSyncExternalStore(session.subscribe, session.getView)
  if (!seller) return <Hint>{VOICE_SELLER_ONLY}</Hint>
  const mine = view.broadcastId === broadcastId
  const on = view.on && mine
  const stopped = view.state.kind === 'stopped' && mine

  return (
    <Card label="음성">
      <SectionTitle>음성</SectionTitle>
      {view.askConsent ? (
        <View role="dialog" aria-label="음성 안내" style={{ gap: 8 }}>
          {VOICE_CONSENT_LINES.map((line) => (
            <Body key={line}>{line}</Body>
          ))}
          <Row>
            <BigButton label="알겠어요, 켤게요" primary onPress={() => void session.acceptConsent()} />
            <BigButton label="안 켤래요" onPress={() => session.declineConsent()} />
          </Row>
        </View>
      ) : null}
      {stopped ? (
        <>
          <BigRed title={VOICE_STOPPED_TITLE} body={view.state.kind === 'stopped' ? view.state.message : ''} />
          <BigButton label={VOICE_RETRY} primary onPress={() => void session.retry()} />
        </>
      ) : null}
      {view.problem !== null && !stopped ? <Notice tone="danger" alert>{view.problem}</Notice> : null}
      {!on && !stopped && !view.askConsent ? (
        ended ? <Hint>끝난 방송이에요. 음성은 진행 중인 방송에서만 켤 수 있어요.</Hint> : <BigButton label={VOICE_ON} primary onPress={() => void session.turnOn(broadcastId, title)} />
      ) : null}
      {on ? (
        <>
          <Row wrap>
            {view.state.kind === 'reconnecting' ? (
              <Tag tone="warning">{`${VOICE_RECONNECTING} (${String(view.state.attempt)}번째)`}</Tag>
            ) : view.state.kind === 'starting' ? (
              <Tag tone="info">켜는 중…</Tag>
            ) : (
              <Tag tone="success">{VOICE_LISTENING}</Tag>
            )}
            <Hint>{VOICE_SENT_LINE}</Hint>
          </Row>
          <View aria-label={VOICE_HEARD_TITLE} role="status" style={{ gap: 4 }}>
            <Hint>{VOICE_HEARD_TITLE}</Hint>
            <Body big bold>{view.heard ?? (view.state.kind === 'listening' ? VOICE_HEARING : VOICE_HEARD_EMPTY)}</Body>
          </View>
          <Row wrap>
            <BigButton label={VOICE_OFF} onPress={() => void session.turnOff()} />
            {view.undo !== null ? <BigButton label={`${String(view.undo.no)}번 등록 ${UNDO}`} onPress={() => void session.undo()} /> : null}
            {isFakeAudio() ? (
              <BigButton
                small
                label="시험: '15번 2만 원' 들림"
                onPress={() => {
                  const audio = nativeAudio()
                  if (audio instanceof FakeNativeAudio) {
                    const now = Date.now()
                    audio.emit({ text: '15번 2만 원', startMs: now - 1500, endMs: now - 200, reading: { no: 15, name: '', price: 20000, instant: true, correction: false, readout: '15번 20,000원' } })
                  }
                }}
              />
            ) : null}
          </Row>
        </>
      ) : null}
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
      {view.log.length > 0 ? (
        <View aria-label="음성 기록" style={{ gap: 2 }}>
          {view.log.slice(0, 5).map((line, index) => (
            <Hint key={`${String(index)}-${line}`}>{line}</Hint>
          ))}
        </View>
      ) : null}
    </Card>
  )
}
