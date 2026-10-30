// KP1 위험 감사 고침 (장부 정리·연결 코드): RA-KP1-002(못 읽은 날이 있으면 건너뜀)·003(표지 옮김이 고친 시각을 바꿈, 100줄 묶음)·
// 005(끝난 코드의 친 사람 칸 비우기, 오래된 DONE 지우기)·009(후보 판매자만, 공용 재료 캐시를 건드리지 않음)·TD-KP1-002(최근에 끝난 코드와 겹치지 않음).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { factsBuildCount, factsCacheStats, forgetCustomerCaches } from '../src/customers/facts.ts'
import { SWEEP_BATCH } from '../src/customers/ledger.ts'
import { LINK_CODE_WORDS } from '../src/customers/ledger-rules.ts'
import { RECENT_CODE_MS, recentCodes } from '../src/customers/ledger-store.ts'
import { WORK_BUSY_MESSAGE } from '../src/closing.ts'
import { isServerPath } from '../src/web.ts'
import { WorkBusy, WorkFailed } from '../src/work-pool.ts'
import { at, chat } from './i2-support.ts'
import { attempts, bookOk, packAll, pay } from './t1-support.ts'
import { login, waitFor } from './support.ts'
import { codes, consent, kst, ledgerApi, ledgerWorld, lines, logText, openLink, postForm, rowsOf, sell } from './kp1-ledger-support.ts'

const JAN = '2026-01-31'
const JUN = '2026-06-01'
const DAY = 24 * 60 * 60 * 1000

afterEach(() => {
  vi.restoreAllMocks()
})

async function newCode(world: Parameters<typeof postForm>[0], token: string): Promise<string> {
  const sent = await postForm(world, `/r/${token}/ledger/code`, {})
  expect(sent.status, sent.text).toBe(303)
  const live = (await codes(world)).filter((row) => row.state === 'LIVE')
  expect(live).toHaveLength(1)
  return live[0]?.code as string
}

describe('RA-KP1-002 봉인 장부를 못 읽은 날이 있으면 그 판매자 장부는 이번에 지우지 않는다', () => {
  it('6월 주문이 든 봉인 장부가 깨지면 1월 동의 줄을 7월 31일 기준으로 지우지 않고, 로그는 판매자 ID·개수만', async () => {
    const { world, seller } = await ledgerWorld(kst(JAN, '20:00:00'))
    await sell(world, seller, [['UC_A', '가람', 1]], JAN)
    await consent(world, seller, 'UC_A', JAN)
    at(world, JUN, '20:00:00')
    const again = { ...seller, cookie: await login(world, seller.loginId, seller.password) }
    await sell(world, again, [['UC_A', '가람', 1]], JUN)
    // 6월 날짜가 봉인됐는데 장부 글을 읽을 수 없다
    await rowsOf(world, `update scopes set sealed_at = now(), ledger = '{"format":"livejjim-ledger/9"}' where seller_id = $1 and date = $2 and rehearsal = false`, [seller.sellerId, JUN])
    world.clock.set(kst('2026-08-01', '09:00:00'))
    world.logs.splice(0)
    await world.server.ledgerSweeper.runOnce()
    expect(await lines(world)).toHaveLength(1)
    const skipped = world.logs.filter((entry) => (entry as { code?: string }).code === 'LEDGER_SWEEP_SKIPPED')
    expect(skipped).toHaveLength(1)
    expect(Object.keys(skipped[0] as object).sort()).toEqual(['code', 'count', 'level', 'seller'])
    expect(skipped[0]).toMatchObject({ seller: seller.sellerId, count: 1 })
    expect(logText(world)).not.toContain('UC_A')
  })
})

