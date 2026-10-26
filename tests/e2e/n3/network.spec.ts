// N3 응답을 잃은 처리 — 서버는 처리했는데 화면이 응답을 못 받음 → 같은 요청 번호로 다시 보내 한 번만 (AC-N3-29, DP-INV-1, DAT-02) — test-e2e.
import { test, expect, type Page } from '@playwright/test'
import { deposit, depositOne, depositRow, deposits, fakeSource, history, kstIso, login, smsSale, uniq } from './support.ts'
import { cleanupPrint } from '../i1/support.ts'

// 출력 기록은 판매자 단위 — 판매(1등)가 만든 라벨 작업을 남기면 뒤 시험(N4a 등)의 출력 기기가 쌓인 라벨로 멈춘다 (i1 support "시험끼리 출력 기록이 섞이지 않게")
test.afterEach(async ({ page }) => {
  await cleanupPrint(page)
})

/** path로 가는 첫 POST는 서버까지 보내되 응답을 버린다(연결 끊김). 그 뒤는 그대로. 보낸 요청 번호들을 모은다 */
async function dropFirstResponse(page: Page, path: RegExp): Promise<string[]> {
  const ids: string[] = []
  let dropped = false
  await page.route(path, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const body = route.request().postDataJSON() as { requestId?: string }
    ids.push(body.requestId ?? '')
    if (dropped) return route.continue()
    dropped = true
    await route.fetch()
    await route.abort('connectionreset')
  })
  return ids
}

test.describe('응답을 잃은 처리', () => {
  test('확정 응답을 잃음 → 같은 요청 번호로 다시 → 입금 기록 하나, 화면은 성공 (AC-N3-29)', async ({ page }) => {
    await login(page)
    const name = uniq('끊김확정')
    const sale = await smsSale(page, { memo: name })
    const src = await fakeSource(page)
    const [d] = await deposit(page, src, [{ key: uniq('n'), at: kstIso(5_000), amount: sale.remaining - 700, name }])
    await page.goto('/deposits')
    const ids = await dropFirstResponse(page, /\/api\/deposits\/\d+\/confirm$/)
    await depositRow(page, d!.no).getByRole('group', { name: `입금 번호 ${String(d!.no)} 처리` }).getByRole('button', { name: '확정' }).click() // MOB2 D-MOB2-05
    const dlg = page.getByRole('dialog', { name: '입금 확정' })
    await dlg.getByRole('button', { name: '확정' }).click()
    await expect(dlg).toHaveCount(0, { timeout: 20_000 })
    await expect(page.getByRole('status').filter({ hasText: `입금 번호 ${String(d!.no)}` })).toContainText('묶음에 적었어요.') // MOB2 D-MOB2-05
    expect(ids.length).toBeGreaterThanOrEqual(2)
    expect(new Set(ids).size).toBe(1)
    expect((await depositOne(page, d!.no)).status).toBe('APPLIED')
    const pays = (await history(page, sale.date, false)).filter((e) => e.type === 'settlement.payment' && e.fields['buyer'] === sale.buyer)
    expect(pays).toHaveLength(1)
  })

  test('붙여넣기 넣기 응답을 잃음 → 다시 보내도 새 입금은 한 번, 결과 문장은 처음 요약 (AC-N3-13·29)', async ({ page }) => {
    await login(page)
    const name = uniq('끊김붙임')
    const sale = await smsSale(page, { memo: name })
    const k = new Date(Date.now() + 2 * 60_000 + 9 * 3_600_000).toISOString()
    const text = `거래일시\t입금자명\t입금액\n${k.slice(0, 10)} ${k.slice(11, 16)}\t${name}\t${String(sale.remaining)}\n`
    await page.goto('/deposits?tab=paste')
    const ids = await dropFirstResponse(page, /\/api\/deposits\/paste$/)
    await page.getByLabel('입금 내역').fill(text)
    await page.getByRole('button', { name: '읽어 보기' }).click()
    await page.getByRole('button', { name: '입금 내역 넣기' }).click()
    await expect(page.getByRole('status').filter({ hasText: '새 입금 1건 — 자동 확인 1건, 확인 필요 0건' })).toBeVisible({ timeout: 20_000 })
    expect(new Set(ids).size).toBe(1)
    const mine = (await deposits(page, 'REVIEW,AUTO_APPLIED,APPLIED,IGNORED', 200)).filter((d) => d.name === name)
    expect(mine.map((d) => d.status)).toEqual(['AUTO_APPLIED'])
  })

  test('되돌리기 응답을 잃음 → 환불 기록 하나 (AC-N3-27·29)', async ({ page }) => {
    await login(page)
    const name = uniq('끊김되돌')
    const sale = await smsSale(page, { memo: name })
    const src = await fakeSource(page)
    const [d] = await deposit(page, src, [{ key: uniq('n'), at: kstIso(5_000), amount: sale.remaining, name }])
    expect(d!.status).toBe('AUTO_APPLIED')
    await page.goto('/deposits?tab=done')
    const ids = await dropFirstResponse(page, /\/api\/deposits\/\d+\/revert$/)
    await depositRow(page, d!.no, '자동 확인됨·확인함 입금').getByRole('button', { name: '되돌리기' }).click()
    const dlg = page.getByRole('dialog', { name: '입금 확인 되돌리기' })
    await dlg.getByRole('button', { name: '되돌리기' }).click()
    await expect(dlg).toHaveCount(0, { timeout: 20_000 })
    expect(new Set(ids).size).toBe(1)
    expect((await depositOne(page, d!.no)).status).toBe('REVIEW')
    expect((await history(page, sale.date, false)).filter((e) => e.type === 'settlement.refund' && e.fields['buyer'] === sale.buyer)).toHaveLength(1)
  })
})
