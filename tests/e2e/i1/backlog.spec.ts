// AC-I1-72·23·36 (쌓인 라벨·출력 기기 바꾸기·자동 출력 끔·리허설)
import { expect, test, type Browser, type Page } from '@playwright/test'
import { becomeDevice, boardItem, cleanupPrint, login, printOverview, printed, printedCount, realBroadcast, region, registerApi, scopeLabels, sendViewerChat, setBehavior, smsApi, uniqueDate, waitPrinted, writeEvent } from './support.ts'

test.afterEach(async ({ page }) => {
  await cleanupPrint(page)
})

async function phoneOf(page: Page, browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(page.url()).origin, isMobile: true, hasTouch: true })
  const phone = await ctx.newPage()
  await login(phone)
  return { ctx, phone }
}

test('AC-I1-72: 출력 기기 없이 1등 3개 → 대기 3장 → 휴대폰을 새 출력 기기로 → 쌓인 라벨 안내 → 출력 시작 → 3장', async ({ page, browser }) => {
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  for (const no of [1, 2, 3]) await registerApi(page, b, no, `품종${String(no)}`, 5000)
  for (const no of [1, 2, 3]) await smsApi(page, { b, no })
  await expect.poll(async () => (await printOverview(page)).queue.waiting).toBe(3)
  await expect(page.getByRole('link', { name: '출력 기기 없음 · 대기 3장' })).toBeVisible()

  const { ctx, phone } = await phoneOf(page, browser)
  try {
    const { backlog } = await becomeDevice(phone, '휴대폰')
    expect(backlog).toBe(true)
    const band = region(phone, '출력 멈춤')
    await expect(band).toContainText('대기 중인 라벨 3장이 있어요. 출력 시작을 누르면 먼저 들어온 것부터 출력해요.')
    expect(await printedCount(phone)).toBe(0)
    await band.getByRole('button', { name: '출력 시작' }).click()
    await waitPrinted(phone, 3)
    await expect(boardItem(page, 3)).toContainText('라벨 출력됨')
  } finally {
    await ctx.close()
  }
})

test('AC-I1-72: PC 출력 기기 → 휴대폰으로 바꾸기(확인) → PC는 더 받지 않고 휴대폰이 이어서 — 라벨이 빠지지 않는다', async ({ page, browser }) => {
  test.setTimeout(180_000)
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  await becomeDevice(page, 'PC')
  // PC는 2번째 출력을 오래 끈다 (출력 중에 바꾼다)
  await setBehavior(page, 2, { delayMs: 4000 })
  await page.goBack()
  for (let no = 1; no <= 6; no += 1) await registerApi(page, b, no, `품종${String(no)}`, 5000)
  for (let no = 1; no <= 6; no += 1) await smsApi(page, { b, no })
  await waitPrinted(page, 1)
  await expect.poll(async () => (await printOverview(page)).queue.printing).toBe(1)

  const { ctx, phone } = await phoneOf(page, browser)
  try {
    await becomeDevice(phone, '휴대폰')
    await expect.poll(async () => (await printOverview(page)).queue.waiting, { timeout: 30_000 }).toBe(0)
    await expect.poll(async () => (await printOverview(page)).queue.printing, { timeout: 30_000 }).toBe(0)
    const pcCount = await printedCount(page)
    // PC가 바꾼 뒤 끝낸 장(찍혔는지 모르는 2번째)까지는 있을 수 있지만, 그 뒤 새로 받지 않는다
    expect(pcCount).toBeLessThanOrEqual(2)
    const labels = (await scopeLabels(page, date)).filter((l) => l.winner)
    expect(labels).toHaveLength(6)
    for (const l of labels) expect(l.printed, `${String(l.no)}번`).toBeGreaterThanOrEqual(1)
    const phoneImages = await printed(phone)
    expect(phoneImages.length + pcCount).toBeGreaterThanOrEqual(6)
    // 휴대폰 첫 장은 PC에서 되돌아온 2번 라벨 (대기 맨 앞)
    const two = labels.find((l) => l.no === 2)!
    expect(two.history.map((h) => h.device)).toContain('휴대폰')
  } finally {
    await ctx.close()
  }
})

