// 전체 탭·설정 화면들이 함께 쓰는 조각 (D-UX3-96, 토스 "설정"처럼): 회색 바탕 위 흰 묶음 카드 — 카드 안 맨 위에 작은 회색 묶음 이름,
// 그 아래 줄들(오른쪽에 값·스위치·›). 곁길 일은 큰 단추 대신 글자만의 작은 단추로, 설명은 카드 아래 한 줄 회색 글로.
// 공통 조각(ui/kit)은 다른 탭도 쓰니 건드리지 않고 이 화면들에서만 쓴다.
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, View } from 'react-native'
import { Icon, Txt, useKit } from '../../ui/kit/index.ts'
import type { TxtColor } from '../../ui/kit/theme.tsx'
import { RADIUS, SPACE, TOUCH } from '../../ui/kit/tokens.ts'

/** 설정 화면 양옆 여백 */
export const SETTINGS_GUTTER = SPACE.lg

/** 흰 묶음 카드: title이 있으면 카드 안 맨 위에 작은 회색 이름(홈 "내 방송"·전체 탭 묶음과 같은 모양) */
export function SettingsGroup({ title, label, children, testID }: { readonly title?: string; readonly label?: string; readonly children?: ReactNode; readonly testID?: string }) {
  const { p } = useKit()
  const name = label ?? title
  return (
    <View role={name === undefined ? undefined : 'group'} aria-label={name} testID={testID} style={{ backgroundColor: p.surface, borderRadius: RADIUS.xl, borderCurve: 'continuous', paddingHorizontal: SPACE.xl, paddingTop: title === undefined ? SPACE.md : SPACE.lg + 2, paddingBottom: SPACE.md, gap: SPACE.sm }}>
      {title === undefined ? null : (
        <Txt step="body" weight="regular" color="textSub" role="heading" aria-level={2}>
          {title}
        </Txt>
      )}
      {children}
    </View>
  )
}

/** 카드 안·아래 한 줄 설명 (작은 회색 글) */
export function GroupNote({ children }: { readonly children: ReactNode }) {
  return (
    <Txt step="caption" color="textSub">
      {children}
    </Txt>
  )
}

/** 칸 묶음 이름 (고르기 알약 위 "택배사" 등) */
export function FieldLabel({ children }: { readonly children: ReactNode }) {
  return (
    <Txt step="body" weight="medium">
      {children}
    </Txt>
  )
}

/** 보기만 하는 줄: 왼쪽 이름 · 오른쪽 값 (토스 설정의 "버전 1.2.3") */
export function ValueRow({ title, value, testID }: { readonly title: string; readonly value: string; readonly testID?: string }) {
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, minHeight: 40 }}>
      <View style={{ flex: 1 }}>
        <Txt step="bodyLarge" weight="book">
          {title}
        </Txt>
      </View>
      <Txt color="textSub">{value}</Txt>
    </View>
  )
}

/**
 * 글자만의 작은 단추 (홈 "모두보기"처럼): 곁길 일(지우기·고치기·영상 댓글 끄기)에 큰 회색 단추 대신 쓴다.
 * 눈에 보이는 크기는 작아도 누르는 자리는 hitSlop으로 48 가까이 넓힌다.
 */
export function TextButton({ label, ariaLabel, onPress, disabled, busy, color = 'textSub', align = 'auto', testID }: { readonly label: string; readonly ariaLabel?: string; readonly onPress: () => void; readonly disabled?: boolean; readonly busy?: boolean; readonly color?: TxtColor; readonly align?: 'auto' | 'flex-start' | 'flex-end'; readonly testID?: string }) {
  const { p } = useKit()
  const off = disabled === true || busy === true
  return (
    <Pressable
      role="button"
      aria-label={ariaLabel ?? label}
      aria-disabled={off}
      aria-busy={busy === true}
      disabled={off}
      onPress={onPress}
      testID={testID}
      hitSlop={8}
      style={({ pressed }) => ({ alignSelf: align, flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, minHeight: 36, paddingHorizontal: SPACE.sm, borderRadius: RADIUS.sm, borderCurve: 'continuous', backgroundColor: pressed && !off ? p.pressed : 'transparent', opacity: disabled === true ? 0.45 : 1 })}
    >
      {busy === true ? <ActivityIndicator size="small" color={p.textSub} /> : null}
      <Txt weight="medium" color={color}>
        {label}
      </Txt>
    </Pressable>
  )
}

/** 펼치기 줄 ("판매 규칙 상세 설정 ⌄"): 큰 회색 단추 대신 카드 안 글자 줄 */
export function DetailToggle({ label, open, onPress }: { readonly label: string; readonly open: boolean; readonly onPress: () => void }) {
  const { p } = useKit()
  return (
    <Pressable role="button" aria-label={`${label} ${open ? '닫기' : '열기'}`} aria-expanded={open} onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, minHeight: TOUCH.min, marginHorizontal: -SPACE.sm, paddingHorizontal: SPACE.sm, borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
      <View style={{ flex: 1 }}>
        <Txt step="bodyLarge" weight="book" color="textSub">
          {label}
        </Txt>
      </View>
      <Icon name={open ? 'up' : 'down'} color={p.textSub} size={20} />
    </Pressable>
  )
}
