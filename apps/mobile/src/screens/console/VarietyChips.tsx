// 품종 후보 단추 한 줄(D-VARIETY-01)과 개수 칸(D-PIECES-01) — 상품 수정창·상품 추가·확인 카드가 같이 쓴다.
// - 후보 단추: 가로 한 줄, 넘치면 가로로 민다(절대 규칙 8 — 위아래로 쌓지 않는다). 누르면 품종 칸이 그 이름으로 바뀐다(저장은 그 화면의 저장 단추).
//   고른 이름은 진하게 보인다. 키보드가 떠 있어도 한 번에 눌린다(keyboardShouldPersistTaps).
// - 개수 칸: 왼쪽 [−] · 가운데 "n개" · 오른쪽 [+]. 1~99, 1은 "1개(묶음 아님)" — 1이면 상품 줄에는 개수가 보이지 않는다. 금액과 상관없다(가격은 묶음 하나의 값).
// 이름은 글자로만 그린다.
import { ScrollView, View } from 'react-native'
import { Tap, Txt, useKit } from '../../ui/kit/index.ts'
import { GUTTER, RADIUS, SPACE } from '../../ui/kit/tokens.ts'

export const VARIETY_ROW = '품종 고르기'
export const PIECES_LABEL = '개수'
export const PIECES_LESS = '개수 줄이기'
export const PIECES_MORE = '개수 늘리기'
export const PIECES_MIN = 1
export const PIECES_MAX = 99
/** 개수 칸 아래 한 줄 설명 */
export const PIECES_NOTE = '한 번호에 여러 개를 묶어 팔 때만 바꿔요. 가격은 묶음 하나의 값이에요.'
export const piecesWords = (pieces: number): string => `${String(pieces)}개`

/** 품종 후보 단추 한 줄. selected: 지금 칸에 들어 있는 이름(진하게). inset: 양옆 여백(화면 가장자리까지 밀리게 음수 여백으로 상쇄) */
export function VarietyChips({ choices, selected, disabled = false, inset = GUTTER, onPick }: { readonly choices: readonly string[]; readonly selected?: string; readonly disabled?: boolean; readonly inset?: number; readonly onPick: (name: string) => void }) {
  const { p } = useKit()
  if (choices.length === 0) return null
  const chosen = selected?.trim() ?? ''
  return (
    <ScrollView
      horizontal
      role="group"
      aria-label={VARIETY_ROW}
      testID="variety-chips"
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={{ marginHorizontal: -inset, flexGrow: 0 }}
      contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm, paddingHorizontal: inset, paddingVertical: SPACE.xs }}
    >
      {choices.map((name) => {
        const on = name === chosen
        return (
          <Tap
            key={name}
            role="button"
            aria-label={name}
            aria-selected={on}
            disabled={disabled}
            hitSlop={4}
            onPress={() => onPick(name)}
            style={({ pressed }) => ({ minHeight: 40, paddingHorizontal: SPACE.md, borderRadius: RADIUS.pill, borderCurve: 'continuous', borderWidth: 1.5, borderColor: on ? p.primary : 'transparent', alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? p.pressed : p.surfaceAlt, opacity: disabled ? 0.45 : 1 })}
          >
            <Txt step="body" weight={on ? 'bold' : 'book'} ink={on ? p.primaryText : p.tabInk} numberOfLines={1}>
              {name}
            </Txt>
          </Tap>
        )
      })}
    </ScrollView>
  )
}

/** 개수 칸: [−] n개 [+] 한 줄 (1~99) */
export function PiecesStepper({ pieces, disabled = false, onChange }: { readonly pieces: number; readonly disabled?: boolean; readonly onChange: (pieces: number) => void }) {
  const { p } = useKit()
  const step = (label: string, sign: string, next: number, off: boolean) => (
    <Tap
      role="button"
      aria-label={label}
      aria-disabled={off}
      disabled={off}
      hitSlop={6}
      onPress={() => onChange(next)}
      style={({ pressed }) => ({ width: 44, height: 40, borderRadius: RADIUS.md, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: pressed && !off ? p.pressed : p.surfaceAlt, opacity: off ? 0.4 : 1 })}
    >
      <Txt step="lead" weight="bold" color="textSub">
        {sign}
      </Txt>
    </Tap>
  )
  return (
    <View role="group" aria-label={PIECES_LABEL} testID="pieces-stepper" style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
      <Txt step="body" weight="bold" color="textSub">
        {PIECES_LABEL}
      </Txt>
      <View style={{ flex: 1 }} />
      {step(PIECES_LESS, '−', Math.max(PIECES_MIN, pieces - 1), disabled || pieces <= PIECES_MIN)}
      <View style={{ minWidth: 48, alignItems: 'center' }}>
        <Txt step="lead" weight="bold" center testID="pieces-value">
          {piecesWords(pieces)}
        </Txt>
      </View>
      {step(PIECES_MORE, '+', Math.min(PIECES_MAX, pieces + 1), disabled || pieces >= PIECES_MAX)}
    </View>
  )
}
