// 확인 필요 (D-APPX-03 — 웹 ReviewsPage와 같은 규칙·문구, CMT-04, D-O1-08, D-O2-07·14, D-A1-01·13·14·15).
// 주문인지 애매한 댓글·문자찜을 원래 순서로 보이고, 줄마다 상품·옵션·수량을 골라 "주문으로" 또는 "주문 아님".
// 미리 채움은 엔진이 읽은 것만(수량을 읽지 않았으면 빈 칸). 서버 제안("제안: 21번 반바지 M 1개")은 [이대로 주문]·[고치기]로만 쓰이고
// 새로 생긴 제안 칸은 0.5초 동안 누름을 받지 않는다. 보내기는 방송자 조치처럼 5초 대기·되돌리기, 고른 줄은 원래 순서로 하나씩(줄마다 요청 번호).
// 찜이 생긴 줄은 "1등"·"대기 n번"·"품절"을 잠깐 보이고, 아무 일도 없었던 줄은 까닭과 함께 남는다. 기다리는 조치가 있으면 나가기 전에 묻는다.
// 휴대폰 글자 맞춰 보기("혹시: XL?")는 웹에만 있다 — 앱은 판정·추출 코드를 들이지 않는다(APP-01 AC3). 서버 제안이 그 몫을 한다.
// 모양 (D-UX3-96): 단추 둘은 같은 폭으로 한 줄에, 부정은 왼쪽·긍정은 오른쪽 — [주문 아님] · [주문으로], [고치기] · [이대로 주문].
// 안내 글은 맨 위 한 줄 회색 글, 제안은 옅은 초록 칸 안에.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import type { AssistResult, AssistSettings, AssistSuggestResponse, BroadcastView, Product, ReviewItem, ReviewsView, WriteResult } from '@livejjim/web/src/api/types.ts'
import { ASSIST_BUSY_RELOAD_MS, ASSIST_BUSY_RELOADS, ASSIST_FAILED, ASSIST_LIMIT, ASSIST_LIMIT_UNKNOWN, ASSIST_OFFER, ASSIST_READING, ASSIST_YOUTUBE_EXCLUDED, showsYoutubeExcluded, suggestionView, type SuggestionView } from '@livejjim/web/src/lib/assist-words.ts'
import { dateWords, kstTime } from '@livejjim/web/src/lib/kst.ts'
import { outcomeOf, pickFor, prefillOf, qtyProblemWords, readQty, remainingOf, variantTextOf, type LineOutcome, type ReviewPick } from '@livejjim/web/src/lib/review-pick.ts'
import type { UndoItem, UndoQueue } from '@livejjim/web/src/lib/undo-queue.ts'
import { NO_ITEMS, UndoStrip, noItems, noSubscribe, secondsWord, useUndoQueue, waitingCount } from '../lib/host-queue.tsx'
import { ORIGIN_WORD, REVIEW_REASON_WORD } from '@livejjim/web/src/lib/words.ts'
import { get, isApiError, post, withQuery, type ApiError } from '../api/client.ts'
import { RETRY_NOW } from '../lib/words.ts'
import { useServices } from '../services.tsx'
import { Pill } from '../ui/day-pills.tsx'
import { AppHeader, BigButton, ButtonRow, Card, ConfirmSheet, Icon, TextField, Txt, useKit } from '../ui/kit/index.ts'
import { RADIUS, SPACE } from '../ui/kit/tokens.ts'
import { Loading, Notice, Tag } from '../ui/parts.tsx'

