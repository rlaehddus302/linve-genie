// 입력 조각: TextField(큰 라벨·도움말·오류), NumberPad(큰 숫자판).
import { useState } from 'react'
import { Pressable, TextInput, View, type TextInputProps } from 'react-native'
import { RADIUS, SPACE, TOUCH, TYPE } from './tokens.ts'
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

export function TextField({ label, help, error, unit, onFocus, onBlur, ...input }: TextFieldProps) {
  const { p, fontScale, forced } = useKit()
  const [focused, setFocused] = useState(false)
  const bad = error !== undefined && error !== null
  const size = forced ? TYPE.bodyLarge * fontScale : TYPE.bodyLarge
  return (
    <View style={{ gap: SPACE.sm }}>
      <Txt step="bodyLarge" weight="bold">
        {label}
      </Txt>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
        <TextInput
          {...input}
          aria-label={label}
          aria-invalid={bad}
          allowFontScaling={!forced}
          maxFontSizeMultiplier={2}
          placeholderTextColor={p.textSub}
          onFocus={(event) => {
            setFocused(true)
            onFocus?.(event)
          }}
          onBlur={(event) => {
            setFocused(false)
            onBlur?.(event)
          }}
          style={{ flex: 1, minHeight: TOUCH.button, fontSize: size, color: p.text, backgroundColor: p.surface, borderRadius: RADIUS.md, paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md, borderWidth: focused || bad ? 3 : 2, borderColor: bad ? p.dangerText : focused ? p.focus : p.borderStrong }}
        />
        {unit === undefined ? null : (
          <Txt step="bodyLarge" weight="medium">
            {unit}
          </Txt>
        )}
      </View>
      {help === undefined ? null : (
        <Txt step="caption" color="textSub">
          {help}
        </Txt>
      )}
      {bad ? (
        <Txt step="caption" weight="bold" color="dangerText" role="alert">
          {`⚠ ${error}`}
        </Txt>
      ) : null}
    </View>
  )
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
      style={({ pressed }) => ({ flex: 1, minHeight: TOUCH.key, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', backgroundColor: key === 'back' ? p.secondary : p.surfaceAlt, opacity: pressed ? 0.6 : 1 })}
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
      <Pressable role="button" aria-label="모두 지우기" onPress={() => press('clear')} style={{ minHeight: TOUCH.min, alignItems: 'center', justifyContent: 'center' }}>
        <Txt weight="bold" color="primaryText">
          모두 지우기
        </Txt>
      </Pressable>
    </View>
  )
}
