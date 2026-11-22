// 방송 시작 라벨 단계 (D-UX3-19, 사용자 지시 2026-11-03 "링크 붙여넣은 다음에 라벨 프린트 할건지 물어보고 한다 하면 프린터 연결 도와주고
// 연결 확인하고 라벨 디자인 커스텀 한 다음에 테스트 출력한다음에 본방송으로"): 링크를 이은 뒤 방송 화면 전에 한 장씩.
// 1) "라벨을 뽑을까요?" — 설명 + 라벨이 뽑혀 나오는 그림(D-UX4-03). [아니요](왼쪽)는 라벨 출력을 끄고 바로 라이브로, [뽑을게요](오른쪽)는 꺼져 있으면 켠다
//    (D-LBL-ASKNO-01, 사용자 지시 2026-11-23 "왼쪽 버튼 이름을 아니요 … 아니요 누르면 그 라이브 세팅에서 라벨 출력 오프" — 옛 D-LBL-NOPRN-01 [프린터 없이]는 켠 채 대기열에 쌓았다).
//    연결 화면에서 프린터가 아직 안 이어졌으면 [나중에 연결] — 이것도 라벨 출력을 끄고 라이브로. 다시 쓰려면 라이브 관리의 [라벨 출력]을 켠다.
//    단계 사이는 밀어 넘긴다(SlideSwitch — 다음은 오른쪽에서, 뒤로는 왼쪽에서).
// 2) "라벨 프린터를 연결해 주세요" — 전원·블루투스 그림(D-UX4-04). 들어오면 바로 찾기 시작: 기억한 프린터면 고르기 없이 다시 잇고,
//    아니면 주변 프린터 목록을 이 화면에 바로 보인다(찾는 동안 계속 늘어나고, 아무것도 없으면 10초마다 다시 찾음).
//    그림은 왼쪽 휴대폰(블루투스)·오른쪽 프린터(전원)가 이어지는 모습, [새로고침]은 없다(저절로 다시 찾음). 줄을 누르면 이 화면에서 그 줄에
//    "연결하는 중…" → 체크 ✓(글 없이, D-CHECK-02)를 보이고, 이어진 뒤에야 아래 [다음] (D-UX4-10). 라이브 관리에서 연 연결 화면은 [다음]도 없다(D-CHECK-02).
// 3) 라벨 디자인 — 상단 미리보기에서 칸을 고르고 항목·문구·용지 탭에서 편집한다.
//    골라진 칸은 끌어서 옮기고 오른쪽 아래 손잡이로 크기(글자 크기도 같이)를 바꾼다. 앱에는 라벨 그리기 코드가 없어(APP-01 AC3) 서버가 초안을 견본 값으로 그려 준다.
// 4) 출력 기기를 정하고 방송으로 간다. 선택한 테스트 인쇄는 관리 화면에서 연다.
// 단추 둘은 늘 좌우 — 부정 왼쪽, 긍정 오른쪽 (D-UX4-01). 프린터를 '기본·실험'으로 나눠 보이지 않는다.
import { printerProfile, labelSizesForProfileId } from '@livejjim/printer'
import { CAPTION_POSITIONS, CAPTION_SPACE_HINT, CAPTION_TEXT_MAX, CAPTION_WORDS, captionLayout, type LabelCaption } from '@livejjim/label/captions'
import type { ProductDesign, ProductItemId, ProductTemplate, TemplateItem } from '@livejjim/label'
import type { QueueSummary, StoredTemplate, Templates } from '@livejjim/web/src/api/print-types.ts'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ActivityIndicator, Image, PanResponder, View, useWindowDimensions } from 'react-native'
import { get, isApiError, post, put } from '../api/client.ts'
import type { PickEntry } from '@livejjim/mobile-ble'
import { cancelPrinterPick, lastPickedEntry, pickPrinter, useInlinePrinterPick } from '../native/printer-pick.ts'
import { sizeWordMm, testHelp } from '../lib/test-help.ts'
import { RETRY_NOW } from '../lib/words.ts'
import { useServices } from '../services.tsx'
import { BigButton, BottomCTA, BottomSheet, FormPage, HeaderTextButton, LineTab, LineTabs, NavBar, SheetChoices, usePageTop, useWhiteTop, ChoiceCheck, Icon, ListRow, SmallButton, TextField, ToggleRow, Txt, useKit, Tap } from '../ui/kit/index.ts'
import { RADIUS, SPACE, TOUCH } from '../ui/kit/tokens.ts'
import { SlideSwitch } from '../ui/kit/slide.tsx'
import { LabelPrintArt, PrinterConnectArt } from '../ui/LabelArt.tsx'
import { Notice } from '../ui/parts.tsx'
import { DEVICE_NAME_MAX, TEST_QUESTION, replaceQuestion } from './LabelsScreen.tsx'

