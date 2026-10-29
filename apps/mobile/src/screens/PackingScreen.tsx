// 포장 모드 (STL-08, D-I2-05·06, 웹 PackingPage와 같은 규칙·문구): 날짜 고르기 → 걸러 보기 → 구매자 한 명씩 체크리스트 → 모두 담으면 "포장 완료".
// 포장 상태는 서버가 정한 다섯 말 그대로. 명령은 같은 요청 번호로 다시 보내도 한 번만 기록된다. 실시간 `packing` 알림이 오면 목록을 다시 받는다.
import { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import type { PackingAction, PackingEntry, PackingList, PackingResult } from '@livejjim/web/src/api/types.ts'
import { dateWords } from '@livejjim/web/src/lib/kst.ts'
import { get, isApiError, newRequestId, post, withRetry, type ApiError } from '../api/client.ts'
import { ALL_CHECKED_HINT, PACKED_NOTICE, PACKING_FILTERS, PACKING_TONE, SEALED_VIEW_ONLY, inFilter, itemCount, itemLineWords, packItems, packingWords, sortEntries, type PackingFilter } from '../lib/packing.ts'
import { useAppForeground } from '../lib/use-app-state.ts'
import { paymentWord, formatWon, RETRY_NOW } from '../lib/words.ts'
import { useServices } from '../services.tsx'
import { BigButton, Body, Card, Field, Hint, Loading, Notice, Row, Screen, SectionTitle, Stack, Tag } from '../ui/parts.tsx'

interface Day {
  readonly date: string
  readonly rehearsal: boolean
}

export function PackingScreen({ initialDate, onBack }: { readonly initialDate?: string; readonly onBack: () => void }) {
  const [days, setDays] = useState<Day[] | null>(null)
  const [date, setDate] = useState<string | null>(initialDate ?? null)
  const [error, setError] = useState<ApiError | null>(null)

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
    <Screen title="포장" testID="packing-screen">
      <BigButton small label="← 목록" ariaLabel="방송 목록으로" onPress={onBack} />
      {error !== null ? <Notice tone="danger" alert>{error.message}</Notice> : null}
      {days === null && error === null ? <Loading /> : null}
      {days !== null ? (
        <View role="radiogroup" aria-label="날짜" style={{ gap: 6 }}>
          <Row wrap>
            {days.slice(0, 8).map((day) => (
              <BigButton key={day.date} small primary={day.date === date} label={dateWords(day.date)} ariaLabel={`날짜 ${dateWords(day.date)}`} onPress={() => setDate(day.date)} />
            ))}
          </Row>
          {days.length === 0 ? <Body muted>아직 판매 기록이 없어요.</Body> : null}
        </View>
      ) : null}
      {date !== null ? <PackingDay key={date} date={date} /> : null}
    </Screen>
  )
}

function PackingDay({ date }: { readonly date: string }) {
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
  const shown = entries.filter((entry) => inFilter(entry, filter))
  const opened = open === null ? undefined : entries.find((entry) => entry.buyer === open)
  const filterWord = PACKING_FILTERS.find((item) => item.key === filter)

  if (error !== null)
    return (
      <Stack tight>
        <Notice tone="danger" alert>
          {error.message}
        </Notice>
        <BigButton label={RETRY_NOW} onPress={() => setVersion((n) => n + 1)} />
      </Stack>
    )
  if (list === null) return <Loading />
  if (opened !== undefined) return <PackingDetail date={date} entry={opened} sealed={list.sealed === true} onDone={(entry) => setList((current) => (current === null ? current : { ...current, entries: current.entries.map((item) => (item.buyer === entry.buyer ? entry : item)) }))} onBack={() => setOpen(null)} />

  return (
    <Stack>
      {list.sealed === true ? <Notice tone="info">{SEALED_VIEW_ONLY}</Notice> : null}
      <View role="radiogroup" aria-label="걸러 보기">
        <Row wrap>
          {PACKING_FILTERS.map((item) => (
            <BigButton key={item.key} small primary={item.key === filter} label={item.word} onPress={() => setFilter(item.key)} />
          ))}
        </Row>
      </View>
      {shown.length === 0 ? <Body muted>{filterWord?.empty ?? ''}</Body> : null}
      <View role="list" aria-label="포장할 구매자" style={{ gap: 8 }}>
        {shown.map((entry) => (
          <Row key={entry.buyer} wrap>
            <Tag tone={PACKING_TONE[entry.status]}>{packingWords(entry.status, entry.invoice)}</Tag>
            <BigButton small label={`${entry.name} · 상품 ${String(itemCount(entry.items))}개 · ${paymentWord(entry.payment, 0)}`} ariaLabel={`포장 열기 — ${entry.name}`} onPress={() => setOpen(entry.buyer)} />
          </Row>
        ))}
      </View>
    </Stack>
  )
}

