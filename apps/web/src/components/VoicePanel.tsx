// 콘솔 음성 칸 (VOC-01·04·05, D-I4-03~05·09, AC-I4-10~31·50·51).
// - "음성 켜기"(꺼져 있을 때 콘솔 머리 줄) → 처음이면 안내 창 → 켜진 동안 상태·외부 전송 안내 한 줄·자막·"음성 끄기".
// - 카드: 카드 글(describeCard)·원래 문장·"확인 필요"·"Enter 등록"·남은 초, 버튼 "등록"·"고치기"·"닫기"(·"자동 등록 멈추기") — 접근 이름에 카드 글을 담는다.
// - 설정(자동 확정)과 "들린 말 기록"은 켜진 동안 음성 칸 아래쪽에. 인식 문장은 늘 글자로만 그린다(React 기본 이스케이프, NFR-06).
// PC(폭 768px 이상)에선 콘솔이 이 칸(VoiceLive)을 빠른 입력칸과 함께 고정 영역에 둔다 — Enter 대상 카드가 늘 보이게(D-I4-03).
import type { SuggestionCard } from '@livejjim/voice'
import { useEffect, useId, useRef, type KeyboardEvent, type RefObject } from 'react'
import { autoSecondsLeft, showsAutoCountdown } from '../lib/voice.ts'
import { useWide } from '../lib/use-wide.ts'
import { FLUSHED_CARD_NOTE, HISTORY_FAILED, SENT_NOTICE, SENT_NOTICE_SHORT, STANDALONE_NOTICE, TOO_SOON, errorLines, flushedClosedNotice, type CardForm, type FormField, type VoiceController, type VoiceSnapshot } from '../voice/controller.ts'
import { isHomeScreenApp } from '../voice/standalone.ts'
import { Modal } from './Modal.tsx'

/** 안내 창 문장 (D-I4-04, AC-I4-11 — 외부 전송 문장은 D-I5-06, 마이크 줄은 D-I5-11로 바꿈) */
export const CONSENT_TITLE = '음성으로 상품 등록'
export const CONSENT_LINES: readonly string[] = [
  '말한 번호·품종·가격을 카드로 보여 줘요. 카드를 확인하고 등록해야 상품이 생겨요.',
  '음성은 인식을 위해 브라우저의 음성 인식 서버(크롬은 구글, 아이폰은 애플)로 보내져요. 라이브찜은 음성을 녹음하거나 저장하지 않아요.',
  // D-I5-11: 크롬·사파리 모두에 맞게 "브라우저가"
  '다음에 브라우저가 마이크 사용을 물으면 "허용"을 눌러 주세요.',
]
export const AUTO_CONFIRM_LABEL = '확실한 카드는 자동으로 등록'
export const AUTO_CONFIRM_HELP = '번호·품종·가격이 모두 확실한 카드만, 손대지 않으면 정한 시간 뒤 등록해요. 등록 뒤 5초 안에 되돌릴 수 있어요.'
export const SECONDS_LABEL = '기다리는 시간(초)'

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
  return snapshot.phase === 'on' || snapshot.cards.length > 0 || snapshot.error !== null || snapshot.tooSoon || snapshot.flushedClosed.length > 0
}

/** 휴대폰 아래 메뉴 막대·고정 영역에 가리지 않게 둘 여백(px) */
const SCROLL_GAP = 8

/**
 * 휴대폰 폭에서 새 카드가 맨 앞에 생기면 그 카드가 화면에 다 보이게 조금만 내린다 (U-I5-02).
 * 이미 다 보이면 움직이지 않고, 고치기 칸이 열려 있으면(판매자가 고치는 중) 움직이지 않는다.
 * 아래는 메뉴 막대(.menu) 위까지, 위는 화면 맨 위에 붙은 고정 영역(.console-sticky) 높이 아래까지를 보이는 곳으로 본다.
 */
