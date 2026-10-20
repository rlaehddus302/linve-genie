// I3 — 유튜브 화면 흐름 2 (가짜 유튜브 묶음 @youtube). AC-I3-10·25·34·35·54
import { expect, test, type Page } from '@playwright/test'
import {
  alertStrip,
  connectYoutube,
  consentLiveChat,
  consoleYoutube,
  fake,
  fakeBroadcast,
  fakeChannel,
  linkByAddress,
  loginAs,
  loginNewSeller,
  newSeller,
  openRealBroadcast,
  outboxRows,
  register,
  scopeView,
  settingsRegion,
  smsApi,
} from './support.ts'

test.beforeEach(async ({ request }) => {
  await fake(request, '/_fake/clear-faults')
})
test.afterEach(async ({ request }) => {
  await fake(request, '/_fake/clear-faults')
})

async function saveThanksLiveChat(page: Page, on: boolean) {
  await page.goto('/settings')
  const thanks = settingsRegion(page, '구매 감사 메시지')
  const box = thanks.getByRole('checkbox', { name: '실시간 채팅에 감사 메시지 남기기' })
  await box.setChecked(on)
  await thanks.getByRole('button', { name: '저장' }).click()
  await expect(thanks.getByText('저장했어요. 다음에 시작하는 방송부터 적용돼요.')).toBeVisible()
}

test('@youtube AC-I3-10: 실시간 채팅 감사를 끄고 저장 → 진행 중이던 1부 판매엔 실시간 채팅 감사가 있고, 새 2부 판매엔 없다', async ({ page }) => {
  await loginNewSeller(page)
  await connectYoutube(page)
  const one = await openRealBroadcast(page, { title: '감사 1부' })
  await register(page, '41 일부상품 10', 41)
  await saveThanksLiveChat(page, false)
  await page.goto(`/broadcasts/${encodeURIComponent(one.b)}`)
  await smsApi(page, { b: one.b, no: 41, phone: '010-4141-4141' })
  const two = await openRealBroadcast(page, { title: '감사 2부', date: one.date })
  await register(page, '42 이부상품 10', 42)
  await smsApi(page, { b: two.b, no: 42, phone: '010-4242-4242' })
  await expect.poll(async () => (await outboxRows(page, one.date)).filter((r) => r.target === 'LIVE_CHAT' && r.text.startsWith('41번')).length).toBe(1)
  // 2부 판매가 확정된 뒤에도 2부의 실시간 채팅 감사는 없다
  await expect.poll(async () => (await scopeView(page, one.date, false)).claims.some((c) => c.no === 42 && c.broadcast === two.b)).toBe(true)
  const rows = await outboxRows(page, one.date)
  expect(rows.filter((r) => r.target === 'LIVE_CHAT' && r.text.startsWith('42번'))).toHaveLength(0)
})

test('@youtube AC-I3-25: 스트림이 "채팅 꺼짐" → 고정 영역 경고 + "채팅 다시 받기", 다시 받으면 경고가 사라진다', async ({ page }) => {
  await loginNewSeller(page)
  const channel = await connectYoutube(page)
  const live = await fakeBroadcast(page.request, channel.id, { title: '꺼짐 라이브' })
  await openRealBroadcast(page, { title: '꺼짐 회차' })
  await linkByAddress(page, live.videoId)
  await fake(page.request, '/_fake/fail', { method: 'liveChatMessages.streamList', fault: { status: 403, reason: 'liveChatDisabled' }, times: 1 })
  await fake(page.request, '/_fake/drop-streams')
  const warning = page.locator('.console-sticky').getByRole('alert').filter({ hasText: '유튜브 채팅을 받지 못하고 있어요' })
  await expect(warning).toBeVisible({ timeout: 30_000 })
  await expect(warning).toContainText('채팅이 꺼져 있어요.')
  await expect(warning.getByRole('link', { name: '다시 연결하기' })).toHaveCount(0)
  await warning.getByRole('button', { name: '채팅 다시 받기' }).click()
  await expect(warning).toHaveCount(0, { timeout: 15_000 })
})

