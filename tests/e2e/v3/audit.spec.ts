// V3 감사 지적에 따른 E2E (SA-V3-004 — "E2E로 확인"인데 시험이 없던 기준, RA-V3-001·002·003·008).
// 기대는 harness/sprints/V3/acceptance.md 사례 표·AC 문장과 D-V3 글자 그대로. 시계는 page.clock(멈춤).
import { createRequire } from 'node:module'
import { test, expect, type Page } from '@playwright/test'
import { menuLink } from '../menu.ts'
import { downloadBytes } from '../i2/support.ts'
import { loginNewSeller } from '../i3/support.ts'
import {
  boardItem,
  card,
  cardButton,
  installFakeSpeech,
  openExtras,
  openNewBroadcast,
  recordVoiceChunk,
  uniqueDate,
  withoutVoiceHeard,
  claimOne,
  notice,
  notices,
  openLog,
  productWrites,
  readout,
  recordAllBodies,
  recordWrites,
  registerProduct,
  sayChunk,
  sayFirstOfTwo,
  sayWords,
  settle,
  setupV3,
  smsApi,
  speak,
  voiceCards,
  QUIET_MS,
  type Write,
} from './support.ts'

const OFF = { 'voice.autoRegister': false }

async function registers(writes: Write[], expected: unknown[][]): Promise<void> {
  await expect.poll(() => productWrites(writes)).toEqual(expected)
}

// ── AC-V3-33 공개 전(READY) 상품 ─────────────────────────────────────────

test('AC-V3-33: 공개 전 108번에 "108번 12만 원" → 묻기 카드 + "판매 중이 아닌 상품이라 저절로 고치지 않았어요.", 상태·가격 그대로. 같은 값이면 쓰기 0·카드 0', async ({ page }) => {
  await setupV3(page, {
    before: async ({ b }) => {
      await registerProduct(page, b, 108, 'bts', 100000, { status: 'READY' })
      await expect(boardItem(page, 108)).toContainText('공개 전')
    },
  })
  const writes = recordWrites(page)
  await sayChunk(page, '108번 12만 원')
  const ask = notice(page, '108번을 고칠까요? 가격 100,000원 → 120,000원')
  await expect(ask).toBeVisible()
  await expect(ask.getByText('판매 중이 아닌 상품이라 저절로 고치지 않았어요.')).toBeVisible()
  await settle(page)
  expect(productWrites(writes)).toEqual([])
  await expect(boardItem(page, 108)).toContainText('공개 전')
  await expect(boardItem(page, 108)).toContainText('100,000원')
  await ask.getByRole('button', { name: '그대로 두기' }).click()
  await page.clock.runFor(1000)
  await sayChunk(page, '108번 10만 원')
  await settle(page)
  expect(productWrites(writes)).toEqual([])
  await expect(notices(page).getByRole('listitem')).toHaveCount(0)
  await expect(voiceCards(page)).toHaveCount(0)
})

// ── AC-V3-52 조각 소비 R54~R60 ───────────────────────────────────────────

test.describe('AC-V3-52 조각 소비 (D-V3-46)', () => {
  test('R54: "93번 청개구리 7만 원 97번 23만 원" → 93번 청개구리 70,000원, 이어 97번 230,000원', async ({ page }) => {
    await setupV3(page)
    const writes = recordWrites(page)
    await sayChunk(page, '93번 청개구리 7만 원 97번 23만 원')
    await registers(writes, [['product.register', 93, '청개구리', 70000], ['product.register', 97, '', 230000]])
    await expect(voiceCards(page)).toHaveCount(0)
  })

  for (const [id, sentence, write, other] of [
    ['R55', '93번 청개구리 97번 23만 원', [97, '', 230000], '97번으로 등록했는데 93번도 들렸어요. 맞는지 확인해 주세요.'],
    ['R57', '108번 10만 원 109번', [108, '', 100000], '108번으로 등록했는데 109번도 들렸어요. 맞는지 확인해 주세요.'],
  ] as const) {
    test(`${id}: "${sentence}" → ${String(write[0])}번 하나, 덩어리 끝 4초 "${other}"`, async ({ page }) => {
      await setupV3(page)
      const writes = recordWrites(page)
      await sayChunk(page, sentence)
      await registers(writes, [['product.register', ...write]])
      // 4초 안내는 차례로 — "등록했어요" 다음
      await page.clock.runFor(2500)
      await expect(readout(page)).toHaveText(other)
      await expect(voiceCards(page)).toHaveCount(0)
    })
  }

  test('R56: "만 원짜리 아니고요 97번 23만 원" → 97번 230,000원 하나', async ({ page }) => {
    await setupV3(page)
    const writes = recordWrites(page)
    await sayChunk(page, '만 원짜리 아니고요 97번 23만 원')
    await registers(writes, [['product.register', 97, '', 230000]])
  })

  test('R58: "107번 10만 원 108번 12만 원" → 107번 100,000원, 108번 120,000원', async ({ page }) => {
    await setupV3(page)
    const writes = recordWrites(page)
    await sayChunk(page, '107번 10만 원 108번 12만 원')
    await registers(writes, [['product.register', 107, '', 100000], ['product.register', 108, '', 120000]])
  })

  test('R59: 97번 등록 뒤 같은 덩어리 "…자 110 자 갑니다 … 9cm 80번 …" → 쓰기 하나뿐, 묻기 카드 없음', async ({ page }) => {
    await setupV3(page)
    const writes = recordWrites(page)
    await sayChunk(page, '97번 23만 원 자 요거 갑니다 자 110 자 갑니다 요거는 수수료도 안 나오겠네 자 9cm 자 9cm 80번 자요렇게 해주시고요')
    await registers(writes, [['product.register', 97, '', 230000]])
    await page.clock.runFor(10_000)
    await settle(page)
    expect(productWrites(writes)).toEqual([['product.register', 97, '', 230000]])
    await expect(notices(page).getByRole('listitem')).toHaveCount(0)
    await expect(voiceCards(page)).toHaveCount(0)
  })
})

