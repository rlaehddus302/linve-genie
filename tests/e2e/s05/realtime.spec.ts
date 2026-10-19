// 두 기기·실시간·끊김 (AC-S05-62·63·64 작은 규모, AC-S05-73, test-e2e).
import { test, expect, type Browser, type Page } from '@playwright/test'
import { boardItem, history, login, openNewBroadcast, register, uniqueDate } from './support.ts'

async function device(browser: Browser, baseURL: string, width: number, height: number): Promise<Page> {
  const ctx = await browser.newContext({ baseURL, viewport: { width, height }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) })
  return ctx.newPage()
}

test('AC-S05-64·62: PC 등록이 휴대폰에 1초 안에, 알림마다 전체 조회하지 않음', async ({ browser, baseURL }) => {
  const pc = await device(browser, baseURL!, 1440, 900)
  const phone = await device(browser, baseURL!, 375, 812)
  await login(pc)
  const date = uniqueDate()
  const b = await openNewBroadcast(pc, { date, rehearsal: false })
  await login(phone)
  await phone.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(phone.getByLabel('빠른 입력')).toBeVisible()
  const fullViews: string[] = []
  phone.on('request', (req) => {
    const u = new URL(req.url())
    if (u.pathname === `/api/days/${date}`) fullViews.push(u.search)
  })
  const input = pc.getByLabel('빠른 입력')
  for (let no = 1; no <= 8; no += 1) {
    await input.fill(`${String(no)} 반영${String(no)} ${String(no)}000`)
    const resp = pc.waitForResponse((r) => r.url().includes('/api/events') && r.request().method() === 'POST')
    await input.press('Enter')
    await resp
    const t0 = Date.now()
    await expect(boardItem(phone, no)).toBeVisible({ timeout: 5_000 })
    expect(Date.now() - t0, `${String(no)}번 반영 시간`).toBeLessThan(1_000)
  }
  expect(fullViews, '처음 한 번만 전체 조회').toHaveLength(0)
  // 휴대폰 폭: 가로로 넘치지 않음, 알림·현재 상품·보드·빠른 입력이 보인다 (AC-S05-73)
  expect(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  for (const name of ['알림', '현재 상품', '상품 보드']) await expect(phone.getByRole('region', { name })).toBeVisible()
  await pc.context().close()
  await phone.context().close()
})

test('AC-S05-62: 휴대폰이 끊긴 사이 PC가 바꾼 것 → 다시 붙으면 같은 화면', async ({ browser, baseURL }) => {
  const pc = await device(browser, baseURL!, 1440, 900)
  const phone = await device(browser, baseURL!, 375, 812)
  await login(pc)
  const date = uniqueDate()
  const b = await openNewBroadcast(pc, { date, rehearsal: false })
  await register(pc, '1 처음 1000', 1)
  await login(phone)
  await phone.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(boardItem(phone, 1)).toBeVisible()
  await phone.context().setOffline(true)
  await expect(phone.getByText('실시간 연결이 끊겼어요. 다시 연결하는 중이에요.')).toBeVisible()
  await register(pc, '2 끊긴사이 2000', 2)
  await pc.getByLabel('빠른 입력').fill('1 처음 1500')
  await pc.getByLabel('빠른 입력').press('Enter')
  const ask = pc.getByRole('dialog', { name: '1번이 이미 있어요. 고칠까요?' })
  await ask.getByRole('button', { name: '예' }).click()
  await expect(boardItem(pc, 1)).toContainText('1,500원')
  await phone.context().setOffline(false)
  await expect(phone.getByText('실시간 연결이 끊겼어요. 다시 연결하는 중이에요.')).toHaveCount(0)
  await expect(boardItem(phone, 2)).toBeVisible()
  await expect(boardItem(phone, 1)).toContainText('1,500원')
  const pcBoard = await pc.getByRole('region', { name: '상품 보드' }).getByRole('button').allInnerTexts()
  const phoneBoard = await phone.getByRole('region', { name: '상품 보드' }).getByRole('button').allInnerTexts()
  expect(phoneBoard).toEqual(pcBoard)
  await pc.context().close()
  await phone.context().close()
})

test('AC-S05-63: 오프라인 중 친 등록 → "저장하지 못했어요" → 다시 보내기 → 한 번만', async ({ page }) => {
  await login(page)
  const date = uniqueDate()
  await openNewBroadcast(page, { date, rehearsal: false })
  await page.context().setOffline(true)
  const input = page.getByLabel('빠른 입력')
  await input.fill('9 오프라인 9000')
  await input.press('Enter')
  await expect(page.getByText(/저장하지 못했어요/)).toBeVisible({ timeout: 15_000 })
  await page.context().setOffline(false)
  await page.getByRole('button', { name: '다시 보내기' }).click()
  await expect(boardItem(page, 9)).toBeVisible()
  const regs = (await history(page, date, false)).filter((e) => e.type === 'product.register')
  expect(regs).toHaveLength(1)
})

test('AC-S05-63: 응답만 잃어버린 등록(서버는 기록) → 같은 요청 번호로 다시 보내 한 번만', async ({ page }) => {
  await login(page)
  const date = uniqueDate()
  await openNewBroadcast(page, { date, rehearsal: false })
  let dropped = false
  await page.route('**/api/events**', async (route) => {
    if (!dropped) {
      dropped = true
      await route.fetch() // 서버에는 도착해 기록된다
      await route.abort('connectionreset')
      return
    }
    await route.continue()
  })
  const input = page.getByLabel('빠른 입력')
  await input.fill('11 응답유실 11000')
  await input.press('Enter')
  await expect(boardItem(page, 11)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(input).toHaveValue('')
  const regs = (await history(page, date, false)).filter((e) => e.type === 'product.register')
  expect(regs).toHaveLength(1)
})

test('AC-S05-10·13: 두 기기가 같은 번호를 동시에 등록 → 한 번만 등록, 늦은 쪽은 "고칠까요?"', async ({ browser, baseURL }) => {
  const pc = await device(browser, baseURL!, 1440, 900)
  const phone = await device(browser, baseURL!, 375, 812)
  await login(pc)
  const date = uniqueDate()
  const b = await openNewBroadcast(pc, { date, rehearsal: false })
  await login(phone)
  await phone.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(phone.getByLabel('빠른 입력')).toBeFocused()
  await pc.getByLabel('빠른 입력').fill('15 피씨 10000')
  await phone.getByLabel('빠른 입력').fill('15 폰 12000')
  await Promise.all([pc.getByLabel('빠른 입력').press('Enter'), phone.getByLabel('빠른 입력').press('Enter')])
  await expect(boardItem(pc, 15)).toBeVisible()
  await expect(boardItem(phone, 15)).toBeVisible()
  const regs = (await history(pc, date, false)).filter((e) => e.type === 'product.register' && e.fields['no'] === 15)
  expect(regs.length).toBeGreaterThanOrEqual(1)
  const winnerName = String(((await (await pc.request.get(`/api/days/${date}`)).json()) as { products: { no: number; name: string }[] }).products.find((p) => p.no === 15)!.name)
  const loser = winnerName === '피씨' ? phone : pc
  const loserLine = winnerName === '피씨' ? '15 폰 12000' : '15 피씨 10000'
  await expect(loser.getByRole('dialog', { name: '15번이 이미 있어요. 고칠까요?' })).toBeVisible()
  await loser.getByRole('dialog').getByRole('button', { name: '아니요' }).click()
  await expect(loser.getByLabel('빠른 입력')).toHaveValue(loserLine)
  await pc.context().close()
  await phone.context().close()
})

test('AC-S05-62: 끊긴 사이 변경이 보관 범위(1,000)를 넘으면 전체를 다시 받아 같은 화면', async ({ browser, baseURL }) => {
  test.setTimeout(180_000)
  const pc = await device(browser, baseURL!, 1440, 900)
  const phone = await device(browser, baseURL!, 375, 812)
  await login(pc)
  const date = uniqueDate()
  const b = await openNewBroadcast(pc, { date, rehearsal: true })
  for (let no = 1; no <= 5; no += 1) await register(pc, `${String(no)} 상품${String(no)} ${String(no)}000`, no)
  await login(phone)
  await phone.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(boardItem(phone, 5)).toBeVisible()
  await phone.context().setOffline(true)
  await expect(phone.getByText('실시간 연결이 끊겼어요. 다시 연결하는 중이에요.')).toBeVisible()
  const res = await pc.request.post(`/api/broadcasts/${b}/rehearsal/generator/start`, { data: { total: 1500, perSecond: 50, seed: 11 }, headers: { Origin: new URL(pc.url()).origin } })
  expect(res.ok(), await res.text()).toBe(true)
  await expect.poll(async () => ((await (await pc.request.get(`/api/broadcasts/${b}/rehearsal/generator`)).json()) as { generator: { running: boolean } }).generator.running, { timeout: 60_000 }).toBe(false)
  await expect(pc.getByRole('region', { name: '리허설 조작판' }).getByRole('status')).toContainText('1500 / 1500')
  await phone.context().setOffline(false)
  await expect(phone.getByText('실시간 연결이 끊겼어요. 다시 연결하는 중이에요.')).toHaveCount(0, { timeout: 15_000 })
  const boardText = (p: typeof pc) => p.getByRole('region', { name: '상품 보드' }).getByRole('button').allInnerTexts()
  await expect.poll(async () => JSON.stringify(await boardText(phone)), { timeout: 15_000 }).toBe(JSON.stringify(await boardText(pc)))
  const alerts = async (p: typeof pc) => p.getByRole('region', { name: '알림' }).innerText()
  await expect.poll(() => alerts(phone), { timeout: 15_000 }).toBe(await alerts(pc))
  const lastChat = async (p: typeof pc) => (await p.getByRole('list', { name: '채팅 메시지' }).getByRole('listitem').last().innerText())
  await expect.poll(() => lastChat(phone), { timeout: 15_000 }).toBe(await lastChat(pc))
  await pc.context().close()
  await phone.context().close()
})