test('@youtube AC-I3-34: 채널 A로 잇기 → 끊기 → 채널 C 연결·동의 → 새 판매 → "지금 연결한 유튜브 채널의 방송이 아니라 보내지 않았어요." + 할 일 문장, 다시 보내기도 같은 문장·행 그대로', async ({ page }) => {
  await loginNewSeller(page)
  const a = await connectYoutube(page, '채널 A')
  const live = await fakeBroadcast(page.request, a.id, { title: 'A 라이브' })
  const { b, date } = await openRealBroadcast(page, { title: '채널 회차' })
  await register(page, '51 채널상품 10', 51)
  await linkByAddress(page, live.videoId)
  await page.goto('/settings/youtube')
  await settingsRegion(page, '유튜브').getByRole('button', { name: '연결 끊기' }).click()
  // AC-I3-03: 채팅을 받는 실제 방송이 있으면 그 제목을 함께 보인다
  await expect(page.getByRole('dialog', { name: '유튜브 연결을 끊을까요?' })).toContainText('지금 채팅을 받는 방송: 채널 회차')
  await page.getByRole('dialog', { name: '유튜브 연결을 끊을까요?' }).getByRole('button', { name: '연결 끊기' }).click()
  await expect(settingsRegion(page, '유튜브').getByRole('button', { name: '구글로 유튜브 연결하기' })).toBeVisible()
  const c = await connectYoutube(page, '채널 C')
  await consentLiveChat(page, c)
  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await smsApi(page, { b, no: 51, phone: '010-5151-5151' })
  await expect.poll(async () => (await outboxRows(page, date)).find((r) => r.text.startsWith('51번'))?.reason, { timeout: 20_000 }).toBe('NOT_MY_CHANNEL')
  const failed = alertStrip(page).getByRole('button', { name: '감사 실패 1' })
  await expect(failed).toBeVisible()
  await failed.click()
  const row = page.getByRole('dialog', { name: '감사 메시지' }).getByRole('region', { name: '확인이 필요한 감사' }).getByRole('listitem')
  await expect(row).toContainText('지금 연결한 유튜브 채널의 방송이 아니라 보내지 않았어요.')
  await expect(row).toContainText('그 방송을 이은 유튜브 채널로 다시 연결하면 보낼 수 있어요.')
  await row.getByRole('button', { name: '다시 보내기' }).click()
  await expect(row.getByRole('alert')).toContainText('지금 연결한 유튜브 채널의 방송이 아니라 보내지 않았어요.')
  await expect(row.getByRole('alert')).toContainText('그 방송을 이은 유튜브 채널로 다시 연결하면 보낼 수 있어요.')
  expect((await outboxRows(page, date)).find((r) => r.text.startsWith('51번'))?.state).toBe('FAILED')
})

test('@youtube AC-I3-35: 알림에서 빼면 다른 기기의 알림 띠도 1초 안에 줄어든다', async ({ page, browser }) => {
  await loginNewSeller(page)
  const channel = await connectYoutube(page)
  await consentLiveChat(page, channel)
  const live = await fakeBroadcast(page.request, channel.id, { title: '빼기 라이브' })
  const { b } = await openRealBroadcast(page, { title: '빼기 회차' })
  await linkByAddress(page, live.videoId)
  await register(page, '61 빼기상품 10', 61)
  await fake(page.request, '/_fake/fail', { method: 'liveChatMessages.insert', fault: { status: 400, reason: 'invalidValue' }, times: 1 })
  await smsApi(page, { b, no: 61, phone: '010-6161-6161' })
  await expect(alertStrip(page).getByRole('button', { name: '감사 실패 1' })).toBeVisible({ timeout: 20_000 })
  const ctx = await browser.newContext()
  await ctx.addCookies(await page.context().cookies())
  const other = await ctx.newPage()
  await other.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(alertStrip(other).getByRole('button', { name: '감사 실패 1' })).toBeVisible()
  await alertStrip(page).getByRole('button', { name: '감사 실패 1' }).click()
  await page.getByRole('dialog', { name: '감사 메시지' }).getByRole('button', { name: '알림에서 빼기' }).click()
  await expect(alertStrip(other).getByRole('button', { name: /감사 실패/ })).toHaveCount(0, { timeout: 1500 })
  await ctx.close()
})

test('@youtube AC-I3-54: 마법사 4단계에서 연결 → 구글(가짜)에서 돌아오면 4단계에 결과 문장과 채널 이름', async ({ page }) => {
  const seller = await newSeller(page.request)
  await loginAs(page, seller)
  await expect(page).toHaveURL(/\/start$/)
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '다음' }).click()
  await expect(page.getByRole('heading', { level: 2, name: '4/5 유튜브 연결' })).toBeVisible()
  await expect(page.getByText('감사 메시지 자동 게시는 설정에서 따로 켤 수 있어요.')).toBeVisible()
  await fakeChannel(page.request, '마법사 채널')
  await page.getByRole('button', { name: '구글로 유튜브 연결하기' }).click()
  await expect(page.getByRole('heading', { level: 2, name: '4/5 유튜브 연결' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: '유튜브 채널을 연결했어요.' })).toBeVisible()
  await expect(page.getByRole('main')).toContainText('마법사 채널')
  await expect(page).toHaveURL(/\/start$/)
  await page.getByRole('button', { name: '다음' }).click()
  await expect(page.getByRole('heading', { level: 2, name: '5/5 리허설 해 보기' })).toBeVisible()
  void consoleYoutube
})
