// 공통 조각: 큰 단추·입력칸·알림 상자·꼬리표·화면 틀. 모양은 공통 디자인 바탕(ui/kit)에서 가져오고,
// 역할(role)·이름(aria-label)을 정확히 달아 시험·보조 기술이 잡기 쉽게 한다. (화면들이 쓰는 이 이름·인자는 그대로 둔다.)
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, ScrollView, TextInput, View, type TextInputProps } from 'react-native'
import { RADIUS, SHADOW, SPACE, TOUCH } from './kit/tokens.ts'
import { Txt, useKit, type TxtColor } from './kit/theme.tsx'
import type { Tone } from './theme.ts'

const TONE_MARK: Readonly<Record<Tone, string>> = { info: 'i', success: '✓', warning: '!', danger: '✕' }

export function Screen({ title, children, testID }: { readonly title?: string; readonly children: ReactNode; readonly testID?: string }) {
  const { p } = useKit()
  return (
    <ScrollView style={{ flex: 1, backgroundColor: p.background }} contentContainerStyle={{ padding: SPACE.lg, paddingTop: SPACE.xl, gap: SPACE.lg, paddingBottom: 48 }} keyboardShouldPersistTaps="handled" testID={testID}>
      {title !== undefined ? <Title>{title}</Title> : null}
      {children}
    </ScrollView>
  )
}

export function Title({ children }: { readonly children: ReactNode }) {
  return (
    <Txt step="headline" weight="bold" role="heading" aria-level={1}>
      {children}
    </Txt>
  )
}

export function SectionTitle({ children }: { readonly children: ReactNode }) {
  return (
    <Txt step="section" weight="bold" role="heading" aria-level={2}>
      {children}
    </Txt>
  )
}

export function Body({ children, muted, bold, big }: { readonly children: ReactNode; readonly muted?: boolean; readonly bold?: boolean; readonly big?: boolean }) {
  return (
    <Txt step={big === true ? 'bodyLarge' : 'body'} weight={bold === true ? 'bold' : 'regular'} color={muted === true ? 'textSub' : 'text'}>
      {children}
    </Txt>
  )
}

export function Hint({ children }: { readonly children: ReactNode }) {
  return (
    <Txt step="caption" color="textSub">
      {children}
    </Txt>
  )
}

export interface BigButtonProps {
  readonly label: string
  readonly onPress: () => void
  readonly primary?: boolean
  readonly danger?: boolean
  readonly disabled?: boolean
  /** 줄 안에 나란히 놓는 작은 단추 (그래도 누르는 칸은 52) */
  readonly small?: boolean
  /** 보이는 글과 다른 이름이 필요할 때 ("지금 상품으로 — 15번") */
  readonly ariaLabel?: string
  readonly testID?: string
}

export function BigButton({ label, onPress, primary, danger, disabled, small, ariaLabel, testID }: BigButtonProps) {
  const { p } = useKit()
  const fill = danger === true ? p.danger : primary === true ? p.primary : p.secondary
  const ink: TxtColor = danger === true ? 'onDanger' : primary === true ? 'onPrimary' : 'onSecondary'
  return (
    <Pressable
      role="button"
      aria-label={ariaLabel ?? label}
      aria-disabled={disabled === true}
      disabled={disabled === true}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({
        minHeight: small === true ? TOUCH.min : TOUCH.button,
        minWidth: TOUCH.min,
        maxWidth: '100%',
        flexShrink: 1,
        paddingHorizontal: small === true ? SPACE.lg : SPACE.xl,
        paddingVertical: SPACE.md,
        borderRadius: RADIUS.lg,
        backgroundColor: fill,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled === true ? 0.45 : pressed ? 0.85 : 1,
      })}
    >
      <Txt step="bodyLarge" weight="bold" color={ink} center>
        {label}
      </Txt>
    </Pressable>
  )
}

export function Row({ children, wrap }: { readonly children: ReactNode; readonly wrap?: boolean }) {
  return <View style={{ flexDirection: 'row', gap: TOUCH.gap, alignItems: 'center', flexWrap: wrap === true ? 'wrap' : 'nowrap' }}>{children}</View>
}