// ── AC-V3-53 빠른 꼴·가격 단위 R61~R64·R69~R73 ─────────────────────────────

test.describe('AC-V3-53 빠른 꼴 (D-V3-48·63)', () => {
  // 표 R61 기대는 D-V3-112(AC-V3-98 (2))로 바뀜: 천원 단위의 1~2자리 빠른 꼴은 확정 아님 → 쓰기 0, 제안 카드(읽은 값 60,000원·안내), [등록]하면 그 값
  test('R61 (천원, D-V3-112): "92번 빅뱅 60"(최종) → 쓰기 0, 카드 92번 빅뱅 60,000원 + "60,000원으로 들렸어요. 가격을 확인해 주세요", [등록]하면 60,000원', async ({ page }) => {
    await setupV3(page)
    const writes = recordWrites(page)
    await sayChunk(page, '92번 빅뱅 60')
    const offer = card(page, '92번 빅뱅 60,000원')
    await expect(offer).toBeVisible()
    await expect(offer.getByText('60,000원으로 들렸어요. 가격을 확인해 주세요')).toBeVisible()
    await settle(page)
    expect(productWrites(writes)).toEqual([])
    await expect(boardItem(page, 92)).toHaveCount(0)
    await cardButton(page, '92번 빅뱅 60,000원', '등록').click()
    await registers(writes, [['product.register', 92, '빅뱅', 60000]])
  })

  test('R62 (천원): 중간 "92번 빅뱅 60" 뒤 최종 "92번 빅뱅 60만 원" → 600,000원 하나(60,000원 쓰기 없음)', async ({ page }) => {
    await setupV3(page)
    const bodies = recordAllBodies(page)
    const writes = recordWrites(page)
    await speak(page, '92번 빅뱅 60', { final: false })
    await page.clock.runFor(300)
    await speak(page, '92번 빅뱅 60만 원')
    await page.clock.runFor(QUIET_MS + 100)
    await registers(writes, [['product.register', 92, '빅뱅', 600000]])
    for (const body of bodies) expect(body).not.toMatch(/"price":\s*60000\b/)
  })

  test('R63: "92번 빅뱅 6만 자" → 결과 4(자)에서 92번 빅뱅 60,000원', async ({ page }) => {
    await setupV3(page)
    const writes = recordWrites(page)
    await sayWords(page, '92번 빅뱅 6만 자', {
      afterEach: async (k) => {
        if (k === 4) await registers(writes, [['product.register', 92, '빅뱅', 60000]])
      },
    })
  })

  // 표 R64 기대는 D-V3-112(AC-V3-98 (2))로 바뀜: 품종 없는 빠른 꼴(D-V3-63)도 천원 단위 1~2자리면 카드
  for (const sentence of ['92번 60', '92번 저거 60']) {
    test(`R64 (천원, D-V3-112): "${sentence}"(최종) → 쓰기 0, 카드 92번 품종 미입력 60,000원 + 안내, [등록]하면 60,000원`, async ({ page }) => {
      await setupV3(page)
      const writes = recordWrites(page)
      await sayChunk(page, sentence)
      const offer = card(page, '92번 품종 미입력 60,000원')
      await expect(offer).toBeVisible()
      await expect(offer.getByText('60,000원으로 들렸어요. 가격을 확인해 주세요')).toBeVisible()
      await settle(page)
      expect(productWrites(writes)).toEqual([])
      await cardButton(page, '92번 품종 미입력 60,000원', '등록').click()
      await registers(writes, [['product.register', 92, '', 60000]])
    })
  }

  for (const [id, sentence, write] of [
    ['R69', '육십팔번 이십오', [68, '', 250000]],
    ['R72', '68번 이십오 자 요거', [68, '', 250000]],
  ] as const) {
    test(`${id} (만원 단위): "${sentence}"(최종) → 68번 250,000원`, async ({ page }) => {
      await setupV3(page, { sellerSettings: { 'price.unit': 'TEN_THOUSAND' } })
      const writes = recordWrites(page)
      await sayChunk(page, sentence)
      await registers(writes, [['product.register', ...write]])
    })
  }

  test('R70 (만원 단위): 중간 "육십팔번 이십오" 뒤 최종 "육십팔번 이십오만 원" → 250,000원 하나', async ({ page }) => {
    await setupV3(page, { sellerSettings: { 'price.unit': 'TEN_THOUSAND' } })
    const writes = recordWrites(page)
    await speak(page, '육십팔번 이십오', { final: false })
    await page.clock.runFor(300)
    await speak(page, '육십팔번 이십오만 원')
    await page.clock.runFor(QUIET_MS + 100)
    await registers(writes, [['product.register', 68, '', 250000]])
  })

  for (const [id, sentence] of [['R71', '68번 25 개'], ['R73', '68번 3']] as const) {
    test(`${id} (만원 단위): "${sentence}"(최종) → 쓰기 0`, async ({ page }) => {
      await setupV3(page, { sellerSettings: { 'price.unit': 'TEN_THOUSAND' } })
      const writes = recordWrites(page)
      await sayChunk(page, sentence)
      await settle(page)
      expect(productWrites(writes)).toEqual([])
    })
  }

  test('원 단위: "92번 빅뱅 60000" → 60,000원, "92번 빅뱅 60"은 100원 미만이라 확정 아님(카드 없음)', async ({ page }) => {
    await setupV3(page, { sellerSettings: { 'price.unit': 'WON' } })
    const writes = recordWrites(page)
    await sayChunk(page, '93번 빅뱅 60')
    await settle(page)
    expect(productWrites(writes)).toEqual([])
    await expect(voiceCards(page)).toHaveCount(0)
    await page.clock.runFor(1000)
    await sayChunk(page, '92번 빅뱅 60000')
    await registers(writes, [['product.register', 92, '빅뱅', 60000]])
  })

  test('만원 단위: "92번 빅뱅 6" → 60,000원', async ({ page }) => {
    await setupV3(page, { sellerSettings: { 'price.unit': 'TEN_THOUSAND' } })
    const writes = recordWrites(page)
    await sayChunk(page, '92번 빅뱅 6')
    await registers(writes, [['product.register', 92, '빅뱅', 60000]])
  })
})

