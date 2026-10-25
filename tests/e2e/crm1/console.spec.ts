// CRM1 방송 콘솔 1등 옆 "입금 늦음 주의" (test-e2e) — AC-CRM1-18·19·20. 기대값은 acceptance.md·D-CRM1-07 그대로:
// 실제 방송, 확정 1등의 지금의 구매자가 입금 늦음 주의이면 현재 상품 카드·휴대폰 요약 줄·상품 자세히의 1등 이름 뒤에 작은 꼬리표.
// 1등이 바뀌면 5초 안에, 다시 받기는 10초에 한 번까지. 받지 못하면 꼬리표 없이 그대로(오류 띠 없음). 이벤트를 하나도 쓰지 않는다.
import { test, expect, type Page } from '@playwright/test'
import { bigText, broadcast, chat, customerSettings, history, kstDate, loginNewSeller, scopeView, writeEvent, youtubeSale } from './support.ts'

const current = (page: Page) => page.getByRole('region', { name: '현재 상품' })
const summaryLine = (page: Page) => page.getByRole('status', { name: '현재 상품 요약' })
const customersPath = /\/api\/days\/\d{4}-\d{2}-\d{2}\/customers(\?|$)/

async function registerStock(page: Page, b: string, no: number, name: string, price: number, stock: number): Promise<void> {
  const res = await writeEvent(page, { type: 'product.register', b, no, name, price, stock })
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
}

/** 지난 날짜(10일 전)에 미입금 한 번인 UC_B와, 어제 날짜의 실제 방송(15·16번 수량 2 — 1등이 생겨도 판매 중) */
async function cautionWorld(page: Page, nick = '비손님'): Promise<{ ch: string; b: string; date: string }> {
  await loginNewSeller(page)
  const ch = `UC_B${String(Date.now())}`
  await youtubeSale(page, { date: kstDate(10), ch, nick, prices: [9_000], paid: false })
  const date = kstDate(1)
  const b = await broadcast(page, date)
  await registerStock(page, b, 16, '라울', 8_000, 2)
  await registerStock(page, b, 15, '핑크프릴', 10_000, 2) // 마지막에 등록한 15번이 현재 상품
  return { ch, b, date }
}

async function openConsole(page: Page, b: string): Promise<void> {
  const first = page.waitForResponse((r) => customersPath.test(new URL(r.url()).pathname + new URL(r.url()).search) && r.request().method() === 'GET')
  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(page.getByLabel('빠른 입력')).toBeVisible()
  await first
}

