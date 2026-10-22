// T1 배송 조회·운송장·판매자 화면 재료: AC-T1-43(운송장 내려받기), AC-T1-44(B1으로 찍지 않는다 — 서버 쪽), AC-T1-50(주기 조회), AC-T1-51(낱말), AC-T1-52(parcel 줄).
import { describe, expect, it } from 'vitest'
import { TRACK_WORDS, CANCELLED_WORD } from '../src/parcel/rules.ts'
import { ParcelService } from '../src/parcel/service.ts'
import { WorkBusy, type WorkPools } from '../src/work-pool.ts'
import { realTimer } from '../src/youtube/timer.ts'
import { client, fakeClock } from './support.ts'
import { ADDRESS, D, attempts, bookOk, expect200, makeReady, parcelApi, parcelSeller, parcelWorld, rowOf, sell } from './t1-support.ts'

const DAY = 24 * 60 * 60 * 1000

describe('AC-T1-50 주기 조회', () => {
  it('접수 뒤 14일이 지난 것은 묻지 않고 나머지는 한 번에 묻는다, 집하로 바뀌면 상태·마지막 확인 시각, 도착은 다음부터 묻지 않는다, 실패하면 그대로', async () => {
    const clock = fakeClock()
    const world = await parcelWorld({ clock })
    const seller = await parcelSeller(world)
    await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_B', '나래', 1],
      ['UC_C', '다솜', 1],
    ])
    for (const buyer of ['UC_A', 'UC_B', 'UC_C']) await makeReady(world, seller, buyer)
    const [a] = await bookOk(world, seller, [{ buyer: 'UC_A' }])
    clock.advance(2 * DAY)
    const [b] = await bookOk(world, seller, [{ buyer: 'UC_B' }])
    clock.advance(12 * DAY)
    const [c] = await bookOk(world, seller, [{ buyer: 'UC_C' }])
    clock.advance(DAY + 60_000)
    world.carrier.reset()
    world.carrier.setStatus(b?.invoice as string, 'PICKED_UP')
    expect(await world.server.parcels.trackOnce()).toBe(2)
    const asked = world.carrier.requests.filter((item) => item.op === 'track')
    expect(asked).toHaveLength(1)
    expect([...(asked[0]?.invoices ?? [])].sort()).toEqual([b?.invoice, c?.invoice].sort())
    expect(asked[0]?.invoices).not.toContain(a?.invoice)
    const rowB = await rowOf(world, seller, 'UC_B')
    expect(rowB.parcel).toMatchObject({ status: '집하', checkedAt: new Date(clock.now()).toISOString(), cancellable: false })
    // 실패(500·응답 없음)하면 마지막 상태·확인 시각 그대로, 로그는 택배사 코드·상태 코드만
    clock.advance(30 * 60_000)
    world.carrier.setStatus(b?.invoice as string, 'IN_TRANSIT')
    world.carrier.failNext('track', 'ERROR_500')
    expect(await world.server.parcels.trackOnce()).toBe(0)
    expect((await rowOf(world, seller, 'UC_B')).parcel).toMatchObject({ status: '집하', checkedAt: rowB.parcel?.checkedAt })
    const failed = world.logs.filter((record) => record.code === 'PARCEL_TRACK_FAILED')
    expect(failed).toEqual([{ level: 'warn', code: 'PARCEL_TRACK_FAILED', reason: 'FAKE', status: 500 }])
    world.carrier.failNext('track', 'TIMEOUT')
    expect(await world.server.parcels.trackOnce()).toBe(0)
    // 도착이 되면 다음부터 묻지 않는다
    world.carrier.setStatus(c?.invoice as string, 'DELIVERED')
    expect(await world.server.parcels.trackOnce()).toBe(2)
    expect((await rowOf(world, seller, 'UC_C')).parcel?.status).toBe('도착')
    expect((await rowOf(world, seller, 'UC_B')).parcel?.status).toBe('배송 중')
    world.carrier.reset()
    expect(await world.server.parcels.trackOnce()).toBe(1)
    expect(world.carrier.requests[0]?.invoices).toEqual([b?.invoice])
  })

  it('start()가 조회 간격마다 돈다 (시험 모드는 간격을 줄인다), stop()으로 멈춘다', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    await sell(world, seller, [['UC_A', '가람', 1]])
    await makeReady(world, seller, 'UC_A')
    const [a] = await bookOk(world, seller, [{ buyer: 'UC_A' }])
    world.carrier.setStatus(a?.invoice as string, 'IN_TRANSIT')
    const parcels = new ParcelService({
      db: world.database.db,
      writer: world.server.writer,
      clock: world.clock,
      timer: realTimer(world.clock),
      masterKey: Buffer.from(world.masterKey, 'base64'),
      hub: world.server.hub,
      log: () => {},
      work: world.server.work,
      options: { carriers: { FAKE: world.carrier.adapter() }, trackEveryMs: 100 },
    })
    parcels.start()
    const deadline = Date.now() + 5000
    while ((await rowOf(world, seller, 'UC_A')).parcel?.status !== '배송 중' && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20))
    await parcels.stop()
    expect((await rowOf(world, seller, 'UC_A')).parcel?.status).toBe('배송 중')
  })
})

