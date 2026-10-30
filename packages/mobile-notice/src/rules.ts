// 기기에서 먼저 거르기 (SPEC ORD-13 C-03, D-SMS3-11·D-SMS3-26) — 서버가 C-04 응답으로 주는 filters를 저장해 두고 그대로 거른다.
// - skipWords: 이 낱말이 든 **문자**(channel SMS)는 보내지 않는다. 비교는 본문과 낱말을 영문 대소문자 무시(ASCII A-Z만 소문자로)로
//   바꾼 뒤 "들어 있나"(R-26 3과 같은 비교). 앱 알림(APP)에는 쓰지 않는다.
// - bankNumbers: 보낸 곳이 은행 대표번호인 문자는 skipWords를 보지 않고 보낸다(`[Web발신]`·`승인`·`결제`가 든 은행 입금·출금 문자 —
//   잔액 이어짐이 끊기지 않게, D-SMS3-26). 판정은 DP-9 1 문자 검사와 같다: 앞뒤 빈칸을 뺀 보낸 곳이 ASCII 숫자·`-`·빈칸만이고
//   숫자만 남긴 글이 목록에 있음(`+82`·괄호·글자·전각 숫자가 섞이면 대표번호 아님).
// - bankApps: 앱 알림은 이 목록의 앱 것만 읽고 보낸다(그 밖 앱 알림 — 메신저 등 — 은 내용을 열지도 보내지도 않는다).
// - 목록을 받기 전에는 문자만 보낸다. 그때 거를 낱말은 R-26 3 목록의 기기 사본(DEFAULT_SKIP_WORDS), 대표번호는 DP-9 1 표의
//   기기 사본(DEFAULT_BANK_NUMBERS)을 쓴다. 서버가 bankNumbers 칸 없이 filters를 주면(옛 서버) 대표번호는 기기 사본을 쓴다.
// 세 플랫폼(TS 가짜·Kotlin·Swift)이 같게 거른다 — 공용 사례(test-vectors)가 잠근다.

/** 서버가 주는 거르기 목록 (C-04 응답 filters) */
export interface NoticeFilters {
  readonly skipWords: readonly string[]
  readonly bankApps: readonly string[]
  /** 은행 대표번호(숫자만) — 이 번호에서 온 문자는 skipWords로 거르지 않는다 */
  readonly bankNumbers: readonly string[]
}

/** 목록을 받기 전 쓰는 거를 낱말 — DOMAIN_RULES R-26 3과 같은 목록 */
export const DEFAULT_SKIP_WORDS: readonly string[] = Object.freeze(['(광고)', '[광고]', 'web발신', '국제발신', '해외발신', '인증', '승인', '결제', '택배'])

/** 목록을 받기 전 쓰는 은행 대표번호 — DEPOSIT_RULES DP-9 1 표의 16개(숫자만)와 같은 목록 */
export const DEFAULT_BANK_NUMBERS: readonly string[] = Object.freeze([
  '15889999', '16449999', '15999999', // KB국민
  '15778000', '15998000', // 신한
  '15885000', '15995000', // 우리
  '15881111', '15991111', // 하나
  '16613000', '15882100', // NH농협
  '15662566', '15882588', // IBK기업
  '15993333', // 카카오뱅크
  '16617654', // 토스뱅크
  '15221000', // 케이뱅크
])

/** 목록 상한 (서버가 틀린 것을 줘도 기기가 버티게) */
export const SKIP_WORDS_MAX = 200
export const SKIP_WORD_MAX_CHARS = 100
export const BANK_APPS_MAX = 100
export const BANK_NUMBERS_MAX = 100
/** 대표번호 한 개: ASCII 숫자 3~20자 */
export const BANK_NUMBER_PATTERN = /^[0-9]{3,20}$/
/** 안드로이드 패키지 이름 모양 (점으로 나뉜 두 마디 이상, 각 마디는 영문자로 시작) */
export const PACKAGE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/

/** 영문 대문자(A-Z)만 소문자로 — 세 플랫폼이 같게(로캘·유니코드 규칙 없이) */
export function lowerAscii(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    out += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : text[i]
  }
  return out
}

