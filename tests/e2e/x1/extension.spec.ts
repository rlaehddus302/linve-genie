// X1 — 크롬 확장으로 유튜브 라이브 채팅 받기 (가짜 유튜브 묶음 @youtube). AC-X1-08·16·17·20, YT-10 AC3·AC4·AC7
// 압축 해제 확장을 올린 크로미움(launchPersistentContext)에서 가짜 live_chat 페이지를 연다. 판매자 화면도 같은 브라우저.
import {
  addChat,
  claimsOf,
  connectPopup,
  connectYoutube,
  consoleYoutube,
  expect,
  fake,
  fakeBroadcast,
  fakeChat,
  issueCode,
  linkByAddress,
  loginNewSeller,
  openLiveChat,
  openPopup,
  openRealBroadcast,
  pickBroadcast,
  register,
  scopeView,
  test,
} from './support.ts'

test.beforeEach(async ({ request }) => {
  await fake(request, '/_fake/clear-faults')
})

const VIDEO = 'x1PickVid01'

test('@youtube AC-X1-20: 연결 코드 → 회차 고르기 → 유튜브 채팅 "3번" 두 명 → 찜 2건, 먼저 쓴 사람이 1등', async ({ ext }) => {
  const { context, page, extId } = ext
  await loginNewSeller(page)
  const { b, date } = await openRealBroadcast(page, { title: '확장 1부' })
  await register(page, '3 확장다육 10', 3)
  const code = await issueCode(page)

  const chat = await openLiveChat(context, VIDEO)
  const popup = await openPopup(context, extId)
  await connectPopup(popup, code)
  // 영상이 이어진 회차가 없으니 고르게 한다 (오늘의 실제 회차)
  await expect(popup.getByRole('heading', { name: '어느 방송으로 받을까요?' })).toBeVisible()
  await pickBroadcast(popup, page, `확장 1부 (${date})`, b)

  // 판매자 설정에도 연결이 보인다
  await page.goto('/settings/extension')
  await expect(page.getByRole('group', { name: '확장 연결 상태' }).getByText('● 확장이 연결돼 있어요')).toBeVisible()

  const t0 = Date.now()
  await addChat(chat, { id: 'ChwKGkNPeDFfZmlyc3RfMDAwMDAwMDAwMDAwMDA', ch: 'UCx1firstviewer000000001', nick: '첫손님', text: '3번', atMs: t0 })
  await addChat(chat, { id: 'ChwKGkNPeDFfc2Vjb25kXzAwMDAwMDAwMDAwMDA', ch: 'UCx1secondviewer00000002', nick: '둘째손님', text: '3번', atMs: t0 + 1000 })

  await expect.poll(async () => claimsOf(await scopeView(page, date, false), b, 3), { timeout: 15_000 }).toBe(2)
  const view = await scopeView(page, date, false)
  const product = view.products.find((p) => p.no === 3)
  expect(product?.winners).toHaveLength(1)
  expect(product?.waitlist).toHaveLength(1)
  const first = view.claims.filter((c) => c.broadcast === b && c.no === 3).sort((x, y) => x.seq - y.seq)[0]
  expect(product?.winners).toEqual(['UCx1firstviewer000000001'])
  expect(first?.buyer).toBe('UCx1firstviewer000000001')
  // 확장 켜기 전에 있던 "3번"(이전손님)은 들어가지 않았다 — 위의 2건이 전부

  // 콘솔 유튜브 칸: 받는 길 한 줄
  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(consoleYoutube(page).getByRole('group', { name: '채팅 받는 길' })).toContainText('확장으로 받는 중')
})

test('@youtube AC-X1-20·YT-10 AC3: 공식 연결과 확장이 같은 메시지를 함께 받아도 찜은 1건', async ({ ext }) => {
  const { context, page, extId } = ext
  await loginNewSeller(page)
  const channel = await connectYoutube(page, '확장 중복 채널')
  const { videoId, liveChatId } = await fakeBroadcast(page.request, channel.id, { title: '중복 방송' })
  const { b, date } = await openRealBroadcast(page, { title: '중복 1부' })
  await register(page, '3 중복다육 10', 3)
  await register(page, '4 표시다육 10', 4)
  await register(page, '5 표시다육 10', 5)
  await linkByAddress(page, videoId)
  const code = await issueCode(page)

  const chat = await openLiveChat(context, videoId)
  const popup = await openPopup(context, extId)
  await connectPopup(popup, code)
  // 공식 연결로 이어진 영상이라 고르기 없이 그 회차로 이어진다
  await expect(popup.getByRole('status')).toHaveText('확장으로 받는 중')

  const viewer = 'UCx1dupviewer00000000001'
  const id = await fakeChat(page.request, liveChatId, viewer, '중복손님', '3번')
  await addChat(chat, { id, ch: viewer, nick: '중복손님', text: '3번' })

  // 두 경로 모두 그 뒤의 메시지까지 처리했음을 확인하는 표시 (공식만 "4번", 확장만 "5번")
  await fakeChat(page.request, liveChatId, 'UCx1officialonly00000001', '공식손님', '4번')
  await addChat(chat, { id: 'ChwKGkNPeDFfZXh0b25seV8wMDAwMDAwMDAwMDA', ch: 'UCx1extonly0000000000001', nick: '확장손님', text: '5번' })
  await expect.poll(async () => {
    const v = await scopeView(page, date, false)
    return claimsOf(v, b, 4) === 1 && claimsOf(v, b, 5) === 1
  }, { timeout: 30_000 }).toBe(true)

  expect(claimsOf(await scopeView(page, date, false), b, 3)).toBe(1)

  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(consoleYoutube(page).getByRole('group', { name: '채팅 받는 길' })).toContainText('공식 연결·확장 둘 다로 받는 중')
})

