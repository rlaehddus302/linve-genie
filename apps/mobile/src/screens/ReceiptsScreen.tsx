// 영수증 보내기·판매대장 (D-APPX-03 — 웹 ReceiptsPage·LedgerDialog와 같은 규칙·문구, RCP-02, STL-04·05·06, D-N4b-04·05).
// 끝난 방송을 고른다(최근 먼저) → 한 번에: "링크 전부 만들기"(실제만)·전원 확인서 PDF·전원 이미지 묶음·이 방송 판매대장 엑셀.
// 구매자 줄: 이름·상품 수·최종 금액·입금 상태·링크 상태, 링크 만들기·복사·보내기(휴대폰 공유)·끊기(한 번 더 묻기), 이미지·PDF.
// 링크는 판매자가 복사·공유 시트로 보낸다. [문자 보내기]는 판매자 휴대폰 문자 앱을 손님 번호·글·확인서 사진(JPG)으로 채워 연다
// (D-REAL-13: 문자에는 링크 대신 사진 — 사진을 못 받으면 글만으로 열지 않는다) — 판매자는 보내기만
// 누르고 문자는 판매자 번호로 간다(답장·전화가 판매자에게, D-REAL-05 — D-REAL-03을 바꿈). 번호를 아는 손님(문자찜)은 바로 열고, 모르는 손님은
// 번호를 넣고 연다. 번호 아는 손님 모두 보내기는 한 번 묻고 손님마다 문자 앱을 차례로 연다(보내면 다음, 닫으면 멈춤).
// 파일(PDF·JPG·ZIP·엑셀)은 휴대폰 공유 시트로 넘긴다. 실제 방송만 고른다 — 리허설은 앱에서 뺐다 (D-UX3-86).
// 모양 (D-UX3-93, 홈처럼): 기간 판매대장은 머리 오른쪽 작은 단추, "한 번에 하기"는 초록 단추 하나 + 줄, 구매자는 흰 카드 하나에 줄로 —
// 줄마다 이름·금액·입금 상태, 할 일은 작은 회색 단추(문자 보내기만 옅은 초록). 세금 증빙 안내는 맨 아래 작은 글.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, Share, View } from 'react-native'
import type { BroadcastItem, ReceiptBuyerRow, ReceiptBuyers, ReceiptLink } from '@livejjim/web/src/api/types.ts'
import { dateWords } from '@livejjim/web/src/lib/kst.ts'
import { linkWords, shareText, usableLink } from '@livejjim/web/src/lib/receipt-links.ts'
import {
  SMS_ALL_NOTE,
  SMS_NOTE,
  SMS_OPEN,
  SMS_PHONE_HELP,
  SMS_PHONE_LABEL,
  SMS_PHOTO_FAILED,
  SMS_SEND,
  SMS_SEND_ALL,
  SMS_SENT,
  SMS_UNAVAILABLE,
  smsAllQuestion,
  smsAllResult,
  smsProgress,
  smsTargets,
  smsWords,
} from '@livejjim/web/src/lib/receipt-sms.ts'
import { getBytes, isApiError, newRequestId, post, withQuery, withRetry, type ApiError } from '../api/client.ts'
import { copyToClipboard } from '../lib/clipboard.ts'
import { useCachedGet } from '../lib/cached-get.ts'
import { formatWon, PAYMENT_WORD, RETRY_NOW } from '../lib/words.ts'
import { nativeShareFile, nativeSms } from '../native/index.ts'
import type { SmsImage } from '../native/sms.ts'
import { useServices } from '../services.tsx'
import { Pill } from '../ui/day-pills.tsx'
import { Appear, EmptyFill, AppHeader, BigButton, BottomSheet, ConfirmSheet, Icon, TextField, Txt, useKit, Tap } from '../ui/kit/index.ts'
import { RADIUS, SPACE } from '../ui/kit/tokens.ts'
import { Loading, Notice } from '../ui/parts.tsx'
import { CARD_GAP, ChipButton, MenuRow, PAGE_SIDE, SectionCard } from './order-parts.tsx'
import { shownBroadcastTitle } from './BroadcastList.tsx'
import { Late, useCameLate } from '../ui/late.tsx'

