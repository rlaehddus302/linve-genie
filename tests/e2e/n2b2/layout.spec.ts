// N2b-2 E2E — 휴대폰 고정 영역·누르는 곳·쉬운 말 (AC-N2b-2-60·62·68, UX-04, NFR-08). 여러 플랫폼 묶음(@multi).
import { expect, test, type Page } from '@playwright/test'
import {
  PASTE_ALERT,
  boardItem,
  consoleTiktok,
  enableTiktokApi,
  linkTiktokUi,
  loginNewSeller,
  meta,
  newTiktokId,
  openRealBroadcast,
  pasteDialog,
  registerApi,
  settingsRegion,
  smsApi,
  tt,
  ttComment,
  ttLive,
  CONNECT_WAIT,
  unlinkTiktok,
} from './support.ts'
import { pendingWord } from '../mob1/support.ts' // QL3R2 D-QL3R2-02

/** 화면 위·아래에 고정된 영역(position fixed·sticky, 가장 바깥 것)의 보이는 높이 합 (S06 layout.spec과 같은 셈) */
async function fixedHeight(page: Page): Promise<{ total: number; parts: string[] }> {
  return await page.evaluate(() => {
    const vh = window.innerHeight
    const parts: string[] = []
    let total = 0
    const all = [...document.querySelectorAll<HTMLElement>('body *')]
    const pinned = all.filter((el) => {
      const p = getComputedStyle(el).position
      return p === 'fixed' || p === 'sticky'
    })
    for (const el of pinned) {
      if (pinned.some((other) => other !== el && other.contains(el))) continue
      const r = el.getBoundingClientRect()
      const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0))
      if (h === 0) continue
      total += h
      parts.push(`${el.tagName}.${el.className} ${String(Math.round(h))}`)
    }
    return { total, parts }
  })
}

test.describe('N2b-2 휴대폰 고정 영역 @multi', () => {
  // 서버 전체 연결 시도 한도(60초에 30번) 때문에 잇기·다시 붙기가 최대 60초 미뤄질 수 있다 (support.ts CONNECT_WAIT)
  test.describe.configure({ timeout: 300_000 })
  test.afterEach(async ({ page }) => {
    await unlinkTiktok(page)
  })
  test('TE-N2b-2-001: AC-N2b-2-60·62 375×812 — 틱톡 알림 줄·인스타그램 알림·붙여넣기 결과·보류·취소 요청·되돌리기 대기가 함께여도 고정 영역 ≤ 284px(35%), 새 단추 44px @multi', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await loginNewSeller(page)
    const tiktokId = newTiktokId()
    await enableTiktokApi(page, tiktokId)
    await ttLive(page.request, tiktokId)
    // 인스타그램 연결 + 이어지지 않은 라이브 (댓글이 오면 알림)
    const { account } = await meta<{ account: { id: string } }>(page.request, '/_fake/accounts', { username: `shop.${Math.random().toString(36).slice(2, 7)}` })
    await meta(page.request, '/_fake/login', { accounts: [account.id] })
    await page.goto('/settings/instagram')
    await settingsRegion(page, '인스타그램').getByRole('button', { name: '인스타그램 연결하기' }).click()
    await expect(page.getByText('인스타그램 계정을 연결했어요.')).toBeVisible()
    const { liveId } = await meta<{ liveId: string }>(page.request, '/_fake/live', { accountId: account.id })

    const { b } = await openRealBroadcast(page)
    for (let no = 1; no <= 12; no++) await registerApi(page, b, no, `상품${String(no)}`, 10_000)
    await expect(boardItem(page, 12)).toBeVisible()
    await linkTiktokUi(page)
    // 취소 요청 (틱톡 시청자의 찜 뒤 취소)
    await ttComment(page.request, tiktokId, '셋째', '7', { userId: '7300000003' })
    await expect(boardItem(page, 7)).toContainText('셋째')
    await ttComment(page.request, tiktokId, '셋째', '7 취소', { userId: '7300000003' })
    // 보류 찜 (없는 번호 문자찜)
    await smsApi(page, { b, no: 40, memo: '병' })
    const strip = page.getByRole('region', { name: '알림' })
    await expect(strip.getByRole('button', { name: new RegExp(`^${pendingWord(page)} \\d+$`) })).toBeVisible() // QL3R2 D-QL3R2-02
    await expect(strip.getByRole('button', { name: /^취소 요청 \d+$/ })).toBeVisible()
    // 인스타그램 알림
    await meta(page.request, '/_fake/comments', { accountId: account.id, liveId, comments: [{ igsid: '92000001', username: 'viewer.one', text: '3' }] })
    await expect(page.getByRole('button', { name: '인스타그램 알림 닫기' })).toBeVisible()
    // 붙여넣기 결과 문장 (10초 보인다)
    await consoleTiktok(page).getByRole('button', { name: '댓글 붙여넣기' }).click()
    const dlg = pasteDialog(page)
    await dlg.getByLabel('붙여 넣을 댓글').fill('붙임손님: 9')
    await dlg.getByRole('button', { name: '미리 보기' }).click()
    await dlg.getByRole('button', { name: '찜 1개 넣기' }).click()
    await expect(page.getByText('찜 1개를 넣었어요.')).toBeVisible()
    // 틱톡 막힘 (알림 줄)
    await tt(page.request, 'block', { uniqueId: tiktokId, times: 1 })
    // 막힘을 실제로 쓴 뒤(끊김 직후의 '끊긴 동안' 알림이 아니라) — 가짜 웹캐스트의 막힘 대기열이 다음 시험에 남지 않게
    await expect(consoleTiktok(page).getByText('틱톡이 연결을 막아 다시 시도하는 중이에요. 그동안 댓글을 직접 넣어 주세요.')).toBeVisible({ timeout: CONNECT_WAIT })
    await expect(page.getByRole('button', { name: PASTE_ALERT })).toBeVisible({ timeout: CONNECT_WAIT })
    // 되돌리기 대기 (빠른 입력 등록)
    const input = page.getByLabel('빠른 입력')
    await input.fill('20 새상품 10000')
    await input.press('Enter')
    await expect(boardItem(page, 20)).toBeVisible()
    await expect(page.getByText('찜 1개를 넣었어요.')).toBeVisible()
    // 새 단추는 44px 이상 (AC-N2b-2-68)
    for (const button of [page.getByRole('button', { name: PASTE_ALERT }), page.getByRole('button', { name: '인스타그램 알림 닫기' })]) {
      const box = await button.boundingBox()
      expect(box!.height, await button.innerText()).toBeGreaterThanOrEqual(44)
      expect(box!.width, await button.innerText()).toBeGreaterThanOrEqual(44)
    }
    const { total, parts } = await fixedHeight(page)
    expect(total, parts.join(' / ')).toBeLessThanOrEqual(284)
    const width = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(width).toBeLessThanOrEqual(375)
    // 막힘 한 번을 이 판매자의 다시 시도가 쓴 뒤 다시 붙는다 (다음 시험에 남지 않게)
    await expect(consoleTiktok(page).getByText('틱톡 댓글을 받고 있어요.')).toBeVisible({ timeout: CONNECT_WAIT })
  })
})
