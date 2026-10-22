// N2b-2 E2E — 콘솔 인스타그램 칸의 "보내지 못한 감사 DM" 수 (AC-N2b-2-63). 여러 플랫폼 묶음(@multi).
// 셀 이유는 AC-N2b-2-63 목록(FAILED·GAVE_UP·EXPIRED·UNCONFIRMED·라이브 끝남)뿐이다 — 자동 DM에 동의하지 않은 판매자의 감사(NO_CONSENT)는
// 보내지 "못한" 것이 아니라 보내지 않기로 한 것이다(SPEC YT-06 화면: "동의하지 않음·방송을 잇지 않음은 세지 않는다").
import { expect, test } from '@playwright/test'
import { boardItem, consoleInstagram, loginNewSeller, meta, openRealBroadcast, registerApi, settingsRegion, unlinkTiktok } from './support.ts'

test.describe('N2b-2 감사 DM 수 @multi', () => {
  // 서버 전체 연결 시도 한도(60초에 30번) 때문에 잇기·다시 붙기가 최대 60초 미뤄질 수 있다 (support.ts CONNECT_WAIT)
  test.describe.configure({ timeout: 300_000 })
  test.afterEach(async ({ page }) => {
    await unlinkTiktok(page)
  })
  test('TE-N2b-2-002: AC-N2b-2-63 감사 DM 자동 발송을 켜지 않은 판매자에게는 "감사 DM N건을 보내지 못했어요."가 보이지 않는다 @multi', async ({ page }) => {
    await loginNewSeller(page)
    const { account } = await meta<{ account: { id: string } }>(page.request, '/_fake/accounts', { username: `shop.${Math.random().toString(36).slice(2, 7)}` })
    await meta(page.request, '/_fake/login', { accounts: [account.id] })
    await page.goto('/settings/instagram')
    const settings = settingsRegion(page, '인스타그램')
    await settings.getByRole('button', { name: '인스타그램 연결하기' }).click()
    await expect(page.getByText('인스타그램 계정을 연결했어요.')).toBeVisible()
    // 자동 DM은 꺼진 채로 둔다 (판매자가 고른 것)
    await expect(settings.getByRole('button', { name: '감사 DM 자동 발송 켜기' })).toBeVisible()
    const { liveId } = await meta<{ liveId: string }>(page.request, '/_fake/live', { accountId: account.id })
    const { b, date } = await openRealBroadcast(page)
    await registerApi(page, b, 15, '라울', 10_000)
    const ig = consoleInstagram(page)
    await ig.getByRole('button', { name: '진행 중인 라이브 고르기' }).click()
    await page.getByRole('list', { name: '진행 중인 인스타그램 라이브' }).getByRole('button', { name: '이 라이브 잇기' }).first().click()
    await expect(ig.getByRole('button', { name: '끊기' })).toBeVisible()
    await meta(page.request, '/_fake/comments', { accountId: account.id, liveId, comments: [{ igsid: '93000001', username: 'buyer.one', text: '15' }] })
    await expect(boardItem(page, 15)).toContainText('buyer')
    // 확정된 판매의 감사 행이 생길 때까지 (동의 없음 — 보내지 않음)
    await expect
      .poll(async () => ((await (await page.request.get(`/api/instagram/dms?date=${date}`)).json()) as { rows: { broadcast: string }[] }).rows.filter((row) => row.broadcast === b).length, { timeout: 20_000 })
      .toBe(1)
    // 콘솔을 다시 열어 DM 목록을 새로 받은 뒤 본다
    const dms = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/instagram/dms' && r.ok())
    await page.reload()
    await dms
    await expect(ig.getByText('받은 댓글 1개')).toBeVisible()
    await expect(page.getByText(/감사 DM \d+건을 보내지 못했어요/)).toHaveCount(0)
  })
})
