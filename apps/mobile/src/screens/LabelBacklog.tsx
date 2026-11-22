// 쌓인 라벨 출력 (11월 12일 라이브 복기 F1·F1-2, D-RETRO-40·41 → D-PRINTALL-01).
// - [대기 중인 라벨 모두 출력하기] (PrintAllWaiting — D-PRINTALL-01, 사용자 지시 2026-11-17): 라이브 화면 라벨 탭 목록 위. 대기 라벨이 있을 때만 보이고,
//   먼저 이 라이브의 대기 라벨을 내보낸다(POST /api/print/labels/print-waiting — 끝난 라이브의 자동 라벨은 저절로 나가지 않는다, D-LIVEPRINT-01).
//   누르면 대기열이 끊김·멈춤이어도 풀고 다시 읽어 차례로 뽑는다(LabelQueue.printWaiting). 프린터가 이어져 있지 않으면 먼저 [다시 연결]로 안내한다 —
//   이어지면 바로 이어서 뽑는다. 옛 라이브 관리 "대기 n장 지금 뽑기" 줄(D-RETRO-40)은 여기로 옮겼다(대기 라벨은 라벨 탭에서 본다).
// - "라벨 없는 판매 n건 뽑기" (LabelBacklog): 라이브 관리 "라벨·프린터" 줄들 사이. 라벨 출력을 꺼 둔 동안 확정돼 라벨이 없는 판매(지금 1등인데
//   라벨 작업이 하나도 없는 찜 — 서버 canPrint)를 한꺼번에 출력 대기열에 넣는다(POST /api/print/labels/print-missing — 상품 상세의 찜별 "라벨 인쇄"와
//   같은 길). 이미 라벨이 있는 찜은 서버가 다시 넣지 않는다. 방송 화면 안(방송을 아는 곳)에서만, 봉인되지 않은 실제 방송에서만 보인다.
// - 없으면 아무것도 그리지 않는다. 단추를 위아래로 쌓지 않는다(절대 규칙 8).
// - 아이폰·갤럭시 같은 코드다(플랫폼 분기 없음).
import { useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { View } from 'react-native'
import type { LabelView } from '@livejjim/web/src/api/print-types.ts'
import { withPickWindow } from '../native/printer-pick.ts'
import { get, isApiError, newRequestId, post, withQuery, withRetry } from '../api/client.ts'
import { MISSING_BUSY, MISSING_FAILED, PRINT_ALL_WAITING, WAITING_FAILED, WAITING_NEED_PRINTER, WAITING_RECONNECT, WAITING_RECONNECT_FAILED, missingQueued, missingRowTitle, waitingResult } from '../lib/print-words.ts'
import { useServices } from '../services.tsx'
import type { Tone } from '../ui/theme.ts'
import { BigButton } from '../ui/kit/index.ts'
import { SPACE } from '../ui/kit/tokens.ts'
import { Notice } from '../ui/parts.tsx'
import { ConsoleContext } from './console/context.ts'
import { PLAIN, PlainRow } from './console/parts.tsx'

/** 그 방송의 라벨 없는 판매 수: 지금 1등인데 라벨 작업이 하나도 없는 찜 (서버가 정한 canPrint) */
export function missingLabelCount(labels: readonly Pick<LabelView, 'kind' | 'broadcast' | 'canPrint'>[], broadcastId: string): number {
  return labels.filter((label) => label.kind === 'product' && label.broadcast === broadcastId && label.canPrint).length
}

type Busy = 'waiting' | 'missing' | 'reconnect' | null

/** 대기 라벨 뽑기 — 두 곳(라벨 탭 단추·라벨 없는 판매)이 같이 쓴다. 한 번에 한 일만, 결과 한 줄과 [다시 연결] 안내 */
function useWaitingPrint() {
  const { labels } = useServices()
  const snapshot = useSyncExternalStore(labels.subscribe, labels.getSnapshot)
  const linked = snapshot.printer === 'CONNECTED' || snapshot.printer === 'PRINTING'
  const [busy, setBusy] = useState<Busy>(null)
  const [note, setNote] = useState<{ readonly tone: Tone; readonly text: string } | null>(null)
  const [needPrinter, setNeedPrinter] = useState(false)
  const locked = useRef(false)

  // 프린터가 이어지면 "먼저 다시 연결" 안내를 거둔다
  useEffect(() => {
    if (linked) setNeedPrinter(false)
  }, [linked])

  const run = async (kind: Exclude<Busy, null>, work: () => Promise<void>) => {
    if (locked.current) return
    locked.current = true
    setBusy(kind)
    setNote(null)
    try {
      await work()
    } catch (caught) {
      setNote({ tone: 'danger', text: isApiError(caught) ? caught.message : kind === 'missing' ? MISSING_FAILED : WAITING_FAILED })
    } finally {
      locked.current = false
      setBusy(null)
    }
  }

  /** 대기 맨 앞부터 뽑는다. 프린터가 없으면 [다시 연결] 안내. before: 앞에 붙일 말 (넣은 장 수) */
  const printWaiting = async (before = '') => {
    const outcome = await labels.printWaiting()
    if (outcome.kind === 'needPrinter') {
      setNeedPrinter(true)
      if (before !== '') setNote({ tone: 'info', text: before })
      return
    }
    setNeedPrinter(false)
    const result = waitingResult(outcome)
    if (result !== null) setNote({ tone: result.tone, text: before === '' ? result.text : `${before} ${result.text}` })
  }

  const reconnect = () =>
    run('reconnect', async () => {
      await withPickWindow(() => labels.reconnect())
      const now = labels.getSnapshot()
      if (now.printer !== 'CONNECTED' && now.printer !== 'PRINTING') {
        setNote({ tone: 'danger', text: now.printerError?.message ?? WAITING_RECONNECT_FAILED })
        return
      }
      await printWaiting()
    })

  return { snapshot, busy, note, needPrinter, run, printWaiting, reconnect }
}

/** 결과 한 줄과 [다시 연결] 안내 (없으면 아무것도 없다) */
function WaitingFeedback({ work, side }: { readonly work: ReturnType<typeof useWaitingPrint>; readonly side: number }) {
  const { busy, note, needPrinter, reconnect } = work
  if (!needPrinter && note === null) return null
  return (
    <View style={{ paddingHorizontal: side, paddingVertical: SPACE.xs, gap: SPACE.sm }}>
      {note !== null ? (
        <Notice tone={note.tone} alert={note.tone === 'danger'}>
          {note.text}
        </Notice>
      ) : null}
      {needPrinter ? (
        <>
          <Notice tone="warning" alert>
            {WAITING_NEED_PRINTER}
          </Notice>
          <BigButton label={WAITING_RECONNECT} testID="label-backlog-reconnect" busy={busy === 'reconnect'} disabled={busy !== null} onPress={() => void reconnect()} />
        </>
      ) : null}
    </View>
  )
}

/** 그 라이브의 대기 라벨 수 (라벨 상태가 대기인 그 라이브 상품 라벨 — 서버 라벨 목록). 라이브 밖이거나 세지 못하면 0 */
export function liveWaitingCount(labels: readonly Pick<LabelView, 'kind' | 'broadcast' | 'state'>[], broadcastId: string): number {
  return labels.filter((label) => label.kind === 'product' && label.broadcast === broadcastId && label.state === 'WAITING').length
}

function useLiveWaiting(broadcastId: string | null, date: string | null, rev: number | undefined, seq: number | undefined): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (broadcastId === null || date === null) {
      setCount(0)
      return
    }
    let alive = true
    get<{ labels: LabelView[] }>(withQuery('/api/print/labels', { date })).then(
      (view) => {
        if (alive) setCount(liveWaitingCount(view.labels, broadcastId))
      },
      // 세지 못하면 그대로 둔다 (다음 바뀜 때 다시 센다)
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [broadcastId, date, rev, seq])
  return count
}

