// 쌓인 라벨 뽑기 (11월 12일 라이브 복기 F1·F1-2, D-RETRO-40·41): 라이브 관리 "라벨·프린터" 줄들 사이에 놓는다.
// - "대기 n장 지금 뽑기": 대기 중인 라벨 수를 보이고, 누르면 대기열이 끊김·멈춤이어도 풀고 다시 읽어 차례로 뽑는다(LabelQueue.printWaiting).
//   프린터가 이어져 있지 않으면 먼저 [다시 연결]로 안내한다 — 이어지면 바로 이어서 뽑는다. 방송에서는 라벨 2장이 대기로 남아 끝내 안 나왔고 풀 단추가 없었다.
// - "라벨 없는 판매 n건 뽑기": 라벨 뽑기를 꺼 둔 동안 확정돼 라벨이 없는 판매(지금 1등인데 라벨 작업이 하나도 없는 찜 — 서버 canPrint)를
//   한꺼번에 출력 대기열에 넣는다(POST /api/print/labels/print-missing — 상품 상세의 찜별 "라벨 인쇄"와 같은 길). 이미 라벨이 있는 찜은 서버가 다시 넣지 않는다.
//   방송 화면 안(방송을 아는 곳)에서만, 봉인되지 않은 실제 방송에서만 보인다.
// - 둘 다 없으면 아무것도 그리지 않는다. 줄 모양은 옆 줄(프린터 연결 ›)과 같은 흰 화면 줄 — 단추를 위아래로 쌓지 않는다(절대 규칙 8).
// - 아이폰·갤럭시 같은 코드다(플랫폼 분기 없음).
import { useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { View } from 'react-native'
import type { LabelView } from '@livejjim/web/src/api/print-types.ts'
import { get, isApiError, newRequestId, post, withQuery, withRetry } from '../api/client.ts'
import { MISSING_BUSY, MISSING_FAILED, WAITING_BUSY, WAITING_FAILED, WAITING_NEED_PRINTER, WAITING_RECONNECT, WAITING_RECONNECT_FAILED, missingQueued, missingRowTitle, waitingResult, waitingRowTitle } from '../lib/print-words.ts'
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

/** bulk: 라벨 없는 판매 뽑기도 보인다 (판매자 — 출력 내역·직접 인쇄와 같은 조건) */
export function LabelBacklog({ bulk }: { readonly bulk: boolean }) {
  const { labels } = useServices()
  const snapshot = useSyncExternalStore(labels.subscribe, labels.getSnapshot)
  const api = useContext(ConsoleContext)
  const queue = snapshot.queue
  const enabled = queue?.labelsEnabled === true
  const waiting = enabled ? (queue?.waiting ?? 0) : 0
  const linked = snapshot.printer === 'CONNECTED' || snapshot.printer === 'PRINTING'
  const [busy, setBusy] = useState<Busy>(null)
  const [note, setNote] = useState<{ readonly tone: Tone; readonly text: string } | null>(null)
  const [needPrinter, setNeedPrinter] = useState(false)
  const [missing, setMissing] = useState(0)
  const locked = useRef(false)
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
      await labels.reconnect()
      const now = labels.getSnapshot()
      if (now.printer !== 'CONNECTED' && now.printer !== 'PRINTING') {
        setNote({ tone: 'danger', text: now.printerError?.message ?? WAITING_RECONNECT_FAILED })
        return
      }
      await printWaiting()
    })

  const queueMissing = () =>
    run('missing', async () => {
      if (broadcastId === null) return
      request.current ??= newRequestId()
      const requestId = request.current
      const made = await withRetry(() => post<{ jobs: unknown[] }>('/api/print/labels/print-missing', { requestId, b: broadcastId }))
      request.current = null
      await printWaiting(missingQueued(made.jobs.length))
    })

  if (!enabled || (waiting === 0 && missing === 0 && note === null && !needPrinter)) return null
  return (
    <View testID="label-backlog">
      {waiting > 0 ? (
        <PlainRow title={waitingRowTitle(waiting)} testID="label-backlog-waiting" {...(busy === 'waiting' ? { value: WAITING_BUSY } : {})} {...(busy === null ? { onPress: () => void run('waiting', () => printWaiting()) } : {})} />
      ) : null}
      {missing > 0 ? (
        <PlainRow title={missingRowTitle(missing)} testID="label-backlog-missing" {...(busy === 'missing' ? { value: MISSING_BUSY } : {})} {...(busy === null ? { onPress: () => void queueMissing() } : {})} />
      ) : null}
      {needPrinter || note !== null ? (
        <View style={{ paddingHorizontal: PLAIN.side, paddingVertical: SPACE.xs, gap: SPACE.sm }}>
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
      ) : null}
    </View>
  )
}
