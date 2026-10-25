// N3 입금 내역 붙여넣기 (AC-N3-45, AC-N3-11·13, DP-2) — test-e2e.
// 줄 번호·이유 문장·결과 문장은 acceptance.md AC-N3-45, 서버 문장은 AC-N3-13 그대로.
import { test, expect, type Page } from '@playwright/test'
import { deposits, depositTab, login, primaryOutsideDialogs, scopeView, smsSale, uniq } from './support.ts'
import { cleanupPrint } from '../i1/support.ts'

// 출력 기록은 판매자 단위 — 판매(1등)가 만든 라벨 작업을 남기면 뒤 시험(N4a 등)의 출력 기기가 쌓인 라벨로 멈춘다 (i1 support "시험끼리 출력 기록이 섞이지 않게")
test.afterEach(async ({ page }) => {
  await cleanupPrint(page)
})

/** 지금 + minutes분의 KST "YYYY-MM-DD HH:MM" (분 정밀도 — 그 분의 0초는 판매 시각 뒤) */
function kstMinute(minutes: number): string {
  const k = new Date(Date.now() + minutes * 60_000 + 9 * 3_600_000).toISOString()
  return `${k.slice(0, 10)} ${k.slice(11, 16)}`
}

async function openPaste(page: Page): Promise<void> {
  await page.goto('/deposits?tab=paste')
  await expect(depositTab(page, /^붙여넣기$/)).toHaveAttribute('aria-selected', 'true')
}

