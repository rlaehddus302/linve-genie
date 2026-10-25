// QL2 휴대폰 콘솔 첫 화면 — 현재 상품 (AC-QL2-01~04, D-QL2-01, UX-04) — test-e2e.
// 기기: 375×812·412×915 크로미움(터치), 글자 150%·100%. 393×852 WebKit(@webkit 묶음 — devices['iPhone 15'])은 100%. PC 1440×900.
// "보인다(첫 화면)"는 공통 전제의 뜻(support.ts expectFirstScreen) — 아래 메뉴 막대에 가리지 않음.
import { expect, test, type Browser, type Page } from '@playwright/test'
import { postJson, uniqueDate } from '../s05/support.ts'
import { registerApi, smsApi } from '../s06/support.ts'
import { IPHONE_UA } from '../mob1/support.ts'
import { ANDROID, PC, PHONE, alerts, baseUrlOf, broadcastApi, endBroadcastApi, expectBig, expectFirstScreen, expectNoOverflow, expectOrder, freshSeller, setLabelsApi } from './support.ts'

const IPHONE = { width: 393, height: 852 } as const
const HACKER = '<b>해커</b>'

interface Options {
  readonly viewport: { readonly width: number; readonly height: number }
  readonly big: boolean
  readonly rehearsal?: boolean
  readonly userAgent?: string
}

/**
 * AC-QL2-01 Given: 진행 중 방송, 세는 알림 둘(출력 멈춤 1·보류 찜 1 — 접힌 띠), 15번 "핑크프릴" 10,000원을 마지막에 등록하고 1등 `<b>해커</b>`.
 * 음성 꺼짐(기본), 되돌리기 대기 없음(API 등록), 고치기 칸 닫힘. 충돌은 실제 방송에서 채팅 없이 만들 수 없어 "예: 충돌 1" 대신 출력 멈춤(판매자)을 쓴다.
 * 라벨 켬 + 출력 기기 없음이라 띠 끝에 출력 기기 없음 항목(세지 않음)도 붙는다 — 실제 방송 하루의 흔한 모양.
 */
async function consoleWorld(browser: Browser, page: Page, options: Options): Promise<{ dev: Page; close: () => Promise<void>; b: string }> {
  await page.goto('/')
  const { page: dev, context } = await freshSeller(browser, baseUrlOf(page), {
    viewport: options.viewport,
    touch: options.viewport.width < 768,
    big: options.big,
    ...(options.userAgent === undefined ? {} : { userAgent: options.userAgent }),
  })
  await setLabelsApi(dev, true)
  const b = await broadcastApi(dev, uniqueDate(), options.rehearsal === true)
  expect((await postJson(dev, '/api/print/pause', {})).status).toBeLessThan(300)
  await registerApi(dev, b, 16, '청보석', 20000)
  await smsApi(dev, { b, no: 16, memo: '갑' })
  // 보류 찜 (등록 안 한 번호)
  await smsApi(dev, { b, no: 40, memo: '병' })
  await registerApi(dev, b, 15, '핑크프릴', 10000)
  await smsApi(dev, { b, no: 15, memo: HACKER })
  await dev.goto(`/broadcasts/${encodeURIComponent(b)}`)
  await expect(dev.getByLabel('빠른 입력')).toBeVisible()
  if (options.big) await expectBig(dev)
  const strip = alerts(dev)
  await expect(strip.getByRole('button', { name: /^출력 멈춤 · / })).toHaveCount(1)
  await expect(strip.getByRole('button', { name: /^보류 찜 1$/ })).toHaveCount(1)
  if (options.viewport.width < 768) await expect(dev.getByRole('button', { name: '알림 2 펼치기', exact: true })).toHaveAttribute('aria-expanded', 'false')
  const current = dev.getByRole('region', { name: '현재 상품' })
  await expect(current.getByText('15번', { exact: true })).toBeVisible()
  await expect(current.getByText(/^1등: /)).toContainText(HACKER)
  // 스크롤 0 (포커스·자동 스크롤이 내려 놓지 않았는지는 expectFirstScreen이 본다)
  await dev.evaluate(() => window.scrollTo(0, 0))
  return { dev, b, close: () => context.close() }
}

