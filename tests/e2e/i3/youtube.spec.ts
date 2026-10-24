// I3 — 유튜브 화면 (가짜 유튜브 묶음 @youtube). AC-I3-01~05·11~14·20~27·30~35·91·92·98
// 묶음의 서버·가짜 서버는 같은 실행의 시험이 함께 쓴다 — 시험마다 새 판매자·새 가짜 채널을 쓰고, 가짜 오류는 시험 앞뒤로 지운다.
import { expect, test, type Page } from '@playwright/test'
import {
  alertStrip,
  boardItem,
  connectYoutube,
  consentLiveChat,
  consoleYoutube,
  fake,
  fakeBroadcast,
  fakeChannel,
  fakeChat,
  fakeState,
  linkByAddress,
  loginNewSeller,
  openRealBroadcast,
  outboxRows,
  register,
  settingsRegion,
  smsApi,
} from './support.ts'

test.beforeEach(async ({ request }) => {
  await fake(request, '/_fake/clear-faults')
})
test.afterEach(async ({ request }) => {
  await fake(request, '/_fake/clear-faults')
})

/** 새 판매자 → 연결 → (동의) → 실제 방송 → 가짜 라이브 잇기 */
async function linkedConsole(page: Page, opts: { consent: boolean; title?: string }) {
  await loginNewSeller(page)
  const channel = await connectYoutube(page, opts.title ?? '테스트 채널')
  if (opts.consent) await consentLiveChat(page, channel)
  const live = await fakeBroadcast(page.request, channel.id, { title: '오늘 라이브' })
  const { b, date } = await openRealBroadcast(page, { title: '1부' })
  await linkByAddress(page, live.videoId)
  return { channel, live, b, date }
}

