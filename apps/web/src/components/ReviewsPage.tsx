// 확인 필요 목록 (SPEC §7 화면 15, CMT-04, R-20 7, D-O1-04·08·10, D-O2-07·14, AC-O2-33~39).
// - 줄 = 원래 순서(엔진 listReviews 순서). 받은 시각·구매자 이름·댓글 글(이스케이프)·사유 낱말, 고르기 칸(상품·항목마다 선택지·수량).
// - 미리 채움은 엔진이 읽은 것만(번호·읽은 옵션·읽은 수량). 수량을 읽지 않았으면 빈 칸이다(1로 채우지 않는다). 선택지가 하나뿐인 항목은 그 값.
// - 후보 제안("혹시: XL?")은 칸을 채울 뿐 보내지 않는다(D-O-11).
// - "주문으로"·"주문 아님"(줄마다)과 고르기 상자 + "고른 줄 주문으로"·"고른 줄 주문 아님". 보내기는 방송자 조치처럼 5초 대기·되돌리기(묶음도 5초 하나)이고
//   원래 순서대로 하나씩 보낸다(서버 묶음 API 없음 — D-O2-14). 찜이 생긴 줄은 사라지며 "1등"·"대기 n번"·"품절"을 잠깐 보이고,
//   아무 일도 없었던 줄(changed=false)은 까닭과 함께 남는다(주의 색).
// - 휴대폰(375px): 고르기 칸은 세로로 쌓이고 누르는 곳은 44px 이상, 수량 칸은 숫자 키패드. 마우스를 올려야만 보이는 조작은 없다.
// A1 (CMT-06, AC-A1-20·21, D-A1-01·07): 항목의 제안(서버 suggestion)이 있으면 고르기 칸 위에 "제안: 21번 반바지 M 1개"·출처("비슷한 글자로 찾음"·"AI가 읽음")와
//   [이대로 주문](제안 값으로 "주문으로"와 같은 5초 대기 바로잡기 하나)·[고치기](칸만 제안 값으로 — 요청 없음). 고르기 칸은 제안으로 미리 채우지 않는다.
//   화면을 열 때 AI 제안 받기를 한 번 부른다(lib/assist.ts) — 목록·조치는 그 요청을 기다리지 않는다.
//   - 제안이 보이는 줄에서는 제안과 같은 선택지를 가리키는 "혹시" 후보를 숨긴다([고치기] 뒤에도 — D-A1-13).
//   - [이대로 주문]의 되돌리기 띠·결과 끝에 "→ 21번 반바지 M 1개"를 붙인다(D-A1-14). 칸으로 고른 "주문으로"는 그대로.
//   - 목록을 다시 읽어 제안 칸이 새로 생기면 그 칸의 [이대로 주문]·[고치기]는 0.5초 동안 눌러도 아무 일도 없다(D-A1-15).
import { DEFAULT_SETTINGS } from '@livejjim/core'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { get, post } from '../api/client.ts'
import type { BroadcastView, Product, ReviewItem, ReviewsView, WriteResult } from '../api/types.ts'
import { useUndoQueue } from '../lib/host-delay.ts'
import { dateWords, kstTime } from '../lib/kst.ts'
import { useLeaveGuard } from '../lib/leave-guard.ts'
import {
  outcomeOf,
  pickFor,
  prefillOf,
  qtyProblemWords,
  readQty,
  remainingOf,
  suggestionsFor,
  variantTextOf,
  type LineOutcome,
  type ReviewPick,
} from '../lib/options.ts'
import { ASSIST_OFFER, ASSIST_READING, ASSIST_YOUTUBE_EXCLUDED, showsYoutubeExcluded, suggestionView, useAssistOnOpen, type SuggestionView } from '../lib/assist.ts'
import { reviewsPath, useReviews } from '../lib/reviews.ts'
import { routePath, type Navigate, type ReviewsRoute } from '../lib/router.ts'
import type { UndoItem, UndoQueue } from '../lib/undo-queue.ts'
import { ORIGIN_WORD, REVIEW_REASON_WORD } from '../lib/words.ts'
import { ErrorNote } from './ErrorNote.tsx'
import { UndoBar, secondsWord } from './UndoBar.tsx'

