// 영수증 보내기·판매대장 (D-APPX-03 — 웹 ReceiptsPage·LedgerDialog와 같은 규칙·문구, RCP-02, STL-04·05·06, D-N4b-04·05).
// 끝난 방송을 고른다(최근 먼저) → 한 번에: "링크 전부 만들기"(실제만)·전원 확인서 PDF·전원 이미지 묶음·이 방송 판매대장 엑셀.
// 구매자 줄: 이름·상품 수·최종 금액·입금 상태·링크 상태, 링크 만들기·복사·보내기(휴대폰 공유)·끊기(한 번 더 묻기), 이미지·PDF.
// 우리는 링크를 채팅·문자로 보내지 않는다 — 판매자가 한 사람씩 복사하거나 공유 시트로 보낸다(D-N4b-05). 한꺼번에 복사·공유하는 버튼은 없다.
// 파일(PDF·JPG·ZIP·엑셀)은 휴대폰 공유 시트로 넘긴다. 리허설 방송은 링크·판매대장 없이 확인서만.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, Share, View } from 'react-native'
import type { BroadcastItem, ReceiptBuyerRow, ReceiptBuyers, ReceiptLink } from '@livejjim/web/src/api/types.ts'
import { dateWords } from '@livejjim/web/src/lib/kst.ts'
import { linkWords, shareText, usableLink } from '@livejjim/web/src/lib/receipt-links.ts'
import { get, getBytes, isApiError, newRequestId, post, withQuery, withRetry, type ApiError } from '../api/client.ts'
import { copyToClipboard } from '../lib/clipboard.ts'
import { formatWon, PAYMENT_WORD, RETRY_NOW } from '../lib/words.ts'
import { nativeShareFile } from '../native/index.ts'
import { useServices } from '../services.tsx'
import { Pill } from '../ui/day-pills.tsx'
import { AppHeader, BigButton, BottomSheet, Card, ConfirmSheet, Icon, TextField, Txt, useKit } from '../ui/kit/index.ts'
import { RADIUS, SPACE } from '../ui/kit/tokens.ts'
import { Loading, Notice, Tag } from '../ui/parts.tsx'

export const RECEIPTS_TITLE = '영수증·판매대장'
export const NOT_ENDED = '방송을 끝낸 뒤 보낼 수 있어요.'
export const NO_ENDED = '아직 끝낸 방송이 없어요.'
export const SAME_DAY_NOTE = '같은 날 다른 방송의 상품도 함께 들어가요(정산은 날짜마다 하나예요).'
export const REHEARSAL_NOTE = '리허설에서는 공유 링크와 판매대장을 만들지 않아요.'
export const NO_RECEIPT_ROWS = '확인서를 만들 구매자가 없어요.'
export const NO_NEW_LINKS = '새로 만들 링크가 없어요.'
export const COPIED = '복사했어요.'
export const COPY_BY_HAND = '길게 눌러 복사해 주세요.'
export const LINK_MADE = '링크를 만들었어요.'
export const LINK_REVOKED_DONE = '링크를 끊었어요.'
export const SHARE_FAILED = '보내지 못했어요. "링크 복사"로 복사해 보내 주세요.'
export const FILE_FAILED = '파일을 넘기지 못했어요. 다시 눌러 주세요.'
export const TAX_NOTE = '구매 내역 확인서는 세금계산서·현금영수증 같은 세법상 증빙이 아니에요.'
export const PICK_ONE_BROADCAST = '방송을 하나 이상 골라 주세요.'
export const START_AFTER_END = '시작 날짜가 끝 날짜보다 늦어요.'
export const NO_BROADCAST_IN_PERIOD = '고른 기간에 방송이 없어요.'

export const linksMade = (n: number): string => (n === 0 ? NO_NEW_LINKS : `링크 ${String(n)}개를 만들었어요.`)
export const revokeQuestion = (name: string): string => `${name}님의 링크를 끊으면 그 링크로는 더 이상 열 수 없어요. 필요하면 새 링크를 만들어 보내 주세요.`

