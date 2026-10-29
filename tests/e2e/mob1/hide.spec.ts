// MOB1 휴대폰에서 숨기는 것·끝난 방송 (AC-MOB1-15·16·17, D-MOB1-09) — test-e2e.
// 기본 E2E 서버: 인스타그램 서버 준비 안 됨 · 틱톡 막힘. @multi 묶음: 인스타그램 준비됨(연결 안 함) · 틱톡 운영자 켬.
import { expect, test, type Page } from '@playwright/test'
import { e2eDate, loginAs } from '../i3/support.ts'
import { installFakeSpeech, speechCounts, turnOnVoice, voiceRegion } from '../i4/support.ts'
import { pcmCounts } from '../app1/support.ts'
import { consoleInstagram, consoleTiktok, enableTiktokApi, newTiktokId, ttLive } from '../n2b2/support.ts'
import { boardItem, history, uniqueDate } from '../s05/support.ts'
import { registerApi, smsApi } from '../s06/support.ts'
import { PC, PHONE, alerts, baseUrlOf, broadcastApi, endBroadcastApi, expectNoDevWords, freshSeller, newDevice, pendingWord } from './support.ts' // QL3R2 D-QL3R2-02 (pendingWord)

const INSTAGRAM_NOT_READY = '인스타그램 연동이 아직 준비되지 않았어요. 운영자에게 문의해 주세요.'
const REHEARSAL_LIVE = '리허설 방송에는 라이브를 이을 수 없어요.'
const EXT_PHONE = '크롬 확장은 PC 크롬에서 연결하고 설정해요.'
const EXT_REGION = '크롬 확장으로 채팅 받기'

function shortcuts(page: Page) {
  return page.getByText(/^단축키:/)
}

/** 빠른 입력 줄 전부 (입력칸·개수·단위 줄·도움말·"등록하면:" 줄) */
async function expectNoQuickRow(page: Page, where: string): Promise<void> {
  await expect(page.getByLabel('빠른 입력'), where).toHaveCount(0)
  await expect(page.getByLabel('개수', { exact: true }), where).toHaveCount(0)
  await expect(page.getByText(/^가격 단위:/), where).toHaveCount(0)
  await expect(page.getByText(/^등록하면:/), where).toHaveCount(0)
  await expect(page.locator('.quick-will-register'), `${where} "등록하면" 줄 자리`).toHaveCount(0)
}

test.describe('AC-MOB1-15 휴대폰 콘솔: 쓸 수 없는 플랫폼 칸·단축키 줄', () => {
  test('375 실제 방송: "인스타그램"·"틱톡" 칸(준비 안 됨·막힘 문장·"설정으로")과 단축키 줄이 없다 — 1440은 그대로', async ({ page, browser }) => {
    await page.goto('/')
    const { page: phone, context, seller } = await freshSeller(browser, baseUrlOf(page), { viewport: PHONE, touch: true })
    try {
      const b = await broadcastApi(phone, uniqueDate())
      await registerApi(phone, b, 1, '품종1', 1000)
      await phone.goto(`/broadcasts/${encodeURIComponent(b)}`)
      await expect(phone.getByLabel('빠른 입력')).toBeVisible()
      await expect(boardItem(phone, 1)).toBeVisible()
      await expect(consoleInstagram(phone)).toHaveCount(0)
      await expect(consoleTiktok(phone)).toHaveCount(0)
      await expect(phone.getByText(INSTAGRAM_NOT_READY)).toHaveCount(0)
      await expect(phone.getByRole('main').getByRole('button', { name: '설정으로' })).toHaveCount(0)
      await expect(phone.getByRole('main').getByRole('link', { name: '설정으로' })).toHaveCount(0)
      await expect(shortcuts(phone)).toHaveCount(0)
      await expectNoDevWords(phone, '휴대폰 콘솔')

      // 1440: 그대로
      const pc = await newDevice(browser, baseUrlOf(page), { viewport: PC })
      try {
        await loginAs(pc.page, seller, `/broadcasts/${encodeURIComponent(b)}`)
        await expect(pc.page.getByLabel('빠른 입력')).toBeVisible()
        await expect(consoleInstagram(pc.page)).toBeVisible()
        await expect(consoleInstagram(pc.page)).toContainText(INSTAGRAM_NOT_READY)
        await expect(consoleTiktok(pc.page)).toBeVisible()
        await expect(shortcuts(pc.page)).toBeVisible()
        await expect(shortcuts(pc.page)).toContainText('Alt+P') // 라벨 켬(기본)
      } finally {
        await pc.context.close()
      }
    } finally {
      await context.close()
    }
  })

  test('리허설 회차의 "리허설 방송에는 라이브를 이을 수 없어요."는 375·1440 모두 그대로', async ({ page, browser }) => {
    await page.goto('/')
    for (const viewport of [PHONE, PC]) {
      const { page: dev, context } = await freshSeller(browser, baseUrlOf(page), { viewport, touch: viewport === PHONE })
      try {
        const b = await broadcastApi(dev, uniqueDate(), true)
        await dev.goto(`/broadcasts/${encodeURIComponent(b)}`)
        await expect(dev.getByLabel('빠른 입력')).toBeVisible()
        await expect(dev.getByText(REHEARSAL_LIVE), String(viewport.width)).toBeVisible()
      } finally {
        await context.close()
      }
    }
  })

  test('375: 틱톡을 이을 수 있으면(동의·아이디) 틱톡 칸은 그대로, 연결하지 않은 인스타그램("연결 안 함" + "설정으로"뿐)은 없다 @multi', async ({ page, browser }) => {
    await page.goto('/')
    const { page: phone, context } = await freshSeller(browser, baseUrlOf(page), { viewport: PHONE, touch: true })
    try {
      const tiktokId = newTiktokId()
      await enableTiktokApi(phone, tiktokId)
      await ttLive(phone.request, tiktokId)
      const b = await broadcastApi(phone, uniqueDate())
      await phone.goto(`/broadcasts/${encodeURIComponent(b)}`)
      await expect(phone.getByLabel('빠른 입력')).toBeVisible()
      await expect(consoleTiktok(phone)).toBeVisible()
      await expect(consoleTiktok(phone).getByRole('button', { name: '틱톡 잇기' })).toBeVisible()
      await expect(consoleInstagram(phone)).toHaveCount(0)
      await expect(phone.getByText('인스타그램 계정을 먼저 연결해 주세요.')).toHaveCount(0)
    } finally {
      await context.close()
    }
  })
})

