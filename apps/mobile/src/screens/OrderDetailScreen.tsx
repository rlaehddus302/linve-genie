// 주문 상세 (D-UX4-125 → D-UX4-126, 사용자 지시 2026-11-11 "주문 탭 수정 사항" 두 번째):
// 토스 "상세 내역"처럼 흰 바탕에 카드 없이, 묶음 사이는 굵은 옅은 회색 띠로 나눈다.
// ① 맨 위 플랫폼 아이콘 + 닉네임(크게), 그 아래 왼쪽 이름표·오른쪽 내용 줄: 성함 · 휴대폰 번호 · 주소.
//    모르면 빨간 "모름 ›" — 줄을 누르면 상품 추가처럼 한 번에 하나씩 묻는 손님 정보 화면(OrderInfoScreen)으로. 아는 값도 눌러 고친다(옛 "배송지 확인·고치기" 글·아래 배송지 칸은 없앴다).
//    손님이 적은 주소가 아직 확인 전이면 주소 아래 작은 "확인 전" — 눌러 저장하면 판매자가 확인한 주소가 된다.
//    D-UX4-127(사용자 지시 2026-11-11 "수평 정렬 맞추고, 간격도 지금 너무 넓어. 화살표는 빨간색으로 하지 마"): 줄 높이를 줄이고, 이름표 칸 너비를 같게,
//    이름표·내용·화살표를 한 줄 가운데에 맞춘다. 화살표는 늘 회색(모름 글자만 빨강). 주소 아래 예약 날짜(요일까지, 누르지 않는 줄).
// ② 테두리 없는 표 번호 | 상품명 | 개수 | 가격 (D-UX4-127 — 번호·개수는 가운데, 상품명·가격은 끝에서 살짝 띄움),
//    목록 끝 얇은 구분선(띠 아님) 아래 총합(개수 칸 아래 개수 합 · 가격 칸 아래 가격 합) · 배송비(왼쪽에 "N원 이상 구매 시 무료") · 할인·추가 · 총 결제금액,
//    그 묶음 오른쪽 아래 작은 회색 단추 [배송비 기준 바꾸기] [내보내기].
// ③ "입금" 이름표 아래 받은 금액 · 남은 금액(남아 있으면 빨강) · 돌려줄 돈 (따로 묶음)
// ④ 지난 거래 내역: 거래 횟수 | 총 금액, 날짜별 줄
// 그 아래는 판매자가 손님마다 하던 일을 잃지 않게: 확인서 · 금액 고치기 · 금액 기록.
// 서버 GET /api/days/:date/order?buyer= (apps/web/src/api/order-types.ts). 금액은 서버(엔진)가 정한 정수 원 그대로, 이름·주소는 글자로만 그린다.
import { type ReactNode, useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'
import type { OrderDetailView, OrderHistoryLine, OrderInfoField, OrderPlatform } from '@livejjim/web/src/api/order-types.ts'
import type { BundleView } from '@livejjim/web/src/api/parcel-types.ts'
import { dateWords } from '@livejjim/web/src/lib/kst.ts'
import { withQuery } from '../api/client.ts'
import { useCachedGet } from '../lib/cached-get.ts'
import { useDayScope } from '../lib/day-scope.ts'
import { addressWords, countWords, dayWeekdayWords, INFO_LABEL, NO_HISTORY, ORDER_DETAIL_TITLE, ORDERS_TOPIC, orderPath, phoneDashes, reservedDateWords, shippingNote, UNKNOWN, useOrdersLive } from '../lib/orders.ts'
import { useParcelVersion } from '../lib/parcel-version.ts'
import { signalScreens, useScreenSignal } from '../lib/screen-signals.ts'
import { remainingOf, signedWon } from '../lib/settle.ts'
import { formatWon, RETRY_NOW } from '../lib/words.ts'
import { BigButton, ErrorLine, Icon, StackPage, Txt, useHoldRouteSwipe, useKit, Tap } from '../ui/kit/index.ts'
import { RADIUS, SPACE, TOUCH } from '../ui/kit/tokens.ts'
import { Loading, Notice } from '../ui/parts.tsx'
import { PlatformIcon } from '../ui/PlatformIcon.tsx'
import { DetailHeading, OrderFixes } from './order-fix.tsx'
import { EXPORT_TITLE, OrderExportSheet } from './order-export.tsx'
import { OrderInfoFlow } from './OrderInfoScreen.tsx'

/** 상세 좌우 여백 (흰 화면) */
export const DETAIL_SIDE = SPACE.xl
/** 묶음 사이 굵은 회색 띠 높이 (토스 상세 내역) */
export const BAND = SPACE.md

export const SHIPPING_RULE_BUTTON = '배송비 기준 바꾸기'
export const UNCONFIRMED_ADDRESS = '확인 전'

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
  /** 성함·휴대폰 번호·주소 줄 → 손님 정보 화면을 진짜 쌓인 화면으로 (D-UX4-126). 없으면(시험·웹) 이 화면 안에서 바꿔 끼운다 */
  readonly onEditInfo?: (field: OrderInfoField) => void
  /** 주문 탭 안에서 바꿔 끼운 화면(시험·웹)이면 밀어 뒤로 가기가 탭 경로를 닫지 않게 (D-UX4-50) */
  readonly inPlace?: boolean
}

