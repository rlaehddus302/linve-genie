// 손글씨로 숫자 넣기 (D-HANDWRITE-01, 판매자 요청 2026-11-17 "손글씨 기능 추가해줘. 폰을 내려놓은 상태에선 타자가 더 힘듦"):
// - HandwritingPad: 손가락으로 긋는 큰 판(획을 굵게 그린다). 판 안에서 긋는 것은 판이 다 가져간다(창이 내려가거나 목록이 밀리지 않는다).
// - HandwritingSheet: 화면 폭 전체의 반 화면 판 — 위에 읽은 숫자(쓰는 중은 흐리게), "혹시" 후보 단추, 큰 쓰는 판, [멈추면 바로 넣기],
//   아래 [지우기 | 넣기](부정 왼쪽·긍정 오른쪽). 잠깐 멈추면 숫자로 굳고 판이 비어 이어 쓸 수 있다.
// - HandwritingButton: 칸 옆 [손글씨] 단추 (펜 그림 + 글자).
// 읽기는 휴대폰 안에서만(lib/handwriting.ts) — 인터넷·서버 없이 바로.
import { useEffect, useReducer, useRef, useState } from 'react'
import { PanResponder, ScrollView, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { tapHaptic } from '../../native/haptics.ts'
import type { InkPoint, InkStroke } from '../../lib/handwriting.ts'
import { AUTO_INSERT_MS, EMPTY_PAD, padChoices, padReducer, SETTLE_MS } from '../../lib/handwriting-pad.ts'
import { correctionsOf } from '../../lib/handwriting.ts'
import { learnDigits, setAutoInsert, useHandwriting } from '../../lib/handwriting-store.ts'
import { Icon } from './app.tsx'
import { BigButton } from './buttons.tsx'
import { ToggleRow } from './layout.tsx'
import { Tap } from './press.tsx'
import { BottomSheet } from './sheets.tsx'
import { Txt, useKit } from './theme.tsx'
import { RADIUS, SPACE, TOUCH } from './tokens.ts'

/** 화면에 보이는 말 (쉬운 한국어) */
export const HANDWRITING_WORDS = {
  button: '손글씨',
  description: '손가락으로 숫자를 크게 써 주세요. 잠깐 멈추면 숫자로 바뀌어요.',
  padHint: '여기에 숫자를 크게 써 주세요',
  padLabel: '손글씨 쓰는 곳',
  empty: '쓴 숫자가 여기 보여요',
  maybe: '혹시 이 숫자예요?',
  back: '한 글자 지우기',
  clear: '지우기',
  insert: '넣기',
  auto: '멈추면 바로 넣기',
  autoHelp: '쓰고 1초쯤 멈추면 [넣기]를 누르지 않아도 칸에 들어가요.',
} as const

/** 너무 길면: 칸에 넣지 않고 알린다 (잘라 넣지 않는다 — 가격이 몰래 바뀌지 않게) */
export const tooLongWords = (max: number): string => `${String(max)}자리까지만 넣을 수 있어요. 한 글자씩 지워 주세요.`

/**
 * 쓰는 판 높이: 판 안의 다른 것(제목·숫자·후보 자리·켜기 줄·단추 ≈ 500)을 빼고 남는 만큼 — 170 ~ 320.
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
  readonly testID?: string
}

/** 손가락으로 긋는 판. 판 안의 긋기는 판이 끝까지 가진다(창 끌기·스크롤에 넘기지 않는다) */
export function HandwritingPad({ ink, height, onPenDown, onStroke, testID }: HandwritingPadProps) {
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
        const first = { x: locationX, y: locationY }
        live.current = { points: [first], ox: locationX, oy: locationY, px: pageX, py: pageY }
        setCurrent([first])
        calls.current.onPenDown()
      },
      onPanResponderMove: (event) => {
        const now = live.current
        if (now === null) return
        // 화면 기준 움직임으로 잰다 — 손가락 아래 요소가 바뀌어도 자리가 튀지 않는다
        const point = { x: now.ox + event.nativeEvent.pageX - now.px, y: now.oy + event.nativeEvent.pageY - now.py }
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
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
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

/** [손글씨] 단추: 펜 그림 + 글자 (그림만 두지 않는다). 눌림 자리 48 */
export function HandwritingButton({ label, onPress, testID }: { readonly label: string; readonly onPress: () => void; readonly testID?: string }) {
  const { p } = useKit()
  return (
    <Tap
      role="button"
      aria-label={`${label} ${HANDWRITING_WORDS.button}로 쓰기`}
      testID={testID}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 2, height: 36, paddingHorizontal: SPACE.sm + 2, borderRadius: RADIUS.pill, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : p.surfaceAlt })}
    >
      <Icon name="edit" size={18} color={p.textSub} />
      <Txt step="meta" weight="medium" color="textSub">
        {HANDWRITING_WORDS.button}
      </Txt>
    </Tap>
  )
}

