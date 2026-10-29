// 라벨·프린터 화면 (APP-03): 끊김 → 블루투스로 연결 → 연결됨 낱말, 이 기기에서 출력 → 서버 등록, 대기열 요약·출력 멈추기, 테스트 인쇄.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LabelsScreen } from '../src/screens/LabelsScreen.tsx'
import { makeWorld } from './screen-support.tsx'
import { flush } from './support.ts'

describe('LabelsScreen', () => {
  it('프린터를 연결하고 이 기기에서 출력을 누르면 서버에 기기를 등록한다', async () => {
    const world = makeWorld()
    let device: { id: string; name: string; live: boolean; printerConnected: boolean; releasing: boolean } | null = null
    world.server.on('GET', /^\/api\/print$/, () => ({ body: { queue: { rev: 2, device, pause: null, waiting: 3, printing: 0, discard: 1, labelsEnabled: true }, jobs: [], discard: [] } }))
    world.server.on('POST', /^\/api\/print\/device$/, (call) => {
      device = { id: String(call.body?.deviceId), name: String(call.body?.name), live: true, printerConnected: true, releasing: false }
      return { body: { queue: {}, waiting: 3, backlog: true } }
    })
    world.server.on('POST', /^\/api\/print\/device\/state$/, () => ({ body: {} }))
    world.server.on('POST', /^\/api\/print\/claim$/, () => ({ body: { job: null, reason: 'EMPTY' } }))
    world.services.labels.start()
    render(world.wrap(<LabelsScreen onBack={() => {}} />))
    await waitFor(() => expect(screen.getByText('출력 기기 없음')).toBeTruthy())
    expect(screen.getByText('끊김')).toBeTruthy()
    expect(screen.queryByText(/DISCONNECTED|CONNECTED/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '블루투스로 연결' }))
    await waitFor(() => expect(screen.getByText('연결됨')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('기기 이름'), { target: { value: '사장님 폰' } })
    fireEvent.click(screen.getByRole('button', { name: '이 기기에서 출력' }))
    await waitFor(() => expect(screen.getByText('이 기기가 출력 기기예요 · 사장님 폰')).toBeTruthy())
    expect(world.server.callsTo('POST', /\/api\/print\/device$/)[0]?.body).toEqual({ deviceId: 'app-test', name: '사장님 폰' })
    expect(screen.getByText('대기 3장 · 출력 중 0장 · 버릴 라벨 1장 · 이 앱에서 찍은 0장')).toBeTruthy()
    expect(screen.getByRole('button', { name: '출력 멈추기' })).toBeTruthy()
    // 테스트 인쇄는 서버를 거치지 않는다
    fireEvent.click(screen.getByRole('button', { name: '테스트 인쇄' }))
    await flush()
    await waitFor(() => expect(world.ble.printed.length).toBe(1))
    expect(screen.getByText('테스트 라벨의 네 변 테두리와 한글이 모두 또렷하게 보이나요?')).toBeTruthy()
    world.services.labels.stop()
  })

  it('다른 기기가 출력 기기면 바꿀지 묻는다', async () => {
    const world = makeWorld()
    world.server.on('GET', /^\/api\/print$/, () => ({ body: { queue: { rev: 2, device: { id: 'pc-1', name: 'PC', live: true, printerConnected: true, releasing: false }, pause: null, waiting: 0, printing: 0, discard: 0, labelsEnabled: true }, jobs: [], discard: [] } }))
    world.server.on('POST', /^\/api\/print\/device$/, (call) => (call.body?.replace === true ? { body: { queue: {}, waiting: 0, backlog: false } } : { status: 409, body: { error: { code: 'PRINT_DEVICE_TAKEN', message: '다른 기기에서 출력 중이에요.' }, device: { name: 'PC' } } }))
    world.server.on('POST', /^\/api\/print\/device\/state$/, () => ({ body: {} }))
    world.services.labels.start()
    render(world.wrap(<LabelsScreen onBack={() => {}} />))
    await waitFor(() => expect(screen.getByText('출력 기기: PC')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '이 기기에서 출력' }))
    const dialog = await screen.findByRole('dialog', { name: '출력 기기 바꾸기' })
    expect(dialog.textContent).toContain("지금은 다른 기기 'PC'에서 출력하고 있어요. 이 기기로 바꿀까요?")
    fireEvent.click(screen.getByRole('button', { name: '이 기기로 바꾸기' }))
    await waitFor(() => expect(world.server.callsTo('POST', /\/api\/print\/device$/).length).toBe(2))
    expect(world.server.callsTo('POST', /\/api\/print\/device$/)[1]?.body).toEqual({ deviceId: 'app-test', name: '내 휴대폰', replace: true })
    world.services.labels.stop()
  })
})
