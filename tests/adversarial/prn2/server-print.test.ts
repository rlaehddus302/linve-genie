// PRN2 적대 시험 (test-domain): 서버 프린터 프로필 기록과 그림 파일 입구 (AC-PRN2-08·09, L-11 10·13·16·17, D-PRN2-06·07·11~14).
// - profileId: 표에 없는 글·대소문자·앞 공백·아주 긴 글은 모름(null)으로 기록하고 400이 아니다. 글 아닌 값(숫자·배열·객체·참)만 400이고 받은 값을 되돌리지 않는다.
//   기록에는 표의 ID만 남고(모르는 글은 DB에도 없다) 로그에는 어떤 프로필 글도 없다. 칸이 빠지면 모름, 끊김·그만하기·바꾸기·DISCONNECTED 결과면 지운다.
//   크기 목록(queue.labelSizes)은 그 프로필의 크기, 모르면 B1. 다른 판매자는 영향이 없고, 다른 판매자의 출력 기기 상태를 바꿀 수 없다.
//   크기 목록 밖 템플릿은 서버가 막지 않고(작업은 생긴다), 출력 기기가 INVALID_TEMPLATE(size)로 알리면 라벨 오류 멈춤.
// - PNG 입구: 받은 작업의 PNG = encodeLabelPng(같은 비트맵), 203dpi 1비트 흑백, 점이 비트맵과 같다. 틀린 판매자·기기·시도·작업·끝난 시도·바뀐 출력 기기·
//   모양이 틀린 질의는 비트맵 입구와 같은 상태·같은 본문. 시험 그림(test-png)과 test-bitmap도 size 질의마다 같은 그림·같은 오류.
import { inflateSync } from 'node:zlib'
import { encodeLabelPng, type LabelBitmap } from '@livejjim/label'
import { afterEach, describe, expect, it } from 'vitest'
import { dumpAll } from '../s04/helpers.ts'
import { DAY, DEV_A, DEV_B, call, chat, ev, harness, printer, startBroadcast, type Harness, type Res } from '../i1/helpers.ts'

let h: Harness | null = null
afterEach(async () => {
  await h?.close()
  h = null
})

const B1_SIZES = ['50x30', '50x20', '50x40']
const TAPE_SIZES = ['tape12x40', 'tape15x30', 'tape15x50']

interface Queue {
  device: { id: string; profileId: string | null } | null
  labelSizes: string[]
  pause: { reason: string } | null
}
const queueOf = (r: Res): Queue => r.body.queue as Queue

async function seller(loginId: string) {
  const a = await h!.account(loginId)
  return { ...a, p: printer(h!, a.cookie), raw: (method: string, path: string, body?: unknown) => call(h!.server, a.cookie, method, path, body) }
}