/** 서버가 준 filters 검사 — 모양이 하나라도 틀리면 null(전에 저장한 목록을 그대로 쓴다) */
export function parseNoticeFilters(value: unknown): NoticeFilters | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  const { skipWords, bankApps, bankNumbers } = v
  if (!Array.isArray(skipWords) || skipWords.length > SKIP_WORDS_MAX) return null
  if (!Array.isArray(bankApps) || bankApps.length > BANK_APPS_MAX) return null
  // bankNumbers 칸이 없으면(옛 서버) 기기 사본 — 은행 문자를 거르지 않는 쪽. 칸이 있는데 틀리면 전체를 버린다
  if (bankNumbers !== undefined && (!Array.isArray(bankNumbers) || bankNumbers.length > BANK_NUMBERS_MAX)) return null
  const words: string[] = []
  for (const word of skipWords) {
    if (typeof word !== 'string' || word.length === 0 || word.length > SKIP_WORD_MAX_CHARS) return null
    if (!words.includes(word)) words.push(word)
  }
  const apps: string[] = []
  for (const app of bankApps) {
    if (typeof app !== 'string' || app.length > 150 || !PACKAGE_NAME_PATTERN.test(app)) return null
    if (!apps.includes(app)) apps.push(app)
  }
  const numbers: string[] = []
  for (const number of bankNumbers ?? DEFAULT_BANK_NUMBERS) {
    if (typeof number !== 'string' || !BANK_NUMBER_PATTERN.test(number)) return null
    if (!numbers.includes(number)) numbers.push(number)
  }
  return { skipWords: words, bankApps: apps, bankNumbers: numbers }
}

/** 앞뒤 빈칸 (JS trim과 같은 집합 — 세 플랫폼의 clean과 같다) */
const EDGE_SPACE = /^\s+|\s+$/g

/**
 * 보낸 곳이 은행 대표번호인가 (DP-9 1 문자 검사와 같은 방법, D-SMS3-26): 앞뒤 빈칸을 뺀 글이 ASCII 숫자·`-`·빈칸(U+0020)만이고
 * 숫자만 남긴 글이 목록(filters.bankNumbers, 없으면 기기 사본)에 있음
 */
export function isBankNumber(from: string | null, filters: NoticeFilters | null): boolean {
  if (from === null) return false
  const trimmed = from.replace(EDGE_SPACE, '')
  if (!/^[0-9\- ]+$/.test(trimmed)) return false
  const digits = trimmed.replace(/[^0-9]/g, '')
  return digits !== '' && (filters?.bankNumbers ?? DEFAULT_BANK_NUMBERS).includes(digits)
}

/**
 * 이 알림을 거를 낱말 (보내면 null) — 문자(SMS)이고 보낸 곳이 은행 대표번호가 아닐 때만 skipWords를 본다.
 * 앱 알림(APP)은 bankApps로 이미 골랐으므로 거르지 않는다.
 */
export function skipWordFor(message: { readonly channel: string; readonly from: string | null; readonly text: string }, filters: NoticeFilters | null): string | null {
  if (message.channel !== 'SMS') return null
  if (isBankNumber(message.from, filters)) return null
  return skipWordIn(message.text, filters)
}

/** 문자 본문에 든 거를 낱말 (없으면 null). filters가 없으면 R-26 3 사본 */
export function skipWordIn(text: string, filters: NoticeFilters | null): string | null {
  const haystack = lowerAscii(text)
  for (const word of filters?.skipWords ?? DEFAULT_SKIP_WORDS) {
    const needle = lowerAscii(word)
    if (needle.length > 0 && haystack.includes(needle)) return word
  }
  return null
}

/** 저장 글 (네이티브와 같은 모양) */
export function serializeNoticeFilters(filters: NoticeFilters): string {
  return JSON.stringify({ skipWords: [...filters.skipWords], bankApps: [...filters.bankApps], bankNumbers: [...filters.bankNumbers] })
}
