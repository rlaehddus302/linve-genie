// 주문 상세 (D-UX4-125 → D-UX4-126 → D-UX4-127 → D-UX4-128, 사용자 지시 2026-11-11 "주문 탭 수정 사항"):
// 토스 "상세 내역"처럼 흰 바탕에 카드 없이, 묶음 사이는 굵은 옅은 회색 띠로 나눈다.
// ① 맨 위 플랫폼 아이콘 + 닉네임(크게), 그 아래 왼쪽 이름표(같은 너비)·오른쪽 내용 줄: 성함 · 휴대폰 번호 · 주소 · 예약 날짜(요일까지).
//    모르면 빨간 "모름", 아는 값은 그대로 — 둘 다 › 없이 오른쪽 끝에 붙인다(D-UX4-128 · D-UX4-129 "모름 옆에 > 없애자") — 그래도 눌러 고칠 수 있다.
//    줄을 누르면 상품 추가처럼 한 번에 하나씩 묻는 손님 정보 화면(OrderInfoScreen). 손님이 적은 주소가 아직 확인 전이면 주소 아래 작은 "확인 전".
// ② 테두리 없는 표 번호 | 상품명 | 개수 | 가격 (번호 오름차순, 번호·개수는 가운데 — 번호 칸은 "번호" 글자 폭이라 표 왼쪽 끝에 붙고 상품명과는 띄운다, D-UX4-129),
//    목록 끝 얇은 구분선(띠 아님) 아래 총합(개수 합 · 가격 합) · 배송비(무료 기준이 있으면 늘 "배송비(50,000원 이상 구매 시 무료배송)") · 할인·추가 · 최종 금액,
//    그 묶음 오른쪽 아래 작은 회색 단추 [상품 빼기] [배송비 바꾸기] [정산서 보내기].
//    [상품 빼기] (D-PASS-01) → 뺄 상품 고르기 + 까닭(손님이 패스했어요 / 제가 잘못 넣었어요) 아래 창(order-remove.tsx) — 고른 줄마다 방송자 취소.
//    [배송비 바꾸기] → 아래 창 이름 + › 줄: "배송비 기준 바꾸기"(가게 설정) / "이 주문 배송비 바꾸기"(우리 키보드 화면, OrderShippingScreen).
//    [정산서 보내기] → 아래 창 줄 넷: 고객에게 문자 보내기 · 사진으로 저장하기 · CSV 파일로 저장하기 · 엑셀 파일로 저장하기 (order-export.tsx).
// ③ "입금" 이름표 아래 받은 금액 · 남은 금액(남아 있으면 빨강) · 돌려줄 돈, 남은 금액이 있으면 [입금을 확인했나요?] → 팝업 [확인했어요] → 남은 금액을 다 받은 것으로 적는다.
// ④ 최근 주문 내역(옛 "지난 거래 내역"): 지금 주문도 1회로 센다 — 거래 횟수 | 총 금액, 날짜별 줄(모두 ›). 지금 주문 줄을 누르면 이 화면 맨 위로(D-UX4-129).
// 그 아래 옛 확인서·금액 고치기·금액 기록 메뉴는 없앴다(D-UX4-128 "나중에 내가 필요하면 그때 추가할게").
// 서버 GET /api/days/:date/order?buyer= (apps/web/src/api/order-types.ts). 금액은 서버(엔진)가 정한 정수 원 그대로, 이름·주소는 글자로만 그린다.
import { type ReactNode, useRef, useState } from 'react'
import { ScrollView, type ScrollViewInstance, View } from 'react-native'
import type { OrderDetailView, OrderHistoryLine, OrderInfoField, OrderPlatform } from '@livejjim/web/src/api/order-types.ts'
import type { BundleView } from '@livejjim/web/src/api/parcel-types.ts'
import type { WriteResult } from '@livejjim/web/src/api/types.ts'
import { dateWords } from '@livejjim/web/src/lib/kst.ts'
import { isApiError, newRequestId, post, withQuery, withRetry } from '../api/client.ts'
import { useCachedGet } from '../lib/cached-get.ts'
import { useDayScope } from '../lib/day-scope.ts'
import { addressWords, countWords, dayWeekdayWords, INFO_LABEL, ORDER_DETAIL_TITLE, ORDERS_TOPIC, orderPath, phoneDashes, reservedDateWords, UNKNOWN, useOrdersLive } from '../lib/orders.ts'
import { useParcelVersion } from '../lib/parcel-version.ts'
import { signalScreens, useScreenSignal } from '../lib/screen-signals.ts'
import { settlementKey } from '../lib/scope-data.ts'
import { NOT_APPLIED_SETTLEMENT, remainingOf, signedWon } from '../lib/settle.ts'
import { formatWon, RETRY_NOW } from '../lib/words.ts'
import { BigButton, BottomSheet, ErrorLine, Icon, PopupDialog, StackPage, Txt, useHoldRouteSwipe, useKit, Tap } from '../ui/kit/index.ts'
import { RADIUS, SPACE, TOUCH } from '../ui/kit/tokens.ts'
import { Loading, Notice } from '../ui/parts.tsx'
import { PlatformIcon } from '../ui/PlatformIcon.tsx'
import { DetailHeading } from './order-fix.tsx'
import { MenuRow } from './order-parts.tsx'
import { OrderSendSheet, SEND_TITLE, SHEET_GONE_MS, type SendNotice } from './order-export.tsx'
import { OrderRemoveSheet, REMOVE_BUTTON, type RemoveWhy } from './order-remove.tsx'
import { OrderInfoFlow } from './OrderInfoScreen.tsx'
import { OrderShippingFlow } from './OrderShippingScreen.tsx'

