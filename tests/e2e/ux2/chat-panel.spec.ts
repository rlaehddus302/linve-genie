// UX2 채팅 칸 정리 (SPEC §5.13 AC-UX2-01~08·10·11·13·14) — test-e2e.
// 기대값은 SPEC §5.13·D-UX2-01~06에서 정했다. 채팅은 리허설 방송에서만 넣을 수 있어 리허설 방송을 쓴다.
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'
import { SIZES, chat, login, noHorizontalScroll, openNewBroadcast, openOptionBroadcast, registerApi, registerOptions, resetSaleMode, uniqueDate } from '../o2/support.ts'

const CONVERT = '찜으로 바꾸기'
const REASON = '이 분은 이 번호를 이미 찜했어요. 새 찜은 생기지 않았어요.'

function chatList(page: Page): Locator {
  return page.getByRole('list', { name: '채팅 메시지' })
}
/** 본문이 정확히 text인 줄 */
function row(page: Page, text: string): Locator {
  return chatList(page).getByRole('listitem').filter({ has: page.getByText(text, { exact: true }) })
}
function convertButton(r: Locator): Locator {
  return r.getByRole('button', { name: CONVERT })
}

/** 휴대폰 375 (터치 — 마우스 올림 없음) */
async function phone(browser: Browser, baseURL: string | undefined): Promise<Page> {
  const ctx = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
  const page = await ctx.newPage()
  await login(page)
  return page
}

async function chatterBroadcast(page: Page): Promise<string> {
  const b = await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
  await registerApi(page, b, 15, '핑크프릴', 10000)
  for (const [nick, text] of [['가람', '안녕하세요'], ['나래', '😀😀'], ['다솜', '오늘 날씨 좋네요']] as const) await chat(page, b, nick, text)
  await expect(row(page, '오늘 날씨 좋네요')).toBeVisible()
  return b
}

for (const size of ['PC 1280', '휴대폰 375'] as const) {
  test(`AC-UX2-01·02: 잡담 줄엔 버튼이 처음엔 없고 언급 줄엔 늘 보인다 (${size})`, async ({ page: pcPage, browser, baseURL }) => {
    let page = pcPage
    if (size === 'PC 1280') {
      await pcPage.setViewportSize({ width: 1280, height: 900 })
      await login(page)
    } else {
      page = await phone(browser, baseURL)
    }
    const b = await chatterBroadcast(page)
    await chat(page, b, '라온', '15번 이뻐요')
    const mention = row(page, '15번 이뻐요')
    await expect(mention).toContainText('언급')
    await expect(convertButton(mention)).toBeVisible()
    // 마우스를 채팅 칸 밖에 둔다
    if (size === 'PC 1280') await page.mouse.move(0, 0)
    for (const text of ['안녕하세요', '😀😀', '오늘 날씨 좋네요']) {
      await expect(row(page, text)).toHaveAttribute('aria-expanded', 'false')
      // 읽기 프로그램에도 읽히지 않는다 (역할 찾기는 숨은 요소를 빼고 센다)
      await expect(convertButton(row(page, text))).toHaveCount(0)
      await expect(row(page, text).getByText(CONVERT)).toBeHidden()
    }
    await noHorizontalScroll(page)
  })
}

test('AC-UX2-02: 옵션 방송 — 옵션 없는 상품 이름을 말한 줄엔 "언급"과 버튼이 늘', async ({ page }) => {
  await login(page)
  try {
    const { b } = await openOptionBroadcast(page)
    await registerOptions(page, b, { no: 31, name: '핑크프릴', price: 10000 })
    await chat(page, b, '마루', '핑크프릴 이쁘다')
    const r = row(page, '핑크프릴 이쁘다')
    await expect(r).toContainText('언급')
    await page.mouse.move(0, 0)
    await expect(convertButton(r)).toBeVisible()
  } finally {
    await resetSaleMode(page)
  }
})

