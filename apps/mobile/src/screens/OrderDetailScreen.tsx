// 주문 상세 (D-UX4-125, 사용자 지시 2026-11-11 "주문 탭 수정 사항 … 해당 영역 누르면 사진2처럼 상세 내역 페이지로 넘어가기"):
// 토스 "상세 내역"처럼 흰 바탕에 카드 없이, 묶음 사이는 굵은 옅은 회색 띠로 나눈다.
// ① 성함(크게) · 플랫폼 아이콘 + 닉네임 · 휴대폰 번호 · 주소
// ② 테두리 없는 표: 번호 | 상품 이름 | 가격
// ③ 예약일시 · 총 개수 · 총 금액 · 배송비(그날 규칙 — "5만원 이상 구매 시 무료"는 가게 설정에서 바꾼다) · 받은 금액·남은 금액(입금 상태를 놓치지 않게)
// ④ 지난 거래 내역: 거래 횟수 | 총 금액, 날짜별 줄
// 그 아래는 판매자가 손님마다 하던 일을 잃지 않게: 배송지 확인·고치기(택배 [배송지 보기]로 오는 곳) · 확인서 · 금액 고치기.
// 서버 GET /api/days/:date/order?buyer= (apps/web/src/api/order-types.ts). 금액은 서버(엔진)가 정한 정수 원 그대로, 이름·주소는 글자로만 그린다.
import { useRef, useState, type ReactNode } from 'react'
import { ScrollView, View, type ScrollViewInstance } from 'react-native'
import type { OrderDetailView, OrderHistoryLine, OrderPlatform } from '@livejjim/web/src/api/order-types.ts'
import { dateWords } from '@livejjim/web/src/lib/kst.ts'
import { useCachedGet } from '../lib/cached-get.ts'
import { useDayScope } from '../lib/day-scope.ts'
import { addressWords, claimedAtWords, countWords, dayWeekdayWords, NO_HISTORY, NO_NAME, ORDER_DETAIL_TITLE, ORDERS_TOPIC, orderPath, phoneDashes, shippingNote, useOrdersLive } from '../lib/orders.ts'
import { useParcelVersion } from '../lib/parcel-version.ts'
import { signalScreens } from '../lib/screen-signals.ts'
import { remainingOf, signedWon } from '../lib/settle.ts'
import { formatWon, RETRY_NOW } from '../lib/words.ts'
import { BigButton, Icon, StackPage, Txt, useHoldRouteSwipe, useKit, Tap } from '../ui/kit/index.ts'
import { RADIUS, SPACE, TOUCH } from '../ui/kit/tokens.ts'
import { Loading, Notice } from '../ui/parts.tsx'
import { PlatformIcon } from '../ui/PlatformIcon.tsx'
import { DetailHeading, OrderFixes } from './order-fix.tsx'
import { TextLink } from './order-parts.tsx'
import { AddressCard } from './ParcelAddress.tsx'

/** 상세 좌우 여백 (흰 화면) */
export const DETAIL_SIDE = SPACE.xl
/** 묶음 사이 굵은 회색 띠 높이 (토스 상세 내역) */
export const BAND = SPACE.md

export interface OrderDetailProps {
  readonly date: string
  readonly buyer: string
  readonly onBack: () => void
  /** 지난 거래 줄을 누르면 그날 상세 (쌓인 화면이면 새로 쌓는다) */
  readonly onOpenOrder?: (date: string, buyer: string) => void
  /** [배송비 기준 바꾸기] — 가게 설정(배송비 묶음) */
  readonly onOpenShopSettings?: () => void
  /** 이 기기에서 문자를 못 보낼 때 확인서를 링크로 보내러 갈 영수증 보내기 화면 */
  readonly onOpenReceipts?: () => void
  /** 주문 탭 안에서 바꿔 끼운 화면(시험·웹)이면 밀어 뒤로 가기가 탭 경로를 닫지 않게 (D-UX4-50) */
  readonly inPlace?: boolean
}

