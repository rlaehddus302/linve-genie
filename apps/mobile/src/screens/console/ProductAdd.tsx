// 상품 추가 화면 (D-UX4-31, 사용자 지시 2026-11-09 토스 송금 사진 4·5·6): 상품 탭 오른쪽 아래 (+)로 연다(옛 "직접 넣기" 빠른 입력 시트를 바꿈).
// 맨 위 가운데 "상품 추가", 제목 없이 바로 밑줄 없는 큰 칸. 한 번에 하나씩 묻는다:
//   "상품 번호가 무엇인가요?" → [다음] → 번호는 위로 올라가고 "가격은 어떻게 되나요?"(아래에 한글 금액 "1만 5,000원")
//   → (다육이 방송이면) "어떤 품종인가요?" → 확인 화면 "15번 / 삼광색금 / 15,000원 / 상품을 추가할까요?" + [추가하기] → 방송 화면으로 돌아간다.
// 번호·가격은 시스템 키보드 대신 앱 숫자판(누르면 꾸욱 들어가며 작아진다), 값이 있으면 숫자판 바로 위에 [다음] 띠. 값 뒤에 "번"·"원"을 붙여 보인다.
// 품종은 글자라 휴대폰 키보드를 쓴다. 이미 올라온 단계는 눌러서 다시 고칠 수 있다.
// D-UX4-43 (사용자 지시 2026-11-09): 글자를 넣고 지울 때 그 글자가 부드럽게 나타나고 사라지며, 숫자판 키는 햅틱과 함께 꾸욱 눌린다.
// D-UX4-111 (사용자 지시 2026-11-10): 비어 있는 큰 칸은 맨 앞에 글자 자리 표시가 서서히 나타났다 사라지며 깜빡인다(옛 D-UX4-43은 없앴었다).
//   00을 눌러 자리 수를 넘겨도 친 것을 보여 준다. 첫 단계(번호)가 아니면 뒤로(머리 ‹·밀어서·안드로이드 뒤로)는 앞 단계로. 확인 화면은 번호 → 가격 → 품종, 화면 1/3 높이.
// [다음]은 꽉 찬 띠가 아니라 큰 단추, "품종 없이 넘어가기"는 토스 회색 칩. 품종 칸 휴대폰 키보드가 뜨면 [다음]이 키보드 위로 올라온다.
// 쓰기는 원문 칸(noText·priceText, SRV1 약속 2) — 가격은 "원"을 붙여 방송 가격 단위와 상관없이 원으로 읽힌다. 앱은 판정하지 않는다.
import { useEffect, useRef, useState } from 'react'
import { Animated, BackHandler, Easing, PanResponder, Platform, TextInput, View, useWindowDimensions, type GestureResponderEvent } from 'react-native'
import { isApiError } from '../../api/client.ts'
import { koreanWon } from '../../lib/korean-won.ts'
import { productKey } from '../../lib/derive.ts'
import { tapHaptic } from '../../native/haptics.ts'
import { BigButton, ErrorLine, PRESS_IN_MS, PRESS_OUT_MS, PressScale, SoftChip, Txt, font, useKit, useWrongShake, Tap } from '../../ui/kit/index.ts'
import { SPACE, TYPE, WEIGHT } from '../../ui/kit/tokens.ts'
import { edgeSwipeCloses, startsEdgeSwipe, useHoldRouteSwipe } from '../../ui/kit/route-swipe.tsx'
import { useConsoleApi } from './context.ts'
import { SlidePage, useFooterInset } from './parts.tsx'

type Step = 'no' | 'price' | 'name' | 'confirm'

export const ADD_TITLE = '상품 추가'
export const ASK_NO = '상품 번호가 무엇인가요?'
export const ASK_PRICE = '가격은 어떻게 되나요?'
export const ASK_NAME = '어떤 품종인가요?'
export const ASK_ADD = '상품을 추가할까요?'

/** 큰 칸 글자 (토스 "얼마나 옮길까요?" 사진을 재어 — 키트 headline과 같은 크기). 손님 정보 입력(D-UX4-126)도 같은 크기 */
export const BIG = TYPE.amount
/** 숫자판 키 높이 */
const KEY_HEIGHT = 64
const PAD: readonly (readonly string[])[] = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['00', '0', 'back']]
/** 상품 번호·휴대폰 번호 숫자판 — 00 자리는 비운다 (D-UX4-132, 사용자 지시 2026-11-12 "00 버튼만 빼고") */
const DIGIT_PAD: readonly (readonly string[])[] = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['', '0', 'back']]
export const DIGIT_PAD_HEIGHT = SPACE.xs + DIGIT_PAD.length * KEY_HEIGHT

/** 방송에 번호 끝이 없을 때 번호 칸이 받는 가장 큰 수 (네 자리) */
const NO_FALLBACK_MAX = 9999
/** 가격 칸 자리 수 (9억 원대까지) */
const PRICE_DIGITS = 9
export const PRICE_LIMIT = '가격은 9억 9,999만 9,999원까지 적을 수 있어요.'
export const noLimitWords = (max: number): string => `번호는 ${String(max)}번까지 적을 수 있어요.`

const won = (digits: string): string => `${Number(digits).toLocaleString('ko-KR')}원`