test('AC-UX2-03·14: 휴대폰 375 — 줄을 누르면 버튼(44px 이상), 한 번에 한 줄, 다시 누르면 접힘, 가로 스크롤 없음', async ({ browser, baseURL }) => {
  const page = await phone(browser, baseURL)
  await chatterBroadcast(page)
  const hello = row(page, '안녕하세요')
  const weather = row(page, '오늘 날씨 좋네요')
  await hello.getByText('안녕하세요').tap()
  await expect(hello).toHaveAttribute('aria-expanded', 'true')
  await expect(convertButton(hello)).toBeVisible()
  const box = await convertButton(hello).boundingBox()
  expect(box).not.toBeNull()
  expect(box!.height).toBeGreaterThanOrEqual(44)
  expect(box!.width).toBeGreaterThanOrEqual(44)
  await noHorizontalScroll(page)
  // 다른 줄을 누르면 앞 줄 버튼은 사라진다
  await weather.getByText('오늘 날씨 좋네요').tap()
  await expect(convertButton(weather)).toBeVisible()
  await expect(convertButton(hello)).toHaveCount(0)
  await expect(hello).toHaveAttribute('aria-expanded', 'false')
  await noHorizontalScroll(page)
  // 열린 줄을 다시 누르면 접힌다
  await weather.getByText('오늘 날씨 좋네요').tap()
  await expect(convertButton(weather)).toHaveCount(0)
  await expect(weather).toHaveAttribute('aria-expanded', 'false')
  // 버튼을 누르면 지금과 같은 창
  await hello.getByText('안녕하세요').tap()
  await convertButton(hello).tap()
  await expect(page.getByRole('dialog', { name: '메시지를 찜으로 바꾸기' })).toBeVisible()
  await page.context().close()
})

test('AC-UX2-04: PC — 마우스를 올리면 버튼이 보이고 누를 수 있다, 빼면 사라지고 누른 줄은 남는다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await login(page)
  await chatterBroadcast(page)
  const hello = row(page, '안녕하세요')
  const emoji = row(page, '😀😀')
  // 마우스가 있는 기기 (hover: hover)
  expect(await page.evaluate(() => window.matchMedia('(hover: hover)').matches)).toBe(true)
  await page.mouse.move(0, 0)
  await expect(hello.getByText(CONVERT)).toBeHidden()
  await hello.hover()
  await expect(hello.getByText(CONVERT)).toBeVisible()
  await page.mouse.move(0, 0)
  await expect(hello.getByText(CONVERT)).toBeHidden()
  // 누른 줄은 마우스를 빼도 남는다
  await emoji.getByText('😀😀').click()
  await page.mouse.move(0, 0)
  await page.getByLabel('빠른 입력').focus()
  await expect(convertButton(emoji)).toBeVisible()
  // 올려서 보인 버튼을 누를 수 있다
  await hello.hover()
  await hello.getByText(CONVERT).click()
  await expect(page.getByRole('dialog', { name: '메시지를 찜으로 바꾸기' })).toBeVisible()
})

test('AC-UX2-04: 휴대폰(터치)에서는 마우스 올림으로 버튼이 남지 않는다', async ({ browser, baseURL }) => {
  const page = await phone(browser, baseURL)
  await chatterBroadcast(page)
  const hello = row(page, '안녕하세요')
  expect(await page.evaluate(() => window.matchMedia('(hover: hover)').matches)).toBe(false)
  await hello.hover()
  await expect(hello.getByText(CONVERT)).toBeHidden()
  await page.context().close()
})

test('AC-UX2-05: Tab으로 잡담 줄에 초점 → 테두리와 버튼, Tab 한 번 더면 버튼, 줄 밖으로 나가면 사라진다, Enter로 창', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await login(page)
  await chatterBroadcast(page)
  await page.mouse.move(0, 0)
  const hello = row(page, '안녕하세요')
  const emoji = row(page, '😀😀')
  await chatList(page).focus()
  await page.keyboard.press('Tab')
  await expect(hello).toBeFocused()
  await expect(convertButton(hello)).toBeVisible()
  const outline = await hello.evaluate((li) => getComputedStyle(li).outlineStyle)
  expect(outline).not.toBe('none')
  await page.keyboard.press('Tab')
  await expect(convertButton(hello)).toBeFocused()
  // 초점이 다음 줄로 나가면 앞 줄 버튼은 사라진다
  await page.keyboard.press('Tab')
  await expect(emoji).toBeFocused()
  await expect(convertButton(hello)).toHaveCount(0)
  await expect(convertButton(emoji)).toBeVisible()
  await page.keyboard.press('Shift+Tab')
  await expect(hello).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(convertButton(hello)).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: '메시지를 찜으로 바꾸기' })).toBeVisible()
})

