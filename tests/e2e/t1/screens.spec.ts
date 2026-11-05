// T1 택배 접수 화면 (AC-T1-60·61·62·63·64) — test-e2e. 기대 문장은 acceptance.md·PARCEL_RULES.md 따옴표 그대로.
import { test, expect, type Browser, type Page } from '@playwright/test'
import { menu, menuLink, moreLinks, openMore } from '../menu.ts'
import {
  bookButton,
  bookRequestsTagged,
  fakeRequests,
  SENDER,
  taggedAddress,
  bookedGroup,
  bookApi,
  downloadBytes,
  excludedGroup,
  fakeParcel,
  loginAs,
  makeReady,
  noHorizontalScroll,
  openParcels,
  packAll,
  parcelDay,
  parcelDayWith,
  parcelSeller,
  payAll,
  pdfPages,
  postJson,
  readyGroup,
  rowOf,
  tall,
  WAYBILL_NOTE,
  writeEvent,
} from './support.ts'

const ENGLISH = /PENDING|BOOKED|UNKNOWN|FAILED|CANCELLED|NOT_PAID|NOT_PACKED|PICKUP|ADDRESS_UNCONFIRMED|UNPAID|PARTIAL|PAID|undefined|null|NaN/

/** AC-T1-22의 여섯 묶음: ① 준비 끝 ② 부분 입금 ③ 포장 대기 ④ 배송지 확인 전 ⑤ 직접 수령 ⑥ 접수함 */
async function sixBundles(page: Page) {
  const memos = ['하나', '두리', '세찌', '네찌', '다섯', '여섯']
  const { date, buyers } = await parcelDayWith(page, { buyers: memos.map((memo) => ({ memo })) })
  const [b1, b2, b3, b4, b5, b6] = buyers as [string, string, string, string, string, string]
  await makeReady(page, date, b1)
  // ② 부분 입금
  expect((await writeEvent(page, { type: 'settlement.payment', buyer: b2, date, amount: 1 }, { date, rehearsal: false })).status).toBeLessThan(300)
  // ③ 입금 완료·포장 대기
  await payAll(page, date, b3)
  // ④ 입금·포장 완료, 구매자가 링크에서 적은 배송지(확인 전)
  await payAll(page, date, b4)
  await packAll(page, date, b4)
  const made = await postJson(page, `/api/days/${date}/receipt-links`, { requestId: crypto.randomUUID(), buyer: b4 })
  expect(made.status, JSON.stringify(made.body)).toBe(200)
  const link = (made.body['link'] as { url: string }).url
  const origin = new URL(page.url()).origin
  const form = await page.request.post(`${origin}${new URL(link).pathname}/address`, {
    form: { name: '김구매', phone: '010-5555-4444', address: '부산광역시 해운대구 센텀로 1', detail: '', zip: '', memo: '' },
    headers: { Origin: origin },
    maxRedirects: 0,
  })
  expect(form.status(), await form.text()).toBe(303)
  // ⑤ 직접 수령 (입금·포장·배송지 모두 있어도)
  await makeReady(page, date, b5)
  expect((await writeEvent(page, { type: 'settlement.shippingOverride', buyer: b5, date, mode: 'PICKUP' }, { date, rehearsal: false })).status).toBeLessThan(300)
  // ⑥ 접수함
  await makeReady(page, date, b6)
  const booked = await bookApi(page, date, [b6])
  expect(booked.status, JSON.stringify(booked.body)).toBe(200)
  const day = await parcelDay(page, date)
  const name = (buyer: string) => [...day.ready, ...day.excluded, ...day.booked].find((r) => r.buyer === buyer)!.name
  return { date, b1, b2, b3, b4, b5, b6, name }
}

