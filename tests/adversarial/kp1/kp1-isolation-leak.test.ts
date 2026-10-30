// KP1 적대 시험 (test-domain) — 판매자만·판매자마다(AC-KP1-26), 새는 곳 없음(AC-KP1-27).
// - 같은 채널(UC_A)이 두 가게에서 산다: 가게 A의 장부·코드가 가게 B의 묶음·링크·꼬리표·손님 자세히·엑셀·채팅 코드 읽기에 나오지 않는다.
// - 장부 연락처·표지·코드 글·알림 번호가 판매대장(그날·전체)·백업·전체 기록 내려받기·포장 라벨·확인서·발송함·확인서 링크(가린 이름·끝 4자리 밖)·서버 로그에 없다.
// - 운영자 복구(바꾸기) 뒤에도 장부는 그대로이고 같은 손님에게만 보인다.
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { createBackupBytes, restoreSeller } from '../../../apps/server/src/backup.ts'
import { randomIds } from '../../../apps/server/src/ids.ts'
import { at, chat, getFile } from '../../../apps/server/test/i2-support.ts'
import { codes, consent, ledgerApi, ledgerWorld, linkFor, lines, logText, openLink, postForm, rowsOf, sendAddress } from '../../../apps/server/test/kp1-ledger-support.ts'
import { readZip } from '../../../apps/server/test/n4b-support.ts'
import { client, createBroadcast, waitFor, type Seller, type TestServer } from '../../../apps/server/test/support.ts'
import { expectNoSecret, parcelSeller, sell } from '../../../apps/server/test/t1-support.ts'

const D = '2026-10-19'
const D2 = '2026-10-26'
const settle = () => new Promise((resolve) => setTimeout(resolve, 80))

/** 새는지 볼 장부 연락처 (모두 한 번만 나오는 값) */
const SECRET = { name: '남궁비밀', phone: '010-8642-9753', address: '서울특별시 중구 비밀장부로 77', detail: '비밀동 909호', zip: '97531', memo: '' }
const SECRET_TEXTS = ['남궁비밀', '비밀장부로', '비밀동 909호']
const SECRET_NUMBERS = ['010-8642-9753', '01086429753', '8642-9753', '97531']

async function newCode(world: TestServer, token: string): Promise<string> {
  const sent = await postForm(world, `/r/${token}/ledger/code`, {})
  expect(sent.status, sent.text).toBe(303)
  const live = (await codes(world)).filter((row) => row.state === 'LIVE')
  expect(live).toHaveLength(1)
  return live[0]?.code as string
}

function expectClean(where: string, text: string): void {
  for (const secret of SECRET_TEXTS) expect(text, `${where}: ${secret}`).not.toContain(secret)
  for (const secret of SECRET_NUMBERS) expectNoSecret(text, secret, `${where}: ${secret}`)
}

