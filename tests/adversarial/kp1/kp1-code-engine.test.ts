// KP1 적대 시험 (test-domain) — 연결 코드 읽기(AC-KP1-10·11)와 판정 영향 없음(AC-KP1-28).
// - 코드 글 변형: 전각 공백·탭·줄 나눔·NFD(자모 분리)는 코드, 제로폭 글자·낱말 하나·순서 바꿈은 아니다 (CR-5 "\s만 지운다, 정확히 같을 때만")
// - 훔치기: 먼저 친 사람이 쓴다(같은 코드를 동시에 쳐도 붙는 것은 하나, 먼저 기록된 채팅). 손님이 [아니에요]면 도둑 표지는 장부에 들어가지 않는다
// - 24시간 경계·장부 지운 뒤의 코드·기록 실패 채팅
// - 같은 채팅 기록에 장부·코드·손님 표시를 켜고 끈 두 실행의 엔진 이벤트·발송함·정산이 같다
import { listClaims, listProducts, listSettlements } from '@livejjim/core'
import { describe, expect, it } from 'vitest'
import { at, chat, ok } from '../../../apps/server/test/i2-support.ts'
import { codes, consent, ledgerApi, ledgerWorld, linkFor, lines, markers, postForm, rowsOf, sendAddress } from '../../../apps/server/test/kp1-ledger-support.ts'
import { client, createBroadcast, waitFor, type Seller, type TestServer } from '../../../apps/server/test/support.ts'
import { sell } from '../../../apps/server/test/t1-support.ts'

const D = '2026-10-19'
const D2 = '2026-10-26'
const settle = () => new Promise((resolve) => setTimeout(resolve, 120))

async function newCode(world: TestServer, token: string): Promise<string> {
  const sent = await postForm(world, `/r/${token}/ledger/code`, {})
  expect(sent.status, sent.text).toBe(303)
  const live = (await codes(world)).filter((row) => row.state === 'LIVE')
  expect(live).toHaveLength(1)
  return live[0]?.code as string
}

const codeRow = async (world: TestServer, code: string) => (await codes(world)).find((row) => row.code === code)

/** UC_A 장부 줄 + 살아 있는 코드 하나 + 번호 방송 하나 */
async function codeWorld(): Promise<{ world: TestServer; seller: Seller; b: string; token: string; code: string }> {
  const { world, seller } = await ledgerWorld()
  const b = await sell(world, seller, [['UC_A', '가람', 1]])
  const token = await consent(world, seller, 'UC_A')
  const code = await newCode(world, token)
  return { world, seller, b, token, code }
}

describe('AC-KP1-10 코드 글 변형 (적대)', () => {
  it('전각 공백·탭·줄 나눔으로 띄운 코드, NFD(자모 분리)로 친 코드는 코드다', async () => {
    for (const shape of [(code: string) => `\t${code.replace(' ', '\u3000')}\n`, (code: string) => code.normalize('NFD'), (code: string) => ` ${code.replace(' ', '\n')} `]) {
      const { world, seller, b, code } = await codeWorld()
      await chat(world, seller, b, 'c-1', 'UC_B', '나래', shape(code))
      await waitFor(async () => (await codeRow(world, code))?.state === 'CLAIMED')
      expect((await codeRow(world, code))?.claimed_marker).toBe('c:UC_B')
    }
  })

  it('제로폭 글자가 끼었거나·낱말 하나만·순서를 바꾸었거나·물음표가 붙으면 코드가 아니다 (정확히 같을 때만)', async () => {
    const { world, seller, b, code } = await codeWorld()
    const [w1, w2] = code.split(' ') as [string, string]
    const misses = [`${w1}\u200b${w2}`, `${w1}\u200d ${w2}`, w1, `${w2} ${w1}`, `${code}?`, `${w1}${w2}${w2}`]  // U+FEFF는 JavaScript \s에 들어 있어 규칙(CR-5 \s)상 공백이라 뺐다
    for (const [i, text] of misses.entries()) await chat(world, seller, b, `m-${String(i)}`, 'UC_B', '나래', text)
    await settle()
    expect((await codeRow(world, code))?.state).toBe('LIVE')
  })
})