/** 줄의 키 (방송 + 출처) */
export const reviewKey = (review: Pick<ReviewItem, 'broadcast' | 'item'>): string => `${review.broadcast}|${review.item}`

/** 찜이 생긴 줄의 결과를 보이는 시간 */
const DONE_MS = 8000
const NO_ITEMS: readonly UndoItem[] = []
/** 새로 나타난 제안 칸의 버튼이 누름을 받지 않는 시간 (D-A1-15) */
export const SUGGESTION_SETTLE_MS = 500

export const BLANK_LINE = (n: number): string => `${String(n)}번째 줄에 빈 칸이 있어요`

export interface ReviewsPageProps {
  readonly route: ReviewsRoute
  readonly navigate: Navigate
}

export function ReviewsPage({ route, navigate }: ReviewsPageProps) {
  const query = useMemo(() => ({ ...(route.broadcast === undefined ? {} : { broadcast: route.broadcast }), rehearsal: route.rehearsal }), [route.broadcast, route.rehearsal])
  const reviews = useReviews(query)
  const queue = useUndoQueue()
  const view = reviews.view
  const broadcast = route.broadcast === undefined ? undefined : view?.broadcasts.find((item) => item.id === route.broadcast)
  const assist = useAssistOnOpen(query, reviews.reload)
  return (
    <main className="page page-wide reviews-page stack">
      <h1>확인 필요</h1>
      {route.rehearsal ? (
        <p className="rehearsal-banner" role="note">
          리허설 방송의 확인 필요예요 — 실제 판매가 아니에요
        </p>
      ) : null}
      <p className="hint">주문인지 애매한 댓글이에요. 상품·옵션·수량을 골라 "주문으로"를 누르거나, 주문이 아니면 "주문 아님"을 눌러 주세요.</p>
      {route.broadcast !== undefined ? (
        <div className="row">
          <p>
            <strong>{broadcast === undefined ? '고른 방송' : `${broadcast.title} · ${dateWords(broadcast.date)}`}</strong> 방송만 보여요.
          </p>
          <button type="button" className="button" onClick={() => navigate({ name: 'reviews', rehearsal: route.rehearsal })}>
            모든 방송 보기
          </button>
          <button type="button" className="button" onClick={() => navigate({ name: 'console', id: route.broadcast ?? '' })}>
            콘솔로
          </button>
        </div>
      ) : null}
      {reviews.error !== null ? <ErrorNote error={reviews.error} onRetry={() => void reviews.reload()} retryLabel="다시 불러오기" /> : null}
      {assist.reading ? (
        <p className="hint" role="status">
          {ASSIST_READING}
        </p>
      ) : null}
      {assist.notice !== null ? (
        <p className="notice" role="status">
          {assist.notice}
        </p>
      ) : null}
      {view === null && reviews.error === null ? <p role="status">불러오는 중…</p> : null}
      {view !== null && showsYoutubeExcluded(assist.on, view.reviews) ? <p className="hint">{ASSIST_YOUTUBE_EXCLUDED}</p> : null}
      {view !== null && queue !== null ? <ReviewList view={view} queue={queue} rehearsal={route.rehearsal} reload={reviews.reload} /> : null}
      {assist.offer && view !== null && view.reviews.length > 0 ? (
        <p>
          <a
            className="text-link"
            href={routePath({ name: 'settings', section: 'assist' })}
            onClick={(event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
              event.preventDefault()
              navigate({ name: 'settings', section: 'assist' })
            }}
          >
            {ASSIST_OFFER}
          </a>
        </p>
      ) : null}
    </main>
  )
}

interface LineState {
  readonly pick: ReviewPick
  /** 아무 일도 없었던 결과 (고치면 지운다) */
  readonly kept: string | null
}

/** 보낸 줄 (choice: [이대로 주문]으로 보낸 제안 값의 글) */
interface SentLine {
  readonly review: ReviewItem
  readonly event: Record<string, unknown>
  readonly changed: boolean
  readonly choice?: string
}