/** 상세 좌우 여백 (흰 화면) */
export const DETAIL_SIDE = SPACE.xl
/** 묶음 사이 굵은 회색 띠 높이 (토스 상세 내역) */
export const BAND = SPACE.md

export const SHIPPING_BUTTON = '배송비 바꾸기'
export const SHIPPING_RULE_CHOICE = '배송비 기준 바꾸기'
export const SHIPPING_ORDER_CHOICE = '이 주문 배송비 바꾸기'
export const UNCONFIRMED_ADDRESS = '확인 전'
export const ASK_PAID = '입금을 확인했나요?'
export const PAID_CONFIRM = '확인했어요'
export const HISTORY_TITLE = '최근 주문 내역'

export interface OrderDetailProps {
  readonly date: string
  readonly buyer: string
  readonly onBack: () => void
  /** 최근 주문 줄을 누르면 그날 상세 (쌓인 화면이면 새로 쌓는다) */
  readonly onOpenOrder?: (date: string, buyer: string) => void
  /** "배송비 기준 바꾸기" — 가게 설정(배송비 묶음) */
  readonly onOpenShopSettings?: () => void
  /** 성함·휴대폰 번호·주소 줄 → 손님 정보 화면을 진짜 쌓인 화면으로 (D-UX4-126). 없으면(시험·웹) 이 화면 안에서 바꿔 끼운다 */
  readonly onEditInfo?: (field: OrderInfoField) => void
  /** "이 주문 배송비 바꾸기" → 배송비 키보드 화면을 진짜 쌓인 화면으로 (D-UX4-128). 없으면(시험·웹) 이 화면 안에서 바꿔 끼운다 */
  readonly onEditShipping?: () => void
  /** 주문 탭 안에서 바꿔 끼운 화면(시험·웹)이면 밀어 뒤로 가기가 탭 경로를 닫지 않게 (D-UX4-50) */
  readonly inPlace?: boolean
}

type Editing = { readonly kind: 'info'; readonly field: OrderInfoField } | { readonly kind: 'shipping' }

export function OrderDetailScreen(props: OrderDetailProps) {
  const [editing, setEditing] = useState<Editing | null>(null)
  // 머리 ‹: 첫 단계가 아니면 앞 단계로, 첫 단계면 상세로 (상품 추가와 같다, D-UX4-111)
  const stepBack = useRef<(() => boolean) | null>(null)
  // 쌓인 화면이 없으면(시험·웹) 손님 정보·배송비 화면을 이 자리에서 바꿔 끼운다 — 저장하면 상세로 돌아온다
  if (editing?.kind === 'info' && props.onEditInfo === undefined) {
    return (
      <StackPage title={INFO_TITLE} name={INFO_TITLE} onBack={() => { if (stepBack.current?.() !== true) setEditing(null) }} scroll={false} testID="order-info-screen">
        <OrderInfoFlow date={props.date} buyer={props.buyer} field={editing.field} stepBack={stepBack} onBack={() => setEditing(null)} onSaved={() => setEditing(null)} />
      </StackPage>
    )
  }
  if (editing?.kind === 'shipping' && props.onEditShipping === undefined) {
    return (
      <StackPage title={SHIPPING_BUTTON} name={SHIPPING_BUTTON} onBack={() => setEditing(null)} scroll={false} testID="order-shipping-screen">
        <OrderShippingFlow date={props.date} buyer={props.buyer} onSaved={() => setEditing(null)} />
      </StackPage>
    )
  }
  return <OrderDetailBody {...props} onEditInfo={props.onEditInfo ?? ((field) => setEditing({ kind: 'info', field }))} onEditShipping={props.onEditShipping ?? (() => setEditing({ kind: 'shipping' }))} />
}

