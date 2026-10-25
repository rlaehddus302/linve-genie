// QL3R1 찜 취소·무효 빠른 사유는 한 번에 (AC-QL3R1-30~32, D-QL3R1-05, U-QL3-05) — test-e2e.
// 상품 1번 1등 "밤톨맘"(리허설 채팅). 빠른 사유를 누르거나 창 안 숫자 키 1~4 → 창이 닫히고 그 사유로 되돌리기 띠 대기("… 뒤 보내요").
// E2E 서버의 방송자 조치 대기 = E2E_HOST_DELAY_MS(기본 2000 — 운영 5초). "보내지 않음"은 대기 시간이 지난 뒤 이력으로 본다(s06b/leave.spec.ts와 같은 방법).
import { expect, test, type Page } from '@playwright/test'
import { history, untilElapsed, uniqueDate } from '../s05/support.ts'
import { registerApi, viewerClaim } from '../s06/support.ts'
import { broadcastApi, setLabelsApi } from '../ql2/support.ts'
import { D393, D412, boardCard, openConsole, registerStock, sellerOn } from './support.ts'

const DELAY = Number(process.env['E2E_HOST_DELAY_MS'] ?? '2000')
const undoBar = (page: Page) => page.getByRole('region', { name: '보내기 전 조치' })

async function world(dev: Page): Promise<{ b: string; date: string }> {
  const date = uniqueDate()
  const b = await broadcastApi(dev, date, true)
  await setLabelsApi(dev, false)
  await registerStock(dev, b, 1, '핑크프릴', 10000, 1)
  await registerApi(dev, b, 2, '청보석', 20000)
  await viewerClaim(dev, b, '밤톨맘', '1', `sim_ql3r1_bt_${String(Date.now())}`)
  await viewerClaim(dev, b, '도토리', '2', `sim_ql3r1_dt_${String(Date.now())}`)
  return { b, date }
}

/** 상품 자세히 → 1등 줄의 단추 → 사유 창 */
async function openReason(dev: Page, no: number, nick: string, button: '찜 취소하기' | '무효로 하기' | '차단하기') {
  await boardCard(dev, no).click()
  const detail = dev.getByRole('dialog', { name: `${String(no)}번 자세히` })
  await expect(detail).toBeVisible()
  await detail.getByRole('region', { name: '1등' }).getByRole('listitem').filter({ hasText: nick }).getByRole('button', { name: button, exact: true }).click()
  const word = button === '찜 취소하기' ? '취소' : button === '무효로 하기' ? '무효' : '차단'
  const dlg = dev.getByRole('dialog', { name: new RegExp(`${nick} ${word}$`) })
  await expect(dlg).toBeVisible()
  await expect(dlg.getByRole('button', { name: '닫기', exact: true })).toBeFocused()
  return { detail, dlg }
}

const events = async (dev: Page, date: string, type: string) => (await history(dev, date, true)).filter((e) => e.type === type)