/** 띠·결과 끝의 " → 21번 반바지 M 1개" ([이대로 주문]일 때만 — D-A1-14) */
const choiceTail = (choice: string | undefined): string => (choice === undefined ? '' : ` → ${choice}`)

interface DoneNote {
  readonly id: number
  readonly words: string
}

function ReviewList({ view, queue, rehearsal, reload }: { readonly view: ReviewsView; readonly queue: UndoQueue; readonly rehearsal: boolean; readonly reload: () => Promise<ReviewsView | null> }) {
  useLeaveGuard(queue)
  const items = useSyncExternalStore(queue.subscribe, queue.getSnapshot) ?? NO_ITEMS
  const products = useMemo(() => new Map(view.products.map((product) => [product.key, product])), [view.products])
  const broadcasts = useMemo(() => new Map(view.broadcasts.map((item) => [item.id, item])), [view.broadcasts])
  const [lines, setLines] = useState<ReadonlyMap<string, LineState>>(new Map())
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [done, setDone] = useState<readonly DoneNote[]>([])
  const doneId = useRef(1)
  const batches = useRef(new Map<string, readonly string[]>())
  const batchId = useRef(1)
  const [bulkProblem, setBulkProblem] = useState<string | null>(null)

  // 새 줄은 미리 채움으로 시작한다. 사라진 줄의 칸 값·고르기는 버린다
  useEffect(() => {
    setLines((current) => {
      const next = new Map<string, LineState>()
      for (const review of view.reviews) {
        const key = reviewKey(review)
        next.set(key, current.get(key) ?? { pick: prefillOf(review, products), kept: null })
      }
      return next
    })
    setSelected((current) => {
      const keys = new Set(view.reviews.map(reviewKey))
      const next = new Set([...current].filter((key) => keys.has(key)))
      return next.size === current.size ? current : next
    })
  }, [view.reviews, products])

  // 결과 글은 잠깐 보인다
  useEffect(() => {
    if (done.length === 0) return
    const timer = setTimeout(() => setDone((list) => list.slice(1)), DONE_MS)
    return () => clearTimeout(timer)
  }, [done])

  /** 보내기 전·보내는 중인 줄 */
  const pending = useMemo(() => {
    const out = new Set<string>()
    for (const item of items) {
      if (item.kind !== 'action' || item.meta === null) continue
      if (item.status !== 'waiting' && item.status !== 'sending' && item.status !== 'retrying') continue
      for (const key of batches.current.get(item.meta) ?? []) out.add(key)
    }
    return out
  }, [items])

  const setPick = useCallback((key: string, pick: ReviewPick) => {
    setLines((current) => {
      const next = new Map(current)
      next.set(key, { pick, kept: null })
      return next
    })
  }, [])

  const maxQty = (review: ReviewItem): number => broadcasts.get(review.broadcast)?.settings['claim.maxQuantity'] ?? DEFAULT_SETTINGS['claim.maxQuantity']

  /** 그 줄을 보낼 수 있으면 보낼 이벤트 (빈 칸이 있으면 null) */
  const eventOf = (review: ReviewItem): Record<string, unknown> | null => {
    const state = lines.get(reviewKey(review))
    if (state === undefined) return null
    const product = products.get(state.pick.product)
    if (product === undefined) return null
    const qty = readQty(state.pick.qty, maxQty(review))
    if (qty === null) return null
    if (product.options.length > 0 && variantTextOf(product, state.pick.options) === null) return null
    return {
      type: 'host.resolveReview',
      b: review.broadcast,
      item: review.item,
      no: product.no,
      qty,
      ...(product.options.length > 0 ? { options: { ...state.pick.options } } : {}),
    }
  }

  /** 결과 보기: 보낸 뒤의 상품으로 (방송마다 그 방송의 상품을 다시 받는다 — 마지막 줄을 보냈어도 상품이 남아 있다) */
  const showResults = async (sent: readonly SentLine[]) => {
    const fresh = new Map<string, Product>()
    for (const b of new Set(sent.map((line) => line.review.broadcast))) {
      try {
        const next = await get<ReviewsView>(reviewsPath({ broadcast: b, rehearsal }))
        for (const product of next.products) fresh.set(product.key, product)
      } catch {
        // 결과 글만 못 보인다 — 목록은 실시간으로 맞춰진다
      }
    }
    const notes: DoneNote[] = []
    const kept = new Map<string, string>()
    for (const line of sent) {
      const key = `${line.review.broadcast}/${String(line.event.no)}`
      const product = fresh.get(key) ?? products.get(key)
      const options = (line.event.options ?? {}) as Record<string, string>
      const variant = product === undefined || product.options.length === 0 ? null : variantTextOf(product, options)
      const outcome: LineOutcome = outcomeOf(line.changed, { product: key, variant, qty: Number(line.event.qty), buyer: line.review.currentBuyer }, product)
      if (outcome.kind === 'claimed') notes.push({ id: doneId.current++, words: `${line.review.buyerName} · ${line.review.text ?? ''}${choiceTail(line.choice)} — ${outcome.word}` })
      else kept.set(reviewKey(line.review), outcome.word)
    }
    if (notes.length > 0) setDone((list) => [...list, ...notes])
    if (kept.size > 0) {
      setLines((current) => {
        const next = new Map(current)
        for (const [key, word] of kept) {
          const state = next.get(key)
          if (state !== undefined) next.set(key, { ...state, kept: word })
        }
        return next
      })
    }
    void reload()
  }

  /** 지금(누른 순간) 보내기 전·보내는 중인 줄 — 다시 그리기 전에 두 번 눌러도 한 번만 (AC-A1-20) */
  const pendingNow = (): Set<string> => {
    const out = new Set<string>()
    for (const item of queue.getSnapshot()) {
      if (item.kind !== 'action' || item.meta === null) continue
      if (item.status !== 'waiting' && item.status !== 'sending' && item.status !== 'retrying') continue
      for (const key of batches.current.get(item.meta) ?? []) out.add(key)
    }
    return out
  }

  /** 원래 순서로 보낸다 — 줄마다 요청 번호를 따로(묶음의 요청 번호 + 줄 번호: 다시 보내도 같은 번호라 한 번만 기록).
   *  fixed: 칸 대신 보낼 바로잡기와 그 값의 글 (제안의 [이대로 주문] — 띠·결과 끝에 "→ 21번 반바지 M 1개") */
  const queueLines = (targets: readonly ReviewItem[], kind: 'resolve' | 'dismiss', fixed?: { readonly event: Record<string, unknown>; readonly choice: string }) => {
    if (targets.length === 0) return
    const busy = pendingNow()
    if (targets.some((review) => busy.has(reviewKey(review)))) return
    const ordered = [...targets].sort((a, b) => view.reviews.indexOf(a) - view.reviews.indexOf(b))
    const events = ordered.map((review) => (kind === 'resolve' ? (fixed?.event ?? eventOf(review)) : { type: 'host.dismissReview', b: review.broadcast, item: review.item }))
    if (events.some((event) => event === null)) return
    const meta = `reviews-${String(batchId.current++)}`
    batches.current.set(meta, ordered.map(reviewKey))
    const label =
      ordered.length === 1
        ? `${ordered[0]?.buyerName ?? ''} "${ordered[0]?.text ?? ''}" ${kind === 'resolve' ? '주문으로' : '주문 아님'}${choiceTail(fixed?.choice)}`
        : `확인 필요 ${String(ordered.length)}줄 ${kind === 'resolve' ? '주문으로' : '주문 아님'}`
    const results: SentLine[] = []
    queue.add({
      label,
      meta,
      send: async (requestId) => {
        results.length = 0
        let last: WriteResult | null = null
        let any = false
        for (let i = 0; i < ordered.length; i++) {
          const review = ordered[i] as ReviewItem
          const event = events[i] as Record<string, unknown>
          const result = await post<WriteResult>('/api/events', { requestId: `${requestId}-${String(i + 1)}`, ...event })
          results.push({ review, event, changed: result.changed, ...(fixed === undefined ? {} : { choice: fixed.choice }) })
          any ||= result.changed
          last = result
        }
        // 띠의 "적용되지 않았어요"는 모든 줄이 아무 일도 없었을 때만 — 줄마다의 까닭은 그 줄에 보인다
        return { ...(last as WriteResult), changed: any || kind === 'resolve' }
      },
      onResult: () => {
        if (kind === 'resolve') void showResults([...results])
        else void reload()
      },
      // 중간에 실패해도 앞 줄은 기록된 그대로다 (D-O2-14) — 목록을 다시 받아 남은 줄을 보인다
      onError: () => {
        if (kind === 'resolve' && results.length > 0) void showResults([...results])
        else void reload()
      },
    })
    setSelected((current) => {
      const next = new Set(current)
      for (const review of ordered) next.delete(reviewKey(review))
      return next
    })
    setBulkProblem(null)
  }

  /** 제안 그대로 주문으로 — 번호·옵션·수량 = 제안 값 (source는 보내지 않는다) */
  const acceptSuggestion = (review: ReviewItem, suggestion: SuggestionView) => {
    queueLines([review], 'resolve', {
      event: {
        type: 'host.resolveReview',
        b: review.broadcast,
        item: review.item,
        no: suggestion.product.no,
        qty: suggestion.qty,
        ...(suggestion.product.options.length > 0 ? { options: { ...suggestion.options } } : {}),
      },
      choice: suggestion.choice,
    })
  }

  const chosen = view.reviews.filter((review) => selected.has(reviewKey(review)) && !pending.has(reviewKey(review)))
  const blank = chosen.find((review) => eventOf(review) === null)
  const blankNo = blank === undefined ? null : view.reviews.indexOf(blank) + 1

  if (view.reviews.length === 0 && done.length === 0) {
    return (
      <>
        <UndoBar items={items} queue={queue} />
        <p>확인할 댓글이 없어요.</p>
      </>
    )
  }
  return (
    <>
      <div className="page-sticky">
        <UndoBar items={items} queue={queue} />
      </div>
      {done.length > 0 ? (
        <ul className="plain-list stack-tight" aria-label="보낸 결과">
          {done.map((note) => (
            <li key={note.id} className="notice" role="status" data-tone="success">
              {note.words}
            </li>
          ))}
        </ul>
      ) : null}
      {view.reviews.length > 0 ? (
        <section className="card stack-tight review-bulk" aria-label="고른 줄">
          <p>고른 줄 {chosen.length}개</p>
          <div className="row">
            <button type="button" className="button button-primary" disabled={chosen.length === 0 || blank !== undefined} onClick={() => queueLines(chosen, 'resolve')}>
              고른 줄 주문으로
            </button>
            <button type="button" className="button" disabled={chosen.length === 0} onClick={() => queueLines(chosen, 'dismiss')}>
              고른 줄 주문 아님
            </button>
          </div>
          {blankNo !== null ? (
            <p className="warning" role="alert" data-tone="warning">
              {BLANK_LINE(blankNo)}
            </p>
          ) : null}
          {bulkProblem !== null ? <p className="field-error">{bulkProblem}</p> : null}
        </section>
      ) : null}
      <ol className="plain-list stack review-list" aria-label="확인 필요 목록">
        {view.reviews.map((review, index) => {
          const key = reviewKey(review)
          const state = lines.get(key) ?? { pick: prefillOf(review, products), kept: null }
          const suggestion = suggestionView(review.suggestion, review.broadcast, products, maxQty(review))
          return (
            <ReviewRow
              key={key}
              n={index + 1}
              review={review}
              state={state}
              broadcast={broadcasts.get(review.broadcast)}
              many={broadcasts.size > 1}
              products={view.products.filter((product) => product.broadcast === review.broadcast)}
              selected={selected.has(key)}
              pending={pending.has(key)}
              delayMs={queue.delayMs}
              ready={eventOf(review) !== null}
              maxQty={maxQty(review)}
              suggestion={suggestion}
              onAccept={() => (suggestion === null ? undefined : acceptSuggestion(review, suggestion))}
              onEdit={() => (suggestion === null ? undefined : setPick(key, { product: suggestion.product.key, options: { ...suggestion.options }, qty: String(suggestion.qty) }))}
              onSelect={(on) =>
                setSelected((current) => {
                  const next = new Set(current)
                  if (on) next.add(key)
                  else next.delete(key)
                  return next
                })
              }
              onPick={(pick) => setPick(key, pick)}
              onResolve={() => queueLines([review], 'resolve')}
              onDismiss={() => queueLines([review], 'dismiss')}
            />
          )
        })}
      </ol>
    </>
  )
}

