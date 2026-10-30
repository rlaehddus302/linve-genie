// PRN2 서버 몫 (AC-PRN2-08·09, L-11 10·13·16·17, D-PRN2-06·07)
// - 출력 기기가 알린 프린터 프로필 ID만 기록하고 라벨 설정 크기 목록을 그 프로필로 낸다(모르면 B1 목록).
// - 작업·시험 그림을 203dpi 1비트 PNG로 낸다 — 비트맵 입구와 같은 검사·같은 오류, 웹 LBL-07과 같은 인코더 바이트.
import { inflateSync } from 'node:zlib'
import { defaultTemplate, encodeLabelPng, renderTestLabel, type LabelBitmap } from '@livejjim/label'
import { createNodeRenderEnv } from '@livejjim/label/node'
import { describe, expect, it } from 'vitest'
import { DAY, DEVICE_A, DEVICE_B, chat, printApi, register } from './print-support.ts'
import { ORIGIN, addSeller, createBroadcast, expectOk, newWorld, type Seller, type TestServer } from './support.ts'

const B1_SIZES = ['50x30', '50x20', '50x40']

async function claimedLabel() {
  const world = await newWorld()
  const seller = await addSeller(world)
  const broadcast = await createBroadcast(world, seller, { date: DAY })
  await register(world, seller, broadcast.id, 15, '핑크프릴', 10000)
  await chat(world, seller, broadcast.id, 'UC_A', '홍길동', '15')
  const api = printApi(world, seller)
  await expectOk(api.register(DEVICE_A, '휴대폰'))
  await expectOk(api.restart())
  const { job } = await api.claim(DEVICE_A)
  if (job === null) throw new Error('출력할 라벨이 없다')
  const query = `?device=${DEVICE_A}&attempt=${job.attempt}`
  const base = `/api/print/jobs/${encodeURIComponent(job.id)}`
  return { world, seller, api, job, bitmapUrl: `${base}/bitmap${query}`, pngUrl: `${base}/png${query}` }
}

/** 쿠키를 붙여 그대로 받는다 (PNG는 JSON이 아니다) */
async function raw(world: TestServer, cookie: string | null, path: string) {
  const response = await world.server.app.request(path, { headers: cookie === null ? {} : { Cookie: cookie, Origin: ORIGIN } })
  return { status: response.status, headers: response.headers, bytes: new Uint8Array(await response.arrayBuffer()) }
}

/** 비트맵 입구의 JSON → 라벨 그림 */
function bitmapOf(body: Record<string, unknown>): LabelBitmap {
  return { width: body.width as number, height: body.height as number, data: new Uint8Array(Buffer.from(body.data as string, 'base64')) }
}

/** 시험용 PNG 풀기: 흑백 1비트·필터 0만 받는다. 라벨 형식(1 = 검정)으로 되돌린 점과 pHYs를 낸다 */
function decodePng(bytes: Uint8Array): { width: number; height: number; data: Uint8Array; dpm: [number, number, number] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  let offset = 8
  let width = 0
  let height = 0
  let dpm: [number, number, number] = [0, 0, 0]
  const idat: Uint8Array[] = []
  let ended = false
  while (offset < bytes.length) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    const body = bytes.subarray(offset + 8, offset + 8 + length)
    const bodyView = new DataView(body.buffer, body.byteOffset, body.byteLength)
    if (type === 'IHDR') {
      width = bodyView.getUint32(0)
      height = bodyView.getUint32(4)
      expect([...body.subarray(8)]).toEqual([1, 0, 0, 0, 0]) // 1비트, 흑백, 압축 0, 필터 0, 비월 없음
    } else if (type === 'pHYs') dpm = [bodyView.getUint32(0), bodyView.getUint32(4), body[8] ?? -1]
    else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') ended = true
    offset += 12 + length
  }
  expect(ended).toBe(true)
  const inflated = inflateSync(Buffer.concat(idat))
  const row = Math.ceil(width / 8)
  expect(inflated.length).toBe((row + 1) * height)
  const data = new Uint8Array(row * height)
  const padBits = row * 8 - width
  for (let y = 0; y < height; y++) {
    expect(inflated[y * (row + 1)]).toBe(0)
    for (let i = 0; i < row; i++) {
      let v = ~(inflated[y * (row + 1) + 1 + i] ?? 0) & 0xff
      if (i === row - 1 && padBits > 0) v &= (0xff << padBits) & 0xff // 줄 끝 남는 비트는 흰색(0)
      data[y * row + i] = v
    }
  }
  return { width, height, data, dpm }
}