/** 확인 화면 글 묶음 위·아래 빈 자리 비율 — 1 : 2라 묶음이 화면 1/3 높이에 선다 (D-UX4-111) */
export const CONFIRM_ABOVE = 1
export const CONFIRM_BELOW = 2
/** 상품 줄 묶음과 "상품을 추가할까요?" 사이 */
export const CONFIRM_GAP = SPACE.xl

/**
 * 숫자판 누름 하나 → 칸의 새 숫자 (순수 계산). 앞의 0은 떼고, 지우기는 끝 한 자리.
 * 아직 넘치지 않았으면 이번 누름은 받아 보여 준다 — 00으로 두 자리를 넘겨도 친 것이 보인다(D-UX4-61 → D-UX4-111).
 * 이미 limit(자리 수 끝)을 넘긴 뒤에 더 치면 null(받지 않음 — 흔든다)
 */
export function typeDigits(current: string, value: string, limit: number): string | null {
  if (value === 'back') return current.slice(0, -1)
  if (current.length > limit) return null
  return (current + value).replace(/^0+/, '')
}

/** 비어 있는 큰 칸 맨 앞 글자 자리 표시가 한 번 나타났다 사라지는 시간 (D-UX4-111 — 서서히) */
export const CURSOR_BLINK_MS = 1000

/** 비어 있을 때 맨 앞 글자 자리 표시: 주색 세로 막대가 서서히 나타났다 사라진다(뚝 끊기지 않게). 웹(시험)은 가만히 */
function SoftCursor() {
  const { p } = useKit()
  const glow = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (Platform.OS === 'web') return
    const half = CURSOR_BLINK_MS / 2
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 0, duration: half, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 1, duration: half, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [glow])
  return <Animated.View aria-hidden testID="soft-cursor" style={{ position: 'absolute', left: 0, zIndex: 1, width: 2, height: BIG, borderRadius: 1, borderCurve: 'continuous', backgroundColor: p.primary, opacity: glow }} />
}

/** 앱 숫자판 키 하나 (웹·시험) — 누르는 동안 꾸욱 들어가며 작아지고 옅은 바탕이 생긴다, 누른 순간 햅틱 (사진 5, D-UX4-43) */
function PadKey({ value, onPress }: { readonly value: string; readonly onPress: (value: string) => void }) {
  const { p } = useKit()
  return (
    <PressScale ariaLabel={keyLabel(value)} onPress={() => onPress(value)} scale={KEY_SCALE} pad={KEY_PAD} radius={KEY_RADIUS} style={{ flex: 1, height: KEY_HEIGHT, alignItems: 'center', justifyContent: 'center' }}>
      <Txt step="amount" weight="regular" ink={p.textSub}>
        {value === 'back' ? '←' : value}
      </Txt>
    </PressScale>
  )
}

const keyLabel = (value: string): string => (value === 'back' ? '지우기' : value)
const KEY_SCALE = 0.86
const KEY_PAD = { x: 10, y: 4 } as const
const KEY_RADIUS = 18
const ACTIVATE = [{ name: 'activate' as const }]

/**
 * 숫자판 안 손가락 자리(숫자판 왼쪽 위 기준) → 키 (D-UX4-102). 줄은 키 높이로, 칸은 셋으로 나눈다. 숫자판 밖이면 null.
 * 숫자판은 좌우 SPACE.sm, 위 SPACE.xs 여백 + 키 64 × 4줄 — 여백을 누르면 가장 가까운 키
 */
export function padKeyAt(x: number, y: number, width: number, pad: readonly (readonly string[])[] = PAD): string | null {
  const height = SPACE.xs + pad.length * KEY_HEIGHT
  if (!(width > 0) || x < 0 || x > width || y < 0 || y > height) return null
  const inner = Math.max(width - SPACE.sm * 2, 1)
  const column = Math.min(2, Math.max(0, Math.floor(((x - SPACE.sm) / inner) * 3)))
  const row = Math.min(pad.length - 1, Math.max(0, Math.floor((y - SPACE.xs) / KEY_HEIGHT)))
  const value = pad[row]?.[column] ?? null
  // 빈 자리(번호 숫자판의 00 자리)는 키가 아니다
  return value === '' ? null : value
}

/** 키 하나의 꾸욱 움직임 (kit usePressMotion과 같은 시간·곡선) */
function pressTo(value: Animated.Value, target: number) {
  Animated.timing(value, { toValue: target, duration: target === 1 ? PRESS_IN_MS : PRESS_OUT_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }).start()
}

/**
 * 휴대폰 숫자판 (D-UX4-102): 키마다 따로 누름(Pressable)을 받으면 누름 주인이 하나뿐이라, 앞 손가락을 떼기 전에 다른 키를 누르면 뒤 키를 아예 받지 않았다.
 * 숫자판 전체가 한 번 누름 주인이 되고(안쪽 키는 손가락을 받지 않음), 손가락마다 닿은 순간 그 자리의 키를 받는다 — 두 손가락으로 빨리 쳐도 하나도 빠지지 않는다.
 * 키는 손가락이 닿아 있는 동안 꾸욱 눌리고 햅틱. 화면 읽기(보이스오버·톡백)는 키마다 "누르기" 동작으로 받는다.
 */