async function expectCurrentOnFirstScreen(dev: Page, where: string): Promise<void> {
  const current = dev.getByRole('region', { name: '현재 상품' })
  await expectFirstScreen(dev, current.getByText('15번', { exact: true }), `${where} 번호 "15번"`)
  await expectFirstScreen(dev, current.getByText('핑크프릴', { exact: true }), `${where} 이름 "핑크프릴"`)
  const winner = current.getByText(/^1등: /)
  await expectFirstScreen(dev, winner, `${where} "1등: " 줄`)
  // 1등 이름은 글자 그대로 (굵게 바뀌지 않음 — 절대 규칙 7). 문자찜 구매자는 메모가 이름 안에 든다
  await expect(winner).toContainText(HACKER)
  expect(await current.locator('b, script').count(), `${where} 이름이 HTML로 해석됨`).toBe(0)
}

test.describe('AC-QL2-01 첫 화면에 현재 상품 번호·이름·1등', () => {
  for (const [label, viewport] of [['375×812', PHONE], ['412×915', ANDROID]] as const) {
    for (const big of [true, false]) {
      test(`${label} 글자 ${big ? '150%' : '100%'}: 실제 방송 진행 중 — "15번"·"핑크프릴"·"1등: <b>해커</b>"가 아래 막대에 가리지 않고 보인다`, async ({ page, browser }) => {
        const w = await consoleWorld(browser, page, { viewport, big })
        try {
          await expectCurrentOnFirstScreen(w.dev, `${label} ${big ? '150%' : '100%'}`)
        } finally {
          await w.close()
        }
      })
    }
    test(`${label} 글자 150%: 리허설 방송 — 같은 기준, 리허설 조작판은 현재 상품 아래`, async ({ page, browser }) => {
      const w = await consoleWorld(browser, page, { viewport, big: true, rehearsal: true })
      try {
        const panel = w.dev.getByRole('region', { name: '리허설 조작판' })
        await expect(panel).toBeVisible()
        await expectOrder([['현재 상품', w.dev.getByRole('region', { name: '현재 상품' })], ['리허설 조작판', panel]], `${label} 리허설`)
        await expectCurrentOnFirstScreen(w.dev, `${label} 150% 리허설`)
      } finally {
        await w.close()
      }
    })
  }

  test('393×852 WebKit 글자 100%: 같은 기준 @webkit', async ({ page, browser }) => {
    const w = await consoleWorld(browser, page, { viewport: IPHONE, big: false, userAgent: IPHONE_UA })
    try {
      await expectCurrentOnFirstScreen(w.dev, '393 WebKit')
      await expectNoOverflow(w.dev, '393 WebKit 콘솔')
    } finally {
      await w.close()
    }
  })
})

