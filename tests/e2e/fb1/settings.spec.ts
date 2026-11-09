// FB1 설정 화면 흐름 (AC-FB1-90 설정 줄): 저장 막대 하나(AC-FB1-22~25), 가격 단위(AC-FB1-01), 상세 설정·예시·같은 1분(AC-FB1-06~08),
// 감사 채팅 체크 한 줄·켜 둔 판매자의 영상 댓글 끄기/되돌리기·묶는 시간 상세(AC-FB1-10·11 회차 2), 택배사·직접 입력·택배 크기 다섯 낱말(AC-FB1-19), 개발 낱말 없음.
// 기대 문장은 harness/sprints/FB1/acceptance.md 따옴표 그대로 — 고침 회차(D-FB1-13~18)는 맨 아래 "고침 회차 문장 모음" 그대로.
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  AUTO_BATCH,
  BATCH_LABEL,
  BOX_HINT,
  BOX_WORDS,
  DEV_WORDS,
  LEAVE_TEXT,
  LEAVE_TITLE,
  LIVE_CHAT_CHECK,
  NO_AUTO_BOOK_HINT,
  NO_CHANGES,
  OLD_PARCEL_HINTS,
  OLD_SAME_MINUTE,
  OLD_SHIPPING_LINE,
  OLD_THANKS_WORDS,
  OLD_UNIT_HINT,
  RANGE_0_100,
  RULES_DETAIL,
  RULES_NEXT,
  SAME_MINUTE,
  SAVED,
  SHIPPING_HINT,
  SHIPPING_NEXT,
  THANKS_DETAIL,
  UNIT_CHANGE,
  UNIT_HINT,
  UNIT_WORDS,
  VIDEO_OFF_PENDING,
  VIDEO_ON,
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