describe('AC-T1-51·52 낱말과 판매자 화면 재료', () => {
  it('조회 낱말은 접수됨·집하·배송 중·도착·접수 취소됨뿐, 정산 묶음·포장 모드 묶음에 parcel(없으면 null)', async () => {
    expect([...Object.values(TRACK_WORDS), CANCELLED_WORD]).toEqual(['접수됨', '집하', '배송 중', '도착', '접수 취소됨'])
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_B', '나래', 1],
    ])
    await makeReady(world, seller, 'UC_A')
    const [a] = await bookOk(world, seller, [{ buyer: 'UC_A' }])
    world.carrier.setStatus(a?.invoice as string, 'IN_TRANSIT')
    await world.server.parcels.trackOnce()
    const day = await expect200(client(world, seller.cookie).get(`/api/days/${D}`))
    const summary = day.body.packing as { buyer: string; status: string; parcel: Record<string, unknown> | null }[]
    expect(summary.find((item) => item.buyer === 'UC_A')).toMatchObject({ status: '배송 완료', parcel: { status: '배송 중', invoice: a?.invoice, invoiceText: '9000-0000-0001' } })
    expect(summary.find((item) => item.buyer === 'UC_B')?.parcel).toBeNull()
    expect(typeof (summary.find((item) => item.buyer === 'UC_A')?.parcel as { checkedAt: unknown }).checkedAt).toBe('string')
    const packing = await expect200(client(world, seller.cookie).get(`/api/days/${D}/packing`))
    const entries = packing.body.entries as { buyer: string; status: string; parcel: Record<string, unknown> | null }[]
    expect(entries.find((item) => item.buyer === 'UC_A')).toMatchObject({ status: '배송 완료', parcel: { status: '배송 중' } })
    expect(entries.find((item) => item.buyer === 'UC_B')?.parcel).toBeNull()
    // 화면에 나가는 조회 낱말은 정한 다섯 개뿐 (영어 상태값 ACCEPTED·IN_TRANSIT 등은 status에 없다)
    const text = JSON.stringify([day.body.packing, packing.body.entries, (await expect200(parcelApi(world, seller.cookie).day())).body])
    for (const match of text.matchAll(/"status":"([^"]+)"/g)) expect(['접수됨', '집하', '배송 중', '도착', '접수 취소됨', '포장 대기', '포장 완료', '포장 다시 확인', '배송 완료', '배송 뒤 바뀜']).toContain(match[1])
  })
})

