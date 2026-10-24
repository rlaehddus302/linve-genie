// T1 끝에서 끝: 설정 "택배"(AC-T1-66) → 구매자 링크 배송지(AC-T1-70·71) → 확인 → 접수 → 판매대장 → 운송장 → 조회 — test-e2e.
import { test, expect, type Browser, type Page } from '@playwright/test'
import { xlsxRows } from '../i2/support.ts'
import { ADDRESS_NOTE, anonymousPhone, downloadBytes, endBroadcast, fakeParcel, loginNewSeller, noHorizontalScroll, openParcels, packAll, parcelDay, parcelDayWith, parcelSeller, payAll, postJson, readyGroup, bookButton, bookedGroup, rowOf, SENDER } from './support.ts'

function parcelSettings(page: Page) {
  return page.getByRole('region', { name: '택배', exact: true })
}

test.describe('AC-T1-66 설정 "택배"', () => {
  test('택배사 고르기·고객 번호(끝 4자리만)·보내는 사람(이름 기본 가게 이름)·기본 상자 크기, 틀리면 칸마다 문장, 저장하면 "저장했어요"', async ({ page }) => {
    const seller = await loginNewSeller(page)
    await page.goto('/settings/parcel')
    const region = parcelSettings(page)
    await expect(region).toBeVisible()
    const carrier = region.getByRole('combobox', { name: '택배사' })
    await expect(carrier.getByRole('option', { name: '가짜 택배(시험용)' })).toHaveCount(1)
    await expect(carrier.getByRole('option', { name: '우체국택배', exact: true })).toBeEnabled() // FB1 D-FB1-04
    const sender = region.getByRole('group', { name: '보내는 사람' })
    await expect(sender.getByLabel('보내는 사람 이름')).toHaveValue(seller.shopName)
    const box = region.getByRole('combobox', { name: '기본 택배 크기 (세 변의 합)' }) // FB1 D-FB1-05
    await expect(box.getByRole('option')).toHaveText(['60cm 이하', '80cm 이하', '100cm 이하', '120cm 이하', '160cm 이하']) // FB1 D-FB1-05
    await expect(box).toHaveValue('80') // FB1 D-FB1-05

    // 틀린 보내는 사람 연락처
    await carrier.selectOption({ label: '가짜 택배(시험용)' })
    await sender.getByLabel('보내는 사람 연락처').fill('12345')
    await sender.getByLabel('보내는 주소').fill(SENDER.address)
    await page.getByRole('region', { name: '저장', exact: true }).getByRole('button', { name: '저장' }).click() // FB1 D-FB1-06
    // 보내는 사람 칸 문장 (D-T1-17): 집 전화 예도 함께, 받는 분·010 문장은 없다
    await expect(sender.getByText('전화번호를 숫자로 적어 주세요. 예: 010-1234-5678, 031-123-4567')).toBeVisible()
    await expect(sender.getByLabel('보내는 사람 연락처')).toHaveAttribute('aria-invalid', 'true')
    expect(await sender.innerText()).not.toMatch(/받는 분|010으로 시작/)
    await expect(page.getByRole('region', { name: '저장', exact: true }).getByText('저장했어요.')).toHaveCount(0) // FB1 D-FB1-06

    await sender.getByLabel('보내는 사람 연락처').fill(SENDER.phone)
    await sender.getByLabel('보내는 상세 주소').fill(SENDER.detail)
    await sender.getByLabel('보내는 우편번호(몰라도 돼요)').fill(SENDER.zip)
    await region.getByLabel('택배사 고객 번호').fill('ABC-1234-5678')
    await box.selectOption('100') // FB1 D-FB1-05
    await page.getByRole('region', { name: '저장', exact: true }).getByRole('button', { name: '저장' }).click() // FB1 D-FB1-06
    await expect(page.getByRole('region', { name: '저장', exact: true }).getByText('저장했어요.')).toBeVisible() // FB1 D-FB1-06
    // 다시 열어도 그대로, 고객 번호는 끝 4자리만
    await page.reload()
    await expect(parcelSettings(page).getByRole('combobox', { name: '택배사' })).toHaveValue('FAKE')
    await expect(parcelSettings(page).getByText('저장한 번호 끝 5678')).toBeVisible()
    await expect(parcelSettings(page).getByLabel('택배사 고객 번호')).toHaveValue('')
    expect(await page.locator('main').innerText()).not.toContain('ABC-1234')
    await expect(parcelSettings(page).getByRole('combobox', { name: '기본 택배 크기 (세 변의 합)' })).toHaveValue('100') // FB1 D-FB1-05
    await expect(parcelSettings(page).getByLabel('보내는 사람 연락처')).toHaveValue(/031-?123-?4567/)
  })
})

