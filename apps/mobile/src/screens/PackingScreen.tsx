// 포장 (D-UX2-04, STL-08, D-I2-05·06 — 웹 PackingPage와 같은 규칙·문구): 위에 "포장"과 진행(끝낸 손님 / 전체), 날짜는 작게.
// 지금 손님 카드(초록 테두리): 이름·개수, 상품마다 큰 체크 줄(52 이상), 모두 담으면 "포장 끝". 아래는 나머지 손님 이름·개수.
// 포장 상태는 서버가 정한 다섯 말 그대로. 명령은 같은 요청 번호로 다시 보내도 한 번만 기록된다. 실시간 `packing` 알림이 오면 목록을 다시 받는다.
// 포장을 끝낸 손님 카드는 저절로 넘기지 않는다 — "포장 완료 되돌리기"를 바로 누를 수 있게 두고 "다음 손님"으로 넘긴다(실수 되돌리기).
// 토스식 다듬기 (D-UX3-94): 쪽 여백 20, 흰 카드에 묶기(지금 손님 카드의 초록 테두리·상품마다 회색 상자 없앰), 나머지 손님은 한 카드 안 줄로,
// 곁길 일([택배 접수]·[택배 화면으로]·[다음 손님])은 글자 단추, 단추 둘 이상은 좌우로(되돌리기 왼쪽).
import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import type { PackingAction, PackingEntry, PackingList, PackingResult } from '@livejjim/web/src/api/types.ts'
import { dateWords } from '@livejjim/web/src/lib/kst.ts'
import { PACKING_LOCKED_BOOKED, PACKING_LOCKED_WAITING, hidesPackingTag, isLive, packingTagWords } from '@livejjim/web/src/lib/parcel-words.ts'
import { get, isApiError, newRequestId, post, withRetry, type ApiError } from '../api/client.ts'
import { ALL_CHECKED_HINT, PACKED_NOTICE, PACKING_FILTERS, PACKING_TONE, SEALED_VIEW_ONLY, inFilter, isChanged, itemCount, itemLineWords, packItems, sortEntries, type PackingFilter } from '../lib/packing.ts'
import { useAppForeground } from '../lib/use-app-state.ts'
import { paymentWord, RETRY_NOW } from '../lib/words.ts'
import { useServices } from '../services.tsx'
import { parcelLine, parcelTone } from '@livejjim/web/src/lib/parcel-words.ts'
import { Pill } from '../ui/day-pills.tsx'
import { BigButton, ButtonRow, Icon, Txt, useKit, useTabBarRoom } from '../ui/kit/index.ts'
import { RADIUS, SPACE } from '../ui/kit/tokens.ts'
import { Field, Loading, Notice, Tag } from '../ui/parts.tsx'
import { ParcelTagLine, TextAction } from './ParcelAddress.tsx'

interface Day {
  readonly date: string
  readonly rehearsal: boolean
}