test.describe('AC-MOB1-16 휴대폰 설정: 크롬 확장 칸', () => {
  test('375: 제목과 한 줄 "크롬 확장은 PC 크롬에서 연결하고 설정해요."뿐, 쓰기 요청 없음 — 이미 코드를 만든 상태여도 서버 값 그대로, 1440은 그대로', async ({ page, browser }) => {
    await page.goto('/')
    const { page: pc, context, seller } = await freshSeller(browser, baseUrlOf(page), { viewport: PC })
    try {
      // PC에서 코드를 만들어 둔다 (서버 상태가 있다)
      await pc.goto('/settings/extension')
      const pcRegion = pc.getByRole('region', { name: EXT_REGION, exact: true })
      await pcRegion.getByRole('button', { name: '확장 연결' }).click()
      await expect(pcRegion.getByRole('group', { name: '연결 코드' })).toBeVisible()
      const before = await (await pc.request.get('/api/extension')).text()

      const phone = await newDevice(browser, baseUrlOf(page), { viewport: PHONE, touch: true })
      try {
        const writes: string[] = []
        phone.page.on('request', (r) => {
          if (r.url().includes('/api/extension') && r.method() !== 'GET') writes.push(`${r.method()} ${r.url()}`)
        })
        await loginAs(phone.page, seller, '/settings/extension')
        const region = phone.page.getByRole('region', { name: EXT_REGION, exact: true })
        await expect(region.getByRole('heading', { name: EXT_REGION })).toBeVisible()
        await expect(region.getByText(EXT_PHONE, { exact: true })).toBeVisible()
        await expect(region.getByRole('button')).toHaveCount(0)
        await expect(region.getByRole('switch')).toHaveCount(0)
        await expect(region.getByRole('checkbox')).toHaveCount(0)
        await expect(region.getByRole('group', { name: '연결 코드' })).toHaveCount(0)
        // 칸 안 글은 제목과 그 한 줄뿐
        const text = ((await region.textContent()) ?? '').replace(/\s+/g, ' ').trim()
        expect(text.replace(EXT_REGION, '').replace(EXT_PHONE, '').trim(), '제목·한 줄 밖 글').toBe('')
        await phone.page.reload()
        await expect(region.getByText(EXT_PHONE)).toBeVisible()
        expect(writes).toEqual([])
        expect(await (await pc.request.get('/api/extension')).text(), '서버 값 그대로').toBe(before)
      } finally {
        await phone.context.close()
      }
      // 1440 그대로
      await pc.reload()
      await expect(pcRegion.getByRole('button', { name: /^(확장 연결|다시 만들기|끊기)$/ }).first()).toBeVisible()
      await expect(pcRegion.getByText(EXT_PHONE)).toHaveCount(0)
    } finally {
      await context.close()
    }
  })
})