test.describe('AC-T1-60 메뉴 "택배"', () => {
  test('PC: 위 줄 메뉴의 "설정" 바로 앞, 주소 /parcels(새로고침·바로 열기 같음)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await parcelSeller(page)
    await page.goto('/settings')
    const links = await menu(page).getByRole('link').allInnerTexts()
    const names = links.map((t) => t.replace(/\s+\d+$/, '').trim())
    expect(names.indexOf('택배'), names.join('|')).toBeGreaterThan(-1)
    expect(names.indexOf('택배') + 1).toBe(names.indexOf('설정'))
    await menuLink(page, '택배').click()
    await expect(page).toHaveURL(/\/parcels/)
    await expect(page.getByRole('heading', { level: 1, name: '택배 접수' })).toBeVisible()
    await expect(menuLink(page, '택배')).toHaveAttribute('aria-current', 'page')
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: '택배 접수' })).toBeVisible()
  })

  // D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 기대 "보조자 계정 메뉴에 택배 없음, /parcels는 안내만"을 뺐다
  test('휴대폰: 막대 다섯 칸 그대로, "더보기" 목록의 "설정" 바로 앞', async ({ page, browser }) => {
    const seller = await parcelSeller(page)
    const phone = await phoneOf(browser, page, seller)
    try {
      await phone.goto('/parcels')
      await expect(phone.getByRole('heading', { level: 1, name: '택배 접수' })).toBeVisible()
      await expect(menu(phone).getByRole('link')).toHaveText(['방송', '문자찜', '구매자', '정산']) // MOB1 D-MOB1-04
      await openMore(phone)
      const names = (await moreLinks(phone).allInnerTexts()).map((t) => t.replace(/\s+\d+$/, '').trim())
      expect(names.slice(-2)).toEqual(['택배', '설정'])
      await expect(menuLink(phone, '택배')).toHaveAttribute('aria-current', 'page')
    } finally {
      await phone.context().close()
    }
  })
})

async function phoneOf(browser: Browser, like: Page, account: { loginId: string; password: string }): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(like.url()).origin })
  const page = await ctx.newPage()
  await loginAs(page, account)
  return page
}

