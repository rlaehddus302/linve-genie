// 유튜브 채팅 화면의 모양 (X1 YT-10 AC1, D-X1-02·03). 유튜브가 화면을 바꾸면 이 파일 하나만 고친다.
// 가짜 채팅 페이지(test/fixtures/live-chat.html)도 이 모양을 본뜬다.

/** 채팅 목록 (일반 채팅·슈퍼챗·멤버십 등이 아이템으로 붙는다) */
export const ITEM_LIST = 'yt-live-chat-item-list-renderer #items'
/** 채팅 화면의 맨 바깥 (목록이 다시 그려져도 여기서 본다) */
export const CHAT_ROOT = 'yt-live-chat-app'
/** 일반 채팅 메시지 요소 (태그 이름, 대문자로 비교) — 이것만 읽는다 */
export const TEXT_MESSAGE_TAG = 'YT-LIVE-CHAT-TEXT-MESSAGE-RENDERER'
/** 읽지 않는 아이템 (슈퍼챗·슈퍼스티커·멤버십·시스템 안내·자리 표시) — 시험이 "읽지 않음"을 확인하는 목록 */
export const SKIPPED_TAGS = [
  'YT-LIVE-CHAT-PAID-MESSAGE-RENDERER',
  'YT-LIVE-CHAT-PAID-STICKER-RENDERER',
  'YT-LIVE-CHAT-MEMBERSHIP-ITEM-RENDERER',
  'YT-LIVE-CHAT-SPONSORSHIPS-GIFT-PURCHASE-ANNOUNCEMENT-RENDERER',
  'YT-LIVE-CHAT-SPONSORSHIPS-GIFT-REDEMPTION-ANNOUNCEMENT-RENDERER',
  'YT-LIVE-CHAT-VIEWER-ENGAGEMENT-MESSAGE-RENDERER',
  'YT-LIVE-CHAT-MODE-CHANGE-MESSAGE-RENDERER',
  'YT-LIVE-CHAT-PLACEHOLDER-ITEM-RENDERER',
] as const
/** 메시지 요소 안: 닉네임 */
export const AUTHOR_NAME = '#author-name'
/** 메시지 요소 안: 본문 (글자 + 이모지 그림) */
export const MESSAGE_BODY = '#message'
/** 메시지 요소의 id 속성 = 유튜브 메시지 ID */
export const MESSAGE_ID_ATTR = 'id'

/**
 * 작성자 채널 ID·게시 시각은 화면 글자에 없어 페이지 쪽 스크립트(page-bridge)가 요소의 데이터에서 읽어 아래 속성으로 잠깐 붙인다(D-X1-03).
 * 확장 쪽은 읽은 뒤 바로 지운다.
 */
export const BRIDGE_EVENT = 'livegenie-read'
export const CHANNEL_ATTR = 'data-livegenie-ch'
export const POSTED_AT_ATTR = 'data-livegenie-at'
/** 페이지 쪽 요소 데이터의 이름 (유튜브 Polymer 요소의 data) */
export const DATA_CHANNEL_KEY = 'authorExternalChannelId'
export const DATA_TIMESTAMP_KEY = 'timestampUsec'

/** 읽는 페이지: 라이브 채팅(팝아웃·시청 페이지 안 iframe). 다시 보기(live_chat_replay)는 읽지 않는다 */
export const LIVE_CHAT_PATH = '/live_chat'
export const YOUTUBE_HOST = 'www.youtube.com'
