// V3 설정·안내·미룸·여러 기기·휴대폰 폭 (AC-V3-38·40~46·49). 문장은 D-V3-17 글자 그대로.
import { test, expect, type Route } from '@playwright/test'
import { loginNewSeller } from '../i3/support.ts'
import {
  boardItem,
  card,
  cardButton,
  scopeView,
  installFakeSpeech,
  instantBox,
  notice,
  notices,
  openExtras,
  openLog,
  openNewBroadcast,
  productWrites,
  quietField,
  readout,
  recordWrites,
  sayChunk,
  sayWords,
  settle,
  setupV3,
  speak,
  turnOnVoice,
  uniqueDate,
  voiceCards,
  QUIET_MS,
  SETTINGS_KEY,
} from './support.ts'

const BROADCAST_1 = '네 108번 bts 어 요한이 10만 원까지 안토 일단 색감 안쪽 봐주세요'
const BROADCAST_2 = '자 bts는 자 bts 요거 그대로 보냅니다 요 아이 자 10만 원 108번'
const HELP = "'○○번'과 '○○원'이 들리면 그 자리에서 등록해요. 같은 번호를 다시 말하면 새로 만들지 않고, 찜이 없는 상품은 들은 대로 고쳐요. 등록 뒤 5초 안에 되돌릴 수 있어요."

test('AC-V3-40: 음성 설정에 "번호와 가격이 들리면 바로 등록"(처음 체크)·도움말, "기다리는 시간(초)" 없음. 끄면 새로 고친 뒤에도 꺼짐', async ({ page }) => {
  await setupV3(page)
  const box = await instantBox(page)
  await expect(box).toBeChecked()
  const extras = await openExtras(page)
  await expect(extras.getByText(HELP, { exact: true })).toBeVisible()
  await expect(extras.getByLabel('기다리는 시간(초)')).toHaveCount(0)
  await expect(extras.getByText('기다리는 시간', { exact: false })).toHaveCount(0)
  await box.uncheck()
  await expect(box).not.toBeChecked()
  const stored = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? 'null') as unknown, SETTINGS_KEY)
  expect(stored).toMatchObject({ 'voice.autoRegister': false })
  await page.clock.resume()
  await page.reload()
  await turnOnVoice(page)
  await expect(await instantBox(page)).not.toBeChecked()
  // 다시 켜면 켬으로 남는다
  await (await instantBox(page)).check()
  await page.reload()
  await turnOnVoice(page)
  await expect(await instantBox(page)).toBeChecked()
})

test('AC-V3-40: 옛 저장값 {autoConfirm:false, autoConfirmSec:5, quietMs:2500} → 켜진 채 시작, 조용한 시간 2.5초', async ({ page }) => {
  await setupV3(page, { settings: { 'voice.autoConfirm': false, 'voice.autoConfirmSec': 5, 'voice.quietMs': 2500 } })
  await expect(await instantBox(page)).toBeChecked()
  await expect(await quietField(page)).toHaveValue('2.5')
  const writes = recordWrites(page)
  await sayWords(page, '108번 bts 10만 원')
  await expect.poll(() => productWrites(writes)).toEqual([['product.register', 108, '', 100000]])
})

test('AC-V3-41 R30: 설정 끔 — 실제 방송 1은 카드 "108번 품종 미입력 100,000원"만(쓰기 0, D-V3-30), 등록 뒤 방송 2는 무시(카드 없음), "108번 12만 원"은 까닭 줄 없는 묻기', async ({ page }) => {
  await setupV3(page, { settings: { 'voice.autoRegister': false } })
  const writes = recordWrites(page)
  await sayChunk(page, BROADCAST_1)
  const c = card(page, '108번 품종 미입력 100,000원')
  await expect(c).toBeVisible()
  await expect(voiceCards(page)).toHaveCount(1)
  await settle(page)
  expect(productWrites(writes)).toEqual([])
  await cardButton(page, '108번 품종 미입력 100,000원', '등록').click()
  await expect(boardItem(page, 108)).toBeVisible()
  expect(productWrites(writes)).toEqual([['product.register', 108, '', 100000]])
  await page.clock.runFor(6000)
  await sayChunk(page, BROADCAST_2)
  await expect(voiceCards(page)).toHaveCount(0)
  await settle(page)
  expect(productWrites(writes)).toHaveLength(1)
  await page.clock.runFor(1000)
  await sayChunk(page, '108번 12만 원')
  const ask = notice(page, '108번을 고칠까요? 가격 100,000원 → 120,000원')
  await expect(ask).toBeVisible()
  await expect(ask.getByText('저절로 고치지 않았어요')).toHaveCount(0)
  await settle(page)
  expect(productWrites(writes)).toHaveLength(1)
})

