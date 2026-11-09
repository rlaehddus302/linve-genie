// UX2 방송자 줄 (SPEC §5.13 AC-UX2-06) — test-e2e. 방송자 표시는 유튜브 채팅에서만 오므로 가짜 유튜브 묶음(@youtube)에서 돈다.
// claim.ignoreOwner 기본값은 켬(DOMAIN_RULES 설정표) → 방송자 줄은 주문으로 보지 않고, 누르거나 초점을 줘도 "찜으로 바꾸기"가 없다.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { connectYoutube, fake, fakeBroadcast, fakeChat, linkByAddress, loginNewSeller, openRealBroadcast } from '../i3/support.ts'

const CONVERT = '찜으로 바꾸기'

function row(page: Page, text: string): Locator {
  return page.getByRole('list', { name: '채팅 메시지' }).getByRole('listitem').filter({ has: page.getByText(text, { exact: true }) })
}

test.beforeEach(async ({ request }) => {
  await fake(request, '/_fake/clear-faults')
})

test('@youtube AC-UX2-06: claim.ignoreOwner 켬(기본) — 방송자 줄은 누르거나 마우스를 올리거나 초점을 줘도 "찜으로 바꾸기"가 없고, 시청자 잡담 줄은 누르면 보인다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await loginNewSeller(page)
  const channel = await connectYoutube(page, '방송자 채널')
  const live = await fakeBroadcast(page.request, channel.id, { title: '오늘 라이브' })
  await openRealBroadcast(page, { title: '1부' })
  await linkByAddress(page, live.videoId)
  // 방송자 본인 채널이 쓴 줄 (가짜 유튜브가 isChatOwner로 보낸다)
  await fakeChat(page.request, live.liveChatId, channel.id, '방송자 채널', '오늘도 와 주셔서 고마워요')
  await fakeChat(page.request, live.liveChatId, 'UCviewerUx2', '시청자', '반가워요 사장님')
  const owner = row(page, '오늘도 와 주셔서 고마워요')
  const viewer = row(page, '반가워요 사장님')
  await expect(owner).toBeVisible({ timeout: 15_000 })
  await expect(viewer).toBeVisible({ timeout: 15_000 })
  // 정말 방송자 줄로 들어왔는지 (시청자 줄엔 없음)
  await expect(owner.getByText('진행자', { exact: true })).toBeVisible() // 문구 바뀜 (D-UX4-86)
  await expect(viewer.getByText('진행자', { exact: true })).toHaveCount(0) // 문구 바뀜 (D-UX4-86)

  await page.mouse.move(0, 0)
  await expect(owner.getByText(CONVERT)).toHaveCount(0)
  await owner.getByText('오늘도 와 주셔서 고마워요', { exact: true }).click()
  await owner.hover()
  await expect(owner.getByText(CONVERT)).toHaveCount(0)
  await owner.focus()
  await expect(owner.getByText(CONVERT)).toHaveCount(0)

  // 비교: 시청자 잡담 줄은 누르면 보인다
  await viewer.getByText('반가워요 사장님', { exact: true }).click()
  await expect(viewer.getByRole('button', { name: CONVERT })).toBeVisible()
})
