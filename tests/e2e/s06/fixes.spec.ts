// S05 지적 정리·서버 몫 (AC-S06-60·61·62·63·65·66·67·70·71) — test-e2e.
import { test, expect, type Page } from '@playwright/test'
import {
  board, boardItem, history, login, newBroadcast, openNewBroadcast, postJson, register, registerApi, sendViewerChat, smsApi, uniqueDate, untilElapsed, viewerClaim, writeEvent,
} from './support.ts'

async function slowWrites(page: Page, ms: number): Promise<void> {
  await page.route('**/api/events**', async (route) => {
    await new Promise((r) => setTimeout(r, ms))
    await route.continue()
  })
}

test.describe('S05 지적 정리', () => {
  test('AC-S06-63: 번호 + Enter로 자세히 → 1등 "찜 취소하기" → 숫자 키 사유 → Enter (대기 시작)까지 키 8번 이하', async ({ page }) => {
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true })
    await register(page, '15 핑크프릴 10000', 15)
    await sendViewerChat(page, b, '홍길동', '15')
    await expect(boardItem(page, 15)).toContainText('홍길동')
    await page.getByLabel('빠른 입력').focus()
    const keys = ['1', '5', 'Enter', 'Tab', 'Enter', '1', 'Enter']
    // SRV1 (D-APP-24): 번호 + Enter는 서버가 줄을 읽은 답으로 자세히를 연다 — 키 수는 그대로 두고, 창이 열린 뒤 다음 키를 누른다(사람도 창을 보고 누른다)
    for (const [i, key] of keys.entries()) {
      await page.keyboard.press(key)
      if (i === 2) await expect(page.getByRole('dialog', { name: '15번 자세히' })).toBeVisible()
    }
    expect(keys.length).toBeLessThanOrEqual(8)
    await expect(page.getByRole('region', { name: '보내기 전 조치' }).getByText(/초 뒤 보내요/)).toBeVisible()
    await expect(boardItem(page, 15)).not.toContainText('홍길동', { timeout: 15_000 })
    const cancels = (await history(page, date, true)).filter((e) => e.type === 'host.cancel')
    expect(cancels).toHaveLength(1)
    expect(cancels[0]!.reason).toBe('시청자 요청')
  })

  test('AC-S06-60·63: 창 안에 "취소"·"확인" 한 낱말 버튼이 없고, 사유 글 칸 안의 숫자는 글자로 들어간다', async ({ page }) => {
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true })
    await register(page, '15 핑크프릴 10000', 15)
    await sendViewerChat(page, b, '홍길동', '15')
    await sendViewerChat(page, b, '둘째', '15')
    await expect(boardItem(page, 15)).toContainText('대기 1')
    await boardItem(page, 15).click()
    const detail = page.getByRole('dialog', { name: '15번 자세히' })
    for (const bad of ['취소', '확인']) await expect(detail.getByRole('button', { name: bad, exact: true })).toHaveCount(0)
    await detail.getByRole('button', { name: '찜 취소하기' }).first().click()
    const reason = page.getByRole('dialog').last()
    for (const bad of ['취소', '확인']) await expect(reason.getByRole('button', { name: bad, exact: true })).toHaveCount(0)
    await reason.getByLabel('사유').fill('')
    await reason.getByLabel('사유').pressSequentially('2번 착오')
    await expect(reason.getByLabel('사유')).toHaveValue('2번 착오')
    await reason.getByRole('button', { name: '닫기' }).click()
  })

  test('AC-S06-65: 번호 빠진 줄·범위 밖 번호 줄의 고치기 칸 채우기 (코어로 읽은 품종·가격)', async ({ page }) => {
    await login(page)
    const date = uniqueDate()
    await newBroadcast(page, { date })
    const input = page.getByLabel('빠른 입력')
    const fix = page.getByRole('group', { name: '고치기 칸' })
    await input.fill('핑크프릴 10000')
    await input.press('Enter')
    await expect(fix.getByLabel('번호')).toHaveValue('')
    await expect(fix.getByLabel('품종')).toHaveValue('핑크프릴')
    await expect(fix.getByLabel('번호')).toBeFocused()
    await fix.getByLabel('번호').fill('41')
    await fix.getByLabel('번호').press('Enter')
    await expect(boardItem(page, 41)).toContainText('핑크프릴')
    await expect(boardItem(page, 41)).toContainText('10,000원')
    await input.fill('1000 장미 10')
    await input.press('Enter')
    await expect(fix.getByLabel('번호')).toHaveValue('1000')
    await expect(fix.getByLabel('품종')).toHaveValue('장미')
    await fix.getByLabel('번호').fill('42')
    await fix.getByLabel('번호').press('Enter')
    await expect(boardItem(page, 42)).toContainText('장미')
    await expect(boardItem(page, 42)).toContainText('10,000원')
    // 가격을 읽지 못하면 품종은 나머지 전부, 가격 칸은 비움
    await input.fill('0 핑크 프릴 비쌈')
    await input.press('Enter')
    await expect(fix.getByLabel('번호')).toHaveValue('0')
    await expect(fix.getByLabel('품종')).toHaveValue('핑크 프릴 비쌈')
    await expect(fix.getByLabel('가격')).toHaveValue('')
  })

  test('AC-S06-66: 보류 찜 창 첫 그림부터 경과 초, 끝난 방송 글자는 상태, 로그인 칸 커서, 리허설 조작판 첫 화면·"시드" 없음', async ({ page }) => {
    await page.goto('/login') // LND1 D-LND1-01 (첫 화면 커서 — 로그인 화면 주소)
    await expect(page.getByLabel('아이디')).toBeFocused()
    await login(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true })
    const panel = page.getByRole('region', { name: '리허설 조작판' })
    const start = panel.getByRole('button', { name: '가짜 채팅 시작' })
    await expect(start).toBeInViewport()
    const box = (await start.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(900)
    expect(await panel.innerText()).not.toContain('시드')
    // 보류 찜 (상품 없는 번호) 3초 넘게 지난 뒤 창을 연다 — 찜 시각은 서버가 요청을 받는 동안 찍으므로
    // 응답이 온 뒤의 시각부터 센다 (보내기 전부터 세면 부하로 요청이 몇 초 걸릴 때 실제 경과가 3초에 못 미친다)
    await smsApi(page, { b, no: 40, memo: '이씨' })
    const since = Date.now()
    const strip = page.getByRole('region', { name: '알림' })
    await expect(strip.getByRole('button', { name: '보류 찜 1' })).toBeVisible()
    await untilElapsed(page, since, 3500)
    await strip.getByRole('button', { name: '보류 찜 1' }).click()
    const dlg = page.getByRole('dialog', { name: '보류 찜' })
    const first = await dlg.innerText()
    expect(first).not.toMatch(/(^|\D)[0-2]초 전/)
    expect(first).toMatch(/\d+초 전/)
    await dlg.getByRole('button', { name: '닫기' }).click()
    // 방송을 끝내면 "끝난 방송이에요"는 상태 글자 (포커스되지 않음)
    expect((await postJson(page, `/api/broadcasts/${b}/end`, { requestId: crypto.randomUUID() })).status).toBeLessThan(300)
    const ended = page.getByText('끝난 방송이에요')
    await expect(ended).toBeVisible()
    await expect(page.getByRole('button', { name: /끝난 방송이에요/ })).toHaveCount(0)
    expect(await ended.evaluate((el) => (el as HTMLElement).tabIndex)).toBeLessThan(0)
  })

  test('AC-S06-66 (014): 제목 없이 만든 리허설 방송은 "리허설 N", 실제 방송의 "N부"는 실제 방송만 센다', async ({ page }) => {
    await login(page)
    const date = uniqueDate()
    const make = async (rehearsal: boolean) => {
      const res = await postJson(page, '/api/broadcasts', { requestId: crypto.randomUUID(), date, rehearsal })
      expect(res.status).toBeLessThan(300)
    }
    await make(true)
    await make(false)
    await make(true)
    await make(false)
    const list = await (await page.request.get('/api/broadcasts')).json() as { broadcasts: { date: string; rehearsal: boolean; title: string }[] }
    const mine = list.broadcasts.filter((x) => x.date === date)
    expect(mine.filter((x) => x.rehearsal).map((x) => x.title)).toEqual(['리허설 1', '리허설 2'])
    expect(mine.filter((x) => !x.rehearsal).map((x) => x.title)).toEqual(['1부', '2부'])
  })

  test('AC-S06-67: 남겨 둔 "고칠까요?"는 다른 기기의 번호 변경 뒤 "지금 없어요" → "등록하기"로 친 줄 등록, 다른 값이 없어지면 사라진다', async ({ page }) => {
    await login(page)
    const date = uniqueDate()
    const b = await newBroadcast(page, { date })
    await slowWrites(page, 500)
    const input = page.getByLabel('빠른 입력')
    for (const line of ['61 꽃 1만', '61 장미 2만', '62 꽃 1만', '63 꽃 1만', '63 튤립 3만', '64 꽃 1만']) {
      await input.pressSequentially(line, { delay: 40 })
      await input.press('Enter')
    }
    await expect(boardItem(page, 64)).toBeVisible()
    const asks = page.getByRole('list', { name: '고칠까요?' })
    await expect(asks).toContainText('61번이 이미 있어요. 고칠까요?')
    await expect(asks).toContainText('63번이 이미 있어요. 고칠까요?')
    await page.unroute('**/api/events**')
    // 다른 기기: 61 → 70 번호 변경
    expect((await writeEvent(page, { type: 'product.renumber', b, from: 61, to: 70 })).status).toBeLessThan(300)
    await expect(boardItem(page, 70)).toBeVisible()
    await expect(asks).toContainText('61번은 지금 없어요. 이 줄로 새로 등록할까요?')
    // 다른 기기: 63을 튤립 3만으로 고침 → 다른 값이 없어 항목이 사라진다
    expect((await writeEvent(page, { type: 'product.update', b, no: 63, name: '튤립', price: 30000 })).status).toBeLessThan(300)
    await expect(asks).not.toContainText('63번')
    await page.getByRole('button', { name: '61 장미 2만 등록하기' }).click()
    await expect(boardItem(page, 61)).toContainText('장미')
    await expect(boardItem(page, 61)).toContainText('20,000원')
    const regs = (await history(page, date, false)).filter((e) => e.type === 'product.register' && e.fields['no'] === 61)
    expect(regs).toHaveLength(2)
  })

  test('AC-S06-70: 15 → 16 번호 변경 뒤 새 15의 조치 기록에 옛 조치가 없고, 16의 기록에 번호 변경 "15번 → 16번"과 옛 조치', async ({ page }) => {
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true })
    await registerApi(page, b, 15, '핑크프릴', 10000)
    await viewerClaim(page, b, '홍길동', '15', 'sim_hong_7070')
    await expect(boardItem(page, 15)).toContainText('홍길동')
    expect((await writeEvent(page, { type: 'host.cancel', b, no: 15, buyer: 'sim_hong_7070', reason: '시청자 요청' })).status).toBeLessThan(300)
    expect((await writeEvent(page, { type: 'product.renumber', b, from: 15, to: 16 })).status).toBeLessThan(300)
    await registerApi(page, b, 15, '새상품', 5000)
    await expect(boardItem(page, 15)).toContainText('새상품')
    await boardItem(page, 15).click()
    let log = page.getByRole('dialog', { name: '15번 자세히' }).getByRole('region', { name: '조치 기록' })
    await expect(log.getByRole('row')).toHaveCount(2) // 머리 줄 + 등록 하나
    await expect(log).not.toContainText('시청자 요청')
    await expect(log).not.toContainText('→')
    await page.getByRole('dialog', { name: '15번 자세히' }).getByRole('button', { name: '닫기' }).click()
    await boardItem(page, 16).click()
    log = page.getByRole('dialog', { name: '16번 자세히' }).getByRole('region', { name: '조치 기록' })
    await expect(log).toContainText('15번 → 16번')
    await expect(log).toContainText('시청자 요청')
    await expect(log).toContainText('홍길동')
  })

  test('AC-S06-71: 다른 리허설 방송에서 생성기가 돌면 409 문장과 그 방송으로 가는 길', async ({ page }) => {
    await login(page)
    const date = uniqueDate()
    const b1 = await openNewBroadcast(page, { date, rehearsal: true, title: '도는 방송' })
    const started = await postJson(page, `/api/broadcasts/${b1}/rehearsal/generator/start`, { requestId: crypto.randomUUID(), total: 1000, perSecond: 1 })
    expect(started.status, JSON.stringify(started.body)).toBeLessThan(300)
    try {
      await openNewBroadcast(page, { date, rehearsal: true, title: '다른 방송' })
      const panel = page.getByRole('region', { name: '리허설 조작판' })
      await panel.getByRole('button', { name: '가짜 채팅 시작' }).click()
      await expect(panel).toContainText('다른 리허설 방송에서 가짜 채팅이 돌고 있어요. 그 방송에서 먼저 멈춰 주세요.')
      await panel.getByRole('link', { name: '가짜 채팅이 도는 방송으로 가기' }).click()
      await expect(page).toHaveURL(new RegExp(`/broadcasts/${b1}$`))
    } finally {
      await postJson(page, `/api/broadcasts/${b1}/rehearsal/generator/stop`, {})
    }
  })
})

void board
