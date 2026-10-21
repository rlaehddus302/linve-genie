// 라이브 콘솔 (SPEC §7 화면 2, AC-S05-02·10~15·21·22·30~35·40~42·54·62·63, AC-I1-30~34·36).
// 빠른 입력·알림 띠는 위쪽에 늘 보인다. 현재 상품·상품 보드·채팅(·리허설 조작판)은 폭에 맞춰 나란히 또는 아래로.
// I3: 유튜브 칸(스크롤 영역)·수집 멈춤 경고·사용량 알림(고정 영역)·알림 띠 "감사 실패"·감사 메시지 목록 (AC-I3-20~38),
//     봉인한 날짜는 볼 수만 있다 — 쓰기 칸·버튼이 잠기고 눌러도 요청을 보내지 않는다 (AC-I3-41).
// 라벨 상태는 서버의 출력 기록(라벨 키마다)으로 보인다 — 리허설은 라벨이 없다. Alt+P(⌥P)는 현재 상품의 1등 라벨 다시 출력 창.
// 라벨 기능이 꺼져 있거나 켬/끔을 아직 모르면(N4a, L-13 9, AC-N4a-14·18): 보드 라벨 상태·알림 "출력 멈춤"(Alt+1 순서에서도)·단축키 안내의 Alt+P가 빠지고,
// Alt+P는 창을 열지 않고 "라벨 쓰지 않음 — 설정에서 켤 수 있어요."를 알린다(빠른 입력칸 포커스 그대로). 버릴 라벨은 남는다.
import { DEFAULT_SETTINGS, type SaleSettings } from '@livejjim/core'
import type { CardRegistration, SuggestionCard } from '@livejjim/voice'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ApiError, isApiError, newRequestId, post, withQuery, withRetry } from '../api/client.ts'
import type { ChatMessage, Product, WriteResult } from '../api/types.ts'
import type { ConsoleSnapshot, ConsoleStore } from '../lib/console-store.ts'
import { BuyerNames, alertCounts, latestProduct, productKey } from '../lib/derive.ts'
import { useUndoQueue } from '../lib/host-delay.ts'
import { dateWords } from '../lib/kst.ts'
import { LABELS_OFF_NOTE } from '../lib/print-words.ts'
import { useLeaveGuard } from '../lib/leave-guard.ts'
import { ReadOnlyContext } from '../lib/read-only.ts'
import { changedFields, decideFixForm, decideQuickInput, editQuestion, quickSettings, type QuickDecision } from '../lib/quick.ts'
import { routePath, type Navigate } from '../lib/router.ts'
import { useScopeStore } from '../lib/use-store.ts'
import { useWide } from '../lib/use-wide.ts'
import type { UndoItem, UndoQueue } from '../lib/undo-queue.ts'
import { cardLine, enterBadgeCard } from '../lib/voice.ts'
import { VOICE_IDLE, VoiceController, type RegisterSource, type VoiceSnapshot } from '../voice/controller.ts'
import { fetchPastNames } from '../voice/history.ts'
import { loadVoice } from '../voice/load.ts'
import { readConsent, readSettings, writeConsent, writeSettings } from '../voice/storage.ts'
import { AssignDialog, ConfirmDialog, ConvertDialog, EditDialog, ReasonDialog } from './ActionDialogs.tsx'
import { AttentionDialog, CancelRequestDialog, ConflictDialog, PendingDialog, SuccessionDialog } from './AlertDialogs.tsx'
import { AlertStrip, firstAlert, type AlertKind, type PrintAlerts } from './AlertStrip.tsx'
import { ChatPanel } from './ChatPanel.tsx'
import { AuthorizeDialog, CollectorWarningBar, OutboxDialog, QuotaToast, UnlinkDialog, YoutubeContext, YoutubePanel, useConsoleYoutube } from './ConsoleYoutube.tsx'
import { Lock } from './Lock.tsx'
import { SealedNotice } from './SealNotice.tsx'
import { ConsoleContext, consoleLabels, productLabel, useConsoleApi, type ConsoleApi, type Dialog, type HostActionInput } from './console-context.ts'
import { ErrorNote } from './ErrorNote.tsx'
import { ImportDialog } from './ImportDialog.tsx'
import { ReprintDialog } from './LabelParts.tsx'
import { LiveNotices } from './LiveNotices.tsx'
import { ProductBoard, CurrentProduct } from './ProductBoard.tsx'
import { useLabelsEnabled, usePrintState, useScopeLabels } from './print-context.tsx'
import { DiscardDialog, PrintPauseDialog } from './PrintParts.tsx'
import { ProductDetail } from './ProductDetail.tsx'
import { QuickInput, type EditAsk, type FixState, type Registration } from './QuickInput.tsx'
import { RehearsalPanel } from './RehearsalPanel.tsx'
import { NOT_APPLIED_MESSAGE, UndoBar, secondsWord } from './UndoBar.tsx'
import { VoiceConsentDialog, VoiceExtras, VoiceLive, VoiceToggle, voiceLiveShown } from './VoicePanel.tsx'

export interface ConsolePageProps {
  readonly broadcastId: string
  /** 앞 버전 호환 (위 줄은 앱이 그린다) */
  readonly shopName?: string
  readonly onLogout?: () => void
  readonly navigate: Navigate
}

