// 주문 탭 (D-APPX-01 → D-UX4-122 → D-UX4-125, 사용자 지시 2026-11-11 "주문 탭 수정 사항").
// 맨 위 "주문" 머리·날짜 캡슐은 없앴다. 맨 위에 단추 셋 [고객 정보 받기] [정산서 보내기] [입금 확인하기]를 한 줄로,
// 그 아래 토스 거래 내역(사진1)처럼 흰 바탕에 카드·구분선 없이 주문 목록: 왼쪽 날짜(그 날짜 첫 줄에만) · 성함(굵게)과 그 아래 작은 닉네임 · 오른쪽 총 금액과 그 아래 총 상품 개수.
// 줄을 누르면 주문 상세(OrderDetailScreen, 사진2). 날짜를 넘어 최근 주문부터 서버 GET /api/orders, 끝까지 내리면 다음 쪽(?before=)을 잇는다.
// D-UX4-126 (사용자 지시 2026-11-11): 날짜는 11.7처럼, 줄은 닉네임(굵게) 아래 작은 성함, 모르는 손님 정보는 그 아래 빨간 "성함 · 휴대폰 번호 · 주소 모름".
// 옛 진행 카드·지금 할 일 카드·단계 칸·끝난 손님 접기(D-UX4-122)는 사용자가 이 모양으로 바꿨다. 금액은 서버(엔진)가 정한 정수 원 그대로.
// D-ORDPAY-01 (판매자 요청 2026-11-20 "주문 탭에서 입금이 완료됐는지 체크 표시 — 입금 목록 체크박스"): 줄 오른쪽 끝에 입금 체크 칸.
//   다 받음(PAID·더 받음)은 초록 체크, 덜 받음은 빈 칸 + 금액 아래 주황 "n원 남음", 안 받음은 빈 칸. 빈 칸을 누르면 주문 상세 [입금을 확인했나요?]와
//   같은 가운데 팝업 [아니요] [확인했어요] → 남은 금액만큼 입금을 적어 다 받은 것으로(같은 settlement.payment). 체크된 칸·30일 지난 날짜는 누를 수 없다.
import { useEffect, useRef, useState } from 'react'
import { ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import type { OrderRow, OrdersView } from '@livejjim/web/src/api/order-types.ts'
import { dateWords } from '@livejjim/web/src/lib/kst.ts'
import type { WriteResult } from '@livejjim/web/src/api/types.ts'
import { get, isApiError, newRequestId, post, withQuery, withRetry, type ApiError } from '../api/client.ts'
import { useCachedGet } from '../lib/cached-get.ts'
import { countWords, dotDate, joinOrders, missingWords, NO_ORDERS, ORDERS_PATH, ORDERS_TOPIC, useOrdersLive } from '../lib/orders.ts'
import { signalScreens, useScreenSignal } from '../lib/screen-signals.ts'
import { NOT_APPLIED_SETTLEMENT, remainingOf } from '../lib/settle.ts'
import { formatWon, RETRY_NOW } from '../lib/words.ts'
import { Appear, BigButton, EmptyFill, Icon, PopupDialog, Txt, useKit, useTabBarRoom, useWhiteTop, Tap } from '../ui/kit/index.ts'
import { RADIUS, SPACE, TOUCH } from '../ui/kit/tokens.ts'
import { Loading, Notice } from '../ui/parts.tsx'
import { useCameLate } from '../ui/late.tsx'
import { useBuyerInfoList } from './BuyerInfoScreen.tsx'
import { ASK_PAID, OrderDetailScreen, PAID_CONFIRM } from './OrderDetailScreen.tsx'

export interface SettleNavigation {
  /** 입금 확인 화면 (입금 한꺼번에) */
  readonly openDeposits?: () => void
  /** 손님 정보 문자 화면 (ORD-14) */
  readonly openBuyerInfo?: () => void
  /** 확인서(정산서) 보내기 화면 (D-UX3-39) */
  readonly openReceipts?: () => void
  /** 주문 상세를 진짜 쌓인 화면으로 (D-UX4-58) — 없으면(시험·웹) 이 화면 안에서 바꿔 끼운다 */
  readonly openOrder?: (date: string, buyer: string) => void
  /** 가게 설정 (상세 [배송비 기준 바꾸기] — 바꿔 끼운 상세에서만 쓴다) */
  readonly openShopSettings?: () => void
}

/** 맨 위 단추 셋 (사용자 지시 그대로의 이름) */
export const TOP_ACTIONS = { info: '고객 정보 받기', receipts: '정산서 보내기', deposits: '입금 확인하기' } as const

/** 끝에서 이만큼 남으면 다음 쪽을 받는다 */
export const PAGE_END_GAP = 400

export function SettleScreen({ initialDate, initialBuyer, nav = {} }: { readonly initialDate?: string; readonly initialBuyer?: string; readonly nav?: SettleNavigation }) {
  // 흰 화면 — 상태 막대 자리도 흰색 (D-UX4-97)
  useWhiteTop()
  const deepLink = initialDate !== undefined && initialBuyer !== undefined ? { date: initialDate, buyer: initialBuyer } : null
  // 택배 화면 [배송지 보기]로 오면 그 주문 상세부터 (D-UX3-35) — 쌓인 화면이 없으면 이 화면 안에서
  const [open, setOpen] = useState<{ readonly date: string; readonly buyer: string } | null>(nav.openOrder === undefined ? deepLink : null)
  const openedFirst = useRef(false)
  useEffect(() => {
    if (openedFirst.current || initialDate === undefined || initialBuyer === undefined || nav.openOrder === undefined) return
    openedFirst.current = true
    nav.openOrder(initialDate, initialBuyer)
  }, [initialDate, initialBuyer, nav])
  if (open !== null) {
    return (
      <OrderDetailScreen
        inPlace
        key={`${open.date}/${open.buyer}`}
        date={open.date}
        buyer={open.buyer}
        onBack={() => setOpen(null)}
        onOpenOrder={(date, buyer) => setOpen({ date, buyer })}
        {...(nav.openShopSettings !== undefined ? { onOpenShopSettings: nav.openShopSettings } : {})}
        {...(nav.openReceipts !== undefined ? { onOpenReceipts: nav.openReceipts } : {})}
      />
    )
  }
  return <OrderList nav={nav} onPick={(date, buyer) => (nav.openOrder === undefined ? setOpen({ date, buyer }) : nav.openOrder(date, buyer))} />
}

function OrderList({ nav, onPick }: { readonly nav: SettleNavigation; readonly onPick: (date: string, buyer: string) => void }) {
  const { p } = useKit()
  const room = useTabBarRoom()
  const first = useCachedGet<OrdersView>(ORDERS_PATH)
  const reloadFirst = first.reload
  // 상세에서 금액을 고치면·실시간으로 찜이 바뀌면 첫 쪽을 다시 받는다 (뒤 쪽은 이어 둔 그대로 — 내려 보던 자리를 잃지 않게)
  useScreenSignal(ORDERS_TOPIC, () => void reloadFirst())
  useOrdersLive(null, () => void reloadFirst())
  // 이어 받은 뒤 쪽들 — 첫 쪽의 다음 자리(next)가 바뀌면 버린다(날짜가 밀렸다)
  const [extra, setExtra] = useState<{ readonly base: string | null; readonly pages: readonly OrdersView[] }>({ base: null, pages: [] })
  const [paging, setPaging] = useState(false)
  const [pageError, setPageError] = useState<ApiError | null>(null)
  const busy = useRef(false)
  const viewHeight = useRef(0)
  const contentHeight = useRef(0)
  const base = first.data?.next ?? null
  const pages = extra.base === base ? extra.pages : []
  const last = pages.length > 0 ? (pages[pages.length - 1] ?? null) : first.data
  const before = last !== null && last.more ? last.next : null
  const loadMore = async () => {
    if (busy.current || before === null) return
    busy.current = true
    setPaging(true)
    setPageError(null)
    try {
      const page = await get<OrdersView>(withQuery(ORDERS_PATH, { before }))
      setExtra((old) => (old.base === base ? { base, pages: [...old.pages, page] } : { base, pages: [page] }))
    } catch (caught: unknown) {
      if (isApiError(caught)) setPageError(caught)
    } finally {
      busy.current = false
      setPaging(false)
    }
  }
  // 목록이 화면보다 짧으면 내릴 수 없으니 바로 다음 쪽을 받는다
  const fillIfShort = () => {
    if (viewHeight.current > 0 && contentHeight.current <= viewHeight.current + PAGE_END_GAP && pageError === null) void loadMore()
  }
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent
    if (layoutMeasurement.height + contentOffset.y >= contentSize.height - PAGE_END_GAP) void loadMore()
  }
  const rows = first.data === null ? [] : joinOrders([first.data.orders, ...pages.map((page) => page.orders)])
  // 불러온 뒤에야 생긴 목록은 부드럽게 — 기억해 둔 목록으로 처음부터 그리면 바로 (D-UX4-112)
  const late = useCameLate(first.data !== null)
  // 확인할 손님 정보 문자가 있으면 [고객 정보 받기]에 작은 점 (옛 정산 탭 위 줄 BuyerInfoBanner를 대신 — 알림을 놓치지 않게)
  const { list: infoList } = useBuyerInfoList()
  const infoOpen = infoList === null ? 0 : infoList.cards.filter((card) => card.status === 'OPEN').length
  // 목록에서 입금 체크 (D-ORDPAY-01) — 한 번 묻고 적는다
  const [asking, setAsking] = useState<OrderRow | null>(null)
  const [paying, setPaying] = useState(false)
  const [payProblem, setPayProblem] = useState<string | null>(null)
  const requestId = useRef(newRequestId())
  const confirmPaid = async () => {
    const row = asking
    if (row === null || paying) return
    setPaying(true)
    setPayProblem(null)
    try {
      const result = await withRetry(() => post<WriteResult>(withQuery('/api/events', { date: row.date, rehearsal: false }), { requestId: requestId.current, type: 'settlement.payment', buyer: row.buyer, date: row.date, amountText: String(remainingOf(row)) }))
      setAsking(null)
      if (!result.changed) setPayProblem(NOT_APPLIED_SETTLEMENT)
      requestId.current = newRequestId()
      // 목록·열려 있는 상세·입금 화면이 다시 받는다
      signalScreens(ORDERS_TOPIC)
      void reloadFirst()
    } catch (caught: unknown) {
      setAsking(null)
      setPayProblem(isApiError(caught) ? caught.message : '적지 못했어요. 다시 눌러 주세요.')
    } finally {
      setPaying(false)
    }
  }
  return (
    <View style={{ flex: 1, backgroundColor: p.surface }} testID="settle-screen">
      <ScrollView
        testID="orders-scroll"
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: SPACE.xl, paddingTop: SPACE.md, paddingBottom: SPACE.xxxl + room, gap: SPACE.lg }}
        scrollIndicatorInsets={{ bottom: room }}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={100}
        onScroll={onScroll}
        onLayout={(event) => {
          viewHeight.current = event.nativeEvent.layout.height
          fillIfShort()
        }}
        onContentSizeChange={(_, height) => {
          contentHeight.current = height
          fillIfShort()
        }}
      >
        {/* 단추는 좌우로만 — 셋을 한 줄에 (D-UX4-01) */}
        <View role="group" aria-label="주문 할 일" style={{ flexDirection: 'row', gap: SPACE.sm }}>
          <TopButton label={TOP_ACTIONS.info} note={infoOpen > 0 ? `확인할 문자 ${String(infoOpen)}건` : null} onPress={nav.openBuyerInfo} />
          <TopButton label={TOP_ACTIONS.receipts} onPress={nav.openReceipts} />
          <TopButton label={TOP_ACTIONS.deposits} onPress={nav.openDeposits} />
        </View>
        {first.error !== null ? (
          <View style={{ gap: SPACE.sm }}>
            <Notice tone="danger" alert>{first.error.message}</Notice>
            <BigButton label={RETRY_NOW} kind="secondary" onPress={() => void reloadFirst()} />
          </View>
        ) : first.data === null ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyFill title={NO_ORDERS} />
        ) : (
          <Appear instant={!late}>
            <View role="list" aria-label="주문 목록">
              {rows.map((row, index) => {
                const showDate = index === 0 || rows[index - 1]?.date !== row.date
                return <OrderLine key={`${row.date}/${row.buyer}`} row={row} showDate={showDate} onPress={() => onPick(row.date, row.buyer)} onCheck={() => { setPayProblem(null); setAsking(row) }} />
              })}
            </View>
          </Appear>
        )}
        {payProblem !== null ? <Notice tone="danger" alert>{payProblem}</Notice> : null}
        {paging ? <Loading /> : null}
        {pageError !== null && !paging ? (
          <View style={{ gap: SPACE.sm }}>
            <Notice tone="danger" alert>{pageError.message}</Notice>
            <BigButton label={RETRY_NOW} kind="secondary" onPress={() => void loadMore()} />
          </View>
        ) : null}
      </ScrollView>
      {/* 단추는 좌우로 — 부정 왼쪽 [아니요], 긍정 오른쪽 [확인했어요] (D-UX4-01, 주문 상세와 같은 팝업) */}
      <PopupDialog
        visible={asking !== null}
        message={ASK_PAID}
        description={asking === null ? null : `${asking.nickname === '' ? '' : `${asking.nickname} · `}남은 금액 ${formatWon(remainingOf(asking))}을 다 받은 것으로 적어요.`}
        cancelLabel="아니요"
        confirmLabel={PAID_CONFIRM}
        busy={paying}
        onConfirm={() => void confirmPaid()}
        onCancel={() => setAsking(null)}
      />
    </View>
  )
}

