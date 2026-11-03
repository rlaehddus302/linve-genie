// 라벨 단계 그림 (D-UX4-03·04, 사용자 지시 2026-11-03 "이해를 돕는 그림, 라벨이 뽑혀 나오는 애니메이션 부드럽게",
// "전원 버튼 불 들어오고 위에 블루투스 로고가 뜨는 느낌"): 판매자의 라벨 프린터(검은 둥근 상자 + 위 종이 구멍 + 앞 전원 단추)를 그린다.
// - LabelPrintArt: 예시 라벨(EXAMPLE_LABEL)이 종이 구멍에서 천천히 올라온다 → 잠깐 머문다 → 사라지고 다시.
// - PrinterConnectArt: 전원 단추에 파란 불이 들어오고 → 프린터 위에 블루투스 표가 떠오른다 → 다시.
// 그림일 뿐이라 보조 기술에는 한 문장 이름만 읽힌다. 움직임 줄이기·웹(시험)은 끝 장면을 멈춰 보인다.
import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, Platform, Text, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { EXAMPLE_LINES } from '../lib/label-example.ts'

const BODY = '#26262E'
const LID = '#33333D'
const SLOT = '#121216'
const GLOW = '#2F7BFF'
const PAPER = '#FFFFFF'
const INK = '#191F28'

/** 움직임을 켤지 (기기에서 움직임 줄이기가 꺼져 있을 때만) */
function useMotionOn(): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (Platform.OS === 'web') return
    let alive = true
    AccessibilityInfo.isReduceMotionEnabled().then(
      (reduce) => {
        if (alive) setOn(!reduce)
      },
      () => {
        if (alive) setOn(true)
      },
    )
    return () => {
      alive = false
    }
  }, [])
  return on
}

/** 0 → 1 되풀이. moving이 false면 그리는 쪽이 끝 장면을 멈춰 보인다 */
function useLoop(make: (value: Animated.Value) => Animated.CompositeAnimation): { readonly t: Animated.Value; readonly moving: boolean } {
  const value = useRef(new Animated.Value(0)).current
  const motion = useMotionOn()
  const maker = useRef(make)
  useEffect(() => {
    if (!motion) return
    value.setValue(0)
    const loop = Animated.loop(maker.current(value))
    loop.start()
    return () => loop.stop()
  }, [motion, value])
  return { t: value, moving: motion }
}

/** 예시 라벨 한 장 (실제 라벨 배치: 가게 이름 / 번호·가격·날짜 / 품종 / 닉네임) */
export function ExampleLabel({ width }: { readonly width: number }) {
  const unit = width / 200
  const line = (size: number) => ({ fontSize: size * unit, lineHeight: size * unit * 1.25, color: INK, fontWeight: '700' as const })
  return (
    <View style={{ width, aspectRatio: 50 / 30, backgroundColor: PAPER, borderRadius: 6 * unit, borderCurve: 'continuous', padding: 8 * unit, justifyContent: 'space-between' }}>
      <Text allowFontScaling={false} style={{ ...line(15), textAlign: 'center' }}>
        {EXAMPLE_LINES.shop}
      </Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text allowFontScaling={false} style={line(12)}>
          {`${EXAMPLE_LINES.number}  ${EXAMPLE_LINES.price}`}
        </Text>
        <Text allowFontScaling={false} style={line(12)}>
          {EXAMPLE_LINES.date}
        </Text>
      </View>
      <Text allowFontScaling={false} style={line(14)}>
        {EXAMPLE_LINES.name}
      </Text>
      <Text allowFontScaling={false} style={line(14)}>
        {EXAMPLE_LINES.buyer}
      </Text>
    </View>
  )
}

