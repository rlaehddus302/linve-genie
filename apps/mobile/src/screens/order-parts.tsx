// 주문 탭 화면들이 같이 쓰는 조각 (D-UX3-93, 홈처럼 토스식으로 다듬기): 흰 묶음 카드(안에 회색 묶음 이름) · 이름-값 줄 · 누르는 줄 · 작은 글자 단추.
// 정산·리포트·입금 확인·입금 받는 곳·손님 정보 문자·영수증 화면이 같은 간격·글자 크기를 쓰게 한다.
import type { ReactNode } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { Icon, Txt, useKit, Tap } from '../ui/kit/index.ts'
import type { TxtColor } from '../ui/kit/theme.tsx'
import { RADIUS, GUTTER, SPACE, TOUCH } from '../ui/kit/tokens.ts'

/** 화면 좌우 여백·카드 사이 (홈과 같다) — 회색 화면 여백 GUTTER 하나 (D-UX4-101: 주문·입금·영수증·리포트도 옛 20이었다 — D-UX4-74가 빠뜨림) */
export const PAGE_SIDE = GUTTER
export const CARD_GAP = SPACE.lg

/**
 * 흰 묶음 카드 (토스 "전체" 카드처럼): title이 있으면 맨 위에 본문 크기·보통 굵기·회색 묶음 이름.
 * flush면 안쪽 좌우 여백 없이(누르는 줄이 스스로 여백을 가진다).
 */
export function SectionCard({ title, label, children, flush, testID }: { readonly title?: string; readonly label?: string; readonly children?: ReactNode; readonly flush?: boolean; readonly testID?: string }) {
  const { p } = useKit()
  const name = label ?? title
  return (
    <View role={name === undefined ? undefined : 'group'} aria-label={name} testID={testID} style={{ backgroundColor: p.surface, borderRadius: RADIUS.xl, borderCurve: 'continuous', paddingHorizontal: flush === true ? 0 : SPACE.xl, paddingTop: title === undefined ? (flush === true ? SPACE.sm : SPACE.xl) : SPACE.lg + 2, paddingBottom: flush === true ? SPACE.sm : SPACE.xl, gap: SPACE.md }}>
      {title === undefined ? null : (
        <View style={{ paddingHorizontal: flush === true ? SPACE.xl : 0 }}>
          <Txt step="body" weight="regular" color="textSub" role="heading" aria-level={2}>
            {title}
          </Txt>
        </View>
      )}
      {children}
    </View>
  )
}

/** 이름-값 한 줄: 이름은 왼쪽 회색, 값은 오른쪽. strong은 꼭 봐야 하는 숫자(최종·남은 금액)만 */
export function ValueLine({ label, value, strong, sub }: { readonly label: string; readonly value: string; readonly strong?: boolean; readonly sub?: string }) {
  const on = strong === true
  return (
    <View style={{ gap: 2 }} aria-label={`${label} ${value}`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: SPACE.sm }}>
        <Txt step="body" weight={on ? 'medium' : 'regular'} color={on ? 'text' : 'textSub'}>
          {label}
        </Txt>
        <Txt step="bodyLarge" weight={on ? 'bold' : 'book'}>
          {value}
        </Txt>
      </View>
      {sub === undefined ? null : (
        <Txt step="caption" color="textSub">
          {sub}
        </Txt>
      )}
    </View>
  )
}

/** 카드 안 누르는 줄 (홈 할 일 줄과 같은 모양): 제목 · 짧은 설명 · 오른쪽 ›(처리 중이면 도는 표시) */
export function MenuRow({ title, sub, onPress, ariaLabel, busy, disabled, ink, testID }: { readonly title: string; readonly sub?: string; readonly onPress: () => void; readonly ariaLabel?: string; readonly busy?: boolean; readonly disabled?: boolean; readonly ink?: TxtColor; readonly testID?: string }) {
  const { p } = useKit()
  const off = busy === true || disabled === true
  return (
    <Tap role="button" aria-label={ariaLabel ?? title} aria-busy={busy === true} aria-disabled={off} disabled={off} onPress={onPress} testID={testID} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingVertical: SPACE.sm, paddingHorizontal: SPACE.xl - SPACE.sm, marginHorizontal: SPACE.sm, borderRadius: RADIUS.lg, borderCurve: 'continuous', minHeight: TOUCH.min, backgroundColor: pressed && !off ? p.pressed : 'transparent', opacity: disabled === true ? 0.45 : 1 })}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt step="bodyLarge" weight="book" color={ink ?? 'text'}>
          {title}
        </Txt>
        {sub === undefined ? null : (
          <Txt step="caption" color="textSub">
            {sub}
          </Txt>
        )}
      </View>
      {busy === true ? <ActivityIndicator color={p.textSub} /> : <Icon name="chevron" color={p.textSub} size={18} />}
    </Tap>
  )
}

/** 작은 회색 단추 (곁일: 링크 복사·PDF·지우기). 글자만큼의 폭, 높이 36 — 여럿이면 한 줄에 좌우로 */
export function ChipButton({ label, ariaLabel, onPress, busy, disabled, green, testID }: { readonly label: string; readonly ariaLabel?: string; readonly onPress: () => void; readonly busy?: boolean; readonly disabled?: boolean; readonly green?: boolean; readonly testID?: string }) {
  const { p } = useKit()
  const off = busy === true || disabled === true
  // green: 그 줄에서 먼저 할 일 (옅은 초록 바탕 — 보조 단추 색)
  const fill = green === true ? p.secondary : p.surfaceAlt
  const fillPressed = green === true ? p.secondaryPressed : p.softPressed
  return (
    <Tap role="button" aria-label={ariaLabel ?? label} aria-busy={busy === true} aria-disabled={off} disabled={off} onPress={onPress} testID={testID} hitSlop={4} style={({ pressed }) => ({ minHeight: 36, paddingHorizontal: SPACE.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACE.xs, borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: pressed && !off ? fillPressed : fill, opacity: disabled === true ? 0.45 : 1 })}>
      {busy === true ? <ActivityIndicator size="small" color={green === true ? p.onSecondary : p.textSub} /> : null}
      <Txt step="meta" weight="medium" color={green === true ? 'onSecondary' : 'text'}>
        {label}
      </Txt>
    </Tap>
  )
}

/** 글자만의 단추 (홈 "모두보기"처럼): 회색 작은 글자, 누르면 옅은 바탕 */
export function TextLink({ label, ariaLabel, onPress, color = 'textSub', testID }: { readonly label: string; readonly ariaLabel?: string; readonly onPress: () => void; readonly color?: TxtColor; readonly testID?: string }) {
  const { p } = useKit()
  return (
    <Tap role="button" aria-label={ariaLabel ?? label} onPress={onPress} testID={testID} hitSlop={8} style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center', paddingHorizontal: SPACE.sm, marginHorizontal: -SPACE.sm, borderRadius: RADIUS.sm, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
      <Txt step="meta" weight="medium" color={color}>
        {label}
      </Txt>
    </Tap>
  )
}
