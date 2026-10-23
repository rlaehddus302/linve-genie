// O4 실제 옵션 방송의 마무리 — 판매대장(AC-O4-17), 포장 모드(AC-O4-18~21·23), 지난 구매(AC-O4-24), 정산 목록 상품 수(AC-O4-27) — test-e2e.
// 판매는 G-ENG-O4-01의 확정 찜과 같게 문자찜(옵션·수량)·방송자 취소로 만든다. 실제 채팅 수집기 경로는 youtube-flow.spec.ts(@youtube)가 본다.
// 기대 문장은 acceptance.md와 dev-notes "다음(test-e2e)에게".
import { expect, test, type Page, type Request } from '@playwright/test'
import {
  SHORTS,
  TEE,
  chat,
  createBroadcast,
  dateLongKo,
  downloadBytes,
  hostAction,
  login,
  noHorizontalScroll,
  oscope,
  packingCommand,
  packingLabelData,
  packingList,
  phoneLike,
  registerOptions,
  smsApi,
  uniqueDate,
  writeEvent,
  xlsxRows,
} from './support.ts'

const OPTION_COLUMNS = ['방송 날짜', '회차', '상품 번호', '품종', '옵션', '수량', '단가', '가격', '구매자', '채널', '찜 시각', '상태', '입금', '배송']
const COLUMNS = ['방송 날짜', '회차', '상품 번호', '품종', '가격', '구매자', '채널', '찜 시각', '상태', '입금', '배송']

function phoneNo(): string {
  return `010-${String(Math.floor(Math.random() * 9000) + 1000)}-${String(Math.floor(Math.random() * 9000) + 1000)}`
}

interface Day { date: string; b: string; d: string; buyers: Record<string, string> }

/** 문자찜 하나 (옵션·수량) 하고 그 구매자 ID */
async function sms(page: Page, date: string, b: string, no: number, phone: string, memo: string, extra: { options?: Record<string, string>; qty?: number } = {}): Promise<string> {
  const body = await smsApi(page, { b, no, phone, memo, ...extra } as never)
  const seq = Number((body as { seq?: number }).seq)
  const s = await oscope(page, date, false)
  const c = s.claims.filter((x) => x.broadcast === b && x.no === no).find((x) => x.seq === seq) ?? s.claims.filter((x) => x.broadcast === b && x.no === no).sort((x, y) => y.seq - x.seq)[0]
  if (c === undefined) throw new Error(`찜 없음 ${String(no)} ${JSON.stringify(body)}`)
  return c.currentBuyer
}

/** G-ENG-O4-01 확정 찜과 같은 실제 옵션 방송 + 같은 날 다육 방송(7 핑크프릴 8,000 — 문자찜 1건) */
async function clothingDay(page: Page): Promise<Day> {
  const date = uniqueDate()
  const { b } = await createBroadcast(page, { date, rehearsal: false, saleMode: 'OPTIONS', title: '의류 1부' })
  await registerOptions(page, b, { ...SHORTS })
  await registerOptions(page, b, { ...TEE })
  const phones = { 홍길동: phoneNo(), 김철수: phoneNo(), 이영희: phoneNo(), 박민수: phoneNo(), 정하나: phoneNo(), 오세훈: phoneNo() }
  const buyers: Record<string, string> = {}
  buyers['홍길동'] = await sms(page, date, b, 21, phones.홍길동, '홍길동', { options: { 사이즈: 'M' } })
  buyers['김철수'] = await sms(page, date, b, 21, phones.김철수, '김철수', { options: { 사이즈: 'M' } }) // 대기 1
  buyers['박민수'] = await sms(page, date, b, 22, phones.박민수, '박민수', { options: { 사이즈: '105', 색상: '검정색' }, qty: 2 })
  buyers['정하나'] = await sms(page, date, b, 22, phones.정하나, '정하나', { options: { 사이즈: '100', 색상: '흰색' } })
  buyers['이영희'] = await sms(page, date, b, 21, phones.이영희, '이영희', { options: { 사이즈: 'S' } })
  await sms(page, date, b, 21, phones.홍길동, '홍길동', { options: { 사이즈: 'L' }, qty: 2 })
  await hostAction(page, { type: 'host.cancel', b, no: 21, buyer: buyers['홍길동'], options: { 사이즈: 'M' }, reason: '구매자 요청' })
  await expect.poll(async () => (await oscope(page, date, false)).claims.filter((c) => c.broadcast === b && c.status === 'CONFIRMED').map((c) => `${String(c.no)}${c.variant ?? ''}x${String(c.qty)}`).sort(), { timeout: 15_000 })
    .toEqual(['21Lx2', '21Mx1', '21Sx1', '22100/흰색x1', '22105/검정색x2'])
  const { b: d } = await createBroadcast(page, { date, rehearsal: false, saleMode: 'NUMBERS', title: '다육 1부' })
  const reg = await writeEvent(page, { type: 'product.register', b: d, no: 7, name: '핑크프릴', price: 8000 })
  expect(reg.status, JSON.stringify(reg.body)).toBeLessThan(300)
  buyers['오세훈'] = await sms(page, date, d, 7, phones.오세훈, '오세훈')
  return { date, b, d, buyers }
}