function PackingDetail({ date, entry, sealed, onDone, onBack }: { readonly date: string; readonly entry: PackingEntry; readonly sealed: boolean; readonly onDone: (entry: PackingEntry) => void; readonly onBack: () => void }) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  const [invoice, setInvoice] = useState(entry.invoice ?? '')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [pending, setPending] = useState<{ key: string; requestId: string } | null>(null)
  const allChecked = entry.items.length > 0 && entry.items.every((item) => checked.has(item.key))
  const changed = entry.status === '포장 다시 확인' || entry.status === '배송 뒤 바뀜'

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
    <Stack>
      <BigButton small label="← 구매자 목록" onPress={onBack} />
      <SectionTitle>{entry.name}</SectionTitle>
      <Row wrap>
        <Tag tone={PACKING_TONE[entry.status]}>{packingWords(entry.status, entry.invoice)}</Tag>
        <Body muted>{paymentWord(entry.payment, 0)}</Body>
        {entry.phoneLast4 !== null ? <Body muted>{`뒤 4자리 ${entry.phoneLast4}`}</Body> : null}
      </Row>
      {changed ? (
        <Notice tone="warning" alert>
          {`그 사이 구매 내역이 바뀌었어요.${entry.add.length > 0 ? ` 새로 담을 것: ${entry.add.map((item) => itemLineWords(item)).join(', ')}.` : ''}${entry.remove.length > 0 ? ` 뺄 것: ${entry.remove.map((item) => `${String(item.no)}번`).join(', ')}.` : ''}`}
        </Notice>
      ) : null}
      <Card label="체크리스트">
        <Body bold>{`담을 상품 ${String(itemCount(entry.items))}개 · ${formatWon(entry.items.reduce((sum, item) => sum + item.price * (item.qty ?? 1), 0))}`}</Body>
        <View role="list" aria-label="체크리스트" style={{ gap: 6 }}>
          {entry.items.map((item) => {
            const on = checked.has(item.key)
            return (
              <BigButton
                key={item.key}
                small
                primary={on}
                label={`${on ? '담음 ' : ''}${itemLineWords(item)} · ${formatWon(item.price)}`}
                ariaLabel={`${on ? '담음 — ' : '담기 — '}${itemLineWords(item)}`}
                onPress={() =>
                  setChecked((current) => {
                    const next = new Set(current)
                    if (next.has(item.key)) next.delete(item.key)
                    else next.add(item.key)
                    return next
                  })
                }
              />
            )
          })}
        </View>
        {!allChecked ? <Hint>{ALL_CHECKED_HINT}</Hint> : null}
      </Card>
      {!sealed ? (
        <View role="group" aria-label="포장·배송" style={{ gap: 8 }}>
          <Row wrap>
            {entry.status === '포장 대기' || changed ? <BigButton label="포장 완료" primary disabled={!allChecked || busy} onPress={() => void send({ action: 'pack', items: packItems(entry.items) })} /> : null}
            {entry.status === '포장 완료' ? <BigButton label="포장 완료 되돌리기" disabled={busy} onPress={() => void send({ action: 'unpack' })} /> : null}
            {entry.status === '배송 완료' || entry.status === '배송 뒤 바뀜' ? <BigButton label="배송 완료 되돌리기" disabled={busy} onPress={() => void send({ action: 'unship' })} /> : null}
          </Row>
          {entry.status === '포장 완료' ? (
            <>
              <Field label="송장번호 (선택)" value={invoice} onChangeText={setInvoice} inputMode="numeric" keyboardType="number-pad" />
              <BigButton label="배송 완료" disabled={busy} onPress={() => void send({ action: 'ship', invoice: invoice.trim() === '' ? null : invoice.trim() })} />
            </>
          ) : null}
        </View>
      ) : null}
      {notice !== null ? (
        <Notice tone={notice.tone} alert={notice.tone === 'danger'}>
          {notice.text}
        </Notice>
      ) : null}
    </Stack>
  )
}
