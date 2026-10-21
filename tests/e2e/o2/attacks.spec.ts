// O2 흐름 깨뜨리기 — 이스케이프(AC-O2-51)·묶음 보내기 중 네트워크 끊김·두 기기 동시 바로잡기·낱말(AC-O2-52) — test-e2e.
import { expect, test } from '@playwright/test'
import {
  SIZES,
  chat,
  history,
  login,
  openOptionBroadcast,
  openReviews,
  oscope,
  registerOptions,
  reviewLine,
  reviewList,
  waitClaims,
  waitReviews,
} from './support.ts'

test.beforeEach(async ({ page }) => {
  await login(page)
})

test('AC-O2-51: 항목 이름·선택지·별칭·닉네임·댓글의 HTML은 글자 그대로 (옵션 추가 창·변형 표·확인 필요·채팅 패널·상세)', async ({ page }) => {
  const dialogs: string[] = []
  page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss() })
  const { b, date } = await openOptionBroadcast(page)
  const evil = '<img src=x>'
  const bold = '"><b>굵게'
  await registerOptions(page, b, { no: 21, name: '반바지', price: 15000, aliases: ['&lt;별칭'], options: [{ name: bold, choices: [{ label: evil }, { label: 'M' }] }] })
  await chat(page, b, `<b>닉</b>`, '반바지')
  await chat(page, b, '홍길동', '반바지 <img>')
  await waitReviews(page, b, true, 1)
  // 콘솔: 변형 표·채팅 패널
  await page.getByRole('button', { name: '변형 펼치기 — 21번' }).click()
  await expect(page.getByRole('list', { name: '변형 — 21번' })).toContainText(evil)
  await expect(page.getByRole('list', { name: '채팅 메시지' })).toContainText('<b>닉</b>')
  await expect(page.getByRole('list', { name: '채팅 메시지' })).toContainText('반바지 <img>')
  // 상품 상세·옵션 고치기 창
  await page.getByRole('region', { name: '상품 보드' }).getByRole('button', { name: /^21번 / }).click()
  const detail = page.getByRole('dialog', { name: /21번.*자세히/ })
  await expect(detail).toContainText('&lt;별칭')
  await expect(detail.getByRole('region', { name: `${evil} 변형` })).toBeVisible()
  await detail.getByRole('button', { name: '옵션 고치기' }).click()
  await expect(page.getByRole('dialog', { name: '21번 옵션 고치기' }).getByRole('region', { name: '옵션별 재고' })).toContainText(evil)
  expect(await page.locator('img[src="x"], b:text("굵게"), b:text("닉")').count()).toBe(0)
  // 확인 필요 목록
  await openReviews(page, b, true)
  await expect(reviewList(page)).toContainText('<b>닉</b>')
  await expect(reviewLine(page, 1).getByLabel(bold)).toBeVisible()
  expect(await page.locator('main img, b:text("닉")').count()).toBe(0)
  expect(dialogs).toEqual([])
  expect(date).toBeTruthy()
})

test('AC-O2-36 깨뜨리기: 묶음 보내기 중 둘째 요청이 끊겨도 다시 보내 원래 순서로 한 번씩만 기록된다', async ({ page }) => {
  const { b, date } = await openOptionBroadcast(page)
  await registerOptions(page, b, { no: 21, name: '반바지', price: 15000, options: SIZES, stocks: { S: 3, M: 3, L: 3 } })
  await chat(page, b, '김철수', '반바지')
  await chat(page, b, '이영희', '반바지')
  await chat(page, b, '박민수', '반바지')
  const items = await waitReviews(page, b, true, 3)
  await openReviews(page, b, true)
  for (const n of [1, 2, 3]) {
    await reviewLine(page, n).getByLabel('사이즈').selectOption(['S', 'M', 'L'][n - 1]!)
    await reviewLine(page, n).getByLabel('수량').fill('1')
    await reviewLine(page, n).getByRole('checkbox', { name: `${String(n)}번째 줄 고르기` }).check()
  }
  let posts = 0
  await page.route('**/api/events', async (route) => {
    if (route.request().method() === 'POST') {
      posts += 1
      if (posts === 2) { await route.abort('internetdisconnected'); return }
    }
    await route.continue()
  })
  await page.getByRole('button', { name: '고른 줄 주문으로' }).click()
  await expect(reviewList(page).getByRole('listitem')).toHaveCount(0, { timeout: 30_000 })
  const resolves = (await history(page, date, true)).filter((e) => e.type === 'host.resolveReview')
  expect(resolves.map((e) => String(e.fields['item']))).toEqual(items.map((x) => x.item))
  const claims = await waitClaims(page, date, true, b, 3)
  expect(claims.map((c) => c.variant).sort()).toEqual(['L', 'M', 'S'])
})