test.describe('AC-MOB1-17 끝난 방송 콘솔', () => {
  for (const [label, viewport] of [['PC 1440', PC], ['휴대폰 375', PHONE]] as const) {
    test(`${label}: 끝난 실제 방송 — 빠른 입력 줄·"음성 켜기"가 없고 알림 띠·상품 보드·채팅·"영수증 보내기"는 그대로, 상품 자세히 → "고치기" 저장은 된다`, async ({ page, browser }) => {
      await page.goto('/')
      const { page: dev, context } = await freshSeller(browser, baseUrlOf(page), { viewport, touch: viewport === PHONE })
      try {
        const date = uniqueDate()
        const b = await broadcastApi(dev, date)
        await registerApi(dev, b, 3, '핑크프릴', 10000)
        await smsApi(dev, { b, no: 40, memo: '보류' }) // 노란 알림 하나
        await endBroadcastApi(dev, b)
        await dev.goto(`/broadcasts/${encodeURIComponent(b)}`)
        await expect(dev.getByText('끝난 방송이에요')).toBeVisible()
        await expect(boardItem(dev, 3)).toBeVisible()
        await expectNoQuickRow(dev, label)
        await expect(dev.getByRole('button', { name: '음성 켜기', exact: true })).toHaveCount(0)
        await expect(alerts(dev)).toBeVisible()
        await expect(alerts(dev).getByRole('button', { name: `${pendingWord(dev)} 1`, exact: true })).toHaveCount(1) // QL3R2 D-QL3R2-02
        await expect(dev.getByRole('region', { name: '상품 보드' })).toBeVisible()
        await expect(dev.getByRole('link', { name: '영수증 보내기' })).toBeVisible()
        await expectNoDevWords(dev, `${label} 끝난 콘솔`)
        // 상품 고치기 길은 남는다
        await boardItem(dev, 3).click()
        await dev.getByRole('dialog', { name: '3번 자세히' }).getByRole('button', { name: '고치기', exact: true }).click()
        const form = dev.getByRole('dialog', { name: '3번 고치기' })
        await expect(form).toBeVisible()
        await form.getByLabel('가격').fill('12000')
        await form.getByRole('button', { name: '고치기', exact: true }).click()
        await expect(form).toHaveCount(0)
        await expect(boardItem(dev, 3)).toContainText('12,000')
        const updates = (await history(dev, date, false)).filter((e) => e.type === 'product.update')
        expect(updates).toHaveLength(1)
      } finally {
        await context.close()
      }
    })
  }

  test('봉인한 날짜 콘솔(375): 빠른 입력 줄·"음성 켜기"가 없다', async ({ page, browser }) => {
    await page.goto('/')
    const { page: dev, context, seller } = await freshSeller(browser, baseUrlOf(page), { viewport: PHONE, touch: true })
    try {
      const sealed = await e2eDate(dev.request, seller.loginId, 'sealed')
      await dev.goto(`/broadcasts/${encodeURIComponent(sealed.broadcast)}`)
      await expect(dev.getByRole('region', { name: '상품 보드' })).toBeVisible()
      await expectNoQuickRow(dev, '봉인 날짜')
      await expect(dev.getByRole('button', { name: '음성 켜기', exact: true })).toHaveCount(0)
    } finally {
      await context.close()
    }
  })

  test('AC-MOB1-17 → APP1 ENDED: 다른 기기에서 방송을 끝내면 1초 안에 빠른 입력 줄이 사라지고 치던 글은 보내지 않는다 — 음성도 꺼지고 다시 잇지 않는다', async ({ page, browser }) => {
    await page.goto('/')
    const { page: dev, context } = await freshSeller(browser, baseUrlOf(page), { viewport: PC })
    try {
      await installFakeSpeech(dev, { consent: true })
      await dev.clock.install()
      const date = uniqueDate()
      const b = await broadcastApi(dev, date)
      await dev.goto(`/broadcasts/${encodeURIComponent(b)}`)
      const input = dev.getByLabel('빠른 입력')
      await expect(input).toBeFocused()
      // 진행 중에는 늘 활성
      await expect(input).toBeEnabled()
      await turnOnVoice(dev)
      await input.fill('5 치던상품 5000')
      await endBroadcastApi(dev, b)
      await expect(dev.getByText('끝난 방송이에요')).toBeVisible()
      await expect(input).toHaveCount(0, { timeout: 1_000 })
      await expectNoQuickRow(dev, '끝난 뒤')
      // APP1 ENDED·APP1b-16: 서버가 방송 종료와 함께 캡처/읽기 흐름을 끝낸다.
      await expect(voiceRegion(dev)).toHaveCount(0)
      await expect.poll(async () => (await pcmCounts(dev)).openSockets).toBe(0)
      await expect.poll(async () => { const counts = await speechCounts(dev); return counts.stops + counts.aborts }).toBeGreaterThan(0)
      await expect(dev.getByRole('button', { name: '음성 켜기', exact: true })).toHaveCount(0)
      await dev.keyboard.press('Enter')
      // 보내지 않았다 (치던 글은 버림)
      expect((await history(dev, date, false)).filter((e) => e.type === 'product.register')).toEqual([])
      await expect(boardItem(dev, 5)).toHaveCount(0)
      // 종료는 재시도 대상이 아니다. 새 연결/캡처와 늦은 쓰기가 없어야 한다.
      const connections = (await pcmCounts(dev)).sockets
      const starts = (await speechCounts(dev)).starts
      await dev.clock.runFor(10_000)
      expect((await pcmCounts(dev)).sockets).toBe(connections)
      expect((await speechCounts(dev)).starts).toBe(starts)
      expect((await history(dev, date, false)).filter((e) => e.type === 'product.register')).toEqual([])
      await expect(voiceRegion(dev)).toHaveCount(0)
      await expect(dev.getByRole('button', { name: '음성 켜기', exact: true })).toHaveCount(0)
    } finally {
      await context.close()
    }
  })
})
