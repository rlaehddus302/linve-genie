// N4a 흐름 깨뜨리기 — 실시간 끊김 뒤 다시 이어짐, 바꾼 기록 20줄, 열린 창(Alt+P·출력 멈춤)이 열린 채 꺼짐, 오래된 정산 화면의 포장 라벨·다시 출력 거절
import { expect, test, type Page } from '@playwright/test'
import { becomeDevice, boardItem, cleanupN4a, gotoSettings, labelSection, labelSettings, LABEL_CONTROL, login, OFF_NOTE, OFF_REFUSAL, postJson, printOverview, realBroadcast, registerApi, setLabels, smsApi, uniqueDate, waitPrinted } from './support.ts'

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await page.context().setOffline(false)
  await cleanupN4a(page)
})

function menuLink(page: Page, name: string) {
  return page.getByRole('navigation', { name: '메뉴' }).getByRole('link', { name, exact: true })
}

test('NFR-01·AC-N4a-18: 실시간 연결이 끊긴 사이 다른 기기가 끄면, 다시 이어진 뒤 이 화면도 꺼진 상태가 된다', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  await registerApi(page, b, 15, '핑크프릴', 10000)
  await smsApi(page, { b, no: 15, phone: '010-1818-1818' })
  await expect(boardItem(page, 15)).toContainText(/라벨 대기|라벨 출력됨|출력 중/)
  await expect(menuLink(page, '라벨')).toBeVisible()
  const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(page.url()).origin })
  const other = await ctx.newPage()
  try {
    await login(other)
    await page.context().setOffline(true)
    await setLabels(other, false)
    await page.context().setOffline(false)
    await expect(menuLink(page, '라벨')).toHaveCount(0, { timeout: 15_000 })
    await expect(boardItem(page, 15)).not.toContainText(/라벨|출력/)
    await expect(page.getByRole('button', { name: LABEL_CONTROL })).toHaveCount(0)
  } finally {
    await ctx.close()
  }
})

test('AC-N4a-12: 바꾼 기록은 최근 20줄 — 화면을 연 채 다른 기기가 여러 번 바꿔도 20줄을 넘지 않고 새것 먼저', async ({ page }) => {
  await login(page)
  // 기록을 20줄 이상으로
  for (let i = 0; i < 22; i += 1) await setLabels(page, i % 2 === 0 ? false : true)
  await setLabels(page, true)
  await gotoSettings(page)
  const items = labelSection(page).getByRole('list', { name: '바꾼 기록' }).getByRole('listitem')
  await expect(items).toHaveCount(20)
  for (let i = 0; i < 5; i += 1) await setLabels(page, i % 2 === 0 ? false : true)
  await expect(labelSection(page).getByText('라벨 기능: 꺼짐', { exact: true })).toBeVisible()
  await expect(items.first()).toContainText('라벨 끔')
  await expect(items).toHaveCount(20)
  const api = await labelSettings(page)
  expect(api.history).toHaveLength(20)
  const shown = await items.allTextContents()
  expect(shown.map((t) => t.includes('라벨 켬'))).toEqual(api.history.map((h) => h.enabled))
})

test('AC-N4a-14·18: Alt+P 창이 열린 채 다른 기기가 끄면 창 안은 안내로 — 출력 버튼이 남지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  await registerApi(page, b, 15, '핑크프릴', 10000)
  await smsApi(page, { b, no: 15, phone: '010-1919-1919' })
  await page.getByLabel('빠른 입력').fill('15번')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: '15번 자세히' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Alt+KeyP')
  const dlg = page.getByRole('dialog', { name: '라벨 다시 출력' })
  await expect(dlg).toBeVisible()
  await setLabels(page, false)
  await expect(dlg.getByText(OFF_NOTE).or(page.getByRole('status').filter({ hasText: OFF_NOTE }))).toBeVisible({ timeout: 1_000 })
  await expect(page.getByRole('button', { name: LABEL_CONTROL })).toHaveCount(0)
  await expect(page.getByRole('dialog').getByRole('button', { name: /^\d?\s*(라벨 출력|다시 출력|1등)/ })).toHaveCount(0)
})

