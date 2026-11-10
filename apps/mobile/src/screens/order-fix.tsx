// 주문 상세 맨 아래 "확인서"·"금액 고치기" 줄 (D-UX4-125 — 옛 손님 정산 자세히 SettleDetail.tsx의 다음 할 일 카드·금액 고치기에서 옮김, D-UX4-123).
// 사용자 지시(2026-11-11 "주문 탭 수정 사항")로 상세가 토스 상세 내역 모양이 되었지만, 판매자가 손님마다 하던 일은 잃지 않게 그대로 둔다:
// 확인서 문자 보내기(사진 붙여 문자 앱 — 영수증 보내기 화면과 같은 흐름), 입금 적기·배송비 바꾸기·할인·추가·환불 적기, 금액 기록(자동 입금 확인·고친 까닭).
// 쓰기는 웹과 같은 `/api/events`에 같은 요청 번호로(다시 보내도 한 번만 기록). 입금 금액이 남은 금액과 다르면 한 번 더 묻는다(AC-S06-30).
// 30일 지난 날짜(봉인)는 보기만 한다. 금액은 서버(엔진)가 정한 정수 원 그대로.
import { useMemo, useRef, useState } from 'react'
import { View } from 'react-native'
import type { ReceiptBuyers, Settlement, WriteResult } from '@livejjim/web/src/api/types.ts'
import { SMS_NOTE, SMS_OPEN, SMS_PHONE_HELP, SMS_PHONE_LABEL, SMS_SEND, SMS_SENT, SMS_UNAVAILABLE } from '@livejjim/web/src/lib/receipt-sms.ts'
import { dateWords, kstShort } from '@livejjim/web/src/lib/kst.ts'
import { isApiError, newRequestId, post, withQuery, withRetry, type ApiError } from '../api/client.ts'
import { useCachedGet } from '../lib/cached-get.ts'
import { useDayScope } from '../lib/day-scope.ts'
import { BuyerNames } from '../lib/derive.ts'
import { settlementKey } from '../lib/scope-data.ts'
import { useReceiptSms, useSmsDevice } from '../lib/receipt-sms-flow.ts'
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
  looksLikePhone,
  readAmount,
  recordKindWord,
  refundRange,
  remainingOf,
  storedMemoWords,
  type InputKind,
  type ShippingChoice,
} from '../lib/settle.ts'
import { formatWon } from '../lib/words.ts'
import { Pill } from '../ui/day-pills.tsx'
import { BigButton, BottomSheet, ConfirmSheet, TextField, Txt } from '../ui/kit/index.ts'
import { SPACE } from '../ui/kit/tokens.ts'
import { Notice } from '../ui/parts.tsx'
import { MenuRow } from './order-parts.tsx'

export const SEND_RECEIPT_SMS = '확인서 문자 보내기'
export const OPEN_RECEIPTS = '영수증 보내기 화면 열기'
export const FIX_TITLE = '금액 고치기'
export const RECEIPT_TITLE = '확인서'
export const RECORDS_TITLE = '금액 기록'

/** 상세 묶음 이름 (토스 상세 내역의 "최근 거래 내역"처럼 굵은 본문) */
export function DetailHeading({ children }: { readonly children: string }) {
  return (
    <Txt step="section" weight="bold" role="heading" aria-level={2}>
      {children}
    </Txt>
  )
}

interface Saved {
  readonly text: string
  readonly tone: 'success' | 'warning'
}

/**
 * 주문 상세 맨 아래 줄들: 확인서(문자 보내기 또는 영수증 보내기 화면) · 금액 고치기 넷 · 금액 기록.
 * 금액 고치기는 그날 범위 자료의 정산 묶음으로 쓴다(웹과 같은 이벤트). 쓰고 나면 onWritten — 상세·목록을 다시 받는다.
 */
