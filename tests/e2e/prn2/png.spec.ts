// AC-PRN2-09 (서버 PNG 입구) — GET /api/print/jobs/:id/png·/api/print/test-png. 근거: L-6(203dpi 1비트, pHYs 7992점/m)·L-11 17.
import { expect, test, type Page } from '@playwright/test'
import { loginNewSeller, openRealBroadcast, postJson, registerApi, smsApi } from './support.ts'

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

interface PngInfo { signatureOk: boolean; width: number; height: number; bitDepth: number; colorType: number; ppuX: number; ppuY: number; unit: number }
function readPng(bytes: Buffer): PngInfo {
  const chunks: Record<string, Buffer> = {}
  for (let at = 8; at + 8 <= bytes.length;) {
    const len = bytes.readUInt32BE(at)
    chunks[bytes.subarray(at + 4, at + 8).toString('latin1')] = bytes.subarray(at + 8, at + 8 + len)
    at += 12 + len
  }
  const ihdr = chunks['IHDR']!
  const phys = chunks['pHYs']
  return {
    signatureOk: SIGNATURE.every((v, i) => bytes[i] === v),
    width: ihdr.readUInt32BE(0), height: ihdr.readUInt32BE(4), bitDepth: ihdr[8]!, colorType: ihdr[9]!,
    ppuX: phys?.readUInt32BE(0) ?? -1, ppuY: phys?.readUInt32BE(4) ?? -1, unit: phys?.[8] ?? -1,
  }
}

async function claimOne(page: Page, deviceId: string): Promise<{ id: string; attempt: string }> {
  const { b } = await openRealBroadcast(page)
  expect((await postJson(page, '/api/print/device', { deviceId, name: 'PNG기기', profileId: 'NIIMBOT_B1' })).status).toBe(200)
  // 새로 정한 출력 기기는 멈춤으로 시작할 수 있다 — 다시 시작 후 받는다
  await postJson(page, '/api/print/restart', {})
  await registerApi(page, b, 1, '품종1', 1000)
  await smsApi(page, { b, no: 1 })
  let job: { id: string; attempt: string } | null = null
  await expect.poll(async () => {
    const res = await postJson(page, '/api/print/claim', { deviceId })
    job = (res.body['job'] as { id: string; attempt: string } | null) ?? null
    return job !== null
  }, { timeout: 15_000 }).toBe(true)
  return job!
}

test('AC-PRN2-09: 작업 PNG — PNG 서명·203dpi pHYs·1비트·흑백, 크기는 비트맵과 같다', async ({ page }) => {
  await loginNewSeller(page)
  const deviceId = 'prn2-png-dev-01'
  const job = await claimOne(page, deviceId)
  const q = `device=${deviceId}&attempt=${job.attempt}`
  const bitmap = await (await page.request.get(`/api/print/jobs/${job.id}/bitmap?${q}`)).json() as { width: number; height: number }
  const res = await page.request.get(`/api/print/jobs/${job.id}/png?${q}`)
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toContain('image/png')
  const png = readPng(await res.body())
  expect(png).toMatchObject({ signatureOk: true, bitDepth: 1, colorType: 0, ppuX: 7992, ppuY: 7992, unit: 1 })
  expect({ w: png.width, h: png.height }).toEqual({ w: bitmap.width, h: bitmap.height })
})

test('AC-PRN2-09: 테스트 PNG — 같은 규격, 테스트 비트맵과 같은 크기', async ({ page }) => {
  await loginNewSeller(page)
  const bitmap = await (await page.request.get('/api/print/test-bitmap')).json() as { width: number; height: number }
  const res = await page.request.get('/api/print/test-png')
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toContain('image/png')
  const png = readPng(await res.body())
  expect(png).toMatchObject({ signatureOk: true, bitDepth: 1, colorType: 0, ppuX: 7992, ppuY: 7992, unit: 1 })
  expect({ w: png.width, h: png.height }).toEqual({ w: bitmap.width, h: bitmap.height })
})

