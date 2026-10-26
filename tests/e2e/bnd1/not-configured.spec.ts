// BND1 E2E — 밴드 설정이 없는 서버(기본 묶음 chromium — 가짜 밴드 없음): 설정 칸은 서버 문장만, 콘솔 밴드 칸은 문장 + "설정으로" (AC-BND1-02·10·70·71).
import { expect, test } from '@playwright/test'
import { loginNewSeller, openRealBroadcast } from '../i3/support.ts'

const NOT_READY = '밴드 연동이 아직 준비되지 않았어요. 운영자에게 문의해 주세요.'

test('AC-BND1-70·71·02: 설정이 없는 서버 — 설정 "네이버 밴드" 칸은 문장만(연결 단추 없음), 콘솔 밴드 칸은 문장 + "설정으로", 플랫폼 능력 BAND 준비 안 됨', async ({ page }) => {
  await loginNewSeller(page)
  await page.goto('/settings/band')
  const region = page.getByRole('region', { name: '네이버 밴드', exact: true })
  await expect(region.getByText(NOT_READY, { exact: true })).toBeVisible()
  await expect(region.getByRole('button')).toHaveCount(0)
  const res = await page.request.post('/api/band/connect', { data: {}, headers: { Origin: new URL(page.url()).origin } })
  expect(res.status()).toBe(409)
  expect(((await res.json()) as { error: { code: string; message: string } }).error).toMatchObject({ code: 'NOT_CONFIGURED', message: NOT_READY })
  const platforms = (await (await page.request.get('/api/platforms')).json()) as { platforms: { platform?: string; name?: string; ready: boolean | { ok?: boolean } }[] }
  expect(JSON.stringify(platforms)).toContain('BAND')
  await page.setViewportSize({ width: 1280, height: 800 })
  await openRealBroadcast(page)
  const band = page.getByRole('region', { name: '밴드', exact: true })
  await expect(band.getByText(NOT_READY, { exact: true })).toBeVisible()
  await expect(band.getByRole('link', { name: '설정으로' })).toBeVisible()
  await expect(band.getByRole('button', { name: '밴드 글 잇기' })).toHaveCount(0)
})
