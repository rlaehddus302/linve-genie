// FB1 설정 화면 흐름 (AC-FB1-90 설정 줄): 저장 막대 하나(AC-FB1-22~25), 가격 단위(AC-FB1-01), 상세 설정·예시·같은 1분(AC-FB1-06~08),
// 감사 켜기 체크 두 줄·영상 댓글 방식·묶는 시간 상세(AC-FB1-10·11), 택배사·직접 입력·택배 크기 다섯 낱말(AC-FB1-19), 개발 낱말 없음.
// 기대 문장은 harness/sprints/FB1/acceptance.md 따옴표 그대로.
import { expect, test, type Page } from '@playwright/test'
import {
  AUTO_BATCH,
  BATCH_LABEL,
  BOX_HINT,
  BOX_WORDS,
  DEV_WORDS,
  LEAVE_TEXT,
  LEAVE_TITLE,
  LIVE_CHAT_DESC,
  NO_AUTO_BOOK_HINT,
  NO_CHANGES,
  OLD_SHIPPING_LINE,
  RULES_NEXT,
  SAME_MINUTE,
  SAVED,
  SHIPPING_HINT,
  SHIPPING_NEXT,
  UNIT_HINT,
  VIDEO_COMMENT_DESC,
  dirtyLine,
  failedLine,
  loginNewSeller,
  parcelSettings,
  patchSettings,
  putParcelSettings,
  recordSaves,
  saveBar,
  saveButton,
  serverSettings,
  settingsRegion,
} from './support.ts'

const SENDER = { name: '다육이네', phone: '031-123-4567', address: '경기도 수원시 팔달구 효원로 1', detail: '1층', zip: '16490' }

async function openSettings(page: Page, opts: { sender?: boolean } = {}): Promise<void> {
  await loginNewSeller(page)
  if (opts.sender === true) await putParcelSettings(page, { sender: SENDER })
  await page.goto('/settings')
  await expect(saveBar(page)).toBeVisible()
  await expect(settingsRegion(page, '택배').getByRole('combobox', { name: '택배사' })).toBeVisible()
}

const thanks = (page: Page) => settingsRegion(page, '구매 감사 메시지')
const rules = (page: Page) => settingsRegion(page, '판매 규칙')
const parcel = (page: Page) => settingsRegion(page, '택배')

