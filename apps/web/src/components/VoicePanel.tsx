// 콘솔 음성 칸 (VOC-01·04·05, D-I4-03~05·09, AC-I4-10~31·50·51).
// - "음성 켜기"(꺼져 있을 때 콘솔 머리 줄) → 처음이면 안내 창 → 켜진 동안 상태·외부 전송 안내 한 줄·자막·"음성 끄기".
// - 카드: 카드 글(describeCard)·원래 문장·"확인 필요"·"Enter 등록"·남은 초, 버튼 "등록"·"고치기"·"닫기"(·"자동 등록 멈추기") — 접근 이름에 카드 글을 담는다.
// - 설정(자동 확정)과 "들린 말 기록"은 켜진 동안 음성 칸 아래쪽에. 인식 문장은 늘 글자로만 그린다(React 기본 이스케이프, NFR-06).
// PC(폭 768px 이상)에선 콘솔이 이 칸(VoiceLive)을 빠른 입력칸과 함께 고정 영역에 둔다 — Enter 대상 카드가 늘 보이게(D-I4-03).
// V1 문자찜 카드 (VOC-04, AC-V1-20~28): 카드 글(describeSmsCard)·"N초 뒤 넣어요"·"넣지 않기"·"지금 넣기"/"넣기", 이유 카드는 "닫기"만,
// 고르기 카드는 후보마다 버튼, 넣은 뒤엔 손 입력 문자찜과 같은 결과 문장·"찜 취소하기". 카드 글(이름 포함)은 글자로만 그린다(AC-V1-30).
import type { SmsBuyerCandidate, SuggestionCard } from '@livejjim/voice'
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { isActive } from '../lib/buyers.ts'
import { autoSecondsLeft, showsAutoCountdown } from '../lib/voice.ts'
import { HISTORY_FAILED, SENT_NOTICE, TOO_SOON, smsShortText, smsShown, type CardForm, type FormField, type SmsEntry, type SmsResultLine, type VoiceController, type VoiceSnapshot } from '../voice/controller.ts'
import { openClaimAction } from './actions.ts'
import { useConsoleApi } from './console-context.ts'
import { Modal } from './Modal.tsx'
import { smsResultWords, useSentToReview, useSmsClaim } from './SmsPage.tsx'

/** 안내 창 문장 (D-I4-04, AC-I4-11 그대로) */
export const CONSENT_TITLE = '음성으로 상품 등록'
export const CONSENT_LINES: readonly string[] = [
  '말한 번호·품종·가격을 카드로 보여 줘요. 카드를 확인하고 등록해야 상품이 생겨요.',
  '음성은 인식을 위해 구글 음성 인식 서버로 보내져요. 라이브찜은 음성을 녹음하거나 저장하지 않아요.',
  '다음에 크롬이 마이크 사용을 물으면 "허용"을 눌러 주세요.',
]
export const AUTO_CONFIRM_LABEL = '확실한 카드는 자동으로 등록'
export const AUTO_CONFIRM_HELP = '번호·품종·가격이 모두 확실한 카드만, 손대지 않으면 정한 시간 뒤 등록해요. 등록 뒤 5초 안에 되돌릴 수 있어요.'
export const SECONDS_LABEL = '기다리는 시간(초)'
/** 문자찜 설정 안내 (VOC-04 문자찜 카드) */
export const SMS_HELP = '"165번 문자찜 끝자리 1234"처럼 말하면 문자찜 카드가 나와요. 손대지 않으면 정한 시간 뒤 넣어요(0이면 바로). 넣기 전에 "넣지 않기"를 누르면 아무것도 넣지 않아요.'

/** 카드를 가리키는 짧은 글: "15번 핑크프릴 15,000원" (describeCard에서 물음을 뗀 것) */
export function cardShortText(described: string): string {
  return described.replace(/\s*—\s*등록할까요\?$/, '')
}

/** 콘솔 머리 줄의 "음성 켜기" (켜져 있으면 음성 칸의 "음성 끄기", 안내 창이 열린 동안은 창의 "음성 켜기") */
export function VoiceToggle({ voice, snapshot, ready }: { readonly voice: VoiceController; readonly snapshot: VoiceSnapshot; readonly ready: boolean }) {
  if (snapshot.phase === 'on' || snapshot.phase === 'consent') return null
  return (
    <button type="button" className="button" disabled={!ready || snapshot.phase === 'loading'} onClick={() => void voice.turnOn()}>
      음성 켜기
    </button>
  )
}

