// D-UX4-20 (사용자 지시 2026-11-09): 머리 오른쪽 ⋯ 대신 회색 톱니. 누르면 아래 판이 아니라 오른쪽에서 밀려 들어오는 "방송 설정" 화면(토스 설정처럼 굵은 묶음 이름·흰 카드),
// 머리 글("방송 메뉴"·방송 제목)은 없앴다. "직접 넣기"는 상품 탭 오른쪽 아래 (+) → 상품 추가 화면(D-UX4-31), 문자찜 넣기는 설정 화면 줄로.
// 방송 중 (SPEC §7 화면 2, D-UX2-03 새 시안): 머리(뒤로 · "방송 중" · 음성 상태 · 방송 메뉴) → 도움 한 줄 → 꼭 필요한 경고만 한 줄씩
// → 음성 확인할 것 → 상품 전체 리스트(최신이 위). 아래 고정 버튼은 없다 — 직접 넣기·휴대폰 마이크는 방송 메뉴(⋯)에 (D-UX3-73).
// 빠른 입력·문자찜은 "직접 넣기" 시트, 유튜브 잇기·음성 설정·방송 끝내기는 방송 메뉴(⋯)의 시트로 옮겼다. 상품이 없는 새 방송이 유튜브에
// 이어져 있지 않으면 유튜브 잇기 시트를 한 번 먼저 연다(방송 시작 흐름의 "주소 붙여넣기" 단계).
// - 범위 자료는 ScopeStore(웹과 같은 프로토콜)로 받고, 쓰기는 /api/events에 요청 번호를 붙여 보낸 뒤 응답 seq까지 따라잡는다.
// - 앱이 뒤로 갔다 돌아오면(APP-04) 실시간을 다시 잇고 쌓인 라벨을 이어 찍고 "자리를 비운 동안 라벨 n장·찜 n건·음성 n개"를 10초 보인다.
// - 라벨 상태 낱말(라벨 대기·출력됨·재출력 필요)은 서버 출력 기록(GET /api/print/labels?date=)에서 — 리허설은 없다.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Animated, BackHandler, Keyboard, Platform, ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import type { LabelView } from '@livejjim/web/src/api/print-types.ts'
import { get, withQuery } from '../api/client.ts'
import { BuyerNames, alertCounts, boardProducts } from '../lib/derive.ts'
import type { ScopeSnapshot } from '../lib/scope-store.ts'
import { useAppForeground } from '../lib/use-app-state.ts'
import { LIVE_RECONNECTING, LIVE_STALE, RETRY_NOW, VOICE_SELLER_ONLY } from '../lib/words.ts'
import { useServices } from '../services.tsx'
import { AppHeader, Appear, BigButton, BottomSheet, FullSheet, HeaderIconButton, HeaderTextButton, Tap, Txt, useBottomInset, useKit, usePageTop, useWhiteTop } from '../ui/kit/index.ts'
import { useHoldRouteSwipe } from '../ui/kit/route-swipe.tsx'
import { GUTTER, SHADOW, SPACE, TOUCH } from '../ui/kit/tokens.ts'
import { LOW_PAPER, useLabelPaper } from '../lib/label-paper.ts'
import { BigButton as SmallButton, Notice, Row } from '../ui/parts.tsx'
import { useCameLate } from '../ui/late.tsx'
import { broadcastSales } from '../lib/broadcast-sales.ts'
import { SalesPill } from './console/SalesPill.tsx'
import { BroadcastSalesList } from './console/BroadcastSales.tsx'
import { AlertStrip } from './console/AlertStrip.tsx'
import { ConsoleContext, type ConsoleApi } from './console/context.ts'
import { useConsoleSignals, useScopeCommand, useScopeStore, type ConsoleSignal } from './console/scope.tsx'
import { ConsoleManage, MANAGE_LABEL } from './console/Manage.tsx'
import { ProductList, ProductToolbar, shownProducts, type RowNode } from './console/ProductBoard.tsx'
import { DEFAULT_PRODUCT_SORT, type ProductSort } from '../lib/product-sort.ts'
import { feedRows } from './console/feed-rows.ts'
import { ProductSheet } from './console/ProductEdit.tsx'
import { AddFab, DIGIT_PAD_HEIGHT, NumberKeys, ProductAddPage } from './console/ProductAdd.tsx'
import { SlidePage } from './console/parts.tsx'
import { DecisionsView } from './console/Decisions.tsx'
import { UnlistedClaims, unlistedNumbers } from './console/UnlistedClaims.tsx'
import { TentativeCards } from './console/TentativeCard.tsx'

import { UndoStrip, noItems, noSubscribe, useUndoQueue } from '../lib/host-queue.tsx'
import { VoicePanel } from './console/VoicePanel.tsx'
import { useFollowScroll } from '../lib/use-follow-scroll.ts'
import { HEARD_TAB, HeardTab, ListenLine, useKeptStream } from './console/StreamAudio.tsx'
import { useTabBarHide } from './console/tab-hide.ts'
import { ListenSourceChip, ListenSourceSheet } from './console/ListenSource.tsx'
import { ClaimFeed, ClaimFeedToolbar, useClaimFeedState } from './console/ClaimFeed.tsx'
import { LiveTalk, TALK_TAB, TalkDock } from './console/LiveTalk.tsx'
import { EndBroadcastRow } from './console/EndBroadcast.tsx'
import { LinkInfo, hasLinkedLive } from './console/LinkInfo.tsx'
import { useDockChoice } from '../lib/dock-choice.ts'
import { canLinkByAddress } from './BroadcastLinkScreen.tsx'
import { LINK_ASK_TITLE, LINK_CONFIRM_TITLE, YoutubeSection, YoutubeWarning, sendLiveLink, useAddressLinker, useMobileYoutube, wasLinkAsked } from './console/YoutubeSection.tsx'

// 방송 관리 화면 조각은 console/Manage로 옮겼다 (D-UX4-57 — 진짜 쌓인 화면과 같이 쓴다)
export { LABEL_PRINT_TITLE, LINK_TITLE, MANAGE_LABEL, THANKS_HELP_BODY, THANKS_HELP_TITLE, THANKS_TITLE, ThanksSwitch } from './console/Manage.tsx'

/** 돌아온 뒤 따라잡기를 기다리는 최대 시간 (APP-04 AC1 "3초 안에") */
const RETURN_WAIT_MS = 3000
/** 채팅 의심 표시 읽는 간격 (D-V3-129) */
const DOUBT_POLL_MS = 20_000

// 범위 자료는 같은 방송을 보는 화면끼리 나눠 쓴다 (D-UX4-57 — 상품 추가·방송 관리 쌓인 화면)
export { useScopeStore } from './console/scope.tsx'

/**
 * 연결 줄은 오래 끊겼을 때만 (D-UX4-83, 사용자 지시 2026-11-10 "찰나의 순간에 다시 연결하는 중… 이런 메시지가 나오고 … ux에 별로 … 웬만하면 안 띄우고 싶거든"):
 * 실시간 연결이 LIVE_NOTICE_MS(10초) 넘게 이어서 끊겨 있거나, 최신으로 맞추지 못한 채 그만큼 지나야 보인다 — 화면을 열 때·앱으로 돌아올 때의 잠깐 끊김은 보이지 않는다.
 * 오래 끊기면 찜이 화면에 늦게 오므로 그때는 알린다(판매자 안전).
 */
export const LIVE_NOTICE_MS = 10_000

