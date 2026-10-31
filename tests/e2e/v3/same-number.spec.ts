// V3 같은 번호 (AC-V3-30~37·39, R-22) — 이미 등록된 번호: 무시·바로 고침과 되돌리기·찜 있으면 묻기·같은 덩어리 취소·거절한 번호.
// 기대 문장은 acceptance 사례 표·D-V3-17 글자 그대로.
import { test, expect, type Page } from '@playwright/test'
import {
  boardItem,
  claimOne,
  history,
  notice,
  notices,
  productWrites,
  readout,
  recordWrites,
  registerProduct,
  scopeView,
  sayChunk,
  sayFirstOfTwo,
  sayWords,
  sayFinals,
  settle,
  setupV3,
  undoBar,
  voiceCards,
  QUIET_MS,
} from './support.ts'

// 가격 고침 문턱 (D-V3-83, AC-V3-79, 수용 기준 표 머리 "실방송 보강 뒤 읽는 법" (2)): 이미 있는 상품의 가격을 바로 고치는 사례
// (R13·R14·R45·R47, AC-V3-30·31·67·68 (c))의 기대는 같은 말을 **다른 조각**에서 60초 안에 한 번 더 들었을 때다. 첫 번은 묻기 카드
// "{N}번을 고칠까요? …" + 까닭 줄·쓰기 0(R107), 두 번째에 바로 고치고 그 묻기 카드는 내린다(R108). 아래 시험은 첫 번을 sayFirstOfTwo로 말한다.
// 품종 bts는 사전 이름 BTS가 되었다(D-V3-86) — 사전 밖 낱말 사례(R16·R17)는 ufo로 했다가,
// ufo도 대소문자 무시로 영수증 품종 UFO가 되어(D-V3-120) zeta로 바꿈.

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

test('AC-V3-30 R13 (D-V3-83): 찜 없는 108번에 "108번 12만 원" — 첫 번은 묻기 카드·쓰기 0, 다른 조각에서 한 번 더 → 상품 고치기 하나(손 고치기와 같은 product.update), 고쳤어요 알림·[되돌리기]', async ({ page }) => {
  const { date } = await with108(page)
  const writes = recordWrites(page)
  await sayFirstOfTwo(page, '108번 12만 원', ASK, writes)
  await sayWords(page, '108번 12만 원', {
    afterEach: async (k) => {
      if (k === 3) await expect.poll(() => productWrites(writes)).toEqual([['product.update', 108, 120000]])
    },
  })
  const fixed = notice(page, FIXED)
  await expect(fixed).toBeVisible()
  await expect(fixed.getByRole('button', { name: '되돌리기' })).toBeVisible()
  await expect(boardItem(page, 108)).toContainText('120,000원')
  await expect(notice(page, ASK)).toHaveCount(0)
  await page.clock.runFor(QUIET_MS + 100)
  await settle(page)
  expect(productWrites(writes)).toEqual([['product.update', 108, 120000]])
  await expect(voiceCards(page)).toHaveCount(0)
  // 이력: 손 고치기와 같은 상품 고치기
  const updates = (await history(page, date, true)).filter((e) => e.type === 'product.update')
  expect(updates.map((e) => e.fields['price'])).toEqual([120000])
})

