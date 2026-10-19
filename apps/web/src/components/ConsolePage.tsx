// 라이브 콘솔 (SPEC §7 화면 2, AC-S05-02·10~15·21·22·30~35·40~42·54·62·63).
// 빠른 입력·알림 띠는 위쪽에 늘 보인다. 현재 상품·상품 보드·채팅(·리허설 조작판)은 폭에 맞춰 나란히 또는 아래로.
import type { SaleSettings } from '@livejjim/core'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { get, isApiError, newRequestId, post, withQuery, withRetry, type ApiError } from '../api/client.ts'
import type { ChatMessage, Product, WriteResult } from '../api/types.ts'
import { ConsoleStore, type ConsoleSnapshot } from '../lib/console-store.ts'
import { BuyerNames, alertCounts, latestProduct, productKey } from '../lib/derive.ts'
import { dateWords } from '../lib/kst.ts'
import { decideFixForm, decideQuickInput, quickSettings, type QuickDecision } from '../lib/quick.ts'
import type { Route } from '../lib/router.ts'
import { HOST_ACTION_DELAY_MS, UndoQueue, type UndoItem } from '../lib/undo-queue.ts'
import { AssignDialog, ConfirmDialog, ConvertDialog, EditDialog, ReasonDialog } from './ActionDialogs.tsx'
import { AttentionDialog, CancelRequestDialog, ConflictDialog, PendingDialog, SuccessionDialog } from './AlertDialogs.tsx'
import { AlertStrip, firstAlert, type AlertKind } from './AlertStrip.tsx'
import { ChatPanel } from './ChatPanel.tsx'
import { ConsoleContext, useConsoleApi, type ConsoleApi, type Dialog, type HostActionInput } from './console-context.ts'
import { ErrorNote } from './ErrorNote.tsx'
import { ProductBoard, CurrentProduct } from './ProductBoard.tsx'
import { ProductDetail } from './ProductDetail.tsx'
import { QuickInput, type FixState, type Registration } from './QuickInput.tsx'
import { RehearsalPanel } from './RehearsalPanel.tsx'
import { TopBar } from './TopBar.tsx'
import { NOT_APPLIED_MESSAGE, UndoBar, secondsWord } from './UndoBar.tsx'

export interface ConsolePageProps {
  readonly broadcastId: string
  readonly shopName: string
  readonly onLogout: () => void
  readonly navigate: (route: Route) => void
}

const noop = () => () => {}
const LOADING: ConsoleSnapshot = {
  phase: 'loading',
  error: null,
  broadcast: null,
  data: null,
  messages: [],
  olderMessages: false,
  loadingOlder: false,
  connection: 'connecting',
  generator: null,
}
const NO_ITEMS: readonly UndoItem[] = []

/** 방송자 조치 대기 시간 (서버 /api/client-config, 운영 5000) */
function useHostDelay(): number | null {
  const [delay, setDelay] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    get<{ hostActionDelayMs: number }>('/api/client-config').then(
      (config) => {
        if (alive) setDelay(Number.isFinite(config.hostActionDelayMs) && config.hostActionDelayMs >= 0 ? config.hostActionDelayMs : HOST_ACTION_DELAY_MS)
      },
      () => {
        if (alive) setDelay(HOST_ACTION_DELAY_MS)
      },
    )
    return () => {
      alive = false
    }
  }, [])
  return delay
}

