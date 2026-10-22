// ORD-11 화면 — 재고 2개 이상 "개수" 칸 (AC-ORD11-01~09, D-STK-01) — test-e2e.
// 기대값은 SPEC ORD-11 표와 DOMAIN_RULES R-10(재고 변경)·R-16(빠른 입력)·R-3(번호 방송 댓글)에서 정했다.
// 빠른 입력 문법·댓글 해석의 "지금 결과"는 골든과 같은 엔진 파서(@livejjim/core)로 미리 확인하고 쓴다.
import { expect, test, type Browser, type Page } from '@playwright/test'
import { parseChat, parseQuickInput } from '@livejjim/core'
import { chat, history, login, openOptionBroadcast, productOf, register, uniqueDate, waitClaims, writeEvent, type OScope, oscope } from '../o2/support.ts'
import { board, boardItem, openNewBroadcast } from '../s05/support.ts'

const COUNT_PROBLEM = '개수는 1~999개로 적어 주세요.'
const shrinkWords = (n: number) => `이미 ${String(n)}명이 찜해서 ${String(n)}개보다 적게 줄일 수 없어요. 먼저 찜을 무효로 해 주세요.`

/** 빠른 입력 줄 옆 "개수" 칸 (고치기 칸·창이 열려 있지 않을 때) */
function quickCount(page: Page) {
  return page.getByLabel('개수', { exact: true })
}

function quick(page: Page) {
  return page.getByLabel('빠른 입력')
}

function detail(page: Page, no: number) {
  return page.getByRole('dialog', { name: `${String(no)}번 자세히` })
}

function editForm(page: Page, no: number) {
  return page.getByRole('dialog', { name: `${String(no)}번 고치기` })
}

function askDialog(page: Page, no: number) {
  return page.getByRole('dialog', { name: `${String(no)}번이 이미 있어요. 고칠까요?` })
}

/** 그 방송의 상품 등록·고치기 이력 */
async function productEvents(page: Page, date: string, rehearsal: boolean, type: 'product.register' | 'product.update') {
  return (await history(page, date, rehearsal)).filter((e) => e.type === type)
}

/** 확정·대기 찜을 닉네임으로 (seq 순) */
function claimsByNick(s: OScope, b: string, no: number): { confirmed: string[]; waiting: string[] } {
  const nick = (id: string) => s.buyers.find((x) => x.id === id)?.display ?? id
  const mine = s.claims.filter((c) => c.broadcast === b && c.no === no).sort((x, y) => x.seq - y.seq)
  return {
    confirmed: mine.filter((c) => c.status === 'CONFIRMED').map((c) => nick(c.currentBuyer)),
    waiting: mine.filter((c) => c.status === 'WAITLISTED').map((c) => nick(c.currentBuyer)),
  }
}

/** 리허설 방송에서 시청자 여러 명이 차례로 "15" (활성 찜 수가 n이 될 때까지) */
async function claimInOrder(page: Page, b: string, date: string, no: number, nicks: string[], before = 0): Promise<void> {
  let n = before
  for (const nick of nicks) {
    await chat(page, b, nick, String(no))
    n += 1
    await waitClaims(page, date, true, b, n)
  }
}

/** 상품 자세히 → "고치기" 창 */
async function openEdit(page: Page, no: number) {
  await boardItem(page, no).click()
  await detail(page, no).getByRole('button', { name: '고치기', exact: true }).click()
  const form = editForm(page, no)
  await expect(form).toBeVisible()
  return form
}

async function apiRegister(page: Page, b: string, no: number, name: string, price: number, stock?: number): Promise<void> {
  const res = await writeEvent(page, { type: 'product.register', b, no, name, price, ...(stock === undefined ? {} : { stock }) })
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
}

