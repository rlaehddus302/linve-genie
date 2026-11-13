// 정산 정보 입력·처음 한 번 묻기·방송이 끝나면 정산 화면·모두에게 보내기 (D-RETRO-60~64)
import Svg from 'react-native-svg'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { STATEMENT_SHIPPING_DEFAULT, statementInfoMissing, type StatementInfo } from '../src/lib/broadcast-sales.ts'
import { nativeSms, setNativeModules } from '../src/native/index.ts'
import { ConsoleScreen } from '../src/screens/ConsoleScreen.tsx'
import { IN_APP_SCREENS } from '../src/screens/MoreScreen.tsx'
import { ASK_BODY, LATER_LABEL, SAVE_LABEL, SAVED_NOTE, SHIPPING_APPLY_NOTE, StatementInfoScreen, shippingSummary } from '../src/screens/StatementInfo.tsx'
import { ENDED_WHILE_AWAY, ManageScreen } from '../src/screens/console/StackScreens.tsx'
import { makeWorld, type ScreenWorld } from './screen-support.tsx'
import { BROADCAST, BROADCAST_VIEW, buyer, changes, claim, flush, fullView, product } from './support.ts'

const EMPTY: StatementInfo = { bank: '', accountNumber: '', accountHolder: '', phone: '', hostName: '', shipping: STATEMENT_SHIPPING_DEFAULT, decided: false }
const FULL: StatementInfo = { bank: '농협', accountNumber: '302-9988-7766-11', accountHolder: '김판매', phone: '010-1234-5678', hostName: '홍재라이브', shipping: STATEMENT_SHIPPING_DEFAULT, decided: true }

/** 정산 정보 주소가 있는 서버: GET은 지금 값, PUT은 받은 값을 저장한 것으로 답한다 */
function infoServer(world: ScreenWorld, start: StatementInfo) {
  let info = start
  world.server.on('GET', /^\/api\/statement-info$/, () => ({ body: { info } }))
  world.server.on('PUT', /^\/api\/statement-info$/, (call) => {
    const body = call.body as Record<string, unknown>
    const sent = body.shipping as { charge: boolean; fee: unknown; freeFrom: unknown }
    const won = (value: unknown) => (value === null || value === '' ? null : Number(String(value).replace(/,/g, '')))
    info = { ...(body as unknown as StatementInfo), shipping: sent.charge ? { charge: true, fee: won(sent.fee) ?? 0, freeFrom: won(sent.freeFrom) } : { charge: false, fee: 0, freeFrom: null }, decided: true }
    return { body: { info } }
  })
  return { puts: () => world.server.callsTo('PUT', /^\/api\/statement-info$/) }
}

/** 끝난(또는 방송 중인) 방송 하나와 손님 셋 */
function salesWorld(start: StatementInfo | null, options: { readonly ended?: boolean } = {}) {
  const world = makeWorld()
  const names = ['가을여행', '나오미다육', '미자네']
  const products = names.map((_, i) => product(201 + i, { name: `색금${i + 1}`, price: 30000 }))
  const claims = names.map((name, i) => claim(String(i), 201 + i, name, { amount: 30000 }))
  const ended = options.ended !== false
  world.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [{ ...BROADCAST, date: '2026-11-12', ended, endedAt: ended ? '2026-11-12T12:00:00.000Z' : null }] } }))
  world.server.on('GET', /^\/api\/days\/2026-11-12$/, () => ({ body: fullView({ date: '2026-11-12', broadcasts: [{ ...BROADCAST_VIEW, date: '2026-11-12', ended, endedAt: ended ? '2026-11-12T12:00:00.000Z' : null }], products, claims, buyers: names.map(name => buyer(name, name)) }) }))
  world.server.on('GET', /order-shop$/, () => ({ body: { name: '용용다육' } }))
  world.server.on('POST', /receipt-sms\/prepare$/, () => ({ body: { sms: { phone: '01000000000', text: '' } } }))
  const server = start === null ? null : infoServer(world, start)
  return { world, puts: () => server?.puts() ?? [] }
}