test('AC-PRN2-09: 검사는 비트맵 입구와 같다 — 로그인 없음 401, 남의 판매자·틀린 시도·틀린 기기 404, 모양이 틀리면 400', async ({ page, browser }) => {
  await loginNewSeller(page)
  const deviceId = 'prn2-png-dev-02'
  const job = await claimOne(page, deviceId)
  const good = `device=${deviceId}&attempt=${job.attempt}`
  const same = async (path: (kind: string) => string): Promise<void> => {
    const a = await page.request.get(path('bitmap'))
    const b = await page.request.get(path('png'))
    expect(b.status(), path('png')).toBe(a.status())
    if (b.status() !== 200) expect(await b.json()).toEqual(await a.json())
  }
  await same((k) => `/api/print/jobs/${job.id}/${k}?device=${deviceId}&attempt=AAAAAAAAAAAA`) // 남의/틀린 시도
  await same((k) => `/api/print/jobs/${job.id}/${k}?device=other-device-01&attempt=${job.attempt}`) // 다른 기기
  await same((k) => `/api/print/jobs/${job.id}/${k}?device=${deviceId}`) // 시도 빠짐
  await same((k) => `/api/print/jobs/${job.id}/${k}?attempt=${job.attempt}`) // 기기 빠짐
  await same((k) => `/api/print/jobs/no-such-job/${k}?${good}`) // 없는 작업
  expect((await page.request.get(`/api/print/jobs/${job.id}/png?device=other-device-01&attempt=${job.attempt}`)).status()).toBe(404)
  expect((await page.request.get(`/api/print/jobs/${job.id}/png?attempt=${job.attempt}`)).status()).toBe(400)

  // 남의 판매자는 404
  const ctx = await browser.newContext({ baseURL: new URL(page.url()).origin })
  try {
    const other = await ctx.newPage()
    await loginNewSeller(other)
    expect((await other.request.get(`/api/print/jobs/${job.id}/png?${good}`)).status()).toBe(404)
  } finally {
    await ctx.close()
  }
  // 로그인 없음 401
  const anon = await browser.newContext({ baseURL: new URL(page.url()).origin })
  try {
    expect((await anon.request.get(`/api/print/jobs/${job.id}/png?${good}`)).status()).toBe(401)
    expect((await anon.request.get('/api/print/test-png')).status()).toBe(401)
  } finally {
    await anon.close()
  }
})

test('AC-PRN2-09 (D-PRN2-11): 테스트 그림은 ?size=를 받는다 — 없으면 50×30, 테이프도 되고, 목록 밖이면 422 INVALID_TEMPLATE, PNG와 비트맵이 같은 크기', async ({ page }) => {
  await loginNewSeller(page)
  const dims = async (kind: 'bitmap' | 'png', size?: string) => {
    const res = await page.request.get(`/api/print/test-${kind}${size === undefined ? '' : `?size=${size}`}`)
    expect(res.status(), `${kind} ${String(size)}`).toBe(200)
    if (kind === 'bitmap') { const j = await res.json() as { width: number; height: number }; return { w: j.width, h: j.height } }
    const p = readPng(await res.body())
    return { w: p.width, h: p.height }
  }
  expect(await dims('bitmap')).toEqual({ w: 384, h: 240 })
  expect(await dims('bitmap', '50x40')).toEqual({ w: 384, h: 320 })
  for (const size of ['50x40', 'tape12x40', 'tape15x50', '50x15']) expect(await dims('png', size), size).toEqual(await dims('bitmap', size))
  for (const kind of ['bitmap', 'png']) {
    const bad = await page.request.get(`/api/print/test-${kind}?size=99x99`)
    expect(bad.status(), kind).toBe(422)
    expect(JSON.stringify(await bad.json())).toContain('INVALID_TEMPLATE')
  }
})
