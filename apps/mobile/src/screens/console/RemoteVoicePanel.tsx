// 서버가 보낸 카드·묻기·주문 상태의 화면. 인식문 해석·판매 판정은 여기서 하지 않는다.
// 확인 카드는 작게 (D-UX3-90, 사용자 지시 2026-11-09 "수정이나 선택을 요구하는 요소가 너무 화면을 많이 차지한다"):
// 머리 한 줄(제목 + 오른쪽 작은 ✕ 닫기) · 안내는 작은 글 한 줄 · 고르기·등록·고치기는 옆으로 놓는 작은 알약 — 옛 화면 폭 큰 단추 여러 개·아래 [닫기] 줄.
import { useContext, useEffect, type ReactNode } from 'react'
import { View } from 'react-native'
import type { VoiceSnapshot } from '@livejjim/web/src/voice/model.ts'
import type { VoiceSession } from '../../lib/voice-session.ts'
import { BigButton, Body, Card, Field, Hint, Notice, Row } from '../../ui/parts.tsx'
import { Icon, Tap, Txt, useKit } from '../../ui/kit/index.ts'
import { RADIUS, SPACE } from '../../ui/kit/tokens.ts'
import { VoiceSmsResult } from './VoiceSmsResult.tsx'
import { ConsoleContext } from './context.ts'

function words(display: Readonly<Record<string, unknown>>, name: string, id: string, fallback: string): string {
  const map = display[name]
  return map instanceof Map && typeof map.get(id) === 'string' ? map.get(id) as string : fallback
}
/** 작은 확인 카드: 제목 한 줄 + 오른쪽 ✕(닫기), 그 아래 내용 (D-UX3-90) */
function VoiceCard({ label, title, onClose, closeLabel = '닫기', children }: { readonly label: string; readonly title: string; readonly onClose?: () => void; readonly closeLabel?: string; readonly children?: ReactNode }) {
  const { p } = useKit()
  return (
    <View role="group" aria-label={label} style={{ paddingVertical: SPACE.sm + 2, paddingLeft: SPACE.md + 2, paddingRight: SPACE.xs, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: p.surface, gap: SPACE.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.xs }}>
        <View style={{ flex: 1 }}>
          <Txt step="body" weight="bold">{title}</Txt>
        </View>
        {onClose === undefined ? null : (
          <Tap role="button" aria-label={closeLabel} onPress={onClose} hitSlop={8} style={({ pressed }) => ({ width: 32, height: 32, borderRadius: 16, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? p.pressed : 'transparent' })}>
            <View style={{ transform: [{ rotate: '45deg' }] }}>
              <Icon name="plus" color={p.textSub} size={20} />
            </View>
          </Tap>
        )}
      </View>
      <View style={{ gap: SPACE.sm, paddingRight: SPACE.md }}>{children}</View>
    </View>
  )
}

/** 작은 알약 단추 (고르기·등록·고치기) — 옆으로 놓는다 (D-UX3-90) */
function Chip({ label, onPress, primary, ariaLabel }: { readonly label: string; readonly onPress: () => void; readonly primary?: boolean; readonly ariaLabel?: string }) {
  const { p } = useKit()
  return (
    <Tap role="button" aria-label={ariaLabel ?? label} onPress={onPress} hitSlop={6} style={({ pressed }) => ({ minHeight: 34, paddingHorizontal: SPACE.md + 2, borderRadius: RADIUS.pill, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: primary === true ? (pressed ? p.primaryPressed : p.primary) : pressed ? p.pressed : p.secondary })}>
      <Txt step="body" weight="medium" color={primary === true ? 'onPrimary' : 'onSecondary'}>{label}</Txt>
    </Tap>
  )
}

/** 알약 줄 (넘치면 다음 줄) */
function Chips({ children }: { readonly children: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs + 2 }}>{children}</View>
}