function sms(result: 'sent' | 'cancelled' | 'unknown') {
  const compose = vi.fn(async () => result)
  const previous = nativeSms()
  setNativeModules({ sms: { available: async () => true, compose } })
  const snapshot = vi.spyOn(Svg.prototype, 'toDataURL').mockImplementation(cb => cb('iVBORw0KGgo='))
  onTestFinished(() => { snapshot.mockRestore(); setNativeModules({ sms: previous }) })
  return compose
}
const paperTexts = () => [...document.querySelectorAll('svg text')].map(node => node.textContent)
const sheetOf = () => screen.queryByRole('dialog', { name: '정산 정보' })

describe('정산 정보 화면 (전체 탭 → 정산 정보)', () => {
  it('전체 탭 가게 묶음에 "정산 정보" 줄이 있다', () => {
    expect(IN_APP_SCREENS.find(row => row.path === '/statement-info')).toEqual({ path: '/statement-info', title: '정산 정보', group: '가게' })
  })

  it('처음에는 배송비가 5만 원 미만 5,000원으로 채워져 있고, 적은 값을 그대로 저장한다', async () => {
    const world = makeWorld()
    const server = infoServer(world, EMPTY)
    render(world.wrap(<StatementInfoScreen onBack={() => {}} />))
    expect(await screen.findByDisplayValue('5000')).toBeTruthy()
    expect(screen.getByDisplayValue('50000')).toBeTruthy()
    expect(screen.getByText('상품 합계가 50,000원보다 적으면 배송비 5,000원을 더해요. 50,000원부터는 무료예요.')).toBeTruthy()
    expect(screen.getByText(SHIPPING_APPLY_NOTE)).toBeTruthy()
    for (const [label, value] of [['은행', '농협'], ['계좌번호', '302-9988-7766-11'], ['예금주', '김판매'], ['전화번호', '010-1234-5678'], ['방송 이름', '홍재라이브']] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } })
    }
    fireEvent.click(screen.getByRole('button', { name: SAVE_LABEL }))
    expect(await screen.findByText(SAVED_NOTE)).toBeTruthy()
    expect(server.puts().map(call => call.body)).toEqual([{ bank: '농협', accountNumber: '302-9988-7766-11', accountHolder: '김판매', phone: '010-1234-5678', hostName: '홍재라이브', shipping: { charge: true, fee: '5000', freeFrom: '50000' } }])
  })

  it('배송비 받기를 끄면 금액 칸이 사라지고 "받지 않음"으로 저장한다', async () => {
    const world = makeWorld()
    const server = infoServer(world, FULL)
    render(world.wrap(<StatementInfoScreen onBack={() => {}} />))
    await screen.findByDisplayValue('5000')
    fireEvent.click(screen.getByRole('switch', { name: '배송비 받기 — 켜짐' }))
    expect(screen.queryByDisplayValue('5000')).toBeNull()
    expect(screen.getByText('정산서에 배송비 줄을 넣지 않아요.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: SAVE_LABEL }))
    await waitFor(() => expect(server.puts()).toHaveLength(1))
    expect(server.puts()[0]!.body).toMatchObject({ shipping: { charge: false, fee: 0, freeFrom: null } })
  })

  it('서버가 돌려준 칸별 문제를 그 칸 아래에 보이고 저장했다고 하지 않는다', async () => {
    const world = makeWorld()
    world.server.on('GET', /^\/api\/statement-info$/, () => ({ body: { info: EMPTY } }))
    world.server.on('PUT', /^\/api\/statement-info$/, () => ({ status: 400, body: { error: { code: 'INVALID_INPUT', message: '입력한 내용을 확인해 주세요.', problems: [{ field: 'phone', message: "전화번호는 숫자와 '-'로 20글자까지 적어 주세요." }, { field: 'shipping.fee', message: '배송비는 1원부터 1,000,000원까지 숫자로 적어 주세요.' }] } } }))
    render(world.wrap(<StatementInfoScreen onBack={() => {}} />))
    await screen.findByDisplayValue('5000')
    fireEvent.click(screen.getByRole('button', { name: SAVE_LABEL }))
    expect(await screen.findByText("전화번호는 숫자와 '-'로 20글자까지 적어 주세요.")).toBeTruthy()
    expect(screen.getByText('배송비는 1원부터 1,000,000원까지 숫자로 적어 주세요.')).toBeTruthy()
    expect(screen.queryByText(SAVED_NOTE)).toBeNull()
  })

  it('배송비 한 줄 설명은 적은 값 그대로 — 기준이 없으면 늘 더한다', () => {
    expect(shippingSummary({ charge: true, fee: '3,500', freeFrom: '' })).toBe('정산서마다 배송비 3,500원을 더해요.')
    expect(shippingSummary({ charge: true, fee: '5000', freeFrom: '50000' })).toBe('상품 합계가 50,000원보다 적으면 배송비 5,000원을 더해요. 50,000원부터는 무료예요.')
    expect(shippingSummary({ charge: false, fee: '5000', freeFrom: '50000' })).toBe('정산서에 배송비 줄을 넣지 않아요.')
    // 숫자가 아닌 글·소수는 설명하지 않는다 (저장하면 서버가 그 칸의 문장을 준다)
    for (const fee of ['', '오천', '5000.5', '0']) expect(shippingSummary({ charge: true, fee, freeFrom: '' })).toBeNull()
  })

  it('다시 물을지: 한 번도 정하지 않았거나 계좌·전화번호가 비어 있으면', () => {
    expect(statementInfoMissing(EMPTY)).toBe(true)
    expect(statementInfoMissing(FULL)).toBe(false)
    expect(statementInfoMissing({ ...FULL, phone: ' ' })).toBe(true)
    expect(statementInfoMissing({ ...FULL, accountHolder: '' })).toBe(true)
    expect(statementInfoMissing({ ...FULL, hostName: '' })).toBe(false)
  })
})

