// N3 적대 테스트 (test-domain) 라운드 2: 수정(라운드 2 dev-server)으로 생긴 길을 다시 공격한다.
// - 저장점 그물(SA-N3-08): 이름이 아닌 칸(팝빌 고유번호·시험용 줄 키)이 DB가 받지 못하는 글자일 때, 나머지 줄 저장·번호·자동 확인·다시 받기
// - 원천 표시 이름(판매자가 적는 글)의 짝 없는 서로게이트 — 이름 다듬기(cleanDepositName) 밖의 다른 글 칸
// - 붙여넣기 일시 칸 나누기(splitDateTime, RA-N3-002): 긴 칸 시간 상한
// - 시험 모드 전용 채팅 경로(POST /api/deposits/test/chat): 다른 판매자 방송, 실제 범위 유튜브 구매자 → 기억한 입금자명 흐름
// - 날짜 없는 묶음 찾기 범위(입금 날짜 60일 전 ~ 30일 뒤) 경계
import { readPaste } from '@livejjim/server'
import { afterEach, describe, expect, it } from 'vitest'
import { call, rid } from '../s04/helpers.ts'
import { DAY, dep, fakeSource, feed, n3Harness, ok, sell, views, type N3 } from './helpers.ts'

let h: N3 | null = null
afterEach(async () => {
  await h?.close()
  h = null
})

const HOUR = 3_600_000
const SAVE_FAILED = '받은 내역을 저장하지 못했어요. 잠시 뒤에 다시 받아 올게요.'

interface SourceView {
  id: string
  label: string
  lastError: string | null
}

describe('SA-N3-08 저장점 그물 — 이름이 아닌 칸이 DB가 받지 못하는 글자일 때', () => {
  it('계좌조회 고유번호(tid)에 짝 없는 서로게이트가 있어도 나머지 입금은 빈 번호 없이 저장·자동 확인되고, 다시 받아도 두 번 저장되지 않는다', async () => {
    h = await n3Harness()
    const a = await h.account('net1')
    await sell(h, h.server, a.cookie, a.sellerId, { items: [{ no: 15, price: 10_000, ch: 'UC_NET1', nick: '다육이맘' }] })
    const total = ((await ok(dep(h.server, a.cookie).day())).body.settlements as { buyer: string; total: number }[])[0]?.total as number
    h.clock.t += HOUR
    const account = { corpNum: '1234567890', bankCode: '0004', accountNumber: '12345678901' }
    h.popbill.register(account).addRows(account, [
      { tid: 'bad\uDC00', trdt: '20261018203000', accIn: '3000', remark1: '최하나' },
      { tid: 't2', trdt: '20261018203100', accIn: String(total), remark1: '다육이맘' },
      { tid: 't3', trdt: '20261018203200', accIn: '5000', remark1: '박철수' },
    ])
    const src = (await ok(dep(h.server, a.cookie).createSource({ kind: 'POPBILL', label: '국민', corpNum: account.corpNum, bank: account.bankCode, accountNumber: account.accountNumber }))).body.id as string
    await h.server.deposits.runSource(a.sellerId, src)
    const first = await views(h.server, a.cookie)
    const names = first.map((v) => v.name).sort()
    expect(names).toEqual(expect.arrayContaining(['다육이맘', '박철수']))
    // 번호는 저장된 줄에만 차례로 (빈 번호 없음)
    expect(first.map((v) => v.no).sort((x, y) => x - y)).toEqual(Array.from({ length: first.length }, (_, i) => i + 1))
    expect(first.find((v) => v.name === '다육이맘')?.status).toBe('AUTO_APPLIED')
    const source = ((await ok(dep(h.server, a.cookie).sources())).body.sources as SourceView[]).find((s) => s.id === src)
    expect(source?.lastError).not.toBeNull()
    expect(source?.lastError).not.toBe(SAVE_FAILED)
    // 다음 주기: 같은 줄이 다시 와도 이미 저장된 줄은 그대로, 묶음은 과입금이 아니다
    await h.server.deposits.runSource(a.sellerId, src)
    expect((await views(h.server, a.cookie)).length).toBe(first.length)
    const s = ((await ok(dep(h.server, a.cookie).day())).body.settlements as { total: number; received: number }[])[0]
    expect(s?.received).toBe(s?.total)
  })
})

describe('원천 표시 이름 — 판매자가 적는 다른 글 칸도 DB가 받지 못하는 글자로 5xx가 나지 않는다', () => {
  it('TD-N3-005: 원천 만들기 표시 이름에 짝 없는 서로게이트(한글 뒤 U+DC00) → 400 또는 다듬어 200, 500이 아니다', async () => {
    h = await n3Harness()
    const a = await h.account('lbl1')
    const res = await dep(h.server, a.cookie).createSource({ kind: 'FAKE', label: '국\uDC00민' })
    expect([200, 400], res.text).toContain(res.status)
    // 원천 목록이 여전히 읽힌다
    await ok(dep(h.server, a.cookie).sources())
  })

  it('TD-N3-005: 원천 표시 이름 바꾸기(PATCH)에 짝 없는 서로게이트 → 400 또는 다듬어 200, 500이 아니다', async () => {
    h = await n3Harness()
    const a = await h.account('lbl2')
    const src = await fakeSource(h.server, a.cookie)
    const res = await dep(h.server, a.cookie).patchSource(src, { label: '신\uDC00한' })
    expect([200, 400], res.text).toContain(res.status)
    await ok(dep(h.server, a.cookie).sources())
  })
})

