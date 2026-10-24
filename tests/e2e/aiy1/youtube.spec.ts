// AIY1 유튜브 채팅은 AI로 보내지 않음 (AC-AIY1-01·03·04·07·09, CMT-06, R-20 10, D-AIY1-01~04) — test-e2e, 묶음 chromium-assist(@assist).
// 화면 문장(D-AIY1-05 ①~③)은 이번 범위 밖(web 후속)이라 보지 않는다 — 이 시험은 화면을 열었을 때 유튜브 줄이 가짜 AI에 닿지 않는지,
// 유튜브 줄에 "AI가 읽음"이 보이지 않는지, 화면이 멈추거나 실패 문장을 보이지 않는지를 본다.
// 기대값은 acceptance.md에서 정했다. 유튜브 줄은 크롬 확장 경로로 넣는다(출처 extension — D-AIY1-01 "유튜브 줄").
import { expect, test } from '@playwright/test'
import {
  FAILED,
  SHORTS_SIZES,
  READING,
  SOURCE_AI,
  SOURCE_RULE,
  assistSettingsApi,
  chat,
  countSuggestCalls,
  createBroadcast,
  enableAssistApi,
  fakeLlm,
  fakeRequests,
  noHorizontalScroll,
  openReviews,
  registerOptions,
  reviewLine,
  reviewList,
  reviewsExcluded,
  sentTexts,
  waitReviews,
  youtubeWorld,
  ytChannel,
  ytChat,
} from './support.ts'

test.beforeEach(async ({ request }) => {
  await fakeLlm(request, '/_fake/reset')
})

test('AC-AIY1-01·07 @assist: AI 켜짐 + 유튜브 줄만 있는 실제 방송 — 화면을 열어도 가짜 AI 요청 0개·오늘 사용량 그대로, 유튜브 줄엔 "AI가 읽음"이 없고 규칙 제안만', async ({ page, request }) => {
  const { b, link, outbound } = await youtubeWorld(page, request)
  await ytChat(request, link, '김철수', '반바지 미디엄') // UNKNOWN_WORD — 규칙 제안 M
  await ytChat(request, link, '이영희', '반바지 엠사이즈') // AI 대상이었을 줄 (규칙 제안 없음)
  const items = await waitReviews(page, b, false, 2)
  expect(items.map((x) => x.reason)).toEqual(['UNKNOWN_WORD', 'UNKNOWN_WORD'])
  // 꺼짐에서도 이유 코드는 같다 (AC-AIY1-07)
  expect((await reviewsExcluded(page, b, false)).map((x) => x.excluded)).toEqual(['YOUTUBE_POLICY', 'YOUTUBE_POLICY'])

  await enableAssistApi(page)
  // 가짜 AI가 그 글에 답을 갖고 있어도 묻지 않아야 한다
  await fakeLlm(request, '/_fake/answers', { text: '반바지 엠사이즈', suggestion: { no: 21, options: { 사이즈: 'M' }, qty: 1 } })
  const calls = countSuggestCalls(page)
  const suggested = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/assist/suggest')
  await openReviews(page, b, false)
  const answer = await suggested
  expect(answer.status()).toBe(200)
  expect(await answer.json()).toEqual({ result: 'DONE', called: 0 })

  await expect(reviewList(page).getByRole('listitem')).toHaveCount(2)
  const rule = reviewLine(page, 1).getByRole('group', { name: '1번째 줄 제안' })
  await expect(rule).toContainText('제안: 21번 반바지 M 1개')
  await expect(rule.getByText(SOURCE_RULE, { exact: true })).toBeVisible()
  await expect(reviewLine(page, 2).getByRole('group', { name: '2번째 줄 제안' })).toHaveCount(0)
  await expect(page.locator('main').getByText(SOURCE_AI)).toHaveCount(0)
  await expect(page.getByText(READING)).toHaveCount(0)
  await expect(page.getByText(FAILED)).toHaveCount(0)
  await expect(page.locator('main')).not.toContainText(/YOUTUBE_POLICY|excluded|DONE|RULE\b/)

  expect(await fakeRequests(request)).toHaveLength(0)
  expect((await assistSettingsApi(page)).usedToday).toBe(0)
  const after = await reviewsExcluded(page, b, false)
  expect(after.map((x) => x.excluded)).toEqual(['YOUTUBE_POLICY', 'YOUTUBE_POLICY'])
  expect(after.map((x) => x.suggestion?.source ?? null)).toEqual(['RULE', null])

  // 실시간으로 새 유튜브 줄이 들어와 목록이 다시 읽혀도 더 부르지 않는다 (가짜 AI 요청 0개 그대로)
  await ytChat(request, link, '박민수', '반바지 큰거요')
  await expect(reviewList(page).getByRole('listitem')).toHaveCount(3)
  expect(calls.count()).toBe(1)
  // 다시 열어도 마찬가지
  await page.reload()
  await expect.poll(() => calls.count()).toBe(2)
  await expect(reviewList(page).getByRole('listitem')).toHaveCount(3)
  await expect(page.getByText(READING)).toHaveCount(0)
  expect(await fakeRequests(request)).toHaveLength(0)
  expect((await assistSettingsApi(page)).usedToday).toBe(0)
  expect(outbound).toEqual([])
})