test('@youtube YT-10 AC4: 설정에서 "끊기" → 확장 요청이 거절되고 팝업에 끊김 안내, 그 뒤 채팅은 기록되지 않는다', async ({ ext }) => {
  const { context, page, extId } = ext
  await loginNewSeller(page)
  const { b, date } = await openRealBroadcast(page, { title: '끊기 1부' })
  await register(page, '3 끊기다육 10', 3)
  const code = await issueCode(page)

  const chat = await openLiveChat(context, 'x1CutVideo1')
  const popup = await openPopup(context, extId)
  await connectPopup(popup, code)
  await pickBroadcast(popup, page, `끊기 1부 (${date})`, b)
  await addChat(chat, { id: 'ChwKGkNPeDFfYmVmb3JlX2N1dF8wMDAwMDAwMDAw', ch: 'UCx1cutviewer00000000001', nick: '앞손님', text: '3번' })
  await expect.poll(async () => claimsOf(await scopeView(page, date, false), b, 3), { timeout: 15_000 }).toBe(1)

  await page.goto('/settings/extension')
  const region = page.getByRole('region', { name: '크롬 확장으로 채팅 받기', exact: true })
  await region.getByRole('button', { name: '끊기' }).click()
  await page.getByRole('dialog', { name: '확장 연결을 끊을까요?' }).getByRole('button', { name: '끊기' }).click()
  await expect(region.getByText('연결된 확장이 없어요.')).toBeVisible()

  await addChat(chat, { id: 'ChwKGkNPeDFfYWZ0ZXJfY3V0XzAwMDAwMDAwMDAw', ch: 'UCx1cutviewer00000000002', nick: '뒷손님', text: '3번' })
  // 확장이 401을 받아 연결을 지운다 → 팝업은 다시 코드 넣기
  await expect(async () => {
    await popup.reload()
    await expect(popup.getByRole('status')).toHaveText('연결이 끊겼어요. 라이브지니 설정에서 새 코드를 받아 다시 연결해 주세요.', { timeout: 1000 })
  }).toPass({ timeout: 30_000 })
  expect(claimsOf(await scopeView(page, date, false), b, 3)).toBe(1)
})

test('@youtube AC-X1-16: 유튜브 채팅 탭을 닫으면 콘솔 고정 영역에 "확장에서 채팅이 오지 않아요"와 손으로 넣기', async ({ ext }) => {
  test.setTimeout(150_000)
  const { context, page, extId } = ext
  await loginNewSeller(page)
  const { b, date } = await openRealBroadcast(page, { title: '닫기 1부' })
  const code = await issueCode(page)

  const chat = await openLiveChat(context, 'x1CloseVid1')
  const popup = await openPopup(context, extId)
  await connectPopup(popup, code)
  await pickBroadcast(popup, page, `닫기 1부 (${date})`, b)
  await expect(popup.getByRole('status')).toHaveText('확장으로 받는 중')

  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(consoleYoutube(page).getByRole('group', { name: '채팅 받는 길' })).toContainText('확장으로 받는 중')
  await expect(page.getByRole('alert').filter({ hasText: '주문은 손으로 넣어 주세요' })).toHaveCount(0)

  await chat.close()
  // 상태가 30초 넘게 없으면 경고 (서버가 스스로 알린다 — 새로고침 없이)
  const warning = page.getByRole('alert').filter({ hasText: '확장에서 채팅이 오지 않아요' })
  await expect(warning).toContainText('주문은 손으로 넣어 주세요', { timeout: 60_000 })
  await expect(warning.getByRole('link', { name: '손으로 넣기' })).toBeVisible()
  // 영어 상태값이 보이지 않는다
  await expect(page.getByText(/\b(STALE|HIDDEN|RECEIVING|UNREADABLE)\b/)).toHaveCount(0)
})

