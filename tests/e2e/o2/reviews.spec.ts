// O2 확인 필요 목록 (AC-O2-32~39) — test-e2e. 기대값은 acceptance.md·D-O2-07·G-ENG-O2-01에서 정했다(구현을 보고 정하지 않음).
// 채팅은 리허설 방송에서만 넣을 수 있어 옵션 리허설 방송을 쓴다(API saleMode: OPTIONS).
import { expect, test, type Page } from '@playwright/test'
import {
  SIZES,
  buyerName,
  chat,
  history,
  login,
  noHorizontalScroll,
  openOptionBroadcast,
  openReviews,
  oscope,
  productOf,
  registerOptions,
  reviewLine,
  reviewList,
  waitClaims,
  waitReviews,
  writeEvent,
} from './support.ts'

test.beforeEach(async ({ page }) => {
  await login(page)
})

/** 확인 필요 시험 재료: 21 반바지(S·M·L, L 2개) */
async function shorts(page: Page): Promise<{ b: string; date: string }> {
  const made = await openOptionBroadcast(page)
  await registerOptions(page, made.b, { no: 21, name: '반바지', price: 15000, options: SIZES, stocks: { L: 2 } })
  return made
}

test('AC-O2-33: 원래 순서·미리 채움(읽은 것만, 수량 빈 칸)·남은 수량·선택지 하나뿐인 항목', async ({ page }) => {
  const { b } = await shorts(page)
  await chat(page, b, '김철수', '반바지')
  await chat(page, b, '이영희', '반바지 L 3개')
  // 31 수건을 판매 중으로 등록하면 지금 상품이 31이 된다 — 15초 안의 상품 이름 없는 댓글은 확인 필요
  await registerOptions(page, b, { no: 31, name: '수건', price: 8000, options: [{ name: '색상', choices: [{ label: '흰색' }, { label: '검정색' }] }, { name: '크기', choices: [{ label: '대형' }, { label: '소형' }] }] })
  await chat(page, b, '박민수', '흰색 대형 2개')
  await registerOptions(page, b, { no: 41, name: '과자', price: 3000, options: [{ name: '맛', choices: [{ label: '초코' }] }, { name: '크기', choices: [{ label: '대' }, { label: '소' }] }] })
  await chat(page, b, '최지우', '과자')
  const items = await waitReviews(page, b, true, 4)
  expect(items.map((x) => x.reason)).toEqual(['OPTION_MISSING', 'STOCK_SHORT', 'FOCUS_CHANGED', 'OPTION_MISSING'])

  await openReviews(page, b, true)
  await expect(reviewList(page).getByRole('listitem')).toHaveCount(4)
  const first = reviewLine(page, 1)
  await expect(first).toContainText('김철수')
  await expect(first).toContainText('반바지')
  await expect(first).toContainText('옵션 빠짐')
  await expect(first.getByLabel('상품')).toHaveValue(`${b}/21`)
  await expect(first.getByLabel('사이즈')).toHaveValue('')
  await expect(first.getByLabel('수량')).toHaveValue('')
  await expect(first.getByRole('button', { name: '1번째 줄 주문으로' })).toBeDisabled()

  const second = reviewLine(page, 2)
  await expect(second).toContainText('이영희')
  await expect(second).toContainText('남은 수량 부족')
  await expect(second.getByLabel('상품')).toHaveValue(`${b}/21`)
  await expect(second.getByLabel('사이즈')).toHaveValue('L')
  await expect(second.getByLabel('수량')).toHaveValue('3')
  await expect(second.getByText('남은 2개', { exact: true })).toBeVisible()

  const third = reviewLine(page, 3)
  await expect(third).toContainText('지금 상품이 막 바뀜')
  await expect(third.getByLabel('상품')).toHaveValue(`${b}/31`)
  await expect(third.getByLabel('색상')).toHaveValue('흰색')
  await expect(third.getByLabel('크기')).toHaveValue('대형')
  await expect(third.getByLabel('수량')).toHaveValue('2')

  const fourth = reviewLine(page, 4)
  await expect(fourth.getByLabel('상품')).toHaveValue(`${b}/41`)
  await expect(fourth.getByLabel('맛')).toHaveValue('초코')
  await expect(fourth.getByLabel('크기')).toHaveValue('')
  // 영어 사유 이름이 보이지 않는다 (AC-O2-52)
  await expect(page.locator('main')).not.toContainText(/OPTION_|STOCK_SHORT|FOCUS_CHANGED|UNKNOWN_WORD/)
})

