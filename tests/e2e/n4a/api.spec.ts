// AC-N4a-02·41·01 (실제 E2E 서버로 본문 검사·Origin·판매 규칙 설정과 분리), AC-N4a-05 (꺼져 있을 때 거절·받는 요청의 응답 모양)
import { expect, test } from '@playwright/test'
import { cleanupN4a, labelSettings, login, OFF_REFUSAL, postJson, setLabels } from './support.ts'

test.afterEach(async ({ page }) => {
  await cleanupN4a(page)
})

test('AC-N4a-02·41: 켬/끔 바꾸기의 본문 검사·Origin — 불리언 아님 INVALID_INPUT, 다른 칸 UNKNOWN_FIELD, Origin 없으면 거절, 바뀌지 않음', async ({ page }) => {
  await login(page)
  const origin = new URL(page.url()).origin
  const before = await labelSettings(page)
  const put = async (data: unknown, headers: Record<string, string> = { Origin: origin }) => {
    const res = await page.request.put('/api/settings/labels', { data, headers })
    return { status: res.status(), body: await res.json().catch(() => null) as { error?: { code: string; message: string } } | null }
  }
  for (const data of [{ enabled: 'false' }, { enabled: 0 }, { enabled: null }, {}]) {
    const r = await put(data)
    expect(r.status, JSON.stringify(data)).toBe(400)
    expect(r.body?.error?.code).toBe('INVALID_INPUT')
  }
  for (const data of [{ enabled: false, seller: 'other' }, { enabled: false, sellerId: 's2' }]) {
    const r = await put(data)
    expect(r.status).toBe(400)
    expect(r.body?.error?.code).toBe('UNKNOWN_FIELD')
  }
  const noOrigin = await page.request.put('/api/settings/labels', { data: { enabled: false } })
  expect(noOrigin.status()).toBeGreaterThanOrEqual(400)
  const evil = await put({ enabled: false }, { Origin: 'http://evil.example' })
  expect(evil.status).toBeGreaterThanOrEqual(400)
  const after = await labelSettings(page)
  expect(after.enabled).toBe(before.enabled)
  expect(after.history).toEqual(before.history)
})

test('AC-N4a-01: 판매 규칙 설정(/api/settings)에는 켬/끔 키가 없고 그 키로 보내면 거절된다', async ({ page }) => {
  await login(page)
  const s = await (await page.request.get('/api/settings')).text()
  expect(s).not.toMatch(/label(s)?\.?enabled|labelsEnabled|"labels"/i)
  for (const key of ['labels.enabled', 'labelsEnabled', 'print.labels']) {
    const res = await page.request.patch('/api/settings', { data: { settings: { [key]: false } }, headers: { Origin: new URL(page.url()).origin } })
    expect(res.status(), key).toBe(400)
  }
  expect((await labelSettings(page)).enabled).toBe(true)
})

test('AC-N4a-05: 꺼져 있으면 출력 기기 정하기·받기·다시 시작은 409 LABELS_OFF 문장, 멈추기·모두 빼기·출력 그만하기는 받는다', async ({ page }) => {
  await login(page)
  await setLabels(page, false)
  for (const [path, body] of [
    ['/api/print/device', { deviceId: 'e2e-n4a-dev', name: '시험' }],
    ['/api/print/claim', { deviceId: 'e2e-n4a-dev' }],
    ['/api/print/restart', {}],
  ] as const) {
    const r = await postJson(page, path, body)
    expect(r.status, path).toBe(409)
    expect(r.body['error'], path).toEqual({ code: 'LABELS_OFF', message: OFF_REFUSAL })
  }
  expect((await postJson(page, '/api/print/pause', {})).status).toBeLessThan(300)
  expect((await postJson(page, '/api/print/jobs/cancel-all', { confirm: true })).status).toBeLessThan(300)
  expect((await postJson(page, '/api/print/device/release', {})).status).toBeLessThan(300)
})
