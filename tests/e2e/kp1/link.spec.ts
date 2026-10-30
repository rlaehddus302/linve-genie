// KP1 확인서 링크의 손님 장부 (test-e2e) — AC-KP1-02(동의 칸 보이기)·05(이미 저장한 손님)·07(손님·판매자 지우기)·11(연결 코드 손님 확인).
// 기대 문장은 CUSTOMER_RULES CR-2·CR-3·CR-5와 acceptance 따옴표 그대로. 링크는 로그인 없는 새 문맥, 판매자는 다른 문맥.
import { test, expect, type Page } from '@playwright/test'
import {
  ADDRESS,
  CONSENT_TITLE,
  DELETED,
  DELETE_ASK,
  DELETE_SAVED,
  LINK_ACCOUNT,
  CODE_INTRO,
  LINKED_PREFIX,
  PHONE,
  SAVED_LINE,
  VIEWPORTS,
  addressForm,
  allCustomers,
  broadcast,
  buyerBrowser,
  bundleOf,
  chat,
  consentBody,
  consentBox,
  customerIdOf,
  customerLedger,
  kstDate,
  ledgerSection,
  ledgerSettings,
  loginNewSeller,
  makeLink,
  noOverflow,
  parcelSettings,
  registerApi,
  scopeView,
  sendAddress,
  smsSale,
  writeEvent,
  youtubeSale,
  type Seller,
} from './support.ts'

/** 새 판매자 + 택배 설정 + 실제 날짜에 유튜브 UC_A가 15번 1등 */
async function world(page: Page, opts: { date?: string; nick?: string; price?: number } = {}): Promise<{ seller: Seller; date: string; b: string; buyer: string; ch: string }> {
  const seller = await loginNewSeller(page)
  await parcelSettings(page)
  const ch = `UC_A${String(Date.now())}`
  const date = opts.date ?? kstDate(3)
  const sale = await youtubeSale(page, { date, ch, nick: opts.nick ?? '가람손님', prices: [opts.price ?? 15_000], paid: false, firstNo: 15 })
  return { seller, date, b: sale.b, buyer: sale.buyer, ch }
}