test.beforeEach(async ({ page }) => {
  await login(page)
})

test('AC-O4-17: 판매대장 — 두 방송이면 14열(옵션·수량·단가), 행이 확정 찜과 같고 다육 행은 빈칸·1·8,000 · 다육 방송만이면 11열 그대로 · 같은 날 옵션 리허설 판매는 어느 대장에도 없다', async ({ page }) => {
  const day = await clothingDay(page)
  // 같은 날 옵션 리허설 판매 하나 (21 반바지 L 2개 — 리허설손님)
  const { b: r } = await createBroadcast(page, { date: day.date, rehearsal: true, saleMode: 'OPTIONS', title: '리허설 의류' })
  await registerOptions(page, r, { ...SHORTS })
  await chat(page, r, '리허설손님', '반바지 L 2개')
  await expect.poll(async () => (await oscope(page, day.date, true)).claims.filter((c) => c.broadcast === r && c.status === 'CONFIRMED').map((c) => [c.no, c.variant, c.qty]), { timeout: 15_000 })
    .toEqual([[21, 'L', 2]])
  const inLedger = (rows: string[][]) => rows.filter((row) => row.some((cell) => /리허설/.test(cell ?? '')))
  await page.goto(`/settlements?date=${day.date}`)
  await page.getByRole('group', { name: '정산 문서' }).getByRole('button', { name: '판매대장 엑셀' }).click()
  const dlg = page.getByRole('dialog', { name: '판매대장 엑셀' })
  const list = dlg.getByRole('list', { name: '판매대장에 넣을 방송' })
  await expect(list.getByRole('checkbox')).toHaveCount(2)
  const [both] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name: '엑셀 내려받기' }).click()])
  const rows = await xlsxRows(await downloadBytes(both))
  expect(rows[0]).toEqual(OPTION_COLUMNS)
  const col = (name: string) => OPTION_COLUMNS.indexOf(name)
  const sold = rows.slice(1).filter((r) => r[col('상태')] === '1등')
  const pick = (r: string[]) => [r[col('회차')], r[col('상품 번호')], r[col('품종')], r[col('옵션')], r[col('수량')], r[col('단가')], r[col('가격')], /^문자찜\((.+)\) \/ 끝자리 \d{4}$/.exec(r[col('구매자')] ?? '')?.[1] ?? r[col('구매자')]]
  expect(sold.map(pick).sort()).toEqual([
    ['다육 1부', '7', '핑크프릴', '', '1', '8000', '8000', '오세훈'],
    ['의류 1부', '21', '반바지', 'L', '2', '10000', '20000', '홍길동'],
    ['의류 1부', '21', '반바지', 'M', '1', '10000', '10000', '김철수'],
    ['의류 1부', '21', '반바지', 'S', '1', '10000', '10000', '이영희'],
    ['의류 1부', '22', '반팔티', '100/흰색', '1', '15000', '15000', '정하나'],
    ['의류 1부', '22', '반팔티', '105/검정색', '2', '17000', '34000', '박민수'],
  ].sort())
  expect(inLedger(rows)).toEqual([])
  expect(rows.slice(1).filter((row) => ![`의류 1부`, '다육 1부'].includes(row[col('회차')] ?? ''))).toEqual([])
  // 다육 방송만
  await list.getByRole('checkbox', { name: `${dateLongKo(day.date)} · 의류 1부` }).uncheck()
  const [only] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name: '엑셀 내려받기' }).click()])
  const rows2 = await xlsxRows(await downloadBytes(only))
  expect(rows2[0]).toEqual(COLUMNS)
  const sold2 = rows2.slice(1).filter((r) => r[COLUMNS.indexOf('상태')] === '1등')
  expect(sold2.map((r) => [r[1], r[2], r[3], r[4]])).toEqual([['다육 1부', '7', '핑크프릴', '8000']])
  expect(sold2[0]?.[5]).toContain('오세훈')
  expect(inLedger(rows2)).toEqual([])
  expect(rows2.slice(1).filter((row) => row[1] !== '다육 1부')).toEqual([])
})