const INFO_TITLE = '손님 정보'

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function OrderDetailBody({ date, buyer, onBack, onOpenOrder, onOpenShopSettings, onEditInfo, onEditShipping, inPlace = false }: OrderDetailProps & { readonly onEditInfo: (field: OrderInfoField) => void; readonly onEditShipping: () => void }) {
  useHoldRouteSwipe(inPlace)
  const [bump, setBump] = useState(0)
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<SendNotice | null>(null)
  const [shippingAsk, setShippingAsk] = useState(false)
  const [removing, setRemoving] = useState(false)
  // 최근 주문 내역의 지금 주문 줄 → 맨 위로 (D-UX4-129)
  const scroller = useRef<ScrollViewInstance>(null)
  const { data: view, error, reload } = useCachedGet<OrderDetailView>(orderPath(date, buyer), bump)
  useOrdersLive(date, () => void reload())
  // 손님 정보·배송비 화면에서 저장하면 다시 받는다
  useScreenSignal(ORDERS_TOPIC, () => setBump((n) => n + 1))
  const [parcelVersion] = useParcelVersion(date)
  // 고칠 수 있는지: 30일 지난 날짜(봉인)·택배 접수가 살아 있는 묶음·보관 기간 지난 배송지는 보기만. 손님이 적은 주소가 확인 전인지도 여기서 안다
  const { data: day, reload: reloadDay } = useDayScope(date)
  const { data: parcel } = useCachedGet<{ bundle: BundleView }>(withQuery(`/api/parcels/days/${date}/bundle`, { buyer }), `${String(parcelVersion)}:${String(bump)}`)
  const bundle = parcel?.bundle ?? null
  const sealed = day?.sealed === true
  const editable = !sealed && bundle?.locked !== true && bundle?.expired !== true
  // 이 주문의 정산 묶음 (입금 확인을 적을 곳) — 그날 자료를 받기 전에는 [입금을 확인했나요?]를 누르지 못한다
  const settlement = day?.settlements.get(settlementKey({ buyer, date })) ?? null
  // 주소 아래 작은 글: 택배사가 주소를 못 찾아 돌려보냈으면 그 까닭(빨강 — 택배 화면 [배송지 보기]로 온 까닭), 손님이 적은 주소가 확인 전이면 "확인 전"(주황)
  const failed = bundle?.row.parcel?.state === 'FAILED' && bundle.row.parcel.reason === 'ADDRESS' ? bundle.row.parcel.message : null
  const addressNote: Note | null = failed !== null ? { text: failed, tone: 'danger' } : bundle?.address != null && !bundle.address.confirmed ? { text: UNCONFIRMED_ADDRESS, tone: 'warn' } : null
  const written = () => {
    setBump((n) => n + 1)
    reloadDay()
    // 아래 주문 목록 합계도 다시 받는다
    signalScreens(ORDERS_TOPIC)
  }
  const removed = (count: number, why: RemoveWhy) => {
    setRemoving(false)
    setNotice({ tone: 'success', text: `${String(count)}개를 뺐어요${why === 'pass' ? ' · 손님 기록에 패스로 남겼어요' : ''}` })
    written()
  }
  const pickShipping = async (choice: 'rule' | 'order') => {
    setShippingAsk(false)
    await wait(SHEET_GONE_MS)
    if (choice === 'rule') onOpenShopSettings?.()
    else onEditShipping()
  }
  const shippingChoices = [
    ...(onOpenShopSettings !== undefined ? [{ value: 'rule' as const, label: SHIPPING_RULE_CHOICE, description: '가게의 기본 배송비와 무료 기준을 바꿔요' }] : []),
    ...(!sealed ? [{ value: 'order' as const, label: SHIPPING_ORDER_CHOICE, description: '이 손님 주문의 배송비만 바꿔요' }] : []),
  ]
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
        <ScrollView ref={scroller} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: SPACE.xxxl }} keyboardShouldPersistTaps="handled">
          <Head view={view} {...(editable ? { onEdit: onEditInfo } : {})} addressNote={addressNote} />
          <Band />
          <Order view={view} notice={notice} {...(!sealed ? { onRemove: () => { setNotice(null); setRemoving(true) } } : {})} {...(shippingChoices.length > 0 ? { onShipping: () => setShippingAsk(true) } : {})} onSend={() => { setNotice(null); setSending(true) }} />
          <Band />
          <Payment view={view} date={date} settlement={settlement === null || sealed ? null : { buyer: settlement.buyer, date: settlement.date }} onPaid={written} />
          <Band />
          <History view={view} {...(onOpenOrder !== undefined ? { onOpen: onOpenOrder } : {})} onTop={() => scroller.current?.scrollTo({ y: 0, animated: true })} />
        </ScrollView>
      )}
      {view !== null ? <OrderRemoveSheet visible={removing} buyer={view.buyer} items={view.items} onClose={() => setRemoving(false)} onDone={removed} /> : null}
      <OrderSendSheet visible={sending} date={date} buyer={buyer} name={title} sealed={sealed} onClose={() => setSending(false)} onNotice={setNotice} onSent={written} />
      <BottomSheet visible={shippingAsk} onClose={() => setShippingAsk(false)} title={SHIPPING_BUTTON} testID="shipping-choice">
        {/* 이름 + › 줄 (D-UX4-129 "메뉴들 옆에 > 없으니까 붙이고" — [정산서 보내기] 창과 같은 줄) */}
        <View style={{ marginHorizontal: -SPACE.xl }}>
          {shippingChoices.map((choice) => (
            <MenuRow key={choice.value} title={choice.label} sub={choice.description} onPress={() => void pickShipping(choice.value)} />
          ))}
        </View>
      </BottomSheet>
    </StackPage>
  )
}

