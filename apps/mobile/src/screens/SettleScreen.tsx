// 정산 탭 (D-APPX-01 — 웹 SettlementsPage와 같은 규칙·문구, 앱 화면으로 옮김. 전에는 웹으로 열기 안내만 있었다 D-UX2-07).
// 날짜 고르기 → 손님 목록(덜 받은 손님 먼저, 걸러 보기) → 손님 자세히(품목·금액·기록) → 입금 적기·배송비 바꾸기·할인·추가·환불 적기.
// 금액은 서버(엔진)가 정한 정수 원 그대로 보인다. 쓰기는 웹과 같은 `/api/events`에 같은 요청 번호로(다시 보내도 한 번만 기록).
// 입금 금액이 남은 금액과 다르면 한 번 더 묻는다(오타 방지 — AC-S06-30). 30일 지난 날짜(봉인)는 보기만 한다.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import type { PackingList, ReceiptBuyers, Settlement, WriteResult } from '@livejjim/web/src/api/types.ts'
import type { ParcelBrief, ParcelDay } from '@livejjim/web/src/api/parcel-types.ts'
import { parcelLine } from '@livejjim/web/src/lib/parcel-words.ts'
import { dateWords, kstShort } from '@livejjim/web/src/lib/kst.ts'
import { get, isApiError, newRequestId, post, withQuery, withRetry, type ApiError } from '../api/client.ts'
import { BuyerNames } from '../lib/derive.ts'
import { useParcelVersion } from '../lib/parcel-version.ts'
import type { ScopeData } from '../lib/scope-data.ts'
import {
  ADJUST_RANGE,
  ADJUST_REASONS,
  INPUT_TITLE,
  NOT_APPLIED_SETTLEMENT,
  PAYMENT_DATE_NOTE,
  PAYMENT_RANGE,
  PHONE_IN_TEXT,
  REFUND_NOTE,
  REFUND_REASONS,
  SEALED_SETTLEMENT,
  SHIPPING_CHOICES,
  SHIPPING_RANGE,
  SHIPPING_WORD,
  detailLineWords,
  looksLikePhone,
  primaryInput,
  readAmount,
  recordKindWord,
  refundRange,
  remainingOf,
  signedWon,
  sortForSeller,
  storedMemoWords,
  summaryWords,
  type InputKind,
  type PaymentFilter,
  type ShippingChoice,
} from '../lib/settle.ts'
import { formatWon, PAYMENT_WORD, paymentWord, RETRY_NOW } from '../lib/words.ts'
import { DayPills, Pill, useRealDays } from '../ui/day-pills.tsx'
import { useDayScope } from '../lib/day-scope.ts'
import { BigButton, BottomSheet, Card, ConfirmSheet, Icon, TextField, Txt, useKit, useTabBarRoom } from '../ui/kit/index.ts'
import { RADIUS, SPACE, pressedFill } from '../ui/kit/tokens.ts'
import { Loading, Notice, Tag } from '../ui/parts.tsx'
import { AddressCard, ParcelTag } from './ParcelAddress.tsx'
import { BuyerInfoBanner } from './BuyerInfoScreen.tsx'

const FILTERS: readonly { readonly key: PaymentFilter; readonly word: string }[] = [
  { key: 'ALL', word: '전체' },
  { key: 'UNPAID', word: PAYMENT_WORD.UNPAID },
  { key: 'PARTIAL', word: PAYMENT_WORD.PARTIAL },
  { key: 'PAID', word: PAYMENT_WORD.PAID },
  { key: 'OVERPAID', word: PAYMENT_WORD.OVERPAID },
]

const PAY_TONE = { UNPAID: 'danger', PARTIAL: 'warning', PAID: 'success', OVERPAID: 'warning' } as const

export interface SettleNavigation {
  /** 그 날짜의 방송 리포트 */
  readonly openReport?: (date: string) => void
  /** 입금 확인 화면 */
  readonly openDeposits?: () => void
  /** 손님 정보 문자 화면 (ORD-14) */
  readonly openBuyerInfo?: () => void
  /** 확인서 보내기 화면 (D-UX3-39) */
  readonly openReceipts?: () => void
}

/** 손님마다 방송 뒤 단계 (D-UX3-39): 배송지를 받았는지(택배 화면 줄의 배송지 상태), 확인서를 보냈는지(링크 또는 문자) */
export interface OrderSteps {
  readonly info: boolean
  readonly receipt: boolean
}