test('AC-O2-34: 후보 제안 "혹시: XL?"는 칸만 채우고 아무것도 보내지 않는다', async ({ page }) => {
  const { b, date } = await openOptionBroadcast(page)
  await registerOptions(page, b, { no: 21, name: '반바지', price: 15000, options: [{ name: '사이즈', choices: [{ label: 'S' }, { label: 'M' }, { label: 'L' }, { label: 'XL' }] }] })
  await chat(page, b, '김철수', '반바지 XXL')
  const [item] = await waitReviews(page, b, true, 1)
  expect(item?.reason).toBe('UNKNOWN_WORD')
  await openReviews(page, b, true)
  const line = reviewLine(page, 1)
  const before = (await history(page, date, true)).length
  await line.getByRole('button', { name: '혹시: XL?' }).click()
  await expect(line.getByLabel('사이즈')).toHaveValue('XL')
  expect(await line.getByRole('button', { name: /^혹시:/ }).count()).toBeLessThanOrEqual(3)
  expect((await history(page, date, true)).length).toBe(before)
})

test('AC-O2-35: 한 줄 "주문으로"는 고르기 전엔 막히고, 대기 띠 뒤에 보내 1등 · 다른 줄 "주문 아님"은 지워지고 되돌리면 기록 없음', async ({ page }) => {
  const { b, date } = await shorts(page)
  await chat(page, b, '김철수', '반바지')
  await chat(page, b, '이영희', '반바지')
  await chat(page, b, '박민수', '반바지')
  await waitReviews(page, b, true, 3)
  await openReviews(page, b, true)
  const first = reviewLine(page, 1)
  const order = first.getByRole('button', { name: '1번째 줄 주문으로' })
  await expect(order).toBeDisabled()
  await first.getByLabel('사이즈').selectOption('M')
  await expect(order).toBeDisabled() // 수량이 아직 빈 칸
  await first.getByLabel('수량').fill('1')
  await expect(order).toBeEnabled()
  const undoRegion = page.getByRole('region', { name: '보내기 전 조치' })

  // 되돌리면 아무것도 기록되지 않는다
  const before = (await history(page, date, true)).filter((e) => e.type === 'host.resolveReview' || e.type === 'host.dismissReview').length
  await reviewLine(page, 3).getByRole('button', { name: '3번째 줄 주문 아님' }).click()
  await undoRegion.getByRole('button', { name: /되돌리기/ }).first().click()
  await expect(undoRegion.getByRole('button', { name: /되돌리기/ })).toHaveCount(0)
  await expect(reviewList(page).getByRole('listitem')).toHaveCount(3)

  await order.click()
  await expect(undoRegion.getByRole('button', { name: /되돌리기/ })).toBeVisible()
  // 대기 중에는 보내지 않는다
  expect((await history(page, date, true)).filter((e) => e.type === 'host.resolveReview').length).toBe(0)
  await expect(page.getByRole('list', { name: '보낸 결과' })).toContainText('1등')
  await expect(reviewList(page).getByRole('listitem')).toHaveCount(2)

  await reviewLine(page, 1).getByRole('button', { name: '1번째 줄 주문 아님' }).click()
  await expect(reviewList(page).getByRole('listitem')).toHaveCount(1)
  const log = (await history(page, date, true)).filter((e) => e.type === 'host.resolveReview' || e.type === 'host.dismissReview')
  expect(log.map((e) => e.type)).toEqual(['host.resolveReview', 'host.dismissReview'])
  expect(log.length - before).toBe(2)
})