describe('AC-KP1-10·11 코드 훔치기·한 번만 (적대)', () => {
  it('두 사람이 같은 코드를 동시에 쳐도 붙는 것은 하나, 먼저 기록된 채팅이다', async () => {
    for (let round = 0; round < 3; round++) {
      const { world, seller, b, code } = await codeWorld()
      await Promise.all([chat(world, seller, b, 'x-1', 'UC_X', '엑스', code), chat(world, seller, b, 'y-1', 'UC_Y', '와이', code), chat(world, seller, b, 'z-1', 'UC_Z', '제트', code)])
      await waitFor(async () => (await codeRow(world, code))?.state === 'CLAIMED')
      await settle()
      const recorded = await rowsOf(world, `select seq, body from events where type = 'chat' and body like '%-1"%' order by seq`)
      const first = (JSON.parse(recorded[0]?.body as string) as { ch: string }).ch
      expect((await codeRow(world, code))?.claimed_marker).toBe(`c:${first}`)
      expect((await codes(world)).filter((row) => row.state === 'CLAIMED')).toHaveLength(1)
    }
  })

  it('도둑이 먼저 쳤을 때 손님이 [아니에요] → 도둑 표지는 장부에 없고, 다시 받은 코드는 손님이 친 채팅으로 붙는다', async () => {
    const { world, seller, b, token, code } = await codeWorld()
    await chat(world, seller, b, 't-1', 'UC_THIEF', '가람', code)
    await waitFor(async () => (await codeRow(world, code))?.state === 'CLAIMED')
    expect((await postForm(world, `/r/${token}/ledger/link`, { answer: 'no' })).status).toBe(303)
    expect((await markers(world)).map((row) => row.marker)).toEqual(['c:UC_A'])
    at(world, D, '20:10:00')
    const again = await newCode(world, token)
    // 도둑이 옛 코드를 다시 쳐도 붙지 않는다
    await chat(world, seller, b, 't-2', 'UC_THIEF', '가람', code)
    await settle()
    expect((await codeRow(world, again))?.state).toBe(again === code ? 'CLAIMED' : 'LIVE')
    if (again === code) return
    await chat(world, seller, b, 'r-1', 'UC_REAL', '가람', again)
    await waitFor(async () => (await codeRow(world, again))?.state === 'CLAIMED')
    expect((await postForm(world, `/r/${token}/ledger/link`, { answer: 'yes' })).status).toBe(303)
    expect((await markers(world)).map((row) => row.marker).sort()).toEqual(['c:UC_A', 'c:UC_REAL'])
    expect((await markers(world)).map((row) => row.marker)).not.toContain('c:UC_THIEF')
  })

  it('24시간 경계: 만든 지 24시간 - 1초에 친 코드는 붙고, 정확히 24시간에 친 코드는 붙지 않는다', async () => {
    const early = await codeWorld()
    const created = ((await codeRow(early.world, early.code))?.created_at as Date).getTime()
    early.world.clock.set(created + 24 * 3600_000 - 1000)
    await chat(early.world, early.seller, early.b, 'e-1', 'UC_B', '나래', early.code)
    await waitFor(async () => (await codeRow(early.world, early.code))?.state === 'CLAIMED')
    const late = await codeWorld()
    late.world.clock.set(((await codeRow(late.world, late.code))?.created_at as Date).getTime() + 24 * 3600_000)
    await chat(late.world, late.seller, late.b, 'l-1', 'UC_B', '나래', late.code)
    await settle()
    expect((await codeRow(late.world, late.code))?.state).toBe('LIVE')
    // 링크에도 코드가 더는 보이지 않는다
    const { openLink } = await import('../../../apps/server/test/kp1-ledger-support.ts')
    expect((await openLink(late.world, `/r/${late.token}`)).text).not.toContain(late.code)
  })

  it('장부를 지운 뒤에는 그 줄의 코드를 쳐도 아무것도 붙지 않는다 (코드도 함께 지움)', async () => {
    const { world, seller, b, token, code } = await codeWorld()
    expect((await postForm(world, `/r/${token}/ledger/delete`, {})).status).toBe(303)
    expect(await lines(world)).toEqual([])
    expect(await codes(world)).toEqual([])
    await chat(world, seller, b, 'd-1', 'UC_B', '나래', code)
    await settle()
    expect(await codes(world)).toEqual([])
    expect(await markers(world)).toEqual([])
  })
})