export const RECEIPTS_TITLE = '영수증·판매대장'
export const NOT_ENDED = '라이브를 끝낸 뒤 보낼 수 있어요.'
export const NO_ENDED = '아직 끝낸 라이브가 없어요.'
export const SAME_DAY_NOTE = '같은 날 다른 라이브의 상품도 함께 들어가요(정산은 날짜마다 하나예요).'
export const NO_RECEIPT_ROWS = '확인서를 만들 구매자가 없어요.'
export const NO_NEW_LINKS = '새로 만들 링크가 없어요.'
export const COPIED = '복사했어요.'
export const COPY_BY_HAND = '길게 눌러 복사해 주세요.'
export const LINK_MADE = '링크를 만들었어요.'
export const LINK_REVOKED_DONE = '링크를 끊었어요.'
export const SHARE_FAILED = '보내지 못했어요. "링크 복사"로 복사해 보내 주세요.'
export const FILE_FAILED = '파일을 넘기지 못했어요. 다시 눌러 주세요.'
export const TAX_NOTE = '구매 내역 확인서는 세금계산서·현금영수증 같은 세법상 증빙이 아니에요.'
export const PICK_ONE_BROADCAST = '라이브를 하나 이상 골라 주세요.'
export const START_AFTER_END = '시작 날짜가 끝 날짜보다 늦어요.'
export const NO_BROADCAST_IN_PERIOD = '고른 기간에 라이브가 없어요.'

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
  const [attempt, setAttempt] = useState(0)
  const [ledger, setLedger] = useState(false)
  // 다시 오면 기억해 둔 방송 목록으로 바로 그리고 뒤에서 조용히 다시 받는다 (D-UX4-77)
  const { data, error, checked } = useCachedGet<{ broadcasts: BroadcastItem[] }>('/api/broadcasts', attempt)
  const list = useMemo<readonly BroadcastItem[] | null>(
    () => (data === null ? null : data.broadcasts.filter((item) => item.rehearsal !== true).sort((a, b) => (a.date === b.date ? (b.endedAt ?? '').localeCompare(a.endedAt ?? '') : b.date.localeCompare(a.date)))),
    [data],
  )
  const [chosen, setPicked] = useState<string | null>(initialBroadcast ?? null)
  const picked = chosen ?? list?.find((item) => item.ended)?.id ?? list?.[0]?.id ?? null
  // 방송은 서버에서 새로 받은 목록으로 한 번 정하고, 그 뒤로는 바꾸지 않는다 — 기억해 둔 목록만 있는 동안은 따라간다
  useEffect(() => {
    if (chosen === null && picked !== null && checked) setPicked(picked)
  }, [chosen, picked, checked])
  const broadcast = list?.find((item) => item.id === picked) ?? null
  const sameDay = broadcast !== null && list !== null && list.some((item) => item.id !== broadcast.id && item.date === broadcast.date)
  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="receipts-screen">
      <AppHeader title={RECEIPTS_TITLE} onBack={onBack} right={<ChipButton label="기간 판매대장" ariaLabel="기간 판매대장 엑셀" onPress={() => setLedger(true)} />} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: PAGE_SIDE, paddingTop: SPACE.sm, paddingBottom: SPACE.xxxl, gap: CARD_GAP }} keyboardShouldPersistTaps="handled">
        {error !== null ? (
          <View style={{ gap: SPACE.sm }}>
            <Notice tone="danger" alert>{error.message}</Notice>
            {list === null ? <BigButton kind="secondary" label={RETRY_NOW} onPress={() => setAttempt((n) => n + 1)} /> : null}
          </View>
        ) : null}
        {list === null && error === null ? <Loading /> : null}
        {/* 서버에서 받은 뒤에야 생기는 것은 부드럽게 — 기억해 둔 자료로 처음부터 그리면 바로 (D-UX4-112) */}
        <Late style={{ flexGrow: 1 }}>
          {list !== null && list.length === 0 ? (
            <EmptyFill title={NO_ENDED} body={'라이브를 끝내면\n여기서 확인서를 만들 수 있어요'} />
          ) : null}
        </Late>
        <Late>
          {list !== null && list.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -PAGE_SIDE }} contentContainerStyle={{ gap: SPACE.sm, paddingHorizontal: PAGE_SIDE, paddingVertical: SPACE.xs }}>
              {list.slice(0, 20).map((item) => (
                <Pill key={item.id} on={item.id === picked} label={dateWords(item.date)} ariaLabel={`라이브 ${dateWords(item.date)} ${shownBroadcastTitle(item.title)}`} onPress={() => setPicked(item.id)} />
              ))}
            </ScrollView>
          ) : null}
        </Late>
        <Late style={{ gap: CARD_GAP }}>
          {broadcast !== null ? (
            <>
              <Txt step="lead" weight="bold" role="heading" aria-level={2}>{`${dateWords(broadcast.date)} · ${shownBroadcastTitle(broadcast.title)}`}</Txt>
              {broadcast.ended ? <ReceiptDay key={broadcast.id} broadcast={broadcast} sameDay={sameDay} /> : <Notice tone="info">{NOT_ENDED}</Notice>}
            </>
          ) : null}
        </Late>
        <Txt step="caption" color="textSub" center>{TAX_NOTE}</Txt>
      </ScrollView>
      {ledger ? <LedgerSheet initial={broadcast !== null ? broadcast.date : null} onClose={() => setLedger(false)} /> : null}
    </View>
  )
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
/** 시트·문자 창이 닫히는 동안 다음 창을 띄우지 않게 (아이폰은 창이 겹치면 열리지 않는다) */
const SHEET_GAP_MS = 450