/** 판매대장 요청 주소: 기간 안 방송을 모두 골랐으면 b를 적지 않는다(서버 = 기간 안 모든 실제 방송) — 웹 ledgerPath와 같다 */
export function ledgerPath(from: string, to: string, picked: readonly string[], all: boolean): string {
  const params = new URLSearchParams({ from, to })
  if (!all) for (const id of picked) params.append('b', id)
  return `/api/ledger.xlsx?${params.toString()}`
}

const MIME: Readonly<Record<string, string>> = { pdf: 'application/pdf', jpg: 'image/jpeg', zip: 'application/zip', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }

/** 서버 파일을 받아 공유 시트로 (버튼 하나에 하나) */
function useFileShare() {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = async (key: string, path: string, name: string) => {
    if (busy !== null) return
    setBusy(key)
    setError(null)
    try {
      const { bytes } = await getBytes(path)
      try {
        await nativeShareFile()(bytes, name, MIME[name.split('.').pop() ?? ''] ?? 'application/octet-stream')
      } catch {
        setError(FILE_FAILED)
      }
    } catch (caught: unknown) {
      setError(isApiError(caught) ? caught.message : FILE_FAILED)
    } finally {
      setBusy(null)
    }
  }
  return { busy, error, run }
}

export function ReceiptsScreen({ onBack, initialBroadcast }: { readonly onBack: () => void; readonly initialBroadcast?: string }) {
  const { p } = useKit()
  const [list, setList] = useState<readonly BroadcastItem[] | null>(null)
  const [picked, setPicked] = useState<string | null>(initialBroadcast ?? null)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [ledger, setLedger] = useState(false)
  useEffect(() => {
    let alive = true
    get<{ broadcasts: BroadcastItem[] }>('/api/broadcasts').then(
      (result) => {
        if (!alive) return
        const sorted = [...result.broadcasts].sort((a, b) => (a.date === b.date ? (b.endedAt ?? '').localeCompare(a.endedAt ?? '') : b.date.localeCompare(a.date)))
        setList(sorted)
        setError(null)
        setPicked((current) => current ?? sorted.find((item) => item.ended && !item.rehearsal)?.id ?? sorted.find((item) => item.ended)?.id ?? sorted[0]?.id ?? null)
      },
      (caught: unknown) => {
        if (alive && isApiError(caught)) setError(caught)
      },
    )
    return () => {
      alive = false
    }
  }, [attempt])
  const broadcast = list?.find((item) => item.id === picked) ?? null
  const sameDay = broadcast !== null && list !== null && list.some((item) => item.id !== broadcast.id && item.date === broadcast.date && item.rehearsal === broadcast.rehearsal)
  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="receipts-screen">
      <AppHeader title={RECEIPTS_TITLE} onBack={onBack} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SPACE.md, paddingBottom: SPACE.xxxl, gap: SPACE.md }} keyboardShouldPersistTaps="handled">
        <Txt step="caption" color="textSub">{TAX_NOTE}</Txt>
        <BigButton kind="outline" label="기간 판매대장 엑셀" onPress={() => setLedger(true)} />
        {error !== null ? (
          <View style={{ gap: SPACE.sm }}>
            <Notice tone="danger" alert>{error.message}</Notice>
            {list === null ? <BigButton kind="secondary" label={RETRY_NOW} onPress={() => setAttempt((n) => n + 1)} /> : null}
          </View>
        ) : null}
        {list === null && error === null ? <Loading /> : null}
        {list !== null && list.length === 0 ? <Txt color="textSub">{NO_ENDED}</Txt> : null}
        {list !== null && list.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACE.sm }}>
            {list.slice(0, 20).map((item) => (
              <Pill key={item.id} on={item.id === picked} label={`${dateWords(item.date)}${item.rehearsal ? ' 리허설' : ''}`} ariaLabel={`방송 ${dateWords(item.date)} ${item.title}${item.rehearsal ? ' · 리허설' : ''}`} onPress={() => setPicked(item.id)} />
            ))}
          </ScrollView>
        ) : null}
        {broadcast !== null ? (
          <>
            <Txt weight="bold">{`${dateWords(broadcast.date)} · ${broadcast.title}`}</Txt>
            {broadcast.rehearsal ? <Tag tone="info">리허설</Tag> : null}
            {broadcast.ended ? <ReceiptDay key={broadcast.id} broadcast={broadcast} sameDay={sameDay} /> : <Notice tone="info">{NOT_ENDED}</Notice>}
          </>
        ) : null}
      </ScrollView>
      {ledger ? <LedgerSheet initial={broadcast !== null && !broadcast.rehearsal ? broadcast.date : null} onClose={() => setLedger(false)} /> : null}
    </View>
  )
}