test.describe('AC-FB1-22·23 저장 막대 하나', () => {
  test('다섯 칸 안에 "저장" 없음, 바뀐 칸 없으면 잠김 → 다섯 칸을 고치면 블록 이름 차례 → 되돌리면 빠짐 → 한 번 저장(가게 → 설정 하나 → 택배, 두 번 눌러도 한 번) → 문장 둘과 위 가게 이름', async ({ page }) => {
    await openSettings(page)
    for (const title of ['가게', '판매 규칙', '배송비', '구매 감사 메시지', '택배']) {
      await expect(settingsRegion(page, title).getByRole('button', { name: '저장', exact: true }), title).toHaveCount(0)
    }
    await expect(saveBar(page)).toContainText(NO_CHANGES)
    await expect(saveButton(page)).toBeDisabled()

    await settingsRegion(page, '가게').getByLabel('가게 이름').fill('막대가게')
    await rules(page).getByLabel('대기 인원 (0이면 대기 없음)').fill('3')
    await settingsRegion(page, '배송비').getByLabel('기본 배송비 (원)').fill('3500')
    await thanks(page).getByRole('checkbox', { name: '영상 댓글에 감사 메시지 남기기' }).check()
    await parcel(page).getByRole('combobox', { name: '기본 택배 크기 (세 변의 합)' }).selectOption('100')
    await expect(saveBar(page)).toContainText(dirtyLine('가게', '판매 규칙', '배송비', '구매 감사 메시지', '택배'))
    await expect(saveButton(page)).toBeEnabled()

    // 되돌려 저장값과 같아지면 그 이름이 빠진다
    await parcel(page).getByRole('combobox', { name: '기본 택배 크기 (세 변의 합)' }).selectOption('80')
    await expect(saveBar(page)).toContainText(dirtyLine('가게', '판매 규칙', '배송비', '구매 감사 메시지'))
    await expect(saveBar(page)).not.toContainText('택배')
    await parcel(page).getByRole('combobox', { name: '기본 택배 크기 (세 변의 합)' }).selectOption('100')
    await expect(saveBar(page)).toContainText(dirtyLine('가게', '판매 규칙', '배송비', '구매 감사 메시지', '택배'))

    const saves = recordSaves(page)
    await saveButton(page).dblclick()
    await expect(saveBar(page).getByRole('status')).toHaveText(`${SAVED}${RULES_NEXT}${SHIPPING_NEXT}`)
    await expect(saveBar(page)).toContainText(NO_CHANGES)
    expect(saves.map((s) => `${s.method} ${s.path}`)).toEqual(['PUT /api/shop', 'PATCH /api/settings', 'PUT /api/parcels/settings'])
    expect(saves[1]!.body).toEqual({ settings: { 'waitlist.max': 3, 'shipping.baseFee': 3500, 'thanks.videoComment': 'PER_SALE' } })
    await expect(page.getByRole('banner').getByText('막대가게')).toBeVisible()
    const saved = await serverSettings(page)
    expect([saved['waitlist.max'], saved['shipping.baseFee'], saved['thanks.videoComment']]).toEqual([3, 3500, 'PER_SALE'])
    expect((await parcelSettings(page))['box']).toBe('100')
  })

  test('바뀌지 않은 블록의 요청은 없다 — 배송비만: PATCH 하나(그 키만)와 배송비 문장만', async ({ page }) => {
    await openSettings(page)
    const saves = recordSaves(page)
    await settingsRegion(page, '배송비').getByLabel('기본 배송비 (원)').fill('5000')
    await expect(saveBar(page)).toContainText(dirtyLine('배송비'))
    await saveButton(page).click()
    await expect(saveBar(page).getByRole('status')).toHaveText(`${SAVED}${SHIPPING_NEXT}`)
    expect(saves).toEqual([{ method: 'PATCH', path: '/api/settings', body: { settings: { 'shipping.baseFee': 5000 } } }])
    await expect(page.getByText(OLD_SHIPPING_LINE)).toHaveCount(0)
  })

  test('보내는 동안 "저장하는 중…"으로 잠기고 다시 눌러도 요청은 하나, 보내는 동안 고친 칸은 저장 뒤에도 "저장하지 않은 칸"에 남는다', async ({ page }) => {
    await openSettings(page)
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let patches = 0
    await page.route('**/api/settings', async (route) => {
      if (route.request().method() !== 'PATCH') return await route.fallback()
      patches += 1
      await gate
      await route.fallback()
    })
    const waitlist = rules(page).getByLabel('대기 인원 (0이면 대기 없음)')
    await waitlist.fill('3')
    await saveButton(page).click()
    const busy = saveBar(page).getByRole('button', { name: '저장하는 중…' })
    await expect(busy).toBeDisabled()
    await busy.click({ force: true })
    await expect.poll(() => patches).toBe(1)
    // 보내는 동안 같은 칸을 다시 고친다
    await waitlist.fill('4')
    release()
    await expect(saveBar(page).getByRole('button', { name: '저장', exact: true })).toBeVisible()
    await expect.poll(async () => (await serverSettings(page))['waitlist.max']).toBe(3)
    expect(patches).toBe(1)
    // 칸에는 4가 보이는데 저장된 값은 3 — 판매 규칙은 아직 저장하지 않은 칸이다 (조용히 사라지면 안 된다)
    await expect(waitlist).toHaveValue('4')
    await expect(saveBar(page)).toContainText(dirtyLine('판매 규칙'))
    await expect(saveButton(page)).toBeEnabled()
  })

  test('AC-FB1-24 일부 실패: 대기 인원 101 + 보내는 사람 이름 → 설정 400·택배 저장, 칸 옆 서버 문장, 막대 alert, 판매 규칙만 남음', async ({ page }) => {
    await openSettings(page, { sender: true })
    await rules(page).getByLabel('대기 인원 (0이면 대기 없음)').fill('101')
    const senderName = parcel(page).getByLabel('보내는 사람 이름')
    await senderName.fill('다육이네 보냄')
    await expect(saveBar(page)).toContainText(dirtyLine('판매 규칙', '택배'))
    await saveButton(page).click()
    await expect(saveBar(page).getByRole('alert')).toHaveText(failedLine('판매 규칙'))
    await expect(rules(page).getByText('0부터 100까지의 정수로 적어 주세요', { exact: false })).toBeVisible()
    await expect(rules(page).getByLabel('대기 인원 (0이면 대기 없음)')).toHaveValue('101')
    await expect(saveBar(page)).toContainText(dirtyLine('판매 규칙'))
    await expect(saveBar(page)).not.toContainText('택배')
    expect((await serverSettings(page))['waitlist.max']).toBe(5)
    const sender = (await parcelSettings(page))['sender'] as { name?: string } | null
    expect(sender?.name).toBe('다육이네 보냄')
    // 고쳐서 다시 저장 → 이미 저장된 택배는 다시 보내지 않는다
    const saves = recordSaves(page)
    await rules(page).getByLabel('대기 인원 (0이면 대기 없음)').fill('6')
    await saveButton(page).click()
    await expect(saveBar(page).getByRole('status')).toHaveText(`${SAVED}${RULES_NEXT}`)
    expect(saves).toEqual([{ method: 'PATCH', path: '/api/settings', body: { settings: { 'waitlist.max': 6 } } }])
  })

  test('AC-FB1-24 네트워크 실패도 같은 모양 (택배만 끊김)', async ({ page }) => {
    await openSettings(page, { sender: true })
    await page.route('**/api/parcels/settings', async (route) => {
      if (route.request().method() === 'PUT') await route.abort('internetdisconnected')
      else await route.fallback()
    })
    await parcel(page).getByLabel('보내는 사람 이름').fill('끊김 보냄')
    await rules(page).getByLabel('대기 인원 (0이면 대기 없음)').fill('2')
    await saveButton(page).click()
    await expect(saveBar(page).getByRole('alert')).toHaveText(failedLine('택배'))
    await expect(saveBar(page)).toContainText(dirtyLine('택배'))
    expect((await serverSettings(page))['waitlist.max']).toBe(2)
  })

  test('AC-FB1-25 떠나기 확인 그대로: 고친 칸이 있으면 메뉴 이동은 앱 창, 저장 뒤엔 창 없이 이동', async ({ page }) => {
    await openSettings(page)
    await rules(page).getByLabel('대기 인원 (0이면 대기 없음)').fill('4')
    await page.getByRole('navigation', { name: '메뉴' }).getByRole('link', { name: '구매자', exact: true }).click()
    const dlg = page.getByRole('dialog', { name: LEAVE_TITLE })
    await expect(dlg).toContainText(LEAVE_TEXT)
    await dlg.getByRole('button', { name: '닫기' }).click()
    await expect(page).toHaveURL(/\/settings$/)
    await saveButton(page).click()
    await expect(saveBar(page).getByRole('status')).toHaveText(`${SAVED}${RULES_NEXT}`)
    await page.getByRole('navigation', { name: '메뉴' }).getByRole('link', { name: '구매자', exact: true }).click()
    await expect(page).toHaveURL(/\/buyers/)
    await expect(dlg).toHaveCount(0)
  })

  test('라벨·로그인 방법 등 바로 저장 칸은 막대의 "바뀐 칸"에 들지 않는다', async ({ page }) => {
    await openSettings(page)
    for (const title of ['유튜브', '보조자', '로그인 방법', '그 밖']) {
      const region = settingsRegion(page, title)
      if ((await region.count()) === 0) continue
      await expect(saveBar(page)).toContainText(NO_CHANGES)
    }
    await expect(saveBar(page)).not.toContainText(/라벨|유튜브|보조자|로그인/)
  })
})

