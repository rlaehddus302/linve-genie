// 입력 조각: TextField(큰 라벨·도움말·오류), NumberPad(큰 숫자판).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Animated, Easing, Platform, Pressable, Text, TextInput, View, type TextInputProps } from 'react-native'
import { LINE, RADIUS, SPACE, TOUCH, TYPE, WEIGHT } from './tokens.ts'
import { Txt, useKit } from './theme.tsx'

export interface TextFieldProps extends Omit<TextInputProps, 'style' | 'aria-label' | 'accessibilityLabel'> {
  /** 칸 위의 큰 라벨 — 무엇을 적는지 */
  readonly label: string
  /** 칸 아래 도움말 (예시·쓰임) */
  readonly help?: string
  /** 잘못됐을 때의 안내. 있으면 빨간 테두리 + ⚠ 글 */
  readonly error?: string | null
  /** 칸 오른쪽에 붙는 단위 ("원", "개") */
  readonly unit?: string
}

/** 입력 칸 한 줄 높이 (값 줄) — 비었을 때·넣었을 때·초점일 때 모두 같다 (D-UX3-08) */
export const FIELD_ROW = 52
/** 라벨이 칸 안 ↔ 위로 움직이는 시간 (D-UX3-11) */
export const FIELD_LABEL_MS = 180

export interface UnderlineFieldProps extends Omit<TextInputProps, 'style' | 'aria-label' | 'accessibilityLabel'> {
  readonly label: string
  /** 칸 아래 도움말 */
  readonly help?: string | null
  /** 잘못됐을 때 (밑줄·라벨 빨강 + 느낌표와 문장) */
  readonly error?: string | null
  /** 칸 오른쪽 단위 ("원") */
  readonly unit?: string
  /** 칸이 비었을 때 오른쪽에 붙는 조각 ([붙여넣기] 등) — 값이 있으면 [지우기]가 그 자리 */
  readonly trailing?: ReactNode
}

/**
 * 입력 칸 (토스 "계좌번호 입력" 그대로, D-UX3-07·08·11):
 * - 비어 있고 초점이 없으면 라벨이 칸 안에 값과 같은 크기의 회색 글자로 보이고, 누르거나 값이 있으면 위로 작게 부드럽게 올라간다(초점이면 초록).
 *   라벨은 글자 하나가 움직이고 커졌다 작아질 뿐 — 위 라벨 자리와 값 줄(52)은 늘 그대로라 칸 높이가 바뀌지 않는다.
 * - 예시 글(placeholder)이 있는 칸은 라벨을 늘 위에 두고 칸 안에 예시를 보인다(예: 빠른 입력 "예: 15 핑크프릴 10").
 * - 밑줄 하나(초점이면 초록, 잘못이면 빨강). 값이 있고 고칠 수 있으면 오른쪽에 동그란 [지우기] — 줄 안에 겹쳐 놓는다.
 */
