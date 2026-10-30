// 공통 조각: 큰 단추·입력칸·알림 상자·꼬리표·화면 틀. 역할(role)·이름(aria-label)을 정확히 달아 시험·보조 기술이 잡기 쉽게 한다.
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native'
import { COLOR, FONT, FONT_BIG, FONT_SMALL, GAP, TONE_BG, TONE_TEXT, TOUCH, type Tone } from './theme.ts'

export function Screen({ title, children, testID }: { readonly title?: string; readonly children: ReactNode; readonly testID?: string }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled" testID={testID}>
      {title !== undefined ? <Title>{title}</Title> : null}
      {children}
    </ScrollView>
  )
}

export function Title({ children }: { readonly children: ReactNode }) {
  return (
    <Text role="heading" aria-level={1} style={styles.title}>
      {children}
    </Text>
  )
}

export function SectionTitle({ children }: { readonly children: ReactNode }) {
  return (
    <Text role="heading" aria-level={2} style={styles.sectionTitle}>
      {children}
    </Text>
  )
}

export function Body({ children, muted, bold, big }: { readonly children: ReactNode; readonly muted?: boolean; readonly bold?: boolean; readonly big?: boolean }) {
  return <Text style={[styles.body, muted === true ? styles.muted : null, bold === true ? styles.bold : null, big === true ? styles.big : null]}>{children}</Text>
}

export function Hint({ children }: { readonly children: ReactNode }) {
  return <Text style={styles.hint}>{children}</Text>
}

export interface BigButtonProps {
  readonly label: string
  readonly onPress: () => void
  readonly primary?: boolean
  readonly danger?: boolean
  readonly disabled?: boolean
  readonly small?: boolean
  /** 보이는 글과 다른 이름이 필요할 때 ("지금 상품으로 — 15번") */
  readonly ariaLabel?: string
  readonly testID?: string
}

export function BigButton({ label, onPress, primary, danger, disabled, small, ariaLabel, testID }: BigButtonProps) {
  return (
    <Pressable
      role="button"
      aria-label={ariaLabel ?? label}
      aria-disabled={disabled === true}
      disabled={disabled === true}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        small === true ? styles.buttonSmall : null,
        primary === true ? styles.buttonPrimary : null,
        danger === true ? styles.buttonDanger : null,
        disabled === true ? styles.buttonDisabled : null,
        pressed ? styles.buttonPressed : null,
      ]}
    >
      <Text style={[styles.buttonText, primary === true || danger === true ? styles.buttonTextLight : null]}>{label}</Text>
    </Pressable>
  )
}

export function Row({ children, wrap }: { readonly children: ReactNode; readonly wrap?: boolean }) {
  return <View style={[styles.row, wrap === true ? styles.rowWrap : null]}>{children}</View>
}

export function Stack({ children, gap, tight }: { readonly children: ReactNode; readonly gap?: number; readonly tight?: boolean }) {
  return <View style={{ gap: gap ?? (tight === true ? 6 : GAP) }}>{children}</View>
}

export interface FieldProps extends Omit<TextInputProps, 'style'> {
  readonly label: string
  readonly problem?: string | null
  readonly hint?: string | null
}

export function Field({ label, problem, hint, ...input }: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput aria-label={label} style={[styles.input, problem !== undefined && problem !== null ? styles.inputProblem : null]} placeholderTextColor={COLOR.muted} {...input} />
      {hint !== undefined && hint !== null ? <Text style={styles.hint}>{hint}</Text> : null}
      {problem !== undefined && problem !== null ? (
        <Text role="alert" style={styles.problem}>
          {problem}
        </Text>
      ) : null}
    </View>
  )
}

export function Notice({ tone, children, alert, label }: { readonly tone: Tone; readonly children: ReactNode; readonly alert?: boolean; readonly label?: string }) {
  return (
    <View role={alert === true ? 'alert' : 'status'} aria-label={label} style={[styles.notice, { backgroundColor: TONE_BG[tone] }]}>
      <Text style={[styles.noticeText, { color: TONE_TEXT[tone] }]}>{children}</Text>
    </View>
  )
}