export const REVIEWS_TITLE = '확인 필요'
export const REVIEWS_HINT = '주문인지 애매한 댓글이에요. 상품·옵션·수량을 골라 "주문으로"를 누르거나, 주문이 아니면 "주문 아님"을 눌러 주세요.'
export const NOTHING_TO_REVIEW = '확인할 댓글이 없어요.'
export const LEAVE_QUESTION = '아직 보내지 않은 것이 있어요'
export const leaveWords = (n: number): string => `보내기 전인 조치 ${String(n)}개가 있어요. 지금 나가면 보내지 않아요.`
export const BLANK_LINE = (n: number): string => `${String(n)}번째 줄에 빈 칸이 있어요`
/** 기본 최대 수량 (설정이 없을 때 — 코어 DEFAULT_SETTINGS['claim.maxQuantity']와 같다) */
export const DEFAULT_MAX_QTY = 10
/** 새로 나타난 제안 칸의 버튼이 누름을 받지 않는 시간 (D-A1-15) */
export const SUGGESTION_SETTLE_MS = 500
const DONE_MS = 8000
const RELOAD_MS = 250

export const reviewKey = (review: Pick<ReviewItem, 'broadcast' | 'item'>): string => `${review.broadcast}|${review.item}`
const choiceTail = (choice: string | undefined): string => (choice === undefined ? '' : ` → ${choice}`)
const productName = (product: Product): string => `${String(product.no)}번 ${product.name.trim() === '' ? '품종 미입력' : product.name}`


/** 앱은 실제 방송의 확인 필요만 본다 — 리허설은 앱에서 뺐다 (D-UX3-86) */
export interface ReviewsQuery {
  readonly broadcast?: string
}

const reviewsPath = (query: ReviewsQuery): string => withQuery('/api/reviews', { broadcast: query.broadcast, rehearsal: false })

/** 목록 받기: 실제 방송의 바뀜 알림을 짧게 모아 다시 읽는다. 다시 붙어도 다시 읽는다. 권한 없음·없는 방송은 빈 목록 */
function useReviewList(query: ReviewsQuery) {
  const { stream } = useServices()
  const [view, setView] = useState<ReviewsView | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const path = reviewsPath(query)
  const version = useRef(0)
  const reload = useCallback(async (): Promise<ReviewsView | null> => {
    const mine = ++version.current
    try {
      const next = await get<ReviewsView>(path)
      if (mine === version.current) {
        setView(next)
        setError(null)
      }
      return next
    } catch (caught: unknown) {
      if (!isApiError(caught)) throw caught
      if (mine === version.current) {
        if (caught.status === 403 || caught.status === 404) setView({ rehearsal: false, reviews: [], products: [], broadcasts: [], scopes: [] })
        else setError(caught)
      }
      return null
    }
  }, [path])
  useEffect(() => {
    void reload()
    const view = stream.open()
    let timer: ReturnType<typeof setTimeout> | undefined
    let ready = 0
    const schedule = () => {
      if (timer !== undefined) return
      timer = setTimeout(() => {
        timer = undefined
        void reload()
      }, RELOAD_MS)
    }
    view.addEventListener('ready', () => {
      ready++
      if (ready > 1) schedule()
    })
    view.addEventListener('change', (event) => {
      try {
        const scope = JSON.parse(event.data ?? '{}') as { rehearsal?: boolean }
        if (scope.rehearsal !== true) schedule()
      } catch {
        schedule()
      }
    })
    return () => {
      if (timer !== undefined) clearTimeout(timer)
      view.close()
    }
  }, [reload, stream])
  return { view, error, reload }
}

