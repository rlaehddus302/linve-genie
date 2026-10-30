// KP1 방송 일정·공개 페이지·방송 알림 수 (test-e2e) — AC-KP1-20(일정 적기)·21(공개 페이지)·23(판매자에겐 수만).
// 기대 문장은 SPEC SCH-01~03·acceptance 따옴표 그대로. 공개 페이지는 로그인 없는 새 문맥(스크립트 없는 서버 HTML).
import { test, expect, type Page } from '@playwright/test'
import { apiUrl } from '../i3/support.ts'
import { PC, PHONE, PHONE_RULE, SCHEDULE_FULL, VIEWPORTS, buyerBrowser, loginNewSeller, noOverflow, postJson, DEV_WORDS } from './support.ts'

function scheduleSection(page: Page) {
  return page.getByRole('region', { name: '방송 일정', exact: true })
}
function alertSection(page: Page) {
  return page.getByRole('region', { name: '방송 알림', exact: true })
}

/** 오늘(KST)에서 days일 뒤 YYYY-MM-DD */
function kstAfter(days: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + days * 86_400_000))
}

async function addItemApi(page: Page, date: string, title: string): Promise<void> {
  const res = await postJson(page, '/api/schedule/items', { date, time: '20:00', title, intro: '' })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
}

async function scheduleView(page: Page): Promise<{ page: { enabled: boolean; url: string | null }; items: { id: string; title: string }[] }> {
  const res = await page.request.get('/api/schedule')
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as { page: { enabled: boolean; url: string | null }; items: { id: string; title: string }[] }
}

async function fill(page: Page, form: ReturnType<Page['getByRole']>, value: { date: string; time: string; title: string; intro?: string }): Promise<void> {
  await form.getByLabel('날짜').fill(value.date)
  await form.getByLabel('시작 시각').fill(value.time)
  await form.getByLabel('제목', { exact: true }).fill(value.title)
  if (value.intro !== undefined) await form.getByLabel(/^한 줄 소개/).fill(value.intro)
}

for (const { name, viewport } of VIEWPORTS) {
  test.describe(`일정 ${name}`, () => {
    test.use({ viewport })

    test(`AC-KP1-20 ${name}: 일정 적기 — 휴대폰 번호 모양·41자 제목은 칸 문장, 다가오는 일정 11번째는 "${SCHEDULE_FULL}"`, async ({ page }) => {
      test.setTimeout(150_000)
      await loginNewSeller(page)
      await page.goto('/settings')
      const section = scheduleSection(page)
      await expect(section).toBeVisible()
      const form = section.getByRole('form', { name: '새 일정 적기' })
      // 휴대폰 번호 모양 (R-1 문장)
      await fill(page, form, { date: kstAfter(3), time: '20:00', title: '토요 방송 010-1234-5678', intro: '' })
      await form.getByRole('button', { name: '일정 적기' }).click()
      await expect(form.getByText(PHONE_RULE)).toBeVisible()
      await expect(form.getByLabel('제목', { exact: true })).toHaveAttribute('aria-invalid', 'true')
      // 소개에 번호 모양도
      await fill(page, form, { date: kstAfter(3), time: '20:00', title: '토요 방송', intro: '문의 01012345678' })
      await form.getByRole('button', { name: '일정 적기' }).click()
      await expect(form.getByText(PHONE_RULE)).toBeVisible()
      // 41자 제목
      await fill(page, form, { date: kstAfter(3), time: '20:00', title: '가'.repeat(41), intro: '' })
      await form.getByRole('button', { name: '일정 적기' }).click()
      await expect(form.getByText('제목은 1~40자로 적어 주세요.')).toBeVisible()
      expect((await scheduleView(page)).items).toHaveLength(0)
      // 바르게 적으면 목록에
      await fill(page, form, { date: kstAfter(3), time: '20:00', title: '토요 다육이 방송', intro: '새로 들어온 하월시아' })
      await form.getByRole('button', { name: '일정 적기' }).click()
      const list = section.getByRole('list', { name: '다가오는 방송 목록' })
      await expect(list.getByRole('listitem')).toHaveCount(1)
      await expect(list).toContainText('토요 다육이 방송')
      await expect(list).toContainText('새로 들어온 하월시아')
      // 9개를 더 (API) → 10개
      for (let i = 0; i < 9; i++) await addItemApi(page, kstAfter(4 + i), `방송 ${String(i + 2)}`)
      await page.reload()
      await expect(scheduleSection(page).getByRole('list', { name: '다가오는 방송 목록' }).getByRole('listitem')).toHaveCount(10)
      // 11번째
      const form2 = scheduleSection(page).getByRole('form', { name: '새 일정 적기' })
      await fill(page, form2, { date: kstAfter(20), time: '19:30', title: '열한번째 방송', intro: '' })
      await form2.getByRole('button', { name: '일정 적기' }).click()
      await expect(scheduleSection(page).getByText(SCHEDULE_FULL).first()).toBeVisible()
      expect((await scheduleView(page)).items).toHaveLength(10)
      expect(await scheduleSection(page).innerText()).not.toMatch(DEV_WORDS)
      if (viewport.width === PHONE.width) await noOverflow(page, '설정 방송 일정 375px')
    })
  })
}

