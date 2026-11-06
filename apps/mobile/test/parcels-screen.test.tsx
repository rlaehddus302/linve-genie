// 앱 택배 접수 (D-APPX-01 — 웹 ParcelsPage와 같은 규칙·문구): 세 무리, 고른 것만 한 번 더 묻고 같은 요청 번호로 접수,
// 결과 요약 문장, 운송장 PDF는 공유 시트로, 접수 취소는 한 번 더 묻는다.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ParcelBrief, ParcelDay, ParcelRow } from '@livejjim/web/src/api/parcel-types.ts'
import { shareFile } from '../src/native/share.ts'
import { setNativeModules } from '../src/native/index.ts'
import { ParcelsScreen } from '../src/screens/ParcelsScreen.tsx'
import { makeWorld } from './screen-support.tsx'

const row = (buyer: string, name: string, patch: Partial<ParcelRow> = {}): ParcelRow => ({
  buyer,
  name,
  phoneLast4: null,
  itemCount: 2,
  qty: 2,
  total: 14_000,
  payment: 'PAID',
  packing: '포장 완료',
  shipping: 'FIXED',
  address: 'CONFIRMED',
  ready: true,
  reason: null,
  message: null,
  box: '60',
  parcel: null,
  ...patch,
})

const booked: ParcelBrief = { state: 'BOOKED', carrier: 'EPOST', carrierName: '우체국택배', invoice: '900000000001', invoiceText: '9000-0000-0001', status: '접수됨', checkedAt: null, trackUrl: null, reason: null, message: null, box: '60', qty: 2, bookedAt: '2026-10-29T13:00:00.000Z', cancellable: true } as ParcelBrief

const day: ParcelDay = {
  date: '2026-10-29',
  seq: 5,
  blocked: null,
  carrier: { code: 'EPOST', name: '우체국택배' } as ParcelDay['carrier'],
  box: '60',
  ready: [row('u1', '다육맘'), row('u2', '초록손')],
  excluded: [row('u3', '선인장', { ready: false, reason: 'NO_ADDRESS', message: '배송지가 없어요', address: 'NONE' })],
  booked: [row('u4', '금황', { packing: '배송 완료', parcel: booked })],
}

