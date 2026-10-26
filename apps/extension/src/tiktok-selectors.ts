// 가짜 페이지 기준 — 실물 확인 필요(HG-TTX).
// 틱톡 웹 라이브 화면의 모양 (TTX PLT-02 확장 대비책, D-TTX-02·04·11). 틱톡 화면의 선택자·요소 데이터 이름은 이 파일 하나에만 둔다.
// 실제 틱톡 웹 화면 구조는 확인하지 못했다 — 아래 이름은 우리가 만든 가짜 틱톡 라이브 페이지(test/fixtures/tiktok-live.html)의 것이고,
// 실제 구조를 지어내지 않는다. 실물에서 다르면 이 파일만 고친다(값을 읽을 수 없으면 새 결정 — D-TTX-04).

/** 읽는 사이트 (www만 — m.tiktok.com·휴대폰은 범위 밖) */
export const TIKTOK_HOST = 'www.tiktok.com'
/** 틱톡 content script가 들어가는 곳 (D-TTX-02: 한 화면 앱이라 전체에 넣고, 주소가 내 방송일 때만 관찰한다) */
export const TIKTOK_MATCH = 'https://www.tiktok.com/*'
/** 라이브 방송 주소 경로: /@<아이디>/live (뒤에 / · ?… · #… 가 붙어도 됨) */
export const TIKTOK_LIVE_PATH = /^\/@([^/?#]+)\/live\/?$/

/** 댓글 목록 (관찰은 문서 전체에서 한다 — 목록이 통째로 다시 그려져도 놓치지 않게. 가짜 페이지·시험이 쓴다) */
export const TT_COMMENT_LIST = '.tt-comment-list'
/** 일반 댓글 요소 — 이것만 읽는다 */
export const TT_COMMENT = '.tt-comment'
/** 댓글이 아닌 요소 (선물·입장·좋아요·시스템 알림) — 시험이 "읽지 않음"을 확인하는 목록 */
export const TT_NOT_COMMENTS = ['.tt-gift', '.tt-join', '.tt-like', '.tt-system'] as const
/** 댓글 요소의 데이터: 댓글 ID · 숫자 사용자 ID · 쓴 사람 아이디(uniqueId) */
export const TT_COMMENT_ID_ATTR = 'data-comment-id'
export const TT_USER_ID_ATTR = 'data-user-id'
export const TT_UNIQUE_ID_ATTR = 'data-unique-id'
/** 댓글 요소 안: 닉네임 · 본문 */
export const TT_NICKNAME = '.tt-nickname'
export const TT_TEXT = '.tt-text'
