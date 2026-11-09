// 정산 탭 (D-APPX-01 — 웹 SettlementsPage와 같은 규칙·문구, 앱 화면으로 옮김. 전에는 웹으로 열기 안내만 있었다 D-UX2-07).
// 날짜 고르기 → 손님 목록(덜 받은 손님 먼저, 걸러 보기) → 손님 자세히(품목·금액·기록) → 입금 적기·배송비 바꾸기·할인·추가·환불 적기.
// 금액은 서버(엔진)가 정한 정수 원 그대로 보인다. 쓰기는 웹과 같은 `/api/events`에 같은 요청 번호로(다시 보내도 한 번만 기록).
// 입금 금액이 남은 금액과 다르면 한 번 더 묻는다(오타 방지 — AC-S06-30). 30일 지난 날짜(봉인)는 보기만 한다.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'
import type { PackingList, ReceiptBuyers, Settlement, WriteResult } from '@livejjim/web/src/api/types.ts'
import type { ParcelBrief, ParcelDay } from '@livejjim/web/src/api/parcel-types.ts'
import { parcelLine } from '@livejjim/web/src/lib/parcel-words.ts'
import { dateWords, kstShort } from '@livejjim/web/src/lib/kst.ts'
import { isApiError, newRequestId, post, withQuery, withRetry, type ApiError } from '../api/client.ts'
import { BuyerNames } from '../lib/derive.ts'
import { useParcelVersion } from '../lib/parcel-version.ts'
import { useCachedGet } from '../lib/cached-get.ts'
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
import { signalScreens, useScreenSignal } from '../lib/screen-signals.ts'
import { AppHeader, EmptyFill, NavBar, BigButton, BottomSheet, ConfirmSheet, Icon, TextField, Txt, useHoldRouteSwipe, useKit, useTabBarRoom, Tap } from '../ui/kit/index.ts'
import { RADIUS, GUTTER, SPACE, TOUCH } from '../ui/kit/tokens.ts'
import { Loading, Notice } from '../ui/parts.tsx'
import { AddressCard, ParcelTag } from './ParcelAddress.tsx'
import { BuyerInfoBanner } from './BuyerInfoScreen.tsx'
import { CARD_GAP, MenuRow, PAGE_SIDE, SectionCard, ValueLine } from './order-parts.tsx'

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
  /** 손님 정산 자세히를 진짜 쌓인 화면으로 (D-UX4-58) — 없으면(시험·웹) 이 화면 안에서 바꿔 끼운다. key는 정산 열쇠 */
  readonly openBuyer?: (date: string, key: string) => void
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
      {/* 모든 화면과 같은 머리 줄 (D-UX4-59) */}
      <AppHeader title="주문" />
      {/* 홈과 같은 여백 (D-UX3-93): 좌우 20, 카드 사이 16 */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: PAGE_SIDE, paddingTop: SPACE.sm, paddingBottom: SPACE.xxxl + room, gap: CARD_GAP }} scrollIndicatorInsets={{ bottom: room }} keyboardShouldPersistTaps="handled">
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
  // 쌓인 손님 자세히에서 기록하면 돌아올 때 목록도 다시 받는다 (D-UX4-58)
  useScreenSignal(settleTopic(date), reload)
  const [filter, setFilter] = useState<PaymentFilter>('ALL')
  // 택배 화면 [배송지 보기]로 오면 그 손님 자세히부터 (D-UX3-35)
  const [open, setOpen] = useState<string | null>(initialBuyer === undefined || nav.openBuyer !== undefined ? null : JSON.stringify([initialBuyer, date]))
  // 쌓인 화면이면 처음 한 번 그 손님 자세히를 위에 연다 (택배 [배송지 보기], D-UX3-35)
  const openedFirst = useRef(false)
  useEffect(() => {
    if (openedFirst.current || initialBuyer === undefined || nav.openBuyer === undefined) return
    openedFirst.current = true
    nav.openBuyer(date, JSON.stringify([initialBuyer, date]))
  }, [initialBuyer, nav, date])
  const pick = (key: string) => (nav.openBuyer === undefined ? setOpen(key) : nav.openBuyer(date, key))
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
  // 바로 가기 (D-UX3-93): 옛 테두리 단추 셋이 줄바꿈되던 것을 흰 카드 한 줄 세 칸으로 — 방송 뒤 순서대로(확인서 → 입금 → 리포트)
  const links: { readonly label: string; readonly onPress: () => void }[] = []
  if (nav.openReceipts !== undefined) links.push({ label: '확인서 보내기', onPress: nav.openReceipts })
  if (nav.openDeposits !== undefined) links.push({ label: '입금 확인', onPress: nav.openDeposits })
  if (nav.openReport !== undefined) {
    const openReport = nav.openReport
    links.push({ label: '라이브 리포트', onPress: () => openReport(date) })
  }
  return (
    <View style={{ gap: CARD_GAP }}>
      {links.length > 0 ? <QuickLinks links={links} /> : null}
      {data.sealed ? <Notice tone="info">{SEALED_SETTLEMENT}</Notice> : null}
      <View role="radiogroup" aria-label="입금 상태로 보기">
        {/* 위 날짜 알약(DayPills)과 같은 왼쪽 줄 */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -GUTTER }} contentContainerStyle={{ gap: SPACE.sm, paddingHorizontal: GUTTER, paddingVertical: SPACE.xs }}>
          {FILTERS.map((item) => {
            const count = item.key === 'ALL' ? all.length : all.filter((s) => s.payment === item.key).length
            return <Pill key={item.key} on={filter === item.key} label={`${item.word} ${String(count)}`} ariaLabel={`${item.word} ${String(count)}명`} onPress={() => setFilter(item.key)} />
          })}
        </ScrollView>
      </View>
      {/* 손님 줄은 흰 카드 하나에 (토스 목록처럼) — 맨 위 회색 글은 그날 요약 */}
      <SectionCard title={summaryWords(all)} label="손님 목록" flush>
        {shown.length === 0 ? (
          <EmptyFill title={all.length === 0 ? '정산할 손님이 없어요' : '이 상태의 손님이 없어요'} {...(all.length === 0 ? { body: '이 날짜에 정해진 찜이 없어요' } : {})} />
        ) : (
          <View>
            {shown.map((s) => (
              <SettleRow key={`${s.buyer}/${s.date}`} settlement={s} name={names.name(s.buyer)} parcel={parcels.get(s.buyer) ?? null} steps={steps.get(s.buyer) ?? null} onPress={() => pick(JSON.stringify([s.buyer, s.date]))} />
            ))}
          </View>
        )}
      </SectionCard>
    </View>
  )
}