export function OrderDetailScreen(props: OrderDetailProps) {
  const [editing, setEditing] = useState<OrderInfoField | null>(null)
  // 머리 ‹: 첫 단계가 아니면 앞 단계로, 첫 단계면 상세로 (상품 추가와 같다, D-UX4-111)
  const stepBack = useRef<(() => boolean) | null>(null)
  // 쌓인 화면이 없으면(시험·웹) 손님 정보 화면을 이 자리에서 바꿔 끼운다 — 저장하면 상세로 돌아온다
  if (editing !== null && props.onEditInfo === undefined) {
    return (
      <StackPage title={INFO_TITLE} name={INFO_TITLE} onBack={() => { if (stepBack.current?.() !== true) setEditing(null) }} scroll={false} testID="order-info-screen">
        <OrderInfoFlow date={props.date} buyer={props.buyer} field={editing} stepBack={stepBack} onBack={() => setEditing(null)} onSaved={() => setEditing(null)} />
      </StackPage>
    )
  }
  return <OrderDetailBody {...props} onEditInfo={props.onEditInfo ?? setEditing} />
}

const INFO_TITLE = '손님 정보'

function OrderDetailBody({ date, buyer, onBack, onOpenOrder, onOpenShopSettings, onOpenReceipts, onEditInfo, inPlace = false }: OrderDetailProps & { readonly onEditInfo: (field: OrderInfoField) => void }) {
  useHoldRouteSwipe(inPlace)
  const [bump, setBump] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const { data: view, error, reload } = useCachedGet<OrderDetailView>(orderPath(date, buyer), bump)
  useOrdersLive(date, () => void reload())
  // 손님 정보 화면에서 저장하면 다시 받는다
  useScreenSignal(ORDERS_TOPIC, () => setBump((n) => n + 1))
  const [parcelVersion] = useParcelVersion(date)
  // 고칠 수 있는지: 30일 지난 날짜(봉인)·택배 접수가 살아 있는 묶음·보관 기간 지난 배송지는 보기만. 손님이 적은 주소가 확인 전인지도 여기서 안다
  const { data: day } = useDayScope(date)
  const { data: parcel } = useCachedGet<{ bundle: BundleView }>(withQuery(`/api/parcels/days/${date}/bundle`, { buyer }), `${String(parcelVersion)}:${String(bump)}`)
  const bundle = parcel?.bundle ?? null
  const editable = day?.sealed !== true && bundle?.locked !== true && bundle?.expired !== true
  // 주소 아래 작은 글: 택배사가 주소를 못 찾아 돌려보냈으면 그 까닭(빨강 — 택배 화면 [배송지 보기]로 온 까닭), 손님이 적은 주소가 확인 전이면 "확인 전"(주황)
  const failed = bundle?.row.parcel?.state === 'FAILED' && bundle.row.parcel.reason === 'ADDRESS' ? bundle.row.parcel.message : null
  const addressNote: Note | null = failed !== null ? { text: failed, tone: 'danger' } : bundle?.address != null && !bundle.address.confirmed ? { text: UNCONFIRMED_ADDRESS, tone: 'warn' } : null
  const written = () => {
    setBump((n) => n + 1)
    // 아래 주문 목록 합계도 다시 받는다
    signalScreens(ORDERS_TOPIC)
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
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: SPACE.xxxl }} keyboardShouldPersistTaps="handled">
          <Head view={view} {...(editable ? { onEdit: onEditInfo } : {})} addressNote={addressNote} />
          <Band />
          <Order view={view} exportError={exportError} onExport={() => { setExportError(null); setExporting(true) }} {...(onOpenShopSettings !== undefined ? { onOpenShopSettings } : {})} />
          <Band />
          <Payment view={view} />
          <Band />
          <History view={view} {...(onOpenOrder !== undefined ? { onOpen: onOpenOrder } : {})} />
          <Band />
          <View style={{ paddingHorizontal: DETAIL_SIDE, paddingVertical: SPACE.xl }}>
            <OrderFixes date={date} buyer={buyer} name={title} onWritten={written} {...(onOpenReceipts !== undefined ? { onOpenReceipts } : {})} />
          </View>
        </ScrollView>
      )}
      <OrderExportSheet visible={exporting} date={date} buyer={buyer} onClose={() => setExporting(false)} onShareFailed={setExportError} />
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