test.describe('AC-FB1-01·05~08 설정 문구', () => {
  test('가격 단위 두 개·만원 안내, 배송비 안내, 상세 설정 접힘, 여러 번호 예시, 같은 1분 낱말, 저장값 그대로', async ({ page }) => {
    await openSettings(page)
    const unit = rules(page).getByRole('radiogroup', { name: '가격 단위' })
    await expect(unit.getByRole('radio')).toHaveCount(2)
    await expect(unit.getByRole('radio', { name: '천원 (10 → 10,000원)' })).toBeChecked()
    await expect(unit.getByRole('radio', { name: '원 (10000 → 10,000원)' })).not.toBeChecked()
    await expect(rules(page).getByText(UNIT_HINT)).toBeVisible()
    await expect(settingsRegion(page, '배송비').getByText(SHIPPING_HINT)).toBeVisible()
    await expect(page.getByText(OLD_SHIPPING_LINE)).toHaveCount(0)

    const detail = rules(page).getByRole('button', { name: '상세 설정', exact: true })
    await expect(detail).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByText('더 보기 (잘 모르면 그대로 두세요)')).toHaveCount(0)
    await expect(rules(page).getByRole('radiogroup', { name: '주문 인식 방식' })).toBeHidden()
    await detail.click()
    await expect(detail).toHaveAttribute('aria-expanded', 'true')
    await expect(rules(page).getByText('잘 모르면 그대로 두세요.', { exact: true })).toBeVisible()
    await expect(rules(page).getByRole('radiogroup', { name: '주문 인식 방식' })).toBeVisible()

    const many = rules(page).getByRole('radiogroup', { name: '한 채팅에 번호가 여러 개면' })
    await expect(rules(page).getByText("예: 채팅 '15 28'", { exact: true })).toBeVisible()
    for (const name of ['모두 주문 (15번·28번 둘 다)', '첫 번호만 주문 (15번만)', '주문으로 보지 않아요']) await expect(many.getByRole('radio', { name, exact: true })).toHaveCount(1)
    await expect(page.locator('main')).not.toContainText(/예: @|'@/)
    const sameMinute = rules(page).getByRole('radiogroup', { name: SAME_MINUTE })
    for (const name of ['유튜브 먼저', '문자 먼저', '내가 정해요']) await expect(sameMinute.getByRole('radio', { name, exact: true })).toHaveCount(1)

    // 저장값은 그대로 THOUSAND·WON, FIRST 등
    const saves = recordSaves(page)
    await unit.getByRole('radio', { name: '원 (10000 → 10,000원)' }).check()
    await many.getByRole('radio', { name: '첫 번호만 주문 (15번만)', exact: true }).check()
    await saveButton(page).click()
    await expect(saveBar(page).getByRole('status')).toHaveText(`${SAVED}${RULES_NEXT}`)
    expect(saves.at(-1)!.body).toEqual({ settings: { 'price.unit': 'WON', 'claim.multiNumber': 'FIRST' } })
  })
})

