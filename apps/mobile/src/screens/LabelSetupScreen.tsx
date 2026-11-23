// 방송 시작 라벨 단계 (D-UX3-19, 사용자 지시 2026-11-03 "링크 붙여넣은 다음에 라벨 프린트 할건지 물어보고 한다 하면 프린터 연결 도와주고
// 연결 확인하고 라벨 디자인 커스텀 한 다음에 테스트 출력한다음에 본방송으로"): 링크를 이은 뒤 방송 화면 전에 한 장씩.
// 1) "라벨을 뽑을까요?" — 설명 + 라벨이 뽑혀 나오는 그림(D-UX4-03). [아니요](왼쪽)는 라벨 출력을 끄고 바로 라이브로, [뽑을게요](오른쪽)는 꺼져 있으면 켠다
//    (D-LBL-ASKNO-01, 사용자 지시 2026-11-23 "왼쪽 버튼 이름을 아니요 … 아니요 누르면 그 라이브 세팅에서 라벨 출력 오프" — 옛 D-LBL-NOPRN-01 [프린터 없이]는 켠 채 대기열에 쌓았다).
//    연결 화면에서 프린터가 아직 안 이어졌으면 [나중에 연결] — 이것도 라벨 출력을 끄고 라이브로. 다시 쓰려면 라이브 관리의 [라벨 출력]을 켠다.
//    단계마다 따로 쌓이는 화면이다 (D-LABEL-ROUTE-01, 사용자 지시 2026-11-23 "라벨 프린터를 연결해 주세요 화면은 왜 별도 화면이 아니라 그 전 화면이랑
//    같은걸로 되어있어? 별도 화면으로 분리해") — 다음은 경로를 하나 더 쌓고(openStep), 뒤로(머리 ‹ · 왼쪽 끝 밀기 · 안드로이드 뒤로)는 아래 화면으로.
//    옛: 한 경로 안에서 밀어 넘겼다(SlideSwitch) — 휴대폰에는 화면 하나라 밀어서 뒤로 가면 라벨 단계를 통째로 나갔다.
// 2) "라벨 프린터를 연결해 주세요" — 전원·블루투스 그림(D-UX4-04). 들어오면 바로 찾기 시작: 기억한 프린터면 고르기 없이 다시 잇고,
//    아니면 주변 프린터 목록을 이 화면에 바로 보인다(찾는 동안 계속 늘어나고, 아무것도 없으면 10초마다 다시 찾음).
//    그림은 왼쪽 휴대폰(블루투스)·오른쪽 프린터(전원)가 이어지는 모습, [새로고침]은 없다(저절로 다시 찾음). 줄을 누르면 이 화면에서 그 줄에
//    "연결하는 중…" → 체크 ✓(글 없이, D-CHECK-02)를 보이고, 이어진 뒤에야 아래 [다음] (D-UX4-10). 라이브 관리에서 연 연결 화면은 [다음]도 없다(D-CHECK-02).
// 3) 라벨 디자인 — 상단 미리보기에서 칸을 고르고 용지·스타일·문구 탭에서 편집한다 (D-LABEL-TABS-01).
//    골라진 칸은 끌어서 옮기고 오른쪽 아래 손잡이로 크기(글자 크기도 같이)를 바꾼다. 앱에는 라벨 그리기 코드가 없어(APP-01 AC3) 서버가 초안을 견본 값으로 그려 준다.
// 4) 출력 기기를 정하고 방송으로 간다. 선택한 테스트 인쇄는 관리 화면에서 연다.
// 단추 둘은 늘 좌우 — 부정 왼쪽, 긍정 오른쪽 (D-UX4-01). 프린터를 '기본·실험'으로 나눠 보이지 않는다.
import { printerProfile, labelSizesForProfileId } from '@livejjim/printer'
import { CAPTION_POSITIONS, CAPTION_SPACE_HINT, CAPTION_TEXT_MAX, CAPTION_WORDS, captionsCrowded, productArea, safeMargin, type LabelCaption } from '@livejjim/label/captions'
import type { DateStyle, ProductDesign, ProductItemId, ProductTemplate, ShopMark, TemplateItem, TimeStyle } from '@livejjim/label'
import type { QueueSummary, StoredTemplate, Templates } from '@livejjim/web/src/api/print-types.ts'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ActivityIndicator, Image, PanResponder, ScrollView, View, useWindowDimensions } from 'react-native'
import { get, isApiError, post, put } from '../api/client.ts'
import type { PickEntry } from '@livejjim/mobile-ble'
import { cancelPrinterPick, lastPickedEntry, pickPrinter, useInlinePrinterPick } from '../native/printer-pick.ts'
import { sizeWordMm, testHelp } from '../lib/test-help.ts'
import { RETRY_NOW } from '../lib/words.ts'
import { snapMove, snapResize, type SnapGuide, type SnapRect } from '../lib/label-snap.ts'
import { useServices } from '../services.tsx'
import { BigButton, BottomCTA, BottomSheet, FormPage, LineTab, LineTabs, NavBar, usePageTop, useWhiteTop, ChoiceCheck, Icon, ListRow, SmallButton, TextField, ToggleRow, Txt, useKit, Tap } from '../ui/kit/index.ts'
import { RADIUS, SPACE, TOUCH } from '../ui/kit/tokens.ts'
import { LabelPrintArt, PrinterConnectArt } from '../ui/LabelArt.tsx'
import { Notice } from '../ui/parts.tsx'
import { PLAIN } from './console/parts.tsx'
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
/**
 * 라벨 칸 이름 (번호·닉네임은 늘 찍힌다 — L-3 PRODUCT_LOCKED). 화면 이름은 '품명'(D-LABEL-ITEMS-01, 사용자 지시 2026-11-23 "품명") — 옛 '품종'.
 * 라벨에 찍히는 글(품종: …)은 라벨 규칙 몫이라 그대로다.
 */
export const ITEM_WORDS: Readonly<Record<ProductItemId, string>> = { shop: '가게 이름', date: '날짜', time: '시간', number: '번호', price: '가격', name: '품명', buyer: '닉네임' }
/**
 * 문구 탭 왼쪽 목록의 차례 (D-LABEL-ITEMS-01, 사용자 지시 2026-11-23 "항목 순서를 가게 이름, 날짜, 시간, 번호, 가격, 품명, 닉네임, 직접 입력으로").
 * 옛: 가게 이름·번호·가격·날짜·품종·닉네임. 미리 보기 위 칸도 이 차례로 놓는다.
 */
const ITEM_ORDER: readonly ProductItemId[] = ['shop', 'date', 'time', 'number', 'price', 'name', 'buyer']
/**
 * 가격 표기는 둘만 (D-LABEL-ITEMS-01, 사용자 지시 2026-11-23 "가격은 300,000원, 30만 원 이렇게 2개만"). 보기 글은 미리 보기 견본(백만 원)과 같게.
 * 옛: 30만원 · 300 천원 · 300,000원. 저장본이 천원(THOUSAND)이면 불러올 때 원(WON)으로 바꿔 둔다(저장할 때 반영 — AUTO).
 */