/** 화면을 열 때 AI 제안 받기를 한 번 (웹 useAssistOnOpen과 같은 순서·문장). 진행 중이면 목록만 2초마다(많아야 8번) 다시 읽는다 */
function useAssistOnOpen(query: ReviewsQuery, reload: () => Promise<unknown>) {
  const [state, setState] = useState<{ reading: boolean; notice: string | null; offer: boolean; on: boolean }>({ reading: false, notice: null, offer: false, on: false })
  const reloadRef = useRef(reload)
  reloadRef.current = reload
  useEffect(() => {
    let alive = true
    let busyTimer: ReturnType<typeof setTimeout> | undefined
    const settings = get<AssistSettings>('/api/assist/settings').then(
      (value) => {
        if (alive) setState((current) => ({ ...current, reading: value.available && value.enabled, on: value.available && value.enabled }))
        return value
      },
      () => null,
    )
    const run = async () => {
      let code: AssistResult | 'ERROR' | 'QUIET'
      try {
        code = (await post<AssistSuggestResponse>('/api/assist/suggest', { rehearsal: false, ...(query.broadcast === undefined ? {} : { broadcast: query.broadcast }) })).result
      } catch (caught: unknown) {
        code = isApiError(caught) && (caught.network || caught.status >= 500) ? 'ERROR' : 'QUIET'
      }
      const current = await settings
      if (!alive) return
      const on = current !== null && current.available && current.enabled
      setState({
        reading: false,
        on,
        offer: code === 'OFF' && current?.available === true,
        notice: code === 'LIMIT' ? (current === null || !Number.isInteger(current.dailyLimit) ? ASSIST_LIMIT_UNKNOWN : ASSIST_LIMIT(current.dailyLimit)) : code === 'FAILED' || code === 'ERROR' ? ASSIST_FAILED : null,
      })
      void reloadRef.current()
      if (code === 'BUSY') {
        let left = ASSIST_BUSY_RELOADS
        const tick = () => {
          busyTimer = undefined
          if (!alive) return
          void reloadRef.current()
          left -= 1
          if (left > 0) busyTimer = setTimeout(tick, ASSIST_BUSY_RELOAD_MS)
        }
        busyTimer = setTimeout(tick, ASSIST_BUSY_RELOAD_MS)
      }
    }
    void run()
    return () => {
      alive = false
      if (busyTimer !== undefined) clearTimeout(busyTimer)
    }
  }, [query.broadcast])
  return state
}

export function ReviewsScreen({ onBack, query = {}, openSettings }: { readonly onBack: () => void; readonly query?: ReviewsQuery; readonly openSettings?: () => void }) {
  const { p } = useKit()
  const { broadcast: queryBroadcast } = query
  const stableQuery = useMemo<ReviewsQuery>(() => (queryBroadcast === undefined ? {} : { broadcast: queryBroadcast }), [queryBroadcast])
  const { view, error, reload } = useReviewList(stableQuery)
  const assist = useAssistOnOpen(stableQuery, reload)
  const queue = useUndoQueue()
  const items = useSyncExternalStore(queue?.subscribe ?? noSubscribe, queue?.getSnapshot ?? noItems) ?? NO_ITEMS
  const [leaving, setLeaving] = useState(false)
  const back = () => (waitingCount(items) > 0 ? setLeaving(true) : onBack())
  const broadcast = stableQuery.broadcast === undefined ? undefined : view?.broadcasts.find((item) => item.id === stableQuery.broadcast)
  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="reviews-screen">
      <AppHeader title={REVIEWS_TITLE} onBack={back} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SPACE.lg, paddingTop: SPACE.sm, paddingBottom: SPACE.xxxl, gap: SPACE.md }} keyboardShouldPersistTaps="handled">
        <View style={{ paddingHorizontal: SPACE.xs, gap: SPACE.xs }}>
          {broadcast !== undefined ? <Txt weight="medium">{`${broadcast.title} · ${dateWords(broadcast.date)} 방송만 보여요.`}</Txt> : null}
          <Txt step="caption" color="textSub">{REVIEWS_HINT}</Txt>
        </View>
        {error !== null ? (
          <View style={{ gap: SPACE.sm }}>
            <Notice tone="danger" alert>{error.message}</Notice>
            <BigButton kind="secondary" label={RETRY_NOW} onPress={() => void reload()} />
          </View>
        ) : null}
        {assist.reading ? <Txt step="caption" color="textSub">{ASSIST_READING}</Txt> : null}
        {assist.notice !== null ? <Notice tone="info">{assist.notice}</Notice> : null}
        {view === null && error === null ? <Loading /> : null}
        {view !== null && showsYoutubeExcluded(assist.on, view.reviews) ? <Txt step="caption" color="textSub">{ASSIST_YOUTUBE_EXCLUDED}</Txt> : null}
        {queue !== null ? <UndoStrip items={items} queue={queue} /> : null}
        {view !== null && queue !== null ? <ReviewList view={view} queue={queue} items={items} reload={reload} /> : null}
        {assist.offer && view !== null && view.reviews.length > 0 && openSettings !== undefined ? <BigButton kind="outline" label={ASSIST_OFFER} onPress={openSettings} /> : null}
      </ScrollView>
      <ConfirmSheet
        visible={leaving}
        question={LEAVE_QUESTION}
        description={leaveWords(waitingCount(items))}
        confirmLabel="보내지 않고 나가기"
        cancelLabel="머무르기"
        danger
        onCancel={() => setLeaving(false)}
        onConfirm={() => {
          setLeaving(false)
          queue?.discardWaiting()
          onBack()
        }}
      />
    </View>
  )
}

