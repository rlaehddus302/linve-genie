// 손님 (D-APPX-01 — 웹 "모든 손님"·손님 자세히와 같은 규칙·문구, BUY-06·BUY-07·BUY-08, CUSTOMER_RULES CR-3·CR-5).
// 목록: 정렬(누적 큰 순·최근 산 순·미입금 많은 순)·거르기(단골만·입금 늦음 주의만)·이름 찾기, 줄마다 단골·입금 늦음 주의·차단 꼬리표.
// 자세히: 손님 기록(누적·마지막 구매·미입금·취소), 메모(200자, 연락처 금지, 비우면 한 번 묻기), 저장한 배송지(가린 이름·끝 4자리, 지우기),
// 날짜별 기록(그날 이름·상품 합계·입금 상태). 판매자 사이에 손님 정보를 나누지 않는다(D-KP1-21).
import { useEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'
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
  type CustomerSummary,
  type CustomersView,
  type MemoView,
} from '@livejjim/web/src/lib/customers.ts'
import { kstDate } from '@livejjim/web/src/lib/kst.ts'
import { get, isApiError, post, put, withQuery, type ApiError } from '../api/client.ts'
import { useCachedGet } from '../lib/cached-get.ts'
import { formatWon, RETRY_NOW } from '../lib/words.ts'
import { Pill } from '../ui/day-pills.tsx'
import { AppHeader, ConfirmSheet, Icon, TextField, Txt, useKit, useTabBarRoom, Tap } from '../ui/kit/index.ts'
import { RADIUS, GUTTER, SPACE } from '../ui/kit/tokens.ts'
import { Loading, Notice } from '../ui/parts.tsx'
import { CardEmpty, InfoCard, InfoRow, Initial, listRowStyle, MiniTag, SearchField, TextButton, TextChoices } from './customer-parts.tsx'

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
  if (!row.regular && !row.caution && blocked !== true) return null
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs }}>
      {row.regular ? <MiniTag tone="success">{REGULAR_WORD}</MiniTag> : null}
      {row.caution ? <MiniTag tone="warning">{CAUTION_WORD}</MiniTag> : null}
      {blocked === true ? <MiniTag tone="danger">{BLOCKED_WORD}</MiniTag> : null}
    </View>
  )
}

/** 손님 한 줄 (토스 연락처처럼, D-UX3-95): 첫 글자 동그라미 · 이름(+종류·꼬리표) · 짧은 기록 한 줄 · › */
function CustomerLine({ row, today, onPress }: { readonly row: CustomerRow; readonly today: string; readonly onPress: () => void }) {
  const { p } = useKit()
  const summary = hasNoPurchase(row) ? NO_PURCHASE : `누적 ${formatWon(row.purchaseTotal)} · ${String(row.purchaseDays)}번 · 마지막 ${customerDate(row.lastPurchase ?? '', today)}`
  return (
    <Tap role="button" aria-label={`${row.name} · ${row.kindLabel}${row.regular ? ` · ${REGULAR_WORD}` : ''}${row.caution ? ` · ${CAUTION_WORD}` : ''}`} onPress={onPress} style={({ pressed }) => listRowStyle(p, pressed)}>
      <Initial name={row.name} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, flexWrap: 'wrap' }}>
          <Txt step="bodyLarge" weight="medium">{row.name}</Txt>
          <Txt step="caption" color="textSub">{row.kindLabel}</Txt>
          <CustomerTags row={row} blocked={row.blocked} />
        </View>
        {/* 기록은 한 줄로 — 미입금은 같은 줄 끝에 (옛: 줄 하나 더) */}
        <Txt step="caption" color="textSub">
          <Txt step="caption" color="textSub">{summary}</Txt>
          {row.unpaidDays > 0 ? <Txt step="caption" color="warnText">{` · 미입금 ${String(row.unpaidDays)}번`}</Txt> : null}
        </Txt>
      </View>
      <Icon name="chevron" color={p.textSub} size={18} />
    </Tap>
  )
}

/**
 * onBack이 없으면 아래 탭 "고객"(D-UX3-60) — 아래 여백은 탭 막대만큼.
 * openCustomer (D-UX4-58): 손님 자세히를 진짜 쌓인 화면으로 연다 — 없으면(시험·웹) 이 화면 안에서 바꿔 끼운다.
 */
