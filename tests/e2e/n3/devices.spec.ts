// N3 두 기기·실시간·되돌리기 경계 (AC-N3-40·44·47·27·30) — test-e2e.
import { test, expect, type Page } from '@playwright/test'
import {
  deposit, depositOne, depositRow, fakeSource, history, kstIso, login, menu, phoneLike, postJson, reviewCount, scopeView, shortKst, smsSale, uniq, won, writeEvent,
} from './support.ts'
import { openMore } from '../menu.ts'
import { cleanupPrint } from '../i1/support.ts'

// 출력 기록은 판매자 단위 — 판매(1등)가 만든 라벨 작업을 남기면 뒤 시험(N4a 등)의 출력 기기가 쌓인 라벨로 멈춘다 (i1 support "시험끼리 출력 기록이 섞이지 않게")
test.afterEach(async ({ page }) => {
  await cleanupPrint(page)
})

function menuLink(page: Page, count: number) {
  return menu(page).getByRole('link', { name: count === 0 ? '입금 확인' : `입금 확인 ${String(count)}`, exact: true })
}

test.describe('두 기기·실시간', () => {
  test('PC에서 확정 → 휴대폰의 확인 필요 목록·메뉴 수가 바뀐다, 새 입금이 들어오면 휴대폰 메뉴 수가 는다 (AC-N3-40·30)', async ({ page, browser }) => {
    await login(page)
    const name = uniq('두기기')
    const sale = await smsSale(page, { memo: name })
    const src = await fakeSource(page)
    const [d] = await deposit(page, src, [{ key: uniq('t'), at: kstIso(5_000), amount: sale.remaining - 300, name }])
    const phone = await phoneLike(browser, page)
    await phone.goto('/deposits')
    // 휴대폰의 "입금 확인 N"은 "더보기" 목록 안 — 목록을 연 채로 수 바뀜을 본다 (AC-NAV-05·10)
    await openMore(phone)
    const count = await reviewCount(page)
    await expect(menuLink(phone, count)).toBeVisible()
    const phoneRow = depositRow(phone, d!.no)
    await expect(phoneRow).toBeVisible()

    // 새 입금(확인 필요)이 들어오면 휴대폰 메뉴 수 +1, 목록에 나타남
    const [d2] = await deposit(page, src, [{ key: uniq('t'), at: kstIso(6_000), amount: 999, name: uniq('모름') }])
    await expect(menuLink(phone, count + 1)).toBeVisible({ timeout: 3_000 })
    await expect(depositRow(phone, d2!.no)).toBeVisible({ timeout: 3_000 })

    // PC에서 확정
    await page.goto('/deposits')
    await depositRow(page, d!.no).getByRole('group', { name: `입금 번호 ${String(d!.no)} 처리` }).getByRole('button', { name: '확정' }).click() // MOB2 D-MOB2-05
    await page.getByRole('dialog', { name: '입금 확정' }).getByRole('button', { name: '확정' }).click()
    await expect(depositRow(page, d!.no)).toHaveCount(0)
    await expect(phoneRow).toHaveCount(0, { timeout: 3_000 })
    await expect(menuLink(phone, count)).toBeVisible({ timeout: 3_000 })
    await phone.context().close()
  })

  test('정산 화면을 열어 둔 채 자동 확인 → 기록·입금 연결이 실시간으로 보이고, 다른 기기에서 되돌리면 되돌리기 버튼이 사라진다 (AC-N3-47·30)', async ({ page, browser }) => {
    await login(page)
    const name = uniq('열린정산')
    const sale = await smsSale(page, { memo: name })
    await page.goto(`/settlements?date=${sale.date}&buyer=${encodeURIComponent(sale.buyer)}`)
    const detail = page.getByRole('region', { name: '정산 자세히' })
    await expect(detail).toContainText('미입금')
    const src = await fakeSource(page)
    const at = kstIso(5_000)
    const [d] = await deposit(page, src, [{ key: uniq('l'), at, amount: sale.remaining, name }])
    expect(d!.status).toBe('AUTO_APPLIED')
    await expect(detail).toContainText(`자동 입금 확인 · ${name} · ${shortKst(at)}`)
    await expect(detail.getByRole('button', { name: '입금 확인 되돌리기' })).toBeVisible()

    const phone = await phoneLike(browser, page)
    await phone.goto('/deposits?tab=done')
    const row = depositRow(phone, d!.no, '자동 확인됨·확인함 입금')
    await row.getByRole('button', { name: '되돌리기' }).click()
    await phone.getByRole('dialog', { name: '입금 확인 되돌리기' }).getByRole('button', { name: '되돌리기' }).click()
    await expect(row).toHaveCount(0)
    await expect(detail).toContainText(`입금 확인 되돌림 · 입금 번호 ${String(d!.no)}`) // MOB2 D-MOB2-05
    await expect(detail.getByRole('button', { name: '입금 확인 되돌리기' })).toHaveCount(0)
    await phone.context().close()
  })

  test('되돌린 뒤 다시 확정 → 기록 둘(첫 기록은 되돌림 표시, 되돌리기 버튼은 새 기록에만 하나) (AC-N3-27·47, DP-INV-1)', async ({ page }) => {
    await login(page)
    const name = uniq('다시확정')
    const sale = await smsSale(page, { memo: name })
    const src = await fakeSource(page)
    const [d] = await deposit(page, src, [{ key: uniq('r'), at: kstIso(5_000), amount: sale.remaining, name }])
    expect(d!.status).toBe('AUTO_APPLIED')
    const rv = await postJson(page, `/api/deposits/${String(d!.no)}/revert`, { requestId: crypto.randomUUID() })
    expect(rv.status, JSON.stringify(rv.body)).toBe(200)
    // 화면에서 다시 확정 (ONE_MATCH 미리 고름)
    await page.goto('/deposits')
    const row = depositRow(page, d!.no)
    await expect(row).toContainText('맞는 묶음이 하나 있어요. 확인해 주세요')
    await row.getByRole('group', { name: `입금 번호 ${String(d!.no)} 처리` }).getByRole('button', { name: '확정' }).click() // MOB2 D-MOB2-05
    await page.getByRole('dialog', { name: '입금 확정' }).getByRole('button', { name: '확정' }).click()
    await expect(row).toHaveCount(0)
    const h = await history(page, sale.date, false)
    expect(h.filter((e) => e.type === 'settlement.payment').map((e) => e.fields['memo'])).toEqual([`자동 입금 확인 · 입금 #${String(d!.no)}`, `입금 내역으로 확인 · 입금 #${String(d!.no)}`])
    expect(h.filter((e) => e.type === 'settlement.refund')).toHaveLength(1)
    const s = (await scopeView(page, sale.date, false)).settlements.find((x) => x.buyer === sale.buyer)!
    expect([s.received, s.payment]).toEqual([sale.remaining, 'PAID'])
    await page.goto(`/settlements?date=${sale.date}&buyer=${encodeURIComponent(sale.buyer)}`)
    const detail = page.getByRole('region', { name: '정산 자세히' })
    await expect(detail).toContainText(`입금 내역으로 확인 · ${name}`)
    await expect(detail).toContainText(`입금 확인 되돌림 · 입금 번호 ${String(d!.no)}`) // MOB2 D-MOB2-05
    await expect(detail.getByRole('button', { name: '입금 확인 되돌리기' })).toHaveCount(1)
  })

  test('손으로 환불을 적은 뒤 되돌리기 → 409 문장 그대로, 아무것도 적지 않음 (AC-N3-27·44)', async ({ page }) => {
    await login(page)
    const name = uniq('환불뒤')
    const sale = await smsSale(page, { memo: name })
    const src = await fakeSource(page)
    const [d] = await deposit(page, src, [{ key: uniq('h'), at: kstIso(5_000), amount: sale.remaining, name }])
    expect(d!.status).toBe('AUTO_APPLIED')
    expect((await writeEvent(page, { type: 'settlement.refund', buyer: sale.buyer, date: sale.date, amount: 1000, reason: '부분 환불' }, { date: sale.date, rehearsal: false })).status).toBeLessThan(300)
    await page.goto('/deposits?tab=done')
    const row = depositRow(page, d!.no, '자동 확인됨·확인함 입금')
    await row.getByRole('button', { name: '되돌리기' }).click()
    const dlg = page.getByRole('dialog', { name: '입금 확인 되돌리기' })
    await expect(dlg).toContainText(`${won(sale.remaining)} 입금을 되돌려요.`)
    await dlg.getByRole('button', { name: '되돌리기' }).click()
    await expect(page.getByText('이미 환불을 적어서 되돌릴 수 없어요. 정산에서 확인해 주세요.')).toBeVisible()
    expect((await depositOne(page, d!.no)).status).toBe('AUTO_APPLIED')
    expect((await history(page, sale.date, false)).filter((e) => e.type === 'settlement.refund')).toHaveLength(1)
  })

  test('확인 필요 목록을 연 채 다른 기기가 정산에서 손 입금 → 제안의 남은 금액이 다시 받아져 바뀐다, 한꺼번에 무시는 확인 창을 거친다 (AC-N3-23·41)', async ({ page }) => {
    await login(page)
    const name = uniq('새값')
    const sale = await smsSale(page, { memo: name })
    const src = await fakeSource(page)
    const at = kstIso(5_000)
    const [d, e] = await deposit(page, src, [
      { key: uniq('s'), at, amount: sale.remaining - 900, name },
      { key: uniq('s'), at, amount: 1_110, name: uniq('무시할') },
    ])
    await page.goto('/deposits')
    const radios = depositRow(page, d!.no).getByRole('radiogroup')
    await expect(radios).toContainText(`남은 금액 ${won(sale.remaining)}`)
    expect((await writeEvent(page, { type: 'settlement.payment', buyer: sale.buyer, date: sale.date, amount: 100 }, { date: sale.date, rehearsal: false })).status).toBeLessThan(300)
    await expect(radios).toContainText(`남은 금액 ${won(sale.remaining - 100)}`, { timeout: 5_000 })
    // 한꺼번에 무시
    await depositRow(page, d!.no).getByRole('checkbox', { name: `입금 번호 ${String(d!.no)} 고르기` }).check() // MOB2 D-MOB2-05
    await depositRow(page, e!.no).getByRole('checkbox', { name: `입금 번호 ${String(e!.no)} 고르기` }).check() // MOB2 D-MOB2-05
    await page.getByRole('group', { name: '선택한 입금' }).getByRole('button', { name: '선택한 입금 무시 (2건)' }).click()
    const dlg = page.getByRole('dialog', { name: '선택한 입금 무시 (2건)' })
    await dlg.getByRole('button', { name: '2건 무시' }).click()
    await expect(dlg).toHaveCount(0)
    await expect(depositRow(page, d!.no)).toHaveCount(0)
    await expect(depositRow(page, e!.no)).toHaveCount(0)
    expect((await depositOne(page, d!.no)).status).toBe('IGNORED')
    expect((await depositOne(page, e!.no)).status).toBe('IGNORED')
    expect((await history(page, sale.date, false)).filter((x) => x.type === 'settlement.payment' && x.fields['buyer'] === sale.buyer)).toHaveLength(1)
  })
})