/** 바로 가기 한 줄 (흰 카드 안 같은 폭 세 칸, 글자만) */
function QuickLinks({ links }: { readonly links: readonly { readonly label: string; readonly onPress: () => void }[] }) {
  const { p } = useKit()
  return (
    <View role="group" aria-label="바로 가기" style={{ flexDirection: 'row', backgroundColor: p.surface, borderRadius: RADIUS.xl, borderCurve: 'continuous', padding: SPACE.xs + 2, gap: SPACE.xs }}>
      {links.map((link) => (
        <Tap key={link.label} role="button" aria-label={link.label} onPress={link.onPress} style={({ pressed }) => ({ flex: 1, minHeight: TOUCH.min, paddingHorizontal: SPACE.xs, borderRadius: RADIUS.lg, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? p.pressed : 'transparent' })}>
          <Txt step="body" weight="medium" center numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            {link.label}
          </Txt>
        </Tap>
      ))}
    </View>
  )
}

/** 손님마다 택배 시도 (포장 목록에 실려 온다 — 웹 정산 줄과 같은 출처, AC-T1-65). 못 받으면 꼬리표 없이 */
function useParcelMarks(date: string, version: number): ReadonlyMap<string, ParcelBrief> {
  // 기억해 둔 포장 목록으로 바로 꼬리표를 붙이고 뒤에서 다시 받는다 (D-UX4-77)
  const { data: list } = useCachedGet<PackingList>(`/api/days/${date}/packing`, version)
  return useMemo(() => {
    const next = new Map<string, ParcelBrief>()
    if (list !== null) for (const entry of list.entries) if (entry.parcel != null) next.set(entry.buyer, entry.parcel)
    return next
  }, [list])
}

