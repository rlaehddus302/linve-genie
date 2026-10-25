// V3 같은 번호 (AC-V3-30~37·39, R-22) — 이미 등록된 번호: 무시·바로 고침과 되돌리기·찜 있으면 묻기·같은 덩어리 취소·거절한 번호.
// 기대 문장은 acceptance 사례 표·D-V3-17 글자 그대로.
import { test, expect, type Page } from '@playwright/test'
import {
  boardItem,
  card,
  cardButton,
  claimOne,
  history,
  notice,
  notices,
  productWrites,
  readout,
  recordWrites,
  registerProduct,
  sayChunk,
  sayWords,
  settle,
  setupV3,
  undoBar,
  voiceCards,
  QUIET_MS,
} from './support.ts'

const FIXED = '108번을 고쳤어요: 가격 100,000원 → 120,000원'
const ASK = '108번을 고칠까요? 가격 100,000원 → 120,000원'
const REASON_CLAIMS = '찜이 있는 상품이라 저절로 고치지 않았어요.'

/** 108번 · name · 100,000원을 API로 등록한 뒤 음성을 켠다 (찜 하나 선택) */
async function with108(page: Page, opts: { name?: string; claim?: boolean } = {}) {
  return await setupV3(page, {
    before: async ({ b }) => {
      await registerProduct(page, b, 108, opts.name ?? 'bts', 100000)
      if (opts.claim === true) await claimOne(page, b, 108)
      await expect(boardItem(page, 108)).toBeVisible()
      if (opts.claim === true) await expect(boardItem(page, 108)).toContainText('찜손님')
    },
  })
}

test('AC-V3-30 R13: 찜 없는 108번에 "108번 12만 원" → 상품 고치기 하나(손 고치기와 같은 product.update), 고쳤어요 알림·[되돌리기]', async ({ page }) => {
  const { date } = await with108(page)
  const writes = recordWrites(page)
  await sayWords(page, '108번 12만 원', {
    afterEach: async (k) => {
      if (k === 3) await expect.poll(() => productWrites(writes)).toEqual([['product.update', 108, 120000]])
    },
  })
  const fixed = notice(page, FIXED)
  await expect(fixed).toBeVisible()
  await expect(fixed.getByRole('button', { name: '되돌리기' })).toBeVisible()
  await expect(boardItem(page, 108)).toContainText('120,000원')
  await page.clock.runFor(QUIET_MS + 100)
  await settle(page)
  expect(productWrites(writes)).toEqual([['product.update', 108, 120000]])
  await expect(voiceCards(page)).toHaveCount(0)
  // 이력: 손 고치기와 같은 상품 고치기
  const updates = (await history(page, date, true)).filter((e) => e.type === 'product.update')
  expect(updates.map((e) => e.fields['price'])).toEqual([120000])
})

test('AC-V3-30: 10초 안 [되돌리기] → 100,000원 고치기 하나 더, 108번은 거절한 번호(다시 "108번 12만 원" → 까닭 줄 없는 묻기 카드)', async ({ page }) => {
  await with108(page)
  const writes = recordWrites(page)
  await sayChunk(page, '108번 12만 원')
  const fixed = notice(page, FIXED)
  await expect(fixed).toBeVisible()
  await fixed.getByRole('button', { name: '되돌리기' }).click()
  await expect(boardItem(page, 108)).toContainText('100,000원')
  expect(productWrites(writes)).toEqual([
    ['product.update', 108, 120000],
    ['product.update', 108, 100000],
  ])
  await page.clock.runFor(1000)
  await sayChunk(page, '108번 12만 원')
  const ask = notice(page, ASK)
  await expect(ask).toBeVisible()
  await expect(ask.getByText(REASON_CLAIMS)).toHaveCount(0)
  await expect(ask.getByText('저절로 고치지 않았어요')).toHaveCount(0)
  await settle(page)
  expect(productWrites(writes)).toHaveLength(2)
  await expect(boardItem(page, 108)).toContainText('100,000원')
})

test('AC-V3-30: 10초가 지나면 [되돌리기]가 사라진다', async ({ page }) => {
  await with108(page)
  // 고친 응답이 온 순간부터 10초 (시계는 멈춰 있다)
  await sayWords(page, '108번 12만 원')
  const fixed = notice(page, FIXED)
  await expect(fixed.getByRole('button', { name: '되돌리기' })).toBeVisible()
  await page.clock.runFor(9800)
  await expect(fixed.getByRole('button', { name: '되돌리기' })).toBeVisible()
  await page.clock.runFor(300)
  await expect(notices(page).getByRole('button', { name: '되돌리기' })).toHaveCount(0)
  await expect(boardItem(page, 108)).toContainText('120,000원')
})

