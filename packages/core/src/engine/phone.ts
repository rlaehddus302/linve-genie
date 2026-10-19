// 휴대폰 번호 정규화 (R-11 "문자찜 구매자 정하기", D-051)와 판매자가 적는 칸의 휴대폰 번호 판단
// (R-1 "판매자가 적는 칸의 휴대폰 번호", D-079·D-080). 서버·화면·골든 러너가 같은 함수를 쓴다(AC-S03-01·11, AC-S03b-01, AC-S04-07·91).
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
 * 전화번호 칸(R-11)과 ID 칸 판단(looksLikePhoneId)에만 쓴다 — 글 전체에 적용해 번호를 찾지 않는다(D-079 ①).
 */
export function normalizePhone(phone: string): string | null {
  if (typeof phone !== 'string') return null
  let digits = ''
  for (const char of phone) {
    const digit = digitOf(char)
    if (digit !== null) digits += digit
    // 그 밖의 글자는 모두 지운다 (공백·하이픈·+·괄호·글자)
  }
  return MOBILE_RE.test(digits) ? digits : null
}

/** 반각·전각 숫자면 반각 숫자 한 글자, 아니면 null */
function digitOf(char: string): string | null {
  const code = char.codePointAt(0) as number
  if (code >= ZERO && code <= NINE) return char
  if (code >= FULLWIDTH_ZERO && code <= FULLWIDTH_NINE) return String.fromCharCode(code - FULLWIDTH_ZERO + ZERO)
  return null
}

/**
 * 줄·점 대신 치는 한글 자모 — 글자(\p{L})지만 구분자로 본다 (R-1, D-080):
 * `ㅡ`(호환 U+3161·조합형 U+1173·반각 U+FFDA), `ㅣ`(U+3163·U+1175·반각 U+FFDC), `ㆍ`(U+318D·조합형 U+119E)
 */
const JAMO_SEPARATORS: ReadonlySet<number> = new Set([0x3161, 0x1173, 0xffda, 0x3163, 0x1175, 0xffdc, 0x318d, 0x119e])
/** 배열을 끊는 글자: 글자(한글 음절·영문 등)와 반각·전각 숫자가 아닌 숫자 문자(`①`·`²`·`٠` 등) */
const LETTER_OR_NUMBER_RE = /^[\p{L}\p{N}]$/u

/**
 * 구분자인지 (R-1 "판매자가 적는 칸의 휴대폰 번호", D-080 ②): 글자·숫자가 아닌 모든 글자(공백·줄바꿈·문장 부호·기호·이모지·
 * 보이지 않는 글자·결합 부호) + 위 자모. 반각·전각 숫자는 구분자가 아니다(숫자 덩어리) — 부르는 쪽이 먼저 digitOf로 거른다.
 */
function isSeparator(char: string): boolean {
  return JAMO_SEPARATORS.has(char.codePointAt(0) as number) || !LETTER_OR_NUMBER_RE.test(char)
}

/** (가) 덩어리 하나가 휴대폰 번호 전체: `01X`(X = 0·1·6·7·8·9)로 시작하는 10~11자리 (D-079 ②) */
const WHOLE_RUN_RE = /^01[016789]\d{7,8}$/
/** (나) 번호 배열의 시작 덩어리: 정확히 `01X` 세 자리 */
const HEAD_RUN_RE = /^01[016789]$/
/** (나) `01X` 뒤에 이어 붙인 덩어리들의 자릿수 (정확히 7이나 8) */
const TAIL_MIN = 7
const TAIL_MAX = 8

/**
 * 글 안의 숫자 배열들: 숫자 덩어리(이어 적은 숫자, 전각은 반각)를 구분자만 사이에 두고 이은 것.
 * 글자·다른 숫자 문자가 끼면 배열이 끊긴다. 덩어리가 없는 배열은 넣지 않는다.
 */
function digitArrays(text: string): string[][] {
  const arrays: string[][] = []
  let array: string[] = []
  let run = ''
  const closeRun = (): void => {
    if (run !== '') array.push(run)
    run = ''
  }
  for (const char of text) {
    const digit = digitOf(char)
    if (digit !== null) {
      run += digit
      continue
    }
    closeRun()
    if (isSeparator(char)) continue
    if (array.length > 0) arrays.push(array)
    array = []
  }
  closeRun()
  if (array.length > 0) arrays.push(array)
  return arrays
}

