// A1 확인 필요 줄의 제안·화면을 열 때 한 번·설정 칸 (AC-A1-20·21·22·31) — test-e2e, 묶음 chromium-assist(@assist).
// 기대값은 acceptance.md에서 정했다(구현을 보고 정하지 않음). 시험마다 새 판매자를 쓰고 가짜 AI를 비운다.
// D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 기대 "보조자 화면엔 AI 제안 칸이 없고, 보조자의 AI 제안 요청은 403 (AC-A1-22·08)"을 뺐다
import { expect, test } from '@playwright/test'
import {
  CONSENT,
  FAILED,
  LIMIT,
  NOTICE,
  OFFER,
  ON,
  READING,
  SOURCE_AI,
  SOURCE_RULE,
  SWITCH,
  assistSettingsApi,
  assistWorld,
  chat,
  countSuggestCalls,
  enableAssistApi,
  fakeLlm,
  fakeRequests,
  history,
  noHorizontalScroll,
  openReviews,
  reviewLine,
  reviewList,
  reviewsWithSuggestion,
  sentTexts,
  waitReviews,
  writeEvent,
} from './support.ts'

test.beforeEach(async ({ request }) => {
  await fakeLlm(request, '/_fake/reset')
})

test('AC-A1-20 @assist: 규칙 제안 "제안: 21번 반바지 M 1개"·"비슷한 글자로 찾음" — 칸은 미리 채우지 않고, 제안 없는 줄은 O2 그대로, AI 꺼짐이면 가짜 AI 요청 0개', async ({ page, request }) => {
  const { b, outbound } = await assistWorld(page)
  await chat(page, b, '김철수', '반바지 미디엄') // UNKNOWN_WORD — 규칙 제안 M
  await chat(page, b, '이영희', '반바지') // OPTION_MISSING — 제안 없음
  const items = await waitReviews(page, b, true, 2)
  expect(items.map((x) => x.reason)).toEqual(['UNKNOWN_WORD', 'OPTION_MISSING'])
  await openReviews(page, b, true)
  const first = reviewLine(page, 1)
  const group = first.getByRole('group', { name: '1번째 줄 제안' })
  await expect(group).toContainText('제안: 21번 반바지 M 1개')
  await expect(group.getByText(SOURCE_RULE, { exact: true })).toBeVisible()
  await expect(group.getByRole('button', { name: '1번째 줄 이대로 주문' })).toBeVisible()
  await expect(group.getByRole('button', { name: '1번째 줄 고치기' })).toBeVisible()
  // 고르기 칸은 엔진이 읽은 것 그대로 (제안으로 미리 채우지 않는다)
  await expect(first.getByLabel('사이즈')).toHaveValue('')
  await expect(first.getByLabel('수량')).toHaveValue('')
  // 제안이 없는 줄: 제안 묶음·문장 없음
  await expect(reviewLine(page, 2).getByRole('group', { name: '2번째 줄 제안' })).toHaveCount(0)
  await expect(reviewLine(page, 2)).not.toContainText('제안:')
  // AI 꺼짐: 링크는 목록 아래
  await expect(page.getByRole('link', { name: OFFER })).toBeVisible()
  await expect(page.getByText(READING)).toHaveCount(0)
  expect(await fakeRequests(request)).toHaveLength(0)
  // 영어 상태값이 보이지 않는다 (AC-A1-24)
  await expect(page.locator('main')).not.toContainText(/RULE|LIMIT|token|model|Anthropic API|DONE|FAILED/)
  expect(outbound).toEqual([])
})

test('AC-A1-20 @assist: [이대로 주문]은 제안 값으로 바로잡기 하나 — 두 번 눌러도 하나, 결과 1등·줄 사라짐', async ({ page }) => {
  const { b, date } = await assistWorld(page)
  await chat(page, b, '김철수', '반바지 미디엄')
  await chat(page, b, '이영희', '반바지')
  await waitReviews(page, b, true, 2)
  await openReviews(page, b, true)
  const accept = reviewLine(page, 1).getByRole('button', { name: '1번째 줄 이대로 주문' })
  await accept.click()
  // 누르는 동안 그 줄의 버튼이 잠긴다
  await expect(accept).toBeDisabled()
  await accept.click({ force: true }).catch(() => undefined)
  await expect(page.getByRole('list', { name: '보낸 결과' })).toContainText('1등')
  await expect(reviewList(page).getByRole('listitem')).toHaveCount(1)
  const resolved = (await history(page, date, true)).filter((e) => e.type === 'host.resolveReview')
  expect(resolved).toHaveLength(1)
  expect(resolved[0]!.fields['no']).toBe(21)
  expect(resolved[0]!.fields['qty']).toBe(1)
  expect(resolved[0]!.fields['options']).toEqual({ 사이즈: 'M' })
  expect(resolved[0]!.fields).not.toHaveProperty('source')
})

