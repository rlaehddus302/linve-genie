// N3 끝까지 흐름 (AC-N3-40~44·47, DP-5·DP-6·DP-8) — test-e2e.
// 실제 방송(지난 날짜)에서 문자찜(메모 = 이름) 판매 → 시험 모드 가짜 원천으로 입금 → 자동 확인·확인 필요 → 화면에서 처리 → 정산 화면.
// 기대값: 메모·사유 문장·낱말은 DEPOSIT_RULES DP-5·DP-6·DP-8과 acceptance.md 문장 그대로. 금액은 범위 조회(코어 정산)의 total − received.
import { test, expect, type Page } from '@playwright/test'
import {
  dateLongKo, deposit, depositOne, depositRow, depositTab, fakeSource, history, kstIso, login, menu, primaryOutsideDialogs,
  oddPrice, reviewCount, scopeView, shortKst, smsSale, uniq, won, writeEvent,
} from './support.ts'
import { cleanupPrint } from '../i1/support.ts'

// 출력 기록은 판매자 단위 — 판매(1등)가 만든 라벨 작업을 남기면 뒤 시험(N4a 등)의 출력 기기가 쌓인 라벨로 멈춘다 (i1 support "시험끼리 출력 기록이 섞이지 않게")
test.afterEach(async ({ page }) => {
  await cleanupPrint(page)
})

function longNoDow(date: string): string {
  return dateLongKo(date).replace(/\(.\)$/, '')
}

async function openReview(page: Page): Promise<void> {
  await page.goto('/deposits')
  await expect(depositTab(page, /^확인 필요/)).toHaveAttribute('aria-selected', 'true')
}

