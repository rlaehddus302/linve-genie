// 홈 (D-UX3-85, 사용자 지시 2026-11-09 — 토스 홈처럼): 맨 위 왼쪽 라이브 표시(방송 중이면 그 채널 프로필 사진 + 빨간 테두리·"라이브" 꼬리표 + "지금 라이브 중 >",
// 아니면 "라이브 연결 >") → 방송 이력(지난 방송만 — 방송 길이 · "59분 전", 오른쪽 ›, [모두보기] 글자 단추) → 오늘 할 일(고객 정보 받기·주문 확인서 보내기·
// 입금 확인하기·포장하기·택배 접수하기 — 설명·구분선 없음). 인사·큰 초록 단추·새 방송·리허설 단추는 없앴다. 새 방송은 쌓인 화면(NewBroadcastScreen)에서 시작한다(D-UX3-09).
// - 입금 확인·포장하기 숫자: 가장 최근 판매 날짜의 포장 목록(GET /api/days/:date/packing) — 입금 전(미입금·부분 입금) 손님 수, 포장할 것(포장 대기·다시 확인) 손님 수.
// - 라벨 뽑기 숫자: 라벨 대기열 요약의 대기 장 수(라벨 기능을 켰을 때만). 값을 모르면 그 줄을 숨긴다.
// - 정산·구매자·택배·영수증·설정 등 웹 화면은 모두 앱 화면으로 옮겼다(D-APPX-01·03) — 더보기에서 연다. 실제 방송 전이면 "시작 준비" 줄.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Image, ScrollView, Text, View } from 'react-native'
import type { BroadcastItem, PackingEntry, PackingList, ReceiptBuyers, WizardState } from '@livejjim/web/src/api/types.ts'
import type { ParcelDay } from '@livejjim/web/src/api/parcel-types.ts'
import { dateWords } from '@livejjim/web/src/lib/kst.ts'
import { APP_NO_PASS_MESSAGE } from '@livejjim/web/src/lib/app-tab.ts'
import { get, type ApiError } from '../api/client.ts'
import { peekCached, rememberCached, useCachedGet } from '../lib/cached-get.ts'
import { inFilter } from '../lib/packing.ts'
import { openWeb } from '../lib/open-web.ts'
import { RETRY_NOW } from '../lib/words.ts'
import { AppHeader, Appear, BigButton, Icon, RowGroup, TodoRow, Txt, useKit, useTabBarRoom, Tap } from '../ui/kit/index.ts'
import { Loading, Notice } from '../ui/parts.tsx'
import { Late } from '../ui/late.tsx'
import { START_ROW_SUB, START_ROW_TITLE, showsStart } from './StartScreen.tsx'
import { HistoryRow, HOME_BROADCASTS, newestFirst, pastBroadcasts, shownBroadcastTitle } from './BroadcastList.tsx'
export { broadcastLength, historyAgo, pastBroadcasts } from './BroadcastList.tsx'
import { RADIUS, GUTTER, SPACE, TOUCH } from '../ui/kit/tokens.ts'
import { font } from '../ui/kit/font.ts'
import { latestFirst } from '../lib/latest-days.ts'
import { UpdateReady } from './UpdateReady.tsx'

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
  const title = item.title.trim() === '' ? '제목 없음' : shownBroadcastTitle(item.title)
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

/** 그 날짜 하나를 받는다 — 못 받으면 null (줄을 숨긴다). 기억해 둔 값이 있으면 바로 보이고 뒤에서 다시 받는다 (D-UX4-77) */
function useDayView<T>(path: string | null, refresh: number): T | null {
  return useCachedGet<T>(path, refresh).data
}

function usePacking(date: string | null, refresh: number): readonly PackingEntry[] | null {
  // 숫자를 모르면 줄을 숨긴다
  return useCachedGet<PackingList>(date === null ? null : `/api/days/${date}/packing`, refresh).data?.entries ?? null
}

/** 마지막으로 찾은 라이브 표시 — 홈에 다시 오면 같은 방송 목록이면 바로 보인다(로그아웃하면 다른 기억과 같이 지워진다, D-UX4-77) */
const LIVE_MEMORY = 'app:home-live'