/** 두 요소 사이(세로로)에 보이는 글 조각 — 화면 순서 확인용 */
async function textsBetween(scope: Locator, upper: Locator, lower: Locator): Promise<string[]> {
  const top = (await upper.boundingBox())!
  const bottom = (await lower.boundingBox())!
  const from = top.y + top.height - 1
  const to = bottom.y + 1
  return await scope.evaluate(
    (main, [a, b]) => {
      const out: string[] = []
      const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
        const text = (n.textContent ?? '').trim()
        if (text === '' || n.parentElement?.closest('select,option') != null) continue
        const range = document.createRange()
        range.selectNodeContents(n)
        for (const r of Array.from(range.getClientRects())) {
          if (r.width === 0 || r.height === 0) continue
          if (r.top >= a && r.bottom <= b) out.push(text)
        }
      }
      return out
    },
    [from, to] as const,
  )
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
    await thanks(page).getByRole('checkbox', { name: LIVE_CHAT_CHECK, exact: true }).uncheck() // 회차 2 D-FB1-14 — 만들기는 채팅 체크 한 줄
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
    expect(saves[1]!.body).toEqual({ settings: { 'waitlist.max': 3, 'shipping.baseFee': 3500, 'thanks.liveChat': false } })
    await expect(page.getByRole('banner').getByText('막대가게')).toBeVisible()
    const saved = await serverSettings(page)
    expect([saved['waitlist.max'], saved['shipping.baseFee'], saved['thanks.liveChat'], saved['thanks.videoComment']]).toEqual([3, 3500, false, 'OFF'])
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

  test('AC-FB1-24 일부 실패: 대기 인원 101 + 보내는 사람 이름 → 설정 400·택배 저장, 칸 옆 서버 문장, 막대 alert 한 요소("저장한 칸: 택배."), 포커스 대기 인원, 판매 규칙만 남음', async ({ page }) => {
    await openSettings(page, { sender: true })
    await rules(page).getByLabel('대기 인원 (0이면 대기 없음)').fill('101')
    const senderName = parcel(page).getByLabel('보내는 사람 이름')
    await senderName.fill('다육이네 보냄')
    await expect(saveBar(page)).toContainText(dirtyLine('판매 규칙', '택배'))
    await saveButton(page).click()
    await expect(saveBar(page).getByRole('alert')).toHaveCount(1)
    await expect(saveBar(page).getByRole('alert')).toHaveText(failedLine(['판매 규칙'], ['택배']))
    await expect(rules(page).getByText(RANGE_0_100, { exact: true })).toBeVisible()
    await expect(page.getByText('까지의 정수로 적어 주세요', { exact: false })).toHaveCount(0)
    await expect(rules(page).getByLabel('대기 인원 (0이면 대기 없음)')).toBeFocused()
    await expect(rules(page).getByLabel('대기 인원 (0이면 대기 없음)')).toHaveValue('101')
    // "저장하지 않은 칸"에는 판매 규칙만 (택배는 막대 문장의 "저장한 칸"에만)
    await expect(saveBar(page).getByText(/^저장하지 않은 칸: /)).toHaveText(dirtyLine('판매 규칙'))
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
    // 판매 규칙은 저장됐다 — 회차 2 D-FB1-18 (d) " 저장한 칸: 판매 규칙."
    await expect(saveBar(page).getByRole('alert')).toHaveText(failedLine(['택배'], ['판매 규칙']))
    await expect(saveBar(page)).toContainText(dirtyLine('택배'))
    expect((await serverSettings(page))['waitlist.max']).toBe(2)
  })

  test('AC-FB1-25 떠나기 창: 단추 셋 차례("저장하고 떠나기" 주 버튼·"저장하지 않고 떠나기"·"닫기"), 처음 포커스 닫기·Esc 닫기, 저장 뒤엔 창 없이 이동', async ({ page }) => {
    await openSettings(page)
    await rules(page).getByLabel('대기 인원 (0이면 대기 없음)').fill('4')
    await page.getByRole('navigation', { name: '메뉴' }).getByRole('link', { name: '구매자', exact: true }).click()
    const dlg = page.getByRole('dialog', { name: LEAVE_TITLE })
    await expect(dlg).toContainText(LEAVE_TEXT)
    await expect(dlg.getByRole('button')).toHaveText(['저장하고 떠나기', '저장하지 않고 떠나기', '닫기'])
    await expect(dlg.getByRole('button', { name: '저장하고 떠나기' })).toHaveClass(/button-primary/)
    await expect(dlg.getByRole('button', { name: '닫기' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)
    await expect(page).toHaveURL(/\/settings$/)
    await page.getByRole('navigation', { name: '메뉴' }).getByRole('link', { name: '구매자', exact: true }).click()
    await dlg.getByRole('button', { name: '닫기' }).click()
    await expect(page).toHaveURL(/\/settings$/)
    await saveButton(page).click()
    await expect(saveBar(page).getByRole('status')).toHaveText(`${SAVED}${RULES_NEXT}`)
    await page.getByRole('navigation', { name: '메뉴' }).getByRole('link', { name: '구매자', exact: true }).click()
    await expect(page).toHaveURL(/\/buyers/)
    await expect(dlg).toHaveCount(0)
  })

  test('AC-FB1-25 "저장하고 떠나기": 막대 저장과 같은 차례(설정 → 택배), 보내는 동안 "저장하는 중…"·세 단추 잠김·두 번 눌러도 한 번 → 가려던 화면, 돌아오면 저장된 값', async ({ page }) => {
    await openSettings(page, { sender: true })
    await rules(page).getByLabel('대기 인원 (0이면 대기 없음)').fill('4')
    await parcel(page).getByLabel('보내는 사람 이름').fill('떠나며 저장')
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/api/settings', async (route) => {
      if (route.request().method() !== 'PATCH') return await route.fallback()
      await gate
      await route.fallback()
    })
    const saves = recordSaves(page)
    await page.getByRole('navigation', { name: '메뉴' }).getByRole('link', { name: '구매자', exact: true }).click()
    const dlg = page.getByRole('dialog', { name: LEAVE_TITLE })
    await dlg.getByRole('button', { name: '저장하고 떠나기' }).click()
    const busy = dlg.getByRole('button', { name: '저장하는 중…' })
    await expect(busy).toBeDisabled()
    await expect(dlg.getByRole('button', { name: '저장하지 않고 떠나기' })).toBeDisabled()
    await expect(dlg.getByRole('button', { name: '닫기' })).toBeDisabled()
    await busy.click({ force: true })
    await page.keyboard.press('Escape')
    await expect(dlg).toBeVisible()
    release()
    await expect(page).toHaveURL(/\/buyers/)
    expect(saves.map((x) => `${x.method} ${x.path}`)).toEqual(['PATCH /api/settings', 'PUT /api/parcels/settings'])
    expect(saves[0]!.body).toEqual({ settings: { 'waitlist.max': 4 } })
    expect((await serverSettings(page))['waitlist.max']).toBe(4)
    expect(((await parcelSettings(page))['sender'] as { name?: string }).name).toBe('떠나며 저장')
    await page.getByRole('navigation', { name: '메뉴' }).getByRole('link', { name: '설정', exact: true }).click()
    await expect(rules(page).getByLabel('대기 인원 (0이면 대기 없음)')).toHaveValue('4')
    await expect(saveBar(page)).toContainText(NO_CHANGES)
  })

  test('AC-FB1-25 "저장하고 떠나기" 일부 실패: 창이 닫히고 설정에 남음, 막대 문장(저장한 칸: 택배), 첫 빨간 칸 포커스, 이동 없음', async ({ page }) => {
    await openSettings(page, { sender: true })
    await rules(page).getByLabel('대기 인원 (0이면 대기 없음)').fill('101')
    await parcel(page).getByLabel('보내는 사람 이름').fill('실패 뒤 남음')
    await page.getByRole('navigation', { name: '메뉴' }).getByRole('link', { name: '구매자', exact: true }).click()
    const dlg = page.getByRole('dialog', { name: LEAVE_TITLE })
    await dlg.getByRole('button', { name: '저장하고 떠나기' }).click()
    await expect(dlg).toHaveCount(0)
    await expect(page).toHaveURL(/\/settings$/)
    await expect(saveBar(page).getByRole('alert')).toHaveText(failedLine(['판매 규칙'], ['택배']))
    await expect(rules(page).getByText(RANGE_0_100, { exact: true })).toBeVisible()
    await expect(rules(page).getByLabel('대기 인원 (0이면 대기 없음)')).toBeFocused()
    await expect(saveBar(page)).toContainText(dirtyLine('판매 규칙'))
    expect((await serverSettings(page))['waitlist.max']).toBe(5)
    // 남은 값이 있으니 다시 이동하면 다시 묻는다
    await page.getByRole('navigation', { name: '메뉴' }).getByRole('link', { name: '구매자', exact: true }).click()
    await expect(dlg).toBeVisible()
    await dlg.getByRole('button', { name: '저장하지 않고 떠나기' }).click()
    await expect(page).toHaveURL(/\/buyers/)
  })

  test('라벨·로그인 방법 등 바로 저장 칸은 막대의 "바뀐 칸"에 들지 않는다', async ({ page }) => {
    await openSettings(page)
    // D-UX3-32 (사용자 지시 2026-11-06 "도우미 기능 필요없어"): 보조자 기능을 없애 옛 기대 "보조자 칸도 바로 저장 칸"을 뺐다
    for (const title of ['유튜브', '로그인 방법', '그 밖']) {
      const region = settingsRegion(page, title)
      if ((await region.count()) === 0) continue
      await expect(saveBar(page)).toContainText(NO_CHANGES)
    }
    await expect(saveBar(page)).not.toContainText(/라벨|유튜브|로그인/)
  })
})