test.describe('콘솔 꼬리표', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('TE-CRM1-001 AC-CRM1-18: 콘솔을 연 뒤 UC_B가 "15"로 1등이 되면 5초 안에 카드 "1등: 비손님" 뒤 "입금 늦음 주의"', async ({ page }) => {
    test.setTimeout(120_000)
    const w = await cautionWorld(page)
    await openConsole(page, w.b)
    await chat(page, w.b, w.ch, '비손님', '15')
    const card = current(page)
    await expect(card.getByText(/^1등: /)).toContainText('비손님')
    // 1등이 바뀐 때부터 5초 안 (D-CRM1-07). 꼬리표 받기가 "10초에 한 번" 간격을 콘솔을 열 때 받은 것부터 세면 이 경우 늦는다
    await expect(card.locator('.caution-mark')).toBeVisible({ timeout: 5_000 })
  })

  test('AC-CRM1-18: 꼬리표 글·읽기 글·누를 수 없음, 요약 줄·상품 자세히에도, 이벤트 수 그대로 — 조회를 500으로 막으면 꼬리표·오류 띠 없음, 판정 같음', async ({ page, browser }) => {
    test.setTimeout(150_000)
    const w = await cautionWorld(page)
    await chat(page, w.b, w.ch, '비손님', '15')
    await expect.poll(async () => (await scopeView(page, w.date, false)).products.find((p) => p.no === 15)?.winners ?? []).toEqual([w.ch])
    const eventsBefore = (await history(page, w.date, false)).length
    const winnersBefore = JSON.stringify((await scopeView(page, w.date, false)).products.map((p) => [p.no, p.winners, p.waitlist]))

    await openConsole(page, w.b)
    const card = current(page)
    const mark = card.locator('.caution-mark')
    await expect(mark).toBeVisible()
    await expect(card.getByText(/^1등: /)).toContainText('비손님 입금 늦음 주의')
    // 누를 수 없다 · 읽기 프로그램엔 "입금 늦음 주의 손님"
    expect(await mark.evaluate((el) => el.closest('button, a, [role=button], [tabindex]') === null)).toBe(true)
    await expect(card.getByText('입금 늦음 주의 손님')).toHaveCount(1)
    await expect(card.getByRole('button', { name: /입금 늦음 주의/ })).toHaveCount(0)
    // 휴대폰 요약 줄
    await expect(summaryLine(page)).toContainText(/1등 비손님 (입금 늦음 주의|주의)/)
    // 상품 자세히의 1등 목록
    await page.getByRole('region', { name: '상품 보드' }).getByRole('button', { name: /^15번 / }).click()
    const detail = page.getByRole('dialog').filter({ hasText: '15번' }).first()
    await expect(detail.locator('.caution-mark').first()).toBeVisible()
    await page.keyboard.press('Escape')
    // 표시는 이벤트를 쓰지 않는다
    expect((await history(page, w.date, false)).length).toBe(eventsBefore)

    // 같은 판매자, 조회 500 → 꼬리표 없음, 오류 띠 없음, 판정 그대로
    const context = await browser.newContext({ baseURL: new URL(page.url()).origin, viewport: { width: 375, height: 812 }, storageState: await page.context().storageState() })
    const other = await context.newPage()
    let failed = 0
    await other.route(customersPath, async (route) => {
      failed += 1
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: '서버 오류' } }) })
    })
    await other.goto(`/broadcasts/${encodeURIComponent(w.b)}`)
    await expect(other.getByLabel('빠른 입력')).toBeVisible()
    await expect.poll(() => failed).toBeGreaterThan(0)
    await expect(current(other).getByText(/^1등: /)).toHaveText('1등: 비손님')
    await expect(other.locator('.caution-mark')).toHaveCount(0)
    await expect(other.getByText(/손님 기록|불러오지 못했어요/)).toHaveCount(0)
    // 찜·판정은 계속된다: 다른 시청자가 16번 1등
    await chat(page, w.b, `UC_C${String(Date.now())}`, '씨손님', '16')
    await expect(other.getByRole('region', { name: '상품 보드' }).getByRole('button', { name: /^16번 / })).toContainText('씨손님')
    await context.close()
    expect(JSON.stringify((await scopeView(page, w.date, false)).products.filter((p) => p.no === 15).map((p) => [p.no, p.winners, p.waitlist]))).toBe(JSON.stringify(JSON.parse(winnersBefore).filter((x: unknown[]) => x[0] === 15)))
    expect((await history(page, w.date, false)).length).toBe(eventsBefore + 1) // 16번 찜 하나만
  })

  test('AC-CRM1-19: 단골(미입금 0)은 꼬리표 없음, 리허설 방송 1등(실제 날짜 미입금 있는 채널)은 꼬리표 없고 조회도 부르지 않음', async ({ page }) => {
    test.setTimeout(150_000)
    const w = await cautionWorld(page)
    // (1) 단골이지만 미입금 0
    await customerSettings(page, { regularCount: 2, regularAmount: 1_000, waitDays: 3 })
    const reg = `UC_R${String(Date.now())}`
    await youtubeSale(page, { date: kstDate(12), ch: reg, nick: '큰손님', prices: [50_000], paid: true })
    await chat(page, w.b, reg, '큰손님', '16')
    await openConsole(page, w.b)
    await expect(page.getByRole('region', { name: '상품 보드' }).getByRole('button', { name: /^16번 / })).toContainText('큰손님')
    const day = await page.request.get(`/api/days/${w.date}/customers`)
    const regRow = ((await day.json()) as { customers: { buyer: string; regular: boolean; caution: boolean }[] }).customers.find((c) => c.buyer === reg)
    expect(regRow).toMatchObject({ regular: true, caution: false })
    await expect(page.locator('.caution-mark')).toHaveCount(0)
    await expect(page.locator('main')).not.toContainText('단골')

    // (2) 리허설 방송
    const asked: string[] = []
    page.on('request', (r) => {
      if (customersPath.test(new URL(r.url()).pathname)) asked.push(r.url())
    })
    const rb = await broadcast(page, kstDate(2), true, '연습')
    await registerStock(page, rb, 15, '연습상품', 10_000, 2)
    await chat(page, rb, w.ch, '비손님', '15')
    await page.goto(`/broadcasts/${encodeURIComponent(rb)}`)
    await expect(current(page).getByText(/^1등: /)).toContainText('비손님')
    await expect(page.locator('.caution-mark')).toHaveCount(0)
    expect(asked).toEqual([])
  })

  test('AC-CRM1-19: 1등이 잇달아 바뀌어 다시 받을 때 10초에 한 번을 넘지 않는다', async ({ page }) => {
    test.setTimeout(150_000)
    const w = await cautionWorld(page)
    for (const no of [17, 18, 19, 20]) await registerStock(page, w.b, no, `상품${String(no)}`, 5_000, 2)
    const times: number[] = []
    page.on('request', (r) => {
      if (customersPath.test(new URL(r.url()).pathname) && r.method() === 'GET') times.push(Date.now())
    })
    await openConsole(page, w.b)
    const t = String(Date.now())
    for (const no of [15, 16, 17, 18, 19, 20]) {
      await chat(page, w.b, `UC_x${t}${String(no)}`, `손님${String(no)}`, String(no))
      await expect(page.getByRole('region', { name: '상품 보드' }).getByRole('button', { name: new RegExp(`^${String(no)}번 `) })).toContainText(`손님${String(no)}`)
    }
    // 바뀐 것은 간격이 차면 한 번 받는다 — 여는 때 1번 + 바뀐 뒤 1번 이상
    await expect.poll(() => times.length, { timeout: 25_000 }).toBeGreaterThanOrEqual(2)
    for (let i = 2; i < times.length; i++) expect(times[i]! - times[i - 1]!, `받기 간격 ${String(i)}`).toBeGreaterThanOrEqual(9_500)
  })
})

