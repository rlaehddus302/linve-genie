// 수정 라운드 1 다시 공격 (test-e2e): 빠른 입력 미룬 줄(TE-S05-001 수정)의 남은 구멍, 사유 고치기(UX-S05-002).
// 기대값은 acceptance.md(AC-S05-10·13·34·42) 문장에서 정했다.
import { test, expect, type Page } from '@playwright/test'
import { boardItem, history, login, newBroadcast, openNewBroadcast, register, sendViewerChat, uniqueDate } from './support.ts'

async function slowWrites(page: Page, ms: number): Promise<void> {
  await page.route('**/api/events**', async (route) => {
    await new Promise((r) => setTimeout(r, ms))
    await route.continue()
  })
}

test('TE-S05-002: 응답이 느린 동안 같은 번호 줄을 다시 치고 이어서 다음 줄을 쳐도, 늦게 뜬 "고칠까요?"가 치던 줄을 빼앗지 않는다', async ({ page }) => {
  // 판매자가 61을 등록하고 바로 품종을 바꿔 다시 친다(같은 번호 → AC-S05-13 "고칠까요?"). 그 줄은 앞 등록 응답을 기다렸다가 판단된다.
  // 그사이 판매자는 다음 상품 62·63을 이어 친다(AC-S05-10 "빠르게 연달아 친 줄이 모두 순서대로 등록"). 미룬 찾기·오류는
  // 치는 중이면 창·커서를 빼앗지 않는데, 미룬 "고칠까요?"는 창을 띄워 포커스를 가져가 62 줄이 반쯤 사라진다.
  await login(page)
  const date = uniqueDate()
  await newBroadcast(page, { date })
  await slowWrites(page, 500)
  const input = page.getByLabel('빠른 입력')
  for (const line of ['61 꽃 1만', '61 장미 2만', '62 꽃 1만', '63 꽃 1만']) {
    await input.pressSequentially(line, { delay: 40 })
    await input.press('Enter')
  }
  await expect(boardItem(page, 62)).toBeVisible()
  await expect(boardItem(page, 63)).toBeVisible()
  const events = await history(page, date, false)
  expect(events.filter((e) => e.type === 'product.register').map((e) => e.fields['no'])).toEqual([61, 62, 63])
  // "고칠까요?"에 판매자가 답한 적이 없다: 61은 고쳐지지 않는다
  expect(events.filter((e) => e.type === 'product.update')).toEqual([])
})

test('AC-S05-10 회귀: 응답이 느릴 때(500ms) 번호 찾기 줄을 사이에 끼워 이어 쳐도 등록이 빠지지 않는다', async ({ page }) => {
  await login(page)
  const date = uniqueDate()
  await newBroadcast(page, { date })
  await slowWrites(page, 500)
  const input = page.getByLabel('빠른 입력')
  for (const line of ['71 꽃 1만', '71', '72 꽃 1만', '73 꽃 1만']) {
    await input.pressSequentially(line, { delay: 40 })
    await input.press('Enter')
  }
  for (const no of [71, 72, 73]) await expect(boardItem(page, no)).toBeVisible()
  const events = (await history(page, date, false)).filter((e) => e.type === 'product.register')
  expect(events.map((e) => e.fields['no'])).toEqual([71, 72, 73])
})

test('AC-S05-34 / UX-S05-002: 빠른 입력을 치는 중에 사유가 거절되면 글자를 빼앗지 않고 "사유 고치기" → 고친 사유로 한 번만 보낸다', async ({ page }) => {
  await login(page)
  const date = uniqueDate()
  const b = await openNewBroadcast(page, { date, rehearsal: true })
  await register(page, '15 핑크프릴 10000', 15)
  await sendViewerChat(page, b, '홍길동', '15')
  await expect(boardItem(page, 15)).toContainText('홍길동')
  await boardItem(page, 15).click()
  await page.getByRole('dialog', { name: '15번 자세히' }).getByRole('region', { name: '1등' }).getByRole('button', { name: '취소' }).click()
  const dlg = page.getByRole('dialog', { name: '15번 홍길동 취소' })
  await dlg.getByLabel('사유').fill('010-1234-5678 로 연락 옴')
  await dlg.getByLabel('사유').press('Enter')
  await expect(dlg).toHaveCount(0)
  const input = page.getByLabel('빠른 입력')
  await expect(input).toBeFocused()
  await input.pressSequentially('16 장미', { delay: 30 })
  const fixBtn = page.getByRole('button', { name: '15번 홍길동 취소 사유 고치기' })
  await expect(fixBtn).toBeVisible({ timeout: 15_000 })
  await expect(input).toBeFocused()
  await expect(input).toHaveValue('16 장미')
  await fixBtn.click()
  const again = page.getByRole('dialog', { name: '15번 홍길동 취소' })
  await expect(again.getByRole('button', { name: '닫기' })).toBeFocused()
  await expect(again.getByLabel('사유')).toHaveValue('010-1234-5678 로 연락 옴')
  await again.getByLabel('사유').fill('시청자 요청')
  await again.getByLabel('사유').press('Enter')
  await expect(boardItem(page, 15)).not.toContainText('홍길동', { timeout: 15_000 })
  // 치던 줄은 그대로 남아 있다
  await expect(input).toHaveValue('16 장미')
  const cancels = (await history(page, date, true)).filter((e) => e.type === 'host.cancel')
  expect(cancels).toHaveLength(1)
  expect(cancels[0]!.reason).toBe('시청자 요청')
})