test.describe('AC-FB1-01·05~08 설정 문구', () => {
  test('가격 단위 셋(원·천원·만원 차례)·처음 천원·단위 안내, 배송비 안내, 판매 규칙 상세 설정 접힘(▼/▲), 여러 번호 예시, 같은 1분 새 낱말, 저장값 그대로', async ({ page }) => {
    await openSettings(page)
    const unit = rules(page).getByRole('radiogroup', { name: '가격 단위' })
    // V3 D-V3-70 (AC-V3-74 b): 넷째 "자동"이 더해졌다 — 앞 세 칸의 차례·이름은 그대로
    await expect(unit.getByRole('radio')).toHaveCount(4)
    for (const [i, word] of [UNIT_WORDS.WON, UNIT_WORDS.THOUSAND, UNIT_WORDS.TEN_THOUSAND, '자동 (25 → 250,000원, 180 → 180,000원)'].entries()) await expect(unit.getByRole('radio').nth(i)).toHaveAccessibleName(word)
    await expect(unit.getByRole('radio', { name: UNIT_WORDS.THOUSAND })).toBeChecked()
    await expect(rules(page).getByText(UNIT_HINT, { exact: true })).toBeVisible()
    await expect(page.getByText(OLD_UNIT_HINT, { exact: false })).toHaveCount(0)
    await expect(settingsRegion(page, '배송비').getByText(SHIPPING_HINT)).toBeVisible()
    await expect(page.getByText(OLD_SHIPPING_LINE)).toHaveCount(0)

    // 회차 2 D-FB1-18 (c): 접근 이름 "판매 규칙 상세 설정", 보이는 글 뒤 ▼/▲(aria-hidden), 정확히 "상세 설정"인 단추는 없음
    const detail = rules(page).getByRole('button', { name: RULES_DETAIL, exact: true })
    await expect(detail).toHaveAttribute('aria-expanded', 'false')
    await expect(detail).toHaveText(new RegExp(`^${RULES_DETAIL}\\s*▼$`))
    await expect(detail.locator('[aria-hidden="true"]')).toHaveText('▼')
    await expect(page.getByRole('button', { name: '상세 설정', exact: true })).toHaveCount(0)
    await expect(page.getByText('더 보기 (잘 모르면 그대로 두세요)')).toHaveCount(0)
    await expect(rules(page).getByRole('radiogroup', { name: '주문 인식 방식' })).toBeHidden()
    await detail.click()
    await expect(detail).toHaveAttribute('aria-expanded', 'true')
    await expect(detail.locator('[aria-hidden="true"]')).toHaveText('▲')
    await expect(rules(page).getByText('잘 모르면 그대로 두세요.', { exact: true })).toBeVisible()
    await expect(rules(page).getByRole('radiogroup', { name: '주문 인식 방식' })).toBeVisible()

    // 여러 번호 예시 (D-FB1-12): "예:" + 글쓴이 @홍길동(다른 요소, 다른 색·크기) + 글 132 475
    const many = rules(page).getByRole('radiogroup', { name: '한 채팅에 번호가 여러 개면' })
    const author = rules(page).getByText('@홍길동', { exact: true })
    const said = rules(page).getByText('132 475', { exact: true })
    await expect(author).toBeVisible()
    await expect(said).toBeVisible()
    const looks = async (l: typeof author) => await l.evaluate((el) => ({ color: getComputedStyle(el).color, size: getComputedStyle(el).fontSize }))
    const [a, t] = [await looks(author), await looks(said)]
    expect(a.color).not.toBe(t.color)
    expect(a.size).not.toBe(t.size)
    for (const name of ['모두 주문 (132번·475번 둘 다 찜)', '첫 번호만 주문 (132번만 찜)', '주문으로 보지 않아요 (둘 다 찜 아님)']) await expect(many.getByRole('radio', { name, exact: true })).toHaveCount(1)
    await expect(page.locator('main')).not.toContainText("예: 채팅 '15 28'")
    await expect(page.locator('main')).not.toContainText('15번·28번 둘 다')

    // 같은 분 (회차 2 D-FB1-13)
    const sameMinute = rules(page).getByRole('radiogroup', { name: SAME_MINUTE, exact: true })
    for (const name of ['유튜브 먼저', '문자 먼저', '내가 정해요']) await expect(sameMinute.getByRole('radio', { name, exact: true })).toHaveCount(1)
    for (const old of OLD_SAME_MINUTE) await expect(page.locator('main')).not.toContainText(old)

    // 저장값은 그대로 WON·FIRST
    const saves = recordSaves(page)
    await unit.getByRole('radio', { name: UNIT_WORDS.WON }).check()
    await many.getByRole('radio', { name: '첫 번호만 주문 (132번만 찜)', exact: true }).check()
    await saveButton(page).click()
    await expect(saveBar(page).getByRole('status')).toHaveText(`${SAVED}${RULES_NEXT}`)
    expect(saves.at(-1)!.body).toEqual({ settings: { 'price.unit': 'WON', 'claim.multiNumber': 'FIRST' } })
  })

  for (const width of [1440, 375]) {
    test(`AC-FB1-01 ${String(width)}px: 만원을 고르면 확인 문장 하나(창 없음) → 천원으로 되돌리면 없음 → 원·만원 문장 → 저장하면 없음, 저장값 TEN_THOUSAND`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 375 ? 740 : 900 })
      await openSettings(page)
      let dialogs = 0
      page.on('dialog', async (d) => {
        // 새로고침의 브라우저 떠나기 확인은 받아 준다 — 세는 것은 앱이 띄운 창(confirm·alert)뿐
        if (d.type() === 'beforeunload') return await d.accept()
        dialogs += 1
        await d.dismiss()
      })
      const unit = rules(page).getByRole('radiogroup', { name: '가격 단위' })
      const notes = rules(page).getByText(/^저장하면 다음 라이브부터 /) // 문구 바뀜 (D-UX4-86)
      await expect(notes).toHaveCount(0)
      await unit.getByRole('radio', { name: UNIT_WORDS.TEN_THOUSAND }).check()
      await expect(notes).toHaveCount(1)
      await expect(notes).toHaveText(UNIT_CHANGE.TEN_THOUSAND)
      await expect(notes).toBeInViewport()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(saveBar(page)).toContainText(dirtyLine('판매 규칙'))
      await unit.getByRole('radio', { name: UNIT_WORDS.THOUSAND }).check()
      await expect(notes).toHaveCount(0)
      await expect(saveBar(page)).toContainText(NO_CHANGES)
      await unit.getByRole('radio', { name: UNIT_WORDS.WON }).check()
      await expect(notes).toHaveText(UNIT_CHANGE.WON)
      await unit.getByRole('radio', { name: UNIT_WORDS.TEN_THOUSAND }).check()
      await expect(notes).toHaveText(UNIT_CHANGE.TEN_THOUSAND)
      const saves = recordSaves(page)
      await saveButton(page).click()
      await expect(saveBar(page).getByRole('status')).toHaveText(`${SAVED}${RULES_NEXT}`)
      await expect(notes).toHaveCount(0)
      expect(saves.at(-1)!.body).toEqual({ settings: { 'price.unit': 'TEN_THOUSAND' } })
      expect((await serverSettings(page))['price.unit']).toBe('TEN_THOUSAND')
      // 저장된 만원에서 천원을 고르면 천원 문장
      await unit.getByRole('radio', { name: UNIT_WORDS.THOUSAND }).check()
      await expect(notes).toHaveText(UNIT_CHANGE.THOUSAND)
      await page.reload()
      await expect(rules(page).getByRole('radiogroup', { name: '가격 단위' }).getByRole('radio', { name: UNIT_WORDS.TEN_THOUSAND })).toBeChecked()
      await expect(rules(page).getByText(/^저장하면 다음 라이브부터 /)).toHaveCount(0) // 문구 바뀜 (D-UX4-86)
      expect(await page.locator('main').innerText()).not.toMatch(DEV_WORDS)
      expect(dialogs).toBe(0)
    })
  }
})

