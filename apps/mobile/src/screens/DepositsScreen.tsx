// 입금 확인 (D-APPX-01 — 웹 DepositsPage와 같은 규칙·문구, PAY-01·DP-0~DP-8). 실제 범위만 다룬다(리허설 없음, DP-0 4).
// 목록: 확인 필요 · 자동 확인됨·확인함 · 무시함 · 붙여넣기. 확인 필요는 사유 문장과 제안 묶음을 보이고, 고른 묶음은 확정 판에서 한 번 더 본 뒤 적는다.
// 다른 묶음은 이름으로 찾아 고른다. 처리 하나는 요청 번호 하나 — 네트워크 실패면 같은 번호로 다시 보낸다(서버가 한 번만 반영).
// 묶음 금액이 그사이 바뀌면(BUNDLE_CHANGED) 서버 문장을 보이고 목록을 새로 받는다(같은 값으로 다시 보내지 않는다).
// 입금 받는 곳(계좌 연동·휴대폰 알림)·기억한 입금자명은 "입금 받는 곳" 탭(DepositSources, D-APPX-03).
// 모양 (D-UX3-93, 홈처럼): 좌우 20 · 흰 카드, 입금 이름·금액 한 줄, 제안 묶음은 옅은 회색 줄, [무시하기]·[다른 묶음 지정]은 위아래가 아니라 좌우로.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import type { BundleView, DepositActionResult, DepositList, DepositStatus, DepositView, PastePreview, PasteSummary } from '@livejjim/web/src/api/deposit-types.ts'
import { BEFORE_SALE, DEPOSIT_STATUS_WORD, PASTE_STATE_WORD, UNREADABLE_WORD, bundleChange, bundleWords, confirmLine, depositLabel, depositName, depositTime, pasteResultWords, reasonWords, revertQuestion, sourceWords } from '@livejjim/web/src/lib/deposit-words.ts'
import { dateWords } from '@livejjim/web/src/lib/kst.ts'
import { get, isApiError, newRequestId, post, withQuery, withRetry, type ApiError } from '../api/client.ts'
import { formatWon, RETRY_NOW } from '../lib/words.ts'
import { SourcesTab } from './DepositSources.tsx'
import { useServices } from '../services.tsx'
import { Pill } from '../ui/day-pills.tsx'
import { EmptyFill, AppHeader, BigButton, BottomSheet, ButtonRow, ConfirmSheet, Icon, TextField, Txt, useKit } from '../ui/kit/index.ts'
import { RADIUS, SPACE } from '../ui/kit/tokens.ts'
import { Loading, Notice } from '../ui/parts.tsx'
import { CARD_GAP, PAGE_SIDE, SectionCard } from './order-parts.tsx'

type Tab = 'review' | 'done' | 'ignored' | 'paste' | 'sources'
const TABS: readonly { readonly key: Tab; readonly word: string }[] = [
  { key: 'review', word: '확인 필요' },
  { key: 'done', word: '자동 확인됨·확인함' },
  { key: 'ignored', word: '무시함' },
  { key: 'paste', word: '붙여넣기' },
  { key: 'sources', word: '입금 받는 곳' },
]
const STATUS_OF: Readonly<Record<Exclude<Tab, 'paste' | 'sources'>, readonly DepositStatus[]>> = { review: ['REVIEW'], done: ['AUTO_APPLIED', 'APPLIED'], ignored: ['IGNORED'] }
const BUNDLE_CHANGED_CODE = 'BUNDLE_CHANGED'

interface Flash {
  readonly text: string
  readonly tone: 'success' | 'warning' | 'danger'
}

/** 처리 하나 (요청 번호 하나): 다시 보내도 되는 실패만 같은 번호를 남긴다 — 웹 useAction과 같다 */
function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const requestId = useRef<string | null>(null)
  const run = async <T,>(path: string, body: Readonly<Record<string, unknown>> = {}, handle?: (error: ApiError) => boolean): Promise<T | null> => {
    setBusy(true)
    setError(null)
    requestId.current ??= newRequestId()
    const id = requestId.current
    try {
      const result = await withRetry(() => post<T>(path, { requestId: id, ...body }))
      requestId.current = null
      return result
    } catch (caught: unknown) {
      if (!isApiError(caught)) throw caught
      if (!caught.transient) requestId.current = null
      if (handle?.(caught) !== true) setError(caught)
      return null
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run, clear: () => setError(null) }
}