/** 안내 한 줄 (작은 글) */
function Note({ children, tone = 'info' }: { readonly children: string; readonly tone?: 'info' | 'warning' | 'danger' }) {
  const { tones } = useKit()
  return <Txt step="caption" ink={tones[tone].fg}>{children}</Txt>
}

/** 보일 고침 카드: 묻기(고치기·번호)와 실패 안내만 — 되돌리기 창은 띄우지 않는다 (D-UX4-70) */
export function offerShown(offer: VoiceSnapshot['offers'][number]): boolean {
  if (offer.kind === 'undo' || offer.kind === 'late') return false
  if (offer.stage === 'fixed') return offer.error !== null
  return true
}

export function RemoteVoicePanel({ session, snapshot, display }: { readonly session: VoiceSession; readonly snapshot: VoiceSnapshot; readonly display: Readonly<Record<string, unknown>> }) {
  const api = useContext(ConsoleContext)
  const view = session.getView()
  const counting = view.on && view.state.kind === 'listening'
  useEffect(() => {
    if (view.openProduct !== null && api !== null) { api.select(view.openProduct); session.clearProduct() }
  }, [view.openProduct, api, session])
  const command = session.command.bind(session)
  return <View style={{ gap: 10 }}>
    {snapshot.historyFailed ? <Notice tone="warning">판매 이력을 받지 못했어요. 상품을 확인하고 등록해 주세요.</Notice> : null}
    {snapshot.flushedClosed.length > 0 ? <Card label="닫힌 카드 안내"><Body>{`확인하지 않은 카드가 닫혔어요: ${snapshot.flushedClosed.join(', ')}`}</Body><BigButton label="확인" onPress={() => command('dismissFlushedClosed')} /></Card> : null}
    {snapshot.missedFolded > 0 ? <Hint>{`가격을 못 들은 번호 ${String(snapshot.missedFolded)}개가 접혀 있어요. 상품 목록에서 확인해 주세요.`}</Hint> : null}
    {view.priceChoice !== null ? <VoiceCard label="가격 적용 범위" title={`${String(view.priceChoice.no)}번을 ${view.priceChoice.price.toLocaleString('ko-KR')}원으로 바꿀까요?`} onClose={() => session.resolvePriceScope(null)} closeLabel="안 바꾸기">
      <Hint>이미 찜한 손님이 있어요. 새 가격을 적용할 찜을 골라 주세요.</Hint>
      <Chips>
        <Chip primary label="새 찜부터 적용" onPress={() => session.resolvePriceScope('NEW_ONLY')} />
        <Chip label="입금 전 찜에도 적용" onPress={() => session.resolvePriceScope('UNPAID_CLAIMS')} />
      </Chips>
    </VoiceCard> : null}
    {view.manualRetries.map((item) => <Card key={item.id} label="등록 재전송"><Body>{item.label}</Body>{item.error ? <Notice tone="danger">{item.error}</Notice> : null}{item.busy ? <Hint>보내는 중…</Hint> : <BigButton label="등록 다시 보내기" onPress={() => void session.retryManualRegistration(item.id)} />}</Card>)}
    {snapshot.cards.map((card) => {
      const form = snapshot.forms.get(card.id)
      const info = snapshot.info.get(card.id)
      const note = snapshot.notes.get(card.id)
      return <VoiceCard key={card.id} label={`음성 카드 ${card.id}`} title={words(display, 'cards', card.id, card.text)} onClose={() => command('close', [card.id])}>
        {note ? <Note>{note}</Note> : null}
        {info?.ask ? <Hint>{info.ask}</Hint> : null}
        {card.flushedAtEnd ? <Hint>늦게 들린 말이에요. 확인하고 등록해 주세요.</Hint> : null}
        {counting && snapshot.paused.has(card.id) ? <Hint>말하는 동안은 기다려요</Hint> : counting && card.autoConfirmAt !== null ? <Hint>{`${Math.max(0, Math.ceil((card.autoConfirmAt - snapshot.now) / 1000))}초 뒤 등록`}</Hint> : null}
        {info !== undefined && info.candidates.length > 0 ? <Chips>{info.candidates.map((candidate) => <Chip key={candidate.name} label={candidate.name} onPress={() => command('chooseCandidate', [card.id, candidate.name])} />)}</Chips> : null}
        {form ? <>
          <Field label="상품 번호" keyboardType="number-pad" value={form.no} onChangeText={(no) => command('editForm', [card.id, { no }])} />
          <Field label="품종" value={form.name} onChangeText={(name) => command('editForm', [card.id, { name }])} />
          <Field label="가격" keyboardType="decimal-pad" value={form.price} onChangeText={(price) => command('editForm', [card.id, { price }])} />
          {form.message ? <Notice tone="danger" alert>{form.message}</Notice> : null}
          <BigButton primary label="고친 값으로 등록" onPress={() => command('submitForm', [card.id])} />
        </> : <Chips>
          <Chip primary label="등록" ariaLabel={`등록 — ${card.no ?? ''}번 음성 카드`} onPress={() => void session.confirmCard(card.id)} />
          <Chip label="고치기" onPress={() => command('openForm', [card.id])} />
          {counting && card.autoConfirmAt !== null ? <Chip label="자동 등록 멈추기" onPress={() => command('stopAuto', [card.id])} /> : null}
        </Chips>}
      </VoiceCard>
    })}
    {/* 되돌리기 창은 띄우지 않는다 (D-UX4-70, 사용자 지시 2026-11-10 "되돌리기 이런 창 띄우지 마. 사장이 등록된 걸 직접 고치게"):
        바로 고친 뒤의 "고침 되돌리기" 카드(실패 안내만 남김)·"방금 등록한 …" 되돌리기·늦은 말 카드를 보이지 않는다 — 고치거나 지울 것은 상품에서 직접 */}
    {snapshot.offers.filter(offerShown).map((offer) => <VoiceCard key={offer.id} label="음성 고침 확인" title={offer.message} onClose={() => command('dismissOffer', [offer.id])}>
      {offer.note ? <Hint>{offer.note}</Hint> : null}
      {offer.error ? <Notice tone="danger" alert>{offer.error}</Notice> : null}
      {offer.priceEntry !== undefined && offer.stage === 'ask' ? <Field label="고칠 가격" value={offer.priceEntry} keyboardType="decimal-pad" onChangeText={(value) => command('setOfferPrice', [offer.id, value])} /> : null}
      {offer.stage === 'busy' ? <Hint>보내는 중…</Hint> : <Chips>
        {offer.stage === 'ask' && offer.kind === 'offer' ? <Chip primary label={offer.maybeOther ? '새 가격으로 바꾸기' : '고치기'} onPress={() => command('fixOffer', [offer.id])} /> : null}
        {offer.stage === 'ask' && offer.kind === 'card' ? <Chip primary label="카드 고치기" onPress={() => command('fixCardOffer', [offer.id])} /> : null}
        {offer.maybeOther || offer.kind === 'number' ? <Chip label="아까 것을 다른 번호로" onPress={() => command('renumberOffer', [offer.id])} /> : null}
      </Chips>}
    </VoiceCard>)}
    {snapshot.sms.filter((entry) => !entry.hidden && entry.card.status !== 'CLOSED').map((entry) => <VoiceCard key={entry.card.id} label="음성 문자찜" title={words(display, 'sms', entry.card.id, '문자찜 확인')}>
      {entry.reason ? <Note tone="warning">{entry.reason}</Note> : null}
      {entry.error ? <Notice tone="danger" alert>{entry.error}</Notice> : null}
      {entry.timeCheck ? <Note tone="warning">받은 시각이 지금보다 늦어요. 그래도 넣을까요?</Note> : null}
      {entry.choose ? <Hint>{entry.choose}</Hint> : null}
      {entry.sending ? <Hint>보내는 중…</Hint> : <>
        {entry.results.length > 0 ? entry.results.map((result) => <VoiceSmsResult key={`${result.no}-${result.seq}`} line={result} />) : null}
        {entry.reason === null && entry.card.status === 'OPEN' ? <>
          {counting ? <Hint>{words(display, 'countdowns', entry.card.id, '')}</Hint> : null}
          <Chips>
            {entry.card.candidates ? <>
              {entry.card.candidates.map((candidate) => <Chip key={candidate.buyer} label={`${candidate.display}${candidate.phoneLast4 ? ` · 끝자리 ${candidate.phoneLast4}` : ''}`} onPress={() => command('smsChoose', [entry.card.id, candidate.buyer])} />)}
              <Chip label="새 손님으로 넣기" onPress={() => command('smsNewBuyer', [entry.card.id])} />
            </> : <Chip primary label={entry.timeCheck ? '그래도 넣기' : '지금 넣기'} onPress={() => command('smsSend', [entry.card.id])} />}
            <Chip label="넣지 않기" onPress={() => command('smsSkip', [entry.card.id])} />
          </Chips>
        </> : <Chips><Chip label="닫기" onPress={() => command('smsDismiss', [entry.card.id])} /></Chips>}
      </>}
    </VoiceCard>)}
    {snapshot.smsDropped.map((item) => <Card key={item.id} label="넣지 않은 문자찜"><Body>{item.text}</Body><BigButton label="확인" onPress={() => command('smsDroppedSeen', [item.id])} /></Card>)}
  </View>
}

