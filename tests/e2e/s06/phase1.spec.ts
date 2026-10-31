// 1단계 끝까지 (AC-S06-90, SPEC §8, HG-1 모의 검증) — test-e2e.
// PC(1440×900): 리허설 생성기 1,000건(채팅 순서 번호 고정) + 빠른 입력 1~30번 + 알림 처리.
// 휴대폰(375×812): 그동안 문자찜 11건(전화번호·같은 번호 둘·메모만·구매자 고르기·같은 사람 하나 더·아직 없는 번호·받은 시각),
//   끝난 뒤 구매자 합치기(막히면 한쪽 취소), 정산 입금 5건(하나는 오타 → 환불)·배송비 예외·할인.
// 화면 값(PC 보드·휴대폰 구매자 목록·정산 카드)이 이력을 코어 applyEvent로 처음부터 재생한 결과와 같아야 한다.
import { test, expect, type Browser, type Page } from '@playwright/test'
import {
  applyEvent, formatWon, getBuyer, initEngine, listBuyers, listProducts, listSettlements, type EngineEvent, type EngineState,
} from '@livejjim/core'
import { boardItem, history, login, openNewBroadcast, openSms, scopeView, sendViewerChat, smsField, uniqueDate, writeEvent } from './support.ts'

const STATUS_WORD: Record<string, string> = { READY: '공개 전', OPEN: '판매 중', SOLD: '판매 완료', HOLD: '일시 중지', CLOSED: '판매 종료' }
const PAY_WORD: Record<string, string> = { UNPAID: '미입금', PARTIAL: '부분 입금', PAID: '입금 완료', OVERPAID: '과입금' }

async function phone(browser: Browser): Promise<Page> {
  const baseURL = test.info().project.use.baseURL!
  const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', isMobile: true, hasTouch: true })
  const page = await context.newPage()
  await login(page)
  return page
}

/** 휴대폰에서 문자찜 하나 (결과 카드가 이 번호로 바뀔 때까지) */
async function sms(mobile: Page, no: number, fill: { phone?: string; memo?: string; received?: string } = {}): Promise<void> {
  await smsField(mobile, '번호').fill(String(no))
  if (fill.received !== undefined) await smsField(mobile, '받은 시각').fill(fill.received)
  if (fill.phone !== undefined) await smsField(mobile, '전화번호').fill(fill.phone)
  if (fill.memo !== undefined) await smsField(mobile, '메모').fill(fill.memo)
  await mobile.getByRole('button', { name: `${String(no)}번에 문자찜 넣기` }).click()
  const late = mobile.getByRole('dialog', { name: '받은 시각을 확인해 주세요' })
  // SRV1 (D-APP-24): 받은 시각은 넣기를 누른 뒤 서버에 읽혀 늦은지 안다 — 확인 창이 곧바로가 아니라 답이 온 뒤 뜬다. 창이 뜨거나 칸이 비워질 때까지 기다린다
  if (fill.received !== undefined) {
    await expect.poll(async () => (await late.isVisible()) || (await smsField(mobile, '번호').inputValue()) === '', { message: '확인 창 또는 넣음' }).toBe(true)
    if (await late.isVisible()) await late.getByRole('button', { name: '이대로 넣기' }).click()
  }
  await expect(smsField(mobile, '번호')).toHaveValue('')
  await expect(mobile.getByRole('region', { name: '넣은 결과' })).toContainText(`${String(no)}번`)
}

/** 창이 열렸는데 그 사이 알림이 없어졌을 때 보이는 빈 문장 (AlertDialogs) */
const EMPTY_ALERT = /^지금 (정할 충돌|처리할 취소 요청|정할 승계)이 없어요\.$/

/**
 * PC 알림 띠의 충돌·취소 요청·승계 결정을 하나 처리 (S05 rehearsal-full과 같은 방식).
 * 시험 경쟁 수정(SA-N4a-04, D-087): 앞 조치를 보낸 뒤 증분 동기화가 오기까지 띠는 지난 수를 잠깐 보인다.
 * 센 뒤 누르기 전에 그 알림이 없어지면 Alt+1이 창을 열지 않는 게 맞고(D-087), 연 뒤 없어지면 창이 빈 문장을 보인다.
 * 그래서 다시 센다. 띠에 처리할 알림이 남아 있는데 세 번 모두 창이 없으면 여전히 실패다.
 * 돌려주는 값: 'handled' 하나 처리 · 'gone' 연 창이 빈 문장이라 닫음(다시 셀 것) · false 처리할 알림 없음
 */
