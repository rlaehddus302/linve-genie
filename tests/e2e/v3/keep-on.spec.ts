// V3 켠 음성 유지(AC-V3-58, D-V3-52)·번호 옮기기(AC-V3-68 (b), D-V3-58)·판매 말투(AC-V3-73, D-V3-69)·판매자 채팅 읽기 없음(AC-V3-55, D-V3-68).
// 기대 문장은 acceptance·D-V3 글자 그대로.
import { test, expect, type Page } from '@playwright/test'
import { menuLink } from '../menu.ts'
import { pcmCounts } from '../app1/support.ts'
import {
  boardItem,
  claimOne,
  installFakeSpeech,
  notices,
  openLog,
  speak,
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
    // SRV1 (D-APP-22·D-APP-25 (3)): 인식은 서버 받아쓰기 — "멈추지 않음"은 마이크(합성 PCM)를 멈추지 않는 것으로 본다. 띠의 고지는 D-APP-08 문장
    const before = await pcmCounts(page)
    for (const name of ['설정', '구매자', '라벨']) {
      await menuLink(page, name).click()
      await expect(band(page)).toBeVisible()
      await expect(band(page)).toContainText('음성 듣는 중')
      await expect(band(page)).toContainText('라이브지니 받아쓰기 서버로 보내져요')
      await expect(band(page)).not.toContainText('구글')
      await expect(band(page).getByRole('button', { name: '끄기' })).toBeVisible()
    }
    const after = await pcmCounts(page)
    expect(after.stops, '마이크를 멈추지 않는다').toBe(before.stops)
    expect(after.openSockets, '서버 받아쓰기 흐름 그대로').toBe(before.openSockets)
    await page.goBack()
    await page.goBack()
    await page.goBack()
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    await expect(voiceRegion(page).getByRole('status').filter({ hasText: '음성: 듣는 중' })).toBeVisible()
    await expect(band(page)).toHaveCount(0)
  })

  // R1의 bts = 사전 이름 BTS (D-V3-86, 수용 기준 표 R1) — 띠 문장도 큰 글자 칸과 같은 "108번 BTS 100,000원 등록했어요"
  test('TE-V3-015 (b) (D-V3-86): 설정 화면에서 R1을 말하면 켠 방송에 108번 BTS 100,000원 바로 등록, 띠에 "108번 BTS 100,000원 등록했어요"와 되돌리기(누르면 되돌림)', async ({ page }) => {
    await setupV3(page)
    await menuLink(page, '설정').click()
    await expect(band(page)).toBeVisible()
    const writes = recordWrites(page)
    await sayChunk(page, BROADCAST_1)
    await expect.poll(() => productWrites(writes)).toEqual([['product.register', 108, 'BTS', 100000]])
    await expect(band(page)).toContainText('108번 BTS 100,000원 등록했어요')
    const undo = band(page).getByRole('button', { name: /되돌리기/ })
    await expect(undo).toBeVisible()
    await undo.click()
    await expect.poll(() => productWrites(writes)).toEqual([['product.register', 108, 'BTS', 100000], ['product.close', 108]])
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
    // SRV1 (D-APP-25 (3)): 멈춤 = 마이크를 멈추고 서버 받아쓰기 흐름을 닫는다
    const before = await pcmCounts(page)
    await band(page).getByRole('button', { name: '끄기' }).click()
    await expect(band(page)).toHaveCount(0)
    await expect.poll(async () => (await pcmCounts(page)).stops, { message: '마이크 멈춤' }).toBeGreaterThan(before.stops)
    await expect.poll(async () => (await pcmCounts(page)).openSockets, { message: '받아쓰기 흐름 닫힘' }).toBe(0)
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

test.describe('AC-V3-74 (d) 가격 단위 자동 (D-V3-70)', () => {
  for (const [id, sentence, expected, k] of [
    ['R85', '150번 180', [150, '', 180000], 0],
    ['R86', '육십팔번 이십오', [68, '', 250000], 0],
    ['R87', '148번 라울 280 갑니다 자', [148, '라울', 280000], 5],
  ] as const) {
    test(`${id}: 자동 단위 방송 "${sentence}" → ${String(expected[0])}번 ${String(expected[2])}원`, async ({ page }) => {
      await setupV3(page, { sellerSettings: { 'price.unit': 'AUTO' } })
      const writes = recordWrites(page)
      if (k === 0) {
        // 품종 없는 빠른 꼴은 최종·덩어리 끝에서
        await sayChunk(page, sentence)
        await expect.poll(() => productWrites(writes)).toEqual([['product.register', ...expected]])
      } else {
        await sayWords(page, sentence, {
          afterEach: async (i) => {
            if (i === k) await expect.poll(() => productWrites(writes)).toEqual([['product.register', ...expected]])
          },
        })
        await page.clock.runFor(QUIET_MS + 100)
        await settle(page)
        expect(productWrites(writes)).toEqual([['product.register', ...expected]])
      }
    })
  }
})

test.describe('AC-V3-75 중간 결과 안정 (D-V3-71, 천원 단위)', () => {
  // 적용 안 함: D-REL1-02 — R89·R90은 중간 결과가 1,000ms 바뀌지 않으면 등록하는 "굳은 중간 글"(D-V3-71)이라 SRV1부터 없다.
  // 대신: 최종 결과가 오기 전엔 쓰기 0, 최종 결과가 오면 그 값으로 하나, 기록에 "중간 글로 등록"은 생기지 않는다.
  test('R89 → D-REL1-02: 적용 안 함(굳은 중간 글) — 최종 결과 "148번 280" → 148번 280,000원 하나, 기록에 "중간 글로 등록" 없음', async ({ page }) => {
    await setupV3(page)
    const writes = recordWrites(page)
    await page.clock.runFor(1200)
    await settle(page)
    expect(productWrites(writes), '최종 결과 전에는 쓰기 없음').toEqual([])
    await speak(page, '148번 280')
    await expect.poll(() => productWrites(writes)).toEqual([['product.register', 148, '', 280000]])
    await page.clock.runFor(QUIET_MS + 100)
    await settle(page)
    expect(productWrites(writes)).toEqual([['product.register', 148, '', 280000]])
    const dlg = await openLog(page)
    await expect(dlg.getByRole('list', { name: '음성 기록 목록' })).not.toContainText('중간 글로 등록')
  })

  test('R90 → D-REL1-02: 적용 안 함(굳은 중간 글) — 최종 결과 "148번 280만" → 2,800,000원 하나(280,000원 쓰기 없음)', async ({ page }) => {
    await setupV3(page)
    const writes = recordWrites(page)
    await speak(page, '148번 280만')
    await expect.poll(() => productWrites(writes)).toEqual([['product.register', 148, '', 2800000]])
    await page.clock.runFor(QUIET_MS + 100)
    await settle(page)
    expect(productWrites(writes)).toEqual([['product.register', 148, '', 2800000]])
  })

  // 적용 안 함: D-REL1-02 — 중간 결과는 없다(아래 speak final:false는 서버 경로에서 아무것도 보내지 않음). 최종 결과에 가격이 없으면 등록 없음은 그대로
  test('R91: 중간 "148번 280"이 800ms뿐이고 최종에서 가격이 사라지면 148번 등록 없음', async ({ page }) => {
    await setupV3(page)
    const writes = recordWrites(page)
    await speak(page, '148번 280', { final: false })
    await page.clock.runFor(800)
    await speak(page, '148번 자 회장님들 자국 8번 캡처 떠 주시고요 132번')
    await page.clock.runFor(QUIET_MS + 100)
    await settle(page)
    expect(productWrites(writes).filter((w) => w[1] === 148)).toEqual([])
  })

  // 적용 안 함: D-REL1-02 — "중간 후보"가 없다. 대신 창이 열린 동안 온 최종 결과는 미뤄졌다가 창이 닫히면 등록된다(D-V3-71의 미룸은 그대로)
  test('R92 → D-REL1-02: 창이 열린 동안 최종 결과 "148번 280" → 쓰기 0, 창이 닫히면 148번 280,000원', async ({ page }) => {
    await setupV3(page)
    const writes = recordWrites(page)
    const dlg = await openLog(page)
    await speak(page, '148번 280')
    await page.clock.runFor(QUIET_MS + 100)
    await settle(page)
    expect(productWrites(writes).filter((w) => w[1] === 148)).toEqual([])
    await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)
    await expect.poll(() => productWrites(writes).filter((w) => w[1] === 148)).toEqual([['product.register', 148, '', 280000]])
  })

  // R93 (수용 기준 표, D-V3-83): 다른 가격을 한 번만 들으면 고치지 않고 묻기 카드·쓰기 0이고, "300,000원으로 고침"은 같은 말을 다른 조각에서
  // 60초 안에 한 번 더 들었을 때다. 같은 크롬 결과의 중간 글(280)과 최종 글(30만 원) 가격이 달라도 그 결과로는 바로 고치지 않는다(D-V3-103, AC-V3-94 (1)).
  test('R93 (D-V3-83·103): R89 뒤 같은 덩어리 최종 "148번 30만 원" → 280,000원 그대로·묻기 카드, 다른 조각에서 한 번 더 들으면 300,000원으로 고침', async ({ page }) => {
    await setupV3(page)
    const writes = recordWrites(page)
    // 적용 안 함: D-REL1-02 (중간 글 280 등록). D-REL1-04: 같은 덩어리 최종 결과 "148번 280" → "148번 30만 원"
    await speak(page, '148번 280')
    await expect.poll(() => productWrites(writes)).toEqual([['product.register', 148, '', 280000]])
    await page.clock.runFor(200)
    await speak(page, '148번 30만 원')
    const ask = notices(page).getByRole('listitem', { name: '148번을 고칠까요? 가격 280,000원 → 300,000원', exact: true })
    await page.clock.runFor(QUIET_MS + 100)
    await expect(ask).toBeVisible()
    await settle(page)
    expect(productWrites(writes)).toEqual([['product.register', 148, '', 280000]])
    await expect(boardItem(page, 148)).toContainText('280,000원')
    await page.clock.runFor(1000)
    await sayChunk(page, '148번 30만 원')
    await expect.poll(() => productWrites(writes)).toEqual([['product.register', 148, '', 280000], ['product.update', 148, 300000]])
    await expect(boardItem(page, 148)).toContainText('300,000원')
    await expect(ask).toHaveCount(0)
  })
})
