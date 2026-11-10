// 손님 정산 자세히 (D-APPX-01 → D-UX4-58 쌓인 화면 → D-UX4-122 주문 탭 다시 짜기에서 목록 파일과 나눔).
// 품목·금액·기록, 입금 적기·배송비 바꾸기·할인·추가·환불 적기. 금액은 서버(엔진)가 정한 정수 원 그대로.
// 쓰기는 웹과 같은 `/api/events`에 같은 요청 번호로(다시 보내도 한 번만 기록). 입금 금액이 남은 금액과 다르면 한 번 더 묻는다(AC-S06-30).
// 30일 지난 날짜(봉인)는 보기만 한다.
// D-UX4-123: 맨 위에 다음 할 일 카드 하나(정보 받기 → 배송지 칸을 그 자리에, 확인서 보내기 → [확인서 문자 보내기], 입금 확인 → [입금 적기]·[환불 적기], 다 끝남 → 한 줄).
// 금액 카드는 값만, 나머지 입력은 금액 고치기 줄로.
import { useMemo, useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'
import type { ReceiptBuyers, Settlement, WriteResult } from '@livejjim/web/src/api/types.ts'
import { SMS_NOTE, SMS_OPEN, SMS_PHONE_HELP, SMS_PHONE_LABEL, SMS_SEND, SMS_SENT, SMS_UNAVAILABLE } from '@livejjim/web/src/lib/receipt-sms.ts'
import { dateWords, kstShort } from '@livejjim/web/src/lib/kst.ts'
import { isApiError, newRequestId, post, withQuery, withRetry, type ApiError } from '../api/client.ts'
import { useCachedGet } from '../lib/cached-get.ts'
import { BuyerNames } from '../lib/derive.ts'
import { nextStepOf, nextWords } from '../lib/order-flow.ts'
import { useParcelVersion } from '../lib/parcel-version.ts'
import { useReceiptSms, useSmsDevice } from '../lib/receipt-sms-flow.ts'
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
  storedMemoWords,
  type InputKind,
  type ShippingChoice,
} from '../lib/settle.ts'
import { formatWon, paymentWord, RETRY_NOW } from '../lib/words.ts'
import { Pill } from '../ui/day-pills.tsx'
import { useDayScope } from '../lib/day-scope.ts'
import { signalScreens } from '../lib/screen-signals.ts'
import { useOrderSteps } from '../lib/use-order-steps.ts'
import { EmptyFill, NavBar, BigButton, BottomSheet, ConfirmSheet, TextField, Txt, useHoldRouteSwipe, useKit } from '../ui/kit/index.ts'
import { SPACE } from '../ui/kit/tokens.ts'
import { Loading, Notice } from '../ui/parts.tsx'
import { AddressCard } from './ParcelAddress.tsx'
import { CARD_GAP, MenuRow, PAGE_SIDE, SectionCard, ValueLine } from './order-parts.tsx'

/** 입금 상태 글자 색 */
export const PAY_TONE = { UNPAID: 'danger', PARTIAL: 'warning', PAID: 'success', OVERPAID: 'warning' } as const

interface Saved {
  readonly text: string
  readonly tone: 'success' | 'warning'
}

/** 다음 할 일 카드 문장 (D-UX4-123) */
export const NEXT_TITLE = '다음 할 일'
export const NEXT_INFO = '배송지를 아직 못 받았어요'
export const NEXT_RECEIPT = '확인서를 아직 안 보냈어요'
export const NEXT_DONE = '이 손님은 다 끝났어요'
export const SEND_RECEIPT_SMS = '확인서 문자 보내기'
export const OPEN_RECEIPTS = '영수증 보내기 화면 열기'
export const FIX_TITLE = '금액 고치기'

