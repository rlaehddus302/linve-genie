// 구매자 (D-APPX-03 — 웹 BuyersPage와 같은 규칙·문구, BUY-01 AC2, BUY-02~04, R-11, D-090·D-091·D-098·D-100).
// 실제 방송 날짜를 고르면 그날 확정 찜이 있는 지금의 구매자(“찜 없는 구매자도 보기”로 넓힘)와 찾기. 이름은 화면 공통 이름 표기(BuyerNames).
// 자세히: 표시 이름·이력·뒤 4자리·채널 끝 4자리·차단·합친 구매자, 확정 상품과 합계, 합계에 들지 않는 찜, 그날 정산 요약.
// 합치기: 상대를 찾아 고르면 서버가 코어 previewMerge로 계산한 미리 보기를 받아 낱말로만 바꾼다(D-100). 막혔으면 까닭만, 아니면 사유를 골라 합친다.
// 떼어 내기는 사유와 함께 바로, 차단·차단 풀기는 사유와 함께 5초 뒤(되돌리기 — 방송 화면과 같은 조치). 봉인한 날짜는 볼 수만 있다.
// 전화번호는 뒤 4자리만 보인다(원문은 저장하지 않는다, D-073). "문자찜(확인 필요)" 구매자는 위에 "누구의 문자인지 찾아 합쳐 주세요."
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import type { Buyer, WriteResult } from '@livejjim/web/src/api/types.ts'
import type { UndoItem, UndoQueue } from '@livejjim/web/src/lib/undo-queue.ts'
import { UndoStrip, noItems, noSubscribe, useUndoQueue } from '../lib/host-queue.tsx'
import { get, isApiError, newRequestId, post, withQuery, withRetry, type ApiError } from '../api/client.ts'
import { UNKNOWN_SMS_DISPLAY, buyerList, channelTail, claimsOf, defaultInto, distinguishWords, isActive, isUnknownSms, mergeWords, sameNameCounts, searchBuyers, settlementOf, splitProductKey, type BuyerSort, type MergePreviewView } from '../lib/buyers.ts'
import { useDayScope } from '../lib/day-scope.ts'
import { BuyerNames, claimWord } from '../lib/derive.ts'
import type { ScopeData } from '../lib/scope-data.ts'
import { QUICK_REASONS } from '@livejjim/web/src/lib/words.ts'
import { formatWon, PAYMENT_WORD, RETRY_NOW } from '../lib/words.ts'
import { DayPills, Pill, useRealDays } from '../ui/day-pills.tsx'
import { EmptyFill, AppHeader, BigButton, BottomSheet, ButtonRow, Icon, TextField, Txt, useKit } from '../ui/kit/index.ts'
import { RADIUS, SPACE } from '../ui/kit/tokens.ts'
import { Loading, Notice } from '../ui/parts.tsx'
import { CardEmpty, CheckText, InfoCard, InfoRow, Initial, listRowStyle, MiniTag, SearchField, TextButton, TextChoices } from './customer-parts.tsx'

export const MERGE_REASONS: readonly string[] = ['같은 사람', '같은 집 배송']
export const UNMERGE_REASONS: readonly string[] = ['잘못 합침', '따로 배송']
export const MERGED_NOTICE = '합쳤어요'
export const UNMERGED_NOTICE = '떼어 냈어요'
export const UNKNOWN_SMS_GUIDE = '누구의 문자인지 찾아 합쳐 주세요.'
export const SEALED_VIEW_ONLY = '30일이 지나 잠긴 날짜라 볼 수만 있어요.'
export const REASON_REQUIRED = '사유를 적어 주세요.'
export const blockWarning = (rehearsal: boolean): string => {
  const base = '차단하면 이 사람의 대기·보류 찜이 모두 거절되고 다시 풀어도 돌아오지 않아요. 1등 찜은 그대로예요.'
  return rehearsal ? base : `${base} 다음 날짜 방송에서도 차단돼요.`
}
const PAGE = 100