/** refresh: 바뀌면 방송 목록·할 일 숫자를 다시 받는다 (경로가 홈이 다시 보일 때 올린다 — D-UX2-07) */
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'] as const

/** 새 방송 기본 제목: `2026-11-02 월요일 방송` (요일은 그 KST 날짜 자체로) */
export function defaultBroadcastTitle(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return `${date} ${WEEKDAY[day] ?? ''}요일 라이브`
}

/** 라이브 표시 왼쪽 여백: 머리 줄 여백(20)에 더해 화면 끝에서 24 — 토스 "토스뱅크" 아이콘 자리를 재어 (D-UX4-82) */
export const HOME_LIVE_INSET = SPACE.xs

/**
 * 맨 위 "지금 라이브 중 ›" 치수 (D-UX4-87, 사용자 지시 2026-11-10 "맨 위에 폰트 크기, 두께, 색깔, 위치 … 정확하게"):
 * 우리 앱과 토스 홈 사진(같은 휴대폰, 923px = 393pt)을 나란히 재어 맞춘 값 — 토스 글자 높이 33px(우리 20pt는 38px) → 17pt,
 * 글자색은 같은 사진 안 우리 #4E5968이 찍힌 색으로 틀어짐을 빼서 #4F545E, › 는 #90969E, 아이콘 18 · 글자와 5.5 · ›와 잉크 사이 6,
 * 세로는 토스 아이콘·글자 가운데(화면 위에서 75.6pt)에 맞춰 줄을 1.7 올리고 글자를 0.9 내린다.
 * → D-UX4-88 (사용자 지시 2026-11-10 "채널 아이콘 사이즈 너무 줄였어. 원래대로 … 지금 라이브 중 사이즈 아주 조금만 늘리자. 아이콘이랑 수평 정렬"):
 *   아이콘은 옛 크기(빨간 테두리 2 · 지름 36 · 아래 "라이브" 꼬리표)로, 글자는 18(lead), 아이콘과 10. 꼬리표는 자리를 차지하지 않게 겹쳐 놓아
 *   줄 가운데 = 동그라미 가운데가 되고, 한글 글자 몸통이 줄 상자보다 1.2 위에 앉는 만큼 내려 동그라미 가운데와 맞춘다. 줄은 1.75 올려 토스 자리(75.7pt).
 */
export const HOME_LIVE = { icon: 36, ring: 2, gap: 10, chevronGap: 0, ink: '#4F545E', chevron: '#90969E', rowShift: -1.75, textShift: 1.2 } as const

/** 맨 위 왼쪽 라이브 표시 (D-UX3-85): 방송 중이면 채널 프로필 사진(빨간 테두리 + "라이브") + "지금 라이브 중 ›", 아니면 "라이브 연결 ›" */
/** 지금 라이브로 볼 수집기 상태 (끝남·멈춤·채팅 끝은 아님) */
const LIVE_COLLECTOR = new Set(['STARTING', 'LIVE', 'RETRYING'])
/** 유튜브를 잇지 않은 열린 방송(틱톡·밴드·아직 안 이음)은 만든 지 이만큼 안이면 라이브로 본다 */
const OPEN_LIVE_MS = 12 * 60 * 60_000

/**
 * 지금 라이브인 방송 (D-UX3-91): 끝나지 않은 실제 방송을 최근 것부터 보고 — 유튜브를 이은 방송은 연결이 살아 있고 수집기가 아직 읽는 중일 때만,
 * 유튜브가 없는 방송은 만든 지 12시간 안일 때만. 어제 끝내지 않고 둔 방송(유튜브 방송은 이미 끝남)은 라이브로 보지 않는다. 채널 ID도 함께
 */
interface LiveFound {
  readonly key: string
  readonly live: BroadcastItem | undefined
  readonly channel: string | null
}

/** 홈 "지난 라이브" 섹션 이름 (D-UX4-130 — 옛 "내 라이브") */
export const PAST_LIVES = '지난 라이브'
/** 지금 라이브 중일 때 방송 목록을 다시 받는 간격 (D-UX4-130) */
export const LIVE_RECHECK_MS = 30_000