test.describe('AC-QL3R1-30 빠른 사유 한 번으로 5초 되돌리기 대기', () => {
  test('412×915: "찜 취소하기" → "1 시청자 요청" (세 번 누름) → 창 닫힘·되돌리기 띠 "… 뒤 보내요: 1번 … 밤톨맘 취소" → 되돌리기면 보내지 않음, 다시 하면 대기 뒤 host.cancel 하나(사유 "시청자 요청")', async ({ page, browser }) => {
    const s = await sellerOn(browser, page, D412, false)
    try {
      const { b, date } = await world(s.dev)
      await openConsole(s.dev, b, false)
      // 첫 번째: 되돌리기
      const first = await openReason(s.dev, 1, '밤톨맘', '찜 취소하기')
      await first.dlg.getByRole('button', { name: '1 시청자 요청', exact: true }).click()
      await expect(first.dlg).toHaveCount(0)
      const waiting = undoBar(s.dev).getByRole('status').filter({ hasText: /초 뒤 보내요: 1번.* 밤톨맘 취소$/ })
      await expect(waiting).toBeVisible()
      const since = Date.now()
      // 보내기를 넣으면 창이 모두 닫힌다 (BASE 그대로 — closeAll)
      await expect(first.detail).toHaveCount(0)
      await expect(boardCard(s.dev, 1)).toContainText('보내기 전')
      await undoBar(s.dev).getByRole('button', { name: /밤톨맘 취소 되돌리기$/ }).click()
      await expect(undoBar(s.dev).getByRole('status').filter({ hasText: /^보내지 않았어요: 1번.* 밤톨맘 취소$/ })).toBeVisible()
      await untilElapsed(s.dev, since, DELAY + 1500)
      expect(await events(s.dev, date, 'host.cancel'), '되돌린 취소는 보내지 않는다').toHaveLength(0)
      // 두 번째: 그대로 두면 대기 뒤 하나
      const second = await openReason(s.dev, 1, '밤톨맘', '찜 취소하기')
      await second.dlg.getByRole('button', { name: '1 시청자 요청', exact: true }).click()
      await expect(second.dlg).toHaveCount(0)
      await expect(undoBar(s.dev).getByRole('status').filter({ hasText: /초 뒤 보내요: 1번.* 밤톨맘 취소$/ })).toBeVisible()
      await expect(undoBar(s.dev).getByRole('status').filter({ hasText: /^보냈어요: 1번.* 밤톨맘 취소$/ })).toBeVisible({ timeout: DELAY + 10_000 })
      const cancels = await events(s.dev, date, 'host.cancel')
      expect(cancels, 'host.cancel 하나').toHaveLength(1)
      expect(cancels[0]!.reason).toBe('시청자 요청')
      expect(cancels[0]!.failed).toBe(false)
    } finally {
      await s.close()
    }
  })

  test('412×915: "무효로 하기" 창에서 숫자 키 2 → 창 닫힘·대기 → host.reject 하나(사유 "장난 찜"), 숫자 키 3·4도 그 사유', async ({ page, browser }) => {
    const s = await sellerOn(browser, page, D412, false)
    try {
      const { b, date } = await world(s.dev)
      await openConsole(s.dev, b, false)
      const { dlg } = await openReason(s.dev, 1, '밤톨맘', '무효로 하기')
      await s.dev.keyboard.press('2')
      await expect(dlg).toHaveCount(0)
      await expect(undoBar(s.dev).getByRole('status').filter({ hasText: /초 뒤 보내요: 1번.* 밤톨맘 무효$/ })).toBeVisible()
      await expect(undoBar(s.dev).getByRole('status').filter({ hasText: /^보냈어요: 1번.* 밤톨맘 무효$/ })).toBeVisible({ timeout: DELAY + 10_000 })
      const rejects = await events(s.dev, date, 'host.reject')
      expect(rejects).toHaveLength(1)
      expect(rejects[0]!.reason).toBe('장난 찜')
      // 2번 상품 1등 "도토리": 숫자 키 4 → "입금 안 함"으로 찜 취소
      const other = await openReason(s.dev, 2, '도토리', '찜 취소하기')
      await expect(other.dlg.getByRole('button', { name: '4 입금 안 함', exact: true })).toBeVisible()
      await s.dev.keyboard.press('4')
      await expect(other.dlg).toHaveCount(0)
      await expect(undoBar(s.dev).getByRole('status').filter({ hasText: /^보냈어요: 2번.* 도토리 취소$/ })).toBeVisible({ timeout: DELAY + 10_000 })
      const cancels = await events(s.dev, date, 'host.cancel')
      expect(cancels).toHaveLength(1)
      expect(cancels[0]!.reason).toBe('입금 안 함')
    } finally {
      await s.close()
    }
  })

  test('393×852 WebKit: "찜 취소하기" → "3 번호 착오"를 손가락으로 누르면 창 닫힘·대기 → host.cancel 하나(사유 "번호 착오") @webkit', async ({ page, browser }) => {
    const s = await sellerOn(browser, page, D393, false)
    try {
      const { b, date } = await world(s.dev)
      await openConsole(s.dev, b, false)
      const { dlg } = await openReason(s.dev, 1, '밤톨맘', '찜 취소하기')
      await dlg.getByRole('button', { name: '3 번호 착오', exact: true }).tap()
      await expect(dlg).toHaveCount(0)
      await expect(undoBar(s.dev).getByRole('status').filter({ hasText: /^보냈어요: 1번.* 밤톨맘 취소$/ })).toBeVisible({ timeout: DELAY + 10_000 })
      const cancels = await events(s.dev, date, 'host.cancel')
      expect(cancels).toHaveLength(1)
      expect(cancels[0]!.reason).toBe('번호 착오')
    } finally {
      await s.close()
    }
  })
})