export function ConsolePage(props: ConsolePageProps) {
  const [store, setStore] = useState<ConsoleStore | null>(null)
  useEffect(() => {
    const next = new ConsoleStore({ broadcastId: props.broadcastId })
    setStore(next)
    void next.start()
    return () => next.stop()
  }, [props.broadcastId])
  const snapshot = useSyncExternalStore(store?.subscribe ?? noop, store?.getSnapshot ?? (() => LOADING))
  const delay = useHostDelay()

  const [queue, setQueue] = useState<UndoQueue | null>(null)
  useEffect(() => {
    if (delay === null) return
    const next = new UndoQueue({ delayMs: delay })
    setQueue(next)
    // 화면을 닫거나(새로고침·로그아웃·세션 만료로 콘솔이 내려감) 하면 기다리던 조치는 보내지 않는다 (D-083)
    return () => next.cancelAll()
  }, [delay])

  const top = <TopBar shopName={props.shopName} onLogout={props.onLogout} navigate={props.navigate} />
  if (snapshot.phase === 'missing') {
    return (
      <>
        {top}
        <main className="page">
          <h1>방송을 찾지 못했어요</h1>
          <p>방송 목록에서 다시 골라 주세요.</p>
        </main>
      </>
    )
  }
  if (snapshot.phase === 'error' && snapshot.error !== null) {
    return (
      <>
        {top}
        <main className="page">
          <h1>콘솔을 열지 못했어요</h1>
          <ErrorNote error={snapshot.error} onRetry={() => window.location.reload()} retryLabel="다시 열기" />
        </main>
      </>
    )
  }
  if (store === null || queue === null || snapshot.data === null || snapshot.broadcast === null) {
    return (
      <>
        {top}
        <main className="page">
          <p role="status">불러오는 중…</p>
        </main>
      </>
    )
  }
  return <Console {...props} store={store} snapshot={snapshot as ReadySnapshot} queue={queue} top={top} />
}

type ReadySnapshot = ConsoleSnapshot & { readonly data: NonNullable<ConsoleSnapshot['data']>; readonly broadcast: NonNullable<ConsoleSnapshot['broadcast']> }

interface ConsoleProps extends ConsolePageProps {
  readonly store: ConsoleStore
  readonly snapshot: ReadySnapshot
  readonly queue: UndoQueue
  readonly top: ReactNode
}

function isTextField(element: Element | null): element is HTMLInputElement | HTMLTextAreaElement {
  if (element instanceof HTMLTextAreaElement) return true
  return element instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'submit', 'reset'].includes(element.type)
}

