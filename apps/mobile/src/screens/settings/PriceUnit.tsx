// 가격을 말할 때 단위 (11월 12일 라이브 복기 6.4 "305번 — '자 요거 35'가 35,000원으로", 개선 계획표 A6, D-RETRO-84):
// 판매자가 가격을 단위 없이 말할 때("삼십오") 그 숫자를 만 원·천 원·원 가운데 무엇으로 읽을지 고른다. 화면 일꾼(자동 등록)도 같은 값을 쓴다.
// 설정 키는 판매 규칙의 price.unit 하나 — 가게 설정의 저장 단추로 다른 칸과 같이 저장한다(PATCH /api/settings).
// 언제 적용되나: 서버는 라이브를 만들 때의 설정을 그 라이브에 적어 두고 그것으로 읽는다(화면 일꾼에게도 그 값을 준다) — 그래서 다음에 시작하는 라이브부터다.
// 앱의 상품 추가·수정은 늘 "원"을 붙여 보내므로 이 설정과 상관없다.
import { View } from 'react-native'
import type { PriceUnit } from '@livejjim/core/settings'
import { Pill } from '../../ui/day-pills.tsx'
import { SPACE } from '../../ui/kit/tokens.ts'
import { Notice } from '../../ui/parts.tsx'
import { FieldLabel, GroupNote } from './Group.tsx'

export const PRICE_UNIT_LABEL = '가격을 말할 때 단위'

/** 고르는 순서: 다육이 라이브에서 가장 흔한 만 원이 앞. 낱말과 그 단위로 읽은 예 */
export const PRICE_UNIT_CHOICES: readonly { readonly value: PriceUnit; readonly word: string; readonly example: string }[] = [
  { value: 'TEN_THOUSAND', word: '만 원', example: "'삼십오'라고 하면 350,000원" },
  { value: 'THOUSAND', word: '천 원', example: "'삼십오'라고 하면 35,000원" },
  { value: 'WON', word: '원 그대로', example: "숫자를 원으로 그대로 읽어요. '삼만 오천'처럼 끝까지 말해 주세요" },
  { value: 'AUTO', word: '자동', example: "숫자 크기로 정해요. '삼십오'는 350,000원, '백팔십'은 180,000원" },
]

/** 단위까지 말하면 설정과 상관없다 */
export const PRICE_UNIT_SPOKEN = "'삼만 오천 원'처럼 단위까지 말하면 이 설정과 상관없이 말한 대로 들어가요."
/** 언제 적용되나 — 라이브는 시작할 때의 설정을 끝까지 쓴다 */
export const PRICE_UNIT_WHEN = '다음에 시작하는 라이브부터 적용돼요. 지금 하는 라이브는 그대로예요.'

export const priceUnitExample = (value: unknown): string | null => PRICE_UNIT_CHOICES.find((choice) => choice.value === value)?.example ?? null

/** value: 고른 값(저장 전 포함). problem: 서버가 거절한 문장 */
export function PriceUnitField({ value, problem, onChange }: { readonly value: string | boolean | undefined; readonly problem: string | null; readonly onChange: (value: string) => void }) {
  const example = priceUnitExample(value)
  return (
    <View style={{ gap: SPACE.xs }} role="radiogroup" aria-label={PRICE_UNIT_LABEL}>
      <FieldLabel>{PRICE_UNIT_LABEL}</FieldLabel>
      {/* 고르기 알약은 한 줄에 좌우로 (좁으면 다음 줄로 넘어간다) */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.xs }}>
        {PRICE_UNIT_CHOICES.map((choice) => (
          <Pill key={choice.value} on={value === choice.value} label={choice.word} ariaLabel={`${PRICE_UNIT_LABEL} ${choice.word}`} onPress={() => onChange(choice.value)} />
        ))}
      </View>
      {example !== null ? <GroupNote>{example}</GroupNote> : null}
      <GroupNote>{PRICE_UNIT_SPOKEN}</GroupNote>
      <GroupNote>{PRICE_UNIT_WHEN}</GroupNote>
      {problem !== null ? <Notice tone="danger" alert>{problem}</Notice> : null}
    </View>
  )
}
