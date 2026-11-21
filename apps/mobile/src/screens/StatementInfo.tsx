// 정산 정보 (D-RETRO-60·61, 판매자 요청 2026-11-12 "계좌·성함·전화번호를 미리 넣는 화면이 없어서 직접 만들었다 …
// 모르면 방송 끝나자마자 팝업으로 넣어 달라고 해야 한다"): 정산서에 찍는 입금 계좌·전화번호·방송 이름과 배송비를 넣는 화면.
// - 전체 탭 "정산 정보"(쌓인 화면)와, 방송을 끝낸 직후·정산서를 처음 만들 때 뜨는 판이 같은 칸을 쓴다.
// - 판은 건너뛸 수 있다: 왼쪽 [나중에] · 오른쪽 [저장] (단추는 좌우 한 줄, D-UX4-01). 건너뛰면 정산서에서 계좌·전화번호 줄이 빠진다.
// - 배송비 기본값은 5만 원 미만 5,000원. 금액은 정수 원만 받는다(검사는 서버가 하고 그 문장을 칸 아래에 보인다).
// - 계좌번호·전화번호는 기록(로그)에 남기지 않는다.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { View } from 'react-native'
import { formatWon } from '@livejjim/core/format'
import { isApiError, put, type ApiError } from '../api/client.ts'
import { STATEMENT_SHIPPING_DEFAULT, type StatementInfo } from '../lib/broadcast-sales.ts'
import { rememberStatementInfo, useStatementInfo } from '../lib/statement-info.ts'
import { RETRY_NOW } from '../lib/words.ts'
import { BigButton, FormPage, GroupLabel, TextField, ToggleRow, Txt } from '../ui/kit/index.ts'
import { SPACE } from '../ui/kit/tokens.ts'
import { Loading, Notice } from '../ui/parts.tsx'

export const STATEMENT_INFO_TITLE = '정산 정보'
export const STATEMENT_INFO_BODY = '손님에게 보내는 정산서에 찍혀요.'
export const ASK_AFTER_END_TITLE = '정산서에 넣을 정보를\n알려 주세요'
export const ASK_BODY = '입금 계좌와 전화번호, 배송비를 정하면 정산서에 바로 찍혀요. 나중에 전체 탭의 "정산 정보"에서 고칠 수 있어요.'
export const LATER_LABEL = '나중에'
export const SAVE_LABEL = '저장'
export const SAVE_FAILED = '저장하지 못했어요. 다시 눌러 주세요.'
export const SAVED_NOTE = '저장했어요.'
export const NO_SHIPPING_NOTE = '정산서에 배송비 줄을 넣지 않아요.'
export const SHIPPING_APPLY_NOTE = '정산서에는 바로 적용돼요. 주문 탭의 날짜별 금액에는 다음 라이브 날부터 적용돼요.'
export const LOAD_FAILED = '정산 정보를 불러오지 못했어요.'

interface Draft {
  readonly bank: string
  readonly accountNumber: string
  readonly accountHolder: string
  readonly phone: string
  readonly hostName: string
  readonly charge: boolean
  readonly fee: string
  readonly freeFrom: string
}

const draftOf = (info: StatementInfo): Draft => ({
  bank: info.bank,
  accountNumber: info.accountNumber,
  accountHolder: info.accountHolder,
  phone: info.phone,
  hostName: info.hostName,
  charge: info.shipping.charge,
  // 받지 않던 판매자가 다시 켜면 기본값(5만 원 미만 5,000원)부터 보인다
  fee: String(info.shipping.charge ? info.shipping.fee : STATEMENT_SHIPPING_DEFAULT.fee),
  freeFrom: info.shipping.charge ? (info.shipping.freeFrom === null ? '' : String(info.shipping.freeFrom)) : String(STATEMENT_SHIPPING_DEFAULT.freeFrom),
})

/** 칸에 적은 글 → 정수 원 (숫자와 쉼표만). 아니면 null */
function wonOf(text: string): number | null {
  const value = text.trim()
  if (!/^\d+$/.test(value) && !/^\d{1,3}(,\d{3})+$/.test(value)) return null
  const won = Number(value.replace(/,/g, ''))
  return Number.isSafeInteger(won) ? won : null
}