describe('RA-N3-002 붙여넣기 긴 칸 — 되추적 없이 끝난다', () => {
  const big = 60_000
  const cells: [string, string][] = [
    ['일시 T 반복 + 공백 조각', `${'T'.repeat(big)} a b`],
    ['일시 T 반복', 'T'.repeat(big)],
    ['일시 공백 반복', `2026-10-18${' '.repeat(big)}x y`],
    ['일시 숫자·점 반복', `${'1.'.repeat(big / 2)}x`],
    ['금액 쉼표 반복', `${'1,'.repeat(big / 2)}x`],
    ['금액 세 자리 쉼표 반복', `1${',000'.repeat(big / 4)}x`],
    ['금액 숫자 반복', `${'9'.repeat(big)}원원`],
  ]
  for (const [label, cell] of cells) {
    it(`${label} 6만 자 칸 하나 → 200ms 안에 읽기가 끝난다`, () => {
      for (const text of [`거래일시,입금액\n${cell},1000`, `거래일시,입금액\n2026-10-18 20:30,${cell}`, `거래일시\t입금자명\t입금액\n2026-10-18 20:30\t${cell}\t1000`]) {
        const started = performance.now()
        readPaste(text)
        expect(performance.now() - started).toBeLessThan(200)
      }
    })
  }
})

describe('SA-N3-03 시험 모드 채팅 경로 (POST /api/deposits/test/chat)', () => {
  it('다른 판매자의 방송에는 기록하지 않는다(404), 그 방송 범위에 구매자가 생기지 않는다', async () => {
    h = await n3Harness()
    const a = await h.account('chatA')
    const b = await h.account('chatB')
    const bc = await sell(h, h.server, b.cookie, b.sellerId, { items: [{ no: 3, price: 7_000, ch: 'UC_B1', nick: 'B손님' }] })
    const res = await call(h.server, a.cookie, 'POST', '/api/deposits/test/chat', { b: bc, id: 'x1', ch: 'UC_EVIL', nick: '끼어들기', text: '3' })
    expect(res.status, res.text).toBe(404)
    const buyers = ((await ok(dep(h.server, b.cookie).day())).body.settlements as { buyer: string }[]).map((s) => s.buyer)
    expect(buyers).not.toContain('yt:UC_EVIL')
    expect(buyers.length).toBe(1)
  })

  it('실제 방송 채팅 → 유튜브 구매자 → 이름이 다른 입금을 확정하며 입금자명을 기억할 수 있다(기억 목록 1건)', async () => {
    h = await n3Harness()
    const a = await h.account('chat2')
    const D = dep(h.server, a.cookie)
    const bc = (await ok(call(h.server, a.cookie, 'POST', '/api/broadcasts', { requestId: rid('bc'), date: DAY }))).body.broadcast as { id: string }
    await ok(call(h.server, a.cookie, 'POST', '/api/events', { requestId: rid('ev'), type: 'product.register', b: bc.id, no: 21, price: 12_000, name: '펭귄' }))
    const chat = await ok(call(h.server, a.cookie, 'POST', '/api/deposits/test/chat', { b: bc.id, id: 'm1', ch: 'UC_CHAT2', nick: '다육러버', text: '21' }))
    expect(chat.body.recorded).toBe(true)
    const again = await ok(call(h.server, a.cookie, 'POST', '/api/deposits/test/chat', { b: bc.id, id: 'm1', ch: 'UC_CHAT2', nick: '다육러버', text: '21' }))
    expect(again.body.recorded).toBe(false)
    const settlement = ((await ok(D.day())).body.settlements as { buyer: string; total: number }[])[0]
    expect(settlement).toBeDefined()
    h.clock.t += HOUR
    const src = await fakeSource(h.server, a.cookie)
    await feed(h.server, a.cookie, a.sellerId, src, [{ key: 'r1', at: '2026-10-18 20:50', amount: settlement?.total as number, name: '김실명' }])
    const v = (await views(h.server, a.cookie, 'REVIEW'))[0]
    expect(v?.review?.reason).toBe('NAME_MISMATCH')
    const suggestion = v?.review?.suggestions[0]
    expect(suggestion?.canRemember).toBe(true)
    await ok(D.confirm(v?.no as number, { date: DAY, buyer: settlement?.buyer, remaining: settlement?.total, remember: true }))
    expect(((await ok(D.names())).body.names as unknown[]).length).toBe(1)
  })
})

describe('날짜 없는 묶음 찾기 범위 — 입금 날짜 60일 전 ~ 30일 뒤 (RA-N3-003 수정)', () => {
  it('입금 날짜 60일 전 묶음은 날짜 없이도 찾고, 61일 전 묶음은 날짜를 골라야 찾는다', async () => {
    h = await n3Harness()
    const a = await h.account('win1')
    const D = dep(h.server, a.cookie)
    await sell(h, h.server, a.cookie, a.sellerId, { date: '2026-08-19', items: [{ no: 1, price: 5_000, ch: 'UC_W60', nick: '육십일' }] })
    await sell(h, h.server, a.cookie, a.sellerId, { date: '2026-08-18', items: [{ no: 1, price: 5_000, ch: 'UC_W61', nick: '육십일일' }] })
    h.clock.t += HOUR
    const src = await fakeSource(h.server, a.cookie)
    await feed(h.server, a.cookie, a.sellerId, src, [{ key: 'w1', at: '2026-10-18 20:30', amount: 1_234, name: '모름' }])
    const no = (await views(h.server, a.cookie))[0]?.no as number
    const dates = ((await ok(D.bundles(no))).body.bundles as { date: string }[]).map((b) => b.date)
    expect(dates).toContain('2026-08-19')
    expect(dates).not.toContain('2026-08-18')
    const picked = ((await ok(D.bundles(no, '', '2026-08-18'))).body.bundles as { date: string }[]).map((b) => b.date)
    expect(picked).toEqual(['2026-08-18'])
  })
})
