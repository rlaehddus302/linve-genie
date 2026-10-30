// AC-SMS3-34 "손님 문자 → 2초 안에 보드에 문자찜" (성능 시험, D-902 — pnpm perf로 부하 없을 때만. pnpm verify 밖)
// 가짜 기기가 보내기 시작한 때부터 PC·375 두 화면 모두 보드에 그 번호의 문자찜(이름)이 보일 때까지. 상품 5개를 차례로, 가장 늦은 것 ≤ 2초.
import { test, expect } from '@playwright/test'
import { boardItem, fakeDevice, makeTokenApi, onSale, openConsole, phoneNo, realBroadcast, sameSellerAt, sellerAt } from './support.ts'

test('AC-SMS3-34 손님 문자가 PC·375 보드에 2초 안에 @perf', async ({ browser, baseURL }) => {
  test.setTimeout(120_000)
  const { page: pc, context, seller } = await sellerAt(browser, baseURL!, 'PC')
  const phone = await sameSellerAt(browser, baseURL!, seller, '375')
  const token = await makeTokenApi(pc)
  const b = await realBroadcast(pc)
  const names = ['홍길동', '김영희', '박민수', '이수진', '최유리']
  for (let i = 0; i < names.length; i++) await onSale(pc, b, 21 + i, `상품${String(21 + i)}`, 5_000)
  await openConsole(pc, b)
  await openConsole(phone, b)
  const device = await fakeDevice(baseURL!, token)
  const took: number[] = []
  for (let i = 0; i < names.length; i++) {
    const no = 21 + i
    const started = Date.now()
    await device.sms(phoneNo(), `${String(no)} ${names[i]!}`)
    await Promise.all([
      expect(boardItem(pc, no)).toContainText(`문자찜(${names[i]!})`),
      expect(boardItem(phone, no)).toContainText(`문자찜(${names[i]!})`),
    ])
    took.push(Date.now() - started)
  }
  expect(Math.max(...took), `걸린 시간(ms): ${took.join(', ')}`).toBeLessThanOrEqual(2_000)
  await device.dispose()
  await phone.context().close()
  await context.close()
})
