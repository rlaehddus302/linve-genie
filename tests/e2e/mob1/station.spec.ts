// MOB1 출력 기기 끊김 문장 세 자리 (AC-MOB1-12·13·14, D-MOB1-08, L-11 10) · 기본 기기 이름 (AC-MOB1-24) · 작업 줄 " · " (AC-MOB1-25, D-MOB1-13) — test-e2e.
// 두 기기: 안드로이드 흉내(412 터치 + 안드로이드 사용자 에이전트)가 출력 기기, 다른 기기(PC 1440 또는 휴대폰 375)가 콘솔·라벨·포장을 본다.
// 출력 기기의 실시간 연결 끊김은 그 컨텍스트를 오프라인으로(또는 탭을 닫아서) 만든다. 판매자는 시험마다 새로 만든다(출력 기록은 판매자 단위).
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { becomeDevice, gotoLabels, region } from '../i1/support.ts'
import { registerApi, smsApi } from '../s06/support.ts'
import { uniqueDate } from '../s05/support.ts'
import { ANDROID, ANDROID_UA, IPHONE_UA, PC, PHONE, alerts, baseUrlOf, broadcastApi, endBroadcastApi, expectNoDevWords, freshSeller, newDevice, setLabelsApi } from './support.ts'
import { loginAs } from '../i3/support.ts'

const lost = (name: string) => `출력 기기('${name}')가 연결되어 있지 않아요. 그 기기에서 라이브지니를 열고 화면을 켜 두세요.`
const PILING = "출력 기기가 아직 없어 라벨이 쌓이고 있어요. 출력할 기기의 라벨 화면에서 '이 기기에서 출력'을 눌러 주세요."
const OLD = '와 연결이 끊겼어요.'

interface World {
  readonly main: Page
  readonly mainContext: BrowserContext
  readonly seller: { loginId: string; password: string; shopName: string }
}

/** 판매자(라벨 켬) + 보는 기기 하나 */
async function world(browser: Browser, page: Page, viewport: { width: number; height: number } = PC): Promise<World> {
  await page.goto('/')
  const { page: main, context: mainContext, seller } = await freshSeller(browser, baseUrlOf(page), { viewport, touch: viewport.width < 768 })
  await setLabelsApi(main, true)
  return { main, mainContext, seller }
}

/** 안드로이드 흉내 기기에서 로그인하고 출력 기기가 된다 */
async function androidStation(browser: Browser, w: World, name: string): Promise<{ page: Page; context: BrowserContext }> {
  const dev = await newDevice(browser, baseUrlOf(w.main), { viewport: ANDROID, touch: true, userAgent: ANDROID_UA })
  await loginAs(dev.page, w.seller)
  await becomeDevice(dev.page, name)
  return dev
}

/** 라벨 화면에서 시험용 프린터에 잇는다 (기기 이름 칸은 프린터를 이은 뒤에 보인다) — 기기 이름 칸을 돌려준다 */
async function nameField(page: Page) {
  await gotoLabels(page)
  const printer = region(page, '프린터')
  await printer.getByRole('button', { name: '시험용 프린터 — 실제로 출력되지 않아요' }).click()
  await expect(printer.getByText(/이 기기의 프린터: 연결됨/)).toBeVisible()
  return printer.getByLabel('기기 이름')
}

/** 알림 띠 맨 앞 출력 기기 항목 */
function stationItem(page: Page, text: string) {
  return alerts(page).getByRole('button', { name: text, exact: true })
}

