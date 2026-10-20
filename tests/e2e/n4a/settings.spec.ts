// AC-N4a-10 (설정 화면·메뉴 "설정"·휴대폰 — D-N4a-07: "설정"은 메뉴 항목 하나, 위 줄 따로 링크 없음), AC-N4a-11 (끌 때 묻고 켤 때 알림·포커스·두 번 누름), AC-N4a-12 (바꾼 기록·두 기기 1초)
import { expect, test } from '@playwright/test'
import { cleanupN4a, gotoSettings, labelSection, labelSettings, login, noHorizontalScroll, offWaiting, postJson, realBroadcast, registerApi, setLabels, settingsLink, smsApi, SWITCH_HELP, TURNED_OFF, TURNED_ON, uniqueDate } from './support.ts'

test.afterEach(async ({ page }) => {
  await cleanupN4a(page)
})

const HISTORY_LINE = /^\d{4}-\d{2}-\d{2} \([월화수목금토일]\) \d{2}:\d{2} · 라벨 (끔|켬) · e2e-shop$/

test('AC-N4a-10·11·12: PC — 메뉴 "설정" → /settings, 끄기 확인 창(닫기 먼저·Esc는 안 보냄·숫자 키 1), 켜기 알림, 바꾼 기록 새것 먼저', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page)
  const before = (await labelSettings(page)).history.length
  await settingsLink(page).click()
  await expect(page).toHaveURL(/\/settings$/)
  await expect(page.getByRole('heading', { name: '설정', level: 1 })).toBeVisible()
  const section = labelSection(page)
  await expect(section.getByText('라벨 기능: 켜짐', { exact: true })).toBeVisible()
  await expect(section).toContainText(SWITCH_HELP)
  await expect(section.getByRole('button')).toHaveText(['라벨 끄기'])
  await expect(section.locator('.button-primary')).toHaveCount(0)

  // 닫기·Esc는 아무것도 보내지 않는다
  let puts = 0
  page.on('request', (r) => { if (r.method() === 'PUT' && new URL(r.url()).pathname === '/api/settings/labels') puts += 1 })
  const off = section.getByRole('button', { name: '라벨 끄기' })
  await off.click()
  const dlg = page.getByRole('dialog', { name: '라벨 기능 끄기' })
  await expect(dlg).toBeVisible()
  await expect(dlg.getByRole('button', { name: '닫기' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dlg).toBeHidden()
  await expect(off).toBeFocused()
  await off.click()
  await dlg.getByRole('button', { name: '닫기' }).click()
  await expect(dlg).toBeHidden()
  expect(puts).toBe(0)
  expect((await labelSettings(page)).enabled).toBe(true)

  // 숫자 키 1로 끄기
  await off.click()
  await expect(dlg.getByRole('button', { name: '닫기' })).toBeFocused()
  await page.keyboard.press('1')
  await expect(section.getByRole('status').filter({ hasText: TURNED_OFF })).toBeVisible()
  await expect(section.getByText('라벨 기능: 꺼짐', { exact: true })).toBeVisible()
  const on = section.getByRole('button', { name: '라벨 켜기' })
  await expect(on).toBeFocused()
  expect(puts).toBe(1)
  expect((await labelSettings(page)).enabled).toBe(false)

  // 켜기는 창 없이 바로
  await on.click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(section.getByRole('status').filter({ hasText: TURNED_ON })).toBeVisible()
  await expect(section.getByText('라벨 기능: 켜짐', { exact: true })).toBeVisible()
  await expect(section.getByRole('button', { name: '라벨 끄기' })).toBeFocused()

  // 바꾼 기록: 새것 먼저, KST·요일·아이디
  const list = section.getByRole('list', { name: '바꾼 기록' })
  const items = list.getByRole('listitem')
  await expect(items).toHaveCount(Math.min(20, before + 2))
  const texts = await items.allTextContents()
  for (const t of texts) expect(t).toMatch(HISTORY_LINE)
  expect(texts[0]).toContain('라벨 켬')
  expect(texts[1]).toContain('라벨 끔')
  const api = await labelSettings(page)
  const kst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(api.history[0]!.at)).replace(',', '')
  expect(texts[0]!.replace(/ \([월화수목금토일]\)/, '')).toContain(kst)
  const dow = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', weekday: 'short' }).format(new Date(api.history[0]!.at))
  expect(texts[0]).toContain(`(${dow})`)
  await expect(settingsLink(page)).toHaveAttribute('aria-current', 'page')

  // 새로고침·주소로 바로 열어도 같은 화면
  await page.reload()
  await expect(page.getByRole('heading', { name: '설정', level: 1 })).toBeVisible()
  await expect(labelSection(page).getByText('라벨 기능: 켜짐', { exact: true })).toBeVisible()
})

