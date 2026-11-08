// 홈 (D-UX3-85, 사용자 지시 2026-11-09 — 토스 홈처럼): 맨 위 왼쪽 라이브 표시(방송 중이면 그 채널 프로필 사진 + 빨간 테두리·"라이브" 꼬리표 + "지금 라이브 중 >",
// 아니면 "라이브 연결 >") → 방송 이력(지난 방송만 — 방송 길이 · "59분 전", 오른쪽 ›, [모두보기] 글자 단추) → 오늘 할 일(고객 정보 받기·주문 확인서 보내기·
// 입금 확인하기·포장하기·택배 접수하기 — 설명·구분선 없음). 인사·큰 초록 단추·새 방송·리허설 단추는 없앴다. 새 방송은 쌓인 화면(NewBroadcastScreen)에서 시작한다(D-UX3-09).
// - 입금 확인·포장하기 숫자: 가장 최근 판매 날짜의 포장 목록(GET /api/days/:date/packing) — 입금 전(미입금·부분 입금) 손님 수, 포장할 것(포장 대기·다시 확인) 손님 수.
// - 라벨 뽑기 숫자: 라벨 대기열 요약의 대기 장 수(라벨 기능을 켰을 때만). 값을 모르면 그 줄을 숨긴다.
// - 정산·구매자·택배·영수증·설정 등 웹 화면은 모두 앱 화면으로 옮겼다(D-APPX-01·03) — 더보기에서 연다. 실제 방송 전이면 "시작 준비" 줄.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Image, Pressable, ScrollView, Text, View } from 'react-native'
import type { BroadcastItem, PackingEntry, PackingList, ReceiptBuyers, WizardState } from '@livejjim/web/src/api/types.ts'
import type { ParcelDay } from '@livejjim/web/src/api/parcel-types.ts'
import { dateWords } from '@livejjim/web/src/lib/kst.ts'
import { APP_NO_PASS_MESSAGE } from '@livejjim/web/src/lib/app-tab.ts'
import { get, isApiError, type ApiError } from '../api/client.ts'
import { inFilter } from '../lib/packing.ts'
import { openWeb } from '../lib/open-web.ts'
import { RETRY_NOW } from '../lib/words.ts'
import { BigButton, Icon, RowGroup, TodoRow, Txt, useKit, useTabBarRoom } from '../ui/kit/index.ts'
import { Loading, Notice } from '../ui/parts.tsx'
import { START_ROW_SUB, START_ROW_TITLE, showsStart } from './StartScreen.tsx'
import { HistoryRow, HOME_BROADCASTS, liveBroadcast, pastBroadcasts } from './BroadcastList.tsx'
export { broadcastLength, historyAgo, pastBroadcasts } from './BroadcastList.tsx'
import { RADIUS, SPACE, TOUCH } from '../ui/kit/tokens.ts'
import { font } from '../ui/kit/font.ts'

export interface HomeNavigation {
  readonly openConsole: (id: string) => void
  /** 새 방송 화면 (판매 종류 → 방송 주소, D-UX3-09) */
  readonly openNewBroadcast: () => void
  readonly openPacking: () => void
  readonly openLabels: () => void
  readonly openSettings: () => void
  /** 택배 탭 — 그 날짜부터 (D-UX3-39) */
  readonly openParcels?: (date: string) => void
  /** 확인서 보내기 화면 (D-UX3-39) */
  readonly openReceipts?: () => void
  /** 앱 정산(주문) 탭 (D-APPX-01) — 없으면 웹 정산 */
  readonly openSettle?: () => void
  /** 내 방송 모두 보기 (쌓인 화면, D-UX3-18) */
  readonly openAllBroadcasts?: () => void
  /** 시작 안내 (D-APPX-03) — 없으면 줄을 보이지 않는다 */
  readonly openStart?: () => void
}

export function broadcastLine(item: BroadcastItem): string {
  const title = item.title.trim() === '' ? '제목 없음' : item.title
  return `${title} · ${dateWords(item.date)}${item.rehearsal ? ' · 리허설' : ''}${item.ended ? ' · 끝남' : ' · 진행 중'}`
}

/**
 * 방송 시작 거절 문장 (PAY2 BL-11 2, D-PAY-03): 이용권이 없다는 거절(`NO_PASS`)은 서버 문장 대신 앱 문장 하나만 — 링크·버튼 없음.
 * 다른 거절은 서버 문장 그대로.
 */