export const LABEL_ASK_TITLE = '라벨을 뽑을까요?'
/** 설명은 읽기 쉽게 줄을 나눈다 (D-UX4-03, 사용자 지시 2026-11-03 그대로) */
export const LABEL_ASK_BODY = '찜이 확정되면 라벨 프린터로 바로 출력해요.\n상품 번호, 가격, 구매자 이름 등을 기록할 수 있어서\n나중에 포장할 때 헷갈리지 않아요.'
/** 왼쪽 단추 — 라벨 출력을 끄고 라이브로 (D-LBL-ASKNO-01) */
export const LABEL_ASK_NO = '아니요'
/** 연결 화면에서 아직 프린터가 안 이어졌을 때 넘어가기 — 라벨 출력을 끈다 (D-LBL-ASKNO-01) */
export const CONNECT_LATER = '나중에 연결'
export const CONNECT_TITLE = '라벨 프린터를 연결해 주세요'
/** 휴대폰 블루투스를 켜라는 것을 분명히 (D-UX4-10, 사용자 지시 2026-11-05) */
export const CONNECT_BODY = '프린터 전원을 켜고 휴대폰 가까이 두세요.\n휴대폰 블루투스가 켜져 있어야 해요.'
export const TEST_TITLE = '테스트 라벨을 뽑아 볼까요?'
/** 테스트는 골라서 (D-UX4-11) */
export const TEST_BODY = '뽑아 보면 프린터와 라벨이 잘 맞는지 알 수 있어요.\n테두리와 한글이 있는 테스트 라벨이 한 장 나와요.'
/** 출력 기기 이름 (라벨 화면 기본과 같다) */
const DEVICE_NAME = '내 휴대폰'
/** 아무 프린터도 못 찾으면 다시 찾는 간격 (D-UX4-04) */
export const RESCAN_MS = 10_000
/** 라벨 칸 이름과 차례 (번호·닉네임은 늘 찍힌다 — L-3 PRODUCT_LOCKED) */
export const ITEM_WORDS: Readonly<Record<ProductItemId, string>> = { shop: '가게 이름', number: '번호', price: '가격', date: '날짜', name: '품종', buyer: '닉네임' }
const ITEM_ORDER: readonly ProductItemId[] = ['shop', 'number', 'price', 'date', 'name', 'buyer']
/** 가격 표기 (앱 예시 30만원 — D-UX4-03, 만원 단위 D-UX4-07) */
const PRICE_STYLES = ['TEN_THOUSAND', 'THOUSAND', 'WON'] as const
const PRICE_WORDS: Readonly<Record<ProductTemplate['priceStyle'], string>> = {
  TEN_THOUSAND: '30만원',
  THOUSAND: '300 천원',
  WON: '300,000원',
}

// 앱은 라벨 실행 코드를 가져오지 않는다(APP-01 AC3) — 칸을 고칠 때 필요한 숫자만 LABEL_RULES 그대로 옮겨 둔다. 저장 때 서버가 다시 검사한다.
/** 글자 크기 범위 (L-5, 점) */
export const FONT_SIZE_MIN = 16
export const FONT_SIZE_MAX = 120
/** 끌 수 없는 칸 (L-3) */
const PRODUCT_LOCKED: readonly ProductItemId[] = ['number', 'buyer']

/** 라벨 크기의 mm·점 (L-1: 50mm 라벨 = 폭 min(폭×8, 384)·높이×8, 테이프 tape<폭>x<길이> = 길이×8 · 96). 모르는 글이면 null */
export function labelDots(size: string): { readonly widthMm: number; readonly heightMm: number; readonly widthDots: number; readonly heightDots: number } | null {
  const tape = /^tape(\d+)x(\d+)$/.exec(size)
  if (tape !== null) return { widthMm: Number(tape[2]), heightMm: Number(tape[1]), widthDots: Number(tape[2]) * 8, heightDots: 96 }
  const label = /^(\d+)x(\d+)$/.exec(size)
  if (label === null) return null
  const widthMm = Number(label[1])
  const heightMm = Number(label[2])
  return { widthMm, heightMm, widthDots: Math.min(widthMm * 8, 384), heightDots: heightMm * 8 }
}

const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), Math.max(low, high))

/** 칸 옮기기: 라벨 밖으로 나가지 않게 (점 단위 정수 — L-5) */
export function movedItem(item: TemplateItem, dx: number, dy: number, labelW: number, labelH: number): TemplateItem {
  return { ...item, x: clamp(Math.round(item.x + dx), 0, labelW - item.width), y: clamp(Math.round(item.y + dy), 0, labelH - item.height) }
}

/** 칸 크기 바꾸기: 상자를 키우면 글자 크기도 높이만큼 같이 (16~120점) */
export function resizedItem(item: TemplateItem, dw: number, dh: number, labelW: number, labelH: number): TemplateItem {
  const width = clamp(Math.round(item.width + dw), 24, labelW - item.x)
  const height = clamp(Math.round(item.height + dh), 20, labelH - item.y)
  const fontSize = clamp(Math.round((item.fontSize * height) / item.height), FONT_SIZE_MIN, FONT_SIZE_MAX)
  return { ...item, width, height, fontSize, minFontSize: Math.min(item.minFontSize, fontSize) }
}

/** 글자 크기 한 단계: 커지면 상자 높이도 글자가 들어가게 (라벨 안에서) */
export function fontStepped(item: TemplateItem, delta: number, labelH: number): TemplateItem {
  const fontSize = clamp(item.fontSize + delta, FONT_SIZE_MIN, FONT_SIZE_MAX)
  const height = clamp(Math.max(item.height, Math.ceil(fontSize * 1.25)), 1, labelH - item.y)
  return { ...item, fontSize, height, minFontSize: Math.min(item.minFontSize, fontSize) }
}

/** 라벨 크기는 작은 것부터 (넓이 → 폭) */
export function sortedSizes(sizes: readonly string[]): string[] {
  const area = (size: string): [number, number] => {
    const info = labelDots(size)
    return info === null ? [Number.MAX_SAFE_INTEGER, 0] : [info.widthMm * info.heightMm, info.widthMm]
  }
  return [...sizes].sort((a, b) => {
    const [aa, aw] = area(a)
    const [ba, bw] = area(b)
    return aa - ba || aw - bw
  })
}

type Step = 'ask' | 'connect' | 'design' | 'test' | 'device'

interface DraftPreview {
  readonly template: ProductTemplate
  readonly width: number
  readonly height: number
  readonly png: string
  readonly longest: string | null
}

const errorText = (caught: unknown): string => (isApiError(caught) ? caught.message : '하지 못했어요. 다시 눌러 주세요.')

/** 라벨 프린트 화면에서 한 단계만 다시 할 때 (D-UX4-80): 프린터 연결 · 라벨 디자인 · 테스트 인쇄 */
export type LabelSetupStep = 'connect' | 'design' | 'test'

