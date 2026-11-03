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
import { AppHeader, BigButton, BottomSheet, Card, TextField, Txt, useKit } from '../ui/kit/index.ts'
import { RADIUS, SPACE, pressedFill } from '../ui/kit/tokens.ts'
import { Loading, Notice, Tag } from '../ui/parts.tsx'

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
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SPACE.md, paddingBottom: SPACE.xxxl, gap: SPACE.md }} keyboardShouldPersistTaps="handled">
        {error !== null ? <Notice tone="danger" alert>{error.message}</Notice> : null}
        {days === null && error === null ? <Loading /> : null}
        {days !== null && days.length === 0 ? <Txt color="textSub">아직 실제 방송 판매 기록이 없어요.</Txt> : null}
        {days !== null ? <DayPills days={days} date={date} onPick={setDate} /> : null}
        {date !== null ? <BuyersDay key={date} date={date} /> : null}
      </ScrollView>
    </View>
  )
}

function BuyersDay({ date }: { readonly date: string }) {
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
      <View style={{ gap: SPACE.sm }}>
        <Notice tone="danger" alert>{error.message}</Notice>
        <BigButton kind="secondary" label={RETRY_NOW} onPress={reload} />
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
      <TextField label="구매자 찾기" value={search} onChangeText={setSearch} placeholder="닉네임·뒤 4자리" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs }}>
        <Pill on={sort === 'name'} label="이름 순" ariaLabel="이름 순" onPress={() => setSort('name')} />
        <Pill on={sort === 'total'} label="합계 큰 순" ariaLabel="합계 큰 순" onPress={() => setSort('total')} />
        <Pill on={all} label="찜 없는 구매자도 보기" ariaLabel="찜 없는 구매자도 보기" onPress={() => setAll((on) => !on)} />
      </View>
      {list.length === 0 ? <Txt color="textSub">{term === '' ? '그날 1등 찜이 있는 구매자가 없어요.' : '찾는 구매자가 없어요.'}</Txt> : null}
      {list.slice(0, limit).map((buyer) => (
        <BuyerRow key={buyer.id} buyer={buyer} name={names.name(buyer.id)} extra={distinguishWords(buyer, counts)} onPress={() => setOpen(buyer.id)} />
      ))}
      {list.length > limit ? <BigButton kind="outline" label="더 보기" onPress={() => setLimit((n) => n + PAGE)} /> : null}
    </View>
  )
}

