// 우체국 창구소포 간편사전접수 — 앱 안 화면 자동 입력 (EP1 PARCEL_RULES PC-9, D-EP1-01~D-EP1-19).
// 흐름: 서버에서 채울 값을 받는다 → 우체국 화면(모바일 소포 입구)을 앱 안에 연다 → 판매자가 로그인 또는 비회원 약관 동의 → 신청서가 나오면 칸을 저절로 채운다
//      (우체국 입력 완료로 적는다) → 판매자가 확인하고 [접수신청]을 직접 누른다 → 완료 화면의 접수번호를 찾아 보이고, 판매자가 확인하면 주문에 잇는다.
// - 여러 주문을 한 번에 (D-EP1-19): 받는 분을 채움 → 우체국 [다음](받는 분 목록에 더함) → [받는 분 추가](칸 비움) → 다음 받는 분 … 을 앱이 이어서 한다.
//   [필수동의] 우편금지물품 확인 체크와 결제·[접수신청]은 판매자가 한다. 신청서가 받지 않으면(알림 문장) 멈추고 문장을 보인다 — [이어서 넣기]로 다시.
// - 배송지는 우체국 호스트 쪽에만 넣는다. 전에 입력만 하고 끝난 주문이면 먼저 우체국 신청 내역을 보라고 묻는다(두 번 신청하지 않게).
import { useCallback, useEffect, useRef, useState } from 'react'
import { ScrollView, TextInput, View } from 'react-native'
import type { EpostFillView, ParcelDay, ParcelRow } from '@livejjim/web/src/api/parcel-types.ts'
import { get, isApiError, newRequestId, post, withQuery, withRetry, type ApiError } from '../api/client.ts'
import { copyToClipboard } from '../lib/clipboard.ts'
import { SLOT_WORDS, addScript, commitScript, fillScript, isEpostUrl, passwordScript, popupShimScript, readAgentMessage, receiptCandidates, receiptScript, type AgentMessage } from '../lib/epost-agent.ts'
import { useAppForeground } from '../lib/use-app-state.ts'
import { RETRY_NOW } from '../lib/words.ts'
import { nativeWebSession } from '../native/index.ts'
import { EpostView, type EpostViewHandle } from '../native/epost-view.tsx'
import { AppHeader, BigButton, BottomSheet, ButtonRow, ConfirmSheet, SmallButton, Txt, useKit } from '../ui/kit/index.ts'
import { RADIUS, SPACE } from '../ui/kit/tokens.ts'
import { font } from '../ui/kit/font.ts'
import { Loading, Notice, Tag } from '../ui/parts.tsx'

