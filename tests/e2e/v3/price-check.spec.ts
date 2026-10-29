// V3 확정 아닌 음성 가격 조각 E2E (R-17 8): D-V3-112 천원 단위 빠른 꼴 1~2자리 수(AC-V3-98), D-V3-113 번호가 붙은 가격(AC-V3-99).
// 기대는 harness/sprints/V3/acceptance.md AC-V3-98·99 문장과 D-V3-112·113 안내 글자 그대로. 시계는 page.clock(멈춤).
import { test, expect } from '@playwright/test'
import {
  boardItem,
  card,
  cardButton,
  notice,
  productWrites,
  recordWrites,
  registerProduct,
  sayChunk,
  settle,
  setupV3,
  voiceCards,
} from './support.ts'

const NOTE_17 = '17,000원으로 들렸어요. 가격을 확인해 주세요'
const NOTE_227 = '2275만 원으로 들렸어요. 227번 5만 원인지 확인해 주세요'

// ── AC-V3-99 번호가 붙은 가격 (D-V3-113) ────────────────────────────────────

test.describe('AC-V3-99 번호가 붙은 가격 (D-V3-113)', () => {
  // (1) 실방송 받아쓰기 그대로, (2) 차례를 바꾼 꼴 — "번호와 가격의 차례는 보지 않는다"
  for (const [id, sentence] of [
    ['(1)', '자 2275만 원 자 227번이고요'],
    ['(2)', '227번 2275만 원'],
  ] as const) {
    test(`AC-V3-99 ${id}: "${sentence}" → 쓰기 0, 227번 카드 가격 칸 비움 + "${NOTE_227}"`, async ({ page }) => {
      await setupV3(page)
      const writes = recordWrites(page)
      await sayChunk(page, sentence)
      const offer = card(page, '227번 품종 미입력 가격 없음')
      await expect(offer).toBeVisible()
      await expect(offer.getByText(NOTE_227)).toBeVisible()
      // 안내 글의 "5만 원"은 칸을 채우지 않는다 — 고치기 칸의 가격도 비어 있다
      await cardButton(page, '227번 품종 미입력 가격 없음', '고치기').click()
      const form = page.getByRole('group', { name: '227번 품종 미입력 가격 없음 고치기 칸' })
      await expect(form.getByLabel('가격')).toHaveValue('')
      await settle(page)
      expect(productWrites(writes)).toEqual([])
      await expect(boardItem(page, 227)).toHaveCount(0)
      await expect(voiceCards(page)).toHaveCount(1)
    })
  }

  test('AC-V3-99 (3): "15번 150만 원" → 300만 원을 넘지 않아 바로 15번 1,500,000원, 카드 0', async ({ page }) => {
    await setupV3(page)
    const writes = recordWrites(page)
    await sayChunk(page, '15번 150만 원')
    await expect.poll(() => productWrites(writes)).toEqual([['product.register', 15, '', 1500000]])
    await expect(voiceCards(page)).toHaveCount(0)
  })
})

// ── AC-V3-98 천원 단위 작은 빠른 꼴 (D-V3-112) ──────────────────────────────

