// 라이브 콘솔의 휴대폰 알림 받기 (SMS3 ORD-13, D-SMS3-12·14, AC-SMS3-16·17·30·31).
// - "문자 확인" 칸: 확인 필요·취소 요청 카드를 받은 순서로(새것 아래). 카드가 없으면 칸을 그리지 않는다(접음).
//   카드: 받은 시각 · 뒤 4자리(또는 "이름만 와서 누가 보냈는지 몰라요") · 본문(React 기본 이스케이프) · 사유 문장 · 번호 단추 · "넣기"/"승인" · "무시".
//   옵션 방송에서 넣을 때는 문자찜 입력과 같은 옵션·수량 칸을 거친다(AC-SMS3-17). 취소는 늘 판매자가 "승인"해야 한다.
//   이름만 온 문자의 취소 요청은 "승인"이 없다 — "보드에서 직접 취소해 주세요" 안내와 "무시"만 (D-SMS3-19).
// - 받기 멈춤 알림(고정 영역): 토큰이 켜진 판매자의 실제 방송에서 10분 넘게 받은 것이 없으면. 닫으면 그 방송에서 다시 안 보이고, 무엇이든 받으면 사라진다.
// - 실시간 알림 `inbox`(cards·received·settings)와 다시 붙음에 다시 읽고, 시계는 30초마다 다시 본다.
import { DEFAULT_SETTINGS } from '@livejjim/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isApiError, type ApiError } from '../api/client.ts'
import type { InboxCardView, InboxSettingsView, InboxStaleNotice } from '../api/inbox-types.ts'
import type { Claim } from '../api/types.ts'
import { isOptionBroadcast, productKey } from '../lib/derive.ts'
import {
  INBOX_CANCEL_NAME_ONLY,
  INBOX_LATE_LAST,
  INBOX_NO_PHONE,
  INBOX_STALL_IPHONE,
  cancelNeedsBoard,
  cardIsLate,
  nameOnlyInsertWords,
  nameOnlySender,
  staleDetailWords,
  INBOX_NO_CLAIM,
  INBOX_PANEL_TITLE,
  INBOX_PICK_NUMBER,
  INBOX_STALE,
  INBOX_STALL,
  closeStaleNotice,
  closeStall,
  inboxArrivedWords,
  fetchInboxCards,
  fetchInboxSettings,
  inboxReasonWords,
  inboxSenderWords,
  inboxStalled,
  inboxTimeWords,
  orderCards,
  sendCardAction,
  stallClosed,
  type InboxAction,
  type InsertInput,
} from '../lib/inbox.ts'
import { useLiveEvents } from '../lib/live-events.ts'
import { qtyProblemWords, readQty, variantTextOf } from '../lib/options.ts'
import { useConsoleApi, type ConsoleApi } from './console-context.ts'
import { successionNote } from './AlertDialogs.tsx'
import { ErrorNote } from './ErrorNote.tsx'
import { Modal } from './Modal.tsx'
import { OptionQtyFields } from './SmsPage.tsx'

const TICK_MS = 30_000
const NO_IDS: ReadonlySet<string> = new Set()

export interface InboxConsoleHandle {
  /** 처리 안 한 카드 (받은 순서) — 읽기 전·칸이 없는 서버는 빈 목록 */
  readonly cards: readonly InboxCardView[]
  /** 받기 설정 (칸이 없는 서버는 null — 받기 멈춤 알림을 보이지 않는다) */
  readonly settings: InboxSettingsView | null
  /** 휴대폰 알림으로 넣은 찜 ID ("문자로 받음", 서버 cards 응답 `inboxClaimIds`) */
  readonly claimIds: ReadonlySet<string>
  /** 12시간 넘은 방송 알림 (cards 응답 `staleBroadcast` — 방송과 상관없이 판매자 것, D-SMS3-29) */
  readonly stale: InboxStaleNotice | null
  /** 12시간 넘은 방송 알림을 닫은 뒤 (서버가 null로 준다) */
  readonly clearStale: () => void
  /** 받기 멈춤을 재기 시작한 때: 서버가 준 방송 시작 시각(새로고침해도 같다). 아직 모르거나 이 기기 시계가 서버보다 늦으면 이 콘솔을 연 때 — 늦게 보일 수는 있어도 일찍 보이지 않는다 */
  readonly since: string
  /** 카드·찜 ID만 다시 읽기 (보드에 모르는 문자찜이 보일 때) */
  readonly reloadCards: () => Promise<void>
  readonly now: number
  readonly reload: () => Promise<void>
}