test('D-O4-09·10 (AC-O4-34·35): 구매자 목록·자세히 — "상품 n개" = 확정 수량 합(취소 찜 뺌), 확정 상품 줄은 `21번 반바지 L 2개 …` 한 모양(×·` · 2개` 없음)', async ({ page }) => {
  const day = await clothingDay(page)
  await page.goto(`/buyers?date=${day.date}`)
  const list = page.getByRole('region', { name: '구매자 목록' })
  const row = (name: string) => list.getByRole('row').filter({ hasText: name })
  // 홍길동: 확정 21 L 2개 한 줄(취소한 M 1개 뺌) → 줄 수 1이 아니라 수량 합 2
  await expect(row('홍길동').getByRole('cell').nth(2)).toHaveText('2개')
  await expect(row('박민수').getByRole('cell').nth(2)).toHaveText('2개')
  await expect(row('김철수').getByRole('cell').nth(2)).toHaveText('1개')
  await expect(row('오세훈').getByRole('cell').nth(2)).toHaveText('1개')

  await page.goto(`/buyers?date=${day.date}&buyer=${encodeURIComponent(day.buyers['홍길동']!)}`)
  const items = page.getByRole('region', { name: '구매자 자세히' }).getByRole('region', { name: '확정 상품' })
  await expect(items.getByRole('listitem')).toHaveCount(1)
  await expect(items.getByRole('listitem')).toHaveText(/^21번 반바지 L 2개 20,000원 · 문자찜/)
  await expect(items).toContainText('상품 2개')
  await expect(items).not.toContainText('×')
  await expect(items).not.toContainText(/ · \d+개/)
  await expect(items).not.toContainText('반바지 M')

  await page.goto(`/buyers?date=${day.date}&buyer=${encodeURIComponent(day.buyers['박민수']!)}`)
  await expect(items.getByRole('listitem')).toHaveText(/^22번 반팔티 105\/검정색 2개 34,000원 · 문자찜/)
  await expect(items).toContainText('상품 2개')
  // 다육 줄은 BASE 그대로 (옵션 글·수량 없음)
  await page.goto(`/buyers?date=${day.date}&buyer=${encodeURIComponent(day.buyers['오세훈']!)}`)
  await expect(items.getByRole('listitem')).toHaveText(/^7번 핑크프릴 8,000원 · 문자찜/)
  await expect(items).toContainText('상품 1개')
})