/** 구매자 줄: 처음·조치 뒤·그날 정산이 바뀌면(실시간 알림) 다시 받는다. 가게 이름(복사 글 앞말)도 같이 */
function useReceiptRows(date: string, rehearsal: boolean) {
  const { stream } = useServices()
  const [rows, setRows] = useState<readonly ReceiptBuyerRow[] | null>(null)
  const [shopName, setShopName] = useState('')
  const [error, setError] = useState<ApiError | null>(null)
  const [version, setVersion] = useState(0)
  const latest = useRef(0)
  const reload = useCallback(() => setVersion((n) => n + 1), [])
  useEffect(() => {
    const mine = ++latest.current
    Promise.all([get<ReceiptBuyers>(withQuery(`/api/days/${date}/receipt-buyers`, { rehearsal })), get<{ shop: { name: string } }>('/api/shop').catch(() => null)]).then(
      ([result, shop]) => {
        if (mine !== latest.current) return
        setRows(result.buyers)
        if (shop !== null && typeof shop.shop.name === 'string') setShopName(shop.shop.name)
        setError(null)
      },
      (caught: unknown) => {
        if (mine === latest.current && isApiError(caught)) setError(caught)
      },
    )
  }, [date, rehearsal, version])
  useEffect(() => {
    const view = stream.open()
    view.addEventListener('change', (event) => {
      try {
        const scope = JSON.parse(event.data ?? '{}') as { date?: string; rehearsal?: boolean }
        if (scope.date === date && (scope.rehearsal === true) === rehearsal) reload()
      } catch {
        reload()
      }
    })
    return () => view.close()
  }, [date, rehearsal, reload, stream])
  const applyLinks = useCallback((links: readonly ReceiptLink[]) => {
    const byBuyer = new Map(links.map((link) => [link.buyer, link]))
    setRows((current) => current?.map((row) => ({ ...row, link: byBuyer.get(row.buyer) ?? row.link })) ?? current)
  }, [])
  return { rows, shopName, error, reload, applyLinks }
}