test('AC-N4a-11: 대기 2장이면 끄기 창에 장 수 문장 · 같은 값 두 번 보내도 이력 한 줄', async ({ page }) => {
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  await postJson(page, '/api/print/pause', {})
  await registerApi(page, b, 1, '품종1', 1000)
  await registerApi(page, b, 2, '품종2', 1000)
  await smsApi(page, { b, no: 1 })
  await smsApi(page, { b, no: 2 })
  await expect.poll(async () => (await labelSettings(page)).waiting).toBe(2)
  await gotoSettings(page)
  await labelSection(page).getByRole('button', { name: '라벨 끄기' }).click()
  const dlg = page.getByRole('dialog', { name: '라벨 기능 끄기' })
  await expect(dlg).toContainText(offWaiting(2))
  await dlg.getByRole('button', { name: '닫기' }).click()

  const n = (await labelSettings(page)).history.length
  const a = await setLabels(page, false)
  const c = await setLabels(page, false)
  expect(a.changed).toBe(true)
  expect(c.changed).toBe(false)
  expect((await labelSettings(page)).history.length).toBe(Math.min(20, n + 1))
  // 대기 장 수는 끈 뒤에도 그대로 (끌 때 대기열을 바꾸지 않는다)
  expect((await labelSettings(page)).waiting).toBe(2)
})

test('AC-N4a-10·11·12: 휴대폰 375 — 아래 막대에 "설정"(켜짐 6칸·꺼짐 5칸, 칸마다 44px), 위 줄에 따로 링크 없음, 키보드만으로 끄기·켜기, 다른 기기의 변경이 1초 안에', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page)
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(page.url()).origin })
  const phone = await ctx.newPage()
  try {
    await login(phone)
    // D-N4a-07: "설정"은 아래 막대의 한 칸이고, 이름이 "설정"인 링크는 화면 전체에 하나뿐
    const menu = phone.getByRole('navigation', { name: '메뉴' })
    await expect(settingsLink(phone)).toBeVisible()
    await expect(phone.getByRole('link', { name: '설정', exact: true })).toHaveCount(1)
    const cells = menu.getByRole('link')
    const checkCells = async (n: number) => {
      await expect(cells).toHaveCount(n)
      for (const box of await Promise.all((await cells.all()).map((c) => c.boundingBox()))) {
        expect(box!.height).toBeGreaterThanOrEqual(44)
        expect(box!.width).toBeGreaterThanOrEqual(44)
      }
      await noHorizontalScroll(phone)
    }
    // 라벨 켜짐: "라벨"이 있는 칸 수(다른 메뉴가 늘어도 켜짐 = 꺼짐 + 1을 본다 — I2 "포장" 합친 뒤 7칸)
    await expect(menu.getByRole('link', { name: '라벨', exact: true })).toHaveCount(1)
    const onCount = await cells.count()
    expect(onCount).toBeGreaterThanOrEqual(6)
    await checkCells(onCount)
    expect(await settingsLink(phone).evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
    // 라벨 꺼짐: 다섯 칸("라벨"만 빠지고 "설정"은 그대로)
    await setLabels(page, false)
    await phone.reload()
    await expect(menu.getByRole('link', { name: '라벨', exact: true })).toHaveCount(0)
    await expect(settingsLink(phone)).toBeVisible()
    await checkCells(onCount - 1)
    await setLabels(page, true)
    await phone.reload()
    await expect(menu.getByRole('link', { name: '라벨', exact: true })).toHaveCount(1)
    await checkCells(onCount)
    await gotoSettings(phone)
    await noHorizontalScroll(phone)
    const section = labelSection(phone)
    const btn = section.getByRole('button', { name: '라벨 끄기' })
    const box = await btn.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
    const size = await btn.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    expect(size).toBeGreaterThanOrEqual(16)
    const helpSize = await section.getByText(SWITCH_HELP).evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    expect(helpSize).toBeGreaterThanOrEqual(16)

    // 키보드만: 포커스 → Enter → 1
    await btn.focus()
    await phone.keyboard.press('Enter')
    await expect(phone.getByRole('dialog', { name: '라벨 기능 끄기' })).toBeVisible()
    await noHorizontalScroll(phone)
    await phone.keyboard.press('1')
    await expect(section.getByText('라벨 기능: 꺼짐', { exact: true })).toBeVisible()

    // PC의 설정 화면이 1초 안에 바뀐다
    await gotoSettings(page)
    await expect(labelSection(page).getByText('라벨 기능: 꺼짐', { exact: true })).toBeVisible()
    const top = labelSection(page).getByRole('list', { name: '바꾼 기록' }).getByRole('listitem').first()
    await expect(top).toContainText('라벨 끔')
    // 휴대폰에서 켜기 (키보드)
    await expect(section.getByRole('button', { name: '라벨 켜기' })).toBeFocused()
    await phone.keyboard.press('Enter')
    await expect(section.getByText('라벨 기능: 켜짐', { exact: true })).toBeVisible()
    await expect(labelSection(page).getByText('라벨 기능: 켜짐', { exact: true })).toBeVisible({ timeout: 1_000 })
    await expect(top).toContainText('라벨 켬', { timeout: 1_000 })
    await expect(labelSection(page).getByRole('button', { name: '라벨 끄기' })).toBeVisible({ timeout: 1_000 })
    // 다른 기기의 변경은 이 화면에 알림 문장을 만들지 않는다
    await expect(labelSection(page).getByRole('status').filter({ hasText: TURNED_ON })).toHaveCount(0)

    // PC에서 API로 끄면 휴대폰 화면도 1초 안에
    await setLabels(page, false)
    await expect(section.getByText('라벨 기능: 꺼짐', { exact: true })).toBeVisible({ timeout: 1_000 })
    await expect(section.getByRole('list', { name: '바꾼 기록' }).getByRole('listitem').first()).toContainText('라벨 끔', { timeout: 1_000 })
  } finally {
    await ctx.close()
  }
})