describe('AC-KP1-26 같은 사람이 두 가게에서 사도 섞이지 않는다 (적대)', () => {
  it('가게 A에서 UC_A가 장부에 남긴 연락처·코드가 가게 B의 묶음 자세히·링크·꼬리표·손님 자세히·엑셀·채팅 코드 읽기에 없다. B의 동의는 A의 줄을 바꾸지 않는다', async () => {
    const { world, seller: a } = await ledgerWorld()
    const b = await parcelSeller(world)
    await sell(world, a, [['UC_A', '가람', 1]])
    await sell(world, b, [['UC_A', '가람', 1]])
    const apiA = ledgerApi(world, a.cookie)
    const apiB = ledgerApi(world, b.cookie)
    // 다음 방송: 두 가게 모두 UC_A가 다시 산다
    at(world, D2, '20:00:00')
    const bA = await sell(world, a, [['UC_A', '가람', 1]], D2)
    const bB = await sell(world, b, [['UC_A', '가람', 1]], D2)
    // B 꼬리표의 기준 (A가 장부를 만들기 전, 같은 시각)
    const badgesBefore = (await apiB.badges(D2, ['UC_A'])).body
    const tokenA = await consent(world, a, 'UC_A', D, SECRET)
    const code = await newCode(world, tokenA)
    // 가게 A에는 보인다 (확인)
    expect(((await apiA.bundle('UC_A', D2)).body.bundle as { ledger: unknown }).ledger).toMatchObject({ name: SECRET.name })
    // 가게 B: 묶음 자세히·링크에 없다
    const bundleB = await apiB.bundle('UC_A', D2)
    expect(bundleB.status, bundleB.text).toBe(200)
    expect((bundleB.body.bundle as { ledger: unknown }).ledger).toBeNull()
    expectClean('B 묶음 자세히', bundleB.text)
    const pageB = await openLink(world, `/r/${await linkFor(world, b, 'UC_A', D2)}`)
    expect(pageB.status).toBe(200)
    expect(pageB.text).not.toContain('지난번 배송지로 보낼게요')
    expect(pageB.text).not.toContain('저장해 둔 배송지가 있어요')
    expect(pageB.text).not.toContain('남**밀')
    expectClean('B 링크', pageB.text)
    // B 꼬리표는 A의 장부와 상관없다 (A 동의 전과 같은 판단 재료 — D에 B에서 산 기록만)
    expect((await apiB.badges(D2, ['UC_A'])).body).toEqual(badgesBefore)
    // B 손님 자세히·엑셀(연락처 포함)
    const rowsB = (await apiB.customers()).body.customers as { id: string; name: string }[]
    expect(rowsB).toHaveLength(1)
    const detailB = await apiB.customer(rowsB[0]?.id as string)
    expect(detailB.status).toBe(200)
    expect(detailB.body.ledger).toBeNull()
    const xlsxB = await apiB.xlsx('1')
    expect(xlsxB.status).toBe(200)
    expectClean('B 엑셀', readZip(new Uint8Array(await xlsxB.arrayBuffer())).map((item) => new TextDecoder().decode(item.bytes)).join('\n'))

    // A의 코드를 B의 방송 채팅에 쳐도 A의 코드는 붙지 않는다 (코드는 그 판매자의 회차에서만 읽는다)
    await chat(world, b, bB, 'b-code', 'UC_THIEF', '도둑', code.replace(' ', ''))
    await settle()
    expect((await codes(world)).find((row) => row.code === code)?.state).toBe('LIVE')
    // A의 방송에서 치면 붙는다 (확인)
    await chat(world, a, bA, 'a-code', 'UC_Z', '제트', code)
    await waitFor(async () => (await codes(world)).find((row) => row.code === code)?.state === 'CLAIMED')

    // B에서 UC_A가 다른 배송지로 동의 → B의 줄이 따로 생기고 A의 줄·연락처는 그대로
    const other = { name: '나다른', phone: '010-2222-3333', address: '부산광역시 해운대구 다른로 1', detail: '', zip: '48000', memo: '' }
    const tokenB = await linkFor(world, b, 'UC_A', D2)
    expect((await sendAddress(world, tokenB, true, other)).status).toBe(303)
    const all = await lines(world)
    expect(all.map((row) => row.seller_id).sort()).toEqual([a.sellerId, b.sellerId].sort())
    expect(((await apiA.bundle('UC_A', D2)).body.bundle as { ledger: unknown }).ledger).toMatchObject({ name: SECRET.name, phone: '01086429753' })
    // B의 D 묶음(배송지 없음)은 B 자신의 줄만 본다
    expect(((await apiB.bundle('UC_A', D)).body.bundle as { ledger: { name: string } | null }).ledger?.name).toBe('나다른')
  })

  it('판매자 장부 경로 전부: 로그인 없음 401·보조자 403·다른 판매자 404·no-store (손님 자세히 장부 칸·배송지 확인·지우기)', async () => {
    const { world, seller } = await ledgerWorld()
    await sell(world, seller, [['UC_A', '가람', 1]])
    await consent(world, seller, 'UC_A', D, SECRET)
    at(world, D2, '20:00:00')
    await sell(world, seller, [['UC_A', '가람', 1]], D2)
    const api = ledgerApi(world, seller.cookie)
    const prefill = (await api.bundle('UC_A', D2)).body.bundle as { ledger: { ledgerId: string; updatedAt: string } }
    const id = ((await api.customers()).body.customers as { id: string }[])[0]?.id as string
    const created = (await client(world, seller.cookie).post('/api/assistants', { name: '엄마' })).body as { assistant: { loginId: string }; password: string }
    const { login } = await import('../../../apps/server/test/support.ts')
    const helper = await login(world, created.assistant.loginId, created.password)
    const other = await parcelSeller(world)
    const calls = (cookie: string | null) => {
      const x = ledgerApi(world, cookie)
      return [
        x.customer(id),
        x.confirmLedger('UC_A', prefill.ledger.ledgerId, prefill.ledger.updatedAt, D2),
        x.deleteLedger(id, prefill.ledger.ledgerId),
        x.api.get(`/api/days/${D2}/report`),
        x.api.get('/api/schedule/alerts'),
      ]
    }
    for (const response of await Promise.all(calls(null))) expect(response.status, response.text).toBe(401)
    for (const response of await Promise.all(calls(helper))) expect(response.status, response.text).toBe(403)
    for (const response of await Promise.all(calls(other.cookie))) {
      expect([404, 200]).toContain(response.status)
      expect(response.headers.get('cache-control')).toContain('no-store')
      expectClean('다른 판매자', response.text)
    }
    // 다른 판매자의 손님 자세히·지우기·리포트는 404, 장부는 그대로
    const [detail, confirm, remove, report] = await Promise.all(calls(other.cookie))
    expect([detail?.status, confirm?.status, remove?.status, report?.status]).toEqual([404, 404, 404, 404])
    expect(await lines(world)).toHaveLength(1)
  })
})

