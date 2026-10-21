// N2b-2 E2E — 받는 중(CONNECTED)에 댓글 저장을 끝내 못 한 경우 (RA-N2b-2-02 서버 수정 × SA-N2b-2-006 화면 수정). 여러 플랫폼 묶음(@multi).
// 서버는 저장하지 못한 묶음이 있으면 연결 상태는 그대로(CONNECTED) 두고 missed=true·missedMessage="저장하지 못한 틱톡 댓글이 N개 있어요. … 붙여 넣어 주세요."를 준다.
// 이 댓글은 어디에도 기록되지 않았으므로(채팅에도 없음) 판매자가 붙여 넣어야만 찜이 된다 — 알림 줄(AC-N2b-2-62 "missed일 때")이 필요하다.
// 가짜 웹캐스트에는 DB 저장 실패 조작이 없어, 서버가 실제로 내는 응답 모양 그대로(dev-notes server r1 (1))를 조회 응답에 넣어 화면을 본다.
import { expect, test } from '@playwright/test'
import { PASTE_ALERT, consoleTiktok, linkTiktokUi, openRealBroadcast, tiktokSeller, unlinkTiktok } from './support.ts'

const SAVE_FAILED = '저장하지 못한 틱톡 댓글이 3개 있어요. 틱톡 앱에서 확인해 댓글을 붙여 넣어 주세요.'

test.describe('N2b-2 저장하지 못한 틱톡 댓글 @multi', () => {
  test.describe.configure({ timeout: 300_000 })
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await unlinkTiktok(page)
  })

  test('AC-N2b-2-62 받는 중에 댓글 저장을 끝내 못 하면(saveFailed>0, missed) 알림 줄 "틱톡 댓글이 들어오지 않아요…"와 주 단추 "댓글 붙여넣기" @multi', async ({ page }) => {
    await tiktokSeller(page)
    await openRealBroadcast(page)
    await linkTiktokUi(page)
    await page.route('**/api/broadcasts/*/tiktok', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      const res = await route.fetch()
      const body = (await res.json()) as { link: { collection: Record<string, unknown> | null } }
      if (body.link.collection !== null) {
        expect(body.link.collection['state']).toBe('CONNECTED')
        Object.assign(body.link.collection, { saveFailed: 3, missed: true, missedMessage: SAVE_FAILED })
      }
      await route.fulfill({ response: res, json: body })
    })
    await page.reload()
    const region = consoleTiktok(page)
    await expect(region.getByText('틱톡 댓글을 받고 있어요.')).toBeVisible()
    await expect(region.getByText(SAVE_FAILED)).toBeVisible()
    // 서버가 "붙여 넣어 주세요"라고 하는 상태 — 고정 영역 알림 줄과 칸의 주 단추가 붙여넣기여야 한다
    await expect(page.getByRole('button', { name: PASTE_ALERT })).toBeVisible()
    await expect(region.locator('.button-primary')).toHaveText('댓글 붙여넣기')
  })
})