test('AC-N4a-11: 보내는 동안 버튼은 눌리지 않는다 — 켜기를 빠르게 두 번 눌러도 이력 한 줄', async ({ page }) => {
  await login(page)
  await setLabels(page, false)
  await gotoSettings(page)
  const n = (await labelSettings(page)).history.length
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => { release = r })
  let puts = 0
  await page.route('**/api/settings/labels', async (route) => {
    if (route.request().method() === 'PUT') { puts += 1; await gate }
    await route.continue()
  })
  const on = labelSection(page).getByRole('button', { name: '라벨 켜기' })
  await on.click()
  await expect(on).toBeDisabled()
  await on.click({ force: true }).catch(() => {})
  await on.dispatchEvent('click')
  // 저장되기 전에는 "켜짐"·알림을 보이지 않는다 (NFR-03)
  await expect(labelSection(page).getByText('라벨 기능: 꺼짐', { exact: true })).toBeVisible()
  await expect(labelSection(page).getByText(TURNED_ON)).toHaveCount(0)
  release()
  await expect(labelSection(page).getByText('라벨 기능: 켜짐', { exact: true })).toBeVisible()
  expect(puts).toBe(1)
  expect((await labelSettings(page)).history.length).toBe(Math.min(20, n + 1))
})

test('AC-N4a-11: 끄기가 실패하면 서버 문장과 다시 해 볼 길 — 상태는 그대로 "켜짐"', async ({ page }) => {
  await login(page)
  await gotoSettings(page)
  let fail = true
  await page.route('**/api/settings/labels', async (route) => {
    if (route.request().method() === 'PUT' && fail) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: '잠시 연결이 불안정해요. 다시 해 주세요.' } }) })
      return
    }
    await route.continue()
  })
  const section = labelSection(page)
  await section.getByRole('button', { name: '라벨 끄기' }).click()
  const dlg = page.getByRole('dialog', { name: '라벨 기능 끄기' })
  await page.keyboard.press('1')
  await expect(dlg).toContainText('잠시 연결이 불안정해요. 다시 해 주세요.')
  await expect(section.getByText('라벨 기능: 켜짐', { exact: true })).toBeVisible()
  await expect(section.getByText(TURNED_OFF)).toHaveCount(0)
  fail = false
  await dlg.getByRole('button', { name: '라벨 끄기' }).click()
  await expect(dlg).toBeHidden()
  await expect(section.getByText('라벨 기능: 꺼짐', { exact: true })).toBeVisible()
})