export const EPOST_TITLE = '우체국 사전접수'
/** 우체국 로그인 세션을 지키는 도메인·시간 (EP1 D-EP1-17): 앱을 다시 켜도 이 시간 안이면 세션 쿠키를 되살린다. 우체국 서버가 세션을 이미 끝냈으면 로그인 화면이 나올 뿐이다 */
export const EPOST_SESSION_DOMAIN = 'epost.go.kr'
export const EPOST_SESSION_MAX_AGE_S = 24 * 60 * 60
/** 한 번에 넣는 받는 분 상한 (D-EP1-19) */
export const EPOST_BATCH_MAX = 50
export const EPOST_STEP_START = '우체국 화면에서 로그인하거나 비회원으로 약관에 동의해 주세요. 신청서가 나오면 칸을 저절로 채워요.'
export const EPOST_STEP_FILLED = '칸을 채웠어요. 우체국 화면에서 [다음]으로 받는 분 목록에 넣고, 중량·크기를 확인한 뒤 [접수신청]은 직접 눌러 주세요.'
export const EPOST_READONLY_NOTE = '주소 찾기는 하지 않아도 돼요. 우체국 [주소검증]이 이 주소를 확인해요. 주소 찾기를 쓰면 상세 주소가 바뀌니 [상세 주소 복사]로 다시 넣어 주세요.'
/** 비회원 신청 비밀번호 (EP1 D-EP1-14) */
export const EPOST_PASSWORD_FILLED = '신청 비밀번호를 넣었어요.'
// 모바일 소포 신청서는 보내는 분 휴대전화가 없으면 [다음]을 받지 않는다 (2026-11-08 실제 화면 — D-EP1-19)
// 받는 분 우편번호를 서버도 찾지 못했을 때 (외진 곳 범위 번지 등 — D-EP1-22). 우체국 신청서는 우편번호가 비면 받지 않는다
export const EPOST_ZIP_MISSING = '받는 분 우편번호를 찾지 못했어요. 우체국 화면의 받는 분 [주소찾기]에서 주소를 고르고, 범위(예: 985~1141)가 나오면 번지를 넣어 주세요.'
export const EPOST_SENDER_MOBILE = '우체국은 보내는 분 휴대전화를 꼭 받아요. 가게 설정의 보내는 사람 전화가 휴대전화가 아니라서, 우체국 화면의 보내는 분 휴대전화 칸에 직접 넣어 주세요.'
// 보내는 분 주소를 신청서에 넣지 못했을 때 (우체국 회원 정보에 주소가 없는 계정 — D-EP1-20)
export const EPOST_SENDER_ADDRESS = '보내는 분 주소를 넣지 못했어요. 우체국 화면의 보내는 분 [수정]을 눌러 주소를 넣어 주세요.'
export const EPOST_PASSWORD_UNSET = '가게 설정 → 택배에서 우체국 신청 비밀번호를 적어 두면 비회원 신청 때 앱이 넣어 드려요.'
export const EPOST_DUP_QUESTION = '전에 이 주문을 우체국 화면에 입력했어요'
/** 내용품을 끝내 못 채웠을 때 */
export const EPOST_ITEM_NOTE = '내용품은 우체국 화면의 [내용품 종류 선택]에서 골라 주세요. 예: 직접 입력 → 식물'
export const EPOST_DUP_DESCRIPTION = '신청까지 했는지 우체국 신청 내역에서 먼저 확인해 주세요. 두 번 신청하면 소포가 두 번 접수돼요.'
export const RECEIPT_TITLE = '접수번호 잇기'
export const RECEIPT_HELP = '우체국 신청을 마친 화면에 나온 접수번호를 확인해 주세요. 이 주문에 이어 두면 우체국에 갈 때 찾기 쉬워요.'
/** 여러 명 한 번에 (D-EP1-19) */
export const BATCH_AGREE = '우체국 화면 위 [필수동의] 우편금지물품 안내 확인에 체크한 뒤 [이어서 넣기]를 눌러 주세요.'
export const BATCH_NOTFOUND = '이 우체국 화면에서는 받는 분을 이어서 넣을 수 없어요. 우체국 화면에서 [다음]·[받는 분 추가]를 직접 눌러 주세요.'
export const BATCH_REFUSED = '우체국 화면이 이 받는 분을 받지 않았어요. 우체국 화면의 칸을 고친 뒤 [이어서 넣기]를 눌러 주세요.'
export const BATCH_DONE = '받는 분을 모두 우체국 목록에 넣었어요. 우체국 화면 아래에서 [접수신청]까지 직접 해 주세요.'

type Stage = 'loading' | 'error' | 'web' | 'done'
/** 여러 명 넣기 단계: 채우는 중 → [다음] 누름 → [받는 분 추가] 누름 → (다음 사람 채우는 중) … → 끝. 멈춤 = 판매자 손이 필요 */
type BatchPhase = 'fill' | 'commit' | 'add' | 'paused' | 'finished'

/** 접수를 마친 뒤 다음으로 보낼 주문 (고를 수 있고, 우체국 기록이 없는 것) */
function nextRow(day: ParcelDay, current: readonly string[]): ParcelRow | null {
  return day.ready.find((row) => !current.includes(row.buyer) && (row.epost ?? null) === null) ?? null
}

