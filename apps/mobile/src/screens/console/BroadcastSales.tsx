// 방송 정산 화면 "정산서" (D-RETRO-60~64, 판매자 요청 2026-11-12 "방송이 끝나면 바로 한 화면에서 정산 정보를 보고 …"):
// 구매자별/상품별 탭 · 카드 줄 정산서 · 아래 고정 판(총계 + [보내기]: 문자·사진·엑셀·CSV) · 구매자별 정산서 · 모두에게 보내기.
// D-UX4-170~175 (사용자 지시 2026-11-16 "정산 내역서 화면 피드백"):
// - 맨 위 작은 글 "판매 수량 n개 · 구매자 n명"을 지우고 구매자 수는 맨 아래 총계에 (170).
// - 화면은 svg 직사각형 표 대신 흰 둥근 카드 줄(StatementList) — 머리 "정산 내역서 · 구매자별"·가게 이름·날짜는 화면에서 뺀다. 사진은 A4 그림 그대로(미리 보기를 거친다) (171).
// - 탭 바는 머리 바로 아래 붙고, 손으로 내리면 숨고 올리면 보인다 — 라이브 화면과 같은 tabHide·붙는 머리(D-UX4-155) (171).
// - [가게 이름]·[정산 정보] 단추를 합쳐 한 판으로 — 정보가 빠졌을 때만 단추가 보인다 (172). 단추는 탭 바 같은 줄 맨 오른쪽 옅은 초록 알약 "정산 정보를 알려주세요 ›" (177 — 옛: 탭 바 아래 연한 빨강 경고 캡슐).
// - [내보내기]·[모두에게 보내기]를 합쳐 [보내기] 하나 → "정산서 보내기" 아래 창: 문자 · 사진 · 엑셀 · CSV (173). [보내기]는 총계와 한 판으로 화면 아래에 고정된 초록 큰 단추 (178 — 옛: 흰 캡슐·목록 끝 총계 카드).
// - 상품별 줄마다 산 구매자 이름 (179) — 금색 캡슐로 (182).
// - 정산 정보 화면은 아래에서 올라오는 판이 아니라 오른쪽에서 밀려 들어오는 다음 화면, 밀면 뒤로 (184). 머리까지 덮도록 이 화면 맨 바깥에 그린다 — 머리(header)도 여기서 그린다.
// - 문자로 보내기 판은 못 보내는 구매자를 까닭별 소제목 아래 " · "로 잇고, [보내기 시작]은 번호를 아는 구매자만 차례로 (174).
// - 정산 정보(계좌·전화번호·배송비)를 한 번도 정하지 않았으면 방송을 끝낸 직후와 정산서를 처음 만들 때 한 번 묻는다. 건너뛸 수 있다 (D-RETRO-60).
//   구매자 줄을 눌러 정산서를 열 때는 묻지 않는다 (D-UX4-192, 사용자 "구매자별에서 하나 누르면 정산 정보 알려달라는 창이 뜬 다음에 넘어가는데, 그 창 안뜨게") —
//   모두에게 보내기를 시작할 때만 묻는다(손님에게 나가기 전).
// - 구매자 정산서는 목록 위로 오른쪽에서 밀려 들어오는 다음 화면(SlidePage): 왼쪽 끝에서 밀거나 ‹·안드로이드 뒤로면 목록으로 (D-UX4-192,
//   사용자 "지금은 아무 애니메이션 없이 창 전환되는데 … 구매자 정산서 화면 안에 들어갔을 때 스와이프로 뒤로가기"). 머리에는 제목 없이 뒤로만(D-UX4-193).
//   D-UX4-198 (사용자 "화면 저렇게 넘어가면 안 된다 … 아이폰 기본적인 화면으로 해라"): 기기에서는 openBuyer로 진짜 쌓인 경로(/console/<방송>/statement)를 연다 —
//   손으로 그린 겹친 화면이 가끔 넘김 중간에 멈췄다. 겹친 화면(SlidePage)은 경로가 없을 때(시험·웹)만. 모두에게 보내기 차례는 statement-queue로 잇는다.
// - 모두에게 보내기(D-RETRO-64): 문자는 판매자 휴대폰의 문자 앱으로 한 명씩 보낸다(앱이 대신 보내지 않는다) — 보내면 다음 손님으로 바로 넘어가고 보낸 손님을 표시한다.
// - 라이브 합치기 (D-MERGE-LIVE-01~04, 판매자 요청 2026-11-17 "하루에 1차, 2차 이렇게 끊어서 방송하는 경우 … 정산할 때 정보가 파편화"):
//   합친 라이브면 묶음의 라이브를 모두 담은 정산서(부르는 쪽이 sales·scope를 준다) — 목록 위 "1차 · 2차를 합친 정산서예요" [나누기].
//   합치지 않았는데 같은 날 끝난 라이브가 더 있으면 "같은 날 끝난 라이브가 n개 더 있어요" [합치기].
//   보낸 손님 표시는 정산서(묶음 모습)마다 따로, 다른 정산서로 먼저 받은 손님은 모두에게 보내기 차례에서 빼고 따로 보인다(두 번 청구하지 않게).
//   묶음을 받기 전에는 [보내기]를 막는다 — 1차만 담긴 정산서가 나가지 않게.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, ScrollView, View, useWindowDimensions } from 'react-native'
import type { BroadcastItem, ReceiptBuyers } from '@livejjim/web/src/api/types.ts'
import { getBytes, isApiError, newRequestId, post, withRetry } from '../../api/client.ts'
import { useCachedGet, useScreenFocusCount } from '../../lib/cached-get.ts'
import { type broadcastSales, salesMoney, statementInfoMissing, statementName, statementRows, type StatementRow } from '../../lib/broadcast-sales.ts'
import {
  GROUPS_CHECKING, GROUPS_FAILED, GROUPS_PATH, GROUPS_RETRY, SPLIT_BUTTON, SPLIT_DESCRIPTION, SPLIT_FAILED, SPLIT_QUESTION, MERGE_BUTTON, earlierSent, markScopeSent, mergedNote, sameDayOthers, siblingsNote,
  statementScope, useBroadcastGroups, type StatementScope,
} from '../../lib/broadcast-groups.ts'
import type { BuyerNames } from '../../lib/derive.ts'
import { markStatementInfoAsked, sentBuyers, shouldAskStatementInfo, useStatementInfo } from '../../lib/statement-info.ts'
import { BigButton, BottomSheet, ConfirmSheet, LINE_TABS_TOP, LineTab, LineTabs, SmallButton, Txt, useKit } from '../../ui/kit/index.ts'
import { GUTTER, RADIUS, SPACE } from '../../ui/kit/tokens.ts'
import { fetchCached } from '../../lib/cached-get.ts'
import { MergeLivesSheet } from './MergeLives.tsx'
import { EXPORT_FAILED, EXPORT_LABEL, type ExportKind } from '../order-export.tsx'
import { MenuRow } from '../order-parts.tsx'
import { nativeShareFile } from '../../native/index.ts'
import { wait, SHEET_GAP_MS } from '../../lib/receipt-sms-flow.ts'
import { StatementPhoto, statementPages } from './StatementPhoto.tsx'
import { BuyerStatementBody, buyerPageName, BUYER_PAGE_NAME, sendAllFinished, sendAllProgress, shopPathOf } from './BuyerStatement.tsx'
import { clearSendQueueNote, sendQueueNote, startSendQueue, useSendQueueVersion } from './statement-queue.ts'
import { BUYER_JOIN, productBuyers, StatementList } from './StatementList.tsx'
import { InfoButton, StatementFooter } from './StatementControls.tsx'
import { StatementSetupPage } from './StatementSetup.tsx'
import { SlidePage, slideUnder, useSlideProgress } from './parts.tsx'
import { BLOCK_TITLE, NAME_JOIN, sendGroups } from './statement-send.ts'
import { useTabBarHide } from './tab-hide.ts'

