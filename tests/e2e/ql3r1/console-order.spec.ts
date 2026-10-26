// QL3R1 휴대폰 콘솔 차례 (AC-QL3R1-20·21, D-QL3R1-03, U-QL3-03) — test-e2e.
// 휴대폰: 고정 영역 → 단위 줄 → 현재 상품 → (음성 켜짐이면) 음성 칸 → 상품 보드 → 채팅 → 행동 줄 → (리허설이면) 리허설 조작판 → 유튜브 칸 → 인스타그램·틱톡 칸.
// DOM 차례와 화면 y 차례가 같고(양수 tabindex 없음 = Tab 차례도 같음), 393×852 100%에서 상품 보드 제목 위 끝이 BASE(1199px)보다 위.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { uniqueDate } from '../s05/support.ts'
import { registerApi, smsApi, viewerClaim } from '../s06/support.ts'
import { installFakeSpeech, turnOnVoice, voiceRegion } from '../i4/support.ts'
import { broadcastApi, expectOrder, setLabelsApi } from '../ql2/support.ts'
import { D1440, D375, D393, D412, docTop, openConsole, registerStock, sellerOn, type Device } from './support.ts'

type Kind = '실제' | '음성 켜짐' | '리허설'

async function world(dev: Page, kind: Kind): Promise<string> {
  const rehearsal = kind === '리허설'
  const b = await broadcastApi(dev, uniqueDate(), rehearsal)
  await setLabelsApi(dev, false)
  await registerApi(dev, b, 16, '청보석', 20000)
  await registerStock(dev, b, 15, '핑크프릴', 10000, 2)
  if (rehearsal) await viewerClaim(dev, b, '밤톨맘', '15', `sim_ql3r1_order_${String(Date.now())}`)
  else await smsApi(dev, { b, no: 15, memo: '밤톨맘' })
  return b
}

/** 차례를 볼 칸들 (있는 것만 — 플랫폼 칸은 서버 설정에 따라 없을 수 있다) */
async function parts(dev: Page, kind: Kind): Promise<(readonly [string, Locator])[]> {
  const main = dev.getByRole('main')
  const list: (readonly [string, Locator])[] = [
    ['단위 줄', dev.getByText(/^가격 단위: /)],
    ['현재 상품', dev.getByRole('region', { name: '현재 상품' })],
    ...(kind === '음성 켜짐' ? [['음성 칸', voiceRegion(dev)] as const] : []),
    ['상품 보드', dev.getByRole('region', { name: '상품 보드' })],
    ['채팅', dev.getByRole('region', { name: '채팅' })],
    ['방송 목록', main.getByRole('link', { name: '방송 목록', exact: true })],
    ['상품 목록 가져오기', main.getByRole('button', { name: '상품 목록 가져오기', exact: true })],
    ['방송 끝내기', main.getByRole('button', { name: '방송 끝내기', exact: true })],
    ...(kind === '음성 켜짐' ? [] : [['음성 켜기', main.getByRole('button', { name: '음성 켜기', exact: true })] as const]),
    ...(kind === '리허설' ? [['리허설 조작판', dev.getByRole('region', { name: '리허설 조작판' })] as const] : []),
  ]
  for (const [name, target] of [
    ['여러 플랫폼 안내', main.getByRole('note').filter({ hasText: '플랫폼' })],
    ['유튜브 칸', dev.getByRole('region', { name: '유튜브', exact: true })],
    ['인스타그램·틱톡 칸', dev.getByRole('region', { name: /^(인스타그램·틱톡|인스타그램|틱톡)$/ }).first()],
  ] as const) {
    if ((await target.count()) > 0) list.push([name, target.first()])
  }
  return list
}

async function expectPhoneOrder(dev: Page, kind: Kind, where: string): Promise<void> {
  const items = await parts(dev, kind)
  for (const [name, target] of items) await expect(target, `${where} ${name}`).toHaveCount(1)
  // 고정 영역은 맨 앞 (DOM)
  const stickyBox = dev.locator('main .console-sticky')
  await expectOrder([['고정 영역', stickyBox], ...items], `${where} DOM 차례`)
  // 화면 y 차례 (문서 기준 위 끝) — 같은 줄의 행동 단추는 같은 y일 수 있다(≤)
  const ys: { name: string; y: number }[] = []
  for (const [name, target] of items) ys.push({ name, y: await docTop(target) })
  for (let i = 1; i < ys.length; i += 1) {
    expect(ys[i]!.y, `${where} y 차례: "${ys[i - 1]!.name}" ${String(Math.round(ys[i - 1]!.y))} → "${ys[i]!.name}" ${String(Math.round(ys[i]!.y))}`).toBeGreaterThanOrEqual(ys[i - 1]!.y - 0.5)
  }
  // 문서 차례 = Tab 차례: 양수 tabindex가 없고, CSS order로 자리를 바꾸지 않았다(위 y 차례)
  expect(await dev.locator('main [tabindex]:not([tabindex="0"]):not([tabindex="-1"])').count(), `${where} 양수 tabindex`).toBe(0)
}

const PHONES: readonly Device[] = [D375, D412]