test.describe('입금 내역 붙여넣기', () => {
  test('엑셀에서 복사한 탭 표: 읽어 보기(읽지 못한 줄 번호·이유) → 넣기 → 결과 문장, 글 칸 비움 → 같은 글 다시 = 새 입금 0 (AC-N3-45·11)', async ({ page }) => {
    await login(page)
    const n1 = uniq('붙임일')
    const n2 = uniq('붙임이')
    const s1 = await smsSale(page, { memo: n1 })
    const s2 = await smsSale(page, { memo: n2 })
    const t = kstMinute(2)
    const text = [
      '국민은행 거래내역조회',
      '거래일시\t적요\t입금액\t출금액\t잔액',
      `${t}\t${n1}\t${String(s1.remaining)}\t0\t100000`,
      `${t}\t${n2}\t${(s2.remaining - 1000).toLocaleString('en-US')}\t0\t200000`,
      `${t}\t출금건\t0\t5000\t195000`,
      `${t}\t이상한\t12.5\t0\t195000`,
      `${t.slice(0, 10)}\t시각없음\t1000\t0\t196000`,
      '',
    ].join('\n')
    await openPaste(page)
    await page.getByLabel('입금 내역').fill(text)
    const insert = page.getByRole('button', { name: '입금 내역 넣기' })
    await expect(insert).toBeDisabled() // 읽어 보기 전
    await page.getByRole('button', { name: '읽어 보기' }).click()
    const preview = page.getByRole('region', { name: '읽어 본 결과' })
    const bad = preview.getByRole('list', { name: '읽지 못한 줄' })
    await expect(bad).toContainText('6번째 줄: 금액을 읽지 못했어요')
    await expect(bad).toContainText('7번째 줄: 시각을 읽지 못했어요(분까지 필요해요)')
    await expect(preview).toContainText('새 입금 2건')
    // 미리 보기는 아무것도 기록하지 않는다
    expect((await deposits(page, 'REVIEW,AUTO_APPLIED,APPLIED,IGNORED', 200)).some((d) => d.name === n1)).toBe(false)
    expect(await primaryOutsideDialogs(page)).toEqual(['입금 내역 넣기'])
    await insert.click()
    await expect(page.getByRole('status').filter({ hasText: '새 입금 2건 — 자동 확인 1건, 확인 필요 1건' })).toBeVisible()
    await expect(page.getByLabel('입금 내역')).toHaveValue('')
    const all = await deposits(page, 'REVIEW,AUTO_APPLIED,APPLIED,IGNORED', 200)
    expect(all.find((d) => d.name === n1)?.status).toBe('AUTO_APPLIED')
    expect(all.find((d) => d.name === n2)?.status).toBe('REVIEW')
    expect(all.find((d) => d.name === n1)?.source.kind).toBe('PASTE')
    expect((await scopeView(page, s1.date, false)).settlements.find((x) => x.buyer === s1.buyer)!.payment).toBe('PAID')

    // 같은 글을 다시 (요청 번호가 달라도) → 새 입금 0건, 이미 있던 입금 2건
    await page.getByLabel('입금 내역').fill(text)
    await page.getByRole('button', { name: '읽어 보기' }).click()
    await expect(preview).toContainText('이미 있는 입금 2건')
    await insert.click()
    await expect(page.getByRole('status').filter({ hasText: '새 입금 0건' })).toContainText('이미 있던 입금 2건')
    expect((await deposits(page, 'REVIEW,AUTO_APPLIED,APPLIED,IGNORED', 200)).filter((d) => d.name === n1 || d.name === n2)).toHaveLength(2)
  })

  test('읽어 본 뒤 글을 고치면 넣기가 잠긴다 — 본 것과 다른 글을 넣지 않음', async ({ page }) => {
    await login(page)
    await openPaste(page)
    await page.getByLabel('입금 내역').fill(`거래일시,입금자명,입금액\n${kstMinute(1)},${uniq('고침')},3000\n`)
    await page.getByRole('button', { name: '읽어 보기' }).click()
    const insert = page.getByRole('button', { name: '입금 내역 넣기' })
    await expect(insert).toBeEnabled()
    await page.getByLabel('입금 내역').press('End')
    await page.getByLabel('입금 내역').pressSequentially('x')
    await expect(insert).toBeDisabled()
  })

  test('머리글 없는 글 → 서버 문장 그대로 (AC-N3-13·45)', async ({ page }) => {
    await login(page)
    await openPaste(page)
    await page.getByLabel('입금 내역').fill('2026-10-18 21:03\t김영희\t14000\n')
    await page.getByRole('button', { name: '읽어 보기' }).click()
    await expect(page.getByText('표의 첫 줄(거래일시·입금액 같은 칸 이름)을 함께 붙여 넣어 주세요.')).toBeVisible()
    await expect(page.getByRole('button', { name: '입금 내역 넣기' })).toBeDisabled()
  })

  test('EUC-KR로 저장한 CSV 파일을 고르면 글 칸이 채워지고 읽어 본다 → 넣기 → 자동 확인 (AC-N3-45)', async ({ page }) => {
    await login(page)
    const suffix = String(Math.floor(Math.random() * 1e6))
    const name = `홍길동${suffix}`
    const sale = await smsSale(page, { memo: name })
    const t = kstMinute(2)
    // "거래일시,적요,입금액,출금액,잔액\r\n" + 시각 + "," + "홍길동" + 숫자 … (EUC-KR 바이트)
    const header = Buffer.from('b0c5b7a1c0cfbdc32cc0fbbfe42cc0d4b1ddbed72cc3e2b1ddbed72cc0dcbed70d0a', 'hex')
    const hong = Buffer.from('c8abb1e6b5bf', 'hex')
    const body = Buffer.concat([header, Buffer.from(`${t},`), hong, Buffer.from(`${suffix},${String(sale.remaining)},0,50000\r\n`)])
    expect(body.toString('utf8')).not.toContain('홍길동') // 정말 UTF-8이 아니다
    await openPaste(page)
    await page.getByLabel('은행 파일 고르기(.csv)').setInputFiles({ name: '거래내역.csv', mimeType: 'text/csv', buffer: body }) // QL3R1 D-QL3R1-06
    await expect(page.getByLabel('입금 내역')).toHaveValue(new RegExp(`거래일시,적요,입금액,출금액,잔액[\\s\\S]*${name}`))
    const preview = page.getByRole('region', { name: '읽어 본 결과' })
    await expect(preview).toContainText(name)
    await expect(preview).toContainText('새 입금 1건')
    await page.getByRole('button', { name: '입금 내역 넣기' }).click()
    await expect(page.getByRole('status').filter({ hasText: '새 입금 1건 — 자동 확인 1건, 확인 필요 0건' })).toBeVisible()
    expect((await scopeView(page, sale.date, false)).settlements.find((x) => x.buyer === sale.buyer)!.payment).toBe('PAID')
  })
})
