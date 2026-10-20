// I2 적대 테스트 라운드 1 (test-domain): 수정 라운드 1(본문 상한·워커·백업 형식 2)과 남은 지적을 다시 공격한다.
// - TD-I2-004: 계정 만들 때 받은 가게 이름(31~50글자)으로는 가게 설정을 저장하지 못한다 — GET /api/shop 값을 그대로 PUT해도 거절
// - TD-I2-007: 미리 보기가 받은 .csv(2MB 안, EUC-KR)의 등록할 줄을 그대로 등록에 보내면 본문 상한(3MB)에 걸린다 — .xlsx·붙여 넣은 글에는 있는 200,000글자 상한이 .csv·.txt 파일에는 없다
// - TD-I2-008: 한 판매자의 전체 판매대장(엑셀)이 날짜마다 범위 상태를 서버 공용 캐시(상한 128)에 넣어, 방송 중인 다른 판매자의 범위 상태를 밀어낸다
// - 회귀: 따옴표·역슬래시·이모지·줄 구분 글자(U+2028)·EUC-KR에 없는 글자가 든 채팅·문자 메모·가게 설정의 백업 → 검사 → 다른 서버로 복구가 같다
import { randomIds } from '../../../apps/server/src/ids.ts'
import { createSellerAccount } from '../../../apps/server/src/accounts.ts'
import { checkBackupBytes, createBackupBytes, restoreSeller } from '../../../apps/server/src/backup.ts'
import { checkReplay } from '../../../apps/server/src/check-replay.ts'
import { describe, expect, it } from 'vitest'
import { chat, ok, pack, post, putShop } from '../../../apps/server/test/i2-support.ts'
import { FAST_COST, ORIGIN, addSeller, client, createBroadcast, login, newWorld, rid } from '../../../apps/server/test/support.ts'

const D = '2026-10-19'

describe('TD-I2-004 계정의 가게 이름 상한(50자)과 가게 설정 상한(30글자)', () => {
  it('운영자가 31글자 이상 이름으로 만든 판매자도 설정 화면에서 계좌만 적어 저장할 수 있다 (GET /api/shop 값 그대로 + 계좌)', async () => {
    const world = await newWorld()
    // 계정 만들기 명령은 50자까지 받는다 (accounts.ts NAME_MAX)
    const shopName = '초록다육 다육이 전문 농장 직영 라이브 판매 공식 가게 본점'
    expect([...shopName].length).toBeGreaterThan(30)
    expect(shopName.length).toBeLessThanOrEqual(50)
    const created = await createSellerAccount(world.database.db, Buffer.from(world.masterKey, 'base64'), { shopName, loginId: 'longname', password: 'correct-horse-1' }, { passwordCost: FAST_COST })
    expect(created.ok).toBe(true)
    const cookie = await login(world, 'longname', 'correct-horse-1')
    const api = client(world, cookie)
    const shop = await api.get('/api/shop')
    expect(shop.status).toBe(200)
    const current = (shop.body.shop ?? shop.body) as Record<string, string>
    expect(current.name).toBe(shopName)
    const saved = await world.server.app.request('/api/shop', {
      method: 'PUT',
      headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...current, bank: '농협', accountNumber: '302-9988-7766-11', accountHolder: '김판매' }),
    })
    // 판매자는 이름을 고치지 않았다 — 계좌만 적었는데 "가게 이름은 1~30글자로 적어 주세요."로 거절되면 안 된다
    expect(saved.status, await saved.clone().text()).toBe(200)
  })
})

/** '가'(EUC-KR B0 A1)를 n번 */
const eucKrGa = (n: number): Buffer => Buffer.alloc(n * 2, Buffer.from([0xb0, 0xa1]))

describe('TD-I2-007 .csv 파일(EUC-KR) — 미리 보기가 받은 목록은 등록된다', () => {
  it('2MB 안의 EUC-KR CSV 500줄: 미리 보기 "500개 등록하기" → 같은 줄 등록이 본문 상한(3MB)에 걸리지 않는다', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    const b = (await createBroadcast(world, seller, { date: D })).id
    // 한국어 윈도우 엑셀 CSV(EUC-KR): 한 글자 2바이트 → 등록 본문(JSON·UTF-8)에서는 3바이트
    const name = eucKrGa(2090)
    const lines: Buffer[] = []
    for (let i = 1; i <= 500; i++) lines.push(Buffer.concat([Buffer.from(`${String(i)},`), name, Buffer.from(',15000\r\n')]))
    const file = Buffer.concat(lines)
    expect(file.byteLength).toBeLessThanOrEqual(2 * 1024 * 1024)
    const preview = await post(world, seller, `/api/broadcasts/${b}/import/preview`, { file: { name: '상품목록.csv', data: file.toString('base64') } })
    expect(preview.status, preview.text.slice(0, 200)).toBe(200)
    expect([preview.body.register, preview.body.problems]).toEqual([500, 0])
    const rows = (preview.body.rows as { no: number; name: string; price: number }[]).map(({ no, name: n, price }) => ({ no, name: n, price }))
    const registered = await post(world, seller, `/api/broadcasts/${b}/import`, { requestId: rid('imp'), rows })
    // 미리 보기는 "500개 등록하기"를 보였는데 등록은 413 "보낸 내용이 너무 커요(2MB까지)." — 파일은 2MB 안이었다
    expect(registered.status, registered.text.slice(0, 200)).toBe(200)
    expect(registered.body.registered).toBe(500)
  }, 60_000)
})

