// QL3R1 쉬운 낱말 (AC-QL3R1-40·41·46·47·48·50·90, D-QL3R1-06·07·08, U-QL3-06·07, SA-QL3-01) — test-e2e.
// 입금 "받은 곳"·붙여넣기 안내·정산 "손님 n명"·상품 자세히 "상품 바꾸기"·찜 목록 위 설명·/privacy 보관 문장.
// 봉인 문장(AC-QL3R1-45)은 tests/e2e/i3/seal.spec.ts 단언을 새 문장으로 바꿨다.
import { expect, test, type Page } from '@playwright/test'
import { uniqueDate } from '../s05/support.ts'
import { registerApi, smsApi } from '../s06/support.ts'
import { broadcastApi, expectNoOverflow } from '../ql2/support.ts'
import { expectNoDevWords } from '../mob1/support.ts'
import { deposit, depositRow, depositTab, fakeSource, kstIso, smsSale, uniq } from '../n3/support.ts'
import { OLD_30_DAY } from '../lnd1/support.ts'
import { D1440, D375, D393, D412, boardCard, openConsole, productOneWorld, sellerOn, type Device } from './support.ts'

const PASTE_HINT = '은행 거래내역 표를 첫 줄(거래일시·입금액 같은 칸 이름)까지 복사해 붙여 넣거나 은행에서 받은 파일(.csv)을 골라 주세요. 출금 줄은 넣지 않아요.'
const FILE_BUTTON = '은행 파일 고르기(.csv)'
const FILE_ERROR = '파일을 읽지 못했어요. 은행에서 받은 .csv 파일인지 확인해 주세요.'
const CLAIM_HELP = '찜 취소: 손님이 안 사기로 했을 때 · 무효: 장난이나 잘못 들어온 찜 · 확인(잠금): 늦게 온 찜이 이 1등을 저절로 밀어내지 않게'
const PRIVACY_FIRST = '유튜브에서 받은 채팅 글과 채팅만 한 시청자의 이름은 방송 날짜부터 30일 뒤에 지워요. 찜이 정해진 손님의 이름은 판매 장부(확인서·정산·포장)에 남아요.'
const PRIVACY_REST = ['판매 장부(판매·정산 기록)는 판매자가 계정을 해지할 때까지 남아요.', '백업은 30일 동안 보관하고 그 뒤 지워요.']

/** 자동 확인된 입금 하나 (시험용 원천) */
async function autoDeposit(dev: Page): Promise<number> {
  const memo = uniq('받은곳')
  const sale = await smsSale(dev, { memo })
  const src = await fakeSource(dev)
  const [d] = await deposit(dev, src, [{ key: uniq('k'), at: kstIso(15_000), amount: sale.remaining, name: memo }])
  expect(d!.status).toBe('AUTO_APPLIED')
  return d!.no
}

