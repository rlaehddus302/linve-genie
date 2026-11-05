// 앱 영수증·판매대장 (D-APPX-03 — 웹 ReceiptsPage·LedgerDialog와 같은 규칙·문구): 끝난 실제 방송을 먼저 고르고,
// 링크 만들기·복사(가게 이름 + 기한 + 링크 한 줄)·끊기는 한 번 더 묻기, 확인서 PDF는 공유 시트로, 기간 판매대장은 b 없이(모두 고름).
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ReceiptBuyerRow } from '@livejjim/web/src/api/types.ts'
import { setClipboardWriter } from '../src/lib/clipboard.ts'
import { shareFile } from '../src/native/share.ts'
import { setNativeModules } from '../src/native/index.ts'
import { deviceSms, type SmsResult } from '../src/native/sms.ts'
import { ReceiptsScreen } from '../src/screens/ReceiptsScreen.tsx'
import { makeWorld } from './screen-support.tsx'

const rowOf = (buyer: string, name: string, patch: Partial<ReceiptBuyerRow> = {}): ReceiptBuyerRow => ({ buyer, name, phoneLast4: null, itemCount: 2, total: 14_000, payment: 'PAID', received: 14_000, remaining: 0, link: null, ...patch })
const active = { buyer: 'u2', status: 'ACTIVE' as const, url: 'https://live.test/r/abc', expiresAt: '2026-11-05T11:31:00.000Z', revokedAt: null }

function world(sms = false) {
  const w = makeWorld()
  const posts: { path: string; body: Record<string, unknown> | null }[] = []
  const pulled: string[] = []
  w.server.on('GET', /^\/api\/broadcasts$/, () => ({
    body: {
      broadcasts: [
        { id: 'b0', date: '2026-10-28', title: '연습', rehearsal: true, ended: true, endedAt: '2026-10-28T12:00:00.000Z' },
        { id: 'b1', date: '2026-10-29', title: '목요일 다육', rehearsal: false, ended: true, endedAt: '2026-10-29T13:00:00.000Z' },
      ],
    },
  }))
  w.server.on('GET', /^\/api\/days$/, () => ({ body: { days: [{ date: '2026-10-29', rehearsal: false, seq: 5 }] } }))
  w.server.on('GET', /^\/api\/shop$/, () => ({ body: { shop: { name: '초록가게' } } }))
  w.server.on('GET', /^\/api\/days\/2026-10-29\/receipt-buyers/, () => ({
    body: sms
      ? { smsReady: true, buyers: [rowOf('u1', '다육맘', { sms: { last4: '5678', sentAt: null } }), rowOf('u2', '초록손', { link: active, sms: { last4: null, sentAt: null } })] }
      : { buyers: [rowOf('u1', '다육맘'), rowOf('u2', '초록손', { link: active })] },
  }))
  w.server.on('POST', /^\/api\/days\/2026-10-29\/receipt-sms\/prepare/, (call) => {
    posts.push({ path: call.path, body: call.body })
    if (call.body?.['buyer'] === 'u2' && call.body['phone'] === undefined) return { status: 409, body: { error: { code: 'NO_PHONE', message: '이 손님의 휴대폰 번호를 몰라요. 번호를 넣어 주세요.' } } }
    const phone = call.body?.['buyer'] === 'u2' ? '01098765432' : '01012345678'
    return { body: { sms: { buyer: call.body?.['buyer'], phone, last4: phone.slice(-4), text: `[초록가게] 주문 확인서예요.\nhttps://live.test/r/${String(call.body?.['buyer'])}` } } }
  })
  w.server.on('POST', /^\/api\/days\/2026-10-29\/receipt-sms\/sent/, (call) => {
    posts.push({ path: call.path, body: call.body })
    return { body: { sms: { buyer: call.body?.['buyer'], last4: '5678', sentAt: '2026-10-29T14:00:00.000Z' } } }
  })
  w.server.on('POST', /^\/api\/days\/2026-10-29\/receipt-links/, (call) => {
    posts.push({ path: call.path, body: call.body })
    return { body: { link: { ...active, buyer: String(call.body?.['buyer']) } } }
  })
  w.server.on('GET', /\.(pdf|xlsx)/, (call) => {
    pulled.push(call.path)
    return { bytes: new Uint8Array([1, 2, 3]), contentType: 'application/pdf' }
  })
  return { w, posts, pulled }
}