describe('profileId 기록 — 값 경계 (AC-PRN2-08, D-PRN2-12·13)', () => {
  it('표의 ID만 기록하고, 표에 없는 글은 모름(null·B1 크기 목록)이며 400이 아니다', async () => {
    h = await harness()
    const a = await seller('prn2pid1')
    const reg = await a.raw('POST', '/api/print/device', { deviceId: DEV_A, name: '휴대폰', profileId: 'MARKLIFE_P11' })
    expect(reg.status, reg.text).toBe(200)
    expect(queueOf(reg).device?.profileId).toBe('MARKLIFE_P11')
    expect(queueOf(reg).labelSizes).toEqual(TAPE_SIZES)
    const cases: [string, unknown][] = [
      ['표에 없는 글', 'ZZ_SECRET_PRN_9'],
      ['소문자', 'marklife_p11'],
      ['앞 공백', ' MARKLIFE_P11'],
      ['끝 줄바꿈', 'MARKLIFE_P11\n'],
      ['폭 없는 공백', 'MARKLIFE_P11​'],
      ['빈 글', ''],
      ['아주 긴 글(1만 자)', `ZZ_LONG_${'가'.repeat(10_000)}`],
      ['HTML', '<script>alert(1)</script>'],
      ['null', null],
    ]
    for (const [what, value] of cases) {
      const first = await a.raw('POST', '/api/print/device/state', { deviceId: DEV_A, connected: true, profileId: 'BAUATO_PPA2L' })
      expect(queueOf(first).labelSizes, what).toEqual(['50x30', '50x15', '50x50'])
      const r = await a.raw('POST', '/api/print/device/state', { deviceId: DEV_A, connected: true, profileId: value })
      expect(r.status, `${what}: ${r.text.slice(0, 200)}`).toBe(200)
      expect(queueOf(r).device?.profileId, what).toBeNull()
      expect(queueOf(r).labelSizes, what).toEqual(B1_SIZES)
      expect((await a.p.overview()).queue).toMatchObject({ device: { profileId: null } })
    }
    const db = await dumpAll(h.database)
    for (const marker of ['ZZ_SECRET_PRN_9', 'marklife_p11', 'ZZ_LONG_', '<script>']) expect(db, marker).not.toContain(marker)
  })

  it('글 아닌 값은 400 INVALID_INPUT(field profileId)이고 받은 값을 되돌리지 않으며 기록은 그대로', async () => {
    h = await harness()
    const a = await seller('prn2pid2')
    expect((await a.raw('POST', '/api/print/device', { deviceId: DEV_A, name: '휴대폰', profileId: 'MARKLIFE_S2' })).status).toBe(200)
    for (const value of [12, ['MARKLIFE_P11'], { id: 'ZZ_OBJ_MARK' }, true, 0]) {
      for (const path of ['/api/print/device/state', '/api/print/device']) {
        const body = path.endsWith('state') ? { deviceId: DEV_A, connected: true, profileId: value } : { deviceId: DEV_A, name: '휴대폰', profileId: value }
        const r = await a.raw('POST', path, body)
        expect(r.status, `${path} ${JSON.stringify(value)}`).toBe(400)
        expect(r.body).toMatchObject({ error: { code: 'INVALID_INPUT' } })
        expect(JSON.stringify(r.body)).toContain('profileId')
        expect(r.text).not.toContain('ZZ_OBJ_MARK')
      }
    }
    expect((await a.p.overview()).queue).toMatchObject({ device: { profileId: 'MARKLIFE_S2' } })
  })

  it('칸이 빠지면 모름, 끊김·출력 그만하기·출력 기기 바꾸기·DISCONNECTED 결과면 지운다 (D-PRN2-13)', async () => {
    h = await harness()
    const a = await seller('prn2pid3')
    const b = await startBroadcast(h.server, a.cookie, DAY)
    const set = async (profileId: string) => expect((await a.raw('POST', '/api/print/device/state', { deviceId: DEV_A, connected: true, profileId })).status).toBe(200)
    const pid = async () => (await a.p.overview()).queue as unknown as Queue
    expect((await a.raw('POST', '/api/print/device', { deviceId: DEV_A, name: '휴대폰', profileId: 'MARKLIFE_P50' })).status).toBe(200)
    // 칸 빠짐
    expect((await a.raw('POST', '/api/print/device/state', { deviceId: DEV_A, connected: true })).status).toBe(200)
    expect((await pid()).device?.profileId).toBeNull()
    // "이 기기에서 출력"을 다시 누를 때 칸 빠짐도 모름
    await set('MARKLIFE_P50')
    expect((await a.raw('POST', '/api/print/device', { deviceId: DEV_A, name: '휴대폰' })).status).toBe(200)
    expect((await pid()).device?.profileId).toBeNull()
    // 끊김 (profileId를 같이 보내도 지운다)
    await set('MARKLIFE_P50')
    expect((await a.raw('POST', '/api/print/device/state', { deviceId: DEV_A, connected: false, profileId: 'MARKLIFE_P50' })).status).toBe(200)
    expect((await pid()).device?.profileId).toBeNull()
    expect((await pid()).labelSizes).toEqual(B1_SIZES)
    // 출력 기기 바꾸기 → 새 기기가 알린 값
    await set('MARKLIFE_P50')
    expect((await a.raw('POST', '/api/print/device', { deviceId: DEV_B, name: '노트북', replace: true, profileId: 'NIIMBOT_D110' })).status).toBe(200)
    expect((await pid()).device).toMatchObject({ id: DEV_B, profileId: 'NIIMBOT_D110' })
    expect((await pid()).labelSizes).toEqual(TAPE_SIZES)
    // 바뀌기 전 기기는 더 알릴 수 없다
    expect((await a.raw('POST', '/api/print/device/state', { deviceId: DEV_A, connected: true, profileId: 'MARKLIFE_S2' })).status).toBe(409)
    expect((await pid()).device?.profileId).toBe('NIIMBOT_D110')
    // DISCONNECTED 결과
    await ev(h, a.cookie, { type: 'product.register', b, no: 7, name: '칠', price: 1000 })
    await chat(h, a.sellerId, b, 'UC_A', '가', '7')
    const o = await a.p.overview()
    if (o.queue.pause !== null) expect((await a.p.restart()).status).toBe(200)
    const claimed = await a.p.claim(DEV_B)
    expect(claimed.job).not.toBeNull()
    expect((await a.p.result(DEV_B, claimed.job!.attempt, false, 'DISCONNECTED')).status).toBe(200)
    expect((await pid()).device?.profileId).toBeNull()
    // 출력 그만하기
    expect((await a.raw('POST', '/api/print/device/state', { deviceId: DEV_B, connected: true, profileId: 'NIIMBOT_B21' })).status).toBe(200)
    expect((await pid()).device?.profileId).toBe('NIIMBOT_B21')
    expect((await a.p.release()).status).toBe(200)
    expect((await pid()).device).toBeNull()
    expect((await pid()).labelSizes).toEqual(B1_SIZES)
  })

  it('판매자마다 따로 — B의 기록·크기 목록은 A가 알린 값과 상관없고, A의 기기 ID로 B가 알려도 A의 기록은 바뀌지 않는다', async () => {
    h = await harness()
    const a = await seller('prn2pidA')
    const b = await seller('prn2pidB')
    expect((await a.raw('POST', '/api/print/device', { deviceId: DEV_A, name: '휴대폰', profileId: 'MARKLIFE_P12' })).status).toBe(200)
    expect(((await b.p.overview()).queue as unknown as Queue).labelSizes).toEqual(B1_SIZES)
    expect(((await b.p.overview()).queue as unknown as Queue).device).toBeNull()
    const cross = await b.raw('POST', '/api/print/device/state', { deviceId: DEV_A, connected: false, profileId: 'NIIMBOT_B1' })
    expect(cross.status).toBe(409)
    expect(((await a.p.overview()).queue as unknown as Queue).device).toMatchObject({ id: DEV_A, profileId: 'MARKLIFE_P12' })
    expect((await b.raw('POST', '/api/print/device', { deviceId: DEV_A, name: '남의 기기', profileId: 'NIIMBOT_D110' })).status).toBe(200)
    expect(((await a.p.overview()).queue as unknown as Queue).device).toMatchObject({ id: DEV_A, profileId: 'MARKLIFE_P12' })
    expect(((await b.p.overview()).queue as unknown as Queue).device).toMatchObject({ profileId: 'NIIMBOT_D110' })
  })

  it('로그에 프로필 글이 없다 (표의 ID·모르는 글 모두, L-11 16)', async () => {
    h = await harness()
    const a = await seller('prn2pidlog')
    await a.raw('POST', '/api/print/device', { deviceId: DEV_A, name: '휴대폰', profileId: 'MARKLIFE_LP90' })
    await a.raw('POST', '/api/print/device/state', { deviceId: DEV_A, connected: true, profileId: 'ZZ_LOG_MARK_PRN' })
    await a.raw('POST', '/api/print/device/state', { deviceId: DEV_A, connected: true, profileId: ['ZZ_LOG_ARRAY_MARK'] })
    await a.raw('POST', '/api/print/device/state', { deviceId: DEV_A, connected: true, profileId: 'BAUATO_PPA2L' })
    const logs = JSON.stringify(h.logs)
    for (const marker of ['MARKLIFE_LP90', 'ZZ_LOG_MARK_PRN', 'ZZ_LOG_ARRAY_MARK', 'BAUATO_PPA2L', 'profileId']) expect(logs, marker).not.toContain(marker)
  })

  it('크기 목록 밖 템플릿(50×30)을 테이프 프로필 출력 기기가 받으면 서버는 막지 않고, INVALID_TEMPLATE(size) 결과면 라벨 오류 멈춤 + 작업은 대기 맨 앞', async () => {
    h = await harness()
    const a = await seller('prn2size')
    const b = await startBroadcast(h.server, a.cookie, DAY)
    expect((await a.raw('POST', '/api/print/device', { deviceId: DEV_A, name: '휴대폰', profileId: 'MARKLIFE_P15' })).status).toBe(200)
    await ev(h, a.cookie, { type: 'product.register', b, no: 3, name: '셋', price: 3000 })
    await chat(h, a.sellerId, b, 'UC_A', '가', '3')
    if ((await a.p.overview()).queue.pause !== null) expect((await a.p.restart()).status).toBe(200)
    const claimed = await a.raw('POST', '/api/print/claim', { deviceId: DEV_A })
    expect(claimed.status, claimed.text).toBe(200)
    const job = claimed.body.job as { attempt: string; template: { size: string } } | null
    expect(job?.template.size).toBe('50x30')
    expect((await a.p.result(DEV_A, job!.attempt, false, 'INVALID_TEMPLATE', 'size')).status).toBe(200)
    const o = await a.p.overview()
    expect(o.queue.pause?.reason).toBe('LABEL_ERROR')
    expect(o.jobs.map((j) => j.status)).toEqual(['WAITING'])
  })
})

