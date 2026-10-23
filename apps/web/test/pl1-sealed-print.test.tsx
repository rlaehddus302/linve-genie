// PL1 합침 (AC-PL1A-19·AC-PL1B-14, D-PL1-04·D-PL1-10): 봉인 날짜(포장 목록 응답 `sealed: true`)의 포장 모드에는
// "포장 라벨 출력"과 그 결과·안내(출력 기기 없음·라벨 화면 링크)가 없다 — 그림 저장·라벨 PDF는 그대로. 봉인 안 한 날짜는 버튼 1개.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onUnauthorized } from '../src/api/client.ts'
import type { PrintOverview } from '../src/api/print-types.ts'
import type { PackingEntry } from '../src/api/types.ts'
import { PackingPage, SEALED_VIEW_ONLY } from '../src/components/PackingPage.tsx'
import { LABELS_SCREEN_LINK, NO_PRINT_DEVICE_WAITING, PACKING_PRINT_LABEL } from '../src/components/PackingPrint.tsx'
import { PrintProvider } from '../src/components/print-context.tsx'
import type { Route } from '../src/lib/router.ts'
import { chat, register } from './engine.ts'
import { EngineServer } from './engine-server.ts'
import { job, overview, queue, templates } from './print-support.ts'
import { DATE, FakeEventSource, flush, fullText } from './support.ts'

const OFF_NOTE = '라벨 쓰지 않음 — 설정에서 켤 수 있어요.'
const EVENTS = [register(15, '핑크프릴', 10000), chat('m1', 'c1', '가나', '15')]
const ENTRIES: PackingEntry[] = [
  { buyer: 'c1', name: '가나', phoneLast4: null, payment: 'PAID', items: [{ key: 'b1/15', broadcast: 'b1', title: '1부', no: 15, name: '핑크프릴', price: 10000 }], status: '포장 완료', invoice: null, add: [], remove: [] },
]

let engine: EngineServer
let current: PrintOverview

function Harness({ initial }: { readonly initial: Route }) {
  const [route, setRoute] = useState<Route>(initial)
  return route.name === 'packing' ? <PackingPage route={route} navigate={setRoute} /> : null
}

async function open(sealed: boolean): Promise<void> {
  engine = new EngineServer(EVENTS)
  engine.server
    .on('GET', new RegExp(`^/api/days/${DATE}/packing$`), () => ({ body: { date: DATE, seq: engine.seq, entries: ENTRIES, ...(sealed ? { sealed: true } : {}) } }))
    .on('GET', new RegExp(`^/api/days/${DATE}/packing-label\\?`), () => ({ body: { date: DATE, buyer: 'c1', data: {}, pages: 1 } }))
    .on('GET', new RegExp(`^/api/days/${DATE}/packing-label\\.png\\?`), () => ({ body: {} }))
    .on('GET', new RegExp(`^/api/days/${DATE}/packing-label\\.pdf\\?`), () => ({ body: {} }))
    .on('GET', /^\/api\/print$/, () => ({ body: current }))
    .on('GET', /^\/api\/print\/templates$/, () => ({ body: templates() }))
    .on('GET', /^\/api\/print\/labels\?/, () => ({ body: { date: DATE, labels: [] } }))
    .on('POST', /^\/api\/print\/packing$/, () => ({ body: { jobs: [job('j1', { kind: 'packing' })] } }))
  vi.stubGlobal('fetch', engine.server.fetch)
  render(
    <PrintProvider>
      <Harness initial={{ name: 'packing', date: DATE, buyer: 'c1' }} />
    </PrintProvider>,
  )
  await flush(20)
}

const region = () => screen.getByRole('region', { name: '포장 라벨' })

beforeEach(() => {
  window.sessionStorage.clear()
  vi.stubGlobal('EventSource', FakeEventSource)
  FakeEventSource.reset()
  // 출력 기기 없음 — 봉인 전이라면 누른 뒤 "출력 기기가 아직 없어…" 안내가 나오는 상태
  current = overview()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
})

describe('봉인 날짜에서 포장 라벨 출력 숨김 (AC-PL1A-19·AC-PL1B-14)', () => {
  it('봉인 날짜(라벨 켜짐): "포장 라벨 출력" 0개, 출력 기기 없음 안내·라벨 화면 링크 없음 — 그림 저장·라벨 PDF는 된다', async () => {
    await open(true)
    expect(screen.getByText(SEALED_VIEW_ONLY)).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: PACKING_PRINT_LABEL })).toHaveLength(0)
    expect(screen.queryByText(NO_PRINT_DEVICE_WAITING)).toBeNull()
    expect(screen.queryByRole('link', { name: LABELS_SCREEN_LINK })).toBeNull()
    expect((within(region()).getByRole('button', { name: '그림 저장' }) as HTMLButtonElement).disabled).toBe(false)
    const pdf = within(region()).getByRole('button', { name: '라벨 PDF' }) as HTMLButtonElement
    expect(pdf.disabled).toBe(false)
    fireEvent.click(pdf)
    await flush(5)
    expect(engine.server.callsTo('GET', /\/packing-label\.pdf\?/)).toHaveLength(1)
    expect(engine.server.callsTo('POST', /^\/api\/print\/packing$/)).toHaveLength(0)
  })

  it('봉인 안 한 날짜(라벨 켜짐): "포장 라벨 출력" 1개 — 지금 화면 그대로', async () => {
    await open(false)
    expect(screen.queryByText(SEALED_VIEW_ONLY)).toBeNull()
    expect(within(region()).getAllByRole('button', { name: PACKING_PRINT_LABEL })).toHaveLength(1)
    fireEvent.click(within(region()).getByRole('button', { name: PACKING_PRINT_LABEL }))
    expect(await within(region()).findByText('포장 라벨 1장 출력을 접수했어요.')).toBeTruthy()
    expect(within(region()).getByText(NO_PRINT_DEVICE_WAITING)).toBeTruthy()
  })

  it('봉인 날짜 + 라벨 꺼짐: 칸 전체가 꺼짐 안내(봉인 전과 같다), 출력 버튼·그림 요청 없음', async () => {
    current = overview({ queue: queue({ labelsEnabled: false }) })
    await open(true)
    expect(within(region()).getByText(fullText(OFF_NOTE))).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: PACKING_PRINT_LABEL })).toHaveLength(0)
    expect(engine.server.callsTo('GET', /\/packing-label(\.png)?\?/)).toHaveLength(0)
  })
})