/** only: 그 단계 하나만 — 뒤로는 onBack, 끝나면 onDone (방송 시작 때 하지 않았어도 방송 관리 → 라벨 프린트에서 다시 한다) */
export function LabelSetupScreen({ onBack, onDone, only }: { readonly onBack: () => void; readonly onDone: () => void; readonly only?: LabelSetupStep }) {
  const { labels } = useServices()
  const snapshot = useSyncExternalStore(labels.subscribe, labels.getSnapshot)
  const [step, setStep] = useState<Step>(only ?? 'ask')
  /** 뒤로 가는 넘김인가 — 밀어 넘기는 방향 */
  const [back, setBack] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (work: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }
  const setLabels = async (enabled: boolean) => {
    if (snapshot.queue?.labelsEnabled === enabled) return
    await put('/api/settings/labels', { enabled })
    await labels.reload()
  }
  const go = (next: Step, backward = false) => {
    setError(null)
    setBack(backward)
    setStep(next)
  }
  /** 라벨 출력을 끄고 라이브로 — [아니요]·[나중에 연결] (D-LBL-ASKNO-01) */
  const skipLabels = () =>
    void run(async () => {
      await setLabels(false)
      onDone()
    })
  const errorLine =
    error === null ? null : (
      <Notice tone="danger" alert>
        {error}
      </Notice>
    )

  return (
    <SlideSwitch id={step} back={back} testID="label-setup">
      {page()}
    </SlideSwitch>
  )

  function page() {
  if (step === 'ask') {
    return (
      <FormPage
        title={LABEL_ASK_TITLE}
        name="라벨"
        onBack={onBack}
        testID="label-setup-ask"
        actions={
          <>
            <BigButton kind="outline" label={LABEL_ASK_NO} disabled={busy} onPress={skipLabels} />
            <BigButton label="뽑을게요" busy={busy} onPress={() => void run(async () => {
              await setLabels(true)
              go('connect')
            })} />
          </>
        }
      >
        <Txt step="bodyLarge" color="textSub">
          {LABEL_ASK_BODY}
        </Txt>
        {errorLine}
        <LabelPrintArt />
      </FormPage>
    )
  }
  // 라이브 관리 > 프린터 연결(only)로 열면 이어져도 아래 단추가 없다 — 뒤로 ‹로 돌아간다 (D-CHECK-02, 사용자 지시 "다음 버튼이 왜 있어 걍 아무것도 없애")
  if (step === 'connect') return <ConnectStep onBack={() => (only === undefined ? go('ask', true) : onBack())} busy={busy} error={errorLine} {...(only === undefined ? { onNext: () => go('design'), onLater: skipLabels } : {})} />
  if (step === 'design') return <DesignStep saveLabel={only === undefined ? '저장하고 다음' : '저장'} queue={snapshot.queue} profileId={snapshot.profileId} onBack={() => (only === undefined ? go('connect', true) : onBack())} onSaved={() => (only === undefined && !snapshot.mine ? go('device') : onDone())} />
  return <TestStep selectDevice={step === 'device'} busy={busy} run={run} onBack={() => (only === undefined ? go('design', true) : onBack())} onDone={onDone} error={errorLine} />
  }
}