test.describe('AC-T1-61 택배 화면 구성', () => {
  test('PC: 여섯 묶음이 세 무리로, 줄마다 이유 문장, 접수함은 송장·상태·마지막 확인, 영어 상태값 없음', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await parcelSeller(page)
    const s = await sixBundles(page)
    const six = await rowOf(page, s.date, s.b6)
    expect(six.parcel?.invoiceText).toMatch(/^9\d{3}-\d{4}-\d{4}$/)
    await openParcels(page, s.date)
    // 날짜 고르기: 연도·요일
    await expect(page.getByRole('combobox', { name: '날짜' })).toContainText(/\d{4}년 \d{1,2}월 \d{1,2}일\([일월화수목금토]\)/)

    const ready = readyGroup(page)
    await expect(ready.getByRole('checkbox')).toHaveCount(1)
    await expect(ready.getByRole('checkbox', { name: s.name(s.b1) })).toBeChecked()
    await expect(ready.getByRole('combobox', { name: '택배 크기' })).toHaveValue('80') // FB1 D-FB1-05
    await expect(bookButton(page)).toHaveText('1개 택배 접수하기')
    await expect(bookButton(page)).toBeEnabled()

    const ex = excludedGroup(page)
    for (const [buyer, text] of [
      [s.b2, '입금 완료 전이에요'],
      [s.b3, '포장 전이에요'],
      [s.b4, '배송지를 확인해 주세요'],
      [s.b5, '직접 수령이에요'],
    ] as const) {
      await expect(ex.getByRole('listitem').filter({ hasText: s.name(buyer) })).toContainText(text)
    }
    await expect(ex.getByRole('listitem')).toHaveCount(4)
    // 배송지 이유엔 "배송지 보기"
    await expect(ex.getByRole('listitem').filter({ hasText: s.name(s.b4) }).getByRole('link', { name: '배송지 보기' })).toBeVisible()

    const booked = bookedGroup(page)
    const row = booked.getByRole('listitem').filter({ hasText: s.name(s.b6) })
    // 송장번호는 꼬리표 "택배: 접수됨 · 9000-…" 안에 한 번만 (U-T1-11), 붙은 모양(900000000001)은 없다 (U-T1-06)
    await expect(row).toContainText(`택배: 접수됨 · ${six.parcel!.invoiceText!}`)
    expect((await row.innerText()).split(six.parcel!.invoiceText!).length - 1).toBe(1)
    expect(await row.innerText()).not.toContain(six.parcel!.invoice!)
    await expect(row).toContainText(/마지막 확인 \d{1,2}\/\d{1,2} \d{1,2}:\d{2}/)
    const group = booked.getByRole('group', { name: `${s.name(s.b6)} 택배` })
    await expect(group.getByRole('button', { name: '운송장 PDF' })).toBeVisible()
    await expect(group.getByRole('button', { name: '접수 취소' })).toBeVisible()
    await expect(booked.getByRole('button', { name: '운송장 전부 PDF' })).toBeVisible()
    await expect(booked).toContainText(WAYBILL_NOTE)

    const text = await page.locator('main').innerText()
    expect(text).not.toMatch(ENGLISH)

    // 0개 고르면 잠김
    await ready.getByRole('checkbox', { name: s.name(s.b1) }).uncheck()
    await expect(bookButton(page)).toHaveText('0개 택배 접수하기')
    await expect(bookButton(page)).toBeDisabled()
  })

  test('휴대폰(390): 누르는 곳 44px 이상', async ({ page, browser }) => {
    const seller = await parcelSeller(page)
    const s = await sixBundles(page)
    const phone = await phoneOf(browser, page, seller)
    try {
      await openParcels(phone, s.date)
      const ready = readyGroup(phone)
      await expect(ready.getByRole('checkbox')).toHaveCount(1)
      await tall(ready.getByRole('checkbox').locator('xpath=ancestor::label[1]'))
      await tall(ready.getByRole('combobox', { name: '택배 크기' })) // FB1 D-FB1-05
      await tall(bookButton(phone))
      await tall(phone.getByRole('combobox', { name: '날짜' }))
      const group = bookedGroup(phone).getByRole('group', { name: `${s.name(s.b6)} 택배` })
      await tall(group.getByRole('button', { name: '운송장 PDF' }))
      await tall(group.getByRole('button', { name: '접수 취소' }))
      await tall(bookedGroup(phone).getByRole('button', { name: '운송장 전부 PDF' }))
      await tall(excludedGroup(phone).getByRole('link', { name: '배송지 보기' }))
    } finally {
      await phone.context().close()
    }
  })

  for (const width of [390, 375]) {
    test(`TE-T1-002: 휴대폰(${String(width)}) 가로 스크롤 없음 — 접수가 있는 날짜(날짜 고르기 글이 길 때)`, async ({ page, browser }) => {
      const seller = await parcelSeller(page)
      const s = await sixBundles(page)
      const ctx = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(page.url()).origin })
      const phone = await ctx.newPage()
      try {
        await loginAs(phone, seller)
        await openParcels(phone, s.date)
        await expect(readyGroup(phone).getByRole('checkbox')).toHaveCount(1)
        await expect(phone.getByRole('combobox', { name: '날짜' })).toContainText('접수 1')
        await noHorizontalScroll(phone)
      } finally {
        await ctx.close()
      }
    })
  }

  test('TE-T1-001: 표시 이름이 같은 구매자(전화번호 문자찜 둘)는 이름 규칙(D-098)대로 " · 뒤 4자리 …"로 나뉜다', async ({ page }) => {
    await parcelSeller(page)
    const { date, buyers } = await parcelDayWith(page, { buyers: [{ phone: '010-3100-0001' }, { phone: '010-3100-0002' }] })
    await makeReady(page, date, buyers[0]!)
    await makeReady(page, date, buyers[1]!)
    expect((await bookApi(page, date, [buyers[1]!])).status).toBe(200)
    await openParcels(page, date)
    // 고르는 칸·접수한 줄의 이름이 서로 다르게 읽혀야 한다 (판매자가 엉뚱한 묶음을 빼거나 취소하지 않게)
    await expect(readyGroup(page).getByRole('checkbox', { name: '문자찜 · 뒤 4자리 0001', exact: true })).toBeVisible()
    await expect(bookedGroup(page).getByRole('group', { name: '문자찜 · 뒤 4자리 0002 택배', exact: true })).toBeVisible()
  })

  test('보내는 사람·택배사가 없으면 목록 위 한 문장과 "설정으로", 주 버튼 잠김', async ({ page }) => {
    await parcelSeller(page, {})
    const { date, buyers } = await parcelDayWith(page, { buyers: [{ memo: '가람' }] })
    await makeReady(page, date, buyers[0]!)
    await openParcels(page, date)
    // 둘 다 없음: 둘 중 한 문장
    await expect(page.getByRole('note').filter({ hasText: /^(보내는 사람 정보를 먼저 적어 주세요\.|택배사를 먼저 이어 주세요\.)/ })).toBeVisible()
    await expect(bookButton(page)).toBeDisabled()
    await page.getByRole('link', { name: '설정으로' }).click()
    await expect(page).toHaveURL(/\/settings\/parcel$/)
    await expect(page.getByRole('region', { name: '택배', exact: true })).toBeVisible()

    const origin = new URL(page.url()).origin
    // 택배사만 고름 → 보내는 사람 문장
    let put = await page.request.put('/api/parcels/settings', { data: { carrier: 'FAKE' }, headers: { Origin: origin } })
    expect(put.status(), await put.text()).toBe(200)
    await openParcels(page, date)
    await expect(page.getByText('보내는 사람 정보를 먼저 적어 주세요.')).toBeVisible()
    await expect(bookButton(page)).toBeDisabled()
    await expect(page.getByRole('link', { name: '설정으로' })).toBeVisible()
    // 보내는 사람만 있고 택배사 끊음 → 택배사 문장
    put = await page.request.put('/api/parcels/settings', { data: { carrier: null, sender: SENDER }, headers: { Origin: origin } })
    expect(put.status(), await put.text()).toBe(200)
    await openParcels(page, date)
    await expect(page.getByText('택배사를 먼저 이어 주세요.')).toBeVisible()
    await expect(bookButton(page)).toBeDisabled()
    // 접수 API도 409 (AC-T1-22)
    expect((await bookApi(page, date, buyers)).status).toBe(409)
  })
})

