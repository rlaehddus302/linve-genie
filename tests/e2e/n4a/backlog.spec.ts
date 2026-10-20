// AC-N4a-31 (끈 동안의 대기 라벨·버릴 라벨), AC-N4a-16 (버릴 라벨은 꺼져 있어도 남는다), AC-N4a-06 변형(멈추지 않은 대기열 → 켜면 쌓인 라벨)
import { expect, test, type Page } from '@playwright/test'
import { backlogWord, becomeDevice, cleanupN4a, gotoSettings, labelSection, login, OFF_NOTE, offWaiting, postJson, printedCount, printOverview, realBroadcast, region, registerApi, scopeLabels, setLabels, smsApi, uniqueDate, untilElapsed, waitPrinted, writeEvent } from './support.ts'

test.afterEach(async ({ page }) => {
  await cleanupN4a(page)
})

async function cancelWinner(page: Page, b: string, date: string, no: number): Promise<void> {
  const day = await (await page.request.get(`/api/days/${date}`)).json() as { claims: { buyer: string; no: number; status: string }[] }
  const c = day.claims.find((x) => x.no === no && x.status === 'CONFIRMED')!
  const res = await writeEvent(page, { type: 'host.cancel', b, no, buyer: c.buyer, reason: '시험' })
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
}

test('AC-N4a-31·16: 판매자 멈춤 + 대기 2장에서 끈다 → 1의 1등 취소 → 버릴 라벨 1(두 기기), "출력 멈춤" 없음, 버렸어요 → 사라짐, 켜면 멈춤 그대로 → 다시 시작 → 2·3', async ({ page, browser }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(page.url()).origin, isMobile: true, hasTouch: true })
  const phone = await ctx.newPage()
  try {
    await login(phone)
    await becomeDevice(phone, '휴대폰')
    for (let no = 1; no <= 3; no += 1) await registerApi(page, b, no, `품종${String(no)}`, 1000)
    await smsApi(page, { b, no: 1, phone: '010-2323-0001' })
    await waitPrinted(phone, 1)
    await postJson(page, '/api/print/pause', {})
    await smsApi(page, { b, no: 2, phone: '010-2323-0002' })
    await smsApi(page, { b, no: 3, phone: '010-2323-0003' })
    await expect.poll(async () => (await printOverview(page)).queue.waiting).toBe(2)

    // 끄기 확인 창에 대기 2장
    await gotoSettings(page)
    await labelSection(page).getByRole('button', { name: '라벨 끄기' }).click()
    const dlg = page.getByRole('dialog', { name: '라벨 기능 끄기' })
    await expect(dlg).toContainText(offWaiting(2))
    await page.keyboard.press('1')
    await expect(labelSection(page).getByText('라벨 기능: 꺼짐', { exact: true })).toBeVisible()
    await page.goBack()
    await expect(page.getByLabel('빠른 입력')).toBeVisible()

    await cancelWinner(page, b, date, 1)
    const strip = page.getByRole('region', { name: '알림' })
    await expect(strip).toContainText('버릴 라벨 1')
    await expect(strip).not.toContainText('출력 멈춤')

    // 휴대폰 /labels: 안내 + 버릴 라벨 절만
    const main = phone.getByRole('main')
    await expect(main).toContainText(OFF_NOTE)
    const discard = region(phone, '버릴 라벨')
    await expect(discard).toBeVisible({ timeout: 1_000 })
    await expect(main.getByRole('region')).toHaveCount(1)
    await expect(main.getByRole('button', { name: /테스트 인쇄|이 기기에서 출력|다시 시작|출력 시작|다시 연결|라벨 설정 저장/ })).toHaveCount(0)
    await discard.getByRole('button', { name: /버렸어요/ }).first().click()
    await expect(strip).not.toContainText('버릴 라벨', { timeout: 1_000 })
    await expect(discard).toHaveCount(0, { timeout: 1_000 })
    expect((await printOverview(page)).discard).toHaveLength(0)

    // 켠다 → 판매자 멈춤 그대로("다시 시작"), 대기 2장
    await setLabels(page, true)
    const pause = region(phone, '출력 멈춤')
    await expect(pause).toBeVisible({ timeout: 1_000 })
    await expect(pause.getByRole('button', { name: '다시 시작' })).toBeVisible()
    const ov = await printOverview(page)
    expect(ov.queue.pause?.reason).toBe('SELLER')
    expect(ov.queue.waiting).toBe(2)
    expect(await printedCount(phone)).toBe(1)
    await pause.getByRole('button', { name: '다시 시작' }).click()
    await waitPrinted(phone, 3)
    const order = (await scopeLabels(page, date)).filter((l) => l.printed > 0).sort((x, y) => Date.parse(x.history[0]!.at) - Date.parse(y.history[0]!.at)).map((l) => l.no)
    expect(order).toEqual([1, 2, 3])
  } finally {
    await ctx.close()
  }
})

test('AC-N4a-31 변형·06: 출력 기기가 끊겨 대기 2장(멈추지 않음)에서 끄고 켜면 쌓인 라벨 안내·"출력 시작" — 누르기 전에는 출력하지 않는다', async ({ page, browser }) => {
  test.setTimeout(180_000)
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(page.url()).origin })
  const old = await ctx.newPage()
  await login(old)
  await becomeDevice(old, '옛 기기')
  await ctx.close()
  await registerApi(page, b, 2, '품종2', 1000)
  await registerApi(page, b, 3, '품종3', 1000)
  await smsApi(page, { b, no: 2, phone: '010-2424-0002' })
  await smsApi(page, { b, no: 3, phone: '010-2424-0003' })
  await expect.poll(async () => (await printOverview(page)).queue.waiting).toBe(2)
  expect((await printOverview(page)).queue.pause).toBeNull()

  await setLabels(page, false)
  await setLabels(page, true)
  const ov = await printOverview(page)
  expect(ov.queue.pause).toMatchObject({ reason: 'SELLER', backlog: true })

  // 이 기기를 출력 기기로 — 쌓인 라벨 안내와 "출력 시작", 누르기 전에는 출력하지 않는다
  await becomeDevice(page, 'PC')
  await expect(page.getByText(backlogWord(2))).toBeVisible()
  const start = page.getByRole('button', { name: '출력 시작' })
  await expect(start).toBeVisible()
  const t = await page.evaluate(() => Date.now())
  await untilElapsed(page, t, 2_000)
  expect(await printedCount(page)).toBe(0)
  await start.click()
  await waitPrinted(page, 2)
})

test('AC-N4a-14·16: 꺼진 채로(대기열 멈춤) 콘솔 Alt+1 → 출력 멈춤을 건너뛰고 버릴 라벨 창 → 숫자 키로 버렸어요', async ({ page }) => {
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  await becomeDevice(page, 'PC')
  await page.goBack()
  await registerApi(page, b, 15, '핑크프릴', 10000)
  await smsApi(page, { b, no: 15, phone: '010-2525-0015' })
  await waitPrinted(page, 1)
  await postJson(page, '/api/print/pause', {})
  await setLabels(page, false)
  await cancelWinner(page, b, date, 15)
  const strip = page.getByRole('region', { name: '알림' })
  await expect(strip).toContainText('버릴 라벨 1')
  await expect(strip).not.toContainText('출력 멈춤')
  await page.getByLabel('빠른 입력').focus()
  await page.keyboard.press('Alt+1')
  const dlg = page.getByRole('dialog', { name: '버릴 라벨' })
  await expect(dlg).toBeVisible()
  await page.keyboard.press('1')
  await expect(strip).not.toContainText('버릴 라벨')
  expect((await printOverview(page)).discard).toHaveLength(0)
})