test.describe('AC-QL3R1-40 입금 칸 이름 "받은 곳" (값·"입금 #n"은 그대로)', () => {
  test('1440×900 PC 표의 열 이름 "받은 곳"·값 "시험용 입금"·줄 이름 "입금 #n", 입금 자세히의 칸 "받은 곳" — "원천" 낱말 없음', async ({ page, browser }) => {
    const s = await sellerOn(browser, page, D1440, false)
    try {
      const no = await autoDeposit(s.dev)
      await s.dev.goto('/deposits?tab=done')
      await expect(depositTab(s.dev, /^자동 확인됨·확인함$/)).toHaveAttribute('aria-selected', 'true')
      const table = s.dev.getByRole('table', { name: '자동 확인됨·확인함 입금' })
      await expect(table.getByRole('columnheader', { name: '받은 곳', exact: true })).toBeVisible()
      await expect(table.getByRole('columnheader', { name: '원천' })).toHaveCount(0)
      const row = depositRow(s.dev, no, '자동 확인됨·확인함 입금')
      await expect(row).toHaveCount(1)
      await expect(row).toContainText('시험용 입금')
      await expect(row).toContainText(`#${String(no)}`)
      await expect(s.dev.getByRole('tabpanel')).not.toContainText('원천')
      await row.getByRole('group', { name: `입금 #${String(no)} 처리` }).getByRole('button', { name: '자세히' }).click()
      const dlg = s.dev.getByRole('dialog', { name: `입금 #${String(no)}`, exact: true })
      await expect(dlg).toBeVisible()
      const term = dlg.locator('dt', { hasText: /^받은 곳$/ })
      await expect(term).toHaveCount(1)
      await expect(term.locator('xpath=following-sibling::dd[1]')).toHaveText('시험용 입금')
      await expect(dlg).not.toContainText('원천')
    } finally {
      await s.close()
    }
  })

  test('375×812 글자 150% 휴대폰 카드: 칸 이름 "받은 곳"·값 "시험용 입금"·카드 이름 "입금 #n", 가로 넘침 0', async ({ page, browser }) => {
    const s = await sellerOn(browser, page, D375, true)
    try {
      const no = await autoDeposit(s.dev)
      await s.dev.goto('/deposits?tab=done')
      const card = depositRow(s.dev, no, '자동 확인됨·확인함 입금')
      await expect(card).toBeVisible()
      await expect(card.getByText(`입금 #${String(no)}`, { exact: true })).toBeVisible()
      const term = card.locator('dt', { hasText: /^받은 곳$/ })
      await expect(term).toBeVisible()
      await expect(term.locator('xpath=following-sibling::dd[1]')).toHaveText('시험용 입금')
      await expect(s.dev.getByRole('tabpanel')).not.toContainText('원천')
      await expectNoOverflow(s.dev, '375 150% 입금 확인')
      await expectNoDevWords(s.dev, '375 150% 입금 확인')
    } finally {
      await s.close()
    }
  })
})

test.describe('AC-QL3R1-41 붙여넣기 안내·단추·읽기 실패 문장', () => {
  test('375×812 글자 150%: 안내 문장·파일 칸 "은행 파일 고르기(.csv)", "CSV 파일" 낱말 없음, 가로 넘침 0', async ({ page, browser }) => {
    const s = await sellerOn(browser, page, D375, true)
    try {
      await s.dev.goto('/deposits?tab=paste')
      await expect(depositTab(s.dev, /^붙여넣기$/)).toHaveAttribute('aria-selected', 'true')
      await expect(s.dev.getByText(PASTE_HINT, { exact: true })).toBeVisible()
      await expect(s.dev.getByLabel(FILE_BUTTON, { exact: true })).toHaveCount(1)
      expect(await s.dev.evaluate(() => document.body.innerText), '화면에 "CSV 파일"').not.toContain('CSV 파일')
      await expectNoOverflow(s.dev, '375 150% 붙여넣기')
    } finally {
      await s.close()
    }
  })

  // TE-QL3R1-001: 지금은 사진 바이트를 EUC-KR 글로 풀어 글 칸에 깨진 글을 넣고 서버 문장 "표의 첫 줄…"만 보인다(readCsvFile가 실패하지 않음)
  test('TE-QL3R1-001 1440×900: .csv가 아닌 파일(사진)을 고르면 "파일을 읽지 못했어요. 은행에서 받은 .csv 파일인지 확인해 주세요." — 글 칸에 깨진 글이 들어가지 않는다', async ({ page, browser }) => {
    const s = await sellerOn(browser, page, D1440, false)
    try {
      await s.dev.goto('/deposits?tab=paste')
      // PNG 머리 바이트 + 그림 자료 (은행 파일이 아님)
      const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4f00000000049454e44ae426082', 'hex')
      await s.dev.getByLabel(FILE_BUTTON, { exact: true }).setInputFiles({ name: '사진.png', mimeType: 'image/png', buffer: png })
      await expect(s.dev.getByRole('alert').filter({ hasText: FILE_ERROR })).toBeVisible()
      await expect(s.dev.getByLabel('입금 내역')).toHaveValue('')
      await expect(s.dev.getByRole('button', { name: '입금 내역 넣기' })).toBeDisabled()
    } finally {
      await s.close()
    }
  })
})