test.describe('AC-QL3R1-20 휴대폰 차례 — 현재 상품 다음 상품 보드·채팅, 그 뒤 행동 줄', () => {
  for (const device of PHONES) {
    for (const kind of ['실제', '음성 켜짐', '리허설'] as const) {
      test(`${device.label} 글자 100% ${kind}: 고정 영역 → 단위 줄 → 현재 상품 →${kind === '음성 켜짐' ? ' 음성 칸 →' : ''} 상품 보드 → 채팅 → 행동 줄${kind === '리허설' ? ' → 리허설 조작판' : ''} → 플랫폼 칸 (DOM·y 같은 차례)`, async ({ page, browser }) => {
        const s = await sellerOn(browser, page, device, false)
        try {
          if (kind === '음성 켜짐') await installFakeSpeech(s.context, { consent: true })
          const b = await world(s.dev, kind)
          await openConsole(s.dev, b, false)
          if (kind === '음성 켜짐') await turnOnVoice(s.dev)
          await expectPhoneOrder(s.dev, kind, `${device.label} ${kind}`)
          // 현재 상품 카드 바로 다음이 상품 보드 (음성 꺼짐) — 사이에 다른 칸이 없다
          if (kind !== '음성 켜짐') {
            const between = await s.dev.getByRole('region', { name: '현재 상품' }).evaluate((card) => {
              const board = document.querySelector('[aria-label="상품 보드"]')
              if (board === null) return ['보드 없음']
              const out: string[] = []
              for (let el = card.nextElementSibling; el !== null && el !== board && !el.contains(board); el = el.nextElementSibling) {
                const r = el.getBoundingClientRect()
                if (r.height > 0 && r.width > 0) out.push(`${el.tagName}.${el.className} "${(el.textContent ?? '').trim().slice(0, 20)}"`)
              }
              return out
            })
            expect(between, `${device.label} ${kind}: 현재 상품과 상품 보드 사이에 보이는 칸`).toEqual([])
          }
        } finally {
          await s.close()
        }
      })
    }
  }

  for (const kind of ['실제', '리허설'] as const) {
    test(`393×852 WebKit 글자 100% ${kind}: 같은 차례, 상품 보드 제목 위 끝 < 1199px(BASE) @webkit`, async ({ page, browser }) => {
      const s = await sellerOn(browser, page, D393, false)
      try {
        const b = await world(s.dev, kind)
        await openConsole(s.dev, b, false)
        await expectPhoneOrder(s.dev, kind, `393 WebKit ${kind}`)
        const heading = s.dev.getByRole('region', { name: '상품 보드' }).getByRole('heading').first()
        const y = await docTop(heading)
        expect(y, `393 WebKit ${kind}: 상품 보드 제목 위 끝 ${String(Math.round(y))}px`).toBeLessThan(1199)
        const card = s.dev.getByRole('region', { name: '현재 상품' })
        const cardBottom = await card.evaluate((el) => el.getBoundingClientRect().bottom + window.scrollY)
        const board = await docTop(s.dev.getByRole('region', { name: '상품 보드' }))
        expect(board - cardBottom, `393 WebKit ${kind}: 현재 상품 카드 아래 끝 ${String(Math.round(cardBottom))} → 상품 보드 ${String(Math.round(board))}`).toBeLessThanOrEqual(48)
        expect(board, '보드가 카드 아래').toBeGreaterThanOrEqual(cardBottom - 0.5)
      } finally {
        await s.close()
      }
    })
  }

  test('412×915 실제: 행동 줄의 "방송 끝내기" 확인 창은 그대로 — 처음 초점 "닫기", Esc로 닫힘', async ({ page, browser }) => {
    const s = await sellerOn(browser, page, D412, false)
    try {
      const b = await world(s.dev, '실제')
      await openConsole(s.dev, b, false)
      await s.dev.getByRole('button', { name: '방송 끝내기', exact: true }).click()
      const dlg = s.dev.getByRole('dialog')
      await expect(dlg).toBeVisible()
      await expect(dlg.getByRole('button', { name: '닫기' })).toBeFocused()
      await s.dev.keyboard.press('Escape')
      await expect(dlg).toHaveCount(0)
    } finally {
      await s.close()
    }
  })
})

test.describe('AC-QL3R1-21 PC 배치 그대로', () => {
  test('1440×900: 행동 줄은 제목 옆, 현재 상품은 왼쪽 열, 상품 보드·채팅은 그 오른쪽 (같은 격자)', async ({ page, browser }) => {
    const s = await sellerOn(browser, page, D1440, false)
    try {
      const b = await world(s.dev, '실제')
      await openConsole(s.dev, b, false)
      const dev = s.dev
      const h1 = (await dev.getByRole('heading', { level: 1 }).boundingBox())!
      const list = (await dev.getByRole('main').getByRole('link', { name: '방송 목록', exact: true }).boundingBox())!
      expect(list.y, '"방송 목록"이 제목 줄').toBeLessThan(h1.y + h1.height)
      expect(list.y + list.height, '"방송 목록"이 제목 줄').toBeGreaterThan(h1.y)
      const current = (await dev.getByRole('region', { name: '현재 상품' }).boundingBox())!
      const board = (await dev.getByRole('region', { name: '상품 보드' }).boundingBox())!
      const chat = (await dev.getByRole('region', { name: '채팅' }).boundingBox())!
      expect(current.x + current.width / 2, '현재 상품은 왼쪽 열').toBeLessThan(1440 / 2)
      expect(board.x, '상품 보드는 현재 상품 오른쪽').toBeGreaterThanOrEqual(current.x + current.width - 1)
      expect(chat.x, '채팅은 상품 보드 오른쪽').toBeGreaterThanOrEqual(board.x + board.width - 1)
      // 상품 보드·채팅은 같은 격자(console-grid) 안
      expect(await dev.locator('main .console-grid [aria-label="상품 보드"]').count()).toBe(1)
      expect(await dev.locator('main .console-grid [aria-label="채팅"]').count()).toBe(1)
    } finally {
      await s.close()
    }
  })
})
