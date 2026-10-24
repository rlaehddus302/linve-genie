// N3 방송 뒤 흔한 경우들 (L. 테스트 관점): 두 날 묶음, 같은 이름 두 사람, 두 날을 한 번에 보냄, 한꺼번에 중 하나가 바뀜,
// 다른 시간대 기기, 붙여넣기 줄 수·크기 초과 (AC-N3-41·42·43·28·45·50, DP-5·DP-8) — test-e2e.
import { test, expect } from '@playwright/test'
import {
  deposit, depositOne, depositRow, fakeSource, history, kstIso, login, postJson, recentDate, shortKst, smsSale, uniq, won, writeEvent,
} from './support.ts'
import { cleanupPrint } from '../i1/support.ts'

// 출력 기록은 판매자 단위 — 판매(1등)가 만든 라벨 작업을 남기면 뒤 시험(N4a 등)의 출력 기기가 쌓인 라벨로 멈춘다 (i1 support "시험끼리 출력 기록이 섞이지 않게")
test.afterEach(async ({ page }) => {
  await cleanupPrint(page)
})

const SEARCH = '찾을 말 (구매자 이름·닉네임·메모·전화번호 뒤 4자리)'

test.describe('확인 필요 사유', () => {
  // 문자 구매자는 범위(날짜)마다 다른 구매자 ID다 — 같은 전화번호라도 두 날의 "지금의 구매자"가 둘이라 DP-5 2(SAME_NAME)가 먼저다.
  test('같은 전화번호의 두 날 묶음이 같은 금액 → 확인 필요(같은 이름의 구매자가 여럿), 미리 고르지 않음 → 하나를 골라 확정 (DP-5 2·후보 제안)', async ({ page }) => {
    await login(page)
    const name = uniq('두날')
    const phone = `010-5${String(100 + Math.floor(Math.random() * 899))}-${String(1000 + Math.floor(Math.random() * 8999))}`
    const price = 10_000 + Math.floor(Math.random() * 300) * 100 + 70
    const a = await smsSale(page, { memo: name, phone, price })
    const b = await smsSale(page, { memo: name, phone, price })
    expect(a.remaining).toBe(b.remaining)
    const src = await fakeSource(page)
    const [d] = await deposit(page, src, [{ key: uniq('mu'), at: kstIso(5_000), amount: a.remaining, name }])
    expect(d!.status).toBe('REVIEW')
    await page.goto('/deposits')
    const row = depositRow(page, d!.no)
    await expect(row).toContainText('같은 이름의 구매자가 여럿이에요')
    const radios = row.getByRole('radiogroup', { name: `입금 #${String(d!.no)} 묶음` }).getByRole('radio')
    await expect(radios).toHaveCount(2)
    await expect(radios.nth(0)).not.toBeChecked()
    await expect(radios.nth(1)).not.toBeChecked()
    const confirm = row.getByRole('group', { name: `입금 #${String(d!.no)} 처리` }).getByRole('button', { name: '확정' })
    await expect(confirm).toBeDisabled()
    // 날짜가 늦은 묶음이 먼저 (DP-5 후보 제안 순서)
    const later = a.date > b.date ? a : b
    await expect(radios.nth(0).locator('xpath=..')).toContainText(`${Number(later.date.slice(5, 7))}월 ${Number(later.date.slice(8, 10))}일`)
    await radios.nth(0).check()
    await confirm.click()
    await page.getByRole('dialog', { name: '입금 확정' }).getByRole('button', { name: '확정' }).click()
    await expect(row).toHaveCount(0)
    expect((await depositOne(page, d!.no)).applied?.date).toBe(later.date)
  })

  test('같은 메모의 두 문자 구매자 → "같은 이름의 구매자가 여럿이에요", 금액이 한 사람과만 맞아도 자동으로 적지 않음 (DP-5 2)', async ({ page }) => {
    await login(page)
    const name = uniq('동명')
    const date = recentDate()
    const a = await smsSale(page, { memo: name, date, price: 12_340 + Math.floor(Math.random() * 100) * 100 })
    const b = await smsSale(page, { memo: name, date, price: 23_450 + Math.floor(Math.random() * 100) * 100 })
    expect(a.buyer).not.toBe(b.buyer)
    const src = await fakeSource(page)
    const [d] = await deposit(page, src, [{ key: uniq('sn'), at: kstIso(5_000), amount: a.remaining, name }])
    expect(d!.status).toBe('REVIEW')
    await page.goto('/deposits')
    await expect(depositRow(page, d!.no)).toContainText('같은 이름의 구매자가 여럿이에요')
    expect((await history(page, date, false)).filter((e) => e.type === 'settlement.payment' && (e.fields['buyer'] === a.buyer || e.fields['buyer'] === b.buyer))).toHaveLength(0)
  })

  test('두 날 묶음을 한 번에 보냄(합계) → 확인 필요, 두 묶음 모두 제안(과입금 미리 보기)·미리 고르지 않음', async ({ page }) => {
    await login(page)
    const name = uniq('합계')
    const phone = `010-6${String(100 + Math.floor(Math.random() * 899))}-${String(1000 + Math.floor(Math.random() * 8999))}`
    const a = await smsSale(page, { memo: name, phone })
    const b = await smsSale(page, { memo: name, phone })
    const src = await fakeSource(page)
    const [d] = await deposit(page, src, [{ key: uniq('sum'), at: kstIso(5_000), amount: a.remaining + b.remaining, name }])
    await page.goto('/deposits')
    const row = depositRow(page, d!.no)
    await expect(row).toContainText('같은 이름의 구매자가 여럿이에요')
    const radios = row.getByRole('radiogroup').getByRole('radio')
    await expect(radios).toHaveCount(2)
    await expect(row.getByRole('radiogroup')).toContainText(`미입금 → 과입금(환불 필요 ${won(Math.min(a.remaining, b.remaining))})`)
    for (const r of await radios.all()) await expect(r).not.toBeChecked()
  })
})