const productName = (product: Product): string => `${String(product.no)}번 ${product.name.trim() === '' ? '품종 미입력' : product.name}`

interface ReviewRowProps {
  readonly n: number
  readonly review: ReviewItem
  readonly state: LineState
  readonly broadcast: BroadcastView | undefined
  readonly many: boolean
  readonly products: readonly Product[]
  readonly selected: boolean
  readonly pending: boolean
  readonly delayMs: number
  readonly ready: boolean
  readonly maxQty: number
  /** 제안 (없으면 null) */
  readonly suggestion: SuggestionView | null
  readonly onAccept: () => void
  readonly onEdit: () => void
  readonly onSelect: (on: boolean) => void
  readonly onPick: (pick: ReviewPick) => void
  readonly onResolve: () => void
  readonly onDismiss: () => void
}

function ReviewRow({ n, review, state, broadcast, many, products, selected, pending, delayMs, ready, maxQty, suggestion, onAccept, onEdit, onSelect, onPick, onResolve, onDismiss }: ReviewRowProps) {
  const { pick } = state
  const product = products.find((item) => item.key === pick.product)
  const remaining = remainingOf(product, pick.options)
  const qtyText = pick.qty.trim()
  const qtyBad = qtyText !== '' && readQty(qtyText, maxQty) === null
  // 제안과 같은 선택지를 가리키는 "혹시"는 숨긴다 — 같은 값에 버튼 둘이면 망설인다 (D-A1-13)
  const suggestions = (product !== undefined && product.options.length > 0 ? suggestionsFor(review.text ?? '', product) : []).filter(
    (candidate) => suggestion === null || candidate.item === null || !Object.hasOwn(suggestion.options, candidate.item) || suggestion.options[candidate.item] !== candidate.label,
  )
  // 처음 그릴 때부터 있던 제안은 바로 눌린다. 다시 읽어 새로 생긴(바뀐) 제안 칸만 0.5초 동안 누름을 받지 않는다 (D-A1-15)
  const suggestionId = suggestion === null ? null : `${suggestion.words}|${suggestion.source}`
  const seenSuggestion = useRef(suggestionId)
  const settleUntil = useRef(0)
  useLayoutEffect(() => {
    if (seenSuggestion.current === suggestionId) return
    seenSuggestion.current = suggestionId
    settleUntil.current = suggestionId === null ? 0 : performance.now() + SUGGESTION_SETTLE_MS
  }, [suggestionId])
  const settled = (act: () => void) => () => {
    if (performance.now() < settleUntil.current) return
    act()
  }
  const sorted = [...products].sort((a, b) => a.no - b.no)
  const lineName = `${String(n)}번째 줄`
  return (
    <li className="card review-row stack-tight" aria-label={lineName}>
      <div className="row review-head">
        <label className="choice">
          <input type="checkbox" checked={selected} disabled={pending} onChange={(event) => onSelect(event.target.checked)} aria-label={`${lineName} 고르기`} />
          <span>{n}</span>
        </label>
        <span className="review-time">{review.origin === 'sms' && review.received !== null ? review.received : kstTime(review.at)}</span>
        <strong className="review-buyer">{review.buyerName}</strong>
        {review.origin === 'sms' ? <span className="tag">{ORIGIN_WORD.sms}</span> : null}
        {review.phoneLast4 !== null ? <span>뒤 4자리 {review.phoneLast4}</span> : null}
        <span className="tag tag-alert">{REVIEW_REASON_WORD[review.reason]}</span>
        {many && broadcast !== undefined ? <span className="hint">{`${broadcast.title} · ${dateWords(broadcast.date)}`}</span> : null}
      </div>
      <p className="review-text">{review.text ?? (review.origin === 'sms' ? '메모 없음' : '')}</p>
      {suggestion !== null ? (
        <div className="review-suggestion stack-tight" role="group" aria-label={`${lineName} 제안`}>
          <p className="review-suggestion-words">
            <strong>{suggestion.words}</strong> <span className="review-suggestion-source">{suggestion.source}</span>
          </p>
          <div className="row review-actions">
            <button type="button" className="button" disabled={pending} onClick={settled(onAccept)} aria-label={`${lineName} 이대로 주문`}>
              이대로 주문
            </button>
            <button type="button" className="button" disabled={pending} onClick={settled(onEdit)} aria-label={`${lineName} 고치기`}>
              고치기
            </button>
          </div>
        </div>
      ) : null}
      <div className="review-picks">
        <label className="field">
          <span>상품</span>
          <select
            className="input"
            value={pick.product}
            disabled={pending}
            onChange={(event) => {
              const next = products.find((item) => item.key === event.target.value)
              onPick({ product: event.target.value, options: pickFor(next, []), qty: pick.qty })
            }}
          >
            <option value="">고르기</option>
            {sorted.map((item) => (
              <option key={item.key} value={item.key}>
                {productName(item)}
              </option>
            ))}
          </select>
        </label>
        {product?.options.map((item) => (
          <label key={item.name} className="field">
            <span>{item.name}</span>
            <select
              className="input"
              value={pick.options[item.name] ?? ''}
              disabled={pending}
              onChange={(event) => {
                const options = { ...pick.options }
                if (event.target.value === '') delete options[item.name]
                else options[item.name] = event.target.value
                onPick({ ...pick, options })
              }}
            >
              <option value="">고르기</option>
              {item.choices.map((choice) => {
                const left = product.options.length === 1 ? product.variants.find((variant) => variant.text === choice.label)?.remaining : undefined
                return (
                  <option key={choice.label} value={choice.label}>
                    {left === undefined ? choice.label : `${choice.label} (남은 ${String(left)}개)`}
                  </option>
                )
              })}
            </select>
          </label>
        ))}
        <label className="field">
          <span>수량</span>
          <input
            className="input input-number"
            inputMode="numeric"
            autoComplete="off"
            value={pick.qty}
            disabled={pending}
            aria-invalid={qtyBad}
            onChange={(event) => onPick({ ...pick, qty: event.target.value.replace(/[^\d]/g, '').slice(0, 3) })}
          />
        </label>
      </div>
      {qtyBad ? (
        <p className="field-error" role="alert">
          {qtyProblemWords(maxQty)}
        </p>
      ) : null}
      {remaining !== null ? <p className="review-remaining">남은 {remaining}개</p> : null}
      {suggestions.length > 0 ? (
        <div className="row" role="group" aria-label="후보 제안">
          {suggestions.map((suggestion) => (
            <button
              key={`${suggestion.item ?? ''}|${suggestion.label}`}
              type="button"
              className="button button-small"
              disabled={pending}
              onClick={() => (suggestion.item === null ? undefined : onPick({ ...pick, options: { ...pick.options, [suggestion.item]: suggestion.label } }))}
            >
              혹시: {suggestion.label}?
            </button>
          ))}
        </div>
      ) : null}
      {state.kept !== null ? (
        <p className="warning" role="status" data-tone="warning">
          {state.kept}
        </p>
      ) : null}
      {pending ? (
        <p className="tag tag-waiting" role="status">
          {secondsWord(delayMs)} 뒤 보내요
        </p>
      ) : null}
      <div className="row review-actions">
        <button type="button" className="button" disabled={pending || !ready} onClick={onResolve} aria-label={`${lineName} 주문으로`}>
          주문으로
        </button>
        <button type="button" className="button" disabled={pending} onClick={onDismiss} aria-label={`${lineName} 주문 아님`}>
          주문 아님
        </button>
      </div>
    </li>
  )
}
