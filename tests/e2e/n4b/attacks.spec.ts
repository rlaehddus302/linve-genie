// N4b 흐름 깨뜨리기 — 서비스 워커·이스케이프·합치기/떼어 내기·다른 기기의 가게 이름·봉인한 날짜 (AC-N4b-20·23·25·30·33) — test-e2e.
import { test, expect, type Page } from '@playwright/test'
import { directApi, e2eDate, loginNewSeller } from '../i3/support.ts'
import { anonymousPhone, buyerRow, CLIPBOARD_FAKE, CLOSED_TEXT, clipboard, endedDay, login, phoneLike, postJson, receiptsPath, resetShop, setShop, writeEvent } from './support.ts'

/** (날짜, 구매자) 링크를 API로 만들고, 기본 묶음의 화면 프록시(TE-N4b-001)를 거치지 않는 서버 주소로 돌려준다 */
async function makeLink(page: Page, date: string, buyer: string, direct = true): Promise<string> {
  const made = await postJson(page, `/api/days/${date}/receipt-links`, { requestId: crypto.randomUUID(), buyer })
  expect(made.status, JSON.stringify(made.body)).toBe(200)
  const url = new URL((made.body['link'] as { url: string }).url)
  return direct ? `${directApi()}${url.pathname}` : url.toString()
}

test.describe('AC-N4b-25 서비스 워커가 링크를 가로채지 않는다', () => {
  test('@served 앱을 연 적 있는 브라우저(서비스 워커 등록)에서 링크를 열면 서버 문서, 끊기면 앱 화면을 대신 주지 않는다', async ({ page, browser }) => {
    await login(page)
    const day = await endedDay(page)
    const url = await makeLink(page, day.date, day.phoneBuyer, false)
    const buyer = await anonymousPhone(browser, page)
    try {
      await buyer.goto('/')
      await buyer.evaluate(async () => {
        await navigator.serviceWorker.ready
      })
      await buyer.reload()
      await expect.poll(async () => await buyer.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true)
      const res = await buyer.goto(url)
      expect(res?.status()).toBe(200)
      expect(res?.fromServiceWorker()).toBe(false)
      await expect(buyer.getByRole('heading', { level: 1, name: '구매 내역 확인서' })).toBeVisible()
      expect(await buyer.content()).not.toContain('<script')
      await buyer.context().setOffline(true)
      let opened = true
      try {
        await buyer.goto(url)
      } catch {
        opened = false
      }
      if (opened) {
        await expect(buyer.getByLabel('아이디')).toHaveCount(0)
        await expect(buyer.getByRole('button', { name: '로그인' })).toHaveCount(0)
      }
      await buyer.context().setOffline(false)
    } finally {
      await buyer.context().close()
    }
  })
})

test.describe('AC-N4b-20 구매자 문서의 이스케이프', () => {
  test('메모 이름 <img src=x onerror=alert(1)>가 글자로 보이고 요소가 생기지 않는다', async ({ page, browser }) => {
    await login(page)
    const evil = '<img src=x onerror=alert(1)>'
    const day = await endedDay(page, { memo: evil })
    const url = await makeLink(page, day.date, day.memoBuyer)
    const buyer = await anonymousPhone(browser, page)
    try {
      const dialogs: string[] = []
      buyer.on('dialog', (d) => {
        dialogs.push(d.message())
        void d.dismiss()
      })
      await buyer.goto(url)
      await expect(buyer.getByRole('heading', { level: 1, name: '구매 내역 확인서' })).toBeVisible()
      await expect(buyer.locator('img')).toHaveCount(1)
      await expect(buyer.locator('img')).toHaveAttribute('alt', '구매 내역 확인서 그림')
      expect(dialogs).toEqual([])
      // 영수증 보내기 화면도 글자로
      await page.goto(receiptsPath(day.b))
      await expect(page.getByRole('list', { name: '구매자' }).locator('img')).toHaveCount(0)
    } finally {
      await buyer.context().close()
    }
  })
})

