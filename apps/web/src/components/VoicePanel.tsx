// 콘솔 음성 칸 (VOC-01·04·05, D-I4-03~05·09, AC-I4-10~31·50·51).
// - "음성 켜기"(꺼져 있을 때 콘솔 머리 줄) → 처음이면 안내 창 → 켜진 동안 상태·외부 전송 안내 한 줄·자막·"음성 끄기".
// - 카드: 카드 글(describeCard)·원래 문장·"확인 필요"·"Enter 등록"·남은 초, 버튼 "등록"·"고치기"·"닫기"(·"자동 등록 멈추기") — 접근 이름에 카드 글을 담는다.
// - 설정(자동 확정·조용한 시간)과 [음성 기록]은 음성 칸 바로 아래 접는 칸 "음성 설정과 기록"(기본 접힘, D-V2-21). 인식 문장은 늘 글자로만 그린다(React 기본 이스케이프, NFR-06).
// PC(폭 768px 이상)에선 콘솔이 이 칸(VoiceLive)을 빠른 입력칸과 함께 고정 영역에 둔다 — Enter 대상 카드가 늘 보이게(D-I4-03).
// V1 문자찜 카드 (VOC-04, AC-V1-20~28): 카드 글(describeSmsCard)·"N초 뒤 넣어요"·"넣지 않기"·"지금 넣기"/"넣기", 이유 카드는 "닫기"만,
// 고르기 카드는 후보마다 버튼, 넣은 뒤엔 손 입력 문자찜과 같은 결과 문장·"찜 취소하기". 카드 글(이름 포함)은 글자로만 그린다(AC-V1-30).
// 버튼 자리는 모든 문자찜 카드에서 같다: "넣지 않기"(이유 카드는 "닫기")가 첫 버튼, 넣는 버튼은 뒤이고 주 버튼 색(D-V1-20). PC 폭에선 Esc가 닫을 카드에 "Esc" 표시.
// 이유 카드 제목은 "문자찜 · 넣지 않았어요", 번호 방식 카드는 번호 뒤에 품종, "확인 필요"로 넣은 결과 카드엔 정산 안내 한 줄(D-V1-21).
import type { SmsBuyerCandidate, SuggestionCard } from '@livejjim/voice'
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { isActive } from '../lib/buyers.ts'
import { autoSecondsLeft, showsAutoCountdown } from '../lib/voice.ts'
import { useWide } from '../lib/use-wide.ts'
import {
  AUTO_PAUSED_NOTE,
  EXTRAS_TITLE,
  HEARD_EMPTY,
  HEARD_TITLE,
  LOG_TITLE,
  HEARING_LABEL,
  NAME_CHECK,
  QUIET_HELP,
  QUIET_LABEL,
  FLUSHED_CARD_NOTE,
  HISTORY_FAILED,
  SENT_NOTICE,
  SENT_NOTICE_SHORT,
  SMS_NEW_BUYER,
  SMS_REASON_TITLE,
  SMS_UNKNOWN_BUYER_NOTE,
  STANDALONE_NOTICE,
  TOO_SOON,
  candidateClaims,
  errorLines,
  flushedClosedNotice,
  smsCandidateLabel,
  smsShortText,
  smsShown,
  smsUnknownBuyer,
  type CardForm,
  type CardInfo,
  type FormField,
  type VoiceOffer,
  type SmsEntry,
  type SmsResultLine,
  type VoiceController,
  type VoiceSnapshot,
} from '../voice/controller.ts'
import { isHomeScreenApp } from '../voice/standalone.ts'
import { openClaimAction } from './actions.ts'
import { useConsoleApi } from './console-context.ts'
import { Modal } from './Modal.tsx'
import { smsLast4Suffix, smsResultWords, useSentToReview, useSmsClaim } from './SmsPage.tsx'
import { SERVICE_NAME } from '../brand.ts'

