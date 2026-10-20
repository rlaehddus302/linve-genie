// AC-N4a-30 (방송 중 끄고 켜기 — 두 기기), AC-N4a-17 (출력 기기였던 기기: 받기 멈춤·받은 한 장은 마저·켜면 쌓인 라벨)
import { expect, test, type Page, type Request } from '@playwright/test'
import { backlogWord, becomeDevice, boardItem, cleanupN4a, gotoSettings, history, labelSection, login, printedCount, printOverview, realBroadcast, region, registerApi, scopeLabels, setBehavior, setLabels, smsApi, TURNED_ON, uniqueDate, untilElapsed, waitPrinted } from './support.ts'

test.afterEach(async ({ page }) => {
  await cleanupN4a(page)
})

function menuLink(page: Page, name: string) {
  return page.getByRole('navigation', { name: '메뉴' }).getByRole('link', { name, exact: true })
}
const PRINTER_STATUS = /^(프린터 |출력 멈춤 ·)/

interface Effect { id: string; kind: string; product: string; no: number; target: string | null; claim: string; confirmVersion: number }
async function effects(page: Page, date: string): Promise<Effect[]> {
  const res = await page.request.get(`/api/days/${date}`)
  expect(res.ok()).toBe(true)
  return (await res.json() as { effects: Effect[] }).effects.map((e) => ({ ...e, no: Number(e.product.split('/').pop()) }))
}

test('AC-N4a-30: 방송 중 끄고 켜기 — PC·휴대폰, 끈 동안 4~6은 작업 없음·감사 효과는 그대로, 켜면 7은 자동, 5는 손으로 출력 → effect.labelPrinted 하나', async ({ page, browser }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  const phoneCtx = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(page.url()).origin, isMobile: true, hasTouch: true })
  const phone = await phoneCtx.newPage()
  try {
    await login(phone)
    await becomeDevice(phone, '휴대폰')
    for (let no = 1; no <= 7; no += 1) await registerApi(page, b, no, `품종${String(no)}`, 1000 * no)
    for (let no = 1; no <= 3; no += 1) await smsApi(page, { b, no, phone: `010-4444-${String(1000 + no)}` })
    await waitPrinted(phone, 3)

    // PC 설정 화면에서 끈다 (앱 안 이동)
    await gotoSettings(page)
    await labelSection(page).getByRole('button', { name: '라벨 끄기' }).click()
    await page.getByRole('dialog', { name: '라벨 기능 끄기' }).getByRole('button', { name: '라벨 끄기' }).click()
    await expect(labelSection(page).getByText('라벨 기능: 꺼짐', { exact: true })).toBeVisible()
    for (const p of [page, phone]) {
      await expect(menuLink(p, '라벨')).toHaveCount(0, { timeout: 1_000 })
      await expect(p.getByRole('link', { name: PRINTER_STATUS })).toHaveCount(0, { timeout: 1_000 })
    }
    await page.goBack()
    await expect(page.getByLabel('빠른 입력')).toBeVisible()
    await expect(boardItem(page, 1)).not.toContainText(/라벨|출력/)

    for (let no = 4; no <= 6; no += 1) await smsApi(page, { b, no, phone: `010-4444-${String(1000 + no)}` })
    await expect.poll(async () => (await effects(page, date)).filter((e) => e.no === 6).length).toBeGreaterThan(0)
    const ov = await printOverview(page)
    expect(ov.queue.waiting + ov.queue.printing).toBe(0)
    expect(ov.jobs.filter((j) => j.date === date)).toHaveLength(0)
    expect(await printedCount(phone)).toBe(3)
    const fx = await effects(page, date)
    const kinds = (no: number) => fx.filter((e) => e.no === no).map((e) => `${e.kind}:${e.target ?? '-'}`).sort()
    for (const no of [4, 5, 6]) {
      expect(kinds(no), `${String(no)}번 효과`).toEqual(kinds(1))
      expect(kinds(no)).toContain('PRINT_PRODUCT_LABEL:-')
    }

    // PC에서 켠다
    await gotoSettings(page)
    await labelSection(page).getByRole('button', { name: '라벨 켜기' }).click()
    await expect(labelSection(page).getByRole('status').filter({ hasText: TURNED_ON })).toBeVisible()
    for (const p of [page, phone]) {
      await expect(menuLink(p, '라벨')).toBeVisible({ timeout: 1_000 })
      await expect(p.getByRole('link', { name: PRINTER_STATUS })).toBeVisible({ timeout: 1_000 })
    }
    await expect(region(phone, '출력 멈춤')).toHaveCount(0)
    await expect(phone.getByText(/대기 중인 라벨 \d+장이 있어요/)).toHaveCount(0)
    expect((await printOverview(page)).queue.pause).toBeNull()
    expect(await printedCount(phone)).toBe(3)
    const labels = await scopeLabels(page, date)
    const five = labels.find((l) => l.no === 5 && l.winner)!
    expect(five.state).toBe('NONE')
    expect(five.canPrint).toBe(true)
    await page.goBack()
    await expect(page.getByLabel('빠른 입력')).toBeVisible()

    // 켠 뒤 새 1등 7 → 바로 출력
    await smsApi(page, { b, no: 7, phone: '010-4444-1007' })
    await waitPrinted(phone, 4)

    // 5를 손으로 출력
    await boardItem(page, 5).click()
    const detail = page.getByRole('dialog', { name: '5번 자세히' })
    const lab = detail.getByRole('region', { name: '라벨', exact: true })
    await lab.getByRole('button', { name: '라벨 출력' }).click()
    await waitPrinted(phone, 5)
    await expect(lab).toContainText('라벨 출력됨')
    await expect.poll(async () => (await history(page, date, false)).filter((e) => e.type === 'effect.labelPrinted').length).toBe(5)
    const printedEvents = (await history(page, date, false)).filter((e) => e.type === 'effect.labelPrinted')
    const fiveEffect = fx.find((e) => e.no === 5 && e.kind === 'PRINT_PRODUCT_LABEL')!
    expect(printedEvents.filter((e) => JSON.stringify(e.fields).includes(fiveEffect.id))).toHaveLength(1)
    // 4·6은 여전히 출력하지 않았다
    for (const no of [4, 6]) expect(printedEvents.filter((e) => JSON.stringify(e.fields).includes(fx.find((x) => x.no === no && x.kind === 'PRINT_PRODUCT_LABEL')!.id))).toHaveLength(0)
  } finally {
    await phoneCtx.close()
  }
})

