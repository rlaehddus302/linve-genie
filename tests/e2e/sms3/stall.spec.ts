// 받기 멈춤 알림 (AC-SMS3-31, SPEC ORD-13 "받기 상태") — 브라우저 가짜 시계(page.clock)로 10분을 넘긴다(시간 기다림 없음).
// "실제 방송 시작 뒤 10분 넘게 받은 것이 없음(토큰이 켜진 판매자) → 콘솔 위 문구. 닫으면 그 방송에서 다시 안 보인다. 무엇이든 받으면 사라진다."
// 서버 시각은 진짜 시계라, 브라우저 시계를 "지금 − 11분"에 두고 콘솔을 연 뒤 11분 앞으로 감는다(감은 뒤 브라우저 시각 ≈ 서버 시각).
import { test, expect, type Page } from '@playwright/test'
import { fakeDevice, makeTokenApi, openConsole, phoneNo, postJson, realBroadcast, sellerAt, kstToday, type Width } from './support.ts'

const STALL = '휴대폰에서 문자가 오지 않고 있어요. 앱의 알림 읽기가 켜져 있는지 확인해 주세요.'
const MIN = 60_000

function stall(page: Page) {
  return page.getByRole('alert').filter({ hasText: STALL })
}

for (const width of ['PC', '375'] as const satisfies readonly Width[]) {
  test(`AC-SMS3-31 (${width}): 10분 넘게 받은 것이 없으면 콘솔 위 알림 → 무엇이든 받으면 사라진다`, async ({ browser, baseURL }) => {
    const { page, context } = await sellerAt(browser, baseURL!, width)
    const token = await makeTokenApi(page)
    const b = await realBroadcast(page)
    await page.clock.install({ time: new Date(Date.now() - 11 * MIN) })
    await openConsole(page, b)
    await expect(stall(page)).toHaveCount(0)
    await page.clock.fastForward(9 * MIN)
    await expect(stall(page), '10분 전에는 보이지 않는다').toHaveCount(0)
    await page.clock.fastForward(2 * MIN + 1_000)
    await expect(stall(page)).toBeVisible()
    // 손님 문자가 아닌 것이라도 무엇이든 받으면 사라진다
    const device = await fakeDevice(baseURL!, token)
    await device.sms(phoneNo(), '안녕하세요', 'IGNORED')
    await expect(stall(page)).toHaveCount(0)
    await device.dispose()
    await context.close()
  })
}

test('AC-SMS3-31 닫으면 그 방송에서 다시 안 보인다 (새로고침해도)', async ({ browser, baseURL }) => {
  const { page, context } = await sellerAt(browser, baseURL!, 'PC')
  await makeTokenApi(page)
  const b = await realBroadcast(page)
  await page.clock.install({ time: new Date(Date.now() - 11 * MIN) })
  await openConsole(page, b)
  await page.clock.fastForward(11 * MIN)
  await expect(stall(page)).toBeVisible()
  await stall(page).getByRole('button', { name: '닫기' }).click()
  await expect(stall(page)).toHaveCount(0)
  await page.clock.fastForward(11 * MIN)
  await expect(page.getByRole('region', { name: '상품 보드' })).toBeVisible()
  await expect(stall(page)).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('region', { name: '상품 보드' })).toBeVisible()
  await page.clock.fastForward(11 * MIN)
  await expect(page.getByRole('region', { name: '상품 보드' })).toBeVisible()
  await expect(stall(page)).toHaveCount(0)
  await context.close()
})

test('AC-SMS3-31 보이지 않을 때: 토큰이 없는 판매자 · 리허설 방송', async ({ browser, baseURL }) => {
  const { page, context } = await sellerAt(browser, baseURL!, 'PC')
  const b = await realBroadcast(page)
  await page.clock.install({ time: new Date(Date.now() - 11 * MIN) })
  await openConsole(page, b)
  await page.clock.fastForward(11 * MIN)
  await expect(page.getByRole('region', { name: '상품 보드' })).toBeVisible()
  await expect(stall(page), '토큰이 없으면 보이지 않는다').toHaveCount(0)
  await makeTokenApi(page)
  const res = await postJson(page, '/api/broadcasts', { requestId: crypto.randomUUID(), date: kstToday(), rehearsal: true, title: '리허설' })
  const rb = (res.body['result'] as { b?: string } | undefined)?.b ?? (res.body['broadcast'] as { id?: string } | undefined)?.id
  expect(typeof rb).toBe('string')
  await openConsole(page, rb!)
  await page.clock.fastForward(11 * MIN)
  await expect(page.getByRole('region', { name: '상품 보드' })).toBeVisible()
  await expect(stall(page), '리허설에는 보이지 않는다').toHaveCount(0)
  await context.close()
})

test('TE-SMS3-002 AC-SMS3-31 방송 중 콘솔을 새로고침해도 방송 시작부터 잰다 (시작 6분 뒤 새로고침 → 5분 더 지나면 보인다)', async ({ browser, baseURL }) => {
  const { page, context } = await sellerAt(browser, baseURL!, 'PC')
  await makeTokenApi(page)
  // 브라우저 시계를 방송 시작 시각(서버의 지금)에 두고 감는다. 시작 6분 뒤 판매자가 콘솔을 새로고침한다(방송 중 흔한 일) —
  // 서버는 cards 응답에 방송 시작 시각(startedAt)을 주므로 화면은 그때부터 재야 한다. 대조: 새로고침 뒤 11분을 더 감으면 보인다(재기가 새로 시작됨)
  await page.clock.install({ time: new Date(Date.now()) })
  const b = await realBroadcast(page)
  await openConsole(page, b)
  await page.clock.fastForward(6 * MIN)
  await page.reload()
  await expect(page.getByRole('region', { name: '상품 보드' })).toBeVisible()
  await expect(stall(page)).toHaveCount(0)
  await page.clock.fastForward(5 * MIN)
  await expect(stall(page), '방송 시작 뒤 11분 동안 받은 것이 없다 — 새로고침과 상관없이 보여야 한다').toBeVisible()
  await context.close()
})