function ReceiptDay({ broadcast, sameDay }: { readonly broadcast: BroadcastItem; readonly sameDay: boolean }) {
  const { date, rehearsal } = broadcast
  const { rows, shopName, error, reload, applyLinks } = useReceiptRows(date, rehearsal)
  const [allBusy, setAllBusy] = useState(false)
  const [allResult, setAllResult] = useState<string | null>(null)
  const [allError, setAllError] = useState<ApiError | null>(null)
  const allRequest = useRef<string | null>(null)
  const files = useFileShare()
  const prefix = rehearsal ? 'rehearsal-' : ''
  const query = { rehearsal }

  const makeAll = async () => {
    if (allBusy) return
    const requestId = allRequest.current ?? newRequestId()
    allRequest.current = requestId
    setAllBusy(true)
    setAllError(null)
    setAllResult(null)
    try {
      const result = await withRetry(() => post<{ created: number; links: ReceiptLink[] }>(`/api/days/${date}/receipt-links/all`, { requestId }))
      allRequest.current = null
      applyLinks(result.links)
      setAllResult(linksMade(result.created))
      reload()
    } catch (caught: unknown) {
      if (!isApiError(caught)) throw caught
      if (!caught.network) allRequest.current = null
      setAllError(caught)
    } finally {
      setAllBusy(false)
    }
  }

  if (rows === null) {
    return error !== null ? (
      <View style={{ gap: SPACE.sm }}>
        <Notice tone="danger" alert>{error.message}</Notice>
        <BigButton kind="secondary" label={RETRY_NOW} onPress={reload} />
      </View>
    ) : (
      <Loading />
    )
  }
  const count = rows.length
  return (
    <View style={{ gap: SPACE.md }}>
      {sameDay ? <Txt color="textSub">{SAME_DAY_NOTE}</Txt> : null}
      {rehearsal ? <Notice tone="info">{REHEARSAL_NOTE}</Notice> : null}
      {error !== null ? <Notice tone="danger" alert>{error.message}</Notice> : null}
      {count > 0 ? (
        <Card label="한 번에 하기">
          {!rehearsal ? <BigButton label="링크 전부 만들기" busy={allBusy} onPress={() => void makeAll()} /> : null}
          <BigButton kind={rehearsal ? 'primary' : 'outline'} label="전원 확인서 PDF" busy={files.busy === 'all-pdf'} onPress={() => void files.run('all-pdf', withQuery(`/api/days/${date}/receipts.pdf`, query), `${prefix}receipts-${date}-all.pdf`)} />
          <BigButton kind="outline" label="전원 이미지(JPG) 묶음" busy={files.busy === 'all-zip'} onPress={() => void files.run('all-zip', withQuery(`/api/days/${date}/receipts.zip`, query), `${prefix}receipts-${date}-images.zip`)} />
          {!rehearsal ? <BigButton kind="outline" label="이 방송 판매대장 엑셀" busy={files.busy === 'ledger'} onPress={() => void files.run('ledger', ledgerPath(date, date, [broadcast.id], false), `ledger-${date}.xlsx`)} /> : null}
          {allResult !== null ? <Notice tone="success">{allResult}</Notice> : null}
          {allError !== null ? <Notice tone="danger" alert>{allError.message}</Notice> : null}
          {files.error !== null ? <Notice tone="danger" alert>{files.error}</Notice> : null}
        </Card>
      ) : (
        <Txt color="textSub">{NO_RECEIPT_ROWS}</Txt>
      )}
      {rows.map((row) => (
        <BuyerRow
          key={row.buyer}
          row={row}
          date={date}
          rehearsal={rehearsal}
          shopName={shopName}
          locked={allBusy}
          onLink={(link) => {
            applyLinks([link])
            reload()
          }}
        />
      ))}
    </View>
  )
}