const productLabel = (data: ScopeData) => (broadcast: string, no: number): string => {
  const many = data.broadcasts.size > 1
  const title = data.broadcasts.get(broadcast)?.title
  return many && title !== undefined ? `${title} ${String(no)}번` : `${String(no)}번`
}

export function BuyersScreen({ onBack, initialDate }: { readonly onBack: () => void; readonly initialDate?: string }) {
  const { p } = useKit()
  const { days, date, setDate, error } = useRealDays(initialDate)
  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="buyers-screen">
      <AppHeader title="구매자" onBack={onBack} />
      {/* 홈처럼 (D-UX3-95): 옆 여백 20 · 묶음 사이 16 */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SPACE.xl, paddingTop: SPACE.xs, paddingBottom: SPACE.xxxl, gap: SPACE.lg }} keyboardShouldPersistTaps="handled">
        {error !== null ? <Notice tone="danger" alert>{error.message}</Notice> : null}
        {days === null && error === null ? <Loading /> : null}
        {days !== null && days.length === 0 ? <EmptyFill title="아직 판매 기록이 없어요" body={'실제 방송에서 찜이 정해지면\n여기에 모여요'} /> : null}
        {days !== null ? <DayPills days={days} date={date} onPick={setDate} /> : null}
        {date !== null ? <BuyersDay key={date} date={date} /> : null}
      </ScrollView>
    </View>
  )
}

const SORT_WORDS: Readonly<Record<BuyerSort, string>> = { name: '이름 순', total: '합계 큰 순' }

function BuyersDay({ date }: { readonly date: string }) {
  const { p } = useKit()
  const { data, error, reload } = useDayScope(date)
  const [all, setAll] = useState(false)
  const [sort, setSort] = useState<BuyerSort>('name')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [limit, setLimit] = useState(PAGE)
  const queue = useUndoQueue()
  const items = useSyncExternalStore(queue?.subscribe ?? noSubscribe, queue?.getSnapshot ?? noItems)
  const names = useMemo(() => (data === null ? null : new BuyerNames(data.buyers, data.claims)), [data])
  const counts = useMemo(() => (data === null ? new Map<string, number>() : sameNameCounts(data.buyers)), [data])
  if (data === null || names === null) {
    return error !== null ? (
      <View style={{ gap: SPACE.xs }}>
        <Notice tone="danger" alert>{error.message}</Notice>
        <TextButton label={RETRY_NOW} onPress={reload} />
      </View>
    ) : (
      <Loading />
    )
  }
  const command = async (event: Readonly<Record<string, unknown>>, requestId: string = newRequestId()): Promise<WriteResult> => {
    const result = await withRetry(() => post<WriteResult>(withQuery('/api/events', { date, rehearsal: false }), { requestId, ...event }))
    reload()
    return result
  }
  const opened = open === null ? undefined : data.buyers.get(open)
  if (opened !== undefined) {
    return <BuyerDetail data={data} names={names} counts={counts} buyer={opened} queue={queue} items={items} command={command} onClose={() => setOpen(null)} onOpen={setOpen} />
  }
  const term = search.trim()
  const list = term === '' ? buyerList(data.buyers, { all, sort }) : [...new Map(searchBuyers(data.buyers, term).map((hit) => [hit.current.id, hit.current])).values()]
  return (
    <View style={{ gap: SPACE.md }}>
      {data.sealed ? <Notice tone="info">{SEALED_VIEW_ONLY}</Notice> : null}
      <SearchField label="구매자 찾기" value={search} onChangeText={setSearch} placeholder="닉네임·뒤 4자리로 찾기" />
      {/* 정렬·넓히기는 알약 대신 글자로 한 줄 (D-UX3-95) */}
      <View style={{ gap: SPACE.xs }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: -SPACE.xs }}>
          <CheckText label="찜 없는 구매자도 보기" on={all} onPress={() => setAll((on) => !on)} />
          <TextChoices<BuyerSort> label="정렬" keys={['name', 'total']} value={sort} word={(key) => SORT_WORDS[key]} spoken={(key) => SORT_WORDS[key]} onPick={setSort} />
        </View>
        <View role="group" aria-label="구매자 목록" style={{ backgroundColor: p.surface, borderRadius: RADIUS.xl, borderCurve: 'continuous', paddingVertical: SPACE.sm }}>
          {list.length > 0 ? (
            <View style={{ paddingHorizontal: SPACE.xl, paddingTop: SPACE.sm, paddingBottom: SPACE.xs }}>
              <Txt step="body" color="textSub" role="heading" aria-level={2}>{`구매자 ${String(list.length)}명`}</Txt>
            </View>
          ) : (
            <CardEmpty>{term === '' ? '그날 1등 찜이 있는 구매자가 없어요.' : '찾는 구매자가 없어요.'}</CardEmpty>
          )}
          {list.slice(0, limit).map((buyer) => (
            <BuyerRow key={buyer.id} buyer={buyer} name={names.name(buyer.id)} extra={distinguishWords(buyer, counts)} onPress={() => setOpen(buyer.id)} />
          ))}
          {list.length > limit ? <TextButton label="더 보기" color="textSub" align="stretch" onPress={() => setLimit((n) => n + PAGE)} /> : null}
        </View>
      </View>
    </View>
  )
}