test.describe('AC-FB1-10·11 감사 메시지 만들기', () => {
  test('켜기 체크 두 줄과 설명, 영상 댓글 방식은 켰을 때만, 처음 켜면 판매마다, 껐다 켜면 마지막 방식, 남기지 않음 없음', async ({ page }) => {
    await openSettings(page)
    const places = thanks(page).getByRole('group', { name: '감사 메시지를 남길 곳' })
    const live = places.getByRole('checkbox', { name: '실시간 채팅에 감사 메시지 남기기' })
    const video = places.getByRole('checkbox', { name: '영상 댓글에 감사 메시지 남기기' })
    await expect(live).toBeChecked()
    await expect(video).not.toBeChecked()
    await expect(places.getByText(LIVE_CHAT_DESC)).toBeVisible()
    await expect(places.getByText(VIDEO_COMMENT_DESC)).toBeVisible()
    await expect(thanks(page).getByRole('radiogroup', { name: '영상 댓글 방식' })).toHaveCount(0)
    await expect(thanks(page).getByText('남기지 않음')).toHaveCount(0)

    await video.check()
    const mode = thanks(page).getByRole('radiogroup', { name: '영상 댓글 방식' })
    await expect(mode.getByRole('radio', { name: '판매마다 댓글' })).toBeChecked()
    await mode.getByRole('radio', { name: '방송이 끝나고 요약 댓글 1개' }).check()
    await video.uncheck()
    await expect(mode).toHaveCount(0)
    await video.check()
    await expect(mode.getByRole('radio', { name: '방송이 끝나고 요약 댓글 1개' })).toBeChecked()
    const saves = recordSaves(page)
    await saveButton(page).click()
    await expect(saveBar(page).getByRole('status')).toHaveText(`${SAVED}${RULES_NEXT}`)
    expect(saves.at(-1)!.body).toEqual({ settings: { 'thanks.videoComment': 'SUMMARY' } })

    // 저장값 SUMMARY로 다시 열면 켜짐 + 요약
    await page.reload()
    await expect(thanks(page).getByRole('checkbox', { name: '영상 댓글에 감사 메시지 남기기' })).toBeChecked()
    await expect(thanks(page).getByRole('radiogroup', { name: '영상 댓글 방식' }).getByRole('radio', { name: '방송이 끝나고 요약 댓글 1개' })).toBeChecked()
    // 끄고 저장 → OFF
    await thanks(page).getByRole('checkbox', { name: '영상 댓글에 감사 메시지 남기기' }).uncheck()
    await saveButton(page).click()
    await expect(saveBar(page).getByRole('status')).toHaveText(`${SAVED}${RULES_NEXT}`)
    expect((await serverSettings(page))['thanks.videoComment']).toBe('OFF')
  })

  test('묶는 시간은 만들기 "상세 설정" 안, 자동 묶음 안내는 늘, 저장값 30이면 접힘 밖 한 줄, 0이면 없음, 범위 밖은 서버 문장(접힌 칸을 펴서)', async ({ page }) => {
    await openSettings(page)
    await expect(thanks(page).getByText(AUTO_BATCH)).toBeVisible()
    await expect(thanks(page).getByLabel(BATCH_LABEL)).toBeHidden()
    await expect(thanks(page).getByText(/^지금은 \d+초 동안의 판매를 한 메시지로 묶어요\.$/)).toHaveCount(0)
    const detail = thanks(page).getByRole('button', { name: '상세 설정', exact: true })
    await expect(detail).toHaveAttribute('aria-expanded', 'false')
    await detail.click()
    await thanks(page).getByLabel(BATCH_LABEL).fill('601')
    await saveButton(page).click()
    await expect(saveBar(page).getByRole('alert')).toHaveText(failedLine('구매 감사 메시지'))
    await expect(thanks(page).getByLabel(BATCH_LABEL)).toBeVisible()
    await thanks(page).getByLabel(BATCH_LABEL).fill('30')
    await saveButton(page).click()
    await expect(saveBar(page).getByRole('status')).toHaveText(`${SAVED}${RULES_NEXT}`)
    await expect(thanks(page).getByText('지금은 30초 동안의 판매를 한 메시지로 묶어요.')).toBeVisible()
    await page.reload()
    await expect(thanks(page).getByText('지금은 30초 동안의 판매를 한 메시지로 묶어요.')).toBeVisible()
    await expect(thanks(page).getByRole('button', { name: '상세 설정', exact: true })).toHaveAttribute('aria-expanded', 'false')
  })
})