/** ① 맨 위 플랫폼 아이콘 + 닉네임, 그 아래 성함 · 휴대폰 번호 · 주소 (왼쪽 이름표 · 오른쪽 내용, 모르면 빨간 "모름 ›") */
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
        <FactRow label={RESERVED_LABEL} value={reservedDateWords(view.claimedAt, view.date)} chevronSpace={onEdit !== undefined} />
      </View>
    </View>
  )
}

export const RESERVED_LABEL = '예약 날짜'
/** 손님 정보 줄 이름표 칸 너비 — 네 줄 내용이 같은 자리에서 시작한다 (D-UX4-127 "수평 정렬") */
const INFO_LABEL_WIDTH = 92
/** 화살표 칸 (누르지 않는 줄도 같은 너비를 비워 내용 오른쪽 끝을 맞춘다) */
const CHEVRON = 16
/** 손님 정보 줄 높이 (D-UX4-127 "간격도 지금 너무 넓어" — 48 → 40) */
const INFO_ROW_HEIGHT = 40
const infoRowStyle = { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, minHeight: INFO_ROW_HEIGHT, paddingVertical: SPACE.xs + 2, paddingHorizontal: SPACE.sm, borderRadius: RADIUS.md, borderCurve: 'continuous' } as const

/** 손님 정보 한 줄: 왼쪽 회색 이름표(같은 너비), 오른쪽 내용(모르면 빨간 "모름") + 회색 ›. 누르면 그 칸부터 묻는 손님 정보 화면 */
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
      {onEdit !== undefined ? <Icon name="chevron" color={p.textSub} size={CHEVRON} /> : null}
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

/** 누르지 않는 손님 정보 줄 (예약 날짜) — 위 줄들과 같은 칸에 맞춘다 */
function FactRow({ label, value, chevronSpace }: { readonly label: string; readonly value: string; readonly chevronSpace: boolean }) {
  return (
    <View aria-label={`${label} ${value}`} testID="info-reserved" style={infoRowStyle}>
      <View style={{ width: INFO_LABEL_WIDTH }}>
        <Txt step="body" color="textSub">{label}</Txt>
      </View>
      <View style={{ flex: 1, alignItems: 'flex-end' }}>
        <Txt step="body" weight="medium" right>{value}</Txt>
      </View>
      {chevronSpace ? <View aria-hidden style={{ width: CHEVRON }} /> : null}
    </View>
  )
}