export function orderStepsOf(parcels: ParcelDay | null, receipts: ReceiptBuyers | null): ReadonlyMap<string, OrderSteps> {
  const out = new Map<string, OrderSteps>()
  if (parcels === null || receipts === null) return out
  const addressOf = new Map([...parcels.ready, ...parcels.excluded, ...parcels.booked].map((row) => [row.buyer, row] as const))
  for (const row of receipts.buyers) {
    const parcel = addressOf.get(row.buyer)
    if (parcel === undefined || parcel.shipping === 'PICKUP' || parcel.shipping === 'COMBINED') continue
    out.set(row.buyer, { info: parcel.address !== 'NONE', receipt: (row.link !== null && row.link.status !== 'NONE') || (row.sms != null && row.sms.sentAt !== null) })
  }
  return out
}

export function SettleScreen({ initialDate, initialBuyer, nav = {} }: { readonly initialDate?: string; readonly initialBuyer?: string; readonly nav?: SettleNavigation }) {
  const { p } = useKit()
  const room = useTabBarRoom()
  const { days, date, setDate, error } = useRealDays(initialDate)
  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="settle-screen">
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SPACE.md, paddingTop: 28, paddingBottom: SPACE.xxxl + room, gap: SPACE.sm }} scrollIndicatorInsets={{ bottom: room }} keyboardShouldPersistTaps="handled">
        <View style={{ paddingHorizontal: SPACE.sm }}>
          <Txt step="headline" weight="heavy" role="heading" aria-level={1}>
            주문
          </Txt>
          <Txt step="caption" color="textSub">손님마다 정리 → 정보 받기 → 확인서 보내기 → 입금 확인</Txt>
        </View>
        {nav.openBuyerInfo !== undefined ? <BuyerInfoBanner onOpen={nav.openBuyerInfo} /> : null}
        {error !== null ? <Notice tone="danger" alert>{error.message}</Notice> : null}
        {days === null && error === null ? <Loading /> : null}
        {days !== null ? <DayPills days={days} date={date} onPick={setDate} /> : null}
        {date !== null ? <SettleDay key={date} date={date} nav={nav} initialBuyer={date === initialDate ? initialBuyer : undefined} /> : null}
      </ScrollView>
    </View>
  )
}

function SettleDay({ date, nav, initialBuyer }: { readonly date: string; readonly nav: SettleNavigation; readonly initialBuyer?: string }) {
  const { data, error, reload } = useDayScope(date)
  const [filter, setFilter] = useState<PaymentFilter>('ALL')
  // 택배 화면 [배송지 보기]로 오면 그 손님 자세히부터 (D-UX3-35)
  const [open, setOpen] = useState<string | null>(initialBuyer === undefined ? null : JSON.stringify([initialBuyer, date]))
  const [parcelVersion] = useParcelVersion(date)
  const parcels = useParcelMarks(date, parcelVersion)
  const steps = useOrderSteps(date, parcelVersion)
  const names = useMemo(() => (data === null ? null : new BuyerNames(data.buyers, data.claims)), [data])
  if (error !== null && data === null) {
    return (
      <View style={{ gap: SPACE.sm }}>
        <Notice tone="danger" alert>{error.message}</Notice>
        <BigButton label={RETRY_NOW} kind="secondary" onPress={reload} />
      </View>
    )
  }
  if (data === null || names === null) return <Loading />
  const all = sortForSeller([...data.settlements.values()].filter((s) => s.items.length > 0 || s.records.length > 0))
  const settlement = open === null ? undefined : data.settlements.get(open)
  if (settlement !== undefined) return <SettleDetail data={data} names={names} settlement={settlement} parcelVersion={parcelVersion} onBack={() => setOpen(null)} onWritten={reload} />
  const shown = filter === 'ALL' ? all : all.filter((s) => s.payment === filter)
  return (
    <View style={{ gap: SPACE.md }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm, paddingHorizontal: SPACE.xs }}>
        {nav.openReport !== undefined ? <BigButton kind="outline" label="방송 리포트" onPress={() => nav.openReport?.(date)} /> : null}
        {nav.openReceipts !== undefined ? <BigButton kind="outline" label="확인서 보내기" onPress={() => nav.openReceipts?.()} /> : null}
        {nav.openDeposits !== undefined ? <BigButton kind="outline" label="입금 확인" onPress={() => nav.openDeposits?.()} /> : null}
      </View>
      {data.sealed ? <Notice tone="info">{SEALED_SETTLEMENT}</Notice> : null}
      <Txt weight="bold" color="textSub">{summaryWords(all)}</Txt>
      <View role="radiogroup" aria-label="입금 상태로 보기">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACE.sm, paddingHorizontal: SPACE.xs, paddingVertical: SPACE.xs }}>
          {FILTERS.map((item) => {
            const count = item.key === 'ALL' ? all.length : all.filter((s) => s.payment === item.key).length
            return <Pill key={item.key} on={filter === item.key} label={`${item.word} ${String(count)}`} ariaLabel={`${item.word} ${String(count)}명`} onPress={() => setFilter(item.key)} />
          })}
        </ScrollView>
      </View>
      {shown.length === 0 ? <Txt color="textSub">{all.length === 0 ? '이 날짜에 정산할 손님이 없어요.' : '이 상태의 손님이 없어요.'}</Txt> : null}
      {shown.map((s) => (
        <SettleRow key={`${s.buyer}/${s.date}`} settlement={s} name={names.name(s.buyer)} parcel={parcels.get(s.buyer) ?? null} steps={steps.get(s.buyer) ?? null} onPress={() => setOpen(JSON.stringify([s.buyer, s.date]))} />
      ))}
    </View>
  )
}

