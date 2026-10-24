// 공개 소개 화면 (LND1, SPEC §7 화면 17, D-LND1-01~06): 문장(글자 그대로 — E2E가 찾는다)·운영 사업자 줄·소개를 보일지 판단.
// 고지 문장은 코드가 실제로 하는 일과 같아야 한다(D-LND1-05) — 유튜브 권한·로그인 정보·지우는 기간이 바뀌면 이 문장과 결정을 함께 고친다.
import { SERVICE_NAME } from '../brand.ts'
import type { Operator } from '../operator.ts'
import type { Route } from './router.ts'

export const LANDING_TAGLINE = '유튜브·인스타그램·틱톡 라이브 판매의 찜을 자동으로 받아 선착순을 정하고, 라벨 출력과 정산까지 도와드려요.'

export const LANDING_HEADINGS = {
  day: '판매자의 하루',
  start: '시작하려면',
  google: '구글 사용자 데이터를 쓰는 곳',
  operator: '운영 사업자',
} as const

export const LANDING_DAY_STEPS: readonly string[] = [
  '방송 전: 오늘 팔 상품의 번호·이름·가격을 적어요. 말로 불러도 돼요.',
  '방송 중: 손님이 채팅에 상품 번호를 쓰면 찜으로 받아 먼저 쓴 순서대로 정해요.',
  '찜이 정해지면: 상품 라벨이 바로 출력돼요.',
  '방송 뒤: 손님마다 합계·배송비를 정산하고 입금을 확인해요.',
  '포장: 손님별 목록을 보며 담고 포장 라벨을 붙여요.',
]

export const LANDING_START_TEXT = `${SERVICE_NAME} 계정은 운영자가 만들어 드려요. 받은 아이디로 로그인해 주세요.`

/** 점 목록 여섯 줄 (D-LND1-11) — 넷째·다섯째 줄은 지우는 범위·AI 제안. 한국어엔 "제3자" 문장을 두지 않는다 */
export const LANDING_GOOGLE_ITEMS: readonly string[] = [
  '유튜브를 연결하면 판매자 본인 채널의 이름, 본인 라이브 방송 목록, 고른 방송의 채팅 글을 읽어요. 채팅에서 주문을 찾는 데만 써요.',
  '판매자가 설정에서 감사 메시지 자동 게시를 켜고 동의했을 때만 본인 방송 채팅이나 본인 영상 댓글에 짧은 감사 글을 올려요.',
  '구글로 로그인하면 구글 계정 번호와 가린 이메일만 저장해요.',
  '유튜브에서 받은 채팅 글과 채팅만 한 시청자의 이름은 방송 날짜부터 30일 뒤에 지워요. 찜이 정해진 손님의 이름은 판매 장부(확인서·정산·포장)에 남아요.',
  '유튜브에서 받은 채팅은 AI 제안으로 보내지 않아요. 구글 사용자 데이터를 팔거나 광고에 쓰지 않아요.',
  '설정의 유튜브 칸에서 언제든 연결을 끊을 수 있어요.',
]

/** 제한적 사용 문장: 앞 + 링크 글 + 뒤 */
export const LANDING_LIMITED_USE_BEFORE = `${SERVICE_NAME}가 구글 API에서 받은 정보를 쓰고 다른 앱으로 옮길 때는 `
export const LANDING_LIMITED_USE_LINK = '구글 API 서비스 사용자 데이터 정책'
export const LANDING_LIMITED_USE_AFTER = '(제한적 사용 요건 포함)을 따릅니다.'
export const USER_DATA_POLICY_URL = 'https://developers.google.com/terms/api-services-user-data-policy'

/** 심사자용 영문 단락 (`lang="en"`, D-LND1-05 글자 그대로, 30일·AI·제3자 문장은 D-LND1-11) */
export const LANDING_ENGLISH =
  "LiveGenie uses Google user data only to provide its features. When a seller connects YouTube, LiveGenie reads the seller's own channel name, the seller's own live broadcasts, and the live chat messages of the chosen broadcast to find orders (youtube.readonly). Only if the seller turns on automatic thank-you messages and agrees, LiveGenie posts short thank-you messages in the seller's own live chat or as a comment on the seller's own video (youtube.force-ssl). Google sign-in uses only openid and email. Live chat messages received from YouTube, and the names of viewers who only chatted, are deleted 30 days after the broadcast date. The display names of buyers whose orders were confirmed are kept in the seller's sales records (order confirmations, settlement and packing). Chat received from YouTube is never sent to the optional AI suggestion feature. We do not transfer YouTube data to third parties. We do not sell Google user data or use it for advertising. LiveGenie's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements."

export const LANDING_LOGIN = '로그인'
/** "시작하려면" 절 끝의 로그인 길 — 맨 위 "로그인"과 이름을 다르게 (D-LND1-10 (1)) */
export const LANDING_START_LOGIN = '로그인하러 가기'
/** 영문 단락 바로 위 작은 글 — 제목 아님, `lang="en"` 밖 (D-LND1-10 (4)) */
export const LANDING_ENGLISH_CAPTION = '(영문 안내 — 구글 심사용)'
export const LANDING_START_BUTTON = '시작하기'

/** "운영 사업자" 아래 줄: 상호는 늘, 나머지는 값이 빈 글이 아닐 때만 이 순서로 (D-LND1-04) */
export function operatorLines(operator: Operator): string[] {
  const lines = [`상호: ${operator.name}`]
  const optional: readonly (readonly [string, string])[] = [
    ['대표자', operator.representative],
    ['사업자등록번호', operator.businessNumber],
    ['통신판매업 신고번호', operator.mailOrderNumber],
    ['주소', operator.address],
    ['문의 이메일', operator.email],
  ]
  for (const [label, value] of optional) {
    const text = value.trim()
    if (text !== '') lines.push(`${label}: ${text}`)
  }
  return lines
}

/** "계정 문의" 이메일 (없으면 null — 줄을 그리지 않는다) */
export function contactEmail(operator: Operator): string | null {
  const email = operator.email.trim()
  return email === '' ? null : email
}

export interface LandingInput {
  /** 로그인 확인이 401 — 로그아웃 상태 */
  readonly signedOut: boolean
  readonly route: Route
  /** 처음 연 주소에 간편 로그인 결과(`login` 값)가 붙어 왔다 (D-LND1-02 (a)) */
  readonly loginParam: boolean
  /** 이 탭에서 로그아웃했거나 로그인이 풀렸다 — 새로고침 전까지 (D-LND1-02 (b)) */
  readonly leftInTab: boolean
  /** 홈 화면 앱으로 열었다 (D-LND1-02 (c)) */
  readonly standalone: boolean
}

/** 소개 화면을 보일지 (D-LND1-01·02): 로그아웃 상태의 `/`를 브라우저 탭에서 처음 열었을 때만 */
export function shouldShowLanding(input: LandingInput): boolean {
  return input.signedOut && input.route.name === 'home' && !input.loginParam && !input.leftInTab && !input.standalone
}

/** 주소에 간편 로그인 결과 `login` 값이 붙어 있는가 (모르는 값이어도 — 로그인 화면이 지운다) */
export function hasLoginResultParam(search: string): boolean {
  return new URLSearchParams(search).has('login')
}
