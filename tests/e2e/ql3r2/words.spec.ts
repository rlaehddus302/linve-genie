// QL3R2 쉬운 낱말 (AC-QL3R2-20~24, D-QL3R2-04·05, U-QL3R2-03~06) — test-e2e.
// "콘솔"→"방송 화면", "원천"→"입금 받는 곳", "시각이 앞으로인"→"시각이 지금보다 늦은", "#2과 같아요"→"#2도 같은 입금이에요",
// 머리 줄 없는 입금 문자 붙여넣기의 휴대폰 안내, 배송지 칸의 "영수증 보내기" 가는 길.
import { expect, test, type Page } from '@playwright/test'
import { uniqueDate } from '../s05/support.ts'
import { broadcastApi, expectNoOverflow } from '../ql2/support.ts'
import { deposit, depositRow, depositTab, deposits, fakeSource, kstIso, smsSale, uniq } from '../n3/support.ts'
import { D1440, D375, openConsole, sellerOn, type Device } from './support.ts'

const both: readonly (readonly [Device, boolean])[] = [
  [D1440, false],
  [D375, true],
]
const bodyText = async (page: Page): Promise<string> => await page.evaluate(() => document.body.innerText)

test.describe('AC-QL3R2-20 "콘솔" 대신 "방송 화면"', () => {
  test('1440×900: 방송 중 영수증 보내기 화면 "방송 화면으로 돌아가기" → 그 방송 화면, 확인 필요 화면 "방송 화면으로" → 그 방송 화면, 두 화면에 "콘솔" 없음', async ({ page, browser }) => {
    const s = await sellerOn(browser, page, D1440, false)
    try {
      const b = await broadcastApi(s.dev, uniqueDate())
      await s.dev.goto(`/broadcasts/${encodeURIComponent(b)}/receipts`)
      const back = s.dev.getByRole('link', { name: '방송 화면으로 돌아가기', exact: true })
      await expect(back).toBeVisible()
      expect(await bodyText(s.dev), '영수증 보내기 화면 글').not.toContain('콘솔')
      await back.click()
      await expect(s.dev).toHaveURL(new RegExp(`/broadcasts/${encodeURIComponent(b)}$`))
      await expect(s.dev.getByLabel('빠른 입력')).toBeVisible()
      // 확인 필요 (그 방송만)
      await s.dev.goto(`/reviews?broadcast=${encodeURIComponent(b)}`)
      const go = s.dev.getByRole('button', { name: '방송 화면으로', exact: true })
      await expect(go).toBeVisible()
      await expect(s.dev.getByRole('status').filter({ hasText: '불러오는 중…' })).toHaveCount(0)
      expect(await bodyText(s.dev), '확인 필요 화면 글').not.toContain('콘솔')
      await go.click()
      await expect(s.dev).toHaveURL(new RegExp(`/broadcasts/${encodeURIComponent(b)}$`))
    } finally {
      await s.close()
    }
  })

  test('375×812 150%: 방송 화면을 열 때 다시 시도할 수 없는 서버 오류(403 흉내)면 제목 "방송 화면을 열지 못했어요"·"다시 열기", 화면에 "콘솔" 없음', async ({ page, browser }) => {
    const s = await sellerOn(browser, page, D375, true)
    try {
      const date = uniqueDate()
      const b = await broadcastApi(s.dev, date)
      await s.dev.route(`**/api/days/${date}**`, (route) => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: 'FORBIDDEN', message: '이 방송을 볼 수 없어요.' }) }))
      await s.dev.goto(`/broadcasts/${encodeURIComponent(b)}`)
      await expect(s.dev.getByRole('heading', { level: 1, name: '방송 화면을 열지 못했어요' })).toBeVisible({ timeout: 30_000 })
      await expect(s.dev.getByRole('button', { name: '다시 열기', exact: true })).toBeVisible()
      expect(await bodyText(s.dev)).not.toContain('콘솔')
      await expectNoOverflow(s.dev, '375 150% 방송 화면 오류')
    } finally {
      await s.close()
    }
  })
})