type Sales = ReturnType<typeof broadcastSales>

/** 붙는 머리: 목록의 첫째 자식(탭 바) */
export const STATEMENT_STICKY = [0]
/** 아래 고정 판 높이 어림 (재기 전) */
const FOOTER_GUESS = 80

/** [보내기] 아래 창 (D-UX4-173) */
export const SEND_SHEET_TITLE = '정산서 보내기'
export const SMS_ALL_ROW = '구매자에게 문자로 보내기'
export const SMS_ALL_REHEARSAL = '연습 라이브는 문자를 보내지 않아요'
export const SMS_ALL_NOBODY = '아직 구매자가 없어요'
export const SEND_ALL_TITLE = '모두에게 정산서 보내기'
export const SEND_ALL_BODY = '한 명씩 문자 앱이 열려요. 보내고 돌아오면 다음 손님으로 넘어가요.'
export const SEND_ALL_DONE = '모두에게 보냈어요. 다시 보내려면 목록에서 손님을 눌러 주세요.'
export const SEND_ALL_NOBODY = '지금은 문자를 보낼 수 있는 구매자가 없어요.'
export const PHONE_CHECKING = '휴대폰 번호를 확인하고 있어요.'
export const PHONE_CHECK_FAILED = '휴대폰 번호를 확인하지 못했어요. 보낼 때 번호를 물어볼 수 있어요.'
export const SENT_WORD = '보냄'
export const NOT_SENT_WORD = '아직'
export { sendAllProgress }

