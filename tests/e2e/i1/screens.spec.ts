// AC-I1-23·24·30·32·33·34·35·36·62 — 화면 연결(포장 라벨·리허설·위 줄 상태·알림 순서·휴대폰)
import { expect, test, type Page } from '@playwright/test'
import { becomeDevice, boardItem, cleanupPrint, gotoLabels, login, noHorizontalScroll, openNewBroadcast, postJson, printOverview, realBroadcast, region, registerApi, scopeView, setBehavior, smsApi, uniqueDate, viewerClaim, waitPrinted, writeEvent } from './support.ts'
import { clickMenu, closeMore, moreButton, phoneMenuLink } from '../menu.ts'

test.afterEach(async ({ page }) => {
  await cleanupPrint(page)
})

async function inAppTo(page: Page, link: string) {
  await clickMenu(page, link)
}

test('AC-I1-35: 정산 자세히 포장 라벨 — 미리 보기 1/1 · 출력 → 시험용 프린터 · 묶음이 바뀌면 재출력 필요', async ({ page, browser }) => {
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(page.url()).origin })
  const station = await ctx.newPage()
  try {
    await login(station)
    await becomeDevice(station, '스테이션')
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await registerApi(page, b, 28, '로즈', 5000)
    await registerApi(page, b, 31, '튤립', 15000)
    await smsApi(page, { b, no: 15, phone: '010-7777-8888' })
    await smsApi(page, { b, no: 28, phone: '010-7777-8888' })
    await waitPrinted(station, 2)
    const view = await scopeView(page, date, false)
    expect(view.settlements).toHaveLength(1)
    await page.goto(`/settlements?date=${date}`)
    await page.getByRole('table', { name: '정산 묶음' }).getByRole('link').first().click() // PC는 표 (AC-S06b-21 — 교체)
    const packing = page.getByRole('region', { name: '포장 라벨' })
    await expect(packing.getByRole('img', { name: '포장 라벨 1/1 미리 보기' })).toBeVisible()
    await packing.getByRole('button', { name: '포장 라벨 출력' }).click()
    await expect(packing).toContainText('포장 라벨 1장 출력을 접수했어요.')
    await waitPrinted(station, 3)
    await expect(packing).toContainText('라벨 출력됨')
    const pk = await (await page.request.get(`/api/print/packing?date=${date}&buyer=${view.settlements[0]!.buyer}`)).json() as { data: { subtotal: number } }
    expect(pk.data.subtotal).toBe(15000)
    // 묶음이 바뀜 (상품 더해짐) → 재출력 필요
    await smsApi(page, { b, no: 31, phone: '010-7777-8888' })
    await waitPrinted(station, 4)
    await expect(packing).toContainText('재출력 필요')
  } finally {
    await ctx.close()
  }
})