test.describe('다른 묶음 지정 찾기', () => {
  test('전화번호 뒤 4자리로 찾고, 날짜 고르기로 좁힌다 (AC-N3-43·33)', async ({ page }) => {
    await login(page)
    const name = uniq('뒷번호')
    const last4 = String(1000 + Math.floor(Math.random() * 8999))
    const phone = `010-7${String(100 + Math.floor(Math.random() * 899))}-${last4}`
    const a = await smsSale(page, { memo: name, phone })
    const b = await smsSale(page, { memo: name, phone })
    const src = await fakeSource(page)
    const [d] = await deposit(page, src, [{ key: uniq('ph'), at: kstIso(5_000), amount: 3_330, name: uniq('모르는') }])
    await page.goto('/deposits')
    await depositRow(page, d!.no).getByRole('button', { name: '다른 묶음 지정' }).click()
    const search = page.getByRole('dialog', { name: `다른 묶음 지정 · 입금 #${String(d!.no)}` })
    await search.getByLabel(SEARCH).fill(last4)
    const found = search.getByRole('list', { name: '찾은 묶음' }).getByRole('button').filter({ hasText: name })
    await expect(found).toHaveCount(2)
    const opt = await search.getByLabel('날짜').locator('option').filter({ hasText: `${a.date.slice(0, 4)}년 ${String(Number(a.date.slice(5, 7)))}월 ${String(Number(a.date.slice(8, 10)))}일` }).getAttribute('value')
    await search.getByLabel('날짜').selectOption(opt!)
    await expect(found).toHaveCount(1)
    await expect(found).toContainText(`${String(Number(a.date.slice(5, 7)))}월 ${String(Number(a.date.slice(8, 10)))}일`)
    expect(b.date).not.toBe(a.date)
  })
})

