// AC-N4a-13 (위 줄·라벨 화면), AC-N4a-14 (콘솔·상품 자세히·Alt+P·단축키 안내·알림 띠·리허설), AC-N4a-15 (정산 자세히 포장 라벨),
// AC-N4a-18 (모르는 동안 숨김·열린 창이 1초 안에 바뀜), AC-N4a-32 (꺼진 판매자의 화면 둘러보기 PC·휴대폰), AC-N4a-19 (다시 켜면 그대로)
import { expect, test, type Page } from '@playwright/test'
import { boardItem, cleanupN4a, gotoSettings, LABEL_CONTROL, login, noHorizontalScroll, OFF_NOTE, openNewBroadcast, postJson, primaryOutsideDialogs, realBroadcast, registerApi, setLabels, smsApi, uniqueDate, viewerClaim } from './support.ts'
import { closeMore, menuLink, moreLinks, openMore } from '../menu.ts'

test.afterEach(async ({ page }) => {
  await cleanupN4a(page)
})

const PRINTER_STATUS = /^(프린터 |출력 멈춤 ·)/


/** 화면 어디에도 라벨 조작이 없다 (창 안 포함) */
async function noLabelControls(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: LABEL_CONTROL })).toHaveCount(0)
  await expect(page.getByRole('link', { name: LABEL_CONTROL })).toHaveCount(0)
  await expect(menuLink(page, '라벨')).toHaveCount(0)
  await expect(page.getByRole('link', { name: PRINTER_STATUS })).toHaveCount(0)
  await expect(page.getByRole('img', { name: /라벨.*미리 보기/ })).toHaveCount(0)
}

/** 처음부터 라벨 조작이 한 번이라도 나타났는지 기록 (AC-N4a-18 — 잠깐이라도) */
async function recordLabelFlashes(page: Page): Promise<void> {
  await page.addInitScript((source) => {
    const re = new RegExp(source)
    const w = window as unknown as { __labelFlashes: string[] }
    w.__labelFlashes = []
    const check = () => {
      for (const el of document.querySelectorAll('button, a')) {
        const text = (el.textContent ?? '').trim()
        const inMenu = el.closest('nav[aria-label="메뉴"]') !== null && text === '라벨'
        if (re.test(text) || inMenu || /^(프린터 |출력 멈춤 ·)/.test(text)) w.__labelFlashes.push(text)
      }
    }
    new MutationObserver(check).observe(document, { subtree: true, childList: true, characterData: true })
  }, LABEL_CONTROL.source)
}
async function flashes(page: Page): Promise<string[]> {
  return await page.evaluate(() => (window as unknown as { __labelFlashes: string[] }).__labelFlashes)
}

/** 1등이 있는 실제 방송 + 대기열 멈춤(출력 멈춤 알림 재료) */
async function dayWithWinners(page: Page): Promise<{ date: string; b: string }> {
  const date = uniqueDate()
  const b = await realBroadcast(page, date)
  await registerApi(page, b, 15, '핑크프릴', 10000)
  await registerApi(page, b, 16, '블루버드', 5000)
  await smsApi(page, { b, no: 15, phone: '010-3434-5656' })
  await smsApi(page, { b, no: 16, phone: '010-3434-5656' })
  await postJson(page, '/api/print/pause', {})
  return { date, b }
}