test('@youtube TE-X1-002·003: 팝업 — 고르기 전엔 "받는 중"이 아니고, 연결한 뒤엔 코드 넣기 칸이, 회차를 고른 뒤엔 고르기 칸이 숨는다 (연결 전엔 "연결 지우기"가 없다)', async ({ ext }) => {
  const { context, page, extId } = ext
  await loginNewSeller(page)
  const { date } = await openRealBroadcast(page, { title: '팝업 1부' })
  const code = await issueCode(page)
  await openLiveChat(context, 'x1PopupVid1')
  const popup = await openPopup(context, extId)
  await expect(popup.locator('#state')).toHaveText('아직 라이브지니와 연결되지 않았어요.')
  await expect(popup.getByRole('button', { name: '이 컴퓨터에서 연결 지우기' })).toBeHidden()
  await expect(popup.getByRole('heading', { name: '어느 방송으로 받을까요?' })).toBeHidden()

  await connectPopup(popup, code)
  // 아직 회차를 고르지 않았으니 "받는 중"이 아니다 (TE-X1-003)
  await expect(popup.locator('#state')).toHaveText('이 방송의 채팅을 어느 회차로 받을지 골라 주세요.')
  await expect(popup.getByRole('button', { name: '연결하기' })).toBeHidden()
  await expect(popup.getByRole('button', { name: '이 컴퓨터에서 연결 지우기' })).toBeVisible()
  await popup.getByRole('radio', { name: `팝업 1부 (${date})` }).check()
  await popup.getByRole('button', { name: '이 방송으로 받기' }).click()
  await expect(popup.locator('#state')).toHaveText('확장으로 받는 중')
  await expect(popup.getByRole('heading', { name: '어느 방송으로 받을까요?' })).toBeHidden()
})

/** 콘솔 채팅 패널에서 그 닉네임의 메시지 */
const chatItem = (page: import('@playwright/test').Page, nick: string) =>
  page.getByRole('region', { name: '채팅', exact: true }).getByRole('list', { name: '채팅 메시지' }).getByRole('listitem').filter({ hasText: nick })

test('@youtube SPEC AC3·D-X1-29: 방송자 표시(주인 배지)가 붙은 글 "21"은 찜이 되지 않고, 콘솔 채팅에 "방송자"로 보인다', async ({ ext }) => {
  const { context, page, extId } = ext
  await loginNewSeller(page)
  const { b, date } = await openRealBroadcast(page, { title: '방송자 1부' })
  await register(page, '21 방송자다육 10', 21)
  const code = await issueCode(page)
  const chat = await openLiveChat(context, 'x1HostVid01')
  const popup = await openPopup(context, extId)
  await connectPopup(popup, code)
  await pickBroadcast(popup, page, `방송자 1부 (${date})`, b)

  const t0 = Date.now()
  await addChat(chat, { id: 'ChwKGkNPeDFfaG9zdF8wMDAwMDAwMDAwMDAwMDA', ch: 'UCx1hostchannel000000001', nick: '사장님', text: '21', atMs: t0, owner: true })
  // 처리됐음을 확인하는 표시: 뒤에 온 시청자 "21"이 1등
  await addChat(chat, { id: 'ChwKGkNPeDFfaG9zdHZpZXdlcl8wMDAwMDAwMDAw', ch: 'UCx1hostviewer0000000001', nick: '뒤손님', text: '21', atMs: t0 + 1000 })
  await expect.poll(async () => claimsOf(await scopeView(page, date, false), b, 21), { timeout: 15_000 }).toBe(1)
  const view = await scopeView(page, date, false)
  expect(view.products.find((p) => p.no === 21)?.winners).toEqual(['UCx1hostviewer0000000001'])

  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(chatItem(page, '사장님')).toContainText('방송자')
  await expect(chatItem(page, '뒤손님')).not.toContainText('방송자')
})

test('@youtube D-X1-29: 회차 채널이 아닌 채널이 방송자 표시를 붙여도 시청자로 처리 — "21" 찜이 들어가고 방송자로 보이지 않는다', async ({ ext }) => {
  const { context, page, extId } = ext
  await loginNewSeller(page)
  await connectYoutube(page, '위조 방지 채널')
  const { b, date } = await openRealBroadcast(page, { title: '위조 1부' })
  await register(page, '21 위조다육 10', 21)
  const code = await issueCode(page)
  const chat = await openLiveChat(context, 'x1FakeOwner')
  const popup = await openPopup(context, extId)
  await connectPopup(popup, code)
  await pickBroadcast(popup, page, `위조 1부 (${date})`, b)

  await addChat(chat, { id: 'ChwKGkNPeDFfZm9yZ2VfMDAwMDAwMDAwMDAwMDA', ch: 'UCx1forgedowner000000001', nick: '가짜사장', text: '21', owner: true })
  await expect.poll(async () => claimsOf(await scopeView(page, date, false), b, 21), { timeout: 15_000 }).toBe(1)
  expect((await scopeView(page, date, false)).products.find((p) => p.no === 21)?.winners).toEqual(['UCx1forgedowner000000001'])

  await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(chatItem(page, '가짜사장')).toBeVisible()
  await expect(chatItem(page, '가짜사장')).not.toContainText('방송자')
})
