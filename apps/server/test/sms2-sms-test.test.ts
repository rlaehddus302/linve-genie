// SMS2: 문자 자동 수신 시험 도구 다듬기 — 받은 시각·늦은 정도, 일련번호, 겹친 문자, 요약, 다시 세기, 카드 화면, TRY-IT 차례.
import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSmsTestBox, createSmsTestHttpServer, delayLabel, parsePhoneAt, readSerial, SMS_TEST_LIMIT, SMS_TEST_PATH } from '../src/try/sms-test.ts'

const TOKEN = 'abcd-efgh-jk23'
const BASE = `https://192.168.0.10:7701${SMS_TEST_PATH}`
const SERVER_AT = new Date('2026-10-26T05:03:08.000Z')
const SERVER_MS = SERVER_AT.getTime()

type Box = ReturnType<typeof createSmsTestBox>

function post(body: unknown, token: string | null = TOKEN, query = ''): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token !== null) headers['x-try-token'] = token
  return new Request(`${BASE}${query}`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) })
}

async function must(box: Box, request: Request): Promise<Response> {
  const response = await box.handle(request)
  if (response === null) throw new Error('응답 없음')
  return response
}

async function send(box: Box, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await must(box, post(input))
  expect(response.status).toBe(200)
  return (await response.json()) as Record<string, unknown>
}

async function view(box: Box, query = ''): Promise<string> {
  const response = await must(box, new Request(`${BASE}?t=${TOKEN}${query}`))
  expect(response.status).toBe(200)
  return response.text()
}

