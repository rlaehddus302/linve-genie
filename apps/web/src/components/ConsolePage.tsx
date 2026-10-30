import type { VoiceControllerPort } from '../voice/remote.ts'
// 라이브 콘솔 (SPEC §7 화면 2, AC-S05-02·10~15·21·22·30~35·40~42·54·62·63, AC-I1-30~34·36).
// 빠른 입력·알림 띠는 위쪽에 늘 보인다. 현재 상품·상품 보드·채팅(·리허설 조작판)은 폭에 맞춰 나란히 또는 아래로.
// I3: 유튜브 칸(스크롤 영역)·수집 멈춤 경고·사용량 알림(고정 영역)·알림 띠 "감사 실패"·감사 메시지 목록 (AC-I3-20~38),
//     봉인한 날짜는 볼 수만 있다 — 쓰기 칸·버튼이 잠기고 눌러도 요청을 보내지 않는다 (AC-I3-41).
// N2b-2: 인스타그램·틱톡 칸(스크롤 영역)·여러 플랫폼 도착순 안내·틱톡 알림 줄·인스타그램 알림·붙여넣기 결과(알림 띠 맨 앞 — 고정 영역에 줄을 더하지 않는다)·댓글 붙여넣기 창·채팅 줄 플랫폼 글자.
// 라벨 상태는 서버의 출력 기록(라벨 키마다)으로 보인다 — 리허설은 라벨이 없다. Alt+P(⌥P)는 현재 상품의 1등 라벨 다시 출력 창.
// N4b: 끝난 방송(봉인한 날짜 포함)의 콘솔은 주 버튼 "영수증 보내기" 하나 → `/broadcasts/<ID>/receipts` (AC-N4b-30, D-N4b-04). 방송 중에는 없다.
// 라벨 기능이 꺼져 있거나 켬/끔을 아직 모르면(N4a, L-13 9, AC-N4a-14·18): 보드 라벨 상태·알림 "출력 멈춤"(Alt+1 순서에서도)·단축키 안내의 Alt+P가 빠지고,
// Alt+P는 창을 열지 않고 "라벨 쓰지 않음 — 설정에서 켤 수 있어요."를 알린다(빠른 입력칸 포커스 그대로). 버릴 라벨은 남는다.
import { DEFAULT_SETTINGS, type SaleSettings } from '@livejjim/core'
import type { CardRegistration, SmsProductView, SmsReadOptions, SuggestionCard } from '@livejjim/voice'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ApiError, isApiError, newRequestId, post, withQuery, withRetry } from '../api/client.ts'
import type { ChatMessage, Product, WriteResult } from '../api/types.ts'
import type { ConsoleSnapshot, ConsoleStore } from '../lib/console-store.ts'
import type { ScopeData } from '../lib/scope-data.ts'
import { usePendingNow } from '../lib/use-pending-now.ts'
import { BuyerNames, alertCounts, isOptionBroadcast, latestProduct, productKey, productSlots } from '../lib/derive.ts'
import { EMPTY_DRAFT, optionSummary, type OptionDraft, type OptionPayload } from '../lib/options.ts'
import { useReviews } from '../lib/reviews.ts'
import { COUNT_PROBLEM, DEFAULT_COUNT, readCount } from '../lib/stock.ts'
import { SALE_MODE_WORD } from '../lib/words.ts'
import { useUndoQueue } from '../lib/host-delay.ts'
import { dateWords } from '../lib/kst.ts'
import { LABELS_OFF_NOTE, pauseAlertMessage, stationLeadShortText, stationLeadText } from '../lib/print-words.ts'
import { useLeaveGuard } from '../lib/leave-guard.ts'
import { ReadOnlyContext } from '../lib/read-only.ts'
import { changedFields, decideFixForm, decideQuickInput, editQuestion, quickSettings, type QuickDecision } from '../lib/quick.ts'
import { routePath, type Navigate } from '../lib/router.ts'
import { useScopeStore } from '../lib/use-store.ts'
import { useWide } from '../lib/use-wide.ts'
import { keepAboveBar, useKeepAboveBar } from '../lib/above-bar.ts'
import type { UndoItem, UndoQueue } from '../lib/undo-queue.ts'
import { ResendBoard, existsOnResendWords } from '../lib/resend-board.ts'
import { captureVacated, vacatedLine, type VacatedBefore } from '../lib/vacated.ts'
import { cardLine, enterBadgeCard } from '../lib/voice.ts'
import { readReceived } from '../lib/received.ts'
import { OFFER_FIX_FAILED, SMS_SEND_FAILED, SMS_UNDO_NOTE, VOICE_IDLE, type RecentFixOutcome, type RegisterSource, type SmsBuyerChoice, type SmsWriteOutcome, type VoiceHost, type VoiceLogInput, type VoiceSmsWrite, type VoiceSnapshot, type VoiceWriteOptions } from '../voice/controller.ts'
import { fetchPastNames } from '../voice/history.ts'
import { serverVoiceOnly } from '../voice/remote.ts'
import { VOICE_OFF_AFTER_RELOAD, rejectsUnknownVoiceLog, acquireVoiceSession, forgetVoiceOn, getVoiceSession, microphoneGranted, readVoiceOn, voiceOtherBroadcast } from '../voice/session.ts'
import { readConsent, readLearned, readSettings, readSmsSettings, writeConsent, writeLearned, writeSettings, writeSmsSettings } from '../voice/storage.ts'
import { AssignDialog, ConfirmDialog, ConvertDialog, EditDialog, ReasonDialog } from './ActionDialogs.tsx'
import { AttentionDialog, CancelRequestDialog, ConflictDialog, PendingDialog, SuccessionDialog } from './AlertDialogs.tsx'
import { AlertStrip, firstAlert, type AlertKind, type PrintAlerts } from './AlertStrip.tsx'
import { ChatPanel } from './ChatPanel.tsx'
import { MultiPlatformNotice, PlatformPanels, platformLeads, useConsolePlatforms } from './ConsolePlatforms.tsx'
import { ExtensionRouteLine, ExtensionThanksBar, ExtensionWarningBar, useExtension } from './ExtensionConnection.tsx'
import { extensionReceiving } from '../lib/extension.ts'
import { YOUTUBE_PASTE_GUIDE, invitedChannelName } from '../lib/youtube.ts'
import { AuthorizeDialog, CollectorWarningBar, OutboxDialog, QuotaToast, UnlinkDialog, YoutubeContext, YoutubePanel, useConsoleYoutube } from './ConsoleYoutube.tsx'
import { Lock } from './Lock.tsx'
import { SealedNotice } from './SealNotice.tsx'
import { ConsoleContext, consoleLabels, productLabel, useConsoleApi, type ConsoleApi, type Dialog, type HostActionInput } from './console-context.ts'
import { ErrorNote } from './ErrorNote.tsx'
import { ImportDialog } from './ImportDialog.tsx'
import { ReprintDialog } from './LabelParts.tsx'
import { LiveNotices } from './LiveNotices.tsx'
import { ProductBoard, CurrentProduct, CurrentSummary, FocusBanner } from './ProductBoard.tsx'
import { EditOptionsHost } from './ProductOptions.tsx'
import { OptionDialog } from './OptionDialog.tsx'
import { useLabelsEnabled, usePrintApi, usePrintState, useScopeLabels } from './print-context.tsx'
import { DiscardDialog, PrintPauseDialog } from './PrintParts.tsx'
import { ProductDetail } from './ProductDetail.tsx'
import { CautionContext, useConsoleCaution } from './caution.tsx'
import { useScreenWake } from '../voice/wake.ts'
import { QuickInput, QuickUnitLine, type EditAsk, type FixState, type Registration } from './QuickInput.tsx'
import { RehearsalPanel } from './RehearsalPanel.tsx'
import { NOT_APPLIED_MESSAGE, UndoBar, secondsWord } from './UndoBar.tsx'
import { PasteDialog } from './PasteDialog.tsx'
import { chatPlatformTags } from '../lib/platforms.ts'
import { VoiceConsentDialog, VoiceExtras, VoiceLive, VoiceToggle, voiceLiveShown } from './VoicePanel.tsx'

export interface ConsolePageProps {
  readonly broadcastId: string
  /** 앞 버전 호환 (위 줄은 앱이 그린다) */
  readonly shopName?: string
  readonly onLogout?: () => void
  readonly navigate: Navigate
  /** 열 때 그 번호 상품 자세히를 연다 (정산 화면 [상품 보기], AC-V3-71) */
  readonly openProduct?: number
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
  /** 빠른 입력 줄에 붙인 옵션·별칭·변형 재고 (옵션 방송 — product.register 한 번에 함께, D-O2-05) */
  readonly extra?: OptionPayload
  readonly draftOf?: OptionDraft
  /** 차례에서 그 번호가 이미 있을 때 "고칠까요?" 대신 (음성 자동 확정 — 창을 띄우지 않는다, D-I4-05) */
  readonly onExists?: (product: Product) => void
  /** 다시 보내기로 고칠 수 없는 실패·기록되지 않음 (음성 카드는 카드를 되살린다) */
  readonly onFailed?: () => void
  /** 잠깐의 오류 ("다시 보내기"가 남는다 — 바로 등록은 카드도 돌려놓는다, AC-V3-39) */
  readonly onTransient?: () => void
  /** 등록이 저장됨 (음성 카드 — 방금 등록한 상품으로 기억한다, D-V2-06 3) */
  readonly onDone?: (key: string) => void
  /** 음성으로 한 등록의 기록 한 줄 (R-25 — 서버가 상품 이벤트 전에 남긴다) */
  readonly voiceLog?: VoiceLogInput
  /** 개수 칸이 1이 아니었으면 그 개수 (옵션 없는 상품만 — AC-ORD11-01) */
  readonly stock?: number
}

