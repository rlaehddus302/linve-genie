// 주문 탭 (D-APPX-01 → D-UX4-122, 사용자 지시 2026-11-11 "주문 탭 … 정돈되어 있지 않아서 사용자 경험이 별로야" → "이대로 만들어").
// 판매자가 여기 오는 까닭 = 이번 라이브 손님 한 명 한 명을 "돈 받았고 보낼 준비 끝"으로 만들기 (lib/order-flow.ts).
// 위에서부터: 날짜 → 진행 카드(손님 n명 중 m명 끝 · 단계 칸 셋 — 정보 받기·확인서 보내기·입금 확인, 누르면 그 단계 남은 손님만)
// → 지금 할 일 카드(처음 남은 단계 하나와 단추 하나 — 다 끝나면 [포장하러 가기]) → 할 일 남은 손님(줄마다 다음 할 일 하나) → 끝난 손님(접힘).
// 옛 바로 가기 셋(확인서 보내기·입금 확인·라이브 리포트)과 입금 상태 거르기 다섯은 뺐다 — 리포트는 전체 탭에 있다.
// 손님 자세히는 SettleDetail.tsx. 금액은 서버(엔진)가 정한 정수 원 그대로, 30일 지난 날짜(봉인)는 보기만 한다.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'
import type { PackingList, Settlement } from '@livejjim/web/src/api/types.ts'
import type { ParcelBrief } from '@livejjim/web/src/api/parcel-types.ts'
import { parcelLine } from '@livejjim/web/src/lib/parcel-words.ts'
import { BuyerNames } from '../lib/derive.ts'
import { useParcelVersion } from '../lib/parcel-version.ts'
import { useCachedGet } from '../lib/cached-get.ts'
import { SEALED_SETTLEMENT, remainingOf, sortForSeller } from '../lib/settle.ts'
import { STEP_ORDER, STEP_TITLE, firstOpenStep, flowSummary, nextStepOf, nextWords, stepLeft, todoWords, type BuyerSteps, type FlowSummary, type OrderStep } from '../lib/order-flow.ts'
import { useOrderSteps } from '../lib/use-order-steps.ts'
import { formatWon, paymentWord, RETRY_NOW } from '../lib/words.ts'
import { DayPills, useRealDays } from '../ui/day-pills.tsx'
import { useDayScope } from '../lib/day-scope.ts'
import { useScreenSignal } from '../lib/screen-signals.ts'
import { AppHeader, Appear, EmptyFill, BigButton, Icon, Txt, useKit, useTabBarRoom, Tap } from '../ui/kit/index.ts'
import { RADIUS, SPACE, TOUCH } from '../ui/kit/tokens.ts'
import { Loading, Notice } from '../ui/parts.tsx'
import { Late, useCameLate } from '../ui/late.tsx'
import { ParcelTag } from './ParcelAddress.tsx'
import { BuyerInfoBanner } from './BuyerInfoScreen.tsx'
import { CARD_GAP, PAGE_SIDE, SectionCard } from './order-parts.tsx'
import { SettleDetail, settleTopic } from './SettleDetail.tsx'

export interface SettleNavigation {
  /** 입금 확인 화면 (입금 단계 한꺼번에) */
  readonly openDeposits?: () => void
  /** 손님 정보 문자 화면 (ORD-14) */
  readonly openBuyerInfo?: () => void
  /** 확인서 보내기 화면 (확인서 단계 한꺼번에 — D-UX3-39) */
  readonly openReceipts?: () => void
  /** 포장 탭 (다 끝났을 때 — D-UX4-122) */
  readonly openPacking?: () => void
  /** 손님 정산 자세히를 진짜 쌓인 화면으로 (D-UX4-58) — 없으면(시험·웹) 이 화면 안에서 바꿔 끼운다. key는 정산 열쇠 */
  readonly openBuyer?: (date: string, key: string) => void
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
        {/* 서버에서 받은 뒤에야 생기는 날짜 줄은 부드럽게 (D-UX4-112) */}
        <Late>
          {days !== null ? <DayPills days={days} date={date} onPick={setDate} /> : null}
        </Late>
        {date !== null ? <SettleDay key={date} date={date} nav={nav} initialBuyer={date === initialDate ? initialBuyer : undefined} /> : null}
      </ScrollView>
    </View>
  )
}

