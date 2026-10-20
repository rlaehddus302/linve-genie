// AC-N3-10~17: 표·격리·재시작, 같은 입금은 한 번, 받는 것과 기간, 붙여넣기 미리 보기·넣기, 받아 오기 주기·지금 받아 오기·원천 상태,
// 계좌조회(팝빌 EasyFinBank 형식) 어댑터, 비밀값·개인정보·로그, 시험 모드 가짜 원천. 네트워크를 쓰지 않는다(가짜 팝빌 전송).
import type { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { FAKE_POPBILL_MGT_URL } from '../src/deposit/popbill-fake.ts'
import { productionServerOptions } from '../src/production.ts'
import { createServer } from '../src/server.ts'
import { addSeller, client, createBroadcast, dumpAllTables, expectOk, openTestDb, rid, startServer, writeEvent } from './support.ts'
import { DAY, depositApi, depositWorld, deposits, kst, order, pasteText, register } from './deposit-support.ts'
import { generateMasterKey } from '../src/secrets.ts'
import { cleanDepositName, readPaste } from '../src/deposit/paste.ts'

const ACCOUNT = { corpNum: '1234567890', bankCode: '0004', accountNumber: '110123456789' }

/** 팝빌 조회 줄 (입금) */
const inRow = (tid: string, trdt: string, accIn: number | string, remark1: string, extra: Record<string, unknown> = {}) => ({ tid, trdt, accIn: String(accIn), accOut: '0', balance: '1000000', remark1, ...extra })

async function popbillSource(api: ReturnType<typeof depositApi>, label = '국민 6789'): Promise<{ id: string; accountLast4: string; bank: string }> {
  return (await expectOk(api.createSource({ kind: 'POPBILL', label, corpNum: '123-45-67890', bank: '0004', accountNumber: '110-1234-56789' }))).body as { id: string; accountLast4: string; bank: string }
}

describe('AC-N3-10 표·격리·재시작', () => {
  it('다른 판매자의 입금·원천·기억한 이름은 어디로도 보이지 않고 처리하면 404다', async () => {
    const world = await depositWorld()
    const owner = await addSeller(world)
    const other = await addSeller(world)
    const mine = depositApi(world, owner)
    const theirs = depositApi(world, other)
    world.clock.advance(60_000)
    await expectOk(mine.paste(pasteText([{ at: '2026-10-19 11:00:00', name: '김영희', amount: 5000 }])))
    const fake = (await expectOk(mine.createSource({ kind: 'FAKE' }))).body as { id: string }
    expect(await deposits(theirs)).toEqual([])
    expect(await theirs.count()).toBe(0)
    expect((await theirs.detail(1)).status).toBe(404)
    for (const response of [
      await theirs.confirm(1, { date: DAY, buyer: 'UC_A', remaining: 0 }),
      await theirs.ignore(1),
      await theirs.reopen(1),
      await theirs.revert(1),
      await theirs.bundles(1, ''),
      await theirs.patchSource(fake.id, { label: '남의 것' }),
      await theirs.fetch(fake.id),
      await theirs.testRows(fake.id, [{ key: 'x', at: '2026-10-19T11:00:00+09:00', amount: 1, name: 'x' }]),
      await theirs.forget(1),
    ]) {
      expect(response.status, response.text).toBe(404)
    }
    expect(((await expectOk(theirs.sources())).body as { sources: unknown[] }).sources).toEqual([])
    const bulk = await expectOk(theirs.bulk([{ no: 1, action: 'ignore' }]))
    expect(bulk.body).toMatchObject({ results: [{ no: 1, ok: false, status: 404 }] })
    expect((await deposits(mine))[0]?.status).toBe('REVIEW')
  })

  it('서버를 다시 켜도 입금·상태·연결·처리 기록·원천 설정·마지막 받아 온 시각·기억한 이름이 그대로이고 번호를 이어서 센다', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await register(world, seller, b.id, 15)
    await order(world, seller, b.id, 'UC_A', '다육이맘', '15')
    world.clock.advance(60_000)
    const api = depositApi(world, seller)
    await expectOk(api.paste(pasteText([{ at: '2026-10-19 12:00:10', name: '김영희', amount: 14_000 }, { at: '2026-10-19 12:00:20', name: '이철수', amount: 3000 }])))
    await expectOk(api.confirm(1, { date: DAY, buyer: 'UC_A', remaining: 14_000, remember: true }))
    const fake = (await expectOk(api.createSource({ kind: 'FAKE', label: '시험', intervalMin: 3 }))).body as { id: string }
    await expectOk(api.testRows(fake.id, [{ key: 'k1', at: '2026-10-19T12:00:30+09:00', amount: 700, name: '박' }]))
    await expectOk(api.fetch(fake.id))
    world.server.close()
    const again = startServer(world.database, world.masterKey, { clock: world.clock, deposits: { testMode: true, timer: world.timer } })
    const api2 = depositApi(again, seller)
    expect((await deposits(api2, 'APPLIED')).map((item) => [item.no, item.applied?.buyer])).toEqual([[1, 'UC_A']])
    expect((await expectOk(api2.detail(1))).body.deposit).toMatchObject({ actions: [{ action: 'RECEIVED' }, { action: 'CONFIRM' }] })
    const sources = ((await expectOk(api2.sources())).body as { sources: { id: string; intervalMin: number; lastFetchedAt: string | null; lastNew: number | null }[] }).sources
    expect(sources.find((source) => source.id === fake.id)).toMatchObject({ intervalMin: 3, lastNew: 1, lastFetchedAt: new Date(world.clock.now()).toISOString() })
    expect(((await expectOk(api2.names())).body as { names: { name: string }[] }).names.map((name) => name.name)).toEqual(['김영희'])
    expect((await expectOk(api2.paste(pasteText([{ at: '2026-10-19 12:00:40', name: '새 입금', amount: 100 }])))).body).toMatchObject({ new: 1 })
    expect((await deposits(api2)).map((item) => item.no)).toEqual([4, 3, 2])
    const links = ((await expectOk(api2.day(DAY))).body as { depositLinks: { deposit: { no: number } }[] }).depositLinks
    expect(links.map((link) => link.deposit.no)).toEqual([1])
    again.server.close()
  })
})

