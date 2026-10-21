// I3 — 유튜브 화면 가장자리 (가짜 유튜브 묶음 @youtube). AC-I3-20·21·24·32
import { expect, test } from '@playwright/test'
import {
  boardItem,
  connectYoutube,
  consentLiveChat,
  consoleYoutube,
  fake,
  fakeBroadcast,
  fakeChat,
  fakeUrl,
  linkByAddress,
  loginNewSeller,
  openRealBroadcast,
  outboxRows,
  postJson,
  register,
  scopeView,
} from './support.ts'

test.beforeEach(async ({ request }) => {
  await fake(request, '/_fake/clear-faults')
})
test.afterEach(async ({ request }) => {
  await fake(request, '/_fake/clear-faults')
})

test('@youtube AC-I3-21: 내 라이브 목록을 못 받으면(502) 서버 문장 + "다시 불러오기" → 다시 받으면 목록', async ({ page }) => {
  await loginNewSeller(page)
  const channel = await connectYoutube(page)
  await fakeBroadcast(page.request, channel.id, { title: '다시 라이브' })
  await openRealBroadcast(page, { title: '502 회차' })
  await fake(page.request, '/_fake/fail', { method: 'liveBroadcasts.list', fault: { status: 500 }, times: 5 })
  const yt = consoleYoutube(page)
  await yt.getByRole('button', { name: '내 라이브 목록에서 고르기' }).click()
  await expect(yt.getByText('유튜브에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.')).toBeVisible({ timeout: 30_000 })
  await fake(page.request, '/_fake/clear-faults')
  await yt.getByRole('button', { name: '다시 불러오기' }).click()
  await expect(yt.getByRole('radio', { name: /다시 라이브 방송 중/ })).toBeVisible()
})

test('@youtube AC-I3-32: 확정이 풀린 판매의 감사 다시 보내기 → "확정이 풀린 판매라 보내지 않아요." 행은 건너뜀으로, 게시 0번', async ({ page }) => {
  await loginNewSeller(page)
  const channel = await connectYoutube(page)
  const live = await fakeBroadcast(page.request, channel.id, { title: '풀린 라이브' })
  const { b, date } = await openRealBroadcast(page, { title: '풀린 회차' })
  await linkByAddress(page, live.videoId)
  await register(page, '81 풀린상품 10', 81)
  await fakeChat(page.request, live.liveChatId, 'UCcancel', '취소될손님', '81')
  await expect(boardItem(page, 81)).toContainText('취소될손님')
  await expect.poll(async () => (await outboxRows(page, date)).find((r) => r.text.startsWith('81번'))?.reason).toBe('NO_CONSENT')
  await consentLiveChat(page, channel)
  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  const buyer = (await scopeView(page, date, false)).products.find((p) => p.no === 81)!.winners[0]!
  const cancel = await postJson(page, '/api/events', { requestId: crypto.randomUUID(), type: 'host.cancel', b, no: 81, buyer, reason: '판매자 취소' })
  expect(cancel.status, JSON.stringify(cancel.body)).toBe(200)
  const before = (await (await page.request.get(`${fakeUrl()}/_fake/state`)).json() as { posted: { text: string }[] }).posted.filter((p) => p.text.startsWith('81번')).length
  await consoleYoutube(page).getByRole('button', { name: '감사 메시지' }).click()
  const dlg = page.getByRole('dialog', { name: '감사 메시지' })
  const row = dlg.getByRole('listitem').filter({ hasText: '81번 풀린상품' })
  const resend = row.getByRole('button', { name: '다시 보내기' })
  if (await resend.count() > 0) {
    await resend.click()
    await expect(dlg.getByText('확정이 풀린 판매라 보내지 않아요.').first()).toBeVisible()
  }
  await expect.poll(async () => (await outboxRows(page, date)).find((r) => r.text.startsWith('81번'))?.state).toBe('SKIPPED')
  const after = (await (await page.request.get(`${fakeUrl()}/_fake/state`)).json() as { posted: { text: string }[] }).posted.filter((p) => p.text.startsWith('81번')).length
  expect(after).toBe(before)
})


test('@youtube AC-I3-24: 잇기 전에 올라온 채팅은 받지 않고 "잇기 전에 올라온 채팅 n개는 받지 않았어요."', async ({ page }) => {
  await loginNewSeller(page)
  const channel = await connectYoutube(page)
  const live = await fakeBroadcast(page.request, channel.id, { title: '먼저 라이브' })
  const past = new Date(Date.now() - 60_000).toISOString()
  await fake(page.request, '/_fake/messages', { liveChatId: live.liveChatId, author: 'UCearly1', name: '먼저1', text: '15', publishedAt: past })
  await fake(page.request, '/_fake/messages', { liveChatId: live.liveChatId, author: 'UCearly2', name: '먼저2', text: '안녕', publishedAt: past })
  await openRealBroadcast(page, { title: '먼저 회차' })
  await linkByAddress(page, live.videoId)
  const group = consoleYoutube(page).getByRole('group', { name: '채팅 수집' })
  await expect(group).toContainText('잇기 전에 올라온 채팅 2개는 받지 않았어요.', { timeout: 20_000 })
  await expect(group).toContainText('받은 채팅 0개')
})

