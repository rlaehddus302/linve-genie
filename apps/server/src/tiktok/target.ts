// 틱톡 아이디·방송 주소 해석 (PLT-02, D-N2b-1-02, AC-N2b-1-10·11, 골든 tests/golden/tiktok/target.json).
// 판매자가 넣은 한 줄 → 연결할 틱톡 아이디. 순수 함수다: 바깥에 묻지 않고(짧은 공유 주소도 열어 보지 않는다), 시계·난수를 쓰지 않는다.
// 중첩 반복이 있는 정규식을 쓰지 않는다 — 문자열 자르기와 글자 범위 검사 하나뿐이라 입력 길이에 비례해서만 걸린다.

/** 해석 실패 코드 */
export type TikTokTargetError = 'EMPTY' | 'INVALID' | 'SHORT_LINK'

/** 골든과 같은 모양: 성공 `{ uniqueId }`, 실패 `{ error }` — 정확히 한 키 */
export type TikTokTargetParse = { readonly uniqueId: string } | { readonly error: TikTokTargetError }

declare const TARGET_BRAND: unique symbol

/**
 * 해석에 성공한 연결 대상. 해석 함수(checkTikTokTarget)만 만든다 — 연결 객체는 이 형으로만 만든다(AC-N2b-1-11).
 * 실행 중에도 연결 객체를 만들 때 아이디를 다시 해석해 확인한다.
 */
export type TikTokTarget = { readonly uniqueId: string; readonly [TARGET_BRAND]: true }

/** 판매자에게 그대로 보이는 해석 실패 문장 (AC-N2b-1-11, UX-01·UX-03) */
export const TIKTOK_TARGET_MESSAGES: Readonly<Record<TikTokTargetError, string>> = Object.freeze({
  EMPTY: '틱톡 아이디를 넣어 주세요.',
  INVALID: '틱톡 아이디나 방송 주소가 아니에요. @로 시작하는 틱톡 아이디를 넣어 주세요.',
  SHORT_LINK: '짧은 공유 주소는 쓸 수 없어요. @로 시작하는 틱톡 아이디를 넣어 주세요.',
})

export type TikTokTargetCheck =
  | { readonly ok: true; readonly target: TikTokTarget }
  | { readonly ok: false; readonly error: TikTokTargetError; readonly message: string }

/** 이보다 긴 입력(UTF-16 단위)은 INVALID (D-N2b-1-02) */
export const TIKTOK_TARGET_INPUT_MAX = 2000

const SHORT_HOSTS: ReadonlySet<string> = new Set(['vm.tiktok.com', 'vt.tiktok.com'])
const TIKTOK_HOSTS: ReadonlySet<string> = new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com'])
const UNIQUE_ID_RE = /^[a-z0-9._]{2,24}$/

/** ASCII 대문자만 소문자로 바꾼다 (실행 환경 언어 설정·유니코드 대소문자 규칙과 상관없이 같은 결과) */
export function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 32))
}

/** 첫 번째로 나오는 끝 글자들의 위치 (없으면 길이) */
function firstOf(value: string, stops: string): number {
  for (let i = 0; i < value.length; i += 1) if (stops.includes(value.charAt(i))) return i
  return value.length
}

function checkUniqueId(candidate: string): TikTokTargetParse {
  const id = asciiLower(candidate)
  if (!UNIQUE_ID_RE.test(id) || id.endsWith('.')) return { error: 'INVALID' }
  return { uniqueId: id }
}

function parseAddress(text: string): TikTokTargetParse {
  const rest = text.replace(/^https?:\/\//i, '')
  const hostEnd = firstOf(rest, '/?#')
  const host = asciiLower(rest.slice(0, hostEnd))
  if (SHORT_HOSTS.has(host)) return { error: 'SHORT_LINK' }
  if (!TIKTOK_HOSTS.has(host)) return { error: 'INVALID' }
  const afterHost = rest.slice(hostEnd)
  const path = afterHost.slice(0, firstOf(afterHost, '?#'))
  if (path.startsWith('/t/')) return { error: 'SHORT_LINK' }
  if (!path.startsWith('/@')) return { error: 'INVALID' }
  const idPart = path.slice(2)
  return checkUniqueId(idPart.slice(0, firstOf(idPart, '/')))
}

/**
 * 한 줄 해석 (골든 모양). 규칙 D-N2b-1-02:
 * 앞뒤 공백을 지우고(JS trim) 비면 EMPTY. `/`가 있거나 `tiktok.com`(ASCII 대소문자 무시)이 들어 있으면 주소로 읽는다 — 앞의 http(s)://를 떼고
 * 호스트(첫 `/`·`?`·`#` 전까지, 소문자)가 짧은 공유 주소면 SHORT_LINK, 틱톡 호스트가 아니면 INVALID, 경로가 `/t/`로 시작하면 SHORT_LINK,
 * `/@아이디`(뒤에 `/…` 허용)가 아니면 INVALID. 주소가 아니면 맨 앞 `@` 하나를 뗀다. 아이디는 ASCII 소문자로 바꿔 `[a-z0-9._]` 2~24자, `.`로 끝나지 않는다.
 */
export function parseTikTokTarget(input: unknown): TikTokTargetParse {
  if (typeof input !== 'string' || input.length > TIKTOK_TARGET_INPUT_MAX) return { error: 'INVALID' }
  const text = input.trim()
  if (text === '') return { error: 'EMPTY' }
  if (text.includes('/') || asciiLower(text).includes('tiktok.com')) return parseAddress(text)
  return checkUniqueId(text.startsWith('@') ? text.slice(1) : text)
}

/** 해석하고, 실패면 판매자에게 보일 문장을 함께 돌려준다. 성공한 결과만 연결 대상(TikTokTarget)이 된다 */
export function checkTikTokTarget(input: unknown): TikTokTargetCheck {
  const parsed = parseTikTokTarget(input)
  if ('error' in parsed) return Object.freeze({ ok: false, error: parsed.error, message: TIKTOK_TARGET_MESSAGES[parsed.error] })
  const target = Object.freeze({ uniqueId: parsed.uniqueId }) as TikTokTarget
  return Object.freeze({ ok: true, target })
}

/** 연결 대상이 해석을 거친 아이디인지 실행 중에 확인한다 (형을 우회해 만든 값 막기) */
export function isTikTokTarget(value: unknown): value is TikTokTarget {
  if (typeof value !== 'object' || value === null) return false
  const uniqueId: unknown = (value as { uniqueId?: unknown }).uniqueId
  if (typeof uniqueId !== 'string') return false
  const parsed = parseTikTokTarget(uniqueId)
  return 'uniqueId' in parsed && parsed.uniqueId === uniqueId
}