test.describe('@youtube 연결 화면', () => {
  test('AC-I3-01·02: 연결 안 됨 권한 안내 → 연결 → 결과 문장 한 번, 주소의 결과 코드는 지우고 새로고침해도 다시 안 나옴', async ({ page }) => {
    await loginNewSeller(page)
    await page.goto('/settings/youtube')
    const yt = settingsRegion(page, '유튜브')
    for (const line of ['내 채널 이름 보기', '내 라이브 방송 목록 보기', '방송 채팅 읽기(찜 받기)', '연결만으로는 내 채널에 글을 쓰지 않아요.']) await expect(yt.getByText(line, { exact: true })).toBeVisible()
    await expect(yt.getByRole('link', { name: '개인정보처리방침' })).toBeVisible()
    const historyBefore = await page.evaluate(() => history.length)
    await fakeChannel(page.request, '연결 채널')
    await yt.getByRole('button', { name: '구글로 유튜브 연결하기' }).click()
    const status = page.getByRole('status').filter({ hasText: '유튜브 채널을 연결했어요.' })
    await expect(status).toBeVisible()
    await expect(page).toHaveURL(/\/settings\/youtube$/)
    await expect(yt).toContainText('연결 채널')
    await expect(yt.getByText('읽기 권한 있음')).toBeVisible()
    await expect(yt.getByText('글쓰기 권한 없음')).toBeVisible()
    await expect(yt.getByRole('button', { name: '연결 끊기' })).toBeVisible()
    // 같은 탭 최상위 이동: 연결 시작 페이지 → (구글) → 돌아옴 = 기록 2개 늘어남이 최대. 결과 코드를 지울 때 기록을 늘리지 않는다
    expect(await page.evaluate(() => history.length)).toBeLessThanOrEqual(historyBefore + 2)
    const text = await page.locator('main').innerText()
    for (const word of ['CONNECTED', 'youtube.readonly', 'force-ssl', 'access_token', 'refresh']) expect(text).not.toContain(word)
    await page.reload()
    await expect(yt.getByText('읽기 권한 있음')).toBeVisible()
    await expect(page.getByText('유튜브 채널을 연결했어요.')).toHaveCount(0)
    // 저장소·주소에 승인 주소·code·state 없음 (AC-I3-05)
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + location.href)
    for (const word of ['code=', 'state=', 'oauth', 'client_secret', '127.0.0.1:4']) expect(stored).not.toContain(word)
  })

  test('AC-I3-02: 구글에서 거절 → "구글에서 연결을 허락하지 않았어요. 다시 시도해 주세요." · 연결 안 됨 그대로', async ({ page }) => {
    await loginNewSeller(page)
    await fake(page.request, '/_fake/approval', { deny: true })
    await page.goto('/settings/youtube')
    await settingsRegion(page, '유튜브').getByRole('button', { name: '구글로 유튜브 연결하기' }).click()
    await expect(page.getByRole('status').filter({ hasText: '구글에서 연결을 허락하지 않았어요. 다시 시도해 주세요.' })).toBeVisible()
    await expect(settingsRegion(page, '유튜브').getByRole('button', { name: '구글로 유튜브 연결하기' })).toBeVisible()
  })

  test('AC-I3-03·04: 연결 끊기 확인 창(처음 포커스 그대로 두기·Esc 요청 없음) → 끊으면 다른 기기도 1초 안에 연결 안 됨', async ({ page, browser }) => {
    await loginNewSeller(page)
    await connectYoutube(page, '끊을 채널')
    const cookies = await page.context().cookies()
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } })
    await ctx.addCookies(cookies)
    const phone = await ctx.newPage()
    await phone.goto('/settings/youtube')
    await expect(settingsRegion(phone, '유튜브').getByText('읽기 권한 있음')).toBeVisible()
    const posts: string[] = []
    page.on('request', (r) => {
      if (r.url().includes('/disconnect')) posts.push(r.url())
    })
    const yt = settingsRegion(page, '유튜브')
    await yt.getByRole('button', { name: '연결 끊기' }).click()
    const dlg = page.getByRole('dialog', { name: '유튜브 연결을 끊을까요?' })
    await expect(dlg.getByRole('button', { name: '그대로 두기' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)
    expect(posts).toEqual([])
    await yt.getByRole('button', { name: '연결 끊기' }).click()
    await dlg.getByRole('button', { name: '연결 끊기' }).click()
    await expect(yt.getByRole('button', { name: '구글로 유튜브 연결하기' })).toBeVisible()
    await expect(settingsRegion(phone, '유튜브').getByRole('button', { name: '구글로 유튜브 연결하기' })).toBeVisible({ timeout: 1500 })
    await ctx.close()
  })

  test('AC-I3-01·25: 가짜 서버에서 토큰이 무효(invalid_grant) → 다시 연결 필요 → 콘솔 고정 영역 경고 "다시 연결하기"', async ({ page }) => {
    const { live } = await linkedConsole(page, { consent: false })
    await fakeChat(page.request, live.liveChatId, 'UCv1', '시청자1', '안녕')
    await expect(consoleYoutube(page).getByRole('group', { name: '채팅 수집' })).toContainText('채팅을 받는 중')
    await page.getByLabel('빠른 입력').focus()
    await fake(page.request, '/_fake/fail', { method: 'oauth.refresh', fault: { status: 400, reason: 'invalid_grant' }, times: 100 })
    await fake(page.request, '/_fake/revoke-all')
    await fake(page.request, '/_fake/drop-streams')
    const warning = page.locator('.console-sticky').getByRole('alert').filter({ hasText: '유튜브 채팅을 받지 못하고 있어요' })
    await expect(warning).toBeVisible({ timeout: 30_000 })
    await expect(warning).toContainText('유튜브 채팅을 받지 못하고 있어요 — 유튜브 연결을 다시 해 주세요.')
    await expect(warning.getByRole('link', { name: '다시 연결하기' })).toBeVisible()
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    await page.setViewportSize({ width: 375, height: 812 })
    const h = await page.locator('.console-sticky').evaluate((el) => el.getBoundingClientRect().height)
    expect(h).toBeLessThanOrEqual(812 * 0.35)
    await warning.getByRole('link', { name: '다시 연결하기' }).click()
    await expect(page).toHaveURL(/\/settings\/youtube$/)
    await expect(settingsRegion(page, '유튜브').getByText('유튜브 연결을 다시 해 주세요.')).toBeVisible()
    await expect(settingsRegion(page, '유튜브').getByRole('button', { name: '다시 연결하기' })).toBeVisible()
  })
})

