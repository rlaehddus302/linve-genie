// KP1 손님 장부 — 지우는 날·정리 작업(AC-KP1-06, 가짜 시계)과 손님·판매자 지우기(AC-KP1-07), 정리 작업이 방송 일정 정리(sweepSchedule)도 부른다(AC-KP1-24).
import { describe, expect, it } from 'vitest'
import { LedgerSweeper } from '../src/customers/ledger-sweep.ts'
import type { LedgerService } from '../src/customers/ledger.ts'
import { at } from './i2-support.ts'
import { parcelApi } from './t1-support.ts'
import { D, codes, consent, consents, kst, ledgerApi, ledgerWorld, lines, markers, openLink, postForm, rowsOf, sell } from './kp1-ledger-support.ts'

const JAN = '2026-01-31'

/** 가짜 타이머: sleep은 advance로 그 시간이 지나거나 끊기면 풀린다 */
function fakeTimer(start = Date.UTC(2026, 9, 19)) {
  let now = start
  const waits: { until: number; resolve: () => void }[] = []
  return {
    now: () => now,
    sleep(ms: number, signal?: AbortSignal): Promise<void> {
      return new Promise<void>((resolve) => {
        waits.push({ until: now + ms, resolve })
        signal?.addEventListener('abort', () => resolve(), { once: true })
      })
    },
    advance(ms: number): void {
      now += ms
      for (const wait of waits.splice(0)) if (wait.until <= now) wait.resolve()
      else waits.push(wait)
    },
  }
}

describe('AC-KP1-06 지우는 날 (가짜 시계, retention.json 값)', () => {
  it('마지막 주문 2026-01-31·동의 24개월·설정 12개월 → 2027-01-31 0시 KST가 지난 첫 정리에서 줄·표지·코드가 사라지고 EXPIRE 기간 지남', async () => {
    const { world, seller } = await ledgerWorld(kst(JAN, '20:00:00'))
    await world.server.ledger.saveSettings(seller.sellerId, { months: 24, consoleBadges: true })
    await sell(world, seller, [['UC_A', '가람', 1]], JAN)
    const token = await consent(world, seller, 'UC_A', JAN)
    expect((await postForm(world, `/r/${token}/ledger/code`, {})).status).toBe(303)
    expect((await lines(world))[0]?.consent_months).toBe(24)
    await world.server.ledger.saveSettings(seller.sellerId, { months: 12, consoleBadges: true })
    world.clock.set(kst('2027-01-30', '23:59:59'))
    await world.server.ledgerSweeper.runOnce()
    expect(await lines(world)).toHaveLength(1)
    world.clock.set(kst('2027-01-31', '00:00:00'))
    await world.server.ledgerSweeper.runOnce()
    expect(await lines(world)).toEqual([])
    expect(await markers(world)).toEqual([])
    expect(await codes(world)).toEqual([])
    expect((await consents(world)).map((row) => [row.type, row.reason, row.months])).toEqual([
      ['AGREE', null, 24],
      ['EXPIRE', '기간 지남', 24],
    ])
  })

  it('설정을 6개월로 줄이면 다음 정리에서 이미 지난 줄은 바로 지운다', async () => {
    const { world, seller } = await ledgerWorld(kst(JAN, '20:00:00'))
    await sell(world, seller, [['UC_A', '가람', 1]], JAN)
    await consent(world, seller, 'UC_A', JAN)
    world.clock.set(kst('2026-08-01', '09:00:00'))
    await world.server.ledgerSweeper.runOnce()
    expect(await lines(world)).toHaveLength(1)
    await world.server.ledger.saveSettings(seller.sellerId, { months: 6, consoleBadges: true })
    await world.server.ledgerSweeper.runOnce()
    expect(await lines(world)).toEqual([])
  })

  it('기한 지난 연결 코드는 정리에서 끝난다(DONE)', async () => {
    const { world, seller } = await ledgerWorld()
    await sell(world, seller, [['UC_A', '가람', 1]])
    const token = await consent(world, seller, 'UC_A')
    expect((await postForm(world, `/r/${token}/ledger/code`, {})).status).toBe(303)
    world.clock.set(world.clock.now() + 24 * 60 * 60 * 1000)
    await world.server.ledgerSweeper.runOnce()
    expect((await codes(world)).map((row) => row.state)).toEqual(['DONE'])
  })

  it('정리 작업은 방송 일정 정리도 부른다: 지난 일정은 지운다. 한쪽이 실패해도 다른 쪽은 돈다', async () => {
    const { world, seller } = await ledgerWorld()
    const now = world.clock.now()
    for (const [id, startsAt] of [
      ['past', now - 60_000],
      ['next', now + 86_400_000],
    ] as const) {
      await rowsOf(world, 'insert into schedule_items (id, seller_id, starts_at, title, intro, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $6)', [id, seller.sellerId, new Date(startsAt), '방송', '', new Date(now)])
    }
    await world.server.ledgerSweeper.runOnce()
    expect((await rowsOf(world, 'select id from schedule_items')).map((row) => row.id)).toEqual(['next'])

    const called: number[] = []
    const failing = { sweepOnce: () => Promise.reject(new Error('x')) } as unknown as LedgerService
    const timer = fakeTimer()
    const logs: string[] = []
    const sweeper = new LedgerSweeper({ ledger: failing, timer, log: (record) => logs.push(record.code), schedule: (when) => Promise.resolve(void called.push(when.getTime())) })
    await sweeper.runOnce()
    expect(called).toEqual([timer.now()])
    expect(logs).toEqual(['LEDGER_SWEEP_FAILED'])
  })

  it('시작 때 한 번, 그 뒤 1시간마다 (멈추면 그친다)', async () => {
    const timer = fakeTimer()
    let runs = 0
    const ledger = { sweepOnce: () => Promise.resolve(void (runs += 1)) } as unknown as LedgerService
    const sweeper = new LedgerSweeper({ ledger, timer, log: () => undefined })
    sweeper.start()
    await new Promise((resolve) => setImmediate(resolve))
    expect(runs).toBe(1)
    timer.advance(60 * 60 * 1000)
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))
    expect(runs).toBe(2)
    await sweeper.stop()
  })
})