test('AC-O4-18·20·21·27: 포장 모드 (375px) — 옵션 글·큰 수량·"상품 n개" = 수량 합, 포장 완료가 { key, qty }를 화면 순서로 보내고 포장 라벨 항목에 옵션·수량', async ({ page, browser }) => {
  const day = await clothingDay(page)
  // 정산 목록의 상품 수 = 수량 합 (AC-O4-27): 박민수 2, 홍길동 2
  await page.goto(`/settlements?date=${day.date}`)
  const table = page.getByRole('table', { name: '정산 묶음' })
  await expect(table.getByRole('row').filter({ hasText: '박민수' })).toContainText('2개')
  await expect(table.getByRole('row').filter({ hasText: '홍길동' })).toContainText('2개')

  const phone = await phoneLike(browser, page)
  try {
    const sent: Request[] = []
    phone.on('request', (r) => { if (new URL(r.url()).pathname === `/api/days/${day.date}/packing` && r.method() === 'POST') sent.push(r) })
    await phone.goto(`/packing?date=${day.date}`)
    const rows = phone.getByRole('region', { name: '포장 목록' }).getByRole('list', { name: '포장할 구매자' }).getByRole('link')
    await expect(rows.filter({ hasText: '박민수' })).toContainText('상품 2개')
    await expect(rows.filter({ hasText: '홍길동' })).toContainText('상품 2개')
    await rows.filter({ hasText: '박민수' }).click()
    const cl = phone.getByRole('region', { name: '체크리스트' })
    await expect(cl.locator('header')).toContainText('상품 2개')
    const tee = cl.getByRole('checkbox', { name: '22번 반팔티 105/검정색 2개' })
    await expect(tee).toBeVisible()
    const label = tee.locator('xpath=ancestor::label[1]')
    await expect(label.locator('.pack-variant')).toHaveText('105/검정색')
    await expect(label.locator('.pack-qty')).toHaveText('2개')
    // 큰 수량은 번호와 같은 크기·굵기
    const style = async (sel: string) => await label.locator(sel).evaluate((el) => [parseFloat(getComputedStyle(el).fontSize), Number(getComputedStyle(el).fontWeight)])
    expect(await style('.pack-qty')).toEqual(await style('.pack-no'))
    await expect(cl.getByText('0/1 담음')).toBeVisible()
    await noHorizontalScroll(phone)
    await tee.click()
    await cl.getByRole('button', { name: '포장 완료', exact: true }).click()
    await expect(cl.locator('header')).toContainText('포장 완료')
    expect(sent.at(-1)?.postDataJSON()).toMatchObject({ buyer: day.buyers['박민수'], action: 'pack', items: [{ key: `${day.b}/22#105/검정색`, qty: 2 }] })
    const labelData = await packingLabelData(page, day.date, day.buyers['박민수']!)
    expect(labelData.data.broadcasts).toEqual([{ title: '의류 1부', numbers: [{ no: 22, variant: '105/검정색', qty: 2 }] }])
    await expect(cl.getByRole('region', { name: '포장 라벨' }).getByRole('img', { name: /^포장 라벨 1\/1쪽$/ })).toBeVisible()

    // 홍길동: 21번 반바지 L + 2개 한 줄 (취소한 M 없음)
    await phone.goto(`/packing?date=${day.date}&buyer=${encodeURIComponent(day.buyers['홍길동']!)}`)
    await expect(cl.getByRole('checkbox')).toHaveCount(1)
    const l = cl.getByRole('checkbox', { name: '21번 반바지 L 2개' })
    await expect(l).toBeVisible()
    await expect(cl).not.toContainText('반바지 M')
    await l.click()
    await cl.getByRole('button', { name: '포장 완료', exact: true }).click()
    await expect(cl.locator('header')).toContainText('포장 완료')
    expect(sent.at(-1)?.postDataJSON()).toMatchObject({ action: 'pack', items: [{ key: `${day.b}/21#L`, qty: 2 }] })
  } finally {
    await phone.context().close()
  }
})