describe('TD-I2-008 한 판매자의 기간 판매대장·전체 판매대장이 다른 판매자의 범위 상태를 밀어내지 않는다', () => {
  it('판매자 A가 방송 중일 때 판매자 B가 전체 판매대장(엑셀)을 받아도 A의 범위 상태(메모리)는 그대로다', async () => {
    // 범위 상태 상한(기본 128)을 작게 — 판매자 B의 실제 날짜가 상한보다 많은 경우(1년 매일 방송 = 365일)와 같은 모양
    const world = await newWorld({ runtimeCacheMax: 4 })
    const a = await addSeller(world)
    const b = await addSeller(world)
    const live = (await createBroadcast(world, a, { date: D, title: '1부' })).id
    await ok(world, a, { type: 'product.register', b: live, no: 15, name: '핑크프릴', price: 10000 })
    await ok(world, a, { type: 'product.open', b: live, no: 15 })
    // 판매자 B: 지난 날짜 6일 (실제 범위 6개)
    for (let day = 1; day <= 6; day++) {
      const date = `2026-10-${String(day).padStart(2, '0')}`
      const bb = (await createBroadcast(world, b, { date })).id
      await ok(world, b, { type: 'product.register', b: bb, no: 1, name: '방울복랑', price: 5000 })
    }
    // A가 방송 중에 쓰고 있다 (마지막으로 쓴 범위)
    await chat(world, a, live, 'm1', 'UC_A', '홍길동', '15')
    const before = await world.server.writer.read(a.sellerId, D, false)
    const exported = await client(world, b.cookie).raw('/api/export/ledger.xlsx', {})
    expect(exported.status).toBe(200)
    // B의 내려받기가 끝난 뒤 A의 범위 상태가 메모리에 남아 있어야 한다 (밀려나면 다음 채팅이 스냅샷 + 뒤 이벤트를 다시 불러온다 — 방송 중 판정 지연)
    expect(await world.server.writer.read(a.sellerId, D, false), 'A의 범위 상태가 B의 판매대장 때문에 밀려났다').toBe(before)
  }, 60_000)
})

describe('백업 형식 2 — 이상한 글자 회귀', () => {
  it('따옴표·역슬래시·이모지·U+2028·조합 문자·전각 글자가 든 닉네임·채팅·문자 메모·가게 설정·송장: 백업 → 검사 → 다른 서버 복구 → 재생 검사 통과, 같은 정산', async () => {
    const world = await newWorld()
    const seller = await addSeller(world)
    expect((await putShop(world, seller, { name: '"초록\\다육" 🌵', bank: '농협\u2028', accountNumber: '302-9988-7766-11', accountHolder: '김판매', accountNote: '입금자명 "닉네임"\\ 🌵 가' })).status).not.toBe(500)
    const b = (await createBroadcast(world, seller, { date: D, title: '1부 "특가" \\ 🌵' })).id
    await ok(world, seller, { type: 'product.register', b, no: 15, name: '핑크"프릴\\ 🌵', price: 10000 })
    await ok(world, seller, { type: 'product.register', b, no: 16, name: '라울\u2028금', price: 8000 })
    await ok(world, seller, { type: 'product.open', b, no: 15 })
    await ok(world, seller, { type: 'product.open', b, no: 16 })
    await chat(world, seller, b, 'm"1\\', 'UC_"A\\', '홍"길\\동🌵\u2028', '15')
    await chat(world, seller, b, 'm2', 'UC_B', '가\u0301나\uFF21', '16')
    const sms = (await ok(world, seller, { type: 'sms', b, no: 16, received: '20:02', phone: '010-1111-2222', memo: '메모 "따옴표" \\ 🌵' })).body.buyer as string
    const entries = (await client(world, seller.cookie).get(`/api/days/${D}/packing`)).body.entries as { buyer: string; items: { key: string }[] }[]
    for (const entry of entries) {
      const packed = await pack(world, seller, D, { buyer: entry.buyer, action: 'pack', items: entry.items.map((item) => item.key) })
      expect(packed.status, packed.text).toBe(200)
    }
    expect(entries.map((entry) => entry.buyer)).toContain('UC_"A\\')
    const shipped = await pack(world, seller, D, { buyer: 'UC_"A\\', action: 'ship', invoice: '1234-5678-9012' })
    expect(shipped.status, shipped.text).toBe(200)
    void sms
    const bytes = await createBackupBytes(world.database.db, seller.sellerId, world.clock.now())
    const checked = await checkBackupBytes(bytes)
    expect(checked.ok, checked.ok ? '' : checked.reason).toBe(true)
    const other = await newWorld({ clock: world.clock })
    const target = await addSeller(other)
    const restored = await restoreSeller({ db: other.database.db, sellerId: target.sellerId, bytes, replace: false, storage: null, clock: other.clock, ids: randomIds })
    expect(restored.ok, restored.ok ? '' : restored.reason).toBe(true)
    expect((await checkReplay(other.database.db, { sellerId: target.sellerId })).every((check) => check.ok)).toBe(true)
    const source = await client(world, seller.cookie).get(`/api/days/${D}`)
    const copy = await client(other, target.cookie).get(`/api/days/${D}`)
    expect(copy.body.settlements).toEqual(source.body.settlements)
    expect(copy.body.packing).toEqual(source.body.packing)
    expect((await client(other, target.cookie).get('/api/shop')).body).toEqual((await client(world, seller.cookie).get('/api/shop')).body)
  }, 60_000)
})