test.describe('AC-T1-62 접수하기 흐름', () => {
  test('주 버튼 → 확인 창(처음 포커스 "닫기") → 접수하기 → "접수했어요" 무리로, 판매대장·포장도 배송 완료', async ({ page }) => {
    await parcelSeller(page)
    const { date, buyers } = await parcelDayWith(page, { buyers: ['가람', '나래', '다솜'].map((memo) => ({ memo })) })
    for (const buyer of buyers) await makeReady(page, date, buyer)
    await openParcels(page, date)
    await expect(readyGroup(page).getByRole('checkbox')).toHaveCount(3)
    // 상자 크기 하나 바꾸기
    await readyGroup(page).getByRole('combobox', { name: '택배 크기' }).nth(1).selectOption('120') // FB1 D-FB1-05
    const posts: string[] = []
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/book')) posts.push(r.postData() ?? '')
    })
    await bookButton(page).click()
    const dlg = page.getByRole('dialog', { name: '택배 접수' })
    await expect(dlg).toContainText('3개를 택배로 접수할까요?')
    await expect(dlg.getByRole('button', { name: '닫기' })).toBeFocused()
    await dlg.getByRole('button', { name: '접수하기' }).click()
    await expect(page.getByRole('status').filter({ hasText: '3개 접수했어요.' })).toBeVisible()
    await expect(bookedGroup(page).getByRole('listitem')).toHaveCount(3)
    await expect(readyGroup(page).getByRole('checkbox')).toHaveCount(0)
    await expect(bookButton(page)).toBeDisabled()
    expect(posts).toHaveLength(1)
    const sent = JSON.parse(posts[0]!) as { items: { buyer: string; box: string }[] }
    expect(sent.items.map((i) => i.box)).toEqual(['80', '120', '80']) // FB1 D-FB1-05
    const day = await parcelDay(page, date)
    expect(day.booked.map((r) => r.parcel?.state)).toEqual(['BOOKED', 'BOOKED', 'BOOKED'])
    // 포장 상태 = 배송 완료 (AC-T1-30)
    const packing = await (await page.request.get(`/api/days/${date}/packing`)).json() as { entries: { buyer: string; status: string; invoice: string | null }[] }
    for (const r of day.booked) {
      const e = packing.entries.find((x) => x.buyer === r.buyer)!
      expect(e.status).toBe('배송 완료')
      expect(e.invoice).toBe(r.parcel!.invoice)
    }
  })

  test('두 기기(PC·휴대폰): 한쪽이 접수하면 다른 쪽도 새로고침 없이 "접수했어요"로, 같은 묶음을 함께 눌러도 접수는 하나', async ({ page, browser }) => {
    const seller = await parcelSeller(page)
    const { date, buyers } = await parcelDayWith(page, { buyers: [{ memo: '가람' }, { memo: '나래' }] })
    const tag = `동시${String(Date.now())}`
    for (const buyer of buyers) await makeReady(page, date, buyer, taggedAddress(tag))
    const phone = await phoneOf(browser, page, seller)
    try {
      await openParcels(page, date)
      await openParcels(phone, date)
      await expect(readyGroup(phone).getByRole('checkbox')).toHaveCount(2)
      await expect(readyGroup(page).getByRole('checkbox')).toHaveCount(2)
      // 둘 다 확인 창까지 열고 같은 순간에 누른다
      await bookButton(page).click()
      await bookButton(phone).click()
      const a = page.getByRole('dialog', { name: '택배 접수' }).getByRole('button', { name: '접수하기' })
      const b = phone.getByRole('dialog', { name: '택배 접수' }).getByRole('button', { name: '접수하기' })
      await Promise.all([a.click(), b.click()])
      await expect(bookedGroup(page).getByRole('listitem')).toHaveCount(2)
      await expect(bookedGroup(phone).getByRole('listitem')).toHaveCount(2)
      const day = await parcelDay(page, date)
      const invoices = day.booked.map((r) => r.parcel!.invoice!)
      expect(new Set(invoices).size).toBe(2)
      const packing = await (await page.request.get(`/api/days/${date}/packing`)).json() as { entries: { buyer: string; status: string }[] }
      expect(packing.entries.map((e) => e.status)).toEqual(['배송 완료', '배송 완료'])
      // 가짜 택배사가 받은 접수: 묶음마다 요청 번호 하나 (PC-INV-1)
      const mine = bookRequestsTagged((await fakeRequests(page)).requests, tag)
      expect(new Set(mine.map((r) => r.requestKey)).size).toBe(2)
    } finally {
      await phone.context().close()
    }
  })

  test('다른 기기에서 API로 접수하면 열어 둔 화면이 새로고침 없이 바뀐다 (실시간)', async ({ page, browser }) => {
    const seller = await parcelSeller(page)
    const { date, buyers } = await parcelDayWith(page, { buyers: [{ memo: '가람' }] })
    await makeReady(page, date, buyers[0]!)
    const phone = await phoneOf(browser, page, seller)
    try {
      await openParcels(phone, date)
      await expect(readyGroup(phone).getByRole('checkbox')).toHaveCount(1)
      expect((await bookApi(page, date, [buyers[0]!])).status).toBe(200)
      await expect(bookedGroup(phone).getByRole('listitem')).toHaveCount(1, { timeout: 3000 })
      await expect(readyGroup(phone).getByRole('checkbox')).toHaveCount(0)
    } finally {
      await phone.context().close()
    }
  })
})