/** 등록 경로의 선택 (음성 카드) */
interface RegHooks {
  readonly onExists?: (product: Product) => void
  readonly onFailed?: () => void
  readonly onDone?: (key: string) => void
  /** 음성으로 한 등록의 기록 한 줄 (R-25 — 서버가 상품 이벤트 전에 남긴다) */
  readonly voiceLog?: VoiceLogInput
  /** 잠깐의 오류로 보내지 못했다 ("다시 보내기"가 남는다) */
  readonly onTransient?: () => void
  readonly extra?: OptionPayload
  readonly draftOf?: OptionDraft
  readonly stock?: number
}

/** 창이 열려 있다 (콘솔 창·음성 안내 창·떠날지 묻는 창) */
function anyDialogOpen(): boolean {
  return document.querySelector('[role="dialog"]') !== null
}

/** 409 BUYER_AMBIGUOUS의 후보 (모양이 맞는 것만) — 찜 번호(`claims`, D-V1-14)는 정수만, 없거나 깨졌으면 빈 목록 */
export function readCandidates(value: unknown): SmsBuyerChoice[] {
  if (!Array.isArray(value)) return []
  const out: SmsBuyerChoice[] = []
  for (const item of value as readonly unknown[]) {
    if (typeof item !== 'object' || item === null) continue
    const { buyer, display, phoneLast4, claims } = item as Record<string, unknown>
    if (typeof buyer !== 'string' || buyer === '') continue
    out.push({
      buyer,
      display: typeof display === 'string' ? display : '',
      phoneLast4: typeof phoneLast4 === 'string' ? phoneLast4 : null,
      claims: Array.isArray(claims) ? (claims as readonly unknown[]).filter((no): no is number => typeof no === 'number' && Number.isSafeInteger(no)) : [],
    })
  }
  return out
}

/** R-21 읽기 설정 (그 방송 설정 스냅샷): 번호 방식이면 번호 범위, 옵션 방식이면 상품 목록(판매 종료 빼고)·지금 상품 (엔진 catalogOf·focusOf와 같은 모양) */
export function smsReadOptions(data: ScopeData, b: string, now: number): SmsReadOptions {
  const settings = data.broadcasts.get(b)?.settings ?? DEFAULT_SETTINGS
  const base = { parseMode: settings['claim.parseMode'], maxNumber: settings['claim.maxNumber'], maxQuantity: settings['claim.maxQuantity'] }
  if (settings['claim.parseMode'] !== 'OPTIONS') return base
  const catalog = [...data.products.values()]
    .filter((product) => product.broadcast === b && product.status !== 'CLOSED')
    .sort((x, y) => x.no - y.no)
    .map((product) => ({ no: product.no, name: product.name, aliases: product.aliases, options: product.options }))
  const record = data.broadcasts.get(b)?.focus ?? null
  const focused = record === null ? undefined : data.products.get(record.product)
  const at = record === null ? Number.NaN : Date.parse(record.at)
  const focus =
    focused === undefined || focused.status === 'HOLD' || focused.status === 'CLOSED' || !Number.isFinite(at) ? null : { no: focused.no, ageSec: Math.max(0, (now - at) / 1000) }
  return { ...base, catalog, focus }
}

