// 버튼: 큰 버튼(주·보조·위험), 단추 묶음(ButtonRow), 작은 회색 단추(SmallButton), 화면 아래 고정 영역(BottomCTA).
// 단추 둘 이상은 늘 좌우로 놓고, 부정(취소·아니에요)은 왼쪽, 긍정(확인·맞아요)은 오른쪽 (D-UX4-01, 사용자 지시 2026-11-03 "모든 작업에서").
import { Children, Fragment, isValidElement, type ReactNode } from 'react'
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

/** 조각(<>…</>)을 풀어 단추 하나하나로 */
function flatButtons(node: ReactNode): ReactNode[] {
  return Children.toArray(node).flatMap((child) => (isValidElement(child) && child.type === Fragment ? flatButtons((child.props as { readonly children?: ReactNode }).children) : [child]))
}

/**
 * 단추 묶음 (D-UX4-01): 위아래로 쌓지 않고 좌우로 같은 폭씩 나눈다. 놓는 순서 그대로 왼쪽부터 —
 * 부정(취소·아니에요·안 뽑아요)을 먼저, 긍정(확인·맞아요)을 마지막에 둔다. 단추가 하나면 한 줄 가득.
 */
export function ButtonRow({ children }: { readonly children?: ReactNode }) {
  const items = flatButtons(children)
  if (items.length === 0) return null
  return (
    <View style={{ flexDirection: 'row', gap: SPACE.sm }}>
      {items.map((item, index) => (
        <View key={isValidElement(item) && item.key !== null ? item.key : index} style={{ flex: 1 }}>
          {item}
        </View>
      ))}
    </View>
  )
}

/**
 * 작은 회색 단추 (D-UX4-04, 토스 "내 NH투자증권 … 입력"처럼): 글자만큼의 폭으로 가운데, 옅은 회색 바탕, 높이 44.
 * 화면의 주 일이 아닌 곁길("링크를 모르겠어요")에 쓴다.
 */
export function SmallButton({ label, onPress, disabled, testID }: { readonly label: string; readonly onPress: () => void; readonly disabled?: boolean; readonly testID?: string }) {
  const { p } = useKit()
  return (
    <Pressable
      role="button"
      aria-label={label}
      aria-disabled={disabled === true}
      disabled={disabled === true}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({
        alignSelf: 'center',
        minHeight: 44,
        paddingHorizontal: SPACE.lg,
        justifyContent: 'center',
        borderRadius: RADIUS.md, borderCurve: 'continuous',
        backgroundColor: pressed ? p.pressed : p.surfaceAlt,
        opacity: disabled === true ? 0.45 : 1,
      })}
    >
      <Txt weight="medium" color="textSub" center>
        {label}
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
 * 화면 맨 아래에 붙는 큰 버튼 자리. 홈 막대(안전 영역)를 피하고, 버튼은 좌우로 놓는다(D-UX4-01 — 옛: 세로로 쌓음).
 * children 순서대로 왼쪽부터 놓이니 주 버튼을 마지막(오른쪽)에 둔다.
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
      <ButtonRow>{children}</ButtonRow>
    </View>
  )
}
