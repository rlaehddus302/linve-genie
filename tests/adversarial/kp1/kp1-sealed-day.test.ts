// KP1 적대 시험 (test-domain) — SA-KP1-004: 봉인 날짜에는 동의 칸·장부 "확인 전"이 없다 (AC-KP1-02, CR-4).
// 날짜 S(2026-09-01)는 S + 30일 0시(KST)가 지나 봉인되고, 날짜 O(2026-09-20)는 아직 열려 있다. 같은 손님 UC_A가 둘 다에서 산다.
import { describe, expect, it } from 'vitest'
import { at, kst } from '../../../apps/server/test/i2-support.ts'
import { ledgerApi, ledgerWorld, linkFor, lines, openLink, rowsOf, consents, sendAddress } from '../../../apps/server/test/kp1-ledger-support.ts'
import { linkApi } from '../../../apps/server/test/n4b-support.ts'
import { sell } from '../../../apps/server/test/t1-support.ts'

const S = '2026-09-01'
const O = '2026-09-20'
const ADDRESS_STREET = '세종대로'
const CONSENT_MARK = 'name="keep"'
const LEDGER_TEXTS = ['지난번 배송지로 보낼게요', '저장해 둔 배송지가 있어요', '다음 주문에도']

describe('SA-KP1-004 봉인 날짜에는 동의 칸과 장부 "확인 전"이 없다 (적대)', () => {
  it('봉인 전 링크: 열린 날짜는 동의 칸이 있고, 봉인 뒤에는 칸·장부 글이 없거나 링크가 닫힌다. 묶음 자세히 ledger는 null. 손으로 보낸 keep=on은 장부·동의 기록을 만들지 않는다', async () => {
    const { world, seller } = await ledgerWorld(kst(S, '20:00:00'))
    await sell(world, seller, [['UC_A', '가람', 1]], S)
    const sealedLink = await linkFor(world, seller, 'UC_A', S) // 봉인 전에 받아 둔 링크
    // 대조: 봉인 전 S 링크에는 동의 칸이 있다 (이 시험이 빈 화면을 단언하는 게 아님을 보인다)
    const before = await openLink(world, `/r/${sealedLink}`)
    expect(before.status).toBe(200)
    expect(before.text).toContain(CONSENT_MARK)

    at(world, O, '20:00:00')
    await sell(world, seller, [['UC_A', '가람', 1]], O)
    const openLinkToken = await linkFor(world, seller, 'UC_A', O)
    // O에서 동의 → 장부 줄 하나
    expect((await sendAddress(world, openLinkToken, true)).status).toBe(303)
    expect(await lines(world)).toHaveLength(1)
    const consentsBefore = await consents(world)

    // 봉인: S + 30일 0시 KST가 지난 뒤 봉인 작업
    at(world, '2026-10-01', '00:00:01')
    expect(await world.server.sealer.runOnce()).toBe(1)

    const api = ledgerApi(world, seller.cookie)
    // 판매자 묶음 자세히: 장부 "확인 전" 없음
    const sealedBundle = await api.bundle('UC_A', S)
    // 봉인 날짜의 묶음은 열리지 않는다
    expect(sealedBundle.status, sealedBundle.text).toBe(404)
    expect(sealedBundle.text).not.toContain('홍길동')
    expect(sealedBundle.text).not.toContain(ADDRESS_STREET)

    // 봉인 뒤 확인서 링크(봉인 전에 받은 것)는 열리지 않는다
    const after = await openLink(world, `/r/${sealedLink}`)
    expect(after.status).toBe(404)
    expect(after.text).not.toContain(CONSENT_MARK)
    for (const text of LEDGER_TEXTS) expect(after.text, text).not.toContain(text)
    expect(after.text).not.toContain(ADDRESS_STREET)

    // 봉인 뒤 새 링크를 만들려 해도 (되면) 같다
    const fresh = await linkApi(world, seller.cookie).create(S, 'UC_A')
    expect(fresh.status, fresh.text).toBe(409)

    // 손으로 만든 keep=on: 장부·동의 기록이 늘지 않는다
    const sent = await sendAddress(world, sealedLink, true)
    expect(sent.status, sent.text).not.toBe(303)
    expect(await lines(world)).toHaveLength(1)
    expect(await consents(world)).toEqual(consentsBefore)
    const rows = await rowsOf(world, 'select count(*)::int as n from ledger_markers')
    expect(rows[0]?.n).toBeGreaterThanOrEqual(1)
  })
})