test.describe('AC-V3-98 천원 단위 작은 빠른 꼴 (D-V3-112)', () => {
  test('AC-V3-98 (1)·(9): 천원 단위 "9번입니다 17까지" → 쓰기 0, 카드 9번 17,000원 + 안내, 가격 칸을 170,000으로 고쳐 등록하면 170,000원', async ({ page }) => {
    await setupV3(page)
    const writes = recordWrites(page)
    await sayChunk(page, '9번입니다 17까지')
    const offer = card(page, '9번 품종 미입력 17,000원')
    await expect(offer).toBeVisible()
    await expect(offer.getByText(NOTE_17)).toBeVisible()
    await settle(page)
    expect(productWrites(writes)).toEqual([])
    await cardButton(page, '9번 품종 미입력 17,000원', '고치기').click()
    const form = page.getByRole('group', { name: '9번 품종 미입력 17,000원 고치기 칸' })
    const price = form.getByLabel('가격')
    await expect(price).toHaveValue('17,000원')
    await price.fill('170,000')
    await price.press('Enter')
    await expect.poll(() => productWrites(writes)).toEqual([['product.register', 9, '', 170000]])
  })

  test('AC-V3-98 (8): 천원 단위, 92번(빅뱅 50,000원, 찜 0)이 있고 "92번 60" → 고침 0, 고칠까요 카드 + "60,000원으로 들렸어요. 가격을 확인해 주세요"', async ({ page }) => {
    await setupV3(page, {
      before: async ({ b }) => {
        await registerProduct(page, b, 92, '빅뱅', 50000)
        await expect(boardItem(page, 92)).toContainText('50,000원')
      },
    })
    const writes = recordWrites(page)
    await sayChunk(page, '92번 60')
    const ask = notice(page, '92번을 고칠까요? 가격 50,000원 → 60,000원')
    await expect(ask).toBeVisible()
    await expect(ask.getByText('60,000원으로 들렸어요. 가격을 확인해 주세요')).toBeVisible()
    await settle(page)
    expect(productWrites(writes)).toEqual([])
    await expect(boardItem(page, 92)).toContainText('50,000원')
  })

  test('AC-V3-98 (4): 천원 단위 "68번 이십오" → 쓰기 0, 카드 68번 25,000원 + "25,000원으로 들렸어요. 가격을 확인해 주세요"', async ({ page }) => {
    await setupV3(page)
    const writes = recordWrites(page)
    await sayChunk(page, '68번 이십오')
    const offer = card(page, '68번 품종 미입력 25,000원')
    await expect(offer).toBeVisible()
    await expect(offer.getByText('25,000원으로 들렸어요. 가격을 확인해 주세요')).toBeVisible()
    await settle(page)
    expect(productWrites(writes)).toEqual([])
  })

  // 막지 않아야 할 꼴: 3자리 이상(3)·단위를 따로 정한 방송(5)은 지금처럼 바로 등록
  test('AC-V3-98 (3): 천원 단위 "92번 빅뱅 180" → 바로 92번 빅뱅 180,000원, 카드 0', async ({ page }) => {
    await setupV3(page)
    const writes = recordWrites(page)
    await sayChunk(page, '92번 빅뱅 180')
    await expect.poll(() => productWrites(writes)).toEqual([['product.register', 92, '빅뱅', 180000]])
    await expect(voiceCards(page)).toHaveCount(0)
  })

  for (const unit of ['AUTO', 'TEN_THOUSAND'] as const) {
    test(`AC-V3-98 (5): ${unit === 'AUTO' ? '자동' : '만원'} 단위 "92번 빅뱅 60" → 바로 600,000원, 카드 0`, async ({ page }) => {
      await setupV3(page, { sellerSettings: { 'price.unit': unit } })
      const writes = recordWrites(page)
      await sayChunk(page, '92번 빅뱅 60')
      await expect.poll(() => productWrites(writes)).toEqual([['product.register', 92, '빅뱅', 600000]])
      await expect(voiceCards(page)).toHaveCount(0)
    })
  }
})

// ── 휴대폰 폭 375 (AC-V3-98·99 카드 안내가 넘치지 않음) ──────────────────────

test('AC-V3-98 (1)·AC-V3-99 (1) 휴대폰 폭 375: 두 확정 아닌 카드의 안내 글이 가로로 넘치지 않고, 카드 단추 44px 이상·화면 안', async ({ page }) => {
  await setupV3(page, { width: 375 })
  const writes = recordWrites(page)
  await sayChunk(page, '9번입니다 17까지')
  await expect(card(page, '9번 품종 미입력 17,000원').getByText(NOTE_17)).toBeVisible()
  await page.clock.runFor(1000)
  await sayChunk(page, '자 2275만 원 자 227번이고요')
  await expect(card(page, '227번 품종 미입력 가격 없음').getByText(NOTE_227)).toBeVisible()
  await settle(page)
  expect(productWrites(writes)).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  for (const short of ['9번 품종 미입력 17,000원', '227번 품종 미입력 가격 없음']) {
    const item = card(page, short)
    const box = await item.boundingBox()
    expect((box?.x ?? 0) + (box?.width ?? 0), short).toBeLessThanOrEqual(375)
    for (const button of await item.getByRole('button').all()) {
      if (!(await button.isVisible())) continue
      const b = await button.boundingBox()
      expect(b?.height ?? 0, await button.innerText()).toBeGreaterThanOrEqual(44)
      expect((b?.x ?? 0) + (b?.width ?? 0), await button.innerText()).toBeLessThanOrEqual(375)
    }
  }
})
