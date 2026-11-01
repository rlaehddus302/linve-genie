// 손님 (D-APPX-01 — 웹 "모든 손님"·손님 자세히와 같은 규칙·문구, BUY-06·BUY-07·BUY-08, CUSTOMER_RULES CR-3·CR-5).
// 목록: 정렬(누적 큰 순·최근 산 순·미입금 많은 순)·거르기(단골만·입금 늦음 주의만)·이름 찾기, 줄마다 단골·입금 늦음 주의·차단 꼬리표.
// 자세히: 손님 기록(누적·마지막 구매·미입금·취소), 메모(200자, 연락처 금지, 비우면 한 번 묻기), 저장한 배송지(가린 이름·끝 4자리, 지우기),
// 날짜별 기록(그날 이름·상품 합계·입금 상태). 판매자 계정만 — 서버가 보조자를 막는다. 판매자 사이에 손님 정보를 나누지 않는다(D-KP1-21).
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import {
  BLOCKED_WORD,
  CAUTION_WORD,
  CUSTOMER_FILTERS,
  CUSTOMER_SORTS,
  DAY_LINE_SEALED,
  FILTER_WORD,
  MEMO_CLEARED,
  MEMO_HINT,
  MEMO_MAX,
  MEMO_SAVED,
  MEMO_TOO_LONG,
  NO_PURCHASE,
  REGULAR_WORD,
  SORT_WORD,
  codePoints,
  customerDate,
  dayLineTags,
  hasNoPurchase,
  memoSavedWords,
  summaryLines,
  type CustomerDayLine,
  type CustomerDetailView,
  type CustomerFilter,
  type CustomerRow,
  type CustomerSort,
  type CustomersView,
  type MemoView,
} from '@livejjim/web/src/lib/customers.ts'
import { kstDate } from '@livejjim/web/src/lib/kst.ts'
import { get, isApiError, post, put, withQuery, type ApiError } from '../api/client.ts'
import { formatWon, RETRY_NOW } from '../lib/words.ts'
import { Pill } from '../ui/day-pills.tsx'
import { AppHeader, BigButton, Card, ConfirmSheet, Icon, TextField, Txt, useKit } from '../ui/kit/index.ts'
import { RADIUS, SPACE } from '../ui/kit/tokens.ts'
import { Loading, Notice, Tag } from '../ui/parts.tsx'

/** 손님 자세히의 저장한 배송지 (CR-3·CR-5) — 가린 이름·끝 4자리만 (웹 lib/ledger.ts CustomerLedgerView와 같은 모양) */
interface LedgerView {
  readonly ledgerId: string
  readonly name: string
  readonly phoneLast4: string
  readonly keepUntil: string
  readonly consentDate: string
  readonly linked: readonly { readonly label: string; readonly linkedAt: string }[]
}

export const LEDGER_TITLE = '저장한 배송지'
export const LEDGER_NONE = '저장해 둔 배송지가 없어요. 손님이 확인서 링크에서 "다음 주문에도 이 배송지 쓰기"를 고르면 생겨요.'
export const LEDGER_DELETE = '저장한 배송지 지우기'
export const LEDGER_DELETE_ASK = '이 손님의 저장한 배송지를 지울까요? 지우면 되돌릴 수 없어요. 지난 주문의 배송지와 손님 기록은 그대로예요.'
export const LEDGER_DELETED = '저장한 배송지를 지웠어요.'
const LINKED_PREFIX = '이 손님이 직접 이은 계정: '

function CustomerTags({ row, blocked }: { readonly row: Pick<CustomerRow, 'regular' | 'caution'>; readonly blocked?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs }}>
      {row.regular ? <Tag tone="success">{REGULAR_WORD}</Tag> : null}
      {row.caution ? <Tag tone="warning">{CAUTION_WORD}</Tag> : null}
      {blocked === true ? <Tag tone="danger">{BLOCKED_WORD}</Tag> : null}
    </View>
  )
}

