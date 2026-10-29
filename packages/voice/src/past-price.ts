// 지난 일로 말한 가격 (실방송 금화다육 468번): "제가 팔색조 세금을 자 120만 원까지 팔아 본 적 있어요" — 지금 상품 값이 아니라 경험담이다.
// 원 가격 줄 바로 뒤(붙은 조사·군말 건너)에 지난 일·경험을 말하는 꼴이 오면 그 가격은 번호에 붙이지도, 있는 가격을 고치지도 않는다.
// 판매자에게 안전한 쪽(잘못 바꾸지 않는 쪽): 경험담 꼴이 보이면 그 줄을 가격으로 쓰지 않는다.
// 순수 함수: 어떤 입력에도 예외를 던지지 않는다.

/** 가격 바로 뒤에 오면 지난 일·경험을 말하는 꼴 (공백을 뺀 글의 앞부분) */
export const PAST_PRICE_TAILS: readonly string[] = Object.freeze([
  '팔아본적',
  '팔아봤',
  '팔아보았',
  '팔았',
  '팔렸었',
  '팔려봤',
  '팔려본적',
  '받아본적',
  '받아봤',
  '받아보았',
  '받았었',
  '본적있',
  '본적이있',
  '본적도있',
  '봤었',
  '했었',
  '갔었',
  '나갔었',
])

/** 가격과 경험담 꼴 사이에 와도 되는 말 (붙은 조사·군말) — 앞에서부터 떼고 본다 */
const LEAD_WORDS: readonly string[] = Object.freeze(['까지도', '까지', '에도', '에', '도', '정도에', '정도', '쯤', '씩', '짜리', '이나', '자', '저는', '제가', '저도', '진짜', '정말', '예전에', '옛날에', '전에'])

/** 경험담 꼴을 기다릴 만한 붙은 조사 (중간 결과 끝에서만 — "120만 원까지 | 팔") */
const WAIT_PARTICLES: readonly string[] = Object.freeze(['까지', '까지도', '에', '에도'])

/** 가격 뒤에서 볼 토큰 수 (군말을 뗀 뒤) */
const LOOK_TOKENS = 4

function stripLead(text: string): string {
  let rest = text
  for (let guard = 0; guard < 8; guard++) {
    const lead = LEAD_WORDS.find((word) => rest.startsWith(word))
    if (lead === undefined) break
    rest = rest.slice(lead.length)
  }
  return rest
}

/**
 * 원 가격 줄이 지난 일로 말한 가격인가: 줄 끝 토큰(`원`·`원까지`·`원에`…)의 `원` 뒤 붙은 글과 그 뒤 토큰을 이어(공백 없이, 앞 군말·조사는 떼고)
 * 경험담 꼴(`팔아 본 적`·`팔아 봤`·`팔았`·`받아 본 적`·`본 적 있`·`했었`…)로 시작하면 참.
 * final 거짓(중간 결과)이면 가격에 `까지`·`에`가 붙었고 글 끝까지가 경험담 꼴의 앞부분(`팔`·`팔아`·`팔아 본`·없음)일 때도 참 — 다음 낱말을 기다린다.
 */
export function isPastPriceLine(tokens: readonly string[], end: number, final = true): boolean {
  try {
    const token = tokens[end]
    if (typeof token !== 'string') return false
    const at = token.lastIndexOf('원')
    if (at < 0) return false
    const attached = token.slice(at + 1)
    const after = tokens.slice(end + 1)
    // 앞 군말·조사 토큰은 건너고, 그 뒤 LOOK_TOKENS 토큰을 붙여 본다
    let k = 0
    while (k < after.length && stripLead(after[k] as string) === '') k++
    const looked = after.slice(k, k + LOOK_TOKENS)
    const text = stripLead(attached + after.slice(0, k).join('') + looked.join(''))
    if (PAST_PRICE_TAILS.some((tail) => text.startsWith(tail))) return true
    if (final) return false
    // 중간 결과: 붙은 조사(까지·에)가 있고 글 끝까지가 경험담 꼴의 앞부분이면 아직 모른다 — 가격으로 쓰지 않고 기다린다
    const particle = WAIT_PARTICLES.some((word) => attached === word || after[0] === word || attached.startsWith(word))
    if (!particle || k + LOOK_TOKENS < after.length) return false
    return text === '' || PAST_PRICE_TAILS.some((tail) => tail.startsWith(text))
  } catch {
    return false
  }
}