export function OrderDetailScreen({ date, buyer, onBack, onOpenOrder, onOpenShopSettings, onOpenReceipts, inPlace = false }: OrderDetailProps) {
  useHoldRouteSwipe(inPlace)
  const [bump, setBump] = useState(0)
  const { data: view, error, reload } = useCachedGet<OrderDetailView>(orderPath(date, buyer), bump)
  useOrdersLive(date, () => void reload())
  const scroll = useRef<ScrollViewInstance>(null)
  const addressY = useRef<number | null>(null)
  const [parcelVersion] = useParcelVersion(date)
  // 30일 지난 날짜(봉인)는 배송지도 보기만 — 그날 범위 자료로 안다 (금액 고치기 줄과 같은 자료, 같은 요청에 붙는다)
  const { data: day } = useDayScope(date)
  const written = () => {
    setBump((n) => n + 1)
    // 아래 주문 목록 합계도 다시 받는다
    signalScreens(ORDERS_TOPIC)
  }
  const toAddress = () => {
    if (addressY.current !== null) scroll.current?.scrollTo({ y: addressY.current, animated: true })
  }
  const title = view === null ? '' : (view.name ?? view.nickname)
  return (
    <StackPage title={ORDER_DETAIL_TITLE} name={ORDER_DETAIL_TITLE} onBack={onBack} backLabel="주문 목록으로" scroll={false} testID="order-detail-screen">
      {error !== null && view === null ? (
        <View style={{ paddingHorizontal: DETAIL_SIDE, gap: SPACE.sm }}>
          <Notice tone="danger" alert>{error.message}</Notice>
          <BigButton label={RETRY_NOW} kind="secondary" onPress={() => void reload()} />
        </View>
      ) : view === null ? (
        <Loading />
      ) : (
        <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: SPACE.xxxl }} keyboardShouldPersistTaps="handled">
          <Head view={view} onAddress={toAddress} />
          <Band />
          <ItemTable view={view} />
          <Band />
          <Money view={view} onOpenShopSettings={onOpenShopSettings} />
          <Band />
          <History view={view} onOpen={onOpenOrder} />
          <Band />
          <View
            style={{ paddingHorizontal: DETAIL_SIDE, paddingVertical: SPACE.xl }}
            onLayout={(event) => {
              addressY.current = event.nativeEvent.layout.y
            }}
          >
            <AddressCard plain date={date} buyer={buyer} sealed={day?.sealed === true} version={parcelVersion + bump} />
          </View>
          <Band />
          <View style={{ paddingHorizontal: DETAIL_SIDE, paddingVertical: SPACE.xl }}>
            <OrderFixes date={date} buyer={buyer} name={title} onWritten={written} {...(onOpenReceipts !== undefined ? { onOpenReceipts } : {})} />
          </View>
        </ScrollView>
      )}
    </StackPage>
  )
}

/** 묶음 사이 굵은 옅은 회색 띠 */
function Band() {
  const { p } = useKit()
  return <View aria-hidden testID="detail-band" style={{ height: BAND, backgroundColor: p.background }} />
}