test.describe('AC-QL3R2-21 "원천" 대신 "입금 받는 곳"', () => {
  for (const [device, big] of both) {
    test(`${device.label} 글자 ${big ? '150%' : '100%'}: 받는 곳 0개 — 제목·빈 안내·시험용 단추·안내 문장, 하나 더하면 목록 "입금 받는 곳"·항목 "입금 받는 곳 {이름}", "원천" 없음`, async ({ page, browser }) => {
      const s = await sellerOn(browser, page, device, big)
      try {
        await s.dev.goto('/deposits?tab=sources')
        await expect(depositTab(s.dev, /^계좌 연동$/)).toHaveAttribute('aria-selected', 'true')
        await expect(s.dev.getByRole('heading', { name: '입금 받는 곳', exact: true })).toBeVisible()
        await expect(s.dev.getByText('아직 입금 받는 곳이 없어요. 붙여넣기로 넣거나 계좌를 연결해 주세요.', { exact: true })).toBeVisible()
        await expect(s.dev.getByText('시험 모드 서버예요. 시험용 입금 받는 곳은 실제 계좌가 아니에요.', { exact: true })).toBeVisible()
        expect(await bodyText(s.dev), '받는 곳 0개 화면 글').not.toContain('원천')
        await s.dev.getByRole('button', { name: '시험용 입금 받는 곳 추가', exact: true }).click()
        const list = s.dev.getByRole('list', { name: '입금 받는 곳', exact: true })
        await expect(list).toBeVisible()
        await expect(list.getByRole('listitem', { name: /^입금 받는 곳 / })).toHaveCount(1)
        await expect(s.dev.getByText('아직 입금 받는 곳이 없어요.', { exact: false })).toHaveCount(0)
        expect(await bodyText(s.dev), '받는 곳 1개 화면 글').not.toContain('원천')
        if (big) await expectNoOverflow(s.dev, `${device.label} 150% 계좌 연동`)
      } finally {
        await s.close()
      }
    })
  }

  test('1440×900: 이름을 정한 받는 곳의 항목 이름은 "입금 받는 곳 {이름}", 입금 목록 칸은 "받은 곳" 그대로', async ({ page, browser }) => {
    const s = await sellerOn(browser, page, D1440, false)
    try {
      const label = uniq('통장').slice(0, 12)
      const memo = uniq('받는곳')
      const sale = await smsSale(s.dev, { memo })
      const src = await fakeSource(s.dev, label)
      const [d] = await deposit(s.dev, src, [{ key: uniq('k'), at: kstIso(15_000), amount: sale.remaining, name: memo }])
      expect(d!.status).toBe('AUTO_APPLIED')
      await s.dev.goto('/deposits?tab=sources')
      await expect(s.dev.getByRole('listitem', { name: `입금 받는 곳 ${label}`, exact: true })).toBeVisible()
      await s.dev.goto('/deposits?tab=done')
      const table = s.dev.getByRole('table', { name: '자동 확인됨·확인함 입금' })
      await expect(table.getByRole('columnheader', { name: '받은 곳', exact: true })).toBeVisible()
      expect(await bodyText(s.dev)).not.toContain('원천')
    } finally {
      await s.close()
    }
  })
})

/** 지금 + minutes분의 KST "YYYY-MM-DD HH:MM" */
function kstMinute(minutes: number): string {
  const k = new Date(Date.now() + minutes * 60_000 + 9 * 3_600_000).toISOString()
  return `${k.slice(0, 10)} ${k.slice(11, 16)}`
}

