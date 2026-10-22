// O2 판매 방식 (AC-O2-01·02·04·05·06·10·50) — test-e2e. 설정을 바꾸는 시험은 새 판매자로 한다(시험 계정을 함께 쓰는 다른 시험에 새지 않게).
import { expect, test, type Page } from '@playwright/test'
import { loginAs, loginNewSeller, newSeller } from '../i3/support.ts'
import {
  NUMBERS_WORD,
  OPTIONS_WORD,
  board,
  broadcastInfo,
  chat,
  createBroadcast,
  history,
  oscope,
  registerOptions,
  serverSettings,
  waitClaims,
} from './support.ts'

function rules(page: Page) {
  return page.getByRole('region', { name: '판매 규칙', exact: true })
}

async function broadcastSettings(page: Page, date: string, rehearsal: boolean, b: string): Promise<Record<string, unknown>> {
  const s = await oscope(page, date, rehearsal)
  const info = s.broadcasts.find((x) => x.id === b)
  if (info === undefined) throw new Error('방송 없음')
  return info.settings
}

test('AC-O2-01: 설정 판매 규칙 맨 위 "판매 방식" — 기본은 번호로만 받기, 영어 값 없음', async ({ page }) => {
  await loginNewSeller(page)
  await page.goto('/settings')
  const group = rules(page).getByRole('radiogroup', { name: '판매 방식' })
  await expect(group).toBeVisible()
  await expect(group.getByRole('radio')).toHaveCount(2)
  await expect(group.getByRole('radio', { name: NUMBERS_WORD })).toBeChecked()
  await expect(group.getByRole('radio', { name: OPTIONS_WORD })).not.toBeChecked()
  // 맨 위: 판매 규칙 안 첫 입력 칸이 판매 방식이다
  const firstInput = rules(page).locator('input, select, textarea').first()
  await expect(firstInput).toHaveAccessibleName(NUMBERS_WORD)
  // 엄격/느슨은 "더 보기" 안에 그대로
  await rules(page).getByRole('button', { name: /^더 보기/ }).click()
  await expect(rules(page).getByRole('radiogroup', { name: '주문 인식 방식' }).or(rules(page).getByRole('group', { name: '주문 인식 방식' })).or(rules(page).getByLabel('주문 인식 방식'))).toBeVisible()
  await expect(page.locator('body')).not.toContainText(/STRICT|LOOSE|OPTIONS|ARRIVAL/)
})

test('AC-O2-02: 실제 시각순 판매자가 옵션 방식을 고르면 겨루기 고정 글 → 저장 OPTIONS·ARRIVAL → 다시 번호로만 받기 STRICT', async ({ page }) => {
  await loginNewSeller(page)
  const origin = new URL(page.url()).origin
  const res = await page.request.patch('/api/settings', { data: { settings: { 'contention.policy': 'RECEIVED_TIME' } }, headers: { Origin: origin } })
  expect(res.status(), await res.text()).toBe(200)
  await page.goto('/settings')
  await rules(page).getByRole('button', { name: /^더 보기/ }).click()
  await expect(rules(page).getByText('주문 인식 방식')).toBeVisible()
  await rules(page).getByRole('radio', { name: OPTIONS_WORD }).check()
  await expect(rules(page).getByText('주문 인식 방식')).toHaveCount(0)
  await expect(rules(page).getByText('먼저 들어온 순서(접수순)')).toBeVisible()
  await expect(rules(page).getByText('상품명·옵션도 받기는 먼저 들어온 순서로만 판정해요.').first()).toBeVisible()
  await expect(rules(page).getByRole('radio', { name: '실제 받은 시각 순서' })).toHaveCount(0)
  await rules(page).getByRole('button', { name: '저장', exact: true }).click()
  await expect(rules(page).getByText(/^저장했어요/)).toBeVisible()
  await expect(rules(page).getByRole('alert')).toHaveCount(0)
  let saved = await serverSettings(page)
  expect([saved['claim.parseMode'], saved['contention.policy']]).toEqual(['OPTIONS', 'ARRIVAL'])

  await page.reload()
  await expect(rules(page).getByRole('radio', { name: OPTIONS_WORD })).toBeChecked()
  await rules(page).getByRole('radio', { name: NUMBERS_WORD }).check()
  await rules(page).getByRole('button', { name: '저장', exact: true }).click()
  await expect(rules(page).getByText(/^저장했어요/)).toBeVisible()
  saved = await serverSettings(page)
  expect(saved['claim.parseMode']).toBe('STRICT')
})

