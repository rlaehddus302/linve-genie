// N2b-2 E2E — 붙여넣기 겹침 (AC-N2b-2-69, D-N2b-2-14, AC-N2b-2-54). 여러 플랫폼 묶음(@multi).
// 끊김 알림을 보고 판매자는 보이는 틱톡 댓글을 통째로 복사한다 — 이미 받은 줄이 섞이는 것이 보통이다.
import { expect, test, type Page } from '@playwright/test'
import {
  boardItem,
  consoleTiktok,
  history,
  linkTiktokUi,
  openRealBroadcast,
  pasteDialog,
  registerApi,
  scopeView,
  tiktokSeller,
  ttComment,
  unlinkTiktok,
} from './support.ts'

const OVERLAP_15 = '15번은 같은 닉네임의 찜이 이미 있어 넣지 않아요.'

/** 틱톡으로 홍길동이 15를 이미 찜한 실제 회차 + 열린 붙여넣기 창 */
async function prepared(page: Page): Promise<{ tiktokId: string; date: string }> {
  const { tiktokId } = await tiktokSeller(page)
  const { b, date } = await openRealBroadcast(page)
  await registerApi(page, b, 15, '라울', 10_000)
  await registerApi(page, b, 16, '홍옥', 8_000)
  await registerApi(page, b, 28, '세덤', 5_000)
  await expect(boardItem(page, 28)).toBeVisible()
  await linkTiktokUi(page)
  await ttComment(page.request, tiktokId, '홍길동', '15')
  await expect(boardItem(page, 15)).toContainText('홍길동')
  await consoleTiktok(page).getByRole('button', { name: '댓글 붙여넣기' }).click()
  return { tiktokId, date }
}

test.describe('N2b-2 붙여넣기 겹침 @multi', () => {
  test.describe.configure({ timeout: 300_000 })
  test.afterEach(async ({ page }) => {
    await unlinkTiktok(page)
  })

  test('AC-N2b-2-69 이미 틱톡으로 들어온 같은 닉네임·같은 번호 줄: 겹침 문장 + "그래도 넣기"(기본 꺼짐) — 기본 넣기는 그 번호를 빼고 찜은 그대로 하나 @multi', async ({ page }) => {
    const { date } = await prepared(page)
    const sent: { includeOverlaps?: unknown }[] = []
    await page.route('**/paste', async (route) => {
      sent.push(route.request().postDataJSON() as { includeOverlaps?: unknown })
      await route.continue()
    })
    const dlg = pasteDialog(page)
    await dlg.getByLabel('붙여 넣을 댓글').fill(['홍길동: 15', '김철수: 16'].join('\n'))
    await dlg.getByRole('button', { name: '미리 보기' }).click()
    const rows = dlg.getByRole('list', { name: '줄마다 결과' })
    const first = rows.getByRole('listitem').nth(0)
    await expect(first).toContainText('15번 찜')
    // 서버 문장 글자 그대로
    await expect(first.getByText(OVERLAP_15)).toBeVisible()
    const anyway = first.getByRole('checkbox', { name: '그래도 넣기' })
    await expect(anyway).not.toBeChecked()
    const box = await anyway.boundingBox()
    // 누르는 곳은 상자 자체 또는 그 이름표 — 둘 중 큰 쪽이 44px 이상
    const label = first.locator('label', { has: anyway }).or(first.locator('label', { hasText: '그래도 넣기' })).first()
    const labelBox = await label.boundingBox()
    expect(Math.max(box?.height ?? 0, labelBox?.height ?? 0)).toBeGreaterThanOrEqual(44)
    // N은 겹친 번호를 뺀 수, 고르면 늘어난다 (미리 보기 다시 없이)
    await expect(dlg.getByRole('button', { name: '찜 1개 넣기' })).toBeEnabled()
    await anyway.check()
    await expect(dlg.getByRole('button', { name: '찜 2개 넣기' })).toBeEnabled()
    await anyway.uncheck()
    await dlg.getByRole('button', { name: '찜 1개 넣기' }).click()
    await expect(dlg).toHaveCount(0)
    await expect(page.getByText('찜 1개를 넣었어요.')).toBeVisible()
    expect(sent).toHaveLength(1)
    expect(sent[0]?.includeOverlaps ?? []).toEqual([])
    const view = await scopeView(page, date, false)
    expect(view.claims.filter((c) => c.no === 15)).toHaveLength(1)
    expect(view.claims.filter((c) => c.no === 16)).toHaveLength(1)
    const events = await history(page, date, false)
    expect(events.filter((e) => e.type === 'sms')).toHaveLength(1)
  })

  test('AC-N2b-2-69 "그래도 넣기"를 고르면 includeOverlaps로 그 줄 번호를 보내 겹친 번호도 넣는다 @multi', async ({ page }) => {
    const { date } = await prepared(page)
    const sent: { includeOverlaps?: unknown }[] = []
    await page.route('**/paste', async (route) => {
      sent.push(route.request().postDataJSON() as { includeOverlaps?: unknown })
      await route.continue()
    })
    const dlg = pasteDialog(page)
    await dlg.getByLabel('붙여 넣을 댓글').fill(['김철수: 16', '홍길동: 15 28'].join('\n'))
    await dlg.getByRole('button', { name: '미리 보기' }).click()
    const second = dlg.getByRole('list', { name: '줄마다 결과' }).getByRole('listitem').nth(1)
    await expect(second.getByText(OVERLAP_15)).toBeVisible()
    await expect(dlg.getByRole('button', { name: '찜 2개 넣기' })).toBeEnabled()
    // 키보드로 고른다
    await second.getByRole('checkbox', { name: '그래도 넣기' }).focus()
    await page.keyboard.press('Space')
    await expect(second.getByRole('checkbox', { name: '그래도 넣기' })).toBeChecked()
    await dlg.getByRole('button', { name: '찜 3개 넣기' }).click()
    await expect(page.getByText('찜 3개를 넣었어요.')).toBeVisible()
    expect(sent.map((s) => s.includeOverlaps)).toEqual([[2]])
    const view = await scopeView(page, date, false)
    expect(view.claims.filter((c) => c.no === 15 && c.status !== 'CANCELLED')).toHaveLength(2)
  })

  test('AC-N2b-2-69 미리 보기 뒤 같은 닉네임의 틱톡 댓글이 들어오면 넣기가 그 번호를 빼고 "이미 있는 찜 1개는 넣지 않았어요." @multi', async ({ page }) => {
    const { tiktokId, date } = await prepared(page)
    const dlg = pasteDialog(page)
    await dlg.getByLabel('붙여 넣을 댓글').fill(['김철수: 16', '이영희: 28'].join('\n'))
    await dlg.getByRole('button', { name: '미리 보기' }).click()
    await expect(dlg.getByRole('button', { name: '찜 2개 넣기' })).toBeEnabled()
    // 그 사이 틱톡으로 이영희의 28이 들어온다
    await ttComment(page.request, tiktokId, '이영희', '28')
    await expect(boardItem(page, 28)).toContainText('이영희')
    await dlg.getByRole('button', { name: '찜 2개 넣기' }).click()
    await expect(page.getByText('찜 1개를 넣었어요. 이미 있는 찜 1개는 넣지 않았어요.')).toBeVisible()
    const view = await scopeView(page, date, false)
    expect(view.claims.filter((c) => c.no === 28)).toHaveLength(1)
  })
})