interface SmsDraft {
  readonly phone: string
  readonly text: string
}

/** 서버에서 받는 번호·글(가게 이름·금액·입금 계좌 — 링크 없음, D-REAL-13)을 받는다 (D-REAL-05). 번호를 넣으면 기억한다 */
async function prepareSms(date: string, buyer: string, phone: string | null): Promise<SmsDraft> {
  const requestId = newRequestId()
  const result = await withRetry(() => post<{ sms: SmsDraft }>(`/api/days/${date}/receipt-sms/prepare`, { requestId, buyer, ...(phone === null ? {} : { phone }) }))
  return result.sms
}

/** 확인서 사진을 못 받았다 — 글만으로 문자 앱을 열지 않는다 */
class SmsPhotoError extends Error {}

/** 손님 확인서 사진(JPG, "이미지" 단추와 같은 것)을 받는다 (D-REAL-13) */
async function receiptPhoto(date: string, buyer: string): Promise<SmsImage> {
  try {
    const { bytes } = await withRetry(() => getBytes(withQuery(`/api/days/${date}/receipt.jpg`, { buyer, rehearsal: false })))
    if (bytes.length === 0) throw new SmsPhotoError()
    return { bytes, name: `receipt-${date}.jpg` }
  } catch {
    throw new SmsPhotoError()
  }
}

/** 문자를 못 열었을 때 한 줄: 사진을 못 받았으면 다시 누르라고, 서버가 막았으면 그 말, 그 밖엔 이 기기에서 못 보냄 */
const smsFailWords = (caught: unknown): string => (caught instanceof SmsPhotoError ? SMS_PHOTO_FAILED : isApiError(caught) ? caught.message : SMS_UNAVAILABLE)

/** 문자 앱을 손님 번호·글·확인서 사진으로 채워 열고, 보냈으면 보냄 표시 (안드로이드는 결과를 알 수 없어 열고 돌아오면 보낸 것으로) */
async function composeSms(date: string, buyer: string, draft: SmsDraft, photo: SmsImage): Promise<'sent' | 'cancelled'> {
  const result = await nativeSms().compose(draft.phone, draft.text, photo)
  if (result === 'cancelled') return 'cancelled'
  const requestId = newRequestId()
  await withRetry(() => post(`/api/days/${date}/receipt-sms/sent`, { requestId, buyer }))
  return 'sent'
}

/** 이 기기에서 문자를 보낼 수 있나 (서버가 문자 칸을 줄 때만 묻는다) */
function useSmsDevice(wanted: boolean): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null)
  useEffect(() => {
    if (!wanted || ok !== null) return
    let live = true
    void nativeSms()
      .available()
      .then((value) => {
        if (live) setOk(value)
      })
    return () => {
      live = false
    }
  }, [wanted, ok])
  return ok
}

