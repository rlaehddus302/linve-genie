// 두 기기·실시간 (AC-S06-40), 휴대폰 화면 공통 (AC-S06-02), 개인정보·말 (AC-S06-80·81) — test-e2e.
import { test, expect, type Browser, type Page } from '@playwright/test'
import {
  boardItem, login, noHorizontalScroll, openNewBroadcast, openSms, registerApi, scopeView, smsApi, smsField, uniqueDate, viewerClaim, writeEvent,
} from './support.ts'

async function phone(browser: Browser): Promise<Page> {
  const baseURL = test.info().project.use.baseURL!
  const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', hasTouch: true, isMobile: true })
  const page = await context.newPage()
  await login(page)
  return page
}

/** 375px 공통 (AC-S06-02): 가로 스크롤 없음, 보이는 본문 글자 16px 이상, 보이는 누르는 곳 44×44 이상, 칸마다 이름 */
async function mobileChecks(page: Page, where: string): Promise<void> {
  await noHorizontalScroll(page)
  const problems = await page.evaluate(() => {
    const out: string[] = []
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
    }
    for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button]')) {
      if (!visible(el) || (el as HTMLButtonElement).disabled) continue
      const r = el.getBoundingClientRect()
      if (r.width < 44 || r.height < 44) out.push(`작음 ${el.tagName} "${(el.textContent ?? '').trim().slice(0, 20) || el.getAttribute('aria-label') || el.id}" ${String(Math.round(r.width))}×${String(Math.round(r.height))}`)
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
        const id = el.id
        const labelled = el.getAttribute('aria-label') !== null || el.getAttribute('aria-labelledby') !== null || (id !== '' && document.querySelector(`label[for="${id}"]`) !== null) || el.closest('label') !== null
        if (!labelled) out.push(`이름 없음 ${el.tagName}#${id}`)
      }
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = (node.textContent ?? '').trim()
      const parent = node.parentElement
      if (text === '' || parent === null || !visible(parent)) continue
      const size = parseFloat(getComputedStyle(parent).fontSize)
      if (size < 16) out.push(`글자 ${String(size)}px "${text.slice(0, 20)}"`)
    }
    return out
  })
  expect(problems, where).toEqual([])
}

test.describe('두 기기', () => {
  test('AC-S06-40: 휴대폰 문자찜 → PC 보드 1초, PC 입금 → 휴대폰 정산 1초 (각 5번)', async ({ page, browser }) => {
    test.setTimeout(180_000)
    await login(page)
    const date = uniqueDate()
    const title = `두기기${String(Math.floor(Math.random() * 1e5))}`
    const b = await openNewBroadcast(page, { date, rehearsal: true, title })
    for (let no = 1; no <= 5; no++) await registerApi(page, b, no, `상품${String(no)}`, 10000)
    await expect(boardItem(page, 5)).toBeVisible()
    const mobile = await phone(browser)
    await openSms(mobile, title)
    for (let no = 1; no <= 5; no++) {
      await smsField(mobile, '번호').fill(String(no))
      await smsField(mobile, '메모').fill(`손님${String(no)}`)
      const sent = mobile.waitForResponse((r) => r.url().includes('/api/events') && r.request().method() === 'POST' && r.ok())
      await mobile.getByRole('button', { name: `${String(no)}번에 문자찜 넣기` }).click()
      await sent
      await expect(boardItem(page, no)).toContainText(`문자찜(손님${String(no)})`, { timeout: 1000 })
      // 휴대폰도 보내기를 마칠 때까지(칸을 비우고 결과 카드) 기다린 뒤 다음 번호를 적는다. 휴대폰은 응답 뒤 자기 화면을 그 기록까지
      // 따라잡고서야 칸을 비우는데(최대 3초), 부하에서 그보다 먼저 다음 번호를 적으면 늦게 온 비우기가 적은 글을 지워
      // "N번에 문자찜 넣기" 단추가 사라지고 시험이 끝없이 기다린다
      await expect(smsField(mobile, '번호')).toHaveValue('')
      await expect(mobile.getByRole('region', { name: '넣은 결과' })).toContainText(`${String(no)}번`)
    }
    // PC 입금 → 휴대폰 정산 목록
    await mobile.goto(`/settlements?date=${date}&rehearsal=true`)
    const list = mobile.getByRole('list', { name: '정산 묶음' })
    await expect(list.getByRole('link')).toHaveCount(5)
    const view = await scopeView(page, date, true)
    for (const s of view.settlements) {
      const res = await writeEvent(page, { type: 'settlement.payment', buyer: s.buyer, date, amount: s.total }, { date, rehearsal: true })
      expect(res.status).toBeLessThan(300)
      const name = view.buyers.find((x) => x.id === s.buyer)!.display
      await expect(list.getByRole('link', { name: new RegExp(name.replace(/[()]/g, '\\$&')) })).toContainText('입금 완료', { timeout: 1000 })
    }
    await mobileChecks(mobile, '정산 목록 375')
    await mobile.context().close()
  })
})

