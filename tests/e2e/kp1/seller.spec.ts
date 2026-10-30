// KP1 판매자 묶음 자세히의 손님 장부 (test-e2e) — AC-KP1-04(판매자는 대신 적을 수 없다)·06(보관 기간 줄이기 확인, D-KP1-45)·08("확인 전"으로 보이기, 출처 D-KP1-44).
// 기대 문장은 CUSTOMER_RULES CR-2·CR-4, PARCEL_RULES PC-4(배송지 상태 확인 전) 그대로.
import { test, expect, type Browser, type Page } from '@playwright/test'
import {
  ADDRESS,
  LEDGER_SOURCE_LINE,
  LINK_PREFILL,
  PHONE,
  PREFILL_TITLE,
  VIEWPORTS,
  addressForm,
  buyerBrowser,
  bundleOf,
  consentBox,
  customerIdOf,
  customerLedger,
  kstDate,
  ledgerSection,
  loginNewSeller,
  makeLink,
  noOverflow,
  openBundle,
  parcelRowOf,
  parcelSettings,
  sendAddress,
  writeEvent,
  youtubeSale,
  DELETE_SAVED,
  packAll,
  customerSection,
  ledgerSettingsNow,
  saveButton,
  shrinkAskLine,
} from './support.ts'

/** 손님이 링크에서 고르고 저장 (날짜 d1의 그 묶음) */
async function consentOn(page: Page, browser: Browser, date: string, buyer: string, address: Parameters<typeof sendAddress>[2] = ADDRESS): Promise<string> {
  const url = await makeLink(page, date, buyer)
  const b = await buyerBrowser(browser, page, PHONE)
  try {
    await b.page.goto(url)
    await sendAddress(b.page, true, address)
  } finally {
    await b.context.close()
  }
  return url
}

