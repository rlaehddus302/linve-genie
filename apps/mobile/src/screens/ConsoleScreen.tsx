// 라이브 콘솔 (SPEC §7 화면 2, 웹 ConsolePage와 같은 규칙·문구): 자리를 비운 동안 한 줄 → 실시간 상태 → 알림 띠 → 음성 → 빠른 입력 → 현재 상품 → 상품 보드 → 문자찜.
// - 범위 자료는 ScopeStore(웹과 같은 프로토콜)로 받고, 쓰기는 /api/events에 요청 번호를 붙여 보낸 뒤 응답 seq까지 따라잡는다.
// - 앱이 뒤로 갔다 돌아오면(APP-04) 실시간을 다시 잇고 쌓인 라벨을 이어 찍고 "자리를 비운 동안 라벨 n장·찜 n건·음성 n개"를 10초 보인다.
// - 라벨 상태 낱말(라벨 대기·출력됨·재출력 필요)은 서버 출력 기록(GET /api/print/labels?date=)에서 — 리허설은 없다.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { LabelView } from '@livejjim/web/src/api/print-types.ts'
import type { WriteResult } from '@livejjim/web/src/api/types.ts'
import { ApiError, get, isApiError, newRequestId, post, withQuery, withRetry } from '../api/client.ts'
import { BuyerNames, alertCounts, latestProduct } from '../lib/derive.ts'
import { ScopeStore, type ScopeSnapshot } from '../lib/scope-store.ts'
import { useAppForeground } from '../lib/use-app-state.ts'
import { LIVE_RECONNECTING, LIVE_STALE, RETRY_NOW } from '../lib/words.ts'
import { useServices } from '../services.tsx'
import { BigButton, Body, Hint, Loading, Notice, Row, Screen, Stack } from '../ui/parts.tsx'
import { AlertStrip } from './console/AlertStrip.tsx'
import { ConsoleContext, type ConsoleApi } from './console/context.ts'
import { CurrentProduct, ProductBoard } from './console/ProductBoard.tsx'
import { QuickInput, SmsInput } from './console/QuickInput.tsx'
import { VoicePanel } from './console/VoicePanel.tsx'

/** 돌아온 뒤 따라잡기를 기다리는 최대 시간 (APP-04 AC1 "3초 안에") */
const RETURN_WAIT_MS = 3000

export function useScopeStore(broadcastId: string): { store: ScopeStore; snapshot: ScopeSnapshot } {
  const services = useServices()
  const store = useMemo(() => new ScopeStore({ broadcastId, openStream: () => services.stream.open() }), [broadcastId, services])
  useEffect(() => {
    void store.start()
    return () => store.stop()
  }, [store])
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return { store, snapshot }
}

export function LiveNotice({ snapshot, onRetry }: { readonly snapshot: ScopeSnapshot; readonly onRetry: () => void }) {
  return (
    <>
      {snapshot.connection !== 'open' ? <Notice tone="warning">{LIVE_RECONNECTING}</Notice> : null}
      {snapshot.stale ? (
        <Row wrap>
          <Notice tone="warning" alert>
            {LIVE_STALE}
          </Notice>
          <BigButton small label={RETRY_NOW} onPress={onRetry} />
        </Row>
      ) : null}
    </>
  )
}

function AwayLine() {
  const { away } = useServices()
  const view = useSyncExternalStore(away.subscribe, away.getSnapshot)
  useEffect(() => {
    if (view.line === null) return
    const handle = setTimeout(() => away.tick(Date.now()), Math.max(0, view.until - Date.now()))
    return () => clearTimeout(handle)
  }, [away, view])
  if (view.line === null) return null
  return (
    <Notice tone="info" label="자리를 비운 동안">
      {view.line}
    </Notice>
  )
}

