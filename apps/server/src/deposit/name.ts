// 입금자명·후보 이름 정규화 (DEPOSIT_RULES DP-3, D-N3-02, 골든 tests/golden/deposit/name.json — AC-N3-01).
// 맞추기(DP-5)·붙여넣기 줄 키(DP-1)·쌍둥이·이름 후보 비교·기억한 입금자명 저장이 모두 이 함수 하나를 쓴다.
// 순수 함수: 시계·실행 환경의 언어 설정(toLocaleLowerCase 등)을 쓰지 않는다.

/** 보이지 않는 글자: 폭 없는 공백·이음 글자·단어 이음·BOM */
const INVISIBLE = /\u200B|\u200C|\u200D|\u2060|\uFEFF/g
/** 공백 (JavaScript \s — 탭·줄바꿈·전각 공백 포함) */
const SPACE = /\s/g
const UPPER = /[A-Z]/g

/**
 * 1. 유니코드 NFKC(전각 영문·숫자 → 반각, 풀어 쓴 한글 자모 → 완성형) 2. 공백·보이지 않는 글자를 모두 지운다 3. 영문을 소문자로.
 * 문장 부호·괄호·숫자는 그대로 둔다. 결과가 빈 글이면 이름이 없는 것이다(어느 이름과도 같지 않다 — 비교하는 쪽이 빈 글을 뺀다)
 */
export function normalizeDepositName(text: string): string {
  return text
    .normalize('NFKC')
    .replace(SPACE, '')
    .replace(INVISIBLE, '')
    .replace(UPPER, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32))
}