/** 배송비 칸 아래 한 줄: 지금 적은 값이 정산서에 어떻게 적용되는지 */
export function shippingSummary(draft: Pick<Draft, 'charge' | 'fee' | 'freeFrom'>): string | null {
  if (!draft.charge) return NO_SHIPPING_NOTE
  const fee = wonOf(draft.fee)
  if (fee === null || fee < 1) return null
  if (draft.freeFrom.trim() === '') return `정산서마다 배송비 ${formatWon(fee)}을 더해요.`
  const free = wonOf(draft.freeFrom)
  if (free === null || free < 1) return null
  return `상품 합계가 ${formatWon(free)}보다 적으면 배송비 ${formatWon(fee)}을 더해요. ${formatWon(free)}부터는 무료예요.`
}

/** 정산 정보 칸과 저장 — 쌓인 화면과 판이 같이 쓴다. info: 받은 값(아직이면 null) */
export function useStatementInfoForm(info: StatementInfo | null, onSaved: (info: StatementInfo) => void, resetOn: unknown = 0): { readonly fields: ReactNode; readonly save: () => void; readonly busy: boolean; readonly ready: boolean } {
  const [draft, setDraft] = useState<Draft | null>(() => (info === null ? null : draftOf(info)))
  const touched = useRef(false)
  // 뒤늦게 받은 값은 판매자가 아직 손대지 않았을 때만 칸에 넣는다
  useEffect(() => {
    if (info !== null && !touched.current) setDraft(draftOf(info))
  }, [info])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  // resetOn이 바뀌면(판을 다시 열면) 적다 만 값을 버리고 받은 값으로 다시 채운다
  const lastReset = useRef(resetOn)
  useEffect(() => {
    if (Object.is(lastReset.current, resetOn)) return
    lastReset.current = resetOn
    touched.current = false
    setError(null)
    setFailed(null)
    if (info !== null) setDraft(draftOf(info))
    // info는 위 효과가 따로 본다
  }, [resetOn])
  const change = (patch: Partial<Draft>) => {
    touched.current = true
    setFailed(null)
    setDraft((current) => (current === null ? current : { ...current, ...patch }))
  }
  const save = () => {
    if (busy || draft === null) return
    setBusy(true)
    setError(null)
    setFailed(null)
    const body = {
      bank: draft.bank,
      accountNumber: draft.accountNumber,
      accountHolder: draft.accountHolder,
      phone: draft.phone,
      hostName: draft.hostName,
      // 금액 글은 서버가 정수 원으로 읽는다 — 읽지 못하면 그 칸의 문장을 돌려준다
      shipping: draft.charge ? { charge: true, fee: draft.fee, freeFrom: draft.freeFrom } : { charge: false, fee: 0, freeFrom: null },
    }
    put<{ info: StatementInfo }>('/api/statement-info', body).then(
      (result) => {
        touched.current = false
        rememberStatementInfo(result.info)
        setBusy(false)
        onSaved(result.info)
      },
      (caught: unknown) => {
        setBusy(false)
        if (isApiError(caught) && caught.problems.length > 0) setError(caught)
        else setFailed(isApiError(caught) ? caught.message : SAVE_FAILED)
      },
    )
  }
  const problem = (field: string): string | null => error?.problemFor(field)?.message ?? null
  const summary = draft === null ? null : shippingSummary(draft)
  const fields =
    draft === null ? (
      <Loading />
    ) : (
      <View style={{ gap: SPACE.xl }}>
        <View role="group" aria-label="입금 계좌" style={{ gap: SPACE.md }}>
          <GroupLabel>입금 계좌</GroupLabel>
          <TextField label="은행" value={draft.bank} placeholder="농협" maxLength={40} onChangeText={(bank) => change({ bank })} error={problem('bank')} />
          <TextField label="계좌번호" value={draft.accountNumber} placeholder="302-0000-0000-00" keyboardType="numbers-and-punctuation" autoComplete="off" maxLength={60} onChangeText={(accountNumber) => change({ accountNumber })} error={problem('accountNumber')} />
          <TextField label="예금주" value={draft.accountHolder} placeholder="김판매" maxLength={40} onChangeText={(accountHolder) => change({ accountHolder })} error={problem('accountHolder')} />
        </View>
        <View role="group" aria-label="연락처" style={{ gap: SPACE.md }}>
          <GroupLabel>연락처</GroupLabel>
          <TextField label="전화번호" value={draft.phone} placeholder="010-0000-0000" keyboardType="phone-pad" autoComplete="off" maxLength={40} help="손님이 물어볼 번호예요. 비워 두면 정산서에서 빠져요." onChangeText={(phone) => change({ phone })} error={problem('phone')} />
          <TextField label={HOST_LABEL} value={draft.hostName} placeholder="초록다육 라이브" maxLength={40} help={HOST_HELP} onChangeText={(hostName) => change({ hostName })} error={problem('hostName')} />
        </View>
        <View role="group" aria-label="배송비" style={{ gap: SPACE.md }}>
          <GroupLabel>배송비</GroupLabel>
          <ToggleRow title="배송비 받기" on={draft.charge} onChange={(charge) => change({ charge })} />
          {draft.charge ? (
            <>
              <TextField label="배송비" value={draft.fee} unit="원" keyboardType="number-pad" maxLength={12} onChangeText={(fee) => change({ fee })} error={problem('shipping.fee')} />
              <TextField label="이 금액 이상 사면 무료" value={draft.freeFrom} unit="원" keyboardType="number-pad" maxLength={14} help="비워 두면 늘 배송비를 받아요." onChangeText={(freeFrom) => change({ freeFrom })} error={problem('shipping.freeFrom')} />
            </>
          ) : null}
          {summary !== null ? <Txt color="textSub">{summary}</Txt> : null}
          <Txt step="caption" color="textSub">{SHIPPING_APPLY_NOTE}</Txt>
          {problem('shipping') !== null ? <Notice tone="danger" alert>{problem('shipping')}</Notice> : null}
        </View>
        {failed !== null ? <Notice tone="danger" alert>{failed}</Notice> : null}
      </View>
    )
  return { fields, save, busy, ready: draft !== null }
}

