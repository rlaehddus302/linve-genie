// I1 흐름 깨뜨리기 (라운드 1) — 수정(TE-I1-001·002)으로 생긴 새 구멍, 자동 출력 끔의 상품 자세히, 다시 붙은 보드, 테스트 인쇄 그림
import { bitmapsEqual, defaultTemplate, renderTestLabel } from '@livejjim/label'
import { createNodeRenderEnv } from '@livejjim/label/node'
import { expect, test } from '@playwright/test'
import { becomeDevice, boardItem, cleanupPrint, gotoLabels, login, postJson, printed, printOverview, realBroadcast, region, registerApi, scopeLabels, smsApi, TEST_PRINTER, todayKst, uniqueDate, waitPrinted, writeEvent } from './support.ts'

test.afterEach(async ({ page }) => {
  await cleanupPrint(page)
})

test('TE-I1-004: 받기 응답을 잃은 직후 출력 기기에서 "출력 그만하기" — 출력 기기가 영영 비워지지 않고 그 라벨도 나오지 않는다', async ({ page }) => {
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  await becomeDevice(page, 'PC')
  // 첫 받기 요청은 서버까지 가서 처리되지만(출력 중으로 기록) 응답이 오는 길에 끊긴다
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
  await registerApi(page, b, 1, '품종1', 1000)
  await smsApi(page, { b, no: 1 })
  await expect.poll(() => dropped).toBe(true)
  // 판매자가 이 기기에서 출력을 그만한다 (출력 중 장의 결과가 정해진 뒤 비워져야 한다 — L-11 10)
  await region(page, '프린터').getByRole('button', { name: '출력 그만하기' }).click()
  // 그 장은 이 기기가 찍지 않았다(응답을 못 받음). 결과가 정해지고 출력 기기가 비워져야 한다 — 다른 기기가 이어받을 수 있게
  await expect.poll(async () => (await printOverview(page)).queue.device, { timeout: 20_000 }).toBeNull()
  const ov = await printOverview(page)
  // 라벨이 사라지지 않는다: 대기 맨 앞으로 돌아왔거나 찍혔다
  expect(ov.queue.waiting + (await printed(page)).length).toBe(1)
  expect(ov.queue.printing).toBe(0)
})

test('TE-I1-005: 자동 출력을 끈 방송 — 상품 자세히를 연 채 문자찜으로 1등이 생기면 그 1등의 라벨 미리 보기가 나와야 한다', async ({ page }) => {
  const date = uniqueDate()
  await login(page)
  await page.goto('/labels')
  const auto = page.getByRole('checkbox', { name: '1등 확정 때 라벨 자동 출력' })
  await expect(auto).toBeChecked()
  await auto.uncheck()
  await expect(page.getByText('다음에 시작하는 방송부터 적용돼요.')).toBeVisible()
  const b = await realBroadcast(page, date)
  await registerApi(page, b, 7, '청보석', 9000)
  await expect(boardItem(page, 7)).toBeVisible()
  await boardItem(page, 7).click()
  const detail = page.getByRole('dialog', { name: '7번 자세히' })
  const labelRegion = detail.getByRole('region', { name: '라벨' })
  await expect(labelRegion).toContainText('1등이 없어')
  await smsApi(page, { b, no: 7 })
  const group = labelRegion.getByRole('group', { name: '1등 문자찜 라벨' })
  await expect(group).toBeVisible()
  await expect(group.getByRole('button', { name: '라벨 출력' })).toBeVisible()
  // 서버 라벨 상태에는 이 1등의 라벨 데이터가 있다 (작업이 없어도)
  const server = (await scopeLabels(page, date)).find((l) => l.no === 7 && l.winner)
  expect(server?.data).not.toBeNull()
  // 화면도 지금 데이터로 그린 미리 보기와 그림 파일 저장을 보여야 한다 (AC-I1-31) — 다른 기록이 오기 전에도
  await expect(group.getByRole('img', { name: '7번 라벨 미리 보기' })).toBeVisible({ timeout: 5_000 })
  await expect(group.getByRole('button', { name: '그림 파일로 저장' })).toBeEnabled()
})

test('보는 기기의 실시간 연결이 끊긴 사이 라벨이 출력되면 — 다시 붙은 뒤 보드가 "라벨 출력됨"으로 따라잡는다', async ({ page, browser }) => {
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(page.url()).origin })
  const station = await ctx.newPage()
  try {
    await login(station)
    await becomeDevice(station, '스테이션')
    await postJson(station, '/api/print/pause', {})
    await registerApi(page, b, 3, '품종3', 3000)
    await smsApi(page, { b, no: 3 })
    await expect(boardItem(page, 3)).toContainText('라벨 대기')
    await page.context().setOffline(true)
    await region(station, '출력 멈춤').getByRole('button', { name: '다시 시작' }).click()
    await waitPrinted(station, 1)
    await page.context().setOffline(false)
    await expect(boardItem(page, 3)).toContainText('라벨 출력됨', { timeout: 15_000 })
  } finally {
    await page.context().setOffline(false)
    await ctx.close()
  }
})