for (const { name, viewport } of VIEWPORTS) {
  test.describe(`확인 전 ${name}`, () => {
    test.use({ viewport })

    test(`AC-KP1-08 ${name}: 지난 날짜에 고른 UC_A의 새 날짜 묶음 — 판매자 "${PREFILL_TITLE}"+다섯 칸·택배 상태 확인 전, 링크 "지난번 배송지로…", [배송지 확인] 뒤 장부를 바꿔도 묶음 배송지 그대로`, async ({ page, browser }) => {
      test.setTimeout(180_000)
      await loginNewSeller(page)
      await parcelSettings(page)
      const ch = `UC_A${String(Date.now())}`
      const d1 = kstDate(5)
      const d2 = kstDate(2)
      const s1 = await youtubeSale(page, { date: d1, ch, nick: '가람손님', prices: [15_000], paid: true, firstNo: 15 })
      const link1 = await consentOn(page, browser, d1, s1.buyer)
      // 입금·포장까지 마친 묶음 — 배송지만 남은 막힘이 되게 (PC-4)
      const s2 = await youtubeSale(page, { date: d2, ch, nick: '가람손님', prices: [8_000], paid: true, firstNo: 15 })
      await packAll(page, d2, s2.buyer)

      // 판매자 묶음 자세히
      const region = await openBundle(page, d2, s2.buyer)
      const prefill = region.getByRole('region', { name: PREFILL_TITLE })
      await expect(prefill).toBeVisible()
      await expect(region).toContainText(PREFILL_TITLE)
      for (const value of [ADDRESS.name, '010-1234-5678', ADDRESS.address, ADDRESS.detail, ADDRESS.zip]) await expect(prefill).toContainText(value)
      await expect(prefill).toContainText('확인 전')
      if (viewport.width === PHONE.width) await noOverflow(page, '묶음 자세히 375px')
      // 복사하지 않았다 · 택배 판단은 확인 전(PC-4)
      const before = await bundleOf(page, d2, s2.buyer)
      expect(before.address).toBeNull()
      expect(before.ledger).toMatchObject({ name: ADDRESS.name, phone: '01012345678', address: ADDRESS.address, detail: ADDRESS.detail, zip: ADDRESS.zip })
      expect(await parcelRowOf(page, d2, s2.buyer)).toMatchObject({ address: 'UNCONFIRMED', reason: 'ADDRESS_UNCONFIRMED', ready: false })

      // 구매자 링크(새 날짜): 가린 이름·끝 4자리만 + [다시 적기]는 빈 양식
      const link2 = await makeLink(page, d2, s2.buyer)
      const b = await buyerBrowser(browser, page, viewport)
      try {
        await b.page.goto(link2)
        await expect(addressForm(b.page)).toContainText(LINK_PREFILL)
        const text = await b.page.locator('body').innerText()
        expect(text).not.toContain('세종대로')
        expect(text).not.toContain('홍길동')
        await addressForm(b.page).getByRole('link', { name: '다시 적기' }).click()
        await expect(addressForm(b.page).getByLabel('받는 분', { exact: true })).toHaveValue('')
        await expect(addressForm(b.page).getByLabel('주소', { exact: true })).toHaveValue('')
      } finally {
        await b.context.close()
      }

      // [배송지 확인] → 묶음 배송지(판매자·확인함)
      await prefill.getByRole('button', { name: '배송지 확인' }).click()
      await expect(region.getByRole('region', { name: PREFILL_TITLE })).toHaveCount(0)
      await expect(region).toContainText('확인함')
      await expect(region).toContainText(ADDRESS.address)
      // D-KP1-44: 출처는 장부 확인(값 'LEDGER') — 손님이 처음 적고 판매자가 확인함, "판매자가 적었어요" 아님
      await expect(region).toContainText(LEDGER_SOURCE_LINE)
      await expect(region).not.toContainText('판매자가 적었어요')
      const after = await bundleOf(page, d2, s2.buyer)
      expect(after.address).toMatchObject({ name: ADDRESS.name, phone: '01012345678', address: ADDRESS.address, source: 'LEDGER', confirmed: true })
      expect(await parcelRowOf(page, d2, s2.buyer)).toMatchObject({ address: 'CONFIRMED', ready: true })

      // 그 뒤 손님이 지난 링크에서 장부를 새 주소로 바꿔도 이 묶음 배송지는 그대로
      const b1 = await buyerBrowser(browser, page, PHONE)
      try {
        await b1.page.goto(link1)
        await addressForm(b1.page).getByRole('link', { name: '다시 적기' }).click()
        await sendAddress(b1.page, true, { name: '김새집', phone: '010-9999-1111', address: '부산광역시 해운대구 센텀로 1', detail: '1001호' })
      } finally {
        await b1.context.close()
      }
      expect((await bundleOf(page, d2, s2.buyer)).address).toMatchObject({ name: ADDRESS.name, address: ADDRESS.address })
      await page.reload()
      await expect(page.getByRole('region', { name: '배송지', exact: true })).toContainText(ADDRESS.address)
      await expect(page.getByRole('region', { name: '배송지', exact: true })).not.toContainText('센텀로')
      // 새로 고쳐도 같은 출처 글 (D-KP1-44)
      await expect(page.getByRole('region', { name: '배송지', exact: true })).toContainText(LEDGER_SOURCE_LINE)
      await expect(page.getByRole('region', { name: '배송지', exact: true })).not.toContainText('판매자가 적었어요')
    })
  })
}

