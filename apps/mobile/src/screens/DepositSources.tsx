// 입금 받는 곳 (D-APPX-03 — 웹 DepositSources와 같은 규칙·문구, N3 DP-1, D-N3-09·12, AC-N3-14~16·25·46, SMS3 D-DEP2-01).
// 원천 목록: 표시 이름·종류·계좌 끝 4자리·켜짐/꺼짐·주기·마지막으로 받아 온 때·마지막 오류. 받아 오기가 있는 원천은 "지금 받아 오기"·주기(1~5분)·켜기/끄기,
// 휴대폰 알림 원천은 켜기/끄기만. 계좌조회(팝빌) 연결: 표시 이름·사업자번호·은행·계좌번호 — 계좌 비밀번호는 받지 않는다.
// "팝빌에서 계좌 등록·관리"는 서버가 준 https 주소를 기기 브라우저로 연다. 사업자번호·계좌번호는 보낸 뒤 칸을 비운다(서버도 끝 4자리만).
// 기억한 입금자명 목록과 "지우기"(한 번 더 묻기).
// 모양 (D-UX3-93, 홈처럼): 흰 카드 안 회색 묶음 이름, 원천마다 [끄기]·[지금 받아 오기]는 좌우로, 팝빌 관리·지우기는 작은 단추, 설명 글은 짧게.
import { useState } from 'react'
import { View } from 'react-native'
import type { RememberedName, SourceView, SourcesView } from '@livejjim/web/src/api/deposit-types.ts'
import { BANKS, SOURCE_KIND_WORD, bankName, intervalWords } from '@livejjim/web/src/lib/deposit-words.ts'
import { kstShort } from '@livejjim/web/src/lib/kst.ts'
import { del, isApiError, patch, post, type ApiError } from '../api/client.ts'
import { openExternal } from '../lib/open-web.ts'
import { useCachedGet } from '../lib/cached-get.ts'
import { RETRY_NOW } from '../lib/words.ts'
import { Pill } from '../ui/day-pills.tsx'
import { EmptyFill, BigButton, ButtonRow, ConfirmSheet, TextField, Txt, useKit } from '../ui/kit/index.ts'
import { SPACE } from '../ui/kit/tokens.ts'
import { Loading, Notice } from '../ui/parts.tsx'
import { CARD_GAP, ChipButton, SectionCard } from './order-parts.tsx'

export const POPBILL_NOT_READY = '계좌 연동은 아직 준비 중이에요. 붙여넣기로 넣어 주세요.'
export const NO_PASSWORD = '계좌 비밀번호는 여기에 적지 않아요. 팝빌 계좌 관리에서 등록해요.'
export const MANAGE_WORDS = '팝빌에서 계좌 등록·관리'
export const PHONE_SOURCE_HINT = '판매자 휴대폰의 은행 앱 알림·은행 문자로 받아요. 끄면 은행 알림을 받지 않아요(손님 문자찜은 그대로 받아요).'
const INTERVALS = [1, 2, 3, 4, 5] as const

