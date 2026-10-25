// 포장 모드의 "포장 라벨 출력" (PL1B, SPEC STL-08·LBL-02, D-PL1-05, AC-PL1B-10~13).
// - 정산 자세히의 포장 라벨 출력(LabelParts PackingBody, AC-I1-35)과 같은 요청: `POST /api/print/packing { requestId, date, buyer }` 하나.
//   누를 때마다 새 요청 번호, 끊기면 같은 번호로 다시 보낸다(withRetry). 보내는 동안 버튼이 잠긴다.
// - 누를 때만 보낸다 — 체크를 다 하거나 "포장 완료"를 눌러도 저절로 출력하지 않는다.
// - 서버가 지금 묶음으로 라벨을 만든다(화면 그림을 보내지 않는다) — 미리 보기를 받는 중에도 누를 수 있다.
// - 성공: "포장 라벨 N장 출력을 접수했어요."(N = 응답 작업 수, 출력 기기가 없어도 접수되어 대기 — 같은 문장). 거절: 서버 문장 그대로.
//   라벨 기능이 꺼졌다는 거절(`LABELS_OFF`)은 출력 기록 저장소가 꺼진 것으로 덮어 칸 전체가 "라벨 쓰지 않음" 안내로 바뀐다.
// - 보통 버튼이다 — 포장 모드의 주 버튼은 체크리스트의 "포장 완료"다.
// - U-PL1B-01: 포장 라벨 칸은 화면 맨 아래라 결과 문장이 화면 밖·휴대폰 아래 메뉴 막대 뒤에 생기기 쉽다. 문장(성공·거절)이 새로 생기면
//   그 문장이 보이게 가장 적게 내린다(scrollIntoView nearest) — 아래쪽 여백(scroll-margin-bottom, 휴대폰은 메뉴 막대 높이만큼)으로 막대에 가리지 않는다.
// - RA-PL1B-02: 결과는 보낸 그 묶음(날짜·구매자)의 것이다. 응답이 오기 전에 다른 구매자·날짜로 넘어갔으면(또는 칸이 내려갔으면)
//   늦게 온 결과·잠금을 지금 칸에 보이지 않는다 — 판매자가 다른 상자에 붙일 라벨로 오해하지 않게. 포장 모드는 칸을 구매자마다 새로 그리기도 한다(key).
// - TE-PL1B-001: 두 번 보냄 막기는 바로 바뀌는 표시(ref)로 — 같은 순간의 두 클릭(화면이 아직 잠금을 그리기 전)도 요청 하나.
// - U-PL1B-02: 출력 기기가 없으면 접수 문장 뒤에 "출력 기기가 아직 없어 기다리는 중이에요. …" 한 줄과 라벨 화면 링크.
//   이미 기다리는 중이라는 거절(`PRINT_IN_PROGRESS`)은 빨간 오류가 아니라 안내 — 서버 문장 + 할 일 + 라벨 화면 링크.
// - MOB1 D-MOB1-08(AC-MOB1-14): 출력 기기가 있으나 끊겼으면 접수 문장 뒤 안내 상자에 "출력 기기('이름')가 연결되어 있지 않아요. …"와 라벨 화면 링크.
// - U-PL1B-03: 그 밖의 거절은 RequestError(영어 코드를 보이지 않는다, 잠시 뒤 다시 하면 되는 실패는 "다시 시도").

import { useEffect, useRef, useState } from 'react'
import { isApiError, newRequestId, withRetry, type ApiError } from '../api/client.ts'
import type { JobView } from '../api/print-types.ts'
import { PRINT_ACTION, deviceLostMessage } from '../lib/print-words.ts'
import { AppLink } from './AppLink.tsx'
import { RequestError } from './ErrorNote.tsx'
import { usePrintApi, usePrintState } from './print-context.tsx'

export const PACKING_PRINT_LABEL = '포장 라벨 출력'

/** 이미 기다리는 중이라는 서버 거절 코드 (I1) */
export const PRINT_IN_PROGRESS = 'PRINT_IN_PROGRESS'

/** 출력 기기가 없을 때 (U-PL1B-02 → QL2 D-QL2-09 ①: 프린터 연결이 먼저) */
export const NO_PRINT_DEVICE_WAITING = `출력 기기가 아직 없어 기다리는 중이에요. 라벨 화면에서 프린터를 연결한 뒤 '${PRINT_ACTION.thisDevice}'을 눌러 주세요.`
/** 이미 기다리는 중 + 출력 기기가 있을 때 할 일 */
export const IN_PROGRESS_WITH_DEVICE = '출력 기기에서 곧 출력돼요. 라벨 화면에서 출력 대기열을 볼 수 있어요.'
export const LABELS_SCREEN_LINK = '라벨 화면으로'