describe('방송을 끝낸 직후·정산서를 처음 만들 때 묻기', () => {
  it('방송을 끝낸 직후 정산 정보가 비어 있으면 판이 뜬다 — 왼쪽 [나중에] · 오른쪽 [저장], 건너뛰면 계좌·전화번호 줄 없이 만든다', async () => {
    const { world, puts } = salesWorld(EMPTY)
    render(world.wrap(<ConsoleScreen broadcastId="b1" seller justEnded onBack={() => {}} />))
    // 끝내자마자 정산 화면
    expect(await screen.findByText('정산 내역서')).toBeTruthy()
    const sheet = await screen.findByRole('dialog', { name: '정산 정보' })
    expect(within(sheet).getByText(ASK_BODY)).toBeTruthy()
    const later = within(sheet).getByRole('button', { name: LATER_LABEL })
    const save = within(sheet).getByRole('button', { name: SAVE_LABEL })
    // 단추는 좌우 한 줄, 부정이 왼쪽 (절대 규칙 8)
    expect(later.parentElement?.parentElement).toBe(save.parentElement?.parentElement)
    expect(later.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(later)
    await waitFor(() => expect(sheetOf()).toBeNull())
    expect(puts()).toHaveLength(0)
    // 건너뛴 뒤 정산서를 열어도 다시 묻지 않고, 계좌·전화번호 줄 없이 기본 배송비로 만든다
    fireEvent.click(screen.getByRole('button', { name: /^가을여행 정산서 · 30,000원/ }))
    await waitFor(() => expect(paperTexts()).toContain('✲용용다육 정산서✲'))
    expect(sheetOf()).toBeNull()
    expect(paperTexts()).toEqual(expect.arrayContaining(['배송비', '5,000', '35,000', '총 개수']))
    for (const gone of ['계좌', '전화번호']) expect(paperTexts()).not.toContain(gone)
  })

  it('판에서 저장하면 정산서에 계좌·전화번호·방송 이름이 바로 찍힌다', async () => {
    const { world, puts } = salesWorld(EMPTY)
    render(world.wrap(<ConsoleScreen broadcastId="b1" seller justEnded onBack={() => {}} />))
    const sheet = await screen.findByRole('dialog', { name: '정산 정보' })
    for (const [label, value] of [['은행', '농협'], ['계좌번호', '302-9988-7766-11'], ['예금주', '김판매'], ['전화번호', '010-1234-5678'], ['방송 이름', '홍재라이브']] as const) {
      fireEvent.change(within(sheet).getByLabelText(label), { target: { value } })
    }
    fireEvent.click(within(sheet).getByRole('button', { name: SAVE_LABEL }))
    await waitFor(() => expect(sheetOf()).toBeNull())
    expect(puts()).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /^나오미다육 정산서/ }))
    await waitFor(() => expect(paperTexts()).toEqual(expect.arrayContaining(['홍재라이브', '나오미다육 님', '2026.11.12', '계좌', '농협 302-9988-7766-11 김판매', '전화번호', '010-1234-5678'])))
  })

  it('끝난 방송을 나중에 열면 바로 묻지 않고, 정산서를 처음 만들 때 한 번 묻는다 — 저장하면 그 정산서가 열린다', async () => {
    const { world, puts } = salesWorld(EMPTY)
    render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
    const row = await screen.findByRole('button', { name: /^미자네 정산서/ })
    await act(async () => { await flush() })
    expect(sheetOf()).toBeNull()
    fireEvent.click(row)
    const sheet = await screen.findByRole('dialog', { name: '정산 정보' })
    // 아직 정산서는 열리지 않았다
    expect(paperTexts()).not.toContain('✲용용다육 정산서✲')
    fireEvent.click(within(sheet).getByRole('switch', { name: '배송비 받기 — 켜짐' }))
    fireEvent.click(within(sheet).getByRole('button', { name: SAVE_LABEL }))
    await waitFor(() => expect(paperTexts()).toContain('✲용용다육 정산서✲'))
    expect(puts()).toHaveLength(1)
    // 받지 않기로 했으니 배송비 줄이 없다
    expect(paperTexts()).toContain('미자네 님')
    expect(paperTexts()).not.toContain('배송비')
  })

  it('정산 정보가 다 있으면 방송을 끝낸 직후에도 묻지 않는다', async () => {
    const full = salesWorld(FULL)
    const first = render(full.world.wrap(<ConsoleScreen broadcastId="b1" seller justEnded onBack={() => {}} />))
    fireEvent.click(await screen.findByRole('button', { name: /^가을여행 정산서/ }))
    await waitFor(() => expect(paperTexts()).toContain('계좌'))
    expect(sheetOf()).toBeNull()
    first.unmount()
  })

  it('정했지만 전화번호가 비어 있으면 방송을 끝낸 직후에는 다시 묻는다', async () => {
    const ended = salesWorld({ ...FULL, phone: '' })
    const first = render(ended.world.wrap(<ConsoleScreen broadcastId="b1" seller justEnded onBack={() => {}} />))
    expect(await screen.findByRole('dialog', { name: '정산 정보' })).toBeTruthy()
    first.unmount()
  })

  it('정산서를 만들 때는 정한 적이 있으면 전화번호가 비어 있어도 묻지 않는다', async () => {
    const later = salesWorld({ ...FULL, phone: '' })
    render(later.world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
    fireEvent.click(await screen.findByRole('button', { name: /^가을여행 정산서/ }))
    await waitFor(() => expect(paperTexts()).toContain('계좌'))
    expect(sheetOf()).toBeNull()
    expect(paperTexts()).not.toContain('전화번호')
  })

  it('서버가 정산 정보 주소를 아직 모르면 묻지 않고 기본 배송비로 만든다', async () => {
    const { world } = salesWorld(null)
    render(world.wrap(<ConsoleScreen broadcastId="b1" seller justEnded onBack={() => {}} />))
    fireEvent.click(await screen.findByRole('button', { name: /^가을여행 정산서/ }))
    await waitFor(() => expect(paperTexts()).toEqual(expect.arrayContaining(['배송비', '5,000', '35,000'])))
    expect(sheetOf()).toBeNull()
    expect(screen.queryByRole('button', { name: '정산 정보' })).toBeNull()
  })

  it('정산 정보를 받지 못하면(서버 오류) 정산서를 만들지 않고 다시 불러오기를 보인다', async () => {
    const { world } = salesWorld(null)
    world.server.on('GET', /^\/api\/statement-info$/, () => ({ status: 500, body: { error: { code: 'INTERNAL', message: '잠시 뒤 다시 해 주세요.' } } }))
    render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
    fireEvent.click(await screen.findByRole('button', { name: /^가을여행 정산서/ }))
    expect(await screen.findByText('정산 정보를 불러오지 못했어요.')).toBeTruthy()
    expect(paperTexts()).not.toContain('✲용용다육 정산서✲')
    expect(screen.getByRole('button', { name: '다시 불러오기' })).toBeTruthy()
  })
})