/** flag가 ms 동안 이어서 참이었는가 */
export function useLasting(flag: boolean, ms: number): boolean {
  const [late, setLate] = useState(false)
  useEffect(() => {
    if (!flag) {
      setLate(false)
      return
    }
    const handle = setTimeout(() => setLate(true), ms)
    return () => clearTimeout(handle)
  }, [flag, ms])
  return flag && late
}

export function LiveNotice({ snapshot, onRetry }: { readonly snapshot: ScopeSnapshot; readonly onRetry: () => void }) {
  const lost = useLasting(snapshot.connection !== 'open', LIVE_NOTICE_MS)
  const stale = useLasting(snapshot.stale, LIVE_NOTICE_MS)
  return (
    <>
      {lost ? <Notice tone="warning">{LIVE_RECONNECTING}</Notice> : null}
      {stale ? (
        <Row wrap>
          <Notice tone="warning" alert>
            {LIVE_STALE}
          </Notice>
          <SmallButton small label={RETRY_NOW} onPress={onRetry} />
        </Row>
      ) : null}
    </>
  )
}

/** "자리를 비운 동안 라벨 n장…" 줄을 누르면 가는 곳 (D-RETRO-141) — 화면 읽기 이름 */
export const AWAY_LABELS_GO = '대기 라벨 뽑기로 가기'

/**
 * 자리를 비운 동안 한 줄 (APP-04). 라벨 몫이 있으면 줄을 누를 수 있다 — 누르면 대기 라벨 뽑기(라이브 관리의 "대기 n장 지금 뽑기", D-RETRO-40)로 간다 (D-RETRO-141).
 * 라벨 몫은 남은 장 수대로 줄고, 다 뽑거나 라벨 출력을 끄면 빠진다(그때 10초가 지났으면 줄이 사라진다).
 */
function AwayLine({ onLabels }: { readonly onLabels: () => void }) {
  const { away } = useServices()
  const view = useSyncExternalStore(away.subscribe, away.getSnapshot)
  useEffect(() => {
    if (view.line === null || view.labels > 0) return
    const handle = setTimeout(() => away.tick(Date.now()), Math.max(0, view.until - Date.now()))
    return () => clearTimeout(handle)
  }, [away, view])
  if (view.line === null) return null
  const notice = (
    <Notice tone="info" label="자리를 비운 동안">
      {view.labels > 0 ? `${view.line} ›` : view.line}
    </Notice>
  )
  if (view.labels === 0) return notice
  return (
    <Tap role="button" aria-label={AWAY_LABELS_GO} testID="away-labels" onPress={onLabels} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      {notice}
    </Tap>
  )
}

/**
 * onEnded: 방송 종료 알림. 화면은 해당 방송의 판매 명세를 보여 준다.
 * focused (D-RETRO-63): 이 화면이 맨 위에 보이나 — 방송이 저절로 끝났을 때 다른 화면(쌓인 화면)을 쓰던 중이면 정산 정보 판을 띄우지 않고 돌아올 때 띄운다.
 */
/**
 * openLink: 방송 연결을 쌓인 화면으로 연다(밀어서 뒤로 가기, D-UX3-09) — 없으면 앱 안 전체 화면 판(시험·웹).
 * openAdd·openManage (D-UX4-57): 상품 추가·방송 관리를 진짜 쌓인 화면으로 연다 — 없으면(시험·웹) 이 화면 안에 겹쳐 그린다.
 * refresh: 바뀌면 유튜브 잇기 상태를 다시 받는다(방송 연결 화면에서 돌아올 때 경로가 올린다).
 */
/** 붙는 머리 = 라이브 화면 목록의 둘째 자식(탭 바) (D-UX4-98) */
export const STICKY_TABS = [1]
/** 탭 바 알약 위 여백 — 맨 위에 있을 때도, 올리다 위에 붙었을 때도 머리 아래 이만큼 (D-UX4-110, 사용자 지시 2026-11-10 "중간에 올릴 때 탭바와 상단영역 사이 여백과 끝까지 올렸을 때 여백이 달라") */
export const TABS_TOP = SPACE.sm

/** 쌓인 상품 추가 화면이 닫힌 뒤 그 상품 자세히(아래 판)를 열기까지 — 화면 넘김이 끝난 뒤에 연다 (D-RETRO-22). 웹(시험)은 바로 */
export const SHOW_AFTER_BACK_MS = 600
/** "그 상품 보기"로 스크롤할 때 그 줄 위에 남기는 자리 (붙는 탭 바 아래에 줄이 보이게) */
const ROW_PEEK = 64

