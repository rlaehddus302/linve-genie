// N4b AC-N4b-01 한 사람 확인서 JPG · AC-N4b-02 전원 이미지 묶음(ZIP) · AC-N4b-03 기존 파일 그대로 (서버 경로)
import { layoutReceipt, loadDocumentFont, rasterizePage, type LayoutPage, type ReceiptData } from '@livejjim/documents'
import jpeg from 'jpeg-js'
import { describe, expect, it } from 'vitest'
import { formatLog } from '../src/log.ts'
import { encodeGrayJpeg } from '../src/jpeg.ts'
import { createWorkPools } from '../src/work-pool.ts'
import { renderReceiptJpg } from '../src/receipt-jpg.ts'
import { dosDateTime, storedZip, uniqueNames, ZIP_UTF8_FLAG } from '../src/zip.ts'
import { fontBytes } from '../../../packages/documents/test/helpers.ts'
import { SHOP, at, chat, fileNameOf, getFile, kst, ok, pngHeader, putShop, sellG201 } from './i2-support.ts'
import { readJpeg, readZip, sellMany } from './n4b-support.ts'
import { addSeller, client, createBroadcast, dumpAllTables, fakeClock, newWorld } from './support.ts'

const CREATED = Date.UTC(2026, 9, 18, 14, 30, 0)
const early = () => fakeClock(kst('2026-10-17', '09:00:00'))
const font = () => loadDocumentFont(fontBytes())

/** 같은 확인서 데이터로 그린 회색조 화소 (공유 PNG가 쓰는 것과 같은 함수) */
function grayOf(receipt: ReceiptData): { width: number; height: number; pixels: Uint8Array } {
  const f = font()
  return rasterizePage(layoutReceipt(receipt, f, 'image').pages[0] as LayoutPage, f)
}

/** 기본 JPEG 확인: SOF0만, 구성 요소 3개, APP1·COM·SOF2 없음 */
function expectBaseline(bytes: Uint8Array): { width: number; height: number } {
  const info = readJpeg(bytes)
  expect(info.markers).toContain(0xc0)
  expect(info.markers).not.toContain(0xc2)
  expect(info.markers).not.toContain(0xe1)
  expect(info.markers).not.toContain(0xfe)
  expect(info.components).toBe(3)
  return { width: info.width, height: info.height }
}

describe('JPEG·ZIP 만들기 (단위)', () => {
  it('회색조 화소 → 기본 JPEG: 디코드하면 같은 크기, 밝기 차이 평균이 작다, 같은 화소면 같은 바이트', () => {
    const width = 37
    const height = 21
    const pixels = new Uint8Array(width * height)
    for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 37) % 256 > 128 ? 255 : (i % width) * 6
    const a = encodeGrayJpeg(width, height, pixels)
    const b = encodeGrayJpeg(width, height, pixels)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
    expect(expectBaseline(a)).toEqual({ width, height })
    const decoded = jpeg.decode(a, { useTArray: true, formatAsRGBA: true })
    expect([decoded.width, decoded.height]).toEqual([width, height])
    let sum = 0
    for (let i = 0; i < pixels.length; i++) sum += Math.abs((decoded.data[i * 4] as number) - (pixels[i] as number))
    expect(sum / pixels.length).toBeLessThan(12)
    // 흰 그림은 거의 그대로
    const white = jpeg.decode(encodeGrayJpeg(16, 16, new Uint8Array(256).fill(255)), { useTArray: true })
    expect(Math.min(...[...white.data].filter((_, i) => i % 4 === 0))).toBeGreaterThanOrEqual(253)
  })

  it('ZIP: 저장 방식·UTF-8 비트·이름 순서·내용, 이름 겹침 -2·-3 (대소문자 무시)', () => {
    const bytes = storedZip(
      [
        { name: '확인서-가람.jpg', bytes: Uint8Array.of(1, 2, 3) },
        { name: '확인서-나비.jpg', bytes: Uint8Array.of(4) },
      ],
      CREATED,
    )
    const items = readZip(bytes)
    expect(items.map((item) => item.name)).toEqual(['확인서-가람.jpg', '확인서-나비.jpg'])
    for (const item of items) {
      expect(item.flags & ZIP_UTF8_FLAG).toBe(ZIP_UTF8_FLAG)
      expect(item.method).toBe(0)
    }
    expect([...(items[0] as { bytes: Uint8Array }).bytes]).toEqual([1, 2, 3])
    // 2026-10-18 23:30 KST
    expect(dosDateTime(CREATED)).toEqual({ time: (23 << 11) | (30 << 5), date: ((2026 - 1980) << 9) | (10 << 5) | 18 })
    expect(uniqueNames(['a.jpg', 'b.jpg', 'a.jpg', 'A.jpg', 'a-2.jpg'])).toEqual(['a.jpg', 'b.jpg', 'a-2.jpg', 'A-3.jpg', 'a-2-2.jpg'])
    expect(() => storedZip([{ name: 'x/y.jpg', bytes: new Uint8Array(0) }], CREATED)).toThrow()
  })
})