/** 라벨 탭 [대기 중인 라벨 모두 출력하기] (D-PRINTALL-01) — 대기 라벨이 있거나 결과·안내가 남아 있을 때만 */
export function PrintAllWaiting() {
  const work = useWaitingPrint()
  const api = useContext(ConsoleContext)
  const queue = work.snapshot.queue
  // 이 라이브의 대기 라벨도 내보낸다 (D-LIVEPRINT-01): 끝난 라이브의 자동 라벨은 저절로 나가지 않으므로 이 탭에서 누를 때 손으로 넣은 작업으로 바꾼 뒤 뽑는다
  const live = api !== null && !api.sealed && !api.data.rehearsal ? api.b : null
  // 라이브 화면 안이면 이 라이브의 대기 라벨 수로 단추를 보인다 — 전체 대기 수에는 끝난 라이브 라벨이 들어가지 않는다 (D-LIVEPRINT-02)
  const liveWaiting = useLiveWaiting(live, api?.data.date ?? null, queue?.rev, api?.data.seq)
  const waiting = queue?.labelsEnabled !== true ? 0 : live !== null ? liveWaiting : queue.waiting
  const printAll = async () => {
    if (live !== null) await withRetry(() => post('/api/print/labels/print-waiting', { b: live }))
    await work.printWaiting()
  }
  if (waiting === 0 && work.note === null && !work.needPrinter) return null
  return (
    <View testID="print-all-waiting" style={{ gap: SPACE.sm }}>
      {waiting > 0 ? <BigButton label={PRINT_ALL_WAITING} testID="print-all-waiting-go" busy={work.busy === 'waiting'} disabled={work.busy !== null} onPress={() => void work.run('waiting', printAll)} /> : null}
      <WaitingFeedback work={work} side={0} />
    </View>
  )
}