describe('AC-KP1-07 손님·판매자 지우기', () => {
  it('링크 [저장한 정보 지우기] → 확인 → 바로 지움 + "지웠어요."(WITHDRAW). 묶음 배송지·동의 기록은 그대로', async () => {
    const { world, seller } = await ledgerWorld()
    await sell(world, seller, [['UC_A', '가람', 1]])
    const token = await consent(world, seller, 'UC_A')
    const confirmPage = await openLink(world, `/r/${token}?ledger=delete`)
    expect(confirmPage.text).toContain('저장한 배송지를 지울까요? 이번 주문 배송지는 그대로예요.')
    expect(confirmPage.text).toContain(`action="/r/${token}/ledger/delete"`)
    expect(confirmPage.text).toContain('그대로 두기')
    const done = await postForm(world, `/r/${token}/ledger/delete`, {})
    expect(done.status).toBe(303)
    expect(done.headers.get('location')).toBe(`/r/${token}?ledger=deleted#ledger`)
    expect((await openLink(world, `/r/${token}?ledger=deleted`)).text).toContain('지웠어요.')
    expect(await lines(world)).toEqual([])
    expect((await consents(world)).map((row) => [row.type, row.route, row.order_date])).toEqual([
      ['AGREE', 'RECEIPT_LINK', D],
      ['WITHDRAW', 'RECEIPT_LINK', D],
    ])
    expect(((await parcelApi(world, seller.cookie).bundle('UC_A')).body.bundle as { address: unknown }).address).not.toBeNull()
    // 다른 곳에서 보낸 양식은 받지 않는다
    expect((await postForm(world, `/r/${token}/ledger/delete`, {}, { Origin: 'https://evil.test' })).status).toBe(403)
  })

  it('판매자 손님 자세히 [장부에서 지우기] → SELLER_DELETE(계정). 다시 지우면 409 이미 지운 장부', async () => {
    const { world, seller } = await ledgerWorld()
    await sell(world, seller, [['UC_A', '가람', 1]])
    at(world, D, '20:30:00')
    await consent(world, seller, 'UC_A')
    const api = ledgerApi(world, seller.cookie)
    const id = ((await api.customers()).body.customers as { id: string }[])[0]?.id as string
    const detail = await api.customer(id)
    const ledger = detail.body.ledger as { ledgerId: string; name: string; phoneLast4: string; keepUntil: string; consentDate: string; linked: unknown[] }
    expect(ledger).toEqual({ ledgerId: (await lines(world))[0]?.id, name: '홍*동', phoneLast4: '5678', keepUntil: '2027-10-19', consentDate: D, linked: [] })
    expect(detail.text).not.toContain('세종대로')
    const deleted = await api.deleteLedger(id, ledger.ledgerId)
    expect(deleted.status, deleted.text).toBe(200)
    expect(deleted.body).toEqual({ ledger: null })
    expect((await api.customer(id)).body.ledger).toBeNull()
    expect((await consents(world)).at(-1)).toMatchObject({ type: 'SELLER_DELETE', account_id: seller.accountId })
    expect((await api.deleteLedger(id, ledger.ledgerId)).body.error).toMatchObject({ code: 'NO_LEDGER', message: '이미 지운 장부예요.' })
    expect((await api.deleteLedger('f'.repeat(32), ledger.ledgerId)).status).toBe(404)
    expect((await api.deleteLedger(id, 'nope')).status).toBe(400)
  })
})
