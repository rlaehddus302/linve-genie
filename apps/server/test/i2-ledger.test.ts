// AC-I2-20 판매대장 엑셀 내려받기, AC-I2-21 엑셀 글 칸 금지 글자(서버 경로), AC-I2-33 배송 칸, AC-I2-64 전체 판매대장
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { at, chat, fileNameOf, getFile, kst, ok, pack, sellG201, sellG202 } from './i2-support.ts'
import { addSeller, client, createBroadcast, dumpAllTables, fakeClock, login, newWorld, type Seller, type TestServer } from './support.ts'

async function readSheet(bytes: Uint8Array): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer)
  const sheet = workbook.worksheets[0]
  if (sheet === undefined) return []
  const rows: string[][] = []
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r)
    const cells: string[] = []
    for (let c = 1; c <= 11; c++) {
      const value = row.getCell(c).value
      cells.push(value === null || value === undefined ? '' : String(value))
    }
    rows.push(cells)
  }
  return rows
}

const ledgerUrl = (from: string, to: string, broadcasts: readonly string[] = []) =>
  `/api/ledger.xlsx?from=${from}&to=${to}${broadcasts.map((b) => `&b=${encodeURIComponent(b)}`).join('')}`

/** AC-P2-30 표 (배송 칸만 확정 행마다 `포장 대기`) */
const G202_ROWS = [
  ['2026-10-19', '1부', '1', '핑크프릴', '10000', '홍길동', '유튜브', '2026-10-19 20:00:03', '1등', '미입금', '포장 대기'],
  ['2026-10-19', '1부', '1', '핑크프릴', '10000', '꽃님', '유튜브', '2026-10-19 20:00:04', '1등', '미입금', '포장 대기'],
  ['2026-10-19', '1부', '2', '라울', '5000', '초록이', '유튜브', '2026-10-19 20:01:03', '1등', '미입금', '포장 대기'],
  ['2026-10-19', '1부', '3', '블루엘프', '8000', '', '', '', '판매 중', '', ''],
  ['2026-10-19', '1부', '4', '레티지아', '7000', '', '', '', '공개 전', '', ''],
  ['2026-10-19', '1부', '5', '황금사', '6000', '새싹', '유튜브', '2026-10-19 20:06:00', '1등', '미입금', '포장 대기'],
  ['2026-10-19', '1부', '6', '블랙프린스', '12000', '문자찜 / 끝자리 5432', '문자', '2026-10-19 20:08', '1등', '미입금', '포장 대기'],
  ['2026-10-19', '1부', '7', '로라', '4000', '꽃님', '직접 배정', '2026-10-19 20:09:30', '1등', '미입금', '포장 대기'],
  ['2026-10-19', '1부', '8', '자보', '3000', '', '', '', '판매 종료', '', ''],
]
const HEADER = ['방송 날짜', '회차', '상품 번호', '품종', '가격', '구매자', '채널', '찜 시각', '상태', '입금', '배송']

