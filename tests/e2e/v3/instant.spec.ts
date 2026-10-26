// V3 바로 등록 (AC-V3-20~24·26·29) — 기대값은 harness/sprints/V3/acceptance.md 사례 표에서 손으로 옮겼다(구현을 보고 정하지 않음).
// 설정은 기본(바로 등록 켬, D-V3-16). 가짜 인식이 중간 결과를 200ms마다 낸다.
import { test, expect, type Page } from '@playwright/test'
import {
  boardItem,
  card,
  cardButton,
  productWrites,
  readout,
  recordAllBodies,
  recordWrites,
  sayChunk,
  sayWords,
  settle,
  setupV3,
  undoBar,
  voiceCards,
  openLog,
  QUIET_MS,
  type Write,
} from './support.ts'

const BROADCAST_1 = '네 108번 bts 어 요한이 10만 원까지 안토 일단 색감 안쪽 봐주세요'
const BROADCAST_2 = '자 bts는 자 bts 요거 그대로 보냅니다 요 아이 자 10만 원 108번'
const BROADCAST_3 = '자 180번 상관 세금 자 요 아이 자 유아이 35만 원까지 네 요 아이는 35만 원까지 그대로 봅니다 색금 이렇게 잘 들었어요 자 3강색급 요 아이는 30 5만 원'
const BROADCAST_4 = '자 파이텐트까지 나오는 상강색 게임 잘 들었어요 자 상강 색금 자 요 아이 자 28만 원 174번 자 174 자 이거 28만 원 자 3강색은 요 아이 28마리까지'
const BROADCAST_5 = '자 9cm에 자 9cm에 3번 자 3강 세금 뿌리 다 남았고요 얘는 자 25만 원 170 자 요런 색금 예쁘게 나왔습니다 이거 25만 원 3강 세금 170 자 이 703강 세금이 자 25만 원까지'

/**
 * 문장을 사례 표 꼴로 말하고: 결과 k-1까지 쓰기 0, 결과 k에서 등록 하나(표의 값), 덩어리가 끝난 뒤에도 쓰기는 그 하나뿐.
 */
async function expectRegisteredAt(page: Page, writes: Write[], sentence: string, k: number, expected: readonly [number, string, number]): Promise<void> {
  const [no, name, price] = expected
  await sayWords(page, sentence, {
    afterEach: async (i) => {
      if (i === k - 1) {
        await settle(page)
        expect(productWrites(writes), `결과 ${String(i)}까지는 쓰기 없음`).toEqual([])
      }
      if (i === k) await expect.poll(() => productWrites(writes), { message: `결과 ${String(k)}에서 등록` }).toEqual([['product.register', no, name, price]])
    },
  })
  await page.clock.runFor(QUIET_MS + 100)
  await expect(boardItem(page, no)).toBeVisible()
  await settle(page)
  expect(productWrites(writes)).toEqual([['product.register', no, name, price]])
  await expect(voiceCards(page)).toHaveCount(0)
}

test('AC-V3-20 R1: 실제 방송 1 — 결과 7(원까지)에서 조용한 시간 전에 108번 품종 미입력 100,000원 등록 하나(bts 한 번 → 추측 없음, D-V3-30), 5초 되돌리기 띠·큰 글자 칸, 카드 없음', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await sayWords(page, BROADCAST_1, {
    afterEach: async (k) => {
      if (k === 6) {
        await settle(page)
        expect(productWrites(writes)).toEqual([])
      }
      if (k === 7) {
        await expect.poll(() => productWrites(writes)).toEqual([['product.register', 108, '', 100000]])
        await expect(readout(page)).toHaveText('108번 100,000원 등록했어요')
        await expect(undoBar(page).getByRole('button', { name: '108번 등록 되돌리기' })).toBeVisible()
      }
    },
  })
  await expect(voiceCards(page)).toHaveCount(0)
  // 덩어리 끝
  await page.clock.runFor(QUIET_MS + 100)
  await expect(boardItem(page, 108)).toContainText('100,000원')
  await settle(page)
  expect(productWrites(writes)).toEqual([['product.register', 108, '', 100000]])
  await expect(voiceCards(page)).toHaveCount(0)
})