test('AC-N4a-17: 출력 중에 다른 기기가 끄면 받은 한 장만 마저 출력하고 받기를 멈춘다 — 켜면 쌓인 라벨 안내·"출력 시작" 전에는 출력하지 않음', async ({ page, browser }) => {
  test.setTimeout(180_000)
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(page.url()).origin, isMobile: true, hasTouch: true })
  const phone = await ctx.newPage()
  try {
    await login(phone)
    await becomeDevice(phone, '휴대폰')
    await setBehavior(phone, 2, { delayMs: 4_000 })
    const claims: { at: number; req: Request }[] = []
    phone.on('request', (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/print/claim') claims.push({ at: Date.now(), req: r }) })
    for (let no = 1; no <= 4; no += 1) await registerApi(page, b, no, `품종${String(no)}`, 1000)
    for (let no = 1; no <= 4; no += 1) await smsApi(page, { b, no, phone: `010-6666-${String(1000 + no)}` })
    await waitPrinted(phone, 1)
    await expect.poll(async () => (await printOverview(page)).queue.printing).toBe(1)
    await expect(phone.getByText('출력하는 동안 이 화면을 켜 두세요.')).toBeVisible()

    const offAt = Date.now()
    await setLabels(page, false)
    await expect(phone.getByText('출력하는 동안 이 화면을 켜 두세요.')).toHaveCount(0, { timeout: 1_000 })
    await waitPrinted(phone, 2)
    const since = await phone.evaluate(() => Date.now())
    await untilElapsed(phone, since, 3_000)
    expect(await printedCount(phone)).toBe(2)
    expect(claims.filter((c) => c.at > offAt + 1_000), '끈 뒤 1초가 지나서 보낸 받기').toHaveLength(0)
    const ov = await printOverview(page)
    expect(ov.queue.waiting).toBe(2)
    expect(ov.queue.printing).toBe(0)
    const two = (await scopeLabels(page, date)).find((l) => l.no === 2 && l.winner)!
    expect(two.printed).toBe(1)

    // 다시 켠다 → 쌓인 라벨, 누르기 전에는 출력하지 않는다
    await setLabels(page, true)
    await expect(phone.getByText(backlogWord(2))).toBeVisible({ timeout: 1_000 })
    const start = phone.getByRole('button', { name: '출력 시작' })
    await expect(start).toBeVisible()
    const t = await phone.evaluate(() => Date.now())
    await untilElapsed(phone, t, 2_000)
    expect(await printedCount(phone)).toBe(2)
    await start.click()
    await waitPrinted(phone, 4)
    const order = (await scopeLabels(page, date)).filter((l) => l.winner).sort((x, y) => Date.parse(x.history[0]!.at) - Date.parse(y.history[0]!.at)).map((l) => l.no)
    expect(order).toEqual([1, 2, 3, 4])
  } finally {
    await ctx.close()
  }
})