test.describe('ORD-11 개수 칸 — 등록', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('AC-ORD11-01·07: 개수 3 + "15 초코과자 3000" → 재고 3 등록, 칸은 1로 · 세 사람 1등, 네 번째 대기 · "3개 중 n개 남음"', async ({ page }) => {
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true })
    await expect(quickCount(page)).toBeVisible()
    await expect(quickCount(page)).toHaveValue('1')
    await quickCount(page).fill('3')
    await register(page, '15 초코과자 3000', 15)
    await expect(quickCount(page), '등록 뒤 1로 돌아감 — 다음 상품에 3이 따라가지 않게').toHaveValue('1')
    const regs = await productEvents(page, date, true, 'product.register')
    expect(regs).toHaveLength(1)
    expect(regs[0]!.fields['stock']).toBe(3)
    expect((await productOf(page, date, true, b, 15)).stock).toBe(3)
    await expect(boardItem(page, 15)).toContainText('3개 중 3개 남음')

    await claimInOrder(page, b, date, 15, ['가람'])
    await expect(boardItem(page, 15)).toContainText('3개 중 2개 남음')
    await claimInOrder(page, b, date, 15, ['나래', '다솜', '라온'], 1)
    const s = await oscope(page, date, true)
    expect(claimsByNick(s, b, 15)).toEqual({ confirmed: ['가람', '나래', '다솜'], waiting: ['라온'] })

    // 보드·현재 상품·자세히: 남은 개수와 1등 전원 (AC-ORD11-07)
    const item = boardItem(page, 15)
    await expect(item).toContainText('3개 중 0개 남음')
    for (const nick of ['가람', '나래', '다솜']) await expect(item).toContainText(nick)
    const current = page.getByRole('region', { name: '현재 상품' })
    await expect(current).toContainText('3개 중 0개 남음')
    for (const nick of ['가람', '나래', '다솜']) await expect(current).toContainText(nick)
    await item.click()
    const d = detail(page, 15)
    await expect(d).toContainText('3개 중 0개 남음')
    for (const nick of ['가람', '나래', '다솜', '라온']) await expect(d).toContainText(nick)
    await page.keyboard.press('Escape')
    await expect(d).toHaveCount(0)

    // 다음 상품은 칸을 건드리지 않았으니 재고 1 — 남은 개수 글이 붙지 않는다
    await register(page, '16 홍옥 5000', 16)
    const regs2 = await productEvents(page, date, true, 'product.register')
    expect(regs2).toHaveLength(2)
    expect(regs2[1]!.fields['stock'] ?? 1).toBe(1)
    expect((await productOf(page, date, true, b, 16)).stock).toBe(1)
    await expect(boardItem(page, 16)).not.toContainText(/개 중 \d+개 남음/)
    await expect(page.getByRole('region', { name: '현재 상품' })).not.toContainText(/개 중 \d+개 남음/)
  })

  test('AC-ORD11-02: "15 핑크프릴 8 ×3"·"15 초코과자 3000 3개"는 R-16 결과 그대로 — 개수로 읽지 않는다', async ({ page }) => {
    const date = uniqueDate()
    await openNewBroadcast(page, { date, rehearsal: false })
    for (const line of ['15 핑크프릴 8 ×3', '15 초코과자 3000 3개']) {
      // 골든과 같은 파서의 지금 결과: 가격을 못 찾는다 → 등록하지 않고 가격 칸으로
      expect(parseQuickInput(line)).toMatchObject({ error: 'PRICE_MISSING', no: 15 })
      await quick(page).fill(line)
      await quick(page).press('Enter')
      const fix = page.getByRole('group', { name: '고치기 칸' })
      await expect(fix).toBeVisible()
      await expect(fix.getByLabel('가격')).toBeFocused()
      await expect(fix.getByLabel('개수', { exact: true }), '꼬리 "3"·"3개"가 개수로 들어가지 않는다').toHaveValue('1')
      await page.keyboard.press('Escape')
      await expect(fix).toHaveCount(0)
    }
    expect(await productEvents(page, date, false, 'product.register')).toEqual([])
    await expect(boardItem(page, 15)).toHaveCount(0)
  })

  test('AC-ORD11-03: 자세히 등록(고치기 칸)에도 개수 칸(기본 1) — 3으로 등록하면 재고 3', async ({ page }) => {
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: false })
    await quick(page).fill('21 초코과자')
    await quick(page).press('Enter')
    const fix = page.getByRole('group', { name: '고치기 칸' })
    await expect(fix).toBeVisible()
    const count = fix.getByLabel('개수', { exact: true })
    await expect(count).toHaveValue('1')
    await expect(count).toHaveAttribute('inputmode', 'numeric')
    await count.fill('3')
    await fix.getByLabel('가격').fill('3000')
    await fix.getByLabel('가격').press('Enter')
    await expect(boardItem(page, 21)).toBeVisible()
    await expect(fix).toHaveCount(0)
    await expect(quickCount(page)).toHaveValue('1')
    const regs = await productEvents(page, date, false, 'product.register')
    expect(regs).toHaveLength(1)
    expect(regs[0]!.fields['stock']).toBe(3)
    expect((await productOf(page, date, false, b, 21)).stock).toBe(3)
    await expect(boardItem(page, 21)).toContainText('3개 중 3개 남음')
  })

  test('AC-ORD11-04: 개수 0·1000·2.5·빈칸·글자 → 보내지 않고 문장, 친 줄은 남음 · 숫자 자판', async ({ page }) => {
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: false })
    await expect(quickCount(page)).toHaveAttribute('inputmode', 'numeric')
    for (const bad of ['0', '1000', '2.5', '', '세개']) {
      await quickCount(page).fill(bad)
      await quick(page).fill('31 초코과자 3000')
      await quick(page).press('Enter')
      await expect(page.getByText(COUNT_PROBLEM), `개수 "${bad}"`).toBeVisible()
      await expect(quick(page)).toHaveValue('31 초코과자 3000')
      await expect(boardItem(page, 31)).toHaveCount(0)
    }
    // 개수 칸에서 Enter도 줄 Enter와 같다 — 틀린 값이면 역시 보내지 않는다
    await quickCount(page).fill('0')
    await quickCount(page).press('Enter')
    await expect(page.getByText(COUNT_PROBLEM)).toBeVisible()
    expect(await productEvents(page, date, false, 'product.register')).toEqual([])
    // 바르게 고치면 문장이 사라지고 그 개수로 한 번만 등록된다
    await quickCount(page).fill('2')
    await expect(page.getByText(COUNT_PROBLEM)).toHaveCount(0)
    await quickCount(page).press('Enter')
    await expect(boardItem(page, 31)).toBeVisible()
    const regs = await productEvents(page, date, false, 'product.register')
    expect(regs).toHaveLength(1)
    expect(regs[0]!.fields['stock']).toBe(2)

    // "고치기" 창의 개수 칸도 같은 검사
    const form = await openEdit(page, 31)
    const count = form.getByLabel('개수', { exact: true })
    await expect(count).toHaveAttribute('inputmode', 'numeric')
    for (const bad of ['0', '1000', '2.5', '', '세개']) {
      await count.fill(bad)
      await form.getByRole('button', { name: '고치기', exact: true }).click()
      await expect(form.getByText(COUNT_PROBLEM), `고치기 개수 "${bad}"`).toBeVisible()
    }
    expect(await productEvents(page, date, false, 'product.update')).toEqual([])
    expect((await productOf(page, date, false, b, 31)).stock).toBe(2)
  })
})