test.describe('휴대폰 375', () => {
  test('AC-S06-02: 문자찜 입력·구매자 목록·자세히·합치기 창·정산 목록·자세히·입력 창 — 가로 스크롤·글자·누르는 곳·이름', async ({ browser }) => {
    test.setTimeout(180_000)
    const mobile = await phone(browser)
    const date = uniqueDate()
    const title = `폭${String(Math.floor(Math.random() * 1e5))}`
    const b = await openNewBroadcast(mobile, { date, rehearsal: true, title })
    await registerApi(mobile, b, 15, '아주아주긴품종이름핑크프릴라넌큘러스', 1234567)
    await viewerClaim(mobile, b, '아주긴닉네임을쓰는시청자님안녕하세요반가워요', '15', 'sim_long_9191')
    await smsApi(mobile, { b, no: 15, memo: '김씨', phone: '010-1212-3434' })
    await openSms(mobile, title)
    await smsField(mobile, '번호').fill('15')
    await mobileChecks(mobile, '문자찜 입력')
    for (const name of ['번호'] as const) await expect(smsField(mobile, name)).toHaveAttribute('inputmode', 'numeric')
    await expect(smsField(mobile, '받은 시각')).toHaveAttribute('inputmode', /numeric|decimal/)
    // 받은 시각 칸에 "오후 8:01"을 칠 수 있다(글자가 막히지 않는다)
    await smsField(mobile, '받은 시각').pressSequentially('오후 8:01')
    await expect(smsField(mobile, '받은 시각')).toHaveValue('오후 8:01')
    await mobile.goto(`/buyers?date=${date}&rehearsal=true`)
    await expect(mobile.getByRole('list', { name: '구매자' }).getByRole('link')).toHaveCount(1)
    await mobileChecks(mobile, '구매자 목록')
    await mobile.getByRole('list', { name: '구매자' }).getByRole('link').first().click()
    await expect(mobile.getByRole('region', { name: '구매자 자세히' })).toBeVisible()
    await mobileChecks(mobile, '구매자 자세히')
    await mobile.getByRole('button', { name: '다른 구매자와 합치기' }).click()
    await mobile.getByLabel('합칠 구매자 찾기').fill('김씨')
    await mobile.getByRole('list', { name: '합칠 구매자' }).getByRole('button').first().click()
    await expect(mobile.getByRole('dialog', { name: '구매자 합치기' })).toBeVisible()
    await mobileChecks(mobile, '합치기 창')
    await mobile.getByRole('dialog', { name: '구매자 합치기' }).getByRole('button', { name: '닫기' }).click()
    await mobile.goto(`/settlements?date=${date}&rehearsal=true`)
    await expect(mobile.getByRole('list', { name: '정산 묶음' }).getByRole('link')).toHaveCount(1)
    await mobileChecks(mobile, '정산 목록')
    await mobile.getByRole('list', { name: '정산 묶음' }).getByRole('link').first().click()
    await mobileChecks(mobile, '정산 자세히')
    await mobile.getByRole('button', { name: '입금 적기' }).click()
    await expect(mobile.getByRole('dialog', { name: '입금 적기' }).getByLabel('입금 금액')).toHaveAttribute('inputmode', 'numeric')
    await mobileChecks(mobile, '입금 창')
    await mobile.context().close()
  })
})

