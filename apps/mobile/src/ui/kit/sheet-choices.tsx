// 아래 창 안 고르기 줄 (D-UX4-76, 토스 "비밀번호 인증" 사진): 왼쪽 주색 꼬리 글("3단계")·굵은 이름·회색 설명, 고른 줄만 오른쪽에 주색 굵은 체크.
// 고른 줄의 이름 색은 바꾸지 않는다 — 체크만 표시한다. 줄 글의 왼쪽 끝이 창 제목과 한 줄에 선다(누름 바탕만 양옆으로 조금 넓다).
import Svg, { Path } from 'react-native-svg'
import { View } from 'react-native'
import { RADIUS, SPACE } from './tokens.ts'
import { Txt, useKit } from './theme.tsx'
import { Tap } from './press.tsx'

export interface SheetChoice<T extends string | number> {
  readonly value: T
  /** 굵은 이름 */
  readonly label: string
  /** 이름 아래 회색 설명 */
  readonly description?: string
  /** 이름 왼쪽 주색 꼬리 글 ("3단계") */
  readonly accent?: string
}

export interface SheetChoicesProps<T extends string | number> {
  /** 묶음 이름 (보조 기술에 읽힌다 — 보통 창 제목) */
  readonly label: string
  readonly choices: readonly SheetChoice<T>[]
  /** 지금 고른 값 (없으면 null) */
  readonly value: T | null
  readonly onPick: (next: T) => void
  readonly testID?: string
}

/** 누름 바탕이 글보다 양옆으로 이만큼 넓다 — 글은 창 안쪽 여백(24)에 그대로 선다 */
const ROW_BLEED = SPACE.md
/** 체크 크기 (토스 ≈ 24) */
export const CHOICE_CHECK = 24

/** 고른 줄 체크: 주색, 굵은 선, 둥근 끝 */
export function ChoiceCheck({ size = CHOICE_CHECK, color }: { readonly size?: number; readonly color?: string }) {
  const { p } = useKit()
  return (
    <View aria-hidden testID="choice-check" pointerEvents="none" style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d="M5 12.6 L10 17.4 L19.2 7.4" stroke={color ?? p.primary} strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </Svg>
    </View>
  )
}

export function SheetChoices<T extends string | number>({ label, choices, value, onPick, testID }: SheetChoicesProps<T>) {
  const { p } = useKit()
  return (
    <View role="radiogroup" aria-label={label} testID={testID} style={{ marginHorizontal: -ROW_BLEED }}>
      {choices.map((item) => {
        const on = item.value === value
        const name = item.accent === undefined ? item.label : `${item.accent} ${item.label}`
        return (
          <Tap
            key={String(item.value)}
            role="radio"
            aria-checked={on}
            aria-label={name}
            onPress={() => onPick(item.value)}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, minHeight: 56, paddingHorizontal: ROW_BLEED, paddingVertical: SPACE.sm + 2, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}
          >
            {item.accent === undefined ? null : (
              <Txt step="bodyLarge" weight="bold" color="primaryText">
                {item.accent}
              </Txt>
            )}
            <View style={{ flex: 1, gap: 2 }}>
              <Txt step="bodyLarge" weight="bold">
                {item.label}
              </Txt>
              {item.description === undefined ? null : (
                <Txt step="meta" color="textSub">
                  {item.description}
                </Txt>
              )}
            </View>
            {on ? <ChoiceCheck /> : <View aria-hidden style={{ width: CHOICE_CHECK, height: CHOICE_CHECK }} />}
          </Tap>
        )
      })}
    </View>
  )
}