const FIRST_ON = '번호와 가격이 확실하지 않으면 카드로 보여 드려요. 카드를 확인하고 등록해요.'
const FIRST_OFF = '말한 번호·품종·가격을 카드로 보여 줘요. 카드를 확인하고 등록해야 상품이 생겨요.'
const INSTANT_LINE = '번호와 가격이 들리면 바로 등록돼요. 음성 설정에서 끌 수 있어요.'

test('AC-V3-42 (D-V3-36): 처음 켤 때(바로 등록 기본 켬) 안내 창 첫 줄이 바뀌고 그 아래 바로 등록 줄, 옛 첫 줄 없음, 나머지 줄 그대로', async ({ page }) => {
  await installFakeSpeech(page, { consent: false, autoRegister: true })
  await loginNewSeller(page)
  await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
  await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
  const dlg = page.getByRole('dialog', { name: '음성으로 상품 등록' })
  await expect(dlg).toBeVisible()
  const lines = dlg.locator('p')
  await expect(lines.nth(0)).toHaveText(FIRST_ON)
  await expect(lines.nth(1)).toHaveText(INSTANT_LINE)
  await expect(dlg).not.toContainText('카드를 확인하고 등록해야 상품이 생겨요.')
  await expect(dlg).toContainText('음성은 인식을 위해 브라우저의 음성 인식 서버(크롬은 구글, 아이폰은 애플)로 보내져요. 라이브지니는 음성을 녹음하거나 저장하지 않아요.')
  await expect(dlg).toContainText('다음에 브라우저가 마이크 사용을 물으면 "허용"을 눌러 주세요.')
})

test('AC-V3-42 (D-V3-36): 저장소에 바로 등록 끔이면 I4 첫 줄 그대로, 바로 등록 줄 없음', async ({ page }) => {
  await installFakeSpeech(page, { consent: false, autoRegister: true, settings: { 'voice.autoRegister': false } })
  await loginNewSeller(page)
  await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
  await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
  const dlg = page.getByRole('dialog', { name: '음성으로 상품 등록' })
  await expect(dlg).toBeVisible()
  await expect(dlg.locator('p').nth(0)).toHaveText(FIRST_OFF)
  await expect(dlg).not.toContainText(INSTANT_LINE)
  await expect(dlg).not.toContainText(FIRST_ON)
})

test('AC-V3-43 (e) (D-V3-35): 끈 채 R1을 말하고 판매 이력 2초 기다림 도중 켜면 쓰기 0·카드 하나, 다음 덩어리부터 바로 등록', async ({ page }) => {
  await installFakeSpeech(page, { consent: true, autoRegister: true, settings: { 'voice.autoRegister': false } })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.clock.install()
  await loginNewSeller(page)
  const waiting: Route[] = []
  let open = false
  await page.route((url) => url.pathname === '/api/days', async (route: Route) => {
    if (open) return route.fallback()
    waiting.push(route)
  })
  await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
  await turnOnVoice(page)
  const now = await page.evaluate(() => Date.now())
  await page.clock.pauseAt(now + 500)
  await expect.poll(() => waiting.length).toBe(1)
  const writes = recordWrites(page)
  await sayWords(page, BROADCAST_1) // 끈 채 말함
  await (await instantBox(page)).check()
  open = true
  for (const r of waiting.splice(0)) await r.fallback()
  await page.clock.runFor(QUIET_MS + 100)
  await expect(card(page, '108번 품종 미입력 100,000원')).toBeVisible()
  await expect(voiceCards(page)).toHaveCount(1)
  await page.clock.runFor(10_000)
  await settle(page)
  expect(productWrites(writes)).toEqual([])
  await expect(boardItem(page, 108)).toHaveCount(0)
  // 다음 덩어리는 켬 → 바로 등록
  await sayWords(page, '15번 핑크문 만원')
  await expect.poll(() => productWrites(writes)).toEqual([['product.register', 15, '핑크문', 10000]])
})

