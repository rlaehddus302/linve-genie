// CRM1 휴대폰 우선 모양 (test-e2e) — AC-CRM1-28. 크로미움 375·412·430px, WebKit 393px(@webkit = webkit-iphone 묶음) × 뿌리 글자 100%·150%.
// 구매자 목록(꼬리표·정렬·거르기)·자세히 "손님 기록"·메모·"모든 손님" 목록·자세히·설정 "손님 관리"에서
// 가로 스크롤 0, 글자 잘림 없음, 누르는 것 44px 이상, 정렬·거르기 단추는 줄을 넘겨 감싼다.
import { test, expect, type Locator, type Page } from '@playwright/test'
import { bigText, customerRows, expectBig, kstDate, loginNewSeller, payAll, phoneLayoutOk, smsSale, writeEvent, youtubeSale } from './support.ts'

const LONG = '다육이사랑하는엄마다육이사랑하는엄마다육' // 20글자
const MEASURE = '[data-crm1-measure]'

async function mark(...targets: Locator[]): Promise<void> {
  for (const t of targets) await t.evaluate((el) => el.setAttribute('data-crm1-measure', '1'))
}

/** 꼬리표 셋(단골·입금 늦음 주의·차단)·합친 묶음(메모 칸 둘)·긴 이름·200자 메모 */
async function layoutWorld(page: Page): Promise<{ date: string; buyer: string }> {
  const t = String(Date.now())
  const ch = `UC_L${t}`
  await youtubeSale(page, { date: kstDate(12), ch, nick: LONG, prices: [3_000], paid: false, firstNo: 10 })
  const date = kstDate(5)
  const s = await youtubeSale(page, { date, ch, nick: LONG, prices: [60_000, 60_000], paid: false, firstNo: 10 })
  const sms = await smsSale(page, { date, b: s.b, phone: `010-4${t.slice(-3)}-1234`, prices: [2_000], paid: false, firstNo: 20 })
  expect((await writeEvent(page, { type: 'buyer.merge', from: sms.buyer, into: s.buyer, reason: '같은 사람' }, { date, rehearsal: false })).status).toBeLessThan(300)
  await payAll(page, date, s.buyer)
  expect((await writeEvent(page, { type: 'host.blockBuyer', buyer: s.buyer, reason: '장난' }, { date, rehearsal: false })).status).toBeLessThan(300)
  await youtubeSale(page, { date, b: s.b, ch: `UC_M${t}`, nick: '보통손님', prices: [5_000], paid: true, firstNo: 30 })
  const memo = '가나다라마바사아자차카타파하🌵'.repeat(14).slice(0, 190)
  await page.goto(`/buyers?date=${date}&buyer=${encodeURIComponent(s.buyer)}`)
  const record = page.getByRole('region', { name: '손님 기록' })
  await record.getByRole('textbox').first().fill(memo)
  await record.getByRole('button', { name: /^메모 저장 — / }).first().click()
  await expect(record.getByRole('status').filter({ hasText: '메모를 저장했어요.' })).toBeVisible()
  return { date, buyer: s.buyer }
}

async function checkAll(page: Page, w: { date: string; buyer: string }, where: string, big: boolean): Promise<void> {
  // 구매자 목록
  await page.goto(`/buyers?date=${w.date}`)
  if (big) await expectBig(page)
  await expect(page.getByRole('group', { name: '거르기' })).toBeVisible()
  const row = page.getByRole('list', { name: '구매자' }).getByRole('listitem').filter({ hasText: '다육이사랑' })
  for (const word of ['단골', '입금 늦음 주의', '차단']) await expect(row.getByText(word, { exact: true })).toBeVisible()
  await mark(page.getByRole('group', { name: '보기' }), page.getByRole('group', { name: '정렬' }), page.getByRole('group', { name: '거르기' }), page.getByRole('list', { name: '구매자' }))
  // 정렬·거르기 단추는 감싸서 줄을 넘긴다 (가로 스크롤 없이)
  for (const g of ['정렬', '거르기']) {
    const wraps = await page.getByRole('group', { name: g }).evaluate((el) => getComputedStyle(el).flexWrap)
    expect(wraps, `${where} ${g} 감싸기`).toBe('wrap')
  }
  await phoneLayoutOk(page, `${where} 구매자 목록`, [MEASURE])
  // 구매자 자세히 "손님 기록"·메모
  await page.goto(`/buyers?date=${w.date}&buyer=${encodeURIComponent(w.buyer)}`)
  const record = page.getByRole('region', { name: '손님 기록' })
  await expect(record.getByRole('heading', { name: /^메모 · 문자/ })).toBeVisible()
  await mark(record)
  await phoneLayoutOk(page, `${where} 손님 기록 칸`, [MEASURE])
  // 모든 손님 목록·자세히
  await page.goto('/buyers?view=customers')
  await expect(customerRows(page)).toHaveCount(3)
  await mark(page.getByRole('region', { name: '모든 손님' }), page.getByRole('group', { name: '보기' }))
  await phoneLayoutOk(page, `${where} 모든 손님`, [MEASURE])
  await customerRows(page).filter({ hasText: '다육이사랑' }).getByRole('link').click()
  const detail = page.getByRole('region', { name: '손님 자세히' })
  await expect(detail.getByRole('region', { name: '날짜별 기록' }).getByRole('link')).toHaveCount(2)
  await mark(detail)
  await phoneLayoutOk(page, `${where} 손님 자세히`, [MEASURE])
  // 설정 "손님 관리"
  await page.goto('/settings')
  const settings = page.getByRole('region', { name: '손님 관리', exact: true })
  await expect(settings.getByLabel('단골 금액')).toBeVisible()
  await mark(settings)
  await phoneLayoutOk(page, `${where} 손님 관리`, [MEASURE])
}

for (const big of [false, true]) {
  test(`AC-CRM1-28 크로미움 375·412·430px 글자 ${big ? '150' : '100'}%: 가로 스크롤 0, 글자 잘림 없음, 누르는 것 44px 이상, 정렬·거르기 감쌈`, async ({ page }) => {
    test.setTimeout(240_000)
    await page.setViewportSize({ width: 375, height: 812 })
    await loginNewSeller(page)
    const w = await layoutWorld(page)
    if (big) await bigText(page)
    for (const width of [375, 412, 430]) {
      await page.setViewportSize({ width, height: 900 })
      await checkAll(page, w, `${String(width)}px ${big ? '150' : '100'}%`, big)
    }
  })

  test(`AC-CRM1-28 WebKit 393px 글자 ${big ? '150' : '100'}%: 가로 스크롤 0, 글자 잘림 없음, 누르는 것 44px 이상 @webkit`, async ({ page }) => {
    test.setTimeout(240_000)
    await loginNewSeller(page)
    const w = await layoutWorld(page)
    if (big) await bigText(page)
    await checkAll(page, w, `WebKit 393px ${big ? '150' : '100'}%`, big)
  })
}
