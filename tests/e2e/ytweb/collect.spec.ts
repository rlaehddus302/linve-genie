// YT-SRV(CH-26) — 서버가 유튜브 웹으로 채팅 읽기(YT-11) 수집 흐름 (서버 웹 읽기 묶음 @ytweb).
// 옛 공식 읽기 묶음(@youtube)의 수집 시험과 같은 뜻을 같은 강도로 본다: 같은 채팅 한 번만·순서·끊긴 동안 이어받기·꺼짐/막힘/응답 없음의 판매자 문장.
// 감사 게시가 섞인 시험은 옮기지 않는다(웹 잇기 회차는 공식 채팅 ID가 비어 감사가 올라가지 않는다 — D-YT-SRV-13 대기).
// 오류는 가짜 유튜브 웹의 /_fake/web/fail(endpoint 'poll' = get_live_chat). 지우는 경로가 없어 정확한 횟수만 넣고,
// 시험마다 만든 가짜 채팅을 afterEach에서 끝내 남은 수집기가 다음 시험의 오류를 먹지 않게 한다.
// 판매자 문장은 SPEC YT-11 AC3·AC5·AC9, YT-03(AC-I3-24·25·27) 그대로.
import { expect, test, type Page } from '@playwright/test'
import {
  boardItem,
  connectYoutube,
  consoleYoutube,
  endChats,
  expectChatOrder,
  fake,
  fakeBroadcast,
  fakeChat,
  linkWeb,
  loginNewSeller,
  openRealBroadcast,
  register,
  stickyWarning,
  waitPolls,
  webCalls,
  webFail,
  webVideo,
} from './support.ts'

const BLOCKED = '유튜브가 채팅 읽기를 잠시 막았어요. 다시 될 때까지 주문은 손으로 넣어 주세요.'
const FORMAT = '유튜브가 바뀌어 채팅을 자동으로 읽지 못하고 있어요. 주문은 손으로 넣어 주세요.'
const RESUMED = '유튜브 채팅을 다시 받고 있어요. 막힌 동안 손으로 넣은 주문과 겹치지 않는지 봐 주세요.'
const GAP = '끊긴 동안의 채팅 일부를 받지 못했을 수 있어요.'

let chats: string[] = []

test.beforeEach(async ({ request }) => {
  chats = []
  await fake(request, '/_fake/clear-faults')
})
test.afterEach(async ({ request }) => {
  await endChats(request, chats)
  await fake(request, '/_fake/clear-faults')
})

/** 새 판매자 → 구글 연결(확인한 채널) → 실제 방송 → 가짜 라이브를 주소로 잇기 (서버 웹 읽기) */
async function linkedConsole(page: Page, opts: { title?: string } = {}) {
  await loginNewSeller(page)
  const channel = await connectYoutube(page)
  const live = await fakeBroadcast(page.request, channel.id, { title: '오늘 라이브' })
  chats.push(live.liveChatId)
  const { b, date } = await openRealBroadcast(page, { title: opts.title ?? '1부' })
  await linkWeb(page, live.videoId)
  return { channel, live, b, date }
}