function TouchKeys({ onKey, pad }: { readonly onKey: (value: string) => void; readonly pad: readonly (readonly string[])[] }) {
  const { p } = useKit()
  const latest = useRef(onKey)
  useEffect(() => {
    latest.current = onKey
  })
  const motions = useRef(new Map(pad.flat().map((value) => [value, new Animated.Value(0)] as const))).current
  /** 손가락 번호 → 처음 닿은 키 */
  const fingers = useRef(new Map<string, string>()).current
  const width = useRef(0)
  const padTag = useRef<string | null>(null)
  const release = (value: string) => {
    if ([...fingers.values()].includes(value)) return
    const motion = motions.get(value)
    if (motion !== undefined) pressTo(motion, 0)
  }
  const releaseAll = () => {
    const held = [...fingers.values()]
    fingers.clear()
    for (const value of held) release(value)
  }
  const down = (event: GestureResponderEvent) => {
    for (const touch of event.nativeEvent.changedTouches) {
      const id = String(touch.identifier)
      if (fingers.has(id)) continue
      // 숫자판이 누름 주인인 동안 숫자판 밖(예: [다음])에 닿은 손가락은 그 자리 기준 좌표라 받지 않는다
      if (padTag.current !== null && touch.target != null && String(touch.target) !== padTag.current) continue
      const value = padKeyAt(touch.locationX, touch.locationY, width.current, pad)
      if (value === null) continue
      fingers.set(id, value)
      tapHaptic()
      const motion = motions.get(value)
      if (motion !== undefined) pressTo(motion, 1)
      latest.current(value)
    }
  }
  const up = (event: GestureResponderEvent) => {
    for (const touch of event.nativeEvent.changedTouches) {
      const id = String(touch.identifier)
      const value = fingers.get(id)
      if (value === undefined) continue
      fingers.delete(id)
      release(value)
    }
  }
  return (
    <View
      role="group"
      aria-label="숫자판"
      pointerEvents="box-only"
      onLayout={(event) => {
        width.current = event.nativeEvent.layout.width
      }}
      onStartShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(event) => {
        releaseAll()
        padTag.current = event.nativeEvent.target == null ? null : String(event.nativeEvent.target)
      }}
      onResponderStart={down}
      onResponderEnd={up}
      onResponderRelease={releaseAll}
      onResponderTerminate={releaseAll}
      style={{ paddingHorizontal: SPACE.sm, paddingTop: SPACE.xs }}
    >
      {pad.map((row) => (
        <View key={row.join('')} style={{ flexDirection: 'row' }}>
          {row.map((value) => {
            if (value === '') return <View key="blank" aria-hidden style={{ flex: 1, height: KEY_HEIGHT }} />
            const motion = motions.get(value) ?? new Animated.Value(0)
            const size = motion.interpolate({ inputRange: [0, 1], outputRange: [1, KEY_SCALE] })
            return (
              <View
                key={value}
                role="button"
                aria-label={keyLabel(value)}
                accessible
                accessibilityActions={ACTIVATE}
                onAccessibilityAction={(event) => {
                  if (event.nativeEvent.actionName === 'activate') latest.current(value)
                }}
                style={{ flex: 1, height: KEY_HEIGHT, alignItems: 'center', justifyContent: 'center' }}
              >
                <Animated.View aria-hidden style={{ position: 'absolute', top: KEY_PAD.y, bottom: KEY_PAD.y, left: KEY_PAD.x, right: KEY_PAD.x, borderRadius: KEY_RADIUS, borderCurve: 'continuous', backgroundColor: p.surfaceAlt, opacity: motion, transform: [{ scale: size }] }} />
                <Animated.View style={{ transform: [{ scale: size }], alignItems: 'center', justifyContent: 'center' }}>
                  <Txt step="amount" weight="regular" ink={p.textSub}>
                    {value === 'back' ? '←' : value}
                  </Txt>
                </Animated.View>
              </View>
            )
          })}
        </View>
      ))}
    </View>
  )
}

/** 앱 숫자판 (다른 화면도 쓴다). 휴대폰은 손가락마다 받는 숫자판, 웹(시험)은 키마다 누르는 단추. 번호 입력은 00 자리를 비운다 (D-UX4-132) */
export function NumberKeys({ onKey, doubleZero = true, inScrollView = false }: { readonly onKey: (value: string) => void; readonly doubleZero?: boolean; readonly inScrollView?: boolean }) {
  const pad = doubleZero ? PAD : DIGIT_PAD
  if (Platform.OS !== 'web' && !inScrollView) return <TouchKeys key={doubleZero ? 'amount' : 'digits'} onKey={onKey} pad={pad} />
  return (
    <View role="group" aria-label="숫자판" style={{ paddingHorizontal: SPACE.sm, paddingTop: SPACE.xs }}>
      {pad.map((row) => (
        <View key={row.join('')} style={{ flexDirection: 'row' }}>
          {row.map((value) => (value === '' ? <View key="blank" aria-hidden style={{ flex: 1, height: KEY_HEIGHT }} /> : <PadKey key={value} value={value} onPress={onKey} />))}
        </View>
      ))}
    </View>
  )
}

/** 글자를 넣고 지울 때의 움직임 (D-UX4-52, 사용자 지시 2026-11-09 "입력할 땐 위에서 아래로 내려왔다가 지울 때는 다시 올라가게") */
export const CHAR_IN_MS = 200
export const CHAR_OUT_MS = 160
/** 쉼표가 생기거나 없어져 옆 글자가 밀리는 시간 */
export const CHAR_SHIFT_MS = 200
const CHAR_DROP = 14