/** 실제 방송 하루에 문자찜 손님 둘 (미입금 둘) */
async function twoBuyers(dev: Page): Promise<string> {
  const date = uniqueDate()
  const b = await broadcastApi(dev, date)
  await registerApi(dev, b, 15, '핑크프릴', 10000)
  await registerApi(dev, b, 16, '청보석', 20000)
  await smsApi(dev, { b, no: 15, memo: '가나다', phone: '010-4100-0015' })
  await smsApi(dev, { b, no: 16, memo: '라마바', phone: '010-4100-0016' })
  return date
}

test.describe('AC-QL3R1-46 정산 요약 "손님 n명", 빈 목록·거르기 결과 없음 문장', () => {
  for (const [device, big] of [[D1440, false], [D375, true]] as const) {
    test(`${device.label} 글자 ${big ? '150%' : '100%'}: "손님 2명 · 미입금 2 · 부분 입금 0 · 입금 완료 0 · 과입금 0", 찾는 이름이 없으면 "맞는 손님이 없어요.", 판매 없는 날짜는 "그날 정산할 손님이 없어요."`, async ({ page, browser }) => {
      const s = await sellerOn(browser, page, device, big)
      try {
        const date = await twoBuyers(s.dev)
        await s.dev.goto(`/settlements?date=${date}`)
        const summary = s.dev.getByRole('region', { name: '정산 요약' })
        await expect(summary).toContainText('손님 2명 · 미입금 2 · 부분 입금 0 · 입금 완료 0 · 과입금 0')
        await expect(summary).not.toContainText('묶음 2개')
        if (big) {
          await expectNoOverflow(s.dev, `${device.label} 150% 정산`)
          await expectNoDevWords(s.dev, `${device.label} 150% 정산`)
        }
        await s.dev.getByLabel('이름 찾기').fill('없는손님이름')
        await expect(s.dev.getByText('맞는 손님이 없어요.', { exact: true })).toBeVisible()
        await expect(s.dev.getByText('맞는 묶음이 없어요.', { exact: true })).toHaveCount(0)
        // 판매 없는 날짜 (방송만 있음)
        const empty = uniqueDate()
        await broadcastApi(s.dev, empty)
        await s.dev.goto(`/settlements?date=${empty}`)
        await expect(s.dev.getByText('그날 정산할 손님이 없어요.', { exact: true })).toBeVisible()
        await expect(s.dev.getByText('그날 정산할 묶음이 없어요.', { exact: true })).toHaveCount(0)
      } finally {
        await s.close()
      }
    })
  }
})

