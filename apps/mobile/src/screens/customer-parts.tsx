// 고객 탭(손님·구매자) 화면이 같이 쓰는 조각 (D-UX3-95, 사용자 지시 2026-11-09 "대충 만든 느낌 — 홈처럼 토스식으로"):
// 흰 찾기 칸(돋보기·지우기), 글자만 있는 작은 단추, 이름 첫 글자 동그라미, 작은 꼬리표, 왼쪽 이름·오른쪽 값 줄, 흰 정보 카드, 글자 고르기(정렬).
// 공통 키트(src/ui/kit)는 다른 탭과 같이 쓰므로 건드리지 않고 이 탭에만 둔다.
import type { ReactNode } from 'react'
import { ActivityIndicator, TextInput, View, type TextInputProps } from 'react-native'
import Svg, { Circle, Path } from 'react-native-svg'
import { ClearButton, font, Icon, RADIUS, SPACE, TOUCH, TYPE, Txt, useKit, WEIGHT, type Tone, Tap } from '../ui/kit/index.ts'
import type { TxtColor } from '../ui/kit/theme.tsx'

/** 돋보기 (장식 — 칸 이름은 aria-label) */
function SearchGlyph({ color }: { readonly color: string }) {
  return (
    <View aria-hidden>
      <Svg width={20} height={20} viewBox="0 0 24 24">
        <Circle cx={10.5} cy={10.5} r={6.5} stroke={color} strokeWidth={2.2} fill="none" />
        <Path d="M15.5 15.5L20 20" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
      </Svg>
    </View>
  )
}

/** 흰 둥근 찾기 칸 (토스 찾기처럼): 돋보기 · 회색 안내 글 · 글이 있으면 동그란 지우기 */
export function SearchField({ label, value, onChangeText, placeholder, keyboardType, numberSearch }: { readonly label: string; readonly value: string; readonly onChangeText: (text: string) => void; readonly placeholder?: string; readonly keyboardType?: TextInputProps['keyboardType']; readonly numberSearch?: { open: () => void; submit: () => void } }) {
  const { p, fontScale, forced } = useKit()
  const size = TYPE.bodyLarge * (forced ? fontScale : 1)
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, minHeight: TOUCH.min + 2, paddingLeft: SPACE.lg, paddingRight: SPACE.xs, borderRadius: RADIUS.lg, borderCurve: 'continuous', backgroundColor: p.surface }}>
      <SearchGlyph color={p.placeholder} />
      <TextInput
        aria-label={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? label}
        placeholderTextColor={p.placeholder}
        autoCorrect={false}
        autoCapitalize="none"
        keyboardType={keyboardType}
        {...(numberSearch ? {
          inputMode: 'none' as const, showSoftInputOnFocus: false,
          onFocus: numberSearch.open, onPressIn: numberSearch.open, onSubmitEditing: numberSearch.submit,
        } : {})}
        returnKeyType="search"
        allowFontScaling={!forced}
        maxFontSizeMultiplier={2}
        style={{ flex: 1, minHeight: TOUCH.min, fontSize: size, ...font(WEIGHT.book), color: p.text, padding: 0 }}
      />
      {numberSearch ? <TextButton label="검색" onPress={numberSearch.submit} /> : value === '' ? null : <ClearButton label={`${label} 지우기`} onPress={() => onChangeText('')} />}
    </View>
  )
}

/** 글자만 있는 작은 단추 (곁일: "메모 저장"·"더 보기"·"떼어 내기") — 누르면 바탕만 옅게 */
export function TextButton({ label, onPress, ariaLabel, color = 'primaryText', disabled, busy, align }: { readonly label: string; readonly onPress: () => void; readonly ariaLabel?: string; readonly color?: TxtColor; readonly disabled?: boolean; readonly busy?: boolean; readonly align?: 'start' | 'end' | 'center' | 'stretch' }) {
  const { p } = useKit()
  const off = disabled === true || busy === true
  return (
    <Tap
      role="button"
      aria-label={ariaLabel ?? label}
      aria-disabled={off}
      aria-busy={busy === true}
      disabled={off}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        alignSelf: align === 'end' ? 'flex-end' : align === 'start' ? 'flex-start' : align === 'stretch' ? 'stretch' : 'center',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: SPACE.xs,
        minHeight: 40,
        paddingHorizontal: SPACE.md,
        borderRadius: RADIUS.md, borderCurve: 'continuous',
        backgroundColor: pressed && !off ? p.pressed : 'transparent',
        opacity: disabled === true ? 0.4 : 1,
      })}
    >
      {busy === true ? <ActivityIndicator size="small" color={p.textSub} /> : null}
      <Txt step="body" weight="medium" color={color}>
        {label}
      </Txt>
    </Tap>
  )
}

/** 이름 첫 글자 동그라미 (토스 연락처처럼, 장식) */
export function Initial({ name, size = 40 }: { readonly name: string; readonly size?: number }) {
  const { p } = useKit()
  const first = [...name.trim()][0] ?? '?'
  return (
    <View aria-hidden style={{ width: size, height: size, borderRadius: size / 2, borderCurve: 'continuous', backgroundColor: p.soft, alignItems: 'center', justifyContent: 'center' }}>
      <Txt step="bodyLarge" weight="medium" color="textSub">
        {first}
      </Txt>
    </View>
  )
}