describe('AC-N3-11 같은 입금은 한 번 (DP-INV-4)', () => {
  it('같은 붙여넣기를 다시 넣거나(요청 번호가 달라도) 기간이 겹치게 넣어도 겹친 줄은 이미 있는 입금이다', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    world.clock.advance(60_000)
    const api = depositApi(world, seller)
    const a = { at: '2026-10-19 10:00:00', name: '김영희', amount: 1000 }
    const b = { at: '2026-10-19 10:01:00', name: '박민수', amount: 2000 }
    const c = { at: '2026-10-19 10:02:00', name: '이철수', amount: 3000 }
    expect((await expectOk(api.paste(pasteText([a, b]), 'p-1'))).body).toMatchObject({ new: 2, existing: 0 })
    expect((await expectOk(api.paste(pasteText([a, b]), 'p-2'))).body).toMatchObject({ new: 0, existing: 2 })
    expect((await expectOk(api.paste(pasteText([b, c]), 'p-3'))).body).toMatchObject({ new: 1, existing: 1 })
    expect((await deposits(api)).map((item) => item.name)).toEqual(['이철수', '박민수', '김영희'])
  })

  it('한 붙여넣기 안의 똑같은 두 줄은 입금 둘, 다음에 하나만 있으면 새 입금 없음, 셋이면 새 입금 하나. 잔액만 다른 줄은 다른 입금', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    world.clock.advance(60_000)
    const api = depositApi(world, seller)
    const row = { at: '2026-10-19 10:00:00', name: '김영희', amount: 1000 }
    expect((await expectOk(api.paste(pasteText([row, row])))).body).toMatchObject({ new: 2 })
    expect((await expectOk(api.paste(pasteText([row])))).body).toMatchObject({ new: 0, existing: 1 })
    expect((await expectOk(api.paste(pasteText([row, row, row])))).body).toMatchObject({ new: 1, existing: 2 })
    const withBalance = (balance: string) => `거래일시\t입금자명\t입금액\t잔액\n2026-10-19 10:05:00\t박민수\t2000\t${balance}`
    expect((await expectOk(api.paste(withBalance('10,000')))).body).toMatchObject({ new: 1 })
    expect((await expectOk(api.paste(withBalance('12,000')))).body).toMatchObject({ new: 1 })
    expect((await expectOk(api.paste(withBalance('12,000')))).body).toMatchObject({ new: 0, existing: 1 })
  })

  it('가짜 원천이 같은 키를 다음 받아 오기에 다시 받아 와도 한 번이고, DB 제약도 같은 키를 막는다', async () => {
    const world = await depositWorld({ deposits: { refetchGapMs: 0 } })
    const seller = await addSeller(world)
    world.clock.advance(60_000)
    const api = depositApi(world, seller)
    const fake = (await expectOk(api.createSource({ kind: 'FAKE' }))).body as { id: string; lastNew: number | null }
    await expectOk(api.testRows(fake.id, [{ key: 'tid-1', at: '2026-10-19T11:00:00+09:00', amount: 1000, name: '김영희' }]))
    expect((await expectOk(api.fetch(fake.id))).body).toMatchObject({ source: { lastNew: 1 } })
    expect((await expectOk(api.fetch(fake.id))).body).toMatchObject({ source: { lastNew: 0 } })
    expect(await deposits(api)).toHaveLength(1)
    const pg = world.database.pglite as PGlite
    const error = await pg
      .exec(`insert into deposits (seller_id, no, source_id, external_key, at, precision, amount, name, status, received_at) values ('${seller.sellerId}', 99, '${fake.id}', 'tid-1', now(), 'second', 1, 'x', 'REVIEW', now())`)
      .then(
        () => null,
        (failure: { code?: string }) => failure.code,
      )
    expect(error).toBe('23505')
  })

  it('두 서버(인스턴스)가 같은 글을 동시에 넣어도 입금은 한 번이고 진 쪽은 이미 있던 입금으로 센다', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    world.clock.advance(60_000)
    const second = startServer(world.database, world.masterKey, { clock: world.clock, deposits: { testMode: true, timer: world.timer } })
    const text = pasteText([{ at: '2026-10-19 10:00:00', name: '김영희', amount: 1000 }, { at: '2026-10-19 10:01:00', name: '박민수', amount: 2000 }])
    const [one, two] = await Promise.all([depositApi(world, seller).paste(text), depositApi(second, seller).paste(text)])
    const news = [one, two].map((response) => (response.body as { new: number; existing: number }).new).sort()
    expect(news).toEqual([0, 2])
    expect([one, two].map((response) => (response.body as { existing: number }).existing).sort()).toEqual([0, 2])
    expect((await deposits(depositApi(world, seller))).map((item) => item.no)).toEqual([2, 1])
    second.server.close()
  })
})

describe('AC-N3-12 받는 것과 받는 기간', () => {
  it('출금은 저장하지 않는다. 오늘 − 30일 00:00:00 KST와 받는 순간 + 5분 정각은 저장하고 그 밖은 개수만 알린다', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    const api = depositApi(world, seller)
    // 받는 순간 = 2026-10-19 12:00:00 KST (T0)
    const text = [
      '거래일시\t입금자명\t입금액\t출금액',
      '2026-09-19 00:00:00\t경계안\t1000\t',
      '2026-09-18 23:59:59\t오래됨\t1000\t',
      '2026-10-19 12:05:00\t미래경계\t1000\t',
      '2026-10-19 12:05:01\t미래\t1000\t',
      '2026-10-19 11:00:00\t편의점\t0\t5000',
    ].join('\n')
    const response = await expectOk(api.paste(text))
    expect(response.body).toMatchObject({ read: 4, skipped: 1, new: 2, old: 1, future: 1 })
    expect((await deposits(api)).map((item) => item.name).sort()).toEqual(['경계안', '미래경계'])
  })

  it('입금자명은 앞뒤 공백을 뺀 40자까지만, 잔액·적요·메모·붙여넣은 글은 저장하지 않는다', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    world.clock.advance(60_000)
    const api = depositApi(world, seller)
    const long = `  ${'가'.repeat(45)}  `
    const text = `거래일시,입금자명,입금액,잔액,메모\n2026-10-19 10:00:00,${long},1000,"987,654,321",비밀메모글귀`
    await expectOk(api.paste(text))
    expect((await deposits(api))[0]?.name).toBe('가'.repeat(40))
    const dump = await dumpAllTables(world.database)
    expect(dump).not.toContain('비밀메모글귀')
    expect(dump).not.toContain('987654321')
    expect(dump).not.toContain('987,654,321')
  })
})