/** 안내 창 마지막 줄 (MOB1 D-MOB1-07, AC-MOB1-11) */
export const CONSENT_OTHER_DEVICE = '방송하는 폰이 아닌 다른 기기(관리 폰이나 PC)에서 켜 주세요. 방송 앱이 마이크를 쓰는 폰에서는 잘 듣지 못해요.'
/** 안내 창 문장 (D-I4-04, AC-I4-11 — 외부 전송 문장은 D-I5-06, 마이크 줄은 D-I5-11로 바꿈) */
export const CONSENT_TITLE = '음성으로 상품 등록'
export const CONSENT_LINES: readonly string[] = [
  '말한 번호·품종·가격을 카드로 보여 줘요. 카드를 확인하고 등록해야 상품이 생겨요.',
  `음성은 인식을 위해 브라우저의 음성 인식 서버(크롬은 구글, 아이폰은 애플)로 보내져요. ${SERVICE_NAME}는 음성을 녹음하거나 저장하지 않아요.`,
  // D-I5-11: 크롬·사파리 모두에 맞게 "브라우저가"
  '다음에 브라우저가 마이크 사용을 물으면 "허용"을 눌러 주세요.',
  // MOB1 D-MOB1-07: 방송 앱과 마이크가 겹치지 않게
  CONSENT_OTHER_DEVICE,
]
export const AUTO_CONFIRM_LABEL = '확실한 카드는 자동으로 등록'
export const AUTO_CONFIRM_HELP = '번호·품종·가격이 모두 확실한 카드만, 손대지 않으면 정한 시간 뒤 등록해요. 등록 뒤 5초 안에 되돌릴 수 있어요.'
export const SECONDS_LABEL = '기다리는 시간(초)'
/** 문자찜 설정 안내 (VOC-04 문자찜 카드) */
/** 후보 단추 키 안내 (U-V2-05, PC 폭) */
export const CANDIDATE_KEYS_HINT = '입력칸 밖에서 1·2·3 키로도 골라요'
/** 카드 Enter 표시 (U-V2-06) */
export const ENTER_BADGE = 'Enter 등록'
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
  return snapshot.phase === 'on' || snapshot.cards.length > 0 || snapshot.offers.length > 0 || snapshot.sms.some(smsShown) || snapshot.error !== null || snapshot.tooSoon || snapshot.flushedClosed.length > 0
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
  const wide = useWide()
  // Esc가 닫을 카드 (PC 폭에서만 표시, D-V1-20)
  const escTarget = wide ? voice.smsEscTarget() : null
  const listRef = useRef<HTMLUListElement>(null)
  // 맨 앞 카드 (상품 카드·문자찜 카드 — 목록 첫 줄)
  const first = items[0]
  const frontId = first === undefined ? null : first.kind === 'product' ? first.card.id : first.entry.card.id
  const seenFront = useRef<string | null>(frontId)
  const editing = snapshot.forms.size > 0
  // 1·2·3 키로 후보를 고를 카드 (PC 폭, U-V2-05)
  const keyCard = editing || typeof voice.keyCandidateCard !== 'function' ? null : voice.keyCandidateCard()
  // 휴대폰: 새 카드가 맨 앞에 생기면 보이게 내린다 (U-I5-02). PC는 고정 영역에 있어 늘 보인다(D-I4-03)
  useEffect(() => {
    if (frontId === seenFront.current) return
    seenFront.current = frontId
    if (wide || editing || frontId === null) return
    const element = listRef.current?.firstElementChild
    if (element instanceof HTMLElement) revealCard(element)
  }, [frontId, wide, editing])
  return (
    <section className="voice" aria-label="음성 등록">
      {on ? (
        <div className="voice-bar">
          <span className="voice-state" role="status">
            {snapshot.stateLabel}
          </span>
          {smsListening(snapshot) ? <span className="voice-sms-on">{voice.smsWords()?.listening}</span> : null}
          {/* 휴대폰 폭은 짧은 문장 (D-I5-16) — 늘 보인다 */}
          <span className="voice-sent">{wide ? SENT_NOTICE : SENT_NOTICE_SHORT}</span>
          <button type="button" className="button" onClick={() => voice.turnOff()}>
            음성 끄기
          </button>
        </div>
      ) : null}
      {on ? <HeardNow snapshot={snapshot} /> : null}
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
      {snapshot.offers.some((offer) => offer.kind !== 'card') ? (
        <ul className="plain-list stack-tight" aria-label="방금 등록한 상품 고치기">
          {snapshot.offers.filter((offer) => offer.kind !== 'card').map((offer) => (
            <OfferView key={offer.id} offer={offer} voice={voice} />
          ))}
        </ul>
      ) : null}
      {items.length > 0 ? (
        <ul ref={listRef} className="plain-list voice-cards" aria-label="음성 카드">
          {items.map((item) => {
            if (item.kind === 'sms') return <SmsCardView key={item.entry.card.id} entry={item.entry} voice={voice} on={on} esc={escTarget === item.entry.card.id} />
            const card = item.card
            const paused = on ? snapshot.paused.get(card.id) : undefined
            return (
            <VoiceCard
              key={card.id}
              card={card}
              described={voice.describe(card)}
              badge={badge === card.id}
              countdown={
                showsAutoCountdown(card, snapshot.settings, on) && card.autoConfirmAt !== null
                  ? autoSecondsLeft(card.autoConfirmAt, snapshot.now)
                  : paused !== undefined
                    ? Math.max(1, Math.ceil(paused / 1000))
                    : null
              }
              paused={paused !== undefined}
              info={snapshot.info.get(card.id) ?? null}
              note={snapshot.notes.get(card.id) ?? null}
              offer={typeof voice.cardOffer === 'function' ? (voice.cardOffer(card.id) ?? null) : null}
              keys={wide && keyCard === card.id}
              form={snapshot.forms.get(card.id) ?? null}
              voice={voice}
              onSubmitForm={onSubmitForm}
              onRegister={onRegister}
            />
            )
          })}
        </ul>
      ) : null}
      {/* 홈 화면 앱: 켜진 동안·오류로 멈춘 뒤 한 줄 (D-I5-05 — 막지 않는다). 좁은 화면에서 카드를 밀어내지 않게 카드 아래에 둔다 (U-I5-02) */}
      {(on || snapshot.error !== null) && isHomeScreenApp() ? <p className="voice-info">{STANDALONE_NOTICE}</p> : null}
    </section>
  )
}

