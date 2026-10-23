// PL1B 포장 모드의 "포장 라벨 출력" (SPEC STL-08·LBL-02, RCP-01·L-13 9, D-PL1-05, AC-PL1B-10~13):
// 라벨 켜짐이면 "라벨 PDF" 옆 보통 버튼, 누를 때만 정산 자세히와 같은 요청 하나(누를 때마다 새 요청 번호), 성공 문장·서버 거절 문장,
// 라벨 꺼짐이면 칸 전체가 "라벨 쓰지 않음" 안내(그림 요청 없음) — 다른 기기에서 켜면 돌아온다, 켬/끔을 모르면 출력 버튼 없음, 품목 없는 묶음엔 없음.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import type { PrintOverview } from '../src/api/print-types.ts'
import type { PackingEntry } from '../src/api/types.ts'
import { NO_LABEL_ITEMS, PackingPage } from '../src/components/PackingPage.tsx'
import { PrintProvider } from '../src/components/print-context.tsx'
import type { Route } from '../src/lib/router.ts'
import { chat, register } from './engine.ts'
import { EngineServer } from './engine-server.ts'
import { job, overview, queue, templates } from './print-support.ts'
import { DATE, FakeEventSource, apiError, flush, type Reply } from './support.ts'

const OFF_NOTE = '라벨 쓰지 않음 — 설정에서 켤 수 있어요.'
const PRINT = '포장 라벨 출력'

const EVENTS = [register(15, '핑크프릴', 10000), register(28, '청보석', 5000), chat('m1', 'c1', '가나', '15'), chat('m2', 'c1', '가나', '28')]

const item = (no: number, name: string, price: number) => ({ key: `b1/${String(no)}`, broadcast: 'b1', title: '1부', no, name, price })

function entries(packed: boolean): PackingEntry[] {
  return [
    { buyer: 'c1', name: '가나', phoneLast4: null, payment: 'UNPAID', items: [item(15, '핑크프릴', 10000), item(28, '청보석', 5000)], status: packed ? '포장 완료' : '포장 대기', invoice: null, add: [], remove: [] },
    // 품목이 모두 빠진 포장 완료 묶음 (AC-PL1B-13)
    { buyer: 'c9', name: '빈묶음', phoneLast4: null, payment: 'PAID', items: [], status: '포장 다시 확인', invoice: null, add: [], remove: [{ key: 'b1/41', broadcast: 'b1', title: '1부', no: 41 }] },
  ]
}

let engine: EngineServer
let current: PrintOverview
let packed: boolean
let printReply: (body: Record<string, unknown>) => Reply | Promise<Reply>

beforeEach(() => {
  window.sessionStorage.clear()
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
  engine = new EngineServer(EVENTS)
  current = overview()
  packed = false
  printReply = () => ({ body: { jobs: [job('j1', { kind: 'packing' }), job('j2', { kind: 'packing' })] } })
  engine.server
    .on('GET', new RegExp(`^/api/days/${DATE}/packing$`), () => ({ body: { date: DATE, seq: engine.seq, entries: entries(packed) } }))
    .on('POST', new RegExp(`^/api/days/${DATE}/packing$`), () => {
      packed = true
      return { body: { date: DATE, entry: entries(true)[0], recorded: true } }
    })
    .on('GET', new RegExp(`^/api/days/${DATE}/packing-label\\?`), () => ({ body: { date: DATE, buyer: 'c1', data: {}, pages: 1 } }))
    .on('GET', new RegExp(`^/api/days/${DATE}/packing-label\\.png\\?`), () => ({ body: {} }))
    .on('GET', /^\/api\/print$/, () => ({ body: current }))
    .on('GET', /^\/api\/print\/templates$/, () => ({ body: templates() }))
    .on('GET', /^\/api\/print\/labels\?/, () => ({ body: { date: DATE, labels: [] } }))
    .on('POST', /^\/api\/print\/packing$/, (call) => printReply(call.body ?? {}))
  vi.stubGlobal('fetch', engine.server.fetch)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
  vi.useRealTimers()
})

function Harness({ initial }: { readonly initial: Route }) {
  const [route, setRoute] = useState<Route>(initial)
  return route.name === 'packing' ? <PackingPage route={route} navigate={setRoute} /> : null
}