/** 이름표(왼쪽 회색) + 값(오른쪽) 한 줄 — 토스 상세 내역 */
function Line({ label, value, strong, sub, children }: { readonly label: string; readonly value: string; readonly strong?: boolean; readonly sub?: string; readonly children?: ReactNode }) {
  const on = strong === true
  return (
    <View aria-label={`${label} ${value}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.lg, minHeight: 28 }}>
      <Txt step="body" color="textSub">{label}</Txt>
      <View style={{ flex: 1, alignItems: 'flex-end', gap: 2 }}>
        <Txt step="body" weight={on ? 'bold' : 'medium'} right>{value}</Txt>
        {sub === undefined ? null : <Txt step="caption" color="textSub" right>{sub}</Txt>}
        {children}
      </View>
    </View>
  )
}

/** 인스타·문자 손님은 앱 아이콘 그림이 없어 같은 크기의 작은 글자 꼬리표로 */
const BADGE_WORD: Readonly<Partial<Record<OrderPlatform, string>>> = { INSTAGRAM: '인스타', SMS: '문자' }
export const PLATFORM_NAME: Readonly<Record<OrderPlatform, string>> = { YOUTUBE: '유튜브', INSTAGRAM: '인스타그램', TIKTOK: '틱톡', BAND: '밴드', SMS: '문자' }

export function PlatformMark({ platform, size = 20 }: { readonly platform: OrderPlatform; readonly size?: number }) {
  const { p } = useKit()
  if (platform === 'YOUTUBE') return <PlatformIcon platform="youtube" size={size} />
  if (platform === 'TIKTOK') return <PlatformIcon platform="tiktok" size={size} />
  if (platform === 'BAND') return <PlatformIcon platform="band" size={size} />
  return (
    <View aria-hidden style={{ height: size, minWidth: size, paddingHorizontal: 4, borderRadius: size * 0.2237, borderCurve: 'continuous', borderWidth: 1, borderColor: p.line, backgroundColor: p.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
      <Txt step="note" weight="medium" color="textSub" numberOfLines={1}>{BADGE_WORD[platform] ?? ''}</Txt>
    </View>
  )
}

/** ① 성함 · 닉네임 · 휴대폰 번호 · 주소 */
function Head({ view, onAddress }: { readonly view: OrderDetailView; readonly onAddress: () => void }) {
  return (
    <View role="group" aria-label="손님" style={{ paddingHorizontal: DETAIL_SIDE, paddingTop: SPACE.sm, paddingBottom: SPACE.xl, gap: SPACE.lg }}>
      <View style={{ gap: SPACE.xs }}>
        <Txt step="number" weight="bold" role="heading" aria-level={2}>{view.name ?? view.nickname}</Txt>
        {view.name === null ? <Txt step="caption" color="textSub">{NO_NAME}</Txt> : null}
        <View aria-label={`닉네임 ${view.platform === null ? '' : `${PLATFORM_NAME[view.platform]} `}${view.nickname}`} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
          {view.platform !== null ? <PlatformMark platform={view.platform} /> : null}
          <View style={{ flexShrink: 1 }}>
            <Txt step="body" color="textSub" numberOfLines={1}>{view.nickname}</Txt>
          </View>
        </View>
      </View>
      <View style={{ gap: SPACE.sm }}>
        <Line label="휴대폰 번호" value={phoneDashes(view.phone)} />
        <Line label="주소" value={addressWords(view.address)}>
          <View>
            <TextLink label="배송지 확인·고치기" onPress={onAddress} />
          </View>
        </Line>
      </View>
    </View>
  )
}

/** ② 테두리 없는 표: 번호 | 상품 이름 | 가격 (수량이 둘 이상이면 이름 뒤 ×n, 가격은 그 줄 합) */
function ItemTable({ view }: { readonly view: OrderDetailView }) {
  const NO_WIDTH = 44
  return (
    <View role="table" aria-label="상품" style={{ paddingHorizontal: DETAIL_SIDE, paddingVertical: SPACE.xl, gap: SPACE.sm }}>
      <View role="row" style={{ flexDirection: 'row', gap: SPACE.md }}>
        <View role="columnheader" style={{ width: NO_WIDTH }}>
          <Txt step="caption" color="textSub">번호</Txt>
        </View>
        <View role="columnheader" style={{ flex: 1 }}>
          <Txt step="caption" color="textSub">상품 이름</Txt>
        </View>
        <View role="columnheader" style={{ alignItems: 'flex-end' }}>
          <Txt step="caption" color="textSub" right>가격</Txt>
        </View>
      </View>
      {view.items.length === 0 ? <Txt step="body" color="textSub">취소되어 상품이 없어요</Txt> : null}
      {view.items.map((item, index) => {
        const name = item.qty > 1 ? `${item.name} ×${String(item.qty)}` : item.name
        const price = formatWon(item.price * item.qty)
        return (
          <View key={`${String(item.no)}-${String(index)}`} role="row" aria-label={`${String(item.no)}번 ${name} ${price}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.md }}>
            <View role="cell" style={{ width: NO_WIDTH }}>
              <Txt step="body" color="textSub">{String(item.no)}</Txt>
            </View>
            <View role="cell" style={{ flex: 1 }}>
              <Txt step="body" weight="medium">{name}</Txt>
            </View>
            <View role="cell" style={{ alignItems: 'flex-end' }}>
              <Txt step="body" weight="medium" right>{price}</Txt>
            </View>
          </View>
        )
      })}
    </View>
  )
}