const NO_ITEMS: readonly UndoItem[] = []
/** Alt+P 안내가 보이는 동안 */
const LABELS_NOTE_MS = 6000
/** Alt+P를 눌렀지만 라벨 기능 켬/끔을 아직 모른다 */
const LABELS_LOADING = '라벨 상태를 불러오는 중이에요. 잠시 뒤 다시 눌러 주세요.'

/** 콘솔의 단축키 안내 — 라벨 기능이 꺼져 있으면(모르면) Alt+P가 빠진다 (AC-N4a-14) */
export function shortcutsWord(labels: boolean): string {
  return `단축키: Enter 등록·찾기 · Esc 창 닫기 · Ctrl+Z(⌘Z) 되돌리기 · Alt+1(⌥1) 첫 알림 열기 · ${labels ? 'Alt+P(⌥P) 라벨 다시 출력 · ' : ''}1·2·3 창 안의 선택`
}
const noSubscribe = () => () => {}
const idleVoice = (): VoiceSnapshot => VOICE_IDLE

/** 등록 경로에 넘긴 한 줄 (빠른 입력·고치기 칸·음성 카드) */
interface RegRequest {
  readonly requestId: string
  readonly line: string
  readonly no: number
  readonly name: string
  readonly price: number
  readonly fromFix: boolean
  /** 차례에서 그 번호가 이미 있을 때 "고칠까요?" 대신 (음성 자동 확정 — 창을 띄우지 않는다, D-I4-05) */
  readonly onExists?: (product: Product) => void
  /** 다시 보내기로 고칠 수 없는 실패·기록되지 않음 (음성 카드는 카드를 되살린다) */
  readonly onFailed?: () => void
}

/** 등록 경로의 선택 (음성 카드) */
interface RegHooks {
  readonly onExists?: (product: Product) => void
  readonly onFailed?: () => void
}

/** 창이 열려 있다 (콘솔 창·음성 안내 창·떠날지 묻는 창) */
function anyDialogOpen(): boolean {
  return document.querySelector('[role="dialog"]') !== null
}

export function ConsolePage(props: ConsolePageProps) {
  const { store, snapshot } = useScopeStore(props.broadcastId, () => ({ broadcastId: props.broadcastId }))
  const queue = useUndoQueue()

  if (snapshot.phase === 'missing') {
    return (
      <main className="page">
        <h1>방송을 찾지 못했어요</h1>
        <p>방송 목록에서 다시 골라 주세요.</p>
      </main>
    )
  }
  if (snapshot.phase === 'error' && snapshot.error !== null) {
    return (
      <main className="page">
        <h1>콘솔을 열지 못했어요</h1>
        <ErrorNote error={snapshot.error} onRetry={() => window.location.reload()} retryLabel="다시 열기" />
      </main>
    )
  }
  if (store === null || queue === null || snapshot.data === null || snapshot.broadcast === null) {
    return (
      <main className="page">
        <div className="page-sticky">
          <LiveNotices snapshot={snapshot} onRetry={() => void store?.retryNow()} />
        </div>
        <p role="status">불러오는 중…</p>
      </main>
    )
  }
  return <Console {...props} store={store} snapshot={snapshot as ReadySnapshot} queue={queue} />
}

type ReadySnapshot = ConsoleSnapshot & { readonly data: NonNullable<ConsoleSnapshot['data']>; readonly broadcast: NonNullable<ConsoleSnapshot['broadcast']> }

interface ConsoleProps extends ConsolePageProps {
  readonly store: ConsoleStore
  readonly snapshot: ReadySnapshot
  readonly queue: UndoQueue
}

function isTextField(element: Element | null): element is HTMLInputElement | HTMLTextAreaElement {
  if (element instanceof HTMLTextAreaElement) return true
  return element instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'submit', 'reset'].includes(element.type)
}