const PRICE_STYLES = ['WON', 'TEN_THOUSAND'] as const
const PRICE_WORDS: Readonly<Record<(typeof PRICE_STYLES)[number], string>> = {
  WON: '1,000,000원',
  TEN_THOUSAND: '100만 원',
}
/** 가게 이름 양옆 기호 (끄면 'none') — 보기 글은 '가게'를 감싼 모양 */
const SHOP_MARK_CHOICES = ['dash', 'angle', 'square', 'round'] as const satisfies readonly ShopMark[]
const SHOP_MARK_WORDS: Readonly<Record<(typeof SHOP_MARK_CHOICES)[number], string>> = { dash: '-가게-', angle: '<가게>', square: '[가게]', round: '(가게)' }
/** 날짜 모양 (연도는 따로 켜고 끈다) */
const DATE_SEPS = ['.', '/', '-'] as const satisfies readonly DateStyle['sep'][]
const DEFAULT_DATE_STYLE: DateStyle = { year: true, sep: '.' }
/** 날짜 모양 보기 글: 오늘(한국 시각) 날짜로 — 연도를 켜면 26.11.23, 끄면 11.23 */
export function dateWord(style: DateStyle, now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 3600_000)
  const two = (n: number) => String(n).padStart(2, '0')
  const parts = [two(kst.getUTCMonth() + 1), two(kst.getUTCDate())]
  return (style.year ? [two(kst.getUTCFullYear() % 100), ...parts] : parts).join(style.sep)
}
/** 시간 모양 */
const TIME_STYLES = ['24h', '12h'] as const satisfies readonly TimeStyle[]
const TIME_WORDS: Readonly<Record<TimeStyle, string>> = { '24h': '17:30', '12h': '5:30 PM' }

// 앱은 라벨 실행 코드를 가져오지 않는다(APP-01 AC3) — 칸을 고칠 때 필요한 숫자만 LABEL_RULES 그대로 옮겨 둔다. 저장 때 서버가 다시 검사한다.
/** 글자 크기 범위 (L-5, 점) */
export const FONT_SIZE_MIN = 16
export const FONT_SIZE_MAX = 120
/** 끌 수 없는 칸 (L-3) */
const PRODUCT_LOCKED: readonly ProductItemId[] = ['number', 'buyer']

/** 라벨 크기의 mm·점 (L-1: 50mm 라벨 = 폭 min(폭×8, 384)·높이×8, 테이프 tape<폭>x<길이> = 길이×8 · 96). 모르는 글이면 null */
export function labelDots(size: string): { readonly widthMm: number; readonly heightMm: number; readonly widthDots: number; readonly heightDots: number; readonly tape: boolean } | null {
  const tape = /^tape(\d+)x(\d+)$/.exec(size)
  if (tape !== null) return { widthMm: Number(tape[2]), heightMm: Number(tape[1]), widthDots: Number(tape[2]) * 8, heightDots: 96, tape: true }
  const label = /^(\d+)x(\d+)$/.exec(size)
  if (label === null) return null
  const widthMm = Number(label[1])
  const heightMm = Number(label[2])
  return { widthMm, heightMm, widthDots: Math.min(widthMm * 8, 384), heightDots: heightMm * 8, tape: false }
}

/**
 * 종이 크기(점)와 그 위 인쇄 그림의 자리. 50mm 라벨은 인쇄 머리가 48mm라 그림 좌우에 1mm씩 종이가 남는다 —
 * 미리 보기는 그림만이 아니라 종이 전체를 그려 실제 여백을 보인다 (D-LABEL-SAFE-01)
 */
export function paperDots(dots: { readonly widthMm: number; readonly heightMm: number; readonly widthDots: number; readonly heightDots: number }) {
  const width = Math.max(dots.widthMm * 8, dots.widthDots)
  const height = Math.max(dots.heightMm * 8, dots.heightDots)
  return { width, height, left: (width - dots.widthDots) / 2, top: (height - dots.heightDots) / 2 }
}

const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), Math.max(low, high))

/** 칸 옮기기: 라벨 밖으로 나가지 않게 (점 단위 정수 — L-5) */
export function movedItem(item: TemplateItem, dx: number, dy: number, labelW: number, labelH: number): TemplateItem {
  return { ...item, x: clamp(Math.round(item.x + dx), 0, labelW - item.width), y: clamp(Math.round(item.y + dy), 0, labelH - item.height) }
}

/** 칸의 가장 작은 크기 (점) — 서버가 미리 보기에 그 칸의 최소 크기(minSizes)를 주지 않으면 이것 */
export interface BoxMin {
  readonly width: number
  readonly height: number
}
export const BOX_MIN: BoxMin = { width: 24, height: 20 }

/**
 * 글자 한 줄 높이 (점) — 칸 높이는 글자 크기로 정해진다 (D-LABEL-SNAP-01, 사용자 지시 2026-11-23 "박스 높이를 아무리 크게 조절해도 그렇게 조절되게
 * 하지 말고 파워포인트에서 텍스트 박스 조절하듯이 … 쓸데없는 여백 생기게 하지 말라"). 옛 글자 크기 단계의 ceil(글자×1.25)와 같은 식.
 */
export const textBoxHeight = (points: number): number => Math.ceil(points * 1.25)

/** 라벨 아래 끝 안에 들어가는 가장 큰 글자 (낮으면 FONT_SIZE_MIN) */
const fittingFont = (wanted: number, room: number): number => {
  let size = wanted
  while (size > FONT_SIZE_MIN && textBoxHeight(size) > room) size -= 1
  return size
}

/**
 * 오른쪽 아래 손잡이: 폭과 글자 크기를 함께 — 끈 높이(dh)만큼 글자를 키우고 칸 높이는 늘 그 글자 한 줄 높이 (파워포인트 텍스트 상자처럼, D-LABEL-SNAP-01).
 * min(서버가 준 그 칸의 최소 크기) 밑으로는 줄지 않는다 — "칸이 좁아 만들 수 없어요" 대신 안 줄어든다. 라벨 밖으로는 안 커진다.
 * 옛: 상자 높이를 마음대로 키우고 글자는 높이 비율로(위아래 빈 곳이 생겼다).
 */
export function resizedItem(item: TemplateItem, dw: number, dh: number, labelW: number, labelH: number, min: BoxMin = BOX_MIN): TemplateItem {
  const width = clamp(Math.round(item.width + dw), min.width, labelW - item.x)
  const room = labelH - item.y
  let fontSize = fittingFont(clamp(Math.floor((textBoxHeight(item.fontSize) + dh) / 1.25), FONT_SIZE_MIN, FONT_SIZE_MAX), room)
  while (fontSize < FONT_SIZE_MAX && textBoxHeight(fontSize) < min.height && textBoxHeight(fontSize + 1) <= room) fontSize += 1
  const height = Math.max(1, Math.min(textBoxHeight(fontSize), room))
  return { ...item, width, height, fontSize, minFontSize: Math.min(item.minFontSize, fontSize) }
}

/** 오른쪽 가운데 손잡이: 폭만 (높이는 글자 한 줄 높이로 맞춘다 — 만진 칸에만 새 높이 규칙) */
export function widenedItem(item: TemplateItem, dw: number, labelW: number, labelH: number, min: BoxMin = BOX_MIN): TemplateItem {
  const width = clamp(Math.round(item.width + dw), min.width, labelW - item.x)
  return { ...item, width, height: Math.max(1, Math.min(textBoxHeight(item.fontSize), labelH - item.y)) }
}

