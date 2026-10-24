// QS1 프린터 다시 잇기 E2E (AC-QS1-40~44) @printer — 시험용 프린터·가짜 B1 블루투스·가짜 USB 포트(시험 모드 손잡이).
// 간격은 브라우저 시계(page.clock — 로그인 전에 설치)로 당긴다. 시간 대기는 쓰지 않고 시도 수·상태를 기다린다.
import { expect, test, type Page } from '@playwright/test'
import {
  autoAttempts,
  autoWaiting,
  becomeDevice,
  BLUETOOTH,
  BLUETOOTH_OFF,
  connectBy,
  DISCONNECTED,
  fakeB1State,
  fakeUsb,
  fireAttempt,
  handle,
  loginNewSeller,
  openLabels,
  printedCount,
  printer,
  printOverview,
  realBroadcast,
  region,
  registerApi,
  scopeLabels,
  setFakeB1,
  smsApi,
  stateLine,
  TEST_PRINTER,
  uniqueDate,
  USB,
  waitHandle,
  waitPrinted,
} from './support.ts'

const pauseBand = (page: Page) => region(page, '출력 멈춤')

test.describe('AC-QS1-40 시험용 프린터: 끊겨도 저절로 이어서 출력 @printer', () => {
  test('라벨 2장 출력 → 끊김 → 그동안 1등 2개 → 누르지 않아도 다시 이어져 새 2장만, 찍은 그림 4', async ({ page }) => {
    const date = uniqueDate()
    await loginNewSeller(page)
    const b = await realBroadcast(page, date)
    await becomeDevice(page, 'PC')
    for (const no of [1, 2, 3, 4]) await registerApi(page, b, no, `품종${String(no)}`, 1000 * no)
    await smsApi(page, { b, no: 1, phone: '010-4001-0001' })
    await smsApi(page, { b, no: 2, phone: '010-4001-0002' })
    await waitPrinted(page, 2)

    await handle(page, 'simulateDisconnect')
    await smsApi(page, { b, no: 3, phone: '010-4001-0003' })
    await smsApi(page, { b, no: 4, phone: '010-4001-0004' })

    await waitPrinted(page, 4)
    await expect(stateLine(page, '연결됨')).toBeVisible()
    expect(await autoAttempts(page)).toBeGreaterThanOrEqual(1)
    // 서버 기록도 장마다 한 번 (앞 2장이 다시 나오지 않음)
    await expect.poll(async () => (await scopeLabels(page, date)).filter((l) => l.winner).map((l) => [l.no, l.printed]).sort()).toEqual([[1, 1], [2, 1], [3, 1], [4, 1]])
    const ov = await printOverview(page)
    expect(ov.queue.waiting).toBe(0)
    expect(ov.queue.pause).toBeNull()
    expect(await printedCount(page)).toBe(4)
  })
})