test('AC-V3-20 (D-V3-37): 사전 이름이면 큰 글자 칸 "108번 핑크프릴 100,000원 등록했어요", 4초 뒤 사라진다', async ({ page }) => {
  await setupV3(page)
  await sayWords(page, '108번 핑크프릴 10만 원')
  await expect(readout(page)).toHaveText('108번 핑크프릴 100,000원 등록했어요')
  await page.clock.runFor(3500)
  await expect(readout(page)).toHaveText('108번 핑크프릴 100,000원 등록했어요')
  await page.clock.runFor(4000)
  await expect(readout(page).filter({ hasText: '등록했어요' })).toHaveCount(0)
})

test('AC-V3-21 R2: 108번이 있으면 실제 방송 2 — 쓰기 0, 카드 0, "108번은 이미 등록됐어요", 기록 "이미 등록됨". 세 번 더 해도 같다', async ({ page }) => {
  await setupV3(page)
  await sayChunk(page, BROADCAST_1)
  await expect(boardItem(page, 108)).toBeVisible()
  // 되돌리기 띠 시간이 지나게 둔다
  await page.clock.runFor(6000)
  const writes = recordWrites(page)
  for (let round = 0; round < 4; round += 1) {
    await sayWords(page, BROADCAST_2)
    await expect(readout(page)).toHaveText('108번은 이미 등록됐어요')
    await page.clock.runFor(QUIET_MS + 100)
    await settle(page)
    expect(writes.map((w) => w.type), `${String(round + 1)}번째`).toEqual([])
    await expect(voiceCards(page)).toHaveCount(0)
    await page.clock.runFor(5000)
  }
  const dlg = await openLog(page)
  const items = dlg.getByRole('list', { name: '음성 기록 목록' }).getByRole('listitem')
  // 같은 말 네 번 — 덩어리마다 "이미 등록됨"이 하나 이상
  expect(await items.filter({ hasText: '이미 등록됨' }).count()).toBeGreaterThanOrEqual(4)
  await expect(page.getByRole('dialog', { name: '108번을 고칠까요?' })).toHaveCount(0)
})

test('AC-V3-22 R3: 108번 없음 + 실제 방송 2 → 결과 13(108번)에서 108번 품종 미입력 100,000원 (bts는 사전 밖, D-V3-37)', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await expectRegisteredAt(page, writes, BROADCAST_2, 13, [108, '', 100000])
})

test('TE-V3-001 AC-V3-22 R4: 실제 방송 3 → 결과 11에서 180번 삼광색금 350,000원, 끝의 "30 5만 원" 뒤에도 고치기 없음', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await expectRegisteredAt(page, writes, BROADCAST_3, 11, [180, '삼광색금', 350000])
})

test('TE-V3-013 AC-V3-22 R5 (D-V3-46): 실제 방송 4 → 결과 23(둘째 원)에서 174번 삼광색금 280,000원 — 앞에 번호 없던 첫 28만 원은 버림', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await expectRegisteredAt(page, writes, BROADCAST_4, 23, [174, '삼광색금', 280000])
})

// AC-V3-22 "그 덩어리의 쓰기는 하나뿐" — 지금은 남은 조각의 '번' 없는 170으로 170번 250,000원을 또 등록한다(TE-V3-012)
test('TE-V3-012 AC-V3-22 R6: 실제 방송 5 → 결과 15(원)에서 3번 삼광색금 250,000원 하나뿐 (D-V3-20)', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await expectRegisteredAt(page, writes, BROADCAST_5, 15, [3, '삼광색금', 250000])
})