/** 손님마다 택배 시도 (포장 목록에 실려 온다 — 웹 정산 줄과 같은 출처, AC-T1-65). 못 받으면 꼬리표 없이 */
function useParcelMarks(date: string, version: number): ReadonlyMap<string, ParcelBrief> {
  const [marks, setMarks] = useState<ReadonlyMap<string, ParcelBrief>>(new Map())
  useEffect(() => {
    let alive = true
    get<PackingList>(`/api/days/${date}/packing`).then(
      (list) => {
        if (!alive) return
        const next = new Map<string, ParcelBrief>()
        for (const entry of list.entries) if (entry.parcel != null) next.set(entry.buyer, entry.parcel)
        setMarks(next)
      },
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [date, version])
  return marks
}

/** 손님마다 단계 (D-UX3-39) — 택배 줄·영수증 줄을 받으면 그때 채운다 (못 받으면 꼬리표 없이) */
function useOrderSteps(date: string, version: number): ReadonlyMap<string, OrderSteps> {
  const [steps, setSteps] = useState<ReadonlyMap<string, OrderSteps>>(new Map())
  useEffect(() => {
    let alive = true
    Promise.all([get<ParcelDay>(`/api/parcels/days/${date}`).catch(() => null), get<ReceiptBuyers>(`/api/days/${date}/receipt-buyers`).catch(() => null)]).then(([parcels, receipts]) => {
      if (alive) setSteps(orderStepsOf(parcels, receipts))
    })
    return () => {
      alive = false
    }
  }, [date, version])
  return steps
}

function SettleRow({ settlement, name, parcel, steps, onPress }: { readonly settlement: Settlement; readonly name: string; readonly parcel: ParcelBrief | null; readonly steps: OrderSteps | null; readonly onPress: () => void }) {
  const { p } = useKit()
  const left = remainingOf(settlement)
  const word = paymentWord(settlement.payment, settlement.refundDue)
  return (
    <Pressable role="button" aria-label={`${name} · ${word} · 최종 ${formatWon(settlement.total)}${left > 0 ? ` · 남은 금액 ${formatWon(left)}` : ''}${parcel !== null ? ` · ${parcelLine(parcel)}` : ''}`} onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, borderRadius: RADIUS.lg, borderCurve: 'continuous', paddingVertical: SPACE.lg, paddingHorizontal: SPACE.lg, backgroundColor: pressed ? pressedFill(p, p.surface) : p.surface })}>
      <View style={{ flex: 1, gap: SPACE.xs }}>
        <Txt step="bodyLarge" weight="bold">{name}</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs }}>
          {steps !== null ? <Tag tone={steps.info ? 'success' : 'warning'}>{steps.info ? '정보 받음' : '정보 전'}</Tag> : null}
          {steps !== null ? <Tag tone={steps.receipt ? 'success' : 'warning'}>{steps.receipt ? '확인서 보냄' : '확인서 전'}</Tag> : null}
          <Tag tone={PAY_TONE[settlement.payment]}>{word}</Tag>
        </View>
        {parcel !== null ? <ParcelTag parcel={parcel} /> : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Txt weight="heavy">{formatWon(settlement.total)}</Txt>
        {left > 0 ? <Txt step="caption" color="textSub">{`남은 ${formatWon(left)}`}</Txt> : null}
      </View>
      <Icon name="chevron" color={p.textSub} size={20} />
    </Pressable>
  )
}