/** 입금 실시간 알림(deposit)·다시 연결이 오면 숫자를 올린다 */
function useDepositTick(): number {
  const { stream } = useServices()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const view = stream.open()
    let ready = 0
    view.addEventListener('ready', () => {
      ready++
      if (ready > 1) setTick((n) => n + 1)
    })
    view.addEventListener('deposit', () => setTick((n) => n + 1))
    return () => view.close()
  }, [stream])
  return tick
}

export function DepositsScreen({ onBack }: { readonly onBack: () => void }) {
  const { p } = useKit()
  const [tab, setTab] = useState<Tab>('review')
  const [notice, setNotice] = useState<Flash | null>(null)
  const tick = useDepositTick()
  const [review, setReview] = useState<number | null>(null)
  useEffect(() => {
    get<{ review: number }>('/api/deposits/count').then(
      (view) => setReview(view.review),
      () => undefined,
    )
  }, [tick, notice])
  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="deposits-screen">
      <AppHeader title="입금 확인" onBack={onBack} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: PAGE_SIDE, paddingTop: SPACE.sm, paddingBottom: SPACE.xxxl, gap: CARD_GAP }} keyboardShouldPersistTaps="handled">
        <View role="tablist" aria-label="입금 확인 목록" style={{ marginHorizontal: -PAGE_SIDE }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACE.sm, paddingHorizontal: PAGE_SIDE, paddingVertical: SPACE.xs }}>
            {TABS.map((item) => (
              <Pill key={item.key} on={tab === item.key} label={`${item.word}${item.key === 'review' && review !== null && review > 0 ? ` ${String(review)}` : ''}`} ariaLabel={item.word} onPress={() => { setNotice(null); setTab(item.key) }} />
            ))}
          </ScrollView>
        </View>
        {notice !== null ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
        {tab === 'paste' ? <PasteTab onNotice={setNotice} /> : tab === 'sources' ? <SourcesTab /> : <DepositTab key={tab} tab={tab} tick={tick} onNotice={setNotice} />}
      </ScrollView>
    </View>
  )
}

function DepositTab({ tab, tick, onNotice }: { readonly tab: Exclude<Tab, 'paste' | 'sources'>; readonly tick: number; readonly onNotice: (notice: Flash | null) => void }) {
  const [list, setList] = useState<readonly DepositView[] | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((n) => n + 1), [])
  useEffect(() => {
    let alive = true
    get<DepositList>(withQuery('/api/deposits', { status: STATUS_OF[tab].join(','), limit: 50 })).then(
      (view) => {
        if (!alive) return
        setList(view.deposits)
        setError(null)
      },
      (caught: unknown) => {
        if (alive && isApiError(caught)) setError(caught)
      },
    )
    return () => {
      alive = false
    }
  }, [tab, tick, version])
  if (error !== null && list === null) {
    return (
      <View style={{ gap: SPACE.sm }}>
        <Notice tone="danger" alert>{error.message}</Notice>
        <BigButton kind="secondary" label={RETRY_NOW} onPress={reload} />
      </View>
    )
  }
  if (list === null) return <Loading />
  if (list.length === 0) {
    return (
      <EmptyFill title={tab === 'review' ? '확인할 입금이 없어요' : tab === 'done' ? '확인한 입금이 없어요' : '무시한 입금이 없어요'} {...(tab === 'review' ? { body: '새 입금이 오면\n여기서 확인할 수 있어요' } : tab === 'done' ? { body: '자동 확인했거나 직접 확인한 입금이\n여기에 모여요' } : {})} />
    )
  }
  const done = (text: string, tone: Flash['tone'] = 'success') => {
    onNotice({ text, tone })
    reload()
  }
  return (
    <View style={{ gap: CARD_GAP }}>
      {list.map((deposit) => (
        <DepositCard key={deposit.no} deposit={deposit} tab={tab} onDone={done} />
      ))}
    </View>
  )
}