test('AC-O2-36: 여러 줄 한 번에 — 원래 순서로 기록, 대기 1번·1등·수량 모자람 줄은 남고 고쳐 다시 보내면 1등 ×2 (G-ENG-O2-01)', async ({ page }) => {
  const { b, date } = await shorts(page)
  await chat(page, b, '김철수', '반바지') // m1 옵션 빠짐
  await chat(page, b, '이영희', '반바지 M') // M 1등
  await chat(page, b, '박민수', '반바지 M') // M 대기 1
  await chat(page, b, '정수민', '반바지 엑스') // m2 모르는 말
  await chat(page, b, '최지우', '반바지 L 3개') // m5 남은 수량 부족
  await chat(page, b, '한가람', '반바지 뭐뭐') // m6 모르는 말
  const items = await waitReviews(page, b, true, 4)
  expect(items.map((x) => x.reason)).toEqual(['OPTION_MISSING', 'UNKNOWN_WORD', 'STOCK_SHORT', 'UNKNOWN_WORD'])
  await openReviews(page, b, true)
  const [l1, l2, l3, l4] = [reviewLine(page, 1), reviewLine(page, 2), reviewLine(page, 3), reviewLine(page, 4)]
  await l1.getByLabel('사이즈').selectOption('M')
  await l1.getByLabel('수량').fill('1')
  await l2.getByLabel('사이즈').selectOption('S')
  await l2.getByLabel('수량').fill('1')
  // m6은 따로 "주문 아님"
  await l4.getByRole('button', { name: '4번째 줄 주문 아님' }).click()
  await expect(reviewList(page).getByRole('listitem')).toHaveCount(3)
  // m5를 먼저 고른다 (화면 고른 순서와 상관없이 원래 순서로)
  await l3.getByRole('checkbox', { name: '3번째 줄 고르기' }).check()
  await l1.getByRole('checkbox', { name: '1번째 줄 고르기' }).check()
  await l2.getByRole('checkbox', { name: '2번째 줄 고르기' }).check()
  await page.getByRole('button', { name: '고른 줄 주문으로' }).click()

  const results = page.getByRole('list', { name: '보낸 결과' })
  await expect(results).toContainText('김철수')
  await expect(results.getByText(/김철수.*대기 1번/)).toBeVisible()
  await expect(results.getByText(/정수민.*1등/)).toBeVisible()
  await expect(reviewList(page).getByRole('listitem')).toHaveCount(1)
  const left = reviewLine(page, 1)
  await expect(left).toContainText('최지우')
  await expect(left.getByText('그대로 두었어요 — 남은 수량이 모자라요')).toBeVisible()
  await expect(left.getByText('남은 2개', { exact: true })).toBeVisible()

  const resolves = (await history(page, date, true)).filter((e) => e.type === 'host.resolveReview')
  expect(resolves.map((e) => String(e.fields['item']))).toEqual([items[0]!.item, items[1]!.item, items[2]!.item])

  const s = await oscope(page, date, true)
  const m = (await productOf(page, date, true, b, 21)).variants.find((v) => v.text === 'M')!
  expect(m.waitlist.map((id) => buyerName(s, id))).toEqual(['김철수', '박민수'])

  // 수량을 2로 고쳐 다시 보내면 1등
  await left.getByLabel('수량').fill('2')
  await left.getByRole('button', { name: '1번째 줄 주문으로' }).click()
  await expect(results.getByText(/최지우.*1등/)).toBeVisible()
  await expect(reviewList(page).getByRole('listitem')).toHaveCount(0)
  const lClaims = (await waitClaims(page, date, true, b, 5)).filter((c) => c.variant === 'L')
  expect(lClaims.map((c) => [c.status, c.qty, c.amount])).toEqual([['CONFIRMED', 2, 30000]])
  // 콘솔 L 1등 "최지우 ×2"
  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await page.getByRole('button', { name: '변형 펼치기 — 21번' }).click()
  await expect(page.getByRole('list', { name: '변형 — 21번' }).getByRole('listitem').filter({ hasText: /^L/ })).toContainText('최지우 ×2')
})