/** 이어진 덩어리 배열에 휴대폰 번호가 있는지 — (가) 또는 (나). 덩어리 일부만 떼어 보지 않는다 */
function arrayHasPhone(runs: readonly string[]): boolean {
  for (let start = 0; start < runs.length; start++) {
    const head = runs[start] as string
    if (WHOLE_RUN_RE.test(head)) return true
    if (!HEAD_RUN_RE.test(head)) continue
    let tail = 0
    for (let next = start + 1; next < runs.length && tail < TAIL_MAX; next++) {
      tail += (runs[next] as string).length
      if (tail >= TAIL_MIN && tail <= TAIL_MAX) return true
    }
  }
  return false
}

/**
 * 판매자가 적는 글 칸에 휴대폰 번호가 들어 있는지 (R-1 "판매자가 적는 칸의 휴대폰 번호" 글 칸, D-079 ②·③, D-080, DAT-06).
 * 글 칸: `sms`의 `ref`·`memo`, 입금 메모, 모든 사유, 방송 제목, 상품 이름 (validate.ts — 기록 전 검사 checkEvent에서만).
 * - 숫자 덩어리 사이에 구분자만 있으면 이어진 배열이다(구분자 = 글자·숫자가 아닌 모든 글자 + 자모 `ㅡ`·`ㅣ`·`ㆍ`).
 * - (가) 덩어리 하나가 `01X`로 시작하는 10~11자리 전체이거나, (나) `01X` 세 자리 덩어리 바로 뒤의 덩어리들을 차례로 붙여
 *   정확히 7자리나 8자리가 되는 곳이 있으면 참: `010-1234-5678`, `3시,010,1234,5678`, `010 12345678`, `+82 010-1234-5678`, `s01012345678`.
 * - 거짓: `01/05 구피 30종 1000원`(시작 덩어리가 `01X` 세 자리가 아니다), `1234-5678`(`010`을 뺀 8자리), `010123456789`(12자리 한 덩어리),
 *   `+82 10-1234-5678`(국가 번호 표기), `3시 15번 2개`, `101동 1203호`.
 * 글의 숫자를 전부 모아 번호 모양을 보는 판단(normalizePhone을 글 전체에)은 쓰지 않는다(D-079 ①).
 */
export function containsPhoneRun(text: string): boolean {
  if (typeof text !== 'string') return false
  return digitArrays(text).some(arrayHasPhone)
}

/**
 * 판매자가 적는 ID 칸의 값이 휴대폰 번호인지 (R-1 "판매자가 적는 칸의 휴대폰 번호" ID 칸, D-079 ④, D-080).
 * ID 칸: `buyer`(`host.*`·`sms`·`settlement.*`), `buyer.merge`의 `from`·`into`, `buyer.unmerge`의 `from`, `host.assign`의 `replace`,
 * `host.convertMessage`의 `msg` (validate.ts — 기록 전 검사 checkEvent에서만).
 * 값 전체가 숫자(반각·전각)와 구분자(containsPhoneRun과 같다)뿐이고 normalizePhone의 결과가 있으면 참:
 * `010-5151-6161`, `01051516162`, `010 5151 6163`, `(010)5151-6164`.
 * 글자가 하나라도 섞인 ID(`UC_A`, `sms:s1`, `UC01012345678abcdEFGH_-`)는 늘 거짓 — 불투명 ID는 절대 걸리지 않는다.
 */
export function looksLikePhoneId(value: string): boolean {
  if (typeof value !== 'string') return false
  for (const char of value) {
    if (digitOf(char) === null && !isSeparator(char)) return false
  }
  return normalizePhone(value) !== null
}

/**
 * @deprecated containsPhoneRun과 같은 함수다(AC-S04-07 — 다른 판단이 둘 있으면 안 된다). 새 코드는 containsPhoneRun을 쓴다.
 * S04 수정 라운드 2까지의 숫자 모으기 판단은 D-079 ①로 없앴다.
 */
export const containsPhoneNumber: (text: string) => boolean = containsPhoneRun

/** 정규화한 번호(normalizePhone의 결과)의 뒤 4자리 — 서버가 sms 이벤트의 phoneLast4로 담는다 (ORD-08 AC4, D-061) */
export function phoneLast4(normalized: string): string {
  return normalized.slice(-4)
}