test.describe('AC-FB1-19 택배 설정', () => {
  test('택배사 목록(잠긴 줄 없음)·직접 입력 이름 칸·자동 접수 안내, 기본 택배 크기 다섯 낱말·안내, 극소 없음, 직접 입력 저장과 칸 옆 문장', async ({ page }) => {
    await openSettings(page)
    const carrier = parcel(page).getByRole('combobox', { name: '택배사' })
    await expect(carrier.getByRole('option')).toHaveText(['고르지 않음', '우체국택배', 'CJ대한통운', '한진택배', '로젠택배', '롯데택배', '직접 입력', '가짜 택배(시험용)'])
    for (const option of await carrier.getByRole('option').all()) await expect(option).toBeEnabled()
    await expect(parcel(page).getByText(NO_AUTO_BOOK_HINT)).toBeVisible()
    await carrier.selectOption({ label: '가짜 택배(시험용)' })
    await expect(parcel(page).getByText(NO_AUTO_BOOK_HINT)).toHaveCount(0)
    await carrier.selectOption({ label: 'CJ대한통운' })
    await expect(parcel(page).getByText(NO_AUTO_BOOK_HINT)).toBeVisible()
    await expect(parcel(page).getByLabel('택배사 이름')).toHaveCount(0)

    const box = parcel(page).getByRole('combobox', { name: '기본 택배 크기 (세 변의 합)' })
    await expect(box.getByRole('option')).toHaveText(BOX_WORDS)
    await expect(box).toHaveValue('80')
    await expect(parcel(page).getByText(BOX_HINT)).toBeVisible()
    await expect(page.locator('main')).not.toContainText('극소')
    await expect(page.getByRole('combobox', { name: '기본 상자 크기' })).toHaveCount(0)

    await carrier.selectOption({ label: '직접 입력' })
    const name = parcel(page).getByRole('textbox', { name: '택배사 이름' })
    await expect(name).toBeVisible()
    await expect(parcel(page).getByText(NO_AUTO_BOOK_HINT)).toBeVisible()
    // 빈 이름 → 칸 옆 서버 문장, 저장 없음
    await saveButton(page).click()
    await expect(parcel(page).getByText('택배사 이름을 적어 주세요.')).toBeVisible()
    await expect(saveBar(page).getByRole('alert')).toHaveText(failedLine('택배'))
    expect((await parcelSettings(page))['carrier']).toBeNull()
    await name.fill('  경동   택배 ')
    await saveButton(page).click()
    await expect(saveBar(page).getByRole('status')).toHaveText(SAVED)
    const saved = await parcelSettings(page)
    expect([saved['carrier'], saved['carrierName']]).toEqual(['OTHER', '경동 택배'])
    await page.reload()
    await expect(parcel(page).getByRole('combobox', { name: '택배사' })).toHaveValue('OTHER')
    await expect(parcel(page).getByRole('textbox', { name: '택배사 이름' })).toHaveValue('경동 택배')
    await expect(saveBar(page)).toContainText(NO_CHANGES)
  })

  test('직접 입력 이름의 <script>는 글로만, 21자는 서버 문장', async ({ page }) => {
    await openSettings(page)
    await parcel(page).getByRole('combobox', { name: '택배사' }).selectOption({ label: '직접 입력' })
    const name = parcel(page).getByRole('textbox', { name: '택배사 이름' })
    await name.fill('가'.repeat(21))
    const value = await name.inputValue()
    if (value.length === 21) {
      await saveButton(page).click()
      await expect(parcel(page).getByText('택배사 이름은 20자까지 적어 주세요.')).toBeVisible()
    } else {
      expect(value).toBe('가'.repeat(20))
    }
    let alerted = false
    page.on('dialog', async (d) => {
      alerted = true
      await d.dismiss()
    })
    await name.fill('<img src=x>경동')
    await saveButton(page).click()
    await expect(saveBar(page).getByRole('status')).toHaveText(SAVED)
    await page.reload()
    await expect(parcel(page).getByRole('textbox', { name: '택배사 이름' })).toHaveValue('<img src=x>경동')
    expect(alerted).toBe(false)
    await expect(page.locator('main img[src="x"]')).toHaveCount(0)
  })
})