test('AC-O4-20·21: 한 묶음에 다육·옵션 수량 1·옵션 없는 수량 3·옵션 수량 2 — 줄 글, "상품 7개"·"0/4 담음", 보낸 items 순서 = 화면 순서', async ({ page, browser }) => {
  const date = uniqueDate()
  const P = phoneNo()
  const { b: d } = await createBroadcast(page, { date, rehearsal: false, saleMode: 'NUMBERS', title: '다육 1부' })
  expect((await writeEvent(page, { type: 'product.register', b: d, no: 7, name: '핑크프릴', price: 8000 })).status).toBeLessThan(300)
  const { b } = await createBroadcast(page, { date, rehearsal: false, saleMode: 'OPTIONS', title: '옵션 2부' })
  await registerOptions(page, b, { ...SHORTS })
  await registerOptions(page, b, { no: 11, name: '초코 과자', price: 2000, stock: 5, aliases: ['초코'] })
  await registerOptions(page, b, { ...TEE })
  const buyer = await sms(page, date, d, 7, P, '<b>홍</b>')
  await sms(page, date, b, 21, P, '<b>홍</b>', { options: { 사이즈: 'M' } })
  await sms(page, date, b, 11, P, '<b>홍</b>', { qty: 3 })
  await sms(page, date, b, 22, P, '<b>홍</b>', { options: { 사이즈: '105', 색상: '검정색' }, qty: 2 })
  const entry = (await packingList(page, date)).find((e) => e.buyer === buyer)!
  expect(entry.items.length).toBe(4)
  const phone = await phoneLike(browser, page)
  try {
    let body: Record<string, unknown> | null = null
    phone.on('request', (r) => { if (new URL(r.url()).pathname === `/api/days/${date}/packing` && r.method() === 'POST') body = r.postDataJSON() as Record<string, unknown> })
    await phone.goto(`/packing?date=${date}&buyer=${encodeURIComponent(buyer)}`)
    const cl = phone.getByRole('region', { name: '체크리스트' })
    await expect(cl.locator('header')).toContainText('상품 7개')
    await expect(cl.getByText('0/4 담음')).toBeVisible()
    const boxes = cl.getByRole('checkbox')
    await expect(boxes).toHaveCount(4)
    const names = await boxes.evaluateAll((els) => els.map((el) => (el.closest('label')?.textContent ?? '').replace(/\s+/g, ' ').trim()))
    expect(names).toEqual(['7번 핑크프릴', '11번 초코 과자 3개', '21번 반바지 M', '22번 반팔티 105/검정색 2개'])
    // 다육 줄은 옵션 글·수량 칸이 없다 (BASE 모양)
    const first = boxes.nth(0).locator('xpath=ancestor::label[1]')
    await expect(first.locator('.pack-variant')).toHaveCount(0)
    await expect(first.locator('.pack-qty')).toHaveCount(0)
    await expect(cl.getByRole('checkbox', { name: '21번 반바지 M' }).locator('xpath=ancestor::label[1]').locator('.pack-qty')).toHaveCount(0)
    for (let i = 0; i < 4; i += 1) await boxes.nth(i).click()
    await expect(cl.getByText('4/4 담음')).toBeVisible()
    await cl.getByRole('button', { name: '포장 완료', exact: true }).click()
    await expect(cl.locator('header')).toContainText('포장 완료')
    expect(body).not.toBeNull()
    expect((body as unknown as { items: unknown[] }).items).toEqual([
      { key: `${d}/7`, qty: 1 },
      { key: `${b}/11`, qty: 3 },
      { key: `${b}/21#M`, qty: 1 },
      { key: `${b}/22#105/검정색`, qty: 2 },
    ])
    // 구매자 이름은 글로만 (이스케이프)
    await expect(phone.locator('b', { hasText: '홍' })).toHaveCount(0)
  } finally {
    await phone.context().close()
  }
})