test('AC-AIY1-02·09 @assist: 한 판매자의 리허설 줄은 A1처럼 보내고 "AI가 읽음", 실제 방송의 유튜브 줄은 같은 글이어도 보내지 않는다 — 가짜 AI 요청 1개, 본문에 유튜브 줄 글 없음', async ({ page, request }) => {
  const { b: real, link } = await youtubeWorld(page, request)
  await ytChat(request, link, '유튜브손님', '반바지 엠사이즈')
  await ytChat(request, link, '유튜브둘째', '반바지 미듐요') // 유튜브에만 있는 글 — 어디에도 보내지면 안 된다
  await waitReviews(page, real, false, 2)
  // 같은 판매자의 리허설 방송 (출처 rehearsal — 보낼 수 있다)
  const rehearsal = await createBroadcast(page, { rehearsal: true, saleMode: 'OPTIONS' })
  await registerOptions(page, rehearsal.b, { no: 21, name: '반바지', price: 15000, options: SHORTS_SIZES, stock: 3 })
  await chat(page, rehearsal.b, '연습손님', '반바지 엠사이즈')
  await waitReviews(page, rehearsal.b, true, 1)
  expect((await reviewsExcluded(page, rehearsal.b, true)).map((x) => x.excluded)).toEqual([null])

  await enableAssistApi(page)
  await fakeLlm(request, '/_fake/answers', { text: '반바지 엠사이즈', suggestion: { no: 21, options: { 사이즈: 'M' }, qty: 1 } })
  await fakeLlm(request, '/_fake/answers', { text: '반바지 미듐요', suggestion: { no: 21, options: { 사이즈: 'M' }, qty: 1 } })

  // 리허설 화면: A1 그대로 — 1번 묻고 "AI가 읽음"
  await openReviews(page, rehearsal.b, true)
  const ai = reviewLine(page, 1).getByRole('group', { name: '1번째 줄 제안' })
  await expect(ai).toContainText('제안: 21번 반바지 M 1개')
  await expect(ai.getByText(SOURCE_AI, { exact: true })).toBeVisible()
  await expect.poll(async () => (await fakeRequests(request)).length).toBe(1)

  // 실제 방송 화면: 유튜브 줄은 보내지 않는다
  const suggested = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/assist/suggest')
  await openReviews(page, real, false)
  expect(await (await suggested).json()).toEqual({ result: 'DONE', called: 0 })
  await expect(reviewList(page).getByRole('listitem')).toHaveCount(2)
  await expect(page.locator('main').getByText(SOURCE_AI)).toHaveCount(0)
  await expect(page.getByText(READING)).toHaveCount(0)
  await expect(page.getByText(FAILED)).toHaveCount(0)

  const reqs = await fakeRequests(request)
  expect(reqs).toHaveLength(1)
  expect(sentTexts(reqs[0]!)).toEqual(['반바지 엠사이즈'])
  const raw = JSON.stringify(reqs)
  for (const leaked of ['반바지 미듐요', '유튜브손님', '유튜브둘째', ytChannel('유튜브손님'), ytChannel('유튜브둘째')]) expect(raw).not.toContain(leaked)
  expect((await assistSettingsApi(page)).usedToday).toBe(1)
  const realItems = await reviewsExcluded(page, real, false)
  expect(realItems.map((x) => [x.excluded, x.suggestion?.source ?? null])).toEqual([['YOUTUBE_POLICY', null], ['YOUTUBE_POLICY', null]])
})