/** 구매자 줄: 처음·조치 뒤·그날 정산이 바뀌면(실시간 알림) 다시 받는다. 가게 이름(복사 글 앞말)도 같이 */
function useReceiptRows(date: string) {
  const { stream } = useServices()
  // 기억해 둔 구매자 줄·가게 이름을 바로 보이고 뒤에서 다시 받는다 (D-UX4-77). 가게 이름을 못 받으면 앞말 없이
  const { data, error, reload: refetch, set } = useCachedGet<ReceiptBuyers>(withQuery(`/api/days/${date}/receipt-buyers`, { rehearsal: false }))
  const { data: shop } = useCachedGet<{ shop: { name: string } }>('/api/shop')
  const rows = data?.buyers ?? null
  const smsReady = data?.smsReady === true
  const shopName = shop !== null && typeof shop.shop.name === 'string' ? shop.shop.name : ''
  const reload = useCallback(() => void refetch(), [refetch])
  useEffect(() => {
    const view = stream.open()
    view.addEventListener('change', (event) => {
      try {
        const scope = JSON.parse(event.data ?? '{}') as { date?: string; rehearsal?: boolean }
        if (scope.date === date && scope.rehearsal !== true) reload()
      } catch {
        reload()
      }
    })
    return () => view.close()
  }, [date, reload, stream])
  const applyLinks = useCallback((links: readonly ReceiptLink[]) => {
    const byBuyer = new Map(links.map((link) => [link.buyer, link]))
    if (data === null) return
    set((current) => {
      const now = current ?? data
      return { ...now, buyers: now.buyers.map((row) => ({ ...row, link: byBuyer.get(row.buyer) ?? row.link })) }
    })
  }, [data, set])
  return { rows, shopName, smsReady, error, reload, applyLinks }
}