function DepositHead({ deposit }: { readonly deposit: DepositView }) {
  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: SPACE.sm }}>
        <Txt step="bodyLarge" weight="medium">{depositName(deposit.name)}</Txt>
        <Txt step="lead" weight="bold">{formatWon(deposit.amount)}</Txt>
      </View>
      <Txt step="caption" color="textSub">{`${depositTime(deposit.at, deposit.precision)} · ${sourceWords(deposit.source)} · ${depositLabel(deposit.no)}`}</Txt>
    </View>
  )
}

function DepositCard({ deposit, tab, onDone }: { readonly deposit: DepositView; readonly tab: Exclude<Tab, 'paste' | 'sources'>; readonly onDone: (text: string, tone?: Flash['tone']) => void }) {
  const { p, tones } = useKit()
  const action = useAction()
  const [confirming, setConfirming] = useState<BundleView | null>(null)
  const [finding, setFinding] = useState(false)
  const [asking, setAsking] = useState<'ignore' | 'revert' | null>(null)
  const label = `${depositLabel(deposit.no)} · ${depositName(deposit.name)} · ${formatWon(deposit.amount)}`
  return (
    <SectionCard label={label}>
      <DepositHead deposit={deposit} />
      {tab !== 'review' ? <Txt step="meta" weight="medium" ink={tab === 'ignored' ? tones.info.fg : tones.success.fg}>{DEPOSIT_STATUS_WORD[deposit.status]}</Txt> : null}
      {deposit.applied !== null ? <Txt step="bodyLarge" weight="book">{`${deposit.applied.buyerName} · ${dateWords(deposit.applied.date)} 묶음에 반영`}</Txt> : null}
      {tab === 'review' && deposit.review !== undefined ? (
        <>
          <Notice tone="warning">{reasonWords(deposit.review.reason, deposit.review.twin)}</Notice>
          {deposit.review.suggestions.map((bundle) => (
            <Pressable key={`${bundle.date}/${bundle.buyer}`} role="button" aria-label={`이 묶음으로 확정 — ${bundleWords(bundle)}`} onPress={() => setConfirming(bundle)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingVertical: SPACE.md, paddingHorizontal: SPACE.lg, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: pressed ? p.softPressed : p.surfaceAlt })}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt step="bodyLarge" weight="book">{bundleWords(bundle)}</Txt>
                {bundle.beforeSale ? <Txt step="caption" color="textSub">{BEFORE_SALE}</Txt> : null}
                <Txt step="caption" weight="medium" color="primaryText">이 묶음으로 확정</Txt>
              </View>
              <Icon name="chevron" color={p.textSub} size={18} />
            </Pressable>
          ))}
          {/* 좌우로 (D-UX4-01): 부정(무시하기) 왼쪽 */}
          <ButtonRow>
            <BigButton kind="outline" label="무시하기" onPress={() => setAsking('ignore')} />
            <BigButton kind="outline" label="다른 묶음 지정" onPress={() => setFinding(true)} />
          </ButtonRow>
        </>
      ) : null}
      {tab === 'done' && deposit.applied !== null ? <BigButton kind="outline" label="되돌리기" onPress={() => setAsking('revert')} /> : null}
      {tab === 'ignored' ? (
        <BigButton
          kind="outline"
          label="다시 확인 필요로"
          busy={action.busy}
          onPress={() =>
            void action.run<DepositActionResult>(`/api/deposits/${String(deposit.no)}/reopen`).then((result) => {
              if (result !== null) onDone(`${depositLabel(deposit.no)}을 확인 필요로 돌렸어요.`)
            })
          }
        />
      ) : null}
      {action.error !== null ? <Notice tone="danger" alert>{action.error.message}</Notice> : null}

      {confirming !== null ? (
        <ConfirmBundle
          deposit={deposit}
          bundle={confirming}
          onClose={() => setConfirming(null)}
          onDone={(text, tone) => {
            setConfirming(null)
            onDone(text, tone)
          }}
        />
      ) : null}
      {finding ? (
        <FindBundle
          deposit={deposit}
          onClose={() => setFinding(false)}
          onPick={(bundle) => {
            setFinding(false)
            setConfirming(bundle)
          }}
        />
      ) : null}
      <ConfirmSheet
        visible={asking === 'ignore'}
        question="이 입금을 무시할까요?"
        description={`${label}. 무시한 입금은 '무시함'에 남고 언제든 다시 확인 필요로 돌릴 수 있어요.`}
        confirmLabel="무시하기"
        busy={action.busy}
        onCancel={() => setAsking(null)}
        onConfirm={() =>
          void action.run<DepositActionResult>(`/api/deposits/${String(deposit.no)}/ignore`).then((result) => {
            setAsking(null)
            if (result !== null) onDone(`${depositLabel(deposit.no)}을 무시했어요.`)
          })
        }
      />
      <ConfirmSheet
        visible={asking === 'revert'}
        question="입금 확인을 되돌릴까요?"
        description={deposit.applied === null ? '' : revertQuestion(deposit.applied.buyerName, deposit.applied.date, deposit.amount)}
        confirmLabel="되돌리기"
        danger
        busy={action.busy}
        onCancel={() => setAsking(null)}
        onConfirm={() =>
          void action.run<DepositActionResult>(`/api/deposits/${String(deposit.no)}/revert`).then((result) => {
            setAsking(null)
            if (result !== null) onDone('입금 확인을 되돌렸어요. 같은 금액의 환불 기록을 적었어요.')
          })
        }
      />
    </SectionCard>
  )
}