describe('AC-I2-20 판매대장 엑셀 내려받기', () => {
  it('G-ENG-202와 같은 판매를 서버로 넣은 2026-10-19 하루의 대장 = AC-P2-30 표 (배송 칸만 포장 대기), 이름·형식·저장하지 않음', async () => {
    const world = await newWorld({ clock: fakeClock(kst('2026-10-19', '19:00:00')) })
    const seller = await addSeller(world)
    await sellG202(world, seller)
    const before = await dumpAllTables(world.database)
    const file = await getFile(world, seller.cookie, ledgerUrl('2026-10-19', '2026-10-19'))
    expect(file.status, JSON.stringify(file.json)).toBe(200)
    expect(file.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(file.headers.get('cache-control')).toBe('no-store')
    expect(fileNameOf(file.headers)).toBe('판매대장-2026-10-19.xlsx')
    expect(await readSheet(file.bytes)).toEqual([HEADER, ...G202_ROWS])
    expect(await dumpAllTables(world.database)).toBe(before)
  })

  it('여러 날 이름은 판매대장-<시작>-<끝>.xlsx, 고른 방송만, 리허설 범위는 읽지 않는다', async () => {
    const world = await newWorld({ clock: fakeClock(kst('2026-10-17', '09:00:00')) })
    const seller = await addSeller(world)
    const g201 = await sellG201(world, seller)
    await sellG202(world, seller)
    const rehearsal = await createBroadcast(world, seller, { date: '2026-10-19', rehearsal: true })
    await ok(world, seller, { type: 'product.register', b: rehearsal.id, no: 99, name: '연습', price: 1000 })
    const all = await getFile(world, seller.cookie, ledgerUrl('2026-10-01', '2026-10-31'))
    expect(fileNameOf(all.headers)).toBe('판매대장-2026-10-01-2026-10-31.xlsx')
    const rows = await readSheet(all.bytes)
    expect(rows.slice(1).map((row) => row[0])).toEqual([...Array.from({ length: 4 }, () => '2026-10-18'), ...Array.from({ length: 9 }, () => '2026-10-19')])
    expect(rows.flat()).not.toContain('연습')
    const picked = await readSheet((await getFile(world, seller.cookie, ledgerUrl('2026-10-01', '2026-10-31', [g201.b2]))).bytes)
    expect(picked.slice(1).map((row) => `${row[1] ?? ''} ${row[2] ?? ''}`)).toEqual(['2부 7'])
  })

  it('오류: 날짜 형식, 시작 > 끝, 366일 초과(367일), 고른 방송이 실제 방송 아님(없는 것·남의 것·리허설·기간 밖 — 같은 문장), 기간에 실제 방송 없음', async () => {
    const world = await newWorld({ clock: fakeClock(kst('2026-10-19', '19:00:00')) })
    const seller = await addSeller(world)
    const other = await addSeller(world)
    const { b1 } = await sellG202(world, seller)
    const theirs = await createBroadcast(world, other, { date: '2026-10-19' })
    const rehearsal = await createBroadcast(world, seller, { date: '2026-10-19', rehearsal: true })
    const api = client(world, seller.cookie)
    const error = async (path: string) => (await api.get(path)).body.error as { code: string; message: string }
    expect(await error('/api/ledger.xlsx?from=2026-10-19')).toMatchObject({ message: '날짜를 2026-10-19처럼 적어 주세요.' })
    expect(await error('/api/ledger.xlsx?from=2026-1-19&to=2026-10-19')).toMatchObject({ message: '날짜를 2026-10-19처럼 적어 주세요.' })
    expect(await error(ledgerUrl('2026-10-20', '2026-10-19'))).toMatchObject({ message: '시작 날짜가 끝 날짜보다 늦어요.' })
    expect(await error(ledgerUrl('2025-10-19', '2026-10-20'))).toMatchObject({ message: '기간은 366일까지 고를 수 있어요.' })
    // 366일(2025-10-19 ~ 2026-10-19, 둘 다 포함)은 된다
    expect((await getFile(world, seller.cookie, ledgerUrl('2025-10-19', '2026-10-19'))).status).toBe(200)
    for (const b of ['b_none', theirs.id, rehearsal.id]) {
      expect(await error(ledgerUrl('2026-10-19', '2026-10-19', [b]))).toEqual({ code: 'INVALID_INPUT', message: '고른 방송을 다시 확인해 주세요.', problems: [{ field: 'b', message: '고른 방송을 다시 확인해 주세요.' }] })
    }
    expect(await error(ledgerUrl('2026-10-20', '2026-10-21', [b1]))).toMatchObject({ message: '고른 방송을 다시 확인해 주세요.' })
    expect(await error(ledgerUrl('2026-10-20', '2026-10-21'))).toEqual({ code: 'NO_BROADCASTS', message: '고른 기간에 방송이 없어요.' })
    // 다른 판매자는 남의 방송이 있는지 알 수 없다 — 같은 문장
    expect((await client(world, other.cookie).get(ledgerUrl('2026-10-19', '2026-10-19', [b1]))).body.error).toMatchObject({ message: '고른 방송을 다시 확인해 주세요.' })
    expect((await client(world, null).get(ledgerUrl('2026-10-19', '2026-10-19'))).status).toBe(401)
  })

  it('성능: 31일(날짜마다 상품 500·확정 500) 대장 응답이 20초 안', async () => {
    const world = await newWorld({ clock: fakeClock(kst('2026-09-30', '09:00:00')) })
    const seller = await addSeller(world)
    for (let day = 1; day <= 31; day++) {
      const date = `2026-10-${String(day).padStart(2, '0')}`
      at(world, date, '10:00:00')
      const b = await createBroadcast(world, seller, { date })
      await world.server.writer.write({
        sellerId: seller.sellerId,
        date,
        rehearsal: false,
        createScope: false,
        requestId: null,
        build: () =>
          Array.from({ length: 500 }, (_, i) => [
            { fields: { type: 'product.register', b: b.id, no: i + 1, name: `품종${String(i % 40)}`, price: 1000 + i }, actor: { kind: 'server' } as const },
            { fields: { type: 'chat', b: b.id, id: `c${String(i)}`, ch: `UC_${String(i % 120)}`, nick: `구매자${String(i % 120)}`, text: String(i + 1) }, actor: { kind: 'collector' } as const, chat: { b: b.id, id: `c${String(i)}` } },
          ]).flat(),
      })
      world.server.writer.forget(seller.sellerId, date)
    }
    const started = performance.now()
    const file = await getFile(world, seller.cookie, ledgerUrl('2026-10-01', '2026-10-31'))
    const elapsed = performance.now() - started
    expect(file.status).toBe(200)
    expect(elapsed).toBeLessThan(20_000)
    expect((await readSheet(file.bytes)).length).toBe(1 + 31 * 500)
  }, 300_000)
})

describe('AC-I2-21 엑셀 글 칸 금지 글자 (서버 경로)', () => {
  it('닉네임·품종·방송 제목에 U+FFFE·줄바꿈·짝 없는 서로게이트가 있어도 파일이 만들어지고 그 글자만 빠진다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: '2026-10-19', title: '1\uFFFE부' })
    await ok(world, seller, { type: 'product.register', b: b.id, no: 1, name: '핑\uFFFE크', price: 1000 })
    await chat(world, seller, b.id, 'z1', 'UC_Z', '라\n울\uD800', '1')
    const rows = await readSheet((await getFile(world, seller.cookie, ledgerUrl('2026-10-19', '2026-10-19'))).bytes)
    expect(rows[1]?.slice(1, 6)).toEqual(['1부', '1', '핑크', '1000', '라울'])
  })
})

