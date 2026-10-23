// V2 새 결정 E2E — D-V2-19(말고 앞 값이 카드와 다르면 카드 위 고칠까요), D-V2-20(음성 기록 숫자 8자리 이상 가림). 기대 문장은 acceptance AC-V2-35·37 글자 그대로.
import { test, expect } from '@playwright/test'
import { boardItem, card, cards, openLog, sayAt, setupV2, AUTO_ON } from './support.ts'

const ASK = '12,000원을 18,000원으로 고칠까요?'

for (const choice of ['고치기', '그대로 두기'] as const) {
  test(`AC-V2-35 (D-V2-19): 카드 12,000원에 "만오천 말고 만팔천" → 카드 위 고칠까요, 누르기 전엔 그대로·자동 등록 없음, [${choice}]`, async ({ page }) => {
    await setupV2(page, { settings: AUTO_ON })
    await sayAt(page, [['15번 핑크문 만이천원', 0]])
    await page.clock.runFor(1800)
    await expect(card(page, '15번 핑크문 12,000원').getByText(/초 뒤 자동 등록/)).toBeVisible()
    await page.clock.runFor(1000)
    await sayAt(page, [['만오천 말고 만팔천', 0]])
    await page.clock.runFor(1800)
    const c = card(page, '15번 핑크문 12,000원')
    const ask = c.getByRole('group', { name: ASK })
    await expect(ask).toBeVisible()
    await expect(cards(page)).toHaveCount(1)
    await expect(card(page, '15번 핑크문 18,000원')).toHaveCount(0)
    // 손댄 카드 — 자동 확정 시간이 지나도 등록되지 않는다
    await page.clock.runFor(8000)
    await expect(c).toBeVisible()
    await expect(boardItem(page, 15)).toHaveCount(0)
    await ask.getByRole('button', { name: choice, exact: true }).click()
    const after = card(page, choice === '고치기' ? '15번 핑크문 18,000원' : '15번 핑크문 12,000원')
    await expect(after).toBeVisible()
    await expect(page.getByRole('group', { name: ASK })).toHaveCount(0)
    await page.clock.runFor(8000)
    await expect(after).toBeVisible()
    await expect(boardItem(page, 15)).toHaveCount(0)
  })
}

test('AC-V2-35 (D-V2-19): 카드가 15,000원이면 "만오천 말고 만팔천"은 묻지 않고 바로 18,000원 (S5처럼)', async ({ page }) => {
  await setupV2(page)
  await sayAt(page, [['15번 핑크문 만오천원', 0]])
  await page.clock.runFor(1800)
  await expect(card(page, '15번 핑크문 15,000원')).toBeVisible()
  await page.clock.runFor(1000)
  await sayAt(page, [['만오천 말고 만팔천', 0]])
  await page.clock.runFor(1800)
  await expect(card(page, '15번 핑크문 18,000원')).toBeVisible()
  await expect(page.getByRole('group', { name: /고칠까요\?$/ })).toHaveCount(0)
})

test('AC-V2-37 (D-V2-20): 음성 기록에 전화번호는 •••• — 상품 번호·가격(15·15,000)은 그대로', async ({ page }) => {
  await setupV2(page)
  await sayAt(page, [['끝자리 010-1234-5678 만원', 0]])
  await page.clock.runFor(1800)
  await page.clock.runFor(500)
  await sayAt(page, [['15번 만오천', 0]])
  await page.clock.runFor(1800)
  const dlg = await openLog(page)
  const items = dlg.getByRole('list', { name: '음성 기록 목록' }).getByRole('listitem')
  await expect(items).toHaveCount(2)
  await expect(items.nth(1)).toContainText('••••')
  const text = await dlg.innerText()
  for (const raw of ['1234-5678', '01012345678', '010-1234-5678', '5678']) expect(text).not.toContain(raw)
  await expect(items.nth(0)).toContainText('15번 만오천')
  await expect(items.nth(0)).toContainText('15,000')
})
