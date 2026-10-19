// 콘솔 밖 화면(문자찜 입력·구매자)의 방송자 조치 (AC-S06-14·15·22, D-083): 찜 취소·차단은 콘솔과 같이 사유 창 → 5초 뒤 보냄,
// 되돌리기 띠, 화면을 떠나면 보내지 않음(떠나기 전에 묻는다). 콘솔의 조치 함수(actions.ts)를 그대로 쓰도록 같은 모양(ConsoleApi)을 만든다.
import { useCallback, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { isApiError, newRequestId, post, withQuery, withRetry, type ApiError } from '../api/client.ts'
import type { WriteResult } from '../api/types.ts'
import type { ConsoleStore } from '../lib/console-store.ts'
import { BuyerNames } from '../lib/derive.ts'
import { useLeaveGuard } from '../lib/leave-guard.ts'
import type { ScopeData } from '../lib/scope-data.ts'
import type { UndoItem, UndoQueue } from '../lib/undo-queue.ts'
import { ConfirmDialog, ReasonDialog } from './ActionDialogs.tsx'
import type { ConsoleApi, Dialog, HostActionInput } from './console-context.ts'

export interface HostActionsInput {
  readonly store: ConsoleStore
  readonly data: ScopeData
  readonly queue: UndoQueue
  readonly date: string
  readonly rehearsal: boolean
  /** 그 화면이 고른 방송 (없으면 빈 글자 — 상품 이름에 방송 제목을 붙인다) */
  readonly b: string
  readonly ended: boolean
}

const NO_ITEMS: readonly UndoItem[] = []

function isTextField(element: Element | null): boolean {
  if (element instanceof HTMLTextAreaElement) return true
  return element instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'submit', 'reset'].includes(element.type)
}

export interface HostActions {
  readonly api: ConsoleApi
  readonly items: readonly UndoItem[]
  /** 맨 위 창 (사유·확인) */
  readonly dialog: ReactNode
}

export function useHostActions({ store, data, queue, date, rehearsal, b, ended }: HostActionsInput): HostActions {
  const items = useSyncExternalStore(queue.subscribe, queue.getSnapshot) ?? NO_ITEMS
  const [dialogs, setDialogs] = useState<Dialog[]>([])

  useLeaveGuard(queue)

  const openDialog = useCallback((dialog: Dialog) => setDialogs((stack) => [...stack, dialog]), [])
  const closeTop = useCallback(() => setDialogs((stack) => stack.slice(0, -1)), [])
  const closeAll = useCallback(() => setDialogs([]), [])

  const pathFor = useCallback(
    (event: Readonly<Record<string, unknown>>) => withQuery('/api/events', typeof event.b === 'string' ? {} : { date, rehearsal }),
    [date, rehearsal],
  )

  const followFailure = useCallback(
    (error: unknown) => {
      if (isApiError(error) && error.code === 'PROCESSING_FAILED') void store.catchUp()
    },
    [store],
  )

  const command = useCallback(
    async (event: Readonly<Record<string, unknown>>, requestId: string = newRequestId()): Promise<WriteResult> => {
      let result: WriteResult
      try {
        result = await withRetry(() => post<WriteResult>(pathFor(event), { requestId, ...event }))
      } catch (error) {
        followFailure(error)
        throw error
      }
      await store.sync(result.seq)
      return result
    },
    [followFailure, pathFor, store],
  )

  const queueHost = useCallback(
    (input: HostActionInput) => {
      const reopen = input.reopen
      queue.add({
        label: input.label,
        ...(input.message === undefined ? {} : { meta: input.message }),
        claims: input.claims ?? [],
        products: input.products ?? [],
        send: (requestId) => post<WriteResult>(pathFor(input.event), { requestId, ...input.event }),
        onResult: (result) => {
          void store.sync(result.seq)
          input.onResult?.(result)
        },
        ...(reopen === undefined
          ? {}
          : { reopen: { label: reopen.label, accepts: (error: ApiError) => error.status === 400 && error.problems.length > 0, open: reopen.open } }),
        onError: (error, failed) => {
          followFailure(error)
          if (failed.reopenLabel !== null && !isTextField(document.activeElement)) queue.reopen(failed.id)
        },
      })
    },
    [followFailure, pathFor, queue, store],
  )

  const waiting = useMemo(() => {
    const claims = new Set<string>()
    const products = new Set<string>()
    for (const item of items) {
      if (item.kind !== 'action' || item.status !== 'waiting') continue
      for (const id of item.claims) claims.add(id)
      for (const key of item.products) products.add(key)
    }
    return { claims, products }
  }, [items])

  const names = useMemo(() => new BuyerNames(data.buyers, data.claims), [data.buyers, data.claims])
  const settingsOf = useCallback((id: string) => data.broadcasts.get(id)?.settings ?? null, [data.broadcasts])

  const api: ConsoleApi = useMemo(
    () => ({
      b,
      date,
      rehearsal,
      ended,
      data,
      names,
      waiting,
      delayMs: queue.delayMs,
      settingsOf,
      openDialog,
      closeTop,
      closeAll,
      queueHost,
      command,
      fillQuick: () => {},
      select: () => {},
    }),
    [b, date, rehearsal, ended, data, names, waiting, queue.delayMs, settingsOf, openDialog, closeTop, closeAll, queueHost, command],
  )

  const top = dialogs.at(-1)
  let dialog: ReactNode = null
  if (top?.kind === 'reason') dialog = <ReasonDialog key={dialogs.length} spec={top.spec} onClose={closeTop} />
  else if (top?.kind === 'confirm') dialog = <ConfirmDialog key={dialogs.length} spec={top.spec} onClose={closeTop} />

  return { api, items, dialog }
}