function Console({ store, snapshot, queue, top, broadcastId }: ConsoleProps) {
  const { data, broadcast } = snapshot
  const b = broadcastId
  const view = data.broadcasts.get(b)
  const settings: SaleSettings | null = view?.settings ?? null
  const ended = view?.ended ?? broadcast.ended
  const title = view?.title ?? broadcast.title
  const items = useSyncExternalStore(queue.subscribe, queue.getSnapshot) ?? NO_ITEMS

  // 최신 자료를 비동기 흐름(등록 순서 대기 등)에서 읽는다
  const latest = useRef(snapshot)
  latest.current = snapshot

  const quickRef = useRef<HTMLInputElement>(null)
  const [quickText, setQuickText] = useState('')
  const quickTextRef = useRef(quickText)
  quickTextRef.current = quickText
  const [fix, setFix] = useState<FixState | null>(null)
  const [registrations, setRegistrations] = useState<Registration[]>([])
  const [quickError, setQuickError] = useState<ApiError | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [dialogs, setDialogs] = useState<Dialog[]>([])
  const [endError, setEndError] = useState<ApiError | null>(null)
  const chain = useRef<Promise<void>>(Promise.resolve())
  const regId = useRef(1)
  const regRequests = useRef(new Map<number, { requestId: string; line: string; no: number; name: string; price: number; fromFix: boolean }>())
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    quickRef.current?.focus()
  }, [])

  // 보류 찜 경과 시간을 위해 1초마다 (보류 창이 열려 있을 때만)
  const pendingOpen = dialogs.some((dialog) => dialog.kind === 'pending')
  useEffect(() => {
    if (!pendingOpen) return
    const handle = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(handle)
  }, [pendingOpen])

  const findProduct = useCallback((no: number): Product | undefined => latest.current.data.products.get(productKey(b, no)), [b])

  const focusQuick = useCallback(() => {
    // 창이 닫힌 다음 그리기에서 포커스를 옮긴다. 그사이 판매자가 다른 칸으로 옮겼으면(고치기 칸 등) 빼앗지 않는다
    setTimeout(() => {
      const current = document.activeElement
      if (current === null || current === document.body || !current.isConnected) quickRef.current?.focus()
    }, 0)
  }, [])

  const openDialog = useCallback((dialog: Dialog) => setDialogs((stack) => [...stack, dialog]), [])
  const closeTop = useCallback(() => {
    setDialogs((stack) => {
      const next = stack.slice(0, -1)
      if (next.length === 0) focusQuick()
      return next
    })
  }, [focusQuick])
  const closeAll = useCallback(() => {
    setDialogs([])
    focusQuick()
  }, [focusQuick])

  /** 쓰기 하나: 같은 요청 번호로 재시도 → 응답 seq까지 따라잡기 */
  const write = useCallback(
    async (requestId: string, event: Readonly<Record<string, unknown>>): Promise<WriteResult> => {
      const scoped = typeof event.b !== 'string'
      const path = withQuery('/api/events', scoped ? { date: broadcast.date, rehearsal: broadcast.rehearsal } : {})
      const result = await withRetry(() => post<WriteResult>(path, { requestId, ...event }))
      await store.sync(result.seq)
      return result
    },
    [broadcast.date, broadcast.rehearsal, store],
  )

  const command = useCallback((event: Readonly<Record<string, unknown>>, requestId?: string) => write(requestId ?? newRequestId(), event), [write])

  const queueHost = useCallback(
    (input: HostActionInput) => {
      queue.add({
        label: input.label,
        ...(input.message === undefined ? {} : { meta: input.message }),
        claims: input.claims ?? [],
        products: input.products ?? [],
        send: async (requestId) => {
          const scoped = typeof input.event.b !== 'string'
          const path = withQuery('/api/events', scoped ? { date: broadcast.date, rehearsal: broadcast.rehearsal } : {})
          return post<WriteResult>(path, { requestId, ...input.event })
        },
        onResult: (result) => {
          void store.sync(result.seq)
          input.onResult?.(result)
        },
        onError: (error) => {
          if (input.reopen !== undefined && error.status === 400 && error.problems.length > 0) input.reopen(error)
        },
      })
    },
    [queue, store, broadcast.date, broadcast.rehearsal],
  )

  const fillQuick = useCallback(
    (text: string) => {
      setQuickText(text)
      setDialogs([])
      setTimeout(() => {
        const input = quickRef.current
        if (input === null) return
        input.focus()
        input.setSelectionRange(text.length, text.length)
      }, 0)
    },
    [],
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

  const names = useMemo(() => new BuyerNames(data.buyers), [data.buyers])
  const settingsOf = useCallback((id: string) => latest.current.data.broadcasts.get(id)?.settings ?? null, [])

  const api: ConsoleApi = useMemo(
    () => ({
      b,
      date: broadcast.date,
      rehearsal: broadcast.rehearsal,
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
      fillQuick,
      select: setSelected,
    }),
    [b, broadcast.date, broadcast.rehearsal, ended, data, names, waiting, queue.delayMs, settingsOf, openDialog, closeTop, closeAll, queueHost, command, fillQuick],
  )

  // ── 빠른 입력 (AC-S05-10~13, D-084) ──────────────────────────────────

  const clearLine = useCallback((line: string | null) => {
    if (line !== null && quickTextRef.current === line) setQuickText('')
  }, [])

  const undoRegistration = useCallback(
    async (no: number): Promise<'undone' | 'blocked'> => {
      const product = findProduct(no)
      if (product !== undefined && (product.winners.length > 0 || product.waitlist.length > 0)) return 'blocked'
      const result = await write(newRequestId(), { type: 'product.close', b, no })
      return result.changed ? 'undone' : 'blocked'
    },
    [b, findProduct, write],
  )

  const runRegistration = useCallback(
    async (id: number, first: boolean) => {
      const request = regRequests.current.get(id)
      if (request === undefined) return
      const remove = () => {
        regRequests.current.delete(id)
        setRegistrations((list) => list.filter((item) => item.id !== id))
      }
      // 앞 줄이 같은 번호를 등록했으면(또는 다른 기기가) 등록 대신 묻는다
      if (first) {
        const existing = findProduct(request.no)
        if (existing !== undefined) {
          remove()
          openDialog({ kind: 'edit', product: existing.key, name: request.name, price: request.price, line: request.line })
          return
        }
      }
      setRegistrations((list) => list.map((item) => (item.id === id ? { ...item, status: 'sending', error: null } : item)))
      try {
        const result = await write(request.requestId, { type: 'product.register', b, no: request.no, name: request.name, price: request.price })
        remove()
        const key = productKey(b, request.no)
        if (!result.changed) {
          // 그사이 다른 곳에서 같은 번호가 생겼다: 등록되지 않았으니 묻는다
          const existing = findProduct(request.no)
          if (existing !== undefined) openDialog({ kind: 'edit', product: existing.key, name: request.name, price: request.price, line: request.line })
          return
        }
        clearLine(request.line)
        if (request.fromFix) setFix(null)
        setSelected(key)
        setQuickError(null)
        queue.addRegistration({ no: request.no, product: key, undo: () => undoRegistration(request.no) })
      } catch (error) {
        if (!isApiError(error)) throw error
        if (error.transient) {
          setRegistrations((list) => list.map((item) => (item.id === id ? { ...item, status: 'failed', error } : item)))
        } else {
          remove()
          setQuickError(error)
        }
      }
    },
    [b, clearLine, findProduct, openDialog, queue, undoRegistration, write],
  )

  const enqueueRegistration = useCallback(
    (line: string, no: number, name: string, price: number, fromFix: boolean) => {
      const id = regId.current++
      regRequests.current.set(id, { requestId: newRequestId(), line, no, name, price, fromFix })
      setRegistrations((list) => [...list, { id, line, no, status: 'sending', error: null }])
      chain.current = chain.current.then(() => runRegistration(id, true))
    },
    [runRegistration],
  )

  const retryRegistration = useCallback(
    (id: number) => {
      chain.current = chain.current.then(() => runRegistration(id, false))
    },
    [runRegistration],
  )

  const handleDecision = useCallback(
    (decision: QuickDecision, line: string, fromFix: boolean) => {
      switch (decision.kind) {
        case 'none':
          return
        case 'register':
          if (fromFix) setFix(null)
          enqueueRegistration(line, decision.no, decision.name, decision.price, fromFix)
          if (!fromFix) quickRef.current?.select()
          else focusQuick()
          return
        case 'edit':
          if (fromFix) setFix(null)
          openDialog({ kind: 'edit', product: decision.product.key, name: decision.name, price: decision.price, line })
          return
        case 'open':
          setFix(null)
          setSelected(decision.product.key)
          openDialog({ kind: 'product', key: decision.product.key })
          return
        case 'fix':
          setFix((current) => ({
            no: decision.no === null ? (fromFix && current !== null ? current.no : '') : String(decision.no),
            name: decision.name ?? (fromFix && current !== null ? current.name : ''),
            price: fromFix && current !== null ? current.price : '',
            focus: decision.focus,
            message: decision.message,
            line: fromFix && current !== null ? current.line : line,
            version: (current?.version ?? 0) + 1,
          }))
          return
      }
    },
    [enqueueRegistration, focusQuick, openDialog],
  )

  const onEnter = useCallback(
    (line: string) => {
      if (settings === null) return
      setQuickError(null)
      handleDecision(decideQuickInput(line, quickSettings(settings), findProduct), line, false)
    },
    [findProduct, handleDecision, settings],
  )

  const onFixSubmit = useCallback(() => {
    if (settings === null || fix === null) return
    handleDecision(decideFixForm(fix, quickSettings(settings), findProduct), fix.line, true)
  }, [findProduct, fix, handleDecision, settings])

  const closeFix = useCallback(() => {
    setFix(null)
    focusQuick()
  }, [focusQuick])

  // ── 단축키 (AC-S05-42, D-087) ────────────────────────────────────────

  const counts = useMemo(() => alertCounts(data), [data])
  const openAlert = useCallback((kind: AlertKind) => setDialogs([{ kind }]), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return
      const mod = event.ctrlKey || event.metaKey
      if (mod && !event.altKey && !event.shiftKey && (event.code === 'KeyZ' || event.key === 'z' || event.key === 'Z')) {
        const active = document.activeElement
        if (isTextField(active) && active.value !== '') return // 글자가 있는 칸: 브라우저의 글자 되돌리기
        event.preventDefault()
        queue.undoLatest()
        return
      }
      if (event.altKey && !mod && (event.code === 'Digit1' || event.key === '1')) {
        event.preventDefault()
        const kind = firstAlert(alertCounts(latest.current.data))
        if (kind !== null) openAlert(kind)
        return
      }
      if (event.key === 'Escape') {
        setFix(null)
        quickRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openAlert, queue])

  // ── 방송 끝내기 (AC-S05-02) ───────────────────────────────────────────

  const endBroadcast = useCallback(() => {
    const requestId = newRequestId()
    openDialog({
      kind: 'confirm',
      spec: {
        title: '방송 끝내기',
        message: '방송을 끝낼까요? 끝난 뒤에도 늦게 온 채팅·문자찜은 처리돼요.',
        confirmLabel: '끝내기',
        onConfirm: async () => {
          setEndError(null)
          const result = await withRetry(() => post<WriteResult>(`/api/broadcasts/${encodeURIComponent(b)}/end`, { requestId }))
          await store.sync(result.seq)
          closeAll()
        },
      },
    })
  }, [b, closeAll, openDialog, store])

  const current = (selected === null ? undefined : data.products.get(selected)) ?? latestProduct(data, b)

  const messagesById = useMemo(() => new Map(snapshot.messages.map((message) => [message.id, message])), [snapshot.messages])

  /** 메시지 → 찜 조치의 진행 (보낸 뒤 1등·대기 n번…은 메시지의 찜 상태로 보인다) */
  const convertNotes = useMemo(() => {
    const notes = new Map<string, string>()
    for (const item of items) {
      if (item.kind !== 'action' || item.meta === null) continue
      const note =
        item.status === 'waiting'
          ? `${secondsWord(queue.delayMs)} 뒤 보내요`
          : item.status === 'sending' || item.status === 'retrying'
            ? '보내는 중…'
            : item.status === 'notApplied'
              ? NOT_APPLIED_MESSAGE
              : item.status === 'cancelled'
                ? '보내지 않았어요'
                : item.status === 'failed'
                  ? (item.error?.message ?? '보내지 못했어요.')
                  : null
      if (note !== null) notes.set(item.meta, note)
    }
    return notes
  }, [items, queue.delayMs])

  const topDialog = dialogs.at(-1)

  return (
    <ConsoleContext.Provider value={api}>
      {top}
      <div className={broadcast.rehearsal ? 'console console-rehearsal' : 'console'}>
        {broadcast.rehearsal ? (
          <p className="rehearsal-banner" role="note">
            리허설 중 — 실제 판매가 아니에요
          </p>
        ) : null}
        {snapshot.connection === 'lost' ? (
          <p className="connection-banner" role="alert">
            실시간 연결이 끊겼어요. 다시 연결하는 중이에요.
          </p>
        ) : null}
        <div className="console-head">
          <h1 className="console-title">
            {title} <span className="console-date">{dateWords(broadcast.date)}</span>
            {broadcast.rehearsal ? <span className="tag tag-rehearsal">리허설</span> : null}
          </h1>
          {ended ? (
            <p className="ended-banner" role="status">
              끝난 방송이에요
            </p>
          ) : (
            <button type="button" className="button" onClick={endBroadcast}>
              방송 끝내기
            </button>
          )}
        </div>
        {endError !== null ? <ErrorNote error={endError} /> : null}
        <div className="console-sticky">
          <AlertStrip counts={counts} onOpen={openAlert} />
          <QuickInput
            value={quickText}
            onChange={setQuickText}
            inputRef={quickRef}
            onEnter={onEnter}
            fix={fix}
            onFixChange={(patch) => setFix((value) => (value === null ? value : { ...value, ...patch }))}
            onFixSubmit={onFixSubmit}
            onFixClose={closeFix}
            registrations={registrations}
            onRetry={retryRegistration}
            error={quickError}
          />
          <UndoBar items={items} queue={queue} />
        </div>
        <div className="console-grid">
          <CurrentProduct product={current} onOpen={(key) => openDialog({ kind: 'product', key })} />
          <ProductBoard
            onOpen={(key) => {
              setSelected(key)
              openDialog({ kind: 'product', key })
            }}
          />
          <ChatPanel
            messages={snapshot.messages}
            older={snapshot.olderMessages}
            loadingOlder={snapshot.loadingOlder}
            onLoadOlder={() => void store.loadOlder()}
            convertNotes={convertNotes}
          />
          {broadcast.rehearsal ? (
            <RehearsalPanel
              broadcastId={b}
              generator={snapshot.generator}
              onGenerator={(status) => store.setGenerator(status)}
              onWritten={(result) => void store.sync(result.seq)}
            />
          ) : null}
        </div>
        <p className="shortcuts">단축키: Enter 등록·찾기 · Esc 창 닫기 · Ctrl+Z(⌘Z) 되돌리기 · Alt+1(⌥1) 첫 알림 열기 · 1·2·3 창 안의 선택</p>
      </div>
      {topDialog !== undefined ? (
        <DialogView
          key={dialogs.length}
          dialog={topDialog}
          now={now}
          messageOf={(id) => messagesById.get(id)}
          onClose={closeTop}
          onEditDone={(product, line) => {
            clearLine(line)
            setSelected(product.key)
            closeAll()
          }}
          onEditUnchanged={(product) => {
            setSelected(product.key)
            setDialogs([{ kind: 'product', key: product.key }])
          }}
        />
      ) : null}
    </ConsoleContext.Provider>
  )
}

