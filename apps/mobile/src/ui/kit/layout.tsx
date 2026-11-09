// 자리 잡는 조각: 화면 틀(KitScreen), 묶음(Section), 카드(Card), 줄(ListRow·ToggleRow), 빈 화면(EmptyState).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Animated, Easing, Platform, ScrollView, View } from 'react-native'
import { Icon } from './app.tsx'
import { BigButton } from './buttons.tsx'
import { RADIUS, SHADOW, SPACE, TOUCH, type TypeStep } from './tokens.ts'
import { Txt, useKit, type TxtProps } from './theme.tsx'
import { Tap, usePressMotion } from './press.tsx'

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

/** 흰 카드. title이 있으면 카드 안 맨 위에 묶음 이름(+ 설명) — 토스 설정 "인증 및 보안"처럼 (D-UX3-04) */
export function Card({ children, label, title, description, testID }: { readonly children?: ReactNode; readonly label?: string; readonly title?: string; readonly description?: string; readonly testID?: string }) {
  const { p } = useKit()
  const name = label ?? title
  return (
    <View role={name === undefined ? undefined : 'group'} aria-label={name} testID={testID} style={{ backgroundColor: p.surface, borderRadius: RADIUS.xl, borderCurve: 'continuous', padding: SPACE.xl, gap: SPACE.md, ...SHADOW.card }}>
      {title === undefined ? null : (
        <View style={{ gap: SPACE.xs }}>
          <Txt step="bodyLarge" weight="heavy" role="heading" aria-level={2}>
            {title}
          </Txt>
          {description === undefined ? null : <Txt step="caption" color="textSub">{description}</Txt>}
        </View>
      )}
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
  const { p, stacked } = useKit()
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
    <Tap role="button" aria-label={ariaLabel ?? [title, value].filter((x) => x !== undefined).join(' — ')} onPress={onPress} testID={testID} style={({ pressed }) => ({ ...frame, backgroundColor: pressed ? p.pressed : 'transparent', borderRadius: RADIUS.md, borderCurve: 'continuous', marginHorizontal: -SPACE.sm, paddingHorizontal: SPACE.sm })}>
      {body}
      <Icon name="chevron" size={20} />
    </Tap>
  )
}

/** 스위치 치수 (토스·아이폰 스위치 비율) */
export const SWITCH = { width: 52, height: 32, knob: 26 } as const
const SWITCH_MS = 180

/**
 * 켜고 끄는 줄 (D-UX4-06, 사용자 지시 2026-11-03 "온오프 스위치는 토스처럼" — 옛: "켜짐/꺼짐" 글자가 든 큰 알약):
 * 오른쪽 스위치 — 켜면 주색 바탕에 흰 동그라미가 오른쪽으로 미끄러진다. 줄 어디를 눌러도 바뀐다. 보조 기술에는 "제목 — 켜짐/꺼짐".
 */