/** 글자 크기 한 단계: 높이도 글자 한 줄 높이로 따라간다(줄면 같이 준다). 라벨 아래 끝을 넘게는 안 커진다 */
export function fontStepped(item: TemplateItem, delta: number, labelH: number): TemplateItem {
  const fontSize = clamp(item.fontSize + delta, FONT_SIZE_MIN, FONT_SIZE_MAX)
  if (delta > 0 && item.y + textBoxHeight(fontSize) > labelH) return item
  const height = Math.max(1, Math.min(textBoxHeight(fontSize), labelH - item.y))
  return { ...item, fontSize, height, minFontSize: Math.min(item.minFontSize, fontSize) }
}

/** 글자를 한 단계(2점) 더 키울 수 있나 — 라벨 아래 끝 안에서 */
export const canGrowFont = (item: TemplateItem, labelH: number): boolean => item.fontSize < FONT_SIZE_MAX && item.y + textBoxHeight(Math.min(FONT_SIZE_MAX, item.fontSize + 2)) <= labelH

/** 불러온 초안 고르기: 천원 표기(THOUSAND)는 앱이 보이는 두 표기 중 원(WON)으로 (D-LABEL-ITEMS-01 AUTO — 화면에 없는 표기로 남지 않게) */
export function normalizedDraft(template: ProductTemplate): ProductTemplate {
  return template.priceStyle === 'THOUSAND' ? { ...template, priceStyle: 'WON' } : template
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
/** 라이브 시작 라벨 단계의 화면 하나 — 묻기 → 프린터 연결 → 라벨 디자인 → 출력 기기 (D-LABEL-ROUTE-01, 화면마다 따로 쌓인다) */
export type LabelFlowStep = 'ask' | 'connect' | 'design' | 'device'
export const LABEL_FLOW_STEPS: readonly LabelFlowStep[] = ['ask', 'connect', 'design', 'device']

interface DraftPreview {
  readonly template: ProductTemplate
  readonly width: number
  readonly height: number
  readonly png: string
  readonly longest: string | null
  /** 칸마다 가장 작은 크기(템플릿 점) — 이 밑으로는 줄이지 못하게 한다 (D-LABEL-SNAP-01). 없으면 BOX_MIN */
  readonly minSizes?: Partial<Record<ProductItemId, BoxMin>>
}

const errorText = (caught: unknown): string => (isApiError(caught) ? caught.message : '하지 못했어요. 다시 눌러 주세요.')

/** 라벨 프린트 화면에서 한 단계만 다시 할 때 (D-UX4-80): 프린터 연결 · 라벨 디자인 · 테스트 인쇄 */
export type LabelSetupStep = 'connect' | 'design' | 'test'

/**
 * only: 그 단계 하나만 — 뒤로는 onBack, 끝나면 onDone (방송 시작 때 하지 않았어도 방송 관리 → 라벨 프린트에서 다시 한다).
 * 아니면 라이브 시작 라벨 단계의 화면 step 하나 — 다음 화면은 openStep으로 쌓고, 뒤로는 onBack(아래 화면), 다 하면 onDone(라이브로) (D-LABEL-ROUTE-01).
 * focused: 이 화면이 맨 위에 보이나 — 프린터 연결 화면은 위에 다른 화면이 쌓인 동안 찾지 않는다.
 */
export function LabelSetupScreen(props: { readonly onBack: () => void; readonly onDone: () => void; readonly focused?: boolean } & ({ readonly only: LabelSetupStep } | { readonly step?: LabelFlowStep; readonly openStep: (next: LabelFlowStep) => void })) {
  const { onBack, onDone, focused = true } = props
  const only = 'only' in props ? props.only : undefined
  const step: Step = 'only' in props ? props.only : props.step ?? 'ask'
  const { labels } = useServices()
  const snapshot = useSyncExternalStore(labels.subscribe, labels.getSnapshot)
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
  /** 다음 화면을 쌓는다 (뒤로는 늘 onBack — 아래 쌓인 화면이 앞 단계다) */
  const go = (next: LabelFlowStep) => {
    setError(null)
    if (!('only' in props)) props.openStep(next)
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

  return <View testID="label-setup" style={{ flex: 1 }}>{page()}</View>

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
  if (step === 'connect') return <ConnectStep active={focused} onBack={onBack} busy={busy} error={errorLine} {...(only === undefined ? { onNext: () => go('design'), onLater: skipLabels } : {})} />
  if (step === 'design') return <DesignStep saveLabel={only === undefined ? '저장하고 다음' : '저장'} queue={snapshot.queue} profileId={snapshot.profileId} onBack={onBack} onSaved={() => (only === undefined && !snapshot.mine ? go('device') : onDone())} />
  return <TestStep selectDevice={step === 'device'} busy={busy} run={run} onBack={onBack} onDone={onDone} error={errorLine} />
  }
}

/** 2) 프린터 연결과 확인 — 들어오면 바로 찾고, 찾은 프린터를 이 화면에 줄로 (D-UX4-04). 고른 줄에서 바로 연결 확인, 이어지면 [다음] (D-UX4-10) */
function ConnectStep({ active = true, onBack, onNext, onLater, busy = false, error = null }: { readonly active?: boolean; readonly onBack: () => void; readonly onNext?: () => void; readonly onLater?: () => void; readonly busy?: boolean; readonly error?: React.ReactNode }) {
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

  // 들어오면(위 화면에서 돌아와도) 바로 찾는다 (이미 잇는 중이거나 이어져 있으면 그대로). 위에 다른 화면이 쌓이면 찾기를 멈춘다 (D-LABEL-ROUTE-01)
  useEffect(() => {
    if (!active) {
      cancelPrinterPick()
      return
    }
    if (labels.getSnapshot().printer === 'DISCONNECTED') start()
  }, [active, labels, start])
  // 아무것도 못 찾으면 잠깐마다 다시 찾는다 — 찾은 것이 있으면 찾기가 이어지며 목록이 저절로 늘어난다. 고른 줄을 잇는 동안은 기다린다
  const nothingYet = !linked && picked === null && (found === null || found.length === 0)
  useEffect(() => {
    if (!nothingYet || !active) return
    const timer = setInterval(() => {
      if (labels.getSnapshot().printer !== 'CONNECTED') void refresh()
    }, RESCAN_MS)
    return () => clearInterval(timer)
  }, [nothingYet, active, labels, refresh])

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
  const [tab, setTab] = useState<DesignTab>('용지')
  const [itemId, setItemId] = useState<ItemChoice>('number')
  /** 스타일 탭의 예시 그림 — 지금 용지·가게 이름·가격 표기·직접 입력 문구로 서버가 그린 것 (key가 바뀌면 다시 받는다) */
  const [styleArt, setStyleArt] = useState<{ readonly key: string; readonly png: Partial<Record<ProductDesign, string>> }>({ key: '', png: {} })
  const [notePage, setNotePage] = useState(0)
  const [editing, setEditing] = useState<'shop' | 'note' | null>(null)
  /** 마지막으로 잘 그려진 초안 — 칸이 좁아 못 그리면(DOES_NOT_FIT) 오류 대신 이것으로 되돌린다 (D-LABEL-SNAP-01) */
  const lastGood = useRef<ProductTemplate | null>(null)
  /** 칸마다 최소 크기 — 마지막으로 받은 미리 보기의 것 */
  const [minSizes, setMinSizes] = useState<Partial<Record<ProductItemId, BoxMin>>>({})
  /** 가게 이름 양옆 기호를 다시 켤 때 쓸 마지막 기호 */
  const lastMark = useRef<(typeof SHOP_MARK_CHOICES)[number]>('dash')
  const top = usePageTop()
  const { width: screenWidth, height: screenHeight } = useWindowDimensions()
  useWhiteTop()
  const { p } = useKit()

  const load = () => {
    setError(null)
    get<Templates>('/api/print/templates').then(
      (view) => {
        setStored(view.product)
        // 가게 이름 칸은 저장된 본문 그대로 (비어 있으면 가게 설정의 이름을 따른다 — D-FB1-07). 천원 표기는 원 표기로 (D-LABEL-ITEMS-01)
        const mark = view.product.template.shopMark
        if (mark !== undefined && mark !== 'none') lastMark.current = mark
        setDraft(normalizedDraft({ ...view.product.template, shopName: view.product.storedShopName ?? '' }))
      },
      (caught: unknown) => setError(errorText(caught)),
    )
  }
  useEffect(load, [])

  /** 초안을 서버에 보내 그림을 받는다 (크기를 바꾸면 서버가 그 크기의 칸 배치로 고친 초안도 준다) */
  // fit: 날짜·시간·가격 모양을 바꾸면 새 모양이 들어가도록 서버가 좁은 칸을 가장 작은 크기까지 넓혀 돌려준다 (D-LABEL-MINBOX-01) —
  // 그냥 그리면 '26/11/23'처럼 넓어진 글이 칸이 좁아 못 그려져 고른 모양이 몰래 되돌아갔다
  const draw = (template: ProductTemplate, resize?: string, design?: ProductDesign, fit = false) => {
    clearTimeout(previewTimer.current)
    // 용지·스타일은 칸 배치를 통째로 바꾸니 받을 때까지 막는다. 모양 바꾸기(fit)는 고른 것을 바로 보이고 막지 않는다
    const blocking = resize !== undefined || design !== undefined
    const layoutChange = blocking || fit
    if (blocking) setChangingLayout(true)
    const ticket = ++asked.current
    post<DraftPreview>('/api/print/templates/product/preview', { template, resize, design, ...(fit ? { fit } : {}) }).then(
      (view) => {
        if (ticket !== asked.current) return
        setPreview(view)
        setError(null)
        if (view.minSizes !== undefined) setMinSizes(view.minSizes)
        lastGood.current = layoutChange ? view.template : template
        if (blocking) {
          setChangingLayout(false)
          setDraft(view.template)
        } else if (fit && JSON.stringify(view.template.items) !== JSON.stringify(template.items)) setDraft({ ...template, items: view.template.items })
      },
      (caught: unknown) => {
        if (ticket !== asked.current) return
        setChangingLayout(false)
        // 칸을 너무 줄여 글이 안 들어가면(칸이 좁아…) 알리지 않고 마지막으로 잘 그려진 초안으로 (사용자 지시 "칸이 좁아 만들수 없다고 띄우지 말고 걍 안 줄어들게")
        const good = lastGood.current
        // 칸이 좁은 오류만 (서버 doesNotFitMessage 문장) — 다른 오류(못 쓰는 글자 등)는 되돌리면 친 글이 몰래 사라지니 그대로 알린다
        if (!layoutChange && good !== null && isApiError(caught) && caught.code === 'LABEL_INVALID' && caught.message.includes(DOES_NOT_FIT_WORDS)) {
          setDraft(good)
          return
        }
        setPreview(null)
        setError(errorText(caught))
      },
    )
  }
  /** 다음 초안은 칸 맞추기(fit)로 바로 그린다 — 모양을 바꾼 때 (D-LABEL-MINBOX-01) */
  const fitNext = useRef(false)
  const setDraftFitted = (next: ProductTemplate) => {
    fitNext.current = true
    setDraft(next)
  }
  // 칠 때·끌 때마다가 아니라 잠깐 멈춘 뒤에 그린다
  useEffect(() => {
    if (draft === null) return
    if (fitNext.current) {
      fitNext.current = false
      draw(draft, undefined, undefined, true)
      return () => { asked.current++ }
    }
    previewTimer.current = setTimeout(() => draw(draft), 250)
    return () => { clearTimeout(previewTimer.current); asked.current++ }
  }, [draft])

  const listed = queue?.labelSizes
  const sizes = sortedSizes(listed !== undefined && listed.length > 0 ? listed : labelSizesForProfileId(profileId))
  const dots = draft === null ? null : labelDots(draft.size)
  const crowded = draft !== null && dots !== null && captionsCrowded(draft.captions ?? [], dots.widthDots, dots.heightDots, safeMargin(dots))
  const styleKey = draft === null ? '' : JSON.stringify([draft.size, draft.shopName, draft.priceStyle, draft.captions ?? []])
  // 스타일 탭을 열면 세 스타일의 예시를 받는다. 늦게 온 옛 그림(용지 등을 바꾸기 전)은 버린다
  useEffect(() => {
    if (tab !== '스타일' || draft === null || styleKey === styleArt.key) return
    setStyleArt({ key: styleKey, png: {} })
    for (const { value } of DESIGNS) {
      post<DraftPreview>('/api/print/templates/product/preview', { template: draft, design: value }).then(
        (view) => setStyleArt((now) => (now.key === styleKey ? { key: styleKey, png: { ...now.png, [value]: view.png } } : now)),
        () => {},
      )
    }
  }, [tab, styleKey])
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
  const paper = dots === null ? null : paperDots(dots)
  const workspaceHeight = paper === null ? 160 : paperWidth * paper.height / paper.width + SPACE.xxxl * 2
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
      setTab('문구')
    }
  }
  const minFor = (id: ProductItemId): BoxMin => ({ width: Math.max(BOX_MIN.width, minSizes[id]?.width ?? 0), height: Math.max(BOX_MIN.height, minSizes[id]?.height ?? 0) })
  const pickChoice = (id: ItemChoice) => {
    if (id !== 'notes') return pickItem(id)
    setItemId('notes')
    setPicked(null)
  }
  const setNotes = (captions: readonly LabelCaption[]) => setDraft((now) => now === null ? now : { ...now, captions: [...captions] })
  const editNote = (patch: Partial<LabelCaption>) => setNotes(notes.map((entry, i) => i === noteIndex ? { ...entry, ...patch } : entry))
  const editTitle = editing === 'shop' ? '가게 이름' : `문구 ${noteIndex + 1}`

  return (
    <View role="dialog" aria-label="라벨 디자인" testID="label-setup-design" style={{ flex: 1, paddingTop: top, backgroundColor: p.surface }}>
      <NavBar title="라벨 디자인" onBack={onBack} />
      {/* 흰 용지가 또렷하게 보이도록 뒤 바탕은 더 어두운 회색 (D-LABEL-TABS-01) */}
      <View testID="label-workspace" style={{ height: workspaceHeight, flexShrink: 1, minHeight: 0, backgroundColor: DESK }}>
        {draft !== null && dots !== null ? <LabelEditor draft={draft} preview={preview} dots={dots} picked={picked} onPick={pickItem} onItem={setItem} minFor={minFor} disabled={changingLayout || saving} /> : error === null ? <ActivityIndicator style={{ flex: 1 }} color={p.primary} /> : null}
      </View>
      {crowded ? <Notice tone="warning" alert>{CAPTION_SPACE_HINT}</Notice> : preview?.longest ? <Notice tone="warning">{preview.longest}</Notice> : null}
      {error !== null ? <Notice tone="danger" alert>{error}</Notice> : null}
      {error !== null && draft === null ? <SmallButton label={RETRY_NOW} onPress={load} /> : null}
      {draft !== null && dots !== null ? (
        // collapsable={false}: 막기(pointerEvents)를 켜고 끌 때 안드로이드가 이 칸을 납작하게 접었다 폈다 하며 자식을 다른 부모로 옮기지 않게 —
        // 저장 뒤 화면이 닫히는 중에 풀리면 "already has a parent"로 화면 전체가 하얗게 됐다 (D-LABEL-SAVE-WHITE-01)
        <View collapsable={false} pointerEvents={changingLayout || saving ? 'none' : 'auto'} style={{ flex: 1, minHeight: 48 + Math.min(218, screenHeight * 0.3), paddingHorizontal: SPACE.lg }}>
          {/* 라이브 화면과 같은 밑줄 글자 탭 (D-TABS-01 — 옛: 칸을 나눠 채운 초록 밑줄 탭) */}
          <LineTabs label="라벨 설정" bleed={SPACE.lg}>
            {DESIGN_TABS.map((name) => (
              <LineTab key={name} label={name} on={tab === name} onPress={() => pickTab(name)} />
            ))}
          </LineTabs>
          {tab === '문구' ? (
            // 좌우 둘로: 왼쪽 넣을 수 있는 항목, 오른쪽 그 항목의 설정 (D-LABEL-ITEMS-01, 사용자 지시 2026-11-23 "좌우 두개로 나눠서 … 지금은 상하로 나눠져서 공간이 좁아")
            <View role="tabpanel" aria-label={tab} style={{ flex: 1, flexDirection: 'row', gap: SPACE.md, paddingTop: SPACE.md }}>
              <ScrollView style={{ width: ITEM_LIST_WIDTH, flexGrow: 0 }} contentContainerStyle={{ paddingBottom: SPACE.sm }}>
                <View role="radiogroup" aria-label="라벨 항목" style={{ gap: SPACE.xs }}>
                  {ITEM_CHOICES.map((id) => (
                    <ItemListRow key={id} word={id === 'notes' ? NOTES_WORD : ITEM_WORDS[id]} on={itemId === id} off={id !== 'notes' && !itemOf(draft, id).visible} onPress={() => pickChoice(id)} />
                  ))}
                </View>
              </ScrollView>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: SPACE.sm, paddingBottom: SPACE.sm }}>
                {itemId !== 'notes' ? (
                  <ItemSettings
                    id={itemId}
                    draft={draft}
                    heightDots={dots.heightDots}
                    onDraft={setDraftFitted}
                    onItem={(item) => setItem(itemId, item)}
                    onEditShop={() => setEditing('shop')}
                    onMark={(mark) => {
                      if (mark !== 'none') lastMark.current = mark
                      setDraft({ ...draft, shopMark: mark })
                    }}
                    lastMark={lastMark.current}
                  />
                ) : (
                  // 직접 입력 문구 — 호스트 이름·가게 문구처럼 상품마다 같은 글을 라벨 모서리에 (2026-11-12 "호스트 등 라벨 고정 문구")
                  <View role="group" aria-label={`${NOTES_WORD} 설정`} style={{ gap: SPACE.sm }}>
                    {notes.length > 0 ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACE.xs }}>
                        <PageArrow next={false} disabled={noteIndex === 0} onPress={() => setNotePage(noteIndex - 1)} />
                        <Txt weight="medium">{`${noteIndex + 1} / ${notes.length}`}</Txt>
                        <PageArrow next disabled={noteIndex + 1 >= notes.length} onPress={() => setNotePage(noteIndex + 1)} />
                      </View>
                    ) : (
                      <Txt color="textSub">호스트 이름처럼 늘 같은 글을 넣어요</Txt>
                    )}
                    {/* 단추는 좌우 한 줄 — 지우기(부정) 왼쪽, 더하기(긍정) 오른쪽 (D-UX4-01) */}
                    <View style={{ flexDirection: 'row', gap: SPACE.xs }}>
                      {note !== undefined ? <View style={{ flex: 1 }}><SmallButton label="삭제" onPress={() => { setNotes(notes.filter((_, i) => i !== noteIndex)); setNotePage(Math.max(0, noteIndex - 1)) }} /></View> : null}
                      <View style={{ flex: 1 }}><SmallButton label="문구 추가" onPress={() => { setNotes([...notes, { text: '', position: CAPTION_POSITIONS[notes.length % CAPTION_POSITIONS.length] ?? 'topRight' }]); setNotePage(notes.length); setEditing('note') }} /></View>
                    </View>
                    {note !== undefined ? <>
                      <ValueRow title={`문구 ${noteIndex + 1}`} value={note.text || '내용 입력'} onPress={() => setEditing('note')} />
                      <OptionGrid label={`문구 ${noteIndex + 1} 위치`} values={NOTE_CORNERS} columns={2} selected={note.position} word={(position) => CAPTION_WORDS[position]} onPick={(position) => editNote({ position })} />
                    </> : null}
                  </View>
                )}
              </ScrollView>
            </View>
          ) : (
            <ScrollView role="tabpanel" aria-label={tab} style={{ flex: 1 }} contentContainerStyle={{ gap: SPACE.sm, paddingTop: SPACE.md, paddingBottom: SPACE.sm }}>
              {tab === '용지' ? (
                <>
                  <Txt weight="bold">라벨 크기</Txt>
                  <OptionGrid label="라벨 크기" values={sizes} columns={3} selected={draft.size} word={sizeWordMm} onPick={(size) => draw(draft, size)} />
                </>
              ) : (
                <StyleGrid selected={draft.design ?? 'basic'} art={styleArt.key === styleKey ? styleArt.png : {}} dots={dots} onPick={(design) => { setPicked(null); if (!changingLayout) draw(draft, undefined, design) }} />
              )}
            </ScrollView>
          )}
        </View>
      ) : null}
      <BottomCTA><BigButton label={saveLabel} busy={saving} disabled={draft === null || changingLayout || crowded} onPress={() => void save()} /></BottomCTA>
      <BottomSheet title={editTitle} visible={editing !== null} onClose={() => setEditing(null)} actions={<BigButton label="완료" onPress={() => setEditing(null)} />}>
        {editing !== null && draft !== null ? <TextField autoFocus label={editTitle} maxLength={editing === 'shop' ? 40 : CAPTION_TEXT_MAX} value={editing === 'shop' ? draft.shopName : note?.text ?? ''} onChangeText={(text) => editing === 'shop' ? setDraft({ ...draft, shopName: text }) : editNote({ text })} returnKeyType="done" onSubmitEditing={() => setEditing(null)} /> : null}
      </BottomSheet>
    </View>
  )
}