interface DialogViewProps {
  readonly dialog: Dialog
  readonly now: number
  readonly messageOf: (id: string) => ChatMessage | undefined
  readonly onClose: () => void
  readonly onEditDone: (product: Product, line: string | null) => void
  readonly onEditUnchanged: (product: Product) => void
}

function DialogView({ dialog, now, messageOf, onClose, onEditDone, onEditUnchanged }: DialogViewProps) {
  switch (dialog.kind) {
    case 'product':
      return <ProductDetailHost productKey={dialog.key} onClose={onClose} />
    case 'edit':
      return (
        <EditDialog
          productKey={dialog.product}
          name={dialog.name}
          price={dialog.price}
          line={dialog.line}
          onClose={onClose}
          onDone={(product) => onEditDone(product, dialog.line)}
          onUnchanged={onEditUnchanged}
        />
      )
    case 'conflict':
      return <ConflictDialog onClose={onClose} />
    case 'cancelRequests':
      return <CancelRequestDialog onClose={onClose} />
    case 'succession':
      return <SuccessionDialog onClose={onClose} />
    case 'pending':
      return <PendingDialog onClose={onClose} now={now} />
    case 'attention':
      return <AttentionDialog onClose={onClose} />
    case 'reason':
      return <ReasonDialog spec={dialog.spec} onClose={onClose} />
    case 'assign':
      return <AssignDialog spec={dialog.spec} onClose={onClose} />
    case 'convert':
      return <ConvertDialog message={messageOf(dialog.messageId)} onClose={onClose} />
    case 'confirm':
      return <ConfirmDialog spec={dialog.spec} onClose={onClose} />
  }
}

function ProductDetailHost({ productKey: key, onClose }: { readonly productKey: string; readonly onClose: () => void }) {
  const [editing, setEditing] = useState<Product | null>(null)
  const api = useConsoleApi()
  if (editing !== null) {
    return (
      <EditDialog
        productKey={editing.key}
        name={editing.name}
        price={editing.price}
        line={null}
        onClose={() => setEditing(null)}
        onDone={(product) => {
          api.select(product.key)
          setEditing(null)
        }}
        onUnchanged={() => setEditing(null)}
      />
    )
  }
  return <ProductDetail productKey={key} onClose={onClose} onEdit={setEditing} />
}