test('@youtube AC-I3-20: 끝난 방송 — 이은 방송·수집 상태만, 잇기·잇기 해제·다시 받기 버튼 없음', async ({ page }) => {
  await loginNewSeller(page)
  const channel = await connectYoutube(page)
  const live = await fakeBroadcast(page.request, channel.id, { title: '끝낼 라이브' })
  const { b } = await openRealBroadcast(page, { title: '끝낼 회차' })
  await linkByAddress(page, live.videoId)
  const end = await postJson(page, `/api/broadcasts/${encodeURIComponent(b)}/end`, { requestId: crypto.randomUUID() })
  expect(end.status, JSON.stringify(end.body)).toBeLessThan(300)
  await page.reload()
  const yt = consoleYoutube(page)
  await expect(yt.getByRole('group', { name: '채팅 수집' })).toContainText(`영상 ${live.videoId}`)
  await expect(yt.getByRole('button', { name: /잇기|연결 끊기|다시 받기|내 라이브/ })).toHaveCount(0)
  await expect(yt.getByLabel('주소 붙여넣기')).toHaveCount(0)
})

test('@youtube AC-I3-90: 375×812 — 긴 채널 이름·방송 제목·시청자 이름이어도 콘솔 유튜브 칸·감사 메시지 목록·설정에 가로 스크롤 없음', async ({ page }) => {
  const long = 'ㅋ'.repeat(5) + 'abcdefghij'.repeat(8)
  await loginNewSeller(page)
  const channel = await connectYoutube(page, `채널${long}`)
  const live = await fakeBroadcast(page.request, channel.id, { title: `라이브${long}` })
  const { date } = await openRealBroadcast(page, { title: '긴 이름 회차' })
  await linkByAddress(page, live.videoId)
  await register(page, '91 긴이름상품 10', 91)
  await fakeChat(page.request, live.liveChatId, 'UClong', `손님${long}`, '91')
  await expect.poll(async () => (await outboxRows(page, date)).some((r) => r.text.startsWith('91번'))).toBe(true)
  await page.setViewportSize({ width: 375, height: 812 })
  const width = async () => await page.evaluate(() => document.documentElement.scrollWidth)
  await expect(consoleYoutube(page)).toBeVisible()
  expect(await width()).toBeLessThanOrEqual(375)
  await consoleYoutube(page).getByRole('button', { name: '감사 메시지' }).click()
  await expect(page.getByRole('dialog', { name: '감사 메시지' })).toContainText('91번')
  const over = await page.getByRole('dialog', { name: '감사 메시지' }).evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(over).toBeLessThanOrEqual(0)
  expect(await width()).toBeLessThanOrEqual(375)
  await page.keyboard.press('Escape')
  await page.goto('/settings/youtube')
  await expect(page.getByText('읽기 권한 있음')).toBeVisible()
  expect(await width()).toBeLessThanOrEqual(375)
})

test('@youtube AC-I3-98·24: 가짜 서버 스트림이 끊긴 동안 쓴 시청자 채팅이 이어받기로 빠짐·중복 없이 채팅 패널에, 받은 수도 맞다', async ({ page }) => {
  await loginNewSeller(page)
  const channel = await connectYoutube(page)
  const live = await fakeBroadcast(page.request, channel.id, { title: '끊김 라이브' })
  await openRealBroadcast(page, { title: '끊김 회차' })
  await linkByAddress(page, live.videoId)
  const chat = page.getByRole('list', { name: '채팅 메시지' })
  await fakeChat(page.request, live.liveChatId, 'UCs1', '끊김손님1', '첫 채팅')
  await expect(chat).toContainText('첫 채팅')
  await fake(page.request, '/_fake/fail', { method: 'liveChatMessages.streamList', fault: { status: 503 }, times: 2 })
  await fake(page.request, '/_fake/drop-streams')
  await fakeChat(page.request, live.liveChatId, 'UCs2', '끊김손님2', '끊긴 동안 하나')
  await fakeChat(page.request, live.liveChatId, 'UCs3', '끊김손님3', '끊긴 동안 둘')
  await expect(chat).toContainText('끊긴 동안 둘', { timeout: 60_000 })
  await expect(chat.getByText('끊긴 동안 하나')).toHaveCount(1)
  await expect(chat.getByText('끊긴 동안 둘')).toHaveCount(1)
  await expect(chat.getByText('첫 채팅')).toHaveCount(1)
  await expect(consoleYoutube(page).getByRole('group', { name: '채팅 수집' })).toContainText('받은 채팅 3개')
})
