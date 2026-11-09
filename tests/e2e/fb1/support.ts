// FB1 E2E 공용 도우미 (test-e2e). 시험자 피드백 1 — 설정 저장 막대·문구·택배사·택배 크기·라벨 가게 이름·로그인 이동·B1 연결 실패.
// 기대 문장은 harness/sprints/FB1/acceptance.md·docs/spec/LABEL_RULES.md L-7 따옴표 그대로, 선택자는 역할·이름 기반(FB1 dev-notes "e2e").
// 시험마다 새 판매자(loginNewSeller) — 설정·템플릿·택배 설정이 다른 시험과 섞이지 않는다.
import { expect, type Page } from '@playwright/test'

export { apiUrl, loginAs, loginNewSeller, newSeller, openRealBroadcast, settingsRegion, type Seller } from '../i3/support.ts'
export { postJson, registerApi, smsApi, todayKst, uniqueDate } from '../i1/support.ts'

/** 설정 화면 저장 막대 (AC-FB1-22) */
export function saveBar(page: Page) {
  return page.getByRole('region', { name: '저장', exact: true })
}

export function saveButton(page: Page) {
  return saveBar(page).getByRole('button', { name: /^(저장|저장하는 중…)$/ })
}

export const NO_CHANGES = '바꾼 칸이 없어요.'
export const dirtyLine = (...blocks: string[]) => `저장하지 않은 칸: ${blocks.join(' · ')}`
export const SAVED = '저장했어요.'
export const RULES_NEXT = ' 바꾼 규칙은 다음에 시작하는 라이브부터 적용돼요.' // 문구 바뀜 (D-UX4-86)
export const SHIPPING_NEXT = ' 오늘 라이브를 이미 시작했으면 배송비는 내일부터 적용돼요.' // 문구 바뀜 (D-UX4-86)
/** 일부 실패 (AC-FB1-24, 회차 2 D-FB1-18 (d) — 저장한 칸이 있으면 " 저장한 칸: …." 를 붙인 한 요소) */
export const failedLine = (failed: string[], saved: string[] = []) =>
  `저장하지 못한 칸이 있어요: ${failed.join(' · ')}. 빨간 글을 확인해 주세요.${saved.length > 0 ? ` 저장한 칸: ${saved.join(' · ')}.` : ''}`

export const SHIPPING_HINT = '배송비는 그날 첫 라이브를 시작할 때의 값으로 정산해요. 오늘 라이브를 이미 시작했으면 바꾼 배송비는 내일부터 적용돼요.' // 문구 바뀜 (D-UX4-86)
export const OLD_SHIPPING_LINE = '그날 첫 방송이 이미 있으면 그날 정산은 그대로예요.'
/** 가격 단위 (AC-FB1-01, D-FB1-11 사용자 결정) — 낱말 셋·늘 보이는 안내·바꿀 때 확인 문장 */
export const UNIT_WORDS = { WON: '원 (15000 → 15,000원)', THOUSAND: '천원 (15 → 15,000원)', TEN_THOUSAND: '만원 (15 → 150,000원)' } as const
export const UNIT_HINT = "'2만'·'15000원'처럼 단위를 붙여 적으면 이 설정과 상관없이 적힌 대로 들어가요."
export const OLD_UNIT_HINT = "만원 단위는 '2만'·'1.5만'처럼 적으면 돼요."
export const UNIT_CHANGE = {
  TEN_THOUSAND: "저장하면 다음 라이브부터 '15'는 150,000원으로 들어가요. 이미 등록한 상품 가격은 바뀌지 않아요.", // 문구 바뀜 (D-UX4-86)
  THOUSAND: "저장하면 다음 라이브부터 '15'는 15,000원으로 들어가요. 이미 등록한 상품 가격은 바뀌지 않아요.", // 문구 바뀜 (D-UX4-86)
  WON: "저장하면 다음 라이브부터 숫자를 원 그대로 읽어요('15000' → 15,000원). 이미 등록한 상품 가격은 바뀌지 않아요.", // 문구 바뀜 (D-UX4-86)
} as const
/** 콘솔 단위 줄 (AC-FB1-02) */
export const UNIT_LINE = {
  THOUSAND: '가격 단위: 천원 — 10은 10,000원, 2만은 20,000원',
  WON: '가격 단위: 원 — 10000은 10,000원, 2만은 20,000원',
  TEN_THOUSAND: '가격 단위: 만원 — 15는 150,000원, 5천은 5,000원',
} as const
/** 같은 분 낱말 (회차 2 D-FB1-13 사용자 결정) — 옛 둘은 어디에도 없어야 한다 */
export const SAME_MINUTE = '문자찜과 댓글찜이 동시에(같은 1분 안에) 들어오면'
export const OLD_SAME_MINUTE = ['문자찜과 유튜브 찜이 같은 1분 안에 들어오면 (실제 받은 시각 순서일 때만)', '같은 분에 들어오면']
/** 감사 만들기 (회차 2 D-FB1-14 사용자 결정) */
export const LIVE_CHAT_CHECK = '찜이 확정될 때마다 채팅에 감사 메시지 남기기'
export const VIDEO_ON = '영상 댓글에도 감사 메시지를 남기고 있어요.'
export const VIDEO_OFF_PENDING = '저장하면 영상 댓글에는 남기지 않아요.'
/** 감사 만들기에 없어야 하는 옛 낱말 (문장 모음 2·3·6) */
export const OLD_THANKS_WORDS = [
  '실시간 채팅에 감사 메시지 남기기',
  '감사 메시지를 남길 곳',
  '영상 댓글에 감사 메시지 남기기',
  '영상 댓글 방식',
  '판매마다 댓글',
  '라이브가 끝나고 요약 댓글 1개', // 문구 바뀜 (D-UX4-86)
  '방송 중 영상 옆 채팅창에 바로 보이는 글이에요.',
  '방송 영상 아래 댓글란에 남는 글이에요. 방송이 끝나도 남아요.',
  '판매가 확정될 때마다 하나씩 남겨요.',
  '남기지 않음',
]
export const AUTO_BATCH = '유튜브가 하루에 받아 주는 양이 모자라면 저절로 1분씩 묶어 남겨요.'
/** 접는 단추 (회차 2 D-FB1-18 (c)) */
export const RULES_DETAIL = '판매 규칙 상세 설정'
export const THANKS_DETAIL = '감사 메시지 상세 설정'
/** 범위 문장 (회차 2 D-FB1-18 (g), AC-FB1-41) */
export const RANGE_0_100 = '0부터 100까지 숫자로 적어 주세요.'
export const BATCH_LABEL = '몇 초 동안의 판매를 한 메시지로 묶을까요? (0이면 하나씩)'
/** 택배 설정 안내 하나 (회차 2 D-FB1-18 (f)) — 옛 둘은 없어야 한다 */
export const OLD_PARCEL_HINTS = ['택배사를 고르지 않아도 포장 화면에서 배송 완료·송장번호를 직접 적을 수 있어요.', '20자까지 적을 수 있어요.']
export const NO_AUTO_BOOK_HINT = '자동 접수는 아직 준비 중이에요. 지금은 포장 화면에서 송장번호를 직접 적어요.'
export const NO_AUTO_BOOK = '고른 택배사는 아직 자동 접수를 할 수 없어요. 포장 화면에서 송장번호를 직접 적어 주세요.'
export const BOX_WORDS = ['60cm 이하', '80cm 이하', '100cm 이하', '120cm 이하', '160cm 이하']
export const BOX_HINT = '가로·세로·높이를 더한 길이예요. 우체국 기준이고, 무게 기준은 택배사마다 달라요.'
export const LEAVE_TITLE = '다른 화면으로 갈까요?'
export const LEAVE_TEXT = '저장하지 않은 값이 있어요. 떠나면 저장하지 않아요.'

