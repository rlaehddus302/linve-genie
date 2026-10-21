// N4b 흐름 — 방송 끝 → 영수증 보내기 → 링크 전부 만들기 → 복사 → 구매자가 로그인 없이 연다 → 입금 → 끊기 (AC-N4b-30·31·33·40) — test-e2e.
import { test, expect, type Browser, type Page } from '@playwright/test'
import { allRegion, anonymousPhone, buyerRow, CLIPBOARD_FAKE, CLOSED_TEXT, clipboard, endedDay, linkOf, login, noHorizontalScroll, pay, receiptsPath, resetShop, setShop, TAX_NOTE } from './support.ts'

test.describe('AC-N4b-40 방송 끝 → 링크 → 구매자가 연다', () => {
  test.afterEach(async ({ page }) => {
    await resetShop(page)
  })

  // TE-N4b-001: 기본 묶음(Vite 미리 보기 + E2E 서버)에서 링크 주소 <화면 주소>/r/<토큰>이 E2E 서버가 아니라 vite.config.ts의 기본 대상(localhost:3000)으로 넘어간다
  //   — e2e/serve.ts가 /api만 E2E 서버로 바꾸고 '^/r(/|$)'는 설정 파일의 LIVEJJIM_API_URL 기본값을 그대로 쓴다.
  test('TE-N4b-001: 콘솔 "영수증 보내기" → 링크 전부 만들기 → 문자 구매자 링크 복사 → 로그인 없는 휴대폰이 확인서를 본다 → 입금 반영 → 끊으면 열 수 없음', async ({ page, browser }) => {
    await flow(page, browser)
  })

  test('@served 서버가 화면을 내는 묶음: 같은 흐름', async ({ page, browser }) => {
    await flow(page, browser)
  })
})

async function flow(page: Page, browser: Browser): Promise<void> {
    await page.addInitScript(CLIPBOARD_FAKE)
    await login(page)
    await setShop(page)
    const day = await endedDay(page)
    await page.goto(`/broadcasts/${encodeURIComponent(day.b)}`)
    const go = page.getByRole('link', { name: '영수증 보내기' })
    await expect(go).toBeVisible()
    await go.click()
    await expect(page).toHaveURL(new RegExp(`${receiptsPath(day.b).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
    await expect(page.getByRole('heading', { level: 1, name: '영수증 보내기' })).toBeVisible()
    await expect(page.getByText('화요일 저녁')).toBeVisible()
    const rows = page.getByRole('list', { name: '구매자' }).getByRole('group')
    await expect(rows).toHaveCount(2)
    await allRegion(page).getByRole('button', { name: '링크 전부 만들기' }).click()
    await expect(allRegion(page).getByText('링크 2개를 만들었어요.')).toBeVisible()
    const phoneRow = buyerRow(page, '문자찜')
    await expect(phoneRow).toContainText(/링크 있음 · \d{1,2}월 \d{1,2}일 \([일월화수목금토]\) \d{2}:\d{2}까지/)
    await phoneRow.getByRole('button', { name: '링크 복사' }).click()
    await expect(phoneRow.getByRole('status')).toHaveText('복사했어요.')
    const clip = await clipboard(page)
    expect(clip).toHaveLength(1)
    expect(clip[0]).toMatch(/^다육이네 구매 내역 확인서예요\. \d{1,2}월 \d{1,2}일 \([일월화수목금토]\)까지 열 수 있어요\. http:\/\/localhost:\d+\/r\/[A-Za-z0-9_-]{43}$/)
    const url = linkOf(clip[0]!)
    expect(new URL(url).origin).toBe(new URL(page.url()).origin)

    // 로그인하지 않은 휴대폰 문맥
    const buyer = await anonymousPhone(browser, page)
    try {
      const res = await buyer.goto(url)
      expect(res?.status()).toBe(200)
      expect(res?.headers()['content-type']).toBe('text/html; charset=utf-8')
      await expect(buyer.getByRole('heading', { level: 1, name: '구매 내역 확인서' })).toBeVisible()
      const body = buyer.locator('body')
      await expect(body).toContainText('다육이네')
      await expect(body).toContainText('4567')
      await expect(body).toContainText('22,000원')
      await expect(body).toContainText('미입금')
      await expect(body).toContainText('국민 123-45-6789 김다육')
      await expect(body).toContainText(TAX_NOTE)
      await expect(body).toContainText(/이 링크는 \d{4}-\d{2}-\d{2} \([일월화수목금토]\) \d{2}:\d{2}까지 열 수 있어요\./)
      const img = buyer.getByRole('img', { name: '구매 내역 확인서 그림' })
      await expect.poll(async () => await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(1080)
      const html = await buyer.content()
      expect(html).not.toContain('010-7123-4567')
      expect(html).not.toContain('01071234567')
      expect(html).not.toContain(day.memo)
      expect(html).not.toContain('블루엘프')
      expect(html).not.toContain(day.phoneBuyer)
      expect(html).not.toContain('<script')
      await noHorizontalScroll(buyer)
      const pdfHref = await buyer.getByRole('link', { name: 'PDF로 받기' }).getAttribute('href')
      const pdf = await buyer.request.get(new URL(pdfHref!, url).toString())
      expect(pdf.status()).toBe(200)
      expect((await pdf.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-')

      // 입금 → 새로고침하면 바뀐 상태
      await pay(page, day.date, day.phoneBuyer, 5000)
      await buyer.reload()
      await expect(body).toContainText('부분 입금')
      await expect(body).toContainText('17,000원')

      // 끊기 → 열 수 없음
      await phoneRow.getByRole('button', { name: '링크 끊기' }).click()
      const dlg = page.getByRole('dialog', { name: '링크 끊기' })
      await expect(dlg).toContainText(/님의 링크를 끊으면 그 링크로는 더 이상 열 수 없어요\. 필요하면 새 링크를 만들어 보내 주세요\./)
      await expect(dlg.getByRole('button', { name: '닫기' })).toBeFocused()
      await page.keyboard.press('1')
      await expect(phoneRow.getByRole('status')).toHaveText('링크를 끊었어요.')
      await expect(phoneRow).toContainText('링크 끊음')
      await expect(phoneRow.getByRole('button', { name: '링크 만들기' })).toBeFocused()
      const closed = await buyer.reload()
      expect(closed?.status()).toBe(404)
      await expect(buyer.locator('body')).toContainText(CLOSED_TEXT)
    } finally {
      await buyer.context().close()
    }
}