// ── AC-V3-57 정정 낱말 R65~R68 ───────────────────────────────────────────

test.describe('AC-V3-57 정정 낱말 (D-V3-51)', () => {
  test('R65: "자 55번 갑니다 55번 자 요거 만 원 아니 가격이 좀 있는 거부터 달라니까" → 55번 10,000원 하나, 카드 0, 그 뒤 쓰기 0', async ({ page }) => {
    await setupV3(page)
    const writes = recordWrites(page)
    await sayChunk(page, '자 55번 갑니다 55번 자 요거 만 원 아니 가격이 좀 있는 거부터 달라니까')
    await registers(writes, [['product.register', 55, '', 10000]])
    await page.clock.runFor(5000)
    await settle(page)
    expect(productWrites(writes)).toEqual([['product.register', 55, '', 10000]])
    await expect(voiceCards(page)).toHaveCount(0)
  })

  test('R66: "55번 만 원 아니 만오천 원" → 등록 10,000원 뒤 고침 15,000원', async ({ page }) => {
    await setupV3(page)
    const writes = recordWrites(page)
    await sayChunk(page, '55번 만 원 아니 만오천 원')
    await registers(writes, [['product.register', 55, '', 10000], ['product.update', 55, 15000]])
  })

  test('R67 (설정 끔): "15번 핑크문 만오천 말고 만팔천" → 카드 15번 핑크문 18,000원', async ({ page }) => {
    await setupV3(page, { settings: OFF })
    const writes = recordWrites(page)
    await sayChunk(page, '15번 핑크문 만오천 말고 만팔천')
    await expect(card(page, '15번 핑크문 18,000원')).toBeVisible()
    await settle(page)
    expect(productWrites(writes)).toEqual([])
  })

  test('R68: "자 다시 보여 드릴게요 15번 라울 만 원" → 15번 라울 10,000원 바로 등록', async ({ page }) => {
    await setupV3(page)
    const writes = recordWrites(page)
    await sayChunk(page, '자 다시 보여 드릴게요 15번 라울 만 원')
    await registers(writes, [['product.register', 15, '라울', 10000]])
  })
})

// ── AC-V3-65 앞 수와 합치기·흔한 말 별칭 ────────────────────────────────────

test.describe('AC-V3-65 (D-V3-54)', () => {
  test('"오십 삼번 라울 만 원" → 53번 바로 등록, "5 13번 라울 만 원" → 쓰기 0·카드 0', async ({ page }) => {
    await setupV3(page)
    const writes = recordWrites(page)
    await sayChunk(page, '오십 삼번 라울 만 원')
    await registers(writes, [['product.register', 53, '라울', 10000]])
    await page.clock.runFor(6000)
    await sayChunk(page, '5 13번 라울 만 원')
    await settle(page)
    expect(productWrites(writes)).toEqual([['product.register', 53, '라울', 10000]])
    await expect(voiceCards(page)).toHaveCount(0)
  })

  test('흔한 말 별칭: "89번 녹음 7만 원" → 녹금, 번호 없는 "녹음 잘 되고 있죠"는 품종이 아니다(쓰기 0)', async ({ page }) => {
    await setupV3(page)
    const writes = recordWrites(page)
    await sayChunk(page, '89번 녹음 7만 원')
    await registers(writes, [['product.register', 89, '녹금', 70000]])
    await page.clock.runFor(6000)
    await sayChunk(page, '녹음 잘 되고 있죠')
    await settle(page)
    expect(productWrites(writes)).toHaveLength(1)
  })
})

// ── AC-V3-67 같은 번호 고침 화면 ───────────────────────────────────────────