test.describe('AC-QL3R1-31 직접 적은 사유·빈 사유·글 칸의 숫자', () => {
  test('412×915: 빈 사유로 "찜 취소하기" → "사유를 적어 주세요."·보내지 않음, 글 칸에서 숫자 3은 글자로 들어감(보내지 않음), "직접 적은 사유" + Enter → 대기 뒤 그 사유로 하나', async ({ page, browser }) => {
    const s = await sellerOn(browser, page, D412, false)
    try {
      const { b, date } = await world(s.dev)
      await openConsole(s.dev, b, false)
      const { dlg } = await openReason(s.dev, 1, '밤톨맘', '찜 취소하기')
      // 빈 사유
      await dlg.getByRole('button', { name: '찜 취소하기', exact: true }).click()
      await expect(dlg.getByText('사유를 적어 주세요.')).toBeVisible()
      await expect(dlg).toBeVisible()
      await expect(undoBar(s.dev)).toHaveCount(0)
      // 글 칸 안의 숫자는 글자
      const field = dlg.getByLabel('사유')
      await field.focus()
      await s.dev.keyboard.press('3')
      await expect(field).toHaveValue('3')
      await expect(dlg).toBeVisible()
      await expect(undoBar(s.dev)).toHaveCount(0)
      await expect(dlg.getByRole('button', { name: '3 번호 착오', exact: true })).toHaveAttribute('aria-pressed', 'false')
      // 직접 적은 사유 + Enter
      await field.fill('직접 적은 사유')
      await field.press('Enter')
      await expect(dlg).toHaveCount(0)
      await expect(undoBar(s.dev).getByRole('status').filter({ hasText: /^보냈어요: 1번.* 밤톨맘 취소$/ })).toBeVisible({ timeout: DELAY + 10_000 })
      const cancels = await events(s.dev, date, 'host.cancel')
      expect(cancels).toHaveLength(1)
      expect(cancels[0]!.reason).toBe('직접 적은 사유')
    } finally {
      await s.close()
    }
  })

  test('412×915: 사유를 적고 "찜 취소하기" 단추를 누르면 그 사유로 대기 뒤 하나 (BASE 그대로)', async ({ page, browser }) => {
    const s = await sellerOn(browser, page, D412, false)
    try {
      const { b, date } = await world(s.dev)
      await openConsole(s.dev, b, false)
      const { dlg } = await openReason(s.dev, 1, '밤톨맘', '찜 취소하기')
      await dlg.getByLabel('사유').fill('손님이 전화로 취소')
      await dlg.getByRole('button', { name: '찜 취소하기', exact: true }).click()
      await expect(dlg).toHaveCount(0)
      await expect(undoBar(s.dev).getByRole('status').filter({ hasText: /^보냈어요: 1번.* 밤톨맘 취소$/ })).toBeVisible({ timeout: DELAY + 10_000 })
      const cancels = await events(s.dev, date, 'host.cancel')
      expect(cancels).toHaveLength(1)
      expect(cancels[0]!.reason).toBe('손님이 전화로 취소')
    } finally {
      await s.close()
    }
  })
})

test.describe('AC-QL3R1-32 다른 사유 창은 그대로', () => {
  test('412×915: "차단하기" 창에서 숫자 키 1 → 사유가 골라지고 초점이 "차단하기"로, 창은 열린 채·보내지 않음', async ({ page, browser }) => {
    const s = await sellerOn(browser, page, D412, false)
    try {
      const { b, date } = await world(s.dev)
      await openConsole(s.dev, b, false)
      const { dlg } = await openReason(s.dev, 1, '밤톨맘', '차단하기')
      await s.dev.keyboard.press('1')
      await expect(dlg.getByRole('button', { name: '차단하기', exact: true })).toBeFocused()
      await expect(dlg).toBeVisible()
      await expect(dlg.getByRole('button', { pressed: true })).toHaveCount(1)
      await expect(undoBar(s.dev)).toHaveCount(0)
      await s.dev.keyboard.press('Escape')
      await expect(dlg).toHaveCount(0)
      expect(await events(s.dev, date, 'host.blockBuyer')).toHaveLength(0)
    } finally {
      await s.close()
    }
  })
})