export function ConsoleScreen({ broadcastId, seller, onBack, onEnded, justEnded = false, focused = true, openReviews, openLabels, openLink, openAdd, openAddAt, openManage, openRecord, openStatement, startPage, refresh = 0 }: { readonly broadcastId: string; readonly seller: boolean; readonly onBack: () => void; readonly onEnded?: () => void; readonly justEnded?: boolean; readonly focused?: boolean; readonly openReviews?: () => void; readonly openLabels?: () => void; readonly openLink?: (closed: boolean) => void; readonly openAdd?: () => void; /** 번호를 채운 상품 추가를 쌓인 화면으로 연다 (D-RETRO-23) */ readonly openAddAt?: (no: number) => void; readonly openManage?: () => void; /** 끝난 라이브의 [라이브 기록]을 쌓인 화면으로 연다 (D-UX4-157). 없으면(시험·웹) 이 화면 안에서 바꾼다 */ readonly openRecord?: () => void; /** 구매자 정산서를 진짜 쌓인 화면으로 연다 (D-UX4-198). 없으면(시험·웹) 정산서 화면 안에 겹쳐 그린다 */ readonly openStatement?: (buyer: string) => void; /** 'record': 쌓인 라이브 기록 화면 — 정산 내역서를 건너뛰고, 뒤로(onBack)는 정산 내역서로 (D-UX4-157) */ readonly startPage?: 'record'; readonly refresh?: number }) {
  const services = useServices()
  const { store, snapshot } = useScopeStore(broadcastId)
  const { p } = useKit()
  const inset = useBottomInset()
  const pageTop = usePageTop()
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  type SheetName = 'none' | 'youtube' | 'decide' | 'pending' | 'listen'
  const [sheet, setSheet] = useState<SheetName>('none')
  // 상품 추가·방송 관리 (D-UX4-57): 기기에서는 진짜 쌓인 화면(openAdd·openManage). 경로가 없을 때(시험·웹)만 이 화면 안에 겹쳐 그린다
  const [page, setPage] = useState<'none' | 'settings' | 'add'>('none')
  // 번호를 채워 여는 상품 추가 (D-RETRO-23) — (+)로 열면 비운다
  const [addNo, setAddNo] = useState<number | null>(null)
  // 본문 탭: 상품(번호·가격·예약) · 찜 기록(채팅찜·문자찜을 시간순으로, D-LIVETEST-07) · 채팅·문자(실시간으로 온 채팅·손님 문자, D-UX4-12)
  const [searchDigits, setSearchDigits] = useState('')
  // 찜 된 것만 보기 (D-UX4-141) — 탭을 바꿔도 남고, "그 상품 보기"에서 푼다
  const [claimedOnly, setClaimedOnly] = useState(false)
  // 목록 도구 줄(찾기·정렬)은 탭 바와 같은 붙는 머리 안에 — 스크롤을 올리면 탭 바와 함께 보인다 (D-UX4-159). 그래서 상태도 여기서 든다
  const [productSort, setProductSort] = useState<ProductSort>(DEFAULT_PRODUCT_SORT)
  const feedState = useClaimFeedState()
  const [searchPad, setSearchPad] = useState(false)
  const draggingSearch = useRef(false)
  const padOpacity = useRef(new Animated.Value(1)).current
  // 찾기 칸은 머리 오른쪽 돋보기를 눌렀을 때만 (D-UX4-201, 사용자 "검색창을 오른쪽 위에 검색 아이콘으로") — 찾는 글이 남아 있으면 계속 보인다
  const [searching, setSearching] = useState(false)
  const openSearchPad = () => {
    padOpacity.setValue(1)
    setSearchPad(true)
    // 숫자판이 열린 동안은 찾기 칸도 열려 있다 — 글을 다 지워도 칸이 사라지지 않게 (D-UX4-201)
    setSearching(true)
  }
  const closeSearchPad = useCallback(() => {
    setSearchPad(false)
    setSearching(false)
    Keyboard.dismiss()
  }, [])
  useEffect(() => {
    if (!searchPad) return
    const handler = BackHandler.addEventListener('hardwareBackPress', () => { closeSearchPad(); return true })
    return () => handler.remove()
  }, [searchPad, closeSearchPad])
  const closeSearchOnTap = () => {
    if (!draggingSearch.current) closeSearchPad()
  }
  const [tab, setTab] = useState<'products' | 'feed' | 'talk' | 'heard'>('products')
  // 라이브 채팅처럼 (D-UX3-75): 목록은 최신이 맨 아래. 처음·탭을 바꿀 때는 맨 아래에서 시작하고,
  // 맨 아래를 보고 있는 동안 새 줄이 오면 따라 내려간다. 위로 올려 보고 있으면 그대로 둔다.
  const follow = useFollowScroll()
  const { scroll, reset: resetFollow } = follow
  const scrollOffset = useRef(new Animated.Value(0)).current
  // 숫자판이 덜 올라오던 것 (D-UX4-200, 사용자 "가끔 저렇게 키보드가 다 안 올라오는 버그"): 숫자판은 목록 안에서 스크롤 위치(scrollOffset)만큼 내려 화면 아래에 둔다.
  // 목록을 내린 채 번호를 넣으면 결과가 줄어 목록이 맨 위로 당겨지는데, 이때 휴대폰이 스크롤 알림을 주지 않으면 옛 위치가 남아 그만큼 숫자판이 아래로 밀려 잘렸다.
  // 번호가 바뀌면 결과를 맨 위부터 보이고 위치 값도 직접 0으로 맞춘다 — 알림이 오든 안 오든 숫자판 자리가 맞다
  const searchTop = useRef(searchDigits)
  useEffect(() => {
    if (searchTop.current === searchDigits) return
    searchTop.current = searchDigits
    if (!searchPad) return
    scroll.current?.scrollTo({ y: 0, animated: false })
    scrollOffset.setValue(0)
  }, [searchDigits, searchPad, scroll, scrollOffset])
  const [viewportHeight, setViewportHeight] = useState(0)
  // 채팅·문자·음성 인식 탭만 라이브 채팅처럼 맨 아래(새 줄)에서 시작하고, 상품·찜 기록은 맨 위에서 (D-UX4-98 — 옛: 모든 탭이 맨 아래로 굴러가
  // 라이브 화면에 들어오거나 탭을 바꿀 때마다 목록이 아래로 튀었다)
  const bottomTab = tab === 'talk' || tab === 'heard'
  // 탭 바 숨김은 손으로 굴린 거리만 센다 — 탭을 바꾸면 보이고, 맨 아래로 바로 가거나 새 줄을 따라가도 숨지 않는다 (D-UX4-155)
  const tabHide = useTabBarHide()
  const { show: showTabs } = tabHide
  useEffect(() => {
    resetFollow()
    showTabs()
    if (bottomTab) scroll.current?.scrollToEnd({ animated: false })
    else scroll.current?.scrollTo({ y: 0, animated: false })
  }, [tab, bottomTab, scroll, resetFollow, showTabs])
  // 새로 추가한 상품을 잠깐 강조한다 — 쌓인 상품 추가 화면이 돌아오며 알려 준다 (D-UX4-57)
  const showAdded = useCallback((key: string) => {
    setTab('products')
    setSelected(key)
    scroll.current?.scrollTo({ y: 0, animated: true })
  }, [])
  // 그 상품 보기 (D-RETRO-22): 상품 탭에서 검색을 풀고 그 줄로 스크롤해 잠깐 강조한다. 줄 자리는 목록(console-list) 안에서 재고, 목록이 스크롤 내용에서 시작하는 높이를 더한다
  const rowNodes = useRef(new Map<string, RowNode>()).current
  const listNode = useRef<RowNode>(null)
  const listTop = useRef(0)
  // 붙는 머리(탭 바 + 도구 줄) 높이 — "그 상품 보기"가 그 줄을 머리 밑에 가리지 않게 (D-UX4-159)
  const tabsHeight = useRef(0)
  const showTimers = useRef(new Set<ReturnType<typeof setTimeout>>()).current
  useEffect(() => () => {
    for (const timer of showTimers) clearTimeout(timer)
    showTimers.clear()
  }, [showTimers])
  const later = useCallback((work: () => void, ms: number) => {
    const timer = setTimeout(() => {
      showTimers.delete(timer)
      work()
    }, ms)
    showTimers.add(timer)
  }, [showTimers])
  const onRow = useCallback((key: string, node: RowNode | null) => {
    if (node === null) rowNodes.delete(key)
    else rowNodes.set(key, node)
  }, [rowNodes])
  const showRow = useCallback((key: string) => {
    setTab('products')
    setSearchDigits('')
    setClaimedOnly(false)
    setSearchPad(false)
    setSelected(key)
    // 탭·검색이 바뀐 목록이 놓인 뒤에 잰다
    later(() => {
      const row = rowNodes.get(key)
      const list = listNode.current
      if (row === undefined || list === null) return
      row.measureLayout(list, (_x, y) => scroll.current?.scrollTo({ y: Math.max(0, listTop.current + y - Math.max(ROW_PEEK, tabsHeight.current + SPACE.sm)), animated: true }), () => undefined)
    }, 60)
  }, [later, rowNodes, scroll])
  /** 열려 있는 상품 자세히에서 — 같은 판 안에서 그 상품으로 바꾼다 */
  const showProduct = useCallback((key: string) => {
    showRow(key)
    setDetail(key)
  }, [showRow])
  /** 상품 추가 화면에서 — 그 화면이 닫힌 뒤에 자세히를 연다 (아이폰은 화면이 넘어가는 동안 판을 띄우지 못한다) */
  const showProductAfterBack = useCallback((key: string) => {
    showRow(key)
    if (Platform.OS === 'web') setDetail(key)
    else later(() => setDetail(key), SHOW_AFTER_BACK_MS)
  }, [showRow, later])
  const onSignal = useCallback((signal: ConsoleSignal) => {
    if (signal.kind === 'added') showAdded(signal.key)
    else showProductAfterBack(signal.key)
  }, [showAdded, showProductAfterBack])
  useConsoleSignals(broadcastId, onSignal)
  const [decideFor, setDecideFor] = useState<string | null>(null)
  // 방송자 조치 5초 대기·되돌리기 (정하기 창 — D-APPX-03). 화면이 내려가면 기다리던 조치는 보내지 않는다
  const hostQueue = useUndoQueue()
  const hostItems = useSyncExternalStore(hostQueue?.subscribe ?? noSubscribe, hostQueue?.getSnapshot ?? noItems)
  const [labels, setLabels] = useState<readonly LabelView[]>([])
  // 끝내기 성공 — 방송 목록을 다시 받지 않아도 바로 "끝난 방송"으로 (범위 기록의 방송 정보는 처음 한 번만 받는다)
  const [endedHere, setEndedHere] = useState(false)
  const [orderBuyer, setOrderBuyer] = useState<string | null>(null)
  useHoldRouteSwipe(orderBuyer !== null)
  useEffect(() => {
    if (orderBuyer === null) return
    const back = BackHandler.addEventListener('hardwareBackPress', () => { setOrderBuyer(null); return true })
    return () => back.remove()
  }, [orderBuyer])
  const [salesPage, setSalesPage] = useState<'auto' | 'sales' | 'record'>(startPage ?? 'auto')
  const labelsQueue = useSyncExternalStore(services.labels.subscribe, services.labels.getSnapshot)
  const paper = useLabelPaper(services.labels.paperDeviceId ?? null)
  // 자리를 비운 동안 줄의 라벨 몫: 뽑히는 대로 줄이고, 라벨 출력을 끄면 뺀다 (D-RETRO-141)
  const labelsLeft = labelsQueue.queue === null ? null : labelsQueue.queue.labelsEnabled ? labelsQueue.queue.waiting + labelsQueue.queue.printing : 0
  useEffect(() => {
    if (labelsLeft !== null) services.away.labelsNow(labelsLeft, Date.now())
  }, [labelsLeft, services])
  const data = snapshot.data
  const broadcast = snapshot.broadcast
  const returning = useRef<{ at: number } | null>(null)
  // 유튜브 (YT-11): 실제 방송만 — 리허설은 유튜브 요청을 보내지 않는다
  const yt = useMobileYoutube(broadcastId, broadcast !== null && !broadcast.rehearsal)

  // 앱이 뒤로 갔다 돌아옴 (APP-04)
  const finishReturn = useCallback(() => {
    if (returning.current === null) return
    returning.current = null
    // 라벨 출력이 꺼져 있으면 장 수를 보이지 않는다 (D-RETRO-141)
    services.away.back(store.getSnapshot().data?.claims.keys() ?? [], services.labels.getSnapshot().queue?.labelsEnabled === true ? services.labels.backlog : 0, Date.now())
  }, [services, store])
  useAppForeground({
    onBackground: () => services.away.leave(store.getSnapshot().data?.claims.keys() ?? [], Date.now()),
    onForeground: () => {
      returning.current = { at: Date.now() }
      void store.retryNow()
      setTimeout(finishReturn, RETURN_WAIT_MS)
    },
  })
  useEffect(() => {
    // 다시 붙어 따라잡았으면 기다리지 않고 바로 줄을 정한다
    if (returning.current !== null && snapshot.connection === 'open' && !snapshot.stale && snapshot.reconnects > 0) finishReturn()
  }, [snapshot.connection, snapshot.stale, snapshot.reconnects, snapshot.data?.seq, finishReturn])

  // 라벨 상태 (실제 방송만) — 범위 기록이 바뀌면 조금 뒤 다시 받는다
  const seq = data?.seq ?? 0
  const rehearsal = broadcast?.rehearsal ?? true
  useEffect(() => {
    if (broadcast === null || rehearsal || data === null) return
    let alive = true
    const handle = setTimeout(() => {
      get<{ labels: LabelView[] }>(withQuery('/api/print/labels', { date: broadcast.date })).then(
        (view) => {
          if (alive) setLabels(view.labels)
        },
        () => {
          // 라벨 상태는 다음 변경 때 다시 받는다
        },
      )
    }, 300)
    return () => {
      alive = false
      clearTimeout(handle)
    }
  }, [broadcast, rehearsal, seq, labelsQueue.queue?.rev, data === null])

  const buyers = data?.buyers
  const claims = data?.claims
  const products = data?.products
  const sales = useMemo(() => claims && products ? broadcastSales(claims, products, broadcastId) : null, [claims, products, broadcastId])
  const hideSuffix = labelsQueue.queue?.hideNicknameSuffix === true
  const names = useMemo(() => (buyers && claims ? new BuyerNames(buyers, claims, hideSuffix) : null), [buyers, claims, hideSuffix])
  const labelWords = useMemo(() => {
    const map = new Map<string, string>()
    for (const label of labels) if (label.claim !== null && label.word !== '') map.set(label.claim, label.word)
    return map
  }, [labels])

  const ended = justEnded || endedHere || broadcast?.ended === true || data?.broadcasts.get(broadcastId)?.ended === true
  // 이 화면을 보는 동안 방송이 끝났다(판매자가 끝냄 · 플랫폼에서 끝나 저절로 끝남) — 정산 화면으로 넘어가며 정산 정보가 비어 있으면 묻는다 (D-RETRO-63)
  const sawLive = useRef(false)
  if (broadcast !== null && data !== null && !ended) sawLive.current = true
  const endedNow = justEnded || endedHere || (ended && sawLive.current)
  const sealed = data?.sealed ?? false
  // 라이브 화면은 흰 바탕 (D-UX4-201, 사용자 "배경도 흰색으로" — 토스 거래 내역처럼) — 상태 막대 자리도 흰색. 정산서(회색 카드 화면)일 때는 알리지 않는다
  useWhiteTop(!(salesPage === 'sales' || ((ended || sealed) && salesPage === 'auto')))
  // 방송 연결 전체 화면 (D-UX3-06·07): 아직 잇지 않은 방송이면 주소 칸은 본문에, [확인]는 맨 아래(주소를 넣어야 보인다) — 아니면 유튜브 칸 그대로.
  // 훅이라 이른 return보다 앞에 둔다
  const linkable = canLinkByAddress(yt, ended || sealed)
  // 방송 연결 화면에서 돌아오면 잇기 상태를 다시 받는다
  const { reload: reloadYoutube } = yt
  useEffect(() => {
    if (refresh > 0) void reloadYoutube()
  }, [refresh, reloadYoutube])
  const showLink = () => {
    if (openLink === undefined) setSheet('youtube')
    else {
      setSheet('none')
      openLink(ended || sealed)
    }
  }
  const linker = useAddressLinker({ enabled: sheet === 'youtube' && linkable, webChat: yt.webChat, broadcastId, submit: async (request) => {
      const view = await sendLiveLink(broadcastId, request)
      if (view === null) setSheet('none')
      else yt.setLink(view)
    } })
  const command = useScopeCommand(store)
  const linked = hasLinkedLive(yt)

  // 방송이 끝나면 음성도 끈다 (APP-02 "방송 끝")
  const voiceView = useSyncExternalStore(services.voice.subscribe, services.voice.getView)
  const live = seller && broadcast !== null && !ended && !(data?.sealed ?? false)
  const dock = useDockChoice()
  const docked = live && dock !== 'none'
  // 화면 아래 창과 같은 것을 탭으로 또 보이지 않는다 (D-UX4-91, 사용자 지시 2026-11-10 "화면아래창을 채팅문자로 선택했으면 해당 탭을 숨겨서 중복으로 안 보이게"):
  // 아래 창이 채팅·문자면 채팅·문자 탭을, 들린 말이면 들린 말 탭을 숨긴다. 들린 말 탭은 판매자만(듣기는 판매자 일)
  const showTalkTab = !(live && dock === 'talk')
  const showHeardTab = seller && !(live && dock === 'voice')
  const shownTab = (tab === 'talk' && !showTalkTab) || (tab === 'heard' && !showHeardTab) ? 'products' : tab
  useEffect(() => {
    setSearchPad(false)
    setSearchDigits('')
  }, [broadcastId, shownTab])

  // 방송 소리 듣기는 앱 뿌리가 붙잡는다 — 이 화면을 나가도 계속 듣는다 (D-UX3-48). 방송이 끝났거나 닫혔으면 놓는다
  const streamTitle = broadcast === null || broadcast.title.trim() === '' ? '제목 없음' : broadcast.title
  const knownOver = broadcast !== null && !live
  useEffect(() => {
    if (live) services.streamKeep.keep(broadcastId, streamTitle)
    else if (knownOver) services.streamKeep.release(broadcastId)
  }, [live, knownOver, broadcastId, streamTitle, services])
  const stream = useKeptStream(services.streamKeep, broadcastId)

  // 채팅 의심 표시 (D-V3-129): 방송 중·판매자일 때 20초마다 읽는다 — 등록을 바꾸지 않고 줄에 문장만
  const [doubts, setDoubts] = useState<ReadonlyMap<number, string>>(new Map())
  useEffect(() => {
    if (!live) return
    let stop = false
    const read = () => {
      get<{ doubts: readonly { no: number; text: string }[] }>(`/api/broadcasts/${encodeURIComponent(broadcastId)}/voice-doubts`).then((body) => {
        if (!stop) setDoubts(new Map(body.doubts.map((doubt) => [doubt.no, doubt.text])))
      }, () => undefined)
    }
    read()
    const timer = setInterval(read, DOUBT_POLL_MS)
    return () => { stop = true; clearInterval(timer) }
  }, [live, broadcastId])

  // 상품이 없는 새 방송이 유튜브에 이어져 있지 않으면 연결 화면을 한 번 연다 — 새 방송 화면에서 주소 단계를 이미 거쳤으면 열지 않는다 (D-UX3-06)
  const askedLink = useRef(wasLinkAsked(broadcastId))
  const productCount = data === null ? -1 : boardProducts(data, broadcastId).length
  useEffect(() => {
    if (askedLink.current || yt.phase !== 'ready' || yt.link === null || yt.link.link !== null) return
    if (ended || broadcast === null || (data?.sealed ?? true) || productCount !== 0) return
    askedLink.current = true
    if (openLink !== undefined) openLink(false)
    else setSheet((now) => (now === 'none' ? 'youtube' : now))
  }, [yt.phase, yt.link, ended, broadcast, data?.sealed, productCount])
  useEffect(() => {
    if (ended && voiceView.on && voiceView.broadcastId === broadcastId) void services.voice.turnOff()
  }, [ended, voiceView.on, voiceView.broadcastId, broadcastId, services])

  // 받은 뒤에야 생기는 목록은 부드럽게 — 기억해 둔 자료로 처음부터 그리면 바로 (D-UX4-112)
  const listLate = useCameLate(data !== null && broadcast !== null && names !== null)
  const frame = (body: ReactNode) => (
    <View style={{ flex: 1, backgroundColor: p.background }}>
      <View style={{ height: pageTop }} />
      <AppHeader title="라이브" onBack={onBack} backLabel="홈으로" />
      <View style={{ paddingHorizontal: SPACE.lg, gap: SPACE.md }}>{body}</View>
    </View>
  )
  if (snapshot.phase === 'missing') {
    return frame(
      <>
        <Notice tone="danger" alert>
          그 라이브를 찾지 못했어요. 홈에서 다시 골라 주세요.
        </Notice>
        <BigButton label="홈으로" onPress={onBack} />
      </>,
    )
  }
  if (snapshot.phase === 'error' && snapshot.error !== null) {
    return frame(
      <>
        <Notice tone="danger" alert>
          {snapshot.error.message}
        </Notice>
        <BigButton label={RETRY_NOW} onPress={() => void store.retryNow()} />
        <BigButton kind="outline" label="홈으로" onPress={onBack} />
      </>,
    )
  }
  // 아직 자료가 없으면 바탕만 (D-UX4-83 — 옛: 빙글이 + "불러오는 중…"). 오래 끊긴 때의 연결 줄만 보인다
  if (data === null || broadcast === null || names === null || sales === null) {
    return frame(<LiveNotice snapshot={snapshot} onRetry={() => void store.retryNow()} />)
  }

  const api: ConsoleApi = { b: broadcastId, data, names, ended, sealed, command, sync: (seq) => store.sync(seq), latest: () => store.getSnapshot().data ?? data, select: setSelected, selected, labelWords, labelsOff: seller && !sealed && !rehearsal && labelsQueue.queue?.labelsEnabled === false, ...(seller && !sealed && !rehearsal && labelsQueue.queue?.labelsEnabled ? { productLabels: labels } : {}), doubts }
  const detailProduct = detail === null ? undefined : data.products.get(detail)
  const title = broadcast.title.trim() === '' ? '제목 없음' : broadcast.title
  const closed = ended || sealed
  // 홈 "지금 라이브 중"과 같은 말로 (D-UX3-89 — 옛 "방송 중")
  const heading = ended ? '끝난 라이브' : '라이브'
  const help = closed ? '끝난 라이브예요. 늦게 온 채팅·문자찜은 처리돼요.' : !seller ? VOICE_SELLER_ONLY : null
  if (salesPage === 'sales' || (closed && salesPage === 'auto')) {
    // 머리는 정산서 화면이 그린다 — 정산 정보 화면(오른쪽에서 밀려 들어옴)이 상태 막대 자리·머리까지 덮게 (D-UX4-184, 라이브 화면 D-UX4-51과 같은 자리 칸)
    return <BroadcastSalesList {...{ broadcastId, title, sales, inset, names, sealed, rehearsal }} date={broadcast.date} buyer={orderBuyer} select={setOrderBuyer} {...(openStatement === undefined ? {} : { openBuyer: openStatement })} justEnded={seller && endedNow && focused}
      header={<>
        <View style={{ height: pageTop }} />
        {/* 제목 "정산서" (D-UX4-170, 사용자 지시 2026-11-16 "화면 제목 \"정산서\"로 바꿔" — 옛 "정산 내역서") */}
        {/* 구매자 정산서는 이 머리 위로 밀려 들어오는 다음 화면이라 이 머리는 늘 "정산서" (D-UX4-192 — 옛: 같은 자리에서 "구매자 정산서"로 바뀜) */}
        <AppHeader title="정산서" onBack={closed ? onBack : () => setSalesPage('auto')} right={closed ? <HeaderTextButton label="라이브 기록" onPress={() => (openRecord === undefined ? setSalesPage('record') : openRecord())} /> : undefined} />
        <LiveNotice snapshot={snapshot} onRetry={() => void store.retryNow()} />
      </>} />
  }
  const close = () => setSheet('none')
  const closePage = () => setPage('none')
  // 끝난 라이브 기록에서 뒤로는 정산 내역서로 (D-UX4-157 — 옛: 홈으로). 쌓인 화면이면 onBack이 정산 내역서로 돌아가고, 이 화면 안에서 바꿨으면 되돌린다
  const fromSales = closed && salesPage === 'record'
  const consoleBack = fromSales && startPage === undefined ? () => setSalesPage('auto') : onBack
  // 다육이 방송이면 상품 추가에서 품종도 묻는다 (D-UX4-31 — 판매 종류는 방송 제목에 들어 있다, NewBroadcastScreen)
  const askName = broadcast.title.includes('다육이')
  // 등록 안 된 번호의 찜 (D-RETRO-23): 번호를 누르면 그 번호가 채워진 상품 추가 — 기기는 쌓인 화면, 경로가 없으면(시험·웹) 이 화면 안에
  const unlisted = closed ? [] : unlistedNumbers(data, broadcastId)
  const addAt = (no: number) => {
    if (openAddAt !== undefined) openAddAt(no)
    else if (openAdd !== undefined) openAdd()
    else {
      setAddNo(no)
      setPage('add')
    }
  }
  const claimCount = [...data.claims.values()].filter((claim) => claim.broadcast === broadcastId && claim.status !== 'DUPLICATE').length
  const productCountNow = shownProducts(data, broadcastId).length
  const onAlert = (action: 'pending' | 'attention' | 'decide' | 'labels') => {
    if (action === 'pending') setSheet('pending')
    else if (action === 'attention') openReviews?.()
    else if (action === 'decide') { setDecideFor(null); setSheet('decide') }
    else openLabels?.()
  }

  const padInset = docked ? SPACE.sm : Math.max(inset, SPACE.sm)
  /** (+) 단추·매출 캡슐의 아래 자리 */
  const fabBottom = (docked ? 0 : Math.max(inset, SPACE.md)) + SPACE.md
  const padHeight = DIGIT_PAD_HEIGHT + padInset + 1
  /** 탭을 바꾸면 찾기 칸을 접는다(찾는 글은 탭마다 남는다) */
  const pickTab = (next: typeof tab) => {
    if (searchPad) closeSearchPad()
    else setSearching(false)
    setTab(next)
  }
  const tabPills = (
    <>
      <LineTab on={shownTab === 'products'} label={`상품 ${String(productCountNow)}`} ariaLabel="상품" onPress={() => pickTab('products')} />
      <LineTab on={shownTab === 'feed'} label={`찜 기록 ${String(claimCount)}`} ariaLabel="찜 기록" onPress={() => pickTab('feed')} />
      {showTalkTab ? <LineTab on={shownTab === 'talk'} label={TALK_TAB} ariaLabel={TALK_TAB} onPress={() => pickTab('talk')} /> : null}
      {showHeardTab ? <LineTab on={shownTab === 'heard'} label={HEARD_TAB} ariaLabel={HEARD_TAB} onPress={() => pickTab('heard')} /> : null}
    </>
  )
  // 돋보기: 상품 탭은 번호 숫자판, 찜 기록 탭은 닉네임 키보드 (D-UX4-201)
  const canSearch = (shownTab === 'products' && (searchDigits !== '' || productCountNow > 0)) || (shownTab === 'feed' && feedRows(data, names, broadcastId).length > 0)
  const startSearch = () => {
    tabHide.show()
    setSearching(true)
    if (shownTab === 'products') openSearchPad()
  }

  return (
    <ConsoleContext.Provider value={api}>
      <View style={{ flex: 1, backgroundColor: p.surface }} testID="console-screen"
        onTouchEnd={searchPad ? closeSearchOnTap : undefined}
        onPointerUp={searchPad ? closeSearchOnTap : undefined}>
        {/* 상태 막대 자리 (D-UX4-51): 겹쳐 뜨는 화면은 이 자리까지 덮는다 */}
        <View style={{ height: pageTop }} />
        <AppHeader
          title={heading}
          onBack={consoleBack}
          backLabel={fromSales ? '정산서로' : '홈으로'}
          // 오른쪽 위 돋보기 · ⋯ (D-UX4-201, 사용자 "검색창을 오른쪽 위에 검색 아이콘으로 하고, 관리 버튼도 ... 버튼으로" — 토스 거래 내역 머리처럼. 옛: "관리" 글자 단추 D-UX4-42)
          right={<>
            {canSearch ? <HeaderIconButton icon="search" label={shownTab === 'products' ? '상품 번호 검색 열기' : '찜 기록 찾기 열기'} testID="console-search" onPress={startSearch} /> : null}
            <HeaderIconButton icon="more" label={MANAGE_LABEL} testID="console-more" onPress={() => (openManage === undefined ? setPage('settings') : openManage())} />
          </>}
        />
        {help !== null ? (
          <View style={{ paddingHorizontal: SPACE.xl, paddingBottom: SPACE.sm }}>
            <Txt step="caption" color="textSub">
              {help}
            </Txt>
          </View>
        ) : null}
        {/* 목록 자리 — (+) 단추는 이 자리 오른쪽 아래(들린 말 창 위)에 뜬다 */}
        <View style={{ flex: 1 }}>
        <Animated.ScrollView
          onLayout={event => setViewportHeight(event.nativeEvent.layout.height)}
          removeClippedSubviews={false}
          testID="console-scroll"
          ref={scroll}
          // 숫자판을 즉시 숨기되 손을 뗄 때까지 레이아웃을 유지해야 iOS가 첫 스크롤을 계속 받는다.
          onScrollBeginDrag={() => {
            follow.begin()
            tabHide.drag(true)
            draggingSearch.current = searchPad
            if (searchPad) padOpacity.setValue(0)
            // 찜 기록 찾기 칸의 키보드는 목록을 끌기 시작하면 바로 내린다 (D-UX4-200, 사용자 "스크롤 시작하면 키보드 내려가게") —
            // 상품 번호 숫자판은 위처럼 손을 뗄 때 닫는다(첫 드래그를 이어 가야 해서 지금 칸을 놓지 않는다)
            else Keyboard.dismiss()
          }}
          onScrollEndDrag={(event) => {
            follow.end(event)
            tabHide.drag(false)
            if (draggingSearch.current) closeSearchPad()
            draggingSearch.current = false
          }}
          onMomentumScrollBegin={() => tabHide.glide(true)}
          onMomentumScrollEnd={() => tabHide.glide(false)}
          scrollEventThrottle={16}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollOffset } } }], {
            useNativeDriver: Platform.OS !== 'web',
            listener: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
              if (Platform.OS === 'web' && searchPad) closeSearchPad()
              tabHide.track(event.nativeEvent.contentOffset.y)
              if (bottomTab) follow.track(event)
            },
          })}
          onContentSizeChange={() => { if (bottomTab) follow.contentChanged() }}
          // 탭 바 반고정 (D-UX4-93 → 98 → 104 → 109 → 155): 휴대폰이 직접 하는 붙는 머리 — 목록을 올리면 숨고 내리면 맨 위에 붙어 보인다. 둘째 자식(탭 바)
          // D-UX4-104가 숨기기를 뺐다가 사용자 "올릴 때 탭 바 안 숨는데?"로 되살렸다 — "움직임"은 당길 때 늘어나는 것이었다(D-UX4-108)
          // 숨기기는 휴대폰 것(stickyHeaderHiddenOnScroll) 대신 손으로 굴린 거리만 세는 tabHide (D-UX4-155 — 채팅·문자 탭에 들어가자마자 숨었다)
          stickyHeaderIndices={STICKY_TABS}
          // 당겨도 늘어나지 않는다 (D-UX4-108, 사용자 지시 2026-11-10 "스크롤 땡기면 여전히 이렇게 늘어나는데?"): 아이폰 튕김·안드로이드 늘임을 끈다 — 탭 바가 맨 위에서 끌려 내려오지 않게
          bounces={false}
          overScrollMode="never"
          style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, paddingHorizontal: GUTTER, paddingBottom: (docked ? 0 : Math.max(inset, SPACE.md)) + SPACE.xl + (searchPad ? padHeight : 0), gap: SPACE.sm }} keyboardShouldPersistTaps={searchPad ? 'always' : 'handled'}>
          {/* 첫째 자식: 탭 바 위 알림들 (한 묶음 — 붙는 머리 자리가 늘 둘째가 되게) */}
          <View style={{ gap: SPACE.sm }}>
            <AwayLine onLabels={() => (openManage === undefined ? setPage('settings') : openManage())} />
            <LiveNotice snapshot={snapshot} onRetry={() => void store.retryNow()} />
            {sealed ? <Notice tone="info">30일이 지나 봉인한 날짜예요. 볼 수만 있어요.</Notice> : null}
            {labelsQueue.mine && labelsQueue.queue?.labelsEnabled && paper !== null && paper <= LOW_PAPER ? <Notice tone="warning" alert>{`라벨 용지가 약 ${paper}장 남았어요. 새 롤을 준비해 주세요.`}</Notice> : null}
            {/* 매출은 이 줄에서 빼 화면 아래 (+) 왼쪽 캡슐로 (D-UX4-140) — 알림이 없으면 이 자리는 비운다 */}
            <AlertStrip counts={alertCounts(data)} queue={labelsQueue.queue} rehearsal={broadcast.rehearsal} ended={ended} onAction={onAlert} />
            <UnlistedClaims numbers={unlisted} onAdd={addAt} />
            {hostQueue !== null ? <UndoStrip items={hostItems} queue={hostQueue} /> : null}
            <YoutubeWarning yt={yt} closed={closed} />
            <VoicePanel session={services.voice} broadcastId={broadcastId} title={title} seller={seller} ended={ended} listen={services.streamKeep.listen} />
          </View>
          {/* 둘째 자식: 탭 바 — 위에 붙을 때 밑 목록이 비치지 않게 바탕을 칠하고 화면 끝까지 */}
          {/* 위 여백은 탭 바 안에(TABS_TOP) — 목록 줄 사이(gap)를 위로 지워, 맨 위에 있을 때와 올리다 붙었을 때 머리↔알약 여백이 같다 (D-UX4-110) */}
          {/* 붙는 머리 칸(자리·여백)과 그 안에서 위로 밀려 숨는 탭 바(바탕·안 여백) — 칸 스타일은 휴대폰 붙는 머리가 가져가 숨김 이동을 따로 둔다 (D-UX4-155) */}
          {/* 칸은 누름을 받지 않는다(box-none, 붙는 머리 겉 칸도 같은 스타일) — 탭 바가 숨은 자리 밑의 목록 줄이 눌린다 */}
          <View testID="console-tabs-slot" collapsable={false} pointerEvents="box-none" onLayout={(event) => { tabHide.onLayout(event); tabsHeight.current = event.nativeEvent.layout.height }} style={{ marginHorizontal: -GUTTER, marginTop: -SPACE.sm, marginBottom: -SPACE.xs, pointerEvents: 'box-none' }}>
            <Animated.View testID="console-tabs" style={{ paddingHorizontal: GUTTER, paddingTop: TABS_TOP, paddingBottom: SPACE.xs, backgroundColor: p.surface, transform: [{ translateY: tabHide.offset }] }}>
              {/* 밑줄 글자 탭 (D-UX4-201, 사용자 "탭도 사진1 스타일로" — 토스 거래 내역 [전체 카드 입·출금…]): 화면 끝까지 옅은 선, 고른 탭은 굵은 검정 글·검정 밑줄. 넘치면 옆으로 민다 */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -GUTTER, borderBottomWidth: 1, borderBottomColor: p.border }} contentContainerStyle={{ paddingHorizontal: GUTTER - LINE_TAB_PAD + SPACE.xs }}>
                <View role="tablist" aria-label="보기" style={{ flexDirection: 'row' }}>
                  {tabPills}
                </View>
              </ScrollView>
              {/* 지금 탭의 도구 줄 — 탭 바와 한 칸이라 손으로 내리면 같이 숨고 올리면 같이 나온다 (D-UX4-159, 사용자 "둘 다 같은 영역에 넣어서 스크롤 올리면 같이 보이게 해") */}
              {shownTab === 'products' && (searchDigits !== '' || shownProducts(data, broadcastId).length > 0) ? (
                <View testID="console-toolbar" style={{ paddingTop: SPACE.md }}>
                  <ProductToolbar query={searchDigits} onQuery={setSearchDigits} claimedOnly={claimedOnly} onClaimedOnly={setClaimedOnly} sort={productSort} onSort={setProductSort} numberSearch={{ open: openSearchPad, submit: closeSearchPad }} searchShown={searching || searchDigits !== ''} searchFill={p.surfaceAlt} searchFocus={searching} />
                </View>
              ) : shownTab === 'feed' && feedRows(data, names, broadcastId).length > 0 ? (
                <View testID="console-toolbar" style={{ paddingTop: SPACE.md }}>
                  <ClaimFeedToolbar {...feedState} searchShown={searching || feedState.query !== ''} searchFill={p.surfaceAlt} searchFocus={searching} onSearchBlur={() => setSearching(false)} />
                </View>
              ) : null}
            </Animated.View>
          </View>
          {/* 목록 붙이기 (D-UX3-81 — D-UX3-77을 바꿈): 채팅·문자는 라이브 채팅처럼 화면 아래에, 상품·찜 기록은 위에 */}
          <View testID="console-list" ref={listNode} collapsable={false} onLayout={(event) => { listTop.current = event.nativeEvent.layout.y }} style={{ flexGrow: 1, justifyContent: shownTab === 'talk' || shownTab === 'heard' ? 'flex-end' : 'flex-start' }}>
            <Appear instant={!listLate} style={{ flexGrow: 1, justifyContent: shownTab === 'talk' || shownTab === 'heard' ? 'flex-end' : 'flex-start' }}>
              {shownTab === 'products' ? <ProductList key={broadcastId} onOpen={setDetail} query={searchDigits} onQuery={setSearchDigits} claimedOnly={claimedOnly} onClaimedOnly={setClaimedOnly} numberSearch={{ open: openSearchPad, submit: closeSearchPad }} onRow={onRow} toolbar={false} sort={productSort} onSort={setProductSort} /> : shownTab === 'feed' ? <ClaimFeed onOpenProduct={setDetail} onEditProduct={setDetail} toolbar={false} query={feedState.query} onQuery={feedState.onQuery} sort={feedState.sort} onSort={feedState.onSort} /> : shownTab === 'heard' ? <HeardTab session={services.voice} broadcastId={broadcastId} live={!closed} /> : <LiveTalk />}
            </Appear>
          </View>
          {/* (+) 단추·매출 캡슐에 마지막 줄이 가리지 않게 */}
          {shownTab === 'products' ? <View style={{ height: 72 }} /> : null}
          {shownTab === 'products' && searchPad ? (
            // 숫자 키에서 시작한 드래그도 목록의 네이티브 스크롤이 받도록 같은 ScrollView에 둔다.
            <Animated.View style={{ position: 'absolute', opacity: padOpacity, zIndex: 12, left: 0, right: 0, top: Math.max(0, viewportHeight - padHeight), transform: [{ translateY: scrollOffset }] }}>
              <Appear distance={padHeight} style={{ ...SHADOW.sheet, backgroundColor: p.surface, borderTopWidth: 1, borderTopColor: p.line }}>
                <View onTouchEnd={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}
                  style={{ paddingBottom: padInset }}>
                  <NumberKeys inScrollView doubleZero={false} onKey={key => setSearchDigits(value => key === 'back' ? value.slice(0, -1) : value + key)} />
                </View>
              </Appear>
            </Animated.View>
          ) : null}
        </Animated.ScrollView>
        {shownTab === 'products' && !closed && !searchPad ? <AddFab bottom={fabBottom} onPress={() => { if (openAdd === undefined) { setAddNo(null); setPage('add') } else openAdd() }} /> : null}
        {/* 매출 캡슐 (D-UX4-140): (+) 왼쪽 — 숫자판을 연 동안은 (+)처럼 숨는다 */}
        {shownTab === 'products' && !searchPad ? <SalesPill closed={closed} total={sales.total} bottom={fabBottom} besideFab={!closed} onPress={startPage === 'record' ? onBack : () => setSalesPage('sales')} /> : null}
        </View>
        {/* 확인 중(임시 등록) 상품 확인 카드 (D-RETRO-90): 목록과 아래 창 사이, 한 번에 한 장 — 어느 탭에서든 같은 자리에 뜬다 */}
        {closed ? null : <TentativeCards onEdit={setDetail} bottom={docked ? SPACE.sm : Math.max(inset, SPACE.sm)} />}
        {/* 들린 말 창은 맨 아래 (D-UX4-53 — 옛 목록 위) */}
        {/* 맨 아래 창은 관리 "화면 아래 창"에서 고른 것 (D-UX4-71): 들린 말 · 채팅·문자 · 안 보기 */}
        {/* 음성 창 오른쪽 끝: 지금 듣는 쪽 표시 — 누르면 소리 듣기 고르는 판 (D-RETRO-72) */}
        {live && dock === 'voice' ? <ListenLine session={services.voice} broadcastId={broadcastId} stream={stream} bottom={Math.max(inset, SPACE.sm)} source={<ListenSourceChip session={services.voice} keep={services.streamKeep} broadcastId={broadcastId} stream={stream} onPress={() => setSheet('listen')} />} /> : null}
        {live && dock === 'talk' ? <TalkDock bottom={Math.max(inset, SPACE.sm)} /> : null}

        {/* 상품 자세히 (D-UX4-30): 번호·품종·가격은 판 안 점선 칸이 보이므로 판 제목은 두지 않는다 */}
        {/* 고치기는 반 화면 판 · 확인 시 저장 (D-UX4-106) */}
        <ProductSheet product={detailProduct} onClose={() => setDetail(null)} onKey={setDetail} onShow={showProduct} {...(seller && !sealed && detailProduct !== undefined ? { onDecide: () => { setDecideFor(detailProduct.key); setDetail(null); setSheet('decide') } } : {})} />
        <BottomSheet visible={sheet === 'decide'} onClose={close} title="정하기">
          {sheet === 'decide' && hostQueue !== null ? <DecisionsView queue={hostQueue} {...(decideFor === null || data.products.get(decideFor) === undefined ? {} : { product: data.products.get(decideFor) })} onQueued={close} /> : null}
        </BottomSheet>
        {live ? <ListenSourceSheet visible={sheet === 'listen'} onClose={close} session={services.voice} keep={services.streamKeep} broadcastId={broadcastId} title={streamTitle} stream={stream} /> : null}
        <BottomSheet visible={sheet === 'pending'} onClose={close} title="보류 찜">
          {/* 확인 중 상품의 번호로 온 찜도 여기서 기다린다 (D-RETRO-90) */}
          <Txt step="caption" color="textSub">아직 상품이 없거나 확인 중인 번호의 찜이에요. 그 번호 상품을 올리거나 확정하면 먼저 온 순서대로 정해져요.</Txt>
          {sheet === 'pending' ? <ClaimFeed only="PENDING" /> : null}
        </BottomSheet>
        <ProductAddPage
          visible={page === 'add'}
          onClose={closePage}
          askName={askName}
          onAdded={(key) => {
            closePage()
            showAdded(key)
          }}
          onShow={(key) => {
            closePage()
            showProductAfterBack(key)
          }}
          {...(addNo === null ? {} : { startNo: addNo })}
        />
        {/* 방송 관리 (D-UX4-20 → D-UX4-57): 경로가 없을 때(시험·웹)만 이 화면 안에 겹쳐 그린다 — 라이브 정보·라벨 줄을 바로 두는 것(D-UX4-130)은 경로 화면만, 여기는 "라이브 연결 ›" 판으로 */}
        <SlidePage visible={page === 'settings'} onClose={closePage} title={MANAGE_LABEL} name={MANAGE_LABEL} testID="console-settings">
          <ConsoleManage
            broadcastId={broadcastId}
            seller={seller}
            title={title}
            rehearsal={broadcast.rehearsal}
            closed={closed}
            canLink={yt.phase !== 'hidden' && yt.phase !== 'loading'}
            stream={stream}
            onClose={closePage}
            onShowLink={showLink}
          />
        </SlidePage>
        {/* 방송 연결은 전체 화면 (D-UX3-06) — 키보드가 주소 칸을 가리지 않게 */}
        <FullSheet visible={sheet === 'youtube'} onClose={close} name="라이브 연결" title={linkable ? (linker.confirming ? LINK_CONFIRM_TITLE : LINK_ASK_TITLE) : '라이브 연결'} cards={!linkable && !linked} overlay={linkable ? linker.popup : undefined} actions={linkable ? (
            // 연결 확인 (D-UX4-117): 경로가 아닌 판에서는 같은 판 안에서 내용만 바꾼다 — [이전]은 링크 칸으로
            linker.confirming ? (
              <>
                <BigButton kind="outline" label="이전" onPress={linker.back} />
                {linker.confirmAction}
              </>
            ) : (
              <>
                <BigButton kind="outline" label="나중에 연결" onPress={close} />
                {linker.action}
              </>
            )
          ) : undefined}>
          {linkable && linker.confirming ? (
            linker.confirmBody
          ) : linkable ? (
            <>
              <View role="group" aria-label="유튜브">
                {linker.fields}
              </View>
            </>
          ) : linked ? (
            // 이은 라이브: 흰 바탕 정보 줄 + 라이브 바로가기 · 라이브 연결 끊기 (D-UX4-95·107)
            <LinkInfo broadcastId={broadcastId} yt={yt} closed={closed} bleed {...(seller ? { onEnded: () => { setEndedHere(true); close(); closePage(); onEnded?.() } } : {})} />
          ) : (
            <YoutubeSection yt={yt} closed={closed} />
          )}
          {/* 라이브 연결 끊기 (D-UX4-79) — 이은 라이브는 LinkInfo 안에 있다 */}
          {seller && !closed && !linked ? <EndBroadcastRow broadcastId={broadcastId} onEnded={() => { setEndedHere(true); close(); closePage(); onEnded?.() }} /> : null}
        </FullSheet>
      </View>
    </ConsoleContext.Provider>
  )
}