test.describe('AC-KP1-08 확인 전에 지우면', () => {
  test.use({ viewport: PHONE })

  test('판매자가 묶음 자세히를 보고 있는데 손님이 링크에서 지우면 "지난 주문 배송지" 칸이 다시 열지 않아도 사라진다', async ({ page, browser }) => {
    test.setTimeout(150_000)
    await loginNewSeller(page)
    await parcelSettings(page)
    const ch = `UC_A${String(Date.now())}`
    const d1 = kstDate(5)
    const d2 = kstDate(2)
    const s1 = await youtubeSale(page, { date: d1, ch, nick: '가람손님', prices: [15_000], paid: true, firstNo: 15 })
    const link1 = await consentOn(page, browser, d1, s1.buyer)
    const s2 = await youtubeSale(page, { date: d2, ch, nick: '가람손님', prices: [8_000], paid: false, firstNo: 15 })
    const region = await openBundle(page, d2, s2.buyer)
    await expect(region.getByRole('region', { name: PREFILL_TITLE })).toBeVisible()

    const b = await buyerBrowser(browser, page, PHONE)
    try {
      await b.page.goto(link1)
      await ledgerSection(b.page).getByRole('link', { name: DELETE_SAVED }).click()
      await ledgerSection(b.page).getByRole('button', { name: '지우기', exact: true }).click()
      await expect(b.page.getByText('지웠어요.', { exact: true })).toBeVisible()
    } finally {
      await b.context.close()
    }
    await expect(region.getByRole('region', { name: PREFILL_TITLE })).toHaveCount(0)
    await expect(region.getByRole('button', { name: '배송지 적기' })).toBeVisible()
    expect((await bundleOf(page, d2, s2.buyer)).ledger ?? null).toBeNull()
  })

  test('보이던 칸에서 [배송지 확인]을 누르기 직전에 장부가 지워졌으면 "지난 주문 배송지가 없어졌어요…" — 아무것도 저장하지 않는다', async ({ page, browser }) => {
    test.setTimeout(150_000)
    await loginNewSeller(page)
    await parcelSettings(page)
    const ch = `UC_A${String(Date.now())}`
    const d1 = kstDate(5)
    const d2 = kstDate(2)
    const s1 = await youtubeSale(page, { date: d1, ch, nick: '가람손님', prices: [15_000], paid: true, firstNo: 15 })
    await consentOn(page, browser, d1, s1.buyer)
    const s2 = await youtubeSale(page, { date: d2, ch, nick: '가람손님', prices: [8_000], paid: false, firstNo: 15 })
    // 알림 통로를 처음부터 막아 오래된 화면을 만든다 — 서버 판단(409 NO_LEDGER)만 본다
    await page.route('**/api/stream**', () => { /* 응답하지 않는다 */ })
    const region = await openBundle(page, d2, s2.buyer)
    const prefill = region.getByRole('region', { name: PREFILL_TITLE })
    await expect(prefill).toBeVisible()
    const id = await customerIdOf(page, '가람손님')
    const ledger = (await customerLedger(page, id)) as { ledgerId: string }
    const del = await page.request.post(`/api/customers/${encodeURIComponent(id)}/ledger/delete`, { data: { ledgerId: ledger.ledgerId }, headers: { Origin: new URL(page.url()).origin } })
    expect(del.status(), await del.text()).toBe(200)
    await expect(prefill).toBeVisible()
    await prefill.getByRole('button', { name: '배송지 확인' }).click()
    await expect(region).toContainText('지난 주문 배송지가 없어졌어요. 배송지를 직접 적어 주세요.')
    expect((await bundleOf(page, d2, s2.buyer)).address).toBeNull()
  })
})

test.describe('AC-KP1-08 합친 묶음', () => {
  test('구성원 표지가 서로 다른 장부 줄 둘에 걸친 합친 묶음엔 보이지 않는다 — 하나뿐이면 보인다', async ({ page, browser }) => {
    test.setTimeout(180_000)
    await loginNewSeller(page)
    await parcelSettings(page)
    const t = String(Date.now())
    const d1 = kstDate(6)
    const d2 = kstDate(2)
    const a1 = await youtubeSale(page, { date: d1, ch: `UC_A${t}`, nick: '에이', prices: [10_000], paid: true, firstNo: 15 })
    const b1 = await youtubeSale(page, { date: d1, b: a1.b, ch: `UC_B${t}`, nick: '비이', prices: [10_000], paid: true, firstNo: 16 })
    await consentOn(page, browser, d1, a1.buyer)
    await consentOn(page, browser, d1, b1.buyer, { name: '김비이', phone: '010-2222-3333', address: '대구광역시 중구 동성로 1' })
    const a2 = await youtubeSale(page, { date: d2, ch: `UC_A${t}`, nick: '에이', prices: [5_000], paid: false, firstNo: 15 })
    const b2 = await youtubeSale(page, { date: d2, b: a2.b, ch: `UC_B${t}`, nick: '비이', prices: [5_000], paid: false, firstNo: 16 })
    // 합치기 전: 각자 하나씩 보인다
    expect((await bundleOf(page, d2, a2.buyer)).ledger).toMatchObject({ name: ADDRESS.name })
    expect((await bundleOf(page, d2, b2.buyer)).ledger).toMatchObject({ name: '김비이' })
    expect((await writeEvent(page, { type: 'buyer.merge', from: b2.buyer, into: a2.buyer, reason: '같은 사람' }, { date: d2, rehearsal: false })).status).toBeLessThan(300)
    await expect.poll(async () => (await bundleOf(page, d2, a2.buyer)).ledger ?? null).toBeNull()
    const region = await openBundle(page, d2, a2.buyer)
    await expect(region.getByRole('region', { name: PREFILL_TITLE })).toHaveCount(0)
    await expect(region).not.toContainText('세종대로')
    await expect(region).not.toContainText('동성로')
  })
})

