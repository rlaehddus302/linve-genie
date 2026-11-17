// 손글씨로 글자 넣기 (D-HANDWRITE-02, 판매자 2026-11-17 "손글씨는 숫자 말고 품종 같은 텍스트 넣을때만" — 옛 D-HANDWRITE-01은 숫자 칸):
// - HandwritingPad: 손가락으로 긋는 큰 판(획을 굵게 그린다). 판 안에서 긋는 것은 판이 다 가져간다(창이 내려가거나 목록이 밀리지 않는다).
// - HandwritingSheet: 화면 폭 전체의 반 화면 판 — 위에 읽은 글, [띄우기]·[← 한 글자], "혹시" 후보(다른 읽기·품종 이름), 큰 쓰는 판,
//   아래 [지우기 | 넣기](부정 왼쪽·긍정 오른쪽). 잠깐 멈추면 글자로 읽어 위 글 뒤에 붙이고 판이 비어 이어 쓸 수 있다.
// - HandwritingButton: 칸 옆 [손글씨] 단추 (펜 그림 + 글자). 손글씨 읽기가 없는 앱(옛 빌드·웹)에서는 그리지 않는다.
// 읽기는 휴대폰 안에서만(lib/ink-reader.ts) — 획을 밖으로 보내지 않는다.
import { useEffect, useReducer, useRef, useState } from 'react'
import { PanResponder, ScrollView, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { tapHaptic } from '../../native/haptics.ts'
import { EMPTY_PAD, insertText, padReducer, SETTLE_MS, type InkPoint, type InkStroke } from '../../lib/handwriting.ts'
import { prepareInk, readInk, useInkReader } from '../../lib/ink-reader.ts'
import { BigButton } from './buttons.tsx'
import { Tap } from './press.tsx'
import { BottomSheet } from './sheets.tsx'
import { Txt, useKit } from './theme.tsx'
import { RADIUS, SPACE, TOUCH } from './tokens.ts'

/** 화면에 보이는 말 (쉬운 한국어) */
export const HANDWRITING_WORDS = {
  button: '손글씨',
  /** 단추 글 (D-ADDPIECES-01, 사용자 지시 2026-11-17 "[손글씨로 적을게요]로 이름 바꾸고 … 둥근 네모로") */
  write: '손글씨로 적을게요',
  description: '손가락으로 크게 써 주세요. 잠깐 멈추면 글자로 바뀌어요. 두세 글자씩 나눠 써도 이어 붙어요.',
  padHint: '여기에 크게 써 주세요',
  padLabel: '손글씨 쓰는 곳',
  empty: '쓴 글자가 여기 보여요',
  reading: '읽고 있어요…',
  preparing: '글씨 읽기를 준비하고 있어요. 처음 한 번은 조금 걸려요.',
  failed: '글씨 읽기를 준비하지 못했어요. 인터넷을 확인하고 다시 열어 주세요.',
  missed: '못 읽었어요. 조금 더 크게 다시 써 주세요.',
  maybe: '혹시 이 이름이에요?',
  space: '띄우기',
  spaceLabel: '한 칸 띄우기',
  back: '한 글자 지우기',
  clear: '지우기',
  insert: '넣기',
} as const

/** 너무 길면: 칸에 넣지 않고 알린다 (잘라 넣지 않는다) */
export const tooLongWords = (max: number): string => `${String(max)}자까지만 넣을 수 있어요. 한 글자씩 지워 주세요.`

/**
 * 쓰는 판 높이: 판 안의 다른 것(제목·글·후보 자리·단추 ≈ 500)을 빼고 남는 만큼 — 170 ~ 320.
 * 판이 넘쳐 스크롤이 생기면 아이폰은 아래로 긋는 손가락을 스크롤이 가져가므로, 보통 글자 크기에서는 넘치지 않게 잡는다.
 */
export function padHeightFor(windowHeight: number): number {
  return Math.round(Math.min(320, Math.max(170, windowHeight - 500)))
}

/** 후보 자리 높이 — 후보가 없어도 비워 둔다(쓰는 중에 후보가 생겨 판이 아래로 밀리면 획이 어긋난다) */
const CHOICE_ROOM = 70

/** 선 굵기 — 휴대폰을 눕혀 두고 크게 써도 잘 보이게 */
const INK_WIDTH = 9
/** 이만큼 움직여야 새 점 (손 떨림 점 줄이기) */
const MIN_STEP = 1.5

const pathOf = (stroke: InkStroke): string => {
  const [first, ...rest] = stroke
  if (first === undefined) return ''
  // 점 하나(톡)도 보이게 아주 짧은 선
  if (rest.length === 0) return `M${first.x.toFixed(1)} ${first.y.toFixed(1)} l0.1 0`
  return `M${first.x.toFixed(1)} ${first.y.toFixed(1)}${rest.map((p) => ` L${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('')}`
}

export interface HandwritingPadProps {
  /** 아직 굳히지 않은 획 (판에 그려 둔다) */
  readonly ink: readonly InkStroke[]
  readonly height: number
  /** 손가락이 닿았다 (멈춤 시계를 멈춘다) */
  readonly onPenDown: () => void
  /** 획 하나를 다 그었다 */
  readonly onStroke: (stroke: InkStroke) => void
  /** 판 크기를 알았다 (읽을 때 쓰는 곳 크기로 넘긴다) */
  readonly onWidth?: (width: number) => void
  readonly testID?: string
}

/** 손가락으로 긋는 판. 판 안의 긋기는 판이 끝까지 가진다(창 끌기·스크롤에 넘기지 않는다) */
export function HandwritingPad({ ink, height, onPenDown, onStroke, onWidth, testID }: HandwritingPadProps) {
  const { p } = useKit()
  const [width, setWidth] = useState(0)
  const [current, setCurrent] = useState<readonly InkPoint[]>([])
  const live = useRef<{ points: InkPoint[]; ox: number; oy: number; px: number; py: number } | null>(null)
  const calls = useRef({ onPenDown, onStroke })
  useEffect(() => {
    calls.current = { onPenDown, onStroke }
  })
  const [responder] = useState(() => {
    const finish = () => {
      const stroke = live.current?.points ?? []
      live.current = null
      setCurrent([])
      if (stroke.length > 0) calls.current.onStroke(stroke)
    }
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (event) => {
        const { locationX, locationY, pageX, pageY } = event.nativeEvent
        const first = { x: locationX, y: locationY, t: Date.now() }
        live.current = { points: [first], ox: locationX, oy: locationY, px: pageX, py: pageY }
        setCurrent([first])
        calls.current.onPenDown()
      },
      onPanResponderMove: (event) => {
        const now = live.current
        if (now === null) return
        // 화면 기준 움직임으로 잰다 — 손가락 아래 요소가 바뀌어도 자리가 튀지 않는다
        const point = { x: now.ox + event.nativeEvent.pageX - now.px, y: now.oy + event.nativeEvent.pageY - now.py, t: Date.now() }
        const last = now.points[now.points.length - 1]
        if (last !== undefined && Math.hypot(point.x - last.x, point.y - last.y) < MIN_STEP) return
        now.points.push(point)
        setCurrent([...now.points])
      },
      onPanResponderRelease: finish,
      onPanResponderTerminate: finish,
    })
  })
  const empty = ink.length === 0 && current.length === 0
  return (
    <View
      {...responder.panHandlers}
      testID={testID}
      role="img"
      aria-label={HANDWRITING_WORDS.padLabel}
      onLayout={(event: LayoutChangeEvent) => {
        setWidth(event.nativeEvent.layout.width)
        onWidth?.(event.nativeEvent.layout.width)
      }}
      style={{ height, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: p.surfaceAlt, overflow: 'hidden' }}
    >
      {/* 글자 줄 안내: 가운데 아래쪽 옅은 밑줄 하나 */}
      <View pointerEvents="none" aria-hidden style={{ position: 'absolute', left: SPACE.xl, right: SPACE.xl, top: Math.round(height * 0.8), height: 2, borderRadius: 1, borderCurve: 'continuous', backgroundColor: p.line }} />
      {empty ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Txt step="bodyLarge" ink={p.placeholder} center>
            {HANDWRITING_WORDS.padHint}
          </Txt>
        </View>
      ) : null}
      {width > 0 ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0 }}>
          <Svg width={width} height={height}>
            {[...ink, current].map((stroke, index) => (stroke.length === 0 ? null : <Path key={index} d={pathOf(stroke)} stroke={p.text} strokeWidth={INK_WIDTH} strokeLinecap="round" strokeLinejoin="round" fill="none" />))}
          </Svg>
        </View>
      ) : null}
    </View>
  )
}

/** [손글씨로 적을게요] 단추: 글자만(펜 그림은 D-ADDPIECES-02에서 뺐다), 캡슐이 아닌 둥근 네모 — 품종 없이 넘어갈게요 칩과 같은 꼴 (D-ADDPIECES-01). 눌림 자리 48 */
// compact: 글자 칸 안 오른쪽에 붙는 단추 — 칸이 좁아지지 않게 짧은 [손글씨]
export function HandwritingButton({ label, onPress, testID, compact = false }: { readonly label: string; readonly onPress: () => void; readonly testID?: string; readonly compact?: boolean }) {
  const { p } = useKit()
  const can = useInkReader()
  if (!can) return null
  return (
    <Tap
      role="button"
      aria-label={`${label} ${HANDWRITING_WORDS.button}로 쓰기`}
      testID={testID}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => ({ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', paddingHorizontal: compact ? SPACE.sm + 2 : SPACE.md, paddingVertical: compact ? SPACE.xs + 2 : SPACE.sm, borderRadius: RADIUS.sm, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : p.surfaceAlt })}
    >
      <Txt step={compact ? 'meta' : 'body'} weight="book" ink={p.tabInk}>
        {compact ? HANDWRITING_WORDS.button : HANDWRITING_WORDS.write}
      </Txt>
    </Tap>
  )
}

export interface HandwritingSheetProps {
  readonly visible: boolean
  readonly onClose: () => void
  /** 무엇을 쓰는지 ("품종") — 판 제목 */
  readonly label: string
  /** [넣기]: 읽은 글 */
  readonly onInsert: (text: string) => void
  /** 넣을 수 있는 글자 수 (넘으면 넣지 않고 알린다) */
  readonly maxLength?: number
  /** 자주 쓰는 말(품종 이름) — 비슷하게 읽히면 이 표기로 고치고 "혹시" 후보에 보인다 */
  readonly hints?: readonly string[]
  readonly testID?: string
}

type Ready = 'preparing' | 'ready' | 'failed'

/** 손글씨 글자 판 (반 화면 — 화면 폭 전체) */
export function HandwritingSheet({ visible, onClose, label, onInsert, maxLength, hints = [], testID }: HandwritingSheetProps) {
  const { p } = useKit()
  const { height: windowHeight } = useWindowDimensions()
  const padHeight = padHeightFor(windowHeight)
  const [state, dispatch] = useReducer(padReducer, EMPTY_PAD)
  const [ready, setReady] = useState<Ready>('preparing')
  const [reading, setReading] = useState(0)
  const padWidth = useRef(0)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef({ ink: state.ink, hints, padHeight })
  useEffect(() => {
    latest.current = { ink: state.ink, hints, padHeight }
  })
  const stop = () => {
    if (settleTimer.current !== null) clearTimeout(settleTimer.current)
    settleTimer.current = null
  }
  // 열 때마다 빈 판 · 읽을 준비 (안드로이드는 처음 한 번 모델을 받는다)
  useEffect(() => {
    if (!visible) return stop
    dispatch({ type: 'clear' })
    setReading(0)
    let live = true
    setReady('preparing')
    void prepareInk().then((ok) => {
      if (live) setReady(ok ? 'ready' : 'failed')
    })
    return () => {
      live = false
      stop()
    }
  }, [visible])
  const read = () => {
    settleTimer.current = null
    const { ink, hints: words, padHeight: height } = latest.current
    if (ink.length === 0) return
    setReading((count) => count + 1)
    void readInk(ink, padWidth.current, height, words).then((candidates) => {
      setReading((count) => Math.max(0, count - 1))
      dispatch({ type: 'read', strokes: ink, candidates, hints: words })
    })
  }
  const onPenDown = () => stop()
  const onStroke = (stroke: InkStroke) => {
    dispatch({ type: 'stroke', stroke })
    stop()
    settleTimer.current = setTimeout(read, SETTLE_MS)
  }
  const shown = insertText(state)
  const tooLong = maxLength !== undefined && Array.from(shown).length > maxLength
  const canInsert = shown !== '' && !tooLong && state.ink.length === 0 && reading === 0
  const insert = () => {
    stop()
    onInsert(shown)
    onClose()
  }
  const pick = (option: string) => {
    tapHaptic()
    dispatch({ type: 'pick', option })
  }
  const status = tooLong && maxLength !== undefined ? tooLongWords(maxLength) : ready === 'failed' ? HANDWRITING_WORDS.failed : ready === 'preparing' ? HANDWRITING_WORDS.preparing : state.missed ? HANDWRITING_WORDS.missed : null
  const small = ({ pressed, disabled }: { readonly pressed: boolean; readonly disabled: boolean }) => ({ minWidth: TOUCH.min, height: TOUCH.min, paddingHorizontal: SPACE.md, borderRadius: RADIUS.md, borderCurve: 'continuous' as const, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: pressed ? p.pressed : p.surfaceAlt, opacity: disabled ? 0.4 : 1 })
  const noText = state.text === '' && state.ink.length === 0
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={label}
      description={HANDWRITING_WORDS.description}
      half
      contentDrag={false}
      testID={testID}
      actions={[
        <BigButton key="clear" kind="secondary" label={HANDWRITING_WORDS.clear} disabled={noText} onPress={() => { stop(); dispatch({ type: 'clear' }) }} />,
        <BigButton key="insert" label={HANDWRITING_WORDS.insert} disabled={!canInsert} onPress={insert} testID="handwriting-insert" />,
      ]}
    >
      {/* 읽은 글 (읽는 중이면 뒤에 흐리게 "읽고 있어요…") · 오른쪽 [띄우기] [← 한 글자] */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, minHeight: TOUCH.min }}>
        <View role="status" aria-label={shown === '' ? (reading > 0 ? HANDWRITING_WORDS.reading : HANDWRITING_WORDS.empty) : shown} style={{ flex: 1, flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: SPACE.sm }}>
          {shown === '' && reading === 0 ? (
            <Txt step="bodyLarge" ink={p.placeholder}>
              {HANDWRITING_WORDS.empty}
            </Txt>
          ) : (
            <>
              {shown === '' ? null : (
                <Txt step="title" weight="bold" numberOfLines={2}>
                  {shown}
                </Txt>
              )}
              {reading > 0 ? (
                <Txt step="body" ink={p.placeholder}>
                  {HANDWRITING_WORDS.reading}
                </Txt>
              ) : null}
            </>
          )}
        </View>
        <Tap role="button" aria-label={HANDWRITING_WORDS.spaceLabel} disabled={state.text === '' || state.text.endsWith(' ')} onPress={() => dispatch({ type: 'space' })} style={({ pressed }) => small({ pressed, disabled: state.text === '' || state.text.endsWith(' ') })}>
          <Txt step="body" weight="medium" color="textSub">
            {HANDWRITING_WORDS.space}
          </Txt>
        </Tap>
        <Tap role="button" aria-label={HANDWRITING_WORDS.back} disabled={noText} onPress={() => { stop(); dispatch({ type: 'back' }) }} style={({ pressed }) => small({ pressed, disabled: noText })}>
          <Txt step="body" weight="medium" color="textSub">
            ← 한 글자
          </Txt>
        </Tap>
      </View>
      {/* 후보 자리(늘 같은 높이 — 쓰는 중에 판이 아래로 밀리면 획이 어긋난다): 알림, 아니면 "혹시" 후보 — 누르면 위 글이 그 글로 바뀐다 */}
      {status !== null ? (
        <View style={{ height: CHOICE_ROOM }}>
          <Txt step="body" weight="book" color={tooLong || ready === 'failed' ? 'dangerText' : 'textSub'} role={tooLong || ready === 'failed' || state.missed ? 'alert' : undefined}>
            {status}
          </Txt>
        </View>
      ) : state.choices.length === 0 ? (
        <View style={{ height: CHOICE_ROOM }} />
      ) : (
        <View style={{ height: CHOICE_ROOM, gap: SPACE.xs }}>
          <Txt step="caption" color="textSub">
            {HANDWRITING_WORDS.maybe}
          </Txt>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACE.sm }} keyboardShouldPersistTaps="handled">
            {state.choices.map((choice) => (
              <Tap
                key={choice}
                role="button"
                aria-label={`${choice} 고르기`}
                onPress={() => pick(choice)}
                hitSlop={4}
                style={({ pressed }) => ({ minHeight: 44, minWidth: 64, paddingHorizontal: SPACE.lg, borderRadius: RADIUS.pill, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: p.primary, backgroundColor: pressed ? p.pressed : p.surface })}
              >
                <Txt step="lead" weight="bold" color="primaryText" numberOfLines={1}>
                  {choice}
                </Txt>
              </Tap>
            ))}
          </ScrollView>
        </View>
      )}
      <HandwritingPad ink={state.ink} height={padHeight} onPenDown={onPenDown} onStroke={onStroke} onWidth={(width) => { padWidth.current = width }} testID="handwriting-pad" />
    </BottomSheet>
  )
}
