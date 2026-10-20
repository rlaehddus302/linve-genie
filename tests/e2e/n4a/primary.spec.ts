// AC-N4a-21 (라벨 화면 주 버튼은 지금 할 일 하나 — I1 통합 지적, D-N4a-06): 시험용 프린터로 (가)~(라) 상태마다 창 밖 주 버튼 수를 센다.
import { expect, test, type Page } from '@playwright/test'
import { becomeDevice, cleanupN4a, gotoLabels, login, postJson, primaryOutsideDialogs, realBroadcast, region, registerApi, setBehavior, smsApi, TEST_PRINTER, uniqueDate, waitPrinted, writeEvent } from './support.ts'

test.afterEach(async ({ page }) => {
  await cleanupN4a(page)
})

async function primaries(page: Page, expected: string[]): Promise<void> {
  await expect.poll(() => primaryOutsideDialogs(page)).toEqual(expected)
}

test('AC-N4a-21 (가)(나): 연결 전 첫 연결 방법 → 연결 직후 "테스트 인쇄" 하나 → "예" 뒤 "이 기기에서 출력" 하나 → 출력 기기가 되면 없음', async ({ page }) => {
  await login(page)
  await page.goto('/labels')
  await gotoLabels(page)
  const printer = region(page, '프린터')
  const methods = printer.getByRole('group', { name: '연결 방법' }).getByRole('button')
  await expect(methods.first()).toBeVisible()
  const first = (await methods.first().textContent())!.trim()
  await primaries(page, [first])

  await printer.getByRole('button', { name: TEST_PRINTER }).click()
  await expect(printer.getByText(/이 기기의 프린터: 연결됨/)).toBeVisible()
  await primaries(page, ['테스트 인쇄'])
  await expect(printer.getByRole('button', { name: '이 기기에서 출력' })).toBeVisible()

  await printer.getByRole('button', { name: '테스트 인쇄' }).click()
  const result = printer.getByRole('group', { name: '테스트 인쇄 결과' })
  await result.getByRole('button', { name: '예' }).click()
  await primaries(page, ['이 기기에서 출력'])
  await expect(printer.getByRole('button', { name: '테스트 인쇄' })).not.toHaveClass(/button-primary/)

  await printer.getByLabel('기기 이름').fill('PC')
  await printer.getByRole('button', { name: '이 기기에서 출력' }).click()
  await expect(printer.getByText('이 기기가 출력 기기예요')).toBeVisible()
  await primaries(page, [])
})

test('AC-N4a-21 (다): 출력 기기가 된 뒤 끊김 멈춤 → 주 버튼 "다시 연결" 하나', async ({ page }) => {
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  await becomeDevice(page, 'PC')
  await setBehavior(page, 1, 'disconnect')
  await registerApi(page, b, 1, '품종1', 1000)
  await smsApi(page, { b, no: 1 })
  const pause = region(page, '출력 멈춤')
  await expect(pause.getByRole('button', { name: '다시 연결' })).toBeVisible({ timeout: 30_000 })
  await primaries(page, ['다시 연결'])
})

test('AC-N4a-21 (다)변형: 판매자 멈춤이면 "다시 시작" 하나 — 연결 직후의 "테스트 인쇄"는 보통 버튼', async ({ page }) => {
  await login(page)
  await page.goto('/labels')
  await gotoLabels(page)
  await postJson(page, '/api/print/pause', {})
  const pause = region(page, '출력 멈춤')
  await expect(pause.getByRole('button', { name: '다시 시작' })).toBeVisible()
  const printer = region(page, '프린터')
  await printer.getByRole('button', { name: TEST_PRINTER }).click()
  await expect(printer.getByText(/이 기기의 프린터: 연결됨/)).toBeVisible()
  await primaries(page, ['다시 시작'])
  await printer.getByRole('button', { name: '테스트 인쇄' }).click()
  await printer.getByRole('group', { name: '테스트 인쇄 결과' }).getByRole('button', { name: '예' }).click()
  await primaries(page, ['다시 시작'])
})

test('AC-N4a-21: 다른 기기의 끊김 멈춤(이 기기에서 누를 조치 없음)이면 프린터 단계의 다음 할 일이 주 버튼', async ({ page, browser }) => {
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(page.url()).origin })
  const other = await ctx.newPage()
  try {
    await login(other)
    await becomeDevice(other, '다른 기기')
    await setBehavior(other, 1, 'disconnect')
    await registerApi(page, b, 1, '품종1', 1000)
    await smsApi(page, { b, no: 1 })
    await page.goto('/labels')
    await gotoLabels(page)
    await expect(region(page, '출력 멈춤')).toBeVisible({ timeout: 30_000 })
    await expect(region(page, '출력 멈춤').getByRole('button')).toHaveCount(0)
    const printer = region(page, '프린터')
    await printer.getByRole('button', { name: TEST_PRINTER }).click()
    await expect(printer.getByText(/이 기기의 프린터: 연결됨/)).toBeVisible()
    await primaries(page, ['테스트 인쇄'])
  } finally {
    await ctx.close()
  }
})

test('AC-N4a-21 (라): 출력 기기 + 버릴 라벨 + 라벨 설정 고치는 중 → 주 버튼 없음 ("버렸어요"·"라벨 설정 저장"은 보통 버튼)', async ({ page }) => {
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  await becomeDevice(page, 'PC')
  await registerApi(page, b, 15, '핑크프릴', 10000)
  await smsApi(page, { b, no: 15, phone: '010-1515-1515' })
  await waitPrinted(page, 1)
  const day = await (await page.request.get(`/api/days/${date}`)).json() as { claims: { buyer: string; no: number }[] }
  expect((await writeEvent(page, { type: 'host.cancel', b, no: 15, buyer: day.claims[0]!.buyer, reason: '시험' })).status).toBeLessThan(300)
  const discard = region(page, '버릴 라벨')
  await expect(discard.getByRole('button', { name: /버렸어요/ }).first()).toBeVisible()
  const settings = region(page, '라벨 설정')
  const box = settings.getByRole('checkbox').first()
  await box.click()
  await expect(settings.getByRole('button', { name: '라벨 설정 저장' })).toBeVisible()
  await primaries(page, [])
})