test('AC-I1-22: 테스트 인쇄 그림 — 상품 라벨 설정의 가게 이름·50×40, 오늘 KST로 그린 테스트 라벨 (다른 가게 이름·날짜보다 가깝다)', async ({ page }) => {
  await login(page)
  const before = await (await page.request.get('/api/print/templates')).json() as { product: { template: unknown; version: number } }
  const shopName = '라이브찜 꽃집'
  const template = { ...defaultTemplate('product', '50x40'), shopName }
  const saved = await page.request.put('/api/print/templates/product', { data: { template, version: before.product.version }, headers: { Origin: new URL(page.url()).origin } })
  expect(saved.ok(), await saved.text()).toBe(true)
  const savedVersion = (await saved.json() as { version: number }).version
  try {
    await gotoLabels(page)
    const printer = region(page, '프린터')
    await printer.getByRole('button', { name: TEST_PRINTER }).click()
    await expect(printer.getByText(/이 기기의 프린터: 연결됨/)).toBeVisible()
    await printer.getByRole('button', { name: '테스트 인쇄' }).click()
    await waitPrinted(page, 1)
    const [got] = await printed(page)
    // 브라우저 캔버스와 Node 캔버스는 글자 가장자리 점이 조금 다르다(같은 렌더 함수라도) — 점 하나까지 비교는 화면 단위 시험(labels-page.test)이 한다.
    // 여기서는 크기가 같고, 다른 가게 이름·다른 날짜로 그린 것보다 이 값으로 그린 것에 더 가까운지 본다
    const env = createNodeRenderEnv()
    const render = (shop: string, date: string) => {
      const r = renderTestLabel(env, { shopName: shop, date, size: '50x40' })
      if (!r.ok) throw new Error(r.error.message)
      return r.image
    }
    const want = render(shopName, todayKst())
    expect({ w: got!.width, h: got!.height }).toEqual({ w: want.width, h: want.height })
    const gotImage = { width: got!.width, height: got!.height, data: Uint8Array.from(got!.data) }
    const diff = (a: { data: Uint8Array }) => {
      let n = 0
      for (let i = 0; i < a.data.length; i++) for (let x = (a.data[i]! ^ gotImage.data[i]!) & 0xff; x !== 0; x >>= 1) n += x & 1
      return n
    }
    expect(bitmapsEqual(gotImage, render('', todayKst()))).toBe(false)
    expect(diff(want)).toBeLessThan(diff(render('', todayKst())))
    expect(diff(want)).toBeLessThan(diff(render('다른 가게 이름입니다', todayKst())))
    expect(diff(want)).toBeLessThan(diff(render(shopName, '2001-01-01')))
  } finally {
    const restore = await page.request.put('/api/print/templates/product', { data: { template: before.product.template, version: savedVersion }, headers: { Origin: new URL(page.url()).origin } })
    expect(restore.ok(), await restore.text()).toBe(true)
  }
})

test('받기 응답을 잃은 사이 그 1등이 취소되면 — 찍지 않은 라벨은 버릴 라벨이 아니고, 승계자 라벨이 누르지 않아도 나온다', async ({ page }) => {
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  await becomeDevice(page, 'PC')
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
  await registerApi(page, b, 15, '핑크프릴', 14000)
  await smsApi(page, { b, no: 15, phone: '010-2222-0001' })
  await expect.poll(() => dropped).toBe(true)
  await smsApi(page, { b, no: 15, phone: '010-2222-0002' })
  const day = await (await page.request.get(`/api/days/${date}`)).json() as { claims: { buyer: string; no: number }[] }
  const res = await writeEvent(page, { type: 'host.cancel', b, no: 15, buyer: day.claims[0]!.buyer, reason: '시험' })
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
  // 승계자 라벨 한 장만 나온다 (취소된 1등의 라벨은 이 기기가 받지 못했으므로 찍히지 않았다)
  await waitPrinted(page, 1, 30_000)
  await expect.poll(async () => (await printOverview(page)).queue.waiting + (await printOverview(page)).queue.printing).toBe(0)
  const ov = await printOverview(page)
  expect(ov.queue.pause).toBeNull()
  expect(ov.queue.discard).toBe(0)
  expect(ov.discard).toHaveLength(0)
  const labels = await scopeLabels(page, date)
  const winner = labels.find((l) => l.no === 15 && l.winner)!
  expect(winner.word).toBe('라벨 출력됨')
  expect(labels.find((l) => l.no === 15 && !l.winner)?.word).not.toBe('폐기 — 버려 주세요')
  await expect(page.getByRole('link', { name: /버릴 라벨/ })).toHaveCount(0)
})