/** 2) 프린터 연결과 확인 — 들어오면 바로 찾고, 찾은 프린터를 이 화면에 줄로 (D-UX4-04). 고른 줄에서 바로 연결 확인, 이어지면 [다음] (D-UX4-10) */
function ConnectStep({ onBack, onNext, onLater, busy = false, error = null }: { readonly onBack: () => void; readonly onNext?: () => void; readonly onLater?: () => void; readonly busy?: boolean; readonly error?: React.ReactNode }) {
  const { labels } = useServices()
  const { p } = useKit()
  const snapshot = useSyncExternalStore(labels.subscribe, labels.getSnapshot)
  const found = useInlinePrinterPick()
  const linked = snapshot.printer === 'CONNECTED' || snapshot.printer === 'PRINTING'
  const name = linked ? ((snapshot.profileId === null ? undefined : printerProfile(snapshot.profileId))?.displayName ?? (snapshot.target === 'test' ? '시험용 프린터' : '라벨 프린터')) : null
  const attempt = useRef<Promise<void> | null>(null)
  /** 판매자가 고른 줄 — 고르면 찾기 목록이 닫혀도 그 줄은 남겨 연결 상태를 보인다 */
  const [picked, setPicked] = useState<PickEntry | null>(null)

  /** 찾기 시작 — 기억한 프린터면 고르기 없이 다시 잇고, 아니면 주변 프린터를 찾는다 (label-queue reconnect) */
  const start = useCallback(() => {
    if (attempt.current !== null) return
    attempt.current = labels.reconnect().finally(() => {
      attempt.current = null
    })
  }, [labels])
  /** 지금 찾기를 그만두고 처음부터 다시 (아무것도 못 찾았을 때 잠깐마다) */
  const refresh = useCallback(async () => {
    cancelPrinterPick()
    await attempt.current
    start()
  }, [start])
  const useTest = async () => {
    cancelPrinterPick()
    await attempt.current
    await labels.connect('test')
  }
  const choose = (entry: PickEntry) => {
    setPicked(entry)
    pickPrinter(entry.device)
  }

  // 들어오면 바로 찾는다 (이미 잇는 중이거나 이어져 있으면 그대로)
  useEffect(() => {
    if (labels.getSnapshot().printer === 'DISCONNECTED') start()
  }, [labels, start])
  // 아무것도 못 찾으면 잠깐마다 다시 찾는다 — 찾은 것이 있으면 찾기가 이어지며 목록이 저절로 늘어난다. 고른 줄을 잇는 동안은 기다린다
  const nothingYet = !linked && picked === null && (found === null || found.length === 0)
  useEffect(() => {
    if (!nothingYet) return
    const timer = setInterval(() => {
      if (labels.getSnapshot().printer !== 'CONNECTED') void refresh()
    }, RESCAN_MS)
    return () => clearInterval(timer)
  }, [nothingYet, labels, refresh])

  // 그만둔 고르기(NOT_SELECTED)는 판매자가 한 일이 아니라 다시 찾는 중이라 보이지 않는다
  const problem = snapshot.printerError !== null && snapshot.printerError.code !== 'NOT_SELECTED' && !linked ? snapshot.printerError.message : null
  // 고른 프린터로 잇지 못하면 고른 줄을 풀고 다시 찾는다
  useEffect(() => {
    if (problem !== null && snapshot.printer === 'DISCONNECTED') setPicked(null)
  }, [problem, snapshot.printer])

  // 이미 이어진 채로 들어왔다(나갔다 다시 들어옴) — 고를 때 본 그 줄 하나로 ✓ 연결됐어요. 옛: 회색 "연결됐어요" 상자로 모양이 달랐다 (D-CHECK-01)
  // 이 앱이 켜진 뒤 고른 줄이 없으면(저절로 다시 이음) 프린터 이름 줄. 시험용 프린터는 고른 블루투스 줄을 쓰지 않는다
  const last = snapshot.target === 'test' ? null : lastPickedEntry()
  const kept: PickEntry | null = !linked || picked !== null ? null : last ?? { device: { id: 'linked', name: name ?? '' }, title: name ?? '라벨 프린터', model: '', signal: null, experimental: false, detail: '' }
  const rows = found !== null && found.length > 0 ? found : picked !== null ? [picked] : kept !== null ? [kept] : []
  const stateOf = (entry: PickEntry) => (kept !== null && entry.device.id === kept.device.id ? 'done' : picked === null || picked.device.id !== entry.device.id ? null : linked ? 'done' : 'busy')
  return (
    <FormPage title={CONNECT_TITLE} name="프린터 연결" onBack={onBack} testID="label-setup-connect" actions={linked ? (onNext === undefined ? null : <BigButton label="다음" onPress={onNext} />) : onLater !== undefined ? <BigButton kind="outline" label={CONNECT_LATER} disabled={busy} onPress={onLater} /> : null}>
      <Txt step="bodyLarge" color="textSub">
        {CONNECT_BODY}
      </Txt>
      <PrinterConnectArt />
      {(
        <View role="group" aria-label="주변 프린터" style={{ gap: SPACE.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
            <Txt step="caption" weight="bold" color="textSub">
              주변 프린터
            </Txt>
            {linked ? null : <ActivityIndicator size="small" color={p.textSub} />}
          </View>
          {rows.length === 0 ? (
            <Txt color="textSub">가까운 프린터를 찾고 있어요…</Txt>
          ) : (
            rows.map((entry) => {
              const state = stateOf(entry)
              const right =
                state === 'done' ? (
                  // 글 없이 표준 체크만 (D-CHECK-02, 사용자 지시 "연결됐어요 문구 없애고 그냥 체크 표시만") — 읽어 주기에는 "연결됐어요"
                  <View role="status" aria-label="연결됐어요">
                    <ChoiceCheck />
                  </View>
                ) : state === 'busy' ? (
                  <View role="status" style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.xs }}>
                    <ActivityIndicator size="small" color={p.textSub} />
                    <Txt color="textSub">연결하는 중…</Txt>
                  </View>
                ) : undefined
              // 고른 뒤에는 다른 줄을 눌러도 바꾸지 않는다 — 잇는 중에 또 고르면 꼬인다
              const onPress = picked === null && !linked ? () => choose(entry) : undefined
              return <ListRow key={entry.device.id} title={entry.title} {...(entry.detail === '' ? {} : { subtitle: entry.detail })} ariaLabel={entry.detail === '' ? entry.title : `${entry.title} — ${entry.detail}`} right={right} onPress={onPress} />
            })
          )}
        </View>
      )}
      {snapshot.testPrinter && !linked ? <SmallButton label="시험용 프린터" onPress={() => void useTest()} /> : null}
      {problem !== null ? (
        <Notice tone="danger" alert>
          {problem}
        </Notice>
      ) : null}
      {error}
    </FormPage>
  )
}