test.describe('AC-T1-66 보내는 사람 이름 30자·칸 문장 (D-T1-16·17)', () => {
  test('가게 이름이 21~30자인 판매자가 이름을 고치지 않고 연락처·주소만 적어 저장하면 "저장했어요" — 다시 열어도 이름 그대로, 연락처 123은 보내는 사람 문장', async ({ page }) => {
    await loginNewSeller(page)
    const shopName = '수원 다육이네 농원 라이브 판매장 본점 일호점'
    expect([...shopName].length).toBeGreaterThanOrEqual(21)
    expect([...shopName].length).toBeLessThanOrEqual(30)
    const shop = await page.request.put('/api/shop', { data: { name: shopName }, headers: { Origin: new URL(page.url()).origin } })
    expect(shop.ok(), await shop.text()).toBe(true)
    await page.goto('/settings/parcel')
    const region = parcelSettings(page)
    const sender = region.getByRole('group', { name: '보내는 사람' })
    await expect(sender.getByLabel('보내는 사람 이름')).toHaveValue(shopName)
    await region.getByRole('combobox', { name: '택배사' }).selectOption({ label: '가짜 택배(시험용)' })
    // 연락처 123 → 보내는 사람 문장 (받는 분·010 문장 없음)
    await sender.getByLabel('보내는 사람 연락처').fill('123')
    await sender.getByLabel('보내는 주소').fill(SENDER.address)
    await page.getByRole('region', { name: '저장', exact: true }).getByRole('button', { name: '저장' }).click() // FB1 D-FB1-06
    await expect(sender.getByLabel('보내는 사람 연락처')).toHaveAttribute('aria-invalid', 'true')
    await expect(sender.getByText('전화번호를 숫자로 적어 주세요. 예: 010-1234-5678, 031-123-4567')).toBeVisible()
    expect(await sender.innerText()).not.toMatch(/받는 분|010으로 시작/)
    await expect(sender.getByLabel('보내는 사람 이름')).toHaveAttribute('aria-invalid', 'false')
    // 집 전화로 고쳐 저장 (이름은 손대지 않음)
    await sender.getByLabel('보내는 사람 연락처').fill(SENDER.phone)
    await page.getByRole('region', { name: '저장', exact: true }).getByRole('button', { name: '저장' }).click() // FB1 D-FB1-06
    await expect(page.getByRole('region', { name: '저장', exact: true }).getByText('저장했어요.')).toBeVisible() // FB1 D-FB1-06
    await page.reload()
    await expect(parcelSettings(page).getByRole('group', { name: '보내는 사람' }).getByLabel('보내는 사람 이름')).toHaveValue(shopName)
    const saved = (await (await page.request.get('/api/parcels/settings')).json()) as { settings: { sender: { name: string } | null } }
    expect(saved.settings.sender?.name).toBe(shopName)
  })
})

async function noJsPhone(browser: Browser, like: Page): Promise<Page> {
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(like.url()).origin })
  return await ctx.newPage()
}

async function makeLink(page: Page, date: string, buyer: string): Promise<string> {
  const made = await postJson(page, `/api/days/${date}/receipt-links`, { requestId: crypto.randomUUID(), buyer })
  expect(made.status, JSON.stringify(made.body)).toBe(200)
  return (made.body['link'] as { url: string }).url
}

test.describe('TE-T1-003 실제 브라우저의 양식 보내기', () => {
  test('구매자 링크 쪽(Referrer-Policy: no-referrer)에서 보낸 배송지 양식이 저장된다 — 브라우저가 보내는 Origin 그대로', async ({ page, browser }) => {
    await parcelSeller(page)
    const { date, buyers } = await parcelDayWith(page, { buyers: [{ memo: '가람' }] })
    const url = await makeLink(page, date, buyers[0]!)
    const buyer = await anonymousPhone(browser, page)
    try {
      const page0 = await buyer.goto(url)
      const policy = page0?.headers()['referrer-policy'] ?? ''
      const origins: string[] = []
      buyer.on('request', (r) => {
        if (r.method() === 'POST') origins.push(r.headers()['origin'] ?? '(없음)')
      })
      const form = buyer.locator('#address')
      await form.getByLabel('받는 분').fill('김구매')
      await form.getByLabel('연락처').fill('010-5555-4444')
      await form.getByLabel('주소', { exact: true }).fill('부산광역시 해운대구 센텀로 1')
      await form.getByRole('button').first().click()
      await expect(buyer.getByRole('heading', { level: 1 })).toBeVisible()
      // 거절 쪽("이 양식은 받을 수 없어요…")이 아니라 "배송지를 받았어요"여야 한다
      await expect(buyer.getByText('이 양식은 받을 수 없어요. 링크를 다시 열어 주세요.'), `Referrer-Policy=${policy} · 브라우저가 보낸 Origin=${origins.join(',')}`).toHaveCount(0)
      await expect(buyer.getByText('배송지를 받았어요')).toBeVisible()
    } finally {
      await buyer.context().close()
    }
  })
})