test('AC-N4a-13·14: 꺼짐 — 위 줄 프린터 상태·메뉴 "라벨" 없음, /labels는 안내·"설정"만, 콘솔 보드·상품 자세히·Alt+P·단축키 안내·알림 띠', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page)
  const { b } = await dayWithWinners(page)
  await expect(page.getByRole('region', { name: '알림' })).toContainText('출력 멈춤')
  await expect(boardItem(page, 15)).toContainText(/라벨 대기|라벨 출력됨|출력 중/)
  await setLabels(page, false)

  // 1초 안에 콘솔에서 사라진다
  await expect(menuLink(page, '라벨')).toHaveCount(0, { timeout: 1_000 })
  await expect(page.getByRole('link', { name: PRINTER_STATUS })).toHaveCount(0, { timeout: 1_000 })
  await expect(boardItem(page, 15)).not.toContainText(/라벨|출력/, { timeout: 1_000 })
  await expect(page.getByRole('region', { name: '알림' })).not.toContainText('출력 멈춤', { timeout: 1_000 })
  await expect(page.getByText(/^단축키:/)).not.toContainText('Alt+P')
  await expect(page.getByRole('navigation', { name: '메뉴' }).getByRole('link')).not.toHaveCount(0)
  await noLabelControls(page)

  // 상품 자세히: 라벨 자리에 안내 한 번, 나머지 그대로
  const input = page.getByLabel('빠른 입력')
  await input.fill('15번')
  await input.press('Enter')
  const detail = page.getByRole('dialog', { name: '15번 자세히' })
  await expect(detail).toBeVisible()
  const lab = detail.getByRole('region', { name: '라벨', exact: true })
  await expect(lab).toContainText(OFF_NOTE)
  await expect(detail.getByText(OFF_NOTE)).toHaveCount(1)
  await expect(lab.getByRole('button')).toHaveCount(0)
  await expect(lab.getByRole('img')).toHaveCount(0)
  await expect(detail).not.toContainText(/라벨 대기|라벨 출력됨|출력 이력/)
  await noLabelControls(page)
  await page.keyboard.press('Escape')
  await expect(input).toBeFocused()

  // Alt+P: 창 없이 안내(status), 요청 없음, 빠른 입력칸 그대로
  let printReq = 0
  page.on('request', (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname.startsWith('/api/print/labels')) printReq += 1 })
  await input.fill('')
  await page.keyboard.press('Alt+KeyP')
  await expect(page.getByRole('status').filter({ hasText: OFF_NOTE })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(input).toBeFocused()
  await expect(input).toHaveValue('')
  expect(printReq).toBe(0)

  // Alt+1은 "출력 멈춤"을 건너뛴다 (알림이 출력 멈춤 하나뿐이면 아무 창도 없다)
  await page.keyboard.press('Alt+1')
  await expect(page.getByRole('dialog', { name: '출력 멈춤' })).toHaveCount(0)

  // /labels: 제목·안내·"설정" 링크만
  await page.goto('/labels')
  await expect(page.getByRole('heading', { name: '라벨', level: 1 })).toBeVisible()
  const main = page.getByRole('main')
  await expect(main).toContainText(OFF_NOTE)
  await expect(main.getByRole('link', { name: '설정', exact: true })).toBeVisible()
  await expect(main.getByRole('region')).toHaveCount(0)
  await expect(main.getByRole('button')).toHaveCount(0)
  await expect(main.getByRole('textbox')).toHaveCount(0)
  await expect(main.getByRole('checkbox')).toHaveCount(0)
  await noLabelControls(page)
  await main.getByRole('link', { name: '설정', exact: true }).click()
  await expect(page).toHaveURL(/\/settings$/)
  void b
})

test('AC-N4a-14: 리허설 콘솔 — 꺼져 있으면 "리허설 방송은 라벨을 출력하지 않아요."도 없다', async ({ page }) => {
  await login(page)
  await setLabels(page, false)
  const date = uniqueDate()
  const b = await openNewBroadcast(page, { date, rehearsal: true })
  await registerApi(page, b, 15, '핑크프릴', 10000)
  await viewerClaim(page, b, '가나다', '15', 'sim_ga_0909')
  await expect(boardItem(page, 15)).toContainText('가나다')
  await page.getByLabel('빠른 입력').fill('15번')
  await page.keyboard.press('Enter')
  const detail = page.getByRole('dialog', { name: '15번 자세히' })
  await expect(detail).toBeVisible()
  await expect(page.getByText('리허설 방송은 라벨을 출력하지 않아요.')).toHaveCount(0)
  await expect(detail.getByText(/라벨/)).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.goto(`/settlements?date=${date}&rehearsal=true`)
  await page.getByRole('table', { name: '정산 묶음' }).getByRole('link').first().click()
  await expect(page.getByRole('region', { name: '정산 자세히' })).toBeVisible()
  await expect(page.getByText('리허설 방송은 라벨을 출력하지 않아요.')).toHaveCount(0)
  await expect(page.getByRole('region', { name: '포장 라벨' })).toHaveCount(0)
})