describe('AC-N4b-01 한 사람 확인서 JPG', () => {
  it('형식·이름·저장하지 않음, 기본 JPEG(SOF0·YCbCr 3·APP1·주석 없음), 같은 시각이면 같은 바이트, PNG와 같은 크기·같은 그림', async () => {
    const world = await newWorld({ clock: early() })
    const seller = await addSeller(world)
    await putShop(world, seller)
    const { sms } = await sellG201(world, seller)
    world.clock.set(CREATED)
    const path = `/api/days/2026-10-18/receipt.jpg?buyer=${encodeURIComponent(sms)}`
    const jpg1 = await getFile(world, seller.cookie, path)
    const jpg2 = await getFile(world, seller.cookie, path)
    expect(jpg1.status).toBe(200)
    expect(jpg1.headers.get('content-type')).toBe('image/jpeg')
    expect(jpg1.headers.get('cache-control')).toBe('no-store')
    const name = fileNameOf(jpg1.headers)
    expect(name).toMatch(/^확인서-2026-10-18-.+\.jpg$/)
    expect(jpg1.headers.get('content-disposition')).toContain('filename="receipt-2026-10-18.jpg"')
    expect(jpg1.headers.get('x-receipt-created-at')).toBe(String(CREATED))
    expect(Buffer.from(jpg1.bytes).equals(Buffer.from(jpg2.bytes))).toBe(true)
    const size = expectBaseline(jpg1.bytes)
    // 같은 시각의 PNG와 크기가 같다
    const png = await getFile(world, seller.cookie, `/api/days/2026-10-18/receipt.png?buyer=${encodeURIComponent(sms)}`)
    const header = pngHeader(png.bytes)
    expect(size).toEqual({ width: 1080, height: header.height })
    expect(header.width).toBe(1080)
    // 같은 확인서 데이터의 화소와 디코드한 밝기 차이 평균 ≤ 4
    const data = await client(world, seller.cookie).get(`/api/days/2026-10-18/receipt?buyer=${encodeURIComponent(sms)}`)
    const gray = grayOf(data.body as unknown as ReceiptData)
    expect([gray.width, gray.height]).toEqual([1080, header.height])
    const decoded = jpeg.decode(jpg1.bytes, { useTArray: true })
    let sum = 0
    for (let i = 0; i < gray.pixels.length; i++) sum += Math.abs((decoded.data[i * 4] as number) - (gray.pixels[i] as number))
    expect(sum / gray.pixels.length).toBeLessThanOrEqual(4)
    // 서버 JPG = 같은 확인서 데이터로 그린 Node JPG (바이트까지)
    expect(Buffer.from(jpg1.bytes).equals(Buffer.from(renderReceiptJpg(data.body as unknown as ReceiptData, font())))).toBe(true)
  })

  it('품목 없는 묶음·모르는 구매자 → PNG와 같은 답, 리허설 범위도 만든다(리허설- 이름), 다른 판매자 404, 로그인 없음 401', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const other = await addSeller(world)
    const b = await sellMany(world, seller, '2026-10-19', [['UC_A', '가람', 1]])
    await ok(world, seller, { type: 'host.cancel', b, no: 1, buyer: 'UC_A', reason: '구매자 요청' })
    for (const buyer of ['UC_A', 'UC_NOBODY']) {
      const png = await getFile(world, seller.cookie, `/api/days/2026-10-19/receipt.png?buyer=${buyer}`)
      const jpg = await getFile(world, seller.cookie, `/api/days/2026-10-19/receipt.jpg?buyer=${buyer}`)
      expect(jpg.status).toBe(png.status)
      expect(jpg.json).toEqual(png.json)
      expect(jpg.json?.error).toEqual({ code: 'NO_ITEMS', message: '구매 내역이 없어 확인서를 만들 수 없어요.' })
    }
    expect((await getFile(world, other.cookie, '/api/days/2026-10-19/receipt.jpg?buyer=UC_A')).status).toBe(404)
    expect((await getFile(world, null, '/api/days/2026-10-19/receipt.jpg?buyer=UC_A')).status).toBe(401)
    expect((await getFile(world, seller.cookie, '/api/days/2026-10-19/receipt.jpg')).status).toBe(400)
    const r = await createBroadcast(world, seller, { date: '2026-10-19', rehearsal: true })
    await ok(world, seller, { type: 'product.register', b: r.id, no: 1, name: '핑크', price: 1000 })
    await chat(world, seller, r.id, 'r1', 'sim_a', '연습', '1')
    const rehearsal = await getFile(world, seller.cookie, '/api/days/2026-10-19/receipt.jpg?buyer=sim_a&rehearsal=true')
    expect(rehearsal.status).toBe(200)
    expect(fileNameOf(rehearsal.headers)).toBe('리허설-확인서-2026-10-19-연습.jpg')
    expectBaseline(rehearsal.bytes)
  })
})

