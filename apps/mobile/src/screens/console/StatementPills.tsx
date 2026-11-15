// 정산서 화면에 떠 있는 캡슐 둘 (D-UX4-172·173, 사용자 지시 2026-11-16):
// - 정보 캡슐: "가게 이름, 정산 정보 버튼은 기능을 하나로 합쳐서 [정산서에 넣을 정보를 알려 주세요] 캡슐 버튼으로 … 탭바 아래에 플로팅 …
//   배경색은 연한 빨간색 … 맨 앞에는 느낌표도". 정보가 빠졌을 때만 보인다(부르는 쪽이 정한다).
// - 보내기 캡슐: "내보내기, 모두에게 보내기 버튼을 하나로 합쳐서 플로팅 캡슐 형태로 앞에는 종이비행기 아이콘 넣고 이름은 보내기로".
// 모양·그림자는 매출 캡슐(SalesPill, D-UX4-140)과 같다 — 아이폰은 그림자, 갤럭시는 elevation.
import { View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { AlertMark, Tap, Txt, useKit } from '../../ui/kit/index.ts'
import { RADIUS, SPACE, pressedFill } from '../../ui/kit/tokens.ts'

export const INFO_PILL_TEXT = '정산서에 넣을 정보를 알려 주세요'
export const SEND_PILL_TEXT = '보내기'
/** 캡슐 높이 (매출 캡슐과 같다) */
export const STATEMENT_PILL_HEIGHT = 44

/** 누르는 동안의 연한 빨강 — 한 단계 진하게 (잠깐 보이는 색) */
const INFO_PRESSED = '#FBDCDF'
const FLOAT = { shadowColor: '#000000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 } as const

/** 종이비행기 (24 칸 선 아이콘, 아래 탭 아이콘과 같은 1.8 선·둥근 끝) — 장식, 이름은 옆 글자 */
export function PlaneIcon({ color, size = 20 }: { readonly color: string; readonly size?: number }) {
  return (
    <View aria-hidden style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d="M21 3 L10.6 13.4 M21 3 L14.6 20.6 Q14.2 21.5 13.7 20.6 L10.6 13.4 L3.4 10.3 Q2.5 9.8 3.4 9.4 Z" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </Svg>
    </View>
  )
}

/** 정보가 빠졌다는 연한 빨강 캡슐 — 탭 바 아래 가운데 */
export function InfoPill({ onPress }: { readonly onPress: () => void }) {
  const { p } = useKit()
  return (
    <Tap role="button" aria-label={INFO_PILL_TEXT} testID="statement-info-pill" onPress={onPress} pressScale={0.96}
      style={({ pressed }) => ({
        alignSelf: 'center', maxWidth: '100%', minHeight: STATEMENT_PILL_HEIGHT, paddingHorizontal: SPACE.lg,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACE.sm,
        borderRadius: RADIUS.pill, borderCurve: 'continuous',
        backgroundColor: pressed ? INFO_PRESSED : p.liveBadBg, ...FLOAT,
      })}>
      <AlertMark color={p.liveBadText} size={18} />
      <Txt step="body" weight="bold" ink={p.liveBadText} numberOfLines={1}>{INFO_PILL_TEXT}</Txt>
    </Tap>
  )
}

/** 화면 아래 가운데에 떠 있는 흰 [보내기] 캡슐 */
export function SendPill({ bottom, disabled, onPress }: { readonly bottom: number; readonly disabled?: boolean; readonly onPress: () => void }) {
  const { p } = useKit()
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom, alignItems: 'center', pointerEvents: 'box-none' }}>
      <Tap role="button" aria-label={SEND_PILL_TEXT} aria-disabled={disabled === true} disabled={disabled === true} testID="statement-send-pill" onPress={onPress} pressScale={0.96}
        style={({ pressed }) => ({
          minHeight: STATEMENT_PILL_HEIGHT, minWidth: 128, paddingHorizontal: SPACE.xl,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACE.sm,
          borderRadius: RADIUS.pill, borderCurve: 'continuous', borderWidth: 1, borderColor: p.line,
          backgroundColor: pressed ? pressedFill(p, p.surface) : p.surface, opacity: disabled === true ? 0.6 : 1, ...FLOAT,
        })}>
        <PlaneIcon color={p.primaryText} />
        <Txt step="bodyLarge" weight="bold" color="primaryText">{SEND_PILL_TEXT}</Txt>
      </Tap>
    </View>
  )
}