/** 묶음 사이 굵은 옅은 회색 띠 */
function Band() {
  const { p } = useKit()
  return <View aria-hidden testID="detail-band" style={{ height: BAND, backgroundColor: p.background }} />
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

/** ① 맨 위 플랫폼 아이콘 + 닉네임, 그 아래 성함 · 휴대폰 번호 · 주소 · 예약 날짜 */
interface Note {
  readonly text: string
  readonly tone: 'danger' | 'warn'
}

function Head({ view, onEdit, addressNote }: { readonly view: OrderDetailView; readonly onEdit?: (field: OrderInfoField) => void; readonly addressNote: Note | null }) {
  return (
    <View role="group" aria-label="손님" style={{ paddingHorizontal: DETAIL_SIDE, paddingTop: SPACE.sm, paddingBottom: SPACE.lg, gap: SPACE.md }}>
      <View aria-label={`닉네임 ${view.platform === null ? '' : `${PLATFORM_NAME[view.platform]} `}${view.nickname}`} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
        {view.platform !== null ? <PlatformMark platform={view.platform} size={24} /> : null}
        <View style={{ flexShrink: 1 }}>
          <Txt step="number" weight="bold" role="heading" aria-level={2} numberOfLines={2}>{view.nickname}</Txt>
        </View>
      </View>
      <View style={{ marginHorizontal: -SPACE.sm }}>
        <InfoRow field="name" value={view.name} {...(onEdit !== undefined ? { onEdit } : {})} />
        <InfoRow field="phone" value={view.phone === null ? null : phoneDashes(view.phone)} {...(onEdit !== undefined ? { onEdit } : {})} />
        <InfoRow field="address" value={view.address === null ? null : addressWords(view.address)} {...(addressNote !== null ? { note: addressNote } : {})} {...(onEdit !== undefined ? { onEdit } : {})} />
        <FactRow label={RESERVED_LABEL} value={reservedDateWords(view.claimedAt, view.date)} />
      </View>
    </View>
  )
}

export const RESERVED_LABEL = '예약 날짜'
/** 손님 정보 줄 이름표 칸 너비 — 네 줄 내용이 같은 자리에서 시작한다 (D-UX4-127 "수평 정렬") */
const INFO_LABEL_WIDTH = 92
/** 손님 정보 줄 높이 (D-UX4-127 "간격도 지금 너무 넓어" — 48 → 40) */
const INFO_ROW_HEIGHT = 40
const infoRowStyle = { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, minHeight: INFO_ROW_HEIGHT, paddingVertical: SPACE.xs + 2, paddingHorizontal: SPACE.sm, borderRadius: RADIUS.md, borderCurve: 'continuous' } as const

/**
 * 손님 정보 한 줄: 왼쪽 회색 이름표(같은 너비), 오른쪽 내용. 모르면 빨간 "모름" — ›는 어느 줄에도 없이 오른쪽 끝에 붙인다
 * (D-UX4-128 아는 값 › 없앰 → D-UX4-129 "모름 옆에 > 없애자. 보기에 안 좋다"). 고칠 수 있으면 눌러 그 칸부터 묻는 손님 정보 화면으로.
 */
function InfoRow({ field, value, note, onEdit }: { readonly field: OrderInfoField; readonly value: string | null; readonly note?: Note; readonly onEdit?: (field: OrderInfoField) => void }) {
  const { p } = useKit()
  const label = INFO_LABEL[field]
  const unknown = value === null || value.trim() === ''
  const shown = unknown ? UNKNOWN : value
  const words = `${label} ${shown}${note === undefined ? '' : ` · ${note.text}`}`
  const body = (
    <>
      <View style={{ width: INFO_LABEL_WIDTH }}>
        <Txt step="body" color="textSub">{label}</Txt>
      </View>
      <View style={{ flex: 1, alignItems: 'flex-end', gap: 2 }}>
        <Txt step="body" weight={unknown ? 'book' : 'medium'} color={unknown ? 'dangerText' : 'text'} right>{shown}</Txt>
        {note !== undefined ? <Txt step="caption" weight="medium" color={note.tone === 'danger' ? 'dangerText' : 'warnText'} right>{note.text}</Txt> : null}
      </View>
    </>
  )
  if (onEdit === undefined) {
    return (
      <View aria-label={words} style={infoRowStyle}>
        {body}
      </View>
    )
  }
  return (
    <Tap role="button" aria-label={`${words} · 고치기`} testID={`info-${field}`} onPress={() => onEdit(field)} style={({ pressed }) => ({ ...infoRowStyle, backgroundColor: pressed ? p.pressed : 'transparent' })}>
      {body}
    </Tap>
  )
}

/** 누르지 않는 손님 정보 줄 (예약 날짜) — 위 줄들과 같은 칸 */
function FactRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View aria-label={`${label} ${value}`} testID="info-reserved" style={infoRowStyle}>
      <View style={{ width: INFO_LABEL_WIDTH }}>
        <Txt step="body" color="textSub">{label}</Txt>
      </View>
      <View style={{ flex: 1, alignItems: 'flex-end' }}>
        <Txt step="body" weight="medium" right>{value}</Txt>
      </View>
    </View>
  )
}

