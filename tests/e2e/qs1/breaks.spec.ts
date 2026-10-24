// QS1 흐름 깨뜨리기 (AC-QS1-22·23 화면 흐름) @printer — 출력 중 끊김·두 기기·새로고침·출력 그만하기.
import { expect, test, type Page } from '@playwright/test'
import {
  autoAttempts,
  autoWaiting,
  becomeDevice,
  BLUETOOTH,
  connectBy,
  DISCONNECTED,
  fakeB1State,
  fireAttempt,
  handle,
  loginNewSeller,
  openLabels,
  printedCount,
  printOverview,
  realBroadcast,
  region,
  registerApi,
  scopeLabels,
  setFakeB1,
  smsApi,
  stateLine,
  uniqueDate,
  waitHandle,
  waitPrinted,
} from './support.ts'

const pauseBand = (page: Page) => region(page, '출력 멈춤')

const winnersPrinted = async (page: Page, date: string) =>
  (await scopeLabels(page, date)).filter((l) => l.winner).map((l) => [l.no, l.printed]).sort((a, b) => a[0]! - b[0]!)

test('AC-QS1-23: 2장째를 찍는 중 끊김 → 저절로 이어져 2장째를 한 번 더 받아 찍고, 장마다 출력 한 번 @printer', async ({ page }) => {
  const date = uniqueDate()
  await loginNewSeller(page)
  const b = await realBroadcast(page, date)
  await becomeDevice(page, 'PC')
  await handle(page, 'setBehavior', 2, 'disconnect')
  for (const no of [1, 2, 3]) await registerApi(page, b, no, `품종${String(no)}`, 1000)
  for (const no of [1, 2, 3]) await smsApi(page, { b, no, phone: `010-4023-000${String(no)}` })
  await waitPrinted(page, 3)
  await expect(stateLine(page, '연결됨')).toBeVisible()
  await expect.poll(() => winnersPrinted(page, date)).toEqual([[1, 1], [2, 1], [3, 1]])
  expect(await autoAttempts(page)).toBe(1)
  expect(await printedCount(page)).toBe(3)
  const ov = await printOverview(page)
  expect(ov.queue.waiting).toBe(0)
  expect(ov.queue.pause).toBeNull()
})

test('두 기기: PC(출력 기기) 끊김 → 휴대폰에 끊김 멈춤이 보였다가, 저절로 이어지면 양쪽에서 풀린다 @printer', async ({ page, browser }) => {
  await page.clock.install()
  await loginNewSeller(page)
  await openLabels(page)
  await handle(page, 'useFakeB1')
  await connectBy(page, BLUETOOTH)
  await becomeDevice(page, 'PC')
  const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(page.url()).origin, viewport: { width: 375, height: 812 } })
  try {
    await ctx.addCookies(await page.context().cookies())
    const phone = await ctx.newPage()
    await openLabels(phone)
    await setFakeB1(page, { powered: false })
    await expect(pauseBand(phone).getByText(DISCONNECTED, { exact: true })).toBeVisible()
    await expect(pauseBand(phone).getByText("출력 기기 'PC'에서 다시 연결해 주세요.", { exact: true })).toBeVisible()
    await fireAttempt(page, 1)
    await setFakeB1(page, { powered: true })
    await fireAttempt(page, 2)
    await expect(stateLine(page, '연결됨')).toBeVisible()
    await expect(pauseBand(page)).toHaveCount(0)
    await expect(pauseBand(phone)).toHaveCount(0)
    expect((await fakeB1State(page))!.requests).toBe(1)
  } finally {
    await ctx.close()
  }
})

test('기다리는 중 "출력 그만하기" → 저절로 잇기가 그친다 @printer', async ({ page }) => {
  await page.clock.install()
  await loginNewSeller(page)
  await openLabels(page)
  await handle(page, 'useFakeB1')
  await connectBy(page, BLUETOOTH)
  await becomeDevice(page, 'PC')
  await setFakeB1(page, { powered: false })
  await fireAttempt(page, 1)
  await expect.poll(() => autoWaiting(page)).toBe(true)
  await region(page, '프린터').getByRole('button', { name: '출력 그만하기' }).click()
  await expect.poll(() => autoWaiting(page)).toBe(false)
  await page.clock.fastForward(120_000)
  expect(await autoAttempts(page)).toBe(1)
})

test('기다리는 중 새로고침 → 새 페이지는 저절로 잇지 않는다(시도 0) @printer', async ({ page }) => {
  await page.clock.install()
  await loginNewSeller(page)
  await openLabels(page)
  await setFakeB1(page, { getDevices: true })
  await connectBy(page, BLUETOOTH)
  await becomeDevice(page, 'PC')
  await setFakeB1(page, { powered: false })
  await fireAttempt(page, 1)
  await page.reload()
  await waitHandle(page)
  await expect(pauseBand(page).getByRole('button', { name: '다시 연결' })).toBeVisible({ timeout: 20_000 })
  await page.clock.fastForward(70_000)
  expect(await autoAttempts(page)).toBe(0)
  expect((await fakeB1State(page))!.connectAttempts).toBe(0)
  // 전원을 켜고 "다시 연결" 한 번 → 고르기 창 없이
  await setFakeB1(page, { powered: true })
  await pauseBand(page).getByRole('button', { name: '다시 연결' }).click()
  await expect(stateLine(page, '연결됨')).toBeVisible({ timeout: 20_000 })
  expect((await fakeB1State(page))!.requests).toBe(0)
})

test('USB 선을 뽑았다 다시 꽂음 → 다음 저절로 잇기 시도에서 고르기 창 없이 이어진다 @printer', async ({ page }) => {
  await page.clock.install()
  await loginNewSeller(page)
  await openLabels(page)
  await handle(page, 'useFakeUsb')
  await connectBy(page, 'USB 선으로 연결')
  await becomeDevice(page, 'PC')
  await handle(page, 'unplugFakeUsb', 0)
  await expect(stateLine(page, '끊김')).toBeVisible()
  await fireAttempt(page, 1)
  await expect(stateLine(page, '끊김')).toBeVisible()
  await handle(page, 'plugFakeUsb', 0)
  await fireAttempt(page, 2)
  await expect(stateLine(page, '연결됨')).toBeVisible({ timeout: 20_000 })
  await expect(pauseBand(page)).toHaveCount(0)
  const usb = await handle<{ requests: number; connected: boolean }>(page, 'fakeUsb')
  expect(usb.requests).toBe(1)
  expect(usb.connected).toBe(true)
})