export function useLiveNow(items: readonly BroadcastItem[] | null, now: number): { readonly live: BroadcastItem | undefined; readonly channel: string | null; readonly resolved: boolean } {
  const [found, keepFound] = useState<LiveFound | null>(() => peekCached<LiveFound>(LIVE_MEMORY))
  const setFound = (next: LiveFound) => {
    rememberCached(LIVE_MEMORY, next)
    keepFound(next)
  }
  const open = items === null ? [] : newestFirst(items).filter((item) => !item.ended && !item.rehearsal).slice(0, 5)
  const key = open.map((item) => item.id).join(',')
  useEffect(() => {
    if (items === null) return
    let alive = true
    void (async () => {
      for (const item of open) {
        if (!(item.platforms ?? []).includes('youtube')) {
          const at = item.createdAt == null ? Number.NaN : Date.parse(item.createdAt)
          if (Number.isNaN(at) || now - at < OPEN_LIVE_MS) {
            if (alive) setFound({ key, live: item, channel: null })
            return
          }
          continue
        }
        try {
          const view = await get<{ link: { broadcastChannelId?: string } | null; collector: { status?: string } | null }>(`/api/broadcasts/${encodeURIComponent(item.id)}/youtube`)
          if (view.link !== null && (view.collector === null || LIVE_COLLECTOR.has(view.collector.status ?? ''))) {
            if (alive) setFound({ key, live: item, channel: view.link.broadcastChannelId ?? null })
            return
          }
        } catch {
          // 모르면 다음 방송을 본다
        }
      }
      if (alive) setFound({ key, live: undefined, channel: null })
    })()
    return () => {
      alive = false
    }
    // open은 key로 대신한다 (방송 목록이 같으면 다시 묻지 않는다)
  }, [key, items === null])
  if (found === null || found.key !== key) return { live: undefined, channel: null, resolved: false }
  return { live: found.live, channel: found.channel, resolved: true }
}