describe('AC-N3-13 붙여넣기 미리 보기·넣기', () => {
  it('미리 보기는 아무것도 기록하지 않고 줄마다 새 입금·이미 있는 입금·오래된 입금·시각이 앞으로인 입금을 알린다', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    world.clock.advance(60_000)
    const api = depositApi(world, seller)
    await expectOk(api.paste(pasteText([{ at: '2026-10-19 10:00:00', name: '있음', amount: 1000 }])))
    const before = await dumpAllTables(world.database)
    const text = ['거래일시\t입금자명\t입금액', '2026-10-19 10:00:00\t있음\t1000', '2026-10-19 10:30:00\t새것\t2000', '2026-08-01 10:00:00\t옛것\t3000', '2026-10-20 10:00:00\t앞으로\t4000', '2026-10-19\t시각없음\t5000', '2026-10-19 10:00\t금액틀림\t1.5'].join('\n')
    const preview = (await expectOk(api.preview(text))).body as { rows: { line: number; name: string; state: string }[]; unreadable: { line: number; why: string }[] }
    expect(preview.rows.map((row) => [row.line, row.state])).toEqual([
      [2, 'EXISTING'],
      [3, 'NEW'],
      [4, 'OLD'],
      [5, 'FUTURE'],
    ])
    expect(preview.unreadable).toEqual([
      { line: 6, why: 'BAD_TIME' },
      { line: 7, why: 'BAD_AMOUNT' },
    ])
    expect(await dumpAllTables(world.database)).toBe(before)
  })

  it('머리글이 없거나 줄이 너무 많으면 400과 정한 문장, 같은 요청 번호로 다시 보내면 처음 요약을 돌려주고 아무것도 다시 하지 않는다', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    world.clock.advance(60_000)
    const api = depositApi(world, seller)
    const noHeader = await api.preview('2026.10.18 21:03 김영희 14,000원 입금')
    expect(noHeader.status).toBe(400)
    expect(noHeader.body).toMatchObject({ error: { code: 'PASTE_NO_HEADER', message: '표의 첫 줄(거래일시·입금액 같은 칸 이름)을 함께 붙여 넣어 주세요.' } })
    expect((await api.paste('그냥 글')).body).toMatchObject({ error: { message: '표의 첫 줄(거래일시·입금액 같은 칸 이름)을 함께 붙여 넣어 주세요.' } })
    // 64KB 본문 상한(413) 안에 들도록 짧은 줄 2,001개
    const many = ['거래일시\t입금자명\t입금액', ...Array.from({ length: 2001 }, (_, i) => `20261019 10:00\t\t${String((i % 9) + 1)}`)].join('\n')
    const tooMany = await api.paste(many)
    expect(tooMany.status).toBe(400)
    expect(tooMany.body).toMatchObject({ error: { code: 'PASTE_TOO_MANY_ROWS', message: '한 번에 2,000줄까지 넣을 수 있어요. 나눠서 넣어 주세요.' } })
    const text = pasteText([{ at: '2026-10-19 10:00:00', name: '김영희', amount: 1000 }])
    const first = await expectOk(api.paste(text, 'same-paste'))
    const again = await expectOk(api.paste(pasteText([{ at: '2026-10-19 10:00:00', name: '다른', amount: 2 }]), 'same-paste'))
    expect(again.body).toEqual(first.body)
    expect(await deposits(api)).toHaveLength(1)
  })

  it('본문이 64KB를 넘으면 413', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    const response = await depositApi(world, seller).preview(`거래일시\t입금자명\t입금액\n${'x'.repeat(70_000)}`)
    expect(response.status).toBe(413)
  })
})

describe('AC-N3-14 받아 오기 주기·지금 받아 오기·원천 상태', () => {
  it('켜진 원천은 주기(기본 5분, 1~5분)마다 받아 오고, 고친 주기는 바로 적용된다. 범위 밖 주기는 400', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    world.clock.advance(60_000)
    const api = depositApi(world, seller)
    const fake = (await expectOk(api.createSource({ kind: 'FAKE' }))).body as { id: string; intervalMin: number }
    expect(fake.intervalMin).toBe(5)
    expect(world.timer.lastDelay).toBe(5 * 60_000)
    expect((await expectOk(api.patchSource(fake.id, { intervalMin: 2 }))).body).toMatchObject({ intervalMin: 2 })
    expect(world.timer.lastDelay).toBe(2 * 60_000)
    expect(world.timer.pending).toBe(1)
    for (const intervalMin of [0, 6, 1.5, '3']) expect((await api.patchSource(fake.id, { intervalMin })).status).toBe(400)
    await expectOk(api.testRows(fake.id, [{ key: 'a', at: '2026-10-19T11:00:00+09:00', amount: 1000, name: '김영희' }]))
    world.timer.runNext()
    await new Promise((resolve) => setTimeout(resolve, 50))
    await expect.poll(async () => (await deposits(api)).length).toBe(1)
    await expect.poll(() => world.timer.pending).toBe(1)
    // 끄면 주기가 멈추고 받아 오지 않는다 (이미 받은 입금은 그대로)
    await expectOk(api.patchSource(fake.id, { enabled: false }))
    expect(world.timer.pending).toBe(0)
    const off = await api.fetch(fake.id)
    expect(off.status).toBe(409)
    expect(off.body).toMatchObject({ error: { code: 'SOURCE_DISABLED' } })
    expect(await deposits(api)).toHaveLength(1)
  })

  it('지금 받아 오기는 같은 원천 1분 안에 다시 누르면 429 "방금 받아 왔어요. 잠시 뒤에 다시 눌러 주세요." 붙여넣기 원천은 받아 오기가 없다', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    const api = depositApi(world, seller)
    const fake = (await expectOk(api.createSource({ kind: 'FAKE' }))).body as { id: string }
    await expectOk(api.fetch(fake.id))
    world.clock.advance(59_000)
    const soon = await api.fetch(fake.id)
    expect(soon.status).toBe(429)
    expect(soon.body).toMatchObject({ error: { code: 'FETCH_TOO_SOON', message: '방금 받아 왔어요. 잠시 뒤에 다시 눌러 주세요.' } })
    world.clock.advance(1000)
    await expectOk(api.fetch(fake.id))
    await expectOk(api.paste(pasteText([{ at: '2026-10-19 11:00:00', name: '김영희', amount: 1000 }])))
    const paste = ((await expectOk(api.sources())).body as { sources: { id: string; kind: string; fetchable: boolean }[] }).sources.find((source) => source.kind === 'PASTE')
    expect(paste?.fetchable).toBe(false)
    expect((await api.fetch(paste?.id ?? '')).status).toBe(400)
    expect((await api.patchSource(paste?.id ?? '', { intervalMin: 3 })).status).toBe(400)
  })

  it('같은 원천의 받아 오기는 겹쳐 돌지 않는다 (주기와 지금 받아 오기가 겹치면 하나만)', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    world.popbill.register(ACCOUNT)
    world.popbill.pollsBeforeDone = 3
    const api = depositApi(world, seller)
    const source = await popbillSource(api)
    await Promise.all([api.fetch(source.id), world.server.deposits.runSource(seller.sellerId, source.id), world.server.deposits.runSource(seller.sellerId, source.id)])
    expect(world.popbill.calls.filter((call) => call.method === 'requestJob')).toHaveLength(1)
  })

  it('실패는 원천의 마지막 오류 문장(쉬운 한 문장)으로만 남고, 원천이 응답하지 않는 동안에도 판매 쓰기는 바로 끝난다', async () => {
    const world = await depositWorld({ deposits: { waitTimer: undefined, callTimeoutMs: 30_000 } })
    const seller = await addSeller(world)
    world.popbill.register(ACCOUNT)
    const api = depositApi(world, seller)
    const source = await popbillSource(api)
    world.popbill.fail('requestJob', 'AUTH')
    await expectOk(api.fetch(source.id))
    const view = ((await expectOk(api.sources())).body as { sources: { id: string; lastError: string | null; lastFetchedAt: string | null }[] }).sources.find((item) => item.id === source.id)
    expect(view).toMatchObject({ lastError: '팝빌 연결을 확인해 주세요.', lastFetchedAt: null })
    // 응답하지 않는 원천 (30초 시간 제한 — 기다리지 않는다)
    world.popbill.fail('requestJob', 'HANG')
    const hanging = world.server.deposits.runSource(seller.sellerId, source.id)
    const b = await createBroadcast(world, seller, { date: DAY })
    const started = Date.now()
    await register(world, seller, b.id, 1)
    await order(world, seller, b.id, 'UC_A', '다육이맘', '1')
    await expectOk(writeEvent(world, seller, { type: 'settlement.payment', buyer: 'UC_A', date: DAY, amount: 1000 }, DAY))
    expect(Date.now() - started).toBeLessThan(5000)
    void hanging
  })
})