/** 손님마다 단계 (D-UX3-39) — 택배 줄·영수증 줄을 받으면 그때 채운다 (못 받으면 꼬리표 없이) */
function useOrderSteps(date: string, version: number): ReadonlyMap<string, OrderSteps> {
  // 둘 다 기억해 둔 것으로 바로 채우고 뒤에서 다시 받는다 (D-UX4-77) — 하나라도 없으면 꼬리표 없이(orderStepsOf)
  const { data: parcels } = useCachedGet<ParcelDay>(`/api/parcels/days/${date}`, version)
  const { data: receipts } = useCachedGet<ReceiptBuyers>(`/api/days/${date}/receipt-buyers`, version)
  return useMemo(() => orderStepsOf(parcels, receipts), [parcels, receipts])
}

function SettleRow({ settlement, name, parcel, steps, onPress }: { readonly settlement: Settlement; readonly name: string; readonly parcel: ParcelBrief | null; readonly steps: OrderSteps | null; readonly onPress: () => void }) {
  const { p, tones } = useKit()
  const left = remainingOf(settlement)
  const word = paymentWord(settlement.payment, settlement.refundDue)
  // 꼬리표 셋(색 바탕 + 기호)을 줄이고 (D-UX3-93): 아래 한 줄 작은 글자로 "미입금 · 정보 전 · 확인서 전" — 아직 안 한 것만 주황 글자
  const dot = <Txt step="caption" color="textSub">{' · '}</Txt>
  return (
    <Tap role="button" aria-label={`${name} · ${word} · 최종 ${formatWon(settlement.total)}${left > 0 ? ` · 남은 금액 ${formatWon(left)}` : ''}${parcel !== null ? ` · ${parcelLine(parcel)}` : ''}`} onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingVertical: SPACE.md, paddingHorizontal: SPACE.xl - SPACE.sm, marginHorizontal: SPACE.sm, minHeight: TOUCH.min, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt step="bodyLarge" weight="book" numberOfLines={1}>{name}</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
          <Txt step="caption" weight="medium" ink={tones[PAY_TONE[settlement.payment]].fg}>{word}</Txt>
          {steps !== null ? (
            <>
              {dot}
              <Txt step="caption" color={steps.info ? 'textSub' : 'warnText'}>{steps.info ? '정보 받음' : '정보 전'}</Txt>
              {dot}
              <Txt step="caption" color={steps.receipt ? 'textSub' : 'warnText'}>{steps.receipt ? '확인서 보냄' : '확인서 전'}</Txt>
            </>
          ) : null}
        </View>
        {parcel !== null ? (
          <View style={{ marginTop: SPACE.xs }}>
            <ParcelTag parcel={parcel} />
          </View>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Txt step="bodyLarge" weight="medium">{formatWon(settlement.total)}</Txt>
        {left > 0 ? <Txt step="caption" color="textSub">{`남은 ${formatWon(left)}`}</Txt> : null}
      </View>
      <Icon name="chevron" color={p.textSub} size={18} />
    </Tap>
  )
}

interface Saved {
  readonly text: string
  readonly tone: 'success' | 'warning'
}

function SettleDetail({ data, names, settlement, parcelVersion, onBack, onWritten, bare = false }: { readonly data: ScopeData; readonly names: BuyerNames; readonly settlement: Settlement; readonly parcelVersion: number; readonly onBack: () => void; readonly onWritten: () => void; readonly bare?: boolean }) {
  const { p } = useKit()
  // 정산 탭 안에서 바꿔 끼운 화면(시험·웹)일 때만 — 밀어 뒤로 가기가 정산 경로를 닫지 않게 (D-UX4-50). 쌓인 화면(bare)은 휴대폰이 뒤로 간다
  useHoldRouteSwipe(!bare)
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
  const others = (['payment', 'shipping', 'adjust', 'refund'] as const).filter((kind) => kind !== primary)
  const openInput = (kind: InputKind) => {
    setSaved(null)
    setInput(kind)
  }
  return (
    // 자세히 (D-UX3-93): 옛 "정산 목록으로" 큰 단추 → 이름 옆 뒤로 ‹, 상태 꼬리표 → 이름 아래 색 글자,
    // 큰 단추 넷이 위아래로 쌓이던 것 → 할 일 하나(초록 단추)는 금액 카드 안에, 나머지는 흰 카드 속 줄로
    <View style={{ gap: CARD_GAP }} aria-label="정산 자세히">
      <View style={{ gap: 2 }}>
        {/* 모든 쌓인 화면과 같은 머리 — 가운데 이름 (D-UX4-40). 목록 틀의 좌우·위 여백을 거슬러 화면 끝에 맞춘다 */}
        {bare ? null : (
          <View style={{ marginHorizontal: -PAGE_SIDE, marginTop: -SPACE.lg }}>
            <NavBar title={name} onBack={onBack} backLabel="정산 목록으로" />
          </View>
        )}
        <View style={{ paddingLeft: SPACE.xs, gap: 2 }}>
          <PayWord payment={settlement.payment} refundDue={settlement.refundDue} />
          {buyer !== undefined && buyer.merged.length > 0 ? <Txt step="caption" color="textSub">합친 구매자: {buyer.merged.map((id) => names.name(id)).join(', ')}</Txt> : null}
        </View>
      </View>
      {saved !== null ? <Notice tone={saved.tone}>{saved.text}</Notice> : null}

      <SectionCard title="금액" label="금액">
        <ValueLine label="상품 합계" value={formatWon(settlement.subtotal)} />
        <ValueLine label={`배송비${settlement.shippingOverride !== null ? ` (${SHIPPING_WORD[settlement.shippingOverride]})` : ''}`} value={formatWon(settlement.shipping)} />
        <ValueLine label="할인·추가" value={signedWon(empty ? 0 : settlement.adjustments)} />
        <ValueLine label="최종" value={formatWon(settlement.total)} strong />
        <View aria-hidden style={{ height: 1, backgroundColor: p.border }} />
        <ValueLine label="받은 금액" value={formatWon(settlement.received)} />
        <ValueLine label="남은 금액" value={formatWon(remaining)} strong={remaining > 0} />
        {settlement.refundDue > 0 ? <ValueLine label="돌려줄 돈" value={formatWon(settlement.refundDue)} strong /> : null}
        {!data.sealed && primary !== null ? (
          <View style={{ marginTop: SPACE.xs }}>
            <BigButton label={INPUT_TITLE[primary]} onPress={() => openInput(primary)} />
          </View>
        ) : null}
      </SectionCard>

      {data.sealed ? (
        <Notice tone="info">{SEALED_SETTLEMENT}</Notice>
      ) : (
        <SectionCard label="정산 입력" flush>
          {others.map((kind) => (
            <MenuRow key={kind} title={INPUT_TITLE[kind]} onPress={() => openInput(kind)} />
          ))}
        </SectionCard>
      )}

      <SectionCard title="품목" label="품목">
        {empty ? <Txt step="bodyLarge" weight="book">취소되어 품목이 없어요</Txt> : null}
        {claims.map((claim) => (
          <Txt key={claim.id} step="bodyLarge" weight="book">
            {detailLineWords(claim, data.products.get(claim.product)?.name)}
            {claim.buyer !== settlement.buyer ? ` · ${names.name(claim.buyer)}` : ''}
          </Txt>
        ))}
      </SectionCard>

      <AddressCard date={settlement.date} buyer={settlement.buyer} sealed={data.sealed} version={parcelVersion} />

      <SectionCard title="기록" label="정산 기록">
        {settlement.records.length === 0 ? <Txt color="textSub">아직 기록이 없어요.</Txt> : null}
        {settlement.records.map((record) => {
          const amount = record.kind === 'shipping' ? `${SHIPPING_WORD[(record.mode ?? 'DEFAULT') as ShippingChoice]}${record.mode === 'FIXED' && record.amount !== null ? ` ${formatWon(record.amount)}` : ''}` : record.amount === null ? '' : formatWon(Math.abs(record.amount))
          const detail = [record.reason !== null ? storedMemoWords(record.reason) : null, record.memo !== null ? storedMemoWords(record.memo) : null, `기록한 때 ${kstShort(record.at)}`, record.buyer !== settlement.buyer ? names.name(record.buyer) : null].filter((part) => part !== null).join(' · ')
          return (
            <View key={record.seq} style={{ gap: 2 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: SPACE.sm }}>
                <Txt step="bodyLarge" weight="book">{recordKindWord(record.kind, record.amount)}</Txt>
                <Txt step="bodyLarge" weight="book">{amount}</Txt>
              </View>
              <Txt step="caption" color="textSub">{detail}</Txt>
            </View>
          )
        })}
      </SectionCard>

      {input !== null ? <InputSheet kind={input} name={name} settlement={settlement} remaining={remaining} onClose={() => setInput(null)} onDone={done} /> : null}
    </View>
  )
}

/** 입금 상태 글자 (상태 색, 꼬리표 바탕 없이) */
function PayWord({ payment, refundDue }: { readonly payment: Settlement['payment']; readonly refundDue: number }) {
  const { tones } = useKit()
  return (
    <Txt step="body" weight="medium" ink={tones[PAY_TONE[payment]].fg}>
      {paymentWord(payment, refundDue)}
    </Txt>
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

const settleTopic = (date: string): string => `settle:${date}`

/**
 * 손님 정산 자세히 진짜 쌓인 화면 (D-UX4-58, 사용자 지시 2026-11-09 "가짜판으로 했었어? 진짜판으로 해야지"): 주문 탭 위에 쌓인다.
 * 머리는 모든 쌓인 화면과 같은 NavBar(가운데 손님 이름), 기록하면 아래 주문 목록에 다시 받으라고 알린다.
 */
export function SettleBuyerScreen({ date, settlementKey, onBack }: { readonly date: string; readonly settlementKey: string; readonly onBack: () => void }) {
  const { p } = useKit()
  const { data, error, reload } = useDayScope(date)
  const [parcelVersion] = useParcelVersion(date)
  const names = useMemo(() => (data === null ? null : new BuyerNames(data.buyers, data.claims)), [data])
  const settlement = data?.settlements.get(settlementKey)
  const title = settlement === undefined || names === null ? '' : names.name(settlement.buyer)
  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="settle-buyer-screen">
      <NavBar title={title} onBack={onBack} backLabel="정산 목록으로" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: PAGE_SIDE, paddingTop: SPACE.xs, paddingBottom: SPACE.xxxl, gap: CARD_GAP }} keyboardShouldPersistTaps="handled">
        {error !== null && data === null ? (
          <View style={{ gap: SPACE.sm }}>
            <Notice tone="danger" alert>{error.message}</Notice>
            <BigButton label={RETRY_NOW} kind="secondary" onPress={reload} />
          </View>
        ) : data === null || names === null ? (
          <Loading />
        ) : settlement === undefined ? (
          <EmptyFill title="그 손님 정산을 찾지 못했어요" body="목록으로 돌아가 다시 골라 주세요" />
        ) : (
          <SettleDetail
            bare
            data={data}
            names={names}
            settlement={settlement}
            parcelVersion={parcelVersion}
            onBack={onBack}
            onWritten={() => {
              reload()
              signalScreens(settleTopic(date))
            }}
          />
        )}
      </ScrollView>
    </View>
  )
}