test('AC-V3-23 R8: "15번 라울 삼십 오만 원" → 결과 5에서 350,000원 하나, 어떤 요청에도 30000·50000 없음', async ({ page }) => {
  await setupV3(page)
  const bodies = recordAllBodies(page)
  const writes = recordWrites(page)
  await expectRegisteredAt(page, writes, '15번 라울 삼십 오만 원', 5, [15, '라울', 350000])
  for (const body of bodies) {
    expect(body).not.toMatch(/"price":\s*30000\b/)
    expect(body).not.toMatch(/"price":\s*50000\b/)
  }
})

test('AC-V3-23 R9: "180번 30 5만 원" → 결과 4에서 180번 품종 미입력 350,000원, 30000·50000 없음', async ({ page }) => {
  await setupV3(page)
  const bodies = recordAllBodies(page)
  const writes = recordWrites(page)
  await expectRegisteredAt(page, writes, '180번 30 5만 원', 4, [180, '', 350000])
  for (const body of bodies) {
    expect(body).not.toMatch(/"price":\s*30000\b/)
    expect(body).not.toMatch(/"price":\s*50000\b/)
  }
})

const REGISTERS: readonly (readonly [string, string, number, readonly [number, string, number]])[] = [
  ['R10', '일육팔 삼광색금 이십오만 원', 4, [168, '삼광색금', 250000]],
  ['R11', '1 6 8번 라울 만원', 5, [168, '라울', 10000]],
  ['R31', '백육십팔 삼광색금 이십오만 원', 4, [168, '삼광색금', 250000]],
  ['R32', '168 삼광색금 25만 원', 4, [168, '삼광색금', 250000]],
  ['R33', '일육팔은 25만 원', 3, [168, '', 250000]],
  ['R36', '170 25만 원', 3, [170, '', 250000]],
  ['R43', '174 28만 원', 3, [174, '', 280000]],
]

for (const [id, sentence, k, expected] of REGISTERS) {
  test(`AC-V3-24 ${id}: "${sentence}" → 결과 ${String(k)}에서 ${String(expected[0])}번 ${String(expected[2])}원 등록 하나`, async ({ page }) => {
    await setupV3(page)
    const writes = recordWrites(page)
    await expectRegisteredAt(page, writes, sentence, k, expected)
  })
}

test('AC-V3-24 R12: "택배는 이삼 일 걸리고 만 원이에요" → 쓰기 0, 카드 0', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await sayChunk(page, '택배는 이삼 일 걸리고 만 원이에요')
  await settle(page)
  expect(productWrites(writes)).toEqual([])
  await expect(voiceCards(page)).toHaveCount(0)
})

// R39·R40: D-V3-54(앞 수와 합치기 — "1 5번" = 15번, "이십 오번" = 25번) + D-V3-46(가격 뒤 번호 꼴은 덩어리 끝에 짝) → 덩어리 끝에 등록 하나
// (사례 표 R39·R40의 "쓰기 0"은 D-V3-54 전 기대 — spec-keeper 확인 요청)
for (const [id, sentence, no] of [['R39', '25만 원 1 5번', 15], ['R40', '25만 원 이십 오번', 25]] as const) {
  test(`AC-V3-24 ${id} (D-V3-54·46): "${sentence}" → 덩어리 끝에 ${String(no)}번 250,000원 등록 하나`, async ({ page }) => {
    await setupV3(page)
    const writes = recordWrites(page)
    await sayChunk(page, sentence)
    await expect.poll(() => productWrites(writes)).toEqual([['product.register', no, '', 250000]])
    await expect(voiceCards(page)).toHaveCount(0)
  })
}

// R41·R42 (D-V3-25·27): 자리가 겹치지 않는 앞 수·띄어 쓴 한글 한 글자 → 쓰기 0
const NO_WRITES: readonly (readonly [string, string, boolean])[] = [
  ['R41', '100 5만 원', true],
  ['R41', '이백 오만 원', true],
  ['R41', '육백 삼만원', true],
  ['R41', '자 300 2만 원', true],
  ['R42', '택배는 이 삼 일 걸리고 만 원이에요', true],
]