test.describe('AC-N4b-23 합치기·떼어 내기와 링크', () => {
  test('X를 Y에 합치면 LX는 열 수 없고 LY는 합친 묶음, 떼어 내면 LX가 다시 X 묶음', async ({ page, browser }) => {
    await login(page)
    const day = await endedDay(page)
    const lx = await makeLink(page, day.date, day.memoBuyer)
    const ly = await makeLink(page, day.date, day.phoneBuyer)
    const buyer = await anonymousPhone(browser, page)
    try {
      await buyer.goto(lx)
      await expect(buyer.getByRole('heading', { name: '상품 1개' })).toBeVisible()
      expect((await writeEvent(page, { type: 'buyer.merge', from: day.memoBuyer, into: day.phoneBuyer, reason: '같은 사람' }, { date: day.date, rehearsal: false })).status).toBeLessThan(300)
      const closed = await buyer.goto(lx)
      expect(closed?.status()).toBe(404)
      await expect(buyer.locator('body')).toContainText(CLOSED_TEXT)
      await buyer.goto(ly)
      await expect(buyer.getByRole('heading', { name: '상품 3개' })).toBeVisible()
      // 영수증 보내기 화면도 줄 하나
      await page.goto(receiptsPath(day.b))
      await expect(page.getByRole('list', { name: '구매자' }).getByRole('group')).toHaveCount(1)
      expect((await writeEvent(page, { type: 'buyer.unmerge', from: day.memoBuyer, reason: '다른 사람' }, { date: day.date, rehearsal: false })).status).toBeLessThan(300)
      const back = await buyer.goto(lx)
      expect(back?.status()).toBe(200)
      await expect(buyer.getByRole('heading', { name: '상품 1개' })).toBeVisible()
      await buyer.goto(ly)
      await expect(buyer.getByRole('heading', { name: '상품 2개' })).toBeVisible()
      await expect(page.getByRole('list', { name: '구매자' }).getByRole('group')).toHaveCount(2)
    } finally {
      await buyer.context().close()
    }
  })
})

test.describe('AC-N4b-33 복사하는 글의 가게 이름', () => {
  test('TE-N4b-002: 다른 기기에서 가게 이름을 바꾸면 이 화면의 복사 글도 새 가게 이름(구매자 문서와 같은 이름)', async ({ page, browser }) => {
    await login(page)
    const day = await endedDay(page)
    const phone = await phoneLike(browser, page)
    try {
      await phone.addInitScript(CLIPBOARD_FAKE)
      await phone.goto(receiptsPath(day.b))
      const row = buyerRow(phone, '문자찜')
      await row.getByRole('button', { name: '링크 만들기' }).click()
      await expect(row.getByRole('button', { name: '링크 복사' })).toBeVisible()
      // 가게 설정이 바뀌면 화면은 가게 이름(GET /api/shop)을 다시 읽은 뒤 줄을 받는다 — 그 다음 줄 응답을 기다린다.
      // (아무 줄 응답이나 기다리면, 다른 알림(입금 확인 등)으로 먼저 다시 받은 줄 응답에 걸려 이름을 읽기 전에 복사한다)
      let shopRead = false
      const fetched = phone.waitForResponse((r) => {
        if (r.request().method() === 'GET' && new URL(r.url()).pathname === '/api/shop') shopRead = true
        return shopRead && r.url().includes('/receipt-buyers')
      })
      await setShop(page, { name: '초록다육' })
      await fetched
      await row.getByRole('button', { name: '링크 복사' }).click()
      await expect.poll(async () => (await clipboard(phone)).length).toBe(1)
      expect((await clipboard(phone))[0]).toMatch(/^초록다육 구매 내역 확인서예요\./)
    } finally {
      await resetShop(page)
      await phone.context().close()
    }
  })
})

test.describe('AC-N4b-30 봉인한 날짜', () => {
  test('봉인한 날짜의 끝난 방송 콘솔에도 "영수증 보내기"', async ({ page }) => {
    const seller = await loginNewSeller(page)
    const sealed = await e2eDate(page.request, seller.loginId, 'sealed')
    await page.goto(`/broadcasts/${encodeURIComponent(sealed.broadcast)}`)
    await expect(page.getByRole('link', { name: '영수증 보내기' })).toBeVisible()
    await page.getByRole('link', { name: '영수증 보내기' }).click()
    await expect(page.getByRole('heading', { level: 1, name: '영수증 보내기' })).toBeVisible()
    await expect(page.getByText('방송을 끝낸 뒤 보낼 수 있어요.')).toHaveCount(0)
  })
})