export function startErrorMessage(error: ApiError): string {
  return error.code === 'NO_PASS' ? APP_NO_PASS_MESSAGE : error.message
}

/** 할 일 숫자 (포장 목록에서). 입금 전 = 미입금·부분 입금, 포장할 것 = 포장 대기·포장 다시 확인 */
export function todoCounts(entries: readonly PackingEntry[]): { readonly unpaid: number; readonly toPack: number; readonly done: number } {
  let unpaid = 0
  let toPack = 0
  let done = 0
  for (const entry of entries) {
    if (entry.payment === 'UNPAID' || entry.payment === 'PARTIAL') unpaid++
    if (inFilter(entry, 'todo')) toPack++
    else done++
  }
  return { unpaid, toPack, done }
}

/** 지난 방송 한 줄의 판 개수·금액 (그 방송 품목만, 정수 원) */
export function soldOf(entries: readonly PackingEntry[], broadcastId: string): { readonly count: number; readonly amount: number } {
  let count = 0
  let amount = 0
  for (const entry of entries)
    for (const item of entry.items) {
      if (item.broadcast !== broadcastId) continue
      const qty = item.qty ?? 1
      count += qty
      amount += item.price * qty
    }
  return { count, amount }
}

/**
 * 방송 뒤 흐름의 나머지 수 (D-UX3-39): 손님 정보 못 받음 = 품목 있는 묶음 중 배송지가 없는 것(직접 수령·합배송·직접 넣은 택배 뺌),
 * 확인서 안 보냄 = 링크도 문자도 보내지 않은 손님, 택배 접수 전 = 보낼 수 있는 묶음. 값을 모르면 null(그 줄을 숨긴다)
 */
export function flowCounts(parcels: ParcelDay | null, receipts: ReceiptBuyers | null): { readonly info: number | null; readonly receipt: number | null; readonly parcel: number | null } {
  const rows = parcels === null ? null : [...parcels.ready, ...parcels.excluded, ...parcels.booked]
  const info = rows === null ? null : rows.filter((row) => row.extra !== true && row.itemCount > 0 && row.shipping !== 'PICKUP' && row.shipping !== 'COMBINED' && row.address === 'NONE').length
  const receipt = receipts === null ? null : receipts.buyers.filter((row) => (row.link === null || row.link.status === 'NONE') && (row.sms == null || row.sms.sentAt === null)).length
  return { info, receipt, parcel: parcels === null ? null : parcels.ready.length }
}

/** 그 날짜 하나를 받는다 — 못 받으면 null (줄을 숨긴다) */
function useDayView<T>(path: string | null, refresh: number): T | null {
  const [view, setView] = useState<T | null>(null)
  useEffect(() => {
    if (path === null) return
    let alive = true
    get<T>(path).then(
      (result) => {
        if (alive) setView(result)
      },
      () => {
        if (alive) setView(null)
      },
    )
    return () => {
      alive = false
    }
  }, [path, refresh])
  return view
}

function usePacking(date: string | null, refresh: number): readonly PackingEntry[] | null {
  const [entries, setEntries] = useState<readonly PackingEntry[] | null>(null)
  useEffect(() => {
    if (date === null) return
    let alive = true
    get<PackingList>(`/api/days/${date}/packing`).then(
      (view) => {
        if (alive) setEntries(view.entries)
      },
      () => {
        // 숫자를 모르면 줄을 숨긴다
      },
    )
    return () => {
      alive = false
    }
  }, [date, refresh])
  return entries
}

/** refresh: 바뀌면 방송 목록·할 일 숫자를 다시 받는다 (경로가 홈이 다시 보일 때 올린다 — D-UX2-07) */
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'] as const

/** 새 방송 기본 제목: `2026-11-02 월요일 방송` (요일은 그 KST 날짜 자체로) */
export function defaultBroadcastTitle(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return `${date} ${WEEKDAY[day] ?? ''}요일 방송`
}

/** 라이브 표시 프로필 사진 지름 — 옆 글자 높이에 맞춘다 (D-UX3-87, 토스 "토스뱅크 ›"처럼) */
const AVATAR = 26

