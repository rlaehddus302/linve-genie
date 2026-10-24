// 구글 승인 화면으로 가기 (AC-I3-02·05·11·54). 서버가 준 승인 주소로 같은 탭에서 최상위 이동한다(새 창·팝업·iframe 없음).
// 승인 주소는 저장하지 않고 기록(콘솔)에 남기지 않는다. 서버는 늘 `/settings/youtube?youtube=<결과>`로 돌려보내므로,
// 시작 마법사 3단계에서 떠났을 때만 "마법사로 돌아가기" 표시 하나(주소가 아니다)를 이 탭의 sessionStorage에 남긴다.
const KEY = 'livejjim.googleReturn'

export type GoogleReturn = 'wizard'

type Assign = (url: string) => void
let assign: Assign = (url) => window.location.assign(url)

/** 최상위 이동을 바꾼다 (화면 단위 시험 — jsdom은 다른 주소로 이동하지 못한다). null이면 기본 */
export function setTopLevelNavigation(fn: Assign | null): void {
  assign = fn ?? ((url) => window.location.assign(url))
}

/** 승인 주소로 최상위 이동 (from = 돌아온 뒤 갈 화면) */
export function goToGoogle(authorizeUrl: string, from: GoogleReturn | null = null): void {
  try {
    if (from === null) window.sessionStorage.removeItem(KEY)
    else window.sessionStorage.setItem(KEY, from)
  } catch {
    // 저장소를 쓸 수 없으면 설정 화면으로 돌아온다 (결과 문장은 그대로 보인다)
  }
  assign(authorizeUrl)
}

/** 돌아온 뒤 갈 화면 (한 번 읽으면 지운다) */
export function takeGoogleReturn(): GoogleReturn | null {
  try {
    const value = window.sessionStorage.getItem(KEY)
    window.sessionStorage.removeItem(KEY)
    return value === 'wizard' ? 'wizard' : null
  } catch {
    return null
  }
}

/** 다른 공급자(간편 로그인 — 카카오·네이버·구글, L1)의 승인 주소로 같은 탭에서 최상위 이동. 돌아온 뒤 갈 화면 표시는 건드리지 않는다 */
export function goTopLevel(url: string): void {
  assign(url)
}

/** 이동을 시작했는데 이 시간 안에 페이지가 떠나지 않으면 막힌 것으로 본다 (FB1 D-FB1-08 (3)) */
export const LEAVE_STUCK_MS = 5_000

/**
 * 같은 탭 최상위 이동 + 지켜보기 (간편 로그인, FB1 D-FB1-08 (3)): LEAVE_STUCK_MS 안에 페이지가 떠나지 않으면(pagehide 없음 —
 * 브라우저 확인에서 머무름·이동이 막힘) onStuck을 부른다. 그 전에 떠나면 아무 일도 없다. 돌려준 함수로 그만 지켜본다
 */
export function goTopLevelWatched(url: string, onStuck: () => void, stuckMs: number = LEAVE_STUCK_MS): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    window.removeEventListener('pagehide', stop)
  }
  window.addEventListener('pagehide', stop)
  timer = setTimeout(() => {
    stop()
    onStuck()
  }, stuckMs)
  assign(url)
  return stop
}
