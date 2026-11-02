// 홈 "오늘 할 일" (D-UX2-02, SPEC §7 화면 1과 같은 흐름): 인사 한 줄 → 큰 초록 "방송 시작하기"(진행 중 방송이 있으면 "방송으로 돌아가기")
// → 할 일 3줄(입금 확인·포장하기·라벨 뽑기, 숫자는 서버 값) → 지난 방송 한 줄. 새 방송은 전체 화면에서 시작한다(D-UX3-06·07):
//   처음엔 "방송 제목" 칸 하나(비어 있고 오늘 날짜 제목이 예시 글 — 비워 두면 그 제목) + [다음] → 그 아래에 "방송 주소" 칸,
//   주소를 넣으면 [이 방송에 잇기]가 나타나 방송을 만들고 바로 잇는다. 주소 없이 시작하는 단추는 없다(주소 없이는 채팅을 못 읽는다).
//   유튜브를 이을 수 없는 서버(읽기 꺼짐·구글 연결 없음)면 주소 단계 없이 [다음]이 바로 방송을 만든다 — 방송 화면이 연결 안내를 보인다.
// - 입금 확인·포장하기 숫자: 가장 최근 판매 날짜의 포장 목록(GET /api/days/:date/packing) — 입금 전(미입금·부분 입금) 손님 수, 포장할 것(포장 대기·다시 확인) 손님 수.
// - 라벨 뽑기 숫자: 라벨 대기열 요약의 대기 장 수(라벨 기능을 켰을 때만). 값을 모르면 그 줄을 숨긴다.
// - 정산·구매자·택배·영수증·설정 등 웹 화면은 모두 앱 화면으로 옮겼다(D-APPX-01·03) — 더보기에서 연다. 실제 방송 전이면 "시작 준비" 줄.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import type { BroadcastItem, PackingEntry, PackingList, WizardState, WriteResult, YoutubeConnectionResponse, YoutubeWebChat } from '@livejjim/web/src/api/types.ts'
import { dateWords, kstToday } from '@livejjim/web/src/lib/kst.ts'
import { APP_NO_PASS_MESSAGE } from '@livejjim/web/src/lib/app-tab.ts'
import { get, isApiError, newRequestId, post, withRetry, type ApiError } from '../api/client.ts'
import { inFilter } from '../lib/packing.ts'
import { openWeb } from '../lib/open-web.ts'
import { formatWon, RETRY_NOW } from '../lib/words.ts'
import { readModeOf } from '../lib/youtube.ts'
import { markLinkAsked, useAddressLinker, type LinkBody } from './console/YoutubeSection.tsx'
import { useServices } from '../services.tsx'
import { BigButton, BottomSheet, FullSheet, GroupLabel, HeroButton, Icon, RowDivider, RowGroup, TodoRow, Txt, useKit } from '../ui/kit/index.ts'
import { Field, Loading, Notice } from '../ui/parts.tsx'
import { START_ROW_SUB, START_ROW_TITLE, showsStart } from './StartScreen.tsx'
import { RADIUS, SPACE, pressedFill } from '../ui/kit/tokens.ts'

export interface HomeNavigation {
  readonly openConsole: (id: string) => void
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
  const { labels } = useServices()
  const labelSnapshot = useSyncExternalStore(labels.subscribe, labels.getSnapshot)
  const [items, setItems] = useState<BroadcastItem[] | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [day, setDay] = useState<string | null>(null)
  const [sheet, setSheet] = useState(false)
  const [all, setAll] = useState(false)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [createError, setCreateError] = useState<ApiError | null>(null)
  const pending = useRef<{ key: string; requestId: string } | null>(null)
  // 새 방송 화면 단계 (D-UX3-06): 제목 → 주소. route가 null이면 이을 수 없는 서버 — 주소 단계 없이 바로 만든다. undefined = 아직 확인 중
  const [step, setStep] = useState<'title' | 'address'>('title')
  const [route, setRoute] = useState<{ readonly webChat: YoutubeWebChat | null } | null | undefined>(undefined)
  /** 주소 단계에서 이미 만든 방송 (잇기를 다시 눌러도 방송을 또 만들지 않는다) */
  const made = useRef<string | null>(null)
  const [madeId, setMadeId] = useState<string | null>(null)
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

  const finish = (id: string) => {
    setSheet(false)
    nav.openConsole(id)
  }

  const create = async (input: { title?: string; rehearsal?: boolean }) => {
    if (busy) return
    setBusy(true)
    setCreateError(null)
    try {
      const id = await make(input)
      if (id !== null) finish(id)
    } finally {
      setBusy(false)
    }
  }

  // 비워 두면 오늘 날짜 제목 (D-UX3-07 — 칸은 비어 있고 날짜 제목은 예시 글)
  const titleInput = () => ({ title: title.trim() === '' ? placeholderTitle : title.trim() })