/** 큰 칸 글자 조각: 숫자는 왼쪽부터 몇 번째 숫자인지, 쉼표는 오른쪽부터 몇 번째 묶음인지로 이름을 붙인다 — 끝에 숫자를 넣고 지워도 남은 글자는 같은 조각이라, 쉼표만 옆으로 미끄러진다 */
export interface CharPiece {
  readonly key: string
  readonly char: string
}

export function charPieces(shown: string, suffix: string): CharPiece[] {
  if (shown === '') return []
  const chars = [...shown]
  const digitTotal = chars.filter((char) => /[0-9]/.test(char)).length
  const pieces: CharPiece[] = []
  let seen = 0
  for (const char of chars) {
    if (/[0-9]/.test(char)) {
      pieces.push({ key: `d${String(seen)}`, char })
      seen += 1
    } else if (char === '-') {
      // 휴대폰 번호 줄표(D-UX4-126): 몇 번째 줄표인지로 — 숫자를 넣고 지워도 같은 조각이라 옆으로 미끄러진다
      pieces.push({ key: `h${String(pieces.filter((piece) => piece.char === '-').length)}`, char })
    } else {
      // 쉼표 뒤에 남은 숫자 수 ÷ 3 = 천·백만… 묶음
      pieces.push({ key: `c${String(Math.round((digitTotal - seen) / 3))}`, char })
    }
  }
  if (suffix !== '') pieces.push({ key: 'suffix', char: suffix })
  return pieces
}

/** 조각마다 왼쪽에서의 자리(앞 글자 폭의 합)와 전체 폭. 한 글자라도 폭을 아직 모르면 null (D-UX4-102) */
export function pieceSpots(pieces: readonly CharPiece[], widths: ReadonlyMap<string, number>): { readonly xs: ReadonlyMap<string, number>; readonly width: number } | null {
  const xs = new Map<string, number>()
  let left = 0
  for (const piece of pieces) {
    const width = widths.get(piece.char)
    if (width === undefined) return null
    xs.set(piece.key, left)
    left += width
  }
  return { xs, width: left }
}

/** 큰 칸에 늘 재 두는 글자 — 숫자·쉼표·붙임말·휴대폰 번호 줄표(D-UX4-126) */
const RULER_CHARS = '0123456789,-번원'

/** 큰 칸 글자 폭 재기: 보이지 않는 줄에 글자를 하나씩 그려 폭을 잰다(자리를 차지하지 않는다) */
function GlyphRuler({ chars, onWidth }: { readonly chars: string; readonly onWidth: (char: string, width: number) => void }) {
  return (
    <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, flexDirection: 'row', opacity: 0 }}>
      {[...new Set(chars)].map((char) => (
        <View key={char} onLayout={(event) => onWidth(char, event.nativeEvent.layout.width)}>
          <Txt step="amount" weight="bold">{char}</Txt>
        </View>
      ))}
    </View>
  )
}

/**
 * 글자 조각 하나: 새로 생기면 위에서 내려오며 나타난다(처음 그릴 때는 그대로). x(조각 자리)가 바뀌면 그 자리로 옆으로 미끄러진다.
 * D-UX4-102: 옛 LayoutAnimation(배치 움직임)은 그리기마다 다시 걸려, 앞 움직임이 끝나기 전에 새 배치가 오면 Fabric이 이 조각의 그려 둔 값(나타나기 전 투명도 0)을
 * 다시 칠해 글자가 사라졌다. 이제 배치는 바뀌지 않고(모든 조각이 왼쪽 0에 겹쳐 있고 옆 자리는 translateX) 움직임은 조각 혼자 한다 — 새 움직임은 앞 움직임을 지금 자리에서 이어받는다.
 * x가 null이면(글자 폭을 아직 모름) 그냥 줄에 놓는다.
 */
function PieceChar({ char, color, enter, x }: { readonly char: string; readonly color: string; readonly enter: boolean; readonly x: number | null }) {
  const show = useRef(new Animated.Value(enter ? 0 : 1)).current
  const slide = useRef(new Animated.Value(x ?? 0)).current
  const placed = useRef(x)
  useEffect(() => {
    if (!enter) return
    Animated.timing(show, { toValue: 1, duration: CHAR_IN_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
  }, [enter, show])
  useEffect(() => {
    if (x === null) return
    const from = placed.current
    placed.current = x
    if (from === null) {
      // 처음 자리를 안 때는 미끄러지지 않고 그 자리에
      slide.setValue(x)
      return
    }
    if (from === x) return
    Animated.timing(slide, { toValue: x, duration: CHAR_SHIFT_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true }).start()
  }, [x, slide])
  const drop = show.interpolate({ inputRange: [0, 1], outputRange: [-CHAR_DROP, 0] })
  const spot = x === null ? null : { position: 'absolute' as const, left: 0, top: 0, bottom: 0, justifyContent: 'center' as const }
  return (
    <Animated.View style={[spot, { opacity: show, transform: [{ translateX: slide }, { translateY: drop }] }]}>
      <Txt step="amount" weight="bold" ink={color}>{char}</Txt>
    </Animated.View>
  )
}

/** 지운 글자 조각: 있던 자리에서 위로 올라가며 사라진다 — 자리를 차지하지 않아 남은 글자가 바로 미끄러진다 */
function LeavingChar({ char, color, x, onDone }: { readonly char: string; readonly color: string; readonly x: number; readonly onDone: () => void }) {
  const hide = useRef(new Animated.Value(1)).current
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    Animated.timing(hide, { toValue: 0, duration: CHAR_OUT_MS, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => done.current())
  }, [hide])
  const rise = hide.interpolate({ inputRange: [0, 1], outputRange: [-CHAR_DROP, 0] })
  return (
    <Animated.View aria-hidden pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, justifyContent: 'center', opacity: hide, transform: [{ translateX: x }, { translateY: rise }] }}>
      <Txt step="amount" weight="bold" ink={color}>{char}</Txt>
    </Animated.View>
  )
}