/** 맨 위 단추 하나: 옅은 초록 바탕, 셋이 한 줄에 들어가게 글자가 길면 조금 줄인다(잘리지 않게) */
function TopButton({ label, note = null, onPress }: { readonly label: string; readonly note?: string | null; readonly onPress: (() => void) | undefined }) {
  const { p } = useKit()
  const off = onPress === undefined
  return (
    <Tap
      role="button"
      aria-label={note === null ? label : `${label} · ${note}`}
      aria-disabled={off}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => ({ flex: 1, minHeight: TOUCH.min, paddingHorizontal: SPACE.xs + 2, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: pressed && !off ? p.secondaryPressed : p.secondary, opacity: off ? 0.45 : 1 })}
    >
      <Txt step="meta" weight="medium" color="onSecondary" center numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
        {label}
      </Txt>
      {note !== null ? <View aria-hidden testID="top-button-dot" style={{ position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: 4, borderCurve: 'continuous', backgroundColor: p.warnText }} /> : null}
    </Tap>
  )
}

/** 날짜 칸 너비 ("11.11" — 가장 긴 날짜) */
const DATE_WIDTH = 40

/** 입금이 다 됐나 (PAID·더 받음) — 목록 체크 (D-ORDPAY-01) */
export const isPaid = (row: Pick<OrderRow, 'payment'>): boolean => row.payment === 'PAID' || row.payment === 'OVERPAID'
export const PAID_WORD = '입금 완료'
/** 덜 받음 줄 (금액 아래 주황) — 남은 금액이 있고 조금이라도 받았을 때 */
export function lackWords(row: Pick<OrderRow, 'payment' | 'total' | 'received'>): string | null {
  return row.payment === 'PARTIAL' && remainingOf(row) > 0 ? `${formatWon(remainingOf(row))} 남음` : null
}
/** 체크 칸 크기 */
const CHECK_BOX = 24

