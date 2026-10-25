// BND1 E2E — 실패·토큰 만료·읽을 수 없음·잇기 거절·같은 요청 번호 (AC-BND1-50·51·54·55·71·72·73, AC-BND1-80 ⑥⑦). 여러 플랫폼 묶음(@multi).
// 상태 문장은 서버가 주고 화면은 글자 그대로 — acceptance.md AC-BND1-50 표.
import { expect, test } from '@playwright/test'
import {
  READ_WAIT,
  T,
  alertStrip,
  band,
  bandComment,
  bandComments,
  bandRequests,
  bandSettings,
  bandUser,
  bandWorld,
  boardItem,
  cleanupBand,
  consoleBand,
  escapeRe,
  linkView,
  linkedBroadcast,
  openRealBroadcast,
  registerApi,
  scopeView,
  postJson,
} from './support.ts'

test.describe('BND1 실패·막힘 @multi', () => {
  test.describe.configure({ timeout: 240_000 })
  test.afterEach(async ({ page }) => {
    await cleanupBand(page)
  })

  test('AC-BND1-80 ⑥·55·54·71: 토큰 풀림(10401) → 새로 고침 없이 밴드 칸 "밴드 연결이 풀렸어요…"·알림 띠 → 설정에서 다시 연결 → 그 사이 댓글 3개가 들어오고 늦게 읽음 알림 @multi', async ({ page }) => {
    const w = await bandWorld(page)
    const { b, date } = await linkedBroadcast(page, w)
    const consoleUrl = page.url()
    const region = consoleBand(page)
    await band(page.request, 'revoke', { userKey: w.me })
    // SSE로 바뀐다 (새로 고침 없음)
    await expect(region.getByText(T.reconnect)).toBeVisible({ timeout: READ_WAIT })
    await expect(alertStrip(page).getByText(T.notComing)).toBeVisible()
    await expect(region.getByRole('link', { name: '설정으로' })).toBeVisible()
    const stopped = Date.now()
    // 그 사이 댓글 3개 (판매자가 다시 연결할 때까지 요청 0)
    const guests = await Promise.all(['사이손님1', '사이손님2', '사이손님3'].map((n) => bandUser(page.request, n)))
    await bandComments(page.request, w.post, guests.map((g, i) => ({ content: '1번', name: `사이손님${String(i + 1)}`, userKey: g })))
    const before = (await bandRequests(page.request)).requests.length
    // 늦게 읽음(AC-BND1-54)은 마지막 성공 읽기에서 60초가 넘어야 한다 — E2E 기동도 운영 값 60초라 그만큼 지난 뒤 다시 연결한다
    await expect.poll(() => Date.now() - stopped, { timeout: 90_000, intervals: [1000] }).toBeGreaterThan(61_000)
    expect((await bandRequests(page.request)).requests.length, '다시 연결 필요 동안 밴드로 나간 요청').toBe(before)
    expect((await linkView(page, b)).state).toBe('RECONNECT_NEEDED')
    // 설정에서 같은 밴드 사용자로 다시 연결
    await band(page.request, 'login', { decision: 'approve', userKey: w.me })
    await page.goto('/settings/band')
    await expect(bandSettings(page).getByText(T.reconnect)).toBeVisible()
    await bandSettings(page).getByRole('button', { name: '밴드 연결하기' }).click()
    await expect(page.getByText(T.connected)).toBeVisible()
    await page.goto(consoleUrl)
    await expect(consoleBand(page).getByText(T.reading)).toBeVisible({ timeout: READ_WAIT })
    await expect(boardItem(page, 1)).toContainText('사이손님1', { timeout: READ_WAIT })
    await expect.poll(async () => (await scopeView(page, date, false)).claims.length, { timeout: READ_WAIT }).toBe(3)
    const notices = consoleBand(page).getByRole('list', { name: '밴드 알림' })
    await expect(notices.getByText(T.late)).toBeVisible()
    const late = (await linkView(page, b)).notices.items.find((n) => n.kind === 'LATE')
    expect(late?.message.match(T.late)?.[1]).toBe('3')
    await expect(alertStrip(page).getByText(T.notComing)).toHaveCount(0)
  })

  test('AC-BND1-80 ⑦·50: 읽을 수 없음(60102) → NO_ACCESS 문장·알림 띠 → "다른 글 잇기" → 끊고 다시 고르기 → 새 글로 읽는 중 @multi', async ({ page }) => {
    const w = await bandWorld(page)
    const { b } = await linkedBroadcast(page, w)
    const region = consoleBand(page)
    await band(page.request, 'fail', { op: 'comments', resultCode: 60102, times: 1 })
    await expect(region.getByText(T.noAccess)).toBeVisible({ timeout: READ_WAIT })
    await expect(alertStrip(page).getByText(T.notComing)).toBeVisible()
    // 다른 내 글을 하나 올려 두고 그 글로 다시 잇는다
    const second = `둘째 공지 ${Math.random().toString(36).slice(2, 6)}`
    await band(page.request, 'post', { bandKey: w.bandA, authorUserKey: w.me, content: second })
    await region.getByRole('button', { name: T.linkOther }).click()
    await page.getByRole('dialog', { name: '밴드 고르기' }).getByRole('button', { name: new RegExp(escapeRe(w.bandAName)) }).click()
    await page.getByRole('dialog', { name: '내 글 고르기' }).getByRole('button', { name: new RegExp(escapeRe(second)) }).click()
    await page.getByRole('dialog', { name: '이 글 잇기' }).getByRole('button', { name: '잇기', exact: true }).click()
    await expect(region.getByText(T.reading)).toBeVisible()
    await expect(region.getByText(second)).toBeVisible()
    await expect(alertStrip(page).getByText(T.notComing)).toHaveCount(0)
    expect((await linkView(page, b)).state).toBe('READING')
  })

  test('AC-BND1-72: "잇기"를 누르면 잠기고 "글을 읽는 중이에요…" — 응답이 늦어도 두 번 눌리지 않고, 연결이 끊겨 다시 보내도 같은 요청 번호(연결 하나·기준선 읽기 한 번) @multi', async ({ page }) => {
    const w = await bandWorld(page)
    const { b } = await openRealBroadcast(page)
    await registerApi(page, b, 1, '핑크프릴', 12_000)
    const linkBodies: string[] = []
    let aborted = false
    await page.route(`**/api/broadcasts/${b}/band/link`, async (route) => {
      linkBodies.push(route.request().postData() ?? '')
      if (!aborted) {
        aborted = true
        // 서버에는 닿게 하고 응답만 끊는다 (응답을 못 받은 화면이 다시 보낸다)
        await route.fetch()
        await route.abort('connectionreset')
        return
      }
      await route.continue()
    })
    await band(page.request, 'delay', { op: 'comments', ms: 2500 })
    const detailCalls = async () => (await bandRequests(page.request)).requests.filter((r) => r.path === '/v2.1/band/post').length
    const detailBefore = await detailCalls()
    const region = consoleBand(page)
    await region.getByRole('button', { name: T.linkStart }).click()
    await page.getByRole('dialog', { name: '밴드 고르기' }).getByRole('button', { name: new RegExp(escapeRe(w.bandAName)) }).click()
    await page.getByRole('dialog', { name: '내 글 고르기' }).getByRole('button', { name: new RegExp(escapeRe(w.postLine)) }).click()
    const confirm = page.getByRole('dialog', { name: '이 글 잇기' })
    const go = confirm.getByRole('button', { name: '잇기', exact: true })
    await go.click()
    await expect(confirm.getByText(T.busy)).toBeVisible()
    await expect(go).toBeDisabled()
    await go.click({ force: true }).catch(() => undefined)
    await expect(confirm).toHaveCount(0, { timeout: 30_000 })
    await band(page.request, 'delay', { op: 'comments', ms: 0 })
    await expect(region.getByText(T.baseline(3))).toBeVisible()
    expect(linkBodies.length).toBeGreaterThanOrEqual(2)
    const ids = new Set(linkBodies.map((x) => (JSON.parse(x) as { requestId: string }).requestId))
    expect(ids.size).toBe(1)
    const view = await linkView(page, b)
    expect(view.state).toBe('READING')
    expect(view.baseline).toBe(3)
    // 글 상세 읽기(잇기마다 한 번)가 한 번 — 같은 요청 번호로 다시 보내도 잇기는 한 번 돌았다
    expect(await detailCalls() - detailBefore).toBe(1)
    const live = (await (await page.request.get(`/api/broadcasts/${b}/live`)).json()) as { links: { platform: string }[] }
    expect(live.links.filter((l) => l.platform === 'BAND')).toHaveLength(1)
  })

  test('AC-BND1-22·71: 이미 다른 방송에 밴드 글이 이어져 있으면 새 방송 밴드 칸에 서버 문장 그대로, 잇기 단추 없음 @multi', async ({ page }) => {
    const w = await bandWorld(page)
    await linkedBroadcast(page, w)
    await openRealBroadcast(page, { title: '2부' })
    const region = consoleBand(page)
    await expect(region.getByText('이미 다른 방송에 밴드 글이 이어져 있어요. 먼저 그 방송의 밴드 연결을 끊어 주세요.', { exact: true })).toBeVisible()
    await expect(region.getByRole('button', { name: T.linkStart })).toHaveCount(0)
  })

  test('AC-BND1-71: 연결 안 한 판매자의 콘솔 밴드 칸 — "설정에서 밴드를 먼저 연결해 주세요." + "설정으로" → 설정의 밴드 칸 @multi', async ({ page }) => {
    const { loginNewSeller } = await import('./support.ts')
    await loginNewSeller(page)
    await openRealBroadcast(page)
    const region = consoleBand(page)
    await expect(region.getByText(T.needConnect, { exact: true })).toBeVisible()
    await region.getByRole('link', { name: '설정으로' }).click()
    await expect(bandSettings(page).getByRole('button', { name: '밴드 연결하기' })).toBeVisible()
  })

  test('AC-BND1-71: 리허설 회차에는 밴드 칸 대신 "리허설 방송에는 라이브를 이을 수 없어요." · 밴드 잇기 단추 없음 @multi', async ({ page }) => {
    await bandWorld(page, { baseline: 0, oneBand: true })
    const res = await postJson(page, '/api/broadcasts', { requestId: crypto.randomUUID(), rehearsal: true })
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
    const rb = (res.body['broadcast'] as { id: string }).id
    await page.goto(`/broadcasts/${encodeURIComponent(rb)}`)
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    await expect(page.getByText(T.rehearsal).first()).toBeVisible()
    await expect(page.getByRole('button', { name: T.linkStart })).toHaveCount(0)
  })

  test('AC-BND1-35: 작성자 없는 댓글은 넣지 않고 "작성자를 알 수 없는 밴드 댓글 1개는 넣지 못했어요…" @multi', async ({ page }) => {
    const w = await bandWorld(page)
    const { date } = await linkedBroadcast(page, w)
    await bandComment(page.request, w.post, { content: '1번', name: '이름만손님', userKey: null })
    await expect(consoleBand(page).getByText(T.noAuthor(1), { exact: true })).toBeVisible({ timeout: READ_WAIT })
    expect((await scopeView(page, date, false)).claims).toHaveLength(0)
  })
})
