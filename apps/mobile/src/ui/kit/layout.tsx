// 자리 잡는 조각: 화면 틀(KitScreen), 묶음(Section), 카드(Card), 줄(ListRow·ToggleRow), 빈 화면(EmptyState).
import type { ReactNode } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { BigButton } from './buttons.tsx'
import { RADIUS, SHADOW, SPACE, TOUCH } from './tokens.ts'
import { Txt, useKit } from './theme.tsx'

/** 화면 틀: 맨 위 큰 질문형 제목 + 내용(스크롤) + 맨 아래 고정 영역(footer, 보통 BottomCTA). 한 화면 한 가지 일. */
export function KitScreen({ title, lead, children, footer, testID }: { readonly title: string; readonly lead?: string; readonly children?: ReactNode; readonly footer?: ReactNode; readonly testID?: string }) {
  const { p } = useKit()
  return (
    <View style={{ flex: 1, backgroundColor: p.background }} testID={testID}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: SPACE.lg, paddingTop: SPACE.xxl, gap: SPACE.xl, paddingBottom: SPACE.xxxl }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: SPACE.sm }}>
          <Txt step="headline" weight="bold" role="heading" aria-level={1}>
            {title}
          </Txt>
          {lead === undefined ? null : (
            <Txt color="textSub">{lead}</Txt>
          )}
        </View>
        {children}
      </ScrollView>
      {footer}
    </View>
  )
}

/** 묶음: 제목 + 설명 + 내용 */
export function Section({ title, description, children }: { readonly title: string; readonly description?: string; readonly children?: ReactNode }) {
  return (
    <View role="group" aria-label={title} style={{ gap: SPACE.md }}>
      <View style={{ gap: SPACE.xs }}>
        <Txt step="section" weight="bold" role="heading" aria-level={2}>
          {title}
        </Txt>
        {description === undefined ? null : <Txt step="caption" color="textSub">{description}</Txt>}
      </View>
      {children}
    </View>
  )
}

export function Card({ children, label, testID }: { readonly children?: ReactNode; readonly label?: string; readonly testID?: string }) {
  const { p } = useKit()
  return (
    <View role={label === undefined ? undefined : 'group'} aria-label={label} testID={testID} style={{ backgroundColor: p.surface, borderRadius: RADIUS.lg, padding: SPACE.xl, gap: SPACE.md, ...SHADOW.card }}>
      {children}
    </View>
  )
}

export interface ListRowProps {
  readonly title: string
  readonly subtitle?: string
  /** 오른쪽 값 ("켜짐", "12,000원") — 글자 */
  readonly value?: string
  /** 오른쪽에 둘 조각 (꼬리표 등) */
  readonly right?: ReactNode
  readonly onPress?: () => void
  readonly ariaLabel?: string
  readonly testID?: string
}

/** 줄: 누를 수 있으면 오른쪽에 ›(눈에는 보이되 읽어 주지는 않음)를 둔다. 글자가 2배가 되면 값이 제목 아래로 내려간다. */
export function ListRow({ title, subtitle, value, right, onPress, ariaLabel, testID }: ListRowProps) {
  const { stacked } = useKit()
  const tail = (
    <>
      {value === undefined ? null : (
        <Txt weight="medium" color="textSub">
          {value}
        </Txt>
      )}
      {right}
    </>
  )
  const body = (
    <View style={{ flexDirection: stacked ? 'column' : 'row', alignItems: stacked ? 'flex-start' : 'center', gap: SPACE.sm, flex: 1 }}>
      <View style={{ flex: stacked ? undefined : 1, gap: SPACE.xs }}>
        <Txt step="bodyLarge" weight="medium">
          {title}
        </Txt>
        {subtitle === undefined ? null : <Txt step="caption" color="textSub">{subtitle}</Txt>}
      </View>
      {value === undefined && right === undefined ? null : <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>{tail}</View>}
    </View>
  )
  const frame = { minHeight: TOUCH.min, paddingVertical: SPACE.md, flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACE.sm }
  if (onPress === undefined) {
    return (
      <View testID={testID} style={frame}>
        {body}
      </View>
    )
  }
  return (
    <Pressable role="button" aria-label={ariaLabel ?? [title, value].filter((x) => x !== undefined).join(' — ')} onPress={onPress} testID={testID} style={({ pressed }) => ({ ...frame, opacity: pressed ? 0.6 : 1, borderRadius: RADIUS.md })}>
      {body}
      <View aria-hidden>
        <Txt step="title" color="textSub">
          ›
        </Txt>
      </View>
    </Pressable>
  )
}

/** 켜고 끄는 줄: 스위치 모양 대신 "켜짐/꺼짐" 글자가 든 큰 알약. 한 번 눌러 바뀐다. */
export function ToggleRow({ title, subtitle, on, onChange, disabled, testID }: { readonly title: string; readonly subtitle?: string; readonly on: boolean; readonly onChange: (next: boolean) => void; readonly disabled?: boolean; readonly testID?: string }) {
  const { p, stacked } = useKit()
  return (
    <View style={{ flexDirection: stacked ? 'column' : 'row', alignItems: stacked ? 'flex-start' : 'center', gap: SPACE.md, minHeight: TOUCH.min, paddingVertical: SPACE.sm }}>
      <View style={{ flex: stacked ? undefined : 1, gap: SPACE.xs }}>
        <Txt step="bodyLarge" weight="medium">
          {title}
        </Txt>
        {subtitle === undefined ? null : <Txt step="caption" color="textSub">{subtitle}</Txt>}
      </View>
      <Pressable
        role="switch"
        aria-checked={on}
        aria-label={`${title} — ${on ? '켜짐' : '꺼짐'}`}
        aria-disabled={disabled === true}
        disabled={disabled === true}
        onPress={() => onChange(!on)}
        testID={testID}
        style={{ minHeight: TOUCH.min, minWidth: 96, paddingHorizontal: SPACE.xl, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? p.primary : p.surfaceAlt, borderWidth: on ? 0 : 2, borderColor: p.borderStrong, opacity: disabled === true ? 0.45 : 1 }}
      >
        <Txt step="bodyLarge" weight="bold" color={on ? 'onPrimary' : 'text'}>
          {on ? '켜짐' : '꺼짐'}
        </Txt>
      </Pressable>
    </View>
  )
}

/** 비어 있을 때: 무슨 일인지 + 다음에 할 일 하나 */
export function EmptyState({ title, description, actionLabel, onAction, icon }: { readonly title: string; readonly description?: string; readonly actionLabel?: string; readonly onAction?: () => void; readonly icon?: string }) {
  return (
    <View role="status" style={{ alignItems: 'center', gap: SPACE.md, paddingVertical: SPACE.xxxl, paddingHorizontal: SPACE.lg }}>
      {icon === undefined ? null : (
        <View aria-hidden>
          <Txt step="number" center>
            {icon}
          </Txt>
        </View>
      )}
      <Txt step="title" weight="bold" center>
        {title}
      </Txt>
      {description === undefined ? null : (
        <Txt color="textSub" center>
          {description}
        </Txt>
      )}
      {actionLabel !== undefined && onAction !== undefined ? (
        <View style={{ alignSelf: 'stretch', marginTop: SPACE.md }}>
          <BigButton label={actionLabel} onPress={onAction} />
        </View>
      ) : null}
    </View>
  )
}