test.describe('입금 확인 끝까지 흐름', () => {
  test('자동 확인(공백·대소문자 다른 이름) → 정산 기록 "자동 입금 확인 · 이름 · 시각", 이력 "입금 자동 확인", 정산에서 되돌리기 → 확인 필요로 (AC-N3-20·44·47)', async ({ page }) => {
    await login(page)
    const memo = uniq('Kim영희')
    const sale = await smsSale(page, { memo })
    const src = await fakeSource(page)
    const at = kstIso(15_000)
    // 정규화(DP-3): 공백·대소문자만 다른 이름은 같다
    const sent = ` ${memo.toUpperCase().replace('영희', '영 희')} `
    const [d] = await deposit(page, src, [{ key: uniq('k'), at, amount: sale.remaining, name: sent }])
    expect(d!.status).toBe('AUTO_APPLIED')
    const view = await scopeView(page, sale.date, false)
    const s = view.settlements.find((x) => x.buyer === sale.buyer)!
    expect(s.payment).toBe('PAID')
    // 엔진 기록: 메모에는 입금 번호만 (DP-INV-5)
    const pays = (await history(page, sale.date, false)).filter((e) => e.type === 'settlement.payment')
    expect(pays).toHaveLength(1)
    expect(pays[0]!.fields['memo']).toBe(`자동 입금 확인 · 입금 #${String(d!.no)}`)
    expect(pays[0]!.actor.kind).not.toBe('account')

    // 자동 확인됨·확인함 목록
    await page.goto('/deposits?tab=done')
    const doneRow = depositRow(page, d!.no, '자동 확인됨·확인함 입금')
    await expect(doneRow).toContainText('자동 확인됨')
    await expect(doneRow).toContainText(won(sale.remaining))
    await expect(doneRow).toContainText(shortKst(at))

    // 정산 자세히 (AC-N3-47)
    await page.goto(`/settlements?date=${sale.date}&buyer=${encodeURIComponent(sale.buyer)}`)
    const detail = page.getByRole('region', { name: '정산 자세히' })
    await expect(detail).toContainText(`자동 입금 확인 · ${sent.trim()} · ${shortKst(at)}`)
    await detail.getByRole('button', { name: '입금 확인 되돌리기' }).click()
    const dlg = page.getByRole('dialog', { name: '입금 확인 되돌리기' })
    await expect(dlg).toContainText(`${won(sale.remaining)} 입금을 되돌려요. 같은 금액의 환불 기록이 남고 이 입금은 확인 필요로 돌아가요.`)
    await dlg.getByRole('button', { name: '되돌리기' }).click()
    await expect(dlg).toHaveCount(0)
    await expect(detail).toContainText(`입금 확인 되돌림 · 입금 번호 ${String(d!.no)}`) // MOB2 D-MOB2-05
    await expect(detail.getByRole('button', { name: '입금 확인 되돌리기' })).toHaveCount(0)
    await expect(detail).toContainText('미입금')
    expect((await depositOne(page, d!.no)).status).toBe('REVIEW')
    const refunds = (await history(page, sale.date, false)).filter((e) => e.type === 'settlement.refund')
    expect(refunds.map((e) => e.reason ?? e.fields['reason'])).toEqual([`입금 확인 되돌림 · 입금 #${String(d!.no)}`])

    // 되돌린 입금은 확인 필요에 다시 — 볼 때 다시 계산하면 맞는 묶음 하나(ONE_MATCH)를 미리 고른다
    await openReview(page)
    const row = depositRow(page, d!.no)
    await expect(row).toContainText('맞는 묶음이 하나 있어요. 확인해 주세요')
    await expect(row.getByRole('radiogroup', { name: `입금 번호 ${String(d!.no)} 묶음` }).getByRole('radio').first()).toBeChecked() // MOB2 D-MOB2-05
  })

  test('확인 필요 사유 문장·제안·빈 이름·이스케이프, 한 건 확정(부분 입금)·무시·다시 확인 필요로 (AC-N3-41·42·44)', async ({ page }) => {
    await login(page)
    const nameB = uniq('박민수')
    // 박민수 입금(남은 금액 − 4,000원)이 다른 시험이 남긴 묶음의 남은 금액과 우연히 같으면 사유가 "금액은 맞는데 이름이 달라요"로 바뀐다 —
    // 다른 시험의 가격 끝자리(…30·…40·…50)와 겹치지 않게 끝자리 …70으로 (확인 내용은 그대로)
    const saleB = await smsSale(page, { memo: nameB, price: oddPrice() + 40 })
    const saleC = await smsSale(page, { memo: uniq('최지우') })
    const src = await fakeSource(page)
    const at = kstIso(10_000)
    const evil = '<img src=x onerror="window.__pwned=1">'
    const rows = [
      { key: uniq('b'), at, amount: saleB.remaining - 4000, name: nameB }, // 배송비 빠짐 → 이름은 맞는데 금액이 달라요
      { key: uniq('c'), at, amount: saleC.remaining, name: '다른사람' }, // 금액은 맞는데 이름이 달라요
      { key: uniq('e'), at, amount: 1234, name: '' }, // (이름 없음)
      { key: uniq('x'), at, amount: 4321, name: evil },
      { key: uniq('f'), at, amount: 5678, name: '=1+2' },
    ]
    const [dB, dC, dEmpty, dEvil, dFormula] = await deposit(page, src, rows)
    for (const d of [dB, dC, dEmpty, dEvil, dFormula]) expect(d!.status).toBe('REVIEW')

    await openReview(page)
    const rowB = depositRow(page, dB!.no)
    await expect(rowB).toContainText('이름은 맞는데 금액이 달라요')
    await expect(rowB).toContainText(nameB)
    const radioB = rowB.getByRole('radiogroup', { name: `입금 번호 ${String(dB!.no)} 묶음` }).getByRole('radio') // MOB2 D-MOB2-05
    await expect(radioB).toHaveCount(1)
    await expect(radioB).toBeChecked() // 제안이 정확히 하나 → 미리 고름
    await expect(rowB.getByRole('radiogroup')).toContainText(`${longNoDow(saleB.date)} 묶음 · 남은 금액 ${won(saleB.remaining)} · 미입금 → 부분 입금`)

    const rowC = depositRow(page, dC!.no)
    await expect(rowC).toContainText('금액은 맞는데 이름이 달라요')
    await expect(depositRow(page, dEmpty!.no)).toContainText('(이름 없음)')
    await expect(depositRow(page, dEvil!.no)).toContainText(evil)
    await expect(depositRow(page, dFormula!.no)).toContainText('=1+2')
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined()
    // 원천 낱말
    await expect(rowB).toContainText('시험용 입금')
    // 제안이 없으면 확정은 잠김
    await expect(depositRow(page, dEmpty!.no).getByRole('group', { name: `입금 번호 ${String(dEmpty!.no)} 처리` }).getByRole('button', { name: '확정' })).toBeDisabled() // MOB2 D-MOB2-05
    // 아무것도 고르지 않은 화면의 주 버튼은 많아야 하나
    expect((await primaryOutsideDialogs(page)).length).toBeLessThanOrEqual(1)

    // 한 건 확정 → 창
    await rowB.getByRole('group', { name: `입금 번호 ${String(dB!.no)} 처리` }).getByRole('button', { name: '확정' }).click() // MOB2 D-MOB2-05
    const dlg = page.getByRole('dialog', { name: '입금 확정' })
    await expect(dlg.getByRole('list', { name: '확정할 입금' })).toContainText(`${longNoDow(saleB.date)} 묶음 · ${won(saleB.remaining - 4000)} 입금 · 미입금 → 부분 입금`)
    // 문자 구매자 → 기억 고르기 없음 (D-N3-03)
    await expect(dlg.getByRole('checkbox', { name: '다음에도 이 입금자명이면 이 구매자로 볼게요' })).toHaveCount(0)
    await dlg.getByRole('button', { name: '확정' }).click()
    await expect(dlg).toHaveCount(0)
    await expect(depositRow(page, dB!.no)).toHaveCount(0)
    expect((await depositOne(page, dB!.no)).status).toBe('APPLIED')
    const pays = (await history(page, saleB.date, false)).filter((e) => e.type === 'settlement.payment')
    expect(pays.map((e) => [e.fields['memo'], e.fields['amount'], e.actor.kind])).toEqual([[`입금 내역으로 확인 · 입금 #${String(dB!.no)}`, saleB.remaining - 4000, 'account']])
    // 정산 기록에 "입금 내역으로 확인 · 이름 · 시각"
    await page.goto(`/settlements?date=${saleB.date}&buyer=${encodeURIComponent(saleB.buyer)}`)
    await expect(page.getByRole('region', { name: '정산 자세히' })).toContainText(`입금 내역으로 확인 · ${nameB} · ${shortKst(at)}`)

    // 무시 → 무시함 → 다시 확인 필요로
    await openReview(page)
    await depositRow(page, dC!.no).getByRole('group', { name: `입금 번호 ${String(dC!.no)} 처리` }).getByRole('button', { name: '무시' }).click() // MOB2 D-MOB2-05
    await expect(depositRow(page, dC!.no)).toHaveCount(0)
    await depositTab(page, /^무시함/).click()
    await expect(page).toHaveURL(/tab=ignored/)
    const ign = depositRow(page, dC!.no, '무시한 입금')
    await expect(ign).toBeVisible()
    await ign.getByRole('button', { name: '다시 확인 필요로' }).click()
    await expect(ign).toHaveCount(0)
    expect((await depositOne(page, dC!.no)).status).toBe('REVIEW')
    // 주소에 입금자명·금액이 없다
    expect(page.url()).not.toContain(encodeURIComponent('다른사람'))
    expect(page.url()).not.toContain(String(saleC.remaining))
  })

  test('같은 입금 두 번 → "같은 입금이 두 번 들어왔을 수 있어요 (입금 번호 N도 같은 입금이에요)", 자동으로 적지 않음 (DP-5 1, AC-N3-41)', async ({ page }) => { // MOB2 D-MOB2-05
    await login(page)
    const name = uniq('이중입금')
    const sale = await smsSale(page, { memo: name })
    const src1 = await fakeSource(page, '첫째 통장')
    const src2 = await fakeSource(page, '둘째 통장')
    const at = kstIso(5_000)
    const [first] = await deposit(page, src1, [{ key: uniq('a'), at, amount: sale.remaining, name }])
    expect(first!.status).toBe('AUTO_APPLIED')
    const [second] = await deposit(page, src2, [{ key: uniq('a'), at, amount: sale.remaining, name }])
    expect(second!.status).toBe('REVIEW')
    await openReview(page)
    await expect(depositRow(page, second!.no)).toContainText(`같은 입금이 두 번 들어왔을 수 있어요 (입금 번호 ${String(first!.no)}도 같은 입금이에요)`) // MOB2 D-MOB2-05 + QL3R2 D-QL3R2-04 (D-QL3R1-10 (3))
    // 묶음은 과입금이 아니다
    const s = (await scopeView(page, sale.date, false)).settlements.find((x) => x.buyer === sale.buyer)!
    expect(s.received).toBe(sale.remaining)
  })

  test('다른 묶음 지정: 찾기 → 입금 완료 묶음 → 과입금 미리 보기(주의, "환불 필요") → 확정 (AC-N3-43·42)', async ({ page }) => {
    await login(page)
    const name = uniq('정다른')
    const sale = await smsSale(page, { memo: name })
    // 이미 입금 완료 (손 입금)
    expect((await writeEvent(page, { type: 'settlement.payment', buyer: sale.buyer, date: sale.date, amount: sale.remaining }, { date: sale.date, rehearsal: false })).status).toBeLessThan(300)
    const src = await fakeSource(page)
    const [d] = await deposit(page, src, [{ key: uniq('o'), at: kstIso(5_000), amount: 7000, name: uniq('엉뚱') }])
    await openReview(page)
    await depositRow(page, d!.no).getByRole('group', { name: `입금 번호 ${String(d!.no)} 처리` }).getByRole('button', { name: '다른 묶음 지정' }).click() // MOB2 D-MOB2-05
    const search = page.getByRole('dialog', { name: `다른 묶음 지정 · 입금 번호 ${String(d!.no)}` }) // MOB2 D-MOB2-05
    await search.getByLabel('찾을 말 (구매자 이름·닉네임·메모·전화번호 뒤 4자리)').fill(name)
    // 날짜 고르기는 연도·요일까지
    await expect(search.getByLabel('날짜').locator('option', { hasText: dateLongKo(sale.date) })).toHaveCount(1)
    const found = search.getByRole('list', { name: '찾은 묶음' }).getByRole('button')
    await expect(found).toHaveCount(1)
    await expect(found).toContainText('입금 완료 → 과입금(환불 필요 7,000원)')
    await found.click()
    const dlg = page.getByRole('dialog', { name: '입금 확정' })
    await expect(dlg).toContainText('환불 필요 7,000원')
    await expect(dlg.locator('li[data-tone="warning"]')).toHaveCount(1)
    await dlg.getByRole('button', { name: '확정' }).click()
    await expect(dlg).toHaveCount(0)
    await expect.poll(async () => (await depositOne(page, d!.no)).status).toBe('APPLIED')
    const s = (await scopeView(page, sale.date, false)).settlements.find((x) => x.buyer === sale.buyer)!
    expect([s.payment, s.refundDue]).toEqual(['OVERPAID', 7000])
  })

  test('확정 창을 연 사이 손 입금 → BUNDLE_CHANGED 문장, 기록 없음, 새 제안으로 (AC-N3-42)', async ({ page }) => {
    await login(page)
    const name = uniq('바뀜이')
    const sale = await smsSale(page, { memo: name })
    const src = await fakeSource(page)
    const [d] = await deposit(page, src, [{ key: uniq('m'), at: kstIso(5_000), amount: sale.remaining - 1000, name }])
    await openReview(page)
    await depositRow(page, d!.no).getByRole('group', { name: `입금 번호 ${String(d!.no)} 처리` }).getByRole('button', { name: '확정' }).click() // MOB2 D-MOB2-05
    const dlg = page.getByRole('dialog', { name: '입금 확정' })
    await expect(dlg).toBeVisible()
    expect((await writeEvent(page, { type: 'settlement.payment', buyer: sale.buyer, date: sale.date, amount: 500 }, { date: sale.date, rehearsal: false })).status).toBeLessThan(300)
    await dlg.getByRole('button', { name: '확정' }).click()
    await expect(page.getByRole('status').filter({ hasText: '묶음 금액이 바뀌었어요. 다시 확인해 주세요.' })).toBeVisible()
    await expect(dlg).toHaveCount(0)
    expect((await depositOne(page, d!.no)).status).toBe('REVIEW')
    expect((await history(page, sale.date, false)).filter((e) => e.type === 'settlement.payment')).toHaveLength(1)
    // 새 제안: 남은 금액이 바뀐 묶음
    await expect(depositRow(page, d!.no).getByRole('radiogroup')).toContainText(`남은 금액 ${won(sale.remaining - 500)}`)
  })

  test('한꺼번에 확정 (2건) → 확인 창 "2건 확정" → 둘 다 확인함, 메뉴 수가 줄어듦 (AC-N3-28·40·41)', async ({ page }) => {
    await login(page)
    const n1 = uniq('묶음일')
    const n2 = uniq('묶음이')
    const s1 = await smsSale(page, { memo: n1 })
    const s2 = await smsSale(page, { memo: n2 })
    const src = await fakeSource(page)
    const at = kstIso(5_000)
    const [d1, d2] = await deposit(page, src, [
      { key: uniq('p'), at, amount: s1.remaining - 100, name: n1 },
      { key: uniq('q'), at, amount: s2.remaining - 200, name: n2 },
    ])
    await openReview(page)
    const before = await reviewCount(page)
    await expect(menu(page).getByRole('link', { name: `입금 확인 ${String(before)}` })).toBeVisible()
    await expect(depositTab(page, /^확인 필요/)).toHaveText(new RegExp(`확인 필요 ${String(before)}`))
    await depositRow(page, d1!.no).getByRole('checkbox', { name: `입금 번호 ${String(d1!.no)} 고르기` }).check() // MOB2 D-MOB2-05
    await depositRow(page, d2!.no).getByRole('checkbox', { name: `입금 번호 ${String(d2!.no)} 고르기` }).check() // MOB2 D-MOB2-05
    const sel = page.getByRole('group', { name: '선택한 입금' })
    expect(await primaryOutsideDialogs(page)).toEqual(['선택한 입금 확정 (2건)'])
    await sel.getByRole('button', { name: '선택한 입금 확정 (2건)' }).click()
    const dlg = page.getByRole('dialog', { name: '선택한 입금 확정 (2건)' })
    await expect(dlg.getByRole('listitem')).toHaveCount(2)
    await dlg.getByRole('button', { name: '2건 확정' }).click()
    await expect(dlg).toHaveCount(0)
    await expect(depositRow(page, d1!.no)).toHaveCount(0)
    await expect(depositRow(page, d2!.no)).toHaveCount(0)
    expect((await depositOne(page, d1!.no)).status).toBe('APPLIED')
    expect((await depositOne(page, d2!.no)).status).toBe('APPLIED')
    await expect(menu(page).getByRole('link', { name: before - 2 === 0 ? '입금 확인' : `입금 확인 ${String(before - 2)}`, exact: true })).toBeVisible()
  })

  test('입금 하나 자세히: 처리 기록(받음·자동 확인·되돌리기) 시간 순, "입금 자동 확인" 낱말 (AC-N3-44·31)', async ({ page }) => {
    await login(page)
    const name = uniq('기록이')
    const sale = await smsSale(page, { memo: name })
    const src = await fakeSource(page)
    const [d] = await deposit(page, src, [{ key: uniq('r'), at: kstIso(5_000), amount: sale.remaining, name }])
    expect(d!.status).toBe('AUTO_APPLIED')
    await page.goto('/deposits?tab=done')
    const row = depositRow(page, d!.no, '자동 확인됨·확인함 입금')
    await row.getByRole('button', { name: '되돌리기' }).click()
    const dlg = page.getByRole('dialog', { name: '입금 확인 되돌리기' })
    await dlg.getByRole('button', { name: '되돌리기' }).click()
    await expect(dlg).toHaveCount(0)
    await expect(row).toHaveCount(0)
    await page.goto('/deposits')
    await depositRow(page, d!.no).getByRole('button', { name: '자세히' }).click()
    const detail = page.getByRole('dialog', { name: `입금 번호 ${String(d!.no)}` }) // MOB2 D-MOB2-05
    const records = detail.getByRole('region', { name: '처리 기록' })
    await expect(records).toContainText('입금 자동 확인')
    const text = (await records.innerText()).replace(/\s+/g, ' ')
    expect(text).toMatch(/자동 확인[\s\S]*되돌/)
    for (const word of ['AUTO', 'REVERT', 'RECEIVED', 'auto', 'account']) expect(text).not.toContain(word)
  })
})