/** 화면에 나오면 안 되는 개발 용어·영어 상태값 (AC-FB1-90) */
// 앞뒤가 라틴 글자·숫자·한글이 아닌 낱말만 ("CJ대한통운"은 택배사 이름이라 허용)
export const DEV_WORDS = /(?<![A-Za-z0-9_가-힣])(TEN_THOUSAND|THOUSAND|WON|EPOST|OTHER|CJ|HANJIN|LOGEN|LOTTE|FAKE|CONNECT_FAILED|DISCONNECTED|PER_SALE|SUMMARY|OFF|ALL|FIRST|IGNORE|NO_AUTO_BOOK|NO_CARRIER|undefined|null|NaN)(?![A-Za-z0-9_가-힣])/

export async function serverSettings(page: Page): Promise<Record<string, unknown>> {
  const res = await page.request.get('/api/settings')
  expect(res.ok(), await res.text()).toBe(true)
  return (await res.json() as { settings: Record<string, unknown> }).settings
}

export async function patchSettings(page: Page, settings: Record<string, unknown>): Promise<void> {
  const res = await page.request.patch('/api/settings', { data: { settings }, headers: { Origin: new URL(page.url()).origin } })
  expect(res.status(), await res.text()).toBe(200)
}

export async function putParcelSettings(page: Page, settings: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await page.request.put('/api/parcels/settings', { data: settings, headers: { Origin: new URL(page.url()).origin } })
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json() as { settings: Record<string, unknown> }).settings
}

export async function parcelSettings(page: Page): Promise<Record<string, unknown>> {
  const res = await page.request.get('/api/parcels/settings')
  expect(res.ok(), await res.text()).toBe(true)
  return (await res.json() as { settings: Record<string, unknown> }).settings
}

/** 설정 화면에서 보내는 저장 요청을 차례대로 적는다 (가게·설정·택배) */
export function recordSaves(page: Page): { method: string; path: string; body: unknown }[] {
  const seen: { method: string; path: string; body: unknown }[] = []
  page.on('request', (r) => {
    const path = new URL(r.url()).pathname
    const key = `${r.method()} ${path}`
    if (key === 'PUT /api/shop' || key === 'PATCH /api/settings' || key === 'PUT /api/parcels/settings') seen.push({ method: r.method(), path, body: r.postDataJSON() as unknown })
  })
  return seen
}