export function OrderFixes({ date, buyer, name, onWritten, onOpenReceipts }: { readonly date: string; readonly buyer: string; readonly name: string; readonly onWritten: () => void; readonly onOpenReceipts?: () => void }) {
  const { data, reload } = useDayScope(date)
  const [input, setInput] = useState<InputKind | null>(null)
  const [saved, setSaved] = useState<Saved | null>(null)
  const settlement = data?.settlements.get(settlementKey({ buyer, date }))
  const names = useMemo(() => (data === null ? null : new BuyerNames(data.buyers, data.claims)), [data])
  const sealed = data?.sealed === true
  // 문자 보낼 수 있는 서버인지·손님 번호를 아는지 — 영수증 보내기 화면과 같은 줄
  const { data: receipts, error: receiptsError, reload: reloadReceipts } = useCachedGet<ReceiptBuyers>(`/api/days/${date}/receipt-buyers`)
  // 영수증 줄을 받기 전에는 확인서 줄을 그리지 않는다 — 단추가 바뀌어 보이지 않게 (못 받으면 영수증 보내기 화면으로)
  const receiptsKnown = receipts !== null || receiptsError !== null
  const smsReady = receipts?.smsReady === true
  const receiptRow = receipts?.buyers.find((row) => row.buyer === buyer)
  const smsDevice = useSmsDevice(smsReady && data !== null && !sealed)
  const written = () => {
    reload()
    onWritten()
  }
  const sms = useReceiptSms(date, buyer, () => {
    setSaved({ text: SMS_SENT, tone: 'success' })
    void reloadReceipts()
    written()
  })
  const done = (result: WriteResult, text: string) => {
    setInput(null)
    setSaved(result.changed ? { text, tone: 'success' } : { text: NOT_APPLIED_SETTLEMENT, tone: 'warning' })
    written()
  }
  const openInput = (kind: InputKind) => {
    setSaved(null)
    setInput(kind)
  }
  const sendSms = () => {
    setSaved(null)
    // 번호를 모르는 손님은 번호부터 (영수증 보내기 화면과 같다) — 서버가 모른다고 답해도(NO_PHONE) 번호 칸을 연다
    if (receiptRow?.sms != null && receiptRow.sms.last4 === null) sms.openSheet()
    else void sms.send(null)
  }
  if (sealed) return <Notice tone="info">{SEALED_SETTLEMENT}</Notice>
  const canSms = smsReady && smsDevice !== false
  return (
    <View style={{ gap: SPACE.lg }}>
      {saved !== null ? <Notice tone={saved.tone}>{saved.text}</Notice> : null}
      {receiptsKnown && (canSms || onOpenReceipts !== undefined) ? (
        <View role="group" aria-label={RECEIPT_TITLE} style={{ gap: SPACE.xs }}>
          <DetailHeading>{RECEIPT_TITLE}</DetailHeading>
          <View style={{ marginHorizontal: -SPACE.xl }}>
            {canSms ? <MenuRow title={SEND_RECEIPT_SMS} busy={smsDevice === null || (sms.busy && !sms.sheet)} onPress={sendSms} /> : null}
            {!canSms && onOpenReceipts !== undefined ? <MenuRow title={OPEN_RECEIPTS} onPress={onOpenReceipts} /> : null}
          </View>
          {smsReady && smsDevice === false ? <Txt step="caption" color="textSub">{SMS_UNAVAILABLE}</Txt> : null}
          {sms.error !== null ? <Notice tone="danger" alert>{sms.error}</Notice> : null}
          {sms.photoError !== null && !sms.sheet ? <Notice tone="danger" alert>{sms.photoError}</Notice> : null}
        </View>
      ) : null}
      <View role="group" aria-label={FIX_TITLE} style={{ gap: SPACE.xs }}>
        <DetailHeading>{FIX_TITLE}</DetailHeading>
        <View style={{ marginHorizontal: -SPACE.xl }}>
          {(['payment', 'shipping', 'adjust', 'refund'] as const).map((kind) => (
            // 그날 자료를 받기 전에는 누르지 못한다 (고칠 정산 묶음을 아직 모른다)
            <MenuRow key={kind} title={INPUT_TITLE[kind]} busy={data === null} disabled={data !== null && settlement === undefined} onPress={() => openInput(kind)} />
          ))}
        </View>
      </View>
      {settlement !== undefined && settlement.records.length > 0 && names !== null ? (
        // 금액 기록 (옛 손님 정산 자세히의 "기록" — 자동 입금 확인·고친 까닭을 판매자가 다시 볼 수 있게)
        <View role="group" aria-label={RECORDS_TITLE} style={{ gap: SPACE.sm }}>
          <DetailHeading>{RECORDS_TITLE}</DetailHeading>
          {settlement.records.map((record) => {
            const amount = record.kind === 'shipping' ? `${SHIPPING_WORD[(record.mode ?? 'DEFAULT') as ShippingChoice]}${record.mode === 'FIXED' && record.amount !== null ? ` ${formatWon(record.amount)}` : ''}` : record.amount === null ? '' : formatWon(Math.abs(record.amount))
            const detail = [record.reason !== null ? storedMemoWords(record.reason) : null, record.memo !== null ? storedMemoWords(record.memo) : null, `기록한 때 ${kstShort(record.at)}`, record.buyer !== settlement.buyer ? names.name(record.buyer) : null].filter((part) => part !== null).join(' · ')
            return (
              <View key={record.seq} style={{ gap: 2 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: SPACE.sm }}>
                  <Txt step="body" weight="medium">{recordKindWord(record.kind, record.amount)}</Txt>
                  <Txt step="body" weight="medium">{amount}</Txt>
                </View>
                <Txt step="caption" color="textSub">{detail}</Txt>
              </View>
            )
          })}
        </View>
      ) : null}
      {input !== null && settlement !== undefined ? <InputSheet kind={input} name={name} settlement={settlement} remaining={remainingOf(settlement)} onClose={() => setInput(null)} onDone={done} /> : null}
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