export function CustomersScreen({ onBack }: { readonly onBack: () => void }) {
  const { p } = useKit()
  const [sort, setSort] = useState<CustomerSort>('total')
  const [filter, setFilter] = useState<CustomerFilter>('all')
  const [query, setQuery] = useState('')
  const [view, setView] = useState<CustomersView | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [open, setOpen] = useState<CustomerRow | null>(null)
  const [moreBusy, setMoreBusy] = useState(false)

  const path = (offset: number) => withQuery('/api/customers', { sort, filter, ...(query.trim() === '' ? {} : { q: query.trim() }), offset })
  useEffect(() => {
    let alive = true
    const timer = setTimeout(() => {
      get<CustomersView>(path(0)).then(
        (result) => {
          if (!alive) return
          setView(result)
          setError(null)
        },
        (caught: unknown) => {
          if (alive && isApiError(caught)) setError(caught)
        },
      )
    }, query === '' ? 0 : 300)
    return () => {
      alive = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- path는 sort·filter·query로만 정해진다
  }, [sort, filter, query, attempt])

  const loadMore = async () => {
    if (view === null || view.next === null) return
    setMoreBusy(true)
    try {
      const next = await get<CustomersView>(path(view.next))
      setView({ ...next, customers: [...view.customers, ...next.customers] })
    } catch (caught: unknown) {
      if (isApiError(caught)) setError(caught)
    } finally {
      setMoreBusy(false)
    }
  }

  if (open !== null) return <CustomerDetail row={open} today={view?.today ?? ''} onBack={() => setOpen(null)} />
  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="customers-screen">
      <AppHeader title="손님" onBack={onBack} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SPACE.md, paddingBottom: SPACE.xxxl, gap: SPACE.md }} keyboardShouldPersistTaps="handled">
        <TextField label="이름으로 찾기" value={query} onChangeText={setQuery} autoCorrect={false} />
        <View role="radiogroup" aria-label="정렬">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACE.sm, paddingVertical: SPACE.xs }}>
            {CUSTOMER_SORTS.map((key) => (
              <Pill key={key} on={sort === key} label={SORT_WORD[key]} ariaLabel={`정렬 ${SORT_WORD[key]}`} onPress={() => setSort(key)} />
            ))}
          </ScrollView>
        </View>
        <View role="radiogroup" aria-label="거르기">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACE.sm, paddingVertical: SPACE.xs }}>
            {CUSTOMER_FILTERS.map((key) => (
              <Pill key={key} on={filter === key} label={FILTER_WORD[key]} ariaLabel={`거르기 ${FILTER_WORD[key]}`} onPress={() => setFilter(key)} />
            ))}
          </ScrollView>
        </View>
        {error !== null ? (
          <View style={{ gap: SPACE.sm }}>
            <Notice tone="danger" alert>{error.message}</Notice>
            <BigButton kind="secondary" label={RETRY_NOW} onPress={() => setAttempt((n) => n + 1)} />
          </View>
        ) : null}
        {view === null && error === null ? <Loading /> : null}
        {view !== null ? <Txt color="textSub">{`손님 ${String(view.count)}명`}</Txt> : null}
        {view !== null && view.customers.length === 0 ? <Txt color="textSub">맞는 손님이 없어요.</Txt> : null}
        {view?.customers.map((row) => (
          <Pressable key={row.id} role="button" aria-label={`${row.name} · ${row.kindLabel}${row.regular ? ` · ${REGULAR_WORD}` : ''}${row.caution ? ` · ${CAUTION_WORD}` : ''}`} onPress={() => setOpen(row)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, backgroundColor: p.surface, borderRadius: RADIUS.lg, padding: SPACE.lg, opacity: pressed ? 0.6 : 1 })}>
            <View style={{ flex: 1, gap: SPACE.xs }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, flexWrap: 'wrap' }}>
                <Txt step="bodyLarge" weight="bold">{row.name}</Txt>
                <Txt step="caption" color="textSub">{row.kindLabel}</Txt>
              </View>
              <CustomerTags row={row} blocked={row.blocked} />
              <Txt step="caption" color="textSub">{hasNoPurchase(row) ? NO_PURCHASE : `누적 ${formatWon(row.purchaseTotal)} · ${String(row.purchaseDays)}번 · 마지막 ${customerDate(row.lastPurchase ?? '', view.today)}`}</Txt>
              {row.unpaidDays > 0 ? <Txt step="caption" color="textSub">{`미입금 ${String(row.unpaidDays)}번`}</Txt> : null}
            </View>
            <Icon name="chevron" color={p.textSub} size={20} />
          </Pressable>
        ))}
        {view !== null && view.more ? <BigButton kind="outline" label="더 보기" busy={moreBusy} onPress={() => void loadMore()} /> : null}
      </ScrollView>
    </View>
  )
}

