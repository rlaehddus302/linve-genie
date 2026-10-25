// V3 켠 음성 유지(AC-V3-58, D-V3-52)·번호 옮기기(AC-V3-68 (b), D-V3-58)·판매 말투(AC-V3-73, D-V3-69)·판매자 채팅 읽기 없음(AC-V3-55, D-V3-68).
// 기대 문장은 acceptance·D-V3 글자 그대로.
import { test, expect, type Page } from '@playwright/test'
import { menuLink } from '../menu.ts'
import {
  boardItem,
  claimOne,
  installFakeSpeech,
  notices,
  productWrites,
  readout,
  recordWrites,
  registerProduct,
  sayChunk,
  sayWords,
  settle,
  setupV3,
  speechCounts,
  uniqueDate,
  voiceRegion,
  QUIET_MS,
} from './support.ts'
import { loginNewSeller } from '../i3/support.ts'

const BROADCAST_1 = '네 108번 bts 어 요한이 10만 원까지 안토 일단 색감 안쪽 봐주세요'
const VOICE_OFF_AFTER_RELOAD = "음성이 꺼졌어요. '음성 켜기'를 눌러 다시 켜 주세요."

function band(page: Page) {
  return page.getByRole('region', { name: '음성 듣는 중' })
}

test.describe('AC-V3-58 켠 음성 유지 (D-V3-52)', () => {
  test('(a) 콘솔에서 켜고 설정 → 구매자 → 라벨에 갔다 돌아와도 인식을 멈추지 않고 "듣는 중", 콘솔 밖엔 띠(듣는 중·외부 전송 고지·끄기)', async ({ page }) => {
    await setupV3(page)
    const before = await speechCounts(page)
    for (const name of ['설정', '구매자', '라벨']) {
      await menuLink(page, name).click()
      await expect(band(page)).toBeVisible()
      await expect(band(page)).toContainText('음성 듣는 중')
      await expect(band(page)).toContainText('구글·애플로 보내져요')
      await expect(band(page).getByRole('button', { name: '끄기' })).toBeVisible()
    }
    const after = await speechCounts(page)
    expect(after.stops + after.aborts).toBe(before.stops + before.aborts)
    await page.goBack()
    await page.goBack()
    await page.goBack()
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    await expect(voiceRegion(page).getByRole('status').filter({ hasText: '음성: 듣는 중' })).toBeVisible()
    await expect(band(page)).toHaveCount(0)
  })

  test('TE-V3-015 (b) 설정 화면에서 R1을 말하면 켠 방송에 108번 100,000원 바로 등록, 띠에 "108번 100,000원 등록했어요"와 되돌리기(누르면 되돌림)', async ({ page }) => {
    await setupV3(page)
    await menuLink(page, '설정').click()
    await expect(band(page)).toBeVisible()
    const writes = recordWrites(page)
    await sayChunk(page, BROADCAST_1)
    await expect.poll(() => productWrites(writes)).toEqual([['product.register', 108, '', 100000]])
    await expect(band(page)).toContainText('108번 100,000원 등록했어요')
    const undo = band(page).getByRole('button', { name: /되돌리기/ })
    await expect(undo).toBeVisible()
    await undo.click()
    await expect.poll(() => productWrites(writes)).toEqual([['product.register', 108, '', 100000], ['product.close', 108]])
  })

  test('TE-V3-016 (c) 설정 화면에서 묻기 카드가 생기면 띠에 "확인할 카드 1장 · 보기"(누르면 콘솔, 카드가 있다), 콘솔 밖 문자찜은 저절로 넣지 않는다', async ({ page }) => {
    await setupV3(page, {
      before: async ({ b }) => {
        await registerProduct(page, b, 108, 'bts', 100000)
        await expect(boardItem(page, 108)).toBeVisible()
      },
    })
    await menuLink(page, '설정').click()
    await expect(band(page)).toBeVisible()
    const writes = recordWrites(page)
    // '번' 없는 번호로 들은 같은 번호 → 묻기(R48, D-V3-32)
    await sayChunk(page, '108 12만 원 자')
    const view = band(page).getByRole('button', { name: '확인할 카드 1장 · 보기' })
    await expect(view).toBeVisible()
    await sayChunk(page, '15번 문자찜 끝자리 1234')
    await page.clock.runFor(10_000)
    await settle(page)
    expect(writes.filter((w) => w.type === 'sms')).toEqual([])
    expect(productWrites(writes)).toEqual([])
    await band(page).getByRole('button', { name: /^확인할 카드 \d+장 · 보기$/ }).click()
    await expect(page.getByLabel('빠른 입력')).toBeVisible()
    await expect(notices(page).getByRole('listitem', { name: /^108번을 고칠까요\? 가격 100,000원 → 120,000원/ })).toBeVisible()
    await expect(page.getByRole('list', { name: '음성 카드' }).getByRole('listitem').filter({ hasText: '문자찜' })).toHaveCount(1)
  })

  test('(d) 띠의 [끄기]면 인식이 멈추고 띠가 사라진다', async ({ page }) => {
    await setupV3(page)
    await menuLink(page, '설정').click()
    await expect(band(page)).toBeVisible()
    const before = await speechCounts(page)
    await band(page).getByRole('button', { name: '끄기' }).click()
    await expect(band(page)).toHaveCount(0)
    const after = await speechCounts(page)
    expect(after.stops + after.aborts).toBeGreaterThan(before.stops + before.aborts)
  })

  test('(e) 켠 채 새로 고침 — 마이크 권한이 granted면 안내 창 없이 다시 켜진다', async ({ page, context }) => {
    await context.grantPermissions(['microphone'])
    await setupV3(page)
    await page.clock.resume()
    await page.reload()
    await expect(page.getByLabel('빠른 입력')).toBeVisible()
    await expect(voiceRegion(page).getByRole('status').filter({ hasText: '음성: 듣는 중' })).toBeVisible()
    await expect(page.getByRole('dialog', { name: '음성으로 상품 등록' })).toHaveCount(0)
  })

  test('(e) 켠 채 새로 고침 — 권한 조회가 granted가 아니면 켜지지 않고 "음성이 꺼졌어요…"', async ({ page }) => {
    await setupV3(page)
    await page.clock.resume()
    await page.reload()
    await expect(page.getByLabel('빠른 입력')).toBeVisible()
    await expect(page.getByText(VOICE_OFF_AFTER_RELOAD, { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '음성 켜기', exact: true })).toBeVisible()
    expect((await speechCounts(page)).instances).toBe(0)
  })

  test('(f) 켠 채 다른 방송 B 콘솔 → 안내와 [그 방송으로 가기], B엔 음성 등록이 생기지 않는다 / (g) 기기 저장소엔 받아쓴 글이 없다', async ({ page }) => {
    const { b: a } = await setupV3(page)
    // 같은 앱 안에서 B 콘솔로 (새로 고침이 아니다 — 새로 고침은 (e))
    const res = await page.request.post('/api/broadcasts', { data: { requestId: crypto.randomUUID(), date: uniqueDate(), rehearsal: true }, headers: { Origin: new URL(page.url()).origin } })
    const body = (await res.json()) as Record<string, unknown>
    const other = ((body['result'] as Record<string, unknown> | undefined)?.['b'] ?? (body['broadcast'] as Record<string, unknown> | undefined)?.['id'] ?? body['b'] ?? body['id']) as string
    await page.evaluate((id) => {
      window.history.pushState(null, '', `/broadcasts/${encodeURIComponent(id)}`)
      dispatchEvent(new PopStateEvent('popstate'))
    }, other)
    await expect(page.getByLabel('빠른 입력')).toBeVisible()
    await expect(page.getByText(/^음성은 '.+' 방송에서 듣는 중이에요\. 여기서 쓰려면 그 방송에서 끄고 여기서 켜 주세요\.$/)).toBeVisible()
    const go = page.getByRole('button', { name: '그 방송으로 가기' }).or(page.getByRole('link', { name: '그 방송으로 가기' }))
    await expect(go).toBeVisible()
    const writes = recordWrites(page)
    await sayChunk(page, '16번 라울 만원')
    await settle(page)
    // 들은 말은 켠 방송 A의 것 — 쓰기가 있으면 A로만
    for (const w of writes.filter((x) => x.type.startsWith('product.'))) expect(w.body['b']).toBe(a)
    await expect(boardItem(page, 16)).toHaveCount(0)
    const stored = await page.evaluate(() => JSON.stringify({ ...window.localStorage }) + JSON.stringify({ ...window.sessionStorage }))
    for (const word of ['요한이', '봐주세요', '10만 원까지']) expect(stored).not.toContain(word)
  })
})

