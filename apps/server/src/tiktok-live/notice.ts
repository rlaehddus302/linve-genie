// 틱톡 라이브 연결(베타) 위험 고지 (D-904, D-N2b-2-04, AC-N2b-2-20, RA-N2b-1-04). 서버가 판과 문장을 내보내고 화면이 글자 그대로 보인다.
// 문장을 바꾸면 판(version)을 바꾼다 — 이전 판으로 켠 동의는 동의가 아니다(다시 읽고 켜야 한다).
// 단 서비스 이름(SERVICE_NAME)만 바뀐 것은 같은 판으로 본다 — 고지 내용이 같다 (RN1, D-RN1-06).
// 판 이름(TT-BETA-1)은 화면에 보이지 않는 값이다. 고지 문장에는 영문 글자가 없다(시험이 본다).

import { SERVICE_NAME } from '../brand.ts'

export const TIKTOK_NOTICE_VERSION = 'TT-BETA-1'

export interface TikTokNotice {
  readonly version: string
  readonly title: string
  readonly lines: readonly string[]
  readonly checkbox: string
  readonly button: string
}

export const TIKTOK_NOTICE: TikTokNotice = Object.freeze({
  version: TIKTOK_NOTICE_VERSION,
  title: '틱톡 라이브 연결(베타) 안내',
  lines: Object.freeze([
    `틱톡은 라이브 댓글을 읽는 공식 방법을 주지 않아요. ${SERVICE_NAME}는 누구나 볼 수 있는 내 라이브의 댓글을 비공식 방법으로 읽어요.`,
    '틱톡이 이 방법을 막거나 바꾸면 언제든 댓글이 들어오지 않을 수 있어요. 그때는 댓글을 직접 붙여 넣어 주세요.',
    '틱톡 이용약관은 자동으로 정보를 모으는 것을 막고 있을 수 있어요. 시험 중인 기능이라 문제가 생기면 운영자가 언제든 끌 수 있어요.',
    `${SERVICE_NAME}는 틱톡에 글을 올리지 않아요. 감사 메시지도 틱톡에는 보내지 않아요.`,
    '틱톡 비밀번호나 로그인 정보는 묻지도 받지도 않아요.',
    '내 틱톡 계정의 아이디만 넣어 주세요. 다른 사람의 방송 댓글을 모으는 데 쓰면 안 돼요.',
    '연결을 돕는 다른 회사의 서비스를 거치기 때문에, 넣은 틱톡 아이디가 그 회사로 전달돼요.',
    '언제든 설정에서 끌 수 있어요. 끄면 틱톡 댓글을 바로 그만 받아요.',
  ]),
  checkbox: '안내를 읽었고, 위 내용에 동의해요',
  button: '켜기',
})
