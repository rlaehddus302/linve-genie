// 포장 (D-UX2-04, STL-08, D-I2-05·06 — 웹 PackingPage와 같은 규칙·문구): 위에 "포장"과 진행(끝낸 손님 / 전체), 날짜는 작게.
// 지금 손님 카드(초록 테두리): 이름·개수, 상품마다 큰 체크 줄(52 이상), 모두 담으면 "포장 끝". 아래는 나머지 손님 이름·개수.
// 포장 상태는 서버가 정한 다섯 말 그대로. 명령은 같은 요청 번호로 다시 보내도 한 번만 기록된다. 실시간 `packing` 알림이 오면 목록을 다시 받는다.
// 포장을 끝낸 손님 카드는 저절로 넘기지 않는다 — "포장 완료 되돌리기"를 바로 누를 수 있게 두고 "다음 손님"으로 넘긴다(실수 되돌리기).
import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import type { PackingAction, PackingEntry, PackingList, PackingResult } from '@livejjim/web/src/api/types.ts'
import { dateWords } from '@livejjim/web/src/lib/kst.ts'
import { get, isApiError, newRequestId, post, withRetry, type ApiError } from '../api/client.ts'
import { ALL_CHECKED_HINT, PACKED_NOTICE, PACKING_FILTERS, PACKING_TONE, SEALED_VIEW_ONLY, inFilter, isChanged, itemCount, itemLineWords, packItems, packingWords, sortEntries, type PackingFilter } from '../lib/packing.ts'
import { useAppForeground } from '../lib/use-app-state.ts'
import { paymentWord, RETRY_NOW } from '../lib/words.ts'
import { useServices } from '../services.tsx'
import { BigButton, Icon, Txt, useKit, useTabBarRoom } from '../ui/kit/index.ts'
import { RADIUS, SPACE, TOUCH, pressedFill } from '../ui/kit/tokens.ts'
import { Field, Loading, Notice, Tag } from '../ui/parts.tsx'

interface Day {
  readonly date: string
  readonly rehearsal: boolean
}

/** 작은 알약 고르기 (날짜·걸러 보기) */
function Pill({ on, label, ariaLabel, onPress }: { readonly on: boolean; readonly label: string; readonly ariaLabel: string; readonly onPress: () => void }) {
  const { p } = useKit()
  return (
    <Pressable role="button" aria-label={ariaLabel} aria-selected={on} onPress={onPress} style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: SPACE.lg, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center', borderWidth: on ? 0 : 1, borderColor: p.outline, backgroundColor: pressed ? pressedFill(p, on ? p.primary : p.surface) : on ? p.primary : p.surface })}>
      <Txt step="caption" weight="bold" color={on ? 'onPrimary' : 'text'}>
        {label}
      </Txt>
    </Pressable>
  )
}

export function PackingScreen({ initialDate }: { readonly initialDate?: string; readonly onBack?: () => void }) {
  const { p } = useKit()
  const room = useTabBarRoom()
  const [days, setDays] = useState<Day[] | null>(null)
  const [date, setDate] = useState<string | null>(initialDate ?? null)
  const [error, setError] = useState<ApiError | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  useEffect(() => {
    get<{ days: Day[] }>('/api/days').then(
      (view) => {
        const real = view.days.filter((day) => !day.rehearsal)
        setDays(real)
        setDate((current) => current ?? real[0]?.date ?? null)
      },
      (caught: unknown) => {
        if (isApiError(caught)) setError(caught)
      },
    )
  }, [])

  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="packing-screen">
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SPACE.md, paddingTop: 28, paddingBottom: SPACE.xxxl + room, gap: SPACE.sm }} scrollIndicatorInsets={{ bottom: room }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: SPACE.sm }}>
          <Txt step="headline" weight="heavy" role="heading" aria-level={1}>
            포장
          </Txt>
          {progress !== null ? (
            <Txt step="bodyLarge" weight="bold" color="textSub" aria-label={`포장 끝낸 손님 ${String(progress.done)}명, 전체 ${String(progress.total)}명`}>
              {`끝낸 손님 ${String(progress.done)} / ${String(progress.total)}`}
            </Txt>
          ) : null}
        </View>
        {error !== null ? <Notice tone="danger" alert>{error.message}</Notice> : null}
        {days === null && error === null ? <Loading /> : null}
        {days !== null ? (
          <View role="radiogroup" aria-label="날짜">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACE.sm, paddingHorizontal: SPACE.xs, paddingVertical: SPACE.xs }}>
              {days.slice(0, 8).map((day) => (
                <Pill key={day.date} on={day.date === date} label={dateWords(day.date)} ariaLabel={`날짜 ${dateWords(day.date)}`} onPress={() => setDate(day.date)} />
              ))}
            </ScrollView>
            {days.length === 0 ? <Txt color="textSub">아직 판매 기록이 없어요.</Txt> : null}
          </View>
        ) : null}
        {date !== null ? <PackingDay key={date} date={date} onProgress={setProgress} /> : null}
      </ScrollView>
    </View>
  )
}

