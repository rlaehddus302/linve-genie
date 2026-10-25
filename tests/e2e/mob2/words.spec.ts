// MOB2 D. 개발 용어 (AC-MOB2-20·22·23·25, D-MOB2-05, UX-01) — test-e2e.
// 화면 훑기(AC-MOB2-25): 유튜브를 잇지 않은 새 판매자, 이름·메모·닉네임에 "#"·"ID"가 없는 시험 데이터. 375×812와 1440×900.
// 콘솔 → 상품 자세히 → 문자찜 입력 → 입금 확인(목록·자세히) → 정산(기록 펼침)을 차례로 열고 document.body.innerText를 본다.
// 기대: "명령"·"입금 #"·"정산 기록 "+숫자+"번"·"요청 번호"·" ID"가 없다. 저장된 메모·사유는 API에서 "입금 #n" 그대로(AC-MOB2-22).
import { expect, test, type Page } from '@playwright/test'
import { deposit, depositRow, fakeSource, history, kstIso, smsSale } from '../n3/support.ts'
import { PC, PHONE, freshSeller } from '../mob1/support.ts'
import { openSmsSole } from './support.ts'

const BANNED: readonly [string, RegExp][] = [
  ['명령', /명령/],
  ['입금 #', /입금 #/],
  ['정산 기록 n번', /정산 기록 \d+번/],
  ['요청 번호', /요청 번호/],
  [' ID', / ID/],
]

async function expectPlainWords(page: Page, where: string): Promise<void> {
  const text = await page.evaluate(() => document.body.innerText)
  for (const [name, re] of BANNED) {
    const hit = re.exec(text)
    expect(hit === null ? null : text.slice(Math.max(0, hit.index - 30), hit.index + 30), `${where}: "${name}"`).toBeNull()
  }
}

for (const [label, viewport] of [['375×812', PHONE], ['1440×900', PC]] as const) {
  test(`AC-MOB2-25·20·22·23 ${label} 화면 훑기: 콘솔·상품 자세히("상품 관리")·문자찜·입금 확인(목록·자세히)·정산(기록 펼침)에 개발 용어 없음, 저장된 메모는 "입금 #n" 그대로`, async ({ browser, baseURL }) => {
    const { page, context } = await freshSeller(browser, baseURL!, { viewport, touch: viewport.width < 768 })
    try {
      const name = `김영희${String(Math.floor(Math.random() * 1e5))}`
      const sale = await smsSale(page, { memo: name })
      const src = await fakeSource(page)
      const [d] = await deposit(page, src, [{ key: `k${String(Math.floor(Math.random() * 1e9))}`, at: kstIso(15_000), amount: sale.remaining, name }])
      expect(d!.status).toBe('AUTO_APPLIED')

      // 콘솔
      await page.goto(`/broadcasts/${encodeURIComponent(sale.b)}`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expectPlainWords(page, `${label} 콘솔`)
      // 상품 자세히 — "상품 관리" (AC-MOB2-20)
      await page.getByRole('region', { name: '상품 보드' }).getByRole('button', { name: /^15번 / }).click()
      const detail = page.getByRole('dialog', { name: '15번 자세히' })
      const manage = detail.getByRole('region', { name: '상품 관리' })
      await expect(manage).toBeVisible()
      await expect(manage.getByRole('heading', { name: '상품 관리' })).toBeVisible()
      await expect(page.getByText('상품 명령')).toHaveCount(0)
      await expectPlainWords(page, `${label} 상품 자세히`)
      await detail.getByRole('button', { name: '닫기' }).first().click()

      // 문자찜 입력
      await openSmsSole(page, '입금 시험')
      await expectPlainWords(page, `${label} 문자찜 입력`)

      // 입금 확인 목록·자세히 — "입금 번호 n" (AC-MOB2-21), 처리 기록에 "정산 기록 n번" 없음 (AC-MOB2-23)
      await page.goto('/deposits?tab=done')
      const row = depositRow(page, d!.no, '자동 확인됨·확인함 입금')
      await expect(row).toBeVisible()
      // 휴대폰 카드 제목은 "입금 번호 n" (PC 표 줄은 이름만 — 번호 칸 글은 지적 TE-MOB2-003)
      if (viewport.width < 768) await expect(row).toContainText(`입금 번호 ${String(d!.no)}`)
      await expectPlainWords(page, `${label} 입금 확인 목록`)
      await row.getByRole('button', { name: '자세히' }).click()
      const dlg = page.getByRole('dialog', { name: `입금 번호 ${String(d!.no)}` })
      const records = dlg.getByRole('region', { name: '처리 기록' })
      await expect(records).toContainText('입금 자동 확인')
      await expect(records).not.toContainText(/정산 기록 \d+번/)
      await expectPlainWords(page, `${label} 입금 자세히`)
      await dlg.getByRole('button', { name: '닫기' }).first().click()

      // 정산 기록 — 저장된 메모 "자동 입금 확인 · 입금 #n"은 보일 때만 "입금 번호 n" (AC-MOB2-22)
      await page.goto(`/settlements?date=${sale.date}&buyer=${encodeURIComponent(sale.buyer)}`)
      const settle = page.getByRole('region', { name: '정산 자세히' })
      await expect(settle).toContainText(`자동 입금 확인 · ${name}`)
      await expect(settle).toContainText(`입금 번호 ${String(d!.no)}`)
      await expectPlainWords(page, `${label} 정산 자세히`)
      const pays = (await history(page, sale.date, false)).filter((e) => e.type === 'settlement.payment')
      expect(pays.map((e) => e.fields['memo']), '이벤트 기록의 메모는 저장된 글 그대로').toEqual([`자동 입금 확인 · 입금 #${String(d!.no)}`])
    } finally {
      await context.close()
    }
  })
}