/** 라이브 관리 "라벨 없는 판매 n건 뽑기". bulk: 판매자일 때만 (출력 내역·직접 인쇄와 같은 조건) */
export function LabelBacklog({ bulk }: { readonly bulk: boolean }) {
  const work = useWaitingPrint()
  const api = useContext(ConsoleContext)
  const queue = work.snapshot.queue
  const enabled = queue?.labelsEnabled === true
  const [missing, setMissing] = useState(0)
  /** 같은 묶음을 다시 보낼 때 같은 요청 번호 (네트워크 오류 뒤 다시 눌러도 한 번만 넣는다) */
  const request = useRef<string | null>(null)

  const broadcastId = api?.b ?? null
  const date = api?.data.date ?? null
  const canBulk = bulk && enabled && api !== null && !api.sealed && !api.data.rehearsal
  const rev = queue?.rev
  const seq = api?.data.seq
  useEffect(() => {
    if (!canBulk || broadcastId === null || date === null) {
      setMissing(0)
      return
    }
    let alive = true
    get<{ labels: LabelView[] }>(withQuery('/api/print/labels', { date })).then(
      (view) => {
        if (alive) setMissing(missingLabelCount(view.labels, broadcastId))
      },
      // 세지 못하면 줄을 보이지 않는다 (다음 바뀜 때 다시 센다)
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [canBulk, broadcastId, date, rev, seq])

  const queueMissing = () =>
    work.run('missing', async () => {
      if (broadcastId === null) return
      request.current ??= newRequestId()
      const requestId = request.current
      const made = await withRetry(() => post<{ jobs: unknown[] }>('/api/print/labels/print-missing', { requestId, b: broadcastId }))
      request.current = null
      await work.printWaiting(missingQueued(made.jobs.length))
    })

  if (!enabled || (missing === 0 && work.note === null && !work.needPrinter)) return null
  return (
    <View testID="label-backlog">
      {missing > 0 ? (
        <PlainRow title={missingRowTitle(missing)} testID="label-backlog-missing" {...(work.busy === 'missing' ? { value: MISSING_BUSY } : {})} {...(work.busy === null ? { onPress: () => void queueMissing() } : {})} />
      ) : null}
      <WaitingFeedback work={work} side={PLAIN.side} />
    </View>
  )
}
