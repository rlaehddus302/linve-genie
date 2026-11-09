// 앱 방송 일정·알림 (D-APPX-01 — 웹 ScheduleSettings와 같은 문구): 다가오는 방송 적기(바로 저장), 지우기는 한 번 묻기, 알림은 수만, 아직 문자를 보내지 않는다는 한 줄.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ScheduleView } from '@livejjim/web/src/lib/schedule.ts'
import { ScheduleScreen } from '../src/screens/ScheduleScreen.tsx'
import { makeWorld } from './screen-support.tsx'

describe('ScheduleScreen (앱 방송 일정)', () => {
  it('방송을 적으면 바로 저장되고, 지우기는 묻고, 알림 신청은 수만 보인다', async () => {
    const w = makeWorld()
    let view: ScheduleView = { page: { enabled: false, url: null, channelUrl: null }, items: [], max: 10 }
    const sent: { method: string; path: string; body: Record<string, unknown> | null }[] = []
    w.server.on('GET', /^\/api\/schedule$/, () => ({ body: view }))
    w.server.on('GET', /^\/api\/schedule\/alerts$/, () => ({ body: { pending: 2, active: 5, withdrawn: 1 } }))
    w.server.on('POST', /^\/api\/schedule\/items$/, (call) => {
      sent.push(call)
      view = { ...view, items: [{ id: 'i1', date: '2026-11-03', time: '20:00', startsAt: '2026-11-03T11:00:00.000Z', title: String(call.body?.['title']), intro: '' }] }
      return { body: view }
    })
    w.server.on('DELETE', /^\/api\/schedule\/items\/i1$/, (call) => {
      sent.push(call)
      view = { ...view, items: [] }
      return { body: view }
    })
    render(w.wrap(<ScheduleScreen onBack={() => undefined} />))
    expect(await screen.findByText('적어 둔 다가오는 방송이 없어요.')).toBeTruthy()
    // 옛 기대: 한 줄 글 "받는 중 5명". 새 기대(D-UX3-96): 이름 · 오른쪽 값 줄 ("받는 중" | "5명")
    expect(screen.getByTestId('alerts-active').textContent).toBe('받는 중5명')
    expect(screen.getByText('아직 문자를 보내지 않아요. 보내기는 준비 중이에요.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '방송 적기' }))
    fireEvent.change(screen.getByLabelText('날짜'), { target: { value: '2026-11-03' } })
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '화요일 저녁 다육 라이브' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(await screen.findByText('11월 3일(화) 20:00')).toBeTruthy()
    expect(sent[0]!.body).toEqual({ date: '2026-11-03', time: '20:00', title: '화요일 저녁 다육 라이브', intro: '' })
    fireEvent.click(screen.getByRole('button', { name: '11월 3일(화) 20:00 지우기' }))
    expect(sent).toHaveLength(1)
    fireEvent.click(screen.getAllByRole('button', { name: '지우기' }).at(-1)!)
    await waitFor(() => expect(sent.map((call) => call.method)).toEqual(['POST', 'DELETE']))
  })
})