describe('AC-T1-43·44 운송장 내려받기', () => {
  it('BOOKED 묶음 하나·접수함 전부 → application/pdf·파일 이름·no-store. 접수함이 없으면 409, 취소·실패·모름은 빠진다, 출력 기록 표에 운송장 행이 없다', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_B', '나래', 1],
      ['UC_C', '다솜', 1],
      ['UC_D', '라온', 1],
    ])
    const api = parcelApi(world, seller.cookie)
    const none = await api.waybills()
    expect(none.status).toBe(409)
    expect(await none.text()).toContain('접수한 택배가 없어요.')
    await makeReady(world, seller, 'UC_A')
    await makeReady(world, seller, 'UC_B')
    await makeReady(world, seller, 'UC_C', { ...ADDRESS, address: '서울 [주소거절]' })
    await makeReady(world, seller, 'UC_D', { ...ADDRESS, address: '서울 [응답없음]' })
    await bookOk(world, seller, [{ buyer: 'UC_A' }, { buyer: 'UC_B' }, { buyer: 'UC_C' }, { buyer: 'UC_D' }])
    await expect200(api.cancel('UC_B'))
    const printTables = ['print_jobs', 'print_labels', 'print_attempts', 'print_requests']
    const printCounts = async () => Promise.all(printTables.map(async (table) => (await world.database.pglite?.query<{ n: number }>(`select count(*)::int as n from ${table}`))?.rows[0]?.n))
    const before = await printCounts()
    const one = await api.waybill('UC_A')
    expect(one.status).toBe(200)
    expect(one.headers.get('content-type')).toBe('application/pdf')
    expect(one.headers.get('cache-control')).toBe('no-store')
    expect(decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(one.headers.get('content-disposition') ?? '')?.[1] ?? '')).toBe(`운송장-${D}-가람.pdf`)
    const bytes = new Uint8Array(await one.arrayBuffer())
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    const all = await api.waybills()
    expect(all.status).toBe(200)
    expect(decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(all.headers.get('content-disposition') ?? '')?.[1] ?? '')).toBe(`운송장-${D}-전부.pdf`)
    expect(all.headers.get('x-waybill-count')).toBe('1')
    for (const buyer of ['UC_B', 'UC_C', 'UC_D']) expect((await api.waybill(buyer)).status, buyer).toBe(409)
    expect((await api.waybill('UC_NOPE')).status).toBe(404)
    // 운송장은 라벨 출력 대기열·B1 작업에 들어가지 않는다 (운송장을 받아도 출력 기록 표의 행 수가 그대로 — 있는 행은 상품 라벨)
    expect(await printCounts()).toEqual(before)
    expect((await attempts(world, seller.sellerId, 'UC_A')).map((row) => row.state)).toEqual(['BOOKED'])
  })

  it('가장 긴 배송지(받는 분 20·주소 100·상세 100·메모 50자)도 자르지 않고 PDF, 문서 패키지가 TOO_LONG을 주면 하나짜리는 422 문장·전부는 그것만 빠진다, 바쁘면 429', async () => {
    const world = await parcelWorld()
    const seller = await parcelSeller(world)
    await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_B', '나래', 1],
    ])
    const long = { ...ADDRESS, name: '가'.repeat(20), address: '가나다라마바사아자차'.repeat(10), detail: '카타파하거너더러머버'.repeat(10), memo: '서'.repeat(50) }
    await makeReady(world, seller, 'UC_A', long)
    await makeReady(world, seller, 'UC_B')
    await bookOk(world, seller, [{ buyer: 'UC_A' }, { buyer: 'UC_B' }])
    const real = await parcelApi(world, seller.cookie).waybill('UC_A')
    expect(real.status).toBe(200)
    expect(real.headers.get('content-type')).toBe('application/pdf')
    // 문서 패키지 답을 바꿔 끼운 같은 서버 (작업 풀만 다르다): 첫 운송장이 넘침
    const documents = world.server.work.documents
    const sent: unknown[] = []
    let busy = false
    const stub = {
      ...world.server.work,
      documents: {
        run: async (owner: string, kind: string, input: unknown, options: unknown) => {
          if (kind !== 'waybillPdf') return documents.run(owner, kind as never, input, options as never)
          if (busy) throw new WorkBusy()
          sent.push(input)
          const list = (input as { list: { invoice: string }[] }).list
          if (list.length === 1) return { pdf: null, outcomes: [{ index: 0, invoice: list[0]?.invoice, ok: false, error: { code: 'TOO_LONG', message: '주소가 길어 운송장에 다 들어가지 않아요.' } }] }
          const rendered = (await documents.run(owner, 'waybillPdf', { list: list.slice(1) }, options as never)) as { pdf: Uint8Array }
          return { pdf: rendered.pdf, outcomes: list.map((item, index) => (index === 0 ? { index, invoice: item.invoice, ok: false, error: { code: 'TOO_LONG', message: '주소가 길어 운송장에 다 들어가지 않아요.' } } : { index, invoice: item.invoice, ok: true })) }
        },
      },
    }
    const other = new ParcelService({
      db: world.database.db,
      writer: world.server.writer,
      clock: world.clock,
      timer: realTimer(world.clock),
      masterKey: Buffer.from(world.masterKey, 'base64'),
      hub: world.server.hub,
      log: () => {},
      work: stub as unknown as WorkPools,
      options: { carriers: { FAKE: world.carrier.adapter() } },
    })
    const single = await other.waybill(seller.sellerId, D, 'UC_A')
    expect(single).toEqual({ kind: 'error', error: { status: 422, code: 'WAYBILL_TOO_LONG', message: '주소가 길어 운송장에 다 들어가지 않아요.', problems: [] } })
    const all = await other.waybill(seller.sellerId, D, null)
    expect(all.kind).toBe('ok')
    if (all.kind === 'ok') expect(all.value.headers).toEqual({ 'X-Waybill-Count': '1', 'X-Waybill-Skipped': '1' })
    // 운송장 데이터에는 구매자 ID·닉네임·가격이 없다
    const text = JSON.stringify(sent)
    expect(text).not.toMatch(/UC_|가람|나래|품종/)
    busy = true
    const crowded = await other.waybill(seller.sellerId, D, null)
    expect(crowded.kind === 'error' && crowded.error.status).toBe(429)
  })
})