test('AC-A1-20 @assist: [고치기]는 칸만 제안 값으로 — 요청 없음, 고친 뒤 "주문으로"를 눌러야 나간다', async ({ page }) => {
  const { b, date } = await assistWorld(page)
  await chat(page, b, '김철수', '반바지 미디엄')
  await waitReviews(page, b, true, 1)
  await openReviews(page, b, true)
  const line = reviewLine(page, 1)
  const before = (await history(page, date, true)).length
  await line.getByRole('button', { name: '1번째 줄 고치기' }).click()
  await expect(line.getByLabel('상품')).toHaveValue(`${b}/21`)
  await expect(line.getByLabel('사이즈')).toHaveValue('M')
  await expect(line.getByLabel('수량')).toHaveValue('1')
  expect((await history(page, date, true)).length).toBe(before)
  await line.getByLabel('사이즈').selectOption('L')
  await line.getByLabel('수량').fill('2')
  await line.getByRole('button', { name: '1번째 줄 주문으로' }).click()
  await expect(page.getByRole('list', { name: '보낸 결과' })).toContainText('1등')
  const resolved = (await history(page, date, true)).filter((e) => e.type === 'host.resolveReview')
  expect(resolved).toHaveLength(1)
  expect(resolved[0]!.fields['options']).toEqual({ 사이즈: 'L' })
  expect(resolved[0]!.fields['qty']).toBe(2)
})