async function openSettlement(page: Page, date: string, phone: boolean): Promise<void> {
  await page.goto(`/settlements?date=${date}`)
  const list = phone ? page.getByRole('list', { name: '정산 묶음', exact: true }) : page.getByRole('table', { name: '정산 묶음', exact: true })
  await list.getByRole('link').first().click()
  await expect(page.getByRole('region', { name: '정산 자세히' })).toBeVisible()
}

for (const phone of [false, true]) {
  test(`AC-N4a-15·32: ${phone ? '휴대폰 375' : 'PC'} — 꺼진 판매자의 화면 둘러보기(홈·콘솔·상품 자세히·구매자·정산 자세히·/labels·/settings), 안내는 라벨 자리에만, 주 버튼 하나 이하`, async ({ page }) => {
    await page.setViewportSize(phone ? { width: 375, height: 812 } : { width: 1440, height: 900 })
    await login(page)
    const { date, b } = await dayWithWinners(page)
    await setLabels(page, false)

    const check = async (where: string, note: boolean) => {
      await noLabelControls(page)
      if (note) await expect(page.getByText(OFF_NOTE), where).toHaveCount(1)
      else await expect(page.getByText(OFF_NOTE), where).toHaveCount(0)
      expect((await primaryOutsideDialogs(page)).length, `${where} 주 버튼`).toBeLessThanOrEqual(1)
      if (phone) await noHorizontalScroll(page)
      // AC-NAV-10: 휴대폰의 메뉴 "라벨"은 "더보기" 목록 안 — 닫힌 채 "없음"은 늘 통과하므로 목록을 연 채로도 본다
      // (창이 열려 있으면 창 밖을 누를 수 없다 — 그 화면의 메뉴는 창을 열기 전 단계에서 본다)
      if (phone && (await page.getByRole('dialog').count()) === 0) {
        await openMore(page)
        await expect(moreLinks(page), `${where} 목록`).not.toHaveCount(0)
        await noLabelControls(page)
        await closeMore(page)
      }
    }

    await page.goto('/')
    await expect(page.getByRole('navigation', { name: '메뉴' })).toBeVisible() // MOB1 D-MOB1-05 (휴대폰 위 줄에 로그아웃 없음)
    await check('홈', false)

    await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
    await expect(page.getByLabel('빠른 입력')).toBeVisible()
    await expect(boardItem(page, 15)).toBeVisible()
    await check('콘솔', false)
    await page.getByLabel('빠른 입력').fill('15번')
    await page.keyboard.press('Enter')
    const detail = page.getByRole('dialog', { name: '15번 자세히' })
    await expect(detail).toBeVisible()
    await check('상품 자세히', true)
    await page.keyboard.press('Escape')

    await page.goto(`/buyers?date=${date}`)
    const buyers = phone ? page.getByRole('list', { name: '구매자', exact: true }) : page.getByRole('table', { name: '구매자', exact: true })
    await buyers.getByRole('link').first().click()
    await expect(page.getByRole('region', { name: '구매자 자세히' })).toBeVisible()
    await check('구매자 자세히', false)

    await openSettlement(page, date, phone)
    const packing = page.getByRole('region', { name: '포장 라벨' })
    await expect(packing).toContainText(OFF_NOTE)
    await expect(packing.getByRole('button')).toHaveCount(0)
    await expect(packing.getByRole('img')).toHaveCount(0)
    await expect(packing).not.toContainText('재출력 필요')
    await check('정산 자세히', true)

    await page.goto('/labels')
    await expect(page.getByRole('heading', { name: '라벨', level: 1 })).toBeVisible()
    await check('/labels', true)

    await page.goto('/settings')
    await expect(page.getByText('라벨 기능: 꺼짐', { exact: true })).toBeVisible()
    await check('/settings', false)
  })
}

