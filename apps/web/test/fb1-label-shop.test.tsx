// FB1 라벨 가게 이름 (D-FB1-07, AC-FB1-28·29 화면 쪽): 칸은 저장된 본문의 이름(storedShopName)으로 채우고 — 서버가 채운 이름을 칸에 넣지 않는다 —,
// 칸 아래 안내, 가게 이름 항목이 꺼져 있으면 칸 옆 한 줄. 미리 보기는 칸이 비면 서버처럼 설정 "가게"의 가게 이름으로 그린다.
import { defaultTemplate, type ProductTemplate } from '@livejjim/label'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { onUnauthorized } from '../src/api/client.ts'
import type { StoredTemplate, Templates } from '../src/api/print-types.ts'
import { SHOP_ITEM_OFF, SHOP_NAME_HINT, editableTemplate, shopNameFallback } from '../src/components/LabelSettings.tsx'
import { setLabelEnv } from '../src/lib/label-env.ts'
import { jsdomLabelEnv, overview, templates } from './print-support.ts'
import { DATE, FakeEventSource, FakeServer, flush } from './support.ts'

let server: FakeServer
let served: Templates

const filled = (stored: string, shop = '초록다육'): StoredTemplate<ProductTemplate> => ({
  template: { ...defaultTemplate('product'), shopName: stored.trim() === '' ? shop : stored },
  version: 2,
  storedShopName: stored,
})

beforeEach(() => {
  window.sessionStorage.clear()
  server = new FakeServer()
  served = { ...templates(), product: filled('') }
  server
    .on('GET', /^\/api\/me$/, () => ({ body: { seller: { name: '초록다육' }, loginId: 'shop1' } }))
    .on('GET', /^\/api\/client-config$/, () => ({ body: { hostActionDelayMs: 5000, testPrinter: false } }))
    .on('GET', /^\/api\/print$/, () => ({ body: overview() }))
    .on('GET', /^\/api\/print\/templates$/, () => ({ body: served }))
    .on('PUT', /^\/api\/print\/templates\/product$/, (call) => {
      const body = call.body as { template: ProductTemplate }
      const next = filled(body.template.shopName)
      served = { ...served, product: { ...next, template: { ...body.template, shopName: next.template.shopName }, version: 3 } }
      return { body: { template: served.product.template, version: 3, message: '라벨 설정을 저장했어요.', storedShopName: body.template.shopName } }
    })
    .on('GET', /^\/api\/print\/labels\?/, () => ({ body: { date: DATE, labels: [] } }))
    .on('GET', /^\/api\/days$/, () => ({ body: { days: [{ date: DATE }] } }))
    .on('GET', /^\/api\/broadcasts$/, () => ({ body: { broadcasts: [] } }))
    .on('GET', /^\/api\/settings$/, () => ({ body: { settings: { 'print.autoOnConfirm': true } } }))
  vi.stubGlobal('fetch', server.fetch)
  vi.stubGlobal('EventSource', FakeEventSource)
  window.history.replaceState(null, '', '/labels')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onUnauthorized(null)
  FakeEventSource.reset()
})

async function openEditor(): Promise<HTMLElement> {
  render(<App />)
  await screen.findByRole('heading', { name: '라벨', level: 1 })
  await flush(10)
  return screen.getByRole('region', { name: '라벨 설정' })
}

describe('lib', () => {
  it('칸에 넣을 템플릿은 저장된 이름, 대신 찍을 이름은 저장된 이름이 빈 쪽의 서버 이름', () => {
    expect(editableTemplate(filled('')).shopName).toBe('')
    expect(editableTemplate(filled('   ')).shopName).toBe('   ')
    expect(editableTemplate(filled('다육상회')).shopName).toBe('다육상회')
    // 옛 서버(storedShopName 없음)는 내준 이름 그대로
    expect(editableTemplate({ template: { ...defaultTemplate('product'), shopName: '옛이름' }, version: 1 }).shopName).toBe('옛이름')
    expect(shopNameFallback([filled('다육상회'), filled('  ')])).toBe('초록다육')
    expect(shopNameFallback([filled('다육상회'), null])).toBe('')
  })
})

describe('라벨 설정 가게 이름 칸 (AC-FB1-28)', () => {
  it('저장한 적 없으면 칸은 비어 있고(서버가 채운 이름이 칸에 들어가지 않는다) 칸 아래 안내, 그대로 저장하면 빈 이름을 보낸다', async () => {
    const editor = await openEditor()
    const field = within(editor).getByLabelText('가게 이름') as HTMLInputElement
    expect(field.value).toBe('')
    expect(within(editor).getByText(SHOP_NAME_HINT)).toBeDefined()
    expect(SHOP_NAME_HINT).toBe("라벨 맨 위에 찍히는 이름이에요. 비워 두면 설정 '가게'의 가게 이름이 찍혀요. 찍지 않으려면 아래 '가게 이름' 항목을 꺼 주세요.")
    expect(within(editor).queryByText(SHOP_ITEM_OFF)).toBeNull()
  })

  it('이름을 적어 저장하면 저장된 이름이 칸에 남고, 비워 저장하면 다시 빈 칸 (설정의 가게 이름이 굳지 않는다)', async () => {
    setLabelEnv(jsdomLabelEnv())
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    onTestFinished(() => {
      setLabelEnv(null)
      getContext.mockRestore()
    })
    const editor = await openEditor()
    const field = () => within(editor).getByLabelText('가게 이름') as HTMLInputElement
    fireEvent.change(field(), { target: { value: '다육상회' } })
    const save = within(editor).getAllByRole('button', { name: '라벨 설정 저장' })[0] as HTMLButtonElement
    fireEvent.click(save)
    await waitFor(() => expect(server.callsTo('PUT', /^\/api\/print\/templates\/product$/)).toHaveLength(1))
    expect((server.callsTo('PUT', /templates\/product$/)[0]?.body as { template: ProductTemplate }).template.shopName).toBe('다육상회')
    await waitFor(() => expect(field().value).toBe('다육상회'))
    fireEvent.change(field(), { target: { value: '' } })
    fireEvent.click(within(editor).getAllByRole('button', { name: '라벨 설정 저장' })[0] as HTMLButtonElement)
    await waitFor(() => expect(server.callsTo('PUT', /templates\/product$/)).toHaveLength(2))
    expect((server.callsTo('PUT', /templates\/product$/)[1]?.body as { template: ProductTemplate }).template.shopName).toBe('')
    await flush(5)
    expect(field().value).toBe('')
  })

  it('가게 이름 항목이 꺼져 있으면 칸 옆 "가게 이름 항목이 꺼져 있어 라벨에 찍히지 않아요." — 켜면 사라진다', async () => {
    const base = defaultTemplate('product')
    served = { ...served, product: { ...filled(''), template: { ...base, shopName: '초록다육', items: { ...base.items, shop: { ...base.items.shop, visible: false } } } } }
    const editor = await openEditor()
    expect(within(editor).getByText(SHOP_ITEM_OFF)).toBeDefined()
    fireEvent.click(within(editor).getByRole('checkbox', { name: /^가게 이름/ }))
    expect(within(editor).queryByText(SHOP_ITEM_OFF)).toBeNull()
  })
})
