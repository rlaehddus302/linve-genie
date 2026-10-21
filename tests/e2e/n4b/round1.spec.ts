// N4b 라운드 1 공격 (test-e2e): 끊기 창 숫자 키·끊은 뒤 포커스, 휴대폰의 손으로 복사 칸·끊기 창, 긴 이름·상품명의 구매자 문서.
import { test, expect, type Page } from '@playwright/test'
import { buyerRow, endBroadcast, login, noHorizontalScroll, phoneLike, postJson, realDay, receiptsPath, resetShop, setShop, uniqueDate } from './support.ts'

/** 보이는 누르는 곳(44px)·글자(16px) 검사 — root 아래만 */
async function touchAndText(page: Page, root: string): Promise<{ small: string[]; tiny: string[] }> {
  return await page.evaluate((sel) => {
    const small: string[] = []
    const tiny: string[] = []
    const base = document.querySelector(sel) ?? document.body
    for (const el of base.querySelectorAll<HTMLElement>('button, a, input')) {
      if (el.offsetParent === null) continue
      const r = el.getBoundingClientRect()
      if (r.height < 44 || r.width < 44) small.push(`${el.textContent?.trim() ?? el.tagName} ${String(Math.round(r.width))}x${String(Math.round(r.height))}`)
    }
    const walker = document.createTreeWalker(base, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      const parent = n.parentElement
      if (parent === null || (n.textContent ?? '').trim() === '' || parent.offsetParent === null) continue
      const size = parseFloat(getComputedStyle(parent).fontSize)
      if (size < 16) tiny.push(`${(n.textContent ?? '').trim().slice(0, 20)} ${String(size)}px`)
    }
    return { small, tiny }
  }, root)
}

async function oneBuyerDay(page: Page, opts: { memo: string; product: string }) {
  const date = uniqueDate()
  const { b, buyers } = await realDay(page, { date, title: '긴 이름 방송', products: [{ no: 1, name: opts.product, price: 12000 }], claims: [{ no: 1, memo: opts.memo }] })
  await endBroadcast(page, b)
  return { date, b, buyer: buyers.get(opts.memo)! }
}

test.describe('AC-N4b-33·34 끊기 창 키보드', () => {
  test('끊기 창에서 숫자 키 1 → 끊고 "링크를 끊었어요.", 상태 "링크 끊음", 포커스는 그 줄의 "링크 만들기"', async ({ page }) => {
    await login(page)
    const day = await oneBuyerDay(page, { memo: '키보드손님', product: '핑크프릴' })
    await page.goto(receiptsPath(day.b))
    const row = buyerRow(page, /키보드손님/)
    await row.getByRole('button', { name: '링크 만들기' }).click()
    await expect(row.getByRole('button', { name: '링크 복사' })).toBeFocused()
    await row.getByRole('button', { name: '링크 끊기' }).focus()
    await page.keyboard.press('Enter')
    const dlg = page.getByRole('dialog', { name: '링크 끊기' })
    await expect(dlg.getByRole('button', { name: '닫기' })).toBeFocused()
    await page.keyboard.press('1')
    await expect(dlg).toHaveCount(0)
    await expect(row.getByRole('status')).toHaveText('링크를 끊었어요.')
    await expect(row).toContainText('링크 끊음')
    await expect(row.getByRole('button', { name: '링크 만들기' })).toBeFocused()
    const list = await page.request.get(`/api/days/${day.date}/receipt-links`)
    const links = (await list.json() as { links: { buyer: string; status: string }[] }).links
    expect(links.find((l) => l.buyer === day.buyer)?.status).toBe('REVOKED')
  })
})

test.describe('AC-N4b-34 휴대폰 — 조치 뒤 모양', () => {
  test('375×812: 클립보드를 못 써 손으로 복사할 글 칸이 열려도 가로 스크롤 없음·글 칸 44px, 끊기 창 버튼 44px·글자 16px', async ({ page, browser }) => {
    await login(page)
    const day = await oneBuyerDay(page, { memo: '휴대폰손님', product: '라울' })
    const phone = await phoneLike(browser, page)
    try {
      await phone.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new DOMException('x', 'NotAllowedError')) } })
      })
      await phone.goto(receiptsPath(day.b))
      const row = buyerRow(phone, /휴대폰손님/)
      await row.getByRole('button', { name: '링크 만들기' }).click()
      await row.getByRole('button', { name: '링크 복사' }).click()
      await expect(row.getByLabel('길게 눌러 복사해 주세요.')).toBeVisible()
      await noHorizontalScroll(phone)
      const shown = await touchAndText(phone, 'main')
      expect(shown.small).toEqual([])
      expect(shown.tiny).toEqual([])
      await row.getByRole('button', { name: '링크 끊기' }).click()
      const dlg = phone.getByRole('dialog', { name: '링크 끊기' })
      await expect(dlg).toBeVisible()
      await noHorizontalScroll(phone)
      const inDialog = await touchAndText(phone, '[role="dialog"]')
      expect(inDialog.small).toEqual([])
      expect(inDialog.tiny).toEqual([])
    } finally {
      await phone.context().close()
    }
  })

  test('375×812 구매자 문서: 띄어쓰기 없는 긴 이름·긴 상품 이름·긴 계좌 안내도 가로 스크롤 없음', async ({ page, browser }) => {
    await login(page)
    await setShop(page, { accountNote: '입금자명은꼭닉네임과방송날짜를붙여서적어주세요그래야빨리확인할수있어요감사합니다' })
    try {
      const memo = '다육이를정말정말좋아하는사람입니다다육이최고예요'
      const day = await oneBuyerDay(page, { memo, product: '핑크프릴라울블루엘프세트특대형한정판매상품입니다꼭확인하세요' })
      const made = await postJson(page, `/api/days/${day.date}/receipt-links`, { requestId: crypto.randomUUID(), buyer: day.buyer })
      expect(made.status, JSON.stringify(made.body)).toBe(200)
      const url = (made.body['link'] as { url: string }).url
      const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true })
      const p = await context.newPage()
      try {
        const res = await p.goto(url)
        expect(res?.status()).toBe(200)
        await expect(p.getByRole('heading', { name: '구매 내역 확인서' })).toBeVisible()
        await noHorizontalScroll(p)
      } finally {
        await context.close()
      }
    } finally {
      await resetShop(page)
    }
  })
})
