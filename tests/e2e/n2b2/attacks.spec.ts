// N2b-2 E2E 깨뜨리기 (test-e2e 라운드 0). 여러 플랫폼 묶음(@multi). 문장은 acceptance.md 그대로.
import { expect, test } from '@playwright/test'
import {
  CONSENT_CHECKBOX,
  boardItem,
  consoleTiktok,
  linkTiktokUi,
  loginAs,
  newRehearsal,
  openRealBroadcast,
  pasteDialog,
  registerApi,
  scopeView,
  tiktokSeller,
  tt,
  ttComment,
  ttSettings,
  type Seller,
  connectYoutube,
  fakeBroadcast,
  fakeChat,
  linkByAddress,
  meta,
  openSms,
  postJson,
  settingsRegion,
  MULTI_NOTICE,
  ttState,
  CONNECT_WAIT,
  unlinkTiktok,
} from './support.ts'

test.describe('N2b-2 깨뜨리기 @multi', () => {
  // 서버 전체 연결 시도 한도(60초에 30번) 때문에 잇기·다시 붙기가 최대 60초 미뤄질 수 있다 (support.ts CONNECT_WAIT)
  test.describe.configure({ timeout: 300_000 })
  test.afterEach(async ({ page }) => {
    await unlinkTiktok(page)
  })
  test('붙여넣기 창에 키보드로 직접 쓰기(숫자·Enter 줄바꿈) — 콘솔 단축키가 가로채지 않고, 그동안 틱톡 댓글이 와도 글이 그대로 @multi', async ({ page }) => {
    const { tiktokId } = await tiktokSeller(page)
    const { b, date } = await openRealBroadcast(page)
    for (const no of [15, 16, 17]) await registerApi(page, b, no, `상품${String(no)}`, 10_000)
    await expect(boardItem(page, 17)).toBeVisible()
    await linkTiktokUi(page)
    await consoleTiktok(page).getByRole('button', { name: '댓글 붙여넣기' }).click()
    const dlg = pasteDialog(page)
    const area = dlg.getByLabel('붙여 넣을 댓글')
    await expect(area).toBeFocused()
    await page.keyboard.type('꽃집손님: 15')
    await page.keyboard.press('Enter')
    // 그 사이 틱톡 댓글이 들어온다 (채팅·보드가 바뀐다)
    await ttComment(page.request, tiktokId, '틱톡손님', '17')
    await expect(boardItem(page, 17)).toContainText('틱톡손님')
    await page.keyboard.type('구경꾼: 1 2 3')
    await page.keyboard.press('Enter')
    await page.keyboard.type('단골: 16')
    await expect(area).toBeFocused()
    await expect(area).toHaveValue('꽃집손님: 15\n구경꾼: 1 2 3\n단골: 16')
    await expect(dlg).toBeVisible()
    // 키보드만으로 미리 보기 → 넣기
    await page.keyboard.press('Tab')
    await expect(dlg.getByRole('button', { name: '미리 보기' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(dlg.getByRole('list', { name: '줄마다 결과' }).getByRole('listitem')).toHaveCount(3)
    const go = dlg.getByRole('button', { name: /^찜 \d+개 넣기$/ })
    await expect(go).toBeEnabled()
    await go.focus()
    await page.keyboard.press('Enter')
    await expect(dlg).toHaveCount(0)
    const view = await scopeView(page, date, false)
    // 콘솔 빠른 입력·단축키로 엉뚱한 기록이 생기지 않았다 (상품 셋 그대로, 붙여넣기 찜 15·16)
    expect(view.products.map((p) => p.no).sort((x, y) => x - y)).toEqual([15, 16, 17])
    expect(view.claims.filter((c) => c.no === 15)).toHaveLength(1)
    expect(view.claims.filter((c) => c.no === 16)).toHaveLength(1)
  })

  test('미리 보기 뒤 글을 고치면 넣을 수 없고 안내가 보인다 — 다시 미리 보면 넣을 수 있다 @multi', async ({ page }) => {
    await tiktokSeller(page)
    const { b } = await openRealBroadcast(page)
    await registerApi(page, b, 15, '라울', 10_000)
    await linkTiktokUi(page)
    await consoleTiktok(page).getByRole('button', { name: '댓글 붙여넣기' }).click()
    const dlg = pasteDialog(page)
    const area = dlg.getByLabel('붙여 넣을 댓글')
    await area.fill('가: 15')
    await dlg.getByRole('button', { name: '미리 보기' }).click()
    await expect(dlg.getByRole('button', { name: '찜 1개 넣기' })).toBeEnabled()
    await area.fill('가: 15 16')
    await expect(dlg.getByText('글을 고쳤어요. 미리 보기를 다시 해 주세요.')).toBeVisible()
    await expect(dlg.getByRole('button', { name: /^찜 \d+개 넣기$/ })).toBeDisabled()
  })

  test('PC에서 틱톡을 잇고 끊으면 휴대폰 콘솔도 새로 고침 없이 바뀐다 @multi', async ({ page, browser }) => {
    const { seller } = await tiktokSeller(page)
    const { b } = await openRealBroadcast(page)
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(page.url()).origin })
    const phone = await ctx.newPage()
    await loginAs(phone, seller as Seller)
    await phone.goto(`/broadcasts/${b}`)
    await expect(consoleTiktok(phone).getByRole('button', { name: '틱톡 잇기' })).toBeVisible()
    await linkTiktokUi(page)
    await expect(consoleTiktok(phone).getByText('틱톡 댓글을 받고 있어요.')).toBeVisible({ timeout: CONNECT_WAIT })
    await consoleTiktok(page).getByRole('button', { name: '끊기' }).click()
    const dlg = page.getByRole('dialog', { name: '틱톡 연결 끊기' })
    await expect(dlg.getByText('끊으면 이 방송의 틱톡 댓글을 더 받지 않아요. 이미 받은 찜은 그대로예요.')).toBeVisible()
    await dlg.getByRole('button', { name: '끊기' }).click()
    await expect(consoleTiktok(page).getByRole('button', { name: '틱톡 잇기' })).toBeVisible()
    await expect(consoleTiktok(phone).getByRole('button', { name: '틱톡 잇기' })).toBeVisible()
    await ctx.close()
  })

  test('AC-N2b-2-34 막힌 뒤 "다시 연결"을 30초 안에 누르면 "잠시 뒤 다시 눌러 주세요." @multi', async ({ page }) => {
    const { tiktokId } = await tiktokSeller(page)
    await openRealBroadcast(page)
    await linkTiktokUi(page)
    await tt(page.request, 'block', { uniqueId: tiktokId, times: 1 })
    const region = consoleTiktok(page)
    const again = region.getByRole('button', { name: '다시 연결' })
    await expect(again).toBeVisible()
    await again.click()
    await expect(region.getByText('잠시 뒤 다시 눌러 주세요.')).toBeVisible()
    // 막힘 한 번은 이 판매자의 다시 시도가 썼다 — 다시 붙기를 기다린다
    await expect(region.getByText('틱톡 댓글을 받고 있어요.')).toBeVisible({ timeout: CONNECT_WAIT })
  })

  test('AC-N2b-2-60 리허설 콘솔에는 인스타그램·틱톡 칸 대신 "리허설 방송에는 라이브를 이을 수 없어요." @multi', async ({ page }) => {
    await tiktokSeller(page)
    await page.goto('/')
    await newRehearsal(page)
    const region = page.getByRole('region', { name: '인스타그램·틱톡', exact: true })
    await expect(region.getByText('리허설 방송에는 라이브를 이을 수 없어요.')).toBeVisible()
    await expect(page.getByRole('button', { name: '틱톡 잇기' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '인스타그램 기다리기' })).toHaveCount(0)
  })

  test('방송을 끝낸 뒤 다음 방송에 바로 틱톡을 이을 수 있다 (끝난 회차가 막지 않는다) @multi', async ({ page }) => {
    await tiktokSeller(page)
    await openRealBroadcast(page)
    await linkTiktokUi(page)
    await page.getByRole('button', { name: '방송 끝내기' }).click()
    await page.getByRole('dialog', { name: '방송 끝내기' }).getByRole('button', { name: '끝내기' }).click()
    await expect(consoleTiktok(page).getByText('방송을 끝내 댓글 기록을 마쳤어요.')).toBeVisible()
    await openRealBroadcast(page)
    await linkTiktokUi(page)
  })

  test('AC-N2b-2-24 이어진 동안 설정에서 아이디를 바꾸면 "먼저 틱톡 연결을 끊어 주세요." — 바뀌지 않는다 @multi', async ({ page }) => {
    const { tiktokId } = await tiktokSeller(page)
    await openRealBroadcast(page)
    await linkTiktokUi(page)
    await page.goto('/settings/tiktok')
    const region = ttSettings(page)
    await region.getByLabel('내 틱톡 아이디').fill('@another_one')
    await region.getByRole('button', { name: '저장', exact: true }).click()
    await expect(region.getByText('먼저 틱톡 연결을 끊어 주세요.')).toBeVisible()
    const got = (await (await page.request.get('/api/tiktok')).json()) as { tiktok: { tiktokId: string } }
    expect(got.tiktok.tiktokId).toBe(tiktokId)
  })

  test('AC-N2b-2-25 끈 뒤 다시 켜기: 체크 상자는 다시 체크해야 켜기를 누를 수 있다 @multi', async ({ page }) => {
    await tiktokSeller(page)
    await page.goto('/settings/tiktok')
    const region = ttSettings(page)
    await region.getByRole('button', { name: '끄기', exact: true }).click()
    await page.getByRole('dialog', { name: '틱톡 연결 끄기' }).getByRole('button', { name: '끄기', exact: true }).click()
    const box = region.getByRole('checkbox', { name: CONSENT_CHECKBOX })
    await expect(box).not.toBeChecked()
    await expect(region.getByRole('button', { name: '켜기', exact: true })).toBeDisabled()
  })

  test('AC-N2b-2-65 유튜브만 이은 회차는 채팅에 플랫폼 글자가 없고, 틱톡을 이으면 유튜브 줄에도 붙는다 · AC-N2b-2-61 하나로 줄면 도착순 안내가 사라진다 @multi', async ({ page }) => {
    const { tiktokId } = await tiktokSeller(page)
    const channel = await connectYoutube(page)
    const yt = await fakeBroadcast(page.request, channel.id)
    const { b } = await openRealBroadcast(page)
    await registerApi(page, b, 15, '라울', 10_000)
    await linkByAddress(page, yt.videoId)
    await fakeChat(page.request, yt.liveChatId, 'UCyoutubeonly00000000001', '유튜브만손님', '예뻐요')
    const chat = page.getByRole('region', { name: '채팅' })
    await expect(chat.getByText('유튜브만손님')).toBeVisible({ timeout: 30_000 })
    await expect(chat.locator('.tag-platform')).toHaveCount(0)
    await expect(page.getByText(MULTI_NOTICE)).toHaveCount(0)
    await linkTiktokUi(page)
    await expect(page.getByText(MULTI_NOTICE)).toBeVisible()
    await expect(chat.getByRole('listitem').filter({ hasText: '유튜브만손님' }).locator('.tag-platform')).toHaveText('유튜브')
    await ttComment(page.request, tiktokId, '틱톡만손님', '안녕')
    await expect(chat.getByRole('listitem').filter({ hasText: '틱톡만손님' }).locator('.tag-platform')).toHaveText('틱톡')
    await consoleTiktok(page).getByRole('button', { name: '끊기' }).click()
    await page.getByRole('dialog', { name: '틱톡 연결 끊기' }).getByRole('button', { name: '끊기' }).click()
    await expect(page.getByText(MULTI_NOTICE)).toHaveCount(0)
  })

  test('AC-N2b-2-67 인스타그램 연결에서 돌아오면 결과 문장을 한 번 보이고 주소에서 지운다 (새로 고침해도 다시 안 보임) @multi', async ({ page }) => {
    await tiktokSeller(page)
    const { account } = await meta<{ account: { id: string } }>(page.request, '/_fake/accounts', { username: `shop.${Math.random().toString(36).slice(2, 7)}` })
    await meta(page.request, '/_fake/login', { accounts: [account.id] })
    await page.goto('/settings/instagram')
    await settingsRegion(page, '인스타그램').getByRole('button', { name: '인스타그램 연결하기' }).click()
    await expect(page.getByText('인스타그램 계정을 연결했어요.')).toBeVisible()
    await expect.poll(() => new URL(page.url()).searchParams.get('instagram')).toBeNull()
    await page.reload()
    await expect(settingsRegion(page, '인스타그램')).toBeVisible()
    await expect(page.getByText('인스타그램 계정을 연결했어요.')).toHaveCount(0)
  })

  test('AC-N2b-2-59 판매자는 문자찜 화면에서 리허설 방송에도 붙여 넣을 수 있다 — 찜은 리허설 범위에 @multi', async ({ page }) => {
    await tiktokSeller(page)
    const title = `리허설 붙여넣기 ${String(Date.now())}`
    const res = await postJson(page, '/api/broadcasts', { requestId: crypto.randomUUID(), rehearsal: true, title })
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
    const b = (res.body['broadcast'] as { id: string; date: string } | undefined) ?? null
    expect(b).not.toBeNull()
    await registerApi(page, b!.id, 15, '라울', 10_000)
    await openSms(page, title)
    await page.getByRole('region', { name: '고른 방송' }).getByRole('button', { name: '댓글 붙여넣기' }).click()
    const dlg = pasteDialog(page)
    await dlg.getByLabel('붙여 넣을 댓글').fill('리허설손님: 15')
    await dlg.getByRole('button', { name: '미리 보기' }).click()
    await dlg.getByRole('button', { name: '찜 1개 넣기' }).click()
    await expect(page.getByText('찜 1개를 넣었어요.')).toBeVisible()
    const rehearsal = await scopeView(page, b!.date, true)
    expect(rehearsal.claims.filter((c) => c.no === 15)).toHaveLength(1)
  })

  test('AC-N2b-2-62 틱톡 방송이 끝나면 "틱톡 방송이 끝났어요."와 "다시 연결" @multi', async ({ page }) => {
    const { tiktokId } = await tiktokSeller(page)
    await openRealBroadcast(page)
    await linkTiktokUi(page)
    await tt(page.request, 'end', { uniqueId: tiktokId })
    const region = consoleTiktok(page)
    await expect(region.getByText('틱톡 방송이 끝났어요.')).toBeVisible()
    await expect(region.getByRole('button', { name: '다시 연결' })).toBeVisible()
  })

  test('AC-N2b-2-02 PC와 휴대폰이 같은 방송에 "틱톡 잇기"를 함께 눌러도 연결 하나·연결 시도 한 번, 둘 다 이어진 칸을 본다 @multi', async ({ page, browser }) => {
    const { seller } = await tiktokSeller(page)
    const { b } = await openRealBroadcast(page)
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(page.url()).origin })
    const phone = await ctx.newPage()
    await loginAs(phone, seller as Seller)
    await phone.goto(`/broadcasts/${b}`)
    const pcButton = consoleTiktok(page).getByRole('button', { name: '틱톡 잇기' })
    const phoneButton = consoleTiktok(phone).getByRole('button', { name: '틱톡 잇기' })
    await expect(phoneButton).toBeVisible()
    const before = (await ttState(page.request)).attempts
    await Promise.all([pcButton.click(), phoneButton.click()])
    // 두 화면 모두 이어진 칸 (상태 문장은 TE-N2b-2-003이 따로 본다)
    await expect(consoleTiktok(page).getByRole('button', { name: '끊기' })).toBeVisible()
    await expect(consoleTiktok(phone).getByRole('button', { name: '끊기' })).toBeVisible()
    await expect
      .poll(async () => ((await (await page.request.get(`/api/broadcasts/${b}/tiktok`)).json()) as { link: { collection: { state: string } | null } }).link.collection?.state, { timeout: CONNECT_WAIT })
      .toBe('CONNECTED')
    expect((await ttState(page.request)).attempts - before).toBe(1)
    const links = (await (await page.request.get(`/api/broadcasts/${b}/live`)).json()) as { links: { platform: string }[] }
    expect(links.links.filter((l) => l.platform === 'TIKTOK')).toHaveLength(1)
    await ctx.close()
  })

  test('TE-N2b-2-003: 잇기 응답이 실시간 알림보다 늦게 와도 틱톡 칸은 마지막 상태("받고 있어요")를 보인다 — 늦은 응답의 "연결하는 중"으로 되돌아가지 않는다 @multi', async ({ page, browser }) => {
    const { seller } = await tiktokSeller(page)
    const { b } = await openRealBroadcast(page)
    // 같은 판매자의 휴대폰 화면 — 실시간 알림이 닿았는지 보는 눈
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', baseURL: new URL(page.url()).origin })
    const phone = await ctx.newPage()
    await loginAs(phone, seller as Seller)
    await phone.goto(`/broadcasts/${b}`)
    await expect(consoleTiktok(phone).getByRole('button', { name: '틱톡 잇기' })).toBeVisible()
    // 느린 망: 서버는 잇기를 처리했지만 응답은 휴대폰이 실시간 알림으로 "받고 있어요"를 본 뒤에야 PC에 닿는다
    await page.route('**/live/link', async (route) => {
      const response = await route.fetch()
      await expect(consoleTiktok(phone).getByText('틱톡 댓글을 받고 있어요.')).toBeVisible({ timeout: CONNECT_WAIT })
      await route.fulfill({ response })
    })
    await consoleTiktok(page).getByRole('button', { name: '틱톡 잇기' }).click()
    await expect(consoleTiktok(page).getByRole('button', { name: '끊기' })).toBeVisible({ timeout: CONNECT_WAIT })
    const server = (await (await page.request.get(`/api/broadcasts/${b}/tiktok`)).json()) as { link: { collection: { state: string; message: string } } }
    expect(server.link.collection.state).toBe('CONNECTED')
    await expect(consoleTiktok(page).getByText(server.link.collection.message)).toBeVisible()
    await expect(consoleTiktok(page).getByText('틱톡에 연결하는 중이에요.')).toHaveCount(0)
    await ctx.close()
  })
})
