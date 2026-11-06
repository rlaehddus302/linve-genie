// 앱 안 우체국 화면 (D-UX3-37): 자료를 받아 우체국 화면에 스크립트를 넣고, 찾은 송장번호는 판매자가 확인한 뒤에만 서버에 적는다.
// 웹뷰는 가짜(EpostWeb을 바꾼다) — 넣은 스크립트와 화면이 보낸 글을 시험이 대신한다.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EpostWebProps } from '../src/epost/EpostWeb.tsx'
import { EPOST_VISIT_PAGE, type EpostKit } from '../src/epost/kit.ts'
import { makeWorld } from './screen-support.tsx'

const web: { props: EpostWebProps | null; injected: string[] } = { props: null, injected: [] }
vi.mock('../src/epost/EpostWeb.tsx', async () => {
  const { useImperativeHandle } = await import('react')
  return {
    EpostWeb: (props: EpostWebProps) => {
      web.props = props
      useImperativeHandle(props.ref, () => ({ inject: (script: string) => void web.injected.push(script), reload: () => undefined }))
      return null
    },
  }
})
const { EpostScreen } = await import('../src/screens/EpostScreen.tsx')

const kit: EpostKit = {
  date: '2026-10-29',
  sender: { name: '다육이네', phone: '0311234567', zip: '16490', address: '경기도 수원시 팔달구 효원로 1', detail: '1층' },
  receivers: [
    { buyer: 'u1', name: '홍길동', phone: '01012345678', zip: '04524', address: '서울', detail: '1', memo: '', qty: 1, content: '물품 1개', kg: 5, cm: 80 },
    { buyer: 'u2', name: '김다육', phone: '01098765432', zip: '', address: '양산', detail: '.', memo: '', qty: 2, content: '물품 2개', kg: 5, cm: 80 },
  ],
  file: { name: 'x.xlsx', base64: 'UEs=' },
}

function world() {
  const w = makeWorld()
  const posts: Record<string, unknown>[] = []
  w.server.on('GET', /^\/api\/parcels\/days\/2026-10-29\/epost-kit$/, () => ({ body: { kit } }))
  w.server.on('POST', /^\/api\/parcels\/days\/2026-10-29\/direct$/, (call) => {
    posts.push(call.body ?? {})
    return { body: { date: '2026-10-29', results: [{ buyer: 'u1', ok: true, invoice: '6070123456789', invoiceText: '6070-1234-5678-9' }, { buyer: 'u2', ok: false, reason: 'REJECTED', message: '이미 다른 묶음에 적은 송장번호예요. 다시 확인해 주세요.' }] } }
  })
  return { w, posts }
}

beforeEach(() => {
  web.props = null
  web.injected = []
})

describe('EpostScreen (앱 안 우체국 화면)', () => {
  it('가지러 오기: 방문접수 화면을 열고, 화면을 다 읽으면 채우기·글 모으기 스크립트를 넣는다. 화면이 보낸 단계를 쉬운 문장으로', async () => {
    const { w } = world()
    render(w.wrap(<EpostScreen date="2026-10-29" kind="VISIT" onBack={() => undefined} />))
    await waitFor(() => expect(web.props).not.toBeNull())
    expect(screen.getByText('집으로 가지러 오기')).toBeTruthy()
    expect(web.props!.uri).toBe(EPOST_VISIT_PAGE)
    act(() => web.props!.onLoaded(EPOST_VISIT_PAGE))
    expect(web.injected).toHaveLength(2)
    expect(web.injected[0]).toContain('setGridRowsToAddressFile')
    expect(web.injected[0]).toContain('"name":"다육이네"')
    expect(web.injected[0]).not.toContain('reqBtn')
    expect(web.injected[1]).toContain("type: 'rows'")
    act(() => web.props!.onMessage(JSON.stringify({ type: 'fill', step: 'need-date' })))
    expect(screen.getByText(/방문 날짜와 시간을 고른 뒤/)).toBeTruthy()
    act(() => web.props!.onMessage(JSON.stringify({ type: 'upload', ok: true, count: 2, rows: 2 })))
    expect(screen.getByText('받는 분 2명을 넣었어요. 우체국 목록을 확인하고 [신청]을 눌러 주세요.')).toBeTruthy()
    act(() => web.props!.onPopup())
    expect(screen.getByText(/앱 안에서 창을 열 수 없어요/)).toBeTruthy()
  })

  it('송장번호 찾기: 화면 글에서 짝을 찾아 보여 주고, [N개 넣기]를 눌러야 서버에 적는다 (같은 요청 번호), 결과 문장', async () => {
    const { w, posts } = world()
    render(w.wrap(<EpostScreen date="2026-10-29" kind="COUNTER" onBack={() => undefined} />))
    await waitFor(() => expect(web.props).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '송장번호 찾기' }))
    act(() => web.props!.onMessage(JSON.stringify({ type: 'rows', rows: ['안내 문장'] })))
    expect(screen.getByText(/이 화면에서 송장번호를 찾지 못했어요/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '송장번호 찾기' }))
    act(() => web.props!.onMessage(JSON.stringify({ type: 'rows', rows: ['1 홍길동 6070123456789', '2 김다육 6070-1234-56790', '3 모름 6070123456799'] })))
    expect(screen.getAllByText('송장번호 2개를 찾았어요').length).toBeGreaterThan(0)
    expect(screen.getByText('홍길동 · 6070123456789')).toBeTruthy()
    expect(screen.getByText('김다육 · 6070123456790')).toBeTruthy()
    expect(screen.getByText(/이름을 맞추지 못한 송장번호 1개/)).toBeTruthy()
    expect(posts).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '2개 넣기' }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toMatchObject({ kind: 'COUNTER', items: [{ buyer: 'u1', invoice: '6070123456789' }, { buyer: 'u2', invoice: '6070123456790' }] })
    expect(typeof posts[0]!['requestId']).toBe('string')
    expect(await screen.findByText(/1개 묶음에 송장번호를 넣었어요./)).toBeTruthy()
    expect(screen.getByText(/이미 다른 묶음에 적은 송장번호예요/)).toBeTruthy()
  })

  it('들고 가기: 동의 화면에서는 채우지 않고, 입력 화면을 읽으면 채우기 스크립트 → 넣은·못 넣은 수 문장', async () => {
    const { w } = world()
    render(w.wrap(<EpostScreen date="2026-10-29" kind="COUNTER" onBack={() => undefined} />))
    await waitFor(() => expect(web.props).not.toBeNull())
    expect(screen.getByText('우체국에 들고 가기')).toBeTruthy()
    act(() => web.props!.onLoaded('https://service.epost.go.kr/front.commonpostplus.ParcelRetrieveAcceptPlusAgree.postal'))
    expect(web.injected.filter((script) => script.includes('inputReceiver'))).toHaveLength(0)
    act(() => web.props!.onLoaded('https://service.epost.go.kr/front.commonpostplus.ParcelRetrieveAcceptPlus.postal'))
    expect(web.injected.filter((script) => script.includes('inputReceiver'))).toHaveLength(1)
    act(() => web.props!.onMessage(JSON.stringify({ type: 'fill', ok: true, sender: true, added: 1, skipped: 1 })))
    expect(screen.getByText(/받는 분 1명을 목록에 넣었어요/)).toBeTruthy()
    expect(screen.getByText(/1명은 우편번호나 연락처가 맞지 않아 넣지 못했어요/)).toBeTruthy()
  })
})