test.describe('AC-QL3R1-47·48 상품 자세히 "상품 바꾸기"·찜 목록 위 한 줄 설명', () => {
  const cases: readonly (readonly [Device, boolean])[] = [
    [D375, true],
    [D412, true],
    [D1440, false],
  ]
  for (const [device, big] of cases) {
    test(`${device.label} 글자 ${big ? '150%' : '100%'}: 칸 제목·이름 "상품 바꾸기"(안 단추 그대로), 찜 목록 바로 위 설명 한 줄(16px 이상·가로 넘침 0), 찜 줄 단추 이름 그대로`, async ({ page, browser }) => {
      const s = await sellerOn(browser, page, device, big)
      try {
        const { b } = await productOneWorld(s.dev, { extra: 1 })
        await openConsole(s.dev, b, big)
        await boardCard(s.dev, 1).click()
        const dlg = s.dev.getByRole('dialog', { name: '1번 자세히' })
        await expect(dlg).toBeVisible()
        // AC-47
        const change = dlg.getByRole('region', { name: '상품 바꾸기', exact: true })
        await expect(change).toHaveCount(1)
        await expect(change.getByRole('heading', { name: '상품 바꾸기', exact: true })).toBeVisible()
        await expect(dlg).not.toContainText('상품 명령')
        await expect(change.getByRole('button', { name: '일시 중지', exact: true })).toBeVisible()
        await expect(change.getByRole('button', { name: /고치기/ }).first()).toBeVisible()
        // AC-48
        const help = dlg.getByText(CLAIM_HELP, { exact: true })
        await expect(help).toBeVisible()
        const m = await help.evaluate((el) => ({ size: parseFloat(getComputedStyle(el).fontSize), sw: el.scrollWidth, cw: el.clientWidth }))
        expect(m.size, `${device.label} 설명 글자 크기`).toBeGreaterThanOrEqual(16)
        expect(m.sw, `${device.label} 설명 가로 넘침`).toBeLessThanOrEqual(m.cw + 1)
        // 찜 목록 바로 위: 설명 다음 형제가 "1등" 칸
        const next = await help.evaluate((el) => el.nextElementSibling?.getAttribute('aria-label') ?? null)
        expect(next, '설명 바로 다음 칸').toBe('1등')
        const row = dlg.getByRole('region', { name: '1등' }).getByRole('listitem').first()
        for (const name of ['찜 취소하기', '무효로 하기', '확인(잠금)']) await expect(row.getByRole('button', { name, exact: true })).toBeVisible()
        if (big) {
          const wide = await dlg.evaluate((el) => el.scrollWidth - el.clientWidth)
          expect(wide, `${device.label} 150% 창 가로 넘침`).toBeLessThanOrEqual(1)
          await expectNoOverflow(s.dev, `${device.label} 150% 상품 자세히`)
        }
      } finally {
        await s.close()
      }
    })
  }

  test('393×852 WebKit 글자 150%: 찜 목록 위 설명 한 줄이 16px 이상·가로 넘침 0, "상품 바꾸기" @webkit', async ({ page, browser }) => {
    const s = await sellerOn(browser, page, D393, true)
    try {
      const { b } = await productOneWorld(s.dev, { extra: 1 })
      await openConsole(s.dev, b, true)
      await boardCard(s.dev, 1).click()
      const dlg = s.dev.getByRole('dialog', { name: '1번 자세히' })
      const help = dlg.getByText(CLAIM_HELP, { exact: true })
      await expect(help).toBeVisible()
      const m = await help.evaluate((el) => ({ size: parseFloat(getComputedStyle(el).fontSize), sw: el.scrollWidth, cw: el.clientWidth }))
      expect(m.size).toBeGreaterThanOrEqual(16)
      expect(m.sw).toBeLessThanOrEqual(m.cw + 1)
      await expect(dlg.getByRole('region', { name: '상품 바꾸기', exact: true })).toHaveCount(1)
      await expectNoOverflow(s.dev, '393 WebKit 150% 상품 자세히')
    } finally {
      await s.close()
    }
  })
})

test.describe('AC-QL3R1-50 /privacy 보관 기간', () => {
  for (const [device, big] of [[D1440, false], [D375, true]] as const) {
    test(`${device.label} 글자 ${big ? '150%' : '100%'} 로그인 없이: "3. 보관 기간" 첫 줄이 소개 화면과 같은 문장, 나머지 두 줄 그대로, 옛 30일 문장 없음`, async ({ browser, page }) => {
      await page.goto('/')
      const ctx = await browser.newContext({ baseURL: new URL(page.url()).origin, viewport: device.viewport, locale: 'ko-KR', timezoneId: 'Asia/Seoul', ...(device.viewport.width < 768 ? { isMobile: true, hasTouch: true } : {}) })
      try {
        if (big) {
          await ctx.addInitScript(() => {
            const put = () => {
              if (document.getElementById('ql3r1-big') !== null) return
              const style = document.createElement('style')
              style.id = 'ql3r1-big'
              style.textContent = 'html { font-size: 150% !important }'
              document.documentElement.appendChild(style)
            }
            if (document.documentElement !== null) put()
            else document.addEventListener('DOMContentLoaded', put)
          })
        }
        const p = await ctx.newPage()
        await p.goto('/privacy')
        const section = p.getByRole('region', { name: '3. 보관 기간', exact: true })
        await expect(section).toBeVisible()
        const items = section.getByRole('listitem')
        await expect(items).toHaveCount(3)
        await expect(items.nth(0)).toHaveText(PRIVACY_FIRST)
        await expect(items.nth(1)).toHaveText(PRIVACY_REST[0]!)
        await expect(items.nth(2)).toHaveText(PRIVACY_REST[1]!)
        const body = await p.evaluate(() => document.body.innerText)
        for (const old of OLD_30_DAY) expect(body, old).not.toContain(old)
        if (big) await expectNoOverflow(p, `${device.label} 150% /privacy`)
      } finally {
        await ctx.close()
      }
    })
  }
})