interface LineState {
  readonly pick: ReviewPick
  readonly kept: string | null
}

interface SentLine {
  readonly review: ReviewItem
  readonly event: Record<string, unknown>
  readonly changed: boolean
  readonly choice?: string
}

function ReviewList({ view, queue, items, reload }: { readonly view: ReviewsView; readonly queue: UndoQueue; readonly items: readonly UndoItem[]; readonly reload: () => Promise<ReviewsView | null> }) {
  const products = useMemo(() => new Map(view.products.map((product) => [product.key, product])), [view.products])
  const broadcasts = useMemo(() => new Map(view.broadcasts.map((item) => [item.id, item])), [view.broadcasts])
  const [lines, setLines] = useState<ReadonlyMap<string, LineState>>(new Map())
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [done, setDone] = useState<readonly { id: number; words: string }[]>([])
  const doneId = useRef(1)
  const batches = useRef(new Map<string, readonly string[]>())
  const batchId = useRef(1)

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

  useEffect(() => {
    if (done.length === 0) return
    const timer = setTimeout(() => setDone((list) => list.slice(1)), DONE_MS)
    return () => clearTimeout(timer)
  }, [done])

  const pendingOf = (list: readonly UndoItem[]): Set<string> => {
    const out = new Set<string>()
    for (const item of list) {
      if (item.kind !== 'action' || item.meta === null) continue
      if (item.status !== 'waiting' && item.status !== 'sending' && item.status !== 'retrying') continue
      for (const key of batches.current.get(item.meta) ?? []) out.add(key)
    }
    return out
  }
  const pending = pendingOf(items)

  const setPick = (key: string, pick: ReviewPick) =>
    setLines((current) => {
      const next = new Map(current)
      next.set(key, { pick, kept: null })
      return next
    })

  const maxQty = (review: ReviewItem): number => broadcasts.get(review.broadcast)?.settings['claim.maxQuantity'] ?? DEFAULT_MAX_QTY

  const eventOf = (review: ReviewItem): Record<string, unknown> | null => {
    const state = lines.get(reviewKey(review))
    if (state === undefined) return null
    const product = products.get(state.pick.product)
    if (product === undefined) return null
    const qty = readQty(state.pick.qty, maxQty(review))
    if (qty === null) return null
    if (product.options.length > 0 && variantTextOf(product, state.pick.options) === null) return null
    return { type: 'host.resolveReview', b: review.broadcast, item: review.item, no: product.no, qty, ...(product.options.length > 0 ? { options: { ...state.pick.options } } : {}) }
  }

  const showResults = async (sent: readonly SentLine[]) => {
    const fresh = new Map<string, Product>()
    for (const b of new Set(sent.map((line) => line.review.broadcast))) {
      try {
        const next = await get<ReviewsView>(reviewsPath({ broadcast: b }))
        for (const product of next.products) fresh.set(product.key, product)
      } catch {
        // 결과 글만 못 보인다 — 목록은 실시간으로 맞춰진다
      }
    }
    const notes: { id: number; words: string }[] = []
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

  const queueLines = (targets: readonly ReviewItem[], kind: 'resolve' | 'dismiss', fixed?: { readonly event: Record<string, unknown>; readonly choice: string }) => {
    if (targets.length === 0) return
    const busy = pendingOf(queue.getSnapshot())
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
        return { ...(last as WriteResult), changed: any || kind === 'resolve' }
      },
      onResult: () => {
        if (kind === 'resolve') void showResults([...results])
        else void reload()
      },
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
  }

  const acceptSuggestion = (review: ReviewItem, suggestion: SuggestionView) =>
    queueLines([review], 'resolve', {
      event: { type: 'host.resolveReview', b: review.broadcast, item: review.item, no: suggestion.product.no, qty: suggestion.qty, ...(suggestion.product.options.length > 0 ? { options: { ...suggestion.options } } : {}) },
      choice: suggestion.choice,
    })

  const chosen = view.reviews.filter((review) => selected.has(reviewKey(review)) && !pending.has(reviewKey(review)))
  const blank = chosen.find((review) => eventOf(review) === null)
  const blankNo = blank === undefined ? null : view.reviews.indexOf(blank) + 1

  if (view.reviews.length === 0 && done.length === 0) return <Txt color="textSub">{NOTHING_TO_REVIEW}</Txt>
  return (
    <View style={{ gap: SPACE.md }}>
      {done.map((note) => (
        <Notice key={note.id} tone="success">{note.words}</Notice>
      ))}
      {view.reviews.length > 0 ? (
        <Card label="고른 줄">
          <Txt step="body" color="textSub">{`고른 줄 ${String(chosen.length)}개`}</Txt>
          <ButtonRow>
            <BigButton kind="outline" label="고른 줄 주문 아님" disabled={chosen.length === 0} onPress={() => queueLines(chosen, 'dismiss')} />
            <BigButton label="고른 줄 주문으로" disabled={chosen.length === 0 || blank !== undefined} onPress={() => queueLines(chosen, 'resolve')} />
          </ButtonRow>
          {blankNo !== null ? <Notice tone="warning" alert>{BLANK_LINE(blankNo)}</Notice> : null}
        </Card>
      ) : null}
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
    </View>
  )
}

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
  readonly suggestion: SuggestionView | null
  readonly onAccept: () => void
  readonly onEdit: () => void
  readonly onSelect: (on: boolean) => void
  readonly onPick: (pick: ReviewPick) => void
  readonly onResolve: () => void
  readonly onDismiss: () => void
}