test.describe('AC-T1-71 구매자 링크 양식은 스크립트 없이', () => {
  test('자바스크립트를 끈 휴대폰에서 틀린 연락처 → 칸 문장(적은 값 다시 채움) → 고쳐서 저장 → "배송지를 받았어요"·이름·끝 4자리만, 가로 스크롤 없음', async ({ page, browser }) => {
    await parcelSeller(page)
    const { date, buyers } = await parcelDayWith(page, { buyers: [{ memo: '가람' }] })
    const url = await makeLink(page, date, buyers[0]!)
    const buyer = await noJsPhone(browser, page)
    try {
      await buyer.goto(url)
      const form = buyer.locator('#address')
      await expect(form.getByText(ADDRESS_NOTE)).toBeVisible()
      await noHorizontalScroll(buyer)
      await form.getByLabel('받는 분').fill('김구매')
      await form.getByLabel('연락처').fill('+82-10-5555-4444')
      await form.getByLabel('주소', { exact: true }).fill('부산광역시 해운대구 센텀로 1')
      await form.getByLabel('배송 메모').fill('경비실')
      await form.getByRole('button').first().click()
      await expect(buyer.getByText('연락처는 010으로 시작하는 숫자로 적어 주세요.')).toBeVisible()
      await expect(buyer.locator('#address').getByLabel('연락처')).toHaveAttribute('aria-invalid', 'true')
      await expect(buyer.locator('#address').getByLabel('주소', { exact: true })).toHaveValue('부산광역시 해운대구 센텀로 1')
      await noHorizontalScroll(buyer)
      await buyer.locator('#address').getByLabel('연락처').fill('010-5555-4444')
      await buyer.locator('#address').getByRole('button').first().click()
      await expect(buyer.getByText('배송지를 받았어요')).toBeVisible()
      const text = await buyer.locator('body').innerText()
      expect(text).toContain('김구매')
      expect(text).toContain('4444')
      expect(text).not.toContain('센텀로')
      expect(text).not.toContain('경비실')
      expect(text).not.toContain('5555')
      await noHorizontalScroll(buyer)
    } finally {
      await buyer.context().close()
    }
    const bundle = (await (await page.request.get(`/api/parcels/days/${date}/bundle?buyer=${encodeURIComponent(buyers[0]!)}`)).json()) as { bundle: { address: { phone: string; source: string; confirmed: boolean; memo: string } } }
    expect(bundle.bundle.address).toMatchObject({ phone: '01055554444', source: 'BUYER', confirmed: false, memo: '경비실' })
  })
})