function SettleDay({ date, nav, initialBuyer }: { readonly date: string; readonly nav: SettleNavigation; readonly initialBuyer?: string }) {
  const { data, error, reload } = useDayScope(date)
  // 쌓인 손님 자세히에서 기록하면 돌아올 때 목록도 다시 받는다 (D-UX4-58)
  useScreenSignal(settleTopic(date), reload)
  // 단계 칸을 누르면 그 단계가 남은 손님만 (다시 누르면 모두)
  const [step, setStep] = useState<OrderStep | null>(null)
  const [doneOpen, setDoneOpen] = useState(false)
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
  // 불러온 뒤에야 생긴 손님 목록은 부드럽게 — 기억해 둔 목록으로 처음부터 그리면 바로 (D-UX4-112)
  const late = useCameLate(data !== null && names !== null)
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
  if (settlement !== undefined) return <SettleDetail data={data} names={names} settlement={settlement} parcelVersion={parcelVersion} onBack={() => setOpen(null)} onWritten={reload} {...(nav.openReceipts !== undefined ? { onOpenReceipts: nav.openReceipts } : {})} />
  if (all.length === 0) {
    return (
      <Appear instant={!late} style={{ gap: CARD_GAP }}>
        <SectionCard label="손님 목록">
          <EmptyFill title="정산할 손님이 없어요" body="이 날짜에 정해진 찜이 없어요" />
        </SectionCard>
      </Appear>
    )
  }
  const summary = flowSummary(all, steps)
  const stepsOf = (s: Settlement) => steps?.get(s.buyer)
  const row = (s: Settlement) => <SettleRow key={`${s.buyer}/${s.date}`} settlement={s} name={names.name(s.buyer)} steps={stepsOf(s)} parcel={parcels.get(s.buyer) ?? null} onPress={() => pick(JSON.stringify([s.buyer, s.date]))} />
  const todo = all.filter((s) => nextStepOf(s, stepsOf(s)) !== null)
  const done = all.filter((s) => nextStepOf(s, stepsOf(s)) === null)
  const picked = step === null ? null : all.filter((s) => stepLeft(step, s, stepsOf(s)))
  return (
    <Appear instant={!late} style={{ gap: CARD_GAP }}>
      {data.sealed ? <Notice tone="info">{SEALED_SETTLEMENT}</Notice> : null}
      <ProgressCard summary={summary} step={step} onStep={(next) => setStep(step === next ? null : next)} />
      {step === null ? <TodoCard summary={summary} nav={nav} sealed={data.sealed} onStep={setStep} /> : null}
      {picked !== null && step !== null ? (
        <SectionCard title={`${STEP_TITLE[step]} 남은 손님 ${String(picked.length)}명`} label="고른 단계 손님" flush>
          {picked.length === 0 ? <EmptyFill title="이 단계는 다 끝났어요" /> : <View>{picked.map(row)}</View>}
        </SectionCard>
      ) : (
        <>
          {todo.length > 0 ? (
            <SectionCard title={`할 일 남은 손님 ${String(todo.length)}명`} label="할 일 남은 손님" flush>
              <View>{todo.map(row)}</View>
            </SectionCard>
          ) : null}
          {done.length > 0 ? (
            <SectionCard label="끝난 손님" flush>
              <Fold title={`끝난 손님 ${String(done.length)}명`} open={doneOpen} onToggle={() => setDoneOpen(!doneOpen)} />
              {doneOpen ? <View>{done.map(row)}</View> : null}
            </SectionCard>
          ) : null}
        </>
      )}
    </Appear>
  )
}

/** 진행 카드: 손님 n명 중 m명 끝 + 막대 + 단계 칸 셋 (누르면 그 단계 남은 손님만) */
function ProgressCard({ summary, step, onStep }: { readonly summary: FlowSummary; readonly step: OrderStep | null; readonly onStep: (step: OrderStep) => void }) {
  const { p } = useKit()
  const ratio = summary.total === 0 ? 0 : summary.done / summary.total
  return (
    <SectionCard label="진행">
      <View style={{ gap: SPACE.sm }}>
        <Txt step="title" weight="bold">{`손님 ${String(summary.total)}명 중 ${String(summary.done)}명 끝났어요`}</Txt>
        <View aria-hidden style={{ height: 6, borderRadius: 3, borderCurve: 'continuous', backgroundColor: p.soft, overflow: 'hidden' }}>
          <View style={{ width: `${String(Math.round(ratio * 100))}%`, height: 6, borderRadius: 3, borderCurve: 'continuous', backgroundColor: p.primary }} />
        </View>
      </View>
      <View role="radiogroup" aria-label="단계로 보기" style={{ flexDirection: 'row', gap: SPACE.xs }}>
        {STEP_ORDER.map((key) => (
          <StepCell key={key} step={key} left={summary.left[key]} on={step === key} onPress={() => onStep(key)} />
        ))}
      </View>
    </SectionCard>
  )
}

