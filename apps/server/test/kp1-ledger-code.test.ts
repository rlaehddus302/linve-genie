// KP1 연결 코드 — 받기(AC-KP1-09), 채팅에서 읽기(AC-KP1-10 — 판정·기록 영향 없음, 한 번만, 로그에 글 없음), 손님 확인(AC-KP1-11).
import { describe, expect, it } from 'vitest'
import { LINK_CODE_WORDS } from '../src/customers/ledger-rules.ts'
import { at, chat } from './i2-support.ts'
import { client, createBroadcast, rid, waitFor } from './support.ts'
import { D, codes, consent, consents, ledgerApi, ledgerWorld, lines, logText, markers, openLink, postForm, rowsOf, sell } from './kp1-ledger-support.ts'

const settle = () => new Promise((resolve) => setTimeout(resolve, 80))

async function newCode(world: Parameters<typeof postForm>[0], token: string): Promise<string> {
  const sent = await postForm(world, `/r/${token}/ledger/code`, {})
  expect(sent.status, sent.text).toBe(303)
  expect(sent.headers.get('location')).toBe(`/r/${token}#ledger`)
  const live = (await codes(world)).filter((row) => row.state === 'LIVE')
  expect(live).toHaveLength(1)
  return live[0]?.code as string
}

describe('AC-KP1-09 코드 받기', () => {
  it('48낱말 중 서로 다른 두 낱말·24시간, 링크에 코드와 끝나는 시각. 새로 받으면 전 코드는 없어진다', async () => {
    const { world, seller } = await ledgerWorld()
    await sell(world, seller, [['UC_A', '가람', 1]])
    const token = await consent(world, seller, 'UC_A')
    const first = await newCode(world, token)
    const [a, b] = first.split(' ')
    expect(a).not.toBe(b)
    expect(LINK_CODE_WORDS).toContain(a)
    expect(LINK_CODE_WORDS).toContain(b)
    const row = (await codes(world))[0] as { created_at: Date; expires_at: Date }
    expect(row.expires_at.getTime() - row.created_at.getTime()).toBe(24 * 60 * 60 * 1000)
    const page = await openLink(world, `/r/${token}`)
    expect(page.text).toContain('라이브 방송 채팅에 아래 두 낱말만 쳐 주세요. 24시간 동안 한 번 쓸 수 있어요.')
    expect(page.text).toContain(first)
    expect(page.text).toContain('2026-10-20 (화) 20:00까지')
    at(world, D, '20:01:00')
    const second = await newCode(world, token)
    expect((await codes(world)).map((item) => [item.code, item.state])).toEqual([
      [first, 'DONE'],
      [second, 'LIVE'],
    ])
  })

  it('장부 줄이 없는 링크에서는 코드를 만들지 않는다', async () => {
    const { world, seller } = await ledgerWorld()
    await sell(world, seller, [['UC_A', '가람', 1]])
    const { linkFor } = await import('./kp1-ledger-support.ts')
    const token = await linkFor(world, seller, 'UC_A')
    expect((await postForm(world, `/r/${token}/ledger/code`, {})).status).toBe(303)
    expect(await codes(world)).toEqual([])
  })
})