export function Stack({ children, gap, tight }: { readonly children: ReactNode; readonly gap?: number; readonly tight?: boolean }) {
  return <View style={{ gap: gap ?? (tight === true ? 6 : SPACE.md) }}>{children}</View>
}

export interface FieldProps extends Omit<TextInputProps, 'style'> {
  readonly label: string
  readonly problem?: string | null
  readonly hint?: string | null
}

export function Field({ label, problem, hint, ...input }: FieldProps) {
  const { p, fontScale, forced } = useKit()
  const bad = problem !== undefined && problem !== null
  return (
    <View style={{ gap: SPACE.sm }}>
      <Txt step="bodyLarge" weight="bold">
        {label}
      </Txt>
      <TextInput
        aria-label={label}
        aria-invalid={bad}
        maxFontSizeMultiplier={2}
        placeholderTextColor={p.textSub}
        {...input}
        style={{ minHeight: TOUCH.button, fontSize: forced ? 22 * fontScale : 22, paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md, borderWidth: bad ? 3 : 2, borderColor: bad ? p.dangerText : p.borderStrong, borderRadius: RADIUS.md, color: p.text, backgroundColor: p.surface }}
      />
      {hint !== undefined && hint !== null ? <Hint>{hint}</Hint> : null}
      {bad ? (
        <View style={{ flexDirection: 'row', gap: SPACE.xs }}>
          <View aria-hidden>
            <Txt step="caption" weight="bold" color="dangerText">
              ⚠
            </Txt>
          </View>
          <View style={{ flex: 1 }}>
            <Txt step="caption" weight="bold" color="dangerText" role="alert">
              {problem}
            </Txt>
          </View>
        </View>
      ) : null}
    </View>
  )
}

export function Notice({ tone, children, alert, label }: { readonly tone: Tone; readonly children: ReactNode; readonly alert?: boolean; readonly label?: string }) {
  const { tones } = useKit()
  const pair = tones[tone]
  return (
    <View role={alert === true ? 'alert' : 'status'} aria-label={label} style={{ padding: SPACE.lg, borderRadius: RADIUS.md, backgroundColor: pair.bg, borderLeftWidth: 6, borderLeftColor: pair.fg }}>
      <Txt step="body" ink={pair.fg}>
        {children}
      </Txt>
    </View>
  )
}

export function Tag({ tone, children }: { readonly tone: Tone; readonly children: ReactNode }) {
  const { tones } = useKit()
  const pair = tones[tone]
  return (
    <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, paddingHorizontal: SPACE.md, paddingVertical: SPACE.xs, borderRadius: RADIUS.pill, backgroundColor: pair.bg }}>
      <View aria-hidden>
        <Txt step="caption" weight="heavy" ink={pair.fg}>
          {TONE_MARK[tone]}
        </Txt>
      </View>
      <Txt step="caption" weight="bold" ink={pair.fg}>
        {children}
      </Txt>
    </View>
  )
}

export function Card({ children, label }: { readonly children: ReactNode; readonly label?: string }) {
  const { p } = useKit()
  return (
    <View aria-label={label} role={label === undefined ? undefined : 'group'} style={{ padding: SPACE.lg, borderRadius: RADIUS.lg, backgroundColor: p.surface, gap: SPACE.md, ...SHADOW.card }}>
      {children}
    </View>
  )
}

export function Loading({ text }: { readonly text?: string }) {
  const { p } = useKit()
  return (
    <View role="status" style={{ flexDirection: 'row', gap: SPACE.md, alignItems: 'center', padding: SPACE.md }}>
      <ActivityIndicator color={p.primary} />
      <Body>{text ?? '불러오는 중…'}</Body>
    </View>
  )
}

/** 큰 빨간 글 (듣기 멈춤 등) */
export function BigRed({ title, body }: { readonly title: string; readonly body: string }) {
  const { p, tones } = useKit()
  return (
    <View role="alert" style={{ padding: SPACE.lg, borderRadius: RADIUS.lg, backgroundColor: tones.danger.bg, borderWidth: 3, borderColor: p.dangerText, gap: SPACE.sm }}>
      <Txt step="title" weight="heavy" color="dangerText">
        {title}
      </Txt>
      <Txt step="body" color="dangerText">
        {body}
      </Txt>
    </View>
  )
}