export function CustomersScreen({ onBack, openCustomer }: { readonly onBack?: () => void; readonly openCustomer?: (id: string) => void }) {
  const { p } = useKit()
  const room = useTabBarRoom()
  const [sort, setSort] = useState<CustomerSort>('total')
  const [filter, setFilter] = useState<CustomerFilter>('all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<CustomerRow | null>(null)
  const [moreBusy, setMoreBusy] = useState(false)
  // 이름 찾기는 치기를 멈추고 0.3초 뒤에 묻는다 (비우면 바로)
  const [asked, setAsked] = useState(query)
  useEffect(() => {
    if (query === asked) return
    const timer = setTimeout(() => setAsked(query), query === '' ? 0 : 300)
    return () => clearTimeout(timer)
  }, [query, asked])

  const path = (offset: number) => withQuery('/api/customers', { sort, filter, ...(asked.trim() === '' ? {} : { q: asked.trim() }), offset })
  // 첫 쪽은 기억해 두고 다시 올 때 바로 보인 뒤 뒤에서 다시 받는다 (D-UX4-77). "더 보기"로 붙인 쪽은 이 화면에만 둔다 — 첫 쪽이 바뀌면 버린다
  const { data: firstData, error: firstError, reload } = useCachedGet<CustomersView>(path(0))
  // 정렬·거르기·찾기를 바꾸는 동안은 새 목록이 올 때까지 보이던 목록을 그대로 둔다 (불러오는 중으로 깜빡이지 않게)
  const lastFirst = useRef<CustomersView | null>(null)
  if (firstData !== null) lastFirst.current = firstData
  const first = firstData ?? lastFirst.current
  const [extra, setExtra] = useState<{ readonly base: CustomersView; readonly page: CustomersView } | null>(null)
  const [moreError, setMoreError] = useState<ApiError | null>(null)
  const view = useMemo(() => {
    if (first === null) return null
    if (extra === null || extra.base !== first) return first
    return { ...extra.page, customers: [...first.customers, ...extra.page.customers] }
  }, [first, extra])
  const error = firstError ?? moreError

  const loadMore = async () => {
    if (first === null || view === null || view.next === null) return
    setMoreBusy(true)
    try {
      const next = await get<CustomersView>(path(view.next))
      setExtra((old) => ({ base: first, page: { ...next, customers: [...(old !== null && old.base === first ? old.page.customers : []), ...next.customers] } }))
      setMoreError(null)
    } catch (caught: unknown) {
      if (isApiError(caught)) setMoreError(caught)
    } finally {
      setMoreBusy(false)
    }
  }

  if (open !== null) return <CustomerDetail id={open.id} row={open} today={view?.today ?? ''} onBack={() => setOpen(null)} />
  const narrowed = filter !== 'all' || query.trim() !== ''
  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="customers-screen">
      {/* 모든 화면과 같은 머리 줄 (D-UX4-59): 탭이면 왼쪽 큰 제목 "고객", 쌓인 화면이면 뒤로 + 가운데 "손님" */}
      {onBack !== undefined ? <AppHeader title="손님" onBack={onBack} /> : <AppHeader title="고객" />}
      {/* 홈처럼 (D-UX3-95): 옆 여백 20 · 카드 사이 16, 찾기 칸은 흰 둥근 칸, 정렬은 글자로만, 손님은 흰 카드 하나에 */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: GUTTER, paddingTop: SPACE.sm, paddingBottom: SPACE.xxxl + (onBack === undefined ? room : 0), gap: SPACE.md }} scrollIndicatorInsets={{ bottom: onBack === undefined ? room : 0 }} keyboardShouldPersistTaps="handled">
        <SearchField label="이름으로 찾기" value={query} onChangeText={setQuery} />
        <View role="radiogroup" aria-label="거르기" style={{ marginHorizontal: -GUTTER }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACE.sm, paddingHorizontal: GUTTER, paddingVertical: SPACE.xs }}>
            {CUSTOMER_FILTERS.map((key) => (
              <Pill key={key} on={filter === key} label={FILTER_WORD[key]} ariaLabel={`거르기 ${FILTER_WORD[key]}`} onPress={() => setFilter(key)} />
            ))}
          </ScrollView>
        </View>
        {error !== null ? (
          <View style={{ gap: SPACE.xs }}>
            <Notice tone="danger" alert>{error.message}</Notice>
            <TextButton
              label={RETRY_NOW}
              onPress={() => {
                setMoreError(null)
                void reload()
              }}
            />
          </View>
        ) : null}
        {view === null && error === null ? <Loading /> : null}
        {view !== null ? (
          <View style={{ gap: SPACE.xs }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', marginRight: -SPACE.sm }}>
              <Txt step="body" color="textSub">{`손님 ${String(view.count)}명`}</Txt>
              <TextChoices label="정렬" keys={CUSTOMER_SORTS} value={sort} word={(key) => SORT_WORD[key]} spoken={(key) => `정렬 ${SORT_WORD[key]}`} onPick={setSort} />
            </View>
            <View role="group" aria-label="손님 목록" style={{ backgroundColor: p.surface, borderRadius: RADIUS.xl, borderCurve: 'continuous', paddingVertical: SPACE.sm }}>
              {view.customers.length === 0 ? <CardEmpty>{narrowed ? '맞는 손님이 없어요.' : '아직 손님이 없어요.'}</CardEmpty> : null}
              {view.customers.map((row) => (
                <CustomerLine key={row.id} row={row} today={view.today} onPress={() => (openCustomer === undefined ? setOpen(row) : openCustomer(row.id))} />
              ))}
              {view.more ? <TextButton label="더 보기" color="textSub" busy={moreBusy} align="stretch" onPress={() => void loadMore()} /> : null}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  )
}

/** 손님 기록 줄 (D-CRM1-06 summaryLines와 같은 낱말 — 이름은 왼쪽, 값은 오른쪽으로 나눴다, D-UX3-95). 읽는 이름은 옛 한 줄 그대로 */
function summaryRows(summary: CustomerSummary, today: string): readonly { readonly label: string; readonly value: string; readonly spoken: string }[] {
  const lines = summaryLines(summary, today)
  const row = (label: string, value: string, spoken: string | undefined) => ({ label, value, spoken: spoken ?? `${label} ${value}` })
  return [
    row('누적 구매', `${formatWon(summary.purchaseTotal)} · ${String(summary.purchaseDays)}번`, lines[0]),
    row('마지막 구매', summary.lastPurchase === null ? '없음' : customerDate(summary.lastPurchase, today), lines[1]),
    row('미입금', summary.unpaidDays === 0 ? '없음' : `${String(summary.unpaidDays)}번${summary.lastUnpaid === null ? '' : ` · 마지막 ${customerDate(summary.lastUnpaid, today)}`}`, lines[2]),
    row('취소', `${String(summary.cancels)}번`, lines[3]),
  ]
}

/** 손님 자세히 진짜 쌓인 화면 (D-UX4-58): 손님 ID로 열고 서버에서 받는다 */
export function CustomerDetailScreen({ id, onBack }: { readonly id: string; readonly onBack: () => void }) {
  return <CustomerDetail id={id} today="" onBack={onBack} />
}

function CustomerDetail({ id, row, today, onBack }: { readonly id: string; readonly row?: CustomerRow; readonly today: string; readonly onBack: () => void }) {
  const { p } = useKit()
  // 기억해 둔 손님 자세히를 바로 보이고 뒤에서 다시 받는다 (D-UX4-77)
  const { data: view, error, reload, set: setView } = useCachedGet<CustomerDetailView & { readonly ledger?: LedgerView | null }>(`/api/customers/${encodeURIComponent(id)}`)
  const base = view?.today ?? today
  const shown = view?.customer ?? row
  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="customer-detail">
      <AppHeader title={shown?.name ?? ''} onBack={onBack} backLabel="손님 목록으로" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: GUTTER, paddingTop: SPACE.xs, paddingBottom: SPACE.xxxl, gap: SPACE.lg }} keyboardShouldPersistTaps="handled">
        {shown === undefined ? (error === null ? <Loading /> : null) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, flexWrap: 'wrap', paddingHorizontal: SPACE.xs }}>
            <Txt color="textSub">{shown.kindLabel}</Txt>
            <CustomerTags row={shown} blocked={shown.blocked} />
          </View>
        )}
        {error !== null ? (
          <View style={{ gap: SPACE.xs }}>
            <Notice tone="danger" alert>{error.status === 404 ? '그 손님을 찾지 못했어요.' : error.message}</Notice>
            {error.status === 404 ? null : <TextButton label={RETRY_NOW} onPress={() => void reload()} />}
          </View>
        ) : null}
        {view === null && error === null ? <Loading /> : null}
        {view !== null ? (
          <>
            <InfoCard title="손님 기록">
              {summaryRows(view.customer, base).map((line) => (
                <InfoRow key={line.label} label={line.label} value={line.value} spoken={line.spoken} />
              ))}
            </InfoCard>
            <InfoCard label="손님 메모">
              <MemoEditor customer={id} memo={view.memo} today={base} onSaved={(memo) => setView((now) => (now === null ? view : { ...now, memo }))} />
            </InfoCard>
            <LedgerCard customer={id} ledger={view.ledger ?? null} today={base} onDeleted={() => setView({ ...view, ledger: null })} />
            <InfoCard title="날짜별 기록">
              {view.days.length === 0 ? <Txt color="textSub">아직 기록이 없어요.</Txt> : null}
              {view.days.map((line) => (
                <DayLine key={`${line.date}|${line.buyer}`} line={line} today={base} />
              ))}
            </InfoCard>
            <Txt step="caption" color="textSub">{`차단은 가장 최근 날짜(${customerDate(view.customer.latestDate, base)})의 구매자 화면에서 할 수 있어요.`}</Txt>
          </>
        ) : null}
      </ScrollView>
    </View>
  )
}

