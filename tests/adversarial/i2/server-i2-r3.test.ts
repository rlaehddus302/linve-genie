// I2 적대 테스트 라운드 3 (test-domain): I2 마지막 감사 판정(D-I2-17·19·20·21)의 새 규칙을 공격한다.
// - D-I2-17 품종 제어 글자 NAME_CONTROL: 공백 정규화와의 경계(탭·줄바꿈·VT·FF·NBSP는 공백 → 한 칸, NEL·U+001C~001F·DEL·C1은 제어 글자),
//   검사 순서(번호·같은 번호·이미 있는 번호 다음, 휴대폰 번호·가격보다 먼저), 미리 보기를 건너뛰고 등록에 바로 보낸 제어 글자 품종
// - D-I2-19 포장 품목 = (상품 ID, 상품 키) 쌍: 두 상품의 번호를 맞바꾼 뒤(키 집합·ID 집합이 둘 다 같다), 바꿨다가 되돌린 번호,
//   다시 확인 상태에서 같은 키로 다시 포장 완료, 뺄 것의 품종(그 상품의 지금 품종), 백업 → 다른 서버 복구 뒤 상태
// - D-I2-20 합치기·떼어 내기 409: 순서대로(포장 완료·품목 없는 다시 확인·포장 취소 뒤·여러 단계 합치기), 동시 요청(포장 완료 ↔ 합치기, 배송 완료 ↔ 떼어 내기)
// - D-I2-21 칸이 모두 빈 줄: CSV(`,,`·`"",,`·공백만·넓은 빈 열)와 .xlsx 빈 행이 같은 결과, 머리글·500줄에 세지 않음, 닫히지 않은 따옴표 줄은 CELLS
import { randomIds } from '../../../apps/server/src/ids.ts'
import { checkBackupBytes, createBackupBytes, restoreSeller } from '../../../apps/server/src/backup.ts'
import { parseProductList, parseProductRows } from '../../../apps/server/src/product-import.ts'
import { crc32, deflateRawSync } from 'node:zlib'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { chat, ok, pack, post } from '../../../apps/server/test/i2-support.ts'
import { addSeller, client, createBroadcast, newWorld, rid, type JsonResponse, type Seller, type TestServer } from '../../../apps/server/test/support.ts'

const D = '2026-10-19'

type Row = { line: number; no?: number; name?: string; price?: number; error?: string; text?: string }

interface Item {
  key: string
  no: number
  name: string
  title: string
}
interface Entry {
  buyer: string
  status: string
  items: Item[]
  add: Item[]
  remove: { key: string; no: number; name?: string; title: string }[]
}

async function entries(world: TestServer, seller: Seller): Promise<Map<string, Entry>> {
  const response = await client(world, seller.cookie).get(`/api/days/${D}/packing`)
  expect(response.status, response.text).toBe(200)
  return new Map((response.body.entries as Entry[]).map((entry) => [entry.buyer, entry]))
}

async function packOk(promise: Promise<JsonResponse>): Promise<Entry> {
  const response = await promise
  expect(response.status, response.text).toBe(200)
  return response.body.entry as Entry
}

async function packingRows(world: TestServer, buyer: string): Promise<{ kind: string }[]> {
  const pglite = world.database.pglite
  if (pglite === null) throw new Error('PGlite 시험 DB가 아니에요')
  return (await pglite.query<{ kind: string }>('select kind from packing_records where buyer = $1 order by id', [buyer])).rows
}

async function seqOf(world: TestServer, seller: Seller): Promise<number> {
  return (await client(world, seller.cookie).get(`/api/days/${D}`)).body.seq as number
}

const errorOf = (response: JsonResponse) => response.body.error as { code?: string; message?: string } | undefined

const MERGE_BLOCKED = '포장이나 배송을 적은 구매자는 다른 구매자에 합칠 수 없어요. 포장 모드에서 먼저 취소해 주세요.'
const UNMERGE_BLOCKED = '배송을 적은 구매자에게서는 떼어 낼 수 없어요. 포장 모드에서 배송 완료를 먼저 취소해 주세요.'

// ── D-I2-17 품종 제어 글자 ───────────────────────────────────────────────