test.describe('AC-KP1-04 판매자는 대신 적을 수 없다', () => {
  for (const { name, viewport } of VIEWPORTS) {
    test(`${name}: 묶음 자세히 [배송지 적기] 창엔 동의 칸이 없고, 저장해도 장부가 생기지 않는다 — 다음 날짜 묶음에 "지난 주문 배송지" 없음`, async ({ page }) => {
      test.setTimeout(150_000)
      await page.setViewportSize(viewport)
      await loginNewSeller(page)
      await parcelSettings(page)
      const ch = `UC_A${String(Date.now())}`
      const d1 = kstDate(5)
      const s1 = await youtubeSale(page, { date: d1, ch, nick: '가람손님', prices: [15_000], paid: true, firstNo: 15 })
      const region = await openBundle(page, d1, s1.buyer)
      await region.getByRole('button', { name: '배송지 적기' }).click()
      const dialog = page.getByRole('dialog', { name: '배송지 적기' })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('checkbox')).toHaveCount(0)
      await expect(dialog).not.toContainText('다음 주문에도')
      await dialog.getByLabel('받는 분', { exact: true }).fill(ADDRESS.name)
      await dialog.getByLabel('연락처', { exact: true }).fill(ADDRESS.phone)
      await dialog.getByLabel('주소', { exact: true }).fill(ADDRESS.address)
      await dialog.getByRole('button', { name: /저장/ }).click()
      await expect(dialog).toHaveCount(0)
      await expect(region).toContainText(ADDRESS.address)
      expect(await customerLedger(page, await customerIdOf(page, '가람손님'))).toBeNull()
      // 장부를 만드는 판매자 경로가 없다 (손님 자세히 장부·묶음 장부 쓰기)
      const id = await customerIdOf(page, '가람손님')
      const origin = { Origin: new URL(page.url()).origin }
      for (const path of [`/api/customers/${id}/ledger`, '/api/ledger', '/api/ledger-lines']) {
        const res = await page.request.post(path, { data: { name: ADDRESS.name, phone: ADDRESS.phone, address: ADDRESS.address }, headers: origin })
        expect(res.status(), path).toBe(404)
      }
      const s2 = await youtubeSale(page, { date: kstDate(2), ch, nick: '가람손님', prices: [5_000], paid: false, firstNo: 15 })
      expect((await bundleOf(page, kstDate(2), s2.buyer)).ledger ?? null).toBeNull()
      const region2 = await openBundle(page, kstDate(2), s2.buyer)
      await expect(region2.getByRole('region', { name: PREFILL_TITLE })).toHaveCount(0)
    })
  }

  test('구매자 링크에서 다시 적기 양식(이미 장부가 있는 손님)에도 동의 칸은 처음엔 빈칸', async ({ page, browser }) => {
    await loginNewSeller(page)
    await parcelSettings(page)
    const s1 = await youtubeSale(page, { date: kstDate(5), ch: `UC_A${String(Date.now())}`, nick: '가람손님', prices: [15_000], paid: true, firstNo: 15 })
    const url = await consentOn(page, browser, kstDate(5), s1.buyer)
    const b = await buyerBrowser(browser, page, PHONE)
    try {
      await b.page.goto(url)
      await addressForm(b.page).getByRole('link', { name: '다시 적기' }).click()
      await expect(consentBox(b.page)).not.toBeChecked()
    } finally {
      await b.context.close()
    }
  })
})

