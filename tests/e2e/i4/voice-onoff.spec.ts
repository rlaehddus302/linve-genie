import { haltPcm, historyProbe, LG_FAILED, microphoneError, pcmCounts, reconnectPcm } from '../app1/support.ts'
import { clockConsole, pauseClock } from '../i5/support.ts'
// I4 음성 켜기·끄기 (AC-I4-10~14) — test-e2e. SRV1부터 PC도 서버 받아쓰기(D-APP-22·D-APP-25): 합성 마이크 → 서버 → 모의 일꾼(app1/support).
// 가짜 SpeechRecognition은 "만들지 않는다"를 보려고만 둔다(AC-SRV1-10).
import { test, expect } from '@playwright/test'
import {
  CHROME_ONLY_WORDS,
  SERVER_CONSENT,
  SERVER_NOTICE,
  board,
  boardItem,
  card,
  cardButton,
  cardList,
  installFakeSpeech,
  login,
  openNewBroadcast,
  recordRequests,
  recordVoiceChunk,
  register,
  speak,
  speechCounts,
  turnOnVoice,
  uniqueDate,
  voiceRegion,
  openVoiceLog,
  voiceLogItems,
  withoutVoiceHeard,
} from './support.ts'

test.describe('I4 음성 켜기·끄기', () => {
  test('AC-I4-10: 누르기 전에는 인식 객체·getUserMedia·이력 조회·음성 조각이 없고, 새로 고침·다른 화면에 다녀오면 꺼져 있다', async ({ page }) => {
    await installFakeSpeech(page)
    const chunks = recordVoiceChunk(page)
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true })
    // 이력 조회(/api/days)는 콘솔을 연 뒤부터 센다 — 방송 목록(홈)은 봉인 예고를 보이려고 /api/days를 부른다(I3, AC-I3-40).
    // openNewBroadcast는 콘솔 주소로 새로 열므로(page.goto) 홈의 요청은 그 전에 끝난다. 콘솔에서 누르기 전 0번·켠 뒤 1번은 그대로 본다.
    const requests = recordRequests(page)
    const toggle = page.getByRole('button', { name: '음성 켜기', exact: true })
    await expect(toggle).toBeEnabled()
    // 화면이 자리를 잡을 시간 (상태로 기다릴 수 없는 "하지 않음" 확인 — 보드가 그려진 뒤)
    await expect(board(page)).toBeVisible()
    let counts = await speechCounts(page)
    expect(counts.instances).toBe(0)
    expect(counts.getUserMedia).toBe(0)
    expect(chunks).toEqual([])
    expect(requests.filter((r) => new URL(r.url).pathname === '/api/days' && r.method === 'GET')).toEqual([])

    // 처음: 안내 창 → 켜기 → 서버 이력 조회 1번, 음성 조각 1번
    await historyProbe(page, { fail: false, reset: true })
    await turnOnVoice(page, { consent: true })
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    // SRV1 (D-APP-25 (3), AC-SRV1-10): 브라우저 인식 객체 대신 마이크 한 번 → 서버 받아쓰기 흐름 하나
    counts = await speechCounts(page)
    expect(counts.instances, '브라우저 인식 객체는 만들지 않는다').toBe(0)
    expect((await pcmCounts(page)).starts, '마이크 한 번').toBe(1)
    expect((await pcmCounts(page)).openSockets, '서버 받아쓰기 흐름 하나').toBe(1)
    await expect.poll(async () => (await historyProbe(page)).calls.filter((date) => date === null).length).toBe(1)
    expect(requests.filter((r) => new URL(r.url).pathname === '/api/days' && r.method === 'GET')).toEqual([])

    // 새로 고침 → 꺼짐
    await page.reload()
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    await expect(page.getByRole('button', { name: '음성 켜기', exact: true })).toBeVisible()
    await expect(voiceRegion(page)).toHaveCount(0)
    expect((await speechCounts(page)).instances).toBe(0)
    expect((await pcmCounts(page)).starts, '새로 고침 뒤 마이크를 열지 않는다').toBe(0)

    // V3 교체(D-V3-52, AC-V3-58): 켜고 방송 목록에 다녀와도 음성은 켜진 채(마이크를 멈추지 않음), 돌아오면 "듣는 중"
    await turnOnVoice(page)
    const stopped = (await pcmCounts(page)).stops
    await page.getByRole('link', { name: '방송 목록' }).click()
    await expect(page.getByRole('button', { name: '새 방송 시작' })).toBeVisible()
    expect((await pcmCounts(page)).stops, '다른 화면에서도 마이크를 멈추지 않는다').toBe(stopped)
    await page.goBack()
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    await expect(voiceRegion(page).getByRole('status').filter({ hasText: '음성: 듣는 중' })).toBeVisible()
    void b
  })

  test('AC-I4-11: 처음 켤 때 안내 창 — 문장 세 개·처음 포커스 닫기, 닫기·Esc는 꺼진 그대로, 두 번째는 창 없이, 인식 설정 ko-KR·continuous·interim', async ({ browser }) => {
    const baseURL = test.info().project.use.baseURL!
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
    // 처음 켜는 기기 그대로(저장값 없음 = 바로 등록 켬, D-V3-16)
    await installFakeSpeech(context, { autoRegister: true })
    const page = await context.newPage()
    await login(page)
    await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
    await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
    const dlg = page.getByRole('dialog', { name: '음성으로 상품 등록' })
    await expect(dlg).toBeVisible()
    // SRV1 (D-APP-25 (3)): 크롬 창의 I4·V3 첫 줄·바로 등록 줄·D-I5-06 고지·D-I5-11 마이크 줄 대신 라이브지니 받아쓰기 세 줄 그대로(D-APP-08)
    await expect(dlg.locator('p')).toHaveText([...SERVER_CONSENT])
    for (const old of ['카드를 확인하고 등록', '바로 등록돼요', ...CHROME_ONLY_WORDS]) await expect(dlg).not.toContainText(old)
    await expect(dlg.getByRole('button', { name: '닫기' })).toBeFocused()
    // 창이 열린 동안 "음성 켜기"는 창 안의 하나뿐
    await expect(page.getByRole('button', { name: '음성 켜기', exact: true })).toHaveCount(1)
    await dlg.getByRole('button', { name: '닫기' }).click()
    await expect(dlg).toHaveCount(0)
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    expect((await speechCounts(page)).instances).toBe(0)
    expect((await pcmCounts(page)).starts, '닫으면 마이크를 열지 않는다').toBe(0)

    // Esc
    await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
    await expect(dlg).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    expect((await speechCounts(page)).instances).toBe(0)
    expect((await pcmCounts(page)).starts, 'Esc도 마이크를 열지 않는다').toBe(0)

    // 창의 "음성 켜기" — 인식 설정(ko-KR·continuous·interim)은 크롬 인식 객체의 것이라 없다: 브라우저 인식 객체는 0번, 마이크 한 번·서버 흐름 하나 (AC-SRV1-10)
    await turnOnVoice(page, { consent: true })
    expect((await speechCounts(page)).instances, '브라우저 인식 객체를 만들지 않는다').toBe(0)
    const counts = await pcmCounts(page)
    expect(counts.starts, '마이크 한 번').toBe(1)
    expect(counts.openSockets, '서버 받아쓰기 흐름 하나').toBe(1)
    // 켜진 동안 고지 (D-APP-08 — 모든 기기 같은 문장)
    await expect(voiceRegion(page)).toContainText(SERVER_NOTICE)
    for (const old of CHROME_ONLY_WORDS) await expect(voiceRegion(page)).not.toContainText(old)
    await expect(page.getByLabel('빠른 입력')).toBeFocused()

    // 끄고 다시 켜면 창 없이
    await voiceRegion(page).getByRole('button', { name: '음성 끄기' }).click()
    await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
    await expect(voiceRegion(page).getByRole('status').filter({ hasText: '음성: 듣는 중' })).toBeVisible()
    await expect(dlg).toHaveCount(0)

    // APP1 D-APP1-04: 새 페이지는 새 device다. 동의는 같은 컨텍스트에 남되 한 흐름만 켠다.
    await voiceRegion(page).getByRole('button', { name: '음성 끄기' }).click()
    await expect.poll(async () => (await pcmCounts(page)).openSockets).toBe(0)
    // 같은 기기 저장소(컨텍스트)의 새 페이지도 창 없이
    const page2 = await context.newPage()
    await page2.goto(page.url())
    await expect(page2.getByLabel('빠른 입력')).toBeFocused()
    await turnOnVoice(page2)
    await expect(page2.getByRole('dialog', { name: '음성으로 상품 등록' })).toHaveCount(0)
    await context.close()
  })

  test('AC-I4-11: 저장소를 쓸 수 없으면 매번 안내 창', async ({ page }) => {
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true })
    await installFakeSpeech(page, { blockStorage: true })
    await page.goto(`/broadcasts/${encodeURIComponent(b)}`)
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    await turnOnVoice(page, { consent: true })
    await voiceRegion(page).getByRole('button', { name: '음성 끄기' }).click()
    await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '음성으로 상품 등록' })).toBeVisible()
  })

  test('AC-I4-12: 지원하지 않는 브라우저 — 창을 띄우기 전에 알리고 꺼진 그대로', async ({ page }) => {
    await installFakeSpeech(page, { unsupported: true })
    await login(page)
    await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
    await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
    // D-I5-03: 지원 안 함 문장 교체 (I5)
    await expect(page.getByRole('alert').filter({ hasText: '이 기기에서는 음성이 어려워요. 상품은 빠른 입력으로 그대로 등록할 수 있어요.' })).toBeVisible()
    await expect(page.getByRole('dialog', { name: '음성으로 상품 등록' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '음성 켜기', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '음성 끄기' })).toHaveCount(0)
  })

  // D-REL1-05: 크롬 not-allowed·audio-capture 대신 마이크 잡기 실패(NotAllowedError·NotFoundError). 적용 안 함: service-not-allowed(크롬 오류 코드, D-REL1-01 (3))
  test('AC-I4-12 → D-REL1-05: 마이크 권한 거부·마이크 없음은 꺼지고 다시 시작하지 않는다, 다시 켜면 문장이 사라진다', async ({ page }) => {
    await installFakeSpeech(page, { consent: true })
    await clockConsole(page)
    await pauseClock(page)
    await microphoneError(page, 'NotAllowedError')
    await page.getByRole('button', { name: '음성 켜기', exact: true }).click()
    const denied = page.getByRole('alert').filter({ has: page.getByText('마이크 사용이 막혀 있어요.', { exact: true }) })
    await expect(denied).toBeVisible()
    const sockets = (await pcmCounts(page)).sockets
    await page.clock.runFor(10_000)
    expect((await pcmCounts(page)).sockets, '저절로 다시 시작하지 않는다').toBe(sockets)
    await expect(page.getByRole('button', { name: /^(음성 켜기|다시 켜기)$/ }).first()).toBeVisible()

    await microphoneError(page, 'NotFoundError')
    await page.getByRole('button', { name: /^(음성 켜기|다시 켜기)$/ }).first().click()
    await expect(page.getByText('마이크 사용이 막혀 있어요.')).toHaveCount(0)
    await expect(page.getByRole('alert').filter({ hasText: '마이크를 찾지 못했어요. 마이크 연결을 확인해 주세요.' })).toBeVisible()
    const again = (await pcmCounts(page)).sockets
    await page.clock.runFor(10_000)
    expect((await pcmCounts(page)).sockets, '저절로 다시 시작하지 않는다').toBe(again)

    await microphoneError(page, null)
    await page.getByRole('button', { name: /^(음성 켜기|다시 켜기)$/ }).first().click()
    await expect(voiceRegion(page).getByRole('status').filter({ hasText: '음성: 듣는 중' })).toBeVisible()
    await expect(page.getByText('마이크를 찾지 못했어요.')).toHaveCount(0)
  })

  // D-REL1-05: 크롬 network·no-speech·저절로 끝남 대신 음성 웹소켓 끊김 — 다시 잇고, 한도(다섯 번) 넘게 끊기면 멈춤 문장과 [다시 켜기], 손 입력은 그대로
  test('AC-I4-12 → D-REL1-05: 음성 웹소켓이 끊기면 다시 잇고, 한도를 넘으면 "듣기 멈춤"으로 꺼진다, 다시 켤 수 있다', async ({ page }) => {
    await installFakeSpeech(page, { consent: true })
    await clockConsole(page)
    await turnOnVoice(page)
    await pauseClock(page)
    await haltPcm(page)
    await register(page, '21 핑크프릴 10', 21)
    await page.getByRole('button', { name: '다시 켜기', exact: true }).first().click()
    await expect(voiceRegion(page).getByRole('status').filter({ hasText: '음성: 듣는 중' })).toBeVisible()
    await expect(voiceRegion(page)).not.toContainText(LG_FAILED)
  })

  // D-REL1-05: 끊기기 전 받은 최종 결과는 남는다(옛 "최종 결과가 오면 끊김 횟수를 다시 센다"의 크롬 횟수 세기는 적용 안 함 — D-REL1-01 (3))
  test('AC-I4-12 → D-REL1-05: 끊김 사이에 받은 최종 결과는 카드로 남고, 다시 이은 뒤에도 듣는다', async ({ page }) => {
    await installFakeSpeech(page, { consent: true })
    await clockConsole(page)
    await turnOnVoice(page)
    await pauseClock(page)
    for (let i = 0; i < 2; i++) await reconnectPcm(page, i)
    await speak(page, '15번 핑크프릴 만오천 원')
    await expect(card(page, '15번 핑크프릴 15,000원')).toBeVisible()
    for (let i = 2; i < 4; i++) await reconnectPcm(page, i)
    await expect(card(page, '15번 핑크프릴 15,000원')).toBeVisible()
    await expect(page.getByRole('button', { name: '음성 끄기' })).toBeVisible()
  })

  test('AC-I4-13: 중간 결과는 자막 한 줄로 덮어쓰고, 최종 결과는 기록 맨 앞·카드, 악성 문장은 글자로만', async ({ page }) => {
    await installFakeSpeech(page, { consent: true })
    const dialogs: string[] = []
    page.on('dialog', (d) => {
      dialogs.push(d.message())
      void d.dismiss()
    })
    await login(page)
    await openNewBroadcast(page, { date: uniqueDate(), rehearsal: true })
    await turnOnVoice(page)
    // V3 교체(D-V3-50, AC-V3-56): "들리는 말:" 줄이 없어지고 중간 결과는 맨 위 큰 칸("지금 들리는 말")에만 덮어써 보인다
    // 적용 안 함: D-REL1-02 — 중간 결과 자막 덮어쓰기는 없다. 대신 최종 결과 전에는 큰 칸·카드가 비고, 최종 결과가 오면 그 글이 바로 보인다
    const now = page.getByRole('region', { name: '지금 들리는 말', exact: true })
    await expect(now).toContainText('말하면 여기에 보여요')
    await expect(page.getByText(/^들리는 말:/)).toHaveCount(0)
    await expect(cardList(page)).toHaveCount(0)
    await speak(page, '15번 핑크프릴 만오천 원')
    await expect(now).toContainText('15번 핑크프릴 만오천 원')
    await expect(page.getByText(/^들리는 말:/)).toHaveCount(0)
    await expect(card(page, '15번 핑크프릴 15,000원')).toBeVisible()
    await speak(page, '<img src=x onerror=alert(1)>16번 라울 만원')
    // D-V3-41: 번호가 붙지 않은 말이라 카드는 생기지 않는다 — 글자 그대로는 음성 기록에서 본다(아래)
    await expect(cardList(page).getByRole('listitem')).toHaveCount(1)
    await expect(page.locator('img[src="x"]')).toHaveCount(0)
    await openVoiceLog(page)
    const items = voiceLogItems(page)
    await expect(items).toHaveCount(2)
    await expect(items.nth(0)).toContainText('<img src=x onerror=alert(1)>16번 라울 만원')
    await expect(items.nth(1)).toContainText('15번 핑크프릴 만오천 원')
    expect(await page.locator('img[src="x"]').count()).toBe(0)
    expect(dialogs).toEqual([])
  })

  test('AC-I4-13: 인식 문장은 서버 요청·저장소·콘솔 메시지 어디에도 없다', async ({ page }) => {
    await installFakeSpeech(page, { consent: true })
    const requests = recordRequests(page)
    const logs: string[] = []
    page.on('console', (m) => logs.push(m.text()))
    await login(page)
    const date = uniqueDate()
    await openNewBroadcast(page, { date, rehearsal: true })
    await turnOnVoice(page)
    const secret = '비밀문장가나다 15번 핑크프릴 만오천 원'
    await speak(page, '비밀중간말라마', { final: false })
    await speak(page, secret)
    await expect(card(page, '15번 핑크프릴 15,000원')).toBeVisible()
    await cardButton(page, '15번 핑크프릴 15,000원', '등록').click()
    await expect(boardItem(page, 15)).toBeVisible()
    const stored = await page.evaluate(async () => {
      const out: string[] = []
      for (const s of [localStorage, sessionStorage]) for (let i = 0; i < s.length; i++) out.push(`${s.key(i) ?? ''}=${s.getItem(s.key(i) ?? '') ?? ''}`)
      for (const name of await caches.keys()) {
        const cache = await caches.open(name)
        for (const req of await cache.keys()) out.push(req.url)
      }
      const dbs = (await indexedDB.databases?.()) ?? []
      out.push(...dbs.map((d) => d.name ?? ''))
      return out.join('\n')
    })
    for (const word of ['비밀문장가나다', '비밀중간말라마']) {
      expect(stored).not.toContain(word)
      expect(logs.join('\n')).not.toContain(word)
      for (const r of requests) {
        expect(decodeURIComponent(r.url)).not.toContain(word)
        // D-V3-73: voiceLog.heard 한 줄(가린 들은 말)만 예외
        expect(withoutVoiceHeard(r.body)).not.toContain(word)
      }
    }
    // 등록 쓰기는 번호·품종·가격뿐
    const writes = requests.filter((r) => r.method === 'POST' && r.body.includes('product.register'))
    expect(writes).toHaveLength(1)
    const body = JSON.parse(writes[0]!.body) as Record<string, unknown>
    expect(body).toMatchObject({ type: 'product.register', no: 15, name: '핑크프릴', price: 15000 })
  })

  test('AC-I4-14: 음성 끄기 뒤 늦은 결과는 무시, 카드는 남고 손으로 등록, 콘솔 떠나면 인식 멈춤·돌아오면 카드·기록 없음, 끈 뒤 빠른 입력 그대로', async ({ page }) => {
    await installFakeSpeech(page, { consent: true })
    await login(page)
    const date = uniqueDate()
    const b = await openNewBroadcast(page, { date, rehearsal: true })
    await turnOnVoice(page)
    await speak(page, '15번 핑크프릴 만오천 원')
    await expect(card(page, '15번 핑크프릴 15,000원')).toBeVisible()
    await voiceRegion(page).getByRole('button', { name: '음성 끄기' }).click()
    // D-REL1-05: 끄면 마이크를 멈추고 받아쓰기 흐름을 닫는다 — 늦은 결과가 올 곳이 없다(적용 안 함: 크롬 늦은 결과 이벤트, D-REL1-02)
    await expect.poll(async () => (await pcmCounts(page)).stops, { message: '마이크 멈춤' }).toBeGreaterThanOrEqual(1)
    await expect.poll(async () => (await pcmCounts(page)).openSockets, { message: '흐름 닫힘' }).toBe(0)
    await expect(page.getByRole('button', { name: '음성 켜기', exact: true })).toBeVisible()
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    await expect(card(page, '16번 라울 10,000원')).toHaveCount(0)
    await expect(page.getByText('들리는 말:')).toHaveCount(0)
    await expect(card(page, '15번 핑크프릴 15,000원')).toBeVisible()
    await cardButton(page, '15번 핑크프릴 15,000원', '등록').click()
    await expect(boardItem(page, 15)).toBeVisible()
    await expect(cardList(page)).toHaveCount(0)
    // 끈 뒤 빠른 입력·찾기·되돌리기
    await register(page, '20 라울 10', 20)
    const input = page.getByLabel('빠른 입력')
    await input.press('Control+z')
    await expect(page.getByText('20번 등록을 되돌렸어요(판매 종료)')).toBeVisible()

    // V3 교체(D-V3-52, AC-V3-58): 켜고 카드를 만든 채 떠났다 와도 음성은 켜진 채(인식을 멈추지 않음)이고 카드는 그 방송 콘솔에 남는다
    await turnOnVoice(page)
    await speak(page, '17번 라울 만원')
    await expect(card(page, '17번 라울 10,000원')).toBeVisible()
    const before = (await pcmCounts(page)).stops
    await page.getByRole('link', { name: '방송 목록' }).click()
    await expect(page.getByRole('button', { name: '새 방송 시작' })).toBeVisible()
    expect((await pcmCounts(page)).stops, '마이크를 멈추지 않는다').toBe(before)
    await page.goBack()
    await expect(page.getByLabel('빠른 입력')).toBeFocused()
    await expect(card(page, '17번 라울 10,000원')).toBeVisible()
    await expect(voiceRegion(page).getByRole('status').filter({ hasText: '음성: 듣는 중' })).toBeVisible()
    void b
  })
})