// ─── 그림 파일 입구 ───

/** PNG를 읽어 L-1 그림으로 (흑백 1비트·필터 0만 — 서버 PNG의 꼴) */
function decodePng(bytes: Uint8Array): { image: LabelBitmap; dpm: [number, number]; ihdr: number[] } {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  expect([...bytes.subarray(0, 8)]).toEqual(sig)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = 8
  let width = 0
  let height = 0
  let ihdr: number[] = []
  let dpm: [number, number] = [0, 0]
  const idat: Uint8Array[] = []
  while (at < bytes.length) {
    const len = view.getUint32(at)
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    const body = bytes.subarray(at + 8, at + 8 + len)
    if (type === 'IHDR') {
      width = view.getUint32(at + 8)
      height = view.getUint32(at + 12)
      ihdr = [...body.subarray(8)]
    }
    if (type === 'pHYs') dpm = [view.getUint32(at + 8), view.getUint32(at + 12)]
    if (type === 'IDAT') idat.push(body)
    at += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const row = Math.ceil(width / 8)
  const data = new Uint8Array(row * height)
  for (let y = 0; y < height; y++) {
    expect(raw[y * (row + 1)], '필터 0').toBe(0)
    for (let i = 0; i < row; i++) data[y * row + i] = ~raw[y * (row + 1) + 1 + i]! & 0xff
    const spare = row * 8 - width
    if (spare > 0) data[y * row + row - 1] = data[y * row + row - 1]! & ((0xff << spare) & 0xff)
  }
  return { image: { width, height, data }, dpm, ihdr }
}

async function getBytes(server: Harness['server'], cookie: string | null, path: string): Promise<{ status: number; type: string | null; cache: string | null; bytes: Uint8Array; text: string }> {
  const res = await server.app.request(path, { method: 'GET', headers: cookie === null ? {} : { Cookie: cookie } })
  const buf = new Uint8Array(await res.arrayBuffer())
  return { status: res.status, type: res.headers.get('content-type'), cache: res.headers.get('cache-control'), bytes: buf, text: Buffer.from(buf).toString('utf8') }
}

const bitmapOf = (text: string): LabelBitmap => {
  const b = JSON.parse(text) as { width: number; height: number; data: string }
  return { width: b.width, height: b.height, data: new Uint8Array(Buffer.from(b.data, 'base64')) }
}

describe('PNG 입구 (AC-PRN2-09, L-11 17, D-PRN2-06)', () => {
  it('받은 작업의 PNG = encodeLabelPng(같은 비트맵), 203dpi 1비트 흑백, 점이 같다 — 틀린 요청은 비트맵 입구와 같은 오류', async () => {
    h = await harness()
    const a = await seller('prn2png')
    const other = await seller('prn2pngB')
    const b = await startBroadcast(h.server, a.cookie, DAY)
    await ev(h, a.cookie, { type: 'product.register', b, no: 15, name: '핑크프릴🌵<b>', price: 12000 })
    await a.p.become(DEV_A)
    await chat(h, a.sellerId, b, 'UC_A', '우주천사', '15')
    const claimed = await a.p.claim(DEV_A)
    const job = claimed.job!
    const base = (kind: 'bitmap' | 'png', q: string, id = job.id) => `/api/print/jobs/${encodeURIComponent(id)}/${kind}${q}`
    const ok = `?device=${DEV_A}&attempt=${job.attempt}`
    const bmp = await getBytes(h.server, a.cookie, base('bitmap', ok))
    expect(bmp.status, bmp.text).toBe(200)
    const png = await getBytes(h.server, a.cookie, base('png', ok))
    expect(png.status).toBe(200)
    expect(png.type).toBe('image/png')
    expect(png.cache).toBe('no-store')
    const bitmap = bitmapOf(bmp.text)
    const enc = encodeLabelPng(bitmap)
    if (!enc.ok) throw new Error('인코딩 실패')
    expect(Buffer.from(png.bytes).equals(Buffer.from(enc.bytes))).toBe(true)
    const decoded = decodePng(png.bytes)
    expect(decoded.ihdr).toEqual([1, 0, 0, 0, 0])
    expect(decoded.dpm).toEqual([7992, 7992])
    expect([decoded.image.width, decoded.image.height]).toEqual([bitmap.width, bitmap.height])
    expect(Buffer.from(decoded.image.data).equals(Buffer.from(bitmap.data))).toBe(true)
    // 같은 요청을 다시 해도 같은 바이트 (조회는 시도를 끝내지 않는다)
    expect(Buffer.from((await getBytes(h.server, a.cookie, base('png', ok))).bytes).equals(Buffer.from(png.bytes))).toBe(true)

    const wrong: [string, string | null, string, string | undefined][] = [
      ['로그인 없음', null, ok, undefined],
      ['다른 판매자', other.cookie, ok, undefined],
      ['다른 기기', a.cookie, `?device=${DEV_B}&attempt=${job.attempt}`, undefined],
      ['틀린 시도(모양은 맞음)', a.cookie, `?device=${DEV_A}&attempt=${'Z'.repeat(20)}`, undefined],
      ['시도 모양 틀림', a.cookie, `?device=${DEV_A}&attempt=x`, undefined],
      ['시도 없음', a.cookie, `?device=${DEV_A}`, undefined],
      ['기기 모양 틀림', a.cookie, `?device=../../etc&attempt=${job.attempt}`, undefined],
      ['기기 없음', a.cookie, `?attempt=${job.attempt}`, undefined],
      ['다른 작업 ID', a.cookie, ok, 'no-such-job'],
      ['아주 긴 작업 ID', a.cookie, ok, 'j'.repeat(5_000)],
    ]
    for (const [what, cookie, q, id] of wrong) {
      const x = await getBytes(h.server, cookie, base('bitmap', q, id ?? job.id))
      const y = await getBytes(h.server, cookie, base('png', q, id ?? job.id))
      expect(x.status, what).not.toBe(200)
      expect(y.status, what).toBe(x.status)
      expect(y.text, what).toBe(x.text)
    }
    // 출력 기기 바꾸기 → 이전 기기의 시도는 끝났다
    expect((await a.raw('POST', '/api/print/device', { deviceId: DEV_B, name: '노트북', replace: true })).status).toBe(200)
    const after = [await getBytes(h.server, a.cookie, base('bitmap', ok)), await getBytes(h.server, a.cookie, base('png', ok))]
    expect(after.map((r) => r.status)).toEqual([404, 404])
    expect(after[1]!.text).toBe(after[0]!.text)
  })

  it('끝난 시도(출력함)는 비트맵·PNG 모두 404, 같은 본문', async () => {
    h = await harness()
    const a = await seller('prn2pngdone')
    const b = await startBroadcast(h.server, a.cookie, DAY)
    await ev(h, a.cookie, { type: 'product.register', b, no: 2, name: '둘', price: 2000 })
    await a.p.become(DEV_A)
    await chat(h, a.sellerId, b, 'UC_A', '가', '2')
    const job = (await a.p.claim(DEV_A)).job!
    const q = `?device=${DEV_A}&attempt=${job.attempt}`
    expect((await getBytes(h.server, a.cookie, `/api/print/jobs/${job.id}/png${q}`)).status).toBe(200)
    expect((await a.p.result(DEV_A, job.attempt, true)).status).toBe(200)
    const x = await getBytes(h.server, a.cookie, `/api/print/jobs/${job.id}/bitmap${q}`)
    const y = await getBytes(h.server, a.cookie, `/api/print/jobs/${job.id}/png${q}`)
    expect([x.status, y.status]).toEqual([404, 404])
    expect(y.text).toBe(x.text)
  })

  it('시험 그림: test-png = encodeLabelPng(test-bitmap), size 질의 경계마다 두 입구가 같은 답 (D-PRN2-11)', async () => {
    h = await harness()
    const a = await seller('prn2testpng')
    const sizes: [string, string, 'ok' | 'bad' | 'either'][] = [
      ['없음', '', 'ok'],
      ['50x30', '?size=50x30', 'ok'],
      ['50x50', '?size=50x50', 'ok'],
      ['50x15', '?size=50x15', 'ok'],
      ['tape12x40', '?size=tape12x40', 'ok'],
      ['tape15x50', '?size=tape15x50', 'ok'],
      ['대문자 50X30', '?size=50X30', 'bad'],
      ['대문자 TAPE12X40', '?size=TAPE12X40', 'bad'],
      ['곱하기 기호', `?size=${encodeURIComponent('50×30')}`, 'bad'],
      ['앞 공백', `?size=${encodeURIComponent(' 50x30')}`, 'bad'],
      ['목록 밖', '?size=100x150', 'bad'],
      ['아주 긴 값', `?size=${'9'.repeat(5_000)}`, 'bad'],
      ['빈 값', '?size=', 'either'],
      ['여러 번', '?size=50x30&size=tape12x40', 'either'],
    ]
    let base30: Uint8Array | null = null
    for (const [what, q, want] of sizes) {
      const x = await getBytes(h.server, a.cookie, `/api/print/test-bitmap${q}`)
      const y = await getBytes(h.server, a.cookie, `/api/print/test-png${q}`)
      expect(x.status, what).not.toBe(500)
      expect([200, 400, 422], what).toContain(x.status)
      if (want === 'ok') expect(x.status, `${what}: ${x.text.slice(0, 200)}`).toBe(200)
      if (want === 'bad') expect(x.status, what).toBe(422)
      if (x.status === 200) {
        expect(y.status, what).toBe(200)
        const enc = encodeLabelPng(bitmapOf(x.text))
        expect(enc.ok && Buffer.from(y.bytes).equals(Buffer.from(enc.bytes)), what).toBe(true)
        if (what === '없음') base30 = y.bytes
        if (what === '50x30') expect(Buffer.from(y.bytes).equals(Buffer.from(base30!)), '없음 = 50x30').toBe(true)
        if (what.startsWith('tape')) expect(decodePng(y.bytes).image.height, what).toBe(96)
      } else {
        expect(y.status, what).toBe(x.status)
        expect(y.text, what).toBe(x.text)
        expect(x.text, what).toContain('INVALID_TEMPLATE')
        // 받은 값을 그대로 되돌려 주지 않는다 (아주 긴 값)
        expect(x.text.length, what).toBeLessThan(2_000)
      }
    }
    expect((await getBytes(h.server, null, '/api/print/test-png')).status).toBe(401)
  })
})