function ConfirmBundle({ deposit, bundle, onClose, onDone }: { readonly deposit: DepositView; readonly bundle: BundleView; readonly onClose: () => void; readonly onDone: (text: string, tone?: Flash['tone']) => void }) {
  const { p } = useKit()
  const action = useAction()
  const [remember, setRemember] = useState(bundle.canRemember)
  const change = bundleChange(bundle)
  const send = async () => {
    const result = await action.run<DepositActionResult>(
      `/api/deposits/${String(deposit.no)}/confirm`,
      { date: bundle.date, buyer: bundle.buyer, remaining: bundle.remaining, remember: bundle.canRemember && remember },
      (error) => {
        if (error.code !== BUNDLE_CHANGED_CODE) return false
        onDone(error.message, 'warning')
        return true
      },
    )
    if (result === null) return
    const before = result.deposit.applied?.beforeSale === true ? ` ${BEFORE_SALE}` : ''
    onDone(`${depositLabel(deposit.no)}을 ${bundle.name} 묶음에 적었어요.${before}`)
  }
  return (
    <BottomSheet
      visible
      onClose={onClose}
      title="입금 확정"
      actions={
        <>
          <BigButton kind="secondary" label="닫기" onPress={onClose} />
          <BigButton label="확정하기" busy={action.busy} onPress={() => void send()} />
        </>
      }
    >
      <View style={{ gap: SPACE.md }}>
        <DepositHead deposit={deposit} />
        <Txt step="bodyLarge" weight="medium">{confirmLine(bundle, deposit.amount)}</Txt>
        {change !== null && change.warning ? <Notice tone="warning">과입금이 생겨요. 확정한 뒤 정산에서 환불을 적어 주세요.</Notice> : null}
        {bundle.beforeSale ? <Notice tone="warning">{BEFORE_SALE}</Notice> : null}
        {bundle.canRemember ? (
          <Pressable role="checkbox" aria-checked={remember} aria-label="이 입금자명을 이 손님 이름으로 기억하기" onPress={() => setRemember((value) => !value)} style={({ pressed }) => ({ minHeight: 48, justifyContent: 'center', borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
            <Txt>{`${remember ? '☑' : '☐'} 다음부터 이 입금자명을 이 손님으로 알아보기`}</Txt>
          </Pressable>
        ) : null}
        {action.error !== null ? <Notice tone="danger" alert>{action.error.message}</Notice> : null}
      </View>
    </BottomSheet>
  )
}

function FindBundle({ deposit, onClose, onPick }: { readonly deposit: DepositView; readonly onClose: () => void; readonly onPick: (bundle: BundleView) => void }) {
  const { p } = useKit()
  const [query, setQuery] = useState('')
  const [bundles, setBundles] = useState<readonly BundleView[] | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  useEffect(() => {
    let alive = true
    const timer = setTimeout(() => {
      get<{ bundles: BundleView[] }>(withQuery(`/api/deposits/${String(deposit.no)}/bundles`, { q: query.trim() === '' ? undefined : query.trim() })).then(
        (view) => {
          if (!alive) return
          setBundles(view.bundles)
          setError(null)
        },
        (caught: unknown) => {
          if (alive && isApiError(caught)) setError(caught)
        },
      )
    }, 250)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [deposit.no, query])
  return (
    <BottomSheet visible onClose={onClose} title="다른 묶음 지정">
      <View style={{ gap: SPACE.md }}>
        <DepositHead deposit={deposit} />
        <TextField label="손님 이름으로 찾기" value={query} onChangeText={setQuery} autoCorrect={false} />
        {error !== null ? <Notice tone="danger" alert>{error.message}</Notice> : null}
        {bundles === null && error === null ? <Loading /> : null}
        {bundles !== null && bundles.length === 0 ? <Txt color="textSub">맞는 묶음이 없어요.</Txt> : null}
        {bundles?.map((bundle) => (
          <Pressable key={`${bundle.date}/${bundle.buyer}`} role="button" aria-label={`고르기 — ${bundleWords(bundle)}`} onPress={() => onPick(bundle)} style={({ pressed }) => ({ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingVertical: SPACE.sm, paddingHorizontal: SPACE.sm, marginHorizontal: -SPACE.sm, borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
            <View style={{ flex: 1 }}>
              <Txt step="bodyLarge" weight="book">{bundleWords(bundle)}</Txt>
            </View>
            <Icon name="chevron" color={p.textSub} size={18} />
          </Pressable>
        ))}
      </View>
    </BottomSheet>
  )
}

/** 은행 앱에서 복사한 입금 내역 붙여넣기 → 미리 보기 → 넣기 (DP-2) */
function PasteTab({ onNotice }: { readonly onNotice: (notice: Flash | null) => void }) {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<PastePreview | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const insert = useAction()
  const look = async () => {
    setBusy(true)
    setError(null)
    try {
      setPreview(await post<PastePreview>('/api/deposits/paste/preview', { text }))
    } catch (caught: unknown) {
      if (isApiError(caught)) setError(caught)
    } finally {
      setBusy(false)
    }
  }
  const send = async () => {
    const summary = await insert.run<PasteSummary>('/api/deposits/paste', { text })
    if (summary === null) return
    setText('')
    setPreview(null)
    onNotice({ text: pasteResultWords(summary), tone: 'success' })
  }
  const fresh = preview?.rows.filter((row) => row.state === 'NEW').length ?? 0
  return (
    <View style={{ gap: CARD_GAP }}>
      <SectionCard>
        <Txt step="meta" color="textSub">은행 앱의 입금 내역을 복사해 붙여 넣으면, 맞는 손님은 자동으로 확인돼요.</Txt>
        <TextField
          label="입금 내역"
          value={text}
          onChangeText={(next) => {
            setText(next)
            setPreview(null)
            insert.clear()
          }}
          multiline
          numberOfLines={6}
          autoCorrect={false}
          placeholder="2026-10-18 21:03 입금 14,000 김영희"
        />
        <BigButton kind="outline" label="미리 보기" busy={busy} disabled={text.trim() === ''} onPress={() => void look()} />
        {error !== null ? <Notice tone="danger" alert>{error.message}</Notice> : null}
      </SectionCard>
      {preview !== null ? (
        <SectionCard title="미리 보기" label="미리 보기">
          {preview.rows.map((row) => (
            <Txt key={row.line} step="body">{`${String(row.line)}줄 · ${depositTime(row.at, row.precision)} · ${formatWon(row.amount)} · ${depositName(row.name)} · ${PASTE_STATE_WORD[row.state]}`}</Txt>
          ))}
          {preview.unreadable.map((row) => (
            <Txt key={`u${String(row.line)}`} color="textSub">{`${String(row.line)}줄 · ${UNREADABLE_WORD[row.why]}`}</Txt>
          ))}
          {preview.skipped.length > 0 ? <Txt color="textSub">{`입금이 아닌 줄 ${String(preview.skipped.length)}개는 넣지 않아요.`}</Txt> : null}
          <BigButton label={`새 입금 ${String(fresh)}건 넣기`} disabled={fresh === 0} busy={insert.busy} onPress={() => void send()} />
          {insert.error !== null ? <Notice tone="danger" alert>{insert.error.message}</Notice> : null}
        </SectionCard>
      ) : null}
    </View>
  )
}