/** 밑줄 글자 탭 안쪽 양옆 여백 */
const LINE_TAB_PAD = SPACE.sm + 2

/**
 * 라이브 화면 탭 하나 (D-UX4-201 — 옛 알약 Pill): 토스 거래 내역 탭처럼 글자만, 고르면 굵은 검정 글과 글 폭만큼 검정 밑줄(탭 줄 아래 옅은 선 위에 겹친다),
 * 안 고르면 회색 글. 포인트 색은 쓰지 않는다
 */
function LineTab({ on, label, ariaLabel, onPress }: { readonly on: boolean; readonly label: string; readonly ariaLabel: string; readonly onPress: () => void }) {
  const { p } = useKit()
  return (
    <Tap role="button" aria-label={ariaLabel} aria-selected={on} onPress={onPress} pressScale={1} style={({ pressed }) => ({ minHeight: TOUCH.min, paddingHorizontal: LINE_TAB_PAD, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
      <Txt step="nav" weight={on ? 'bold' : 'medium'} ink={on ? p.text : p.borderStrong} numberOfLines={1}>
        {label}
      </Txt>
      {on ? <View aria-hidden testID="line-tab-bar" style={{ position: 'absolute', left: LINE_TAB_PAD - 2, right: LINE_TAB_PAD - 2, bottom: -1, height: 2.5, borderRadius: 2, borderCurve: 'continuous', backgroundColor: p.text }} /> : null}
    </Tap>
  )
}