/** 음성 설정과 기록 (D-UX2-03: 방송 중 화면에서 빼고 "방송 메뉴 → 음성 설정"으로 옮겼다) */
export function VoiceSettings({ session, snapshot, display }: { readonly session: VoiceSession; readonly snapshot: VoiceSnapshot; readonly display: Readonly<Record<string, unknown>> }) {
  const command = session.command.bind(session)
  return <Card label="음성 설정과 기록">
      <BigButton label={`번호와 가격이 들리면 바로 등록: ${snapshot.instant ? '켬' : '끔'}`} onPress={() => session.setInstant(!snapshot.instant)} />
      <BigButton label={`카드 자동 확정: ${snapshot.settings?.['voice.autoConfirm'] ? '켬' : '끔'}`} onPress={() => command('setAutoConfirm', [!snapshot.settings?.['voice.autoConfirm']])} />
      <Field label="자동 확정 기다림(초)" value={snapshot.secondsText} keyboardType="number-pad" onChangeText={(value) => command('setSeconds', [value])} problem={snapshot.settingsProblem} />
      <Field label="말이 끝났다고 볼 때까지(초)" value={snapshot.quietText} keyboardType="decimal-pad" onChangeText={(value) => command('setQuietSeconds', [value])} problem={snapshot.quietProblem} />
      <BigButton label={`문자찜 듣기: ${snapshot.smsSettings?.['voice.smsListen'] ? '켬' : '끔'}`} onPress={() => command('setSmsListen', [!snapshot.smsSettings?.['voice.smsListen']])} />
      <Field label="문자찜 자동으로 넣기까지(초)" value={snapshot.smsSecondsText} keyboardType="number-pad" onChangeText={(value) => command('setSmsSeconds', [value])} problem={snapshot.smsSettingsProblem} />
      <BigButton label={`음성 인식 기록 모아 두기: ${snapshot.archive ? '켬' : '끔'}`} onPress={() => command('setArchive', [!snapshot.archive])} />
      {Array.isArray(display.logLines) ? (display.logLines as { key: string; time: string; pieces: readonly string[]; action: string; reason: string | null }[]).slice(0, 20).map((line) => <Hint key={line.key}>{`${line.time} ${line.pieces.join(' ')} · ${line.action}${line.reason ? ` · ${line.reason}` : ''}`}</Hint>) : null}
      <Row wrap><BigButton label="음성 기록 지우기" onPress={() => command('clearLog')} /><BigButton label={`배운 품종 이름 지우기(${snapshot.learnedCount})`} onPress={() => command('clearLearned')} /></Row>
  </Card>
}