test('두 기기(PC·휴대폰)가 같은 줄을 동시에 "주문으로" — 찜은 하나만, 양쪽에서 줄이 사라진다', async ({ page, browser }) => {
  const { b, date } = await openOptionBroadcast(page)
  await registerOptions(page, b, { no: 21, name: '반바지', price: 15000, options: SIZES })
  await chat(page, b, '김철수', '반바지')
  await waitReviews(page, b, true, 1)
  const ctx = await browser.newContext({ baseURL: new URL(page.url()).origin, storageState: await page.context().storageState(), viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true })
  const phone = await ctx.newPage()
  await openReviews(page, b, true)
  await openReviews(phone, b, true)
  for (const p of [page, phone]) {
    await reviewLine(p, 1).getByLabel('사이즈').selectOption('M')
    await reviewLine(p, 1).getByLabel('수량').fill('1')
  }
  await Promise.all([reviewLine(page, 1).getByRole('button', { name: '1번째 줄 주문으로' }).click(), reviewLine(phone, 1).getByRole('button', { name: '1번째 줄 주문으로' }).tap()])
  await expect(reviewList(page).getByRole('listitem')).toHaveCount(0, { timeout: 15_000 })
  await expect(reviewList(phone).getByRole('listitem')).toHaveCount(0, { timeout: 15_000 })
  const s = await oscope(page, date, true)
  expect(s.claims.filter((c) => c.broadcast === b).map((c) => [c.variant, c.status])).toEqual([['M', 'CONFIRMED']])
  await ctx.close()
})

test('AC-O2-52: 확인 필요 사유 낱말은 D-O2-12 그대로, 영어 사유 이름이 보이지 않는다', async ({ page }) => {
  const { b } = await openOptionBroadcast(page)
  await registerOptions(page, b, { no: 21, name: '반바지', price: 15000, options: SIZES, stocks: { L: 1 } })
  await registerOptions(page, b, { no: 22, name: '치마', price: 15000, options: SIZES })
  await registerOptions(page, b, { no: 31, name: '수건', price: 8000, options: [{ name: '색상', choices: [{ label: '흰색' }, { label: '검정색' }] }] })
  const cases: [string, string][] = [
    ['반바지', '옵션 빠짐'],
    ['반바지 S M', '옵션이 둘'],
    ['반바지 엑스', '모르는 말'],
    ['반바지 M 20개', '수량 확인'],
    ['반바지 치마 M', '상품이 여럿'],
    ['반바지 L 2개', '남은 수량 부족'],
    ['흰색', '지금 상품이 막 바뀜'],
  ]
  for (const [i, [text]] of cases.entries()) await chat(page, b, `시청자${String(i)}`, text)
  await waitReviews(page, b, true, cases.length)
  await openReviews(page, b, true)
  for (const [i, [, word]] of cases.entries()) await expect(reviewLine(page, i + 1)).toContainText(word)
  await expect(page.locator('main')).not.toContainText(/[A-Z]{3,}_[A-Z]+/)
})