for (const [id, sentence, noCard] of NO_WRITES) {
  test(`AC-V3-24 ${id}: "${sentence}" → 쓰기 0${noCard ? ', 카드 0' : ''}`, async ({ page }) => {
    await setupV3(page)
    const writes = recordWrites(page)
    await sayChunk(page, sentence)
    await settle(page)
    expect(productWrites(writes)).toEqual([])
    if (noCard) await expect(voiceCards(page)).toHaveCount(0)
  })
}

// D-V3-64: 300만 원 상한이 없어졌다 — 분명히 들은 등록은 크기와 상관없이 바로(기록에 "크게 바뀜")
test('AC-V3-24 R46 (D-V3-64): "38번 605만 원까지" → 결과 3(원)에서 38번 품종 미입력 6,050,000원 바로 등록, 카드 없음', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await expectRegisteredAt(page, writes, '38번 605만 원까지', 3, [38, '', 6050000])
})

// D-V3-41 (AC-V3-51): 확정된 번호가 없으면 카드 없이 기록만 — 가격 뒤 '번' 없는 번호(R34·R44)·번호 없음(R35·R50)
const LOG_ONLY: readonly (readonly [string, string, string])[] = [
  ['R34', '자 9cm에 이거 25만 원 170', '번호가 가격 뒤에 들렸어요'],
  ['R44', '요 아이는 65만 원까지 자 색감이 이렇게 예쁘게 나왔네요 자 60 어 자', '번호가 가격 뒤에 들렸어요'],
  ['R35', '삼광색금 3강 25만 원', '번호를 못 들었어요'],
  ['R50', '칠만 원', '번호를 못 들었어요'],
  ['R50', '핑크문 만원', '번호를 못 들었어요'],
]

for (const [id, sentence, why] of LOG_ONLY) {
  test(`AC-V3-24·51 ${id}: "${sentence}" → 쓰기 0, 카드 0, 기록 "${why}" (D-V3-41)`, async ({ page }) => {
    await setupV3(page)
    const writes = recordWrites(page)
    await sayChunk(page, sentence)
    await settle(page)
    expect(productWrites(writes)).toEqual([])
    await expect(voiceCards(page)).toHaveCount(0)
    const dlg = await openLog(page)
    await expect(dlg.getByRole('list', { name: '음성 기록 목록' }).getByRole('listitem').first()).toContainText(why)
  })
}

test('AC-V3-24 R37 (켬, D-V3-44): "15번 라울 174 28만 원" → 쓰기 0, 카드 0, 기록 "가격을 못 들었어요"', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await sayChunk(page, '15번 라울 174 28만 원')
  await settle(page)
  expect(productWrites(writes)).toEqual([])
  await expect(voiceCards(page)).toHaveCount(0)
  const dlg = await openLog(page)
  await expect(dlg.getByRole('list', { name: '음성 기록 목록' }).getByRole('listitem').first()).toContainText('가격을 못 들었어요')
})

test('AC-V3-24 R37 (설정 끔): "15번 라울 174 28만 원" → 쓰기 0, 카드 "15번 라울 가격 없음"', async ({ page }) => {
  await setupV3(page, { settings: { 'voice.autoRegister': false } }) // 설정 끔 (D-V3-44: 켬이면 원 없는 결과는 카드가 없다)
  const writes = recordWrites(page)
  await sayChunk(page, '15번 라울 174 28만 원')
  await settle(page)
  expect(productWrites(writes)).toEqual([])
  await expect(voiceCards(page)).toHaveCount(1)
  await expect(card(page, '15번 라울 가격 없음')).toBeVisible()
})

