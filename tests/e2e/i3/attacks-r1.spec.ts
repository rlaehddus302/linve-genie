// I3 라운드 1 공격 (test-e2e). 수정 라운드 1에서 바뀐 곳(마법사 저장하지 않은 값 묻기)과 가게 이름 검사를 다시 친다.
import { expect, test } from '@playwright/test'
import { loginAs, newSeller } from './support.ts'

test.describe('라운드 1 공격', () => {
  test('TE-I3-005 AC-I3-47: 가게 이름 가운데의 줄 나눔 글자(U+2028·U+2029)는 줄바꿈이라 400 — 위 줄 가게 이름이 두 줄로 저장되지 않는다', async ({ page }) => {
    const seller = await newSeller(page.request)
    await loginAs(page, seller)
    for (const name of ['가게 이름', '가게 이름']) {
      const res = await page.request.put('/api/shop', { data: { name }, headers: { Origin: new URL(page.url()).origin } })
      expect(res.status(), `${JSON.stringify(name)} → ${await res.text()}`).toBe(400)
      const body = await res.json() as { error: { message: string } }
      expect(body.error.message).toBe('가게 이름은 1~30자로 적어 주세요.')
    }
    const me = await (await page.request.get('/api/me')).json() as { seller: { name: string } }
    expect(me.seller.name).toBe(seller.shopName)
  })

  test('UX-I3-001 회귀: 마법사 2단계에서 칸 값을 바꾼 채 메뉴 "설정" → 같은 떠나기 창, "닫기"면 그 단계에 값 그대로 남고 설정은 바뀌지 않는다', async ({ page }) => {
    const seller = await newSeller(page.request)
    // 방송이 없는 새 판매자는 로그인하면 마법사가 저절로 열린다 (같은 문서 안의 이동 — 뒤로는 앱이 받는다)
    await loginAs(page, seller)
    await expect(page.getByRole('heading', { level: 2, name: '1/5 가게 이름' })).toBeVisible()
    await page.getByRole('button', { name: '다음' }).click()
    await expect(page.getByRole('heading', { level: 2, name: '2/5 판매 규칙 확인' })).toBeVisible()
    const before = await (await page.request.get('/api/settings')).json() as { settings: Record<string, unknown> }
    await page.getByRole('button', { name: '기본 배송비 바꾸기' }).click()
    const field = page.getByLabel('기본 배송비 (원)')
    await field.fill('4321')
    await page.getByRole('navigation', { name: '메뉴' }).getByRole('link', { name: '설정' }).click()
    const dialog = page.getByRole('dialog', { name: '다른 화면으로 갈까요?' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('저장하지 않은 값이 있어요. 떠나면 저장하지 않아요.')
    await dialog.getByRole('button', { name: '닫기' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('heading', { level: 2, name: '2/5 판매 규칙 확인' })).toBeVisible()
    await expect(field).toHaveValue('4321')
    const after = await (await page.request.get('/api/settings')).json() as { settings: Record<string, unknown> }
    expect(after.settings).toEqual(before.settings)
    // "나중에 할게요"도 묻고, 떠나면 저장하지 않는다
    await page.getByRole('button', { name: '나중에 할게요' }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '저장하지 않고 떠나기' }).click()
    await expect(page).toHaveURL(/\/$/)
    const final = await (await page.request.get('/api/settings')).json() as { settings: Record<string, unknown> }
    expect(final.settings).toEqual(before.settings)
    const wizard = await (await page.request.get('/api/wizard')).json() as { wizard: { status: string } }
    expect(wizard.wizard.status).toBe('DISMISSED')
  })
})