test.describe('ORD-11 개수 칸 — 고치기', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('AC-ORD11-05: 재고 1 · 1등 A · 대기 B·C·D → 고치기로 3 → stock=3, B·C가 대기 순서대로 1등, D는 대기', async ({ page }) => {
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true })
    await register(page, '15 초코과자 3000', 15)
    await claimInOrder(page, b, date, 15, ['가람', '나래', '다솜', '라온'])
    expect(claimsByNick(await oscope(page, date, true), b, 15)).toEqual({ confirmed: ['가람'], waiting: ['나래', '다솜', '라온'] })
    await expect(boardItem(page, 15)).not.toContainText(/개 중 \d+개 남음/)

    const form = await openEdit(page, 15)
    const count = form.getByLabel('개수', { exact: true })
    await expect(count, '처음 값은 지금 재고').toHaveValue('1')
    await count.fill('3')
    await form.getByRole('button', { name: '고치기', exact: true }).click()
    await expect(form).toHaveCount(0)

    const updates = await productEvents(page, date, true, 'product.update')
    expect(updates).toHaveLength(1)
    expect(updates[0]!.fields['stock']).toBe(3)
    expect(updates[0]!.fields).not.toHaveProperty('name')
    expect(updates[0]!.fields).not.toHaveProperty('price')
    await expect.poll(async () => claimsByNick(await oscope(page, date, true), b, 15)).toEqual({ confirmed: ['가람', '나래', '다솜'], waiting: ['라온'] })
    const item = boardItem(page, 15)
    await expect(item).toContainText('3개 중 0개 남음')
    for (const nick of ['가람', '나래', '다솜']) await expect(item).toContainText(nick)
    await expect(item).toContainText('대기 1')
  })

  test('AC-ORD11-06: 확정 3명 → 2로 줄이면 보내지 않고 문장 · 3으로 줄이면 품절 · "고칠까요?" 줄임도 막힘', async ({ page }) => {
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true })
    await apiRegister(page, b, 15, '초코과자', 3000, 5)
    await expect(boardItem(page, 15)).toContainText('5개 중 5개 남음')
    await claimInOrder(page, b, date, 15, ['가람', '나래', '다솜'])
    await expect(boardItem(page, 15)).toContainText('5개 중 2개 남음')

    const form = await openEdit(page, 15)
    const count = form.getByLabel('개수', { exact: true })
    await expect(count).toHaveValue('5')
    await count.fill('2')
    await form.getByRole('button', { name: '고치기', exact: true }).click()
    await expect(form.getByText(shrinkWords(3))).toBeVisible()
    await expect(form).toBeVisible()
    expect(await productEvents(page, date, true, 'product.update')).toEqual([])
    expect((await productOf(page, date, true, b, 15)).stock).toBe(5)

    // 확정 수와 같으면 된다 → 품절
    await count.fill('3')
    await form.getByRole('button', { name: '고치기', exact: true }).click()
    await expect(form).toHaveCount(0)
    const updates = await productEvents(page, date, true, 'product.update')
    expect(updates).toHaveLength(1)
    expect(updates[0]!.fields['stock']).toBe(3)
    // 확정 수 = 재고 → 품절(상품 상태 SOLD, 화면 낱말 "판매 완료")
    await expect.poll(async () => (await productOf(page, date, true, b, 15)).status).toBe('SOLD')
    await expect(boardItem(page, 15)).toContainText('판매 완료')
    await expect(boardItem(page, 15)).toContainText('3개 중 0개 남음')
    expect(claimsByNick(await oscope(page, date, true), b, 15).confirmed).toEqual(['가람', '나래', '다솜'])

    // 같은 번호 줄 + 개수 2 → "고칠까요?"에서 예 → 같은 문장, 보내지 않는다 (AC-ORD11-08 줄임 막힘)
    await page.keyboard.press('Escape')
    await expect(detail(page, 15)).toHaveCount(0)
    await quickCount(page).fill('2')
    await quick(page).fill('15 초코과자 3000')
    await quick(page).press('Enter')
    const ask = askDialog(page, 15)
    await expect(ask).toBeVisible()
    await ask.getByRole('button', { name: '예' }).click()
    await expect(ask.getByText(shrinkWords(3))).toBeVisible()
    expect(await productEvents(page, date, true, 'product.update')).toHaveLength(1)
    expect((await productOf(page, date, true, b, 15)).stock).toBe(3)
  })

  test('AC-ORD11-08: 같은 번호 — 개수 1이면 품종·가격만, 개수 3이면 "개수 3개로"와 함께 한 번에', async ({ page }) => {
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: false })
    await register(page, '15 핑크프릴 10000', 15)

    await quick(page).fill('15 핑크프릴 12000')
    await quick(page).press('Enter')
    let ask = askDialog(page, 15)
    await expect(ask).toBeVisible()
    await expect(ask.getByRole('rowheader', { name: '개수' })).toHaveCount(0)
    await expect(ask.getByText(/개수 \d+개로/)).toHaveCount(0)
    await ask.getByRole('button', { name: '예' }).click()
    await expect(boardItem(page, 15)).toContainText('12,000원')
    let updates = await productEvents(page, date, false, 'product.update')
    expect(updates).toHaveLength(1)
    expect(updates[0]!.fields['price']).toBe(12000)
    expect(updates[0]!.fields).not.toHaveProperty('stock')
    expect((await productOf(page, date, false, b, 15)).stock).toBe(1)

    await quickCount(page).fill('3')
    await quick(page).fill('15 핑크프릴 13000')
    await quick(page).press('Enter')
    ask = askDialog(page, 15)
    await expect(ask).toBeVisible()
    await expect(ask.getByText(/개수 3개로/)).toBeVisible()
    await ask.getByRole('button', { name: '예' }).click()
    await expect(ask).toHaveCount(0)
    await expect(boardItem(page, 15)).toContainText('13,000원')
    await expect(boardItem(page, 15)).toContainText('3개 중 3개 남음')
    updates = await productEvents(page, date, false, 'product.update')
    expect(updates, '한 번에 고친다').toHaveLength(2)
    expect(updates[1]!.fields['price']).toBe(13000)
    expect(updates[1]!.fields['stock']).toBe(3)
    await expect(quickCount(page)).toHaveValue('1')
    expect(await productEvents(page, date, false, 'product.register')).toHaveLength(1)
  })
})