test.describe('AC-V3-68 (b) 번호 옮기기 (D-V3-58)', () => {
  test('65번 30,000원(찜 0) 등록 뒤 "아까 65번은 61번이에요" → 번호 바꾸기 하나, 4초 "65번을 61번으로 옮겼어요"와 [되돌리기]', async ({ page }) => {
    await setupV3(page)
    const writes = recordWrites(page)
    await sayChunk(page, '65번 3만 원')
    await expect(boardItem(page, 65)).toBeVisible()
    await page.clock.runFor(5000)
    await sayWords(page, '아까 65번은 61번이에요')
    await page.clock.runFor(QUIET_MS + 100)
    await expect(readout(page)).toHaveText('65번을 61번으로 옮겼어요')
    await expect.poll(() => writes.filter((w) => w.type === 'product.renumber').length).toBe(1)
    await expect(boardItem(page, 61)).toContainText('30,000원')
    await expect(boardItem(page, 65)).toHaveCount(0)
    await expect(page.getByRole('button', { name: /되돌리기/ }).first()).toBeVisible()
    expect(writes.filter((w) => w.type === 'product.register' || w.type === 'product.update').map((w) => w.type)).toEqual(['product.register'])
  })

  test('61번이 이미 있으면 쓰기 0과 "61번이 이미 있어 옮기지 않았어요"', async ({ page }) => {
    await setupV3(page, {
      before: async ({ b }) => {
        await registerProduct(page, b, 61, '라울', 10000)
        await expect(boardItem(page, 61)).toBeVisible()
      },
    })
    await sayChunk(page, '65번 3만 원')
    await expect(boardItem(page, 65)).toBeVisible()
    await page.clock.runFor(5000)
    const writes = recordWrites(page)
    await sayWords(page, '아까 65번은 61번이에요')
    await page.clock.runFor(QUIET_MS + 100)
    await expect(readout(page)).toHaveText('61번이 이미 있어 옮기지 않았어요')
    await settle(page)
    expect(productWrites(writes)).toEqual([])
  })

  test('TE-V3-017 65번에 찜이 있으면 쓰기 0과 "65번에 찜이 있어 번호를 옮기지 않았어요. 상품 목록에서 고쳐 주세요."', async ({ page }) => {
    const { b } = await setupV3(page)
    await sayChunk(page, '65번 3만 원')
    await expect(boardItem(page, 65)).toBeVisible()
    await claimOne(page, b, 65)
    await expect(boardItem(page, 65)).toContainText('찜손님')
    await page.clock.runFor(5000)
    const writes = recordWrites(page)
    await sayWords(page, '아까 65번은 61번이에요')
    await page.clock.runFor(QUIET_MS + 100)
    await expect(readout(page)).toHaveText('65번에 찜이 있어 번호를 옮기지 않았어요. 상품 목록에서 고쳐 주세요.')
    await settle(page)
    expect(productWrites(writes)).toEqual([])
  })

  test('등록 직후 같은 덩어리의 "아니 61번"도 옮긴다', async ({ page }) => {
    await setupV3(page)
    const writes = recordWrites(page)
    await sayChunk(page, '65번 3만 원 아니 61번')
    await expect.poll(() => writes.filter((w) => w.type === 'product.renumber').length).toBe(1)
    await expect(boardItem(page, 61)).toContainText('30,000원')
    await expect(boardItem(page, 65)).toHaveCount(0)
  })
})