describe('AC-N3-15 계좌조회(팝빌 EasyFinBank 형식) 어댑터', () => {
  it('수집 요청(어제·오늘 KST) → 상태 확인 → 입금만 조회(쪽마다 끝까지). tid·trdt·accIn·remark1(비면 remark2)를 옮기고 모양이 틀린 줄은 건너뛴다', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    const api = depositApi(world, seller)
    world.popbill.register(ACCOUNT)
    world.popbill.pageSize = 2
    world.popbill.pollsBeforeDone = 2
    world.popbill.addRows(ACCOUNT, [
      inRow('T1', '20261019103015', 14000, ' 김영희 '),
      inRow('T2', '20261018220000', 3000, '', { remark2: '박민수' }),
      { tid: 'T3', trdt: '20261019110000', accIn: '0', accOut: '5000', remark1: '편의점' },
      inRow('T4', '2026101911', 1000, '시각틀림'),
      inRow('T5', '20261019110000', '100000001', '너무큼'),
      inRow('T6', '20261019110100', '-5', '음수'),
      inRow('', '20261019110200', 1000, 'tid없음'),
      inRow('T8', '20261017100000', 1000, '그제'),
      inRow('T9', '20261019113000', 5000, '이철수'),
    ])
    const source = await popbillSource(api)
    expect(source).toMatchObject({ bank: '0004', accountLast4: '6789' })
    await expectOk(api.fetch(source.id))
    expect(world.popbill.calls.find((call) => call.method === 'requestJob')?.input).toEqual({ ...ACCOUNT, sDate: '20261018', eDate: '20261019' })
    expect(world.popbill.calls.filter((call) => call.method === 'getJobState')).toHaveLength(3)
    const searches = world.popbill.calls.filter((call) => call.method === 'search').map((call) => call.input)
    expect(searches.every((input) => JSON.stringify(input.tradeType) === '["I"]')).toBe(true)
    expect(searches.map((input) => input.page)).toEqual([1, 2, 3, 4])
    const items = await deposits(api)
    expect(items.map((item) => [item.name, item.amount, item.at, item.precision, item.source.kind]).sort()).toEqual([
      ['김영희', 14000, new Date(kst('2026-10-19 10:30:15')).toISOString(), 'second', 'POPBILL'],
      ['박민수', 3000, new Date(kst('2026-10-18 22:00:00')).toISOString(), 'second', 'POPBILL'],
      ['이철수', 5000, new Date(kst('2026-10-19 11:30:00')).toISOString(), 'second', 'POPBILL'],
    ])
    const view = ((await expectOk(api.sources())).body as { sources: { id: string; lastError: string | null; lastNew: number }[] }).sources.find((item) => item.id === source.id)
    expect(view).toMatchObject({ lastError: '읽지 못한 내역이 있어요', lastNew: 3 })
  })

  it('수집이 60초 안에 끝나지 않으면 오류 문장으로 남고 입금을 만들지 않는다', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    const api = depositApi(world, seller)
    world.popbill.register(ACCOUNT).addRows(ACCOUNT, [inRow('T1', '20261019103015', 14000, '김영희')])
    world.popbill.pollsBeforeDone = 1000
    world.popbill.onPoll = () => world.clock.advance(20_000)
    const source = await popbillSource(api)
    await expectOk(api.fetch(source.id))
    const view = ((await expectOk(api.sources())).body as { sources: { id: string; lastError: string | null }[] }).sources.find((item) => item.id === source.id)
    expect(view?.lastError).toBe('은행에서 내역을 받아 오는 데 시간이 오래 걸려요. 잠시 뒤에 다시 받아 올게요.')
    expect(world.popbill.calls.filter((call) => call.method === 'getJobState').length).toBeLessThanOrEqual(5)
    expect(await deposits(api)).toEqual([])
  })

  it('인증 실패·권한 없음·계좌 미등록·네트워크 오류·이상한 응답·끝나지 않는 쪽은 각각 쉬운 한 문장이고 입금을 만들지 않는다', async () => {
    const cases: [string, (world: Awaited<ReturnType<typeof depositWorld>>) => void, string][] = [
      ['인증', (w) => w.popbill.register(ACCOUNT).fail('requestJob', 'AUTH'), '팝빌 연결을 확인해 주세요.'],
      ['권한', (w) => w.popbill.register(ACCOUNT).fail('search', 'FORBIDDEN'), '팝빌 계좌조회 권한을 확인해 주세요.'],
      ['미등록', () => {}, '팝빌에 등록되지 않은 계좌예요. 팝빌 계좌 관리에서 등록해 주세요.'],
      ['네트워크', (w) => w.popbill.register(ACCOUNT).fail('getJobState', 'NETWORK'), '팝빌에 연결하지 못했어요. 잠시 뒤에 다시 받아 올게요.'],
      ['응답 없음', (w) => w.popbill.register(ACCOUNT).fail('search', 'HANG'), '팝빌에 연결하지 못했어요. 잠시 뒤에 다시 받아 올게요.'],
      ['은행 오류', (w) => (w.popbill.register(ACCOUNT).jobFails = true), '은행에서 내역을 받아 오지 못했어요. 잠시 뒤에 다시 받아 올게요.'],
      ['끝없는 쪽', (w) => (w.popbill.register(ACCOUNT).loopPages = true), '팝빌에서 받은 내역을 읽지 못했어요. 잠시 뒤에 다시 받아 올게요.'],
    ]
    for (const [label, setup, message] of cases) {
      const world = await depositWorld()
      const seller = await addSeller(world)
      const api = depositApi(world, seller)
      world.popbill.addRows(ACCOUNT, [inRow('T1', '20261019103015', 14000, '김영희')])
      setup(world)
      const source = await popbillSource(api)
      await expectOk(api.fetch(source.id))
      const view = ((await expectOk(api.sources())).body as { sources: { id: string; lastError: string | null }[] }).sources.find((item) => item.id === source.id)
      expect(view?.lastError, label).toBe(message)
      expect(await deposits(api), label).toEqual([])
      expect(JSON.stringify(world.logs), label).not.toMatch(/김영희|1234567890|110123456789/)
    }
  })

  it('연동 키가 없으면 계좌조회 원천을 만들 수 없다 (409, 준비 중 문장). 계좌 관리 주소는 팝빌이 준 주소 그대로, 저장하지 않는다', async () => {
    const world = await depositWorld({ deposits: { popbill: null } })
    const seller = await addSeller(world)
    const api = depositApi(world, seller)
    const response = await api.createSource({ kind: 'POPBILL', label: '국민', corpNum: '1234567890', bank: '0004', accountNumber: '110123456789' })
    expect(response.status).toBe(409)
    expect(response.body).toMatchObject({ error: { code: 'POPBILL_NOT_READY', message: '계좌 연동은 아직 준비 중이에요. 붙여넣기로 넣어 주세요.' } })
    expect((await expectOk(api.sources())).body).toMatchObject({ popbill: false, sources: [] })
    expect((await api.api.post('/api/deposits/popbill/manage-url', { corpNum: '1234567890' })).status).toBe(409)
    const ready = await depositWorld()
    const seller2 = await addSeller(ready)
    const url = await expectOk(depositApi(ready, seller2).api.post('/api/deposits/popbill/manage-url', { corpNum: '123-45-67890' }))
    expect(url.body).toEqual({ url: `${FAKE_POPBILL_MGT_URL}?TG=BankAccount` })
    expect(await dumpAllTables(ready.database)).not.toContain('fake-bank-account-mgt')
  })
})