test('AC-AIY1-04 @assist: 하루 상한(3)을 다 쓴 판매자라도 유튜브 줄만 있는 방송은 LIMIT가 아니라 DONE·called 0 — 가짜 AI 요청이 늘지 않는다', async ({ page, request }) => {
  const { b: real, link } = await youtubeWorld(page, request)
  await ytChat(request, link, '유튜브손님', '반바지 엠사이즈')
  await waitReviews(page, real, false, 1)
  const rehearsal = await createBroadcast(page, { rehearsal: true, saleMode: 'OPTIONS' })
  await registerOptions(page, rehearsal.b, { no: 21, name: '반바지', price: 15000, options: SHORTS_SIZES, stock: 3 })
  await enableAssistApi(page)
  for (const [i, text] of ['반바지 큰거요', '반바지 작은거', '반바지 중간거'].entries()) {
    await chat(page, rehearsal.b, `연습${String(i)}`, text)
    await waitReviews(page, rehearsal.b, true, i + 1)
    await openReviews(page, rehearsal.b, true)
    await expect.poll(async () => (await fakeRequests(request)).length).toBe(i + 1)
    await expect(page.getByText(READING)).toHaveCount(0)
  }
  expect((await assistSettingsApi(page)).usedToday).toBe(3)

  const suggested = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/assist/suggest')
  await openReviews(page, real, false)
  expect(await (await suggested).json()).toEqual({ result: 'DONE', called: 0 })
  await expect(reviewList(page).getByRole('listitem')).toHaveCount(1)
  await expect(page.getByText(READING)).toHaveCount(0)
  await expect(page.getByText(FAILED)).toHaveCount(0)
  expect(await fakeRequests(request)).toHaveLength(3)
  expect((await assistSettingsApi(page)).usedToday).toBe(3)
})

test('AC-AIY1-01 깨뜨리기 @assist: PC와 휴대폰(375px)에서 실제 방송 확인 필요 화면을 동시에 열어도 가짜 AI 요청 0개 — 두 화면 모두 규칙 제안, 읽는 중 문장이 남지 않고 가로 넘침 없음', async ({ page, browser, request }) => {
  const { b, link } = await youtubeWorld(page, request)
  await ytChat(request, link, '김철수', '반바지 미디엄')
  await ytChat(request, link, '이영희', '반바지 엠사이즈')
  await waitReviews(page, b, false, 2)
  await enableAssistApi(page)
  await fakeLlm(request, '/_fake/answers', { text: '반바지 엠사이즈', suggestion: { no: 21, options: { 사이즈: 'M' }, qty: 1 } })
  const state = await page.context().storageState()
  const phoneCtx = await browser.newContext({ storageState: state, viewport: { width: 375, height: 812 } })
  try {
    const phone = await phoneCtx.newPage()
    await Promise.all([openReviews(page, b, false), openReviews(phone, b, false)])
    for (const p of [page, phone]) {
      await expect(reviewList(p).getByRole('listitem')).toHaveCount(2)
      await expect(reviewLine(p, 1).getByRole('group', { name: '1번째 줄 제안' }).getByText(SOURCE_RULE, { exact: true })).toBeVisible()
      await expect(reviewLine(p, 2).getByRole('group', { name: '2번째 줄 제안' })).toHaveCount(0)
      await expect(p.getByText(READING)).toHaveCount(0)
      await expect(p.getByText(FAILED)).toHaveCount(0)
      await expect(p.locator('main').getByText(SOURCE_AI)).toHaveCount(0)
    }
    await noHorizontalScroll(phone)
    // 휴대폰에서 규칙 제안 [이대로 주문] → 1등, PC 목록에서도 그 줄이 사라진다 (AI 제외가 바로잡기를 막지 않는다)
    await reviewLine(phone, 1).getByRole('button', { name: '1번째 줄 이대로 주문' }).click()
    await expect(phone.getByRole('list', { name: '보낸 결과' })).toContainText('1등')
    await expect(reviewList(page).getByRole('listitem')).toHaveCount(1)
    expect(await fakeRequests(request)).toHaveLength(0)
  } finally {
    await phoneCtx.close()
  }
})
