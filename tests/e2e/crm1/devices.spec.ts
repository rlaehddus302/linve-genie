// CRM1 흐름 깨뜨리기 (test-e2e) — 두 기기(PC + 휴대폰)·네트워크 끊김·연타. AC-CRM1-09·21, D-CRM1-08("두 기기가 동시에 저장하면 나중 것이 마지막").
// 입력 유실 금지(절대 규칙 3의 화면 쪽 — 친 글을 말없이 버리지 않는다).
import { test, expect } from '@playwright/test'
import { kstDate, loginNewSeller, sameSellerOn, settlementOf, won, writeEvent, youtubeSale } from './support.ts'

const LABEL = '유튜브 · 두기기손님'

test('PC·휴대폰 같은 손님: 휴대폰 입금이 PC의 열린 손님 기록에 반영되고, 메모는 나중 저장이 마지막', async ({ page, browser }) => {
  test.setTimeout(150_000)
  await page.setViewportSize({ width: 1280, height: 900 })
  const seller = await loginNewSeller(page)
  const d = kstDate(6)
  const s = await youtubeSale(page, { date: d, ch: `UC_D${String(Date.now())}`, nick: '두기기손님', prices: [15_000], paid: false })
  const phone = await sameSellerOn(browser, new URL(page.url()).origin, seller, { width: 375, height: 812 })
  const path = `/buyers?date=${d}&buyer=${encodeURIComponent(s.buyer)}`
  await page.goto(path)
  await phone.goto(path)
  const pc = page.getByRole('region', { name: '손님 기록' })
  const mob = phone.getByRole('region', { name: '손님 기록' })
  await expect(pc).toContainText('미입금 1번')
  await expect(mob).toContainText('미입금 1번')

  // 휴대폰에서 입금 → PC가 새로 열지 않아도 바뀐다
  const total = (await settlementOf(phone, d, s.buyer)).total
  expect((await writeEvent(phone, { type: 'settlement.payment', buyer: s.buyer, date: d, amount: total }, { date: d, rehearsal: false })).status).toBeLessThan(300)
  await expect(pc).toContainText('미입금 없음')
  await expect(pc).toContainText(`누적 구매 ${won(15_000)} · 1번`)

  // 메모: PC 먼저, 휴대폰 나중 → 둘 다 새로 열면 휴대폰 글
  await pc.getByLabel(`메모 — ${LABEL}`).fill('PC 메모')
  await pc.getByRole('button', { name: `메모 저장 — ${LABEL}` }).click()
  await expect(pc.locator('.memo-text')).toHaveText('PC 메모')
  await mob.getByLabel(`메모 — ${LABEL}`).fill('폰 메모')
  await mob.getByRole('button', { name: `메모 저장 — ${LABEL}` }).click()
  await expect(mob.locator('.memo-text')).toHaveText('폰 메모')
  await page.reload()
  await expect(page.getByRole('region', { name: '손님 기록' }).locator('.memo-text')).toHaveText('폰 메모')
  await phone.context().close()
})

test('TE-CRM1-004 PC에서 메모를 쓰는 중에 휴대폰이 메모를 저장하고 입금을 적어도 PC에 친 글이 말없이 사라지지 않는다', async ({ page, browser }) => {
  test.setTimeout(150_000)
  await page.setViewportSize({ width: 1280, height: 900 })
  const seller = await loginNewSeller(page)
  const d = kstDate(6)
  const s = await youtubeSale(page, { date: d, ch: `UC_D${String(Date.now())}`, nick: '두기기손님', prices: [15_000], paid: false })
  const phone = await sameSellerOn(browser, new URL(page.url()).origin, seller, { width: 375, height: 812 })
  const path = `/buyers?date=${d}&buyer=${encodeURIComponent(s.buyer)}`
  await page.goto(path)
  await phone.goto(path)
  const pc = page.getByRole('region', { name: '손님 기록' })
  const mob = phone.getByRole('region', { name: '손님 기록' })
  await expect(pc).toContainText('미입금 1번')
  const draft = '지난번 늦게 입금 — 다음 방송 전에 먼저 확인하기'
  await pc.getByLabel(`메모 — ${LABEL}`).fill(draft)
  // 다른 기기: 메모 저장 + 입금 (PC의 손님 기록이 새로 받아진다)
  await mob.getByLabel(`메모 — ${LABEL}`).fill('폰 메모')
  await mob.getByRole('button', { name: `메모 저장 — ${LABEL}` }).click()
  await expect(mob.locator('.memo-text')).toHaveText('폰 메모')
  const total = (await settlementOf(phone, d, s.buyer)).total
  expect((await writeEvent(phone, { type: 'settlement.payment', buyer: s.buyer, date: d, amount: total }, { date: d, rehearsal: false })).status).toBeLessThan(300)
  await expect(pc).toContainText('미입금 없음')
  // PC에서 친 글은 그대로 칸에 남아 있어야 한다 (판매자가 저장을 누를 수 있게)
  await expect(pc.getByLabel(`메모 — ${LABEL}`)).toHaveValue(draft)
  await phone.context().close()
})

test('메모 저장 중 네트워크 끊김 → 친 글 그대로·알림, 다시 이어지면 한 번 저장 · "메모 저장" 연타는 한 번만 보낸다', async ({ page }) => {
  test.setTimeout(150_000)
  await page.setViewportSize({ width: 375, height: 812 })
  await loginNewSeller(page)
  const s = await youtubeSale(page, { date: kstDate(6), ch: `UC_N${String(Date.now())}`, nick: '두기기손님', prices: [5_000], paid: true })
  await page.goto(`/buyers?date=${s.date}&buyer=${encodeURIComponent(s.buyer)}`)
  const record = page.getByRole('region', { name: '손님 기록' })
  const box = record.getByLabel(`메모 — ${LABEL}`)
  const save = record.getByRole('button', { name: `메모 저장 — ${LABEL}` })
  const puts: number[] = []
  page.on('request', (r) => {
    if (r.method() === 'PUT' && r.url().includes('/memo')) puts.push(Date.now())
  })
  await box.fill('끊김 중 메모')
  await page.context().setOffline(true)
  await save.click()
  await expect(record.getByRole('alert').or(record.getByText(/연결|인터넷|다시 시도/)).first()).toBeVisible()
  await expect(box).toHaveValue('끊김 중 메모')
  await expect(record.locator('.memo-text')).toHaveCount(0)
  await page.context().setOffline(false)
  await save.click()
  await expect(record.locator('.memo-text')).toHaveText('끊김 중 메모')

  // 연타: 서버 응답을 붙잡아 두고 세 번 누른다 → PUT 한 번
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/customers/*/memo', async (route) => {
    await held
    await route.continue()
  })
  const before = puts.length
  await box.fill('연타 메모')
  await save.click()
  await save.click({ force: true }).catch(() => {})
  await save.click({ force: true }).catch(() => {})
  release()
  await expect(record.locator('.memo-text')).toHaveText('연타 메모')
  expect(puts.length - before).toBe(1)
})