test('AC-I1-72: 자동 출력 끔 → 새 방송 1등에도 대기 없음 → 상품 자세히 "라벨 출력" 한 장 → 그 1등 취소 → 버릴 라벨', async ({ page }) => {
  const date = uniqueDate()
  await login(page)
  await page.goto('/labels')
  const auto = page.getByRole('checkbox', { name: '1등 확정 때 라벨 자동 출력' })
  await expect(auto).toBeChecked()
  await auto.uncheck()
  await expect(page.getByText('다음에 시작하는 방송부터 적용돼요.')).toBeVisible()
  await expect(auto).not.toBeChecked()

  const b = await realBroadcast(page, date)
  await becomeDevice(page, 'PC')
  await expect(region(page, '라벨 설정')).toContainText('지금 방송: 자동 출력 꺼짐')
  await page.goBack()
  await registerApi(page, b, 7, '청보석', 9000)
  await smsApi(page, { b, no: 7 })
  await expect(boardItem(page, 7)).toBeVisible()
  const ov = await printOverview(page)
  expect(ov.queue.waiting).toBe(0)
  expect(await printedCount(page)).toBe(0)

  await boardItem(page, 7).click()
  const detail = page.getByRole('dialog', { name: '7번 자세히' })
  const labelRegion = detail.getByRole('region', { name: '라벨' })
  await expect(labelRegion).toBeVisible()
  await labelRegion.getByRole('button', { name: '라벨 출력' }).click()
  await waitPrinted(page, 1)
  await expect(labelRegion).toContainText('라벨 출력됨')
  await page.keyboard.press('Escape')

  const day = await (await page.request.get(`/api/days/${date}`)).json() as { claims: { buyer: string; no: number }[] }
  const res = await writeEvent(page, { type: 'host.cancel', b, no: 7, buyer: day.claims.find((c) => c.no === 7)!.buyer, reason: '시험' })
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
  await expect(page.getByRole('region', { name: '알림' })).toContainText('버릴 라벨 1')
})

test('AC-I1-72·36: 같은 날 리허설 방송 1등 여러 번 → 대기열·시험용 프린터에 아무것도 없음, 라벨 자리에 안내', async ({ page }) => {
  const date = uniqueDate()
  await login(page)
  // 같은 날 실제 방송(1부)을 먼저 만들고 출력 기기를 잡아 둔다
  await realBroadcast(page, date)
  await becomeDevice(page, 'PC')
  // 리허설 방송 (같은 날) — 화면 안 이동이 아니면 프린터가 끊기므로 API로 만들고 앱 안 링크로 연다
  const res = await page.request.post('/api/broadcasts', { data: { requestId: crypto.randomUUID(), date, rehearsal: true }, headers: { Origin: new URL(page.url()).origin } })
  expect(res.ok(), await res.text()).toBe(true)
  const body = await res.json() as Record<string, unknown>
  const rb = ((body['result'] as Record<string, unknown> | undefined)?.['b'] ?? (body['broadcast'] as Record<string, unknown> | undefined)?.['id'] ?? body['b'] ?? body['id']) as string
  await registerApi(page, rb, 3, '리허설품', 3000)
  for (const nick of ['가', '나', '다']) await sendViewerChat(page, rb, nick, '3 찜')
  await expect.poll(async () => {
    const d = await (await page.request.get(`/api/days/${date}?rehearsal=true`)).json() as { products: { no: number; winners: string[] }[] }
    return d.products.find((p) => p.no === 3)?.winners.length ?? 0
  }).toBe(1)
  // 취소로 승계도 한 번
  const d = await (await page.request.get(`/api/days/${date}?rehearsal=true`)).json() as { claims: { buyer: string; no: number; status: string }[] }
  const first = d.claims.find((c) => c.no === 3)!
  const cancel = await page.request.post(`/api/events`, { data: { requestId: crypto.randomUUID(), type: 'host.cancel', b: rb, no: 3, buyer: first.buyer, reason: '시험' }, headers: { Origin: new URL(page.url()).origin } })
  expect(cancel.ok(), await cancel.text()).toBe(true)
  const ov = await printOverview(page)
  expect(ov.queue.waiting + ov.queue.printing).toBe(0)
  expect(ov.jobs).toHaveLength(0)
  expect(await printedCount(page)).toBe(0)
  const labels = await page.request.get(`/api/print/labels?date=${date}&rehearsal=true`)
  expect([404, 422, 400]).toContain(labels.status())
})
