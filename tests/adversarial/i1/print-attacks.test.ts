// I1 적대 테스트 (test-domain): 출력 기록의 표적 공격 (AC-I1-03·05·06·08·10·11·17, LABEL_RULES L-11 4·5·7·10·14·16).
// - TD-I1-001 1등인데 받을 때 라벨 데이터를 만들 수 없으면(번호 10000 — 엔진·API는 받지만 L-3은 1~9999) 그 라벨을 "폐기"로 조용히 버린다
// - TD-I1-002 출력 그만하기(출력 중) 뒤 같은 기기가 다시 "이 기기에서 출력"을 눌러 성공했는데, 그 장이 끝나면 출력 기기가 비워진다
// - 통과한 공격(회귀): 자동 출력을 끈 방송의 손으로 출력 → 취소 → 버릴 라벨·엔진 보고 없음, 출력 중 취소 → 늦은 보고 → 버릴 라벨,
//   다른 판매자로 받기·결과·조치, 로그 개인정보, 리허설 포장·조회 거절
import { afterEach, describe, expect, it } from 'vitest'
import { DAY, DEV_A, DEV_B, call, chat, ev, harness, labelReports, printer, rid, startBroadcast, type Harness } from './helpers.ts'

let h: Harness | null = null
afterEach(async () => {
  await h?.close()
  h = null
})

describe('TD-I1-001 받을 때 데이터를 만들 수 없는 1등 라벨을 조용히 폐기하지 않는다 (L-11 4·5, AC-I1-06)', () => {
  it('번호 10000인 상품의 1등(문자찜): 받기에서 폐기·출력 안 함이 되지 않고, 대기 맨 앞에 남아 멈춤으로 알린다', async () => {
    h = await harness()
    const a = await h.account('tdi1one')
    const b = await startBroadcast(h.server, a.cookie, DAY)
    const p = printer(h, a.cookie)
    const reg = await call(h.server, a.cookie, 'POST', '/api/events', { requestId: rid('reg'), type: 'product.register', b, no: 10000, name: '큰번호', price: 8000 })
    // 서버가 L-3 밖 번호를 처음부터 받지 않도록 고쳐도 이 공격은 막힌 것이다
    if (reg.status !== 200) return
    await ev(h, a.cookie, { type: 'sms', b, no: 10000, received: '20:00' })
    expect((await p.overview()).jobs).toHaveLength(1)
    await p.become()
    const claimed = await p.claim(DEV_A)
    expect(claimed.job).toBeNull()
    const [label] = await p.labels()
    // 지금도 그 확정버전의 1등이다 — 1등이 아닐 때만 폐기한다 (L-11 5)
    expect(label?.winner === true || label?.voided === false, `1등 라벨이 폐기됨: ${JSON.stringify(label)}`).toBe(true)
    expect(label?.state).not.toBe('VOIDED')
    const overview = await p.overview()
    // 작업은 사라지지 않고 대기에 남으며(출력 안 함으로 바뀌지 않는다), 대기열이 멈춰 판매자가 알 수 있다 (dev-notes "받을 때 라벨 데이터를 만들 수 없으면")
    expect(overview.jobs.map((j) => j.status)).toEqual(['WAITING'])
    expect(overview.queue.pause?.reason).toBe('LABEL_ERROR')
  })
})

describe('TD-I1-002 출력 그만하기 뒤 같은 기기가 다시 출력 기기가 되면 그 장이 끝나도 출력 기기로 남는다 (L-11 10, AC-I1-10)', () => {
  it('출력 중 그만하기 → 같은 기기 "이 기기에서 출력" 성공 → 결과 출력함 → 그 기기가 다음 작업을 받는다', async () => {
    h = await harness()
    const a = await h.account('tdi1two')
    const b = await startBroadcast(h.server, a.cookie, DAY)
    const p = printer(h, a.cookie)
    await ev(h, a.cookie, { type: 'product.register', b, no: 1, name: '하나', price: 1000 })
    await ev(h, a.cookie, { type: 'product.register', b, no: 2, name: '둘', price: 1000 })
    await p.become()
    await chat(h, a.sellerId, b, 'UC_A', '가', '1')
    await chat(h, a.sellerId, b, 'UC_B', '나', '2')
    const first = await p.claim(DEV_A)
    expect(first.job?.data.no).toBe(1)
    expect((await p.release()).status).toBe(200)
    // 판매자가 마음을 바꿔 같은 기기에서 다시 "이 기기에서 출력"
    const again = await p.register(DEV_A, '휴대폰')
    expect(again.status, again.text).toBe(200)
    expect((again.body.queue as { device: { id: string } | null }).device?.id).toBe(DEV_A)
    expect((await p.result(DEV_A, first.job?.attempt ?? '', true)).status).toBe(200)
    const overview = await p.overview()
    expect(overview.queue.device?.id, '다시 정한 출력 기기가 앞 장이 끝나자 비워짐').toBe(DEV_A)
    const next = await p.raw('POST', '/api/print/claim', { deviceId: DEV_A })
    expect(next.status, next.text).toBe(200)
    expect((next.body.job as { data: { no: number } } | null)?.data.no).toBe(2)
  })
})