test('AC-UX2-06: 주문·취소 줄은 누르거나 초점을 줘도 버튼이 없다', async ({ page }) => {
  await login(page)
  const b = await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
  await registerApi(page, b, 15, '핑크프릴', 10000)
  await chat(page, b, '가람', '15')
  await chat(page, b, '가람', '15 취소')
  for (const text of ['15', '15 취소']) {
    const r = row(page, text)
    await expect(r).toBeVisible()
    await r.getByText(text, { exact: true }).click()
    await r.hover()
    await expect(r.getByText(CONVERT)).toHaveCount(0)
  }
})

test('AC-UX2-06·07: 옵션 방송 — 확인 필요 줄은 "확인 필요에서 고르기"만 늘, 옵션 상품 언급 줄엔 버튼 없음', async ({ page }) => {
  await login(page)
  try {
    const { b } = await openOptionBroadcast(page)
    await registerOptions(page, b, { no: 21, name: '반바지', price: 15000, options: SIZES })
    await chat(page, b, '김철수', '반바지')
    await chat(page, b, '박민수', '반바지 예뻐요 너무')
    const review = row(page, '반바지')
    await expect(review).toContainText('확인 필요 · 옵션 빠짐')
    await page.mouse.move(0, 0)
    await expect(review.getByRole('button', { name: '확인 필요에서 고르기' })).toBeVisible()
    await review.getByText('반바지', { exact: true }).click()
    await review.hover()
    await expect(review.getByText(CONVERT)).toHaveCount(0)
    const optMention = row(page, '반바지 예뻐요 너무')
    await optMention.getByText('반바지 예뻐요 너무').click()
    await optMention.hover()
    await expect(optMention.getByText(CONVERT)).toHaveCount(0)
  } finally {
    await resetSaleMode(page)
  }
})

test('AC-UX2-08·11: 번호 방송 — 같은 사람이 다시 친 번호에 "15번 이미 찜함", 새로 생긴 번호엔 결과 글, 누르면 이유 문장', async ({ page }) => {
  await login(page)
  const b = await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
  await registerApi(page, b, 15, '핑크프릴', 10000)
  await chat(page, b, '에이', '15')
  const rows = chatList(page).getByRole('listitem').filter({ hasText: '에이' })
  await expect(rows.nth(0)).toContainText('15번 1등')
  await chat(page, b, '에이', '15')
  const second = rows.nth(1)
  await expect(second).toContainText('주문 15')
  await expect(second.getByRole('button', { name: '15번 이미 찜함' })).toBeVisible()
  await expect(second).not.toContainText('1등')
  await expect(second).not.toContainText('대기')
  await expect(second.locator('.chat-claims')).toHaveCount(0)
  await expect(second.getByRole('button', { name: CONVERT })).toHaveCount(0)
  // 누르면 이유 문장
  await expect(second.getByText(REASON)).toHaveCount(0)
  await second.getByRole('button', { name: '15번 이미 찜함' }).click()
  await expect(second.getByText(REASON, { exact: true })).toBeVisible()

  await registerApi(page, b, 16, '홍옥', 8000)
  await chat(page, b, '에이', '15 16')
  const third = rows.nth(2)
  await expect(third).toContainText('16번 1등')
  await expect(third.getByRole('button', { name: '15번 이미 찜함' })).toBeVisible()
  await expect(third.getByRole('button', { name: '16번 이미 찜함' })).toHaveCount(0)
  // Tab 초점으로도 이유 문장
  await third.getByRole('button', { name: '15번 이미 찜함' }).focus()
  await expect(third.getByText(REASON, { exact: true })).toBeVisible()
})

test('AC-UX2-11: 휴대폰 375 — "15번 이미 찜함"을 누르면 이유 문장, 가로 스크롤 없음', async ({ browser, baseURL }) => {
  const page = await phone(browser, baseURL)
  const b = await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
  await registerApi(page, b, 15, '핑크프릴', 10000)
  await chat(page, b, '에이', '15')
  const rows = chatList(page).getByRole('listitem').filter({ hasText: '에이' })
  await expect(rows.nth(0)).toContainText('15번 1등')
  await chat(page, b, '에이', '15')
  const tag = rows.nth(1).getByRole('button', { name: '15번 이미 찜함' })
  await expect(tag).toBeVisible()
  await tag.tap()
  await expect(rows.nth(1).getByText(REASON, { exact: true })).toBeVisible()
  await noHorizontalScroll(page)
  await page.context().close()
})