export function packingPrintDone(count: number): string {
  return `포장 라벨 ${String(count)}장 출력을 접수했어요.`
}

export interface PackingPrintState {
  readonly busy: boolean
  readonly done: string | null
  readonly error: ApiError | null
  /** 출력 기록 저장소가 아직 없으면 false — 버튼을 그리지 않는다 */
  readonly ready: boolean
  readonly send: () => Promise<void>
}

/** 이 묶음의 포장 라벨 출력 요청 — 구매자·날짜가 바뀌면 지난 결과 문장을 지우고, 지난 묶음의 늦은 결과는 버린다 */
export function usePackingPrint(date: string, buyer: string): PackingPrintState {
  const api = usePrintApi()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  /** 지금 보이는 묶음 (응답이 왔을 때 견준다) */
  const current = useRef({ date, buyer })
  current.current = { date, buyer }
  /** 보내는 중인 묶음 — 그린 뒤에야 바뀌는 busy와 달리 누르자마자 바뀐다 */
  const sending = useRef<{ readonly date: string; readonly buyer: string } | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    setDone(null)
    setError(null)
    // 다른 묶음으로 넘어가면 앞 묶음의 잠금을 두지 않는다 (그 요청의 결과는 아래에서 버린다)
    setBusy(sending.current !== null && sending.current.date === date && sending.current.buyer === buyer)
  }, [date, buyer])
  const send = async () => {
    if (api === null || sending.current !== null) return
    const target = { date, buyer }
    sending.current = target
    setBusy(true)
    setError(null)
    setDone(null)
    const requestId = newRequestId()
    const still = () => alive.current && current.current.date === target.date && current.current.buyer === target.buyer
    try {
      const result = await withRetry(() => api.store.act<{ jobs: JobView[] }>('/api/print/packing', { requestId, date: target.date, buyer: target.buyer }))
      if (still()) setDone(packingPrintDone(result.jobs.length))
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      if (still()) setError(caught)
    } finally {
      sending.current = null
      if (still()) setBusy(false)
    }
  }
  return { busy, done, error, ready: api !== null, send }
}

export function PackingPrintButton({ print }: { readonly print: PackingPrintState }) {
  if (!print.ready) return null
  return (
    <button type="button" className="button" disabled={print.busy} onClick={() => void print.send()}>
      {PACKING_PRINT_LABEL}
    </button>
  )
}

/** 출력 기기가 정해져 있지 않다 (대기열 요약을 알 때만 — 모르면 말하지 않는다) */
function useNoPrintDevice(): boolean {
  const overview = usePrintState().overview
  return overview !== null && overview.queue.device === null
}

/** 출력 기기가 있으나 실시간 연결이 끊겼으면 그 이름 (MOB1 D-MOB1-08 — 모르면 null) */
function useLostPrintDevice(): string | null {
  const device = usePrintState().overview?.queue.device ?? null
  return device !== null && !device.live ? device.name : null
}

function LabelsScreenLink() {
  return (
    <p className="packing-print-note">
      <AppLink to={{ name: 'labels' }}>{LABELS_SCREEN_LINK}</AppLink>
    </p>
  )
}

export function PackingPrintResult({ print }: { readonly print: PackingPrintState }) {
  const box = useRef<HTMLDivElement>(null)
  const noDevice = useNoPrintDevice()
  const lost = useLostPrintDevice()
  const shown = print.done !== null || print.error !== null
  useEffect(() => {
    if (!shown) return
    const element = box.current
    if (element !== null && typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'nearest' })
  }, [shown, print.done, print.error])
  const inProgress = print.error !== null && print.error.code === PRINT_IN_PROGRESS
  return (
    <div ref={box} className="packing-print-result stack-tight">
      {print.done !== null ? <p role="status">{print.done}</p> : null}
      {print.done !== null && noDevice ? (
        <div className="notice stack-tight" role="note" data-tone="info">
          <p className="packing-print-note">{NO_PRINT_DEVICE_WAITING}</p>
          <LabelsScreenLink />
        </div>
      ) : null}
      {print.done !== null && lost !== null ? (
        <div className="notice stack-tight" role="note" data-tone="info">
          <p className="packing-print-note">{deviceLostMessage(lost)}</p>
          <LabelsScreenLink />
        </div>
      ) : null}
      {print.error !== null && inProgress ? (
        <div className="notice stack-tight" role="note" data-tone="info">
          <p className="packing-print-note">{print.error.message}</p>
          <p className="packing-print-note">{noDevice ? NO_PRINT_DEVICE_WAITING : IN_PROGRESS_WITH_DEVICE}</p>
          <LabelsScreenLink />
        </div>
      ) : null}
      {print.error !== null && !inProgress ? <RequestError error={print.error} onRetry={() => void print.send()} /> : null}
    </div>
  )
}
