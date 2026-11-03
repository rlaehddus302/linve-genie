// 방송 시작 라벨 단계 (D-UX3-19, 사용자 지시 2026-11-03 "링크 붙여넣은 다음에 라벨 프린트 할건지 물어보고 한다 하면 프린터 연결 도와주고
// 연결 확인하고 라벨 디자인 커스텀 한 다음에 테스트 출력한다음에 본방송으로"): 묻기 → 연결·확인 → 꾸미기(서버 초안 미리 보기) → 테스트 "예" → 출력 기기 → 방송.
import { B1_PROFILE } from '@livejjim/printer'
import { defaultTemplate, type ProductTemplate } from '@livejjim/label'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LabelSetupScreen } from '../src/screens/LabelSetupScreen.tsx'
import { makeWorld } from './screen-support.tsx'
import { flush } from './support.ts'

const PNG = 'iVBORw0KGgo='

function labelWorld(labelsEnabled = true) {
  const world = makeWorld()
  world.ble.profile = B1_PROFILE
  const queue = { rev: 1, device: null, pause: null, waiting: 0, printing: 0, discard: 0, labelsEnabled, labelSizes: ['50x30', '50x20', '50x40'] }
  world.server.on('GET', /^\/api\/print$/, () => ({ body: { queue, jobs: [], discard: [] } }))
  world.server.on('PUT', /^\/api\/settings\/labels$/, () => ({ body: { enabled: true } }))
  world.server.on('GET', /^\/api\/print\/templates$/, () => ({ body: { product: { template: { ...defaultTemplate('product'), shopName: '초록다육' }, version: 2, storedShopName: '' }, packing: { template: defaultTemplate('packing'), version: 0, storedShopName: '' } } }))
  world.server.on('POST', /^\/api\/print\/templates\/product\/preview$/, (call) => {
    const body = call.body as { template: ProductTemplate; resize?: '50x40' }
    const template = body.resize === undefined ? body.template : { ...defaultTemplate('product', body.resize), shopName: body.template.shopName, priceStyle: body.template.priceStyle }
    return { body: { template, width: 400, height: 240, png: PNG, longest: null } }
  })
  world.server.on('PUT', /^\/api\/print\/templates\/product$/, () => ({ body: { version: 3 } }))
  world.server.on('POST', /^\/api\/print\/device\/state$/, () => ({ body: {} }))
  world.server.on('POST', /^\/api\/print\/device$/, () => ({ body: { queue: {}, waiting: 0, backlog: false } }))
  world.server.on('GET', /^\/api\/print\/test-bitmap\?size=50x30$/, () => ({ body: { width: 8, height: 2, data: '/4E=' } }))
  world.services.labels.start()
  return world
}

describe('D-UX3-19 방송 시작 라벨 단계', () => {
  it('[안 뽑아요]: 라벨 기능을 끄고 바로 방송으로', async () => {
    const world = labelWorld()
    const onDone = vi.fn()
    render(world.wrap(<LabelSetupScreen onBack={() => {}} onDone={onDone} />))
    const page = screen.getByRole('dialog', { name: '라벨' })
    expect(within(page).getByRole('heading', { name: '라벨을 뽑을까요?' })).toBeTruthy()
    await flush()
    fireEvent.click(within(page).getByRole('button', { name: '안 뽑아요' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(world.server.callsTo('PUT', /^\/api\/settings\/labels$/)[0]?.body).toEqual({ enabled: false })
    world.services.labels.stop()
  })

  it('[네] → 연결 확인 → 꾸미기(크기·가격·항목, 서버 미리 보기) → 저장 → 테스트 "예" → 이 기기를 출력 기기로 → 방송', async () => {
    const world = labelWorld()
    const onDone = vi.fn()
    render(world.wrap(<LabelSetupScreen onBack={() => {}} onDone={onDone} />))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '네, 뽑을게요' }))
    // 이미 켜져 있으면 켬/끔을 건드리지 않는다
    const connect = await screen.findByRole('dialog', { name: '프린터 연결' })
    expect(world.server.callsTo('PUT', /^\/api\/settings\/labels$/)).toHaveLength(0)
    expect(within(connect).queryByRole('button', { name: '다음' })).toBeNull()
    fireEvent.click(within(connect).getByRole('button', { name: '프린터 찾기' }))
    await waitFor(() => expect(within(connect).getByText('연결됐어요')).toBeTruthy())
    expect(within(connect).getByText('NIIMBOT B1')).toBeTruthy()
    expect(within(connect).queryByText(/실험/)).toBeNull()
    fireEvent.click(within(connect).getByRole('button', { name: '다음' }))

    const design = await screen.findByRole('dialog', { name: '라벨 꾸미기' })
    // 가게 이름 칸은 저장된 본문(빈 글) — 비우면 가게 설정 이름을 따른다
    expect((await within(design).findByRole('textbox', { name: '가게 이름' }) as HTMLInputElement).value).toBe('')
    await waitFor(() => expect(world.server.callsTo('POST', /\/preview$/).length).toBeGreaterThan(0))
    expect(within(design).getByLabelText('라벨 미리 보기')).toBeTruthy()
    fireEvent.click(within(design).getByRole('radio', { name: '50×40mm' }))
    await waitFor(() => expect(within(design).getByRole('radio', { name: '50×40mm' }).getAttribute('aria-checked')).toBe('true'))
    expect(world.server.callsTo('POST', /\/preview$/).at(-1)?.body).toMatchObject({ resize: '50x40' })
    fireEvent.click(within(design).getByRole('radio', { name: '8,000원' }))
    fireEvent.click(within(design).getByRole('switch', { name: '날짜 — 켜짐' }))
    fireEvent.click(within(design).getByRole('button', { name: '저장하고 다음' }))
    await waitFor(() => expect(world.server.callsTo('PUT', /^\/api\/print\/templates\/product$/)).toHaveLength(1))
    const saved = world.server.callsTo('PUT', /^\/api\/print\/templates\/product$/)[0]?.body as { template: { size: string; priceStyle: string; items: { date: { visible: boolean } } }; version: number }
    expect(saved.version).toBe(2)
    expect(saved.template).toMatchObject({ size: '50x40', priceStyle: 'WON', items: { date: { visible: false } } })

    const test = await screen.findByRole('dialog', { name: '테스트 인쇄' })
    fireEvent.click(within(test).getByRole('button', { name: '테스트 인쇄' }))
    await within(test).findByText('테스트 라벨의 네 변 테두리와 한글이 모두 또렷하게 보이나요?')
    fireEvent.click(within(test).getByRole('button', { name: '예' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(world.server.callsTo('POST', /\/api\/print\/device$/)[0]?.body).toMatchObject({ name: '내 휴대폰' })
    world.services.labels.stop()
  })

  it('라벨 기능이 꺼져 있으면 [네]가 켠다', async () => {
    const world = labelWorld(false)
    render(world.wrap(<LabelSetupScreen onBack={() => {}} onDone={() => {}} />))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '네, 뽑을게요' }))
    await screen.findByRole('dialog', { name: '프린터 연결' })
    expect(world.server.callsTo('PUT', /^\/api\/settings\/labels$/)[0]?.body).toEqual({ enabled: true })
    world.services.labels.stop()
  })
})
