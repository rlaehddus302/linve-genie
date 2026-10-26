// QL2 프린터 "다시 연결" (AC-QL2-10~12, D-QL2-03, L-7) · 저절로 다시 잇는 동안·그친 뒤 문장 (AC-QL2-13~15, D-QL2-04, L-11 8) @printer — test-e2e.
// 시험 모드의 가짜 B1 블루투스·시험용 프린터(window.livejjimTestPrinter — QS1 support). 간격은 브라우저 시계(page.clock — 로그인 전에 설치)로 당긴다.
// 시간 대기는 쓰지 않고 시도 수·화면 상태를 기다린다. 판매자는 시험마다 새로.
import { expect, test, type Page } from '@playwright/test'
import { clickMenu } from '../menu.ts'
import {
  BLUETOOTH,
  TEST_PRINTER,
  autoAttempts,
  autoWaiting,
  becomeDevice,
  connectBy,
  fakeB1State,
  fireAttempt,
  handle,
  loginNewSeller,
  openLabels,
  printer,
  realBroadcast,
  region,
  setFakeB1,
  stateLine,
  uniqueDate,
} from '../qs1/support.ts'
import { DISCONNECT_ALERT, GAVE_UP, alerts, before, expectOrder, reconnecting, setLabelsApi } from './support.ts'

const RECONNECT = '다시 연결'
const pauseBand = (page: Page) => region(page, '출력 멈춤')
/** 화면 전체의 "다시 연결" 단추 (이름 정확히) */
const allReconnect = (page: Page) => page.getByRole('button', { name: RECONNECT, exact: true })

test.describe('AC-QL2-10 출력 기기가 아닌 기기에도 "다시 연결" @printer', () => {
  test('가짜 B1(허락됨·getDevices) 연결만 → 끊김 → 61초 넘게 당겨도 시도 0, 프린터 칸에 "다시 연결"이 연결 방법 줄 위 → 누르면 연결됨·고르기 창 1번 그대로', async ({ page }) => {
    await page.clock.install()
    await loginNewSeller(page)
    await openLabels(page)
    await setFakeB1(page, { getDevices: true })
    await connectBy(page, BLUETOOTH)
    expect((await fakeB1State(page))!.requests).toBe(1)
    await handle(page, 'fakeB1Disconnect')
    await expect(stateLine(page, '끊김')).toBeVisible()
    await page.clock.fastForward(62_000)
    await page.clock.fastForward(62_000)
    expect(await autoAttempts(page)).toBe(0)
    expect(await autoWaiting(page)).toBe(false)

    const retry = printer(page).getByRole('button', { name: RECONNECT, exact: true })
    await expect(retry).toBeVisible()
    const method = printer(page).getByRole('button', { name: BLUETOOTH, exact: true })
    await expect(method).toBeVisible()
    expect(await before(retry, method), '"다시 연결"이 연결 방법 단추 앞').toBe(true)
    const rb = (await retry.boundingBox())!
    const mb = (await method.boundingBox())!
    expect(rb.y + rb.height, '"다시 연결"이 연결 방법 줄 위').toBeLessThanOrEqual(mb.y + 0.5)
    await expect(allReconnect(page)).toHaveCount(1)

    await retry.click()
    await expect(stateLine(page, '연결됨')).toBeVisible({ timeout: 20_000 })
    const s = (await fakeB1State(page))!
    expect(s.requests).toBe(1)
    expect(s.connected).toBe(true)
  })

  test('시험용 프린터로 연결만 → 끊김 → 같은 "다시 연결"로 다시 연결됨', async ({ page }) => {
    await page.clock.install()
    await loginNewSeller(page)
    await openLabels(page)
    await connectBy(page, TEST_PRINTER)
    await handle(page, 'simulateDisconnect')
    await expect(stateLine(page, '끊김')).toBeVisible()
    await page.clock.fastForward(62_000)
    expect(await autoAttempts(page)).toBe(0)
    const retry = printer(page).getByRole('button', { name: RECONNECT, exact: true })
    await expect(retry).toBeVisible()
    expect(await before(retry, printer(page).getByRole('button', { name: TEST_PRINTER, exact: true }))).toBe(true)
    await retry.click()
    await expect(stateLine(page, '연결됨')).toBeVisible({ timeout: 20_000 })
  })
})