function Console({ store, snapshot, queue, broadcastId, navigate }: ConsoleProps) {
  const { data, broadcast } = snapshot
  const b = broadcastId
  const view = data.broadcasts.get(b)
  const settings: SaleSettings | null = view?.settings ?? null
  const ended = view?.ended ?? broadcast.ended
  const title = view?.title ?? broadcast.title
  const sealed = snapshot.sealed
  const items = useSyncExternalStore(queue.subscribe, queue.getSnapshot) ?? NO_ITEMS
  const yt = useConsoleYoutube({ store, broadcastId, date: broadcast.date, rehearsal: broadcast.rehearsal, lastMessageSeq: snapshot.messages.at(-1)?.seq ?? 0 })
  const thanksFailed = useRef(yt.thanksFailed)
  thanksFailed.current = yt.thanksFailed

  // 최신 자료를 비동기 흐름(등록 순서 대기 등)에서 읽는다
  const latest = useRef(snapshot)
  latest.current = snapshot

  const quickRef = useRef<HTMLInputElement>(null)
  const [quickText, setQuickText] = useState('')
  const quickTextRef = useRef(quickText)
  quickTextRef.current = quickText
  const [fix, setFix] = useState<FixState | null>(null)
  const [registrations, setRegistrations] = useState<Registration[]>([])
  const [asks, setAsks] = useState<EditAsk[]>([])
  const askId = useRef(1)
  const [quickError, setQuickError] = useState<ApiError | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [dialogs, setDialogs] = useState<Dialog[]>([])
  const dialogCount = useRef(0)
  dialogCount.current = dialogs.length
  const [endError, setEndError] = useState<ApiError | null>(null)
  const chain = useRef<Promise<void>>(Promise.resolve())
  /** 앞 등록 응답을 기다리며 판단을 미룬 줄 수 */
  const waitingLines = useRef(0)
  const regId = useRef(1)
  const regRequests = useRef(new Map<number, RegRequest>())
  const [alertsOpen, setAlertsOpen] = useState(false)
  const wide = useWide()
  const wideRef = useRef(wide)
  wideRef.current = wide

  // ── 음성 (VOC-01·04·05, D-I4-03~06·09) ────────────────────────────────
  // 콘솔마다 하나. "음성 켜기"를 누르기 전에는 음성 코드·인식 객체·마이크·이력 조회가 없다. 콘솔을 떠나면 인식을 멈춘다.
  const currentNames = useMemo(() => [...data.products.values()].map((product) => product.name), [data.products])
  const currentNamesRef = useRef(currentNames)
  currentNamesRef.current = currentNames
  const voiceActions = useRef<{ register: (card: SuggestionCard, registration: CardRegistration, source: RegisterSource) => void; focusQuick: () => void }>({
    register: () => {},
    focusQuick: () => {},
  })
  const [voice, setVoice] = useState<VoiceController | null>(null)
  useEffect(() => {
    const controller = new VoiceController({
      load: loadVoice,
      now: () => Date.now(),
      maxNumber: () => latest.current.data.broadcasts.get(b)?.settings['claim.maxNumber'] ?? DEFAULT_SETTINGS['claim.maxNumber'],
      currentNames: () => currentNamesRef.current,
      products: () => {
        const numbers = new Map<number, boolean>()
        for (const product of (store.getSnapshot().data ?? latest.current.data).products.values()) {
          if (product.broadcast === b) numbers.set(product.no, product.status === 'CLOSED')
        }
        return numbers
      },
      fetchHistory: () => fetchPastNames({ date: broadcast.date, rehearsal: broadcast.rehearsal }),
      dialogOpen: () => dialogCount.current > 0 || anyDialogOpen(),
      readConsent,
      writeConsent,
      readSettings,
      writeSettings: (settings) => writeSettings(settings),
      register: (card, registration, source) => voiceActions.current.register(card, registration, source),
      focusQuick: () => voiceActions.current.focusQuick(),
    })
    setVoice(controller)
    return () => controller.dispose()
  }, [b, store, broadcast.date, broadcast.rehearsal])
  const voiceSnapshot = useSyncExternalStore(voice?.subscribe ?? noSubscribe, voice?.getSnapshot ?? idleVoice)
  // 봉인한 날짜(AC-I3-41)는 등록할 수 없다 — 음성 켜기를 숨기고, 켜 둔 채 봉인되면 끈다(카드는 남고 자동 확정은 멈춘다)
  useEffect(() => {
    if (sealed) voice?.turnOff()
  }, [sealed, voice])

  // 5초 대기 중인 방송자 조치가 있으면 다른 화면으로 가기 전에 묻는다 (AC-S06-01, D-083)
  useLeaveGuard(queue)

  useEffect(() => {
    quickRef.current?.focus()
  }, [])

  // 저장소의 지금 자료로 찾는다 — 앞 등록 응답 뒤에 판단하는 줄이 화면이 다시 그려지기 전에도 그 등록을 본다
  const findProduct = useCallback(
    (no: number): Product | undefined => (store.getSnapshot().data ?? latest.current.data).products.get(productKey(b, no)),
    [b, store],
  )

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

  /** 서버가 처리하지 못한 입력(500 PROCESSING_FAILED)은 "확인 필요"에 남았다 — 알림을 기다리지 않고 바로 따라잡아 알림 띠에 보인다 (AC-S05-71) */
  const followFailure = useCallback(
    (error: unknown) => {
      if (isApiError(error) && error.code === 'PROCESSING_FAILED') void store.catchUp()
    },
    [store],
  )

  /** 쓰기 하나: 같은 요청 번호로 재시도 → 응답 seq까지 따라잡기 */
  const write = useCallback(
    async (requestId: string, event: Readonly<Record<string, unknown>>): Promise<WriteResult> => {
      // 봉인한 날짜는 쓰지 않는다 (버튼도 잠겨 있다 — 요청을 보내지 않는다)
      if (latest.current.sealed) throw new ApiError({ status: 409, code: 'SEALED', message: '30일이 지난 방송 기록은 봉인되어 고칠 수 없어요.' })
      const scoped = typeof event.b !== 'string'
      const path = withQuery('/api/events', scoped ? { date: broadcast.date, rehearsal: broadcast.rehearsal } : {})
      let result: WriteResult
      try {
        result = await withRetry(() => post<WriteResult>(path, { requestId, ...event }))
      } catch (error) {
        followFailure(error)
        throw error
      }
      await store.sync(result.seq)
      return result
    },
    [broadcast.date, broadcast.rehearsal, followFailure, store],
  )

  const command = useCallback((event: Readonly<Record<string, unknown>>, requestId?: string) => write(requestId ?? newRequestId(), event), [write])

  /** 판매자가 글 칸에 무언가 치는 중인가 (빠른 입력칸은 글자가 있을 때만 — 비어 있으면 기다리는 중이다) */
  const typing = useCallback((): boolean => {
    const active = document.activeElement
    if (!isTextField(active)) return false
    return active !== quickRef.current || active.value !== ''
  }, [])

  const queueHost = useCallback(
    (input: HostActionInput) => {
      if (latest.current.sealed) return
      const reopen = input.reopen
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
        ...(reopen === undefined
          ? {}
          : { reopen: { label: reopen.label, accepts: (error: ApiError) => error.status === 400 && error.problems.length > 0, open: reopen.open } }),
        onError: (error, failed) => {
          followFailure(error)
          // 서버가 입력을 거절했다(사유의 휴대폰 번호 등): 창을 다시 열어 고치게 한다(AC-S05-34). 조치는 5초 뒤에 보내므로 거절도 늦게 온다 —
          // 그사이 판매자가 다음 상품을 치고 있으면 창을 띄워 글자를 빼앗지 않고 되돌리기 띠의 "사유 고치기"로 둔다(UX-S05-002)
          if (failed.reopenLabel !== null && !typing()) queue.reopen(failed.id)
        },
      })
    },
    [queue, store, broadcast.date, broadcast.rehearsal, followFailure, typing],
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

  const names = useMemo(() => new BuyerNames(data.buyers, data.claims), [data.buyers, data.claims])
  const settingsOf = useCallback((id: string) => latest.current.data.broadcasts.get(id)?.settings ?? null, [])
  // 라벨 상태는 서버의 출력 기록 (리허설 범위는 라벨이 없다 — 조회하지 않는다, D-I1-08). 라벨 기능이 꺼져 있거나 모르면 보지 않는다(L-13 9)
  const labelsOn = useLabelsEnabled()
  const labelsOnRef = useRef(labelsOn)
  labelsOnRef.current = labelsOn
  const labelState = useScopeLabels(broadcast.rehearsal || labelsOn !== true ? null : broadcast.date)
  const labels = labelState.labels
  const print = usePrintState()
  const queueSummary = print.overview?.queue ?? null
  // 꺼져 있으면 "출력 멈춤"은 알림 띠·Alt+1 순서에서 빠진다 — 버릴 라벨은 남는다 (AC-N4a-14·16)
  const printAlerts: PrintAlerts = useMemo(
    () => ({ pause: labelsOn === true ? (queueSummary?.pause?.message ?? null) : null, discard: queueSummary?.discard ?? 0 }),
    [queueSummary, labelsOn],
  )
  const printAlertsRef = useRef(printAlerts)
  printAlertsRef.current = printAlerts
  /** Alt+P를 눌렀지만 라벨 기능이 꺼져 있다는 알림 (잠시 보인다) */
  const [labelsNote, setLabelsNote] = useState<{ readonly text: string; readonly n: number } | null>(null)
  useEffect(() => {
    if (labelsNote === null) return
    const timer = setTimeout(() => setLabelsNote(null), LABELS_NOTE_MS)
    return () => clearTimeout(timer)
  }, [labelsNote])
  useEffect(() => {
    if (labelsOn === true) setLabelsNote(null)
  }, [labelsOn])

  const api: ConsoleApi = useMemo(
    () => ({
      b,
      date: broadcast.date,
      rehearsal: broadcast.rehearsal,
      ended,
      sealed,
      data,
      names,
      labels,
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
    [b, broadcast.date, broadcast.rehearsal, ended, sealed, data, names, labels, waiting, queue.delayMs, settingsOf, openDialog, closeTop, closeAll, queueHost, command, fillQuick],
  )

  // ── 빠른 입력 (AC-S05-10~13, D-084) ──────────────────────────────────

  const clearLine = useCallback((line: string | null) => {
    if (line !== null && quickTextRef.current === line) setQuickText('')
  }, [])

  /** 판매자가 그 줄 뒤에 다른 줄을 치기 시작했나 (앞 등록 응답을 기다린 줄의 판단이 늦게 날 때) */
  const typedNext = useCallback((line: string): boolean => {
    const input = quickRef.current
    return input !== null && input.value !== '' && input.value !== line && document.activeElement === input
  }, [])

  /**
   * 같은 번호 줄의 "고칠까요?" (AC-S05-13). 판단이 늦게 났고(앞 등록 응답을 기다린 줄이거나, 보낸 뒤에야 같은 번호가 있는 걸 앎) 판매자가
   * 벌써 다음 줄을 치고 있으면 창을 띄워 글자·Enter를 빼앗지 않고 칸 아래 "고칠까요?"에 남긴다 — 누르면 그 창을 연다(TE-S05-002, AC-S05-10·42).
   * Enter 바로 뒤의 판단은 칸 글자가 그 줄 그대로라 늘 창을 연다
   */
  const askEdit = useCallback(
    (product: Product, name: string, price: number, line: string) => {
      if (typedNext(line)) {
        setAsks((list) => [...list, { id: askId.current++, line, no: product.no, product: product.key, name, price }])
        return
      }
      openDialog({ kind: 'edit', product: product.key, name, price, line })
    },
    [openDialog, typedNext],
  )

  const removeAsk = useCallback((id: number | undefined) => {
    if (id !== undefined) setAsks((list) => list.filter((ask) => ask.id !== id))
  }, [])

  const openAsk = useCallback(
    (id: number) => {
      const ask = asks.find((item) => item.id === id)
      if (ask === undefined) return
      // 그 번호의 지금 상품과 비교한다 (번호 변경 뒤에도 — AC-S06-67)
      const current = findProduct(ask.no)
      if (current === undefined) return
      const base = { kind: 'edit', product: current.key, name: ask.name, price: ask.price, line: ask.line } as const
      // 칸이 비었으면 친 줄을 칸으로 옮긴다 — 바로 물었을 때와 같이 아니요면 칸에 그대로 남는다(AC-S05-13).
      // 다른 줄을 치는 중이면 그 글자를 두고, 아니요면 "고칠까요?"를 남겨 친 줄을 잃지 않는다
      if (quickTextRef.current === '') {
        setQuickText(ask.line)
        removeAsk(id)
        openDialog(base)
        return
      }
      openDialog({ ...base, ask: id })
    },
    [asks, findProduct, openDialog, removeAsk],
  )

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
      const exists = (product: Product) => {
        if (request.onExists !== undefined) request.onExists(product)
        else askEdit(product, request.name, request.price, request.line)
      }
      if (first) {
        const existing = findProduct(request.no)
        if (existing !== undefined) {
          remove()
          exists(existing)
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
          if (existing !== undefined) exists(existing)
          else request.onFailed?.()
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
          request.onFailed?.()
        }
      }
    },
    [askEdit, b, clearLine, findProduct, queue, undoRegistration, write],
  )

  const startRegistration = useCallback((line: string, no: number, name: string, price: number, fromFix: boolean, hooks: RegHooks = {}): number => {
    const id = regId.current++
    regRequests.current.set(id, { requestId: newRequestId(), line, no, name, price, fromFix, ...hooks })
    setRegistrations((list) => [...list, { id, line, no, status: 'sending', error: null }])
    return id
  }, [])

  const enqueueRegistration = useCallback(
    (line: string, no: number, name: string, price: number, fromFix: boolean, hooks: RegHooks = {}) => {
      const id = startRegistration(line, no, name, price, fromFix, hooks)
      chain.current = chain.current.then(() => runRegistration(id, true))
    },
    [runRegistration, startRegistration],
  )

  // ── 음성 카드 등록 (PRD-06, D-I4-03·05): 빠른 입력과 같은 등록 경로 ───

  /** 카드 → 등록 경로 (Enter·"등록"·자동 확정). 자동 확정은 차례에서 번호가 생겼으면 창 없이 카드로 돌려놓는다 */
  const registerVoiceCard = useCallback(
    (card: SuggestionCard, registration: CardRegistration, source: RegisterSource) => {
      const { no, name, price } = registration
      enqueueRegistration(cardLine(no, name, price), no, name, price, false, {
        ...(source === 'auto' ? { onExists: (product: Product) => voice?.restore(card, { note: editQuestion(product.no, product.status === 'CLOSED') }) } : {}),
        onFailed: () => voice?.restore(card, { touched: true }),
      })
      if (source === 'click') focusQuick()
    },
    [enqueueRegistration, focusQuick, voice],
  )
  voiceActions.current = { register: registerVoiceCard, focusQuick }

  /** 카드 고치기 칸의 Enter: 빠른 입력 고치기 칸과 같은 해석 (decideFixForm — 그 방송의 price.unit) */
  const submitCardForm = useCallback(
    (id: string) => {
      if (voice === null || settings === null) return
      const form = voice.getSnapshot().forms.get(id)
      if (form === undefined) return
      const decision = decideFixForm(form, quickSettings(settings), findProduct)
      switch (decision.kind) {
        case 'fix':
          voice.formProblem(id, decision.message, decision.focus)
          return
        case 'register': {
          const card = voice.take(id)
          if (card === undefined) return
          const { no, name, price } = decision
          enqueueRegistration(cardLine(no, name, price), no, name, price, false, {
            onFailed: () => voice.restore({ ...card, no, name: name === '' ? null : name, price }, { touched: true }),
          })
          focusQuick()
          return
        }
        case 'edit': {
          if (voice.take(id) === undefined) return
          askEdit(decision.product, decision.name, decision.price, cardLine(decision.no, decision.name, decision.price))
          return
        }
        default:
          return
      }
    },
    [askEdit, enqueueRegistration, findProduct, focusQuick, settings, voice],
  )

  /** 카드의 "등록": 고치기 칸이 열려 있으면 그 칸의 값으로 */
  const registerCardClick = useCallback(
    (id: string) => {
      if (voice === null) return
      if (voice.getSnapshot().forms.has(id)) submitCardForm(id)
      else voice.confirm(id, 'click')
    },
    [submitCardForm, voice],
  )

  // 창이 닫히면 미룬 자동 확정을 다시 본다 (D-I4-05)
  useEffect(() => {
    voice?.refresh()
  }, [voice, dialogs.length])

  const retryRegistration = useCallback(
    (id: number) => {
      chain.current = chain.current.then(() => runRegistration(id, false))
    },
    [runRegistration],
  )

  /** 남겨 둔 "고칠까요?"의 번호에 상품이 없어졌으면 "이 줄로 새로 등록할까요?" → 등록하기 (AC-S06-67) */
  const registerAsk = useCallback(
    (id: number) => {
      const ask = asks.find((item) => item.id === id)
      if (ask === undefined) return
      removeAsk(id)
      enqueueRegistration(ask.line, ask.no, ask.name, ask.price, false)
    },
    [asks, enqueueRegistration, removeAsk],
  )

  // 상태가 바뀌면 남겨 둔 "고칠까요?"를 그 번호의 지금 상품과 다시 본다: 친 값과 다른 값이 없으면 지운다 (AC-S06-67, D-095)
  useEffect(() => {
    setAsks((list) => {
      const next = list.filter((ask) => {
        const current = data.products.get(productKey(b, ask.no))
        return current === undefined || current.status === 'CLOSED' || Object.keys(changedFields(current, ask.name, ask.price)).length > 0
      })
      return next.length === list.length ? list : next
    })
  }, [data.products, b, asks.length])

  /**
   * 한 줄의 판단을 실행한다. inChain = 앞 등록 응답을 기다렸다가 차례 안에서 판단한 줄 — 등록은 그 자리에서 보내고 끝날 때까지
   * 차례를 잡는다(뒤 줄의 판단이 이 등록을 본다: "15 …" 다음의 "15"는 찾기).
   */
  const handleDecision = useCallback(
    (decision: QuickDecision, line: string, fromFix: boolean, inChain = false): Promise<void> | undefined => {
      switch (decision.kind) {
        case 'none':
          return undefined
        case 'register': {
          if (fromFix) setFix(null)
          focusQuick()
          if (!inChain) {
            enqueueRegistration(line, decision.no, decision.name, decision.price, fromFix)
            return undefined
          }
          const id = startRegistration(line, decision.no, decision.name, decision.price, fromFix)
          return runRegistration(id, true)
        }
        case 'edit':
          if (fromFix) setFix(null)
          askEdit(decision.product, decision.name, decision.price, line)
          return undefined
        case 'open': {
          setFix(null)
          setSelected(decision.product.key)
          // 늦게 판단한 찾기인데 판매자가 벌써 다음 줄을 치고 있으면 창을 띄워 글자를 빼앗지 않는다(현재 상품으로 보인다)
          if (inChain && typedNext(line)) return undefined
          // 찾은 번호는 칸에서 지운다 — 창을 닫고 다음 줄을 치면 그 번호 뒤에 붙어 엉뚱한 번호로 등록되지 않게 (UX-S05-001)
          clearLine(line)
          openDialog({ kind: 'product', key: decision.product.key })
          return undefined
        }
        case 'fix': {
          // 늦게 판단한 오류인데 판매자가 벌써 다음 줄을 치고 있으면 고치기 칸만 열고 커서는 옮기지 않는다(치던 글자가 가격 칸으로 가지 않게)
          const grab = !(inChain && typedNext(line))
          setFix((current) => ({
            no: decision.no === null ? (decision.noText ?? (fromFix && current !== null ? current.no : '')) : String(decision.no),
            name: decision.name ?? (fromFix && current !== null ? current.name : ''),
            price: decision.priceText ?? (fromFix && current !== null ? current.price : ''),
            focus: decision.focus,
            message: decision.message,
            line: fromFix && current !== null ? current.line : line,
            version: (current?.version ?? 0) + 1,
            grab,
          }))
          return undefined
        }
      }
    },
    [askEdit, clearLine, enqueueRegistration, focusQuick, openDialog, runRegistration, startRegistration, typedNext],
  )

  const onEnter = useCallback(
    (line: string) => {
      if (settings === null) return
      // 빈 칸의 Enter = 맨 앞 음성 카드 (PC, 맨 앞이 된 지 1초 뒤, 창·카드 고치기 칸이 닫혀 있을 때 — D-I4-03). 글자가 있으면 늘 빠른 입력이다
      if (voice !== null && voice.enter(line, { wide: wideRef.current, dialogOpen: dialogCount.current > 0 || anyDialogOpen() })) {
        setQuickError(null)
        return
      }
      setQuickError(null)
      // 칸의 글자를 골라 둔다: 다음 줄을 바로 치면 그 글자가 바뀌고 뒤에 이어 붙지 않는다(응답이 늦어도, TE-S05-001). 판단은 친 줄로 한다
      const input = quickRef.current
      if (input !== null && input.value === line) input.select()
      const snapshotSettings = quickSettings(settings)
      if (regRequests.current.size === 0 && waitingLines.current === 0) {
        void handleDecision(decideQuickInput(line, snapshotSettings, findProduct), line, false)
        return
      }
      // 앞 줄의 등록이 아직 끝나지 않았다: 그 뒤에 차례대로 판단한다 — "15 …" 바로 뒤의 "15"(찾기)·"15 …"(고치기)가 앞 등록을 본다
      waitingLines.current++
      chain.current = chain.current.then(() => {
        waitingLines.current--
        return handleDecision(decideQuickInput(line, snapshotSettings, findProduct), line, false, true)
      })
    },
    [findProduct, handleDecision, settings, voice],
  )

  const onFixSubmit = useCallback(() => {
    if (settings === null || fix === null) return
    void handleDecision(decideFixForm(fix, quickSettings(settings), findProduct), fix.line, true)
  }, [findProduct, fix, handleDecision, settings])

  const closeFix = useCallback(() => {
    setFix(null)
    focusQuick()
  }, [focusQuick])

  // ── 단축키 (AC-S05-42, D-087) ────────────────────────────────────────

  const counts = useMemo(() => alertCounts(data), [data])
  const openAlert = useCallback((kind: AlertKind) => setDialogs([kind === 'thanks' ? { kind: 'outbox' } : { kind }]), [])

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
        const kind = firstAlert(alertCounts(latest.current.data), printAlertsRef.current, thanksFailed.current)
        if (kind !== null) openAlert(kind)
        return
      }
      // Alt+P(⌥P): 현재 상품의 1등 라벨 다시 출력 — 빠른 입력칸에 글자(π 등)가 들어가지 않는다 (AC-I1-33)
      if (event.altKey && !mod && !event.shiftKey && (event.code === 'KeyP' || event.key === 'p' || event.key === 'P' || event.key === 'π')) {
        event.preventDefault()
        // 라벨 기능이 꺼져 있으면 창을 열지 않고 출력 요청도 보내지 않는다 — 안내만 (AC-N4a-14). 모르는 동안도 창을 열지 않는다
        if (labelsOnRef.current !== true) {
          setLabelsNote((note) => ({ text: labelsOnRef.current === false ? LABELS_OFF_NOTE : LABELS_LOADING, n: (note?.n ?? 0) + 1 }))
          return
        }
        setDialogs([{ kind: 'reprint', product: currentKey.current }])
        return
      }
      if (event.key === 'Escape') {
        // 창 안에 포커스가 없을 때도 Esc는 위의 창을 닫는다
        if (dialogCount.current > 0) {
          closeTop()
          return
        }
        // 음성 안내 창 (포커스가 창 밖에 있어도 Esc로 닫는다 — 꺼진 그대로)
        if (voice !== null && voice.getSnapshot().phase === 'consent') {
          voice.declineConsent()
          return
        }
        setFix(null)
        quickRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeTop, openAlert, queue, voice])

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
  const currentKey = useRef<string | null>(null)
  currentKey.current = current?.key ?? null

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

  // 음성 칸: "Enter 등록"은 지금 빈 빠른 입력칸의 Enter가 등록할 카드에만 (D-I4-03)
  const enterBadge =
    voice === null
      ? null
      : enterBadgeCard({
          line: quickText,
          cards: voiceSnapshot.cards,
          front: voiceSnapshot.front,
          now: voiceSnapshot.now,
          wide,
          dialogOpen: dialogs.length > 0 || voiceSnapshot.phase === 'consent',
          editing: new Set(voiceSnapshot.forms.keys()),
        })
  const voiceLive =
    voice !== null && voiceLiveShown(voiceSnapshot) ? (
      <VoiceLive voice={voice} snapshot={voiceSnapshot} badge={enterBadge} onSubmitForm={submitCardForm} onRegister={registerCardClick} />
    ) : null

  return (
    <ConsoleContext.Provider value={api}>
      <YoutubeContext.Provider value={yt}>
      <ReadOnlyContext.Provider value={sealed}>
      <main className={broadcast.rehearsal ? 'console console-rehearsal' : 'console'}>
        {broadcast.rehearsal ? (
          <p className="rehearsal-banner" role="note">
            리허설 중 — 실제 판매가 아니에요
          </p>
        ) : null}
        <div className="console-head">
          <h1 className="console-title">
            {title} <span className="console-date">{dateWords(broadcast.date)}</span>
            {broadcast.rehearsal ? <span className="tag tag-rehearsal">리허설</span> : null}
          </h1>
          <div className="row">
            <a
              className="button"
              href={routePath({ name: 'home' })}
              onClick={(event) => {
                event.preventDefault()
                navigate({ name: 'home' })
              }}
            >
              방송 목록
            </a>
            {ended || sealed ? (
              <p className="ended-note" role="status">
                끝난 방송이에요
              </p>
            ) : (
              <>
                {/* 상품 목록 가져오기 (I2 AC-I2-52) — 끝난 방송에는 없다 */}
                <button type="button" className="button" onClick={() => openDialog({ kind: 'import' })}>
                  상품 목록 가져오기
                </button>
                <button type="button" className="button" onClick={endBroadcast}>
                  방송 끝내기
                </button>
              </>
            )}
            {voice !== null && !sealed ? <VoiceToggle voice={voice} snapshot={voiceSnapshot} ready={settings !== null} /> : null}
          </div>
        </div>
        {endError !== null ? <ErrorNote error={endError} /> : null}
        {sealed ? <SealedNotice /> : null}
        <div className={voiceLive !== null && wide ? 'console-sticky console-sticky-voice' : 'console-sticky'}>
          <LiveNotices snapshot={snapshot} onRetry={() => void store.retryNow()} />
          <CollectorWarningBar navigate={navigate} ended={ended || sealed} />
          <QuotaToast />
          <div className="console-sticky-quick">
            <AlertStrip counts={counts} print={printAlerts} thanksFailed={yt.thanksFailed} onOpen={openAlert} expanded={alertsOpen} onToggle={() => setAlertsOpen((open) => !open)} />
            <Lock className="lock-quick">
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
                asks={asks}
                onAsk={openAsk}
                onAskDismiss={removeAsk}
                onAskRegister={registerAsk}
                error={quickError}
              />
            </Lock>
            <UndoBar items={items} queue={queue} />
            {labelsNote !== null ? (
              <p key={labelsNote.n} className="notice labels-note" role="status">
                {labelsNote.text}
              </p>
            ) : null}
          </div>
          {wide ? voiceLive : null}
        </div>
        {wide ? null : voiceLive}
        {wide || voice === null ? null : <VoiceExtras voice={voice} snapshot={voiceSnapshot} />}
        <div className="console-grid">
          <div className="console-side">
            {broadcast.rehearsal ? (
              <RehearsalPanel
                broadcastId={b}
                generator={snapshot.generator}
                onGenerator={(status) => store.setGenerator(status)}
                onWritten={(result) => void store.sync(result.seq)}
                onOpenBroadcast={(id) => navigate({ name: 'console', id })}
                primary={fix === null && asks.length === 0}
              />
            ) : null}
            <CurrentProduct product={current} onOpen={(key) => openDialog({ kind: 'product', key })} />
            <YoutubePanel
              navigate={navigate}
              ended={ended}
              sealed={sealed}
              onOpenOutbox={() => openDialog({ kind: 'outbox' })}
              onUnlink={() => openDialog({ kind: 'youtubeUnlink' })}
            />
            {wide && voice !== null ? <VoiceExtras voice={voice} snapshot={voiceSnapshot} /> : null}
          </div>
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
            sealedMessage={snapshot.sealedMessage}
          />
        </div>
        <p className="shortcuts">{shortcutsWord(labelsOn === true)}</p>
      </main>
      {voice !== null && voiceSnapshot.phase === 'consent' ? <VoiceConsentDialog voice={voice} /> : null}
      {topDialog !== undefined ? (
        <DialogView
          key={dialogs.length}
          dialog={topDialog}
          broadcastId={b}
          onSync={(seq) => store.sync(seq)}
          messageOf={(id) => messagesById.get(id)}
          onClose={closeTop}
          onEditDone={(product, line, ask) => {
            clearLine(line)
            removeAsk(ask)
            setSelected(product.key)
            closeAll()
          }}
          onEditUnchanged={(product, ask) => {
            removeAsk(ask)
            setSelected(product.key)
            setDialogs([{ kind: 'product', key: product.key }])
          }}
        />
      ) : null}
      </ReadOnlyContext.Provider>
      </YoutubeContext.Provider>
    </ConsoleContext.Provider>
  )
}