/** 문자찜 카드가 보는 상품 모습 (D-V1-07): 없는 번호는 null, 1등이 찼으면 대기 자리(waitlist.max)를 본다 — 옵션 상품의 대기는 엔진이 판단한다 */
export function smsProductView(data: ScopeData, b: string, no: number): SmsProductView | null {
  const product = data.products.get(productKey(b, no))
  if (product === undefined) return null
  const max = data.broadcasts.get(b)?.settings['waitlist.max'] ?? DEFAULT_SETTINGS['waitlist.max']
  return { state: product.status, waitlistFull: product.status === 'SOLD' && !product.hasOptions && product.waitlist.length >= max }
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
        <h1>방송 화면을 열지 못했어요</h1>
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

function Console({ store, snapshot, queue, broadcastId, navigate, openProduct }: ConsoleProps) {
  const { data, broadcast } = snapshot
  const b = broadcastId
  const view = data.broadcasts.get(b)
  const settings: SaleSettings | null = view?.settings ?? null
  // 옵션 방송 (방송 시작 스냅샷 — D-O2-02·03): 옵션 칸·지금 상품·확인 필요는 이 방송에서만 보인다
  const optionMode = isOptionBroadcast(data, broadcastId)
  const ended = view?.ended ?? broadcast.ended
  const title = view?.title ?? broadcast.title
  const sealed = snapshot.sealed
  const items = useSyncExternalStore(queue.subscribe, queue.getSnapshot) ?? NO_ITEMS
  const yt = useConsoleYoutube({ store, broadcastId, date: broadcast.date, rehearsal: broadcast.rehearsal, lastMessageSeq: snapshot.messages.at(-1)?.seq ?? 0 })
  // 크롬 확장 (X1 YT-10 AC7·AC8): 리허설은 확장으로 받지 않는다
  const extension = useExtension(!broadcast.rehearsal)
  const thanksFailed = useRef(yt.thanksFailed)
  thanksFailed.current = yt.thanksFailed
  // 인스타그램·틱톡 (N2b-2): 플랫폼 칸·알림 줄·붙여넣기 창
  const live = useConsolePlatforms({ store, broadcastId, date: broadcast.date, rehearsal: broadcast.rehearsal, lastMessageSeq: snapshot.messages.at(-1)?.seq ?? 0 })
  const [pasteOpen, setPasteOpen] = useState(false)
  // 유튜브 수집 경고(서버 읽기 막힘 등)에서 연 붙여넣기 창은 유튜브 안내로 (YT-11 AC8, D-YT-SRV-09) — 같은 창·같은 넣기
  const [pasteGuide, setPasteGuide] = useState<string | undefined>(undefined)
  const [pasteNote, setPasteNote] = useState<string | null>(null)
  // 붙여 넣던 글은 창을 닫아도 남는다 (넣기를 마치면 비운다 — UX-N2b-2-01)
  const [pasteDraft, setPasteDraft] = useState('')
  useEffect(() => {
    if (pasteNote === null) return
    const timer = setTimeout(() => setPasteNote(null), 10_000)
    return () => clearTimeout(timer)
  }, [pasteNote])
  const openPaste = useCallback(() => {
    setPasteNote(null)
    setPasteGuide(undefined)
    setPasteOpen(true)
  }, [])
  const openYoutubePaste = useCallback(() => {
    setPasteNote(null)
    setPasteGuide(YOUTUBE_PASTE_GUIDE)
    setPasteOpen(true)
  }, [])
  const youtubeLinked = yt.enabled && yt.link?.link !== null && yt.link?.link !== undefined
  const platformTags = useMemo(() => chatPlatformTags(snapshot.messages, live.otherLinked), [snapshot.messages, live.otherLinked])

  // 최신 자료를 비동기 흐름(등록 순서 대기 등)에서 읽는다
  const latest = useRef(snapshot)
  latest.current = snapshot

  const quickRef = useRef<HTMLInputElement>(null)
  // 휴대폰 큰 글씨에서 빠른 입력칸·되돌리기 띠가 아래 막대 뒤에 깔리지 않게 (U-MOB1-01)
  const quickBoxRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  useKeepAboveBar(quickBoxRef, quickRef, headRef)
  const [quickText, setQuickText] = useState('')
  const quickTextRef = useRef(quickText)
  quickTextRef.current = quickText
  const [fix, setFix] = useState<FixState | null>(null)
  /** 빠른 입력 고치기 칸이 열려 있다 (Esc가 문자찜 카드를 닫지 않는다, D-V1-20) */
  const fixOpen = useRef(false)
  fixOpen.current = fix !== null
  const [registrations, setRegistrations] = useState<Registration[]>([])
  const [asks, setAsks] = useState<EditAsk[]>([])
  const askId = useRef(1)
  const [quickError, setQuickError] = useState<ApiError | null>(null)
  /** 개수 칸 (AC-ORD11-01·04, D-STK-01): 등록·고치기에 쓰면 1로 돌아간다 — 다음 상품에 따라가지 않게 */
  const [countText, setCountText] = useState(DEFAULT_COUNT)
  const countRef = useRef(countText)
  countRef.current = countText
  const [countProblem, setCountProblem] = useState<string | null>(null)
  const countInput = useRef<HTMLInputElement>(null)
  /** 그 개수 글자로 등록·고치기를 시작했다: 칸이 그대로면 1로 돌린다 (그사이 판매자가 다음 개수를 적었으면 둔다) */
  const takeCount = useCallback((text: string) => {
    if (countRef.current === text) {
      countRef.current = DEFAULT_COUNT
      setCountText(DEFAULT_COUNT)
    }
    setCountProblem(null)
  }, [])
  /** 등록하지 못했다: 칸이 1이면 그 개수를 되살린다 (다시 Enter하면 같은 개수로 — 말없이 1로 등록되지 않게) */
  const restoreCount = useCallback((stock: number | undefined) => {
    if (stock === undefined || countRef.current !== DEFAULT_COUNT) return
    countRef.current = String(stock)
    setCountText(String(stock))
  }, [])
  /** 빠른 입력 줄에 붙인 옵션 (등록하면 비운다 — 다음 상품에 따라가지 않게, D-O2-05) */
  const [attached, setAttached] = useState<{ readonly draft: OptionDraft; readonly payload: OptionPayload } | null>(null)
  const attachedRef = useRef(attached)
  attachedRef.current = attached
  /** 붙인 옵션을 넣지 않고 뗐다는 안내 (D-O2-05 보강): 새 번호 등록이 아닌 길(고치기·찾기·음성 등록)에서는 옵션이 다음 상품에 따라가지 않게 뗀다 */
  const [optionNote, setOptionNote] = useState<{ readonly text: string; readonly n: number } | null>(null)
  const noteDroppedOptions = useCallback((no: number) => {
    setOptionNote((note) => ({
      text: `붙인 옵션은 ${String(no)}번에 넣지 않고 뗐어요. 옵션은 빠른 입력 줄로 새 번호를 등록할 때만 함께 들어가요. ${String(no)}번 옵션은 상품 자세히의 "옵션 고치기"로 넣어 주세요.`,
      n: (note?.n ?? 0) + 1,
    }))
  }, [])
  /** 저절로 다시 보내려던 빠른 입력 등록의 번호가 이미 있어 보내지 않았다는 안내 (D-MOB2-10) */
  const [resendNote, setResendNote] = useState<{ readonly text: string; readonly n: number } | null>(null)
  /** 새 번호 등록이 아닌 길에서 붙인 옵션을 뗀다 (붙어 있었으면 안내) */
  const dropAttached = useCallback(
    (no: number) => {
      if (attachedRef.current === null) return
      attachedRef.current = null
      setAttached(null)
      noteDroppedOptions(no)
    },
    [noteDroppedOptions],
  )
  const [selected, setSelected] = useState<string | null>(null)
  const [dialogs, setDialogs] = useState<Dialog[]>([])
  const dialogCount = useRef(0)
  dialogCount.current = dialogs.length
  const [endError, setEndError] = useState<ApiError | null>(null)
  const chain = useRef<Promise<void>>(Promise.resolve())
  // 연결이 돌아오면 저절로 한 번 다시 보낼 실패 (D-MOB2-07): 빠른 입력 등록 → 상품 관리 명령 → 방송자 조치 차례
  const resendBoard = useMemo(() => new ResendBoard(), [])
  useEffect(() => {
    const offHost = resendBoard.addHost(async () => {
      await queue.resendRetryable()
    })
    const offReconnect = store.onReconnect(() => void resendBoard.flush())
    return () => {
      offHost()
      offReconnect()
    }
  }, [resendBoard, queue, store])
  /** 앞 등록 응답을 기다리며 판단을 미룬 줄 수 */
  const waitingLines = useRef(0)
  const regId = useRef(1)
  const regRequests = useRef(new Map<number, RegRequest>())
  /** 상품 키 → 등록 되돌리기 항목 (음성 "취소" → 되돌릴까요 카드, D-V2-06 3) */
  const regUndo = useRef(new Map<string, number>())
  const [alertsOpen, setAlertsOpen] = useState(false)
  // 알림 띠를 펼치거나 접은 그 그리기 안에서(칠하기 전) 묶음을 막대 위로 올린다 — 다음 그리기(useKeepAboveBar의 크기 관찰)까지 미루면
  // 펼친 목록이 한 번 제자리에 그려진 뒤 화면이 뛰어 올라가, 그 사이에 잰 항목 위치가 서로 겹쳐 보인다(SA-QL2-01). 그 뒤의 관찰은 올릴 거리 0
  useLayoutEffect(() => {
    const box = quickBoxRef.current
    if (box !== null && box.contains(box.ownerDocument.activeElement)) keepAboveBar(box, quickRef.current)
  }, [alertsOpen])
  const wide = useWide()
  const wideRef = useRef(wide)
  wideRef.current = wide

  // ── 음성 (VOC-01·04·05, D-I4-03~06·09) ────────────────────────────────
  // 콘솔마다 하나. "음성 켜기"를 누르기 전에는 음성 코드·인식 객체·마이크·이력 조회가 없다. 콘솔을 떠나면 인식을 멈춘다.
  const currentNames = useMemo(() => [...data.products.values()].map((product) => product.name), [data.products])
  const currentNamesRef = useRef(currentNames)
  currentNamesRef.current = currentNames
  const voiceActions = useRef<{
    register: (card: SuggestionCard, registration: CardRegistration, source: RegisterSource) => void
    focusQuick: () => void
    writeSms: (write: VoiceSmsWrite, received: string | null, requestId: string) => Promise<SmsWriteOutcome>
    fixRecent: (id: string, changes: { readonly name?: string; readonly price?: number }, options?: VoiceWriteOptions) => Promise<RecentFixOutcome>
    openProduct: (id: string) => void
    renumber: (from: number, to: number, options?: VoiceWriteOptions) => Promise<boolean | 'claimed'>
    undoRecent: (id: string) => boolean
  }>({
    register: () => {},
    focusQuick: () => {},
    writeSms: async () => ({ kind: 'failed', message: SMS_SEND_FAILED }),
    fixRecent: async () => ({ kind: 'failed', message: OFFER_FIX_FAILED }),
    undoRecent: () => false,
    openProduct: () => {},
    renumber: async () => false,
  })
  const [voice, setVoice] = useState<VoiceControllerPort | null>(null)
  // 등록 성공을 음성 칸에 알린다 (지원 안 함 안내를 내림, D-I5-15) — 등록 경로가 음성 컨트롤러를 의존하지 않게 ref로
  const voiceRef = useRef<VoiceControllerPort | null>(null)
  voiceRef.current = voice
  // 다른 방송에서 듣는 중인 음성 (D-V3-52 — 이 콘솔은 안내만), 새로 고침 뒤 다시 켜지 못한 안내
  const [otherVoice, setOtherVoice] = useState<{ readonly id: string; readonly title: string } | null>(null)
  const [voiceOffNotice, setVoiceOffNotice] = useState(false)
  useEffect(() => {
    const host: VoiceHost = {
      load: serverVoiceOnly,
      now: () => Date.now(),
      maxNumber: () => latest.current.data.broadcasts.get(b)?.settings['claim.maxNumber'] ?? DEFAULT_SETTINGS['claim.maxNumber'],
      // "N번 품종 수"의 수는 그 방송 가격 단위로 (D-V3-48)
      priceUnit: () => latest.current.data.broadcasts.get(b)?.settings['price.unit'] ?? DEFAULT_SETTINGS['price.unit'],
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
      // ── 음성 문자찜 (V1, ORD-08 AC9) ──
      smsReadOptions: () => smsReadOptions((store.getSnapshot().data ?? latest.current.data), b, Date.now()),
      smsProduct: (no) => smsProductView((store.getSnapshot().data ?? latest.current.data), b, no),
      // 카드에 보일 이름: 옵션 방식은 상품 이름, 번호 방식은 품종 (D-V1-21 — 비었으면 번호만)
      smsProductName: (no) => {
        const current = store.getSnapshot().data ?? latest.current.data
        const product = current.products.get(productKey(b, no))
        return product === undefined || product.name.trim() === '' ? null : product.name
      },
      // 손 입력 문자찜의 받은 시각 칸과 같은 읽기 (ORD-08 AC6, D-089 — 오전·오후 중 지금과 가까운 쪽)
      readSmsTime: (time, now) => {
        const read = readReceived(time, now)
        return read.kind === 'ok' ? { value: read.value, late: read.late } : null
      },
      writeSms: (write, received, requestId) => voiceActions.current.writeSms(write, received, requestId),
      newRequestId,
      readSmsSettings,
      writeSmsSettings: (settings) => writeSmsSettings(settings),
      // ── V2 ──
      readLearned,
      writeLearned: (list) => writeLearned(list),
      fixRecent: (id, changes, options) => voiceActions.current.fixRecent(id, changes, options),
      openProduct: (id) => voiceActions.current.openProduct(id),
      renumber: (from, to, options) => voiceActions.current.renumber(from, to, options),
      undoRecent: (id) => voiceActions.current.undoRecent(id),
      // ── V3 바로 등록: 그 번호 상품과 1등+대기 수 (상품 보드 데이터) ──
      existingProduct: (no) => {
        const current = store.getSnapshot().data ?? latest.current.data
        const product = current.products.get(productKey(b, no))
        if (product === undefined) return null
        const slots = productSlots(product)
        return { key: product.key, name: product.name, price: product.price, claimCount: slots.winners.length + slots.waitlist.length, closed: product.status === 'CLOSED', status: product.status }
      },
    }
    // 켠 음성은 앱 전체가 들고 있다 — 콘솔을 떠나도 끄지 않는다 (D-V3-52)
    const session = acquireVoiceSession(b, latest.current.broadcast.title)
    if (session === null) {
      const other = getVoiceSession()
      setOtherVoice(other === null ? null : { id: other.broadcastId, title: other.title })
      setVoice(null)
      return
    }
    setOtherVoice(null)
    session.attach(host, latest.current.broadcast.title)
    const controller = session.controller
    setVoice(controller)
    // 새로 고침·탭 닫기 뒤: 그 방송이 끝나지 않았고 마이크 권한이 이미 허락돼 있으면 저절로 다시 켠다, 아니면 안내 (D-V3-52)
    let cancelled = false
    if (readVoiceOn() === b && controller.getSnapshot().phase === 'off') {
      if (latest.current.broadcast.ended) forgetVoiceOn()
      else
        void microphoneGranted().then((granted) => {
          if (cancelled) return
          if (granted && readConsent()) void controller.turnOn()
          else setVoiceOffNotice(true)
        })
    }
    return () => {
      cancelled = true
      session.detach(host)
    }
  }, [b, store, broadcast.date, broadcast.rehearsal])
  const voiceSnapshot = useSyncExternalStore(voice?.subscribe ?? noSubscribe, voice?.getSnapshot ?? idleVoice)
  // 음성이 듣는 동안 화면 꺼짐 막기 (MOB1 D-MOB1-07, AC-MOB1-10) — 출력 기기의 막기와 따로
  useScreenWake(voice !== null && voiceSnapshot.phase === 'on')
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
  /** 그리기와 상관없는 지금 자료 (RA-MOB2-01) */
  const latestData = useCallback((): ScopeData => store.getSnapshot().data ?? latest.current.data, [store])

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
  // 정산 화면 [상품 보기]로 왔으면 그 상품 자세히를 한 번 연다 (AC-V3-71)
  const openedProduct = useRef(false)
  useEffect(() => {
    if (openProduct === undefined || openedProduct.current) return
    const key = productKey(b, openProduct)
    if (!data.products.has(key)) return
    openedProduct.current = true
    openDialog({ kind: 'product', key })
  }, [openProduct, data.products, b, openDialog])


  /** 쓰기 하나: 같은 요청 번호로 재시도 → 응답 seq까지 따라잡기 */
  const write = useCallback(
    async (requestId: string, event: Readonly<Record<string, unknown>>, wait = true): Promise<WriteResult> => {
      // 봉인한 날짜는 쓰지 않는다 (버튼도 잠겨 있다 — 요청을 보내지 않는다)
      if (latest.current.sealed) throw new ApiError({ status: 409, code: 'SEALED', message: '30일이 지난 방송 기록은 봉인되어 고칠 수 없어요.' })
      const scoped = typeof event.b !== 'string'
      const path = withQuery('/api/events', scoped ? { date: broadcast.date, rehearsal: broadcast.rehearsal } : {})
      let result: WriteResult
      try {
        result = await withRetry(() => post<WriteResult>(path, { requestId, ...event }))
      } catch (error) {
        // 음성 기록 칸(voiceLog, R-25)을 모르는 옛 서버면 그 칸 없이 한 번 더 — 등록·고치기가 막히지 않게
        if (event.voiceLog !== undefined && rejectsUnknownVoiceLog(error)) {
          const { voiceLog: _dropped, ...plain } = event
          return await write(requestId, plain, wait)
        }
        followFailure(error)
        throw error
      }
      // 응답만 기다리는 쓰기(api.write)는 따라잡기를 시작만 한다 (D-SMS-01)
      if (wait) await store.sync(result.seq)
      else void store.sync(result.seq)
      return result
    },
    [broadcast.date, broadcast.rehearsal, followFailure, store],
  )

  const command = useCallback((event: Readonly<Record<string, unknown>>, requestId?: string) => write(requestId ?? newRequestId(), event), [write])
  const writeOnly = useCallback((event: Readonly<Record<string, unknown>>, requestId?: string) => write(requestId ?? newRequestId(), event, false), [write])

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
      let before: VacatedBefore | null = null
      let captured = false
      queue.add({
        label: input.label,
        ...(input.message === undefined ? {} : { meta: input.message }),
        claims: input.claims ?? [],
        products: input.products ?? [],
        send: async (requestId) => {
          // 1등 찜을 비우는 조치면 보내기 직전 모양을 잡아 둔다 (D-MOB2-04 결과 한 줄)
          // 처음 보낼 때 한 번만 — 응답을 잃고 다시 보내거나 연결이 돌아와 저절로 보낼 때 다시 잡으면 이미 바뀐 모양이라 결과 줄을 잃는다(TE-MOB2-001)
          if (!captured) {
            captured = true
            before = captureVacated(store.getSnapshot().data, input.event, input.claims ?? [])
          }
          const scoped = typeof input.event.b !== 'string'
          const path = withQuery('/api/events', scoped ? { date: broadcast.date, rehearsal: broadcast.rehearsal } : {})
          return post<WriteResult>(path, { requestId, ...input.event })
        },
        outcome: async (result) => {
          if (before === null) return null
          await store.sync(result.seq)
          return vacatedLine(before, store.getSnapshot().data)
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
  // 꺼져 있으면 "출력 멈춤"은 알림 띠·Alt+1 순서에서 빠진다 — 버릴 라벨은 남는다 (AC-N4a-14·16). 판매자 멈춤은 까닭·할 일 문장(QL2 D-QL2-09 ②)
  const printAlerts: PrintAlerts = useMemo(
    () => ({ pause: labelsOn === true && queueSummary !== null && queueSummary.pause !== null ? pauseAlertMessage(queueSummary.pause, queueSummary.waiting) : null, discard: queueSummary?.discard ?? 0 }),
    [queueSummary, labelsOn],
  )
  const printAlertsRef = useRef(printAlerts)
  printAlertsRef.current = printAlerts
  // 출력 기기 끊김·출력 기기 없음 항목 (MOB1 D-MOB1-08, AC-MOB1-13): 알림 띠 맨 앞(플랫폼 줄 다음), Alt+1 순서·알림 수에는 넣지 않는다
  const printApi = usePrintApi()
  const stationInput = {
    labelsOn,
    rehearsal: broadcast.rehearsal,
    ended: ended || sealed,
    queue: queueSummary,
    mine: printApi !== null && queueSummary !== null && printApi.station.isMine(queueSummary),
  }
  const stationText = stationLeadText(stationInput)
  // 휴대폰 접힌 띠에서만 쓰는 끊김 짧은 문장 (QL3R1 D-QL3R1-04)
  const stationShort = stationLeadShortText(stationInput)
  /** 되돌릴 것이 없는 Ctrl+Z에 음성 문자찜 결과 카드가 열려 있다는 알림 (잠시 보인다, D-V1-22) */
  const [undoNote, setUndoNote] = useState<{ readonly text: string; readonly n: number } | null>(null)
  useEffect(() => {
    if (undoNote === null) return
    const timer = setTimeout(() => setUndoNote(null), LABELS_NOTE_MS)
    return () => clearTimeout(timer)
  }, [undoNote])
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
      write: writeOnly,
      fillQuick,
      select: setSelected,
      resend: resendBoard,
      latest: latestData,
      options: optionMode,
    }),
    [latestData, b, broadcast.date, broadcast.rehearsal, ended, sealed, data, names, labels, waiting, queue.delayMs, settingsOf, openDialog, closeTop, closeAll, queueHost, command, writeOnly, fillQuick, optionMode, resendBoard],
  )

  // 1등 옆 "입금 늦음 주의" (CRM1 D-CRM1-07): 실제 방송만, 판매자 전용 조회 — 받지 못하면 꼬리표 없이 그대로(오류 띠 없음)
  const caution = useConsoleCaution(data, broadcast.date, broadcast.rehearsal)

  // ── 빠른 입력 (AC-S05-10~13, D-084) ──────────────────────────────────

  const clearLine = useCallback((line: string | null) => {
    if (line !== null && quickTextRef.current === line) setQuickText('')
  }, [])

  // 방송이 끝나면(다른 기기에서 끝내도) 빠른 입력 줄이 사라지고 치던 글은 버린다 — 보내지 않는다 (MOB1 D-MOB1-09, AC-MOB1-17)
  const closedQuick = ended || sealed
  useEffect(() => {
    if (closedQuick) setQuickText('')
  }, [closedQuick])

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
    (product: Product, name: string, price: number, line: string, stock?: number) => {
      const counted = stock === undefined || product.hasOptions ? {} : { stock }
      if (typedNext(line)) {
        setAsks((list) => [...list, { id: askId.current++, line, no: product.no, product: product.key, name, price, ...counted }])
        return
      }
      openDialog({ kind: 'edit', product: product.key, name, price, line, ...counted })
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
      const base = { kind: 'edit', product: current.key, name: ask.name, price: ask.price, line: ask.line, ...(ask.stock === undefined ? {} : { stock: ask.stock }) } as const
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
    async (no: number, voiceLog?: VoiceLogInput): Promise<'undone' | 'blocked'> => {
      const product = findProduct(no)
      if (product !== undefined && (productSlots(product).winners.length > 0 || productSlots(product).waitlist.length > 0)) return 'blocked'
      const result = await write(newRequestId(), { type: 'product.close', b, no, ...(voiceLog === undefined ? {} : { voiceLog }) })
      // 되돌린 번호는 음성을 끌 때까지 바로 등록하지 않는다 (V3 D-V3-10)
      if (result.changed) voiceRef.current?.rejectNumber(no)
      return result.changed ? 'undone' : 'blocked'
    },
    [b, findProduct, write],
  )

  const runRegistration = useCallback(
    async (id: number, first: boolean, auto = false) => {
      const request = regRequests.current.get(id)
      if (request === undefined) return
      // 보내기 시작하면 저절로 다시 보낼 목록에서 내린다 (판매자가 "다시 보내기"를 눌렀거나 지금 저절로 보냄, D-MOB2-07)
      resendBoard.remove(`register:${String(id)}`)
      const remove = () => {
        regRequests.current.delete(id)
        setRegistrations((list) => list.filter((item) => item.id !== id))
      }
      // 앞 줄이 같은 번호를 등록했으면(또는 다른 기기가) 등록 대신 묻는다
      const exists = (product: Product) => {
        // 등록하려던 번호가 이미 있다: 함께 보내려던 옵션은 넣지 않았다고 알린다 (말없이 사라지지 않게)
        if (request.extra !== undefined) noteDroppedOptions(product.no)
        if (request.onExists !== undefined) request.onExists(product)
        else askEdit(product, request.name, request.price, request.line, request.stock)
      }
      // 처음 보낼 때만 화면을 미리 본다. 저절로 다시 보낼 때는 화면에 그 번호가 있어도 미리 보지 않고 처음 요청 번호로 한 번 보내
      // 서버 답으로 판단한다(D-MOB2-14): 응답만 잃은 자기 등록이면 서버가 처음 결과(changed: true)를 돌려주고,
      // 다른 곳에서 먼저 생긴 번호면 changed: false — 화면이 따라잡았는지와 상관없다.
      if (first) {
        const existing = findProduct(request.no)
        if (existing !== undefined) {
          remove()
          exists(existing)
          return
        }
      }
      setRegistrations((list) => list.map((item) => (item.id === id ? { ...item, status: 'sending', error: null, auto } : item)))
      try {
        const extra = request.extra
        const result = await write(request.requestId, {
          type: 'product.register',
          b,
          no: request.no,
          name: request.name,
          price: request.price,
          ...(request.stock === undefined ? {} : { stock: request.stock }),
          ...(extra === undefined || extra.options.length === 0 ? {} : { options: extra.options, stocks: extra.stocks }),
          ...(extra === undefined || extra.aliases.length === 0 ? {} : { aliases: extra.aliases }),
          ...(request.voiceLog === undefined ? {} : { voiceLog: request.voiceLog }),
        })
        remove()
        const key = productKey(b, request.no)
        if (!result.changed) {
          if (auto) {
            // 저절로 다시 보냈는데 그사이 다른 곳에서 그 번호가 먼저 생겼다(D-MOB2-14 (2)): 판매자가 누르지 않았으니 "고칠까요?" 창을 열지 않고
            // 한 줄로 알린다 — 붙인 옵션이 있었으면 넣지 않았다는 안내도. 개수 칸·붙인 옵션은 되살리지 않는다(지금 치는 줄을 건드리지 않게)
            setResendNote((note) => ({ text: existsOnResendWords(request.no), n: (note?.n ?? 0) + 1 }))
            if (request.extra !== undefined) noteDroppedOptions(request.no)
            return
          }
          // 그사이 다른 곳에서 같은 번호가 생겼다: 등록되지 않았으니 묻는다
          const existing = findProduct(request.no)
          if (existing !== undefined) exists(existing)
          else {
            request.onFailed?.()
            restoreCount(request.stock)
            // 등록되지 않았으니 붙였던 옵션을 되살린다
            const extra = request.extra
            if (extra !== undefined) setAttached((current) => current ?? { draft: request.draftOf ?? EMPTY_DRAFT, payload: extra })
          }
          return
        }
        clearLine(request.line)
        if (request.fromFix) setFix(null)
        setSelected(key)
        setQuickError(null)
        voiceRef.current?.noteRegistered()
        // 음성 등록을 되돌리면 그 등록의 요청 번호를 기록에 싣는다 (R-25 UNDO)
        const undoLog = request.voiceLog === undefined ? undefined : { ...request.voiceLog, undo: request.requestId }
        const undoItem = queue.addRegistration({ no: request.no, product: key, undo: () => undoRegistration(request.no, undoLog), auto })
        regUndo.current.set(key, undoItem.id)
        request.onDone?.(key)
      } catch (error) {
        if (!isApiError(error)) throw error
        if (error.transient) {
          setRegistrations((list) => list.map((item) => (item.id === id ? { ...item, status: 'failed', error, auto: false } : item)))
          request.onTransient?.()
          // 같은 요청 번호로 다시 보내도 두 번 기록되지 않는 실패(응답만 잃은 경우 포함): 연결이 돌아오면 같은 요청 번호로 한 번 저절로 (D-MOB2-07·14)
          if (error.retryable) {
            resendBoard.add(`register:${String(id)}`, 'register', () => {
              const next = chain.current.then(() => runRegistrationRef.current(id, false, true))
              chain.current = next
              return next
            })
          }
        } else {
          remove()
          setQuickError(error)
          request.onFailed?.()
          restoreCount(request.stock)
        }
        // 등록하지 못했으면 붙였던 옵션을 되살린다 (다시 Enter하면 같이 간다)
        if (request.extra !== undefined && !error.transient) {
          const extra = request.extra
          setAttached((current) => current ?? { draft: request.draftOf ?? EMPTY_DRAFT, payload: extra })
        }
      }
    },
    [askEdit, b, clearLine, findProduct, noteDroppedOptions, queue, restoreCount, undoRegistration, write, resendBoard],
  )
  const runRegistrationRef = useRef(runRegistration)
  runRegistrationRef.current = runRegistration

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
      dropAttached(no)
      const voiceLog = voice?.voiceLogFor(card.text) ?? null
      enqueueRegistration(cardLine(no, name, price), no, name, price, false, {
        ...(voiceLog === null ? {} : { voiceLog }),
        ...(source === 'auto' ? { onExists: (product: Product) => voice?.restore(card, { note: editQuestion(product.no, product.status === 'CLOSED') }) } : {}),
        // 바로 등록인데 차례에서 그 번호가 생겼다 — 이미 있는 번호 규칙(무시·자동 고침·묻기)대로, 창은 띄우지 않는다 (V3)
        // 바로 등록이 잠깐의 오류로 실패하면 "다시 보내기"와 함께 그 말의 카드도 돌려놓는다 (AC-V3-39, TE-V3-008)
        ...(source === 'instant' ? { onExists: () => voice?.instantExists(card), onTransient: () => voice?.restore(card, { touched: true }) } : {}),
        onFailed: () => voice?.restore(card, { touched: true }),
        onDone: (key) => {
          // "다시 보내기"로 등록됐으면 돌려놓은 카드는 뺀다
          if (source === 'instant') voice?.take(card.id)
          voice?.noteVoiceRegistered({ id: key, no, name, price })
        },
      })
      if (source === 'click') focusQuick()
    },
    [dropAttached, enqueueRegistration, focusQuick, voice],
  )
  /**
   * 음성 문자찜 쓰기 하나 (AC-V1-21·25·30·31): 손 입력과 같은 `sms` 이벤트 — 본문은 type·방송·번호·(옵션·수량)·(받은 시각)·(메모)·(끝자리 또는 구매자)·`voice: true`·요청 번호뿐.
   * `voice: true`는 음성 쓰기에만 붙는다 — 서버가 여러 기기의 같은 말을 한 번만 넣는다(D-V1-13, 손 입력 본문에는 없다).
   * 인식 문장은 보내지 않는다(D-V1-10). 409 BUYER_AMBIGUOUS는 후보로, 409 VOICE_REPEATED는 이유 카드로, 그 밖의 실패는 서버 문장으로 돌려준다(카드가 다시 열린다).
   */
  const writeVoiceSms = useCallback(
    async (one: VoiceSmsWrite, received: string | null, requestId: string): Promise<SmsWriteOutcome> => {
      const option = isOptionBroadcast(latest.current.data, b)
      const event = {
        type: 'sms',
        b,
        no: one.no,
        ...(option ? { qty: one.qty } : {}),
        ...(option && one.options !== undefined ? { options: { ...one.options } } : {}),
        ...(received === null ? {} : { received }),
        ...(one.memo === null ? {} : { memo: one.memo }),
        ...(one.buyer !== undefined ? { buyer: one.buyer } : one.last4 !== undefined ? { last4: one.last4, ...(one.newBuyer === true ? { newBuyer: true } : {}) } : {}),
        voice: true,
      }
      try {
        const result = await write(requestId, event)
        return { kind: 'ok', seq: result.seq, buyer: typeof result.buyer === 'string' ? result.buyer : null }
      } catch (error) {
        if (!isApiError(error)) return { kind: 'failed', message: SMS_SEND_FAILED }
        if (error.code === 'VOICE_REPEATED') return { kind: 'repeated', message: error.message }
        if (error.code === 'BUYER_AMBIGUOUS') {
          const candidates = readCandidates(error.details.candidates)
          if (candidates.length > 0) return { kind: 'ambiguous', candidates, message: error.message }
        }
        return { kind: 'failed', message: error.network ? SMS_SEND_FAILED : error.message }
      }
    },
    [b, write],
  )
  /**
   * 고칠까요 카드의 [고치기]·[되돌리기] (D-V2-06 3, AC-V2-26): 손 고치기와 같은 `product.update`. 찜이 있는 상품의 가격을 바꾸면
   * 손 고치기 창(PRD-01 — 누구에게 적용할지 묻는 안내 그대로)을 연다.
   */
  const fixRecentProduct = useCallback(
    async (key: string, changes: { readonly name?: string; readonly price?: number }, options: VoiceWriteOptions = {}): Promise<RecentFixOutcome> => {
      const product = (store.getSnapshot().data ?? latest.current.data).products.get(key)
      if (product === undefined) return { kind: 'failed', message: '그 상품을 찾지 못했어요. 상품 목록에서 확인해 주세요.' }
      const slots = productSlots(product)
      const claimed = slots.winners.length + slots.waitlist.length > 0
      // 음성 바로 고침·[새 가격으로 바꾸기]는 창 없이 새 찜부터만 새 가격 (NEW_ONLY — 확정 찜 가격은 그대로, D-V3-57·59)
      if (options.newOnly !== true && options.applyTo === undefined && changes.price !== undefined && changes.price !== product.price && claimed) {
        openDialog({ kind: 'edit', product: product.key, name: changes.name ?? product.name, price: changes.price, line: null })
        return { kind: 'dialog' }
      }
      const before: { name?: string; price?: number } = {}
      if (changes.name !== undefined) before.name = product.name
      if (changes.price !== undefined) before.price = product.price
      try {
        const applyTo = changes.price === undefined || !claimed ? undefined : (options.applyTo ?? (options.newOnly === true ? 'NEW_ONLY' : undefined))
        await write(options.requestId ?? newRequestId(), { type: 'product.update', b, no: product.no, ...changes, ...(applyTo === undefined ? {} : { applyTo }), ...(options.voiceLog === undefined ? {} : { voiceLog: options.voiceLog }) })
        return { kind: 'fixed', before }
      } catch (error) {
        if (!isApiError(error) || error.network) return { kind: 'failed', message: OFFER_FIX_FAILED }
        return { kind: 'failed', message: error.message }
      }
    },
    [b, openDialog, store, write],
  )
  const undoRecentProduct = useCallback(
    (key: string): boolean => {
      const id = regUndo.current.get(key)
      return id !== undefined && queue.undo(id)
    },
    [queue],
  )
  voiceActions.current = {
    register: registerVoiceCard,
    focusQuick,
    writeSms: writeVoiceSms,
    fixRecent: fixRecentProduct,
    undoRecent: undoRecentProduct,
    // [아까 것을 다른 번호로] — 그 상품 자세히(손 고치기, R-10 안내 그대로)
    openProduct: (key) => openDialog({ kind: 'product', key }),
    // 음성 번호 옮기기 — 손 고치기와 같은 product.renumber (R-10·D-V3-58)
    renumber: async (from, to, options = {}) => {
      try {
        const result = await write(options.requestId ?? newRequestId(), { type: 'product.renumber', b, from, to, ...(options.voiceLog === undefined ? {} : { voiceLog: options.voiceLog }) })
        return result.changed
      } catch (error) {
        // 서버가 찜이 있는 상품이라 막았다 (RA-V3-001)
        return isApiError(error) && error.code === 'VOICE_RENUMBER_CLAIMED' ? 'claimed' : false
      }
    },
  }

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
          dropAttached(no)
          // 고치기 칸에 적은 품종이 들은 말과 다르면 배운다 (D-V2-10)
          voice.learnFrom(card, name)
          // 음성 카드를 손으로 고쳐 등록해도 그 카드의 조각 글을 기록에 (SA-V3-001)
          const voiceLog = voice.voiceLogFor(card.text)
          enqueueRegistration(cardLine(no, name, price), no, name, price, false, {
            ...(voiceLog === null ? {} : { voiceLog }),
            onFailed: () => voice.restore({ ...card, no, name: name === '' ? null : name, price }, { touched: true }),
            onDone: (key) => voice.noteVoiceRegistered({ id: key, no, name, price }),
          })
          focusQuick()
          return
        }
        case 'edit': {
          if (voice.take(id) === undefined) return
          dropAttached(decision.no)
          askEdit(decision.product, decision.name, decision.price, cardLine(decision.no, decision.name, decision.price))
          return
        }
        default:
          return
      }
    },
    [askEdit, dropAttached, enqueueRegistration, findProduct, focusQuick, settings, voice],
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
      dropAttached(ask.no)
      enqueueRegistration(ask.line, ask.no, ask.name, ask.price, false, ask.stock === undefined ? {} : { stock: ask.stock })
    },
    [asks, dropAttached, enqueueRegistration, removeAsk],
  )

  // 상태가 바뀌면 남겨 둔 "고칠까요?"를 그 번호의 지금 상품과 다시 본다: 친 값과 다른 값이 없으면 지운다 (AC-S06-67, D-095)
  useEffect(() => {
    setAsks((list) => {
      const next = list.filter((ask) => {
        const current = data.products.get(productKey(b, ask.no))
        return current === undefined || current.status === 'CLOSED' || Object.keys(changedFields(current, ask.name, ask.price, ask.stock)).length > 0
      })
      return next.length === list.length ? list : next
    })
  }, [data.products, b, asks.length])

  /**
   * 한 줄의 판단을 실행한다. inChain = 앞 등록 응답을 기다렸다가 차례 안에서 판단한 줄 — 등록은 그 자리에서 보내고 끝날 때까지
   * 차례를 잡는다(뒤 줄의 판단이 이 등록을 본다: "15 …" 다음의 "15"는 찾기).
   */
  const handleDecision = useCallback(
    (decision: QuickDecision, line: string, fromFix: boolean, countAt: string, inChain = false): Promise<void> | undefined => {
      /** 개수 칸 → 넘길 재고 (1이면 넘기지 않는다). 칸이 틀렸으면 보내지 않고 알린다 (AC-ORD11-04) */
      const readStock = (): { ok: true; stock: number | undefined } | { ok: false } => {
        const count = readCount(countAt)
        if (count === null) {
          setCountProblem(COUNT_PROBLEM)
          if (!(inChain && typedNext(line))) {
            countInput.current?.focus()
            countInput.current?.select()
          }
          return { ok: false }
        }
        takeCount(countAt)
        return { ok: true, stock: count === 1 ? undefined : count }
      }
      switch (decision.kind) {
        case 'none':
          return undefined
        case 'register': {
          // 붙인 옵션은 이 등록 한 번에 함께 보내고 비운다 (D-O2-05). 옵션 상품은 개수 칸 대신 변형 재고 (AC-ORD11-09)
          const option = attachedRef.current
          const withOptions = option !== null && option.payload.options.length > 0
          const counted = withOptions ? ({ ok: true, stock: undefined } as const) : readStock()
          if (!counted.ok) return undefined
          if (fromFix) setFix(null)
          focusQuick()
          const hooks: RegHooks = {
            ...(option === null ? {} : { extra: option.payload, draftOf: option.draft }),
            ...(counted.stock === undefined ? {} : { stock: counted.stock }),
          }
          if (option !== null) {
            attachedRef.current = null
            setAttached(null)
          }
          setOptionNote(null)
          setResendNote(null)
          if (!inChain) {
            enqueueRegistration(line, decision.no, decision.name, decision.price, fromFix, hooks)
            return undefined
          }
          const id = startRegistration(line, decision.no, decision.name, decision.price, fromFix, hooks)
          return runRegistration(id, true)
        }
        case 'edit': {
          // 개수 칸이 1이 아니면 개수도 함께 묻는다 (AC-ORD11-08). 옵션 상품은 개수 칸을 보지 않는다
          const counted = decision.product.hasOptions ? ({ ok: true, stock: undefined } as const) : readStock()
          if (!counted.ok) return undefined
          if (fromFix) setFix(null)
          // 이미 있는 번호 고치기에는 붙인 옵션을 넣지 않는다 — 떼고 알린다 (D-O2-05 보강)
          dropAttached(decision.product.no)
          askEdit(decision.product, decision.name, decision.price, line, counted.stock)
          return undefined
        }
        case 'open': {
          setFix(null)
          dropAttached(decision.product.no)
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
    [askEdit, clearLine, dropAttached, enqueueRegistration, focusQuick, openDialog, runRegistration, startRegistration, takeCount, typedNext],
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
      // 개수 칸은 Enter를 친 때의 글자로 읽는다 (늦게 판단해도 그 줄의 개수)
      const countAt = countRef.current
      if (regRequests.current.size === 0 && waitingLines.current === 0) {
        void handleDecision(decideQuickInput(line, snapshotSettings, findProduct), line, false, countAt)
        return
      }
      // 앞 줄의 등록이 아직 끝나지 않았다: 그 뒤에 차례대로 판단한다 — "15 …" 바로 뒤의 "15"(찾기)·"15 …"(고치기)가 앞 등록을 본다
      waitingLines.current++
      chain.current = chain.current.then(() => {
        waitingLines.current--
        return handleDecision(decideQuickInput(line, snapshotSettings, findProduct), line, false, countAt, true)
      })
    },
    [findProduct, handleDecision, settings, voice],
  )

  const onFixSubmit = useCallback(() => {
    if (settings === null || fix === null) return
    void handleDecision(decideFixForm(fix, quickSettings(settings), findProduct), fix.line, true, countRef.current)
  }, [findProduct, fix, handleDecision, settings])

  const closeFix = useCallback(() => {
    setFix(null)
    focusQuick()
  }, [focusQuick])

  // ── 단축키 (AC-S05-42, D-087) ────────────────────────────────────────

  // 시간이 지난 보류 찜은 "보류 찜" 수에서 뺀다 (D-MOB2-06) — 바뀌는 순간에 한 번 다시 그린다
  const pendingNow = usePendingNow(data)
  const counts = useMemo(() => alertCounts(data, pendingNow), [data, pendingNow])
  // 이 방송의 확인 필요 (옵션 방송만 — D-O2-03·14). 띠를 누르면 /reviews가 이 방송으로 걸러져 열린다
  const reviews = useReviews(optionMode ? { broadcast: b, rehearsal: broadcast.rehearsal } : null)
  const reviewCount = optionMode ? (reviews.view?.reviews.length ?? 0) : 0
  const openAlert = useCallback((kind: Exclude<AlertKind, 'reviews'>) => setDialogs([kind === 'thanks' ? { kind: 'outbox' } : { kind }]), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return
      const mod = event.ctrlKey || event.metaKey
      if (mod && !event.altKey && !event.shiftKey && (event.code === 'KeyZ' || event.key === 'z' || event.key === 'Z')) {
        const active = document.activeElement
        if (isTextField(active) && active.value !== '') return // 글자가 있는 칸: 브라우저의 글자 되돌리기
        event.preventDefault()
        // 되돌릴 것이 없고 음성 문자찜 결과 카드가 열려 있으면 알림만 (아무것도 보내지 않는다, D-V1-22·AC-V1-33)
        if (queue.undoLatest() === undefined && voice !== null && voice.smsResultShown()) setUndoNote((note) => ({ text: SMS_UNDO_NOTE, n: (note?.n ?? 0) + 1 }))
        return
      }
      if (event.altKey && !mod && (event.code === 'Digit1' || event.key === '1')) {
        event.preventDefault()
        const kind = firstAlert(alertCounts(latest.current.data, Date.now()), printAlertsRef.current, thanksFailed.current)
        if (kind !== null && kind !== 'reviews') openAlert(kind)
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
      // 1·2·3: 맨 앞 음성 카드의 품종 후보 고르기 (U-V2-05) — PC 폭, 창·고치기 칸 없음, 글 칸 밖일 때만(빠른 입력의 번호와 겹치지 않게)
      if (!mod && !event.altKey && !event.shiftKey && (event.key === '1' || event.key === '2' || event.key === '3')) {
        if (voice !== null && wideRef.current && dialogCount.current === 0 && !fixOpen.current && !isTextField(document.activeElement) && voice.chooseCandidateByKey(Number(event.key) - 1)) {
          event.preventDefault()
          return
        }
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
        // 맨 앞 기다리는 문자찜 카드의 "넣지 않기" (D-V1-20): PC 폭·창 없음·고치기 칸 없음·빠른 입력칸이 비었거나 글 칸 밖일 때만
        const active = document.activeElement
        if (voice !== null && wideRef.current && !fixOpen.current && voice.getSnapshot().forms.size === 0 && !(isTextField(active) && active.value !== '') && voice.smsEscape()) {
          event.preventDefault()
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

  // 행동 줄 (방송 목록·상품 목록 가져오기·방송 끝내기 / 끝난 방송: "끝난 방송이에요"·영수증 보내기 / 음성 켜기).
  // PC는 제목 옆, 휴대폰은 채팅 아래 (QL3R1 D-QL3R1-03 — 안의 차례·문장·확인 창 그대로)
  const actions = (
    <div className="row console-actions">
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
        <>
          <p className="ended-note" role="status">
            끝난 방송이에요
          </p>
          {/* 끝난 방송의 할 일 하나 — 영수증 보내기 (N4b AC-N4b-30, D-N4b-04). 방송 중에는 없다 */}
          <a
            className="button button-primary"
            href={routePath({ name: 'receipts', id: b })}
            onClick={(event) => {
              event.preventDefault()
              navigate({ name: 'receipts', id: b })
            }}
          >
            영수증 보내기
          </a>
        </>
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
      {/* 끝난 방송·봉인 날짜에는 "음성 켜기"가 없다 — 켜져 있던 음성의 끄기는 음성 칸에 남는다 (MOB1 D-MOB1-09, AC-MOB1-17) */}
      {voice !== null && !sealed && !ended ? <VoiceToggle voice={voice} snapshot={voiceSnapshot} ready={settings !== null} /> : null}
    </div>
  )
  const rehearsalPanel = broadcast.rehearsal ? (
    <RehearsalPanel
      broadcastId={b}
      generator={snapshot.generator}
      onGenerator={(status) => store.setGenerator(status)}
      onWritten={(result) => void store.sync(result.seq)}
      onOpenBroadcast={(id) => navigate({ name: 'console', id })}
      primary={fix === null && asks.length === 0 && !ended && !sealed}
    />
  ) : null
  const currentProduct = <CurrentProduct product={current} onOpen={(key) => openDialog({ kind: 'product', key })} />
  // 상품 보드·채팅 — PC는 칸 격자 안, 휴대폰은 음성 칸 바로 아래·행동 줄 위 (QL3R1 D-QL3R1-03)
  const board = (
    <ProductBoard
      onOpen={(key) => {
        setSelected(key)
        openDialog({ kind: 'product', key })
      }}
    />
  )
  const chat = (
    <ChatPanel
      messages={snapshot.messages}
      older={snapshot.olderMessages}
      loadingOlder={snapshot.loadingOlder}
      onLoadOlder={() => void store.loadOlder()}
      convertNotes={convertNotes}
      sealedMessage={snapshot.sealedMessage}
      {...(optionMode ? { onReview: () => navigate({ name: 'reviews', broadcast: b, rehearsal: broadcast.rehearsal }) } : {})}
      platformTags={platformTags}
    />
  )

  return (
    <ConsoleContext.Provider value={api}>
      <CautionContext.Provider value={caution}>
      <YoutubeContext.Provider value={yt}>
      <ReadOnlyContext.Provider value={sealed}>
      <main className={broadcast.rehearsal ? 'console console-rehearsal' : 'console'}>
        {broadcast.rehearsal ? (
          // 휴대폰(48rem 미만)은 한 줄 "리허설 · 실제 판매 아님", PC는 옛 문장 — 폭에 맞는 하나만 보이고 읽힌다(숨긴 쪽 display:none) (QL2 D-QL2-13 (1))
          <p className="rehearsal-banner" role="note">
            <span className="rehearsal-banner-wide">리허설 중 — 실제 판매가 아니에요</span>
            <span className="rehearsal-banner-short">리허설 · 실제 판매 아님</span>
          </p>
        ) : null}
        <div ref={headRef} className="console-head">
          <h1 className="console-title">
            {title} <span className="console-date">{dateWords(broadcast.date)}</span>
            {broadcast.rehearsal ? <span className="tag tag-rehearsal">리허설</span> : null}
            {/* 옵션 방송은 판매 방식을 늘 보인다 — 방송 중에는 바꾸지 않는다 (D-O2-02) */}
            {optionMode ? <span className="tag tag-mode">{SALE_MODE_WORD.OPTIONS}</span> : null}
          </h1>
          {wide ? actions : null}
        </div>
        {endError !== null ? <ErrorNote error={endError} /> : null}
        {sealed ? <SealedNotice /> : null}
        {otherVoice !== null ? (
          // 다른 방송에서 듣는 중 (D-V3-52)
          <div className="notice row" role="status">
            <p>{voiceOtherBroadcast(otherVoice.title)}</p>
            <button type="button" className="button" onClick={() => navigate({ name: 'console', id: otherVoice.id })}>
              그 방송으로 가기
            </button>
          </div>
        ) : null}
        {voiceOffNotice && voiceSnapshot.phase === 'off' && !ended && !sealed ? (
          <p className="notice" role="status">
            {VOICE_OFF_AFTER_RELOAD}
          </p>
        ) : null}
        <div className={voiceLive !== null && wide ? 'console-sticky console-sticky-voice' : 'console-sticky'}>
          {/* 휴대폰만: 고정 영역 맨 위(제목·리허설 띠 바로 아래, 알림 띠 위)에 현재 상품 한 줄 요약 — 아래가 늘어나도(알림 펼침·되돌리기 대기·리허설·큰 글씨)
              제목 밑에 남고 스크롤해도 늘 보인다. 누르는 기능이 없어 Tab 차례는 그대로. PC·끝난 방송에는 없다 (QL2 D-QL2-11 (1)·D-QL2-14 (1)) */}
          {wide || ended || sealed ? null : <CurrentSummary product={current} />}
          <LiveNotices snapshot={snapshot} onRetry={() => void store.retryNow()} />
          <CollectorWarningBar
            navigate={navigate}
            ended={ended || sealed}
            extensionConnected={extension.view?.connected === true}
            extensionReceiving={extensionReceiving(extension.view, b)}
            onPaste={openYoutubePaste}
          />
          <ExtensionWarningBar view={extension.view} broadcastId={b} ended={ended || sealed || broadcast.rehearsal} navigate={navigate} />
          <ExtensionThanksBar handle={extension} broadcastId={b} ended={ended || sealed || broadcast.rehearsal} invited={invitedChannelName(yt.link?.link ?? null) !== null} />
          <QuotaToast />
          <div ref={quickBoxRef} className="console-sticky-quick">
            <AlertStrip
              leads={[
                ...platformLeads({ live, sealed, onPaste: openPaste, pasteNote }),
                ...(stationText === null ? [] : [{ key: 'print-station', text: stationText, ...(stationShort === null ? {} : { shortText: stationShort }), soft: true, uncounted: true, onClick: () => navigate({ name: 'labels' }) }]),
              ]}
              counts={counts}
              print={printAlerts}
              thanksFailed={yt.thanksFailed}
              reviews={reviewCount}
              onOpen={(kind) => (kind === 'reviews' ? navigate({ name: 'reviews', broadcast: b, rehearsal: broadcast.rehearsal }) : openAlert(kind))}
              expanded={alertsOpen}
              onToggle={() => setAlertsOpen((open) => !open)}
            />
            {optionMode ? <FocusBanner /> : null}
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
                unitInside={wide}
                closed={ended || sealed}
                {...(attached !== null && attached.payload.options.length > 0
                  ? {}
                  : {
                      count: {
                        value: countText,
                        onChange: (text: string) => {
                          setCountText(text)
                          setCountProblem(null)
                        },
                        problem: countProblem,
                        inputRef: countInput,
                      },
                    })}
                {...(optionMode
                  ? {
                      options: {
                        summary:
                          attached === null
                            ? null
                            : [attached.payload.options.length > 0 ? optionSummary(attached.payload.options) : null, attached.payload.aliases.length > 0 ? `상품 별칭: ${attached.payload.aliases.join(', ')}` : null]
                                .filter((part) => part !== null)
                                .join(' · '),
                        onOpen: () => openDialog({ kind: 'options' }),
                        onClear: () => setAttached(null),
                      },
                    }
                  : {})}
              />
            </Lock>
            <UndoBar items={items} queue={queue} onPick={(pick) => openDialog({ kind: 'succession', pick })} />
            {optionNote !== null ? (
              <p key={optionNote.n} className="notice" role="status" data-tone="warning">
                {optionNote.text}
              </p>
            ) : null}
            {resendNote !== null ? (
              <p key={resendNote.n} className="notice" role="status">
                {resendNote.text}
              </p>
            ) : null}
            {undoNote !== null ? (
              <p key={undoNote.n} className="notice" role="status">
                {undoNote.text}
              </p>
            ) : null}
            {labelsNote !== null ? (
              <p key={labelsNote.n} className="notice labels-note" role="status">
                {labelsNote.text}
              </p>
            ) : null}
          </div>
          {wide ? voiceLive : null}
        </div>
        {wide || ended || sealed ? null : <QuickUnitLine value={quickText} />}
        {/* 휴대폰 차례 (QL3R1 D-QL3R1-03 — D-QL2-01 (1)을 대신함): 고정 영역·단위 줄 → 현재 상품 → 음성 칸 → 상품 보드 → 채팅 → 행동 줄 → 리허설 조작판
            → 여러 플랫폼 안내 → 유튜브 칸 → 인스타그램·틱톡 칸. 방송 중 자주 보는 보드·채팅을 엄지 가까이, 드물게 누르는 "방송 끝내기"는 그 아래. PC는 그대로 */}
        {wide ? null : currentProduct}
        {wide ? null : voiceLive}
        {/* 음성 칸 바로 아래 접는 칸 "음성 설정과 기록" (D-V2-21) — PC는 고정 영역 바로 아래 */}
        {voice === null ? null : <VoiceExtras voice={voice} snapshot={voiceSnapshot} />}
        {wide ? null : board}
        {wide ? null : chat}
        {wide ? null : <div className="console-head console-head-actions">{actions}</div>}
        {wide ? null : rehearsalPanel}
        <div className="console-grid">
          <div className="console-side">
            {wide ? rehearsalPanel : null}
            {wide ? currentProduct : null}
            <MultiPlatformNotice count={live.linkedCount + (youtubeLinked ? 1 : 0)} />
            <YoutubePanel
              navigate={navigate}
              ended={ended}
              sealed={sealed}
              onOpenOutbox={() => openDialog({ kind: 'outbox' })}
              onUnlink={() => openDialog({ kind: 'youtubeUnlink' })}
              route={broadcast.rehearsal ? null : <ExtensionRouteLine collector={yt.link?.collector ?? null} view={extension.view} broadcastId={b} />}
            />
            <PlatformPanels live={live} broadcastId={b} navigate={navigate} ended={ended} sealed={sealed} onPaste={openPaste} />
          </div>
          {wide ? board : null}
          {wide ? chat : null}
        </div>
        {/* 단축키 줄은 PC 폭만 (MOB1 D-MOB1-09, AC-MOB1-15) — 휴대폰에는 키보드 단축키가 없다 */}
        {wide ? <p className="shortcuts">{shortcutsWord(labelsOn === true)}</p> : null}
      </main>
      {voice !== null && voiceSnapshot.phase === 'consent' ? <VoiceConsentDialog voice={voice} /> : null}
      {pasteOpen ? (
        <PasteDialog
          broadcastId={b}
          {...(pasteGuide === undefined ? {} : { guide: pasteGuide })}
          draft={pasteDraft}
          onDraftChange={setPasteDraft}
          onClose={() => setPasteOpen(false)}
          onDone={(message) => {
            setPasteDraft('')
            setPasteOpen(false)
            setPasteNote(message)
          }}
        />
      ) : null}
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
          optionDraft={attached?.draft ?? EMPTY_DRAFT}
          quickPrice={() => {
            if (settings === null) return null
            const decision = decideQuickInput(quickTextRef.current, quickSettings(settings), findProduct)
            return decision.kind === 'register' ? decision.price : null
          }}
          onAttach={(payload, draft) => {
            // 아무것도 넣지 않았으면 붙이지 않는다
            setAttached(payload.options.length === 0 && payload.aliases.length === 0 ? null : { payload, draft })
            setOptionNote(null)
            closeTop()
          }}
        />
      ) : null}
      </ReadOnlyContext.Provider>
      </YoutubeContext.Provider>
      </CautionContext.Provider>
    </ConsoleContext.Provider>
  )
}

interface DialogViewProps {
  readonly optionDraft: OptionDraft
  /** 빠른 입력 줄에서 읽은 가격 (단가를 보인다) */
  readonly quickPrice: () => number | null
  readonly onAttach: (payload: OptionPayload, draft: OptionDraft) => void
  readonly dialog: Dialog
  readonly broadcastId: string
  /** 쓰기 응답 seq까지 화면을 따라잡는다 */
  readonly onSync: (seq: number) => Promise<void>
  readonly messageOf: (id: string) => ChatMessage | undefined
  readonly onClose: () => void
  readonly onEditDone: (product: Product, line: string | null, ask: number | undefined) => void
  readonly onEditUnchanged: (product: Product, ask: number | undefined) => void
}

function DialogView({ dialog, broadcastId, onSync, messageOf, onClose, onEditDone, onEditUnchanged, optionDraft, quickPrice, onAttach }: DialogViewProps) {
  switch (dialog.kind) {
    case 'options':
      return <OptionDialog title="옵션 추가" initial={optionDraft} price={quickPrice()} submitLabel="옵션 넣기" onSubmit={onAttach} onClose={onClose} />
    case 'editOptions':
      return <EditOptionsHost productKey={dialog.product} onClose={onClose} />
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
          {...(dialog.stock === undefined ? {} : { stock: dialog.stock })}
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
      return <SuccessionDialog onClose={onClose} {...(dialog.pick === undefined ? {} : { pick: dialog.pick })} />
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
  const winners = product === undefined ? [] : productSlots(product).winnerClaims.map((id) => api.data.claims.get(id)).filter((claim) => claim !== undefined)
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