/** 3) 라벨 디자인 (D-UX4-130, 옛 "라벨 꾸미기") — 서버가 그린 초안 미리 보기를 위에 붙여 두고, 라벨 안 칸을 눌러 고르고·옮기고·키운다 (D-UX4-05) */
function DesignStep({ queue, profileId, saveLabel, onBack, onSaved }: { readonly saveLabel: string; readonly queue: QueueSummary | null; readonly profileId: string | null; readonly onBack: () => void; readonly onSaved: () => void }) {
  const [stored, setStored] = useState<StoredTemplate<ProductTemplate> | null>(null)
  const [draft, setDraft] = useState<ProductTemplate | null>(null)
  const [preview, setPreview] = useState<DraftPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [picked, setPicked] = useState<ProductItemId | null>(null)
  const [changingLayout, setChangingLayout] = useState(false)
  const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const asked = useRef(0)
  const [tab, setTab] = useState<DesignTab>('항목')
  const [itemId, setItemId] = useState<ProductItemId>('number')
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [notePage, setNotePage] = useState(0)
  const [editing, setEditing] = useState<'shop' | 'note' | null>(null)
  const top = usePageTop()
  const { width: screenWidth, height: screenHeight } = useWindowDimensions()
  useWhiteTop()
  const { p } = useKit()

  const load = () => {
    setError(null)
    get<Templates>('/api/print/templates').then(
      (view) => {
        setStored(view.product)
        // 가게 이름 칸은 저장된 본문 그대로 (비어 있으면 가게 설정의 이름을 따른다 — D-FB1-07)
        setDraft({ ...view.product.template, shopName: view.product.storedShopName ?? '' })
      },
      (caught: unknown) => setError(errorText(caught)),
    )
  }
  useEffect(load, [])

  /** 초안을 서버에 보내 그림을 받는다 (크기를 바꾸면 서버가 그 크기의 칸 배치로 고친 초안도 준다) */
  const draw = (template: ProductTemplate, resize?: string, design?: ProductDesign) => {
    clearTimeout(previewTimer.current)
    const layoutChange = resize !== undefined || design !== undefined
    if (layoutChange) setChangingLayout(true)
    const ticket = ++asked.current
    post<DraftPreview>('/api/print/templates/product/preview', { template, resize, design }).then(
      (view) => {
        if (ticket !== asked.current) return
        setPreview(view)
        setError(null)
        if (layoutChange) {
          setChangingLayout(false)
          setDraft(view.template)
        }
      },
      (caught: unknown) => {
        if (ticket === asked.current) {
          setChangingLayout(false)
          setPreview(null)
          setError(errorText(caught))
        }
      },
    )
  }
  // 칠 때·끌 때마다가 아니라 잠깐 멈춘 뒤에 그린다
  useEffect(() => {
    if (draft === null) return
    previewTimer.current = setTimeout(() => draw(draft), 250)
    return () => { clearTimeout(previewTimer.current); asked.current++ }
  }, [draft])

  const listed = queue?.labelSizes
  const sizes = sortedSizes(listed !== undefined && listed.length > 0 ? listed : labelSizesForProfileId(profileId))
  const dots = draft === null ? null : labelDots(draft.size)
  const crowded = draft !== null && dots !== null && captionLayout(draft.captions ?? [], dots.widthDots, dots.heightDots).bodyHeight < dots.heightDots / 2
  const save = async () => {
    if (draft === null || stored === null || saving || crowded) return
    setSaving(true)
    setError(null)
    try {
      await put('/api/print/templates/product', { template: draft, version: stored.version })
      onSaved()
    } catch (caught) {
      // 다른 기기에서 먼저 바꿨으면(판 충돌) 새로 읽어 다시 고르게 한다
      if (isApiError(caught) && caught.status === 409) load()
      setError(errorText(caught))
    } finally {
      setSaving(false)
    }
  }
  const setItem = (id: ProductItemId, item: TemplateItem) => setDraft((now) => (now === null ? now : { ...now, items: { ...now.items, [id]: item } }))
  const paperWidth = Math.min(500, screenWidth - SPACE.xxl * 2)
  const workspaceHeight = dots === null ? 160 : paperWidth * dots.heightDots / dots.widthDots + SPACE.xxxl * 2
  const activeItem = draft?.items[itemId]
  const notes = draft?.captions ?? []
  const noteIndex = Math.max(0, Math.min(notePage, notes.length - 1))
  const note = notes[noteIndex]
  const pickTab = (next: DesignTab) => {
    setTab(next)
    setPicked(null)
  }
  const pickItem = (id: ProductItemId | null) => {
    setPicked(id)
    if (id !== null) {
      setItemId(id)
      setTab('항목')
    }
  }
  const setNotes = (captions: readonly LabelCaption[]) => setDraft((now) => now === null ? now : { ...now, captions: [...captions] })
  const editNote = (patch: Partial<LabelCaption>) => setNotes(notes.map((entry, i) => i === noteIndex ? { ...entry, ...patch } : entry))
  const editTitle = editing === 'shop' ? '가게 이름' : `문구 ${noteIndex + 1}`

  return (
    <View role="dialog" aria-label="라벨 디자인" testID="label-setup-design" style={{ flex: 1, paddingTop: top, backgroundColor: p.surface }}>
      <NavBar title="라벨 디자인" onBack={onBack} right={<HeaderTextButton label="템플릿" onPress={() => { if (draft !== null && !changingLayout && !saving) setTemplatesOpen(true) }} />} />
      <View testID="label-workspace" style={{ height: workspaceHeight, flexShrink: 1, minHeight: 0, backgroundColor: p.background }}>
        {draft !== null && dots !== null ? <LabelEditor draft={draft} preview={preview} widthDots={dots.widthDots} heightDots={dots.heightDots} picked={picked} onPick={pickItem} onItem={setItem} disabled={changingLayout || saving} /> : error === null ? <ActivityIndicator style={{ flex: 1 }} color={p.primary} /> : null}
      </View>
      {crowded ? <Notice tone="warning" alert>{CAPTION_SPACE_HINT}</Notice> : preview?.longest ? <Notice tone="warning">{preview.longest}</Notice> : null}
      {error !== null ? <Notice tone="danger" alert>{error}</Notice> : null}
      {error !== null && draft === null ? <SmallButton label={RETRY_NOW} onPress={load} /> : null}
      {draft !== null && dots !== null && activeItem !== undefined ? (
        <View pointerEvents={changingLayout || saving ? 'none' : 'auto'} style={{ flexGrow: 1, paddingHorizontal: SPACE.lg, paddingBottom: SPACE.sm }}>
          {/* 라이브 화면과 같은 밑줄 글자 탭 (D-TABS-01 — 옛: 칸을 나눠 채운 초록 밑줄 탭) */}
          <LineTabs label="라벨 설정" bleed={SPACE.lg}>
            {DESIGN_TABS.map((name) => (
              <LineTab key={name} label={name} on={tab === name} onPress={() => pickTab(name)} />
            ))}
          </LineTabs>
          <View role="tabpanel" aria-label={tab} style={{ gap: SPACE.sm, paddingTop: SPACE.md, minHeight: Math.min(218, screenHeight * 0.3) }}>
            {tab === '용지' ? (
              <>
                <Txt weight="bold">라벨 크기</Txt>
                <OptionGrid label="라벨 크기" values={sizes} columns={3} selected={draft.size} word={sizeWordMm} onPick={(size) => draw(draft, size)} />
              </>
            ) : tab === '항목' ? (
              <>
                <OptionGrid label="라벨 항목" values={ITEM_ORDER} columns={3} selected={itemId} word={(id) => ITEM_WORDS[id]} onPick={pickItem} />
                <View role="group" aria-label={`${ITEM_WORDS[itemId]} 설정`} style={{ gap: SPACE.xs }}>
                  {PRODUCT_LOCKED.includes(itemId) ? null : <ToggleRow title="찍기" on={activeItem.visible} rowHeight={44} onChange={(on) => setItem(itemId, { ...activeItem, visible: on })} />}
                  {activeItem.visible && itemId === 'shop' ? <EditTextButton label="가게 이름" value={draft.shopName || '가게 설정 이름 사용'} onPress={() => setEditing('shop')} /> : null}
                  {activeItem.visible && itemId === 'price' ? <OptionGrid label="가격 표기" values={PRICE_STYLES} columns={3} selected={draft.priceStyle} word={(style) => PRICE_WORDS[style]} onPick={(priceStyle) => setDraft({ ...draft, priceStyle })} /> : null}
                  {activeItem.visible ? <FontStepper word={ITEM_WORDS[itemId]} size={activeItem.fontSize} onStep={(delta) => setItem(itemId, fontStepped(activeItem, delta, dots.heightDots))} /> : null}
                </View>
              </>
            ) : (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.xs }}>
                  {notes.length > 0 ? <>
                    <PageArrow next={false} disabled={noteIndex === 0} onPress={() => setNotePage(noteIndex - 1)} />
                    <Txt weight="medium">{`${noteIndex + 1} / ${notes.length}`}</Txt>
                    <PageArrow next disabled={noteIndex + 1 >= notes.length} onPress={() => setNotePage(noteIndex + 1)} />
                  </> : null}
                  <View style={{ flex: 1 }} />
                  {note !== undefined ? <SmallButton label="삭제" onPress={() => { setNotes(notes.filter((_, i) => i !== noteIndex)); setNotePage(Math.max(0, noteIndex - 1)) }} /> : null}
                  <SmallButton label="문구 추가" onPress={() => { setNotes([...notes, { text: '', position: CAPTION_POSITIONS[notes.length % CAPTION_POSITIONS.length] ?? 'topRight' }]); setNotePage(notes.length); setEditing('note') }} />
                </View>
                {note !== undefined ? <>
                  <EditTextButton label={`문구 ${noteIndex + 1}`} value={note.text || '내용 입력'} onPress={() => setEditing('note')} />
                  <OptionGrid label={`문구 ${noteIndex + 1} 위치`} values={NOTE_CORNERS} columns={2} selected={note.position} word={(position) => CAPTION_WORDS[position]} onPick={(position) => editNote({ position })} />
                </> : null}
              </>
            )}
          </View>
        </View>
      ) : null}
      <BottomCTA><BigButton label={saveLabel} busy={saving} disabled={draft === null || changingLayout || crowded} onPress={() => void save()} /></BottomCTA>
      <BottomSheet title="템플릿" visible={templatesOpen} onClose={() => setTemplatesOpen(false)}>
        <SheetChoices label="기본 디자인" choices={DESIGNS} value={draft?.design ?? 'basic'} onPick={(design) => { setTemplatesOpen(false); setPicked(null); if (draft !== null && !changingLayout) draw(draft, undefined, design) }} />
      </BottomSheet>
      <BottomSheet title={editTitle} visible={editing !== null} onClose={() => setEditing(null)} actions={<BigButton label="완료" onPress={() => setEditing(null)} />}>
        {editing !== null && draft !== null ? <TextField autoFocus label={editTitle} maxLength={editing === 'shop' ? 40 : CAPTION_TEXT_MAX} value={editing === 'shop' ? draft.shopName : note?.text ?? ''} onChangeText={(text) => editing === 'shop' ? setDraft({ ...draft, shopName: text }) : editNote({ text })} returnKeyType="done" onSubmitEditing={() => setEditing(null)} /> : null}
      </BottomSheet>
    </View>
  )
}