function ReceiptDay({ broadcast, sameDay }: { readonly broadcast: BroadcastItem; readonly sameDay: boolean }) {
  const { date } = broadcast
  const { rows, shopName, smsReady, error, reload, applyLinks } = useReceiptRows(date)
  const [smsAsk, setSmsAsk] = useState(false)
  const [smsBusy, setSmsBusy] = useState(false)
  const [smsResult, setSmsResult] = useState<string | null>(null)
  const [smsProgressText, setSmsProgressText] = useState<string | null>(null)
  const [smsError, setSmsError] = useState<string | null>(null)
  const smsDevice = useSmsDevice(smsReady)
  const smsOk = smsReady && smsDevice === true
  const [allBusy, setAllBusy] = useState(false)
  const [allResult, setAllResult] = useState<string | null>(null)
  const [allError, setAllError] = useState<ApiError | null>(null)
  const allRequest = useRef<string | null>(null)
  const files = useFileShare()
  const query = { rehearsal: false }

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

  const targets = rows === null || !smsOk ? [] : smsTargets(rows)
  // 모두 보내기: 손님마다 문자 앱을 차례로 연다. 보내면 다음 손님, 닫거나 서버가 막거나 사진을 못 받으면 거기서 멈춘다(다시 누르면 남은 손님부터)
  const sendAll = async () => {
    if (smsBusy) return
    const list = [...targets]
    setSmsAsk(false)
    setSmsBusy(true)
    setSmsResult(null)
    setSmsError(null)
    let sent = 0
    let stoppedAt: string | null = null
    for (const [index, row] of list.entries()) {
      setSmsProgressText(smsProgress(index + 1, list.length, row.name))
      await wait(SHEET_GAP_MS)
      try {
        const draft = await prepareSms(date, row.buyer, null)
        const outcome = await composeSms(date, row.buyer, draft, await receiptPhoto(date, row.buyer))
        if (outcome === 'cancelled') {
          stoppedAt = row.name
          break
        }
        sent++
      } catch (caught: unknown) {
        stoppedAt = row.name
        setSmsError(smsFailWords(caught))
        break
      }
    }
    setSmsProgressText(null)
    setSmsBusy(false)
    setSmsResult(smsAllResult(sent, stoppedAt))
    reload()
  }

  // 불러온 뒤에야 생긴 확인서 목록은 부드럽게 — 기억해 둔 목록으로 처음부터 그리면 바로 (D-UX4-112)
  const late = useCameLate(rows !== null)
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
  const pad = { paddingHorizontal: SPACE.xl, gap: SPACE.sm }
  return (
    <Appear instant={!late} style={{ gap: CARD_GAP }}>
      {sameDay ? <Txt step="meta" color="textSub">{SAME_DAY_NOTE}</Txt> : null}
      {error !== null ? <Notice tone="danger" alert>{error.message}</Notice> : null}
      {count > 0 ? (
        <SectionCard title="한 번에 하기" label="한 번에 하기" flush>
          <View style={pad}>
            <BigButton label="링크 전부 만들기" busy={allBusy} onPress={() => void makeAll()} />
            {allResult !== null ? <Notice tone="success">{allResult}</Notice> : null}
            {allError !== null ? <Notice tone="danger" alert>{allError.message}</Notice> : null}
          </View>
          <View>
            {targets.length > 0 || smsBusy ? <MenuRow title={`${SMS_SEND_ALL} (${String(targets.length)}명)`} busy={smsBusy} onPress={() => setSmsAsk(true)} /> : null}
            <MenuRow title="전원 확인서 PDF" busy={files.busy === 'all-pdf'} onPress={() => void files.run('all-pdf', withQuery(`/api/days/${date}/receipts.pdf`, query), `receipts-${date}-all.pdf`)} />
            <MenuRow title="전원 이미지(JPG) 묶음" busy={files.busy === 'all-zip'} onPress={() => void files.run('all-zip', withQuery(`/api/days/${date}/receipts.zip`, query), `receipts-${date}-images.zip`)} />
            <MenuRow title="이 라이브 판매대장 엑셀" busy={files.busy === 'ledger'} onPress={() => void files.run('ledger', ledgerPath(date, date, [broadcast.id], false), `ledger-${date}.xlsx`)} />
          </View>
          {smsProgressText !== null || smsResult !== null || smsError !== null || (smsReady && smsDevice === false) || files.error !== null ? (
            <View style={pad}>
              {smsProgressText !== null ? <Notice tone="info">{smsProgressText}</Notice> : null}
              {smsResult !== null ? <Notice tone="success">{smsResult}</Notice> : null}
              {smsError !== null ? <Notice tone="danger" alert>{smsError}</Notice> : null}
              {smsReady && smsDevice === false ? <Txt step="caption" color="textSub">{SMS_UNAVAILABLE}</Txt> : null}
              {files.error !== null ? <Notice tone="danger" alert>{files.error}</Notice> : null}
            </View>
          ) : null}
        </SectionCard>
      ) : (
        <View style={{ paddingVertical: SPACE.xxl }}>
          <Txt color="textSub" center>{NO_RECEIPT_ROWS}</Txt>
        </View>
      )}
      <ConfirmSheet
        visible={smsAsk}
        question={smsAllQuestion(targets.length)}
        description={SMS_ALL_NOTE}
        confirmLabel="보내기"
        cancelLabel="닫기"
        busy={smsBusy}
        onCancel={() => setSmsAsk(false)}
        onConfirm={() => void sendAll()}
      />
      {count > 0 ? (
        <SectionCard title={`구매자 ${String(count)}명`} label="구매자">
          {rows.map((row, index) => (
            <View key={row.buyer} style={{ gap: SPACE.md }}>
              {index > 0 ? <Divider /> : null}
              <BuyerRow
                row={row}
                date={date}
                shopName={shopName}
                smsReady={smsOk}
                locked={allBusy || smsBusy}
                onLink={(link) => {
                  applyLinks([link])
                  reload()
                }}
              />
            </View>
          ))}
        </SectionCard>
      ) : null}
    </Appear>
  )
}

/** 구매자 사이 옅은 선 */
function Divider() {
  const { p } = useKit()
  return <View aria-hidden style={{ height: 1, backgroundColor: p.border }} />
}

