// S04 적대 테스트 (test-domain): 로그인 잠금 (AC-S04-40, SYS-01, D-074).
// - 같은 아이디로 연속 10번 틀리면 15분 동안 그 아이디의 로그인을 받지 않는다(맞는 비밀번호도 429).
// - 아이디 없음과 비밀번호 틀림은 같은 상태 코드·같은 본문이다 — 잠금 응답으로도 아이디가 있는지 알 수 없어야 한다(dev-notes "없는 아이디도 잠근다").
import { afterEach, describe, expect, it } from 'vitest'
import { call, harness, PASSWORD, type Harness } from './helpers.ts'

let h: Harness | null = null
afterEach(async () => {
  await h?.close()
  h = null
})

const login = (hh: Harness, loginId: string, password: string) => call(hh.server, null, 'POST', '/api/login', { loginId, password })

describe('TD-S04-001: 동시에 보낸 틀린 비밀번호가 잠금 한도(10번)를 넘어 모두 확인된다', () => {
  it('틀린 비밀번호 30개를 한꺼번에 보내면 10개까지만 확인되고 나머지는 429다', async () => {
    h = await harness()
    await h.account('shopc')
    const hh = h
    // 공격자는 요청을 한꺼번에 보낸다(브라우저·스크립트 모두 쉽다). 잠금 확인(읽기)과 실패 수 올리기(쓰기) 사이가 비어 있으면 한도를 넘는다
    const wrong = Array.from({ length: 30 }, (_, i) => login(hh, 'shopc', `guess-${String(i)}-pw`))
    const results = await Promise.all(wrong)
    const checked = results.filter((r) => r.status === 401).length
    expect(checked, `틀린 비밀번호 ${String(checked)}개가 확인됐다 (잠금 한도 10)`).toBeLessThanOrEqual(10)
    expect(results.filter((r) => r.status === 429).length).toBeGreaterThanOrEqual(20)
  }, 60_000)

  it('한꺼번에 보낸 틀린 15개 사이의 맞는 비밀번호는 429다 (먼저 도착한 10번 실패로 잠긴다)', async () => {
    h = await harness()
    await h.account('shopd')
    const hh = h
    const batch = [...Array.from({ length: 15 }, (_, i) => login(hh, 'shopd', `guess-${String(i)}-pw`))]
    // 맞는 비밀번호는 틀린 15개가 모두 출발한 뒤 보낸다
    const results = await Promise.all([...batch, login(hh, 'shopd', PASSWORD)])
    const last = results.at(-1)
    expect(last?.status, '틀린 비밀번호 15개 뒤의 맞는 비밀번호가 받아졌다').toBe(429)
  }, 60_000)
})

describe('TD-S04-002: 200자를 넘는 비밀번호로 잠금 응답이 달라져 아이디가 있는지 알 수 있다', () => {
  it('있는 아이디와 없는 아이디에 201자 비밀번호로 10번 틀린 뒤 11번째(짧은 비밀번호) 응답이 같다', async () => {
    h = await harness()
    await h.account('realshop')
    const statuses: Record<string, number> = {}
    for (const id of ['realshop', 'ghostshop']) {
      for (let i = 0; i < 10; i++) expect((await login(h, id, 'x'.repeat(201))).status).toBe(401)
      statuses[id] = (await login(h, id, 'wrong-password')).status
    }
    // 지금: 있는 아이디는 401(긴 비밀번호 실패가 DB 잠금에 세어지지 않음), 없는 아이디는 429(메모리 잠금) → 아이디가 있는지 드러난다
    expect(statuses.realshop, `있는 아이디 ${String(statuses.realshop)} / 없는 아이디 ${String(statuses.ghostshop)}`).toBe(statuses.ghostshop)
  }, 60_000)
})