test.describe('AC-MOB1-12·13 출력 기기 끊김 — 라벨 화면·콘솔 알림 띠 맨 앞', () => {
  test('출력 기기 "안드로이드 폰"이 끊기면 PC 콘솔 띠 맨 앞(노란 모양)에 새 문장 → 누르면 라벨 화면(앱 안), 같은 자리 새 문장·옛 문장 없음 → 다시 이으면 사라진다', async ({ page, browser }) => {
    const w = await world(browser, page)
    const station = await androidStation(browser, w, '안드로이드 폰')
    try {
      const date = uniqueDate()
      const b = await broadcastApi(w.main, date)
      await registerApi(w.main, b, 1, '품종1', 1000)
      await w.main.goto(`/broadcasts/${encodeURIComponent(b)}`)
      await expect(w.main.getByLabel('빠른 입력')).toBeVisible()
      await expect(w.main.getByRole('link', { name: /^프린터 안드로이드 폰 · 연결됨/ })).toBeVisible()
      // 연결됨이면 항목이 없다
      await expect(alerts(w.main).getByText(/출력 기기\(/)).toHaveCount(0)

      // 끊김 (출력 기기 폰이 망을 잃는다)
      await station.context.setOffline(true)
      const item = stationItem(w.main, lost('안드로이드 폰'))
      await expect(item).toBeVisible({ timeout: 30_000 })
      // 맨 앞 항목·부드러운 노란 모양 (플랫폼 줄이 없는 기본 서버 — 첫 버튼)
      await expect(alerts(w.main).getByRole('button').first()).toHaveAccessibleName(lost('안드로이드 폰'))
      await expect(item).toHaveClass(/alert-soft/)
      await expect(w.main.getByText(OLD)).toHaveCount(0)
      await expectNoDevWords(w.main, '끊김 콘솔')
      // 누르면 라벨 화면 (앱 안 이동 — 새로 읽지 않는다)
      await w.main.evaluate(() => ((window as unknown as { __mob1: string }).__mob1 = 'kept'))
      await item.click()
      await expect(w.main).toHaveURL(/\/labels$/)
      await expect(w.main.getByRole('heading', { level: 1, name: '라벨' })).toBeVisible()
      expect(await w.main.evaluate(() => (window as unknown as { __mob1?: string }).__mob1)).toBe('kept')
      await expect(region(w.main, '프린터')).toContainText(lost('안드로이드 폰'))
      await expect(w.main.getByText(OLD)).toHaveCount(0)
      await expectNoDevWords(w.main, '끊김 라벨 화면')

      // 다시 이으면 콘솔 항목이 사라진다
      await w.main.goBack()
      await expect(item).toBeVisible()
      await station.context.setOffline(false)
      await expect(item).toHaveCount(0, { timeout: 30_000 })
      await expect(alerts(w.main).getByText(/출력 기기\(/)).toHaveCount(0)
    } finally {
      await station.context.close()
      await w.mainContext.close()
    }
  })

  test('출력 기기 탭을 닫으면 휴대폰 375 콘솔에도 항목 — 알림 수("알림 n 펼치기")에 들지 않고 접힌 띠 한 줄, 이름의 <b>·<script>는 글자로만', async ({ page, browser }) => {
    const w = await world(browser, page, PHONE)
    const name = '<b>폰</b><script>'
    const station = await androidStation(browser, w, name)
    try {
      const date = uniqueDate()
      const b = await broadcastApi(w.main, date)
      await registerApi(w.main, b, 16, '충돌상품', 1000)
      await w.main.goto(`/broadcasts/${encodeURIComponent(b)}`)
      await expect(w.main.getByLabel('빠른 입력')).toBeVisible()
      await station.page.close()
      const item = stationItem(w.main, lost(name))
      await expect(item).toBeVisible({ timeout: 30_000 })
      // HTML로 해석되지 않는다
      expect(await alerts(w.main).locator('b, script').count()).toBe(0)
      await expect(item).toHaveText(lost(name))
      // 이 항목 하나뿐이면 펼치기 버튼이 없다 (수에 들지 않음)
      await expect(w.main.getByRole('button', { name: /^알림 \d+ (펼치기|접기)$/ })).toHaveCount(0)
      // 보류 찜 1건(노란)을 더하면 "알림 1 펼치기" — 출력 기기 항목은 세지 않는다
      await smsApi(w.main, { b, no: 40, memo: '보류' })
      await expect(alerts(w.main).getByRole('button', { name: /^보류 찜 1$/ })).toHaveCount(1)
      await expect(w.main.getByRole('button', { name: '알림 1 펼치기', exact: true })).toBeVisible()
      // 접힌 띠는 한 줄 (출력 기기 항목과 보류 찜의 위 끝이 같다 — 또는 보류 찜은 잘려 안 보인다)
      const strip = (await alerts(w.main).boundingBox())!
      const first = (await item.boundingBox())!
      expect(first.y + first.height, '접힌 띠 안').toBeLessThanOrEqual(strip.y + strip.height + 0.5)
      expect(strip.height, '접힌 띠 높이 한 줄').toBeLessThanOrEqual(first.height + 16)
      // 고정 영역 35% (100% 글자)
      const pinned = await w.main.evaluate(() => {
        const vh = window.innerHeight
        let total = 0
        const all = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => ['fixed', 'sticky'].includes(getComputedStyle(el).position))
        for (const el of all) {
          if (all.some((o) => o !== el && o.contains(el))) continue
          const r = el.getBoundingClientRect()
          total += Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0))
        }
        return total
      })
      expect(pinned).toBeLessThanOrEqual(PHONE.height * 0.35)
    } finally {
      await station.context.close()
      await w.mainContext.close()
    }
  })

  test('출력 기기가 없고 대기 라벨이 있으면 "출력 기기가 아직 없어 라벨이 쌓이고 있어요. …" → 누르면 라벨 화면, 출력 기기를 정하면 사라진다', async ({ page, browser }) => {
    const w = await world(browser, page)
    const date = uniqueDate()
    const b = await broadcastApi(w.main, date)
    await w.main.goto(`/broadcasts/${encodeURIComponent(b)}`)
    await expect(w.main.getByLabel('빠른 입력')).toBeVisible()
    // 대기 라벨 0장이면 없다
    await expect(alerts(w.main).getByText(PILING)).toHaveCount(0)
    await registerApi(w.main, b, 1, '품종1', 1000)
    await smsApi(w.main, { b, no: 1, phone: '010-5100-0001' })
    const item = stationItem(w.main, PILING)
    await expect(item).toBeVisible()
    await item.click()
    await expect(w.main).toHaveURL(/\/labels$/)
    await w.main.goBack()
    await expect(item).toBeVisible()
    // 다른 기기가 출력 기기가 되면 사라진다
    const station = await androidStation(browser, w, '안드로이드 폰')
    try {
      await expect(item).toHaveCount(0)
      await expect(alerts(w.main).getByText(/출력 기기/)).toHaveCount(0)
    } finally {
      await station.context.close()
      await w.mainContext.close()
    }
  })

  test('항목이 없는 경우: 이 기기가 출력 기기 · 라벨 꺼짐 · 리허설 · 끝난 방송', async ({ page, browser }) => {
    const w = await world(browser, page)
    const station = await androidStation(browser, w, '안드로이드 폰')
    try {
      const date = uniqueDate()
      const real = await broadcastApi(w.main, date)
      const rehearsal = await broadcastApi(w.main, date, true)
      const ended = await broadcastApi(w.main, uniqueDate())
      await endBroadcastApi(w.main, ended)
      await station.context.setOffline(true)
      // 먼저 실제 방송 콘솔에서 항목이 뜨는 것을 본다 (끊김이 서버에 닿았다)
      await w.main.goto(`/broadcasts/${encodeURIComponent(real)}`)
      await expect(stationItem(w.main, lost('안드로이드 폰'))).toBeVisible({ timeout: 30_000 })
      for (const [where, b] of [['리허설', rehearsal], ['끝난 방송', ended]] as const) {
        await w.main.goto(`/broadcasts/${encodeURIComponent(b)}`)
        await expect(w.main.getByRole('region', { name: '상품 보드' }), where).toBeVisible()
        await expect(alerts(w.main).getByText(/출력 기기/), where).toHaveCount(0)
      }
      // 라벨 꺼짐
      await setLabelsApi(w.main, false)
      await w.main.goto(`/broadcasts/${encodeURIComponent(real)}`)
      await expect(w.main.getByRole('region', { name: '상품 보드' })).toBeVisible()
      await expect(alerts(w.main).getByText(/출력 기기/)).toHaveCount(0)
      await setLabelsApi(w.main, true)
      // 이 기기가 출력 기기 (끊긴 기기에서 바꿔 맡는다)
      await w.main.goto(`/broadcasts/${encodeURIComponent(real)}`)
      await expect(stationItem(w.main, lost('안드로이드 폰'))).toBeVisible({ timeout: 30_000 })
      await becomeDevice(w.main, 'PC')
      await w.main.goBack()
      await expect(w.main.getByRole('region', { name: '상품 보드' })).toBeVisible()
      await expect(alerts(w.main).getByText(/출력 기기/)).toHaveCount(0)
    } finally {
      await station.context.close()
      await w.mainContext.close()
    }
  })
})

