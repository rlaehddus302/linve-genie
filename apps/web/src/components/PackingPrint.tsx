// 포장 모드의 "포장 라벨 출력" (PL1B, SPEC STL-08·LBL-02, D-PL1-05, AC-PL1B-10~13).
// - 정산 자세히의 포장 라벨 출력(LabelParts PackingBody, AC-I1-35)과 같은 요청: `POST /api/print/packing { requestId, date, buyer }` 하나.
//   누를 때마다 새 요청 번호, 끊기면 같은 번호로 다시 보낸다(withRetry). 보내는 동안 버튼이 잠긴다.
// - 누를 때만 보낸다 — 체크를 다 하거나 "포장 완료"를 눌러도 저절로 출력하지 않는다.
// - 서버가 지금 묶음으로 라벨을 만든다(화면 그림을 보내지 않는다) — 미리 보기를 받는 중에도 누를 수 있다.
// - 성공: "포장 라벨 N장 출력을 접수했어요."(N = 응답 작업 수, 출력 기기가 없어도 접수되어 대기 — 같은 문장). 거절: 서버 문장 그대로.
//   라벨 기능이 꺼졌다는 거절(`LABELS_OFF`)은 출력 기록 저장소가 꺼진 것으로 덮어 칸 전체가 "라벨 쓰지 않음" 안내로 바뀐다.
// - 보통 버튼이다 — 포장 모드의 주 버튼은 체크리스트의 "포장 완료"다.
import { useEffect, useState } from 'react'
import { isApiError, newRequestId, withRetry, type ApiError } from '../api/client.ts'
import type { JobView } from '../api/print-types.ts'
import { ErrorNote } from './ErrorNote.tsx'
import { usePrintApi } from './print-context.tsx'

export const PACKING_PRINT_LABEL = '포장 라벨 출력'

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

/** 이 묶음의 포장 라벨 출력 요청 — 구매자·날짜가 바뀌면 지난 결과 문장을 지운다 */
export function usePackingPrint(date: string, buyer: string): PackingPrintState {
  const api = usePrintApi()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  useEffect(() => {
    setDone(null)
    setError(null)
  }, [date, buyer])
  const send = async () => {
    if (api === null || busy) return
    setBusy(true)
    setError(null)
    setDone(null)
    const requestId = newRequestId()
    try {
      const result = await withRetry(() => api.store.act<{ jobs: JobView[] }>('/api/print/packing', { requestId, date, buyer }))
      setDone(packingPrintDone(result.jobs.length))
    } catch (caught) {
      if (!isApiError(caught)) throw caught
      setError(caught)
    } finally {
      setBusy(false)
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

export function PackingPrintResult({ print }: { readonly print: PackingPrintState }) {
  return (
    <>
      {print.done !== null ? <p role="status">{print.done}</p> : null}
      {print.error !== null ? <ErrorNote error={print.error} /> : null}
    </>
  )
}