// R52 (켬, D-V3-44·67): 번호만·원 없는 가격 → 그때 화면 카드 0·쓰기 0, 그 번호는 기다리는 번호 — 60초가 지나면 "가격 못 들은 번호" 카드
for (const [sentence, no] of [['이 10번 오타 하나 지우신 거예요 아 그런가요', 10], ['15번 핑크프릴 만오천', 15]] as const) {
  test(`AC-V3-28·72 R52 (켬): "${sentence}" → 쓰기 0, 카드 0, 60초 뒤 카드 "${String(no)}번 가격을 못 들었어요"`, async ({ page }) => {
    await setupV3(page)
    const writes = recordWrites(page)
    await sayChunk(page, sentence)
    await settle(page)
    expect(productWrites(writes)).toEqual([])
    await expect(voiceCards(page)).toHaveCount(0)
    await page.clock.runFor(61_000)
    await expect(voiceCards(page).filter({ hasText: `${String(no)}번 가격을 못 들었어요` })).toHaveCount(1)
    expect(productWrites(writes)).toEqual([])
  })
}

test('AC-V3-28·51 R53 (설정 끔): "15번" → V2 카드 "15번 — 품종·가격을 말해 주세요"', async ({ page }) => {
  await setupV3(page, { settings: { 'voice.autoRegister': false } }) // 설정 끔 (D-V3-44: 켬이면 원 없는 결과는 카드가 없다)
  const writes = recordWrites(page)
  await sayChunk(page, '15번')
  await expect(voiceCards(page)).toHaveCount(1)
  await expect(voiceCards(page).first()).toContainText('15번')
  await expect(voiceCards(page).first()).toContainText('품종·가격을 말해 주세요')
  await settle(page)
  expect(productWrites(writes)).toEqual([])
})

test('AC-V3-24 R38: "백 육십팔 라울 만원" → 쓰기 0, 카드 없음 (68번으로 등록하지 않음)', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await sayChunk(page, '백 육십팔 라울 만원')
  await settle(page)
  expect(productWrites(writes)).toEqual([])
  await expect(voiceCards(page)).toHaveCount(0)
  await expect(boardItem(page, 68)).toHaveCount(0)
})

test('AC-V3-26 R21 (설정 끔): "15번 핑크프릴 만오천"(원 없음) → 카드 하나·쓰기 0·남은 초 글 없음, 빈 빠른 입력칸 Enter(1초 뒤)로 등록', async ({ page }) => {
  await setupV3(page, { settings: { 'voice.autoRegister': false } }) // 설정 끔 (D-V3-44: 켬이면 원 없는 결과는 카드가 없다)
  const writes = recordWrites(page)
  await sayChunk(page, '15번 핑크프릴 만오천')
  const c = card(page, '15번 핑크프릴 15,000원')
  await expect(c).toBeVisible()
  await expect(voiceCards(page)).toHaveCount(1)
  await page.clock.runFor(10_000)
  await settle(page)
  expect(productWrites(writes)).toEqual([])
  await expect(c.getByText(/초 뒤 자동 등록/)).toHaveCount(0)
  await expect(cardButton(page, '15번 핑크프릴 15,000원', '자동 등록 멈추기')).toHaveCount(0)
  const quick = page.getByLabel('빠른 입력')
  await quick.focus()
  await quick.press('Enter')
  await expect(boardItem(page, 15)).toContainText('15,000원')
  expect(productWrites(writes)).toEqual([['product.register', 15, '핑크프릴', 15000]])
})

test('AC-V3-26 R21 (설정 끔): 카드의 "등록"을 누르면 등록 하나', async ({ page }) => {
  await setupV3(page, { settings: { 'voice.autoRegister': false } }) // 설정 끔 (D-V3-44: 켬이면 원 없는 결과는 카드가 없다)
  const writes = recordWrites(page)
  await sayChunk(page, '15번 핑크프릴 만오천')
  await cardButton(page, '15번 핑크프릴 15,000원', '등록').click()
  await expect(boardItem(page, 15)).toContainText('15,000원')
  expect(productWrites(writes)).toEqual([['product.register', 15, '핑크프릴', 15000]])
})