test.describe('AC-KP1-06 보관 기간 줄이기 확인 (D-KP1-45)', () => {
  for (const { name, viewport } of VIEWPORTS) {
    test(`${name}: 지울 줄 0개면 창 없이 저장, 늘리기도 창 없이 — 서버가 2명이라 답하면 1년 → 6개월 저장 전에 "${shrinkAskLine(2)}" 창, [그대로 두기]면 1년 그대로, [줄이기]면 6개월`, async ({ page, browser }) => {
      test.setTimeout(240_000)
      await page.setViewportSize(viewport)
      await loginNewSeller(page)
      await parcelSettings(page)
      // 사흘 전에 고른 손님 하나 — 6개월로 줄여도 지울 줄은 0개
      const t = String(Date.now())
      const recent = kstDate(3)
      const c = await youtubeSale(page, { date: recent, ch: `UC_C${t}`, nick: '씨이', prices: [10_000], paid: true, firstNo: 15 })
      await consentOn(page, browser, recent, c.buyer)
      expect((await ledgerSettingsNow(page)).months).toBe(12)
      const previews: string[] = []
      page.on('request', (r) => {
        if (new URL(r.url()).pathname === '/api/ledger-settings/preview') previews.push(new URL(r.url()).searchParams.get('months') ?? '')
      })

      await page.goto('/settings')
      const radio = (label: string) => customerSection(page).getByRole('radio', { name: label, exact: true })
      const dialog = page.getByRole('dialog', { name: '보관 기간을 줄일까요?' })
      await expect(radio('1년')).toBeChecked()
      // 지울 줄 0개(서버 수 그대로) → 창 없이 저장
      await radio('6개월').check()
      await saveButton(page).click()
      await expect.poll(async () => (await ledgerSettingsNow(page)).months).toBe(6)
      await expect(dialog).toHaveCount(0)
      expect(previews).toEqual(['6'])
      // 늘리기(6개월 → 1년)는 묻지도 않는다
      await radio('1년').check()
      await saveButton(page).click()
      await expect.poll(async () => (await ledgerSettingsNow(page)).months).toBe(12)
      await expect(dialog).toHaveCount(0)
      expect(previews).toEqual(['6'])
      expect(await customerLedger(page, await customerIdOf(page, '씨이'))).not.toBeNull()

      // 지울 줄 2개 — 손님 링크는 주문 날짜 30일 안에만 배송지를 받아 6개월 넘게 지난 장부 줄을 화면으로 만들 수 없다.
      // 그래서 서버의 수(판매자 전용 읽기, 서버 단위·도메인 시험이 셈을 본다)만 2로 바꿔 화면 확인 창을 본다
      await page.route('**/api/ledger-settings/preview**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ months: 6, willDelete: 2 }) })
      })
      await radio('6개월').check()
      await saveButton(page).click()
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText(shrinkAskLine(2))
      await expect(dialog.getByRole('button', { name: '줄이기', exact: true })).toBeVisible()
      // 처음 고른 쪽 = 그대로 두기
      await expect(dialog.getByRole('button', { name: '그대로 두기', exact: true })).toBeFocused()
      if (viewport.width === PHONE.width) await noOverflow(page, '줄이기 창 375px')
      await dialog.getByRole('button', { name: '그대로 두기', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect(radio('1년')).toBeChecked()
      expect((await ledgerSettingsNow(page)).months).toBe(12)
      await page.reload()
      await expect(radio('1년')).toBeChecked()
      expect(await customerLedger(page, await customerIdOf(page, '씨이'))).not.toBeNull()

      // 다시 6개월 → [줄이기]면 저장
      await radio('6개월').check()
      await saveButton(page).click()
      await expect(dialog).toContainText(shrinkAskLine(2))
      await dialog.getByRole('button', { name: '줄이기', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect.poll(async () => (await ledgerSettingsNow(page)).months).toBe(6)
    })
  }
})