/** 맨 위 왼쪽 라이브 표시 (D-UX3-85): 방송 중이면 채널 프로필 사진(빨간 테두리 + "라이브") + "지금 라이브 중 ›", 아니면 "라이브 연결 ›" */
function LiveEntry({ live, onOpen, onConnect }: { readonly live: BroadcastItem | undefined; readonly onOpen: (id: string) => void; readonly onConnect: () => void }) {
  const { p, tones } = useKit()
  const [avatar, setAvatar] = useState<string | null>(null)
  const liveId = live?.id ?? null
  useEffect(() => {
    setAvatar(null)
    if (liveId === null) return
    let alive = true
    void (async () => {
      try {
        const view = await get<{ link: { broadcastChannelId?: string } | null }>(`/api/broadcasts/${encodeURIComponent(liveId)}/youtube`)
        const channel = view.link?.broadcastChannelId
        if (channel === undefined || channel === '') return
        const found = await get<{ avatar: string | null }>(`/api/youtube/channels/${encodeURIComponent(channel)}/avatar`)
        if (alive) setAvatar(found.avatar)
      } catch {
        // 사진을 모르면 기본 그림
      }
    })()
    return () => {
      alive = false
    }
  }, [liveId])
  const on = live !== undefined
  const label = on ? '지금 라이브 중' : '라이브 연결'
  return (
    <Pressable role="button" aria-label={label} testID="home-live" onPress={() => (live !== undefined ? onOpen(live.id) : onConnect())} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, alignSelf: 'flex-start', minHeight: TOUCH.min, opacity: pressed ? 0.6 : 1 })}>
      {on ? (
        <View aria-hidden style={{ width: AVATAR + 6, height: AVATAR + 10, alignItems: 'center' }}>
          <View style={{ width: AVATAR + 6, height: AVATAR + 6, borderRadius: (AVATAR + 6) / 2, borderCurve: 'continuous', borderWidth: 2, borderColor: tones.danger.fg, alignItems: 'center', justifyContent: 'center' }}>
            {avatar !== null ? (
              <Image source={{ uri: avatar }} style={{ width: AVATAR - 2, height: AVATAR - 2, borderRadius: (AVATAR - 2) / 2, borderCurve: 'continuous' }} />
            ) : (
              <View style={{ width: AVATAR - 2, height: AVATAR - 2, borderRadius: (AVATAR - 2) / 2, borderCurve: 'continuous', backgroundColor: p.soft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="play" color={p.textSub} size={14} />
              </View>
            )}
          </View>
          <View style={{ position: 'absolute', bottom: 0, paddingHorizontal: 3, borderRadius: 4, borderCurve: 'continuous', backgroundColor: tones.danger.fg }}>
            <Text allowFontScaling={false} style={{ fontSize: 8, lineHeight: 11, color: '#FFFFFF', ...font('700') }}>라이브</Text>
          </View>
        </View>
      ) : null}
      {/* 글자와 › 사이는 좁게 (토스 "토스뱅크 ›") */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        <Txt step="lead" weight="heavy">{label}</Txt>
        <Icon name="chevron" color={p.textSub} size={16} />
      </View>
    </Pressable>
  )
}

export function HomeScreen({ nav, refresh = 0 }: { readonly nav: HomeNavigation; readonly sellerName?: string; readonly refresh?: number }) {
  const { p } = useKit()
  const room = useTabBarRoom()
  const [items, setItems] = useState<BroadcastItem[] | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [day, setDay] = useState<string | null>(null)
  const [wizard, setWizard] = useState<WizardState | null>(null)

  const load = async () => {
    setError(null)
    try {
      const { broadcasts } = await get<{ broadcasts: BroadcastItem[] }>('/api/broadcasts')
      setItems(broadcasts)
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    }
  }

  useEffect(() => {
    void load()
    get<{ days: { date: string; rehearsal: boolean }[] }>('/api/days').then(
      (view) => setDay(view.days.find((item) => !item.rehearsal)?.date ?? null),
      () => setDay(null),
    )
    // 시작 안내 줄 (웹 홈이 마법사를 여는 조건과 같다 — 옛 서버는 받지 못해 줄이 없다)
    get<{ wizard: WizardState }>('/api/wizard').then(
      (view) => setWizard(view.wizard),
      () => setWizard(null),
    )
  }, [refresh])

  // 라이브 표시는 실제 방송만 (리허설은 앱에서 뺐다)
  const liveItem = items === null ? undefined : liveBroadcast(items)
  const live = liveItem !== undefined && !liveItem.rehearsal ? liveItem : undefined
  const past = items === null ? [] : pastBroadcasts(items)
  const now = Date.now()
  const entries = usePacking(day, refresh)
  const counts = useMemo(() => (entries === null ? null : todoCounts(entries)), [entries])
  // 방송 뒤 흐름 (D-UX3-39): 정보 받기 → 확인서 → 입금 → 포장 → 택배 접수
  const parcelDay = useDayView<ParcelDay>(day === null ? null : `/api/parcels/days/${day}`, refresh)
  const receiptDay = useDayView<ReceiptBuyers>(day === null ? null : `/api/days/${day}/receipt-buyers`, refresh)
  const flow = useMemo(() => flowCounts(parcelDay, receiptDay), [parcelDay, receiptDay])
  const openSettle = () => (nav.openSettle !== undefined ? nav.openSettle() : void openWeb('/settlements'))
  const todoRows: { readonly key: string; readonly node: ReactNode }[] = []
  if (flow.info !== null) todoRows.push({ key: 'info', node: <TodoRow count={flow.info} tone="warn" title="고객 정보 받기" onPress={openSettle} /> })
  if (flow.receipt !== null && nav.openReceipts !== undefined) todoRows.push({ key: 'receipt', node: <TodoRow count={flow.receipt} tone="warn" title="주문 확인서 보내기" onPress={nav.openReceipts} /> })
  if (counts !== null) {
    todoRows.push({ key: 'unpaid', node: <TodoRow count={counts.unpaid} tone="warn" title="입금 확인하기" onPress={openSettle} /> })
    todoRows.push({ key: 'pack', node: <TodoRow count={counts.toPack} tone="green" title="포장하기" onPress={nav.openPacking} /> })
  }
  if (flow.parcel !== null && nav.openParcels !== undefined && day !== null) {
    const openParcels = nav.openParcels
    todoRows.push({ key: 'parcel', node: <TodoRow count={flow.parcel} tone="green" title="택배 접수하기" onPress={() => openParcels(day)} /> })
  }

  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="home-screen">
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SPACE.xl, paddingTop: SPACE.lg, paddingBottom: SPACE.xxxl + room, gap: SPACE.lg }} scrollIndicatorInsets={{ bottom: room }}>
        <LiveEntry live={live} onOpen={nav.openConsole} onConnect={nav.openNewBroadcast} />

        {nav.openStart !== undefined && items !== null && showsStart(wizard, items.some((item) => !item.rehearsal)) ? (
          <RowGroup label={START_ROW_TITLE}>
            <TodoRow title={START_ROW_TITLE} sub={START_ROW_SUB} onPress={nav.openStart} />
          </RowGroup>
        ) : null}

        {items === null && error === null ? <Loading /> : null}
        {error !== null ? (
          <View style={{ gap: SPACE.sm }}>
            <Notice tone="danger" alert>
              {error.message}
            </Notice>
            <BigButton kind="secondary" label={RETRY_NOW} onPress={() => void load()} />
          </View>
        ) : null}

        {past.length > 0 ? (
          <View role="group" aria-label="내 방송" style={{ backgroundColor: p.surface, borderRadius: RADIUS.xl, borderCurve: 'continuous', paddingVertical: SPACE.xs }}>
            <View style={{ paddingHorizontal: SPACE.xl, paddingTop: SPACE.lg - 2, paddingBottom: SPACE.xs }}>
              <Txt step="body" weight="book" color="textSub" role="heading" aria-level={2}>내 방송</Txt>
            </View>
            {past.slice(0, HOME_BROADCASTS).map((item) => (
              <HistoryRow key={item.id} item={item} now={now} onPress={() => nav.openConsole(item.id)} />
            ))}
            {/* 모두보기는 목록 아래 오른쪽, 글자만의 단추 (D-UX3-88) */}
            {nav.openAllBroadcasts === undefined ? null : (
              <Pressable role="button" aria-label="방송 모두 보기" onPress={nav.openAllBroadcasts} hitSlop={8} style={({ pressed }) => ({ alignSelf: 'flex-end', marginRight: SPACE.md, marginBottom: SPACE.xs, paddingHorizontal: SPACE.sm, paddingVertical: SPACE.xs, borderRadius: RADIUS.sm, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
                <Txt step="caption" color="textSub">모두보기</Txt>
              </Pressable>
            )}
          </View>
        ) : null}

        {todoRows.length > 0 ? (
          <RowGroup title="오늘 할 일" label="오늘 할 일">
            {todoRows.map((row) => (
              <View key={row.key}>{row.node}</View>
            ))}
          </RowGroup>
        ) : null}
      </ScrollView>
    </View>
  )
}