test.describe('개인정보·말', () => {
  test('AC-S06-81: 악성 메모·닉네임은 글자로만 보이고, 전화번호는 어디에도 뒤 4자리로만', async ({ page }) => {
    await login(page)
    const date = uniqueDate()
    const title = `악성${String(Math.floor(Math.random() * 1e5))}`
    const b = await openNewBroadcast(page, { date, rehearsal: true, title })
    await registerApi(page, b, 15, '핑크프릴', 10000)
    const evil = '<img src=x onerror=__xss=1>'
    await viewerClaim(page, b, evil, '15', 'sim_evil_0666')
    await smsApi(page, { b, no: 15, memo: '<script>window.__xss=2</script>', phone: '010-9876-5432' })
    for (const path of [`/buyers?date=${date}&rehearsal=true`, `/settlements?date=${date}&rehearsal=true`]) {
      await page.goto(path)
      await expect(page.locator('main')).toContainText('<img src=x')
      expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined()
      const text = await page.locator('body').innerText()
      expect(text).not.toMatch(/9876|01098765432/)
    }
    await openSms(page, title)
    await expect(page.getByRole('region', { name: '최근 넣은 문자찜' })).toContainText('<script>')
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined()
  })

  test('AC-S06-80 (NFR-07): 브라우저 시간대가 KST가 아니어도 기록한 때·받은 시각은 KST', async ({ browser }) => {
    const baseURL = test.info().project.use.baseURL!
    const context = await browser.newContext({ baseURL, locale: 'ko-KR', timezoneId: 'Pacific/Honolulu' })
    const page = await context.newPage()
    await login(page)
    const date = uniqueDate()
    const title = `시간대${String(Math.floor(Math.random() * 1e5))}`
    const b = await openNewBroadcast(page, { date, rehearsal: true, title })
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await smsApi(page, { b, no: 15, memo: '하와이' })
    const view = await scopeView(page, date, true)
    const buyer = view.buyers[0]!.id
    expect((await writeEvent(page, { type: 'settlement.payment', buyer, date, amount: 14000 }, { date, rehearsal: true })).status).toBeLessThan(300)
    const after = await scopeView(page, date, true)
    const at = (after.settlements[0]!.records[0] as unknown as { at: string }).at
    const kst = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at))
    const part = (t: string) => kst.find((x) => x.type === t)!.value
    await page.goto(`/settlements?date=${date}&rehearsal=true&buyer=${encodeURIComponent(buyer)}`)
    await expect(page.getByRole('region', { name: '정산 기록' })).toContainText(`기록한 때 ${String(Number(part('month')))}/${String(Number(part('day')))} ${part('hour')}:${part('minute')}`)
    // 문자찜: 받은 시각을 비우면 서버가 KST 도착 시각(초까지)을 적는다 — 최근 목록에 그대로
    const hist = await (await page.request.get(`/api/days/${date}/history?rehearsal=true`)).json() as { events: { type: string; fields: Record<string, unknown> }[] }
    const received = String(hist.events.find((e) => e.type === 'sms')!.fields['received'])
    expect(received).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    await openSms(page, title)
    await expect(page.getByRole('region', { name: '최근 넣은 문자찜' })).toContainText(received)
    const text = await page.locator('main').innerText()
    expect(text).not.toMatch(/PENDING|CONFIRMED|sms:|undefined|NaN|null/)
    await context.close()
  })
})