test('AC-A1-02 @assist: 일시 중지하면 제안이 사라지고 다시 공개하면 보인다 · 별칭 미디움을 지우면 규칙 제안도 사라진다', async ({ page }) => {
  const { b } = await assistWorld(page)
  await chat(page, b, '김철수', '반바지 미디엄')
  await waitReviews(page, b, true, 1)
  await openReviews(page, b, true)
  const group = reviewLine(page, 1).getByRole('group', { name: '1번째 줄 제안' })
  await expect(group).toBeVisible()
  expect((await writeEvent(page, { type: 'product.hold', b, no: 21 })).status).toBeLessThan(300)
  await expect.poll(async () => (await reviewsWithSuggestion(page, b))[0]?.suggestion ?? null).toBeNull()
  await page.reload()
  await expect(reviewList(page).getByRole('listitem')).toHaveCount(1)
  await expect(group).toHaveCount(0)
  expect((await writeEvent(page, { type: 'product.open', b, no: 21 })).status).toBeLessThan(300)
  await page.reload()
  await expect(group).toContainText('제안: 21번 반바지 M 1개')
  const upd = await writeEvent(page, { type: 'product.update', b, no: 21, options: [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M' }, { label: 'L' }] }] })
  expect(upd.status, JSON.stringify(upd.body)).toBeLessThan(300)
  await expect.poll(async () => (await reviewsWithSuggestion(page, b))[0]?.suggestion ?? null).toBeNull()
  await page.reload()
  await expect(reviewList(page).getByRole('listitem')).toHaveCount(1)
  await expect(group).toHaveCount(0)
})

test('AC-A1-22 @assist: 설정 칸 — 꺼짐(고지·동의 전엔 켜기 못 함) → 켜기 → "켜져 있어요 · 오늘 0번" → [끄기] 확인 창 없이 → 다시 켤 때 다시 동의', async ({ page }) => {
  await assistWorld(page)
  let dialogs = 0
  page.on('dialog', (d) => { dialogs += 1; void d.dismiss() })
  await page.goto('/settings')
  const region = page.getByRole('region', { name: 'AI 제안' })
  await expect(region).toBeVisible()
  await expect(region).toContainText(NOTICE)
  const sw = region.getByRole('switch', { name: SWITCH })
  const consent = region.getByLabel(CONSENT)
  await expect(sw).toHaveAttribute('aria-checked', 'false')
  await expect(sw).toBeDisabled()
  await consent.check()
  await expect(sw).toBeEnabled()
  await sw.click()
  await expect(region.getByRole('status')).toHaveText(ON(0, 3))
  expect((await assistSettingsApi(page)).enabled).toBe(true)
  await region.getByRole('button', { name: '끄기' }).click()
  await expect(region.getByRole('switch', { name: SWITCH })).toHaveAttribute('aria-checked', 'false')
  expect(dialogs).toBe(0)
  const off = await assistSettingsApi(page)
  expect(off.enabled).toBe(false)
  // 다시 켤 때 동의를 다시 받는다
  await expect(region.getByLabel(CONSENT)).not.toBeChecked()
  await expect(region.getByRole('switch', { name: SWITCH })).toBeDisabled()
  // 휴대폰 폭에서도 넘치지 않는다
  await page.setViewportSize({ width: 390, height: 844 })
  await noHorizontalScroll(page)
})

test('AC-A1-21·03·31 @assist: 켜고 화면 열기 → 가짜 AI 요청 1개·"AI가 읽음" 제안 · 실시간으로 다시 읽어도 더 부르지 않음 · 다시 열면 요청 0개(캐시)', async ({ page, request }) => {
  const { b, outbound } = await assistWorld(page)
  await enableAssistApi(page)
  await chat(page, b, '김철수', '반바지 미디엄') // 규칙으로 풀림 — 보내지 않는다
  await chat(page, b, '이영희', '반바지 엠사이즈')
  await chat(page, b, '박민수', '반바지 엠사이즈') // 같은 글 — 한 번만
  await chat(page, b, '최지우', '반바지 큰거요')
  await fakeLlm(request, '/_fake/answers', { text: '반바지 큰거요', suggestion: { no: 21, options: { 사이즈: 'L' }, qty: 1 } })
  await fakeLlm(request, '/_fake/answers', { text: '반바지 엠사이즈', suggestion: { no: 21, options: { 사이즈: 'M' }, qty: 1 } })
  await waitReviews(page, b, true, 4)
  const calls = countSuggestCalls(page)
  await openReviews(page, b, true)
  await expect(reviewLine(page, 2).getByRole('group', { name: '2번째 줄 제안' })).toContainText('제안: 21번 반바지 M 1개')
  await expect(reviewLine(page, 2).getByRole('group', { name: '2번째 줄 제안' }).getByText(SOURCE_AI, { exact: true })).toBeVisible()
  await expect(reviewLine(page, 3).getByRole('group', { name: '3번째 줄 제안' })).toContainText('제안: 21번 반바지 M 1개')
  await expect(reviewLine(page, 4).getByRole('group', { name: '4번째 줄 제안' })).toContainText('제안: 21번 반바지 L 1개')
  await expect(reviewLine(page, 1).getByRole('group', { name: '1번째 줄 제안' }).getByText(SOURCE_RULE, { exact: true })).toBeVisible()
  await expect(page.getByText(READING)).toHaveCount(0)
  const reqs = await fakeRequests(request)
  expect(reqs).toHaveLength(1)
  expect(sentTexts(reqs[0]!).sort()).toEqual(['반바지 엠사이즈', '반바지 큰거요'].sort())
  expect(calls.count()).toBe(1)
  // 실시간 알림으로 목록이 다시 읽혀도 더 부르지 않는다
  await chat(page, b, '한가람', '반바지 뭐뭐')
  await expect(reviewList(page).getByRole('listitem')).toHaveCount(5)
  expect(calls.count()).toBe(1)
  expect(await fakeRequests(request)).toHaveLength(1)
  // 화면을 떠났다 다시 열면 요청 한 번 더 — 새 항목 하나만 묻는다
  await page.goto('/settings')
  await openReviews(page, b, true)
  await expect.poll(() => calls.count()).toBe(2)
  await expect.poll(async () => (await fakeRequests(request)).length).toBe(2)
  expect(sentTexts((await fakeRequests(request))[1]!)).toEqual(['반바지 뭐뭐'])
  // 한 번 더 열면 보낼 것이 없다 — 요청 0개, 사용량 그대로
  await page.reload()
  await expect.poll(() => calls.count()).toBe(3)
  await expect(reviewLine(page, 2).getByRole('group', { name: '2번째 줄 제안' })).toBeVisible()
  expect(await fakeRequests(request)).toHaveLength(2)
  expect((await assistSettingsApi(page)).usedToday).toBe(2)
  expect(outbound).toEqual([])
})

test('AC-A1-05·31 @assist: 보낸 본문에 닉네임·전화번호·가격·재고·가게 이름이 없다', async ({ page, request }) => {
  const { b, seller } = await assistWorld(page)
  await enableAssistApi(page)
  await chat(page, b, '홍길동', '반바지 엠사이즈01012345678')
  await chat(page, b, '홍길동', '반바지 010-1234-5678')
  await waitReviews(page, b, true, 2)
  await openReviews(page, b, true)
  await expect.poll(async () => (await fakeRequests(request)).length).toBe(1)
  const [req] = await fakeRequests(request)
  expect(sentTexts(req!).sort()).toEqual(['반바지 ***', '반바지 엠사이즈***'].sort())
  const body = JSON.stringify(req!.body)
  for (const bad of ['홍길동', '010', '1234-5678', '15000', '15,000', seller.shopName, seller.loginId, b]) expect(body, bad).not.toContain(bad)
  expect(req!.body.temperature).toBe(0)
  expect(req!.body.max_tokens).toBeLessThanOrEqual(1024)
  expect(req!.headers['x-api-key']).toBeTruthy()
})

test('AC-A1-21·06 @assist: 가짜 AI 5xx → "AI 제안을 지금 받지 못했어요. 직접 골라 주세요." · 목록·"주문 아님"은 그대로 쓴다', async ({ page, request }) => {
  const { b, date } = await assistWorld(page)
  await enableAssistApi(page)
  await chat(page, b, '김철수', '반바지 미디엄')
  await chat(page, b, '이영희', '반바지 엠사이즈')
  await waitReviews(page, b, true, 2)
  await fakeLlm(request, '/_fake/fail', { kind: 'status', status: 503 })
  await openReviews(page, b, true)
  await expect(page.getByRole('status').filter({ hasText: FAILED })).toBeVisible()
  await expect(page.locator('main')).not.toContainText(/503|HTTP|model|claude/i)
  // 규칙 제안은 그대로
  await expect(reviewLine(page, 1).getByRole('group', { name: '1번째 줄 제안' })).toContainText(SOURCE_RULE)
  await expect(reviewLine(page, 2).getByRole('group', { name: '2번째 줄 제안' })).toHaveCount(0)
  await reviewLine(page, 2).getByRole('button', { name: '2번째 줄 주문 아님' }).click()
  await expect(reviewList(page).getByRole('listitem')).toHaveCount(1)
  await expect.poll(async () => (await history(page, date, true)).filter((e) => e.type === 'host.dismissReview').length).toBe(1)
})

test('AC-A1-21 @assist: AI가 느려도 "AI가 읽는 중이에요…" 동안 목록·"주문으로"를 바로 쓴다, 끝나면 문장이 사라진다', async ({ page, request }) => {
  const { b } = await assistWorld(page)
  await enableAssistApi(page)
  await chat(page, b, '김철수', '반바지')
  await chat(page, b, '이영희', '반바지 엠사이즈')
  await waitReviews(page, b, true, 2)
  await fakeLlm(request, '/_fake/answers', { text: '반바지 엠사이즈', suggestion: { no: 21, options: { 사이즈: 'M' }, qty: 1 } })
  await fakeLlm(request, '/_fake/fail', { kind: 'slow', delayMs: 1500 })
  await openReviews(page, b, true)
  await expect(page.getByText(READING)).toBeVisible()
  const first = reviewLine(page, 1)
  await first.getByLabel('사이즈').selectOption('S')
  await first.getByLabel('수량').fill('1')
  await expect(first.getByRole('button', { name: '1번째 줄 주문으로' })).toBeEnabled()
  await expect(page.getByText(READING)).toHaveCount(0)
  await expect(reviewLine(page, 2).getByRole('group', { name: '2번째 줄 제안' })).toContainText(SOURCE_AI)
})

test('AC-A1-08·21 @assist: 꺼짐이면 화면을 열어도 가짜 AI 요청 0개 — 목록 아래 링크로 설정의 AI 제안 칸', async ({ page, request }) => {
  const { b } = await assistWorld(page)
  await chat(page, b, '이영희', '반바지 엠사이즈')
  await waitReviews(page, b, true, 1)
  await openReviews(page, b, true)
  const link = page.getByRole('link', { name: OFFER })
  await expect(link).toBeVisible()
  expect(await fakeRequests(request)).toHaveLength(0)
  await link.click()
  await expect(page.getByRole('region', { name: 'AI 제안' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'AI 제안' }).getByRole('switch', { name: SWITCH })).toBeVisible()
  expect(await fakeRequests(request)).toHaveLength(0)
})

test('AC-A1-04·21 @assist: 하루 상한 3에 닿으면 "오늘 AI 제안을 다 썼어요(하루 3번)…" · 규칙 제안만 · 가짜 AI 요청이 늘지 않는다', async ({ page, request }) => {
  const { b } = await assistWorld(page)
  await enableAssistApi(page)
  await chat(page, b, '김철수', '반바지 미디엄')
  const words = ['반바지 엠사이즈', '반바지 큰거요', '반바지 작은거']
  for (const [i, text] of words.entries()) {
    await chat(page, b, `시청자${String(i)}`, text)
    await waitReviews(page, b, true, i + 2)
    await openReviews(page, b, true)
    await expect.poll(async () => (await fakeRequests(request)).length).toBe(i + 1)
    await expect(page.getByText(READING)).toHaveCount(0)
  }
  await chat(page, b, '시청자9', '반바지 중간거')
  await waitReviews(page, b, true, 5)
  await openReviews(page, b, true)
  await expect(page.getByRole('status').filter({ hasText: LIMIT(3) })).toBeVisible()
  expect(await fakeRequests(request)).toHaveLength(3)
  await expect(reviewLine(page, 1).getByRole('group', { name: '1번째 줄 제안' })).toContainText(SOURCE_RULE)
  await page.goto('/settings')
  await expect(page.getByRole('region', { name: 'AI 제안' }).getByRole('status')).toHaveText(ON(3, 3))
})

test('AC-A1-20 @assist: 휴대폰 폭 390px — 제안 줄이 넘치지 않고 버튼 높이 44px·글 16px 이상, 상품 이름 <b>는 글자로', async ({ page }) => {
  const { b } = await assistWorld(page, { productName: '<b>반바지</b>' })
  await chat(page, b, '김철수', '<b>반바지</b> 미디엄')
  const items = await waitReviews(page, b, true, 1)
  expect(items[0]?.reason).toBe('UNKNOWN_WORD')
  await page.setViewportSize({ width: 390, height: 844 })
  await openReviews(page, b, true)
  const group = reviewLine(page, 1).getByRole('group', { name: '1번째 줄 제안' })
  await expect(group).toContainText('제안: 21번 <b>반바지</b> M 1개')
  await expect(group.locator('b')).toHaveCount(0)
  await noHorizontalScroll(page)
  for (const name of ['1번째 줄 이대로 주문', '1번째 줄 고치기']) {
    const button = group.getByRole('button', { name })
    const box = await button.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
    const size = await button.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize))
    expect(size).toBeGreaterThanOrEqual(16)
  }
  const source = await group.getByText(/비슷한 글자로 찾음/).evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize))
  expect(source).toBeGreaterThanOrEqual(16)
})

