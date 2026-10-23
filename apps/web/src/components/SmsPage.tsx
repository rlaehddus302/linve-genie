// 문자찜 입력 (SPEC §7 화면 6, ORD-08, BUY-02, R-0 5, R-1, R-5, R-6, R-11, D-023, D-089, D-099, D-102, AC-S06-10~15, AC-S06b-22·30·31·32·40).
// - 방송: 끝나지 않은 실제 방송 중 가장 최근 것이 기본(날짜가 늦은 것, 같으면 나중에 만든 것). 없으면 직접 고른다. 고른 방송은 화면을 연 동안 그대로다.
// - 칸: 번호(숫자 키패드) · 받은 시각(비우면 서버가 도착 시각을 초까지) · 전화번호(뒤 4자리만 보인다) · 메모 · 구매자 고르기.
// - "15번에 문자찜 넣기"는 바로 보낸다(5초 대기 없음) — 같은 요청 번호로 재시도, 결과 카드(찜의 지금 상태)·"찜 취소하기"(5초 뒤)·"같은 사람 하나 더".
//   찜이 생기지 않았으면 쓰기 응답의 buyer(엔진이 정한 구매자 자신, D-099)로 "이미 찜한 구매자라…"와 "같은 사람 하나 더"를 정한다 — 뒤 4자리로 짐작하지 않는다.
// - 받은 시각은 날짜와 함께 "10/18 20:01:05"(엔진이 R-6으로 정한 날, KST). 방송 고르기의 날짜는 연도·요일까지, 고른 방송은 "✓ 고름".
// - 보낸 뒤 칸을 모두 비운다(전화번호 원문을 화면 상태에 남기지 않는다). 아래에 고른 방송의 최근 문자찜 10개.
// - D-SMS-01 (AC-SMS-01~04): 보내는 동안(응답 전) 칸을 읽기 전용으로 잠그고 "보내는 중이라 잠시 고칠 수 없어요.", 성공 응답이 오면
//   화면 따라잡기를 기다리지 않고 바로 칸을 비운다. 실패하면 칸은 친 그대로. 결과 카드는 그 seq를 따라잡기 전에는 "상태 확인 중…".
// - I3: 30일이 지나 봉인한 날짜의 방송은 고를 수 없다(기본 방송으로도 고르지 않는다, AC-I3-41). 보조자 계정은 실제 방송만 고르고
//   허용된 요청(방송 목록·범위 목록·범위 조회·실시간)만 보낸다(AC-I3-63).
// - N2b-2: "댓글 붙여넣기" — 콘솔과 같은 붙여넣기 창(번호마다 문자찜). 보조자도 실제 방송에서 쓴다(서버 권한이 문자찜 입력과 같다).
import { DEFAULT_SETTINGS, containsPhoneRun, normalizePhone, phoneLast4, type ClaimStatus } from '@livejjim/core'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { get, isApiError, type ApiError } from '../api/client.ts'
import type { BroadcastItem, Buyer, Claim, DayRow, Product, ReviewsView } from '../api/types.ts'
import { qtyProblemWords, readQty, variantTextOf } from '../lib/options.ts'
import { reviewsPath } from '../lib/reviews.ts'
import { activeClaimOf, distinguishWords, isActive, sameNameCounts, searchBuyers } from '../lib/buyers.ts'
import type { ConsoleSnapshot, ConsoleStore } from '../lib/console-store.ts'
import { claimOptionWords, claimWord, formatWon, isOptionBroadcast, productKey } from '../lib/derive.ts'
import { useUndoQueue } from '../lib/host-delay.ts'
import { broadcastWords, kstStamp } from '../lib/kst.ts'
import { RECEIVED_HELP, RECEIVED_INVALID, readReceived, receivedWords } from '../lib/received.ts'
import type { Navigate } from '../lib/router.ts'
import type { ScopeData } from '../lib/scope-data.ts'
import { useScopeStore } from '../lib/use-store.ts'
import type { UndoQueue } from '../lib/undo-queue.ts'
import { PRODUCT_STATUS_WORD } from '../lib/words.ts'
import { buyerPlatformWord } from '../lib/platforms.ts'
import { openClaimAction } from './actions.ts'
import type { ConsoleApi } from './console-context.ts'
import { ErrorNote } from './ErrorNote.tsx'
import { FieldNote, WriteError, serverProblem, useSender } from './forms.tsx'
import { useHostActions } from './host-actions.tsx'
import { LiveNotices } from './LiveNotices.tsx'
import { Modal } from './Modal.tsx'
import { PasteDialog } from './PasteDialog.tsx'
import { sortBroadcasts } from './HomePage.tsx'
import { UndoBar } from './UndoBar.tsx'

export const PHONE_UNREADABLE = '휴대폰 번호로 읽지 못했어요. 고치거나 지워 주세요.'
export const MEMO_HAS_PHONE = '전화번호처럼 보이는 숫자(010-…)가 있어요. 빼고 적어 주세요.'
export const NO_BROADCAST = '문자찜을 넣을 방송을 골라 주세요.'
export const REHEARSAL_WARNING = '리허설 방송이에요 — 실제 판매에 들어가지 않아요'
/** 옵션 방송인데 아직 없는 번호 (R-19 문자찜 — 번호·수량만 보류, D-O2-08) */
export const OPTIONS_LATER = '상품을 등록하면 옵션을 고를 수 있어요'
/** 찜이 생기지 않고 확인 필요로 간 문자찜 (AC-O2-40) */
export const SENT_TO_REVIEW = '찜이 생기지 않았어요 — 확인 필요로 보냈어요'
export const SENDING_LOCKED = '보내는 중이라 잠시 고칠 수 없어요.'