test.describe('AC-QL2-11 오류 상자의 "다시 연결" @printer', () => {
  test('한 번 연결에 성공한 뒤 끊김 + 전원 꺼짐 → 프린터 칸 "다시 연결" 실패 → 오류 상자 안(해볼 일 아래) "다시 연결" 하나, 프린터 칸 단추는 사라짐 → 전원 켜고 누르면 고르기 창 한 번(수 +1) 뒤 연결됨', async ({ page }) => {
    await loginNewSeller(page)
    await openLabels(page)
    await setFakeB1(page, { getDevices: true })
    await connectBy(page, BLUETOOTH)
    await setFakeB1(page, { powered: false })
    await expect(stateLine(page, '끊김')).toBeVisible()
    await printer(page).getByRole('button', { name: RECONNECT, exact: true }).click()
    const box = printer(page).getByRole('alert')
    await expect(box).toBeVisible({ timeout: 20_000 })
    const tips = box.getByRole('list', { name: '해볼 일' })
    await expect(tips).toBeVisible()
    const boxRetry = box.getByRole('button', { name: RECONNECT, exact: true })
    await expect(boxRetry).toBeVisible()
    expect(await before(tips, boxRetry), '해볼 일 목록 → "다시 연결"').toBe(true)
    // 한 화면 하나 — 프린터 칸의 단추는 사라진다
    await expect(allReconnect(page)).toHaveCount(1)

    await setFakeB1(page, { powered: true })
    const asked = (await fakeB1State(page))!.requests
    await boxRetry.click()
    await expect(stateLine(page, '연결됨')).toBeVisible({ timeout: 20_000 })
    expect((await fakeB1State(page))!.connected).toBe(true)
    // QL2 D-QL2-12 (3): L-7 (4) — 기억한 기기로 이은 시도가 실패하면 기억을 지우므로 고르기 창이 한 번 더 뜬다(수 +1)
    expect((await fakeB1State(page))!.requests, '오류 상자 "다시 연결" 고르기 창 수').toBe(asked + 1)
  })

  test('한 번도 연결에 성공하지 못한 기기(첫 연결 실패) → 오류 상자 "다시 연결" → 고르기 창이 뜬다 (AC-FB1-40 그대로)', async ({ page }) => {
    await loginNewSeller(page)
    await openLabels(page)
    await handle(page, 'useFakeB1')
    await handle(page, 'setUnansweredNegotiations', 2)
    await printer(page).getByRole('button', { name: BLUETOOTH, exact: true }).click()
    const box = printer(page).getByRole('alert')
    await expect(box.getByRole('button', { name: RECONNECT, exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(allReconnect(page)).toHaveCount(1)
    expect((await fakeB1State(page))!.requests).toBe(1)
    await handle(page, 'setUnansweredNegotiations', 0)
    await box.getByRole('button', { name: RECONNECT, exact: true }).click()
    await expect(stateLine(page, '연결됨')).toBeVisible({ timeout: 20_000 })
    expect((await fakeB1State(page))!.requests).toBe(2)
  })
})

test.describe('AC-QL2-12 한 화면에 "다시 연결"은 하나 @printer', () => {
  test('출력 기기(가짜 B1) 끊김 멈춤, 저절로 잇기 끔 → 라벨 화면의 "다시 연결"은 정확히 하나(멈춤 띠)이고 주 버튼', async ({ page }) => {
    await loginNewSeller(page)
    await openLabels(page)
    await setFakeB1(page, { getDevices: true })
    await connectBy(page, BLUETOOTH)
    await becomeDevice(page, 'PC')
    await handle(page, 'setAutoReconnect', false)
    await handle(page, 'fakeB1Disconnect')
    await expect(stateLine(page, '끊김')).toBeVisible()
    await expect(pauseBand(page)).toContainText('프린터 연결이 끊겼어요.', { timeout: 20_000 })
    const only = allReconnect(page)
    await expect(only).toHaveCount(1)
    await expect(pauseBand(page).getByRole('button', { name: RECONNECT, exact: true })).toBeVisible()
    await expect(only).toHaveClass(/button-primary/)
  })

  test('마법사 4/5(멈춤 띠 없음)에서 이 기기 프린터(출력 기기)가 끊김 → 프린터 칸의 "다시 연결" 하나', async ({ page }) => {
    await loginNewSeller(page)
    const origin = new URL(page.url()).origin
    await setLabelsApi(page, true)
    const wiz = await page.request.put('/api/wizard', { data: { status: 'IN_PROGRESS', step: 4 }, headers: { Origin: origin } })
    expect(wiz.ok(), await wiz.text()).toBe(true)
    await page.goto('/start')
    await expect(page.getByRole('heading', { level: 2, name: '4/5 프린터 연결' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => 'livejjimTestPrinter' in window)).toBe(true)
    const box = printer(page)
    await box.getByRole('group', { name: '연결 방법' }).getByRole('button', { name: TEST_PRINTER }).click()
    await expect(box.getByText('이 기기의 프린터: 연결됨')).toBeVisible()
    await box.getByRole('button', { name: '테스트 인쇄' }).click()
    await box.getByRole('group', { name: '테스트 인쇄 결과' }).getByRole('button', { name: '예' }).click()
    await box.getByLabel('기기 이름').fill('PC')
    await box.getByRole('button', { name: '이 기기에서 출력' }).click()
    await expect(box.getByText('이 기기가 출력 기기예요')).toBeVisible()
    await handle(page, 'setAutoReconnect', false)
    await handle(page, 'simulateDisconnect')
    await expect(box.getByText(/^이 기기의 프린터: 끊김/)).toBeVisible()
    await expect(pauseBand(page)).toHaveCount(0)
    await expect.poll(async () => (await (await page.request.get('/api/print')).json() as { queue: { pause: { reason: string } | null } }).queue.pause?.reason ?? null, { timeout: 20_000 }).toBe('DISCONNECTED')
    await expect(allReconnect(page)).toHaveCount(1)
    await expect(box.getByRole('button', { name: RECONNECT, exact: true })).toBeVisible()
  })
})

/** 가짜 B1 출력 기기 + 실제 방송 하나 — 기기 쪽 끊김 + 다시 잇기 거절(전원 꺼짐) */
async function poweredOffStation(page: Page): Promise<{ b: string }> {
  await page.clock.install()
  await loginNewSeller(page)
  const b = await realBroadcast(page, uniqueDate())
  await openLabels(page)
  await setFakeB1(page, { getDevices: true })
  await connectBy(page, BLUETOOTH)
  await becomeDevice(page, 'PC')
  await setFakeB1(page, { powered: false })
  await expect(stateLine(page, '끊김')).toBeVisible()
  return { b }
}

test.describe('AC-QL2-13·14 저절로 다시 잇는 동안·그친 뒤 @printer', () => {
  test('끊긴 직후 멈춤 띠 "프린터 연결이 끊겼어요." 바로 아래 status "(1/6)" → 시도마다 (2/6)…(6/6) → 6번째 실패 뒤 그친 문장·해볼 일·"다시 연결" → 허락하고 누르면 연결됨·두 문장 없음', async ({ page }) => {
    await poweredOffStation(page)
    const band = pauseBand(page)
    const cause = band.getByText('프린터 연결이 끊겼어요.', { exact: true })
    await expect(cause).toBeVisible({ timeout: 20_000 })
    const status = band.getByRole('status').filter({ hasText: '프린터에 다시 잇고 있어요.' })
    await expect(status).toHaveText(reconnecting(1))
    expect(await before(cause, status)).toBe(true)
    for (let n = 1; n <= 5; n += 1) {
      await fireAttempt(page, n)
      await expect(status).toHaveText(reconnecting(n + 1))
    }
    await fireAttempt(page, 6)
    await expect.poll(() => autoWaiting(page)).toBe(false)
    await expect(band.getByText(/프린터에 다시 잇고 있어요/)).toHaveCount(0)
    const gaveUp = band.getByText(GAVE_UP, { exact: true })
    await expect(gaveUp).toBeVisible()
    const tips = band.getByRole('list', { name: '해볼 일' })
    await expect(tips).toBeVisible()
    expect(await tips.getByRole('listitem').count()).toBeGreaterThan(0)
    const retry = band.getByRole('button', { name: '다시 연결', exact: true })
    await expectOrder([['까닭', cause], ['그친 문장', gaveUp], ['해볼 일', tips], ['다시 연결', retry]], '그친 뒤 차례')
    await expect(allReconnect(page)).toHaveCount(1)

    await setFakeB1(page, { powered: true })
    await retry.click()
    await expect(stateLine(page, '연결됨')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/프린터에 다시 잇고 있어요/)).toHaveCount(0)
    await expect(page.getByText(GAVE_UP)).toHaveCount(0)
  })

  test('잇는 동안 알림 띠 "출력 멈춤" 창에도 같은 문장 (앱 안 이동)', async ({ page }) => {
    const { b } = await poweredOffStation(page)
    await expect(pauseBand(page).getByRole('status').filter({ hasText: reconnecting(1) })).toBeVisible({ timeout: 20_000 })
    // 앱 안 이동으로 콘솔 (전체 새로고침은 연결을 버린다)
    await clickMenu(page, '방송')
    // 새 판매자라 방송은 이것 하나
    await page.getByRole('list', { name: '방송' }).getByRole('link').first().click()
    await expect(page).toHaveURL(new RegExp(`/broadcasts/${encodeURIComponent(b)}$`))
    await expect(page.getByLabel('빠른 입력')).toBeVisible()
    await alerts(page).getByRole('button', { name: DISCONNECT_ALERT, exact: true }).click()
    const dlg = page.getByRole('dialog', { name: '출력 멈춤' })
    await expect(dlg.getByRole('status').filter({ hasText: reconnecting(1) })).toBeVisible()
    await fireAttempt(page, 1)
    await expect(dlg.getByText(reconnecting(2), { exact: true })).toBeVisible()
  })

  test('그친 뒤 다른 연결 방법(시험용 프린터)을 고르면 두 문장이 없어진다', async ({ page }) => {
    await poweredOffStation(page)
    for (let n = 1; n <= 6; n += 1) await fireAttempt(page, n)
    await expect(pauseBand(page).getByText(GAVE_UP, { exact: true })).toBeVisible()
    await printer(page).getByRole('button', { name: TEST_PRINTER, exact: true }).click()
    await expect(stateLine(page, '연결됨')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(GAVE_UP)).toHaveCount(0)
    await expect(page.getByText(/프린터에 다시 잇고 있어요/)).toHaveCount(0)
  })

  test('그친 뒤 라벨 기능을 끄면 두 문장이 없어진다', async ({ page }) => {
    await poweredOffStation(page)
    for (let n = 1; n <= 6; n += 1) await fireAttempt(page, n)
    await expect(pauseBand(page).getByText(GAVE_UP, { exact: true })).toBeVisible()
    await setLabelsApi(page, false)
    await expect(page.getByText(GAVE_UP)).toHaveCount(0, { timeout: 20_000 })
    await expect(page.getByText(/프린터에 다시 잇고 있어요/)).toHaveCount(0)
  })
})

test.describe('AC-QL2-15 다른 기기에는 없음 @printer', () => {
  test('같은 판매자의 다른 기기(PC 페이지): 잇는 중·그친 뒤 문장이 없고 "출력 기기 \'PC\'에서 다시 연결해 주세요."·알림 띠 "출력 멈춤 · 프린터 연결이 끊겼어요."는 그대로', async ({ page, browser }) => {
    const { b } = await poweredOffStation(page)
    await expect(pauseBand(page).getByRole('status').filter({ hasText: reconnecting(1) })).toBeVisible({ timeout: 20_000 })
    const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(page.url()).origin, viewport: { width: 1440, height: 900 } })
    try {
      await ctx.addCookies(await page.context().cookies())
      const other = await ctx.newPage()
      await openLabels(other)
      const band = pauseBand(other)
      await expect(band).toContainText('프린터 연결이 끊겼어요.')
      await expect(band).toContainText("출력 기기 'PC'에서 다시 연결해 주세요.")
      await expect(other.getByText(/프린터에 다시 잇고 있어요/)).toHaveCount(0)
      await expect(other.getByText(GAVE_UP)).toHaveCount(0)
      // 출력 기기가 그친 뒤에도 다른 기기에는 없다
      for (let n = 1; n <= 6; n += 1) await fireAttempt(page, n)
      await expect(pauseBand(page).getByText(GAVE_UP, { exact: true })).toBeVisible()
      await other.goto(`/broadcasts/${encodeURIComponent(b)}`)
      await expect(alerts(other).getByRole('button', { name: DISCONNECT_ALERT, exact: true })).toBeVisible()
      await expect(other.getByText(GAVE_UP)).toHaveCount(0)
      await expect(other.getByText(/프린터에 다시 잇고 있어요/)).toHaveCount(0)
    } finally {
      await ctx.close()
    }
  })
})