describe('D-I2-17 품종 제어 글자와 공백 정규화의 경계 (R-18 7·9)', () => {
  const one = (name: string, extra: { no?: string; price?: string; existing?: number[] } = {}) => {
    const result = parseProductList(`${extra.no ?? '1'},${name},${extra.price ?? '15000'}`, { existing: extra.existing ?? [] })
    if (!('rows' in result)) throw new Error(JSON.stringify(result))
    return result.rows[0]
  }

  it('공백인 제어 글자(VT·FF)·NBSP·U+3000은 정규화로 한 칸 공백 → 등록할 줄. 공백이 아닌 제어 글자(NEL·U+001C~001F·DEL·U+0080~009F·NUL)는 NAME_CONTROL', () => {
    expect(one('핑크\u000B프릴')).toEqual({ line: 1, no: 1, name: '핑크 프릴', price: 15000 })
    expect(one('핑크\u000C\u000B 프릴')).toEqual({ line: 1, no: 1, name: '핑크 프릴', price: 15000 })
    expect(one('핑크 프릴')).toEqual({ line: 1, no: 1, name: '핑크 프릴', price: 15000 })
    expect(one('　핑크프릴　')).toEqual({ line: 1, no: 1, name: '핑크프릴', price: 15000 })
    // 범위 바로 바깥: U+007E '~'·U+00A1 '¡'는 보이는 글자, U+200B(서식 글자 Cf)는 R-18 7 범위 밖 — 그대로
    expect(one('핑크~프릴')).toMatchObject({ name: '핑크~프릴' })
    expect(one('핑크¡')).toMatchObject({ name: '핑크¡' })
    expect(one('핑크​프릴')).toMatchObject({ name: '핑크​프릴' })
    // JavaScript \s가 아닌 제어 글자 — 정규화 뒤에도 남는다
    for (const control of ['\u0085', '\u001C', '\u001D', '\u001E', '\u001F', '\u007F', '\u0080', '\u009F', '\u0000', '\u0001', '\u0008', '\u001B']) {
      expect(one(`핑크${control}프릴`), `U+${control.charCodeAt(0).toString(16).padStart(4, '0')}`).toEqual({ line: 1, error: 'NAME_CONTROL' })
    }
    // 제어 글자만 있는 품종은 "품종 미입력"이 아니다
    expect(one('\u0001')).toEqual({ line: 1, error: 'NAME_CONTROL' })
    expect(one(' \u007F ')).toEqual({ line: 1, error: 'NAME_CONTROL' })
  })

  it('검사 순서: 칸 → 번호 → 같은 번호 → 이미 있는 번호 → 품종(제어 글자 → 휴대폰 번호) → 가격', () => {
    expect(one('010-1234-5678\u0001')).toEqual({ line: 1, error: 'NAME_CONTROL' })
    expect(one('김영희 010 1234 5678 \u0085')).toEqual({ line: 1, error: 'NAME_CONTROL' })
    expect(one('핑크\u0001', { price: '' })).toEqual({ line: 1, error: 'NAME_CONTROL' })
    expect(one('핑크\u0001', { price: '만원쯤' })).toEqual({ line: 1, error: 'NAME_CONTROL' })
    expect(one('핑크\u0001', { price: '0' })).toEqual({ line: 1, error: 'NAME_CONTROL' })
    expect(one('핑크\u0001', { no: '0' })).toEqual({ line: 1, error: 'NUMBER_INVALID' })
    expect(one('핑크\u0001', { existing: [1] })).toEqual({ line: 1, error: 'EXISTS' })
    const dup = parseProductList('3,핑크\u0001,1000\n3,라울,2000')
    expect(dup).toEqual({ header: null, rows: [{ line: 1, error: 'DUPLICATE' }, { line: 2, error: 'DUPLICATE' }] })
    // 제어 글자가 품종이 아닌 칸에 있으면 그 칸의 규칙대로
    expect(one('핑크', { no: '1\u0001' })).toEqual({ line: 1, error: 'NUMBER_INVALID' })
  })

  it('.xlsx 칸 안의 줄바꿈(Alt+Enter)·탭은 공백 → 등록할 줄(제어 글자로 거절하지 않는다), 붙여 넣은 글·CSV·.xlsx가 같은 판단', () => {
    const rows = parseProductRows(
      [
        { line: 1, cells: ['1', '핑크\n프릴', '1000'] },
        { line: 2, cells: ['2', '핑크\r\n\t프릴', '1000'] },
        { line: 3, cells: ['3', '핑크\u0085프릴', '1000'] },
        { line: 4, cells: ['4', '\u0001', '1000'] },
      ],
      {},
    )
    expect(rows).toEqual({
      header: null,
      rows: [
        { line: 1, no: 1, name: '핑크 프릴', price: 1000 },
        { line: 2, no: 2, name: '핑크 프릴', price: 1000 },
        { line: 3, error: 'NAME_CONTROL' },
        { line: 4, error: 'NAME_CONTROL' },
      ],
    })
    // CSV 따옴표 칸 안의 쉼표는 글자, 제어 글자는 그대로 NAME_CONTROL
    expect(parseProductList('1,"핑크,\u001F프릴",1000')).toEqual({ header: null, rows: [{ line: 1, error: 'NAME_CONTROL' }] })
  })

  it('미리 보기를 건너뛰고 등록에 제어 글자 품종을 바로 보내면 아무것도 등록하지 않는다 (NEL·U+001F — 정규화로는 바뀌지 않아 "정규화한 글" 검사만으로는 통과한다)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = (await createBroadcast(world, seller, { date: D })).id
    for (const name of ['핑크\u0085프릴', '핑크\u001F', '\u0000', '라울\u009F']) {
      const sent = await post(world, seller, `/api/broadcasts/${b}/import`, { requestId: rid('imp'), rows: [{ no: 1, name, price: 15000 }] })
      expect(sent.status, `${JSON.stringify(name)} → ${sent.text.slice(0, 200)}`).not.toBe(200)
      expect([400, 409]).toContain(sent.status)
    }
    // 1번이 등록되지 않았다 — 깨끗한 이름으로 같은 번호를 등록할 수 있다
    const clean = await post(world, seller, `/api/broadcasts/${b}/import`, { requestId: rid('imp'), rows: [{ no: 1, name: '핑크프릴', price: 15000 }] })
    expect(clean.status, clean.text).toBe(200)
    expect(clean.body.registered).toBe(1)
  })

  it('UTF-8 CSV 파일의 NEL(C2 85)·DEL은 미리 보기에서 NAME_CONTROL, 같은 파일의 깨끗한 줄은 등록할 줄', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = (await createBroadcast(world, seller, { date: D })).id
    const file = Buffer.from('번호,품종,가격\r\n1,핑크\u0085프릴,15000\r\n2,라울\u007F,8000\r\n3,방울복랑 금,12000\r\n', 'utf8')
    const preview = await post(world, seller, `/api/broadcasts/${b}/import/preview`, { file: { name: '목록.csv', data: file.toString('base64') } })
    expect(preview.status, preview.text).toBe(200)
    expect([preview.body.register, preview.body.problems]).toEqual([1, 2])
    expect((preview.body.rows as Row[]).map(({ line, error, name }) => ({ line, error, name }))).toEqual([
      { line: 2, error: 'NAME_CONTROL', name: undefined },
      { line: 3, error: 'NAME_CONTROL', name: undefined },
      { line: 4, error: undefined, name: '방울복랑 금' },
    ])
  })
})