// ── AC-KP1-28 판정 영향 없음 ─────────────────────────────────────────

interface RunResult {
  events: string[]
  outbox: string[]
  claims: unknown[]
  products: unknown[]
  settlements: unknown[]
}

/** 같은 채팅 기록. on이면 장부 동의·코드·코드 확인·손님 표시·배송지 확인까지 쓴다 */
async function run(on: boolean, codeText: string | null): Promise<{ result: RunResult; code: string | null }> {
  const { world, seller } = await ledgerWorld()
  const api = ledgerApi(world, seller.cookie)
  expect((await api.saveSettings({ months: 12, consoleBadges: on })).status).toBe(200)
  const b1 = await sell(world, seller, [
    ['UC_A', '가람', 1],
    ['UC_B', '나래', 1],
  ])
  const token = await linkFor(world, seller, 'UC_A', D)
  expect((await sendAddress(world, token, on)).status).toBe(303)
  at(world, D2, '20:00:00')
  const code = on ? await newCode(world, token) : null
  const text = codeText ?? code ?? '구름 바다'
  const b2 = (await createBroadcast(world, seller, { date: D2 })).id
  for (const no of [1, 2, 3]) await ok(world, seller, { type: 'product.register', b: b2, no, name: `품종${String(no)}`, price: 7000 * no })
  await chat(world, seller, b2, 'k1', 'UC_A', '가람', '1')
  await chat(world, seller, b2, 'k2', 'UC_C', '다솜', text)
  await chat(world, seller, b2, 'k3', 'UC_B', '나래', '1')
  await chat(world, seller, b2, 'k4', 'UC_C', '다솜', text.replace(' ', ''))
  await chat(world, seller, b2, 'k5', 'UC_C', '다솜', '2')
  await chat(world, seller, b2, 'k6', 'UC_A', '가람', '3')
  if (on) {
    await waitFor(async () => (await codes(world)).some((row) => row.state === 'CLAIMED'))
    expect((await postForm(world, `/r/${token}/ledger/link`, { answer: 'yes' })).status).toBe(303)
    expect((await api.badges(D2, ['UC_A', 'UC_B', 'UC_C'])).status).toBe(200)
    const bundle = (await api.bundle('UC_A', D2)).body.bundle as { ledger: { ledgerId: string; updatedAt: string } | null }
    expect(bundle.ledger).not.toBeNull()
    if (bundle.ledger !== null) expect((await api.confirmLedger('UC_A', bundle.ledger.ledgerId, bundle.ledger.updatedAt, D2)).status).toBe(200)
  }
  await ok(world, seller, { type: 'host.cancel', b: b2, no: 1, buyer: 'UC_A', reason: '손님 요청' })
  await chat(world, seller, b2, 'k7', 'UC_C', '다솜', text)
  await settle()
  const ids = new Map([
    [b1, 'B1'],
    [b2, 'B2'],
  ])
  const norm = (value: string) => [...ids].reduce((acc, [id, name]) => acc.split(id).join(name), value)
  const events = (await rowsOf(world, 'select e.seq, e.type, e.body, e.failed, s.date from events e join scopes s on s.id = e.scope_id order by s.date, e.seq')).map((row) => norm(JSON.stringify([row.date, row.seq, row.type, row.body, row.failed])))
  const outbox = (await rowsOf(world, 'select o.seq, o.kind, o.body, o.rehearsal, s.date from outbox o join scopes s on s.id = o.scope_id order by s.date, o.seq, o.id')).map((row) => norm(JSON.stringify([row.date, row.seq, row.kind, row.body, row.rehearsal])))
  const state = (await world.server.writer.readDetached(seller.sellerId, D2, false)).state
  const claims = JSON.parse(norm(JSON.stringify(listClaims(state)))) as unknown[]
  const products = JSON.parse(norm(JSON.stringify(listProducts(state)))) as unknown[]
  const settlements = JSON.parse(norm(JSON.stringify(listSettlements(state)))) as unknown[]
  return { result: { events, outbox, claims, products, settlements }, code }
}