test('TE-V3-006 AC-V3-43 (a): 창(음성 기록)이 열린 동안 R1 → 쓰기 0, 창을 닫으면 그때 등록 하나', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await openLog(page)
  await sayChunk(page, BROADCAST_1)
  await settle(page)
  expect(productWrites(writes)).toEqual([])
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '음성 기록' })).toHaveCount(0)
  await expect.poll(() => productWrites(writes)).toEqual([['product.register', 108, '', 100000]])
  await expect(voiceCards(page)).toHaveCount(0)
})

test('AC-V3-43 (c): 결과 7을 받기 전에 음성을 끄면 쓰기 0', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await sayWords(page, '네 108번 bts 어 요한이 10만')
  await page.getByRole('button', { name: '음성 끄기', exact: true }).click()
  await page.clock.runFor(QUIET_MS + 100)
  await settle(page)
  expect(productWrites(writes)).toEqual([])
  await expect(boardItem(page, 108)).toHaveCount(0)
})

test('AC-V3-43 (d): 덩어리 도중 설정을 끈 덩어리는 바로 등록하지 않는다(카드)', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  const box = await instantBox(page)
  await speak(page, '네 108번 bts', { final: false })
  await box.uncheck()
  await page.clock.runFor(200)
  await speak(page, '네 108번 bts 10만 원')
  await page.clock.runFor(QUIET_MS + 100)
  await expect(voiceCards(page).filter({ hasText: '108번' })).toHaveCount(1)
  await settle(page)
  expect(productWrites(writes)).toEqual([])
  await expect(boardItem(page, 108)).toHaveCount(0)
})

test('AC-V3-44: 휴대폰 폭 375 — 알림·묻기 카드·가격 확인 카드가 가로로 넘치지 않고 단추 44px 이상, 영어 상태값 없음', async ({ page }) => {
  await setupV3(page, { width: 375 })
  await sayChunk(page, '189번 빅뱅금 50만 원 139번')
  // D-V3-45: 다른 번호 안내는 큰 글자 칸 4초(알림 카드 아님)
  await expect(readout(page)).toHaveText('189번으로 등록했는데 139번도 들렸어요. 맞는지 확인해 주세요.')
  await page.clock.runFor(6000)
  await sayChunk(page, '189번 60만 원')
  await expect(notice(page, '189번을 고쳤어요: 가격 500,000원 → 600,000원')).toBeVisible()
  await page.clock.runFor(1000)
  // D-V3-41·44: 번호 둘·번호만은 켬에서 카드가 없다 — 켬에서 남는 "가격 확인 필요" 카드(R46)로 본다
  await sayChunk(page, '38번 605만 원까지')
  await expect(page.getByText('가격 확인 필요')).toBeVisible()
  const width = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(width).toBeLessThanOrEqual(375)
  const region = page.getByRole('region', { name: '음성 등록' })
  for (const button of await region.getByRole('button').all()) {
    if (!(await button.isVisible())) continue
    const box = await button.boundingBox()
    expect(box?.height ?? 0, await button.innerText()).toBeGreaterThanOrEqual(44)
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(375)
  }
  const text = await region.innerText()
  for (const word of ['IGNORE', 'AUTO_FIX', 'ASK', 'CLAIMS', 'NOT_OPEN', 'HIGH', 'LOW']) expect(text).not.toContain(word)
  await expect(notices(page).getByRole('listitem').first()).toBeVisible()
})

