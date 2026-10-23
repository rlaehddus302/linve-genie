// PL1B E2E 공용 도우미 (test-e2e). I2(포장 모드)·N4a(라벨 켜기/끄기)·I1(시험용 프린터) 도우미를 이름으로 골라 다시 낸다.
// (여러 묶음을 `export *`로 함께 내면 같은 이름이 겹쳐 빠지므로 쓰는 것만 이름으로)
import { expect, type Page } from '@playwright/test'
import { realDay, uniqueDate } from '../i2/support.ts'
import { postJson } from '../s05/support.ts'

export { OFF_NOTE, cleanupN4a, labelSection, labelSettings, primaryOutsideDialogs, setLabels } from '../n4a/support.ts'
export { TEST_PRINTER, becomeDevice, cleanupPrint, printOverview, printedCount, waitPrinted } from '../i1/support.ts'
export { login, noHorizontalScroll, uniqueDate } from '../i2/support.ts'
export { postJson }

/** 체크리스트 칸 (I2 포장 모드) */
export function checklistOf(page: Page) {
  return page.getByRole('region', { name: '체크리스트' })
}

/**
 * 실제 날짜 하나에 품목 n개(1번~n번 "품종N" 1,000원)를 한 구매자(전화번호)가 문자찜으로 산다.
 * 이 묶음 방송은 자동 출력을 끄고 만든다 — 시험용 프린터가 받는 장수가 포장 라벨만이 되게(방송마다 설정 스냅샷, 정리에서 다시 켬).
 */
export async function packingDay(page: Page, n: number, phone: string): Promise<{ date: string; b: string; buyer: string }> {
  const off = await page.request.patch('/api/settings', { data: { settings: { 'print.autoOnConfirm': false } }, headers: { Origin: new URL(page.url()).origin } })
  expect(off.ok(), await off.text()).toBe(true)
  const date = uniqueDate()
  const nos = Array.from({ length: n }, (_, i) => i + 1)
  const { b, buyers } = await realDay(page, { date, products: nos.map((no) => ({ no, name: `품종${String(no)}`, price: 1000 })), claims: nos.map((no) => ({ no, phone })) })
  return { date, b, buyer: buyers.get(phone)! }
}