test.describe('@ytweb 끊김·이어받기', () => {
  // 옛: tests/e2e/i3/youtube-edges.spec.ts 'AC-I3-98·24: 가짜 서버 스트림이 끊긴 동안 …'
  test('AC-I3-98·24·YT-11 AC3: get_live_chat이 503으로 끊긴 동안 쓴 채팅이 이어받기로 빠짐·중복 없이 순서대로 채팅 패널에, 받은 수도 맞다', async ({ page }) => {
    const { live } = await linkedConsole(page, { title: '끊김 회차' })
    const chat = page.getByRole('list', { name: '채팅 메시지' })
    await fakeChat(page.request, live.liveChatId, 'UCs1', '끊김손님1', '첫 채팅')
    await expect(chat).toContainText('첫 채팅')
    const before = (await webCalls(page.request)).poll
    await webFail(page.request, 'poll', { status: 503 }, 2)
    await fakeChat(page.request, live.liveChatId, 'UCs2', '끊김손님2', '끊긴 동안 하나')
    await fakeChat(page.request, live.liveChatId, 'UCs3', '끊김손님3', '끊긴 동안 둘')
    // 두 번 실패하고(5·10초 뒤 다시) 세 번째에 받는다 — 넣은 오류가 이 수집기에 쓰였는지 먼저 본다
    await waitPolls(page.request, before, 3)
    await expect(chat).toContainText('끊긴 동안 둘', { timeout: 60_000 })
    await expectChatOrder(chat, ['첫 채팅', '끊긴 동안 하나', '끊긴 동안 둘'])
    await expect(consoleYoutube(page).getByRole('group', { name: '채팅 수집' })).toContainText('받은 채팅 3개')
  })

  test('YT-11 AC3: get_live_chat이 응답 없이 멈추면(15초) 실패로 보고 다시 불러, 멈춘 동안 쓴 채팅이 빠짐·중복 없이 순서대로', async ({ page }) => {
    const { live } = await linkedConsole(page, { title: '멈춤 회차' })
    const chat = page.getByRole('list', { name: '채팅 메시지' })
    await fakeChat(page.request, live.liveChatId, 'UCh1', '멈춤손님1', '멈추기 전')
    await expect(chat).toContainText('멈추기 전')
    const before = (await webCalls(page.request)).poll
    await webFail(page.request, 'poll', { kind: 'hang' }, 1)
    await waitPolls(page.request, before, 1)
    await fakeChat(page.request, live.liveChatId, 'UCh2', '멈춤손님2', '멈춘 동안 하나')
    await fakeChat(page.request, live.liveChatId, 'UCh3', '멈춤손님3', '멈춘 동안 둘')
    await expect(chat).toContainText('멈춘 동안 둘', { timeout: 60_000 })
    await expectChatOrder(chat, ['멈추기 전', '멈춘 동안 하나', '멈춘 동안 둘'])
    const group = consoleYoutube(page).getByRole('group', { name: '채팅 수집' })
    await expect(group).toContainText('받은 채팅 3개')
    await expect(group).toContainText('채팅을 받는 중')
  })

  // 옛: tests/e2e/i3/youtube-edges.spec.ts 'AC-I3-24: 잇기 전에 올라온 채팅은 받지 않고 …'
  test('AC-I3-24·YT-11 AC9: 잇기 전에 올라온 채팅은 받지 않고 "잇기 전에 올라온 채팅 n개는 받지 않았어요."', async ({ page }) => {
    await loginNewSeller(page)
    const channel = await connectYoutube(page)
    const live = await fakeBroadcast(page.request, channel.id, { title: '먼저 라이브' })
    chats.push(live.liveChatId)
    const past = new Date(Date.now() - 60_000).toISOString()
    await fake(page.request, '/_fake/messages', { liveChatId: live.liveChatId, author: 'UCearly1', name: '먼저1', text: '15', publishedAt: past })
    await fake(page.request, '/_fake/messages', { liveChatId: live.liveChatId, author: 'UCearly2', name: '먼저2', text: '안녕', publishedAt: past })
    await openRealBroadcast(page, { title: '먼저 회차' })
    await linkWeb(page, live.videoId)
    const group = consoleYoutube(page).getByRole('group', { name: '채팅 수집' })
    await expect(group).toContainText('잇기 전에 올라온 채팅 2개는 받지 않았어요.', { timeout: 20_000 })
    await expect(group).toContainText('받은 채팅 0개')
  })
})