/** ③ 예약일시 · 총 개수 · 총 금액 · 배송비(그날 규칙) · 할인·추가 · 받은 금액 · 남은 금액 · 돌려줄 돈 */
function Money({ view, onOpenShopSettings }: { readonly view: OrderDetailView; readonly onOpenShopSettings?: () => void }) {
  const left = remainingOf(view)
  return (
    <View role="group" aria-label="금액" style={{ paddingHorizontal: DETAIL_SIDE, paddingVertical: SPACE.xl, gap: SPACE.sm }}>
      <Line label="예약일시" value={view.claimedAt === null ? '모름' : claimedAtWords(view.claimedAt)} />
      <Line label="총 개수" value={countWords(view.itemCount)} />
      <Line label="총 금액" value={formatWon(view.total)} strong {...(view.shipping > 0 ? { sub: '배송비 포함' } : {})} />
      <Line label="배송비" value={formatWon(view.shipping)} sub={shippingNote(view.shippingRule)}>
        {onOpenShopSettings !== undefined ? (
          <View>
            <TextLink label="배송비 기준 바꾸기" onPress={onOpenShopSettings} />
          </View>
        ) : null}
      </Line>
      {view.adjustments !== 0 ? <Line label="할인·추가" value={signedWon(view.adjustments)} /> : null}
      <Line label="받은 금액" value={formatWon(view.received)} />
      <Line label="남은 금액" value={formatWon(left)} strong={left > 0} />
      {view.refundDue > 0 ? <Line label="돌려줄 돈" value={formatWon(view.refundDue)} strong /> : null}
    </View>
  )
}

/** ④ 지난 거래 내역: 거래 횟수 | 총 금액, 날짜별 줄 */
function History({ view, onOpen }: { readonly view: OrderDetailView; readonly onOpen?: (date: string, buyer: string) => void }) {
  const { p } = useKit()
  const { count, total, lines } = view.history
  const days: { readonly date: string; readonly lines: OrderHistoryLine[] }[] = []
  for (const line of lines) {
    const last = days[days.length - 1]
    if (last !== undefined && last.date === line.date) last.lines.push(line)
    else days.push({ date: line.date, lines: [line] })
  }
  return (
    <View role="group" aria-label="지난 거래 내역" style={{ paddingHorizontal: DETAIL_SIDE, paddingVertical: SPACE.xl, gap: SPACE.lg }}>
      <DetailHeading>지난 거래 내역</DetailHeading>
      {count === 0 ? (
        <Txt step="body" color="textSub">{NO_HISTORY}</Txt>
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'stretch', paddingVertical: SPACE.md, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: p.surfaceAlt }}>
            <View aria-label={`거래 횟수 ${String(count)}회`} style={{ flex: 1, alignItems: 'center', gap: 2 }}>
              <Txt step="caption" color="textSub">거래 횟수</Txt>
              <Txt step="bodyLarge" weight="bold">{`${String(count)}회`}</Txt>
            </View>
            <View aria-hidden style={{ width: 1, backgroundColor: p.line }} />
            <View aria-label={`총 금액 ${formatWon(total)}`} style={{ flex: 1, alignItems: 'center', gap: 2 }}>
              <Txt step="caption" color="textSub">총 금액</Txt>
              <Txt step="bodyLarge" weight="bold">{formatWon(total)}</Txt>
            </View>
          </View>
          {days.map((day) => (
            <View key={day.date} style={{ gap: SPACE.xs }}>
              <Txt step="caption" color="textSub" role="heading" aria-level={3}>{dayWeekdayWords(day.date)}</Txt>
              <View style={{ marginHorizontal: -SPACE.sm }}>
                {day.lines.map((line) => (
                  <HistoryRow key={`${line.date}/${line.buyer}`} line={line} {...(onOpen !== undefined ? { onOpen } : {})} />
                ))}
              </View>
            </View>
          ))}
        </>
      )}
    </View>
  )
}

function HistoryRow({ line, onOpen }: { readonly line: OrderHistoryLine; readonly onOpen?: (date: string, buyer: string) => void }) {
  const { p } = useKit()
  const words = `${dateWords(line.date)} 거래 ${formatWon(line.total)} · ${countWords(line.itemCount)}`
  const open = line.openable && onOpen !== undefined
  const body = (
    <>
      <View style={{ flex: 1 }}>
        <Txt step="body" color="textSub">{`상품 ${countWords(line.itemCount)}`}</Txt>
      </View>
      <Txt step="bodyLarge" weight="bold">{formatWon(line.total)}</Txt>
      {open ? <Icon name="chevron" color={p.textSub} size={16} /> : null}
    </>
  )
  const style = { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, minHeight: TOUCH.min, paddingHorizontal: SPACE.sm, borderRadius: RADIUS.md, borderCurve: 'continuous' } as const
  if (!open) {
    return (
      <View aria-label={words} style={style}>
        {body}
      </View>
    )
  }
  return (
    <Tap role="button" aria-label={words} onPress={() => onOpen(line.date, line.buyer)} style={({ pressed }) => ({ ...style, backgroundColor: pressed ? p.pressed : 'transparent' })}>
      {body}
    </Tap>
  )
}