// ── D-I2-19 포장 품목 = (상품 ID, 상품 키) ────────────────────────────────

describe('D-I2-19 포장 품목 = (상품 ID, 상품 키) 쌍', () => {
  async function packedNineTen() {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = (await createBroadcast(world, seller, { date: D })).id
    const key = (no: number) => `${b}/${String(no)}`
    await ok(world, seller, { type: 'product.register', b, no: 9, name: '핑크프릴', price: 9000 })
    await ok(world, seller, { type: 'product.register', b, no: 10, name: '라울', price: 10000 })
    await chat(world, seller, b, 'd9', 'UC_D', '다육집사', '9')
    await chat(world, seller, b, 'd10', 'UC_D', '다육집사', '10')
    expect((await packOk(pack(world, seller, D, { buyer: 'UC_D', action: 'pack', items: [key(9), key(10)] }))).status).toBe('포장 완료')
    return { world, seller, b, key }
  }

  it('두 상품의 번호를 맞바꾸고 같은 구매자에게 다시 배정: 키 집합도 ID 집합도 포장 때와 같지만 쌍이 달라 "포장 다시 확인"', async () => {
    const { world, seller, b, key } = await packedNineTen()
    // 9(핑크프릴) ↔ 10(라울): 9→99, 10→9, 99→10
    await ok(world, seller, { type: 'product.renumber', b, from: 9, to: 99 })
    await ok(world, seller, { type: 'product.renumber', b, from: 10, to: 9 })
    await ok(world, seller, { type: 'product.renumber', b, from: 99, to: 10 })
    await ok(world, seller, { type: 'host.assign', b, no: 9, buyer: 'UC_D', reason: '번호 바꾼 뒤 다시 배정' })
    await ok(world, seller, { type: 'host.assign', b, no: 10, buyer: 'UC_D', reason: '번호 바꾼 뒤 다시 배정' })
    const d = (await entries(world, seller)).get('UC_D') as Entry
    expect(d.items.map((item) => [item.no, item.name])).toEqual([
      [9, '라울'],
      [10, '핑크프릴'],
    ])
    // 상자에는 9번 라벨에 핑크프릴, 10번 라벨에 라울이 들어 있다 — 화면 번호와 다르다
    expect(d.status).toBe('포장 다시 확인')
    expect(d.add.map((item) => [item.key, item.name])).toEqual([
      [key(9), '라울'],
      [key(10), '핑크프릴'],
    ])
    // 뺄 것 = 포장 때 번호, 그 상품의 지금 품종
    expect(d.remove.map((item) => [item.key, item.no, item.name])).toEqual([
      [key(9), 9, '핑크프릴'],
      [key(10), 10, '라울'],
    ])
    // 판매자가 다시 확인하고 같은 키로 포장 완료 → 새 기록, "포장 완료"
    expect((await packOk(pack(world, seller, D, { buyer: 'UC_D', action: 'pack', items: [key(9), key(10)] }))).status).toBe('포장 완료')
    expect((await packingRows(world, 'UC_D')).map((row) => row.kind)).toEqual(['PACKED', 'PACKED'])
  })

  it('번호를 바꿨다가 되돌리고 다시 배정: 쌍이 포장 때와 같아 "포장 완료" (상품 ID는 번호 변경에도 그대로)', async () => {
    const { world, seller, b } = await packedNineTen()
    await ok(world, seller, { type: 'product.renumber', b, from: 9, to: 90 })
    expect((await entries(world, seller)).get('UC_D')?.status).toBe('포장 다시 확인')
    await ok(world, seller, { type: 'product.renumber', b, from: 90, to: 9 })
    await ok(world, seller, { type: 'host.assign', b, no: 9, buyer: 'UC_D', reason: '다시 배정' })
    const d = (await entries(world, seller)).get('UC_D') as Entry
    expect([d.status, d.add, d.remove]).toEqual(['포장 완료', [], []])
  })

  it('빈 번호에 다른 상품: 같은 키로 다시 포장 완료하면 새 기록(이미 그 상태라며 건너뛰지 않는다), 그다음 같은 명령은 기록 없이 성공', async () => {
    const { world, seller, b, key } = await packedNineTen()
    await ok(world, seller, { type: 'product.renumber', b, from: 9, to: 90 })
    await ok(world, seller, { type: 'product.register', b, no: 9, name: '방울복랑', price: 7000 })
    await ok(world, seller, { type: 'host.assign', b, no: 9, buyer: 'UC_D', reason: '새 상품 배정' })
    let d = (await entries(world, seller)).get('UC_D') as Entry
    expect(d.status).toBe('포장 다시 확인')
    expect(d.add.map((item) => [item.no, item.name])).toEqual([[9, '방울복랑']])
    expect(d.remove.map((item) => [item.no, item.name])).toEqual([[9, '핑크프릴']])
    // 옛 상품(지금 90번)의 품종을 바꾸면 뺄 것도 그 상품의 지금 품종
    await ok(world, seller, { type: 'product.update', b, no: 90, name: '핑크프릴 대품', applyTo: 'NEW_ONLY' })
    d = (await entries(world, seller)).get('UC_D') as Entry
    expect(d.remove.map((item) => [item.no, item.name])).toEqual([[9, '핑크프릴 대품']])
    // 보낸 키 집합 {9, 10}은 포장 기록 P의 키와 같다 — 그래도 지금 상태가 다시 확인이므로 새로 적어야 한다
    expect((await packOk(pack(world, seller, D, { buyer: 'UC_D', action: 'pack', items: [key(9), key(10)] }))).status).toBe('포장 완료')
    expect((await packingRows(world, 'UC_D')).length).toBe(2)
    expect((await packOk(pack(world, seller, D, { buyer: 'UC_D', action: 'pack', items: [key(10), key(9)] }))).status).toBe('포장 완료')
    expect((await packingRows(world, 'UC_D')).length).toBe(2)
  })

  it('백업 → 검사 → 다른 서버로 복구: 상품 ID가 재생으로 같은 값이라 포장 완료·다시 확인이 그대로', async () => {
    const { world, seller, b } = await packedNineTen()
    // UC_E: 바뀐 상품으로 다시 확인 상태
    await ok(world, seller, { type: 'product.register', b, no: 5, name: '블루엘프', price: 5000 })
    await chat(world, seller, b, 'e5', 'UC_E', '초록손', '5')
    await packOk(pack(world, seller, D, { buyer: 'UC_E', action: 'pack', items: [`${b}/5`] }))
    await ok(world, seller, { type: 'product.renumber', b, from: 5, to: 50 })
    await ok(world, seller, { type: 'product.register', b, no: 5, name: '라울 금', price: 6000 })
    await ok(world, seller, { type: 'host.assign', b, no: 5, buyer: 'UC_E', reason: '새 상품 배정' })
    const before = await entries(world, seller)
    expect([before.get('UC_D')?.status, before.get('UC_E')?.status]).toEqual(['포장 완료', '포장 다시 확인'])
    const bytes = await createBackupBytes(world.database.db, seller.sellerId, world.clock.now())
    const checked = await checkBackupBytes(bytes)
    expect(checked.ok, checked.ok ? '' : checked.reason).toBe(true)
    const other = await newWorld({ clock: world.clock })
    const target = await addSeller(other)
    const restored = await restoreSeller({ db: other.database.db, sellerId: target.sellerId, bytes, replace: false, storage: null, clock: other.clock, ids: randomIds })
    expect(restored.ok, restored.ok ? '' : restored.reason).toBe(true)
    const after = await entries(other, target)
    const view = (map: Map<string, Entry>) => [...map.values()].map(({ buyer, status, add, remove }) => ({ buyer, status, add: add.map((i) => [i.key, i.name]), remove: remove.map((i) => [i.key, i.name]) }))
    expect(view(after)).toEqual(view(before))
  })
})