test('AC-O4-19·23: 포장 뒤 수량이 2 → 1로 바뀌면 "포장 다시 확인"(새로 담을 것 L · 뺄 것 L 2개), 바뀌기 전 수량을 보낸 포장 완료·키 글만 보낸 포장 완료는 409·기록 없음, 열어 둔 화면이 보낸 것도 거절되고 안내', async ({ page, browser }) => {
  const day = await clothingDay(page)
  const hong = day.buyers['홍길동']!
  const L = `${day.b}/21#L`
  // 키 글만 보낸 포장 완료(이전 화면)는 수량 1로 읽혀 수량 2 묶음이면 409 (D-O4-05)
  const legacy = await packingCommand(page, day.date, { buyer: hong, action: 'pack', items: [L] })
  expect([legacy.status, (legacy.body['error'] as { code?: string } | undefined)?.code ?? legacy.body['code']]).toEqual([409, 'ITEMS_CHANGED'])
  expect((await packingList(page, day.date)).find((e) => e.buyer === hong)?.status).toBe('포장 대기')
  // 포장 완료 (수량 2)
  expect((await packingCommand(page, day.date, { buyer: hong, action: 'pack', items: [{ key: L, qty: 2 }] })).status).toBe(200)
  // 판매자: 21 L 홍길동 찜 취소 → 직접 배정으로 21 L 1개
  await hostAction(page, { type: 'host.cancel', b: day.b, no: 21, buyer: hong, options: { 사이즈: 'L' }, reason: '구매자 요청' })
  await hostAction(page, { type: 'host.assign', b: day.b, no: 21, buyer: hong, options: { 사이즈: 'L' }, qty: 1, reason: '전화 주문' })
  await expect.poll(async () => (await packingList(page, day.date)).find((e) => e.buyer === hong)?.status, { timeout: 15_000 }).toBe('포장 다시 확인')
  const entry = (await packingList(page, day.date)).find((e) => e.buyer === hong)!
  expect(entry.add.map((x) => [x.key, (x as unknown as { qty: number }).qty])).toEqual([[L, 1]])
  expect(entry.remove.map((x) => [x.key, (x as unknown as { qty: number }).qty])).toEqual([[L, 2]])

  // 바뀌기 전 수량(2)·키 글만 → 409 ITEMS_CHANGED, 상태 그대로
  const stale = await packingCommand(page, day.date, { buyer: hong, action: 'pack', items: [{ key: L, qty: 2 }] })
  expect([stale.status, (stale.body['error'] as { code?: string } | undefined)?.code ?? stale.body['code']]).toEqual([409, 'ITEMS_CHANGED'])
  const after = (await packingList(page, day.date)).find((e) => e.buyer === hong)!
  expect([after.status, after.add.length, after.remove.length]).toEqual(['포장 다시 확인', 1, 1])

  const phone = await phoneLike(browser, page)
  try {
    await phone.goto(`/packing?date=${day.date}&buyer=${encodeURIComponent(hong)}`)
    const cl = phone.getByRole('region', { name: '체크리스트' })
    await expect(cl.locator('header')).toContainText('포장 다시 확인')
    await expect(cl.getByRole('status').filter({ hasText: '구매 내역이 바뀌었어요' })).toHaveText('구매 내역이 바뀌었어요 — 새로 담을 것: 21번 반바지 L · 뺄 것: 21번 반바지 L 2개')
    const box = cl.getByRole('checkbox', { name: '21번 반바지 L' , exact: true })
    await expect(box).toBeVisible()
    // 열어 둔 이 화면은 실시간 소식을 받지 못한다 — 그 사이 판매자가 22번 95/흰색을 더 배정
    await phone.route('**/api/stream**', (route) => route.abort())
    await phone.route(`**/api/days/${day.date}/packing`, async (route) => {
      if (route.request().method() === 'GET') return await route.abort()
      return await route.continue()
    })
    await hostAction(page, { type: 'host.assign', b: day.b, no: 22, buyer: hong, options: { 사이즈: '95', 색상: '흰색' }, qty: 1, reason: '전화 주문' })
    await expect.poll(async () => (await packingList(page, day.date)).find((e) => e.buyer === hong)?.items.length, { timeout: 15_000 }).toBe(2)
    await box.click()
    const reply = phone.waitForResponse((r) => new URL(r.url()).pathname === `/api/days/${day.date}/packing` && r.request().method() === 'POST')
    await cl.getByRole('button', { name: '포장 완료', exact: true }).click()
    expect((await reply).status()).toBe(409)
    await expect(cl.getByText('그 사이 구매 내역이 바뀌어 포장 완료로 적지 않았어요. 바뀐 품목을 담고 다시 눌러 주세요.')).toBeVisible()
    await expect(cl.getByRole('checkbox', { name: '22번 반팔티 95/흰색' })).toBeVisible()
    await expect(cl.getByRole('checkbox', { name: '22번 반팔티 95/흰색' })).not.toBeChecked()
    const last = (await packingList(page, day.date)).find((e) => e.buyer === hong)!
    expect(last.status).toBe('포장 다시 확인')
  } finally {
    await phone.context().close()
  }
})

