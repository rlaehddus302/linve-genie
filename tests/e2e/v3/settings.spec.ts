// V3 설정·안내·미룸·여러 기기·휴대폰 폭 (AC-V3-38·40~46·49). 문장은 D-V3-17 글자 그대로.
import { test, expect } from '@playwright/test'
import { historyProbe, pcmCounts } from '../app1/support.ts'
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
  sayFirstOfTwo,
  sayWords,
  settle,
  setupV3,
  speak,
  turnOnVoice,
  uniqueDate,
  voiceCards,
  QUIET_MS,
  SETTINGS_KEY,
  voiceHeard,
  withoutVoiceHeard,
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

// bts = 사전 이름 BTS (D-V3-86 — 수용 기준 표 R1·R3, 실제 방송 1·2의 품종은 BTS)
test('AC-V3-40 (D-V3-86): 옛 저장값 {autoConfirm:false, autoConfirmSec:5, quietMs:2500} → 켜진 채 시작, 조용한 시간 2.5초', async ({ page }) => {
  await setupV3(page, { settings: { 'voice.autoConfirm': false, 'voice.autoConfirmSec': 5, 'voice.quietMs': 2500 } })
  await expect(await instantBox(page)).toBeChecked()
  await expect(await quietField(page)).toHaveValue('2.5')
  const writes = recordWrites(page)
  await sayWords(page, '108번 bts 10만 원')
  await expect.poll(() => productWrites(writes)).toEqual([['product.register', 108, 'BTS', 100000]])
})

test('AC-V3-41 R30 (D-V3-86): 설정 끔 — 실제 방송 1은 카드 "108번 BTS 100,000원"만(쓰기 0, D-V3-30), 등록 뒤 방송 2는 무시(카드 없음), "108번 12만 원"은 까닭 줄 없는 묻기', async ({ page }) => {
  await setupV3(page, { settings: { 'voice.autoRegister': false } })
  const writes = recordWrites(page)
  await sayChunk(page, BROADCAST_1)
  // R30의 처음 기대 "품종 미입력"은 bts가 사전 밖일 때 — 이제 사전 이름 BTS (D-V3-86)
  const c = card(page, '108번 BTS 100,000원')
  await expect(c).toBeVisible()
  await expect(voiceCards(page)).toHaveCount(1)
  await settle(page)
  expect(productWrites(writes)).toEqual([])
  await cardButton(page, '108번 BTS 100,000원', '등록').click()
  await expect(boardItem(page, 108)).toBeVisible()
  expect(productWrites(writes)).toEqual([['product.register', 108, 'BTS', 100000]])
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
/**
 * SRV1부터 PC 크롬 길이 없어(D-APP-22·D-APP-25, SPEC "크롬 받아쓰기 없음") 모든 기기의 첫 안내 창은 라이브지니 받아쓰기 창이다 —
 * 세 줄 그대로(D-APP-08, SPEC VOC-06 "고지·안내", APP1 acceptance "창에 세 줄 그대로"). 옛 I4·V3 첫 줄(D-V3-36)은 크롬 창의 줄이라 없다.
 */
const SERVER_CONSENT = [
  '음성 듣기를 켜면 이 기기 마이크 소리를 라이브지니 받아쓰기 서버로 보내 글로 바꿔요. 소리는 저장하지 않아요.',
  '와이파이에서 쓰세요. 휴대폰 데이터로는 1시간에 약 120MB를 써요.',
  '방송 동안 충전기를 꽂아 두세요.',
]

for (const [label, settings] of [['바로 등록 기본 켬', undefined], ['저장소에 바로 등록 끔', { 'voice.autoRegister': false }]] as const) {
  test(`AC-V3-42 → D-APP-08·D-APP-25 (${label}): 처음 켤 때 안내 창은 라이브지니 받아쓰기 세 줄 그대로, 크롬 창의 I4·V3 첫 줄·바로 등록 줄·구글 고지는 없다`, async ({ page }) => {
    await installFakeSpeech(page, { consent: false, autoRegister: true, ...(settings === undefined ? {} : { settings }) })
    await loginNewSeller(page)
    await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
    await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
    const dlg = page.getByRole('dialog', { name: '음성으로 상품 등록' })
    await expect(dlg).toBeVisible()
    await expect(dlg.locator('p')).toHaveText(SERVER_CONSENT)
    for (const old of [FIRST_ON, FIRST_OFF, INSTANT_LINE, '크롬은 구글', '브라우저가 마이크 사용을 물으면']) await expect(dlg).not.toContainText(old)
  })
}

test('AC-V3-43 (e) (D-V3-35·86): 끈 채 R1을 말하고 판매 이력 2초 기다림 도중 켜면 쓰기 0·카드 하나, 다음 덩어리부터 바로 등록', async ({ page }) => {
  await installFakeSpeech(page, { consent: true, autoRegister: true, settings: { 'voice.autoRegister': false } })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.clock.install()
  const seller = await loginNewSeller(page)
  await historyProbe(page, { loginId: seller.loginId, delayMs: 3000, reset: true })
  await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
  await turnOnVoice(page)
  const now = await page.evaluate(() => Date.now())
  await page.clock.pauseAt(now + 500)
  await expect.poll(async () => (await historyProbe(page, { loginId: seller.loginId })).pending).toBeGreaterThan(0)
  const writes = recordWrites(page)
  await sayWords(page, BROADCAST_1) // 끈 채 말함
  await (await instantBox(page)).check()
  await historyProbe(page, { loginId: seller.loginId, delayMs: 0 })
  await expect.poll(async () => (await historyProbe(page, { loginId: seller.loginId })).pending).toBe(0)
  expect((await historyProbe(page, { loginId: seller.loginId })).completed).toBeGreaterThan(0)
  await page.clock.runFor(QUIET_MS + 100)
  await expect(card(page, '108번 BTS 100,000원')).toBeVisible()
  await expect(voiceCards(page)).toHaveCount(1)
  await page.clock.runFor(10_000)
  await settle(page)
  expect(productWrites(writes)).toEqual([])
  await expect(boardItem(page, 108)).toHaveCount(0)
  // 다음 덩어리는 켬 → 바로 등록
  await sayWords(page, '15번 핑크문 만원')
  await expect.poll(() => productWrites(writes)).toEqual([['product.register', 15, '핑크문', 10000]])
})

test('TE-V3-006 AC-V3-43 (a) (D-V3-86): 창(음성 기록)이 열린 동안 R1 → 쓰기 0, 창을 닫으면 그때 등록 하나(108번 BTS)', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await openLog(page)
  await sayChunk(page, BROADCAST_1)
  await settle(page)
  expect(productWrites(writes)).toEqual([])
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '음성 기록' })).toHaveCount(0)
  await expect.poll(() => productWrites(writes)).toEqual([['product.register', 108, 'BTS', 100000]])
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