/**
 * 탭은 정하는 차례대로 용지 → 스타일 → 문구 (D-LABEL-TABS-01, 사용자 지시 2026-11-23 "탭 배치 순서도 용지, 스타일, 문구로 … 용지에는 용지 크기,
 * 스타일에는 지금의 템플릿 내용, 문구에는 지금의 항목 내용"). 옛: 항목·문구·용지 탭 + 머리 오른쪽 [템플릿] 아래 창(이름만 있는 고르기).
 * 옛 문구 탭(직접 입력 문구)은 문구 탭의 [직접 입력] 칸으로 옮겼다.
 */
const DESIGN_TABS = ['용지', '스타일', '문구'] as const
type DesignTab = (typeof DESIGN_TABS)[number]
const DESIGNS = [{ value: 'basic', label: '기본형' }, { value: 'large', label: '큰 글씨형' }, { value: 'table', label: '표형' }] as const satisfies readonly { readonly value: ProductDesign; readonly label: string }[]
/** 문구 탭의 칸: 라벨 항목 여섯 + 직접 입력 문구 */
type ItemChoice = ProductItemId | 'notes'
const NOTES_WORD = '직접 입력'
const ITEM_CHOICES: readonly ItemChoice[] = [...ITEM_ORDER, 'notes']
/** 서버 라벨 규칙의 칸이 좁은 오류 문장(packages/label doesNotFitMessage)에 늘 있는 말 — 앱은 라벨 실행 코드를 가져오지 않는다(APP-01 AC3) */
const DOES_NOT_FIT_WORDS = '칸이 좁아 라벨을 만들 수 없어요'
/** 문구 탭 왼쪽 항목 목록의 폭 — '가게 이름'·'직접 입력'이 한 줄에 들어가게 */
const ITEM_LIST_WIDTH = 96
/** 저장본이 옛 판이라 칸이 빠져 있어도(새 '시간' 칸) 화면이 깨지지 않게 — 없으면 꺼진 칸으로 본다 */
const HIDDEN_ITEM: TemplateItem = hiddenItem(FONT_SIZE_MIN)
function hiddenItem(points: number): TemplateItem {
  const fontSize = points
  return { visible: false, x: 0, y: 0, width: BOX_MIN.width, height: BOX_MIN.height, fontSize, minFontSize: fontSize }
}
function itemOf(draft: ProductTemplate, id: ProductItemId): TemplateItem {
  const items: Partial<Record<ProductItemId, TemplateItem>> = draft.items
  return items[id] ?? HIDDEN_ITEM
}