describe('RA-KP1-003 정리는 그사이 바뀐 줄을 지우지 않고, 100줄마다 따로 트랜잭션', () => {
  it('[네]로 표지를 옮기면 받는 줄의 고친 시각이 바뀐다', async () => {
    const { world, seller } = await ledgerWorld()
    const b = await sell(world, seller, [['UC_A', '가람', 1]])
    const token = await consent(world, seller, 'UC_A')
    const before = ((await lines(world))[0]?.updated_at as Date).getTime()
    const code = await newCode(world, token)
    at(world, '2026-10-19', '20:30:00')
    await chat(world, seller, b, 'c-1', 'UC_Z', '제트', code)
    await waitFor(async () => (await codes(world)).at(-1)?.state === 'CLAIMED')
    expect((await postForm(world, `/r/${token}/ledger/link`, { answer: 'yes' })).status).toBe(303)
    const after = ((await lines(world))[0]?.updated_at as Date).getTime()
    expect(after).toBeGreaterThan(before)
    expect(after).toBe(world.clock.now())
  })

  it(`기한 지난 줄 ${String(SWEEP_BATCH + 50)}개는 ${String(SWEEP_BATCH)}줄 묶음 두 번의 트랜잭션으로 모두 지운다`, async () => {
    const { world, seller } = await ledgerWorld()
    const total = SWEEP_BATCH + 50
    const values = Array.from({ length: total }, (_, i) => `('old-${String(i).padStart(4, '0')}', '${seller.sellerId}', 'x', '${JAN}', 6, now(), now())`).join(',')
    await rowsOf(world, `insert into ledger_lines (id, seller_id, contact_enc, consent_date, consent_months, created_at, updated_at) values ${values}`)
    world.clock.set(kst('2026-08-01', '09:00:00'))
    const transaction = vi.spyOn(world.database.db, 'transaction')
    await world.server.ledger.sweepOnce()
    expect(await lines(world)).toEqual([])
    expect(transaction).toHaveBeenCalledTimes(2)
    expect((await rowsOf(world, `select count(*)::int as n from ledger_consents where type = 'EXPIRE'`))[0]?.n).toBe(total)
  })
})

describe('RA-KP1-009 정리는 후보 판매자만, 공용 재료 캐시를 건드리지 않는다', () => {
  it('최근에 동의한 줄만 있으면 재료를 세우지 않고, 오래된 줄이 있어도 캐시에 넣지 않는다', async () => {
    const { world, seller } = await ledgerWorld()
    await sell(world, seller, [['UC_A', '가람', 1]])
    await consent(world, seller, 'UC_A')
    forgetCustomerCaches()
    const builds = factsBuildCount()
    await world.server.ledger.sweepOnce()
    expect(factsBuildCount()).toBe(builds)
    // 180일 넘게 지나면 후보 — 재료를 세우되 캐시에는 넣지 않는다
    world.clock.set(world.clock.now() + 181 * DAY)
    await world.server.ledger.sweepOnce()
    expect(factsBuildCount()).toBeGreaterThan(builds)
    expect(factsCacheStats().entries).toBe(0)
    expect(await lines(world)).toHaveLength(1)
  })
})

describe('RA-KP1-005 끝난 코드는 친 사람 칸을 비우고, 오래된 DONE 행은 정리에서 지운다', () => {
  it('[아니에요]·기한 지남으로 끝나면 claimed_* 없음, 기한 + 25시간이 지나면 행이 없다', async () => {
    const { world, seller } = await ledgerWorld()
    const b = await sell(world, seller, [['UC_A', '가람', 1]])
    const token = await consent(world, seller, 'UC_A')
    const code = await newCode(world, token)
    await chat(world, seller, b, 'c-1', 'UC_Z', '제트', code)
    await waitFor(async () => (await codes(world)).at(-1)?.state === 'CLAIMED')
    await postForm(world, `/r/${token}/ledger/link`, { answer: 'no' })
    const done = (await codes(world)).at(-1)
    expect(done).toMatchObject({ state: 'DONE', claimed_marker: null, claimed_platform: null, claimed_name: null, claimed_last4: null, claimed_at: null })
    // 두 번째 코드는 친 뒤 확인 없이 기한이 지난다
    at(world, '2026-10-19', '20:30:00')
    const second = await newCode(world, token)
    await chat(world, seller, b, 'c-2', 'UC_Y', '와이', second)
    await waitFor(async () => (await codes(world)).at(-1)?.state === 'CLAIMED')
    world.clock.set(world.clock.now() + DAY)
    await world.server.ledger.sweepOnce()
    expect((await codes(world)).map((row) => [row.state, row.claimed_marker, row.claimed_name])).toEqual([
      ['DONE', null, null],
      ['DONE', null, null],
    ])
    expect(logText(world)).not.toContain('와이')
    // 첫 코드 기한(20:00 + 24시간) + 25시간이 지나면 첫 행만 지운다
    world.clock.set(kst('2026-10-21', '21:00:00'))
    await world.server.ledger.sweepOnce()
    expect((await codes(world)).map((row) => row.code)).toEqual([second])
    world.clock.set(kst('2026-10-21', '21:30:00'))
    await world.server.ledger.sweepOnce()
    expect(await codes(world)).toEqual([])
    expect(await lines(world)).toHaveLength(1)
  })
})