test.describe('@ytweb 꺼짐·막힘·모르는 모양', () => {
  // 옛: tests/e2e/i3/youtube-flows.spec.ts 'AC-I3-25: 스트림이 "채팅 꺼짐" → …'
  test('AC-I3-25·YT-11 AC3: 진행 중 방송의 채팅이 꺼지면 고정 영역 경고 "채팅이 꺼져 있어요." + "채팅 다시 받기", 켜고 다시 받으면 경고가 사라지고 채팅을 한 번 받는다', async ({ page }) => {
    const { live } = await linkedConsole(page, { title: '꺼짐 회차' })
    const chat = page.getByRole('list', { name: '채팅 메시지' })
    await fakeChat(page.request, live.liveChatId, 'UCo1', '꺼짐손님1', '꺼지기 전')
    await expect(chat).toContainText('꺼지기 전')
    await webVideo(page.request, live.videoId, 'chatOff')
    const warning = page.locator('.console-sticky').getByRole('alert').filter({ hasText: '유튜브 채팅을 받지 못하고 있어요' })
    await expect(warning).toBeVisible({ timeout: 30_000 })
    await expect(warning).toContainText('채팅이 꺼져 있어요.')
    await expect(warning.getByRole('link', { name: '다시 연결하기' })).toHaveCount(0)
    await webVideo(page.request, live.videoId, 'live')
    await warning.getByRole('button', { name: '채팅 다시 받기' }).click()
    await expect(warning).toHaveCount(0, { timeout: 15_000 })
    await fakeChat(page.request, live.liveChatId, 'UCo2', '꺼짐손님2', '다시 켠 뒤')
    await expect(chat).toContainText('다시 켠 뒤', { timeout: 30_000 })
    await expectChatOrder(chat, ['꺼지기 전', '다시 켠 뒤'])
  })

  test('TE-YT-SRV-001 YT-11 AC5: 막힘(429) → 바로 고정 영역에 막힘 문장, 풀리면 경고를 내리고 "유튜브 채팅을 다시 받고 있어요…", 막힌 동안 쓴 채팅은 한 번씩', async ({ page }) => {
    test.setTimeout(180_000)
    const { live } = await linkedConsole(page, { title: '막힘 회차' })
    const chat = page.getByRole('list', { name: '채팅 메시지' })
    await fakeChat(page.request, live.liveChatId, 'UCb1', '막힘손님1', '막히기 전')
    await expect(chat).toContainText('막히기 전')
    const before = (await webCalls(page.request)).poll
    await webFail(page.request, 'poll', { status: 429 }, 1)
    await waitPolls(page.request, before, 1)
    // AC5 "처음 생길 때 바로" — 연결 오류의 10초 기다림(RETRYING_WARN_MS)이 아니다. 막힘 뒤 다음 부름은 30초 뒤라 그 안에 보여야 한다
    const warning = stickyWarning(page, BLOCKED)
    await expect(warning).toBeVisible({ timeout: 5_000 })
    // AC8: 막힘 경고에 대비 경로 버튼(댓글 붙여넣기·음성 문자찜·손 입력 …)
    await expect(warning.getByRole('button')).not.toHaveCount(0)
    await fakeChat(page.request, live.liveChatId, 'UCb2', '막힘손님2', '막힌 동안 하나')
    await fakeChat(page.request, live.liveChatId, 'UCb3', '막힘손님3', '막힌 동안 둘')
    await expect(chat).toContainText('막힌 동안 둘', { timeout: 90_000 })
    await expect(warning).toHaveCount(0)
    await expect(consoleYoutube(page)).toContainText(RESUMED)
    await expectChatOrder(chat, ['막히기 전', '막힌 동안 하나', '막힌 동안 둘'])
    await expect(consoleYoutube(page).getByRole('group', { name: '채팅 수집' })).toContainText('받은 채팅 3개')
  })

  test('TE-YT-SRV-002 YT-11 AC3·AC5: 모르는 모양 → 바로 고정 영역에 형식 변경 문장, 새 전체 채팅 지점으로 다시 받아 "끊긴 동안의 채팅 일부…" + 경고 내림, 채팅은 한 번씩', async ({ page }) => {
    test.setTimeout(150_000)
    const { live } = await linkedConsole(page, { title: '모양 회차' })
    const chat = page.getByRole('list', { name: '채팅 메시지' })
    await fakeChat(page.request, live.liveChatId, 'UCf1', '모양손님1', '바뀌기 전')
    await expect(chat).toContainText('바뀌기 전')
    const before = (await webCalls(page.request)).poll
    await webFail(page.request, 'poll', { kind: 'shape' }, 1)
    await waitPolls(page.request, before, 1)
    // 모르는 모양 뒤 다음 부름은 5초 뒤 — "바로" 보이는지를 그 사이에 본다 (경고를 내리기 전)
    const warning = stickyWarning(page, FORMAT)
    await expect(warning).toBeVisible({ timeout: 4_000 })
    await fakeChat(page.request, live.liveChatId, 'UCf2', '모양손님2', '바뀐 동안 하나')
    await expect(chat).toContainText('바뀐 동안 하나', { timeout: 60_000 })
    await expect(warning).toHaveCount(0)
    const yt = consoleYoutube(page)
    await expect(yt).toContainText(GAP)
    await expect(yt).toContainText(RESUMED)
    await expectChatOrder(chat, ['바뀌기 전', '바뀐 동안 하나'])
    await expect(yt.getByRole('group', { name: '채팅 수집' })).toContainText('받은 채팅 2개')
  })

  // 옛: tests/e2e/i3/youtube.spec.ts 'AC-I3-01·25: 가짜 서버에서 토큰이 무효(invalid_grant) → …' — 서버 웹 읽기에선 구글 연결 상태가 수집을 멈추지 않는다(뜻이 뒤집힘)
  test('YT-11 AC9 (D-YT-SRV-10): 구글 연결 토큰이 무효가 돼도 수집은 계속 — "유튜브 채팅을 받지 못하고 있어요" 경고 없이 새 채팅을 한 번 받는다', async ({ page }) => {
    const { live } = await linkedConsole(page, { title: '토큰 회차' })
    const chat = page.getByRole('list', { name: '채팅 메시지' })
    await fakeChat(page.request, live.liveChatId, 'UCv1', '시청자1', '토큰 전')
    await expect(consoleYoutube(page).getByRole('group', { name: '채팅 수집' })).toContainText('채팅을 받는 중')
    await expect(chat).toContainText('토큰 전')
    await fake(page.request, '/_fake/fail', { method: 'oauth.refresh', fault: { status: 400, reason: 'invalid_grant' }, times: 100 })
    await fake(page.request, '/_fake/revoke-all')
    await fakeChat(page.request, live.liveChatId, 'UCv2', '시청자2', '토큰 뒤')
    await expect(chat).toContainText('토큰 뒤', { timeout: 30_000 })
    await expectChatOrder(chat, ['토큰 전', '토큰 뒤'])
    await expect(page.locator('.console-sticky').getByRole('alert').filter({ hasText: '유튜브 채팅을 받지 못하고 있어요' })).toHaveCount(0)
    await expect(consoleYoutube(page).getByRole('group', { name: '채팅 수집' })).toContainText('채팅을 받는 중')
  })
})