test('AC-N4a-14·18: 알림 "출력 멈춤" 창이 열린 채 꺼지면 창 안은 안내로 — "다시 시작"이 남지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const date = uniqueDate()
  await login(page)
  await realBroadcast(page, date)
  await postJson(page, '/api/print/pause', {})
  await expect(page.getByRole('region', { name: '알림' })).toContainText('출력 멈춤')
  await page.getByLabel('빠른 입력').focus()
  await page.keyboard.press('Alt+1')
  const dlg = page.getByRole('dialog', { name: '출력 멈춤' })
  await expect(dlg.getByRole('button', { name: /다시 시작/ })).toBeVisible()
  await setLabels(page, false)
  await expect(dlg.getByRole('button', { name: /다시 시작|출력 시작|다시 연결/ })).toHaveCount(0, { timeout: 1_000 })
  await expect(page.getByRole('region', { name: '알림' })).not.toContainText('출력 멈춤')
})

test('AC-N4a-20: 오래된 정산 자세히의 "포장 라벨 출력" → 거절 문장·포장 라벨 자리는 안내로, 다시 보내지 않는다', async ({ page }) => {
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  await registerApi(page, b, 15, '핑크프릴', 10000)
  await smsApi(page, { b, no: 15, phone: '010-2020-2020' })
  await page.route('**/api/stream**', () => { /* 응답하지 않는다 — 오래된 화면 */ })
  await page.goto(`/settlements?date=${date}`)
  await page.getByRole('table', { name: '정산 묶음', exact: true }).getByRole('link').first().click()
  const packing = page.getByRole('region', { name: '포장 라벨' })
  const btn = packing.getByRole('button', { name: '포장 라벨 출력' })
  await expect(btn).toBeVisible()
  await setLabels(page, false)
  let posts = 0
  page.on('request', (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/print/packing') posts += 1 })
  await btn.click()
  await expect(page.getByRole('alert').filter({ hasText: OFF_REFUSAL })).toBeVisible()
  await expect(packing).toContainText(OFF_NOTE)
  await expect(packing.getByRole('button')).toHaveCount(0)
  expect(posts).toBe(1)
  expect((await printOverview(page)).jobs.filter((j) => j.kind === 'packing' && j.date === date)).toHaveLength(0)
})

test('AC-N4a-20: 오래된 상품 자세히의 "다시 출력" → 거절 문장, 작업이 생기지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  await becomeDevice(page, 'PC')
  await registerApi(page, b, 15, '핑크프릴', 10000)
  await smsApi(page, { b, no: 15, phone: '010-2121-2121' })
  await waitPrinted(page, 1)
  await page.route('**/api/stream**', () => { /* 오래된 화면 */ })
  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await boardItem(page, 15).click()
  const lab = page.getByRole('dialog', { name: '15번 자세히' }).getByRole('region', { name: '라벨', exact: true })
  const re = lab.getByRole('button', { name: '다시 출력' })
  await expect(re).toBeVisible()
  await setLabels(page, false)
  const jobsBefore = (await printOverview(page)).jobs.length
  await re.click()
  await expect(page.getByRole('alert').filter({ hasText: OFF_REFUSAL })).toBeVisible()
  await expect(lab).toContainText(OFF_NOTE)
  expect((await printOverview(page)).jobs.length).toBe(jobsBefore)
})

test('AC-N4a-02·18: 다른 기기에서 끔·켬을 빠르게 여러 번(같은 판) — 열린 화면은 마지막 값으로 맞춰진다', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  await registerApi(page, b, 15, '핑크프릴', 10000)
  await smsApi(page, { b, no: 15, phone: '010-2222-1515' })
  await expect(menuLink(page, '라벨')).toBeVisible()
  const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(page.url()).origin })
  const other = await ctx.newPage()
  try {
    await login(other)
    await gotoSettings(other)
    for (const final of [false, true]) {
      const seq = final ? [false, true, false, true, false, true] : [false, true, false, true, false]
      await Promise.all(seq.map((v, i) => new Promise((r) => setTimeout(r, i * 15)).then(() => setLabels(other, v))))
      // 동시에 보냈으니 서버의 마지막 값을 기준으로
      const now = (await labelSettings(other)).enabled
      if (now) {
        await expect(menuLink(page, '라벨')).toBeVisible({ timeout: 1_500 })
        await expect(boardItem(page, 15)).toContainText(/라벨 대기|라벨 출력됨|출력 중/)
        await expect(labelSection(other).getByText('라벨 기능: 켜짐', { exact: true })).toBeVisible({ timeout: 1_500 })
      } else {
        await expect(menuLink(page, '라벨')).toHaveCount(0, { timeout: 1_500 })
        await expect(boardItem(page, 15)).not.toContainText(/라벨|출력/)
        await expect(labelSection(other).getByText('라벨 기능: 꺼짐', { exact: true })).toBeVisible({ timeout: 1_500 })
      }
      const shown = await labelSection(other).getByRole('list', { name: '바꾼 기록' }).getByRole('listitem').allTextContents()
      const api = await labelSettings(other)
      expect(shown.map((t) => t.includes('라벨 켬'))).toEqual(api.history.map((h) => h.enabled))
    }
  } finally {
    await ctx.close()
  }
})

