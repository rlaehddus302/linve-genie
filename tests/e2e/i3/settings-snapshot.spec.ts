// I3 — 설정을 바꾼 뒤 같은 날 새 방송만 새 규칙 (기본 묶음, G-ENG-701). AC-I3-46·44
import { expect, test } from '@playwright/test'
import { loginNewSeller, registerApi, scopeView, settingsRegion, smsApi } from './support.ts'
import { expectTarget, menuLink, moreButton, openMore } from '../menu.ts'

test('AC-I3-46: 대기 인원 5 → 1 저장 → 진행 중인 1부 상품엔 셋째 찜이 대기로, 새 2부 상품에선 셋째 찜이 대기에 못 들어감', async ({ page }) => {
  await loginNewSeller(page)
  const origin = new URL(page.url()).origin
  const make = async (title: string) => {
    const res = await page.request.post('/api/broadcasts', { data: { requestId: crypto.randomUUID(), rehearsal: false, title }, headers: { Origin: origin } })
    expect(res.ok(), await res.text()).toBe(true)
    return (await res.json() as { broadcast: { id: string; date: string } }).broadcast
  }
  const one = await make('규칙 1부')
  await registerApi(page, one.id, 71, '일부상품', 10000)
  await page.goto('/settings')
  await expect(settingsRegion(page, '판매 규칙')).toBeVisible()
  await expect(page.getByRole('note').filter({ hasText: '진행 중인 방송에는 바뀐 규칙이 적용되지 않아요.' })).toBeVisible()
  await settingsRegion(page, '판매 규칙').getByLabel('대기 인원 (0이면 대기 없음)').fill('1')
  await page.getByRole('region', { name: '저장', exact: true }).getByRole('button', { name: '저장' }).click() // FB1 D-FB1-06
  await expect(page.getByRole('region', { name: '저장', exact: true }).getByText('저장했어요. 바꾼 규칙은 다음에 시작하는 방송부터 적용돼요.')).toBeVisible() // FB1 D-FB1-06
  const two = await make('규칙 2부')
  await registerApi(page, two.id, 72, '이부상품', 10000)
  for (const [i, phone] of ['010-7000-0001', '010-7000-0002', '010-7000-0003'].entries()) {
    await smsApi(page, { b: one.id, no: 71, phone, memo: `일${String(i)}` })
    await smsApi(page, { b: two.id, no: 72, phone, memo: `이${String(i)}` })
  }
  const view = await scopeView(page, one.date, false)
  const p1 = view.products.find((p) => p.no === 71 && p.key.startsWith(one.id))!
  const p2 = view.products.find((p) => p.no === 72 && p.key.startsWith(two.id))!
  expect(p1.winners).toHaveLength(1)
  expect(p1.waitlist).toHaveLength(2)
  expect(p2.winners).toHaveLength(1)
  expect(p2.waitlist).toHaveLength(1)
})

test('AC-I3-44·AC-NAV-04: 설정 메뉴 aria-current — 375px는 "더보기"가 지금 위치, 목록을 열면 "설정"이 지금 위치·44px·가로 스크롤 없음', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await loginNewSeller(page)
  await page.goto('/settings/youtube')
  await expect(moreButton(page)).toHaveAttribute('aria-current', 'page')
  await openMore(page)
  const link = menuLink(page, '설정')
  await expect(link).toHaveAttribute('aria-current', 'page')
  await expectTarget(page, link)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
})
