// 30일 봉인 예고·봉인한 날짜 (AC-I3-40·41): 정산·구매자·방송 목록·문자찜 입력. 실제 코어로 도는 가짜 서버.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import { BuyersPage } from '../src/components/BuyersPage.tsx'
import { HomePage } from '../src/components/HomePage.tsx'
import { SettlementsPage } from '../src/components/SettlementsPage.tsx'
import { SmsPage } from '../src/components/SmsPage.tsx'
import type { Route } from '../src/lib/router.ts'
import { chat, register } from './engine.ts'
import { EngineServer } from './engine-server.ts'
import { DATE, FakeEventSource, broadcastItem, flush } from './support.ts'

let engine: EngineServer

const EVENTS = [register(15, '핑크프릴', 10000), chat('m1', 'c1', '가나', '15')]
const SOON = Date.now() + 3 * 86_400_000
const LATER = Date.now() + 20 * 86_400_000

function days(day: { sealAt: string | null; sealed: boolean }) {
  engine.server.on('GET', /^\/api\/days(\?rehearsal=true)?$/, (_call, match) => ({
    body: { days: match[1] === undefined ? [{ date: DATE, rehearsal: false, seq: engine.seq, ...day }] : [] },
  }))
}

function sealView() {
  const real = engine.server
  real.on('GET', new RegExp(`^/api/days/${DATE}$`), async (call, match) => {
    void match
    const response = await new EngineServer(EVENTS).server.fetch(call.path)
    const view = (await response.json()) as Record<string, unknown>
    return { body: { ...view, sealed: true, sealedAt: '2026-11-19T15:00:00.000Z' } }
  })
}

function Harness({ initial }: { readonly initial: Route }) {
  const [route, setRoute] = useState<Route>(initial)
  if (route.name === 'settlements') return <SettlementsPage route={route} navigate={setRoute} />
  if (route.name === 'buyers') return <BuyersPage route={route} navigate={setRoute} />
  return null
}

beforeEach(() => {
  engine = new EngineServer(EVENTS)
  vi.stubGlobal('fetch', engine.server.fetch)
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
})

describe('봉인 예고 (AC-I3-40)', () => {
  it('정산·구매자: 봉인 예정 시각(KST)을 늘 보이고, 7일 전부터 경고 상자', async () => {
    days({ sealAt: new Date(LATER).toISOString(), sealed: false })
    render(<Harness initial={{ name: 'settlements', date: DATE, rehearsal: false }} />)
    await flush(10)
    expect(screen.getByText(/^이 날짜 기록은 \d+월 \d+일 \d+시( \d+분)?에 봉인돼요$/)).toBeDefined()
    expect(screen.queryByText(/그 전에 정산을 마쳐 주세요/)).toBeNull()
    cleanup()
    days({ sealAt: new Date(SOON).toISOString(), sealed: false })
    render(<Harness initial={{ name: 'buyers', date: DATE, rehearsal: false }} />)
    await flush(10)
    expect(screen.getByText(/이 날짜 기록은 .*봉인돼요/)).toBeDefined()
    expect(screen.getByRole('note').textContent).toBe('30일이 지나면 채팅 내용을 지우고 기록을 봉인해요. 그 뒤로는 입금·배송비 같은 기록을 고칠 수 없어요. 그 전에 정산을 마쳐 주세요.')
  })

  it('봉인 예정 시각이 없으면(리허설·유튜브 채팅 없는 날짜) 아무것도 없다', async () => {
    days({ sealAt: null, sealed: false })
    render(<Harness initial={{ name: 'settlements', date: DATE, rehearsal: false }} />)
    await flush(10)
    expect(screen.queryByText(/봉인/)).toBeNull()
  })

  it('방송 목록: 그 날짜의 실제 방송 줄에', async () => {
    days({ sealAt: new Date(SOON).toISOString(), sealed: false })
    engine.server.on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [broadcastItem({ id: 'b1' }), broadcastItem({ id: 'r1', rehearsal: true, title: '리허설' })] } }))
    render(<HomePage navigate={() => {}} />)
    await flush(10)
    const items = within(screen.getByRole('list', { name: '방송' })).getAllByRole('listitem')
    const real = items.find((item) => item.textContent?.includes('1부')) as HTMLElement
    const rehearsal = items.find((item) => item.textContent?.includes('리허설')) as HTMLElement
    expect(real.textContent).toMatch(/이 날짜 기록은 .*봉인돼요/)
    expect(real.textContent).toContain('그 전에 정산을 마쳐 주세요.')
    expect(rehearsal.textContent).not.toContain('봉인')
  })
})