test('AC-V3-31 R14: 1등이 있는 108번에 "108번 12만 원" → 쓰기 0, 묻기 카드 + 까닭 줄. 또 말해도 묻기 카드 하나', async ({ page }) => {
  await with108(page, { claim: true })
  const writes = recordWrites(page)
  await sayChunk(page, '108번 12만 원')
  const ask = notice(page, ASK)
  await expect(ask).toBeVisible()
  await expect(ask.getByText(REASON_CLAIMS)).toBeVisible()
  await expect(ask.getByRole('button', { name: '고치기' })).toBeVisible()
  await expect(ask.getByRole('button', { name: '그대로 두기' })).toBeVisible()
  await settle(page)
  expect(productWrites(writes)).toEqual([])
  await page.clock.runFor(1000)
  await sayChunk(page, '108번 12만 원')
  await expect(notices(page).getByRole('listitem', { name: ASK })).toHaveCount(1)
  expect(productWrites(writes)).toEqual([])
  await expect(boardItem(page, 108)).toContainText('100,000원')
})

test('AC-V3-31: [고치기] → 손 고치기와 같은 창("확정된 찜에도 새 가격을 적용할까요?", 기본 적용 안 함)', async ({ page }) => {
  await with108(page, { claim: true })
  await sayChunk(page, '108번 12만 원')
  await notice(page, ASK).getByRole('button', { name: '고치기' }).click()
  // 손 고치기와 같은 고치기 창(들은 값이 채워짐) → 적용 범위 질문, 처음 포커스는 "아니요, 새 찜부터"(기본 적용 안 함)
  const edit = page.getByRole('dialog', { name: '108번 고치기' })
  await expect(edit.getByLabel('가격')).toHaveValue(/120,?000/)
  await edit.getByRole('button', { name: '고치기' }).click()
  const apply = page.getByRole('dialog', { name: '확정된 찜에도 새 가격을 적용할까요?' })
  await expect(apply.getByRole('button', { name: '아니요, 새 찜부터' })).toBeFocused()
})

test('AC-V3-31: [그대로 두기] → 쓰기 0, 108번은 거절한 번호', async ({ page }) => {
  await with108(page, { claim: true })
  const writes = recordWrites(page)
  await sayChunk(page, '108번 12만 원')
  await notice(page, ASK).getByRole('button', { name: '그대로 두기' }).click()
  await expect(notices(page).getByRole('listitem', { name: ASK })).toHaveCount(0)
  await settle(page)
  expect(productWrites(writes)).toEqual([])
  await expect(boardItem(page, 108)).toContainText('100,000원')
})

test('TE-V3-007 AC-V3-32 R15: 품종 미입력·1등 있는 108번에 "108번 핑크프릴 10만 원" → 품종만 고치기, "품종 없음 → 핑크프릴"', async ({ page }) => {
  await with108(page, { name: '', claim: true })
  const writes = recordWrites(page)
  await sayChunk(page, '108번 핑크프릴 10만 원')
  // 찜이 있는 상품의 고치기는 방송자 조치 대기(시험 서버 2초)를 거칠 수 있다
  await page.clock.runFor(2500)
  await expect(notice(page, '108번을 고쳤어요: 품종 없음 → 핑크프릴')).toBeVisible()
  await expect.poll(() => productWrites(writes)).toEqual([['product.update', 108, '핑크프릴']])
})

test('AC-V3-32 R16: 품종 미입력·1등 있는 108번에 "108번 bts 10만 원" → 쓰기 0, 묻기 "품종 없음 → bts" + 찜 까닭 줄', async ({ page }) => {
  await with108(page, { name: '', claim: true })
  const writes = recordWrites(page)
  await sayChunk(page, '108번 bts 10만 원')
  const ask = notice(page, '108번을 고칠까요? 품종 없음 → bts')
  await expect(ask).toBeVisible()
  await expect(ask.getByText(REASON_CLAIMS)).toBeVisible()
  await settle(page)
  expect(productWrites(writes)).toEqual([])
})

test('AC-V3-32 R17: 핑크프릴 108번에 "108번 bts 10만 원" → 쓰기 0, 카드 0, 기록 "이미 등록됨"', async ({ page }) => {
  await with108(page, { name: '핑크프릴' })
  const writes = recordWrites(page)
  await sayWords(page, '108번 bts 10만 원')
  await expect(readout(page)).toHaveText('108번은 이미 등록됐어요')
  await page.clock.runFor(QUIET_MS + 100)
  await settle(page)
  expect(productWrites(writes)).toEqual([])
  await expect(voiceCards(page)).toHaveCount(0)
  await expect(notices(page)).toHaveCount(0)
  await expect(boardItem(page, 108)).toContainText('핑크프릴')
})

test('AC-V3-35 R18: "108번 10만원 아니 12만원" 한 덩어리 → 등록(100,000) 뒤 고치기(120,000), 고쳤어요 알림', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await sayWords(page, '108번 10만원 아니 12만원', {
    afterEach: async (k) => {
      if (k === 2) await expect.poll(() => productWrites(writes)).toEqual([['product.register', 108, '', 100000]])
    },
  })
  await expect(boardItem(page, 108)).toBeVisible()
  await page.clock.runFor(QUIET_MS + 100)
  await expect(notice(page, FIXED)).toBeVisible()
  await expect(boardItem(page, 108)).toContainText('120,000원')
  expect(productWrites(writes)).toEqual([
    ['product.register', 108, '', 100000],
    ['product.update', 108, 120000],
  ])
})

