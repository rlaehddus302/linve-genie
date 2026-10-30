// 기기에서 먼저 거르기 (SPEC ORD-13 C-03, D-SMS3-11) — 서버가 C-04 응답으로 주는 filters를 저장해 두고 그대로 거른다.
// - skipWords: 이 낱말이 든 **문자**(channel SMS)는 보내지 않는다. 비교는 본문과 낱말을 영문 대소문자 무시(ASCII A-Z만 소문자로)로
//   바꾼 뒤 "들어 있나"(R-26 3과 같은 비교). 앱 알림(APP)에는 쓰지 않는다.
// - bankApps: 앱 알림은 이 목록의 앱 것만 읽고 보낸다(그 밖 앱 알림 — 메신저 등 — 은 내용을 열지도 보내지도 않는다).
// - 목록을 받기 전에는 문자만 보낸다. 그때 거를 낱말은 R-26 3 목록의 기기 사본(DEFAULT_SKIP_WORDS)을 쓴다.
// 세 플랫폼(TS 가짜·Kotlin·Swift)이 같게 거른다 — 공용 사례(test-vectors)가 잠근다.

/** 서버가 주는 거르기 목록 (C-04 응답 filters) */
export interface NoticeFilters {
  readonly skipWords: readonly string[]
  readonly bankApps: readonly string[]
}

/** 목록을 받기 전 쓰는 거를 낱말 — DOMAIN_RULES R-26 3과 같은 목록 */
export const DEFAULT_SKIP_WORDS: readonly string[] = Object.freeze(['(광고)', '[광고]', 'web발신', '국제발신', '해외발신', '인증', '승인', '결제', '택배'])

/** 목록 상한 (서버가 틀린 것을 줘도 기기가 버티게) */
export const SKIP_WORDS_MAX = 200
export const SKIP_WORD_MAX_CHARS = 100
export const BANK_APPS_MAX = 100
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
  const { skipWords, bankApps } = v
  if (!Array.isArray(skipWords) || skipWords.length > SKIP_WORDS_MAX) return null
  if (!Array.isArray(bankApps) || bankApps.length > BANK_APPS_MAX) return null
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
  return { skipWords: words, bankApps: apps }
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
  return JSON.stringify({ skipWords: [...filters.skipWords], bankApps: [...filters.bankApps] })
}