interface DialogViewProps {
  readonly dialog: Dialog
  readonly broadcastId: string
  /** 쓰기 응답 seq까지 화면을 따라잡는다 */
  readonly onSync: (seq: number) => Promise<void>
  readonly messageOf: (id: string) => ChatMessage | undefined
  readonly onClose: () => void
  readonly onEditDone: (product: Product, line: string | null, ask: number | undefined) => void
  readonly onEditUnchanged: (product: Product, ask: number | undefined) => void
}

function DialogView({ dialog, broadcastId, onSync, messageOf, onClose, onEditDone, onEditUnchanged }: DialogViewProps) {
  switch (dialog.kind) {
    case 'import':
      return <ImportDialog broadcastId={broadcastId} onClose={onClose} onRegistered={onSync} />
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
          onDone={(product) => onEditDone(product, dialog.line, dialog.ask)}
          onUnchanged={(product) => onEditUnchanged(product, dialog.ask)}
        />
      )
    case 'conflict':
      return <ConflictDialog onClose={onClose} />
    case 'cancelRequests':
      return <CancelRequestDialog onClose={onClose} />
    case 'succession':
      return <SuccessionDialog onClose={onClose} />
    case 'pending':
      return <PendingDialog onClose={onClose} />
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
    case 'outbox':
      return <OutboxDialog onClose={onClose} />
    case 'youtubeAuthorize':
      return <AuthorizeDialog url={dialog.url} onClose={onClose} />
    case 'youtubeUnlink':
      return <UnlinkDialog onClose={onClose} />
    case 'printPause':
      return <PrintPauseDialog onClose={onClose} />
    case 'discard':
      return <DiscardDialog onClose={onClose} />
    case 'reprint':
      return <ReprintHost productKey={dialog.product} onClose={onClose} />
  }
}

/** Alt+P 창 (AC-I1-33): 현재 상품의 1등 라벨 */
function ReprintHost({ productKey: key, onClose }: { readonly productKey: string | null; readonly onClose: () => void }) {
  const api = useConsoleApi()
  const product = key === null ? undefined : api.data.products.get(key)
  const winners = product === undefined ? [] : product.winnerClaims.map((id) => api.data.claims.get(id)).filter((claim) => claim !== undefined)
  return (
    <ReprintDialog
      product={product}
      winners={winners}
      labels={consoleLabels(api)}
      rehearsal={api.rehearsal}
      date={api.date}
      title={product === undefined ? '' : productLabel(api, product.broadcast, product.no)}
      nameOf={(claim) => api.names.name(claim.currentBuyer)}
      onClose={onClose}
    />
  )
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