async function openPacking(buyer = 'c1'): Promise<void> {
  render(
    <PrintProvider>
      <Harness initial={{ name: 'packing', date: DATE, buyer }} />
    </PrintProvider>,
  )
  await flush(20)
}

const region = () => screen.getByRole('region', { name: '포장 라벨' })
const checklist = () => screen.getByRole('region', { name: '체크리스트' })
const printCalls = () => engine.server.callsTo('POST', /^\/api\/print\/packing$/)
const pictureCalls = () => engine.server.callsTo('GET', /\/packing-label(\.png)?\?/).length

describe('포장 라벨 출력 버튼 (AC-PL1B-10)', () => {
  it('"라벨 PDF"와 같은 줄의 보통 버튼 — 누르면 요청 하나, 보내는 동안 잠김, 성공하면 "포장 라벨 2장 출력을 접수했어요."', async () => {
    let release: (reply: Reply) => void = () => {}
    printReply = () => new Promise<Reply>((resolve) => (release = resolve))
    await openPacking()
    const button = within(region()).getByRole('button', { name: PRINT }) as HTMLButtonElement
    expect(button.className).toBe('button')
    expect(button.parentElement).toBe(within(region()).getByRole('button', { name: '라벨 PDF' }).parentElement)
    // 주 버튼은 체크리스트의 포장 완료 그대로
    expect(within(checklist()).getByRole('button', { name: '포장 완료' }).className).toContain('button-primary')
    fireEvent.click(button)
    await flush(5)
    expect(button.disabled).toBe(true)
    expect(printCalls()).toHaveLength(1)
    expect(printCalls()[0]?.body).toEqual({ requestId: expect.any(String) as string, date: DATE, buyer: 'c1' })
    release({ body: { jobs: [job('j1', { kind: 'packing' }), job('j2', { kind: 'packing' })] } })
    const done = await within(region()).findByText('포장 라벨 2장 출력을 접수했어요.')
    expect(done.getAttribute('role')).toBe('status')
    expect(button.disabled).toBe(false)
  })

  it('서버 거절은 서버 문장 그대로 — 다시 누를 수 있다', async () => {
    printReply = () => apiError(409, 'PRINT_REHEARSAL', '리허설 방송은 라벨을 출력하지 않아요.')
    await openPacking()
    fireEvent.click(within(region()).getByRole('button', { name: PRINT }))
    expect(await within(region()).findByText('리허설 방송은 라벨을 출력하지 않아요.')).toBeTruthy()
    expect(within(region()).queryByText(/출력을 접수했어요/)).toBeNull()
    expect((within(region()).getByRole('button', { name: PRINT }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('라벨이 꺼졌다는 거절(LABELS_OFF)이면 칸 전체가 꺼짐 안내와 서버 문장으로 바뀐다 — 저절로 다시 보내지 않는다', async () => {
    printReply = () => {
      // 다른 기기에서 막 끈 참 — 서버의 대기열 요약도 꺼짐
      current = overview({ queue: queue({ rev: 2, labelsEnabled: false }) })
      return apiError(409, 'LABELS_OFF', '라벨 기능이 꺼져 있어요. 설정에서 켠 뒤 다시 해 주세요.')
    }
    await openPacking()
    fireEvent.click(within(region()).getByRole('button', { name: PRINT }))
    expect(await within(region()).findByText('라벨 기능이 꺼져 있어요. 설정에서 켠 뒤 다시 해 주세요.')).toBeTruthy()
    expect(within(region()).getByText(OFF_NOTE)).toBeTruthy()
    expect(within(region()).queryAllByRole('button')).toHaveLength(0)
    await flush(10)
    expect(printCalls()).toHaveLength(1)
  })
})

describe('누를 때만, 누를 때마다 (AC-PL1B-11)', () => {
  it('모두 체크하고 "포장 완료"를 눌러도 출력 요청이 없다 — 두 번 누르면 요청 두 번, 서로 다른 요청 번호', async () => {
    await openPacking()
    fireEvent.click(within(checklist()).getByRole('checkbox', { name: '15번 핑크프릴' }))
    fireEvent.click(within(checklist()).getByRole('checkbox', { name: '28번 청보석' }))
    fireEvent.click(within(checklist()).getByRole('button', { name: '포장 완료' }))
    await flush(20)
    expect(engine.server.callsTo('POST', new RegExp(`^/api/days/${DATE}/packing$`))).toHaveLength(1)
    expect(printCalls()).toHaveLength(0)
    fireEvent.click(within(region()).getByRole('button', { name: PRINT }))
    await within(region()).findByText('포장 라벨 2장 출력을 접수했어요.')
    fireEvent.click(within(region()).getByRole('button', { name: PRINT }))
    await waitFor(() => expect(printCalls()).toHaveLength(2))
    const ids = printCalls().map((call) => call.body?.requestId)
    expect(new Set(ids).size).toBe(2)
  })

  it('포장 라벨 그림을 받는 중에도 누를 수 있고, 보내는 것은 날짜·구매자뿐이다(그림을 보내지 않는다)', async () => {
    engine.server.on('GET', new RegExp(`^/api/days/${DATE}/packing-label\\.png\\?`), () => new Promise<Reply>(() => {}))
    await openPacking()
    expect(within(region()).getByText('포장 라벨을 만드는 중이에요…')).toBeTruthy()
    expect((within(region()).getByRole('button', { name: '라벨 PDF' }) as HTMLButtonElement).disabled).toBe(true)
    const button = within(region()).getByRole('button', { name: PRINT }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    await waitFor(() => expect(printCalls()).toHaveLength(1))
    expect(Object.keys(printCalls()[0]?.body ?? {}).sort()).toEqual(['buyer', 'date', 'requestId'])
  })
})

describe('라벨이 꺼져 있거나 모를 때 (AC-PL1B-12)', () => {
  it('꺼짐: 칸 전체가 안내 — 미리 보기·그림 저장·라벨 PDF·포장 라벨 출력이 없고 그림 요청도 없다, 체크리스트·포장 완료는 그대로', async () => {
    current = overview({ queue: queue({ labelsEnabled: false }) })
    await openPacking()
    expect(within(region()).getByText(OFF_NOTE)).toBeTruthy()
    expect(within(region()).queryAllByRole('button')).toHaveLength(0)
    expect(within(region()).queryAllByRole('img')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: PRINT })).toBeNull()
    expect(pictureCalls()).toBe(0)
    expect(within(checklist()).getByRole('button', { name: '포장 완료' })).toBeTruthy()
  })

  it('다른 기기에서 켜면(라벨 켬 알림) 1초 안에 칸이 돌아오고 그림을 받는다', async () => {
    current = overview({ queue: queue({ labelsEnabled: false }) })
    await openPacking()
    expect(within(region()).getByText(OFF_NOTE)).toBeTruthy()
    const started = Date.now()
    act(() => {
      for (const source of FakeEventSource.instances) source.emit('labels', { rev: 2, enabled: true, entry: { enabled: true, at: '2026-10-20T11:31:00.000Z', loginId: 'shop1' } })
    })
    await waitFor(() => expect(within(region()).getByRole('button', { name: PRINT })).toBeTruthy(), { timeout: 1000 })
    expect(Date.now() - started).toBeLessThan(1000)
    expect(within(region()).queryByText(OFF_NOTE)).toBeNull()
    await waitFor(() => expect(pictureCalls()).toBeGreaterThan(0))
  })

  it('켬/끔을 모르는 동안(불러오는 중) "포장 라벨 출력"이 없다 — 라벨 PDF·체크리스트는 그대로', async () => {
    engine.server.on('GET', /^\/api\/print$/, () => new Promise<Reply>(() => {}))
    await openPacking()
    expect(within(region()).queryByRole('button', { name: PRINT })).toBeNull()
    expect(within(region()).getByRole('button', { name: '라벨 PDF' })).toBeTruthy()
    expect(within(checklist()).getByRole('button', { name: '포장 완료' })).toBeTruthy()
  })

  it('켬/끔을 불러오지 못해도 "포장 라벨 출력"이 없다', async () => {
    engine.server.on('GET', /^\/api\/print$/, () => apiError(500, 'INTERNAL_ERROR', '서버에 문제가 생겼어요.'))
    await openPacking()
    expect(within(region()).queryByRole('button', { name: PRINT })).toBeNull()
  })
})

describe('품목 없는 묶음 (AC-PL1B-13)', () => {
  it('"담을 상품이 없어 포장 라벨을 만들 수 없어요."만 — 출력 버튼 없음', async () => {
    await openPacking('c9')
    expect(within(region()).getByText(NO_LABEL_ITEMS)).toBeTruthy()
    expect(within(region()).queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: PRINT })).toBeNull()
  })
})
