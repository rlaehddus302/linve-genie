// I1 경쟁 상태 — 느린 네트워크에서 라벨 상태 조회와 print 알림의 순서
import { expect, test } from '@playwright/test'
import { becomeDevice, boardItem, cleanupPrint, login, realBroadcast, registerApi, scopeLabels, scopeView, setBehavior, smsApi, uniqueDate, waitPrinted, writeEvent } from './support.ts'

test.afterEach(async ({ page }) => {
  await cleanupPrint(page)
})

test('TE-I1-001: 느린 네트워크 — 라벨 상태 조회 응답이 늦게 오면 그사이 받은 print 알림(출력됨)을 옛 상태로 덮어 보드가 "출력 중"에 멈춘다', async ({ page, browser }) => {
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(page.url()).origin })
  const station = await ctx.newPage()
  try {
    await login(station)
    await becomeDevice(station, '스테이션')
    await registerApi(page, b, 15, '핑크프릴', 14000)
    await smsApi(page, { b, no: 15, phone: '010-1111-0001' })
    await smsApi(page, { b, no: 15, phone: '010-1111-0002' })
    await waitPrinted(station, 1)
    await expect(boardItem(page, 15)).toContainText('라벨 출력됨')

    // PC(보는 기기)의 라벨 상태 조회 응답이 3초 늦게 온다 (휴대폰 망·혼잡한 와이파이)
    await page.route('**/api/print/labels?*', async (route) => {
      const response = await route.fetch()
      const body = await response.body()
      await new Promise((resolve) => setTimeout(resolve, 3000))
      await route.fulfill({ response, body })
    })
    // 승계자 라벨은 1.5초 걸려 나온다
    await setBehavior(station, 2, { delayMs: 1500 })
    const day = await (await page.request.get(`/api/days/${date}`)).json() as { claims: { buyer: string; no: number }[] }
    const res = await writeEvent(page, { type: 'host.cancel', b, no: 15, buyer: day.claims[0]!.buyer, reason: '시험' })
    expect(res.status).toBeLessThan(300)
    await waitPrinted(station, 2)
    // 서버 기록은 출력함 — 화면도 결국 "라벨 출력됨"이어야 한다 (조회가 끝난 뒤에도)
    await expect(boardItem(page, 15)).toContainText('라벨 출력됨', { timeout: 8_000 })
    // 늦은 조회 응답이 도착한 뒤에도 그대로인지
    await page.waitForResponse((r) => r.url().includes('/api/print/labels'), { timeout: 8_000 }).catch(() => undefined)
    await expect(boardItem(page, 15)).toContainText('라벨 출력됨', { timeout: 3_000 })
  } finally {
    await ctx.close()
  }
})

test('TE-I1-002: 휴대폰 망에서 받기(claim) 응답이 사라지면(서버는 출력 중으로 기록) 출력 기기가 그 장을 영영 찍지 못하고 대기열 전체가 멈춘다', async ({ page }) => {
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  await becomeDevice(page, 'PC')
  // 첫 받기 요청은 서버까지 가서 처리되지만 응답이 오는 길에 끊긴다
  let dropped = false
  await page.route('**/api/print/claim', async (route) => {
    const response = await route.fetch()
    const body = await response.json() as { job: unknown }
    if (!dropped && body.job !== null) {
      dropped = true
      await route.abort('connectionreset')
      return
    }
    await route.fulfill({ response, json: body })
  })
  for (const no of [1, 2]) await registerApi(page, b, no, `품종${String(no)}`, 1000)
  for (const no of [1, 2]) await smsApi(page, { b, no })
  await expect.poll(() => dropped).toBe(true)
  // 판매자는 아무것도 누르지 않는다 — 프린터는 연결돼 있고 멈춤도 없다. 두 장 모두 나와야 한다 (L-11 2 "누르지 않아도 출력")
  await waitPrinted(page, 2, 30_000)
  const labels = (await scopeLabels(page, date)).filter((l) => l.winner)
  expect(labels.map((l) => l.printed)).toEqual([1, 1])
})