test.describe('AC-QL3R2-22 "시각이 지금보다 늦은 입금"·"입금 #n도 같은 입금이에요"', () => {
  for (const [device, big] of both) {
    test(`${device.label} 글자 ${big ? '150%' : '100%'}: 늦은 시각 2줄 + 새 입금 1줄 → 미리 보기 "시각이 지금보다 늦은 입금" 2줄, 넣으면 "…, 시각이 지금보다 늦은 입금 2건은 넣지 않았어요. 은행 글의 날짜·시각을 확인해 주세요.", "앞으로인" 없음`, async ({ page, browser }) => {
      const s = await sellerOn(browser, page, device, big)
      try {
        const fresh = uniq('새입금')
        const later = [uniq('늦은하나'), uniq('늦은둘')]
        const text = [
          '거래일시,입금자명,입금액',
          `${kstMinute(-1)},${fresh},3100`,
          `${kstMinute(90)},${later[0]!},3200`,
          `${kstMinute(120)},${later[1]!},3300`,
          '',
        ].join('\n')
        await s.dev.goto('/deposits?tab=paste')
        await s.dev.getByLabel('입금 내역').fill(text)
        await s.dev.getByRole('button', { name: '읽어 보기' }).click()
        const preview = s.dev.getByRole('region', { name: '읽어 본 결과' })
        await expect(preview).toContainText('새 입금 1건')
        await expect(preview).toContainText('시각이 지금보다 늦은 입금 2건')
        const rows = preview.getByText('시각이 지금보다 늦은 입금', { exact: true })
        await expect(rows).toHaveCount(2)
        expect(await bodyText(s.dev)).not.toContain('앞으로인')
        await s.dev.getByRole('button', { name: '입금 내역 넣기' }).click()
        const done = s.dev.getByRole('status').filter({ hasText: /^새 입금 1건/ })
        await expect(done).toContainText(', 시각이 지금보다 늦은 입금 2건은 넣지 않았어요. 은행 글의 날짜·시각을 확인해 주세요.')
        expect(await bodyText(s.dev)).not.toContain('앞으로인')
        const all = await deposits(s.dev, 'REVIEW,AUTO_APPLIED,APPLIED,IGNORED', 200)
        expect(all.filter((x) => x.name === fresh), '새 입금').toHaveLength(1)
        expect(all.filter((x) => later.includes(x.name)), '늦은 입금은 넣지 않음').toHaveLength(0)
        if (big) await expectNoOverflow(s.dev, `${device.label} 150% 붙여넣기 결과`)
      } finally {
        await s.close()
      }
    })
  }

  test('1440×900: 같은 입금이 두 번 → 확인 필요 줄 "같은 입금이 두 번 들어왔을 수 있어요 (입금 #n도 같은 입금이에요)", "#n과" 없음', async ({ page, browser }) => {
    const s = await sellerOn(browser, page, D1440, false)
    try {
      const name = uniq('이중입금')
      const sale = await smsSale(s.dev, { memo: name })
      const src1 = await fakeSource(s.dev, '첫째 통장')
      const src2 = await fakeSource(s.dev, '둘째 통장')
      const at = kstIso(5_000)
      const [first] = await deposit(s.dev, src1, [{ key: uniq('a'), at, amount: sale.remaining, name }])
      expect(first!.status).toBe('AUTO_APPLIED')
      const [second] = await deposit(s.dev, src2, [{ key: uniq('a'), at, amount: sale.remaining, name }])
      expect(second!.status).toBe('REVIEW')
      await s.dev.goto('/deposits')
      const row = depositRow(s.dev, second!.no)
      await expect(row).toContainText(`같은 입금이 두 번 들어왔을 수 있어요 (입금 #${String(first!.no)}도 같은 입금이에요)`)
      await expect(row).not.toContainText(`#${String(first!.no)}과`)
      expect(await bodyText(s.dev)).not.toMatch(/#\d+과 같아요/)
    } finally {
      await s.close()
    }
  })
})

const NO_HEADER = '표의 첫 줄(거래일시·입금액 같은 칸 이름)을 함께 붙여 넣어 주세요.'
const PHONE_HINT = "휴대폰에서는 PC로 은행 거래내역을 복사해 넣거나, 정산 화면의 '입금 적기'로 직접 적어 주세요."

test.describe('AC-QL3R2-23 입금 문자를 붙여 넣으면 휴대폰 안내', () => {
  for (const [device, big] of both) {
    test(`${device.label} 글자 ${big ? '150%' : '100%'}: "[Web발신] 농협 입금 …" → 서버 문장 바로 아래 휴대폰 안내, 넣기 잠김·입금 0`, async ({ page, browser }) => {
      const s = await sellerOn(browser, page, device, big)
      try {
        await s.dev.goto('/deposits?tab=paste')
        await s.dev.getByLabel('입금 내역').fill('[Web발신] 농협 입금 24,000원 10/26 14:20 물주기담당')
        await s.dev.getByRole('button', { name: '읽어 보기' }).click()
        const alert = s.dev.getByRole('alert').filter({ hasText: NO_HEADER })
        await expect(alert).toBeVisible()
        const server = alert.getByText(NO_HEADER, { exact: true })
        const hint = alert.getByText(PHONE_HINT, { exact: true })
        await expect(hint).toBeVisible()
        // 바로 아래: 안내의 위 끝이 서버 문장 아래 끝 이후, 둘 사이에 다른 글 없음
        const a = (await server.boundingBox())!
        const h = (await hint.boundingBox())!
        expect(h.y, '안내가 서버 문장 아래').toBeGreaterThanOrEqual(a.y + a.height - 0.5)
        expect(h.y - (a.y + a.height), '서버 문장과 안내 사이 간격').toBeLessThanOrEqual(32)
        await expect(s.dev.getByRole('button', { name: '입금 내역 넣기' })).toBeDisabled()
        expect((await deposits(s.dev, 'REVIEW,AUTO_APPLIED,APPLIED,IGNORED', 200)).filter((x) => x.name.includes('물주기담당'))).toHaveLength(0)
        if (big) await expectNoOverflow(s.dev, `${device.label} 150% 붙여넣기 오류`)
      } finally {
        await s.close()
      }
    })
  }

  test('1440×900: 줄이 너무 많은 표(2,001줄)의 오류에는 휴대폰 안내가 없다', async ({ page, browser }) => {
    const s = await sellerOn(browser, page, D1440, false)
    try {
      const t = kstMinute(-1)
      const lines = ['거래일시,입금자명,입금액', ...Array.from({ length: 2001 }, (_, i) => `${t},많은줄${String(i)},${String(1000 + i)}`), '']
      await s.dev.goto('/deposits?tab=paste')
      await s.dev.getByLabel('입금 내역').fill(lines.join('\n'))
      await s.dev.getByRole('button', { name: '읽어 보기' }).click()
      await expect(s.dev.getByRole('alert')).toBeVisible()
      await expect(s.dev.getByRole('alert')).not.toContainText(NO_HEADER)
      await expect(s.dev.getByText(PHONE_HINT)).toHaveCount(0)
    } finally {
      await s.close()
    }
  })
})

const BUYER_CAN_WRITE = "구매자 확인서 링크에서 구매자가 직접 적을 수도 있어요. 링크는 방송을 끝낸 뒤 '영수증 보내기'에서 만들어요."

test.describe('AC-QL3R2-24 배송지 칸 안내에 "영수증 보내기" 가는 길', () => {
  for (const [device, big] of both) {
    test(`${device.label} 글자 ${big ? '150%' : '100%'}: 방송 중 정산 자세히, 배송지 없는 구매자 → "${BUYER_CAN_WRITE}", 칸 안 링크 없음`, async ({ page, browser }) => {
      const s = await sellerOn(browser, page, device, big)
      try {
        // 최근 날짜의 진행 중 방송 (오래된 날짜는 배송지 보관 기간이 지나 칸 문장이 다르다)
        const { date, buyer, b } = await smsSale(s.dev, { memo: uniq('물주기') })
        await s.dev.goto(`/settlements?date=${date}&buyer=${encodeURIComponent(buyer)}`)
        const region = s.dev.getByRole('region', { name: '배송지', exact: true })
        await expect(region).toBeVisible()
        await expect(region.getByText('배송지를 불러오는 중…')).toHaveCount(0)
        await expect(region.getByText(BUYER_CAN_WRITE, { exact: true })).toBeVisible()
        await expect(region.getByRole('link')).toHaveCount(0)
        if (big) await expectNoOverflow(s.dev, `${device.label} 150% 정산 자세히`)
        // 방송 화면은 그대로 열린다 (그 방송이 아직 진행 중)
        await openConsole(s.dev, b, big)
      } finally {
        await s.close()
      }
    })
  }
})