/** 문구 탭 왼쪽 항목 한 줄 — 고르면 초록 테두리·바탕(옛 칸 고르기와 같은 느낌), 꺼진 칸은 흐린 글자 */
function ItemListRow({ word, on, off, onPress }: { readonly word: string; readonly on: boolean; readonly off: boolean; readonly onPress: () => void }) {
  const { p } = useKit()
  return (
    <Tap role="radio" aria-checked={on} aria-label={word} onPress={onPress} style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: SPACE.sm, justifyContent: 'center', borderRadius: RADIUS.sm, borderCurve: 'continuous', borderWidth: on ? 2 : 1, borderColor: on ? p.primary : p.border, backgroundColor: pressed ? p.pressed : on ? p.freshBg : p.surface })}>
      <Txt step="meta" numberOfLines={1} adjustsFontSizeToFit weight={on ? 'bold' : 'medium'} color={on ? 'primaryText' : off ? 'textSub' : 'text'}>
        {word}
      </Txt>
    </Tap>
  )
}

/**
 * 값을 고치는 줄 — 라이브 관리 화면의 줄(PlainRow)과 같은 모양: 왼쪽 이름 · 오른쪽 초록 값 · › (D-LABEL-ITEMS-01, 사용자 지시
 * "가게이름 수정은 지금 같은 디자인 말고 라이브 관리 화면 처럼 깔끔하게"). 옛: 회색 바탕 상자(EditTextButton).
 */