/** 팝빌 계좌 관리 주소를 받아 기기 브라우저로 (https만) */
async function openManage(body: Readonly<Record<string, unknown>>): Promise<ApiError | null> {
  try {
    const { url } = await post<{ url: string }>('/api/deposits/popbill/manage-url', body)
    if (/^https:\/\//.test(url)) await openExternal(url)
    return null
  } catch (caught: unknown) {
    if (!isApiError(caught)) throw caught
    return caught
  }
}

export function SourcesTab() {
  // 기억해 둔 목록을 바로 보이고 뒤에서 다시 받는다 (D-UX4-77) — 다시 받다 실패하면 보이던 목록 그대로
  const { data: view, error, reload } = useCachedGet<SourcesView>('/api/deposits/sources')
  return (
    <View style={{ gap: CARD_GAP }}>
      <SectionCard title="입금 받는 곳" label="입금 받는 곳">
        {error !== null ? (
          <View style={{ gap: SPACE.sm }}>
            <Notice tone="danger" alert>{error.message}</Notice>
            <BigButton kind="secondary" label={RETRY_NOW} onPress={() => void reload()} />
          </View>
        ) : null}
        {view === null && error === null ? <Loading /> : null}
        {view !== null && view.sources.length === 0 ? <EmptyFill title="아직 입금 받는 곳이 없어요" body={'붙여넣기로 넣거나\n계좌를 연결해 주세요'} /> : null}
        {view?.sources.map((source, index) => (
          <View key={source.id} style={{ gap: SPACE.md }}>
            {index > 0 ? <Divider /> : null}
            <SourceItem source={source} onChanged={() => void reload()} />
          </View>
        ))}
      </SectionCard>
      <SectionCard title="계좌 연결" label="계좌 연결">
        {view === null ? null : view.popbill ? <AddPopbill onAdded={() => void reload()} /> : <Notice tone="info">{POPBILL_NOT_READY}</Notice>}
        {view?.testMode === true ? <AddFake onAdded={() => void reload()} /> : null}
      </SectionCard>
      <RememberedNames />
    </View>
  )
}

/** 같은 카드 안 원천 사이 옅은 선 */
function Divider() {
  const { p } = useKit()
  return <View aria-hidden style={{ height: 1, backgroundColor: p.border }} />
}

function SourceItem({ source, onChanged }: { readonly source: SourceView; readonly onChanged: () => void }) {
  const { p, tones } = useKit()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const act = async (send: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await send()
      onChanged()
    } catch (caught: unknown) {
      if (isApiError(caught)) setError(caught)
    } finally {
      setBusy(false)
    }
  }
  const kind = SOURCE_KIND_WORD[source.kind] ?? ''
  const phone = source.kind === 'PHONE'
  const path = `/api/deposits/sources/${encodeURIComponent(source.id)}`
  // 이름 아래 한 줄: 종류 · 은행 계좌 끝 4자리 · 주기 (옛: 이름 옆에 이어 붙인 글들)
  const about = [source.label.trim() === kind ? null : kind, source.accountLast4 !== null ? `${bankName(source.bank)} 계좌 끝 ${source.accountLast4}` : null, source.fetchable ? intervalWords(source.intervalMin) : null].filter((part) => part !== null && part !== '').join(' · ')
  return (
    <View style={{ gap: SPACE.sm }} role="group" aria-label={`입금 받는 곳 ${source.label}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt step="bodyLarge" weight="medium">{source.label}</Txt>
          {about === '' ? null : <Txt step="caption" color="textSub">{about}</Txt>}
        </View>
        {source.fetchable || phone ? <Txt step="meta" weight="medium" ink={source.enabled ? tones.success.fg : p.textSub}>{source.enabled ? '켜짐' : '꺼짐'}</Txt> : null}
      </View>
      {phone ? <Txt step="caption" color="textSub">{PHONE_SOURCE_HINT}</Txt> : null}
      {!phone && source.fetchable ? (
        <Txt step="caption" color="textSub">{`${source.lastFetchedAt === null ? '아직 받아 오지 않았어요' : `마지막으로 받아 온 때 ${kstShort(source.lastFetchedAt)}`}${source.lastNew !== null && source.lastFetchedAt !== null ? ` · 새 입금 ${String(source.lastNew)}건` : ''}${source.fetching ? ' · 받아 오는 중' : ''}`}</Txt>
      ) : null}
      {!phone && !source.fetchable ? <Txt step="caption" color="textSub">받아 오기가 없어요. "붙여넣기"에서 넣어요.</Txt> : null}
      {source.lastError !== null ? <Notice tone="warning">{`${source.lastError}${source.lastErrorAt !== null ? ` (${kstShort(source.lastErrorAt)})` : ''}`}</Notice> : null}
      {source.fetchable ? (
        <View style={{ gap: SPACE.xs }}>
          <Txt step="caption" color="textSub">받아 오는 주기</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs }}>
            {INTERVALS.map((minutes) => (
              <Pill key={minutes} on={source.intervalMin === minutes} label={intervalWords(minutes)} ariaLabel={`${source.label} 받아 오는 주기 ${intervalWords(minutes)}`} onPress={() => (busy ? undefined : void act(() => patch(path, { intervalMin: minutes })))} />
            ))}
          </View>
        </View>
      ) : null}
      {/* 좌우로 (D-UX4-01): 끄기·켜기 왼쪽, 지금 받아 오기 오른쪽 */}
      {source.fetchable || phone ? (
        <ButtonRow>
          <BigButton kind="outline" label={source.enabled ? '끄기' : '켜기'} ariaLabel={`${source.label} ${source.enabled ? '끄기' : '켜기'}`} busy={busy} onPress={() => void act(() => patch(path, { enabled: !source.enabled }))} />
          {source.fetchable ? <BigButton kind="outline" label="지금 받아 오기" busy={busy} disabled={!source.enabled} onPress={() => void act(() => post(`${path}/fetch`, {}))} /> : null}
        </ButtonRow>
      ) : null}
      {source.kind === 'POPBILL' ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <ChipButton label={MANAGE_WORDS} onPress={() => void openManage({ source: source.id }).then(setError)} />
        </View>
      ) : null}
      {error !== null ? <Notice tone="danger" alert>{error.message}</Notice> : null}
    </View>
  )
}

function AddPopbill({ onAdded }: { readonly onAdded: () => void }) {
  const [label, setLabel] = useState('')
  const [corpNum, setCorpNum] = useState('')
  const [bank, setBank] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [added, setAdded] = useState<string | null>(null)
  const submit = async () => {
    setBusy(true)
    setError(null)
    setAdded(null)
    try {
      const source = await post<SourceView>('/api/deposits/sources', { kind: 'POPBILL', label: label.trim(), corpNum, bank, accountNumber })
      setAdded(`${source.label} 계좌를 연결했어요. 팝빌 계좌 관리에서 빠른조회 등록을 마쳐야 내역을 받아 와요.`)
      setLabel('')
      setCorpNum('')
      setBank('')
      setAccountNumber('')
      onAdded()
    } catch (caught: unknown) {
      if (isApiError(caught)) setError(caught)
    } finally {
      setBusy(false)
    }
  }
  return (
    <View style={{ gap: SPACE.sm }}>
      <Notice tone="info">{NO_PASSWORD}</Notice>
      <TextField label="표시 이름" value={label} onChangeText={setLabel} maxLength={20} placeholder="국민 1234" error={error?.problemFor('label')?.message ?? null} />
      <TextField label="사업자번호" value={corpNum} onChangeText={setCorpNum} keyboardType="number-pad" autoComplete="off" error={error?.problemFor('corpNum')?.message ?? null} />
      <Txt step="caption" color="textSub">은행</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs }}>
        {BANKS.map((item) => (
          <Pill key={item.code} on={bank === item.code} label={item.name} ariaLabel={`은행 ${item.name}`} onPress={() => setBank(item.code)} />
        ))}
      </View>
      {error?.problemFor('bank') !== undefined ? <Notice tone="danger" alert>{error.problemFor('bank')?.message}</Notice> : null}
      <TextField label="계좌번호" value={accountNumber} onChangeText={setAccountNumber} keyboardType="number-pad" autoComplete="off" error={error?.problemFor('accountNumber')?.message ?? null} />
      <BigButton label={busy ? '보내는 중…' : '계좌 연결'} busy={busy} onPress={() => void submit()} />
      <View style={{ alignSelf: 'center' }}>
        <ChipButton label={MANAGE_WORDS} onPress={() => void openManage({ corpNum }).then(setError)} />
      </View>
      {added !== null ? <Notice tone="success">{added}</Notice> : null}
      {error !== null && error.problems.length === 0 ? <Notice tone="danger" alert>{error.message}</Notice> : null}
    </View>
  )
}

function AddFake({ onAdded }: { readonly onAdded: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const add = async () => {
    setBusy(true)
    setError(null)
    try {
      await post('/api/deposits/sources', { kind: 'FAKE' })
      onAdded()
    } catch (caught: unknown) {
      if (isApiError(caught)) setError(caught)
    } finally {
      setBusy(false)
    }
  }
  return (
    <View style={{ gap: SPACE.sm }}>
      <Txt step="caption" color="textSub">시험 모드 서버예요. 시험용 입금 받는 곳은 실제 계좌가 아니에요.</Txt>
      <View style={{ alignSelf: 'flex-start' }}>
        <ChipButton label="시험용 입금 받는 곳 추가" busy={busy} onPress={() => void add()} />
      </View>
      {error !== null ? <Notice tone="danger" alert>{error.message}</Notice> : null}
    </View>
  )
}

function RememberedNames() {
  // 기억해 둔 목록을 바로 보이고 뒤에서 다시 받는다 (D-UX4-77)
  const { data, error: loadError, reload } = useCachedGet<{ names: RememberedName[] }>('/api/deposits/names')
  const names: readonly RememberedName[] | null = data?.names ?? null
  const [actionError, setActionError] = useState<ApiError | null>(null)
  const error = actionError ?? loadError
  const [forgetting, setForgetting] = useState<RememberedName | null>(null)
  const [busy, setBusy] = useState(false)
  const forget = async (item: RememberedName) => {
    setBusy(true)
    setActionError(null)
    try {
      await del(`/api/deposits/names/${String(item.id)}`, {})
      setForgetting(null)
      void reload()
    } catch (caught: unknown) {
      if (isApiError(caught)) setActionError(caught)
    } finally {
      setBusy(false)
    }
  }
  return (
    <SectionCard title="기억한 입금자명" label="기억한 입금자명">
      <Txt step="caption" color="textSub">같은 입금자명·같은 금액이 오면 그 손님 묶음으로 자동 확인해요.</Txt>
      {error !== null ? <Notice tone="danger" alert>{error.message}</Notice> : null}
      {names !== null && names.length === 0 ? <Txt color="textSub">기억한 입금자명이 없어요.</Txt> : null}
      {names?.map((item) => (
        <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
          <View style={{ flex: 1 }}>
            <Txt step="bodyLarge" weight="book">{`${item.name} → ${item.buyerName}`}</Txt>
          </View>
          <ChipButton label="지우기" ariaLabel={`${item.name} 지우기`} onPress={() => setForgetting(item)} />
        </View>
      ))}
      <ConfirmSheet
        visible={forgetting !== null}
        question="기억한 입금자명 지우기"
        description={forgetting === null ? '' : `"${forgetting.name}" → ${forgetting.buyerName}. 이 입금자명을 지울까요? 지운 뒤에는 이 입금자명으로 자동 확인하지 않아요. 이미 적은 입금 기록은 그대로예요.`}
        confirmLabel="지우기"
        danger
        busy={busy}
        onCancel={() => setForgetting(null)}
        onConfirm={() => {
          if (forgetting !== null) void forget(forgetting)
        }}
      />
    </SectionCard>
  )
}