test.describe('AC-FB1-22·90 화면 폭과 낱말', () => {
  for (const width of [1440, 375]) {
    test(`${String(width)}px: 막대는 스크롤해도 화면 아래에 보이고 마지막 칸을 가리지 않는다, 개발 낱말 없음`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 375 ? 740 : 900 })
      await openSettings(page)
      await rules(page).getByRole('button', { name: '상세 설정', exact: true }).click()
      await thanks(page).getByRole('button', { name: '상세 설정', exact: true }).click()
      await thanks(page).getByRole('checkbox', { name: '영상 댓글에 감사 메시지 남기기' }).check()
      await parcel(page).getByRole('combobox', { name: '택배사' }).selectOption({ label: '직접 입력' })
      const text = await page.locator('main').innerText()
      expect(text).not.toMatch(DEV_WORDS)
      const viewport = page.viewportSize()!
      await page.evaluate(() => window.scrollTo(0, 0))
      let bar = await saveBar(page).boundingBox()
      expect(bar!.y + bar!.height).toBeLessThanOrEqual(viewport.height + 1)
      expect(bar!.y).toBeGreaterThan(0)
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      bar = await saveBar(page).boundingBox()
      expect(bar!.y + bar!.height).toBeLessThanOrEqual(viewport.height + 1)
      // 맨 아래까지 내렸을 때 마지막 칸("그 밖")의 아래 끝이 막대 위에 있다
      const last = await settingsRegion(page, '그 밖').boundingBox()
      expect(last!.y + last!.height).toBeLessThanOrEqual(bar!.y + 1)
      // 휴대폰 아래 메뉴 막대와 겹치지 않는다
      if (width === 375) {
        const nav = await page.getByRole('navigation', { name: '메뉴' }).boundingBox()
        if (nav !== null && nav.y > viewport.height / 2) expect(bar!.y + bar!.height).toBeLessThanOrEqual(nav.y + 1)
      }
    })
  }
})