// 처음 한 번 묻는 판(방송을 끝낸 직후·정산서를 처음 만들 때)은 가게 이름과 합친 console/StatementSetup.tsx의 StatementSetupSheet (D-UX4-172)

/** 전체 탭 "정산 정보" 쌓인 화면 */
/** 정산서 사진 왼쪽 위 작은 글 (옛 이름 "방송 이름" — 판매자가 정산서에서 보는 자리로 찾게, D-STMT-HOST-01) */
export const HOST_LABEL = '정산서 왼쪽 위 이름'
export const HOST_HELP = '정산서 사진 왼쪽 위에 작게 찍혀요. 빼려면 칸을 비우고 저장해 주세요.'

export function StatementInfoScreen({ onBack }: { readonly onBack: () => void }) {
  const state = useStatementInfo()
  const [saved, setSaved] = useState(false)
  const form = useStatementInfoForm(state.editable ? state.info : null, () => setSaved(true))
  if (state.info !== null && !state.editable) {
    return (
      <FormPage title={STATEMENT_INFO_TITLE} description={STATEMENT_INFO_BODY} onBack={onBack} testID="statement-info-screen">
        <Notice tone="info">아직 준비 중이에요. 잠시 뒤 다시 열어 주세요.</Notice>
      </FormPage>
    )
  }
  if (state.failed) {
    return (
      <FormPage title={STATEMENT_INFO_TITLE} description={STATEMENT_INFO_BODY} onBack={onBack} testID="statement-info-screen" actions={<BigButton kind="secondary" label={RETRY_NOW} onPress={state.reload} />}>
        <Notice tone="danger" alert>{LOAD_FAILED}</Notice>
      </FormPage>
    )
  }
  return (
    <FormPage title={STATEMENT_INFO_TITLE} description={STATEMENT_INFO_BODY} onBack={onBack} testID="statement-info-screen" actions={<BigButton label={SAVE_LABEL} busy={form.busy} disabled={!form.ready} onPress={form.save} />}>
      {form.fields}
      {saved && !form.busy ? <Notice tone="success">{SAVED_NOTE}</Notice> : null}
    </FormPage>
  )
}