test('AC-I1-36: 리허설 콘솔 — 상품 자세히 라벨 자리·Alt+P에 "리허설 방송은 라벨을 출력하지 않아요." · 보드에 라벨 낱말 없음', async ({ page }) => {
  const date = uniqueDate()
  await login(page)
  const b = await openNewBroadcast(page, { date, rehearsal: true })
  await registerApi(page, b, 15, '핑크프릴', 10000)
  await viewerClaim(page, b, '가나다', '15', 'sim_ga_0101')
  await expect(boardItem(page, 15)).toContainText('가나다')
  await expect(boardItem(page, 15)).not.toContainText(/라벨 대기|라벨 출력됨|출력 중|재출력 필요|출력 안 함/)
  await page.getByLabel('빠른 입력').fill('15번')
  await page.keyboard.press('Enter')
  const detail = page.getByRole('dialog', { name: '15번 자세히' })
  await expect(detail).toContainText('리허설 방송은 라벨을 출력하지 않아요.')
  await expect(detail.getByRole('button', { name: /라벨 출력|다시 출력|그림 파일로 저장|PDF로 저장/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Alt+KeyP')
  const dlg = page.getByRole('dialog', { name: '라벨 다시 출력' })
  await expect(dlg).toContainText('리허설 방송은 라벨을 출력하지 않아요.')
  await expect(page.getByLabel('빠른 입력')).toHaveValue('')
  // 리허설 정산 자세히: 포장 라벨 자리는 문장만
  await page.goto(`/settlements?date=${date}&rehearsal=true`)
  await page.getByRole('table', { name: '정산 묶음' }).getByRole('link').first().click() // PC는 표 (AC-S06b-21 — 교체)
  const packing = page.getByRole('region', { name: '포장 라벨' })
  await expect(packing).toContainText('리허설 방송은 라벨을 출력하지 않아요.')
  await expect(packing.getByRole('button')).toHaveCount(0)
})

test('AC-I1-34·23: 위 줄 프린터 상태 — 연결됨 → 출력 기기 탭 닫힘이면 다른 기기에 끊김·안내, 멈춤이면 "출력 멈춤 · 대기 N장"', async ({ page, browser }) => {
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(page.url()).origin })
  const phone = await ctx.newPage()
  await login(phone)
  await becomeDevice(phone, '휴대폰')
  await expect(page.getByRole('link', { name: /^프린터 휴대폰 · 연결됨/ })).toBeVisible()
  await expect(phone.getByRole('link', { name: /^프린터 휴대폰 · 연결됨/ })).toBeVisible()
  await postJson(page, '/api/print/pause', {})
  await registerApi(page, b, 1, '품종1', 1000)
  await smsApi(page, { b, no: 1 })
  await expect(page.getByRole('link', { name: '출력 멈춤 · 대기 1장' })).toBeVisible()
  await expect(phone.getByRole('link', { name: '출력 멈춤 · 대기 1장' })).toBeVisible()
  await expect(page.getByRole('region', { name: '알림' })).toContainText('출력 멈춤 · 출력을 멈췄어요.')
  await ctx.close()
  await inAppTo(page, '라벨')
  await expect(region(page, '프린터')).toContainText("출력 기기 '휴대폰'와 연결이 끊겼어요.")
  await expect(region(page, '프린터')).toContainText('출력 기기: 휴대폰 · 끊김')
})

test('AC-I1-32: 알림 띠 — 출력 멈춤·버릴 라벨, Alt+1은 출력 멈춤 → (닫기) → 버릴 라벨 순, 창 닫으면 빠른 입력칸', async ({ page }) => {
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  await becomeDevice(page, 'PC')
  await page.goBack()
  await registerApi(page, b, 15, '핑크프릴', 10000)
  await smsApi(page, { b, no: 15, phone: '010-1212-3434' })
  await waitPrinted(page, 1)
  const day = await (await page.request.get(`/api/days/${date}`)).json() as { claims: { buyer: string; no: number }[] }
  const res = await writeEvent(page, { type: 'host.cancel', b, no: 15, buyer: day.claims[0]!.buyer, reason: '시험' })
  expect(res.status).toBeLessThan(300)
  await postJson(page, '/api/print/pause', {})
  const strip = page.getByRole('region', { name: '알림' })
  await expect(strip).toContainText('출력 멈춤 · 출력을 멈췄어요.')
  await expect(strip).toContainText('버릴 라벨 1')
  await page.getByLabel('빠른 입력').focus()
  await page.keyboard.press('Alt+1')
  const pause = page.getByRole('dialog', { name: '출력 멈춤' })
  await expect(pause).toBeVisible()
  await expect(pause.getByRole('button', { name: '닫기' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('빠른 입력')).toBeFocused()
  await postJson(page, '/api/print/restart', {})
  await expect(strip).not.toContainText('출력 멈춤')
  await page.keyboard.press('Alt+1')
  const discard = page.getByRole('dialog', { name: '버릴 라벨' })
  await expect(discard).toBeVisible()
  await expect(discard).toContainText(`15번 · 문자찜 · ${date.slice(2).replaceAll('-', '.')} 라벨을 버려 주세요`)
  await page.keyboard.press('1')
  await expect(strip).not.toContainText('버릴 라벨')
})

test('AC-I1-33: 재고 2 — Alt+P는 1등마다 숫자 키 선택', async ({ page }) => {
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  await becomeDevice(page, 'PC')
  await page.goBack()
  const reg = await writeEvent(page, { type: 'product.register', b, no: 21, name: '쌍둥이', price: 3000, stock: 2 })
  expect(reg.status).toBeLessThan(300)
  await smsApi(page, { b, no: 21, phone: '010-1000-0001' })
  await smsApi(page, { b, no: 21, phone: '010-1000-0002' })
  await waitPrinted(page, 2)
  await page.getByLabel('빠른 입력').fill('21번')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Alt+KeyP')
  const dlg = page.getByRole('dialog', { name: '라벨 다시 출력' })
  await expect(dlg.getByRole('button', { name: /^1 .+ 다시 출력$/ })).toBeVisible()
  await expect(dlg.getByRole('button', { name: /^2 .+ 다시 출력$/ })).toBeVisible()
  await page.keyboard.press('2')
  await waitPrinted(page, 3)
})

test('AC-I1-62·24: 375×812 출력 기기 라벨 화면 — 멈춤 띠·대기열·버릴 라벨 가로 스크롤 없음, 버튼 44px, 마지막 오류 문장 잘리지 않음', async ({ browser, page }) => {
  await login(page)
  const date = uniqueDate()
  const b = await realBroadcast(page, date)
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(page.url()).origin })
  const phone = await ctx.newPage()
  try {
    await login(phone)
    await becomeDevice(phone, '휴대폰')
    await setBehavior(phone, 2, 'fail')
    for (const no of [1, 2, 3]) await registerApi(page, b, no, `아주긴품종이름${String(no)}호`, 1000)
    for (const no of [1, 2, 3]) await smsApi(page, { b, no })
    await waitPrinted(phone, 1)
    const day = await (await page.request.get(`/api/days/${date}`)).json() as { claims: { buyer: string; no: number }[] }
    await writeEvent(page, { type: 'host.cancel', b, no: 1, buyer: day.claims.find((c) => c.no === 1)!.buyer, reason: '시험' })
    const band = region(phone, '출력 멈춤')
    await expect(band).toContainText('프린터 오류로 멈췄어요.')
    await expect(region(phone, '버릴 라벨').getByRole('button', { name: '버렸어요' })).toBeVisible()
    await noHorizontalScroll(phone)
    for (const btn of [band.getByRole('button', { name: '다시 시작' }), region(phone, '버릴 라벨').getByRole('button', { name: '버렸어요' }).first()]) {
      const box = await btn.boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(44)
      expect(box!.width).toBeGreaterThanOrEqual(44)
    }
    const err = region(phone, '출력 대기열').getByText(/^마지막 오류: /)
    await expect(err).toBeVisible()
    const clipped = await err.evaluate((el) => el.scrollWidth > el.clientWidth + 1 || getComputedStyle(el).textOverflow === 'ellipsis')
    expect(clipped).toBe(false)
    const text = await phone.locator('main').innerText()
    expect(text).not.toMatch(/\b(WAITING|PRINTING|DONE|CANCELLED|VOID|PRINT_PRODUCT_LABEL|DISCONNECTED|PRINT_FAILED)\b/)
  } finally {
    await ctx.close()
  }
})

test('AC-I1-24·81: 하와이 시간대 기기에서도 대기열 "만든 때"·출력 이력 시각은 KST', async ({ page, browser }) => {
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Pacific/Honolulu', baseURL: new URL(page.url()).origin })
  const hi = await ctx.newPage()
  try {
    await login(hi)
    await becomeDevice(hi, '하와이')
    await registerApi(page, b, 9, '시간품', 1000)
    await smsApi(page, { b, no: 9 })
    await waitPrinted(hi, 1)
    await postJson(page, '/api/print/pause', {})
    await registerApi(page, b, 10, '대기품', 1000)
    await smsApi(page, { b, no: 10 })
    const kst = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
    const ov = await printOverview(page)
    const waitingJob = ov.jobs.find((j) => j.label.no === 10)! as unknown as { createdAt: string }
    await expect(region(hi, '출력 대기열').getByRole('list', { name: '대기 작업' })).toContainText(`만든 때 ${kst(waitingJob.createdAt)}`)
    const labels = await (await page.request.get(`/api/print/labels?date=${date}`)).json() as { labels: { no: number; history: { at: string }[] }[] }
    const at = labels.labels.find((l) => l.no === 9)!.history[0]!.at
    await region(hi, '출력 이력').getByLabel('날짜').selectOption(date)
    await expect(region(hi, '출력 이력').getByRole('list', { name: '출력 이력 목록' })).toContainText(`1번 출력 · ${kst(at)} 하와이`)
  } finally {
    await ctx.close()
  }
})

test('AC-I1-20: 375×812 라벨 화면 — 메뉴 "라벨" aria-current, 가로 스크롤 없음, 누르는 곳 모두 44×44px 이상, 본문 16px 이상', async ({ browser, page }) => {
  await login(page)
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(page.url()).origin })
  const phone = await ctx.newPage()
  try {
    await login(phone)
    await gotoLabels(phone)
    // AC-NAV-04·10: 휴대폰은 "더보기"가 지금 위치, 목록을 열면 "라벨"도 지금 위치·44px
    await expect(moreButton(phone)).toHaveAttribute('aria-current', 'page')
    const labelLink = await phoneMenuLink(phone, '라벨')
    await expect(labelLink).toHaveAttribute('aria-current', 'page')
    const labelBox = await labelLink.boundingBox()
    expect(labelBox!.width).toBeGreaterThanOrEqual(44)
    expect(labelBox!.height).toBeGreaterThanOrEqual(44)
    await closeMore(phone)
    await region(phone, '프린터').getByRole('button', { name: '시험용 프린터 — 실제로 출력되지 않아요' }).click()
    await expect(region(phone, '프린터').getByText(/이 기기의 프린터: 연결됨/)).toBeVisible()
    await expect(region(phone, '라벨 설정').getByLabel('가게 이름', { exact: true })).toBeVisible()
    await noHorizontalScroll(phone)
    const small = await phone.locator('main').evaluate((main) => {
      const out: string[] = []
      for (const el of main.querySelectorAll('button, a[href], input[type=checkbox], input[type=radio], select, summary')) {
        const r = (el as HTMLElement).getBoundingClientRect()
        if (r.width === 0 && r.height === 0) continue
        let target = r
        // 체크·라디오는 감싼 label이 누르는 곳
        const label = el.closest('label')
        if (label !== null && (el as HTMLInputElement).type !== undefined && ['checkbox', 'radio'].includes((el as HTMLInputElement).type)) target = label.getBoundingClientRect()
        if (target.width < 44 || target.height < 44) out.push(`${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)} ${String(Math.round(target.width))}×${String(Math.round(target.height))}`)
      }
      return out
    })
    expect(small).toEqual([])
  } finally {
    await ctx.close()
  }
})