// 가격 고침 문턱 (D-V3-83, 수용 기준 표 머리 (2)): AC-V3-67 화면 예의 "바로 고침"은 같은 말을 다른 조각에서 한 번 더 들었을 때 — 첫 번은 묻기 카드·쓰기 0
test.describe('AC-V3-67 (D-V3-55·57·64·83)', () => {
  test('방금 음성 등록한 62번 100,000원에 "62번 2만 원"(다른 조각에서 두 번) → 바로 고침 20,000원(내림도 바로)', async ({ page }) => {
    await setupV3(page)
    const writes = recordWrites(page)
    await sayChunk(page, '62번 10만 원')
    await expect(boardItem(page, 62)).toBeVisible()
    await page.clock.runFor(1000)
    await sayFirstOfTwo(page, '62번 2만 원', '62번을 고칠까요? 가격 100,000원 → 20,000원', writes)
    await sayChunk(page, '62번 2만 원')
    await expect(notices(page).getByRole('listitem', { name: /^62번을 고쳤어요: (가격 )?100,000원 → 20,000원/ })).toBeVisible()
    await registers(writes, [['product.register', 62, '', 100000], ['product.update', 62, 20000]])
  })

  test('"62번 500만 원"(다른 조각에서 두 번) → 바로 고침 5,000,000원, 정산 화면 기록에 "크게 바뀜"', async ({ page }) => {
    const { date } = await setupV3(page)
    const writes = recordWrites(page)
    await sayChunk(page, '62번 10만 원')
    await expect(boardItem(page, 62)).toBeVisible()
    await page.clock.runFor(1000)
    await sayFirstOfTwo(page, '62번 500만 원', '62번을 고칠까요? 가격 100,000원 → 5,000,000원', writes)
    await sayChunk(page, '62번 500만 원')
    await registers(writes, [['product.register', 62, '', 100000], ['product.update', 62, 5000000]])
    await page.clock.resume()
    await page.goto(`/settlements?date=${date}&rehearsal=true`)
    const section = page.getByRole('region', { name: '음성 기록' })
    await expect(section.getByText(/^확인할 음성 고침 \d+건$/)).toBeVisible()
    await section.getByText(/^음성으로 등록·고친 기록 \d+건$/).click()
    await expect(section).toContainText('크게 바뀜')
  })

  test('TE-V3-019 판매 종료 상품은 묻기', async ({ page }) => {
    await setupV3(page, {
      before: async ({ b }) => {
        await registerProduct(page, b, 62, '', 100000)
        const res = await page.request.post('/api/events', { data: { requestId: crypto.randomUUID(), type: 'product.close', b, no: 62 }, headers: { Origin: new URL(page.url()).origin } })
        expect(res.ok()).toBe(true)
        await expect(boardItem(page, 62)).toContainText('판매 종료')
      },
    })
    const writes = recordWrites(page)
    await sayChunk(page, '62번 2만 원')
    await expect(notices(page).getByRole('listitem', { name: /^62번을 고칠까요\?/ })).toBeVisible()
    await settle(page)
    expect(productWrites(writes)).toEqual([])
  })
})

// ── AC-V3-69 잡담 알림 없음·4초 안내 ───────────────────────────────────────

test.describe('AC-V3-69 (D-V3-61)', () => {
  test('(a) 잡담·301글자 → 화면에 "문장이 너무 길어요"·"번호와 가격이 안 들렸어요" 없음, 음성 기록에만', async ({ page }) => {
    await setupV3(page)
    await sayChunk(page, '오늘 날씨가 좋네요 여러분')
    await page.clock.runFor(1000)
    await sayChunk(page, '가'.repeat(301))
    for (const text of ['문장이 너무 길어요', '번호와 가격이 안 들렸어요']) await expect(page.getByRole('main').getByText(text)).toHaveCount(0)
    const dlg = await openLog(page)
    await expect(dlg.getByRole('list', { name: '음성 기록 목록' }).getByRole('listitem')).toHaveCount(2)
  })

  test('(b) "자 7만 원" → 4초 "70,000원 · 번호를 못 들었어요", "15번 2만 원 15번" → 등록 하나·안내 없음, "15번" 덩어리 끝 → 4초 안내 없음', async ({ page }) => {
    await setupV3(page)
    const writes = recordWrites(page)
    await sayChunk(page, '자 7만 원')
    await expect(readout(page)).toHaveText('70,000원 · 번호를 못 들었어요')
    await page.clock.runFor(4500)
    await sayChunk(page, '15번 2만 원 15번')
    await registers(writes, [['product.register', 15, '', 20000]])
    await page.clock.runFor(4500)
    await expect(readout(page)).toHaveCount(0)
    await sayChunk(page, '16번')
    await expect(readout(page)).toHaveCount(0)
  })
})

// ── AC-V3-72 R77·R79·R80 ───────────────────────────────────────────────

test.describe('AC-V3-72 기다리는 번호 (D-V3-67)', () => {
  test('R77: R74 카드에 15 입력 후 [등록](천원) → 15번 15,000원', async ({ page }) => {
    await setupV3(page)
    const writes = recordWrites(page)
    await sayChunk(page, '15번')
    await page.clock.runFor(1000)
    await sayChunk(page, '16번 2만 원')
    const missed = voiceCards(page).filter({ hasText: '15번 가격을 못 들었어요' })
    await expect(missed).toHaveCount(1)
    await missed.getByRole('textbox').fill('15')
    await missed.getByRole('button', { name: /등록$/ }).click()
    await registers(writes, [['product.register', 16, '', 20000], ['product.register', 15, '', 15000]])
  })

  test('R79: 15번이 이미 있을 때 "15번" 뒤 "이만 원" → 쓰기 0, 카드 0', async ({ page }) => {
    await setupV3(page, {
      before: async ({ b }) => {
        await registerProduct(page, b, 15, '라울', 10000)
        await expect(boardItem(page, 15)).toBeVisible()
      },
    })
    const writes = recordWrites(page)
    await sayChunk(page, '15번')
    await page.clock.runFor(1000)
    await sayChunk(page, '이만 원')
    await page.clock.runFor(61_000)
    await settle(page)
    expect(productWrites(writes)).toEqual([])
    await expect(voiceCards(page)).toHaveCount(0)
  })

  test('TE-V3-018 R80: "15번" → "16번" → "17번" → "18번" → 카드 15·16·17, 19번이 오면 가장 오래된 15번이 "가격 못 들은 번호 1개 더"로 접힘', async ({ page }) => {
    await setupV3(page)
    for (const no of [15, 16, 17, 18]) {
      await sayChunk(page, `${String(no)}번`)
      await page.clock.runFor(1000)
    }
    for (const no of [15, 16, 17]) await expect(voiceCards(page).filter({ hasText: `${String(no)}번 가격을 못 들었어요` })).toHaveCount(1)
    await sayChunk(page, '19번')
    await expect(page.getByText('가격 못 들은 번호 1개 더')).toBeVisible()
    await expect(voiceCards(page).filter({ hasText: '15번 가격을 못 들었어요' })).toHaveCount(0)
  })
})