describe('PRN2 라벨 그림 파일 받기 (AC-PRN2-09, L-11 17)', () => {
  it('받은 작업의 PNG는 비트맵 입구와 같은 점이고 웹 LBL-07 인코더와 같은 바이트다', async () => {
    const { world, seller, api, bitmapUrl, pngUrl } = await claimedLabel()
    const bitmap = bitmapOf((await expectOk(api.api.get(bitmapUrl))).body)
    const png = await raw(world, seller.cookie, pngUrl)
    expect(png.status).toBe(200)
    expect(png.headers.get('Content-Type')).toBe('image/png')
    expect(png.headers.get('Cache-Control')).toBe('no-store')
    const encoded = encodeLabelPng(bitmap)
    if (!encoded.ok) throw new Error('기준 PNG를 만들지 못했다')
    expect(Buffer.from(png.bytes).equals(Buffer.from(encoded.bytes))).toBe(true)
    const decoded = decodePng(png.bytes)
    expect(decoded.width).toBe(bitmap.width)
    expect(decoded.height).toBe(bitmap.height)
    expect(decoded.dpm).toEqual([7992, 7992, 1]) // 203dpi
    expect(Buffer.from(decoded.data).equals(Buffer.from(bitmap.data))).toBe(true)
    expect(bitmap.data.some((value) => value !== 0)).toBe(true)
    // 다시 받아도 같은 바이트, 받기는 시도를 끝내지 않는다
    expect(Buffer.from((await raw(world, seller.cookie, pngUrl)).bytes).equals(Buffer.from(png.bytes))).toBe(true)
    expect((await api.overview()).queue.printing).toBe(1)
  })

  it('시험 그림 PNG는 시험 비트맵과 같은 점이다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = printApi(world, seller)
    const bitmap = bitmapOf((await expectOk(api.api.get('/api/print/test-bitmap'))).body)
    const date = new Date(world.clock.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const expected = renderTestLabel(createNodeRenderEnv(), { shopName: `가게 ${seller.loginId}`, date, size: '50x30' })
    if (!expected.ok) throw new Error('기준 그림을 만들지 못했다')
    const png = await raw(world, seller.cookie, '/api/print/test-png')
    expect(png.status).toBe(200)
    expect(png.headers.get('Content-Type')).toBe('image/png')
    expect(png.headers.get('Cache-Control')).toBe('no-store')
    const encoded = encodeLabelPng(expected.image)
    if (!encoded.ok) throw new Error('기준 PNG를 만들지 못했다')
    expect(Buffer.from(png.bytes).equals(Buffer.from(encoded.bytes))).toBe(true)
    expect(Buffer.from(decodePng(png.bytes).data).equals(Buffer.from(bitmap.data))).toBe(true)
    expect((await raw(world, null, '/api/print/test-png')).status).toBe(401)
  })

  it('로그인 없음·다른 판매자·다른 기기·다른 작업·끝난 시도·바뀐 출력 기기는 비트맵 입구와 같은 오류다', async () => {
    const { world, seller, api, job, bitmapUrl, pngUrl } = await claimedLabel()
    const other = await addSeller(world)
    const same = async (cookie: string | null, change: (url: string) => string) => {
      const bits = await raw(world, cookie, change(bitmapUrl))
      const png = await raw(world, cookie, change(pngUrl))
      expect(png.status).toBe(bits.status)
      expect(Buffer.from(png.bytes).toString('utf8')).toBe(Buffer.from(bits.bytes).toString('utf8'))
      expect(png.headers.get('Content-Type')).not.toBe('image/png')
      return png.status
    }
    const keep = (url: string) => url
    expect(await same(null, keep)).toBe(401)
    expect(await same(other.cookie, keep)).toBe(404)
    expect(await same(seller.cookie, (url) => url.replace(DEVICE_A, DEVICE_B))).toBe(404)
    expect(await same(seller.cookie, (url) => url.replace(encodeURIComponent(job.id), 'unknown-job'))).toBe(404)
    expect(await same(seller.cookie, (url) => url.replace(job.attempt, 'zzzzzzzzzzzz'))).toBe(404)
    expect(await same(seller.cookie, (url) => url.replace(`attempt=${job.attempt}`, 'attempt=bad'))).toBe(400)
    expect(await same(seller.cookie, (url) => url.replace(`&attempt=${job.attempt}`, ''))).toBe(400)
    expect(await same(seller.cookie, (url) => url.replace(`device=${DEVICE_A}`, 'device=x'))).toBe(400)
    expect(await same(seller.cookie, (url) => url.replace(`device=${DEVICE_A}&`, ''))).toBe(400)
    expect(await api.done(DEVICE_A, job.attempt)).toBe(true)
    expect(await same(seller.cookie, keep)).toBe(404)
  })

  it('출력 기기가 바뀌면 옛 시도의 PNG도 받지 못한다', async () => {
    const { world, seller, api, pngUrl } = await claimedLabel()
    await expectOk(api.register(DEVICE_B, '다른 휴대폰', true))
    expect((await raw(world, seller.cookie, pngUrl)).status).toBe(404)
  })
})