/** 태그를 빼고 글자 덩어리만 (화면에 보이는 글) */
function visible(page: string): string {
  return page
    .replace(/<style>[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, '\n')
    .replaceAll('&#39;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

function fixedBox(at: Date = SERVER_AT): Box {
  return createSmsTestBox({ token: TOKEN, now: () => at })
}

/** 지연 ms가 되게 휴대폰 시각(밀리초 숫자)을 만든다 */
const phoneMs = (delayMs: number) => SERVER_MS - delayMs

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SMS2 휴대폰이 받은 시각 (D-SMS2-02)', () => {
  it('AC-SMS2-01 오프셋 있는 ISO — 두 시각과 늦은 정도 3초', async () => {
    for (const receivedAt of ['2026-10-26T14:03:05+09:00', '2026-10-26T05:03:05Z']) {
      const box = fixedBox()
      await send(box, { from: '010-1234-5678', body: '시험 1', device: 'iPhone', receivedAt })
      const text = visible(await view(box))
      expect(text).toContain('휴대폰이 받은 시각 10월 26일 14:03:05')
      expect(text).toContain('서버가 받은 시각 10월 26일 14:03:08')
      expect(text).toContain('늦은 정도 3초')
    }
  })

  it('AC-SMS2-02 오프셋 없는 날짜·시각은 한국 시각 (서버 시간대와 상관없이)', () => {
    const cases: [string, string][] = [
      ['2026-10-26T14:03:05', '3초'],
      ['2026-10-26 14:03:05', '3초'],
      ['2026-10-26T14:03:05.250', '3초'],
      ['2026-10-26 14:03', '8초'],
    ]
    const before = process.env['TZ']
    try {
      for (const tz of ['UTC', 'America/New_York', 'Asia/Seoul']) {
        process.env['TZ'] = tz
        for (const [value, label] of cases) {
          const at = parsePhoneAt(value, SERVER_AT)
          expect(at, value).not.toBeNull()
          expect(delayLabel(SERVER_MS - (at?.getTime() ?? 0)), `${tz} ${value}`).toBe(label)
        }
      }
    } finally {
      if (before === undefined) delete process.env['TZ']
      else process.env['TZ'] = before
    }
    expect(SERVER_MS - (parsePhoneAt('2026-10-26T14:03:05.250', SERVER_AT)?.getTime() ?? 0)).toBe(2750)
  })

  it('AC-SMS2-03 숫자 시각(밀리초·초, 숫자·글)은 모두 3초', () => {
    for (const value of [1792990985000, '1792990985000', 1792990985, '1792990985']) {
      const at = parsePhoneAt(value, SERVER_AT)
      expect(at?.toISOString(), String(value)).toBe('2026-10-26T05:03:05.000Z')
    }
  })

  it('AC-SMS2-03 읽을 수 없는 값은 받기는 200, 화면은 "-"', async () => {
    const bad: unknown[] = [undefined, '', '어제', true, {}, '2026-13-40T99:00', '2026-10-24T14:03:05+09:00', 1792990985000 / 1000 / 1000, 1792990, '1e400', -1792990985000, 'NaN', 'x'.repeat(15000), '2026-02-30T10:00', '2026-10-26T24:00']
    for (const receivedAt of bad) {
      expect(parsePhoneAt(receivedAt, SERVER_AT), String(receivedAt).slice(0, 30)).toBeNull()
      const box = fixedBox()
      const input: Record<string, unknown> = { from: '010-1234-5678', body: '시험 1', device: 'iPhone' }
      if (receivedAt !== undefined) input['receivedAt'] = receivedAt
      await send(box, input)
      const text = visible(await view(box))
      expect(text).toContain('휴대폰이 받은 시각 -')
      expect(text).toContain('늦은 정도 -')
    }
    // 24시간 경계: 꼭 하루는 읽고, 하루를 넘으면 버린다
    expect(parsePhoneAt(SERVER_MS - 24 * 3600 * 1000, SERVER_AT)).not.toBeNull()
    expect(parsePhoneAt(SERVER_MS - 24 * 3600 * 1000 - 1, SERVER_AT)).toBeNull()
    expect(parsePhoneAt(SERVER_MS + 24 * 3600 * 1000 + 1, SERVER_AT)).toBeNull()
  })
})

describe('SMS2 늦은 정도 (D-SMS2-03)', () => {
  it('AC-SMS2-04 줄마다 표시', async () => {
    const cases: [number, string][] = [
      [400, '1초 안'],
      [0, '1초 안'],
      [-600, '1초 안'],
      [-1000, '1초 안'],
      [1000, '1초'],
      [2499, '2초'],
      [2500, '3초'],
      [-1001, '시계 차이'],
      [-1500, '시계 차이'],
    ]
    for (const [delay, label] of cases) {
      expect(delayLabel(delay)).toBe(label)
      const box = fixedBox()
      await send(box, { from: '010-1234-5678', body: '시험 1', device: 'iPhone', receivedAt: phoneMs(delay) })
      expect(visible(await view(box))).toContain(`늦은 정도 ${label}\n`)
    }
  })

  it('AC-SMS2-05 요약의 평균·가장 늦은 것·뺀 것·없이 온 것', async () => {
    const box = fixedBox()
    const delays = [3000, 400, 2500, -600, -1500]
    for (const [i, d] of delays.entries()) await send(box, { from: '010-1234-5678', body: `시험 ${String(i + 1)}`, device: 'iPhone', receivedAt: phoneMs(d) })
    await send(box, { from: '010-1234-5678', body: '시험 6', device: 'iPhone' })
    const text = visible(await view(box))
    expect(text).toContain('늦은 정도: 평균 1.5초 · 가장 늦은 것 3초 (4건으로 쟀어요)')
    expect(text).toContain('휴대폰 시계가 맞지 않아 뺀 것 1건')
    expect(text).toContain('휴대폰이 받은 시각 없이 온 것 1건')
  })

  it('AC-SMS2-05 잰 것이 없으면 잴 수 없다는 문장, 0건 문장은 숨김', async () => {
    const box = fixedBox()
    await send(box, { from: '010-1234-5678', body: '시험 1', device: 'iPhone' })
    const page = visible(await view(box))
    expect(page).toContain('늦은 정도: 휴대폰이 받은 시각이 오지 않아 잴 수 없어요.')
    expect(page).toContain('휴대폰이 받은 시각 없이 온 것 1건')
    expect(page).not.toContain('휴대폰 시계가 맞지 않아 뺀 것')
    const ok = fixedBox()
    await send(ok, { from: '010-1234-5678', body: '시험 1', device: 'iPhone', receivedAt: phoneMs(3000) })
    const okText = visible(await view(ok))
    expect(okText).not.toContain('휴대폰 시계가 맞지 않아 뺀 것')
    expect(okText).not.toContain('없이 온 것')
  })

  it('AC-SMS2-05 평균이 1초 미만이면 "1초 안", 반올림은 100ms 단위', async () => {
    const box = fixedBox()
    for (const [i, d] of [400, 999].entries()) await send(box, { from: '010-1234-5678', body: `시험 ${String(i + 1)}`, device: 'iPhone', receivedAt: phoneMs(d) })
    expect(visible(await view(box))).toContain('늦은 정도: 평균 1초 안 · 가장 늦은 것 1초 안 (2건으로 쟀어요)')
    const two = fixedBox()
    for (const [i, d] of [1000, 1100].entries()) await send(two, { from: '010-1234-5678', body: `시험 ${String(i + 1)}`, device: 'iPhone', receivedAt: phoneMs(d) })
    // 1050ms → 1.05 → 100ms 단위 반올림 1.1
    expect(visible(await view(two))).toContain('늦은 정도: 평균 1.1초 · 가장 늦은 것 1초 (2건으로 쟀어요)')
  })
})

describe('SMS2 일련번호 (D-SMS2-04)', () => {
  it('AC-SMS2-06 표', () => {
    const yes: [string, number][] = [
      ['시험 3', 3],
      ['시험3', 3],
      ['시험   12번', 12],
      ['시험 3 165번주세요', 3],
      ['165번 시험 4', 4],
      ['시험 999', 999],
      ['[Web발신] 시험 7', 7],
    ]
    for (const [body, n] of yes) expect(readSerial(body), body).toBe(n)
    for (const body of ['165번주세요', '시험', '시험 일', '시험 0', '시험 1000', '시험 12345', '시험 ３', '시험 해요 시험 5', '테스트 1']) expect(readSerial(body), body).toBeNull()
  })

  it('AC-SMS2-06 응답 serial과 카드 첫 줄, 200자 뒤는 읽지 않는다', async () => {
    const box = fixedBox()
    expect(await send(box, { from: '010-1234-5678', body: '시험 3', device: 'iPhone' })).toMatchObject({ serial: 3 })
    expect(await send(box, { from: '010-1234-5678', body: '165번주세요', device: 'iPhone' })).toMatchObject({ serial: null })
    expect(await send(box, { from: '010-1234-5678', body: `${'가'.repeat(200)}시험 1`, device: 'iPhone' })).toMatchObject({ serial: null })
    expect(await send(box, { from: '010-1234-5678', body: `${'가'.repeat(196)}시험 1`, device: 'iPhone' })).toMatchObject({ serial: 1 })
    const text = visible(await view(box))
    expect(text).toContain('1번째 · 시험 3')
    expect(text).toContain('2번째 · 번호 없음')
  })
})

describe('SMS2 겹쳐 온 문자 (D-SMS2-05)', () => {
  it('AC-SMS2-07 같은 문자는 한 줄, 처음 온 시각 그대로, 줄 번호를 올리지 않는다', async () => {
    let at = SERVER_AT
    const box = createSmsTestBox({ token: TOKEN, now: () => at })
    const first = await send(box, { from: '010-1234-5678', body: '시험 1', device: 'iPhone', receivedAt: phoneMs(3000) })
    expect(first).toEqual({ ok: true, seq: 1, last4: '5678', serial: 1, duplicate: false })
    at = new Date(SERVER_MS + 5 * 60 * 1000)
    const second = await send(box, { from: '+82 10-9999-5678', body: '시험 1', device: 'iPhone', receivedAt: SERVER_MS + 4 * 60 * 1000 })
    at = new Date(SERVER_MS + 9 * 60 * 1000)
    const third = await send(box, { from: '010-1234-5678', body: '시험 1', device: 'iPhone' })
    for (const answer of [second, third]) expect(answer).toEqual({ ok: true, seq: 1, last4: '5678', serial: 1, duplicate: true })
    expect(box.entries()).toHaveLength(1)
    expect(box.entries()[0]?.count).toBe(3)
    const text = visible(await view(box))
    expect(text).toContain('3번 왔어요 (한 번으로 셌어요)')
    expect(text).toContain('늦은 정도 3초')
    expect(text).toContain('서버가 받은 시각 10월 26일 14:03:08')
    expect(text).toContain('휴대폰이 받은 시각 10월 26일 14:03:05')
    expect(await send(box, { from: '010-1234-5678', body: '시험 2', device: 'iPhone' })).toMatchObject({ seq: 2, duplicate: false })
  })

  it('AC-SMS2-08 기기·끝 4자리·내용이 하나라도 다르면 새 줄, 같은 번호는 처음 온 줄만 센다', async () => {
    const box = fixedBox()
    await send(box, { from: '010-1234-5678', body: '시험 1', device: 'iPhone' })
    expect(await send(box, { from: '010-1234-5678', body: '시험 1', device: 'Galaxy' })).toMatchObject({ duplicate: false })
    expect(await send(box, { from: '010-1234-0000', body: '시험 1', device: 'iPhone' })).toMatchObject({ duplicate: false })
    expect(await send(box, { from: '010-1234-5678', body: '시험 1 ', device: 'iPhone' })).toMatchObject({ duplicate: false, serial: 1 })
    expect(box.entries()).toHaveLength(4)
    const text = visible(await view(box))
    expect(text).toContain('iPhone — 받은 문자 3건')
    expect(text).toContain('시험 1~1: 빠진 번호 없어요')
    expect(text).toContain('순서: 보낸 차례대로 왔어요')
  })

  it('AC-SMS2-08 연락처 이름 두 개는 겹친 것 (이름 원문은 비교에도 남지 않는다)', async () => {
    const box = fixedBox()
    await send(box, { from: '김다육', body: '시험 1', device: 'iPhone' })
    expect(await send(box, { from: '이선인', body: '시험 1', device: 'iPhone' })).toMatchObject({ duplicate: true, last4: null })
    const dump = JSON.stringify(box.entries()) + (await view(box))
    for (const name of ['김다육', '이선인']) expect(dump).not.toContain(name)
  })

  it('AC-SMS2-08 1000번 와도 한 줄, 50건이 밀린 뒤 같은 문자는 새 줄', async () => {
    const box = fixedBox()
    for (let i = 0; i < 1000; i++) await send(box, { from: '010-1234-5678', body: '시험 1', device: 'iPhone' })
    expect(box.entries()).toHaveLength(1)
    expect(visible(await view(box))).toContain('1000번 왔어요 (한 번으로 셌어요)')
    for (let i = 2; i <= SMS_TEST_LIMIT + 1; i++) await send(box, { from: '010-1234-5678', body: `시험 ${String(i)}`, device: 'iPhone' })
    expect(box.entries()).toHaveLength(SMS_TEST_LIMIT)
    expect(box.entries().some((entry) => entry.body === '시험 1')).toBe(false)
    expect(await send(box, { from: '010-1234-5678', body: '시험 1', device: 'iPhone' })).toMatchObject({ duplicate: false, seq: SMS_TEST_LIMIT + 2 })
  })
})

describe('SMS2 요약 (D-SMS2-06)', () => {
  it('AC-SMS2-09 기기마다 한 덩어리, 처음 받은 기기부터, 이름은 글자 그대로', async () => {
    const box = fixedBox()
    await send(box, { from: '010-1234-5678', body: '시험 1', device: 'Galaxy' })
    await send(box, { from: '010-1234-5678', body: '시험 1', device: '<b>x</b>' })
    await send(box, { from: '010-1234-5678', body: '시험 2', device: 'Galaxy' })
    await send(box, { from: '010-1234-5678', body: '시험 2', device: 'Galaxy' })
    const page = await view(box)
    expect(page).toContain('<h3>&lt;b&gt;x&lt;/b&gt; — 받은 문자 1건</h3>')
    expect(page).not.toContain('<b>x</b>')
    const text = visible(page)
    expect(text.indexOf('Galaxy — 받은 문자 2건')).toBeGreaterThan(text.indexOf('요약'))
    expect(text.indexOf('Galaxy — 받은 문자 2건')).toBeLessThan(text.indexOf('<b>x</b> — 받은 문자 1건'))
    expect(text).toContain('겹쳐 온 것: 1번 (한 번으로 셌어요)')
    expect(text).toContain('겹쳐 온 것: 없음')
  })

  it('AC-SMS2-10 빠진 번호', async () => {
    const run = async (bodies: string[]) => {
      const box = fixedBox()
      for (const body of bodies) await send(box, { from: '010-1234-5678', body, device: 'iPhone' })
      return visible(await view(box))
    }
    expect(await run(['시험 1', '시험 2', '시험 4', '시험 6'])).toContain('시험 1~6: 빠진 번호 3, 5\n')
    const all = await run(['시험 1', '시험 2', '시험 3', '시험 4', '시험 5'])
    expect(all).toContain('시험 1~5: 빠진 번호 없어요')
    expect(all).toContain("'시험 5' 뒤에 보낸 문자가 안 왔는지는 이 화면이 알 수 없어요. 마지막으로 보낸 번호와 비교해 보세요.")
    expect(all).not.toContain('번호 없는 문자')
    const big = Array.from({ length: 20 }, (_, i) => String(i + 1)).join(', ')
    expect(await run(['시험 30'])).toContain(`시험 1~30: 빠진 번호 ${big} 외 9개\n`)
    const none = await run(['165번주세요', '안녕'])
    expect(none).toContain("'시험 1'처럼 번호를 붙여 보내면 빠진 문자와 순서도 볼 수 있어요.")
    expect(none).not.toContain('빠진 번호')
    expect(none).not.toContain('뒤에 보낸 문자가 안 왔는지는')
    expect(await run(['시험 1', '165번주세요', '안녕'])).toContain('번호 없는 문자 2건')
  })

  it('AC-SMS2-11 순서가 바뀐 번호', async () => {
    const run = async (bodies: string[]) => {
      const box = fixedBox()
      for (const body of bodies) await send(box, { from: '010-1234-5678', body, device: 'iPhone' })
      return visible(await view(box))
    }
    expect(await run(['시험 1', '시험 2', '시험 4', '시험 3', '시험 6', '시험 5'])).toContain('순서: 늦게 온 번호 3, 5\n')
    expect(await run(['시험 1', '시험 2', '시험 3'])).toContain('순서: 보낸 차례대로 왔어요')
    expect(await run(['시험 2', '시험 1', '시험 2'])).toContain('순서: 늦게 온 번호 1\n')
    // 같은 번호·다른 내용은 처음 온 줄만 차례 계산에 쓴다
    expect(await run(['시험 2', '시험 3', '시험 2 다시'])).toContain('순서: 보낸 차례대로 왔어요')
    const late = Array.from({ length: 25 }, (_, i) => `시험 ${String(i + 1)}`)
    const text = await run(['시험 30', ...late])
    expect(text).toContain(`순서: 늦게 온 번호 ${Array.from({ length: 20 }, (_, i) => String(i + 1)).join(', ')} 외 5개`)
  })

  it('AC-SMS2-12 다음에 보낼 글', async () => {
    const box = fixedBox()
    expect(visible(await view(box))).toContain('다음에 보낼 글: 시험 1')
    await send(box, { from: '010-1234-5678', body: '안녕', device: 'Galaxy' })
    for (const body of ['시험 1', '시험 6', '시험 2']) await send(box, { from: '010-1234-5678', body, device: 'iPhone' })
    const text = visible(await view(box))
    expect(text).toContain('다음에 보낼 글: 시험 7')
    expect(text).toContain('다음에 보낼 글: 시험 1')
    const end = fixedBox()
    await send(end, { from: '010-1234-5678', body: '시험 999', device: 'iPhone' })
    const endText = visible(await view(end))
    expect(endText).toContain("번호를 999까지 다 썼어요. '처음부터 다시 세기'를 누르세요.")
    expect(endText).not.toContain('다음에 보낼 글: 시험 1000')
  })

  it('AC-SMS2-13 빈 화면·50건 문장', async () => {
    const box = fixedBox()
    const empty = visible(await view(box))
    expect(empty).toContain("아직 받은 문자가 없어요. 다른 휴대폰에서 사장님 번호로 '시험 1'을 보내 보세요.")
    expect(empty).toContain('최근 50건 안에서만 세요. 연습 모드를 끄면 모두 사라져요.')
    expect(empty).not.toContain('50건이 넘어')
    for (let i = 1; i <= SMS_TEST_LIMIT; i++) await send(box, { from: '010-1234-5678', body: `시험 ${String(i)}`, device: 'iPhone' })
    expect(visible(await view(box))).not.toContain('50건이 넘어')
    await send(box, { from: '010-1234-5678', body: '시험 51', device: 'iPhone' })
    const over = visible(await view(box))
    expect(over).toContain("50건이 넘어 오래된 문자는 지워졌어요. 빠진 번호가 틀릴 수 있으니 '처음부터 다시 세기'를 누르고 다시 시험하세요.")
    expect(over).toContain('최근 50건 안에서만 세요.')
  })
})

describe('SMS2 처음부터 다시 세기 (D-SMS2-07)', () => {
  async function three(): Promise<Box> {
    const box = fixedBox()
    for (const body of ['시험 1', '시험 2', '시험 3']) await send(box, { from: '010-1234-5678', body, device: 'iPhone' })
    return box
  }

  it('AC-SMS2-14 확인 화면 → POST로만 지우고, 토큰 그대로', async () => {
    const box = await three()
    const viewPage = await view(box)
    expect(viewPage).toContain(`href="${SMS_TEST_PATH}?t=${TOKEN}&amp;do=reset-ask"`)
    const ask = await view(box, '&do=reset-ask')
    expect(ask).not.toContain('http-equiv="refresh"')
    const askText = visible(ask)
    expect(askText).toContain('받은 시험 문자 3건을 지우고 처음부터 셀까요? 지우면 되돌릴 수 없어요. 결과 사진을 먼저 찍어 두세요.')
    expect(askText).toContain('네, 지우고 처음부터 셀게요')
    expect(askText).toContain('아니요, 돌아갈게요')
    expect(ask).toContain(`<form method="post" action="${SMS_TEST_PATH}?t=${TOKEN}&amp;do=reset">`)
    expect(ask).toContain(`href="${SMS_TEST_PATH}?t=${TOKEN}"`)
    expect(box.entries()).toHaveLength(3)

    const reset = await must(box, new Request(`${BASE}?t=${TOKEN}&do=reset`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: '' }))
    expect(reset.status).toBe(303)
    expect(new URL(reset.headers.get('location') ?? '', BASE).href).toBe(`${BASE}?t=${TOKEN}`)
    expect(box.entries()).toHaveLength(0)
    const after = visible(await view(box))
    expect(after).toContain('아직 받은 문자가 없어요.')
    expect(await send(box, { from: '010-1234-5678', body: '시험 1', device: 'iPhone' })).toEqual({ ok: true, seq: 1, last4: '5678', serial: 1, duplicate: false })
  })

  it('AC-SMS2-15 지우기 보호', async () => {
    const box = await three()
    const tries: [Request, number[]][] = [
      [new Request(`${BASE}?do=reset`, { method: 'POST' }), [401]],
      [new Request(`${BASE}?t=wrong&do=reset`, { method: 'POST' }), [401]],
      [post({ from: '010-1234-5678', body: '시험 9', device: 'iPhone' }, TOKEN, '?do=reset'), [400, 401]],
      [new Request(`${BASE}?t=${TOKEN}&do=xyz`, { method: 'POST' }), [400]],
      [post({ from: '010-1234-5678', body: '시험 9', device: 'iPhone' }, TOKEN, `?t=${TOKEN}&do=xyz`), [400]],
    ]
    for (const [request, statuses] of tries) {
      const response = await must(box, request)
      expect(statuses, request.url).toContain(response.status)
      expect(box.entries()).toHaveLength(3)
    }
    const getReset = await must(box, new Request(`${BASE}?t=${TOKEN}&do=reset`))
    expect([200, 405]).toContain(getReset.status)
    expect(box.entries()).toHaveLength(3)
  })

  it('AC-SMS2-13·14 다시 세기는 50건 넘침 표시도 지운다', async () => {
    const box = fixedBox()
    for (let i = 1; i <= SMS_TEST_LIMIT + 1; i++) await send(box, { from: '010-1234-5678', body: `시험 ${String(i)}`, device: 'iPhone' })
    await must(box, new Request(`${BASE}?t=${TOKEN}&do=reset`, { method: 'POST' }))
    expect(visible(await view(box))).not.toContain('50건이 넘어')
  })
})

