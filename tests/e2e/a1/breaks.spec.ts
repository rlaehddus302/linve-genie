// A1 흐름 깨뜨리기 (AC-A1-20·21·06·08, D-A1-01·07) — test-e2e, 묶음 chromium-assist(@assist).
// PC·휴대폰 동시 열기, 되돌리기, 요청 끊김, 이상한 AI 답, 화면 범위 바꾸기.
import { expect, test } from '@playwright/test'
import {
  FAILED,
  READING,
  SOURCE_AI,
  SOURCE_RULE,
  assistWorld,
  chat,
  countSuggestCalls,
  enableAssistApi,
  fakeLlm,
  fakeRequests,
  history,
  openReviews,
  reviewLine,
  reviewList,
  waitReviews,
} from './support.ts'

test.beforeEach(async ({ request }) => {
  await fakeLlm(request, '/_fake/reset')
})

test('TE-A1 깨뜨리기 @assist: [이대로 주문] 뒤 되돌리기 → 기록 없음, 그 줄과 제안이 그대로 남는다', async ({ page }) => {
  const { b, date } = await assistWorld(page)
  await chat(page, b, '김철수', '반바지 미디엄')
  await waitReviews(page, b, true, 1)
  await openReviews(page, b, true)
  await reviewLine(page, 1).getByRole('button', { name: '1번째 줄 이대로 주문' }).click()
  const undo = page.getByRole('region', { name: '보내기 전 조치' }).getByRole('button', { name: /되돌리기/ })
  await undo.first().click()
  await expect(undo).toHaveCount(0)
  await expect(reviewList(page).getByRole('listitem')).toHaveCount(1)
  await expect(reviewLine(page, 1).getByRole('group', { name: '1번째 줄 제안' })).toContainText(SOURCE_RULE)
  await expect(reviewLine(page, 1).getByRole('button', { name: '1번째 줄 이대로 주문' })).toBeEnabled()
  expect((await history(page, date, true)).filter((e) => e.type === 'host.resolveReview')).toHaveLength(0)
})

test('TE-A1 깨뜨리기 @assist: PC와 휴대폰에서 같은 화면을 동시에 열어도 가짜 AI 요청 1개, 두 화면 모두 결국 AI 제안을 본다', async ({ page, browser, request }) => {
  const { b } = await assistWorld(page)
  await enableAssistApi(page)
  await chat(page, b, '이영희', '반바지 엠사이즈')
  await waitReviews(page, b, true, 1)
  await fakeLlm(request, '/_fake/answers', { text: '반바지 엠사이즈', suggestion: { no: 21, options: { 사이즈: 'M' }, qty: 1 } })
  await fakeLlm(request, '/_fake/fail', { kind: 'slow', delayMs: 1500 })
  const state = await page.context().storageState()
  const phoneCtx = await browser.newContext({ storageState: state, viewport: { width: 390, height: 844 } })
  try {
    const phone = await phoneCtx.newPage()
    await Promise.all([openReviews(page, b, true), openReviews(phone, b, true)])
    await expect(reviewLine(page, 1).getByRole('group', { name: '1번째 줄 제안' })).toContainText(SOURCE_AI)
    // 진행 중(BUSY)을 받은 쪽은 곧바로, 그 뒤 2초마다 목록을 다시 읽는다(D-A1-16) — 16초 한 번이 아니라 몇 초 안에 본다
    await expect(reviewLine(phone, 1).getByRole('group', { name: '1번째 줄 제안' })).toContainText(SOURCE_AI, { timeout: 9_000 })
    await expect(phone.getByText(READING)).toHaveCount(0)
    await expect(phone.getByText(FAILED)).toHaveCount(0)
    expect(await fakeRequests(request)).toHaveLength(1)
  } finally {
    await phoneCtx.close()
  }
})