export interface HandwritingSheetProps {
  readonly visible: boolean
  readonly onClose: () => void
  /** 무엇을 쓰는지 ("가격", "뒷자리 4개") — 판 제목 */
  readonly label: string
  /** [넣기]·멈추면 바로 넣기: 읽은 숫자 글 */
  readonly onInsert: (text: string) => void
  /** 넣을 수 있는 자리 수 (넘으면 넣지 않고 알린다) */
  readonly maxLength?: number
  /** 숫자 뒤 단위 ("원") */
  readonly unit?: string
  readonly testID?: string
}

/** 손글씨 숫자 판 (반 화면 — 화면 폭 전체) */
export function HandwritingSheet({ visible, onClose, label, onInsert, maxLength, unit, testID }: HandwritingSheetProps) {
  const { p } = useKit()
  const { height: windowHeight } = useWindowDimensions()
  const padHeight = padHeightFor(windowHeight)
  const { autoInsert, templates } = useHandwriting()
  const [state, dispatch] = useReducer(padReducer, EMPTY_PAD)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const insertTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stop = () => {
    if (settleTimer.current !== null) clearTimeout(settleTimer.current)
    if (insertTimer.current !== null) clearTimeout(insertTimer.current)
    settleTimer.current = null
    insertTimer.current = null
  }
  // 열 때마다 빈 판
  useEffect(() => {
    if (visible) dispatch({ type: 'clear' })
    return stop
  }, [visible])
  // 쓰는 중인 숫자(아직 굳지 않음)까지 합친 글 — [넣기]를 멈추기 전에 눌러도 보이는 그대로 넣는다
  const shown = state.text + (state.live?.text ?? '')
  const tooLong = maxLength !== undefined && shown.length > maxLength
  const canInsert = shown !== '' && !tooLong
  const latest = useRef({ canInsert, text: shown, autoInsert, onInsert, onClose })
  useEffect(() => {
    latest.current = { canInsert, text: shown, autoInsert, onInsert, onClose }
  })
  const insert = (text: string) => {
    stop()
    onInsert(text)
    onClose()
  }
  // 굳힌 뒤 멈춰 있으면 바로 넣기 (켰을 때만)
  useEffect(() => {
    if (!visible || !autoInsert || !canInsert || state.last === null || state.ink.length > 0) return
    insertTimer.current = setTimeout(() => {
      const now = latest.current
      if (now.autoInsert && now.canInsert) {
        now.onInsert(now.text)
        now.onClose()
      }
    }, AUTO_INSERT_MS)
    return () => {
      if (insertTimer.current !== null) clearTimeout(insertTimer.current)
    }
  }, [visible, autoInsert, canInsert, state.text, state.last, state.ink.length])
  const onPenDown = () => stop()
  const onStroke = (stroke: InkStroke) => {
    dispatch({ type: 'stroke', stroke, templates, padHeight })
    settleTimer.current = setTimeout(() => dispatch({ type: 'settle' }), SETTLE_MS)
  }
  const pick = (option: string) => {
    tapHaptic()
    stop()
    const reading = state.live ?? state.last?.reading ?? null
    // 후보를 골라 고친 글씨는 이 휴대폰이 배운다 (다음부터 같은 꼴을 바로 맞힌다)
    if (reading !== null) learnDigits(correctionsOf(reading, option))
    dispatch({ type: 'pick', option })
  }
  const choices = padChoices(state)
  const pendingFrom = state.text.length
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
        <BigButton key="clear" kind="secondary" label={HANDWRITING_WORDS.clear} disabled={shown === ''} onPress={() => { stop(); dispatch({ type: 'clear' }) }} />,
        <BigButton key="insert" label={HANDWRITING_WORDS.insert} disabled={!canInsert} onPress={() => insert(shown)} testID="handwriting-insert" />,
      ]}
    >
      {/* 읽은 숫자: 굳힌 것은 진하게, 쓰는 중은 흐리게 · 오른쪽 [한 글자 지우기] */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, minHeight: TOUCH.min }}>
        <View role="status" aria-label={shown === '' ? HANDWRITING_WORDS.empty : `${shown}${unit ?? ''}`} style={{ flex: 1, flexDirection: 'row', alignItems: 'baseline' }}>
          {shown === '' ? (
            <Txt step="bodyLarge" ink={p.placeholder}>
              {HANDWRITING_WORDS.empty}
            </Txt>
          ) : (
            <>
              <Txt step="amount" weight="bold" numberOfLines={1}>
                {state.text}
              </Txt>
              <Txt step="amount" weight="bold" ink={p.placeholder} numberOfLines={1}>
                {shown.slice(pendingFrom)}
              </Txt>
              {unit === undefined ? null : (
                <Txt step="title" weight="medium" color="textSub">
                  {` ${unit}`}
                </Txt>
              )}
            </>
          )}
        </View>
        <Tap
          role="button"
          aria-label={HANDWRITING_WORDS.back}
          disabled={shown === ''}
          onPress={() => { stop(); dispatch({ type: 'back' }) }}
          style={({ pressed }) => ({ minWidth: TOUCH.min, height: TOUCH.min, paddingHorizontal: SPACE.md, borderRadius: RADIUS.md, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? p.pressed : p.surfaceAlt, opacity: shown === '' ? 0.4 : 1 })}
        >
          <Txt step="body" weight="medium" color="textSub">
            ← 한 글자
          </Txt>
        </Tap>
      </View>
      {/* 후보 자리(늘 같은 높이): 너무 길면 알림, 아니면 후보 — 누르면 그 숫자로 고친다. 큰 둥근 단추, 가로로 민다 */}
      {tooLong && maxLength !== undefined ? (
        <View style={{ height: CHOICE_ROOM }}>
          <Txt step="body" weight="book" color="dangerText" role="alert">
            {tooLongWords(maxLength)}
          </Txt>
        </View>
      ) : choices.length === 0 ? (
        <View style={{ height: CHOICE_ROOM }} />
      ) : (
        <View style={{ height: CHOICE_ROOM, gap: SPACE.xs }}>
          <Txt step="caption" color="textSub">
            {HANDWRITING_WORDS.maybe}
          </Txt>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACE.sm }} keyboardShouldPersistTaps="handled">
            {choices.map((choice) => (
              <Tap
                key={choice.option}
                role="button"
                aria-label={`${choice.shown}${unit ?? ''} 고르기`}
                onPress={() => pick(choice.option)}
                hitSlop={4}
                style={({ pressed }) => ({ minHeight: 44, minWidth: 64, paddingHorizontal: SPACE.lg, borderRadius: RADIUS.pill, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: p.primary, backgroundColor: pressed ? p.pressed : p.surface })}
              >
                <Txt step="lead" weight="bold" color="primaryText">
                  {choice.shown}
                </Txt>
              </Tap>
            ))}
          </ScrollView>
        </View>
      )}
      <HandwritingPad ink={state.ink} height={padHeight} onPenDown={onPenDown} onStroke={onStroke} testID="handwriting-pad" />
      <ToggleRow title={HANDWRITING_WORDS.auto} subtitle={HANDWRITING_WORDS.autoHelp} on={autoInsert} onChange={setAutoInsert} testID="handwriting-auto" />
    </BottomSheet>
  )
}
