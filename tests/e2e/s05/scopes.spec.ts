// 같은 날 리허설·실제, 같은 날 방송 둘 (AC-S05-14·21·30·50·54, YT-09, test-e2e).
import { test, expect } from '@playwright/test'
import { board, boardItem, login, openNewBroadcast, register, sendViewerChat, uniqueDate } from './support.ts'

/** 출력 기기 없음 항목 (MOB1 D-MOB1-08 문장) */
const PILING = "출력 기기가 아직 없어 라벨이 쌓이고 있어요. 출력할 기기의 라벨 화면에서 '이 기기에서 출력'을 눌러 주세요."

test('YT-09·AC-S05-30: 같은 날 리허설 채팅·찜은 실제 콘솔의 채팅·알림·보드에 섞이지 않고, 실제 콘솔이 따라잡기 조회도 하지 않는다', async ({ browser, baseURL }) => {
  const date = uniqueDate()
  const realCtx = await browser.newContext({ baseURL })
  const real = await realCtx.newPage()
  await login(real)
  const rb = await openNewBroadcast(real, { date, rehearsal: false, title: '실제 1부' })
  await register(real, '15 실제상품 10000', 15)
  const rehCtx = await browser.newContext({ baseURL })
  const reh = await rehCtx.newPage()
  await login(reh)
  const hb = await openNewBroadcast(reh, { date, rehearsal: true, title: '연습' })
  expect(hb).not.toBe(rb)
  await expect(real.getByRole('region', { name: '리허설 조작판' })).toHaveCount(0)
  const changes: string[] = []
  real.on('request', (r) => { if (r.url().includes('/changes') || r.url().includes(`/api/days/${date}`)) changes.push(r.url()) })
  await register(reh, '15 연습상품 10000', 15)
  await sendViewerChat(reh, hb, '연습손님', '15')
  await sendViewerChat(reh, hb, '연습손님2', '99')
  await expect(boardItem(reh, 15)).toContainText('연습손님')
  await expect(reh.getByRole('region', { name: '알림' }).getByRole('button', { name: '보류 찜 1' })).toBeVisible()
  // 실제 콘솔: 같은 시간 동안 아무것도 바뀌지 않는다 — 실제 쪽에서 쓰기 하나를 해 실시간이 살아 있음을 확인한 뒤 본다
  await register(real, '16 실제둘 10000', 16)
  // MOB1 D-MOB1-08: 출력 기기가 없고 실제 대기 라벨이 있으면 알림 띠 맨 끝에 출력 기기 항목이 붙는다. 같은 시험 계정을 쓰는
  // 다른 시험의 실제 방송 라벨로도 생기므로(리허설은 출력 작업을 만들지 않음 — RA-S05-002) 그 항목 하나만 빼고 본다.
  // 남는 것은 리허설이 실제 콘솔에 섞인 흔적이다 — 세는 알림(보류 찜·확인 필요·충돌 등)이 하나도 없어야 한다.
  const realAlerts = real.getByRole('region', { name: '알림' })
  await expect(realAlerts).toContainText(/^(알림 없음|출력 기기가 아직 없어 라벨이 쌓이고 있어요\. 출력할 기기의 라벨 화면에서 '이 기기에서 출력'을 눌러 주세요\.)$/)
  await expect(realAlerts.getByRole('listitem').filter({ hasNotText: PILING })).toHaveCount(0)
  await expect(realAlerts.getByRole('button', { name: /보류 찜|확인 필요/ })).toHaveCount(0)
  await expect(realAlerts).not.toContainText('연습손님')
  await expect(real.getByRole('list', { name: '채팅 메시지' })).not.toContainText('연습손님')
  await expect(boardItem(real, 15)).toContainText('실제상품')
  await expect(boardItem(real, 15)).not.toContainText('연습손님')
  expect(changes.every((u) => !u.includes('rehearsal=true'))).toBe(true)
  await realCtx.close()
  await rehCtx.close()
})

test('AC-S05-14·21: 같은 날 방송 둘 — 2부 콘솔의 보드·현재 상품·채팅에는 2부 것만', async ({ page }) => {
  await login(page)
  const date = uniqueDate()
  const b1 = await openNewBroadcast(page, { date, rehearsal: true, title: '연습 1부' })
  await register(page, '15 일부상품 10000', 15)
  await sendViewerChat(page, b1, '일부손님', '15')
  await expect(boardItem(page, 15)).toContainText('일부손님')
  const b2 = await openNewBroadcast(page, { date, rehearsal: true, title: '연습 2부' })
  await expect(board(page)).not.toContainText('일부상품')
  await expect(page.getByRole('region', { name: '현재 상품' })).not.toContainText('일부상품')
  await expect(page.getByRole('list', { name: '채팅 메시지' })).not.toContainText('일부손님')
  // 2부의 15는 새 상품이다(1부 15번의 "고칠까요?"가 아니다)
  await register(page, '15 이부상품 20000', 15)
  await expect(boardItem(page, 15)).toContainText('이부상품')
  await sendViewerChat(page, b2, '이부손님', '15')
  await expect(boardItem(page, 15)).toContainText('이부손님')
  await expect(page.getByRole('list', { name: '채팅 메시지' })).not.toContainText('일부손님')
})
