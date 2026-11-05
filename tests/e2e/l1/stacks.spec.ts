// AC-L1-20·22·30 켜진 공급자에 따라: 구글 하나만 켠 서버(@social-one → chromium-social-one), 하나도 안 켠 기존 기동(태그 없음 → 기본 chromium).
// AC-L1-13 개인정보처리방침 초안 줄. 기대값은 acceptance.md에서 정했다.
import { expect, test } from '@playwright/test'
import { MSG, decideOnFakePage, fakeUser, linkFromSettings, loginNewSeller, logout, methodsList, methodsRegion, pressContinue, whoAmI } from './support.ts'

test.describe('AC-L1-30 공급자 하나만 켠 서버 @social-one', () => {
  test('로그인 화면엔 "또는"과 구글 버튼 하나 · 꺼진 공급자의 시작은 404 · 설정엔 구글 줄만 · 구글 연결·로그인', async ({ page }) => {
    await page.goto('/login') // LND1 D-LND1-01
    await expect(page.getByRole('button', { name: '구글로 계속하기' })).toBeVisible()
    await expect(page.getByText('또는', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /로 계속하기$/ })).toHaveCount(1)
    const config = await page.request.get('/api/client-config')
    expect(config.status()).toBe(200)
    expect(await config.json()).toEqual({ loginProviders: ['google'] })
    const origin = new URL(page.url()).origin
    for (const provider of ['kakao', 'naver', 'facebook']) {
      const res = await page.request.post('/api/auth/start', { data: { provider }, headers: { Origin: origin } })
      expect(res.status(), provider).toBe(404)
      expect((await page.request.get(`/api/auth/${provider}/callback?code=x&state=y`, { maxRedirects: 0 })).status(), provider).toBe(404)
    }

    const seller = await loginNewSeller(page)
    await page.goto('/settings')
    await expect(methodsList(page).getByRole('listitem')).toHaveText([`아이디 로그인 · 아이디 ${seller.loginId} · 늘 켜져 있어요`, '구글 · 연결 안 됨연결하기'])
    const user = await fakeUser(page.request, 'google')
    await linkFromSettings(page, 'google', user)
    await logout(page)
    await pressContinue(page, 'google')
    await decideOnFakePage(page, 'google', user)
    await expect(page.getByRole('banner')).toContainText(seller.shopName)
    expect((await whoAmI(page.request)).loginId).toBe(seller.loginId)
    await page.goto('/settings')
    await expect(methodsRegion(page).getByRole('status')).toHaveCount(0)
    await expect(page.getByText(MSG.LINKED('google'))).toHaveCount(0)
  })
})

test.describe('AC-L1-20·22 공급자를 하나도 켜지 않은 기존 기동 (L1 전과 같다)', () => {
  test('로그인 화면에 "또는"·간편 로그인 버튼 없음 · /api/auth/** 404 · client-config에 loginProviders 없음 · 설정에 "로그인 방법" 칸 없음', async ({ page }) => {
    await page.goto('/login') // LND1 D-LND1-01
    await expect(page.getByLabel('아이디')).toBeFocused()
    await expect(page.getByRole('link', { name: '개인정보처리방침' })).toBeVisible()
    // client-config 응답(로그인 화면이 부르는 것)이 온 뒤에 없음을 본다
    const anon = await page.request.get('/api/client-config')
    expect(anon.status()).toBe(401)
    await expect(page.getByText('또는', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /로 계속하기$/ })).toHaveCount(0)
    const origin = new URL(page.url()).origin
    for (const provider of ['kakao', 'naver', 'google']) {
      expect((await page.request.post('/api/auth/start', { data: { provider }, headers: { Origin: origin } })).status(), provider).toBe(404)
      expect((await page.request.get(`/api/auth/${provider}/callback?code=x&state=y`, { maxRedirects: 0 })).status(), provider).toBe(404)
    }
    await loginNewSeller(page)
    const config = await page.request.get('/api/client-config')
    expect(config.status()).toBe(200)
    expect(await config.json()).not.toHaveProperty('loginProviders')
    expect((await page.request.get('/api/auth/methods')).status()).toBe(404)
    expect((await page.request.post('/api/auth/link', { data: { provider: 'kakao' }, headers: { Origin: origin } })).status()).toBe(404)
    expect((await page.request.post('/api/auth/unlink', { data: { provider: 'kakao' }, headers: { Origin: origin } })).status()).toBe(404)
    await page.goto('/settings')
    // D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 기대 "설정 화면이 열린 표시로 보조자 칸이 보인다"를 늘 있는 "그 밖" 칸으로 바꿨다
    await expect(page.getByRole('region', { name: '그 밖', exact: true })).toBeVisible()
    await expect(methodsRegion(page)).toHaveCount(0)
    await expect(page.getByText('아이디 로그인 · 아이디')).toHaveCount(0)
  })

  test('AC-L1-13 개인정보처리방침 초안 수집 항목에 간편 로그인 줄', async ({ page }) => {
    await page.goto('/privacy')
    await expect(page.getByText('간편 로그인을 연결하면: 공급자 계정 번호, 가린 이메일(예: se***@gmail.com)')).toBeVisible()
  })
})