/** 처음 켤 때의 안내 창 (외부 전송 고지·권한 안내). 처음 포커스는 "닫기" */
export function VoiceConsentDialog({ voice }: { readonly voice: VoiceController }) {
  return (
    <Modal
      title={CONSENT_TITLE}
      onClose={() => voice.declineConsent()}
      actions={
        <button type="button" className="button button-primary" onClick={() => voice.acceptConsent()}>
          음성 켜기
        </button>
      }
    >
      <div className="stack-tight">
        {CONSENT_LINES.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </Modal>
  )
}

/** 음성 칸을 보일까 (켜졌거나, 남은 카드·오류가 있을 때) */
export function voiceLiveShown(snapshot: VoiceSnapshot): boolean {
  return snapshot.phase === 'on' || snapshot.cards.length > 0 || snapshot.sms.some(smsShown) || snapshot.error !== null || snapshot.tooSoon
}

/** "문자찜도 듣는 중"을 보이는가 (켜져 있고 문자찜도 듣기가 켜짐) */
export function smsListening(snapshot: VoiceSnapshot): boolean {
  return snapshot.phase === 'on' && snapshot.smsSettings !== null && snapshot.smsSettings['voice.smsListen']
}

/** 카드를 가리키는 짧은 글 (controller와 같은 함수) */
export { smsShortText }

type ListItem = { readonly kind: 'product'; readonly card: SuggestionCard } | { readonly kind: 'sms'; readonly entry: SmsEntry }

/** 상품 카드와 화면에 보이는 문자찜 카드를 새 것이 앞으로 (만든 시각 — 같으면 상품 카드 목록 차례) */
function listItems(snapshot: VoiceSnapshot): ListItem[] {
  const items: ListItem[] = snapshot.cards.map((card) => ({ kind: 'product', card }))
  for (const entry of snapshot.sms) if (smsShown(entry)) items.push({ kind: 'sms', entry })
  const at = (item: ListItem) => (item.kind === 'product' ? item.card.createdAt : item.entry.card.createdAt)
  return items.map((item, index) => ({ item, index })).sort((a, b) => at(b.item) - at(a.item) || a.index - b.index).map(({ item }) => item)
}

export interface VoiceLiveProps {
  readonly voice: VoiceController
  readonly snapshot: VoiceSnapshot
  /** "Enter 등록" 표시를 붙일 카드 ID */
  readonly badge: string | null
  /** 고치기 칸의 Enter */
  readonly onSubmitForm: (id: string) => void
  /** 카드의 "등록" */
  readonly onRegister: (id: string) => void
}

/** 상태·안내·자막·오류와 카드 목록 */
export function VoiceLive({ voice, snapshot, badge, onSubmitForm, onRegister }: VoiceLiveProps) {
  const on = snapshot.phase === 'on'
  const items = listItems(snapshot)
  return (
    <section className="voice" aria-label="음성 등록">
      {on ? (
        <div className="voice-bar">
          <span className="voice-state" role="status">
            {snapshot.stateLabel}
          </span>
          {smsListening(snapshot) ? <span className="voice-sms-on">{voice.smsWords()?.listening}</span> : null}
          <span className="voice-sent">{SENT_NOTICE}</span>
          <button type="button" className="button" onClick={() => voice.turnOff()}>
            음성 끄기
          </button>
        </div>
      ) : null}
      {on && snapshot.interim !== null ? <p className="voice-interim">들리는 말: {snapshot.interim}</p> : null}
      {snapshot.error !== null ? (
        <p className="voice-error" role="alert">
          {snapshot.error}
        </p>
      ) : null}
      {on && snapshot.historyFailed ? (
        <p className="voice-info" role="status">
          {HISTORY_FAILED}
        </p>
      ) : null}
      {snapshot.tooSoon ? (
        <p className="voice-info" role="alert">
          {TOO_SOON}
        </p>
      ) : null}
      {snapshot.smsDropped.length > 0 ? (
        <ul className="plain-list stack-tight" aria-label="넣지 않고 닫힌 문자찜">
          {snapshot.smsDropped.map((item) => (
            <li key={item.id} className="voice-card voice-card-sms voice-card-low">
              <p className="field-error" role="alert">
                {item.text}
              </p>
              <div className="voice-card-actions">
                <button type="button" className="button" aria-label={`${item.short} 안내 확인`} onClick={() => voice.smsDroppedSeen(item.id)}>
                  확인
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {items.length > 0 ? (
        <ul className="plain-list voice-cards" aria-label="음성 카드">
          {items.map((item) => {
            if (item.kind === 'sms') return <SmsCardView key={item.entry.card.id} entry={item.entry} voice={voice} on={on} />
            const card = item.card
            return (
            <VoiceCard
              key={card.id}
              card={card}
              described={voice.describe(card)}
              badge={badge === card.id}
              countdown={showsAutoCountdown(card, snapshot.settings, on) && card.autoConfirmAt !== null ? autoSecondsLeft(card.autoConfirmAt, snapshot.now) : null}
              note={snapshot.notes.get(card.id) ?? null}
              form={snapshot.forms.get(card.id) ?? null}
              voice={voice}
              onSubmitForm={onSubmitForm}
              onRegister={onRegister}
            />
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}

interface VoiceCardProps {
  readonly card: SuggestionCard
  readonly described: string
  readonly badge: boolean
  readonly countdown: number | null
  readonly note: string | null
  readonly form: CardForm | null
  readonly voice: VoiceController
  readonly onSubmitForm: (id: string) => void
  readonly onRegister: (id: string) => void
}

function VoiceCard({ card, described, badge, countdown, note, form, voice, onSubmitForm, onRegister }: VoiceCardProps) {
  const short = cardShortText(described)
  const low = card.confidence !== 'HIGH'
  const formId = useId()
  return (
    <li className={low ? 'voice-card voice-card-low' : 'voice-card'} aria-label={`${short} 카드`}>
      <div className="voice-card-body">
        <p className="voice-card-text">
          <strong>{described}</strong>
          {low ? <span className="tag tag-waiting">확인 필요</span> : null}
          {badge ? <span className="tag tag-order">Enter 등록</span> : null}
        </p>
        <p className="voice-card-heard">들은 말: {card.text}</p>
        {countdown !== null ? <p className="voice-card-auto">{countdown}초 뒤 자동 등록</p> : null}
        {note !== null ? (
          <p className="field-error" role="status">
            {note}
          </p>
        ) : null}
      </div>
      <div className="voice-card-actions">
        <button type="button" className="button button-primary" aria-label={`${short} 등록`} onClick={() => onRegister(card.id)}>
          등록
        </button>
        <button
          type="button"
          className="button"
          aria-label={`${short} 고치기`}
          aria-expanded={form !== null}
          aria-controls={form !== null ? formId : undefined}
          onClick={() => (form === null ? voice.openForm(card.id) : voice.closeForm(card.id))}
        >
          고치기
        </button>
        <button type="button" className="button" aria-label={`${short} 닫기`} onClick={() => voice.close(card.id)}>
          닫기
        </button>
        {countdown !== null ? (
          <button type="button" className="button" aria-label={`${short} 자동 등록 멈추기`} onClick={() => voice.stopAuto(card.id)}>
            자동 등록 멈추기
          </button>
        ) : null}
      </div>
      {form !== null ? <CardFormView id={formId} cardId={card.id} short={short} form={form} voice={voice} onSubmit={onSubmitForm} /> : null}
    </li>
  )
}

/** 문자찜 카드 하나 (VOC-04 문자찜 카드) */
function SmsCardView({ entry, voice, on }: { readonly entry: SmsEntry; readonly voice: VoiceController; readonly on: boolean }) {
  const words = voice.smsWords()
  if (words === null) return null
  const { card } = entry
  const described = voice.describeSms(card)
  const short = smsShortText(described)
  const labels = words.labels
  const sent = card.status === 'SENT'
  const countdown = on && !entry.sending && card.status === 'OPEN' && entry.reason === null && card.candidates === null ? voice.smsCountdown(entry) : null
  const button = (label: string, action: () => void, primary = false) => (
    <button type="button" className={primary ? 'button button-primary' : 'button'} aria-label={`${short} ${label}`} onClick={action}>
      {label}
    </button>
  )
  let actions: ReactNode = null
  let body: ReactNode = null
  if (entry.sending) {
    body = (
      <p className="voice-card-auto" role="status">
        넣는 중…
      </p>
    )
  } else if (entry.reason !== null) {
    body = (
      <p className="field-error" role="alert">
        {entry.reason}
      </p>
    )
    actions = button(labels.close, () => voice.smsSkip(card.id))
  } else if (sent) {
    actions = button(labels.close, () => voice.smsDismiss(card.id))
  } else if (card.candidates !== null) {
    body = (
      <p className="field-error" role="alert">
        {words.choose(card.reading.last4)}
      </p>
    )
    actions = (
      <>
        <SmsCandidates candidates={card.candidates} short={short} onChoose={(buyer) => voice.smsChoose(card.id, buyer)} />
        {button(labels.skip, () => voice.smsSkip(card.id))}
      </>
    )
  } else if (countdown !== null) {
    body = <p className="voice-card-auto">{countdown}</p>
    actions = (
      <>
        {button(labels.skip, () => voice.smsSkip(card.id))}
        {button(labels.sendNow, () => voice.smsSend(card.id), true)}
      </>
    )
  } else {
    body = entry.timeCheck ? (
      <p className="field-error" role="status">
        {words.timeCheck}
      </p>
    ) : null
    actions = (
      <>
        {button(labels.send, () => voice.smsSend(card.id), true)}
        {button(labels.skip, () => voice.smsSkip(card.id))}
      </>
    )
  }
  return (
    <li className={entry.reason !== null ? 'voice-card voice-card-sms voice-card-low' : 'voice-card voice-card-sms'} aria-label={`${short} 카드`}>
      <div className="voice-card-body">
        {sent && entry.results.length > 0 ? (
          <ul className="plain-list stack-tight" aria-label={`${short} 넣은 결과`}>
            {entry.results.map((line) => (
              <SmsResultRow key={line.seq} line={line} last4={card.reading.last4} />
            ))}
          </ul>
        ) : (
          <p className="voice-card-text">
            <strong>{described}</strong>
          </p>
        )}
        <p className="voice-card-heard">들은 말: {card.text}</p>
        {card.repeats > 0 ? (
          <p className="hint" role="status">
            {words.repeat}
          </p>
        ) : null}
        {body}
        {entry.error !== null ? (
          <p className="field-error" role="alert">
            {entry.error}
          </p>
        ) : null}
      </div>
      {actions !== null ? <div className="voice-card-actions">{actions}</div> : null}
    </li>
  )
}

/** 409 후보 (처음 생긴 순서): "문자찜(김씨) · 끝자리 1234" — 같은 표시 이름이면 구매자 목록과 같은 구분 표기(BuyerNames) */
function SmsCandidates({ candidates, short, onChoose }: { readonly candidates: readonly SmsBuyerCandidate[]; readonly short: string; readonly onChoose: (buyer: string) => void }) {
  const api = useConsoleApi()
  return (
    <>
      {candidates.map((candidate) => {
        const known = api.data.buyers.has(candidate.buyer)
        const name = known ? api.names.name(candidate.buyer) : candidate.display
        const label = candidate.phoneLast4 === null || name.includes(candidate.phoneLast4) ? name : `${name} · 끝자리 ${candidate.phoneLast4}`
        return (
          <button key={candidate.buyer} type="button" className="button" aria-label={`${short} 손님 고르기: ${label}`} onClick={() => onChoose(candidate.buyer)}>
            {label}
          </button>
        )
      })}
    </>
  )
}

/** 넣은 주문 하나의 결과 줄 — 손 입력 결과 카드와 같은 문장 (AC-S06-14·AC-SMS-03), "찜 취소하기"는 지금의 찜 취소(사유 창·5초 대기) */
function SmsResultRow({ line, last4 }: { readonly line: SmsResultLine; readonly last4: string | null }) {
  const api = useConsoleApi()
  const result = { seq: line.seq, no: line.no, b: api.b, buyer: line.buyer }
  const { claim, caught, missing } = useSmsClaim(api, result)
  const reviewed = useSentToReview(api, result, missing)
  const { body, tone } = smsResultWords(api, result, claim, caught, reviewed)
  return (
    <li className="sms-result" data-tone={tone}>
      <p role="status">
        <strong>{body}</strong>
        {last4 !== null ? <span> · 뒤 4자리 {last4}</span> : null}
      </p>
      {caught && claim !== undefined && isActive(claim) && !api.sealed ? (
        <button type="button" className="button" aria-label={`${String(line.no)}번 문자찜 찜 취소하기`} onClick={() => openClaimAction(api, claim, 'host.cancel')}>
          찜 취소하기
        </button>
      ) : null}
    </li>
  )
}

function CardFormView({
  id,
  cardId,
  short,
  form,
  voice,
  onSubmit,
}: {
  readonly id: string
  readonly cardId: string
  readonly short: string
  readonly form: CardForm
  readonly voice: VoiceController
  readonly onSubmit: (id: string) => void
}) {
  const refs: Record<FormField, RefObject<HTMLInputElement | null>> = {
    no: useRef<HTMLInputElement>(null),
    name: useRef<HTMLInputElement>(null),
    price: useRef<HTMLInputElement>(null),
  }

  useEffect(() => {
    const field = refs[form.focus].current
    field?.focus()
    field?.select()
  }, [form.version])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter') {
      event.preventDefault()
      onSubmit(cardId)
    } else if (event.key === 'Escape') {
      // 열린 창이 있으면 창부터 닫는다 (콘솔이 처리한다, D-087)
      if (document.querySelector('[role="dialog"]') !== null) return
      event.preventDefault()
      event.stopPropagation()
      voice.closeForm(cardId)
    }
  }

  return (
    <fieldset id={id} className="fix voice-fix" aria-label={`${short} 고치기 칸`}>
      <legend>고치기 — Enter 등록 · Esc 닫기</legend>
      {form.message !== null ? (
        <p className="field-error" role="alert">
          {form.message}
        </p>
      ) : null}
      <div className="fix-fields">
        <label className="field">
          <span>번호</span>
          <input ref={refs.no} className="input" inputMode="numeric" autoComplete="off" value={form.no} onChange={(event) => voice.editForm(cardId, { no: event.target.value })} onKeyDown={onKeyDown} />
        </label>
        <label className="field">
          <span>품종</span>
          <input ref={refs.name} className="input" autoComplete="off" value={form.name} onChange={(event) => voice.editForm(cardId, { name: event.target.value })} onKeyDown={onKeyDown} />
        </label>
        <label className="field">
          <span>가격</span>
          <input ref={refs.price} className="input" inputMode="numeric" autoComplete="off" value={form.price} onChange={(event) => voice.editForm(cardId, { price: event.target.value })} onKeyDown={onKeyDown} />
        </label>
      </div>
    </fieldset>
  )
}

/** 켜진 동안의 자동 확정 설정과 "들린 말 기록" */
export function VoiceExtras({ voice, snapshot }: { readonly voice: VoiceController; readonly snapshot: VoiceSnapshot }) {
  const on = snapshot.phase === 'on'
  const settings = snapshot.settings
  const smsSettings = snapshot.smsSettings
  const smsWords = voice.smsWords()
  if (!on && snapshot.heard.length === 0) return null
  return (
    <section className="voice-extras" aria-label="음성 설정과 기록">
      {on && settings !== null ? (
        <div className="voice-settings">
          <label className="choice">
            <input type="checkbox" checked={settings['voice.autoConfirm']} onChange={(event) => voice.setAutoConfirm(event.target.checked)} />
            <span>{AUTO_CONFIRM_LABEL}</span>
          </label>
          <label className="voice-seconds">
            <span>{SECONDS_LABEL}</span>
            <input className="input" inputMode="numeric" autoComplete="off" value={snapshot.secondsText} onChange={(event) => voice.setSeconds(event.target.value)} />
          </label>
          {snapshot.settingsProblem !== null ? (
            <p className="field-error" role="alert">
              {snapshot.settingsProblem}
            </p>
          ) : null}
          {settings['voice.autoConfirm'] ? <p className="hint">{AUTO_CONFIRM_HELP}</p> : null}
          {smsSettings !== null && smsWords !== null ? (
            <>
              <label className="choice">
                <input type="checkbox" checked={smsSettings['voice.smsListen']} onChange={(event) => voice.setSmsListen(event.target.checked)} />
                <span>{smsWords.labels.listen}</span>
              </label>
              <label className="voice-seconds">
                <span>{smsWords.labels.autoSec}</span>
                <input className="input" inputMode="numeric" autoComplete="off" value={snapshot.smsSecondsText} onChange={(event) => voice.setSmsSeconds(event.target.value)} />
              </label>
              {snapshot.smsSettingsProblem !== null ? (
                <p className="field-error" role="alert">
                  {snapshot.smsSettingsProblem}
                </p>
              ) : null}
              <p className="hint">{SMS_HELP}</p>
            </>
          ) : null}
        </div>
      ) : null}
      <details className="details voice-heard">
        <summary>들린 말 기록</summary>
        {snapshot.heard.length === 0 ? (
          <p className="hint">아직 들린 말이 없어요.</p>
        ) : (
          <ol className="voice-heard-list">
            {snapshot.heard.map((line) => (
              <li key={line.id}>{line.text}</li>
            ))}
          </ol>
        )}
      </details>
    </section>
  )
}