test.describe('한꺼번에·시간대·붙여넣기 한계', () => {
  test('한꺼번에 확정 중 한 묶음이 바뀌면 그 줄만 거절 문장, 나머지는 확정 (AC-N3-28·42)', async ({ page }) => {
    await login(page)
    const n1 = uniq('일괄일')
    const n2 = uniq('일괄이')
    const s1 = await smsSale(page, { memo: n1 })
    const s2 = await smsSale(page, { memo: n2 })
    const src = await fakeSource(page)
    const at = kstIso(5_000)
    const [d1, d2] = await deposit(page, src, [
      { key: uniq('u'), at, amount: s1.remaining - 10, name: n1 },
      { key: uniq('v'), at, amount: s2.remaining - 20, name: n2 },
    ])
    await page.goto('/deposits')
    await depositRow(page, d1!.no).getByRole('checkbox', { name: `입금 #${String(d1!.no)} 고르기` }).check()
    await depositRow(page, d2!.no).getByRole('checkbox', { name: `입금 #${String(d2!.no)} 고르기` }).check()
    await page.getByRole('group', { name: '선택한 입금' }).getByRole('button', { name: '선택한 입금 확정 (2건)' }).click()
    const dlg = page.getByRole('dialog', { name: '선택한 입금 확정 (2건)' })
    await expect(dlg).toBeVisible()
    expect((await writeEvent(page, { type: 'settlement.payment', buyer: s2.buyer, date: s2.date, amount: 5 }, { date: s2.date, rehearsal: false })).status).toBeLessThan(300)
    await dlg.getByRole('button', { name: '2건 확정' }).click()
    await expect(dlg).toHaveCount(0)
    const notice = page.getByRole('status').filter({ hasText: '입금 1건을 확정했어요. 1건은 확정하지 못했어요.' })
    await expect(notice).toContainText(`입금 #${String(d2!.no)}: 묶음 금액이 바뀌었어요. 다시 확인해 주세요.`)
    expect((await depositOne(page, d1!.no)).status).toBe('APPLIED')
    expect((await depositOne(page, d2!.no)).status).toBe('REVIEW')
    // 거절된 줄은 새 제안(바뀐 남은 금액)으로
    await expect(depositRow(page, d2!.no).getByRole('radiogroup')).toContainText(`남은 금액 ${won(s2.remaining - 5)}`)
  })

  test('하와이 시간대 기기에서도 입금 시각·정산의 입금 연결 시각은 KST (AC-N3-50, NFR-07)', async ({ page, browser }) => {
    await login(page)
    const name = uniq('하와이')
    const sale = await smsSale(page, { memo: name })
    const src = await fakeSource(page)
    const at = kstIso(5_000)
    const [d] = await deposit(page, src, [{ key: uniq('hi'), at, amount: sale.remaining, name }])
    const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Pacific/Honolulu', baseURL: new URL(page.url()).origin })
    const hi = await ctx.newPage()
    await hi.goto('/login') // LND1 D-LND1-01
    await hi.getByLabel('아이디').fill('e2e-shop')
    await hi.getByLabel('비밀번호').fill('e2e-pass-1234')
    await hi.getByRole('button', { name: '로그인' }).click()
    await expect(hi.getByRole('button', { name: '로그아웃' })).toBeVisible()
    await hi.goto('/deposits?tab=done')
    await expect(depositRow(hi, d!.no, '자동 확인됨·확인함 입금')).toContainText(shortKst(at))
    await hi.goto(`/settlements?date=${sale.date}&buyer=${encodeURIComponent(sale.buyer)}`)
    await expect(hi.getByRole('region', { name: '정산 자세히' })).toContainText(`자동 입금 확인 · ${name} · ${shortKst(at)}`)
    await ctx.close()
  })

  test('붙여넣기 2,001줄 → 줄 수 문장, 64KB 넘는 글 → 크기 문장 (AC-N3-13·45)', async ({ page }) => {
    await login(page)
    await page.goto('/deposits?tab=paste')
    const rows = Array.from({ length: 2001 }, (_, i) => `2026-10-18 21:03,a${String(i)},1000`)
    await page.getByLabel('입금 내역').fill(['거래일시,입금자명,입금액', ...rows].join('\n'))
    await page.getByRole('button', { name: '읽어 보기' }).click()
    await expect(page.getByText('한 번에 2,000줄까지 넣을 수 있어요. 나눠서 넣어 주세요.')).toBeVisible()
    const big = Array.from({ length: 1500 }, (_, i) => `2026-10-18 21:03,${'가'.repeat(40)}${String(i)},1000`)
    await page.getByLabel('입금 내역').fill(['거래일시,입금자명,입금액', ...big].join('\n'))
    await page.getByRole('button', { name: '읽어 보기' }).click()
    await expect(page.getByText('보낸 내용이 너무 커요.')).toBeVisible()
    const res = await postJson(page, '/api/deposits/paste/preview', { text: ['거래일시,입금자명,입금액', ...big].join('\n') })
    expect(res.status).toBe(413)
  })
})
