// AC-N4a-20 (오래된 화면이 보낸 라벨 요청의 거절) — 실시간 연결을 붙잡아(알림이 오지 않는 화면) 켜진 모습 그대로 둔 채 다른 곳에서 끈다.
import { expect, test, type Page } from '@playwright/test'
import { becomeDevice, boardItem, cleanupN4a, gotoLabels, LABEL_CONTROL, login, OFF_NOTE, OFF_REFUSAL, postJson, printOverview, realBroadcast, region, registerApi, setLabels, smsApi, TEST_PRINTER, uniqueDate, waitPrinted } from './support.ts'

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await cleanupN4a(page)
})

/** 실시간 연결을 붙잡는다 — 이 화면에는 켬/끔 알림이 오지 않는다 */
async function staleStream(page: Page): Promise<void> {
  await page.route('**/api/stream**', () => { /* 응답하지 않는다 */ })
}

function countPosts(page: Page, path: string): () => number {
  let n = 0
  page.on('request', (r) => { if (r.method() !== 'GET' && new URL(r.url()).pathname === path) n += 1 })
  return () => n
}

test('AC-N4a-20: 오래된 콘솔의 상품 자세히 "라벨 출력" → LABELS_OFF 문장, 라벨 조작이 사라지고 다시 보내지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const date = uniqueDate()
  await login(page)
  await page.request.patch('/api/settings', { data: { settings: { 'print.autoOnConfirm': false } }, headers: { Origin: new URL(page.url()).origin } })
  const b = await realBroadcast(page, date)
  await registerApi(page, b, 7, '청보석', 9000)
  await smsApi(page, { b, no: 7, phone: '010-9090-0007' })
  await staleStream(page)
  await page.reload()
  await expect(page.getByLabel('빠른 입력')).toBeVisible()
  await boardItem(page, 7).click()
  const detail = page.getByRole('dialog', { name: '7번 자세히' })
  const lab = detail.getByRole('region', { name: '라벨', exact: true })
  const print = lab.getByRole('button', { name: '라벨 출력' })
  await expect(print).toBeVisible()

  await setLabels(page, false)
  const posts = countPosts(page, '/api/print/labels/print')
  await print.click()
  await expect(page.getByRole('alert').filter({ hasText: OFF_REFUSAL })).toBeVisible()
  await expect(lab).toContainText(OFF_NOTE)
  await expect(page.getByRole('button', { name: LABEL_CONTROL })).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: '메뉴' }).getByRole('link', { name: '라벨', exact: true })).toHaveCount(0)
  expect(posts()).toBe(1)
  expect((await printOverview(page)).jobs.filter((j) => j.date === date)).toHaveLength(0)
})

test('AC-N4a-20: 오래된 라벨 화면의 "이 기기에서 출력"·"라벨 설정 저장" → 거절 문장, 출력 기기·템플릿 그대로', async ({ page }) => {
  await login(page)
  await staleStream(page)
  await page.goto('/labels')
  await gotoLabels(page)
  const printer = region(page, '프린터')
  await printer.getByRole('button', { name: TEST_PRINTER }).click()
  await expect(printer.getByText(/이 기기의 프린터: 연결됨/)).toBeVisible()
  await printer.getByLabel('기기 이름').fill('오래된 PC')
  const device = printer.getByRole('button', { name: '이 기기에서 출력' })
  await expect(device).toBeVisible()

  await setLabels(page, false)
  const posts = countPosts(page, '/api/print/device')
  await device.click()
  await expect(page.getByRole('alert').filter({ hasText: OFF_REFUSAL })).toBeVisible()
  await expect(page.getByRole('main')).toContainText(OFF_NOTE)
  await expect(page.getByRole('button', { name: LABEL_CONTROL })).toHaveCount(0)
  expect(posts()).toBe(1)
  expect((await printOverview(page)).queue.device).toBeNull()

  // 켜고(이 화면은 모름 — 다시 불러오면 켜짐) 라벨 설정 저장 직전에 끈다
  await setLabels(page, true)
  await page.reload()
  await gotoLabels(page)
  const settings = region(page, '라벨 설정')
  const save = settings.getByRole('button', { name: '라벨 설정 저장' })
  await expect(save).toBeVisible()
  const before = await (await page.request.get('/api/print/templates')).text()
  await setLabels(page, false)
  const puts = countPosts(page, '/api/print/templates/product')
  const putsPacking = countPosts(page, '/api/print/templates/packing')
  await save.click()
  await expect(page.getByRole('alert').filter({ hasText: OFF_REFUSAL })).toBeVisible()
  await expect(page.getByRole('main')).toContainText(OFF_NOTE)
  expect(puts() + putsPacking()).toBeLessThanOrEqual(1)
  expect(await (await page.request.get('/api/print/templates')).text()).toBe(before)
})

test('AC-N4a-20: 오래된 출력 기기 화면의 "다시 시작" → 거절, 대기열은 그대로 멈춤', async ({ page }) => {
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  await becomeDevice(page, 'PC')
  await registerApi(page, b, 1, '품종1', 1000)
  await smsApi(page, { b, no: 1 })
  await waitPrinted(page, 1)
  await postJson(page, '/api/print/pause', {})
  const pause = region(page, '출력 멈춤')
  await expect(pause.getByRole('button', { name: '다시 시작' })).toBeVisible()
  await staleStream(page)
  // 붙잡기 전에 연 연결은 살아 있다 — 새로 불러와 붙잡힌 연결로 바꾼다
  await page.reload()
  await gotoLabels(page)
  await expect(region(page, '출력 멈춤').getByRole('button', { name: '다시 시작' })).toBeVisible()
  await setLabels(page, false)
  const posts = countPosts(page, '/api/print/restart')
  await region(page, '출력 멈춤').getByRole('button', { name: '다시 시작' }).click()
  await expect(page.getByRole('alert').filter({ hasText: OFF_REFUSAL })).toBeVisible()
  await expect(page.getByRole('main')).toContainText(OFF_NOTE)
  expect(posts()).toBe(1)
  expect((await printOverview(page)).queue.pause?.reason).toBe('SELLER')
})