/** 줄 이름 (화면 읽기·시험) — 구매자별은 누르면 그 손님 정산서 */
function rowLabel(row: StatementRow, sent: boolean, buyers: readonly string[] = []): string {
  if (row.no !== null) return `${row.round ? `${row.round} ` : ''}${row.no}번 ${row.label} · ${salesMoney(row.money)} · ${row.qty}개${buyers.length > 0 ? ` · 구매자 ${buyers.join(BUYER_JOIN)}` : ''}`
  return `${row.label} 정산서 · ${salesMoney(row.money)} · ${row.qty}개${sent ? ` · ${SENT_WORD}` : ''}`
}

export function BroadcastSalesList({ broadcastId, title, date, sales, names, buyer, select, openBuyer, inset, rehearsal, sealed, justEnded = false, header, scope: given }: {
  broadcastId: string; title: string; date: string; sales: Sales; names: BuyerNames; buyer: string | null; select: (id: string | null) => void; inset: number; rehearsal: boolean; sealed: boolean
  /** 정산서가 담는 라이브 (합친 라이브, D-MERGE-LIVE-01) — sales와 같은 범위여야 한다. 없으면(시험·웹) 이 라이브 하나 */
  scope?: StatementScope & { readonly reload: () => Promise<void> }
  /** 구매자 정산서를 진짜 쌓인 화면으로 연다 (D-UX4-198). 없으면(시험·웹) 이 화면 안에 겹쳐 그린다(buyer·select) */
  openBuyer?: (id: string) => void
  /** 화면 머리(상태 막대 자리 · 제목 · 알림) — 정산 정보 화면이 머리까지 덮도록 이 화면이 그린다 (D-UX4-184) */
  header?: ReactNode
  /** 이 화면을 보는 동안 방송이 끝났다 — 정산 정보가 비어 있으면 한 번 묻는다 */
  justEnded?: boolean
}) {
  const { p } = useKit()
  const scope = given ?? statementScope([], broadcastId)
  // 가게 이름은 묶음 첫 라이브(1차)의 것 — 내려받기(서버)와 같다
  const path = shopPathOf(scope.lead)
  const { data: shop } = useCachedGet<{ name: string }>(path)
  const { groups } = useBroadcastGroups()
  // 같은 날 끝난 라이브 (합치기 안내) — 기억해 둔 목록을 쓴다
  const { data: list } = useCachedGet<{ broadcasts: BroadcastItem[] }>(rehearsal ? null : '/api/broadcasts')
  const others = useMemo(() => (list === null || rehearsal ? [] : sameDayOthers(list.broadcasts, scope, date)), [list, rehearsal, scope, date])
  const [merging, setMerging] = useState(false)
  const [splitAsk, setSplitAsk] = useState(false)
  const [splitting, setSplitting] = useState(false)
  const [groupNote, setGroupNote] = useState('')
  const splitRequest = useRef(newRequestId())
  const statement = useStatementInfo()
  const { width: windowWidth } = useWindowDimensions()
  const tabHide = useTabBarHide()
  /** 아래 고정 판 높이 (그리기 전 어림 — 총계 두 줄과 큰 단추) */
  const [footerHeight, setFooterHeight] = useState(FOOTER_GUESS)
  const [products, setProducts] = useState(false)
  const [menu, setMenu] = useState(false)
  const [photo, setPhoto] = useState(false)
  const [saving, setSaving] = useState<ExportKind | null>(null)
  const [shareError, setShareError] = useState('')
  const [asking, setAsking] = useState(false)
  /** 정산 정보 판이 닫힌 뒤 이어서 할 일 (정산서 열기·연속 보내기 시작) */
  const afterAsk = useRef<(() => void) | null>(null)
  const [sendAll, setSendAll] = useState(false)
  const [queue, setQueue] = useState(false)
  /** 연속 보내기 차례 — 시작할 때 번호를 아는 구매자만 (D-UX4-174) */
  const [queueKeys, setQueueKeys] = useState<readonly string[]>([])
  const [sent, setSent] = useState<readonly string[]>(() => sentBuyers(scope.key))
  const [doneNote, setDoneNote] = useState('')
  // 쌓인 정산서 화면에서 보낸 손님·모두에게 보내기 마침 한 줄 (D-UX4-198) — 돌아와 다시 보이면 다시 읽는다
  const queueVersion = useSendQueueVersion()
  const focusCount = useScreenFocusCount()
  useEffect(() => { setSent(sentBuyers(scope.key)) }, [scope.key, queueVersion, focusCount])
  // 다른 정산서로 먼저 받은 손님 (합치기·나누기 전에 받은 정산서) — 보낸 표시가 바뀌면 다시 읽는다
  const earlier = useMemo(() => earlierSent(scope), [scope, sent])
  const shownNote = doneNote || sendQueueNote(broadcastId)
  const tab = products ? 'products' : 'buyers'
  const rows = useMemo(() => statementRows(sales, tab, id => names.name(id)), [tab, sales, names])
  const buyerRows = useMemo(() => statementRows(sales, 'buyers', id => names.name(id)), [sales, names])
  // 상품별 줄마다 산 구매자 — 구매자별 줄과 같은 이름 (D-UX4-179)
  const lineBuyers = useMemo(() => productBuyers(sales.orders, id => statementName(names.name(id))), [sales, names])
  // 사진만 A4 장으로 나눈다 (D-UX4-145)
  const pages = useMemo(() => statementPages(rows, tab), [rows, tab])
  const sheet = { tab, date, shop: shop?.name || title, total: sales.total, qty: sales.qty } as const
  const paperWidth = Math.min(windowWidth - 2 * GUTTER, 480)
  // 휴대폰 번호를 아는지 — 문자로 보내기 판을 열었거나 보내는 동안만 받는다 (번호 끝 4자리만 오고, 번호 자체는 오지 않는다)
  const receiptsPath = (sendAll || queue) && !rehearsal ? `/api/days/${date}/receipt-buyers` : null
  const { data: receipts, error: receiptsError } = useCachedGet<ReceiptBuyers>(receiptsPath)
  const checking = receiptsPath !== null && receipts === null && receiptsError === null
  const sendable = useMemo(() => sendGroups(buyerRows, receipts, !sealed, earlier), [buyerRows, receipts, sealed, earlier])
  const sentCount = sendable.sendable.filter(row => sent.includes(row.key)).length
  const firstUnsent = sendable.sendable.find(row => !sent.includes(row.key))

  // 방송을 끝낸 직후: 정산 정보가 비어 있으면 한 번 묻는다 (연습 방송은 묻지 않는다)
  const { info, editable } = statement
  // 정산서에 넣을 정보가 빠졌다 — 가게 이름이 비었거나 계좌·전화번호를 아직 모른다 (D-UX4-172)
  const needInfo = (shop !== null && shop.name.trim() === '') || (editable && info !== null && statementInfoMissing(info))
  useEffect(() => {
    if (!justEnded || rehearsal || asking) return
    if (!shouldAskStatementInfo('end', broadcastId, { info, editable })) return
    markStatementInfoAsked('end', broadcastId)
    setAsking(true)
  }, [justEnded, rehearsal, asking, broadcastId, info, editable])
  // 정산서 화면에서 뒤로 나오면 연속 보내기도 끝난다
  useEffect(() => {
    if (buyer === null) setQueue(false)
  }, [buyer])

  /** 정산서를 처음 만들 때: 정산 정보를 한 번도 정하지 않았으면 먼저 묻고, 판이 닫히면 이어서 한다 */
  const withInfo = (run: () => void) => {
    if (!rehearsal && shouldAskStatementInfo('first', broadcastId, { info, editable })) {
      markStatementInfoAsked('first', broadcastId)
      afterAsk.current = run
      setAsking(true)
    } else run()
  }
  const openInfo = () => { afterAsk.current = null; setAsking(true) }
  const closeAsk = () => {
    setAsking(false)
    const run = afterAsk.current
    afterAsk.current = null
    run?.()
  }
  /** [보내기]: 가게 이름이 비어 있으면 막지 않고 정보 판으로 이끈다 — 이름 없는 정산서가 나가지 않게 (D-UX4-175) */
  const openSend = () => {
    setShareError('')
    // 묶음을 받기 전에는 보내지 않는다 — 합친 라이브의 1차만 담긴 정산서가 나가지 않게
    if (!scope.ready) return
    if (shop !== null && shop.name.trim() === '') openInfo()
    else setMenu(true)
  }
  const exportFile = async (kind: ExportKind) => {
    if (saving) return
    setShareError('')
    if (kind === 'photo') {
      // 사진은 저장될 A4 그림을 먼저 보여 주고 거기서 저장한다 (D-UX4-171)
      setMenu(false)
      await wait(SHEET_GAP_MS)
      setPhoto(true)
      return
    }
    setSaving(kind)
    try {
      const { bytes, type } = await withRetry(() => getBytes(`/api/broadcasts/${encodeURIComponent(broadcastId)}/statement/${tab}/${kind}`))
      setMenu(false)
      await wait(SHEET_GAP_MS)
      await nativeShareFile()(bytes, `정산내역서-${date}-${products ? '상품별' : '구매자별'}.${kind}`, type.split(';')[0]!)
    } catch { setMenu(false); setShareError(EXPORT_FAILED) }
    finally { setSaving(null) }
  }
  const openSendAll = async () => {
    setMenu(false)
    await wait(SHEET_GAP_MS)
    setSendAll(true)
  }
  /** 연속 보내기: 차례에서 지금 손님 다음의 아직 보내지 않은 손님으로. 없으면 목록으로 돌아간다 */
  const nextBuyer = (current: string, sentNow: readonly string[]) => {
    const at = queueKeys.indexOf(current)
    const next = queueKeys.slice(at + 1).find(key => !sentNow.includes(key))
    if (next !== undefined) { select(next); return }
    setQueue(false)
    setDoneNote(sendAllFinished(queueKeys.length, queueKeys.filter(key => sentNow.includes(key)).length))
    select(null)
  }
  const startSendAll = () => {
    setSendAll(false)
    if (firstUnsent === undefined) return
    const first = firstUnsent.key
    const keys = sendable.sendable.map(row => row.key)
    if (openBuyer !== undefined) {
      withInfo(() => { setDoneNote(''); startSendQueue(broadcastId, keys); openBuyer(first) })
      return
    }
    withInfo(() => { setDoneNote(''); clearSendQueueNote(broadcastId); setQueueKeys(keys); setQueue(true); select(first) })
  }
  // 정산 정보 화면 — 머리까지 덮는 다음 화면 (D-UX4-184)
  const askPage = <StatementSetupPage visible={asking} shopPath={path} shopName={shop?.name ?? null} info={editable ? info : null} onLater={closeAsk} onSaved={closeAsk} />

  // 구매자 정산서 화면 (D-UX4-192): 닫히며 밀려 나가는 동안에도 마지막 손님을 그린다
  const lastBuyer = useRef(buyer)
  if (buyer !== null) lastBuyer.current = buyer
  const pageBuyer = buyer ?? lastBuyer.current
  const buyerContent = (): ReactNode => {
    if (pageBuyer === null) return null
    const order = sales.orders.find(row => row.id === pageBuyer)
    const at = order === undefined ? -1 : queueKeys.indexOf(order.id)
    const inQueue = queue && at >= 0
    const lastInQueue = queueKeys.slice(at + 1).every(key => sent.includes(key))
    return <BuyerStatementBody broadcastId={broadcastId} order={order} date={date} buyerName={statementName(names.name(pageBuyer))} inset={inset} rehearsal={rehearsal} sealed={sealed}
      earlier={earlier.includes(pageBuyer)} shopBroadcast={scope.lead}
      onSent={() => setSent(markScopeSent(scope, pageBuyer))} onOpenInfo={openInfo}
      queue={inQueue ? { position: at + 1, total: queueKeys.length, last: lastInQueue, next: () => nextBuyer(pageBuyer, sentBuyers(scope.key)) } : undefined} />
  }
  const buyerSlide = useSlideProgress(buyer !== null)
  const buyerPage = (
    <SlidePage visible={buyer !== null} progress={buyerSlide} onClose={() => select(null)} name={pageBuyer === null ? BUYER_PAGE_NAME : buyerPageName(statementName(names.name(pageBuyer)))} gray scroll={false} testID="buyer-page">
      {buyerContent()}
    </SlidePage>
  )
  /** 머리 · 내용 · 그 위를 머리까지 덮는 구매자 정산서 · 정산 정보 화면 — 정산서를 목록 칸 안에 두면 바깥 머리(‹ 정산서)가 남아 ‹가 두 개 보였다 (D-UX4-194) */
  // 정산서가 밀려 들어오면 머리·목록이 왼쪽으로 조금 밀리고 어두워진다 — 앱 화면 전환처럼 (D-UX4-195)
  const frame = (content: ReactNode) => <View style={{ flex: 1, backgroundColor: p.background }}>
    <Animated.View testID="buyer-page-under" style={[{ flex: 1 }, slideUnder(buyerSlide, windowWidth)]}>{header}{content}</Animated.View>
    {buyerPage}{askPage}
  </View>
  /** 나누기: 묶음을 없애고 라이브마다 정산서로 돌아간다 (D-MERGE-LIVE-02) */
  const split = async () => {
    const group = scope.group
    if (group === null || splitting) return
    setSplitting(true)
    try {
      await post(`${GROUPS_PATH}/${encodeURIComponent(group.id)}/split`, { requestId: splitRequest.current })
      await fetchCached(GROUPS_PATH, true).catch(() => undefined)
      setSplitAsk(false)
    } catch (e) {
      setSplitAsk(false)
      setGroupNote(isApiError(e) ? e.message : SPLIT_FAILED)
    } finally { setSplitting(false) }
  }
  const pick = (next: boolean) => {
    setProducts(next)
    // 탭을 바꾸면 탭 바는 늘 보인다 (D-UX4-155와 같다)
    tabHide.show()
  }
  /** 아래 고정 판의 아래 자리 — 아이폰 홈 막대(안전 영역) 위, 안전 영역이 없으면 12 */
  const footerBottom = Math.max(inset, SPACE.md)
  return frame(<View style={{ flex: 1 }}>
    <ScrollView style={{ flex: 1 }} testID="statement-scroll"
      // 탭 바 반고정 (D-UX4-171 — 라이브 화면 D-UX4-155와 같은 방식): 첫째 자식(탭 바)이 휴대폰 붙는 머리로 맨 위에 붙고, 손으로 내리면 숨고 올리면 보인다
      stickyHeaderIndices={STATEMENT_STICKY}
      // 당겨도 늘어나지 않는다 (D-UX4-108과 같다) — 탭 바가 맨 위에서 끌려 내려오지 않게
      bounces={false}
      overScrollMode="never"
      onScrollBeginDrag={() => tabHide.drag(true)}
      onScrollEndDrag={() => tabHide.drag(false)}
      onMomentumScrollBegin={() => tabHide.glide(true)}
      onMomentumScrollEnd={() => tabHide.glide(false)}
      scrollEventThrottle={16}
      onScroll={event => tabHide.track(event.nativeEvent.contentOffset.y)}
      // 마지막 줄이 아래 고정 판에 가리지 않게 판 높이만큼 비운다
      contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: footerBottom + footerHeight + SPACE.lg, gap: SPACE.md }}>
      {/* 붙는 머리 칸과 그 안에서 위로 밀려 숨는 탭 바 — 칸은 누름을 받지 않는다(box-none), 숨은 자리 밑의 줄이 눌린다 */}
      <View testID="statement-tabs-slot" collapsable={false} pointerEvents="box-none"
        onLayout={tabHide.onLayout}
        style={{ marginHorizontal: -GUTTER, pointerEvents: 'box-none' }}>
        <Animated.View testID="statement-tabs" style={{ paddingHorizontal: GUTTER, paddingTop: LINE_TABS_TOP, paddingBottom: SPACE.xs, backgroundColor: p.background, transform: [{ translateY: tabHide.offset }] }}>
          {/* 라이브 화면과 같은 밑줄 글자 탭 (D-TABS-01 — 옛 알약 둘) · 맨 오른쪽 정보 단추(정보가 빠졌을 때만, D-UX4-177) — 탭 줄과 같은 줄 */}
          <LineTabs label="보기" bleed={GUTTER} right={needInfo ? <InfoButton onPress={openInfo} /> : null}>
            <LineTab role="button" label="구매자별" on={!products} onPress={() => pick(false)} />
            <LineTab role="button" label="상품별" on={products} onPress={() => pick(true)} />
          </LineTabs>
        </Animated.View>
      </View>
      {scope.group !== null ? (
        <View testID="statement-merged" style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingVertical: SPACE.md, paddingHorizontal: SPACE.lg, borderRadius: RADIUS.xl, borderCurve: 'continuous', backgroundColor: p.surface }}>
          <View style={{ flex: 1 }}><Txt weight="bold">{mergedNote(scope.group.broadcasts.length)}</Txt></View>
          {sealed ? null : <SmallButton label={SPLIT_BUTTON} disabled={splitting} onPress={() => { splitRequest.current = newRequestId(); setGroupNote(''); setSplitAsk(true) }} />}
        </View>
      ) : others.length > 0 ? (
        <View testID="statement-siblings" style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingVertical: SPACE.md, paddingHorizontal: SPACE.lg, borderRadius: RADIUS.xl, borderCurve: 'continuous', backgroundColor: p.surface }}>
          <View style={{ flex: 1 }}><Txt>{siblingsNote(others.length)}</Txt></View>
          <SmallButton label={MERGE_BUTTON} onPress={() => { setGroupNote(''); setMerging(true) }} />
        </View>
      ) : null}
      {!scope.ready ? (
        <View testID="statement-groups-wait" style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.md }}>
          <View style={{ flex: 1 }}><Txt color="textSub">{scope.failed === true ? GROUPS_FAILED : GROUPS_CHECKING}</Txt></View>
          {scope.failed === true && given !== undefined ? <SmallButton label={GROUPS_RETRY} onPress={() => void given.reload()} /> : null}
        </View>
      ) : null}
      {groupNote ? <Txt color="dangerText" role="alert">{groupNote}</Txt> : null}
      {shownNote ? <Txt color="textSub">{shownNote}</Txt> : null}
      {shareError ? <Txt color="dangerText">{shareError}</Txt> : null}
      <StatementList tab={tab} rows={rows} sent={sent} buyers={lineBuyers}
        rowLabel={row => rowLabel(row, sent.includes(row.key), products ? lineBuyers.get(row.key) : [])}
        // 누르면 바로 그 손님 정산서 — 정산 정보를 묻지 않는다 (D-UX4-192)
        // 기기에서는 진짜 쌓인 화면으로 (D-UX4-198)
        {...(products ? {} : { onRow: (key: string) => (openBuyer === undefined ? select(key) : openBuyer(key)) })} />
    </ScrollView>
    {/* 아래 고정 판: 총계 + [보내기] — 굴림과 상관없이 늘 보인다 (D-UX4-178) */}
    <StatementFooter total={sales.total} qty={sales.qty} buyers={sales.buyers} bottom={footerBottom} onSend={openSend} sendDisabled={!scope.ready}
      onLayout={event => setFooterHeight(event.nativeEvent.layout.height)} />
    <BottomSheet visible={menu} title={SEND_SHEET_TITLE} onClose={() => setMenu(false)} testID="statement-send">
      <View style={{ marginHorizontal: -SPACE.xl }}>
        <MenuRow title={SMS_ALL_ROW} {...(rehearsal ? { sub: SMS_ALL_REHEARSAL } : buyerRows.length === 0 ? { sub: SMS_ALL_NOBODY } : {})}
          disabled={rehearsal || buyerRows.length === 0 || saving !== null} onPress={() => void openSendAll()} />
        {(['photo', 'xlsx', 'csv'] as const).map(kind => (
          <MenuRow key={kind} title={EXPORT_LABEL[kind]} busy={saving === kind} disabled={saving !== null && saving !== kind} onPress={() => void exportFile(kind)} />
        ))}
      </View>
    </BottomSheet>
    {photo && <StatementPhoto pages={pages} sheet={sheet} width={paperWidth} onClose={() => setPhoto(false)} onError={() => setShareError(EXPORT_FAILED)} />}
    <BottomSheet visible={sendAll} title={SEND_ALL_TITLE} description={SEND_ALL_BODY} onClose={() => setSendAll(false)} testID="send-all"
      actions={<>
        <BigButton kind="outline" label="닫기" onPress={() => setSendAll(false)} />
        <BigButton label={sentCount === 0 ? '보내기 시작' : '이어서 보내기'} busy={checking} disabled={checking || firstUnsent === undefined} onPress={startSendAll} />
      </>}>
      {checking ? <Txt color="textSub">{PHONE_CHECKING}</Txt> : <>
        <Txt weight="bold">{sendable.sendable.length === 0 ? SEND_ALL_NOBODY : firstUnsent === undefined ? SEND_ALL_DONE : sendAllProgress(sendable.sendable.length, sentCount)}</Txt>
        {sendable.sendable.length > 0 ? <View role="list" aria-label="보낼 손님">
          {sendable.sendable.map(row => {
            const done = sent.includes(row.key)
            return <View key={row.key} role="listitem" aria-label={`${row.label} ${done ? SENT_WORD : NOT_SENT_WORD}`} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingVertical: SPACE.xs }}>
              <View style={{ flex: 1 }}><Txt>{row.label}</Txt></View>
              <Txt step="caption" weight={done ? 'bold' : 'regular'} color={done ? 'text' : 'textSub'}>{done ? SENT_WORD : NOT_SENT_WORD}</Txt>
            </View>
          })}
        </View> : null}
        {/* 못 보내는 구매자 — 까닭을 소제목으로, 이름은 한 줄에 여럿 (D-UX4-174) */}
        {sendable.blocked.map(group => (
          <View key={group.reason} role="group" aria-label={BLOCK_TITLE[group.reason]} testID={`send-blocked-${group.reason}`} style={{ gap: SPACE.xs, paddingTop: SPACE.sm }}>
            <Txt step="body" weight="bold" color="textSub">{BLOCK_TITLE[group.reason]}</Txt>
            <Txt>{group.rows.map(row => row.label).join(NAME_JOIN)}</Txt>
          </View>
        ))}
        {receiptsError !== null ? <Txt step="caption" color="textSub">{PHONE_CHECK_FAILED}</Txt> : null}
      </>}
    </BottomSheet>
    {list !== null ? <MergeLivesSheet visible={merging} items={list.broadcasts.filter(item => item.date === date)} groups={groups} initial={[...scope.broadcasts, ...others.map(item => item.id)]}
      onClose={() => setMerging(false)} onMerged={() => setMerging(false)} /> : null}
    <ConfirmSheet visible={splitAsk} question={SPLIT_QUESTION} description={SPLIT_DESCRIPTION} cancelLabel="취소" confirmLabel={SPLIT_BUTTON} busy={splitting}
      onCancel={() => setSplitAsk(false)} onConfirm={() => void split()} />
  </View>)
}