test('AC-N4a-17·05: 받기 요청이 오가는 사이 꺼짐 — (가) 요청이 늦게 닿으면 LABELS_OFF로 멈추고 (나) 응답이 늦게 오면 받은 장을 마저 출력해 결과를 남긴다', async ({ page }) => {
  test.setTimeout(180_000)
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  await becomeDevice(page, 'PC')
  for (let no = 1; no <= 3; no += 1) await registerApi(page, b, no, `품종${String(no)}`, 1000)
  let mode: 'pass' | 'holdRequest' | 'holdResponse' = 'pass'
  let release: () => void = () => {}
  let held = 0
  const claims: { at: number; status: number }[] = []
  await page.route('**/api/print/claim', async (route) => {
    const now = mode
    if (now === 'pass') { await route.continue(); return }
    mode = 'pass'
    held += 1
    const gate = new Promise<void>((r) => { release = r })
    if (now === 'holdRequest') { await gate; await route.continue(); return }
    const res = await route.fetch()
    await gate
    await route.fulfill({ response: res })
  })
  page.on('response', (r) => { if (new URL(r.url()).pathname === '/api/print/claim') claims.push({ at: Date.now(), status: r.status() }) })

  // (가) 요청을 붙잡은 채 끈다 → 서버 LABELS_OFF
  mode = 'holdRequest'
  await smsApi(page, { b, no: 1, phone: '010-7171-0001' })
  await expect.poll(() => held).toBe(1)
  await setLabels(page, false)
  release()
  await expect.poll(() => claims.some((c) => c.status === 409)).toBe(true)
  let t = await page.evaluate(() => Date.now())
  const after409 = claims.length
  await untilElapsed(page, t, 2_500)
  expect(claims.length, 'LABELS_OFF 뒤 받기를 다시 보내지 않는다').toBe(after409)
  expect(await printedCount(page)).toBe(0)
  let ov = await printOverview(page)
  expect(ov.queue.waiting).toBe(1)
  expect(ov.queue.printing).toBe(0)
  await expect(page.getByRole('alert')).toHaveCount(0)

  // 켜면 쌓인 라벨 → 출력 시작
  await setLabels(page, true)
  await expect(page.getByText(backlogWord(1))).toBeVisible({ timeout: 1_000 })
  await page.getByRole('button', { name: '출력 시작' }).click()
  await waitPrinted(page, 1)

  // (나) 응답을 붙잡은 채 끈다 → 받은 장은 마저 출력, 결과 기록
  mode = 'holdResponse'
  await smsApi(page, { b, no: 2, phone: '010-7171-0002' })
  await expect.poll(() => held).toBe(2)
  await setLabels(page, false)
  await smsApi(page, { b, no: 3, phone: '010-7171-0003' })
  release()
  await waitPrinted(page, 2)
  await expect.poll(async () => (await printOverview(page)).queue.printing).toBe(0)
  t = await page.evaluate(() => Date.now())
  const before = claims.length
  await untilElapsed(page, t, 2_500)
  expect(claims.length).toBe(before)
  ov = await printOverview(page)
  expect(ov.jobs.filter((j) => j.date === date && j.status === 'WAITING')).toHaveLength(0)
  const two = (await scopeLabels(page, date)).find((l) => l.no === 2 && l.winner)!
  expect(two.printed).toBe(1)
  expect((await history(page, date, false)).filter((e) => e.type === 'effect.labelPrinted')).toHaveLength(2)
})

test('AC-N4a-06·17: 받기 응답을 잃은 장(출력 중으로 남음)은 꺼진 동안 그대로이고, 켠 뒤 빠지지도 겹치지도 않고 한 번 출력된다', async ({ page }) => {
  test.setTimeout(180_000)
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  await becomeDevice(page, 'PC')
  await registerApi(page, b, 1, '품종1', 1000)
  let lose = true
  let lost = 0
  await page.route('**/api/print/claim', async (route) => {
    if (!lose) { await route.continue(); return }
    const res = await route.fetch()
    const body = await res.json() as { job: unknown }
    if (body.job !== null) { lose = false; lost += 1; await route.abort('failed'); return }
    await route.fulfill({ response: res })
  })
  await smsApi(page, { b, no: 1, phone: '010-7272-0001' })
  await expect.poll(() => lost).toBe(1)
  await setLabels(page, false)
  let ov = await printOverview(page)
  expect(ov.queue.printing).toBe(1)
  const t = await page.evaluate(() => Date.now())
  await untilElapsed(page, t, 3_000)
  expect(await printedCount(page)).toBe(0)
  ov = await printOverview(page)
  expect(ov.queue.printing + ov.queue.waiting).toBe(1)

  await setLabels(page, true)
  const start = page.getByRole('button', { name: '출력 시작' })
  // 대기로 되돌아왔으면 쌓인 라벨로 멈추고, 출력 중이면 이어서 받는다 — 어느 쪽이든 결국 한 장
  await expect.poll(async () => {
    if (await start.isVisible()) await start.click()
    return await printedCount(page)
  }, { timeout: 30_000 }).toBe(1)
  await expect.poll(async () => { const q = (await printOverview(page)).queue; return q.printing + q.waiting }).toBe(0)
  const l = (await scopeLabels(page, date)).find((x) => x.no === 1 && x.winner)!
  expect(l.printed).toBe(1)
  expect((await history(page, date, false)).filter((e) => e.type === 'effect.labelPrinted')).toHaveLength(1)
})