test('AC-UX2-10: 옵션 방송 — 같은 사람이 같은 옵션을 또 치면 "이미 찜함", 확인 필요 줄엔 없음', async ({ page }) => {
  await login(page)
  try {
    const { b } = await openOptionBroadcast(page)
    await registerOptions(page, b, { no: 21, name: '반바지', price: 15000, options: SIZES })
    await chat(page, b, '에이', '반바지 M')
    const rows = chatList(page).getByRole('listitem').filter({ hasText: '에이' })
    await expect(rows.nth(0)).toContainText('1등')
    await chat(page, b, '에이', '반바지 M')
    await expect(rows.nth(1).getByRole('button', { name: '이미 찜함', exact: true })).toBeVisible()
    await rows.nth(1).getByRole('button', { name: '이미 찜함', exact: true }).click()
    await expect(rows.nth(1).getByText(REASON, { exact: true })).toBeVisible()
    await chat(page, b, '에이', '반바지')
    await expect(rows.nth(2)).toContainText('확인 필요 · 옵션 빠짐')
    await expect(rows.nth(2).getByText('이미 찜함')).toHaveCount(0)
  } finally {
    await resetSaleMode(page)
  }
})

test('AC-UX2-13: 찜으로 바꾸기를 보낸 뒤 줄이 접혀도 대기·결과 문장은 보인다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await login(page)
  await chatterBroadcast(page)
  const hello = row(page, '안녕하세요')
  const weather = row(page, '오늘 날씨 좋네요')
  await hello.getByText('안녕하세요').click()
  await convertButton(hello).click()
  const dlg = page.getByRole('dialog', { name: '메시지를 찜으로 바꾸기' })
  await dlg.getByLabel('번호').fill('15')
  await dlg.getByRole('button', { name: '바꾸기' }).click()
  await expect(hello).toContainText(/초 뒤 보내요/)
  // 다른 줄을 눌러 이 줄을 접는다
  await weather.getByText('오늘 날씨 좋네요').click()
  await page.mouse.move(0, 0)
  await expect(hello).toHaveAttribute('aria-expanded', 'false')
  await expect(convertButton(hello)).toHaveCount(0)
  await expect(hello).toContainText(/초 뒤 보내요|15번 1등/)
  await expect(hello).toContainText('15번 1등', { timeout: 15_000 })
  await page.getByLabel('빠른 입력').focus()
  await expect(hello).toContainText('15번 1등')
})

test('AC-UX2-14: 휴대폰 375 — 버튼이 보이거나 사라져도 새 메시지를 따라 내려가고, 올려 보면 "새 메시지 n개"', async ({ browser, baseURL }) => {
  const page = await phone(browser, baseURL)
  const b = await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
  for (let i = 1; i <= 30; i++) await chat(page, b, `시청자${String(i)}`, `잡담 ${String(i)}번째 이야기`)
  const list = chatList(page)
  await expect(row(page, '잡담 30번째 이야기')).toBeVisible()
  const atBottom = () => list.evaluate((ol) => ol.scrollHeight - ol.scrollTop - ol.clientHeight <= 24)
  await expect.poll(atBottom).toBe(true)
  // 맨 아래 줄을 눌러 버튼을 펼친다
  const last = row(page, '잡담 30번째 이야기')
  await last.getByText('잡담 30번째 이야기').tap()
  await expect(convertButton(last)).toBeVisible()
  await noHorizontalScroll(page)
  await chat(page, b, '새사람', '새로 온 이야기')
  await expect(row(page, '새로 온 이야기')).toBeInViewport()
  await expect.poll(atBottom).toBe(true)
  // 접는다
  await last.getByText('잡담 30번째 이야기').tap()
  await expect(convertButton(last)).toHaveCount(0)
  await chat(page, b, '새사람', '또 온 이야기')
  await expect(row(page, '또 온 이야기')).toBeInViewport()
  await expect.poll(atBottom).toBe(true)
  await noHorizontalScroll(page)
  // 위로 올려 보는 중엔 자리를 지키고 "새 메시지 n개"
  await list.evaluate((ol) => { ol.scrollTop = 0 })
  await expect.poll(atBottom).toBe(false)
  const first = row(page, '잡담 1번째 이야기')
  await first.getByText('잡담 1번째 이야기').tap()
  await expect(convertButton(first)).toBeVisible()
  await chat(page, b, '새사람', '안 보이는 이야기')
  await expect(page.getByRole('button', { name: '새 메시지 1개' })).toBeVisible()
  await expect.poll(atBottom).toBe(false)
  await noHorizontalScroll(page)
  await page.context().close()
})