test.describe('AC-T1-70 구매자 링크 → 확인 → 접수 → 운송장 → 조회', () => {
  test('끝에서 끝', async ({ page, browser }) => {
    test.setTimeout(180_000)
    await parcelSeller(page)
    const { date, b, buyers } = await parcelDayWith(page, { buyers: [{ phone: '010-3900-0001', count: 2 }] })
    const a = buyers[0]!
    await payAll(page, date, a)
    await packAll(page, date, a)
    await endBroadcast(page, b)
    // 영수증 보내기 화면에서 링크 만들기 (N4b 화면)
    const url = await makeLink(page, date, a)

    // 로그인하지 않은 새 브라우저 문맥
    const buyer = await anonymousPhone(browser, page)
    try {
      await buyer.goto(url)
      const form = buyer.locator('#address')
      await form.getByLabel('받는 분').fill('김구매')
      await form.getByLabel('연락처').fill('010-5555-4444')
      await form.getByLabel('주소', { exact: true }).fill('부산광역시 해운대구 센텀로 1')
      await form.getByLabel('상세 주소').fill('1001호')
      await form.getByRole('button').first().click()
      await expect(buyer.getByText('배송지를 받았어요')).toBeVisible()
      await expect(buyer.locator('body')).toContainText('김구매')
      await expect(buyer.locator('body')).toContainText('4444')
      await expect(buyer.locator('body')).not.toContainText('센텀로')

      // 판매자: 묶음 자세히에서 "배송지 확인"
      await page.goto(`/settlements?date=${date}&buyer=${encodeURIComponent(a)}`)
      const region = page.getByRole('region', { name: '배송지', exact: true })
      await expect(region).toContainText('센텀로 1')
      await region.getByRole('button', { name: '배송지 확인' }).click()
      await expect(region).toContainText('확인함')

      // 택배 화면: "1개 택배 접수하기"
      await openParcels(page, date)
      await expect(bookButton(page)).toHaveText('1개 택배 접수하기')
      await bookButton(page).click()
      await page.getByRole('dialog', { name: '택배 접수' }).getByRole('button', { name: '접수하기' }).click()
      await expect(bookedGroup(page).getByRole('listitem')).toHaveCount(1)
      await expect(readyGroup(page).getByRole('checkbox')).toHaveCount(0)
      const row = (await parcelDay(page, date)).booked[0]!
      const invoice = row.parcel!.invoice!
      await expect(bookedGroup(page)).toContainText(`택배: 접수됨 · ${row.parcel!.invoiceText!}`)

      // 판매대장 배송 칸
      await page.goto(`/settlements?date=${date}`)
      await page.getByRole('group', { name: '정산 문서' }).getByRole('button', { name: '판매대장 엑셀' }).click()
      const led = page.getByRole('dialog', { name: '판매대장 엑셀' })
      const [xlsx] = await Promise.all([page.waitForEvent('download'), led.getByRole('button', { name: '엑셀 내려받기' }).click()])
      const rows = await xlsxRows(await downloadBytes(xlsx))
      const shipCol = rows[0]!.indexOf('배송')
      expect(rows.slice(1).map((r) => r[shipCol])).toEqual([`배송 완료 · 송장 ${invoice}`, `배송 완료 · 송장 ${invoice}`])

      // 운송장 PDF: 파일이 PDF이고 송장번호 글이 들어 있다
      await openParcels(page, date)
      const [pdf] = await Promise.all([page.waitForEvent('download'), bookedGroup(page).getByRole('group', { name: `${row.name} 택배` }).getByRole('button', { name: '운송장 PDF' }).click()])
      const bytes = await downloadBytes(pdf)
      expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
      expect(await pdfText(bytes)).toContain(row.parcel!.invoiceText!)

      // 배송 중으로 넘기고 조회 → 구매자 링크·판매자 화면
      await fakeParcel(page, 'status', { invoice, status: 'IN_TRANSIT' })
      await fakeParcel(page, 'track')
      await expect.poll(async () => (await rowOf(page, date, a)).parcel?.status).toBe('배송 중')
      await buyer.goto(url)
      const parcel = buyer.locator('#parcel')
      await expect(parcel).toContainText('택배를 보냈어요')
      await expect(parcel).toContainText('배송 중')
      await expect(parcel).toContainText(row.parcel!.invoiceText!)
      const track = parcel.getByRole('link', { name: '배송 조회' })
      await expect(track).toHaveAttribute('target', '_blank')
      await expect(track).toHaveAttribute('rel', /noopener/)
      await expect(buyer.locator('#address form, form[action$="/address"]')).toHaveCount(0)
      await openParcels(page, date)
      await expect(bookedGroup(page)).toContainText(`택배: 배송 중 · ${row.parcel!.invoiceText!}`)
    } finally {
      await buyer.context().close()
    }
  })
})

/** PDF 글 (pdfjs — 문서 패키지 devDependency) */
async function pdfText(bytes: Buffer): Promise<string> {
  const { createRequire } = await import('node:module')
  const req = createRequire(createRequire(import.meta.url).resolve('@livejjim/documents'))
  const path = req.resolve('pdfjs-dist/legacy/build/pdf.mjs')
  const pdfjs = (await import(path)) as { getDocument: (o: { data: Uint8Array }) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: { str?: string }[] }> }> }> } }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise
  let out = ''
  for (let n = 1; n <= doc.numPages; n++) out += (await (await doc.getPage(n)).getTextContent()).items.map((i) => i.str ?? '').join(' ')
  return out
}