test('AC-O4-24: 지난 구매 — 지난 날 옵션 방송 22번 105/검정색 2개 34,000원 · 다육 7번 8,000원이 옵션 글·수량·찜 금액으로 보인다', async ({ page }) => {
  const P = phoneNo()
  const d1 = uniqueDate()
  const d2 = uniqueDate()
  const { b } = await createBroadcast(page, { date: d1, rehearsal: false, saleMode: 'OPTIONS', title: '의류 지난' })
  await registerOptions(page, b, { ...TEE })
  const { b: d } = await createBroadcast(page, { date: d1, rehearsal: false, saleMode: 'NUMBERS', title: '다육 지난' })
  expect((await writeEvent(page, { type: 'product.register', b: d, no: 7, name: '핑크프릴', price: 8000 })).status).toBeLessThan(300)
  await sms(page, d1, b, 22, P, '박민수', { options: { 사이즈: '105', 색상: '검정색' }, qty: 2 })
  await sms(page, d1, d, 7, P, '박민수')
  const { b: today } = await createBroadcast(page, { date: d2, rehearsal: false, saleMode: 'NUMBERS', title: '오늘' })
  expect((await writeEvent(page, { type: 'product.register', b: today, no: 9, name: '블루', price: 3000 })).status).toBeLessThan(300)
  const now = await sms(page, d2, today, 9, P, '박민수')
  // 서버 품목
  const res = await page.request.get(`/api/days/${d2}/past?buyer=${encodeURIComponent(now)}`)
  expect(res.ok(), await res.text()).toBe(true)
  const past = await res.json() as { items: { date: string; subtotal: number; total: number; items: { no: number; name: string; price: number; variant: string | null; qty: number; amount: number | null }[] }[] }
  const mine = past.items.find((x) => x.date === d1)!
  expect(mine.items.map((x) => [x.no, x.name, x.variant, x.qty, x.amount, x.price]).sort()).toEqual([[22, '반팔티', '105/검정색', 2, 34000, 17000], [7, '핑크프릴', null, 1, 8000, 8000]].sort())
  expect([mine.subtotal, mine.total]).toEqual([42000, 46000])
  // 화면
  await page.goto(`/buyers?date=${d2}&buyer=${encodeURIComponent(now)}`)
  const link = page.getByRole('region', { name: '지난 구매' }).getByRole('link')
  await expect(link).toHaveCount(1)
  await expect(link).toContainText('상품 3개')
  await expect(link).toContainText('22번 반팔티 105/검정색 2개 34,000원')
  await expect(link).toContainText('7번 핑크프릴 8,000원')
  await expect(link).not.toContainText('17,000원')
})
