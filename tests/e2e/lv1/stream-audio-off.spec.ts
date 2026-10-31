// LV1 AC-LV1-09: 운영자가 방송 소리를 껐으면(--stream-audio off) 설정 칸도, 콘솔 상태 줄도 없고 마이크는 그대로.
import { expect, test } from '@playwright/test'
import { audioLine, connectYoutube, fake, linkAddress, newSellerLogin, openBroadcast, startAudioStack, type AudioStack } from './support.ts'

let stack: AudioStack
test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => { test.setTimeout(300_000); stack = await startAudioStack('off') })
test.afterAll(async () => { await stack.stop() })
test.use({ baseURL: 'http://localhost:5196' })

for (const size of [{ name: 'PC 1440', width: 1440, height: 900 }, { name: '휴대폰 375', width: 375, height: 812 }]) {
  test(`AC-LV1-09 ${size.name}: 운영자 끔 — 설정 칸 없음, 상태 줄 없음, 안내 창 없음, 음성 켜기는 있음`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height })
    await newSellerLogin(page, stack)
    await page.goto('/settings')
    await expect(page.getByRole('region', { name: '유튜브', exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: '방송 소리로 듣기', exact: true })).toHaveCount(0)
    const channel = await connectYoutube(page, stack)
    const live = await fake<{ videoId: string }>(page.request, stack, '/_fake/broadcasts', { channelId: channel.id, status: 'live' })
    await openBroadcast(page)
    await linkAddress(page, live.videoId)
    await expect(page.getByRole('button', { name: '음성 켜기' }).first()).toBeVisible()
    await expect(audioLine(page)).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: '방송 소리로 듣기' })).toHaveCount(0)
  })
}