test.describe('ORD-11 옵션 상품·번호 방송', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('AC-ORD11-09: 옵션을 붙이면 개수 칸이 사라지고 stock을 보내지 않음 · 옵션 상품 고치기에도 개수 칸 없음', async ({ page }) => {
    const { b, date } = await openOptionBroadcast(page)
    await expect(quickCount(page)).toBeVisible()
    await quickCount(page).fill('3')
    await quick(page).fill('21 반바지 15000')
    await page.getByRole('button', { name: '옵션 추가' }).click()
    const dlg = page.getByRole('dialog', { name: '옵션 추가' })
    await dlg.getByRole('button', { name: '항목 더하기' }).click()
    await dlg.getByLabel('항목 1 이름').fill('사이즈')
    await dlg.getByLabel('항목 1 선택지 여러 개').fill('S, M')
    await dlg.getByRole('button', { name: '항목 1 선택지 한 번에 더하기' }).click()
    await dlg.getByRole('button', { name: '옵션 넣기' }).click()
    await expect(dlg).toHaveCount(0)
    await expect(page.getByRole('group', { name: '붙은 옵션' })).toBeVisible()
    await expect(quickCount(page), '옵션 상품은 개수 칸 대신 변형 재고 표').toHaveCount(0)
    await quick(page).press('Enter')
    await expect(boardItem(page, 21)).toBeVisible()
    const regs = await productEvents(page, date, true, 'product.register')
    expect(regs).toHaveLength(1)
    expect(regs[0]!.fields).not.toHaveProperty('stock')
    const p = await productOf(page, date, true, b, 21)
    expect(p.hasOptions).toBe(true)
    expect(p.variants.map((v) => v.stock)).toEqual([1, 1])

    await boardItem(page, 21).click()
    await detail(page, 21).getByRole('button', { name: '고치기', exact: true }).click()
    const form = editForm(page, 21)
    await expect(form).toBeVisible()
    await expect(form.getByLabel('품종')).toBeVisible()
    await expect(form.getByLabel('개수', { exact: true })).toHaveCount(0)
  })

  test('AC-ORD11-09: 번호 방송에서 재고 3 상품에 "15 3개" → 수량 3 찜이 생기지 않음(R-3), 뒤의 "15"는 한 개 찜', async ({ page }) => {
    // 골든과 같은 파서의 지금 결과: "15 3개"는 찜이 아니라 언급
    expect(parseChat('15 3개').claims).toEqual([])
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true })
    await quickCount(page).fill('3')
    await register(page, '15 초코과자 3000', 15)
    await chat(page, b, '가람', '15 3개')
    await chat(page, b, '나래', '15')
    const claims = await waitClaims(page, date, true, b, 1)
    const s = await oscope(page, date, true)
    expect(claimsByNick(s, b, 15)).toEqual({ confirmed: ['나래'], waiting: [] })
    expect(claims[0]!.qty ?? 1).toBe(1)
    await expect(boardItem(page, 15)).toContainText('3개 중 2개 남음')
  })
})