function BuyerRow({ buyer, name, extra, onPress }: { readonly buyer: Buyer; readonly name: string; readonly extra: readonly string[]; readonly onPress: () => void }) {
  const { p } = useKit()
  const label = `${name}${extra.length > 0 ? ` · ${extra.join(' · ')}` : ''} · 상품 ${String(buyer.items.length)}개 · ${formatWon(buyer.subtotal)}`
  return (
    // 토스 연락처처럼 (D-UX3-95): 첫 글자 동그라미 · 이름(+꼬리표)과 구별 낱말 · 오른쪽에 합계와 상품 수
    <Pressable role="button" aria-label={label} onPress={onPress} style={({ pressed }) => listRowStyle(p, pressed)}>
      <Initial name={name} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SPACE.sm }}>
          <Txt step="bodyLarge" weight="medium">{name}</Txt>
          {isUnknownSms(buyer) ? <MiniTag tone="warning">확인 필요</MiniTag> : null}
          {buyer.blocked ? <MiniTag tone="danger">차단</MiniTag> : null}
        </View>
        {extra.length > 0 ? <Txt step="caption" color="textSub">{extra.join(' · ')}</Txt> : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Txt step="bodyLarge" weight="book">{formatWon(buyer.subtotal)}</Txt>
        <Txt step="caption" color="textSub">{`상품 ${String(buyer.items.length)}개`}</Txt>
      </View>
    </Pressable>
  )
}

type Ask = { readonly kind: 'merge' } | { readonly kind: 'unmerge'; readonly from: string } | { readonly kind: 'block'; readonly block: boolean }