test('TE-A1 깨뜨리기 @assist: AI 제안 받기 요청이 끊기면 실패 문장, 목록·규칙 제안·"주문 아님"은 그대로', async ({ page }) => {
  const { b, date } = await assistWorld(page)
  await enableAssistApi(page)
  await chat(page, b, '김철수', '반바지 미디엄')
  await chat(page, b, '이영희', '반바지 엠사이즈')
  await waitReviews(page, b, true, 2)
  await page.route('**/api/assist/suggest', (route) => route.abort('internetdisconnected'))
  await openReviews(page, b, true)
  await expect(page.getByRole('status').filter({ hasText: FAILED })).toBeVisible()
  await expect(page.getByText(READING)).toHaveCount(0)
  await expect(reviewLine(page, 1).getByRole('group', { name: '1번째 줄 제안' })).toContainText(SOURCE_RULE)
  await reviewLine(page, 2).getByRole('button', { name: '2번째 줄 주문 아님' }).click()
  await expect(reviewList(page).getByRole('listitem')).toHaveCount(1)
  await expect.poll(async () => (await history(page, date, true)).filter((e) => e.type === 'host.dismissReview').length).toBe(1)
})

test('TE-A1 깨뜨리기 @assist: AI가 목록 밖 선택지·수량 99·다른 상품을 답하면 그 줄엔 제안이 없다', async ({ page, request }) => {
  const { b } = await assistWorld(page)
  await enableAssistApi(page)
  await chat(page, b, '가', '반바지 엑스엘')
  await chat(page, b, '나', '반바지 엠으로')
  await chat(page, b, '다', '반바지 다른거')
  await chat(page, b, '라', '반바지 엠사이즈')
  await waitReviews(page, b, true, 4)
  await fakeLlm(request, '/_fake/answers', { text: '반바지 엑스엘', suggestion: { no: 21, options: { 사이즈: 'XL' }, qty: 1 } })
  await fakeLlm(request, '/_fake/answers', { text: '반바지 엠으로', suggestion: { no: 21, options: { 사이즈: 'M' }, qty: 99 } })
  await fakeLlm(request, '/_fake/answers', { text: '반바지 다른거', suggestion: { no: 99, options: { 사이즈: 'M' }, qty: 1 } })
  await fakeLlm(request, '/_fake/answers', { text: '반바지 엠사이즈', suggestion: { no: 21, options: { 사이즈: 'M' }, qty: 1 } })
  const items = await waitReviews(page, b, true, 4)
  expect(items.map((x) => x.reason)).toEqual(['UNKNOWN_WORD', 'UNKNOWN_WORD', 'UNKNOWN_WORD', 'UNKNOWN_WORD'])
  const lineOf = (text: string) => items.findIndex((x) => x.text === text) + 1
  await openReviews(page, b, true)
  const good = lineOf('반바지 엠사이즈')
  await expect(reviewLine(page, good).getByRole('group', { name: `${String(good)}번째 줄 제안` })).toContainText(SOURCE_AI)
  for (const text of ['반바지 엑스엘', '반바지 엠으로', '반바지 다른거']) {
    const n = lineOf(text)
    await expect(reviewLine(page, n).getByRole('group', { name: `${String(n)}번째 줄 제안` })).toHaveCount(0)
  }
  await expect(page.locator('main')).not.toContainText(/XL|99개|99번/)
})

test('TE-A1 깨뜨리기 @assist: 화면 범위를 바꾸면 그 범위로 한 번 더 — 같은 범위 새로고침마다 한 번', async ({ page }) => {
  const { b } = await assistWorld(page)
  await enableAssistApi(page)
  await chat(page, b, '김철수', '반바지 미디엄')
  await waitReviews(page, b, true, 1)
  const calls = countSuggestCalls(page)
  const bodies: unknown[] = []
  page.on('request', (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/assist/suggest') bodies.push(r.postDataJSON()) })
  await openReviews(page, b, true)
  await expect(reviewLine(page, 1)).toBeVisible()
  await expect.poll(() => calls.count()).toBe(1)
  await page.goto('/reviews?rehearsal=true')
  await expect(page.getByRole('heading', { name: '확인 필요', level: 1 })).toBeVisible()
  await expect(reviewLine(page, 1)).toBeVisible()
  await expect.poll(() => calls.count()).toBe(2)
  expect(bodies).toEqual([{ rehearsal: true, broadcast: b }, { rehearsal: true }])
})