export function UnderlineField({ label, help, error, unit, trailing, onFocus, onBlur, placeholder, ...input }: UnderlineFieldProps) {
  const { p, fontScale, forced } = useKit()
  const [focused, setFocused] = useState(false)
  const bad = error !== undefined && error !== null
  const value = typeof input.value === 'string' ? input.value : ''
  const empty = value === ''
  const example = placeholder !== undefined && placeholder !== ''
  const resting = empty && !focused && !example
  const scale = forced ? fontScale : 1
  const size = TYPE.input * scale
  const small = TYPE.caption * scale
  const slot = Math.round(small * LINE)
  const row = FIELD_ROW * scale
  const gap = SPACE.xs
  // 칸 안 자리: 위 라벨 자리 + 사이 + 값 줄 가운데
  const insideY = slot + gap + (row - Math.round(size * LINE)) / 2
  const motion = useRef(new Animated.Value(resting ? 0 : 1)).current
  useEffect(() => {
    Animated.timing(motion, { toValue: resting ? 0 : 1, duration: FIELD_LABEL_MS, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start()
  }, [resting, motion])
  const clearable = !empty && input.onChangeText !== undefined && input.editable !== false
  const accent = bad ? p.dangerText : focused ? p.primaryText : resting ? p.placeholder : p.textSub
  return (
    <View style={{ gap: SPACE.xs }}>
      <View style={{ gap }}>
        <View style={{ height: slot }} />
        <View style={{ height: row, flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, borderBottomWidth: 2, borderBottomColor: bad ? p.dangerText : focused ? p.primary : p.line }}>
          <TextInput
            {...input}
            aria-label={label}
            aria-invalid={bad}
            allowFontScaling={!forced}
            maxFontSizeMultiplier={2}
            placeholder={example && !empty ? '' : (placeholder ?? '')}
            placeholderTextColor={p.placeholder}
            onFocus={(event) => {
              setFocused(true)
              onFocus?.(event)
            }}
            onBlur={(event) => {
              setFocused(false)
              onBlur?.(event)
            }}
            style={{ flex: 1, height: '100%', fontSize: size, fontWeight: WEIGHT.medium, color: p.text, padding: 0, paddingRight: clearable ? 40 : 0 }}
          />
          {unit === undefined ? null : (
            <Txt step="bodyLarge" weight="medium" color="textSub">
              {unit}
            </Txt>
          )}
          {clearable ? (
            <View style={{ position: 'absolute', right: unit === undefined ? 0 : 40, top: 0, bottom: 0, justifyContent: 'center' }}>
              <ClearButton label={`${label} 지우기`} onPress={() => input.onChangeText?.('')} />
            </View>
          ) : empty && trailing !== undefined && trailing !== null ? (
            trailing
          ) : null}
        </View>
        {/* 움직이는 라벨 (보조 기술에는 칸 이름으로 읽힌다 — 글자는 숨김) */}
        <Animated.View
          aria-hidden
          pointerEvents="none"
          testID={resting ? 'field-label-resting' : 'field-label-floating'}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            transformOrigin: 'left top',
            transform: [{ translateY: motion.interpolate({ inputRange: [0, 1], outputRange: [insideY, 0] }) }, { scale: motion.interpolate({ inputRange: [0, 1], outputRange: [1, small / size] }) }],
          }}
        >
          <Text allowFontScaling={false} numberOfLines={1} style={{ fontSize: size, lineHeight: Math.round(size * LINE), fontWeight: resting ? WEIGHT.medium : WEIGHT.regular, color: accent }}>
            {label}
          </Text>
        </Animated.View>
      </View>
      {help === undefined || help === null ? null : (
        <Txt step="caption" color="textSub">
          {help}
        </Txt>
      )}
      {bad ? <ErrorLine>{error}</ErrorLine> : null}
    </View>
  )
}

/** 잘못일 때 한 줄: 빨간 동그라미 느낌표 + 짧은 문장 (D-UX3-11) */
export function ErrorLine({ children }: { readonly children: ReactNode }) {
  return (
    <View role="alert" style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.xs }}>
      <AlertMark />
      <View style={{ flex: 1 }}>
        <Txt step="caption" weight="bold" color="dangerText">
          {children}
        </Txt>
      </View>
    </View>
  )
}

/** 느낌표 동그라미 (장식 — 뜻은 옆 문장) */
export function AlertMark({ color, size = 16 }: { readonly color?: string; readonly size?: number }) {
  const { p } = useKit()
  return (
    <View aria-hidden style={{ width: size, height: size, borderRadius: size / 2, borderCurve: 'continuous', backgroundColor: color ?? p.dangerText, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: Math.max(2, size / 8), height: size * 0.36, borderRadius: 1, borderCurve: 'continuous', backgroundColor: p.surface, marginBottom: size * 0.08 }} />
      <View style={{ width: Math.max(2, size / 8), height: Math.max(2, size / 8), borderRadius: 1, borderCurve: 'continuous', backgroundColor: p.surface }} />
    </View>
  )
}