test.describe('AC-MOB1-14 포장 접수 문장', () => {
  test('포장 모드: 출력 기기가 끊겼으면 "포장 라벨 1장 출력을 접수했어요." 바로 뒤 안내 상자에 새 문장 + "라벨 화면으로"', async ({ page, browser }) => {
    const w = await world(browser, page, PHONE)
    const station = await androidStation(browser, w, '안드로이드 폰')
    try {
      const date = uniqueDate()
      const b = await broadcastApi(w.main, date)
      await registerApi(w.main, b, 1, '품종1', 1000)
      await smsApi(w.main, { b, no: 1, phone: '010-5200-0001' })
      const view = (await (await w.main.request.get(`/api/days/${date}`)).json()) as { claims: { no: number; currentBuyer: string }[] }
      const buyer = view.claims.find((c) => c.no === 1)!.currentBuyer
      await station.context.setOffline(true)
      // 끊김이 서버에 닿을 때까지 (라벨 화면의 같은 문장으로 본다)
      await gotoLabels(w.main)
      await expect(region(w.main, '프린터')).toContainText(lost('안드로이드 폰'), { timeout: 30_000 })
      await w.main.goto(`/packing?date=${date}&buyer=${encodeURIComponent(buyer)}`)
      const label = w.main.getByRole('region', { name: '포장 라벨' })
      await label.getByRole('button', { name: '포장 라벨 출력', exact: true }).click()
      const done = label.getByRole('status').filter({ hasText: '포장 라벨 1장 출력을 접수했어요.' })
      await expect(done).toBeVisible()
      const note = label.getByRole('note').filter({ hasText: lost('안드로이드 폰') })
      await expect(note).toBeVisible()
      await expect(note.getByRole('link', { name: '라벨 화면으로' })).toBeVisible()
      // 바로 뒤 (접수 문장 다음 형제 자리)
      expect(await done.evaluate((el, other) => el.nextElementSibling === other, await note.elementHandle())).toBe(true)
      await expect(w.main.getByText('출력 기기가 아직 없어 기다리는 중이에요.', { exact: false })).toHaveCount(0)
      await note.getByRole('link', { name: '라벨 화면으로' }).click()
      await expect(w.main).toHaveURL(/\/labels$/)
    } finally {
      await station.context.close()
      await w.mainContext.close()
    }
  })

  test('포장 모드: 연결된 출력 기기면 접수 문장만(안내 상자 없음)', async ({ page, browser }) => {
    const w = await world(browser, page, PHONE)
    const station = await androidStation(browser, w, '안드로이드 폰')
    try {
      const date = uniqueDate()
      const b = await broadcastApi(w.main, date)
      await registerApi(w.main, b, 1, '품종1', 1000)
      await smsApi(w.main, { b, no: 1, phone: '010-5300-0001' })
      const view = (await (await w.main.request.get(`/api/days/${date}`)).json()) as { claims: { no: number; currentBuyer: string }[] }
      const buyer = view.claims.find((c) => c.no === 1)!.currentBuyer
      await w.main.goto(`/packing?date=${date}&buyer=${encodeURIComponent(buyer)}`)
      const label = w.main.getByRole('region', { name: '포장 라벨' })
      await label.getByRole('button', { name: '포장 라벨 출력', exact: true }).click()
      await expect(label.getByRole('status').filter({ hasText: '포장 라벨 1장 출력을 접수했어요.' })).toBeVisible()
      await expect(label.getByRole('note')).toHaveCount(0)
    } finally {
      await station.context.close()
      await w.mainContext.close()
    }
  })
})

