// 휴대폰 번호 정규화 (R-11 "문자찜 구매자 정하기", D-051)와 글 안의 휴대폰 번호 찾기(R-1 입력 오류, D-073). 서버·화면·골든 러너가 같은 함수를 쓴다(AC-S03-01·11, AC-S03b-01, AC-S04-07).
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

/**
 * 글 안에서 휴대폰 번호로 볼 숫자열: `01`로 시작하는 10~11자리, 또는 국가 번호로 적은 휴대폰 번호
 * (`82 10-…`·`82 010-…`, 앞에 국제 전화 `00`이 붙어도). 국가 번호 형태는 구매자를 잇는 데엔 쓰지 않지만(normalizePhone은 null)
 * 평문으로 남으면 같은 개인정보다.
 */
const MOBILE_IN_TEXT_RE = /^(?:01\d{8,9}|(?:00)?820?1\d{8,9})$/
/** 가장 긴 후보: 00 + 82 + 0 + 1 + 9자리 = 15자리 */
const MAX_CANDIDATE_DIGITS = 15
/**
 * 숫자 덩어리 사이에 이 글자만 있으면 이어 적은 숫자로 본다(구분자):
 * - 공백(전각 포함)·보이지 않는 글자(서식 문자)
 * - 하이픈·대시·빼기(`-`·`‐`~`―`·`−`·`﹘`·`﹣`·`－`)와 하이픈 대신 치는 가로줄: 한글 자모 `ㅡ`(U+3161·U+1173·반각 U+FFDA),
 *   장음 기호 `ー`(U+30FC·반각 U+FF70), 괘선 `─`·`━`(U+2500·U+2501)
 * - 물결 `~`·`～`·`〜`·`∼`, 별표 `*`·`＊`
 * - 점·가운뎃점(`.`·`·`·`․`·`・`·`．`·`･`), 괄호(`()`·`（）`·`[]`·`［］`), 빗금(`/`·`／`), 밑줄(`_`·`＿`), `+`·`＋`
 * 그 밖의 글자(한글 음절·영문·`:`·`,` 등)가 끼면 다른 숫자다 — `:`·`,`로 나눈 번호는 아래 번호 배열(PHONE_LAYOUT_RE)로 잡는다.
 */
const JOINER_CLASS =
  '\\s\\p{Cf}\\-\\u2010-\\u2015\\u2212\\uFE58\\uFE63\\uFF0D\\u3161\\u1173\\uFFDA\\u30FC\\uFF70\\u2500\\u2501~\\uFF5E\\u301C\\u223C*\\uFF0A.\\u00B7\\u2024\\u30FB\\uFF0E\\uFF65()\\uFF08\\uFF09\\[\\]\\uFF3B\\uFF3D/\\uFF0F_\\uFF3F+\\uFF0B'
const JOINER_RE = new RegExp(`[${JOINER_CLASS}]`, 'u')
/**
 * 번호 배열: `01X`·3~4자리·4자리를 숫자·글자가 아닌 1~3글자(`,`·`:`·`;`·`#`·`=` 등 기호, 위 구분자)로 나눠 적은 것 — 앞뒤에 숫자가 바로 붙지 않으면.
 * 예: `3시,010,1234,5678`, `010:1234:5678 3시`. 수량·금액·번호 나열(`1,2,3번`·`10,000원`)은 이 배열이 아니라 번호로 보지 않는다.
 * 숫자는 전각을 반각으로 바꾼 뒤 본다.
 */
const LAYOUT_SEP = `(?:[^\\p{L}\\p{N}]|[${JOINER_CLASS}]){1,3}`
const PHONE_LAYOUT_RE = new RegExp(`(?<![0-9])01[0-9]${LAYOUT_SEP}[0-9]{3,4}${LAYOUT_SEP}[0-9]{4}(?![0-9])`, 'u')

/** 전각 숫자를 반각으로 (그 밖의 글자는 그대로) */
function halfwidthDigits(text: string): string {
  return text.replace(/[\uFF10-\uFF19]/g, (char) => String.fromCharCode((char.codePointAt(0) as number) - FULLWIDTH_ZERO + ZERO))
}

/**
 * 글 안에 휴대폰 번호가 들어 있는지 (R-1 입력 오류, DAT-06, D-073 — 평문 번호가 이벤트 로그·엔진 상태·표시 이름에 남지 않게).
 * 판매자가 손으로 적는 글 칸에 쓴다: 문자찜 메모·ref, 입금 메모, 사유, 방송 제목, 상품 이름 (validate.ts).
 * - 숫자만 모은 것이 휴대폰 번호 모양(normalizePhone의 결과가 있음)이면 true — R-1 문장 그대로.
 * - 또한 글 안의 숫자 덩어리 중 구분자(JOINER_CLASS)만 사이에 두고 이어 적은 몇 덩어리를 모은 것이 휴대폰 번호(MOBILE_IN_TEXT_RE)면 true.
 *   번호 앞뒤에 다른 숫자가 있어도 잡는다: `3시 010-1234-5678`, `010-1234-5678 2개`, `15번 01012345678`, `+82 10-1234-5678`, `3시 010ㅡ1234ㅡ5678`.
 * - 또한 번호 배열(PHONE_LAYOUT_RE)이 있으면 true: `3시,010,1234,5678`, `010:1234:5678 3시`.
 * - 주소·시각·수량·번호 일부는 false: `3시 15번 2개`, `101동 1203호`, `뒷번호 5678`, `r-20261018-0001`, `1,2,3번 각 1개`.
 * 덩어리 경계에서만 자른다 — 한 덩어리 안의 일부(`010123456789`의 앞 11자리)는 번호로 보지 않는다.
 */
export function containsPhoneNumber(text: string): boolean {
  if (typeof text !== 'string') return false
  if (normalizePhone(text) !== null) return true
  if (PHONE_LAYOUT_RE.test(halfwidthDigits(text))) return true
  let chain: string[] = []
  let run = ''
  for (const char of text) {
    const code = char.codePointAt(0) as number
    if (code >= ZERO && code <= NINE) {
      run += char
      continue
    }
    if (code >= FULLWIDTH_ZERO && code <= FULLWIDTH_NINE) {
      run += String.fromCharCode(code - FULLWIDTH_ZERO + ZERO)
      continue
    }
    if (run !== '') chain.push(run)
    run = ''
    if (JOINER_RE.test(char)) continue
    if (chainHasPhone(chain)) return true
    chain = []
  }
  if (run !== '') chain.push(run)
  return chainHasPhone(chain)
}

/** 이어 적은 숫자 덩어리들 중 연속한 몇 덩어리를 모은 것이 휴대폰 번호인지 */
function chainHasPhone(chain: readonly string[]): boolean {
  for (let start = 0; start < chain.length; start++) {
    let digits = ''
    for (let end = start; end < chain.length; end++) {
      digits += chain[end] as string
      if (digits.length > MAX_CANDIDATE_DIGITS) break
      if (MOBILE_IN_TEXT_RE.test(digits)) return true
    }
  }
  return false
}

/** 정규화한 번호(normalizePhone의 결과)의 뒤 4자리 — 서버가 sms 이벤트의 phoneLast4로 담는다 (ORD-08 AC4, D-061) */
export function phoneLast4(normalized: string): string {
  return normalized.slice(-4)
}