/**
 * "들은 말" 칸 (D-V2-07, AC-V2-17): 모으는 글 + 지금 중간 결과(흐린 색), 모으는 동안 "듣는 중…", 덩어리를 읽으면 4초 동안 결과 한 줄.
 * 받아쓴 글은 React 기본 이스케이프로 글자로만 그린다
 */
function HeardNow({ snapshot }: { readonly snapshot: VoiceSnapshot }) {
  const hearing = snapshot.hearing
  const readout = snapshot.readout !== null && snapshot.readout.until > snapshot.now ? snapshot.readout : null
  return (
    <section className="voice-now" aria-label={HEARD_TITLE}>
      {/* 제목 없이 글만 (D-V2-21) */}
      {hearing !== null ? <p className="voice-now-hearing">{HEARING_LABEL}</p> : null}
      {hearing !== null ? (
        <div className="voice-now-box">
          <p className="voice-now-text">
            {hearing.collected}
            {hearing.collected !== '' && hearing.interim !== '' ? ' ' : null}
            {hearing.interim !== '' ? <span className="voice-now-interim">{hearing.interim}</span> : null}
          </p>
        </div>
      ) : readout === null ? (
        <p className="voice-now-empty">{HEARD_EMPTY}</p>
      ) : null}
      {readout !== null ? (
        <p className="voice-now-readout" role="status" data-discarded={readout.discarded ? 'true' : 'false'}>
          {readout.text}
        </p>
      ) : null}
    </section>
  )
}