// ── D-I2-20 합치기·떼어 내기 제한 ─────────────────────────────────────────

describe('D-I2-20 포장·배송을 적은 구매자의 합치기·떼어 내기 (409)', () => {
  async function shop(buyers: string[]) {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = (await createBroadcast(world, seller, { date: D })).id
    const key = (no: number) => `${b}/${String(no)}`
    for (const [i, buyer] of buyers.entries()) {
      const no = i + 1
      await ok(world, seller, { type: 'product.register', b, no, name: `품종${String(no)}`, price: 1000 * no })
      await chat(world, seller, b, `m${String(no)}`, buyer, `손님${String(no)}`, String(no))
    }
    return { world, seller, b, key, noOf: (buyer: string) => buyers.indexOf(buyer) + 1 }
  }
  const merge = (world: TestServer, seller: Seller, from: string, into: string) => post(world, seller, `/api/events?date=${D}`, { requestId: rid('mg'), type: 'buyer.merge', from, into, reason: '같은 사람' })
  const unmerge = (world: TestServer, seller: Seller, from: string) => post(world, seller, `/api/events?date=${D}`, { requestId: rid('um'), type: 'buyer.unmerge', from, reason: '다른 사람' })

  it('품목이 모두 빠진 "포장 다시 확인"도 합치지 않는다 — 409·로그 그대로, 포장 취소로 대기가 되면 합칠 수 있다', async () => {
    const { world, seller, b, key } = await shop(['UC_X', 'UC_Y'])
    await packOk(pack(world, seller, D, { buyer: 'UC_X', action: 'pack', items: [key(1)] }))
    await ok(world, seller, { type: 'host.cancel', b, no: 1, buyer: 'UC_X', reason: '구매자 요청' })
    expect((await entries(world, seller)).get('UC_X')?.status).toBe('포장 다시 확인')
    const seq = await seqOf(world, seller)
    const blocked = await merge(world, seller, 'UC_X', 'UC_Y')
    expect([blocked.status, errorOf(blocked)?.message]).toEqual([409, MERGE_BLOCKED])
    expect(await seqOf(world, seller)).toBe(seq)
    expect((await entries(world, seller)).has('UC_X')).toBe(true)
    await packOk(pack(world, seller, D, { buyer: 'UC_X', action: 'unpack' }))
    const merged = await merge(world, seller, 'UC_X', 'UC_Y')
    expect(merged.status, merged.text).toBe(200)
  })

  it('여러 단계로 합친 구매자: Z → X → Y이고 Y가 배송 완료면 Z를 떼어 내는 것도 409 (바로 위 X가 아니라 지금의 구매자 Y의 상태를 본다)', async () => {
    const { world, seller, key } = await shop(['UC_Z', 'UC_X', 'UC_Y'])
    expect((await merge(world, seller, 'UC_Z', 'UC_X')).status).toBe(200)
    expect((await merge(world, seller, 'UC_X', 'UC_Y')).status).toBe(200)
    const y = (await entries(world, seller)).get('UC_Y') as Entry
    expect(y.items.map((item) => item.key)).toEqual([key(1), key(2), key(3)])
    await packOk(pack(world, seller, D, { buyer: 'UC_Y', action: 'pack', items: [key(1), key(2), key(3)] }))
    await packOk(pack(world, seller, D, { buyer: 'UC_Y', action: 'ship', invoice: '123456789012' }))
    const seq = await seqOf(world, seller)
    for (const from of ['UC_Z', 'UC_X']) {
      const blocked = await unmerge(world, seller, from)
      expect([from, blocked.status, errorOf(blocked)?.message]).toEqual([from, 409, UNMERGE_BLOCKED])
    }
    expect(await seqOf(world, seller)).toBe(seq)
    expect((await entries(world, seller)).get('UC_Y')?.status).toBe('배송 완료')
  })

  it('배송한 Y에 합치기는 되고(→ 배송 뒤 바뀜), 그 상태에서 떼어 내기는 409, 배송 취소 뒤에는 떼어 낼 수 있다', async () => {
    const { world, seller, key } = await shop(['UC_X', 'UC_Y'])
    await packOk(pack(world, seller, D, { buyer: 'UC_Y', action: 'pack', items: [key(2)] }))
    await packOk(pack(world, seller, D, { buyer: 'UC_Y', action: 'ship' }))
    expect((await merge(world, seller, 'UC_X', 'UC_Y')).status).toBe(200)
    expect((await entries(world, seller)).get('UC_Y')?.status).toBe('배송 뒤 바뀜')
    const blocked = await unmerge(world, seller, 'UC_X')
    expect([blocked.status, errorOf(blocked)?.message]).toEqual([409, UNMERGE_BLOCKED])
    await packOk(pack(world, seller, D, { buyer: 'UC_Y', action: 'unship' }))
    const done = await unmerge(world, seller, 'UC_X')
    expect(done.status, done.text).toBe(200)
  })

  it('동시 요청: X 포장 완료와 X를 Y에 합치기를 함께 보내도 "X 포장 완료 기록 + X가 합쳐짐"이 함께 남지 않는다 (12번)', async () => {
    const xs = Array.from({ length: 12 }, (_, i) => `UC_X${String(i)}`)
    const { world, seller, key, noOf } = await shop([...xs, 'UC_Y'])
    for (const x of xs) {
      const [packed, merged] = await Promise.all([pack(world, seller, D, { buyer: x, action: 'pack', items: [key(noOf(x))] }), merge(world, seller, x, 'UC_Y')])
      const list = await entries(world, seller)
      const isMerged = !list.has(x)
      const records = (await packingRows(world, x)).filter((row) => row.kind === 'PACKED').length
      expect({ x, both: records > 0 && isMerged }, `포장 ${String(packed.status)} · 합치기 ${String(merged.status)}`).toEqual({ x, both: false })
      expect([packed.status, merged.status].filter((status) => status === 200).length, `${x}: 둘 중 하나만 된다`).toBe(1)
      if (merged.status !== 200) expect(errorOf(merged)?.message).toBe(MERGE_BLOCKED)
    }
  }, 120_000)

  it('동시 요청: Y 배송 완료와 Y에서 X 떼어 내기를 함께 보내도 "Y 배송 완료 + X 떼어 냄(배송한 품목이 다른 묶음으로 빠짐)"이 함께 남지 않는다 (12번)', async () => {
    const pairs = Array.from({ length: 12 }, (_, i) => [`UC_X${String(i)}`, `UC_Y${String(i)}`] as const)
    const { world, seller, key, noOf } = await shop(pairs.flat())
    for (const [x, y] of pairs) {
      expect((await merge(world, seller, x, y)).status).toBe(200)
      await packOk(pack(world, seller, D, { buyer: y, action: 'pack', items: [key(noOf(x)), key(noOf(y))] }))
      const [shipped, split] = await Promise.all([pack(world, seller, D, { buyer: y, action: 'ship' }), unmerge(world, seller, x)])
      const list = await entries(world, seller)
      const isSplit = list.has(x)
      const shippedRecord = (await packingRows(world, y)).some((row) => row.kind === 'SHIPPED')
      // 떼어 낸 뒤 배송 완료를 적었다면 Y의 상태는 "배송 뒤 바뀜"이어야 하는데, 배송 완료는 "포장 완료"에서만 받는다
      expect({ y, both: shippedRecord && isSplit && list.get(y)?.status === '배송 완료' }, `배송 ${String(shipped.status)} · 떼어 내기 ${String(split.status)}`).toEqual({ y, both: false })
      expect([shipped.status, split.status].filter((status) => status === 200).length, `${y}: 둘 중 하나만 된다`).toBe(1)
    }
  }, 120_000)
})