test('출력 기기가 잠깐 오프라인(와이파이 끊김) 사이 들어온 라벨 — 다시 온라인이 되면 누르지 않아도 모두 나온다, 출력 중 결과도 잃지 않는다', async ({ page, browser }) => {
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(page.url()).origin })
  const station = await ctx.newPage()
  try {
    await login(station)
    await becomeDevice(station, '스테이션')
    await setBehavior(station, 1, { delayMs: 2000 })
    await registerApi(page, b, 1, '품종1', 1000)
    await smsApi(page, { b, no: 1 })
    await expect.poll(async () => (await (await page.request.get('/api/print')).json() as { queue: { printing: number } }).queue.printing).toBe(1)
    await ctx.setOffline(true)
    for (const no of [2, 3]) await registerApi(page, b, no, `품종${String(no)}`, 1000)
    for (const no of [2, 3]) await smsApi(page, { b, no })
    await expect.poll(() => station.evaluate(() => (window as unknown as { livejjimTestPrinter: { printedCount(): number } }).livejjimTestPrinter.printedCount())).toBe(1)
    await ctx.setOffline(false)
    await waitPrinted(station, 3, 30_000)
    const labels = (await scopeLabels(page, date)).filter((l) => l.winner)
    expect(labels.map((l) => l.printed)).toEqual([1, 1, 1])
  } finally {
    await ctx.close()
  }
})

test('출력 기기 탭에서 앱을 새 탭으로 열어도(세션 저장소 복사) 새 탭은 출력 기기 행세를 하지 않는다 — 끊김 멈춤 없음', async ({ page, context }) => {
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  await becomeDevice(page, 'PC')
  const opened = context.waitForEvent('page')
  await page.evaluate(() => { window.open('/settlements', '_blank') })
  const tab = await opened
  await tab.waitForLoadState()
  await expect(tab.getByRole('link', { name: /^프린터 PC · 연결됨/ })).toBeVisible()
  const ids = await Promise.all([page, tab].map((p) => p.evaluate(() => sessionStorage.getItem('livejjim.deviceId'))))
  expect(ids[0]).not.toBe(ids[1])
  const ov = await (await page.request.get('/api/print')).json() as { queue: { pause: unknown; device: { printerConnected: boolean } } }
  expect(ov.queue.pause).toBeNull()
  expect(ov.queue.device.printerConnected).toBe(true)
  await registerApi(page, b, 1, '품종1', 1000)
  await smsApi(page, { b, no: 1 })
  await waitPrinted(page, 1)
  await tab.close()
})

test('AC-I1-17: 출력 응답·print 알림에 전화번호·뒤 4자리·메모가 없다', async ({ page }) => {
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  await page.evaluate(() => {
    const w = window as unknown as { printNotices: string[] }
    w.printNotices = []
    const es = new EventSource('/api/stream')
    es.addEventListener('print', (e) => w.printNotices.push((e as MessageEvent<string>).data))
  })
  await registerApi(page, b, 15, '핑크프릴', 10000)
  await smsApi(page, { b, no: 15, phone: '010-9876-5432', memo: '현관앞비밀메모' })
  await expect.poll(() => page.evaluate(() => (window as unknown as { printNotices: string[] }).printNotices.length)).toBeGreaterThan(0)
  const view = await scopeView(page, date, false)
  const buyer = view.settlements[0]!.buyer
  const bodies = [
    ...(await page.evaluate(() => (window as unknown as { printNotices: string[] }).printNotices)),
    await (await page.request.get('/api/print')).text(),
    await (await page.request.get(`/api/print/labels?date=${date}`)).text(),
    await (await page.request.get(`/api/print/packing?date=${date}&buyer=${buyer}`)).text(),
  ]
  for (const body of bodies) {
    expect(body).not.toMatch(/5432|9876|현관앞비밀메모|phone|memo|last4/i)
  }
})