function ValueRow({ title, value, onPress }: { readonly title: string; readonly value: string; readonly onPress: () => void }) {
  const { p } = useKit()
  return (
    <Tap role="button" aria-label={`${title} 편집`} onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, minHeight: PLAIN.row, marginHorizontal: -SPACE.sm, paddingLeft: SPACE.sm, paddingRight: SPACE.xs, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
      <Txt step="bodyLarge" weight={PLAIN.weight} ink={PLAIN.ink} numberOfLines={1}>
        {title}
      </Txt>
      <View style={{ flex: 1, alignItems: 'flex-end' }}>
        <Txt step="body" weight="regular" color="primaryText" numberOfLines={1}>
          {value}
        </Txt>
      </View>
      <Icon name="chevron" color={PLAIN.chevron} size={20} />
    </Tap>
  )
}

/** 문구 탭 오른쪽: 고른 항목의 설정 — 찍기 · 항목마다의 형식 · 글자 크기 (D-LABEL-ITEMS-01) */
function ItemSettings({ id, draft, heightDots, onDraft, onItem, onEditShop, onMark, lastMark }: {
  readonly id: ProductItemId
  readonly draft: ProductTemplate
  readonly heightDots: number
  readonly onDraft: (next: ProductTemplate) => void
  readonly onItem: (item: TemplateItem) => void
  readonly onEditShop: () => void
  readonly onMark: (mark: ShopMark) => void
  readonly lastMark: (typeof SHOP_MARK_CHOICES)[number]
}) {
  const item = itemOf(draft, id)
  const mark = draft.shopMark ?? 'dash'
  const dateStyle = draft.dateStyle ?? DEFAULT_DATE_STYLE
  const priceStyle = draft.priceStyle === 'TEN_THOUSAND' ? 'TEN_THOUSAND' : 'WON'
  return (
    <View role="group" aria-label={`${ITEM_WORDS[id]} 설정`} style={{ gap: SPACE.xs }}>
      {PRODUCT_LOCKED.includes(id) ? null : <ToggleRow title="찍기" on={item.visible} rowHeight={44} onChange={(on) => onItem({ ...item, visible: on })} />}
      {item.visible && id === 'shop' ? (
        <>
          <ValueRow title="가게 이름" value={draft.shopName || '가게 설정 이름 사용'} onPress={onEditShop} />
          {/* 양옆 기호 (사용자 지시 "가게 이름은 양 옆에 기호 넣을건지 말건지 온오프랑 넣을거면 뭐 넣을건지 선택") */}
          <ToggleRow title="양옆 기호" on={mark !== 'none'} rowHeight={44} onChange={(on) => onMark(on ? lastMark : 'none')} />
          {mark !== 'none' ? <OptionGrid label="기호 모양" values={SHOP_MARK_CHOICES} columns={2} selected={mark} word={(value) => SHOP_MARK_WORDS[value]} onPick={onMark} /> : null}
        </>
      ) : null}
      {item.visible && id === 'date' ? (
        <>
          <ToggleRow title="연도" on={dateStyle.year} rowHeight={44} onChange={(year) => onDraft({ ...draft, dateStyle: { ...dateStyle, year } })} />
          <OptionGrid label="날짜 모양" values={DATE_SEPS} columns={3} selected={dateStyle.sep} word={(sep) => dateWord({ ...dateStyle, sep })} onPick={(sep) => onDraft({ ...draft, dateStyle: { ...dateStyle, sep } })} />
        </>
      ) : null}
      {item.visible && id === 'time' ? <OptionGrid label="시간 모양" values={TIME_STYLES} columns={2} selected={draft.timeStyle ?? '24h'} word={(style) => TIME_WORDS[style]} onPick={(timeStyle) => onDraft({ ...draft, timeStyle })} /> : null}
      {item.visible && id === 'price' ? <OptionGrid label="가격 표기" values={PRICE_STYLES} columns={2} selected={priceStyle} word={(style) => PRICE_WORDS[style]} onPick={(next) => onDraft({ ...draft, priceStyle: next })} /> : null}
      {item.visible ? <FontStepper word={ITEM_WORDS[id]} size={item.fontSize} canGrow={canGrowFont(item, heightDots)} onStep={(delta) => onItem(fontStepped(item, delta, heightDots))} /> : null}
    </View>
  )
}
/** 라벨 미리 보기 뒤 바탕 — 흰 용지가 또렷하게 (D-LABEL-TABS-01, 사용자 지시 "용지 뒷배경 더 어둡게") */
const DESK = '#D1D6DB'