function ReviewRow({ n, review, state, broadcast, many, products, selected, pending, delayMs, ready, maxQty, suggestion, onAccept, onEdit, onSelect, onPick, onResolve, onDismiss }: ReviewRowProps) {
  const { p } = useKit()
  const { pick } = state
  const product = products.find((item) => item.key === pick.product)
  const remaining = remainingOf(product, pick.options)
  const qtyText = pick.qty.trim()
  const qtyBad = qtyText !== '' && readQty(qtyText, maxQty) === null
  // 다시 읽어 새로 생긴(바뀐) 제안 칸만 0.5초 동안 누름을 받지 않는다 (D-A1-15)
  const suggestionId = suggestion === null ? null : `${suggestion.words}|${suggestion.source}`
  const seen = useRef(suggestionId)
  const settleUntil = useRef(0)
  if (seen.current !== suggestionId) {
    seen.current = suggestionId
    settleUntil.current = suggestionId === null ? 0 : Date.now() + SUGGESTION_SETTLE_MS
  }
  const settled = (act: () => void) => () => {
    if (Date.now() < settleUntil.current) return
    act()
  }
  const sorted = [...products].sort((a, b) => a.no - b.no)
  const lineName = `${String(n)}번째 줄`
  return (
    <Card label={lineName}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SPACE.xs }}>
        <Pressable role="checkbox" aria-checked={selected} aria-label={`${lineName} 고르기`} disabled={pending} onPress={() => onSelect(!selected)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, minHeight: 44, minWidth: 44, borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
          <View style={{ width: 26, height: 26, borderRadius: 13, borderCurve: 'continuous', backgroundColor: selected ? p.primary : p.soft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" color={selected ? p.onPrimary : p.surface} size={16} />
          </View>
          <Txt weight="bold">{String(n)}</Txt>
        </Pressable>
        <Txt step="caption" color="textSub">{review.origin === 'sms' && review.received !== null ? review.received : kstTime(review.at)}</Txt>
        <Txt weight="bold">{review.buyerName}</Txt>
        {review.origin === 'sms' ? <Tag tone="info">{ORIGIN_WORD.sms}</Tag> : null}
        {review.phoneLast4 !== null ? <Txt step="caption">{`뒤 4자리 ${review.phoneLast4}`}</Txt> : null}
        <Tag tone="warning">{REVIEW_REASON_WORD[review.reason]}</Tag>
      </View>
      {many && broadcast !== undefined ? <Txt step="caption" color="textSub">{`${broadcast.title} · ${dateWords(broadcast.date)}`}</Txt> : null}
      <Txt>{review.text ?? (review.origin === 'sms' ? '메모 없음' : '')}</Txt>
      {suggestion !== null ? (
        <View style={{ gap: SPACE.sm, padding: SPACE.md, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: p.freshBg }} role="group" aria-label={`${lineName} 제안`}>
          <View style={{ gap: 2 }}>
            <Txt weight="bold">{suggestion.words}</Txt>
            <Txt step="caption" color="textSub">{suggestion.source}</Txt>
          </View>
          <ButtonRow>
            <BigButton kind="outline" label="고치기" ariaLabel={`${lineName} 고치기`} disabled={pending} onPress={settled(onEdit)} />
            <BigButton kind="secondary" label="이대로 주문" ariaLabel={`${lineName} 이대로 주문`} disabled={pending} onPress={settled(onAccept)} />
          </ButtonRow>
        </View>
      ) : null}
      <Txt step="caption" color="textSub">상품</Txt>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACE.xs }}>
        {sorted.map((item) => (
          <Pill key={item.key} on={item.key === pick.product} label={productName(item)} ariaLabel={`${lineName} 상품 ${productName(item)}`} onPress={() => (pending ? undefined : onPick({ product: item.key, options: pickFor(item, []), qty: pick.qty }))} />
        ))}
      </ScrollView>
      {product?.options.map((item) => (
        <View key={item.name} style={{ gap: SPACE.xs }}>
          <Txt step="caption" color="textSub">{item.name}</Txt>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACE.xs }}>
            {item.choices.map((choice) => {
              const left = product.options.length === 1 ? product.variants.find((variant) => variant.text === choice.label)?.remaining : undefined
              const label = left === undefined ? choice.label : `${choice.label} (남은 ${String(left)}개)`
              return <Pill key={choice.label} on={pick.options[item.name] === choice.label} label={label} ariaLabel={`${lineName} ${item.name} ${label}`} onPress={() => (pending ? undefined : onPick({ ...pick, options: { ...pick.options, [item.name]: choice.label } }))} />
            })}
          </ScrollView>
        </View>
      ))}
      <TextField label="수량" value={pick.qty} editable={!pending} keyboardType="number-pad" onChangeText={(text) => onPick({ ...pick, qty: text.replace(/[^\d]/g, '').slice(0, 3) })} error={qtyBad ? qtyProblemWords(maxQty) : null} />
      {remaining !== null ? <Txt step="caption">{`남은 ${String(remaining)}개`}</Txt> : null}
      {state.kept !== null ? <Notice tone="warning">{state.kept}</Notice> : null}
      {pending ? <Tag tone="info">{`${secondsWord(delayMs)} 뒤 보내요`}</Tag> : null}
      <ButtonRow>
        <BigButton kind="outline" label="주문 아님" ariaLabel={`${lineName} 주문 아님`} disabled={pending} onPress={onDismiss} />
        <BigButton label="주문으로" ariaLabel={`${lineName} 주문으로`} disabled={pending || !ready} onPress={onResolve} />
      </ButtonRow>
    </Card>
  )
}