describe('PRN2 출력 기기의 프린터 프로필 (AC-PRN2-08, L-11 10·13·16, D-PRN2-07)', () => {
  async function station() {
    const world = await newWorld()
    const seller = await addSeller(world)
    const api = printApi(world, seller)
    return { world, seller, api }
  }
  const storedProfile = async (world: TestServer, seller: Seller) =>
    (await world.database.pglite!.query<{ printer_profile_id: string | null }>('select printer_profile_id from print_queues where seller_id = $1', [seller.sellerId])).rows[0]
      ?.printer_profile_id

  it('출력 기기가 없으면 프로필 모름 → B1 크기 목록', async () => {
    const { api } = await station()
    const { queue } = await api.overview()
    expect(queue.device).toBeNull()
    expect((queue as unknown as { labelSizes: string[] }).labelSizes).toEqual(B1_SIZES)
  })

  it('출력 기기가 되며 알린 프로필 ID만 두고 크기 목록이 그 프로필의 크기다', async () => {
    const { world, seller, api } = await station()
    const registered = await expectOk(api.api.post('/api/print/device', { deviceId: DEVICE_A, name: '휴대폰', profileId: 'BAUATO_PPA2L' }))
    expect(registered.body).toMatchObject({ queue: { device: { id: DEVICE_A, profileId: 'BAUATO_PPA2L' }, labelSizes: ['50x30', '50x15', '50x50'] } })
    expect(await storedProfile(world, seller)).toBe('BAUATO_PPA2L')
    const { queue } = await api.overview()
    expect(queue.device).toMatchObject({ profileId: 'BAUATO_PPA2L' })
    expect((queue as unknown as { labelSizes: string[] }).labelSizes).toEqual(['50x30', '50x15', '50x50'])
    // 프로필 ID 말고 프린터 이름·기기 ID·주소를 둘 칸이 없다
    const columns = await world.database.pglite!.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'print_queues'`)
    expect(columns.rows.map((row) => row.column_name).filter((name) => name.startsWith('printer'))).toEqual(['printer_connected', 'printer_profile_id'])
  })

  it('프린터를 바꾸거나 끊으면 따라 바뀌고, 끊으면 모름(B1 목록)이다', async () => {
    const { world, seller, api } = await station()
    await expectOk(api.api.post('/api/print/device', { deviceId: DEVICE_A, name: '휴대폰', profileId: 'NIIMBOT_D110' }))
    const sizes = async () => (await api.overview()).queue as unknown as { device: { profileId: string | null } | null; labelSizes: string[] }
    expect((await sizes()).labelSizes).toEqual(['tape12x40', 'tape15x30', 'tape15x50'])
    await expectOk(api.api.post('/api/print/device/state', { deviceId: DEVICE_A, connected: false }))
    expect(await sizes()).toMatchObject({ device: { profileId: null, printerConnected: false }, labelSizes: B1_SIZES })
    await expectOk(api.api.post('/api/print/device/state', { deviceId: DEVICE_A, connected: true, profileId: 'MARKLIFE_P50' }))
    expect(await sizes()).toMatchObject({ device: { profileId: 'MARKLIFE_P50' }, labelSizes: ['50x30', '50x20', '50x40', '50x50'] })
    // 끊김 알림에 프로필을 붙여 와도 끊긴 동안은 모름
    await expectOk(api.api.post('/api/print/device/state', { deviceId: DEVICE_A, connected: false, profileId: 'MARKLIFE_P50' }))
    expect(await storedProfile(world, seller)).toBeNull()
    await expectOk(api.api.post('/api/print/device/state', { deviceId: DEVICE_A, connected: true, profileId: 'NIIMBOT_B1' }))
    expect(await storedProfile(world, seller)).toBe('NIIMBOT_B1')
    // 출력 그만하기 → 출력 기기 없음 → 모름
    await expectOk(api.release())
    expect(await storedProfile(world, seller)).toBeNull()
    expect((await sizes()).labelSizes).toEqual(B1_SIZES)
  })

  it('출력 기기를 바꾸면 새 기기가 알린 프로필로 바뀐다', async () => {
    const { api } = await station()
    await expectOk(api.api.post('/api/print/device', { deviceId: DEVICE_A, name: '휴대폰', profileId: 'NIIMBOT_D110' }))
    await expectOk(api.api.post('/api/print/device', { deviceId: DEVICE_B, name: 'PC', replace: true, profileId: 'MARKLIFE_S2' }))
    expect((await api.overview()).queue.device).toMatchObject({ id: DEVICE_B, profileId: 'MARKLIFE_S2' })
    await expectOk(api.api.post('/api/print/device', { deviceId: DEVICE_A, name: '휴대폰', replace: true }))
    expect((await api.overview()).queue.device).toMatchObject({ id: DEVICE_A, profileId: null })
  })

  it('이전 화면(칸 없음)은 그대로 동작하고 프로필은 모름이다', async () => {
    const { world, seller, api } = await station()
    await expectOk(api.register(DEVICE_A, '휴대폰'))
    expect(await storedProfile(world, seller)).toBeNull()
    await expectOk(api.state(DEVICE_A, false))
    await expectOk(api.state(DEVICE_A, true))
    const { queue } = await api.overview()
    expect(queue.device).toMatchObject({ printerConnected: true, profileId: null })
    expect((queue as unknown as { labelSizes: string[] }).labelSizes).toEqual(B1_SIZES)
  })

  it('표에 없는 값은 버리고 모름으로 두며, 글이 아닌 값은 받은 값을 되돌리지 않고 거절한다', async () => {
    const { world, seller, api } = await station()
    for (const value of ['NIIMBOT_B1_PRO', 'niimbot_b1', ' NIIMBOT_B1', 'B1-1234 홍길동네 프린터', 'x'.repeat(5000)]) {
      await expectOk(api.api.post('/api/print/device', { deviceId: DEVICE_A, name: '휴대폰', profileId: value }))
      expect(await storedProfile(world, seller)).toBeNull()
      await expectOk(api.api.post('/api/print/device/state', { deviceId: DEVICE_A, connected: true, profileId: value }))
      expect(await storedProfile(world, seller)).toBeNull()
    }
    await expectOk(api.api.post('/api/print/device/state', { deviceId: DEVICE_A, connected: true, profileId: null }))
    expect(await storedProfile(world, seller)).toBeNull()
    for (const value of [12, true, ['NIIMBOT_B1'], { id: 'NIIMBOT_B1' }]) {
      const state = await api.api.post('/api/print/device/state', { deviceId: DEVICE_A, connected: true, profileId: value })
      expect(state.status).toBe(400)
      expect(state.body).toMatchObject({ error: { code: 'INVALID_INPUT', problems: [{ field: 'profileId' }] } })
      expect(state.text).not.toContain('NIIMBOT_B1')
      const reg = await api.api.post('/api/print/device', { deviceId: DEVICE_A, name: '휴대폰', profileId: value })
      expect(reg.status).toBe(400)
    }
    // 프린터 이름 같은 다른 칸은 받지 않는다
    expect((await api.api.post('/api/print/device/state', { deviceId: DEVICE_A, connected: true, printerName: 'B1-1234' })).status).toBe(400)
  })

  it('프로필 ID·기기 이름을 로그에 남기지 않는다', async () => {
    const { world, api } = await station()
    await expectOk(api.api.post('/api/print/device', { deviceId: DEVICE_A, name: '휴대폰', profileId: 'BAUATO_PPA2L' }))
    await expectOk(api.api.post('/api/print/device/state', { deviceId: DEVICE_A, connected: true, profileId: 'MARKLIFE_LP15' }))
    await api.api.post('/api/print/device/state', { deviceId: DEVICE_A, connected: true, profileId: 'SECRET_PRINTER_X' })
    const text = JSON.stringify(world.logs)
    for (const word of ['BAUATO', 'MARKLIFE', 'SECRET_PRINTER', '휴대폰']) expect(text).not.toContain(word)
  })

  it('저장된 템플릿 크기가 프로필 목록에 없어도 서버는 막지 않는다 (출력 기기가 LABEL_ERROR로 멈춘다)', async () => {
    const { world, seller, api } = await station()
    await expectOk(api.api.post('/api/print/device', { deviceId: DEVICE_A, name: '휴대폰', profileId: 'NIIMBOT_D110' }))
    await expectOk(api.put('/api/print/templates/product', { template: { ...defaultTemplate('product'), size: '50x40' }, version: 0 }))
    const broadcast = await createBroadcast(world, seller, { date: DAY })
    await register(world, seller, broadcast.id, 15, '핑크프릴', 10000)
    await chat(world, seller, broadcast.id, 'UC_A', '홍길동', '15')
    const { job } = await api.claim(DEVICE_A)
    expect(job).toMatchObject({ template: { size: '50x40' } })
    // 출력 기기(웹)는 크기가 맞지 않으면 INVALID_TEMPLATE(item size)로 알린다 → 라벨 오류 멈춤
    expect(await api.fail(DEVICE_A, job!.attempt, 'INVALID_TEMPLATE', 'size')).toBe(true)
    expect((await api.overview()).queue).toMatchObject({ pause: { reason: 'LABEL_ERROR' }, waiting: 1 })
  })
})