test.describe('AC-QL2-02 차례', () => {
  test('375×812 진행 중 리허설 방송: h1 → 알림 띠·빠른 입력 → 단위 줄 → 현재 상품 → 방송 목록·상품 목록 가져오기·방송 끝내기 → 리허설 조작판 → 상품 보드', async ({ page, browser }) => {
    const w = await consoleWorld(browser, page, { viewport: PHONE, big: false, rehearsal: true })
    try {
      const dev = w.dev
      const h1 = dev.getByRole('heading', { level: 1 })
      await expectOrder(
        [
          ['h1', h1],
          ['알림', alerts(dev)],
          ['빠른 입력', dev.getByLabel('빠른 입력')],
          ['단위 줄', dev.getByText(/^가격 단위: /)],
          ['현재 상품', dev.getByRole('region', { name: '현재 상품' })],
          ['방송 목록', dev.getByRole('main').getByRole('link', { name: '방송 목록', exact: true })],
          ['상품 목록 가져오기', dev.getByRole('button', { name: '상품 목록 가져오기', exact: true })],
          ['방송 끝내기', dev.getByRole('button', { name: '방송 끝내기', exact: true })],
          ['리허설 조작판', dev.getByRole('region', { name: '리허설 조작판' })],
          ['상품 보드', dev.getByRole('region', { name: '상품 보드' })],
        ],
        '375 차례',
      )
      // 문서 차례 = Tab 차례: 양수 tabindex가 없다
      expect(await dev.locator('main [tabindex]:not([tabindex="0"]):not([tabindex="-1"])').count()).toBe(0)
      // "방송 끝내기"의 확인 창은 그대로
      await dev.getByRole('button', { name: '방송 끝내기', exact: true }).click()
      const dlg = dev.getByRole('dialog')
      await expect(dlg).toBeVisible()
      await expect(dlg.getByRole('button', { name: '닫기' })).toBeFocused()
      await dev.keyboard.press('Escape')
      await expect(dlg).toHaveCount(0)
    } finally {
      await w.close()
    }
  })

  test('375×812 실제 방송: 현재 상품 다음 행동 줄, 그 뒤 상품 보드 — 카드 안은 "현재 상품" → "15번" → 이름 → "1등: …" → 가격 → 상태 → "대기 n명" → "15번 자세히"', async ({ page, browser }) => {
    const w = await consoleWorld(browser, page, { viewport: PHONE, big: false })
    try {
      const dev = w.dev
      await expectOrder(
        [
          ['단위 줄', dev.getByText(/^가격 단위: /)],
          ['현재 상품', dev.getByRole('region', { name: '현재 상품' })],
          ['방송 목록', dev.getByRole('main').getByRole('link', { name: '방송 목록', exact: true })],
          ['방송 끝내기', dev.getByRole('button', { name: '방송 끝내기', exact: true })],
          ['상품 보드', dev.getByRole('region', { name: '상품 보드' })],
        ],
        '375 실제',
      )
      await expectCardOrder(dev, '375')
    } finally {
      await w.close()
    }
  })

  test('375×812 끝난 방송: "끝난 방송이에요"·"영수증 보내기"가 현재 상품 아래, 누르면 영수증 화면', async ({ page, browser }) => {
    const w = await consoleWorld(browser, page, { viewport: PHONE, big: false })
    try {
      const dev = w.dev
      await endBroadcastApi(dev, w.b)
      await dev.reload()
      const ended = dev.getByText('끝난 방송이에요', { exact: true })
      await expect(ended).toBeVisible()
      const receipts = dev.getByRole('link', { name: '영수증 보내기', exact: true })
      const current = dev.getByRole('region', { name: '현재 상품' })
      await expectOrder([['현재 상품', current], ['끝난 방송이에요', ended], ['영수증 보내기', receipts]], '375 끝난 방송')
      await receipts.click()
      await expect(dev).toHaveURL(new RegExp(`/broadcasts/${encodeURIComponent(w.b)}/receipts$`))
    } finally {
      await w.close()
    }
  })

  test('1440×900 PC: 행동 줄은 제목 옆, 현재 상품은 왼쪽 열 — 카드 안 차례는 휴대폰과 같다', async ({ page, browser }) => {
    const w = await consoleWorld(browser, page, { viewport: PC, big: false })
    try {
      const dev = w.dev
      const h1 = dev.getByRole('heading', { level: 1 })
      const list = dev.getByRole('main').getByRole('link', { name: '방송 목록', exact: true })
      const current = dev.getByRole('region', { name: '현재 상품' })
      // 행동 줄이 제목 옆: 문서 차례 h1 → 방송 목록 → 알림 띠 → 현재 상품, 같은 줄 높이
      await expectOrder([['h1', h1], ['방송 목록', list], ['알림', alerts(dev)], ['현재 상품', current]], 'PC 차례')
      const hb = (await h1.boundingBox())!
      const lb = (await list.boundingBox())!
      expect(lb.y, '"방송 목록"이 제목 줄에').toBeLessThan(hb.y + hb.height)
      expect(lb.y + lb.height, '"방송 목록"이 제목 줄에').toBeGreaterThan(hb.y)
      expect(lb.x, '"방송 목록"이 제목 오른쪽').toBeGreaterThan(hb.x)
      // 현재 상품은 왼쪽 열
      const cb = (await current.boundingBox())!
      expect(cb.x + cb.width / 2, '현재 상품은 왼쪽 열').toBeLessThan(PC.width / 2)
      await expectCardOrder(dev, 'PC')
    } finally {
      await w.close()
    }
  })
})

