// 휴대폰 번호 정규화 (R-11 "문자찜 구매자 정하기", D-051). 서버·화면·골든 러너가 같은 함수를 쓴다(AC-S03-01·11, AC-S03b-01).
// 판정 엔진은 전화번호 원문을 받지 않는다(D-061). 서버가 받은 번호를 이 함수로 정규화하고, 결과가 있으면
//   phoneKey = 판매자마다 고정한 비밀 키의 HMAC(정규화한 번호) — 영문·숫자·`_`·`-` 16~128자(예: HMAC-SHA256 base64url 43자)
//   phoneLast4 = phoneLast4(정규화한 번호)
// 를 sms 이벤트에 담는다. 결과가 null이면 둘 다 담지 않는다(전화번호 없음과 같다). HMAC은 비밀 키가 필요해 코어(순수 함수) 밖, 서버가 한다.

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

/** 정규화한 번호(normalizePhone의 결과)의 뒤 4자리 — 서버가 sms 이벤트의 phoneLast4로 담는다 (ORD-08 AC4, D-061) */
export function phoneLast4(normalized: string): string {
  return normalized.slice(-4)
}
