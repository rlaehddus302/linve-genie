// BND1 E2E — 설정 "네이버 밴드" 칸: 연결·거부·돌아온 결과 한 번·끊기 확인 창·정책 한 줄 (AC-BND1-70·78, AC-BND1-80 ①). 여러 플랫폼 묶음(@multi).
// 기대값은 acceptance.md 문장 그대로.
import { expect, test } from '@playwright/test'
import { T, band, bandSettings, bandUser, cleanupBand, connectBandUi, loginNewSeller } from './support.ts'

test.describe('BND1 설정 밴드 칸 @multi', () => {
  test.afterEach(async ({ page }) => {
    await cleanupBand(page)
  })

  test('AC-BND1-80 ①·70: 밴드 연결하기 → 가짜 밴드 승인 → "밴드를 연결했어요."·"연결됨 — {이름}", 새로 고침하면 결과 문장이 다시 나오지 않고 주소에서 지워진다 @multi', async ({ page }) => {
    await loginNewSeller(page)
    const name = `판매자${Math.random().toString(36).slice(2, 6)}`
    const me = await bandUser(page.request, name)
    await page.goto('/settings/band')
    await expect(bandSettings(page).getByText(T.notConnected, { exact: true })).toBeVisible()
    // 연결 안 됨이면 "연결 끊기"가 없다
    await expect(bandSettings(page).getByRole('button', { name: '연결 끊기' })).toHaveCount(0)
    await connectBandUi(page, me, name)
    // 돌아온 결과 값은 주소에서 지운다
    await expect.poll(() => new URL(page.url()).searchParams.get('band')).toBeNull()
    await page.reload()
    await expect(bandSettings(page).getByText(`연결됨 — ${name}`)).toBeVisible()
    await expect(page.getByText(T.connected)).toHaveCount(0)
    // D-BND1-19: 연결됨이면 단추는 "다시 연결하기" — "밴드 연결하기"는 없다
    await expect(bandSettings(page).getByRole('button', { name: T.reconnectButton, exact: true })).toBeVisible()
    await expect(bandSettings(page).getByRole('button', { name: T.connectButton, exact: true })).toHaveCount(0)
  })

  test('AC-BND1-80 ①·12: 가짜 밴드에서 거부 → "밴드 연결을 취소했어요." · 연결 안 됨 그대로 @multi', async ({ page }) => {
    await loginNewSeller(page)
    await bandUser(page.request, '거부할사람')
    await band(page.request, 'login', { decision: 'deny' })
    await page.goto('/settings/band')
    await bandSettings(page).getByRole('button', { name: '밴드 연결하기' }).click()
    await expect(page.getByText(T.denied)).toBeVisible()
    await expect(bandSettings(page).getByText(T.notConnected, { exact: true })).toBeVisible()
    const res = await page.request.get('/api/band')
    expect(((await res.json()) as { band: { status: string } }).band.status).toBe('NOT_CONNECTED')
  })

  test('AC-BND1-12: 다 쓴 돌아오는 주소를 다시 열면 "연결 시간이 지났어요. 다시 해 주세요." — 연결은 그대로 @multi', async ({ page }) => {
    await loginNewSeller(page)
    const name = `재방문${Math.random().toString(36).slice(2, 6)}`
    const me = await bandUser(page.request, name)
    await band(page.request, 'login', { decision: 'approve', userKey: me })
    await page.goto('/settings/band')
    // 밴드가 돌려보낸 주소(표·code)를 붙잡아 둔다
    const callbacks: string[] = []
    page.on('request', (r) => {
      if (new URL(r.url()).pathname.startsWith('/api/band/callback')) callbacks.push(r.url())
    })
    await bandSettings(page).getByRole('button', { name: '밴드 연결하기' }).click()
    await expect(page.getByText(T.connected)).toBeVisible()
    expect(callbacks.length).toBeGreaterThan(0)
    await page.goto(callbacks[0]!)
    await expect(page.getByText(T.expired)).toBeVisible()
    await expect(bandSettings(page).getByText(`연결됨 — ${name}`)).toBeVisible()
  })

  test('AC-BND1-70: 연결 끊기 → 확인 창 두 문장 → 끊기 → "연결 안 됨", 키보드만으로 연결·끊기 @multi', async ({ page }) => {
    await loginNewSeller(page)
    const name = `끊을판매자${Math.random().toString(36).slice(2, 6)}`
    const me = await bandUser(page.request, name)
    await band(page.request, 'login', { decision: 'approve', userKey: me })
    await page.goto('/settings/band')
    const connect = bandSettings(page).getByRole('button', { name: '밴드 연결하기' })
    await connect.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByText(T.connected)).toBeVisible()
    const off = bandSettings(page).getByRole('button', { name: '연결 끊기' })
    await off.focus()
    await page.keyboard.press('Enter')
    const dlg = page.getByRole('dialog', { name: '밴드 연결 끊기' })
    await expect(dlg.getByText(T.disconnectQuestion)).toBeVisible()
    await expect(dlg.getByText(T.disconnectHint)).toBeVisible()
    await dlg.getByRole('button', { name: '끊기', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(dlg).toHaveCount(0)
    await expect(bandSettings(page).getByText(T.notConnected, { exact: true })).toBeVisible()
  })

  test('AC-BND1-78: 개인정보처리방침 수집 항목에 밴드 한 줄 @multi', async ({ page }) => {
    await page.goto('/privacy')
    await expect(page.getByText(T.privacy, { exact: true })).toBeVisible()
  })
})