/** 처음 고를 방송 (R-0 5, D-089): 끝나지 않은 실제 방송 중 가장 최근 것 */
export function defaultSmsBroadcast(items: readonly BroadcastItem[]): BroadcastItem | null {
  return sortBroadcasts(items).find((item) => !item.ended && !item.rehearsal) ?? null
}

/** 번호 칸: 숫자만 (전각 숫자는 반각으로) */
function digitsOnly(text: string): string {
  return text.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0)).replace(/\D/g, '').slice(0, 4)
}

/** 문자찜을 넣을 수 있는 방송: 봉인한 날짜 빼고, 보조자면 실제 방송만 */
export function smsChoices(items: readonly BroadcastItem[], sealedDates: ReadonlySet<string>, assistant: boolean): BroadcastItem[] {
  return items.filter((item) => !(sealedDates.has(item.date) && !item.rehearsal) && !(assistant && item.rehearsal))
}

async function sealedDates(): Promise<ReadonlySet<string>> {
  try {
    const { days } = await get<{ days: DayRow[] }>('/api/days')
    return new Set(days.filter((day) => day.sealed === true).map((day) => day.date))
  } catch {
    return new Set()
  }
}

export function SmsPage({ navigate, assistant = false }: { readonly navigate: Navigate; readonly assistant?: boolean }) {
  const [broadcasts, setBroadcasts] = useState<BroadcastItem[] | null>(null)
  const [listError, setListError] = useState<ApiError | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [focusSignal, setFocusSignal] = useState(0)
  // 문자찜을 보내는 동안은 방송을 바꾸지 못한다 (AC-SMS-01)
  const [sending, setSending] = useState(false)
  // 댓글 붙여넣기 (틱톡 등 — 번호마다 문자찜, N2b-2 AC-N2b-2-64)
  const [pasting, setPasting] = useState(false)
  const [pasteNote, setPasteNote] = useState<string | null>(null)
  // 붙여 넣던 글은 창을 닫아도 그 방송에 남는다 (넣기를 마치면 비운다 — UX-N2b-2-01)
  const [pasteDraft, setPasteDraft] = useState<{ readonly broadcast: string; readonly text: string } | null>(null)

  const load = useCallback(async (first: boolean) => {
    setListError(null)
    try {
      const [{ broadcasts: all }, sealed] = await Promise.all([get<{ broadcasts: BroadcastItem[] }>('/api/broadcasts'), sealedDates()])
      const items = smsChoices(all, sealed, assistant)
      setBroadcasts(sortBroadcasts(items))
      if (first) setSelected((current) => current ?? defaultSmsBroadcast(items)?.id ?? null)
    } catch (error) {
      if (isApiError(error)) setListError(error)
    }
  }, [assistant])

  useEffect(() => {
    void load(true)
  }, [load])

  const { store, snapshot } = useScopeStore(selected, () => ({ broadcastId: selected ?? '', messages: false }))
  const queue = useUndoQueue()
  const item = broadcasts?.find((broadcast) => broadcast.id === selected) ?? snapshot.broadcast

  const choose = (id: string) => {
    setPasteNote(null)
    setSelected(id)
    setChoosing(false)
    setFocusSignal((n) => n + 1)
  }

  return (
    <main className="page page-wide sms-page">
      <h1>문자찜 입력</h1>
      <section className="sms-broadcast card" aria-label="고른 방송">
        {item === null || item === undefined ? (
          <p className="warning" role="status" data-tone="warning">
            {NO_BROADCAST}
          </p>
        ) : (
          <SelectedBroadcast item={item} snapshot={snapshot} />
        )}
        <div className="row">
          <button type="button" className="button" onClick={() => setChoosing(true)} disabled={broadcasts === null || sending}>
            {item === null || item === undefined ? '방송 고르기' : '방송 바꾸기'}
          </button>
          {selected !== null && item !== null && item !== undefined && snapshot.sealed !== true ? (
            <button
              type="button"
              className="button"
              onClick={() => {
                setPasteNote(null)
                setPasting(true)
              }}
            >
              댓글 붙여넣기
            </button>
          ) : null}
        </div>
        {pasteNote !== null ? (
          <p className="notice" role="status">
            {pasteNote}
          </p>
        ) : null}
      </section>
      {pasting && selected !== null ? (
        <PasteDialog
          broadcastId={selected}
          draft={pasteDraft?.broadcast === selected ? pasteDraft.text : ''}
          onDraftChange={(text) => setPasteDraft({ broadcast: selected, text })}
          onClose={() => setPasting(false)}
          onDone={(message) => {
            setPasteDraft(null)
            setPasting(false)
            setPasteNote(message)
          }}
        />
      ) : null}
      {listError !== null ? <ErrorNote error={listError} onRetry={() => void load(true)} retryLabel="다시 불러오기" /> : null}
      {item?.rehearsal === true && (store === null || queue === null || snapshot.data === null) ? <RehearsalWarning /> : null}
      {selected === null || item === null || item === undefined ? (
        <SmsForm key="none" disabled focusSignal={focusSignal} />
      ) : store !== null && queue !== null && snapshot.data !== null ? (
        <ReadySms key={selected} b={selected} item={item} store={store} snapshot={snapshot} data={snapshot.data} queue={queue} focusSignal={focusSignal} onSending={setSending} />
      ) : snapshot.phase === 'missing' ? (
        <p className="warning" data-tone="warning">
          그 방송을 찾지 못했어요. "방송 바꾸기"로 다시 골라 주세요.
        </p>
      ) : snapshot.phase === 'error' && snapshot.error !== null ? (
        <ErrorNote error={snapshot.error} onRetry={() => window.location.reload()} retryLabel="다시 열기" />
      ) : (
        <>
          <div className="page-sticky">
            <LiveNotices snapshot={snapshot} onRetry={() => void store?.retryNow()} />
          </div>
          <p role="status">불러오는 중…</p>
        </>
      )}
      {choosing ? (
        <BroadcastChooser
          items={broadcasts ?? []}
          selected={selected}
          onChoose={choose}
          onClose={() => setChoosing(false)}
          onReload={() => void load(false)}
          {...(assistant ? {} : { onHome: () => navigate({ name: 'home' }) })}
        />
      ) : null}
    </main>
  )
}