test.describe('AC-FB1-10·11 감사 메시지 만들기 (회차 2 D-FB1-14)', () => {
  test('저장값 OFF(기본): 채팅 체크 한 줄만, 영상 댓글 낱말·옛 낱말·묶음 없음, 끄고 저장하면 thanks.liveChat false', async ({ page }) => {
    await openSettings(page)
    const live = thanks(page).getByRole('checkbox', { name: LIVE_CHAT_CHECK, exact: true })
    await expect(live).toBeChecked()
    await expect(thanks(page).getByRole('checkbox')).toHaveCount(1)
    await expect(thanks(page).getByRole('group', { name: '감사 메시지를 남길 곳' })).toHaveCount(0)
    await expect(thanks(page).getByRole('radiogroup', { name: '영상 댓글 방식' })).toHaveCount(0)
    for (const old of OLD_THANKS_WORDS) await expect(page.locator('main')).not.toContainText(old)
    await expect(thanks(page)).not.toContainText('영상 댓글')
    await expect(thanks(page).getByRole('button', { name: '영상 댓글 끄기' })).toHaveCount(0)
    await expect(thanks(page).getByText(AUTO_BATCH, { exact: true })).toBeVisible()

    const saves = recordSaves(page)
    await live.uncheck()
    await expect(saveBar(page)).toContainText(dirtyLine('구매 감사 메시지'))
    await saveButton(page).click()
    await expect(saveBar(page).getByRole('status')).toHaveText(`${SAVED}${RULES_NEXT}`)
    expect(saves.at(-1)!.body).toEqual({ settings: { 'thanks.liveChat': false } })
    expect((await serverSettings(page))['thanks.liveChat']).toBe(false)
    await page.reload()
    await expect(thanks(page).getByRole('checkbox', { name: LIVE_CHAT_CHECK, exact: true })).not.toBeChecked()
  })

  for (const mode of ['PER_SALE', 'SUMMARY'] as const) {
    test(`저장값 ${mode}(예전에 켠 판매자): 한 줄 + "영상 댓글 끄기" → "저장하면 …" + "되돌리기" → 되돌리면 그대로·막대에서 빠짐 → 끄고 저장하면 OFF·영상 댓글 낱말 사라짐`, async ({ page }) => {
      await loginNewSeller(page)
      await patchSettings(page, { 'thanks.videoComment': mode })
      await page.goto('/settings')
      await expect(saveBar(page)).toContainText(NO_CHANGES)
      await expect(thanks(page).getByText(VIDEO_ON, { exact: true })).toBeVisible()
      const off = thanks(page).getByRole('button', { name: '영상 댓글 끄기', exact: true })
      await expect(off).toBeVisible()
      await expect(off).not.toHaveClass(/button-primary/)
      // 새로 켤 칸은 없다
      await expect(thanks(page).getByRole('checkbox', { name: '영상 댓글에 감사 메시지 남기기' })).toHaveCount(0)
      await expect(thanks(page).getByRole('radiogroup', { name: '영상 댓글 방식' })).toHaveCount(0)

      await off.click()
      await expect(thanks(page).getByText(VIDEO_OFF_PENDING, { exact: true })).toBeVisible()
      await expect(thanks(page).getByText(VIDEO_ON, { exact: true })).toHaveCount(0)
      const undo = thanks(page).getByRole('button', { name: '되돌리기', exact: true })
      await expect(undo).toBeVisible()
      await expect(saveBar(page)).toContainText(dirtyLine('구매 감사 메시지'))
      await undo.click()
      await expect(thanks(page).getByText(VIDEO_ON, { exact: true })).toBeVisible()
      await expect(saveBar(page)).toContainText(NO_CHANGES)
      await expect(saveButton(page)).toBeDisabled()
      expect((await serverSettings(page))['thanks.videoComment']).toBe(mode)

      await thanks(page).getByRole('button', { name: '영상 댓글 끄기', exact: true }).click()
      const saves = recordSaves(page)
      await saveButton(page).click()
      await expect(saveBar(page).getByRole('status')).toHaveText(`${SAVED}${RULES_NEXT}`)
      expect(saves.at(-1)!.body).toEqual({ settings: { 'thanks.videoComment': 'OFF' } })
      expect((await serverSettings(page))['thanks.videoComment']).toBe('OFF')
      await expect(thanks(page)).not.toContainText('영상 댓글')
      await page.reload()
      await expect(thanks(page).getByRole('checkbox', { name: LIVE_CHAT_CHECK, exact: true })).toBeVisible()
      await expect(thanks(page)).not.toContainText('영상 댓글')
    })
  }

  test('묶는 시간은 "감사 메시지 상세 설정" 안(▼), 자동 묶음 안내는 늘, 저장값 30이면 접힘 밖 한 줄, 0이면 없음, 범위 밖은 서버 문장(접힌 칸을 펴서)', async ({ page }) => {
    await openSettings(page)
    await expect(thanks(page).getByText(AUTO_BATCH, { exact: true })).toBeVisible()
    await expect(thanks(page).getByLabel(BATCH_LABEL)).toBeHidden()
    await expect(thanks(page).getByText(/^지금은 \d+초 동안의 판매를 한 메시지로 묶어요\.$/)).toHaveCount(0)
    const detail = thanks(page).getByRole('button', { name: THANKS_DETAIL, exact: true })
    await expect(detail).toHaveAttribute('aria-expanded', 'false')
    await expect(detail.locator('[aria-hidden="true"]')).toHaveText('▼')
    await detail.click()
    await expect(detail.locator('[aria-hidden="true"]')).toHaveText('▲')
    await thanks(page).getByLabel(BATCH_LABEL).fill('601')
    await saveButton(page).click()
    await expect(saveBar(page).getByRole('alert')).toHaveText(failedLine(['구매 감사 메시지']))
    await expect(thanks(page).getByLabel(BATCH_LABEL)).toBeVisible()
    await thanks(page).getByLabel(BATCH_LABEL).fill('30')
    await saveButton(page).click()
    await expect(saveBar(page).getByRole('status')).toHaveText(`${SAVED}${RULES_NEXT}`)
    await expect(thanks(page).getByText('지금은 30초 동안의 판매를 한 메시지로 묶어요.')).toBeVisible()
    await page.reload()
    await expect(thanks(page).getByText('지금은 30초 동안의 판매를 한 메시지로 묶어요.')).toBeVisible()
    await expect(thanks(page).getByRole('button', { name: THANKS_DETAIL, exact: true })).toHaveAttribute('aria-expanded', 'false')
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

    for (const old of OLD_PARCEL_HINTS) await expect(page.locator('main')).not.toContainText(old)

    await carrier.selectOption({ label: '직접 입력' })
    const name = parcel(page).getByRole('textbox', { name: '택배사 이름' })
    await expect(name).toBeVisible()
    // 회차 2 D-FB1-18 (f): 이름 칸은 고르기 바로 아래(사이에 다른 글 없음), 안내는 하나이고 이름 칸 아래
    await expect(parcel(page).getByText(NO_AUTO_BOOK_HINT)).toHaveCount(1)
    await expect(parcel(page).getByText(NO_AUTO_BOOK_HINT)).toBeVisible()
    for (const old of OLD_PARCEL_HINTS) await expect(page.locator('main')).not.toContainText(old)
    const between = await textsBetween(parcel(page), carrier, parcel(page).getByText('택배사 이름', { exact: true }))
    expect(between).toEqual([])
    const nameBox = (await name.boundingBox())!
    const hintBox = (await parcel(page).getByText(NO_AUTO_BOOK_HINT).boundingBox())!
    expect(hintBox.y).toBeGreaterThanOrEqual(nameBox.y + nameBox.height - 1)
    // 빈 이름 → 칸 옆 서버 문장, 저장 없음
    await saveButton(page).click()
    await expect(parcel(page).getByText('택배사 이름을 적어 주세요.')).toBeVisible()
    await expect(saveBar(page).getByRole('alert')).toHaveText(failedLine(['택배']))
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
      await rules(page).getByRole('button', { name: RULES_DETAIL, exact: true }).click()
      await thanks(page).getByRole('button', { name: THANKS_DETAIL, exact: true }).click()
      await rules(page).getByRole('radiogroup', { name: '가격 단위' }).getByRole('radio', { name: UNIT_WORDS.TEN_THOUSAND }).check()
      await expect(rules(page).getByText(UNIT_CHANGE.TEN_THOUSAND)).toBeVisible()
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
