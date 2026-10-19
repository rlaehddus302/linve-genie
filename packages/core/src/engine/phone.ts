// 휴대폰 번호 정규화 (R-11 "문자찜 구매자 정하기", D-051). 서버·화면·골든 러너가 같은 함수를 쓴다(AC-S03-01·11).

const FULLWIDTH_ZERO = 0xff10
const FULLWIDTH_NINE = 0xff19
const ZERO = 0x30
const NINE = 0x39
const MOBILE_RE = /^01\d{8,9}$/

/**
 * 숫자만 남겨(전각 숫자는 반각으로, 그 밖의 글자·공백·`-`·`+`·괄호는 지운다) `01`로 시작하는 10~11자리면 그 숫자열, 아니면 null.
 * `5678`처럼 일부만, `+82 10-…`처럼 국가 번호로 시작하면 null — 번호 일부만 같은 다른 사람이 한 구매자로 묶이지 않게(D-051).
 * 결과에 다시 넣으면 같은 값이 나온다(멱등).
 */
export function normalizePhone(phone: string): string | null {
  if (typeof phone !== 'string') return null
  let digits = ''
  for (const char of phone) {
    const code = char.codePointAt(0) as number
    if (code >= ZERO && code <= NINE) digits += char
    else if (code >= FULLWIDTH_ZERO && code <= FULLWIDTH_NINE) digits += String.fromCharCode(code - FULLWIDTH_ZERO + ZERO)
    // 그 밖의 글자는 모두 지운다 (공백·하이픈·+·괄호·글자)
  }
  return MOBILE_RE.test(digits) ? digits : null
}

/** 조회 결과에 보이는 뒤 4자리 (ORD-08 AC4) */
export function phoneLast4(phone: string): string {
  return phone.slice(-4)
}