function BuyerRow({ row, date, rehearsal, shopName, locked, onLink }: { readonly row: ReceiptBuyerRow; readonly date: string; readonly rehearsal: boolean; readonly shopName: string; readonly locked: boolean; readonly onLink: (link: ReceiptLink) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [manual, setManual] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const pending = useRef<{ kind: 'create' | 'revoke'; requestId: string } | null>(null)
  const files = useFileShare()
  const link = row.link
  const usable = usableLink(link)
  const text = usable ? shareText(shopName, link.expiresAt, link.url) : null
  const name = row.name
  const linkLocked = busy || locked

  const send = async (kind: 'create' | 'revoke') => {
    if (busy) return
    const requestId = pending.current?.kind === kind ? pending.current.requestId : newRequestId()
    pending.current = { kind, requestId }
    setBusy(true)
    setError(null)
    setResult(null)
    setManual(null)
    try {
      const path = kind === 'create' ? `/api/days/${date}/receipt-links` : `/api/days/${date}/receipt-links/revoke`
      const response = await withRetry(() => post<{ link: ReceiptLink }>(path, { requestId, buyer: row.buyer }))
      pending.current = null
      onLink(response.link)
      setResult(kind === 'create' ? LINK_MADE : LINK_REVOKED_DONE)
    } catch (caught: unknown) {
      if (!isApiError(caught)) throw caught
      if (!caught.network) pending.current = null
      setError(caught)
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (text === null) return
    setResult(null)
    setError(null)
    if (await copyToClipboard(text)) {
      setManual(null)
      setResult(COPIED)
    } else {
      setManual(text)
    }
  }

  const share = async () => {
    if (text === null) return
    setResult(null)
    setError(null)
    try {
      await Share.share({ message: text })
    } catch {
      setResult(SHARE_FAILED)
    }
  }

  return (
    <Card label={name}>
      <Txt weight="bold">{name}</Txt>
      {row.phoneLast4 !== null && !name.includes(row.phoneLast4) ? <Txt step="caption" color="textSub">{`휴대폰 끝자리 ${row.phoneLast4}`}</Txt> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs, alignItems: 'center' }}>
        <Txt>{`상품 ${String(row.itemCount)}개 · ${formatWon(row.total)}`}</Txt>
        <Tag tone={row.payment === 'PAID' ? 'success' : row.payment === 'UNPAID' ? 'danger' : 'warning'}>{PAYMENT_WORD[row.payment]}</Tag>
      </View>
      {rehearsal ? null : <Txt step="caption" color="textSub">{linkWords(link)}</Txt>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm }}>
        {!rehearsal && !usable ? <BigButton kind="outline" label="링크 만들기" ariaLabel={`${name} 링크 만들기`} busy={linkLocked} onPress={() => void send('create')} /> : null}
        {!rehearsal && usable ? (
          <>
            <BigButton kind="outline" label="링크 복사" ariaLabel={`${name} 링크 복사`} disabled={linkLocked} onPress={() => void copy()} />
            <BigButton kind="outline" label="링크 보내기" ariaLabel={`${name} 링크 보내기`} disabled={linkLocked} onPress={() => void share()} />
            <BigButton kind="outline" label="링크 끊기" ariaLabel={`${name} 링크 끊기`} disabled={linkLocked} onPress={() => setConfirming(true)} />
          </>
        ) : null}
        <BigButton kind="outline" label="이미지(JPG)" ariaLabel={`${name} 이미지(JPG)`} busy={files.busy === 'jpg'} onPress={() => void files.run('jpg', withQuery(`/api/days/${date}/receipt.jpg`, { buyer: row.buyer, rehearsal }), `${rehearsal ? 'rehearsal-' : ''}receipt-${date}.jpg`)} />
        <BigButton kind="outline" label="PDF" ariaLabel={`${name} PDF`} busy={files.busy === 'pdf'} onPress={() => void files.run('pdf', withQuery(`/api/days/${date}/receipt.pdf`, { buyer: row.buyer, rehearsal }), `${rehearsal ? 'rehearsal-' : ''}receipt-${date}.pdf`)} />
      </View>
      {busy ? <Txt step="caption" color="textSub">만드는 중…</Txt> : result !== null ? <Notice tone={result === SHARE_FAILED ? 'warning' : 'success'}>{result}</Notice> : null}
      {manual !== null ? <TextField label={COPY_BY_HAND} value={manual} onChangeText={() => undefined} selectTextOnFocus /> : null}
      {error !== null ? <Notice tone="danger" alert>{error.message}</Notice> : null}
      {files.error !== null ? <Notice tone="danger" alert>{files.error}</Notice> : null}
      <ConfirmSheet
        visible={confirming}
        question="링크를 끊을까요?"
        description={revokeQuestion(name)}
        confirmLabel="링크 끊기"
        cancelLabel="닫기"
        danger
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false)
          void send('revoke')
        }}
      />
    </Card>
  )
}