export function SettleDetail({
  data,
  names,
  settlement,
  parcelVersion,
  onBack,
  onWritten,
  onOpenReceipts,
  bare = false,
}: {
  readonly data: ScopeData
  readonly names: BuyerNames
  readonly settlement: Settlement
  readonly parcelVersion: number
  readonly onBack: () => void
  readonly onWritten: () => void
  /** 이 기기에서 문자를 못 보낼 때 확인서를 링크로 보내러 갈 영수증 보내기 화면 (없으면 단추 없이 안내만) */
  readonly onOpenReceipts?: () => void
  readonly bare?: boolean
}) {
  const { p } = useKit()
  // 정산 탭 안에서 바꿔 끼운 화면(시험·웹)일 때만 — 밀어 뒤로 가기가 정산 경로를 닫지 않게 (D-UX4-50). 쌓인 화면(bare)은 휴대폰이 뒤로 간다
  useHoldRouteSwipe(!bare)
  const [input, setInput] = useState<InputKind | null>(null)
  const [saved, setSaved] = useState<Saved | null>(null)
  // 확인서를 보내면 단계를 새로 받는다 — 다음 할 일 카드가 다음 단계로 넘어간다
  const [stepsBump, setStepsBump] = useState(0)
  const steps = useOrderSteps(settlement.date, parcelVersion + stepsBump)
  // 다음 할 일 (D-UX4-123): 정보 → 확인서 → 입금. 단계를 모르면(택배·영수증 줄을 못 받음) 입금만 본다
  const step = nextStepOf(settlement, steps?.get(settlement.buyer))
  // 단계를 모르는데 입금이 끝났으면 "다 끝났어요"를 말하지 않는다 — 카드를 감춘다 (판매자가 일을 놓치지 않게)
  const nextShown = step !== null || steps !== null
  // 문자 보낼 수 있는 서버인지·손님 번호를 아는지 — 단계 훅과 같은 영수증 줄 (같은 요청에 붙고 새로 받으면 같이 바뀐다)
  const { data: receipts } = useCachedGet<ReceiptBuyers>(`/api/days/${settlement.date}/receipt-buyers`)
  const smsReady = receipts?.smsReady === true
  const receiptRow = receipts?.buyers.find((row) => row.buyer === settlement.buyer)
  const smsDevice = useSmsDevice(step === 'receipt' && smsReady && !data.sealed)
  const claims = useMemo(() => [...data.claims.values()].filter((c) => c.currentBuyer === settlement.buyer && c.status === 'CONFIRMED').sort((a, b) => a.seq - b.seq), [data.claims, settlement.buyer])
  const name = names.name(settlement.buyer)
  const sms = useReceiptSms(settlement.date, settlement.buyer, () => {
    setSaved({ text: SMS_SENT, tone: 'success' })
    setStepsBump((n) => n + 1)
    onWritten()
  })
  const remaining = remainingOf(settlement)
  const empty = settlement.items.length === 0
  // 입금 단계 단추: 돌려줄 돈이 있으면 환불 적기, 아니면 입금 적기 (primaryInput과 같은 뜻 — nextWords 문장과 맞춘다)
  const payKind: InputKind = settlement.refundDue > 0 ? 'refund' : (primaryInput(settlement.payment) ?? 'payment')
  const nextButton = !data.sealed && step === 'payment' ? payKind : null
  const buyer = data.buyers.get(settlement.buyer)
  const done = (result: WriteResult, text: string) => {
    setInput(null)
    setSaved(result.changed ? { text, tone: 'success' } : { text: NOT_APPLIED_SETTLEMENT, tone: 'warning' })
    onWritten()
  }
  // 금액 고치기 줄: 다음 할 일 단추로 이미 있는 것은 빼고
  const fixes = (['payment', 'shipping', 'adjust', 'refund'] as const).filter((kind) => kind !== nextButton)
  const openInput = (kind: InputKind) => {
    setSaved(null)
    setInput(kind)
  }
  const sealedInNext = data.sealed && nextShown && step !== null
  const sendSms = () => {
    setSaved(null)
    // 번호를 모르는 손님은 번호부터 (영수증 보내기 화면과 같다) — 서버가 모른다고 답해도(NO_PHONE) 번호 칸을 연다
    if (receiptRow?.sms != null && receiptRow.sms.last4 === null) sms.openSheet()
    else void sms.send(null)
  }
  return (
    // 자세히 (D-UX3-93 → D-UX4-123): 이름·입금 상태 → 다음 할 일 카드(할 일 하나) → 금액(값만) → 금액 고치기 줄 → 품목 → 배송지 → 기록
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

      {nextShown ? (
        <SectionCard title={NEXT_TITLE} label={NEXT_TITLE}>
          <Txt step="bodyLarge" weight="medium">
            {step === 'info' ? NEXT_INFO : step === 'receipt' ? NEXT_RECEIPT : step === 'payment' ? nextWords(settlement, step) : NEXT_DONE}
          </Txt>
          {sealedInNext ? <Notice tone="info">{SEALED_SETTLEMENT}</Notice> : null}
          {nextButton !== null ? <BigButton label={INPUT_TITLE[nextButton]} onPress={() => openInput(nextButton)} /> : null}
          {step === 'receipt' && !data.sealed ? (
            smsReady && smsDevice !== false ? (
              <BigButton label={SEND_RECEIPT_SMS} busy={smsDevice === null || (sms.busy && !sms.sheet)} onPress={sendSms} />
            ) : (
              <>
                {smsReady ? <Txt step="caption" color="textSub">{SMS_UNAVAILABLE}</Txt> : null}
                {onOpenReceipts !== undefined ? <BigButton kind="secondary" label={OPEN_RECEIPTS} onPress={onOpenReceipts} /> : null}
              </>
            )
          ) : null}
          {step === 'receipt' && sms.error !== null ? <Notice tone="danger" alert>{sms.error}</Notice> : null}
          {step === 'receipt' && sms.photoError !== null && !sms.sheet ? <Notice tone="danger" alert>{sms.photoError}</Notice> : null}
        </SectionCard>
      ) : null}
      {/* 정보 받기가 다음 할 일이면 배송지 칸을 바로 아래에 — 그 자리에서 적는다 (아래에 또 두지 않는다) */}
      {step === 'info' ? <AddressCard date={settlement.date} buyer={settlement.buyer} sealed={data.sealed} version={parcelVersion} /> : null}

      <SectionCard title="금액" label="금액">
        <ValueLine label="상품 합계" value={formatWon(settlement.subtotal)} />
        <ValueLine label={`배송비${settlement.shippingOverride !== null ? ` (${SHIPPING_WORD[settlement.shippingOverride]})` : ''}`} value={formatWon(settlement.shipping)} />
        <ValueLine label="할인·추가" value={signedWon(empty ? 0 : settlement.adjustments)} />
        <ValueLine label="최종" value={formatWon(settlement.total)} strong />
        <View aria-hidden style={{ height: 1, backgroundColor: p.border }} />
        <ValueLine label="받은 금액" value={formatWon(settlement.received)} />
        <ValueLine label="남은 금액" value={formatWon(remaining)} strong={remaining > 0} />
        {settlement.refundDue > 0 ? <ValueLine label="돌려줄 돈" value={formatWon(settlement.refundDue)} strong /> : null}
      </SectionCard>

      {data.sealed ? (
        sealedInNext ? null : <Notice tone="info">{SEALED_SETTLEMENT}</Notice>
      ) : (
        <SectionCard title={FIX_TITLE} label={FIX_TITLE} flush>
          {fixes.map((kind) => (
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

      {step === 'info' ? null : <AddressCard date={settlement.date} buyer={settlement.buyer} sealed={data.sealed} version={parcelVersion} />}

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
      {/* 번호를 모르는 손님에게 확인서 문자 — 번호를 넣고 문자 앱을 연다 (영수증 보내기 화면과 같은 판) */}
      <BottomSheet
        visible={sms.sheet}
        title={`${name}님에게 ${SMS_SEND}`}
        onClose={sms.closeSheet}
        actions={<BigButton label={SMS_OPEN} busy={sms.busy} disabled={sms.phone.replace(/\D/g, '').length < 10} onPress={() => void sms.send(sms.phone)} />}
      >
        <TextField label={SMS_PHONE_LABEL} help={SMS_PHONE_HELP} error={sms.phoneError} value={sms.phone} onChangeText={sms.setPhone} keyboardType="phone-pad" autoComplete="tel" maxLength={20} />
        <Txt step="caption" color="textSub">{SMS_NOTE}</Txt>
        {sms.photoError !== null ? <Notice tone="danger" alert>{sms.photoError}</Notice> : null}
      </BottomSheet>
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
      actions={<BigButton label={kind === 'shipping' ? '바꾸기' : '적기'} busy={busy} onPress={submit} />}
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

/** 주문 목록·손님 자세히가 서로 다시 받으라고 알리는 이름 */
export const settleTopic = (date: string): string => `settle:${date}`

/**
 * 손님 정산 자세히 진짜 쌓인 화면 (D-UX4-58, 사용자 지시 2026-11-09 "가짜판으로 했었어? 진짜판으로 해야지"): 주문 탭 위에 쌓인다.
 * 머리는 모든 쌓인 화면과 같은 NavBar(가운데 손님 이름), 기록하면 아래 주문 목록에 다시 받으라고 알린다.
 */
export function SettleBuyerScreen({ date, settlementKey, onBack, onOpenReceipts }: { readonly date: string; readonly settlementKey: string; readonly onBack: () => void; readonly onOpenReceipts?: () => void }) {
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
            onOpenReceipts={onOpenReceipts}
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