for (const { name, viewport } of VIEWPORTS) {
  test.describe(`링크 ${name}`, () => {
    test.use({ viewport })

    test(`AC-KP1-02 ${name}: 유튜브 구매자 묶음의 링크엔 배송지 양식 아래 빈 체크 칸과 CR-CONSENT-1 글(가게 이름·"1년"), 설정을 2년으로 바꾸면 "2년"`, async ({ page, browser }) => {
      const w = await world(page)
      const url = await makeLink(page, w.date, w.buyer)
      const buyer = await buyerBrowser(browser, page, viewport)
      try {
        await buyer.page.goto(url)
        const box = consentBox(buyer.page)
        await expect(box).toBeVisible()
        await expect(box).not.toBeChecked()
        await expect(addressForm(buyer.page)).toContainText(consentBody(w.seller.shopName, '1년'))
        // 양식 안, 보내기 버튼 위
        const order = await addressForm(buyer.page).evaluate((form) => {
          const check = form.querySelector('input[type=checkbox][name=keep]')
          const submit = form.querySelector('button[type=submit]')
          const memo = form.querySelector('input[name=memo]')
          if (check === null || submit === null) return 'none'
          const beforeSubmit = (check.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
          const afterFields = memo === null || (memo.compareDocumentPosition(check) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
          return beforeSubmit && afterFields ? 'ok' : 'bad'
        })
        expect(order).toBe('ok')
        if (viewport.width === PHONE.width) await noOverflow(buyer.page, '링크 375px')
        // 보관 기간 2년 → 링크 글도 "2년"
        await ledgerSettings(page, { months: 24, consoleBadges: true })
        await buyer.page.reload()
        await expect(addressForm(buyer.page)).toContainText(consentBody(w.seller.shopName, '2년'))
      } finally {
        await buyer.context.close()
      }
    })
  })
}

test.describe('AC-KP1-02 칸이 없는 묶음', () => {
  test.use({ viewport: PHONE })

  test('직접 수령·합배송 묶음, 전화번호 없는 문자 구매자만 있는 묶음, 리허설 묶음에는 동의 칸이 없다', async ({ page, browser }) => {
    test.setTimeout(180_000)
    const w = await world(page)
    const date = w.date
    // 직접 수령 (같은 날짜의 다른 유튜브 구매자)
    const pickup = await youtubeSale(page, { date, b: w.b, ch: `UC_P${String(Date.now())}`, nick: '직접손님', prices: [5_000], paid: false, firstNo: 30 })
    expect((await writeEvent(page, { type: 'settlement.shippingOverride', buyer: pickup.buyer, date, mode: 'PICKUP' }, { date, rehearsal: false })).status).toBeLessThan(300)
    const combined = await youtubeSale(page, { date, b: w.b, ch: `UC_C${String(Date.now())}`, nick: '합손님', prices: [5_000], paid: false, firstNo: 40 })
    expect((await writeEvent(page, { type: 'settlement.shippingOverride', buyer: combined.buyer, date, mode: 'COMBINED' }, { date, rehearsal: false })).status).toBeLessThan(300)
    // 전화번호 없는 문자찜(메모만) — 표지 없음
    const memo = await smsSale(page, { date, b: w.b, memo: '가람이', prices: [7_000], paid: false, firstNo: 50 })
    // 리허설 묶음 (같은 채널)
    const rb = await broadcast(page, kstDate(2), true, '연습')
    await registerApi(page, rb, 15, '연습상품', 10_000)
    await chat(page, rb, w.ch, '가람손님', '15')
    await expect.poll(async () => (await scopeView(page, kstDate(2), true)).buyers.find((x) => x.id === w.ch)?.subtotal ?? 0).toBeGreaterThan(0)
    const rehearsalBuyer = (await scopeView(page, kstDate(2), true)).buyers.find((x) => x.id === w.ch)!
    const links: { what: string; url: string }[] = [
      { what: '직접 수령', url: await makeLink(page, date, pickup.buyer) },
      { what: '합배송', url: await makeLink(page, date, combined.buyer) },
      { what: '메모 문자 구매자', url: await makeLink(page, date, memo.buyer) },
    ]
    const rehearsalLink = await page.request.post(`/api/days/${kstDate(2)}/receipt-links?rehearsal=true`, { data: { requestId: crypto.randomUUID(), buyer: rehearsalBuyer.current ?? rehearsalBuyer.id }, headers: { Origin: new URL(page.url()).origin } })
    // 리허설은 링크 자체가 없다(N4b "리허설 방송은 공유 링크를 만들지 않아요.") — 동의 칸이 보일 길이 없다
    expect(rehearsalLink.status()).toBe(409)
    const buyer = await buyerBrowser(browser, page, PHONE)
    try {
      for (const link of links) {
        await buyer.page.goto(link.url)
        await expect(buyer.page.locator('main, body').first()).toBeVisible()
        await expect(buyer.page.getByRole('checkbox', { name: CONSENT_TITLE }), link.what).toHaveCount(0)
        await expect(buyer.page.getByText(CONSENT_TITLE), link.what).toHaveCount(0)
      }
      // 메모 문자 구매자는 배송지 양식은 있다(칸만 없다)
      await buyer.page.goto(links[2]!.url)
      await expect(addressForm(buyer.page).getByLabel('받는 분')).toBeVisible()
    } finally {
      await buyer.context.close()
    }
  })
})

for (const { name, viewport } of VIEWPORTS) {
  test.describe(`장부 칸 ${name}`, () => {
    test.use({ viewport })

    test(`AC-KP1-05·07 ${name}: 고르고 저장 → "${SAVED_LINE}"·[저장한 정보 지우기], 주소 원문 없음 → 지우기 확인 → "지웠어요.", 묶음 배송지는 그대로`, async ({ page, browser }) => {
      test.setTimeout(150_000)
      const w = await world(page)
      const url = await makeLink(page, w.date, w.buyer)
      const buyer = await buyerBrowser(browser, page, viewport)
      try {
        await buyer.page.goto(url)
        await sendAddress(buyer.page, true)
        const section = ledgerSection(buyer.page)
        await expect(section).toContainText(SAVED_LINE)
        await expect(section.getByRole('link', { name: DELETE_SAVED })).toBeVisible()
        await expect(section.getByRole('button', { name: LINK_ACCOUNT })).toBeVisible()
        const body = await buyer.page.locator('body').innerText()
        expect(body).not.toContain('세종대로')
        expect(body).not.toContain('101동')
        expect(body).not.toContain('04524')
        expect(body).not.toContain('1234-5678')
        // 장부 칸은 가린 이름만 (이번 묶음의 "배송지를 받았어요" 칸 이름은 PC-3 그대로 — 계약서 §7-1 스펙 확인 필요)
        expect(await section.innerText()).not.toContain('홍길동')
        if (viewport.width === PHONE.width) await noOverflow(buyer.page, '링크 장부 칸 375px')
        // 판매자 손님 자세히에도 장부가 생겼다
        const id = await customerIdOf(page, '가람손님')
        expect(await customerLedger(page, id)).not.toBeNull()

        // 지우기 → 확인 쪽 → [그대로 두기]는 아무것도 지우지 않는다
        await section.getByRole('link', { name: DELETE_SAVED }).click()
        await expect(ledgerSection(buyer.page)).toContainText(DELETE_ASK)
        await ledgerSection(buyer.page).getByRole('link', { name: '그대로 두기' }).click()
        await expect(ledgerSection(buyer.page)).toContainText(SAVED_LINE)
        expect(await customerLedger(page, id)).not.toBeNull()
        // 다시 → [지우기]
        await ledgerSection(buyer.page).getByRole('link', { name: DELETE_SAVED }).click()
        await ledgerSection(buyer.page).getByRole('button', { name: '지우기', exact: true }).click()
        await expect(buyer.page.getByText(DELETED, { exact: true })).toBeVisible()
        await expect(buyer.page.getByText(SAVED_LINE)).toHaveCount(0)
        await expect(buyer.page.getByRole('link', { name: DELETE_SAVED })).toHaveCount(0)
        // 이번 주문 배송지는 그대로
        await expect(buyer.page.getByText('배송지를 받았어요')).toBeVisible()
        expect((await bundleOf(page, w.date, w.buyer)).address).toMatchObject({ name: ADDRESS.name, phone: '01012345678' })
        expect(await customerLedger(page, id)).toBeNull()
      } finally {
        await buyer.context.close()
      }
    })
  })
}

test.describe('AC-KP1-03·05 고르지 않고 저장', () => {
  test.use({ viewport: PHONE })

  test('칸을 고르지 않고 저장하면 장부 칸이 생기지 않는다 — 다시 적기 양식엔 다시 빈 칸', async ({ page, browser }) => {
    const w = await world(page)
    const url = await makeLink(page, w.date, w.buyer)
    const buyer = await buyerBrowser(browser, page, PHONE)
    try {
      await buyer.page.goto(url)
      await sendAddress(buyer.page, false)
      await expect(buyer.page.getByText(SAVED_LINE)).toHaveCount(0)
      await expect(ledgerSection(buyer.page)).toHaveCount(0)
      expect(await customerLedger(page, await customerIdOf(page, '가람손님'))).toBeNull()
      await buyer.page.getByRole('link', { name: '다시 적기' }).click()
      await expect(consentBox(buyer.page)).toBeVisible()
      await expect(consentBox(buyer.page)).not.toBeChecked()
    } finally {
      await buyer.context.close()
    }
  })
})

test.describe('AC-KP1-07 판매자 지우기', () => {
  for (const { name, viewport } of VIEWPORTS) {
    test(`${name}: 손님 자세히 [장부에서 지우기] → 확인 창 → 지움, 링크 장부 칸도 사라지고 묶음 배송지는 그대로`, async ({ page, browser }) => {
      test.setTimeout(150_000)
      await page.setViewportSize(viewport)
      const w = await world(page)
      const url = await makeLink(page, w.date, w.buyer)
      const buyer = await buyerBrowser(browser, page, PHONE)
      try {
        await buyer.page.goto(url)
        await sendAddress(buyer.page, true)
        await expect(ledgerSection(buyer.page)).toContainText(SAVED_LINE)
        const id = await customerIdOf(page, '가람손님')
        await page.goto(`/buyers?view=customers&customer=${encodeURIComponent(id)}`)
        const detail = page.getByRole('region', { name: '손님 자세히' })
        const ledger = detail.getByRole('region', { name: '손님 장부' })
        await expect(ledger).toContainText('홍*동')
        await expect(ledger).toContainText('5678')
        await expect(ledger).not.toContainText('세종대로')
        await ledger.getByRole('button', { name: '장부에서 지우기' }).click()
        const dialog = page.getByRole('dialog', { name: '장부에서 지우기' })
        await expect(dialog).toBeVisible()
        await dialog.getByRole('button', { name: '지우기', exact: true }).click()
        await expect(dialog).toHaveCount(0)
        await expect(ledger.getByText('장부에서 지웠어요.')).toBeVisible()
        await expect(ledger.getByRole('button', { name: '장부에서 지우기' })).toHaveCount(0)
        expect(await customerLedger(page, id)).toBeNull()
        await buyer.page.reload()
        await expect(buyer.page.getByText(SAVED_LINE)).toHaveCount(0)
        await expect(buyer.page.getByText('배송지를 받았어요')).toBeVisible()
        expect((await bundleOf(page, w.date, w.buyer)).address).not.toBeNull()
      } finally {
        await buyer.context.close()
      }
    })
  }
})

test.describe('AC-KP1-11 연결 코드 손님 확인', () => {
  for (const { name, viewport } of VIEWPORTS) {
    test(`${name}: [다른 계정도 잇기] → 두 낱말 코드 → 다른 유튜브 계정이 채팅에 치면 링크에 "…이 코드를 쳤어요. 내 계정이 맞나요?" → [네] → 손님 자세히 "이 손님이 직접 이은 계정: …", "모든 손님"은 그대로 두 줄`, async ({ page, browser }) => {
      test.setTimeout(180_000)
      await page.setViewportSize(viewport)
      const w = await world(page)
      const url = await makeLink(page, w.date, w.buyer)
      const buyer = await buyerBrowser(browser, page, viewport)
      try {
        await buyer.page.goto(url)
        await sendAddress(buyer.page, true)
        await ledgerSection(buyer.page).getByRole('button', { name: LINK_ACCOUNT }).click()
        await expect(ledgerSection(buyer.page)).toContainText(CODE_INTRO)
        const text = await ledgerSection(buyer.page).innerText()
        const words = /^([가-힣]{2}) ([가-힣]{2})$/m.exec(text)
        expect(words, text).not.toBeNull()
        expect(words![1]).not.toBe(words![2])
        const code = `${words![1]!} ${words![2]!}`
        expect(text).toMatch(/까지/)
        if (viewport.width === PHONE.width) await noOverflow(buyer.page, '코드 375px')

        // 새 실제 방송(번호 방송)에서 다른 유튜브 계정이 코드를 친다 (채널 끝 4자리 = 4321)
        const b2 = await broadcast(page, kstDate(1))
        const other = `UC_OTHER${String(Date.now())}4321`
        await chat(page, b2, other, '둘째계정', code.replace(' ', ''))
        await buyer.page.reload()
        await expect(ledgerSection(buyer.page)).toContainText("유튜브 '둘째계정'(끝 4321)이 코드를 쳤어요. 내 계정이 맞나요?")
        // 코드 채팅은 찜이 아니다
        expect((await scopeView(page, kstDate(1), false)).claims).toHaveLength(0)
        await ledgerSection(buyer.page).getByRole('button', { name: '네, 제 계정이에요' }).click()
        await expect(ledgerSection(buyer.page)).not.toContainText('코드를 쳤어요')
        await expect(ledgerSection(buyer.page)).toContainText(SAVED_LINE)

        // 판매자 손님 자세히: 이은 계정 한 줄
        const id = await customerIdOf(page, '가람손님')
        await page.goto(`/buyers?view=customers&customer=${encodeURIComponent(id)}`)
        const ledger = page.getByRole('region', { name: '손님 자세히' }).getByRole('region', { name: '손님 장부' })
        await expect(ledger).toContainText(`${LINKED_PREFIX}유튜브 둘째계정(끝 4321)`)
        // 손님 기록은 합치지 않는다 — 코드만 친 계정은 기록 묶음이 없으니, 그 계정이 찜하면 별도 줄
        await registerApi(page, b2, 21, '라울', 8_000)
        await chat(page, b2, other, '둘째계정', '21')
        await expect.poll(async () => (await allCustomers(page)).map((c) => c.name).sort()).toEqual(['가람손님', '둘째계정'])
      } finally {
        await buyer.context.close()
      }
    })
  }

  test('[아니에요]면 버리고 코드 끝 — "잇지 않았어요" 뒤 이은 계정 없음, 같은 코드를 다시 쳐도 붙지 않는다', async ({ page, browser }) => {
    test.setTimeout(150_000)
    const w = await world(page)
    const url = await makeLink(page, w.date, w.buyer)
    const buyer = await buyerBrowser(browser, page, PHONE)
    try {
      await buyer.page.goto(url)
      await sendAddress(buyer.page, true)
      await ledgerSection(buyer.page).getByRole('button', { name: LINK_ACCOUNT }).click()
      const words = /^([가-힣]{2}) ([가-힣]{2})$/m.exec(await ledgerSection(buyer.page).innerText())!
      const code = `${words[1]!} ${words[2]!}`
      const b2 = await broadcast(page, kstDate(1))
      await chat(page, b2, `UC_X${String(Date.now())}9999`, '모르는사람', code)
      await buyer.page.reload()
      await expect(ledgerSection(buyer.page)).toContainText('코드를 쳤어요')
      await ledgerSection(buyer.page).getByRole('button', { name: '아니에요' }).click()
      await expect(ledgerSection(buyer.page)).not.toContainText('코드를 쳤어요')
      // 같은 코드를 다른 사람이 다시 쳐도 붙지 않는다
      await chat(page, b2, `UC_Y${String(Date.now())}8888`, '또다른사람', code)
      await buyer.page.reload()
      await expect(ledgerSection(buyer.page)).toContainText(SAVED_LINE)
      await expect(ledgerSection(buyer.page)).not.toContainText('코드를 쳤어요')
      const id = await customerIdOf(page, '가람손님')
      await page.goto(`/buyers?view=customers&customer=${encodeURIComponent(id)}`)
      const ledger = page.getByRole('region', { name: '손님 자세히' }).getByRole('region', { name: '손님 장부' })
      await expect(ledger).toContainText('홍*동')
      await expect(ledger).not.toContainText(LINKED_PREFIX)
    } finally {
      await buyer.context.close()
    }
  })
})

test.describe('연결 코드 이름 이스케이프 (CLAUDE.md 규칙 7)', () => {
  test.use({ viewport: PHONE })

  test('코드를 친 계정 이름이 HTML이어도 링크엔 글자 그대로 — 그림·스크립트가 생기지 않는다', async ({ page, browser }) => {
    test.setTimeout(150_000)
    const w = await world(page)
    const url = await makeLink(page, w.date, w.buyer)
    const buyer = await buyerBrowser(browser, page, PHONE)
    let dialogs = 0
    buyer.page.on('dialog', (d) => {
      dialogs += 1
      void d.dismiss()
    })
    try {
      await buyer.page.goto(url)
      await sendAddress(buyer.page, true)
      await ledgerSection(buyer.page).getByRole('button', { name: LINK_ACCOUNT }).click()
      const words = /^([가-힣]{2}) ([가-힣]{2})$/m.exec(await ledgerSection(buyer.page).innerText())!
      const evil = '<img src=x onerror=alert(1)>'
      const b2 = await broadcast(page, kstDate(1))
      await chat(page, b2, `UC_E${String(Date.now())}7777`, evil, `${words[1]!} ${words[2]!}`)
      await buyer.page.reload()
      await expect(ledgerSection(buyer.page)).toContainText(`'${evil}'(끝 7777)이 코드를 쳤어요`)
      expect(await buyer.page.locator('img[src="x"]').count()).toBe(0)
      expect(await ledgerSection(buyer.page).locator('img').count()).toBe(0)
      expect(dialogs).toBe(0)
    } finally {
      await buyer.context.close()
    }
  })
})