/** big: 글자 18px (기본 16px은 그대로 — 꼭 봐야 하는 꼬리표만 키운다, UX-PRN2-008) */
export function Tag({ tone, children, big }: { readonly tone: Tone; readonly children: ReactNode; readonly big?: boolean }) {
  return (
    <View style={[styles.tag, { backgroundColor: TONE_BG[tone] }]}>
      <Text style={[styles.tagText, big === true ? styles.tagTextBig : null, { color: TONE_TEXT[tone] }]}>{children}</Text>
    </View>
  )
}

export function Card({ children, label }: { readonly children: ReactNode; readonly label?: string }) {
  return (
    <View aria-label={label} role={label === undefined ? undefined : 'group'} style={styles.card}>
      {children}
    </View>
  )
}

export function Loading({ text }: { readonly text?: string }) {
  return (
    <View role="status" style={styles.loading}>
      <ActivityIndicator color={COLOR.primary} />
      <Text style={styles.body}>{text ?? '불러오는 중…'}</Text>
    </View>
  )
}

/** 큰 빨간 글 (듣기 멈춤 등) */
export function BigRed({ title, body }: { readonly title: string; readonly body: string }) {
  return (
    <View role="alert" style={styles.bigRed}>
      <Text style={styles.bigRedTitle}>{title}</Text>
      <Text style={styles.bigRedBody}>{body}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLOR.background },
  screenContent: { padding: GAP, gap: GAP, paddingBottom: 48 },
  title: { fontSize: FONT_BIG, fontWeight: '700', color: COLOR.text },
  sectionTitle: { fontSize: FONT_BIG - 2, fontWeight: '700', color: COLOR.text, marginTop: 4 },
  body: { fontSize: FONT, color: COLOR.text, lineHeight: FONT * 1.45 },
  muted: { color: COLOR.muted },
  bold: { fontWeight: '700' },
  big: { fontSize: FONT_BIG },
  hint: { fontSize: FONT_SMALL, color: COLOR.muted, lineHeight: FONT_SMALL * 1.4 },
  problem: { fontSize: FONT_SMALL, color: COLOR.danger, lineHeight: FONT_SMALL * 1.4 },
  button: { minHeight: TOUCH, minWidth: TOUCH, maxWidth: '100%', flexShrink: 1, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 10, borderWidth: 2, borderColor: COLOR.primary, backgroundColor: COLOR.background, alignItems: 'center', justifyContent: 'center' },
  buttonSmall: { minHeight: 44, minWidth: 44, paddingHorizontal: 12, paddingVertical: 8 },
  buttonPrimary: { backgroundColor: COLOR.primary },
  buttonDanger: { backgroundColor: COLOR.danger, borderColor: COLOR.danger },
  buttonDisabled: { opacity: 0.45 },
  buttonPressed: { opacity: 0.75 },
  buttonText: { fontSize: FONT, fontWeight: '700', color: COLOR.primary },
  buttonTextLight: { color: COLOR.primaryText },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  rowWrap: { flexWrap: 'wrap' },
  field: { gap: 6 },
  fieldLabel: { fontSize: FONT, fontWeight: '600', color: COLOR.text },
  input: { minHeight: TOUCH, fontSize: FONT_BIG, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 2, borderColor: COLOR.border, borderRadius: 10, color: COLOR.text, backgroundColor: COLOR.background },
  inputProblem: { borderColor: COLOR.danger },
  notice: { padding: 12, borderRadius: 10 },
  noticeText: { fontSize: FONT, lineHeight: FONT * 1.4 },
  tag: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, alignSelf: 'flex-start' },
  tagText: { fontSize: FONT_SMALL, fontWeight: '700' },
  tagTextBig: { fontSize: FONT },
  card: { padding: 12, borderRadius: 12, backgroundColor: COLOR.surface, gap: 8 },
  loading: { flexDirection: 'row', gap: 10, alignItems: 'center', padding: 12 },
  bigRed: { padding: 16, borderRadius: 12, backgroundColor: COLOR.dangerBg, borderWidth: 2, borderColor: COLOR.danger, gap: 6 },
  bigRedTitle: { fontSize: 26, fontWeight: '800', color: COLOR.danger },
  bigRedBody: { fontSize: FONT, color: COLOR.danger, lineHeight: FONT * 1.4 },
})