export function revealCard(element: HTMLElement): void {
  const rect = element.getBoundingClientRect()
  const menu = document.querySelector('.menu')
  const menuTop = menu instanceof HTMLElement && getComputedStyle(menu).position === 'fixed' ? menu.getBoundingClientRect().top : window.innerHeight
  const sticky = document.querySelector('.console-sticky')
  // 고정 영역은 내리면 화면 맨 위에 붙으므로(top: 0) 그 높이까지가 가려질 수 있는 곳이다 (아직 붙기 전이라도)
  const stickyHeight = sticky instanceof HTMLElement ? sticky.getBoundingClientRect().height : 0
  const bottom = menuTop - SCROLL_GAP
  const top = stickyHeight + SCROLL_GAP
  let delta = 0
  if (rect.bottom > bottom) delta = rect.bottom - bottom
  // 카드가 보이는 곳보다 크면 위(카드 글)가 먼저 보이게
  if (rect.top - delta < top) delta = rect.top - top
  if (delta !== 0) window.scrollBy({ top: delta, behavior: 'auto' })
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
  const wide = useWide()
  const listRef = useRef<HTMLUListElement>(null)
  const frontId = snapshot.cards[0]?.id ?? null
  const seenFront = useRef<string | null>(frontId)
  const editing = snapshot.forms.size > 0
  // 휴대폰: 새 카드가 맨 앞에 생기면 보이게 내린다 (U-I5-02). PC는 고정 영역에 있어 늘 보인다(D-I4-03)
  useEffect(() => {
    if (frontId === seenFront.current) return
    seenFront.current = frontId
    if (wide || editing || frontId === null) return
    const first = listRef.current?.firstElementChild
    if (first instanceof HTMLElement) revealCard(first)
  }, [frontId, wide, editing])
  return (
    <section className="voice" aria-label="음성 등록">
      {on ? (
        <div className="voice-bar">
          <span className="voice-state" role="status">
            {snapshot.stateLabel}
          </span>
          {/* 휴대폰 폭은 짧은 문장 (D-I5-16) — 늘 보인다 */}
          <span className="voice-sent">{wide ? SENT_NOTICE : SENT_NOTICE_SHORT}</span>
          <button type="button" className="button" onClick={() => voice.turnOff()}>
            음성 끄기
          </button>
        </div>
      ) : null}
      {on && snapshot.interim !== null ? <p className="voice-interim">들리는 말: {snapshot.interim}</p> : null}
      {snapshot.error !== null ? (
        snapshot.unsupported ? (
          // 지원 안 함은 잘못이 아니라 안내 — 안내 색·"닫기" (D-I5-15)
          <div className="voice-guide" role="alert">
            <div className="voice-lines">
              {errorLines(snapshot.error).map((line, index) => (
                <p key={`${String(index)}-${line}`}>{line}</p>
              ))}
            </div>
            <button type="button" className="button" onClick={() => voice.dismissUnsupported()}>
              닫기
            </button>
          </div>
        ) : (
          // 여러 줄 문장은 줄마다 따로 (D-I5-12): 첫 줄 = 무슨 일, 다음 줄 = 기기별 할 일
          <div className="voice-error voice-lines" role="alert">
            {errorLines(snapshot.error).map((line, index) => (
              <p key={`${String(index)}-${line}`}>{line}</p>
            ))}
          </div>
        )
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
      {snapshot.flushedClosed.length > 0 ? (
        <div className="voice-lost" role="alert">
          {snapshot.flushedClosed.map((text, index) => (
            <p key={`${String(index)}-${text}`}>{flushedClosedNotice(cardShortText(text))}</p>
          ))}
          <button type="button" className="button" onClick={() => voice.dismissFlushedClosed()}>
            알겠어요
          </button>
        </div>
      ) : null}
      {snapshot.cards.length > 0 ? (
        <ul ref={listRef} className="plain-list voice-cards" aria-label="음성 카드">
          {snapshot.cards.map((card) => (
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
          ))}
        </ul>
      ) : null}
      {/* 홈 화면 앱: 켜진 동안·오류로 멈춘 뒤 한 줄 (D-I5-05 — 막지 않는다). 좁은 화면에서 카드를 밀어내지 않게 카드 아래에 둔다 (U-I5-02) */}
      {(on || snapshot.error !== null) && isHomeScreenApp() ? <p className="voice-info">{STANDALONE_NOTICE}</p> : null}
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
  // 끝에서 넘긴 문장 카드: 자동 등록되지 않으니 보통 카드와 겉모습을 다르게 하고 까닭을 쓴다 (D-I5-02, U-I5-01)
  const flushed = card.flushedAtEnd === true
  const formId = useId()
  return (
    <li className={low || flushed ? 'voice-card voice-card-low' : 'voice-card'} aria-label={`${short} 카드`}>
      <div className="voice-card-body">
        <p className="voice-card-text">
          <strong>{described}</strong>
          {low || flushed ? <span className="tag tag-waiting">확인 필요</span> : null}
          {badge ? <span className="tag tag-order">Enter 등록</span> : null}
        </p>
        <p className="voice-card-heard">들은 말: {card.text}</p>
        {flushed ? <p className="voice-card-why">{FLUSHED_CARD_NOTE}</p> : null}
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