function BuyerRow({ buyer, name, extra, onPress }: { readonly buyer: Buyer; readonly name: string; readonly extra: readonly string[]; readonly onPress: () => void }) {
  const { p } = useKit()
  const label = `${name}${extra.length > 0 ? ` · ${extra.join(' · ')}` : ''} · 상품 ${String(buyer.items.length)}개 · ${formatWon(buyer.subtotal)}`
  return (
    <Pressable role="button" aria-label={label} onPress={onPress} style={({ pressed }) => ({ borderRadius: RADIUS.lg, borderCurve: 'continuous', padding: SPACE.md, gap: SPACE.xs, backgroundColor: pressed ? pressedFill(p, p.surface) : p.surface })}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SPACE.xs }}>
        <Txt weight="bold">{name}</Txt>
        {isUnknownSms(buyer) ? <Tag tone="warning">확인 필요</Tag> : null}
        {buyer.blocked ? <Tag tone="danger">차단</Tag> : null}
      </View>
      {extra.length > 0 ? <Txt step="caption" color="textSub">{extra.join(' · ')}</Txt> : null}
      <Txt step="caption">{`상품 ${String(buyer.items.length)}개 · ${formatWon(buyer.subtotal)}`}</Txt>
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
    <View style={{ gap: SPACE.md }}>
      <BigButton kind="secondary" label="구매자 목록으로" onPress={onClose} />
      {queue !== null ? <UndoStrip items={items} queue={queue} /> : null}
      {notice !== null ? <Notice tone="success">{notice}</Notice> : null}
      {unknown ? <Notice tone="warning">{UNKNOWN_SMS_GUIDE}</Notice> : null}
      <Card label={`${name} 자세히`}>
        <Txt step="section" weight="bold">{name}</Txt>
        {distinguishWords(buyer, counts).length > 0 ? <Txt step="caption" color="textSub">{distinguishWords(buyer, counts).join(' · ')}</Txt> : null}
        <Txt>{`종류: ${buyer.kind === 'sms' ? '문자찜' : '유튜브'}`}</Txt>
        {buyer.nameHistory.length > 1 ? <Txt step="caption">{`${buyer.kind === 'sms' ? '메모 이력' : '닉네임 이력'}: ${buyer.nameHistory.join(' → ')}`}</Txt> : null}
        {buyer.phoneLast4 !== null ? <Txt>{`전화번호: 뒤 4자리 ${buyer.phoneLast4}`}</Txt> : null}
        {buyer.kind === 'youtube' ? <Txt>{`채널: 끝 4자리 ${channelTail(buyer)}`}</Txt> : null}
        <Txt>{`차단: ${buyer.blocked ? '차단' : '아니요'}`}</Txt>
        {buyer.merged.length > 0 ? (
          <View style={{ gap: SPACE.xs }}>
            <Txt weight="bold">합친 구매자</Txt>
            {buyer.merged.map((id) => (
              <View key={id} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
                <View style={{ flex: 1 }}>
                  <Txt>{names.name(id)}</Txt>
                </View>
                {!sealed && data.buyers.get(id)?.mergedInto === buyer.id ? <BigButton kind="outline" label="떼어 내기" ariaLabel={`${names.name(id)} 떼어 내기`} onPress={() => setAsk({ kind: 'unmerge', from: id })} /> : null}
              </View>
            ))}
          </View>
        ) : null}
        {buyer.mergedInto !== null ? <BigButton kind="outline" label={`${names.name(buyer.current)} 열기`} onPress={() => onOpen(buyer.current)} /> : null}
      </Card>
      <Card label="확정 상품">
        <Txt weight="bold">확정 상품</Txt>
        {confirmed.length === 0 ? <Txt color="textSub">1등 찜이 없어요.</Txt> : null}
        {confirmed.map((claim) => {
          const { broadcast, no } = splitProductKey(claim.key)
          const product = data.products.get(claim.key)
          return <Txt key={claim.id}>{`${label(broadcast, no)} ${product?.name.trim() === '' || product === undefined ? '품종 미입력' : product.name} · ${formatWon(product?.price ?? 0)}`}</Txt>
        })}
        <Txt weight="bold">{`합계 ${formatWon(buyer.subtotal)}`}</Txt>
        {others.filter(isActive).length > 0 ? (
          <View style={{ gap: SPACE.xs }}>
            <Txt weight="bold">합계에 들지 않는 찜</Txt>
            {others.filter(isActive).map((claim) => {
              const { broadcast, no } = splitProductKey(claim.key)
              return <Txt key={claim.id} step="caption">{`${label(broadcast, no)} · ${claimWord(data, claim)}`}</Txt>
            })}
          </View>
        ) : null}
      </Card>
      <Card label="그날 정산">
        <Txt weight="bold">그날 정산</Txt>
        {settlement === undefined ? <Txt color="textSub">정산할 것이 없어요.</Txt> : <Txt>{`최종 ${formatWon(settlement.total)} · 받은 돈 ${formatWon(settlement.received)} · ${PAYMENT_WORD[settlement.payment]}`}</Txt>}
      </Card>
      {!sealed && buyer.mergedInto === null ? (
        <View style={{ gap: SPACE.sm }}>
          <BigButton kind={unknown ? 'primary' : 'outline'} label="다른 구매자와 합치기" onPress={() => setAsk({ kind: 'merge' })} />
          <BigButton kind={buyer.blocked ? 'outline' : 'danger'} label={buyer.blocked ? '차단 풀기' : '차단하기'} onPress={() => setAsk({ kind: 'block', block: !buyer.blocked })} />
        </View>
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
            {hits.map((hit) => (
              <BigButton key={hit.id} kind="outline" label={names.name(hit.id)} ariaLabel={`합칠 구매자 ${names.name(hit.id)}`} onPress={() => setOther(hit)} />
            ))}
          </>
        ) : (
          <>
            {from !== null && into !== null ? <Txt weight="bold">{`${names.name(from.id)} → ${names.name(into.id)} (남는 쪽: ${names.name(into.id)})`}</Txt> : null}
            <BigButton kind="outline" label="방향 바꾸기" onPress={() => setFlip((on) => !on)} />
            <BigButton kind="secondary" label="다른 구매자 고르기" onPress={() => { setOther(null); setFlip(false) }} />
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
