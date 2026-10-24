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
export const RULES_NEXT = ' 바꾼 규칙은 다음에 시작하는 방송부터 적용돼요.'
export const SHIPPING_NEXT = ' 오늘 방송을 이미 시작했으면 배송비는 내일부터 적용돼요.'
export const failedLine = (...blocks: string[]) => `저장하지 못한 칸이 있어요: ${blocks.join(' · ')}. 빨간 글을 확인해 주세요.`

export const SHIPPING_HINT = '배송비는 그날 첫 방송을 시작할 때의 값으로 정산해요. 오늘 방송을 이미 시작했으면 바꾼 배송비는 내일부터 적용돼요.'
export const OLD_SHIPPING_LINE = '그날 첫 방송이 이미 있으면 그날 정산은 그대로예요.'
export const UNIT_HINT = "만원 단위는 '2만'·'1.5만'처럼 적으면 돼요. 어느 단위를 골라도 '2만'은 20,000원이에요."
export const SAME_MINUTE = '문자찜과 유튜브 찜이 같은 1분 안에 들어오면 (실제 받은 시각 순서일 때만)'
export const LIVE_CHAT_DESC = '방송 중 영상 옆 채팅창에 바로 보이는 글이에요.'
export const VIDEO_COMMENT_DESC = '방송 영상 아래 댓글란에 남는 글이에요. 방송이 끝나도 남아요.'
export const AUTO_BATCH = '판매가 확정될 때마다 하나씩 남겨요. 유튜브가 하루에 받아 주는 양이 모자라면 저절로 1분씩 묶어 남겨요.'
export const BATCH_LABEL = '몇 초 동안의 판매를 한 메시지로 묶을까요? (0이면 하나씩)'
export const NO_AUTO_BOOK_HINT = '자동 접수는 아직 준비 중이에요. 지금은 포장 화면에서 송장번호를 직접 적어요.'
export const NO_AUTO_BOOK = '고른 택배사는 아직 자동 접수를 할 수 없어요. 포장 화면에서 송장번호를 직접 적어 주세요.'
export const BOX_WORDS = ['60cm 이하', '80cm 이하', '100cm 이하', '120cm 이하', '160cm 이하']
export const BOX_HINT = '가로·세로·높이를 더한 길이예요. 우체국 기준이고, 무게 기준은 택배사마다 달라요.'
export const LEAVE_TITLE = '다른 화면으로 갈까요?'
export const LEAVE_TEXT = '저장하지 않은 값이 있어요. 떠나면 저장하지 않아요.'

/** 화면에 나오면 안 되는 개발 용어·영어 상태값 (AC-FB1-90) */
// 앞뒤가 라틴 글자·숫자·한글이 아닌 낱말만 ("CJ대한통운"은 택배사 이름이라 허용)
export const DEV_WORDS = /(?<![A-Za-z0-9_가-힣])(THOUSAND|WON|EPOST|OTHER|CJ|HANJIN|LOGEN|LOTTE|FAKE|CONNECT_FAILED|DISCONNECTED|PER_SALE|SUMMARY|OFF|ALL|FIRST|IGNORE|NO_AUTO_BOOK|NO_CARRIER|undefined|null|NaN)(?![A-Za-z0-9_가-힣])/

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