const DESIGN_TABS = ['항목', '문구', '용지'] as const
type DesignTab = (typeof DESIGN_TABS)[number]
const DESIGNS = [{ value: 'basic', label: '기본형' }, { value: 'large', label: '큰 글씨형' }, { value: 'table', label: '표형' }] as const
const NOTE_CORNERS = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const

function PageArrow({ next, disabled, onPress }: { readonly next: boolean; readonly disabled: boolean; readonly onPress: () => void }) {
  const { p } = useKit()
  return <Tap role="button" aria-label={next ? '다음 문구' : '이전 문구'} disabled={disabled} onPress={onPress} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.3 : 1 }}>
    <View style={{ transform: [{ rotate: next ? '0deg' : '180deg' }] }}><Icon name="chevron" color={p.textSub} size={18} /></View>
  </Tap>
}

function EditTextButton({ label, value, onPress }: { readonly label: string; readonly value: string; readonly onPress: () => void }) {
  const { p } = useKit()
  return <Tap role="button" aria-label={`${label} 편집`} onPress={onPress} style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: SPACE.md, flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, backgroundColor: pressed ? p.pressed : p.surfaceAlt, borderRadius: RADIUS.sm, borderCurve: 'continuous' })}>
    <Txt step="meta" color="textSub">{label}</Txt><View style={{ flex: 1 }}><Txt right numberOfLines={1}>{value}</Txt></View><Icon name="chevron" size={16} color={p.textSub} />
  </Tap>
}

function OptionGrid<T extends string>({ label, values, columns, selected, word, onPick }: { readonly label: string; readonly values: readonly T[]; readonly columns: number; readonly selected: T; readonly word: (value: T) => string; readonly onPick: (value: T) => void }) {
  return <View role="radiogroup" aria-label={label} style={{ gap: SPACE.xs }}>
    {Array.from({ length: Math.ceil(values.length / columns) }, (_, index) => {
      const row = values.slice(index * columns, (index + 1) * columns)
      return <View key={index} style={{ flexDirection: 'row', gap: SPACE.xs }}>
        {row.map((value) => <View key={value} style={{ flex: 1 }}><Choice word={word(value)} on={value === selected} onPress={() => onPick(value)} /></View>)}
        {row.length < columns ? <View style={{ flex: columns - row.length }} /> : null}
      </View>
    })}
  </View>
}

