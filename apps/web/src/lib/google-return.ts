// 구글 승인 화면으로 가기 (AC-I3-02·05·11·54). 서버가 준 승인 주소로 같은 탭에서 최상위 이동한다(새 창·팝업·iframe 없음).
// 승인 주소는 저장하지 않고 기록(콘솔)에 남기지 않는다. 서버는 늘 `/settings/youtube?youtube=<결과>`로 돌려보내므로,
// 시작 마법사 4단계에서 떠났을 때만 "마법사로 돌아가기" 표시 하나(주소가 아니다)를 이 탭의 sessionStorage에 남긴다.
const KEY = 'livejjim.googleReturn'

export type GoogleReturn = 'wizard'

/** 승인 주소로 최상위 이동 (from = 돌아온 뒤 갈 화면) */
export function goToGoogle(authorizeUrl: string, from: GoogleReturn | null = null): void {
  try {
    if (from === null) window.sessionStorage.removeItem(KEY)
    else window.sessionStorage.setItem(KEY, from)
  } catch {
    // 저장소를 쓸 수 없으면 설정 화면으로 돌아온다 (결과 문장은 그대로 보인다)
  }
  window.location.assign(authorizeUrl)
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