describe('봉인한 날짜 (AC-I3-41)', () => {
  it('정산: 안내, 입금·배송비·할인·환불 버튼이 잠기고 눌러도 아무것도 보내지 않는다', async () => {
    days({ sealAt: '2026-11-19T15:00:00.000Z', sealed: true })
    sealView()
    render(<Harness initial={{ name: 'settlements', date: DATE, rehearsal: false, buyer: 'c1' }} />)
    await flush(10)
    expect(screen.getAllByText('30일이 지나 봉인한 날짜예요. 볼 수만 있어요.').length).toBeGreaterThan(0)
    const group = screen.getByRole('group', { name: '정산 입력' })
    for (const button of within(group).getAllByRole('button')) expect(button.matches(':disabled')).toBe(true)
    // (브라우저는 잠긴 버튼의 누름을 보내지 않는다 — jsdom은 보내므로) 창이 열려도 창 안의 칸·버튼이 잠겨 아무것도 보내지 않는다
    fireEvent.click(within(group).getByRole('button', { name: '입금 적기' }))
    const dialog = screen.getByRole('dialog')
    const enabled = within(dialog)
      .getAllByRole('button')
      .filter((button) => !button.matches(':disabled'))
      .map((button) => button.textContent)
    expect(enabled).toEqual(['닫기'])
    expect(engine.server.callsTo('POST', /events/)).toHaveLength(0)
  })

  it('구매자: 합치기·차단이 잠긴다', async () => {
    days({ sealAt: '2026-11-19T15:00:00.000Z', sealed: true })
    sealView()
    render(<Harness initial={{ name: 'buyers', date: DATE, rehearsal: false, buyer: 'c1' }} />)
    await flush(10)
    const detail = screen.getByRole('region', { name: '구매자 자세히' })
    expect(within(detail).getByRole('button', { name: '다른 구매자와 합치기' }).matches(':disabled')).toBe(true)
    expect(within(detail).getByRole('button', { name: '차단하기' }).matches(':disabled')).toBe(true)
    expect(within(detail).getByRole('button', { name: '구매자 목록으로' }).matches(':disabled')).toBe(false)
  })

  it('문자찜 입력: 봉인한 날짜의 방송은 고를 수 없고 기본으로도 고르지 않는다, 보조자는 리허설 방송도 고르지 않는다', async () => {
    const SEALED = '2026-09-01'
    engine.server.on('GET', /^\/api\/broadcasts$/, () => ({
      body: { broadcasts: [broadcastItem({ id: 'old', date: SEALED, title: '지난 방송' }), broadcastItem({ id: 'r1', rehearsal: true, title: '리허설' })] },
    }))
    engine.server.on('GET', /^\/api\/days$/, () => ({ body: { days: [{ date: SEALED, rehearsal: false, seq: 3, sealAt: '2026-10-01T15:00:00.000Z', sealed: true }] } }))
    render(<SmsPage navigate={() => {}} />)
    await flush(10)
    expect(screen.getByText('문자찜을 넣을 방송을 골라 주세요.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '방송 고르기' }))
    let dialog = screen.getByRole('dialog', { name: '방송 고르기' })
    await flush()
    expect(within(dialog).queryByText(/지난 방송/)).toBeNull()
    expect(within(dialog).getByText(/리허설/, { selector: 'strong' })).toBeDefined()
    cleanup()
    render(<SmsPage navigate={() => {}} assistant />)
    await flush(10)
    fireEvent.click(screen.getByRole('button', { name: '방송 고르기' }))
    dialog = screen.getByRole('dialog', { name: '방송 고르기' })
    await flush()
    expect(within(dialog).getByText('문자찜을 넣을 방송이 없어요. 판매자가 방송을 시작하면 고를 수 있어요.')).toBeDefined()
    expect(within(dialog).queryByRole('button', { name: '방송 목록으로' })).toBeNull()
  })
})