test('AC-O2-37: 빈 칸이 있는 줄을 고르면 "고른 줄 주문으로"가 막히고 몇 번째 줄인지 말한다', async ({ page }) => {
  const { b } = await shorts(page)
  await chat(page, b, '김철수', '반바지 L 3개')
  await chat(page, b, '이영희', '반바지')
  await waitReviews(page, b, true, 2)
  await openReviews(page, b, true)
  await reviewLine(page, 1).getByLabel('수량').fill('1')
  await reviewLine(page, 1).getByRole('checkbox', { name: '1번째 줄 고르기' }).check()
  await reviewLine(page, 2).getByRole('checkbox', { name: '2번째 줄 고르기' }).check()
  await expect(page.getByRole('button', { name: '고른 줄 주문으로' })).toBeDisabled()
  await expect(page.getByText('2번째 줄에 빈 칸이 있어요')).toBeVisible()
  await expect(page.getByRole('button', { name: '고른 줄 주문 아님' })).toBeEnabled()
})

test('AC-O2-38: 아무 일도 없었던 줄은 까닭과 함께 남는다 — 판매 중 아님·같은 옵션 이미 찜', async ({ page }) => {
  const { b, date } = await shorts(page)
  await registerOptions(page, b, { no: 22, name: '치마', price: 12000, options: SIZES })
  await chat(page, b, '김철수', '반바지 M') // 김철수 M 1등
  await chat(page, b, '김철수', '반바지 사이즈') // 김철수 확인 필요 (옵션 빠짐/모르는 말)
  await chat(page, b, '이영희', '치마')
  await waitReviews(page, b, true, 2)
  // 22를 일시 중지한다
  const paused = await writeEvent(page, { type: 'product.hold', b, no: 22 })
  expect(paused.status, JSON.stringify(paused.body)).toBeLessThan(300)
  await openReviews(page, b, true)
  const l1 = reviewLine(page, 1)
  const l2 = reviewLine(page, 2)
  await l1.getByLabel('사이즈').selectOption('M')
  await l1.getByLabel('수량').fill('1')
  await l2.getByLabel('사이즈').selectOption('S')
  await l2.getByLabel('수량').fill('1')
  await l1.getByRole('button', { name: '1번째 줄 주문으로' }).click()
  await expect(l1.getByText('그대로 두었어요 — 이 구매자가 같은 옵션을 이미 찜했어요')).toBeVisible()
  await l2.getByRole('button', { name: '2번째 줄 주문으로' }).click()
  await expect(l2.getByText('그대로 두었어요 — 판매 중인 상품이 아니에요')).toBeVisible()
  await expect(reviewList(page).getByRole('listitem')).toHaveCount(2)
  await expect(l1.getByText('그대로 두었어요 — 이 구매자가 같은 옵션을 이미 찜했어요')).toHaveAttribute('data-tone', 'warning')
  const resolves = (await history(page, date, true)).filter((e) => e.type === 'host.resolveReview')
  expect(resolves.length).toBe(2)
})