describe('방송이 끝나면 바로 정산 화면 (D-RETRO-63)', () => {
  const endNow = async (world: ScreenWorld) => {
    world.server.on('GET', /^\/api\/days\/2026-11-12\/changes\?since=5/, () => ({ body: changes(5, 6, { date: '2026-11-12', broadcasts: [{ ...BROADCAST_VIEW, date: '2026-11-12', ended: true, endedAt: '2026-11-12T12:00:00.000Z' }] }) }))
    await act(async () => {
      world.source().emit('change', { date: '2026-11-12', rehearsal: false, seq: 6, type: 'broadcast.end' })
      await flush()
    })
  }
  const openLive = async (world: ScreenWorld) => {
    await waitFor(() => expect(screen.getByTestId('console-screen')).toBeTruthy())
    await act(async () => {
      world.source().open([{ date: '2026-11-12', rehearsal: false, seq: 5 }])
      await flush()
    })
  }

  it('방송 화면을 보는 동안 저절로 끝나면 정산 화면으로 넘어가고 정산 정보를 묻는다', async () => {
    const { world } = salesWorld(EMPTY, { ended: false })
    render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
    await openLive(world)
    expect(screen.queryByText('정산 내역서')).toBeNull()
    await endNow(world)
    expect(await screen.findByText('정산 내역서')).toBeTruthy()
    expect(screen.getByText('판매 수량 3개 · 구매자 3명')).toBeTruthy()
    expect(await screen.findByRole('dialog', { name: '정산 정보' })).toBeTruthy()
  })

  it('다른 화면(쌓인 화면)을 쓰던 중이면 판을 띄우지 않고, 돌아오면 띄운다', async () => {
    const { world } = salesWorld(EMPTY, { ended: false })
    const mounted = render(world.wrap(<ConsoleScreen broadcastId="b1" seller focused={false} onBack={() => {}} />))
    await openLive(world)
    await endNow(world)
    expect(await screen.findByText('정산 내역서')).toBeTruthy()
    await act(async () => { await flush() })
    expect(sheetOf()).toBeNull()
    mounted.rerender(world.wrap(<ConsoleScreen broadcastId="b1" seller focused onBack={() => {}} />))
    expect(await screen.findByRole('dialog', { name: '정산 정보' })).toBeTruthy()
  })

  it('라이브 관리 화면을 쓰던 중에 끝나면 화면은 그대로 두고 한 줄로만 알린다', async () => {
    const { world } = salesWorld(FULL, { ended: false })
    render(world.wrap(<ManageScreen broadcastId="b1" onBack={() => {}} openLink={() => {}} />))
    await waitFor(() => expect(screen.getByTestId('console-settings')).toBeTruthy())
    await act(async () => {
      world.source().open([{ date: '2026-11-12', rehearsal: false, seq: 5 }])
      await flush()
    })
    expect(screen.queryByText(ENDED_WHILE_AWAY)).toBeNull()
    await endNow(world)
    expect(await screen.findByText(ENDED_WHILE_AWAY)).toBeTruthy()
    expect(screen.getByTestId('console-settings')).toBeTruthy()
  })
})

