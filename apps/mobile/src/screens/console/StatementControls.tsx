// 정산서 화면의 조작 부품.
// - 정보 단추 (D-UX4-172 → D-UX4-177, 사용자 지시 2026-11-16 "정산서에 넣을 정보 알려달라는 버튼도 지금은 그냥 에러 문구 같이 생겼어. 탭 바 맨 오른쪽에 배치하고
//   이름은 정산 정보를 알려주세요로 하고 > 기호 넣어서 누름직하게"): 옛 연한 빨강 경고 캡슐(탭 바 아래에 떠 있음)을 걷고, 탭 바 같은 줄 맨 오른쪽에
//   옅은 초록 알약 "정산 정보를 알려주세요 ›" — 정보가 빠졌을 때만 보인다(부르는 쪽이 정한다). 누르면 살짝 줄어든다.
// - 아래 고정 판 (D-UX4-173 → D-UX4-178, 사용자 지시 2026-11-16 "총계, 보내기 버튼 합쳐서 맨 아래에 플로팅 형태로 고정해서 스크롤과 상관 없이 계속 볼 수 있게 하기.
//   보내기 버튼은 캡슐 말고 기존 버튼 형태로 하고 포인트 컬러 넣어"): 왼쪽 총계(금액 · 구매자 n명 · n개), 오른쪽 초록 큰 단추 [보내기](종이비행기).
//   흰 둥근 판이 화면 아래(안전 영역 위)에 떠 있다 — 그림자는 아이폰 shadow, 갤럭시 elevation.
// - D-UX4-181 (사용자 지시 2026-11-16 "보내기 버튼은 사진 1 처럼 만들고, 총계는 총액으로 이름 바꿔"): 종이비행기는 사진처럼 끝이 왼쪽 위를 향한
//   둥근 세모 + 끝에서 안으로 접힌 선(옛: 오른쪽 위를 향한 뾰족한 종이비행기). 왼쪽 글 "총계" → "총액".
import type { LayoutChangeEvent } from 'react-native'
import { View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { salesMoney } from '../../lib/broadcast-sales.ts'
import { BigButton, Icon, Tap, Txt, useKit } from '../../ui/kit/index.ts'
import { GUTTER, RADIUS, SPACE, pressedFill } from '../../ui/kit/tokens.ts'

export const INFO_BUTTON_TEXT = '정산 정보를 알려주세요'
export const SEND_TEXT = '보내기'
export const TOTAL_WORD = '총액'
/** 총계의 구매자 수·개수 한 줄 */
export const totalLine = (buyers: number, qty: number): string => `구매자 ${buyers}명 · ${qty}개`

/** 종이비행기 그림: 세 꼭짓점 (4,6)·(20.5,7)·(12.5,20.3)을 2.4 둥글리고 칸 가운데로 1 올림, 접힌 선은 끝에서 맞은편 변 가운데 쪽으로 60% */
export const PLANE_PATH = 'M6.4 5.15 L18.1 5.85 Q20.5 6 19.26 8.06 L13.74 17.24 Q12.5 19.3 11.27 17.24 L5.23 7.06 Q4 5 6.4 5.15 Z M5.9 6.1 L11.5 9.6'

/** 떠 있는 판 그림자 (매출 캡슐 D-UX4-140과 같은 결, 위아래로 고르게) */
const FLOAT = { shadowColor: '#000000', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 2 }, elevation: 6 } as const

/** 종이비행기 (24 칸 선 아이콘, 둥근 끝 — 사진 1, D-UX4-181): 끝이 왼쪽 위를 향한 둥근 모서리 세모와 끝에서 안으로 접힌 선. 장식, 이름은 옆 글자 */
export function PlaneIcon({ color, size = 20 }: { readonly color: string; readonly size?: number }) {
  return (
    <View aria-hidden style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d={PLANE_PATH} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </Svg>
    </View>
  )
}

/** 탭 바 맨 오른쪽 "정산 정보를 알려주세요 ›" — 옅은 초록 알약(탭 알약과 같은 높이 36) */
export function InfoButton({ onPress }: { readonly onPress: () => void }) {
  const { p } = useKit()
  return (
    <Tap role="button" aria-label={INFO_BUTTON_TEXT} testID="statement-info-button" onPress={onPress} pressScale={0.96}
      style={({ pressed }) => ({
        minHeight: 36, paddingLeft: SPACE.md, paddingRight: SPACE.sm + 2, marginLeft: 'auto',
        flexDirection: 'row', alignItems: 'center', gap: 2,
        borderRadius: RADIUS.pill, borderCurve: 'continuous',
        backgroundColor: pressed ? pressedFill(p, p.secondary) : p.secondary,
      })}>
      <Txt step="meta" weight="bold" color="onSecondary" numberOfLines={1}>{INFO_BUTTON_TEXT}</Txt>
      <Icon name="chevron" color={p.onSecondary} size={16} />
    </Tap>
  )
}

/** 화면 아래 고정 판: 왼쪽 총계 · 오른쪽 [보내기] */
export function StatementFooter({ total, qty, buyers, bottom, onSend, onLayout }: {
  readonly total: number | null; readonly qty: number; readonly buyers: number
  /** 판의 아래 자리 (안전 영역 포함) */
  readonly bottom: number
  readonly onSend: () => void
  readonly onLayout?: (event: LayoutChangeEvent) => void
}) {
  const { p } = useKit()
  return (
    <View testID="statement-footer" onLayout={onLayout}
      style={{ position: 'absolute', left: GUTTER, right: GUTTER, bottom, flexDirection: 'row', alignItems: 'center', gap: SPACE.md,
        paddingVertical: SPACE.md, paddingLeft: SPACE.xl, paddingRight: SPACE.md,
        backgroundColor: p.surface, borderRadius: RADIUS.xl, borderCurve: 'continuous', ...FLOAT }}>
      <View role="group" aria-label={`${TOTAL_WORD} ${salesMoney(total)} · ${totalLine(buyers, qty)}`} testID="statement-total" style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: SPACE.sm }}>
          <Txt step="body" weight="medium" color="textSub">{TOTAL_WORD}</Txt>
          {total === null
            ? <Txt step="body" weight="bold" color="warnText">{salesMoney(null)}</Txt>
            : <Txt step="title" weight="heavy">{salesMoney(total)}</Txt>}
        </View>
        <Txt step="caption" color="textSub">{totalLine(buyers, qty)}</Txt>
      </View>
      <View style={{ minWidth: 120 }}>
        <BigButton label={SEND_TEXT} testID="statement-send-button" leading={<PlaneIcon color={p.onPrimary} />} oneLine onPress={onSend} />
      </View>
    </View>
  )
}