test.describe('AC-T1-63 운송장 받기', () => {
  test('"운송장 PDF"·"운송장 전부 PDF"는 PDF 파일(파일 이름 운송장-날짜-이름·전부)', async ({ page }) => {
    await parcelSeller(page)
    const { date, buyers } = await parcelDayWith(page, { buyers: [{ memo: '가람' }, { memo: '나래' }] })
    for (const buyer of buyers) await makeReady(page, date, buyer)
    expect((await bookApi(page, date, buyers)).status).toBe(200)
    const day = await parcelDay(page, date)
    const first = day.booked[0]!
    await openParcels(page, date)
    await expect(bookedGroup(page)).toContainText(WAYBILL_NOTE)
    const [one] = await Promise.all([page.waitForEvent('download'), bookedGroup(page).getByRole('group', { name: `${first.name} 택배` }).getByRole('button', { name: '운송장 PDF' }).click()])
    expect(one.suggestedFilename()).toBe(`운송장-${date}-${first.name}.pdf`)
    const bytes = await downloadBytes(one)
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(await pdfPages(bytes)).toBe(1)
    const [all] = await Promise.all([page.waitForEvent('download'), bookedGroup(page).getByRole('button', { name: '운송장 전부 PDF' }).click()])
    expect(all.suggestedFilename()).toBe(`운송장-${date}-전부.pdf`)
    expect(await pdfPages(await downloadBytes(all))).toBe(2)
  })
})