function LiveEntry({ live, channel, onOpen, onConnect }: { readonly live: BroadcastItem | undefined; readonly channel: string | null; readonly onOpen: (id: string) => void; readonly onConnect: () => void }) {
  const { p, tones } = useKit()
  // 사진을 모르면 기본 그림 — 받은 적 있으면 바로 (D-UX4-77)
  const avatar = useCachedGet<{ avatar: string | null }>(channel === null || channel === '' ? null : `/api/youtube/channels/${encodeURIComponent(channel)}/avatar`).data?.avatar ?? null
  const on = live !== undefined
  // "내 라이브 연결" (D-UX3-92): 글자를 한 단계 키우고, 왼쪽에 + 원을 두고, 화면 끝에 붙지 않게 카드 안 글자 쪽으로 조금 들인다
  const label = on ? '지금 라이브 중' : '내 라이브 연결'
  const icon = HOME_LIVE.icon
  return (
    // 아이콘 36(옛 크기, D-UX4-88) · 화면 끝에서 24 · 글자 18 굵게 #4F545E · 아이콘과 10 · › 와 6 (D-UX4-87·88)
    <Tap role="button" aria-label={label} testID="home-live" onPress={() => (live !== undefined ? onOpen(live.id) : onConnect())} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: HOME_LIVE.gap, alignSelf: 'flex-start', minHeight: TOUCH.min, marginLeft: HOME_LIVE_INSET, opacity: pressed ? 0.6 : 1, transform: [{ translateY: HOME_LIVE.rowShift }] })}>
      {on ? (
        // 라이브 중: 채널 사진 + 빨간 테두리 + 아래 "라이브" 꼬리표(옛 모양 — D-UX4-88). 꼬리표는 겹쳐 놓아 줄 높이를 늘리지 않는다
        <View aria-hidden testID="home-live-avatar" style={{ width: icon, height: icon, borderRadius: icon / 2, borderCurve: 'continuous', borderWidth: HOME_LIVE.ring, borderColor: tones.danger.fg, alignItems: 'center', justifyContent: 'center' }}>
          {avatar !== null ? (
            <Image source={{ uri: avatar }} style={{ width: icon - 8, height: icon - 8, borderRadius: (icon - 8) / 2, borderCurve: 'continuous' }} />
          ) : (
            <View style={{ width: icon - 8, height: icon - 8, borderRadius: (icon - 8) / 2, borderCurve: 'continuous', backgroundColor: p.soft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="play" color={p.textSub} size={14} />
            </View>
          )}
          <View style={{ position: 'absolute', bottom: -4, alignSelf: 'center', paddingHorizontal: 3, borderRadius: 4, borderCurve: 'continuous', backgroundColor: tones.danger.fg }}>
            <Text allowFontScaling={false} style={{ fontSize: 8, lineHeight: 11, color: '#FFFFFF', ...font('700') }}>라이브</Text>
          </View>
        </View>
      ) : (
        <View aria-hidden testID="home-live-plus" style={{ width: icon, height: icon, borderRadius: icon / 2, borderCurve: 'continuous', backgroundColor: p.soft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="plus" color={p.textSub} size={18} />
        </View>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: HOME_LIVE.chevronGap, transform: [{ translateY: HOME_LIVE.textShift }] }}>
        <Txt step="lead" weight="bold" ink={HOME_LIVE.ink}>{label}</Txt>
        <Icon name="chevron" color={HOME_LIVE.chevron} size={18} />
      </View>
    </Tap>
  )
}

export function HomeScreen({ nav, refresh = 0 }: { readonly nav: HomeNavigation; readonly sellerName?: string; readonly refresh?: number }) {
  const { p } = useKit()
  const room = useTabBarRoom()
  // 다른 화면에 갔다 와도 처음부터 다시 그리지 않는다 (D-UX4-77): 기억해 둔 방송 목록·날짜·할 일 숫자로 바로 그리고, 뒤에서 다시 받아 바뀐 것만 바꾼다
  const broadcasts = useCachedGet<{ broadcasts: BroadcastItem[] }>('/api/broadcasts', refresh)
  const items = broadcasts.data?.broadcasts ?? null
  const error = broadcasts.error
  const load = broadcasts.reload
  const days = useCachedGet<{ days: { date: string; rehearsal: boolean }[] }>('/api/days', refresh).data
  const day = days === null ? null : (latestFirst(days.days)[0]?.date ?? null)
  // 시작 안내 줄 (웹 홈이 마법사를 여는 조건과 같다 — 옛 서버는 받지 못해 줄이 없다)
  const wizard = useCachedGet<{ wizard: WizardState }>('/api/wizard', refresh).data?.wizard ?? null

  // 라이브 표시는 실제 방송만 (리허설은 앱에서 뺐다)
  const liveNow = useLiveNow(items, Date.now())
  // 지금 라이브 중인 동안은 목록을 가끔 다시 받는다 — 플랫폼에서 라이브를 끝내 서버가 라이브를 끝내면(D-LIVE-AUTOEND)
  // 홈에 머물러 있어도 "지금 라이브 중"이 "지난 라이브"로 내려간다 (D-UX4-130)
  const liveId = liveNow.live?.id ?? null
  useEffect(() => {
    if (liveId === null) return
    const timer = setInterval(() => void load(), LIVE_RECHECK_MS)
    return () => clearInterval(timer)
  }, [liveId, load])
  const past = items === null ? [] : pastBroadcasts(items)
  // 홈에는 HOME_BROADCASTS개까지만 — 넘칠 때만 [모두보기] (D-UX4-81, 사용자 지시 2026-11-10)
  const showAll = nav.openAllBroadcasts !== undefined && past.length > HOME_BROADCASTS
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

  // 할 일 묶음이 처음 생길 때 함께 있던 줄 — 이 줄들은 묶음과 함께 나타나고, 그 뒤에 생기는 줄만 따로 (D-UX4-112)
  const [firstTodo, setFirstTodo] = useState<ReadonlySet<string> | null>(() => (todoRows.length > 0 ? new Set(todoRows.map((row) => row.key)) : null))
  if (firstTodo === null && todoRows.length > 0) setFirstTodo(new Set(todoRows.map((row) => row.key)))
  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="home-screen">
      {/* 모든 화면과 같은 머리 줄 (D-UX4-59): 홈 머리는 "지금 라이브 중"·"내 라이브 연결" 줄 그대로(D-UX3-92, 토스 홈 "토스뱅크 ›" 자리) — 서비스 이름을 넣지 않는다 (D-UX4-62) */}
      <AppHeader title="" left={<Late>{liveNow.resolved || error !== null ? <LiveEntry live={liveNow.live} channel={liveNow.channel} onOpen={nav.openConsole} onConnect={nav.openNewBroadcast} /> : null}</Late>} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: GUTTER, paddingTop: SPACE.sm, paddingBottom: SPACE.xxxl + room, gap: SPACE.lg }} scrollIndicatorInsets={{ bottom: room }}>

        {/* 받아 둔 새 화면이 있으면 맨 위에 [나중에] [지금 바꾸기] (D-OTA-01) */}
        <UpdateReady />

        {/* 서버에서 받은 뒤에야 생기는 묶음은 부드럽게 나타난다 — 기억해 둔 자료로 처음부터 그린 것은 바로 (D-UX4-112) */}
        <Late>
          {nav.openStart !== undefined && items !== null && showsStart(wizard, items.some((item) => !item.rehearsal)) ? (
            <RowGroup label={START_ROW_TITLE}>
              <TodoRow title={START_ROW_TITLE} sub={START_ROW_SUB} onPress={nav.openStart} />
            </RowGroup>
          ) : null}
        </Late>

        {items === null && error === null ? <Loading /> : null}
        {error !== null ? (
          <View style={{ gap: SPACE.sm }}>
            <Notice tone="danger" alert>
              {error.message}
            </Notice>
            <BigButton kind="secondary" label={RETRY_NOW} onPress={() => void load()} />
          </View>
        ) : null}

        <Late>
          {past.length > 0 ? (
            // 끝난 라이브만 모인다 — 섹션 이름 "지난 라이브" (D-UX4-130, 사용자 지시 2026-11-12 "'내 라이브' 섹션 제목을 '지난 라이브'로 바꿔. 라이브 종료되면 자동으로 여기로 옮겨")
            <View role="group" aria-label={PAST_LIVES} style={{ backgroundColor: p.surface, borderRadius: RADIUS.xl, borderCurve: 'continuous', paddingTop: SPACE.xs, paddingBottom: showAll ? SPACE.xs : SPACE.md }}>
              <View style={{ paddingHorizontal: SPACE.xl, paddingTop: SPACE.lg - 2, paddingBottom: SPACE.xs }}>
                <Txt step="body" weight="regular" color="textSub" role="heading" aria-level={2}>{PAST_LIVES}</Txt>
              </View>
              {past.slice(0, HOME_BROADCASTS).map((item) => (
                <HistoryRow key={item.id} item={item} now={now} onPress={() => nav.openConsole(item.id)} />
              ))}
              {/* 모두보기는 목록 아래 오른쪽, 글자만의 단추 (D-UX3-88). 넘쳐서 안 보이는 방송이 있을 때만(HOME_BROADCASTS개 넘음 — D-UX4-81) */}
              {!showAll || nav.openAllBroadcasts === undefined ? null : (
                <Tap role="button" aria-label="라이브 모두 보기" onPress={nav.openAllBroadcasts} hitSlop={8} style={({ pressed }) => ({ alignSelf: 'flex-end', marginRight: SPACE.md, marginBottom: SPACE.xs, paddingHorizontal: SPACE.sm, paddingVertical: SPACE.xs, borderRadius: RADIUS.sm, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
                  <Txt step="caption" color="textSub">모두보기</Txt>
                </Tap>
              )}
            </View>
          ) : null}
        </Late>

        {/* 할 일 줄은 받는 자료마다 따로 늦게 온다 — 묶음이 처음 생길 때는 묶음째, 그 뒤 새로 생긴 줄만 따로 부드럽게 (D-UX4-112) */}
        <Late>
          {todoRows.length > 0 ? (
            <RowGroup title="오늘 할 일" label="오늘 할 일">
              {todoRows.map((row) => (
                <Appear key={row.key} instant={firstTodo?.has(row.key) !== false}>
                  {row.node}
                </Appear>
              ))}
            </RowGroup>
          ) : null}
        </Late>
      </ScrollView>
    </View>
  )
}
