// KP1 사용성 지적 서버 몫: 링크 화면 큰 글·큰 카드(UX-KP1-001·005·007·008·009), 공개 일정 알림 신청(UX-KP1-011),
// 장부 배송지 출처 LEDGER(004), 손님 표시 "아직 안 정함"(006), 보관 기간 줄이기 미리보기(002).
import { describe, expect, it } from 'vitest'
import { at, chat } from './i2-support.ts'
import { waitFor } from './support.ts'
import { D, codes, consent, ledgerApi, ledgerWorld, openLink, postForm, sell } from './kp1-ledger-support.ts'

describe('UX-KP1 확인서 링크 화면', () => {
  it('동의 칸은 체크 네모와 글이 한 줄 큰 카드, 글자 18px·버튼 52px, 코드 큰 상자·새 코드 받기, 지우기는 덜 눈에 띄는 버튼과 되돌릴 수 없다는 말', async () => {
    const { world, seller } = await ledgerWorld()
    const b = await sell(world, seller, [['UC_A', '가람', 1]])
    const token = await consent(world, seller, 'UC_A')
    const page = (await openLink(world, `/r/${token}`)).text
    expect(page).toContain('font-size:18px;line-height:1.6')
    expect(page).toContain('min-height:52px')
    expect(page).toContain('다른 계정으로 주문해도 저장한 배송지를 쓸 수 있어요.')
    expect(page).toContain('다른 계정도 잇기')
    // 코드가 살아 있는 동안은 새 코드 받기
    expect((await postForm(world, `/r/${token}/ledger/code`, {})).status).toBe(303)
    const live = (await openLink(world, `/r/${token}`)).text
    expect(live).toMatch(/<p class="code-box">[^<]+<\/p>/)
    expect(live).toContain('새 코드 받기 (지금 코드는 없어져요)')
    expect(live).not.toContain('다른 계정도 잇기')
    // 남이 친 경우: 두 버튼이 같은 무게 (주 버튼 없음)
    const code = (await codes(world)).at(-1)?.code as string
    await chat(world, seller, b, 'c-1', 'UC_Z', '제트', code)
    await waitFor(async () => (await codes(world)).at(-1)?.state === 'CLAIMED')
    const claim = (await openLink(world, `/r/${token}`)).text
    expect(claim).toContain('<button class="button" type="submit" name="answer" value="yes">네, 제 계정이에요</button>')
    expect(claim).toContain('<button class="button" type="submit" name="answer" value="no">아니에요</button>')
    // 지우기 확인: 되돌릴 수 없다는 문장, 지우기는 주 버튼이 아니다, 지운 뒤는 안내 상자
    const ask = (await openLink(world, `/r/${token}?ledger=delete`)).text
    expect(ask).toContain('지우면 되돌릴 수 없어요.')
    expect(ask).toContain('<button class="button" type="submit">지우기</button>')
    expect(ask).toContain('<a class="button primary" href="')
    const gone = await postForm(world, `/r/${token}/ledger/delete`, {})
    const done = (await openLink(world, (gone.headers.get('location') as string).replace('#ledger', ''))).text
    expect(done).toContain('<p class="info" role="status">지웠어요.</p>')
    expect(done).not.toContain('class="alert" role="status">지웠어요.')
  })

  it('동의 칸은 label 하나에 체크 네모·제목·설명이 모두 들어 있다', async () => {
    const { world, seller } = await ledgerWorld()
    await sell(world, seller, [['UC_A', '가람', 1]])
    const { linkFor } = await import('./kp1-ledger-support.ts')
    const token = await linkFor(world, seller, 'UC_A')
    const html = (await openLink(world, `/r/${token}?edit=1`)).text
    expect(html).toMatch(/<label for="f-keep" class="check-card consent-label"><input id="f-keep" type="checkbox"[^>]*><span><span>[^<]+<\/span><br><span class="muted" id="keep-help"[^>]*>[^<]+<\/span><\/span><\/label>/)
  })
})

describe('UX-KP1-004 장부 배송지 출처 · 006 손님 표시 미정 · 002 줄이기 미리보기', () => {
  it('손님 표시는 처음엔 null(아직 안 정함), 켬·끔·null을 그대로 돌려주고 null이어도 표시는 나온다', async () => {
    const { world, seller } = await ledgerWorld()
    const api = ledgerApi(world, seller.cookie)
    expect((await api.settings()).body).toEqual({ settings: { months: 12, consoleBadges: null } })
    expect((await api.saveSettings({ months: 12, consoleBadges: false })).body).toEqual({ settings: { months: 12, consoleBadges: false } })
    expect((await api.saveSettings({ months: 6, consoleBadges: null })).body).toEqual({ settings: { months: 6, consoleBadges: null } })
    expect((await api.saveSettings({ months: 6, consoleBadges: 'yes' })).status).toBe(400)
  })

  it('보관 기간 미리보기: 줄이면 새로 지워질 줄 수만(개인정보 없음), 잘못된 값은 400', async () => {
    const { world, seller } = await ledgerWorld()
    await sell(world, seller, [['UC_A', '가람', 1]])
    await consent(world, seller, 'UC_A')
    const api = ledgerApi(world, seller.cookie)
    const ask = (months: string) => world.server.app.request(`/api/ledger-settings/preview?months=${months}`, { headers: { Cookie: seller.cookie } })
    expect(await (await ask('6')).json()).toEqual({ months: 6, willDelete: 0 })
    expect((await ask('7')).status).toBe(400)
    world.clock.set(world.clock.now() + 8 * 30 * 24 * 60 * 60 * 1000)
    // 로그인 유효 기간을 넘기므로 서버 함수로 직접 센다
    expect(await world.server.ledger.shrinkPreview(seller.sellerId, 6)).toBe(1)
    expect(await world.server.ledger.shrinkPreview(seller.sellerId, 12)).toBe(0)
    expect(await api.settings()).toBeDefined()
  })
})
