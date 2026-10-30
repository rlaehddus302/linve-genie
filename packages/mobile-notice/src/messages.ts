// 문자찜·입금 알림 받기 화면 문장 (SMS3) — 쉬운 한국어, 개발 용어·영어 상태값 없음.
import type { BankPackagesProblem } from './packages.ts'
import type { NoticeState } from './types.ts'

/** 기능 이름 (설정·상태 줄 제목) */
export const NOTICE_FEATURE_NAME = '문자찜·입금 알림 받기'

/** 안드로이드 알림 읽기 허용 안내 */
export const NOTICE_ACCESS_GUIDE =
  '휴대폰 설정에서 라이브지니의 "알림 읽기"를 허용해 주세요.\n라이브지니는 문자 앱과 고른 은행 앱의 알림만 읽고, 다른 앱 알림은 열어 보지 않아요.'
/** 안드로이드 13+ 앱 밖에서 받은 설치 파일이면 허용 단추가 막힌다 */
export const NOTICE_RESTRICTED_GUIDE = '허용이 눌리지 않으면: 설정 → 애플리케이션 → 라이브지니 → 오른쪽 위 ⋮ → "제한된 설정 허용"을 누른 뒤 다시 해 주세요.'
/** 배터리 최적화 제외 안내 (삼성 기준 길 — 기종마다 이름이 조금 달라요) */
export const NOTICE_BATTERY_GUIDE =
  '방송 중에 문자를 놓치지 않으려면 배터리 절약에서 라이브지니를 빼 주세요.\n설정 → 애플리케이션 → 라이브지니 → 배터리 → "제한 없음"'
/** 아이폰 단축어 자동화 만들기 안내 */
export const NOTICE_SHORTCUT_GUIDE =
  '단축어 앱 → 자동화 → 새로 만들기 → "메시지" → 받을 사람·낱말을 고르고 "즉시 실행" → 동작에 "라이브지니에 넣기"를 넣고 보낸 사람·내용을 이어 주세요.'
/** 아이폰 단축어 동작 이름 (단축어 앱에 보임) */
export const NOTICE_INTENT_TITLE = '라이브지니에 넣기'
export const NOTICE_INTENT_DESCRIPTION = '받은 문자나 은행 입금 알림을 라이브지니로 보내요.'
/** 단축어 동작 칸 이름 */
export const NOTICE_INTENT_PARAMS = Object.freeze({ sender: '보낸 사람', body: '내용', kind: '종류' })
/** 단축어 종류 보기 */
export const NOTICE_INTENT_KINDS = Object.freeze({ sms: '문자', bank: '은행 입금' })
/** 단축어가 끝나고 돌려주는 말 (기본은 조용히 — 말은 단축어 결과에만) */
export const NOTICE_INTENT_RESULT = Object.freeze({
  sent: '라이브지니에 넣었어요.',
  queued: '인터넷이 되면 라이브지니로 보낼게요.',
  filtered: '인증번호·광고라 보내지 않았어요.',
  duplicate: '이미 넣은 문자예요.',
  off: '라이브지니에서 문자·입금 알림 받기가 꺼져 있어요.',
  noToken: '라이브지니 앱에서 문자·입금 알림 받기를 먼저 켜 주세요.',
  empty: '보낼 내용이 없어요.',
})

/** 은행 앱 고르기 문제 문장 */
export const BANK_PACKAGES_PROBLEM_MESSAGES: Readonly<Record<BankPackagesProblem, string>> = Object.freeze({
  TOO_MANY: '은행 앱은 20개까지 고를 수 있어요.',
  INVALID_NAME: '앱 이름이 맞지 않아요. 목록에서 골라 주세요.',
  BLOCKED: '카카오톡 같은 대화 앱은 개인 대화가 섞여서 고를 수 없어요. 은행 앱이나 은행 문자로 받아 주세요.',
  SMS_APP: '문자 앱은 처음부터 들어 있어요.',
})

/** 한 줄 상태 (설정·방송 화면). 숫자는 쉼표 없이 짧게 */
export function noticeStatusLine(state: NoticeState): string {
  if (!state.enabled) return '꺼져 있어요'
  if (state.access === 'needed') return '알림 읽기를 허용해 주세요'
  if (!state.hasToken) return '라이브지니 서버와 연결이 필요해요'
  if (state.tokenRejected) return '연결이 풀렸어요. 다시 켜 주세요'
  if (state.pending > 0 && state.lastError === 'NETWORK') return `인터넷이 끊겨 ${state.pending}건을 모아 두었어요. 연결되면 바로 보내요`
  if (state.pending > 0 && state.lastError === 'SERVER') return `${state.pending}건을 보내지 못했어요. 잠시 뒤 다시 보내요`
  if (state.pending > 0) return `${state.pending}건 보내는 중이에요`
  if (state.access === 'granted' && !state.connected) return '휴대폰이 알림 읽기를 아직 붙이지 않았어요. 잠시 기다리거나 휴대폰을 다시 켜 주세요'
  return state.access === 'shortcut' ? '단축어로 넣은 문자를 받고 있어요' : '문자·입금 알림을 받고 있어요'
}

/** 건수 줄 */
export function noticeCountLine(state: NoticeState): string {
  const parts = [`보냄 ${state.sent}건`]
  if (state.filtered > 0) parts.push(`인증번호·광고 거름 ${state.filtered}건`)
  if (state.duplicates > 0) parts.push(`겹침 ${state.duplicates}건`)
  if (state.rejected > 0) parts.push(`서버가 받지 않음 ${state.rejected}건`)
  if (state.dropped > 0) parts.push(`넘쳐서 못 담음 ${state.dropped}건`)
  return parts.join(' · ')
}