test.describe('AC-FB1-31 남은 값이 없으면 묻지 않는다', () => {
  test('(d) 다른 기기에서 가게 이름을 바꾼 뒤 이 기기에서 앱 안 이동으로 설정을 열어도 "바꾼 칸이 없어요."', async ({ page }) => {
    await loginNewSeller(page)
    await page.goto('/settings')
    await expect(saveBar(page)).toContainText(NO_CHANGES)
    await page.getByRole('navigation', { name: '메뉴' }).getByRole('link', { name: '방송', exact: true }).click()
    await expect(page).toHaveURL(/\/$/)
    const res = await page.request.put('/api/shop', { data: { name: '다른기기이름' }, headers: { Origin: new URL(page.url()).origin } })
    expect(res.status(), await res.text()).toBeLessThan(300)
    await page.getByRole('navigation', { name: '메뉴' }).getByRole('link', { name: '설정', exact: true }).click()
    await expect(settingsRegion(page, '가게').getByLabel('계좌번호')).toBeVisible()
    await expect(settingsRegion(page, '택배').getByRole('combobox', { name: '택배사' })).toBeVisible()
    await expect(saveBar(page)).toContainText(NO_CHANGES)
    const prevented = await page.evaluate(() => {
      const e = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(e)
      return e.defaultPrevented
    })
    expect(prevented).toBe(false)
    await page.getByRole('navigation', { name: '메뉴' }).getByRole('link', { name: '구매자', exact: true }).click()
    await expect(page).toHaveURL(/\/buyers/)
    await expect(page.getByRole('dialog', { name: LEAVE_TITLE })).toHaveCount(0)
  })

  test('계좌·보내는 사람·직접 입력 택배사·묶는 시간 30·무료배송 없음인 판매자: 새로 열면 "바꾼 칸이 없어요.", 메뉴 이동에 창 없음, beforeunload 없음', async ({ page }) => {
    await loginNewSeller(page)
    await patchSettings(page, { 'thanks.batchWindowSec': 30, 'shipping.freeThreshold': null, 'claim.parseMode': 'OPTIONS' })
    const shop = await page.request.put('/api/shop', { data: { name: '계좌가게', bank: '농협', accountNumber: '302-9988-7766-11', accountHolder: '김판매', accountNote: '문의 010-1234-5678' }, headers: { Origin: new URL(page.url()).origin } })
    expect(shop.status(), await shop.text()).toBeLessThan(300)
    const res = await page.request.put('/api/parcels/settings', {
      data: { carrier: 'OTHER', carrierName: '경동택배', sender: SENDER, box: '120' },
      headers: { Origin: new URL(page.url()).origin },
    })
    expect(res.status(), await res.text()).toBe(200)
    await page.goto('/settings')
    await expect(parcel(page).getByRole('textbox', { name: '택배사 이름' })).toHaveValue('경동택배')
    await expect(settingsRegion(page, '가게').getByLabel('계좌번호')).toHaveValue('302-9988-7766-11')
    await expect(saveBar(page)).toContainText(NO_CHANGES)
    await expect(saveButton(page)).toBeDisabled()
    const prevented = await page.evaluate(() => {
      const e = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(e)
      return e.defaultPrevented
    })
    expect(prevented).toBe(false)
    await page.getByRole('navigation', { name: '메뉴' }).getByRole('link', { name: '구매자', exact: true }).click()
    await expect(page).toHaveURL(/\/buyers/)
    await expect(page.getByRole('dialog', { name: LEAVE_TITLE })).toHaveCount(0)
  })
})