function PackingDay({ date, onProgress }: { readonly date: string; readonly onProgress: (value: { done: number; total: number } | null) => void }) {
  const { p } = useKit()
  const { stream } = useServices()
  const [list, setList] = useState<PackingList | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [filter, setFilter] = useState<PackingFilter>('todo')
  const [open, setOpen] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let alive = true
    get<PackingList>(`/api/days/${date}/packing`).then(
      (view) => {
        if (!alive) return
        setList(view)
        setError(null)
      },
      (caught: unknown) => {
        if (alive && isApiError(caught)) setError(caught)
      },
    )
    return () => {
      alive = false
    }
  }, [date, version])

  // 포장 알림·범위 변경이 오면 다시 받는다 (AC-I2-32)
  useEffect(() => {
    const view = stream.open()
    let ready = 0
    view.addEventListener('ready', () => {
      ready++
      if (ready > 1) setVersion((n) => n + 1)
    })
    view.addEventListener('packing', (event) => {
      try {
        const data = JSON.parse(event.data) as { date?: string }
        if (data.date === date) setVersion((n) => n + 1)
      } catch {
        // 버린다
      }
    })
    view.addEventListener('change', (event) => {
      try {
        const data = JSON.parse(event.data) as { date?: string; rehearsal?: boolean }
        if (data.date === date && data.rehearsal !== true) setVersion((n) => n + 1)
      } catch {
        // 버린다
      }
    })
    return () => view.close()
  }, [stream, date])
  useAppForeground({ onForeground: () => setVersion((n) => n + 1) })

  const entries = useMemo(() => (list === null ? [] : sortEntries(list.entries)), [list])
  const done = entries.filter((entry) => !inFilter(entry, 'todo')).length
  useEffect(() => {
    onProgress(list === null ? null : { done, total: entries.length })
  }, [list, done, entries.length, onProgress])

  const shown = entries.filter((entry) => inFilter(entry, filter))
  // 지금 손님: 고른 손님(걸러 보기와 상관없이) → 없으면 보이는 첫 손님
  const current = (open === null ? undefined : entries.find((entry) => entry.buyer === open)) ?? shown[0]
  const rest = shown.filter((entry) => entry.buyer !== current?.buyer)
  const nextTodo = entries.find((entry) => inFilter(entry, 'todo') && entry.buyer !== current?.buyer)
  const filterWord = PACKING_FILTERS.find((item) => item.key === filter)

  if (error !== null)
    return (
      <View style={{ gap: SPACE.sm }}>
        <Notice tone="danger" alert>
          {error.message}
        </Notice>
        <BigButton kind="secondary" label={RETRY_NOW} onPress={() => setVersion((n) => n + 1)} />
      </View>
    )
  if (list === null) return <Loading />

  return (
    <View style={{ gap: 6 }}>
      {list.sealed === true ? <Notice tone="info">{SEALED_VIEW_ONLY}</Notice> : null}
      <View role="radiogroup" aria-label="걸러 보기">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACE.sm, paddingHorizontal: SPACE.xs, paddingBottom: SPACE.sm }}>
          {PACKING_FILTERS.map((item) => (
            <Pill key={item.key} on={item.key === filter} label={item.word} ariaLabel={`보기: ${item.word}`} onPress={() => {
              setFilter(item.key)
              setOpen(null)
            }} />
          ))}
        </ScrollView>
      </View>
      {current === undefined ? <Txt color="textSub">{filterWord?.empty ?? ''}</Txt> : null}
      {current !== undefined ? (
        <PackingCard
          key={current.buyer}
          date={date}
          entry={current}
          sealed={list.sealed === true}
          next={nextTodo === undefined ? undefined : () => setOpen(nextTodo.buyer)}
          onDone={(entry) => {
            setOpen(entry.buyer)
            setList((now) => (now === null ? now : { ...now, entries: now.entries.map((item) => (item.buyer === entry.buyer ? entry : item)) }))
          }}
        />
      ) : null}
      <View role="list" aria-label="포장할 구매자" style={{ gap: 6 }}>
        {rest.map((entry) => (
          <Pressable key={entry.buyer} role="button" aria-label={`포장 열기 — ${entry.name}`} onPress={() => setOpen(entry.buyer)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.md, minHeight: 56, paddingHorizontal: SPACE.xl, borderRadius: RADIUS.md, backgroundColor: pressed ? pressedFill(p, isChanged(entry.status) ? p.warnBg : p.surface) : isChanged(entry.status) ? p.warnBg : p.surface })}>
            <View style={{ flex: 1 }}>
              <Txt step="bodyLarge" weight="bold" numberOfLines={1}>
                {entry.name}
              </Txt>
              {entry.status !== '포장 대기' ? (
                <Txt step="caption" ink={isChanged(entry.status) ? p.warnText : p.textSub}>
                  {packingWords(entry.status, entry.invoice)}
                </Txt>
              ) : null}
            </View>
            <Txt color="textSub">{`${String(itemCount(entry.items))}개`}</Txt>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

function PackingCard({ date, entry, sealed, next, onDone }: { readonly date: string; readonly entry: PackingEntry; readonly sealed: boolean; readonly next?: () => void; readonly onDone: (entry: PackingEntry) => void }) {
  const { p } = useKit()
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  const [invoice, setInvoice] = useState(entry.invoice ?? '')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [pending, setPending] = useState<{ key: string; requestId: string } | null>(null)
  const allChecked = entry.items.length > 0 && entry.items.every((item) => checked.has(item.key))
  const changed = isChanged(entry.status)
  const canPack = entry.status === '포장 대기' || changed

  const send = async (body: { readonly action: PackingAction; readonly items?: readonly { readonly key: string; readonly qty: number }[]; readonly invoice?: string | null }) => {
    if (busy || sealed) return
    const key = JSON.stringify([entry.buyer, body])
    const requestId = pending?.key === key ? pending.requestId : newRequestId()
    setPending({ key, requestId })
    setBusy(true)
    setNotice(null)
    try {
      const result = await withRetry(() => post<PackingResult>(`/api/days/${date}/packing`, { requestId, buyer: entry.buyer, ...body }))
      setPending(null)
      onDone(result.entry)
      setNotice({ tone: 'success', text: body.action === 'pack' ? PACKED_NOTICE : body.action === 'ship' ? '배송 완료로 적었어요.' : '되돌렸어요.' })
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      const returned = caught.details.entry
      if (typeof returned === 'object' && returned !== null && 'buyer' in returned) onDone(returned as PackingEntry)
      if (!caught.transient) setPending(null)
      setNotice({ tone: 'danger', text: caught.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <View role="group" aria-label={`지금 손님 — ${entry.name}`} style={{ backgroundColor: p.surface, borderRadius: 18, padding: SPACE.lg, gap: SPACE.sm, borderWidth: 2, borderColor: p.primary }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: SPACE.xs }}>
        <Txt step="title" weight="heavy" role="heading" aria-level={2}>
          {entry.name}
        </Txt>
        <Txt color="textSub">{`${String(itemCount(entry.items))}개`}</Txt>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SPACE.sm, paddingHorizontal: SPACE.xs }}>
        <Tag tone={PACKING_TONE[entry.status]}>{packingWords(entry.status, entry.invoice)}</Tag>
        <Txt step="caption" color="textSub">
          {`${paymentWord(entry.payment, 0)}${entry.phoneLast4 !== null ? ` · 뒤 4자리 ${entry.phoneLast4}` : ''}`}
        </Txt>
      </View>
      {changed ? (
        <Notice tone="warning" alert>
          {`그 사이 구매 내역이 바뀌었어요.${entry.add.length > 0 ? ` 새로 담을 것: ${entry.add.map((item) => itemLineWords(item)).join(', ')}.` : ''}${entry.remove.length > 0 ? ` 뺄 것: ${entry.remove.map((item) => `${String(item.no)}번`).join(', ')}.` : ''}`}
        </Notice>
      ) : null}
      <View role="list" aria-label="체크리스트" style={{ gap: SPACE.sm }}>
        {entry.items.map((item) => {
          const on = checked.has(item.key)
          const line = itemLineWords(item)
          return (
            <Pressable
              key={item.key}
              role="button"
              aria-label={`${on ? '담음 — ' : '담기 — '}${line}`}
              disabled={!canPack || sealed}
              onPress={() =>
                setChecked((now) => {
                  const nextSet = new Set(now)
                  if (nextSet.has(item.key)) nextSet.delete(item.key)
                  else nextSet.add(item.key)
                  return nextSet
                })
              }
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, minHeight: TOUCH.min, paddingHorizontal: SPACE.md, borderRadius: RADIUS.sm, backgroundColor: pressed ? pressedFill(p, on ? p.freshBg : p.surfaceAlt) : on ? p.freshBg : p.surfaceAlt })}
            >
              <View aria-hidden style={{ width: 26, height: 26, borderRadius: 6, borderWidth: on ? 0 : 2, borderColor: p.borderStrong, backgroundColor: on ? p.primary : p.surface, alignItems: 'center', justifyContent: 'center' }}>
                {on ? <Icon name="check" color={p.onPrimary} size={18} /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Txt step="bodyLarge" weight="bold">
                  {line}
                </Txt>
              </View>
            </Pressable>
          )
        })}
      </View>
      {canPack && !allChecked ? (
        <Txt step="caption" color="textSub">
          {ALL_CHECKED_HINT}
        </Txt>
      ) : null}
      {!sealed ? (
        <View role="group" aria-label="포장·배송" style={{ gap: SPACE.sm, marginTop: SPACE.xs }}>
          {canPack ? <BigButton label="포장 끝" disabled={!allChecked || busy} onPress={() => void send({ action: 'pack', items: packItems(entry.items) })} /> : null}
          {entry.status === '포장 완료' ? (
            <>
              <Field label="송장번호 (선택)" value={invoice} onChangeText={setInvoice} inputMode="numeric" keyboardType="number-pad" />
              <BigButton kind="secondary" label="배송 완료" disabled={busy} onPress={() => void send({ action: 'ship', invoice: invoice.trim() === '' ? null : invoice.trim() })} />
              <BigButton kind="outline" label="포장 완료 되돌리기" disabled={busy} onPress={() => void send({ action: 'unpack' })} />
            </>
          ) : null}
          {entry.status === '배송 완료' || entry.status === '배송 뒤 바뀜' ? <BigButton kind="outline" label="배송 완료 되돌리기" disabled={busy} onPress={() => void send({ action: 'unship' })} /> : null}
        </View>
      ) : null}
      {notice !== null ? (
        <Notice tone={notice.tone} alert={notice.tone === 'danger'}>
          {notice.text}
        </Notice>
      ) : null}
      {!canPack && next !== undefined ? <BigButton label="다음 손님" onPress={next} /> : null}
    </View>
  )
}