test('AC-O2-04: 시작 마법사 판매 규칙 확인 단계의 판매 방식 — 고르고 "다음"이면 설정에 저장', async ({ page }) => {
  const seller = await newSeller(page.request)
  await loginAs(page, seller)
  await expect(page).toHaveURL(/\/start$/)
  await page.getByRole('button', { name: '다음' }).click()
  await expect(page.getByRole('heading', { level: 2, name: '2/5 판매 규칙 확인' })).toBeFocused()
  const group = page.getByRole('radiogroup', { name: '판매 방식' })
  await expect(group.getByRole('radio', { name: NUMBERS_WORD })).toBeChecked()
  // 고르면 바로 저장한다 (저장이 끝나야 골라진 것으로 보인다)
  await group.getByRole('radio', { name: OPTIONS_WORD }).click()
  await expect(group.getByRole('radio', { name: OPTIONS_WORD })).toBeChecked()
  await expect(page.getByText('상품명·옵션도 받기는 먼저 들어온 순서로만 판정해요.').first()).toBeVisible()
  await page.getByRole('button', { name: '다음' }).click()
  // 시작 마법사 순서는 main의 D-WIZ-01(유튜브 → 프린터)대로 — 2/5 다음은 3/5 유튜브 연결 (합친 뒤 계약 교체, 약화 아님)
  await expect(page.getByRole('heading', { level: 2, name: '3/5 유튜브 연결' })).toBeFocused()
  const saved = await serverSettings(page)
  expect([saved['claim.parseMode'], saved['contention.policy']]).toEqual(['OPTIONS', 'ARRIVAL'])
})