function BuyerDetail({ data, names, counts, buyer, queue, items, command, onClose, onOpen }: {
  readonly data: ScopeData
  readonly names: BuyerNames
  readonly counts: ReadonlyMap<string, number>
  readonly buyer: Buyer
  readonly queue: UndoQueue | null
  readonly items: readonly UndoItem[]
  readonly command: (event: Readonly<Record<string, unknown>>, requestId?: string) => Promise<WriteResult>
  readonly onClose: () => void
  readonly onOpen: (id: string) => void
}) {
  const { p } = useKit()
  const [ask, setAsk] = useState<Ask | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const name = names.name(buyer.id)
  const claims = claimsOf(data, buyer.current)
  const confirmed = claims.filter((claim) => claim.status === 'CONFIRMED')
  const others = claims.filter((claim) => claim.status !== 'CONFIRMED')
  const settlement = settlementOf(data, buyer.current)
  const unknown = isUnknownSms(buyer)
  const sealed = data.sealed
  const label = productLabel(data)
  return (
    <View style={{ gap: SPACE.lg }}>
      {/* 큰 회색 단추 대신 작은 ‹ 글자 단추 (D-UX3-95) */}
      <Pressable role="button" aria-label="구매자 목록으로" onPress={onClose} hitSlop={4} style={({ pressed }) => ({ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 40, paddingRight: SPACE.md, paddingLeft: SPACE.xs, marginLeft: -SPACE.sm, borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
        <Icon name="back" size={20} color={p.textSub} />
        <Txt step="body" weight="medium" color="textSub">구매자 목록</Txt>
      </Pressable>
      {queue !== null ? <UndoStrip items={items} queue={queue} /> : null}
      {notice !== null ? <Notice tone="success">{notice}</Notice> : null}
      {unknown ? <Notice tone="warning">{UNKNOWN_SMS_GUIDE}</Notice> : null}
      <InfoCard label={`${name} 자세히`}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingBottom: SPACE.sm }}>
          <Initial name={name} size={48} />
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SPACE.sm }}>
              <Txt step="title" weight="bold">{name}</Txt>
              {unknown ? <MiniTag tone="warning">확인 필요</MiniTag> : null}
              {buyer.blocked ? <MiniTag tone="danger">차단</MiniTag> : null}
            </View>
            {distinguishWords(buyer, counts).length > 0 ? <Txt step="caption" color="textSub">{distinguishWords(buyer, counts).join(' · ')}</Txt> : null}
          </View>
        </View>
        <InfoRow label="종류" value={buyer.kind === 'sms' ? '문자찜' : '유튜브'} spoken={`종류: ${buyer.kind === 'sms' ? '문자찜' : '유튜브'}`} />
        {buyer.nameHistory.length > 1 ? <InfoRow label={buyer.kind === 'sms' ? '메모 이력' : '닉네임 이력'} value={buyer.nameHistory.join(' → ')} spoken={`${buyer.kind === 'sms' ? '메모 이력' : '닉네임 이력'}: ${buyer.nameHistory.join(' → ')}`} /> : null}
        {buyer.phoneLast4 !== null ? <InfoRow label="전화번호" value={`뒤 4자리 ${buyer.phoneLast4}`} spoken={`전화번호: 뒤 4자리 ${buyer.phoneLast4}`} /> : null}
        {buyer.kind === 'youtube' ? <InfoRow label="채널" value={`끝 4자리 ${channelTail(buyer)}`} spoken={`채널: 끝 4자리 ${channelTail(buyer)}`} /> : null}
        <InfoRow label="차단" value={buyer.blocked ? '차단' : '아니요'} spoken={`차단: ${buyer.blocked ? '차단' : '아니요'}`} />
        {buyer.merged.length > 0 ? (
          <View style={{ gap: 2, paddingTop: SPACE.sm }}>
            <Txt step="body" color="textSub">합친 구매자</Txt>
            {buyer.merged.map((id) => (
              <View key={id} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, minHeight: 40 }}>
                <View style={{ flex: 1 }}>
                  <Txt step="bodyLarge" weight="book">{names.name(id)}</Txt>
                </View>
                {!sealed && data.buyers.get(id)?.mergedInto === buyer.id ? (
                  <View style={{ marginRight: -SPACE.md }}>
                    <TextButton label="떼어 내기" color="textSub" ariaLabel={`${names.name(id)} 떼어 내기`} onPress={() => setAsk({ kind: 'unmerge', from: id })} />
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}
        {buyer.mergedInto !== null ? (
          <View style={{ marginLeft: -SPACE.md }}>
            <TextButton label={`${names.name(buyer.current)} 열기`} align="start" onPress={() => onOpen(buyer.current)} />
          </View>
        ) : null}
      </InfoCard>
      <InfoCard title="확정 상품">
        {confirmed.length === 0 ? <Txt color="textSub">1등 찜이 없어요.</Txt> : null}
        {confirmed.map((claim) => {
          const { broadcast, no } = splitProductKey(claim.key)
          const product = data.products.get(claim.key)
          const productName = product?.name.trim() === '' || product === undefined ? '품종 미입력' : product.name
          return <InfoRow key={claim.id} label={`${label(broadcast, no)} ${productName}`} value={formatWon(product?.price ?? 0)} spoken={`${label(broadcast, no)} ${productName} · ${formatWon(product?.price ?? 0)}`} />
        })}
        <InfoRow label="합계" value={formatWon(buyer.subtotal)} strong spoken={`합계 ${formatWon(buyer.subtotal)}`} />
        {others.filter(isActive).length > 0 ? (
          <View style={{ gap: 2, paddingTop: SPACE.sm }}>
            <Txt step="body" color="textSub">합계에 들지 않는 찜</Txt>
            {others.filter(isActive).map((claim) => {
              const { broadcast, no } = splitProductKey(claim.key)
              return <Txt key={claim.id} step="caption" color="textSub">{`${label(broadcast, no)} · ${claimWord(data, claim)}`}</Txt>
            })}
          </View>
        ) : null}
      </InfoCard>
      <InfoCard title="그날 정산">
        {settlement === undefined ? (
          <Txt color="textSub">정산할 것이 없어요.</Txt>
        ) : (
          <>
            <InfoRow label="최종" value={formatWon(settlement.total)} strong />
            <InfoRow label="받은 돈" value={formatWon(settlement.received)} />
            <InfoRow label="입금" value={PAYMENT_WORD[settlement.payment]} />
          </>
        )}
      </InfoCard>
      {/* 단추는 좌우로 (절대 규칙 8 — 옛: 위아래로 쌓임): 차단은 왼쪽 회색, 합치기는 오른쪽 */}
      {!sealed && buyer.mergedInto === null ? (
        <ButtonRow>
          <BigButton kind="outline" label={buyer.blocked ? '차단 풀기' : '차단하기'} onPress={() => setAsk({ kind: 'block', block: !buyer.blocked })} />
          <BigButton kind={unknown ? 'primary' : 'outline'} label="다른 구매자와 합치기" oneLine onPress={() => setAsk({ kind: 'merge' })} />
        </ButtonRow>
      ) : null}
      {ask?.kind === 'merge' ? (
        <MergeSheet
          data={data}
          names={names}
          opened={buyer}
          command={command}
          onClose={() => setAsk(null)}
          onDone={(into) => {
            setAsk(null)
            setNotice(MERGED_NOTICE)
            onOpen(into)
          }}
        />
      ) : null}
      {ask?.kind === 'unmerge' ? (
        <ReasonSheet
          title={`${names.name(ask.from)} 떼어 내기`}
          submitLabel="떼어 내기"
          reasons={UNMERGE_REASONS}
          onClose={() => setAsk(null)}
          onSubmit={async (reason) => {
            await command({ type: 'buyer.unmerge', from: ask.from, reason })
            setAsk(null)
            setNotice(UNMERGED_NOTICE)
          }}
        />
      ) : null}
      {ask?.kind === 'block' ? (
        <ReasonSheet
          title={`${name} ${ask.block ? '차단' : '차단 풀기'}`}
          submitLabel={ask.block ? '차단하기' : '차단 풀기'}
          reasons={QUICK_REASONS}
          warning={ask.block ? blockWarning(false) : null}
          danger={ask.block}
          onClose={() => setAsk(null)}
          onSubmit={async (reason) => {
            const event = { type: ask.block ? 'host.blockBuyer' : 'host.unblockBuyer', buyer: buyer.id, reason }
            queue?.add({ label: `${name} ${ask.block ? '차단' : '차단 풀기'}`, send: (requestId) => command(event, requestId) })
            setAsk(null)
          }}
        />
      ) : null}
    </View>
  )
}

/** 사유 고르기·적기 창 (웹 ReasonField와 같은 쓰임 — 사유 없이는 보내지 않는다) */
function ReasonSheet({ title, submitLabel, reasons, warning = null, danger = false, onClose, onSubmit }: { readonly title: string; readonly submitLabel: string; readonly reasons: readonly string[]; readonly warning?: string | null; readonly danger?: boolean; readonly onClose: () => void; readonly onSubmit: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const submit = async () => {
    const value = reason.trim()
    if (value === '') return setProblem(REASON_REQUIRED)
    setBusy(true)
    setProblem(null)
    try {
      await onSubmit(value)
    } catch (caught: unknown) {
      setProblem(isApiError(caught) ? caught.message : '보내지 못했어요. 다시 눌러 주세요.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <BottomSheet visible title={title} onClose={onClose} actions={<><BigButton kind="secondary" label="닫기" onPress={onClose} /><BigButton kind={danger ? 'danger' : 'primary'} label={submitLabel} busy={busy} onPress={() => void submit()} /></>}>
      <View style={{ gap: SPACE.sm }}>
        {warning !== null ? <Notice tone="warning">{warning}</Notice> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs }}>
          {reasons.map((word) => (
            <Pill key={word} on={reason === word} label={word} ariaLabel={`사유 ${word}`} onPress={() => setReason(word)} />
          ))}
        </View>
        <TextField label="사유" value={reason} onChangeText={setReason} error={problem} />
      </View>
    </BottomSheet>
  )
}

/** 합치기: 상대 고르기 → 서버 미리 보기(D-100) → 막힘이면 까닭만, 아니면 사유와 함께 합치기. 방향 바꾸기 */
function MergeSheet({ data, names, opened, command, onClose, onDone }: { readonly data: ScopeData; readonly names: BuyerNames; readonly opened: Buyer; readonly command: (event: Readonly<Record<string, unknown>>, requestId?: string) => Promise<WriteResult>; readonly onClose: () => void; readonly onDone: (into: string) => void }) {
  const { p } = useKit()
  const [search, setSearch] = useState('')
  const [other, setOther] = useState<Buyer | null>(null)
  const [flip, setFlip] = useState(false)
  const [preview, setPreview] = useState<MergePreviewView | null>(null)
  const [previewError, setPreviewError] = useState<ApiError | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const base = other === null ? null : defaultInto(opened, other)
  const into = base === null || other === null ? null : flip ? (base.id === opened.id ? other : opened) : base
  const from = into === null || other === null ? null : into.id === opened.id ? other : opened
  const fromId = from?.id ?? null
  const intoId = into?.id ?? null
  // 보는 범위가 바뀌면(seq — 다른 기기의 변화) 미리 보기를 새로 받는다 (D-100)
  useEffect(() => {
    if (fromId === null || intoId === null) return
    let alive = true
    setPreview(null)
    setPreviewError(null)
    get<MergePreviewView>(withQuery(`/api/days/${encodeURIComponent(data.date)}/merge-preview`, { from: fromId, into: intoId, rehearsal: false })).then(
      (view) => {
        if (alive) setPreview(view)
      },
      (caught: unknown) => {
        if (alive && isApiError(caught)) setPreviewError(caught)
      },
    )
    return () => {
      alive = false
    }
  }, [fromId, intoId, data.date, data.seq])
  const hits = search.trim() === '' ? [] : [...new Map(searchBuyers(data.buyers, search.trim(), 8).map((hit) => [hit.current.id, hit.current])).values()].filter((hit) => hit.id !== opened.id)
  const words = preview === null ? null : mergeWords(data, names, preview.preview, productLabel(data))
  const submit = async () => {
    if (from === null || into === null || words === null || words.blocks.length > 0) return
    const value = reason.trim()
    if (value === '') return setProblem(REASON_REQUIRED)
    setBusy(true)
    setProblem(null)
    try {
      await command({ type: 'buyer.merge', from: from.id, into: into.id, reason: value })
      onDone(into.id)
    } catch (caught: unknown) {
      setProblem(isApiError(caught) ? caught.message : '합치지 못했어요. 다시 눌러 주세요.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <BottomSheet
      visible
      title="다른 구매자와 합치기"
      onClose={onClose}
      actions={<><BigButton kind="secondary" label="닫기" onPress={onClose} />{words !== null && words.blocks.length === 0 ? <BigButton label="합치기" busy={busy} onPress={() => void submit()} /> : null}</>}
    >
      <View style={{ gap: SPACE.sm }}>
        {other === null ? (
          <>
            <TextField label="합칠 구매자 찾기" value={search} onChangeText={setSearch} placeholder="닉네임·뒤 4자리" />
            {/* 찾은 사람은 큰 단추 더미 대신 연락처 줄로 (D-UX3-95) */}
            {hits.length > 0 ? (
              <View style={{ marginHorizontal: -SPACE.sm }}>
                {hits.map((hit) => (
                  <Pressable key={hit.id} role="button" aria-label={`합칠 구매자 ${names.name(hit.id)}`} onPress={() => setOther(hit)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, minHeight: 52, paddingHorizontal: SPACE.sm, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
                    <Initial name={names.name(hit.id)} size={36} />
                    <View style={{ flex: 1 }}>
                      <Txt step="bodyLarge" weight="book">{names.name(hit.id)}</Txt>
                    </View>
                    <Icon name="chevron" color={p.textSub} size={18} />
                  </Pressable>
                ))}
              </View>
            ) : null}
          </>
        ) : (
          <>
            {from !== null && into !== null ? <Txt weight="bold">{`${names.name(from.id)} → ${names.name(into.id)} (남는 쪽: ${names.name(into.id)})`}</Txt> : null}
            {/* 곁일 둘은 작은 글자 단추로 좌우에 (옛: 큰 단추 둘을 위아래로) */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: -SPACE.md }}>
              <TextButton label="다른 구매자 고르기" color="textSub" onPress={() => { setOther(null); setFlip(false) }} />
              <TextButton label="방향 바꾸기" onPress={() => setFlip((on) => !on)} />
            </View>
            {previewError !== null ? <Notice tone="danger" alert>{previewError.message}</Notice> : null}
            {preview === null && previewError === null ? <Txt color="textSub">미리 보기를 받는 중이에요.</Txt> : null}
            {words !== null ? (
              <View style={{ gap: SPACE.xs }}>
                {words.blocks.map((block) => (
                  <Notice key={block.text} tone="warning">{block.text}</Notice>
                ))}
                {words.blocks.length === 0 ? (
                  <>
                    <Txt>{`옮겨 갈 확정 찜 ${String(words.movingCount)}개 · ${formatWon(words.movingTotal)}`}</Txt>
                    {words.afterTotal !== null ? <Txt>{`합친 뒤 합계 ${formatWon(words.afterTotal)}`}</Txt> : null}
                    {words.duplicates.map((item) => (
                      <Txt key={item.claim} step="caption">{item.text}</Txt>
                    ))}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs }}>
                      {MERGE_REASONS.map((word) => (
                        <Pill key={word} on={reason === word} label={word} ariaLabel={`사유 ${word}`} onPress={() => setReason(word)} />
                      ))}
                    </View>
                    <TextField label="사유" value={reason} onChangeText={setReason} error={problem} />
                  </>
                ) : null}
              </View>
            ) : null}
          </>
        )}
        {isUnknownSms(opened) && other === null ? <Txt step="caption" color="textSub">{`${UNKNOWN_SMS_DISPLAY} 구매자는 고른 손님에게 합쳐져요.`}</Txt> : null}
      </View>
    </BottomSheet>
  )
}