test.describe('AC-KP1-21 공개 페이지', () => {
  test('TE-KP1-001: 설정에서 켜면 보이는 공개 주소를 로그인 없는 휴대폰에서 열면 가게 이름·다가오는 일정·채널 주소만 보인다', async ({ page, browser }) => {
    test.setTimeout(150_000)
    await page.setViewportSize(PC)
    const seller = await loginNewSeller(page)
    await addItemApi(page, kstAfter(3), '토요 다육이 방송')
    await page.goto('/settings')
    const section = scheduleSection(page)
    await section.getByLabel('유튜브 채널 주소 (비워도 돼요)').fill('https://www.youtube.com/@dayuk')
    await section.getByRole('button', { name: '채널 주소 저장' }).click()
    await expect(section.getByText('채널 주소를 저장했어요.')).toBeVisible()
    await section.getByRole('checkbox', { name: /방송 일정 공개/ }).click()
    await expect(section).toContainText('공개 일정 페이지를 켰어요.')
    const url = /https?:\/\/\S+\/s\/[A-Za-z0-9_-]{43}/.exec(await section.innerText())?.[0]
    expect(url, '설정에 공개 주소').toBeDefined()
    const buyer = await buyerBrowser(browser, page, PHONE)
    try {
      const res = await buyer.page.goto(url!)
      expect(res?.status()).toBe(200)
      const body = buyer.page.locator('body')
      await expect(body).toContainText(seller.shopName)
      await expect(body).toContainText('토요 다육이 방송')
      await expect(body).toContainText('https://www.youtube.com/@dayuk')
      // 서버 HTML이어야 한다: 앱 화면(로그인·메뉴)이 아니다, 스크립트 없음
      await expect(buyer.page.getByLabel('아이디')).toHaveCount(0)
      expect(await buyer.page.locator('script').count()).toBe(0)
      expect(res?.headers()['referrer-policy']).toBe('no-referrer')
      await noOverflow(buyer.page, '공개 페이지 375px')
    } finally {
      await buyer.context.close()
    }
  })

  test('서버의 공개 페이지: noindex·no-referrer·no-store·스크립트 없음, 손님·판매 정보 없음 — 새 주소를 만들면 옛 주소 404, 끄면 404', async ({ page, request }) => {
    test.setTimeout(150_000)
    await page.setViewportSize(PHONE)
    const seller = await loginNewSeller(page)
    await addItemApi(page, kstAfter(3), '토요 다육이 방송')
    await page.goto('/settings')
    const section = scheduleSection(page)
    await section.getByRole('checkbox', { name: /방송 일정 공개/ }).click()
    await expect(section).toContainText('공개 일정 페이지를 켰어요.')
    const first = (await scheduleView(page)).page.url!
    const path1 = new URL(first).pathname
    expect(path1).toMatch(/^\/s\/[A-Za-z0-9_-]{43}$/)
    // 서버 주소로 바로 (로그인 없음)
    const res = await request.get(`${apiUrl()}${path1}`)
    expect(res.status()).toBe(200)
    const html = await res.text()
    expect(html).toContain(seller.shopName)
    expect(html).toContain('토요 다육이 방송')
    expect(html).not.toMatch(/<script/i)
    expect(html).toMatch(/<meta name="robots" content="noindex/)
    const h = res.headers()
    expect(h['referrer-policy']).toBe('no-referrer')
    expect(h['x-robots-tag']).toMatch(/noindex/)
    expect(h['cache-control']).toMatch(/no-store/)
    // 새 주소
    await section.getByRole('button', { name: '새 주소 만들기' }).click()
    await page.getByRole('dialog', { name: '새 주소 만들기' }).getByRole('button', { name: '새 주소 만들기' }).click()
    await expect(section).toContainText('새 주소를 만들었어요.')
    const second = (await scheduleView(page)).page.url!
    expect(second).not.toBe(first)
    expect((await request.get(`${apiUrl()}${path1}`)).status()).toBe(404)
    const path2 = new URL(second).pathname
    expect((await request.get(`${apiUrl()}${path2}`)).status()).toBe(200)
    // 끄면 404
    await section.getByRole('checkbox', { name: /방송 일정 공개/ }).click()
    await expect(section).toContainText('전에 알려 준 주소는 이제 열리지 않아요.')
    expect((await request.get(`${apiUrl()}${path2}`)).status()).toBe(404)
  })
})

test.describe('AC-KP1-23 방송 알림 수', () => {
  for (const { name, viewport } of VIEWPORTS) {
    test(`${name}: 설정 "방송 알림"엔 신청 기다림·받는 중·그만 받음 수만 — 손님이 공개 페이지에서 신청·그만 받기 하면 수가 바뀌고 번호·목록·내려받기·대신 넣기는 없다`, async ({ page, request }) => {
      test.setTimeout(150_000)
      await page.setViewportSize(viewport)
      await loginNewSeller(page)
      await page.goto('/settings')
      const section = scheduleSection(page)
      await section.getByRole('checkbox', { name: /방송 일정 공개/ }).click()
      await expect(section).toContainText('공개 일정 페이지를 켰어요.')
      const path = new URL((await scheduleView(page)).page.url!).pathname
      const appOrigin = new URL(page.url()).origin
      // 손님 둘이 신청, 하나는 그만 받기 (양식 보내기 — 브라우저가 보내는 Origin = 앱 주소)
      for (const phone of ['010-3333-1001', '010-3333-1002']) {
        const res = await request.post(`${apiUrl()}${path}/alert`, { form: { phone, agree: 'on' }, headers: { Origin: appOrigin }, maxRedirects: 0 })
        expect(res.status(), await res.text()).toBe(303)
      }
      const stop = await request.post(`${apiUrl()}${path}/stop`, { form: { phone: '010-3333-1002' }, headers: { Origin: appOrigin }, maxRedirects: 0 })
      expect(stop.status()).toBe(303)
      await page.reload()
      const alerts = alertSection(page)
      await expect(alerts).toBeVisible()
      const row = (label: string) => alerts.locator('div').filter({ has: page.getByText(label, { exact: true }) }).last()
      await expect(row('신청 기다림')).toContainText('1명')
      await expect(row('받는 중')).toContainText('0명')
      await expect(row('그만 받음')).toContainText('1명')
      const text = await alerts.innerText()
      expect(text).not.toMatch(/1001|1002|010/)
      expect(text).not.toMatch(DEV_WORDS)
      await expect(alerts.getByRole('button')).toHaveCount(0)
      await expect(alerts.getByRole('link')).toHaveCount(0)
      await expect(alerts.getByRole('textbox')).toHaveCount(0)
      if (viewport.width === PHONE.width) await noOverflow(page, '설정 방송 알림 375px')
    })
  }
})