/** 글자 크기 − 숫자 + */
function FontStepper({ word, size, onStep }: { readonly word: string; readonly size: number; readonly onStep: (delta: number) => void }) {
  const { p } = useKit()
  const key = (sign: string, delta: number, name: string, off: boolean) => (
    <Tap role="button" aria-label={`${word} 글자 ${name}`} aria-disabled={off} disabled={off} onPress={() => onStep(delta)} style={({ pressed }) => ({ width: TOUCH.min, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: pressed ? p.softPressed : p.surfaceAlt, opacity: off ? 0.45 : 1 })}>
      <Txt step="bodyLarge" weight="bold">
        {sign}
      </Txt>
    </Tap>
  )
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, minHeight: TOUCH.min }}>
      <View style={{ flex: 1 }}>
        <Txt step="bodyLarge" weight="medium">
          글자 크기
        </Txt>
      </View>
      {key('−', -2, '작게', size <= FONT_SIZE_MIN)}
      <View style={{ minWidth: 36, alignItems: 'center' }}>
        <Txt weight="bold" aria-label={`${word} 글자 크기 ${String(size)}`}>
          {String(size)}
        </Txt>
      </View>
      {key('+', 2, '크게', size >= FONT_SIZE_MAX)}
    </View>
  )
}

/**
 * 크게 연 라벨 미리 보기 + 칸 고르기·옮기기·크기 (D-UX4-05). 칸 자리는 템플릿 점(8점 = 1mm)을 화면 폭에 맞춰 그린다.
 * 칸을 누르면 골라지고, 고른 칸은 끌면 옮겨지고 오른쪽 아래 동그라미를 끌면 크기가 바뀐다.
 */
function LabelEditor({ draft, preview, widthDots, heightDots, picked, onPick, onItem, disabled }: {
  readonly draft: ProductTemplate
  readonly preview: DraftPreview | null
  readonly widthDots: number
  readonly heightDots: number
  readonly picked: ProductItemId | null
  readonly onPick: (id: ProductItemId | null) => void
  readonly onItem: (id: ProductItemId, item: TemplateItem) => void
  readonly disabled: boolean
}) {
  const { p } = useKit()
  const [stage, setStage] = useState({ width: 0, height: 0 })
  const width = Math.max(0, Math.min(stage.width - SPACE.xxl * 2, (stage.height - SPACE.lg * 2) * widthDots / heightDots, 500))
  const scale = width / widthDots
  const { top, bodyHeight } = captionLayout(draft.captions ?? [], widthDots, heightDots)
  const bodyScaleY = scale * Math.max(0, bodyHeight) / heightDots
  const pickedItem = picked === null ? null : draft.items[picked]
  return (
    <View onLayout={({ nativeEvent: { layout } }) => setStage((now) => now.width === layout.width && now.height === layout.height ? now : { width: layout.width, height: layout.height })} pointerEvents={disabled ? 'none' : 'auto'} style={{ flex: 1, alignItems: 'center', paddingTop: SPACE.lg }}>
      <View aria-label="라벨 미리 보기" style={{ width, height: width * heightDots / widthDots, overflow: 'hidden', backgroundColor: '#FFFFFF' }}>
        {preview !== null ? <Image accessible={false} accessibilityIgnoresInvertColors source={{ uri: `data:image/png;base64,${preview.png}` }} resizeMode="stretch" style={{ width: '100%', height: '100%', position: 'absolute' }} /> : <ActivityIndicator style={{ flex: 1 }} color={p.primary} />}
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: top * scale, height: Math.max(0, bodyHeight) * scale }}>
        {ITEM_ORDER.filter((id) => draft.items[id].visible).map((id) => {
          const item = draft.items[id]
          const on = picked === id
          return (
            <Tap
              key={id}
              role="button"
              aria-label={`라벨의 ${ITEM_WORDS[id]}`}
              aria-pressed={on}
              onPress={() => onPick(id)}
              style={{ position: 'absolute', left: item.x * scale, top: item.y * bodyScaleY, width: item.width * scale, height: item.height * bodyScaleY, borderRadius: 4, borderCurve: 'continuous', borderWidth: on ? 2 : 0, borderColor: p.primary, backgroundColor: on ? 'rgba(31,122,77,0.08)' : 'transparent' }}
            />
          )
        })}
        {picked !== null && pickedItem !== null && pickedItem.visible && bodyScaleY > 0 ? (
          <ItemHandles key={picked} item={pickedItem} scale={scale} scaleY={bodyScaleY} widthDots={widthDots} heightDots={heightDots} onTap={() => onPick(null)} onChange={(next) => onItem(picked, next)} />
        ) : null}
        </View>
      </View>
    </View>
  )
}

/** 고른 칸 위의 끌기 자리와 크기 손잡이 (손가락 움직임 → 점 단위) */
function ItemHandles({ item, scale, scaleY, widthDots, heightDots, onTap, onChange }: {
  readonly item: TemplateItem
  readonly scale: number
  readonly scaleY: number
  readonly widthDots: number
  readonly heightDots: number
  readonly onTap: () => void
  readonly onChange: (item: TemplateItem) => void
}) {
  const { p } = useKit()
  const latest = useRef({ item, scale, scaleY, widthDots, heightDots, onTap, onChange })
  latest.current = { item, scale, scaleY, widthDots, heightDots, onTap, onChange }
  const start = useRef(item)
  const make = (kind: 'move' | 'size') =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        start.current = latest.current.item
      },
      onPanResponderMove: (_, gesture) => {
        const k = latest.current.scale
        if (k <= 0) return
        const dx = gesture.dx / k
        const dy = gesture.dy / latest.current.scaleY
        latest.current.onChange(kind === 'move' ? movedItem(start.current, dx, dy, latest.current.widthDots, latest.current.heightDots) : resizedItem(start.current, dx, dy, latest.current.widthDots, latest.current.heightDots))
      },
      onPanResponderRelease: (_, gesture) => {
        if (kind === 'move' && Math.abs(gesture.dx) < 4 && Math.abs(gesture.dy) < 4) latest.current.onTap()
      },
    })
  const mover = useRef(make('move')).current
  const sizer = useRef(make('size')).current
  const knob = 22
  return (
    <>
      <View {...mover.panHandlers} aria-hidden style={{ position: 'absolute', left: item.x * scale, top: item.y * scaleY, width: item.width * scale, height: item.height * scaleY }} />
      <View
        {...sizer.panHandlers}
        aria-hidden
        hitSlop={12}
        style={{ position: 'absolute', left: (item.x + item.width) * scale - knob / 2, top: (item.y + item.height) * scaleY - knob / 2, width: knob, height: knob, borderRadius: knob / 2, borderCurve: 'continuous', backgroundColor: p.primary, borderWidth: 3, borderColor: '#FFFFFF' }}
      />
    </>
  )
}