test.describe('AC-T1-64 접수 취소', () => {
  test('"접수 취소" → 확인 창(처음 포커스 "닫기") → "취소하기" → "보낼 수 있어요"로 돌아온다', async ({ page }) => {
    await parcelSeller(page)
    const { date, buyers } = await parcelDayWith(page, { buyers: [{ memo: '가람' }] })
    await makeReady(page, date, buyers[0]!)
    expect((await bookApi(page, date, buyers)).status).toBe(200)
    const name = (await rowOf(page, date, buyers[0]!)).name
    await openParcels(page, date)
    await bookedGroup(page).getByRole('group', { name: `${name} 택배` }).getByRole('button', { name: '접수 취소' }).click()
    const dlg = page.getByRole('dialog', { name: '접수 취소' })
    await expect(dlg.getByRole('button', { name: '닫기' })).toBeFocused()
    await dlg.getByRole('button', { name: '취소하기' }).click()
    await expect(readyGroup(page).getByRole('checkbox', { name })).toBeVisible()
    await expect(bookedGroup(page).getByRole('listitem')).toHaveCount(0)
    const row = await rowOf(page, date, buyers[0]!)
    expect(row.group).toBe('ready')
    const packing = await (await page.request.get(`/api/days/${date}/packing`)).json() as { entries: { status: string }[] }
    expect(packing.entries[0]!.status).toBe('포장 완료')
  })

  test('집하 뒤면 "택배사가 이미 가져갔어요. 택배사에 직접 문의해 주세요."이고 줄은 그대로', async ({ page }) => {
    await parcelSeller(page)
    const { date, buyers } = await parcelDayWith(page, { buyers: [{ memo: '가람' }] })
    await makeReady(page, date, buyers[0]!)
    expect((await bookApi(page, date, buyers)).status).toBe(200)
    const row = await rowOf(page, date, buyers[0]!)
    await fakeParcel(page, 'status', { invoice: row.parcel!.invoice, status: 'PICKED_UP' })
    await openParcels(page, date)
    const group = bookedGroup(page).getByRole('group', { name: `${row.name} 택배` })
    await group.getByRole('button', { name: '접수 취소' }).click()
    await page.getByRole('dialog', { name: '접수 취소' }).getByRole('button', { name: '취소하기' }).click()
    await expect(bookedGroup(page).getByText('택배사가 이미 가져갔어요. 택배사에 직접 문의해 주세요.')).toBeVisible()
    await expect(bookedGroup(page).getByRole('listitem')).toHaveCount(1)
    expect((await rowOf(page, date, buyers[0]!)).group).toBe('booked')
  })
})