test.describe('@youtube 감사 메시지 설정', () => {
  test('AC-I3-11·13: 동의 설명 창 → 글쓰기 권한 승인 → 켜짐 + 동의 시각, 요약 한 줄이 바로 바뀜, 거절이면 꺼진 그대로', async ({ page }) => {
    await loginNewSeller(page)
    const channel = await connectYoutube(page)
    await page.goto('/settings')
    const thanks = settingsRegion(page, '구매 감사 메시지')
    const summary = thanks.getByRole('region', { name: '지금 설정의 결과' })
    await expect(summary).toContainText('실시간 채팅 — 감사 메시지를 만들기만 하고 자동으로 올리지 않아요. 감사 메시지 목록에서 하나씩 보낼 수 있어요.')
    // 거절
    await fake(page.request, '/_fake/approval', { deny: true })
    await thanks.getByRole('button', { name: '실시간 채팅 자동 게시 켜기' }).click()
    const dlg = page.getByRole('dialog', { name: '실시간 채팅 자동 게시' })
    await expect(dlg.getByRole('button', { name: '닫기' })).toBeFocused()
    await expect(dlg).toContainText('동의한 뒤에 확정된 판매부터 남기고, 그 전 판매는 남기지 않아요.')
    await dlg.getByRole('button', { name: '동의해요' }).click()
    await expect(page.getByText('구글에서 연결을 허락하지 않았어요. 다시 시도해 주세요.')).toBeVisible()
    await expect(settingsRegion(page, '구매 감사 메시지').getByRole('button', { name: '실시간 채팅 자동 게시 켜기' })).toBeVisible()
    // 허락
    await consentLiveChat(page, channel)
    await expect(settingsRegion(page, '구매 감사 메시지')).toContainText(/\d+월 \d+일 오[전후] \d+:\d\d에 동의함/)
    await expect(settingsRegion(page, '구매 감사 메시지').getByRole('region', { name: '지금 설정의 결과' })).toContainText('실시간 채팅 — 다음 방송부터 자동으로 남겨요')
    // 만들기 끄고 저장 → 요약이 새로고침 없이 바뀜, 저장하기 전에는 그대로
    const t2 = settingsRegion(page, '구매 감사 메시지')
    await t2.getByRole('checkbox', { name: '찜이 확정될 때마다 채팅에 감사 메시지 남기기' }).uncheck() // FB1 D-FB1-14
    await expect(t2.getByRole('region', { name: '지금 설정의 결과' })).toContainText('실시간 채팅 — 다음 방송부터 자동으로 남겨요')
    await page.getByRole('region', { name: '저장', exact: true }).getByRole('button', { name: '저장' }).click() // FB1 D-FB1-06
    await expect(page.getByRole('region', { name: '저장', exact: true }).getByText('저장했어요. 바꾼 규칙은 다음에 시작하는 방송부터 적용돼요.')).toBeVisible() // FB1 D-FB1-06
    await expect(t2.getByRole('region', { name: '지금 설정의 결과' })).toContainText('실시간 채팅 — 감사 메시지를 만들지 않아요.')
  })

  test('AC-I3-12·14: 끄기는 바로 "껐어요…", 미리 보기·묶음 미리 보기·문자찜 안내', async ({ page }) => {
    await loginNewSeller(page)
    const channel = await connectYoutube(page)
    await consentLiveChat(page, channel)
    const thanks = settingsRegion(page, '구매 감사 메시지')
    await thanks.getByRole('button', { name: '실시간 채팅 자동 게시 끄기' }).click()
    await expect(thanks.getByText('껐어요. 기다리던 감사 메시지는 보내지 않아요.')).toBeVisible()
    const preview = thanks.getByRole('region', { name: '미리 보기' })
    await expect(preview).toContainText('15번 핑크프릴 10,000원 홍길동님 구매 감사합니다')
    await expect(preview).toContainText("문자찜으로 산 분은 '문자찜'으로 나가요. 메모·전화번호는 절대 나가지 않아요.")
    await thanks.getByRole('button', { name: '감사 메시지 상세 설정', exact: true }).click() // FB1 D-FB1-03·D-FB1-18
    await thanks.getByLabel('몇 초 동안의 판매를 한 메시지로 묶을까요? (0이면 하나씩)').fill('601')
    await page.getByRole('region', { name: '저장', exact: true }).getByRole('button', { name: '저장' }).click() // FB1 D-FB1-06
    await expect(thanks.getByRole('alert').first()).toBeVisible()
    await expect(preview).not.toContainText('16번 라울')
    await thanks.getByLabel('몇 초 동안의 판매를 한 메시지로 묶을까요? (0이면 하나씩)').fill('30')
    await page.getByRole('region', { name: '저장', exact: true }).getByRole('button', { name: '저장' }).click() // FB1 D-FB1-06
    await expect(preview).toContainText('15번 핑크프릴 10,000원 홍길동님, 16번 라울 5,000원 김철수님 구매 감사합니다')
  })
})