describe('AC-I2-33 판매대장 배송 칸 = 그 묶음의 포장·배송 상태 말', () => {
  async function shipped(world: TestServer, seller: Seller) {
    expect((await pack(world, seller, '2026-10-19', { buyer: 'UC_A', action: 'pack', items: [`${(await firstBroadcast(world, seller))}/1`] })).status).toBe(200)
  }
  async function firstBroadcast(world: TestServer, seller: Seller): Promise<string> {
    return ((await client(world, seller.cookie).get('/api/broadcasts')).body.broadcasts as { id: string }[])[0]?.id ?? ''
  }

  it('포장 완료·배송 완료(송장)·포장 다시 확인 — 확정 없는 행은 빈칸', async () => {
    const world = await newWorld({ clock: fakeClock(kst('2026-10-19', '19:00:00')) })
    const seller = await addSeller(world)
    const { b1 } = await sellG202(world, seller)
    await shipped(world, seller)
    expect((await pack(world, seller, '2026-10-19', { buyer: 'UC_D', action: 'pack', items: [`${b1}/2`] })).status).toBe(200)
    expect((await pack(world, seller, '2026-10-19', { buyer: 'UC_D', action: 'ship', invoice: '1234-5678-9012' })).status).toBe(200)
    expect((await pack(world, seller, '2026-10-19', { buyer: 'UC_B', action: 'pack', items: [`${b1}/1`, `${b1}/7`] })).status).toBe(200)
    // 꽃님(UC_B)의 7번을 취소 → 포장 다시 확인
    await ok(world, seller, { type: 'host.cancel', b: b1, no: 7, buyer: 'UC_B', reason: '취소' })
    const rows = await readSheet((await getFile(world, seller.cookie, ledgerUrl('2026-10-19', '2026-10-19'))).bytes)
    expect(rows.slice(1).map((row) => `${row[2] ?? ''} ${row[5] ?? ''} ${row[10] ?? ''}`)).toEqual([
      '1 홍길동 포장 완료',
      '1 꽃님 포장 다시 확인',
      '2 초록이 배송 완료 · 송장 123456789012',
      '3  ',
      '4  ',
      '5 새싹 포장 대기',
      '6 문자찜 / 끝자리 5432 포장 대기',
      '7  ',
      '8  ',
    ])
  })
})

describe('AC-I2-64 전체 판매대장 (실제 범위 전체 기간 — 366일 상한 없음)', () => {
  it('이름 라이브찜-판매대장-전체-<KST 오늘>.xlsx, 실제 범위가 없으면 파일 없이 "아직 판매 기록이 없어요."', async () => {
    const world = await newWorld({ clock: fakeClock(kst('2024-01-05', '09:00:00')) })
    const seller = await addSeller(world)
    const empty = await getFile(world, seller.cookie, '/api/export/ledger.xlsx')
    expect(empty.status).toBe(422)
    expect(empty.json?.error).toEqual({ code: 'NO_RECORDS', message: '아직 판매 기록이 없어요.' })
    at(world, '2024-01-05', '10:00:00')
    const first = await createBroadcast(world, seller, { date: '2024-01-05' })
    await ok(world, seller, { type: 'product.register', b: first.id, no: 1, name: '오래된', price: 1000 })
    world.clock.set(kst('2026-10-20', '09:00:00'))
    // 세션이 30일 넘게 지나 끝났다 — 다시 로그인
    const again = { ...seller, cookie: await login(world, seller.loginId, seller.password) }
    const recent = await createBroadcast(world, again, { date: '2026-10-20' })
    await ok(world, again, { type: 'product.register', b: recent.id, no: 2, name: '최근', price: 1000 })
    // KST 날짜: UTC 2026-10-20 15:30은 KST 10월 21일
    world.clock.set(Date.UTC(2026, 9, 20, 15, 30))
    const file = await getFile(world, again.cookie, '/api/export/ledger.xlsx')
    expect(file.status).toBe(200)
    expect(fileNameOf(file.headers)).toBe('라이브찜-판매대장-전체-2026-10-21.xlsx')
    expect((await readSheet(file.bytes)).slice(1).map((row) => row[3])).toEqual(['오래된', '최근'])
  })
})