export function PackingScreen({ initialDate, openParcels, topGap = 28 }: { readonly initialDate?: string; readonly onBack?: () => void; readonly openParcels?: (date: string) => void; readonly topGap?: number }) {
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
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SPACE.xl, paddingTop: topGap, paddingBottom: SPACE.xxxl + room, gap: SPACE.md }} scrollIndicatorInsets={{ bottom: room }} keyboardShouldPersistTaps="handled">
        {error !== null ? <Notice tone="danger" alert>{error.message}</Notice> : null}
        {days === null && error === null ? <Loading /> : null}
        {days !== null ? (
          <View role="radiogroup" aria-label="날짜">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACE.sm, paddingVertical: SPACE.xs }}>
              {days.slice(0, 8).map((day) => (
                <Pill key={day.date} on={day.date === date} label={dateWords(day.date)} ariaLabel={`날짜 ${dateWords(day.date)}`} onPress={() => setDate(day.date)} />
              ))}
            </ScrollView>
            {days.length === 0 ? <Txt color="textSub">아직 판매 기록이 없어요.</Txt> : null}
          </View>
        ) : null}
        {/* 진행과 흐름의 다음 단계(D-UX3-39)를 한 줄에: 왼쪽 "끝낸 손님 n / N", 오른쪽 글자 단추 [택배 접수 ›] (D-UX3-94 — 옛: 오른쪽 굵은 진행 + 큰 회색 [택배 접수로]) */}
        {progress !== null || (openParcels !== undefined && date !== null) ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.md, minHeight: 36 }}>
            {progress !== null ? (
              <Txt step="body" weight="book" color="textSub" aria-label={`포장 끝낸 손님 ${String(progress.done)}명, 전체 ${String(progress.total)}명`}>
                {`끝낸 손님 ${String(progress.done)} / ${String(progress.total)}`}
              </Txt>
            ) : (
              <View />
            )}
            {openParcels !== undefined && date !== null ? <TextAction label="택배 접수" strong ariaLabel="택배 접수로 — 포장 끝난 손님 접수하기" onPress={() => openParcels(date)} /> : null}
          </View>
        ) : null}
        {date !== null ? <PackingDay key={date} date={date} onProgress={setProgress} openParcels={openParcels} /> : null}
      </ScrollView>
    </View>
  )
}

