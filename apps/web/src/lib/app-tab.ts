// 앱에서 연 탭 (PAY2, BILLING_RULES BL-11 3, D-PAY-04): 휴대폰 앱이 기기 브라우저로 연 주소에는 검색값 `from=app`이 붙는다.
// 값이 정확히 `app`인 주소로 열린 탭은 그 탭이 닫힐 때까지(브라우저의 탭 저장소 sessionStorage) "앱에서 연 탭"이다 —
// 새로 고침·화면 이동·로그인·로그아웃·간편 로그인 다녀오기에도 남고, 다른 탭·새 창에는 번지지 않는다. 끄는 방법은 없다.
// 이 탭에서는 요금 메뉴·알림 띠·"요금 화면 열기"·"요금 안내" 링크가 없고, 요금 화면·요금 안내 주소는 `/`로 바꿔 간다(숨김은 화면뿐 — 서버 규칙은 그대로).
// 이 파일은 휴대폰 앱도 불러 쓴다(APP_NO_PASS_MESSAGE·앱 주소 붙이기) — 요금 화면 주소 글자를 넣지 않는다(BL-INV-9 번들 검사).

/** 이용권이 없을 때 앱·앱에서 연 탭의 문장 (BL-11 2 — 화면 문장 상수 하나) */
export const APP_NO_PASS_MESSAGE = '이용권이 없어 실제 방송을 시작할 수 없어요. 리허설은 언제든 할 수 있어요.'

/** 앱이 여는 주소에 붙이는 검색값 (`from=app`) */
export const FROM_APP_PARAM = 'from'
export const FROM_APP_VALUE = 'app'

const STORAGE_KEY = 'livejjim.fromApp'

type TabStorage = Pick<Storage, 'getItem' | 'setItem'>

function tabStorage(): TabStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

/** 탭 저장소를 쓸 수 없을 때(사생활 모드 일부 등) 이 문서가 살아 있는 동안만 기억한다 */
let memory = false

/** 처음 연 주소의 검색값을 보고 앱에서 연 탭이면 기억한다. 지금 앱에서 연 탭인지 돌려준다 */
export function rememberAppTab(search: string, storage: TabStorage | null = tabStorage()): boolean {
  if (new URLSearchParams(search).get(FROM_APP_PARAM) === FROM_APP_VALUE) {
    memory = true
    try {
      storage?.setItem(STORAGE_KEY, '1')
    } catch {
      // 저장하지 못해도 이 문서 안에서는 기억한다
    }
  }
  return isAppTab(storage)
}

/** 이 탭이 앱에서 연 탭인가 */
export function isAppTab(storage: TabStorage | null = tabStorage()): boolean {
  if (memory) return true
  try {
    return storage?.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** 시험용: 문서 안 기억을 지운다 (탭 저장소는 시험이 따로 비운다) */
export function resetAppTabMemory(): void {
  memory = false
}

/**
 * 앱이 기기 브라우저로 여는 라이브지니 주소에 `from=app`을 붙인다 (BL-11 3.1). 이미 검색값이 있으면 뒤에 더하고(`#` 앞),
 * 이미 `from=app`이면 그대로다. `origin`(라이브지니 서버 주소)과 출처가 다른 주소는 그대로 둔다.
 */
export function withFromApp(url: string, origin: string): string {
  let target: URL
  let base: URL
  try {
    base = new URL(origin)
    target = new URL(url, base)
  } catch {
    return url
  }
  if (target.origin !== base.origin) return url
  if (target.searchParams.get(FROM_APP_PARAM) === FROM_APP_VALUE) return url
  const hashAt = url.indexOf('#')
  const head = hashAt < 0 ? url : url.slice(0, hashAt)
  const hash = hashAt < 0 ? '' : url.slice(hashAt)
  const joiner = head.includes('?') ? (head.endsWith('?') || head.endsWith('&') ? '' : '&') : '?'
  return `${head}${joiner}${FROM_APP_PARAM}=${FROM_APP_VALUE}${hash}`
}
