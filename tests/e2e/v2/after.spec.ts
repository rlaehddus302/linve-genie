// V2 등록 뒤 고치기·되돌리기와 음성 기록 보기 (AC-V2-26·27·28·29·30). 기대 문장은 acceptance 글자 그대로.
import { test, expect } from '@playwright/test'
import { boardItem, card, cardButton, expectNoCards, offerList, openLog, recordRequests, sayAt, setupV2 } from './support.ts'

async function registerS1(page: import('@playwright/test').Page) {
  await sayAt(page, [['15번 핑크문 만오천원', 0]])
  await page.clock.runFor(1800)
  await cardButton(page, '15번 핑크문 15,000원', '등록').click()
  await expect(boardItem(page, 15)).toContainText('15,000원')
}

const OFFER = '방금 등록한 15번 핑크문을 18,000원으로 고칠까요?'

test('S19 AC-V2-26: 40초 뒤 "만오천 말고 만팔천" → 고칠까요 카드, [그대로 두기]면 그대로', async ({ page }) => {
  await setupV2(page)
  await registerS1(page)
  await page.clock.runFor(40_000)
  await sayAt(page, [['만오천 말고 만팔천', 0]])
  await page.clock.runFor(1800)
  const offer = offerList(page).getByRole('listitem', { name: OFFER })
  await expect(offer).toBeVisible()
  await expectNoCards(page)
  await expect(boardItem(page, 15)).toContainText('15,000원')
  await offer.getByRole('button', { name: '그대로 두기' }).click()
  await expect(offer).toHaveCount(0)
  await expect(boardItem(page, 15)).toContainText('15,000원')
})

test('S19 AC-V2-26: [고치기]면 18,000원, 10초 안 [되돌리기]면 15,000원', async ({ page }) => {
  await setupV2(page)
  await registerS1(page)
  await page.clock.runFor(40_000)
  await sayAt(page, [['만오천 말고 만팔천', 0]])
  await page.clock.runFor(1800)
  const list = offerList(page)
  await list.getByRole('listitem', { name: OFFER }).getByRole('button', { name: '고치기' }).click()
  await expect(boardItem(page, 15)).toContainText('18,000원')
  await list.getByRole('button', { name: '되돌리기' }).click()
  await expect(boardItem(page, 15)).toContainText('15,000원')
})

test('S20 AC-V2-27: 70초 뒤 정정은 아무것도 안 바꿈, "고칠 카드가 없어요"는 기록에', async ({ page }) => {
  await setupV2(page)
  await registerS1(page)
  await page.clock.runFor(70_000)
  await sayAt(page, [['만오천 말고 만팔천', 0]])
  await page.clock.runFor(1800)
  await expectNoCards(page)
  await expect(offerList(page).getByRole('listitem')).toHaveCount(0)
  await expect(boardItem(page, 15)).toContainText('15,000원')
  const dlg = await openLog(page)
  await expect(dlg.getByRole('list', { name: '음성 기록 목록' }).getByRole('listitem').first()).toContainText('고칠 카드가 없어요')
})

test('AC-V2-27: 등록 뒤 "아니 16번" → 번호 안내만, "취소" → 5초 안이면 되돌릴까요, 지나면 시간 지남', async ({ page }) => {
  await setupV2(page)
  await registerS1(page)
  await sayAt(page, [['취소', 0]])
  await page.clock.runFor(1800)
  const undo = offerList(page).getByRole('listitem', { name: '방금 등록한 15번 핑크문을 되돌릴까요?' })
  await expect(undo).toBeVisible()
  await undo.getByRole('button', { name: '그대로 두기' }).click()
  await page.clock.runFor(10_000)
  await sayAt(page, [['아니 16번', 0]])
  await page.clock.runFor(1800)
  await expect(offerList(page).getByText('번호는 상품 목록에서 고쳐 주세요')).toBeVisible()
  await expect(boardItem(page, 15)).toBeVisible()
  await expect(boardItem(page, 16)).toHaveCount(0)
  await sayAt(page, [['취소', 0]])
  await page.clock.runFor(1800)
  await expect(offerList(page).getByText('되돌릴 시간이 지났어요. 상품 목록에서 고쳐 주세요.')).toBeVisible()
  await expect(boardItem(page, 15)).not.toContainText('판매 종료')
})

test('AC-V2-28·29·30: S2·S9·S18 뒤 음성 기록 3개(새것부터), 서버·저장소·콘솔에 받아쓴 글 없음, 기록 지우기, 새로 고치면 빔', async ({ page }) => {
  const logs: string[] = []
  page.on('console', (m) => logs.push(m.text()))
  const requests = recordRequests(page)
  await setupV2(page)
  await sayAt(page, [['십오번', 0], ['엘레강스', 1200], ['이만원', 2500]])
  await page.clock.runFor(1800)
  await expect(card(page, '15번 엘레강스 20,000원')).toBeVisible()
  await sayAt(page, [['19번 선버스 팔천원', 0]])
  await page.clock.runFor(1800)
  await expect(card(page, '19번 품종 미입력 8,000원')).toBeVisible()
  await sayAt(page, [['아니 이거 너무 예쁘죠', 0]])
  await page.clock.runFor(1800)
  const dlg = await openLog(page)
  const items = dlg.getByRole('list', { name: '음성 기록 목록' }).getByRole('listitem')
  await expect(items).toHaveCount(3)
  await expect(items.nth(0)).toContainText('아니 이거 너무 예쁘죠')
  await expect(items.nth(0)).toContainText('번호와 가격이 안 들렸어요')
  await expect(items.nth(1)).toContainText('선버스트 77점')
  await expect(items.nth(2)).toContainText('십오번')
  await expect(items.nth(2)).toContainText('엘레강스')
  await expect(items.nth(2)).toContainText('이만원')
  for (const word of ['엘레강스 이만원', '십오번', '선버스', '너무 예쁘죠']) {
    for (const r of requests) {
      expect(decodeURIComponent(r.url)).not.toContain(word)
      expect(r.body).not.toContain(word)
    }
    for (const l of logs) expect(l).not.toContain(word)
  }
  const stored = await page.evaluate(() => JSON.stringify({ ...window.localStorage }) + JSON.stringify({ ...window.sessionStorage }))
  for (const word of ['십오번', '이만원', '너무 예쁘죠', '팔천원']) expect(stored).not.toContain(word)
  await dlg.getByRole('button', { name: '기록 지우기' }).click()
  await expect(dlg.getByText('아직 기록이 없어요.')).toBeVisible()
  // 새로 고치면 빈 기록
  await page.keyboard.press('Escape')
  await page.clock.resume()
  await page.reload()
  await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
  const dlg2 = await openLog(page)
  await expect(dlg2.getByText('아직 기록이 없어요.')).toBeVisible()
})
