// I3 — 유튜브 사용량 (작은 할당량 묶음 @quota, 예산 400 — 묶음 < 80 남음, 멈춤 < 20 남음). AC-I3-37·38
// 이 묶음은 프로젝트 한도도 400이라 시험이 하나뿐이어야 한다(다른 시험이 예산을 먼저 쓰면 숫자가 달라진다).
import { expect, test } from '@playwright/test'
import { connectYoutube, directApi, consoleYoutube, fake, fakeBroadcast, linkByAddress, loginNewSeller, openRealBroadcast, settingsRegion } from './support.ts'

interface Quota { used: number; remaining: number; budget: number; mode: string }

test('@quota AC-I3-37·38: 설정의 사용량 숫자·다시 채워지는 시각(KST)·모드 문장, 콘솔은 묶음·멈춤으로 바뀌면 알림 한 번(status)·포커스 그대로', async ({ page }) => {
  test.setTimeout(240_000)
  await fake(page.request, '/_fake/clear-faults')
  await loginNewSeller(page)
  const channel = await connectYoutube(page, '사용량 채널')
  const yt = settingsRegion(page, '유튜브')
  const usage = yt.getByRole('group', { name: '유튜브 사용량' })
  await expect(usage).toContainText(/오늘 쓴 양 [\d,]+ · 남은 양 [\d,]+ \(하루 한도 400\)/)
  await expect(usage).toContainText(/한국 시간 \d+월 \d+일 오[전후] \d+:\d\d에 다시 채워져요/)
  await expect(usage).toContainText('감사 메시지를 바로 보내요')
  expect(await usage.innerText()).not.toMatch(/liveBroadcasts|channels\.list|태평양/)
  const live = await fakeBroadcast(page.request, channel.id, { title: '사용량 라이브' })
  await openRealBroadcast(page, { title: '사용량 회차' })
  await linkByAddress(page, live.videoId)
  const quick = page.getByLabel('빠른 입력')
  await quick.focus()
  const api = directApi()
  const quota = async () => (await (await page.request.get(`${api}/api/youtube/quota`)).json() as { quota: Quota }).quota
  // 목록 조회(5단위)로 사용량을 써서 남은 양 < 20% 로
  while ((await quota()).remaining >= 80) await page.request.get(`${api}/api/youtube/live-broadcasts`)
  const toast = page.getByRole('status').filter({ hasText: '유튜브 사용량이 얼마 남지 않아 감사 메시지를 묶어서 보내요' })
  await expect(toast).toBeVisible({ timeout: 15_000 })
  await expect(quick).toBeFocused()
  await expect(consoleYoutube(page)).toContainText('유튜브 사용량이 얼마 남지 않아 감사 메시지를 묶어서 보내요')
  while ((await quota()).remaining >= 20) await page.request.get(`${api}/api/youtube/live-broadcasts`)
  await expect(page.getByRole('status').filter({ hasText: '오늘 유튜브 사용량이 거의 다 되어 감사 메시지를 멈췄어요. 채팅은 계속 받아요' })).toBeVisible({ timeout: 15_000 })
  await expect(quick).toBeFocused()
  await page.goto('/settings/youtube')
  await expect(settingsRegion(page, '유튜브').getByRole('group', { name: '유튜브 사용량' })).toContainText('오늘 유튜브 사용량이 거의 다 되어 감사 메시지를 멈췄어요. 채팅은 계속 받아요')
})