test('TE-V3-004 AC-V3-35 R19: R1 등록 뒤 다음 덩어리 "아니 12만원" → V2 묻기 카드만, 누르기 전 쓰기 0', async ({ page }) => {
  await setupV3(page)
  await sayChunk(page, '네 108번 bts 어 요한이 10만 원까지 안토 일단 색감 안쪽 봐주세요')
  await expect(boardItem(page, 108)).toBeVisible()
  const writes = recordWrites(page)
  await page.clock.runFor(1000)
  await sayChunk(page, '아니 12만원')
  await expect(notice(page, '방금 등록한 108번 bts를 120,000원으로 고칠까요?')).toBeVisible()
  await settle(page)
  expect(productWrites(writes)).toEqual([])
  await expect(boardItem(page, 108)).toContainText('100,000원')
})

test('AC-V3-36 R20: "21번 핑크문 만원 취소" → 등록 뒤 되돌림(21번 판매 종료), "21번 등록을 되돌렸어요". 다시 말하면 카드만, 음성을 껐다 켜면 다시 바로 등록', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await sayWords(page, '21번 핑크문 만원 취소', {
    afterEach: async (k) => {
      if (k === 3) await expect.poll(() => productWrites(writes)).toEqual([['product.register', 21, '핑크문', 10000]])
    },
  })
  await page.clock.runFor(QUIET_MS + 100)
  await expect(readout(page)).toHaveText('21번 등록을 되돌렸어요')
  await expect(boardItem(page, 21)).toContainText('판매 종료')
  expect(productWrites(writes)).toEqual([
    ['product.register', 21, '핑크문', 10000],
    ['product.close', 21],
  ])
  // 거절한 번호 — 같은 말은 카드만 (D-V3-10)
  await page.clock.runFor(5000)
  await sayChunk(page, '21번 핑크문 만원')
  await settle(page)
  expect(productWrites(writes)).toHaveLength(2)
  await expect(voiceCards(page)).toHaveCount(1)
})

test('AC-V3-37: 5초 띠에서 되돌린 번호는 같은 말을 해도 카드만', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await sayChunk(page, '15번 핑크문 만원')
  await expect(boardItem(page, 15)).toBeVisible()
  await undoBar(page).getByRole('button', { name: '15번 등록 되돌리기' }).click()
  await expect(boardItem(page, 15)).toContainText('판매 종료')
  const before = productWrites(writes).length
  await page.clock.runFor(1000)
  await sayChunk(page, '15번 핑크문 만원')
  await settle(page)
  expect(productWrites(writes)).toHaveLength(before)
  await expect(voiceCards(page)).toHaveCount(1)
})

test('AC-V3-37: 카드 "닫기"를 누른 번호는 같은 말(원 있음)을 해도 카드만', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await sayChunk(page, '15번 핑크문 만오천')
  await cardButton(page, '15번 핑크문 15,000원', '닫기').click()
  await expect(voiceCards(page)).toHaveCount(0)
  await page.clock.runFor(1000)
  await sayChunk(page, '15번 핑크문 만오천 원')
  await settle(page)
  expect(productWrites(writes)).toEqual([])
  await expect(card(page, '15번 핑크문 15,000원')).toBeVisible()
})

test('AC-V3-39: 등록 응답을 2초 늦춘 채 R1 → 같은 번호 처리는 응답 뒤, 카드 생기지 않음, 쓰기 하나', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/events*', async (route) => {
    const body = route.request().postData() ?? ''
    if (body.includes('"product.register"')) await gate
    await route.continue()
  })
  await sayChunk(page, '네 108번 bts 어 요한이 10만 원까지 안토 일단 색감 안쪽 봐주세요')
  await expect.poll(() => productWrites(writes)).toEqual([['product.register', 108, 'bts', 100000]])
  await expect(voiceCards(page)).toHaveCount(0)
  release()
  await expect(boardItem(page, 108)).toBeVisible()
  await settle(page)
  expect(productWrites(writes)).toEqual([['product.register', 108, 'bts', 100000]])
  await expect(voiceCards(page)).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('TE-V3-008 AC-V3-39: 등록이 서버 500이면 그 덩어리 결과로 카드 하나(바로 등록 없음)와 "다시 보내기"', async ({ page }) => {
  await setupV3(page)
  await page.route('**/api/events*', async (route) => {
    const body = route.request().postData() ?? ''
    if (body.includes('"product.register"')) await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: '잠시 문제가 생겼어요.' } }) })
    else await route.continue()
  })
  await sayChunk(page, '108번 bts 10만 원')
  await expect(page.getByRole('button', { name: /다시 보내기/ }).first()).toBeVisible()
  await expect(voiceCards(page)).toHaveCount(1)
  await expect(boardItem(page, 108)).toHaveCount(0)
})