/** 콘솔의 휴대폰 알림 받기 (리허설은 enabled=false — 봉인한 날짜는 카드를 볼 수만 있게 켠다) */
export function useInboxConsole(broadcast: string, enabled: boolean, clock: () => number = Date.now): InboxConsoleHandle {
  const [cards, setCards] = useState<readonly InboxCardView[]>([])
  const [settings, setSettings] = useState<InboxSettingsView | null>(null)
  const [now, setNow] = useState(() => clock())
  const [opened] = useState(() => new Date(clock()).toISOString())
  const [claimIds, setClaimIds] = useState<ReadonlySet<string>>(NO_IDS)
  const [startedAt, setStartedAt] = useState<string | null>(null)
  const [stale, setStale] = useState<InboxStaleNotice | null>(null)
  // 방송 시작 시각(서버 시계)과 이 콘솔을 연 때(이 기기 시계) 중 이른 쪽. 콘솔은 방송 시작 뒤에 열리므로, 연 때가 더 이르면
  // 이 기기 시계가 서버보다 늦은 것이다 — 그때는 연 때가 더 가까운 값이고, 어느 쪽이든 일찍 보이지는 않는다
  const since = startedAt !== null && Date.parse(startedAt) < Date.parse(opened) ? startedAt : opened
  const version = useRef(0)
  const reloadCards = useCallback(async () => {
    const mine = ++version.current
    try {
      const next = await fetchInboxCards(broadcast)
      if (mine === version.current) {
        setCards(next.cards)
        setClaimIds(next.claimIds)
        setStale(next.stale)
        if (next.startedAt !== null) setStartedAt(next.startedAt)
      }
    } catch (caught) {
      // 읽지 못하면 지난 것을 그대로 둔다(칸이 없는 옛 서버는 404 — 칸을 그리지 않는다)
      if (!isApiError(caught)) throw caught
      if (mine === version.current && (caught.status === 403 || caught.status === 404)) {
        setCards([])
        setClaimIds(NO_IDS)
        setStale(null)
      }
    }
  }, [broadcast])
  const reloadSettings = useCallback(async () => {
    try {
      setSettings(await fetchInboxSettings())
    } catch (caught) {
      // 권한 없음(403)·옛 서버(404)는 받기 멈춤 알림이 없다
      if (!isApiError(caught)) throw caught
      if (caught.status === 403 || caught.status === 404) setSettings(null)
    }
  }, [])
  const reload = useCallback(async () => {
    await Promise.all([reloadCards(), reloadSettings()])
  }, [reloadCards, reloadSettings])
  useEffect(() => {
    setCards([])
    setClaimIds(NO_IDS)
    setStartedAt(null)
    setStale(null)
    if (enabled) void reload()
  }, [enabled, reload])
  useEffect(() => {
    if (!enabled) return
    const timer = setInterval(() => setNow(clock()), TICK_MS)
    return () => clearInterval(timer)
  }, [enabled, clock])
  useLiveEvents(
    {
      onInbox: (event) => {
        if (event.kind === 'cards') {
          if (event.b === null || event.b === broadcast) void reloadCards()
        } else if (event.kind === 'received') {
          setNow(clock())
          // 바로 넣은 문자찜이 있을 수 있다 — "문자로 받음" 찜 ID를 다시 읽는다
          void reloadCards()
          setSettings((current) => (current === null ? current : { ...current, lastReceivedAt: event.lastReceivedAt ?? current.lastReceivedAt, lastDevice: event.lastDevice ?? current.lastDevice }))
        } else {
          // 설정 바뀜 — 12시간 넘은 방송 알림이 생기거나 닫혔을 수 있다(cards 응답에 함께 온다, D-SMS3-29)
          void reload()
        }
      },
      onReconnect: () => void reload(),
    },
    enabled,
  )
  const clearStale = useCallback(() => {
    version.current++
    setStale(null)
  }, [])
  return { cards, claimIds, stale, clearStale, settings, since, now, reload, reloadCards }
}

// ── 받기 멈춤 알림 (AC-SMS3-31) ───────────────────────────────────────────