/** 이름표(왼쪽 회색) + 값(오른쪽) 한 줄 — 토스 상세 내역. danger: 값을 빨강으로 */
function Line({ label, value, strong, danger }: { readonly label: string; readonly value: string; readonly strong?: boolean; readonly danger?: boolean }) {
  return (
    <View aria-label={`${label} ${value}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.lg, minHeight: 28 }}>
      <Txt step="body" color="textSub">{label}</Txt>
      <View style={{ flex: 1, alignItems: 'flex-end' }}>
        <Txt step="body" weight={strong === true ? 'bold' : 'medium'} color={danger === true ? 'dangerText' : 'text'} right>{value}</Txt>
      </View>
    </View>
  )
}

/** 작은 회색 단추 (상세 묶음 오른쪽 아래 — 사용자 지시 "회색 버튼으로 작게") */
function SmallButton({ label, onPress }: { readonly label: string; readonly onPress: () => void }) {
  const { p } = useKit()
  return (
    <Tap role="button" aria-label={label} onPress={onPress} hitSlop={6} style={({ pressed }) => ({ minHeight: 32, paddingHorizontal: SPACE.md, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.sm, borderCurve: 'continuous', backgroundColor: pressed ? p.softPressed : p.surfaceAlt })}>
      <Txt step="caption" weight="medium" color="textSub">{label}</Txt>
    </Tap>
  )
}

/**
 * 표 칸 너비: 번호·개수는 가운데 맞춤 칸, 가격은 오른쪽 맞춤 칸 — 총합 줄도 같은 칸을 쓴다.
 * 번호 칸은 "번호" 글자 폭만큼이라 표 왼쪽 끝(총합·배송비 이름표와 같은 자리)에서 시작하고, 상품명과는 NO_GAP 띄운다
 * (D-UX4-129 "표 왼쪽에 여백 없애라 … 번호와 상품명 너무 붙어있어서" — 옛 44 칸 가운데라 왼쪽이 비었다).
 */
const NO_WIDTH = 24
const NO_GAP = SPACE.lg
const QTY_WIDTH = 44
const PRICE_WIDTH = 104

export const TOTAL_ROW = '총합'
// 사용자는 "총 결제금액"이라 했지만 앱 글에는 "결제"를 쓰지 않는다(D-PAY-01·AC-PAY2-01 앱스토어 규칙) — 영수증 사진의 "최종 결제 금액"과 같은 "최종"으로 (D-UX4-127 AUTO)
export const GRAND_TOTAL = '최종 금액'

/**
 * 배송비 이름표 (D-UX4-128 "'배송비' 라벨을 → '배송비(50,000원 이상 구매 시 무료배송)'").
 * D-UX4-129 "이 주문만 정함 뭐 이런 말은 안 적어도 돼": 직접 수령·합배송·이 주문만 정함이어도 괄호에는 가게 무료 기준만 — 기준이 없는 가게는 그냥 "배송비".
 */
export function shippingLabel(rule: OrderDetailView['shippingRule']): string {
  return rule.freeThreshold !== null ? `배송비(${formatWon(rule.freeThreshold)} 이상 구매 시 무료배송)` : '배송비'
}

/** 표 한 줄 칸 나누기: [번호][상품명][개수][가격] */
function Cells({ no, name, qty, price, role = 'cell' }: { readonly no: ReactNode; readonly name: ReactNode; readonly qty: ReactNode; readonly price: ReactNode; readonly role?: 'cell' | 'columnheader' }) {
  return (
    <>
      <View role={role} style={{ width: NO_WIDTH, marginRight: NO_GAP, alignItems: 'center' }}>{no}</View>
      <View role={role} style={{ flex: 1 }}>{name}</View>
      <View role={role} style={{ width: QTY_WIDTH, alignItems: 'center' }}>{qty}</View>
      <View role={role} style={{ width: PRICE_WIDTH, alignItems: 'flex-end' }}>{price}</View>
    </>
  )
}

const rowStyle = { flexDirection: 'row', alignItems: 'center', minHeight: 28 } as const

/** 표 아래 금액 한 줄: 왼쪽 이름표, 오른쪽 금액 (가격 칸 끝에 맞춘다) */
function MoneyRow({ label, value, strong }: { readonly label: string; readonly value: string; readonly strong?: boolean }) {
  const on = strong === true
  return (
    <View role="row" aria-label={`${label} ${value}`} style={{ ...rowStyle, gap: SPACE.md }}>
      <View style={{ flex: 1 }}>
        <Txt step="body" weight={on ? 'bold' : 'regular'} color={on ? 'text' : 'textSub'}>{label}</Txt>
      </View>
      <Txt step={on ? 'bodyLarge' : 'body'} weight={on ? 'bold' : 'medium'} right numberOfLines={1}>{value}</Txt>
    </View>
  )
}

/**
 * ② 테두리 없는 표 번호 | 상품명 | 개수 | 가격 (가격은 그 줄 합), 목록 끝 얇은 구분선,
 * 총합(개수 합 · 가격 합) · 배송비(이름표 괄호 안에 무료 기준) · 할인·추가 · 최종 금액, 오른쪽 아래 [배송비 바꾸기] [정산서 보내기]
 */
function Order({ view, notice, onRemove, onShipping, onSend }: { readonly view: OrderDetailView; readonly notice: SendNotice | null; readonly onRemove?: () => void; readonly onShipping?: () => void; readonly onSend: () => void }) {
  const { p } = useKit()
  return (
    <View role="group" aria-label="주문" style={{ paddingHorizontal: DETAIL_SIDE, paddingVertical: SPACE.xl, gap: SPACE.lg }}>
      <View role="table" aria-label="상품" style={{ gap: SPACE.sm }}>
        <View role="row" style={rowStyle}>
          <Cells
            role="columnheader"
            no={<Txt step="caption" color="textSub" center>번호</Txt>}
            name={<Txt step="caption" color="textSub">상품명</Txt>}
            qty={<Txt step="caption" color="textSub" center>개수</Txt>}
            price={<Txt step="caption" color="textSub" right>가격</Txt>}
          />
        </View>
        {view.items.length === 0 ? <Txt step="body" color="textSub">취소되어 상품이 없어요</Txt> : null}
        {[...view.items].sort((a, b) => a.no - b.no).map((item, index) => {
          const price = formatWon(item.price * item.qty)
          return (
            <View key={`${String(item.no)}-${String(index)}`} role="row" aria-label={`${String(item.no)}번 ${item.name} ${countWords(item.qty)} ${price}`} style={{ ...rowStyle, alignItems: 'flex-start' }}>
              <Cells
                no={<Txt step="body" color="textSub" center>{String(item.no)}</Txt>}
                name={<Txt step="body" weight="medium">{item.name}</Txt>}
                qty={<Txt step="body" center>{String(item.qty)}</Txt>}
                price={<Txt step="body" weight="medium" right numberOfLines={1}>{price}</Txt>}
              />
            </View>
          )
        })}
        {/* 목록 끝 얇은 구분선 (묶음을 나누는 굵은 띠가 아님) */}
        <View aria-hidden testID="table-rule" style={{ height: 1, backgroundColor: p.line, marginVertical: SPACE.xs }} />
        <View role="row" aria-label={`${TOTAL_ROW} ${countWords(view.itemCount)} ${formatWon(view.subtotal)}`} style={rowStyle}>
          {/* 이름표는 번호·상품명 칸을 함께 쓰고, 개수 합은 개수 칸 · 가격 합은 가격 칸 아래 */}
          <View style={{ flex: 1 }}>
            <Txt step="body" color="textSub">{TOTAL_ROW}</Txt>
          </View>
          <View style={{ width: QTY_WIDTH, alignItems: 'center' }}>
            <Txt step="body" weight="medium" center>{String(view.itemCount)}</Txt>
          </View>
          <View style={{ width: PRICE_WIDTH, alignItems: 'flex-end' }}>
            <Txt step="body" weight="medium" right numberOfLines={1}>{formatWon(view.subtotal)}</Txt>
          </View>
        </View>
        <MoneyRow label={shippingLabel(view.shippingRule)} value={formatWon(view.shipping)} />
        {view.adjustments !== 0 ? <MoneyRow label="할인·추가" value={signedWon(view.adjustments)} /> : null}
        <MoneyRow label={GRAND_TOTAL} value={formatWon(view.total)} strong />
      </View>
      {/* 단추는 좌우로만 (D-UX4-01) — 오른쪽 아래에 [상품 빼기] [배송비 바꾸기] [정산서 보내기] */}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: SPACE.sm }}>
        {onRemove !== undefined && view.items.length > 0 ? <SmallButton label={REMOVE_BUTTON} onPress={onRemove} /> : null}
        {onShipping !== undefined ? <SmallButton label={SHIPPING_BUTTON} onPress={onShipping} /> : null}
        <SmallButton label={SEND_TITLE} onPress={onSend} />
      </View>
      {notice !== null ? notice.tone === 'danger' ? <ErrorLine>{notice.text}</ErrorLine> : <Notice tone="success">{notice.text}</Notice> : null}
    </View>
  )
}

/**
 * ③ "입금" 이름표 아래 받은 금액 · 남은 금액(남아 있으면 빨강) · 돌려줄 돈.
 * 남은 금액이 있으면 [입금을 확인했나요?] → 가운데 팝업 [아니요] [확인했어요] → 남은 금액만큼 입금을 적어 다 받은 것으로 (D-UX4-128).
 * 쓰기는 옛 "입금 적기"와 같은 settlement.payment 이벤트(같은 요청 번호로 다시 보내도 한 번만).
 */
export const PAYMENT_HEADING = '입금'

function Payment({ view, date, settlement, onPaid }: { readonly view: OrderDetailView; readonly date: string; readonly settlement: { readonly buyer: string; readonly date: string } | null; readonly onPaid: () => void }) {
  const left = remainingOf(view)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const requestId = useRef(newRequestId())
  const confirm = async () => {
    if (settlement === null) return
    setBusy(true)
    setProblem(null)
    try {
      const result = await withRetry(() => post<WriteResult>(withQuery('/api/events', { date, rehearsal: false }), { requestId: requestId.current, type: 'settlement.payment', buyer: settlement.buyer, date: settlement.date, amountText: String(left) }))
      setAsking(false)
      if (!result.changed) setProblem(NOT_APPLIED_SETTLEMENT)
      requestId.current = newRequestId()
      onPaid()
    } catch (caught: unknown) {
      setAsking(false)
      setProblem(isApiError(caught) ? caught.message : '적지 못했어요. 다시 눌러 주세요.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <View role="group" aria-label={PAYMENT_HEADING} style={{ paddingHorizontal: DETAIL_SIDE, paddingVertical: SPACE.xl, gap: SPACE.sm }}>
      <View style={{ marginBottom: SPACE.xs }}>
        <DetailHeading>{PAYMENT_HEADING}</DetailHeading>
      </View>
      <Line label="받은 금액" value={formatWon(view.received)} />
      <Line label="남은 금액" value={formatWon(left)} strong={left > 0} danger={left > 0} />
      {view.refundDue > 0 ? <Line label="돌려줄 돈" value={formatWon(view.refundDue)} strong /> : null}
      {left > 0 && settlement !== null ? (
        <View style={{ marginTop: SPACE.sm }}>
          <BigButton kind="secondary" label={ASK_PAID} onPress={() => { setProblem(null); setAsking(true) }} />
        </View>
      ) : null}
      {problem !== null ? <ErrorLine>{problem}</ErrorLine> : null}
      <PopupDialog
        visible={asking}
        message={ASK_PAID}
        description={`남은 금액 ${formatWon(left)}을 다 받은 것으로 적어요.`}
        cancelLabel="아니요"
        confirmLabel={PAID_CONFIRM}
        busy={busy}
        onConfirm={() => void confirm()}
        onCancel={() => setAsking(false)}
      />
    </View>
  )
}

/** ④ 최근 주문 내역 (옛 "지난 거래 내역", D-UX4-128 "현재 주문도 1회로 보도록"): 지금 주문을 더해 거래 횟수 | 총 금액, 날짜별 줄 */
function History({ view, onOpen, onTop }: { readonly view: OrderDetailView; readonly onOpen?: (date: string, buyer: string) => void; readonly onTop: () => void }) {
  const { p } = useKit()
  // 지금 주문 줄 (누르면 이 화면 맨 위로) — 다른 주문과 날짜 순(최근 먼저)으로 섞는다
  const current: OrderHistoryLine = { date: view.date, buyer: view.buyer, total: view.total, itemCount: view.itemCount, openable: false }
  const all = [current, ...view.history.lines.filter((line) => !(line.date === view.date && line.buyer === view.buyer))].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  const count = view.history.count + 1
  const total = view.history.total + view.total
  const days: { readonly date: string; readonly lines: OrderHistoryLine[] }[] = []
  for (const line of all) {
    const last = days[days.length - 1]
    if (last !== undefined && last.date === line.date) last.lines.push(line)
    else days.push({ date: line.date, lines: [line] })
  }
  return (
    <View role="group" aria-label={HISTORY_TITLE} style={{ paddingHorizontal: DETAIL_SIDE, paddingVertical: SPACE.xl, gap: SPACE.lg }}>
      <DetailHeading>{HISTORY_TITLE}</DetailHeading>
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
              <HistoryRow key={`${line.date}/${line.buyer}`} line={line} current={line === current} {...(onOpen !== undefined ? { onOpen } : {})} onTop={onTop} />
            ))}
          </View>
        </View>
      ))}
    </View>
  )
}

/**
 * 최근 주문 한 줄 — 모두 › (D-UX4-129 "최근 주문 내역에 있는 목록들 > 다 붙이고 만약 지금 주문이라면 눌렀을 때 지금 그 화면 맨 위로").
 * 지금 주문 줄은 이 화면 맨 위로, 다른 날은 그날 상세. 봉인 보관만 남은 날(openable false)은 열 상세가 없어 ›도 누름도 없다(AUTO — 눌러도 "찾지 못했어요"만 나온다).
 */
function HistoryRow({ line, current, onOpen, onTop }: { readonly line: OrderHistoryLine; readonly current: boolean; readonly onOpen?: (date: string, buyer: string) => void; readonly onTop: () => void }) {
  const { p } = useKit()
  const words = `${dateWords(line.date)} 거래 ${formatWon(line.total)} · ${countWords(line.itemCount)}${current ? ' · 지금 주문' : ''}`
  const open = current || (line.openable && onOpen !== undefined)
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
    <Tap role="button" aria-label={words} onPress={() => (current ? onTop() : onOpen?.(line.date, line.buyer))} style={({ pressed }) => ({ ...style, backgroundColor: pressed ? p.pressed : 'transparent' })}>
      {body}
    </Tap>
  )
}