export function ConsoleScreen({ broadcastId, seller, onBack }: { readonly broadcastId: string; readonly seller: boolean; readonly onBack: () => void }) {
  const services = useServices()
  const { store, snapshot } = useScopeStore(broadcastId)
  const [selected, setSelected] = useState<string | null>(null)
  const [labels, setLabels] = useState<readonly LabelView[]>([])
  const [endError, setEndError] = useState<string | null>(null)
  const [askEnd, setAskEnd] = useState(false)
  const labelsQueue = useSyncExternalStore(services.labels.subscribe, services.labels.getSnapshot)
  const data = snapshot.data
  const broadcast = snapshot.broadcast
  const returning = useRef<{ at: number } | null>(null)

  // 앱이 뒤로 갔다 돌아옴 (APP-04)
  const finishReturn = useCallback(() => {
    if (returning.current === null) return
    returning.current = null
    services.away.back(store.getSnapshot().data?.claims.keys() ?? [], services.labels.backlog, Date.now())
  }, [services, store])
  useAppForeground({
    onBackground: () => services.away.leave(store.getSnapshot().data?.claims.keys() ?? [], Date.now()),
    onForeground: () => {
      returning.current = { at: Date.now() }
      services.stream.resume()
      services.labels.resume()
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

  const names = useMemo(() => (data === null ? null : new BuyerNames(data.buyers, data.claims)), [data])
  const labelWords = useMemo(() => {
    const map = new Map<string, string>()
    for (const label of labels) if (label.claim !== null && label.word !== '') map.set(label.claim, label.word)
    return map
  }, [labels])

  const ended = broadcast?.ended ?? false
  const sealed = data?.sealed ?? false
  const command = useCallback(
    async (event: Readonly<Record<string, unknown>>, requestId: string = newRequestId()): Promise<WriteResult> => {
      const current = store.getSnapshot()
      if (current.data === null) throw new ApiError({ status: 0, code: 'NOT_READY', message: '아직 불러오는 중이에요. 잠시 뒤 다시 눌러 주세요.' })
      if (current.data.sealed) throw new ApiError({ status: 409, code: 'SEALED', message: '30일이 지난 방송 기록은 봉인되어 고칠 수 없어요.' })
      let result: WriteResult
      try {
        result = await withRetry(() => post<WriteResult>(withQuery('/api/events', typeof event.b === 'string' ? {} : { date: current.data!.date, rehearsal: current.data!.rehearsal }), { requestId, ...event }))
      } catch (error) {
        if (isApiError(error) && error.code === 'PROCESSING_FAILED') void store.catchUp()
        throw error
      }
      await store.sync(result.seq)
      return result
    },
    [store],
  )

  // 방송이 끝나면 음성도 끈다 (APP-02 "방송 끝")
  const voiceView = useSyncExternalStore(services.voice.subscribe, services.voice.getView)
  useEffect(() => {
    if (ended && voiceView.on && voiceView.broadcastId === broadcastId) void services.voice.turnOff()
  }, [ended, voiceView.on, voiceView.broadcastId, broadcastId, services])

  const endBroadcast = async () => {
    setEndError(null)
    try {
      const result = await withRetry(() => post<WriteResult>(`/api/broadcasts/${encodeURIComponent(broadcastId)}/end`, { requestId: newRequestId() }))
      await store.sync(result.seq)
      setAskEnd(false)
    } catch (caught) {
      setEndError(isApiError(caught) ? caught.message : '끝내지 못했어요. 다시 눌러 주세요.')
    }
  }

  if (snapshot.phase === 'missing') {
    return (
      <Screen title="콘솔">
        <Notice tone="danger" alert>
          그 방송을 찾지 못했어요. 방송 목록에서 다시 골라 주세요.
        </Notice>
        <BigButton label="방송 목록으로" onPress={onBack} />
      </Screen>
    )
  }
  if (snapshot.phase === 'error' && snapshot.error !== null) {
    return (
      <Screen title="콘솔">
        <Notice tone="danger" alert>
          {snapshot.error.message}
        </Notice>
        <BigButton label={RETRY_NOW} onPress={() => void store.retryNow()} />
        <BigButton label="방송 목록으로" onPress={onBack} />
      </Screen>
    )
  }
  if (data === null || broadcast === null || names === null) {
    return (
      <Screen title="콘솔">
        <LiveNotice snapshot={snapshot} onRetry={() => void store.retryNow()} />
        <Loading />
      </Screen>
    )
  }

  const api: ConsoleApi = { b: broadcastId, data, names, ended, sealed, command, select: setSelected, selected, labelWords }
  const current = (selected === null ? undefined : data.products.get(selected)) ?? latestProduct(data, broadcastId)
  const title = broadcast.title.trim() === '' ? '제목 없음' : broadcast.title

  return (
    <ConsoleContext.Provider value={api}>
      <Screen testID="console-screen">
        <Row wrap>
          <BigButton small label="← 목록" ariaLabel="방송 목록으로" onPress={onBack} />
          <Body bold big>
            {title}
          </Body>
          {broadcast.rehearsal ? <Hint>리허설</Hint> : null}
        </Row>
        <AwayLine />
        <LiveNotice snapshot={snapshot} onRetry={() => void store.retryNow()} />
        {ended ? <Notice tone="info">끝난 방송이에요. 늦게 온 채팅·문자찜은 처리돼요.</Notice> : null}
        {sealed ? <Notice tone="info">30일이 지나 봉인한 날짜예요. 볼 수만 있어요.</Notice> : null}
        <AlertStrip counts={alertCounts(data)} queue={labelsQueue.queue} rehearsal={broadcast.rehearsal} ended={ended} />
        <VoicePanel session={services.voice} broadcastId={broadcastId} title={title} seller={seller} ended={ended} />
        <QuickInput />
        <CurrentProduct product={current} />
        <ProductBoard />
        <SmsInput />
        {!ended && !sealed ? (
          <Stack tight>
            {askEnd ? (
              <>
                <Body>방송을 끝낼까요? 끝난 뒤에도 늦게 온 채팅·문자찜은 처리돼요.</Body>
                <Row>
                  <BigButton label="끝내기" danger onPress={() => void endBroadcast()} />
                  <BigButton label="아니요" onPress={() => setAskEnd(false)} />
                </Row>
              </>
            ) : (
              <BigButton label="방송 끝내기" onPress={() => setAskEnd(true)} />
            )}
            {endError !== null ? <Notice tone="danger" alert>{endError}</Notice> : null}
          </Stack>
        ) : null}
      </Screen>
    </ConsoleContext.Provider>
  )
}