test.describe('AC-MOB1-24 기본 기기 이름 · AC-MOB1-25 작업 줄', () => {
  test('저장한 이름이 없으면 안드로이드 "안드로이드 폰", 출력 기기가 이미 "안드로이드 폰"이면 두 번째 안드로이드는 "안드로이드 폰 2" — 그 이름으로 바꿔 맡으면 그대로, 저장한 이름은 새로 열어도 그대로', async ({ page, browser }) => {
    const w = await world(browser, page)
    const first = await newDevice(browser, baseUrlOf(w.main), { viewport: ANDROID, touch: true, userAgent: ANDROID_UA })
    const second = await newDevice(browser, baseUrlOf(w.main), { viewport: ANDROID, touch: true, userAgent: ANDROID_UA })
    try {
      await loginAs(first.page, w.seller)
      await expect(await nameField(first.page)).toHaveValue('안드로이드 폰')
      // 기본 이름 그대로 출력 기기가 된다 (becomeDevice는 이름을 다시 적는다 — 같은 값)
      await becomeDevice(first.page, '안드로이드 폰')
      await loginAs(second.page, w.seller)
      await expect(await nameField(second.page)).toHaveValue('안드로이드 폰 2')
      // 기본 이름 그대로 바꿔 맡기 — 이름 칸을 건드리지 않고 "이 기기에서 출력"
      const printer = region(second.page, '프린터')
      await printer.getByRole('button', { name: '이 기기에서 출력' }).click()
      const dlg = second.page.getByRole('dialog', { name: '출력 기기 바꾸기' })
      await expect(dlg).toBeVisible()
      await second.page.keyboard.press('1')
      await expect(printer.getByText('이 기기가 출력 기기예요')).toBeVisible()
      await expect(printer).toContainText('이 기기가 출력 기기예요 · 안드로이드 폰 2')
      await expect(w.main.request.get('/api/print').then(async (r) => ((await r.json()) as { queue: { device: { name: string } | null } }).queue.device?.name)).resolves.toBe('안드로이드 폰 2')
      // 앞 기기는 저장한 이름("안드로이드 폰") 그대로 — " 2"를 붙이지 않는다
      await first.page.reload()
      await expect(await nameField(first.page)).toHaveValue('안드로이드 폰')
    } finally {
      await first.context.close()
      await second.context.close()
      await w.mainContext.close()
    }
  })

  for (const [label, options, want] of [
    ['아이폰 사용자 에이전트', { viewport: { width: 393, height: 852 }, touch: true, userAgent: IPHONE_UA }, '아이폰'],
    ['PC 1440', { viewport: PC }, 'PC'],
    ['안드로이드·아이폰이 아닌 휴대폰 폭 375', { viewport: PHONE, touch: true }, '휴대폰'],
  ] as const) {
    test(`${label}: 기본 기기 이름 "${want}"`, async ({ page, browser }) => {
      const w = await world(browser, page)
      const dev = await newDevice(browser, baseUrlOf(w.main), options)
      try {
        await loginAs(dev.page, w.seller)
        await expect(await nameField(dev.page)).toHaveValue(want)
      } finally {
        await dev.context.close()
        await w.mainContext.close()
      }
    })
  }

  test('출력 대기열의 작업 줄: "자동 · 작업 대기"로 읽히고 "자동작업"처럼 붙은 글이 없다', async ({ page, browser }) => {
    const w = await world(browser, page)
    try {
      const date = uniqueDate()
      const b = await broadcastApi(w.main, date)
      await registerApi(w.main, b, 1, '품종1', 1000)
      await smsApi(w.main, { b, no: 1, phone: '010-5400-0001' })
      await gotoLabels(w.main)
      const row = w.main.getByRole('list', { name: '대기 작업' }).getByRole('listitem').first()
      await expect(row).toBeVisible()
      const text = (await row.textContent())!.replace(/\s+/g, ' ')
      expect(text).toContain('자동 · 작업 대기')
      expect(text).not.toMatch(/자동작업|손으로작업|포장작업/)
    } finally {
      await w.mainContext.close()
    }
  })
})