async function phoneDevice(browser: Browser, baseURL: string): Promise<Page> {
  const ctx = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
  return ctx.newPage()
}

/** 누르는 곳 44px 이상·글자 16px 이상 */
async function expectTappable(page: Page, locator: ReturnType<Page['getByLabel']>, what: string): Promise<void> {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  expect(box, what).not.toBeNull()
  expect(box!.height, `${what} 높이`).toBeGreaterThanOrEqual(44)
  expect(box!.width, `${what} 폭`).toBeGreaterThanOrEqual(44)
  const font = await locator.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  expect(font, `${what} 글자`).toBeGreaterThanOrEqual(16)
}

test.describe('ORD-11 휴대폰 폭·두 기기', () => {
  test('AC-ORD11-01·04·05 375px: 개수 칸 44px·숫자 자판·가로 넘침 없음, 고치기 창의 개수 칸도', async ({ browser, baseURL }) => {
    const page = await phoneDevice(browser, baseURL!)
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: false })
    const count = quickCount(page)
    await expect(count).toBeVisible()
    await expect(count).toHaveAttribute('inputmode', 'numeric')
    await expectTappable(page, count, '빠른 입력 개수 칸')
    await expectTappable(page, quick(page), '빠른 입력 줄')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '가로 넘침 없음').toBe(true)

    await count.fill('3')
    await register(page, '15 초코과자 3000', 15)
    await expect(count).toHaveValue('1')
    expect((await productOf(page, date, false, b, 15)).stock).toBe(3)
    await expect(board(page)).toContainText('3개 중 3개 남음')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '남은 개수 글로 가로 넘침 없음').toBe(true)

    const form = await openEdit(page, 15)
    const editCount = form.getByLabel('개수', { exact: true })
    await expect(editCount).toHaveAttribute('inputmode', 'numeric')
    await expectTappable(page, editCount, '고치기 개수 칸')
    await editCount.fill('4')
    await form.getByRole('button', { name: '고치기', exact: true }).click()
    await expect(form).toHaveCount(0)
    await expect.poll(async () => (await productOf(page, date, false, b, 15)).stock).toBe(4)
    await page.context().close()
  })

  test('두 기기: PC가 고치기로 재고를 늘리면 휴대폰 보드에 남은 개수와 승계된 1등이 보인다', async ({ browser, baseURL, page }) => {
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true })
    await register(page, '15 초코과자 3000', 15)
    await claimInOrder(page, b, date, 15, ['가람', '나래'])
    const phone = await phoneDevice(browser, baseURL!)
    await login(phone)
    await phone.goto(`/broadcasts/${encodeURIComponent(b)}`)
    await expect(boardItem(phone, 15)).toContainText('가람')
    await expect(boardItem(phone, 15)).not.toContainText(/개 중 \d+개 남음/)

    const form = await openEdit(page, 15)
    await form.getByLabel('개수', { exact: true }).fill('2')
    await form.getByRole('button', { name: '고치기', exact: true }).click()
    await expect(form).toHaveCount(0)
    await expect(boardItem(phone, 15)).toContainText('2개 중 0개 남음')
    await expect(boardItem(phone, 15)).toContainText('나래')
    expect(claimsByNick(await oscope(page, date, true), b, 15)).toEqual({ confirmed: ['가람', '나래'], waiting: [] })
    await phone.context().close()
  })
})

test('TE-STK-001 · AC-S06-61 회귀: 375px에서 개수 칸이 빠른 입력 줄 밑으로 꺾여 고정 영역을 한 줄(약 52px) 늘리지 않는다', async ({ browser, baseURL }) => {
  // 고정 영역 ≤ 284px(AC-S06-61)은 알림 여러 종류 + 되돌리기 대기에서도 지켜야 한다. 개수 칸이 줄 밑으로 꺾이면
  // 그 시험(s06/layout.spec.ts)이 307px로 넘친다. 여기서는 원인만 좁혀 본다: 개수 칸이 빠른 입력 줄과 같은 줄에 있어야 한다.
  const page = await phoneDevice(browser, baseURL!)
  await login(page)
  await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
  const line = await quick(page).boundingBox()
  const count = await quickCount(page).boundingBox()
  expect(line).not.toBeNull()
  expect(count).not.toBeNull()
  expect(count!.y, `빠른 입력 줄 y ${String(line!.y)}~${String(line!.y + line!.height)} · 개수 칸 y ${String(count!.y)}`).toBeLessThan(line!.y + line!.height)
  await page.context().close()
})