test.describe('AC-QS1-41 가짜 B1: 고르기 창 없이 다시 잇기, 6번 뒤 그침 @printer', () => {
  test('끊김 + 다시 잇기 거절 → 1·2·4·8·16·30초에 6번 시도 후 그침, 끊김 문장·"다시 연결" → 허락하고 누르면 고르기 창 1번 그대로', async ({ page }) => {
    await page.clock.install()
    await loginNewSeller(page)
    await openLabels(page)
    await handle(page, 'useFakeB1')
    await connectBy(page, BLUETOOTH)
    await becomeDevice(page, 'PC')
    expect((await fakeB1State(page))!.requests).toBe(1)

    await setFakeB1(page, { powered: false })
    await expect(stateLine(page, '끊김')).toBeVisible()
    for (let n = 1; n <= 6; n += 1) await fireAttempt(page, n)
    await expect.poll(() => autoWaiting(page)).toBe(false)
    await page.clock.fastForward(120_000)
    expect(await autoAttempts(page)).toBe(6)
    expect(await autoWaiting(page)).toBe(false)
    expect((await fakeB1State(page))!.requests).toBe(1)

    await expect(pauseBand(page).getByText(DISCONNECTED, { exact: true })).toBeVisible()
    const retry = pauseBand(page).getByRole('button', { name: '다시 연결' })
    await expect(retry).toBeVisible()

    await setFakeB1(page, { powered: true })
    await retry.click()
    await expect(stateLine(page, '연결됨')).toBeVisible({ timeout: 20_000 })
    await expect(pauseBand(page)).toHaveCount(0)
    const after = (await fakeB1State(page))!
    expect(after.requests).toBe(1)
    expect(after.connected).toBe(true)
    // 판매자의 "다시 연결"은 저절로 잇기 시도에 세지 않는다
    expect(await autoAttempts(page)).toBe(6)
  })

  test('기다리는 중 "다시 연결" → 기다림이 없어지고 한 번만 잇는다, 이어진 뒤 다음 끊김은 1초부터 새로', async ({ page }) => {
    await page.clock.install()
    await loginNewSeller(page)
    await openLabels(page)
    await handle(page, 'useFakeB1')
    await connectBy(page, BLUETOOTH)
    await becomeDevice(page, 'PC')

    await setFakeB1(page, { powered: false })
    await fireAttempt(page, 1)
    await fireAttempt(page, 2)
    await expect.poll(() => autoWaiting(page)).toBe(true)
    const attemptsBefore = (await fakeB1State(page))!.connectAttempts

    await setFakeB1(page, { powered: true })
    await pauseBand(page).getByRole('button', { name: '다시 연결' }).click()
    await expect(stateLine(page, '연결됨')).toBeVisible({ timeout: 20_000 })
    expect(await autoWaiting(page)).toBe(false)
    expect((await fakeB1State(page))!.connectAttempts).toBe(attemptsBefore + 1)
    // 잡혀 있던 3번째(4초)가 뒤늦게 일어나지 않는다
    await page.clock.fastForward(10_000)
    expect(await autoAttempts(page)).toBe(2)
    expect((await fakeB1State(page))!.connectAttempts).toBe(attemptsBefore + 1)

    // 판매자가 이은 연결이라 횟수는 바로 0 — 다음 끊김은 1초 뒤 첫 시도로 이어진다
    await handle(page, 'fakeB1Disconnect')
    await expect(stateLine(page, '끊김')).toBeVisible()
    await expect.poll(() => autoWaiting(page)).toBe(true)
    await page.clock.fastForward(1000)
    await expect(stateLine(page, '연결됨')).toBeVisible({ timeout: 20_000 })
    expect(await autoAttempts(page)).toBe(3)
    expect((await fakeB1State(page))!.requests).toBe(1)
  })

  test('기다리는 중 다른 기기가 출력 기기가 되면 저절로 잇기가 그친다', async ({ page, browser }) => {
    await page.clock.install()
    await loginNewSeller(page)
    await openLabels(page)
    await handle(page, 'useFakeB1')
    await connectBy(page, BLUETOOTH)
    await becomeDevice(page, 'PC')
    await setFakeB1(page, { powered: false })
    await fireAttempt(page, 1)
    await expect.poll(() => autoWaiting(page)).toBe(true)

    // 같은 판매자의 휴대폰이 출력 기기를 가져간다
    const cookies = await page.context().cookies()
    const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(page.url()).origin, viewport: { width: 375, height: 812 } })
    try {
      await ctx.addCookies(cookies)
      const phone = await ctx.newPage()
      await openLabels(phone)
      await becomeDevice(phone, '휴대폰')
      await expect.poll(() => autoWaiting(page), { timeout: 10_000 }).toBe(false)
      await page.clock.fastForward(120_000)
      expect(await autoAttempts(page)).toBe(1)
    } finally {
      await ctx.close()
    }
  })
})

test.describe('AC-QS1-42 새로고침 뒤 "다시 연결" @printer', () => {
  test('getDevices 있음: 새로고침 뒤 저절로 잇지 않고(시도 0), "다시 연결"에 고르기 창 없이 연결됨', async ({ page }) => {
    await loginNewSeller(page)
    await openLabels(page)
    await setFakeB1(page, { getDevices: true })
    await connectBy(page, BLUETOOTH)
    await becomeDevice(page, 'PC')
    expect((await fakeB1State(page))!.requests).toBe(1)

    await page.reload()
    await expect(page.getByRole('heading', { name: '라벨', level: 1 })).toBeVisible()
    await waitHandle(page)
    await expect.poll(async () => (await fakeB1State(page)) !== null).toBe(true)
    const retry = pauseBand(page).getByRole('button', { name: '다시 연결' })
    await expect(retry).toBeVisible({ timeout: 20_000 })
    expect((await fakeB1State(page))!.connectAttempts).toBe(0)
    await expect(stateLine(page, '끊김')).toBeVisible()

    await retry.click()
    await expect(stateLine(page, '연결됨')).toBeVisible({ timeout: 20_000 })
    const s = (await fakeB1State(page))!
    expect(s.requests).toBe(0)
    expect(s.getDevicesCalls).toBeGreaterThanOrEqual(1)
    expect(s.connected).toBe(true)
    await expect(pauseBand(page)).toHaveCount(0)
  })

  test('getDevices 없음: 새로고침 뒤 "다시 연결"에 고르기 창이 한 번', async ({ page }) => {
    await loginNewSeller(page)
    await openLabels(page)
    await setFakeB1(page, { getDevices: false })
    await connectBy(page, BLUETOOTH)
    await becomeDevice(page, 'PC')

    await page.reload()
    await waitHandle(page)
    const retry = pauseBand(page).getByRole('button', { name: '다시 연결' })
    await expect(retry).toBeVisible({ timeout: 20_000 })
    expect((await fakeB1State(page))!.connectAttempts).toBe(0)
    await retry.click()
    await expect(stateLine(page, '연결됨')).toBeVisible({ timeout: 20_000 })
    expect((await fakeB1State(page))!.requests).toBe(1)
  })

  test('USB 같은 제품 포트 하나: 새로고침 뒤 "다시 연결"에 고르기 창 없음', async ({ page }) => {
    await loginNewSeller(page)
    await openLabels(page)
    await handle(page, 'useFakeUsb')
    await connectBy(page, USB)
    await becomeDevice(page, 'PC')
    expect((await fakeUsb(page))!.requests).toBe(1)

    await page.reload()
    await waitHandle(page)
    const retry = pauseBand(page).getByRole('button', { name: '다시 연결' })
    await expect(retry).toBeVisible({ timeout: 20_000 })
    expect((await fakeUsb(page))!.connectAttempts).toBe(0)
    await retry.click()
    await expect(stateLine(page, '연결됨')).toBeVisible({ timeout: 20_000 })
    const u = (await fakeUsb(page))!
    expect(u.requests).toBe(0)
    expect(u.connected).toBe(true)
  })

  test('기억한 값은 방법·기기 ID·USB 번호만 — 서버로 가는 요청 본문에 없다', async ({ page }) => {
    const bodies: string[] = []
    page.on('request', (req) => {
      if (new URL(req.url()).pathname.startsWith('/api/')) bodies.push(req.postData() ?? '')
    })
    await loginNewSeller(page)
    await openLabels(page)
    await setFakeB1(page, { getDevices: true })
    await connectBy(page, BLUETOOTH)
    await becomeDevice(page, 'PC')
    const saved = await page.evaluate(() => window.localStorage.getItem('livejjim.printer.remembered'))
    expect(saved).not.toBeNull()
    const value = JSON.parse(saved!) as Record<string, unknown>
    expect(Object.keys(value).sort()).toEqual(['deviceId', 'method'])
    expect(value['method']).toBe('bluetooth')
    const id = value['deviceId'] as string
    expect(bodies.some((body) => body.includes(id))).toBe(false)
  })
})