async function handleOne(page: Page): Promise<'handled' | 'gone' | false> {
  const strip = page.getByRole('region', { name: '알림' })
  const actionable = strip.getByRole('button', { name: /^(충돌|취소 요청|승계 결정 필요) \d+$/ })
  const pending = page.getByRole('region', { name: '보내기 전 조치' }).getByText(/초 뒤 보내요|보내는 중/)
  const dlg = page.getByRole('dialog')
  // 앞 조치가 서버에 닿을 때까지 — "초 뒤 보내요"가 사라진 것은 보내기 시작일 뿐이다(그 뒤 "보내는 중…")
  await expect(pending).toHaveCount(0, { timeout: 15_000 })
  for (let tries = 1; ; tries += 1) {
    if ((await actionable.count()) === 0) return false
    await page.getByLabel('빠른 입력').focus()
    await page.keyboard.press('Alt+1')
    if (await dlg.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true, () => false)) break
    if (tries === 3) {
      await expect(dlg).toBeVisible()
      break
    }
  }
  const empty = dlg.getByText(EMPTY_ALERT)
  const closeEmpty = async (): Promise<'gone'> => {
    // 빈 창에서는 아무 조치도 보내지 않았다
    expect(await page.getByRole('region', { name: '보내기 전 조치' }).getByText(/초 뒤 보내요/).count()).toBe(0)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    return 'gone'
  }
  if (await empty.isVisible()) return closeEmpty()
  const title = await dlg.getByRole('heading').first().innerText()
  if (title.startsWith('승계 결정')) {
    // 제목을 읽은 뒤 승계가 없어지면 버튼 대신 빈 문장이 보인다
    const clicked = await dlg.getByRole('button', { name: /^1 .*1등으로$/ }).click({ timeout: 3_000 }).then(() => true, () => false)
    if (!clicked) {
      await expect(empty).toBeVisible()
      return closeEmpty()
    }
    const reason = page.getByRole('dialog').last()
    await reason.getByLabel('사유').fill('시청자 요청')
    await reason.getByLabel('사유').press('Enter')
  } else {
    await page.keyboard.press('1')
    // 연 뒤 "1" 전에 알림이 없어졌으면 창은 빈 문장으로 남는다("1"이 누를 버튼이 없다). 내용 있는 창은 닫혀야 한다
    await expect(page.getByRole('dialog').filter({ hasNot: page.getByText(EMPTY_ALERT) })).toHaveCount(0)
    if ((await page.getByRole('dialog').count()) > 0) return closeEmpty()
  }
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('region', { name: '보내기 전 조치' }).getByText(/초 뒤 보내요/)).toHaveCount(0, { timeout: 15_000 })
  return 'handled'
}

function parseWon(text: string): number {
  return Number(text.replace(/[^\d−-]/g, '').replace('−', '-'))
}

/** 이름 표기의 구분 글자를 뗀다 (D-098): "홍길동 · 끝 1234" · "문자찜(김씨) · 뒤 4자리 5678" · "문자찜(김씨) · 문자 20:01:05" (+ " · 2") */
function stripTag(name: string): string {
  return name.replace(/ · (끝 \S+|뒤 4자리 \d{4}|문자 [\d:]+)( · \d+)?$/, '')
}