describe('TD-KP1-002 새 연결 코드는 최근에 끝난 코드와 겹치지 않는다', () => {
  it('끝난 지 25시간이 안 된 코드를 모두 피하고(남은 것이 없으면 "가득"), 더 오래된 것은 다시 쓸 수 있다', async () => {
    const { world, seller } = await ledgerWorld()
    await sell(world, seller, [['UC_A', '가람', 1]])
    const token = await consent(world, seller, 'UC_A')
    const first = await newCode(world, token)
    const lineId = (await lines(world))[0]?.id as string
    const all: string[] = []
    for (const a of LINK_CODE_WORDS) for (const b of LINK_CODE_WORDS) if (a !== b) all.push(`${a} ${b}`)
    const others = all.filter((code) => code !== first)
    const now = world.clock.now()
    const values = others.map((code, i) => `('done-${String(i)}', '${seller.sellerId}', '${lineId}', '${code}', to_timestamp(${String(now / 1000)}), to_timestamp(${String((now - DAY) / 1000)}), 'DONE')`).join(',')
    await rowsOf(world, `insert into ledger_codes (id, seller_id, line_id, code, created_at, expires_at, state) values ${values}`)
    expect((await recentCodes(world.database.db, seller.sellerId, new Date(now - RECENT_CODE_MS))).length).toBe(all.length)
    // 첫 코드를 끝내면 고를 코드가 하나도 없다 — 방금 끝낸 코드를 다시 주지 않는다
    const full = await postForm(world, `/r/${token}/ledger/code`, {})
    expect(full.status).toBe(409)
    expect((await codes(world)).filter((row) => row.state === 'LIVE')).toEqual([])
    // 다른 코드들이 25시간보다 오래되면 그중 하나를 준다 (방금 끝낸 첫 코드는 아님)
    await rowsOf(world, `update ledger_codes set expires_at = to_timestamp($1) where id like 'done-%'`, [(now - RECENT_CODE_MS - 60_000) / 1000])
    const again = await newCode(world, token)
    expect(again).not.toBe(first)
    expect((await openLink(world, `/r/${token}`)).text).toContain(again)
  })
})

describe('공개 일정 주소는 서버 경로 (화면 문서로 빠지지 않는다)', () => {
  it('/s·/s/<토큰>은 서버 경로, /settings·/settlements는 화면', () => {
    expect([isServerPath('/s'), isServerPath('/s/abc'), isServerPath('/settings'), isServerPath('/settlements'), isServerPath('/sales')]).toEqual([true, true, false, false, false])
  })
})

describe('RA-KP1-008 손님 엑셀은 판매대장과 같은 작업 풀(documents)에서 만든다', () => {
  it('작업 워커가 만든 파일을 주고, 밀려 있으면 429(판매대장과 같은 문장)·받은 기록 없음, 못 끝내면 500', async () => {
    const { world, seller } = await ledgerWorld()
    await sell(world, seller, [['UC_A', '가람', 1]])
    const run = vi.spyOn(world.server.work.documents, 'run')
    const api = ledgerApi(world, seller.cookie)
    const ok = await api.xlsx('0')
    expect(ok.status).toBe(200)
    expect(new Uint8Array(await ok.arrayBuffer()).slice(0, 2)).toEqual(new Uint8Array([0x50, 0x4b]))
    expect(run.mock.calls.map((call) => [call[0], call[1]])).toEqual([[seller.sellerId, 'customersXlsx']])
    const exportsBefore = await rowsOf(world, 'select id from customer_exports')
    run.mockRejectedValueOnce(new WorkBusy())
    const busy = await api.xlsx('1')
    expect(busy.status).toBe(429)
    expect(await busy.text()).toContain(WORK_BUSY_MESSAGE)
    run.mockRejectedValueOnce(new WorkFailed('timeout'))
    expect((await api.xlsx('1')).status).toBe(500)
    expect(await rowsOf(world, 'select id from customer_exports')).toEqual(exportsBefore)
  })
})

describe('SA-KP1-001 접수 직전 다시 판단도 장부 "확인 전" 묶음을 ADDRESS_UNCONFIRMED로 (PC-3·PC-4)', () => {
  it('입금·포장이 끝나 배송지만 장부 "확인 전"인 묶음을 접수하면 ADDRESS_UNCONFIRMED, 시도·택배사 접수 없음', async () => {
    const { world, seller } = await ledgerWorld()
    await sell(world, seller, [['UC_A', '가람', 1]])
    await consent(world, seller, 'UC_A')
    const D2 = '2026-10-26'
    at(world, D2, '20:00:00')
    await sell(world, seller, [['UC_A', '가람', 1]], D2)
    await pay(world, seller, 'UC_A', undefined, D2)
    await packAll(world, seller, 'UC_A', D2)
    const [result] = await bookOk(world, seller, [{ buyer: 'UC_A' }], D2)
    expect(result).toMatchObject({ buyer: 'UC_A', ok: false, reason: 'ADDRESS_UNCONFIRMED' })
    expect(await attempts(world, seller.sellerId, 'UC_A')).toEqual([])
  })
})