function BuyerRow({
  row,
  date,
  shopName,
  smsReady,
  locked,
  onLink,
}: {
  readonly row: ReceiptBuyerRow
  readonly date: string
  readonly shopName: string
  readonly smsReady: boolean
  readonly locked: boolean
  readonly onLink: (link: ReceiptLink) => void
}) {
  const [smsSheet, setSmsSheet] = useState(false)
  const [phone, setPhone] = useState('')
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
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
  const { tones } = useKit()
  const payTone = row.payment === 'PAID' ? tones.success : row.payment === 'UNPAID' ? tones.danger : tones.warning

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

  const last4 = row.sms?.last4 ?? null
  // 문자 보내기 (D-REAL-05): 번호·글을 받아(번호를 넣었으면 그 번호) 확인서 사진을 받고(D-REAL-13) 시트를 닫고 문자 앱을 연다. 판매자는 보내기만 누른다.
  // 사진을 못 받으면 문자 앱을 열지 않고 그 자리(시트가 열려 있으면 시트 안)에 다시 누르라고 알린다
  const sendSms = async (typed: string | null) => {
    if (busy) return
    setBusy(true)
    setError(null)
    setResult(null)
    setPhoneError(null)
    setPhotoError(null)
    try {
      const draft = await prepareSms(date, row.buyer, typed)
      const photo = await receiptPhoto(date, row.buyer)
      if (smsSheet) {
        setSmsSheet(false)
        setPhone('')
        await wait(SHEET_GAP_MS)
      }
      const outcome = await composeSms(date, row.buyer, draft, photo)
      if (outcome === 'sent') {
        setResult(SMS_SENT)
        onLink(row.link ?? { buyer: row.buyer, status: 'NONE', url: null, expiresAt: null, revokedAt: null })
      }
    } catch (caught: unknown) {
      if (caught instanceof SmsPhotoError) {
        setPhotoError(SMS_PHOTO_FAILED)
        return
      }
      if (!isApiError(caught)) {
        setResult(SMS_UNAVAILABLE)
        return
      }
      if (caught.code === 'NO_PHONE') {
        setSmsSheet(true)
      } else if (smsSheet) {
        setPhoneError(caught.message)
      } else {
        setError(caught)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <View role="group" aria-label={name} style={{ gap: SPACE.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.sm }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt step="bodyLarge" weight="medium">{name}</Txt>
          <Txt step="caption" color="textSub">{`상품 ${String(row.itemCount)}개${row.phoneLast4 !== null && !name.includes(row.phoneLast4) ? ` · 휴대폰 끝자리 ${row.phoneLast4}` : ''}`}</Txt>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Txt step="bodyLarge" weight="medium">{formatWon(row.total)}</Txt>
          <Txt step="caption" weight="medium" ink={payTone.fg}>{PAYMENT_WORD[row.payment]}</Txt>
        </View>
      </View>
      <View style={{ gap: 2 }}>
        <Txt step="caption" color="textSub">{linkWords(link)}</Txt>
        {smsReady && smsWords(row.sms) !== null ? <Txt step="caption" color="textSub">{smsWords(row.sms)}</Txt> : null}
      </View>
      {/* 할 일은 작은 단추로 한 줄에 (넘치면 다음 줄로 이어진다) — 문자 보내기만 옅은 초록 */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm }}>
        {smsReady ? (
          <ChipButton
            green
            label={SMS_SEND}
            ariaLabel={`${name} ${SMS_SEND}`}
            busy={busy && !smsSheet}
            disabled={linkLocked}
            onPress={() => {
              if (last4 === null) setSmsSheet(true)
              else void sendSms(null)
            }}
          />
        ) : null}
        {!usable ? <ChipButton label="링크 만들기" ariaLabel={`${name} 링크 만들기`} busy={linkLocked} onPress={() => void send('create')} /> : null}
        {usable ? (
          <>
            <ChipButton label="링크 복사" ariaLabel={`${name} 링크 복사`} disabled={linkLocked} onPress={() => void copy()} />
            <ChipButton label="링크 보내기" ariaLabel={`${name} 링크 보내기`} disabled={linkLocked} onPress={() => void share()} />
            <ChipButton label="링크 끊기" ariaLabel={`${name} 링크 끊기`} disabled={linkLocked} onPress={() => setConfirming(true)} />
          </>
        ) : null}
        <ChipButton label="이미지" ariaLabel={`${name} 이미지(JPG)`} busy={files.busy === 'jpg'} onPress={() => void files.run('jpg', withQuery(`/api/days/${date}/receipt.jpg`, { buyer: row.buyer, rehearsal: false }), `receipt-${date}.jpg`)} />
        <ChipButton label="PDF" ariaLabel={`${name} PDF`} busy={files.busy === 'pdf'} onPress={() => void files.run('pdf', withQuery(`/api/days/${date}/receipt.pdf`, { buyer: row.buyer, rehearsal: false }), `receipt-${date}.pdf`)} />
      </View>
      {busy ? <Txt step="caption" color="textSub">만드는 중…</Txt> : result !== null ? <Notice tone={result === SHARE_FAILED ? 'warning' : 'success'}>{result}</Notice> : null}
      {manual !== null ? <TextField label={COPY_BY_HAND} value={manual} onChangeText={() => undefined} selectTextOnFocus /> : null}
      {error !== null ? <Notice tone="danger" alert>{error.message}</Notice> : null}
      {files.error !== null ? <Notice tone="danger" alert>{files.error}</Notice> : null}
      {photoError !== null && !smsSheet ? <Notice tone="danger" alert>{photoError}</Notice> : null}
      <BottomSheet
        visible={smsSheet}
        title={`${name}님에게 ${SMS_SEND}`}
        onClose={() => setSmsSheet(false)}
        actions={<BigButton label={SMS_OPEN} busy={busy} disabled={phone.replace(/\D/g, '').length < 10} onPress={() => void sendSms(phone)} />}
      >
        <TextField label={SMS_PHONE_LABEL} help={SMS_PHONE_HELP} error={phoneError} value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" maxLength={20} />
        <Txt step="caption" color="textSub">{SMS_NOTE}</Txt>
        {photoError !== null ? <Notice tone="danger" alert>{photoError}</Notice> : null}
      </BottomSheet>
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
    </View>
  )
}

/** 기간 판매대장 (STL-06 — 기간·방송 골라 엑셀). 실제 범위 날짜·실제 방송만, 기본 모두 고름 */
function LedgerSheet({ initial, onClose }: { readonly initial: string | null; readonly onClose: () => void }) {
  const { p } = useKit()
  // 날짜·방송 목록은 기억해 둔 것을 바로 보이고 뒤에서 다시 받는다 (D-UX4-77) — 둘 다 있어야 고르기를 보인다
  const daysView = useCachedGet<{ days: { date: string; rehearsal: boolean }[] }>('/api/days')
  const listView = useCachedGet<{ broadcasts: BroadcastItem[] }>('/api/broadcasts')
  const ready = daysView.data !== null && listView.data !== null
  const days = useMemo(() => (daysView.data === null || listView.data === null ? null : daysView.data.days.filter((day) => !day.rehearsal).map((day) => day.date)), [daysView.data, listView.data])
  const broadcasts = useMemo(() => (listView.data === null || daysView.data === null ? null : listView.data.broadcasts.filter((item) => !item.rehearsal)), [listView.data, daysView.data])
  const loadError = ready ? null : (daysView.error ?? listView.error)
  const [chosenFrom, setFrom] = useState<string | null>(initial)
  const [chosenTo, setTo] = useState<string | null>(initial)
  const from = chosenFrom ?? days?.[0] ?? null
  const to = chosenTo ?? days?.[0] ?? null
  // 한 번 정한 기간은 새 목록이 와도 바꾸지 않는다
  useEffect(() => {
    if (chosenFrom === null && from !== null) setFrom(from)
    if (chosenTo === null && to !== null) setTo(to)
  }, [chosenFrom, chosenTo, from, to])
  const [unpicked, setUnpicked] = useState<ReadonlySet<string>>(new Set())
  const [problem, setProblem] = useState<string | null>(null)
  const files = useFileShare()
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
      actions={<BigButton label="엑셀 받기" busy={files.busy !== null} disabled={days === null || picked.length === 0} onPress={download} />}
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
                <Tap
                  key={item.id}
                  role="checkbox"
                  aria-checked={on}
                  aria-label={`${dateWords(item.date)} ${shownBroadcastTitle(item.title)}`}
                  onPress={() =>
                    setUnpicked((set) => {
                      const next = new Set(set)
                      if (next.has(item.id)) next.delete(item.id)
                      else next.add(item.id)
                      return next
                    })
                  }
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, minHeight: 44, borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}
                >
                  <View style={{ width: 28, height: 28, borderRadius: RADIUS.sm, borderCurve: 'continuous', borderWidth: 2, borderColor: on ? p.primary : p.outline, backgroundColor: on ? p.primary : p.surface, alignItems: 'center', justifyContent: 'center' }}>
                    {on ? <Icon name="check" color={p.onPrimary} size={18} /> : null}
                  </View>
                  <Txt>{`${dateWords(item.date)} · ${shownBroadcastTitle(item.title)}`}</Txt>
                </Tap>
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