function CustomerDetail({ row, today, onBack }: { readonly row: CustomerRow; readonly today: string; readonly onBack: () => void }) {
  const { p } = useKit()
  const [view, setView] = useState<(CustomerDetailView & { readonly ledger?: LedgerView | null }) | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    get<CustomerDetailView & { readonly ledger?: LedgerView | null }>(`/api/customers/${encodeURIComponent(row.id)}`).then(
      (result) => {
        if (!alive) return
        setView(result)
        setError(null)
      },
      (caught: unknown) => {
        if (alive && isApiError(caught)) setError(caught)
      },
    )
    return () => {
      alive = false
    }
  }, [row.id, attempt])
  const base = view?.today ?? today
  const shown = view?.customer ?? row
  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="customer-detail">
      <AppHeader title={shown.name} onBack={onBack} backLabel="손님 목록으로" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SPACE.md, paddingBottom: SPACE.xxxl, gap: SPACE.md }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, flexWrap: 'wrap' }}>
          <Txt color="textSub">{shown.kindLabel}</Txt>
          <CustomerTags row={shown} blocked={shown.blocked} />
        </View>
        {error !== null ? (
          <View style={{ gap: SPACE.sm }}>
            <Notice tone="danger" alert>{error.status === 404 ? '그 손님을 찾지 못했어요.' : error.message}</Notice>
            {error.status === 404 ? null : <BigButton kind="secondary" label={RETRY_NOW} onPress={() => setAttempt((n) => n + 1)} />}
          </View>
        ) : null}
        {view === null && error === null ? <Loading /> : null}
        {view !== null ? (
          <>
            <Card label="손님 기록">
              <Txt step="section" weight="bold">손님 기록</Txt>
              {summaryLines(view.customer, base).map((line) => (
                <Txt key={line}>{line}</Txt>
              ))}
              <MemoEditor customer={row.id} memo={view.memo} today={base} />
            </Card>
            <LedgerCard customer={row.id} ledger={view.ledger ?? null} today={base} onDeleted={() => setView({ ...view, ledger: null })} />
            <Card label="날짜별 기록">
              <Txt step="section" weight="bold">날짜별 기록</Txt>
              {view.days.map((line) => (
                <DayLine key={`${line.date}|${line.buyer}`} line={line} today={base} />
              ))}
            </Card>
            <Txt step="caption" color="textSub">{`차단은 가장 최근 날짜(${customerDate(shown.latestDate, base)})의 구매자 화면에서 할 수 있어요.`}</Txt>
          </>
        ) : null}
      </ScrollView>
    </View>
  )
}

function DayLine({ line, today }: { readonly line: CustomerDayLine; readonly today: string }) {
  return (
    <View style={{ gap: 2, paddingVertical: SPACE.xs }}>
      <Txt weight="bold">{customerDate(line.date, today)}</Txt>
      <Txt>{`그날 이름 ${line.name} · 상품 합계 ${formatWon(line.subtotal)}`}</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs }}>
        {dayLineTags(line).map((tag) => (
          <Tag key={tag.text} tone={tag.className.includes('caution') ? 'warning' : tag.className.includes('PAID') && !tag.className.includes('UNPAID') ? 'success' : 'info'}>
            {tag.text}
          </Tag>
        ))}
      </View>
      {line.openable === false ? <Txt step="caption" color="textSub">{DAY_LINE_SEALED}</Txt> : null}
    </View>
  )
}

