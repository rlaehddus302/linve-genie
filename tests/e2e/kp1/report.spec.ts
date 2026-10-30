// KP1 방송 리포트 화면 (test-e2e) — AC-KP1-19 (SPEC RPT-01·02·03·05·07·08).
// 순서 돈 → 손님 → 비교 → 몰린 상품 → 품종(10개 + 더 보기) → 시간대, 375px 가로 넘침 없음, 손님 이름·연락처 없음,
// 앞선 방송이 없으면 "처음 방송이라 비교할 게 없어요", 방송 중 "방송 중이라 숫자가 바뀌고 있어요".
// 볼 곳: 정산 화면 날짜의 "방송 리포트", 방송을 끝낸 콘솔의 "오늘 리포트 보기".
import { test, expect, type Page } from '@playwright/test'
import { LIVE_NOTE, NO_COMPARE, PHONE, VIEWPORTS, endBroadcast, kstDate, loginNewSeller, noOverflow, youtubeSale, DEV_WORDS } from './support.ts'

const ORDER = ['돈', '손님', '지난 방송과 비교', '몰린 상품', '품종별 판매', '시간대별 판매']

/** 앞선 날짜 A: 알손님 10,000원 1개. 날짜 B: 알손님 11,000원 1개 + 엔손님 상품 11개(각 1,000원) — 품종 12개 */
async function reportWorld(page: Page): Promise<{ dA: string; dB: string; bA: string; bB: string; t: string }> {
  await loginNewSeller(page)
  const t = String(Date.now())
  const dA = kstDate(4)
  const dB = kstDate(1)
  const a = await youtubeSale(page, { date: dA, ch: `UC_R${t}`, nick: '알손님', prices: [10_000], paid: true, firstNo: 1 })
  const r = await youtubeSale(page, { date: dB, ch: `UC_R${t}`, nick: '알손님', prices: [11_000], paid: true, firstNo: 1 })
  await youtubeSale(page, { date: dB, b: r.b, ch: `UC_N${t}`, nick: '엔손님', prices: Array.from({ length: 11 }, () => 1_000), paid: false, firstNo: 2 })
  return { dA, dB, bA: a.b, bB: r.b, t }
}

function report(page: Page) {
  return page.locator('main')
}

for (const { name, viewport } of VIEWPORTS) {
  test.describe(`리포트 ${name}`, () => {
    test.use({ viewport })

    test(`AC-KP1-19 ${name}: 정산 날짜의 "방송 리포트" → 순서·숫자·비교 문장·품종 10개+더 보기, 손님 이름 없음, 방송 중 한 줄 → 끝낸 콘솔 "오늘 리포트 보기"엔 그 줄 없음`, async ({ page }) => {
      test.setTimeout(180_000)
      const w = await reportWorld(page)
      // 정산 화면 날짜의 "방송 리포트"
      await page.goto(`/settlements?date=${w.dB}`)
      await page.getByRole('link', { name: '방송 리포트' }).click()
      await expect(page).toHaveURL(new RegExp(`/report\\?date=${w.dB}`))
      await expect(page.getByRole('heading', { level: 1 })).toContainText('방송 리포트')
      const main = report(page)
      await expect(main.getByRole('heading', { level: 2 })).toHaveText(ORDER)
      // 방송 중(끝내지 않음)
      await expect(main.getByText(LIVE_NOTE)).toBeVisible()
      // 돈·손님 (RPT-02·03)
      await expect(main).toContainText('22,000원')
      await expect(main).toContainText('12개')
      await expect(main).toContainText('받은 돈은 배송비를 포함해요')
      const people = main.locator('section').filter({ has: page.getByRole('heading', { name: '손님', exact: true }) })
      await expect(people.locator('div').filter({ hasText: /^산 손님/ })).toContainText('2명')
      await expect(people.locator('div').filter({ hasText: /^새 손님/ })).toContainText('1명')
      await expect(people.locator('div').filter({ hasText: /^다시 온 손님/ })).toContainText('1명')
      // 비교 (RPT-08): 앞 방송 10,000원·1개·1명
      await expect(main).toContainText('지난 방송보다 12,000원 많아요')
      await expect(main).toContainText('지난 방송보다 11개 많아요')
      await expect(main).toContainText('지난 방송보다 1명 많아요')
      await expect(main).not.toContainText('%')
      // 품종 10개 + 더 보기
      const varieties = main.getByRole('list', { name: '품종 목록' })
      await expect(varieties.getByRole('listitem')).toHaveCount(10)
      await main.getByRole('button', { name: /더 보기/ }).click()
      await expect(varieties.getByRole('listitem')).toHaveCount(12)
      // 손님 이름·채널 없음
      const text = await main.innerText()
      for (const word of ['알손님', '엔손님', 'UC_R', 'UC_N']) expect(text).not.toContain(word)
      expect(text).not.toMatch(DEV_WORDS)
      if (viewport.width === PHONE.width) await noOverflow(page, '리포트 375px')

      // 방송을 끝낸 콘솔의 "오늘 리포트 보기"
      await endBroadcast(page, w.bB)
      await page.goto(`/broadcasts/${encodeURIComponent(w.bB)}`)
      await page.getByRole('link', { name: '오늘 리포트 보기' }).click()
      await expect(page).toHaveURL(new RegExp(`/report\\?date=${w.dB}`))
      await expect(report(page).getByRole('heading', { level: 2 })).toHaveText(ORDER)
      await expect(report(page).getByText(LIVE_NOTE)).toHaveCount(0)
      if (viewport.width === PHONE.width) await noOverflow(page, '끝낸 뒤 리포트 375px')
    })
  })
}

test.describe('AC-KP1-19 처음 방송', () => {
  test.use({ viewport: PHONE })

  test('앞선 실제 방송이 없는 날짜의 리포트는 "처음 방송이라 비교할 게 없어요" — 손님은 모두 새 손님', async ({ page }) => {
    test.setTimeout(150_000)
    const w = await reportWorld(page)
    await endBroadcast(page, w.bA)
    await page.goto(`/report?date=${w.dA}`)
    const main = report(page)
    await expect(main.getByRole('heading', { level: 2 })).toHaveText(ORDER)
    await expect(main.getByText(NO_COMPARE)).toBeVisible()
    const people = main.locator('section').filter({ has: page.getByRole('heading', { name: '손님', exact: true }) })
    await expect(people.locator('div').filter({ hasText: /^다시 온 손님/ })).toContainText('0명')
    await expect(people.locator('div').filter({ hasText: /^새 손님/ })).toContainText('1명')
    await noOverflow(page, '처음 리포트 375px')
  })

  test('리허설 날짜에는 "방송 리포트"가 없다 — 리포트 경로도 404', async ({ page }) => {
    await loginNewSeller(page)
    const res = await page.request.get(`/api/days/${kstDate(2)}/report?rehearsal=true`)
    expect(res.status()).toBe(404)
  })
})