/** 가짜 문자 앱: 연 번호·글을 적고, 정한 결과를 돌려준다 */
function fakeSms(results: SmsResult[] = []) {
  const opened: { phone: string; text: string }[] = []
  setNativeModules({
    sms: {
      available: async () => true,
      compose: async (phone, text) => {
        opened.push({ phone, text })
        return results.shift() ?? 'sent'
      },
    },
  })
  return opened
}

afterEach(() => {
  setNativeModules({ shareFile, sms: deviceSms })
  setClipboardWriter(async () => false)
})

describe('ReceiptsScreen (앱 영수증·판매대장)', () => {
  it('끝난 실제 방송 먼저 · 링크 복사 글 · 링크 만들기 · 끊기는 한 번 더 묻는다', async () => {
    const { w, posts } = world()
    const copied: string[] = []
    setClipboardWriter(async (text) => {
      copied.push(text)
      return true
    })
    render(w.wrap(<ReceiptsScreen onBack={() => undefined} />))
    expect(await screen.findByText(/목요일 다육/)).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: '초록손 링크 복사' }))
    await waitFor(() => expect(copied).toHaveLength(1))
    expect(copied[0]).toMatch(/^초록가게 구매 내역 확인서예요\. .+까지 열 수 있어요\. https:\/\/live\.test\/r\/abc$/)
    expect(await screen.findByText('복사했어요.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '다육맘 링크 만들기' }))
    await waitFor(() => expect(posts.map((post) => post.path)).toEqual(['/api/days/2026-10-29/receipt-links']))
    expect(posts[0]!.body).toMatchObject({ buyer: 'u1' })
    fireEvent.click(screen.getByRole('button', { name: '초록손 링크 끊기' }))
    expect(screen.getByText('초록손님의 링크를 끊으면 그 링크로는 더 이상 열 수 없어요. 필요하면 새 링크를 만들어 보내 주세요.')).toBeTruthy()
    expect(posts).toHaveLength(1)
  })

  // D-REAL-05로 바뀐 기대: 옛 "한 번 더 묻고 서버가 보냄(receipt-sms 한 번)" → 새 "바로 판매자 문자 앱을 채워 열고, 보냈으면 보냄 표시"
  it('D-REAL-05 문자 보내기: 번호 아는 손님은 바로 문자 앱을 손님 번호·확인서 링크로 열고, 보내면 보냄 표시. 모르는 손님은 번호를 넣고 연다', async () => {
    const opened = fakeSms()
    const { w, posts } = world(true)
    render(w.wrap(<ReceiptsScreen onBack={() => undefined} />))
    expect(await screen.findByText('문자 보낼 번호 끝자리 5678')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: '다육맘 문자 보내기' }))
    await waitFor(() => expect(opened).toHaveLength(1))
    expect(opened[0]).toEqual({ phone: '01012345678', text: '[초록가게] 주문 확인서예요.\nhttps://live.test/r/u1' })
    expect(await screen.findByText('확인서 문자를 보냈어요.')).toBeTruthy()
    expect(posts.map((post) => post.path)).toEqual(['/api/days/2026-10-29/receipt-sms/prepare', '/api/days/2026-10-29/receipt-sms/sent'])
    expect(posts[1]!.body).toMatchObject({ buyer: 'u1' })
    fireEvent.click(screen.getByRole('button', { name: '초록손 문자 보내기' }))
    const field = await screen.findByLabelText('손님 휴대폰 번호')
    fireEvent.change(field, { target: { value: '010-9876-5432' } })
    fireEvent.click(screen.getByRole('button', { name: '문자 앱 열기' }))
    await waitFor(() => expect(opened).toHaveLength(2))
    expect(opened[1]!.phone).toBe('01098765432')
    expect(posts[2]!.body).toMatchObject({ buyer: 'u2', phone: '010-9876-5432' })
  })

  it('D-REAL-05 문자 앱을 닫으면 보냄 표시를 하지 않는다', async () => {
    const opened = fakeSms(['cancelled'])
    const { w, posts } = world(true)
    render(w.wrap(<ReceiptsScreen onBack={() => undefined} />))
    fireEvent.click(await screen.findByRole('button', { name: '다육맘 문자 보내기' }))
    await waitFor(() => expect(opened).toHaveLength(1))
    await waitFor(() => expect(posts.map((post) => post.path)).toEqual(['/api/days/2026-10-29/receipt-sms/prepare']))
    expect(screen.queryByText('확인서 문자를 보냈어요.')).toBeNull()
  })

  it('D-REAL-05 모두 보내기: 한 번 묻고 번호 아는 손님마다 문자 앱을 차례로 연다', async () => {
    const opened = fakeSms()
    const { w, posts } = world(true)
    render(w.wrap(<ReceiptsScreen onBack={() => undefined} />))
    fireEvent.click(await screen.findByRole('button', { name: '번호 아는 손님 모두 문자 보내기 (1명)' }))
    expect(await screen.findByText('1명에게 차례로 확인서 문자를 보낼까요?')).toBeTruthy()
    expect(opened).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '보내기' }))
    expect(await screen.findByText('1명에게 문자를 보냈어요.', undefined, { timeout: 3000 })).toBeTruthy()
    expect(opened.map((item) => item.phone)).toEqual(['01012345678'])
    expect(posts.filter((post) => post.path.endsWith('/sent')).map((post) => post.body?.['buyer'])).toEqual(['u1'])
  })

  it('D-REAL-05 문자를 보낼 수 없는 기기면 문자 단추 대신 안내', async () => {
    setNativeModules({ sms: { available: async () => false, compose: async () => 'cancelled' } })
    const { w } = world(true)
    render(w.wrap(<ReceiptsScreen onBack={() => undefined} />))
    expect(await screen.findByText('이 기기에서는 문자를 보낼 수 없어요. 링크 보내기로 보내 주세요.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '다육맘 문자 보내기' })).toBeNull()
  })

  it('D-REAL-03 문자 칸이 없는 서버(smsReady 없음)면 문자 단추가 없다', async () => {
    const { w } = world()
    render(w.wrap(<ReceiptsScreen onBack={() => undefined} />))
    expect(await screen.findByRole('button', { name: '다육맘 PDF' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '다육맘 문자 보내기' })).toBeNull()
  })

  it('확인서 PDF는 공유 시트로, 기간 판매대장은 모두 고르면 b 없이', async () => {
    const { w, pulled } = world()
    const shared: string[] = []
    setNativeModules({ shareFile: async (_bytes, name) => void shared.push(name) })
    render(w.wrap(<ReceiptsScreen onBack={() => undefined} />))
    fireEvent.click(await screen.findByRole('button', { name: '다육맘 PDF' }))
    await waitFor(() => expect(shared).toEqual(['receipt-2026-10-29.pdf']))
    expect(pulled[0]).toBe('/api/days/2026-10-29/receipt.pdf?buyer=u1')
    fireEvent.click(screen.getByRole('button', { name: '기간 판매대장 엑셀' }))
    expect(await screen.findByRole('checkbox', { name: /목요일 다육/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '엑셀 받기' }))
    await waitFor(() => expect(shared).toHaveLength(2))
    expect(pulled[1]).toBe('/api/ledger.xlsx?from=2026-10-29&to=2026-10-29')
    expect(shared[1]).toBe('ledger-2026-10-29-2026-10-29.xlsx')
  })
})