// ── D-I2-21 칸이 모두 빈 줄 ───────────────────────────────────────────────

function zip(entries: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const body = deflateRawSync(entry.data)
    const crc = crc32(entry.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, name, body)
    centrals.push(central, name)
    offset += local.length + name.length + body.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

const xmlText = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const column = (index: number) => String.fromCharCode(65 + index)

/** 행마다 칸 글 목록 → .xlsx (줄 번호 = 행 번호, 빈 칸 글 ''은 칸을 적지 않는다 — 엑셀이 빈 칸을 적지 않는 것과 같다) */
function sheet(rows: string[][]): Buffer {
  const rowXml = rows
    .map((cells, r) => {
      const written = cells.flatMap((value, c) => (value === '' ? [] : [`<c r="${column(c)}${String(r + 1)}" t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`]))
      return written.length === 0 ? '' : `<row r="${String(r + 1)}">${written.join('')}</row>`
    })
    .join('')
  return zip([
    { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>') },
    { name: '_rels/.rels', data: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') },
    { name: 'xl/workbook.xml', data: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="목록" sheetId="1" r:id="rId1"/></sheets></workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`) },
  ])
}

describe('D-I2-21 칸이 모두 빈 줄 — CSV와 .xlsx가 같은 결과 (R-18 1)', () => {
  const previewFile = (world: TestServer, seller: Seller, b: string, name: string, bytes: Buffer) => post(world, seller, `/api/broadcasts/${b}/import/preview`, { file: { name, data: bytes.toString('base64') } })
  const shape = (body: Record<string, unknown>) => ({
    error: body.error,
    header: body.header,
    register: body.register,
    problems: body.problems,
    rows: (body.rows as Row[]).map(({ text: _text, ...rest }) => rest),
  })

  it('엑셀 빈 행을 CSV로 저장한 줄(,,·"",,·공백만·넓은 빈 열)과 .xlsx 빈 행: 머리글 앞뒤·상품 사이 어디에 있어도 같은 미리 보기', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = (await createBroadcast(world, seller, { date: D })).id
    // [CSV 줄, .xlsx 행의 칸]
    const table: [string, string[]][] = [
      [',,', ['', '', '']],
      ['"",,', ['', '', '']],
      ['번호,품종,가격', ['번호', '품종', '가격']],
      ['  ,  ,  ', [' ', ' ', ' ']],
      ['1,핑크프릴,15000', ['1', '핑크프릴', '15000']],
      [',,,,,,', ['', '', '', '', '', '']],
      ['"","",""', ['', '', '']],
      ['2,라울,8000', ['2', '라울', '8000']],
      ['　, ,', ['　', ' ', '']],
      ['3,,9000', ['3', '', '9000']],
      [',방울복랑,1000', ['', '방울복랑', '1000']],
      ['4,블루엘프,0', ['4', '블루엘프', '0']],
      ['', []],
    ]
    const csv = Buffer.from(table.map(([line]) => line).join('\r\n'), 'utf8')
    const book = sheet(table.map(([, cells]) => cells))
    const fromCsv = await previewFile(world, seller, b, '목록.csv', csv)
    const fromXlsx = await previewFile(world, seller, b, '목록.xlsx', book)
    expect(fromCsv.status, fromCsv.text).toBe(200)
    expect(fromXlsx.status, fromXlsx.text).toBe(200)
    expect(shape(fromCsv.body)).toEqual({
      error: null,
      header: 3,
      register: 3,
      problems: 2,
      rows: [
        { line: 5, no: 1, name: '핑크프릴', price: 15000 },
        { line: 8, no: 2, name: '라울', price: 8000 },
        { line: 10, no: 3, name: '', price: 9000 },
        { line: 11, error: 'NUMBER_INVALID' },
        { line: 12, error: 'PRICE_TOO_LOW' },
      ],
    })
    expect(shape(fromXlsx.body)).toEqual(shape(fromCsv.body))
  })

  it('빈 줄은 500줄에 세지 않는다: 상품 500줄 사이사이 빈 줄 300개 → TOO_MANY가 아니라 500개 등록할 줄 (CSV·.xlsx 같다)', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = (await createBroadcast(world, seller, { date: D })).id
    const csvLines: string[] = ['번호,품종,가격']
    const rows: string[][] = [['번호', '품종', '가격']]
    for (let i = 1; i <= 500; i++) {
      csvLines.push(`${String(i)},핑크${String(i)},1000`)
      rows.push([String(i), `핑크${String(i)}`, '1000'])
      if (i % 5 === 0 || i % 5 === 2 || i % 5 === 4) {
        csvLines.push(i % 2 === 0 ? ',,' : '"",,')
        rows.push(['', '', ''])
      }
    }
    expect(csvLines.length - 501).toBe(300)
    const fromCsv = await previewFile(world, seller, b, '목록.csv', Buffer.from(csvLines.join('\n'), 'utf8'))
    const fromXlsx = await previewFile(world, seller, b, '목록.xlsx', sheet(rows))
    expect(fromCsv.status, fromCsv.text.slice(0, 200)).toBe(200)
    expect([fromCsv.body.error, fromCsv.body.register, fromCsv.body.problems]).toEqual([null, 500, 0])
    expect(shape(fromXlsx.body)).toEqual(shape(fromCsv.body))
  }, 60_000)

  it('TD-I2-010: 가격 칸만 비운 행 — 엑셀이 저장한 CSV("5,라울,")는 PRICE_MISSING인데 같은 행의 .xlsx는 칸 둘(CELLS)이 되면 안 된다 (AC-I2-50 "같은 행은 같은 결과")', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = (await createBroadcast(world, seller, { date: D })).id
    // 엑셀은 값이 없는 칸을 시트 파일에 적지 않는다 — 행 5의 C칸(가격)이 없다. 같은 시트를 CSV로 저장하면 "5,라울,"이다
    const table: [string, string[]][] = [
      ['번호,품종,가격', ['번호', '품종', '가격']],
      ['5,라울,', ['5', '라울', '']],
      ['6,,', ['6', '', '']],
    ]
    const fromCsv = await previewFile(world, seller, b, '목록.csv', Buffer.from(table.map(([line]) => line).join('\r\n'), 'utf8'))
    const fromXlsx = await previewFile(world, seller, b, '목록.xlsx', sheet(table.map(([, cells]) => cells)))
    expect(shape(fromCsv.body).rows).toEqual([
      { line: 2, error: 'PRICE_MISSING' },
      { line: 3, error: 'PRICE_MISSING' },
    ])
    // 지금: .xlsx 행 2는 ['5', '라울'], 행 3은 ['6'] — 칸 수가 맞지 않는다(CELLS)로 보인다. 판매자는 가격을 적으면 되는데 칸을 고치려 한다
    expect(shape(fromXlsx.body)).toEqual(shape(fromCsv.body))
  })

  it('닫히지 않은 따옴표 줄(",,)은 빈 줄이 아니다 — CELLS이고 500줄에 센다(500 + 1 → TOO_MANY), 머리글로 보지 않는다', () => {
    const products = Array.from({ length: 500 }, (_, i) => `${String(i + 1)},핑크,1000`)
    expect(parseProductList([...products, '",,'].join('\n'))).toEqual({ error: 'TOO_MANY' })
    expect(parseProductList([...products, ',,', '"",,', ' , , '].join('\n'))).toMatchObject({ header: null })
    expect(parseProductList('",,\n1,핑크,1000')).toEqual({ header: null, rows: [{ line: 1, error: 'CELLS' }, { line: 2, no: 1, name: '핑크', price: 1000 }] })
    expect(parseProductList('"",,"\n1,핑크,1000')).toEqual({ header: null, rows: [{ line: 1, error: 'CELLS' }, { line: 2, no: 1, name: '핑크', price: 1000 }] })
    // 빈 줄만 있으면 상품 줄이 없다
    expect(parseProductList(',,\n"",,\n , , ')).toEqual({ error: 'EMPTY' })
    expect(parseProductList('번호,품종,가격\n,,\n"","",""')).toEqual({ error: 'EMPTY' })
  })

  it('속성: 아무 표에 빈 행(여러 모양)·제어 글자 품종을 끼워도 탭 글·CSV·.xlsx 행 입구가 같은 결과', () => {
    const cell = fc.oneof(
      fc.constantFrom('', ' ', '15', '015번', '7 번', '핑크프릴', '1만5천', '10000', '8.5', '0', '번호', '가격', '010-1234-5678', '１５', '​', '　', '50원', '3', '핑크\u0001', '\u0085', '라울\u007F', ' '),
      fc.string({ maxLength: 6 }).filter((s) => !/[\t\r\n",]/.test(s)),
    )
    const blank = fc.constantFrom<[string, string, string[]]>(
      ['', '', []],
      ['\t\t', ',,', ['', '', '']],
      [' \t \t ', '"",,', [' ', '', '']],
      ['　\t\t', ' , , ', ['　', ' ', '']],
      ['\t\t\t\t', ',,,,,', ['', '', '', '', '']],
    )
    const line = fc.oneof(
      { weight: 3, arbitrary: fc.array(cell, { minLength: 2, maxLength: 5 }).map((cells): [string, string, string[]] => [cells.join('\t'), cells.join(','), cells]) },
      { weight: 1, arbitrary: blank },
    )
    fc.assert(
      fc.property(fc.array(line, { minLength: 1, maxLength: 10 }), fc.constantFrom('WON', 'THOUSAND'), (table, unit) => {
        const settings = { unit, existing: [3] }
        const tab = parseProductList(table.map(([t]) => t).join('\n'), settings)
        const csv = parseProductList(table.map(([, c]) => c).join('\r\n'), settings)
        const rows = parseProductRows(
          table.map(([, , cells], index) => ({ line: index + 1, cells })),
          settings,
        )
        expect(csv).toEqual(tab)
        expect(rows).toEqual(tab)
      }),
      { numRuns: 2000 },
    )
  })
})