describe('통과한 공격 (회귀)', () => {
  it('자동 출력을 끈 방송: 손으로 출력한 라벨을 1등 취소가 폐기(버릴 라벨)하고, 엔진 보고·잠금은 없다 (G-ENG-303, L-11 5·7)', async () => {
    h = await harness()
    const a = await h.account('regoff')
    const s = await call(h.server, a.cookie, 'PATCH', '/api/settings', { settings: { 'print.autoOnConfirm': false, 'cancel.buyerChat': 'AUTO' } })
    expect(s.status, s.text).toBe(200)
    const b = await startBroadcast(h.server, a.cookie, DAY)
    const p = printer(h, a.cookie)
    await ev(h, a.cookie, { type: 'product.register', b, no: 15, name: '핑크', price: 9000 })
    await chat(h, a.sellerId, b, 'UC_A', '가', '15')
    await chat(h, a.sellerId, b, 'UC_B', '나', '15')
    expect((await p.overview()).jobs).toEqual([])
    const [none] = await p.labels()
    expect(none).toMatchObject({ state: 'NONE', word: '', canPrint: true, canReprint: false })
    const manual = await p.print(b, 'c1')
    expect(manual.status, manual.text).toBe(200)
    // 같은 라벨 키에 다시 "라벨 출력"은 거절
    expect((await p.print(b, 'c1')).body).toMatchObject({ error: { code: 'PRINT_LABEL_EXISTS' } })
    await p.become()
    const printed = await p.printOne()
    expect(printed?.data).toEqual({ no: 15, name: '핑크', price: 9000, date: DAY, buyer: { kind: 'youtube', name: '가' } })
    expect(await labelReports(h, a.sellerId)).toEqual([])
    // 잠금이 없으므로 시청자 취소가 바로 취소 → 승계. 승계자에게는 자동 작업이 없다
    await chat(h, a.sellerId, b, 'UC_A', '가', '15 취소')
    const overview = await p.overview()
    expect(overview.queue.discard).toBe(1)
    expect(overview.discard[0]).toMatchObject({ reason: 'manual', word: '폐기 — 버려 주세요' })
    expect(overview.jobs).toEqual([])
    const labels = await p.labels()
    expect(labels.map((l) => [l.key, l.state, l.canPrint])).toEqual([
      ['c1@1', 'VOIDED', false],
      ['c2@2', 'NONE', true],
    ])
    expect((await p.reprint(b, 'c1', 1)).body).toMatchObject({ error: { code: 'PRINT_VOIDED', message: '폐기한 라벨은 다시 출력할 수 없어요.' } })
  })

  it('출력 중에 1등이 취소되면: 결과 출력함 → 늦은 보고 하나 → 그 장은 버릴 라벨, 승계자 새 라벨 (AC-I1-08)', async () => {
    h = await harness()
    const a = await h.account('reglate')
    const b = await startBroadcast(h.server, a.cookie, DAY)
    const p = printer(h, a.cookie)
    await ev(h, a.cookie, { type: 'product.register', b, no: 15, name: '핑크', price: 9000 })
    await chat(h, a.sellerId, b, 'UC_A', '가', '15')
    await chat(h, a.sellerId, b, 'UC_B', '나', '15')
    await p.become()
    const held = await p.claim(DEV_A)
    await ev(h, a.cookie, { type: 'host.cancel', b, no: 15, buyer: 'UC_A', reason: '요청' })
    expect((await p.result(DEV_A, held.job?.attempt ?? '', true)).body).toEqual({ recorded: true })
    // 같은 결과 재전송
    expect((await p.result(DEV_A, held.job?.attempt ?? '', true)).body).toEqual({ recorded: false })
    expect(await labelReports(h, a.sellerId)).toEqual([held.job?.id])
    const overview = await p.overview()
    expect(overview.discard.map((j) => j.id)).toEqual([held.job?.id])
    expect(overview.jobs.map((j) => j.label.buyer)).toEqual([{ kind: 'youtube', name: '나' }])
    const next = await p.printOne()
    expect(next?.label.key).toBe('c2@2')
    expect(await labelReports(h, a.sellerId)).toEqual([held.job?.id, next?.id])
  })

  it('다른 판매자: 시도 표·작업 ID·기기로 받기·결과·조치·조회가 아무것도 바꾸지 않는다 (AC-I1-01, SYS-02)', async () => {
    h = await harness()
    const a = await h.account('isoa')
    const x = await h.account('isox')
    const b = await startBroadcast(h.server, a.cookie, DAY)
    const pa = printer(h, a.cookie)
    const px = printer(h, x.cookie)
    await ev(h, a.cookie, { type: 'product.register', b, no: 15, name: '핑크', price: 9000 })
    await chat(h, a.sellerId, b, 'UC_A', '가', '15')
    await chat(h, a.sellerId, b, 'UC_B', '나', '15')
    await pa.become()
    const held = await pa.claim(DEV_A)
    const before = JSON.stringify(await pa.overview())
    // 같은 기기 ID·같은 시도 표로 다른 판매자가
    expect((await px.raw('POST', '/api/print/claim', { deviceId: DEV_A })).status).toBe(409)
    expect((await px.result(DEV_A, held.job?.attempt ?? '', true)).status).toBe(404)
    expect((await px.result(DEV_A, held.job?.attempt ?? '', false, 'DISCONNECTED')).status).toBe(404)
    expect((await px.cancel(DAY, held.job?.id ?? '')).status).toBe(404)
    expect((await px.discard(DAY, held.job?.id ?? '')).status).toBe(404)
    expect((await px.print(b, 'c2')).status).toBe(404)
    expect((await px.reprint(b, 'c1')).status).toBe(404)
    expect((await px.packing(DAY, 'UC_A')).status).toBe(404)
    expect((await px.raw('GET', `/api/print/labels?date=${DAY}`)).status).toBe(404)
    expect((await px.raw('GET', `/api/print/packing?date=${DAY}&buyer=UC_A`)).status).toBe(404)
    expect((await px.cancelAll()).body).toMatchObject({ cancelled: 0 })
    expect((await px.pause()).status).toBe(200)
    expect((await px.register(DEV_B, '남의기기')).status).toBe(200)
    expect((await px.overview()).jobs).toEqual([])
    expect(JSON.stringify(await pa.overview())).toBe(before)
    expect((await pa.result(DEV_A, held.job?.attempt ?? '', true)).body).toEqual({ recorded: true })
  })

  it('로그에 닉네임·품종·기기 이름·가게 이름·메모·전화번호가 남지 않는다 — 오류 경로 포함 (AC-I1-17, L-11 16)', async () => {
    h = await harness()
    const a = await h.account('logpriv')
    const b = await startBroadcast(h.server, a.cookie, DAY)
    const p = printer(h, a.cookie)
    await ev(h, a.cookie, { type: 'product.register', b, no: 15, name: '비밀품종', price: 9000 })
    await chat(h, a.sellerId, b, 'UC_SECRET', '비밀닉네임', '15')
    await ev(h, a.cookie, { type: 'sms', b, no: 15, received: '20:00', memo: '비밀메모', phone: '010-9876-5432' })
    await p.register(DEV_A, '비밀기기')
    await p.register(DEV_B, '비밀기기둘')
    await p.restart()
    const held = await p.claim(DEV_A)
    await p.result(DEV_A, held.job?.attempt ?? '', false, 'DOES_NOT_FIT', 'name')
    await p.result(DEV_A, 'not-a-real-attempt-token', true)
    await p.result(DEV_A, held.job?.attempt ?? '', false, 'NOT_A_CODE')
    const t = await p.templates()
    const tpl = (t.body.product as { template: Record<string, unknown> }).template
    await p.saveTemplate('product', { ...tpl, shopName: '비밀가게' }, 0)
    await p.saveTemplate('product', { ...tpl, shopName: '비밀가게'.repeat(20) }, 1)
    await p.saveTemplate('product', { ...tpl, 비밀칸: 1 }, 1)
    await p.packing(DAY, 'UC_SECRET')
    await p.raw('POST', '/api/print/device', { deviceId: DEV_A, name: '비밀기기', extra: '비밀값' })
    const logs = JSON.stringify(h.logs)
    expect(logs).not.toMatch(/비밀|9876|5432|UC_SECRET/)
  })

  it('리허설: 같은 날짜 리허설 범위의 포장 라벨·라벨 조회는 거절, 실제 범위 출력 기록에 아무것도 없다 (AC-I1-03, L-11 14)', async () => {
    h = await harness()
    const a = await h.account('rehp')
    const r = await call(h.server, a.cookie, 'POST', '/api/broadcasts', { requestId: rid('bc'), date: DAY, rehearsal: true })
    const b = (r.body.broadcast as { id: string }).id
    const p = printer(h, a.cookie)
    await ev(h, a.cookie, { type: 'product.register', b, no: 1, name: 'x', price: 1000 })
    await chat(h, a.sellerId, b, 'UC_A', '가', '1')
    const msg = { error: { code: 'PRINT_REHEARSAL', message: '리허설 방송은 라벨을 출력하지 않아요.' } }
    expect((await p.raw('GET', `/api/print/labels?date=${DAY}&rehearsal=true`)).body).toEqual(msg)
    expect((await p.raw('POST', '/api/print/packing', { requestId: rid('pk'), date: DAY, buyer: 'UC_A', rehearsal: true })).body).toEqual(msg)
    expect((await p.print(b, 'c1')).body).toEqual(msg)
    expect((await p.reprint(b, 'c1')).body).toEqual(msg)
    const real = await startBroadcast(h.server, a.cookie, DAY)
    await ev(h, a.cookie, { type: 'product.register', b: real, no: 1, name: 'x', price: 1000 })
    // 리허설 범위의 찜 ID를 실제 방송으로 — 실제 범위에는 없는 찜
    expect((await p.print(real, 'c1')).status).toBe(404)
    await p.become()
    expect(await p.claim(DEV_A)).toEqual({ job: null, reason: 'EMPTY' })
    const n = await h.database.pglite?.query<{ j: number; l: number }>(`select (select count(*) from print_jobs)::int as j, (select count(*) from print_labels)::int as l`)
    expect(n?.rows[0]).toEqual({ j: 0, l: 0 })
  })
  it('동시 요청: 같은 기기 받기 10번·두 기기 동시 정하기·같은 라벨 다시 출력 동시 5번 — 출력 중 하나·출력 기기 하나·작업 하나 (L-11 4·9·10)', async () => {
    h = await harness()
    const a = await h.account('race')
    const b = await startBroadcast(h.server, a.cookie, DAY)
    const p = printer(h, a.cookie)
    for (const no of [1, 2, 3]) await ev(h, a.cookie, { type: 'product.register', b, no, name: `품종${String(no)}`, price: 1000 })
    const regs = await Promise.all([p.register(DEV_A, '휴대폰'), p.register(DEV_B, 'PC')])
    expect(regs.map((r) => r.status).sort()).toEqual([200, 409])
    const winner = regs[0]?.status === 200 ? DEV_A : DEV_B
    for (const no of [1, 2, 3]) await chat(h, a.sellerId, b, `UC_${String(no)}`, `n${String(no)}`, String(no))
    const claims = await Promise.all(Array.from({ length: 10 }, () => p.raw('POST', '/api/print/claim', { deviceId: winner })))
    const jobs = claims.map((r) => (r.body as { job?: { attempt: string; data: { no: number } } | null }).job ?? null).filter((j) => j !== null)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.data.no).toBe(1)
    await p.result(winner, jobs[0]?.attempt ?? '', true)
    const reprints = await Promise.all(Array.from({ length: 5 }, (_, i) => p.reprint(b, 'c1', 1, `rr${String(i)}`)))
    expect(reprints.filter((r) => r.status === 200)).toHaveLength(1)
    expect(reprints.filter((r) => r.status === 409).every((r) => (r.body.error as { code: string }).code === 'PRINT_IN_PROGRESS')).toBe(true)
    const overview = await p.overview()
    expect(overview.jobs.map((j) => [j.label.key, j.reason])).toEqual([
      ['c2@1', 'auto'],
      ['c3@1', 'auto'],
      ['c1@1', 'reprint'],
    ])
  })
})