describe('AC-N3-16 비밀값·개인정보·로그 (DAT-06)', () => {
  it('사업자번호·계좌번호는 암호화해 두고(DB에 평문 없음) 응답엔 끝 4자리·은행·표시 이름만, 다른 판매자 행으로 옮기면 풀리지 않는다', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    const other = await addSeller(world)
    const api = depositApi(world, seller)
    const source = await popbillSource(api)
    const listed = await expectOk(api.sources())
    expect(listed.text).not.toContain('1234567890')
    expect(listed.text).not.toContain('110123456789')
    expect(listed.text).not.toContain('110-1234-56789')
    const dump = await dumpAllTables(world.database)
    for (const secret of ['1234567890', '123-45-67890', '110123456789', '110-1234-56789']) expect(dump).not.toContain(secret)
    // 다른 판매자의 원천 행으로 암호문을 옮긴다
    const otherApi = depositApi(world, other)
    const otherSource = (await expectOk(otherApi.createSource({ kind: 'POPBILL', label: '다른', corpNum: '2222222222', bank: '0011', accountNumber: '3333333333' }))).body as { id: string }
    const pg = world.database.pglite as PGlite
    await pg.exec(`update deposit_sources set account_enc = (select account_enc from deposit_sources where id = '${source.id}') where id = '${otherSource.id}'`)
    const moved = ((await expectOk(otherApi.sources())).body as { sources: { id: string; bank: string | null; accountLast4: string | null }[] }).sources.find((item) => item.id === otherSource.id)
    expect(moved).toMatchObject({ bank: null, accountLast4: null })
  })

  it('계좌 비밀번호·빠른조회 아이디/비밀번호·생년월일 같은 칸은 400 UNKNOWN_FIELD이고 아무것도 기록하지 않는다. 그런 값을 두는 칸도 없다', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    const api = depositApi(world, seller)
    for (const field of ['accountPassword', 'fastId', 'fastPassword', 'password', 'birthDate']) {
      const response = await api.createSource({ kind: 'POPBILL', label: '국민', corpNum: '1234567890', bank: '0004', accountNumber: '110123456789', [field]: 'secret-9999' })
      expect(response.status, field).toBe(400)
      expect(response.body, field).toMatchObject({ error: { code: 'UNKNOWN_FIELD' } })
      expect(response.text).not.toContain('secret-9999')
      expect((await api.patchSource('dsrc_x', { [field]: 'secret' })).status).toBe(400)
    }
    expect(((await expectOk(api.sources())).body as { sources: unknown[] }).sources).toEqual([])
    const pg = world.database.pglite as PGlite
    const columns = await pg.query<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = 'public' and table_name like 'deposit%'`)
    expect(columns.rows.map((row) => row.column_name).filter((name) => /pass|pwd|pin|birth|fast|secret/i.test(name))).toEqual([])
  })

  it('입금 확인이 적은 이벤트에는 입금 번호 밖의 입금 정보가 없고, 로그·오류 응답에 입금자명·금액·글·계좌가 남지 않는다', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await register(world, seller, b.id, 15)
    await order(world, seller, b.id, 'UC_A', '다육이맘', '15')
    world.clock.advance(60_000)
    const api = depositApi(world, seller)
    await popbillSource(api)
    await expectOk(api.paste(pasteText([{ at: '2026-10-19 12:00:30', name: '다육이맘', amount: 14_000 }, { at: '2026-10-19 12:00:31', name: '실명홍길순', amount: 777 }])))
    await expectOk(api.confirm(2, { date: DAY, buyer: 'UC_A', remaining: 0 }))
    await expectOk(api.revert(2))
    await api.confirm(2, { date: DAY, buyer: 'UC_A', remaining: 123_456 })
    await api.preview('실명홍길순만 있는 글')
    const pg = world.database.pglite as PGlite
    const bodies = (await pg.query<{ body: string }>(`select body from events where type like 'settlement.%'`)).rows.map((row) => row.body).join('\n')
    expect(bodies).toContain('입금 #1')
    expect(bodies).not.toMatch(/실명홍길순|붙여넣기|국민|1234567890|110123456789/)
    const logs = JSON.stringify(world.logs)
    expect(logs).not.toMatch(/실명홍길순|다육이맘|777|14000|1234567890|110123456789/)
  })
})

describe('AC-N3-17 시험 모드 가짜 원천', () => {
  it('시험 모드에서만 가짜 원천과 시험용 입금 넣기가 있고, 넣은 줄은 다음 받아 오기에서 같은 저장·맞추기 흐름을 탄다', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await register(world, seller, b.id, 15)
    await order(world, seller, b.id, 'UC_A', '다육이맘', '15')
    world.clock.advance(60_000)
    const api = depositApi(world, seller)
    const fake = (await expectOk(api.createSource({ kind: 'FAKE' }))).body as { id: string; label: string }
    expect(fake.label).toBe('시험용 입금')
    expect((await expectOk(api.sources())).body).toMatchObject({ testMode: true })
    await expectOk(api.testRows(fake.id, [{ key: 'k1', at: '2026-10-19T12:00:30+09:00', amount: 14_000, name: '다육이맘' }]))
    expect(await deposits(api, 'AUTO_APPLIED')).toEqual([])
    await expectOk(api.fetch(fake.id))
    expect((await deposits(api, 'AUTO_APPLIED')).map((item) => [item.no, item.source.label])).toEqual([[1, '시험용 입금']])
    for (const bad of [{ key: '', at: '2026-10-19T12:00:30+09:00', amount: 1, name: 'x' }, { key: 'a', at: '2026-10-19 12:00', amount: 1, name: 'x' }, { key: 'a', at: '2026-10-19T12:00:30+09:00', amount: 0, name: 'x' }, { key: 'a', at: '2026-10-19T12:00:30+09:00', amount: 1, name: 'x', extra: 1 }]) {
      expect((await api.testRows(fake.id, [bad])).status).toBe(400)
    }
  })

  it('운영 기동(운영 설정 조립)에는 가짜 원천 종류와 시험용 입금 넣기 경로가 없다 — 경로는 404, 가짜 원천 만들기는 400', async () => {
    const database = await openTestDb()
    const env = { LIVEJJIM_MASTER_KEY: generateMasterKey(), LIVEJJIM_APP_ORIGIN: 'https://app.livejjim.test', E2E: '1', LIVEJJIM_TEST_DEPOSITS: '1' }
    const assembled = productionServerOptions(env, database)
    expect(assembled.ok).toBe(true)
    if (!assembled.ok) return
    expect(assembled.options.deposits).toMatchObject({ testMode: false, popbill: null })
    const server = createServer({ ...assembled.options, log: () => {} })
    const world = { server, database, masterKey: env.LIVEJJIM_MASTER_KEY, clock: { now: Date.now, set: () => {}, advance: () => {} }, logs: [] } as unknown as Parameters<typeof addSeller>[0]
    const seller = await addSeller(world)
    const api = client(world, seller.cookie)
    expect((await api.post('/api/deposits/test/rows', { source: 'x', rows: [] })).status).toBe(404)
    expect((await api.post('/api/deposits/test/chat', { b: 'x', id: 'm1', ch: 'UC1', nick: 'n', text: '1' })).status).toBe(404)
    const fake = await api.post('/api/deposits/sources', { kind: 'FAKE', label: '시험' })
    expect(fake.status).toBe(400)
    expect((await expectOk(api.get('/api/deposits/sources'))).body).toMatchObject({ testMode: false, popbill: false, sources: [] })
    server.close()
    const withKeys = productionServerOptions({ ...env, POPBILL_LINK_ID: 'LINK', POPBILL_SECRET_KEY: 'c2VjcmV0' }, database)
    expect(withKeys.ok && withKeys.options.deposits?.popbill !== null && withKeys.options.deposits?.popbill !== undefined).toBe(true)
    void rid
  })
})

describe('TD-N3-001 입금자명의 NUL(U+0000) — 줄 하나가 받아 오기·붙여넣기 전체를 막지 않는다 (AC-N3-13·15, DP-1)', () => {
  it('세 입구가 함께 쓰는 다듬기: NUL만 빼고 앞뒤 공백을 뺀 뒤 40자까지 — 다른 글자는 받은 그대로', () => {
    expect(cleanDepositName('김\u0000영희')).toBe('김영희')
    expect(cleanDepositName('\u0000 김영희 \u0000')).toBe('김영희')
    expect(cleanDepositName('\u0000\u0000')).toBe('')
    expect(cleanDepositName('김\u0007영희')).toBe('김\u0007영희')
    expect(cleanDepositName(`${'가'.repeat(20)}\u0000${'나'.repeat(30)}`)).toBe(`${'가'.repeat(20)}${'나'.repeat(20)}`)
    const read = readPaste('거래일시\t입금자명\t입금액\n2026-10-18 20:30\t김\u0000영희\t14,000')
    expect('rows' in read && read.rows.map((row) => row.name)).toEqual(['김영희'])
  })

  it('계좌조회: 입금자명에 NUL이 있는 줄도 그 글자만 빼고 저장하고, 같은 받아 오기의 다른 입금도 저장한다(오류 문장 없음). 다시 받아 와도 한 번', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    const api = depositApi(world, seller)
    world.popbill.register(ACCOUNT)
    world.popbill.addRows(ACCOUNT, [inRow('T1', '20261019103000', 14000, '김\u0000영희'), inRow('T2', '20261019103100', 5000, '박철수'), inRow('T3', '20261019103200', 3000, '\u0000', { remark2: '이\u0000민수' })])
    const source = await popbillSource(api)
    await expectOk(api.fetch(source.id))
    expect((await deposits(api)).map((item) => [item.name, item.amount]).sort()).toEqual([
      ['김영희', 14000],
      ['박철수', 5000],
      ['이민수', 3000],
    ])
    const view = ((await expectOk(api.sources())).body as { sources: { id: string; lastError: string | null; lastNew: number }[] }).sources.find((item) => item.id === source.id)
    expect(view).toMatchObject({ lastError: null, lastNew: 3 })
    await world.server.deposits.runSource(seller.sellerId, source.id)
    expect(await deposits(api)).toHaveLength(3)
  })

  it('붙여넣기: 미리 보기가 "새 입금"이라고 한 글은 넣으면 그대로 저장된다(500 없음), 미리 보기·저장의 이름이 같고 다시 넣으면 이미 있는 입금', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    world.clock.advance(60_000)
    const api = depositApi(world, seller)
    const text = '거래일시\t입금자명\t입금액\n2026-10-19 10:30\t김\u0000영희\t14,000\n2026-10-19 10:31\t박철수\t5,000'
    const preview = (await expectOk(api.preview(text))).body as { rows: { name: string; state: string }[] }
    expect(preview.rows.map((row) => [row.name, row.state])).toEqual([
      ['김영희', 'NEW'],
      ['박철수', 'NEW'],
    ])
    expect((await expectOk(api.paste(text))).body).toMatchObject({ new: 2, existing: 0 })
    expect((await deposits(api)).map((item) => item.name).sort()).toEqual(['김영희', '박철수'])
    expect(((await expectOk(api.preview(text))).body as { rows: { state: string }[] }).rows.map((row) => row.state)).toEqual(['EXISTING', 'EXISTING'])
    expect((await expectOk(api.paste(text))).body).toMatchObject({ new: 0, existing: 2 })
  })

  it('시험용 입금 줄의 NUL도 같은 다듬기 — 다듬은 이름으로 맞춘다(자동 확인)', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await register(world, seller, b.id, 15)
    await order(world, seller, b.id, 'UC_A', '다육이맘', '15')
    world.clock.advance(60_000)
    const api = depositApi(world, seller)
    const fake = (await expectOk(api.createSource({ kind: 'FAKE' }))).body as { id: string }
    await expectOk(api.testRows(fake.id, [{ key: 'k1', at: '2026-10-19T12:00:30+09:00', amount: 14_000, name: '다육\u0000이맘' }]))
    await expectOk(api.fetch(fake.id))
    expect((await deposits(api, 'AUTO_APPLIED')).map((item) => item.name)).toEqual(['다육이맘'])
  })
})

describe('TD-N3-003·SA-N3-08 입금자명의 짝 없는 서로게이트 — 줄 하나가 받아 오기·붙여넣기 전체를 막지 않는다 (AC-N3-13·15, DP-1)', () => {
  it('다듬기: 짝 없는 서로게이트는 U+FFFD로 바꾸고, 짝이 맞는 글자(이모지)는 그대로', () => {
    expect(cleanDepositName('김\uDC00영희')).toBe('김\uFFFD영희')
    expect(cleanDepositName('김\uD800')).toBe('김\uFFFD')
    expect(cleanDepositName('다육🌵맘')).toBe('다육🌵맘')
    expect(cleanDepositName('\uDC00\u0000 김영희')).toBe('\uFFFD 김영희')
  })

  it('계좌조회: 서로게이트가 든 줄도 저장하고, 같은 받아 오기의 다른 입금도 저장한다(오류 문장 없음)', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    const api = depositApi(world, seller)
    world.popbill.register(ACCOUNT)
    world.popbill.addRows(ACCOUNT, [inRow('T1', '20261019103000', 14000, '김\uDC00영희'), inRow('T2', '20261019103100', 5000, '박철수')])
    const source = await popbillSource(api)
    await expectOk(api.fetch(source.id))
    expect((await deposits(api)).map((item) => [item.name, item.amount]).sort()).toEqual([
      ['김\uFFFD영희', 14000],
      ['박철수', 5000],
    ])
    const view = ((await expectOk(api.sources())).body as { sources: { id: string; lastError: string | null }[] }).sources.find((item) => item.id === source.id)
    expect(view).toMatchObject({ lastError: null })
  })

  it('붙여넣기: 미리 보기 "새 입금" 두 줄은 넣으면 두 줄 다 저장된다(500 없음)', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    world.clock.advance(60_000)
    const api = depositApi(world, seller)
    const text = '거래일시\t입금자명\t입금액\n2026-10-19 10:30\t김\uDC00영희\t14,000\n2026-10-19 10:31\t박철수\t5,000'
    const preview = (await expectOk(api.preview(text))).body as { rows: { name: string; state: string }[] }
    expect(preview.rows.map((row) => [row.name, row.state])).toEqual([
      ['김\uFFFD영희', 'NEW'],
      ['박철수', 'NEW'],
    ])
    expect((await expectOk(api.paste(text))).body).toMatchObject({ new: 2, existing: 0, failed: 0 })
  })

  it('그물: DB가 받지 못하는 줄이 다듬기를 지나 들어와도 그 줄만 건너뛰고(failed) 나머지는 빈 번호 없이 저장한다', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    world.clock.advance(60_000)
    const api = depositApi(world, seller)
    const fake = (await expectOk(api.createSource({ kind: 'FAKE' }))).body as { id: string }
    const at = (iso: string) => Date.parse(iso)
    // 서버 안 입구(ingest)는 다듬기를 거치지 않는다 — NUL 이름으로 저장 실패를 일부러 만든다
    const summary = await world.server.deposits.ingest(seller.sellerId, fake.id, [
      { key: 'k1', at: at('2026-10-19T10:30:00+09:00'), precision: 'second', amount: 14_000, name: '김\u0000영희' },
      { key: 'k2', at: at('2026-10-19T10:31:00+09:00'), precision: 'second', amount: 5_000, name: '박철수' },
      { key: 'k3', at: at('2026-10-19T10:32:00+09:00'), precision: 'second', amount: 3_000, name: '이민수' },
    ])
    expect(summary).toMatchObject({ stored: [1, 2], failed: 1, existing: 0 })
    expect((await deposits(api)).map((item) => [item.no, item.name]).sort()).toEqual([
      [1, '박철수'],
      [2, '이민수'],
    ])
    expect(world.logs.some((line) => JSON.stringify(line).includes('DEPOSIT_ROW_SAVE_FAILED'))).toBe(true)
    expect(JSON.stringify(world.logs)).not.toContain('박철수')
  })
})

describe('SA-N3-03 시험용 시청자 채팅 (시험 모드에서만, D-N3-12) — 실제 방송에 유튜브 구매자를 만든다', () => {
  it('실제 방송에 수집 함수와 같은 기록(조치자 수집기)으로 찜이 남고 유튜브 구매자 묶음이 생긴다. 같은 메시지는 한 번, 모르는 항목·다른 판매자 방송은 거절', async () => {
    const world = await depositWorld()
    const seller = await addSeller(world)
    const other = await addSeller(world)
    const b = await createBroadcast(world, seller, { date: DAY })
    await register(world, seller, b.id, 15)
    const api = depositApi(world, seller)
    const chat = { b: b.id, id: 'tm-1', ch: 'UC_TEST', nick: '다육이맘', text: '15' }
    expect((await expectOk(api.api.post('/api/deposits/test/chat', chat))).body).toMatchObject({ recorded: true, date: DAY })
    expect((await expectOk(api.api.post('/api/deposits/test/chat', chat))).body).toEqual({ recorded: false })
    const day = (await expectOk(api.day(DAY))).body as { buyers: { id: string; kind: string; display: string }[]; settlements: { buyer: string; total: number }[] }
    expect(day.buyers.find((item) => item.id === 'UC_TEST')).toMatchObject({ kind: 'youtube', display: '다육이맘' })
    expect(day.settlements.find((item) => item.buyer === 'UC_TEST')).toMatchObject({ total: 14_000 }) // 상품 10,000 + 배송비 4,000
    const unknown = await api.api.post('/api/deposits/test/chat', { ...chat, id: 'tm-2', owner: true })
    expect(unknown.status).toBe(400)
    expect((unknown.body as { error: { code: string } }).error.code).toBe('UNKNOWN_FIELD')
    expect((await depositApi(world, other).api.post('/api/deposits/test/chat', { ...chat, id: 'tm-3' })).status).toBe(404)
    expect((await api.api.post('/api/deposits/test/chat', { ...chat, id: '' })).status).toBe(400)
  })
})

describe('RA-N3-001 팝빌 사업자번호는 판매자에게 묶인다 (DP-1 비밀값, SYS-02)', () => {
  const X = { corpNum: '1111111111', bankCode: '0004', accountNumber: '11110000111' }
  const TAKEN = '이 사업자번호는 이 계정에서 쓸 수 없어요. 사업자번호를 확인해 주세요.'
  const MISMATCH = '이 계정에 연결한 사업자번호와 달라요. 사업자번호를 확인해 주세요.'
  const sourceOf = (api: ReturnType<typeof depositApi>, account: typeof X) => api.createSource({ kind: 'POPBILL', label: '국민', corpNum: account.corpNum, bank: account.bankCode, accountNumber: account.accountNumber })
  const manage = (api: ReturnType<typeof depositApi>, corpNum: string) => api.api.post('/api/deposits/popbill/manage-url', { corpNum })

  it('팝빌이 처음 답한 판매자(받아 오기 성공)에게 묶이고, 다른 판매자는 그 번호로 원천도 계좌 관리 주소도 얻지 못한다 — 팝빌을 부르지도 않는다', async () => {
    const world = await depositWorld()
    const a = depositApi(world, await addSeller(world))
    const b = depositApi(world, await addSeller(world))
    world.popbill.register(X).addRows(X, [inRow('T1', '20261019103000', 14000, '김영희')])
    const source = (await expectOk(sourceOf(a, X))).body as { id: string }
    await expectOk(a.fetch(source.id))
    expect((await deposits(a)).map((item) => item.name)).toEqual(['김영희'])
    const before = world.popbill.calls.length
    const created = await sourceOf(b, X)
    expect(created.status).toBe(409)
    expect(created.body).toEqual({ error: { code: 'CORP_NOT_ALLOWED', message: TAKEN } })
    const url = await manage(b, '111-11-11111')
    expect(url.status).toBe(409)
    expect(url.body).toEqual({ error: { code: 'CORP_NOT_ALLOWED', message: TAKEN } })
    expect(world.popbill.calls.slice(before)).toEqual([])
    expect(await deposits(b)).toEqual([])
    // 묶은 값은 되돌릴 수 없는 키뿐 — 사업자번호 평문이 DB에 없다
    expect(await dumpAllTables(world.database)).not.toContain(X.corpNum)
    // 묶인 판매자는 그대로 쓴다
    expect((await expectOk(manage(a, X.corpNum))).body).toEqual({ url: `${FAKE_POPBILL_MGT_URL}?TG=BankAccount` })
  })

  it('계좌 관리 주소를 받으면 묶인다(그 뒤 다른 판매자는 거절). 판매자마다 사업자번호 하나 — 묶인 판매자가 다른 번호를 쓰면 거절', async () => {
    const world = await depositWorld()
    const a = depositApi(world, await addSeller(world))
    const b = depositApi(world, await addSeller(world))
    await expectOk(manage(a, X.corpNum))
    expect((await sourceOf(b, X)).body).toEqual({ error: { code: 'CORP_NOT_ALLOWED', message: TAKEN } })
    expect((await manage(b, X.corpNum)).status).toBe(409)
    const other = { corpNum: '2222222222', bankCode: '0088', accountNumber: '22220000222' }
    expect((await sourceOf(a, other)).body).toEqual({ error: { code: 'CORP_NOT_ALLOWED', message: MISMATCH } })
    expect((await manage(a, other.corpNum)).body).toEqual({ error: { code: 'CORP_NOT_ALLOWED', message: MISMATCH } })
    // b는 아직 묶이지 않았다 — 다른 번호는 쓸 수 있다
    await expectOk(manage(b, other.corpNum))
    expect(((await expectOk(a.sources())).body as { sources: unknown[] }).sources).toEqual([])
  })

  it('팝빌이 답하지 않은 번호(잘못 적은 번호·등록 안 된 계좌·실패)는 묶이지 않는다 — 고쳐 적은 번호로 다시 연결할 수 있다', async () => {
    const world = await depositWorld()
    const a = depositApi(world, await addSeller(world))
    const typo = { ...X, corpNum: '1111111112' }
    const wrong = (await expectOk(sourceOf(a, typo))).body as { id: string }
    await expectOk(a.fetch(wrong.id))
    const failed = ((await expectOk(a.sources())).body as { sources: { id: string; lastError: string | null }[] }).sources.find((item) => item.id === wrong.id)
    expect(failed?.lastError).toBe('팝빌에 등록되지 않은 계좌예요. 팝빌 계좌 관리에서 등록해 주세요.')
    world.popbill.fail('getBankAccountMgtURL', 'AUTH')
    expect((await manage(a, '3333333333')).status).toBe(503)
    world.popbill.fail('getBankAccountMgtURL', null)
    world.popbill.register(X)
    const right = (await expectOk(sourceOf(a, X))).body as { id: string }
    await expectOk(a.fetch(right.id))
    const ok = ((await expectOk(a.sources())).body as { sources: { id: string; lastError: string | null; lastFetchedAt: string | null }[] }).sources.find((item) => item.id === right.id)
    expect(ok?.lastError).toBeNull()
    expect(ok?.lastFetchedAt).not.toBeNull()
    // 이제 X에 묶였다 — 잘못 적은 번호의 원천은 팝빌을 부르지 않고 "달라요" 문장
    world.clock.advance(61_000)
    const before = world.popbill.calls.length
    await expectOk(a.fetch(wrong.id))
    expect(world.popbill.calls.slice(before)).toEqual([])
    const after = ((await expectOk(a.sources())).body as { sources: { id: string; lastError: string | null }[] }).sources.find((item) => item.id === wrong.id)
    expect(after?.lastError).toBe(MISMATCH)
  })

  it('원천을 만든 뒤 다른 판매자가 그 번호를 먼저 묶으면, 받아 오기는 팝빌을 부르지 않고 아무것도 저장하지 않는다', async () => {
    const world = await depositWorld()
    const a = depositApi(world, await addSeller(world))
    const b = depositApi(world, await addSeller(world))
    world.popbill.register(X).addRows(X, [inRow('T1', '20261019103000', 14000, '김영희')])
    const source = (await expectOk(sourceOf(a, X))).body as { id: string }
    await expectOk(manage(b, X.corpNum))
    const before = world.popbill.calls.length
    await expectOk(a.fetch(source.id))
    expect(world.popbill.calls.slice(before)).toEqual([])
    expect(await deposits(a)).toEqual([])
    const view = ((await expectOk(a.sources())).body as { sources: { id: string; lastError: string | null }[] }).sources.find((item) => item.id === source.id)
    expect(view?.lastError).toBe(TAKEN)
  })
})