test.describe('@youtube 콘솔 잇기·수집', () => {
  test('AC-I3-21·24: 내 라이브 목록 — 방송 중·예정·다른 회차에 이은 것, 예정 방송을 이으면 "유튜브 방송이 시작되면 채팅을 받아요." → 시작하면 받는 중', async ({ page }) => {
    await loginNewSeller(page)
    const channel = await connectYoutube(page)
    await fakeBroadcast(page.request, channel.id, { title: '진행 라이브' })
    const upcoming = await fakeBroadcast(page.request, channel.id, { title: '예정 라이브', status: 'upcoming' })
    const used = await fakeBroadcast(page.request, channel.id, { title: '쓰는 라이브' })
    const other = await openRealBroadcast(page, { title: '다른 회차' })
    await linkByAddress(page, used.videoId)
    void other
    await openRealBroadcast(page, { title: '이번 회차' })
    const yt = consoleYoutube(page)
    await yt.getByRole('button', { name: '내 라이브 목록에서 고르기' }).click()
    await expect(yt.getByRole('radio', { name: /진행 라이브 방송 중/ })).toBeEnabled()
    await expect(yt.getByRole('radio', { name: /예정 라이브 예정/ })).toBeEnabled()
    await expect(yt.getByRole('radio', { name: /쓰는 라이브.*다른 방송에 이어져 있어요/ })).toBeDisabled()
    await yt.getByRole('radio', { name: /예정 라이브/ }).check()
    await yt.getByRole('button', { name: '이 방송에 잇기' }).first().click()
    const group = yt.getByRole('group', { name: '채팅 수집' })
    await expect(group).toContainText('유튜브 방송이 시작되면 채팅을 받아요.')
    await expect(page.locator('.console-sticky').getByRole('alert')).toHaveCount(0)
    await fake(page.request, '/_fake/start-broadcast', { videoId: upcoming.videoId })
    await expect(group).not.toContainText('유튜브 방송이 시작되면 채팅을 받아요.', { timeout: 45_000 })
    await fakeChat(page.request, upcoming.liveChatId, 'UCv9', '보는사람', '15번 예뻐요')
    await expect(group).toContainText('채팅을 받는 중')
    await expect(group).toContainText('받은 채팅 1개')
    await expect(group).toContainText(/마지막 채팅 오[전후] \d+:\d\d:\d\d/)
  })

  test('TE-I3-001 AC-I3-24: 채팅이 조용한 라이브를 이어도(예정 방송이 시작돼도) 수집이 붙으면 "채팅을 받는 중" — "시작하는 중"에 머물지 않는다', async ({ page }) => {
    test.setTimeout(150_000)
    await loginNewSeller(page)
    const channel = await connectYoutube(page)
    const live = await fakeBroadcast(page.request, channel.id, { title: '조용한 라이브' })
    await openRealBroadcast(page, { title: '조용한 회차' })
    await linkByAddress(page, live.videoId)
    const group = consoleYoutube(page).getByRole('group', { name: '채팅 수집' })
    await expect(group).toContainText('채팅을 받는 중', { timeout: 15_000 })
    const upcoming = await fakeBroadcast(page.request, channel.id, { title: '조용한 예정', status: 'upcoming' })
    await openRealBroadcast(page, { title: '조용한 예정 회차' })
    await linkByAddress(page, upcoming.videoId)
    const group2 = consoleYoutube(page).getByRole('group', { name: '채팅 수집' })
    await expect(group2).toContainText('유튜브 방송이 시작되면 채팅을 받아요.')
    await fake(page.request, '/_fake/start-broadcast', { videoId: upcoming.videoId })
    await expect(group2).toContainText('채팅을 받는 중', { timeout: 60_000 })
  })

  test('AC-I3-22: 주소 모양 — watch?v=·youtu.be·/live/·studio·영상 ID, 잘못된 주소는 칸 옆 문장 + 잇기 잠김', async ({ page }) => {
    await loginNewSeller(page)
    await connectYoutube(page)
    await openRealBroadcast(page, { title: '주소 회차' })
    const yt = consoleYoutube(page)
    const field = yt.getByLabel('주소 붙여넣기')
    const id = 'abcdefghijk'
    for (const url of [`https://www.youtube.com/watch?v=${id}`, `https://youtu.be/${id}`, `https://www.youtube.com/live/${id}`, `https://studio.youtube.com/video/${id}/livestreaming`, id]) {
      await field.fill(url)
      await field.press('Enter')
      await expect(yt.getByText(`읽은 영상: ${id}`), url).toBeVisible()
      await expect(yt.getByRole('button', { name: '이 방송에 잇기' }).last()).toBeEnabled()
    }
    await field.fill('https://example.com/watch?v=abc')
    await field.press('Enter')
    await expect(yt.getByText('유튜브 방송 주소를 확인해 주세요.')).toBeVisible()
    await expect(yt.getByRole('button', { name: '이 방송에 잇기' }).last()).toBeDisabled()
  })

  test('AC-I3-23: 남의 채널 방송 → 서버 문장, 첫 응답이 끊기면 같은 요청 번호로 다시 보내 한 번만 잇는다', async ({ page }) => {
    await loginNewSeller(page)
    const channel = await connectYoutube(page)
    const stranger = await fake<{ id: string }>(page.request, '/_fake/channels', { title: '남의 채널' })
    const foreign = await fakeBroadcast(page.request, stranger.id, { title: '남의 라이브' })
    await openRealBroadcast(page, { title: '잇기 회차' })
    const yt = consoleYoutube(page)
    const field = yt.getByLabel('주소 붙여넣기')
    await field.fill(foreign.videoId)
    await field.press('Enter')
    await yt.getByRole('button', { name: '이 방송에 잇기' }).last().click()
    await expect(yt.getByText('내 채널의 방송만 연결할 수 있어요.')).toBeVisible()
    const mine = await fakeBroadcast(page.request, channel.id, { title: '내 라이브' })
    const bodies: string[] = []
    let cut = true
    await page.route('**/api/broadcasts/*/youtube', async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      bodies.push(route.request().postData() ?? '')
      if (cut) {
        cut = false
        await route.fetch()
        return route.abort('connectionreset')
      }
      return route.continue()
    })
    await field.fill(mine.videoId)
    await field.press('Enter')
    await yt.getByRole('button', { name: '이 방송에 잇기' }).last().click()
    await expect(yt.getByRole('group', { name: '채팅 수집' })).toBeVisible()
    await expect.poll(() => bodies.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2)
    expect(new Set(bodies.map((b) => (JSON.parse(b) as { requestId: string }).requestId)).size).toBe(1)
    await expect(yt.getByText('이미', { exact: false })).toHaveCount(0)
    await expect(yt.getByRole('alert')).toHaveCount(0)
  })

  test('AC-I3-26: 잇기 해제 확인 창 → 끊으면 다시 이을 수 있음', async ({ page }) => {
    await linkedConsole(page, { consent: false })
    const yt = consoleYoutube(page)
    await yt.getByRole('button', { name: '유튜브 방송 연결 끊기' }).click()
    const dlg = page.getByRole('dialog', { name: '유튜브 방송 연결 끊기' })
    await expect(dlg).toContainText('끊으면 이 방송의 채팅을 더 받지 않아요. 이미 받은 찜은 그대로예요.')
    await expect(dlg.getByRole('button', { name: '그대로 두기' })).toBeFocused()
    await dlg.getByRole('button', { name: '연결 끊기' }).click()
    await expect(yt.getByRole('button', { name: '내 라이브 목록에서 고르기' })).toBeVisible()
  })

  test('AC-I3-27: 시청자 알림 — 지운 메시지(주문이었던 메시지)·유튜브 차단(라이브지니에서도 차단 → 차단 창)', async ({ page }) => {
    const { live } = await linkedConsole(page, { consent: false })
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

test.describe('@youtube 감사 메시지 목록', () => {
  test('AC-I3-30·32: 동의 없이 판매 3건 → 알림 띠에 감사 실패 없음, 목록 "자동으로 보내지 않은 감사 3" → 하나 다시 보내기 → 게시 1번', async ({ page }) => {
    const { live, date, channel } = await linkedConsole(page, { consent: false })
    for (const [no, name] of [[21, '가'], [22, '나'], [23, '다']] as const) {
      await register(page, `${String(no)} 상품${name} 10`, no)
      await fakeChat(page.request, live.liveChatId, `UCbuyer${name}`, `구매자${name}`, String(no))
      await expect(boardItem(page, no)).toContainText(`구매자${name}`)
    }
    await expect.poll(async () => (await outboxRows(page, date)).filter((r) => r.reason === 'NO_CONSENT').length).toBe(3)
    await expect(alertStrip(page).getByRole('button', { name: /감사 실패/ })).toHaveCount(0)
    // 동의(글쓰기 권한)는 판매 뒤에 — 그 전 판매는 목록에서 하나씩 보낸다
    const consoleUrl = page.url()
    await consentLiveChat(page, channel)
    await page.goto(consoleUrl)
    await consoleYoutube(page).getByRole('button', { name: '감사 메시지' }).click()
    const dlg = page.getByRole('dialog', { name: '감사 메시지' })
    const notSent = dlg.getByRole('region', { name: '자동으로 보내지 않은 감사' })
    await expect(notSent.getByRole('heading')).toHaveText('자동으로 보내지 않은 감사 3')
    await expect(notSent).toContainText('자동 게시에 동의하기 전의 감사예요.')
    const row = notSent.getByRole('listitem').filter({ hasText: '22번 상품나 10,000원 구매자나님 구매 감사합니다' })
    await row.getByRole('button', { name: '다시 보내기' }).click()
    await expect(dlg.getByRole('region', { name: '보냄' })).toBeVisible({ timeout: 15_000 })
    await expect.poll(async () => (await fakeState(page.request)).posted.filter((p) => p.liveChatId === live.liveChatId && p.text.includes('22번 상품나')).length).toBe(1)
    const text = await dlg.innerText()
    for (const word of ['FAILED', 'NO_CONSENT', 'SENT', 'LIVE_CHAT']) expect(text).not.toContain(word)
    await page.keyboard.press('Escape')
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
  })

  test('AC-I3-98·30·32·35: 동의 → 15번 감사 한 번 게시 → 게시 거절 → "감사 실패 1" → 알림에서 빼기 → 0 → 다시 보내기 → 게시', async ({ page }) => {
    const { live, date } = await linkedConsole(page, { consent: true })
    await register(page, '15 핑크프릴 10', 15)
    await fakeChat(page.request, live.liveChatId, 'UChong', '홍길동', '15')
    await fakeChat(page.request, live.liveChatId, 'UCkim', '김철수', '15번 예뻐요')
    await expect(boardItem(page, 15)).toContainText('홍길동')
    await expect.poll(async () => (await fakeState(page.request)).posted.filter((p) => p.liveChatId === live.liveChatId && p.text === '15번 핑크프릴 10,000원 홍길동님 구매 감사합니다').length, { timeout: 20_000 }).toBe(1)
    await fake(page.request, '/_fake/fail', { method: 'liveChatMessages.insert', fault: { status: 400, reason: 'invalidValue' }, times: 1 })
    await register(page, '16 라울 5', 16)
    await fakeChat(page.request, live.liveChatId, 'UCkim2', '김철수', '16')
    const failed = alertStrip(page).getByRole('button', { name: '감사 실패 1' })
    await expect(failed).toBeVisible({ timeout: 20_000 })
    // Alt+1: 첫 알림(여기선 감사 실패뿐)
    await page.getByLabel('빠른 입력').focus()
    await page.keyboard.press('Alt+1')
    const dlg = page.getByRole('dialog', { name: '감사 메시지' })
    await expect(dlg).toBeVisible()
    const attention = dlg.getByRole('region', { name: '확인이 필요한 감사' })
    await expect(attention.getByRole('heading')).toHaveText('확인이 필요한 감사 1')
    await attention.getByRole('button', { name: '알림에서 빼기' }).click()
    await expect(alertStrip(page).getByRole('button', { name: /감사 실패/ })).toHaveCount(0)
    const notSent = dlg.getByRole('region', { name: '자동으로 보내지 않은 감사' })
    await expect(notSent).toContainText('알림에서 뺌')
    await notSent.getByRole('button', { name: '다시 보내기' }).click()
    await expect.poll(async () => (await outboxRows(page, date)).filter((r) => r.state === 'SENT').length, { timeout: 15_000 }).toBe(2)
    expect((await fakeState(page.request)).posted.filter((p) => p.liveChatId === live.liveChatId && p.text.includes('16번 라울')).length).toBe(1)
  })

  test('AC-I3-33: 확인하지 못한 감사 — 경고 문장, "유튜브에 올라가 있어요" 확인 창 → 보냄 — 판매자가 확인함, 알림 띠 줄어듦', async ({ page }) => {
    test.setTimeout(180_000)
    const { b, date } = await linkedConsole(page, { consent: true })
    await register(page, '31 확인상품 10', 31)
    // 수집 스트림·목록 조회를 막고(우리 글을 볼 길을 없앰) 게시는 받되 응답 없음 → 확인 못 함. 판매는 문자찜으로
    await fake(page.request, '/_fake/fail', { method: 'liveChatMessages.streamList', fault: { kind: 'hang' }, times: 1000 })
    await fake(page.request, '/_fake/fail', { method: 'liveChatMessages.list', fault: { status: 500 }, times: 1000 })
    await fake(page.request, '/_fake/drop-streams')
    await fake(page.request, '/_fake/fail', { method: 'liveChatMessages.insert', fault: { kind: 'acceptHang' }, times: 1 })
    await smsApi(page, { b, no: 31, phone: '010-2222-3333' })
    await expect.poll(async () => (await outboxRows(page, date)).some((r) => r.text.includes('31번') && r.state === 'SENDING'), { timeout: 20_000 }).toBe(true)
    const failed = alertStrip(page).getByRole('button', { name: '감사 실패 1' })
    await expect(failed).toBeVisible({ timeout: 90_000 })
    await failed.click()
    const dlg = page.getByRole('dialog', { name: '감사 메시지' })
    const row = dlg.getByRole('region', { name: '확인이 필요한 감사' }).getByRole('listitem')
    await expect(row).toContainText('올라갔는지 확인하지 못했어요. 유튜브에서 확인하고 없으면 다시 보내 주세요.')
    await expect(row).toContainText('이미 올라갔을 수 있어요. 유튜브 채팅에서 먼저 확인해 주세요.')
    await expect(row.getByRole('button', { name: '알림에서 빼기' })).toHaveCount(0)
    // 다시 보내기 → 확인 창(처음 포커스 그만두기), Esc면 요청 없음
    const resends: string[] = []
    page.on('request', (r) => {
      if (r.url().includes('/resend')) resends.push(r.url())
    })
    await row.getByRole('button', { name: '다시 보내기' }).click()
    const ask = page.getByRole('dialog', { name: '유튜브에 이 글이 없는 걸 확인했나요?' })
    await expect(ask.getByRole('button', { name: '그만두기' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(ask).toHaveCount(0)
    expect(resends).toEqual([])
    await row.getByRole('button', { name: '유튜브에 올라가 있어요' }).click()
    const posted = page.getByRole('dialog', { name: '유튜브에 이 글이 올라가 있는 걸 확인했나요?' })
    await expect(posted.getByRole('button', { name: '그만두기' })).toBeFocused()
    await posted.getByRole('button', { name: '올라가 있어요' }).click()
    await expect(alertStrip(page).getByRole('button', { name: /감사 실패/ })).toHaveCount(0)
    const sent = page.getByRole('dialog', { name: '감사 메시지' }).getByRole('region', { name: '보냄' })
    await sent.getByRole('button', { name: '펼치기' }).click()
    await expect(sent).toContainText('보냄 — 판매자가 확인함')
    const rows = await outboxRows(page, date)
    expect(rows.find((r) => r.text.includes('31번'))?.confirmedBySeller).toBe(true)
    expect(rows.find((r) => r.text.includes('31번'))?.state).toBe('SENT')
  })
})

test.describe('@youtube 이스케이프·실시간', () => {
  test('AC-I3-91: 채널 이름·방송 제목·시청자 이름의 태그·방향 글자는 글자로만 — img·script 없음, 대화상자 없음', async ({ page }) => {
    const dialogs: string[] = []
    page.on('dialog', (d) => {
      dialogs.push(d.message())
      void d.dismiss()
    })
    const evil = '<img src=x onerror="window.__pwned=1">\u202E'
    await loginNewSeller(page)
    const channel = await connectYoutube(page, `채널${evil}`)
    await expect(settingsRegion(page, '유튜브')).toContainText('<img src=x')
    const live = await fakeBroadcast(page.request, channel.id, { title: `<script>window.__pwned=2</script>방송${evil}` })
    await openRealBroadcast(page, { title: '이스케이프 회차' })
    const yt = consoleYoutube(page)
    await yt.getByRole('button', { name: '내 라이브 목록에서 고르기' }).click()
    await expect(yt).toContainText('<script>window.__pwned=2</script>')
    await yt.getByRole('radio').first().check()
    await yt.getByRole('button', { name: '이 방송에 잇기' }).first().click()
    await expect(yt.getByRole('group', { name: '채팅 수집' })).toBeVisible()
    await register(page, '15 핑크프릴 10', 15)
    await fakeChat(page.request, live.liveChatId, 'UCevil', `<img src=y onerror="window.__pwned=3">`, '15')
    await expect(boardItem(page, 15)).toContainText('<img src=y')
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined()
    expect(await page.locator('main img[src="x"], main img[src="y"], main script').count()).toBe(0)
    expect(dialogs).toEqual([])
  })

  test('AC-I3-92: 실시간이 끊긴 동안 다른 기기에서 끊은 연결이, 다시 이어지면 보인다', async ({ page, browser }) => {
    await loginNewSeller(page)
    await connectYoutube(page, '끊김 채널')
    await page.goto('/settings/youtube')
    const yt = settingsRegion(page, '유튜브')
    await expect(yt.getByText('읽기 권한 있음')).toBeVisible()
    const otherCtx = await browser.newContext()
    await otherCtx.addCookies(await page.context().cookies())
    const other = await otherCtx.newPage()
    await other.goto('/settings')
    // 이 기기의 실시간 연결을 끊고(진행 중인 받기 멈춤) 다시 붙지 못하게 막는다
    await page.route('**/api/stream', (route) => route.abort())
    await page.evaluate(() => window.stop())
    const res = await other.request.post('/api/youtube/connection/disconnect', { data: {}, headers: { Origin: new URL(other.url()).origin } })
    expect(res.ok()).toBe(true)
    await other.waitForTimeout(1500)
    // 끊긴 동안에는 바뀐 것을 모른다(실시간이 정말 끊겼다)
    await expect(yt.getByText('읽기 권한 있음')).toBeVisible()
    await page.unroute('**/api/stream')
    await expect(yt.getByRole('button', { name: '구글로 유튜브 연결하기' })).toBeVisible({ timeout: 20_000 })
    await otherCtx.close()
  })

  test('AC-I3-13: 다른 기기에서 동의를 끄면 이 기기의 요약 한 줄이 1초 안에 바뀐다', async ({ page, browser }) => {
    await loginNewSeller(page)
    const channel = await connectYoutube(page)
    await consentLiveChat(page, channel)
    const summary = settingsRegion(page, '구매 감사 메시지').getByRole('region', { name: '지금 설정의 결과' })
    await expect(summary).toContainText('실시간 채팅 — 다음 방송부터 자동으로 남겨요')
    const otherCtx = await browser.newContext()
    await otherCtx.addCookies(await page.context().cookies())
    const other = await otherCtx.newPage()
    await other.goto('/settings')
    await settingsRegion(other, '구매 감사 메시지').getByRole('button', { name: '실시간 채팅 자동 게시 끄기' }).click()
    await expect(summary).toContainText('실시간 채팅 — 감사 메시지를 만들기만 하고 자동으로 올리지 않아요.', { timeout: 1500 })
    await otherCtx.close()
  })

  test('AC-I3-02: 그 밖의 결과 값·채널 없는 계정 — 정해진 문장만, 주소에서 지움', async ({ page }) => {
    await loginNewSeller(page)
    await page.goto('/settings/youtube?youtube=%3Cimg%20src%3Dx%3E')
    await expect(page.getByRole('status').filter({ hasText: '연결 결과를 알 수 없어요. 아래 연결 상태를 확인해 주세요.' })).toBeVisible()
    await expect(page).toHaveURL(/\/settings\/youtube$/)
    expect(await page.locator('main img').count()).toBe(0)
    const { account } = await fake<{ account: string }>(page.request, '/_fake/accounts')
    await fake(page.request, '/_fake/approval', { account })
    await page.goto('/settings/youtube')
    await settingsRegion(page, '유튜브').getByRole('button', { name: '구글로 유튜브 연결하기' }).click()
    await expect(page.getByRole('status').filter({ hasText: '이 구글 계정에는 유튜브 채널이 없어요.' })).toBeVisible()
  })

})