/** 우체국 세션 쿠키를 기기 키체인에 둔다 (아이폰만 — 실패해도 화면은 그대로) */
async function saveSession(): Promise<void> {
  try {
    await (await nativeWebSession())?.save(EPOST_SESSION_DOMAIN)
  } catch {
    // 무시
  }
}

export interface EpostNavigation {
  readonly onBack: () => void
  /** 다음 주문 우체국 사전접수 */
  readonly openNext?: (buyer: string) => void
}

export function EpostScreen({ date, buyers, nav }: { readonly date: string; readonly buyers: readonly string[]; readonly nav: EpostNavigation }) {
  const { p } = useKit()
  const [views, setViews] = useState<readonly EpostFillView[]>([])
  const [skipped, setSkipped] = useState<readonly string[]>([])
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [stage, setStage] = useState<Stage>('loading')
  const [askDup, setAskDup] = useState(false)
  const [report, setReport] = useState<Extract<AgentMessage, { type: 'fill' }> | null>(null)
  const [candidates, setCandidates] = useState<readonly string[]>([])
  const [sheet, setSheet] = useState(false)
  const [receipt, setReceipt] = useState('')
  const [receiptError, setReceiptError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [linked, setLinked] = useState<string | null>(null)
  const [next, setNext] = useState<ParcelRow | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [passwordFilled, setPasswordFilled] = useState(false)
  /** 지금 채우는 받는 분 (views의 차례) */
  const [index, setIndex] = useState(0)
  const [committed, setCommitted] = useState<readonly number[]>([])
  const [phase, setPhase] = useState<BatchPhase>('fill')
  const [problem, setProblem] = useState<{ readonly text: string; readonly messages: readonly string[] } | null>(null)
  const web = useRef<EpostViewHandle>(null)
  /** 이 화면에서 저절로 채우기를 했는지 (쪽이 바뀔 때마다 다시 채워 판매자가 고친 값을 덮지 않게 — 한 번만) */
  const autoFilled = useRef(false)
  /** 입력을 멈춤 (전에 입력한 주문이라 신청 내역부터 볼 때) */
  const paused = useRef(false)
  const marked = useRef<Set<string>>(new Set())
  // 웹 화면 답은 비동기로 오므로 지금 값을 ref로도 둔다
  const state = useRef({ views: [] as readonly EpostFillView[], index: 0, phase: 'fill' as BatchPhase })
  state.current = { views, index, phase }
  /** 우체국 로그인 세션을 되살린 뒤에 우체국 화면을 연다 (EP1 D-EP1-17) */
  const [sessionReady, setSessionReady] = useState(false)
  const batch = views.length > 1
  const buyersKey = buyers.join(',')

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        await (await nativeWebSession())?.restore(EPOST_SESSION_DOMAIN, EPOST_SESSION_MAX_AGE_S)
      } catch {
        // 되살리지 못하면 그냥 로그인 화면 — 막지 않는다
      }
      if (alive) setSessionReady(true)
    })()
    return () => {
      alive = false
      void saveSession()
    }
  }, [])
  useAppForeground({ onBackground: () => void saveSession() })

  useEffect(() => {
    let alive = true
    setStage('loading')
    void (async () => {
      const loaded: EpostFillView[] = []
      const left: string[] = []
      let first: ApiError | null = null
      for (const id of buyersKey.split(',').slice(0, EPOST_BATCH_MAX)) {
        try {
          loaded.push(await get<EpostFillView>(withQuery(`/api/parcels/days/${date}/epost`, { buyer: id })))
        } catch (caught: unknown) {
          if (!isApiError(caught)) throw caught
          first ??= caught
          left.push(caught.message)
        }
      }
      if (!alive) return
      if (loaded.length === 0) {
        setError(first)
        setStage('error')
        return
      }
      setViews(loaded)
      setSkipped(left)
      setError(null)
      setStage('web')
      if (loaded.some((item) => item.row.epost?.state === 'FILLED')) {
        paused.current = true
        setAskDup(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [date, buyersKey, attempt])

  const mark = useCallback(
    async (buyer: string, action: 'FILLED' | 'RECEIVED', receiptNo?: string): Promise<ParcelRow> => {
      const requestId = newRequestId()
      const response = await withRetry(() => post<{ row: ParcelRow }>(`/api/parcels/days/${date}/epost`, { requestId, buyer, action, ...(receiptNo === undefined ? {} : { receiptNo }) }))
      return response.row
    },
    [date],
  )

  const markFilled = (buyer: string) => {
    if (marked.current.has(buyer)) return
    marked.current.add(buyer)
    // 입력 완료 (실패해도 화면은 그대로 — 다음에 열 때 다시 적는다)
    void mark(buyer, 'FILLED').catch(() => {
      marked.current.delete(buyer)
    })
  }

  const fillNow = useCallback(() => {
    const view = state.current.views[state.current.index]
    if (view === undefined) return
    web.current?.inject(fillScript(view))
  }, [])

  const commitNow = () => {
    const view = state.current.views[state.current.index]
    if (view === undefined) return
    setProblem(null)
    setPhase('commit')
    state.current.phase = 'commit'
    web.current?.inject(commitScript(view))
  }

  const onLoaded = (url: string) => {
    const view = state.current.views[state.current.index]
    if (view === undefined || !isEpostUrl(url, view.hosts)) return
    // 쪽마다 우체국 세션 쿠키를 기기 키체인에 둔다 (앱이 갑자기 꺼져도 마지막 것이 남게)
    void saveSession()
    // 쪽 읽기 전에 넣지 못한 경우를 위해 한 번 더 (두 번 넣어도 한 번만 바꾼다)
    web.current?.inject(popupShimScript(view.hosts))
    // 비회원 신청 비밀번호 칸 (빈 칸에만)
    if (typeof view.password === 'string' && view.password !== '') web.current?.inject(passwordScript(view.password, view.form.password, view.hosts))
    if (!autoFilled.current && !paused.current) fillNow()
    web.current?.inject(receiptScript(view.form.receiptWords, view.hosts))
  }

  const onMessage = (data: string) => {
    const { views: list, index: at, phase: now } = state.current
    const view = list[at]
    if (view === undefined) return
    const message = readAgentMessage(data)
    if (message === null) return
    if (message.type === 'password') {
      if (message.filled > 0) setPasswordFilled(true)
      return
    }
    if (message.type === 'fill') {
      setReport(message)
      if (message.filled.length === 0) return
      autoFilled.current = true
      if (list.length === 1) {
        markFilled(view.buyer)
        return
      }
      // 여러 명: 받는 분을 채웠으면 [다음]으로 목록에 넣는다 (이 사람에 한 번만 — 늦게 채운 칸의 답이 또 와도)
      if (now === 'fill' && message.filled.includes('receiver.name')) commitNow()
      return
    }
    if (message.type === 'commit') {
      if (now !== 'commit') return
      if (!message.ok) {
        setPhase('paused')
        const text = message.reason === 'agree' ? BATCH_AGREE : message.reason === 'notfound' ? BATCH_NOTFOUND : BATCH_REFUSED
        setProblem({ text, messages: message.reason === 'refused' ? message.messages : [] })
        return
      }
      markFilled(view.buyer)
      setCommitted((done) => (done.includes(at) ? done : [...done, at]))
      if (at + 1 >= list.length) {
        setPhase('finished')
        // 받는 분 목록 단계에 나오는 비회원 신청 비밀번호 칸
        if (typeof view.password === 'string' && view.password !== '') web.current?.inject(passwordScript(view.password, view.form.password, view.hosts))
        return
      }
      setPhase('add')
      state.current.phase = 'add'
      web.current?.inject(addScript(view))
      return
    }
    if (message.type === 'added') {
      if (now !== 'add') return
      if (!message.ok) {
        setPhase('paused')
        setProblem({ text: BATCH_NOTFOUND, messages: [] })
        return
      }
      const following = list[at + 1]
      if (following === undefined) return
      setIndex(at + 1)
      setPhase('fill')
      setReport(null)
      state.current = { views: list, index: at + 1, phase: 'fill' }
      web.current?.inject(fillScript(following))
      return
    }
    if (message.type === 'receipt') {
      const found = receiptCandidates(message.lines, view.form.receiptWords)
      if (found.length > 0 && linked === null) setCandidates(found)
    }
  }

  /** 접수번호를 이을 주문: 여러 명이면 목록에 넣은 사람들(없으면 모두), 한 명이면 그 사람 */
  const linkTargets = (): readonly EpostFillView[] => (batch && committed.length > 0 ? committed.map((at) => views[at]).filter((item): item is EpostFillView => item !== undefined) : views)

  const openSheet = (value: string) => {
    setReceipt(value)
    setReceiptError(null)
    setSheet(true)
  }

  const link = async () => {
    if (busy) return
    setBusy(true)
    setReceiptError(null)
    try {
      let number = receipt
      for (const target of linkTargets()) number = (await mark(target.buyer, 'RECEIVED', receipt)).epost?.receiptNo ?? number
      setLinked(number)
      setSheet(false)
      setStage('done')
      try {
        setNext(
          nextRow(
            await get<ParcelDay>(`/api/parcels/days/${date}`),
            views.map((item) => item.buyer),
          ),
        )
      } catch {
        setNext(null)
      }
    } catch (caught: unknown) {
      if (!isApiError(caught)) throw caught
      setReceiptError(caught.problems[0]?.message ?? caught.message)
    } finally {
      setBusy(false)
    }
  }

  const copy = async (label: string, text: string) => {
    setCopied((await copyToClipboard(text)) ? `${label}를 복사했어요.` : '복사하지 못했어요. 길게 눌러 직접 골라 주세요.')
  }

  const view = views[index] ?? null

  if (stage === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: p.background }} testID="epost-screen">
        <AppHeader title={EPOST_TITLE} onBack={nav.onBack} />
        <Loading />
      </View>
    )
  }

  if (stage === 'error' || view === null) {
    return (
      <View style={{ flex: 1, backgroundColor: p.background }} testID="epost-screen">
        <AppHeader title={EPOST_TITLE} onBack={nav.onBack} />
        <View style={{ padding: SPACE.md, gap: SPACE.sm }}>
          <Notice tone="danger" alert>
            {error?.message ?? '우체국 화면을 열지 못했어요.'}
          </Notice>
          <ButtonRow>
            <BigButton kind="secondary" label="목록으로" onPress={nav.onBack} />
            {error === null || error.status !== 409 ? <BigButton label={RETRY_NOW} onPress={() => setAttempt((n) => n + 1)} /> : null}
          </ButtonRow>
        </View>
      </View>
    )
  }

  const receiver = view.fill.receiver
  const phone = (receiver.mobile ?? receiver.phone ?? []).join('-')
  const address = [receiver.zip, receiver.address].filter((part) => part !== '').join(' ')

  if (stage === 'done') {
    const targets = linkTargets()
    const who = targets.length === 1 ? `${targets[0]?.row.name ?? ''}님 주문을` : `주문 ${String(targets.length)}개를`
    return (
      <View style={{ flex: 1, backgroundColor: p.background }} testID="epost-screen">
        <AppHeader title={EPOST_TITLE} onBack={nav.onBack} />
        <View style={{ padding: SPACE.md, gap: SPACE.md }}>
          <Notice tone="success">{`${who} 우체국 사전접수 완료로 적었어요. 접수번호 ${linked ?? ''}`}</Notice>
          <Txt color="textSub">우체국 창구에 갈 때 이 접수번호나 휴대전화 번호를 알려 주면 돼요.</Txt>
          <ButtonRow>
            <BigButton kind="secondary" label="목록으로" onPress={nav.onBack} />
            {next !== null && nav.openNext !== undefined ? <BigButton label={`다음: ${next.name}`} ariaLabel={`다음 주문 ${next.name} 우체국 사전접수`} onPress={() => nav.openNext?.(next.buyer)} /> : null}
          </ButtonRow>
        </View>
      </View>
    )
  }

  const filledCount = report?.filled.length ?? 0
  // 신청서를 찾았을 때만(칸을 하나라도 채웠을 때) 못 채운 칸·가릴 수 없는 칸을 보인다 — 약관 쪽에서 모든 칸을 '못 채움'으로 보이지 않게 (D-EP1-15)
  const formFound = report !== null && report.filled.length > 0
  const missing = formFound ? report.missing.filter((slot) => !slot.startsWith('sender.')) : []
  const step = batch ? (phase === 'finished' ? BATCH_DONE : filledCount > 0 || committed.length > 0 ? `받는 분 ${String(views.length)}명을 차례로 우체국 목록에 넣고 있어요.` : EPOST_STEP_START) : filledCount > 0 ? EPOST_STEP_FILLED : EPOST_STEP_START

  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID="epost-screen">
      <AppHeader title={EPOST_TITLE} onBack={nav.onBack} />
      <ScrollView style={{ maxHeight: 170, flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: SPACE.md, paddingBottom: SPACE.sm, gap: SPACE.xs }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs, alignItems: 'center' }}>
          <Txt weight="bold">{batch ? `${String(index + 1)}/${String(views.length)} · ${view.row.name}` : view.row.name}</Txt>
          <Txt step="caption" color="textSub">{`물품 ${String(view.fill.qty)}개 · 내용품 ${view.fill.item}`}</Txt>
          {batch ? <Tag tone={phase === 'finished' ? 'success' : 'info'}>{`목록에 ${String(committed.length)}명`}</Tag> : filledCount > 0 ? <Tag tone="success">{`칸 ${String(filledCount)}개 채움`}</Tag> : null}
        </View>
        <Txt step="caption">{step}</Txt>
        {skipped.length > 0 ? <Txt step="caption" color="dangerText">{`${String(skipped.length)}개 주문은 빼고 넣어요: ${skipped.join(' · ')}`}</Txt> : null}
        {problem !== null ? (
          <View style={{ gap: SPACE.xs }}>
            <Txt step="caption" color="dangerText">
              {problem.text}
            </Txt>
            {problem.messages.map((text) => (
              <Txt key={text} step="caption" color="textSub">{`우체국: ${text}`}</Txt>
            ))}
          </View>
        ) : null}
        {view.fill.receiver.zip === '' ? (
          <Txt step="caption" color="dangerText">
            {EPOST_ZIP_MISSING}
          </Txt>
        ) : null}
        {view.fill.sender.mobile === null ? (
          <Txt step="caption" color="dangerText">
            {EPOST_SENDER_MOBILE}
          </Txt>
        ) : null}
        {passwordFilled ? (
          <Txt step="caption" color="textSub">
            {EPOST_PASSWORD_FILLED}
          </Txt>
        ) : null}
        {filledCount === 0 && (view.password ?? null) === null ? (
          <Txt step="caption" color="textSub">
            {EPOST_PASSWORD_UNSET}
          </Txt>
        ) : null}
        {formFound && report.readonly.some((slot) => slot.startsWith('receiver.')) ? (
          <Txt step="caption" color="textSub">
            {EPOST_READONLY_NOTE}
          </Txt>
        ) : null}
        {formFound && report.missing.some((slot) => slot === 'sender.zip' || slot === 'sender.address') ? (
          <Txt step="caption" color="dangerText">
            {EPOST_SENDER_ADDRESS}
          </Txt>
        ) : null}
        {missing.length > 0 ? <Txt step="caption" color="dangerText">{`못 채운 칸: ${missing.map((slot) => SLOT_WORDS[slot]).join(', ')}`}</Txt> : null}
        {missing.includes('item') ? <Txt step="caption">{EPOST_ITEM_NOTE}</Txt> : null}
        {formFound && report.ambiguous.length > 0 ? <Txt step="caption" color="dangerText">{`받는 분·보내는 분을 가릴 수 없어 비워 둔 칸: ${report.ambiguous.map((slot) => SLOT_WORDS[slot]).join(', ')}`}</Txt> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs }}>
          <SmallButton label="이름 복사" onPress={() => void copy('이름', receiver.name)} />
          <SmallButton label="주소 복사" onPress={() => void copy('주소', address)} />
          {receiver.detail !== '' ? <SmallButton label="상세 주소 복사" onPress={() => void copy('상세 주소', receiver.detail)} /> : null}
          <SmallButton label="연락처 복사" onPress={() => void copy('연락처', phone)} />
        </View>
        {copied !== null ? (
          <Txt step="caption" color="textSub">
            {copied}
          </Txt>
        ) : null}
        {candidates.length > 0 ? (
          <View style={{ gap: SPACE.xs, padding: SPACE.sm, borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: p.surface }}>
            <Txt weight="bold">{`접수번호를 찾았어요: ${candidates[0] ?? ''}`}</Txt>
            <BigButton label="이 번호로 잇기" ariaLabel={`접수번호 ${candidates[0] ?? ''} 잇기`} onPress={() => openSheet(candidates[0] ?? '')} />
          </View>
        ) : null}
      </ScrollView>

      <View style={{ flex: 1, borderTopWidth: 1, borderColor: p.outline }}>
        {sessionReady ? <EpostView ref={web} url={view.pages.apply} beforeLoad={popupShimScript(view.hosts)} onMessage={onMessage} onLoaded={onLoaded} testID="epost-web" /> : <Loading />}
      </View>

      <View style={{ paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm, borderTopWidth: 1, borderColor: p.outline, backgroundColor: p.background }}>
        <ButtonRow>
          {batch && phase === 'paused' ? (
            <BigButton kind="secondary" label="이어서 넣기" onPress={commitNow} />
          ) : (
            <BigButton
              kind="secondary"
              label="칸 다시 채우기"
              onPress={() => {
                paused.current = false
                if (batch && phase !== 'finished') {
                  setPhase('fill')
                  state.current.phase = 'fill'
                }
                fillNow()
              }}
            />
          )}
          <BigButton label={RECEIPT_TITLE} onPress={() => openSheet(candidates[0] ?? '')} />
        </ButtonRow>
      </View>

      <ConfirmSheet
        visible={askDup}
        question={EPOST_DUP_QUESTION}
        description={EPOST_DUP_DESCRIPTION}
        cancelLabel="신청 내역 보기"
        confirmLabel="새로 입력하기"
        onCancel={() => {
          setAskDup(false)
          web.current?.load(view.pages.history)
        }}
        onConfirm={() => {
          setAskDup(false)
          paused.current = false
          fillNow()
        }}
      />

      <BottomSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        title={RECEIPT_TITLE}
        actions={
          <>
            <BigButton kind="secondary" label="닫기" onPress={() => setSheet(false)} />
            <BigButton label="잇기" busy={busy} disabled={receipt.trim() === ''} onPress={() => void link()} />
          </>
        }
      >
        <Txt color="textSub">{batch ? `${RECEIPT_HELP} 목록에 넣은 주문 ${String(linkTargets().length)}개에 같은 번호를 이어요.` : RECEIPT_HELP}</Txt>
        <TextInput
          aria-label="접수번호"
          value={receipt}
          onChangeText={(text) => {
            setReceipt(text)
            setReceiptError(null)
          }}
          autoCapitalize="characters"
          autoCorrect={false}
          inputMode="text"
          placeholder="예: 6012345678901"
          style={{ minHeight: 52, borderBottomWidth: 2, borderColor: receiptError === null ? p.outline : p.danger, fontSize: 20, ...font(), color: p.text }}
        />
        {receiptError !== null ? <Txt color="dangerText">{receiptError}</Txt> : null}
      </BottomSheet>
    </View>
  )
}
