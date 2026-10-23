// T1 묶음 자세히의 배송지 칸·택배 줄 (AC-T1-65, AC-T1-13 화면 쪽, PC-3·PC-8) — test-e2e.
import { test, expect, type Page } from '@playwright/test'
import { ADDRESS, ADDRESS_NOTE, bookApi, fakeParcel, LOCKED_TEXT, makeReady, packAll, parcelDayWith, parcelSeller, payAll, postJson, rowOf, sellerAddress, writeEvent } from './support.ts'

function addressRegion(page: Page) {
  return page.getByRole('region', { name: '배송지', exact: true })
}

async function openDetail(page: Page, date: string, buyer: string): Promise<void> {
  await page.goto(`/settlements?date=${date}&buyer=${encodeURIComponent(buyer)}`)
  await expect(addressRegion(page)).toBeVisible()
  await expect(addressRegion(page).getByText('배송지를 불러오는 중…')).toHaveCount(0)
}

/** 구매자 링크로 배송지 적기 (서버 양식, 로그인 없음) */
async function buyerWrites(page: Page, date: string, buyer: string, fields: Record<string, string>): Promise<number> {
  const made = await postJson(page, `/api/days/${date}/receipt-links`, { requestId: crypto.randomUUID(), buyer })
  expect(made.status, JSON.stringify(made.body)).toBe(200)
  const origin = new URL(page.url()).origin
  const res = await page.request.post(`${origin}${new URL((made.body['link'] as { url: string }).url).pathname}/address`, { form: fields, headers: { Origin: origin }, maxRedirects: 0 })
  return res.status()
}