describe('모두에게 보내기 (D-RETRO-64)', () => {
  it('한 명씩 문자 앱을 열고, 보내면 다음 손님으로 넘어가며 보낸 손님을 표시한다', async () => {
    const compose = sms('sent')
    const { world } = salesWorld(FULL)
    render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
    // 단추는 좌우 한 줄: 왼쪽 [내보내기] · 오른쪽 [모두에게 보내기]
    await screen.findByText('용용다육')
    const all = await screen.findByRole('button', { name: '모두에게 보내기' })
    const out = screen.getByRole('button', { name: '내보내기' })
    expect(out.parentElement?.parentElement).toBe(all.parentElement?.parentElement)
    expect(out.compareDocumentPosition(all) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(all)
    const sheet = await screen.findByRole('dialog', { name: '모두에게 정산서 보내기' })
    expect(within(sheet).getByText('구매자 3명 가운데 0명에게 보냈어요.')).toBeTruthy()
    expect(within(sheet).getAllByRole('listitem').map(row => row.getAttribute('aria-label'))).toEqual(['가을여행 아직', '나오미다육 아직', '미자네 아직'])
    fireEvent.click(within(sheet).getByRole('button', { name: '보내기 시작' }))
    // 첫 손님
    expect(await screen.findByText('모두에게 보내기 · 3명 가운데 1번째')).toBeTruthy()
    expect(paperTexts()).toContain('가을여행 님')
    fireEvent.click(screen.getByRole('button', { name: '문자 보내기' }))
    // 보내면 바로 둘째 손님
    expect(await screen.findByText('모두에게 보내기 · 3명 가운데 2번째')).toBeTruthy()
    expect(paperTexts()).toContain('나오미다육 님')
    expect(compose).toHaveBeenCalledTimes(1)
    // 둘째는 건너뛴다 → 셋째(마지막)
    fireEvent.click(screen.getByRole('button', { name: '건너뛰기' }))
    expect(await screen.findByText('모두에게 보내기 · 3명 가운데 3번째')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '문자 보내기' }))
    // 마지막까지 보내면 표로 돌아와 결과를 알린다
    expect(await screen.findByText('모두에게 보내기를 마쳤어요. 구매자 3명 가운데 2명에게 보냈어요.')).toBeTruthy()
    expect(compose).toHaveBeenCalledTimes(2)
    // 보낸 손님 표시 — 표의 줄 이름과 보내기 판
    expect(screen.getByRole('button', { name: /^가을여행 정산서 · 30,000원 · 1개 · 보냄$/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^나오미다육 정산서 · 30,000원 · 1개$/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '모두에게 보내기' }))
    const again = await screen.findByRole('dialog', { name: '모두에게 정산서 보내기' })
    expect(within(again).getAllByRole('listitem').map(row => row.getAttribute('aria-label'))).toEqual(['가을여행 보냄', '나오미다육 아직', '미자네 보냄'])
    // 이어서 보내면 아직 보내지 않은 손님부터
    fireEvent.click(within(again).getByRole('button', { name: '이어서 보내기' }))
    expect(await screen.findByText('모두에게 보내기 · 3명 가운데 2번째')).toBeTruthy()
    expect(paperTexts()).toContain('나오미다육 님')
  })

  it('상품별 표에는 모두에게 보내기가 없다', async () => {
    const { world } = salesWorld(FULL)
    render(world.wrap(<ConsoleScreen broadcastId="b1" seller onBack={() => {}} />))
    await screen.findByRole('button', { name: '모두에게 보내기' })
    fireEvent.click(screen.getByRole('button', { name: '상품별' }))
    expect(screen.queryByRole('button', { name: '모두에게 보내기' })).toBeNull()
    expect(screen.getByRole('button', { name: '내보내기' })).toBeTruthy()
  })
})