/** 고칠까요·되돌릴까요·번호 안내 카드 (D-V2-06 3, AC-V2-26·27) — 누르기 전에는 상품이 바뀌지 않는다 */
function OfferView({ offer, voice }: { readonly offer: VoiceOffer; readonly voice: VoiceController }) {
  const busy = offer.stage === 'busy'
  let actions: ReactNode
  if (offer.kind === 'offer' && offer.stage !== 'fixed') {
    actions = (
      <>
        <button type="button" className="button button-primary" disabled={busy} onClick={() => void voice.fixOffer(offer.id)}>
          고치기
        </button>
        <button type="button" className="button" disabled={busy} onClick={() => voice.dismissOffer(offer.id)}>
          그대로 두기
        </button>
      </>
    )
  } else if (offer.stage === 'fixed') {
    actions = (
      <>
        <button type="button" className="button" disabled={busy} onClick={() => void voice.revertOffer(offer.id)}>
          되돌리기
        </button>
        <button type="button" className="button" onClick={() => voice.dismissOffer(offer.id)}>
          닫기
        </button>
      </>
    )
  } else if (offer.kind === 'undo') {
    actions = (
      <>
        <button type="button" className="button button-primary" onClick={() => voice.undoOffer(offer.id)}>
          되돌리기
        </button>
        <button type="button" className="button" onClick={() => voice.dismissOffer(offer.id)}>
          그대로 두기
        </button>
      </>
    )
  } else {
    actions = (
      <button type="button" className="button" onClick={() => voice.dismissOffer(offer.id)}>
        닫기
      </button>
    )
  }
  return (
    <li className="voice-card voice-offer" aria-label={offer.message}>
      <div className="voice-card-body">
        <p className="voice-card-text" role="status">
          <strong>{offer.message}</strong>
        </p>
        {offer.error !== null ? (
          <p className="field-error" role="alert">
            {offer.error}
          </p>
        ) : null}
      </div>
      <div className="voice-card-actions">{actions}</div>
    </li>
  )
}