/** 날짜 한 줄: 왼쪽 날짜와 그날 이름·합계, 오른쪽 입금 꼬리표 */
function DayLine({ line, today }: { readonly line: CustomerDayLine; readonly today: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingVertical: SPACE.sm }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt step="bodyLarge" weight="book">{customerDate(line.date, today)}</Txt>
        <Txt step="caption" color="textSub">{`그날 이름 ${line.name} · 상품 합계 ${formatWon(line.subtotal)}`}</Txt>
        {line.openable === false ? <Txt step="caption" color="textSub">{DAY_LINE_SEALED}</Txt> : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: SPACE.xs }}>
        {dayLineTags(line).map((tag) => (
          <MiniTag key={tag.text} tone={tag.className.includes('caution') ? 'warning' : tag.className.includes('PAID') && !tag.className.includes('UNPAID') ? 'success' : 'info'}>
            {tag.text}
          </MiniTag>
        ))}
      </View>
    </View>
  )
}

/** 손님 메모 (BUY-07): 200자, 휴대폰 번호 모양은 서버가 막는다, 빈 글로 저장하면 한 번 묻는다(D-CRM1-16) */
function MemoEditor({ customer, memo: first, today, onSaved }: { readonly customer: string; readonly memo: MemoView | null; readonly today: string; readonly onSaved?: (memo: MemoView | null) => void }) {
  const { p } = useKit()
  const [memo, setMemo] = useState(first)
  const [text, setText] = useState(first?.text ?? '')
  // 기억해 둔 자세히로 먼저 그린 뒤 뒤에서 받은 메모가 다르면 따라간다 — 판매자가 고치던 중이면 적던 글을 덮지 않는다 (D-UX4-77)
  const seen = useRef(first)
  useEffect(() => {
    const before = seen.current
    if ((before?.text ?? null) === (first?.text ?? null) && (before?.savedAt ?? null) === (first?.savedAt ?? null)) return
    seen.current = first
    setText((typed) => (typed === (before?.text ?? '') ? (first?.text ?? '') : typed))
    setMemo(first)
  }, [first])
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
      onSaved?.(result.memo)
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
      {error !== null && error.problemFor('text') === undefined ? <Notice tone="danger" alert>{error.message}</Notice> : null}
      {/* 저장됨은 상자 대신 단추 옆 초록 글 한 줄 (D-UX3-95) */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.sm, marginRight: -SPACE.md }}>
        <View role="status" style={{ flex: 1 }}>
          {done !== null ? <Txt step="caption" weight="medium" ink={p.primaryText}>{done}</Txt> : null}
        </View>
        <TextButton label="메모 저장" busy={busy} disabled={tooLong || text.trim() === (memo?.text ?? '')} onPress={() => (text.trim() === '' && memo !== null ? setAsking(true) : void save())} />
      </View>
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
    <InfoCard title={LEDGER_TITLE}>
      {done ? <Notice tone="success">{LEDGER_DELETED}</Notice> : null}
      {ledger === null ? (
        done ? null : <Txt color="textSub">{LEDGER_NONE}</Txt>
      ) : (
        <>
          <InfoRow label="받는 분" value={ledger.name} />
          <InfoRow label="연락처 끝" value={ledger.phoneLast4} />
          <InfoRow label="손님이 저장한 날" value={customerDate(ledger.consentDate, today)} />
          <InfoRow label="보관 끝나는 날" value={customerDate(ledger.keepUntil, today)} />
          {ledger.linked.length > 0 ? <Txt step="caption" color="textSub">{`${LINKED_PREFIX}${ledger.linked.map((item) => `${item.label} · ${customerDate(kstDate(item.linkedAt), today)}`).join(', ')}`}</Txt> : null}
          <View style={{ marginRight: -SPACE.md }}>
            <TextButton label={LEDGER_DELETE} color="dangerText" align="end" disabled={busy} onPress={() => setAsking(true)} />
          </View>
        </>
      )}
      {error !== null ? <Notice tone="danger" alert>{error.message}</Notice> : null}
      <ConfirmSheet visible={asking} question={LEDGER_DELETE} description={LEDGER_DELETE_ASK} confirmLabel="지우기" danger busy={busy} onConfirm={() => void remove()} onCancel={() => setAsking(false)} />
    </InfoCard>
  )
}