test.describe('@ytweb 예정·조용한 방송·시청자 알림', () => {
  // 옛: tests/e2e/i3/youtube.spec.ts 'AC-I3-21·24: 내 라이브 목록 — …' 중 수집 부분 (서버 잇기의 목록은 최근 채널 찾기라 주소로 잇는다)
  test('AC-I3-24·YT-11 AC3: 예정 방송을 이으면 "유튜브 방송이 시작되면 채팅을 받아요." → 시작하면 받는 중, 받은 채팅 1개·마지막 채팅 시각', async ({ page }) => {
    test.setTimeout(150_000)
    await loginNewSeller(page)
    const channel = await connectYoutube(page)
    const upcoming = await fakeBroadcast(page.request, channel.id, { title: '예정 라이브', status: 'upcoming' })
    chats.push(upcoming.liveChatId)
    await openRealBroadcast(page, { title: '예정 회차' })
    await linkWeb(page, upcoming.videoId)
    const group = consoleYoutube(page).getByRole('group', { name: '채팅 수집' })
    await expect(group).toContainText('유튜브 방송이 시작되면 채팅을 받아요.')
    await expect(page.locator('.console-sticky').getByRole('alert')).toHaveCount(0)
    await fake(page.request, '/_fake/start-broadcast', { videoId: upcoming.videoId })
    // 예정 방송은 30초마다 공개 페이지로 상태를 본다 (YT-11 AC3)
    await expect(group).not.toContainText('유튜브 방송이 시작되면 채팅을 받아요.', { timeout: 60_000 })
    await fakeChat(page.request, upcoming.liveChatId, 'UCv9', '보는사람', '15번 예뻐요')
    await expect(group).toContainText('채팅을 받는 중')
    await expect(group).toContainText('받은 채팅 1개')
    await expect(group).toContainText(/마지막 채팅 오[전후] \d+:\d\d:\d\d/)
  })

  // 옛: tests/e2e/i3/youtube.spec.ts 'TE-I3-001 AC-I3-24: 채팅이 조용한 라이브를 이어도 …'
  test('TE-I3-001 AC-I3-24: 채팅이 조용한 라이브를 이어도(예정 방송이 시작돼도) 수집이 붙으면 "채팅을 받는 중" — "시작하는 중"에 머물지 않는다', async ({ page }) => {
    test.setTimeout(150_000)
    await loginNewSeller(page)
    const channel = await connectYoutube(page)
    const live = await fakeBroadcast(page.request, channel.id, { title: '조용한 라이브' })
    chats.push(live.liveChatId)
    await openRealBroadcast(page, { title: '조용한 회차' })
    await linkWeb(page, live.videoId)
    const group = consoleYoutube(page).getByRole('group', { name: '채팅 수집' })
    await expect(group).toContainText('채팅을 받는 중', { timeout: 15_000 })
    const upcoming = await fakeBroadcast(page.request, channel.id, { title: '조용한 예정', status: 'upcoming' })
    chats.push(upcoming.liveChatId)
    await openRealBroadcast(page, { title: '조용한 예정 회차' })
    await linkWeb(page, upcoming.videoId)
    const group2 = consoleYoutube(page).getByRole('group', { name: '채팅 수집' })
    await expect(group2).toContainText('유튜브 방송이 시작되면 채팅을 받아요.')
    await fake(page.request, '/_fake/start-broadcast', { videoId: upcoming.videoId })
    await expect(group2).toContainText('채팅을 받는 중', { timeout: 60_000 })
  })

  // 옛: tests/e2e/i3/youtube.spec.ts 'AC-I3-27: 시청자 알림 — …'
  test('AC-I3-27·YT-11 AC4: 시청자 알림 — 지운 메시지(주문이었던 메시지)·한 작성자 글 모두 지움(라이브지니에서도 차단 → 차단 창)', async ({ page }) => {
    const { live } = await linkedConsole(page, { title: '알림 회차' })
    await register(page, '15 핑크프릴 10', 15)
    const msg = await fakeChat(page.request, live.liveChatId, 'UCdel', '지운사람', '15')
    await expect(boardItem(page, 15)).toContainText('지운사람')
    await fake(page.request, '/_fake/delete', { liveChatId: live.liveChatId, messageId: msg })
    const notices = consoleYoutube(page).getByRole('region', { name: '시청자 알림' })
    await expect(notices).toContainText('시청자 알림 1')
    await expect(notices).toContainText('주문이었던 메시지예요')
    await expect(notices).toContainText('시청자가 메시지를 지웠어요. 그 메시지로 생긴 찜은 그대로예요.')
    await expect(boardItem(page, 15)).toContainText('지운사람')
    await fake(page.request, '/_fake/ban', { liveChatId: live.liveChatId, channelId: 'UCdel', name: '지운사람' })
    await expect(notices).toContainText('시청자 알림 2')
    await notices.getByRole('button', { name: '라이브지니에서도 차단' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
  })
})

test.describe('@ytweb 서버 잇기', () => {
  test('TE-YT-SRV-003 YT-11 AC2·YT-02 서버 잇기: 구글 연결 없이 주소만 넣어 잇는다 — 처음 잇는 채널이면 "처음 잇는 채널이에요 (채널: …). 이 방송이 맞나요?" → 맞아요, 잇기 → 채팅을 한 번 받는다', async ({ page }) => {
    await loginNewSeller(page)
    const channel = await fake<{ id: string; title: string }>(page.request, '/_fake/channels', { title: '처음 채널' })
    const live = await fakeBroadcast(page.request, channel.id, { title: '처음 라이브' })
    chats.push(live.liveChatId)
    await openRealBroadcast(page, { title: '처음 회차' })
    const yt = consoleYoutube(page)
    const field = yt.getByLabel('주소 붙여넣기')
    // 구글 연결 없이도 잇기 칸(주소 붙여넣기)이 열린다
    await expect(field).toBeVisible()
    await field.fill(`https://www.youtube.com/watch?v=${live.videoId}`)
    await field.press('Enter')
    await expect(yt.getByText(`읽은 영상: ${live.videoId}`)).toBeVisible()
    await yt.getByRole('button', { name: '이 방송에 잇기' }).last().click()
    await expect(yt.getByText('처음 잇는 채널이에요 (채널: 처음 채널). 이 방송이 맞나요?')).toBeVisible()
    await expect(yt.getByRole('group', { name: '채팅 수집' })).toHaveCount(0)
    await yt.getByRole('button', { name: '맞아요, 잇기' }).click()
    const group = yt.getByRole('group', { name: '채팅 수집' })
    await expect(group).toBeVisible()
    await expect(yt).toContainText('유튜브 방송 · 처음 채널')
    const chat = page.getByRole('list', { name: '채팅 메시지' })
    await fakeChat(page.request, live.liveChatId, 'UCn1', '처음손님', '처음 채팅')
    await expect(chat).toContainText('처음 채팅')
    await expect(chat.getByText('처음 채팅')).toHaveCount(1)
    await expect(group).toContainText('채팅을 받는 중')
  })
})
