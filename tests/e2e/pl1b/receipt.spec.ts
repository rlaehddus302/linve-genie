// PL1B 간이과세자 증빙 흐름 (SPEC BIL-01, BILLING_RULES BL-8·BL-9, D-PL1-07) — test-e2e, 요금 기능을 켠 묶음(@billing).
// AC-PL1B-08: 사업자 정보를 적고 저장 → 계좌이체로 이용권을 산다(시험 결제 창). AC-PL1B-05·06의 칸·문장을 화면에서 본다.
// 새 판매자로 돈다(N5 시험이 쌓는 공용 계정 상태와 섞이지 않게). 기대 문장은 acceptance.md 따옴표 그대로.
import { expect, test, type Page, type Request } from '@playwright/test'
import { loginNewSeller } from '../i3/support.ts'
import { buy, noHorizontalScroll, openBilling, payResult, statusCell } from '../n5/support.ts'

const RECEIPT_LINE = '계좌이체 증빙: 현금영수증(지출증빙)'
const NO_TAX_INVOICE = '세금계산서는 지금은 발급할 수 없어요. 카드로 결제하면 카드 매출전표가 증빙이에요.'

function recordBusinessSaves(page: Page): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  page.on('request', (req: Request) => {
    if (req.method() === 'PUT' && new URL(req.url()).pathname === '/api/billing/business') out.push(JSON.parse(req.postData() ?? '{}') as Record<string, unknown>)
  })
  return out
}

for (const width of [1440, 375] as const) {
  test(`AC-PL1B-05·08 ${String(width)}px: 사업자 정보 칸에 고르기(라디오) 없음·안내 두 줄·"증빙 받을 이메일 (선택)", 저장 본문 receiptKind 없거나 CASH_RECEIPT, 보기 칸 "현금영수증(지출증빙)" @billing`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 })
    await loginNewSeller(page)
    const saves = recordBusinessSaves(page)
    await openBilling(page)
    await page.getByRole('button', { name: '사업자 정보 적기' }).click()
    const biz = page.getByRole('form', { name: '사업자 정보' })
    await expect(biz.getByLabel('사업자등록번호')).toBeFocused()
    await expect(biz.getByRole('radio')).toHaveCount(0)
    await expect(biz.getByRole('group', { name: '계좌이체 증빙' })).toHaveCount(0)
    await expect(biz.getByText(RECEIPT_LINE, { exact: true })).toBeVisible()
    await expect(biz.getByText(NO_TAX_INVOICE, { exact: true })).toBeVisible()
    await expect(biz.getByLabel('증빙 받을 이메일 (선택)')).toBeVisible()
    await expect(page.getByText('세금계산서 받을 이메일')).toHaveCount(0)
    if (width === 375) await noHorizontalScroll(page)

    await biz.getByLabel('사업자등록번호').fill('123-45-67891')
    await biz.getByLabel('상호').fill('다육이네')
    await biz.getByLabel('대표자 이름').fill('김다육')
    await biz.getByLabel('증빙 받을 이메일 (선택)').fill('shop@example.com')
    await biz.getByRole('button', { name: '저장' }).click()
    await expect(biz).toHaveCount(0)
    expect(saves).toHaveLength(1)
    expect(saves[0]!['receiptKind'] === undefined || saves[0]!['receiptKind'] === 'CASH_RECEIPT', JSON.stringify(saves[0])).toBe(true)

    // 보기 칸
    const facts = page.locator('dl').filter({ has: page.locator('dt', { hasText: /^계좌이체 증빙$/ }) })
    await expect(facts.locator('dt', { hasText: /^증빙 받을 이메일$/ })).toHaveCount(1)
    const kind = facts.locator('dt', { hasText: /^계좌이체 증빙$/ }).locator('xpath=following-sibling::dd[1]')
    await expect(kind).toHaveText('현금영수증(지출증빙)')
    await expect(page.getByText('세금계산서 받을 이메일')).toHaveCount(0)
    expect((await (await page.request.get('/api/billing')).json() as { business: { receiptKind: string } }).business.receiptKind).toBe('CASH_RECEIPT')
    if (width === 375) await noHorizontalScroll(page)
  })
}

test('AC-PL1B-06·08: 계좌이체 결제 전 "현금영수증(지출증빙)을 발행해요." → 시험 결제 창 → 결제 내역 "현금영수증 발행됨 · TEST-…", 공급가액·세액 숫자 없음 @billing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await loginNewSeller(page)
  await openBilling(page)
  await page.getByRole('button', { name: '사업자 정보 적기' }).click()
  const biz = page.getByRole('form', { name: '사업자 정보' })
  await biz.getByLabel('사업자등록번호').fill('123-45-67891')
  await biz.getByLabel('상호').fill('다육이네')
  await biz.getByLabel('대표자 이름').fill('김다육')
  await biz.getByRole('button', { name: '저장' }).click()
  await expect(biz).toHaveCount(0)

  // 결제 전 안내: 카드일 때는 계좌이체 증빙 문장이 아니고, 계좌이체를 고르면 그 문장
  await page.getByRole('button', { name: '방송 일권 1일 사기' }).click()
  const dlg = page.getByRole('dialog', { name: '방송 일권 1일 사기' })
  await expect(dlg).toContainText('방송 일권 1일 · 5,000원 (부가세 포함)')
  await dlg.getByRole('radio', { name: '계좌이체' }).check()
  await expect(dlg).toContainText('현금영수증(지출증빙)을 발행해요.')
  await expect(dlg).not.toContainText('세금계산서(또는 현금영수증)')
  await expect(dlg).not.toContainText(/공급가액|세액|4,545원|455원/)
  await dlg.getByRole('button', { name: '닫기' }).click()
  await expect(dlg).toHaveCount(0)

  await buy(page, '방송 일권 1일', '결제 완료(계좌이체)', '계좌이체')
  await expect(payResult(page).getByRole('status')).toHaveText('결제했어요. 방송 일권 1일을 받았어요.')
  await expect(statusCell(page, '방송 일권')).toContainText('남은 1일')
  const row = page.getByRole('table', { name: '결제 내역' }).getByRole('row').filter({ hasText: '방송 일권 1일' })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('계좌이체')
  await expect(row).toContainText(/현금영수증 발행됨 · TEST-\S+/)
  await expect(row).not.toContainText('세금계산서')
  await expect(page.getByRole('table', { name: '결제 내역' })).not.toContainText(/공급가액|세액/)
})