export function InboxStallBar({ handle, broadcast, rehearsal, ended }: { readonly handle: InboxConsoleHandle; readonly broadcast: string; readonly rehearsal: boolean; readonly ended: boolean }) {
  const [closed, setClosed] = useState(() => stallClosed(broadcast))
  useEffect(() => setClosed(stallClosed(broadcast)), [broadcast])
  const settings = handle.settings
  const receiving = settings === null ? null : { enabled: settings.enabled, lastReceivedAt: settings.lastReceivedAt, startedAt: handle.since }
  if (closed || !inboxStalled(receiving, { rehearsal, ended }, handle.now)) return null
  return (
    <div className="connection-banner inbox-stall" role="alert" data-tone="warning">
      <span className="inbox-bar-text">
        ! {INBOX_STALL} <span className="inbox-bar-more">{INBOX_STALL_IPHONE}</span>
      </span>
      <button
        type="button"
        className="button"
        onClick={() => {
          closeStall(broadcast)
          setClosed(true)
        }}
      >
        닫기
      </button>
    </div>
  )
}

// ── 12시간 넘은 방송 알림 (D-SMS3-29) ─────────────────────────────────────

/**
 * "끝내지 않은 방송이 12시간 넘게 이어져 손님 문자를 넣지 않았어요. 방송을 끝내 주세요." — 콘솔 위·설정 받기 상태.
 * 그 방송을 끝내면 서버가 지운다. "닫기"는 서버에 닫았다고 적는다(판매자만 — 403이면 단추만 숨긴다). 닫은 뒤 또 넣지 않은 문자가 오면 서버가 다시 준다.
 */