/** 카드 안 차례 (보이는 줄 글자로) */
async function expectCardOrder(dev: Page, where: string): Promise<void> {
  const current = dev.getByRole('region', { name: '현재 상품' })
  const lines = (await current.innerText()).split('\n').map((x) => x.trim()).filter((x) => x !== '')
  const at = (match: (line: string) => boolean, name: string): number => {
    const i = lines.findIndex(match)
    expect(i, `${where} 카드에 ${name} (${lines.join(' | ')})`).toBeGreaterThanOrEqual(0)
    return i
  }
  const title = at((l) => l === '현재 상품', '"현재 상품"')
  const no = at((l) => l === '15번', '"15번"')
  const name = at((l) => l === '핑크프릴', '이름')
  const winner = at((l) => l.startsWith('1등: '), '"1등: …"')
  const price = at((l) => l === '10,000원', '가격')
  const wait = at((l) => /^대기 \d+명$/.test(l), '"대기 n명"')
  const more = at((l) => l === '15번 자세히', '"15번 자세히"')
  const order = [title, no, name, winner, price, wait, more]
  expect(order, `${where} 카드 차례 (${lines.join(' | ')})`).toEqual([...order].sort((a, b) => a - b))
  // 가격과 "대기" 사이에 상태 한 줄
  expect(wait - price, `${where} 가격 → 상태 → 대기 (${lines.join(' | ')})`).toBe(2)
  expect(['공개 전', '판매 중', '판매 완료', '일시 중지', '판매 종료']).toContain(lines[price + 1])
}

test.describe('AC-QL2-03·04 고정 영역 그대로·가로 넘침 0', () => {
  test('375×812 글자 100%: 고정 영역 합 ≤ 284px, 알림 띠·빠른 입력·개수 칸이 그대로 있다', async ({ page, browser }) => {
    const w = await consoleWorld(browser, page, { viewport: PHONE, big: false })
    try {
      const dev = w.dev
      await expect(alerts(dev)).toBeVisible()
      await expect(dev.getByLabel('빠른 입력')).toBeVisible()
      await expect(dev.getByLabel('개수', { exact: true })).toBeVisible()
      const total = await dev.evaluate(() => {
        const vh = window.innerHeight
        const pinned = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => ['fixed', 'sticky'].includes(getComputedStyle(el).position))
        let sum = 0
        for (const el of pinned) {
          if (pinned.some((other) => other !== el && other.contains(el))) continue
          const r = el.getBoundingClientRect()
          sum += Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0))
        }
        return sum
      })
      expect(total).toBeLessThanOrEqual(284)
    } finally {
      await w.close()
    }
  })

  for (const [label, viewport] of [['375×812', PHONE], ['412×915', ANDROID]] as const) {
    for (const big of [true, false]) {
      test(`${label} 글자 ${big ? '150%' : '100%'}: 콘솔 가로 넘침 0 (띠 접음·펼침)`, async ({ page, browser }) => {
        const w = await consoleWorld(browser, page, { viewport, big })
        try {
          await expectNoOverflow(w.dev, `${label} 콘솔(접음)`)
          await w.dev.getByRole('button', { name: /^알림 \d+ 펼치기$/ }).click()
          await expect(w.dev.getByRole('button', { name: /^알림 \d+ 접기$/ })).toBeVisible()
          await expectNoOverflow(w.dev, `${label} 콘솔(펼침)`)
        } finally {
          await w.close()
        }
      })
    }
  }
})