describe('AC-N4b-02 전원 이미지 묶음 (ZIP)', () => {
  it('🌵가람·나비·나비 + 품목 없는 묶음 → 일괄 순서 JPG 3개, 겹친 이름 -2, UTF-8 비트, 폴더 없음, 한 사람 JPG와 같은 바이트', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    await putShop(world, seller, SHOP)
    const b = await sellMany(world, seller, '2026-10-19', [
      ['UC_C', '나비', 1],
      ['UC_B', '나비', 2],
      ['UC_A', '🌵가람', 1],
      ['UC_D', '빈손', 1],
    ])
    // 빈손(UC_D)의 상품은 취소 → 품목 없는 묶음
    await ok(world, seller, { type: 'host.cancel', b, no: 5, buyer: 'UC_D', reason: '구매자 요청' })
    const zip = await getFile(world, seller.cookie, '/api/days/2026-10-19/receipts.zip')
    expect(zip.status).toBe(200)
    expect(zip.headers.get('content-type')).toBe('application/zip')
    expect(zip.headers.get('cache-control')).toBe('no-store')
    expect(fileNameOf(zip.headers)).toBe('확인서-2026-10-19-전원-이미지.zip')
    expect(zip.headers.get('x-receipt-count')).toBe('3')
    const items = readZip(zip.bytes)
    expect(items.map((item) => item.name)).toEqual(['확인서-2026-10-19-가람.jpg', '확인서-2026-10-19-나비.jpg', '확인서-2026-10-19-나비-2.jpg'])
    for (const item of items) {
      expect(item.flags & ZIP_UTF8_FLAG).toBe(ZIP_UTF8_FLAG)
      expect(item.name).not.toMatch(/[/\\]/)
      expect(expectBaseline(item.bytes).width).toBe(1080)
    }
    // 같은 만든 시각이면 한 사람 JPG와 같은 바이트 (같은 이름 둘은 구매자 ID 순 — UC_B 다음 UC_C)
    const createdAt = zip.headers.get('x-receipt-created-at')
    expect(createdAt).not.toBeNull()
    for (const [index, buyer] of ['UC_A', 'UC_B', 'UC_C'].entries()) {
      const single = await getFile(world, seller.cookie, `/api/days/2026-10-19/receipt.jpg?buyer=${buyer}`)
      expect(single.headers.get('x-receipt-created-at')).toBe(createdAt)
      expect(Buffer.from(single.bytes).equals(Buffer.from((items[index] as { bytes: Uint8Array }).bytes)), buyer).toBe(true)
    }
  })

  it('품목 있는 묶음이 없으면 전원 PDF와 같은 답, 리허설이면 리허설- 이름, 다른 판매자·없는 날짜 404, 아무것도 기록하지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const other = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: '2026-10-19' })
    await ok(world, seller, { type: 'product.register', b: b.id, no: 1, name: '핑크', price: 1000 })
    const pdf = await getFile(world, seller.cookie, '/api/days/2026-10-19/receipts.pdf')
    const zip = await getFile(world, seller.cookie, '/api/days/2026-10-19/receipts.zip')
    expect(zip.status).toBe(pdf.status)
    expect(zip.json).toEqual(pdf.json)
    expect(zip.json?.error).toEqual({ code: 'NO_ITEMS', message: '그 날짜에 구매 내역이 있는 구매자가 없어요.' })
    expect((await getFile(world, other.cookie, '/api/days/2026-10-19/receipts.zip')).status).toBe(404)
    expect((await getFile(world, seller.cookie, '/api/days/2026-10-25/receipts.zip')).status).toBe(404)
    const r = await createBroadcast(world, seller, { date: '2026-10-19', rehearsal: true })
    await ok(world, seller, { type: 'product.register', b: r.id, no: 1, name: '핑크', price: 1000 })
    await chat(world, seller, r.id, 'r1', 'sim_x', '연습', '1')
    const before = await dumpAllTables(world.database)
    const rehearsal = await getFile(world, seller.cookie, '/api/days/2026-10-19/receipts.zip?rehearsal=true')
    expect(rehearsal.status).toBe(200)
    expect(fileNameOf(rehearsal.headers)).toBe('리허설-확인서-2026-10-19-전원-이미지.zip')
    expect(readZip(rehearsal.bytes).map((item) => item.name)).toEqual(['리허설-확인서-2026-10-19-연습.jpg'])
    expect(await dumpAllTables(world.database)).toBe(before)
    // 로그에 파일 이름·구매자 이름이 없다
    const logs = world.logs.map(formatLog).join('\n')
    expect(logs).not.toContain('확인서')
    expect(logs).not.toContain('연습')
  })

  it('파일 작업 한도: 그 판매자의 문서 작업이 밀려 있으면 I2와 같은 BUSY 문장', async () => {
    const world = await newWorld({ work: createWorkPools() })
    const seller = await addSeller(world)
    await sellMany(world, seller, '2026-10-19', [['UC_A', '가람', 1]])
    // 판매자마다 문서 작업 2개까지 — 끝나지 않는 작업 2개를 먼저 맡긴다
    const pool = world.server.work.documents
    const controller = new AbortController()
    const hold = async () => {
      try {
        await pool.run(seller.sellerId, 'ledgerXlsx', null, {
          chunks: (async function* () {
            await new Promise((resolve) => controller.signal.addEventListener('abort', resolve))
            yield []
          })(),
          signal: controller.signal,
        })
      } catch {
        // 시험이 멈춘다
      }
    }
    const held = [hold(), hold()]
    const busy = await getFile(world, seller.cookie, '/api/days/2026-10-19/receipts.zip')
    controller.abort()
    await Promise.all(held)
    await Promise.all([world.server.work.documents.close(), world.server.work.receipts.close(), world.server.work.sheets.close()])
    expect(busy.status).toBe(429)
    expect(busy.json?.error).toEqual({ code: 'BUSY', message: '지금 다른 파일을 만들고 있어요. 잠시 뒤 다시 눌러 주세요.' })
  })
})

describe('AC-N4b-03 기존 파일 그대로', () => {
  it('한 사람 PDF·PNG·전원 PDF의 이름·형식은 I2 그대로 (I2 시험이 내용·오류를 고정한다)', async () => {
    const world = await newWorld({ clock: early() })
    const seller = await addSeller(world)
    await putShop(world, seller)
    await sellG201(world, seller)
    at(world, '2026-10-18', '23:30:00')
    const pdf = await getFile(world, seller.cookie, '/api/days/2026-10-18/receipt.pdf?buyer=UC_A')
    const png = await getFile(world, seller.cookie, '/api/days/2026-10-18/receipt.png?buyer=UC_A')
    const all = await getFile(world, seller.cookie, '/api/days/2026-10-18/receipts.pdf')
    expect([pdf.headers.get('content-type'), png.headers.get('content-type'), all.headers.get('content-type')]).toEqual(['application/pdf', 'image/png', 'application/pdf'])
    expect([fileNameOf(pdf.headers), fileNameOf(png.headers), fileNameOf(all.headers)]).toEqual(['확인서-2026-10-18-길동이.pdf', '확인서-2026-10-18-길동이.png', '확인서-2026-10-18-전원.pdf'])
  })
})
