// 라벨 단계 그림 (D-UX4-03·04, 사용자 지시 2026-11-03 "이해를 돕는 그림, 라벨이 뽑혀 나오는 애니메이션 부드럽게",
// "전원 버튼 불 들어오고 위에 블루투스 로고가 뜨는 느낌"): 판매자의 라벨 프린터(검은 둥근 상자 + 위 종이 구멍 + 앞 전원 단추)를 그린다.
// - LabelPrintArt: 예시 라벨(EXAMPLE_LABEL)이 프린터 위 종이 구멍에서 천천히 올라온다 → 잠깐 머문다 → 사라지고 다시.
//   라벨은 프린터 앞에 그려지고 구멍 선 아래는 잘려 보여서, 프린터 뒤가 아니라 구멍에서 나오는 것처럼 보인다 (D-UX4-09, 사용자 지시 2026-11-05).
// - PrinterConnectArt: 왼쪽 휴대폰 화면에 블루투스가 켜지고 → 오른쪽 프린터 전원에 불이 들어오고 → 둘 사이로 점이 오가며 이어진다 → 다시 (D-UX4-10).
// 그림일 뿐이라 보조 기술에는 한 문장 이름만 읽힌다. 움직임 줄이기·웹(시험)은 끝 장면을 멈춰 보인다.
import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, Platform, Text, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { EXAMPLE_LINES } from '../lib/label-example.ts'
import { font } from './kit/font.ts'

const BODY = '#26262E'
const LID = '#33333D'
const SLOT = '#121216'
const GLOW = '#2F7BFF'
const PAPER = '#FFFFFF'
const INK = '#191F28'
/** 프린터 몸통 위에서 종이 구멍까지 */
const SLOT_TOP = 14

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
  const line = (size: number) => ({ fontSize: size * unit, lineHeight: size * unit * 1.25, color: INK, ...font('700') })
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
      <View style={{ marginTop: SLOT_TOP, width: 150, height: 5, borderRadius: 3, borderCurve: 'continuous', backgroundColor: SLOT }} />
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
  const labelW = 136
  const paperH = Math.round(labelW * (30 / 50)) + 10
  // 종이 칸의 아래 끝 = 프린터 종이 구멍(몸통 위에서 SLOT_TOP). 칸은 프린터 앞에 놓이고 아래는 잘려서, 라벨이 구멍에서 올라온다
  const top = paperH - SLOT_TOP
  // 0 → 0.7: 구멍 아래(paperH)에서 다 올라옴(0), 0.7 → 1: 그대로 두고 흐려짐. 움직임이 꺼지면 다 올라온 채로 멈춤
  const rise = moving ? t.interpolate({ inputRange: [0, 0.7, 1], outputRange: [paperH, 0, 0] }) : 0
  const fade = moving ? t.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }) : 1
  return (
    <View role="img" aria-label="라벨 프린터에서 라벨이 뽑혀 나오는 그림" style={{ alignItems: 'center', paddingVertical: 8 }}>
      <View style={{ width: 200, paddingTop: top }}>
        <PrinterBody glow={1} />
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: paperH, overflow: 'hidden', alignItems: 'center', justifyContent: 'flex-end', zIndex: 1 }}>
          <Animated.View style={{ transform: [{ translateY: rise }], opacity: fade }}>
            <ExampleLabel width={labelW} />
          </Animated.View>
        </View>
      </View>
    </View>
  )
}

/** 휴대폰 (화면 가운데 블루투스 표 — on: 0 회색 ~ 1 파랑) */
function PhoneBody({ on }: { readonly on: Animated.AnimatedInterpolation<number> | number }) {
  return (
    <View style={{ width: 74, height: 136, borderRadius: 18, borderCurve: 'continuous', backgroundColor: BODY, padding: 5 }}>
      <View style={{ flex: 1, borderRadius: 13, borderCurve: 'continuous', backgroundColor: '#F2F4F6', alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', top: 6, width: 22, height: 6, borderRadius: 3, borderCurve: 'continuous', backgroundColor: BODY }} />
        <View style={{ width: 40, height: 40 }}>
          <View style={{ position: 'absolute', left: 0, top: 0, width: 40, height: 40, borderRadius: 20, borderCurve: 'continuous', backgroundColor: '#C9CDD2', alignItems: 'center', justifyContent: 'center' }}>
            <BluetoothMark size={20} />
          </View>
          <Animated.View style={{ position: 'absolute', left: 0, top: 0, width: 40, height: 40, borderRadius: 20, borderCurve: 'continuous', backgroundColor: GLOW, alignItems: 'center', justifyContent: 'center', opacity: on }}>
            <BluetoothMark size={20} />
          </Animated.View>
        </View>
      </View>
    </View>
  )
}

function BluetoothMark({ size }: { readonly size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M7 7l10 10-5 5V2l5 5L7 17" stroke="#FFFFFF" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  )
}

const DOTS = [0, 1, 2] as const
/** 점 하나의 밝기: 둘 다 켜진 뒤(0.4) 왼쪽부터 차례로 두 번 밝아진다 */
const dotRange = (i: number) => {
  const s = 0.42 + i * 0.08
  const s2 = s + 0.24
  return { inputRange: [0, 0.4, s, s + 0.06, s + 0.12, s2, s2 + 0.06, s2 + 0.12, 0.95, 1], outputRange: [0, 0.25, 0.25, 1, 0.25, 0.25, 1, 0.25, 0.25, 0] }
}

/** 휴대폰 블루투스가 켜지고 프린터 전원이 켜져 둘이 이어지는 그림 ("라벨 프린터를 연결해 주세요") */
export function PrinterConnectArt() {
  const { t, moving } = useLoop((v) =>
    Animated.sequence([
      Animated.delay(300),
      Animated.timing(v, { toValue: 1, duration: 5200, easing: Easing.linear, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]),
  )
  // 0~0.15 휴대폰 블루투스 켜짐 → 0.2~0.35 프린터 전원 불 → 0.4~0.95 점이 오감 → 끝에 다 꺼짐. 움직임이 꺼지면 다 켜진 끝 장면
  const bt = moving ? t.interpolate({ inputRange: [0, 0.15, 0.95, 1], outputRange: [0, 1, 1, 0] }) : 1
  const glow = moving ? t.interpolate({ inputRange: [0, 0.2, 0.35, 0.95, 1], outputRange: [0, 0, 1, 1, 0] }) : 1
  return (
    <View role="img" aria-label="휴대폰 블루투스와 프린터 전원이 켜지고 서로 연결되는 그림" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8, gap: 12 }}>
      <PhoneBody on={bt} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {DOTS.map((i) => (
          <Animated.View key={i} style={{ width: 9, height: 9, borderRadius: 5, borderCurve: 'continuous', backgroundColor: GLOW, opacity: moving ? t.interpolate(dotRange(i)) : 1 }} />
        ))}
      </View>
      <View style={{ width: 120, height: 90 }}>
        <View style={{ position: 'absolute', left: -40, top: -30, transform: [{ scale: 0.6 }] }}>
          <PrinterBody glow={glow} />
        </View>
      </View>
    </View>
  )
}