test.describe('AC-V3-73 판매 말투 (D-V3-69, 천원 단위 — 새 판매자 기본)', () => {
  for (const [id, sentence, expected] of [
    ['R81', '150번 180 가겠습니다', [150, '', 180000]],
    ['R82', '150번 180입니다', [150, '', 180000]],
  ] as const) {
    test(`${id}: "${sentence}"(최종) → 덩어리 끝에 150번 180,000원`, async ({ page }) => {
      await setupV3(page)
      const writes = recordWrites(page)
      await sayChunk(page, sentence)
      await expect.poll(() => productWrites(writes)).toEqual([['product.register', ...expected]])
    })
  }

  test('R83: 중간 결과 "150번 180 가"만 → 쓰기 0(최종을 기다림)', async ({ page }) => {
    await setupV3(page)
    const writes = recordWrites(page)
    await sayWords(page, '150번 180 가', { final: false })
    await settle(page)
    expect(productWrites(writes)).toEqual([])
  })

  test('R84: "150번 라울 180 드릴게요 자" → 결과 5(자)에서 150번 라울 180,000원', async ({ page }) => {
    await setupV3(page)
    const writes = recordWrites(page)
    await sayWords(page, '150번 라울 180 드릴게요 자', {
      afterEach: async (k) => {
        if (k === 5) await expect.poll(() => productWrites(writes)).toEqual([['product.register', 150, '라울', 180000]])
      },
    })
    await page.clock.runFor(QUIET_MS + 100)
    await settle(page)
    expect(productWrites(writes)).toEqual([['product.register', 150, '라울', 180000]])
  })
})

test('AC-V3-55 (D-V3-68): 판매자 채팅 품종 읽기가 없다 — 판매자 품종 사전 조회 API가 없다', async ({ page }) => {
  await installFakeSpeech(page, { consent: true, autoRegister: true })
  await loginNewSeller(page)
  const res = await page.request.get('/api/voice/seller-names')
  expect(res.status()).toBe(404)
})