interface Saved {
  readonly text: string
  readonly tone: 'success' | 'warning'
}

function SettleDetail({ data, names, settlement, parcelVersion, onBack, onWritten }: { readonly data: ScopeData; readonly names: BuyerNames; readonly settlement: Settlement; readonly parcelVersion: number; readonly onBack: () => void; readonly onWritten: () => void }) {
  const [input, setInput] = useState<InputKind | null>(null)
  const [saved, setSaved] = useState<Saved | null>(null)
  const claims = useMemo(() => [...data.claims.values()].filter((c) => c.currentBuyer === settlement.buyer && c.status === 'CONFIRMED').sort((a, b) => a.seq - b.seq), [data.claims, settlement.buyer])
  const name = names.name(settlement.buyer)
  const remaining = remainingOf(settlement)
  const empty = settlement.items.length === 0
  const primary = primaryInput(settlement.payment)
  const buyer = data.buyers.get(settlement.buyer)
  const done = (result: WriteResult, text: string) => {
    setInput(null)
    setSaved(result.changed ? { text, tone: 'success' } : { text: NOT_APPLIED_SETTLEMENT, tone: 'warning' })
    onWritten()
  }
  return (
    <View style={{ gap: SPACE.md }} aria-label="정산 자세히">
      <BigButton kind="secondary" label="정산 목록으로" onPress={onBack} />
      <Txt step="title" weight="heavy" role="heading" aria-level={2}>
        {name}
      </Txt>
      {buyer !== undefined && buyer.merged.length > 0 ? <Txt color="textSub">합친 구매자: {buyer.merged.map((id) => names.name(id)).join(', ')}</Txt> : null}
      <Tag tone={PAY_TONE[settlement.payment]} big>{paymentWord(settlement.payment, settlement.refundDue)}</Tag>
      {saved !== null ? <Notice tone={saved.tone}>{saved.text}</Notice> : null}

      <Card label="품목">
        <Txt step="section" weight="bold">품목</Txt>
        {empty ? <Txt>취소되어 품목이 없어요</Txt> : null}
        {claims.map((claim) => (
          <Txt key={claim.id}>
            {detailLineWords(claim, data.products.get(claim.product)?.name)}
            {claim.buyer !== settlement.buyer ? ` · ${names.name(claim.buyer)}` : ''}
          </Txt>
        ))}
      </Card>

      <Card label="금액">
        <Line label="상품 합계" value={formatWon(settlement.subtotal)} />
        <Line label={`배송비${settlement.shippingOverride !== null ? ` (${SHIPPING_WORD[settlement.shippingOverride]})` : ''}`} value={formatWon(settlement.shipping)} />
        <Line label="할인·추가" value={signedWon(empty ? 0 : settlement.adjustments)} />
        <Line label="최종" value={formatWon(settlement.total)} strong />
        <Line label="받은 금액" value={formatWon(settlement.received)} />
        <Line label="남은 금액" value={formatWon(remaining)} strong={remaining > 0} />
        {settlement.refundDue > 0 ? <Line label="돌려줄 돈" value={formatWon(settlement.refundDue)} strong /> : null}
      </Card>

      {data.sealed ? (
        <Notice tone="info">{SEALED_SETTLEMENT}</Notice>
      ) : (
        <View style={{ gap: SPACE.sm }} role="group" aria-label="정산 입력">
          {(['payment', 'shipping', 'adjust', 'refund'] as const).map((kind) => (
            <BigButton key={kind} kind={kind === primary ? 'primary' : 'outline'} label={INPUT_TITLE[kind]} onPress={() => { setSaved(null); setInput(kind) }} />
          ))}
        </View>
      )}

      <AddressCard date={settlement.date} buyer={settlement.buyer} sealed={data.sealed} version={parcelVersion} />

      <Card label="정산 기록">
        <Txt step="section" weight="bold">기록</Txt>
        {settlement.records.length === 0 ? <Txt color="textSub">아직 기록이 없어요.</Txt> : null}
        {settlement.records.map((record) => (
          <Txt key={record.seq}>
            <Txt weight="bold">{recordKindWord(record.kind, record.amount)}</Txt>{' '}
            {record.kind === 'shipping'
              ? `${SHIPPING_WORD[(record.mode ?? 'DEFAULT') as ShippingChoice]}${record.mode === 'FIXED' && record.amount !== null ? ` ${formatWon(record.amount)}` : ''}`
              : record.amount === null
                ? ''
                : formatWon(Math.abs(record.amount))}
            {record.reason !== null ? ` · ${storedMemoWords(record.reason)}` : ''}
            {record.memo !== null ? ` · ${storedMemoWords(record.memo)}` : ''}
            {` · 기록한 때 ${kstShort(record.at)}`}
            {record.buyer !== settlement.buyer ? ` · ${names.name(record.buyer)}` : ''}
          </Txt>
        ))}
      </Card>

      {input !== null ? <InputSheet kind={input} name={name} settlement={settlement} remaining={remaining} onClose={() => setInput(null)} onDone={done} /> : null}
    </View>
  )
}