/** 이름표(왼쪽 회색) + 값(오른쪽) 한 줄 — 토스 상세 내역. lead: 값 왼쪽 작은 회색 글("배송비 포함") */
function Line({ label, value, strong, sub, lead, danger }: { readonly label: string; readonly value: string; readonly strong?: boolean; readonly sub?: string; readonly lead?: string; readonly danger?: boolean }) {
  const on = strong === true
  return (
    <View aria-label={`${label} ${lead === undefined ? '' : `${lead} `}${value}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.lg, minHeight: 28 }}>
      <Txt step="body" color="textSub">{label}</Txt>
      <View style={{ flex: 1, alignItems: 'flex-end', gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: SPACE.sm }}>
          {lead !== undefined ? <Txt step="caption" color="textSub">{lead}</Txt> : null}
          <Txt step="body" weight={on ? 'bold' : 'medium'} color={danger === true ? 'dangerText' : 'text'} right>{value}</Txt>
        </View>
        {sub === undefined ? null : <Txt step="caption" color="textSub" right>{sub}</Txt>}
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

/** 표 칸 너비: 번호·개수는 가운데 맞춤 칸, 가격은 오른쪽 맞춤 칸 — 총합·배송비·총 결제금액 줄도 같은 칸을 쓴다 */
const NO_WIDTH = 44
const QTY_WIDTH = 44
const PRICE_WIDTH = 104
/** 상품명·가격을 칸 끝에서 살짝 띄움 (D-UX4-127 "너무 옆에 붙여서 정렬하지 말고") */
const CELL_INSET = SPACE.sm

export const TOTAL_ROW = '총합'
// 사용자는 "총 결제금액"이라 했지만 앱 글에는 "결제"를 쓰지 않는다(D-PAY-01·AC-PAY2-01 앱스토어 규칙) — 영수증 사진의 "최종 결제 금액"과 같은 "최종"으로 (D-UX4-127 AUTO)
export const GRAND_TOTAL = '최종 금액'

/** 표 한 줄 칸 나누기: [번호][상품명][개수][가격] */
function Cells({ no, name, qty, price, role = 'cell' }: { readonly no: ReactNode; readonly name: ReactNode; readonly qty: ReactNode; readonly price: ReactNode; readonly role?: 'cell' | 'columnheader' }) {
  return (
    <>
      <View role={role} style={{ width: NO_WIDTH, alignItems: 'center' }}>{no}</View>
      <View role={role} style={{ flex: 1, paddingLeft: CELL_INSET }}>{name}</View>
      <View role={role} style={{ width: QTY_WIDTH, alignItems: 'center' }}>{qty}</View>
      <View role={role} style={{ width: PRICE_WIDTH, alignItems: 'flex-end', paddingRight: CELL_INSET }}>{price}</View>
    </>
  )
}

const rowStyle = { flexDirection: 'row', alignItems: 'center', minHeight: 28 } as const

/**
 * ② 테두리 없는 표 번호 | 상품명 | 개수 | 가격 (가격은 그 줄 합), 목록 끝 얇은 구분선,
 * 총합(개수 합 · 가격 합) · 배송비(왼쪽에 무료 기준) · 할인·추가 · 총 결제금액, 오른쪽 아래 [배송비 기준 바꾸기] [내보내기]
 */
function Order({ view, onOpenShopSettings, onExport, exportError }: { readonly view: OrderDetailView; readonly onOpenShopSettings?: () => void; readonly onExport: () => void; readonly exportError: string | null }) {
  const { p } = useKit()
  const note = shippingNote(view.shippingRule)
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
        {view.items.map((item, index) => {
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
          <View style={{ width: PRICE_WIDTH, alignItems: 'flex-end', paddingRight: CELL_INSET }}>
            <Txt step="body" weight="medium" right numberOfLines={1}>{formatWon(view.subtotal)}</Txt>
          </View>
        </View>
        <View role="row" aria-label={`배송비 ${formatWon(view.shipping)}${note === '' ? '' : ` · ${note}`}`} style={rowStyle}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: SPACE.sm }}>
            <Txt step="body" color="textSub">배송비</Txt>
            {note !== '' ? <View style={{ flexShrink: 1 }}><Txt step="caption" color="textSub" right>{note}</Txt></View> : null}
          </View>
          <View style={{ width: PRICE_WIDTH, alignItems: 'flex-end', paddingRight: CELL_INSET }}>
            <Txt step="body" weight="medium" right numberOfLines={1}>{formatWon(view.shipping)}</Txt>
          </View>
        </View>
        {view.adjustments !== 0 ? (
          <View role="row" aria-label={`할인·추가 ${signedWon(view.adjustments)}`} style={rowStyle}>
            <View style={{ flex: 1 }}>
              <Txt step="body" color="textSub">할인·추가</Txt>
            </View>
            <View style={{ width: PRICE_WIDTH, alignItems: 'flex-end', paddingRight: CELL_INSET }}>
              <Txt step="body" weight="medium" right numberOfLines={1}>{signedWon(view.adjustments)}</Txt>
            </View>
          </View>
        ) : null}
        <View role="row" aria-label={`${GRAND_TOTAL} ${formatWon(view.total)}`} style={rowStyle}>
          <View style={{ flex: 1 }}>
            <Txt step="body" weight="bold">{GRAND_TOTAL}</Txt>
          </View>
          <View style={{ minWidth: PRICE_WIDTH, alignItems: 'flex-end', paddingRight: CELL_INSET }}>
            <Txt step="bodyLarge" weight="bold" right numberOfLines={1}>{formatWon(view.total)}</Txt>
          </View>
        </View>
      </View>
      {/* 단추는 좌우로만 (D-UX4-01) — 오른쪽 아래에 [배송비 기준 바꾸기] [내보내기] */}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: SPACE.sm }}>
        {onOpenShopSettings !== undefined ? <SmallButton label={SHIPPING_RULE_BUTTON} onPress={onOpenShopSettings} /> : null}
        <SmallButton label={EXPORT_TITLE} onPress={onExport} />
      </View>
      {exportError !== null ? <ErrorLine>{exportError}</ErrorLine> : null}
    </View>
  )
}

/** ③ "입금" 이름표 아래 받은 금액 · 남은 금액(남아 있으면 빨강) · 돌려줄 돈 (D-UX4-126 "별도 영역으로" → D-UX4-127 "입금 라벨", "남은 금액 남아있으면 빨간 색") */
export const PAYMENT_HEADING = '입금'

function Payment({ view }: { readonly view: OrderDetailView }) {
  const left = remainingOf(view)
  return (
    <View role="group" aria-label={PAYMENT_HEADING} style={{ paddingHorizontal: DETAIL_SIDE, paddingVertical: SPACE.xl, gap: SPACE.sm }}>
      <View style={{ marginBottom: SPACE.xs }}>
        <DetailHeading>{PAYMENT_HEADING}</DetailHeading>
      </View>
      <Line label="받은 금액" value={formatWon(view.received)} />
      <Line label="남은 금액" value={formatWon(left)} strong={left > 0} danger={left > 0} />
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