/** [음성 기록] 창 (D-V2-08, AC-V2-28·29): 새것부터 시각·들은 말·읽은 것·한 일·버린 까닭. 그 탭 메모리에만 있다 */
function VoiceLogDialog({ voice, snapshot, onClose }: { readonly voice: VoiceController; readonly snapshot: VoiceSnapshot; readonly onClose: () => void }) {
  const lines = voice.logLines()
  return (
    <Modal
      title={LOG_TITLE}
      onClose={onClose}
      wide
      actions={
        <>
          <button type="button" className="button" disabled={lines.length === 0} onClick={() => voice.clearLog()}>
            기록 지우기
          </button>
          <button type="button" className="button" disabled={snapshot.learnedCount === 0} onClick={() => voice.clearLearned()}>
            배운 품종 이름 지우기
          </button>
        </>
      }
    >
      <p className="hint">이 기록은 이 화면에만 있어요. 새로 고치거나 화면을 떠나면 사라지고, 어디에도 보내지 않아요.</p>
      {lines.length === 0 ? (
        <p>아직 기록이 없어요.</p>
      ) : (
        <ol className="plain-list voice-log-list" aria-label="음성 기록 목록">
          {lines.map((line) => (
            <li key={line.key} className="voice-log-entry">
              <dl>
                <dt>시각</dt>
                <dd>{line.time}</dd>
                <dt>받아쓴 글</dt>
                <dd>
                  {line.pieces.map((piece, index) => (
                    <span key={`${String(index)}-${piece}`} className="voice-log-piece">
                      {index > 0 ? ' / ' : null}
                      {piece}
                    </span>
                  ))}
                </dd>
                {line.read !== null ? (
                  <>
                    <dt>읽은 것</dt>
                    <dd>
                      {line.read}
                      {line.candidates !== '' ? ` (후보: ${line.candidates})` : null}
                    </dd>
                  </>
                ) : null}
                <dt>한 일</dt>
                <dd>{line.action}</dd>
                {line.reason !== null ? (
                  <>
                    <dt>버린 까닭</dt>
                    <dd>{line.reason}</dd>
                  </>
                ) : null}
              </dl>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  )
}

interface VoiceCardProps {
  readonly card: SuggestionCard
  readonly described: string
  readonly badge: boolean
  readonly countdown: number | null
  /** 말하는 동안 자동 등록 기다림을 멈췄다 (D-V2-06) */
  readonly paused: boolean
  readonly info: CardInfo | null
  readonly note: string | null
  /** 이 카드 위 "12,000원을 18,000원으로 고칠까요?" (D-V2-19) */
  readonly offer: VoiceOffer | null
  /** 1·2·3 키로 후보를 고르는 카드 (PC 폭 맨 앞 카드, U-V2-05) */
  readonly keys: boolean
  readonly form: CardForm | null
  readonly voice: VoiceController
  readonly onSubmitForm: (id: string) => void
  readonly onRegister: (id: string) => void
}

function VoiceCard({ card, described, badge, countdown, paused, info, note, offer, keys, form, voice, onSubmitForm, onRegister }: VoiceCardProps) {
  const short = cardShortText(described)
  const low = card.confidence !== 'HIGH'
  // 끝에서 넘긴 문장 카드: 자동 등록되지 않으니 보통 카드와 겉모습을 다르게 하고 까닭을 쓴다 (D-I5-02, U-I5-01)
  const flushed = card.flushedAtEnd === true
  const formId = useId()
  return (
    <li className={low || flushed ? 'voice-card voice-card-low' : 'voice-card'} aria-label={`${short} 카드`}>
      {offer !== null ? (
        <div className="voice-card-confirm" role="group" aria-label={offer.message}>
          <p role="status">
            <strong>{offer.message}</strong>
          </p>
          {offer.error !== null ? (
            <p className="field-error" role="alert">
              {offer.error}
            </p>
          ) : null}
          <div className="voice-card-actions">
            <button type="button" className="button button-primary" onClick={() => voice.fixCardOffer(offer.id)}>
              고치기
            </button>
            <button type="button" className="button" onClick={() => voice.dismissOffer(offer.id)}>
              그대로 두기
            </button>
          </div>
        </div>
      ) : null}
      <div className="voice-card-body">
        <p className="voice-card-text">
          <strong>{described}</strong>
          {low || flushed ? <span className="tag tag-waiting">확인 필요</span> : null}
          {card.name === null ? <span className="tag tag-waiting">{NAME_CHECK}</span> : null}
          {badge ? <span className="tag tag-order">{ENTER_BADGE}</span> : null}
        </p>
        <p className="voice-card-heard">들은 말: {card.text}</p>
        {info !== null && info.ask !== null ? <p className="voice-card-ask">{info.ask}</p> : null}
        {flushed ? <p className="voice-card-why">{FLUSHED_CARD_NOTE}</p> : null}
        {card.name === null && info !== null && info.candidates.length > 0 ? (
          <div className="voice-candidates" role="group" aria-label={`${short} 품종 후보`}>
            <span className="voice-candidates-ask">혹시 이 품종인가요? 누르면 채워져요</span>
            <div className="voice-candidates-list">
              {info.candidates.map((candidate, index) => (
                <button
                  key={candidate.name}
                  type="button"
                  className="button voice-candidate"
                  data-key={keys && index < 3 ? String(index + 1) : undefined}
                  onClick={() => voice.chooseCandidate(card.id, candidate.name)}
                >
                  {candidate.name}
                </button>
              ))}
            </div>
            {keys ? <span className="hint">{CANDIDATE_KEYS_HINT}</span> : null}
          </div>
        ) : null}
        {countdown !== null ? <p className="voice-card-auto">{countdown}초 뒤 자동 등록{paused ? ` · ${AUTO_PAUSED_NOTE}` : ''}</p> : null}
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
function SmsCardView({ entry, voice, on, esc }: { readonly entry: SmsEntry; readonly voice: VoiceController; readonly on: boolean; readonly esc: boolean }) {
  const words = voice.smsWords()
  if (words === null) return null
  const { card } = entry
  const reasonCard = entry.reason !== null && !entry.sending
  // 이유 카드 제목은 번호·손님 글 없이 (D-V1-21) — 이유 문장이 번호를 말한다
  const described = reasonCard ? SMS_REASON_TITLE : voice.describeSms(card)
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
        {entry.choose ?? words.choose(card.reading.last4)}
      </p>
    )
    actions = (
      <>
        {button(labels.skip, () => voice.smsSkip(card.id))}
        <SmsCandidates candidates={card.candidates} short={short} onChoose={(buyer) => voice.smsChoose(card.id, buyer)} />
        {card.reading.last4 !== null ? button(SMS_NEW_BUYER, () => voice.smsNewBuyer(card.id), true) : null}
      </>
    )
  } else if (countdown !== null) {
    body = <p className="voice-card-auto">{countdown}</p>
    actions = (
      <>
        {button(labels.skip, () => voice.smsSkip(card.id))}
        {esc ? (
          <span className="tag tag-order" aria-hidden="true">
            Esc
          </span>
        ) : null}
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
        {button(labels.skip, () => voice.smsSkip(card.id))}
        {button(labels.send, () => voice.smsSend(card.id), true)}
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
        {sent && !entry.sending && smsUnknownBuyer(entry) && entry.results.length > 0 ? <p className="hint">{SMS_UNKNOWN_BUYER_NOTE}</p> : null}
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

/** 409 후보 (처음 생긴 순서): "문자찜(김씨) · 끝자리 1234 · 15번·22번" — 같은 표시 이름이면 구매자 목록과 같은 구분 표기(BuyerNames), 찜 번호로도 가른다(D-V1-14) */
function SmsCandidates({ candidates, short, onChoose }: { readonly candidates: readonly SmsBuyerCandidate[]; readonly short: string; readonly onChoose: (buyer: string) => void }) {
  const api = useConsoleApi()
  return (
    <>
      {candidates.map((candidate) => {
        const known = api.data.buyers.has(candidate.buyer)
        const name = known ? api.names.name(candidate.buyer) : candidate.display
        const label = smsCandidateLabel(name, candidate.phoneLast4, candidateClaims(candidate))
        return (
          <button key={candidate.buyer} type="button" className="button button-primary" aria-label={`${short} 손님 고르기: ${label}`} onClick={() => onChoose(candidate.buyer)}>
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
  const suffix = smsLast4Suffix(body, last4)
  return (
    <li className="sms-result" data-tone={tone}>
      <p role="status">
        <strong>{body}</strong>
        {suffix !== null ? <span>{suffix}</span> : null}
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
      <legend>고치기 — Enter 키로 등록 · Esc 키로 닫기</legend>
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

/**
 * 음성 칸 바로 아래 접는 칸 "음성 설정과 기록" (D-V2-21, 기본 접힘): 켜진 동안의 설정(자동 확정·조용한 시간)과 [음성 기록]. 자주 쓰는 문자찜 설정은 접는 칸 밖(위)에 늘 보인다.
 * 접는 칸을 연 채로 두는지는 이 화면에만 기억한다
 */
export function VoiceExtras({ voice, snapshot }: { readonly voice: VoiceController; readonly snapshot: VoiceSnapshot }) {
  const on = snapshot.phase === 'on'
  const settings = snapshot.settings
  const smsSettings = snapshot.smsSettings
  const smsWords = voice.smsWords()
  const [logOpen, setLogOpen] = useState(false)
  const [open, setOpen] = useState(false)
  if (!on && !snapshot.everOn) return null
  return (
    <section className="voice-extras" aria-label={EXTRAS_TITLE}>
          {on && smsSettings !== null && smsWords !== null ? (
            <div className="voice-settings voice-sms-settings">
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
            </div>
          ) : null}
      <details className="details" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>{EXTRAS_TITLE}</summary>
        <div className="voice-extras-body">
      {snapshot.everOn ? (
        <button type="button" className="button" onClick={() => setLogOpen(true)}>
          {LOG_TITLE}
        </button>
      ) : null}
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
          <label className="voice-seconds">
            <span>{QUIET_LABEL}</span>
            <input className="input" inputMode="decimal" autoComplete="off" value={snapshot.quietText} onChange={(event) => voice.setQuietSeconds(event.target.value)} />
          </label>
          {snapshot.quietProblem !== null ? (
            <p className="field-error" role="alert">
              {snapshot.quietProblem}
            </p>
          ) : (
            <p className="hint">{QUIET_HELP}</p>
          )}
        </div>
      ) : null}
        </div>
      </details>
      {logOpen ? <VoiceLogDialog voice={voice} snapshot={snapshot} onClose={() => setLogOpen(false)} /> : null}
    </section>
  )
}