/** 프린터 몸통 (위 종이 구멍, 앞 전원 단추). glow: 전원 불 0~1 */
function PrinterBody({ glow }: { readonly glow: Animated.Value | Animated.AnimatedInterpolation<number> | number }) {
  return (
    <View style={{ width: 200, height: 150, borderRadius: 40, borderCurve: 'continuous', backgroundColor: BODY, alignItems: 'center', overflow: 'hidden' }}>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 92, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, borderCurve: 'continuous', backgroundColor: LID }} />
      <View style={{ marginTop: 14, width: 150, height: 5, borderRadius: 3, borderCurve: 'continuous', backgroundColor: SLOT }} />
      <View style={{ marginTop: 50, width: 52, height: 26, borderRadius: 9, borderCurve: 'continuous', backgroundColor: '#55555F', alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={{ position: 'absolute', left: -3, right: -3, top: -3, bottom: -3, borderRadius: 11, borderCurve: 'continuous', borderWidth: 3, borderColor: GLOW, opacity: glow }} />
        <Svg width={14} height={14} viewBox="0 0 24 24">
          <Path d="M12 3v8M7.05 6.05a8 8 0 1 0 9.9 0" stroke="#D9D9DE" strokeWidth={2.4} strokeLinecap="round" fill="none" />
        </Svg>
      </View>
    </View>
  )
}

/** 라벨이 뽑혀 나오는 그림 ("라벨을 뽑을까요?") */
export function LabelPrintArt() {
  const { t, moving } = useLoop((v) =>
    Animated.sequence([
      Animated.delay(400),
      Animated.timing(v, { toValue: 0.7, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.delay(1600),
      Animated.timing(v, { toValue: 1, duration: 400, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]),
  )
  const paperH = 160 * (30 / 50) + 16
  // 0 → 0.7: 구멍 아래(paperH)에서 다 올라옴(0), 0.7 → 1: 그대로 두고 흐려짐. 움직임이 꺼지면 다 올라온 채로 멈춤
  const rise = moving ? t.interpolate({ inputRange: [0, 0.7, 1], outputRange: [paperH, 0, 0] }) : 0
  const fade = moving ? t.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }) : 1
  return (
    <View role="img" aria-label="라벨 프린터에서 라벨이 뽑혀 나오는 그림" style={{ alignItems: 'center', paddingVertical: 8 }}>
      <View style={{ width: 170, height: paperH, overflow: 'hidden', alignItems: 'center', justifyContent: 'flex-end', marginBottom: -14 }}>
        <Animated.View style={{ transform: [{ translateY: rise }], opacity: fade, paddingBottom: 6, shadowColor: '#000000', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }}>
          <ExampleLabel width={150} />
        </Animated.View>
      </View>
      <PrinterBody glow={1} />
    </View>
  )
}

/** 전원이 켜지고 블루투스로 이어지는 그림 ("라벨 프린터를 연결해 주세요") */
export function PrinterConnectArt() {
  const { t, moving } = useLoop((v) =>
    Animated.sequence([
      Animated.delay(500),
      Animated.timing(v, { toValue: 0.4, duration: 500, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.delay(250),
      Animated.timing(v, { toValue: 0.8, duration: 450, easing: Easing.out(Easing.back(1.6)), useNativeDriver: true }),
      Animated.delay(1600),
      Animated.timing(v, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]),
  )
  // 움직임이 꺼지면 불이 켜지고 표가 뜬 끝 장면
  const glow = moving ? t.interpolate({ inputRange: [0, 0.4, 0.8, 1], outputRange: [0, 1, 1, 0] }) : 1
  const badge = moving ? t.interpolate({ inputRange: [0, 0.4, 0.8, 1], outputRange: [0, 0, 1, 0] }) : 1
  const lift = moving ? t.interpolate({ inputRange: [0, 0.4, 0.8, 1], outputRange: [10, 10, 0, 0] }) : 0
  const grow = moving ? t.interpolate({ inputRange: [0, 0.4, 0.8, 1], outputRange: [0.6, 0.6, 1, 1] }) : 1
  return (
    <View role="img" aria-label="프린터 전원이 켜지고 블루투스로 이어지는 그림" style={{ alignItems: 'center', paddingVertical: 8, gap: 14 }}>
      <Animated.View style={{ width: 64, height: 64, borderRadius: 32, borderCurve: 'continuous', backgroundColor: GLOW, alignItems: 'center', justifyContent: 'center', opacity: badge, transform: [{ translateY: lift }, { scale: grow }] }}>
        <Svg width={30} height={30} viewBox="0 0 24 24">
          <Path d="M7 7l10 10-5 5V2l5 5L7 17" stroke="#FFFFFF" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </Svg>
      </Animated.View>
      <PrinterBody glow={glow} />
    </View>
  )
}
