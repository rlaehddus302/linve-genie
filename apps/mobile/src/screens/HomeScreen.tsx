// 홈 "오늘 할 일" (D-UX2-02, SPEC §7 화면 1과 같은 흐름): 인사 한 줄 → 큰 초록 "방송 시작하기"(진행 중 방송이 있으면 "방송으로 돌아가기")
// → 할 일 3줄(입금 확인·포장하기·라벨 뽑기, 숫자는 서버 값) → 지난 방송 한 줄. 새 방송은 쌓인 화면(판매 종류 → 방송 주소, NewBroadcastScreen)에서
//   시작한다 — 밀어서 뒤로 가기가 된다(D-UX3-09).
// - 입금 확인·포장하기 숫자: 가장 최근 판매 날짜의 포장 목록(GET /api/days/:date/packing) — 입금 전(미입금·부분 입금) 손님 수, 포장할 것(포장 대기·다시 확인) 손님 수.
// - 라벨 뽑기 숫자: 라벨 대기열 요약의 대기 장 수(라벨 기능을 켰을 때만). 값을 모르면 그 줄을 숨긴다.
// - 정산·구매자·택배·영수증·설정 등 웹 화면은 모두 앱 화면으로 옮겼다(D-APPX-01·03) — 더보기에서 연다. 실제 방송 전이면 "시작 준비" 줄.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import type { BroadcastItem, PackingEntry, PackingList, WizardState, WriteResult } from '@livejjim/web/src/api/types.ts'
import { dateWords } from '@livejjim/web/src/lib/kst.ts'
import { APP_NO_PASS_MESSAGE } from '@livejjim/web/src/lib/app-tab.ts'
import { get, isApiError, newRequestId, post, withRetry, type ApiError } from '../api/client.ts'
import { inFilter } from '../lib/packing.ts'
import { openWeb } from '../lib/open-web.ts'
import { formatWon, RETRY_NOW } from '../lib/words.ts'
import { useServices } from '../services.tsx'
import { BigButton, BottomSheet, GroupLabel, HeroButton, Icon, RowDivider, RowGroup, TodoRow, Txt, useKit, useTabBarRoom } from '../ui/kit/index.ts'
import { Loading, Notice } from '../ui/parts.tsx'
import { START_ROW_SUB, START_ROW_TITLE, showsStart } from './StartScreen.tsx'
import { RADIUS, SPACE, pressedFill } from '../ui/kit/tokens.ts'

export interface HomeNavigation {
  readonly openConsole: (id: string) => void
  /** 새 방송 화면 (판매 종류 → 방송 주소, D-UX3-09) */
  readonly openNewBroadcast: () => void
  readonly openPacking: () => void
  readonly openLabels: () => void
  readonly openSettings: () => void
  /** 앱 정산 탭 (D-APPX-01) — 없으면 웹 정산 */
  readonly openSettle?: () => void
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

/** 방송 이름 한 줄 ("10월 31일 저녁 방송") */
function broadcastName(item: BroadcastItem): string {
  const title = item.title.trim()
  return title === '' ? `${dateWords(item.date)} 방송` : title
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

export function HomeScreen({ nav, sellerName, refresh = 0 }: { readonly nav: HomeNavigation; readonly sellerName: string; readonly refresh?: number }) {
  const { p } = useKit()
  const room = useTabBarRoom()
  const { labels } = useServices()
  const labelSnapshot = useSyncExternalStore(labels.subscribe, labels.getSnapshot)
  const [items, setItems] = useState<BroadcastItem[] | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [day, setDay] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [createError, setCreateError] = useState<ApiError | null>(null)
  const pending = useRef<{ key: string; requestId: string } | null>(null)
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
    // 시작 안내 줄 (웹 홈이 마법사를 여는 조건과 같다 — 보조자·옛 서버는 받지 못해 줄이 없다)
    get<{ wizard: WizardState }>('/api/wizard').then(
      (view) => setWizard(view.wizard),
      () => setWizard(null),
    )
  }, [refresh])

  /** 방송 만들기 — 만든 방송 ID, 거절이면 문장을 보이고 null */
  const make = async (input: { title?: string; rehearsal?: boolean }): Promise<string | null> => {
    const key = JSON.stringify(input)
    if (pending.current?.key !== key) pending.current = { key, requestId: newRequestId() }
    const { requestId } = pending.current
    try {
      const result = await withRetry(() => post<WriteResult>('/api/broadcasts', { requestId, ...input }))
      pending.current = null
      return result.broadcast?.id ?? null
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      if (!caught.transient) pending.current = null
      setCreateError(caught)
      return null
    }
  }

  const create = async (input: { title?: string; rehearsal?: boolean }) => {
    if (busy) return
    setBusy(true)
    setCreateError(null)
    try {
      const id = await make(input)
      if (id !== null) nav.openConsole(id)
    } finally {
      setBusy(false)
    }
  }