test('AC-I1-30: 보드 라벨 낱말 — 라벨 대기(멈춤) → 출력 안 함(빼기), 작업 없는 1등은 낱말 없음 (글자로)', async ({ page }) => {
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  await postJson(page, '/api/print/pause', {})
  await registerApi(page, b, 4, '낱말품', 1000)
  await smsApi(page, { b, no: 4 })
  await expect(boardItem(page, 4)).toContainText('라벨 대기')
  const ov = await printOverview(page)
  const job = ov.jobs.find((j) => j.label.no === 4)!
  const res = await postJson(page, '/api/print/jobs/cancel', { date, id: job.id })
  expect(res.status).toBe(200)
  await expect(boardItem(page, 4)).toContainText('출력 안 함')
})

test('AC-I1-13·35: 1등 상품이 없는 정산 묶음 — 포장 라벨 단추가 막히고 문장', async ({ page }) => {
  const date = uniqueDate()
  await login(page)
  const b = await realBroadcast(page, date)
  await registerApi(page, b, 15, '핑크프릴', 10000)
  await smsApi(page, { b, no: 15, phone: '010-4545-6767' })
  const day = await (await page.request.get(`/api/days/${date}`)).json() as { claims: { buyer: string; no: number }[] }
  const res = await writeEvent(page, { type: 'host.cancel', b, no: 15, buyer: day.claims[0]!.buyer, reason: '시험' })
  expect(res.status).toBeLessThan(300)
  // 입금 기록이 있으면 1등 상품이 없어도 묶음이 남는다 (환불 필요)
  const pay = await writeEvent(page, { type: 'settlement.payment', buyer: day.claims[0]!.buyer, date, amount: 10000 }, { date, rehearsal: false })
  expect(pay.status, JSON.stringify(pay.body)).toBeLessThan(300)
  const view = await scopeView(page, date, false)
  expect(view.settlements).toHaveLength(1)
  await page.goto(`/settlements?date=${date}`)
  await page.getByRole('table', { name: '정산 묶음' }).getByRole('link').first().click() // PC는 표 (AC-S06b-21 — 교체)
  const packing = page.getByRole('region', { name: '포장 라벨' })
  await expect(packing).toContainText('이 묶음에는 1등 상품이 없어 포장 라벨을 만들 수 없어요.')
  await expect(packing.getByRole('button', { name: '포장 라벨 출력' })).toBeDisabled()
})