describe('AC-KP1-10·11 채팅에서 읽기와 손님 확인', () => {
  it('붙여 쓴 코드만 맞는다(꼬리말·옵션 방송·리허설·방송자 글은 아님), 한 번만, 판정·기록은 그대로, 로그에 글 없음 → [네]면 표지를 옮긴다', async () => {
    const { world, seller } = await ledgerWorld()
    const b = await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_B', '나래', 1],
    ])
    // UC_B는 장부 줄이 없다 (다른 줄에 동의로 든 계정은 옮기지 않는다 — RA-KP1-007은 아래 시험)
    const tokenA = await consent(world, seller, 'UC_A')
    at(world, D, '20:05:00')
    const code = await newCode(world, tokenA)
    const squeezed = code.replace(' ', '')
    const eventsBefore = Number((await rowsOf(world, 'select count(*)::int as n from events'))[0]?.n)
    // 아닌 것들: 꼬리말, 방송자 글, 리허설, 옵션 방송
    await chat(world, seller, b, 'c-tail', 'UC_B', '나래', `${code}!`)
    await world.server.ingestChat(seller.sellerId, { b, id: 'c-owner', ch: 'UC_B', nick: '나래', text: squeezed, owner: true })
    const rehearsal = (await createBroadcast(world, seller, { date: D, rehearsal: true })).id
    await chat(world, seller, rehearsal, 'c-reh', 'UC_B', '나래', squeezed)
    const options = await client(world, seller.cookie).post('/api/broadcasts', { requestId: rid('bc'), date: '2026-10-20', saleMode: 'OPTIONS' })
    expect(options.status, options.text).toBe(200)
    at(world, '2026-10-20', '20:00:00')
    await chat(world, seller, (options.body.broadcast as { id: string }).id, 'c-opt', 'UC_B', '나래', code)
    await settle()
    expect((await codes(world)).at(-1)?.state).toBe('LIVE')
    // 맞는 것: 번호 방송의 "구름바다" — 기록은 다른 채팅과 똑같이, 판정에서 찜이 아니다
    await chat(world, seller, b, 'c-yes', 'UC_B', '나래', squeezed)
    await waitFor(async () => (await codes(world)).at(-1)?.state === 'CLAIMED')
    expect((await codes(world)).at(-1)).toMatchObject({ claimed_marker: 'c:UC_B', claimed_platform: '유튜브', claimed_name: '나래', claimed_last4: 'UC_B' })
    expect(Number((await rowsOf(world, 'select count(*)::int as n from events'))[0]?.n)).toBeGreaterThan(eventsBefore)
    const claims = (await client(world, seller.cookie).get(`/api/days/${D}`)).body.settlements as { buyer: string; items: unknown[] }[]
    expect(claims.find((item) => item.buyer === 'UC_B')?.items).toHaveLength(1)
    // 한 번만 — 다음 채팅은 붙지 않는다
    await chat(world, seller, b, 'c-again', 'UC_C', '다솜', squeezed)
    await settle()
    expect((await codes(world)).at(-1)?.claimed_marker).toBe('c:UC_B')
    // 로그에 코드 글·채팅 본문 없음
    const logs = logText(world)
    for (const secret of [code, squeezed]) expect(logs).not.toContain(secret)

    // 손님 확인 화면
    const page = await openLink(world, `/r/${tokenA}`)
    expect(page.text).toContain('유튜브 &#39;나래&#39;(끝 UC_B)이 코드를 쳤어요. 내 계정이 맞나요?')
    expect(page.text).toContain('네, 제 계정이에요')
    expect((await postForm(world, `/r/${tokenA}/ledger/link`, { answer: 'maybe' })).status).toBe(400)
    const yes = await postForm(world, `/r/${tokenA}/ledger/link`, { answer: 'yes' })
    expect(yes.status).toBe(303)
    const linkedAt = yes.headers.get('location') as string
    expect(linkedAt).toMatch(new RegExp(`^/r/${tokenA}\\?ledger=linked&n=[^#]+#ledger$`))
    expect((await openLink(world, linkedAt.replace('#ledger', ''))).text).toContain('계정을 이었어요.')
    const [line] = await lines(world)
    expect(await lines(world)).toHaveLength(1)
    expect((await markers(world)).map((row) => [row.marker, row.line_id, row.source])).toEqual([
      ['c:UC_A', line?.id, 'CONSENT'],
      ['c:UC_B', line?.id, 'CODE'],
    ])
    expect((await codes(world)).at(-1)?.state).toBe('DONE')
    // 손님 기록(BUY-06)은 그대로 두 줄, 판매자 손님 자세히에 이은 계정 한 줄
    const api = ledgerApi(world, seller.cookie)
    const rows = (await api.customers()).body.customers as { id: string; name: string }[]
    expect(rows.map((row) => row.name).sort()).toEqual(['가람', '나래'])
    const detail = (await api.customer(rows.find((row) => row.name === '가람')?.id as string)).body.ledger as { linked: { label: string }[] }
    expect(detail.linked.map((item) => item.label)).toEqual(['유튜브 나래(끝 UC_B)'])
  })

  it('[아니에요]면 버리고 코드 끝, 24시간 안에 확인하지 않으면 버린다', async () => {
    const { world, seller } = await ledgerWorld()
    const b = await sell(world, seller, [['UC_A', '가람', 1]])
    const token = await consent(world, seller, 'UC_A')
    const code = await newCode(world, token)
    await chat(world, seller, b, 'c-1', 'UC_Z', '제트', code)
    await waitFor(async () => (await codes(world)).at(-1)?.state === 'CLAIMED')
    const no = await postForm(world, `/r/${token}/ledger/link`, { answer: 'no' })
    const unlinkedAt = no.headers.get('location') as string
    expect(unlinkedAt).toMatch(new RegExp(`^/r/${token}\\?ledger=unlinked&n=[^#]+#ledger$`))
    expect((await openLink(world, unlinkedAt.replace('#ledger', ''))).text).toContain('잇지 않았어요. 필요하면 새 코드를 받아 주세요.')
    expect((await markers(world)).map((row) => row.marker)).toEqual(['c:UC_A'])
    expect((await codes(world)).at(-1)?.state).toBe('DONE')
    // 새 코드를 받고 확인 없이 24시간이 지나면 확인 칸이 없고 [네]도 듣지 않는다
    at(world, D, '20:30:00')
    const again = await newCode(world, token)
    await chat(world, seller, b, 'c-2', 'UC_Z', '제트', again)
    await waitFor(async () => (await codes(world)).at(-1)?.state === 'CLAIMED')
    world.clock.set(world.clock.now() + 24 * 60 * 60 * 1000)
    expect((await openLink(world, `/r/${token}`)).text).not.toContain('코드를 쳤어요')
    await postForm(world, `/r/${token}/ledger/link`, { answer: 'yes' })
    expect((await markers(world)).map((row) => row.marker)).toEqual(['c:UC_A'])
  })

  it('RA-KP1-007 코드를 친 계정이 이미 다른 장부 줄에 동의로 들어 있으면 [네]여도 옮기지 않고 코드를 끝낸다 — "이 계정은 이을 수 없어요."', async () => {
    const { world, seller } = await ledgerWorld()
    const b = await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_B', '나래', 1],
    ])
    const tokenA = await consent(world, seller, 'UC_A')
    at(world, D, '20:05:00')
    await consent(world, seller, 'UC_B', D, { name: '나래', phone: '010-3333-4444', address: '대전 서구 둔산로 1', detail: '', zip: '', memo: '' })
    const before = await markers(world)
    const linesBefore = await lines(world)
    const code = await newCode(world, tokenA)
    await chat(world, seller, b, 'c-b', 'UC_B', '나래', code)
    await waitFor(async () => (await codes(world)).at(-1)?.state === 'CLAIMED')
    const yes = await postForm(world, `/r/${tokenA}/ledger/link`, { answer: 'yes' })
    expect(yes.status).toBe(303)
    const location = yes.headers.get('location') as string
    expect(location).toMatch(new RegExp(`^/r/${tokenA}\\?ledger=refused&n=[^#]+#ledger$`))
    expect((await openLink(world, location.replace('#ledger', ''))).text).toContain('이 계정은 이을 수 없어요.')
    expect(await markers(world)).toEqual(before)
    expect(await lines(world)).toEqual(linesBefore)
    expect((await codes(world)).at(-1)).toMatchObject({ state: 'DONE', claimed_marker: null })
    expect((await consents(world)).map((row) => row.type)).toEqual(['AGREE', 'AGREE'])
    // 지은 주소로는 문장이 없다
    expect((await openLink(world, `/r/${tokenA}?ledger=refused`)).text).not.toContain('이 계정은 이을 수 없어요.')
  })

  it('RA-KP1-102 다른 줄에 코드로 든 계정도 [네]여도 옮기지 않는다 — 줄·표지·동의 기록 그대로', async () => {
    const { world, seller } = await ledgerWorld()
    const b = await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_B', '나래', 1],
    ])
    const tokenA = await consent(world, seller, 'UC_A')
    at(world, D, '20:05:00')
    const tokenB = await consent(world, seller, 'UC_B', D, { name: '나래', phone: '010-3333-4444', address: '대전 서구 둔산로 1', detail: '', zip: '', memo: '' })
    // UC_Z가 코드로 A 줄에 든다
    const first = await newCode(world, tokenA)
    await chat(world, seller, b, 'c-z1', 'UC_Z', '제트', first)
    await waitFor(async () => (await codes(world)).at(-1)?.state === 'CLAIMED')
    expect((await postForm(world, `/r/${tokenA}/ledger/link`, { answer: 'yes' })).status).toBe(303)
    expect((await markers(world)).find((row) => row.marker === 'c:UC_Z')).toMatchObject({ source: 'CODE' })
    const before = await markers(world)
    const linesBefore = await lines(world)
    const consentsBefore = await consents(world)
    // B 줄이 만든 코드를 UC_Z가 치고 [네]
    at(world, D, '20:10:00')
    const code = await newCode(world, tokenB)
    await chat(world, seller, b, 'c-z2', 'UC_Z', '제트', code)
    await waitFor(async () => (await codes(world)).at(-1)?.state === 'CLAIMED')
    const yes = await postForm(world, `/r/${tokenB}/ledger/link`, { answer: 'yes' })
    expect(yes.headers.get('location')).toMatch(/ledger=refused/)
    expect(await markers(world)).toEqual(before)
    expect(await lines(world)).toEqual(linesBefore)
    expect(await consents(world)).toEqual(consentsBefore)
    expect((await codes(world)).at(-1)).toMatchObject({ state: 'DONE', claimed_marker: null })
  })

  it('D-KP1-39 장부 동작 조건이 그사이 깨졌으면 "지금은 여기서 할 수 없어요." 한 줄', async () => {
    const { world, seller } = await ledgerWorld()
    await sell(world, seller, [['UC_A', '가람', 1]])
    const { linkFor } = await import('./kp1-ledger-support.ts')
    const token = await linkFor(world, seller, 'UC_A')
    const sent = await postForm(world, `/r/${token}/ledger/delete`, {})
    expect(sent.status).toBe(303)
    const location = (sent.headers.get('location') as string).replace('#ledger', '')
    expect(location).toContain('ledger=unavailable')
    expect((await openLink(world, location)).text).toContain('지금은 여기서 할 수 없어요. 저장한 정보를 지우려면 판매자에게 말해 주세요.')
    expect((await openLink(world, `/r/${token}?ledger=unavailable`)).text).not.toContain('지금은 여기서 할 수 없어요.')
  })
})