// ── AC-V3-73 R94~R96 ──────────────────────────────────────────────────

test.describe('AC-V3-73 판매 말투 (D-V3-72, 천원)', () => {
  // 표 R94·R95 기대는 D-V3-112로 바뀜(faaee7f9): 말투·되풀이로 읽은 값 45,000원은 천원 단위 1~2자리라 확정 아님 → 쓰기 0, 제안 카드·안내, [등록]하면 그 값
  for (const [id, sentence] of [['R94', '113번 45에 드려볼게요 자 45~'], ['R95', '113번 45 드려 보겠습니다']] as const) {
    test(`${id} (D-V3-112): "${sentence}"(최종) → 쓰기 0, 카드 113번 45,000원 + "45,000원으로 들렸어요. 가격을 확인해 주세요", [등록]하면 45,000원`, async ({ page }) => {
      await setupV3(page)
      const writes = recordWrites(page)
      await sayChunk(page, sentence)
      const offer = card(page, '113번 품종 미입력 45,000원')
      await expect(offer).toBeVisible()
      await expect(offer.getByText('45,000원으로 들렸어요. 가격을 확인해 주세요')).toBeVisible()
      await settle(page)
      expect(productWrites(writes)).toEqual([])
      await expect(boardItem(page, 113)).toHaveCount(0)
      await cardButton(page, '113번 품종 미입력 45,000원', '등록').click()
      await registers(writes, [['product.register', 113, '', 45000]])
    })
  }

  test('R96: "113번 45에 드려볼게요 자 50"(최종) → 쓰기 0', async ({ page }) => {
    await setupV3(page)
    const writes = recordWrites(page)
    await sayChunk(page, '113번 45에 드려볼게요 자 50')
    await settle(page)
    expect(productWrites(writes)).toEqual([])
  })
})

// ── R97 등록된 pick은 뒤 글로 취소되지 않음 (D-V3-79, 자동 단위로 옮김 — faaee7f9) ──────────────

test('R97 (자동 단위, D-V3-79): 중간 "15번 라울 60 자"에서 등록 뒤 최종 "15번 라울 60 자 뿌리 다 살아 있어요" → 15번 라울 600,000원 하나, 취소·두 번째 쓰기 없음', async ({ page }) => {
  await setupV3(page, { sellerSettings: { 'price.unit': 'AUTO' } })
  const writes = recordWrites(page)
  await sayWords(page, '15번 라울 60 자 뿌리 다 살아 있어요', {
    afterEach: async (k) => {
      // `자`(결과 4) 때 등록 — 표 R97 "`자` 때"
      if (k === 4) await registers(writes, [['product.register', 15, '라울', 600000]])
    },
  })
  await page.clock.runFor(QUIET_MS + 100)
  await page.clock.runFor(5000)
  await settle(page)
  expect(productWrites(writes)).toEqual([['product.register', 15, '라울', 600000]])
  await expect(boardItem(page, 15)).toContainText('600,000원')
  await expect(voiceCards(page)).toHaveCount(0)
})

// ── AC-V3-74 (b)(c) 가격 단위 자동 ─────────────────────────────────────────

test.describe('AC-V3-74 (D-V3-70)', () => {
  test('(b) 설정 → 판매 규칙 "가격 단위"에 넷째 "자동 (25 → 250,000원, 180 → 180,000원)", 새 판매자 기본은 천원, 바꿀 때 확인 문장', async ({ page }) => {
    await setupV3(page)
    await page.clock.resume()
    await menuLink(page, '설정').click()
    const unit = page.getByRole('radiogroup', { name: '가격 단위' })
    await expect(unit.getByRole('radio')).toHaveCount(4)
    await expect(unit.getByRole('radio').nth(3)).toHaveAccessibleName('자동 (25 → 250,000원, 180 → 180,000원)')
    await expect(unit.getByRole('radio', { name: '천원 (15 → 15,000원)' })).toBeChecked()
    await unit.getByRole('radio', { name: '자동 (25 → 250,000원, 180 → 180,000원)' }).check()
    await expect(page.getByText(/^저장하면 다음 방송부터 /)).toBeVisible()
  })

  test('(c) 자동 방송의 빠른 입력 "15 핑크프릴 25" → 250,000원(미리 보기 같음), "16 라울 180" → 180,000원, 가져오기 숫자 칸 25 → 250,000원', async ({ page }) => {
    await setupV3(page, { sellerSettings: { 'price.unit': 'AUTO' } })
    await page.clock.resume()
    const input = page.getByLabel('빠른 입력')
    await input.fill('15 핑크프릴 25')
    await expect(page.locator('main').getByRole('status').filter({ hasText: /^등록하면: / })).toHaveText('등록하면: 15번 핑크프릴 250,000원')
    await input.press('Enter')
    await expect(boardItem(page, 15)).toContainText('250,000원')
    await input.fill('16 라울 180')
    await input.press('Enter')
    await expect(boardItem(page, 16)).toContainText('180,000원')
    await page.getByRole('button', { name: '상품 목록 가져오기' }).click()
    const dlg = page.getByRole('dialog', { name: '상품 목록 가져오기' })
    await dlg.getByRole('textbox', { name: '붙여 넣기' }).fill('21\t라울\t25')
    await dlg.getByRole('button', { name: '미리 보기' }).click()
    await expect(dlg.getByRole('table', { name: '가져올 상품' })).toContainText('250,000원')
  })
})