/** 스타일 고르기 — 서버가 그린 예시 그림을 두 줄(2열)로 (D-LABEL-TABS-01, 사용자 지시 "기본형 텍스트만 넣지 말고 예시 디자인도 같이 보이게 해. 열 2개") */
function StyleGrid({ selected, art, dots, onPick }: { readonly selected: ProductDesign; readonly art: Partial<Record<ProductDesign, string>>; readonly dots: NonNullable<ReturnType<typeof labelDots>>; readonly onPick: (design: ProductDesign) => void }) {
  const { p } = useKit()
  // 예시도 종이 전체 위에 그림을 놓는다 (위 미리 보기와 같다)
  const paper = paperDots(dots)
  const inset = { position: 'absolute', left: `${(100 * paper.left) / paper.width}%`, right: `${(100 * paper.left) / paper.width}%`, top: `${(100 * paper.top) / paper.height}%`, bottom: `${(100 * paper.top) / paper.height}%` } as const
  const rows = [DESIGNS.slice(0, 2), DESIGNS.slice(2)]
  return <View role="radiogroup" aria-label="라벨 스타일" style={{ gap: SPACE.sm }}>
    {rows.map((row, index) => <View key={index} style={{ flexDirection: 'row', gap: SPACE.sm }}>
      {row.map(({ value, label }) => {
        const on = value === selected
        const png = art[value]
        return <View key={value} style={{ flex: 1 }}>
          <Tap role="radio" aria-checked={on} aria-label={label} onPress={() => onPick(value)} style={({ pressed }) => ({ padding: SPACE.sm, gap: SPACE.xs, alignItems: 'center', borderRadius: RADIUS.md, borderCurve: 'continuous', borderWidth: on ? 2 : 1, borderColor: on ? p.primary : p.border, backgroundColor: pressed ? p.pressed : on ? p.freshBg : p.surface })}>
            <View style={{ width: '100%', aspectRatio: paper.width / paper.height, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: p.softPressed, overflow: 'hidden' }}>
              {png !== undefined ? <Image accessible={false} accessibilityIgnoresInvertColors source={{ uri: `data:image/png;base64,${png}` }} resizeMode="stretch" style={inset} /> : <ActivityIndicator style={{ flex: 1 }} color={p.textSub} />}
            </View>
            <Txt step="meta" center weight={on ? 'bold' : 'medium'} color={on ? 'primaryText' : 'text'}>{label}</Txt>
          </Tap>
        </View>
      })}
      {row.length < 2 ? <View style={{ flex: 1 }} /> : null}
    </View>)}
  </View>
}
const NOTE_CORNERS = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const

function PageArrow({ next, disabled, onPress }: { readonly next: boolean; readonly disabled: boolean; readonly onPress: () => void }) {
  const { p } = useKit()
  return <Tap role="button" aria-label={next ? '다음 문구' : '이전 문구'} disabled={disabled} onPress={onPress} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.3 : 1 }}>
    <View style={{ transform: [{ rotate: next ? '0deg' : '180deg' }] }}><Icon name="chevron" color={p.textSub} size={18} /></View>
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
function FontStepper({ word, size, canGrow, onStep }: { readonly word: string; readonly size: number; readonly canGrow: boolean; readonly onStep: (delta: number) => void }) {
  const { p } = useKit()
  const key = (sign: string, delta: number, name: string, off: boolean) => (
    <Tap role="button" aria-label={`${word} 글자 ${name}`} aria-disabled={off} disabled={off} onPress={() => onStep(delta)} style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: pressed ? p.softPressed : p.surfaceAlt, opacity: off ? 0.45 : 1 })}>
      <Txt step="bodyLarge" weight="bold">
        {sign}
      </Txt>
    </Tap>
  )
  return (
    // 문구 탭 오른쪽 좁은 칸에도 한 줄로 들어가게 (D-LABEL-ITEMS-01)
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, minHeight: TOUCH.min }}>
      <View style={{ flex: 1 }}>
        <Txt step="bodyLarge" weight="medium" numberOfLines={1} adjustsFontSizeToFit>
          글자 크기
        </Txt>
      </View>
      {key('−', -2, '작게', size <= FONT_SIZE_MIN)}
      <View style={{ minWidth: 32, alignItems: 'center' }}>
        <Txt weight="bold" aria-label={`${word} 글자 크기 ${String(size)}`}>
          {String(size)}
        </Txt>
      </View>
      {key('+', 2, '크게', !canGrow)}
    </View>
  )
}

/**
 * 크게 연 라벨 미리 보기 + 칸 고르기·옮기기·크기 (D-UX4-05). 칸 자리는 템플릿 점(8점 = 1mm)을 화면 폭에 맞춰 그린다.
 * 칸을 누르면 골라지고, 고른 칸은 끌면 옮겨지고 오른쪽 가운데 손잡이로 폭, 오른쪽 아래 손잡이로 글자 크기(높이는 글자 한 줄)와 폭을 바꾼다.
 * 옮기거나 크기를 바꾸는 동안 다른 켜진 칸·라벨 틀의 선에 붙고 안내선을 보인다 — 파워포인트 스마트 가이드처럼 (D-LABEL-SNAP-01, 사용자 지시 2026-11-23
 * "각 항목 박스 눌러서 위치 이동 시킬 때 주변 박스들의 위치에 맞춰 스냅 … 사이즈 조절할 때도 주변 박스와 스냅되게").
 */