export function InboxStaleBar({
  stale,
  onClosed,
  banner = true,
  titleOf,
  onGo,
}: {
  readonly stale: InboxStaleNotice | null
  readonly onClosed: (inbox: InboxSettingsView | null) => void
  readonly banner?: boolean
  /** 그 방송의 이름 (이 화면이 아는 방송만 — 모르면 시작 시각으로) */
  readonly titleOf?: (b: string) => string | null
  /** "그 방송으로 가기" (콘솔에서 다른 방송일 때만) */
  readonly onGo?: (b: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [cannotClose, setCannotClose] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  if (stale === null) return null
  const detail = staleDetailWords(stale, titleOf?.(stale.b) ?? null)
  const close = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      onClosed(await closeStaleNotice())
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      if (caught.status === 403) setCannotClose(true)
      else if (caught.status === 404) onClosed(null)
      else setError(caught)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={banner ? 'connection-banner inbox-stale' : 'stack-tight inbox-stale'} role="alert" data-tone="warning">
      <span className={banner ? 'inbox-bar-text' : 'inbox-bar-text warning'}>
        ! {INBOX_STALE}
        {detail === '' ? null : (
          <>
            {' '}
            <span className="inbox-bar-more">({detail})</span>
          </>
        )}
      </span>
      {onGo === undefined ? null : (
        <button type="button" className="button" onClick={() => onGo(stale.b)}>
          그 방송으로 가기
        </button>
      )}
      {cannotClose ? null : (
        <button type="button" className="button" disabled={busy} onClick={() => void close()}>
          닫기
        </button>
      )}
      {error !== null ? <ErrorNote error={error} /> : null}
    </div>
  )
}

// ── "문자 확인" 칸 (AC-SMS3-30) ────────────────────────────────────────────

/** 문자 확인 칸의 id (콘솔 위 알림 줄 "확인할 문자 n"이 이리로 내려온다 — UX-SMS3-005) */
export const INBOX_PANEL_ID = 'sms-inbox'

/** 콘솔 위 알림 줄 글 "확인할 문자 3" (카드가 없으면 null) */
export function inboxLeadWords(count: number): string | null {
  return count > 0 ? `확인할 문자 ${String(count)}` : null
}

/** 문자 확인 칸으로 내려가 칸에 포커스 — 위 고정 영역(콘솔 머리)에 가리지 않게 그 높이만큼 덜 내려간다 */
export function goToInboxPanel(): void {
  const panel = document.getElementById(INBOX_PANEL_ID)
  if (panel === null) return
  const sticky = document.querySelector<HTMLElement>('.console-sticky')
  const cover = sticky === null || getComputedStyle(sticky).position !== 'sticky' ? 0 : sticky.getBoundingClientRect().height
  const top = panel.getBoundingClientRect().top + window.scrollY - cover - 8
  if (typeof window.scrollTo === 'function') {
    try {
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
    } catch {
      // 시험 환경 등 scrollTo가 없으면 그대로
    }
  }
  panel.focus({ preventScroll: true })
}

/**
 * readOnly(봉인한 날짜): 카드는 보이되 넣기·승인은 없다 — 볼 수만 있고 "무시"로 닫을 수는 있다(엔진 기록 없음, D-SMS3-31 거절 카드를 보이게).
 */
export function SmsInboxPanel({ handle, readOnly }: { readonly handle: InboxConsoleHandle; readonly readOnly: boolean }) {
  const cards = useMemo(() => orderCards(handle.cards), [handle.cards])
  if (cards.length === 0) return null
  return (
    <section id={INBOX_PANEL_ID} tabIndex={-1} className="card stack inbox-panel" aria-label={INBOX_PANEL_TITLE}>
      <h2 className="section-title">
        {INBOX_PANEL_TITLE} ({cards.length}개)
      </h2>
      <ol className="plain-list inbox-cards">
        {cards.map((card) => (
          <InboxCard key={card.id} card={card} readOnly={readOnly} onDone={() => void handle.reload()} />
        ))}
      </ol>
    </section>
  )
}

function InboxCard({ card, readOnly, onDone }: { readonly card: InboxCardView; readonly readOnly: boolean; readonly onDone: () => void }) {
  const api = useConsoleApi()
  const [picked, setPicked] = useState<number | null>(card.numbers.length === 1 ? (card.numbers[0] ?? null) : null)
  const [picks, setPicks] = useState<Record<string, string>>({})
  const [qtyText, setQtyText] = useState('1')
  const [pressed, setPressed] = useState<InboxAction | null>(null)
  const [failed, setFailed] = useState<{ readonly action: InboxAction; readonly error: ApiError } | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [tried, setTried] = useState(false)

  const review = card.kind === 'REVIEW'
  // 이름만 온 문자의 취소 요청: 승인 없이 안내와 "무시"만 (D-SMS3-19)
  const boardOnly = cancelNeedsBoard(card)
  const optionMode = review && isOptionBroadcast(api.data, api.b)
  const product = picked === null ? undefined : api.data.products.get(productKey(api.b, picked))
  const maxQty = api.settingsOf(api.b)?.['claim.maxQuantity'] ?? DEFAULT_SETTINGS['claim.maxQuantity']
  const qty = optionMode ? readQty(qtyText, maxQty) : 1
  const qtyProblem = optionMode && qty === null ? qtyProblemWords(maxQty) : null
  // 선택지 하나뿐인 항목은 자동 (문자찜 입력과 같다)
  const effectivePicks: Record<string, string> = {}
  if (optionMode && product !== undefined) {
    for (const option of product.options) {
      const label = picks[option.name]
      if (label !== undefined && option.choices.some((choice) => choice.label === label)) effectivePicks[option.name] = label
      else if (option.choices.length === 1 && option.choices[0] !== undefined) effectivePicks[option.name] = option.choices[0].label
    }
  }
  const optionsMissing = optionMode && product !== undefined && product.hasOptions && variantTextOf(product, effectivePicks) === null
  const busy = pressed !== null
  const locked = busy || readOnly
  const [asking, setAsking] = useState(false)

  const send = async (action: InboxAction) => {
    if (busy) return
    // 봉인한 날짜: 넣기·승인은 보내지 않는다 (무시는 엔진 기록이 없어 된다)
    if (readOnly && action !== 'ignore') return
    if (action === 'approve' && boardOnly) return
    setAsking(false)
    setNote(null)
    setFailed(null)
    let input: InsertInput | undefined
    if (action === 'insert') {
      setTried(true)
      if (picked === null) {
        setNote(INBOX_PICK_NUMBER)
        return
      }
      if (qtyProblem !== null || optionsMissing) return
      input = {
        no: picked,
        ...(optionMode ? { qty: qty ?? 1 } : {}),
        ...(optionMode && product !== undefined && product.hasOptions ? { options: { ...effectivePicks } } : {}),
      }
    }
    setPressed(action)
    try {
      await sendCardAction(card.id, action, input)
      onDone()
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      // 찜이 없는 취소 요청: 엔진 기록 없음, 카드는 남는다 — "무시"로 닫는다 (AC-SMS3-16)
      if (action === 'approve' && caught.code === 'NO_CLAIM') setNote(INBOX_NO_CLAIM)
      // 이미 처리된 카드(다른 기기): 목록을 다시 읽는다
      else if (caught.status === 404 || caught.code === 'CARD_DONE') onDone()
      else setFailed({ action, error: caught })
    } finally {
      setPressed(null)
    }
  }

  const reason = inboxReasonWords(card)
  const sender = inboxSenderWords(card)
  const late = cardIsLate(card)
  // 늦게 온 문자: 휴대폰이 받은 시각은 사유 문장에 한 번만 — 머리에는 서버에 온 시각(받은 순서)만 (UX-SMS3-008)
  const arrived = inboxArrivedWords(card)
  const time = late && arrived !== '' ? arrived : inboxTimeWords(card)
  const contact = nameOnlySender(card)
  const insertAs = review ? nameOnlyInsertWords(card) : null
  // 번호 후보가 하나면 알약 없이 "N번에 넣기"만 (UX-SMS3-009)
  const pills = review && !readOnly && card.numbers.length > 1
  return (
    <li className={review ? 'inbox-card stack-tight' : 'inbox-card inbox-cancel stack-tight'} aria-label={`${time} ${review ? '확인 필요' : '취소 요청'}`}>
      <p className="inbox-meta">
        <span className={review ? 'tag tag-waiting' : 'tag tag-alert'}>{review ? '확인 필요' : '취소 요청'}</span> <span>{time}</span>
        {/* 이름만 온 취소 요청은 아래 안내 문장에, 이름만 온 확인 필요는 사유 줄에 같은 글이 있다 — 한 번만 (D-SMS3-16, UX-SMS3-004) */}
        {boardOnly || reason === sender ? null : <> <span>{sender}</span></>}
      </p>
      {/* 사유 줄 — 굵게, 모든 카드에 (UX-SMS3-004) */}
      <p className="inbox-reason">
        <strong>{reason}</strong>
      </p>
      {late ? <p className="hint">{INBOX_LATE_LAST}</p> : null}
      {/* 이름만 온 문자: 연락처 이름은 왔지만 전화번호는 오지 않았다 — 사유 문장과 어긋나지 않게 (UX-SMS3-004) */}
      {contact !== null ? (
        <p className="hint">
          연락처 이름: {contact} <span>{INBOX_NO_PHONE}</span>
        </p>
      ) : null}
      {/* 손님이 보낸 글 — React 기본 이스케이프로만 */}
      <p className="inbox-text">{card.text}</p>
      {insertAs !== null && !readOnly ? <p className="hint">{insertAs}</p> : null}
      {pills ? (
        <div className="row inbox-numbers" role="group" aria-label="넣을 번호">
          {card.numbers.map((no) => (
            <button key={no} type="button" className={picked === no ? 'button button-primary' : 'button'} aria-pressed={picked === no} disabled={locked} onClick={() => setPicked(no)}>
              {no}번
            </button>
          ))}
        </div>
      ) : null}
      {review && !readOnly && card.numbers.length === 0 ? <NumberField onChange={setPicked} disabled={locked} /> : null}
      {optionMode && !readOnly && picked !== null ? (
        <OptionQtyFields
          product={product}
          picks={picks}
          onPick={(name, value) => setPicks((current) => ({ ...current, [name]: value }))}
          qtyText={qtyText}
          onQty={setQtyText}
          qtyProblem={qtyProblem}
          optionsProblem={tried && optionsMissing ? '옵션을 모두 골라 주세요.' : null}
          disabled={readOnly}
          locked={busy}
        />
      ) : null}
      {boardOnly ? (
        <p className="warning" role="status">
          ! {INBOX_CANCEL_NAME_ONLY}
        </p>
      ) : null}
      {note !== null ? (
        <p className="warning" role="status">
          ! {note}
        </p>
      ) : null}
      {failed !== null ? <ErrorNote error={failed.error} {...(failed.error.transient ? { onRetry: () => void send(failed.action) } : {})} /> : null}
      {readOnly ? <p className="hint">{INBOX_SEALED_NOTE}</p> : null}
      <div className="row inbox-actions">
        {readOnly ? null : review ? (
          <button type="button" className="button button-primary" disabled={locked} onClick={() => void send('insert')}>
            {pressed === 'insert' ? '넣는 중…' : picked === null ? '넣기' : `${String(picked)}번에 넣기`}
          </button>
        ) : boardOnly ? null : (
          // 승인은 확인 창을 거친다 — 누구의 몇 번 찜이 취소되고 누가 이어받는지 보이고 (UX-SMS3-006)
          <button type="button" className="button button-primary" disabled={locked} onClick={() => setAsking(true)}>
            {pressed === 'approve' ? '승인하는 중…' : '승인'}
          </button>
        )}
        <button type="button" className="button" disabled={busy} onClick={() => void send('ignore')}>
          무시
        </button>
      </div>
      {asking && !boardOnly && !readOnly ? (
        <Modal
          title="찜을 취소할까요?"
          onClose={() => setAsking(false)}
          closeLabel="그대로 두기"
          actions={
            <button type="button" className="button button-danger" disabled={busy} onClick={() => void send('approve')}>
              찜 취소하기
            </button>
          }
        >
          {approveQuestion(api, card).map((line) => (
            <p key={line}>{line}</p>
          ))}
        </Modal>
      ) : null}
    </li>
  )
}

/** 봉인한 날짜의 카드 안내 */
export const INBOX_SEALED_NOTE = '보관만 하는 날짜라 넣거나 승인할 수 없어요. 보드에서 확인하고 "무시"로 닫아 주세요.'

/** 살아 있는 찜 (취소·거절 아님) */
const LIVE_STATUS: ReadonlySet<string> = new Set(['CONFIRMED', 'WAITLISTED', 'PENDING', 'CONFLICT'])

/**
 * 취소 요청 승인 확인 창의 문장 (UX-SMS3-006) — 이 화면의 자료로: 그 방송의 그 번호에서 뒤 4자리가 같은 문자 구매자의 살아 있는 찜.
 * "15번 문자찜(홍길동) 님 찜을 취소할까요?" + 1등이면 승계 설정대로 "승인하면 대기 1순위가 1등이 돼요" 등.
 * 화면에서 찾지 못하면(아직 따라잡지 못함·뒤 4자리가 같은 손님이 여럿) 번호와 뒤 4자리로만 묻는다 — 서버가 정한 손님의 찜이 취소된다.
 */
export function approveQuestion(api: ConsoleApi, card: Pick<InboxCardView, 'numbers' | 'last4'>): string[] {
  const no = card.numbers[0]
  const last4 = card.last4?.trim() ?? ''
  const label = no === undefined ? '이' : `${String(no)}번`
  const found: { readonly claim: Claim }[] = []
  if (no !== undefined && last4 !== '') {
    for (const claim of api.data.claims.values()) {
      if (claim.broadcast !== api.b || claim.no !== no || claim.origin !== 'sms' || !LIVE_STATUS.has(claim.status)) continue
      const own = api.data.buyers.get(claim.buyer)
      const now = api.data.buyers.get(claim.currentBuyer)
      if (own?.phoneLast4 === last4 || now?.phoneLast4 === last4) found.push({ claim })
    }
  }
  const buyers = new Set(found.map((item) => item.claim.currentBuyer))
  const one = buyers.size === 1 ? found[0]?.claim : undefined
  if (one === undefined) return [`${label} 찜(뒤 4자리 ${last4 === '' ? '모름' : last4} 손님)을 취소할까요?`]
  const name = api.names.name(one.currentBuyer)
  const confirmed = found.find((item) => item.claim.status === 'CONFIRMED')?.claim
  const product = api.data.products.get((confirmed ?? one).product)
  const rank = confirmed !== undefined ? '1등 ' : one.status === 'WAITLISTED' ? '대기 ' : ''
  const lines = [`${label} ${name} 님 ${rank}찜을 취소할까요?`]
  const note = successionNote(api, product, confirmed)
  if (note !== null) lines.push(note)
  return lines
}

/** 번호 후보가 없을 때 번호를 직접 (숫자 키패드) */
function NumberField({ onChange, disabled }: { readonly onChange: (no: number | null) => void; readonly disabled: boolean }) {
  const [text, setText] = useState('')
  return (
    <div className="field">
      <label>
        넣을 번호
        <input
          className="input input-number"
          inputMode="numeric"
          autoComplete="off"
          value={text}
          disabled={disabled}
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, '').slice(0, 4)
            setText(digits)
            const no = Number(digits)
            onChange(digits === '' || !Number.isInteger(no) || no < 1 ? null : no)
          }}
        />
      </label>
    </div>
  )
}