test('AC-V3-29 R27 (설정 끔): "19번 선버스 팔천"(원 없음, 선버스 한 번 → 추측 없음 D-V3-30) → 카드 "19번 품종 미입력 8,000원" + 후보 단추 "선버스트", 누르면 선버스트', async ({ page }) => {
  await setupV3(page, { settings: { 'voice.autoRegister': false } }) // 설정 끔 (D-V3-44: 켬이면 원 없는 결과는 카드가 없다)
  const writes = recordWrites(page)
  await sayChunk(page, '19번 선버스 팔천')
  const c = card(page, '19번 품종 미입력 8,000원')
  await expect(c).toBeVisible()
  const pick = c.getByRole('button', { name: '선버스트', exact: true })
  await expect(pick).toBeVisible()
  await pick.click()
  await expect(card(page, '19번 선버스트 8,000원')).toBeVisible()
  await settle(page)
  expect(productWrites(writes)).toEqual([])
})

test('AC-V3-29 R28 (설정 끔, D-V3-37): "15번 <b>bts</b> <b>bts</b> 만오천" → 카드 "15번 품종 미입력 15,000원" + 후보 단추 <b>bts</b>(글자 그대로), 누르면 품종 <b>bts</b>', async ({ page }) => {
  await setupV3(page, { settings: { 'voice.autoRegister': false } }) // 설정 끔 (D-V3-44: 켬이면 원 없는 결과는 카드가 없다)
  const writes = recordWrites(page)
  await sayChunk(page, '15번 <b>bts</b> <b>bts</b> 만오천')
  const c = card(page, '15번 품종 미입력 15,000원')
  await expect(c).toBeVisible()
  const pick = c.getByRole('button', { name: '<b>bts</b>', exact: true })
  await expect(pick).toBeVisible()
  await expect(page.locator('b').filter({ hasText: 'bts' })).toHaveCount(0)
  await pick.click()
  await expect(card(page, '15번 <b>bts</b> 15,000원')).toBeVisible()
  await expect(page.locator('b').filter({ hasText: 'bts' })).toHaveCount(0)
  await settle(page)
  expect(productWrites(writes)).toEqual([])
})

test('AC-V3-29 R49 (D-V3-37): 사전 밖 낱말을 되풀이해도 바로 등록 품종은 비고, 시험 동안 요청 본문의 name은 사전 이름이거나 ""뿐', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await sayChunk(page, '자 컬러풀 이렇게 약간 컬러풀 하죠 네 10만 원 75번입니다')
  await expect(boardItem(page, 75)).toBeVisible()
  expect(productWrites(writes)).toEqual([['product.register', 75, '', 100000]])
  await page.clock.runFor(6000)
  await sayChunk(page, '108번 bts bts 10만 원')
  await expect(boardItem(page, 108)).toBeVisible()
  await page.clock.runFor(6000)
  await sayChunk(page, '108번 bts bts 12만 원')
  await expect(boardItem(page, 108)).toContainText('120,000원')
  for (const w of writes.filter((x) => x.type.startsWith('product.'))) {
    if ('name' in w.body) expect(['', '핑크프릴']).toContain(w.body['name'])
  }
})

test('AC-V3-50 (D-V3-38·40): 저장된 배운 별칭 보니까→보니타는 읽지 않는다 — "15번 보니까 만오천 원"은 품종 미입력으로 등록', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('livejjim.voiceLearnedAliases', JSON.stringify([{ heard: '보니까', name: '보니타', usedAt: 1_760_000_000_000 }]))
    } catch {
      // 첫 페이지는 저장소가 없다
    }
  })
  await setupV3(page)
  const writes = recordWrites(page)
  await sayChunk(page, '15번 보니까 만오천 원')
  await expect(boardItem(page, 15)).toBeVisible()
  expect(productWrites(writes)).toEqual([['product.register', 15, '', 15000]])
})