test('AC-N4a-18·32: 켬/끔 조회를 2초 늦춰도 콘솔·정산 자세히에 라벨 조작이 한 번도 나타나지 않는다 (꺼 둔 판매자)', async ({ page }) => {
  await login(page)
  const { date, b } = await dayWithWinners(page)
  await setLabels(page, false)
  await recordLabelFlashes(page)
  let delayed = 0
  await page.route(/\/api\/(print|settings\/labels)(\?.*)?$/, async (route) => {
    if (route.request().method() === 'GET') {
      delayed += 1
      await new Promise((r) => setTimeout(r, 2_000))
    }
    await route.continue()
  })
  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(page.getByLabel('빠른 입력')).toBeVisible()
  await expect(boardItem(page, 15)).toBeVisible()
  await page.getByLabel('빠른 입력').fill('15번')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: '15번 자세히' })).toBeVisible()
  await page.keyboard.press('Escape')
  // 모르는 동안 Alt+P는 창을 열지 않는다
  await page.keyboard.press('Alt+KeyP')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(() => delayed).toBeGreaterThan(0)
  await expect(page.getByRole('dialog', { name: '15번 자세히' })).toHaveCount(0)
  await openSettlement(page, date, false)
  await expect(page.getByRole('region', { name: '포장 라벨' })).toContainText(OFF_NOTE, { timeout: 10_000 })
  expect(await flashes(page)).toEqual([])
})

test('AC-N4a-18·19: 상품 자세히 창이 열린 채 다른 기기가 끄면 라벨 부분만 1초 안에 안내로(포커스 그대로) — 켜면 I1 모습으로 돌아온다', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page)
  const { date } = await dayWithWinners(page)
  await postJson(page, '/api/print/restart', {})
  const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(page.url()).origin })
  const other = await ctx.newPage()
  try {
    await login(other)
    await page.getByLabel('빠른 입력').fill('15번')
    await page.keyboard.press('Enter')
    const detail = page.getByRole('dialog', { name: '15번 자세히' })
    const lab = detail.getByRole('region', { name: '라벨', exact: true })
    await expect(lab.getByRole('img').first()).toBeVisible()
    const focusedBefore = await page.evaluate(() => document.activeElement?.outerHTML ?? '')

    await setLabels(other, false)
    await expect(lab).toContainText(OFF_NOTE, { timeout: 1_000 })
    await expect(detail).toBeVisible()
    await expect(lab.getByRole('button')).toHaveCount(0)
    expect(await page.evaluate(() => document.activeElement?.outerHTML ?? '')).toBe(focusedBefore)

    // 정산 자세히가 열린 채로
    await page.keyboard.press('Escape')
    await openSettlement(page, date, false)
    const packing = page.getByRole('region', { name: '포장 라벨' })
    await expect(packing).toContainText(OFF_NOTE)
    await setLabels(other, true)
    await expect(packing.getByRole('button', { name: '포장 라벨 출력' })).toBeVisible({ timeout: 1_000 })
    await expect(packing.getByRole('img', { name: /포장 라벨 1\/1 미리 보기/ })).toBeVisible()
    await expect(menuLink(page, '라벨')).toBeVisible({ timeout: 1_000 })
    await expect(page.getByRole('link', { name: PRINTER_STATUS })).toBeVisible({ timeout: 1_000 })
    await expect(page.getByText(OFF_NOTE)).toHaveCount(0)

    // 설정 화면·라벨 화면도 1초 안에
    await gotoSettings(page)
    await setLabels(other, false)
    await expect(page.getByText('라벨 기능: 꺼짐', { exact: true })).toBeVisible({ timeout: 1_000 })
  } finally {
    await ctx.close()
  }
})

test('AC-N4a-19: 다시 켜면 콘솔 보드 라벨 상태·Alt+P 창·알림 "출력 멈춤"·단축키 안내가 돌아온다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page)
  await dayWithWinners(page)
  await setLabels(page, false)
  await expect(page.getByRole('region', { name: '알림' })).not.toContainText('출력 멈춤', { timeout: 1_000 })
  await setLabels(page, true)
  await expect(page.getByRole('region', { name: '알림' })).toContainText('출력 멈춤', { timeout: 1_000 })
  await expect(boardItem(page, 15)).toContainText(/라벨 대기/, { timeout: 1_000 })
  await expect(page.getByText(/^단축키:/)).toContainText('Alt+P')
  await expect(menuLink(page, '라벨')).toBeVisible()
  await page.getByLabel('빠른 입력').fill('15번')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: '15번 자세히' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Alt+KeyP')
  await expect(page.getByRole('dialog', { name: '라벨 다시 출력' })).toBeVisible()
})