test('AC-S06-90: 리허설 + 휴대폰 문자찜 + 구매자 합치기 + 정산 입력 → PC 보드·구매자·정산 = 코어 재생', async ({ page, browser }) => {
  test.setTimeout(420_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await login(page)
  const date = uniqueDate()
  const title = `끝까지${String(Math.floor(Math.random() * 1e5))}`
  const b = await openNewBroadcast(page, { date, rehearsal: true, title })
  // 구매자 고르기·합치기 상대로 쓸 유튜브 시청자 (생성기 시청자와 겹치지 않는 채널)
  await sendViewerChat(page, b, '단골손님', '안녕하세요', 'sim_regular_9001')
  const panel = page.getByRole('region', { name: '리허설 조작판' })
  await panel.getByLabel('총 개수').fill('1000')
  await panel.getByLabel('초당 속도').fill('4')
  await panel.getByText('더 보기').click()
  await panel.getByLabel('채팅 순서 번호').fill('7')
  await panel.getByRole('button', { name: '가짜 채팅 시작' }).click()
  const input = page.getByLabel('빠른 입력')
  for (let no = 1; no <= 30; no += 1) {
    await input.fill(`${String(no)} 상품${String(no)} ${String(no % 9 + 1)}000`)
    await input.press('Enter')
    await expect(boardItem(page, no)).toBeVisible()
  }
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // ── 휴대폰 문자찜 (생성기가 도는 동안) ──
  const mobile = await phone(browser)
  await openSms(mobile, title)
  await expect(mobile.getByText('리허설 방송이에요 — 실제 판매에 들어가지 않아요')).toBeVisible()
  await sms(mobile, 3, { phone: '010-4100-0001' })
  await sms(mobile, 4, { phone: '01041000001' }) // 같은 번호(형식 다름) → 같은 문자 구매자
  await sms(mobile, 5, { memo: '김씨' })
  await mobile.getByRole('region', { name: '넣은 결과' }).getByRole('button', { name: '같은 사람 하나 더' }).click()
  await expect(mobile.getByRole('group', { name: '고른 구매자' })).toBeVisible()
  await sms(mobile, 7)
  // 구매자 고르기 (유튜브 시청자)
  await smsField(mobile, '구매자 고르기').fill('단골')
  await mobile.getByRole('list', { name: '찾은 구매자' }).getByRole('button', { name: /단골손님/ }).click()
  await sms(mobile, 6)
  await sms(mobile, 88, { memo: '이씨' }) // 아직 없는 번호 → 보류
  await sms(mobile, 8, { received: '00:00:30', memo: '박씨' })
  await sms(mobile, 9, { phone: '010-4200-0002' })
  await sms(mobile, 10, { memo: '최씨' })
  await sms(mobile, 11, { phone: '010-4300-0003', memo: '정씨' })
  await sms(mobile, 12, { phone: '010-4200-0002' })
  // PC: 35번 등록 → 보류 찜 판정
  await input.fill('88 늦은상품 5000')
  await input.press('Enter')
  await expect(boardItem(page, 88)).toBeVisible()
  // 휴대폰에서 넣은 문자찜이 PC 보드에 (1초)
  await expect(boardItem(page, 88)).toContainText('문자찜(이씨)', { timeout: 1000 })

  // ── 생성기가 끝날 때까지 PC에서 알림 처리 ──
  const deadline = Date.now() + 200_000
  for (;;) {
    if (await handleOne(page)) continue
    const gen = await (await page.request.get(`/api/broadcasts/${b}/rehearsal/generator`)).json() as { generator: { running: boolean; sent: number } }
    if (!gen.generator.running) {
      if (await handleOne(page)) continue
      break
    }
    if (Date.now() > deadline) throw new Error('생성기가 끝나지 않음')
    await expect.poll(async () => {
      const g = await (await page.request.get(`/api/broadcasts/${b}/rehearsal/generator`)).json() as { generator: { running: boolean; sent: number } }
      return !g.generator.running || g.generator.sent > gen.generator.sent
    }, { timeout: 20_000 }).toBe(true)
  }
  await expect(panel.getByRole('status', { name: '가짜 채팅 상태' })).toContainText('1000 / 1000')

  // ── 휴대폰 구매자 화면: 문자찜(김씨)를 단골손님과 합치기 (막히면 한쪽 찜 취소) ──
  await mobile.goto(`/buyers?date=${date}&rehearsal=true`)
  const listRegion = mobile.getByRole('region', { name: '구매자 목록' })
  await listRegion.getByLabel('구매자 찾기').fill('김씨')
  await listRegion.getByRole('list', { name: '찾은 구매자' }).getByRole('link').first().click()
  const detail = mobile.getByRole('region', { name: '구매자 자세히' })
  await detail.getByRole('button', { name: '다른 구매자와 합치기' }).click()
  await mobile.getByLabel('합칠 구매자 찾기').fill('단골')
  await mobile.getByRole('list', { name: '합칠 구매자' }).getByRole('button', { name: /단골손님/ }).click()
  let mergeDlg = mobile.getByRole('dialog', { name: '구매자 합치기' })
  await expect(mergeDlg).toContainText('남는 이름: 단골손님(유튜브)')
  const mergeButton = mergeDlg.getByRole('button', { name: '합치기', exact: true })
  // 미리 보기는 서버에서 받는다 — 받는 동안 "합치기"가 잠겨 있으므로 받은 뒤에 막힘을 본다 (AC-S06b-33 — 교체)
  await expect(mergeDlg.getByText(/미리 보기를 (새로 )?받는 중이에요/)).toHaveCount(0)
  await expect(mergeDlg.getByRole('alert').or(mergeDlg.getByText(/^옮겨 갈 확정 찜/))).toBeVisible()
  if (await mergeButton.isDisabled()) {
    await mergeDlg.getByRole('button', { name: /자세히$/ }).first().click()
    const prod = mobile.getByRole('dialog', { name: /자세히$/ })
    await prod.getByRole('listitem').filter({ hasText: '문자찜' }).getByRole('button', { name: '찜 취소하기' }).click()
    await mobile.keyboard.press('1') // QL3R1 D-QL3R1-05: 빠른 사유로 바로 5초 대기 (보내기 Enter 없음)
    await expect(mobile.getByRole('region', { name: '보내기 전 조치' }).getByText(/초 뒤 보내요/)).toHaveCount(0, { timeout: 15_000 })
    // 상품 자세히는 열린 채 — "합치기로 돌아가기" (AC-S06b-34 — 교체)
    await prod.getByRole('button', { name: '합치기로 돌아가기' }).click()
    mergeDlg = mobile.getByRole('dialog', { name: '구매자 합치기' })
    await expect(mergeButton).toBeEnabled()
  }
  await mergeDlg.getByRole('button', { name: '1 같은 사람' }).click()
  await mergeDlg.getByRole('button', { name: '합치기', exact: true }).click()
  await expect(mobile.getByText('합쳤어요')).toBeVisible()
  // 휴대폰 합치기가 PC 구매자 목록에 (PC를 구매자 화면으로)
  await page.goto(`/buyers?date=${date}&rehearsal=true`)
  // PC는 표 (AC-S06b-21 — 교체). 기본 목록이 아니라 찾기로 본다 (판정 SA-I4-008, D-090 — 교체):
  // 기본 목록은 "그날 확정 찜이 있는 지금의 구매자"다. 합친 단골손님에게 확정 찜이 있는지는 생성기 채팅과
  // 문자찜 5·6·7의 기록 차례로 갈린다(셋 다 대기면 기본 목록에서 빠지는 게 맞다). 찾기는 그날 기록된 모든 구매자.
  // 지금의 구매자 목록·합계 = 재생은 아래 휴대폰 구매자 목록 비교가 계속 본다.
  const pcList = page.getByRole('region', { name: '구매자 목록' })
  await pcList.getByLabel('구매자 찾기').fill('단골')
  await expect(pcList.getByRole('table', { name: '찾은 구매자' }).getByRole('row').filter({ has: page.getByRole('link', { name: /단골손님/ }) })).toContainText('합친 구매자 1명')

  // ── 휴대폰 정산: 입금 5건(하나는 오타 → 환불), 직접 수령 하나, 할인 하나 ──
  await mobile.goto(`/settlements?date=${date}&rehearsal=true`)
  const cards = mobile.getByRole('list', { name: '정산 묶음' })
  await expect(cards.getByRole('link').first()).toBeVisible()
  const sdetail = mobile.getByRole('region', { name: '정산 자세히' })
  for (let i = 0; i < 5; i++) {
    await mobile.getByRole('group', { name: '입금 상태로 거르기' }).getByRole('button', { name: '미입금' }).click()
    await cards.getByRole('link').first().click()
    if (i === 3) {
      await sdetail.getByRole('button', { name: '배송비 바꾸기' }).click()
      await mobile.getByRole('dialog', { name: '배송비 바꾸기' }).getByRole('radio', { name: '직접 수령' }).check()
      await mobile.getByRole('dialog', { name: '배송비 바꾸기' }).getByRole('button', { name: '배송비 바꾸기' }).click()
      await expect(sdetail.getByRole('region', { name: '금액' })).toContainText('(직접 수령)')
    }
    if (i === 4) {
      await sdetail.getByRole('button', { name: '할인·추가' }).click()
      const adj = mobile.getByRole('dialog', { name: '할인·추가' })
      await adj.getByLabel('할인 금액').fill('1000')
      await adj.getByRole('button', { name: '1 단골 할인' }).click()
      await adj.getByRole('button', { name: '할인 적기' }).click()
      await expect(adj).toHaveCount(0)
      await expect(sdetail.getByRole('region', { name: '금액' })).toContainText('조정 −1,000원')
    }
    await sdetail.getByRole('button', { name: '입금 적기' }).click()
    const pay = mobile.getByRole('dialog', { name: '입금 적기' })
    const value = await pay.getByLabel('입금 금액').inputValue()
    if (i === 0) {
      await pay.getByLabel('입금 금액').fill(`${value}0`) // 0 하나 더 친 오타
      await pay.getByRole('button', { name: '입금 적기' }).click()
      await mobile.getByRole('dialog', { name: '입금 금액 확인' }).getByRole('button', { name: /원 적기$/ }).click()
      await expect(sdetail).toContainText('과입금')
      await sdetail.getByRole('button', { name: '환불 적기' }).click()
      const refund = mobile.getByRole('dialog', { name: '환불 적기' })
      await refund.getByRole('button', { name: '2 입금액 잘못 적음' }).click()
      await refund.getByRole('button', { name: '환불 적기' }).click()
      await expect(refund).toHaveCount(0)
    } else {
      await pay.getByRole('button', { name: '입금 적기' }).click()
      await expect(pay).toHaveCount(0)
    }
    await expect(sdetail.getByText('입금 완료').first()).toBeVisible()
    await sdetail.getByRole('button', { name: '정산 목록으로' }).click()
  }
  await mobile.getByRole('group', { name: '입금 상태로 거르기' }).getByRole('button', { name: '전체' }).click()

  // ── 코어 재생 ──
  const events = await history(page, date, true)
  let state: EngineState = initEngine({ broadcasts: [], settings: {} })
  const seenMsg = new Set<string>()
  for (const e of events) {
    if (e.failed) continue
    if (e.type === 'chat') {
      const key = `${String(e.fields['b'])}|${String(e.fields['id'])}`
      expect(seenMsg.has(key), `같은 메시지 ID 사본이 기록됨 ${key}`).toBe(false)
      seenMsg.add(key)
    }
    const fields = { ...e.fields }
    if (e.type === 'sms' && typeof fields['phoneLast4'] === 'string') fields["phoneKey"] = `test-phonekey-${String(fields["phoneLast4"])}`
    const event = { type: e.type, seq: e.seq, at: Date.parse(String((e as unknown as { at: string }).at)), ...fields, ...(e.reason === null ? {} : { reason: e.reason }) } as unknown as EngineEvent
    state = applyEvent(state, event).state
  }
  // 같은 요청 번호 재전송이 기록을 두 번 만들지 않는다: 휴대폰에서 넣은 문자찜은 정확히 11건
  expect(events.filter((e) => e.type === 'sms' && !e.failed)).toHaveLength(11)
  const replayProducts = listProducts(state).filter((p) => p.broadcast === b)
  expect(replayProducts.length).toBeGreaterThanOrEqual(31)
  const replayBuyers = listBuyers(state)
  const replaySettle = listSettlements(state)
  // 서버 조회 = 재생
  const view = await scopeView(page, date, true)
  expect(view.buyers.map((x) => ({ id: x.id, current: x.current, subtotal: x.subtotal })).sort((x, y) => x.id.localeCompare(y.id)))
    .toEqual(replayBuyers.map((x) => ({ id: x.id, current: x.current, subtotal: x.subtotal })).sort((x, y) => x.id.localeCompare(y.id)))
  expect(view.settlements.map((s) => ({ buyer: s.buyer, total: s.total, received: s.received, payment: s.payment })).sort((x, y) => x.buyer.localeCompare(y.buyer)))
    .toEqual(replaySettle.map((s) => ({ buyer: s.buyer, total: s.total, received: s.received, payment: s.payment })).sort((x, y) => x.buyer.localeCompare(y.buyer)))
  // 문자 구매자: 같은 번호 둘(형식 다름)은 한 구매자, 번호가 다른 것은 다른 구매자
  const smsBuyers = replayBuyers.filter((x) => x.kind === 'sms' && x.phoneLast4 !== null)
  expect(smsBuyers.map((x) => x.phoneLast4).sort()).toEqual(['0001', '0002', '0003'])

  // PC 보드 (콘솔로 돌아가서)
  await page.goto(`/broadcasts/${b}`)
  for (const p of replayProducts) {
    const item = boardItem(page, p.no)
    await expect(item).toContainText(STATUS_WORD[p.status]!)
    await expect(item).toContainText(`대기 ${String(p.waitlist.length)}`)
    for (const w of p.winners) await expect(item).toContainText(getBuyer(state, w)!.display)
    if (p.winners.length === 0) await expect(item).toContainText('아직 없음')
  }

  // 휴대폰 구매자 목록 (지금의 구매자마다 표시 이름·상품 수·합계)
  await mobile.goto(`/buyers?date=${date}&rehearsal=true`)
  const buyerList = mobile.getByRole('region', { name: '구매자 목록' }).getByRole('list', { name: '구매자' })
  await expect(buyerList.getByRole('link').first()).toBeVisible()
  for (;;) {
    const more = mobile.getByRole('button', { name: /^더 보기/ })
    if ((await more.count()) === 0) break
    await more.click()
  }
  const uiBuyers = (await buyerList.getByRole('link').allInnerTexts()).map((t) => {
    const m = /(\d+)개 · ([\d,]+)원/.exec(t)
    return `${stripTag(t.split('\n')[0]!.trim())}|${m?.[1] ?? '?'}|${m?.[2] ?? '?'}`
  }).sort()
  const expectBuyers = replayBuyers.filter((x) => x.mergedInto === null && x.items.length > 0)
    .map((x) => `${x.display}|${String(x.items.length)}|${formatWon(x.subtotal).replace('원', '')}`).sort()
  expect(uiBuyers).toEqual(expectBuyers)

  // 휴대폰 정산 카드 (묶음마다 상품 합계·배송비·조정·최종·받은 금액·입금 상태)
  await mobile.goto(`/settlements?date=${date}&rehearsal=true`)
  const cardList = mobile.getByRole('list', { name: '정산 묶음' })
  await expect(cardList.getByRole('link').first()).toBeVisible()
  const uiCards = (await cardList.getByRole('link').allInnerTexts()).map((t) => {
    // 이름 뒤의 구분 " · 끝 1234"는 떼고 비교한다 (같은 표시 이름 구분 — D-098 이름 표기로 교체)
    const name = stripTag(t.split('\n')[0]!.trim())
    const sub = /상품 (\d+)개 · ([\d,]+)원/.exec(t)
    const total = /최종 ([\d,]+)원/.exec(t)
    const received = /받은 금액 ([\d,]+)원/.exec(t)
    const pay = Object.values(PAY_WORD).find((w) => t.includes(w)) ?? '?'
    return `${name}|${sub?.[1] ?? '?'}|${String(parseWon(sub?.[2] ?? ''))}|${String(parseWon(total?.[1] ?? ''))}|${String(parseWon(received?.[1] ?? ''))}|${pay}`
  }).sort()
  const expectCards = replaySettle.map((s) => {
    const name = getBuyer(state, s.buyer)!.display
    return `${name}|${String(s.items.length)}|${String(s.subtotal)}|${String(s.total)}|${String(s.received)}|${PAY_WORD[s.payment]!}`
  }).sort()
  expect(uiCards).toEqual(expectCards)

  // 실제 범위(같은 날짜)에는 아무것도 없다
  const real = await page.request.get(`/api/days/${date}`)
  if (real.status() !== 404) {
    const body = await real.json() as { broadcasts: { id: string }[]; products: { key: string }[]; claims: unknown[] }
    expect(body.broadcasts.map((x) => x.id)).not.toContain(b)
    expect(body.products).toEqual([])
  }
  void writeEvent
  await mobile.context().close()
})