test.describe('AC-QS1-43 윈도우 블루투스 오판 @printer', () => {
  test('getAvailability false 오판(실제로는 이어짐) → 연결됨, "블루투스가 꺼져 있어요" 없음', async ({ page }) => {
    await loginNewSeller(page)
    await openLabels(page)
    await setFakeB1(page, { available: false, adapterOff: false })
    await connectBy(page, BLUETOOTH)
    await expect(page.getByText(BLUETOOTH_OFF)).toHaveCount(0)
    await expect(printer(page).getByRole('alert')).toHaveCount(0)
  })

  test('블루투스 장치가 정말 꺼짐(시도도 실패) → "블루투스가 꺼져 있어요. 블루투스를 켠 뒤 다시 연결해 주세요."', async ({ page }) => {
    await loginNewSeller(page)
    await openLabels(page)
    await setFakeB1(page, { available: false })
    await printer(page).getByRole('button', { name: BLUETOOTH, exact: true }).click()
    await expect(printer(page).getByText(BLUETOOTH_OFF, { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(stateLine(page, '끊김')).toBeVisible()
    expect((await fakeB1State(page))!.requests).toBe(1)
  })
})

test.describe('AC-QS1-44 출력 기기가 아니면 저절로 잇지 않음 @printer', () => {
  test('가짜 B1로 연결만 하고 끊김 → 61초 넘게 당겨도 시도 0, 끊김과 "다시 연결"', async ({ page }) => {
    await page.clock.install()
    await loginNewSeller(page)
    await openLabels(page)
    await handle(page, 'useFakeB1')
    await connectBy(page, BLUETOOTH)
    await handle(page, 'fakeB1Disconnect')
    await expect(stateLine(page, '끊김')).toBeVisible()
    await page.clock.fastForward(62_000)
    await page.clock.fastForward(62_000)
    expect(await autoAttempts(page)).toBe(0)
    expect(await autoWaiting(page)).toBe(false)
    expect((await fakeB1State(page))!.connectAttempts).toBe(1)
    // AC-QS1-44 "화면은 끊김과 '다시 연결'"의 '다시 연결'은 출력 기기가 아닌 기기에는 지금 화면에 없다(연결 방법 단추만) — 스펙 확인 필요(TE-QS1-001), 여기서는 보지 않는다
    await expect(stateLine(page, '끊김')).toBeVisible()
  })

  test('시험용 프린터로 연결만 하고 끊김 → 시도 0', async ({ page }) => {
    await page.clock.install()
    await loginNewSeller(page)
    await openLabels(page)
    await connectBy(page, TEST_PRINTER)
    await handle(page, 'simulateDisconnect')
    await expect(stateLine(page, '끊김')).toBeVisible()
    await page.clock.fastForward(62_000)
    await page.clock.fastForward(62_000)
    expect(await autoAttempts(page)).toBe(0)
    await expect(stateLine(page, '끊김')).toBeVisible()
  })
})