/** 기간 판매대장 (STL-06 — 기간·방송 골라 엑셀). 실제 범위 날짜·실제 방송만, 기본 모두 고름 */
function LedgerSheet({ initial, onClose }: { readonly initial: string | null; readonly onClose: () => void }) {
  const { p } = useKit()
  const [days, setDays] = useState<readonly string[] | null>(null)
  const [broadcasts, setBroadcasts] = useState<readonly BroadcastItem[] | null>(null)
  const [loadError, setLoadError] = useState<ApiError | null>(null)
  const [from, setFrom] = useState<string | null>(initial)
  const [to, setTo] = useState<string | null>(initial)
  const [unpicked, setUnpicked] = useState<ReadonlySet<string>>(new Set())
  const [problem, setProblem] = useState<string | null>(null)
  const files = useFileShare()
  useEffect(() => {
    let alive = true
    Promise.all([get<{ days: { date: string; rehearsal: boolean }[] }>('/api/days'), get<{ broadcasts: BroadcastItem[] }>('/api/broadcasts')]).then(
      ([real, list]) => {
        if (!alive) return
        const dates = real.days.filter((day) => !day.rehearsal).map((day) => day.date)
        setDays(dates)
        setBroadcasts(list.broadcasts.filter((item) => !item.rehearsal))
        setFrom((current) => current ?? dates[0] ?? null)
        setTo((current) => current ?? dates[0] ?? null)
      },
      (caught: unknown) => {
        if (alive && isApiError(caught)) setLoadError(caught)
      },
    )
    return () => {
      alive = false
    }
  }, [])
  const inPeriod = useMemo(() => (broadcasts === null || from === null || to === null ? [] : broadcasts.filter((item) => item.date >= from && item.date <= to)), [broadcasts, from, to])
  const picked = inPeriod.filter((item) => !unpicked.has(item.id))
  const download = () => {
    if (from === null || to === null) return
    if (from > to) return setProblem(START_AFTER_END)
    if (inPeriod.length === 0) return setProblem(NO_BROADCAST_IN_PERIOD)
    if (picked.length === 0) return setProblem(PICK_ONE_BROADCAST)
    setProblem(null)
    void files.run('ledger', ledgerPath(from, to, picked.map((item) => item.id), picked.length === inPeriod.length), `ledger-${from}-${to}.xlsx`)
  }
  const datePills = (value: string | null, set: (date: string) => void, label: string) => (
    <View style={{ gap: SPACE.xs }}>
      <Txt step="caption" color="textSub">{label}</Txt>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACE.xs }}>
        {(days ?? []).map((day) => (
          <Pill key={day} on={day === value} label={dateWords(day)} ariaLabel={`${label} ${dateWords(day)}`} onPress={() => set(day)} />
        ))}
      </ScrollView>
    </View>
  )
  return (
    <BottomSheet
      visible
      onClose={onClose}
      title="판매대장 엑셀"
      actions={
        <>
          <BigButton kind="secondary" label="닫기" onPress={onClose} />
          <BigButton label="엑셀 받기" busy={files.busy !== null} disabled={days === null || picked.length === 0} onPress={download} />
        </>
      }
    >
      <View style={{ gap: SPACE.md }}>
        {loadError !== null ? <Notice tone="danger" alert>{loadError.message}</Notice> : null}
        {days === null && loadError === null ? <Loading /> : null}
        {days !== null ? (
          <>
            {datePills(from, setFrom, '시작 날짜')}
            {datePills(to, setTo, '끝 날짜')}
            {inPeriod.length === 0 ? <Txt color="textSub">{NO_BROADCAST_IN_PERIOD}</Txt> : null}
            {inPeriod.map((item) => {
              const on = !unpicked.has(item.id)
              return (
                <Pressable
                  key={item.id}
                  role="checkbox"
                  aria-checked={on}
                  aria-label={`${dateWords(item.date)} ${item.title}`}
                  onPress={() =>
                    setUnpicked((set) => {
                      const next = new Set(set)
                      if (next.has(item.id)) next.delete(item.id)
                      else next.add(item.id)
                      return next
                    })
                  }
                  style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, minHeight: 44 }}
                >
                  <View style={{ width: 28, height: 28, borderRadius: RADIUS.sm, borderWidth: 2, borderColor: on ? p.primary : p.outline, backgroundColor: on ? p.primary : p.surface, alignItems: 'center', justifyContent: 'center' }}>
                    {on ? <Icon name="check" color={p.onPrimary} size={18} /> : null}
                  </View>
                  <Txt>{`${dateWords(item.date)} · ${item.title}`}</Txt>
                </Pressable>
              )
            })}
          </>
        ) : null}
        {problem !== null ? <Notice tone="danger" alert>{problem}</Notice> : null}
        {files.error !== null ? <Notice tone="danger" alert>{files.error}</Notice> : null}
      </View>
    </BottomSheet>
  )
}