interface Leaving {
  readonly id: number
  readonly char: string
  readonly x: number
}

/**
 * 앱 숫자판으로 넣는 큰 칸 (다른 화면도 쓴다): 비면 묻는 말(question, 회색), 차면 값 + 붙임말(번·원). 글자 자리 표시(커서)는 없다 (D-UX4-43).
 * 넣은 글자는 위에서 내려오며 나타나고, 지운 글자는 위로 올라가며 사라진다. 쉼표가 생기거나 없어지면 옆 글자가 부드럽게 밀린다 (D-UX4-52).
 * 휴대폰은 글자 폭을 재어 조각 자리를 직접 정한다 — 배치 움직임(LayoutAnimation)을 쓰지 않는다 (D-UX4-102).
 * 웹(시험)은 움직이지 않고 한 덩어리 글로 그린다.
 */
export function BigNumber({ label, question, digits, format, suffix }: { readonly label: string; readonly question: string; readonly digits: string; readonly format: (digits: string) => string; readonly suffix: string }) {
  const { p } = useKit()
  const empty = digits === ''
  const shown = empty ? '' : format(digits)
  const pieces = charPieces(shown, suffix)
  const [widths, setWidths] = useState<ReadonlyMap<string, number>>(() => new Map())
  const spots = pieceSpots(pieces, widths)
  const before = useRef<readonly CharPiece[]>(pieces)
  const spotsBefore = useRef<ReadonlyMap<string, number>>(new Map())
  const ready = useRef(false)
  const counter = useRef(0)
  const [leaving, setLeaving] = useState<readonly Leaving[]>([])
  useEffect(() => {
    ready.current = true
  }, [])
  // 그릴 때마다: 없어진 조각은 있던 자리에서 올라가며 사라진다
  useEffect(() => {
    const now = new Set(pieces.map((piece) => piece.key))
    const gone = before.current.filter((piece) => !now.has(piece.key))
    const was = spotsBefore.current
    before.current = pieces
    spotsBefore.current = spots?.xs ?? new Map()
    if (gone.length === 0 || Platform.OS === 'web') return
    const added = gone.flatMap((piece) => {
      const x = was.get(piece.key)
      if (x === undefined) return []
      counter.current += 1
      return [{ id: counter.current, char: piece.char, x }]
    })
    if (added.length > 0) setLeaving((list) => [...list, ...added])
  })
  const box = { flexDirection: 'row' as const, alignItems: 'center' as const, minHeight: BIG * 1.5 }
  const ruler = Platform.OS === 'web' ? null : (
    <GlyphRuler
      chars={`${RULER_CHARS}${shown}${suffix}`}
      onWidth={(char, width) => setWidths((map) => (map.get(char) === width ? map : new Map(map).set(char, width)))}
    />
  )
  if (empty && leaving.length === 0) {
    return (
      <View role="status" aria-label={question} style={box}>
        <SoftCursor />
        <Txt step="amount" weight="bold" ink={p.placeholder}>
          {question}
        </Txt>
        {ruler}
      </View>
    )
  }
  if (Platform.OS === 'web') {
    return (
      <View role="status" aria-label={`${label} ${shown}${suffix}`} style={box}>
        <Txt step="amount" weight="bold" ink={p.text}>
          {`${shown}${suffix}`}
        </Txt>
      </View>
    )
  }
  return (
    <View role="status" aria-label={empty ? question : `${label} ${shown}${suffix}`} style={box}>
      {/* 조각을 담는 칸: 폭을 알면 조각 폭의 합, 모르면 그냥 줄 — 같은 칸이라 바뀌어도 조각이 다시 생기지 않는다 */}
      <View style={spots === null ? { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' } : { width: spots.width, alignSelf: 'stretch' }}>
        {pieces.map((piece) => (
          <PieceChar key={piece.key} char={piece.char} color={p.text} enter={ready.current} x={spots?.xs.get(piece.key) ?? null} />
        ))}
        {leaving.map((item) => (
          <LeavingChar key={`out-${String(item.id)}`} char={item.char} color={p.text} x={item.x} onDone={() => setLeaving((list) => list.filter((one) => one.id !== item.id))} />
        ))}
      </View>
      {ruler}
    </View>
  )
}

/** 이미 답한 단계 (위로 올라간 값) — 누르면 그 단계로 돌아가 고친다. 손님 정보 입력(D-UX4-126)도 같이 쓴다 */
export function DoneLine({ label, value, onPress }: { readonly label: string; readonly value: string; readonly onPress: () => void }) {
  return (
    <Tap role="button" aria-label={`${label} ${value} 고치기`} onPress={onPress} style={({ pressed }) => ({ gap: 2, opacity: pressed ? 0.6 : 1 })}>
      <Txt step="body" color="textSub">
        {label}
      </Txt>
      <Txt step="title" weight="bold">
        {value}
      </Txt>
    </Tap>
  )
}

/** 숫자판·키보드 바로 위 [다음] — 꽉 찬 띠가 아닌 큰 단추 (D-UX4-43, 사용자 지시 "원래처럼 별도의 버튼으로") */
// 값이 없거나 틀리면 숨기지 않고 흐린 채로 눌리지 않는다 (D-UX4-54, 사용자 지시 2026-11-09 "처음에 안보이게 하지말고 비활성화로")
export function NextButton({ onPress, disabled }: { readonly onPress: () => void; readonly disabled: boolean }) {
  return (
    <View style={{ paddingHorizontal: SPACE.xl, paddingTop: SPACE.sm, paddingBottom: SPACE.sm }}>
      <BigButton label="다음" onPress={onPress} disabled={disabled} />
    </View>
  )
}

/**
 * 상품 추가 화면 틀 없는 내용 (D-UX4-57): 방송 화면 위 진짜 쌓인 화면(app/console/[id]/add)과, 경로가 없을 때(시험·웹) 방송 화면 안 겹친 화면이 같이 쓴다.
 * askName: 다육이 방송이면 품종도 묻는다 (사용자 지시 "방송 연결할 때 다육이를 선택했다면").
 * onAdded: 추가한 상품 열쇠 — 방송 화면이 그 상품을 잠깐 강조한다
 */
/** 뒤로 가기를 먼저 묻는 자리 — 앞 단계로 갔으면 true(화면을 닫지 않는다) */
export interface StepBack {
  current: (() => boolean) | null
}

/** 앞 단계: 번호 ← 가격 ← 품종 ← 확인 (품종을 안 물으면 확인 ← 가격). 첫 단계면 null */
export function previousStep(step: Step, askName: boolean): Step | null {
  if (step === 'no') return null
  if (step === 'price') return 'no'
  if (step === 'name') return 'price'
  return askName ? 'name' : 'price'
}

/**
 * 단계 뒤로 (D-UX4-111): 머리 ‹(stepBack)·왼쪽 가장자리 밀기·안드로이드 뒤로가 앞 단계로 간다(back이 true). 첫 단계면 화면을 닫게 둔다.
 * 상품 추가와 손님 정보 입력(D-UX4-126)이 같이 쓴다. swipe·edgeHandlers는 단계 내용을 감싼 Animated.View에 단다
 */
export function useStepBack(stepBack: StepBack | undefined, back: () => boolean, first: boolean) {
  const { width } = useWindowDimensions()
  const backNow = useRef(back)
  backNow.current = back
  useEffect(() => {
    if (stepBack === undefined) return
    stepBack.current = () => backNow.current()
    return () => {
      stepBack.current = null
    }
  }, [stepBack])
  // 첫 단계가 아니면 화면을 닫는 휴대폰 밀기를 끄고(useHoldRouteSwipe) 이 화면 밀기로 앞 단계에 간다. 안드로이드 뒤로도 앞 단계로
  useHoldRouteSwipe(!first)
  useEffect(() => {
    if (first || Platform.OS === 'web') return
    const handle = BackHandler.addEventListener('hardwareBackPress', () => backNow.current())
    return () => handle.remove()
  }, [first])
  const swipe = useRef(new Animated.Value(0)).current
  const firstNow = useRef(first)
  firstNow.current = first
  const widthNow = useRef(width)
  widthNow.current = width
  const [edge] = useState(() => {
    const settle = () => Animated.timing(swipe, { toValue: 0, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_event, g) => !firstNow.current && startsEdgeSwipe(g.x0, g.dx, g.dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_event, g) => swipe.setValue(Math.max(g.dx, 0) / 3),
      onPanResponderRelease: (_event, g) => {
        if (edgeSwipeCloses(g.dx, g.vx, widthNow.current)) backNow.current()
        settle()
      },
      onPanResponderTerminate: settle,
    }).panHandlers
  })
  const edgeHandlers = Platform.OS === 'web' ? {} : edge
  return { swipe, edgeHandlers }
}

export function ProductAddFlow({ askName, onAdded, stepBack }: { readonly askName: boolean; readonly onAdded: (key: string) => void; readonly stepBack?: StepBack }) {
  const api = useConsoleApi()
  const { p } = useKit()
  const footer = useFooterInset()
  const [step, setStep] = useState<Step>('no')
  // 번호·가격 칸과 넘쳐 친 횟수(흔들기)를 한 상태로 — 누름마다 앞 누름의 결과에서 이어 간다 (D-UX4-102)
  const [typed, setTyped] = useState<{ readonly no: string; readonly price: string; readonly again: number }>({ no: '', price: '', again: 0 })
  const { no, price, again } = typed
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 뒤로 = 앞 단계로 (D-UX4-111, 사용자 지시 "맨 앞 입력 단계(번호)가 아닌 곳에서 뒤로가기 하면 이전 입력 단계로 … 스와이프로 뒤로가기해도")
  const back = () => {
    const previous = previousStep(step, askName)
    if (previous === null) return false
    setError(null)
    setStep(previous)
    return true
  }
  const { swipe, edgeHandlers } = useStepBack(stepBack, back, step === 'no')

  const maxNumber = (() => {
    const value = api.data.broadcasts.get(api.b)?.settings['claim.maxNumber']
    return typeof value === 'number' && value > 0 ? value : null
  })()
  // 넣는 동안 바로 알리는 말 (토스 "출금할 수 있는 돈이 …이에요." 사진, D-UX4-54): 칸 아래 빨간 글 + 칸이 좌우로 흔들리고 에러 진동, [다음]은 흐리게
  // D-UX4-61 (사용자 지시 2026-11-09): 자리 수를 넘는 한 자리도 칸에 보여 준다 — 그래야 넘친 걸 보고 한 자리를 지울 수 있다. 그보다 더 치면 받지 않고 다시 흔든다
  const digitLimit = (step: Step): number => (step === 'no' ? Math.max(String(maxNumber ?? NO_FALLBACK_MAX).length, 1) : PRICE_DIGITS)
  const tooBig = (step: Step, digits: string): string | null => {
    if (digits === '') return null
    if (digits.length > digitLimit(step)) return step === 'no' ? noLimitWords(maxNumber ?? NO_FALLBACK_MAX) : PRICE_LIMIT
    if (step === 'no' && maxNumber !== null && Number(digits) > maxNumber) return noLimitWords(maxNumber)
    return null
  }
  // D-UX4-102: 그린 때의 값(no·price)이 아니라 지금 값에 이어 붙인다 — 다음 그리기 전에 두 번 눌러도 앞 숫자가 덮이지 않는다
  const type = (value: string) => {
    setError(null)
    const field = step === 'no' ? 'no' : 'price'
    const limit = digitLimit(step)
    setTyped((now) => {
      const next = typeDigits(now[field], value, limit)
      // 넘친 한 자리까지만 보여 주고, 더 치면 받지 않고 다시 흔든다(진동 포함)
      return next === null ? { ...now, again: now.again + 1 } : { ...now, [field]: next }
    })
  }
  const nextFromNo = () => {
    const value = Number(no)
    if (no === '' || !Number.isSafeInteger(value) || value < 1) return setError('상품 번호를 숫자로 적어 주세요.')
    if (maxNumber !== null && value > maxNumber) return setError(noLimitWords(maxNumber))
    const existing = api.data.products.get(productKey(api.b, value))
    if (existing !== undefined && existing.status !== 'CLOSED') return setError(`${String(value)}번은 이미 있어요. 다른 번호를 적어 주세요.`)
    setError(null)
    setStep('price')
  }
  const nextFromPrice = () => {
    if (price === '' || Number(price) < 100) return setError('가격은 100원 이상으로 적어 주세요.')
    setError(null)
    setStep(askName ? 'name' : 'confirm')
  }
  const add = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    const value = Number(no)
    const key = productKey(api.b, value)
    const raw = { noText: no, priceText: `${price}원` }
    const trimmed = name.trim()
    try {
      const existing = api.data.products.get(key)
      if (existing !== undefined && existing.status === 'CLOSED') {
        // 지운(판매 종료한) 번호를 다시 올리면 새 값으로 고친 뒤 다시 판다
        await api.command({ type: 'product.update', b: api.b, ...raw, ...(trimmed === '' ? {} : { name: trimmed }) })
        await api.command({ type: 'product.open', b: api.b, no: value })
      } else {
        const result = await api.command({ type: 'product.register', b: api.b, ...raw, name: trimmed })
        if (!result.changed) throw new Error(`${String(value)}번은 이미 있어요. 다른 번호로 다시 해 주세요.`)
      }
      setBusy(false)
      onAdded(key)
    } catch (caught) {
      setBusy(false)
      setError(isApiError(caught) ? caught.message : caught instanceof Error && caught.message !== '' ? caught.message : '추가하지 못했어요. 다시 눌러 주세요.')
    }
  }

  const done: { readonly step: Step; readonly label: string; readonly value: string }[] = []
  if (step !== 'no') done.push({ step: 'no', label: '번호', value: `${no}번` })
  if (step === 'name') done.push({ step: 'price', label: '가격', value: won(price) })

  // 훅은 확인 화면으로 일찍 돌아가기 전에
  const active = step === 'no' ? no : step === 'price' ? price : name
  const shownError = error ?? (step === 'name' || step === 'confirm' ? null : tooBig(step, active))
  // 잘못이 생기거나 바뀌면, 또 넘쳐 치면 큰 칸이 좌우로 흔들리고 진동한다 (D-UX3-51 흔들기, D-UX4-61)
  const shake = useWrongShake(step === 'name' || step === 'confirm' ? null : shownError, again)
  if (step === 'confirm') {
    // D-UX4-111 (사용자 지시 2026-11-10): 번호 → 가격 → 품종 순(옛 번호 → 품종 → 가격), 묻는 말과 상품 줄 사이를 띄우고, 글 묶음은 화면 1/3 높이(옛 가운데)
    return (
      <Animated.View {...edgeHandlers} style={{ flex: 1, transform: [{ translateX: swipe }] }}>
        <View style={{ flex: 1, paddingHorizontal: SPACE.xxl }}>
          <View style={{ flex: CONFIRM_ABOVE }} />
          <View testID="add-confirm" style={{ alignItems: 'center', gap: CONFIRM_GAP }}>
            <View testID="add-confirm-lines" style={{ alignItems: 'center', gap: 2 }}>
              {[`${no}번`, won(price), ...(name.trim() === '' ? [] : [name.trim()])].map((line) => (
                <Txt key={line} step="amount" weight="bold" ink={p.primaryText} center>
                  {line}
                </Txt>
              ))}
            </View>
            <Txt step="amount" weight="bold" center>
              {ASK_ADD}
            </Txt>
          </View>
          <View style={{ flex: CONFIRM_BELOW }} />
        </View>
        <View style={{ paddingHorizontal: SPACE.xl, paddingBottom: footer + SPACE.xs, gap: SPACE.sm }}>
          {error !== null ? <ErrorLine>{error}</ErrorLine> : null}
          <BigButton label="추가하기" busy={busy} disabled={busy} onPress={() => void add()} />
        </View>
      </Animated.View>
    )
  }

  const onNext = step === 'no' ? nextFromNo : step === 'price' ? nextFromPrice : () => setStep('confirm')
  return (
    <Animated.View {...edgeHandlers} style={{ flex: 1, transform: [{ translateX: swipe }] }}>
      <View style={{ flex: 1, paddingHorizontal: SPACE.xxl, paddingTop: SPACE.xxl, gap: SPACE.xxl }}>
        {done.map((line) => <DoneLine key={line.step} label={line.label} value={line.value} onPress={() => { setError(null); setStep(line.step) }} />)}
        <View style={{ gap: SPACE.sm }}>
          {step === 'name' ? (
            <>
              <TextInput
                aria-label={ASK_NAME}
                autoFocus
                value={name}
                onChangeText={(value) => setName(value)}
                placeholder={ASK_NAME}
                placeholderTextColor={p.placeholder}
                maxLength={40}
                returnKeyType="next"
                onSubmitEditing={() => { if (name.trim() !== '') setStep('confirm') }}
                style={{ fontSize: BIG, paddingVertical: 0, color: p.text, ...font(WEIGHT.bold) }}
              />
              {/* 토스 "잔액 · 159,952원 입력" 같은 회색 칩 — 꾸욱 눌린다 (D-UX4-43) */}
              {name.trim() === '' ? <SoftChip label="품종 없이 넘어가기" onPress={() => setStep('confirm')} /> : null}
            </>
          ) : (
            <Animated.View style={{ transform: [{ translateX: shake }] }}>
              {/* 단계마다 새 칸 — 번호 칸의 글자가 가격 칸에서 올라가며 남지 않게 (D-UX4-111, 사용자 사진 1) */}
              <BigNumber key={step} label={step === 'no' ? '번호' : '가격'} question={step === 'no' ? ASK_NO : ASK_PRICE} digits={active} format={step === 'no' ? (value) => value : (value) => Number(value).toLocaleString('ko-KR')} suffix={step === 'no' ? '번' : '원'} />
            </Animated.View>
          )}
          {/* 만 원 아래는 한글 읽기가 위 금액과 같아 그리지 않는다 */}
          {step === 'price' && Number(price) >= 10_000 ? (
            <Txt step="body" color="textSub">
              {koreanWon(Number(price))}
            </Txt>
          ) : null}
          {shownError !== null ? <ErrorLine large>{shownError}</ErrorLine> : null}
        </View>
      </View>
      <NextButton onPress={onNext} disabled={active.trim() === '' || shownError !== null} />
      {step === 'name' ? null : (
        <View style={{ paddingBottom: footer }}>
          <NumberKeys doubleZero={step === 'price'} onKey={type} />
        </View>
      )}
    </Animated.View>
  )
}