const WIDTHS = [375, 393, 412, 430] as const
const LONG_NICK = '다육이사랑하는엄마다육이사랑하는엄마다육' // 20글자

/** 고정 영역(요약 줄의 sticky 조상) 높이·요약 줄 높이·가로 넘침 */
async function fixedArea(page: Page): Promise<{ sticky: number; line: number; overflow: number }> {
  return await summaryLine(page).evaluate((el) => {
    let pinned: HTMLElement | null = el as HTMLElement
    while (pinned !== null && getComputedStyle(pinned).position !== 'sticky') pinned = pinned.parentElement
    return {
      sticky: Math.round(pinned?.getBoundingClientRect().height ?? -1),
      line: Math.round(el.getBoundingClientRect().height),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
}

for (const big of [false, true]) {
  test(`TE-CRM1-002 AC-CRM1-20 글자 ${big ? '150' : '100'}% × ${WIDTHS.join('·')}px: 1등 이름 20글자 + 꼬리표 — 고정 영역·요약 줄 높이가 꼬리표 없을 때와 같고 가로 넘침 0, 글자 잘림 없음`, async ({ page }) => {
    test.setTimeout(180_000)
    const w = await cautionWorld(page, LONG_NICK)
    await chat(page, w.b, w.ch, LONG_NICK, '15')
    await expect.poll(async () => (await scopeView(page, w.date, false)).products.find((p) => p.no === 15)?.winners ?? []).toEqual([w.ch])
    // 같은 화면을 꼬리표 있음·없음으로 — 조회 응답의 caution만 바꾼다 (이벤트가 없으니 나머지는 같다)
    let flag = true
    await page.route(customersPath, async (route) => {
      const res = await route.fetch()
      const body = (await res.json()) as { customers: { caution: boolean }[] }
      await route.fulfill({ response: res, json: { ...body, customers: body.customers.map((c) => ({ ...c, caution: flag && c.caution })) } })
    })
    if (big) await bigText(page)
    const problems: string[] = []
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 852 })
      flag = false
      await page.goto(`/broadcasts/${encodeURIComponent(w.b)}`)
      await expect(current(page).getByText(/^1등: /)).toContainText('다육이사랑')
      await expect(summaryLine(page)).toBeVisible()
      const bare = await fixedArea(page)
      flag = true
      await page.goto(`/broadcasts/${encodeURIComponent(w.b)}`)
      await expect(current(page).locator('.caution-mark')).toBeVisible()
      await expect(summaryLine(page).locator('.caution-mark')).toBeVisible()
      const tagged = await fixedArea(page)
      const where = `${String(width)}px ${big ? '150' : '100'}%`
      if (tagged.sticky !== bare.sticky) problems.push(`${where} 고정 영역 ${String(bare.sticky)} → ${String(tagged.sticky)}`)
      if (tagged.line !== bare.line) problems.push(`${where} 요약 줄 ${String(bare.line)} → ${String(tagged.line)}`)
      if (tagged.overflow > 0) problems.push(`${where} 가로 넘침 ${String(tagged.overflow)}`)
      const clipped = await summaryLine(page).evaluate((el) => el.scrollWidth > el.clientWidth + 1)
      if (clipped) problems.push(`${where} 요약 줄 잘림`)
    }
    expect(problems).toEqual([])
  })
}