describe('AC-KP1-28 판정 영향 없음 (적대)', () => {
  it('장부 동의·연결 코드(채팅으로 붙이고 확인)·손님 표시·[배송지 확인]을 켠 실행과 끈 실행의 이벤트·발송함·찜·상품·정산이 같다', async () => {
    const on = await run(true, null)
    const off = await run(false, on.code)
    expect(on.result.events.length).toBeGreaterThan(10)
    expect(off.result.events).toEqual(on.result.events)
    expect(off.result.outbox).toEqual(on.result.outbox)
    expect(off.result.claims).toEqual(on.result.claims)
    expect(off.result.products).toEqual(on.result.products)
    expect(off.result.settlements).toEqual(on.result.settlements)
  })
})

describe('AC-KP1-11 이은 계정은 손님 기록을 합치지 않는다 (적대)', () => {
  it('입금 늦음 주의인 UC_A의 줄에 UC_B를 코드로 이어도 UC_B 꼬리표·손님 기록은 UC_B 것만 (주의가 옮지 않는다)', async () => {
    const { world, seller } = await ledgerWorld()
    // D: UC_A·UC_B 모두 산다. UC_B만 입금
    await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_B', '나래', 1],
    ])
    const view = (await client(world, seller.cookie).get(`/api/days/${D}`)).body.settlements as { buyer: string; total: number }[]
    await ok(world, seller, { type: 'settlement.payment', buyer: 'UC_B', date: D, amount: view.find((item) => item.buyer === 'UC_B')?.total ?? 0 }, D)
    const token = await consent(world, seller, 'UC_A')
    at(world, D2, '20:00:00')
    const b2 = await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_B', '나래', 1],
    ], D2)
    const api = ledgerApi(world, seller.cookie)
    // D-KP1-43: 손님 표시는 처음엔 안 정함(null)이고 꼬리표를 숨긴다 — 꼬리표를 보려면 먼저 "보이기"로 저장한다
    expect((await api.settings()).body.settings).toMatchObject({ consoleBadges: null })
    const hidden = (await api.badges(D2, ['UC_A', 'UC_B'])).body.badges as { text: string | null }[]
    expect(hidden.every((badge) => badge.text === null)).toBe(true)
    expect((await api.saveSettings({ months: 12, consoleBadges: true })).status).toBe(200)
    const before = (await api.badges(D2, ['UC_A', 'UC_B'])).body
    expect((before.badges as { text: string | null }[])[0]?.text).toBe('입금 늦음 주의')
    const rowsBefore = (await api.customers()).body.customers
    const code = await newCode(world, token)
    await chat(world, seller, b2, 'link', 'UC_B', '나래', code)
    await waitFor(async () => (await codeRow(world, code))?.state === 'CLAIMED')
    expect((await postForm(world, `/r/${token}/ledger/link`, { answer: 'yes' })).status).toBe(303)
    expect((await markers(world)).map((row) => row.marker).sort()).toEqual(['c:UC_A', 'c:UC_B'])
    expect((await api.badges(D2, ['UC_A', 'UC_B'])).body).toEqual(before)
    expect((await api.customers()).body.customers).toEqual(rowsBefore)
    // 장부(연락처 이어 쓰기)에는 쓰인다: UC_B 다음 묶음에 UC_A가 저장한 배송지가 "확인 전"으로
    expect(((await api.bundle('UC_B', D2)).body.bundle as { ledger: { name: string } | null }).ledger?.name).toBe('홍길동')
  })
})