/** 경로가 없을 때(시험·웹) 방송 화면 안에 겹쳐 그리는 상품 추가 화면 — 열 때마다 처음부터 */
export function ProductAddPage({ visible, onClose, askName, onAdded }: { readonly visible: boolean; readonly onClose: () => void; readonly askName: boolean; readonly onAdded: (key: string) => void }) {
  const [round, setRound] = useState(0)
  useEffect(() => {
    if (visible) setRound((count) => count + 1)
  }, [visible])
  const stepBack = useRef<(() => boolean) | null>(null)
  return (
    <SlidePage visible={visible} onClose={() => { if (stepBack.current?.() !== true) onClose() }} title={ADD_TITLE} name={ADD_TITLE} scroll={false} testID="product-add">
      <ProductAddFlow key={round} askName={askName} onAdded={onAdded} stepBack={stepBack} />
    </SlidePage>
  )
}

/** 상품 탭 오른쪽 아래 (+) 둥근 단추 (D-UX4-31) */
export function AddFab({ onPress, bottom }: { readonly onPress: () => void; readonly bottom: number }) {
  const { p } = useKit()
  return (
    <Tap
      role="button"
      aria-label={ADD_TITLE}
      testID="add-product"
      onPress={onPress}
      pressScale={0.94}
      style={({ pressed }) => ({ position: 'absolute', right: SPACE.xl, bottom, width: 58, height: 58, borderRadius: 29, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? p.primaryPressed : p.primary, shadowColor: '#000000', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 })}
    >
      <View aria-hidden style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', width: 22, height: 3, borderRadius: 2, borderCurve: 'continuous', backgroundColor: p.onPrimary }} />
        <View style={{ position: 'absolute', width: 3, height: 22, borderRadius: 2, borderCurve: 'continuous', backgroundColor: p.onPrimary }} />
      </View>
    </Tap>
  )
}