/** 작은 꼬리표 ("단골"·"차단") — 글자가 뜻이고 색은 거든다. 옛 기호 붙은 큰 알약보다 낮고 작게 */
export function MiniTag({ tone, children }: { readonly tone: Tone; readonly children: string }) {
  const { tones } = useKit()
  const pair = tones[tone]
  return (
    <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, borderCurve: 'continuous', backgroundColor: pair.bg }}>
      <Txt step="caption" weight="medium" ink={pair.fg}>
        {children}
      </Txt>
    </View>
  )
}

/** 흰 정보 카드: 안 맨 위 회색 묶음 이름(홈 '오늘 할 일'처럼) + 줄들 */
export function InfoCard({ title, label, children }: { readonly title?: string; readonly label?: string; readonly children?: ReactNode }) {
  const { p } = useKit()
  const name = label ?? title
  return (
    <View role={name === undefined ? undefined : 'group'} aria-label={name} style={{ backgroundColor: p.surface, borderRadius: RADIUS.xl, borderCurve: 'continuous', paddingHorizontal: SPACE.xl, paddingTop: SPACE.lg + 2, paddingBottom: SPACE.lg, gap: SPACE.xs }}>
      {title === undefined ? null : (
        <View style={{ paddingBottom: SPACE.xs }}>
          <Txt step="body" weight="regular" color="textSub" role="heading" aria-level={2}>
            {title}
          </Txt>
        </View>
      )}
      {children}
    </View>
  )
}

/** 왼쪽 회색 이름 · 오른쪽 값 한 줄 (글자가 크면 값이 아래로). spoken: 한 문장으로 읽히는 이름(기본 "이름 값") */
export function InfoRow({ label, value, strong, spoken }: { readonly label: string; readonly value: string; readonly strong?: boolean; readonly spoken?: string }) {
  const { stacked } = useKit()
  return (
    <View aria-label={spoken ?? `${label} ${value}`} style={{ flexDirection: stacked ? 'column' : 'row', justifyContent: 'space-between', alignItems: stacked ? 'flex-start' : 'center', gap: stacked ? 2 : SPACE.lg, minHeight: 36, paddingVertical: SPACE.xs }}>
      <Txt step="bodyLarge" color="textSub">
        {label}
      </Txt>
      <View style={{ flexShrink: 1, alignItems: stacked ? 'flex-start' : 'flex-end' }}>
        <Txt step="bodyLarge" weight={strong === true ? 'bold' : 'book'}>
          {value}
        </Txt>
      </View>
    </View>
  )
}

/** 글자 고르기 (정렬 "누적 큰 순 · 최근 산 순"): 고른 것은 진한 굵은 글, 나머지는 회색 — 테두리 없이 */
export function TextChoices<K extends string>({ label, keys, value, word, spoken, onPick }: { readonly label: string; readonly keys: readonly K[]; readonly value: K; readonly word: (key: K) => string; readonly spoken: (key: K) => string; readonly onPick: (key: K) => void }) {
  const { p } = useKit()
  return (
    <View role="radiogroup" aria-label={label} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
      {keys.map((key) => {
        const on = key === value
        return (
          <Tap key={key} role="button" aria-label={spoken(key)} aria-selected={on} onPress={() => onPick(key)} hitSlop={4} style={({ pressed }) => ({ minHeight: 36, paddingHorizontal: SPACE.sm, borderRadius: RADIUS.md, borderCurve: 'continuous', justifyContent: 'center', backgroundColor: pressed ? p.pressed : 'transparent' })}>
            <Txt step="body" weight={on ? 'bold' : 'regular'} color={on ? 'text' : 'textSub'}>
              {word(key)}
            </Txt>
          </Tap>
        )
      })}
    </View>
  )
}

/** 켜고 끄는 글자 단추 (동그라미 체크 + 글, 토스 "약관 동의"처럼) */
export function CheckText({ label, on, onPress }: { readonly label: string; readonly on: boolean; readonly onPress: () => void }) {
  const { p } = useKit()
  return (
    <Tap role="button" aria-label={label} aria-selected={on} onPress={onPress} hitSlop={4} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, minHeight: 36, paddingHorizontal: SPACE.xs, borderRadius: RADIUS.md, borderCurve: 'continuous', backgroundColor: pressed ? p.pressed : 'transparent' })}>
      <View aria-hidden style={{ width: 20, height: 20, borderRadius: 10, borderCurve: 'continuous', backgroundColor: on ? p.primary : p.soft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="check" size={13} color={on ? p.onPrimary : p.placeholder} />
      </View>
      <Txt step="body" weight={on ? 'medium' : 'regular'} color={on ? 'text' : 'textSub'}>
        {label}
      </Txt>
    </Tap>
  )
}

/** 목록 줄 틀 (홈 '내 방송' 줄과 같은 여백·눌림) */
export function listRowStyle(p: { readonly pressed: string }, pressed: boolean) {
  return { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACE.md + 2, paddingVertical: SPACE.sm + 2, paddingHorizontal: SPACE.xl - SPACE.sm, marginHorizontal: SPACE.sm, borderRadius: RADIUS.lg, borderCurve: 'continuous' as const, minHeight: TOUCH.min, backgroundColor: pressed ? p.pressed : 'transparent' }
}

/** 카드 안 비었을 때 한 줄 (가운데, 회색) */
export function CardEmpty({ children }: { readonly children: string }) {
  return (
    <View style={{ paddingVertical: SPACE.xxl, paddingHorizontal: SPACE.xl }}>
      <Txt color="textSub" center>
        {children}
      </Txt>
    </View>
  )
}