describe('AC-KP1-27 새는 곳 없음 (적대)', () => {
  async function richWorld(): Promise<{ world: TestServer; seller: Seller; code: string; tokenD2: string }> {
    const { world, seller } = await ledgerWorld()
    await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_B', '나래', 1],
    ])
    const tokenA = await consent(world, seller, 'UC_A', D, SECRET)
    // 방송 알림 신청 (번호)
    const api = client(world, seller.cookie)
    const page = await api.put('/api/schedule/page', { enabled: true, channelUrl: null })
    expect(page.status, page.text).toBe(200)
    const path = new URL((page.body.page as { url: string }).url).pathname
    expect((await postForm(world, `${path}/alert`, { phone: '010-7531-8642', agree: 'on' })).status).toBe(303)
    // 다음 방송: UC_A 묶음에 "확인 전"으로 보인다. 도둑 UC_T가 코드를 친다
    at(world, D2, '20:00:00')
    const b2 = await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_T', '도둑', 1],
    ], D2)
    const code = await newCode(world, tokenA)
    await chat(world, seller, b2, 't-code', 'UC_T', '도둑', code)
    await waitFor(async () => (await codes(world)).at(-1)?.state === 'CLAIMED')
    const tokenD2 = await linkFor(world, seller, 'UC_A', D2)
    return { world, seller, code, tokenD2 }
  }

  it('판매대장(그날·전체)·전체 기록 내려받기·백업·포장 라벨·확인서·발송함·서버 로그에 장부 연락처·표지·코드 글·알림 번호가 없다', async () => {
    const { world, seller, code } = await richWorld()
    const texts: [string, string][] = []
    for (const path of ['/api/export/ledger.xlsx', `/api/ledger.xlsx?from=${D}&to=${D2}`]) {
      const file = await getFile(world, seller.cookie, path)
      expect(file.status, path).toBe(200)
      texts.push([path, readZip(file.bytes).map((item) => new TextDecoder().decode(item.bytes)).join('\n')])
    }
    const records = await getFile(world, seller.cookie, '/api/export/records.json.gz')
    expect(records.status).toBe(200)
    texts.push(['records', gunzipSync(records.bytes).toString('utf8')])
    texts.push(['backup', gunzipSync(await createBackupBytes(world.database.db, seller.sellerId, world.clock.now())).toString('utf8')])
    for (const date of [D, D2]) {
      for (const path of [`/api/days/${date}/packing-label?buyer=UC_A`, `/api/days/${date}/receipt?buyer=UC_A`]) {
        const response = await client(world, seller.cookie).get(path)
        if (response.status === 200) texts.push([path, response.text])
      }
    }
    // D2 묶음은 배송지가 없다(장부는 "확인 전"으로 보이기만) — 라벨·확인서에 장부 연락처가 들어가면 안 된다
    texts.push(['outbox', JSON.stringify(await rowsOf(world, 'select * from outbox'))])
    texts.push(['logs', logText(world)])
    // 코드 채팅 자체는 다른 채팅과 똑같이 기록된다(AC-KP1-10, 입력 우선 기록) — 그 채팅 본문 한 곳만 빼고 본다
    const chatBody = (text: string) => text.split(`\\"text\\":\\"${code}\\"`).join('').split(`"text":"${code}"`).join('')
    for (const [where, raw] of texts) {
      const text = chatBody(raw)
      if (where !== `/api/days/${D}/packing-label?buyer=UC_A` && where !== `/api/days/${D}/receipt?buyer=UC_A`) expectClean(where, text)
      for (const word of [code, code.replace(' ', ''), 'c:UC_A', 'c:UC_T', '010-7531-8642', '01075318642', 'customer-ledger', 'ledger_lines', 'alert_subscribers']) {
        expect(text, `${where}: ${word}`).not.toContain(word)
      }
    }
  })

  it('다음 방송의 확인서 링크: 가린 이름·끝 4자리만 (다시 적기 양식에도 장부 값을 채우지 않는다), 코드 친 사람의 화면 이름은 이스케이프', async () => {
    const { world, seller, tokenD2 } = await richWorld()
    const page = await openLink(world, `/r/${tokenD2}`)
    expect(page.status).toBe(200)
    expect(page.text).toContain('지난번 배송지로 보낼게요 (받는 분 남**밀 · 연락처 끝 9753)')
    expectClean('D2 링크', page.text)
    const edit = await openLink(world, `/r/${tokenD2}?edit=1`)
    expect(edit.status).toBe(200)
    expectClean('D2 링크 다시 적기', edit.text)
    // 저장해 둔 배송지 칸 확인 화면·코드 확인 화면
    for (const query of ['?ledger=delete', '?ledger=linked', '?ledger=deleted']) expectClean(`D2 링크 ${query}`, (await openLink(world, `/r/${tokenD2}${query}`)).text)
    // 화면 이름에 태그를 넣은 도둑
    const b3 = (await createBroadcast(world, seller, { date: D2 })).id
    const token = await linkFor(world, seller, 'UC_A', D)
    const fresh = await newCode(world, token)
    await chat(world, seller, b3, 'x-code', 'UC_EVIL1', '<img src=x onerror=alert(1)>', fresh)
    await waitFor(async () => (await codes(world)).find((row) => row.code === fresh)?.state === 'CLAIMED')
    const claim = await openLink(world, `/r/${token}`)
    expect(claim.text).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(claim.text).not.toContain('<img src=x')
  })

  it('운영자 복구(바꾸기) 뒤에도 장부 줄·표지·동의 기록은 그대로이고, 다음 방송에서 같은 손님(UC_A)에게만 보인다', async () => {
    const { world, seller } = await ledgerWorld()
    await sell(world, seller, [
      ['UC_A', '가람', 1],
      ['UC_B', '나래', 1],
    ])
    await consent(world, seller, 'UC_A', D, SECRET)
    const before = {
      lines: await lines(world),
      markers: await rowsOf(world, 'select seller_id, marker, line_id, source from ledger_markers order by id'),
      consents: await rowsOf(world, 'select * from ledger_consents order by id'),
    }
    const bytes = await createBackupBytes(world.database.db, seller.sellerId, world.clock.now())
    const restored = await restoreSeller({ db: world.database.db, sellerId: seller.sellerId, bytes, replace: true, storage: { write: async () => ({ name: 'safety' }) } as never, clock: world.clock, ids: randomIds })
    expect(restored.ok, JSON.stringify(restored)).toBe(true)
    expect(await lines(world)).toEqual(before.lines)
    expect(await rowsOf(world, 'select seller_id, marker, line_id, source from ledger_markers order by id')).toEqual(before.markers)
    expect(await rowsOf(world, 'select * from ledger_consents order by id')).toEqual(before.consents)
    at(world, D2, '20:00:00')
    await sell(world, seller, [
      ['UC_B', '나래', 1],
      ['UC_A', '가람', 1],
    ], D2)
    const api = ledgerApi(world, seller.cookie)
    expect(((await api.bundle('UC_A', D2)).body.bundle as { ledger: unknown }).ledger).toMatchObject({ name: SECRET.name })
    expect(((await api.bundle('UC_B', D2)).body.bundle as { ledger: unknown }).ledger).toBeNull()
  })
})