function Line({ label, value, strong }: { readonly label: string; readonly value: string; readonly strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: SPACE.sm }} aria-label={`${label} ${value}`}>
      <Txt weight={strong === true ? 'bold' : 'regular'}>{label}</Txt>
      <Txt weight={strong === true ? 'heavy' : 'bold'}>{value}</Txt>
    </View>
  )
}

/** 쓰기 한 번: 같은 요청 번호로 다시 보내도 한 번만 기록된다 */
function useSend(settlement: Settlement) {
  const requestId = useRef(newRequestId())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const send = async (event: Record<string, unknown>): Promise<WriteResult | null> => {
    setBusy(true)
    setError(null)
    try {
      return await withRetry(() => post<WriteResult>(withQuery('/api/events', { date: settlement.date, rehearsal: false }), { requestId: requestId.current, ...event }))
    } catch (caught: unknown) {
      if (isApiError(caught)) setError(caught)
      return null
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, send }
}

function InputSheet({ kind, name, settlement, remaining, onClose, onDone }: { readonly kind: InputKind; readonly name: string; readonly settlement: Settlement; readonly remaining: number; readonly onClose: () => void; readonly onDone: (result: WriteResult, text: string) => void }) {
  const { busy, error, send } = useSend(settlement)
  const [amount, setAmount] = useState(kind === 'payment' && remaining > 0 ? String(remaining) : kind === 'refund' && settlement.refundDue > 0 ? String(settlement.refundDue) : '')
  const [text, setText] = useState('')
  const [mode, setMode] = useState<ShippingChoice | null>(null)
  const [sign, setSign] = useState<'minus' | 'plus'>('minus')
  const [problem, setProblem] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<number | null>(null)

  const range = kind === 'payment' ? PAYMENT_RANGE : kind === 'shipping' ? SHIPPING_RANGE : kind === 'adjust' ? ADJUST_RANGE : refundRange(settlement.received)
  const needsAmount = kind !== 'shipping' || mode === 'FIXED'
  const base = { buyer: settlement.buyer, date: settlement.date }

  const write = async (value: number | null) => {
    const note = text.trim()
    let result: WriteResult | null = null
    if (kind === 'payment') result = await send({ type: 'settlement.payment', ...base, amountText: String(value), ...(note === '' ? {} : { memo: note }) })
    if (kind === 'shipping' && mode !== null) result = await send({ type: 'settlement.shippingOverride', ...base, mode, ...(mode === 'FIXED' ? { amountText: String(value) } : {}) })
    if (kind === 'adjust') result = await send({ type: 'settlement.adjust', ...base, amountText: String(value), amountSign: sign === 'minus' ? 'MINUS' : 'PLUS', reason: note })
    if (kind === 'refund') result = await send({ type: 'settlement.refund', ...base, amountText: String(value), reason: note })
    if (result === null) return
    const words =
      kind === 'payment' ? `입금 ${formatWon(value ?? 0)}을 적었어요.` : kind === 'shipping' ? `배송비를 '${SHIPPING_WORD[mode ?? 'DEFAULT']}'로 바꿨어요.` : kind === 'adjust' ? `${sign === 'minus' ? '할인' : '추가'} ${formatWon(value ?? 0)}을 적었어요.` : `환불 ${formatWon(value ?? 0)}을 적었어요.`
    onDone(result, words)
  }

  const submit = () => {
    setProblem(null)
    if (kind === 'shipping' && mode === null) return setProblem('배송비를 골라 주세요.')
    let value: number | null = null
    if (needsAmount) {
      const read = readAmount(amount, range)
      if (!read.ok) return setProblem(read.message)
      value = read.amount
    }
    const note = text.trim()
    if (looksLikePhone(note)) return setProblem(PHONE_IN_TEXT)
    if ((kind === 'adjust' || kind === 'refund') && note === '') return setProblem('사유를 적어 주세요.')
    if (kind === 'payment' && value !== null && value !== remaining) return setConfirming(value)
    void write(value)
  }

  if (confirming !== null) {
    return (
      <ConfirmSheet
        visible
        question="입금 금액 확인"
        description={`남은 금액(${formatWon(remaining)})과 달라요. ${formatWon(confirming)}으로 적을까요?${error !== null ? `\n${error.message}` : ''}`}
        confirmLabel={`${formatWon(confirming)} 적기`}
        cancelLabel="다시 고치기"
        busy={busy}
        onConfirm={() => void write(confirming)}
        onCancel={() => setConfirming(null)}
      />
    )
  }

  return (
    <BottomSheet
      visible
      onClose={onClose}
      title={`${name} · ${dateWords(settlement.date)} · ${INPUT_TITLE[kind]}`}
      actions={
        <>
          <BigButton kind="secondary" label="닫기" onPress={onClose} />
          <BigButton label={kind === 'shipping' ? '바꾸기' : '적기'} busy={busy} onPress={submit} />
        </>
      }
    >
      <View style={{ gap: SPACE.md }}>
        {kind === 'shipping' ? (
          <View role="radiogroup" aria-label="배송비" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm }}>
            {SHIPPING_CHOICES.map((choice) => (
              <Pill key={choice} on={mode === choice} label={SHIPPING_WORD[choice]} ariaLabel={SHIPPING_WORD[choice]} onPress={() => setMode(choice)} />
            ))}
          </View>
        ) : null}
        {kind === 'adjust' ? (
          <View role="radiogroup" aria-label="할인 또는 추가" style={{ flexDirection: 'row', gap: SPACE.sm }}>
            <Pill on={sign === 'minus'} label="할인" ariaLabel="할인" onPress={() => setSign('minus')} />
            <Pill on={sign === 'plus'} label="추가" ariaLabel="추가" onPress={() => setSign('plus')} />
          </View>
        ) : null}
        {needsAmount ? (
          <TextField
            label={kind === 'payment' ? '입금 금액' : kind === 'shipping' ? '배송비 금액' : kind === 'adjust' ? (sign === 'minus' ? '할인 금액' : '추가 금액') : '환불 금액'}
            unit="원"
            value={amount}
            onChangeText={(next) => setAmount(next.replace(/[^\d]/g, ''))}
            keyboardType="number-pad"
            inputMode="numeric"
            help={kind === 'payment' ? `남은 금액 ${formatWon(remaining)}` : kind === 'refund' ? REFUND_NOTE : undefined}
          />
        ) : null}
        {kind === 'payment' ? <TextField label="메모(선택)" value={text} onChangeText={setText} placeholder="10/18 국민" help={PAYMENT_DATE_NOTE} /> : null}
        {kind === 'adjust' || kind === 'refund' ? (
          <View style={{ gap: SPACE.sm }}>
            <TextField label="사유" value={text} onChangeText={setText} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm }}>
              {(kind === 'adjust' ? ADJUST_REASONS : REFUND_REASONS).map((reason) => (
                <Pill key={reason} on={text === reason} label={reason} ariaLabel={`사유 ${reason}`} onPress={() => setText(reason)} />
              ))}
            </View>
          </View>
        ) : null}
        {problem !== null ? <Notice tone="danger" alert>{problem}</Notice> : null}
        {error !== null ? <Notice tone="danger" alert>{error.message}</Notice> : null}
      </View>
    </BottomSheet>
  )
}
