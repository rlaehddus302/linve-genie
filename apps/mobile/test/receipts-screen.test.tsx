// 앱 영수증·판매대장 (D-APPX-03 — 웹 ReceiptsPage·LedgerDialog와 같은 규칙·문구): 끝난 실제 방송을 먼저 고르고,
// 링크 만들기·복사(가게 이름 + 기한 + 링크 한 줄)·끊기는 한 번 더 묻기, 확인서 PDF는 공유 시트로, 기간 판매대장은 b 없이(모두 고름).
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ReceiptBuyerRow } from '@livejjim/web/src/api/types.ts'
import { setClipboardWriter } from '../src/lib/clipboard.ts'
import { shareFile } from '../src/native/share.ts'
import { setNativeModules } from '../src/native/index.ts'
import { ReceiptsScreen } from '../src/screens/ReceiptsScreen.tsx'
import { makeWorld } from './screen-support.tsx'

const rowOf = (buyer: string, name: string, patch: Partial<ReceiptBuyerRow> = {}): ReceiptBuyerRow => ({ buyer, name, phoneLast4: null, itemCount: 2, total: 14_000, payment: 'PAID', received: 14_000, remaining: 0, link: null, ...patch })
const active = { buyer: 'u2', status: 'ACTIVE' as const, url: 'https://live.test/r/abc', expiresAt: '2026-11-05T11:31:00.000Z', revokedAt: null }

function world() {
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
  w.server.on('GET', /^\/api\/days\/2026-10-29\/receipt-buyers/, () => ({ body: { buyers: [rowOf('u1', '다육맘'), rowOf('u2', '초록손', { link: active })] } }))
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

afterEach(() => {
  setNativeModules({ shareFile })
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
