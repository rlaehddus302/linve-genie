// N2b-2 E2E — 틱톡 설정·잇기·끄기 (AC-N2b-2-20·25·62·80 ①②⑤). 여러 플랫폼 묶음(@multi).
import { expect, test } from '@playwright/test'
import {
  CONSENT_CHECKBOX,
  FINISHED_MESSAGE,
  NOTICE_LINES,
  NOTICE_TITLE,
  OFF_MESSAGE,
  board,
  boardItem,
  consoleTiktok,
  linkTiktokUi,
  loginNewSeller,
  newTiktokId,
  openRealBroadcast,
  registerApi,
  scopeView,
  tiktokSeller,
  ttComment,
  ttLive,
  ttSettings,
  unlinkTiktok,
} from './support.ts'

test.describe('N2b-2 틱톡 @multi', () => {
  // 서버 전체 연결 시도 한도(60초에 30번) 때문에 잇기·다시 붙기가 최대 60초 미뤄질 수 있다 (support.ts CONNECT_WAIT)
  test.describe.configure({ timeout: 300_000 })
  test.afterEach(async ({ page }) => {
    await unlinkTiktok(page)
  })
  test('AC-N2b-2-80 ① 설정: 고지 전문·체크 전 켜기 못 누름 → 켜기 → 아이디(틀린 주소는 칸 아래 문장) → 끄기 확인 창 @multi', async ({ page }) => {
    await loginNewSeller(page)
    await page.goto('/settings/tiktok')
    const region = ttSettings(page)
    await expect(region.getByText(NOTICE_TITLE)).toBeVisible()
    for (const line of NOTICE_LINES) await expect(region.getByText(line, { exact: true })).toBeVisible()
    // 고지 문장 전부에 영문 글자가 없다 (판 이름은 보이지 않는다)
    const regionText = await region.innerText()
    expect(regionText).not.toContain('TT-BETA')
    const on = region.getByRole('button', { name: '켜기', exact: true })
    await expect(on).toBeDisabled()
    await region.getByRole('checkbox', { name: CONSENT_CHECKBOX }).check()
    await expect(on).toBeEnabled()
    await on.click()
    await expect(region.getByText(/켜져 있어요 \(\d{4}년 \d{1,2}월 \d{1,2}일 켬\)/)).toBeVisible()
    const field = region.getByLabel('내 틱톡 아이디')
    await field.fill('https://www.youtube.com/@someone')
    await region.getByRole('button', { name: '저장', exact: true }).click()
    // 실패 문장은 칸 아래 (서버 problems[0].message 그대로) — 저장되지 않는다
    const direct = await page.request.put('/api/tiktok/account', { data: { tiktokId: 'https://www.youtube.com/@someone' }, headers: { Origin: new URL(page.url()).origin } })
    expect(direct.status()).toBe(400)
    const problem = ((await direct.json()) as { error: { problems: { message: string }[] } }).error.problems[0]!.message
    await expect(field).toHaveAccessibleDescription(problem)
    const res = await page.request.get('/api/tiktok')
    expect(((await res.json()) as { tiktok: { tiktokId: string | null } }).tiktok.tiktokId).toBeNull()
    const id = newTiktokId()
    await field.fill(`@${id}`)
    await region.getByRole('button', { name: '저장', exact: true }).click()
    await expect.poll(async () => ((await (await page.request.get('/api/tiktok')).json()) as { tiktok: { tiktokId: string | null } }).tiktok.tiktokId).toBe(id)
    await region.getByRole('button', { name: '끄기', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '틱톡 연결 끄기' })
    await expect(dialog.getByText('끄면 틱톡 댓글을 바로 그만 받아요. 끌까요?')).toBeVisible()
    await dialog.getByRole('button', { name: '끄기', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(region.getByRole('checkbox', { name: CONSENT_CHECKBOX })).toBeVisible()
  })

  test('AC-N2b-2-80 ② 콘솔에서 틱톡 잇기 → "15" 1등·채팅 줄 "틱톡" → 방송자 댓글 "16"은 찜 없음 @multi', async ({ page }) => {
    const { tiktokId } = await tiktokSeller(page)
    const { b, date } = await openRealBroadcast(page)
    await registerApi(page, b, 15, '라울', 10_000)
    await registerApi(page, b, 16, '홍옥', 8_000)
    await expect(boardItem(page, 16)).toBeVisible()
    await linkTiktokUi(page)
    expect(await ttComment(page.request, tiktokId, '꽃집손님', '15')).toBe(1)
    await expect(boardItem(page, 15)).toContainText('꽃집손님')
    const chat = page.getByRole('region', { name: '채팅' })
    await expect(chat.getByText('꽃집손님')).toBeVisible()
    await expect(chat.locator('.tag-platform', { hasText: '틱톡' }).first()).toBeVisible()
    // 방송자 본인 댓글 (viewer = 방송 아이디)
    await ttComment(page.request, tiktokId, '내가게', '16', { viewer: tiktokId })
    await expect(chat.getByText('내가게')).toBeVisible()
    const view = await scopeView(page, date, false)
    expect(view.claims.filter((c) => c.no === 16)).toHaveLength(0)
    expect(view.claims.filter((c) => c.no === 15)).toHaveLength(1)
    await expect(consoleTiktok(page).getByText('받은 댓글 2개')).toBeVisible()
    await expect(board(page)).toBeVisible()
  })

  test('AC-N2b-2-80 ⑤ 이어진 동안 설정에서 끄기 → 콘솔 틱톡 칸 꺼짐 문장, 그 뒤 댓글은 보드에 없음 @multi', async ({ page, context }) => {
    const { tiktokId } = await tiktokSeller(page)
    const { b, date } = await openRealBroadcast(page)
    await registerApi(page, b, 15, '라울', 10_000)
    await linkTiktokUi(page)
    const other = await context.newPage()
    await other.goto('/settings/tiktok')
    const region = ttSettings(other)
    await region.getByRole('button', { name: '끄기', exact: true }).click()
    await other.getByRole('dialog', { name: '틱톡 연결 끄기' }).getByRole('button', { name: '끄기', exact: true }).click()
    await expect(region.getByRole('checkbox', { name: CONSENT_CHECKBOX })).toBeVisible()
    // 콘솔은 새로 고침 없이 (SSE)
    await expect(consoleTiktok(page).getByText(OFF_MESSAGE)).toBeVisible()
    expect(await ttComment(page.request, tiktokId, '늦은손님', '15')).toBe(0)
    const view = await scopeView(page, date, false)
    expect(view.claims.filter((c) => c.no === 15)).toHaveLength(0)
    await expect(page.getByRole('region', { name: '채팅' }).getByText('늦은손님')).toHaveCount(0)
  })

  test('AC-N2b-2-33 회차를 끝내면 틱톡 칸에 끝낸 문장이 남는다 @multi', async ({ page }) => {
    const { tiktokId } = await tiktokSeller(page)
    await openRealBroadcast(page)
    await linkTiktokUi(page)
    await page.getByRole('button', { name: '방송 끝내기' }).click()
    await page.getByRole('dialog', { name: '방송 끝내기' }).getByRole('button', { name: '끝내기' }).click()
    await expect(consoleTiktok(page).getByText(FINISHED_MESSAGE)).toBeVisible()
    expect(await ttComment(page.request, tiktokId, '끝난뒤', '1')).toBe(0)
  })

  test('AC-N2b-2-25 운영자 켬·동의 없음이면 콘솔 틱톡 칸은 문장과 "설정으로"만 @multi', async ({ page }) => {
    await loginNewSeller(page)
    const id = newTiktokId()
    await ttLive(page.request, id)
    await openRealBroadcast(page)
    const region = consoleTiktok(page)
    await expect(region.getByText('틱톡 연결이 꺼져 있어요. 설정에서 안내를 읽고 켜 주세요.')).toBeVisible()
    await expect(region.getByRole('button', { name: '틱톡 잇기' })).toHaveCount(0)
    await region.getByRole('link', { name: '설정으로' }).or(region.getByRole('button', { name: '설정으로' })).click()
    await expect(page).toHaveURL(/\/settings\/tiktok/)
  })
})