test('AC-O2-05: 새 방송 시작 창에서 그 방송만 옵션 방식(실제·리허설) — 설정 그대로, 다음 창 처음 값은 설정 값, 반대도', async ({ page }) => {
  await loginNewSeller(page)
  await page.goto('/')
  await page.getByRole('button', { name: '새 방송 시작' }).click()
  const mode = page.getByRole('radiogroup', { name: '판매 방식' })
  await expect(mode.getByRole('radio', { name: NUMBERS_WORD })).toBeChecked()
  await mode.getByRole('radio', { name: OPTIONS_WORD }).check()
  await page.getByLabel('제목').fill('옵션 실제 방송')
  await page.getByRole('button', { name: '이 방송 시작하기' }).click()
  await expect(page.getByLabel('빠른 입력')).toBeFocused()
  const real = decodeURIComponent(/\/broadcasts\/([^/?#]+)/.exec(page.url())![1]!)
  const realInfo = await broadcastInfo(page, real)
  let st = await broadcastSettings(page, realInfo.date, false, real)
  expect([st['claim.parseMode'], st['contention.policy']]).toEqual(['OPTIONS', 'ARRIVAL'])
  expect((await serverSettings(page))['claim.parseMode']).toBe('STRICT')
  await expect(page.getByText('상품명·옵션도 받기', { exact: true })).toBeVisible()

  // 리허설도
  await page.goto('/')
  await page.getByRole('button', { name: '새 방송 시작' }).click()
  await expect(mode.getByRole('radio', { name: NUMBERS_WORD })).toBeChecked()
  await mode.getByRole('radio', { name: OPTIONS_WORD }).check()
  await page.getByRole('button', { name: '이 판매 방식으로 리허설 시작' }).click()
  await expect(page.getByText('리허설 중 — 실제 판매가 아니에요')).toBeVisible()
  const reh = decodeURIComponent(/\/broadcasts\/([^/?#]+)/.exec(page.url())![1]!)
  const rehInfo = await broadcastInfo(page, reh)
  expect(rehInfo.rehearsal).toBe(true)
  st = await broadcastSettings(page, rehInfo.date, true, reh)
  expect([st['claim.parseMode'], st['contention.policy']]).toEqual(['OPTIONS', 'ARRIVAL'])
  expect((await serverSettings(page))['claim.parseMode']).toBe('STRICT')

  // 설정이 옵션 방식이면 처음 값이 옵션, 번호로만 받기로 시작한 방송은 STRICT
  const origin = new URL(page.url()).origin
  await page.request.patch('/api/settings', { data: { settings: { 'claim.parseMode': 'OPTIONS', 'contention.policy': 'ARRIVAL' } }, headers: { Origin: origin } })
  await page.goto('/')
  await page.getByRole('button', { name: '새 방송 시작' }).click()
  await expect(mode.getByRole('radio', { name: OPTIONS_WORD })).toBeChecked()
  await mode.getByRole('radio', { name: NUMBERS_WORD }).check()
  await page.getByLabel('제목').fill('번호 방송')
  await page.getByRole('button', { name: '이 방송 시작하기' }).click()
  await expect(page.getByLabel('빠른 입력')).toBeFocused()
  const num = decodeURIComponent(/\/broadcasts\/([^/?#]+)/.exec(page.url())![1]!)
  const numInfo = await broadcastInfo(page, num)
  st = await broadcastSettings(page, numInfo.date, false, num)
  expect(st['claim.parseMode']).toBe('STRICT')
  expect((await serverSettings(page))['claim.parseMode']).toBe('OPTIONS')
  await expect(page.getByText('상품명·옵션도 받기', { exact: true })).toHaveCount(0)
})

test('AC-O2-06·10·50: 번호 방송 콘솔엔 판매 방식 글·옵션 추가·지금 상품이 없고 `반바지 M`·`초코 과자 3`은 주문이 아니다', async ({ page }) => {
  await loginNewSeller(page)
  const opt = await createBroadcast(page, { rehearsal: true, saleMode: 'OPTIONS' })
  const num = await createBroadcast(page, { rehearsal: true, saleMode: 'NUMBERS' })
  await page.goto(`/broadcasts/${encodeURIComponent(opt.b)}`)
  await expect(page.getByLabel('빠른 입력')).toBeFocused()
  await expect(page.getByText('상품명·옵션도 받기', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '옵션 추가' })).toBeVisible()
  await expect(page.getByRole('radiogroup', { name: '판매 방식' })).toHaveCount(0)

  await registerOptions(page, num.b, { no: 21, name: '반바지', price: 15000 })
  await registerOptions(page, num.b, { no: 22, name: '초코 과자', price: 3000 })
  await page.goto(`/broadcasts/${encodeURIComponent(num.b)}`)
  await expect(page.getByLabel('빠른 입력')).toBeFocused()
  await expect(board(page).getByRole('button', { name: /^21번 / })).toBeVisible()
  await expect(page.getByText('상품명·옵션도 받기')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '옵션 추가' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: '지금 상품' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^지금 상품으로/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^변형 펼치기/ })).toHaveCount(0)
  await chat(page, num.b, '홍길동', '반바지 M')
  await chat(page, num.b, '김철수', '초코 과자 3')
  await chat(page, num.b, '이영희', '21')
  await waitClaims(page, num.date, true, num.b, 1)
  const claims = (await oscope(page, num.date, true)).claims.filter((c) => c.broadcast === num.b)
  expect(claims.map((c) => c.no)).toEqual([21])
  // 상품 상세에도 옵션·별칭 칸이 없다
  await board(page).getByRole('button', { name: /^21번 / }).click()
  await expect(page.getByRole('button', { name: '옵션 고치기' })).toHaveCount(0)
  await expect(page.getByText(/별칭/)).toHaveCount(0)
  await expect(page.getByText(/확인 필요/)).toHaveCount(0)
  // 옵션 칸이 붙은 이벤트가 기록되지 않았다
  const events = await history(page, num.date, true)
  expect(events.filter((e) => e.type === 'product.focus' || e.type.endsWith('Review'))).toEqual([])
})