/** 손님 메모 (BUY-07): 200자, 휴대폰 번호 모양은 서버가 막는다, 빈 글로 저장하면 한 번 묻는다(D-CRM1-16) */
function MemoEditor({ customer, memo: first, today }: { readonly customer: string; readonly memo: MemoView | null; readonly today: string }) {
  const [memo, setMemo] = useState(first)
  const [text, setText] = useState(first?.text ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const tooLong = codePoints(text.trim()) > MEMO_MAX
  const save = async () => {
    setAsking(false)
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const result = await put<{ memo: MemoView | null }>(`/api/customers/${customer}/memo`, { text })
      setMemo(result.memo)
      setText(result.memo?.text ?? '')
      setDone(result.memo === null ? MEMO_CLEARED : MEMO_SAVED)
    } catch (caught: unknown) {
      if (isApiError(caught)) setError(caught)
    } finally {
      setBusy(false)
    }
  }
  return (
    <View style={{ gap: SPACE.sm }}>
      <TextField label="메모" value={text} onChangeText={setText} multiline help={memo === null ? MEMO_HINT : `${memoSavedWords(memo.savedAt, today)} · ${MEMO_HINT}`} error={tooLong ? MEMO_TOO_LONG : (error?.problemFor('text')?.message ?? null)} />
      <BigButton kind="outline" label="메모 저장" busy={busy} disabled={tooLong || text.trim() === (memo?.text ?? '')} onPress={() => (text.trim() === '' && memo !== null ? setAsking(true) : void save())} />
      {done !== null ? <Notice tone="success">{done}</Notice> : null}
      {error !== null && error.problemFor('text') === undefined ? <Notice tone="danger" alert>{error.message}</Notice> : null}
      <ConfirmSheet visible={asking} question="메모를 지울까요?" confirmLabel="지우기" cancelLabel="그대로 두기" danger onConfirm={() => void save()} onCancel={() => { setAsking(false); setText(memo?.text ?? '') }} />
    </View>
  )
}

function LedgerCard({ customer, ledger, today, onDeleted }: { readonly customer: string; readonly ledger: LedgerView | null; readonly today: string; readonly onDeleted: () => void }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [done, setDone] = useState(false)
  const remove = async () => {
    if (ledger === null) return
    setBusy(true)
    setError(null)
    try {
      await post<{ ledger: null }>(`/api/customers/${encodeURIComponent(customer)}/ledger/delete`, { ledgerId: ledger.ledgerId })
      setAsking(false)
      setDone(true)
      onDeleted()
    } catch (caught: unknown) {
      if (!isApiError(caught)) throw caught
      setAsking(false)
      setError(caught)
      if (caught.status === 409) onDeleted()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card label={LEDGER_TITLE}>
      <Txt step="section" weight="bold">{LEDGER_TITLE}</Txt>
      {done ? <Notice tone="success">{LEDGER_DELETED}</Notice> : null}
      {ledger === null ? (
        done ? null : <Txt color="textSub">{LEDGER_NONE}</Txt>
      ) : (
        <>
          <Txt>{`받는 분 ${ledger.name}`}</Txt>
          <Txt>{`연락처 끝 ${ledger.phoneLast4}`}</Txt>
          <Txt>{`손님이 저장한 날 ${customerDate(ledger.consentDate, today)}`}</Txt>
          <Txt>{`보관 끝나는 날 ${customerDate(ledger.keepUntil, today)}`}</Txt>
          {ledger.linked.length > 0 ? <Txt>{`${LINKED_PREFIX}${ledger.linked.map((item) => `${item.label} · ${customerDate(kstDate(item.linkedAt), today)}`).join(', ')}`}</Txt> : null}
          <BigButton kind="outline" label={LEDGER_DELETE} disabled={busy} onPress={() => setAsking(true)} />
        </>
      )}
      {error !== null ? <Notice tone="danger" alert>{error.message}</Notice> : null}
      <ConfirmSheet visible={asking} question={LEDGER_DELETE} description={LEDGER_DELETE_ASK} confirmLabel="지우기" danger busy={busy} onConfirm={() => void remove()} onCancel={() => setAsking(false)} />
    </Card>
  )
}
