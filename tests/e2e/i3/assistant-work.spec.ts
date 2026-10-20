// I3 — 보조자의 문자찜 입력이 판매자와 같게 돈다 (기본 묶음). AC-I3-63·61
import { expect, test } from '@playwright/test'
import { loginAs, loginNewSeller, registerApi, smsUi } from './support.ts'

test('AC-I3-63: 보조자 — 판매자가 방금 등록한 상품에 문자찜 → 결과 카드 1등 → 찜 취소하기(사유·대기) → 취소됨, 403·화면 오류 없음', async ({ page, browser }) => {
  await loginNewSeller(page)
  const origin = new URL(page.url()).origin
  const created = await page.request.post('/api/broadcasts', { data: { requestId: crypto.randomUUID(), rehearsal: false, title: '보조 작업 방송' }, headers: { Origin: origin } })
  const b = (await created.json() as { broadcast: { id: string } }).broadcast.id
  const res = await page.request.post('/api/assistants', { data: { name: '작업자' }, headers: { Origin: origin } })
  const { assistant, password } = await res.json() as { assistant: { loginId: string }; password: string }
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } })
  const phone = await ctx.newPage()
  const bad: string[] = []
  phone.on('response', (r) => {
    if (r.status() === 403 || r.status() >= 500) bad.push(`${String(r.status())} ${r.url()}`)
  })
  phone.on('pageerror', (e) => bad.push(`pageerror ${e.message}`))
  await loginAs(phone, { loginId: assistant.loginId, password })
  await expect(phone.getByRole('region', { name: '고른 방송' })).toContainText('보조 작업 방송')
  await expect(phone.getByRole('region', { name: '최근 넣은 문자찜' })).toBeVisible()
  // 보조자 화면이 열린 뒤 판매자가 상품을 등록한다 (실시간 범위 변경으로 받는다)
  await registerApi(page, b, 15, '핑크프릴', 10000)
  await smsUi(phone, { no: 15, memo: '박씨' })
  const result = phone.getByRole('region', { name: '넣은 결과' })
  await expect(result).toContainText('1등')
  await result.getByRole('button', { name: '찜 취소하기' }).click()
  await phone.keyboard.press('1')
  await phone.keyboard.press('Enter')
  await expect(result).toContainText('취소됨', { timeout: 15_000 })
  expect(bad).toEqual([])
  await ctx.close()
})