test('AC-V3-46: 바로 등록·고치기 요청 본문엔 번호·품종·가격(과 요청 표시)만 — 받아쓴 글 없음', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await sayChunk(page, BROADCAST_1)
  await page.clock.runFor(6000)
  await sayChunk(page, '108번 12만 원')
  await expect.poll(() => productWrites(writes).length).toBe(2)
  for (const w of writes.filter((x) => x.type.startsWith('product.'))) {
    expect(Object.keys(w.body).sort()).toEqual(expect.arrayContaining(['b', 'no', 'requestId', 'type']))
    for (const key of Object.keys(w.body)) expect(['b', 'no', 'name', 'price', 'requestId', 'type']).toContain(key)
    const raw = JSON.stringify(w.body)
    for (const word of ['요한이', '원까지', '안토', '봐주세요', '12만']) expect(raw).not.toContain(word)
  }
})

test('AC-V3-49: "문자찜"이 든 결과는 바로 등록하지 않는다', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await sayChunk(page, '15번 문자찜 끝자리 1234 만원')
  await settle(page)
  expect(productWrites(writes)).toEqual([])
  await expect(readout(page).filter({ hasText: '등록했어요' })).toHaveCount(0)
})

test('AC-V3-38 R29: 같은 판매자 두 페이지(PC·휴대폰 폭)가 R1을 같이 들음 → 108번 하나, 늦은 페이지엔 창 없음·기록 "이미 등록됨"', async ({ page, context }) => {
  const { b, date } = await setupV3(page)
  const phone = await context.newPage()
  await installFakeSpeech(phone, { consent: true, autoRegister: true })
  await phone.setViewportSize({ width: 375, height: 812 })
  await phone.clock.install()
  await phone.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(phone.getByLabel('빠른 입력')).toBeVisible()
  await turnOnVoice(phone)
  const t = await phone.evaluate(() => Date.now())
  await phone.clock.pauseAt(t + 1000)
  await phone.clock.runFor(2500)
  const pcWrites = recordWrites(page)
  const phoneWrites = recordWrites(phone)
  const tokens = BROADCAST_1.split(' ')
  for (let k = 1; k <= tokens.length; k += 1) {
    const text = tokens.slice(0, k).join(' ')
    const final = k === tokens.length
    await speak(page, text, { final })
    await speak(phone, text, { final })
    await page.clock.runFor(200)
    await phone.clock.runFor(200)
  }
  await page.clock.runFor(QUIET_MS)
  await phone.clock.runFor(QUIET_MS)
  await expect(boardItem(page, 108)).toBeVisible()
  await expect(boardItem(phone, 108)).toBeVisible()
  const products = (await scopeView(page, date, true)).products.filter((p) => p.no === 108)
  expect(products).toHaveLength(1)
  const registers = [...productWrites(pcWrites), ...productWrites(phoneWrites)].filter((w) => w[0] === 'product.register')
  expect(registers.length).toBeGreaterThanOrEqual(1)
  expect(registers.every((w) => w[1] === 108)).toBe(true)
  // 고치기 쓰기 없음, 창 없음
  expect([...productWrites(pcWrites), ...productWrites(phoneWrites)].filter((w) => w[0] !== 'product.register')).toEqual([])
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(phone.getByRole('dialog')).toHaveCount(0)
  await expect(voiceCards(page)).toHaveCount(0)
  await expect(voiceCards(phone)).toHaveCount(0)
  // 늦은 페이지 = 등록 쓰기가 성공하지 않은 쪽. 둘 중 하나의 기록엔 "이미 등록됨"
  const logs: string[] = []
  for (const p of [page, phone]) {
    const dlg = await openLog(p)
    logs.push(await dlg.innerText())
    await p.keyboard.press('Escape')
  }
  expect(logs.some((l) => l.includes('이미 등록됨'))).toBe(true)
  await phone.close()
})