/** 리허설 방송을 고르면 늘 보인다 (AC-S06-10) */
function RehearsalWarning() {
  return (
    <p className="rehearsal-banner" role="note">
      {REHEARSAL_WARNING}
    </p>
  )
}

function SelectedBroadcast({ item, snapshot }: { readonly item: BroadcastItem; readonly snapshot: ConsoleSnapshot }) {
  // 다른 기기에서 그 방송을 끝내면 고른 방송은 그대로이고 "끝남"으로 표시만 바뀐다
  const ended = snapshot.data?.broadcasts.get(item.id)?.ended ?? item.ended
  return (
    <p className="sms-broadcast-title">
      <strong>{broadcastWords(item.title, item.date)}</strong> <span className={ended ? 'tag' : 'tag tag-live'}>{ended ? '끝남' : '진행 중'}</span>
      {item.rehearsal ? <span className="tag tag-rehearsal">리허설</span> : null}
    </p>
  )
}

function BroadcastChooser(props: {
  readonly items: readonly BroadcastItem[]
  readonly selected: string | null
  readonly onChoose: (id: string) => void
  readonly onClose: () => void
  readonly onReload: () => void
  /** 방송 목록으로 (보조자 계정은 없다) */
  readonly onHome?: () => void
}) {
  useEffect(() => {
    props.onReload()
    // 열 때 한 번 (새로 만든 방송·끝난 방송을 반영)
  }, [])
  return (
    <Modal title="방송 고르기" onClose={props.onClose}>
      {props.items.length === 0 ? (
        <div className="stack-tight">
          <p>{props.onHome === undefined ? '문자찜을 넣을 방송이 없어요. 판매자가 방송을 시작하면 고를 수 있어요.' : '아직 방송이 없어요. 방송 목록에서 먼저 방송을 시작해 주세요.'}</p>
          {props.onHome !== undefined ? (
            <button type="button" className="button" onClick={props.onHome}>
              방송 목록으로
            </button>
          ) : null}
        </div>
      ) : (
        <ul className="plain-list stack-tight" aria-label="방송">
          {props.items.map((item) => (
            <li key={item.id}>
              {/* 고른 방송은 테두리 색만이 아니라 "✓ 고름" 글자와 다른 배경, aria-pressed (AC-S06b-32) */}
              <button type="button" className="choice-button" aria-pressed={item.id === props.selected} onClick={() => props.onChoose(item.id)}>
                <strong>{broadcastWords(item.title, item.date)}</strong>
                <span className={item.ended ? 'tag' : 'tag tag-live'}>{item.ended ? '끝남' : '진행 중'}</span>
                {item.rehearsal ? <span className="tag tag-rehearsal">리허설</span> : null}
                {item.id === props.selected ? <span className="chosen-mark">✓ 고름</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

interface ReadySmsProps {
  readonly b: string
  readonly item: BroadcastItem
  readonly store: ConsoleStore
  readonly snapshot: ConsoleSnapshot
  readonly data: ScopeData
  readonly queue: UndoQueue
  readonly focusSignal: number
  readonly onSending: (sending: boolean) => void
}

function ReadySms({ b, item, store, snapshot, data, queue, focusSignal, onSending }: ReadySmsProps) {
  const ended = data.broadcasts.get(b)?.ended ?? item.ended
  const host = useHostActions({ store, data, queue, date: item.date, rehearsal: item.rehearsal, b, ended })
  return (
    <>
      {/* 리허설 경고·끊김 안내·되돌리기 띠는 위에 붙어 있어 내려도 보인다 */}
      <div className="page-sticky">
        {item.rehearsal ? <RehearsalWarning /> : null}
        <LiveNotices snapshot={snapshot} onRetry={() => void store.retryNow()} />
        <UndoBar items={host.items} queue={queue} />
      </div>
      <SmsForm api={host.api} focusSignal={focusSignal} onSending={onSending} />
      <RecentSms api={host.api} />
      {host.dialog}
    </>
  )
}

/** 지금 상품 한 줄 (AC-S06-11): "15번 핑크프릴 10,000원 · 판매 완료 · 1등 홍길동 · 대기 2" */
function productLine(api: ConsoleApi, product: Product): string {
  if (product.hasOptions) {
    const name = product.name.trim() === '' ? '품종 미입력' : product.name
    const remaining = product.variants.reduce((sum, variant) => sum + Math.max(0, variant.remaining), 0)
    return `${String(product.no)}번 ${name} ${formatWon(product.price)} · ${PRODUCT_STATUS_WORD[product.status]} · 변형 ${String(product.variants.length)}개 · 남은 ${String(remaining)}`
  }
  const winners = product.winners.length === 0 ? '아직 없음' : product.winners.map((id) => api.names.name(id)).join(', ')
  const name = product.name.trim() === '' ? '품종 미입력' : product.name
  return `${String(product.no)}번 ${name} ${formatWon(product.price)} · ${PRODUCT_STATUS_WORD[product.status]} · 1등 ${winners} · 대기 ${String(product.waitlist.length)}`
}

/** 번호 칸 아래 상품 미리 보기 (AC-S06-11) */
function ProductPreview({ api, no }: { readonly api: ConsoleApi; readonly no: number }) {
  const product = api.data.products.get(productKey(api.b, no))
  if (product === undefined) {
    const window = api.settingsOf(api.b)?.['claim.preOpenWindowSec'] ?? 30
    return (
      <p className="sms-preview" role="status" aria-label="번호의 상품">
        {no}번 상품이 아직 없어요. 넣으면 보류 찜이 되고, {window}초 안에 등록되면 판정돼요.
      </p>
    )
  }
  const note =
    product.status === 'HOLD' || product.status === 'CLOSED' ? '지금 판매 중이 아니라 넣으면 거절돼요.' : product.status === 'READY' ? '공개 전 상품이라 넣으면 보류 찜이 돼요.' : null
  return (
    <div className="sms-preview" role="status" aria-label="번호의 상품">
      <p>{productLine(api, product)}</p>
      {note !== null ? (
        <p className="warning" data-tone="warning">
          {note}
        </p>
      ) : null}
    </div>
  )
}

interface SentResult {
  readonly seq: number
  readonly no: number
  readonly b: string
  /** 칸에 쳤던 받은 시각 글자 (같은 사람 하나 더) */
  readonly receivedText: string
  readonly phoneLast4: string | null
  /** 쓰기 응답의 buyer: 그 문자찜이 정한 구매자 자신 (정하지 못했으면 null, D-099) */
  readonly buyer: string | null
}

interface SmsFormProps {
  readonly api?: ConsoleApi
  readonly disabled?: boolean
  readonly focusSignal: number
  /** 보내는 중인지 (방송 고르기를 잠근다, AC-SMS-01) */
  readonly onSending?: (sending: boolean) => void
}

function SmsForm({ api, disabled = false, focusSignal, onSending }: SmsFormProps) {
  const noId = useId()
  const receivedId = useId()
  const phoneId = useId()
  const memoId = useId()
  const [no, setNo] = useState('')
  const [received, setReceived] = useState('')
  const [phone, setPhone] = useState('')
  const [memo, setMemo] = useState('')
  const [buyer, setBuyer] = useState<string | null>(null)
  /** 옵션 방송: 고른 옵션(처음엔 고르지 않음)·수량(처음 1) — D-O2-08 */
  const [picks, setPicks] = useState<Readonly<Record<string, string>>>({})
  const [qtyText, setQtyText] = useState('1')
  const [tried, setTried] = useState(false)
  const [late, setLate] = useState<{ words: string } | null>(null)
  const [result, setResult] = useState<SentResult | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const noField = useRef<HTMLInputElement>(null)
  const receivedField = useRef<HTMLInputElement>(null)
  // 응답만 기다린다 — 따라잡기를 기다리면 그 사이 친 글이 늦은 비우기로 지워진다 (D-SMS-01)
  const sender = useSender(api?.write ?? (() => Promise.reject(new Error('방송을 고르지 않았다'))))
  const locked = sender.busy

  useEffect(() => {
    onSending?.(locked)
  }, [locked, onSending])
  useEffect(() => () => onSending?.(false), [onSending])

  useEffect(() => {
    if (!disabled) noField.current?.focus()
  }, [focusSignal, disabled])

  // "오늘·내일" 판단과 늦은 시각 비교를 위해 30초마다 지금 시각을 새로
  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(handle)
  }, [])

  const max = (api === undefined ? null : api.settingsOf(api.b)?.['claim.maxNumber']) ?? 999
  const number = no === '' ? null : Number(no)
  const numberProblem = number !== null && (number < 1 || number > max) ? `번호는 1~${String(max)} 사이로 적어 주세요.` : null
  const read = readReceived(received, now)
  const receivedProblem = read.kind === 'invalid' ? RECEIVED_INVALID : null
  const normalized = phone.trim() === '' ? null : normalizePhone(phone)
  const phoneProblem = buyer === null && phone.trim() !== '' && normalized === null ? PHONE_UNREADABLE : null
  const memoProblem = memo.trim() !== '' && containsPhoneRun(memo) ? MEMO_HAS_PHONE : null
  const chosen = buyer === null || api === undefined ? undefined : api.data.buyers.get(buyer)
  const label = number !== null && numberProblem === null ? `${String(number)}번에 문자찜 넣기` : '문자찜 넣기'
  const optionMode = api !== undefined && isOptionBroadcast(api.data, api.b)
  const product = api === undefined || number === null || numberProblem !== null ? undefined : api.data.products.get(productKey(api.b, number))
  const maxQty = (api === undefined ? null : api.settingsOf(api.b)?.['claim.maxQuantity']) ?? DEFAULT_SETTINGS['claim.maxQuantity']
  const qty = optionMode ? readQty(qtyText, maxQty) : 1
  const qtyProblem = optionMode && qty === null ? qtyProblemWords(maxQty) : null
  // 선택지 하나뿐인 항목은 자동, 그 밖은 판매자가 고른다
  const effectivePicks: Record<string, string> = {}
  if (optionMode && product !== undefined) {
    for (const item of product.options) {
      const pickedLabel = picks[item.name]
      if (pickedLabel !== undefined && item.choices.some((choice) => choice.label === pickedLabel)) effectivePicks[item.name] = pickedLabel
      else if (item.choices.length === 1 && item.choices[0] !== undefined) effectivePicks[item.name] = item.choices[0].label
    }
  }
  const optionsMissing = optionMode && product !== undefined && product.hasOptions && variantTextOf(product, effectivePicks) === null

  const send = async () => {
    if (api === undefined || number === null) return
    const at = Date.now()
    const current = readReceived(received, at)
    const event = {
      type: 'sms',
      b: api.b,
      no: number,
      ...(current.kind === 'ok' ? { received: current.value } : {}),
      ...(buyer === null && phone.trim() !== '' ? { phone: phone.trim() } : {}),
      ...(memo.trim() === '' ? {} : { memo: memo.trim() }),
      ...(buyer === null ? {} : { buyer }),
      ...(optionMode ? { qty: qty ?? 1 } : {}),
      ...(optionMode && product !== undefined && product.hasOptions ? { options: { ...effectivePicks } } : {}),
    }
    const written = await sender.send(event)
    // 실패면 칸은 친 그대로 (AC-SMS-04)
    if (written === null) return
    setResult({
      seq: written.seq,
      no: number,
      b: api.b,
      receivedText: received,
      phoneLast4: typeof written.phoneLast4 === 'string' ? written.phoneLast4 : normalized === null ? null : phoneLast4(normalized),
      buyer: typeof written.buyer === 'string' ? written.buyer : null,
    })
    // 성공 응답 바로 칸을 모두 비우고 번호 칸으로 — 따라잡기를 기다리지 않는다 (전화번호 원문을 남기지 않는다, AC-S06-13·81, AC-SMS-02)
    setNo('')
    setReceived('')
    setPhone('')
    setMemo('')
    setBuyer(null)
    setPicks({})
    setQtyText('1')
    setTried(false)
    // 결과 카드는 번호 칸 바로 위 — 화면 맨 위로 올려 결과와 번호 칸이 함께 보이게 (UX-S06-002)
    const page = document.scrollingElement ?? document.documentElement
    page.scrollTop = 0
    noField.current?.focus({ preventScroll: true })
  }

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (disabled || api === undefined || sender.busy) return
    setTried(true)
    if (number === null || numberProblem !== null) {
      noField.current?.focus()
      return
    }
    if (receivedProblem !== null || phoneProblem !== null || memoProblem !== null || qtyProblem !== null || optionsMissing) return
    const current = readReceived(received, Date.now())
    if (current.kind === 'ok' && current.late) {
      setLate({ words: receivedWords(current) })
      return
    }
    void send()
  }

  const fillSame = (who: string, receivedText: string) => {
    if (locked) return
    setBuyer(who)
    setPhone('')
    setReceived(receivedText)
    setNo('')
    setPicks({})
    setQtyText('1')
    noField.current?.focus()
  }

  const serverError = sender.error
  return (
    <section className="sms-form card" aria-label="문자찜 넣기">
      {result !== null && api !== undefined ? <ResultCard key={result.seq} api={api} result={result} onSame={fillSame} locked={locked} /> : null}
      <form className="stack" onSubmit={submit} noValidate>
        <div className="stack-tight">
          <div className="field">
            <label htmlFor={noId}>번호</label>
            <input
              id={noId}
              ref={noField}
              className="input sms-number"
              inputMode="numeric"
              enterKeyHint="send"
              autoComplete="off"
              value={no}
              disabled={disabled}
              readOnly={locked}
              aria-invalid={numberProblem !== null}
              aria-describedby={`${noId}-error`}
              onChange={(event) => {
                if (!locked) setNo(digitsOnly(event.target.value))
              }}
            />
          </div>
          <FieldNote id={`${noId}-error`} message={numberProblem ?? (tried && number === null ? '번호를 적어 주세요.' : serverProblem(serverError, 'no'))} />
          {api !== undefined && number !== null && numberProblem === null ? <ProductPreview api={api} no={number} /> : null}
        </div>

        {optionMode && number !== null && numberProblem === null ? (
          <OptionQtyFields
            product={product}
            picks={effectivePicks}
            onPick={(name, value) => {
              if (!locked) setPicks((current) => ({ ...current, [name]: value }))
            }}
            qtyText={qtyText}
            onQty={(text) => {
              if (!locked) setQtyText(text)
            }}
            qtyProblem={qtyProblem ?? serverProblem(serverError, 'qty')}
            optionsProblem={tried && optionsMissing ? '옵션을 모두 골라 주세요.' : serverProblem(serverError, 'options')}
            disabled={disabled}
            locked={locked}
          />
        ) : null}

        <div className="stack-tight">
          <div className="field">
            <label htmlFor={receivedId}>받은 시각</label>
            <input
              id={receivedId}
              ref={receivedField}
              className="input"
              inputMode="numeric"
              autoComplete="off"
              placeholder="20:01"
              value={received}
              disabled={disabled}
              readOnly={locked}
              aria-invalid={receivedProblem !== null}
              aria-describedby={`${receivedId}-help ${receivedId}-error`}
              onChange={(event) => {
                if (!locked) setReceived(event.target.value)
              }}
            />
          </div>
          <p id={`${receivedId}-help`} className="hint">
            {read.kind === 'ok' ? `${receivedWords(read)}에 받은 문자` : RECEIVED_HELP}
          </p>
          <FieldNote id={`${receivedId}-error`} message={receivedProblem ?? serverProblem(serverError, 'received')} />
        </div>

        <div className="stack-tight">
          <div className="field">
            <label htmlFor={phoneId}>전화번호</label>
            <input
              id={phoneId}
              className="input"
              inputMode="tel"
              autoComplete="off"
              value={phone}
              disabled={disabled || buyer !== null}
              readOnly={locked}
              aria-invalid={phoneProblem !== null}
              aria-describedby={`${phoneId}-help ${phoneId}-error`}
              onChange={(event) => {
                if (!locked) setPhone(event.target.value)
              }}
            />
          </div>
          <p id={`${phoneId}-help`} className="hint">
            {buyer !== null ? '구매자를 골랐으면 전화번호는 쓰지 않아요' : normalized !== null ? `뒤 4자리 ${phoneLast4(normalized)}로 이어져요` : '선택 — 적으면 같은 번호의 문자 구매자로 이어져요'}
          </p>
          <FieldNote id={`${phoneId}-error`} message={phoneProblem ?? serverProblem(serverError, 'phone')} />
        </div>

        <div className="stack-tight">
          <div className="field">
            <label htmlFor={memoId}>메모</label>
            <input
              id={memoId}
              className="input"
              autoComplete="off"
              placeholder="김씨"
              value={memo}
              disabled={disabled}
              readOnly={locked}
              aria-invalid={memoProblem !== null}
              aria-describedby={`${memoId}-error`}
              onChange={(event) => {
                if (!locked) setMemo(event.target.value)
              }}
            />
          </div>
          <FieldNote id={`${memoId}-error`} message={memoProblem ?? serverProblem(serverError, 'memo')} />
        </div>

        {api !== undefined ? (
          <BuyerChooser
            api={api}
            buyer={chosen ?? null}
            onChoose={(id) => {
              setBuyer(id)
              setPhone('')
            }}
            onClear={() => setBuyer(null)}
            serverMessage={serverProblem(serverError, 'buyer')}
            locked={locked}
          />
        ) : null}

        <p className="hint" aria-label="구매자 표시 이름">
          구매자 표시: {chosen !== undefined && api !== undefined ? api.names.name(chosen.id) : memo.trim() === '' ? '문자찜' : `문자찜(${memo.trim()})`}
        </p>

        {/* 보내기 막대: 화면 아래에 붙어 있어 칸을 채우는 동안 늘 보인다. 보내는 중·저장 실패도 여기 (UX-S06-002) */}
        <div className="sms-submit-bar">
          {/* 다시 보내기: 칸은 그대로라 같은 내용 → 같은 요청 번호 (한 번만 기록) */}
          {serverError !== null ? <WriteError error={serverError} onRetry={() => void send()} omitFields={['no', 'received', 'phone', 'memo', 'buyer', 'qty', 'options']} /> : null}
          <div className="row">
            <button type="submit" className="button button-primary sms-submit" disabled={disabled || number === null || sender.busy || optionsMissing || qtyProblem !== null}>
              {label}
            </button>
            {sender.busy ? <span role="status">보내는 중…</span> : null}
          </div>
          {locked ? <p className="hint">{SENDING_LOCKED}</p> : null}
        </div>
      </form>
      {late !== null ? (
        <Modal
          title="받은 시각을 확인해 주세요"
          closeLabel="고치기"
          onClose={() => {
            setLate(null)
            setTimeout(() => receivedField.current?.focus(), 0)
          }}
          actions={
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                setLate(null)
                void send()
              }}
            >
              이대로 넣기
            </button>
          }
        >
          <p>받은 시각({late.words})이 지금보다 늦어요. 이대로 넣을까요?</p>
        </Modal>
      ) : null}
    </section>
  )
}

/** 구매자 고르기 (AC-S06-13·21): 그 방송 날짜 범위의 구매자를 표시 이름·뒤 4자리·채널 ID 끝 4자리로 찾는다 */
function BuyerChooser({
  api,
  buyer,
  onChoose,
  onClear,
  serverMessage,
  locked,
}: {
  readonly api: ConsoleApi
  readonly buyer: Buyer | null
  readonly onChoose: (id: string) => void
  readonly onClear: () => void
  readonly serverMessage: string | null
  /** 보내는 중 — 고르기·지우기를 잠근다 (AC-SMS-01) */
  readonly locked: boolean
}) {
  const id = useId()
  const [query, setQuery] = useState('')
  const counts = useMemo(() => sameNameCounts(api.data.buyers), [api.data.buyers])
  const hits = useMemo(() => searchBuyers(api.data.buyers, query, 8), [api.data.buyers, query])
  if (buyer !== null) {
    return (
      <div className="stack-tight" role="group" aria-label="고른 구매자">
        <p>
          고른 구매자: <strong>{api.names.name(buyer.id)}</strong> <span className="tag">{buyerPlatformWord(buyer)}</span>
          {buyer.blocked ? <span className="tag tag-alert">차단</span> : null}
        </p>
        {buyer.blocked ? (
          <p className="warning" data-tone="warning">
            차단된 구매자라 넣으면 거절돼요.
          </p>
        ) : null}
        <button type="button" className="button" onClick={onClear} disabled={locked}>
          고른 구매자 지우기
        </button>
        <FieldNote id={`${id}-error`} message={serverMessage} />
      </div>
    )
  }
  return (
    <div className="stack-tight">
      <div className="field">
        <label htmlFor={id}>구매자 고르기</label>
        <input
          id={id}
          className="input"
          type="search"
          autoComplete="off"
          placeholder="닉네임·메모·뒤 4자리"
          value={query}
          readOnly={locked}
          onChange={(event) => {
            if (!locked) setQuery(event.target.value)
          }}
          onKeyDown={(event) => {
            // 찾는 칸의 Enter는 문자찜을 보내지 않는다
            if (event.key === 'Enter') event.preventDefault()
          }}
        />
      </div>
      <p className="hint">선택 — 고르면 그 구매자의 찜으로 넣어요.</p>
      {query.trim() !== '' && hits.length === 0 ? <p>찾는 구매자가 없어요.</p> : null}
      {hits.length > 0 ? (
        <ul className="plain-list stack-tight" aria-label="찾은 구매자">
          {hits.map((hit) => (
            <li key={hit.current.id}>
              <button
                type="button"
                className="choice-button"
                disabled={locked}
                onClick={() => {
                  onChoose(hit.current.id)
                  setQuery('')
                }}
              >
                <strong>{api.names.name(hit.current.id)}</strong>
                <span className="tag">{buyerPlatformWord(hit.current)}</span>
                {distinguishWords(hit.current, counts).map((word) => (
                  <span key={word}>{word}</span>
                ))}
                {hit.current.blocked ? <span className="tag tag-alert">차단</span> : null}
                {hit.matched.id !== hit.current.id ? <span>{`${api.names.name(hit.matched.id)} — ${api.names.name(hit.current.id)}에 합쳐짐`}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <FieldNote id={`${id}-error`} message={serverMessage} />
    </div>
  )
}

/** 결과·안내의 종류 (D-102): 1등은 성공, 대기·보류는 보통, 충돌·거절(품절·판매 중 아님·차단)은 주의 */
export function claimTone(status: ClaimStatus): 'success' | 'warning' | 'info' {
  switch (status) {
    case 'CONFIRMED':
      return 'success'
    case 'CONFLICT':
    case 'REJECTED':
      return 'warning'
    default:
      return 'info'
  }
}

/**
 * 보낸 결과 (AC-S06-14, AC-S06b-30·31·40). 찜이 생겼으면 응답 seq의 찜. 생기지 않았으면 응답의 buyer(엔진이 정한 구매자 자신, D-099)의
 * 지금의 구매자가 그 상품에 가진 활성 찜으로 "이미 찜한 구매자라…", 없거나 buyer가 null이면 "새 찜이 생기지 않았어요…".
 * "같은 사람 하나 더"는 응답의 buyer로 채운다(null이면 버튼이 없다).
 * 번호 칸 바로 위에 둔다 — 보낸 뒤 칸이 비고 번호 칸으로 가도 결과가 첫 화면에 보인다(UX-S06-002).
 */
function ResultCard({
  api,
  result,
  onSame,
  locked,
}: {
  readonly api: ConsoleApi
  readonly result: SentResult
  readonly onSame: (buyer: string, received: string) => void
  /** 다음 문자찜을 보내는 중 — "같은 사람 하나 더"를 잠근다 (AC-SMS-01) */
  readonly locked: boolean
}) {
  const { claim, caught, missing } = useSmsClaim(api, result)
  const who = result.buyer ?? claim?.buyer ?? null
  const reviewed = useSentToReview(api, result, missing)
  const { body, tone } = smsResultWords(api, result, claim, caught, reviewed)
  const suffix = smsLast4Suffix(body, result.phoneLast4)
  return (
    <section className="sms-result" aria-label="넣은 결과" data-tone={tone}>
      <p role="status">
        <strong>{body}</strong>
        {suffix !== null ? <span>{suffix}</span> : null}
      </p>
      <div className="row">
        {caught && claim !== undefined && isActive(claim) ? (
          <button type="button" className="button" onClick={() => openClaimAction(api, claim, 'host.cancel')}>
            찜 취소하기
          </button>
        ) : null}
        {who !== null ? (
          <button type="button" className="button" disabled={locked} onClick={() => onSame(who, result.receivedText)}>
            같은 사람 하나 더
          </button>
        ) : null}
      </div>
    </section>
  )
}

/**
 * 결과 줄 끝의 " · 뒤 4자리 1234" (AC-S06-14). 결과 문장의 구매자 이름에 같은 이름 구분 글자(D-098 "뒤 4자리 1234")가 이미 있으면 붙이지 않는다 —
 * 같은 끝자리가 한 줄에 두 번 나오지 않게 (TE-V1-001·SA-V1-001)
 */
export function smsLast4Suffix(body: string, last4: string | null): string | null {
  if (last4 === null || body.includes(`뒤 4자리 ${last4}`)) return null
  return ` · 뒤 4자리 ${last4}`
}

/** 넣은 문자찜 하나 (손 입력·음성 문자찜 결과 카드가 같이 쓴다) */
export interface SmsOutcomeRef {
  readonly seq: number
  readonly no: number
  readonly b: string
  /** 쓰기 응답의 buyer (D-099) */
  readonly buyer: string | null
}

/** 그 쓰기가 만든 찜과 화면이 그 seq까지 따라잡았는지 — 따라잡기 전에는 찜을 찾지 못해도 "생기지 않았다"고 하지 않는다 (AC-SMS-03) */
export function useSmsClaim(api: ConsoleApi, result: SmsOutcomeRef): { readonly claim: Claim | undefined; readonly caught: boolean; readonly missing: boolean } {
  const caught = api.data.seq >= result.seq
  const claim = useMemo(() => {
    for (const item of api.data.claims.values()) if (item.seq === result.seq && item.origin === 'sms') return item
    return undefined
  }, [api.data.claims, result.seq])
  return { claim, caught, missing: caught && claim === undefined }
}

/**
 * 결과 문장 (AC-S06-14, AC-S06b-30·31·40, V1 AC-V1-21): "165번 · 문자찜 · 1등 · 받은 시각 10/23 20:01:05",
 * 찜이 생기지 않았으면 응답의 buyer로 "이미 찜한 구매자라…" 또는 "새 찜이 생기지 않았어요…".
 */
export function smsResultWords(
  api: ConsoleApi,
  result: SmsOutcomeRef,
  claim: Claim | undefined,
  caught: boolean,
  reviewed: boolean,
): { readonly body: string; readonly tone: 'success' | 'warning' | 'info' } {
  if (!caught) return { body: `${String(result.no)}번 · 넣었어요 · 상태 확인 중…`, tone: 'info' }
  if (claim !== undefined) {
    return {
      body: `${String(claim.no)}번${claimOptionWords(claim)} · ${api.names.name(claim.currentBuyer)} · ${claimWord(api.data, claim)} · 받은 시각 ${kstStamp(claim.rankTime, claim.rankMinute)}`,
      tone: claimTone(claim.status),
    }
  }
  if (reviewed) return { body: `${String(result.no)}번 · ${SENT_TO_REVIEW}`, tone: 'warning' }
  const holder = result.buyer === null ? undefined : activeClaimOf(api.data, result.buyer, productKey(result.b, result.no))
  return {
    body:
      holder !== undefined
        ? `${String(result.no)}번 · 이미 찜한 구매자라 새 찜이 생기지 않았어요(지금 ${claimWord(api.data, holder)})`
        : `${String(result.no)}번 · 새 찜이 생기지 않았어요. 지금 상태를 확인해 주세요.`,
    tone: 'warning',
  }
}

/** 최근 넣은 문자찜 10개 (AC-S06-15) */
function RecentSms({ api }: { readonly api: ConsoleApi }) {
  const recent = useMemo(() => {
    const out: Claim[] = []
    for (const claim of api.data.claims.values()) if (claim.origin === 'sms' && claim.broadcast === api.b) out.push(claim)
    return out.sort((a, b) => b.seq - a.seq).slice(0, 10)
  }, [api.data.claims, api.b])
  return (
    <section className="stack-tight" aria-label="최근 넣은 문자찜">
      <h2 className="section-title">최근 넣은 문자찜</h2>
      {recent.length === 0 ? <p>아직 넣은 문자찜이 없어요.</p> : null}
      <ul className="plain-list stack-tight">
        {recent.map((claim) => {
          const product = api.data.products.get(claim.product)
          const name = product === undefined ? '상품 없음' : product.name.trim() === '' ? '품종 미입력' : product.name
          return (
            <li key={claim.id} className="claim-row">
              <p>
                <strong>{claim.no}번</strong> {name}
                {claimOptionWords(claim)} · {api.names.name(claim.currentBuyer)} · {kstStamp(claim.rankTime, claim.rankMinute)} ·{' '}
                <span className="tag">{claimWord(api.data, claim)}</span>
                {api.waiting.claims.has(claim.id) ? <span className="tag tag-waiting">보내기 전</span> : null}
              </p>
              {isActive(claim) ? (
                <button type="button" className="button button-small" onClick={() => openClaimAction(api, claim, 'host.cancel')}>
                  찜 취소하기
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/**
 * 옵션 방송에서 찜이 생기지 않은 문자찜이 확인 필요로 갔는지 (AC-O2-40, 서버 계약 3): 그 방송의 확인 필요에 같은 seq 항목이 있으면 참.
 * 보조자는 확인 필요를 볼 수 없다(403) — 그때는 거짓(지금 문장).
 */
export function useSentToReview(api: ConsoleApi, result: Pick<SmsOutcomeRef, 'b' | 'seq'>, missing: boolean): boolean {
  const [found, setFound] = useState(false)
  const option = isOptionBroadcast(api.data, result.b)
  useEffect(() => {
    if (!missing || !option) return
    let alive = true
    get<ReviewsView>(reviewsPath({ broadcast: result.b, rehearsal: api.rehearsal })).then(
      (view) => {
        if (alive) setFound(view.reviews.some((item) => item.seq === result.seq))
      },
      () => {},
    )
    return () => {
      alive = false
    }
  }, [missing, option, result.b, result.seq, api.rehearsal])
  return missing && found
}

/**
 * 옵션 방송의 옵션·수량 칸 (D-O2-08, AC-O2-40·41): 상품이 없으면 안내와 수량만, 옵션 없는 상품이면 수량만,
 * 옵션 상품이면 항목마다 선택지(처음엔 고르지 않음 — 선택지 옆 "남은 n개")와 수량(처음 1, 숫자 키패드).
 * 보내는 중에는 다른 칸처럼 잠근다(AC-SMS-01) — 성공하면 비우고, 실패면 고른 그대로 둔다(AC-SMS-02·04).
 */
function OptionQtyFields(props: {
  readonly product: Product | undefined
  readonly picks: Readonly<Record<string, string>>
  readonly onPick: (name: string, value: string) => void
  readonly qtyText: string
  readonly onQty: (text: string) => void
  readonly qtyProblem: string | null
  readonly optionsProblem: string | null
  readonly disabled: boolean
  /** 보내는 중 — 옵션·수량을 잠근다 (AC-SMS-01) */
  readonly locked: boolean
}) {
  const qtyId = useId()
  const { product, picks } = props
  return (
    <div className="stack-tight sms-options">
      {product === undefined ? (
        <p className="hint" role="note">
          {OPTIONS_LATER}
        </p>
      ) : null}
      {product?.hasOptions === true
        ? product.options.map((item) => (
            <fieldset key={item.name} className="rule-choice" role="radiogroup" aria-label={item.name} aria-readonly={props.locked} disabled={props.disabled}>
              <legend>{item.name}</legend>
              <div className="choice-list">
                {item.choices.map((choice) => {
                  const text = variantTextOf(product, { ...picks, [item.name]: choice.label })
                  const left = text === null ? undefined : product.variants.find((variant) => variant.text === text)?.remaining
                  return (
                    <label key={choice.label} className="choice">
                      <input type="radio" name={`sms-option-${item.name}`} checked={picks[item.name] === choice.label} onChange={() => props.onPick(item.name, choice.label)} />
                      <span>
                        {choice.label}
                        {left === undefined ? '' : ` · 남은 ${String(left)}개`}
                      </span>
                    </label>
                  )
                })}
              </div>
            </fieldset>
          ))
        : null}
      <FieldNote id={`${qtyId}-options`} message={props.optionsProblem} />
      <div className="field">
        <label htmlFor={qtyId}>수량</label>
        <input
          id={qtyId}
          className="input input-number"
          inputMode="numeric"
          autoComplete="off"
          value={props.qtyText}
          disabled={props.disabled}
          readOnly={props.locked}
          aria-invalid={props.qtyProblem !== null}
          aria-describedby={`${qtyId}-error`}
          onChange={(event) => props.onQty(event.target.value.replace(/\D/g, '').slice(0, 3))}
        />
      </div>
      <FieldNote id={`${qtyId}-error`} message={props.qtyProblem} />
    </div>
  )
}