// ── AC-V3-71 정산 화면·상품 자세히·판매대장 ─────────────────────────────────

test('AC-V3-71 (D-V3-83 두 번 들음): 정산 화면 접힌 칸 "음성으로 등록·고친 기록 N건"(시각순·들은 말·[상품 보기] → 상품 자세히), 판매대장 .xlsx "음성 기록" 시트', async ({ page }) => {
  const { b, date } = await setupV3(page, { rehearsal: false })
  await sayChunk(page, '62번 10만 원')
  await expect(boardItem(page, 62)).toBeVisible()
  // 정산 문서가 보이도록 손님 하나(문자찜)
  await smsApi(page, { b, no: 62, phone: '010-7000-6262' })
  await page.clock.runFor(1000)
  // 가격 고침은 같은 말을 다른 조각에서 두 번 들었을 때 (D-V3-83) — 묻기 카드만인 첫 번은 쓰기가 아니라 기록 건수에 들지 않는다
  await sayFirstOfTwo(page, '62번 2만 원', '62번을 고칠까요? 가격 100,000원 → 20,000원')
  await sayChunk(page, '62번 2만 원')
  await expect(boardItem(page, 62)).toContainText('20,000원')
  // 콘솔 상품 자세히에 그 상품 기록
  await page.clock.resume()
  await boardItem(page, 62).click()
  const detail = page.getByRole('dialog', { name: '62번 자세히' })
  await expect(detail.getByRole('region', { name: '음성 기록' })).toContainText('들은 말:')
  await page.keyboard.press('Escape')
  await page.goto(`/settlements?date=${date}`)
  const section = page.getByRole('region', { name: '음성 기록' })
  await section.getByText('음성으로 등록·고친 기록 2건').click()
  const items = section.getByRole('listitem')
  await expect(items).toHaveCount(2)
  await expect(items.nth(0)).toContainText('62번')
  await expect(items.nth(1)).toContainText('100,000원 → 20,000원')
  await expect(items.nth(1)).toContainText('들은 말: 62번 2만 원')
  await items.nth(1).getByRole('button', { name: '상품 보기' }).click()
  // [상품 보기] → 그 상품 자세히 (콘솔)
  await expect(page.getByRole('dialog', { name: /62번/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.goto(`/settlements?date=${date}`)
  await page.getByRole('group', { name: '정산 문서' }).getByRole('button', { name: '판매대장 엑셀' }).click()
  const dlg = page.getByRole('dialog', { name: '판매대장 엑셀' })
  const wait = page.waitForEvent('download')
  await dlg.getByRole('button', { name: '엑셀 내려받기' }).click()
  const bytes = await downloadBytes(await wait)
  const Excel = createRequire(createRequire(import.meta.url).resolve('@livejjim/documents'))('exceljs') as { Workbook: new () => { worksheets: { name: string; rowCount: number }[]; xlsx: { load: (b: Uint8Array) => Promise<unknown> } } }
  const book = new Excel.Workbook()
  await book.xlsx.load(bytes)
  const sheet = book.worksheets.find((w) => w.name === '음성 기록')
  expect(sheet, '판매대장에 "음성 기록" 시트').toBeDefined()
  expect(sheet!.rowCount).toBeGreaterThanOrEqual(3)
})

// ── AC-V3-45 음성을 켜지 않은 콘솔은 음성 코드를 불러오지 않는다 ─────────────────

test('AC-V3-45: 음성을 한 번도 켜지 않은 콘솔은 음성 코드·사전을 불러오지 않는다', async ({ page }) => {
  await installFakeSpeech(page, { consent: true, autoRegister: true })
  const chunks = recordVoiceChunk(page)
  await loginNewSeller(page)
  await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
  await expect(page.getByRole('button', { name: '음성 켜기', exact: true })).toBeEnabled()
  await expect(page.getByRole('region', { name: '상품 보드' })).toBeVisible()
  expect(chunks).toEqual([])
})

// ── 위험 감사 RA-V3-001·002·003 ─────────────────────────────────────────

test('RA-V3-001: 번호를 옮긴 뒤 새 번호에 찜이 생기면 [되돌리기]는 옮기지 않고 "61번에 찜이 생겨 번호를 되돌리지 않았어요. 상품 목록에서 고쳐 주세요."', async ({ page }) => {
  const { b } = await setupV3(page)
  await sayChunk(page, '65번 3만 원')
  await expect(boardItem(page, 65)).toBeVisible()
  await page.clock.runFor(5000)
  await sayChunk(page, '아까 65번은 61번이에요')
  await expect(boardItem(page, 61)).toBeVisible()
  await claimOne(page, b, 61)
  await expect(boardItem(page, 61)).toContainText('찜손님')
  const writes = recordWrites(page)
  await notices(page).getByRole('button', { name: '되돌리기' }).first().click()
  // 4초 안내는 차례로(D-V3-61) — "옮겼어요" 다음
  await page.clock.runFor(4500)
  await expect(readout(page)).toHaveText('61번에 찜이 생겨 번호를 되돌리지 않았어요. 상품 목록에서 고쳐 주세요.')
  await settle(page)
  expect(writes.filter((w) => w.type === 'product.renumber')).toEqual([])
  await expect(boardItem(page, 61)).toBeVisible()
  await expect(boardItem(page, 65)).toHaveCount(0)
})

test('RA-V3-002: 콘솔 밖 띠의 되돌리기는 그 상품의 직전 등록만 — 다른 상품은 그대로', async ({ page }) => {
  await setupV3(page)
  await menuLink(page, '설정').click()
  const band = page.getByRole('region', { name: '음성 듣는 중' })
  await expect(band).toBeVisible()
  const writes = recordWrites(page)
  await sayChunk(page, '15번 라울 만 원')
  await page.clock.runFor(1000)
  await sayChunk(page, '16번 라울 2만 원')
  await registers(writes, [['product.register', 15, '라울', 10000], ['product.register', 16, '라울', 20000]])
  await band.getByRole('button', { name: /16번.*되돌리기/ }).click()
  await expect.poll(() => writes.filter((w) => w.type === 'product.close').map((w) => w.body['no'])).toEqual([16])
  await settle(page)
  expect(writes.filter((w) => w.type === 'product.close').map((w) => w.body['no'])).toEqual([16])
})

test('RA-V3-003 (D-V3-83 두 번 들음): 찜이 있는 상품의 음성 고침을 [되돌리기]하면 가격 적용 범위 UNPAID_CLAIMS(입금 전 찜도 원래 가격)', async ({ page }) => {
  const { b } = await setupV3(page)
  await sayChunk(page, '108번 10만 원')
  await expect(boardItem(page, 108)).toBeVisible()
  await claimOne(page, b, 108)
  await expect(boardItem(page, 108)).toContainText('찜손님')
  await page.clock.runFor(1000)
  const writes = recordWrites(page)
  await sayFirstOfTwo(page, '108번 12만 원', '108번을 고칠까요? 가격 100,000원 → 120,000원', writes)
  await sayChunk(page, '108번 12만 원')
  const fixed = notice(page, '108번을 고쳤어요: 가격 100,000원 → 120,000원')
  await expect(fixed).toBeVisible()
  await fixed.getByRole('button', { name: '되돌리기' }).click()
  await expect.poll(() => writes.filter((w) => w.type === 'product.update').length).toBe(2)
  const revert = writes.filter((w) => w.type === 'product.update')[1]!
  expect(revert.body['price']).toBe(100000)
  expect(revert.body['applyTo']).toBe('UNPAID_CLAIMS')
})

// ── AC-V3-66 음성 인식 기록 모아 두기 (D-V3-56·66·75) + RA-V3-008 ───────────────

/** 이 기기의 음성 인식 기록(IndexedDB) 전부 — 이름이 livejjim-voice-archive로 시작하는 DB(판매자마다 따로일 수 있다, RA-V3-008) */
async function archiveChunks(page: Page): Promise<{ db: string; broadcastId: string; text: string }[]> {
  return await page.evaluate(async () => {
    const names = ((await indexedDB.databases?.()) ?? []).map((d) => d.name ?? '').filter((n) => n.startsWith('livejjim-voice-archive'))
    const out: { db: string; broadcastId: string; text: string }[] = []
    for (const name of names) {
      const rows = await new Promise<{ broadcastId?: string }[]>((resolve) => {
        const req = indexedDB.open(name)
        req.onerror = () => resolve([])
        req.onsuccess = () => {
          const db = req.result
          const stores = [...db.objectStoreNames]
          if (stores.length === 0) {
            db.close()
            resolve([])
            return
          }
          const all = db.transaction(stores[0]!, 'readonly').objectStore(stores[0]!).getAll()
          all.onsuccess = () => {
            db.close()
            resolve(all.result as { broadcastId?: string }[])
          }
          all.onerror = () => {
            db.close()
            resolve([])
          }
        }
      })
      for (const r of rows) out.push({ db: name, broadcastId: r.broadcastId ?? '', text: JSON.stringify(r) })
    }
    return out
  })
}

test.describe('AC-V3-66 음성 인식 기록 모아 두기', () => {
  // (b)의 "덩어리 3개"는 굳은 중간 글(D-V3-80) 전의 셈이다: 1초 넘게 그대로인 앞 낱말("네", R2의 "자 bts는 … 요")은 최종처럼 먼저 넘어가고,
  // 다음 결과 첫 조각의 번호가 모은 글(번호 없음)과 다르면 먼저 끊으므로(D-V2-16) 사례 표 꼴(결과 사이 200ms)로 말한 R1·R2는 덩어리 둘씩으로
  // 갈린다(같은 크롬 결과에서 갈린 덩어리 — D-V3-93). 그래서 덩어리 수 대신 그 방송 기록 글을 차례로 이으면 세 말이 빠짐·겹침 없이 그대로인지 보고,
  // 새로 고친 뒤에도 같은 기록이 남는지 본다.
  test('(a) 연습 주소에선 처음부터 켜져 있고 안내 문장, (b) R1·R2·R13 → 그 방송 덩어리 기록(세 말 그대로, D-V3-80 굳은 글로 갈린 덩어리 포함)이 새로 고침 뒤에도 남고 서버로 가지 않는다', async ({ page }) => {
    const bodies = recordAllBodies(page)
    const { b } = await setupV3(page)
    const extras = await openExtras(page)
    await expect(extras.getByRole('checkbox', { name: '음성 인식 기록 모아 두기' })).toBeChecked()
    await expect(extras.getByText('판매자 목소리를 글로 바꾼 것이 이 기기에 남아요. 시청자 이름이 들어갈 수 있어요.')).toBeVisible()
    const said = [
      '네 108번 bts 어 요한이 10만 원까지 안토 일단 색감 안쪽 봐주세요',
      '자 bts는 자 bts 요거 그대로 보냅니다 요 아이 자 10만 원 108번',
      '108번 12만 원',
    ]
    await sayChunk(page, said[0]!)
    await page.clock.runFor(6000)
    await sayChunk(page, said[1]!)
    await page.clock.runFor(6000)
    await sayChunk(page, said[2]!)
    const texts = async (): Promise<string[]> =>
      (await archiveChunks(page)).filter((c) => c.broadcastId === b).map((c) => String((JSON.parse(c.text) as { chunk?: { text?: unknown } }).chunk?.text ?? ''))
    await expect.poll(async () => (await texts()).join(' ')).toBe(said.join(' '))
    const before = await texts()
    expect(before.length).toBeGreaterThanOrEqual(3)
    await page.clock.resume()
    await page.reload()
    await expect(page.getByLabel('빠른 입력')).toBeVisible()
    expect(await texts()).toEqual(before)
    for (const body of bodies) {
      const raw = body.slice(body.indexOf(' ') + 1)
      expect(withoutVoiceHeard(raw)).not.toContain('요한이')
    }
  })

  test('(c) 끝자리·끝번호·전화번호(숫자·한글 수)는 **** 로 가려져 남는다 (D-V3-66·75)', async ({ page }) => {
    await setupV3(page)
    await sayChunk(page, '끝자리 1234 김민지님 끝번호 5678 010-1234-5678 공일공 일이삼사 오육칠팔 끝자리 일이삼사')
    await expect.poll(async () => (await archiveChunks(page)).length).toBe(1)
    const text = (await archiveChunks(page))[0]!.text
    for (const raw of ['1234', '5678', '010-1234-5678', '공일공 일이삼사 오육칠팔', '끝자리 일이삼사']) expect(text).not.toContain(raw)
    expect(text).toContain('****')
  })

  test('(d) 31일 지나면 그 덩어리가 지워진다, [기록 지우기]면 0개', async ({ page }) => {
    await setupV3(page)
    await sayChunk(page, '15번 라울 만 원')
    await expect.poll(async () => (await archiveChunks(page)).length).toBe(1)
    const now = await page.evaluate(() => Date.now())
    await page.clock.pauseAt(now + 31 * 24 * 60 * 60 * 1000)
    await sayChunk(page, '16번 라울 만 원')
    await expect.poll(async () => (await archiveChunks(page)).length).toBe(1)
    await (await openExtras(page)).getByRole('button', { name: '기록 지우기' }).first().click()
    await expect.poll(async () => (await archiveChunks(page)).length).toBe(0)
  })

  test('(e) [이 방송 음성 인식 기록 내려받기] JSON 형식', async ({ page }) => {
    const { b } = await setupV3(page)
    await sayChunk(page, '15번 라울 만 원')
    await expect.poll(async () => (await archiveChunks(page)).length).toBe(1)
    const extras = await openExtras(page)
    const wait = page.waitForEvent('download')
    await extras.getByRole('button', { name: '이 방송 음성 인식 기록 내려받기' }).click()
    const json = JSON.parse((await downloadBytes(await wait)).toString('utf8')) as Record<string, unknown>
    expect(Object.keys(json).sort()).toEqual(['broadcasts', 'exportedAt', 'format', 'version'])
    expect(json['format']).toBe('livegenie-voice-log')
    expect(json['version']).toBe(1)
    const broadcasts = json['broadcasts'] as Record<string, unknown>[]
    expect(broadcasts).toHaveLength(1)
    expect(broadcasts[0]!['broadcastId']).toBe(b)
    const chunk = (broadcasts[0]!['chunks'] as Record<string, unknown>[])[0]!
    for (const key of ['at', 'text', 'reading', 'action', 'reason', 'undone', 'edited']) expect(chunk).toHaveProperty(key)
    expect(['REGISTERED', 'IGNORED', 'FIXED', 'ASKED', 'DROPPED']).toContain(chunk['action'])
    const reading = chunk['reading'] as Record<string, unknown>
    expect(Object.keys(reading).sort()).toEqual(['name', 'no', 'numberFrom', 'price', 'priceFrom'])
    expect(['marker', 'bare', null]).toContain(reading['numberFrom'])
    expect(['won', 'quick', null]).toContain(reading['priceFrom'])
  })

  test('(f) 꺼져 있으면 IndexedDB에 받아쓴 글이 없다', async ({ page }) => {
    await setupV3(page, { settings: { 'voice.archive': false } })
    await sayChunk(page, '15번 라울 만 원 비밀말가나다')
    await page.clock.runFor(1000)
    for (const row of await archiveChunks(page)) expect(row.text).not.toContain('비밀말가나다')
  })

  test('RA-V3-008: 기록은 판매자별 — 로그아웃하면 지우고, 다른 판매자로 들어오면 앞 판매자 기록이 없다', async ({ page }) => {
    await setupV3(page)
    await sayChunk(page, '15번 라울 만 원 첫판매자말')
    await expect.poll(async () => (await archiveChunks(page)).length).toBe(1)
    await page.clock.resume()
      await page.getByRole('button', { name: '로그아웃', exact: true }).first().click()
    const confirm = page.getByRole('dialog', { name: '로그아웃할까요?' })
    // 끝내지 않은 방송이 있으면 확인 창(AC-MOB1-06) — 뜨거나 바로 로그아웃될 때까지 기다린다
    await expect.poll(async () => (await confirm.isVisible()) || (await page.request.get('/api/me')).status() === 401).toBe(true)
    if (await confirm.isVisible()) await confirm.getByRole('button', { name: '로그아웃', exact: true }).click()
    await expect.poll(async () => (await page.request.get('/api/me')).status()).toBe(401)
    expect(await archiveChunks(page)).toEqual([])
    await loginNewSeller(page)
    for (const row of await archiveChunks(page)) expect(row.text).not.toContain('첫판매자말')
  })
})