test('AC-V3-30 (D-V3-83 두 번 들음): 10초 안 [되돌리기] → 100,000원 고치기 하나 더, 108번은 거절한 번호(다시 "108번 12만 원" → 까닭 줄 없는 묻기 카드)', async ({ page }) => {
  await with108(page)
  const writes = recordWrites(page)
  await sayFirstOfTwo(page, '108번 12만 원', ASK, writes)
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

test('AC-V3-30 (D-V3-83 두 번 들음): 10초가 지나면 [되돌리기]가 사라진다', async ({ page }) => {
  await with108(page)
  await sayFirstOfTwo(page, '108번 12만 원', ASK)
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

/** 음성으로 108번 10만 원을 등록하고(이 콘솔의 최근 등록 — D-V3-59 고쳐 말함 조건), 1등 찜 하나를 받는다 */
async function voice108WithClaim(page: Page, b: string): Promise<void> {
  await sayChunk(page, '108번 10만 원')
  await expect(boardItem(page, 108)).toBeVisible()
  await claimOne(page, b, 108)
  await expect(boardItem(page, 108)).toContainText('찜손님')
  await page.clock.runFor(1000)
}

test('AC-V3-31 R14 (D-V3-57·59·83 두 번 들음): 이 콘솔이 방금 음성 등록한 108번(1등 하나)에 "108번 12만 원" → 고치기 하나(NEW_ONLY), 알림에 찜 전 가격 문장·[되돌리기], 1등 정산 금액 그대로', async ({ page }) => {
  const { b, date } = await setupV3(page)
  await voice108WithClaim(page, b)
  const writes = recordWrites(page)
  await sayFirstOfTwo(page, '108번 12만 원', ASK, writes)
  await sayChunk(page, '108번 12만 원')
  const fixed = notice(page, '108번을 고쳤어요: 가격 100,000원 → 120,000원')
  await expect(fixed).toBeVisible()
  await expect(fixed).toContainText('찜 1개는 전 가격 그대로예요. 바꾸려면 상품에서 고쳐 주세요.')
  await expect(fixed.getByRole('button', { name: '되돌리기' })).toBeVisible()
  await expect.poll(() => productWrites(writes)).toEqual([['product.update', 108, 120000]])
  const update = writes.find((w) => w.type === 'product.update')!
  expect(update.body['applyTo'] ?? 'NEW_ONLY').toBe('NEW_ONLY')
  await expect(boardItem(page, 108)).toContainText('120,000원')
  const view = await scopeView(page, date, true)
  const winner = view.settlements.find((st) => st.subtotal > 0)
  expect(winner?.subtotal).toBe(100000)
  // [되돌리기] → 100,000원
  await fixed.getByRole('button', { name: '되돌리기' }).click()
  await expect(boardItem(page, 108)).toContainText('100,000원')
  expect(productWrites(writes)).toEqual([
    ['product.update', 108, 120000],
    ['product.update', 108, 100000],
  ])
})

test('AC-V3-68 (c) (D-V3-59·83 두 번 들음): 65번 등록 뒤 66번을 등록하고 "65번 5만 원" — 찜 0이면 바꾸고 4초 안내', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await sayChunk(page, '65번 3만 원')
  await expect(boardItem(page, 65)).toBeVisible()
  await page.clock.runFor(1000)
  await sayChunk(page, '66번 2만 원')
  await expect(boardItem(page, 66)).toBeVisible()
  await page.clock.runFor(5000)
  await sayFirstOfTwo(page, '65번 5만 원', '65번을 고칠까요? 가격 30,000원 → 50,000원', writes)
  await sayWords(page, '65번 5만 원')
  await expect(readout(page)).toHaveText("65번을 바꿨어요: 30,000원 → 50,000원 · 아까 것이 다른 번호였으면 '아까 65번은 61번'이라고 말해 주세요")
  await expect.poll(() => productWrites(writes).filter((w) => w[0] === 'product.update')).toEqual([['product.update', 65, 50000]])
})

test('AC-V3-68 (c) (D-V3-59): 65번 등록 뒤 66번을 등록하고 "65번 5만 원" — 찜 2개면 쓰기 0과 카드 [새 가격으로 바꾸기] [아까 것을 다른 번호로]', async ({ page }) => {
  const { b } = await setupV3(page)
  const writes = recordWrites(page)
  await sayChunk(page, '65번 3만 원')
  await expect(boardItem(page, 65)).toBeVisible()
  await claimOne(page, b, 65, '첫손님')
  await claimOne(page, b, 65, '둘손님')
  await page.clock.runFor(1000)
  await sayChunk(page, '66번 2만 원')
  await expect(boardItem(page, 66)).toBeVisible()
  await page.clock.runFor(5000)
  const before = productWrites(writes).length
  await sayChunk(page, '65번 5만 원')
  const ask = notice(page, '65번이 이미 있어요 (30,000원, 찜 2개)')
  await expect(ask).toBeVisible()
  await expect(ask.getByRole('button', { name: '새 가격으로 바꾸기' })).toBeVisible()
  await settle(page)
  expect(productWrites(writes)).toHaveLength(before)
  await expect(boardItem(page, 65)).toContainText('30,000원')
  // [아까 것을 다른 번호로] → 65번 상품의 번호 고치기 칸(손 고치기)
  await ask.getByRole('button', { name: '아까 것을 다른 번호로' }).click()
  await expect(page.getByRole('dialog').filter({ hasText: '65번' }).first()).toBeVisible()
  expect(productWrites(writes)).toHaveLength(before)
})

test('AC-V3-32 R15 (D-V3-57·59): 방금 음성 등록한 108번(품종 미입력·1등 하나)에 "108번 핑크프릴 10만 원" → 품종만 고치기, "품종 없음 → 핑크프릴"', async ({ page }) => {
  const { b } = await setupV3(page)
  await voice108WithClaim(page, b)
  const writes = recordWrites(page)
  await sayChunk(page, '108번 핑크프릴 10만 원')
  await page.clock.runFor(2500)
  await expect(notices(page).getByRole('listitem', { name: /^108번을 고쳤어요: 품종 없음 → 핑크프릴/ })).toBeVisible()
  await expect.poll(() => productWrites(writes)).toEqual([['product.update', 108, '핑크프릴']])
})

test('AC-V3-32 R16: 품종 미입력·1등 있는 108번에 "108번 zeta zeta 10만 원" → 쓰기 0, 카드 0, 이미 등록됨 (추측은 있는 상품 품종을 채우지 않음, D-V3-31 · 사전 밖 낱말 zeta D-V3-86·120)', async ({ page }) => {
  await with108(page, { name: '', claim: true })
  const writes = recordWrites(page)
  await sayWords(page, '108번 zeta zeta 10만 원')
  await expect(readout(page)).toHaveText('108번은 이미 등록됐어요')
  await page.clock.runFor(QUIET_MS + 100)
  await settle(page)
  expect(productWrites(writes)).toEqual([])
  await expect(voiceCards(page)).toHaveCount(0)
  await expect(notices(page)).toHaveCount(0)
})

test('AC-V3-24 R45 (D-V3-64·83 두 번 들음): 38번 설비 650,000원(찜 없음)에 "ui 자 38번 605만 원까지" → 바로 고침 6,050,000원·[되돌리기], 품종은 그대로', async ({ page }) => {
  await setupV3(page, { before: async ({ b }) => {
    await registerProduct(page, b, 38, '설비', 650000)
    await expect(boardItem(page, 38)).toBeVisible()
  } })
  const writes = recordWrites(page)
  await sayFirstOfTwo(page, 'ui 자 38번 605만 원까지', '38번을 고칠까요? 가격 650,000원 → 6,050,000원', writes)
  await sayChunk(page, 'ui 자 38번 605만 원까지')
  await expect.poll(() => productWrites(writes)).toEqual([['product.update', 38, 6050000]])
  await expect(boardItem(page, 38)).toContainText('6,050,000원')
  await expect(boardItem(page, 38)).toContainText('설비')
  await expect(notices(page).getByRole('button', { name: '되돌리기' })).toBeVisible()
})

test('AC-V3-24 R47 (D-V3-83): 100,000원 108번에 "108번 30만 원"을 다른 조각에서 한 번 더 → 결과 3에서 300,000원으로 바로 고침 (딱 3배는 받음)', async ({ page }) => {
  await with108(page)
  const writes = recordWrites(page)
  await sayFirstOfTwo(page, '108번 30만 원', '108번을 고칠까요? 가격 100,000원 → 300,000원', writes)
  await sayWords(page, '108번 30만 원', {
    afterEach: async (k) => {
      if (k === 3) await expect.poll(() => productWrites(writes)).toEqual([['product.update', 108, 300000]])
    },
  })
  await expect(notice(page, '108번을 고쳤어요: 가격 100,000원 → 300,000원')).toBeVisible()
})

test('TE-V3-010 AC-V3-24 R48: 100,000원 108번에 "108 12만 원 자"(번 없이) → 쓰기 0, "108번을 고칠까요? 가격 100,000원 → 120,000원" (D-V3-32)', async ({ page }) => {
  await with108(page)
  const writes = recordWrites(page)
  await sayChunk(page, '108 12만 원 자')
  await expect(notice(page, ASK)).toBeVisible()
  await settle(page)
  expect(productWrites(writes)).toEqual([])
  await expect(boardItem(page, 108)).toContainText('100,000원')
})

test('AC-V3-32 R17: 핑크프릴 108번에 "108번 zeta 10만 원" → 쓰기 0, 카드 0, 기록 "이미 등록됨" (사전 밖 낱말 zeta, D-V3-86·120)', async ({ page }) => {
  await with108(page, { name: '핑크프릴' })
  const writes = recordWrites(page)
  await sayWords(page, '108번 zeta 10만 원')
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
  // 적용 안 함: D-REL1-02 (중간 결과 2에서 등록). D-REL1-04: 같은 덩어리의 최종 결과 둘 "108번 10만원" → "아니 12만원"
  await sayFinals(page, ['108번 10만원', '아니 12만원'], async (i) => {
    if (i === 1) await expect.poll(() => productWrites(writes)).toEqual([['product.register', 108, '', 100000]])
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

// R19·R19b (D-V3-109, D-V3-84 (ㄱ), 수용 기준 표 R19·R19b): 번호 없이 정정 낱말로 가격만 고쳐 말한 다음 덩어리는 할 일을 **하나만** 낸다.
// (ㄱ)이 맞으면(찜 0·마지막 음성 새 등록 뒤 30초 안·그 뒤 다른 번호 없음) 바로 고침 + 10초 되돌리기, V2 "방금 등록한 …" 카드는 만들지 않는다.
// 30초가 지나면 (ㄱ)이 아니므로 V2 묻기 카드만(D-V3-13·D-V2-06 (3)). R1의 bts는 사전 이름 BTS(D-V3-86). 시간은 가짜 시계로 넘긴다.
const R1_SAID = '네 108번 bts 어 요한이 10만 원까지 안토 일단 색감 안쪽 봐주세요'
const V2_ASK = '방금 등록한 108번 BTS를 120,000원으로 고칠까요?'

test('AC-V3-35 R19 (D-V3-109·84 ㄱ·86): R1 등록(찜 0) 뒤 30초 안 다음 덩어리 "아니 12만원" → 108번 120,000원 바로 고침 1번·10초 되돌리기, 묻기 카드 0(V2 "방금 등록한 …" 카드도 0)', async ({ page }) => {
  await setupV3(page)
  await sayChunk(page, R1_SAID)
  await expect(boardItem(page, 108)).toBeVisible()
  const writes = recordWrites(page)
  await page.clock.runFor(1000)
  await sayChunk(page, '아니 12만원')
  const fixed = notice(page, FIXED)
  await expect(fixed).toBeVisible()
  await expect(fixed.getByRole('button', { name: '되돌리기' })).toBeVisible()
  await expect(boardItem(page, 108)).toContainText('120,000원')
  await expect.poll(() => productWrites(writes)).toEqual([['product.update', 108, 120000]])
  // 하나의 할 일만 (D-V3-109): V2 묻기 카드·R-22 묻기 카드·음성 카드 모두 없다
  await page.clock.runFor(QUIET_MS + 100)
  await settle(page)
  await expect(notice(page, V2_ASK)).toHaveCount(0)
  await expect(notice(page, ASK)).toHaveCount(0)
  await expect(notices(page).getByRole('listitem').filter({ hasText: '고칠까요' })).toHaveCount(0)
  await expect(voiceCards(page)).toHaveCount(0)
  expect(productWrites(writes)).toEqual([['product.update', 108, 120000]])
  // 10초 되돌리기 (R19 "10초 되돌리기", 고친 응답부터 — 위에서 이미 1,900ms 넘김)
  await page.clock.runFor(10000 - (QUIET_MS + 100) + 300)
  await expect(notices(page).getByRole('button', { name: '되돌리기' })).toHaveCount(0)
  await expect(boardItem(page, 108)).toContainText('120,000원')
  expect(productWrites(writes)).toEqual([['product.update', 108, 120000]])
})

test('AC-V3-35 R19b (D-V3-109·13·84 ㄱ): R1 등록 31초 뒤 다음 덩어리 "아니 12만원" → V2 "방금 등록한 108번 BTS를 120,000원으로 고칠까요?" 카드 하나, 누르기 전 쓰기 0', async ({ page }) => {
  await setupV3(page)
  await sayChunk(page, R1_SAID)
  await expect(boardItem(page, 108)).toBeVisible()
  const writes = recordWrites(page)
  // 마지막 음성 새 등록 뒤 30초(PRICE_ONLY_FIX_MS)를 넘김 — 가짜 시계로 31초
  await page.clock.runFor(31000)
  await sayChunk(page, '아니 12만원')
  const ask = notice(page, V2_ASK)
  await expect(ask).toBeVisible()
  await expect(ask).toHaveCount(1)
  await page.clock.runFor(QUIET_MS + 100)
  await settle(page)
  // V2 묻기만: 바로 고침 알림·R-22 묻기 카드 없음, 쓰기 0
  await expect(notice(page, FIXED)).toHaveCount(0)
  await expect(notice(page, ASK)).toHaveCount(0)
  await expect(notices(page).getByRole('listitem').filter({ hasText: '고칠까요' })).toHaveCount(1)
  expect(productWrites(writes)).toEqual([])
  await expect(boardItem(page, 108)).toContainText('100,000원')
})

test('AC-V3-36 R20: "21번 핑크문 만원 취소" → 등록 뒤 되돌림(21번 판매 종료), "21번 등록을 되돌렸어요". 다시 말하면 카드만, 음성을 껐다 켜면 다시 바로 등록', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  // 적용 안 함: D-REL1-02 (중간 결과 3에서 등록). D-REL1-04: 같은 덩어리의 최종 결과 둘 "21번 핑크문 만원" → "취소"
  await sayFinals(page, ['21번 핑크문 만원', '취소'], async (i) => {
    if (i === 1) await expect.poll(() => productWrites(writes)).toEqual([['product.register', 21, '핑크문', 10000]])
  })
  await page.clock.runFor(QUIET_MS + 100)
  // 4초 안내는 차례로(D-V3-61): "등록했어요" 4초 뒤 "되돌렸어요"
  await page.clock.runFor(2500)
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

test('AC-V3-37 (D-V3-10·67): "가격 못 들은 번호" 카드를 "닫기"로 닫은 번호는 같은 말(원 있음)을 해도 바로 등록하지 않는다', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await sayChunk(page, '15번')
  await page.clock.runFor(1000)
  await sayChunk(page, '16번 2만 원')
  await expect(boardItem(page, 16)).toBeVisible()
  const missed = voiceCards(page).filter({ hasText: '15번 가격을 못 들었어요' })
  await expect(missed).toHaveCount(1)
  await missed.getByRole('button', { name: /닫기$/ }).click()
  await expect(missed).toHaveCount(0)
  await page.clock.runFor(1000)
  await sayChunk(page, '15번 3만 원')
  await settle(page)
  expect(productWrites(writes).filter((w) => w[1] === 15)).toEqual([])
  await expect(boardItem(page, 15)).toHaveCount(0)
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
  // bts = 사전 이름 BTS (D-V3-86, 수용 기준 표 R1)
  await expect.poll(() => productWrites(writes)).toEqual([['product.register', 108, 'BTS', 100000]])
  await expect(voiceCards(page)).toHaveCount(0)
  release()
  await expect(boardItem(page, 108)).toBeVisible()
  await settle(page)
  expect(productWrites(writes)).toEqual([['product.register', 108, 'BTS', 100000]])
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
