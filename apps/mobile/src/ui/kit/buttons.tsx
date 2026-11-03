// 버튼: 큰 버튼(주·보조·위험)과 화면 아래 고정 영역(BottomCTA).
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, View } from 'react-native'
import { RADIUS, SPACE, TOUCH } from './tokens.ts'
import { Txt, useBottomInset, useKit, type TxtColor } from './theme.tsx'

/** outline: 테두리 없는 회색 단추 (방송 중 "직접 넣기"·홈 "새 방송 시작" 같은 둘째 버튼 — 토스식, D-UX3-02. 옛 흰 바탕+테두리) */
export type ButtonKind = 'primary' | 'secondary' | 'danger' | 'outline'

export interface BigButtonProps {
  readonly label: string
  readonly onPress: () => void
  readonly kind?: ButtonKind
  readonly disabled?: boolean
  /** 처리 중: 글자는 그대로 두고 눌러도 아무 일도 없다 */
  readonly busy?: boolean
  /** 보이는 글과 다른 이름이 필요할 때 ("지금 상품으로 — 15번") */
  readonly ariaLabel?: string
  /** 글자 앞에 붙는 기호. 아이콘만 두지 않고 반드시 글자와 함께 보인다. */
  readonly icon?: string
  /** 글자 앞에 붙는 그림 조각 (선 아이콘) — 보조 기술에는 읽히지 않는다 */
  readonly leading?: ReactNode
  readonly testID?: string
  /** 좁은 자리의 짧은 글 ("직접 넣기"): 한 줄로만 — 안 들어가면 글자를 조금 줄인다(한글이 낱말 가운데서 끊기지 않게) */
  readonly oneLine?: boolean
}

export function BigButton({ label, onPress, kind = 'primary', disabled, busy, ariaLabel, icon, leading, testID, oneLine }: BigButtonProps) {
  const { p } = useKit()
  const off = disabled === true || busy === true
  const fill = kind === 'primary' ? p.primary : kind === 'danger' ? p.danger : kind === 'outline' ? p.soft : p.secondary
  // 누르는 동안 바탕이 진해진다 (흐려지지 않는다 — D-UX3-03)
  const fillPressed = kind === 'primary' ? p.primaryPressed : kind === 'danger' ? p.dangerPressed : kind === 'outline' ? p.softPressed : p.secondaryPressed
  const ink: TxtColor = kind === 'primary' ? 'onPrimary' : kind === 'danger' ? 'onDanger' : kind === 'outline' ? 'text' : 'onSecondary'
  return (
    <Pressable
      role="button"
      aria-label={ariaLabel ?? label}
      aria-disabled={off}
      aria-busy={busy === true}
      disabled={off}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({
        minHeight: TOUCH.button,
        borderRadius: RADIUS.lg, borderCurve: 'continuous',
        paddingHorizontal: oneLine === true ? SPACE.md : SPACE.xl,
        paddingVertical: SPACE.md,
        backgroundColor: pressed && !off ? fillPressed : fill,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: SPACE.sm,
        opacity: disabled === true ? 0.45 : 1,
      })}
    >
      {busy === true ? <ActivityIndicator color={p[ink]} /> : null}
      {busy !== true && leading !== undefined ? leading : null}
      <Txt step="bodyLarge" weight="heavy" color={ink} center {...(oneLine === true ? { numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.7 } : {})}>
        {icon === undefined ? label : `${icon} ${label}`}
      </Txt>
    </Pressable>
  )
}

export interface BottomCTAProps {
  readonly children?: ReactNode
  /** 한 줄 도움말 (버튼 위) */
  readonly note?: string
}

/**
 * 화면 맨 아래에 붙는 큰 버튼 자리. 홈 막대(안전 영역)를 피하고, 버튼은 세로로 쌓는다(한 손·큰 글자에서도 안 깨짐).
 * 주 버튼이 가장 아래, 보조 버튼은 그 위. children 순서대로 위에서 아래로 놓이니 주 버튼을 마지막에 둔다.
 */
export function BottomCTA({ children, note }: BottomCTAProps) {
  const { p } = useKit()
  const inset = useBottomInset()
  return (
    <View
      role="toolbar"
      aria-label="화면 아래 버튼"
      style={{ backgroundColor: p.surface, borderTopWidth: 1, borderTopColor: p.line, paddingHorizontal: SPACE.lg, paddingTop: SPACE.md, paddingBottom: Math.max(inset, SPACE.md) + SPACE.xs, gap: SPACE.sm }}
    >
      {note === undefined ? null : (
        <Txt step="caption" color="textSub" center>
          {note}
        </Txt>
      )}
      {children}
    </View>
  )
}