test('AC-V3-44: 휴대폰 폭 375 — 알림·가격 못 들은 번호 카드가 가로로 넘치지 않고 단추 44px 이상, 영어 상태값 없음', async ({ page }) => {
  await setupV3(page, { width: 375 })
  await sayChunk(page, '189번 빅뱅금 50만 원 139번')
  // D-V3-45·61: 다른 번호 안내는 큰 글자 칸 4초(알림 카드 아님) — 등록 안내 다음 차례
  await page.clock.runFor(2000)
  await expect(readout(page)).toHaveText('189번으로 등록했는데 139번도 들렸어요. 맞는지 확인해 주세요.')
  await page.clock.runFor(6000)
  // 가격 고침은 같은 말을 다른 조각에서 두 번 들었을 때 (D-V3-83) — 첫 번의 묻기 카드도 375px 안에 든다
  await sayFirstOfTwo(page, '189번 60만 원', '189번을 고칠까요? 가격 500,000원 → 600,000원')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  await sayChunk(page, '189번 60만 원')
  await expect(notice(page, '189번을 고쳤어요: 가격 500,000원 → 600,000원')).toBeVisible()
  await page.clock.runFor(1000)
  // 켬에서 남는 카드: "가격 못 들은 번호"(D-V3-67 — 가격 칸·[등록]·[닫기])
  await sayChunk(page, '15번')
  await page.clock.runFor(1000)
  await sayChunk(page, '16번 2만 원')
  await expect(page.getByText('15번 가격을 못 들었어요')).toBeVisible()
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

test('AC-V3-46 (D-V3-73·83): 바로 등록·고치기 요청 본문엔 번호·품종·가격(과 요청 표시·voiceLog)뿐 — 받아쓴 글은 voiceLog.heard 한 줄에만', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  await sayChunk(page, BROADCAST_1)
  await page.clock.runFor(6000)
  // 가격 고침 문턱 (D-V3-83): 같은 새 가격을 다른 조각에서 두 번 들어야 고치기 요청이 나간다
  await sayFirstOfTwo(page, '108번 12만 원', '108번을 고칠까요? 가격 100,000원 → 120,000원')
  await sayChunk(page, '108번 12만 원')
  await expect.poll(() => productWrites(writes).length).toBe(2)
  for (const w of writes.filter((x) => x.type.startsWith('product.'))) {
    expect(Object.keys(w.body).sort()).toEqual(expect.arrayContaining(['b', 'no', 'requestId', 'type']))
    for (const key of Object.keys(w.body)) expect(['b', 'no', 'name', 'price', 'requestId', 'type', 'voiceLog', 'applyTo']).toContain(key)
    const raw = withoutVoiceHeard(JSON.stringify(w.body))
    for (const word of ['요한이', '원까지', '안토', '봐주세요', '12만']) expect(raw).not.toContain(word)
  }
})

test('AC-V3-46·70 (D-V3-73·66·75): voiceLog.heard는 그 조각 글이고 끝자리 뒤 4자리는 ****', async ({ page }) => {
  await setupV3(page)
  const writes = recordWrites(page)
  // heard는 그 일을 만든 조각 글뿐(D-V3-75) — 가릴 말을 번호와 가격 사이에 둔다
  await sayChunk(page, '15번 핑크프릴 끝자리 1234 김민지님 만오천 원')
  await expect.poll(() => productWrites(writes).filter((w) => w[0] === 'product.register').length).toBe(1)
  const all = writes.filter((w) => w.type.startsWith('product.')).map((w) => voiceHeard(JSON.stringify(w.body)))
  expect(all.some((h) => h !== null)).toBe(true)
  for (const heard of all) {
    if (heard === null) continue
    expect(heard).not.toContain('1234')
    expect(heard).toContain('끝자리 ****')
    expect(heard.length).toBeLessThanOrEqual(300)
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

test('AC-V3-38 R29 → APP1-32/APP1b: 둘째 휴대폰 음성은 OTHER_DEVICE, 첫 기기 등록 하나·양쪽 반영·임의 고침 없음·손 입력 유지', async ({ page, context }) => {
  const { b, date } = await setupV3(page)
  const phone = await context.newPage()
  await installFakeSpeech(phone, { consent: true, autoRegister: true })
  await phone.setViewportSize({ width: 375, height: 812 })
  await phone.clock.install()
  await phone.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(phone.getByLabel('빠른 입력')).toBeVisible()
  const pcWrites = recordWrites(page)
  const phoneWrites = recordWrites(phone)
  await phone.getByRole('button', { name: '음성 켜기', exact: true }).click()
  await expect(phone.getByRole('region', { name: '음성 등록' })).toContainText('음성은 다른 기기에서 듣는 중이에요.')
  await phone.clock.runFor(10_000)
  expect((await pcmCounts(phone)).sockets).toBe(1)
  expect((await pcmCounts(phone)).starts).toBe(0)
  await sayChunk(page, BROADCAST_1)
  await expect(boardItem(page, 108)).toBeVisible()
  await expect(boardItem(phone, 108)).toBeVisible()
  const products = (await scopeView(page, date, true)).products.filter((p) => p.no === 108)
  expect(products).toHaveLength(1)
  expect(productWrites(pcWrites)).toEqual([['product.register', 108, 'BTS', 100000]])
  expect(productWrites(phoneWrites)).toEqual([])
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(phone.getByRole('dialog')).toHaveCount(0)
  await expect(voiceCards(page)).toHaveCount(0)
  await expect(voiceCards(phone)).toHaveCount(0)
  // 거절된 기기의 손 입력은 계속 쓰며 양쪽 화면에 반영된다.
  await phone.getByLabel('빠른 입력').fill('15 핑크프릴 10')
  await phone.getByLabel('빠른 입력').press('Enter')
  await expect(boardItem(phone, 15)).toContainText('10,000')
  await expect(boardItem(page, 15)).toBeVisible()
  // SRV1 (D-APP-24): 손 입력 등록 본문은 친 줄 원문 — 값은 서버가 읽어 보드에 15번 핑크프릴 10,000원
  expect(phoneWrites.filter((w) => w.type.startsWith('product.')).map((w) => [w.type, w.body['text']])).toEqual([['product.register', '15 핑크프릴 10']])
  await expect(boardItem(page, 15)).toContainText('핑크프릴')
  expect([...productWrites(pcWrites), ...productWrites(phoneWrites)].filter((w) => w[0] !== 'product.register')).toEqual([])
  await phone.close()
})