test.describe('AC-T1-65 묶음 자세히의 배송지 칸', () => {
  test('없음 → "배송지 적기"(여섯 칸, 틀리면 칸마다 문장) → 저장하면 여섯 칸·"판매자가 적었어요"·"확인함" → 고치기 → 지우기(확인 창)', async ({ page }) => {
    await parcelSeller(page)
    const { date, buyers } = await parcelDayWith(page, { buyers: [{ memo: '가람' }] })
    const buyer = buyers[0]!
    await openDetail(page, date, buyer)
    const region = addressRegion(page)
    await expect(region.getByText('배송지가 없어요')).toBeVisible()
    await expect(region.getByText('구매자 확인서 링크에서 구매자가 직접 적을 수도 있어요.')).toBeVisible()
    await region.getByRole('button', { name: '배송지 적기' }).click()
    const dlg = page.getByRole('dialog', { name: '배송지 적기' })
    for (const label of ['받는 분', '연락처', '주소', '상세 주소', '우편번호(몰라도 돼요)', '배송 메모']) await expect(dlg.getByLabel(label, { exact: true })).toBeVisible()
    // 틀린 값: 연락처·주소
    await dlg.getByLabel('받는 분', { exact: true }).fill(ADDRESS.name)
    await dlg.getByLabel('연락처', { exact: true }).fill('+82 10 1234 5678')
    await dlg.getByRole('button', { name: '저장' }).click()
    await expect(dlg.getByText('연락처는 010으로 시작하는 숫자로 적어 주세요.')).toBeVisible()
    await expect(dlg.getByText('주소를 적어 주세요.')).toBeVisible()
    await expect(dlg.getByLabel('연락처', { exact: true })).toHaveAttribute('aria-invalid', 'true')
    await expect(dlg.getByLabel('주소', { exact: true })).toHaveAttribute('aria-invalid', 'true')
    await expect(dlg.getByLabel('받는 분', { exact: true })).toHaveAttribute('aria-invalid', 'false')
    // 고쳐서 저장
    await dlg.getByLabel('연락처', { exact: true }).fill(ADDRESS.phone)
    await dlg.getByLabel('주소', { exact: true }).fill(ADDRESS.address)
    await dlg.getByLabel('상세 주소', { exact: true }).fill(ADDRESS.detail)
    await dlg.getByLabel('우편번호(몰라도 돼요)', { exact: true }).fill(ADDRESS.zip)
    await dlg.getByLabel('배송 메모', { exact: true }).fill(ADDRESS.memo)
    await dlg.getByRole('button', { name: '저장' }).click()
    await expect(dlg).toHaveCount(0)
    for (const text of [ADDRESS.name, '010-1234-5678', ADDRESS.address, ADDRESS.detail, ADDRESS.zip, ADDRESS.memo, '판매자가 적었어요', '확인함']) await expect(region).toContainText(text)
    await expect(region.getByRole('button', { name: '배송지 확인' })).toHaveCount(0)
    // 고치기: 지금 값이 채워진 창
    await region.getByRole('button', { name: '고치기' }).click()
    const edit = page.getByRole('dialog', { name: '배송지 고치기' })
    await expect(edit.getByLabel('주소', { exact: true })).toHaveValue(ADDRESS.address)
    await edit.getByLabel('상세 주소', { exact: true }).fill('303동 404호')
    await edit.getByRole('button', { name: '저장' }).click()
    await expect(edit).toHaveCount(0)
    await expect(region).toContainText('303동 404호')
    await expect(region).not.toContainText(ADDRESS.detail)
    // 지우기
    await region.getByRole('button', { name: '지우기' }).click()
    const del = page.getByRole('dialog', { name: '배송지 지우기' })
    await del.getByRole('button', { name: '지우기' }).click()
    await expect(region.getByText('배송지가 없어요')).toBeVisible()
    const after = (await (await page.request.get(`/api/parcels/days/${date}/bundle?buyer=${encodeURIComponent(buyer)}`)).json()) as { bundle: { address: unknown } }
    expect(after.bundle.address).toBeNull()
  })

  test('구매자가 적은 배송지: "구매자가 적었어요"·"확인 전" → "배송지 확인" → "확인함", 그 뒤 택배 목록에서 고를 수 있음', async ({ page }) => {
    await parcelSeller(page)
    const { date, buyers } = await parcelDayWith(page, { buyers: [{ memo: '가람' }] })
    const buyer = buyers[0]!
    await payAll(page, date, buyer)
    await packAll(page, date, buyer)
    expect(await buyerWrites(page, date, buyer, { name: '김구매', phone: '01055554444', address: '부산광역시 해운대구 센텀로 1', detail: '', zip: '', memo: '' })).toBe(303)
    await openDetail(page, date, buyer)
    const region = addressRegion(page)
    await expect(region).toContainText('구매자가 적었어요')
    await expect(region).toContainText('확인 전')
    await expect(region).toContainText('010-5555-4444')
    expect((await rowOf(page, date, buyer)).reason).toBe('ADDRESS_UNCONFIRMED')
    await region.getByRole('button', { name: '배송지 확인' }).click()
    await expect(region).toContainText('확인함')
    await expect(region.getByRole('button', { name: '배송지 확인' })).toHaveCount(0)
    expect((await rowOf(page, date, buyer)).group).toBe('ready')
  })

  test('보고 있는 사이 구매자가 고치면(화면이 아직 옛 주소) "배송지 확인"은 옛 내용으로 확인하지 않는다 — "구매자가 배송지를 바꿨어요. 다시 확인해 주세요."', async ({ page }) => {
    await parcelSeller(page)
    const { date, buyers } = await parcelDayWith(page, { buyers: [{ memo: '가람' }] })
    const buyer = buyers[0]!
    expect(await buyerWrites(page, date, buyer, { name: '김구매', phone: '01055554444', address: '부산광역시 해운대구 센텀로 1', detail: '', zip: '', memo: '' })).toBe(303)
    // 화면의 다시 읽기는 처음 받은 옛 내용을 그대로 받게 한다 (실시간 알림이 늦거나 빠진 휴대폰)
    let first: string | null = null
    await page.route('**/api/parcels/days/*/bundle?*', async (route) => {
      if (first === null) {
        const res = await route.fetch()
        first = await res.text()
        await route.fulfill({ response: res, body: first })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: first, headers: { 'cache-control': 'no-store' } })
    })
    await openDetail(page, date, buyer)
    const region = addressRegion(page)
    await expect(region).toContainText('센텀로 1')
    expect(await buyerWrites(page, date, buyer, { name: '김구매', phone: '01055554444', address: '부산광역시 해운대구 센텀로 99', detail: '', zip: '', memo: '' })).toBe(303)
    await region.getByRole('button', { name: '배송지 확인' }).click()
    await expect(page.getByText('구매자가 배송지를 바꿨어요. 다시 확인해 주세요.')).toBeVisible()
    const bundle = (await (await page.request.get(`/api/parcels/days/${date}/bundle?buyer=${encodeURIComponent(buyer)}`)).json()) as { bundle: { address: { address: string; confirmed: boolean } } }
    expect(bundle.bundle.address).toMatchObject({ address: '부산광역시 해운대구 센텀로 99', confirmed: false })
  })

  test('접수한 묶음은 고치기·지우기 없이 "택배 접수를 먼저 취소해 주세요.", 정산 줄·포장 모드에 "택배: 배송 중 · 송장"', async ({ page }) => {
    await parcelSeller(page)
    const { date, buyers } = await parcelDayWith(page, { buyers: [{ memo: '가람' }] })
    const buyer = buyers[0]!
    await makeReady(page, date, buyer)
    expect((await bookApi(page, date, [buyer])).status).toBe(200)
    const row = await rowOf(page, date, buyer)
    await fakeParcel(page, 'status', { invoice: row.parcel!.invoice, status: 'IN_TRANSIT' })
    await fakeParcel(page, 'track')
    await expect.poll(async () => (await rowOf(page, date, buyer)).parcel?.status).toBe('배송 중')
    const tag = `택배: 배송 중 · ${row.parcel!.invoiceText!}`
    await openDetail(page, date, buyer)
    const region = addressRegion(page)
    await expect(region).toContainText(LOCKED_TEXT)
    await expect(region.getByRole('button', { name: '고치기' })).toHaveCount(0)
    await expect(region.getByRole('button', { name: '지우기' })).toHaveCount(0)
    await expect(region.getByRole('button', { name: '배송지 확인' })).toHaveCount(0)
    await expect(page.getByText(tag).first()).toBeVisible()
    // 정산 목록 줄
    await page.goto(`/settlements?date=${date}`)
    await expect(page.getByText(tag).first()).toBeVisible()
    // 포장 모드 목록·체크리스트
    await page.goto(`/packing?date=${date}`)
    await page.getByRole('region', { name: '포장 목록' }).getByRole('group', { name: '걸러 보기' }).getByRole('button', { name: '전체' }).click()
    await expect(page.getByRole('region', { name: '포장 목록' }).getByText(tag)).toBeVisible()
    await page.goto(`/packing?date=${date}&buyer=${encodeURIComponent(buyer)}`)
    const cl = page.getByRole('region', { name: '체크리스트' })
    await expect(cl.getByText(tag)).toBeVisible()
    await expect(cl.getByText(LOCKED_TEXT)).toBeVisible()
    for (const name of ['배송 완료로 적기', '송장번호 고치기', '포장 완료 취소', '배송 완료 취소']) await expect(cl.getByRole('button', { name })).toHaveCount(0)
  })

  test('직접 수령·합배송 묶음은 배송지 칸 대신 "직접 수령이에요"/"합배송이에요"', async ({ page }) => {
    await parcelSeller(page)
    const { date, buyers } = await parcelDayWith(page, { buyers: [{ memo: '가람' }, { memo: '나래' }] })
    const scope = { date, rehearsal: false }
    expect((await writeEvent(page, { type: 'settlement.shippingOverride', buyer: buyers[0], date, mode: 'PICKUP' }, scope)).status).toBeLessThan(300)
    expect((await writeEvent(page, { type: 'settlement.shippingOverride', buyer: buyers[1], date, mode: 'COMBINED' }, scope)).status).toBeLessThan(300)
    await openDetail(page, date, buyers[0]!)
    await expect(addressRegion(page)).toContainText('직접 수령이에요')
    await expect(addressRegion(page).getByRole('button', { name: '배송지 적기' })).toHaveCount(0)
    await openDetail(page, date, buyers[1]!)
    await expect(addressRegion(page)).toContainText('합배송이에요')
    await expect(addressRegion(page).getByRole('button', { name: '배송지 적기' })).toHaveCount(0)
  })

  test('이름·주소·메모의 꺾쇠·스크립트는 글자 그대로 (이스케이프)', async ({ page }) => {
    await parcelSeller(page)
    const { date, buyers } = await parcelDayWith(page, { buyers: [{ memo: '가람' }] })
    let fired = false
    page.on('dialog', async (d) => {
      fired = true
      await d.dismiss()
    })
    const evil = { name: '<b onclick=x>굵</b>', phone: '01012345678', address: '<script>alert(2)</script> 서울', detail: '"><b>굵게</b>', zip: '', memo: '<svg onload=alert(3)>' }
    await sellerAddress(page, date, buyers[0]!, evil)
    await openDetail(page, date, buyers[0]!)
    const region = addressRegion(page)
    await expect(region).toContainText(evil.name)
    await expect(region).toContainText(evil.address)
    await expect(region).toContainText(evil.memo)
    await expect(region.locator('img, script, svg, b')).toHaveCount(0)
    expect(fired).toBe(false)
  })
})

test.describe('구매자 링크 쪽 안내 (AC-T1-10 화면 문장)', () => {
  test('양식 위 안내 문장', async ({ page }) => {
    await parcelSeller(page)
    const { date, buyers } = await parcelDayWith(page, { buyers: [{ memo: '가람' }] })
    const made = await postJson(page, `/api/days/${date}/receipt-links`, { requestId: crypto.randomUUID(), buyer: buyers[0] })
    const url = (made.body['link'] as { url: string }).url
    await page.goto(url)
    await expect(page.getByText(ADDRESS_NOTE)).toBeVisible()
  })
})