function Choice({ word, on, onPress }: { readonly word: string; readonly on: boolean; readonly onPress: () => void }) {
  const { p } = useKit()
  return (
    <Tap role="radio" aria-checked={on} aria-label={word} onPress={onPress} style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: SPACE.xs, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.sm, borderCurve: 'continuous', borderWidth: on ? 2 : 1, borderColor: on ? p.primary : p.border, backgroundColor: pressed ? p.pressed : on ? p.freshBg : p.surface })}>
      <Txt step="meta" center numberOfLines={1} adjustsFontSizeToFit weight={on ? 'bold' : 'medium'} color={on ? 'primaryText' : 'text'}>
        {word}
      </Txt>
    </Tap>
  )
}

/** 4) 테스트 인쇄 → "예"면 이 기기를 출력 기기로 하고 방송으로 */
function TestStep({ selectDevice, busy, run, onBack, onDone, error }: { readonly selectDevice: boolean; readonly busy: boolean; readonly run: (work: () => Promise<void>) => Promise<void>; readonly onBack: () => void; readonly onDone: () => void; readonly error: React.ReactNode }) {
  const { labels } = useServices()
  const snapshot = useSyncExternalStore(labels.subscribe, labels.getSnapshot)
  const [answeredNo, setAnsweredNo] = useState(false)
  const [taken, setTaken] = useState<string | null>(null)
  const linked = snapshot.printer === 'CONNECTED' || snapshot.printer === 'PRINTING'
  const help = testHelp(snapshot.profileId, snapshot.testSize ?? '50x30')

  /** 이 기기를 출력 기기로 (이미 그렇다면 그대로) 하고 방송으로 */
  const finish = (replace: boolean) =>
    void run(async () => {
      if (!snapshot.mine) {
        const outcome = await labels.become(DEVICE_NAME.slice(0, DEVICE_NAME_MAX), replace)
        if (outcome.kind === 'taken') {
          setTaken(outcome.name)
          return
        }
        if (outcome.kind === 'error') throw outcome.error
      }
      onDone()
    })
  const yes = () => {
    labels.answerTest(true)
    finish(false)
  }
  // 테스트 인쇄 중 표시는 snapshot.testing이 맡는다 — 결과를 묻는 동안 [예]가 막히지 않게 run(바쁨)으로 감싸지 않는다
  const printTest = () => {
    setAnsweredNo(false)
    void labels.printTest()
  }

  if (selectDevice || taken !== null) {
    return <FormPage title="출력 기기" name="출력 기기" onBack={onBack} actions={<>
      <BigButton kind="outline" label={taken ? '그대로 두기' : '나중에 하기'} disabled={busy} onPress={onDone} />
      <BigButton label={taken ? '이 기기로 바꾸기' : '이 기기에서 출력'} busy={busy} onPress={() => finish(taken !== null)} />
    </>}>
      <Txt>{taken !== null ? replaceQuestion(taken) : '이 휴대폰에서 상품 라벨을 출력할까요?'}</Txt>
      {error}
    </FormPage>
  }
  return (
    <FormPage
      title={TEST_TITLE}
      name="테스트 인쇄"
      onBack={onBack}
      testID="label-setup-test"
      actions={
        snapshot.testPrinted && !answeredNo ? (
          <>
            <BigButton kind="outline" label="아니요" disabled={busy} onPress={() => {
              setAnsweredNo(true)
              labels.answerTest(false)
            }} />
            <BigButton label="예" busy={busy} onPress={yes} />
          </>
        ) : (
          <>
            {answeredNo ? (
              <BigButton kind="outline" label="나중에 하기" ariaLabel="라벨은 나중에 하고 라이브 시작" disabled={busy} onPress={onDone} />
            ) : (
              <BigButton kind="outline" label="닫기" disabled={busy || snapshot.testing} onPress={onDone} />
            )}
            <BigButton label={answeredNo ? '다시 인쇄' : '테스트 인쇄'} ariaLabel={answeredNo ? '다시 테스트 인쇄' : '테스트 인쇄'} busy={busy || snapshot.testing} disabled={!linked || snapshot.busy || snapshot.job !== null} onPress={printTest} />
          </>
        )
      }
    >
      {snapshot.testPrinted && !answeredNo ? (
        <Txt step="bodyLarge" weight="bold">
          {TEST_QUESTION}
        </Txt>
      ) : (
        <Txt step="bodyLarge" color="textSub">
          {TEST_BODY}
        </Txt>
      )}
      {!linked ? <Notice tone="warning">프린터 연결이 끊겼어요. 뒤로 가서 다시 연결해 주세요.</Notice> : null}
      {answeredNo ? (
        <View role="list" aria-label="테스트 인쇄 도움말" style={{ gap: SPACE.xs }}>
          {help.lines.map((line) => (
            <View key={line} role="listitem">
              <Txt>{`· ${line}`}</Txt>
            </View>
          ))}
        </View>
      ) : null}
      {snapshot.printerError !== null ? (
        <Notice tone="danger" alert>
          {snapshot.printerError.message}
        </Notice>
      ) : null}
      {error}
    </FormPage>
  )
}