function StepCell({ step, left, on, onPress }: { readonly step: OrderStep; readonly left: number | null; readonly on: boolean; readonly onPress: () => void }) {
  const { p } = useKit()
  const count = left === null ? '확인 중' : left === 0 ? '다 끝남' : `${String(left)}명 남음`
  return (
    <Tap
      role="radio"
      aria-checked={on}
      aria-label={`${STEP_TITLE[step]} ${count}`}
      onPress={onPress}
      style={({ pressed }) => ({ flex: 1, minHeight: TOUCH.min + SPACE.lg, paddingVertical: SPACE.sm, paddingHorizontal: SPACE.xs, borderRadius: RADIUS.lg, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: on ? p.soft : pressed ? p.pressed : p.background })}
    >
      <Txt step="caption" color="textSub" center numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{STEP_TITLE[step]}</Txt>
      <Txt step="body" weight="medium" center color={left !== null && left > 0 ? 'warnText' : 'textSub'} numberOfLines={1}>{count}</Txt>
    </Tap>
  )
}

/** 지금 할 일 카드: 처음 남은 단계 하나와 단추 하나. 다 끝났으면 [포장하러 가기] */
function TodoCard({ summary, nav, sealed, onStep }: { readonly summary: FlowSummary; readonly nav: SettleNavigation; readonly sealed: boolean; readonly onStep: (step: OrderStep) => void }) {
  const first = firstOpenStep(summary)
  if (first === null) {
    // 정보·확인서 단계를 모르면 끝났다고 말하지 않는다
    if (!summary.known) return null
    return (
      <SectionCard label="지금 할 일">
        <Txt step="bodyLarge" weight="medium">{`손님 ${String(summary.total)}명 모두 끝났어요`}</Txt>
        {nav.openPacking !== undefined ? <BigButton label="포장하러 가기" onPress={nav.openPacking} /> : null}
      </SectionCard>
    )
  }
  if (sealed) return null
  const action =
    first === 'receipt' && nav.openReceipts !== undefined
      ? { label: '확인서 보내기', onPress: nav.openReceipts }
      : first === 'payment' && nav.openDeposits !== undefined
        ? { label: '입금 확인하기', onPress: nav.openDeposits }
        : { label: first === 'info' ? '배송지 못 받은 손님 보기' : `${STEP_TITLE[first]} 남은 손님 보기`, onPress: () => onStep(first) }
  return (
    <SectionCard title="지금 할 일" label="지금 할 일">
      <Txt step="bodyLarge" weight="medium">{todoWords(first, summary)}</Txt>
      <BigButton label={action.label} onPress={action.onPress} />
    </SectionCard>
  )
}

/** 접는 줄 (끝난 손님) */
function Fold({ title, open, onToggle }: { readonly title: string; readonly open: boolean; readonly onToggle: () => void }) {
  const { p } = useKit()
  return (
    <Tap role="button" aria-label={title} aria-expanded={open} onPress={onToggle} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingVertical: SPACE.sm, paddingHorizontal: SPACE.xl - SPACE.sm, marginHorizontal: SPACE.sm, minHeight: TOUCH.min, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
      <View style={{ flex: 1 }}>
        <Txt step="body" color="textSub">{title}</Txt>
      </View>
      <Icon name={open ? 'up' : 'down'} color={p.textSub} size={18} />
    </Tap>
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

/** 손님 줄: 이름 아래 다음 할 일 하나(남았으면 주황), 오른쪽 최종 금액·남은 금액 */
function SettleRow({ settlement, name, steps, parcel, onPress }: { readonly settlement: Settlement; readonly name: string; readonly steps: BuyerSteps | undefined; readonly parcel: ParcelBrief | null; readonly onPress: () => void }) {
  const { p } = useKit()
  const left = remainingOf(settlement)
  const next = nextStepOf(settlement, steps)
  const word = next === null ? paymentWord(settlement.payment, settlement.refundDue) : nextWords(settlement, next)
  return (
    <Tap role="button" aria-label={`${name} · ${word} · 최종 ${formatWon(settlement.total)}${left > 0 ? ` · 남은 금액 ${formatWon(left)}` : ''}${parcel !== null ? ` · ${parcelLine(parcel)}` : ''}`} onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingVertical: SPACE.md, paddingHorizontal: SPACE.xl - SPACE.sm, marginHorizontal: SPACE.sm, minHeight: TOUCH.min, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt step="bodyLarge" weight="book" numberOfLines={1}>{name}</Txt>
        <Txt step="caption" weight="medium" color={next === null ? 'textSub' : 'warnText'} numberOfLines={1}>{word}</Txt>
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

// 손님 자세히는 SettleDetail.tsx (D-UX4-122) — 경로·시험이 쓰던 이름은 여기서도 그대로 부른다
export { SettleBuyerScreen } from './SettleDetail.tsx'