/** 주문 한 줄 (토스 거래 내역 줄): 날짜(그 날짜 첫 줄에만) · 닉네임과 그 아래 작은 성함·빨간 모르는 정보 · 오른쪽 총 금액과 작은 개수 · 맨 오른쪽 입금 체크 칸 */
function OrderLine({ row, showDate, onPress, onCheck }: { readonly row: OrderRow; readonly showDate: boolean; readonly onPress: () => void; readonly onCheck: () => void }) {
  const { p, fontScale } = useKit()
  const missing = missingWords(row.missing)
  const words = [dateWords(row.date), row.nickname, row.name, missing, formatWon(row.total), countWords(row.itemCount)].filter((part) => part !== null && part !== '')
  const paid = isPaid(row)
  const lack = lackWords(row)
  // 다 받았거나 30일 지난 날짜(봉인)는 누를 수 없다 — 체크를 푸는 것은 입금 확인 화면 [되돌리기]로
  const checkable = !paid && !row.sealed && row.total > 0
  const checkLabel = paid ? `${row.nickname} ${PAID_WORD}` : `${row.nickname} 입금 확인 · 남은 금액 ${formatWon(remainingOf(row))}`
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
      <Tap
        role="button"
        aria-label={words.join(' · ')}
        pressScale={0.99}
        onPress={onPress}
        style={({ pressed }) => ({
          flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.sm,
          marginLeft: -SPACE.md, paddingLeft: pressed ? SPACE.lg : SPACE.md, paddingRight: SPACE.xs, paddingVertical: SPACE.md,
          minHeight: 64, borderRadius: RADIUS.md, borderCurve: 'continuous',
          backgroundColor: pressed ? p.surfaceAlt : 'transparent',
        })}
      >
        <View style={{ width: DATE_WIDTH * fontScale }}>{showDate ? <Txt step="body" weight="medium" color="textSub">{dotDate(row.date)}</Txt> : null}</View>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt step="bodyLarge" weight="bold" numberOfLines={1}>{row.nickname}</Txt>
          {row.name !== null ? <Txt step="caption" color="textSub" numberOfLines={1}>{row.name}</Txt> : null}
          {missing !== null ? <Txt step="caption" weight="book" color="dangerText" numberOfLines={1}>{missing}</Txt> : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Txt step="bodyLarge" weight="bold">{formatWon(row.total)}</Txt>
          <Txt step="caption" color="textSub">{countWords(row.itemCount)}</Txt>
          {lack !== null ? <Txt step="caption" weight="medium" color="warnText">{lack}</Txt> : null}
        </View>
      </Tap>
      {/* 입금 체크 칸 (D-ORDPAY-01): 다 받음 = 초록 체크, 아니면 빈 칸 — 누르면 한 번 묻고 다 받은 것으로 */}
      <Tap
        role="checkbox"
        aria-checked={paid}
        aria-label={checkLabel}
        aria-disabled={!checkable}
        disabled={!checkable}
        testID="order-paid-check"
        onPress={onCheck}
        style={{ width: TOUCH.min, minHeight: 64, marginRight: -SPACE.md, alignItems: 'center', justifyContent: 'center' }}
      >
        <View
          style={{
            width: CHECK_BOX, height: CHECK_BOX, borderRadius: RADIUS.sm, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center',
            backgroundColor: paid ? p.primary : 'transparent', borderWidth: paid ? 0 : 2, borderColor: lack !== null ? p.warnText : p.borderStrong,
            opacity: !paid && row.sealed ? 0.45 : 1,
          }}
        >
          {paid ? <Icon name="check" color={p.onPrimary} size={18} /> : null}
        </View>
      </Tap>
    </View>
  )
}