describe('SMS2 화면 (D-SMS2-08)', () => {
  it('AC-SMS2-16 카드 모양과 순서, CSP·새로고침', async () => {
    const box = fixedBox()
    await send(box, { from: '010-1234-5678', body: '시험 1\n둘째 줄', device: 'iPhone', receivedAt: phoneMs(3000) })
    await send(box, { from: '김다육', body: '시험 2', device: 'iPhone' })
    await send(box, { body: '안녕', device: 'iPhone' })
    const response = await must(box, new Request(`${BASE}?t=${TOKEN}`))
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; form-action 'self'")
    const page = await response.text()
    expect(page).not.toContain('<table')
    expect(page).toContain('<meta http-equiv="refresh" content="5">')
    expect(page).toContain('시험 1\n둘째 줄')
    expect(page).toMatch(/white-space:pre-wrap/)
    const text = visible(page)
    const order = ['문자 자동 수신 시험', '요약', '1. ', '처음부터 다시 세기', '3번째 · 번호 없음', '2번째 · 시험 2', '1번째 · 시험 1']
    const at = order.map((word) => (word === '1. ' ? text.indexOf("다른 휴대폰에서 사장님 번호로 '시험 1', '시험 2'") : text.indexOf(word)))
    for (const [i, position] of at.entries()) expect(position, order[i]).toBeGreaterThanOrEqual(0)
    for (let i = 1; i < at.length; i++) expect(at[i] ?? 0, order[i]).toBeGreaterThan(at[i - 1] ?? 0)
    expect(text).toContain('보낸 사람 끝 5678')
    expect(text).toContain('\n번호 대신 이름이 왔어요\n')
    expect(text).toContain('\n보낸 사람 없음\n')
    expect(text).toContain('기기 iPhone')
    const card = text.slice(text.indexOf('1번째 · 시험 1'))
    const lines = ['늦은 정도 3초', '휴대폰이 받은 시각', '서버가 받은 시각', '보낸 사람 끝 5678', '기기 iPhone', '시험 1\n둘째 줄']
    let last = -1
    for (const line of lines) {
      const position = card.indexOf(line)
      expect(position, line).toBeGreaterThan(last)
      last = position
    }
  })

  it('AC-SMS2-18 시험 안내 세 줄, 개발 용어 없음', async () => {
    const box = fixedBox()
    await send(box, { from: '010-1234-5678', body: '시험 1', device: 'iPhone', receivedAt: phoneMs(3000) })
    await send(box, { from: '010-1234-5678', body: '시험 1', device: 'iPhone' })
    await send(box, { body: '안녕', device: 'Galaxy' })
    const pages = [await view(box), await view(box, '&do=reset-ask'), await view(fixedBox())]
    const text = visible(pages[0] ?? '')
    expect(text).toContain("다른 휴대폰에서 사장님 번호로 '시험 1', '시험 2', '시험 3'… 차례로 보내세요.")
    expect(text).toContain("기기마다 '다음에 보낼 글'을 보고 보내면 돼요.")
    expect(text).toContain('다 보냈으면 이 화면을 사진으로 찍어 두세요.')
    expect(pages[0]).toMatch(/<ol>[\s\S]*<li>다른 휴대폰에서[\s\S]*<li>기기마다[\s\S]*<li>다 보냈으면[\s\S]*<\/ol>/)
    for (const page of pages) {
      const shown = visible(page)
      for (const word of ['receivedAt', 'serial', 'duplicate', 'seq', 'null', 'JSON', 'undefined', 'NaN']) expect(shown, word).not.toContain(word)
    }
  })

  it('AC-SMS2-17 같은 와이파이 http에서도 확인 화면·지우기, 303은 같은 http 보기 화면', async () => {
    const box = createSmsTestBox({ token: TOKEN, now: () => SERVER_AT })
    const server = createSmsTestHttpServer(box)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
    try {
      const posted = await fetch(`${base}${SMS_TEST_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-try-token': TOKEN }, body: JSON.stringify({ from: '010-1234-5678', body: '시험 1', device: 'iPhone' }) })
      expect(posted.status).toBe(200)
      const ask = await fetch(`${base}${SMS_TEST_PATH}?t=${TOKEN}&do=reset-ask`)
      expect(ask.status).toBe(200)
      expect(visible(await ask.text())).toContain('받은 시험 문자 1건을 지우고 처음부터 셀까요?')
      const bad = await fetch(`${base}${SMS_TEST_PATH}?t=wrong&do=reset`, { method: 'POST', redirect: 'manual' })
      expect(bad.status).toBe(401)
      expect(box.entries()).toHaveLength(1)
      const reset = await fetch(`${base}${SMS_TEST_PATH}?t=${TOKEN}&do=reset`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: '', redirect: 'manual' })
      expect(reset.status).toBe(303)
      expect(new URL(reset.headers.get('location') ?? '', `${base}${SMS_TEST_PATH}`).href).toBe(`${base}${SMS_TEST_PATH}?t=${TOKEN}`)
      expect(box.entries()).toHaveLength(0)
      for (const path of ['/', '/_try/sms-test/x', '/api/auth/login?do=reset']) expect((await fetch(`${base}${path}`, { method: 'POST', body: '' })).status).toBe(404)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

describe('SMS2 개인정보·안전 (회귀)', () => {
  it('AC-SMS2-40 겹침·요약·지우기를 거쳐도 원문 번호·이름이 어디에도 없다, 로그 없음', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => undefined))
    const box = fixedBox()
    const raws = ['010-9876-5432', '+82 10-1111-5432', '김다육']
    const answers: string[] = []
    for (const from of raws) {
      for (let i = 0; i < 2; i++) answers.push(await (await must(box, post({ from, body: '시험 1', device: 'iPhone' }))).text())
    }
    const pages = [await view(box), await view(box, '&do=reset-ask')]
    const dump = [...answers, ...pages, JSON.stringify(box.entries())].join('\n')
    for (const raw of [...raws, '01098765432', '9876', '1111', '821011115432']) expect(dump).not.toContain(raw)
    await must(box, new Request(`${BASE}?t=${TOKEN}&do=reset`, { method: 'POST' }))
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    const source = readFileSync(new URL('../src/try/sms-test.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/console\.|writeFile|appendFile|createWriteStream|logger/)
  })

  it('AC-SMS2-41 기기 이름 50가지에도 덩어리는 50개 이하, 이스케이프', async () => {
    const box = fixedBox()
    for (let i = 0; i < 60; i++) await send(box, { from: '010-1234-5678', body: `시험 ${String(i + 1)} <script>"'&`, device: `기기${String(i)}<script>` })
    const page = await view(box)
    expect(page.match(/<div class="group">/g)?.length ?? 0).toBeLessThanOrEqual(SMS_TEST_LIMIT)
    expect(page).not.toContain('<script>')
  })
})

describe('SMS2 TRY-IT 안내 (D-SMS2-09)', () => {
  it('AC-SMS2-50 절 소제목 차례와 첫머리 문장', () => {
    const doc = readFileSync(new URL('../../../docs/TRY-IT.md', import.meta.url), 'utf8')
    const start = doc.indexOf('## 문자 자동 수신 시험하기')
    expect(start).toBeGreaterThanOrEqual(0)
    const rest = doc.slice(start + 3)
    const next = rest.search(/\n## /)
    const section = next < 0 ? rest : rest.slice(0, next)
    const heads = [...section.matchAll(/^### (.+)$/gm)].map((m) => m[1]?.trim())
    expect(heads).toEqual(['준비', '(가) 아이폰: 단축어 자동화', '(나) 갤럭시: MacroDroid', '(다) 시험 순서', '(라) 결과 읽기', '시험이 끝나면 꼭 끄기'])
    const intro = section.slice(0, section.indexOf('### 준비'))
    expect(intro).toMatch(/실제 문자찜을 어떻게 자동으로 받을지는 아직 정하지 않았/)
    expect(section).toContain('"receivedAt":"[시스템 시간]"')
    expect(section).toContain('날짜 및 시간 자동 설정')
  })

  // RA-SMS2-01: 시험 문자가 아닌 판매자 휴대폰의 모든 문자(인증번호·은행 알림)가 연습 서버로 넘어가지 않게 안내한다
  it('RA-SMS2-01 갤럭시 글자 조건은 시험 포함, 숫자 자동화는 경고, 사진은 요약만', () => {
    const doc = readFileSync(new URL('../../../docs/TRY-IT.md', import.meta.url), 'utf8')
    const start = doc.indexOf('## 문자 자동 수신 시험하기')
    const rest = doc.slice(start + 3)
    const next = rest.search(/\n## /)
    const section = next < 0 ? rest : rest.slice(0, next)
    const part = (from: string, to: string): string => section.slice(section.indexOf(from), section.indexOf(to))
    const galaxy = part('### (나) 갤럭시: MacroDroid', '### (다) 시험 순서')
    expect(galaxy).toContain('글자 조건은 **글자 포함** → `시험`')
    expect(galaxy).not.toMatch(/글자 조건은 \*\*모든 알림\*\*/)
    expect(galaxy).not.toContain('아무 글자')
    const iphone = part('### (가) 아이폰: 단축어 자동화', '### (나) 갤럭시: MacroDroid')
    const digits = iphone.slice(iphone.indexOf('숫자 `0`부터 `9`까지'))
    expect(digits).toMatch(/인증번호/)
    expect(digits).toMatch(/\*\*시험하는 동안만\*\* 켜고 끝나면 바로 지우세요/)
    const order = part('### (다) 시험 순서', '### (라) 결과 읽기')
    expect(order).toContain('**요약 부분만** 사진으로')
    expect(order).toMatch(/카드에는 문자 내용이 나오니 사진에 넣지 마세요/)
  })
})
