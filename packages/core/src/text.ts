// 글자 정규화 (R-3 정규화, R-19 비교 글자의 바탕). 파서(parse/)와 옵션 비교 글자(options.ts compareChars)가 같은 함수를 쓴다.
// 파서 모듈과 따로 둔다 — 화면이 비교 글자(막기만 하는 사전 검사, D-APP-23 ⓑ)만 쓸 때 파서 모듈을 끌어오지 않게(SRV1 AC-SRV1-13).
// 정규식은 모두 겹치는 반복이 없는 모양만 쓴다. 적대 입력에서도 길이에 비례하는 시간만 든다 (AC-S01-03).

// 공백 = JavaScript `\s`에서 U+FEFF를 뺀 것(탭·줄바꿈·NBSP·U+2028·U+3000 등).
// `\s`는 역사적 이유로 U+FEFF(폭 없는 비분리 공백, BOM)를 포함하지만, 이 글자는 유니코드 White_Space가 아니고(일반 분류 Cf)
// 화면에 보이지 않는다. 공백으로 바꾸면 화면의 "15"가 "1 5"(1번·5번)로, 가격 "1500"이 "1 500"으로 갈라진다(TD-S01-001).
const WHITESPACE_RUN = /[^\S\uFEFF]+/gu
const FULLWIDTH_DIGIT = /[\uFF10-\uFF19]/g
const FULLWIDTH_OFFSET = 0xff10 - 0x30

/**
 * R-3 정규화: 연속 공백(탭·줄바꿈·NBSP 등 유니코드 공백 포함) → 한 칸, 앞뒤 공백 제거, 전각 숫자 → 반각.
 * 제로폭 공백(U+200B)·방향 표시(U+200E)·U+FEFF 같은 보이지 않는 글자는 공백이 아니므로 어디에 있든 그대로 둔다(문법에 맞지 않게 된다).
 * 앞뒤 자르기도 같은 공백 집합만 쓴다. `String.prototype.trim`은 U+FEFF까지 지워서 쓰지 않는다.
 */
export function normalizeText(text: string): string {
  const collapsed = text.replace(WHITESPACE_RUN, ' ')
  const start = collapsed.startsWith(' ') ? 1 : 0
  const end = collapsed.endsWith(' ') ? collapsed.length - 1 : collapsed.length
  return collapsed.slice(start, end).replace(FULLWIDTH_DIGIT, (digit) => String.fromCharCode(digit.charCodeAt(0) - FULLWIDTH_OFFSET))
}