test('AC-O2-32: 콘솔 두 개와 /reviews가 같은 방송을 보면 새 항목이 생기고 지우면 사라진다 (새로고침 없이)', async ({ page, browser }) => {
  const { b } = await shorts(page)
  const ctx = await browser.newContext({ baseURL: new URL(page.url()).origin, storageState: await page.context().storageState() })
  const consolePage = await ctx.newPage()
  await consolePage.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(consolePage.getByRole('region', { name: '지금 상품' })).toContainText('지금 상품: 21번 반바지')
  const reviewsPage = await ctx.newPage()
  await openReviews(reviewsPage, b, true)
  await expect(reviewsPage.getByText('확인할 댓글이 없어요.')).toBeVisible()

  await chat(page, b, '김철수', '반바지')
  await expect(reviewList(reviewsPage).getByRole('listitem')).toHaveCount(1)
  await expect(consolePage.getByRole('region', { name: '알림' }).getByRole('button', { name: '확인 필요 1건' })).toBeVisible()
  await expect(page.getByRole('region', { name: '알림' }).getByRole('button', { name: '확인 필요 1건' })).toBeVisible()

  await reviewLine(reviewsPage, 1).getByRole('button', { name: '1번째 줄 주문 아님' }).click()
  await expect(reviewsPage.getByText('확인할 댓글이 없어요.')).toBeVisible()
  await expect(consolePage.getByRole('button', { name: /^확인 필요 \d+건$/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^확인 필요 \d+건$/ })).toHaveCount(0)

  // 지금 상품이 바뀌어도 다른 콘솔에 반영된다
  await registerOptions(page, b, { no: 22, name: '치마', price: 12000, options: SIZES, status: 'READY' })
  await page.getByRole('button', { name: '지금 상품으로 — 22번' }).click()
  await expect(consolePage.getByRole('region', { name: '지금 상품' })).toContainText('지금 상품: 22번 치마')
  await ctx.close()
})

test('AC-O2-39: 휴대폰 375px /reviews — 가로 스크롤 없음·글자 16px·누르는 곳 44px·숫자 키패드·세로로 쌓임', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const { b } = await shorts(page)
  await registerOptions(page, b, { no: 31, name: '수건', price: 8000, options: [{ name: '색상', choices: [{ label: '흰색' }, { label: '검정색' }] }, { name: '크기', choices: [{ label: '대형' }, { label: '소형' }] }, { name: '두께', choices: [{ label: '얇음' }, { label: '두꺼움' }] }] })
  for (const [nick, text] of [['김철수', '반바지'], ['이영희', '반바지 L 3개'], ['박민수', '수건'], ['최지우', '수건 흰색'], ['정수민', '반바지 엑스']] as const) await chat(page, b, nick, text)
  await waitReviews(page, b, true, 5)
  await openReviews(page, b, true)
  await expect(reviewList(page).getByRole('listitem')).toHaveCount(5)
  await noHorizontalScroll(page)
  const third = reviewLine(page, 3)
  for (const name of ['상품', '색상', '크기', '두께', '수량']) await expect(third.getByLabel(name)).toBeVisible()
  await expect(third.getByLabel('수량')).toHaveAttribute('inputmode', 'numeric')
  // 고르기 칸은 세로로 쌓인다
  const boxes = await Promise.all(['상품', '색상', '크기'].map(async (name) => (await third.getByLabel(name).boundingBox())!))
  expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height - 1)
  expect(boxes[2]!.y).toBeGreaterThan(boxes[1]!.y + boxes[1]!.height - 1)
  const controls = page.locator('main').locator('button:visible, select:visible, input:visible')
  const sizes = await controls.evaluateAll((els) => els.map((el) => {
    const target = el instanceof HTMLInputElement && el.type === 'checkbox' ? (el.closest('label') ?? el) : el
    const r = target.getBoundingClientRect()
    return { name: el.getAttribute('aria-label') ?? el.textContent ?? '', h: r.height, w: r.width, font: target === el ? parseFloat(getComputedStyle(el).fontSize) : parseFloat(getComputedStyle(target).fontSize) }
  }))
  for (const s of sizes) {
    expect(s.h, `${s.name} 높이`).toBeGreaterThanOrEqual(44)
    expect(s.w, `${s.name} 폭`).toBeGreaterThanOrEqual(44)
    expect(s.font, `${s.name} 글자`).toBeGreaterThanOrEqual(16)
  }
  const texts = await page.locator('.review-row').evaluateAll((els) => els.flatMap((el) => [...el.querySelectorAll('p, span, strong')].map((x) => parseFloat(getComputedStyle(x).fontSize))))
  for (const f of texts) expect(f).toBeGreaterThanOrEqual(16)
  // 손가락으로 눌린다 (tap)
  await reviewLine(page, 5).getByRole('button', { name: '5번째 줄 주문 아님' }).click()
  await expect(reviewList(page).getByRole('listitem')).toHaveCount(4)
})
