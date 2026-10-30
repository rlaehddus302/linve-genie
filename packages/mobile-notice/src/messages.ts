// 문자찜·입금 알림 받기 화면 문장 (SMS3) — 쉬운 한국어, 개발 용어·영어 상태값 없음.
import type { NoticeState } from './types.ts'

/** 기능 이름 (설정·상태 줄 제목) */
export const NOTICE_FEATURE_NAME = '휴대폰 알림 받기'

/** 안드로이드 알림 읽기 허용 안내 */
export const NOTICE_ACCESS_GUIDE = '문자와 은행 앱 알림만 라이브지니로 보내요. 다른 앱 알림은 읽지 않아요.'
/** 알림 읽기 설정 열기 단추 */
export const NOTICE_ACCESS_BUTTON = '알림 읽기 켜러 가기'
/** 알림 읽기가 꺼져 있을 때 설정 칸 */
export const NOTICE_ACCESS_OFF = '알림 읽기가 꺼져 있어요'
/** 401 — 받기 토큰이 끊겼을 때 (AC-SMS3-27) */
export const NOTICE_TOKEN_AGAIN = '받기 토큰을 다시 넣어 주세요'
/** 안드로이드 13+ 앱 밖에서 받은 설치 파일이면 허용 단추가 막힌다 */
export const NOTICE_RESTRICTED_GUIDE = '허용이 눌리지 않으면: 설정 → 애플리케이션 → 라이브지니 → 오른쪽 위 ⋮ → "제한된 설정 허용"을 누른 뒤 다시 해 주세요.'
/** 배터리 최적화 제외 안내 (삼성 기준 길 — 기종마다 이름이 조금 달라요) */
export const NOTICE_BATTERY_GUIDE =
  '방송 중에 문자를 놓치지 않으려면 배터리 절약에서 라이브지니를 빼 주세요.\n설정 → 애플리케이션 → 라이브지니 → 배터리 → "제한 없음"'
/**
 * 아이폰 단축어 안내 — 판매자에게 보이는 것은 웹 설정의 한 가지("URL 콘텐츠 가져오기"에 받기 토큰 붙여 넣기)뿐이다(D-SMS3-23).
 * 이 모듈의 단축어 동작("라이브지니에 문자 보내기", NoticeIntents.swift)은 코드에 두되 안내에서 권하지 않는다 — 실물 확인(HG-SMS3-07) 뒤 다시 본다.
 */
export const NOTICE_SHORTCUT_GUIDE =
  '컴퓨터에서 라이브지니 설정 → "휴대폰 알림 받기"를 켜고 "아이폰 단축어 만들기 안내"를 따라 주세요. 단축어의 "URL 콘텐츠 가져오기"에 받기 토큰을 붙여 넣으면 돼요.'
/** 아이폰 단축어 동작 이름 (단축어 앱 동작 목록에만 보임 — 안내에서는 권하지 않는다, D-SMS3-23) */
export const NOTICE_INTENT_TITLE = '라이브지니에 문자 보내기'
export const NOTICE_INTENT_DESCRIPTION = '받은 문자를 라이브지니로 보내 찜 접수와 입금 확인에 씁니다.'
/** 단축어 동작 칸 이름 (아이폰은 문자만 — 은행 앱 알림은 받을 수 없다) */
export const NOTICE_INTENT_PARAMS = Object.freeze({ sender: '보낸 사람', body: '내용' })
/** 단축어가 끝나고 돌려주는 말 (기본은 조용히 — 말은 단축어 결과에만) */
export const NOTICE_INTENT_RESULT = Object.freeze({
  sent: '라이브지니로 보냈어요.',
  queued: '문자를 담았어요. 인터넷이 연결되면 라이브지니로 보내요.',
  filtered: '광고·인증·결제 같은 문자라서 보내지 않았어요.',
  duplicate: '이미 보낸 문자예요.',
  dropped: '쌓인 문자가 너무 많아 오래된 것부터 지웠어요. 라이브지니 앱을 열어 주세요.',
  off: '문자 받기가 꺼져 있어요. 라이브지니 앱에서 켜 주세요.',
  noToken: '라이브지니 앱에 받기 토큰을 먼저 넣어 주세요.',
  empty: '내용이 비어 있어서 보내지 않았어요.',
})

/** 한 줄 상태 (설정·방송 화면). 숫자는 쉼표 없이 짧게 */
export function noticeStatusLine(state: NoticeState): string {
  if (!state.enabled) return '꺼져 있어요'
  if (state.access === 'needed') return NOTICE_ACCESS_OFF
  if (!state.hasToken) return '받기 토큰을 넣어 주세요'
  if (state.tokenRejected) return NOTICE_TOKEN_AGAIN
  if (state.pending > 0 && state.lastError === 'NETWORK') return `인터넷이 끊겨 ${state.pending}건을 모아 두었어요. 연결되면 바로 보내요`
  if (state.pending > 0 && state.lastError === 'SERVER') return `${state.pending}건을 보내지 못했어요. 잠시 뒤 다시 보내요`
  if (state.pending > 0 && state.lastError === 'BUSY') return `${state.pending}건을 1분 뒤에 다시 보내요`
  if (state.pending > 0) return `${state.pending}건 보내는 중이에요`
  if (state.access === 'granted' && !state.connected) return '휴대폰이 알림 읽기를 아직 붙이지 않았어요. 잠시 기다리거나 휴대폰을 다시 켜 주세요'
  if (state.access === 'shortcut') return '단축어로 받은 문자를 보내고 있어요'
  return state.hasFilters ? '문자와 은행 앱 알림을 보내고 있어요' : '문자를 보내고 있어요. 은행 앱 목록은 서버에 연결되면 받아요'
}

/** 건수 줄 */
export function noticeCountLine(state: NoticeState): string {
  const parts = [`보냄 ${state.sent}건`]
  if (state.ignored > 0) parts.push(`찜·입금 아님 ${state.ignored}건`)
  if (state.filtered > 0) parts.push(`광고·인증 문자 거름 ${state.filtered}건`)
  if (state.duplicates > 0) parts.push(`겹침 ${state.duplicates}건`)
  if (state.rejected > 0) parts.push(`서버가 받지 않음 ${state.rejected}건`)
  if (state.dropped > 0) parts.push(`쌓인 게 많아 지움 ${state.dropped}건`)
  return parts.join(' · ')
}