function LabelEditor({ draft, preview, dots, picked, onPick, onItem, minFor, disabled }: {
  readonly draft: ProductTemplate
  readonly preview: DraftPreview | null
  readonly dots: NonNullable<ReturnType<typeof labelDots>>
  readonly picked: ProductItemId | null
  readonly onPick: (id: ProductItemId | null) => void
  readonly onItem: (id: ProductItemId, item: TemplateItem) => void
  readonly minFor: (id: ProductItemId) => BoxMin
  readonly disabled: boolean
}) {
  const { p } = useKit()
  const [stage, setStage] = useState({ width: 0, height: 0 })
  const [guides, setGuides] = useState<readonly SnapGuide[]>([])
  const { widthDots, heightDots } = dots
  const paper = paperDots(dots)
  const width = Math.max(0, Math.min(stage.width - SPACE.xxl * 2, (stage.height - SPACE.lg * 2) * paper.width / paper.height, 500))
  const scale = width / paper.width
  // 서버가 그리는 것과 같이 종이 가장자리 1mm 안전 영역 안, 직접 입력 문구 줄을 뺀 자리에 칸을 놓는다 (D-LABEL-SAFE-01)
  const { body } = productArea(draft.captions ?? [], widthDots, heightDots, safeMargin(dots))
  const bodyScaleX = (scale * body.width) / widthDots
  const bodyScaleY = (scale * body.height) / heightDots
  const visible = ITEM_ORDER.filter((id) => itemOf(draft, id).visible)
  const pickedItem = picked === null ? null : itemOf(draft, picked)
  const frame: SnapRect = { x: 0, y: 0, width: widthDots, height: heightDots }
  /** 붙는 거리: 화면 약 7px를 점으로 */
  const threshold = 7 / Math.max(0.01, Math.min(bodyScaleX, bodyScaleY))
  /** 끄는 중 — 시작 칸(start)과 손가락 이동(점)으로 새 칸을 정하고 붙은 선을 안내선으로 */
  const drag = (id: ProductItemId, start: TemplateItem, kind: HandleKind, dx: number, dy: number) => {
    const others = visible.filter((other) => other !== id).map((other) => itemOf(draft, other))
    if (kind === 'move') {
      const raw = movedItem(start, dx, dy, widthDots, heightDots)
      const snapped = snapMove(raw, others, frame, threshold)
      setGuides(snapped.guides)
      onItem(id, { ...start, x: snapped.rect.x, y: snapped.rect.y })
      return
    }
    const min = minFor(id)
    const line = textBoxHeight(start.fontSize)
    const raw = { x: start.x, y: start.y, width: start.width + dx, height: kind === 'size' ? line + dy : line }
    const snapped = snapResize(raw, { right: true, bottom: kind === 'size' }, others, frame, threshold, { width: min.width, height: Math.max(min.height, textBoxHeight(FONT_SIZE_MIN)) })
    setGuides(snapped.guides)
    const dw = snapped.rect.width - start.width
    onItem(id, kind === 'size' ? resizedItem(start, dw, snapped.rect.height - line, widthDots, heightDots, min) : widenedItem(start, dw, widthDots, heightDots, min))
  }
  return (
    <View onLayout={({ nativeEvent: { layout } }) => setStage((now) => now.width === layout.width && now.height === layout.height ? now : { width: layout.width, height: layout.height })} pointerEvents={disabled ? 'none' : 'auto'} style={{ flex: 1, alignItems: 'center', paddingTop: SPACE.lg }}>
      <View aria-label="라벨 미리 보기" style={{ width, height: width * paper.height / paper.width, overflow: 'hidden', backgroundColor: '#FFFFFF' }}>
        <View style={{ position: 'absolute', left: paper.left * scale, top: paper.top * scale, width: widthDots * scale, height: heightDots * scale }}>
          {preview !== null ? <Image accessible={false} accessibilityIgnoresInvertColors source={{ uri: `data:image/png;base64,${preview.png}` }} resizeMode="stretch" style={{ width: '100%', height: '100%', position: 'absolute' }} /> : <ActivityIndicator style={{ flex: 1 }} color={p.primary} />}
          <View pointerEvents="box-none" style={{ position: 'absolute', left: body.x * scale, width: body.width * scale, top: body.y * scale, height: body.height * scale }}>
            {visible.map((id) => {
              const item = itemOf(draft, id)
              const on = picked === id
              return (
                <Tap
                  key={id}
                  role="button"
                  aria-label={`라벨의 ${ITEM_WORDS[id]}`}
                  aria-pressed={on}
                  onPress={() => onPick(id)}
                  style={{ position: 'absolute', left: item.x * bodyScaleX, top: item.y * bodyScaleY, width: item.width * bodyScaleX, height: item.height * bodyScaleY, borderRadius: 4, borderCurve: 'continuous', borderWidth: on ? 2 : 0, borderColor: p.primary, backgroundColor: on ? 'rgba(31,122,77,0.08)' : 'transparent' }}
                />
              )
            })}
            {/* 안내선 — 붙은 선을 따라 얇은 분홍 선 (손을 떼면 사라진다) */}
            {guides.map((guide) => (
              <View
                key={`${guide.axis}${String(guide.at)}`}
                testID="snap-guide"
                pointerEvents="none"
                aria-hidden
                style={guide.axis === 'x'
                  ? { position: 'absolute', left: guide.at * bodyScaleX - 0.5, top: guide.from * bodyScaleY, width: 1, height: Math.max(1, (guide.to - guide.from) * bodyScaleY), backgroundColor: GUIDE }
                  : { position: 'absolute', top: guide.at * bodyScaleY - 0.5, left: guide.from * bodyScaleX, height: 1, width: Math.max(1, (guide.to - guide.from) * bodyScaleX), backgroundColor: GUIDE }}
              />
            ))}
            {picked !== null && pickedItem !== null && pickedItem.visible && bodyScaleY > 0 ? (
              <ItemHandles key={picked} item={pickedItem} scaleX={bodyScaleX} scaleY={bodyScaleY} onTap={() => onPick(null)} onDrag={(start, kind, dx, dy) => drag(picked, start, kind, dx, dy)} onEnd={() => setGuides([])} />
            ) : null}
          </View>
        </View>
      </View>
    </View>
  )
}

/** 안내선 색 — 파워포인트 스마트 가이드처럼 눈에 띄는 분홍 */
const GUIDE = '#E5487F'

/** 끄는 자리: 칸 전체(옮기기) · 오른쪽 가운데(폭) · 오른쪽 아래(글자 크기와 폭) */
type HandleKind = 'move' | 'width' | 'size'

/** 고른 칸 위의 끌기 자리와 크기 손잡이 둘 (손가락 움직임 → 점 단위로 바꿔 onDrag) */
function ItemHandles({ item, scaleX, scaleY, onTap, onDrag, onEnd }: {
  readonly item: TemplateItem
  readonly scaleX: number
  readonly scaleY: number
  readonly onTap: () => void
  readonly onDrag: (start: TemplateItem, kind: HandleKind, dx: number, dy: number) => void
  readonly onEnd: () => void
}) {
  const { p } = useKit()
  const latest = useRef({ item, scaleX, scaleY, onTap, onDrag, onEnd })
  latest.current = { item, scaleX, scaleY, onTap, onDrag, onEnd }
  const start = useRef(item)
  const make = (kind: HandleKind) =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        start.current = latest.current.item
      },
      onPanResponderMove: (_, gesture) => {
        const { scaleX: kx, scaleY: ky } = latest.current
        if (kx <= 0 || ky <= 0) return
        latest.current.onDrag(start.current, kind, gesture.dx / kx, gesture.dy / ky)
      },
      onPanResponderRelease: (_, gesture) => {
        latest.current.onEnd()
        if (kind === 'move' && Math.abs(gesture.dx) < 4 && Math.abs(gesture.dy) < 4) latest.current.onTap()
      },
      onPanResponderTerminate: () => latest.current.onEnd(),
    })
  const mover = useRef(make('move')).current
  const widener = useRef(make('width')).current
  const sizer = useRef(make('size')).current
  const knob = 22
  const bar = { width: 10, height: 22 }
  const left = (item.x + item.width) * scaleX
  return (
    <>
      <View {...mover.panHandlers} aria-hidden style={{ position: 'absolute', left: item.x * scaleX, top: item.y * scaleY, width: item.width * scaleX, height: item.height * scaleY }} />
      <View
        {...widener.panHandlers}
        aria-hidden
        hitSlop={12}
        style={{ position: 'absolute', left: left - bar.width / 2, top: (item.y + item.height / 2) * scaleY - bar.height / 2, width: bar.width, height: bar.height, borderRadius: bar.width / 2, borderCurve: 'continuous', backgroundColor: p.primary, borderWidth: 2, borderColor: '#FFFFFF' }}
      />
      <View
        {...sizer.panHandlers}
        aria-hidden
        hitSlop={12}
        style={{ position: 'absolute', left: left - knob / 2, top: (item.y + item.height) * scaleY - knob / 2, width: knob, height: knob, borderRadius: knob / 2, borderCurve: 'continuous', backgroundColor: p.primary, borderWidth: 3, borderColor: '#FFFFFF' }}
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