test('AC-A1-07 @assist: 화면 열기·AI 제안·켜기/끄기는 기록을 늘리지 않는다', async ({ page, request }) => {
  const { b, date } = await assistWorld(page)
  await chat(page, b, '이영희', '반바지 엠사이즈')
  await chat(page, b, '김철수', '반바지 미디엄')
  await waitReviews(page, b, true, 2)
  const before = (await history(page, date, true)).length
  await fakeLlm(request, '/_fake/answers', { text: '반바지 엠사이즈', suggestion: { no: 21, options: { 사이즈: 'M' }, qty: 1 } })
  await enableAssistApi(page)
  await openReviews(page, b, true)
  await expect.poll(async () => (await fakeRequests(request)).length).toBe(1)
  await expect(reviewLine(page, 1).getByRole('group', { name: '1번째 줄 제안' })).toContainText(SOURCE_AI)
  await page.goto('/settings')
  await page.getByRole('region', { name: 'AI 제안' }).getByRole('button', { name: '끄기' }).click()
  await expect(page.getByRole('region', { name: 'AI 제안' }).getByRole('switch', { name: SWITCH })).toBeVisible()
  expect((await history(page, date, true)).length).toBe(before)
  // 끈 뒤: 보낼 것이 새로 생겨도 외부 호출 0번 (받은 캐시 제안은 보여도 된다)
  await chat(page, b, '최지우', '반바지 큰거요')
  await waitReviews(page, b, true, 3)
  const calls = countSuggestCalls(page)
  await openReviews(page, b, true)
  await expect(reviewList(page).getByRole('listitem')).toHaveCount(3)
  await expect.poll(() => calls.count()).toBe(1)
  await expect(page.getByRole('link', { name: OFFER })).toBeVisible()
  expect(await fakeRequests(request)).toHaveLength(1)
  expect((await history(page, date, true)).length).toBe(before + 1)
})