/** titleStep·titleWeight·titleInk: 이름 글자 (기본 16 중간 굵기 — 흰 설정 화면 줄은 17 보통 #4F545E, D-UX4-94) */
export function ToggleRow({ title, subtitle, on, onChange, disabled, onHelp, testID, titleStep = 'bodyLarge', titleWeight = 'medium', titleInk }: { readonly title: string; readonly subtitle?: string; readonly on: boolean; readonly onChange: (next: boolean) => void; readonly disabled?: boolean; readonly onHelp?: () => void; readonly testID?: string; readonly titleStep?: TypeStep; readonly titleWeight?: NonNullable<TxtProps['weight']>; readonly titleInk?: string }) {
  const { p } = useKit()
  const move = useRef(new Animated.Value(on ? 1 : 0)).current
  const press = usePressMotion()
  const [helpDown, setHelpDown] = useState(false)
  useEffect(() => {
    if (Platform.OS === 'web') {
      move.setValue(on ? 1 : 0)
      return
    }
    Animated.timing(move, { toValue: on ? 1 : 0, duration: SWITCH_MS, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start()
  }, [on, move])
  const gap = (SWITCH.height - SWITCH.knob) / 2
  const knobX = move.interpolate({ inputRange: [0, 1], outputRange: [gap, SWITCH.width - SWITCH.knob - gap] })
  const track = move.interpolate({ inputRange: [0, 1], outputRange: [p.soft, p.primary] })
  // 이름 묶음: 스위치와 한 줄일 때만 가로로 남은 폭을 채운다. 설명 단추 안(세로 틀)에서 flex: 1이면 위아래로 늘어나 이름이 위에 붙는다 (D-UX4-73)
  const words = (
    <View style={onHelp === undefined ? { flex: 1, gap: SPACE.xs } : { gap: SPACE.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Txt step={titleStep} weight={titleWeight} {...(titleInk === undefined ? {} : { ink: titleInk })}>
          {title}
        </Txt>
        {onHelp === undefined ? null : <Icon name="help" size={20} color={p.textSub} />}
      </View>
      {subtitle === undefined ? null : <Txt step="caption" color="textSub">{subtitle}</Txt>}
    </View>
  )
  const knob = (
    <Animated.View aria-hidden style={{ width: SWITCH.width, height: SWITCH.height, borderRadius: SWITCH.height / 2, borderCurve: 'continuous', backgroundColor: track, justifyContent: 'center' }}>
      <Animated.View style={{ position: 'absolute', left: 0, width: SWITCH.knob, height: SWITCH.knob, borderRadius: SWITCH.knob / 2, borderCurve: 'continuous', backgroundColor: '#FFFFFF', transform: [{ translateX: knobX }], shadowColor: '#000000', shadowOpacity: 0.15, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 }} />
    </Animated.View>
  )
  const switchProps = {
    role: 'switch' as const,
    'aria-checked': on,
    'aria-label': `${title} — ${on ? '켜짐' : '꺼짐'}`,
    'aria-disabled': disabled === true,
    disabled: disabled === true,
    onPress: () => onChange(!on),
    testID,
  }
  if (onHelp === undefined) {
    return (
      <Tap {...switchProps} style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, minHeight: TOUCH.min, paddingVertical: SPACE.sm, opacity: disabled === true ? 0.45 : 1 }}>
        {words}
        {knob}
      </Tap>
    )
  }
  // 설명이 있는 줄 (D-UX4-64, 토스 "빠른 로그인 ⓘ"): 이름 자리를 누르면 줄 전체가 꾸욱 작아지며 옅은 회색 둥근 바탕이 생기고, 떼면 설명 판. 스위치는 따로 켜고 끈다
  const size = press.value.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97] })
  return (
    <Animated.View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, minHeight: TOUCH.min + SPACE.sm, marginHorizontal: -SPACE.md, paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: helpDown ? p.surfaceAlt : 'transparent', transform: [{ scale: size }] }}>
      {/* 줄 전체가 작아지므로(위 size) 이 칸은 따로 줄이지 않는다 */}
      <Tap
        role="button"
        aria-label={`${title} 설명 보기`}
        onPress={onHelp}
        pressScale={1}
        onPressIn={() => {
          setHelpDown(true)
          press.pressIn()
        }}
        onPressOut={() => {
          setHelpDown(false)
          press.pressOut()
        }}
        style={{ flex: 1, alignSelf: 'stretch', justifyContent: 'center' }}
      >
        {words}
      </Tap>
      <Tap {...switchProps} hitSlop={SPACE.sm} style={{ opacity: disabled === true ? 0.45 : 1 }}>
        {knob}
      </Tap>
    </Animated.View>
  )
}

/**
 * 목록이 비었을 때 그 자리 한가운데 안내 (D-UX4-56, 사용자 지시 2026-11-09 "그 영역 중간에 가로세로 중간 정렬해서 폰트 크기랑 두께 좀 키워서"):
 * 굵은 한 줄(title) + 아래 회색 설명(body). 줄 바꿈(\n)은 뜻이 끊기는 곳에. 부모가 늘어나는 자리(flexGrow)면 세로 가운데, 아니면 위아래 넉넉한 여백.
 * 모든 탭·화면의 빈 목록은 이것만 쓴다.
 */
export function EmptyFill({ title, body, testID }: { readonly title: string; readonly body?: string; readonly testID?: string }) {
  return (
    <View role="status" aria-label={body === undefined ? title : `${title} ${body.replace(/\n/g, ' ')}`} testID={testID} style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: SPACE.xxxl, paddingHorizontal: SPACE.lg, gap: SPACE.sm }}>
      <Txt step="lead" weight="bold" center>
        {title}
      </Txt>
      {body === undefined ? null : (
        <Txt step="body" weight="medium" color="textSub" center>
          {body}
        </Txt>
      )}
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