  /** 주소 단계: 아직 안 만들었으면 만든다 (한 번만) */
  const ensureMade = async (): Promise<string | null> => {
    if (made.current !== null) return made.current
    setCreateError(null)
    const id = await make(titleInput())
    if (id !== null) {
      made.current = id
      setMadeId(id)
      // 주소 단계를 거쳤다 — 방송 화면이 연결 판을 다시 저절로 열지 않는다
      markLinkAsked(id)
    }
    return id
  }

  /** [이 방송에 잇기]: 방송을 만들고 그 방송에 잇는다. 잇기 거절(처음 잇는 채널 확인 등)은 주소 칸이 보인다 */
  const linkNew = async (body: LinkBody) => {
    const id = await ensureMade()
    if (id === null) return
    await withRetry(() => post(`/api/broadcasts/${encodeURIComponent(id)}/youtube`, body))
    finish(id)
  }

  // 확인이 끝나기 전에 [다음]을 누르면 확인이 끝나는 대로 이어 간다(눌렀는데 아무 일 없는 단추가 되지 않게)
  const [waitingNext, setWaitingNext] = useState(false)
  const next = () => {
    if (route === undefined) setWaitingNext(true)
    else if (route === null) void create(titleInput())
    else setStep('address')
  }
  useEffect(() => {
    if (!waitingNext || route === undefined) return
    setWaitingNext(false)
    if (route === null) void create(titleInput())
    else setStep('address')
    // create·title은 누른 그때 값으로 충분하다 — 확인이 끝날 때 한 번만
  }, [waitingNext, route])

  // 새 방송 제목은 오늘 날짜로 미리 채운다 ("2026-11-02 월요일 방송", D-LIVETEST-09) — 바꿔도 된다
  const [placeholderTitle, setPlaceholderTitle] = useState('')
  const linker = useAddressLinker({ enabled: sheet && step === 'address', webChat: route?.webChat ?? null, broadcastId: madeId, submit: linkNew, autoFocus: true, disabled: busy })
  const openStart = () => {
    setTitle('')
    setPlaceholderTitle(defaultBroadcastTitle(kstToday()))
    setStep('title')
    setCreateError(null)
    made.current = null
    setMadeId(null)
    setRoute(undefined)
    setSheet(true)
    // 이 서버에서 유튜브 방송을 이을 수 있나 — 이을 수 있을 때만 주소 단계를 둔다
    get<YoutubeConnectionResponse>('/api/youtube/connection').then(
      (body) => {
        const { webChat } = readModeOf(body)
        if (webChat !== null) setRoute(webChat.on ? { webChat } : null)
        else setRoute(body.connection?.status === 'CONNECTED' ? { webChat: null } : null)
      },
      () => setRoute(null),
    )
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
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SPACE.xl, paddingTop: 28, paddingBottom: SPACE.xxxl, gap: SPACE.xl }}>
        <View style={{ gap: SPACE.xs }}>
          <Txt step="caption" color="textSub">{`${sellerName} 사장님, 안녕하세요`}</Txt>
          <Txt step="headline" weight="heavy" role="heading" aria-level={1}>
            오늘 할 일
          </Txt>
        </View>

        {live !== undefined ? (
          <HeroButton title="방송으로 돌아가기" sub={broadcastLine(live)} ariaLabel={`방송으로 돌아가기 — ${broadcastLine(live)}`} onPress={() => nav.openConsole(live.id)} />
        ) : (
          <HeroButton title="방송 시작하기" sub="유튜브 방송 주소만 붙여 넣으면 돼요" onPress={openStart} />
        )}
        {/* 새 방송·리허설은 테두리 단추 둘 (D-LIVETEST-09) — 방송 중이 아니면 큰 단추가 새 방송이라 리허설만 */}
        <View style={{ flexDirection: 'row', gap: SPACE.sm, marginTop: -SPACE.sm }}>
          {live !== undefined ? (
            <View style={{ flex: 1 }}>
              <BigButton kind="outline" label="새 방송 시작" onPress={openStart} />
            </View>
          ) : null}
          <View style={{ flex: 1 }}>
            <BigButton kind="outline" label="리허설 해 보기" disabled={busy} onPress={() => void create({ rehearsal: true })} />
          </View>
        </View>
        {createError !== null && !sheet ? (
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

      <FullSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        name="새 방송"
        title={step === 'title' ? '어떤 방송인가요?' : '방송 주소를 넣어 주세요'}
        actions={step === 'title' ? <BigButton label="다음" disabled={busy} busy={busy || waitingNext} onPress={next} /> : linker.action}
      >
        <Field label="방송 제목" value={title} onChangeText={setTitle} placeholder={placeholderTitle} autoFocus={step === 'title'} editable={madeId === null} returnKeyType="next" onSubmitEditing={step === 'title' ? next : undefined} />
        {step === 'address' && route !== null && route !== undefined ? linker.fields : null}
        {createError !== null ? (
          <Notice tone="danger" alert>
            {startErrorMessage(createError)}
          </Notice>
        ) : null}
      </FullSheet>

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