function world() {
  const w = makeWorld()
  const posts: { path: string; body: Record<string, unknown> | null }[] = []
  w.server.on('GET', /^\/api\/parcels\/days$/, () => ({ body: { dates: [{ date: '2026-10-29', ready: 2, booked: 1 }], selected: '2026-10-29' } }))
  w.server.on('GET', /^\/api\/parcels\/days\/2026-10-29$/, () => ({ body: day }))
  w.server.on('POST', /^\/api\/parcels\/days\/2026-10-29\/book$/, (call) => {
    posts.push({ path: call.path, body: call.body })
    return { body: { date: '2026-10-29', results: [{ buyer: 'u2', ok: true, invoice: '1', invoiceText: '1' }] } }
  })
  w.server.on('POST', /^\/api\/parcels\/days\/2026-10-29\/cancel$/, (call) => {
    posts.push({ path: call.path, body: call.body })
    return { body: { bundle: {} } }
  })
  w.server.on('GET', /^\/api\/parcels\/days\/2026-10-29\/waybill\.pdf/, () => ({ bytes: new Uint8Array([37, 80, 68, 70]), contentType: 'application/pdf' }))
  w.server.on('GET', /^\/api\/parcels\/days\/2026-10-29\/epost-visit\.xlsx$/, () => ({ bytes: new Uint8Array([80, 75, 3, 4, 0]), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  return { w, posts }
}

afterEach(() => setNativeModules({ shareFile }))

describe('ParcelsScreen (앱 택배 접수)', () => {
  it('세 무리 · 고른 것만 묻고 같은 요청 번호로 한 번 접수 · 결과 요약', async () => {
    const { w, posts } = world()
    render(w.wrap(<ParcelsScreen onBack={() => undefined} />))
    expect(await screen.findByText('보낼 수 있어요 · 2개')).toBeTruthy()
    expect(screen.getByText('아직 못 보내요 · 1개')).toBeTruthy()
    expect(screen.getByText('접수했어요 · 1개')).toBeTruthy()
    expect(screen.getByText('택배사: 우체국택배')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: '다육맘 고르기' }))
    fireEvent.click(screen.getByRole('button', { name: '초록손 택배 크기 80cm 이하' }))
    fireEvent.click(screen.getByRole('button', { name: '1개 택배 접수하기' }))
    expect(screen.getByText('1개를 택배로 접수할까요?')).toBeTruthy()
    expect(posts).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '접수하기' }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]!.body).toMatchObject({ items: [{ buyer: 'u2', box: '80' }] })
    expect(typeof posts[0]!.body?.['requestId']).toBe('string')
    expect(await screen.findByText('1개 접수했어요.')).toBeTruthy()
  })

  it('운송장 PDF는 공유 시트로 넘기고, 접수 취소는 한 번 더 묻는다', async () => {
    const { w, posts } = world()
    const shared: { name: string; type: string; size: number }[] = []
    setNativeModules({ shareFile: async (bytes, name, type) => void shared.push({ name, type, size: bytes.length }) })
    render(w.wrap(<ParcelsScreen onBack={() => undefined} />))
    fireEvent.click(await screen.findByRole('button', { name: '금황 운송장 PDF' }))
    await waitFor(() => expect(shared).toEqual([{ name: '운송장-2026-10-29.pdf', type: 'application/pdf', size: 4 }]))
    fireEvent.click(screen.getByRole('button', { name: '금황 접수 취소' }))
    expect(screen.getByText('금황님의 택배 접수를 취소할까요? 택배사가 아직 가져가지 않았을 때만 취소돼요.')).toBeTruthy()
    expect(posts).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '취소하기' }))
    await waitFor(() => expect(posts.map((post) => post.path)).toEqual(['/api/parcels/days/2026-10-29/cancel']))
    expect(posts[0]!.body).toMatchObject({ buyer: 'u4' })
    expect(await screen.findByText('접수를 취소했어요.')).toBeTruthy()
  })

  it('우체국을 골랐으면 "우체국에 직접 접수하기" — [인터넷우체국 열기] 왼쪽, [우체국 파일 받기 (2개)] 오른쪽, 파일은 공유 시트로 (D-UX3-36)', async () => {
    const { w } = world()
    const shared: { name: string; type: string; size: number }[] = []
    setNativeModules({ shareFile: async (bytes, name, type) => void shared.push({ name, type, size: bytes.length }) })
    render(w.wrap(<ParcelsScreen onBack={() => undefined} />))
    expect(await screen.findByText('우체국에 직접 접수하기')).toBeTruthy()
    expect(screen.getByText(/계약하지 않아도 돼요/)).toBeTruthy()
    const open = screen.getByRole('button', { name: '인터넷우체국 열기' })
    const file = screen.getByRole('button', { name: '우체국 파일 받기 (2개)' })
    expect(open.compareDocumentPosition(file) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(file)
    await waitFor(() => expect(shared).toEqual([{ name: '우체국-방문접수-2026-10-29.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 5 }]))
  })

  it('앱 안 우체국 화면 (D-UX3-37): [집으로 가지러 오기] 왼쪽 · [우체국에 들고 가기] 오른쪽, 누르면 그 날짜·방법으로 연다. PC용 파일 받기도 남는다', async () => {
    const { w } = world()
    const opened: [string, string][] = []
    render(w.wrap(<ParcelsScreen onBack={() => undefined} nav={{ openEpost: (date, kind) => void opened.push([date, kind]) }} />))
    expect(await screen.findByText('우체국에 직접 접수하기')).toBeTruthy()
    const visit = screen.getByRole('button', { name: '집으로 가지러 오기' })
    const counter = screen.getByRole('button', { name: '우체국에 들고 가기' })
    expect(visit.compareDocumentPosition(counter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('button', { name: '인터넷우체국 열기' })).toBeNull()
    expect(screen.getByRole('button', { name: '우체국 파일 받기 (2개)' })).toBeTruthy()
    fireEvent.click(counter)
    fireEvent.click(visit)
    expect(opened).toEqual([
      ['2026-10-29', 'COUNTER'],
      ['2026-10-29', 'VISIT'],
    ])
  })

  it('우체국 직접 접수 묶음: "우체국 직접 접수" 꼬리표, 운송장 PDF 없음, [기록 지우기]는 라이브찜 기록만 지운다고 묻는다', async () => {
    const { w, posts } = world()
    w.server.on('GET', /^\/api\/parcels\/days\/2026-10-29$/, () => ({ body: { ...day, booked: [row('u4', '금황', { packing: '배송 완료', parcel: { ...booked, direct: 'COUNTER' } })] } }))
    render(w.wrap(<ParcelsScreen onBack={() => undefined} />))
    expect(await screen.findByText('우체국 직접 접수')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '금황 운송장 PDF' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '금황 기록 지우기' }))
    expect(screen.getByText('송장 기록을 지울까요?')).toBeTruthy()
    expect(screen.getByText(/우체국 접수는 그대로라, 취소하려면 인터넷우체국에서 해 주세요/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '지우기' }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]!.path).toContain('/cancel')
    expect(await screen.findByText('송장 기록을 지웠어요.')).toBeTruthy()
  })
})