/** 입력 칸 오른쪽 동그란 지우기 (회색 원 + 흰 ×, 누르면 둘레가 진해진다) */
export function ClearButton({ label, onPress }: { readonly label: string; readonly onPress: () => void }) {
  const { p } = useKit()
  return (
    <Pressable role="button" aria-label={label} onPress={onPress} hitSlop={8} style={({ pressed }) => ({ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
      <View aria-hidden style={{ width: 22, height: 22, borderRadius: 11, borderCurve: 'continuous', backgroundColor: p.clearCircle, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', width: 11, height: 2, borderRadius: 1, borderCurve: 'continuous', backgroundColor: p.surface, transform: [{ rotate: '45deg' }] }} />
        <View style={{ position: 'absolute', width: 11, height: 2, borderRadius: 1, borderCurve: 'continuous', backgroundColor: p.surface, transform: [{ rotate: '-45deg' }] }} />
      </View>
    </Pressable>
  )
}

/** 큰 라벨 입력 칸 (옛 이름) — UnderlineField와 같은 모양 */
export function TextField({ error, ...rest }: TextFieldProps) {
  return <UnderlineField {...rest} error={error ?? null} />
}

export type PadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '00' | 'back' | 'clear'

/** 숫자판 키를 눌렀을 때의 새 값 (글자 문자열). 앞의 0은 지우고, 길이는 maxLength까지. */
export function applyPadKey(value: string, key: PadKey, maxLength: number): string {
  if (key === 'clear') return ''
  if (key === 'back') return value.slice(0, -1)
  const next = value + key
  const trimmed = next.replace(/^0+(?=\d)/, '')
  if (trimmed === '0' && key === '00') return '0'
  return trimmed.length > maxLength ? value : trimmed
}

const PAD_ROWS: readonly (readonly PadKey[])[] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['00', '0', 'back'],
]

const KEY_NAME: Readonly<Record<PadKey, string>> = { '0': '0', '1': '1', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9', '00': '00', back: '지우기', clear: '모두 지우기' }

/** 큰 숫자판(키 64): 한 손으로 눌러도 안 헷갈리게 키 사이 8 이상. 값은 글자 문자열로 주고받는다. */
export function NumberPad({ value, onChange, maxLength = 9, testID }: { readonly value: string; readonly onChange: (next: string) => void; readonly maxLength?: number; readonly testID?: string }) {
  const { p } = useKit()
  const press = (key: PadKey) => onChange(applyPadKey(value, key, maxLength))
  const keyButton = (key: PadKey) => (
    <Pressable
      key={key}
      role="button"
      aria-label={KEY_NAME[key]}
      onPress={() => press(key)}
      style={({ pressed }) => ({ flex: 1, minHeight: TOUCH.key, borderRadius: RADIUS.md, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: key === 'back' ? (pressed ? p.secondaryPressed : p.secondary) : pressed ? p.softPressed : p.surfaceAlt })}
    >
      <Txt step="title" weight="bold" color={key === 'back' ? 'onSecondary' : 'text'}>
        {key === 'back' ? '← 지우기' : key}
      </Txt>
    </Pressable>
  )
  return (
    <View testID={testID} role="group" aria-label="숫자판" style={{ gap: TOUCH.gap }}>
      {PAD_ROWS.map((row) => (
        <View key={row.join('')} style={{ flexDirection: 'row', gap: TOUCH.gap }}>
          {row.map(keyButton)}
        </View>
      ))}
      <Pressable role="button" aria-label="모두 지우기" onPress={() => press('clear')} style={({ pressed }) => ({ backgroundColor: pressed ? p.pressed : 'transparent', borderRadius: RADIUS.md, borderCurve: 'continuous', minHeight: TOUCH.min, alignItems: 'center', justifyContent: 'center' })}>
        <Txt weight="bold" color="primaryText">
          모두 지우기
        </Txt>
      </Pressable>
    </View>
  )
}