function PackingDay({ date, onProgress, openParcels }: { readonly date: string; readonly onProgress: (value: { done: number; total: number } | null) => void; readonly openParcels?: (date: string) => void }) {
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
    // 택배 접수·조회가 바뀌면 꼬리표·잠금이 바뀐다 (D-UX3-35)
    view.addEventListener('parcel', (event) => {
      try {
        const data = JSON.parse(event.data) as { date?: string; settings?: boolean }
        if (data.settings !== true && (data.date === undefined || data.date === date)) setVersion((n) => n + 1)
      } catch {
        // 버린다
      }
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
    <View style={{ gap: SPACE.md }}>
      {list.sealed === true ? <Notice tone="info">{SEALED_VIEW_ONLY}</Notice> : null}
      <View role="radiogroup" aria-label="걸러 보기">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACE.sm }}>
          {PACKING_FILTERS.map((item) => (
            <Pill key={item.key} on={item.key === filter} label={item.word} ariaLabel={`보기: ${item.word}`} onPress={() => {
              setFilter(item.key)
              setOpen(null)
            }} />
          ))}
        </ScrollView>
      </View>
      {current === undefined ? (
        <View style={{ paddingVertical: SPACE.xxxl, alignItems: 'center' }}>
          <Txt color="textSub" center>
            {filterWord?.empty ?? ''}
          </Txt>
        </View>
      ) : null}
      {current !== undefined ? (
        <PackingCard
          key={current.buyer}
          date={date}
          entry={current}
          sealed={list.sealed === true}
          openParcels={openParcels === undefined ? undefined : () => openParcels(date)}
          next={nextTodo === undefined ? undefined : () => setOpen(nextTodo.buyer)}
          onDone={(entry) => {
            setOpen(entry.buyer)
            setList((now) => (now === null ? now : { ...now, entries: now.entries.map((item) => (item.buyer === entry.buyer ? entry : item)) }))
          }}
        />
      ) : null}
      {/* 나머지 손님은 흰 카드 하나 안의 줄로 (D-UX3-94 — 옛: 손님마다 따로 떠 있는 흰 상자, 바뀐 손님은 노란 바탕) */}
      <View role="list" aria-label="포장할 구매자" style={rest.length === 0 ? undefined : { backgroundColor: p.surface, borderRadius: RADIUS.xl, borderCurve: 'continuous', paddingTop: SPACE.xs, paddingBottom: SPACE.sm }}>
        {rest.length === 0 ? null : (
          <View style={{ paddingHorizontal: SPACE.xl, paddingTop: SPACE.lg - 2, paddingBottom: SPACE.xs }}>
            <Txt step="body" weight="regular" color="textSub" role="heading" aria-level={2}>
              {`다른 손님 ${String(rest.length)}명`}
            </Txt>
          </View>
        )}
        {rest.map((entry) => {
          const changed = isChanged(entry.status)
          const tag = entry.status !== '포장 대기' && !hidesPackingTag(entry.status, entry.parcel) ? packingTagWords(entry.status, entry.invoice, entry.parcel) : null
          return (
            <Pressable key={entry.buyer} role="button" aria-label={`포장 열기 — ${entry.name}`} onPress={() => setOpen(entry.buyer)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, minHeight: 56, paddingVertical: SPACE.sm, paddingHorizontal: SPACE.xl - SPACE.sm, marginHorizontal: SPACE.sm, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt step="bodyLarge" weight="book" numberOfLines={1}>
                  {entry.name}
                </Txt>
                {tag !== null ? (
                  <Txt step="caption" weight={changed ? 'bold' : 'regular'} ink={changed ? p.warnText : p.textSub}>
                    {tag}
                  </Txt>
                ) : null}
                {entry.parcel != null ? <ParcelLine parcel={entry.parcel} /> : null}
              </View>
              <Txt step="body" color="textSub">{`${String(itemCount(entry.items))}개`}</Txt>
              <Icon name="chevron" color={p.textSub} size={18} />
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

/** 줄 안의 택배 상태 한 줄 (꼬리표 대신 색 글자 — 줄이 무거워지지 않게, D-UX3-94) */
function ParcelLine({ parcel }: { readonly parcel: NonNullable<PackingEntry['parcel']> }) {
  const { tones } = useKit()
  return (
    <Txt step="caption" weight="medium" ink={tones[parcelTone(parcel)].fg}>
      {parcelLine(parcel)}
    </Txt>
  )
}

function PackingCard({ date, entry, sealed, next, onDone, openParcels }: { readonly date: string; readonly entry: PackingEntry; readonly sealed: boolean; readonly next?: () => void; readonly onDone: (entry: PackingEntry) => void; readonly openParcels?: () => void }) {
  const { p } = useKit()
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  const [invoice, setInvoice] = useState(entry.invoice ?? '')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [pending, setPending] = useState<{ key: string; requestId: string } | null>(null)
  const allChecked = entry.items.length > 0 && entry.items.every((item) => checked.has(item.key))
  const changed = isChanged(entry.status)
  const canPack = entry.status === '포장 대기' || changed
  // 살아 있는 택배 접수가 있으면 포장·배송 기록을 바꾸지 못한다 (서버도 409 — PC-5, U-T1-07). 포장 끝은 그대로
  const parcelLocked = isLive(entry.parcel)

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
    // 지금 손님 카드 (D-UX3-94): 초록 테두리 없이 흰 카드, 이름은 제목 크기, 상품은 둥근 체크 줄
    <View role="group" aria-label={`지금 손님 — ${entry.name}`} style={{ backgroundColor: p.surface, borderRadius: RADIUS.xl, borderCurve: 'continuous', paddingHorizontal: SPACE.xl, paddingTop: SPACE.xl, paddingBottom: SPACE.lg, gap: SPACE.md }}>
      <View style={{ gap: SPACE.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: SPACE.md }}>
          <View style={{ flex: 1 }}>
            <Txt step="title" weight="heavy" role="heading" aria-level={2} numberOfLines={1}>
              {entry.name}
            </Txt>
          </View>
          <Txt step="bodyLarge" weight="book" color="textSub">{`${String(itemCount(entry.items))}개`}</Txt>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SPACE.sm }}>
          {hidesPackingTag(entry.status, entry.parcel) ? null : <Tag tone={PACKING_TONE[entry.status]}>{packingTagWords(entry.status, entry.invoice, entry.parcel)}</Tag>}
          <Txt step="caption" color="textSub">
            {`${paymentWord(entry.payment, 0)}${entry.phoneLast4 !== null ? ` · 뒤 4자리 ${entry.phoneLast4}` : ''}`}
          </Txt>
        </View>
        {entry.parcel != null ? <ParcelTagLine parcel={entry.parcel} /> : null}
      </View>
      {changed ? (
        <Notice tone="warning" alert>
          {`그 사이 구매 내역이 바뀌었어요.${entry.add.length > 0 ? ` 새로 담을 것: ${entry.add.map((item) => itemLineWords(item)).join(', ')}.` : ''}${entry.remove.length > 0 ? ` 뺄 것: ${entry.remove.map((item) => `${String(item.no)}번`).join(', ')}.` : ''}`}
        </Notice>
      ) : null}
      <View role="list" aria-label="체크리스트" style={{ marginHorizontal: -SPACE.sm }}>
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
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, minHeight: 52, paddingHorizontal: SPACE.sm, borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}
            >
              {/* 토스 체크처럼 둥근 표: 담으면 초록 바탕 ✓, 아니면 회색 테두리 */}
              <View aria-hidden style={{ width: 26, height: 26, borderRadius: 13, borderCurve: 'continuous', borderWidth: on ? 0 : 2, borderColor: p.softPressed, backgroundColor: on ? p.primary : p.surface, alignItems: 'center', justifyContent: 'center' }}>
                {on ? <Icon name="check" color={p.onPrimary} size={16} /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Txt step="bodyLarge" weight="book" ink={on ? p.textSub : p.text}>
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
        <View role="group" aria-label="포장·배송" style={{ gap: SPACE.md }}>
          {canPack ? <BigButton label="포장 끝" disabled={!allChecked || busy} onPress={() => void send({ action: 'pack', items: packItems(entry.items) })} /> : null}
          {entry.status === '포장 완료' && !parcelLocked ? (
            <>
              <Field label="송장번호 (선택)" value={invoice} onChangeText={setInvoice} inputMode="numeric" keyboardType="number-pad" />
              {/* 좌우로: 되돌리기(왼쪽) · 배송 완료(오른쪽) (D-UX4-01·D-UX3-94 — 옛: 큰 단추 둘을 위아래로) */}
              <ButtonRow>
                <BigButton kind="outline" label="되돌리기" ariaLabel="포장 완료 되돌리기" disabled={busy} onPress={() => void send({ action: 'unpack' })} />
                <BigButton kind="secondary" label="배송 완료" disabled={busy} onPress={() => void send({ action: 'ship', invoice: invoice.trim() === '' ? null : invoice.trim() })} />
              </ButtonRow>
            </>
          ) : null}
          {(entry.status === '배송 완료' || entry.status === '배송 뒤 바뀜') && !parcelLocked ? <BigButton kind="outline" label="배송 완료 되돌리기" disabled={busy} onPress={() => void send({ action: 'unship' })} /> : null}
        </View>
      ) : null}
      {parcelLocked && !sealed ? (
        <View style={{ gap: SPACE.xs }}>
          <Notice tone="info">{entry.parcel?.state === 'BOOKED' ? PACKING_LOCKED_BOOKED : PACKING_LOCKED_WAITING}</Notice>
          {openParcels !== undefined ? <TextAction label="택배 화면으로" onPress={openParcels} /> : null}
        </View>
      ) : null}
      {notice !== null ? (
        <Notice tone={notice.tone} alert={notice.tone === 'danger'}>
          {notice.text}
        </Notice>
      ) : null}
      {/* 다음 손님은 카드 아래 오른쪽 글자 단추 (홈 "모두보기"처럼, D-UX3-94 — 옛: 큰 초록 단추) */}
      {!canPack && next !== undefined ? <TextAction label="다음 손님" strong onPress={next} /> : null}
    </View>
  )
}