  const live = items?.find((item) => !item.ended && !item.rehearsal) ?? items?.find((item) => !item.ended)
  const lastEnded = items?.find((item) => item.ended && !item.rehearsal)
  const entries = usePacking(day, refresh)
  const endedEntries = usePacking(lastEnded !== undefined && lastEnded.date !== day ? lastEnded.date : null, refresh)
  const counts = useMemo(() => (entries === null ? null : todoCounts(entries)), [entries])
  const sold = lastEnded === undefined ? null : (() => {
    const source = lastEnded.date === day ? entries : endedEntries
    return source === null ? null : soldOf(source, lastEnded.id)
  })()
  const queue = labelSnapshot.queue
  const labelCount = queue !== null && queue.labelsEnabled ? queue.waiting : null

  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="home-screen">
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SPACE.xl, paddingTop: 28, paddingBottom: SPACE.xxxl + room, gap: SPACE.xl }} scrollIndicatorInsets={{ bottom: room }}>
        <View style={{ gap: SPACE.xs }}>
          <Txt step="caption" color="textSub">{`${sellerName} 사장님, 안녕하세요`}</Txt>
          <Txt step="headline" weight="heavy" role="heading" aria-level={1}>
            오늘 할 일
          </Txt>
        </View>

        {live !== undefined ? (
          <HeroButton title="방송으로 돌아가기" sub={broadcastLine(live)} ariaLabel={`방송으로 돌아가기 — ${broadcastLine(live)}`} onPress={() => nav.openConsole(live.id)} />
        ) : (
          <HeroButton title="방송 시작하기" sub="유튜브 방송 링크만 붙여 넣으면 돼요" onPress={nav.openNewBroadcast} />
        )}
        {/* 새 방송·리허설은 테두리 단추 둘 (D-LIVETEST-09) — 방송 중이 아니면 큰 단추가 새 방송이라 리허설만 */}
        <View style={{ flexDirection: 'row', gap: SPACE.sm, marginTop: -SPACE.sm }}>
          {live !== undefined ? (
            <View style={{ flex: 1 }}>
              <BigButton kind="outline" label="새 방송 시작" onPress={nav.openNewBroadcast} />
            </View>
          ) : null}
          <View style={{ flex: 1 }}>
            <BigButton kind="outline" label="리허설 해 보기" disabled={busy} onPress={() => void create({ rehearsal: true })} />
          </View>
        </View>
        {createError !== null ? (
          <Notice tone="danger" alert>
            {startErrorMessage(createError)}
          </Notice>
        ) : null}

        {nav.openStart !== undefined && items !== null && showsStart(wizard, items.some((item) => !item.rehearsal)) ? (
          <RowGroup label={START_ROW_TITLE}>
            <TodoRow title={START_ROW_TITLE} sub={START_ROW_SUB} onPress={nav.openStart} />
          </RowGroup>
        ) : null}

        {counts !== null || labelCount !== null ? (
          <RowGroup label="할 일">
            {counts !== null ? (
              <>
                <TodoRow count={counts.unpaid} tone="warn" title="입금 확인" sub="돈을 아직 안 보낸 손님" onPress={() => (nav.openSettle !== undefined ? nav.openSettle() : void openWeb('/settlements'))} />
                <RowDivider />
                <TodoRow count={counts.toPack} tone="green" title="포장하기" sub="아직 포장 안 한 손님" onPress={nav.openPacking} />
              </>
            ) : null}
            {counts !== null && labelCount !== null ? <RowDivider /> : null}
            {labelCount !== null ? <TodoRow count={labelCount} tone="gray" title="라벨 뽑기" sub="아직 안 뽑은 라벨" onPress={nav.openLabels} /> : null}
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

        {lastEnded !== undefined ? (
          <View style={{ gap: 10 }}>
            <GroupLabel>지난 방송</GroupLabel>
            <Pressable role="button" aria-label={`지난 방송 열기 — ${broadcastLine(lastEnded)}`} onPress={() => nav.openConsole(lastEnded.id)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.md, borderRadius: RADIUS.lg, paddingVertical: SPACE.lg, paddingHorizontal: SPACE.xl, backgroundColor: pressed ? pressedFill(p, p.surface) : p.surface })}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt weight="bold" numberOfLines={1}>
                  {broadcastName(lastEnded)}
                </Txt>
                <Txt step="caption" color="textSub">
                  {sold === null ? dateWords(lastEnded.date) : `${String(sold.count)}개 팔림`}
                </Txt>
              </View>
              {sold === null ? <Icon name="chevron" color={p.textSub} size={20} /> : <Txt step="bodyLarge" weight="heavy">{formatWon(sold.amount)}</Txt>}
            </Pressable>
          </View>
        ) : null}
        {items !== null && items.length > 0 ? (
          <Pressable role="button" aria-label="방송 모두 보기" onPress={() => setAll(true)} style={({ pressed }) => ({ minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: SPACE.sm, marginLeft: -SPACE.sm, borderRadius: RADIUS.md, backgroundColor: pressed ? p.pressed : 'transparent' })}>
            <Txt weight="bold" color="primaryText">
              방송 모두 보기
            </Txt>
          </Pressable>
        ) : null}
      </ScrollView>

      <BottomSheet visible={all} onClose={() => setAll(false)} title="방송 모두 보기">
        {(items ?? []).slice(0, 20).map((item) => (
          <TodoRow key={item.id} title={broadcastName(item)} sub={broadcastLine(item)} ariaLabel={`콘솔 열기 — ${broadcastLine(item)}`} onPress={() => {
            setAll(false)
            nav.openConsole(item.id)
          }} testID={`broadcast-${item.id}`} />
        ))}
      </BottomSheet>
    </View>
  )
}
