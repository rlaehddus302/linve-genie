// 입력 조각: TextField(큰 라벨·도움말·오류), NumberPad(큰 숫자판).
import { useState } from 'react'
import { Pressable, TextInput, View, type TextInputProps } from 'react-native'
import { RADIUS, SPACE, TOUCH, TYPE, WEIGHT } from './tokens.ts'
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

export interface UnderlineFieldProps extends Omit<TextInputProps, 'style' | 'aria-label' | 'accessibilityLabel'> {
  readonly label: string
  /** 칸 아래 도움말 */
  readonly help?: string | null
  /** 잘못됐을 때 (밑줄·라벨 빨강 + 문장) */
  readonly error?: string | null
  /** 칸 오른쪽 단위 ("원") */
  readonly unit?: string
}

/**
 * 입력 칸 (토스 "계좌번호 입력" 그대로, D-UX3-07·08):
 * - 비어 있고 초점이 없으면(예시 글이 없는 칸) 라벨이 칸 안에 값과 같은 크기의 회색 글자로 보인다(위 작은 라벨 자리는 비워 둔다 — 높이가 바뀌지 않게).
 * - 누르거나 값이 있으면 라벨이 위에 작게(초점이면 초록, 아니면 회색), 값은 칸 안에 같은 크기로.
 * - 밑줄 하나(초점이면 초록, 잘못이면 빨강). 값이 있고 고칠 수 있으면 오른쪽에 동그란 [지우기] — 줄 높이 안에 겹쳐 놓아 높이를 바꾸지 않는다.
 */
export function UnderlineField({ label, help, error, unit, onFocus, onBlur, placeholder, ...input }: UnderlineFieldProps) {
  const { p, fontScale, forced } = useKit()
  const [focused, setFocused] = useState(false)
  const bad = error !== undefined && error !== null
  const value = typeof input.value === 'string' ? input.value : ''
  const empty = value === ''
  // 예시 글(placeholder)이 있는 칸은 라벨을 늘 위에 두고 칸 안에 예시를 보인다(예: 빠른 입력 "예: 15 핑크프릴 10")
  const resting = empty && !focused && (placeholder === undefined || placeholder === '')
  const size = forced ? TYPE.input * fontScale : TYPE.input
  const clearable = !empty && input.onChangeText !== undefined && input.editable !== false
  const accent = bad ? p.dangerText : focused ? p.primaryText : p.textSub
  return (
    <View style={{ gap: SPACE.xs }}>
      <View style={{ opacity: resting ? 0 : 1 }} aria-hidden={resting}>
        <Txt step="caption" ink={accent}>
          {label}
        </Txt>
      </View>
      <View style={{ height: FIELD_ROW * (forced ? fontScale : 1), flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, borderBottomWidth: 2, borderBottomColor: bad ? p.dangerText : focused ? p.primary : p.line }}>
        <TextInput
          {...input}
          aria-label={label}
          aria-invalid={bad}
          allowFontScaling={!forced}
          maxFontSizeMultiplier={2}
          placeholder={resting ? label : (placeholder ?? '')}
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
        ) : null}
      </View>
      {help === undefined || help === null ? null : (
        <Txt step="caption" color="textSub">
          {help}
        </Txt>
      )}
      {bad ? (
        <Txt step="caption" weight="bold" color="dangerText" role="alert">
          {error}
        </Txt>
      ) : null}
    </View>
  )
}

/** 입력 칸 오른쪽 동그란 지우기 (회색 원 + 흰 ×, 누르면 둘레가 진해진다) */
export function ClearButton({ label, onPress }: { readonly label: string; readonly onPress: () => void }) {
  const { p } = useKit()
  return (
    <Pressable role="button" aria-label={label} onPress={onPress} hitSlop={8} style={({ pressed }) => ({ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: pressed ? p.pressed : 'transparent' })}>
      <View aria-hidden style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: p.clearCircle, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', width: 11, height: 2, borderRadius: 1, backgroundColor: p.surface, transform: [{ rotate: '45deg' }] }} />
        <View style={{ position: 'absolute', width: 11, height: 2, borderRadius: 1, backgroundColor: p.surface, transform: [{ rotate: '-45deg' }] }} />
      </View>
    </Pressable>
  )
}

/** 큰 라벨 입력 칸 (옛 이름) — UnderlineField와 같은 모양 */
export function TextField({ error, ...rest }: TextFieldProps) {
  return <UnderlineField {...rest} error={error === null || error === undefined ? null : `⚠ ${error}`} />
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
      style={({ pressed }) => ({ flex: 1, minHeight: TOUCH.key, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', backgroundColor: key === 'back' ? (pressed ? p.secondaryPressed : p.secondary) : pressed ? p.softPressed : p.surfaceAlt })}
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
      <Pressable role="button" aria-label="모두 지우기" onPress={() => press('clear')} style={({ pressed }) => ({ backgroundColor: pressed ? p.pressed : 'transparent', borderRadius: RADIUS.md, minHeight: TOUCH.min, alignItems: 'center', justifyContent: 'center' })}>
        <Txt weight="bold" color="primaryText">
          모두 지우기
        </Txt>
      </Pressable>
    </View>
  )
}