test('AC-N4a-18: 출력 개요를 불러오지 못하면 라벨 조작을 숨기고 라벨 화면은 서버 문장·"다시 시도" — 다시 시도로 회복', async ({ page }) => {
  await login(page)
  // 화면은 실패한 조회를 스스로 다시 받는다(실시간 연결이 열릴 때·잠시 뒤). 시험이 "이제 성공"으로 바꾼 뒤 누르기 전에 그 자동 조회가 먼저 성공하면
  // 버튼이 사라져 누를 수 없다(부하에서 실제로 났다). 그래서 성공은 "다시 시도"를 누른 뒤에 나간 조회에만 준다 — 누를 때 그 뒤 조회에 표시를 붙인다.
  await page.addInitScript(() => {
    const w = window as unknown as { __retryClicked?: boolean }
    document.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target.closest('main button') : null
      if (target?.textContent?.trim() === '다시 시도') w.__retryClicked = true
    }, true)
    const original = window.fetch.bind(window)
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      if (w.__retryClicked !== true) return original(input, init)
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
      headers.set('x-e2e-after-retry', '1')
      return original(input, { ...init, headers })
    }
  })
  await page.route(/\/api\/print(\?.*)?$/, async (route) => {
    const fail = route.request().headers()['x-e2e-after-retry'] !== '1'
    if (fail && route.request().method() === 'GET') {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: '잠시 연결이 불안정해요. 다시 해 주세요.' } }) })
      return
    }
    await route.continue()
  })
  await page.goto('/labels')
  await expect(page.getByRole('heading', { name: '라벨', level: 1 })).toBeVisible()
  const retry = page.getByRole('main').getByRole('button', { name: '다시 시도' })
  await expect(retry).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('main')).toContainText('잠시 연결이 불안정해요. 다시 해 주세요.')
  await expect(page.getByRole('button', { name: LABEL_CONTROL })).toHaveCount(0)
  await expect(menuLink(page, '라벨')).toHaveCount(0)
  await retry.click()
  await expect(page.getByRole('region', { name: '프린터' })).toBeVisible()
  await expect(menuLink(page, '라벨')).toBeVisible()
})

test('AC-N4a-18·19: 끈 동안 1등이 된 상품의 자세히 창을 연 채 켜면 1초 안에 "라벨 출력"이 나타나고 눌러 출력된다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  await becomeDevice(page, 'PC')
  await page.goBack()
  await expect(page.getByLabel('빠른 입력')).toBeVisible()
  await setLabels(page, false)
  await registerApi(page, b, 9, '은행잎', 9000)
  await smsApi(page, { b, no: 9, phone: '010-0909-0909' })
  await boardItem(page, 9).click()
  const lab = page.getByRole('dialog', { name: '9번 자세히' }).getByRole('region', { name: '라벨', exact: true })
  await expect(lab).toContainText(OFF_NOTE)
  await setLabels(page, true)
  const print = lab.getByRole('button', { name: '라벨 출력' })
  await expect(print).toBeVisible({ timeout: 1_000 })
  await expect(lab).not.toContainText(OFF_NOTE)
  // 저절로 나오지 않는다
  expect((await printOverview(page)).jobs.filter((j) => j.date === date)).toHaveLength(0)
  await print.click()
  await waitPrinted(page, 1)
  await expect(lab).toContainText('라벨 출력됨')
})
